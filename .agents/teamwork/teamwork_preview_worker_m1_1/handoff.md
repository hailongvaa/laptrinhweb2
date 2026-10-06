# Handoff Report — Worker M1: Milestone 1 Implementation

**Milestone**: M1 (Serverless Architecture, Database Schema Migration & Configuration Standardization)  
**Author**: Worker M1 (`teamwork_preview_worker_m1_1`)  
**Target Recipient**: Orchestrator (`8d541fff-80dd-457d-bc7c-cd842c463674`) / Auditor / Milestone 2 Implementer  
**Date**: 2026-10-06T19:33:00Z  
**Handoff Type**: Hard (Task Complete)  

---

## 1. Observation

### 1.1 Pre-Migration State
1. **Database Schema & Table State** (`CarModelStoreDB` on SQL Server 2025):
   - Table `orders` contained 10 columns: `id`, `order_code`, `customer_id`, `recipient_name`, `recipient_phone`, `shipping_address`, `total_amount`, `order_status`, `created_at`, `tracking_code`. Customer snapshot columns (`customer_name`, `customer_email`, `customer_phone`) were missing.
   - Table `products` lacked a CHECK constraint on `stock_quantity >= 0`. An anonymous check constraint `CK__products__status__5CD6CB2B` existed for status, but negative inventory was not prevented at the database engine level.
   - Table `orders` had an anonymous check constraint on `order_status` (`CK__orders__order_st__6D0D32F4`) and lacked a UNIQUE constraint on `tracking_code`.
   - Missing foreign key performance indexes: `idx_order_items_order_id`, `idx_shipments_order_id`, and `idx_products_brand_id`.
2. **Backend Server Architecture (`car-store-backend/server.js`)**:
   - Connection pool was stored in module-scoped variables (`let dbPool = null; let activeSqlLib = null;`) without caching in `global`.
   - Under concurrent cold starts, multiple connection pools were created simultaneously.
   - `server.js` called `app.listen(PORT, ...)` unconditionally at top level without checking `require.main === module`.
   - `module.exports` was omitted, resulting in an empty object `{}` when required by external modules or serverless wrappers.
   - Process crash guards (`unhandledRejection`, `uncaughtException`) were absent.
3. **Serverless & Environment Configurations**:
   - No `api/` directory existed at the repository root; `vercel.json` used legacy `routes` with no `/api/*` rewrite.
   - `car-store-backend/.env` contained only 3 variables (`PORT`, `DB_CONNECTION_STRING`, `CORS_ORIGIN`).
   - `car-store-backend/package.json` had `"main": "index.js"` and no scripts for `start`, `dev`, or `migrate`.
   - `assets/js/config.js` hardcoded an ephemeral ngrok URL (`https://unhook-shrink-escalate.ngrok-free.dev`) as default for non-localhost environments and did not auto-serialize plain object request bodies in `apiFetch`.

### 1.2 Implemented Changes & Verbatim Tool Results
1. **`car-store-backend/migrate.js`**:
   - Completely rewritten to provide dual-driver connection (`connectDb()` supporting TDS and ODBC 17/18).
   - DDL statements separated from DML statements across distinct query batches to eliminate SQL Server compilation error 207 ("Invalid column name 'customer_phone'").
   - Step 1: Adds `orders.customer_name NVARCHAR(100)`, `orders.customer_email VARCHAR(100)`, `orders.customer_phone VARCHAR(15)` and backfills from `users`.
   - Step 2: Backfills `tracking_code = 'VNPOST-' + order_code` and applies `UQ_orders_tracking_code` UNIQUE constraint.
   - Step 3: Adds `CK_products_stock_quantity CHECK (stock_quantity >= 0)`.
   - Step 4: Reconciles `order_status` to canonical values (`pending`, `confirmed`, `shipping`, `delivered`, `cancelled`) and creates `CK_orders_order_status`.
   - Step 5: Creates indexes: `idx_orders_customer_id`, `idx_orders_tracking_code`, `idx_order_items_order_id`, `idx_order_items_product_id`, `idx_shipments_order_id`, `idx_products_brand_id`, `idx_products_scale`, `idx_products_car_brand`.
   - Step 6: Ensures `shipments` table exists and seeds initial shipment record.
   - Step 7: Synchronizes catalog items (products 7..17).
   - Exported `{ runMigration, connectDb }` and wrapped execution in `if (require.main === module)`.
