# Task Assignment — Reviewer M1-2 (Serverless Architecture & Connection Pool Review)

## Identity
- Role: Reviewer
- Type: teamwork_preview_reviewer
- Working directory: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_reviewer_m1_2
- Parent Orchestrator Conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674

## Mandatory References
- ORIGINAL_REQUEST.md: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
- PROJECT.md: d:\laptrinhweb - Copy\PROJECT.md
- Worker M1 Handoff: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m1_1\handoff.md
- TEST_READY.md: d:\laptrinhweb - Copy\TEST_READY.md

You MUST read `ORIGINAL_REQUEST.md`, `PROJECT.md`, and Worker M1 handoff before reviewing.

## Review Scope
1. Review `car-store-backend/server.js`, `api/index.js`, `vercel.json`, `car-store-backend/.env`, `.env.example`, `package.json`, `assets/js/config.js`.
2. Verify promise-cached connection pool singleton (`global.__poolPromise`): test concurrent calls to `getDb()` and ensure exact same pool instance.
3. Verify serverless decoupling: requiring `server.js` exports Express app without binding to port 5000; `api/index.js` exports Express app.
4. Verify `vercel.json` rewrites for `/api/(.*)` to `/api/index.js`.
5. Verify process crash guards intercept unhandled promise rejections without crashing process.
6. Verify `assets/js/config.js` has no active ngrok fallbacks and correctly auto-serializes plain object bodies.
7. Run E2E tests: `node test/test-runner.js`.
8. Conclude with an explicit verdict: **APPROVE** or **REQUEST_CHANGES**.

## Output
Write your review report to: `d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_reviewer_m1_2\handoff.md`
Send a completion message back to the orchestrator (conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674).


## 2026-10-06T19:34:39Z
You are Reviewer M1-2 (teamwork_preview_reviewer) for Milestone 1 of the CarModelStore project.
Your working directory is: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_reviewer_m1_2
Your task assignment details: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_reviewer_m1_2\DISPATCH.md
Authoritative specifications: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
Project Blueprint: d:\laptrinhweb - Copy\PROJECT.md
Worker M1 Handoff: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m1_1\handoff.md
TEST_READY.md: d:\laptrinhweb - Copy\TEST_READY.md

You MUST read d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md, d:\laptrinhweb - Copy\PROJECT.md, and Worker M1 handoff before reviewing.
Review Serverless Architecture & Connection Pool:
1. Verify car-store-backend/server.js singleton pool (global.__poolPromise) across concurrent getDb() calls.
2. Verify serverless decoupling (module.exports = app, conditional listen), api/index.js entry point, vercel.json rewrites.
3. Verify process crash guards intercept unhandled rejections without terminating.
4. Verify config.js has no active ngrok fallbacks and correctly auto-serializes plain object bodies.
5. Run E2E tests: node test/test-runner.js.
6. Provide an explicit verdict: APPROVE or REQUEST_CHANGES.
Write report to: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_reviewer_m1_2\handoff.md
Send a completion message back to the orchestrator (conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674).
