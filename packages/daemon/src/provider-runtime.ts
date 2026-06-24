import { randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { arch, platform, version as nodeVersion } from "node:process";
import type { DaemonProvider, ProviderErrorCategory, ProviderErrorCode, RuntimeAppContextEntry, RuntimeToolCapability } from "@agent-space/domain";
import { formatDaemonProviderLabel } from "@agent-space/domain";
import { connectSandbox, resolveSandboxTaskTimeoutMs, type ExecController } from "@agent-space/sandbox";
import {
  buildDefaultClaudeAllowedTools,
  runAgentRouter,
  type AgentRouterDiagnostic,
  type AgentRouterEvent,
  type AgentRouterHarness,
} from "./agent-router/index.ts";
import { clearTaskOutputArtifacts } from "./bundle.ts";
import { readGoogleWorkspaceReadiness } from "./google-workspace-readiness.ts";
import { buildOpenClawProviderHealthSnapshot, inspectOpenClawDaemonAuthHealth } from "./openclaw-health.ts";
import { readCliHubReadiness } from "./runtime-apps.ts";

export interface ProviderRuntimeRecord {
  id: string;
  workspaceId: string;
  provider: DaemonProvider;
  name: string;
  version?: string;
  status: "online" | "offline";
  deviceInfo?: string;
  metadata: {
    executablePath: string;
    mode: "local" | "remote";
    providerHealth?: Record<string, unknown>;
    openClawProfile?: string;
    openClawModel?: string;
  };
}

export type RemoteRuntimeRecord = ProviderRuntimeRecord;

export interface DetectedProvider {
  provider: DaemonProvider;
  label: string;
  executablePath: string;
  version: string;
}

export interface ProviderTaskEvent {
  type: string;
  content?: string;
  tool?: string;
  inputJson?: Record<string, unknown>;
  output?: string;
}

export interface ProviderApprovalRequest {
  provider: DaemonProvider;
  runtimeId: string;
  sessionId?: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  contentPreview: string;
}

export interface ProviderApprovalDecision {
  decision: "approved" | "rejected";
  comment?: string;
}

export interface ProviderTaskOptions {
  sessionId?: string;
  contextEnv?: Record<string, string>;
  taskTimeoutMs?: number;
  onEvent?: (event: ProviderTaskEvent) => void;
  onApprovalRequest?: (request: ProviderApprovalRequest) => Promise<ProviderApprovalDecision>;
  temporaryAllowedTools?: string[];
  runtimeApps?: RuntimeAppContextEntry[];
  runtimeToolCapabilities?: RuntimeToolCapability[];
}

type ProviderTaskFailureCategory = ProviderErrorCategory | "auth" | "profile" | "model";

export interface ProviderTaskStructuredError {
  provider: DaemonProvider;
  code: ProviderErrorCode;
  category?: ProviderTaskFailureCategory;
  message: string;
  rawProviderMessage?: string;
}

class ProviderTaskExecutionError extends Error {
  readonly sessionId?: string;
  readonly workDir?: string;
  readonly providerError?: ProviderTaskStructuredError;

  constructor(
    message: string,
    metadata?: { sessionId?: string; workDir?: string; providerError?: ProviderTaskStructuredError },
  ) {
    super(message);
    this.name = "ProviderTaskExecutionError";
    this.sessionId = metadata?.sessionId;
    this.workDir = metadata?.workDir;
    this.providerError = metadata?.providerError;
  }
}

const PROVIDER_CATALOG: Array<{
  provider: DaemonProvider;
  label: string;
  command?: string;
  commands?: string[];
  defaultModelId?: string;
  versionArgs?: string[][];
}> = [
  { provider: "codex", label: formatDaemonProviderLabel("codex"), command: "codex" },
  {
    provider: "claude",
    label: formatDaemonProviderLabel("claude"),
    command: "claude",
    defaultModelId: "claude-haiku-4-5-20251001",
  },
  {
    provider: "gemini",
    label: formatDaemonProviderLabel("gemini"),
    command: "gemini",
    defaultModelId: "gemini-2.0-flash-lite",
  },
  {
    provider: "opencode",
    label: formatDaemonProviderLabel("opencode"),
    command: "opencode",
    defaultModelId: "opencode-default",
  },
  {
    provider: "openclaw",
    label: formatDaemonProviderLabel("openclaw"),
    command: "openclaw",
  },
  {
    provider: "nanobot",
    label: formatDaemonProviderLabel("nanobot"),
    command: "nanobot",
    defaultModelId: "nanobot-default",
  },
  {
    provider: "hermes",
    label: formatDaemonProviderLabel("hermes"),
    commands: ["hermes", "hermes-agent"],
    versionArgs: [["--version"], ["version"]],
  },
];

const CLAUDE_MISSING_RESUME_SESSION_PATTERN = /No conversation found with session ID:/i;
const CODEX_MISSING_RESUME_SESSION_PATTERN = /no rollout found for thread id\s+([^\s)]+)/i;
const OPENCLAW_MISSING_RESUME_SESSION_PATTERN = /session .*not found|session.*missing|conversation .*not found|conversation.*missing|agent .*not found|agent.*missing|unknown session/i;

export function detectProviders(): DetectedProvider[] {
  return PROVIDER_CATALOG
    .map((candidate) => {
      const executablePath = findFirstExecutableOnPath(resolveProviderCommands(candidate));
      if (!executablePath) {
        return null;
      }
      if (candidate.provider === "claude") {
        warnClaudeRootRuntimeIfNeeded("detected");
      }

      return {
        provider: candidate.provider,
        label: candidate.label,
        executablePath,
        version: detectProviderVersion(executablePath, candidate.versionArgs),
      } satisfies DetectedProvider;
    })
    .filter((value): value is DetectedProvider => value !== null);
}

export async function runProviderTask(
  runtime: ProviderRuntimeRecord,
  prompt: string,
  workDir: string,
  options: ProviderTaskOptions = {},
): Promise<{ output: string; sessionId?: string }> {
  const taskTimeoutMs = resolveSandboxTaskTimeoutMs(options.taskTimeoutMs);
  if (runtime.provider === "claude") {
    return runAgentRouterProviderTask(runtime, prompt, workDir, taskTimeoutMs, options);
  }
  if (runtime.provider === "gemini") {
    return runGeminiProviderTask(runtime, prompt, workDir, taskTimeoutMs, options);
  }
  if (runtime.provider === "opencode") {
    return runAgentRouterProviderTask(runtime, prompt, workDir, taskTimeoutMs, options);
  }
  if (runtime.provider === "openclaw") {
    return runAgentRouterProviderTask(runtime, prompt, workDir, taskTimeoutMs, options);
  }
  if (runtime.provider === "hermes") {
    return runAgentRouterProviderTask(runtime, prompt, workDir, taskTimeoutMs, options);
  }
  if (runtime.provider === "nanobot") {
    return runNanoBotProviderTask(runtime, prompt, workDir, taskTimeoutMs, options);
  }
  if (runtime.provider !== "codex") {
    throw new Error(`Provider "${runtime.provider}" is not supported.`);
  }

  return runAgentRouterProviderTask(runtime, prompt, workDir, taskTimeoutMs, options);
}

