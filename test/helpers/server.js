const { spawn } = require('child_process');
const { API_BASE_URL, BACKEND_DIR } = require('./config');

let serverProcess = null;

async function checkHealth(url) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1500);
        const res = await fetch(`${url}/api/health`, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
            const data = await res.json();
            return data && (data.status === 'online' || data.success === true);
        }
        return false;
    } catch {
        return false;
    }
}

async function ensureServer() {
    const isRunning = await checkHealth(API_BASE_URL);
    if (isRunning) {
        return { baseUrl: API_BASE_URL, spawned: false };
    }

    // Server is not running, spawn it
    serverProcess = spawn('node', ['server.js'], {
        cwd: BACKEND_DIR,
        stdio: 'pipe',
        env: { ...process.env, PORT: '5000' }
    });

    serverProcess.stdout.on('data', (d) => {
        // optionally log during debugging
    });

    serverProcess.stderr.on('data', (d) => {
        // optionally log errors
    });

    // Poll until healthy
    const startTime = Date.now();
    const timeoutMs = 12000;
    while (Date.now() - startTime < timeoutMs) {
        await new Promise(r => setTimeout(r, 400));
        const ok = await checkHealth(API_BASE_URL);
        if (ok) {
            return { baseUrl: API_BASE_URL, spawned: true, childProcess: serverProcess };
        }
    }

    throw new Error(`Server failed to start within ${timeoutMs}ms at ${API_BASE_URL}`);
}

function stopServer() {
    if (serverProcess) {
        try {
            serverProcess.kill('SIGTERM');
        } catch {
            // ignore
        }
        serverProcess = null;
    }
}

process.on('exit', () => {
    stopServer();
});

module.exports = {
    ensureServer,
    stopServer,
    checkHealth
};
