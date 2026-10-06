# Task Assignment — Reviewer M1-1 (Database Schema & Migration Review)

## Identity
- Role: Reviewer
- Type: teamwork_preview_reviewer
- Working directory: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_reviewer_m1_1
- Parent Orchestrator Conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674

## Mandatory References
- ORIGINAL_REQUEST.md: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
- PROJECT.md: d:\laptrinhweb - Copy\PROJECT.md
- Worker M1 Handoff: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m1_1\handoff.md
- TEST_READY.md: d:\laptrinhweb - Copy\TEST_READY.md

You MUST read `ORIGINAL_REQUEST.md`, `PROJECT.md`, and Worker M1 handoff before reviewing.

## Review Scope
1. Review `car-store-backend/migrate.js` and `database/01_create_tables.sql`.
2. Verify migration idempotency (run `node car-store-backend/migrate.js` twice).
3. Verify customer snapshot columns (`customer_name`, `customer_email`, `customer_phone`) exist on `orders` and are populated.
4. Verify constraints on SQL Server: `UQ_orders_tracking_code` (UNIQUE), `CK_products_stock_quantity` (stock >= 0), `CK_orders_order_status`.
5. Test negative stock rejection: verify updating stock to -1 is blocked by SQL Server.
6. Run E2E tests: `node test/test-runner.js`.
7. Conclude with an explicit verdict: **APPROVE** or **REQUEST_CHANGES**.

## Output
Write your review report to: `d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_reviewer_m1_1\handoff.md`
Send a completion message back to the orchestrator (conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674).

## 2026-10-06T19:34:39Z
You are Reviewer M1-1 (teamwork_preview_reviewer) for Milestone 1 of the CarModelStore project.
Your working directory is: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_reviewer_m1_1
Your task assignment details: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_reviewer_m1_1\DISPATCH.md
Authoritative specifications: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
Project Blueprint: d:\laptrinhweb - Copy\PROJECT.md
Worker M1 Handoff: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m1_1\handoff.md
TEST_READY.md: d:\laptrinhweb - Copy\TEST_READY.md

You MUST read d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md, d:\laptrinhweb - Copy\PROJECT.md, and Worker M1 handoff before reviewing.
Review Database Schema & Migration:
1. Verify car-store-backend/migrate.js idempotency and database/01_create_tables.sql updates.
2. Verify customer snapshot columns on orders table.
3. Verify SQL Server constraints: UQ_orders_tracking_code, CK_products_stock_quantity, CK_orders_order_status.
4. Test negative stock rejection.
5. Run E2E tests: node test/test-runner.js.
6. Provide an explicit verdict: APPROVE or REQUEST_CHANGES.
Write report to: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_reviewer_m1_1\handoff.md
Send a completion message back to the orchestrator (conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674).
