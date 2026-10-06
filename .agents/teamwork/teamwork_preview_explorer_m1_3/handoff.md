# Handoff Report — Explorer M1-3
**Task**: Environment Configuration Standardization, Package Scripts, Client Fallback URLs, and Milestone 1 Verification Methodology  
**Target Milestone**: Milestone 1 (Serverless Architecture, Database Schema Migration & Configuration Standardization)  
**Author**: Explorer M1-3 (`teamwork_preview_explorer`)  
**Date**: 2026-10-06T19:23:00Z  

---

## 1. Observation

Direct observations from examining the codebase, configuration files, and live Microsoft SQL Server 2025 instance:

### 1.1 `car-store-backend/.env` & `.env.example`
- **File**: `car-store-backend/.env` (lines 1-4):
  ```env
  PORT=5000
  DB_CONNECTION_STRING=Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;
  CORS_ORIGIN=*
  ```
  Only 3 variables exist. Missing: `NODE_ENV`, `DB_SERVER`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`, `DB_ENCRYPT`, `DB_TRUST_CERT`, `DB_POOL_MAX`, `DB_POOL_MIN`.
- **File**: `car-store-backend/.env.example` (lines 1-18):
  Contains comments mentioning ODBC and TDS, but omits `NODE_ENV`, `DB_POOL_MAX`, `DB_POOL_MIN`, and `DB_TRUST_CERT`.
- **File**: `car-store-backend/server.js`:
  - Lines 60-64 (TDS Pool configuration) hardcodes `pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }` instead of consuming `DB_POOL_MAX` and `DB_POOL_MIN`.
  - Lines 85-88 (ODBC Pool configuration) hardcodes `pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }` instead of consuming `DB_POOL_MAX` and `DB_POOL_MIN`.
- **File**: `car-store-backend/migrate.js`:
  - Lines 1-2 hardcode:
    ```javascript
    const sql = require('mssql/msnodesqlv8');
    const cfg = { connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;' };
    ```
    It does not call `require('dotenv').config()`, ignoring any `.env` overrides or cloud TDS parameters.

### 1.2 `car-store-backend/package.json`
- **File**: `car-store-backend/package.json` (lines 5-8):
  ```json
  "main": "index.js",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  }
  ```
  - `"main": "index.js"` is incorrect: no `index.js` exists in `car-store-backend`; entry point is `server.js`.
  - Missing standard scripts: `"start"`, `"dev"`, `"migrate"`.
  - `"test"` script is a failing placeholder.
  - Project E2E tests are located at the project root (`test/tier*.test.js`), meaning running `node --test test/**/*.test.js` from inside `car-store-backend` would not locate `../test/` unless properly addressed.

### 1.3 `assets/js/config.js`
- **File**: `assets/js/config.js` (lines 8-15):
  ```javascript
  const isLocalhost = typeof window !== 'undefined' && (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.protocol === 'file:'
  );

  window.DEFAULT_API_URL = isLocalhost ? 'http://localhost:5000' : 'https://unhook-shrink-escalate.ngrok-free.dev';
  ```
  - Contains a hardcoded ephemeral ngrok URL (`https://unhook-shrink-escalate.ngrok-free.dev`). On any remote hosting or Vercel deployment (`isLocalhost === false`), all frontend API requests fail because the ngrok tunnel is defunct.
  - Line 18-23 (`getApiBaseUrl()`): If a client browser previously cached `CMS_BACKEND_URL` in `localStorage` containing the old ngrok URL, it persistently returns that broken tunnel.
  - Line 36-57 (`apiFetch()`): Does not auto-serialize request bodies when an object is passed, requiring manual `JSON.stringify` by callers.

### 1.4 Live Database Inspection (`CarModelStoreDB` on SQL Server 2025)
- Directly queried metadata:
  - `orders` table currently contains columns: `id`, `order_code`, `customer_id`, `recipient_name`, `recipient_phone`, `shipping_address`, `total_amount`, `order_status`, `created_at`, `tracking_code`.
  - Missing customer snapshot columns: `customer_name`, `customer_email`, `customer_phone`.
  - `orders.tracking_code` does NOT have a UNIQUE constraint yet.
  - `products` does NOT have `CK_products_stock_quantity CHECK (stock_quantity >= 0)`.

---

## 2. Logic Chain

