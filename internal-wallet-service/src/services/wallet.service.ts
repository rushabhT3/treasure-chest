import { PrismaClient, Prisma } from '@prisma/client';
import { LedgerService, LedgerOperation, TransactionResult } from './ledger.service';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';

export interface BalanceInfo {
  assetType: string;
  assetName: string;
  balance: string;
  walletId: string;
  updatedAt: Date;
}

export class WalletService {
  private ledgerService: LedgerService;

  constructor(private prisma: PrismaClient) {
    this.ledgerService = new LedgerService(prisma);
  }

  /**
   * 1. WALLET TOP-UP (Purchase):
   * User buys credits with real money
   * Flow: System Treasury -> User Wallet
   */
  async topUp(
    userId: string,
    assetTypeId: string,
    amount: Prisma.Decimal,
    idempotencyKey: string,
    metadata?: Record<string, any>
  ): Promise<TransactionResult> {
    logger.info(`💰 Processing top-up for user ${userId}, amount: ${amount}`);

    // Get system treasury wallet (source of funds)
    const treasuryWallet = await this.prisma.wallet.findFirst({
      where: { ownerType: 'SYSTEM', assetTypeId, ownerId: 'TREASURY' },
    });
    
    if (!treasuryWallet) {
      throw new Error('TREASURY_WALLET_NOT_FOUND');
    }

    // Get or create user wallet
    const userWallet = await this.getOrCreateWallet(userId, 'USER', assetTypeId);

    const operation: LedgerOperation = {
      fromWalletId: treasuryWallet.id,  // Debit treasury (minting)
      toWalletId: userWallet.id,        // Credit user
      assetTypeId,
      amount: new Prisma.Decimal(amount),
      description: `Top-up via ${metadata?.paymentProvider || 'Purchase'}`,
    };

    const result = await this.ledgerService.executeTransaction('TOPUP', operation, idempotencyKey);
    
    // Invalidate balance cache
    await this.invalidateBalanceCache(userId);
    
    return result;
  }

  /**
   * 2. BONUS/INCENTIVE (Referral/Reward):
   * System issues free credits
   * Flow: System Revenue -> User Wallet
   */
  async grantBonus(
    userId: string,
    assetTypeId: string,
    amount: Prisma.Decimal,
    idempotencyKey: string,
    reason: string,
    metadata?: Record<string, any>
  ): Promise<TransactionResult> {
    logger.info(`🎁 Processing bonus for user ${userId}, amount: ${amount}, reason: ${reason}`);

    // Get system revenue wallet (source for bonuses)
    const revenueWallet = await this.prisma.wallet.findFirst({
      where: { 
        ownerType: 'SYSTEM', 
        assetTypeId,
        ownerId: 'REVENUE'
      },
    });
    
    if (!revenueWallet) {
      throw new Error('REVENUE_WALLET_NOT_FOUND');
    }

    const userWallet = await this.getOrCreateWallet(userId, 'USER', assetTypeId);

    const operation: LedgerOperation = {
      fromWalletId: revenueWallet.id,
      toWalletId: userWallet.id,
      assetTypeId,
      amount: new Prisma.Decimal(amount),
      description: `Bonus: ${reason}${metadata?.campaign ? ` (Campaign: ${metadata.campaign})` : ''}`,
    };

    const result = await this.ledgerService.executeTransaction('BONUS', operation, idempotencyKey);
    
    await this.invalidateBalanceCache(userId);
    
    return result;
  }

