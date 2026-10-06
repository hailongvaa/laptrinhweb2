# Handoff Report: Feature F3 — ACID Order Creation & Row-Locking in `POST /api/orders`

**Agent ID**: teamwork_preview_explorer_m2_1 (Explorer M2-1)  
**Milestone**: Milestone 2 (ACID Transactions & State Machine)  
**Target File**: `car-store-backend/server.js` (lines 480–611)  
**Handoff Type**: Hard (Analysis and Specification Complete)

---

## 1. Observation

### 1.1 Current Implementation in `car-store-backend/server.js` (lines 480–611)
Direct inspection of `car-store-backend/server.js` reveals the current `app.post('/api/orders', ...)` handler:
- **Lock Ordering & Concurrency (lines 502–529)**:
  ```javascript
  for (const item of items) {
      const pid = parseInt(item.productId, 10);
      const reqQty = parseInt(item.quantity, 10);
      ...
      const checkReq = new sql.Request(transaction);
      const checkRes = await checkReq
          .input('pid', sql.Int, pid)
          .query(`SELECT id, name, stock_quantity, price FROM products WITH (UPDLOCK, ROWLOCK) WHERE id = @pid`);
  ```
  Items are processed in the arbitrary sequence provided by the client payload. If Transaction A acquires Product 2 then Product 1, while Transaction B acquires Product 1 then Product 2, a cyclic lock wait occurs, resulting in SQL Server Deadlock Error 1205 (`Transaction (Process ID ...) was deadlocked on resources with another process and has been chosen as the deadlock victim`).

- **Duplicate Product Entries in Payload (Defect 3 in `TEST_READY.md`)**:
  In lines 502–529, each item in `items` is validated individually against `stock_quantity`:
  ```javascript
  if (product.stock_quantity < reqQty) {
      await transaction.rollback();
      return res.status(400).json({ ... });
  }
  ```
  Stock deduction does NOT occur in this loop; deduction occurs later in lines 556–575.
  When an order payload contains duplicate product entries (e.g., `[{ productId: 4, quantity: 3 }, { productId: 4, quantity: 3 }]`) with current stock equal to 5:
  - Iteration 1: checks `pid=4, reqQty=3`. Stock is 5. `5 < 3` is false (passes).
  - Iteration 2: checks `pid=4, reqQty=3`. Stock in table is still 5. `5 < 3` is false (passes).
  - Lines 556–575: executes two updates of `-3` each, attempting to reduce stock to `-1`, triggering constraint violation or inventory deficit.

- **Client-Provided Pricing Vulnerability (lines 532, 559, 566)**:
  ```javascript
  // Line 532:
  const totalAmount = items.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.unitPrice)), 0);
  ...
  // Line 559 & 566:
  const price = Number(item.unitPrice);
  ...
  .input('unitPrice', sql.Decimal(12, 2), price)
  ```
  The endpoint calculates `totalAmount` and sets `order_items.unit_price` using `item.unitPrice` sent by the untrusted HTTP client. A client can pass `unitPrice: 0` or omit `unitPrice` entirely (as specified in `PROJECT.md § 4.2`), causing severe financial tampering or SQL NaN conversion failures.

- **Missing Customer Snapshot (lines 547–551)**:
  ```javascript
  INSERT INTO orders (order_code, customer_id, recipient_name, recipient_phone, shipping_address, total_amount, order_status, tracking_code)
  OUTPUT INSERTED.id
  VALUES (@orderCode, @customerId, @recipientName, @recipientPhone, @shippingAddress, @totalAmount, 'pending', @trackingCode);
  ```
  In Milestone M1 (`migrate.js`), three snapshot columns were added: `customer_name NVARCHAR(100)`, `customer_email VARCHAR(100)`, `customer_phone VARCHAR(15)`. Current `INSERT INTO orders` omits these columns, leaving them NULL for newly created orders.

- **Timestamp-Only Identifiers (lines 533–535)**:
  ```javascript
  const timestamp = Date.now();
  const orderCode = 'ORD-' + timestamp;
  const trackingCode = 'VNPOST-' + timestamp;
  ```
  When concurrent requests arrive in the same millisecond, identical `trackingCode` values collide against the `UQ_orders_tracking_code` unique constraint and `shipments.tracking_code` unique constraint, causing unexpected 500 error aborts.

