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
const crypto = require('crypto');

const app = express();

// Phục vụ giao diện web tĩnh trực tiếp từ thư mục gốc dự án (index.html, products.html, assets, admin, ...)
const rootDir = path.join(__dirname, '..');
app.use(express.static(rootDir));

// Cấu hình CORS
const allowedOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({
    origin: allowedOrigin === '*' ? '*' : allowedOrigin.split(','),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning', 'x-requested-with']
}));

app.use(express.json());

// Tuyến đường gốc '/' tự động mở trang chủ index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(rootDir, 'index.html'));
});

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

// 0. API Kiểm tra sức khỏe (Health check)
app.get('/api/health', async (req, res) => {
    let dbStatus = 'disconnected';
    let stats = {};
    try {
        const { pool } = await getDb();
        const testQuery = await pool.request().query('SELECT 1 as test');
        if (testQuery.recordset) {
            dbStatus = 'connected';
            const countResult = await pool.request().query(`
                SELECT 
                    (SELECT COUNT(*) FROM products) as total_products,
                    (SELECT COUNT(*) FROM orders) as total_orders
            `);
            if (countResult.recordset.length > 0) {
                stats = countResult.recordset[0];
            }
        }
    } catch (e) {
        dbStatus = 'error: ' + e.message;
    }

    res.json({
        success: true,
        status: 'online',
        message: 'Backend CarModelStore đang hoạt động ổn định!',
        database: dbStatus,
        stats: stats,
        timestamp: new Date().toISOString()
    });
});

// API Thống kê chỉ số cho Admin Dashboard (Doanh thu, Số xe, Đơn hàng, Hãng xe & 5 đơn mới nhất)
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const { pool } = await getDb();

        // 1. Thống kê số lượng và tổng doanh thu
        const statsQuery = await pool.request().query(`
            SELECT 
                (SELECT COUNT(*) FROM products) as total_products,
                (SELECT COUNT(*) FROM orders) as total_orders,
                (SELECT COUNT(*) FROM orders WHERE order_status IN ('pending', 'processing', N'Chờ xử lý')) as pending_orders,
                (SELECT COUNT(*) FROM brands) as total_brands,
                (SELECT ISNULL(SUM(total_amount), 0) FROM orders WHERE order_status NOT IN ('cancelled', N'Đã hủy')) as total_revenue
        `);

        // 2. Lấy 5 đơn hàng mới nhất để đồng bộ bảng trên dashboard
        const recentOrdersQuery = await pool.request().query(`
            SELECT TOP 5 
                o.id, o.order_code, o.customer_id, o.recipient_name, 
                o.recipient_phone, o.shipping_address, o.total_amount, 
                o.order_status, o.tracking_code, o.created_at,
                (SELECT TOP 1 p.name + ' (' + p.scale + ')' 
                 FROM order_items oi 
                 JOIN products p ON oi.product_id = p.id 
                 WHERE oi.order_id = o.id) as first_item_name
            FROM orders o
            ORDER BY o.created_at DESC
        `);

        res.json({
            success: true,
            stats: statsQuery.recordset[0] || {},
            recentOrders: recentOrdersQuery.recordset || []
        });
    } catch (error) {
        console.error('Lỗi khi lấy dữ liệu Dashboard:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy dữ liệu thống kê.', error: error.message });
    }
});

// ==========================================
// API XÁC THỰC TÀI KHOẢN (DATABASE PERSISTENCE: USERS)
// ==========================================

