# treasure-chest

ACID-compliant virtual currency wallet service with double-entry ledger architecture for gaming/loyalty platforms.

## Requirements Checklist

- [x] **Asset Types**: Gold Coins, Diamonds, Loyalty Points
- [x] **System Accounts**: Treasury (mint) & Revenue (sink) wallets
- [x] **User Accounts**: `user-rich-001` (10k gold, 500 diamonds), `user-new-002` (100 gold, 50 loyalty)
- [x] **Wallet Top-up**, **Bonus/Incentive**, **Purchase/Spend** — all three flows implemented
- [x] **Concurrency & Race Conditions**: Distributed locking + optimistic locking
- [x] **Idempotency**: Redis-based deduplication (24h retention)
- [x] **Deadlock Avoidance**: Consistent UUID ordering + distributed locks
- [x] **Ledger-Based Architecture**: Double-entry bookkeeping
- [x] **Containerization**: Docker + Docker Compose (one command spin-up)

---

## Quick Start

```bash
git clone https://github.com/rushabhT3/treasure-chest.git
cd treasure-chest/internal-wallet-service

docker-compose up --build
```

This single command starts PostgreSQL + Redis, runs migrations, seeds data, and starts the app on **http://localhost:3000**.

### Local Development

```bash
npm install
cp .env.example .env          # configure DATABASE_URL and REDIS_HOST

npx prisma migrate deploy
npm run db:seed               # TypeScript seed
# OR: psql $DATABASE_URL -f scripts/seed.sql

npm run dev
```

---

## Seed Data

Both `scripts/seed.ts` and `scripts/seed.sql` are provided and idempotent (safe to re-run).

| Type | ID | Details |
|------|----|---------|
| Asset | `asset-gold-coin-001` | Gold Coins |
| Asset | `asset-diamond-001` | Diamonds |
| Asset | `asset-loyalty-001` | Loyalty Points |
| System | `TREASURY` | Mint — 10M gold, 5M diamonds, 5M loyalty |
| System | `REVENUE` | Sink — starts at 0, collects spent credits |
| User | `user-rich-001` | 10,000 gold, 500 diamonds |
| User | `user-new-002` | 100 gold, 50 loyalty points |

---

## API Reference

All write endpoints require an `Idempotency-Key` header.

```
POST /api/v1/wallet/topup
POST /api/v1/wallet/bonus
POST /api/v1/wallet/spend
GET  /api/v1/wallet/:userId/balance?assetTypeId=asset-gold-coin-001
GET  /api/v1/wallet/:walletId/ledger
GET  /api/v1/wallet/:userId/stats
GET  /health
```

**Top-up example:**
```bash
curl -X POST http://localhost:3000/api/v1/wallet/topup \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: topup-001" \
  -d '{
    "userId": "user-rich-001",
    "assetTypeId": "asset-gold-coin-001",
    "amount": "100.00",
    "metadata": { "paymentProvider": "Stripe", "paymentId": "pi_123" }
  }'
```

---

## Technology Choices

| Component | Technology | Why |
|-----------|-----------|-----|
| Runtime | Node.js 22 | Non-blocking I/O suits high-throughput transaction workloads |
| Language | TypeScript 5.7 | Compile-time safety eliminates type errors in financial logic |
| Framework | Express.js | Minimal and predictable — full control over the request pipeline |
| Database | PostgreSQL 17 | ACID transactions, serializable isolation, `DECIMAL(19,8)` precision |
| Cache/Lock | Redis 7 | Sub-millisecond distributed locking and idempotency key storage |
| ORM | Prisma 6 | Type-safe queries + migration management |
| Validation | Zod | Runtime schema validation mirroring TypeScript types |

---

## Concurrency Strategy

Three layered defences handle concurrent requests:

### 1. Distributed Locking (Redis)
Before any wallet is modified, a Redis lock is acquired with a 30s TTL using `SET key token EX 30 NX`. Failed acquisitions retry with exponential backoff (100ms → 200ms → 400ms).

### 2. Deadlock Prevention via Ordered Lock Acquisition
When a transaction touches two wallets, both locks must be held simultaneously. Acquiring them in arbitrary order causes circular waits. **Solution:** wallet IDs are sorted lexicographically before locking — every thread acquires locks in the same order, making deadlocks structurally impossible.

```typescript
const sortedIds = [...walletIds].sort((a, b) => a.localeCompare(b));
for (const id of sortedIds) await acquireLock(`wallet:${id}`);
```

### 3. Optimistic Locking (Version Column)
Every wallet row has a `version` integer. Balance updates use `WHERE id = ? AND version = ?`. If another transaction already incremented the version, the update returns `count: 0` and throws `CONCURRENT_MODIFICATION`.

```sql
UPDATE wallets
SET balance = balance - $amount, version = version + 1
WHERE id = $id AND version = $expected_version
```

### 4. Serializable Isolation
All transactions run at `Serializable` isolation — the strongest PostgreSQL offers — preventing phantom reads and write skew.

### 5. Idempotency
Every write endpoint requires an `Idempotency-Key`. Results are cached in Redis for 24 hours. Duplicate requests return the cached result without re-executing. A `processing` flag prevents two concurrent identical requests from both executing.

---

## Double-Entry Ledger

Every transaction creates two immutable ledger entries — one debit, one credit.

```
Top-up 100 Gold for user-rich-001:

  wallet-treasury  │ DEBIT  │ 100.00 │ running: 9,999,900
  wallet-user1     │ CREDIT │ 100.00 │ running: 10,100
```

The `balance` column is a denormalised read cache; the ledger is the source of truth.

---

## Environment Variables

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wallet_db
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

## seed.sql

```sql
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
```
