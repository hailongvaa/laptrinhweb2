# Handoff Report: Milestone 2 — ACID Transactions & Two-Way State Machine (Features F3 & F4)

**Agent ID**: teamwork_preview_worker_m2_1 (Worker M2-1)  
**Milestone**: Milestone 2 (ACID Transactions & Two-Way State Machine)  
**Modified File**: `car-store-backend/server.js`  
**Handoff Type**: Hard (Implementation and Verification Complete)

---

## 1. Observation

Direct inspection of `car-store-backend/server.js` and execution against the E2E test suite revealed the following:

### 1.1 Baseline Defects Prior to Modification
1. **Defect 1 (Non-Idempotent Order Cancellation & Stock Inflation)**:
   - In `app.put('/api/orders/:code/status')`, executing a cancellation on an order that was already `'cancelled'` updated `order_status` again and unconditionally executed:
     ```sql
     UPDATE p
     SET p.stock_quantity = p.stock_quantity + oi.quantity
     FROM products p
     INNER JOIN order_items oi ON p.id = oi.product_id
     WHERE oi.order_id = @orderId;
     ```
   - This caused inventory inflation (tested by `Boundary 3.1` and `Boundary 3.2`), where repeating cancel or sending rapid concurrent cancel requests multiplied stock rather than preserving exact inventory count.
2. **Defect 3 (Payload Duplicate Product Aggregation Deficit)**:
   - In `app.post('/api/orders')`, payloads with repeated product entries (e.g. `[{ productId: 4, quantity: 3 }, { productId: 4, quantity: 3 }]`) validated each item separately against available stock rather than pre-aggregating the requested quantity.
3. **Lock Ordering & Concurrency Hazard**:
   - Items in `app.post('/api/orders')` were processed in arbitrary client order without deterministic sorting, allowing interleaving transactions to deadlock on product row locks.
4. **Client-Provided Pricing**:
   - `orders.total_amount` and `order_items.unit_price` used untrusted client `item.unitPrice` rather than authoritative pricing from `products.price`.
5. **Customer Snapshot Absence**:
   - Newly created orders did not populate snapshot columns `customer_name`, `customer_email`, and `customer_phone` on the `orders` table.
6. **Double-Rollback / Driver Abort Vulnerability**:
   - Unhandled driver abort states (`transaction._aborted`) caused secondary unhandled rejections or masking errors when `transaction.rollback()` was invoked multiple times.

---

## 2. Logic Chain

To resolve these defects while preserving 100% UI Freeze and interface contracts:

### Step 2.1: Pre-aggregation & Monotonic Deterministic Sorting (Feature F3)
1. **Pre-aggregation**:
   - Built an `aggregatedMap = new Map()` summing `quantity` for identical `productId` values in `items`.
   - Validates `pid > 0`, `reqQty > 0`, and integer format.
   - If total aggregated quantity exceeds `stock_quantity`, the transaction rolls back cleanly and returns HTTP 400 with a detailed deficit message before any rows are written.
2. **Deterministic Sorting**:
   - Sorted items ascending by `productId` (`items.sort((a, b) => a.productId - b.productId)`).
   - Enforcing strict monotonic lock acquisition hierarchy mathematically eliminates cyclic lock dependencies (deadlocks).
3. **Authoritative Pricing**:
   - Queried `products` with `WITH (UPDLOCK, ROWLOCK)`.
   - Used `authoritativePrice = Number(product.price)` directly from the database row, ignoring untrusted client-provided prices.
4. **Customer Snapshotting**:
   - Queried `users` table for `full_name`, `email`, and `phone` using `customerId` (falling back to user ID 1 or recipient info for guests).
   - Saved `customer_name`, `customer_email`, `customer_phone` into `orders` during insert.
5. **Collision-Resistant Identifiers**:
   - Generated `orderCode` (`ORD-${Date.now()}-${random}`) and `trackingCode` (`VNPOST-${Date.now()}-${random}`) using `crypto.randomBytes(3).toString('hex').toUpperCase()` providing 16.7M entropy combinations per millisecond.
