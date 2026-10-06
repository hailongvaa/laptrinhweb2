# Task Assignment — Auditor M1 (Forensic Integrity Auditor)

## Identity
- Role: Forensic Auditor
- Type: teamwork_preview_auditor
- Working directory: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_auditor_m1_1
- Parent Orchestrator Conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674

## Mandatory References
- ORIGINAL_REQUEST.md: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
- PROJECT.md: d:\laptrinhweb - Copy\PROJECT.md
- Worker M1 Handoff: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m1_1\handoff.md

You MUST read `ORIGINAL_REQUEST.md`, `PROJECT.md`, and Worker M1 handoff before auditing.

## Forensic Audit Scope
Perform rigorous, independent integrity verification on all code and schema modifications delivered in Milestone 1:
1. **No Mock/Dummy/Facade Implementations**:
   - Verify that `migrate.js` actually executes real SQL Server DDL on `CarModelStoreDB`.
   - Verify that constraints (`CK_products_stock_quantity`, `UQ_orders_tracking_code`, `CK_orders_order_status`) physically exist in `sys.check_constraints` and `sys.key_constraints` in SQL Server 2025.
   - Verify that `global.__poolPromise` in `server.js` is a genuine Promise-cached singleton and not a hardcoded stub.
2. **No Hardcoded Test Bypasses**:
   - Inspect `server.js`, `migrate.js`, `api/index.js`, and `assets/js/config.js` for hardcoded strings or test conditions designed to bypass verification.
3. **No Fabrication of Logs or Outputs**:
   - Verify that all claims in Worker M1's handoff correspond to genuine runtime states.
4. **UI Freeze Compliance (R1)**:
   - Audit git diff or file modification history to confirm ZERO changes to HTML tags, DOM trees, CSS files, classes, or styles.
5. **Security & Serverless Readiness**:
   - Confirm parameterized inputs are preserved and unhandled promise rejections are handled.

Conclude with an explicit, unambiguous verdict:
- **CLEAN** (if 100% genuine and compliant)
- **INTEGRITY VIOLATION** (if any cheating, fabrication, or facades are detected)

## Output
Write your audit report to: `d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_auditor_m1_1\handoff.md`
Send a completion message back to the orchestrator (conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674).


## 2026-10-06T19:34:39Z
[Message] timestamp=2026-10-06T19:34:39Z sender=8d541fff-80dd-457d-bc7c-cd842c463674 priority=MESSAGE_PRIORITY_HIGH
Content: You are Auditor M1 (teamwork_preview_auditor) for Milestone 1 of the CarModelStore project.
Your working directory is: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_auditor_m1_1
Your task assignment details: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_auditor_m1_1\DISPATCH.md
Authoritative specifications: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
Project Blueprint: d:\laptrinhweb - Copy\PROJECT.md
Worker M1 Handoff: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m1_1\handoff.md
