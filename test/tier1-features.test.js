const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const api = require('./helpers/api');
const db = require('./helpers/db');
const { ensureServer, stopServer } = require('./helpers/server');

describe('Tier 1: Feature Coverage (AC1 - AC7)', () => {
    let serverInfo;
    const createdOrderCodes = [];

    before(async () => {
        serverInfo = await ensureServer();
    });

    after(async () => {
        if (createdOrderCodes.length > 0) {
            await db.cleanupOrders(createdOrderCodes);
        }
        await db.close();
        if (serverInfo && serverInfo.spawned) {
            stopServer();
        }
    });

    // =========================================================================
    // AC1: Order Creation in a Single Transaction
    // =========================================================================
    describe('AC1: Order Creation in a Single Transaction', () => {
        test('AC1.1: Single-item order creation atomically creates order, items, and shipment with VNPOST tracking code', async () => {
            const product = await db.getProduct(1);
            assert.ok(product, 'Test product 1 must exist');
            const initialStock = Number(product.stock_quantity);
            assert.ok(initialStock >= 2, 'Initial stock must be >= 2 for test');

            const orderPayload = {
                customerId: 1,
                recipientName: 'Test Buyer Alpha',
                recipientPhone: '0901234567',
                shippingAddress: '123 Nguyen Trai, Q1, HCMC',
                items: [
                    { productId: 1, quantity: 2, unitPrice: Number(product.price) }
                ]
            };

            const res = await api.createOrder(orderPayload);
            assert.equal(res.status, 201, 'Order creation must return HTTP 201');
            assert.equal(res.data.success, true, 'Order response must be successful');

            const orderCode = res.data.orderCode || (res.data.order && res.data.order.orderCode);
            const trackingCode = res.data.trackingCode || (res.data.order && res.data.order.trackingCode);
            assert.ok(orderCode, 'Response must include orderCode');
            assert.ok(trackingCode, 'Response must include trackingCode');
            assert.match(trackingCode, /^VNPOST-/, 'Tracking code must begin with VNPOST-');

            createdOrderCodes.push(orderCode);

            // Verify Database State Atomicity
            const dbOrder = await db.getOrder(orderCode);
            assert.ok(dbOrder, 'Order must be persisted in orders table');
            assert.equal(dbOrder.order_status, 'pending', 'Order status must be pending');
            assert.equal(dbOrder.recipient_name, orderPayload.recipientName);
            assert.equal(dbOrder.recipient_phone, orderPayload.recipientPhone);
            assert.equal(dbOrder.shipping_address, orderPayload.shippingAddress);

            // Verify Order Items
            const items = await db.getOrderItems(dbOrder.id);
            assert.equal(items.length, 1, 'Exactly 1 order item row must be created');
            assert.equal(Number(items[0].product_id), 1);
            assert.equal(Number(items[0].quantity), 2);

            // Verify Shipment
            const dbShipment = await db.getShipment(trackingCode);
            assert.ok(dbShipment, 'Shipment record must be created');
            assert.equal(Number(dbShipment.order_id), Number(dbOrder.id), 'Shipment must link to order_id');
            assert.equal(dbShipment.shipping_status, 'pending');

            // Verify Stock Decrement
            const updatedProduct = await db.getProduct(1);
            assert.equal(Number(updatedProduct.stock_quantity), initialStock - 2, 'Product stock must decrement by 2');

            // Revert stock for test isolation
            await db.setProductStock(1, initialStock);
        });

        test('AC1.2: Multi-item order creation decrements all item stocks and creates multiple order_items', async () => {
            const p1 = await db.getProduct(1);
            const p2 = await db.getProduct(2);
            assert.ok(p1 && p2, 'Products 1 and 2 must exist');
            const stock1 = Number(p1.stock_quantity);
            const stock2 = Number(p2.stock_quantity);

            const payload = {
                customerId: 1,
                recipientName: 'Multi Item Buyer',
                recipientPhone: '0912345678',
                shippingAddress: '456 Le Loi, Q1, HCMC',
                items: [
                    { productId: 1, quantity: 1, unitPrice: Number(p1.price) },
                    { productId: 2, quantity: 2, unitPrice: Number(p2.price) }
                ]
            };

            const res = await api.createOrder(payload);
            assert.equal(res.status, 201);
            const orderCode = res.data.orderCode || (res.data.order && res.data.order.orderCode);
            createdOrderCodes.push(orderCode);

            const dbOrder = await db.getOrder(orderCode);
            const items = await db.getOrderItems(dbOrder.id);
            assert.equal(items.length, 2, 'Must create 2 order_items rows');

            const afterP1 = await db.getProduct(1);
            const afterP2 = await db.getProduct(2);
            assert.equal(Number(afterP1.stock_quantity), stock1 - 1);
            assert.equal(Number(afterP2.stock_quantity), stock2 - 2);

            // Restore stocks
            await db.setProductStock(1, stock1);
            await db.setProductStock(2, stock2);
        });

        test('AC1.3: Foreign key integrity between orders, order_items, and shipments', async () => {
            const p = await db.getProduct(1);
            const res = await api.createOrder({
                customerId: 1,
                recipientName: 'FK Integrity Test',
                recipientPhone: '0987654321',
                shippingAddress: '789 Tran Hung Dao, HCMC',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });
            assert.equal(res.status, 201);
            const orderCode = res.data.orderCode || (res.data.order && res.data.order.orderCode);
            createdOrderCodes.push(orderCode);

            const dbOrder = await db.getOrder(orderCode);
            const items = await db.getOrderItems(dbOrder.id);
            const shipment = await db.getShipment(dbOrder.tracking_code);

            assert.equal(Number(items[0].order_id), Number(dbOrder.id), 'order_items.order_id must match orders.id');
            assert.equal(Number(shipment.order_id), Number(dbOrder.id), 'shipments.order_id must match orders.id');

            // Restore stock
            await db.setProductStock(1, Number(p.stock_quantity));
        });

        test('AC1.4: Order tracking code uniqueness and VNPOST prefix format', async () => {
            const p = await db.getProduct(1);
            const res1 = await api.createOrder({
                customerId: 1,
                recipientName: 'Unique Track 1',
                recipientPhone: '0901111111',
                shippingAddress: '101 Hai Ba Trung, HCMC',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });
            await new Promise(r => setTimeout(r, 20));
            const res2 = await api.createOrder({
                customerId: 1,
                recipientName: 'Unique Track 2',
                recipientPhone: '0902222222',
                shippingAddress: '102 Hai Ba Trung, HCMC',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });

            const code1 = res1.data.trackingCode || (res1.data.order && res1.data.order.trackingCode);
            const code2 = res2.data.trackingCode || (res2.data.order && res2.data.order.trackingCode);
            createdOrderCodes.push(res1.data.orderCode || (res1.data.order && res1.data.order.orderCode));
            createdOrderCodes.push(res2.data.orderCode || (res2.data.order && res2.data.order.orderCode));

            assert.match(code1, /^VNPOST-/, 'Tracking code 1 must start with VNPOST-');
            assert.match(code2, /^VNPOST-/, 'Tracking code 2 must start with VNPOST-');
            assert.notEqual(code1, code2, 'Tracking codes must be unique');

            // Restore stock
            await db.setProductStock(1, Number(p.stock_quantity));
        });

        test('AC1.5: Total amount calculation and persistence matches item quantities and prices', async () => {
            const p = await db.getProduct(1);
            const unitPrice = Number(p.price);
            const qty = 3;
            const expectedTotal = qty * unitPrice;

            const res = await api.createOrder({
                customerId: 1,
                recipientName: 'Total Check',
                recipientPhone: '0903333333',
                shippingAddress: '103 Hai Ba Trung, HCMC',
                items: [{ productId: 1, quantity: qty, unitPrice }]
            });
            assert.equal(res.status, 201);
            const orderCode = res.data.orderCode || (res.data.order && res.data.order.orderCode);
            createdOrderCodes.push(orderCode);

            const dbOrder = await db.getOrder(orderCode);
            assert.equal(Number(dbOrder.total_amount), expectedTotal, 'total_amount must equal qty * unitPrice');

            // Restore stock
            await db.setProductStock(1, Number(p.stock_quantity));
        });
    });

    // =========================================================================
    // AC2: Out-of-Stock Rejection
    // =========================================================================
    describe('AC2: Out-of-Stock Rejection (100% Blocked, Zero Orphaned Rows)', () => {
        test('AC2.1: Order requesting more quantity than available stock is rejected with HTTP 400', async () => {
            const p = await db.getProduct(1);
            const stock = Number(p.stock_quantity);
            const excessiveQty = stock + 10;

            const res = await api.createOrder({
                customerId: 1,
                recipientName: 'Over Demand Buyer',
                recipientPhone: '0904444444',
                shippingAddress: '104 Dien Bien Phu, HCMC',
                items: [{ productId: 1, quantity: excessiveQty, unitPrice: Number(p.price) }]
            });

            assert.equal(res.status, 400, 'Must return HTTP 400 Bad Request');
            assert.equal(res.data.success, false, 'Must indicate failure');
        });

        test('AC2.2: Out-of-stock error response contains clear error message explaining stock deficit', async () => {
            const p = await db.getProduct(1);
            const stock = Number(p.stock_quantity);

            const res = await api.createOrder({
                customerId: 1,
                recipientName: 'Over Demand Buyer 2',
                recipientPhone: '0905555555',
                shippingAddress: '105 Dien Bien Phu, HCMC',
                items: [{ productId: 1, quantity: stock + 999, unitPrice: Number(p.price) }]
            });

            assert.equal(res.status, 400);
            const message = res.data.message || res.data.error || '';
            assert.ok(message.length > 0, 'Error message must not be empty');
            assert.match(message, /kho|tồn|số lượng|chỉ còn/i, 'Error message should explain stock deficiency');
        });

        test('AC2.3: Zero orphaned rows in orders table upon stock deficit rejection', async () => {
            const countBeforeRes = await db.query('SELECT COUNT(*) as cnt FROM orders');
            const countBefore = countBeforeRes.recordset[0].cnt;

            const p = await db.getProduct(1);
            const res = await api.createOrder({
                customerId: 1,
                recipientName: 'Rollback Order Test',
                recipientPhone: '0906666666',
                shippingAddress: '106 Dien Bien Phu, HCMC',
                items: [{ productId: 1, quantity: Number(p.stock_quantity) + 100, unitPrice: Number(p.price) }]
            });

            assert.equal(res.status, 400);

            const countAfterRes = await db.query('SELECT COUNT(*) as cnt FROM orders');
            const countAfter = countAfterRes.recordset[0].cnt;
            assert.equal(countAfter, countBefore, 'orders table count must not change on failure (no orphaned orders)');
        });

        test('AC2.4: Zero orphaned rows in order_items and shipments tables upon rejection', async () => {
            const itemsBeforeRes = await db.query('SELECT COUNT(*) as cnt FROM order_items');
            const shipsBeforeRes = await db.query('SELECT COUNT(*) as cnt FROM shipments');
            const itemsBefore = itemsBeforeRes.recordset[0].cnt;
            const shipsBefore = shipsBeforeRes.recordset[0].cnt;

            const p = await db.getProduct(1);
            await api.createOrder({
                customerId: 1,
                recipientName: 'Rollback Children Test',
                recipientPhone: '0907777777',
                shippingAddress: '107 Dien Bien Phu, HCMC',
                items: [{ productId: 1, quantity: Number(p.stock_quantity) + 50, unitPrice: Number(p.price) }]
            });

            const itemsAfterRes = await db.query('SELECT COUNT(*) as cnt FROM order_items');
            const shipsAfterRes = await db.query('SELECT COUNT(*) as cnt FROM shipments');
            assert.equal(itemsAfterRes.recordset[0].cnt, itemsBefore, 'order_items count must not increase');
            assert.equal(shipsAfterRes.recordset[0].cnt, shipsBefore, 'shipments count must not increase');
        });

        test('AC2.5: Product stock quantity remains 100% unchanged after rejected order', async () => {
            const p = await db.getProduct(1);
            const originalStock = Number(p.stock_quantity);

            await api.createOrder({
                customerId: 1,
                recipientName: 'Stock Invariant Test',
                recipientPhone: '0908888888',
                shippingAddress: '108 Dien Bien Phu, HCMC',
                items: [{ productId: 1, quantity: originalStock + 20, unitPrice: Number(p.price) }]
            });

            const afterProduct = await db.getProduct(1);
            assert.equal(Number(afterProduct.stock_quantity), originalStock, 'Stock quantity must remain strictly unchanged');
        });
    });

    // =========================================================================
    // AC3: Order Cancellation Restores Stock and Sets Shipment Status
    // =========================================================================
    describe('AC3: Order Cancellation Restores Stock and Sets Shipment Status', () => {
        test('AC3.1: Cancelling an order via PUT /api/orders/:code/status returns HTTP 200', async () => {
            const p = await db.getProduct(1);
            const initialStock = Number(p.stock_quantity);

            const orderRes = await api.createOrder({
                customerId: 1,
                recipientName: 'Cancel Test 1',
                recipientPhone: '0909999999',
                shippingAddress: '201 Cach Mang Thang 8, HCMC',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });
            const orderCode = orderRes.data.orderCode || (orderRes.data.order && orderRes.data.order.orderCode);
            createdOrderCodes.push(orderCode);

            const cancelRes = await api.cancelOrder(orderCode);
            assert.equal(cancelRes.status, 200, 'Order cancellation must return HTTP 200');
            assert.equal(cancelRes.data.success, true);

            // Revert stock
            await db.setProductStock(1, initialStock);
        });

        test('AC3.2: Cancelling an order restores product stock by exact ordered quantity', async () => {
            const p = await db.getProduct(1);
            const initialStock = Number(p.stock_quantity);

            const orderRes = await api.createOrder({
                customerId: 1,
                recipientName: 'Cancel Stock Test',
                recipientPhone: '0910000001',
                shippingAddress: '202 Cach Mang Thang 8, HCMC',
                items: [{ productId: 1, quantity: 3, unitPrice: Number(p.price) }]
            });
            const orderCode = orderRes.data.orderCode || (orderRes.data.order && orderRes.data.order.orderCode);
            createdOrderCodes.push(orderCode);

            const stockAfterOrder = await db.getProduct(1);
            assert.equal(Number(stockAfterOrder.stock_quantity), initialStock - 3);

            await api.cancelOrder(orderCode);

            const stockAfterCancel = await db.getProduct(1);
            assert.equal(Number(stockAfterCancel.stock_quantity), initialStock, 'Stock must be restored to initial value');
        });

        test('AC3.3: Cancelling an order updates orders.order_status to cancelled', async () => {
            const p = await db.getProduct(1);
            const initialStock = Number(p.stock_quantity);

            const orderRes = await api.createOrder({
                customerId: 1,
                recipientName: 'Cancel Status Test',
                recipientPhone: '0910000002',
                shippingAddress: '203 Cach Mang Thang 8, HCMC',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });
            const orderCode = orderRes.data.orderCode || (orderRes.data.order && orderRes.data.order.orderCode);
            createdOrderCodes.push(orderCode);

            await api.cancelOrder(orderCode);

            const dbOrder = await db.getOrder(orderCode);
            assert.equal(dbOrder.order_status, 'cancelled', 'order_status must be updated to cancelled in DB');

            await db.setProductStock(1, initialStock);
        });

        test('AC3.4: Cancelling an order updates shipments.shipping_status to cancelled', async () => {
            const p = await db.getProduct(1);
            const initialStock = Number(p.stock_quantity);

            const orderRes = await api.createOrder({
                customerId: 1,
                recipientName: 'Cancel Shipment Test',
                recipientPhone: '0910000003',
                shippingAddress: '204 Cach Mang Thang 8, HCMC',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });
            const orderCode = orderRes.data.orderCode || (orderRes.data.order && orderRes.data.order.orderCode);
            const trackingCode = orderRes.data.trackingCode || (orderRes.data.order && orderRes.data.order.trackingCode);
            createdOrderCodes.push(orderCode);

            await api.cancelOrder(orderCode);

            const dbShipment = await db.getShipment(trackingCode);
            assert.equal(dbShipment.shipping_status, 'cancelled', 'shipping_status must be updated to cancelled in DB');

            await db.setProductStock(1, initialStock);
        });

        test('AC3.5: Order cancellation works when passed tracking_code instead of order_code', async () => {
            const p = await db.getProduct(1);
            const initialStock = Number(p.stock_quantity);

            const orderRes = await api.createOrder({
                customerId: 1,
                recipientName: 'Cancel Via Tracking',
                recipientPhone: '0910000004',
                shippingAddress: '205 Cach Mang Thang 8, HCMC',
                items: [{ productId: 1, quantity: 2, unitPrice: Number(p.price) }]
            });
            const orderCode = orderRes.data.orderCode || (orderRes.data.order && orderRes.data.order.orderCode);
            const trackingCode = orderRes.data.trackingCode || (orderRes.data.order && orderRes.data.order.trackingCode);
            createdOrderCodes.push(orderCode);

            const cancelRes = await api.cancelOrder(trackingCode);
            assert.equal(cancelRes.status, 200, 'Cancellation via tracking_code must return 200');

            const dbOrder = await db.getOrder(orderCode);
            assert.equal(dbOrder.order_status, 'cancelled');

            const afterProduct = await db.getProduct(1);
            assert.equal(Number(afterProduct.stock_quantity), initialStock);
        });
    });

    // =========================================================================
    // AC4: Customer Account Sync
    // =========================================================================
    describe('AC4: Customer Account Sync (/api/orders?customer_id=...)', () => {
        test('AC4.1: GET /api/orders?customer_id=X returns orders scoped to that customer', async () => {
            const p = await db.getProduct(1);
            const initialStock = Number(p.stock_quantity);

            const o1 = await api.createOrder({
                customerId: 2,
                recipientName: 'Customer 2',
                recipientPhone: '0911000001',
                shippingAddress: '301 Nguyen Oanh, Go Vap',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });
            const o2 = await api.createOrder({
                customerId: 3,
                recipientName: 'Customer 3',
                recipientPhone: '0911000002',
                shippingAddress: '302 Nguyen Oanh, Go Vap',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });

            const code1 = o1.data.orderCode || (o1.data.order && o1.data.order.orderCode);
            const code2 = o2.data.orderCode || (o2.data.order && o2.data.order.orderCode);
            createdOrderCodes.push(code1, code2);

            const res2 = await api.getOrders(2);
            assert.equal(res2.status, 200);
            const orders2 = res2.data.orders || res2.data || [];
            assert.ok(Array.isArray(orders2), 'Result must contain orders array');

            const hasCode1 = orders2.some(o => o.order_code === code1);
            const hasCode2 = orders2.some(o => o.order_code === code2);
            assert.ok(hasCode1, 'Orders of customer 2 must contain code1');
            assert.equal(hasCode2, false, 'Orders of customer 2 must NOT contain code2');

            await db.setProductStock(1, initialStock);
        });

        test('AC4.2: Customer cannot see orders of other customers in customer-scoped query', async () => {
            const res = await api.getOrders(2);
            const orders = res.data.orders || res.data || [];
            for (const ord of orders) {
                assert.equal(Number(ord.customer_id), 2, 'Every order must belong to customer 2');
            }
        });

        test('AC4.3: Order payload structure contains all fields required by account.html', async () => {
            const res = await api.getOrders();
            assert.equal(res.status, 200);
            const orders = res.data.orders || res.data || [];
            assert.ok(orders.length > 0, 'Orders list must not be empty');

            const order = orders[0];
            const requiredFields = ['order_code', 'tracking_code', 'recipient_name', 'total_amount', 'order_status', 'created_at'];
            for (const field of requiredFields) {
                assert.ok(field in order, `Order must contain field: ${field}`);
            }
        });

        test('AC4.4: Newly created order appears immediately in customer order history', async () => {
            const p = await db.getProduct(1);
            const initialStock = Number(p.stock_quantity);

            const o = await api.createOrder({
                customerId: 2,
                recipientName: 'Realtime Account Buyer',
                recipientPhone: '0911888888',
                shippingAddress: '555 Le Van Sy, Q3',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });
            const code = o.data.orderCode || (o.data.order && o.data.order.orderCode);
            createdOrderCodes.push(code);

            const historyRes = await api.getOrders(2);
            const list = historyRes.data.orders || historyRes.data || [];
            const found = list.find(item => item.order_code === code);
            assert.ok(found, 'Newly created order must appear immediately in customer orders list');

            await db.setProductStock(1, initialStock);
        });

        test('AC4.5: Cancelled order reflects with cancelled status in account order history', async () => {
            const p = await db.getProduct(1);
            const initialStock = Number(p.stock_quantity);

            const o = await api.createOrder({
                customerId: 2,
                recipientName: 'Cancel Reflection Buyer',
                recipientPhone: '0911888889',
                shippingAddress: '556 Le Van Sy, Q3',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });
            const code = o.data.orderCode || (o.data.order && o.data.order.orderCode);
            createdOrderCodes.push(code);

            await api.cancelOrder(code);

            const historyRes = await api.getOrders(2);
            const list = historyRes.data.orders || historyRes.data || [];
            const found = list.find(item => item.order_code === code);
            assert.ok(found);
            assert.equal(found.order_status, 'cancelled', 'Order status in account list must reflect cancelled');

            await db.setProductStock(1, initialStock);
        });
    });

    // =========================================================================
    // AC5: Admin Dashboard Sync
    // =========================================================================
    describe('AC5: Admin Dashboard Sync (/api/dashboard/stats)', () => {
        test('AC5.1: GET /api/dashboard/stats returns HTTP 200 with stats and recentOrders', async () => {
            const res = await api.getDashboardStats();
            assert.equal(res.status, 200);
            assert.equal(res.data.success, true);
            assert.ok(res.data.stats, 'Response must include stats object');
            assert.ok(Array.isArray(res.data.recentOrders), 'Response must include recentOrders array');
        });

        test('AC5.2: stats.total_orders accurately equals count of orders in database', async () => {
            const countDbRes = await db.query('SELECT COUNT(*) as cnt FROM orders');
            const expectedCount = countDbRes.recordset[0].cnt;

            const res = await api.getDashboardStats();
            assert.equal(Number(res.data.stats.total_orders), Number(expectedCount));
        });

        test('AC5.3: stats.total_revenue correctly sums non-cancelled orders', async () => {
            const revDbRes = await db.query(`
                SELECT ISNULL(SUM(total_amount), 0) as rev 
                FROM orders 
                WHERE order_status NOT IN ('cancelled', N'Đã hủy')
            `);
            const expectedRev = Number(revDbRes.recordset[0].rev);

            const res = await api.getDashboardStats();
            assert.equal(Number(res.data.stats.total_revenue), expectedRev);
        });

        test('AC5.4: recentOrders contains at most 5 orders sorted by created_at DESC', async () => {
            const res = await api.getDashboardStats();
            const recent = res.data.recentOrders || [];
            assert.ok(recent.length <= 5, 'recentOrders must contain at most 5 orders');

            if (recent.length >= 2) {
                for (let i = 0; i < recent.length - 1; i++) {
                    const t1 = new Date(recent[i].created_at).getTime();
                    const t2 = new Date(recent[i + 1].created_at).getTime();
                    assert.ok(t1 >= t2, 'recentOrders must be sorted in descending order of created_at');
                }
            }
        });

        test('AC5.5: New order placement increments total_orders and prepends order to recentOrders', async () => {
            const p = await db.getProduct(1);
            const initialStock = Number(p.stock_quantity);

            const beforeRes = await api.getDashboardStats();
            const initialTotalOrders = Number(beforeRes.data.stats.total_orders);

            const o = await api.createOrder({
                customerId: 1,
                recipientName: 'Dashboard Sync Test',
                recipientPhone: '0912121212',
                shippingAddress: '777 Cong Hoa, Tan Binh',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });
            const code = o.data.orderCode || (o.data.order && o.data.order.orderCode);
            createdOrderCodes.push(code);

            const afterRes = await api.getDashboardStats();
            assert.equal(Number(afterRes.data.stats.total_orders), initialTotalOrders + 1);

            const topOrder = afterRes.data.recentOrders[0];
            assert.equal(topOrder.order_code, code, 'Newest order must be at top of recentOrders');

            await db.setProductStock(1, initialStock);
        });
    });

    // =========================================================================
    // AC6: Public Tracking Lookup & PII Masking
    // =========================================================================
    describe('AC6: Public Tracking Lookup & PII Masking (/api/tracking/:code)', () => {
        test('AC6.1: Tracking lookup resolves shipment, order, and items by trackingCode', async () => {
            const p = await db.getProduct(1);
            const initialStock = Number(p.stock_quantity);

            const o = await api.createOrder({
                customerId: 1,
                recipientName: 'Nguyen Van An',
                recipientPhone: '0912345678',
                shippingAddress: '123 Le Loi, Q1, HCMC',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });
            const code = o.data.orderCode || (o.data.order && o.data.order.orderCode);
            const tracking = o.data.trackingCode || (o.data.order && o.data.order.trackingCode);
            createdOrderCodes.push(code);

            const trackRes = await api.getTracking(tracking);
            assert.equal(trackRes.status, 200);
            assert.equal(trackRes.data.success, true);

            const data = trackRes.data.data || trackRes.data;
            assert.ok(data.tracking_code || (data.shipment && data.shipment.tracking_code));

            await db.setProductStock(1, initialStock);
        });

        test('AC6.2: Tracking lookup also resolves by orderCode', async () => {
            const p = await db.getProduct(1);
            const initialStock = Number(p.stock_quantity);

            const o = await api.createOrder({
                customerId: 1,
                recipientName: 'Track By Order Code',
                recipientPhone: '0912345679',
                shippingAddress: '124 Le Loi, Q1, HCMC',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });
            const code = o.data.orderCode || (o.data.order && o.data.order.orderCode);
            createdOrderCodes.push(code);

            const trackRes = await api.getTracking(code);
            assert.equal(trackRes.status, 200);

            await db.setProductStock(1, initialStock);
        });

        test('AC6.3: Recipient name is masked in public tracking API (PII Protection)', async () => {
            const p = await db.getProduct(1);
            const initialStock = Number(p.stock_quantity);

            const o = await api.createOrder({
                customerId: 1,
                recipientName: 'Nguyen Van An',
                recipientPhone: '0912345678',
                shippingAddress: '123 Le Loi, Q1, HCMC',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });
            const tracking = o.data.trackingCode || (o.data.order && o.data.order.trackingCode);
            createdOrderCodes.push(o.data.orderCode || (o.data.order && o.data.order.orderCode));

            const trackRes = await api.getTracking(tracking);
            const data = trackRes.data.data || (trackRes.data.order ? trackRes.data.order : trackRes.data);
            const recipientName = data.recipient_name || '';

            // Specification F5 / AC6 requires PII masking (e.g. contains '*')
            assert.match(recipientName, /\*/, 'Recipient name must be masked with * to protect PII');

            await db.setProductStock(1, initialStock);
        });

        test('AC6.4: Recipient phone number is masked in public tracking API (PII Protection)', async () => {
            const p = await db.getProduct(1);
            const initialStock = Number(p.stock_quantity);

            const o = await api.createOrder({
                customerId: 1,
                recipientName: 'Nguyen Van An',
                recipientPhone: '0912345678',
                shippingAddress: '123 Le Loi, Q1, HCMC',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });
            const tracking = o.data.trackingCode || (o.data.order && o.data.order.trackingCode);
            createdOrderCodes.push(o.data.orderCode || (o.data.order && o.data.order.orderCode));

            const trackRes = await api.getTracking(tracking);
            const data = trackRes.data.data || (trackRes.data.order ? trackRes.data.order : trackRes.data);
            const phone = data.recipient_phone || '';

            // Specification F5 / AC6 requires phone masking (e.g. '0912***678')
            assert.match(phone, /\*/, 'Phone number must be masked with * to protect PII');

            await db.setProductStock(1, initialStock);
        });

        test('AC6.5: Returns 404 for non-existent tracking code and 400 for empty code', async () => {
            const nonExistent = await api.getTracking('VNPOST-NON-EXISTENT-999999');
            assert.equal(nonExistent.status, 404, 'Non-existent code must return 404');

            const emptyRes = await api.getTracking('   ');
            assert.ok([400, 404].includes(emptyRes.status), 'Blank code must return 400 or 404');
        });
    });

    // =========================================================================
    // AC7: Server Startup Health and Connection Pool Stability
    // =========================================================================
    describe('AC7: Server Startup Health and Connection Pool Stability', () => {
        test('AC7.1: GET /api/health returns HTTP 200 with online status and connected database', async () => {
            const res = await api.health();
            assert.equal(res.status, 200);
            assert.equal(res.data.status, 'online');
            assert.equal(res.data.database, 'connected');
        });

        test('AC7.2: Health endpoint returns system counts (total_products, total_orders)', async () => {
            const res = await api.health();
            assert.ok(res.data.stats, 'Health check should contain stats');
            assert.ok(Number(res.data.stats.total_products) > 0, 'total_products must be > 0');
            assert.ok(Number(res.data.stats.total_orders) >= 0, 'total_orders must be >= 0');
        });

        test('AC7.3: Multiple consecutive concurrent health requests execute without connection leak', async () => {
            const promises = Array.from({ length: 15 }, () => api.health());
            const results = await Promise.all(promises);
            for (const r of results) {
                assert.equal(r.status, 200);
                assert.equal(r.data.database, 'connected');
            }
        });

        test('AC7.4: Health check response time is within SLA (< 500ms)', async () => {
            const start = Date.now();
            const res = await api.health();
            const duration = Date.now() - start;
            assert.equal(res.status, 200);
            assert.ok(duration < 500, `Health check took ${duration}ms, must be < 500ms`);
        });

        test('AC7.5: Root route / serves index.html static content successfully', async () => {
            const res = await api.raw('/');
            assert.equal(res.status, 200);
            assert.match(String(res.data), /CarModelStore|Mô hình/i, 'Root route must serve frontend homepage');
        });
    });
});
