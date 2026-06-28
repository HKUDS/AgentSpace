# Contributing to AgentSpace

Thank you for your interest in contributing to AgentSpace — the agent-native collaborative workspace where humans and agents work as one team. This is an actively developed project and community contributions are very welcome.

## Table of Contents

- [Before You Start](#before-you-start)
- [Ways to Contribute](#ways-to-contribute)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Adding a New AgentRouter Harness](#adding-a-new-agentrouter-harness)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Code Style](#code-style)
- [Community](#community)

---

## Before You Start

- Browse the [open issues](https://github.com/HKUDS/AgentSpace/issues) to find something to work on, or to check whether your idea is already tracked.
- Issue creation is currently restricted — please comment on an existing issue to claim it before starting work, or open a PR directly with a clear description of what you changed and why.
- For significant changes (new harnesses, new services, architectural changes), leave a comment first so maintainers can confirm direction before you invest time.

---

## Ways to Contribute

### Bug Fixes
Found something broken? Open a PR with a clear description of the problem, the root cause, and how your fix addresses it. Include reproduction steps where possible.

### New AgentRouter Harness
AgentRouter currently supports Claude Code, Codex, OpenClaw, and Hermes as full harnesses. Adding a new provider as a first-class harness (with proper session handling, event normalization, and diagnostics) is one of the highest-impact contributions. See [Adding a New AgentRouter Harness](#adding-a-new-agentrouter-harness) below for a step-by-step guide.

### Daemon & Provider Improvements
The daemon package (`packages/daemon/`) handles remote execution, runtime sharing, and AgentRouter integration. Improvements to concurrency, session reliability, provider health checks, or timeout handling are all welcome.

### Documentation
Clear docs lower the barrier for the whole community. Good doc PRs include:
- Improving setup or configuration instructions in `README.md`
- Adding per-provider CLI notes to `packages/daemon/README.md`
- Expanding deployment examples in `deploy/`
- Translating or improving the Chinese README (`README_ZH.md`)

### Tests & Quality
Adding test coverage to `apps/web/` or `packages/` via the existing test setup is always welcome. Run `npm run test:web` and `npm run test:e2e:web` to see what's currently covered.

### UI & Workspace Improvements
The web workspace (`apps/web/`) is a Next.js App Router application. Improvements to the agent board, permission control plane, approval flows, task views, or general UX are all fair game.

---

## Development Setup

### Requirements

- **Node.js** 24+ recommended (daemon package requires `>=20.20.0`)
- **npm** 11.x
- **PostgreSQL** 16 recommended (local Docker Compose setup included)
- Optional provider CLIs for local testing: `claude`, `codex`, `gemini`, `opencode`, `openclaw`, `nanobot`, `hermes`

### Steps

```bash
# 1. Fork the repo, then clone your fork
git clone https://github.com/YOUR-USERNAME/AgentSpace.git
cd AgentSpace

# 2. Install all workspace dependencies
npm run setup

# 3. Configure environment
cp .env.example .env
# Edit .env with your local values (database URL, provider keys, etc.)

# 4. Start PostgreSQL via Docker
docker compose -f deploy/postgres/docker-compose.yml up -d

# 5. Initialize the database
npm run db:pg:init

# 6. Start the web workspace
npm run dev:web
```

Open `http://127.0.0.1:1455` in your browser.

### Useful Commands

```bash
# Development
npm run dev:web          # Start the web app
npm run cli -- help      # Explore the CLI
npm run cli -- doctor    # Check system health

# Quality checks (run before every PR)
npm run build            # Full production build
npm run typecheck        # TypeScript strict check
npm run lint:web         # ESLint on the web app
npm run test:web         # Unit tests
npm run test:e2e:web     # End-to-end tests
npm run quality:web      # Lint + typecheck + test together

# Database
npm run db:pg:status     # Check DB connection
npm run db:pg:migrate    # Run migrations

# Daemon
npm run daemon:pack      # Pack the daemon for remote deployment
```

---

## Project Structure

```
AgentSpace/
├── apps/
│   ├── web/             # Next.js App Router workspace UI (main product)
│   └── cli/             # Local control CLI (agent-space CLI)
├── packages/
│   ├── domain/          # Shared domain model and daemon API types
│   ├── db/              # PostgreSQL persistence, migrations, runtime records
│   ├── services/        # Business logic used by both web and CLI
│   ├── daemon/          # Remote daemon + AgentRouter CLI (agent-router)
│   └── sandbox/         # Sandbox abstraction and local adapter
├── deploy/              # systemd units, nginx configs, postgres setup, install scripts
└── asset/               # Product images, GIFs, demo videos
```

Key files to know:
- `packages/daemon/` — where AgentRouter harnesses live
- `packages/services/` — business logic for tasks, approvals, permissions, agents
- `packages/db/` — all database schema and queries
- `apps/web/` — the Next.js workspace UI

---

## Adding a New AgentRouter Harness

This is one of the most impactful contribution types. AgentRouter harnesses differ from the legacy provider-runtime path in that they normalize events, sessions, outputs, and diagnostics across providers.

Here's the pattern to follow:

**1. Study an existing harness**
Look at how Claude Code and Codex are implemented inside `packages/daemon/`. Each harness handles:
- Launch / process management
- Event streaming and normalization (session start, tool calls, output, completion)
- Session fallback behavior
- Diagnostics (auth check, model availability, tool capability detection)

**2. Implement your harness**
Create a new harness module that exports the same interface contract as the existing ones. At minimum it should handle:
- `run(options)` — launch the provider CLI and stream normalized events
- `detect()` — check whether the provider is installed and authenticated
- `diagnostics()` — return structured health info (auth, model, tools, protocol)

**3. Register it in AgentRouter**
Add your harness to the AgentRouter harness registry so it appears in `agent-router harnesses` output and can be selected via `agent-router run --harness <name>`.

**4. Update the README table**
Add your provider to the AgentRouter table in `README.md` with its execution path and diagnostic capabilities.

**5. Test it**
```bash
agent-router detect
agent-router harnesses
agent-router run --harness <your-provider> --cwd /tmp "hello world"
```

**6. Open a PR** referencing the relevant issue if one exists.

---

## Submitting a Pull Request

1. Create a branch from `main`:
   ```bash
   git checkout -b your-branch-name
   ```

2. Make your changes and run quality checks:
   ```bash
   npm run quality:web
   npm run typecheck
   ```

3. Commit with a clear, descriptive message:
   ```
   feat(daemon): add OpenCode AgentRouter harness with session normalization
   fix(web): resolve approval queue not refreshing after agent action
   docs: add CONTRIBUTING.md
   ```

4. Push and open a PR against `main`. In your PR description include:
   - What you changed and why
   - How to test it
   - A reference to the related issue if applicable (`Closes #1`, `Fixes #6`)

5. Keep PRs focused — one logical change per PR is much easier to review and merge.

---

## Code Style

- **TypeScript strict** — `noImplicitAny`, no unchecked `any` unless genuinely unavoidable
- **Monorepo imports** — use workspace package paths (`@agent-space/domain`, `@agent-space/db`, etc.), not relative cross-package imports
- **No dead code** — remove unused imports, variables, and commented-out blocks before submitting
- **ESLint** — run `npm run lint:web` and fix all warnings before opening a PR
- **Consistent error handling** — match the existing patterns in `packages/services/` for structured errors and diagnostics

---

## Community

- **Feishu / WeChat groups** — see the [HKUDS org profile](https://github.com/HKUDS/.github/blob/main/profile/README.md) for links to join the community
- **Issues** — use existing issues to discuss bugs and features (issue creation is currently restricted)
- **Pull Requests** — maintainers aim to review promptly; please respond to feedback within a reasonable time

---

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](./LICENSE).
