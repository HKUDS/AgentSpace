#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import type { AgentRouterEvent, AgentRouterOutputFormat, AgentRouterRunRequest } from "./types.ts";
import {
  detectAgentRouterHarnesses,
  isAgentRouterHarness,
  listAgentRouterHarnesses,
  runAgentRouter,
} from "./router.ts";

export async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    printAgentRouterHelp();
    return 0;
  }

  const [command, ...rest] = args;
  if (command === "harnesses") {
    console.log(JSON.stringify(listAgentRouterHarnesses(), null, 2));
    return 0;
  }

  if (command === "detect") {
    console.log(JSON.stringify(await detectAgentRouterHarnesses(), null, 2));
    return 0;
  }

  if (command === "run") {
    return runCommand(rest);
  }

  console.error(`Unknown agent-router command "${command}".`);
  printAgentRouterHelp();
  return 1;
}

async function runCommand(args: string[]): Promise<number> {
  const parsed = parseAgentRouterRunArgs(args);
  const harness = getStringFlag(parsed.flags, "harness")?.trim();
  const cwd = getStringFlag(parsed.flags, "cwd")?.trim() || process.cwd();
  const prompt = parsed.positionals.join(" ").trim();
  const timeoutRaw = getStringFlag(parsed.flags, "timeout-ms")?.trim();
  const outputFormat: AgentRouterOutputFormat = parsed.flags["json-events"] ? "json-events" : "text";

  if (!harness || !isAgentRouterHarness(harness)) {
    console.error("Usage: agent-router run --harness claude|codex|opencode|openclaw|hermes [--cwd <dir>] [--model <id>] [--mode <mode>] [--session-id <id>] [--timeout-ms <ms>] [--json-events] <prompt>");
    return 1;
  }
  if (!prompt) {
    console.error("agent-router run requires a prompt.");
    return 1;
  }

  const request: AgentRouterRunRequest = {
    version: 1,
    harness,
    prompt,
    cwd,
    model: getStringFlag(parsed.flags, "model")?.trim(),
    mode: getStringFlag(parsed.flags, "mode")?.trim(),
    sessionId: getStringFlag(parsed.flags, "session-id")?.trim(),
    timeoutMs: timeoutRaw ? Number(timeoutRaw) : undefined,
    outputFormat,
  };

  const observer = outputFormat === "json-events"
    ? {
      emit: (event: AgentRouterEvent) => {
        console.log(JSON.stringify(event));
      },
    }
    : { emit: () => {} };

  const result = await runAgentRouter(request, observer);
  if (outputFormat === "json-events") {
    console.log(JSON.stringify({ type: "result", ...result }));
  } else if (result.outputText) {
    console.log(result.outputText);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }

  return result.status === "completed" ? 0 : 1;
}

interface AgentRouterParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseAgentRouterRunArgs(args: string[]): AgentRouterParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const booleanFlags = new Set(["json-events"]);

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    if (booleanFlags.has(key)) {
      flags[key] = true;
      continue;
    }

    const nextValue = args[index + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = nextValue;
    index += 1;
  }

  return { positionals, flags };
}

function getStringFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

export function printAgentRouterHelp(): void {
  console.error(`Usage:
  agent-router harnesses
  agent-router detect
  agent-router run --harness claude|codex|opencode|openclaw|hermes [--cwd <dir>] [--model <id>] [--mode <mode>] [--session-id <id>] [--timeout-ms <ms>] [--json-events] <prompt>

Examples:
  agent-router run --harness claude --cwd /workspace/project "summarize this repo"
  agent-router run --harness codex --cwd /workspace/project --model gpt-5.1 "fix tests"
  agent-router run --harness opencode --cwd /workspace/project --model openrouter/openai/gpt-4.1 "summarize this repo"
  agent-router run --harness openclaw --cwd /workspace/project --mode medium "review this diff"
  agent-router run --harness hermes --cwd /workspace/project "summarize this repo"
  agent-router run --harness claude --json-events "write a plan"`);
}

const isMain = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;

if (isMain) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    });
}