// API Đăng ký tài khoản mới (Lưu trực tiếp vào bảng users trong SQL Server)
app.post('/api/auth/register', async (req, res) => {
    try {
        const { fullname, email, password, phone = '', address = '' } = req.body;

        if (!fullname || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp đầy đủ: Họ tên, Email và Mật khẩu.'
            });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanName = fullname.trim();
        const cleanPassword = password.trim();

        const { pool, sql } = await getDb();

        // 1. Kiểm tra xem email đã tồn tại trong database chưa
        const checkReq = pool.request();
        checkReq.input('email', sql.VarChar(100), cleanEmail);
        const checkRes = await checkReq.query(`SELECT id, email FROM users WHERE LOWER(email) = @email`);

        if (checkRes.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Email này đã được đăng ký trong hệ thống. Vui lòng sử dụng email khác hoặc đăng nhập!'
            });
        }

        // 2. Tạo username tự động từ email nếu chưa có
        const username = cleanEmail.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '');

        // 3. Thêm tài khoản mới vào database users
        const insertReq = pool.request();
        insertReq.input('username', sql.VarChar(50), username);
        insertReq.input('password', sql.VarChar(255), cleanPassword);
        insertReq.input('fullName', sql.NVarChar(100), cleanName);
        insertReq.input('email', sql.VarChar(100), cleanEmail);
        insertReq.input('phone', sql.VarChar(15), phone ? phone.trim() : null);
        insertReq.input('address', sql.NVarChar(sql.MAX), address ? address.trim() : null);
        insertReq.input('role', sql.VarChar(20), 'customer');

        const insertRes = await insertReq.query(`
            INSERT INTO users (username, password, full_name, email, phone, address, role, created_at)
            OUTPUT INSERTED.id, INSERTED.username, INSERTED.full_name, INSERTED.email, INSERTED.role, INSERTED.created_at
            VALUES (@username, @password, @fullName, @email, @phone, @address, @role, GETDATE());
        `);

        const createdUser = insertRes.recordset[0];

        res.status(201).json({
            success: true,
            message: 'Đăng ký tài khoản thành công! Dữ liệu đã được lưu vào cơ sở dữ liệu.',
            user: {
                id: createdUser.id,
                name: createdUser.full_name,
                email: createdUser.email,
                role: createdUser.role
            }
        });
    } catch (error) {
        console.error('Lỗi khi đăng ký tài khoản:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi máy chủ khi đăng ký tài khoản: ' + error.message
        });
    }
});

// API Đăng nhập tài khoản (Kiểm tra và xác thực từ Database SQL Server)
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp Email và Mật khẩu.'
            });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanPassword = password.trim();

        const { pool, sql } = await getDb();
        const request = pool.request();
        request.input('email', sql.VarChar(100), cleanEmail);

        const result = await request.query(`
            SELECT id, username, password, full_name, email, phone, address, role 
            FROM users 
            WHERE LOWER(email) = @email
        `);

        if (result.recordset.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Email không tồn tại trong hệ thống!'
            });
        }

        const user = result.recordset[0];

        if (user.password !== cleanPassword) {
            return res.status(401).json({
                success: false,
                message: 'Mật khẩu không chính xác. Vui lòng kiểm tra lại!'
            });
        }

        res.json({
            success: true,
            message: 'Đăng nhập thành công!',
            user: {
                id: user.id,
                name: user.full_name,
                email: user.email,
                phone: user.phone || '',
                address: user.address || '',
                role: user.role
            }
        });
    } catch (error) {
        console.error('Lỗi khi đăng nhập tài khoản:', error);
        res.status(500).json({
            success: false,
            message: 'Lỗi máy chủ khi xác thực đăng nhập: ' + error.message
        });
    }
});

// 1. API Lấy danh sách Đơn hàng (dùng cho trang quản trị Admin và khách hàng)
app.get('/api/orders', async (req, res) => {
    try {
        const { pool, sql } = await getDb();
        const { customer_id, email } = req.query;
        const request = pool.request();
        
        let queryStr = `
            SELECT o.id, o.order_code, o.customer_id, o.customer_email, o.recipient_name, 
                   o.recipient_phone, o.shipping_address, o.total_amount, 
                   o.order_status, o.tracking_code, o.created_at,
                   COUNT(i.id) as total_items
            FROM orders o
            LEFT JOIN order_items i ON o.id = i.order_id
        `;

        const filterClauses = [];
        if (customer_id) {
            const parsedCid = parseInt(customer_id, 10);
            if (!isNaN(parsedCid)) {
                filterClauses.push(`o.customer_id = @customerId`);
                request.input('customerId', sql.Int, parsedCid);
            }
        }
        if (email && String(email).trim()) {
            filterClauses.push(`LOWER(o.customer_email) = @customerEmail`);
            request.input('customerEmail', sql.VarChar(100), String(email).trim().toLowerCase());
        }

        if (filterClauses.length > 0) {
            queryStr += ` WHERE ` + filterClauses.join(' OR ');
        }

        queryStr += `
            GROUP BY o.id, o.order_code, o.customer_id, o.customer_email, o.recipient_name, 
                     o.recipient_phone, o.shipping_address, o.total_amount, 
                     o.order_status, o.tracking_code, o.created_at
            ORDER BY o.created_at DESC
        `;

        const result = await request.query(queryStr);
        res.json({
            success: true,
            orders: result.recordset
        });
    } catch (error) {
        console.error('Lỗi khi lấy danh sách đơn hàng:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy dữ liệu đơn hàng.', error: error.message });
    }
});

