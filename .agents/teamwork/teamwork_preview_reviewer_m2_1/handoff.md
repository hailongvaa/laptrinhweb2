# Review & Adversarial Critic Report: Milestone 2 — ACID Transactions & State Machine (Features F3 & F4)

**Agent ID**: teamwork_preview_reviewer_m2_1 (Reviewer M2-1)  
**Roles**: Reviewer, Adversarial Critic  
**Target Code**: `car-store-backend/server.js`  
**Worker Deliverable**: `teamwork_preview_worker_m2_1/handoff.md`  
**Verdict**: **APPROVE**  
**Overall Test Score**: **58 / 64 (90.6% Passing)** (the remaining 6 are exclusively PII masking tests belonging to Milestone M3)

---

## 1. Observation

### 1.1 Direct Source Code Inspection (`car-store-backend/server.js`)

1. **Pre-aggregation of duplicate cart items (Feature F3 / Defect 3 Resolution)**:
   - Location: lines 582–609.
   - Code directly observes:
     ```javascript
     const aggregatedMap = new Map();
     for (const item of items) {
         ...
         const pid = parseInt(item.productId, 10);
         const reqQty = parseInt(item.quantity, 10);
         ...
         if (aggregatedMap.has(pid)) {
             aggregatedMap.get(pid).quantity += reqQty;
         } else {
             aggregatedMap.set(pid, { productId: pid, quantity: reqQty });
         }
     }
     ```
   - Validates positive integers, prevents string fractions (`String(item.quantity).trim() !== String(reqQty)`), and sums quantity per unique `productId` before inventory validation or locking.

2. **Deterministic lock ordering (Deadlock Prevention)**:
   - Location: line 612.
   - Code directly observes:
     ```javascript
     const sortedItems = Array.from(aggregatedMap.values()).sort((a, b) => a.productId - b.productId);
     ```
   - Items are sorted in strict ascending order by `productId`, enforcing a monotonic lock acquisition hierarchy across all concurrent transactions.

3. **Row-locking & Authoritative Database Pricing**:
   - Location: lines 680–717.
   - Code directly observes:
     ```javascript
     const checkReq = new sql.Request(transaction);
     const checkRes = await checkReq
         .input('pid', sql.Int, item.productId)
         .query(`SELECT id, name, stock_quantity, price FROM products WITH (UPDLOCK, ROWLOCK) WHERE id = @pid`);
     ...
     const authoritativePrice = Number(product.price);
     totalAmount += (authoritativePrice * item.quantity);
     ```
   - Row-level update lock (`WITH (UPDLOCK, ROWLOCK)`) is held until transaction commit/rollback. Client-provided `item.unitPrice` is completely ignored; pricing is derived strictly from the locked database record.

4. **Customer Snapshotting**:
   - Location: lines 640–674 and lines 727–750.
   - Code directly observes:
     - Customer details (`full_name`, `email`, `phone`) are queried from `users` (falling back to user id 1 / guest details).
     - Persisted directly into `orders` columns: `customer_name`, `customer_email`, `customer_phone`.

5. **Collision-Resistant Identifier Generation**:
   - Location: lines 720–725.
   - Generates `orderCode` (`ORD-${timestamp}-${orderRand}`) and `trackingCode` (`VNPOST-${timestamp}-${trackRand}`) using `crypto.randomBytes(3).toString('hex').toUpperCase()`.

6. **Order Cancellation Row-Lock & Double-Cancel Rejection (Feature F4 / Defect 1 Resolution)**:
   - Location: lines 442–476.
   - Code directly observes:
     ```javascript
     const findReq = new sql.Request(transaction);
     const findRes = await findReq
         .input('code', sql.VarChar(50), cleanCode)
         .query(`
             SELECT id, order_code, tracking_code, order_status 
             FROM orders WITH (UPDLOCK, ROWLOCK) 
             WHERE order_code = @code OR tracking_code = @code
         `);
     ...
     if (status === 'cancelled' && currentStatus === 'cancelled') {
         await rollbackSafely();
         return res.status(400).json({
             success: false,
             error: 'Đơn hàng đã ở trạng thái cancelled, không thể hủy lại.',
             message: 'Đơn hàng đã ở trạng thái cancelled, không thể hủy lại.'
         });
     }
     ```
   - Acquires `UPDLOCK, ROWLOCK` on the order record. If order is already `cancelled`, rolls back safely and immediately returns HTTP 400. Stock update query is NOT executed, eliminating stock inflation.

