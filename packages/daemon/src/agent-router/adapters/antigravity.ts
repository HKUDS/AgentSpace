import type {
  AgentRouterObserver,
  AgentRouterRunRequest,
  AgentRouterRunResult,
  HarnessAdapter,
  HarnessDetectionResult,
  HarnessErrorContext,
  HarnessLaunchPlan,
} from "../types.ts";
import { buildCapabilityEnv, buildCapabilityPathDirs } from "../capabilities.ts";
import {
  buildBaseEnv,
  buildRedactions,
  findExecutableOnPath,
  resolveExecutablePath,
  resolveTimeoutMs,
} from "../utils.ts";
import { normalizeAdapterError, runNativeHarness } from "./shared.ts";
import { runVersionCommand } from "./versions.ts";

const ANTIGRAVITY_COMMANDS = ["agy", "antigravity"] as const;

export const antigravityAdapter: HarnessAdapter = {
  id: "antigravity",
  label: "Antigravity CLI",
  detect: detectAntigravity,
  buildLaunch: buildAntigravityLaunch,
  run: runAntigravity,
  normalizeError: (error: unknown, context: HarnessErrorContext) => normalizeAdapterError("antigravity", error, context),
};

async function detectAntigravity(): Promise<HarnessDetectionResult> {
  const executable = await findFirstAntigravityExecutable();
  if (!executable) {
    return { id: "antigravity", label: "Antigravity CLI", status: "missing" };
  }

  return {
    id: "antigravity",
    label: "Antigravity CLI",
    status: "available",
    path: executable,
    version: await detectAntigravityVersion(executable),
  };
}

async function buildAntigravityLaunch(input: AgentRouterRunRequest): Promise<HarnessLaunchPlan> {
  const executable = await resolveAntigravityExecutable(input.executablePath);
  if (!executable) {
    throw new Error("Antigravity CLI was not found on PATH.");
  }

  const args: string[] = [];
  const sessionId = input.sessionId?.trim();
  if (sessionId) {
    args.push("--conversation", sessionId);
  }
  args.push("-p", input.prompt, "--cwd", input.cwd);

  const model = input.model?.trim();
  if (model) {
    args.push("--model", model);
  }

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

async function runAntigravity(
  plan: HarnessLaunchPlan,
  observer: AgentRouterObserver,
  request: AgentRouterRunRequest,
): Promise<AgentRouterRunResult> {
  const sessionId = request.sessionId?.trim() || undefined;
  return runNativeHarness("antigravity", plan, observer, request, {
    emptyMessage: "Antigravity CLI returned an empty response.",
    nonZeroMessage: (exitCode) => `Antigravity CLI exited with code ${exitCode}.`,
    timeoutMessage: (timeoutMs) => `Antigravity CLI timed out after ${timeoutMs}ms.`,
    parseEvents: (stdout) => ({ outputText: stdout.trim(), sessionId }),
  });
}

async function findFirstAntigravityExecutable(): Promise<string | null> {
  for (const command of ANTIGRAVITY_COMMANDS) {
    const executable = await findExecutableOnPath(command);
    if (executable) {
      return executable;
    }
  }
  return null;
}

async function resolveAntigravityExecutable(executablePath: string | undefined): Promise<string | null> {
  if (executablePath?.trim()) {
    return resolveExecutablePath("agy", executablePath);
  }
  return findFirstAntigravityExecutable();
}

async function detectAntigravityVersion(executable: string): Promise<string> {
  const version = await runVersionCommand(executable, ["--version"]);
  if (version) {
    return version;
  }
  return runVersionCommand(executable, ["version"]);
}
