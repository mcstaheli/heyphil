#!/usr/bin/env node
// Boots the server and polls /health until it responds, then exits 0/1.
// This is the smallest available pass/fail signal — see CLAUDE.md.
import { spawn } from 'child_process';

const PORT = process.env.PORT || 3002;
const TIMEOUT_MS = 10000;

const child = spawn('node', ['server/index.js'], {
  env: {
    ...process.env,
    PORT,
    // Missing OAuth creds crash the server at boot (see CLAUDE.md gotchas) —
    // supply placeholders so the smoke test can still check the rest boots.
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || 'smoke-test-client-id',
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || 'smoke-test-client-secret',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (d) => { output += d; });
child.stderr.on('data', (d) => { output += d; });

let settled = false;

function fail(msg) {
  if (settled) return;
  settled = true;
  console.error(`❌ smoke test failed: ${msg}`);
  console.error(output);
  child.kill();
  process.exit(1);
}

function succeed() {
  if (settled) return;
  settled = true;
  console.log('✅ smoke test passed: server booted and /health responded');
  child.kill();
  process.exit(0);
}

child.on('exit', (code, signal) => {
  if (settled) return;
  if (signal) return fail(`server process was killed by signal ${signal}`);
  if (code !== 0) return fail(`server process exited early with code ${code}`);
});

const deadline = Date.now() + TIMEOUT_MS;

async function poll() {
  if (settled) return;
  const remaining = deadline - Date.now();
  if (remaining <= 0) return fail('timed out waiting for /health');
  try {
    const res = await fetch(`http://localhost:${PORT}/health`, {
      signal: AbortSignal.timeout(Math.min(remaining, 3000)),
    });
    if (!res.ok) return fail(`/health returned ${res.status}`);
    const body = await res.json();
    if (body.database === false) return fail('/health reports database unreachable');
    return succeed();
  } catch {
    setTimeout(poll, 300);
  }
}

setTimeout(poll, 500);
