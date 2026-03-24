import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../utils/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

router.post('/register', async (req, res) => {
  const { businessName, email, password, phone, name } = req.body;
  try {
    logger.info("REG STARTED 1")
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length) return res.status(409).json({ error: 'Email already registered' });
    logger.info("REG STARTED 2")
    const hash = await bcrypt.hash(password, 12);
    const bizResult = await query(
      'INSERT INTO businesses (name, email, phone) VALUES ($1, $2, $3) RETURNING id',
      [businessName, email, phone]
    );
    logger.info("REG BUSINESS INSERT STARTED")
    const businessId = bizResult.rows[0].id;

    const userResult = await query(
      'INSERT INTO users (business_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role',
      [businessId, name, email, hash, 'owner']
    );

    // Seed default categories
    const cats = [['Food & Beverage','#f59e0b','🍔'],['Electronics','#3b82f6','📱'],['Clothing','#ec4899','👕'],['Services','#10b981','⚡'],['General','#6366f1','📦']];
    for (const [cname, color, icon] of cats) {
      await query('INSERT INTO categories (business_id, name, color, icon) VALUES ($1,$2,$3,$4)', [businessId, cname, color, icon]);
    }

    const token = jwt.sign(
      { id: userResult.rows[0].id, email, role: 'owner', businessId },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );
    res.status(201).json({ token, user: userResult.rows[0], businessId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
    logger.error(err.message);
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await query('SELECT u.*, b.name as business_name FROM users u JOIN businesses b ON u.business_id = b.id WHERE u.email = $1 AND u.is_active = true', [email]);
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, businessId: user.business_id },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );
    const { password_hash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', authenticate, async (req: AuthRequest, res) => {
  try {
    const result = await query('SELECT u.id, u.name, u.email, u.role, b.name as business_name, b.currency, b.tax_rate, b.mpesa_paybill FROM users u JOIN businesses b ON u.business_id = b.id WHERE u.id = $1', [req.user!.id]);
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