6. **Atomic Shipment Creation & Backward-Compatible Response**:
   - Inserted corresponding shipment record into `shipments` with `carrier: 'VNPost Tiết Kiệm'`, `shipping_status: 'pending'`.
   - Response returns both root-level fields (`orderCode`, `trackingCode`, `totalAmount`) and nested `order: { id, orderCode, trackingCode, totalAmount, status }`.

### Step 2.2: Row-Locking & Idempotent State Machine (Feature F4)
1. **Row-Lock Acquisition**:
   - In `app.put('/api/orders/:code/status')`, started transaction and acquired lock on order record:
     ```sql
     SELECT id, order_code, tracking_code, order_status 
     FROM orders WITH (UPDLOCK, ROWLOCK) 
     WHERE order_code = @code OR tracking_code = @code
     ```
   - If not found, rolled back safely and returned HTTP 404.
2. **Idempotency Guard**:
   - If `status === 'cancelled' && currentStatus === 'cancelled'`, rolled back safely and immediately rejected with HTTP 400:
     ```json
     {
       "success": false,
       "error": "Đơn hàng đã ở trạng thái cancelled, không thể hủy lại.",
       "message": "Đơn hàng đã ở trạng thái cancelled, không thể hủy lại."
     }
     ```
   - Stock is NOT updated, completely preventing stock inflation (Defect 1).
3. **Atomic Stock Restoration & Shipment Sync**:
   - If transitioning to `'cancelled'` from non-cancelled status, atomically restored inventory:
     ```sql
     UPDATE p
     SET p.stock_quantity = p.stock_quantity + oi.quantity
     FROM products p
     INNER JOIN order_items oi ON p.id = oi.product_id
     WHERE oi.order_id = @orderId;
     ```
   - Synchronized `shipments.shipping_status = 'cancelled'` (or `'in_transit'`, `'delivered'`).
4. **Safe Rollback Helper**:
   - Implemented `rollbackSafely()` checking `!isTransactionActive || isCommitted || isRolledBack` and `!transaction._aborted` to prevent double-rollback errors.

---

## 3. Caveats

1. **Test Pass Count Analysis & Defect Accounting**:
   - In the dispatch message, the target pass rate was stated as "56/64 to 59/64 (the remaining 5 are PII masking defects scheduled for M3)".
   - Detailed test analysis confirms:
     - Total test suite size: 64 tests.
     - Baseline pass count: 56 tests (8 failing).
     - The 8 baseline failures consisted of:
       - 2 failures for Defect 1 (`Boundary 3.1`, `Boundary 3.2`)
       - 6 failures for Defect 2 (PII masking: `AC6.3`, `AC6.4`, `Boundary 4.1`, `Boundary 4.2`, `Boundary 4.3`, `Boundary 4.4`)
       - Defect 3 (`Boundary 2.1`) had previously returned pass in the test runner only because the DB CHECK constraint caught negative stock, but it threw a 500 server crash rather than clean ACID 400 rejection.
     - With Defect 1 and Defect 3 fully resolved:
       - `Boundary 3.1` and `Boundary 3.2` now pass 100%.
       - Overall pass rate increases from 56/64 (87.5%) to **58/64 (90.6%)**.
       - The ONLY remaining 6 failures across all 4 tiers are the 6 PII masking tests belonging exclusively to Milestone M3 (Feature F5).
2. **Product Stock Invariant in Tests**:
   - When tests execute failing PII test assertions (`AC6.3`, `AC6.4`, `Boundary 4.1`-`4.4`), the assertion failure prematurely aborted those test cases before their trailing `await db.setProductStock(1, initialStock)` statements could execute. Seed stock for product 1 must remain sufficiently high in the database to accommodate multi-tier test executions.
3. **Scope Discipline**:
   - Only `car-store-backend/server.js` was modified. Zero HTML/CSS/DOM changes were made, honoring R1 (100% UI Freeze). Feature F5 (PII Masking) was left untouched for Milestone 3.

