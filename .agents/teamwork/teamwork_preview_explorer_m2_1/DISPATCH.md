# Task Assignment — Explorer M2-1 (ACID Order Creation & Row-Locking in POST /api/orders)

## Identity
- Role: Explorer
- Type: teamwork_preview_explorer
- Working directory: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m2_1
- Parent Orchestrator Conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674

## Mandatory References
- ORIGINAL_REQUEST.md: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
- PROJECT.md: d:\laptrinhweb - Copy\PROJECT.md
- TEST_READY.md: d:\laptrinhweb - Copy\TEST_READY.md

You MUST read `ORIGINAL_REQUEST.md`, `PROJECT.md`, and `TEST_READY.md` before starting work.

## Objective
Analyze and specify the complete implementation for Feature F3: ACID Order Creation & Row-Locking in `car-store-backend/server.js` (`POST /api/orders`).

## Scope
1. Examine `car-store-backend/server.js` lines 440–570 (`POST /api/orders`).
2. Design deterministic lock ordering: sort items by `productId` ascending before acquiring `UPDLOCK, ROWLOCK` to prevent deadlocks under high concurrency.
3. Design pre-aggregation of quantities: resolve Defect 3 from `TEST_READY.md` where cart payloads containing duplicate `productId` entries (e.g. `[{productId: 4, quantity: 3}, {productId: 4, quantity: 3}]`) must aggregate total quantity before stock check.
4. Enforce authoritative database pricing: retrieve `product.price` under `UPDLOCK, ROWLOCK` and compute `totalAmount` server-side, strictly ignoring any client-provided `unitPrice` to eliminate price tampering.
5. Snapshot customer information: read `customerName`, `customerEmail`, `customerPhone` from request body (or fetch from `users` if authenticated), and insert into `orders.customer_name`, `orders.customer_email`, `orders.customer_phone`.
6. Collision-resistant tracking code: generate `VNPOST-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`.
7. Clean rollback on insufficient stock: if stock < required, rollback immediately and return HTTP 400 without orphaned records. Guard against double-rollback errors (`transaction._aborted`).

## Output
Write your report to: `d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m2_1\handoff.md`
Send a completion message back to the orchestrator (conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674).


## 2026-10-06T19:43:32Z
Received dispatch message:
You are Explorer M2-1 (teamwork_preview_explorer) for Milestone 2 of the CarModelStore project.
Your working directory is: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m2_1
Your task assignment details: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m2_1\DISPATCH.md
Authoritative specifications: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
Project Blueprint: d:\laptrinhweb - Copy\PROJECT.md
TEST_READY.md: d:\laptrinhweb - Copy\TEST_READY.md

You MUST read d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md, d:\laptrinhweb - Copy\PROJECT.md, and TEST_READY.md before starting work.
Analyze and specify the complete implementation for Feature F3: ACID Order Creation & Row-Locking in car-store-backend/server.js (POST /api/orders):
1. Deterministic lock ordering (sort items by productId ascending).
2. Quantity pre-aggregation for duplicate product items in cart.
3. Authoritative database pricing (server-side price calculation, ignore client unitPrice).
4. Customer snapshotting into orders (customer_name, customer_email, customer_phone).
5. Collision-resistant tracking code (VNPOST-${Date.now()}-${random}).
6. Clean rollback on insufficient stock with double-rollback protection.
Write report to: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m2_1\handoff.md
Send a completion message back to the orchestrator (conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674).
