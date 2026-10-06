# Handoff Report — Explorer M1-2
**Feature**: F1 — Serverless Architecture & Connection Pooling Singleton  
**Milestone**: M1  
**Target Project**: CarModelStore (`d:\laptrinhweb - Copy`)  
**Date**: 2026-10-06  
**Authoritative References**: `ORIGINAL_REQUEST.md` (R4), `PROJECT.md` (Features F1 & Feature Inventory Section 2, Section 4.1)

---

## 1. Observation

### 1.1 Connection Pool Architecture in `car-store-backend/server.js`
- **Location**: `car-store-backend/server.js`, Lines 27–43:
  ```javascript
  // Connection Pool Singleton
  let dbPool = null;
  let activeSqlLib = null;

  // Cấu hình danh sách chuỗi kết nối
  const dbConfigs = [
      ...(process.env.DB_CONNECTION_STRING ? [{ name: 'Custom DB_CONNECTION_STRING', conn: process.env.DB_CONNECTION_STRING }] : []),
      { name: 'CarModelStoreDB (ODBC 17)', conn: 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;' },
      { name: 'CarModelStoreDB (ODBC 18)', conn: 'Driver={ODBC Driver 18 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;TrustServerCertificate=yes;' },
      { name: 'car_order_db (ODBC 17)', conn: 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=car_order_db;Trusted_Connection=yes;' },
      { name: 'car_order_db (ODBC 18)', conn: 'Driver={ODBC Driver 18 for SQL Server};Server=localhost;Database=car_order_db;Trusted_Connection=yes;TrustServerCertificate=yes;' }
  ];

  async function getDb() {
      if (dbPool && dbPool.connected) {
          return { pool: dbPool, sql: activeSqlLib };
      }
      ...
  ```
- **Observed Behavior**:
  1. The connection cache is stored in local module-level variables (`let dbPool = null; let activeSqlLib = null;`), NOT on the global scope (`global`).
  2. The gate condition `if (dbPool && dbPool.connected)` only guards if `dbPool` is ALREADY fully resolved and connected.
  3. Under cold-start concurrency (e.g. 10 simultaneous HTTP requests on server boot or serverless invocation), all 10 requests evaluate `dbPool === null`. Each request initiates a separate `new ConnectionPool(...).connect()` call concurrently.
  4. Verified empirically via Node.js script: when 5 asynchronous callers invoke an uncached pool creation function concurrently, 5 distinct connection pools are instantiated simultaneously, causing socket contention, connection exhaustion, and pool leakage.
  5. There is no `pool.on('error', ...)` listener attached to handle transient drops or broken connections.
  6. If a connection drops during runtime (`pool.connected === false`), `getDb()` does not gracefully clean up old pool event listeners before re-instantiating.

