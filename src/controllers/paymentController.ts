import { Request, Response } from 'express';
import axios from 'axios';
import Stripe from 'stripe';
import { query, queryOne, withTransaction } from '../config/database';
import { logger } from '../utils/logger';

// ========= M-PESA SERVICE =========
const getMpesaToken = async (): Promise<string> => {
  const consumerKey = process.env.MPESA_CONSUMER_KEY || '';
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET || '';
  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const url = process.env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
    : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

  const response = await axios.get(url, {
    headers: { Authorization: `Basic ${credentials}` },
  });

  return response.data.access_token;
};

const getMpesaPassword = (shortcode: string, passkey: string): { password: string; timestamp: string } => {
  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
  return { password, timestamp };
};

export const initiateMpesaSTKPush = async (req: Request, res: Response): Promise<void> => {
  try {
    const { order_id, phone, amount } = req.body;
    const businessId = req.user!.business_id;

    // Get business M-Pesa config
    const business = await queryOne('SELECT mpesa_shortcode, mpesa_passkey FROM businesses WHERE id = $1', [businessId]);
    const shortcode = business?.mpesa_shortcode || process.env.MPESA_SHORTCODE || '174379';
    const passkey = business?.mpesa_passkey || process.env.MPESA_PASSKEY || '';

    const formattedPhone = phone.startsWith('+') ? phone.substring(1) : phone.startsWith('0') ? `254${phone.substring(1)}` : phone;

    const token = await getMpesaToken();
    const { password, timestamp } = getMpesaPassword(shortcode, passkey);

    const callbackUrl = process.env.MPESA_CALLBACK_URL || 'https://eryn-semihumanized-willard.ngrok-free.dev/api/v1/payments/mpesa/callback';
    const baseUrl = process.env.MPESA_ENV === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';

    const stkResponse = await axios.post(
      `${baseUrl}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerBuyGoodsOnline',
        Amount: Math.ceil(amount),
        PartyA: formattedPhone,
        PartyB: shortcode,
        PhoneNumber: formattedPhone,
        CallBackURL: callbackUrl,
        AccountReference: order_id || 'POS-Payment',
        TransactionDesc: 'POS Payment',
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const { CheckoutRequestID, MerchantRequestID } = stkResponse.data;

    // Create payment record
    const payment = await queryOne(
      `INSERT INTO payments (business_id, order_id, payment_method, amount, status, mpesa_phone, checkout_request_id, merchant_request_id)
       VALUES ($1, $2, 'mpesa', $3, 'pending', $4, $5, $6) RETURNING *`,
      [businessId, order_id, amount, formattedPhone, CheckoutRequestID, MerchantRequestID]
    );

    res.json({
      success: true,
      data: {
        payment_id: payment!.id,
        checkout_request_id: CheckoutRequestID,
        merchant_request_id: MerchantRequestID,
        message: 'STK Push sent successfully. Check your phone.',
      },
    });
  } catch (error: any) {
    logger.error('M-Pesa STK Push error:', error?.response?.data || error.message);
    res.status(500).json({ success: false, message: 'M-Pesa payment initiation failed', error: error?.response?.data });
  }
};

export const mpesaCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    const { Body } = req.body;
    const stk = Body?.stkCallback;

    if (!stk) {
      res.json({ success: false });
      return;
    }

    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stk;

    if (ResultCode === 0) {
      const metadata = CallbackMetadata?.Item || [];
      const getMeta = (name: string) => metadata.find((i: any) => i.Name === name)?.Value;

      const mpesaCode = getMeta('MpesaReceiptNumber');
      const amount = getMeta('Amount');
      const phone = getMeta('PhoneNumber');

      await withTransaction(async (client) => {
        const [payment] = await client.query(
          `UPDATE payments SET status = 'completed', provider_transaction_id = $1, amount = $2,
           processed_at = NOW(), provider_response = $3, updated_at = NOW()
           WHERE checkout_request_id = $4 RETURNING *`,
          [mpesaCode, amount, JSON.stringify(stk), CheckoutRequestID]
        );

        if (payment.rows[0]?.order_id) {
          await client.query(
            `UPDATE orders SET status = 'completed', payment_method = 'mpesa', updated_at = NOW()
             WHERE id = $1`,
            [payment.rows[0].order_id]
          );
        }
      });
    } else {
      await query(
        `UPDATE payments SET status = 'failed', failed_reason = $1, provider_response = $2, updated_at = NOW()
         WHERE checkout_request_id = $3`,
        [ResultDesc, JSON.stringify(stk), CheckoutRequestID]
      );
    }

    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    logger.error('M-Pesa callback error:', error);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
};

export const checkMpesaStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const payment = await queryOne(
      `SELECT * FROM payments WHERE id = $1 AND business_id = $2`,
      [req.params.payment_id, req.user!.business_id]
    );

    if (!payment) {
      res.status(404).json({ success: false, message: 'Payment not found' });
      return;
    }

    res.json({ success: true, data: { status: payment.status, reference: payment.provider_transaction_id } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to check payment status' });
  }
};

// ========= STRIPE SERVICE =========
const getStripe = (): Stripe => {
  return new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
    apiVersion: '2024-06-20',
  });
};

export const createStripePaymentIntent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { order_id, amount, currency = 'kes' } = req.body;
    const businessId = req.user!.business_id;

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // cents
      currency: currency.toLowerCase(),
      metadata: { order_id, business_id: businessId },
      automatic_payment_methods: { enabled: true },
    });

    const payment = await queryOne(
      `INSERT INTO payments (business_id, order_id, payment_method, amount, status, stripe_payment_intent_id)
       VALUES ($1, $2, 'credit_card', $3, 'pending', $4) RETURNING *`,
      [businessId, order_id, amount, paymentIntent.id]
    );

    res.json({
      success: true,
      data: {
        payment_id: payment!.id,
        client_secret: paymentIntent.client_secret,
        publishable_key: process.env.STRIPE_PUBLISHABLE_KEY,
      },
    });
  } catch (error: any) {
    logger.error('Stripe error:', error);
    res.status(500).json({ success: false, message: 'Card payment initiation failed' });
  }
};

export const stripeWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const stripe = getStripe();
    const sig = req.headers['stripe-signature'] as string;
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || '');
    } catch (err) {
      res.status(400).json({ error: 'Webhook signature failed' });
      return;
    }

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as Stripe.PaymentIntent;
      await withTransaction(async (client) => {
        const [payment] = await client.query(
          `UPDATE payments SET status = 'completed', processed_at = NOW(), updated_at = NOW()
           WHERE stripe_payment_intent_id = $1 RETURNING *`,
          [pi.id]
        );

        if (payment.rows[0]?.order_id) {
          await client.query(
            `UPDATE orders SET status = 'completed', payment_method = 'credit_card', updated_at = NOW()
             WHERE id = $1`,
            [payment.rows[0].order_id]
          );
        }
      });
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('Stripe webhook error:', error);
    res.status(500).json({ success: false });
  }
};

// ========= CASH PAYMENT =========
export const processCashPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { order_id, amount, amount_tendered, payment_method = 'cash' } = req.body;
    const businessId = req.user!.business_id;
    const change = Number(amount_tendered) - Number(amount);

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO payments (business_id, order_id, payment_method, amount, status, processed_at)
         VALUES ($1, $2, $3, $4, 'completed', NOW())`,
        [businessId, order_id, payment_method, amount]
      );

      await client.query(
        `UPDATE orders SET status = 'completed', payment_method = $1, updated_at = NOW()
         WHERE id = $2 AND business_id = $3`,
        [payment_method, order_id, businessId]
      );
    });

    res.json({
      success: true,
      data: { change: change > 0 ? change : 0 },
      message: 'Payment processed successfully',
    });
  } catch (error) {
    logger.error('Cash payment error:', error);
    res.status(500).json({ success: false, message: 'Payment processing failed' });
  }
};