7. **Atomic Stock Restoration & Shipment Synchronization**:
   - Location: lines 478–519.
   - Restores stock via `UPDATE p SET p.stock_quantity = p.stock_quantity + oi.quantity FROM products p INNER JOIN order_items oi ON p.id = oi.product_id WHERE oi.order_id = @orderId`.
   - Synchronizes `shipments.shipping_status = 'cancelled'`.

8. **Driver-Safe Rollback Handler**:
   - Location: lines 424–436 and lines 622–634.
   - Checks `!isTransactionActive || isCommitted || isRolledBack` and `!transaction._aborted` before calling `transaction.rollback()`.

---

## 2. Independent Test Verification

### 2.1 Execution Results

1. **Master Test Runner (`node test/test-runner.js`)**:
   ```
   ======================================================================
      CarModelStore E2E 4-Tier Test Runner (Node.js v24 Native)
   ======================================================================

   [1/3] Checking server & database status...
   [INFO] Server active at: http://localhost:5000 (Spawned: false)

   [2/3] Executing 4-Tier Test Suites in sequence...

   Running Tier 1: Feature Coverage (AC1-AC7) [test/tier1-features.test.js]... BASELINE FAILURES DETECTED (33 passed, 2 failed of 35 in 1342ms)
   Running Tier 2: Boundary, Edge Cases & Concurrency [test/tier2-boundary.test.js]... BASELINE FAILURES DETECTED (15 passed, 4 failed of 19 in 1630ms)
   Running Tier 3: Pairwise Combinations [test/tier3-pairwise.test.js]... PASSED (5/5 tests in 1618ms)
   Running Tier 4: Application Scenarios (Journeys) [test/tier4-application.test.js]... PASSED (5/5 tests in 1628ms)

   [3/3] Execution Summary Table:
   --------------------------------------------------------------------------------
   Tier / Test Suite                                Total    Pass    Fail Time (ms)
   --------------------------------------------------------------------------------
   Tier 1: Feature Coverage (AC1-AC7)                  35      33       2      1342
   Tier 2: Boundary, Edge Cases & Concurrency          19      15       4      1630
   Tier 3: Pairwise Combinations                        5       5       0      1618
   Tier 4: Application Scenarios (Journeys)             5       5       0      1628
   --------------------------------------------------------------------------------
   TOTAL                                               64      58       6
   ================================================================================

   Overall Baseline Pass Rate: 58/64 (90.6%)
   ```

2. **Analysis of the 6 Remaining Failures**:
   - `Tier 1`: `AC6.3` (Recipient name masked with `*`), `AC6.4` (Recipient phone masked with `*`).
   - `Tier 2`: `Boundary 4.1` (Single-word name masking), `Boundary 4.2` (Two-word name masking), `Boundary 4.3` (Phone masking), `Boundary 4.4` (Address street masking).
   - **All 6 failing tests belong exclusively to Milestone 3 / Feature F5 (PII Masking)**, as documented in `PROJECT.md § 2` and `TEST_READY.md § 5`.
   - **Zero tests failed in Milestone 2 scope**. All ACID transaction, row-locking, out-of-stock rejection, cancellation idempotency, inventory restoration, and concurrency tests passed 100%.

---

## 3. Adversarial Critic & Forensic Audit

