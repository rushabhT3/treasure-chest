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

# Security: Run as non-root user - BUT NOT YET
# RUN addgroup -g 1001 -S nodejs
# RUN adduser -S nodejs -u 1001

# Generate prisma as root (needs write access to node_modules)
# Then migrate and start
CMD sh -c "npx prisma generate && npx prisma migrate deploy && node dist/app.js"

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"