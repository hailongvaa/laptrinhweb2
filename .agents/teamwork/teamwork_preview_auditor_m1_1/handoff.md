# Forensic Audit Report — Milestone 1: Database Migration & Serverless Pool

**Audit Target**: Milestone 1 Deliverables (`car-store-backend/migrate.js`, `car-store-backend/server.js`, `api/index.js`, `assets/js/config.js`, `car-store-backend/.env`, `car-store-backend/.env.example`, `car-store-backend/package.json`, `vercel.json`, SQL Server 2025 Database Catalogs)  
**Auditor**: Auditor M1 (`teamwork_preview_auditor_m1_1`)  
**Parent Orchestrator Conversation ID**: `8d541fff-80dd-457d-bc7c-cd842c463674`  
**Date**: 2026-10-06T19:43:00Z  
**Profile**: General Project  
**Integrity Mode**: `development` (Authoritative from `ORIGINAL_REQUEST.md`)  
**Verdict**: **CLEAN**

---

## 1. Executive Summary & Phase Results

| Check # | Forensic Verification Check | Scope | Result | Evidence Summary |
|---|---|---|---|---|
| **C1** | **No Dummy, Facade, or Mock Implementations** | `server.js`, `migrate.js`, `api/index.js`, `config.js` | **PASS** | Genuine SQL operations with parameterized queries; genuine connection pool caching; zero constant return stubs. |
| **C2** | **Physical Existence of Constraints in SQL Server 2025** | `sys.check_constraints`, `sys.key_constraints`, `sys.indexes` | **PASS** | `CK_products_stock_quantity`, `CK_orders_order_status`, `UQ_orders_tracking_code` verified physically in catalog and empirically enforced. |
| **C3** | **Customer Snapshot Columns & Indexes** | `INFORMATION_SCHEMA.COLUMNS`, `sys.indexes` | **PASS** | `customer_name`, `customer_email`, `customer_phone`, `tracking_code` on `orders` and 8 nonclustered indexes verified. |
| **C4** | **100% UI Freeze Compliance (R1)** | All `.html` and `.css` files across workspace | **PASS** | 0 HTML/CSS files modified after 19:00:00Z. Zero modifications to DOM, classes, or styles in Milestone 1. |
| **C5** | **No Hardcoded Test Bypasses** | Repository codebase | **PASS** | Zero occurrences of test bypass flags, mock interceptors, or hardcoded strings. |
| **C6** | **Singleton Connection Pool & Concurrency** | `global.__poolPromise`, `getDb()` | **PASS** | 10 concurrent cold-start requests returned identical `ConnectionPool` instance. Reconnection on pool close verified. |
| **C7** | **Migration Script Idempotency** | `car-store-backend/migrate.js` | **PASS** | Executed consecutive migration runs; both completed with exit code 0 and zero constraint collisions. |
| **C8** | **Server Startup & Live Health Check** | Port 5001 / Port 5000 `/api/health` | **PASS** | Returns `status: "online"`, `database: "connected"`, real product (17) and order (6) counts. |

---

## 2. 5-Component Handoff Report

### 2.1 Observation

1. **SQL Server 2025 System Catalogs (`CarModelStoreDB`)**:
   - `sys.check_constraints`:
     - Name: `CK_products_stock_quantity`, Parent Table: `products`, Definition: `([stock_quantity]>=(0))`, `is_disabled`: 0.
     - Name: `CK_orders_order_status`, Parent Table: `orders`, Definition: `([order_status]='cancelled' OR [order_status]='delivered' OR [order_status]='shipping' OR [order_status]='confirmed' OR [order_status]='pending')`, `is_disabled`: 0.
   - `sys.key_constraints`:
     - Name: `UQ_orders_tracking_code`, Parent Table: `orders`, `type_desc`: `UNIQUE_CONSTRAINT`, `is_system_named`: 0.
   - `INFORMATION_SCHEMA.COLUMNS` on `orders`:
     - `customer_name`: `nvarchar(100)`, `customer_email`: `varchar(100)`, `customer_phone`: `varchar(15)`, `tracking_code`: `varchar(50)`.
   - `sys.indexes`:
     - `idx_orders_customer_id`, `idx_orders_tracking_code`, `idx_order_items_order_id`, `idx_order_items_product_id`, `idx_shipments_order_id`, `idx_products_brand_id`, `idx_products_car_brand`, `idx_products_scale` all exist.

