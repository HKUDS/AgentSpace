import type { RuntimeToolCapability } from "@agent-space/domain";
import type { ProviderHealthSnapshot } from "@agent-space/domain";

export const AGENT_ROUTER_HARNESSES = ["claude", "codex", "opencode", "openclaw", "hermes"] as const;

export type AgentRouterHarness = typeof AGENT_ROUTER_HARNESSES[number];

export type AgentRouterOutputFormat = "text" | "json-events";

export interface AgentRouterRunRequest {
  version: 1;
  harness: AgentRouterHarness;
  prompt: string;
  cwd: string;
  executablePath?: string;
  model?: string;
  mode?: string;
  sessionId?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  outputFormat?: AgentRouterOutputFormat;
  maxTurns?: number;
  permissionMode?: string;
  dangerouslyBypassPermissions?: boolean;
  allowedTools?: string[];
  temporaryAllowedTools?: string[];
  claudeTools?: string;
  handleControlRequests?: boolean;
  openClawEphemeralAgent?: boolean;
  providerHealth?: ProviderHealthSnapshot;
  runtimeToolCapabilities?: RuntimeToolCapability[];
  onApprovalRequest?: (request: AgentRouterApprovalRequest) => Promise<AgentRouterApprovalDecision>;
}

export interface AgentRouterRunResult {
  status: "completed" | "failed" | "cancelled" | "timeout";
  harness: AgentRouterHarness;
  sessionId?: string;
  outputText?: string;
  events: AgentRouterEvent[];
  diagnostics: AgentRouterDiagnostic[];
  exitCode?: number | null;
  signal?: string | null;
  startedAt: string;
  finishedAt: string;
}

export type AgentRouterEvent =
  | { type: "harness_detected"; harness: string; version?: string; path?: string }
  | { type: "harness_started"; harness: string; pid?: number; command: string[] }
  | { type: "text_delta"; text: string }
  | { type: "thought_delta"; text: string }
  | { type: "approval_requested"; toolName: string; toolInput?: Record<string, unknown>; contentPreview: string }
  | { type: "tool_started"; tool: string; title?: string; input?: unknown }
  | { type: "tool_output"; tool: string; output?: string; metadata?: unknown }
  | { type: "tool_finished"; tool: string; status: "completed" | "failed" }
  | { type: "session_updated"; sessionId: string }
  | { type: "harness_exited"; exitCode: number | null; signal?: string | null };

export interface AgentRouterDiagnostic {
  code:
    | "harness.cli_missing"
    | "harness.auth_required"
    | "harness.auth_invalid"
    | "harness.profile_missing"
    | "harness.model_unavailable"
    | "harness.tool_available"
    | "harness.tool_missing"
    | "harness.tool_unauthorized"
    | "harness.tool_permission_denied"
    | "harness.empty_response"
    | "harness.protocol_parse_failed"
    | "harness.timeout"
    | "harness.session_missing"
    | "harness.exited_nonzero"
    | "harness.unknown_failure";
  severity: "info" | "warning" | "error";
  message: string;
  rawProviderMessage?: string;
  stderrTail?: string;
}

export type { RuntimeToolCapability } from "@agent-space/domain";

export interface AgentRouterApprovalRequest {
  harness: AgentRouterHarness;
  sessionId?: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  contentPreview: string;
}

export interface AgentRouterApprovalDecision {
  decision: "approved" | "rejected";
  comment?: string;
}

export interface HarnessLaunchPlan {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  metadata?: Record<string, string>;
  stdin?: string;
  keepStdinOpen?: boolean;
  timeoutMs: number;
  redactions: Array<{
    envName?: string;
    pattern?: string;
    replacement: string;
  }>;
}

export interface HarnessDetectionResult {
  id: AgentRouterHarness;
  label: string;
  status: "available" | "missing";
  path?: string;
  version?: string;
}

export interface HarnessErrorContext {
  request: AgentRouterRunRequest;
  plan?: HarnessLaunchPlan;
  stderrTail?: string;
  stdoutTail?: string;
  exitCode?: number | null;
  signal?: string | null;
  timedOut?: boolean;
}

export interface AgentRouterObserver {
  emit(event: AgentRouterEvent): void;
}

export interface HarnessAdapter {
  id: AgentRouterHarness;
  label: string;
  detect(): Promise<HarnessDetectionResult>;
  buildLaunch(input: AgentRouterRunRequest): Promise<HarnessLaunchPlan>;
  run(plan: HarnessLaunchPlan, observer: AgentRouterObserver, request: AgentRouterRunRequest): Promise<AgentRouterRunResult>;
  normalizeError(error: unknown, context: HarnessErrorContext): AgentRouterDiagnostic;
}

export interface HarnessCatalogEntry {
  id: AgentRouterHarness;
  label: string;
}
