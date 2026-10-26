FROM node:26-alpine AS builder
RUN apk add --no-cache openssl ca-certificates
WORKDIR /app

# Dependency layer — cache-friendly: only rerun when package*.json changes
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --legacy-peer-deps && npm cache clean --force

# Source & build
COPY . .
# Install the optional MCP add-on dependencies inside the image; they remain isolated from root app dependencies.
RUN npm ci --prefix mcp/wa-akg-mcp --omit=dev
RUN npx prisma generate && npm run build

# Strip devDeps from node_modules after build
# tsx needed at runtime, kept explicitly
RUN npm prune --omit=dev && npm install --no-save tsx typescript prisma@5.22.0

# Production image
FROM node:26-alpine AS runner
RUN apk add --no-cache openssl ca-certificates
WORKDIR /app

COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/swagger.json ./swagger.json
COPY --from=builder --chown=node:node /app/tsconfig.json ./
COPY --from=builder --chown=node:node /app/scripts ./scripts
COPY --from=builder --chown=node:node /app/mcp/wa-akg-mcp ./mcp/wa-akg-mcp

# Create data directories with appropriate non-root ownership
RUN mkdir -p /app/data/media /app/data/auth && chown -R node:node /app/data

USER node

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

CMD ["node", "scripts/container-start.js", "app"]
