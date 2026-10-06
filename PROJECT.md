# Project: CarModelStore Restructuring & E2E Synchronization

## 1. Architecture
- **Overview**: Full-stack E-Commerce application for collectible model cars.
- **Tech Stack**:
  - Backend: Node.js (v24), Express 5, `mssql` / `msnodesqlv8` connecting to Microsoft SQL Server 2025 (`CarModelStoreDB`).
  - Frontend: Vanilla HTML5 / CSS3 / ES6+, static hosting with client-side API communication (`apiFetch`).
  - Deployment: Local-first and ready for Vercel Serverless Functions (`/api/*` rewrite).
- **Quality Gates**:
  - R1: 100% UI Freeze & Interface Integrity (zero DOM structure or CSS modifications).
  - R2: Synchronization Matrix & ACID Transactions with row-locking (`UPDLOCK, ROWLOCK`).
  - R3: Client & Admin End-to-End Real-Time Synchronization.
  - R4: Production & Serverless Readiness (singleton connection pool, robust `.env`, crash-resilience).

## 2. Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Serverless Entry & Singleton Pool | Promise-cached connection pool singleton (`global.__poolPromise`), `api/index.js` wrapper, `vercel.json` rewrites, `.env` & `.env.example` standardization, package.json scripts (`start`, `test`). | M1 | Survey (Explorer 1) |
| F2 | Database Schema & Constraints | Customer snapshot columns on `orders`, UNIQUE constraint on `orders.tracking_code`, `CHECK (stock_quantity >= 0)` on `products`, reconcile status constraints. Idempotent migration script. | M1 | Survey (Explorer 3) |
| F3 | ACID Order Creation & Row-Locking | Atomic transaction in `POST /api/orders`: deterministic item sorting to prevent deadlocks, `UPDLOCK, ROWLOCK` on products, server-side authoritative pricing, quantity aggregation, customer snapshot, unique `VNPOST-...` tracking code. Clean rollback on insufficient stock. | M2 | Survey (Explorers 1 & 3) |
| F4 | Bidirectional State Machine & Idempotent Cancel | Atomic transaction in `PUT /api/orders/:code/status`: `UPDLOCK, ROWLOCK` on order, check existing status (prevent double-cancel stock inflation), restore product stock, update `shipments.shipping_status = 'cancelled'`. | M2 | Survey (Explorers 1 & 3) |
| F5 | Tracking API & PII Masking | `GET /api/tracking/:code` returns order, shipment, and items with masked recipient name (`Nguyễn V*** H***`), phone (`0912***678`), and address. | M3 | Survey (Explorers 1 & 2) |
| F6 | Client & Admin E2E Sync (100% UI Freeze) | Fix `account.html` order array extraction (`res.data.orders || res.data`), order scoping by customer; fix `admin/dashboard.html` KPI sync; update `contact.html` tracking lookup; fix `config.js` auto-serialization of object bodies; fix `admin-auth.js` admin email compatibility. Zero HTML/CSS alterations. | M3 | Survey (Explorer 2) |
| F7 | Automated E2E Test Suite (Tiers 1-4) | Comprehensive zero-dependency test suite via native `node --test` covering all 7 Acceptance Criteria, boundary cases, pairwise interactions, and user workflows. | E2E Track | Survey (Explorer 3) |
| F8 | Adversarial Hardening & Final Pass | 100% passing E2E tests, Tier 5 adversarial testing, Forensic Integrity Audit, and server startup verification. | M4 | Survey / Blueprint |

## 3. Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Requirement-driven opaque-box test infrastructure (`TEST_INFRA.md`), test suite (Tiers 1-4) covering all ACs, publishes `TEST_READY.md`. | Survey | DONE |
| M1 | Database Schema & Serverless Singleton Pool | F1, F2: Database schema enhancements, migration script, singleton connection pool, serverless entry point, package.json scripts. | Survey | DONE |
| M2 | ACID Transactions & State Machine | F3, F4: Atomic order creation with `UPDLOCK, ROWLOCK`, server-side pricing, deterministic lock ordering, customer snapshot, idempotent order cancellation with stock return. | M1 | DONE |
| M3 | Client & Admin E2E Sync (100% UI Freeze) | F5, F6: Tracking API with PII masking, `account.html`, `admin/dashboard.html`, `contact.html`, `config.js` auto-serialization, `admin-auth.js`. Zero HTML/CSS changes. | M2 | DONE |
| M4 | Final Integration, 100% E2E Pass & Hardening | F8: Pass 100% of E2E test suite (Tiers 1-4), Tier 5 adversarial coverage hardening, Forensic Audit verification. | M3, TEST_READY.md | DONE |

