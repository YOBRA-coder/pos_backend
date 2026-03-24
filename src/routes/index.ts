import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import * as auth from '../controllers/authController';
import * as products from '../controllers/productController';
import * as orders from '../controllers/orderController';
import * as payments from '../controllers/paymentController';
import * as users from '../controllers/usersController'

const router = Router();

// ===== AUTH ROUTES =====
router.post('/auth/register', auth.register);
router.post('/auth/login', auth.login);
router.post('/auth/refresh', auth.refreshToken);
router.post('/auth/logout', authenticate, auth.logout);
router.get('/auth/me', authenticate, auth.getMe);

// ===== PRODUCT ROUTES =====
router.get('/products', authenticate, products.getProducts);
router.get('/products/:id', authenticate, products.getProduct);
router.post('/products', authenticate, authorize('admin', 'manager'), products.createProduct);
router.put('/products/:id', authenticate, authorize('admin', 'manager'), products.updateProduct);
router.delete('/products/:id', authenticate, authorize('admin', 'manager'), products.deleteProduct);

// ===== CATEGORY ROUTES =====
router.get('/categories', authenticate, products.getCategories);
router.post('/categories', authenticate, authorize('admin', 'manager'), products.createCategory);

// ===== ORDER ROUTES =====
router.get('/orders', authenticate, orders.getOrders);
router.get('/orders/:id', authenticate, orders.getOrder);
router.post('/orders', authenticate, orders.createOrder);
router.patch('/orders/:id/status', authenticate, authorize('admin', 'manager', 'cashier'), orders.updateOrderStatus);

// ===== CUSTOMER ROUTES =====
router.get('/customers', authenticate, orders.getCustomers);
router.post('/customers', authenticate, orders.createCustomer);

// ===== PAYMENT ROUTES =====
router.post('/payments/mpesa/stk-push', authenticate, payments.initiateMpesaSTKPush);
router.post('/payments/mpesa/callback', payments.mpesaCallback); // No auth - Safaricom callback
router.get('/payments/mpesa/status/:payment_id', authenticate, payments.checkMpesaStatus);
router.post('/payments/stripe/intent', authenticate, payments.createStripePaymentIntent);
router.post('/payments/stripe/webhook', payments.stripeWebhook); // No auth - Stripe webhook
router.post('/payments/cash', authenticate, payments.processCashPayment);

// ===== DASHBOARD =====
router.get('/dashboard/stats', authenticate, payments.getDashboardStats);

// ===== USERS ROUTES ===
// ===== CUSTOMER ROUTES =====
router.get('/users', authenticate, users.getUsers);
router.post('/users', authenticate, users.createUser);

export default router;