- **Double-Rollback and Driver Abort Vulnerability (lines 603–606)**:
  ```javascript
  } catch (err) {
      await transaction.rollback();
      throw err;
  }
  ```
  Direct inspection of `node_modules/mssql/lib/base/transaction.js` (lines 298–308) confirms:
  ```javascript
  _rollback (callback) {
      if (this._aborted) {
          return setImmediate(callback, this._createAbortError())
      }
      if (!this._acquiredConnection) {
          return setImmediate(callback, new TransactionError('Transaction has not begun. Call begin() first.', 'ENOTBEGUN'))
      }
  ```
  If `transaction.rollback()` is invoked after the transaction was already aborted by the driver, or if an early rollback already executed, calling `await transaction.rollback()` throws `AbortError` or `ENOTBEGUN`, masking the underlying root cause.

---

## 2. Logic Chain

### Step 2.1: Pre-aggregation & Monotonic Sorting Eliminates Deadlocks and Duplicate Deficits
1. **Observation**: Items array can contain out-of-order product IDs and duplicate product IDs.
2. **Logic**:
   - By creating a consolidation map `Map<productId, { productId, quantity }>`, any duplicate entries for the same product in the payload are summed into a single consolidated `quantity`.
   - By sorting the consolidated entries ascending by `productId` (`items.sort((a, b) => a.productId - b.productId)`), every database transaction requests row locks in the exact same deterministic hierarchy (e.g., Row 1 -> Row 2 -> Row 5).
   - Because lock acquisition is strictly monotonic, cyclic lock wait dependencies are impossible. Deadlock Error 1205 is mathematically eliminated.
   - Inserting consolidated rows into `order_items` also avoids the known SQL Server non-deterministic behavior where `UPDATE products SET stock_quantity = stock_quantity + oi.quantity FROM products INNER JOIN order_items oi` only updates once if multiple rows match during cancellation.

### Step 2.2: Authoritative Database Pricing Enforces Financial Integrity
1. **Observation**: `products` table contains `price DECIMAL(12, 2)` retrieved under `UPDLOCK, ROWLOCK`. `PROJECT.md § 4.2` contract specifies `items: [{ productId: 1, quantity: 2 }]` without requiring `unitPrice`.
2. **Logic**:
   - The server must read `product.price` directly from the locked product row.
   - Any client-submitted `unitPrice` must be disregarded.
   - Subtotal per item is computed as `item.quantity * Number(product.price)`.
   - `totalAmount` is computed as the sum of all item subtotals.
   - The authoritative `product.price` is persisted into `order_items.unit_price`.
   - This eliminates client-side price manipulation while supporting both legacy payloads (with `unitPrice`) and standard payloads (without `unitPrice`).

### Step 2.3: Customer Profile Resolution and Snapshotting
1. **Observation**: `orders` has columns `customer_name`, `customer_email`, `customer_phone`. Request body may provide `customerName`, `customerEmail`, `customerPhone` or only `customerId`.
2. **Logic**:
   - Check if `customerName`, `customerEmail`, `customerPhone` are present in `req.body`.
   - If any are missing and `customerId` is provided, execute a query against `users`:
     ```sql
     SELECT full_name, email, phone FROM users WHERE id = @customerId
     ```
   - For guest orders (e.g. `customerId: 1` without matching user name or unregistered guests), fallback to `recipientName` and `recipientPhone`.
   - Insert snapshot values into `orders(customer_name, customer_email, customer_phone)`.

### Step 2.4: Collision-Resistant Identifiers
1. **Observation**: `orders.order_code` is `VARCHAR(30) UNIQUE`, `orders.tracking_code` is `VARCHAR(50) UNIQUE`.
2. **Logic**:
   - Using `crypto.randomBytes(3).toString('hex').toUpperCase()` produces 6 hex characters.
   - `trackingCode`: `VNPOST-${Date.now()}-${random}` -> `VNPOST-1728240000000-A1B2C3` (length: 7 + 13 + 1 + 6 = 27 characters <= 50).
   - `orderCode`: `ORD-${Date.now()}-${random}` -> `ORD-1728240000000-A1B2C3` (length: 4 + 13 + 1 + 6 = 24 characters <= 30).
   - Entropy: $16^6 = 16,777,216$ combinations per millisecond, ensuring zero collisions across concurrent workers.

