# Task Assignment — Worker M1 (Implementation of Milestone 1)

## Identity
- Role: Worker
- Type: teamwork_preview_worker
- Working directory: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m1_1
- Parent Orchestrator Conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674

## Mandatory References
- ORIGINAL_REQUEST.md: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
- PROJECT.md: d:\laptrinhweb - Copy\PROJECT.md
- Explorer M1-1 Report (Schema & DDL): d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m1_1\handoff.md
- Explorer M1-2 Report (Serverless & Singleton Pool): d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m1_2\handoff.md
- Explorer M1-3 Report (Config, Environment & Verification): d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m1_3\handoff.md

You MUST read `ORIGINAL_REQUEST.md`, `PROJECT.md`, and the three Explorer handoff reports before implementing.

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Write Ownership & File Boundaries
You exclusively own and may edit the following files:
1. `car-store-backend/migrate.js`
2. `car-store-backend/server.js` (only serverless export, crash guards, singleton pool, listen condition)
3. `car-store-backend/package.json`
4. `car-store-backend/.env` & `car-store-backend/.env.example`
5. `api/index.js`
6. `vercel.json`
7. `assets/js/config.js`
8. `database/01_create_tables.sql` (if updating baseline DDL)

DO NOT touch any HTML or CSS files (100% UI Freeze per R1).
DO NOT touch any files under `test/` (owned by E2E Test Writer).

## Scope of Work (Milestone 1)
1. **Database Migration Script (`car-store-backend/migrate.js`)**:
   Implement the complete idempotent migration script designed by Explorer M1-1:
   - Add customer snapshot columns (`customer_name NVARCHAR(100)`, `customer_email VARCHAR(100)`, `customer_phone VARCHAR(15)`) to `orders` and backfill historical rows from `users`.
   - Add UNIQUE constraint `UQ_orders_tracking_code` on `orders.tracking_code`.
   - Add CHECK constraint `CK_products_stock_quantity CHECK (stock_quantity >= 0)` on `products`.
   - Reconcile CHECK constraint `CK_orders_order_status` on `orders.order_status` for canonical values (`pending`, `confirmed`, `shipping`, `delivered`, `cancelled`).
   - Add missing indexes: `idx_order_items_order_id`, `idx_shipments_order_id`, `idx_products_brand_id`.
   - Execute `node car-store-backend/migrate.js` to migrate the local database.

2. **Serverless Architecture & Singleton Pool (`car-store-backend/server.js`, `api/index.js`, `vercel.json`)**:
   Implement specifications from Explorer M1-2:
   - Add process crash guards (`unhandledRejection`, `uncaughtException`) in `server.js`.
   - Implement promise-cached connection pool singleton (`global.__poolPromise`) supporting both ODBC and TDS drivers.
   - Decouple standalone listen: `if (require.main === module && !process.env.VERCEL) app.listen(...)`.
   - Export Express app: `module.exports = app; module.exports.getDb = getDb;`.
   - Create `api/index.js` importing `../car-store-backend/server` and exporting `app`.
   - Update `vercel.json` rewrites: `[ { "source": "/api/(.*)", "destination": "/api/index.js" } ]`.

3. **Environment Standardization & Package Scripts (`.env`, `.env.example`, `package.json`, `config.js`)**:
   Implement specifications from Explorer M1-3:
   - Standardize `.env` and `.env.example` with all 13 parameters (`DB_POOL_MAX`, `DB_POOL_MIN`, `DB_TRUST_CERT`, `NODE_ENV`, etc.).
   - Update `package.json`: `"main": "server.js"`, scripts: `"start"`, `"dev"`, `"migrate"`, `"test"`.
   - Update `assets/js/config.js`: remove ngrok fallback, use dynamic origin, purge stale ngrok from localStorage, and auto-serialize plain object body in `apiFetch`.

4. **Verification**:
   Execute the verification checks from Explorer M1-3 and M1-2:
   - Run `node --check` on modified JS files.
   - Run `node car-store-backend/migrate.js` twice (idempotency check).
   - Test database constraints (especially negative stock rejection).
   - Verify serverless export: `node -e "const app = require('./car-store-backend/server'); console.log(typeof app);"`
   - Verify health check on live server.

## Output
Write your comprehensive implementation report with exact verification outputs to:
`d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m1_1\handoff.md`
and send a completion message back to the orchestrator.


## 2026-10-06T19:24:24Z
You are Worker M1 (teamwork_preview_worker) for Milestone 1 of the CarModelStore restructuring project.
Your working directory is: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m1_1
Your task assignment details: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m1_1\DISPATCH.md
Authoritative specifications: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
Project Blueprint: d:\laptrinhweb - Copy\PROJECT.md
Explorer M1-1 Report: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m1_1\handoff.md
Explorer M1-2 Report: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m1_2\handoff.md
Explorer M1-3 Report: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m1_3\handoff.md
