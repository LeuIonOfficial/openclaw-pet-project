FROM node:22-bookworm-slim AS deps
WORKDIR /workspace/app
COPY app/package.json app/package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /workspace
COPY --from=deps /workspace/app/node_modules ./app/node_modules
COPY app ./app
COPY openclaw ./openclaw
WORKDIR /workspace/app
RUN mkdir -p public
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /workspace/app/public ./public
COPY --from=builder /workspace/app/.next/standalone ./
COPY --from=builder /workspace/app/.next/static ./.next/static
COPY --from=builder /workspace/app/scripts ./scripts
EXPOSE 3000
CMD ["sh", "-lc", "node ./scripts/bootstrap-identity.mjs && node ./scripts/prepair-openclaw.mjs && node server.js"]
