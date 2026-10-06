# Task Assignment — Explorer M1-1 (Database Schema Migration & Constraints)

## Identity
- Role: Explorer
- Type: teamwork_preview_explorer
- Working directory: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m1_1
- Parent Orchestrator Conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674

## Mandatory References
- ORIGINAL_REQUEST.md: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
- PROJECT.md: d:\laptrinhweb - Copy\PROJECT.md

You MUST read `ORIGINAL_REQUEST.md` and `PROJECT.md` before starting work.

## Objective
Analyze and plan the exact, idempotent migration steps for Milestone 1 (Feature F2: Database Schema & Constraints) for CarModelStore.

## Scope
1. Examine existing schema in `database/01_create_tables.sql` and `car-store-backend/migrate.js`.
2. Design idempotent SQL Server DDL statements to:
   - Add customer snapshot columns to `orders`: `customer_name NVARCHAR(100) NULL`, `customer_email VARCHAR(100) NULL`, `customer_phone VARCHAR(15) NULL`.
   - Add UNIQUE constraint to `orders.tracking_code` (e.g., `UQ_orders_tracking_code`).
   - Add CHECK constraint on `products`: `CK_products_stock_quantity CHECK (stock_quantity >= 0)`.
   - Reconcile `orders.order_status` CHECK constraint to ensure valid states (`pending`, `confirmed`, `shipping`, `delivered`, `cancelled`).
   - Check and add any missing indexes.
3. Recommend how `car-store-backend/migrate.js` should be structured so that executing `node migrate.js` automatically and safely applies these changes without data loss.

## Output
Write your recommendations to `d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m1_1\handoff.md` and send a completion message back to the orchestrator.


## 2026-10-06T19:17:11Z
You are Explorer M1-1 (teamwork_preview_explorer) for Milestone 1 of the CarModelStore project.
Your working directory is: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m1_1
Your task assignment details: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m1_1\DISPATCH.md
Authoritative specifications: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
Project Blueprint: d:\laptrinhweb - Copy\PROJECT.md

You MUST read d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md and d:\laptrinhweb - Copy\PROJECT.md before starting work.
Analyze and specify the exact idempotent SQL Server DDL statements and migration script for Feature F2 (customer snapshot columns on orders, UNIQUE constraint on tracking_code, CHECK constraint on products.stock_quantity >= 0, and status CHECK constraints).
Write your report to: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m1_1\handoff.md
Send a completion message back to the orchestrator (conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674) with a summary.
