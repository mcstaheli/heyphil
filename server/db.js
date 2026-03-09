// Database connection and helpers
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20, // Maximum pool size
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 10000, // Return error if connection takes > 10s
});

// Test connection
pool.on('connect', () => {
  console.log('✅ Database connected');
});

pool.on('error', (err) => {
  console.error('❌ Database error:', err);
});

export default pool;

// Helper: Execute query with error handling and retry logic
export async function query(text, params, retries = 2) {
  const start = Date.now();
  let lastError;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await pool.query(text, params);
      const duration = Date.now() - start;
      if (process.env.DEBUG_SQL) {
        console.log('SQL:', { text, duration, rows: res.rowCount });
      }
      if (attempt > 0) {
        console.log(`✅ Query succeeded on retry ${attempt}`);
      }
      return res;
    } catch (error) {
      lastError = error;
      
      // Retry on connection errors
      const isConnectionError = error.code === 'ECONNRESET' || 
                                error.code === 'ENOTFOUND' || 
                                error.code === 'ETIMEDOUT' ||
                                error.code === 'ECONNREFUSED';
      
      if (isConnectionError && attempt < retries) {
        console.warn(`⚠️  Connection error on attempt ${attempt + 1}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1))); // Exponential backoff
        continue;
      }
      
      console.error('SQL Error:', error);
      console.error('Query:', text);
      console.error('Params:', params);
      throw error;
    }
  }
  
  throw lastError;
}

// Helper: Transaction wrapper
export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
