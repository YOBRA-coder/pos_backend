import { Router } from 'express';
import { query } from '../utils/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import axios from 'axios';
import {initiateMpesaSTKPush} from '../controllers/paymentController'

const router = Router();
router.use(authenticate);

// Get M-Pesa access token
const getMpesaToken = async () => {
  const consumerKey = process.env.MPESA_CONSUMER_KEY || '';
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET || '';
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const response = await axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
    headers: { Authorization: `Basic ${auth}` }
  });
  return response.data.access_token;
};

// M-Pesa STK Push
router.post('/mpesa/stk-push', async (req: AuthRequest, res) => {
  const { orderId, phone, amount } = req.body;
  
  try {
    const order = await query('SELECT * FROM orders WHERE id=$1 AND business_id=$2', [orderId, req.user!.businessId]);
    if (!order.rows.length) return res.status(404).json({ error: 'Order not found' });
    initiateMpesaSTKPush(req,res);
   // const shortcode = process.env.MPESA_SHORTCODE || '174379';
   // const passkey = process.env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
     const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
   // const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

    // Create pending payment record
    //const payment = await query(
      ////'INSERT INTO payments (order_id, payment_method, amount, status, mpesa_phone) VALUES ($1,$2,$3,$4,$5) RETURNING *',
     // [orderId, 'mpesa', amount, 'pending', phone]
   // );

    // In production, uncomment this and use real credentials:
    /*
    const token = await getMpesaToken();
    const stkResponse = await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.ceil(amount),
      PartyA: phone.replace('+','').replace(/^0/,'254'),
      PartyB: shortcode,
      PhoneNumber: phone.replace('+','').replace(/^0/,'254'),
      CallBackURL: `${process.env.API_URL}/api/payments/mpesa/callback`,
      AccountReference: order.rows[0].order_number,
      TransactionDesc: `Payment for ${order.rows[0].order_number}`
    }, { headers: { Authorization: `Bearer ${token}` }});
    */

    // Simulate successful M-Pesa for demo
    //const receiptNum = `QK${Math.random().toString(36).substr(2,8).toUpperCase()}`;
    //await query('UPDATE payments SET status=$1, mpesa_receipt=$2, updated_at=NOW() WHERE id=$3', ['completed', receiptNum, payment.rows[0].id]);
    //await query('UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2', ['completed', orderId]);

    res.json({ 
      success: true, 
      paymentId: "paymentId",
      receipt: "receiptNum---80",
      message: 'M-Pesa payment initiated successfully'
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// M-Pesa callback
router.post('/mpesa/callback', async (req, res) => {
  const { Body } = req.body;
  if (Body?.stkCallback?.ResultCode === 0) {
    const items = Body.stkCallback.CallbackMetadata?.Item || [];
    const receipt = items.find((i: any) => i.Name === 'MpesaReceiptNumber')?.Value;
    const phone = items.find((i: any) => i.Name === 'PhoneNumber')?.Value;
    if (receipt) {
      await query('UPDATE payments SET status=$1, mpesa_receipt=$2 WHERE mpesa_phone LIKE $3 AND status=$4', ['completed', receipt, `%${String(phone).slice(-9)}`, 'pending']);
    }
  }
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// Credit/Debit Card payment
router.post('/card', async (req: AuthRequest, res) => {
  const { orderId, amount, cardLast4, cardBrand, cardToken } = req.body;
  try {
    const order = await query('SELECT * FROM orders WHERE id=$1 AND business_id=$2', [orderId, req.user!.businessId]);
    if (!order.rows.length) return res.status(404).json({ error: 'Order not found' });

    // In production: integrate with Stripe, Flutterwave, DPO, etc.
    const payment = await query(
      'INSERT INTO payments (order_id,payment_method,amount,status,card_last4,card_brand,reference) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [orderId, cardBrand === 'debit' ? 'debit_card' : 'credit_card', amount, 'completed', cardLast4, cardBrand, `CARD-${Date.now()}`]
    );
    await query('UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2', ['completed', orderId]);

    res.json({ success: true, paymentId: payment.rows[0].id, reference: payment.rows[0].reference });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Cash payment
router.post('/cash', async (req: AuthRequest, res) => {
  const { orderId, amount, amountTendered } = req.body;
  try {
    const payment = await query(
      'INSERT INTO payments (order_id,payment_method,amount,status,reference) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [orderId, 'cash', amount, 'completed', `CASH-${Date.now()}`]
    );
    await query('UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2', ['completed', orderId]);
    res.json({ success: true, paymentId: payment.rows[0].id, change: (amountTendered||amount) - amount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Bank transfer
router.post('/bank-transfer', async (req: AuthRequest, res) => {
  const { orderId, amount, reference, bankName } = req.body;
  try {
    const payment = await query(
      'INSERT INTO payments (order_id,payment_method,amount,status,reference,gateway_response) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [orderId, 'bank_transfer', amount, 'completed', reference, JSON.stringify({ bankName })]
    );
    await query('UPDATE orders SET status=$1 WHERE id=$2', ['completed', orderId]);
    res.json({ success: true, paymentId: payment.rows[0].id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Refund
router.post('/:id/refund', async (req: AuthRequest, res) => {
  const { reason } = req.body;
  try {
    const payment = await query('SELECT p.*, o.business_id FROM payments p JOIN orders o ON p.order_id=o.id WHERE p.id=$1', [req.params.id]);
    if (!payment.rows.length) return res.status(404).json({ error: 'Payment not found' });
    if (payment.rows[0].business_id !== req.user!.businessId) return res.status(403).json({ error: 'Forbidden' });
    
    await query('UPDATE payments SET status=$1 WHERE id=$2', ['refunded', req.params.id]);
    await query('UPDATE orders SET status=$1 WHERE id=$2', ['refunded', payment.rows[0].order_id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
