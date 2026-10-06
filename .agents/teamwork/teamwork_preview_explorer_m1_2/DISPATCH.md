# Task Assignment — Explorer M1-2 (Serverless Entry & Singleton Pool)

## Identity
- Role: Explorer
- Type: teamwork_preview_explorer
- Working directory: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m1_2
- Parent Orchestrator Conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674

## Mandatory References
- ORIGINAL_REQUEST.md: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
- PROJECT.md: d:\laptrinhweb - Copy\PROJECT.md

You MUST read `ORIGINAL_REQUEST.md` and `PROJECT.md` before starting work.

## Objective
Analyze and plan the implementation for Milestone 1 (Feature F1: Serverless Architecture & Connection Pooling Singleton) for CarModelStore.

## Scope
1. Examine `car-store-backend/server.js` connection pooling logic (`getDb()`).
   - Design a promise-cached connection pool singleton (`global.__poolPromise`) to eliminate cold-start race conditions.
   - Ensure support for both Windows ODBC (`msnodesqlv8`) and pure JS TDS (`mssql`) for Linux/Vercel serverless.
2. Design the serverless entry point:
   - Make `car-store-backend/server.js` exportable (`module.exports = app`) while conditionally starting `app.listen()` when run directly (`if (require.main === module)` or `if (!process.env.VERCEL)`).
   - Create root `api/index.js` importing the app for Vercel Serverless Function execution.
   - Configure `vercel.json` rewrites to route `/api/(.*)` to `/api/index.js`.
3. Add process-level crash guards (`process.on('unhandledRejection', ...)` and `process.on('uncaughtException', ...)`).

## Output
Write your recommendations to `d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m1_2\handoff.md` and send a completion message back to the orchestrator.


## 2026-10-06T19:17:11Z
You are Explorer M1-2 (teamwork_preview_explorer) for Milestone 1 of the CarModelStore project.
Your working directory is: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m1_2
Your task assignment details: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m1_2\DISPATCH.md
Authoritative specifications: d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md
Project Blueprint: d:\laptrinhweb - Copy\PROJECT.md

You MUST read d:\laptrinhweb - Copy\.agents\teamwork\ORIGINAL_REQUEST.md and d:\laptrinhweb - Copy\PROJECT.md before starting work.
Analyze and plan the implementation for Feature F1: Serverless Architecture & Connection Pooling Singleton.
Design promise-cached connection pool singleton (global.__poolPromise), exportable server.js, api/index.js Vercel entry point, vercel.json rewrites, and process-level crash guards.
Write your report to: d:\laptrinhweb - Copy\.agents\teamwork\teamwork_preview_explorer_m1_2\handoff.md
Send a completion message back to the orchestrator (conversation ID: 8d541fff-80dd-457d-bc7c-cd842c463674) with a summary.