// 2. API Cập nhật trạng thái đơn hàng (dùng cho trang Admin và Khách hàng hủy đơn) - ACID Transaction & Two-Way State Machine (F4)
app.put('/api/orders/:code/status', async (req, res) => {
    const { code } = req.params;
    const { status } = req.body;

    if (!code || !String(code).trim()) {
        return res.status(400).json({
            success: false,
            error: 'Vui lòng cung cấp mã đơn hàng hoặc mã vận đơn.',
            message: 'Vui lòng cung cấp mã đơn hàng hoặc mã vận đơn.'
        });
    }

    const validStatuses = ['pending', 'confirmed', 'shipping', 'delivered', 'completed', 'cancelled'];
    if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({
            success: false,
            error: `Trạng thái không hợp lệ. Các trạng thái hợp lệ: ${validStatuses.join(', ')}`,
            message: `Trạng thái không hợp lệ. Các trạng thái hợp lệ: ${validStatuses.join(', ')}`
        });
    }

    const cleanCode = String(code).trim().replace(/^#/, '');

    try {
        const { pool, sql } = await getDb();
        const transaction = new sql.Transaction(pool);
        let isTransactionActive = false;
        let isCommitted = false;
        let isRolledBack = false;

        const rollbackSafely = async () => {
            if (!isTransactionActive || isCommitted || isRolledBack) return;
            isRolledBack = true;
            try {
                if (!transaction._aborted) {
                    await transaction.rollback();
                }
            } catch (rbErr) {
                console.warn('⚠️ Safe rollback suppressed error:', rbErr.message);
            } finally {
                isTransactionActive = false;
            }
        };

        await transaction.begin();
        isTransactionActive = true;

        try {
            // Bước 1: Khóa dòng đơn hàng với (UPDLOCK, ROWLOCK) để kiểm tra trạng thái hiện tại và ngăn chặn race condition
            const findReq = new sql.Request(transaction);
            const findRes = await findReq
                .input('code', sql.VarChar(50), cleanCode)
                .query(`
                    SELECT id, order_code, tracking_code, order_status 
                    FROM orders WITH (UPDLOCK, ROWLOCK) 
                    WHERE order_code = @code OR tracking_code = @code
                `);

            if (findRes.recordset.length === 0) {
                await rollbackSafely();
                return res.status(404).json({ 
                    success: false, 
                    error: 'Không tìm thấy đơn hàng cần cập nhật.',
                    message: 'Không tìm thấy đơn hàng cần cập nhật.' 
                });
            }

            const order = findRes.recordset[0];
            const orderId = order.id;
            const orderCode = order.order_code;
            const trackingCode = order.tracking_code;
            const currentStatus = order.order_status;

            // Bước 2: Kiểm tra Idempotent Cancellation (Chống lạm phát tồn kho - Defect 1 / Boundary 3.1 & 3.2)
            if (status === 'cancelled' && currentStatus === 'cancelled') {
                await rollbackSafely();
                return res.status(400).json({
                    success: false,
                    error: 'Đơn hàng đã ở trạng thái cancelled, không thể hủy lại.',
                    message: 'Đơn hàng đã ở trạng thái cancelled, không thể hủy lại.'
                });
            }

            // Bước 3: Nếu hủy đơn hàng: hoàn trả lại tồn kho nguyên tử
            let stockRestored = false;
            if (status === 'cancelled' && currentStatus !== 'cancelled') {
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
                stockRestored = true;
            }

            // Bước 4: Cập nhật trạng thái đơn hàng
            const updateOrderReq = new sql.Request(transaction);
            await updateOrderReq
                .input('orderId', sql.Int, orderId)
                .input('status', sql.NVarChar(20), status)
                .query(`
                    UPDATE orders 
                    SET order_status = @status 
                    WHERE id = @orderId;
                `);

            // Bước 5: Đồng bộ trạng thái vận đơn (shipments)
            let shipmentStatus = 'pending';
            if (status === 'shipping') shipmentStatus = 'in_transit';
            else if (status === 'delivered' || status === 'completed') shipmentStatus = 'delivered';
            else if (status === 'cancelled') shipmentStatus = 'cancelled';

            const updateShipReq = new sql.Request(transaction);
            await updateShipReq
                .input('orderId', sql.Int, orderId)
                .input('shipStatus', sql.NVarChar(50), shipmentStatus)
                .query(`
                    UPDATE shipments
                    SET shipping_status = @shipStatus, updated_at = GETDATE()
                    WHERE order_id = @orderId;
                `);

            await transaction.commit();
            isCommitted = true;
            isTransactionActive = false;

            return res.json({
                success: true,
                message: 'Cập nhật trạng thái đơn hàng thành công',
                orderCode: orderCode,
                trackingCode: trackingCode,
                status: status,
                previousStatus: currentStatus,
                newStatus: status,
                stockRestored: stockRestored
            });
        } catch (innerErr) {
            await rollbackSafely();
            throw innerErr;
        }
    } catch (error) {
        console.error('Lỗi khi cập nhật trạng thái đơn hàng:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Lỗi máy chủ khi cập nhật đơn hàng.', 
            message: 'Lỗi máy chủ khi cập nhật đơn hàng.', 
            details: error.message 
        });
    }
});