async function runAgentRouterProviderTask(
  runtime: ProviderRuntimeRecord,
  prompt: string,
  workDir: string,
  taskTimeoutMs: number,
  options: ProviderTaskOptions,
): Promise<{ output: string; sessionId?: string }> {
  clearTaskOutputArtifacts(workDir);
  const harness = runtime.provider as AgentRouterHarness;
  const runtimeToolCapabilities = buildRuntimeToolCapabilities(options);
  const contextEnv = buildAgentRouterProviderEnv(runtime, options.contextEnv);
  const sessionId = resolveAgentRouterSessionId(runtime, options.sessionId);
  const result = await runAgentRouter({
    version: 1,
    harness,
    prompt,
    cwd: workDir,
    executablePath: runtime.metadata.executablePath,
    model: resolveModelId(runtime),
    mode: resolveAgentRouterMode(runtime),
    sessionId,
    env: contextEnv,
    providerHealth: runtime.provider === "openclaw"
      ? readRuntimeProviderHealthMetadata(runtime)
      : undefined,
    timeoutMs: taskTimeoutMs,
    maxTurns: runtime.provider === "claude" ? 30 : undefined,
    permissionMode: runtime.provider === "claude" ? resolveClaudePermissionMode() : undefined,
    dangerouslyBypassPermissions: runtime.provider === "codex" || (runtime.provider === "claude" && !isRootUser()),
    allowedTools: runtime.provider === "claude" && isRootUser() ? buildDefaultClaudeAllowedTools() : undefined,
    temporaryAllowedTools: options.temporaryAllowedTools,
    runtimeToolCapabilities,
    claudeTools: runtime.provider === "claude" ? "default" : undefined,
    handleControlRequests: runtime.provider === "claude" && isRootUser(),
    openClawEphemeralAgent: runtime.provider === "openclaw" && !sessionId,
    onApprovalRequest: options.onApprovalRequest
      ? async (request) => options.onApprovalRequest?.({
        provider: runtime.provider,
        runtimeId: runtime.id,
        sessionId: request.sessionId,
        toolName: request.toolName,
        toolInput: request.toolInput,
        contentPreview: request.contentPreview,
      }) ?? { decision: "approved" }
      : undefined,
  }, {
    emit: (event) => {
      for (const mapped of mapAgentRouterEvent(event)) {
        options.onEvent?.(mapped);
      }
    },
  });

  if (isMissingResumeSessionResult(runtime.provider, result.diagnostics, sessionId)) {
    const sessionInvalidMessage = `${formatDaemonProviderLabel(runtime.provider)} session ${sessionId} was not found; starting a new conversation.`;
    options.onEvent?.({
      type: "provider_session_invalid",
      content: sessionInvalidMessage,
      inputJson: {
        provider: runtime.provider,
        runtimeId: runtime.id,
        sessionId,
        code: "provider.session_invalid",
      },
    });
    options.onEvent?.({
      type: "status",
      content: sessionInvalidMessage,
    });
    clearTaskOutputArtifacts(workDir);
    return runAgentRouterProviderTask(runtime, prompt, workDir, taskTimeoutMs, {
      ...options,
      sessionId: undefined,
    });
  }

  if (runtime.provider === "claude") {
    const permissionDenials = extractClaudePermissionDenialsFromRouterEvents(result.events);
    if (permissionDenials.length > 0 && options.onApprovalRequest) {
      const allowedTools: string[] = [];
      for (const denial of permissionDenials) {
        const decision = await options.onApprovalRequest({
          provider: runtime.provider,
          runtimeId: runtime.id,
          sessionId: result.sessionId,
          toolName: denial.toolName,
          toolInput: denial.toolInput,
          contentPreview: formatClaudePermissionDenialPreview(denial),
        });
        if (decision.decision !== "approved") {
          throw buildRouterProviderFailure(
            runtime.provider,
            `Claude tool request was rejected.${decision.comment ? ` ${decision.comment}` : ""}`,
            result,
            workDir,
          );
        }
        const allowedTool = buildClaudeAllowedToolFromPermissionDenial(denial);
        if (allowedTool) {
          allowedTools.push(allowedTool);
        }
      }

      if (allowedTools.length > 0 && result.sessionId) {
        clearTaskOutputArtifacts(workDir);
        return runAgentRouterProviderTask(runtime, "用户已经在 AgentSpace 前端批准了刚才被拦截的工具调用。请从刚才中断的位置继续，重新执行已获批准的工具命令，并基于真实结果完成用户请求。", workDir, taskTimeoutMs, {
          ...options,
          sessionId: result.sessionId,
          temporaryAllowedTools: allowedTools,
        });
      }
    }
  }

  if (result.status !== "completed") {
    throw buildRouterProviderFailure(runtime.provider, buildRouterFailureMessage(runtime.provider, result), result, workDir);
  }

  const output = result.outputText?.trim();
  if (!output) {
    throw buildRouterProviderFailure(runtime.provider, `${runtime.provider} returned an empty response.`, result, workDir);
  }

  return { output, sessionId: result.sessionId };
}

function resolveAgentRouterMode(runtime: ProviderRuntimeRecord): string | undefined {
  if (runtime.provider === "openclaw") {
    return process.env.OPENCLAW_THINKING?.trim() || undefined;
  }
  return undefined;
}

function resolveAgentRouterSessionId(runtime: ProviderRuntimeRecord, sessionId: string | undefined): string | undefined {
  if (runtime.provider === "hermes") {
    return undefined;
  }
  return sessionId;
}

function resolveClaudePermissionMode(): string {
  return isRootUser() ? "auto" : "bypassPermissions";
}

function buildRuntimeToolCapabilities(options: ProviderTaskOptions): RuntimeToolCapability[] {
  return dedupeRuntimeToolCapabilities([
    ...buildBuiltinRuntimeToolCapabilities(options.contextEnv),
    ...buildCliHubRuntimeToolCapabilities(options.runtimeApps ?? []),
    ...(options.runtimeToolCapabilities ?? []),
  ]);
}

function buildBuiltinRuntimeToolCapabilities(contextEnv?: Record<string, string>): RuntimeToolCapability[] {
  const capabilities: RuntimeToolCapability[] = [
    {
      id: "agent-space-output",
      command: "agent-space",
      displayName: "AgentSpace output CLI",
      binDir: process.env.AGENT_SPACE_DAEMON_BIN ? dirname(process.env.AGENT_SPACE_DAEMON_BIN) : undefined,
      pathDirs: [
        process.env.AGENT_SPACE_DAEMON_INSTALL_ROOT
          ? join(process.env.AGENT_SPACE_DAEMON_INSTALL_ROOT, "bin")
          : "",
      ].filter(Boolean),
      allowedShellPatterns: [
        "agent-space output text *",
        "agent-space output attach *",
        "agent-space output validate *",
        "agent-space output preview *",
      ],
      source: "builtin",
    },
  ];

  const googleTokenEnvName = readGoogleWorkspaceTokenEnvName(contextEnv);
  if (googleTokenEnvName) {
    const command = process.env.AGENT_SPACE_GOOGLE_WORKSPACE_EXECUTOR?.trim() || "gws";
    const binDir = resolveCommandDirFromCurrentEnv(command);
    capabilities.push({
      id: "google-workspace",
      command,
      displayName: "Google Workspace",
      binPath: isPathLike(command) ? command : undefined,
      binDir,
      allowedShellPatterns: [
        `${command} --version`,
      ],
      diagnosticCommands: [`command -v ${shellQuote(command)}`],
      env: pickEnv(contextEnv, [googleTokenEnvName]),
      source: "builtin",
    });
  }

  return capabilities;
}

function buildCliHubRuntimeToolCapabilities(runtimeApps: RuntimeAppContextEntry[]): RuntimeToolCapability[] {
  return runtimeApps.flatMap((app): RuntimeToolCapability[] => {
    const command = app.entryPoint?.trim();
    if (!command) {
      return [];
    }
    return [{
      id: `clihub:${app.source}:${app.name}`,
      command,
      displayName: app.displayName || app.name,
      binDir: resolveCommandDirFromCurrentEnv(command),
      allowedShellPatterns: [`${command} *`, `${command} --help`, `command -v ${command}`],
      diagnosticCommands: [`command -v ${shellQuote(command)}`],
      source: "cli-hub",
    }];
  });
}

function readGoogleWorkspaceTokenEnvName(contextEnv?: Record<string, string>): string | undefined {
  if (!contextEnv) {
    return undefined;
  }
  if (typeof contextEnv.GOOGLE_WORKSPACE_CLI_TOKEN === "string" && contextEnv.GOOGLE_WORKSPACE_CLI_TOKEN.trim()) {
    return "GOOGLE_WORKSPACE_CLI_TOKEN";
  }
  return Object.keys(contextEnv).find((key) => /^GOOGLE_.*TOKEN$/i.test(key) && contextEnv[key]?.trim());
}