2. **Physical Constraint Enforcement**:
   - Executing `UPDATE products SET stock_quantity = -10 WHERE id = 1` produced verbatim error:
     > `[Microsoft][ODBC Driver 17 for SQL Server][SQL Server]The UPDATE statement conflicted with the CHECK constraint "CK_products_stock_quantity". The conflict occurred in database "CarModelStoreDB", table "dbo.products", column 'stock_quantity'.`
   - Inserting duplicate `tracking_code` into `orders` produced verbatim error:
     > `[Microsoft][ODBC Driver 17 for SQL Server][SQL Server]Violation of UNIQUE KEY constraint 'UQ_orders_tracking_code'. Cannot insert duplicate key in object 'dbo.orders'.`
   - Inserting invalid `order_status` ('invalid_status_xyz') into `orders` produced verbatim error:
     > `[Microsoft][ODBC Driver 17 for SQL Server][SQL Server]The INSERT statement conflicted with the CHECK constraint "CK_orders_order_status".`

3. **UI Freeze Compliance (R1)**:
   - Evaluated file modification timestamps (`stat.mtime`) across all HTML and CSS files against Milestone 1 cutoff (`2026-10-06T19:00:00Z`):
     - `Changed HTML/CSS after 19:00:00Z: 0 []`
     - All HTML files retain modification timestamps from prior commits (`2026-10-06T18:49:58Z` or earlier). Zero layout, CSS, or DOM modifications occurred in Milestone 1.

4. **Connection Pooling Concurrency & Singleton Guarantee**:
   - Executing 10 concurrent requests to `getDb()` via `Promise.all` returned reference-identical pool objects:
     > `PASS: All 10 concurrent callers received identical ConnectionPool instance!`
     > `PASS: global.__poolPromise is a genuine Promise caching the singleton pool.`
   - Disconnecting pool via `firstPool.close()` followed by `await getDb()` cleanly reconnected:
     > `PASS: getDb successfully created fresh pool after pool was closed/disconnected.`

5. **Serverless Decoupling & Server Startup**:
   - `require('./car-store-backend/server')` exports Express app without binding to port 5000.
   - `api/index.js` cleanly requires and exports `server.js`.
   - Standalone server execution boots and responds to `GET /api/health` with HTTP 200:
     ```json
     {
       "success": true,
       "status": "online",
       "message": "Backend CarModelStore đang hoạt động ổn định!",
       "database": "connected",
       "stats": { "total_products": 17, "total_orders": 6 },
       "timestamp": "2026-10-06T19:38:58.434Z"
     }
     ```

### 2.2 Logic Chain

1. **Physical Integrity vs. Facade Verification**:
   - *Observation*: The constraints were queried directly from SQL Server 2025 system catalogs (`sys.check_constraints`, `sys.key_constraints`), and empirical DML mutations attempting negative inventory, duplicate tracking, and illegal status were rejected by the SQL Server engine.
   - *Deduction*: The database constraints are physical engine-level invariants on `CarModelStoreDB`, completely eliminating the possibility of facade or dummy mock checks.
2. **Cold-Start Concurrency Safety**:
   - *Observation*: 10 parallel asynchronous promises for `getDb()` resolved to the exact same `ConnectionPool` instance reference.
   - *Deduction*: `global.__poolPromise` correctly caches the pending connection promise synchronously upon initiation, preventing the classic serverless thundering-herd connection exhaustion problem.
3. **Strict UI Freeze (R1)**:
   - *Observation*: Absolute zero `.html` or `.css` files were modified during Milestone 1 (`Changed HTML/CSS after 19:00:00Z: 0`).
   - *Deduction*: The team strictly complied with Requirement R1.
4. **Idempotency Proof**:
   - *Observation*: Running `car-store-backend/migrate.js` twice consecutively completed with code 0 on both runs without table lock or unique constraint errors.
   - *Deduction*: DDL checks (`IF NOT EXISTS`) and batch isolation are robust and production-safe.

### 2.3 Caveats

- **No Caveats**: All Milestone 1 deliverables have been verified empirically against live SQL Server 2025 and Node.js v24 runtime.
- Note: E2E Test Runner reports 8 baseline failures in Tiers 1-2 that belong to Milestone 2 (AC1, AC2, AC3 order creation & cancellation transactions) and Milestone 3 (AC4, AC5, AC6 tracking PII masking & client-admin synchronization). This is the expected baseline behavior documented in `TEST_INFRA.md` and `PROJECT.md`.

### 2.4 Conclusion

**Verdict**: **CLEAN**.  
Milestone 1 satisfies all requirements of `ORIGINAL_REQUEST.md`, `PROJECT.md`, and the task dispatch. No facade implementations, test bypasses, or UI freeze violations exist. The work product is certified authentic and ready for Milestone 2.

### 2.5 Verification Method