### 3.1 Integrity Violation Check (Zero Violations Confirmed)
- **Hardcoded test outputs**: None found. All endpoints execute parameterized SQL against SQL Server and return live database data.
- **Dummy or facade implementations**: None found. Full ACID transactions (`new sql.Transaction`), lock hints (`UPDLOCK, ROWLOCK`), and rollback error handling are fully operational.
- **Shortcuts / Task Bypassing**: None found.
- **Fabricated verification logs**: None found. The worker's reported pass count of 58/64 was independently reproduced and verified to the exact test case.
- **UI Freeze Compliance (R1)**: Strictly preserved. Only `car-store-backend/server.js` was modified; zero HTML/CSS/DOM files were touched.

### 3.2 Adversarial Stress Tests
1. **Deadlock Elimination**:
   - Evaluated concurrent multi-item orders with inverse orderings (e.g. `[1, 5]` vs `[5, 1]`).
   - Monotonic `productId ASC` sorting mathematically guarantees that all transactions acquire locks in identical key order, eliminating circular wait conditions (`Coffman Condition 4`).
2. **Double-Cancel Race Condition**:
   - Stress-tested rapid concurrent cancellation requests (`Boundary 3.2`).
   - The first request acquires `UPDLOCK, ROWLOCK`, transitions the order status to `cancelled`, and commits stock return.
   - Interleaved requests acquire the lock after commit, detect `currentStatus === 'cancelled'`, abort cleanly without touching stock, and return HTTP 400. Stock inflation is 100% prevented.
3. **Price Manipulation**:
   - Attempted payload tampering with client-specified `unitPrice: 0` or negative values.
   - Server ignores client price input and reads authoritative `products.price` under `UPDLOCK, ROWLOCK`.
4. **Duplicate Item Quantity Deficit (Defect 3)**:
   - Validated cart payloads containing multiple entries of identical `productId` (`Boundary 2.1`).
   - `aggregatedMap` accumulates total demanded quantity and validates against available inventory prior to acquiring modification locks.

---

## 4. Caveats

1. **Test Suite Stock Leakage from Incomplete Milestone 3 Tests**:
   - In `test/tier1-features.test.js` (`AC6.3`, `AC6.4`) and `test/tier2-boundary.test.js` (`Boundary 4.1` - `4.4`), assertions for PII masking throw an error BEFORE `await db.setProductStock(1, initialStock)` can execute.
   - Consequently, each run of Tier 1 leaks 2 units of Product 1 stock, and each run of Tier 2 leaks 4 units of Product 1 stock.
   - Initial stock for Product 1 must be maintained above 15 (e.g. 50 or 100) when executing multiple consecutive runs. Once Milestone 3 implements PII masking, these assertions will pass and restore stock cleanly.
2. **Node.js v24 `msnodesqlv8` Concurrency on Windows**:
   - Forceful aborts of Node processes with active ODBC connection pools can cause a libuv assertion (`!(handle->flags & UV_HANDLE_CLOSING)`) on Windows. Running the test runner as designed via `node test/test-runner.js` against the long-lived singleton connection pool executes cleanly.

---

## 5. Conclusion & Verdict

**Verdict**: **APPROVE**

Worker M2-1 has implemented Features F3 and F4 with exceptional technical rigor:
- `POST /api/orders` provides strict ACID transactions, duplicate payload pre-aggregation, deterministic ascending row-locking, authoritative DB pricing, customer snapshotting, and collision-resistant identifiers.
- `PUT /api/orders/:code/status` provides row-locked state transitions, idempotent cancellation rejecting repeated cancels with HTTP 400 without inventory inflation, and synchronized shipment cancellation.
- 58 of 64 test cases pass (90.6%), with 100% pass rates across Tiers 3, 4, AC1–AC5, AC7, and Boundary categories 1, 2, 3, and 5. The only remaining 6 failures are scheduled for Milestone 3 (PII masking).

---

## 6. Verification Method

To independently reproduce this verification:
1. Ensure Product 1 has adequate seed stock:
   ```powershell
   node -e "const db = require('./test/helpers/db'); db.setProductStock(1, 100).then(() => db.close());"
   ```
2. Execute the Master Test Runner:
   ```powershell
   node test/test-runner.js
   ```
3. Observe 58 / 64 tests passing (90.6%), with zero failures in Milestone 2 scope.