function pickEnv(source: Record<string, string> | undefined, keys: string[]): Record<string, string> | undefined {
  if (!source) {
    return undefined;
  }
  const env: Record<string, string> = {};
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

function resolveCommandDirFromCurrentEnv(command: string): string | undefined {
  if (isPathLike(command)) {
    return dirname(command);
  }
  const path = findExecutableOnPath(command);
  return path ? dirname(path) : undefined;
}

function isPathLike(value: string): boolean {
  return isAbsolute(value) || value.includes("/") || value.includes("\\");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function dedupeRuntimeToolCapabilities(capabilities: RuntimeToolCapability[]): RuntimeToolCapability[] {
  const result: RuntimeToolCapability[] = [];
  const seen = new Set<string>();
  for (const capability of capabilities) {
    const id = capability.id.trim();
    const command = capability.command.trim();
    if (!id || !command || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push({
      ...capability,
      id,
      command,
      allowedShellPatterns: dedupeStrings(capability.allowedShellPatterns ?? []),
      diagnosticCommands: capability.diagnosticCommands ? dedupeStrings(capability.diagnosticCommands) : undefined,
      pathDirs: capability.pathDirs ? dedupeStrings(capability.pathDirs) : undefined,
    });
  }
  return result;
}

function mapAgentRouterEvent(event: AgentRouterEvent): ProviderTaskEvent[] {
  if (event.type === "text_delta") {
    return event.text.trim() ? [{ type: "text", content: event.text }] : [];
  }
  if (event.type === "thought_delta") {
    return event.text.trim() ? [{ type: "thinking", content: event.text }] : [];
  }
  if (event.type === "tool_started") {
    return [{
      type: "tool_use",
      tool: event.tool,
      content: event.title ?? event.tool,
      inputJson: event.input && typeof event.input === "object" && !Array.isArray(event.input)
        ? event.input as Record<string, unknown>
        : undefined,
    }];
  }
  if (event.type === "tool_output" && event.tool === "usage" && event.metadata && typeof event.metadata === "object") {
    const usage = event.metadata as { input_tokens?: unknown; output_tokens?: unknown };
    const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
    const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
    return [{
      type: "usage",
      content: `tokens: in=${inputTokens} out=${outputTokens}`,
      inputJson: { input_tokens: inputTokens, output_tokens: outputTokens },
    }];
  }
  if (event.type === "tool_output") {
    return [{
      type: "tool_result",
      tool: event.tool,
      content: event.output ? truncateToolOutput(event.output) : "completed",
      output: event.output ? truncateToolOutput(event.output) : undefined,
    }];
  }
  if (event.type === "approval_requested") {
    return [{
      type: "status",
      content: `Runtime approval requested: ${event.contentPreview}`,
    }];
  }
  return [];
}

function isMissingResumeSessionResult(
  provider: DaemonProvider,
  diagnostics: AgentRouterDiagnostic[],
  requestedSessionId: string | undefined,
): boolean {
  if (!requestedSessionId) {
    return false;
  }
  const text = diagnostics
    .map((diagnostic) => `${diagnostic.message}\n${diagnostic.rawProviderMessage ?? ""}\n${diagnostic.stderrTail ?? ""}`)
    .join("\n");
  if (provider === "claude") {
    return CLAUDE_MISSING_RESUME_SESSION_PATTERN.test(text) && text.includes(requestedSessionId);
  }
  if (provider === "codex") {
    const match = CODEX_MISSING_RESUME_SESSION_PATTERN.exec(text);
    return Boolean(match?.[1] === requestedSessionId);
  }
  if (provider === "openclaw") {
    return diagnostics.some((diagnostic) => diagnostic.code === "harness.session_missing") ||
      (OPENCLAW_MISSING_RESUME_SESSION_PATTERN.test(text) && text.includes(requestedSessionId));
  }
  return false;
}

function buildRouterFailureMessage(
  provider: DaemonProvider,
  result: Awaited<ReturnType<typeof runAgentRouter>>,
): string {
  if (result.status === "timeout") {
    const primary = result.diagnostics.find((diagnostic) => diagnostic.code === "harness.timeout") ?? result.diagnostics[0];
    return `${primary?.message || `${provider} timed out after router timeout.`} ${formatRouterDiagnosticDetails(result)}`;
  }
  const primary = result.diagnostics.find((diagnostic) => diagnostic.severity === "error") ?? result.diagnostics[0];
  const baseMessage = primary?.message || `${provider} execution failed.`;
  return `${baseMessage} ${formatRouterDiagnosticDetails(result)}`.trim();
}

function buildRouterProviderFailure(
  provider: DaemonProvider,
  message: string,
  result: Awaited<ReturnType<typeof runAgentRouter>>,
  workDir: string,
): ProviderTaskExecutionError {
  const primary = result.diagnostics.find((diagnostic) => diagnostic.severity === "error") ?? result.diagnostics[0];
  const code = mapRouterDiagnosticCode(provider, primary?.code, result);
  const fullMessage = message.includes("code=") ? message : `${message} ${formatRouterDiagnosticDetails(result)}`.trim();
  return new ProviderTaskExecutionError(fullMessage, {
    sessionId: result.sessionId,
    workDir,
    providerError: {
      provider,
      code,
      category: resolveRouterProviderErrorCategory(code, primary?.code),
      message: fullMessage,
      rawProviderMessage: primary?.rawProviderMessage ?? primary?.stderrTail ?? primary?.message,
    },
  });
}

function mapRouterDiagnosticCode(
  provider: DaemonProvider,
  code: AgentRouterDiagnostic["code"] | undefined,
  result: Awaited<ReturnType<typeof runAgentRouter>>,
): ProviderErrorCode {
  if (code === "harness.cli_missing") {
    return "provider.cli_missing";
  }
  if (code === "harness.auth_required" || code === "harness.auth_invalid") {
    return "provider.auth_invalid";
  }
  if (code === "harness.profile_missing") {
    return "provider.profile_missing";
  }
  if (code === "harness.model_unavailable") {
    return "provider.model_unavailable";
  }
  if (code === "harness.tool_missing") {
    return "provider.tool_missing";
  }
  if (code === "harness.tool_unauthorized") {
    return "provider.tool_unauthorized";
  }
  if (code === "harness.tool_permission_denied") {
    return "provider.tool_permission_denied";
  }
  if (code === "harness.protocol_parse_failed") {
    return "provider.protocol_parse_failed";
  }
  if (code === "harness.timeout") {
    return "provider.timeout";
  }
  if (code === "harness.session_missing") {
    return "provider.session_invalid";
  }
  if (code === "harness.empty_response") {
    return provider === "claude"
      ? resolveClaudeEmptyResponseCodeFromRouter(result)
      : "provider.empty_response";
  }
  return "provider.runtime_generic_failure";
}

function resolveClaudeEmptyResponseCodeFromRouter(result: Awaited<ReturnType<typeof runAgentRouter>>): ProviderErrorCode {
  const hasStdout = result.events.some((event) => event.type === "thought_delta" || event.type === "text_delta" || event.type === "tool_started" || event.type === "tool_output" || event.type === "approval_requested");
  const hasResultEvent = Boolean(result.sessionId) || result.events.some((event) => event.type === "session_updated");
  if (!hasStdout) {
    return "provider.empty_response.stdout_empty";
  }
  if (!hasResultEvent) {
    return "provider.empty_response.no_result_event";
  }
  return "provider.empty_response.no_text_event";
}

function resolveRouterProviderErrorCategory(
  providerCode: ProviderErrorCode,
  routerCode: AgentRouterDiagnostic["code"] | undefined,
): ProviderTaskFailureCategory {
  if (providerCode === "provider.auth_invalid") {
    return "auth";
  }
  if (providerCode === "provider.profile_missing") {
    return "profile";
  }
  if (providerCode === "provider.model_unavailable") {
    return "model";
  }
  if (providerCode === "provider.timeout" || providerCode === "provider.session_invalid") {
    return "runtime";
  }
  if (routerCode === "harness.cli_missing") {
    return "configuration";
  }
  if (providerCode === "provider.tool_missing") {
    return "configuration";
  }
  if (providerCode === "provider.tool_unauthorized" || providerCode === "provider.tool_permission_denied") {
    return "tool";
  }
  if (providerCode === "provider.protocol_parse_failed") {
    return "protocol";
  }
  if (providerCode === "provider.runtime_generic_failure") {
    return "runtime";
  }
  return "provider";
}

function formatRouterDiagnosticDetails(result: Awaited<ReturnType<typeof runAgentRouter>>): string {
  const primary = result.diagnostics.find((diagnostic) => diagnostic.severity === "error") ?? result.diagnostics[0];
  const code = primary ? mapRouterDiagnosticCode(result.harness, primary.code, result) : "provider.runtime_generic_failure";
  const parts = [
    `code=${code}`,
    `status=${result.status}`,
  ];
  if (result.status === "timeout") {
    parts.push("timedOut=true");
  }
  if (result.exitCode !== undefined) {
    parts.push(`exitCode=${result.exitCode ?? "null"}`);
  }
  if (result.signal) {
    parts.push(`signal=${result.signal}`);
  }
  if (result.sessionId) {
    parts.push(`sessionId=${result.sessionId}`);
  }
  if (primary?.stderrTail) {
    parts.push(`stderrTail=${JSON.stringify(primary.stderrTail)}`);
  }
  if (primary?.rawProviderMessage) {
    parts.push(`rawProviderMessage=${JSON.stringify(primary.rawProviderMessage)}`);
    parts.push(primary.rawProviderMessage);
  }
  return `(${parts.join("; ")})`;
}

function extractClaudePermissionDenialsFromRouterEvents(events: AgentRouterEvent[]): ClaudePermissionDenial[] {
  return events.flatMap((event) => {
    if (event.type !== "approval_requested") {
      return [];
    }
    return [{
      toolName: event.toolName,
      toolInput: event.toolInput,
    }];
  });
}

async function runCodexProviderTaskAttempt(
  runtime: ProviderRuntimeRecord,
  prompt: string,
  workDir: string,
  taskTimeoutMs: number,
  options: ProviderTaskOptions,
  sessionId: string | undefined,
): Promise<{ output: string; sessionId?: string }> {
  clearTaskOutputArtifacts(workDir);
  const outputFile = join(workDir, "last-message.txt");
  let discoveredSessionId: string | undefined = sessionId;
  const baseArgs = ["--json", "--skip-git-repo-check", "-o", outputFile];
  const fullAccessArgs = [
    "--dangerously-bypass-approvals-and-sandbox",
    "-c", "sandbox_mode=\"danger-full-access\"",
    "-c", "approval_policy=\"never\"",
    "-c", "shell_environment_policy.inherit=\"all\"",
  ];
  const providerArgs = sessionId
    ? ["exec", "resume", ...baseArgs, ...fullAccessArgs, sessionId, prompt]
    : ["exec", ...baseArgs, ...fullAccessArgs, "--cd", workDir, prompt];
  const sandbox = await connectSandbox({
    runtimeId: runtime.id,
    workDir,
  });
  let stderr = "";
  let stdoutBuffer = "";
  const processCodexStdoutLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      return;
    }
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      discoveredSessionId = extractSessionId(event) ?? discoveredSessionId;
      for (const mapped of mapCodexExecEvent(event)) {
        options.onEvent?.(mapped);
      }
    } catch {
      // Ignore non-json lines.
    }
  };
  const result = await sandbox.exec({
    command: runtime.metadata.executablePath,
    args: providerArgs,
    timeoutMs: taskTimeoutMs,
    env: buildProviderEnv(runtime, options.contextEnv),
    onStdout: (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        processCodexStdoutLine(line);
      }
    },
    onStderr: (chunk) => {
      stderr += chunk;
    },
  });

  if (stdoutBuffer.trim()) {
    processCodexStdoutLine(stdoutBuffer);
  }
  for (const event of parseJsonOutput(result.stdout)) {
    discoveredSessionId = extractSessionId(event) ?? discoveredSessionId;
  }

  if (result.timedOut) {
    throw new ProviderTaskExecutionError(`codex timed out after ${taskTimeoutMs}ms.`, {
      sessionId: discoveredSessionId,
      workDir,
    });
  }
  if (result.exitCode !== 0) {
    throw new ProviderTaskExecutionError(stderr.trim() || `codex exited with code ${result.exitCode}.`, {
      sessionId: discoveredSessionId,
      workDir,
    });
  }

  const output = existsSync(outputFile) ? readFileSync(outputFile, "utf8").trim() : "";
  if (!output) {
    throw new ProviderTaskExecutionError("codex returned an empty final message.", {
      sessionId: discoveredSessionId,
      workDir,
    });
  }

  return { output, sessionId: discoveredSessionId };
}

