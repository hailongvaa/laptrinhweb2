const { spawn } = require('child_process');
const path = require('path');
const { ensureServer, stopServer } = require('./helpers/server');

async function main() {
    console.log('[1/2] Ensuring server is online...');
    const serverInfo = await ensureServer();
    console.log('[INFO] Server active at:', serverInfo.baseUrl, '(spawned:', serverInfo.spawned, ')');

    console.log('[2/2] Running empirical challenge test suite...');
    const child = spawn(process.execPath, ['--test', 'test/empirical-challenger-m2-2.test.js'], {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit'
    });

    child.on('close', (code) => {
        console.log('[INFO] Test run completed with code:', code);
        if (serverInfo.spawned) {
            stopServer();
        }
        process.exit(code);
    });
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