### Step 2.5: Safe Rollback Pattern with Double-Rollback Prevention
1. **Observation**: Calling `transaction.rollback()` multiple times throws `AbortError`.
2. **Logic**:
   - Encapsulate transaction state in flags: `isTransactionActive`, `isCommitted`, `isRolledBack`.
   - Create helper `rollbackSafely()`:
     ```javascript
     const rollbackSafely = async () => {
         if (!isTransactionActive || isCommitted || isRolledBack) return;
         isRolledBack = true;
         try {
             if (!transaction._aborted) {
                 await transaction.rollback();
             }
         } catch (rbErr) {
             console.warn('⚠️ Safe rollback suppressed error:', rbErr.message);
         } finally {
             isTransactionActive = false;
         }
     };
     ```
   - When stock is insufficient (`stock_quantity < reqQty`), execute `await rollbackSafely()` and immediately return HTTP 400 with both `error` and `message` properties:
     ```javascript
     return res.status(400).json({
         success: false,
         error: `Sản phẩm ${product.name} chỉ còn ${product.stock_quantity} chiếc trong kho (yêu cầu ${reqQty}).`,
         message: `Sản phẩm "${product.name}" chỉ còn ${product.stock_quantity} xe trong kho (bạn đặt ${reqQty} xe). Vui lòng điều chỉnh lại giỏ hàng!`
     });
     ```
   - In the outer `catch (err)` block, execute `await rollbackSafely()` so unexpected runtime errors roll back cleanly without throwing secondary driver errors.

---

## 3. Caveats

1. **Foreign Key Dependency on `users(id)`**:
   - In the database schema, `orders.customer_id` has a foreign key constraint `fk_orders_users` referencing `users(id)`.
   - If a request specifies a `customerId` that does not exist in `users`, SQL Server will throw an FK constraint violation. To guard against this, if `customerId` is provided, the query should verify that the user exists in `users`; if not found, it must fall back to guest user ID `1` (which is seeded in `02_insert_mock_data.sql`).
2. **Response Structure Compatibility**:
   - `PROJECT.md § 4.2` specifies response property `order: { id, orderCode, trackingCode, totalAmount, status }`.
   - Existing tests and `cart.html` look for `res.data.orderCode`, `res.data.trackingCode`, `res.data.totalAmount`.
   - The endpoint must return BOTH top-level properties and the nested `order` object to preserve 100% backward compatibility.
3. **Frontend UI Freeze (R1)**:
   - All changes are strictly backend (`car-store-backend/server.js`). No frontend HTML, CSS, or DOM structures are altered.

---

## 4. Conclusion & Complete Implementation Specification

### 4.1 Target File & Replacement Scope
- **File**: `car-store-backend/server.js`
- **Lines**: Replace lines 480–611 (`app.post('/api/orders', ...)`).

### 4.2 Proposed Code Implementation