export function resolveModelId(runtime: ProviderRuntimeRecord): string | undefined {
  const providerDefinition = PROVIDER_CATALOG.find((candidate) => candidate.provider === runtime.provider);
  if (runtime.provider === "codex") return process.env.CODEX_MODEL?.trim() || undefined;
  if (runtime.provider === "claude") return process.env.CLAUDE_MODEL || providerDefinition?.defaultModelId || "claude-haiku-4-5-20251001";
  if (runtime.provider === "gemini") return process.env.GEMINI_MODEL || providerDefinition?.defaultModelId || "gemini-2.0-flash-lite";
  if (runtime.provider === "opencode") return process.env.OPENCODE_MODEL || providerDefinition?.defaultModelId || "opencode-default";
  if (runtime.provider === "openclaw") return readRuntimeMetadataString(runtime, "openClawModel", "openclawModel") || process.env.OPENCLAW_MODEL?.trim() || undefined;
  if (runtime.provider === "nanobot") return process.env.NANOBOT_MODEL || providerDefinition?.defaultModelId || "nanobot-default";
  if (runtime.provider === "hermes") return process.env.HERMES_MODEL?.trim() || process.env.HERMES_INFERENCE_MODEL?.trim() || undefined;
  return providerDefinition?.defaultModelId;
}

export function readNodeMetadata(serverUrl: string, runtimeName: string, runtimes: ProviderRuntimeRecord[] = []): Record<string, unknown> {
  return {
    mode: "remote",
    pid: String(process.pid),
    runtimeName,
    nodeVersion,
    platform,
    arch,
    serverUrl,
    googleWorkspaceReadiness: readGoogleWorkspaceReadiness(),
    cliHubReadiness: readCliHubReadiness(),
    providerHealth: Object.fromEntries(
      runtimes
        .map((runtime) => [runtime.id, readRuntimeProviderHealthMetadata(runtime)] as const)
        .filter((entry): entry is readonly [string, NonNullable<ReturnType<typeof readRuntimeProviderHealthMetadata>>] => Boolean(entry[1])),
    ),
  };
}

export function buildProviderRuntimeMetadata(runtime: Pick<ProviderRuntimeRecord, "provider" | "metadata">): Record<string, unknown> {
  const base: Record<string, unknown> = {
    executablePath: runtime.metadata.executablePath,
    mode: runtime.metadata.mode,
  };
  if (runtime.provider === "openclaw") {
    const profile = process.env.OPENCLAW_PROFILE?.trim();
    const model = process.env.OPENCLAW_MODEL?.trim();
    const health = inspectOpenClawDaemonAuthHealth({
      env: process.env,
      profile,
      model,
    });
    return {
      ...base,
      openClawProfile: profile,
      openClawModel: model,
      providerHealth: buildOpenClawProviderHealthSnapshot(health),
    };
  }
  return base;
}

function readRuntimeProviderHealthMetadata(runtime: ProviderRuntimeRecord): ReturnType<typeof buildOpenClawProviderHealthSnapshot> | undefined {
  const metadata = runtime.metadata as Record<string, unknown>;
  const providerHealth = metadata.providerHealth;
  if (providerHealth && typeof providerHealth === "object" && !Array.isArray(providerHealth)) {
    return providerHealth as ReturnType<typeof buildOpenClawProviderHealthSnapshot>;
  }
  if (runtime.provider !== "openclaw") {
    return undefined;
  }
  const profile = readRuntimeMetadataString(runtime, "openClawProfile", "openclawProfile") || process.env.OPENCLAW_PROFILE?.trim() || undefined;
  const model = readRuntimeMetadataString(runtime, "openClawModel", "openclawModel") || process.env.OPENCLAW_MODEL?.trim() || undefined;
  return buildOpenClawProviderHealthSnapshot(inspectOpenClawDaemonAuthHealth({
    env: process.env,
    profile,
    model,
  }));
}

