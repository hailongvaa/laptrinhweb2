# Task Assignment — Challenger M1-2 (Empirical Adversarial Stress Testing on Serverless & Connection Pool)

## Identity
- Role: Challenger
- Type: teamwork_preview_challenger
- Working directory: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_challenger_m1_2
- Parent Orchestrator Conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674

## Mandatory References
- ORIGINAL_REQUEST.md: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
- PROJECT.md: d:\laptrinhweb - Copy\PROJECT.md
- Worker M1 Handoff: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m1_1\handoff.md

You MUST read `ORIGINAL_REQUEST.md`, `PROJECT.md`, and Worker M1 handoff before testing.

## Objective
Adversarially challenge the connection pooling singleton, serverless export, process crash guards, and client configuration through empirical code execution.

## Challenge Scenarios
1. **High-Concurrency Cold-Start Stress**: Fire 50 concurrent calls to `getDb()` simultaneously. Verify that exactly 1 connection pool is created and all 50 callers receive the identical singleton instance.
2. **Connection Failure Recovery Challenge**: Simulate a database disconnect or broken connection. Verify that `global.__poolPromise` resets to null and subsequent calls re-establish a healthy pool.
3. **Serverless Import Decoupling Challenge**: Require `car-store-backend/server.js` and `api/index.js` across multiple child processes and threads. Verify no port binding occurs and Express handlers export correctly.
4. **Crash Guard Resilience Challenge**: Emit unhandled promise rejections (`process.emit('unhandledRejection', ...)`) and uncaught exceptions. Verify the process intercepts them and remains alive.
5. **Client Configuration Tampering Challenge**: Test `apiFetch` in `assets/js/config.js` with complex nested objects, undefined, null, and verify automatic JSON serialization. Test that stale ngrok URLs in localStorage are cleared.

Conclude with an explicit verdict: **APPROVE** or **REJECT**.

## Output
Write your findings to: `d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_challenger_m1_2\handoff.md`
Send a completion message back to the orchestrator (conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674).


## 2026-10-06T19:34:39Z
You are Challenger M1-2 (teamwork_preview_challenger) for Milestone 1 of the CarModelStore project.
Your working directory is: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_challenger_m1_2
Your task assignment details: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_challenger_m1_2\DISPATCH.md
Authoritative specifications: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
Project Blueprint: d:\laptrinhweb - Copy\PROJECT.md
Worker M1 Handoff: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_worker_m1_1\handoff.md

You MUST read d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md, d:\laptrinhweb - Copy\PROJECT.md, and Worker M1 handoff before testing.
Empirically stress-test Serverless & Connection Pool:
1. High-concurrency burst test: 50 concurrent calls to getDb() -> verify single pool instance.
2. Connection error recovery -> verify global.__poolPromise resets and recovers on retry.
3. Serverless import decoupling -> verify requiring server.js does not bind port 5000.
4. Crash guard resilience -> verify process.emit('unhandledRejection') does not kill process.
5. Provide an explicit verdict: APPROVE or REJECT.
Write report to: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_challenger_m1_2\handoff.md
Send a completion message back to the orchestrator (conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674).
