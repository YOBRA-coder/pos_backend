import { Router } from 'express';
import { query } from '../utils/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/', async (req: AuthRequest, res) => {
  const result = await query('SELECT * FROM categories WHERE business_id=$1 ORDER BY sort_order, name', [req.user!.businessId]);
  res.json(result.rows);
});

router.post('/', async (req: AuthRequest, res) => {
  const { name, color, icon } = req.body;
  const result = await query('INSERT INTO categories (business_id,name,color,icon) VALUES ($1,$2,$3,$4) RETURNING *', [req.user!.businessId, name, color||'#6366f1', icon||'📦']);
  res.status(201).json(result.rows[0]);
});

router.put('/:id', async (req: AuthRequest, res) => {
  const { name, color, icon } = req.body;
  const result = await query('UPDATE categories SET name=$1,color=$2,icon=$3 WHERE id=$4 AND business_id=$5 RETURNING *', [name, color, icon, req.params.id, req.user!.businessId]);
  res.json(result.rows[0]);
});

router.delete('/:id', async (req: AuthRequest, res) => {
  await query('UPDATE products SET category_id=NULL WHERE category_id=$1', [req.params.id]);
  await query('DELETE FROM categories WHERE id=$1 AND business_id=$2', [req.params.id, req.user!.businessId]);
  res.json({ success: true });
});

export default router;