// 3. API nhận yêu cầu Đặt hàng từ Website (ACID Transaction, Row-Locking, Authoritative Pricing, Defect 3 Resolution)
app.post('/api/orders', async (req, res) => {
    const { 
        customerId = 1, 
        customerName, 
        customerEmail, 
        customerPhone, 
        recipientName, 
        recipientPhone, 
        shippingAddress, 
        items 
    } = req.body || {};

    // 1. Validation đầu vào: Thông tin giao hàng
    if (!recipientName || !String(recipientName).trim() || 
        !recipientPhone || !String(recipientPhone).trim() || 
        !shippingAddress || !String(shippingAddress).trim()) {
        return res.status(400).json({ 
            success: false, 
            error: 'Vui lòng cung cấp đầy đủ: Tên người nhận, Số điện thoại và Địa chỉ giao hàng.',
            message: 'Vui lòng cung cấp đầy đủ: Tên người nhận, Số điện thoại và Địa chỉ giao hàng.' 
        });
    }

    // 2. Validation đầu vào: Danh sách sản phẩm giỏ hàng
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ 
            success: false, 
            error: 'Giỏ hàng đang trống.',
            message: 'Giỏ hàng đang trống.' 
        });
    }

    // 3. Tiền tổng hợp số lượng (Pre-aggregation) giải quyết Defect 3 & Kiểm tra tính hợp lệ của items
    const aggregatedMap = new Map();
    for (const item of items) {
        if (!item || typeof item !== 'object') {
            return res.status(400).json({ 
                success: false, 
                error: 'Dữ liệu sản phẩm không hợp lệ.',
                message: 'Dữ liệu sản phẩm không hợp lệ.' 
            });
        }

        const pid = parseInt(item.productId, 10);
        const reqQty = parseInt(item.quantity, 10);

        if (isNaN(pid) || isNaN(reqQty) || pid <= 0 || reqQty <= 0 || String(item.quantity).trim() !== String(reqQty)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Thông tin sản phẩm hoặc số lượng không hợp lệ.',
                message: 'Thông tin sản phẩm hoặc số lượng không hợp lệ.' 
            });
        }

        if (aggregatedMap.has(pid)) {
            aggregatedMap.get(pid).quantity += reqQty;
        } else {
            aggregatedMap.set(pid, { productId: pid, quantity: reqQty });
        }
    }

    // 4. Sắp xếp đơn hàng tăng dần theo productId để bảo đảm Deterministic Lock Ordering (Chống Deadlock)
    const sortedItems = Array.from(aggregatedMap.values()).sort((a, b) => a.productId - b.productId);

    try {
        const { pool, sql } = await getDb();
        const transaction = new sql.Transaction(pool);
        let isTransactionActive = false;
        let isCommitted = false;
        let isRolledBack = false;

        // Cơ chế bọc Rollback an toàn chống Double-Rollback và lỗi driver _aborted
        const rollbackSafely = async () => {
            if (!isTransactionActive || isCommitted || isRolledBack) return;
            isRolledBack = true;
            try {
                if (!transaction._aborted) {
                    await transaction.rollback();
                }
            } catch (rbErr) {
                console.warn('⚠️ Safe rollback suppressed error:', rbErr.message);
            } finally {
                isTransactionActive = false;
            }
        };

        await transaction.begin();
        isTransactionActive = true;

        try {
            // Bước 1: Xác thực customer_id và snapshot thông tin khách hàng vào đơn
            let parsedCustomerId = parseInt(customerId, 10);
            if (isNaN(parsedCustomerId) || parsedCustomerId <= 0) {
                parsedCustomerId = 1;
            }
            let snapName = customerName ? String(customerName).trim() : null;
            let snapEmail = customerEmail ? String(customerEmail).trim() : null;
            let snapPhone = customerPhone ? String(customerPhone).trim() : null;

            const userReq = new sql.Request(transaction);
            const userRes = await userReq
                .input('userId', sql.Int, parsedCustomerId)
                .query(`SELECT id, full_name, email, phone FROM users WHERE id = @userId`);

            if (userRes.recordset.length > 0) {
                const u = userRes.recordset[0];
                if (!snapName) snapName = u.full_name;
                if (!snapEmail) snapEmail = u.email;
                if (!snapPhone) snapPhone = u.phone;
            } else {
                // Nếu customerId không tồn tại trong bảng users, fallback về user guest (id: 1)
                const fallbackReq = new sql.Request(transaction);
                const fallbackRes = await fallbackReq.query(`SELECT id, full_name, email, phone FROM users WHERE id = 1`);
                if (fallbackRes.recordset.length > 0) {
                    parsedCustomerId = 1;
                    const fb = fallbackRes.recordset[0];
                    if (!snapName) snapName = fb.full_name || String(recipientName).trim();
                    if (!snapEmail) snapEmail = fb.email;
                    if (!snapPhone) snapPhone = fb.phone || String(recipientPhone).trim();
                } else {
                    parsedCustomerId = 1;
                    if (!snapName) snapName = String(recipientName).trim();
                    if (!snapPhone) snapPhone = String(recipientPhone).trim();
                }
            }

            // Bước 2: Kiểm tra tồn kho & Đọc giá Database Authoritative Pricing theo thứ tự khóa
            const resolvedItems = [];
            let totalAmount = 0;

            for (const item of sortedItems) {
                const checkReq = new sql.Request(transaction);
                const checkRes = await checkReq
                    .input('pid', sql.Int, item.productId)
                    .query(`SELECT id, name, stock_quantity, price FROM products WITH (UPDLOCK, ROWLOCK) WHERE id = @pid`);

                if (checkRes.recordset.length === 0) {
                    await rollbackSafely();
                    return res.status(404).json({ 
                        success: false, 
                        error: `Sản phẩm ID #${item.productId} không tồn tại trong kho.`,
                        message: `Sản phẩm ID #${item.productId} không tồn tại trong kho.` 
                    });
                }

                const product = checkRes.recordset[0];
                const availableStock = Number(product.stock_quantity);

                if (availableStock < item.quantity) {
                    await rollbackSafely();
                    return res.status(400).json({ 
                        success: false, 
                        error: `Sản phẩm ${product.name} chỉ còn ${availableStock} chiếc trong kho (yêu cầu ${item.quantity}).`,
                        message: `Sản phẩm "${product.name}" chỉ còn ${availableStock} xe trong kho (bạn đặt ${item.quantity} xe). Vui lòng điều chỉnh lại giỏ hàng!` 
                    });
                }

                // Giá bán Authoritative từ Database (bỏ qua giá client gửi để chống gian lận)
                const authoritativePrice = Number(product.price);
                totalAmount += (authoritativePrice * item.quantity);

                resolvedItems.push({
                    productId: item.productId,
                    quantity: item.quantity,
                    unitPrice: authoritativePrice,
                    name: product.name
                });
            }

            // Bước 3: Sinh mã đơn và mã vận đơn chống va chạm (Collision-Resistant)
            const timestamp = Date.now();
            const orderRand = crypto.randomBytes(3).toString('hex').toUpperCase();
            const trackRand = crypto.randomBytes(3).toString('hex').toUpperCase();

            const orderCode = `ORD-${timestamp}-${orderRand}`;
            const trackingCode = `VNPOST-${timestamp}-${trackRand}`;

            // Bước 4: Thêm đơn hàng vào bảng orders (có Customer Snapshot)
            const orderRequest = new sql.Request(transaction);
            const orderResult = await orderRequest
                .input('orderCode', sql.VarChar(30), orderCode)
                .input('customerId', sql.Int, parsedCustomerId)
                .input('customerName', sql.NVarChar(100), snapName)
                .input('customerEmail', sql.VarChar(100), snapEmail)
                .input('customerPhone', sql.VarChar(15), snapPhone)
                .input('recipientName', sql.NVarChar(100), String(recipientName).trim())
                .input('recipientPhone', sql.VarChar(15), String(recipientPhone).trim())
                .input('shippingAddress', sql.NVarChar(sql.MAX), String(shippingAddress).trim())
                .input('totalAmount', sql.Decimal(14, 2), totalAmount)
                .input('trackingCode', sql.VarChar(50), trackingCode)
                .query(`
                    INSERT INTO orders (
                        order_code, customer_id, customer_name, customer_email, customer_phone,
                        recipient_name, recipient_phone, shipping_address, total_amount, order_status, tracking_code
                    )
                    OUTPUT INSERTED.id
                    VALUES (
                        @orderCode, @customerId, @customerName, @customerEmail, @customerPhone,
                        @recipientName, @recipientPhone, @shippingAddress, @totalAmount, 'pending', @trackingCode
                    );
                `);

            const newOrderId = orderResult.recordset[0].id;

            // Bước 5: Thêm order_items và trừ tồn kho sản phẩm nguyên tử
            for (const item of resolvedItems) {
                const itemRequest = new sql.Request(transaction);
                await itemRequest
                    .input('orderId', sql.Int, newOrderId)
                    .input('productId', sql.Int, item.productId)
                    .input('quantity', sql.Int, item.quantity)
                    .input('unitPrice', sql.Decimal(12, 2), item.unitPrice)
                    .query(`
                        INSERT INTO order_items (order_id, product_id, quantity, unit_price)
                        VALUES (@orderId, @productId, @quantity, @unitPrice);

                        UPDATE products 
                        SET stock_quantity = stock_quantity - @quantity
                        WHERE id = @productId;
                    `);
            }

            // Bước 6: Tạo bản ghi vận đơn trong bảng shipments
            const shipmentRequest = new sql.Request(transaction);
            await shipmentRequest
                .input('orderId', sql.Int, newOrderId)
                .input('trackingCode', sql.VarChar(50), trackingCode)
                .input('carrier', sql.NVarChar(100), 'VNPost Tiết Kiệm')
                .input('shippingStatus', sql.NVarChar(50), 'pending')
                .input('currentLocation', sql.NVarChar(255), 'Trung tâm tiếp nhận đơn hàng - CarModelStore')
                .input('notes', sql.NVarChar(sql.MAX), 'Đơn hàng mới tạo, đang chờ đóng gói xuất kho')
                .query(`
                    INSERT INTO shipments (order_id, tracking_code, carrier, shipping_status, current_location, estimated_delivery, notes)
                    VALUES (@orderId, @trackingCode, @carrier, @shippingStatus, @currentLocation, DATEADD(day, 3, GETDATE()), @notes);
                `);

            // Hoàn tất transaction
            await transaction.commit();
            isCommitted = true;
            isTransactionActive = false;

            console.log(`🎉 Tạo đơn hàng thành công: ${orderCode} | Mã vận đơn: ${trackingCode} | Tổng: ${totalAmount} VND`);
            
            return res.status(201).json({
                success: true,
                message: 'Tạo đơn hàng thành công!',
                orderId: newOrderId,
                orderCode: orderCode,
                trackingCode: trackingCode,
                totalAmount: totalAmount,
                order: {
                    id: newOrderId,
                    orderCode: orderCode,
                    trackingCode: trackingCode,
                    totalAmount: totalAmount,
                    status: 'pending'
                }
            });
        } catch (innerErr) {
            await rollbackSafely();
            throw innerErr;
        }
    } catch (error) {
        console.error('Lỗi khi lưu đơn hàng:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Lỗi máy chủ khi tạo đơn hàng.', 
            message: 'Lỗi máy chủ khi tạo đơn hàng.', 
            details: error.message 
        });
    }
});

