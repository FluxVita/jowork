# Contributing to Jowork

Thank you for your interest in contributing to Jowork!

## Repository Structure

This is a pnpm monorepo:

```
packages/
  core/       — Open-source core (AGPL-3.0)
  premium/    — Premium features (AGPL-3.0, source-available)
apps/
  jowork/     — Community edition app (AGPL-3.0)
  fluxvita/   — Internal enterprise edition (UNLICENSED)
public/       — Shared Web UI assets
src/          — Legacy root entry (bridges to packages/core)
```

## Development Setup

```bash
# Install dependencies
pnpm install

# Build core package (required first)
pnpm --filter @jowork/core build

# Start Jowork in dev mode
pnpm --filter @jowork/app dev
```

## Guidelines

- **TypeScript strict mode** — all new code must pass `tsc --noEmit`
- **ESM modules** — use `.js` extensions in imports (even for `.ts` source files)
- **KISS/DRY** — keep it simple, avoid duplication
- **No breaking changes** to public `@jowork/core` APIs without a major version bump

## Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Ensure `pnpm --filter @jowork/core build` succeeds
5. Ensure `pnpm --filter @jowork/app lint` passes
6. Submit a PR with a clear description

## Adding a Connector

1. Create `packages/core/src/connectors/{name}/index.ts` implementing `ConnectorBase`
2. Register in `packages/core/src/connectors/registry.ts`
3. Add to `apps/jowork/src/index.ts`

## Reporting Issues

Please open an issue on GitHub with:
- Steps to reproduce
- Expected vs actual behavior
- Node.js version, OS