### 1.2 Module Export and Standalone Server Execution
- **Location**: `car-store-backend/server.js`, Lines 768–774:
  ```javascript
  // Khởi động Server
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
      console.log(`🚀 Backend CarModelStore đang chạy tại: http://localhost:${PORT}`);
      // Kết nối thử DB ngay khi start server
      getDb().catch(() => {});
  });
  ```
- **Observed Behavior**:
  1. `server.js` unconditionally calls `app.listen(PORT, ...)` at the top-level script body upon evaluation.
  2. `server.js` does NOT export the Express `app` (`module.exports` is omitted, defaulting to `{}`).
  3. Verified via CLI command:
     ```powershell
     node -e "const app = require('./server'); console.log('isFunction:', typeof app === 'function', 'keys:', Object.keys(app)); process.exit(0);"
     ```
     Result:
     ```
     isFunction: false keys: []
     ```
  4. Attempting to require `car-store-backend/server.js` inside a serverless function wrapper (e.g., `api/index.js`) or automated test suite immediately triggers an unintended port bind to `PORT 5000` and yields an empty object instead of the Express application function. In a Vercel Serverless environment, this throws `TypeError: app is not a function`.

### 1.3 Absence of Vercel Serverless Entry Point
- **Location**: Project Root (`d:\laptrinhweb - Copy`)
- **Observed Behavior**:
  1. Directory listing confirms that no `api/` directory exists at the project root.
  2. Vercel Serverless Functions require an entry point under `/api` (specifically `api/index.js` or `api/[...route].js`). Without this, Vercel cannot deploy the backend as a Serverless Function.

### 1.4 Routing Configuration in `vercel.json`
- **Location**: `vercel.json`, Lines 1–13:
  ```json
  {
    "version": 2,
    "cleanUrls": true,
    "routes": [
      {
        "handle": "filesystem"
      },
      {
        "src": "/(.*)",
        "dest": "/$1"
      }
    ]
  }
  ```
- **Observed Behavior**:
  1. The configuration uses legacy Vercel `routes` syntax.
  2. There are NO rewrites or route rules for `/api/(.*)`.
  3. Any client request sent to `/api/*` on Vercel returns HTTP 404 (static filesystem miss).

### 1.5 Process-Level Crash Guards
- **Location**: `car-store-backend/server.js`, Lines 1–25:
  ```javascript
  require('dotenv').config();
  const express = require('express');
  const cors = require('cors');
  const path = require('path');

  const app = express();
  ...
  ```
- **Observed Behavior**:
  1. There are no process-level event handlers for `unhandledRejection` or `uncaughtException`.
  2. In Node.js (v24), an unhandled promise rejection triggers immediate process crash with exit code 1. A single rejected asynchronous database query or unhandled third-party promise will crash the entire backend process or terminate the serverless container instance.

### 1.6 Database Drivers & Runtime Environment Verification
- **Execution**:
  ```powershell
  node -e "const sql = require('mssql/msnodesqlv8'); const p = new sql.ConnectionPool({ connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;' }); p.connect().then(async () => { const r = await p.request().query('SELECT count(*) as cnt FROM products'); console.log('Products count:', r.recordset[0].cnt); await p.close(); }).catch(e => console.error(e));"
  ```
- **Result**: `Products count: 17`.
- **Driver Support Analysis**:
  - Windows Local: Microsoft SQL Server 2025 Enterprise Evaluation Edition on Windows 11. Supported by `mssql/msnodesqlv8` using ODBC Driver 17/18 with Windows Authentication (`Trusted_Connection=yes`).
  - Cloud / Linux / Vercel Serverless: Pure JavaScript TDS driver (`mssql`) connecting over TCP port 1433 via SQL Authentication (`DB_SERVER`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`, `DB_PORT`, `DB_ENCRYPT`, `DB_TRUST_CERT`). `msnodesqlv8` is a native Windows binary and cannot be loaded on Linux containers.

---

## 2. Logic Chain

### 2.1 From Observation 1.1 to Singleton Promise Caching Design (`global.__poolPromise`)
1. **Premise 1**: When an application boots up under high initial load or in a serverless cold-start scenario, multiple incoming requests execute concurrently within the same event loop tick.
2. **Premise 2**: A standard pool instance check (`if (dbPool && dbPool.connected)`) evaluates to `false` for every request that arrives while the initial connection attempt is asynchronous and pending (`in-flight`).
3. **Premise 3**: In serverless containers (e.g. AWS Lambda / Vercel), module-scoped variables may be re-initialized if modules are re-evaluated, whereas the Node.js `global` object persists across warm invocations within the same container execution context.
4. **Deduction 1**: Caching the **in-flight Promise** itself synchronously on `global.__poolPromise` before performing the first `await` ensures that all concurrent callers in the initial batch receive and await the exact same Promise.
5. **Deduction 2**: If the connection attempt rejects (e.g., temporary database network timeout), leaving `global.__poolPromise` intact would cause all subsequent requests to perpetually fail with the cached rejection. Therefore, an error handler must immediately invalidate `global.__poolPromise = null` on failure so that subsequent calls can initiate a retry.
6. **Deduction 3**: If the database server restarts or closes idle connections (`pool.connected === false`), `getDb()` must detect the stale connection, invalidate `global.__poolPromise = null`, and establish a fresh connection pool.

### 2.2 From Observation 1.2 & 1.3 to Exportable `server.js` and `api/index.js`
1. **Premise 1**: Vercel Serverless Functions require an entry file located in the `api/` directory that exports a request listener function or Express instance (`module.exports = app`).
2. **Premise 2**: Calling `app.listen(PORT)` inside a serverless execution environment binds to a network port, which either throws `EADDRINUSE`, exhausts port handles, or keeps the Node.js event loop active, preventing lambda container sleep/completion.
3. **Premise 3**: In CommonJS Node.js, `require.main === module` evaluates to `true` if and only if the file is the direct entry point of the Node process (`node server.js` or `npm start`). When imported by another file (such as `api/index.js` or a test runner), `require.main === module` evaluates to `false`.
4. **Deduction 1**: Conditionally invoking `app.listen(PORT)` with `if (require.main === module && !process.env.VERCEL)` allows `server.js` to run seamlessly as a standalone Express server locally, while acting purely as a module export when imported.
5. **Deduction 2**: Creating `api/index.js` at the root and requiring `../car-store-backend/server` allows Vercel to route incoming serverless function requests directly to the configured Express application.

### 2.3 From Observation 1.4 to `vercel.json` Modern Rewrites Configuration
1. **Premise 1**: Vercel V2 configurations reject configurations that define both `routes` and `rewrites` simultaneously.
2. **Premise 2**: Modern Vercel deployments use `rewrites` to map API paths to serverless function endpoints while allowing static files (HTML, CSS, JS, images) to be served automatically from the root filesystem edge cache.
3. **Deduction**: Replacing the legacy `routes` array in `vercel.json` with:
   ```json
   "rewrites": [
     { "source": "/api/(.*)", "destination": "/api/index.js" }
   ]
   ```
   guarantees that:
   - All static assets (`/index.html`, `/products.html`, `/assets/*`, `/admin/*`) are served directly at the edge CDN.
   - All `/api/*` traffic is routed to the serverless function `api/index.js`.
   - `req.url` retains the full `/api/...` path, perfectly matching the Express route definitions in `server.js`.

### 2.4 From Observation 1.5 to Process-Level Crash Guards
1. **Premise 1**: Asynchronous database queries, transactions, and network operations can produce unhandled promise rejections if any edge case bypasses route-level try/catch blocks.
2. **Premise 2**: Node.js v24 terminates the process immediately upon unhandled promise rejections.
3. **Deduction**: Registering `process.on('unhandledRejection', ...)` and `process.on('uncaughtException', ...)` at the top of `server.js` (guarded by `if (!global.__crashGuardsRegistered)`) intercepts unhandled errors, logs detailed diagnostics, and prevents abrupt process termination.

---

## 3. Caveats

1. **Vercel Serverless Function Execution Timeouts**:
   - Vercel Hobby accounts enforce a 10-second maximum execution timeout per serverless function (60 seconds on Pro). Database operations, especially atomic transactions with `UPDLOCK, ROWLOCK` (Milestone 2), must execute and commit well within 5 seconds to prevent function termination mid-transaction.
2. **Serverless Connection Limits on Remote SQL Server**:
   - If deployed to Vercel, serverless function instances scale horizontally with traffic. If 20 lambda instances run concurrently, each with `max: 10`, up to 200 database connections could be requested. Therefore, connection pool parameters must be tuned for serverless: `min: 0`, `max: 10` (or `DB_POOL_MAX` env var), and `idleTimeoutMillis: 30000` to ensure idle connections drain rapidly.
3. **Driver Differences between Windows and Linux/Vercel**:
   - `msnodesqlv8` is a Windows-only native ODBC driver. When deploying to Vercel (Linux Amazon Linux container), the application MUST connect using pure JavaScript TDS (`mssql`) with `DB_SERVER`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`, and `DB_DATABASE`. The connection factory must maintain seamless dual-driver fallback.
4. **Separation of Milestone Boundaries**:
   - Database schema enhancements and table migrations belong to Feature F2 (handled by Explorer M1-1).
   - `.env`, `.env.example`, and package script standardization belong to Explorer M1-3.
   - UI Freeze constraint (R1) is strictly respected: zero HTML/CSS changes are proposed.

---

## 4. Conclusion

Feature F1 requires three targeted, fully coordinated implementation steps:
1. **Upgrade `car-store-backend/server.js`**:
   - Add process-level crash guards at the top.
   - Replace lines 27–99 with a resilient connection pool factory (`createConnectionPool()`) and a promise-cached singleton (`getDb()`) using `global.__poolPromise`.
   - Replace lines 768–774 with conditional server listening (`if (require.main === module && !process.env.VERCEL)`) and module exports (`module.exports = app; module.exports.getDb = getDb;`).
2. **Create Root `api/index.js`**:
   - Instantiate Vercel Serverless Function entry point importing `../car-store-backend/server` and exporting `app`.
3. **Update Root `vercel.json`**:
   - Replace legacy `routes` with modern `rewrites` forwarding `/api/(.*)` to `/api/index.js`.

### 4.1 Detailed Implementation Specifications

#### A. Modifications to `car-store-backend/server.js`

**Step 1: Process Crash Guards (Add at Lines 1–6)**
```javascript
require('dotenv').config();

// Process-level crash guards to prevent unhandled rejection termination
if (!global.__crashGuardsRegistered) {
    global.__crashGuardsRegistered = true;
    process.on('unhandledRejection', (reason, promise) => {
        console.error('💥 [CRASH GUARD] Unhandled Promise Rejection at:', promise, 'reason:', reason);
    });
    process.on('uncaughtException', (err, origin) => {
        console.error('💥 [CRASH GUARD] Uncaught Exception:', err, 'origin:', origin);
    });
}

const express = require('express');
const cors = require('cors');
const path = require('path');
```

**Step 2: Promise-Cached Connection Pool Singleton (`global.__poolPromise`) (Replace Lines 27–99)**
```javascript
// Connection Pool Singleton & Configuration
const dbConfigs = [
    ...(process.env.DB_CONNECTION_STRING ? [{ name: 'Custom DB_CONNECTION_STRING', conn: process.env.DB_CONNECTION_STRING }] : []),
    { name: 'CarModelStoreDB (ODBC 17)', conn: 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;' },
    { name: 'CarModelStoreDB (ODBC 18)', conn: 'Driver={ODBC Driver 18 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;TrustServerCertificate=yes;' },
    { name: 'car_order_db (ODBC 17)', conn: 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=car_order_db;Trusted_Connection=yes;' },
    { name: 'car_order_db (ODBC 18)', conn: 'Driver={ODBC Driver 18 for SQL Server};Server=localhost;Database=car_order_db;Trusted_Connection=yes;TrustServerCertificate=yes;' }
];

async function createConnectionPool() {
    const poolConfig = {
        max: parseInt(process.env.DB_POOL_MAX || '10', 10),
        min: parseInt(process.env.DB_POOL_MIN || '0', 10),
        idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10)
    };

    // 1. Thử kết nối TDS (Remote Cloud / Serverless Azure SQL / AWS RDS / Vercel)
    if (process.env.DB_SERVER && process.env.DB_USER) {
        try {
            const pureSql = require('mssql');
            const tdsConfig = {
                user: process.env.DB_USER,
                password: process.env.DB_PASSWORD,
                server: process.env.DB_SERVER,
                database: process.env.DB_DATABASE || 'CarModelStoreDB',
                port: parseInt(process.env.DB_PORT || '1433', 10),
                options: {
                    encrypt: process.env.DB_ENCRYPT !== 'false',
                    trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
                    enableArithAbort: true
                },
                pool: poolConfig
            };
            const pool = await new pureSql.ConnectionPool(tdsConfig).connect();
            pool.on('error', (err) => {
                console.error('⚠️ SQL Pool Error (TDS):', err.message || err);
                if (!pool.connected) {
                    global.__poolPromise = null;
                }
            });
            console.log('✅ Đã kết nối SQL Server qua TDS Cloud / Serverless');
            return { pool, sql: pureSql };
        } catch (tdsErr) {
            console.warn('⚠️ Thử kết nối TDS thất bại:', tdsErr.message);
        }
    }

    // 2. Kết nối ODBC Localhost (Windows Authentication) hoặc Fallback TDS
    let sqlModule;
    try {
        sqlModule = require('mssql/msnodesqlv8');
    } catch {
        sqlModule = require('mssql');
    }

    for (const cfg of dbConfigs) {
        try {
            const pool = await new sqlModule.ConnectionPool({ 
                connectionString: cfg.conn,
                pool: poolConfig
            }).connect();
            pool.on('error', (err) => {
                console.error(`⚠️ SQL Pool Error (${cfg.name}):`, err.message || err);
                if (!pool.connected) {
                    global.__poolPromise = null;
                }
            });
            console.log(`✅ Đã kết nối SQL Server thành công (${cfg.name})`);
            return { pool, sql: sqlModule };
        } catch (e) {
            // Thử cấu hình tiếp theo
        }
    }

    console.error('❌ Không thể kết nối tới cơ sở dữ liệu SQL Server');
    throw new Error('Không thể kết nối SQL Server với bất kỳ cấu hình nào');
}

async function getDb() {
    // 1. Nếu pool promise đã tồn tại, kiểm tra xem pool đã kết nối và còn hoạt động không
    if (global.__poolPromise) {
        const cached = await global.__poolPromise.catch(() => null);
        if (cached && cached.pool && cached.pool.connected) {
            return cached;
        }
        // Pool bị ngắt hoặc kết nối trước đó lỗi -> reset cache để tái kết nối
        global.__poolPromise = null;
    }

    // 2. Khởi tạo Promise kết nối mới và lưu ngay vào global.__poolPromise (singleton)
    global.__poolPromise = (async () => {
        try {
            return await createConnectionPool();
        } catch (err) {
            // Khi kết nối thất bại, giải phóng cache ngay lập tức để request kế tiếp có thể thử lại
            global.__poolPromise = null;
            throw err;
        }
    })();

    return global.__poolPromise;
}
```

**Step 3: Conditional Server Start & Module Export (Replace Lines 768–774)**
```javascript
// Khởi động Server nếu chạy trực tiếp (Local standalone), không khởi động khi import trong Serverless / Test
if (require.main === module && !process.env.VERCEL) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`🚀 Backend CarModelStore đang chạy tại: http://localhost:${PORT}`);
        // Kết nối thử DB ngay khi start server
        getDb().catch((err) => {
            console.warn('⚠️ Khởi động kết nối DB ban đầu chưa thành công:', err.message);
        });
    });
}

// Export cho Serverless (Vercel) và Test runner
module.exports = app;
module.exports.getDb = getDb;
```

---

#### B. Creation of Root `api/index.js`
Create new file `d:\laptrinhweb - Copy\api\index.js`:
```javascript
// api/index.js - Vercel Serverless Function Entry Point
const app = require('../car-store-backend/server');

module.exports = app;
```

---

#### C. Replacement of Root `vercel.json`
Replace contents of `d:\laptrinhweb - Copy\vercel.json`:
```json
{
  "version": 2,
  "cleanUrls": true,
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "/api/index.js"
    }
  ]
}
```

---

## 5. Verification Method

Once implemented, the builder and test writer can verify the implementation against the following 6 tests:

### Test 1: Exportability & Process Decoupling
- **Command**:
  ```powershell
  node -e "const app = require('./car-store-backend/server'); if (typeof app !== 'function') throw new Error('app is not a function'); if (typeof app.getDb !== 'function') throw new Error('getDb is not exported'); console.log('PASS: app and getDb exported successfully'); process.exit(0);"
  ```
- **Expected Result**: Exits with code 0; outputs `PASS: app and getDb exported successfully`. No HTTP listener binds or hangs on port 5000.
- **Invalidation Condition**: Command hangs or throws `TypeError`.

### Test 2: Serverless Function Entry Point Validation
- **Command**:
  ```powershell
  node -e "const app = require('./api/index'); if (typeof app !== 'function') throw new Error('api entry point does not export function'); console.log('PASS: api/index.js exports Express app'); process.exit(0);"
  ```
- **Expected Result**: Exits with code 0; outputs `PASS: api/index.js exports Express app`.
- **Invalidation Condition**: Module resolution failure or `app` is not a function.

### Test 3: Promise-Cached Singleton & Concurrency Guard
- **Command**:
  ```powershell
  node -e "const { getDb } = require('./car-store-backend/server'); Promise.all([getDb(), getDb(), getDb(), getDb(), getDb()]).then(results => { const firstPool = results[0].pool; const allSame = results.every(r => r.pool === firstPool); if (!allSame) throw new Error('Connection pools are not identical singleton'); console.log('PASS: All 5 concurrent callers received the identical ConnectionPool instance'); process.exit(0); }).catch(e => { console.error('FAIL:', e); process.exit(1); });"
  ```
- **Expected Result**: Exits with code 0; outputs `PASS: All 5 concurrent callers received the identical ConnectionPool instance`.
- **Invalidation Condition**: Multiple connection pools are returned or error thrown.

### Test 4: Standalone Server Local Execution
- **Command**:
  ```powershell
  node -e "const cp = require('child_process'); const p = cp.spawn('node', ['car-store-backend/server.js'], { stdio: ['ignore', 'pipe', 'pipe'] }); let out = ''; p.stdout.on('data', d => { out += d; if (out.includes('5000')) { console.log('PASS: Server started standalone on port 5000'); p.kill(); process.exit(0); } }); p.stderr.on('data', d => console.error(d.toString())); setTimeout(() => { p.kill(); console.error('TIMEOUT'); process.exit(1); }, 6000);"
  ```
- **Expected Result**: Exits with code 0; outputs `PASS: Server started standalone on port 5000`.
- **Invalidation Condition**: Standalone server fails to start or times out.

### Test 5: Process Crash Guard Interception
- **Command**:
  ```powershell
  node -e "require('./car-store-backend/server'); process.emit('unhandledRejection', new Error('Simulated unhandled rejection')); console.log('PASS: Process survived unhandledRejection'); process.exit(0);"
  ```
- **Expected Result**: Exits with code 0; outputs `💥 [CRASH GUARD] Unhandled Promise Rejection` followed by `PASS: Process survived unhandledRejection`.
- **Invalidation Condition**: Node process crashes with exit code 1.

### Test 6: `vercel.json` Syntax and Rewrite Schema
- **Command**:
  ```powershell
  node -e "const fs = require('fs'); const cfg = JSON.parse(fs.readFileSync('vercel.json', 'utf8')); if (!cfg.rewrites || !cfg.rewrites.some(r => r.source === '/api/(.*)' && r.destination === '/api/index.js')) throw new Error('vercel.json missing /api/(.*) rewrite'); console.log('PASS: vercel.json rewrites valid'); process.exit(0);"
  ```
- **Expected Result**: Exits with code 0; outputs `PASS: vercel.json rewrites valid`.
- **Invalidation Condition**: JSON parse error or missing rewrite.
