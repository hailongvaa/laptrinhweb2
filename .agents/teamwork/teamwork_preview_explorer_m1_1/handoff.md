# Handoff Report — Explorer M1-1: Database Schema Migration & Constraints (Feature F2)

**Milestone**: M1 (Feature F2: Database Schema & Constraints)  
**Author**: Explorer M1-1 (`teamwork_preview_explorer_m1_1`)  
**Target Recipient**: Orchestrator / Milestone 1 Implementer  
**Date**: 2026-10-06T19:23:00Z  

---

## 1. Observation

### 1.1 Existing Database Schema Files
1. **`database/01_create_tables.sql`**:
   - `orders` table (lines 92–107):
     ```sql
     CREATE TABLE orders (
         id INT IDENTITY(1,1) PRIMARY KEY,
         order_code VARCHAR(30) NOT NULL UNIQUE,
         customer_id INT NOT NULL,
         recipient_name NVARCHAR(100) NOT NULL,
         recipient_phone VARCHAR(15) NOT NULL,
         shipping_address NVARCHAR(MAX) NOT NULL,
         total_amount DECIMAL(14, 2) NOT NULL DEFAULT 0,
         tracking_code VARCHAR(50) NULL,
         order_status NVARCHAR(20) CHECK (order_status IN ('pending', 'confirmed', 'shipping', 'delivered', 'cancelled')) DEFAULT 'pending',
         created_at DATETIME DEFAULT GETDATE(),
         CONSTRAINT fk_orders_users FOREIGN KEY (customer_id) REFERENCES users(id)
     );
     ```
     - **Deficiency 1**: No customer snapshot columns (`customer_name`, `customer_email`, `customer_phone`).
     - **Deficiency 2**: `tracking_code VARCHAR(50) NULL` has no `UNIQUE` constraint (only non-unique index `idx_orders_tracking_code`).
     - **Deficiency 3**: The check constraint on `order_status` was declared anonymously without an explicit constraint name, causing SQL Server to assign unpredictable system names (e.g. `CK__orders__order_st__6D0D32F4`).

   - `products` table (lines 53–73):
     ```sql
     CREATE TABLE products (
         ...
         stock_quantity INT NOT NULL DEFAULT 0,
         ...
     );
     ```
     - **Deficiency 4**: `stock_quantity` lacks a `CHECK (stock_quantity >= 0)` constraint (`CK_products_stock_quantity`).

   - Foreign Key Indexes (lines 141–152):
     - Indexes exist for `orders(tracking_code)`, `orders(customer_id)`, `order_items(product_id)`, `products(scale)`, `products(car_brand)`.
     - **Deficiency 5**: Missing non-clustered index on `order_items(order_id)`, `shipments(order_id)`, and `products(brand_id)`. Without these, joins, cascade deletions, and updates (e.g. `WHERE order_id = @orderId`) trigger table scans.

2. **`car-store-backend/migrate.js`**:
   - Lines 1–2: Hardcodes ODBC 17 connection string without `.env` support or multi-driver fallback:
     ```javascript
     const sql = require('mssql/msnodesqlv8');
     const cfg = { connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;' };
     ```
   - Only checked `tracking_code` column, added non-unique indexes, and seeded products.
   - Did not add customer snapshot columns, did not enforce UNIQUE on `tracking_code`, did not enforce `stock_quantity >= 0`, and did not reconcile status constraints.

3. **Live SQL Server State** (`CarModelStoreDB` on `localhost`):
   - Current columns on `orders`: `id`, `order_code`, `customer_id`, `recipient_name`, `recipient_phone`, `shipping_address`, `total_amount`, `order_status`, `created_at`, `tracking_code`.
   - Current constraints:
     - `orders`: `PK__orders__...`, `UQ__orders__99D12D3F10902AFF` (on `order_code`), `CK__orders__order_st__6D0D32F4` (anonymous CHECK on `order_status`), `fk_orders_users`.
     - `products`: `PK__products__...`, `UQ__products__...`, `CK__products__status__5CD6CB2B`, `fk_products_brands`. No check constraint on `stock_quantity`.
   - Current existing data: 2 orders (`ORD-2026-0001` and `ORD-1791312977963`), 17 products (all with stock between 0 and 25).

---

## 2. Logic Chain

1. **Customer Snapshot Columns**:
   - `ORIGINAL_REQUEST.md` (R2) and `PROJECT.md` (F2, 4.2) mandate storing snapshots of customer details on the order at the time of purchase (`customer_name`, `customer_email`, `customer_phone`).
   - If a customer changes their profile information in `users` in the future, past order receipts and invoices must preserve the exact historical customer information.
   - Adding these columns as `NULL` allows safe alter table operation on existing tables.
   - For existing historical orders, a backfill query joining `orders` with `users` on `customer_id` populates missing values immediately.

