# Handoff Report — Explorer 3 (Database Schema, Data Models & Testing Harness)

**Role**: Explorer 3 (`teamwork_preview_explorer`)  
**Workspace**: `d:\laptrinhweb - Copy`  
**Working Directory**: `d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_survey_3`  
**Recipient**: Orchestrator (Conversation ID: `8d541fff-80dd-457d-bc7c-cd842c463674`)  
**Date**: 2026-10-06T19:15:00Z  

---

## 1. Observation

### 1.1 Database Engine & Runtime Environment
- **SQL Server Engine**: Executed `SELECT @@VERSION, SERVERPROPERTY('ProductVersion'), SERVERPROPERTY('Edition')` via `mssql/msnodesqlv8`:
  - Product Version: `17.0.1000.7 (RTM)` — **Microsoft SQL Server 2025 (Enterprise Evaluation Edition, 64-bit)**.
  - Windows Service: `MSSQLSERVER` is `Running`.
  - Database Name: `CarModelStoreDB`.
  - Node.js Runtime: `v24.15.0`.
  - npm Runtime: `11.12.1`.
- **Row Locking Support (`UPDLOCK, ROWLOCK`)**:
  - Direct execution test of `SELECT id, name, stock_quantity FROM products WITH (UPDLOCK, ROWLOCK) WHERE id = 1` inside an uncommitted transaction succeeded.
  - Concurrent lock test: When Transaction 1 acquired `UPDLOCK, ROWLOCK` on `products.id = 1`, Transaction 2 executing with `SET LOCK_TIMEOUT 1000` was blocked and timed out with verbatim error:
    `[Microsoft][ODBC Driver 17 for SQL Server][SQL Server]Lock request time out period exceeded.`
  - Native row locking and transaction isolation are 100% supported by the underlying engine.

### 1.2 Database Tables, Schemas, Constraints & Seed Data
Inspected via `INFORMATION_SCHEMA.TABLES`, `INFORMATION_SCHEMA.COLUMNS`, `TABLE_CONSTRAINTS`, and files `database/00_full_setup.sql`, `database/01_create_tables.sql`, `database/02_insert_mock_data.sql`, `car-store-backend/migrate.js`:

1. **`users` Table**:
   - Columns: `id` (INT IDENTITY PK), `username` (VARCHAR(50) UNIQUE), `password` (VARCHAR(255)), `full_name` (NVARCHAR(100) NOT NULL), `email` (VARCHAR(100) NOT NULL UNIQUE), `phone` (VARCHAR(15)), `address` (NVARCHAR(MAX)), `role` (VARCHAR(20) CHECK IN ('admin', 'customer', 'staff')), `created_at` (DATETIME).
   - Compatibility View: `customers` (`SELECT id, full_name, email, phone, address, created_at FROM users`).
   - Current records: 4 (`admin`, `nguyenvanan`, `tranbinh`, `hailong`).

2. **`brands` Table**:
   - Columns: `id` (INT IDENTITY PK), `brand_code` (VARCHAR(30) UNIQUE), `name` (NVARCHAR(100) UNIQUE), `country` (NVARCHAR(50)), `description` (NVARCHAR(MAX)), `total_models` (INT), `created_at` (DATETIME).
   - Current records: 9 brands (`Ferrari`, `Lamborghini`, `Porsche`, `Mercedes-Benz`, `BMW`, `Nissan`, `Honda`, `Ford`, `Toyota`).

3. **`products` Table**:
   - Columns: `id` (INT IDENTITY PK), `product_code` (VARCHAR(50) UNIQUE), `name` (NVARCHAR(255) NOT NULL), `scale` (VARCHAR(10) NOT NULL), `brand_id` (INT NULL FK -> brands(id)), `manufacturer` (NVARCHAR(100)), `car_brand` (NVARCHAR(100)), `price` (DECIMAL(12,2)), `stock_quantity` (INT DEFAULT 0), `status` (NVARCHAR(20) CHECK IN ('in_stock', 'pre_order', 'out_of_stock', 'bestseller')), `image_url` (NVARCHAR(500)), `description` (NVARCHAR(MAX)), `rating` (DECIMAL(2,1)), `reviews` (INT), `created_at` (DATETIME).
   - Constraints: Missing check constraint on stock (`stock_quantity >= 0` does NOT exist).
   - Current records: 17 products (populated via `02_insert_mock_data.sql` and `migrate.js`).

