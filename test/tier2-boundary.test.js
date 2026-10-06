const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const api = require('./helpers/api');
const db = require('./helpers/db');
const { ensureServer, stopServer } = require('./helpers/server');

describe('Tier 2: Boundary, Edge Cases & Concurrency', () => {
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
    // Category 1: Stock Boundary Conditions
    // =========================================================================
    describe('Category 1: Stock Boundary Conditions', () => {
        test('Boundary 1.1: Ordering exact available stock reduces stock to exactly 0', async () => {
            const p = await db.getProduct(3);
            const initialStock = Number(p.stock_quantity);

            // Temporarily set stock to 3 for clean boundary test
            await db.setProductStock(3, 3);

            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'Exact Stock Buyer',
                recipientPhone: '0901000001',
                shippingAddress: '10 Exact Way, Dist 1',
                items: [{ productId: 3, quantity: 3, unitPrice: Number(p.price) }]
            });

            assert.equal(res.status, 201);
            const orderCode = res.data.orderCode || (res.data.order && res.data.order.orderCode);
            createdOrderCodes.push(orderCode);

            const afterP = await db.getProduct(3);
            assert.equal(Number(afterP.stock_quantity), 0, 'Product stock must reach exactly 0');

            // Restore initial stock
            await db.setProductStock(3, initialStock);
        });

        test('Boundary 1.2: Subsequent order when stock is 0 is immediately rejected with 400', async () => {
            const p = await db.getProduct(3);
            const initialStock = Number(p.stock_quantity);

            // Set stock to 0
            await db.setProductStock(3, 0);

            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'Zero Stock Buyer',
                recipientPhone: '0901000002',
                shippingAddress: '11 Zero Street, Dist 1',
                items: [{ productId: 3, quantity: 1, unitPrice: Number(p.price) }]
            });

            assert.equal(res.status, 400, 'Ordering item with 0 stock must return 400');
            assert.equal(res.data.success, false);

            const afterP = await db.getProduct(3);
            assert.equal(Number(afterP.stock_quantity), 0, 'Stock must remain 0');

            await db.setProductStock(3, initialStock);
        });

        test('Boundary 1.3: Ordering stock + 1 returns 400 with specific deficit message', async () => {
            const p = await db.getProduct(3);
            const initialStock = Number(p.stock_quantity);

            await db.setProductStock(3, 5);

            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'Stock Plus One Buyer',
                recipientPhone: '0901000003',
                shippingAddress: '12 Boundary Ave, Dist 1',
                items: [{ productId: 3, quantity: 6, unitPrice: Number(p.price) }]
            });

            assert.equal(res.status, 400);
            assert.equal(res.data.success, false);
            const msg = res.data.message || res.data.error || '';
            assert.match(msg, /5|kho|chỉ còn/i, 'Error message must mention available quantity');

            await db.setProductStock(3, initialStock);
        });

        test('Boundary 1.4: Ordering negative quantity (-1) is rejected with 400 without modifying stock', async () => {
            const p = await db.getProduct(3);
            const initialStock = Number(p.stock_quantity);

            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'Negative Qty Buyer',
                recipientPhone: '0901000004',
                shippingAddress: '13 Negative St, Dist 1',
                items: [{ productId: 3, quantity: -1, unitPrice: Number(p.price) }]
            });

            assert.equal(res.status, 400, 'Negative quantity must be rejected with 400');
            assert.equal(res.data.success, false);

            const afterP = await db.getProduct(3);
            assert.equal(Number(afterP.stock_quantity), initialStock, 'Stock must not change');
        });

        test('Boundary 1.5: Ordering zero quantity (0) is rejected with 400 without modifying stock', async () => {
            const p = await db.getProduct(3);
            const initialStock = Number(p.stock_quantity);

            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'Zero Qty Buyer',
                recipientPhone: '0901000005',
                shippingAddress: '14 Zero Way, Dist 1',
                items: [{ productId: 3, quantity: 0, unitPrice: Number(p.price) }]
            });

            assert.equal(res.status, 400, 'Zero quantity must be rejected with 400');
            assert.equal(res.data.success, false);

            const afterP = await db.getProduct(3);
            assert.equal(Number(afterP.stock_quantity), initialStock);
        });
    });

    // =========================================================================
    // Category 2: Payload Structure and Product Validation
    // =========================================================================
    describe('Category 2: Payload Structure and Product Validation', () => {
        test('Boundary 2.1: Duplicate productId in items payload does not allow stock deficit', async () => {
            const p = await db.getProduct(4);
            assert.ok(p, 'Product 4 must exist');
            const initialStock = Number(p.stock_quantity);

            await db.setProductStock(4, 5);

            // Attempt to order 3 + 3 = 6 (more than 5 available)
            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'Duplicate Item Buyer',
                recipientPhone: '0902000001',
                shippingAddress: '20 Duplicate Blvd, Dist 2',
                items: [
                    { productId: 4, quantity: 3, unitPrice: Number(p.price) },
                    { productId: 4, quantity: 3, unitPrice: Number(p.price) }
                ]
            });

            // Either rejected (400) because total is 6 > 5, or if rejected due to duplicate validation
            const afterP = await db.getProduct(4);
            assert.ok(Number(afterP.stock_quantity) >= 0, 'Stock must never become negative');

            if (res.status === 201) {
                const code = res.data.orderCode || (res.data.order && res.data.order.orderCode);
                createdOrderCodes.push(code);
            }

            await db.setProductStock(4, initialStock);
        });

        test('Boundary 2.2: Ordering non-existent productId (999999) returns 404/400 and creates no order', async () => {
            const countBeforeRes = await db.query('SELECT COUNT(*) as cnt FROM orders');
            const beforeCount = countBeforeRes.recordset[0].cnt;

            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'Ghost Item Buyer',
                recipientPhone: '0902000002',
                shippingAddress: '21 Ghost Road, Dist 2',
                items: [{ productId: 999999, quantity: 1, unitPrice: 500000 }]
            });

            assert.ok([400, 404].includes(res.status), 'Must return 400 or 404 for non-existent product');
            assert.equal(res.data.success, false);

            const countAfterRes = await db.query('SELECT COUNT(*) as cnt FROM orders');
            assert.equal(countAfterRes.recordset[0].cnt, beforeCount, 'Zero orders created');
        });

        test('Boundary 2.3: Ordering with empty items array returns 400', async () => {
            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'Empty Cart Buyer',
                recipientPhone: '0902000003',
                shippingAddress: '22 Empty Plaza, Dist 2',
                items: []
            });

            assert.equal(res.status, 400, 'Empty cart items array must return 400');
            assert.equal(res.data.success, false);
        });

        test('Boundary 2.4: Ordering with missing required recipient fields returns 400', async () => {
            const res = await api.createOrder({
                customerId: 2,
                recipientName: '',
                recipientPhone: '',
                shippingAddress: '',
                items: [{ productId: 1, quantity: 1, unitPrice: 100000 }]
            });

            assert.equal(res.status, 400, 'Missing recipient details must return 400');
            assert.equal(res.data.success, false);
        });

        test('Boundary 2.5: Ordering with non-numeric quantity ("abc") returns 400', async () => {
            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'NaN Qty Buyer',
                recipientPhone: '0902000005',
                shippingAddress: '24 NaN Lane, Dist 2',
                items: [{ productId: 1, quantity: 'abc', unitPrice: 100000 }]
            });

            assert.equal(res.status, 400, 'Non-numeric quantity must return 400');
            assert.equal(res.data.success, false);
        });
    });

    // =========================================================================
    // Category 3: Order Cancellation Idempotency & State Machine
    // =========================================================================
    describe('Category 3: Order Cancellation Idempotency & State Machine', () => {
        test('Boundary 3.1: Cancelling an already cancelled order returns 400 and does NOT restore stock again (stock inflation prevention)', async () => {
            const p = await db.getProduct(1);
            const initialStock = Number(p.stock_quantity);

            // 1. Create order
            const orderRes = await api.createOrder({
                customerId: 2,
                recipientName: 'Double Cancel Buyer',
                recipientPhone: '0903000001',
                shippingAddress: '31 Idempotent Alley, Dist 3',
                items: [{ productId: 1, quantity: 2, unitPrice: Number(p.price) }]
            });
            const orderCode = orderRes.data.orderCode || (orderRes.data.order && orderRes.data.order.orderCode);
            createdOrderCodes.push(orderCode);

            // 2. First cancellation (Must succeed)
            const cancel1 = await api.cancelOrder(orderCode);
            assert.equal(cancel1.status, 200, 'First cancel must succeed with 200');

            const stockAfterFirstCancel = await db.getProduct(1);
            assert.equal(Number(stockAfterFirstCancel.stock_quantity), initialStock, 'Stock restored to initial');

            // 3. Second cancellation on same order (Must be rejected per F4 / Interface Contract 4.3)
            const cancel2 = await api.cancelOrder(orderCode);
            assert.equal(cancel2.status, 400, 'Second cancel on already cancelled order must return 400 Bad Request');
            assert.equal(cancel2.data.success, false);

            // 4. Critical check: Stock must NOT be incremented again!
            const stockAfterSecondCancel = await db.getProduct(1);
            assert.equal(Number(stockAfterSecondCancel.stock_quantity), initialStock, 'Stock must NOT be incremented again (no stock inflation)');

            await db.setProductStock(1, initialStock);
        });

        test('Boundary 3.2: Multiple rapid cancellation requests only restore stock exactly once', async () => {
            const p = await db.getProduct(1);
            const initialStock = Number(p.stock_quantity);

            const orderRes = await api.createOrder({
                customerId: 2,
                recipientName: 'Rapid Cancel Buyer',
                recipientPhone: '0903000002',
                shippingAddress: '32 Rapid Ave, Dist 3',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });
            const orderCode = orderRes.data.orderCode || (orderRes.data.order && orderRes.data.order.orderCode);
            createdOrderCodes.push(orderCode);

            // Fire 3 simultaneous cancels
            await Promise.all([
                api.cancelOrder(orderCode),
                api.cancelOrder(orderCode),
                api.cancelOrder(orderCode)
            ]);

            const finalStock = await db.getProduct(1);
            assert.equal(Number(finalStock.stock_quantity), initialStock, 'Stock must equal initialStock, never initialStock + extra');

            await db.setProductStock(1, initialStock);
        });

        test('Boundary 3.3: Updating order status to an invalid status string returns 400', async () => {
            const p = await db.getProduct(1);
            const initialStock = Number(p.stock_quantity);

            const orderRes = await api.createOrder({
                customerId: 2,
                recipientName: 'Invalid Status Buyer',
                recipientPhone: '0903000003',
                shippingAddress: '33 Invalid St, Dist 3',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });
            const orderCode = orderRes.data.orderCode || (orderRes.data.order && orderRes.data.order.orderCode);
            createdOrderCodes.push(orderCode);

            const res = await api.updateOrderStatus(orderCode, 'flying_car_status');
            assert.equal(res.status, 400, 'Invalid status string must return 400');
            assert.equal(res.data.success, false);

            await db.setProductStock(1, initialStock);
        });

        test('Boundary 3.4: Cancelling non-existent order code returns 404', async () => {
            const res = await api.cancelOrder('ORD-NON-EXISTENT-00000000');
            assert.equal(res.status, 404, 'Cancelling non-existent order must return 404');
            assert.equal(res.data.success, false);
        });
    });

    // =========================================================================
    // Category 4: PII Masking Edge Cases
    // =========================================================================
    describe('Category 4: PII Masking Edge Cases (/api/tracking/:code)', () => {
        test('Boundary 4.1: PII Masking: Single-word name (e.g. "Long") is handled safely without throwing', async () => {
            const p = await db.getProduct(1);
            const initialStock = Number(p.stock_quantity);

            const o = await api.createOrder({
                customerId: 2,
                recipientName: 'Long',
                recipientPhone: '0904000001',
                shippingAddress: '41 Single Name Court',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });
            const code = o.data.orderCode || (o.data.order && o.data.order.orderCode);
            const tracking = o.data.trackingCode || (o.data.order && o.data.order.trackingCode);
            createdOrderCodes.push(code);

            const trackRes = await api.getTracking(tracking);
            assert.equal(trackRes.status, 200);
            const data = trackRes.data.data || trackRes.data.order || trackRes.data;
            assert.ok(data.recipient_name, 'Recipient name must be returned');
            assert.match(data.recipient_name, /\*/, 'Single word name must contain masking asterisk');

            await db.setProductStock(1, initialStock);
        });

        test('Boundary 4.2: PII Masking: Two-word name (e.g. "Ha Long") has middle masked', async () => {
            const p = await db.getProduct(1);
            const initialStock = Number(p.stock_quantity);

            const o = await api.createOrder({
                customerId: 2,
                recipientName: 'Ha Long',
                recipientPhone: '0904000002',
                shippingAddress: '42 Two Word Court',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });
            const code = o.data.orderCode || (o.data.order && o.data.order.orderCode);
            const tracking = o.data.trackingCode || (o.data.order && o.data.order.trackingCode);
            createdOrderCodes.push(code);

            const trackRes = await api.getTracking(tracking);
            assert.equal(trackRes.status, 200);
            const data = trackRes.data.data || trackRes.data.order || trackRes.data;
            assert.match(data.recipient_name, /\*/, 'Two word name must contain masking asterisk');

            await db.setProductStock(1, initialStock);
        });

        test('Boundary 4.3: PII Masking: 10-digit phone number masks middle 3-4 digits', async () => {
            const p = await db.getProduct(1);
            const initialStock = Number(p.stock_quantity);

            const o = await api.createOrder({
                customerId: 2,
                recipientName: 'Tran Van Bao',
                recipientPhone: '0912345678',
                shippingAddress: '43 Phone St',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });
            const code = o.data.orderCode || (o.data.order && o.data.order.orderCode);
            const tracking = o.data.trackingCode || (o.data.order && o.data.order.trackingCode);
            createdOrderCodes.push(code);

            const trackRes = await api.getTracking(tracking);
            assert.equal(trackRes.status, 200);
            const data = trackRes.data.data || trackRes.data.order || trackRes.data;
            assert.match(data.recipient_phone, /\*/, 'Phone number must contain masking asterisk');
            assert.notEqual(data.recipient_phone, '0912345678', 'Plain phone number must NOT be exposed');

            await db.setProductStock(1, initialStock);
        });

        test('Boundary 4.4: PII Masking: Shipping address masks street details', async () => {
            const p = await db.getProduct(1);
            const initialStock = Number(p.stock_quantity);

            const o = await api.createOrder({
                customerId: 2,
                recipientName: 'Le Thi Cam',
                recipientPhone: '0912345679',
                shippingAddress: '123 Le Loi, Q1, HCMC',
                items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
            });
            const code = o.data.orderCode || (o.data.order && o.data.order.orderCode);
            const tracking = o.data.trackingCode || (o.data.order && o.data.order.trackingCode);
            createdOrderCodes.push(code);

            const trackRes = await api.getTracking(tracking);
            assert.equal(trackRes.status, 200);
            const data = trackRes.data.data || trackRes.data.order || trackRes.data;
            assert.match(data.shipping_address, /\*/, 'Shipping address must contain masking asterisk');

            await db.setProductStock(1, initialStock);
        });
    });

    // =========================================================================
    // Category 5: Concurrency and Race Condition
    // =========================================================================
    describe('Category 5: Concurrency and Race Condition (ACID Row-Locking)', () => {
        test('Boundary 5.1: 3 simultaneous orders competing for 1 remaining stock item: exactly 1 succeeds, 2 fail with 400, stock never negative', async () => {
            const p = await db.getProduct(5);
            assert.ok(p, 'Product 5 must exist');
            const initialStock = Number(p.stock_quantity);

            // Set stock to exactly 1
            await db.setProductStock(5, 1);

            // Launch 3 simultaneous order requests
            const promises = Array.from({ length: 3 }, (_, idx) => {
                return api.createOrder({
                    customerId: 2,
                    recipientName: `Concurrent Buyer ${idx}`,
                    recipientPhone: `090500000${idx}`,
                    shippingAddress: `50 Race St #${idx}`,
                    items: [{ productId: 5, quantity: 1, unitPrice: Number(p.price) }]
                });
            });

            const results = await Promise.all(promises);

            const successCount = results.filter(r => r.status === 201).length;
            const failCount = results.filter(r => r.status === 400).length;

            // Track any created orders for cleanup
            for (const r of results) {
                if (r.status === 201) {
                    const code = r.data.orderCode || (r.data.order && r.data.order.orderCode);
                    if (code) createdOrderCodes.push(code);
                }
            }

            assert.equal(successCount, 1, `Exactly 1 order must succeed (got ${successCount})`);
            assert.equal(failCount, 2, `Remaining 2 orders must fail with 400 (got ${failCount})`);

            // Verify final stock in database is exactly 0, never negative
            const finalP = await db.getProduct(5);
            assert.equal(Number(finalP.stock_quantity), 0, 'Final stock must be exactly 0, never negative');

            // Restore initial stock
            await db.setProductStock(5, initialStock);
        });
    });
});
