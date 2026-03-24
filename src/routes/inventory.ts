import { Router } from 'express';
import { query } from '../utils/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/low-stock', async (req: AuthRequest, res) => {
  const result = await query('SELECT * FROM products WHERE business_id=$1 AND track_inventory=true AND stock_quantity <= low_stock_threshold AND is_active=true ORDER BY stock_quantity', [req.user!.businessId]);
  res.json(result.rows);
});

router.post('/adjust', async (req: AuthRequest, res) => {
  const { product_id, quantity_change, type, notes } = req.body;
  try {
    const prod = await query('SELECT stock_quantity FROM products WHERE id=$1 AND business_id=$2', [product_id, req.user!.businessId]);
    if (!prod.rows.length) return res.status(404).json({ error: 'Product not found' });
    
    const before = prod.rows[0].stock_quantity;
    const after = before + quantity_change;
    await query('UPDATE products SET stock_quantity=$1,updated_at=NOW() WHERE id=$2', [after, product_id]);
    const tx = await query('INSERT INTO inventory_transactions (product_id,type,quantity_change,quantity_before,quantity_after,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [product_id, type||'adjustment', quantity_change, before, after, notes, req.user!.id]);
    res.json(tx.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/transactions/:productId', async (req: AuthRequest, res) => {
  const result = await query('SELECT it.*, u.name as created_by_name FROM inventory_transactions it LEFT JOIN users u ON it.created_by=u.id WHERE it.product_id=$1 ORDER BY it.created_at DESC LIMIT 50', [req.params.productId]);
  res.json(result.rows);
});

export default router;
