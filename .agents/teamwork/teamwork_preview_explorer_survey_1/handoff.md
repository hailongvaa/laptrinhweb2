# Investigation Report: Backend Architecture, Database Access & ACID Integrity
**Role**: Explorer 1 (`teamwork_preview_explorer`)  
**Target Project**: CarModelStore (`d:\laptrinhweb - Copy`)  
**Date**: 2026-10-06  
**Authoritative Reference**: `ORIGINAL_REQUEST.md` (Requirements R1, R2, R3, R4)

---

## 1. Observation

### 1.1 Server Entry Point, Serverless Configuration & Route Inventory
- **File**: `car-store-backend/package.json`
  - Lines 5-7:
    ```json
    "main": "index.js",
    "scripts": {
      "test": "echo \"Error: no test specified\" && exit 1"
    }
    ```
    There is no `index.js` file in `car-store-backend`; the entry point is actually `car-store-backend/server.js`. There are no npm scripts for `start` or `dev`.
  - Lines 13-20: Dependencies are `"body-parser": "^2.3.0"`, `"cors": "^2.8.6"`, `"dotenv": "^18.0.5"`, `"express": "^5.2.1"`, `"msnodesqlv8": "^5.5.0"`, `"mssql": "^12.7.2"`.

- **File**: `car-store-backend/server.js`
  - Lines 8-10:
    ```javascript
    const rootDir = path.join(__dirname, '..');
    app.use(express.static(rootDir));
    ```
  - Lines 768-774:
    ```javascript
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`🚀 Backend CarModelStore đang chạy tại: http://localhost:${PORT}`);
        getDb().catch(() => {});
    });
    ```
    `server.js` starts a standalone HTTP server immediately upon load. It does NOT export the Express app (`module.exports = app` is absent).
  - Lines 27-29:
    ```javascript
    let dbPool = null;
    let activeSqlLib = null;
    ```
  - Missing global exception handlers: No `process.on('unhandledRejection', ...)` or `process.on('uncaughtException', ...)` in `server.js`.

- **File**: `vercel.json` (Root)
  - Lines 1-13:
    ```json
    {
      "version": 2,
      "cleanUrls": true,
      "routes": [
        { "handle": "filesystem" },
        { "src": "/(.*)", "dest": "/$1" }
      ]
    }
    ```
    There are NO route rewrites or function configurations for `/api/(.*)`. Any API request sent to a Vercel deployment will return a 404 static routing failure. There is no `api/` directory at the project root for Vercel Serverless Functions.

- **File**: `assets/js/config.js`
  - Lines 8-14:
    ```javascript
    const isLocalhost = typeof window !== 'undefined' && (
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.protocol === 'file:'
    );
    window.DEFAULT_API_URL = isLocalhost ? 'http://localhost:5000' : 'https://unhook-shrink-escalate.ngrok-free.dev';
    ```
    When deployed to Vercel or any non-localhost domain, client requests fall back to an external, ephemeral ngrok tunnel (`https://unhook-shrink-escalate.ngrok-free.dev`). If ngrok is terminated, all cloud client requests immediately fail.
  - Lines 36-57:
    ```javascript
    async function apiFetch(endpoint, options = {}) {
        const baseUrl = getApiBaseUrl();
        const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true',
            ...(options.headers || {})
        };
        try {
            const response = await fetch(url, { ...options, headers });
            const data = await response.json();
            return { ok: response.ok, status: response.status, data };
        } catch (err) {
            console.error('API Fetch Error:', err);
            return { ok: false, status: 0, error: err.message, data: null };
        }
    }
    ```
    `apiFetch` does not check if `options.body` is a plain JavaScript object. If a caller passes `body: { ... }` without `JSON.stringify()`, `fetch` stringifies it to `"[object Object]"`, causing Express `express.json()` to reject the request with HTTP 400.

