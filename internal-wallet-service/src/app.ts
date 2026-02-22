import express from 'express';
import compression from 'compression';
import dotenv from 'dotenv';
import { connectDatabase, disconnectDatabase } from './config/database';
import { walletController } from './controllers/wallet.controller';
import { errorHandler } from './middleware/errorHandler';
import { setupSecurity } from './middleware/security';
import { logger } from './utils/logger';

// Load environment variables
dotenv.config();

const app = express();

// Security middleware
setupSecurity(app);

// Body parsing & compression
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// API Routes - Wallet Service
const apiV1 = express.Router();

// Transaction endpoints (Core Requirements)
apiV1.post('/wallet/topup', walletController.topUp);
apiV1.post('/wallet/bonus', walletController.grantBonus);
apiV1.post('/wallet/spend', walletController.spend);

// Query endpoints
apiV1.get('/wallet/:userId/balance', walletController.getBalance);
apiV1.get('/wallet/:walletId/ledger', walletController.getLedger);
apiV1.get('/wallet/:userId/stats', walletController.getStats);

app.use('/api/v1', apiV1);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'NOT_FOUND',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Global error handler
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  try {
    await disconnectDatabase();
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
async function start() {
  try {
    await connectDatabase();
    
    app.listen(PORT, () => {
      logger.info(`🚀 Wallet Service running on port ${PORT}`);
      logger.info(`📚 API Documentation: http://localhost:${PORT}/api/v1`);
      logger.info(`💊 Health Check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