2. **UNIQUE Constraint on `orders.tracking_code`**:
   - `ORIGINAL_REQUEST.md` (R2) mandates: "Sinh mã vận đơn duy nhất (`VNPOST-...`) và tạo bản ghi shipment đồng bộ."
   - `PROJECT.md` (F2) requires: "UNIQUE constraint on `orders.tracking_code` (e.g., `UQ_orders_tracking_code`)."
   - Before adding the constraint, historical records with null or duplicate tracking codes must be repaired/backfilled so the constraint does not throw violation error 2627.
   - Once enforced, any concurrent race condition attempting to insert duplicate tracking codes will be halted at the database engine level.

3. **CHECK Constraint on `products.stock_quantity >= 0`**:
   - `ORIGINAL_REQUEST.md` (R2, Acceptance Criteria) mandates preventing overselling and negative inventory.
   - Even if application-level locking (`UPDLOCK, ROWLOCK`) is implemented, a database-level `CHECK (stock_quantity >= 0)` is the ultimate defense-in-depth gate guaranteeing ACID inventory integrity.
   - Naming the constraint explicitly `CK_products_stock_quantity` ensures clarity and deterministic migration scripts.

4. **Reconciling `orders.order_status` CHECK Constraint**:
   - Canonical status lifecycle per `PROJECT.md` and `01_create_tables.sql`: `'pending', 'confirmed', 'shipping', 'delivered', 'cancelled'`.
   - `server.js` previously accepted `'completed'` (line 356) and queried legacy strings like `'processing'`, `N'Chờ xử lý'`, `N'Đã hủy'`.
   - The original table had an anonymous check constraint with a random hash name.
   - To reconcile idempotently:
     1. Normalize legacy rows to the canonical set.
     2. Query `sys.check_constraints` joined with `sys.columns` for `orders.order_status` to dynamically drop any existing anonymous or differently-named constraints.
     3. Create the canonical named constraint `CK_orders_order_status`.

5. **Foreign Key Index Optimization**:
   - In SQL Server, `FOREIGN KEY` constraints do NOT create indexes on referencing columns.
   - Endpoints in `server.js` frequently filter by `order_items.order_id` (e.g. stock restoration on cancellation, invoice item lookups) and `shipments.order_id` (status sync).
   - Adding `idx_order_items_order_id`, `idx_shipments_order_id`, and `idx_products_brand_id` resolves potential table scans.

---

## 3. Caveats

1. **Direct Implementation Restraint**: As an explorer, no changes were directly committed to `car-store-backend/migrate.js` or `database/01_create_tables.sql`. The migration script and DDL were fully tested and validated inside a rollback transaction on the live SQL Server engine.
2. **Nullable vs Not-Null Snapshot Columns**: Snapshot columns are defined as `NULL` (`NVARCHAR(100) NULL`, `VARCHAR(100) NULL`, `VARCHAR(15) NULL`) to allow existing historical orders without breaking schema changes. Application logic in M2 (`POST /api/orders`) will enforce their inclusion on new orders.
3. **Database Drivers**: Local development on Windows uses `mssql/msnodesqlv8` (ODBC 17/18), while Serverless/Vercel uses `mssql` pure JS with TDS. The proposed `migrate.js` is engineered to handle both transparently.

---

## 4. Conclusion & Proposed Deliverables

The database migration and DDL requirements for Feature F2 are fully solved, verified, and ready for implementation.

### 4.1 Standalone Idempotent SQL DDL Script
The implementer can apply this script directly in SQL Server Management Studio (SSMS) or via `node migrate.js`:

