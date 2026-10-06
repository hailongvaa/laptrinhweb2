# Independent Review & Adversarial Evaluation: Milestone 2 (Worker M2-1)

**Reviewer Agent**: teamwork_preview_reviewer_m2_2 (Reviewer M2-2)  
**Roles**: Reviewer, Adversarial Critic  
**Working Directory**: `d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_reviewer_m2_2`  
**Verdict**: **APPROVE**  
**Integrity Audit**: **PASS** (Zero integrity violations, genuine logic, zero hardcoded facade mocks)  

---

## 1. Observation

Direct examination of `car-store-backend/server.js`, `PROJECT.md`, `TEST_READY.md`, Worker M2-1's `handoff.md`, and independent execution of the test suite yielded the following direct observations:

### 1.1 Interface Contract Conformance (`PROJECT.md` § 4.2 & § 4.3)
1. **Order Creation (`POST /api/orders`)**:
   - `server.js` (lines 550–821):
     - Line 562–580: Validates input parameters (`recipientName`, `recipientPhone`, `shippingAddress`, non-empty `items` array). Returns HTTP 400 on missing or invalid payload.
     - Line 583–609: Pre-aggregates requested quantities by `productId` via `Map`, rejecting negative/zero/non-numeric values with HTTP 400.
     - Line 612: Sorts items ascending by `productId` (`items.sort((a, b) => a.productId - b.productId)`) before acquiring row locks.
     - Line 640–674: Queries customer details from `users` and snapshots `customer_name`, `customer_email`, and `customer_phone` into `orders`.
     - Line 683: Acquires row-level update locks using `SELECT id, name, stock_quantity, price FROM products WITH (UPDLOCK, ROWLOCK) WHERE id = @pid`.
     - Line 698–705: Compares available stock against aggregated requested quantity. If deficient, rolls back cleanly and returns HTTP 400 with `error: "Sản phẩm Ferrari 488 GTB chỉ còn 1 chiếc trong kho (yêu cầu 2)."` exactly following `PROJECT.md § 4.2`.
     - Line 708–710: Authoritative pricing is enforced (`authoritativePrice = Number(product.price)`), ignoring untrusted client-supplied prices.
     - Line 720–725: Generates collision-resistant codes (`ORD-${Date.now()}-${randomBytes(3).hex}` and `VNPOST-${Date.now()}-${randomBytes(3).hex}`).
     - Line 741–784: Inserts atomic records into `orders`, `order_items`, updates `products.stock_quantity`, and inserts into `shipments`.
     - Line 793–807: Returns HTTP 201 Created with `{ success: true, order: { id, orderCode, trackingCode, totalAmount, status: 'pending' } }`, matching the contract payload.
2. **Order Status Update & Cancellation (`PUT /api/orders/:code/status`)**:
   - `server.js` (lines 394–547):
     - Line 406–413: Validates status against `['pending', 'confirmed', 'shipping', 'delivered', 'completed', 'cancelled']`. Returns HTTP 400 on invalid status.
     - Line 447–450: Queries order with `SELECT id, order_code, tracking_code, order_status FROM orders WITH (UPDLOCK, ROWLOCK) WHERE order_code = @code OR tracking_code = @code`. Returns HTTP 404 if not found.
     - Line 468–475: **Idempotency Guard**: If `status === 'cancelled' && currentStatus === 'cancelled'`, rolls back and immediately returns HTTP 400 with `{ success: false, error: 'Đơn hàng đã ở trạng thái cancelled, không thể hủy lại.' }` without touching stock.
     - Line 480–491: If transitioning from active status to `'cancelled'`, restores product inventory via `UPDATE p SET p.stock_quantity = p.stock_quantity + oi.quantity FROM products p INNER JOIN order_items oi ON p.id = oi.product_id WHERE oi.order_id = @orderId`.
     - Line 505–518: Synchronizes shipment status in `shipments` (`'in_transit'`, `'delivered'`, or `'cancelled'`).
     - Line 524–533: Returns HTTP 200 with `{ success: true, message: ..., orderCode, trackingCode, status, previousStatus, newStatus, stockRestored }`.