- **Complete API Route Inventory in `car-store-backend/server.js`**:
  1. `GET /api/health` (Line 102): Returns DB connection status (`connected`/`disconnected`), product and order count statistics.
  2. `GET /api/dashboard/stats` (Line 134): Returns `total_products`, `total_orders`, `pending_orders`, `total_brands`, `total_revenue`, and 5 `recentOrders`.
  3. `POST /api/auth/register` (Line 178): Inserts user into `users` table with role `'customer'`.
  4. `POST /api/auth/login` (Line 248): Authenticates email and plaintext password against `users` table.
  5. `GET /api/orders` (Line 310): Returns all orders or filtered by `customer_id`.
  6. `PUT /api/orders/:code/status` (Line 352): Updates `order_status` in `orders` and `shipping_status` in `shipments`. Restores stock on `'cancelled'`.
  7. `POST /api/orders` (Line 440): Creates new order, records `order_items`, creates tracking in `shipments`, decrements product stock within a transaction.
  8. `GET /api/tracking/:code` (Line 573): Fetches shipment details, order metadata, and product item list by `tracking_code` or `order_code`.
  9. `GET /api/products` (Line 641): Returns products with parameterized filtering (`status`, `brand`, `scale`, `price`, `q`).
  10. `GET /api/products/:id` (Line 704): Returns single product details by integer ID.
  11. `GET /api/brands` (Line 735): Returns all brand records.
  12. `GET /api/accessories` (Line 747): Returns all accessory records.
  13. `POST /api/contact` (Line 759): Accepts and logs contact inquiries.

---

### 1.2 Database Connection & Pooling Management
- **File**: `car-store-backend/server.js`
  - Lines 40-73:
    ```javascript
    async function getDb() {
        if (dbPool && dbPool.connected) {
            return { pool: dbPool, sql: activeSqlLib };
        }
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
                    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
                };
                dbPool = await new pureSql.ConnectionPool(tdsConfig).connect();
                activeSqlLib = pureSql;
                return { pool: dbPool, sql: activeSqlLib };
            } catch (tdsErr) { ... }
        }
    ```
  - Lines 75-95:
    ```javascript
        let sqlModule;
        try {
            sqlModule = require('mssql/msnodesqlv8');
        } catch {
            sqlModule = require('mssql');
        }
        for (const cfg of dbConfigs) {
            try {
                dbPool = await new sqlModule.ConnectionPool({ 
                    connectionString: cfg.conn,
                    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
                }).connect();
                activeSqlLib = sqlModule;
                return { pool: dbPool, sql: activeSqlLib };
            } catch (e) { }
        }
    ```
- **Driver Verification via `run_command`**:
  - Executed: `node -e "const sql = require('mssql/msnodesqlv8'); const cfg = { connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;' }; sql.connect(cfg).then(p => p.query('SELECT @@VERSION as v')).then(r => console.log(r.recordset[0].v));"`
  - Result: `Microsoft SQL Server 2025 (RTM) - 17.0.1000.7 (X64) Enterprise Evaluation Edition on Windows 10 Home Single Language (Build 26200)`.
  - Tables present: `users`, `brands`, `products`, `accessories`, `orders`, `order_items`, `shipments`.
- **Environment Configuration Files**:
  - `car-store-backend/.env`:
    ```env
    PORT=5000
    DB_CONNECTION_STRING=Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;
    CORS_ORIGIN=*
    ```
  - `car-store-backend/.env.example`: Contains TDS variables (`DB_SERVER`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`, `DB_ENCRYPT`), but omits `DB_TRUST_CERT` (used in line 57), `DB_POOL_MAX`, `DB_POOL_MIN`, and `NODE_ENV`.

---

### 1.3 Transaction Handling & Concurrency Mechanisms

#### A. Order Creation (`POST /api/orders`)
- **File**: `car-store-backend/server.js`, Lines 456-551:
  - Line 456-457: `const transaction = new sql.Transaction(pool); await transaction.begin();`
  - Line 473:
    ```sql
    SELECT id, name, stock_quantity, price FROM products WITH (UPDLOCK, ROWLOCK) WHERE id = @pid
    ```
    Row locking hint `WITH (UPDLOCK, ROWLOCK)` is present on the product stock query.
  - Lines 491-534:
    ```javascript
    const totalAmount = items.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.unitPrice)), 0);
    ...
    for (const item of items) {
        const pid = parseInt(item.productId, 10);
        const reqQty = parseInt(item.quantity, 10);
        const price = Number(item.unitPrice);

        const itemRequest = new sql.Request(transaction);
        await itemRequest
            .input('orderId', sql.Int, newOrderId)
            .input('productId', sql.Int, pid)
            .input('quantity', sql.Int, reqQty)
            .input('unitPrice', sql.Decimal(12, 2), price)
            .query(`
                INSERT INTO order_items (order_id, product_id, quantity, unit_price)
                VALUES (@orderId, @productId, @quantity, @unitPrice);

                UPDATE products 
                SET stock_quantity = stock_quantity - @quantity
                WHERE id = @productId;
            `);
    }
    ```
  - **Severe Vulnerability**: `item.unitPrice` and `totalAmount` are calculated directly from untrusted client-provided JSON (`req.body.items[].unitPrice`), despite having queried the authoritative `price` from `products WITH (UPDLOCK, ROWLOCK)` at line 473.
  - **Multiple Identical Product IDs Bug**: The `items` array is validated in a sequential loop without prior deduplication or quantity aggregation. An payload with `[{productId: 1, quantity: 10}, {productId: 1, quantity: 10}]` when stock is 15 passes both check steps, then decrements stock twice to `-5`.
  - **Double Rollback Defect**: Lines 466, 476, 482 call `await transaction.rollback(); return res.status(...)`. If an error occurs subsequently or inside `catch (err)` (line 563), `await transaction.rollback()` is invoked again. In `mssql`, calling `.rollback()` on an aborted/rolled-back transaction throws `TransactionError: Can't rollback transaction. There is no request in progress`.

