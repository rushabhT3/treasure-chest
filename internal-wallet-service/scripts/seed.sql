-- =============================================================
-- Internal Wallet Service — Seed Data
-- Run after migrations: psql $DATABASE_URL -f scripts/seed.sql
-- =============================================================

-- Disable triggers temporarily for clean upserts
BEGIN;

-- ============================================================
-- 1. ASSET TYPES
-- ============================================================
INSERT INTO asset_types (id, code, name, description, "isActive", "createdAt")
VALUES
  ('asset-gold-coin-001',  'GOLD_COIN',     'Gold Coins',     'Premium in-game currency for purchases',       true, NOW()),
  ('asset-diamond-001',    'DIAMOND',       'Diamonds',       'Ultra-premium currency for exclusive items',   true, NOW()),
  ('asset-loyalty-001',    'LOYALTY_POINT', 'Loyalty Points', 'Reward points for engagement and referrals',   true, NOW())
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 2. SYSTEM WALLETS
-- Treasury  = source of all newly minted credits (top-ups & bonuses)
-- Revenue   = sink that collects credits when users spend them
-- ============================================================
INSERT INTO wallets (id, "ownerId", "ownerType", "assetTypeId", balance, version, "createdAt", "updatedAt")
VALUES
  -- Treasury
  ('wallet-treasury-gold',    'TREASURY', 'SYSTEM', 'asset-gold-coin-001', 10000000.00, 0, NOW(), NOW()),
  ('wallet-treasury-diamond', 'TREASURY', 'SYSTEM', 'asset-diamond-001',    5000000.00, 0, NOW(), NOW()),
  ('wallet-treasury-loyalty', 'TREASURY', 'SYSTEM', 'asset-loyalty-001',    5000000.00, 0, NOW(), NOW()),
  -- Revenue (sink — starts at zero)
  ('wallet-revenue-gold',    'REVENUE',  'SYSTEM', 'asset-gold-coin-001',        0.00, 0, NOW(), NOW()),
  ('wallet-revenue-diamond', 'REVENUE',  'SYSTEM', 'asset-diamond-001',           0.00, 0, NOW(), NOW()),
  ('wallet-revenue-loyalty', 'REVENUE',  'SYSTEM', 'asset-loyalty-001',           0.00, 0, NOW(), NOW())
ON CONFLICT ("ownerId", "ownerType", "assetTypeId") DO NOTHING;

-- ============================================================
-- 3. USER WALLETS (at least 2 users with initial balances)
-- ============================================================
INSERT INTO wallets (id, "ownerId", "ownerType", "assetTypeId", balance, version, "createdAt", "updatedAt")
VALUES
  -- user-rich-001: veteran player, plenty of both currencies
  ('wallet-user1-gold',    'user-rich-001', 'USER', 'asset-gold-coin-001', 10000.00, 0, NOW(), NOW()),
  ('wallet-user1-diamond', 'user-rich-001', 'USER', 'asset-diamond-001',     500.00, 0, NOW(), NOW()),
  -- user-new-002: newcomer, small starting balance + some loyalty points
  ('wallet-user2-gold',    'user-new-002',  'USER', 'asset-gold-coin-001',   100.00, 0, NOW(), NOW()),
  ('wallet-user2-loyalty', 'user-new-002',  'USER', 'asset-loyalty-001',      50.00, 0, NOW(), NOW())
ON CONFLICT ("ownerId", "ownerType", "assetTypeId") DO NOTHING;

COMMIT;

-- ============================================================
-- Verification queries (optional — comment out if running via script)
-- ============================================================
-- SELECT code, name FROM asset_types ORDER BY code;
-- SELECT "ownerId", "ownerType", "assetTypeId", balance FROM wallets ORDER BY "ownerType", "ownerId";