function readRuntimeMetadataString(runtime: ProviderRuntimeRecord, ...keys: string[]): string | undefined {
  const metadata = runtime.metadata as Record<string, unknown>;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function buildAgentRouterProviderEnv(
  runtime: ProviderRuntimeRecord,
  extra?: Record<string, string>,
): Record<string, string> {
  const env = buildProviderEnv(runtime, extra) as Record<string, string>;
  if (runtime.provider !== "openclaw") {
    return env;
  }
  const profile = readRuntimeMetadataString(runtime, "openClawProfile", "openclawProfile");
  const model = readRuntimeMetadataString(runtime, "openClawModel", "openclawModel");
  if (profile) {
    env.AGENT_SPACE_OPENCLAW_PROFILE_OVERRIDE = profile;
  }
  if (model) {
    env.AGENT_SPACE_OPENCLAW_MODEL_OVERRIDE = model;
  }
  return env;
}

function detectProviderVersion(executablePath: string, versionArgs: string[][] = [["--version"]]): string {
  for (const args of versionArgs) {
    const result = spawnSync(executablePath, args, {
      env: process.env,
      encoding: "utf8",
    });
    if (result.error || result.status !== 0) {
      continue;
    }

    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    const firstLine = output.split(/\r?\n/)[0] ?? "";
    if (firstLine) {
      return firstLine;
    }
  }
  return "";
}

function findExecutableOnPath(command: string): string | null {
  const pathValue = process.env.PATH;
  if (!pathValue) {
    return null;
  }

  const extensions = platform === "win32" ? [".exe", ".cmd", ".ps1", ""] : [""];
  for (const baseDir of pathValue.split(delimiter)) {
    for (const ext of extensions) {
      const candidate = join(baseDir, command + ext);
      if (isExecutableCandidate(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function isExecutableCandidate(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findFirstExecutableOnPath(commands: string[]): string | null {
  for (const command of commands) {
    const executablePath = findExecutableOnPath(command);
    if (executablePath) {
      return executablePath;
    }
  }
  return null;
}

function resolveProviderCommands(candidate: { command?: string; commands?: string[] }): string[] {
  return candidate.commands?.length ? candidate.commands : candidate.command ? [candidate.command] : [];
}

function isRootUser(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

let didWarnClaudeRootRuntime = false;

function warnClaudeRootRuntimeIfNeeded(action: "detected" | "executing"): void {
  if (!isRootUser() || didWarnClaudeRootRuntime) {
    return;
  }
  didWarnClaudeRootRuntime = true;
  console.warn(
    `Claude Code runtime ${action} while agent-space-daemon is running as root. `
    + "Ensure /root is logged in to Claude Code and treat task commands as root-privileged.",
  );
}

interface ClaudeDiagnosticState {
  eventTypeCounts: Map<string, number>;
  receivedResultEvent: boolean;
  receivedTextContentEvent: boolean;
  receivedToolEvent: boolean;
  permissionDenials: ClaudePermissionDenial[];
  parseErrorCount: number;
  nonJsonLineCount: number;
  stdoutLineCount: number;
  fallbackTextParts: string[];
}

interface ClaudePermissionDenial {
  toolName: string;
  toolUseId?: string;
  toolInput?: Record<string, unknown>;
}

interface ClaudeExecutionDiagnostics {
  exitCode: number | null;
  timedOut: boolean;
  stderrTail: string;
  stdoutTail: string;
  eventTypes: string;
  receivedResultEvent: boolean;
  receivedTextContentEvent: boolean;
  receivedToolEvent: boolean;
  sessionId?: string;
  parseErrorCount: number;
  nonJsonLineCount: number;
  stdoutLineCount: number;
}

async function runClaudeProviderTask(
  runtime: RemoteRuntimeRecord,
  prompt: string,
  workDir: string,
  taskTimeoutMs: number,
  options: ProviderTaskOptions,
): Promise<{ output: string; sessionId?: string }> {
  warnClaudeRootRuntimeIfNeeded("executing");

  clearTaskOutputArtifacts(workDir);
  try {
    return await runClaudeProviderTaskAttempt(runtime, prompt, workDir, taskTimeoutMs, options, options.sessionId);
  } catch (error) {
    if (!isClaudeMissingResumeSessionFailure(error, options.sessionId)) {
      throw error;
    }

    options.onEvent?.({
      type: "status",
      content: `Claude session ${options.sessionId} was not found; starting a new conversation.`,
    });
    clearTaskOutputArtifacts(workDir);
    return runClaudeProviderTaskAttempt(runtime, prompt, workDir, taskTimeoutMs, options, undefined);
  }
}

async function runClaudeProviderTaskAttempt(
  runtime: RemoteRuntimeRecord,
  prompt: string,
  workDir: string,
  taskTimeoutMs: number,
  options: ProviderTaskOptions,
  sessionId: string | undefined,
): Promise<{ output: string; sessionId?: string }> {
  const outputFile = join(workDir, "last-message.txt");
  let discoveredSessionId: string | undefined = sessionId;
  const model = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
  const autoApproveControlRequests = isRootUser();
  const providerArgs = [
    "-p",
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--verbose",
    "--max-turns", "30",
    "--model", model,
    ...buildClaudePermissionArgs(autoApproveControlRequests, options.temporaryAllowedTools),
  ];

  if (sessionId) {
    providerArgs.push("--resume", sessionId);
  }

  providerArgs.push("--tools", "default");
  const sandbox = await connectSandbox({
    runtimeId: runtime.id,
    workDir,
  });
  let finalOutput = "";
  let stderr = "";
  let stdoutBuffer = "";
  let stdinController: ExecController | undefined;
  const diagnosticState = createClaudeDiagnosticState();
  const processClaudeStdoutLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    diagnosticState.stdoutLineCount += 1;
    if (!trimmed.startsWith("{")) {
      diagnosticState.nonJsonLineCount += 1;
      return;
    }

    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      recordClaudeEventDiagnostics(diagnosticState, event);
      if (typeof event.session_id === "string") {
        discoveredSessionId = event.session_id;
      }
      const controlResponsePromise = autoApproveControlRequests
        ? buildClaudeControlResponse(event, runtime, discoveredSessionId, options)
        : Promise.resolve(null);
      void controlResponsePromise.then((controlResponse) => {
        if (controlResponse && stdinController) {
          stdinController.writeStdin(`${controlResponse}\n`);
        }
      }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        options.onEvent?.({
          type: "error",
          content: `Runtime approval failed: ${message}`,
        });
      });
      if (event.type === "result") {
        stdinController?.closeStdin();
        if (typeof event.result === "string") {
          finalOutput = event.result.trim();
        }
      }
      const fallbackText = extractClaudeFallbackText(event);
      if (fallbackText.length > 0) {
        diagnosticState.receivedTextContentEvent = true;
        diagnosticState.fallbackTextParts.push(...fallbackText);
      }
      for (const mapped of mapClaudeEvent(event)) {
        options.onEvent?.(mapped);
      }
    } catch {
      diagnosticState.parseErrorCount += 1;
    }
  };
  const result = await sandbox.exec({
    command: runtime.metadata.executablePath,
    args: providerArgs,
    input: buildClaudeStreamJsonInput(prompt),
    keepStdinOpen: autoApproveControlRequests,
    timeoutMs: taskTimeoutMs,
    env: buildClaudeEnv(runtime, options.contextEnv),
    onReady: (controller) => {
      stdinController = controller;
    },
    onStdout: (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        processClaudeStdoutLine(line);
      }
    },
    onStderr: (chunk) => {
      stderr += chunk;
    },
  });
  if (stdoutBuffer.trim()) {
    processClaudeStdoutLine(stdoutBuffer);
  }
  const diagnostics = buildClaudeExecutionDiagnostics(
    diagnosticState,
    result,
    stderr || result.stderr,
    discoveredSessionId,
  );

  if (result.timedOut) {
    throw buildClaudeProviderFailure(
      `claude timed out after ${taskTimeoutMs}ms.`,
      "provider.runtime_generic_failure",
      diagnostics,
      workDir,
    );
  }
  if (result.exitCode !== 0) {
    throw buildClaudeProviderFailure(
      `claude exited with code ${result.exitCode}.`,
      "provider.runtime_generic_failure",
      diagnostics,
      workDir,
    );
  }

  if (!finalOutput) {
    finalOutput = buildClaudeFallbackOutput(diagnosticState.fallbackTextParts);
  }
  if (diagnosticState.permissionDenials.length > 0 && options.onApprovalRequest) {
    const allowedTools: string[] = [];
    for (const denial of diagnosticState.permissionDenials) {
      const decision = await options.onApprovalRequest({
        provider: runtime.provider,
        runtimeId: runtime.id,
        sessionId: discoveredSessionId,
        toolName: denial.toolName,
        toolInput: denial.toolInput,
        contentPreview: formatClaudePermissionDenialPreview(denial),
      });
      if (decision.decision !== "approved") {
        throw buildClaudeProviderFailure(
          `Claude tool request was rejected.${decision.comment ? ` ${decision.comment}` : ""}`,
          "provider.runtime_generic_failure",
          diagnostics,
          workDir,
        );
      }
      const allowedTool = buildClaudeAllowedToolFromPermissionDenial(denial);
      if (allowedTool) {
        allowedTools.push(allowedTool);
      }
    }

    if (allowedTools.length > 0 && discoveredSessionId) {
      return runClaudeProviderTaskAttempt(
        runtime,
        "用户已经在 AgentSpace 前端批准了刚才被拦截的工具调用。请从刚才中断的位置继续，重新执行已获批准的工具命令，并基于真实结果完成用户请求。",
        workDir,
        taskTimeoutMs,
        {
          ...options,
          sessionId: discoveredSessionId,
          temporaryAllowedTools: allowedTools,
        },
        discoveredSessionId,
      );
    }
  }

  if (finalOutput) {
    writeFileSync(outputFile, finalOutput, "utf8");
  }

  const output = finalOutput || (existsSync(outputFile) ? readFileSync(outputFile, "utf8").trim() : "");
  if (!output) {
    throw buildClaudeProviderFailure(
      "claude returned an empty response.",
      resolveClaudeEmptyResponseCode(diagnostics),
      diagnostics,
      workDir,
    );
  }

  return { output, sessionId: discoveredSessionId };
}

function isClaudeMissingResumeSessionFailure(error: unknown, requestedSessionId: string | undefined): boolean {
  if (!requestedSessionId || !(error instanceof ProviderTaskExecutionError)) {
    return false;
  }
  const diagnosticText = [
    error.message,
    error.providerError?.message,
    error.providerError?.rawProviderMessage,
  ].filter((value): value is string => typeof value === "string").join("\n");
  return (
    CLAUDE_MISSING_RESUME_SESSION_PATTERN.test(diagnosticText) &&
    diagnosticText.includes(requestedSessionId)
  );
}

function createClaudeDiagnosticState(): ClaudeDiagnosticState {
  return {
    eventTypeCounts: new Map(),
    receivedResultEvent: false,
    receivedTextContentEvent: false,
    receivedToolEvent: false,
    permissionDenials: [],
    parseErrorCount: 0,
    nonJsonLineCount: 0,
    stdoutLineCount: 0,
    fallbackTextParts: [],
  };
}

function recordClaudeEventDiagnostics(state: ClaudeDiagnosticState, event: Record<string, unknown>): void {
  const type = typeof event.type === "string" && event.type.trim() ? event.type.trim() : "unknown";
  state.eventTypeCounts.set(type, (state.eventTypeCounts.get(type) ?? 0) + 1);
  if (type === "result") {
    state.receivedResultEvent = true;
  }
  if (type === "tool_use" || type === "tool_result") {
    state.receivedToolEvent = true;
  }
  if (type === "result") {
    state.permissionDenials = extractClaudePermissionDenials(event);
  }
}

function buildClaudeExecutionDiagnostics(
  state: ClaudeDiagnosticState,
  result: { stdout: string; stderr: string; exitCode: number | null; timedOut: boolean },
  streamedStderr: string,
  sessionId?: string,
): ClaudeExecutionDiagnostics {
  return {
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stderrTail: buildDiagnosticTail(streamedStderr || result.stderr),
    stdoutTail: buildDiagnosticTail(result.stdout),
    eventTypes: formatEventTypeCounts(state.eventTypeCounts),
    receivedResultEvent: state.receivedResultEvent,
    receivedTextContentEvent: state.receivedTextContentEvent,
    receivedToolEvent: state.receivedToolEvent,
    sessionId,
    parseErrorCount: state.parseErrorCount,
    nonJsonLineCount: state.nonJsonLineCount,
    stdoutLineCount: state.stdoutLineCount,
  };
}

function resolveClaudeEmptyResponseCode(diagnostics: ClaudeExecutionDiagnostics): ProviderErrorCode {
  if (!diagnostics.stdoutTail) {
    return "provider.empty_response.stdout_empty";
  }
  if (
    diagnostics.eventTypes === "none" &&
    (diagnostics.parseErrorCount > 0 || diagnostics.nonJsonLineCount > 0)
  ) {
    return "provider.protocol_parse_failed";
  }
  if (!diagnostics.receivedResultEvent) {
    return "provider.empty_response.no_result_event";
  }
  return "provider.empty_response.no_text_event";
}

function buildClaudeProviderFailure(
  message: string,
  code: ProviderErrorCode,
  diagnostics: ClaudeExecutionDiagnostics,
  workDir: string,
): ProviderTaskExecutionError {
  const details = formatClaudeDiagnosticDetails(code, diagnostics);
  const fullMessage = `${message} ${details}`;
  return new ProviderTaskExecutionError(fullMessage, {
    sessionId: diagnostics.sessionId,
    workDir,
    providerError: {
      provider: "claude",
      code,
      category: code === "provider.runtime_generic_failure" ? "runtime" : "provider",
      message: fullMessage,
      rawProviderMessage: formatClaudeRawDiagnostic(diagnostics),
    },
  });
}

function formatClaudeDiagnosticDetails(code: ProviderErrorCode, diagnostics: ClaudeExecutionDiagnostics): string {
  const parts = [
    `code=${code}`,
    `exitCode=${diagnostics.exitCode ?? "null"}`,
    `timedOut=${diagnostics.timedOut}`,
    `events=${diagnostics.eventTypes}`,
    `resultEvent=${diagnostics.receivedResultEvent}`,
    `textEvent=${diagnostics.receivedTextContentEvent}`,
    `toolEvent=${diagnostics.receivedToolEvent}`,
    `parseErrors=${diagnostics.parseErrorCount}`,
    `nonJsonLines=${diagnostics.nonJsonLineCount}`,
  ];
  if (diagnostics.sessionId) {
    parts.push(`sessionId=${diagnostics.sessionId}`);
  }
  if (diagnostics.stdoutTail) {
    parts.push(`stdoutTail=${JSON.stringify(diagnostics.stdoutTail)}`);
  }
  if (diagnostics.stderrTail) {
    parts.push(`stderrTail=${JSON.stringify(diagnostics.stderrTail)}`);
  }
  return `(${parts.join("; ")})`;
}

function formatClaudeRawDiagnostic(diagnostics: ClaudeExecutionDiagnostics): string {
  return [
    `events=${diagnostics.eventTypes}`,
    `stdoutTail=${diagnostics.stdoutTail || ""}`,
    `stderrTail=${diagnostics.stderrTail || ""}`,
  ].join("\n");
}

function formatEventTypeCounts(counts: Map<string, number>): string {
  if (counts.size === 0) {
    return "none";
  }
  return [...counts.entries()]
    .map(([type, count]) => `${type}:${count}`)
    .join(",");
}

function buildDiagnosticTail(value: string, maxChars = 600): string {
  const sanitized = sanitizeProviderDiagnosticOutput(value.trim());
  if (!sanitized) {
    return "";
  }
  return sanitized.length > maxChars ? `...${sanitized.slice(-maxChars)}` : sanitized;
}

function sanitizeProviderDiagnosticOutput(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, "[redacted-secret]")
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|API[_-]?KEY)[A-Z0-9_]*\s*=\s*)[^\s"']+/gi, "$1[redacted]")
    .replace(/([?&](?:access_token|refresh_token|token|api_key)=)[^&\s"']+/gi, "$1[redacted]");
}

function buildClaudeFallbackOutput(parts: string[]): string {
  const output = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  return output;
}

function extractClaudeFallbackText(event: Record<string, unknown>): string[] {
  const type = typeof event.type === "string" ? event.type : "";
  if (type === "result" && typeof event.result === "string") {
    return [event.result.trim()].filter(Boolean);
  }
  if (type === "assistant" && event.message && typeof event.message === "object") {
    const message = event.message as Record<string, unknown>;
    return extractClaudeContentText(message.content);
  }
  if (type === "assistant") {
    return extractClaudeContentText(event.content);
  }
  if (type === "text" || type === "message") {
    return extractClaudeContentText(event.text ?? event.content);
  }
  if (type === "content_block_delta" && event.delta && typeof event.delta === "object") {
    return extractClaudeContentText((event.delta as Record<string, unknown>).text);
  }
  if (type === "tool_result") {
    return extractClaudeContentText(event.output ?? event.content);
  }
  return [];
}

function extractClaudeAssistantText(event: Record<string, unknown>): string {
  if (event.type !== "assistant") {
    return "";
  }
  const parts = event.message && typeof event.message === "object"
    ? extractClaudeContentText((event.message as Record<string, unknown>).content)
    : extractClaudeContentText(event.content);
  return buildClaudeFallbackOutput(parts);
}

function extractClaudeContentText(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractClaudeContentText(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      return extractClaudeContentText(record.text);
    }
    if (typeof record.content === "string" || Array.isArray(record.content)) {
      return extractClaudeContentText(record.content);
    }
    if (typeof record.output === "string") {
      return extractClaudeContentText(record.output);
    }
  }
  return [];
}

function buildClaudeStreamJsonInput(prompt: string): string {
  return `${JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text: prompt,
        },
      ],
    },
  })}\n`;
}

async function buildClaudeControlResponse(
  event: Record<string, unknown>,
  runtime: RemoteRuntimeRecord,
  sessionId: string | undefined,
  options: ProviderTaskOptions,
): Promise<string | null> {
  if (event.type !== "control_request") {
    return null;
  }

  const requestId = typeof event.request_id === "string" ? event.request_id : "";
  if (!requestId) {
    return null;
  }

  const request = typeof event.request === "object" && event.request
    ? event.request as Record<string, unknown>
    : {};
  const input = typeof request.input === "object" && request.input
    ? request.input as Record<string, unknown>
    : {};
  if (options.onApprovalRequest) {
    const decision = await options.onApprovalRequest({
      provider: runtime.provider,
      runtimeId: runtime.id,
      sessionId,
      toolName: typeof request.tool_name === "string" ? request.tool_name : "unknown",
      toolInput: input,
      contentPreview: formatToolApprovalPreview(
        typeof request.tool_name === "string" ? request.tool_name : "unknown",
        input,
      ),
    });
    if (decision.decision !== "approved") {
      return JSON.stringify({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: requestId,
          response: {
            behavior: "deny",
            message: decision.comment ?? "Rejected in AgentSpace.",
          },
        },
      });
    }
  }

  return JSON.stringify({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: requestId,
      response: {
        behavior: "allow",
        updatedInput: input,
      },
    },
  });
}

function buildClaudePermissionArgs(isRoot = isRootUser(), temporaryAllowedTools: string[] = []): string[] {
  if (!isRoot) {
    return [
      "--permission-mode", "bypassPermissions",
      "--dangerously-skip-permissions",
    ];
  }

  return [
    "--permission-mode", "auto",
    "--allowedTools", ...dedupeStrings([...buildDefaultClaudeAllowedTools(), ...temporaryAllowedTools]),
  ];
}

function extractClaudePermissionDenials(event: Record<string, unknown>): ClaudePermissionDenial[] {
  const denials = Array.isArray(event.permission_denials) ? event.permission_denials : [];
  return denials.flatMap((item): ClaudePermissionDenial[] => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const record = item as Record<string, unknown>;
    const toolName = typeof record.tool_name === "string" && record.tool_name.trim()
      ? record.tool_name.trim()
      : "unknown";
    const toolInput = record.tool_input && typeof record.tool_input === "object"
      ? record.tool_input as Record<string, unknown>
      : undefined;
    return [{
      toolName,
      toolUseId: typeof record.tool_use_id === "string" ? record.tool_use_id : undefined,
      toolInput,
    }];
  });
}