#### B. Order Cancellation & Stock Return (`PUT /api/orders/:code/status`)
- **File**: `car-store-backend/server.js`, Lines 368-421:
  ```javascript
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
      const updateOrderReq = new sql.Request(transaction);
      const updateResult = await updateOrderReq
          .input('orderCode', sql.VarChar(50), code)
          .input('status', sql.NVarChar(20), status)
          .query(`
              UPDATE orders 
              SET order_status = @status 
              OUTPUT INSERTED.id, INSERTED.tracking_code
              WHERE order_code = @orderCode OR tracking_code = @orderCode;
          `);
      ...
      if (status === 'cancelled') {
          const returnStockReq = new sql.Request(transaction);
          await returnStockReq
              .input('orderId', sql.Int, orderId)
              .query(`
                  UPDATE p
                  SET p.stock_quantity = p.stock_quantity + oi.quantity
                  FROM products p
                  INNER JOIN order_items oi ON p.id = oi.product_id
                  WHERE oi.order_id = @orderId;
              `);
      }
      await transaction.commit();
  ```
  - **Row Locking Missing**: No `UPDLOCK, ROWLOCK` is used prior to updating the order.
  - **Catastrophic Infinite Stock Duplication Flaw**: The route performs no check on the order's existing status before executing stock restoration. If an order is already `'cancelled'`, submitting `PUT /api/orders/:code/status` with `{"status": "cancelled"}` repeatedly succeeds and continuously increments product inventory (`stock_quantity = stock_quantity + oi.quantity`).
  - **CHECK Constraint Violation**: Line 356 allows `const validStatuses = ['pending', 'confirmed', 'shipping', 'delivered', 'completed', 'cancelled']`. However, querying `sys.check_constraints` on table `orders` reveals constraint `CK__orders__order_st__6D0D32F4`:
    `([order_status]='cancelled' OR [order_status]='delivered' OR [order_status]='shipping' OR [order_status]='confirmed' OR [order_status]='pending')`.
    Updating to `'completed'` throws a SQL Server CHECK constraint violation error.

---

### 1.4 Frontend Integration, RBAC, PII & Error Handling

- **PII Exposure in Tracking API (`GET /api/tracking/:code`)**:
  - `server.js` lines 588-605 & 628-633:
    Queries and returns `recipient_name`, `recipient_phone`, and `shipping_address` directly in plain text.
  - `contact.html` lines 259-260:
    ```javascript
    document.getElementById('trackResRecipient').textContent = `${d.recipient_name || ''} (${d.recipient_phone || ''})`;
    ```
    No masking is performed by the server. Requirement R3 explicitly mandates PII masking.

- **Client-Backend Contract Desynchronization (`account.html`)**:
  - `server.js` lines 341-344:
    ```javascript
    res.json({
        success: true,
        orders: result.recordset
    });
    ```
  - `account.html` line 259:
    ```javascript
    if (res.ok && Array.isArray(res.data) && res.data.length > 0) { ... }
    ```
    Because `res.data` is an object `{ success: true, orders: [...] }`, `Array.isArray(res.data)` is `false`. The UI always falls into `emptyNotice.style.display = 'block'`, failing Acceptance Criterion: *"Sau khi tạo đơn, truy cập account.html hiển thị ngay đơn vừa đặt."*

- **Client-Side Payload Serialization Bug**:
  - `login.html` line 154-159:
    ```javascript
    const apiRes = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { email: email, password: password }
    });
    ```
  - `register.html` line 143-150:
    ```javascript
    const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: { fullname: fullname, email: email, password: password }
    });
    ```
    In contrast to `cart.html` and `account.html` which use `JSON.stringify(...)`, `login.html` and `register.html` pass raw JavaScript objects to `apiFetch`. Standard `fetch()` casts objects to `"[object Object]"`, triggering an unhandled syntax error in Express `express.json()`.

