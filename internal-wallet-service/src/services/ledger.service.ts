import { PrismaClient, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { DeadlockPreventer } from '../utils/deadlockPreventer';
import { checkIdempotency, storeIdempotency, markProcessing, unmarkProcessing } from '../utils/idempotency';
import { logger } from '../utils/logger';

export interface LedgerOperation {
  fromWalletId?: string;
  toWalletId: string;
  assetTypeId: string;
  amount: Prisma.Decimal;
  description?: string;
}

export interface TransactionResult {
  transactionId: string;
  status: string;
  fromBalance?: string;
  toBalance?: string;
}

export class LedgerService {
  constructor(private prisma: PrismaClient) {}

  /**
   * DOUBLE-ENTRY BOOKKEEPING:
   * Every transaction creates exactly 2 ledger entries (1 debit, 1 credit)
   */
  private async executeDoubleEntry(
    tx: Prisma.TransactionClient,
    operation: LedgerOperation,
    transactionId: string
  ): Promise<{ fromBalance?: Prisma.Decimal; toBalance: Prisma.Decimal }> {
    const { fromWalletId, toWalletId, assetTypeId, amount, description } = operation;

    // Fetch current balances
    const [fromWallet, toWallet] = await Promise.all([
      fromWalletId 
        ? tx.wallet.findUnique({ 
            where: { id: fromWalletId },
            select: { id: true, balance: true, version: true }
          })
        : Promise.resolve(null),
      tx.wallet.findUnique({ 
        where: { id: toWalletId },
        select: { id: true, balance: true, version: true }
      })
    ]);

    if (!toWallet) throw new Error('DESTINATION_WALLET_NOT_FOUND');
    if (fromWalletId && !fromWallet) throw new Error('SOURCE_WALLET_NOT_FOUND');
    if (fromWallet && fromWallet.balance.lessThan(amount)) {
      throw new Error('INSUFFICIENT_BALANCE');
    }

    const timestamp = new Date();
    const results: { fromBalance?: Prisma.Decimal; toBalance: Prisma.Decimal } = {
      toBalance: toWallet.balance.plus(amount)
    };

    // Create CREDIT entry (destination wallet receives funds)
    await tx.ledgerEntry.create({
      data: {
        id: uuidv4(),
        transactionId,
        walletId: toWalletId,
        assetTypeId,
        entryType: 'CREDIT',
        amount,
        runningBalance: results.toBalance,
        description: description || 'Credit',
        counterpartyWalletId: fromWalletId || null,
        createdAt: timestamp,
      },
    });

    // Create DEBIT entry (source wallet sends funds) if not a mint operation
    if (fromWalletId && fromWallet) {
      results.fromBalance = fromWallet.balance.minus(amount);
      
      await tx.ledgerEntry.create({
        data: {
          id: uuidv4(),
          transactionId,
          walletId: fromWalletId,
          assetTypeId,
          entryType: 'DEBIT',
          amount,
          runningBalance: results.fromBalance,
          description: description || 'Debit',
          counterpartyWalletId: toWalletId,
          createdAt: timestamp,
        },
      });

      // Update source wallet with OPTIMISTIC LOCKING
      const updatedFrom = await tx.wallet.updateMany({
        where: { 
          id: fromWalletId, 
          version: fromWallet.version 
        },
        data: { 
          balance: results.fromBalance,
          version: { increment: 1 }
        },
      });
      
      if (updatedFrom.count === 0) {
        throw new Error('CONCURRENT_MODIFICATION_SOURCE');
      }
    }

    // Update destination wallet with OPTIMISTIC LOCKING
    const updatedTo = await tx.wallet.updateMany({
      where: { 
        id: toWalletId, 
        version: toWallet.version 
      },
      data: { 
        balance: results.toBalance,
        version: { increment: 1 }
      },
    });
    
    if (updatedTo.count === 0) {
      throw new Error('CONCURRENT_MODIFICATION_DESTINATION');
    }

    return results;
  }

  /**
   * CORE TRANSACTION EXECUTOR with idempotency and deadlock prevention
   */
  async executeTransaction(
    type: 'TOPUP' | 'BONUS' | 'PURCHASE',
    operation: LedgerOperation,
    idempotencyKey: string
  ): Promise<TransactionResult> {
    // Check idempotency
    const idempotencyCheck = await checkIdempotency(idempotencyKey);
    if (idempotencyCheck.exists) {
      logger.info(`Returning cached result for idempotency key: ${idempotencyKey}`);
      return idempotencyCheck.result;
    }

    // Mark as processing
    const isProcessing = await markProcessing(idempotencyKey);
    if (!isProcessing) {
      throw new Error('REQUEST_ALREADY_PROCESSING');
    }

    const transactionId = uuidv4();
    const walletIds = [operation.fromWalletId, operation.toWalletId].filter(Boolean) as string[];

    try {
      // Execute with deadlock prevention
      const result = await DeadlockPreventer.withOrderedLocks(walletIds, async () => {
        return await this.prisma.$transaction(async (tx) => {
          // Create transaction record
          await tx.transaction.create({
            data: {
              id: transactionId,
              type,
              idempotencyKey,
              status: 'COMPLETED',
              completedAt: new Date(),
            },
          });

          // Execute double-entry bookkeeping
          const balances = await this.executeDoubleEntry(tx, operation, transactionId);

          return {
            transactionId,
            status: 'COMPLETED',
            fromBalance: balances.fromBalance?.toString(),
            toBalance: balances.toBalance.toString()
          };
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 10000,
        });
      });

      // Store result for idempotency
      await storeIdempotency(idempotencyKey, result);
      
      logger.info(`Transaction ${type} completed: ${transactionId}`);
      return result;

    } catch (error) {
      logger.error(`Transaction ${type} failed:`, error);
      
      const failedResult = {
        transactionId,
        status: 'FAILED',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      await storeIdempotency(idempotencyKey, failedResult, 3600);
      
      throw error;
    } finally {
      await unmarkProcessing(idempotencyKey);
    }
  }
}