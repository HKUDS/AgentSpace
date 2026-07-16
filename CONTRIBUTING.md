# Contributing to AgentSpace

Thank you for your interest in contributing to AgentSpace! We appreciate community contributions of all sizes, from documentation improvements to bug fixes and new features.

## Before You Start

- Check the existing issues and pull requests before starting work.
- For larger changes or new features, discuss your proposal with the maintainers first.
- Keep contributions focused. Smaller pull requests are easier to review and merge.

## Development Setup

Please follow the setup instructions in the project's **README.md** and any additional guidance in **AGENTS.md** to prepare your local development environment.

## Ways to Contribute

You can contribute by:

- Fixing bugs
- Improving documentation
- Adding tests
- Improving the user interface and user experience
- Enhancing existing features
- Implementing new features that align with the project's goals

When making changes:

- Follow the existing project structure and coding style.
- Keep changes limited to a single logical purpose whenever possible.
- Update documentation if your changes affect user-facing behavior.

## Pull Request Guidelines

Before opening a pull request:

- Create your branch from `main`.
- Test your changes locally.
- Run the project's formatting, linting, type checking, and test commands where applicable.
- Write clear commit messages.
- Keep your pull request focused on one logical change.

Your pull request description should include:

- A summary of the changes
- Why the change is needed
- Any relevant testing information
- Links to related issues, if applicable

## Code Style

Please follow the coding patterns already used throughout the repository.

- Keep code clean and readable.
- Remove unused code and imports.
- Use descriptive variable and function names.
- Update documentation when necessary.

## Documentation

Documentation contributions are always welcome. If you modify workflows, commands, or features, please update the relevant documentation to keep it accurate.

## Community

Be respectful and constructive during discussions and code reviews. Respond to review feedback promptly and keep conversations focused on improving the project.

Thank you for helping improve AgentSpace!
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