```javascript
// 3. API nhận yêu cầu Đặt hàng từ Website (ACID Transaction, Row-Locking, Authoritative Pricing, Defect 3 Resolution)
app.post('/api/orders', async (req, res) => {
    const { 
        customerId = 1, 
        customerName, 
        customerEmail, 
        customerPhone, 
        recipientName, 
        recipientPhone, 
        shippingAddress, 
        items 
    } = req.body || {};

    // 1. Validation đầu vào: Thông tin giao hàng
    if (!recipientName || !String(recipientName).trim() || 
        !recipientPhone || !String(recipientPhone).trim() || 
        !shippingAddress || !String(shippingAddress).trim()) {
        return res.status(400).json({ 
            success: false, 
            error: 'Vui lòng cung cấp đầy đủ: Tên người nhận, Số điện thoại và Địa chỉ giao hàng.',
            message: 'Vui lòng cung cấp đầy đủ: Tên người nhận, Số điện thoại và Địa chỉ giao hàng.' 
        });
    }

    // 2. Validation đầu vào: Danh sách sản phẩm giỏ hàng
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ 
            success: false, 
            error: 'Giỏ hàng đang trống.',
            message: 'Giỏ hàng đang trống.' 
        });
    }

    // 3. Tiền tổng hợp số lượng (Pre-aggregation) giải quyết Defect 3 & Kiểm tra tính hợp lệ của items
    const aggregatedMap = new Map();
    for (const item of items) {
        if (!item || typeof item !== 'object') {
            return res.status(400).json({ 
                success: false, 
                error: 'Dữ liệu sản phẩm không hợp lệ.',
                message: 'Dữ liệu sản phẩm không hợp lệ.' 
            });
        }

        const pid = parseInt(item.productId, 10);
        const reqQty = parseInt(item.quantity, 10);

        if (isNaN(pid) || isNaN(reqQty) || pid <= 0 || reqQty <= 0 || String(item.quantity).trim() !== String(reqQty)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Thông tin sản phẩm hoặc số lượng không hợp lệ.',
                message: 'Thông tin sản phẩm hoặc số lượng không hợp lệ.' 
            });
        }

        if (aggregatedMap.has(pid)) {
            aggregatedMap.get(pid).quantity += reqQty;
        } else {
            aggregatedMap.set(pid, { productId: pid, quantity: reqQty });
        }
    }

    // 4. Sắp xếp đơn hàng tăng dần theo productId để bảo đảm Deterministic Lock Ordering (Chống Deadlock)
    const sortedItems = Array.from(aggregatedMap.values()).sort((a, b) => a.productId - b.productId);

    try {
        const { pool, sql } = await getDb();
        const transaction = new sql.Transaction(pool);
        let isTransactionActive = false;
        let isCommitted = false;
        let isRolledBack = false;

        // Cơ chế bọc Rollback an toàn chống Double-Rollback và lỗi driver _aborted
        const rollbackSafely = async () => {
            if (!isTransactionActive || isCommitted || isRolledBack) return;
            isRolledBack = true;
            try {
                if (!transaction._aborted) {
                    await transaction.rollback();
                }
            } catch (rbErr) {
                console.warn('⚠️ Safe rollback suppressed error:', rbErr.message);
            } finally {
                isTransactionActive = false;
            }
        };

        await transaction.begin();
        isTransactionActive = true;

        try {
            // Bước 1: Xác thực customer_id và snapshot thông tin khách hàng vào đơn
            let parsedCustomerId = parseInt(customerId, 10) || 1;
            let snapName = customerName ? String(customerName).trim() : null;
            let snapEmail = customerEmail ? String(customerEmail).trim() : null;
            let snapPhone = customerPhone ? String(customerPhone).trim() : null;

            const userReq = new sql.Request(transaction);
            const userRes = await userReq
                .input('userId', sql.Int, parsedCustomerId)
                .query(`SELECT id, full_name, email, phone FROM users WHERE id = @userId`);

            if (userRes.recordset.length > 0) {
                const u = userRes.recordset[0];
                if (!snapName) snapName = u.full_name;
                if (!snapEmail) snapEmail = u.email;
                if (!snapPhone) snapPhone = u.phone;
            } else {
                // Nếu customerId không tồn tại trong bảng users, fallback về user guest (id: 1)
                const fallbackReq = new sql.Request(transaction);
                const fallbackRes = await fallbackReq.query(`SELECT id, full_name, email, phone FROM users WHERE id = 1`);
                if (fallbackRes.recordset.length > 0) {
                    parsedCustomerId = 1;
                    const fb = fallbackRes.recordset[0];
                    if (!snapName) snapName = fb.full_name || String(recipientName).trim();
                    if (!snapEmail) snapEmail = fb.email;
                    if (!snapPhone) snapPhone = fb.phone || String(recipientPhone).trim();
                } else {
                    parsedCustomerId = 1;
                    if (!snapName) snapName = String(recipientName).trim();
                    if (!snapPhone) snapPhone = String(recipientPhone).trim();
                }
            }

            // Bước 2: Kiểm tra tồn kho & Đọc giá Database có bản quyền (Authoritative Pricing) theo thứ tự khóa
            const resolvedItems = [];
            let totalAmount = 0;

            for (const item of sortedItems) {
                const checkReq = new sql.Request(transaction);
                const checkRes = await checkReq
                    .input('pid', sql.Int, item.productId)
                    .query(`SELECT id, name, stock_quantity, price FROM products WITH (UPDLOCK, ROWLOCK) WHERE id = @pid`);

                if (checkRes.recordset.length === 0) {
                    await rollbackSafely();
                    return res.status(404).json({ 
                        success: false, 
                        error: `Sản phẩm ID #${item.productId} không tồn tại trong kho.`,
                        message: `Sản phẩm ID #${item.productId} không tồn tại trong kho.` 
                    });
                }

                const product = checkRes.recordset[0];
                const availableStock = Number(product.stock_quantity);

                if (availableStock < item.quantity) {
                    await rollbackSafely();
                    return res.status(400).json({ 
                        success: false, 
                        error: `Sản phẩm ${product.name} chỉ còn ${availableStock} chiếc trong kho (yêu cầu ${item.quantity}).`,
                        message: `Sản phẩm "${product.name}" chỉ còn ${availableStock} xe trong kho (bạn đặt ${item.quantity} xe). Vui lòng điều chỉnh lại giỏ hàng!` 
                    });
                }

                // Giá bán Authoritative từ Database (bỏ qua giá client gửi để chống gian lận)
                const authoritativePrice = Number(product.price);
                totalAmount += (authoritativePrice * item.quantity);

                resolvedItems.push({
                    productId: item.productId,
                    quantity: item.quantity,
                    unitPrice: authoritativePrice,
                    name: product.name
                });
            }

            // Bước 3: Sinh mã đơn và mã vận đơn chống va chạm (Collision-Resistant)
            const crypto = require('crypto');
            const timestamp = Date.now();
            const orderRand = crypto.randomBytes(3).toString('hex').toUpperCase();
            const trackRand = crypto.randomBytes(3).toString('hex').toUpperCase();

            const orderCode = `ORD-${timestamp}-${orderRand}`;
            const trackingCode = `VNPOST-${timestamp}-${trackRand}`;

            // Bước 4: Thêm đơn hàng vào bảng orders (có Customer Snapshot)
            const orderRequest = new sql.Request(transaction);
            const orderResult = await orderRequest
                .input('orderCode', sql.VarChar(30), orderCode)
                .input('customerId', sql.Int, parsedCustomerId)
                .input('customerName', sql.NVarChar(100), snapName)
                .input('customerEmail', sql.VarChar(100), snapEmail)
                .input('customerPhone', sql.VarChar(15), snapPhone)
                .input('recipientName', sql.NVarChar(100), String(recipientName).trim())
                .input('recipientPhone', sql.VarChar(15), String(recipientPhone).trim())
                .input('shippingAddress', sql.NVarChar(sql.MAX), String(shippingAddress).trim())
                .input('totalAmount', sql.Decimal(14, 2), totalAmount)
                .input('trackingCode', sql.VarChar(50), trackingCode)
                .query(`
                    INSERT INTO orders (
                        order_code, customer_id, customer_name, customer_email, customer_phone,
                        recipient_name, recipient_phone, shipping_address, total_amount, order_status, tracking_code
                    )
                    OUTPUT INSERTED.id
                    VALUES (
                        @orderCode, @customerId, @customerName, @customerEmail, @customerPhone,
                        @recipientName, @recipientPhone, @shippingAddress, @totalAmount, 'pending', @trackingCode
                    );
                `);

            const newOrderId = orderResult.recordset[0].id;

            // Bước 5: Thêm order_items và trừ tồn kho sản phẩm nguyên tử
            for (const item of resolvedItems) {
                const itemRequest = new sql.Request(transaction);
                await itemRequest
                    .input('orderId', sql.Int, newOrderId)
                    .input('productId', sql.Int, item.productId)
                    .input('quantity', sql.Int, item.quantity)
                    .input('unitPrice', sql.Decimal(12, 2), item.unitPrice)
                    .query(`
                        INSERT INTO order_items (order_id, product_id, quantity, unit_price)
                        VALUES (@orderId, @productId, @quantity, @unitPrice);

                        UPDATE products 
                        SET stock_quantity = stock_quantity - @quantity
                        WHERE id = @productId;
                    `);
            }

            // Bước 6: Tạo bản ghi vận đơn trong bảng shipments
            const shipmentRequest = new sql.Request(transaction);
            await shipmentRequest
                .input('orderId', sql.Int, newOrderId)
                .input('trackingCode', sql.VarChar(50), trackingCode)
                .input('carrier', sql.NVarChar(100), 'VNPost Tiết Kiệm')
                .input('shippingStatus', sql.NVarChar(50), 'pending')
                .input('currentLocation', sql.NVarChar(255), 'Trung tâm tiếp nhận đơn hàng - CarModelStore')
                .input('notes', sql.NVarChar(sql.MAX), 'Đơn hàng mới tạo, đang chờ đóng gói xuất kho')
                .query(`
                    INSERT INTO shipments (order_id, tracking_code, carrier, shipping_status, current_location, estimated_delivery, notes)
                    VALUES (@orderId, @trackingCode, @carrier, @shippingStatus, @currentLocation, DATEADD(day, 3, GETDATE()), @notes);
                `);

            // Hoàn tất transaction
            await transaction.commit();
            isCommitted = true;
            isTransactionActive = false;

            console.log(`🎉 Tạo đơn hàng thành công: ${orderCode} | Mã vận đơn: ${trackingCode} | Tổng: ${totalAmount} VND`);
            
            // Trả về dữ liệu tương thích đồng thời với frontend (cart.html), backend contracts (PROJECT.md § 4.2), và E2E test runner
            return res.status(201).json({
                success: true,
                message: 'Tạo đơn hàng thành công!',
                orderId: newOrderId,
                orderCode: orderCode,
                trackingCode: trackingCode,
                totalAmount: totalAmount,
                order: {
                    id: newOrderId,
                    orderCode: orderCode,
                    trackingCode: trackingCode,
                    totalAmount: totalAmount,
                    status: 'pending'
                }
            });
        } catch (innerErr) {
            await rollbackSafely();
            throw innerErr;
        }
    } catch (error) {
        console.error('Lỗi khi lưu đơn hàng:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Lỗi máy chủ khi tạo đơn hàng.', 
            message: 'Lỗi máy chủ khi tạo đơn hàng.', 
            details: error.message 
        });
    }
});
```

---

## 5. Verification Method

### 5.1 Independent Test Commands
Once the implementer applies the changes to `car-store-backend/server.js`, execute the following verification commands:

1. **Verify AC1 & AC2 (Tier 1 Feature Tests)**:
   ```powershell
   node --test test/tier1-features.test.js
   ```
   *Expected Result*: All AC1 (AC1.1 - AC1.5) and AC2 (AC2.1 - AC2.5) tests pass.

2. **Verify Boundary & Defect 3 (Tier 2 Boundary Tests)**:
   ```powershell
   node --test test/tier2-boundary.test.js
   ```
   *Expected Result*:
   - `Boundary 1.1` to `Boundary 1.5` pass.
   - `Boundary 2.1` (**Defect 3**) passes: ordering `[{productId: 4, quantity: 3}, {productId: 4, quantity: 3}]` against stock of 5 is rejected with 400 and product stock remains unchanged.
   - `Boundary 2.2` to `Boundary 2.5` pass.
   - `Boundary 5.1` (Concurrency race condition: 3 simultaneous orders competing for 1 item) passes with exactly 1 success and 2 serialized rejections.

3. **Verify Master Test Suite**:
   ```powershell
   node test/test-runner.js
   ```

### 5.2 Invalidation Conditions
The implementation shall be considered invalid if:
- Any orphan rows exist in `orders`, `order_items`, or `shipments` after a failed order creation.
- A cart with duplicate product lines triggers an unhandled SQL constraint violation instead of a 400 response.
- Client-tampered `unitPrice` influences `orders.total_amount` or `order_items.unit_price`.
- Calling rollback throws `AbortError` or `ENOTBEGUN` in console logs.
- `orders.customer_name`, `customer_email`, `customer_phone` remain NULL for registered customer orders.