// PII Masking Helper Functions (Feature F5 / AC6)
function maskRecipientName(name) {
    if (!name) return '';
    const trimmed = String(name).trim();
    if (!trimmed) return '';
    const words = trimmed.split(/\s+/);
    return words.map(w => {
        if (w.length <= 1) return '*';
        if (w.length === 2) return w[0] + '*';
        return w[0] + '*'.repeat(w.length - 2) + w[w.length - 1];
    }).join(' ');
}

function maskRecipientPhone(phone) {
    if (!phone) return '';
    const str = String(phone).trim();
    if (str.length <= 4) return '*'.repeat(str.length);
    const keepStart = Math.min(3, Math.floor(str.length / 3));
    const keepEnd = Math.min(3, Math.floor(str.length / 3));
    const middleLen = str.length - keepStart - keepEnd;
    return str.slice(0, keepStart) + '*'.repeat(middleLen > 0 ? middleLen : 3) + str.slice(str.length - keepEnd);
}

function maskShippingAddress(address) {
    if (!address) return '';
    const str = String(address).trim();
    const parts = str.split(',');
    if (parts.length > 1) {
        const streetPart = parts[0].trim();
        const maskedStreet = streetPart.replace(/[a-zA-Z0-9\u00C0-\u024F\u1EA0-\u1EF9]/g, '*');
        parts[0] = maskedStreet;
        return parts.join(', ');
    }
    const len = str.length;
    const q1 = Math.floor(len / 4);
    const q3 = Math.floor(len * 3 / 4);
    return str.slice(0, q1) + '*'.repeat(Math.max(3, q3 - q1)) + str.slice(q3);
}

