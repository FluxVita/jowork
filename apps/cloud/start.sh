#!/bin/sh
set -eu

cd /app/apps/cloud
exec node_modules/.bin/tsx dist/server.js
