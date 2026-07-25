#!/bin/sh
set -e

# Direct binary invocation instead of npx/npm run: the container runs as
# the non-root "node" user (UID/GID 1000, set via docker-compose.yml's
# `user:`, to match the NFS export's file owner), and this sidesteps any
# npm-specific cache/config resolution under that user entirely — both
# binaries are already present in node_modules/.bin from the build, no
# resolution or network access needed either way.

echo "[entrypoint] waiting for postgres and applying migrations..."
./node_modules/.bin/prisma migrate deploy

echo "[entrypoint] starting Next.js server..."
exec ./node_modules/.bin/next start
