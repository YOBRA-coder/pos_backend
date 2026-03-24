import { Pool } from 'pg';
import { logger } from './logger';

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'pos_db',
  user: 'yobby',
  password: 'yobby@24',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
});

export const query = async (text: string, params?: any[]) => {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 1000) logger.warn('Slow query detected', { text, duration });
  return res;
};

export const getClient = () => pool.connect();
export default pool;
