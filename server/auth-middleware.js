import jwt from 'jsonwebtoken';

// SESSION_SECRET signs every login token. This repo is public, so the old
// fallback string would let anyone forge a token for any email - in
// production (NODE_ENV=production, or running on Railway) refuse to start
// without a real one. The fallback is only for local development.
const DEV_FALLBACK_SECRET = 'dev-secret-change-in-production';
// Strings published in this repo - as good as no secret at all.
const PUBLIC_SECRETS = [DEV_FALLBACK_SECRET, 'your-random-secret-string' /* .env.example */];
const isProduction = process.env.NODE_ENV === 'production'
  || !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_ENVIRONMENT_NAME;
if (isProduction && (!process.env.SESSION_SECRET || PUBLIC_SECRETS.includes(process.env.SESSION_SECRET))) {
  throw new Error('SESSION_SECRET must be set in production - refusing to start with the development fallback.');
}

export const JWT_SECRET = process.env.SESSION_SECRET || DEV_FALLBACK_SECRET;

export const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Admin-only routes (who can log in, who's an admin). Use after
// requireAuth. Checks the database on every request - never a claim in the
// JWT - so revoking someone's admin takes effect immediately. Fails closed:
// a database error is a 500, not a pass. `isAdmin` is injectable for tests.
export function makeRequireAdmin(isAdmin) {
  return async (req, res, next) => {
    if (!req.user || !req.user.email) {
      return res.status(401).json({ error: 'Not signed in' });
    }
    try {
      if (!(await isAdmin(req.user.email.toLowerCase()))) {
        return res.status(403).json({ error: 'Only admins can change who has access.' });
      }
      return next();
    } catch (error) {
      console.error('Admin check failed:', error.message);
      return res.status(500).json({ error: 'Admin check failed' });
    }
  };
}

// permissions.js is loaded lazily so importing this module doesn't open a
// database connection.
export const requireAdmin = makeRequireAdmin(async (email) => (await import('./permissions.js')).isAdmin(email));
