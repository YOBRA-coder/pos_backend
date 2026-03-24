import { Router } from 'express';
import { query, getClient } from '../utils/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

const generateOrderNumber = () => `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2,4).toUpperCase()}`;

router.get('/', async (req: AuthRequest, res) => {
  const { page = 1, limit = 50, status, from, to } = req.query;
  const offset = (Number(page)-1) * Number(limit);
  let sql = `SELECT o.*, u.name as cashier_name, c.name as customer_name 
    FROM orders o LEFT JOIN users u ON o.cashier_id = u.id LEFT JOIN customers c ON o.customer_id = c.id
    WHERE o.business_id=$1`;
  const params: any[] = [req.user!.businessId];
  if (status) { sql += ` AND o.status=$${params.length+1}`; params.push(status); }
  if (from) { sql += ` AND o.created_at >= $${params.length+1}`; params.push(from); }
  if (to) { sql += ` AND o.created_at <= $${params.length+1}`; params.push(to); }
  sql += ` ORDER BY o.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
  params.push(limit, offset);
  
  const result = await query(sql, params);
  const count = await query('SELECT COUNT(*) FROM orders WHERE business_id=$1', [req.user!.businessId]);
  res.json({ orders: result.rows, total: Number(count.rows[0].count) });
});

router.get('/:id', async (req: AuthRequest, res) => {
  const order = await query('SELECT o.*, c.name as customer_name FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.id=$1 AND o.business_id=$2', [req.params.id, req.user!.businessId]);
  if (!order.rows.length) return res.status(404).json({ error: 'Order not found' });
  const items = await query('SELECT * FROM order_items WHERE order_id=$1', [req.params.id]);
  const payments = await query('SELECT * FROM payments WHERE order_id=$1', [req.params.id]);
  res.json({ ...order.rows[0], items: items.rows, payments: payments.rows });
});

router.post('/', async (req: AuthRequest, res) => {
  const { items, customer_id, discount_amount = 0, notes, tax_rate = 16 } = req.body;
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    const subtotal = items.reduce((sum: number, item: any) => sum + (item.unit_price * item.quantity), 0);
    const discounted = subtotal - discount_amount;
    const tax_amount = discounted * (tax_rate / 100);
    const total = discounted + tax_amount;
    const orderNumber = generateOrderNumber();
    
    const order = await client.query(
      'INSERT INTO orders (order_number,business_id,customer_id,cashier_id,subtotal,tax_amount,discount_amount,total,notes,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [orderNumber, req.user!.businessId, customer_id||null, req.user!.id, subtotal, tax_amount, discount_amount, total, notes, 'pending']
    );
    const orderId = order.rows[0].id;
    
    for (const item of items) {
      await client.query(
        'INSERT INTO order_items (order_id,product_id,product_name,quantity,unit_price,discount_amount,total) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [orderId, item.product_id, item.product_name, item.quantity, item.unit_price, item.discount_amount||0, item.unit_price * item.quantity]
      );
      // Update inventory
      const prod = await client.query('SELECT stock_quantity, track_inventory FROM products WHERE id=$1', [item.product_id]);
      if (prod.rows[0]?.track_inventory) {
        const before = prod.rows[0].stock_quantity;
        const after = before - item.quantity;
        await client.query('UPDATE products SET stock_quantity=$1 WHERE id=$2', [after, item.product_id]);
        await client.query('INSERT INTO inventory_transactions (product_id,type,quantity_change,quantity_before,quantity_after,reference_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [item.product_id, 'sale', -item.quantity, before, after, orderId, req.user!.id]);
      }
    }
    
    if (customer_id) {
      await client.query('UPDATE customers SET total_spent=total_spent+$1, loyalty_points=loyalty_points+$2 WHERE id=$3', [total, Math.floor(total/100), customer_id]);
    }
    
    await client.query('COMMIT');
    res.status(201).json(order.rows[0]);
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.patch('/:id/status', async (req: AuthRequest, res) => {
  const { status } = req.body;
  const result = await query('UPDATE orders SET status=$1,updated_at=NOW() WHERE id=$2 AND business_id=$3 RETURNING *', [status, req.params.id, req.user!.businessId]);
  res.json(result.rows[0]);
});

export default router;
