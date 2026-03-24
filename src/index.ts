import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { testConnection } from './config/database';
import routes from './routes';
import { logger } from './utils/logger';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const API_VERSION = process.env.API_VERSION || 'v1';

// ===== SECURITY MIDDLEWARE =====
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// ===== CORS =====
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3001,http://localhost:5173').split(',');
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ===== RATE LIMITING =====
const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 200,
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(`/api/${API_VERSION}`, limiter);

// ===== BODY PARSING =====
// Stripe webhook needs raw body
app.use(`/api/${API_VERSION}/payments/stripe/webhook`, express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ===== COMPRESSION =====
app.use(compression());

// ===== LOGGING =====
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', { stream: { write: (message) => logger.http(message.trim()) } }));
}

// ===== HEALTH CHECK =====
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  });
});

// ===== API ROUTES =====
app.use(`/api/${API_VERSION}`, routes);

// ===== 404 HANDLER =====
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

// ===== ERROR HANDLER =====
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ===== START SERVER =====
const startServer = async () => {
  try {
    await testConnection();
    app.listen(PORT, () => {
      logger.info(`🚀 POS Server running on port ${PORT}`);
      logger.info(`📍 API: http://localhost:${PORT}/api/${API_VERSION}`);
      logger.info(`💚 Health: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

export default app;