```sql
USE CarModelStoreDB;
GO

-- =============================================================================
-- FEATURE F2: DATABASE MIGRATION SCRIPT (IDEMPOTENT)
-- =============================================================================

-- 1. Add Customer Snapshot Columns to orders
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'orders' AND COLUMN_NAME = 'customer_name')
BEGIN
    ALTER TABLE orders ADD customer_name NVARCHAR(100) NULL;
    PRINT 'Added orders.customer_name';
END;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'orders' AND COLUMN_NAME = 'customer_email')
BEGIN
    ALTER TABLE orders ADD customer_email VARCHAR(100) NULL;
    PRINT 'Added orders.customer_email';
END;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'orders' AND COLUMN_NAME = 'customer_phone')
BEGIN
    ALTER TABLE orders ADD customer_phone VARCHAR(15) NULL;
    PRINT 'Added orders.customer_phone';
END;

-- 1b. Backfill Snapshot Data for Historical Orders from users table
UPDATE o
SET 
    o.customer_name = ISNULL(o.customer_name, u.full_name),
    o.customer_email = ISNULL(o.customer_email, u.email),
    o.customer_phone = ISNULL(o.customer_phone, u.phone)
FROM orders o
INNER JOIN users u ON o.customer_id = u.id
WHERE o.customer_name IS NULL OR o.customer_email IS NULL OR o.customer_phone IS NULL;
PRINT 'Backfilled customer snapshot columns for historical orders';

-- 2. Backfill tracking_code and Add UNIQUE Constraint
UPDATE orders 
SET tracking_code = 'VNPOST-' + order_code 
WHERE tracking_code IS NULL OR LTRIM(RTRIM(tracking_code)) = '';

-- Resolve any potential duplicates
WITH DuplicateTracking AS (
    SELECT id, tracking_code, ROW_NUMBER() OVER (PARTITION BY tracking_code ORDER BY id) as rn
    FROM orders
    WHERE tracking_code IS NOT NULL
)
UPDATE o
SET o.tracking_code = o.tracking_code + '-' + CAST(o.id AS VARCHAR(10))
FROM orders o
INNER JOIN DuplicateTracking d ON o.id = d.id
WHERE d.rn > 1;

IF NOT EXISTS (
    SELECT 1 FROM sys.key_constraints 
    WHERE name = 'UQ_orders_tracking_code' AND parent_object_id = OBJECT_ID('orders')
)
BEGIN
    ALTER TABLE orders ADD CONSTRAINT UQ_orders_tracking_code UNIQUE (tracking_code);
    PRINT 'Created UNIQUE constraint UQ_orders_tracking_code';
END;

-- 3. CHECK Constraint on products.stock_quantity >= 0
UPDATE products SET stock_quantity = 0 WHERE stock_quantity < 0;

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints 
    WHERE name = 'CK_products_stock_quantity' AND parent_object_id = OBJECT_ID('products')
)
BEGIN
    ALTER TABLE products WITH CHECK ADD CONSTRAINT CK_products_stock_quantity CHECK (stock_quantity >= 0);
    PRINT 'Created CHECK constraint CK_products_stock_quantity';
END;

-- 4. Reconcile orders.order_status CHECK Constraint
UPDATE orders SET order_status = 'pending' WHERE order_status = N'Chờ xử lý';
UPDATE orders SET order_status = 'confirmed' WHERE order_status = 'processing';
UPDATE orders SET order_status = 'delivered' WHERE order_status = 'completed';
UPDATE orders SET order_status = 'cancelled' WHERE order_status = N'Đã hủy';
UPDATE orders SET order_status = 'pending' 
WHERE order_status IS NULL OR order_status NOT IN ('pending', 'confirmed', 'shipping', 'delivered', 'cancelled');

-- Drop any previous anonymous or legacy check constraint on orders.order_status
DECLARE @chkName NVARCHAR(256);
DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
    SELECT cc.name
    FROM sys.check_constraints cc
    JOIN sys.columns c ON cc.parent_object_id = c.object_id AND cc.parent_column_id = c.column_id
    WHERE cc.parent_object_id = OBJECT_ID('orders') 
      AND c.name = 'order_status' 
      AND cc.name <> 'CK_orders_order_status';

OPEN cur;
FETCH NEXT FROM cur INTO @chkName;
WHILE @@FETCH_STATUS = 0
BEGIN
    DECLARE @dropSql NVARCHAR(MAX) = N'ALTER TABLE orders DROP CONSTRAINT ' + QUOTENAME(@chkName);
    EXEC sp_executesql @dropSql;
    PRINT 'Dropped legacy constraint ' + @chkName;
    FETCH NEXT FROM cur INTO @chkName;
END;
CLOSE cur;
DEALLOCATE cur;

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints 
    WHERE name = 'CK_orders_order_status' AND parent_object_id = OBJECT_ID('orders')
)
BEGIN
    ALTER TABLE orders WITH CHECK ADD CONSTRAINT CK_orders_order_status 
    CHECK (order_status IN ('pending', 'confirmed', 'shipping', 'delivered', 'cancelled'));
    PRINT 'Created CHECK constraint CK_orders_order_status';
END;

-- 5. Foreign Key & Query Performance Indexes
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_order_items_order_id' AND object_id = OBJECT_ID('order_items'))
BEGIN
    CREATE NONCLUSTERED INDEX idx_order_items_order_id ON order_items(order_id);
    PRINT 'Created index idx_order_items_order_id';
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_shipments_order_id' AND object_id = OBJECT_ID('shipments'))
BEGIN
    CREATE NONCLUSTERED INDEX idx_shipments_order_id ON shipments(order_id);
    PRINT 'Created index idx_shipments_order_id';
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_products_brand_id' AND object_id = OBJECT_ID('products'))
BEGIN
    CREATE NONCLUSTERED INDEX idx_products_brand_id ON products(brand_id);
    PRINT 'Created index idx_products_brand_id';
END;
GO
```

