# Master Execution Plan — Generation 2 Orchestrator

## Phase 1: Milestone 2 — ACID Transactions & Two-Way State Machine
- **Goal**: Implement F3 (`POST /api/orders`) and F4 (`PUT /api/orders/:code/status`) in `car-store-backend/server.js`.
- **Target Bugs**:
  - Defect 3: Duplicate product quantities aggregated before lock/stock check (`Boundary 2.1`).
  - Defect 1: Idempotent cancellation: reject re-cancellation with 400, prevent stock inflation (`Boundary 3.1`, `Boundary 3.2`).
- **Steps**:
  1. Dispatch `teamwork_preview_worker_m2_1` armed with explorer handoff specs to update `car-store-backend/server.js`.
  2. Run gate verification:
     - 2 Reviewers (`teamwork_preview_reviewer_m2_1`, `teamwork_preview_reviewer_m2_2`)
     - 2 Challengers (`teamwork_preview_challenger_m2_1`, `teamwork_preview_challenger_m2_2`)
     - 1 Forensic Auditor (`teamwork_preview_auditor_m2_1`)
  3. Verify M2 Gate PASS in `GATE_STATUS.md`.

## Phase 2: Milestone 3 — Client & Admin End-to-End Real-Time Sync
- **Goal**: Implement F5 (PII Masking in `GET /api/tracking/:code`) and F6 (Client sync in `account.html`, `dashboard.html`, `contact.html`, `config.js`, `admin-auth.js`) under 100% UI Freeze.
- **Target Bugs**:
  - Defect 2: PII masking on public tracking (`AC6.3`, `AC6.4`, `Boundary 4.1` - `4.4`).
- **Steps**:
  1. Dispatch Explorer M3 to inspect `GET /api/tracking/:code` and frontend sync integration points.
  2. Dispatch Worker M3 to implement PII masking and frontend fixes.
  3. Run gate verification (Reviewers, Challengers, Auditor).
  4. Verify M3 Gate PASS in `GATE_STATUS.md`.

## Phase 3: Milestone 4 — Final Integration, 100% E2E Pass & Server Startup
- **Goal**: Pass 100% of E2E test suite (64/64), adversarial hardening, clean local server startup.
- **Steps**:
  1. Dispatch Final Verification Worker to run master test runner `node test/test-runner.js`.
  2. Dispatch Tier 5 Adversarial Challenger to stress-test system.
  3. Dispatch Final Forensic Auditor.
  4. Ensure server starts without errors or warnings.
  5. Compile final completion report and send message to Sentinel.