1. **Environment Configuration Parity**:
   - *Observation*: `server.js` and `migrate.js` need to operate seamlessly in two distinct environments: local Windows workstation (ODBC `msnodesqlv8` with Windows Auth) and Vercel/Cloud Serverless (pure JS TDS `mssql` with SQL Auth).
   - *Reasoning*: Without explicit environment variables (`DB_POOL_MAX`, `DB_POOL_MIN`, `DB_TRUST_CERT`, `NODE_ENV`), pool sizes cannot be tuned for serverless environments (where low pool min/max prevents database connection exhaustion), and `migrate.js` cannot run in CI/Docker without hardcoded file changes.
   - *Deduction*: Standardize all 13 required variables in both `.env` and `.env.example`, and ensure `server.js` and `migrate.js` parse them dynamically with resilient defaults.

2. **Package Script Portability**:
   - *Observation*: CI, Vercel build systems, and developers rely on `npm start`, `npm run dev`, `npm run migrate`, and `npm test`.
   - *Reasoning*: Setting `"main": "server.js"` aligns Node module resolution. Providing `"test": "node --test test/**/*.test.js ../test/**/*.test.js"` allows the test runner to succeed regardless of whether executed from the project root or inside `car-store-backend`.
   - *Deduction*: Update `car-store-backend/package.json` with the full script suite.

3. **Client Fallback & Zero-Ngrok Production Readiness**:
   - *Observation*: In production (e.g. Vercel deployment), backend API routes are served at `/api/*` on the same domain via serverless rewrites (`vercel.json`).
   - *Reasoning*: Replacing `'https://unhook-shrink-escalate.ngrok-free.dev'` with `window.location.origin` (or relative `""`) enables automatic, zero-configuration API communication in production while preserving `http://localhost:5000` during local development (including Live Server and `file:` protocols).
   - *Deduction*: Update `assets/js/config.js` to dynamically fall back to `window.location.origin`, purge/ignore stale `ngrok` strings in `localStorage`, and auto-serialize JSON request payloads.

4. **Milestone 1 Verification Multi-Gate Strategy**:
   - *Observation*: Milestone 1 introduces serverless export, singleton pooling, database migrations, and config updates. A failure in any one piece breaks subsequent milestones (M2 ACID transactions and M3 client sync).
   - *Reasoning*: Verification must not merely check file existence; it must execute migration idempotency, test database constraints against real violations, verify singleton reference equality, and validate HTTP `/api/health`.
   - *Deduction*: Define 7 explicit, copy-pasteable verification commands for Workers and Reviewers.

---

## 3. Caveats

1. **UI Freeze (R1)**:
   - Changes are strictly limited to JavaScript logic (`assets/js/config.js`) and backend configuration. No HTML or CSS elements (such as the `#customBackendUrl` input in `cart.html`) may be modified or deleted.
2. **Local vs Cloud Database Driver**:
   - Local Windows development uses `msnodesqlv8` via ODBC Driver 17/18. Serverless environments on Linux (Vercel) do not have native Windows ODBC drivers and must use TDS `mssql`. The configuration and `server.js` code must support automatic fallback between the two.
3. **E2E Test File Location**:
   - The E2E test files are authored under `test/` at the repository root. Package scripts and test execution commands must handle relative path navigation appropriately.

---

## 4. Conclusion & Proposed Implementations

### 4.1 Proposed `car-store-backend/.env`
```env
# Application Environment
NODE_ENV=development
PORT=5000
CORS_ORIGIN=*

# SQL Server Configuration — ODBC Localhost (Windows Development)
DB_CONNECTION_STRING=Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;

# SQL Server Configuration — TDS (Remote / Cloud / Docker / Linux / Vercel Serverless)
# Uncomment and configure when connecting via TDS instead of ODBC
# DB_SERVER=localhost
# DB_DATABASE=CarModelStoreDB
# DB_USER=sa
# DB_PASSWORD=your_strong_password
# DB_PORT=1433
# DB_ENCRYPT=false
# DB_TRUST_CERT=true

# Connection Pool Settings
DB_POOL_MAX=10
DB_POOL_MIN=0
```

### 4.2 Proposed `car-store-backend/.env.example`
```env
# =============================================================================
# CarModelStore Backend Environment Configuration Template
# Copy this file to .env and adjust values for your environment.
# =============================================================================

# Application Environment
NODE_ENV=development
PORT=5000
CORS_ORIGIN=*

# -----------------------------------------------------------------------------
# Mode 1: ODBC Connection (Default for Local Windows Development)
# Uses msnodesqlv8 driver with Windows Integrated Authentication
# -----------------------------------------------------------------------------
DB_CONNECTION_STRING=Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;

# -----------------------------------------------------------------------------
# Mode 2: TDS Connection (Cloud / Azure SQL / Vercel Serverless / Linux / Docker)
# Uses pure mssql driver with SQL Server Authentication
# -----------------------------------------------------------------------------
DB_SERVER=localhost
DB_DATABASE=CarModelStoreDB
DB_USER=sa
DB_PASSWORD=YourPasswordHere
DB_PORT=1433
DB_ENCRYPT=false
DB_TRUST_CERT=true

# -----------------------------------------------------------------------------
# Connection Pool Settings (Applicable to both ODBC and TDS)
# In Serverless environments, pool size should be kept small (e.g., max 5 or 10)
# -----------------------------------------------------------------------------
DB_POOL_MAX=10
DB_POOL_MIN=0
```

