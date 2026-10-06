# CarModelStore E2E Test Infrastructure Specification (`TEST_INFRA.md`)

## 1. Overview & Quality Objectives
The CarModelStore End-to-End (E2E) Test Suite provides requirement-driven, opaque-box automated validation across the entire application stack: SQL Server Database, Express Backend API, and Frontend Integration contracts.

This test infrastructure is designed to:
- Guarantee 100% ACID transaction compliance and row-level inventory locking (`UPDLOCK, ROWLOCK`).
- Validate data synchronization between Database, Client (`account.html`), Admin Dashboard (`/api/dashboard/stats`), and Public Tracking (`/api/tracking/:code`).
- Enforce interface contracts defined in `ORIGINAL_REQUEST.md` (R1-R4, AC1-AC7) and `PROJECT.md § Interface Contracts`.
- Operate with zero external npm test dependencies using the native Node.js v24 test runner.

---

## 2. Technology Stack & Zero-Dependency Guarantee
- **Runtime**: Node.js v24 (`v24.15.0`)
- **Test Runner**: Native Node.js test runner (`node --test`, `node:test`)
- **Assertion Library**: Native Node.js strict assertion library (`node:assert/strict`)
- **HTTP Client**: Native Node.js `fetch` (ES2022+ standard, zero npm packages)
- **Database Client**: Direct SQL verification via `mssql/msnodesqlv8` (connecting to `CarModelStoreDB` on SQL Server 2025)
- **External Dependencies**: **Zero** (no Jest, Mocha, Chai, Cypress, or Supertest required)

---

## 3. Directory Layout & Architecture
```
d:\laptrinhweb - Copy\
├── test/
│   ├── helpers/
│   │   ├── config.js              # Environment settings, port, DB connection string
│   │   ├── server.js              # Server lifecycle auto-start, health probe & teardown
│   │   ├── db.js                  # Direct SQL Server query helpers & state cleanup
│   │   └── api.js                 # Unified HTTP client wrapping native fetch
│   ├── tier1-features.test.js     # Tier 1: Feature Coverage (AC1 - AC7, 35 tests)
│   ├── tier2-boundary.test.js     # Tier 2: Boundary, Edge Cases & Concurrency (19 tests)
│   ├── tier3-pairwise.test.js     # Tier 3: Pairwise Cross-Feature Scenarios (5 suites)
│   ├── tier4-application.test.js  # Tier 4: Real-World Customer Journeys (5 scenarios)
│   └── test-runner.js             # Central test runner with formatted reporting
├── car-store-backend/
│   └── package.json               # Configured with "test": "node ../test/test-runner.js"
├── TEST_INFRA.md                  # This specification document
└── TEST_READY.md                  # Baseline execution report & milestone readiness
```

---

## 4. 4-Tier Test Taxonomy & Coverage Details

### Tier 1: Feature Coverage (AC1 – AC7) — 35 Tests
Direct requirement-driven verification of each feature in isolation:
- **AC1: Order Creation in a Single Transaction**:
  - `AC1.1`: Single-item atomic order creation (`orders`, `order_items`, `shipments`, stock decrement).
  - `AC1.2`: Multi-item atomic order creation decrements all item stocks and creates all `order_items`.
  - `AC1.3`: Foreign key integrity between `orders.id`, `order_items.order_id`, and `shipments.order_id`.
  - `AC1.4`: Order tracking code uniqueness and `VNPOST-...` prefix verification.
  - `AC1.5`: Authoritative total amount calculation and customer info snapshot persistence.
- **AC2: Out-of-Stock Rejection**:
  - `AC2.1`: Order requesting quantity > stock is rejected with HTTP 400.
  - `AC2.2`: Informative error message detailing stock deficit.
  - `AC2.3`: Zero orphaned rows in `orders` upon rejection.
  - `AC2.4`: Zero orphaned rows in `order_items` and `shipments` upon rejection.
  - `AC2.5`: Product stock quantity remains 100% unchanged.
- **AC3: Order Cancellation & State Machine**:
  - `AC3.1`: `PUT /api/orders/:code/status` with `cancelled` returns HTTP 200.
  - `AC3.2`: Exact product stock quantity restored to database.
  - `AC3.3`: `orders.order_status` updated to `'cancelled'`.
  - `AC3.4`: `shipments.shipping_status` updated to `'cancelled'`.
  - `AC3.5`: Cancellation works interchangeably using `tracking_code` or `order_code`.