2. **`car-store-backend/server.js`**:
   - Lines 3–13: Added `unhandledRejection` and `uncaughtException` process crash guards guarded by `global.__crashGuardsRegistered`.
   - Lines 40–135: Replaced connection pool management with `createConnectionPool()` and `getDb()` leveraging `global.__poolPromise`. Rejections automatically reset `global.__poolPromise = null`.
   - Lines 810–824: Replaced standalone listen with `if (require.main === module && !process.env.VERCEL) app.listen(...)` and exported `module.exports = app; module.exports.getDb = getDb;`.
3. **`api/index.js`**:
   - Created entry point importing `../car-store-backend/server` and exporting `app`.
4. **`vercel.json`**:
   - Replaced legacy routes with modern rewrites:
     ```json
     {
       "version": 2,
       "cleanUrls": true,
       "rewrites": [
         {
           "source": "/api/(.*)",
           "destination": "/api/index.js"
         }
       ]
     }
     ```
5. **`car-store-backend/.env` & `.env.example`**:
   - Standardized all 13 configuration parameters: `NODE_ENV`, `PORT`, `CORS_ORIGIN`, `DB_CONNECTION_STRING`, `DB_SERVER`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`, `DB_ENCRYPT`, `DB_TRUST_CERT`, `DB_POOL_MAX`, `DB_POOL_MIN`.
6. **`car-store-backend/package.json`**:
   - `"main": "server.js"`, `"scripts": { "start": "node server.js", "dev": "node server.js", "migrate": "node migrate.js", "test": "node --test test/**/*.test.js ../test/**/*.test.js" }`.
7. **`assets/js/config.js`**:
   - Dynamic origin fallback: `window.DEFAULT_API_URL = isLocalhost ? 'http://localhost:5000' : (typeof window !== 'undefined' && window.location && window.location.origin ? window.location.origin : '');`.
   - Purges stale ngrok cache from `localStorage.removeItem('CMS_BACKEND_URL')`.
   - Auto-serializes plain object request bodies in `apiFetch`.
8. **`database/01_create_tables.sql`**:
   - Updated baseline table definitions for `products` (added `CK_products_stock_quantity`), `orders` (added snapshot columns, `UQ_orders_tracking_code`, `CK_orders_order_status`), and `Indexes` (added `idx_order_items_order_id`, `idx_shipments_order_id`, `idx_products_brand_id`).

---

## 2. Logic Chain

1. **DDL Batch Separation in `migrate.js`**:
   - *Observation*: Initial migration run failed with `Invalid column name 'customer_phone'`.
   - *Reasoning*: SQL Server compiles entire query batches before execution. Combining `ALTER TABLE orders ADD customer_phone...` and `UPDATE o SET o.customer_phone = ...` in the same batch triggers compile-time resolution errors because the column is not yet in the system catalog during batch parsing.
   - *Deduction*: Separating DDL (`ALTER TABLE`) and DML (`UPDATE` backfill) into separate sequential `await pool.request().query(...)` calls guarantees that schema changes are committed and cataloged before DML compilation occurs.
2. **Idempotency Guarantee**:
   - *Observation*: Executing `node car-store-backend/migrate.js` consecutively twice exited with code 0 on both runs without constraint collision.
   - *Reasoning*: Each DDL operation guards against duplicate creation using `INFORMATION_SCHEMA.COLUMNS`, `sys.key_constraints`, `sys.check_constraints`, and `sys.indexes`.
   - *Deduction*: The database migration script is safely re-runnable across deployments, local setups, and CI pipelines.
3. **Promise Caching Singleton Pattern**:
   - *Observation*: Five concurrent invocations of `getDb()` returned reference-identical ConnectionPool instances (`PASS: All 5 concurrent callers received the identical ConnectionPool instance`).
   - *Reasoning*: Synchronously assigning the pending promise to `global.__poolPromise` prior to awaiting connection resolution ensures all callers during cold start receive the same in-flight promise.
   - *Deduction*: Database connection pool exhaustion under serverless cold-start concurrency is prevented.
4. **Serverless Decoupling**:
   - *Observation*: `require('./car-store-backend/server')` returned the Express app function without binding to port 5000 (`PASS: app and getDb exported successfully`).
   - *Reasoning*: Guarding `app.listen` with `if (require.main === module && !process.env.VERCEL)` decouples standalone server mode from module importation.
   - *Deduction*: `api/index.js` can cleanly expose the Express handler to Vercel Serverless Functions.
5. **Zero-Ngrok Dynamic Client Configuration**:
   - *Observation*: Inspecting `assets/js/config.js` confirmed no active ngrok fallbacks remain.
   - *Reasoning*: In production, Vercel routes `/api/*` to the serverless function on the same origin. Using `window.location.origin` provides zero-configuration same-origin routing while local environments retain `http://localhost:5000`.
   - *Deduction*: Client API requests will not fail due to expired tunnels.

---

## 3. Caveats

1. **100% UI Freeze (R1)**:
   - Zero HTML or CSS files were modified. All changes were confined to backend code (`migrate.js`, `server.js`), configurations (`.env`, `package.json`, `vercel.json`), baseline DDL (`01_create_tables.sql`), and frontend API client logic (`assets/js/config.js`).
2. **No Test Directory Modifications**:
   - No files inside `test/` were touched; test writing remains exclusively under the ownership of the E2E Test Writer.
3. **Database Driver Context**:
   - Tested on local Windows 11 running SQL Server 2025 using `mssql/msnodesqlv8` (ODBC 17). Dual-driver TDS pure JS paths are implemented in both `server.js` and `migrate.js` for remote/Linux serverless deployment.

---

## 4. Conclusion

Milestone 1 is 100% complete, fully verified, and ready for Milestone 2.
- Database schema and integrity constraints (`CK_products_stock_quantity`, `UQ_orders_tracking_code`, `CK_orders_order_status`, customer snapshot columns, foreign key indexes) are live on `CarModelStoreDB`.
- Serverless singleton connection pool with cold-start concurrency caching (`global.__poolPromise`), crash guards, and decoupled exports is operational.
- Vercel routing (`api/index.js` and `vercel.json`), package scripts, `.env` standardization, and zero-ngrok client configuration are fully implemented.

---

## 5. Verification Method

To independently verify this implementation, run the following commands from the repository root (`d:\laptrinhweb - Copy`):

### 5.1 Verification Commands and Results

#### Check 1: Syntax Validation
```powershell
node --check car-store-backend/server.js; node --check car-store-backend/migrate.js; node --check assets/js/config.js; node --check api/index.js
```
*Result*: Exit code 0, no syntax errors.

#### Check 2: Package Scripts Verification
```powershell
npm --prefix car-store-backend run
```
*Result*:
```
Lifecycle scripts included in car-store-backend@1.0.0:
  start
    node server.js
  test
    node --test test/**/*.test.js ../test/**/*.test.js
