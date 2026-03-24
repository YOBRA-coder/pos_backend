import { Pool } from 'pg';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();
/*
const poolConfig: PoolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'pos_db',
  user: process.env.DB_USER || 'yobby',
  password: process.env.DB_PASSWORD || 'yobby@24',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  min: parseInt(process.env.DB_POOL_MIN || '2'),
  max: parseInt(process.env.DB_POOL_MAX || '20'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
};*/

export const pool = new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on('connect', () => {
  console.log("db connected")
  logger.debug('New database client connected');
});

pool.on('error', (err) => {
  console.log("error")
  logger.error('Unexpected database client error', err);
  process.exit(-1);
});

export const query = async <T = any>(
  text: string,
  params?: any[]
): Promise<T[]> => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug(`Query executed in ${duration}ms: ${text.substring(0, 50)}`);
    return result.rows as T[];
  } catch (error) {
    logger.error('Database query error:', { query: text, error });
    throw error;
  }
};

export const queryOne = async <T = any>(
  text: string,
  params?: any[]
): Promise<T | null> => {
  const rows = await query<T>(text, params);
  return rows[0] || null;
};

export const withTransaction = async <T>(
  callback: (client: any) => Promise<T>
): Promise<T> => {
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
};

export const testConnection = async (): Promise<void> => {
  try {
    const result = await pool.query('SELECT NOW()');
    logger.info(`Database connected: ${result.rows[0].now}`);
  } catch (error) {
    logger.error('Database connection failed:', error);
    throw error;
  }
};
testConnection();
export default pool;
