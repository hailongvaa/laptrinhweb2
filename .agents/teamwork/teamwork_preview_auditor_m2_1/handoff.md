# Forensic Audit Report: Milestone 2 — ACID Transactions & State Machine Integrity

**Auditor**: Forensic Auditor M2-1 (`teamwork_preview_auditor_m2_1`)  
**Work Product**: `car-store-backend/server.js`  
**Profile**: General Project  
**Integrity Mode**: `development` (per `ORIGINAL_REQUEST.md`)  
**Verdict**: **CLEAN**

---

## 1. Observation

### 1.1 Source Code Static Analysis (`car-store-backend/server.js`)
Direct inspection of `car-store-backend/server.js` confirms:
1. **Order Cancellation Endpoint (`PUT /api/orders/:code/status`, lines 394–547)**:
   - Starts genuine SQL transaction:
     ```javascript
     const transaction = new sql.Transaction(pool);
     await transaction.begin();
     ```
   - Acquires row lock using `UPDLOCK, ROWLOCK`:
     ```sql
     SELECT id, order_code, tracking_code, order_status 
     FROM orders WITH (UPDLOCK, ROWLOCK) 
     WHERE order_code = @code OR tracking_code = @code
     ```
   - Enforces idempotent rejection for double cancellation:
     ```javascript
     if (status === 'cancelled' && currentStatus === 'cancelled') {
         await rollbackSafely();
         return res.status(400).json({
             success: false,
             error: 'Đơn hàng đã ở trạng thái cancelled, không thể hủy lại.',
             message: 'Đơn hàng đã ở trạng thái cancelled, không thể hủy lại.'
         });
     }
     ```
   - Restores stock conditionally upon first transition to `'cancelled'`:
     ```sql
     UPDATE p
     SET p.stock_quantity = p.stock_quantity + oi.quantity
     FROM products p
     INNER JOIN order_items oi ON p.id = oi.product_id
     WHERE oi.order_id = @orderId;
     ```
   - Atomically updates shipment record:
     ```sql
     UPDATE shipments
     SET shipping_status = @shipStatus, updated_at = GETDATE()
     WHERE order_id = @orderId;
     ```
   - Commits transaction via `await transaction.commit()`.

2. **Order Creation Endpoint (`POST /api/orders`, lines 550–821)**:
   - Validates input format and pre-aggregates requested quantities by `productId` using `Map` (lines 583–609).
   - Enforces deterministic monotonic lock ordering by sorting items ascending by `productId`:
     ```javascript
     const sortedItems = Array.from(aggregatedMap.values()).sort((a, b) => a.productId - b.productId);
     ```
   - Queries products with row lock and reads authoritative price from database:
     ```sql
     SELECT id, name, stock_quantity, price FROM products WITH (UPDLOCK, ROWLOCK) WHERE id = @pid
     ```
   - Atomically snapshots customer identity (`customer_name`, `customer_email`, `customer_phone`) to `orders`.
   - Generates collision-resistant identifiers using `crypto.randomBytes(3).toString('hex').toUpperCase()`:
     - `orderCode`: `ORD-${timestamp}-${orderRand}`
     - `trackingCode`: `VNPOST-${timestamp}-${trackRand}`
   - Inserts into `orders`, inserts into `order_items`, decrements `products.stock_quantity`, and inserts into `shipments` in a single atomic transaction.

3. **Absence of Prohibited Patterns**:
   - Grep search for `Ferrari`, `NODE_ENV === 'test'`, `mock`, `fake`, `bypass`, `dummy` in `car-store-backend/server.js` yielded 0 matches.
   - All response messages dynamically incorporate runtime database variables (`product.name`, `availableStock`, `item.quantity`). Zero hardcoded outputs exist.

