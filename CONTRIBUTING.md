# Contributing to Jowork

Thank you for your interest in contributing to Jowork! This document explains how to get involved.

## Ways to Contribute

- **Bug reports** — Open a GitHub Issue with steps to reproduce
- **Feature requests** — Start a GitHub Discussion before opening a PR
- **Code** — See the development guide below
- **Documentation** — Fix typos, improve examples, translate content
- **Connectors** — Build new connectors using the [JCP protocol](docs/JOWORK-PLAN.md)
- **Locales** — Add translations for your language

## Development Setup

### Prerequisites

- Node.js 22+
- pnpm 10+ (`npm install -g pnpm`)
- Git

### Getting Started

```bash
git clone https://github.com/fluxvita/jowork
cd jowork
pnpm install

# Build the core package
pnpm --filter @jowork/core build

# Run tests
pnpm test

# Run lint
pnpm lint

# Start the open-source app (dev mode)
pnpm --filter @jowork/app build
node apps/jowork/dist/index.js
# → http://localhost:18800
```

### Project Structure

```
jowork/
  packages/
    core/          # @jowork/core — AGPL-3.0, gateway + agent engine
    premium/       # @jowork/premium — commercial license (not for external PRs)
  apps/
    jowork/        # Open-source Tauri desktop app + Express gateway
  docs/            # Documentation and planning
  scripts/         # Dev tooling
```

### Key Conventions

- **TypeScript strict mode** — All code must pass `tsc --noEmit`
- **Express 5 wildcards** — Use `/{*path}`, not `*`
- **Path handling** — Always use `node:path` functions, never string concatenation
- **Platform checks** — Use `platform.ts` helpers, never raw `process.platform`
- **No dotenv** — Config is parsed manually in `packages/core/src/config.ts`
- **DB migrations** — Use `CREATE TABLE IF NOT EXISTS` pattern

## Submitting a Pull Request

1. Fork the repo and create a branch from `main`
2. Make your changes with tests
3. Run `pnpm lint && pnpm test` — both must pass
4. Write a clear PR description explaining *why*, not just *what*
5. Reference any related issues (`Fixes #123`)

### Commit Format

```
feat(scope): short description
fix(scope): short description
chore(scope): short description
docs(scope): short description
test(scope): short description
```

## Adding a Connector

Connectors follow the [Jowork Connect Protocol (JCP)](docs/JOWORK-PLAN.md).

```typescript
// packages/core/src/connectors/myservice.ts
import type { JCPConnector } from './protocol.js';

export const myServiceConnector: JCPConnector = {
  id: 'my-service',
  name: 'My Service',
  version: '1.0.0',
  capabilities: ['fetch'],
  discover: async (cfg) => { /* ... */ },
  fetch: async (refs, cfg) => { /* ... */ },
};
```

Register it in `packages/core/src/connectors/index.ts` and add tests.

## Adding a Locale

Translations live in `packages/core/src/i18n.ts`. To add a new language:

```typescript
import { registerLocale } from '@jowork/core';

registerLocale('de', {
  'error.not_found': 'Nicht gefunden',
  'ui.new_chat': 'Neuer Chat',
  // ... all keys from the 'en' locale
});
```

You can ship this as a separate npm package (e.g. `@jowork/locale-de`) or submit a PR to add it to core.

## Reporting Security Issues

**Do not open a public GitHub Issue for security vulnerabilities.**

Email `security@jowork.work` with details. We follow responsible disclosure and aim to respond within 48 hours.

## License

By contributing to Jowork, you agree that your contributions will be licensed under the [AGPL-3.0 License](LICENSE).

Premium features in `packages/premium/` are under a separate commercial license and are not open for external contributions.