4. **`accessories` Table**:
   - Columns: `id` (INT IDENTITY PK), `accessory_code` (VARCHAR(50) UNIQUE), `name` (NVARCHAR(255)), `category` (NVARCHAR(50)), `compatible_scale` (NVARCHAR(100)), `price` (DECIMAL(12,2)), `stock_quantity` (INT), `image_url` (NVARCHAR(500)), `description` (NVARCHAR(MAX)), `created_at` (DATETIME).
   - Current records: 4 items.

5. **`orders` Table**:
   - Columns: `id` (INT IDENTITY PK), `order_code` (VARCHAR(30) UNIQUE), `customer_id` (INT NOT NULL FK -> users(id)), `recipient_name` (NVARCHAR(100) NOT NULL), `recipient_phone` (VARCHAR(15) NOT NULL), `shipping_address` (NVARCHAR(MAX) NOT NULL), `total_amount` (DECIMAL(14,2)), `tracking_code` (VARCHAR(50) NULL), `order_status` (NVARCHAR(20) CHECK IN ('pending', 'confirmed', 'shipping', 'delivered', 'cancelled')), `created_at` (DATETIME).
   - Current records: 2 orders (`ORD-2026-0001`, `ORD-1791312977963`).
   - Observations on Constraints & Schema:
     - `tracking_code` is NOT UNIQUE in `orders` (only indexed via `idx_orders_tracking_code`).
     - Customer snapshot columns (`customer_name`, `customer_email`, `customer_phone`) are missing; currently only recipient fields exist.
     - `order_status` check constraint only allows `'pending', 'confirmed', 'shipping', 'delivered', 'cancelled'`, while `server.js` line 356 allows `'completed'`.

6. **`order_items` Table**:
   - Columns: `id` (INT IDENTITY PK), `order_id` (INT NOT NULL FK -> orders(id) ON DELETE CASCADE), `product_id` (INT NOT NULL FK -> products(id)), `quantity` (INT CHECK (quantity > 0)), `unit_price` (DECIMAL(12,2)).
   - Current records: 3 rows.

7. **`shipments` Table**:
   - Columns: `id` (INT IDENTITY PK), `order_id` (INT NOT NULL FK -> orders(id) ON DELETE CASCADE), `tracking_code` (VARCHAR(50) NOT NULL UNIQUE), `carrier` (NVARCHAR(100) DEFAULT N'VNPost Tiết Kiệm'), `shipping_status` (NVARCHAR(50) DEFAULT N'pending'), `current_location` (NVARCHAR(255)), `estimated_delivery` (DATETIME), `notes` (NVARCHAR(MAX)), `created_at` (DATETIME), `updated_at` (DATETIME).
   - Constraints: `tracking_code` is UNIQUE. `shipping_status` lacks a CHECK constraint.
   - Current records: 2 shipments (`VNPOST-ORD-2026-0001`, `VNPOST-1791312977963`).

### 1.3 Backend Server Implementation (`car-store-backend/server.js`)
- **Port & Startup**: Port 5000 is active (Process ID 12108, node.exe).
- **Endpoint Tests**:
  - `GET /api/health`: Returned status 200 `{ success: true, status: "online", database: "connected", stats: { total_products: 17, total_orders: 2 } }`.
  - `GET /api/dashboard/stats`: Returned status 200 `{ success: true, stats: { total_products: 17, total_orders: 2, pending_orders: 1, total_brands: 9, total_revenue: 4520000 }, recentOrders: [...] }`.
  - `GET /api/tracking/VNPOST-1791312977963`: Returned status 200 with order and shipment data.
- **Specific Implementation Flaws Observed in `server.js`**:
  1. **Line 473 & 515 (`POST /api/orders`)**:
     - Locks products using `SELECT ... FROM products WITH (UPDLOCK, ROWLOCK) WHERE id = @pid`. However, items are processed in arbitrary cart order. Opposing locking orders from concurrent transactions can cause deadlocks.
     - Line 491: `const totalAmount = items.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.unitPrice)), 0);` — uses client-submitted `unitPrice` instead of DB-verified `product.price`.
  2. **Line 492-494 (`POST /api/orders`)**:
     - `trackingCode = 'VNPOST-' + Date.now();` and `orderCode = 'ORD-' + Date.now();` — susceptible to collision under sub-millisecond concurrent requests.
  3. **Line 378-420 (`PUT /api/orders/:code/status`)**:
     - Cancellation (`status === 'cancelled'`) increases stock: `UPDATE p SET p.stock_quantity = p.stock_quantity + oi.quantity ...`.
     - It does NOT check whether the order was previously already `cancelled`. Repeatedly calling cancel on the same order causes unbounded inventory inflation.
  4. **Line 573-633 (`GET /api/tracking/:code`)**:
     - Returns unmasked `recipient_name`, `recipient_phone`, `shipping_address` directly in plain text.
  5. **Line 342 (`GET /api/orders`)**:
     - Returns `{ success: true, orders: result.recordset }`.
     - In `account.html` line 259: `if (res.ok && Array.isArray(res.data) && res.data.length > 0)` — expects `res.data` to be an array, causing `account.html` to fail to render orders!
  6. **Line 27-99 (Connection Pooling)**:
     - Module-level singleton `let dbPool = null`. If multiple incoming requests invoke `getDb()` concurrently before the pool is connected, multiple connection attempts occur. No promise lock exists.