function buildClaudeAllowedToolFromPermissionDenial(denial: ClaudePermissionDenial): string | undefined {
  if (denial.toolName !== "Bash") {
    return denial.toolName && denial.toolName !== "unknown" ? denial.toolName : undefined;
  }
  const command = typeof denial.toolInput?.command === "string" ? denial.toolInput.command.trim() : "";
  return command ? `Bash(${command})` : "Bash(*)";
}

function formatClaudePermissionDenialPreview(denial: ClaudePermissionDenial): string {
  return formatToolApprovalPreview(denial.toolName, denial.toolInput);
}

function formatToolApprovalPreview(toolName: string, toolInput?: Record<string, unknown>): string {
  if (toolName === "Bash" && typeof toolInput?.command === "string") {
    return `Bash: ${toolInput.command}`;
  }
  return `${toolName}: ${JSON.stringify(toolInput ?? {})}`;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

async function runGeminiProviderTask(
  runtime: ProviderRuntimeRecord,
  prompt: string,
  workDir: string,
  taskTimeoutMs: number,
  options: ProviderTaskOptions,
): Promise<{ output: string; sessionId?: string }> {
  clearTaskOutputArtifacts(workDir);
  const outputFile = join(workDir, "last-message.txt");
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";
  const providerArgs = ["--model", model, "--sandbox", "-y", prompt];
  const sandbox = await connectSandbox({
    runtimeId: runtime.id,
    workDir,
  });
  let finalOutput = "";
  let stderr = "";
  let stdoutBuffer = "";
  const result = await sandbox.exec({
    command: runtime.metadata.executablePath,
    args: providerArgs,
    timeoutMs: taskTimeoutMs,
    env: buildProviderEnv(runtime, options.contextEnv),
    onStdout: (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        if (trimmed.startsWith("{")) {
          try {
            const event = JSON.parse(trimmed) as Record<string, unknown>;
            for (const mapped of mapGeminiEvent(event)) {
              options.onEvent?.(mapped);
            }
            continue;
          } catch {
            // Fall through and treat as output.
          }
        }

        finalOutput += (finalOutput ? "\n" : "") + trimmed;
      }
    },
    onStderr: (chunk) => {
      stderr += chunk;
    },
  });

  if (stdoutBuffer.trim()) {
    finalOutput += (finalOutput ? "\n" : "") + stdoutBuffer.trim();
  }
  if (result.timedOut) {
    throw new Error(`gemini timed out after ${taskTimeoutMs}ms.`);
  }
  if (result.exitCode !== 0) {
    throw new Error(stderr.trim() || `gemini exited with code ${result.exitCode}.`);
  }

  if (finalOutput) {
    writeFileSync(outputFile, finalOutput, "utf8");
  }

  const output = finalOutput || (existsSync(outputFile) ? readFileSync(outputFile, "utf8").trim() : "");
  if (!output) {
    throw new Error("gemini returned an empty response.");
  }

  return { output };
}

