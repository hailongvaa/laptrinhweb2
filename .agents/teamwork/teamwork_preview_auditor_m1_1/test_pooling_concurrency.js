const path = require('path');

async function testPool() {
  console.log('--- Testing Server Export & Conditional Listen ---');
  const serverPath = path.resolve(__dirname, '../../../car-store-backend/server');
  const app = require(serverPath);
  if (typeof app !== 'function') {
    throw new Error('server.js did not export Express application function!');
  }
  console.log('PASS: server.js exports Express application function.');

  const { getDb } = require(serverPath);
  if (typeof getDb !== 'function') {
    throw new Error('server.js did not export getDb function!');
  }
  console.log('PASS: server.js exports getDb function.');

  console.log('--- Testing Concurrency Singleton Guarantee ---');
  // Trigger 10 concurrent requests simultaneously before pool is connected
  const promises = Array.from({ length: 10 }, (_, i) => getDb());
  const results = await Promise.all(promises);

  const firstPool = results[0].pool;
  for (let i = 1; i < results.length; i++) {
    if (results[i].pool !== firstPool) {
      throw new Error(`Pool reference mismatch at caller ${i}: not a singleton!`);
    }
  }
  console.log('PASS: All 10 concurrent callers received identical ConnectionPool instance!');

  // Check global.__poolPromise
  if (!global.__poolPromise) {
    throw new Error('global.__poolPromise is null or undefined!');
  }
  const globalResult = await global.__poolPromise;
  if (globalResult.pool !== firstPool) {
    throw new Error('global.__poolPromise does not match returned pool!');
  }
  console.log('PASS: global.__poolPromise is a genuine Promise caching the singleton pool.');

  // Test sequential call reuse
  const seqResult = await getDb();
  if (seqResult.pool !== firstPool) {
    throw new Error('Subsequent getDb call created new pool instead of reusing cached singleton!');
  }
  console.log('PASS: Subsequent sequential getDb call reuses existing active pool.');

  // Clean close
  await firstPool.close();
  console.log('Closed pool for reconnection test.');

  // Test reconnection after pool closure
  const newResult = await getDb();
  if (!newResult.pool.connected) {
    throw new Error('Reconnected pool is not connected!');
  }
  console.log('PASS: getDb successfully created fresh pool after pool was closed/disconnected.');

  await newResult.pool.close();
  console.log('ALL POOL CONCURRENCY AND RECONNECTION TESTS PASSED!');
}

testPool().catch(e => {
  console.error('FAIL in testPool:', e);
  process.exit(1);
});