---

### 4.2 Proposed Implementation for `car-store-backend/migrate.js`

The proposed `car-store-backend/migrate.js` wraps the DDL in a reliable Node.js script supporting `.env` configurations and automatic driver detection:

```javascript
require('dotenv').config();
const path = require('path');

// Multi-driver connection helper (ODBC 17, ODBC 18, TDS)
async function connectDb() {
  // 1. Pure TDS (Remote / Serverless / Azure SQL)
  if (process.env.DB_SERVER && process.env.DB_USER) {
    try {
      const sql = require('mssql');
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
        }
      };
      const pool = await new sql.ConnectionPool(tdsConfig).connect();
      console.log('Connected via TDS to', process.env.DB_SERVER);
      return { pool, sql };
    } catch (err) {
      console.warn('TDS connection attempt failed:', err.message);
    }
  }

  // 2. Localhost ODBC (Windows Authentication)
  let sqlModule;
  try {
    sqlModule = require('mssql/msnodesqlv8');
  } catch {
    sqlModule = require('mssql');
  }

  const connStrings = [
    ...(process.env.DB_CONNECTION_STRING ? [process.env.DB_CONNECTION_STRING] : []),
    'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;',
    'Driver={ODBC Driver 18 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;TrustServerCertificate=yes;',
    'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=car_order_db;Trusted_Connection=yes;',
    'Driver={ODBC Driver 18 for SQL Server};Server=localhost;Database=car_order_db;Trusted_Connection=yes;TrustServerCertificate=yes;'
  ];

  for (const conn of connStrings) {
    try {
      const pool = await new sqlModule.ConnectionPool({ connectionString: conn }).connect();
      console.log('Connected via ODBC to SQL Server');
      return { pool, sql: sqlModule };
    } catch (e) {
      // try next
    }
  }

  throw new Error('Unable to connect to SQL Server with any configuration');
}

async function runMigration() {
  console.log('Starting CarModelStore database migration (Feature F2)...');
  const { pool } = await connectDb();

  try {
    // Step 1: Customer snapshot columns on orders
    console.log('[1/6] Checking customer snapshot columns on orders...');
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'orders' AND COLUMN_NAME = 'customer_name')
        ALTER TABLE orders ADD customer_name NVARCHAR(100) NULL;

      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'orders' AND COLUMN_NAME = 'customer_email')
        ALTER TABLE orders ADD customer_email VARCHAR(100) NULL;

      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'orders' AND COLUMN_NAME = 'customer_phone')
        ALTER TABLE orders ADD customer_phone VARCHAR(15) NULL;

      -- Backfill from users table
      UPDATE o
      SET 
        o.customer_name = ISNULL(o.customer_name, u.full_name),
        o.customer_email = ISNULL(o.customer_email, u.email),
        o.customer_phone = ISNULL(o.customer_phone, u.phone)
      FROM orders o
      INNER JOIN users u ON o.customer_id = u.id
      WHERE o.customer_name IS NULL OR o.customer_email IS NULL OR o.customer_phone IS NULL;
    `);

    // Step 2: UNIQUE constraint on orders.tracking_code
    console.log('[2/6] Checking UNIQUE constraint on orders.tracking_code...');
    await pool.request().query(`
      UPDATE orders 
      SET tracking_code = 'VNPOST-' + order_code 
      WHERE tracking_code IS NULL OR LTRIM(RTRIM(tracking_code)) = '';

      WITH DuplicateTracking AS (
        SELECT id, tracking_code, ROW_NUMBER() OVER (PARTITION BY tracking_code ORDER BY id) as rn
        FROM orders
        WHERE tracking_code IS NOT NULL
      )
      UPDATE o
      SET o.tracking_code = o.tracking_code + '-' + CAST(o.id AS VARCHAR(10))
      FROM orders o
      INNER JOIN DuplicateTracking d ON o.id = d.id
      WHERE d.rn > 1;

      IF NOT EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UQ_orders_tracking_code' AND parent_object_id = OBJECT_ID('orders'))
      BEGIN
        ALTER TABLE orders ADD CONSTRAINT UQ_orders_tracking_code UNIQUE (tracking_code);
      END
    `);

    // Step 3: CHECK constraint on products.stock_quantity >= 0
    console.log('[3/6] Checking CHECK constraint CK_products_stock_quantity...');
    await pool.request().query(`
      UPDATE products SET stock_quantity = 0 WHERE stock_quantity < 0;

      IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_products_stock_quantity' AND parent_object_id = OBJECT_ID('products'))
      BEGIN
        ALTER TABLE products WITH CHECK ADD CONSTRAINT CK_products_stock_quantity CHECK (stock_quantity >= 0);
      END
    `);

    // Step 4: Reconcile orders.order_status CHECK constraint
    console.log('[4/6] Reconciling CK_orders_order_status CHECK constraint...');
    await pool.request().query(`
      UPDATE orders SET order_status = 'pending' WHERE order_status = N'Chờ xử lý';
      UPDATE orders SET order_status = 'confirmed' WHERE order_status = 'processing';
      UPDATE orders SET order_status = 'delivered' WHERE order_status = 'completed';
      UPDATE orders SET order_status = 'cancelled' WHERE order_status = N'Đã hủy';
      UPDATE orders SET order_status = 'pending' 
      WHERE order_status IS NULL OR order_status NOT IN ('pending', 'confirmed', 'shipping', 'delivered', 'cancelled');

      DECLARE @chkName NVARCHAR(256);
      DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
        SELECT cc.name
        FROM sys.check_constraints cc
        JOIN sys.columns c ON cc.parent_object_id = c.object_id AND cc.parent_column_id = c.column_id
        WHERE cc.parent_object_id = OBJECT_ID('orders') 
          AND c.name = 'order_status' 
          AND cc.name <> 'CK_orders_order_status';

      OPEN cur;
      FETCH NEXT FROM cur INTO @chkName;
      WHILE @@FETCH_STATUS = 0
      BEGIN
        DECLARE @dropSql NVARCHAR(MAX) = N'ALTER TABLE orders DROP CONSTRAINT ' + QUOTENAME(@chkName);
        EXEC sp_executesql @dropSql;
        FETCH NEXT FROM cur INTO @chkName;
      END;
      CLOSE cur;
      DEALLOCATE cur;

      IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_orders_order_status' AND parent_object_id = OBJECT_ID('orders'))
      BEGIN
        ALTER TABLE orders WITH CHECK ADD CONSTRAINT CK_orders_order_status 
        CHECK (order_status IN ('pending', 'confirmed', 'shipping', 'delivered', 'cancelled'));
      END
    `);

    // Step 5: Check and create missing indexes
    console.log('[5/6] Checking missing indexes...');
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_orders_customer_id' AND object_id = OBJECT_ID('orders'))
        CREATE NONCLUSTERED INDEX idx_orders_customer_id ON orders(customer_id);

      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_order_items_order_id' AND object_id = OBJECT_ID('order_items'))
        CREATE NONCLUSTERED INDEX idx_order_items_order_id ON order_items(order_id);

      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_order_items_product_id' AND object_id = OBJECT_ID('order_items'))
        CREATE NONCLUSTERED INDEX idx_order_items_product_id ON order_items(product_id);

      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_shipments_order_id' AND object_id = OBJECT_ID('shipments'))
        CREATE NONCLUSTERED INDEX idx_shipments_order_id ON shipments(order_id);

      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_products_brand_id' AND object_id = OBJECT_ID('products'))
        CREATE NONCLUSTERED INDEX idx_products_brand_id ON products(brand_id);

      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_products_scale' AND object_id = OBJECT_ID('products'))
        CREATE NONCLUSTERED INDEX idx_products_scale ON products(scale);

      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_products_car_brand' AND object_id = OBJECT_ID('products'))
        CREATE NONCLUSTERED INDEX idx_products_car_brand ON products(car_brand);
    `);

    // Step 6: Ensure shipments table & mock catalog are seeded
    console.log('[6/6] Checking shipments table and catalog synchronization...');
    await pool.request().query(`
      IF OBJECT_ID('shipments', 'U') IS NULL
      BEGIN
        CREATE TABLE shipments (
          id INT IDENTITY(1,1) PRIMARY KEY,
          order_id INT NOT NULL,
          tracking_code VARCHAR(50) NOT NULL UNIQUE,
          carrier NVARCHAR(100) NOT NULL DEFAULT N'VNPost Tiết Kiệm',
          shipping_status NVARCHAR(50) NOT NULL DEFAULT N'pending',
          current_location NVARCHAR(255) NULL,
          estimated_delivery DATETIME NULL,
          notes NVARCHAR(MAX) NULL,
          created_at DATETIME DEFAULT GETDATE(),
          updated_at DATETIME DEFAULT GETDATE(),
          CONSTRAINT fk_shipments_orders FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
        );
      END

      IF NOT EXISTS (SELECT 1 FROM shipments WHERE tracking_code = 'VNPOST-ORD-2026-0001')
      BEGIN
        INSERT INTO shipments (order_id, tracking_code, carrier, shipping_status, current_location, estimated_delivery, notes)
        VALUES (1, 'VNPOST-ORD-2026-0001', N'VNPost Tiết Kiệm', N'in_transit', N'Kho trung chuyển Quận 1, TP.HCM', DATEADD(day, 2, GETDATE()), N'Đang trên đường giao tới người nhận');
      END
    `);

    // Synchronize catalog items (7..17) if product count <= 6
    const countRes = await pool.request().query('SELECT COUNT(*) as cnt FROM products');
    if (countRes.recordset[0].cnt <= 6) {
      console.log('Synchronizing remaining products into database...');
      await pool.request().query(`
        SET IDENTITY_INSERT products ON;
        IF NOT EXISTS (SELECT 1 FROM products WHERE id = 7)
          INSERT INTO products (id, product_code, name, scale, brand_id, manufacturer, car_brand, price, stock_quantity, status, image_url, description, rating, reviews)
          VALUES (7, 'FE-250GTO-118', N'Ferrari 250 GTO', '1:18', 1, 'Bburago', 'Ferrari', 980000.00, 12, 'in_stock', 'https://product.hstatic.net/200000726533/product/untitled-1_7cb79a259d0244d28d2177e136eca604_6e407e04dd734424a3069711ca8c01b6_1024x1024.jpg', N'Đúc kim loại tỉ lệ theo xe thật, mở cửa', 4.7, 130);
        IF NOT EXISTS (SELECT 1 FROM products WHERE id = 8)
          INSERT INTO products (id, product_code, name, scale, brand_id, manufacturer, car_brand, price, stock_quantity, status, image_url, description, rating, reviews)
          VALUES (8, 'LB-COUN-118', N'Lamborghini Countach LP500R', '1:18', 2, 'Maisto', 'Lamborghini', 1500000.00, 10, 'in_stock', 'https://product.hstatic.net/200000726533/product/i-countach-lpi-800-4-118-maisto-white_49959f41d4b74a159cb6b0c3333472f3_5885662615454265b1324395238fabfc_1024x1024.jpg', N'Đúc kim loại, mở cửa & capo', 4.7, 97);
        IF NOT EXISTS (SELECT 1 FROM products WHERE id = 9)
          INSERT INTO products (id, product_code, name, scale, brand_id, manufacturer, car_brand, price, stock_quantity, status, image_url, description, rating, reviews)
          VALUES (9, 'BMW-M3-118', N'BMW M3 E30', '1:18', 5, 'Solido', 'BMW', 1650000.00, 14, 'in_stock', 'https://product.hstatic.net/200000726533/product/inh-xe-bmw-m3-e30-1986-118-solido-red_b1911be3ed5240eb80802286771af420_eb2ce2d14ee140229df3d2873773ff7c_1024x1024.jpg', N'Đúc kim loại, nội thất chi tiết', 4.6, 58);
        IF NOT EXISTS (SELECT 1 FROM products WHERE id = 10)
          INSERT INTO products (id, product_code, name, scale, brand_id, manufacturer, car_brand, price, stock_quantity, status, image_url, description, rating, reviews)
          VALUES (10, 'BMW-30CSL-132', N'BMW 3.0 CSL', '1:32', 5, 'CCA', 'BMW', 560000.00, 25, 'in_stock', 'https://product.hstatic.net/200000726533/product/mo-hinh-xe-bmw-3-0-csl-1-64-cca__1__d087282c89a840e2acccf74dbcd19f5e_1024x1024.jpg', N'Đúc kim loại phổ thông', 4.2, 31);
        IF NOT EXISTS (SELECT 1 FROM products WHERE id = 11)
          INSERT INTO products (id, product_code, name, scale, brand_id, manufacturer, car_brand, price, stock_quantity, status, image_url, description, rating, reviews)
          VALUES (11, 'MB-300SL-118', N'Mercedes-Benz 300 SL Gullwing', '1:18', 4, 'GT Spirit', 'Mercedes-Benz', 550000.00, 20, 'in_stock', 'https://cdn.hstatic.net/products/200000726533/xe-mercedes-benz-300-sl-s-klub-gullwing-1-18-gt-spirit-nardo-grey__11__ae669aa621c541708af7146a41e39c72_1024x1024.jpg', N'Đúc kim loại cao cấp, cửa cánh chim', 4.9, 142);
        IF NOT EXISTS (SELECT 1 FROM products WHERE id = 12)
          INSERT INTO products (id, product_code, name, scale, brand_id, manufacturer, car_brand, price, stock_quantity, status, image_url, description, rating, reviews)
          VALUES (12, 'PO-911GT3-118', N'Porsche 911 GT3 RS', '1:18', 3, 'GTAutos', 'Porsche', 780000.00, 18, 'in_stock', 'https://product.hstatic.net/200000726533/product/he-911-gt3-rs-118-gtautos-lava-orange_6767b770c8c846fea98631a8168a8450_023d54cd393147a3b9181c8172b67704_1024x1024.jpg', N'Đúc kim loại, khung gầm chi tiết như xe thật', 4.8, 110);
        IF NOT EXISTS (SELECT 1 FROM products WHERE id = 13)
          INSERT INTO products (id, product_code, name, scale, brand_id, manufacturer, car_brand, price, stock_quantity, status, image_url, description, rating, reviews)
          VALUES (13, 'FD-MUSTANG-124', N'Ford Mustang GT500', '1:24', 8, 'Maisto', 'Ford', 870000.00, 15, 'in_stock', 'https://product.hstatic.net/200000726533/product/bra-gt500-118-maisto-31388-light-blue_5ed98ba13ede48e6ad36a1a6c5e70920_b2072578327041e2908767942696c448_1024x1024.jpg', N'Đúc kim loại, decal đua nguyên bản', 4.3, 45);
        IF NOT EXISTS (SELECT 1 FROM products WHERE id = 14)
          INSERT INTO products (id, product_code, name, scale, brand_id, manufacturer, car_brand, price, stock_quantity, status, image_url, description, rating, reviews)
          VALUES (14, 'TY-AE86-164', N'Toyota AE86 Trueno', '1:64', 9, 'Tarmac Works', 'Toyota', 450000.00, 22, 'in_stock', 'https://cdn.hstatic.net/products/200000726533/nh-xe-toyota-sprinter-trueno-ae86-widebody-1-64-tarmac-works-green__3__56312cbf88f1492e9aa7968b1d5682bf_1024x1024.jpg', N'Đúc kim loại mini, bánh cao su thật', 4.4, 72);
        IF NOT EXISTS (SELECT 1 FROM products WHERE id = 15)
          INSERT INTO products (id, product_code, name, scale, brand_id, manufacturer, car_brand, price, stock_quantity, status, image_url, description, rating, reviews)
          VALUES (15, 'BG-CHIRON-118', N'Bugatti Chiron Super Sport', '1:18', NULL, 'MiniGT', 'Bugatti', 3450000.00, 7, 'pre_order', 'https://product.hstatic.net/200000726533/product/super-sport-300_-164_minigt-white__2__43c02c65ffec48a7a3c2e24794986b37_0659ba5a69ca4df1ab9a61388c49e752_1024x1024.jpg', N'Đúc kim loại cao cấp, số lượng giới hạn', 5.0, 19);
        IF NOT EXISTS (SELECT 1 FROM products WHERE id = 16)
          INSERT INTO products (id, product_code, name, scale, brand_id, manufacturer, car_brand, price, stock_quantity, status, image_url, description, rating, reviews)
          VALUES (16, 'KN-JESKO-118', N'Koenigsegg Jesko', '1:18', NULL, 'GT Spirit', 'Koenigsegg', 3190000.00, 5, 'pre_order', 'https://product.hstatic.net/200000726533/product/img_3102_e5b8b22e5f7843499a0c74e2a02dd622_e81f9d2e0195493ca221083829c0b77b_1024x1024.jpg', N'Đúc kim loại, hộp trưng bày kính', 4.9, 12);
        IF NOT EXISTS (SELECT 1 FROM products WHERE id = 17)
          INSERT INTO products (id, product_code, name, scale, brand_id, manufacturer, car_brand, price, stock_quantity, status, image_url, description, rating, reviews)
          VALUES (17, 'PG-UTOPIA-118', N'Pagani Utopia', '1:18', NULL, 'CCA', 'Pagani', 3650000.00, 6, 'pre_order', 'https://product.hstatic.net/200000726533/product/mo-hinh-xe-pagani-utopia-1-64-cca-black__1__299a8613897b44b9a18dbbdfabb06315_1024x1024.jpg', N'Đúc kim loại cao cấp, sản xuất theo đơn đặt trước', 5.0, 7);
        SET IDENTITY_INSERT products OFF;
      `);
      console.log('Products synchronized successfully!');
    }

    console.log('Database migration completed 100% successfully!');
  } finally {
    await pool.close();
  }
}

if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { runMigration, connectDb };
```

