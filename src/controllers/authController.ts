import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, withTransaction } from '../config/database';
import { logger } from '../utils/logger';

const generateTokens = (user: { id: string; business_id: string; role: string; email: string }) => {
  const accessToken = jwt.sign(
    { id: user.id, business_id: user.business_id, role: user.role, email: user.email },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' } as any
  );

  const refreshToken = jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET || 'refresh_secret',
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' } as any
  );

  return { accessToken, refreshToken };
};

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { business_name, email, password, first_name, last_name, phone } = req.body;

    const existingUser = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser) {
      res.status(409).json({ success: false, message: 'Email already registered' });
      return;
    }
    logger.info("STARTED REGISTRATION");
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await withTransaction(async (client) => {
      const [business] = await client.query(
        `INSERT INTO businesses (name, email, phone) VALUES ($1, $2, $3) RETURNING id`,
        [business_name, email, phone]
      );
      const businessId = business.rows[0].id;
      logger.info("Inserted into business....");
      const [user] = await client.query(
        `INSERT INTO users (business_id, email, password_hash, first_name, last_name, phone, role)
         VALUES ($1, $2, $3, $4, $5, $6, 'admin') RETURNING id, email, role, first_name, last_name, business_id`,
        [businessId, email, passwordHash, first_name, last_name, phone]
      );

      // Create default categories
      await client.query(
        `INSERT INTO categories (business_id, name, color, icon) VALUES 
         ($1, 'General', '#6366f1', 'grid'),
         ($1, 'Food & Beverages', '#f59e0b', 'coffee'),
         ($1, 'Services', '#10b981', 'tool'),
         ($1, 'Electronics', '#3b82f6', 'cpu')`,
        [businessId]
      );

      return user.rows[0];
    });

    const tokens = generateTokens(result);

    await query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [result.id, tokens.refreshToken]
    );

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: {
        user: {
          id: result.id,
          email: result.email,
          first_name: result.first_name,
          last_name: result.last_name,
          role: result.role,
          business_id: result.business_id,
        },
        ...tokens,
      },
    });
    logger.info("ACCOUNT CREATED");
  } catch (error) {
    logger.error('Register error:', error);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    const user = await queryOne(
      `SELECT u.*, b.name as business_name, b.currency, b.tax_rate 
       FROM users u
       JOIN businesses b ON u.business_id = b.id
       WHERE u.email = $1 AND u.is_active = true`,
      [email]
    );

    if (!user) {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
      return;
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
      return;
    }

    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const tokens = generateTokens(user);

    await query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')
       ON CONFLICT (token) DO NOTHING`,
      [user.id, tokens.refreshToken]
    );

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role,
          business_id: user.business_id,
          business_name: user.business_name,
          currency: user.currency,
          tax_rate: user.tax_rate,
        },
        ...tokens,
      },
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
};

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refresh_token } = req.body;

    const stored = await queryOne(
      `SELECT rt.*, u.id as user_id, u.business_id, u.role, u.email
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       WHERE rt.token = $1 AND rt.is_revoked = false AND rt.expires_at > NOW()`,
      [refresh_token]
    );

    if (!stored) {
      res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
      return;
    }

    const tokens = generateTokens({
      id: stored.user_id,
      business_id: stored.business_id,
      role: stored.role,
      email: stored.email,
    });

    await query('UPDATE refresh_tokens SET is_revoked = true WHERE token = $1', [refresh_token]);
    await query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [stored.user_id, tokens.refreshToken]
    );

    res.json({ success: true, data: tokens });
  } catch (error) {
    logger.error('Refresh token error:', error);
    res.status(500).json({ success: false, message: 'Token refresh failed' });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refresh_token } = req.body;
    if (refresh_token) {
      await query('UPDATE refresh_tokens SET is_revoked = true WHERE token = $1', [refresh_token]);
    }
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Logout failed' });
  }
};

export const getMe = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await queryOne(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.role, u.avatar_url, u.last_login,
              b.id as business_id, b.name as business_name, b.currency, b.tax_rate, b.tax_name,
              b.logo_url, b.address, b.phone as business_phone, b.mpesa_shortcode
       FROM users u
       JOIN businesses b ON u.business_id = b.id
       WHERE u.id = $1`,
      [req.user!.id]
    );

    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch user' });
  }
};