async function runNanoBotProviderTask(
  runtime: ProviderRuntimeRecord,
  prompt: string,
  workDir: string,
  taskTimeoutMs: number,
  options: ProviderTaskOptions,
): Promise<{ output: string; sessionId?: string }> {
  clearTaskOutputArtifacts(workDir);
  const outputFile = join(workDir, "last-message.txt");
  const configPath = process.env.NANOBOT_CONFIG_PATH?.trim() || process.env.NANOBOT_CONFIG?.trim();
  const providerArgs = ["agent", "-w", workDir, "-m", prompt, "--no-markdown"];
  if (configPath) {
    providerArgs.splice(1, 0, "-c", configPath);
  }

  let stderr = "";
  const result = await execProviderCommand(runtime, providerArgs, workDir, taskTimeoutMs, buildNanoBotEnv(runtime, options.contextEnv), {
    onStderr: (chunk) => {
      stderr += chunk;
    },
  });

  if (result.result.timedOut) {
    throw new Error(`nanobot timed out after ${taskTimeoutMs}ms.`);
  }
  if (result.result.exitCode !== 0) {
    throw new Error(stderr.trim() || `nanobot exited with code ${result.result.exitCode}.`);
  }

  const output = result.stdout.trim();
  if (output) {
    writeFileSync(outputFile, output, "utf8");
  }

  if (!output) {
    throw new Error("nanobot returned an empty response.");
  }

  return { output };
}