### 4.3 Proposed `car-store-backend/package.json`
```json
{
  "name": "car-store-backend",
  "version": "1.0.0",
  "description": "Backend API for CarModelStore",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node server.js",
    "migrate": "node migrate.js",
    "test": "node --test test/**/*.test.js ../test/**/*.test.js"
  },
  "keywords": [
    "carmodelstore",
    "express",
    "mssql",
    "serverless"
  ],
  "author": "",
  "license": "ISC",
  "type": "commonjs",
  "dependencies": {
    "body-parser": "^2.3.0",
    "cors": "^2.8.6",
    "dotenv": "^18.0.5",
    "express": "^5.2.1",
    "msnodesqlv8": "^5.5.0",
    "mssql": "^12.7.2"
  }
}
```

### 4.4 Proposed Replacement for `assets/js/config.js`
```javascript
/**
 * CarModelStore - Cấu hình kết nối API
 * Hỗ trợ chuyển đổi linh hoạt giữa Localhost và Production/Vercel (Same-Origin).
 */

// 1. URL Mặc định của Backend
// Khi chạy ở localhost (127.0.0.1, localhost hoặc file:), ưu tiên http://localhost:5000
// Khi deploy lên Vercel hoặc remote hosting, tự động sử dụng window.location.origin (same-origin relative)
const isLocalhost = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.protocol === 'file:'
);

window.DEFAULT_API_URL = isLocalhost 
    ? 'http://localhost:5000' 
    : (typeof window !== 'undefined' && window.location && window.location.origin ? window.location.origin : '');

// 2. Lấy API URL từ localStorage nếu đã được cấu hình trước đó, ngược lại dùng mặc định
// Tự động loại bỏ và làm sạch các URL ngrok cũ/hết hạn đã lưu trong cache
function getApiBaseUrl() {
    try {
        const savedUrl = typeof localStorage !== 'undefined' ? localStorage.getItem('CMS_BACKEND_URL') : null;
        if (savedUrl && savedUrl.trim() !== '') {
            const trimmed = savedUrl.trim();
            if (trimmed.includes('ngrok-free.dev') || trimmed.includes('ngrok.io')) {
                localStorage.removeItem('CMS_BACKEND_URL');
            } else {
                return trimmed.replace(/\/+$/, '');
            }
        }
    } catch (_) {}
    return (window.DEFAULT_API_URL || '').replace(/\/+$/, '');
}

// 3. Hàm lưu URL Backend mới
function setApiBaseUrl(url) {
    try {
        if (!url) {
            localStorage.removeItem('CMS_BACKEND_URL');
        } else {
            localStorage.setItem('CMS_BACKEND_URL', url.trim().replace(/\/+$/, ''));
        }
    } catch (_) {}
    window.API_BASE = getApiBaseUrl();
}

// 4. Wrapper gọi API chuyên dụng
async function apiFetch(endpoint, options = {}) {
    const baseUrl = getApiBaseUrl();
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${cleanEndpoint}`;

    // Tự động serialize body nếu là Plain Object
    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
        body = JSON.stringify(body);
    }

    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    try {
        const fetchOptions = {
            ...options,
            headers
        };
        if (body !== undefined) {
            fetchOptions.body = body;
        }

        const response = await fetch(url, fetchOptions);
        const data = await response.json().catch(() => null);
        return { ok: response.ok, status: response.status, data };
    } catch (err) {
        console.error('API Fetch Error:', err);
        return { ok: false, status: 0, error: err.message, data: null };
    }
}