### 1.2 Test Suite Non-Tampering Verification
- Inspection of `test/` directory timestamps via PowerShell `Get-ChildItem -Recurse test | Select-Object FullName, LastWriteTime, Length`:
  ```
  D:\laptrinhweb - Copy\test\test-runner.js            10/7/2026 2:28:17 AM
  D:\laptrinhweb - Copy\test\tier1-features.test.js    10/7/2026 2:24:42 AM
  D:\laptrinhweb - Copy\test\tier2-boundary.test.js    10/7/2026 2:27:58 AM
  D:\laptrinhweb - Copy\test\tier3-pairwise.test.js    10/7/2026 2:26:50 AM
  D:\laptrinhweb - Copy\test\tier4-application.test.js 10/7/2026 2:27:28 AM
  D:\laptrinhweb - Copy\test\helpers\api.js            10/7/2026 2:22:26 AM
  D:\laptrinhweb - Copy\test\helpers\config.js         10/7/2026 2:21:45 AM
  D:\laptrinhweb - Copy\test\helpers\db.js             10/7/2026 2:21:54 AM
  D:\laptrinhweb - Copy\test\helpers\server.js         10/7/2026 2:22:05 AM
  ```
  `car-store-backend/server.js` was modified at `10/7/2026 3:09:55 AM`.
- All test files predate the Worker M2 modifications by >40 minutes. Zero test files were modified or tampered with.

### 1.3 Behavioral & Independent Test Execution
1. Execution of individual test tiers:
   - `node --test test/tier1-features.test.js`: **33 passed, 2 failed of 35**
     - AC1 (AC1.1–AC1.5): **5/5 PASS (100%)**
     - AC2 (AC2.1–AC2.5): **5/5 PASS (100%)**
     - AC3 (AC3.1–AC3.5): **5/5 PASS (100%)**
     - AC4 (AC4.1–AC4.5): **5/5 PASS (100%)**
     - AC5 (AC5.1–AC5.5): **5/5 PASS (100%)**
     - AC6 (AC6.1, AC6.2, AC6.5): **3/5 PASS** (AC6.3, AC6.4 fail for M3 PII masking)
     - AC7 (AC7.1–AC7.5): **5/5 PASS (100%)**
   - `node --test test/tier2-boundary.test.js`: **15 passed, 4 failed of 19**
     - Category 1 (Stock Boundary): **5/5 PASS (100%)**
     - Category 2 (Payload & Duplicate Aggregation): **5/5 PASS (100%)**
     - Category 3 (Order Cancellation Idempotency): **4/4 PASS (100%)**
     - Category 4 (PII Masking Edge Cases): 4 failed (scheduled for M3 Feature F5)
     - Category 5 (Concurrency & Row-Locking Race Condition): **1/1 PASS (100%)**
   - `node --test test/tier3-pairwise.test.js`: **5/5 PASS (100%)**
   - `node --test test/tier4-application.test.js`: **5/5 PASS (100%)**

2. Execution of Master Test Runner (`node test/test-runner.js`):
   ```
   ======================================================================
      CarModelStore E2E 4-Tier Test Runner (Node.js v24 Native)
   ======================================================================

   [1/3] Checking server & database status...
   [INFO] Server active at: http://localhost:5000 (Spawned: false)

   [2/3] Executing 4-Tier Test Suites in sequence...

   Running Tier 1: Feature Coverage (AC1-AC7) [test/tier1-features.test.js]... BASELINE FAILURES DETECTED (33 passed, 2 failed of 35 in 6369ms)
   Running Tier 2: Boundary, Edge Cases & Concurrency [test/tier2-boundary.test.js]... BASELINE FAILURES DETECTED (15 passed, 4 failed of 19 in 675ms)
   Running Tier 3: Pairwise Combinations [test/tier3-pairwise.test.js]... PASSED (5/5 tests in 602ms)
   Running Tier 4: Application Scenarios (Journeys) [test/tier4-application.test.js]... PASSED (5/5 tests in 631ms)

   [3/3] Execution Summary Table:
   --------------------------------------------------------------------------------
   Tier / Test Suite                                Total    Pass    Fail Time (ms)
   --------------------------------------------------------------------------------
   Tier 1: Feature Coverage (AC1-AC7)                  35      33       2      6316
   Tier 2: Boundary, Edge Cases & Concurrency          19      15       4       621
   Tier 3: Pairwise Combinations                        5       5       0       546
   Tier 4: Application Scenarios (Journeys)             5       5       0       578
   --------------------------------------------------------------------------------
   TOTAL                                               64      58       6
   ================================================================================

   Overall Baseline Pass Rate: 58/64 (90.6%)
   Identified 6 expected baseline failures scheduled for resolution in M1/M2/M3.
   ```

