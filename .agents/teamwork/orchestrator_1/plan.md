# CarModelStore Restructuring Master Plan

## 1. Objectives & Quality Gates
- **R1: UI Freeze**: 100% preservation of all HTML, CSS, classes, styling, layout, DOM tree structure. No cosmetic alterations.
- **R2: ACID Transaction & State Machine**:
  - Row locking (`UPDLOCK, ROWLOCK`) on inventory checks and deductions.
  - Snapshot customer info into order record.
  - Atomic transaction: order creation + order items + shipment record (`VNPOST-...`) + stock decrement.
  - Order cancellation state machine: cancel order -> atomic stock restoration -> shipment status updated to 'cancelled'.
- **R3: E2E Sync**:
  - `account.html`: order history and status live update.
  - `admin/dashboard.html`: stats (revenue, order count, status) and top 5 recent orders directly from DB via `/api/dashboard/stats`.
  - `contact.html`: tracking lookup via `/api/tracking/:code` with PII masking.
- **R4: Serverless & Production**:
  - Vercel singleton connection pool, robust `.env` and `.env.example`.
  - Zero unhandled promise rejections, zero SQL injection, crash-resilient.

## 2. Orchestration Roadmap
- **Phase 0: Survey full scope**
  - Explorer 1: Backend architecture, Express/API routes, database client & connection pooling, transaction logic.
  - Explorer 2: Frontend pages (account.html, contact.html, admin/dashboard.html, cart/checkout), DOM structure, event handlers, API communication.
  - Explorer 3: Database schema, tables (orders, order_items, shipments, products, customers), test runner, existing scripts.
- **Phase 1: Project Blueprint & Feature Inventory**
  - Synthesize reports into `PROJECT.md` at root.
  - Define interfaces, code layout, milestone dependencies.
- **Phase 2: Dual Track Execution**
  - Track A: E2E Testing Track (Independent test harness, Tiers 1-4 tests, publishes `TEST_READY.md`).
  - Track B: Implementation Track (Milestones 1 -> 2 -> 3).
- **Phase 3: Final Milestone & Hardening**
  - Phase 1: 100% E2E test pass (Tiers 1-4).
  - Phase 2: Adversarial coverage hardening (Tier 5).
  - Forensic Audit pass.
- **Phase 4: Verification & Sentinel Notification**