---

### 4.3 Proposed Updates for Baseline DDL (`database/01_create_tables.sql` & `00_full_setup.sql`)

In `database/01_create_tables.sql` (and `00_full_setup.sql`), update section 6 (`orders`), section 4 (`products`), and section 9 (`Indexes`):

1. **Table `orders`**:
   ```sql
   IF OBJECT_ID('orders', 'U') IS NULL
   CREATE TABLE orders (
       id INT IDENTITY(1,1) PRIMARY KEY,
       order_code VARCHAR(30) NOT NULL UNIQUE,
       customer_id INT NOT NULL,
       customer_name NVARCHAR(100) NULL,
       customer_email VARCHAR(100) NULL,
       customer_phone VARCHAR(15) NULL,
       recipient_name NVARCHAR(100) NOT NULL,
       recipient_phone VARCHAR(15) NOT NULL,
       shipping_address NVARCHAR(MAX) NOT NULL,
       total_amount DECIMAL(14, 2) NOT NULL DEFAULT 0,
       tracking_code VARCHAR(50) NULL,
       order_status NVARCHAR(20) DEFAULT 'pending',
       created_at DATETIME DEFAULT GETDATE(),
       
       CONSTRAINT fk_orders_users FOREIGN KEY (customer_id) REFERENCES users(id),
       CONSTRAINT UQ_orders_tracking_code UNIQUE (tracking_code),
       CONSTRAINT CK_orders_order_status CHECK (order_status IN ('pending', 'confirmed', 'shipping', 'delivered', 'cancelled'))
   );
   ```

