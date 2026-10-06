# Task Assignment — E2E Test Writer (Dual Track: E2E Testing Track)

## Identity
- Role: Test Writer
- Type: teamwork_preview_test_writer
- Working directory: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_test_writer_e2e_1
- Parent Orchestrator Conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674

## Mandatory References
- ORIGINAL_REQUEST.md: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
- PROJECT.md: d:\laptrinhweb - Copy\PROJECT.md

You MUST read `d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md` and `d:\laptrinhweb - Copy\PROJECT.md` before starting work.

## Objective
Design and implement a comprehensive, requirement-driven, opaque-box E2E test suite for CarModelStore based strictly on `ORIGINAL_REQUEST.md` (R1-R4, AC1-AC7) and `PROJECT.md § Interface Contracts`.

## Test Methodology (4 Tiers)
1. **Tier 1 - Feature Coverage (>=5 per feature or complete AC coverage)**:
   - AC1: Order creation in a single transaction (`orders`, `order_items`, `shipments` with `VNPOST-...`).
   - AC2: Out-of-stock rejection (100% blocked, 400 error, 0 orphaned rows).
   - AC3: Order cancellation restores stock and sets `shipments.shipping_status = 'cancelled'`.
   - AC4: Account sync (`account.html` order history and customer scoping).
   - AC5: Admin dashboard sync (`/api/dashboard/stats` revenue, count, top 5 orders).
   - AC6: Public tracking lookup (`/api/tracking/:code` with PII masking).
   - AC7: Server startup health and singleton connection pool stability.
2. **Tier 2 - Boundary & Corner Cases (>=5 per feature / category)**:
   - Ordering exact available stock vs stock + 1.
   - Ordering duplicate `productId` in same cart payload.
   - Repeated order cancellation idempotency (verify stock is restored exactly once, not multiplied).
   - PII masking edge cases (short names, long names, various phone formats).
   - Concurrent orders competing for the last item in stock.
3. **Tier 3 - Cross-Feature Combinations (Pairwise)**:
   - Create order -> check tracking -> cancel order -> check tracking status -> verify stock restored.
   - Multiple orders placed -> check admin dashboard revenue and order counts match DB.
4. **Tier 4 - Real-World Application Scenarios (>=5 scenarios)**:
   - Customer journey: User registers/logs in -> browses products -> checkouts with modal -> views in account -> tracks parcel.

## Implementation Details
- Framework: Node.js v24 native test runner (`node --test`, `node:assert/strict`). Zero extra npm dependencies.
- Location: Create tests under `test/` directory at project root:
  - `test/tier1-features.test.js`
  - `test/tier2-boundary.test.js`
  - `test/tier3-pairwise.test.js`
  - `test/tier4-application.test.js`
  - `test/test-runner.js` (or centralized test script)
- Create `TEST_INFRA.md` at project root following the E2E Test Infra template.
- When the test suite is created and baseline tests are executed, create `TEST_READY.md` at project root with runner command, test breakdown, and feature checklist.
- Add/update `"test": "node --test test/**/*.test.js"` in `car-store-backend/package.json` if appropriate.

## Output
Write your handoff report to `d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_test_writer_e2e_1\handoff.md` and send a completion message back to the orchestrator.


## 2026-10-06T19:17:11Z
You are the E2E Test Writer (teamwork_preview_test_writer) for the CarModelStore restructuring project.
Your working directory is: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_test_writer_e2e_1
Your task assignment details: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_test_writer_e2e_1\DISPATCH.md
Authoritative specifications: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
Project Blueprint: d:\laptrinhweb - Copy\PROJECT.md

You MUST read d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md and d:\laptrinhweb - Copy\PROJECT.md before starting work.
Design and implement the complete 4-tier E2E test suite using Node.js v24 native test runner (node --test, node:assert/strict).
1. Create TEST_INFRA.md at project root per specifications.
2. Create test files under test/ covering Tiers 1-4 (AC1 through AC7, concurrency, boundaries, pairwise combinations, user journeys).
3. Execute the tests to establish baseline.
4. When test suite is ready, create TEST_READY.md at project root.
Write your handoff report to: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_test_writer_e2e_1\handoff.md
Send a completion message back to the orchestrator (conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674) with a summary.