### 1.4 Package & Testing Configuration (`car-store-backend/package.json`)
- Current scripts:
  ```json
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  }
  ```
- Missing: `"start"`, `"dev"`, `"test"`. `"main"` points to nonexistent `"index.js"` instead of `"server.js"`.
- Dependencies: `body-parser`, `cors`, `dotenv`, `express`, `msnodesqlv8`, `mssql`.
- Automated test suites: **0 test files in entire repository**. No test framework is installed.

---

## 2. Logic Chain

1. **Premise 1 (R2 Concurrency & ACID)**: Requirement R2 mandates atomic operations across tables with row-locking (`UPDLOCK, ROWLOCK`), customer snapshotting, unique `VNPOST-...` tracking codes, and a bidirectional state machine with atomic stock restoration.
2. **Step 1 (Locking Verification)**: Verified that SQL Server 2025 supports `UPDLOCK, ROWLOCK` and blocks concurrent transactions. However, because `POST /api/orders` acquires locks in whatever order the client sends the `items` array, concurrent transactions ordering `[itemA, itemB]` vs `[itemB, itemA]` risk SQL Server deadlocks (error 1205).
   - *Inference*: Items must be sorted deterministically by `productId` ascending before locking.
3. **Step 2 (Data Integrity in Pricing & Stock)**: `POST /api/orders` trusts `item.unitPrice` sent in the request body. If a malicious client passes `unitPrice: 0`, the total and `order_items` record 0.
   - *Inference*: `unitPrice` and `totalAmount` must be computed strictly from `product.price` retrieved inside the transaction lock. Furthermore, a DB check constraint `CHECK (stock_quantity >= 0)` on `products` guarantees engine-level defense against negative stock.
4. **Step 3 (Customer Snapshot)**: R2 explicitly specifies "Snapshot thông tin khách hàng vào đơn hàng". Currently, `orders` only stores recipient details. If a registered user changes their account email, name, or phone in `users`, or if recipient is different from buyer, the order history loses buyer identification.
   - *Inference*: Add `customer_name NVARCHAR(100)`, `customer_email VARCHAR(100)`, `customer_phone VARCHAR(15)` to `orders` and populate them from the authenticated customer record during order creation.
5. **Step 4 (Bidirectional State Machine & Idempotency)**: `PUT /api/orders/:code/status` currently increments stock whenever `status === 'cancelled'` without checking whether the previous status was already `cancelled`.
   - *Inference*: The status transition must verify `current_status != 'cancelled'` before updating `shipments.shipping_status = 'cancelled'` and restoring inventory.
6. **Step 5 (Tracking Uniqueness & PII Masking)**: `Date.now()` without random or cryptographic entropy risks collisions under concurrency. Public tracking lookup on `contact.html` exposes recipient phone and name in cleartext.
   - *Inference*: Generate tracking codes with entropy: `VNPOST-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`, add a `UNIQUE` constraint on `orders.tracking_code`, and mask sensitive PII (e.g. `090****567`, `Nguyễn *** An`) in `GET /api/tracking/:code`.
7. **Step 6 (Frontend Mismatch in `account.html`)**: `account.html` line 259 explicitly evaluates `Array.isArray(res.data)`, but `server.js` returns `{ success: true, orders: [...] }`.
   - *Inference*: Standardize `GET /api/orders` and make `account.html` support `const list = Array.isArray(res.data) ? res.data : (res.data?.orders || []);` preserving 100% frozen UI.
8. **Step 7 (Test Harness)**: The project currently has no test framework, but runs Node.js v24.15.0 which possesses a native test runner (`node --test`) and assertion library (`node:assert/strict`).
   - *Inference*: An automated test suite using native `node --test` can test all Acceptance Criteria (AC1 to AC7) without adding third-party npm package overhead.

---

## 3. Caveats

