import type {
  AgentRouterDiagnostic,
  AgentRouterObserver,
  AgentRouterRunRequest,
  AgentRouterRunResult,
  HarnessAdapter,
  HarnessDetectionResult,
  HarnessErrorContext,
  HarnessLaunchPlan,
} from "../types.ts";
import { extractOpenCodeFinalText, mapOpenCodeNativeEvent } from "../events.ts";
import { buildCapabilityEnv, buildCapabilityPathDirs } from "../capabilities.ts";
import {
  appendLine,
  buildBaseEnv,
  buildRedactions,
  createDiagnostic,
  findExecutableOnPath,
  outputHasInvalidJsonCandidate,
  resolveExecutablePath,
  resolveTimeoutMs,
  tailText,
} from "../utils.ts";
import {
  buildOpenCodeProviderHealthSnapshot,
  inspectOpenCodeProviderHealth,
  normalizeOpenCodeProviderError,
  type OpenCodeProviderError,
  type OpenCodeProviderHealth,
} from "../../opencode-health.ts";
import { discoverSessionId, emitSessionUpdate, parseJsonEventOutput, runNativeHarness } from "./shared.ts";
import { runVersionCommand } from "./versions.ts";

export const opencodeAdapter: HarnessAdapter = {
  id: "opencode",
  label: "OpenCode",
  detect: detectOpenCode,
  buildLaunch: buildOpenCodeLaunch,
  run: runOpenCode,
  normalizeError: normalizeOpenCodeError,
};

async function detectOpenCode(): Promise<HarnessDetectionResult> {
  const executable = await findExecutableOnPath("opencode");
  if (!executable) {
    return { id: "opencode", label: "OpenCode", status: "missing" };
  }

  return {
    id: "opencode",
    label: "OpenCode",
    status: "available",
    path: executable,
    version: await detectOpenCodeVersion(executable),
  };
}

async function buildOpenCodeLaunch(input: AgentRouterRunRequest): Promise<HarnessLaunchPlan> {
  const executable = await resolveExecutablePath("opencode", input.executablePath);
  if (!executable) {
    throw new Error("OpenCode CLI was not found on PATH.");
  }

  const args = ["run", "--format", "json"];
  if (input.sessionId) {
    args.push("--session", input.sessionId);
  }
  const model = input.model?.trim();
  if (model && model !== "opencode-default") {
    args.push("--model", model);
  }
  args.push(input.prompt);

  const env = buildBaseEnv(
    executable,
    buildCapabilityEnv(input.env ?? {}, input.runtimeToolCapabilities),
    buildCapabilityPathDirs(input.runtimeToolCapabilities),
  );
  const health = inspectOpenCodeProviderHealth({ env, model });
  return {
    executable,
    args,
    cwd: input.cwd,
    env,
    metadata: buildOpenCodePlanMetadata(health),
    timeoutMs: resolveTimeoutMs(input.timeoutMs),
    redactions: buildRedactions(env),
  };
}

