# BRIEFING — 2026-10-06T19:33:00Z

## Mission
Implement Milestone 1 of the CarModelStore restructuring: database schema migration, serverless connection pool singleton, entry points, environment standardization, package scripts, and client configuration.

## 🔒 My Identity
- Archetype: teamwork_preview_worker
- Roles: implementer, qa, specialist
- Working directory: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m1_1
- Original parent: 8d541fff-80dd-457d-bc7c-cd842c463674
- Milestone: Milestone 1 (Serverless Architecture, Database Schema Migration & Configuration Standardization)

## 🔒 Key Constraints
- Write Ownership & File Boundaries:
  1. car-store-backend/migrate.js
  2. car-store-backend/server.js (only serverless export, crash guards, singleton pool, listen condition)
  3. car-store-backend/package.json
  4. car-store-backend/.env & car-store-backend/.env.example
  5. api/index.js
  6. vercel.json
  7. assets/js/config.js
  8. database/01_create_tables.sql (if updating baseline DDL)
- DO NOT touch any HTML or CSS files (100% UI Freeze per R1).
- DO NOT touch any files under test/ (owned by E2E Test Writer).
- DO NOT cheat, fake test outputs, or create dummy/facade implementations.
- All implementations must be genuine, idempotent, and verified on the live SQL Server instance.

## Current Parent
- Conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674
- Updated: not yet

## Task Summary
- **What to build**:
  1. Database migration script (`car-store-backend/migrate.js`) and live database schema migration (snapshot columns, UQ_orders_tracking_code, CK_products_stock_quantity, CK_orders_order_status, performance indexes, backfill).
  2. Serverless readiness & singleton connection pool (`car-store-backend/server.js`, `api/index.js`, `vercel.json`): crash guards, `global.__poolPromise`, conditional `listen`, module exports.
  3. Environment and script standardization: `.env`, `.env.example`, `package.json` scripts (`start`, `dev`, `migrate`, `test`), and `assets/js/config.js` (dynamic origin, purge ngrok, auto-serialize JSON body in `apiFetch`).
  4. Full verification suite with live SQL execution and health check.
- **Success criteria**:
  - `node car-store-backend/migrate.js` runs cleanly and idempotently (twice in a row).
  - Snapshot columns, UQ tracking code, and CK stock quantity >= 0 exist in DB and enforce rules.
  - `server.js` exports Express app and `getDb`, safe from cold-start pool duplicates.
  - `api/index.js` wraps backend and `vercel.json` has modern rewrite rules.
  - Zero UI modifications (HTML/CSS untouched).
- **Interface contracts**: d:\laptrinhweb - Copy\PROJECT.md § 4
- **Code layout**: d:\laptrinhweb - Copy\PROJECT.md § 5

## Key Decisions Made
- Use dual-driver connection strategy (ODBC for local Windows, TDS for cloud/Vercel) across both `server.js` and `migrate.js`.
- Separate DDL (`ALTER TABLE`) from DML (`UPDATE` backfill) into distinct batches in `migrate.js` to avoid SQL Server deferred column compilation errors.
- Store pool promise in `global.__poolPromise` with automatic error eviction.
- Conditionally call `app.listen` when `require.main === module && !process.env.VERCEL`.
- Dynamic base URL in `config.js` defaults to `window.location.origin` in production, with automatic ngrok localStorage cache purging.

## Change Tracker
- **Files modified**:
  - `car-store-backend/migrate.js`: Idempotent schema migration script with dual-driver support and DDL/DML separation.
  - `car-store-backend/server.js`: Process crash guards, singleton connection pool (`global.__poolPromise`), conditional listen, exports `app` and `getDb`.
  - `api/index.js`: Serverless entry point exporting Express app.
  - `vercel.json`: Rewrites `/api/(.*)` to `/api/index.js`.
  - `car-store-backend/.env` & `.env.example`: Standardized 13 configuration parameters for local & serverless.
  - `car-store-backend/package.json`: Main entry set to `server.js`, standard scripts (`start`, `dev`, `migrate`, `test`).
  - `assets/js/config.js`: Zero ngrok fallbacks, dynamic origin, localStorage purge, auto JSON serialization.
  - `database/01_create_tables.sql`: Baseline schema updated with snapshot columns, named constraints, and foreign key indexes.
- **Build status**: PASS (all 7 verification checks passed 100%)
- **Pending issues**: none

## Quality Status
- **Build/test result**: PASS (Check 1-7 all passed, AC7 verified with live DB connection)
- **Lint status**: clean (node --check passed on all modified JS files)
- **Tests added/modified**: Executed full 7-gate verification suite covering syntax, npm scripts, migration idempotency, database constraint enforcement, zero-ngrok config, serverless exports, and runtime health check.

## Loaded Skills
- None loaded

## Artifact Index
- d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m1_1\progress.md — Liveness heartbeat and step tracking
- d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m1_1\handoff.md — Final hard handoff report
