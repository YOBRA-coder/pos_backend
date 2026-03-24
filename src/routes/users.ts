import { Router } from 'express';
import { query } from '../utils/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const router = Router();
router.use(authenticate);

router.post('/', async (req: AuthRequest, res) => {
    const { businessName, email, password, phone, name } = req.body;
    try {
      const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length) return res.status(409).json({ error: 'Email already registered' });
  
      const hash = await bcrypt.hash(password, 12);
      const bizResult = await query(
        'INSERT INTO businesses (name, email, phone) VALUES ($1, $2, $3) RETURNING id',
        [businessName, email, phone]
      );
      const businessId = bizResult.rows[0].id;
  
      const userResult = await query(
        'INSERT INTO users (business_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role',
        [req.user?.businessId, name, email, hash, 'owner']
      );
  
      const token = jwt.sign(
        { id: userResult.rows[0].id, email, role: 'owner', businessId },
        process.env.JWT_SECRET || 'secret',
        { expiresIn: '7d' }
      );
      res.status(201).json({ token, user: userResult.rows[0], businessId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  
  router.get('/', async (req: AuthRequest, res) => {
      const { search } = req.query;
      let sql = 'SELECT * FROM users WHERE business_id=$1';
      const params: any[] = [req.user!.businessId];
      if (search) { sql += ' AND (name ILIKE $2 OR phone ILIKE $2 OR email ILIKE $2)'; params.push(`%${search}%`); }
      sql += ' ORDER BY name';
      const result = await query(sql, params);
      res.json(result.rows);
    });

    router.put('/:id', async (req: AuthRequest, res) => {
      const { phone,email,name } = req.body;
      console.log(phone,email,name);
      console.log(req.body);
      try {
        const result = await query(
          `UPDATE users SET email=$1, role=$2, phone=$3 updated_at=NOW()
           WHERE id=$4 AND business_id=$5 RETURNING *`,
          [email, name, phone, req.params.id, req.user!.businessId]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Product not found' });
        res.json(result.rows[0]);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    router.delete('/:id', async (req: AuthRequest, res) => {
      await query('UPDATE users SET role=$1 WHERE id=$2 AND business_id=$3', ['cashier',req.params.id, req.user!.businessId]);
      res.json({ success: true });
    });

  export default router;