async function runOpenCode(
  plan: HarnessLaunchPlan,
  observer: AgentRouterObserver,
  request: AgentRouterRunRequest,
): Promise<AgentRouterRunResult> {
  const preflightDiagnostics = readOpenCodePreflightDiagnostics(plan);
  const brokenPreflight = preflightDiagnostics.find((diagnostic) => diagnostic.severity === "error");
  if (brokenPreflight) {
    const now = new Date().toISOString();
    return {
      status: "failed",
      harness: "opencode",
      events: [],
      diagnostics: [brokenPreflight],
      startedAt: now,
      finishedAt: now,
    };
  }

  const result = await runNativeHarness("opencode", plan, observer, request, {
    emptyMessage: "OpenCode returned an empty response.",
    nonZeroMessage: (exitCode) => `OpenCode exited with code ${exitCode}.`,
    timeoutMessage: (timeoutMs) => `OpenCode timed out after ${timeoutMs}ms.`,
    failureDiagnostics: (processResult) => buildOpenCodeFailureDiagnostics(
      processResult.stderr,
      processResult.stdout,
      processResult.exitCode,
    ),
    parseEvents: (stdout, stderr, runObserver) => {
      const parsed = parseJsonEventOutput(stdout);
      const diagnostics = [...parsed.diagnostics];
      let outputText = "";

      if (parsed.events.length > 0 && outputHasInvalidJsonCandidate(stdout)) {
        diagnostics.push(createDiagnostic("harness.protocol_parse_failed", "OpenCode JSON event output could not be fully parsed.", {
          rawProviderMessage: tailText(stdout),
          stderrTail: tailText(stderr),
        }));
      }

      for (const event of parsed.events) {
        for (const mapped of mapOpenCodeNativeEvent(event)) {
          runObserver.emit(mapped);
        }
        const finalText = extractOpenCodeFinalText(event);
        if (finalText) {
          outputText = appendLine(outputText, finalText);
        }
      }
      diagnostics.push(...buildOpenCodeEventDiagnostics(parsed.events));

      if (!outputText && parsed.events.length === 0 && stdout.trim() && !stdout.trim().startsWith("{")) {
        outputText = stdout.trim();
        diagnostics.push(createDiagnostic("harness.protocol_parse_failed", "OpenCode stdout did not contain JSON events; using plain text fallback.", {
          rawProviderMessage: tailText(stdout),
          stderrTail: tailText(stderr),
        }));
      }

      const sessionId = discoverSessionId(parsed.events, request.sessionId);
      emitSessionUpdate(runObserver, sessionId);
      return { outputText, sessionId, diagnostics };
    },
  });

  return withPreflightDiagnostics(result, preflightDiagnostics);
}

async function detectOpenCodeVersion(executable: string): Promise<string> {
  const version = await runVersionCommand(executable, ["--version"]);
  if (version) {
    return version;
  }
  return runVersionCommand(executable, ["version"]);
}

function normalizeOpenCodeError(error: unknown, context: HarnessErrorContext): AgentRouterDiagnostic {
  if (context.timedOut) {
    return createDiagnostic("harness.timeout", "OpenCode timed out.", { stderrTail: context.stderrTail });
  }

  const message = error instanceof Error ? error.message : String(error);
  const combined = [message, context.stderrTail, context.stdoutTail]
    .filter((part): part is string => Boolean(part))
    .join("\n");
  const providerError = normalizeOpenCodeProviderError(combined);
  if (providerError) {
    return createDiagnostic(
      mapOpenCodeProviderErrorCodeToHarnessCode(providerError.code),
      providerError.message,
      { rawProviderMessage: providerError.rawProviderMessage, stderrTail: context.stderrTail },
    );
  }

  return createDiagnostic("harness.unknown_failure", message, { stderrTail: context.stderrTail });
}

function buildOpenCodePlanMetadata(health: OpenCodeProviderHealth): Record<string, string> {
  const snapshot = buildOpenCodeProviderHealthSnapshot(health);
  return {
    openCodeProviderHealth: JSON.stringify(snapshot),
    openCodeProviderHealthStatus: snapshot.status,
    openCodeProviderHealthReason: snapshot.reason ?? "",
    openCodeModel: health.authSource.model ?? "",
  };
}

function readOpenCodePreflightDiagnostics(plan: HarnessLaunchPlan): AgentRouterDiagnostic[] {
  const raw = plan.metadata?.openCodeProviderHealth;
  if (!raw) {
    return [];
  }
  try {
    const health = JSON.parse(raw) as {
      status?: string;
      reason?: string;
      error?: {
        code?: string;
        message?: string;
        rawProviderMessage?: string;
      };
    };
    if (health.status === "healthy" || health.status === "unknown") {
      return [];
    }

    return [
      createDiagnostic(
        mapOpenCodeProviderErrorCodeToHarnessCode(health.error?.code),
        health.reason || health.error?.message || "OpenCode provider preflight did not pass.",
        {
          severity: health.status === "broken" ? "error" : "warning",
          rawProviderMessage: health.error?.rawProviderMessage,
        },
      ),
    ];
  } catch {
    return [];
  }
}

