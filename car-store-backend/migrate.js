require('dotenv').config();
const path = require('path');

// Multi-driver connection helper (ODBC 17, ODBC 18, TDS)
async function connectDb() {
  // 1. Pure TDS (Remote / Serverless / Azure SQL / Linux containers)
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
      // try next connection string
    }
  }

  throw new Error('Unable to connect to SQL Server with any configuration');
}

async function runMigration() {
  console.log('Starting CarModelStore database migration (Feature F2)...');
  const { pool } = await connectDb();

  try {
    // Step 1: Customer snapshot columns on orders (DDL first, then DML backfill in separate batches)
    console.log('[1/7] Checking customer snapshot columns on orders...');
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'orders' AND COLUMN_NAME = 'customer_name')
        ALTER TABLE orders ADD customer_name NVARCHAR(100) NULL;

      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'orders' AND COLUMN_NAME = 'customer_email')
        ALTER TABLE orders ADD customer_email VARCHAR(100) NULL;

      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'orders' AND COLUMN_NAME = 'customer_phone')
        ALTER TABLE orders ADD customer_phone VARCHAR(15) NULL;
    `);

    // Backfill historical snapshot from users table in separate query batch
    await pool.request().query(`
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
    console.log('[2/7] Checking UNIQUE constraint on orders.tracking_code...');
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'orders' AND COLUMN_NAME = 'tracking_code'
      )
      BEGIN
        ALTER TABLE orders ADD tracking_code VARCHAR(50) NULL;
      END
    `);

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
    console.log('[3/7] Checking CHECK constraint CK_products_stock_quantity...');
    await pool.request().query(`
      UPDATE products SET stock_quantity = 0 WHERE stock_quantity < 0;

      IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_products_stock_quantity' AND parent_object_id = OBJECT_ID('products'))
      BEGIN
        ALTER TABLE products WITH CHECK ADD CONSTRAINT CK_products_stock_quantity CHECK (stock_quantity >= 0);
      END
    `);

    // Step 4: Reconcile orders.order_status CHECK constraint
    console.log('[4/7] Reconciling CK_orders_order_status CHECK constraint...');
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
        CHECK (order_status IN ('pending', 'confirmed', 'shipping', 'delivered', 'completed', 'cancelled'));
      END
    `);

    // Step 5: Check and create missing indexes
    console.log('[5/7] Checking missing indexes...');
    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_orders_customer_id' AND object_id = OBJECT_ID('orders'))
        CREATE NONCLUSTERED INDEX idx_orders_customer_id ON orders(customer_id);

      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_orders_tracking_code' AND object_id = OBJECT_ID('orders'))
        CREATE NONCLUSTERED INDEX idx_orders_tracking_code ON orders(tracking_code);

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
    console.log('[6/7] Checking shipments table and initial seed...');
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

    // Step 7: Synchronize catalog items (7..17) if product count <= 6
    console.log('[7/7] Checking product catalog synchronization...');
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
