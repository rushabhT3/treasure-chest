import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { Express } from 'express';

export const setupSecurity = (app: Express) => {
  // Helmet for security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  }));

  // CORS configuration
  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    credentials: true,
    maxAge: 86400
  }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
      success: false,
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later'
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Stricter rate limit for transaction endpoints
  const transactionLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 transactions per minute
    message: {
      success: false,
      error: 'TRANSACTION_RATE_LIMIT',
      message: 'Too many transactions, please slow down'
    }
  });

  app.use('/api/', limiter);
  app.use('/api/v1/wallet/topup', transactionLimiter);
  app.use('/api/v1/wallet/spend', transactionLimiter);
  app.use('/api/v1/wallet/bonus', transactionLimiter);
};
