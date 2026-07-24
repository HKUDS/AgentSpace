# PR Readiness

## PR 1: Sandbox Policy Contract and LocalSandbox Baseline

- Branch: `security/sandbox-policy-baseline`
- Title: `feat(sandbox): add policy contract and harden trusted local execution`
- Scope:
  - Add the sandbox policy contract.
  - Harden LocalSandbox path validation, environment construction, output bounds, and cleanup status.
  - Add adversarial LocalSandbox tests.
  - Document current state, threat model, and policy semantics.
- Platform support:
  - Linux/macOS: process-group termination is attempted.
  - Windows: direct-child termination is used and documented as a downgrade.
- Known limitations:
  - LocalSandbox is still trusted local execution.
  - Network isolation is modeled but not enforced in this PR.
  - Credential broker, attachment isolation, signed URLs, and runtime tool manifests are later PRs.
- Merge recommendation: draft until the listed validation commands are run in the target CI environment.

## Validation Log

Commands run locally on Windows:

```bash
npm.cmd run test:sandbox
npm.cmd run test:security
git diff --check
git status --short
```

- `npm.cmd run test:sandbox`: passed, 19 passed, 1 skipped. The skipped test is the symlink escape test because Windows symlink creation permissions vary by host policy.
- `npm.cmd run test:security`: passed, same sandbox suite coverage.
- `git diff --check`: passed. Git emitted line-ending warnings on Windows but no whitespace errors.
- `npm.cmd run typecheck:deps`: not completed in this checkout. The root script invokes POSIX-style `./apps/web/node_modules/.bin/tsc`, which `cmd.exe` cannot execute, and this fresh checkout does not have `node_modules` installed.

This PR should remain draft until maintainers or CI run the Linux typecheck and symlink test path.