- **RBAC Admin Account Discrepancy**:
  - `assets/js/admin-auth.js` lines 13-18 & line 50:
    ```javascript
    var ADMIN_CREDENTIALS = { email: 'admin@gmail.com', ... };
    isAdmin: function () {
      var user = this.getCurrentUser();
      return !!(user && user.role === 'admin' && user.email === ADMIN_CREDENTIALS.email);
    }
    ```
  - `database/00_full_setup.sql` line 164:
    ```sql
    INSERT INTO users (id, username, password, full_name, email, phone, address, role)
    VALUES (1, 'admin', 'admin123', N'Quản trị viên Hệ thống', 'admin@carstore.vn', ...);
    ```
    A user logging in with the database admin credentials (`admin@carstore.vn`) is rejected by `protectAdminPage()` in `admin-auth.js` because the hardcoded email check expects `admin@gmail.com`.

- **SQL Injection Audit**:
  - All SQL queries across `server.js` (including product search, tracking, orders, login, and registration) use parameterized inputs via `request.input('...', sql.Type, val)`.
  - No string-concatenated SQL queries were found in active route handlers.

---

## 2. Logic Chain

```
[Observation 1.1: vercel.json has no /api rewrites; server.js lacks module export & executes app.listen]
  └──> [Inference 1.1]: Deploying to Vercel without an api/ entry point or serverless handler results in 404 on all backend routes.

[Observation 1.1: config.js points to ngrok tunnel URL when not on localhost]
  └──> [Inference 1.2]: On Vercel, the frontend fails to communicate with the co-hosted backend unless the API base URL defaults to relative paths or current origin.

[Observation 1.2: msnodesqlv8 is Windows-specific C++ native addon; TDS pool lacks cold-start promise cache]
  └──> [Inference 2.1]: In serverless environments, msnodesqlv8 cannot run on Linux; pure JS tedious/mssql must be configured.
  └──> [Inference 2.2]: Concurrent requests on cold start instantiate redundant ConnectionPool instances, leading to pool exhaustion.

[Observation 1.3: POST /api/orders reads unitPrice from client body rather than product table]
  └──> [Inference 3.1]: Severe price manipulation risk exists; attackers can purchase items at arbitrary prices.

[Observation 1.3: POST /api/orders does not aggregate quantities by productId before validation]
  └──> [Inference 3.2]: Concurrency & inventory bypass; multiple entries for the same product can cause stock to drop below 0.

[Observation 1.3: PUT /api/orders/:code/status lacks UPDLOCK/ROWLOCK and checks no previous status on cancellation]
  └──> [Inference 3.3]: Duplicate cancellation calls execute inventory refund repeatedly, leading to infinite stock generation.

[Observation 1.3: sys.check_constraints on orders restricts order_status to 5 values excluding 'completed']
  └──> [Inference 3.4]: Updating status to 'completed' triggers database exception 500.

[Observation 1.4: GET /api/tracking/:code returns raw recipient_name, phone, address]
  └──> [Inference 4.1]: PII data is leaked in violation of Requirement R3.

[Observation 1.4: account.html checks Array.isArray(res.data) while server.js returns {success: true, orders: [...]}]
  └──> [Inference 4.2]: Order history is never displayed on account.html despite successful database insertion.

[Observation 1.4: login.html and register.html pass plain objects to apiFetch without JSON.stringify]
  └──> [Inference 4.3]: API requests submit [object Object], breaking database authentication from those pages.

[Observation 1.4: admin-auth.js hardcodes admin@gmail.com whereas database seeds admin@carstore.vn]
  └──> [Inference 4.4]: Logging in with database admin credentials causes admin panel redirect/lockout.
```

---

## 3. Caveats

1. **Local Database Verification Scope**:
   - Verification was conducted against local Microsoft SQL Server 2025 using `ODBC Driver 17 for SQL Server`. Cloud TDS connections (e.g., Azure SQL, Supabase, Neon) were not live-tested because no external credentials are configured in `.env`.
2. **UI Modification Boundary (R1 Freeze)**:
   - In accordance with R1, all UI HTML structure, classes, and styles are strictly frozen. Bug fixes in client files (`account.html`, `login.html`, `register.html`, `admin-auth.js`, `config.js`) must be confined strictly to JavaScript data flow, event handlers, and serialization logic without touching DOM nodes or CSS.

---

## 4. Conclusion & Actionable Recommendations