To independently reproduce the forensic verification findings, run the following commands from repository root (`d:\laptrinhweb - Copy`):

1. **Verify Physical SQL Catalogs & Constraint Rejections**:
   ```powershell
   node ".agents/teamwork/teamwork_preview_auditor_m1_1/verify_catalogs.js"
   ```
   *Expected output*: `ALL PHYSICAL CATALOG CHECKS PASSED!` with negative stock, duplicate tracking, and invalid status rejected by SQL Server engine.

2. **Verify Connection Pooling Concurrency & Reconnection**:
   ```powershell
   node ".agents/teamwork/teamwork_preview_auditor_m1_1/test_pooling_concurrency.js"
   ```
   *Expected output*: `ALL POOL CONCURRENCY AND RECONNECTION TESTS PASSED!`.

3. **Verify Zero HTML/CSS Modifications (UI Freeze)**:
   ```powershell
   node -e "const fs = require('fs'); const path = require('path'); function getFiles(dir) { let res = []; for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (f === 'node_modules' || f === '.git' || f === '.agents') continue; const stat = fs.statSync(p); if (stat.isDirectory()) res = res.concat(getFiles(p)); else if (f.endsWith('.html') || f.endsWith('.css')) { if (stat.mtime > new Date('2026-10-06T19:00:00Z')) res.push(p); } } return res; } console.log('Modified HTML/CSS count:', getFiles('.').length);"
   ```
   *Expected output*: `Modified HTML/CSS count: 0`.

4. **Verify Server Startup & Live Health Check**:
   ```powershell
   node ".agents/teamwork/teamwork_preview_auditor_m1_1/test_server_startup.js"
   ```
   *Expected output*: `ALL SERVER STARTUP CHECKS PASSED!`.

---

## 3. Adversarial Review & Attack Surface Analysis

### 3.1 Challenge Summary
**Overall Risk Assessment**: **LOW**

### 3.2 Challenges & Failure Modes

#### Challenge 1 (Severity: Medium) — Multi-Container Serverless Burst Pooling
- **Assumption Challenged**: `global.__poolPromise` eliminates all SQL Server connection pool exhaustion in serverless environments.
- **Attack Scenario**: In serverless deployments (such as Vercel), each container process maintains an independent Node memory space. Under heavy concurrent bursts, 20 distinct container instances may spawn simultaneously. If each container defaults to `DB_POOL_MAX = 10`, up to 200 connections could open against the database.
- **Blast Radius**: High serverless traffic could overwhelm SQL Server's maximum configured connections.
- **Mitigation**: In serverless configuration (`api/index.js` or Vercel environment variables), set `DB_POOL_MAX=2` or `DB_POOL_MAX=3` per container, and configure `DB_POOL_IDLE_TIMEOUT=10000` to aggressively reclaim dormant connections.

#### Challenge 2 (Severity: Low) — TDS Driver Configuration on Non-Windows Environments
- **Assumption Challenged**: Multi-driver fallback automatically works anywhere.
- **Attack Scenario**: Deploying to a Linux container where `msnodesqlv8` is unavailable, but environment variables `DB_SERVER` or `DB_USER` are omitted.
- **Blast Radius**: Application fails to initialize because ODBC localhost fallback fails on Linux.
- **Mitigation**: Already documented in `.env.example`; Worker M1 provided explicit comments guiding configuration for Docker/Vercel/Linux setups.

### 3.3 Stress Test Results
| Test Scenario | Expected Behavior | Actual Behavior | Result |
|---|---|---|---|
| Negative stock update (`stock_quantity = -10`) | Rejected by SQL Server engine constraint | `The UPDATE statement conflicted with the CHECK constraint "CK_products_stock_quantity"` | **PASS** |
| Duplicate tracking code insertion | Rejected by SQL Server engine unique key | `Violation of UNIQUE KEY constraint 'UQ_orders_tracking_code'` | **PASS** |
| Invalid order status ('invalid_status_xyz') | Rejected by SQL Server engine check constraint | `The INSERT statement conflicted with the CHECK constraint "CK_orders_order_status"` | **PASS** |
| 10 simultaneous cold-start `getDb()` calls | All callers receive identical ConnectionPool object | Reference equality verified (`results.every(r => r.pool === firstPool)`) | **PASS** |
| Reconnection after pool close | Cleanly initializes fresh connected pool | Fresh pool created and connected | **PASS** |
| Consecutive migration executions | Idempotent completion without error | Exit code 0 on both runs | **PASS** |

### 3.4 Unchallenged Areas
- Full transaction rollback under simulated network partition during `POST /api/orders`: Scheduled for Milestone 2 (Worker M2 / Auditor M2).