// Route without code returns 400
app.get('/api/tracking', (req, res) => {
    return res.status(400).json({ success: false, message: 'Vui lòng cung cấp mã vận đơn hoặc mã đơn hàng.' });
});

// 4. API Tra cứu Hành trình Vận đơn (Tracking API)
app.get('/api/tracking/:code', async (req, res) => {
    const { code } = req.params;
    if (!code || !code.trim()) {
        return res.status(400).json({ success: false, message: 'Vui lòng cung cấp mã vận đơn hoặc mã đơn hàng.' });
    }

    try {
        const { pool, sql } = await getDb();
        const cleanCode = code.trim();

        // Parameterized Query chống SQL Injection
        const queryResult = await pool.request()
            .input('code', sql.VarChar(50), cleanCode)
            .query(`
                SELECT 
                    o.id as order_id,
                    o.order_code,
                    o.tracking_code,
                    o.recipient_name,
                    o.recipient_phone,
                    o.shipping_address,
                    o.total_amount,
                    o.order_status,
                    o.created_at as order_created_at,
                    s.carrier,
                    s.shipping_status,
                    s.current_location,
                    s.estimated_delivery,
                    s.notes as shipment_notes,
                    s.updated_at as shipment_updated_at
                FROM orders o
                LEFT JOIN shipments s ON o.id = s.order_id
                WHERE o.tracking_code = @code OR o.order_code = @code;
            `);

        if (queryResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: `Không tìm thấy thông tin vận đơn hoặc đơn hàng cho mã: "${cleanCode}". Vui lòng kiểm tra lại!`
            });
        }

        const data = queryResult.recordset[0];

        // Lấy danh sách sản phẩm trong đơn hàng
        const itemsResult = await pool.request()
            .input('orderId', sql.Int, data.order_id)
            .query(`
                SELECT oi.product_id, oi.quantity, oi.unit_price, p.name as product_name, p.scale, p.image_url
                FROM order_items oi
                LEFT JOIN products p ON oi.product_id = p.id
                WHERE oi.order_id = @orderId;
            `);

        const maskedData = {
            ...data,
            recipient_name: maskRecipientName(data.recipient_name),
            recipient_phone: maskRecipientPhone(data.recipient_phone),
            shipping_address: maskShippingAddress(data.shipping_address)
        };

        res.json({
            success: true,
            data: {
                ...maskedData,
                items: itemsResult.recordset
            }
        });
    } catch (error) {
        console.error('Lỗi khi tra cứu mã vận đơn:', error);
        res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tra cứu vận đơn.', error: error.message });
    }
});

