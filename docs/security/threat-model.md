# AgentSpace Sandbox Threat Model

## Attackers

- Malicious workspace member.
- Agent controlled by prompt injection.
- Malicious or compromised skill.
- Malicious runtime tool.
- Malicious package install script.
- Compromised provider CLI.
- Agent attempting cross-workspace data access.
- Task attempting to read host credentials.
- Task attempting cloud metadata endpoint access.
- Task attempting CPU, memory, PID, disk, or log exhaustion.
- Task attempting symlink, hardlink, path traversal, or race-condition escape.
- Task attempting to keep background processes alive after completion.
- User attempting attachment access by guessing an attachment identifier.

## Protected Assets

- Daemon API tokens.
- Database credentials.
- Google OAuth tokens.
- Provider API keys.
- Workspace documents.
- Attachments.
- Runtime output.
- Agent knowledge.
- Other workspace task directories.
- Host files and host network.
- Internal services.
- Cloud metadata endpoints.
- Sensitive data in logs.

## Trust Boundaries

- Browser and API user identity boundary.
- Workspace membership and role boundary.
- Agent/runtime/task boundary.
- Daemon host boundary.
- Sandbox provider boundary.
- Attachment storage boundary.
- Credential injection boundary.
- Provider CLI boundary.

## Assumptions

- Maintainers can run daemon hosts with appropriate OS and container runtime controls.
- `LocalSandbox` is for trusted local execution only.
- Strong isolation requires an isolated provider such as a rootless container provider.
- Provider CLIs may read local configuration unless explicitly isolated by policy and runtime setup.

## Security Goals

- Make sandbox policy explicit and reviewable.
- Fail closed for path escapes and symlink escapes.
- Avoid default host environment inheritance for LocalSandbox.
- Bound stdout and stderr memory growth.
- Report timeout and output-limit termination explicitly.
- Preserve compatibility for existing callers through additive types and constructor defaults.
- Avoid claiming stronger isolation than the implementation provides.

## Non-Goals

- Proving LocalSandbox is safe for malicious code.
- Implementing complete network isolation in PR1.
- Implementing complete credential brokerage in PR1.
- Implementing attachment signed URLs in PR1.
- Implementing commercial marketplace UI in PR1.

## Residual Risks

- LocalSandbox still executes on the daemon host.
- Windows cannot guarantee the same process-group cleanup semantics as Linux.
- Existing provider CLIs can still have their own behavior and local config reads.
- Full prevention of TOCTOU attacks requires stronger OS/container primitives.
- Network and attachment isolation require later PRs.
