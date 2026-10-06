const sql = require('../../../car-store-backend/node_modules/mssql/msnodesqlv8');
const connStr = 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;';

async function verifyCatalogs() {
  const pool = await new sql.ConnectionPool({ connectionString: connStr }).connect();
  console.log('Connected to CarModelStoreDB successfully.');

  // 1. Check constraints
  const chkRes = await pool.request().query(`
    SELECT cc.name, OBJECT_NAME(cc.parent_object_id) as table_name, cc.definition, cc.is_disabled
    FROM sys.check_constraints cc
    WHERE OBJECT_NAME(cc.parent_object_id) IN ('products', 'orders')
  `);
  console.log('=== sys.check_constraints ===');
  console.log(JSON.stringify(chkRes.recordset, null, 2));

  // 2. Key constraints (PK and UNIQUE)
  const keyRes = await pool.request().query(`
    SELECT kc.name, OBJECT_NAME(kc.parent_object_id) as table_name, kc.type_desc, kc.is_system_named
    FROM sys.key_constraints kc
    WHERE OBJECT_NAME(kc.parent_object_id) IN ('orders', 'products', 'shipments')
  `);
  console.log('=== sys.key_constraints ===');
  console.log(JSON.stringify(keyRes.recordset, null, 2));

  // 3. Columns in orders table
  const colRes = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'orders'
    ORDER BY ORDINAL_POSITION
  `);
  console.log('=== orders COLUMNS ===');
  console.log(JSON.stringify(colRes.recordset, null, 2));

  // 4. Indexes
  const idxRes = await pool.request().query(`
    SELECT i.name, OBJECT_NAME(i.object_id) as table_name, i.type_desc, i.is_unique
    FROM sys.indexes i
    WHERE OBJECT_NAME(i.object_id) IN ('orders', 'products', 'order_items', 'shipments')
      AND i.name LIKE 'idx_%'
  `);
  console.log('=== indexes ===');
  console.log(JSON.stringify(idxRes.recordset, null, 2));

  // 5. Test constraint enforcement:
  console.log('=== Testing CK_products_stock_quantity enforcement ===');
  try {
    await pool.request().query('UPDATE products SET stock_quantity = -10 WHERE id = 1');
    console.error('FAIL: Database allowed negative stock!');
    process.exit(1);
  } catch (err) {
    console.log('PASS: Negative stock rejected by constraint:', err.message);
  }

  console.log('=== Testing UQ_orders_tracking_code enforcement ===');
  const existingOrder = await pool.request().query('SELECT TOP 1 tracking_code FROM orders WHERE tracking_code IS NOT NULL');
  if (existingOrder.recordset.length > 0) {
    const existingCode = existingOrder.recordset[0].tracking_code;
    try {
      await pool.request().query(`
        INSERT INTO orders (order_code, customer_id, recipient_name, recipient_phone, shipping_address, total_amount, order_status, tracking_code)
        VALUES ('TEST-DUP-UQ', 1, 'Test', '0123456789', 'Address', 1000, 'pending', '${existingCode}')
      `);
      console.error('FAIL: Database allowed duplicate tracking code!');
      process.exit(1);
    } catch (err) {
      console.log('PASS: Duplicate tracking code rejected by constraint:', err.message);
    }
  }

  console.log('=== Testing CK_orders_order_status enforcement ===');
  try {
    await pool.request().query(`
      INSERT INTO orders (order_code, customer_id, recipient_name, recipient_phone, shipping_address, total_amount, order_status, tracking_code)
      VALUES ('TEST-BAD-STATUS', 1, 'Test', '0123456789', 'Address', 1000, 'invalid_status_xyz', 'VNPOST-TEST-BAD-STATUS')
    `);
    console.error('FAIL: Database allowed invalid order status!');
    process.exit(1);
  } catch (err) {
    console.log('PASS: Invalid order status rejected by constraint:', err.message);
  }

  await pool.close();
  console.log('ALL PHYSICAL CATALOG CHECKS PASSED!');
}

verifyCatalogs().catch(e => { console.error('Verification failed:', e); process.exit(1); });
