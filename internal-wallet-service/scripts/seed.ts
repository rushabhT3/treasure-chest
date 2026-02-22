import { PrismaClient } from '@prisma/client';
import { logger } from '../src/utils/logger';

const prisma = new PrismaClient();

async function main() {
  logger.info('🌱 Starting database seed...');

  // ============================================================
  // 1. ASSET TYPES (Gold Coins, Diamonds, Loyalty Points)
  // ============================================================
  const assets = await Promise.all([
    prisma.assetType.upsert({
      where: { code: 'GOLD_COIN' },
      update: {},
      create: {
        id: 'asset-gold-coin-001',
        code: 'GOLD_COIN',
        name: 'Gold Coins',
        description: 'Premium in-game currency for purchases',
      },
    }),
    prisma.assetType.upsert({
      where: { code: 'DIAMOND' },
      update: {},
      create: {
        id: 'asset-diamond-001',
        code: 'DIAMOND',
        name: 'Diamonds',
        description: 'Ultra-premium currency for exclusive items',
      },
    }),
    prisma.assetType.upsert({
      where: { code: 'LOYALTY_POINT' },
      update: {},
      create: {
        id: 'asset-loyalty-001',
        code: 'LOYALTY_POINT',
        name: 'Loyalty Points',
        description: 'Reward points for engagement and referrals',
      },
    }),
  ]);

  logger.info(`✅ Asset Types created: ${assets.map(a => a.code).join(', ')}`);

  // ============================================================
  // 2. SYSTEM ACCOUNTS (Treasury & Revenue)
  // ============================================================
  
  // Treasury: Source of all new currency (minting)
  const treasuryGold = await prisma.wallet.upsert({
    where: { 
      ownerId_ownerType_assetTypeId: {
        ownerId: 'TREASURY',
        ownerType: 'SYSTEM',
        assetTypeId: 'asset-gold-coin-001'
      }
    },
    update: {},
    create: {
      id: 'wallet-treasury-gold',
      ownerId: 'TREASURY',
      ownerType: 'SYSTEM',
      assetTypeId: 'asset-gold-coin-001',
      balance: 10000000.00, // 10M initial supply
    },
  });

  const treasuryDiamond = await prisma.wallet.upsert({
    where: { 
      ownerId_ownerType_assetTypeId: {
        ownerId: 'TREASURY',
        ownerType: 'SYSTEM',
        assetTypeId: 'asset-diamond-001'
      }
    },
    update: {},
    create: {
      id: 'wallet-treasury-diamond',
      ownerId: 'TREASURY',
      ownerType: 'SYSTEM',
      assetTypeId: 'asset-diamond-001',
      balance: 5000000.00, // 5M initial supply
    },
  });

  // Revenue: Collects spent currency (sink)
  const revenueGold = await prisma.wallet.upsert({
    where: { 
      ownerId_ownerType_assetTypeId: {
        ownerId: 'REVENUE',
        ownerType: 'SYSTEM',
        assetTypeId: 'asset-gold-coin-001'
      }
    },
    update: {},
    create: {
      id: 'wallet-revenue-gold',
      ownerId: 'REVENUE',
      ownerType: 'SYSTEM',
      assetTypeId: 'asset-gold-coin-001',
      balance: 0.00,
    },
  });

  const revenueDiamond = await prisma.wallet.upsert({
    where: { 
      ownerId_ownerType_assetTypeId: {
        ownerId: 'REVENUE',
        ownerType: 'SYSTEM',
        assetTypeId: 'asset-diamond-001'
      }
    },
    update: {},
    create: {
      id: 'wallet-revenue-diamond',
      ownerId: 'REVENUE',
      ownerType: 'SYSTEM',
      assetTypeId: 'asset-diamond-001',
      balance: 0.00,
    },
  });

  logger.info('✅ System wallets created:');
  logger.info(`   - Treasury Gold: ${treasuryGold.balance} coins`);
  logger.info(`   - Treasury Diamond: ${treasuryDiamond.balance} diamonds`);
  logger.info(`   - Revenue Gold: ${revenueGold.balance} coins`);
  logger.info(`   - Revenue Diamond: ${revenueDiamond.balance} diamonds`);

  // ============================================================
  // 3. USER ACCOUNTS (At least 2 users with initial balances)
  // ============================================================
  
  // User 1: Rich user with multiple assets
  const user1Gold = await prisma.wallet.upsert({
    where: { 
      ownerId_ownerType_assetTypeId: {
        ownerId: 'user-rich-001',
        ownerType: 'USER',
        assetTypeId: 'asset-gold-coin-001'
      }
    },
    update: {},
    create: {
      id: 'wallet-user1-gold',
      ownerId: 'user-rich-001',
      ownerType: 'USER',
      assetTypeId: 'asset-gold-coin-001',
      balance: 10000.00, // Starting with 10k gold
    },
  });

  const user1Diamond = await prisma.wallet.upsert({
    where: { 
      ownerId_ownerType_assetTypeId: {
        ownerId: 'user-rich-001',
        ownerType: 'USER',
        assetTypeId: 'asset-diamond-001'
      }
    },
    update: {},
    create: {
      id: 'wallet-user1-diamond',
      ownerId: 'user-rich-001',
      ownerType: 'USER',
      assetTypeId: 'asset-diamond-001',
      balance: 500.00, // Starting with 500 diamonds
    },
  });

  // User 2: New user with small balance
  const user2Gold = await prisma.wallet.upsert({
    where: { 
      ownerId_ownerType_assetTypeId: {
        ownerId: 'user-new-002',
        ownerType: 'USER',
        assetTypeId: 'asset-gold-coin-001'
      }
    },
    update: {},
    create: {
      id: 'wallet-user2-gold',
      ownerId: 'user-new-002',
      ownerType: 'USER',
      assetTypeId: 'asset-gold-coin-001',
      balance: 100.00, // Starting with 100 gold
    },
  });

  // User 2 also has loyalty points
  const user2Loyalty = await prisma.wallet.upsert({
    where: { 
      ownerId_ownerType_assetTypeId: {
        ownerId: 'user-new-002',
        ownerType: 'USER',
        assetTypeId: 'asset-loyalty-001'
      }
    },
    update: {},
    create: {
      id: 'wallet-user2-loyalty',
      ownerId: 'user-new-002',
      ownerType: 'USER',
      assetTypeId: 'asset-loyalty-001',
      balance: 50.00, // Starting with 50 loyalty points
    },
  });

  logger.info('✅ User wallets created:');
  logger.info(`   - User 1 (Rich): ${user1Gold.balance} gold, ${user1Diamond.balance} diamonds`);
  logger.info(`   - User 2 (New): ${user2Gold.balance} gold, ${user2Loyalty.balance} loyalty points`);

  logger.info('🎉 Seed completed successfully!');
  logger.info('');
  logger.info('📋 Test Data Summary:');
  logger.info('   Asset Types: GOLD_COIN, DIAMOND, LOYALTY_POINT');
  logger.info('   System: TREASURY (mint), REVENUE (sink)');
  logger.info('   Users: user-rich-001 (10k gold, 500 diamonds), user-new-002 (100 gold, 50 loyalty)');
}

main()
  .catch((e) => {
    logger.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
