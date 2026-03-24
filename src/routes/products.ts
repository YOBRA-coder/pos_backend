import { Router } from 'express';
import { query } from '../utils/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/', async (req: AuthRequest, res) => {
  const { search, category, active } = req.query;
  let sql = `SELECT p.*, c.name as category_name, c.color as category_color 
    FROM products p LEFT JOIN categories c ON p.category_id = c.id 
    WHERE p.business_id = $1`;
  const params: any[] = [req.user!.businessId];
  
  if (active !== 'false') { sql += ` AND p.is_active = true`; }
  if (category) { sql += ` AND p.category_id = $${params.length+1}`; params.push(category); }
  if (search) { sql += ` AND (p.name ILIKE $${params.length+1} OR p.sku ILIKE $${params.length+1})`; params.push(`%${search}%`); }
  sql += ' ORDER BY p.name';
  
  const result = await query(sql, params);
  res.json(result.rows);
});

router.post('/', async (req: AuthRequest, res) => {
  const { name, description, sku, price, cost_price, stock_quantity, category_id, low_stock_threshold, track_inventory, tax_exempt } = req.body;
  try {
    const result = await query(
      `INSERT INTO products (business_id, name, description, sku, price, cost_price, stock_quantity, category_id, low_stock_threshold, track_inventory, tax_exempt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.user!.businessId, name, description, sku, price, cost_price||0, stock_quantity||0, category_id, low_stock_threshold||10, track_inventory??true, tax_exempt??false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req: AuthRequest, res) => {
  const { name, description, price, cost_price, stock_quantity, category_id, is_active, low_stock_threshold, tax_exempt } = req.body;
  try {
    const result = await query(
      `UPDATE products SET name=$1, description=$2, price=$3, cost_price=$4, stock_quantity=$5, category_id=$6, is_active=$7, low_stock_threshold=$8, tax_exempt=$9, updated_at=NOW()
       WHERE id=$10 AND business_id=$11 RETURNING *`,
      [name, description, price, cost_price, stock_quantity, category_id, is_active, low_stock_threshold, tax_exempt, req.params.id, req.user!.businessId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Product not found' });
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req: AuthRequest, res) => {
  await query('UPDATE products SET is_active=false WHERE id=$1 AND business_id=$2', [req.params.id, req.user!.businessId]);
  res.json({ success: true });
});

export default router;