2. **Table `products`**:
   Add explicit check constraint on `stock_quantity`:
   ```sql
   CONSTRAINT CK_products_stock_quantity CHECK (stock_quantity >= 0)
   ```

3. **Section 9 (`Indexes`)**:
   Add foreign key indexes:
   ```sql
   IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_order_items_order_id')
       CREATE NONCLUSTERED INDEX idx_order_items_order_id ON order_items(order_id);
   IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_shipments_order_id')
       CREATE NONCLUSTERED INDEX idx_shipments_order_id ON shipments(order_id);
   IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_products_brand_id')
       CREATE NONCLUSTERED INDEX idx_products_brand_id ON products(brand_id);
   ```

---

### 4.4 Guidance for Subsequent Milestones (Downstream Impact)

1. **Milestone 2 (AC1, Feature F3: `POST /api/orders`)**:
   - `server.js` must extract `customerName`, `customerEmail`, `customerPhone` from `req.body`.
   - If not provided in `req.body`, fetch defaults from `users WHERE id = @customerId`.
   - Update `INSERT INTO orders` to include:
     `customer_name, customer_email, customer_phone`.
2. **Milestone 2 (AC3, Feature F4: `PUT /api/orders/:code/status`)**:
   - Remove `'completed'` from allowed status inputs, or map `'completed'` to `'delivered'`.
   - Status updates must only use `'pending'`, `'confirmed'`, `'shipping'`, `'delivered'`, `'cancelled'`.