function mapCodexExecEvent(event: Record<string, unknown>): ProviderTaskEvent[] {
  const type = typeof event.type === "string" ? event.type : "";

  if (type === "item.started" || type === "item.completed") {
    const item = event.item;
    if (!item || typeof item !== "object") {
      return [];
    }

    const typedItem = item as Record<string, unknown>;
    const itemType = typeof typedItem.type === "string" ? typedItem.type : "";

    if (itemType === "commandExecution" || itemType === "command_execution") {
      const command =
        typeof typedItem.command === "string"
          ? typedItem.command
          : typeof typedItem.input === "object" && typedItem.input && typeof (typedItem.input as Record<string, unknown>).command === "string"
            ? ((typedItem.input as Record<string, unknown>).command as string)
            : undefined;
      if (type === "item.started") {
        return [{
          type: "tool_use",
          tool: "exec_command",
          content: command ? `bash: ${command}` : "bash",
          inputJson: command ? { command } : undefined,
        }];
      }

      const output =
        typeof typedItem.aggregatedOutput === "string"
          ? typedItem.aggregatedOutput
          : typeof typedItem.aggregated_output === "string"
            ? typedItem.aggregated_output
          : typeof typedItem.output === "string"
            ? typedItem.output
            : "";
      return [{
        type: "tool_result",
        tool: "exec_command",
        content: output ? truncateToolOutput(output) : "bash 执行完成",
        output: output ? truncateToolOutput(output) : undefined,
      }];
    }

    if (itemType === "fileChange" || itemType === "file_change") {
      if (type === "item.started") {
        return [{ type: "tool_use", tool: "patch_apply", content: "开始修改文件" }];
      }
      return [{ type: "tool_result", tool: "patch_apply", content: "文件修改完成" }];
    }

    if ((itemType === "agentMessage" || itemType === "agent_message") && typeof typedItem.text === "string") {
      const phase = typeof typedItem.phase === "string" ? typedItem.phase : "";
      if (phase !== "final_answer") {
        return [{ type: "thinking", content: typedItem.text }];
      }
    }
  }

  return [];
}

function mapClaudeEvent(event: Record<string, unknown>): ProviderTaskEvent[] {
  const type = typeof event.type === "string" ? event.type : "";

  if (type === "assistant") {
    const assistantText = extractClaudeAssistantText(event);
    if (assistantText) {
      return [{ type: "thinking", content: assistantText }];
    }
  }

  if (type === "tool_use") {
    return [{
      type: "tool_use",
      tool: typeof event.name === "string" ? event.name : "unknown",
      content: typeof event.name === "string" ? event.name : "tool call",
      inputJson: typeof event.input === "object" && event.input ? event.input as Record<string, unknown> : undefined,
    }];
  }

  if (type === "tool_result") {
    return [{
      type: "tool_result",
      tool: typeof event.name === "string" ? event.name : undefined,
      content: typeof event.output === "string" ? truncateToolOutput(event.output) : "completed",
      output: typeof event.output === "string" ? truncateToolOutput(event.output) : undefined,
    }];
  }

  if (type === "result" && typeof event.usage === "object" && event.usage) {
    const usage = event.usage as { input_tokens?: number; output_tokens?: number };
    if (typeof usage.input_tokens === "number" || typeof usage.output_tokens === "number") {
      return [{
        type: "usage",
        content: `tokens: in=${usage.input_tokens ?? 0} out=${usage.output_tokens ?? 0}`,
        inputJson: { input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0 },
      }];
    }
  }

  return [];
}

function mapGeminiEvent(event: Record<string, unknown>): ProviderTaskEvent[] {
  const type = typeof event.type === "string" ? event.type : "";

  if (type === "tool_call" || type === "function_call") {
    return [{
      type: "tool_use",
      tool: typeof event.name === "string" ? event.name : "unknown",
      content: typeof event.name === "string" ? event.name : "tool call",
    }];
  }

  if (type === "tool_result" || type === "function_response") {
    return [{
      type: "tool_result",
      content: typeof event.output === "string" ? truncateToolOutput(event.output) : "completed",
    }];
  }

  return [];
}

function truncateToolOutput(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 1200) {
    return trimmed;
  }
  return `${trimmed.slice(0, 1197)}...`;
}

function buildProviderEnv(runtime: ProviderRuntimeRecord, extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const currentPath = extra?.PATH ?? env.PATH ?? "";
  env.PATH = ensureProviderPath(currentPath, runtime);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (typeof value !== "string") {
        continue;
      }
      env[key] = key === "PATH" ? ensureProviderPath(value, runtime) : value;
    }
  }
  return env;
}

function buildClaudeEnv(runtime: ProviderRuntimeRecord, extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = buildProviderEnv(runtime, extra);
  for (const [key, value] of Object.entries(process.env)) {
    if (key === "CLAUDECODE" || key.startsWith("CLAUDECODE_") || key.startsWith("CLAUDE_CODE_")) {
      delete env[key];
      continue;
    }
  }
  return env;
}

function ensureProviderPath(pathValue: string, runtime: ProviderRuntimeRecord): string {
  const runtimeBinDirs = dedupeStrings([
    dirname(runtime.metadata.executablePath),
    process.env.AGENT_SPACE_DAEMON_BIN ? dirname(process.env.AGENT_SPACE_DAEMON_BIN) : "",
    process.env.AGENT_SPACE_DAEMON_INSTALL_ROOT ? join(process.env.AGENT_SPACE_DAEMON_INSTALL_ROOT, "bin") : "",
  ]);
  const parts = pathValue.split(delimiter).filter(Boolean);
  const existing = parts.filter((part) => !runtimeBinDirs.includes(part));
  return [...runtimeBinDirs, ...existing].filter(Boolean).join(delimiter);
}

async function execProviderCommand(
  runtime: ProviderRuntimeRecord,
  args: string[],
  workDir: string,
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
  callbacks?: {
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  },
): Promise<{
  stdout: string;
  stderr: string;
  result: Awaited<ReturnType<Awaited<ReturnType<typeof connectSandbox>>["exec"]>>;
}> {
  const sandbox = await connectSandbox({
    runtimeId: runtime.id,
    workDir,
  });

  let stdout = "";
  let stderr = "";
  const result = await sandbox.exec({
    command: runtime.metadata.executablePath,
    args,
    timeoutMs,
    env: buildProviderEnv(runtime, env),
    onStdout: (chunk) => {
      stdout += chunk;
      callbacks?.onStdout?.(chunk);
    },
    onStderr: (chunk) => {
      stderr += chunk;
      callbacks?.onStderr?.(chunk);
    },
  });

  return { stdout, stderr, result };
}

function buildNanoBotEnv(runtime: ProviderRuntimeRecord, extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = buildProviderEnv(runtime, extra);

  const model = process.env.NANOBOT_MODEL?.trim();
  if (model && !env.NANOBOT_AGENTS__DEFAULTS__MODEL) {
    env.NANOBOT_AGENTS__DEFAULTS__MODEL = model;
  }

  return env;
}

function parseJsonOutput(output: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        events.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Ignore invalid JSON lines.
    }
  }

  if (events.length > 0) {
    return events;
  }

  const trimmed = output.trim();
  if (!trimmed.startsWith("{")) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      return [parsed as Record<string, unknown>];
    }
  } catch {
    // Ignore invalid JSON payloads.
  }

  return [];
}

function extractSessionId(event: Record<string, unknown>): string | undefined {
  return readStringAtPaths(event, [
    ["sessionId"],
    ["session_id"],
    ["thread_id"],
    ["threadId"],
    ["result", "sessionId"],
    ["result", "session_id"],
    ["meta", "sessionId"],
    ["meta", "session_id"],
  ]);
}

function readValueAtPaths(value: unknown, paths: string[][]): unknown {
  for (const path of paths) {
    let cursor: unknown = value;
    let matched = true;
    for (const segment of path) {
      if (!cursor || typeof cursor !== "object" || !(segment in (cursor as Record<string, unknown>))) {
        matched = false;
        break;
      }
      cursor = (cursor as Record<string, unknown>)[segment];
    }
    if (matched) {
      return cursor;
    }
  }
  return undefined;
}

function readStringAtPaths(value: unknown, paths: string[][]): string | undefined {
  const candidate = readValueAtPaths(value, paths);
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

export function readProviderTaskFailureMetadata(error: unknown): {
  sessionId?: string;
  workDir?: string;
  providerError?: ProviderTaskStructuredError;
} | undefined {
  if (!(error instanceof ProviderTaskExecutionError)) {
    return undefined;
  }

  return {
    sessionId: error.sessionId,
    workDir: error.workDir,
    providerError: error.providerError,
  };
}

export function normalizeProviderTaskErrorCategory(
  category: ProviderTaskStructuredError["category"] | undefined,
): ProviderErrorCategory | undefined {
  return (
    category === "provider" ||
    category === "runtime" ||
    category === "configuration" ||
    category === "auth" ||
    category === "profile" ||
    category === "model" ||
    category === "tool" ||
    category === "protocol" ||
    category === "unknown"
  )
    ? category
    : undefined;
}
