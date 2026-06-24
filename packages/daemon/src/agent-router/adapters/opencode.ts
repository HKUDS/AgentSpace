import type {
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
import { discoverSessionId, emitSessionUpdate, normalizeAdapterError, parseJsonEventOutput, runNativeHarness } from "./shared.ts";
import { runVersionCommand } from "./versions.ts";

export const opencodeAdapter: HarnessAdapter = {
  id: "opencode",
  label: "OpenCode",
  detect: detectOpenCode,
  buildLaunch: buildOpenCodeLaunch,
  run: runOpenCode,
  normalizeError: (error: unknown, context: HarnessErrorContext) => normalizeAdapterError("opencode", error, context),
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
  return {
    executable,
    args,
    cwd: input.cwd,
    env,
    timeoutMs: resolveTimeoutMs(input.timeoutMs),
    redactions: buildRedactions(env),
  };
}

async function runOpenCode(
  plan: HarnessLaunchPlan,
  observer: AgentRouterObserver,
  request: AgentRouterRunRequest,
): Promise<AgentRouterRunResult> {
  return runNativeHarness("opencode", plan, observer, request, {
    emptyMessage: "OpenCode returned an empty response.",
    nonZeroMessage: (exitCode) => `OpenCode exited with code ${exitCode}.`,
    timeoutMessage: (timeoutMs) => `OpenCode timed out after ${timeoutMs}ms.`,
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
}

async function detectOpenCodeVersion(executable: string): Promise<string> {
  const version = await runVersionCommand(executable, ["--version"]);
  if (version) {
    return version;
  }
  return runVersionCommand(executable, ["version"]);
}