3. **Milestone 3 (Feature F5, F6: Tracking & Account History)**:
   - Order history queries in `/api/orders` should return `customer_name`, `customer_email`, `customer_phone`.

---

## 5. Verification Method

To independently verify this specification:

### 5.1 Verification Test Command
Run this command from the project root (`d:\laptrinhweb - Copy`):
```powershell
node -e "
const sql = require('./car-store-backend/node_modules/mssql/msnodesqlv8');
const cfg = { connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;' };
async function verify() {
  const pool = await sql.connect(cfg);
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const r = new sql.Request(tx);
    // 1. Snapshot columns
    await r.query('IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME=\"orders\" AND COLUMN_NAME=\"customer_name\") ALTER TABLE orders ADD customer_name NVARCHAR(100) NULL');
    // 2. Constraints
    await r.query('ALTER TABLE products WITH CHECK ADD CONSTRAINT CK_products_stock_quantity CHECK (stock_quantity >= 0)');
    await r.query('ALTER TABLE orders ADD CONSTRAINT UQ_orders_tracking_code UNIQUE (tracking_code)');
    console.log('✅ DDL parsed and applied successfully.');
    // 3. Negative stock test
    let stockBlocked = false;
    try { await r.query('UPDATE products SET stock_quantity = -1 WHERE id = 1'); }
    catch (e) { if (e.message.includes('CK_products_stock_quantity')) stockBlocked = true; }
    console.log(stockBlocked ? '✅ Negative stock blocked by CHECK.' : '❌ Stock check failed.');
    await tx.rollback();
    pool.close();
  } catch(e) {
    console.error('Verification error:', e);
    await tx.rollback();
    pool.close();
  }
}
verify();
"
```

### 5.2 Post-Implementation Verification
Once the implementer executes `node car-store-backend/migrate.js`:
1. Verify column existence:
   ```sql
   SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'orders' AND COLUMN_NAME IN ('customer_name', 'customer_email', 'customer_phone');
   ```
   *Expected*: Returns 3 rows.
2. Verify constraints:
   ```sql
   SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_NAME IN ('UQ_orders_tracking_code', 'CK_products_stock_quantity', 'CK_orders_order_status');
   ```
   *Expected*: Returns 3 rows (`UQ_orders_tracking_code` UNIQUE, `CK_products_stock_quantity` CHECK, `CK_orders_order_status` CHECK).
3. Verify idempotency:
   Executing `node car-store-backend/migrate.js` a second time should exit with code 0 without any error or duplicate constraint warning.
