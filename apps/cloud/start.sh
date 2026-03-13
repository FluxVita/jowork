#!/bin/sh
set -eu

cd /app/apps/cloud
npx drizzle-kit push --force
exec npx tsx src/server.ts
