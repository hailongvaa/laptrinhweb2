const { spawn } = require('child_process');
const path = require('path');
const { ensureServer, stopServer } = require('./helpers/server');
const { resetSeedStock, close: closeDb } = require('./helpers/db');

const testFiles = [
    { tier: 'Tier 1: Feature Coverage (AC1-AC7)', file: 'test/tier1-features.test.js' },
    { tier: 'Tier 2: Boundary, Edge Cases & Concurrency', file: 'test/tier2-boundary.test.js' },
    { tier: 'Tier 3: Pairwise Combinations', file: 'test/tier3-pairwise.test.js' },
    { tier: 'Tier 4: Application Scenarios (Journeys)', file: 'test/tier4-application.test.js' }
];

async function runTestFile(file) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, ['--test', file], {
            cwd: path.resolve(__dirname, '..'),
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', d => { stdout += d.toString(); });
        child.stderr.on('data', d => { stderr += d.toString(); });

        child.on('close', code => {
            // Extract pass, fail, total counts from node --test summary
            const passMatch = stdout.match(/ℹ pass (\d+)/);
            const failMatch = stdout.match(/ℹ fail (\d+)/);
            const totalMatch = stdout.match(/ℹ tests (\d+)/);
            const durationMatch = stdout.match(/ℹ duration_ms ([\d.]+)/);

            const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
            const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
            const total = totalMatch ? parseInt(totalMatch[1], 10) : (passed + failed);
            const duration = durationMatch ? parseFloat(durationMatch[1]) : 0;

            resolve({
                file,
                exitCode: code,
                passed,
                failed,
                total,
                duration,
                stdout,
                stderr
            });
        });
    });
}

async function main() {
    console.log('='.repeat(70));
    console.log('   CarModelStore E2E 4-Tier Test Runner (Node.js v24 Native)');
    console.log('='.repeat(70));

    console.log('\n[1/3] Checking server & database status...');
    const serverInfo = await ensureServer();
    console.log(`[INFO] Server active at: ${serverInfo.baseUrl} (Spawned: ${serverInfo.spawned})`);
    await resetSeedStock();
    console.log('[INFO] Product stock reset to authoritative seed values.');

    console.log('\n[2/3] Executing 4-Tier Test Suites in sequence...\n');
    const results = [];

    for (const suite of testFiles) {
        process.stdout.write(`Running ${suite.tier} [${suite.file}]... `);
        const startTime = Date.now();
        const res = await runTestFile(suite.file);
        const elapsed = (Date.now() - startTime);
        results.push({ ...suite, ...res, elapsed });
        if (res.exitCode === 0) {
            console.log(`PASSED (${res.passed}/${res.total} tests in ${elapsed}ms)`);
        } else {
            console.log(`BASELINE FAILURES DETECTED (${res.passed} passed, ${res.failed} failed of ${res.total} in ${elapsed}ms)`);
        }
    }

    console.log('\n[3/3] Execution Summary Table:');
    console.log('-'.repeat(80));
    console.log(
        'Tier / Test Suite'.padEnd(46) +
        'Total'.padStart(8) +
        'Pass'.padStart(8) +
        'Fail'.padStart(8) +
        'Time (ms)'.padStart(10)
    );
    console.log('-'.repeat(80));

    let grandTotal = 0;
    let grandPass = 0;
    let grandFail = 0;

    for (const r of results) {
        grandTotal += r.total;
        grandPass += r.passed;
        grandFail += r.failed;

        console.log(
            r.tier.padEnd(46) +
            String(r.total).padStart(8) +
            String(r.passed).padStart(8) +
            String(r.failed).padStart(8) +
            String(Math.round(r.duration || r.elapsed)).padStart(10)
        );
    }

    console.log('-'.repeat(80));
    console.log(
        'TOTAL'.padEnd(46) +
        String(grandTotal).padStart(8) +
        String(grandPass).padStart(8) +
        String(grandFail).padStart(8)
    );
    console.log('='.repeat(80));

    const passRate = ((grandPass / grandTotal) * 100).toFixed(1);
    console.log(`\nOverall Baseline Pass Rate: ${grandPass}/${grandTotal} (${passRate}%)`);
    if (grandFail > 0) {
        console.log(`Identified ${grandFail} expected baseline failures scheduled for resolution in M1/M2/M3.`);
    }

    await closeDb();
    if (serverInfo.spawned) {
        stopServer();
    }
}

main().catch(err => {
    console.error('Fatal error in test runner:', err);
    process.exit(1);
});
