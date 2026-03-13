# CLAUDE.md

Project context and AI instructions for Claude Code sessions on this repository.

## What is Paperclip

Paperclip is an open-source **control plane for AI-agent companies**. It orchestrates teams of AI agents with org charts, budgets, governance, goal alignment, and task management. The current implementation target is **V1** as defined in `doc/SPEC-implementation.md`.

**Core principle:** You should be able to look at Paperclip and understand your entire autonomous AI company at a glance — who's doing what, how much it costs, and whether it's working.

## Required Reading (in order)

1. `doc/GOAL.md` — vision and architecture overview
2. `doc/PRODUCT.md` — product definition
3. `doc/SPEC-implementation.md` — concrete V1 build contract (source of truth)
4. `doc/DEVELOPING.md` — full development guide
5. `doc/DATABASE.md` — database modes and setup

`doc/SPEC.md` is long-horizon product context (future roadmap).

## Tech Stack

| Layer        | Technology                                            |
| ------------ | ----------------------------------------------------- |
| Runtime      | Node.js 20+, TypeScript (ES2023, NodeNext modules)    |
| Server       | Express 5 REST API                                    |
| UI           | React + Vite (served by API server in dev middleware)  |
| Database     | PostgreSQL via Drizzle ORM (embedded PGlite in dev)   |
| Package mgr  | pnpm 9+ (monorepo with workspaces)                    |
| Build        | tsc (server), Vite (UI), esbuild (CLI)                |
| Testing      | Vitest, Playwright (e2e)                               |

## Monorepo Structure

```
paperclip/
├── server/              # Express REST API + orchestration services
│   └── src/
│       ├── routes/      # 18 route modules (agents, issues, companies, goals, etc.)
│       ├── services/    # 22 service modules (heartbeat, approvals, costs, etc.)
│       ├── middleware/  # Auth, error handling, company access
│       ├── auth/        # Authentication (better-auth)
│       ├── secrets/     # Secret management (local encrypted)
│       ├── storage/     # File storage (local disk / S3)
│       ├── realtime/    # WebSocket live events
│       └── adapters/    # Server-side adapter orchestration
├── ui/                  # React + Vite board UI
│   └── src/
│       ├── pages/       # Company-scoped page views
│       ├── components/  # Reusable UI components
│       ├── api/         # API client functions
│       ├── hooks/       # React hooks
│       ├── context/     # React context providers
│       └── adapters/    # UI adapter displays
├── packages/
│   ├── db/              # Drizzle schema (34 tables), migrations, DB client
│   ├── shared/          # Shared types, constants, validators, API paths
│   ├── adapter-utils/   # Common adapter utilities
│   └── adapters/        # Agent runtime adapters
│       ├── claude-local/
│       ├── codex-local/
│       ├── cursor-local/
│       ├── openclaw-gateway/
│       ├── opencode-local/
│       └── pi-local/
├── cli/                 # CLI client (paperclipai command)
├── doc/                 # Product specs, architecture, operational docs
├── scripts/             # Dev runner, smoke tests, release scripts
└── tests/               # e2e tests (Playwright)
```

## Dev Setup

Leave `DATABASE_URL` **unset** — embedded PostgreSQL runs automatically.

```sh
pnpm install
pnpm dev
```

**Windows note:** `pnpm dev` may fail because `dev:watch` uses Unix-style inline env vars. Use instead:

```powershell
$env:PAPERCLIP_MIGRATION_PROMPT="never"
$env:PAPERCLIP_UI_DEV_MIDDLEWARE="true"
pnpm --filter @paperclipai/server dev
```

This starts API + UI at `http://localhost:3100`.

### Health checks

```sh
curl http://localhost:3100/api/health    # → {"status":"ok"}
curl http://localhost:3100/api/companies # → JSON array
```

### Reset dev DB

```sh
# Delete embedded Postgres data
rm -rf ~/.paperclip/instances/default/db
pnpm dev
```

## Key Commands

```sh
./start               # Docker: Postgres + server (from repo root; needs .env)
pnpm dev              # Full dev (API + UI, watch mode)
pnpm dev:once         # Dev without file watching
pnpm dev:server       # Server only
pnpm build            # Build all packages
pnpm -r typecheck     # Typecheck all packages
pnpm test:run         # Run unit tests (Vitest)
pnpm test:e2e         # Run e2e tests (Playwright)
pnpm db:generate      # Generate DB migration after schema change
pnpm db:migrate       # Apply migrations
```

## Core Engineering Rules

### 1. Company-scoped everything

Every domain entity must be scoped to a company. Company boundaries are enforced in routes and services. Never let an agent or entity leak across company boundaries.

### 2. Synchronize all contracts

A change to schema or API must update **all** impacted layers:

- `packages/db` — schema and exports
- `packages/shared` — types, constants, validators
- `server` — routes and services
- `ui` — API clients and pages

### 3. Preserve control-plane invariants

