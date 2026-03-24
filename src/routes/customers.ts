import { Router } from 'express';
import { query } from '../utils/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/', async (req: AuthRequest, res) => {
  const { search } = req.query;
  let sql = 'SELECT * FROM customers WHERE business_id=$1';
  const params: any[] = [req.user!.businessId];
  if (search) { sql += ' AND (name ILIKE $2 OR phone ILIKE $2 OR email ILIKE $2)'; params.push(`%${search}%`); }
  sql += ' ORDER BY name';
  const result = await query(sql, params);
  res.json(result.rows);
});

router.post('/', async (req: AuthRequest, res) => {
  const { name, email, phone, address, notes } = req.body;
  try {
    const result = await query('INSERT INTO customers (business_id,name,email,phone,address,notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [req.user!.businessId, name, email, phone, address, notes]);
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req: AuthRequest, res) => {
  const { name, email, phone, address, notes } = req.body;
  const result = await query('UPDATE customers SET name=$1,email=$2,phone=$3,address=$4,notes=$5,updated_at=NOW() WHERE id=$6 AND business_id=$7 RETURNING *', [name, email, phone, address, notes, req.params.id, req.user!.businessId]);
  res.json(result.rows[0]);
});

export default router;
