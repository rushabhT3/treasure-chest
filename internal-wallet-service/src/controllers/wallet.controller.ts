import { Request, Response, NextFunction } from 'express';
import { WalletService } from '../services/wallet.service';
import { prisma } from '../config/database';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

const walletService = new WalletService(prisma);

// Validation schemas
const topUpSchema = z.object({
  userId: z.string().uuid(),
  assetTypeId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,8})?$/),
  metadata: z.record(z.any()).optional(),
});

const bonusSchema = z.object({
  userId: z.string().uuid(),
  assetTypeId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,8})?$/),
  reason: z.string().min(1).max(255),
  metadata: z.record(z.any()).optional(),
});

const spendSchema = z.object({
  userId: z.string().uuid(),
  assetTypeId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,8})?$/),
  serviceDescription: z.string().min(1).max(255),
  metadata: z.record(z.any()).optional(),
});

/**
 * Helper to safely extract the idempotency key as a single string
 */
const getIdempotencyKey = (req: Request): string | undefined => {
  const key = req.headers['idempotency-key'];
  return Array.isArray(key) ? key[0] : key;
};

export const walletController = {
  /**
   * POST /api/v1/wallet/topup
   */
  async topUp(req: Request, res: Response, next: NextFunction) {
    try {
      const idempotencyKey = getIdempotencyKey(req);
        
      if (!idempotencyKey) {
        res.status(400).json({ 
          success: false,
          error: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'Header Idempotency-Key is required' 
        });
        return; // Return empty to stop execution without returning the Response object
      }

      const validated = topUpSchema.parse(req.body);
      
      const result = await walletService.topUp(
        validated.userId,
        validated.assetTypeId,
        new Prisma.Decimal(validated.amount),
        idempotencyKey,
        validated.metadata
      );
      
      res.status(201).json({
        success: true,
        data: result,
        message: 'Top-up successful'
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/wallet/bonus
   */
  async grantBonus(req: Request, res: Response, next: NextFunction) {
    try {
      const idempotencyKey = getIdempotencyKey(req);
        
      if (!idempotencyKey) {
        res.status(400).json({ 
          success: false,
          error: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'Header Idempotency-Key is required' 
        });
        return;
      }

      const validated = bonusSchema.parse(req.body);
      
      const result = await walletService.grantBonus(
        validated.userId,
        validated.assetTypeId,
        new Prisma.Decimal(validated.amount),
        idempotencyKey,
        validated.reason,
        validated.metadata
      );
      
      res.status(201).json({
        success: true,
        data: result,
        message: 'Bonus granted successfully'
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/v1/wallet/spend
   */
  async spend(req: Request, res: Response, next: NextFunction) {
    try {
      const idempotencyKey = getIdempotencyKey(req);
        
      if (!idempotencyKey) {
        res.status(400).json({ 
          success: false,
          error: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'Header Idempotency-Key is required' 
        });
        return;
      }

      const validated = spendSchema.parse(req.body);
      
      const result = await walletService.spend(
        validated.userId,
        validated.assetTypeId,
        new Prisma.Decimal(validated.amount),
        idempotencyKey,
        validated.serviceDescription,
        validated.metadata
      );
      
      res.status(201).json({
        success: true,
        data: result,
        message: 'Purchase successful'
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/wallet/:userId/balance
   */
  async getBalance(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.params as { userId: string };
      const assetTypeId = req.query.assetTypeId as string | undefined;
      
      const balance = await walletService.getBalance(userId, assetTypeId);
      
      res.json({
        success: true,
        data: balance
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/wallet/:walletId/ledger
   */
  async getLedger(req: Request, res: Response, next: NextFunction) {
    try {
      const { walletId } = req.params as { walletId: string };
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      
      const history = await walletService.getLedgerHistory(walletId, limit, offset);
      
      res.json({
        success: true,
        data: history
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/v1/wallet/:userId/stats
   */
  async getStats(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.params as { userId: string };
      const stats = await walletService.getWalletStats(userId);
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      next(error);
    }
  },
};