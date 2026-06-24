import { constants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { platform } from "node:process";
import type { AgentRouterDiagnostic, HarnessLaunchPlan } from "./types.ts";

export const DEFAULT_AGENT_ROUTER_TIMEOUT_MS = 12 * 60 * 60 * 1000;
export const STDERR_TAIL_LIMIT = 8_000;

export function resolveTimeoutMs(value: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return DEFAULT_AGENT_ROUTER_TIMEOUT_MS;
}

export async function findExecutableOnPath(command: string): Promise<string | null> {
  if (isPathLike(command)) {
    return await isExecutableCandidate(command) ? resolve(command) : null;
  }

  const pathValue = process.env.PATH;
  if (!pathValue) {
    return null;
  }

  const extensions = platform === "win32" ? [".exe", ".cmd", ".ps1", ""] : [""];
  for (const baseDir of pathValue.split(delimiter)) {
    for (const extension of extensions) {
      const candidate = join(baseDir, command + extension);
      if (await isExecutableCandidate(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

export async function resolveExecutablePath(command: string, executablePath?: string): Promise<string | null> {
  const candidate = executablePath?.trim() || command;
  return findExecutableOnPath(candidate);
}

export function buildBaseEnv(
  executablePath: string,
  extra?: Record<string, string>,
  pathDirs: string[] = [],
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  const currentPath = extra?.PATH ?? env.PATH ?? "";
  env.PATH = ensureExecutablePath(currentPath, executablePath, pathDirs);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      env[key] = key === "PATH" ? ensureExecutablePath(value, executablePath, pathDirs) : value;
    }
  }
  return env;
}

export function ensureEnvPath(pathValue: string, paths: string[]): string {
  const normalizedPaths = paths.map((path) => path.trim()).filter(Boolean);
  const parts = pathValue.split(delimiter).filter(Boolean);
  const existing = parts.filter((part) => !normalizedPaths.includes(part));
  return [...normalizedPaths, ...existing].filter(Boolean).join(delimiter);
}

export function buildRedactions(env: Record<string, string>): HarnessLaunchPlan["redactions"] {
  const redactions: HarnessLaunchPlan["redactions"] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!value || !isSecretEnvName(key)) {
      continue;
    }
    redactions.push({
      envName: key,
      pattern: escapeRegExp(value),
      replacement: `[redacted:${key}]`,
    });
  }
  return redactions;
}

export function redactText(value: string, redactions: HarnessLaunchPlan["redactions"]): string {
  let result = value;
  for (const redaction of redactions) {
    if (redaction.pattern) {
      result = result.replace(new RegExp(redaction.pattern, "g"), redaction.replacement);
    }
  }
  return result;
}

export function tailText(value: string | undefined, limit = STDERR_TAIL_LIMIT): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = sanitizeDiagnosticText(value.trim());
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return trimmed.slice(trimmed.length - limit);
}

export function createDiagnostic(
  code: AgentRouterDiagnostic["code"],
  message: string,
  options: {
    severity?: AgentRouterDiagnostic["severity"];
    rawProviderMessage?: string;
    stderrTail?: string;
  } = {},
): AgentRouterDiagnostic {
  return {
    code,
    severity: options.severity ?? (code === "harness.protocol_parse_failed" ? "warning" : "error"),
    message,
    rawProviderMessage: options.rawProviderMessage,
    stderrTail: options.stderrTail,
  };
}

export function parseJsonObjects(output: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
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
      // Parse diagnostics are handled by adapter-specific logic.
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
    // Parse diagnostics are handled by adapter-specific logic.
  }

  return [];
}

export function outputHasInvalidJsonCandidate(output: string): boolean {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      JSON.parse(trimmed);
    } catch {
      return true;
    }
  }
  return false;
}

export function readStringAtPaths(value: unknown, paths: string[][]): string | undefined {
  const candidate = readValueAtPaths(value, paths);
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

export function readNumberAtPaths(value: unknown, paths: string[][]): number | undefined {
  const candidate = readValueAtPaths(value, paths);
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

export function readValueAtPaths(value: unknown, paths: string[][]): unknown {
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

export function extractText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => extractText(entry))
      .filter((entry): entry is string => Boolean(entry));
    return parts.length > 0 ? parts.join("\n") : undefined;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  for (const key of ["payload", "result", "output", "response", "message", "content", "text", "answer", "assistant", "messages", "parts"]) {
    if (!(key in candidate)) {
      continue;
    }
    const extracted = extractText(candidate[key]);
    if (extracted) {
      return extracted;
    }
  }

  return undefined;
}

export function extractSessionId(event: Record<string, unknown>): string | undefined {
  return readStringAtPaths(event, [
    ["sessionID"],
    ["sessionId"],
    ["session_id"],
    ["thread_id"],
    ["threadId"],
    ["conversation_id"],
    ["conversationId"],
    ["session", "id"],
    ["part", "sessionID"],
    ["part", "sessionId"],
    ["part", "session_id"],
    ["result", "sessionId"],
    ["result", "session_id"],
    ["result", "thread_id"],
    ["meta", "sessionId"],
    ["meta", "session_id"],
  ]);
}

export function extractUsage(event: Record<string, unknown>): { inputTokens: number; outputTokens: number } | undefined {
  const usageCandidate = readValueAtPaths(event, [
    ["usage"],
    ["lastCallUsage"],
    ["result", "usage"],
    ["result", "lastCallUsage"],
    ["result", "meta", "agentMeta", "lastCallUsage"],
    ["meta", "agentMeta", "lastCallUsage"],
  ]);
  if (!usageCandidate || typeof usageCandidate !== "object") {
    return undefined;
  }

  const usage = usageCandidate as Record<string, unknown>;
  const inputTokens = readNumberAtPaths(usage, [["input_tokens"], ["inputTokens"], ["promptTokens"]]) ?? 0;
  const outputTokens = readNumberAtPaths(usage, [["output_tokens"], ["outputTokens"], ["completionTokens"]]) ?? 0;
  if (inputTokens <= 0 && outputTokens <= 0) {
    return undefined;
  }
  return { inputTokens, outputTokens };
}

export function appendLine(current: string, next: string): string {
  return current ? `${current}\n${next}` : next;
}

export function normalizeSignal(signal: NodeJS.Signals | null): string | null {
  return signal ?? null;
}

async function isExecutableCandidate(candidate: string): Promise<boolean> {
  if (!existsSync(candidate)) {
    return false;
  }
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function ensureExecutablePath(pathValue: string, executablePath: string, pathDirs: string[]): string {
  return ensureEnvPath(pathValue, [
    dirname(executablePath),
    ...pathDirs,
    process.env.AGENT_SPACE_DAEMON_BIN ? dirname(process.env.AGENT_SPACE_DAEMON_BIN) : "",
    process.env.AGENT_SPACE_DAEMON_INSTALL_ROOT ? join(process.env.AGENT_SPACE_DAEMON_INSTALL_ROOT, "bin") : "",
    "/usr/local/sbin",
    "/usr/local/bin",
    "/usr/sbin",
    "/usr/bin",
    "/sbin",
    "/bin",
  ]);
}

function isPathLike(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function isSecretEnvName(name: string): boolean {
  return /(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY|AUTH|CREDENTIAL)/i.test(name);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, "[redacted-secret]")
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|API[_-]?KEY)[A-Z0-9_]*\s*=\s*)[^\s"']+/gi, "$1[redacted]")
    .replace(/([?&](?:access_token|refresh_token|token|api_key)=)[^&\s"']+/gi, "$1[redacted]");
}
