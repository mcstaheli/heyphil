import pool from './db.js';
import { checkRevokeLogin, checkSetAdmin } from './access-rules.js';

// ========== LOGIN ACCESS ==========
// Who can authenticate at all (checked in the Google OAuth verify
// callback in index.js) - separate from hasAppAccess above, which is
// per-Labs-app access for someone who can ALREADY log in. Used to be a
// hardcoded ALLOWED_EMAILS array in index.js requiring a code change and
// redeploy to add anyone; moved to the database so it's editable from
// Settings -> Team instead (per request).

export async function isEmailAllowedToLogin(email) {
  const result = await pool.query('SELECT 1 FROM allowed_emails WHERE email = $1', [email]);
  return result.rows.length > 0;
}

// Everyone who can log in, with whether they're an admin: [{ email, isAdmin }].
export async function listAllowedEmails() {
  const result = await pool.query('SELECT email, is_admin FROM allowed_emails ORDER BY email');
  return result.rows.map(row => ({ email: row.email, isAdmin: !!row.is_admin }));
}

// Admins can change who can log in and who's an admin (requireAdmin in
// auth-middleware.js checks this on every request).
export async function isAdmin(email) {
  const result = await pool.query('SELECT 1 FROM allowed_emails WHERE email = $1 AND is_admin', [email]);
  return result.rows.length > 0;
}

export async function allowEmailLogin(email) {
  await pool.query('INSERT INTO allowed_emails (email) VALUES ($1) ON CONFLICT (email) DO NOTHING', [email]);
}

// A guard refused the change (access-rules.js) - the route turns it into a 409.
export class AccessRuleError extends Error {}

// Runs fn(client, target, adminCount) in a transaction holding a lock on
// every admin row (and the target row), so concurrent revokes/demotions
// can't each see "another admin remains" and together leave none. Also
// re-checks, under that lock, that the person acting is STILL an admin -
// requireAdmin ran before the lock, so an admin demoted in between would
// otherwise get one more change through (e.g. re-promoting themselves).
async function withAdminLock(actorEmail, targetEmail, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const admins = await client.query('SELECT email FROM allowed_emails WHERE is_admin FOR UPDATE');
    const actor = (actorEmail || '').trim().toLowerCase();
    if (!admins.rows.some((row) => row.email === actor)) {
      throw new AccessRuleError('Only admins can change who has access.');
    }
    const target = await client.query('SELECT email, is_admin FROM allowed_emails WHERE email = $1 FOR UPDATE', [targetEmail]);
    const result = await fn(client, target.rows[0] || null, admins.rows.length);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// false if there was no such login. Throws AccessRuleError if a guard
// refuses (revoking your own login, or the last admin).
export async function revokeEmailLogin(actorEmail, email) {
  return withAdminLock(actorEmail, email, async (client, target, adminCount) => {
    if (!target) return false;
    const reason = checkRevokeLogin({ actorEmail, targetEmail: email, targetIsAdmin: target.is_admin, adminCount });
    if (reason) throw new AccessRuleError(reason);
    await client.query('DELETE FROM allowed_emails WHERE email = $1', [email]);
    return true;
  });
}

// false if that email can't log in (grant login first). Throws
// AccessRuleError if it would demote the last admin.
export async function setAdmin(actorEmail, email, makeAdmin) {
  return withAdminLock(actorEmail, email, async (client, target, adminCount) => {
    if (!target) return false;
    const reason = checkSetAdmin({ makeAdmin, targetIsAdmin: target.is_admin, adminCount });
    if (reason) throw new AccessRuleError(reason);
    await client.query('UPDATE allowed_emails SET is_admin = $2 WHERE email = $1', [email, !!makeAdmin]);
    return true;
  });
}

export async function hasAppAccess(email, appKey) {
  const result = await pool.query(
    'SELECT 1 FROM app_access WHERE email = $1 AND app_key = $2',
    [email, appKey]
  );
  return result.rows.length > 0;
}

export function requireAppAccess(appKey) {
  return async (req, res, next) => {
    try {
      const allowed = await hasAppAccess(req.user.email, appKey);
      if (!allowed) {
        return res.status(403).json({ error: 'Access denied' });
      }
      next();
    } catch (error) {
      console.error('App access check failed:', error.message);
      res.status(500).json({ error: 'Access check failed' });
    }
  };
}
