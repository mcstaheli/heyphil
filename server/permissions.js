import pool from './db.js';

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

export async function listAllowedEmails() {
  const result = await pool.query('SELECT email FROM allowed_emails ORDER BY email');
  return result.rows.map(row => row.email);
}

export async function allowEmailLogin(email) {
  await pool.query('INSERT INTO allowed_emails (email) VALUES ($1) ON CONFLICT (email) DO NOTHING', [email]);
}

export async function revokeEmailLogin(email) {
  const result = await pool.query('DELETE FROM allowed_emails WHERE email = $1', [email]);
  return result.rowCount > 0;
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
