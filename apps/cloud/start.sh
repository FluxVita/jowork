#!/bin/sh
set -eu

cd /app/apps/cloud
exec npx tsx src/server.ts