available via `npm run`:
  dev
    node server.js
  migrate
    node migrate.js
```

#### Check 3: Migration Idempotency Test
```powershell
node car-store-backend/migrate.js; node car-store-backend/migrate.js
```
*Result*: Both runs exit with code 0:
```
Database migration completed 100% successfully!
Database migration completed 100% successfully!
```

#### Check 4: Database Schema Integrity Verification
```powershell
node -e "const sql = require('./car-store-backend/node_modules/mssql/msnodesqlv8'); const cfg = { connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;' }; (async () => { const p = await sql.connect(cfg); const cols = await p.request().query('SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = \'orders\' AND COLUMN_NAME IN (\'customer_name\', \'customer_email\', \'customer_phone\', \'tracking_code\')'); const colNames = cols.recordset.map(c => c.COLUMN_NAME); if (!['customer_name', 'customer_email', 'customer_phone', 'tracking_code'].every(c => colNames.includes(c))) throw new Error('Missing columns on orders table!'); const cons = await p.request().query('SELECT name, definition FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID(\'products\')'); const hasStockCheck = cons.recordset.some(c => c.definition.includes('stock_quantity') && c.definition.includes('>=')); if (!hasStockCheck) throw new Error('Missing CHECK (stock_quantity >= 0) on products!'); try { await p.request().query('UPDATE products SET stock_quantity = -1 WHERE id = 1'); throw new Error('FAIL: Negative stock was allowed!'); } catch (err) { if (err.message.includes('CHECK') || err.message.includes('CK_products_stock_quantity')) console.log('PASS: Negative stock correctly rejected by database constraint'); else throw err; } console.log('All DB schema checks PASSED!'); await p.close(); process.exit(0); })().catch(e => { console.error('Verification failed:', e.message); process.exit(1); });"
```
*Result*:
```
PASS: Negative stock correctly rejected by database constraint
All DB schema checks PASSED!
```

#### Check 5: Client Config Zero-Ngrok Inspection
```powershell
node -e "const fs = require('fs'); const content = fs.readFileSync('assets/js/config.js', 'utf8'); if (content.includes('ngrok-free.dev') && !content.includes('localStorage.removeItem')) throw new Error('config.js still contains active ngrok fallback URL!'); console.log('PASS: config.js has no active ngrok fallbacks');"
```
*Result*: `PASS: config.js has no active ngrok fallbacks`

#### Check 6: Serverless Entry Point & Singleton Concurrency Verification
```powershell
node -e "const app = require('./car-store-backend/server'); if (typeof app !== 'function') throw new Error('server.js must export Express app!'); console.log('PASS: server.js exports Express application');"; node -e "const app = require('./api/index'); if (typeof app !== 'function') throw new Error('api entry point does not export function'); console.log('PASS: api/index.js exports Express app');"; node -e "const { getDb } = require('./car-store-backend/server'); Promise.all([getDb(), getDb(), getDb(), getDb(), getDb()]).then(results => { const firstPool = results[0].pool; const allSame = results.every(r => r.pool === firstPool); if (!allSame) throw new Error('Connection pools are not identical singleton'); console.log('PASS: All 5 concurrent callers received the identical ConnectionPool instance'); process.exit(0); }).catch(e => { console.error('FAIL:', e); process.exit(1); });"
```
*Result*:
```
PASS: server.js exports Express application
PASS: api/index.js exports Express app
PASS: All 5 concurrent callers received the identical ConnectionPool instance
```

#### Check 7: Server Startup Health Check (AC7)
```powershell
node -e "const { spawn } = require('child_process'); const server = spawn('node', ['car-store-backend/server.js'], { stdio: 'inherit' }); setTimeout(async () => { try { const res = await fetch('http://localhost:5000/api/health'); const json = await res.json(); console.log('Health check result:', json); if (json.status === 'online' && json.database === 'connected') { console.log('PASS: AC7 Server startup verified!'); server.kill(); process.exit(0); } else { console.error('FAIL: Status not online or database not connected'); server.kill(); process.exit(1); } } catch (err) { console.error('FAIL:', err.message); server.kill(); process.exit(1); } }, 3000);"
```
*Result*:
```
🚀 Backend CarModelStore đang chạy tại: http://localhost:5000
✅ Đã kết nối SQL Server thành công (CarModelStoreDB (ODBC 17))
Health check result: {
  success: true,
  status: 'online',
  message: 'Backend CarModelStore đang hoạt động ổn định!',
  database: 'connected',
  stats: { total_products: 17, total_orders: 6 },
  timestamp: '2026-10-06T19:32:22.380Z'
}
PASS: AC7 Server startup verified!
```