- **AC4: Customer Account Sync (`/api/orders?customer_id=...`)**:
  - `AC4.1`: Customer-scoped order queries return only orders belonging to that customer.
  - `AC4.2`: Customer cannot see orders of other customers (security scoping).
  - `AC4.3`: Order payload contains all fields required by `account.html`.
  - `AC4.4`: Newly placed order immediately appears in customer order history.
  - `AC4.5`: Cancelled order immediately reflects `'cancelled'` status in account history.
- **AC5: Admin Dashboard Sync (`/api/dashboard/stats`)**:
  - `AC5.1`: Endpoint returns HTTP 200 with `stats` and `recentOrders`.
  - `AC5.2`: `stats.total_orders` equals `COUNT(*) FROM orders`.
  - `AC5.3`: `stats.total_revenue` correctly sums non-cancelled orders.
  - `AC5.4`: `recentOrders` contains at most 5 orders sorted by `created_at DESC`.
  - `AC5.5`: New order increments `total_orders` and appears at top of `recentOrders`.
- **AC6: Public Tracking Lookup & PII Masking (`/api/tracking/:code`)**:
  - `AC6.1`: Resolves shipment, order, and items by `trackingCode`.
  - `AC6.2`: Resolves shipment, order, and items by `orderCode`.
  - `AC6.3`: Recipient name is masked (contains `*`) to protect privacy.
  - `AC6.4`: Recipient phone is masked (contains `*`) to protect privacy.
  - `AC6.5`: Returns 404 for non-existent code, 400 for empty code.
- **AC7: Server Health & Connection Pool Stability (`/api/health`)**:
  - `AC7.1`: Returns HTTP 200 with `status: 'online'` and `database: 'connected'`.
  - `AC7.2`: Returns system counts (`total_products`, `total_orders`).
  - `AC7.3`: High consecutive concurrent health queries do not leak connections.
  - `AC7.4`: Health response latency < 500ms.
  - `AC7.5`: Root `/` serves `index.html` static web page.

### Tier 2: Boundary, Edge Cases & Concurrency — 19 Tests
Boundary exploration and stress testing:
- **Category 1: Stock Boundary Conditions**:
  - Order exact available stock (`qty == stock`) reduces stock to 0.
  - Order when stock is 0 returns 400 immediately.
  - Order stock + 1 returns 400 with deficit message.
  - Order negative quantity (-1) returns 400.
  - Order zero quantity (0) returns 400.
- **Category 2: Payload Validation & Duplicates**:
  - Duplicate `productId` in same cart payload handles quantity aggregation safely.
  - Non-existent `productId` (999999) returns 404/400 and creates no order.
  - Empty items array `[]` returns 400.
  - Missing recipient details returns 400.
  - Non-numeric quantity (`"abc"`) returns 400.
- **Category 3: Cancellation Idempotency & State Machine**:
  - Cancelling an already cancelled order returns 400 and does NOT restore stock again (stock inflation prevention).
  - Rapid parallel cancellation calls restore stock exactly once.
  - Invalid status transition string returns 400.
  - Non-existent order cancellation returns 404.
- **Category 4: PII Masking Edge Cases**:
  - Single-word names ("Long") masked safely without exception.
  - Two-word names ("Ha Long") have middle masked.
  - 10-digit phone numbers mask middle digits.
  - Street address details are masked.
- **Category 5: Concurrency and Race Condition**:
  - 3 simultaneous orders competing for 1 remaining stock item: exactly 1 succeeds (201), remaining 2 fail (400), stock ends at 0, never negative.

### Tier 3: Pairwise Cross-Feature Combinations — 5 Scenarios
Cross-module interaction verification:
- `Pairwise 1`: Order -> Tracking Lookup -> Cancel Order -> Tracking Lookup -> Stock Verification (full lifecycle roundtrip).
- `Pairwise 2`: Multiple Orders -> Admin Dashboard Sync -> Cancel One Order -> Dashboard Revenue Re-sync.
- `Pairwise 3`: Multi-Customer Isolation: Customer A Orders vs Customer B Orders in Account Sync.
- `Pairwise 4`: Multi-Item Order (Multiple Distinct Products) -> Cancel -> All Distinct Products Restored.
- `Pairwise 5`: Tracking Lookup Interoperability: Query by Order Code vs Query by Tracking Code.