The CarModelStore application has a functioning local schema and functional baseline, but contains critical architectural vulnerabilities, concurrency bugs, and interface discrepancies that must be rectified to satisfy Requirements R1 through R4.

### Concrete Recommendations for Implementation:

1. **Serverless Architecture & Packaging (R4)**:
   - Split `car-store-backend/server.js` into an exportable Express application (`module.exports = app`) and a standalone listener (`if (!process.env.VERCEL) app.listen(...)`).
   - Create root `api/index.js` importing the app for Vercel Serverless Function execution.
   - Update `vercel.json` with rewrites: `[ { "source": "/api/(.*)", "destination": "/api/index.js" } ]`.
   - Update `package.json` `"main": "server.js"` and add `"start": "node server.js"`.
   - Standardize `assets/js/config.js` to fallback to `window.location.origin` or relative `""` instead of the defunct ngrok URL.

2. **Connection Pooling Singleton (R4)**:
   - Implement a Promise-cached connection pool singleton (`global.__poolPromise`) to ensure exactly one pool is created across concurrent cold-start requests.
   - Configure conservative pool settings for serverless (`max: 2` or `max: 5`).
   - Standardize `.env.example` with complete TDS parameters (`DB_TRUST_CERT`, `DB_POOL_MAX`, `NODE_ENV`).

3. **ACID Transaction & Concurrency Fixes (R2)**:
   - **Order Creation**:
     - Aggregate item quantities by `productId` before validation.
     - Retrieve `product.price` under `WITH (UPDLOCK, ROWLOCK)` and enforce authoritative server-side price calculation for `order_items.unit_price` and `orders.total_amount`.
     - Update `products.status = 'out_of_stock'` when `stock_quantity` reaches 0.
     - Protect transaction rollbacks against `TransactionError` by verifying `transaction._aborted !== true`.
     - Generate collision-resistant order and tracking codes.
   - **Order Cancellation**:
     - Wrap status update in a transaction and lock the target order using `SELECT order_status FROM orders WITH (UPDLOCK, ROWLOCK) WHERE id = @orderId`.
     - Reject cancellation if `order_status` is already `'cancelled'` or `'delivered'`.
     - Lock products during stock refund (`WITH (UPDLOCK, ROWLOCK)`).
     - Align allowed statuses between database CHECK constraints and application logic.

4. **Security, Privacy & Contract Synchronization (R3, R4)**:
   - Implement PII masking in `GET /api/tracking/:code` for `recipient_name` (e.g. `Ng*** V** An`), `recipient_phone` (e.g. `090****567`), and `shipping_address`.
   - Update `account.html` to parse both `res.data` (array) and `res.data.orders` (object property).
   - In `assets/js/config.js` (`apiFetch`), auto-serialize `options.body` with `JSON.stringify` if passed as an object.
   - Reconcile `assets/js/admin-auth.js` to recognize `admin@carstore.vn` (or accept any user with `role === 'admin'`).
   - Add process-level handlers for `unhandledRejection` and `uncaughtException` in backend entry point.

---

## 5. Verification Method

To independently verify these findings, execute the following commands in powershell:

### 5.1 Verify Database Schema & Constraints
```powershell
node -e "const sql = require('mssql/msnodesqlv8'); const cfg = { connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;' }; sql.connect(cfg).then(p => p.query('SELECT cc.name, cc.definition FROM sys.check_constraints cc JOIN sys.tables t ON cc.parent_object_id = t.object_id WHERE t.name in (\'orders\', \'products\')')).then(r => console.log(r.recordset));"
```
*Expected*: Shows constraint `CK__orders__order_st__6D0D32F4` lacking `'completed'`.

### 5.2 Verify Order Price Tampering Vulnerability
Inspect `car-store-backend/server.js` at line 491 and 518:
```powershell
Get-Content "car-store-backend\server.js" | Select-String -Pattern "totalAmount = items.reduce|Number\(item.unitPrice\)"
```

### 5.3 Verify Tracking PII Leakage
Inspect `car-store-backend/server.js` at lines 588-605:
```powershell
Get-Content "car-store-backend\server.js" | Select-String -Pattern "recipient_name|recipient_phone|shipping_address"
```

### 5.4 Verify `account.html` Contract Mismatch
Inspect `account.html` at line 259:
```powershell
Get-Content "account.html" | Select-String -Pattern "Array.isArray\(res.data\)"
```
Compare with `car-store-backend/server.js` at line 343:
```powershell
Get-Content "car-store-backend\server.js" | Select-String -Pattern "orders: result.recordset"
```
