# Multi-stage build for Next.js UI

# Stage 1: Dependencies
FROM node:24-alpine AS deps
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Stage 2: Builder
FROM node:24-alpine AS builder
WORKDIR /app

# Install git for downloading meshes from GitHub
RUN apk add --no-cache git

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Download robot meshes from GitHub before build
# Use git sparse checkout to only download the meshes directory
# Copy to public/assets/ffw_description/meshes (not just ffw_description) to match URDF path
RUN mkdir -p public/assets/ffw_description && \
    cd /tmp && \
    git clone --filter=blob:none --sparse --depth=1 \
        --branch main \
        https://github.com/ROBOTIS-GIT/ai_worker.git && \
    cd ai_worker && \
    git sparse-checkout set ffw_description/meshes && \
    cp -r ffw_description/meshes /app/public/assets/ffw_description/ && \
    cd / && \
    rm -rf /tmp/ai_worker && \
    echo "✅ Meshes downloaded: $(find /app/public/assets/ffw_description -type f | wc -l) files" && \
    echo "📁 Sample files:" && \
    find /app/public/assets/ffw_description -type f | head -5 || echo "⚠️  Mesh download failed, continuing build..."

# Build Next.js application
RUN npm run build

# Stage 3: Runner
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy package.json and package-lock.json for production dependencies
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json* ./package-lock.json

# Install only production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy built application
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next

# Set ownership
RUN chown -R nextjs:nodejs /app

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Start the application
CMD ["npm", "start"]
