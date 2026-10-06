const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const api = require('./helpers/api');
const db = require('./helpers/db');
const { ensureServer, stopServer } = require('./helpers/server');

describe('Empirical Challenger M2-2: Duplicate Payload Items & Authoritative Pricing Resilience', () => {
    let serverInfo;
    const createdOrderCodes = [];

    before(async () => {
        serverInfo = await ensureServer();
        await db.setProductStock(1, 15);
        await db.setProductStock(2, 20);
        await db.setProductStock(4, 10);
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
    // Challenge Suite 1: Duplicate Items in Payload with Various Structures
    // =========================================================================
    describe('Challenge Suite 1: Duplicate Items Aggregation & Structural Boundary', () => {
        test('Duplicate 1.1: Standard duplicate items within stock limit aggregate quantity and calculate authoritative total', async () => {
            await db.setProductStock(4, 10);
            const p = await db.getProduct(4);
            const initialStock = Number(p.stock_quantity);
            const unitPrice = Number(p.price);

            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'Duplicate Item Alpha',
                recipientPhone: '0908111222',
                shippingAddress: '100 Nguyen Van Cu, Dist 5',
                items: [
                    { productId: 4, quantity: 2 },
                    { productId: 4, quantity: 3 }
                ]
            });

            assert.equal(res.status, 201, 'Duplicate valid items must return HTTP 201');
            assert.equal(res.data.success, true);
            const code = res.data.orderCode || (res.data.order && res.data.order.orderCode);
            createdOrderCodes.push(code);

            // Verify stock decremented by exactly 2 + 3 = 5
            const afterP = await db.getProduct(4);
            assert.equal(Number(afterP.stock_quantity), initialStock - 5, 'Stock must decrement by aggregate quantity (5)');

            // Verify database order total
            const dbOrder = await db.getOrder(code);
            assert.equal(Number(dbOrder.total_amount), 5 * unitPrice, 'Total amount must equal aggregated 5 * unitPrice');

            // Verify order_items row
            const orderItems = await db.getOrderItems(dbOrder.id);
            const totalItemQty = orderItems.reduce((sum, item) => sum + Number(item.quantity), 0);
            assert.equal(totalItemQty, 5, 'Aggregated order_items quantity must equal 5');

            await db.setProductStock(4, 10);
        });

        test('Duplicate 1.2: Duplicate items whose aggregate quantity exceeds available stock are rejected with HTTP 400', async () => {
            await db.setProductStock(4, 5);

            // Send 3 + 3 = 6 (deficit of 1)
            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'Duplicate Deficit Buyer',
                recipientPhone: '0908111223',
                shippingAddress: '101 Nguyen Van Cu, Dist 5',
                items: [
                    { productId: 4, quantity: 3 },
                    { productId: 4, quantity: 3 }
                ]
            });

            assert.equal(res.status, 400, 'Aggregate stock deficit must be rejected with 400');
            assert.equal(res.data.success, false);
            assert.match(res.data.error || res.data.message || '', /5|kho|chỉ còn/i);

            // Verify stock untouched
            const afterP = await db.getProduct(4);
            assert.equal(Number(afterP.stock_quantity), 5, 'Stock must remain 5');

            await db.setProductStock(4, 10);
        });

        test('Duplicate 1.3: Interleaved duplicates for multiple products correctly aggregate per productId', async () => {
            await db.setProductStock(1, 15);
            await db.setProductStock(2, 20);
            const p1 = await db.getProduct(1);
            const p2 = await db.getProduct(2);

            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'Interleaved Duplicates Buyer',
                recipientPhone: '0908111224',
                shippingAddress: '102 Nguyen Van Cu, Dist 5',
                items: [
                    { productId: 1, quantity: 1 },
                    { productId: 2, quantity: 2 },
                    { productId: 1, quantity: 2 },
                    { productId: 2, quantity: 1 }
                ]
            });

            assert.equal(res.status, 201);
            const code = res.data.orderCode || (res.data.order && res.data.order.orderCode);
            createdOrderCodes.push(code);

            const afterP1 = await db.getProduct(1);
            const afterP2 = await db.getProduct(2);
            assert.equal(Number(afterP1.stock_quantity), 15 - 3, 'Product 1 stock must decrement by 1 + 2 = 3');
            assert.equal(Number(afterP2.stock_quantity), 20 - 3, 'Product 2 stock must decrement by 2 + 1 = 3');

            const dbOrder = await db.getOrder(code);
            const expectedTotal = (3 * Number(p1.price)) + (3 * Number(p2.price));
            assert.equal(Number(dbOrder.total_amount), expectedTotal, 'Total must equal sum of both aggregated products');

            await db.setProductStock(1, 15);
            await db.setProductStock(2, 20);
        });

        test('Duplicate 1.4: Duplicate items with negative quantity attack is rejected with HTTP 400', async () => {
            await db.setProductStock(1, 15);

            // Attempt net quantity manipulation: 5 + (-2) = 3
            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'Negative Duplicate Attacker',
                recipientPhone: '0908111225',
                shippingAddress: '103 Negative Ave',
                items: [
                    { productId: 1, quantity: 5 },
                    { productId: 1, quantity: -2 }
                ]
            });

            assert.equal(res.status, 400, 'Negative quantity in duplicate items must be rejected with 400');
            assert.equal(res.data.success, false);

            const afterP = await db.getProduct(1);
            assert.equal(Number(afterP.stock_quantity), 15, 'Stock must not change');
        });

        test('Duplicate 1.5: Duplicate items with zero quantity are rejected with HTTP 400', async () => {
            await db.setProductStock(1, 15);

            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'Zero Duplicate Attacker',
                recipientPhone: '0908111226',
                shippingAddress: '104 Zero Ave',
                items: [
                    { productId: 1, quantity: 2 },
                    { productId: 1, quantity: 0 }
                ]
            });

            assert.equal(res.status, 400, 'Zero quantity must be rejected with 400');
            assert.equal(res.data.success, false);

            const afterP = await db.getProduct(1);
            assert.equal(Number(afterP.stock_quantity), 15);
        });

        test('Duplicate 1.6: Duplicate items with float quantity (e.g. 1.5) are rejected with HTTP 400', async () => {
            await db.setProductStock(1, 15);

            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'Float Duplicate Attacker',
                recipientPhone: '0908111227',
                shippingAddress: '105 Float Ave',
                items: [
                    { productId: 1, quantity: 2 },
                    { productId: 1, quantity: 1.5 }
                ]
            });

            assert.equal(res.status, 400, 'Float quantity must be rejected with 400');
            assert.equal(res.data.success, false);

            const afterP = await db.getProduct(1);
            assert.equal(Number(afterP.stock_quantity), 15);
        });

        test('Duplicate 1.7: Duplicate items with string integer quantities are cleanly parsed and aggregated', async () => {
            await db.setProductStock(1, 15);

            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'String Int Buyer',
                recipientPhone: '0908111228',
                shippingAddress: '106 String Ave',
                items: [
                    { productId: 1, quantity: "2" },
                    { productId: 1, quantity: "1" }
                ]
            });

            assert.equal(res.status, 201, 'String integer quantities should parse cleanly');
            const code = res.data.orderCode || (res.data.order && res.data.order.orderCode);
            createdOrderCodes.push(code);

            const afterP = await db.getProduct(1);
            assert.equal(Number(afterP.stock_quantity), 15 - 3);

            await db.setProductStock(1, 15);
        });

        test('Duplicate 1.8: Duplicate items with string non-numeric quantity ("NaN", "abc") are rejected with HTTP 400', async () => {
            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'String NaN Buyer',
                recipientPhone: '0908111229',
                shippingAddress: '107 NaN Ave',
                items: [
                    { productId: 1, quantity: 2 },
                    { productId: 1, quantity: "NaN" }
                ]
            });

            assert.equal(res.status, 400);
            assert.equal(res.data.success, false);
        });

        test('Duplicate 1.9: Duplicate items with null, undefined, or missing fields are rejected with HTTP 400', async () => {
            const testCases = [
                { items: [{ productId: 1, quantity: 2 }, { productId: 1, quantity: null }], label: 'null quantity' },
                { items: [{ productId: 1, quantity: 2 }, { productId: 1 }], label: 'missing quantity' },
                { items: [{ productId: 1, quantity: 2 }, { quantity: 2 }], label: 'missing productId' },
                { items: [{ productId: 1, quantity: 2 }, null], label: 'null item entry' },
                { items: [{ productId: 1, quantity: 2 }, "invalid string"], label: 'string item entry' },
                { items: [{ productId: 1, quantity: 2 }, {}], label: 'empty object item entry' },
                { items: [{ productId: -1, quantity: 1 }, { productId: -1, quantity: 2 }], label: 'negative productId' }
            ];

            for (const tc of testCases) {
                const res = await api.createOrder({
                    customerId: 2,
                    recipientName: 'Malformed Item Buyer',
                    recipientPhone: '0908111230',
                    shippingAddress: '108 Malformed Way',
                    items: tc.items
                });

                assert.equal(res.status, 400, `Expected 400 for ${tc.label}`);
                assert.equal(res.data.success, false, `Expected success: false for ${tc.label}`);
            }
        });

        test('Duplicate 1.10: Cancellation of an order created with duplicate items restores full aggregated stock', async () => {
            await db.setProductStock(4, 10);

            const orderRes = await api.createOrder({
                customerId: 2,
                recipientName: 'Duplicate Cancel Buyer',
                recipientPhone: '0908111231',
                shippingAddress: '109 Restore Way',
                items: [
                    { productId: 4, quantity: 2 },
                    { productId: 4, quantity: 2 }
                ]
            });

            assert.equal(orderRes.status, 201);
            const code = orderRes.data.orderCode || (orderRes.data.order && orderRes.data.order.orderCode);
            createdOrderCodes.push(code);

            const midStock = await db.getProduct(4);
            assert.equal(Number(midStock.stock_quantity), 10 - 4, 'Stock after order must be 10 - 4 = 6');

            // Cancel order
            const cancelRes = await api.cancelOrder(code);
            assert.equal(cancelRes.status, 200);

            const finalStock = await db.getProduct(4);
            assert.equal(Number(finalStock.stock_quantity), 10, 'Stock after cancel must be restored by full aggregated 4');

            // Second cancellation must be rejected and not inflate stock
            const secondCancel = await api.cancelOrder(code);
            assert.equal(secondCancel.status, 400, 'Second cancel must return 400');
            const postSecondStock = await db.getProduct(4);
            assert.equal(Number(postSecondStock.stock_quantity), 10, 'Stock must not be inflated');

            await db.setProductStock(4, 10);
        });
    });

    // =========================================================================
    // Challenge Suite 2: Client unitPrice Tampering Resistance
    // =========================================================================
    describe('Challenge Suite 2: Authoritative Database Pricing vs Client Tampering', () => {
        test('Price Tampering 2.1: Client submits unitPrice: 0 -> Server enforces database authoritative price', async () => {
            await db.setProductStock(1, 15);
            const p = await db.getProduct(1);
            const expectedUnitPrice = Number(p.price);
            assert.ok(expectedUnitPrice > 0, 'Database price must be positive');

            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'Zero Price Exploiter',
                recipientPhone: '0909000001',
                shippingAddress: '201 Free Stuff Ave',
                items: [
                    { productId: 1, quantity: 1, unitPrice: 0 }
                ]
            });

            assert.equal(res.status, 201, 'Order succeeds because price is computed server-side');
            const code = res.data.orderCode || (res.data.order && res.data.order.orderCode);
            createdOrderCodes.push(code);

            // Response payload total amount check
            const resTotal = res.data.totalAmount || (res.data.order && res.data.order.totalAmount);
            assert.equal(Number(resTotal), expectedUnitPrice, 'Response totalAmount must strictly reflect DB price, not 0');

            // Database orders row check
            const dbOrder = await db.getOrder(code);
            assert.equal(Number(dbOrder.total_amount), expectedUnitPrice, 'orders.total_amount in SQL Server must equal DB price');

            // Database order_items row check
            const orderItems = await db.getOrderItems(dbOrder.id);
            assert.equal(orderItems.length, 1);
            assert.equal(Number(orderItems[0].unit_price), expectedUnitPrice, 'order_items.unit_price in SQL Server must equal DB price');

            await db.setProductStock(1, 15);
        });

        test('Price Tampering 2.2: Client submits unitPrice: 0.01 / 1 VND -> Server strictly ignores client input', async () => {
            await db.setProductStock(1, 15);
            const p = await db.getProduct(1);
            const expectedUnitPrice = Number(p.price);

            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'Penny Price Exploiter',
                recipientPhone: '0909000002',
                shippingAddress: '202 Penny Ave',
                items: [
                    { productId: 1, quantity: 2, unitPrice: 0.01 }
                ]
            });

            assert.equal(res.status, 201);
            const code = res.data.orderCode || (res.data.order && res.data.order.orderCode);
            createdOrderCodes.push(code);

            const dbOrder = await db.getOrder(code);
            assert.equal(Number(dbOrder.total_amount), 2 * expectedUnitPrice, 'orders.total_amount must equal 2 * DB price');

            const orderItems = await db.getOrderItems(dbOrder.id);
            assert.equal(Number(orderItems[0].unit_price), expectedUnitPrice);

            await db.setProductStock(1, 15);
        });

        test('Price Tampering 2.3: Client submits negative unitPrice: -5000000 VND -> Server overrides with DB price', async () => {
            await db.setProductStock(1, 15);
            const p = await db.getProduct(1);
            const expectedUnitPrice = Number(p.price);

            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'Negative Price Exploiter',
                recipientPhone: '0909000003',
                shippingAddress: '203 CashBack Ave',
                items: [
                    { productId: 1, quantity: 1, unitPrice: -5000000 }
                ]
            });

            assert.equal(res.status, 201);
            const code = res.data.orderCode || (res.data.order && res.data.order.orderCode);
            createdOrderCodes.push(code);

            const dbOrder = await db.getOrder(code);
            assert.equal(Number(dbOrder.total_amount), expectedUnitPrice, 'Total must NOT be negative');

            await db.setProductStock(1, 15);
        });

        test('Price Tampering 2.4: Client submits astronomical price unitPrice: 999999999999 -> Server overrides with DB price', async () => {
            await db.setProductStock(1, 15);
            const p = await db.getProduct(1);
            const expectedUnitPrice = Number(p.price);

            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'Huge Price Exploiter',
                recipientPhone: '0909000004',
                shippingAddress: '204 Billions Ave',
                items: [
                    { productId: 1, quantity: 1, unitPrice: 999999999999 }
                ]
            });

            assert.equal(res.status, 201);
            const code = res.data.orderCode || (res.data.order && res.data.order.orderCode);
            createdOrderCodes.push(code);

            const dbOrder = await db.getOrder(code);
            assert.equal(Number(dbOrder.total_amount), expectedUnitPrice, 'Total must strictly equal authoritative price');

            await db.setProductStock(1, 15);
        });

        test('Price Tampering 2.5: Client submits root-level totalAmount tampering -> Server recalculates authoritatively', async () => {
            await db.setProductStock(1, 15);
            const p = await db.getProduct(1);
            const expectedUnitPrice = Number(p.price);

            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'Root Total Exploiter',
                recipientPhone: '0909000005',
                shippingAddress: '205 Root Total Ave',
                totalAmount: 1234, // Malicious override attempt at payload root
                items: [
                    { productId: 1, quantity: 2, unitPrice: 617 }
                ]
            });

            assert.equal(res.status, 201);
            const code = res.data.orderCode || (res.data.order && res.data.order.orderCode);
            createdOrderCodes.push(code);

            const dbOrder = await db.getOrder(code);
            assert.equal(Number(dbOrder.total_amount), 2 * expectedUnitPrice, 'Root totalAmount must be computed from DB, not client payload');

            await db.setProductStock(1, 15);
        });

        test('Price Tampering 2.6: Combined duplicate items with mixed tampered prices -> Server applies authoritative price for all', async () => {
            await db.setProductStock(1, 15);
            await db.setProductStock(2, 20);
            const p1 = await db.getProduct(1);
            const p2 = await db.getProduct(2);
            const price1 = Number(p1.price);
            const price2 = Number(p2.price);

            const res = await api.createOrder({
                customerId: 2,
                recipientName: 'Mixed Tampering Exploiter',
                recipientPhone: '0909000006',
                shippingAddress: '206 Mixed Ave',
                items: [
                    { productId: 1, quantity: 1, unitPrice: 0 },
                    { productId: 1, quantity: 2, unitPrice: 9999999 },
                    { productId: 2, quantity: 1, unitPrice: -100 }
                ]
            });

            assert.equal(res.status, 201);
            const code = res.data.orderCode || (res.data.order && res.data.order.orderCode);
            createdOrderCodes.push(code);

            const expectedTotal = (3 * price1) + (1 * price2);

            const dbOrder = await db.getOrder(code);
            assert.equal(Number(dbOrder.total_amount), expectedTotal, 'Total must equal (3 * price1) + (1 * price2)');

            const orderItems = await db.getOrderItems(dbOrder.id);
            for (const item of orderItems) {
                if (Number(item.product_id) === 1) {
                    assert.equal(Number(item.unit_price), price1);
                    assert.equal(Number(item.quantity), 3);
                } else if (Number(item.product_id) === 2) {
                    assert.equal(Number(item.unit_price), price2);
                    assert.equal(Number(item.quantity), 1);
                }
            }

            await db.setProductStock(1, 15);
            await db.setProductStock(2, 20);
        });
    });
});
