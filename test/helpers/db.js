const path = require('path');
const { DB_CONNECTION_STRING, BACKEND_DIR } = require('./config');

// Require mssql/msnodesqlv8 from the backend node_modules
let sql;
try {
    sql = require(path.join(BACKEND_DIR, 'node_modules/mssql/msnodesqlv8'));
} catch (e) {
    try {
        sql = require(path.join(BACKEND_DIR, 'node_modules/mssql'));
    } catch (e2) {
        sql = require('mssql');
    }
}

let poolPromise = null;

async function getPool() {
    if (!poolPromise) {
        poolPromise = new sql.ConnectionPool({
            connectionString: DB_CONNECTION_STRING,
            pool: { max: 10, min: 1, idleTimeoutMillis: 30000 }
        }).connect().catch(err => {
            poolPromise = null;
            throw err;
        });
    }
    return poolPromise;
}

async function query(sqlText, params = {}) {
    const pool = await getPool();
    const request = pool.request();
    for (const [key, value] of Object.entries(params)) {
        request.input(key, value);
    }
    return request.query(sqlText);
}

async function getProduct(id) {
    const res = await query('SELECT * FROM products WHERE id = @id', { id });
    return res.recordset[0] || null;
}

async function getOrder(orderCode) {
    const res = await query('SELECT * FROM orders WHERE order_code = @orderCode OR tracking_code = @orderCode', { orderCode });
    return res.recordset[0] || null;
}

async function getShipment(trackingCode) {
    const res = await query('SELECT * FROM shipments WHERE tracking_code = @trackingCode', { trackingCode });
    return res.recordset[0] || null;
}

async function getOrderItems(orderId) {
    const res = await query('SELECT * FROM order_items WHERE order_id = @orderId', { orderId });
    return res.recordset || [];
}

async function setProductStock(id, stockQuantity) {
    await query('UPDATE products SET stock_quantity = @stockQuantity WHERE id = @id', { id, stockQuantity });
}

async function cleanupOrders(orderCodes = []) {
    if (!orderCodes || orderCodes.length === 0) return;
    const pool = await getPool();
    for (const code of orderCodes) {
        try {
            const orderRes = await pool.request()
                .input('code', sql.VarChar(100), code)
                .query('SELECT id FROM orders WHERE order_code = @code OR tracking_code = @code');
            if (orderRes.recordset.length > 0) {
                const orderId = orderRes.recordset[0].id;
                await pool.request().input('orderId', sql.Int, orderId).query('DELETE FROM shipments WHERE order_id = @orderId');
                await pool.request().input('orderId', sql.Int, orderId).query('DELETE FROM order_items WHERE order_id = @orderId');
                await pool.request().input('orderId', sql.Int, orderId).query('DELETE FROM orders WHERE id = @orderId');
            }
        } catch (err) {
            console.warn('Cleanup error for order code', code, err.message);
        }
    }
}

async function resetSeedStock() {
    const pool = await getPool();
    await pool.request().query(`
        UPDATE products SET stock_quantity = 15 WHERE id = 1;
        UPDATE products SET stock_quantity = 20 WHERE id = 2;
        UPDATE products SET stock_quantity = 8 WHERE id = 3;
        UPDATE products SET stock_quantity = 10 WHERE id = 4;
        UPDATE products SET stock_quantity = 5 WHERE id = 5;
        UPDATE products SET stock_quantity = 0 WHERE id = 6;
    `);
}

async function close() {
    if (poolPromise) {
        const pool = await poolPromise;
        await pool.close();
        poolPromise = null;
    }
}

module.exports = {
    sql,
    getPool,
    query,
    getProduct,
    getOrder,
    getShipment,
    getOrderItems,
    setProductStock,
    cleanupOrders,
    resetSeedStock,
    close
};
