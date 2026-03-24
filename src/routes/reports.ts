import { Router } from 'express';
import { query } from '../utils/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/dashboard', async (req: AuthRequest, res) => {
  const bid = req.user!.businessId;
  const today = new Date().toISOString().split('T')[0];
  
  const [todaySales, weekSales, monthSales, topProducts, paymentMethods, recentOrders] = await Promise.all([
    query(`SELECT COUNT(*) as count, COALESCE(SUM(total),0) as revenue FROM orders WHERE business_id=$1 AND status='completed' AND DATE(created_at)=CURRENT_DATE`, [bid]),
    query(`SELECT COUNT(*) as count, COALESCE(SUM(total),0) as revenue FROM orders WHERE business_id=$1 AND status='completed' AND created_at >= NOW()-INTERVAL '7 days'`, [bid]),
    query(`SELECT COUNT(*) as count, COALESCE(SUM(total),0) as revenue FROM orders WHERE business_id=$1 AND status='completed' AND created_at >= NOW()-INTERVAL '30 days'`, [bid]),
    query(`SELECT oi.product_name, SUM(oi.quantity) as qty, SUM(oi.total) as revenue FROM order_items oi JOIN orders o ON oi.order_id=o.id WHERE o.business_id=$1 AND o.status='completed' AND o.created_at >= NOW()-INTERVAL '30 days' GROUP BY oi.product_name ORDER BY revenue DESC LIMIT 5`, [bid]),
    query(`SELECT payment_method, COUNT(*) as count, SUM(amount) as total FROM payments p JOIN orders o ON p.order_id=o.id WHERE o.business_id=$1 AND p.status='completed' AND p.created_at >= NOW()-INTERVAL '30 days' GROUP BY payment_method`, [bid]),
    query(`SELECT o.*, c.name as customer_name FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE o.business_id=$1 ORDER BY o.created_at DESC LIMIT 10`, [bid])
  ]);

  // Daily revenue last 7 days
  const dailyRevenue = await query(`
    SELECT DATE(created_at) as date, COALESCE(SUM(total),0) as revenue, COUNT(*) as orders
    FROM orders WHERE business_id=$1 AND status='completed' AND created_at >= NOW()-INTERVAL '7 days'
    GROUP BY DATE(created_at) ORDER BY date`, [bid]);

  res.json({
    today: todaySales.rows[0],
    week: weekSales.rows[0],
    month: monthSales.rows[0],
    topProducts: topProducts.rows,
    paymentMethods: paymentMethods.rows,
    recentOrders: recentOrders.rows,
    dailyRevenue: dailyRevenue.rows
  });
});

router.get('/sales', async (req: AuthRequest, res) => {
  const { from, to, group_by = 'day' } = req.query;
  const fromDate = from || new Date(Date.now() - 30*24*60*60*1000).toISOString();
  const toDate = to || new Date().toISOString();
  
  const result = await query(`
    SELECT DATE_TRUNC($1, created_at) as period, COUNT(*) as orders, COALESCE(SUM(total),0) as revenue, COALESCE(SUM(tax_amount),0) as tax
    FROM orders WHERE business_id=$2 AND status='completed' AND created_at BETWEEN $3 AND $4
    GROUP BY period ORDER BY period`, [group_by, req.user!.businessId, fromDate, toDate]);
  res.json(result.rows);
});

export default router;