1. **Database Credentials**: The local database relies on Windows Authentication (`Trusted_Connection=yes`) via ODBC Driver 17 for SQL Server. On non-Windows platforms or remote serverless (Vercel), TDS connection variables (`DB_SERVER`, `DB_USER`, `DB_PASSWORD`) in `.env` must be supplied.
2. **Existing Migration Script**: `car-store-backend/migrate.js` is standalone and does not run automatically on server start. Schema adjustments should either be added to `migrate.js` or executed as idempotent migration scripts.
3. **No Prior Automated Tests**: Because zero test files exist, establishing a test harness requires creating test scripts and adding npm scripts (`"test": "node --test"`).

---

## 4. Conclusion

The existing system possesses a functional SQL Server 2025 backend and Express server on port 5000, but has several architectural, schema, and concurrency gaps that prevent compliance with R2, R3, and the Acceptance Criteria:

### Core Gaps Identified:
| Area | Current State | Required State (R2 / AC) | Severity |
|---|---|---|---|
| **Customer Snapshot** | `orders` only has recipient fields (`recipient_name`, `recipient_phone`, `shipping_address`). | Add `customer_name`, `customer_email`, `customer_phone` to `orders`; populate in order transaction. | High |
| **Tracking Code Uniqueness** | `orders.tracking_code` is NOT UNIQUE; generated with `Date.now()` (collision risk). | Add UNIQUE constraint on `orders.tracking_code`; generate `VNPOST-${Date.now()}-${random}`. | High |
| **Stock Check Constraint** | `products.stock_quantity` has no `CHECK (stock_quantity >= 0)`. | Add `CHECK (stock_quantity >= 0)` constraint in SQL Server. | Medium |
| **Lock Ordering** | Cart items locked in arbitrary client order (deadlock risk). | Sort items by `productId` ascending before acquiring `UPDLOCK, ROWLOCK`. | High |
| **Price Tampering** | Backend uses client-supplied `item.unitPrice` for order total. | Calculate total and item price using DB-verified `product.price`. | Critical |
| **Cancel Idempotency** | Double cancel on `PUT /api/orders/:code/status` multiplies inventory restoration. | Lock order, check `order_status != 'cancelled'` before restoring stock and updating shipment. | High |
| **PII Masking** | `GET /api/tracking/:code` returns raw customer phone and address. | Mask phone (e.g. `090****567`) and address in public tracking endpoint. | Medium |
| **`account.html` Contract** | `account.html` tests `Array.isArray(res.data)`; backend returns `{ success, orders }`. | Harmonize data extraction so `account.html` reads `res.data.orders || res.data`. | High |
| **Test Harness** | 0 tests, no test script in `package.json`. | Implement `test/api-e2e.test.js` using Node.js v24 native `node --test`. | High |

---

## 5. Verification Method

### 5.1 Verifying SQL Engine & Row Locking
Run the following PowerShell command to test concurrency row lock blocking:
```powershell
node -e "const sql = require('mssql/msnodesqlv8'); const cfg = { connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;' }; sql.connect(cfg).then(async pool => { const tx1 = new sql.Transaction(pool); await tx1.begin(); await new sql.Request(tx1).query('SELECT id, stock_quantity FROM products WITH (UPDLOCK, ROWLOCK) WHERE id = 1'); console.log('TX1 lock acquired'); const tx2 = new sql.Transaction(pool); await tx2.begin(); await new sql.Request(tx2).query('SET LOCK_TIMEOUT 1000; SELECT id, stock_quantity FROM products WITH (UPDLOCK, ROWLOCK) WHERE id = 1').catch(e => console.log('TX2 correctly timed out:', e.message)); await tx1.rollback(); await tx2.rollback(); process.exit(0); });"
```

### 5.2 Verifying Database Schema & Constraints
Run the following command to check existing constraints on `orders`, `products`, `shipments`:
```powershell
node -e "const sql = require('mssql/msnodesqlv8'); const cfg = { connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;' }; sql.connect(cfg).then(async pool => { const res = await pool.request().query('SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE, kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME WHERE tc.TABLE_NAME IN (\x27orders\x27, \x27shipments\x27, \x27products\x27)'); console.table(res.recordset); process.exit(0); });"
```

### 5.3 Automated Test Suite Execution (Once Implemented)
In `car-store-backend`:
```powershell
node --test test/**/*.test.js
```
The test suite should verify:
1. Health check and singleton DB connection.
2. Atomic order creation with `orders`, `order_items`, `shipments` in a single transaction with `UPDLOCK, ROWLOCK`.
3. Out-of-stock rejection (400) without orphaned rows.
4. Order cancellation stock restoration and idempotency (repeated cancellations do not duplicate stock).
5. Tracking lookup with verified PII masking.
6. Admin dashboard KPI synchronization from DB.