### 1.2 Transaction Safety, Rollback Guard, and Exception Handling
- In both `app.post('/api/orders')` and `app.put('/api/orders/:code/status')`:
  - `rollbackSafely()` helper encapsulates:
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
  - Prevents secondary crashes from unhandled rejections if the driver has already aborted the transaction (`transaction._aborted`).
  - Guards against double-rollback when multiple failure triggers occur.
  - Commits atomically with `await transaction.commit()`, setting `isCommitted = true` and `isTransactionActive = false`.

### 1.3 SQL Parameterization and Injection Safety
- Audited all SQL statements across `car-store-backend/server.js`:
  - All dynamic values use `request.input(...)` with explicit types (`sql.Int`, `sql.VarChar`, `sql.NVarChar`, `sql.Decimal`).
  - Zero raw string concatenation into SQL statements.
  - Full parameterization verified across routes: `/api/orders`, `/api/orders/:code/status`, `/api/auth/register`, `/api/auth/login`, `/api/tracking/:code`, `/api/products`, `/api/products/:id`.

### 1.4 Test Suite Execution Results
- Executing `node --test test/tier1-features.test.js`:
  - **33 passed, 2 failed of 35** (94.3% Pass Rate).
  - AC1 (AC1.1 - AC1.5): **5/5 PASS (100%)**
  - AC2 (AC2.1 - AC2.5): **5/5 PASS (100%)**
  - AC3 (AC3.1 - AC3.5): **5/5 PASS (100%)**
  - AC4 (AC4.1 - AC4.5): **5/5 PASS (100%)**
  - AC5 (AC5.1 - AC5.5): **5/5 PASS (100%)**
  - AC6 (AC6.1, AC6.2, AC6.5): **3/3 PASS** (AC6.3 and AC6.4 fail as expected for Milestone 3 PII Masking)
  - AC7 (AC7.1 - AC7.5): **5/5 PASS (100%)**
- Executing `node --test test/tier2-boundary.test.js`:
  - **15 passed, 4 failed of 19** (78.9% Pass Rate).
  - Category 1 (Stock Boundary): **5/5 PASS (100%)**
  - Category 2 (Payload & Duplicate Aggregation): **5/5 PASS (100%)**
  - Category 3 (Cancel Idempotency): **4/4 PASS (100%)**
  - Category 4 (PII Masking Edge Cases): 4 failed as expected for Milestone 3.
  - Category 5 (Concurrency & Row Locking): **1/1 PASS (100%)** (`Boundary 5.1` confirms 3 concurrent orders competing for 1 stock serialize correctly: 1 succeeds, 2 fail with HTTP 400, stock never drops below 0).
- Executing `node --test test/tier3-pairwise.test.js`:
  - **5/5 PASS (100%)**
- Executing `node --test test/tier4-application.test.js`:
  - **5/5 PASS (100%)**

---

## 2. Logic Chain

1. **Defect 1 (Cancel Idempotency & Stock Inflation)**:
   - Observation: Baseline defect allowed repeated cancellations of an already-cancelled order to return HTTP 200 and multiply product stock.
   - Evidence in Code: Line 468 inspects `currentStatus` under `UPDLOCK, ROWLOCK`. If `status === 'cancelled' && currentStatus === 'cancelled'`, the transaction rolls back cleanly and returns HTTP 400.
   - Test Evidence: `Boundary 3.1` and `Boundary 3.2` pass 100%. Repeating or concurrent cancel requests restore stock exactly once.
   - Inference: Defect 1 is completely resolved.

2. **Defect 3 (Payload Duplicate Product Aggregation)**:
   - Observation: Baseline allowed `[{ productId: 4, quantity: 3 }, { productId: 4, quantity: 3 }]` to bypass stock checks because each was validated separately.
   - Evidence in Code: Lines 583–609 construct an aggregated quantity map prior to database queries.
   - Test Evidence: `Boundary 2.1` passes 100%, rejecting duplicate entries that collectively exceed available stock with clean HTTP 400.
   - Inference: Defect 3 is completely resolved.

3. **Concurrency & Deadlock Prevention**:
   - Observation: Concurrent multi-item orders locking rows in random order can cause circular wait (deadlock 1205).
   - Evidence in Code: Line 612 sorts items monotonically by `productId ASC`. Lock acquisition is strictly serialized in ascending key order.
   - Test Evidence: `Boundary 5.1` and `AC2.3-2.5` execute without deadlock or concurrency failures.
   - Inference: Lock hierarchy guarantees deadlock-freedom among order placement transactions.

