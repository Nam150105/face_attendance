FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json .
RUN npm install

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# MapLibre 6 parses tiles in a module worker it locates from its own
# import.meta.url, which a bundled chunk does not have. The worker and the
# module it imports are served as plain files instead; GeoMap points the
# library at them with setWorkerUrl().
RUN mkdir -p public/maplibre  && cp node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs public/maplibre/
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
