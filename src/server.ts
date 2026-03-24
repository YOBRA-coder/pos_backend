import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { logger } from './utils/logger';
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import orderRoutes from './routes/orders';
import paymentRoutes from './routes/payments';
import customerRoutes from './routes/customers';
import reportRoutes from './routes/reports';
import inventoryRoutes from './routes/inventory';
import categoryRoutes from './routes/categories';
import usersRoutes from './routes/users';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Security & Performance
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: 'https://pos-frontend-bx9b.vercel.app',
  credentials: true,
}));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/users', usersRoutes);

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// Error Handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error(err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, () => {
  logger.info(`🚀 POS Server running on port ${PORT}`);
});

export default app;
