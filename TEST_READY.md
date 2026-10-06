# CarModelStore E2E Test Suite Readiness Report (`TEST_READY.md`)

## 1. Test Suite Status
- **Status**: **READY** (Dual Track: E2E Testing Track Complete)
- **Publication Date**: 2026-10-06T19:30:00Z
- **Framework**: Node.js v24 Native Test Runner (`node --test`, `node:assert/strict`)
- **Zero-Dependency Guarantee**: Validated (no third-party test libraries)

---

## 2. Test Execution Commands

### Execute Master Test Runner (All 4 Tiers)
```powershell
node test/test-runner.js
```

### Execute via NPM (from `car-store-backend/`)
```powershell
cd car-store-backend
npm test
```

### Execute Individual Test Tiers
```powershell
node --test test/tier1-features.test.js
node --test test/tier2-boundary.test.js
node --test test/tier3-pairwise.test.js
node --test test/tier4-application.test.js
```

---

## 3. Test Suite Breakdown & Baseline Execution Results

| Tier / Suite | Target Scope | Total Tests | Pass | Fail | Execution Time | Baseline Status |
|---|---|---|---|---|---|---|
| **Tier 1: Feature Coverage** | AC1 through AC7 | 35 | 33 | 2 | ~1100ms | 94.3% (2 expected PII masking failures) |
| **Tier 2: Boundary & Concurrency** | Boundaries, Concurrency, Idempotency | 19 | 13 | 6 | ~550ms | 68.4% (2 cancel idempotency + 4 PII failures) |
| **Tier 3: Pairwise Combinations** | Cross-feature multi-step scenarios | 5 | 5 | 0 | ~460ms | **100% PASS** |
| **Tier 4: Application Scenarios** | Real-world customer & admin journeys | 5 | 5 | 0 | ~450ms | **100% PASS** |
| **TOTAL** | **Comprehensive E2E Suite** | **64** | **56** | **8** | **~2560ms** | **87.5% Baseline Pass Rate** |

---

## 4. Feature Acceptance Criteria Checklist

| Criteria | Feature Scope | Baseline Result | Details / Notes |
|---|---|---|---|
| **AC1** | Atomic Order Creation & DB Linking | **PASS (100%)** | Creates `orders`, `order_items`, `shipments` (`VNPOST-...`), decrements inventory atomically. Foreign keys strictly verified. |
| **AC2** | Out-of-Stock Rejection & Concurrency | **PASS (100%)** | Excess quantity orders rejected with 400. 0 orphaned rows in all tables. Concurrency race conditions cleanly serialized with row locking. |
| **AC3** | Cancellation Stock Return & Shipment Status | **PARTIAL** | Basic cancellation successfully updates status to `'cancelled'`, sets `shipments.shipping_status = 'cancelled'`, and restores inventory. (Idempotent double-cancel rejection requires M2). |
| **AC4** | Customer Account Sync (`account.html`) | **PASS (100%)** | Orders properly scoped by `customer_id`. Newly placed orders appear in account history immediately. Security isolation confirmed. |
| **AC5** | Admin Dashboard Sync (`/api/dashboard/stats`) | **PASS (100%)** | Real-time calculation of `total_orders`, `total_revenue`, and 5 most recent orders directly from SQL Server. |
| **AC6** | Public Tracking Lookup & PII Masking | **PARTIAL** | Resolves shipment, order, and items via `trackingCode` and `orderCode`. (PII masking of recipient name, phone, address requires M3). |
| **AC7** | Server Health & Connection Pool Stability | **PASS (100%)** | Connection pool singleton responds < 10ms. Rapid concurrent health queries execute without connection leak. |

---

## 5. Discovered Implementation Defects & Escalations

The baseline execution against the current pre-restructuring backend identified 8 failing test cases. All 8 failures stem from 3 discrete implementation defects, documented below for the implementing agents in Milestones M2 and M3:

### Defect 1 (Escalation to Milestone M2 / Feature F4): Non-Idempotent Order Cancellation & Stock Inflation
- **Observed Behavior**: Repeating `PUT /api/orders/:code/status` with `status: 'cancelled'` on an already-cancelled order returns HTTP 200 and triggers `UPDATE products SET stock_quantity = stock_quantity + oi.quantity` again.
- **Impact**: Inventory inflation (stock quantity increases past original stock each time cancel is called).
- **Required Specification**: Per `PROJECT.md § 4.3` and Feature F4: Check existing order status under `UPDLOCK, ROWLOCK`. If order is already `'cancelled'`, reject with HTTP 400 (`{ success: false, error: 'Đơn hàng đã ở trạng thái cancelled, không thể hủy lại.' }`) without restoring stock.
- **Affected Tests**: `Boundary 3.1`, `Boundary 3.2`.

### Defect 2 (Escalation to Milestone M3 / Feature F5): Missing PII Masking in Public Tracking API
- **Observed Behavior**: `GET /api/tracking/:code` returns raw unmasked customer information: `recipient_name` (`"Nguyen Van An"`), `recipient_phone` (`"0912345678"`), and `shipping_address` (`"123 Le Loi, Q1, HCMC"`).
- **Impact**: Privacy leak on publicly accessible endpoint (`contact.html`).
- **Required Specification**: Per `ORIGINAL_REQUEST.md R3`, `PROJECT.md § 4.4` and Feature F5: Apply regex masking to recipient name (`Nguyễn V*** H***`), phone (`0912***678`), and address before returning payload.
- **Affected Tests**: `AC6.3`, `AC6.4`, `Boundary 4.1`, `Boundary 4.2`, `Boundary 4.3`, `Boundary 4.4`.

### Defect 3 (Escalation to Milestone M2 / Feature F3): Cart Payload Duplicate Product Quantity Aggregation
- **Observed Behavior**: If an order payload sends duplicate product entries in the `items` array (e.g. `[{ productId: 4, quantity: 3 }, { productId: 4, quantity: 3 }]`), each entry is checked independently against current stock rather than aggregating total requested quantity.
- **Impact**: Can lead to stock deficit if `sum(quantity) > stock_quantity`.
- **Required Specification**: Per `PROJECT.md § Feature Inventory F3`: Aggregate item quantities by `productId` prior to executing inventory checks and row locking.
- **Affected Tests**: `Boundary 2.1`.

---

## 6. Verification Method for Milestone Implementers
After implementing M1, M2, and M3:
Run `node test/test-runner.js`.
Target acceptance: **64 / 64 tests passing (100% Pass Rate)**.
