const { spawn } = require('child_process');
const path = require('path');

const serverFile = path.resolve(__dirname, '../../../car-store-backend/server.js');
const server = spawn('node', [serverFile], {
  env: { ...process.env, PORT: '5001' } // run on port 5001 to avoid potential conflict
});

let serverOutput = '';
server.stdout.on('data', d => { serverOutput += d.toString(); });
server.stderr.on('data', d => { serverOutput += d.toString(); });

async function checkHealth() {
  // Give server 2.5s to boot
  await new Promise(r => setTimeout(r, 2500));

  try {
    const res = await fetch('http://localhost:5001/api/health');
    const data = await res.json();
    console.log('Health API response:', JSON.stringify(data, null, 2));

    if (data.status !== 'online' || data.database !== 'connected') {
      throw new Error(`Health check failed: status=${data.status}, database=${data.database}`);
    }
    console.log('PASS: Server startup and live health check verified on port 5001.');
  } finally {
    server.kill();
  }
}

checkHealth().then(() => {
  console.log('ALL SERVER STARTUP CHECKS PASSED!');
  process.exit(0);
}).catch(err => {
  console.error('Server check failed:', err.message);
  console.error('Server output was:', serverOutput);
  server.kill();
  process.exit(1);
});
