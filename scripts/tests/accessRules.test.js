import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRevokeLogin, checkSetAdmin } from '../../server/access-rules.js';
import { makeRequireAdmin } from '../../server/auth-middleware.js';

// ---- guards ----
test('an admin can revoke someone else\'s login', () => {
  assert.equal(checkRevokeLogin({ actorEmail: 'chad@x.com', targetEmail: 'greg@x.com', targetIsAdmin: false, adminCount: 1 }), null);
});

test('an admin can\'t revoke their own login', () => {
  assert.match(checkRevokeLogin({ actorEmail: 'chad@x.com', targetEmail: 'CHAD@x.com', targetIsAdmin: true, adminCount: 2 }), /your own/);
});

test('the last remaining admin can\'t be removed', () => {
  assert.match(checkRevokeLogin({ actorEmail: 'greg@x.com', targetEmail: 'chad@x.com', targetIsAdmin: true, adminCount: 1 }), /last admin/);
  // ...but an admin can be removed while another admin remains
  assert.equal(checkRevokeLogin({ actorEmail: 'greg@x.com', targetEmail: 'chad@x.com', targetIsAdmin: true, adminCount: 2 }), null);
});

test('making someone an admin is always allowed', () => {
  assert.equal(checkSetAdmin({ targetEmail: 'greg@x.com', makeAdmin: true, targetIsAdmin: false, adminCount: 1 }), null);
});

test('the last admin can\'t be demoted - including demoting yourself', () => {
  assert.match(checkSetAdmin({ targetEmail: 'chad@x.com', makeAdmin: false, targetIsAdmin: true, adminCount: 1 }), /last admin/);
  assert.equal(checkSetAdmin({ targetEmail: 'chad@x.com', makeAdmin: false, targetIsAdmin: true, adminCount: 2 }), null);
});

test('demoting someone who isn\'t an admin is a no-op, not an error', () => {
  assert.equal(checkSetAdmin({ targetEmail: 'greg@x.com', makeAdmin: false, targetIsAdmin: false, adminCount: 1 }), null);
});

// ---- requireAdmin middleware (database lookup injected) ----
function run(middleware, user) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body, nextCalled: false }); },
    };
    middleware({ user }, res, () => resolve({ status: 200, nextCalled: true }));
  });
}

test('requireAdmin: a non-admin gets 403', async () => {
  const mw = makeRequireAdmin(async () => false);
  const r = await run(mw, { email: 'greg@x.com' });
  assert.equal(r.status, 403);
  assert.equal(r.nextCalled, false);
});

test('requireAdmin: an admin passes through', async () => {
  const seen = [];
  const mw = makeRequireAdmin(async (email) => { seen.push(email); return true; });
  const r = await run(mw, { email: 'Chad@X.com' });
  assert.equal(r.nextCalled, true);
  assert.deepEqual(seen, ['chad@x.com']); // looked up (lowercased) on every request, not read from the JWT
});

test('requireAdmin: ignores an isAdmin claim inside the token', async () => {
  const mw = makeRequireAdmin(async () => false);
  const r = await run(mw, { email: 'greg@x.com', isAdmin: true });
  assert.equal(r.status, 403);
});

test('requireAdmin: no user (requireAuth didn\'t run) -> 401', async () => {
  const mw = makeRequireAdmin(async () => true);
  assert.equal((await run(mw, undefined)).status, 401);
});

test('requireAdmin: a database error fails closed (500, not through)', async () => {
  const mw = makeRequireAdmin(async () => { throw new Error('db down'); });
  const r = await run(mw, { email: 'chad@x.com' });
  assert.equal(r.status, 500);
  assert.equal(r.nextCalled, false);
});

// ---- SESSION_SECRET: refuse to start in production without a real one ----
import { spawnSync } from 'node:child_process';

function importAuthMiddleware(env) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(NODE_ENV|RAILWAY_|SESSION_SECRET$)/.test(k)));
  return spawnSync(process.execPath, ['-e', "import('./server/auth-middleware.js').then(() => console.log('started'))"], {
    env: { ...clean, ...env }, encoding: 'utf8',
  });
}

test('production without SESSION_SECRET refuses to start (Railway, or NODE_ENV=production)', () => {
  for (const env of [{ RAILWAY_ENVIRONMENT_NAME: 'production' }, { NODE_ENV: 'production' }]) {
    const r = importAuthMiddleware(env);
    assert.notEqual(r.status, 0, JSON.stringify(env));
    assert.match(r.stderr, /SESSION_SECRET must be set in production/);
  }
});

test('production with a secret published in this repo also refuses (old fallback, .env.example placeholder)', () => {
  for (const secret of ['dev-secret-change-in-production', 'your-random-secret-string']) {
    const r = importAuthMiddleware({ RAILWAY_ENVIRONMENT_NAME: 'production', SESSION_SECRET: secret });
    assert.notEqual(r.status, 0, secret);
  }
});

test('production with a real SESSION_SECRET starts; local dev without one still starts', () => {
  assert.match(importAuthMiddleware({ RAILWAY_ENVIRONMENT_NAME: 'production', SESSION_SECRET: 'x'.repeat(43) }).stdout, /started/);
  assert.match(importAuthMiddleware({}).stdout, /started/);
});