## 4. Interface Contracts

### 4.1 Database Connection Pool (`car-store-backend/db.js` or `server.js`)
- Function: `getDb() -> Promise<{ pool: ConnectionPool, sql: mssql }>`
- Invariants: Uses `global.__poolPromise` singleton cache; respects serverless environment; handles cold-start concurrency cleanly.

### 4.2 Order Creation (`POST /api/orders`)
- Request Body:
  ```json
  {
    "customerId": 2,
    "customerName": "Nguyen Van An",
    "customerEmail": "an@example.com",
    "customerPhone": "0901234567",
    "recipientName": "Tran Thi B",
    "recipientPhone": "0912345678",
    "shippingAddress": "123 Le Loi, Q1, HCMC",
    "items": [
      { "productId": 1, "quantity": 2 }
    ]
  }
  ```
- Response (201 Created):
  ```json
  {
    "success": true,
    "order": {
      "id": 10,
      "orderCode": "ORD-1728240000000-A1B2",
      "trackingCode": "VNPOST-1728240000000-C3D4",
      "totalAmount": 5400000,
      "status": "pending"
    }
  }
  ```
- Error (400 Bad Request):
  ```json
  {
    "success": false,
    "error": "Sản phẩm Ferrari 488 GTB chỉ còn 1 chiếc trong kho (yêu cầu 2)."
  }
  ```

### 4.3 Order Status Update & Cancellation (`PUT /api/orders/:code/status`)
- Request Body:
  ```json
  {
    "status": "cancelled"
  }
  ```
- Response (200 OK):
  ```json
  {
    "success": true,
    "message": "Cập nhật trạng thái đơn hàng thành công",
    "orderCode": "ORD-...",
    "previousStatus": "pending",
    "newStatus": "cancelled",
    "stockRestored": true
  }
  ```
- Error if already cancelled (400 Bad Request):
  ```json
  {
    "success": false,
    "error": "Đơn hàng đã ở trạng thái cancelled, không thể hủy lại."
  }
  ```

### 4.4 Tracking Lookup (`GET /api/tracking/:code`)
- Response (200 OK):
  ```json
  {
    "success": true,
    "shipment": {
      "tracking_code": "VNPOST-...",
      "carrier": "VNPost Tiết Kiệm",
      "shipping_status": "pending",
      "current_location": "Kho tổng TP.HCM",
      "estimated_delivery": "2026-10-10T12:00:00Z"
    },
    "order": {
      "order_code": "ORD-...",
      "order_status": "pending",
      "recipient_name": "Nguyễn V*** H***",
      "recipient_phone": "0912***678",
      "shipping_address": "123 L***, Q.1, TP.HCM",
      "total_amount": 5400000
    },
    "items": [
      { "name": "Ferrari 488 GTB", "quantity": 1, "unit_price": 2700000 }
    ]
  }
  ```

### 4.5 Dashboard Stats (`GET /api/dashboard/stats`)
- Response (200 OK):
  ```json
  {
    "success": true,
    "stats": {
      "total_products": 17,
      "total_orders": 3,
      "pending_orders": 1,
      "total_brands": 9,
      "total_revenue": 9920000
    },
    "recentOrders": [...]
  }
  ```

## 5. Code Layout
- Backend Source:
  - `car-store-backend/server.js`: Express app, routes, transaction endpoints.
  - `car-store-backend/migrate.js`: Database schema migration & constraints script.
  - `car-store-backend/package.json`: Dependencies, scripts (`start`, `test`).
  - `car-store-backend/.env`, `car-store-backend/.env.example`: Environment configs.
  - `api/index.js`: Vercel serverless entry point exporting handler.
  - `vercel.json`: Vercel routing configuration.
- Frontend Source (100% UI Freeze):
  - `account.html`: User profile & order history.
  - `admin/dashboard.html`: Admin statistics & recent orders.
  - `contact.html`: Contact & public parcel tracking.
  - `cart.html`: Shopping cart & checkout modal (`#checkoutModal`).
  - `assets/js/config.js`: `apiFetch` utility, dynamic base URL.
  - `assets/js/admin-auth.js`: Admin authentication & RBAC guards.
- Tests (E2E Track):
  - `test/test-runner.js`: Central test runner.
  - `test/tier1-features.test.js`: Feature coverage (AC1 - AC7).
  - `test/tier2-boundary.test.js`: Boundary, concurrency & edge cases.
  - `test/tier3-pairwise.test.js`: Cross-feature combination scenarios.
  - `test/tier4-application.test.js`: End-to-end customer workflows.
  - `TEST_INFRA.md`, `TEST_READY.md`: Test track index and completion signal.