4. **Integrity & Genuineness**:
   - Observation: No test mocks, fake return values, or shortcuts exist in `server.js`. Database operations query actual Microsoft SQL Server tables (`orders`, `order_items`, `shipments`, `products`, `users`).
   - Inference: Zero integrity violations. Work is genuine and fully compliant with project guidelines.

---

## 3. Caveats

1. **Test Suite Stock Leakage on Failing PII Assertions**:
   - In `tier1-features.test.js` (`AC6.3`, `AC6.4`) and `tier2-boundary.test.js` (`Boundary 4.1`–`4.4`), tests create orders for product 1 and then assert PII masking (`assert.match(data.recipient_name, /\*/)`). Because PII masking is scheduled for Milestone 3, these assertions fail before reaching the inline `await db.setProductStock(1, initialStock)`.
   - Although `db.cleanupOrders` deletes the order records in the `after()` hook, it does not restore the deducted stock. Consequently, running test suites repeatedly without re-seeding product 1 stock (initial stock = 15) gradually drains product 1 down to 0, which would cause subsequent unrelated tests to fail with out-of-stock HTTP 400.
   - Implementers in Milestone 3 must complete PII masking (Feature F5) so that all tests pass without aborting prematurely, ensuring stock restoration hooks execute.
2. **Local ODBC Connection Pool Sizing**:
   - In local development using `msnodesqlv8` (ODBC Driver 17), `DB_POOL_MAX` defaults to 10 connections. High-burst concurrent tests (such as `AC7.3` issuing 15 concurrent requests) can saturate the local pool if connections are held. In serverless/cloud TDS deployments, pool management is isolated per invocation.

---

## 4. Conclusion

**Verdict: APPROVE**

Milestone 2 (Features F3 & F4) in `car-store-backend/server.js` successfully satisfies all requirements and architectural constraints:
- Conforms 100% to interface contracts defined in `PROJECT.md` § 4.2 & § 4.3.
- Implements strict ACID transactions with row-level update locking (`UPDLOCK, ROWLOCK`), deterministic ascending lock ordering (`productId ASC`), pre-aggregated cart item validation, authoritative database pricing, and customer snapshotting.
- Eliminates inventory inflation via strict cancellation idempotency.
- Robust exception handling and rollback safety guards against driver abortion errors.
- 100% parameterized SQL queries protect against SQL injection.
- Zero UI/DOM/CSS modifications, upholding R1 (100% UI Freeze).
- Test results confirm 58/64 passing tests across the 4-tier suite, with 100% pass rates across all Milestone 2 targets. The only 6 remaining failures are the PII masking tests belonging strictly to Milestone 3 (Feature F5).

---

## 5. Verification Method

### 5.1 Verification Commands
Run the following commands from the repository root:

1. **Verify Feature Conformance (Tier 1)**:
   ```powershell
   node --test test/tier1-features.test.js
   ```
   *Expected Outcome*: 33 passed, 2 failed of 35 (the 2 failures are AC6.3 and AC6.4 for M3 PII masking).

2. **Verify Boundary, Concurrency & Idempotency (Tier 2)**:
   ```powershell
   node --test test/tier2-boundary.test.js
   ```
   *Expected Outcome*: 15 passed, 4 failed of 19 (the 4 failures are Boundary 4.1–4.4 for M3 PII masking). Category 3 (Cancel Idempotency) passes 4/4 (100%).

3. **Verify Pairwise Combinations (Tier 3)**:
   ```powershell
   node --test test/tier3-pairwise.test.js
   ```
   *Expected Outcome*: 5/5 passed (100%).

4. **Verify Real-World User Journeys (Tier 4)**:
   ```powershell
   node --test test/tier4-application.test.js
   ```
   *Expected Outcome*: 5/5 passed (100%).

### 5.2 Invalidation Conditions
- Any order cancellation of an already-cancelled order returns HTTP 200 or modifies `products.stock_quantity`.
- Order creation allows total requested quantity of repeated product IDs to exceed current available inventory.
- Concurrent order placement causes unhandled deadlock exceptions (SQL Server 1205) or negative stock.
- Any unparameterized SQL statement is introduced into database queries.