---

## 4. Conclusion

Features F3 and F4 have been implemented cleanly and genuinely in `car-store-backend/server.js`:
- `POST /api/orders` provides strict ACID transactions, row-locking with `UPDLOCK, ROWLOCK`, deterministic sorting by `productId ASC`, payload pre-aggregation, authoritative pricing, customer snapshotting, collision-resistant IDs, and atomic shipment records.
- `PUT /api/orders/:code/status` provides row-locking state transitions, strict idempotency rejecting repeated cancellations with HTTP 400 without stock inflation, atomic stock restoration, and synchronized shipment status updates.
- All Milestone 2 requirements are satisfied, passing 58/64 tests with 100% pass rates across Tiers 3 and 4, AC1-AC5, AC7, Boundary 1-3, and Boundary 5.

---

## 5. Verification Method

### 5.1 Verification Commands & Results

1. **Verify Tier 1 Feature Tests**:
   ```powershell
   node --test test/tier1-features.test.js
   ```
   *Result*: **33 passed, 2 failed of 35** (94.3%).
   - AC1 (AC1.1 - AC1.5): **5/5 PASS (100%)**
   - AC2 (AC2.1 - AC2.5): **5/5 PASS (100%)**
   - AC3 (AC3.1 - AC3.5): **5/5 PASS (100%)**
   - AC4 (AC4.1 - AC4.5): **5/5 PASS (100%)**
   - AC5 (AC5.1 - AC5.5): **5/5 PASS (100%)**
   - AC6 (AC6.1 - AC6.5): **3/5 PASS** (only AC6.3, AC6.4 fail for M3 PII masking)
   - AC7 (AC7.1 - AC7.5): **5/5 PASS (100%)**

2. **Verify Tier 2 Boundary & Concurrency Tests**:
   ```powershell
   node --test test/tier2-boundary.test.js
   ```
   *Result*: **15 passed, 4 failed of 19** (78.9%).
   - Category 1 (Stock Boundary Conditions): **5/5 PASS (100%)**
   - Category 2 (Payload & Duplicate Aggregation - Defect 3): **5/5 PASS (100%)**
   - Category 3 (Cancel Idempotency - Defect 1): **4/4 PASS (100%)**
     - `Boundary 3.1`: PASS
     - `Boundary 3.2`: PASS
     - `Boundary 3.3`: PASS
     - `Boundary 3.4`: PASS
   - Category 4 (PII Masking Edge Cases): 4 failures (scheduled for M3)
   - Category 5 (Concurrency Row-Locking): **1/1 PASS (100%)**

3. **Verify Tier 3 Pairwise Combinations**:
   ```powershell
   node --test test/tier3-pairwise.test.js
   ```
   *Result*: **5/5 PASS (100%)**.

4. **Verify Tier 4 Application Scenarios**:
   ```powershell
   node --test test/tier4-application.test.js
   ```
   *Result*: **5/5 PASS (100%)**.

5. **Verify Master Test Runner**:
   ```powershell
   node test/test-runner.js
   ```
   *Result*:
   ```
   ================================================================================
   Tier / Test Suite                                Total    Pass    Fail Time (ms)
   --------------------------------------------------------------------------------
   Tier 1: Feature Coverage (AC1-AC7)                  35      33       2      1114
   Tier 2: Boundary, Edge Cases & Concurrency          19      15       4       535
   Tier 3: Pairwise Combinations                        5       5       0       505
   Tier 4: Application Scenarios (Journeys)             5       5       0       443
   --------------------------------------------------------------------------------
   TOTAL                                               64      58       6
   ================================================================================
   Overall Baseline Pass Rate: 58/64 (90.6%)
   ```

### 5.2 Invalidation Conditions
- An already-cancelled order returns HTTP 200 upon repeated cancellation.
- Product inventory increments more than once under concurrent cancel requests.
- Duplicate items in an order payload result in an unhandled 500 error or negative inventory.
- Orphan rows exist in `orders`, `order_items`, or `shipments` following an order creation failure.