function withPreflightDiagnostics(
  result: AgentRouterRunResult,
  diagnostics: AgentRouterDiagnostic[],
): AgentRouterRunResult {
  if (diagnostics.length === 0) {
    return result;
  }
  return {
    ...result,
    diagnostics: dedupeOpenCodeDiagnostics([...diagnostics, ...result.diagnostics]),
  };
}

function buildOpenCodeFailureDiagnostics(
  stderr: string,
  stdout: string,
  exitCode: number | null,
): AgentRouterDiagnostic[] {
  const raw = tailText(`${stderr}\n${stdout}`) ?? "";
  const providerError = normalizeOpenCodeProviderError(raw);
  const stderrTail = tailText(stderr);
  if (providerError) {
    return [
      createDiagnostic(
        mapOpenCodeProviderErrorCodeToHarnessCode(providerError.code),
        providerError.message,
        {
          rawProviderMessage: providerError.rawProviderMessage,
          stderrTail,
        },
      ),
    ];
  }

  return [
    createDiagnostic("harness.exited_nonzero", `OpenCode exited with code ${exitCode}.`, {
      rawProviderMessage: raw,
      stderrTail,
    }),
  ];
}

function buildOpenCodeEventDiagnostics(events: Array<Record<string, unknown>>): AgentRouterDiagnostic[] {
  const diagnostics: AgentRouterDiagnostic[] = [];
  for (const event of events) {
    const rawError = extractOpenCodeEventError(event);
    if (!rawError) {
      continue;
    }
    const providerError = normalizeOpenCodeProviderError(rawError);
    if (providerError) {
      diagnostics.push(createDiagnostic(
        mapOpenCodeProviderErrorCodeToHarnessCode(providerError.code),
        providerError.message,
        { rawProviderMessage: providerError.rawProviderMessage },
      ));
      continue;
    }
    diagnostics.push(createDiagnostic(
      "harness.unknown_failure",
      "OpenCode reported an error that could not be classified.",
      { rawProviderMessage: rawError },
    ));
  }
  return dedupeOpenCodeDiagnostics(diagnostics);
}

function extractOpenCodeEventError(event: Record<string, unknown>): string | undefined {
  const error = event.error && typeof event.error === "object"
    ? event.error as Record<string, unknown>
    : undefined;
  if (!error) {
    return undefined;
  }

  const name = readString(error.name);
  const data = error.data && typeof error.data === "object"
    ? error.data as Record<string, unknown>
    : undefined;
  const message = readString(data?.message ?? error.message);
  const code = readString(data?.code ?? error.code);
  const statusCode = data?.statusCode != null ? `status ${String(data.statusCode)}` : "";
  const parts = [name, message, code, statusCode].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function mapOpenCodeProviderErrorCodeToHarnessCode(
  code: OpenCodeProviderError["code"] | string | undefined,
): AgentRouterDiagnostic["code"] {
  if (code === "provider.cli_missing") return "harness.cli_missing";
  if (code === "provider.auth_invalid") return "harness.auth_invalid";
  if (code === "provider.model_unavailable") return "harness.model_unavailable";
  if (code === "provider.session_invalid") return "harness.session_missing";
  if (code === "provider.tool_missing") return "harness.tool_missing";
  if (code === "provider.tool_unauthorized") return "harness.tool_unauthorized";
  if (code === "provider.tool_permission_denied") return "harness.tool_permission_denied";
  if (code === "provider.empty_response") return "harness.empty_response";
  if (code === "provider.protocol_parse_failed") return "harness.protocol_parse_failed";
  if (code === "provider.timeout") return "harness.timeout";
  return "harness.exited_nonzero";
}

function dedupeOpenCodeDiagnostics(diagnostics: AgentRouterDiagnostic[]): AgentRouterDiagnostic[] {
  const result: AgentRouterDiagnostic[] = [];
  const seen = new Set<string>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}:${diagnostic.message}:${diagnostic.rawProviderMessage ?? ""}:${diagnostic.stderrTail ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(diagnostic);
  }
  return result;
}
