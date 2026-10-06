const api = require('./helpers/api');
const db = require('./helpers/db');
const { ensureServer, stopServer } = require('./helpers/server');

async function runEmpiricalStress() {
    console.log('=== Starting Empirical Stress Harness for Milestone 2 ===\n');
    const serverInfo = await ensureServer();
    console.log(`Server status: ${serverInfo.baseUrl} (Spawned: ${serverInfo.spawned})`);

    const orderCodesToCleanup = [];

    try {
        // -------------------------------------------------------------
        // TEST 1: Concurrency Test on POST /api/orders
        // -------------------------------------------------------------
        console.log('\n--- TEST 1: Concurrency Test on POST /api/orders ---');
        // Let's test product 2 (Lamborghini Huracán) with 5 stock
        await db.setProductStock(2, 5);
        const p2Before = await db.getProduct(2);
        console.log(`Product 2 initial stock: ${p2Before.stock_quantity}`);

        // Launch 10 simultaneous orders competing for 5 items (each ordering 1 item)
        console.log('Dispatching 10 simultaneous order requests for 1 item each (Stock = 5)...');
        const orderPromises = Array.from({ length: 10 }, (_, i) => {
            return api.createOrder({
                customerId: 2,
                recipientName: `Concurrency Stress User ${i + 1}`,
                recipientPhone: `090123456${i}`,
                shippingAddress: `Stress Address ${i + 1}`,
                items: [{ productId: 2, quantity: 1, unitPrice: 980000 }]
            }).then(res => ({ idx: i + 1, ...res }));
        });

        const orderResults = await Promise.all(orderPromises);

        let successOrders = 0;
        let rejectedOrders = 0;
        let deadlockOr500Errors = 0;
        const statusBreakdown = {};

        for (const res of orderResults) {
            statusBreakdown[res.status] = (statusBreakdown[res.status] || 0) + 1;
            if (res.status === 201) {
                successOrders++;
                const code = res.data?.orderCode || res.data?.order?.orderCode;
                if (code) orderCodesToCleanup.push(code);
            } else if (res.status === 400) {
                rejectedOrders++;
            } else {
                deadlockOr500Errors++;
                console.error(`Request ${res.idx} returned unexpected status ${res.status}:`, res.data);
            }
        }

        const p2After = await db.getProduct(2);
        console.log('Results of 10 simultaneous orders:');
        console.log(`- Status breakdown:`, statusBreakdown);
        console.log(`- Successes (HTTP 201): ${successOrders}`);
        console.log(`- Rejections (HTTP 400): ${rejectedOrders}`);
        console.log(`- Unexpected / 500 / Deadlock errors: ${deadlockOr500Errors}`);
        console.log(`- Final Product 2 stock in DB: ${p2After.stock_quantity}`);

        const concurrencyPass = (successOrders === 5) && 
                                (rejectedOrders === 5) && 
                                (deadlockOr500Errors === 0) && 
                                (Number(p2After.stock_quantity) === 0);

        console.log(`TEST 1 RESULT: ${concurrencyPass ? 'PASSED ✅' : 'FAILED ❌'}`);

        // Reset Product 2 stock
        await db.setProductStock(2, 20);

        // -------------------------------------------------------------
        // TEST 2: Multi-Item Deadlock Stress Test (Cross-Product Deadlock)
        // -------------------------------------------------------------
        console.log('\n--- TEST 2: Cross-Product Concurrency & Lock Ordering Stress ---');
        // User A orders Product 3 then Product 4; User B orders Product 4 then Product 3
        await db.setProductStock(3, 10);
        await db.setProductStock(4, 10);

        console.log('Dispatching concurrent reversed-order multi-item orders to test deterministic lock ordering (prevent Error 1205)...');
        const crossOrderPromises = [];
        for (let i = 0; i < 6; i++) {
            // Even requests order [3, 4], Odd requests order [4, 3]
            const items = (i % 2 === 0) 
                ? [{ productId: 3, quantity: 1, unitPrice: 1750000 }, { productId: 4, quantity: 1, unitPrice: 4500000 }]
                : [{ productId: 4, quantity: 1, unitPrice: 4500000 }, { productId: 3, quantity: 1, unitPrice: 1750000 }];
            
            crossOrderPromises.push(api.createOrder({
                customerId: 2,
                recipientName: `Cross Lock User ${i + 1}`,
                recipientPhone: `090222222${i}`,
                shippingAddress: `Lock Order Address ${i + 1}`,
                items
            }).then(res => ({ idx: i + 1, ...res })));
        }

        const crossResults = await Promise.all(crossOrderPromises);
        let crossDeadlocks = 0;
        let crossSuccess = 0;
        for (const res of crossResults) {
            if (res.status === 201) {
                crossSuccess++;
                const code = res.data?.orderCode || res.data?.order?.orderCode;
                if (code) orderCodesToCleanup.push(code);
            } else {
                const strData = JSON.stringify(res.data);
                if (strData.includes('1205') || strData.includes('deadlock') || res.status === 500) {
                    crossDeadlocks++;
                    console.error(`Deadlock / 500 detected on request ${res.idx}:`, res.data);
                }
            }
        }

        console.log(`Cross-product orders: Success=${crossSuccess}, Deadlocks=${crossDeadlocks}`);
        console.log(`TEST 2 RESULT: ${crossDeadlocks === 0 ? 'PASSED ✅ (No Deadlocks)' : 'FAILED ❌ (Deadlocks detected)'}`);

        // Reset stock for products 3 & 4
        await db.setProductStock(3, 8);
        await db.setProductStock(4, 10);

        // -------------------------------------------------------------
        // TEST 3: Idempotency Test on PUT /api/orders/:code/status (Sequential Double Cancel)
        // -------------------------------------------------------------
        console.log('\n--- TEST 3: Idempotency Test (Sequential Cancel) ---');
        await db.setProductStock(7, 12);
        const order1Res = await api.createOrder({
            customerId: 2,
            recipientName: 'Idempotency User Seq',
            recipientPhone: '0903333333',
            shippingAddress: 'Idempotent Seq Ave',
            items: [{ productId: 7, quantity: 2, unitPrice: 980000 }]
        });
        const orderCode1 = order1Res.data?.orderCode || order1Res.data?.order?.orderCode;
        orderCodesToCleanup.push(orderCode1);

        const stockAfterOrder = await db.getProduct(7);
        console.log(`Product 7 stock after order of 2: ${stockAfterOrder.stock_quantity} (Expected 10)`);

        console.log('Sending First Cancel...');
        const cancel1Res = await api.cancelOrder(orderCode1);
        console.log(`First cancel status: ${cancel1Res.status}, data:`, cancel1Res.data);

        const stockAfterCancel1 = await db.getProduct(7);
        console.log(`Product 7 stock after first cancel: ${stockAfterCancel1.stock_quantity} (Expected 12)`);

        console.log('Sending Second Cancel on already cancelled order...');
        const cancel2Res = await api.cancelOrder(orderCode1);
        console.log(`Second cancel status: ${cancel2Res.status}, data:`, cancel2Res.data);

        const stockAfterCancel2 = await db.getProduct(7);
        console.log(`Product 7 stock after second cancel: ${stockAfterCancel2.stock_quantity} (Expected 12)`);

        const seqPass = (cancel1Res.status === 200) && 
                        (cancel2Res.status === 400) && 
                        (Number(stockAfterCancel1.stock_quantity) === 12) && 
                        (Number(stockAfterCancel2.stock_quantity) === 12);

        console.log(`TEST 3 RESULT: ${seqPass ? 'PASSED ✅' : 'FAILED ❌'}`);

        // -------------------------------------------------------------
        // TEST 4: Rapid Concurrent Cancel on Same Order (Race Condition / Deadlock Test)
        // -------------------------------------------------------------
        console.log('\n--- TEST 4: Rapid Concurrent Cancel on Same Order ---');
        await db.setProductStock(8, 10);
        const order2Res = await api.createOrder({
            customerId: 2,
            recipientName: 'Rapid Cancel Race User',
            recipientPhone: '0904444444',
            shippingAddress: 'Rapid Race Blvd',
            items: [{ productId: 8, quantity: 3, unitPrice: 1500000 }]
        });
        const orderCode2 = order2Res.data?.orderCode || order2Res.data?.order?.orderCode;
        orderCodesToCleanup.push(orderCode2);

        const stockAfterOrder2 = await db.getProduct(8);
        console.log(`Product 8 stock after order of 3: ${stockAfterOrder2.stock_quantity} (Expected 7)`);

        console.log('Firing 5 SIMULTANEOUS cancel requests on the exact same order...');
        const startTime = Date.now();
        const cancelPromises = Array.from({ length: 5 }, (_, i) => {
            return api.cancelOrder(orderCode2).then(res => ({ idx: i + 1, ...res }));
        });

        const cancelResults = await Promise.all(cancelPromises);
        const duration = Date.now() - startTime;
        console.log(`5 concurrent cancels completed in ${duration}ms`);

        let cancel200Count = 0;
        let cancel400Count = 0;
        let cancel500OrDeadlockCount = 0;
        const cancelStatusBreakdown = {};

        for (const cr of cancelResults) {
            cancelStatusBreakdown[cr.status] = (cancelStatusBreakdown[cr.status] || 0) + 1;
            if (cr.status === 200) {
                cancel200Count++;
            } else if (cr.status === 400) {
                cancel400Count++;
            } else {
                cancel500OrDeadlockCount++;
                console.error(`Concurrent cancel ${cr.idx} returned unexpected status ${cr.status}:`, cr.data);
            }
        }

        const finalStock8 = await db.getProduct(8);
        console.log('Results of 5 rapid cancels:');
        console.log(`- Status breakdown:`, cancelStatusBreakdown);
        console.log(`- First cancel success (HTTP 200): ${cancel200Count}`);
        console.log(`- Subsequent rejections (HTTP 400): ${cancel400Count}`);
        console.log(`- 500 / Deadlock / Timeout: ${cancel500OrDeadlockCount}`);
        console.log(`- Final Product 8 stock in DB: ${finalStock8.stock_quantity} (Initial was 10)`);

        const rapidCancelPass = (cancel200Count === 1) && 
                                (cancel400Count === 4) && 
                                (cancel500OrDeadlockCount === 0) && 
                                (Number(finalStock8.stock_quantity) === 10);

        console.log(`TEST 4 RESULT: ${rapidCancelPass ? 'PASSED ✅' : 'FAILED ❌'}`);

        // Restore initial stocks
        await db.setProductStock(7, 12);
        await db.setProductStock(8, 10);

    } finally {
        console.log('\nCleaning up created test orders...');
        await db.cleanupOrders(orderCodesToCleanup);
        await db.close();
        if (serverInfo.spawned) {
            stopServer();
        }
    }
}

runEmpiricalStress().catch(err => {
    console.error('Fatal error in stress harness:', err);
    process.exit(1);
});
