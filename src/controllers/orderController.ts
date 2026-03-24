import { Request, Response } from 'express';
import { query, queryOne, withTransaction } from '../config/database';
import { logger } from '../utils/logger';

const generateOrderNumber = (): string => {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `ORD-${dateStr}-${random}`;
};

export const getOrders = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 20, search, status, date_from, date_to } = req.query;
    const businessId = req.user!.business_id;
    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'WHERE o.business_id = $1';
    const params: any[] = [businessId];
    let idx = 2;

    if (search) {
      whereClause += ` AND (o.order_number ILIKE $${idx} OR c.first_name ILIKE $${idx} OR c.phone ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }
    if (status) { whereClause += ` AND o.status = $${idx}`; params.push(status); idx++; }
    if (date_from) { whereClause += ` AND o.created_at >= $${idx}`; params.push(date_from); idx++; }
    if (date_to) { whereClause += ` AND o.created_at <= $${idx}`; params.push(date_to); idx++; }

    const [countResult] = await query(
      `SELECT COUNT(*) as total FROM orders o LEFT JOIN customers c ON o.customer_id = c.id ${whereClause}`,
      params
    );

    const orders = await query(
      `SELECT o.*,
              c.first_name || ' ' || COALESCE(c.last_name, '') as customer_name,
              c.phone as customer_phone,
              u.first_name || ' ' || u.last_name as cashier_name
       FROM orders o
       LEFT JOIN customers c ON o.customer_id = c.id
       LEFT JOIN users u ON o.cashier_id = u.id
       ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      data: orders,
      meta: { page: Number(page), limit: Number(limit), total: Number(countResult.total), total_pages: Math.ceil(Number(countResult.total) / Number(limit)) },
    });
  } catch (error) {
    logger.error('Get orders error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
};

export const getOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const order = await queryOne(
      `SELECT o.*, c.first_name, c.last_name, c.phone as customer_phone, c.email as customer_email,
              u.first_name as cashier_first_name, u.last_name as cashier_last_name
       FROM orders o
       LEFT JOIN customers c ON o.customer_id = c.id
       LEFT JOIN users u ON o.cashier_id = u.id
       WHERE o.id = $1 AND o.business_id = $2`,
      [req.params.id, req.user!.business_id]
    );

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    const items = await query('SELECT * FROM order_items WHERE order_id = $1', [order.id]);
    const payments = await query('SELECT * FROM payments WHERE order_id = $1', [order.id]);

    res.json({ success: true, data: { ...order, items, payments } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch order' });
  }
};

export const createOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const businessId = req.user!.business_id;
    const cashierId = req.user!.id;
    const { customer_id, items, discount_amount = 0, tip_amount = 0, notes, table_number } = req.body;

    if (!items || items.length === 0) {
      res.status(400).json({ success: false, message: 'Order must have at least one item' });
      return;
    }

    const order = await withTransaction(async (client) => {
      // Get business tax rate
      const [business] = await client.query('SELECT tax_rate FROM businesses WHERE id = $1', [businessId]);
      const taxRate = Number(business.rows[0]?.tax_rate || 16) / 100;

      let subtotal = 0;
      const orderItems = [];

      // Process items
      for (const item of items) {
        const [product] = await client.query(
          'SELECT * FROM products WHERE id = $1 AND business_id = $2',
          [item.product_id, businessId]
        );

        if (!product.rows[0]) throw new Error(`Product ${item.product_id} not found`);

        const prod = product.rows[0];
        const itemTaxRate = prod.tax_rate !== null ? Number(prod.tax_rate) / 100 : taxRate;
        const unitPrice = Number(item.unit_price || prod.price);
        const quantity = Number(item.quantity);
        const itemDiscount = Number(item.discount_amount || 0);
        const taxableAmount = (unitPrice * quantity) - itemDiscount;
        const itemTax = taxableAmount * itemTaxRate;
        const itemTotal = taxableAmount + itemTax;

        subtotal += unitPrice * quantity;
        orderItems.push({ ...prod, quantity, unit_price: unitPrice, discount_amount: itemDiscount, tax_amount: itemTax, total_amount: itemTotal, notes: item.notes });

        // Update inventory
        if (prod.track_inventory) {
          await client.query(
            'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
            [quantity, prod.id]
          );
          await client.query(
            `INSERT INTO inventory_logs (business_id, product_id, user_id, type, quantity_change, quantity_before, quantity_after)
             VALUES ($1, $2, $3, 'sale', $4, $5, $6)`,
            [businessId, prod.id, cashierId, -quantity, prod.stock_quantity, prod.stock_quantity - quantity]
          );
        }
      }

      const taxAmount = orderItems.reduce((sum, i) => sum + i.tax_amount, 0);
      const totalAmount = subtotal + taxAmount - Number(discount_amount) + Number(tip_amount);

      const orderNumber = generateOrderNumber();
      const [newOrder] = await client.query(
        `INSERT INTO orders (business_id, order_number, customer_id, cashier_id, subtotal, tax_amount, discount_amount, tip_amount, total_amount, notes, table_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [businessId, orderNumber, customer_id, cashierId, subtotal, taxAmount, discount_amount, tip_amount, totalAmount, notes, table_number]
      );

      const orderId = newOrder.rows[0].id;

      // Insert order items
      for (const item of orderItems) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, discount_amount, tax_amount, total_amount, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [orderId, item.id, item.name, item.quantity, item.unit_price, item.discount_amount, item.tax_amount, item.total_amount, item.notes]
        );
      }

      // Update customer stats
      if (customer_id) {
        await client.query(
          `UPDATE customers SET visit_count = visit_count + 1, total_spent = total_spent + $1, updated_at = NOW()
           WHERE id = $2`,
          [totalAmount, customer_id]
        );
      }

      return { ...newOrder.rows[0], items: orderItems };
    });

    res.status(201).json({ success: true, data: order, message: 'Order created successfully' });
  } catch (error) {
    logger.error('Create order error:', error);
    res.status(500).json({ success: false, message: 'Failed to create order' });
  }
};

export const updateOrderStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status } = req.body;
    const order = await queryOne(
      `UPDATE orders SET status = $1, updated_at = NOW()
       WHERE id = $2 AND business_id = $3 RETURNING *`,
      [status, req.params.id, req.user!.business_id]
    );

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found' });
      return;
    }

    res.json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update order' });
  }
};

export const getCustomers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const businessId = req.user!.business_id;
    const offset = (Number(page) - 1) * Number(limit);

    let where = 'WHERE business_id = $1';
    const params: any[] = [businessId];

    if (search) {
      where += ` AND (first_name ILIKE $2 OR last_name ILIKE $2 OR phone ILIKE $2 OR email ILIKE $2)`;
      params.push(`%${search}%`);
    }

    const [countResult] = await query(`SELECT COUNT(*) as total FROM customers ${where}`, params);
    const customers = await query(
      `SELECT * FROM customers ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      data: customers,
      meta: { page: Number(page), limit: Number(limit), total: Number(countResult.total) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch customers' });
  }
};

export const createCustomer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { first_name, last_name, email, phone, address, city, notes } = req.body;
    const customer = await queryOne(
      `INSERT INTO customers (business_id, first_name, last_name, email, phone, address, city, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user!.business_id, first_name, last_name, email, phone, address, city, notes]
    );

    res.status(201).json({ success: true, data: customer });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to create customer' });
  }
};
