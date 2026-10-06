# Task Assignment — Explorer M2-2 (Bidirectional State Machine & Idempotent Order Cancellation)

## Identity
- Role: Explorer
- Type: teamwork_preview_explorer
- Working directory: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m2_2
- Parent Orchestrator Conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674

## Mandatory References
- ORIGINAL_REQUEST.md: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
- PROJECT.md: d:\laptrinhweb - Copy\PROJECT.md
- TEST_READY.md: d:\laptrinhweb - Copy\TEST_READY.md

You MUST read `ORIGINAL_REQUEST.md`, `PROJECT.md`, and `TEST_READY.md` before starting work.

## Objective
Analyze and specify the complete implementation for Feature F4: Bidirectional State Machine & Idempotent Order Cancellation in `car-store-backend/server.js` (`PUT /api/orders/:code/status`).

## Scope
1. Examine `car-store-backend/server.js` lines 352–439 (`PUT /api/orders/:code/status`).
2. Design order locking and state validation:
   - Lock target order with `SELECT id, order_status, tracking_code FROM orders WITH (UPDLOCK, ROWLOCK) WHERE order_code = @code OR tracking_code = @code`.
   - If not found, return HTTP 404.
3. Design idempotency guard against double-cancellation (Defect 1 in `TEST_READY.md`):
   - If requested status is `'cancelled'`, check `current_status`:
   - If `current_status === 'cancelled'`, reject immediately with HTTP 400 (`{ success: false, error: 'Đơn hàng đã ở trạng thái cancelled, không thể hủy lại.' }`) and DO NOT re-increment inventory.
   - If `current_status === 'delivered'`, reject cancellation with HTTP 400 (`{ success: false, error: 'Đơn hàng đã giao thành công, không thể hủy.' }`).
4. Atomic inventory restoration:
   - When transitioning from a non-cancelled state to `'cancelled'`, atomically restore stock for all items in the order:
     `UPDATE p SET p.stock_quantity = p.stock_quantity + oi.quantity FROM products p INNER JOIN order_items oi ON p.id = oi.product_id WHERE oi.order_id = @orderId`.
   - Update `products.status = 'in_stock'` where `stock_quantity > 0` and `status = 'out_of_stock'`.
5. Atomic shipment status synchronization:
   - In the same transaction, update `shipments.shipping_status = 'cancelled'`, `updated_at = GETDATE()` where `order_id = @orderId`.
6. Enforce canonical status values compliant with `CK_orders_order_status` (`pending`, `confirmed`, `shipping`, `delivered`, `cancelled`). Disallow `'completed'` or map `'completed'` to `'delivered'`.

## Output
Write your report to: `d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m2_2\handoff.md`

## 2026-10-06T19:43:32Z
You are Explorer M2-2 (teamwork_preview_explorer) for Milestone 2 of the CarModelStore project.
Your working directory is: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m2_2
Your task assignment details: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m2_2\DISPATCH.md
Authoritative specifications: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
Project Blueprint: d:\laptrinhweb - Copy\PROJECT.md
TEST_READY.md: d:\laptrinhweb - Copy\TEST_READY.md

You MUST read d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md, d:\laptrinhweb - Copy\PROJECT.md, and TEST_READY.md before starting work.
Analyze and specify the complete implementation for Feature F4: Bidirectional State Machine & Idempotent Order Cancellation in car-store-backend/server.js (PUT /api/orders/:code/status):
1. Row-locking target order with UPDLOCK, ROWLOCK.
2. Idempotency guard: reject repeated cancel requests on already-cancelled orders without restoring stock again.
3. Atomic stock restoration: update products.stock_quantity and update products.status = 'in_stock'.
4. Atomic shipment synchronization: update shipments.shipping_status = 'cancelled'.
5. Status CHECK constraint compliance (pending, confirmed, shipping, delivered, cancelled).
Write report to: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m2_2\handoff.md
Send a completion message back to the orchestrator (conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674).

