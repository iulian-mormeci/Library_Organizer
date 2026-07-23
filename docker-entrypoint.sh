#!/bin/sh
set -e

echo "[entrypoint] waiting for postgres and applying migrations..."
npx prisma migrate deploy

echo "[entrypoint] starting Next.js server..."
exec npm run start
