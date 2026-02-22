# Internal Wallet Service

High-performance, ACID-compliant virtual currency wallet service with double-entry ledger architecture for gaming/loyalty platforms.

## ✅ Requirements Checklist

### Core Requirements
- [x] **Asset Types**: Gold Coins, Diamonds, Loyalty Points
- [x] **System Accounts**: Treasury (mint) & Revenue (sink) wallets
- [x] **User Accounts**: 2+ users with initial balances (user-rich-001, user-new-002)
- [x] **API Endpoints**: RESTful endpoints for all operations
- [x] **Wallet Top-up**: Purchase credits with idempotency
- [x] **Bonus/Incentive**: Grant free credits (referral/rewards)
- [x] **Purchase/Spend**: Spend credits on in-app items

### Critical Constraints
- [x] **Concurrency**: Distributed locking + optimistic locking
- [x] **Race Conditions**: Ordered lock acquisition prevents deadlocks
- [x] **Idempotency**: Redis-based deduplication (24h retention)

### Brownie Points
- [x] **Deadlock Avoidance**: Consistent UUID ordering + distributed locks
- [x] **Ledger-Based Architecture**: Double-entry bookkeeping (immutable records)
- [x] **Containerization**: Docker + Docker Compose with health checks
- [ ] **Hosting**: (Optional - deploy to your preferred cloud)

## 🚀 Quick Start

### Option 1: Docker (Recommended)
```bash
# Start all services (DB, Redis, App, Migrations, Seed)
docker-compose up --build

# Service available at http://localhost:3000
# Health check: http://localhost:3000/health
```

### Option 2: Local Development
```bash
# 1. Install dependencies
npm install

# 2. Start PostgreSQL & Redis locally
# (Use Docker for DB/Redis if preferred)

# 3. Setup environment
cp .env.example .env
# Edit .env with your database credentials

# 4. Run migrations
npx prisma migrate dev

# 5. Seed database
npm run db:seed

# 6. Start development server
npm run dev
```

## 📚 API Documentation

### Authentication
All endpoints require `Idempotency-Key` header for write operations.

### Endpoints

#### 1. Wallet Top-up (Purchase)
```http
POST /api/v1/wallet/topup
Idempotency-Key: <unique-uuid>

{
  "userId": "user-rich-001",
  "assetTypeId": "asset-gold-coin-001",
  "amount": "100.00",
  "metadata": {
    "paymentProvider": "Stripe",
    "paymentId": "pi_123456"
  }
}
```

#### 2. Grant Bonus (Referral/Reward)
```http
POST /api/v1/wallet/bonus
Idempotency-Key: <unique-uuid>

{
  "userId": "user-new-002",
  "assetTypeId": "asset-loyalty-001",
  "amount": "50.00",
  "reason": "Referral bonus",
  "metadata": {
    "campaign": "Spring2026",
    "referredBy": "user-rich-001"
  }
}
```

#### 3. Spend Credits (Purchase)
```http
POST /api/v1/wallet/spend
Idempotency-Key: <unique-uuid>

{
  "userId": "user-rich-001",
  "assetTypeId": "asset-gold-coin-001",
  "amount": "30.00",
  "serviceDescription": "Legendary Sword",
  "metadata": {
    "itemId": "item-123",
    "category": "weapons"
  }
}
```

#### 4. Check Balance
```http
GET /api/v1/wallet/:userId/balance?assetTypeId=asset-gold-coin-001
```

#### 5. Ledger History
```http
GET /api/v1/wallet/:walletId/ledger?limit=50&offset=0
```

## 🏗️ Technology Stack

