import { readFileSync } from "node:fs";

type SmokeStatus = "pass" | "fail";

interface SlackSmokeEnvItem {
  key: string;
  required: boolean;
  status: SmokeStatus;
  note: string;
}

interface SlackSmokeOutput {
  generatedAt: string;
  live: false;
  ready: boolean;
  summary: {
    required: number;
    passed: number;
    failed: number;
  };
  missingRequired: string[];
  items: SlackSmokeEnvItem[];
  nextCommands: string[];
}

interface ParsedArgs {
  flags: Record<string, string | boolean>;
}

const REQUIRED_ENV = [
  "AGENT_SPACE_WORKSPACE_ID",
  "AGENT_SPACE_SLACK_INTEGRATION_ID",
  "AGENT_SPACE_PUBLIC_APP_URL",
  "SLACK_SMOKE_CALLBACK_URL",
  "SLACK_SMOKE_CHANNEL_ID",
  "SLACK_SMOKE_USER_ID",
] as const;

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const env = readEnv(getStringFlag(parsed.flags, "env-file"));
  const output = buildSlackSmokeDryRunOutput(env);
  if (parsed.flags.json === true) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(formatSlackSmokeDryRunOutput(output));
  }
  process.exitCode = output.ready ? 0 : 1;
}

export function buildSlackSmokeDryRunOutput(env: Record<string, string | undefined>): SlackSmokeOutput {
  const items = REQUIRED_ENV.map((key): SlackSmokeEnvItem => {
    const value = env[key]?.trim();
    const ready = Boolean(value) && !isPlaceholderValue(value) && isWellFormedEnvValue(key, value);
    return {
      key,
      required: true,
      status: ready ? "pass" : "fail",
      note: describeSlackSmokeEnvItem(key, value, ready),
    };
  });
  const missingRequired = items
    .filter((item) => item.status === "fail")
    .map((item) => item.key);
  return {
    generatedAt: new Date().toISOString(),
    live: false,
    ready: missingRequired.length === 0,
    summary: {
      required: items.length,
      passed: items.filter((item) => item.status === "pass").length,
      failed: missingRequired.length,
    },
    missingRequired,
    items,
    nextCommands: [
      "agent-space integrations slack health-check --workspace-id $AGENT_SPACE_WORKSPACE_ID --integration $AGENT_SPACE_SLACK_INTEGRATION_ID --json",
      "agent-space integrations slack readiness --workspace-id $AGENT_SPACE_WORKSPACE_ID --integration $AGENT_SPACE_SLACK_INTEGRATION_ID --strict --json",
      "agent-space integrations slack outbox drain --workspace-id $AGENT_SPACE_WORKSPACE_ID --integration $AGENT_SPACE_SLACK_INTEGRATION_ID --json",
    ],
  };
}

function formatSlackSmokeDryRunOutput(output: SlackSmokeOutput): string {
  const lines = [
    `Slack smoke dry-run: ${output.ready ? "ready" : "blocked"}`,
    `Required env: ${output.summary.passed}/${output.summary.required}`,
  ];
  for (const item of output.items) {
    lines.push(`- ${item.key}: ${item.status} (${item.note})`);
  }
  lines.push("Next commands:");
  for (const command of output.nextCommands) {
    lines.push(`- ${command}`);
  }
  return lines.join("\n");
}

function readEnv(envFile: string | undefined): Record<string, string | undefined> {
  return {
    ...process.env,
    ...(envFile ? parseEnvFile(readFileSync(envFile, "utf8")) : {}),
  };
}

function parseEnvFile(contents: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    env[key] = value;
  }
  return env;
}

function parseArgs(args: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return { flags };
}

function getStringFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function describeSlackSmokeEnvItem(key: string, value: string | undefined, ready: boolean): string {
  if (ready) {
    if (key.includes("URL")) {
      return "configured URL";
    }
    return "configured";
  }
  if (!value?.trim()) {
    return "missing";
  }
  if (isPlaceholderValue(value)) {
    return "placeholder";
  }
  return "invalid";
}

function isWellFormedEnvValue(key: string, value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  if (key.includes("URL")) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && (
        key !== "SLACK_SMOKE_CALLBACK_URL" ||
        url.pathname === "/api/integrations/slack/events"
      );
    } catch {
      return false;
    }
  }
  return true;
}

function isPlaceholderValue(value: string | undefined): boolean {
  return /CHANGE_ME|REPLACE_ME|example\.com|xxx/i.test(value ?? "");
}

void main();
