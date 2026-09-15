import pool from './db.js';

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
