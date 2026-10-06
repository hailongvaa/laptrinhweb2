const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const api = require('./helpers/api');
const db = require('./helpers/db');
const { ensureServer, stopServer } = require('./helpers/server');

describe('Tier 4: Real-World Application Scenarios (User Journeys)', () => {
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
    // Scenario 1: Guest Checkout & Parcel Tracking Journey
    // =========================================================================
    test('Scenario 1: Complete Guest Checkout & Public Parcel Tracking Journey', async () => {
        // Step 1: Guest browses product catalog
        const catalogRes = await api.getProducts({ scale: '1:18' });
        assert.equal(catalogRes.status, 200, 'Catalog browsing must succeed');
        assert.ok(Array.isArray(catalogRes.data), 'Catalog should return array of products');
        assert.ok(catalogRes.data.length > 0, 'Catalog should have at least 1 model car');

        // Select available product
        const selectedCar = catalogRes.data.find(p => Number(p.stock_quantity) > 0);
        assert.ok(selectedCar, 'Must find a car with stock > 0');
        const initialStock = Number(selectedCar.stock_quantity);

        // Step 2: Guest fills checkout modal
        const checkoutPayload = {
            customerId: 1, // Guest default ID
            recipientName: 'Khách Hàng Vãng Lai',
            recipientPhone: '0988776655',
            shippingAddress: '88 Ly Tu Trong, Phuong Ben Thanh, Quan 1, TP.HCM',
            items: [
                { productId: selectedCar.id, quantity: 1, unitPrice: Number(selectedCar.price) }
            ]
        };

        const orderRes = await api.createOrder(checkoutPayload);
        assert.equal(orderRes.status, 201, 'Guest order checkout must succeed');
        const orderCode = orderRes.data.orderCode || (orderRes.data.order && orderRes.data.order.orderCode);
        const trackingCode = orderRes.data.trackingCode || (orderRes.data.order && orderRes.data.order.trackingCode);
        assert.ok(orderCode && trackingCode, 'Must receive both orderCode and trackingCode');
        createdOrderCodes.push(orderCode);

        // Step 3: Guest opens contact.html tracking tool
        const trackRes = await api.getTracking(trackingCode);
        assert.equal(trackRes.status, 200, 'Tracking parcel must succeed');
        const trackData = trackRes.data.data || trackRes.data;

        // Verify tracking details
        const carrier = trackData.carrier || (trackData.shipment && trackData.shipment.carrier);
        const location = trackData.current_location || (trackData.shipment && trackData.shipment.current_location);
        assert.ok(carrier, 'Must display shipping carrier');
        assert.ok(location, 'Must display parcel current location');

        // Restore stock
        await db.setProductStock(selectedCar.id, initialStock);
    });

    // =========================================================================
    // Scenario 2: Registered Customer Lifecycle Journey
    // =========================================================================
    test('Scenario 2: Registered Customer Lifecycle Journey (Register -> Login -> Order -> Account History)', async () => {
        const timestamp = Date.now();
        const testEmail = `journey_customer_${timestamp}@test.com`;
        const testPassword = 'Password123!';
        const testFullName = 'Nguyen Van Journey';

        // Step 1: Customer registers account
        const regRes = await api.register({
            fullname: testFullName,
            email: testEmail,
            password: testPassword,
            phone: '0933112233',
            address: '45 Vo Thi Sau, Q3, TP.HCM'
        });
        assert.equal(regRes.status, 201, 'Registration must succeed with 201');
        assert.equal(regRes.data.success, true);
        const registeredUserId = regRes.data.user.id;
        assert.ok(registeredUserId, 'Must return new user ID');

        // Step 2: Customer logs in
        const loginRes = await api.login({
            email: testEmail,
            password: testPassword
        });
        assert.equal(loginRes.status, 200, 'Login must succeed with 200');
        assert.equal(loginRes.data.success, true);
        assert.equal(loginRes.data.user.email, testEmail);

        // Step 3: Customer checkouts a model car
        const p = await db.getProduct(1);
        const initialStock = Number(p.stock_quantity);

        const orderRes = await api.createOrder({
            customerId: registeredUserId,
            recipientName: testFullName,
            recipientPhone: '0933112233',
            shippingAddress: '45 Vo Thi Sau, Q3, TP.HCM',
            items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
        });
        assert.equal(orderRes.status, 201, 'Customer order creation must succeed');
        const orderCode = orderRes.data.orderCode || (orderRes.data.order && orderRes.data.order.orderCode);
        createdOrderCodes.push(orderCode);

        // Step 4: Customer views account history (account.html sync)
        const accountRes = await api.getOrders(registeredUserId);
        assert.equal(accountRes.status, 200, 'Account order history query must succeed');
        const ordersList = accountRes.data.orders || accountRes.data || [];
        assert.equal(ordersList.length, 1, 'Customer must see exactly 1 order in history');
        assert.equal(ordersList[0].order_code, orderCode, 'Order code must match created order');
        assert.equal(Number(ordersList[0].total_amount), Number(p.price));

        // Restore stock
        await db.setProductStock(1, initialStock);
    });

    // =========================================================================
    // Scenario 3: Inventory Depletion & Out-of-Stock Recovery Journey
    // =========================================================================
    test('Scenario 3: Inventory Depletion & Out-of-Stock Recovery Journey', async () => {
        const p = await db.getProduct(2);
        const initialStock = Number(p.stock_quantity);

        // Set stock to 2
        await db.setProductStock(2, 2);

        // Step 1: Shopper attempts to order 5 units (exceeding stock)
        const failedAttempt = await api.createOrder({
            customerId: 2,
            recipientName: 'Greedy Shopper',
            recipientPhone: '0919191919',
            shippingAddress: '99 Greedy Way, Dist 5',
            items: [{ productId: 2, quantity: 5, unitPrice: Number(p.price) }]
        });
        assert.equal(failedAttempt.status, 400, 'Excessive quantity must be rejected');
        assert.equal(failedAttempt.data.success, false);

        // Step 2: Shopper adjusts cart quantity to available stock (2 units)
        const successfulRecovery = await api.createOrder({
            customerId: 2,
            recipientName: 'Wise Shopper',
            recipientPhone: '0919191919',
            shippingAddress: '99 Greedy Way, Dist 5',
            items: [{ productId: 2, quantity: 2, unitPrice: Number(p.price) }]
        });
        assert.equal(successfulRecovery.status, 201, 'Adjusted order within stock limits must succeed');
        const orderCode = successfulRecovery.data.orderCode || (successfulRecovery.data.order && successfulRecovery.data.order.orderCode);
        createdOrderCodes.push(orderCode);

        // Verify stock is now 0
        const depletedP = await db.getProduct(2);
        assert.equal(Number(depletedP.stock_quantity), 0, 'Stock must now be depleted to 0');

        // Step 3: Another shopper tries to order 1 unit -> immediately rejected
        const lateAttempt = await api.createOrder({
            customerId: 3,
            recipientName: 'Late Shopper',
            recipientPhone: '0919191920',
            shippingAddress: '100 Late St, Dist 5',
            items: [{ productId: 2, quantity: 1, unitPrice: Number(p.price) }]
        });
        assert.equal(lateAttempt.status, 400, 'Subsequent order on 0 stock must be blocked');

        // Restore initial stock
        await db.setProductStock(2, initialStock);
    });

    // =========================================================================
    // Scenario 4: Customer Order Cancellation & Inventory Return Journey
    // =========================================================================
    test('Scenario 4: Customer Order Cancellation & Inventory Return for Next Shopper', async () => {
        const p = await db.getProduct(1);
        const initialStock = Number(p.stock_quantity);

        // Set stock to 1
        await db.setProductStock(1, 1);

        // Customer 2 purchases the last car
        const orderRes = await api.createOrder({
            customerId: 2,
            recipientName: 'First Buyer',
            recipientPhone: '0922000001',
            shippingAddress: '10 First Ave, Dist 6',
            items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
        });
        assert.equal(orderRes.status, 201);
        const orderCode = orderRes.data.orderCode || (orderRes.data.order && orderRes.data.order.orderCode);
        const trackingCode = orderRes.data.trackingCode || (orderRes.data.order && orderRes.data.order.trackingCode);
        createdOrderCodes.push(orderCode);

        // Stock is now 0
        const stockAfterFirst = await db.getProduct(1);
        assert.equal(Number(stockAfterFirst.stock_quantity), 0);

        // Customer 3 tries to buy -> blocked
        const blockedRes = await api.createOrder({
            customerId: 3,
            recipientName: 'Waiting Buyer',
            recipientPhone: '0922000002',
            shippingAddress: '11 Waiting St, Dist 6',
            items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
        });
        assert.equal(blockedRes.status, 400);

        // Customer 2 cancels the order
        const cancelRes = await api.cancelOrder(orderCode);
        assert.equal(cancelRes.status, 200, 'Cancellation must succeed');

        // Verify account history shows cancelled
        const accountRes = await api.getOrders(2);
        const orders = accountRes.data.orders || accountRes.data || [];
        const thisOrder = orders.find(o => o.order_code === orderCode);
        assert.ok(thisOrder);
        assert.equal(thisOrder.order_status, 'cancelled');

        // Verify tracking shows cancelled
        const trackRes = await api.getTracking(trackingCode);
        const trackData = trackRes.data.data || trackRes.data;
        const shipStatus = trackData.shipping_status || (trackData.shipment && trackData.shipment.shipping_status);
        assert.equal(shipStatus, 'cancelled');

        // Stock restored to 1 -> Customer 3 can now purchase!
        const successBuyer3 = await api.createOrder({
            customerId: 3,
            recipientName: 'Lucky Buyer',
            recipientPhone: '0922000003',
            shippingAddress: '12 Lucky Blvd, Dist 6',
            items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
        });
        assert.equal(successBuyer3.status, 201, 'Restored stock must allow second buyer to complete purchase');
        createdOrderCodes.push(successBuyer3.data.orderCode || (successBuyer3.data.order && successBuyer3.data.order.orderCode));

        // Restore initial stock
        await db.setProductStock(1, initialStock);
    });

    // =========================================================================
    // Scenario 5: Admin Order Processing Pipeline Journey
    // =========================================================================
    test('Scenario 5: Admin Order Processing Pipeline (Pending -> Shipping -> Delivered)', async () => {
        const p = await db.getProduct(1);
        const initialStock = Number(p.stock_quantity);

        // 1. Customer places order
        const orderRes = await api.createOrder({
            customerId: 2,
            recipientName: 'Pipeline Recipient',
            recipientPhone: '0933445566',
            shippingAddress: '70 Pipeline Way, Dist 7',
            items: [{ productId: 1, quantity: 1, unitPrice: Number(p.price) }]
        });
        assert.equal(orderRes.status, 201);
        const orderCode = orderRes.data.orderCode || (orderRes.data.order && orderRes.data.order.orderCode);
        const trackingCode = orderRes.data.trackingCode || (orderRes.data.order && orderRes.data.order.trackingCode);
        createdOrderCodes.push(orderCode);

        // 2. Admin inspects dashboard stats
        const dashRes = await api.getDashboardStats();
        assert.equal(dashRes.status, 200);
        const topOrder = dashRes.data.recentOrders[0];
        assert.equal(topOrder.order_code, orderCode, 'New order must be visible at top of admin dashboard');

        // 3. Admin advances fulfillment status to "shipping"
        const shipRes = await api.updateOrderStatus(orderCode, 'shipping');
        assert.equal(shipRes.status, 200);

        // Customer tracks package -> must show "in_transit"
        const trackShip = await api.getTracking(trackingCode);
        const dataShip = trackShip.data.data || trackShip.data;
        const statusInTransit = dataShip.shipping_status || (dataShip.shipment && dataShip.shipment.shipping_status);
        assert.equal(statusInTransit, 'in_transit', 'Shipment status must transition to in_transit');

        // 4. Admin marks order as "delivered"
        const deliverRes = await api.updateOrderStatus(orderCode, 'delivered');
        assert.equal(deliverRes.status, 200);

        // Customer tracks package -> must show "delivered"
        const trackDelivered = await api.getTracking(trackingCode);
        const dataDelivered = trackDelivered.data.data || trackDelivered.data;
        const statusDelivered = dataDelivered.shipping_status || (dataDelivered.shipment && dataDelivered.shipment.shipping_status);
        assert.equal(statusDelivered, 'delivered', 'Shipment status must transition to delivered');

        // Restore initial stock
        await db.setProductStock(1, initialStock);
    });
});
