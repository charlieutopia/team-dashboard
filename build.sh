#!/bin/bash
set -ex

echo "=== Node version ==="
node --version

echo "=== Setting up pnpm ==="
corepack prepare pnpm@10 --activate

echo "=== pnpm version ==="
pnpm --version

echo "=== Installing dependencies ==="
pnpm install --frozen-lockfile

echo "=== Building shared package ==="
pnpm --filter @team-dashboard/shared build

echo "=== Building dashboard app ==="
pnpm --filter @team-dashboard/dashboard build

echo "=== Build complete ==="