### Tier 4: Real-World Customer Journeys — 5 Scenarios
Full end-to-end customer workflows simulating browser UI operations:
- `Scenario 1`: Complete Guest Checkout & Public Parcel Tracking Journey.
- `Scenario 2`: Registered Customer Lifecycle Journey (Register -> Login -> Order -> Account History).
- `Scenario 3`: Inventory Depletion & Out-of-Stock Recovery Journey (Over-order fail -> Adjust cart -> Order success).
- `Scenario 4`: Customer Order Cancellation & Inventory Return for Next Shopper.
- `Scenario 5`: Admin Order Processing Pipeline (Pending -> Shipping -> Delivered).

---

## 5. Execution Commands

### Run Full Test Suite via Master Runner
```powershell
node test/test-runner.js
```

### Run Full Test Suite via NPM
```powershell
cd car-store-backend
npm test
```

### Run Individual Tiers via Native Node.js Test Runner
```powershell
# Tier 1: Feature Coverage (AC1-AC7)
node --test test/tier1-features.test.js

# Tier 2: Boundary, Edge Cases & Concurrency
node --test test/tier2-boundary.test.js

# Tier 3: Pairwise Combinations
node --test test/tier3-pairwise.test.js

# Tier 4: Real-World Application Scenarios
node --test test/tier4-application.test.js

# Run all test files directly
node --test test/*.test.js
```

---

## 6. Environment & Server Lifecycle Management
- **Autonomous Server Management**: Tests automatically check if the server is already active at `http://localhost:5000`. If not, `test/helpers/server.js` automatically spawns `node server.js` from `car-store-backend`, polls `/api/health` until ready, and registers process exit handlers to terminate the child process upon test completion.
- **Configuration Overrides**:
  - `TEST_API_URL`: Custom backend base URL (default: `http://localhost:5000`).
  - `DB_CONNECTION_STRING`: Custom SQL Server connection string.
- **Data Cleanup & Isolation Guarantee**:
  - Every test file tracks all created `orderCode`s and cleans them up from `orders`, `order_items`, and `shipments` via cascading deletes in `after()` hooks.
  - Every stock modification in tests is recorded and restored to its original value in `after()` or `afterEach()` hooks.
  - Zero database state pollution between test runs.

---

## 7. Traceability Matrix: Acceptance Criteria to Test Suites

| Acceptance Criteria | Requirement Reference | Primary Test Suite | Key Test Cases |
|---------------------|----------------------|--------------------|----------------|
| **AC1** (Atomic Order Creation) | `ORIGINAL_REQUEST.md` R2, AC1 | `test/tier1-features.test.js` | AC1.1, AC1.2, AC1.3, AC1.4, AC1.5 |
| **AC2** (Out-of-Stock Rejection) | `ORIGINAL_REQUEST.md` R2, AC2 | `test/tier1-features.test.js`, `test/tier2-boundary.test.js` | AC2.1-AC2.5, Boundary 1.1-1.5, Boundary 5.1 |
| **AC3** (Cancellation Stock Return) | `ORIGINAL_REQUEST.md` R2, AC3 | `test/tier1-features.test.js`, `test/tier2-boundary.test.js` | AC3.1-AC3.5, Boundary 3.1-3.4, Pairwise 1 |
| **AC4** (Account Live Sync) | `ORIGINAL_REQUEST.md` R3, AC4 | `test/tier1-features.test.js`, `test/tier3-pairwise.test.js` | AC4.1-AC4.5, Pairwise 3, Journey 2 |
| **AC5** (Admin Dashboard Sync) | `ORIGINAL_REQUEST.md` R3, AC5 | `test/tier1-features.test.js`, `test/tier3-pairwise.test.js` | AC5.1-AC5.5, Pairwise 2, Journey 5 |
| **AC6** (Tracking Lookup & PII) | `ORIGINAL_REQUEST.md` R3, AC6 | `test/tier1-features.test.js`, `test/tier2-boundary.test.js` | AC6.1-AC6.5, Boundary 4.1-4.4, Journey 1 |
| **AC7** (Server Stability & Pool) | `ORIGINAL_REQUEST.md` R4, AC7 | `test/tier1-features.test.js` | AC7.1-AC7.5 |