| Component | Technology | Version | Justification |
|-----------|-----------|---------|---------------|
| **Runtime** | Node.js | 22 LTS | Proven in fintech, event-loop for I/O-bound transactions |
| **Language** | TypeScript | 5.7 | Type safety for financial calculations |
| **Framework** | Express.js | 4.21 | Lightweight, battle-tested, extensive middleware |
| **Database** | PostgreSQL | 17 | ACID compliance, row-level locking, JSON support |
| **Cache** | Redis | 7 | Distributed locking, idempotency, balance caching |
| **ORM** | Prisma | 6.3 | Type-safe queries, migration management |
| **Validation** | Zod | 3.24 | Runtime type validation |
| **Container** | Docker | 24+ | Consistent environments, easy deployment |

## 🔒 Concurrency Strategy

### 1. Deadlock Prevention
```
Problem: Concurrent transactions on same wallets can cause circular waits

Solution: Consistent Resource Ordering
- All wallet locks acquired in ascending UUID order
- Distributed Redis locks with 30s TTL
- Automatic retry with exponential backoff
```

### 2. Optimistic Locking
```sql
-- Version column prevents lost updates
UPDATE wallets 
SET balance = balance - amount, version = version + 1
WHERE id = ? AND version = ?  -- Fails if version changed
```

### 3. Database Isolation
```typescript
// Serializable isolation prevents phantom reads
prisma.$transaction(async (tx) => {
  // All operations...
}, {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable
});
```

### 4. Idempotency
- Redis stores transaction results for 24 hours
- Duplicate requests return cached result instantly
- Processing flags prevent concurrent execution

## 📊 Database Schema

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   AssetType     │     │     Wallet      │     │  LedgerEntry    │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ id (PK)         │◄────┤ assetTypeId(FK) │     │ id (PK)         │
│ code (unique)   │     │ id (PK)         │◄────┤ walletId (FK)   │
│ name            │     │ ownerId         │     │ transactionId   │
│ description     │     │ ownerType       │     │ entryType       │
└─────────────────┘     │ balance         │     │ amount          │
                        │ version         │     │ runningBalance  │
                        └─────────────────┘     │ description     │
                                │               │ createdAt       │
                                │               └─────────────────┘
                                │
                        ┌───────┴───────┐
                        │  Transaction  │
                        ├───────────────┤
                        │ id (PK)       │
                        │ type          │
                        │ status        │
                        │ idempotencyKey│
                        │ metadata      │
                        └───────────────┘
```

## 🧪 Testing

```bash
# Run unit tests
npm test

# Load test with k6 (install k6 first)
k6 run tests/load-test.js

# Manual concurrency test
for i in {1..10}; do
  curl -X POST http://localhost:3000/api/v1/wallet/spend \
    -H "Idempotency-Key: test-$i-$(date +%s)" \
    -H "Content-Type: application/json" \
    -d '{
      "userId": "user-rich-001",
      "assetTypeId": "asset-gold-coin-001",
      "amount": "10.00",
      "serviceDescription": "Load Test Item"
    }' &
done
```

## 🌐 Deployment

### Railway/Render
1. Push to GitHub
2. Connect to Railway/Render
3. Add PostgreSQL and Redis plugins
4. Set environment variables
5. Deploy!

### AWS ECS
```bash
# Build and push to ECR
docker build -t wallet-service .
docker tag wallet-service:latest <account>.dkr.ecr.<region>.amazonaws.com/wallet-service:latest
docker push <account>.dkr.ecr.<region>.amazonaws.com/wallet-service:latest

# Deploy with ECS CLI or Terraform
```

## 📈 Monitoring

- **Logs**: Winston JSON logging to `logs/`
- **Health**: `/health` endpoint for load balancers
- **Metrics**: Prisma query metrics (enable in production)
- **Tracing**: OpenTelemetry compatible structure

## 🛡️ Security Features

- Helmet.js security headers
- CORS configuration
- Rate limiting (100 req/15min general, 10 req/min transactions)
- Input validation with Zod
- SQL injection prevention (Prisma ORM)
- No sensitive data in logs

## 📝 License

MIT License - Internal use for Dino Ventures assignment

---

**Built with ❤️ using Node.js + TypeScript + PostgreSQL + Redis**
