# DISPATCH — Worker M2-1

## Identity
- Role: Worker for Milestone 2 (ACID Transactions & Two-Way State Machine)
- Working Directory: `d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m2_1`
- Exclusively Owned Files: `car-store-backend/server.js`

## Required Context & Reference Files
- Original Request: `d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md`
- Master Blueprint: `d:\laptrinhweb - Copy\PROJECT.md`
- Test Harness: `d:\laptrinhweb - Copy\TEST_READY.md`
- Explorer M2-1 Complete Specification & Code: `d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m2_1\handoff.md`

## Mandate
You are assigned to implement Milestone 2:
1. Feature F3: ACID Order Creation & Row-Locking in `car-store-backend/server.js` (`POST /api/orders`):
   - Deterministic sorting by `productId` ascending to prevent deadlocks.
   - Pre-aggregation of quantities for duplicate product entries in payload (Defect 3 / `Boundary 2.1`).
   - Row-locking with `UPDLOCK, ROWLOCK` on `products`.
   - Authoritative DB pricing (`product.price`) ignoring client `unitPrice`.
   - Customer snapshot: populate `customer_name`, `customer_email`, `customer_phone` on `orders`.
   - Unique tracking code: `VNPOST-${Date.now()}-${random}` and order code: `ORD-${Date.now()}-${random}`.
   - Atomic shipment insertion in `shipments`.
   - Driver-safe rollback guard (`rollbackSafely()`) avoiding double rollback.
   - Comprehensive response matching `PROJECT.md § 4.2`.
2. Feature F4: Bidirectional State Machine & Idempotent Cancel in `car-store-backend/server.js` (`PUT /api/orders/:code/status`):
   - Row-lock order record with `UPDLOCK, ROWLOCK`.
   - Check existing status: if already `'cancelled'`, reject with HTTP 400 (`{ success: false, error: 'Đơn hàng đã ở trạng thái cancelled, không thể hủy lại.' }`) without restoring stock!
   - If transitioning to `'cancelled'`, atomically restore product stock and update `shipments.shipping_status = 'cancelled'`.
3. Verification:
   - Run: `node --test test/tier1-features.test.js`
   - Run: `node --test test/tier2-boundary.test.js`
   - Run: `node test/test-runner.js`
   - Verify that Defect 1 and Defect 3 are completely resolved and test pass count increases from 56/64 to at least 59/64 (Defect 2 is M3).
   - Document commands, test results, and diffs in `d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m2_1\handoff.md`.

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.


## 2026-10-06T20:02:31Z
You are Worker M2-1 for Milestone 2 (ACID Transactions & Two-Way State Machine) in the CarModelStore restructuring project.
Your working directory is: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m2_1
You exclusively own and may modify: d:\laptrinhweb - Copy\car-store-backend\server.js

MANDATORY FIRST STEPS:
1. Read the user original request: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
2. Read the master blueprint: d:\laptrinhweb - Copy\PROJECT.md
3. Read the test harness: d:\laptrinhweb - Copy\TEST_READY.md
4. Read the detailed implementation specification and ready code from Explorer M2-1: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m2_1\handoff.md
5. Read your dispatch: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m2_1\DISPATCH.md