- **Single-assignee task model** — one agent per task at a time
- **Atomic issue checkout** — no double-work
- **Approval gates** — governed actions require board approval
- **Budget hard-stop** — agents auto-pause when budget is exhausted
- **Activity logging** — all mutations are logged

### 4. Database changes follow a strict workflow

```sh
# 1. Edit schema
#    packages/db/src/schema/*.ts

# 2. Export from index
#    packages/db/src/schema/index.ts

# 3. Generate migration
pnpm db:generate

# 4. Validate
pnpm -r typecheck
```

> `packages/db/drizzle.config.ts` reads compiled schema from `dist/schema/*.js`.
> `pnpm db:generate` compiles `packages/db` first.

## API and Auth

- Base path: `/api`
- **Board access** = full-control operator context (no auth in `local_trusted` mode)
- **Agent access** = bearer API keys (`agent_api_keys` table, hashed at rest)
- Agent keys are company-scoped — must not access other companies

When adding endpoints:

- Apply `assertBoard` or `assertCompanyAccess` checks
- Enforce actor permissions (board vs agent)
- Write activity log entries for mutations
- Return consistent HTTP errors: `400 / 401 / 403 / 404 / 409 / 422 / 500`

## Security Rules (mandatory)

- **No secrets in source code.** Keys/tokens live in env vars only. Never commit `.env` files.
- **Production = `authenticated` mode.** `local_trusted` grants full admin with no auth — never use on public servers.
- **Database never exposed** to the public internet.
- **Server-side authorization only.** Never rely on UI-only access checks.
- **MIME validation via magic numbers** (`file-type`), not client `Content-Type`.
- **No stack traces in responses.** Use the `errorHandler` middleware.

## UI Rules

- Routes and nav must align with the available API surface
- Use company selection context for company-scoped pages
- Surface errors clearly — never silently ignore API failures

## Verification Before Done

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
```

A change is **done** when:

1. Behavior matches `doc/SPEC-implementation.md`
2. Typecheck, tests, and build all pass
3. Contracts are synced across db → shared → server → ui
4. Docs updated if behavior or commands changed

## Documentation Map

| File                           | Purpose                                |
| ------------------------------ | -------------------------------------- |
| `doc/GOAL.md`                  | Vision, architecture overview          |
| `doc/PRODUCT.md`               | Product definition                     |
| `doc/SPEC.md`                  | Long-horizon product spec              |
| `doc/SPEC-implementation.md`   | V1 build contract (source of truth)    |
| `doc/DEVELOPING.md`            | Full development guide                 |
| `doc/DATABASE.md`              | Database modes and setup               |
| `doc/DEPLOYMENT-MODES.md`      | local_trusted vs authenticated         |
| `doc/DOCKER.md`                | Docker setup and quickstart            |
| `doc/CLI.md`                   | CLI command reference                  |
| `doc/PUBLISHING.md`            | npm publishing guide                   |
| `doc/RELEASING.md`             | Release process                        |
| `doc/TASKS.md`                 | Task management spec                   |
| `doc/TASKS-mcp.md`             | MCP task integration                   |
| `doc/CLIPHUB.md`               | ClipHub (company templates) spec       |
| `doc/OPENCLAW_ONBOARDING.md`   | OpenClaw agent onboarding              |

## Environment Variables (key ones)

| Variable                    | Purpose                                         | Default         |
| --------------------------- | ----------------------------------------------- | --------------- |
| `DATABASE_URL`              | Postgres connection (unset = embedded PGlite)   | _(unset)_       |
| `PORT`                      | Server port                                     | `3100`          |
| `PAPERCLIP_DEPLOYMENT_MODE` | `local_trusted` or `authenticated`              | `local_trusted` |
| `PAPERCLIP_UI_DEV_MIDDLEWARE` | Serve UI via API server dev middleware          | `true` in dev   |
| `PAPERCLIP_HOME`            | Override home directory                         | `~/.paperclip`  |
| `PAPERCLIP_INSTANCE_ID`     | Override instance identifier                    | `default`       |
| `PAPERCLIP_SECRETS_STRICT_MODE` | Require secret refs for sensitive env keys  | `false`         |
| `PAPERCLIP_ENABLE_COMPANY_DELETION` | Allow company deletion                  | mode-dependent  |

## Adapters (Bring Your Own Agent)

Paperclip doesn't run agents — it orchestrates them. Agents run externally and phone home via adapters:

| Adapter                 | Purpose                           |
| ----------------------- | --------------------------------- |
| `claude-local`          | Claude Code (local terminal)      |
| `codex-local`           | OpenAI Codex (local)              |
| `cursor-local`          | Cursor IDE agent (local)          |
| `openclaw-gateway`      | OpenClaw remote agent gateway     |
| `opencode-local`        | OpenCode (local)                  |
| `pi-local`              | Pi agent (local)                  |

## Contributing

See `CONTRIBUTING.md`. Two paths:

1. **Small fixes** — focused, minimal files, clean PRs → merge fast
2. **Bigger changes** — discuss in Discord `#dev` first, then build with before/after proof
