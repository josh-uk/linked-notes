FROM node:24-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run prisma:generate && npm run build

FROM dependencies AS migrate
COPY prisma ./prisma
CMD ["npx", "prisma", "migrate", "deploy"]

FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    ATTACHMENTS_DIR=/data/attachments \
    CHROMIUM_PATH=/usr/bin/chromium
RUN apk add --no-cache chromium ca-certificates \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs --home /app nextjs \
    && mkdir -p /data/attachments \
    && chown -R nextjs:nodejs /data/attachments \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Next's standalone file tracing omits Playwright's browsers.json registry even
# though playwright-core loads it at runtime. Keep the complete pinned runtime
# beside the traced modules; Chromium itself remains supplied by Alpine.
COPY --from=dependencies --chown=nextjs:nodejs /app/node_modules/playwright-core ./node_modules/playwright-core
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
