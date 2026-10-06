const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const api = require('./helpers/api');
const db = require('./helpers/db');
const { ensureServer, stopServer } = require('./helpers/server');

describe('Tier 3: Pairwise Combinations & Cross-Feature Interactions', () => {
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
    // Pairwise Scenario 1: Order -> Tracking -> Cancel -> Tracking -> Stock
    // =========================================================================
    test('Pairwise 1: Order -> Tracking Lookup -> Cancel Order -> Tracking Lookup -> Stock Verification', async () => {
        const product = await db.getProduct(1);
        const initialStock = Number(product.stock_quantity);

        // Step 1: Place an order
        const orderRes = await api.createOrder({
            customerId: 2,
            recipientName: 'Pairwise Lifecycle User',
            recipientPhone: '0907000001',
            shippingAddress: '100 Pairwise Blvd, Dist 1',
            items: [{ productId: 1, quantity: 2, unitPrice: Number(product.price) }]
        });
        assert.equal(orderRes.status, 201, 'Step 1: Order placement must succeed');
        const orderCode = orderRes.data.orderCode || (orderRes.data.order && orderRes.data.order.orderCode);
        const trackingCode = orderRes.data.trackingCode || (orderRes.data.order && orderRes.data.order.trackingCode);
        createdOrderCodes.push(orderCode);

        // Step 2: Check tracking lookup immediately after order creation
        const track1Res = await api.getTracking(trackingCode);
        assert.equal(track1Res.status, 200, 'Step 2: Tracking lookup must succeed');
        const track1Data = track1Res.data.data || track1Res.data;
        const initialShipmentStatus = track1Data.shipping_status || (track1Data.shipment && track1Data.shipment.shipping_status);
        assert.equal(initialShipmentStatus, 'pending', 'Shipment status must initially be pending');

        // Verify stock decremented
        const stockAfterOrder = await db.getProduct(1);
        assert.equal(Number(stockAfterOrder.stock_quantity), initialStock - 2, 'Stock must decrement by 2');

        // Step 3: Cancel order
        const cancelRes = await api.cancelOrder(orderCode);
        assert.equal(cancelRes.status, 200, 'Step 3: Order cancellation must succeed');

        // Step 4: Check tracking lookup after cancellation
        const track2Res = await api.getTracking(trackingCode);
        assert.equal(track2Res.status, 200, 'Step 4: Tracking lookup after cancel must succeed');
        const track2Data = track2Res.data.data || track2Res.data;
        const cancelledShipmentStatus = track2Data.shipping_status || (track2Data.shipment && track2Data.shipment.shipping_status);
        assert.equal(cancelledShipmentStatus, 'cancelled', 'Shipment status must transition to cancelled');

        // Step 5: Verify product stock is restored in database
        const finalProduct = await db.getProduct(1);
        assert.equal(Number(finalProduct.stock_quantity), initialStock, 'Step 5: Product stock must be restored to initial value');
    });

    // =========================================================================
    // Pairwise Scenario 2: Multiple Orders -> Dashboard Sync -> Cancel -> Re-sync
    // =========================================================================
    test('Pairwise 2: Multiple Orders Placed -> Admin Dashboard Sync -> Cancel One Order -> Dashboard Revenue Re-sync', async () => {
        const p1 = await db.getProduct(1);
        const p2 = await db.getProduct(2);
        const stock1 = Number(p1.stock_quantity);
        const stock2 = Number(p2.stock_quantity);

        // 1. Snapshot initial dashboard metrics
        const baselineRes = await api.getDashboardStats();
        assert.equal(baselineRes.status, 200);
        const baseOrders = Number(baselineRes.data.stats.total_orders);
        const baseRev = Number(baselineRes.data.stats.total_revenue);

        // 2. Place Order A
        const priceA = Number(p1.price) * 1;
        const orderARes = await api.createOrder({
            customerId: 2,
            recipientName: 'Pairwise Dashboard Buyer A',
            recipientPhone: '0907000002',
            shippingAddress: '101 Pairwise Blvd, Dist 1',
            items: [{ productId: 1, quantity: 1, unitPrice: Number(p1.price) }]
        });
        const codeA = orderARes.data.orderCode || (orderARes.data.order && orderARes.data.order.orderCode);
        createdOrderCodes.push(codeA);

        // 3. Place Order B
        const priceB = Number(p2.price) * 2;
        const orderBRes = await api.createOrder({
            customerId: 3,
            recipientName: 'Pairwise Dashboard Buyer B',
            recipientPhone: '0907000003',
            shippingAddress: '102 Pairwise Blvd, Dist 1',
            items: [{ productId: 2, quantity: 2, unitPrice: Number(p2.price) }]
        });
        const codeB = orderBRes.data.orderCode || (orderBRes.data.order && orderBRes.data.order.orderCode);
        createdOrderCodes.push(codeB);

        // 4. Verify Dashboard shows +2 orders and +revenue
        const midStatsRes = await api.getDashboardStats();
        assert.equal(Number(midStatsRes.data.stats.total_orders), baseOrders + 2, 'Dashboard total_orders must increase by 2');
        assert.equal(Number(midStatsRes.data.stats.total_revenue), baseRev + priceA + priceB, 'Dashboard revenue must increase by sum of both orders');

        // Verify recentOrders contains both codeB and codeA
        const recentCodes = midStatsRes.data.recentOrders.map(o => o.order_code);
        assert.ok(recentCodes.includes(codeA), 'recentOrders must contain Order A');
        assert.ok(recentCodes.includes(codeB), 'recentOrders must contain Order B');

        // 5. Cancel Order A
        await api.cancelOrder(codeA);

        // 6. Verify Dashboard revenue re-sync excludes cancelled order A
        const finalStatsRes = await api.getDashboardStats();
        assert.equal(Number(finalStatsRes.data.stats.total_revenue), baseRev + priceB, 'Revenue after cancelling Order A must only include Order B');

        // Cleanup stock
        await db.setProductStock(1, stock1);
        await db.setProductStock(2, stock2);
    });

    // =========================================================================
    // Pairwise Scenario 3: Multi-Customer Isolation
    // =========================================================================
    test('Pairwise 3: Multi-Customer Isolation: Customer A Orders vs Customer B Orders in Account Sync', async () => {
        const p = await db.getProduct(1);
        const initialStock = Number(p.stock_quantity);

        const orderA = await api.createOrder({
            customerId: 2,
            recipientName: 'Isolated Customer A',
            recipientPhone: '0907000004',
            shippingAddress: '201 Account Way, Dist 2',
            items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
        });
        const codeA = orderA.data.orderCode || (orderA.data.order && orderA.data.order.orderCode);
        createdOrderCodes.push(codeA);

        const orderB = await api.createOrder({
            customerId: 3,
            recipientName: 'Isolated Customer B',
            recipientPhone: '0907000005',
            shippingAddress: '202 Account Way, Dist 2',
            items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
        });
        const codeB = orderB.data.orderCode || (orderB.data.order && orderB.data.order.orderCode);
        createdOrderCodes.push(codeB);

        // Fetch Customer A orders
        const resA = await api.getOrders(2);
        const listA = resA.data.orders || resA.data || [];
        const hasAInA = listA.some(o => o.order_code === codeA);
        const hasBInA = listA.some(o => o.order_code === codeB);
        assert.ok(hasAInA, 'Customer A orders must include Order A');
        assert.equal(hasBInA, false, 'Customer A orders must NOT include Order B (Security Scoping Violation)');

        // Fetch Customer B orders
        const resB = await api.getOrders(3);
        const listB = resB.data.orders || resB.data || [];
        const hasBInB = listB.some(o => o.order_code === codeB);
        const hasAInB = listB.some(o => o.order_code === codeA);
        assert.ok(hasBInB, 'Customer B orders must include Order B');
        assert.equal(hasAInB, false, 'Customer B orders must NOT include Order A (Security Scoping Violation)');

        await db.setProductStock(1, initialStock);
    });

    // =========================================================================
    // Pairwise Scenario 4: Multi-Item Order Cancellation Stock Restoration
    // =========================================================================
    test('Pairwise 4: Multi-Item Order (Multiple Distinct Products) -> Cancel -> All Distinct Products Restored', async () => {
        const p1 = await db.getProduct(1);
        const p2 = await db.getProduct(2);
        const p3 = await db.getProduct(3);
        const s1 = Number(p1.stock_quantity);
        const s2 = Number(p2.stock_quantity);
        const s3 = Number(p3.stock_quantity);

        const orderRes = await api.createOrder({
            customerId: 2,
            recipientName: 'Multi-Product Restorer',
            recipientPhone: '0907000006',
            shippingAddress: '301 Multi Ave, Dist 3',
            items: [
                { productId: 1, quantity: 2, unitPrice: Number(p1.price) },
                { productId: 2, quantity: 1, unitPrice: Number(p2.price) },
                { productId: 3, quantity: 3, unitPrice: Number(p3.price) }
            ]
        });
        assert.equal(orderRes.status, 201);
        const orderCode = orderRes.data.orderCode || (orderRes.data.order && orderRes.data.order.orderCode);
        createdOrderCodes.push(orderCode);

        // Check stocks decremented
        const midP1 = await db.getProduct(1);
        const midP2 = await db.getProduct(2);
        const midP3 = await db.getProduct(3);
        assert.equal(Number(midP1.stock_quantity), s1 - 2);
        assert.equal(Number(midP2.stock_quantity), s2 - 1);
        assert.equal(Number(midP3.stock_quantity), s3 - 3);

        // Cancel order
        const cancelRes = await api.cancelOrder(orderCode);
        assert.equal(cancelRes.status, 200);

        // Verify ALL stocks restored
        const endP1 = await db.getProduct(1);
        const endP2 = await db.getProduct(2);
        const endP3 = await db.getProduct(3);
        assert.equal(Number(endP1.stock_quantity), s1, 'Product 1 stock must be fully restored');
        assert.equal(Number(endP2.stock_quantity), s2, 'Product 2 stock must be fully restored');
        assert.equal(Number(endP3.stock_quantity), s3, 'Product 3 stock must be fully restored');
    });

    // =========================================================================
    // Pairwise Scenario 5: Tracking Lookup Interoperability
    // =========================================================================
    test('Pairwise 5: Tracking Lookup: Query by Order Code vs Query by Tracking Code returns consistent data', async () => {
        const p = await db.getProduct(1);
        const initialStock = Number(p.stock_quantity);

        const orderRes = await api.createOrder({
            customerId: 2,
            recipientName: 'Interoperability Buyer',
            recipientPhone: '0907000007',
            shippingAddress: '401 Interop Way, Dist 4',
            items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
        });
        const orderCode = orderRes.data.orderCode || (orderRes.data.order && orderRes.data.order.orderCode);
        const trackingCode = orderRes.data.trackingCode || (orderRes.data.order && orderRes.data.order.trackingCode);
        createdOrderCodes.push(orderCode);

        const byTracking = await api.getTracking(trackingCode);
        const byOrder = await api.getTracking(orderCode);

        assert.equal(byTracking.status, 200);
        assert.equal(byOrder.status, 200);

        const dataT = byTracking.data.data || byTracking.data;
        const dataO = byOrder.data.data || byOrder.data;

        const codeT = dataT.order_code || (dataT.order && dataT.order.order_code);
        const codeO = dataO.order_code || (dataO.order && dataO.order.order_code);
        assert.equal(codeT, codeO, 'Both lookup queries must resolve to the identical order_code');

        const trackT = dataT.tracking_code || (dataT.shipment && dataT.shipment.tracking_code);
        const trackO = dataO.tracking_code || (dataO.shipment && dataO.shipment.tracking_code);
        assert.equal(trackT, trackO, 'Both lookup queries must resolve to the identical tracking_code');

        await db.setProductStock(1, initialStock);
    });
});
