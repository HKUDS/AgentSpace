# Sandbox Policy

`packages/sandbox/src/policy.ts` defines the policy contract used by sandbox providers.

## Trust Levels

- `trusted-local`: executes on the daemon host with safeguards. This is compatible with the current LocalSandbox behavior and is not a security boundary against malicious code.
- `isolated`: reserved for providers that enforce OS/container-level isolation.

## LocalSandbox Baseline

`createTrustedLocalSandboxPolicy(workDir)` sets conservative defaults for PR1:

- absolute sandbox paths are rejected;
- symlinks are rejected by default;
- reads and writes are constrained to the sandbox work directory;
- single-file and total write limits are enforced;
- host environment inheritance is disabled by default;
- `HOME`, `USERPROFILE`, `TMPDIR`, `TMP`, and `TEMP` are rewritten inside the sandbox work directory;
- stdout, stderr, and combined output are bounded;
- timeout and output-limit termination are reported in `ExecResult`.

## Compatibility

The public sandbox API remains additive. Existing callers may keep constructing `new LocalSandbox(workDir, runtimeId)` or using `connectSandbox(options)`.

Callers that need explicit credentials must provide a policy with `credentials.credentialEnvKeys`. Silent inheritance of secrets from the daemon host is intentionally not part of the baseline.

## Limitations

The policy model includes network and audit sections, but PR1 only enforces the LocalSandbox filesystem, environment, process timeout, and output controls. Network egress control belongs to the isolated provider and network-isolation PRs.