// ========= DASHBOARD ANALYTICS =========
export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const businessId = req.user!.business_id;

    const [todaySales] = await query(
      `SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as orders
       FROM orders WHERE business_id = $1 AND status = 'completed'
       AND DATE(created_at) = CURRENT_DATE`,
      [businessId]
    );

    const [monthlySales] = await query(
      `SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as orders,
              COALESCE(AVG(total_amount), 0) as avg_value
       FROM orders WHERE business_id = $1 AND status = 'completed'
       AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)`,
      [businessId]
    );

    const topProducts = await query(
      `SELECT p.name, SUM(oi.quantity) as quantity, SUM(oi.total_amount) as revenue
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       JOIN orders o ON oi.order_id = o.id
       WHERE o.business_id = $1 AND o.status = 'completed'
       AND o.created_at >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY p.id, p.name
       ORDER BY revenue DESC LIMIT 10`,
      [businessId]
    );

    const salesByPayment = await query(
      `SELECT payment_method as method, SUM(total_amount) as amount, COUNT(*) as count
       FROM orders WHERE business_id = $1 AND status = 'completed'
       AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)
       GROUP BY payment_method`,
      [businessId]
    );

    const hourlySales = await query(
      `SELECT EXTRACT(HOUR FROM created_at)::int as hour,
              COALESCE(SUM(total_amount), 0) as amount, COUNT(*) as count
       FROM orders WHERE business_id = $1 AND status = 'completed'
       AND DATE(created_at) = CURRENT_DATE
       GROUP BY hour ORDER BY hour`,
      [businessId]
    );

    const [recentCustomers] = await query(
      `SELECT COUNT(DISTINCT customer_id) as total FROM orders
       WHERE business_id = $1 AND DATE(created_at) = CURRENT_DATE`,
      [businessId]
    );

    const lowStock = await query(
      `SELECT * FROM products WHERE business_id = $1 AND track_inventory = true
       AND stock_quantity <= min_stock_level AND status = 'active'
       ORDER BY stock_quantity ASC LIMIT 10`,
      [businessId]
    );

    res.json({
      success: true,
      data: {
        today_sales: Number(todaySales.total),
        today_orders: Number(todaySales.orders),
        today_customers: Number(recentCustomers.total),
        monthly_sales: Number(monthlySales.total),
        monthly_orders: Number(monthlySales.orders),
        avg_order_value: Number(monthlySales.avg_value),
        top_products: topProducts,
        sales_by_payment: salesByPayment,
        hourly_sales: hourlySales,
        low_stock_products: lowStock,
      },
    });
  } catch (error) {
    logger.error('Dashboard stats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats' });
  }
};
