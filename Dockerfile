FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

FROM node:20-bookworm-slim AS builder
WORKDIR /app

# node:20-bookworm-slim doesn't pull in a system libssl by default (Node
# statically bundles its own OpenSSL). Without it, `prisma generate`'s
# auto-detection of the "native" engine target can't reliably probe the
# platform's actual OpenSSL version — installing it here, before
# `prisma generate` runs, keeps detection accurate and matches the runner
# stage below. binaryTargets in schema.prisma is the real safety net
# either way: it bundles the debian-openssl-3.0.x engine explicitly, so
# generation is correct even if this detection step were ever skipped.
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# libchromaprint-tools provides /usr/bin/fpcalc, used by src/lib/fingerprint.ts
# to compute Chromaprint audio fingerprints (level-3 dedup matching).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libchromaprint-tools \
    ca-certificates \
    openssl \
    && rm -rf /var/lib/apt/lists/*

RUN fpcalc -version

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# All COPY layers above ran as root (the default until a container is
# actually started), so everything under /app is currently root-owned.
# docker-compose.yml runs this image as user "1000:1000" — the UID/GID
# node:20-bookworm-slim already provisions as the "node" user for exactly
# this purpose (matches the file owner on a TrueNAS NFS export, and avoids
# the classic Node crash from running as a numeric UID with no /etc/passwd
# entry) — so hand ownership of the app directory to that user explicitly
# rather than relying on "other" read/execute bits being permissive enough.
RUN chown -R node:node /app

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
