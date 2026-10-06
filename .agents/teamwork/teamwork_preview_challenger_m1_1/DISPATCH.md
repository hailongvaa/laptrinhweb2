# Task Assignment — Challenger M1-1 (Empirical Adversarial Stress Testing on Database Schema & Constraints)

## Identity
- Role: Challenger
- Type: teamwork_preview_challenger
- Working directory: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_challenger_m1_1
- Parent Orchestrator Conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674

## Mandatory References
- ORIGINAL_REQUEST.md: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
- PROJECT.md: d:\laptrinhweb - Copy\PROJECT.md
- Worker M1 Handoff: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m1_1\handoff.md

You MUST read `ORIGINAL_REQUEST.md`, `PROJECT.md`, and Worker M1 handoff before testing.

## Objective
Adversarially challenge the database schema, constraints, and migration scripts implemented in Milestone 1 through empirical code execution.

## Challenge Scenarios
1. **Negative Stock Insertion/Update Challenge**: Attempt directly inserting or updating `products.stock_quantity` to -1, -50, etc. Verify that SQL Server constraint `CK_products_stock_quantity` throws violation and blocks the change.
2. **Duplicate Tracking Code Challenge**: Attempt inserting two orders with the exact same `tracking_code`. Verify that `UQ_orders_tracking_code` throws violation and blocks duplicate.
3. **Invalid Order Status Challenge**: Attempt inserting/updating an order with status `'invalid_status'`, `'hack'`, or `'completed'`. Verify that `CK_orders_order_status` blocks it.
4. **Migration Idempotency & Concurrency Stress**: Run `node car-store-backend/migrate.js` multiple times concurrently or in rapid succession. Verify zero corruption or constraint collision.
5. **Customer Snapshot Verification**: Verify that existing orders have valid snapshot fields (`customer_name`, `customer_email`, `customer_phone`) populated from `users`.

Conclude with an explicit verdict: **APPROVE** or **REJECT**.

## Output
Write your findings to: `d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_challenger_m1_1\handoff.md`
Send a completion message back to the orchestrator (conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674).

## 2026-10-06T19:34:39Z
[Message] timestamp=2026-10-06T19:34:39Z sender=8d541fff-80dd-457d-bc7c-cd842c463674 priority=MESSAGE_PRIORITY_HIGH content=You are Challenger M1-1 (teamwork_preview_challenger) for Milestone 1 of the CarModelStore project.
Your working directory is: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_challenger_m1_1
Your task assignment details: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_challenger_m1_1\DISPATCH.md
Authoritative specifications: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
Project Blueprint: d:\laptrinhweb - Copy\PROJECT.md
Worker M1 Handoff: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m1_1\handoff.md

You MUST read d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md, d:\laptrinhweb - Copy\PROJECT.md, and Worker M1 handoff before testing.
Empirically stress-test Database Schema & Constraints:
1. Attempt negative stock insertion/update -> verify blocked by CK_products_stock_quantity.
2. Attempt duplicate tracking code insertion -> verify blocked by UQ_orders_tracking_code.
3. Attempt invalid order status -> verify blocked by CK_orders_order_status.
4. Stress-test migration idempotency with rapid/concurrent executions.
5. Provide an explicit verdict: APPROVE or REJECT.
Write report to: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_challenger_m1_1\handoff.md
Send a completion message back to the orchestrator (conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674).