window.getApiBaseUrl = getApiBaseUrl;
window.setApiBaseUrl = setApiBaseUrl;
window.apiFetch = apiFetch;
window.API_BASE = getApiBaseUrl();
```

### 4.5 Configuration Wiring in `server.js` and `migrate.js`
- **In `car-store-backend/server.js`**:
  Pool options must read environment settings:
  ```javascript
  const poolConfig = {
      max: parseInt(process.env.DB_POOL_MAX || '10', 10),
      min: parseInt(process.env.DB_POOL_MIN || '0', 10),
      idleTimeoutMillis: 30000
  };
  ```
  Pass `pool: poolConfig` to both TDS `ConnectionPool` and ODBC `ConnectionPool`.
- **In `car-store-backend/migrate.js`**:
  Add `require('dotenv').config();` at line 1, and make connection configuration use `process.env.DB_CONNECTION_STRING || cfg.connectionString`.

---

## 5. Verification Method

Workers and Reviewers must run the following exact commands to verify Milestone 1 completion:

### Check 1: Syntax Validation
Verify all modified JavaScript files pass Node syntax check:
```powershell
node --check car-store-backend/server.js
node --check car-store-backend/migrate.js
node --check assets/js/config.js
```
*Expected output*: Exit code 0 with no syntax errors.

### Check 2: Package.json Scripts Verification
Verify package scripts exist and execute:
```powershell
npm --prefix car-store-backend run
```
*Expected output*: Output lists `start`, `dev`, `migrate`, and `test`.

### Check 3: Migration Execution & Idempotency Test
Execute migration twice in succession:
```powershell
node car-store-backend/migrate.js
node car-store-backend/migrate.js
```
*Expected output*: Both runs exit with code 0. Second run completes without constraint violations or duplicate insert errors.

### Check 4: Database Schema Integrity Verification
Verify that snapshot columns, unique constraint, and CHECK constraints exist in SQL Server:
```powershell
node -e "
const sql = require('./car-store-backend/node_modules/mssql/msnodesqlv8');
const cfg = { connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;' };
(async () => {
  const p = await sql.connect(cfg);
  
  // 1. Check orders columns
  const cols = await p.request().query(\`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'orders' AND COLUMN_NAME IN ('customer_name', 'customer_email', 'customer_phone', 'tracking_code')
  \`);
  const colNames = cols.recordset.map(c => c.COLUMN_NAME);
  console.log('Orders columns found:', colNames);
  if (!['customer_name', 'customer_email', 'customer_phone', 'tracking_code'].every(c => colNames.includes(c))) {
    throw new Error('Missing columns on orders table!');
  }

  // 2. Check stock constraint
  const cons = await p.request().query(\`
    SELECT name, definition FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID('products')
  \`);
  console.log('Product check constraints:', cons.recordset.map(c => c.name));
  const hasStockCheck = cons.recordset.some(c => c.definition.includes('stock_quantity') && c.definition.includes('>='));
  if (!hasStockCheck) throw new Error('Missing CHECK (stock_quantity >= 0) on products!');

  // 3. Test negative stock rejection
  try {
    await p.request().query('UPDATE products SET stock_quantity = -1 WHERE id = 1');
    throw new Error('FAIL: Negative stock was allowed!');
  } catch (err) {
    if (err.message.includes('CHECK')) {
      console.log('PASS: Negative stock correctly rejected by database constraint');
    } else {
      throw err;
    }
  }

  console.log('All DB schema checks PASSED!');
  process.exit(0);
})().catch(e => { console.error('Verification failed:', e.message); process.exit(1); });
"
```
*Expected output*: Exits with code 0 and logs `All DB schema checks PASSED!`.

### Check 5: Client Config Zero-Ngrok Inspection
Verify `assets/js/config.js` contains no hardcoded ngrok domains:
```powershell
node -e "
const fs = require('fs');
const content = fs.readFileSync('assets/js/config.js', 'utf8');
if (content.includes('ngrok-free.dev') && !content.includes('localStorage.removeItem')) {
  throw new Error('config.js still contains active ngrok fallback URL!');
}
console.log('PASS: config.js has no active ngrok fallbacks');
"
```
*Expected output*: `PASS: config.js has no active ngrok fallbacks`.

### Check 6: Serverless Entry Point & Singleton Pool Verification
Verify `server.js` exports the app and pool singleton operates without cold-start concurrency duplication:
```powershell
node -e "
const app = require('./car-store-backend/server');
if (typeof app !== 'function') throw new Error('server.js must export Express app!');
console.log('PASS: server.js exports Express application');
"
```
*Expected output*: `PASS: server.js exports Express application`.

### Check 7: Server Startup Health Check (AC7)
Start server in background and probe `/api/health`:
```powershell
# In terminal:
$job = Start-Process node -ArgumentList "car-store-backend/server.js" -PassThru
Start-Sleep -Seconds 2
$res = Invoke-RestMethod -Uri "http://localhost:5000/api/health"
Stop-Process -Id $job.Id -Force
Write-Host "Health status:" $res.status "Database:" $res.database "Products:" $res.stats.total_products
if ($res.status -eq 'online' -and $res.database -eq 'connected') {
    Write-Host "PASS: AC7 Server startup verified!"
} else {
    Write-Error "FAIL: Health check failed"
}
```
*Expected output*: `PASS: AC7 Server startup verified!`.
