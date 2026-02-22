# Multi-stage build for production optimization
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

# Copy source and build
COPY . .

# Run build with verbose output so errors are visible
RUN npm run build || (echo "=== BUILD FAILED - TypeScript errors ===" && cat tsconfig.json && exit 1)

# Verify dist was actually created
RUN ls -la dist/ && echo "=== dist/app.js exists ===" && ls dist/app.js

# Production stage
FROM node:22-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev && npm cache clean --force

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Create logs directory
RUN mkdir -p logs

# Keep as root for now to avoid permission issues

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Use ENTRYPOINT script to ensure sequential execution
ENTRYPOINT ["sh", "-c", "echo 'DATABASE_URL is: ' ${DATABASE_URL:+SET} && npx prisma generate && echo 'Prisma generated, running migrations...' && npx prisma migrate deploy && echo 'Migrations done, starting server...' && exec node dist/app.js"]