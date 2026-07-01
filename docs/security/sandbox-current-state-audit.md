# Sandbox Current State Audit

This audit covers the sandbox and daemon execution state before the full multi-PR sandbox hardening roadmap is complete. It is intentionally scoped to concrete code paths in this repository.

## Current Execution Architecture

- `packages/daemon/src/provider-runtime.ts` calls `connectSandbox()` for direct provider executions and then calls `sandbox.exec()` with provider CLI commands, task work directories, timeout settings, and provider-specific environment values.
- `packages/sandbox/src/factory.ts` resolves the provider and currently returns either `CubeSandbox.connect(options)` or `new LocalSandbox(options.workDir, options.runtimeId, options.policy)`.
- `packages/sandbox/src/local/local-sandbox.ts` provides trusted local execution using `node:child_process.spawn`.
- AgentRouter executions in `packages/daemon/src/provider-runtime.ts` route Claude, Codex, OpenClaw, and Hermes through `runAgentRouter()` before returning normalized provider output.

## Current Sandbox Providers

- `LocalSandbox` is the only provider that executes commands today.
- `CubeSandbox` in `packages/sandbox/src/cube/cube-sandbox.ts` can create, pause, snapshot, and delete Cube sandboxes, but `CubeSandbox.exec()` still throws `CUBE_EXEC_NOT_READY_MESSAGE`. It must not be described as remote isolated execution yet.

## Current Trust Boundaries

- `LocalSandbox` is now explicit trusted local execution with path, environment, process, and output safeguards.
- `LocalSandbox` is not a security boundary against malicious code. It still runs provider CLIs on the daemon host.
- Strong isolation is out of scope for this PR and belongs to the later isolated container provider work.

## Directory and Attachment Boundaries

- Sandbox file access is rooted at `workDir` and validated in `LocalSandbox.resolveExistingInsideSandbox()` and `LocalSandbox.resolveWritableInsideSandbox()`.
- Attachment storage and download authorization are not changed by this PR. Attachment isolation remains a later PR scope.
- Runtime output artifact collection is not changed by this PR. The new filesystem policy reserves artifact allow patterns for later enforcement.

## Credential Paths

- Provider task credentials enter daemon execution through `ProviderTaskOptions.contextEnv` and provider env builders in `packages/daemon/src/provider-runtime.ts`.
- `LocalSandbox.buildSandboxEnv()` no longer inherits the daemon host environment by default. It only keeps a minimal allowlist and explicit credential keys from the sandbox policy.
- This PR does not add a full credential broker. It establishes the policy shape and default local behavior needed for that follow-up.

## Network Capability

- `LocalSandbox` does not implement network isolation and does not claim to.
- The policy model records a network policy, but enforcement for `none` and `allowlist` modes is deferred to the isolated container/network PRs.

## Process Cleanup

- `LocalSandbox.exec()` starts child processes in a separate process group on non-Windows platforms and terminates the group on timeout or output limit.
- `stop()` and `destroy()` are idempotent.
- Windows keeps a predictable fallback that terminates the direct child process. It does not claim full process-tree cleanup.

## Audit Capability

- Structured audit event storage is not implemented in this PR.
- `ExecResult` now carries structured execution outcome fields such as `terminationReason`, `stdoutTruncated`, `stderrTruncated`, and `outputLimitExceeded`, which later audit events can consume.

## Security Gaps

- No rootless container provider exists yet.
- No daemon-wide credential broker exists yet.
- Local execution still uses the host kernel, filesystem namespace, and network stack.
- Network policy is modeled but not enforced.
- Attachment signed URL authorization and tenant isolation are unchanged.
- Runtime tool manifests and adapter security manifests are unchanged.

## Scope of This PR

- Add `SandboxPolicy` and related policy types.
- Harden trusted local filesystem access, environment construction, output bounds, timeout status, and cleanup behavior.
- Add adversarial LocalSandbox tests.
- Add security documentation for the current state and threat model.

## Out of Scope

- Production-grade isolated container execution.
- Network egress proxying.
- Credential broker issuance and revocation.
- Attachment signed URL lifecycle.
- Runtime tool marketplace UI.
- Full audit event persistence.