---

## 2. Logic Chain

1. **Static Analysis -> Authenticity Confirmation**:
   - Observations in §1.1 demonstrate that both order placement and order cancellation are backed by genuine SQL Server transactions using `sql.Transaction`, `WITH (UPDLOCK, ROWLOCK)`, pre-aggregation, authoritative DB pricing, and rollback handlers.
   - No mock objects, bypass flags, or hardcoded return values exist.

2. **Test Invariant & Timestamp Check -> Integrity Guarantee**:
   - Observations in §1.2 prove that test files were published by the independent E2E testing track prior to Milestone 2 implementation and have not been altered in any way.
   - The test assertions directly query Microsoft SQL Server tables (`orders`, `order_items`, `shipments`, `products`) to verify foreign keys and atomic state changes.

3. **Runtime Execution -> Defect Resolution Verification**:
   - Baseline execution in `TEST_READY.md` had 8 failing tests due to 3 defects:
     - Defect 1: Cancel non-idempotency (`Boundary 3.1`, `Boundary 3.2`)
     - Defect 2: Missing PII masking (6 tests across Tiers 1 and 2)
     - Defect 3: Duplicate item aggregation deficit (`Boundary 2.1`)
   - Observations in §1.3 show that `Boundary 3.1`, `Boundary 3.2`, and `Boundary 2.1` now pass 100%.
   - Overall pass count improved from 56/64 (87.5%) to **58/64 (90.6%)**.
   - The ONLY remaining 6 failures across all 4 tiers are the 6 PII masking tests belonging strictly to Milestone 3 (Feature F5).

4. **Forensic Integrity Mode Mapping**:
   - Per `ORIGINAL_REQUEST.md`, integrity mode is `development`.
   - All Phase 1 forensic checks (hardcoded results, facade implementations, pre-populated artifacts, test tampering) pass without violation.

---

## 3. Caveats

1. **Milestone 3 PII Masking Scope**:
   - The 6 failing tests (`AC6.3`, `AC6.4`, `Boundary 4.1`, `Boundary 4.2`, `Boundary 4.3`, `Boundary 4.4`) are expected baseline failures deferred to Milestone 3 (Feature F5) and do not constitute an integrity violation in Milestone 2.
2. **Database Seed Stock Maintenance**:
   - Because the 6 failing PII tests fail on assertions before their trailing cleanup blocks restore stock, repeated runs of test suites decrement product 1's seed stock. Product seed stock should be kept >= 50 during multi-suite runs.
3. **No Caveats Beyond Stated Scope**.

---

## 4. Conclusion

- **Verdict**: **CLEAN**
- Milestone 2 implementation in `car-store-backend/server.js` is 100% genuine and fully satisfies features F3 and F4:
  - ACID transaction integrity with `UPDLOCK, ROWLOCK`.
  - Authoritative database pricing and payload pre-aggregation.
  - Deterministic lock ordering eliminating deadlocks.
  - Two-way state machine with idempotent cancellation rejecting repeat cancels with HTTP 400.
  - Zero test file tampering or bypass logic detected.
- The work product is approved for Milestone 2 completion.

---

## 5. Verification Method

To independently verify this verdict:

1. **Verify Test File Integrity**:
   ```powershell
   git status test/
   Get-ChildItem -Recurse test | Select-Object FullName, LastWriteTime
   ```
   *Expected*: `test/` files untouched since E2E track publication (timestamp ~2:21–2:28 AM).

2. **Execute Full Test Suite**:
   ```powershell
   node test/test-runner.js
   ```
   *Expected*: **58 / 64 passed (90.6%)**, with 0 failures in Tiers 3 & 4, 0 failures in AC1–AC5, AC7, Boundary 1–3, and Boundary 5.

3. **Execute Individual Milestone 2 Specific Suites**:
   ```powershell
   node --test test/tier1-features.test.js
   node --test test/tier2-boundary.test.js
   node --test test/tier3-pairwise.test.js
   node --test test/tier4-application.test.js
   ```

4. **Invalidation Conditions**:
   - Any test modification detected in `test/`.
   - Repeated cancellation returning HTTP 200 instead of HTTP 400.
   - Any failure in AC1–AC3, Boundary 2, Boundary 3, or Boundary 5.