  /**
   * 3. PURCHASE/SPEND:
   * User spends credits on in-app service/item
   * Flow: User Wallet -> System Revenue
   */
  async spend(
    userId: string,
    assetTypeId: string,
    amount: Prisma.Decimal,
    idempotencyKey: string,
    serviceDescription: string,
    metadata?: Record<string, any>
  ): Promise<TransactionResult> {
    logger.info(`🛒 Processing spend for user ${userId}, amount: ${amount}, item: ${serviceDescription}`);

    // Verify user has sufficient balance
    const userWallet = await this.prisma.wallet.findUnique({
      where: {
        ownerId_ownerType_assetTypeId: {
          ownerId: userId,
          ownerType: 'USER',
          assetTypeId,
        },
      },
    });
    
    if (!userWallet) {
      throw new Error('USER_WALLET_NOT_FOUND');
    }
    
    if (userWallet.balance.lessThan(amount)) {
      throw new Error('INSUFFICIENT_BALANCE');
    }

    // Get system revenue wallet (destination for spent credits)
    const revenueWallet = await this.prisma.wallet.findFirst({
      where: { 
        ownerType: 'SYSTEM', 
        assetTypeId,
        ownerId: 'REVENUE'
      },
    });
    
    if (!revenueWallet) {
      throw new Error('REVENUE_WALLET_NOT_FOUND');
    }

    const operation: LedgerOperation = {
      fromWalletId: userWallet.id,
      toWalletId: revenueWallet.id,
      assetTypeId,
      amount: new Prisma.Decimal(amount),
      description: `Purchase: ${serviceDescription}${metadata?.itemId ? ` (Item: ${metadata.itemId})` : ''}`,
    };

    const result = await this.ledgerService.executeTransaction('PURCHASE', operation, idempotencyKey);
    
    await this.invalidateBalanceCache(userId);
    
    return result;
  }

  /**
   * Get balance with caching (Redis)
   */
  async getBalance(userId: string, assetTypeId?: string): Promise<BalanceInfo[]> {
    const cacheKey = `balance:${userId}:${assetTypeId || 'all'}`;
    
    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.debug(`📦 Cache hit for balance: ${userId}`);
      return JSON.parse(cached);
    }

    // Fetch from database
    const wallets = await this.prisma.wallet.findMany({
      where: { 
        ownerId: userId, 
        ownerType: 'USER',
        ...(assetTypeId && { assetTypeId })
      },
      include: { assetType: true },
    });

    const result: BalanceInfo[] = wallets.map(w => ({
      assetType: w.assetType.code,
      assetName: w.assetType.name,
      balance: w.balance.toString(),
      walletId: w.id,
      updatedAt: w.updatedAt,
    }));

    // Cache for 5 minutes (300 seconds)
    await redis.setex(cacheKey, 300, JSON.stringify(result));
    logger.debug(`💾 Cached balance for user: ${userId}`);
    
    return result;
  }

  /**
   * Get detailed ledger history for a wallet
   */
  async getLedgerHistory(walletId: string, limit: number = 50, offset: number = 0) {
    const [entries, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where: { walletId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { 
          assetType: { select: { code: true, name: true } }
        },
      }),
      this.prisma.ledgerEntry.count({ where: { walletId } })
    ]);

    return {
      entries: entries.map(e => ({
        ...e,
        amount: e.amount.toString(),
        runningBalance: e.runningBalance.toString(),
      })),
      total,
      limit,
      offset
    };
  }

  /**
   * Get wallet statistics
   */
  async getWalletStats(userId: string) {
    const stats = await this.prisma.ledgerEntry.groupBy({
      by: ['entryType'],
      where: {
        wallet: { ownerId: userId, ownerType: 'USER' }
      },
      _sum: { amount: true },
      _count: { id: true }
    });

    return {
      totalCredits: stats.find(s => s.entryType === 'CREDIT')?._sum.amount?.toString() || '0',
      totalDebits: stats.find(s => s.entryType === 'DEBIT')?._sum.amount?.toString() || '0',
      transactionCount: stats.reduce((acc, s) => acc + s._count.id, 0)
    };
  }

  private async getOrCreateWallet(
    ownerId: string, 
    ownerType: 'USER' | 'SYSTEM', 
    assetTypeId: string
  ) {
    const existing = await this.prisma.wallet.findUnique({
      where: {
        ownerId_ownerType_assetTypeId: { ownerId, ownerType, assetTypeId },
      },
    });
    
    if (existing) return existing;

    logger.info(`🆕 Creating new wallet for ${ownerType}:${ownerId}, asset: ${assetTypeId}`);
    
    return this.prisma.wallet.create({
      data: {
        ownerId,
        ownerType,
        assetTypeId,
        balance: 0,
      },
    });
  }

  private async invalidateBalanceCache(userId: string): Promise<void> {
    const keys = await redis.keys(`balance:${userId}:*`);
    if (keys.length > 0) {
      await redis.del(...keys);
      logger.debug(`🗑️ Invalidated balance cache for user: ${userId}`);
    }
  }
}