// 5. API Lấy danh sách Sản phẩm (Hỗ trợ lọc an toàn: status, brand, scale, price, q)
app.get('/api/products', async (req, res) => {
    try {
        const { pool, sql } = await getDb();
        const { status, brand, scale, price, q } = req.query;

        const request = pool.request();
        let conditions = [];

        if (status && status.trim()) {
            conditions.push("p.status = @status");
            request.input('status', sql.NVarChar(50), status.trim());
        }

        if (brand && brand.trim()) {
            conditions.push("(LOWER(p.car_brand) = LOWER(@brand) OR LOWER(b.name) = LOWER(@brand) OR LOWER(b.brand_code) = LOWER(@brand))");
            request.input('brand', sql.NVarChar(100), brand.trim());
        }

        if (scale && scale.trim()) {
            const normalizedScale = scale.trim().replace('-', ':');
            conditions.push("(p.scale = @scale OR p.scale = @scaleDash)");
            request.input('scale', sql.VarChar(20), normalizedScale);
            request.input('scaleDash', sql.VarChar(20), scale.trim());
        }

        if (price) {
            if (price === 'under1') {
                conditions.push("p.price < 1000000");
            } else if (price === '1-2') {
                conditions.push("p.price >= 1000000 AND p.price <= 2000000");
            } else if (price === 'over2') {
                conditions.push("p.price > 2000000");
            }
        }

        if (q && q.trim()) {
            conditions.push("(LOWER(p.name) LIKE @searchQuery OR LOWER(p.product_code) LIKE @searchQuery OR LOWER(p.car_brand) LIKE @searchQuery)");
            request.input('searchQuery', sql.NVarChar(200), `%${q.trim().toLowerCase()}%`);
        }

        let query = `
            SELECT p.id, p.product_code, p.name, p.scale, p.manufacturer, p.car_brand as brand, 
                   p.price, p.stock_quantity, p.status, p.image_url as image, 
                   p.description, p.rating, p.reviews
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
        `;

        if (conditions.length > 0) {
            query += " WHERE " + conditions.join(" AND ");
        }

        query += " ORDER BY p.id ASC";

        const result = await request.query(query);
        res.json(result.recordset);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách sản phẩm:', error);
        res.status(500).json({ error: error.message });
    }
});

// 6. API Lấy chi tiết 1 Sản phẩm
app.get('/api/products/:id', async (req, res) => {
    try {
        const { pool, sql } = await getDb();
        const pid = parseInt(req.params.id, 10);

        if (isNaN(pid)) {
            return res.status(400).json({ error: 'ID sản phẩm không hợp lệ' });
        }

        const result = await pool.request()
            .input('id', sql.Int, pid)
            .query(`
                SELECT p.id, p.product_code, p.name, p.scale, p.manufacturer, p.car_brand as brand, 
                       p.price, p.stock_quantity, p.status, p.image_url as image, 
                       p.description, p.rating, p.reviews
                FROM products p
                WHERE p.id = @id;
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
        }

        res.json(result.recordset[0]);
    } catch (error) {
        console.error('Lỗi khi lấy thông tin sản phẩm:', error);
        res.status(500).json({ error: error.message });
    }
});

// 7. API Lấy danh sách Thương hiệu
app.get('/api/brands', async (req, res) => {
    try {
        const { pool } = await getDb();
        const result = await pool.request().query('SELECT * FROM brands ORDER BY id ASC');
        res.json(result.recordset);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách thương hiệu:', error);
        res.status(500).json({ error: error.message });
    }
});

// 8. API Lấy danh sách Phụ kiện
app.get('/api/accessories', async (req, res) => {
    try {
        const { pool } = await getDb();
        const result = await pool.request().query('SELECT * FROM accessories ORDER BY id ASC');
        res.json(result.recordset);
    } catch (error) {
        console.error('Lỗi khi lấy danh sách phụ kiện:', error);
        res.status(500).json({ error: error.message });
    }
});

// 9. API Tiếp nhận Liên hệ (phục vụ form contact.html)
app.post('/api/contact', async (req, res) => {
    const { name, email, message } = req.body;
    if (!name || !email || !message) {
        return res.status(400).json({ success: false, message: 'Vui lòng điền đủ thông tin liên hệ.' });
    }
    console.log(`📩 Nhận liên hệ từ: ${name} (${email}): ${message}`);
    res.json({ success: true, message: 'Đã nhận liên hệ thành công!' });
});

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