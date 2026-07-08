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
  live: boolean;
  ready: boolean;
  liveResult?: SlackSmokeLiveResult;
  summary: {
    required: number;
    passed: number;
    failed: number;
  };
  missingRequired: string[];
  items: SlackSmokeEnvItem[];
  nextCommands: string[];
}

interface SlackSmokeLiveResult {
  attempted: boolean;
  ok: boolean;
  channelReference?: string;
  messageReference?: string;
  retryAfterSeconds?: number;
  errorCode?: string;
  errorMessage?: string;
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
  const output = parsed.flags.live === true
    ? await buildSlackSmokeLiveOutput(env)
    : buildSlackSmokeDryRunOutput(env);
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
      "agent-space integrations slack evidence --workspace-id $AGENT_SPACE_WORKSPACE_ID --integration $AGENT_SPACE_SLACK_INTEGRATION_ID --strict --require message --json",
      "agent-space integrations slack outbox drain --workspace-id $AGENT_SPACE_WORKSPACE_ID --integration $AGENT_SPACE_SLACK_INTEGRATION_ID --json",
    ],
  };
}

export async function buildSlackSmokeLiveOutput(env: Record<string, string | undefined>): Promise<SlackSmokeOutput> {
  const dryRunOutput = buildSlackSmokeDryRunOutput(env);
  const botToken = env.SLACK_BOT_TOKEN?.trim();
  const channelId = env.SLACK_SMOKE_CHANNEL_ID?.trim();
  const messageText = env.SLACK_SMOKE_MESSAGE_TEXT?.trim() || "AgentSpace Slack smoke";
  const threadTs = env.SLACK_SMOKE_THREAD_TS?.trim();
  const missingLive = [
    ...(botToken && !isPlaceholderValue(botToken) ? [] : ["SLACK_BOT_TOKEN"]),
    ...(channelId && !isPlaceholderValue(channelId) ? [] : ["SLACK_SMOKE_CHANNEL_ID"]),
  ];
  const items = [
    ...dryRunOutput.items,
    {
      key: "SLACK_BOT_TOKEN",
      required: true,
      status: missingLive.includes("SLACK_BOT_TOKEN") ? "fail" : "pass",
      note: missingLive.includes("SLACK_BOT_TOKEN") ? "missing_or_placeholder" : "configured",
    } satisfies SlackSmokeEnvItem,
  ];
  if (dryRunOutput.missingRequired.length > 0 || missingLive.length > 0) {
    const missingRequired = [...new Set([...dryRunOutput.missingRequired, ...missingLive])];
    return {
      ...dryRunOutput,
      live: true,
      ready: false,
      liveResult: {
        attempted: false,
        ok: false,
        errorCode: "slack.smoke.live_env_incomplete",
        errorMessage: "Slack live smoke requires a complete env and SLACK_BOT_TOKEN.",
      },
      summary: {
        required: items.length,
        passed: items.filter((item) => item.status === "pass").length,
        failed: missingRequired.length,
      },
      missingRequired,
      items,
    };
  }

  const liveResult = await sendSlackSmokeMessage({
    botToken: botToken ?? "",
    channelId: channelId ?? "",
    text: messageText,
    threadTs,
    baseUrl: env.SLACK_API_BASE_URL?.trim(),
  });
  return {
    ...dryRunOutput,
    live: true,
    ready: liveResult.ok,
    liveResult,
    summary: {
      required: items.length,
      passed: items.filter((item) => item.status === "pass").length,
      failed: liveResult.ok ? 0 : 1,
    },
    missingRequired: liveResult.ok ? [] : dryRunOutput.missingRequired,
    items,
  };
}

async function sendSlackSmokeMessage(input: {
  botToken: string;
  channelId: string;
  text: string;
  threadTs?: string;
  baseUrl?: string;
}): Promise<SlackSmokeLiveResult> {
  try {
    const response = await fetch(`${input.baseUrl || "https://slack.com/api"}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.botToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: input.channelId,
        text: input.text,
        ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
      }),
    });
    const data = await response.json() as Record<string, unknown>;
    const ok = response.ok && data.ok === true;
    const retryAfter = Number(response.headers.get("retry-after"));
    return {
      attempted: true,
      ok,
      channelReference: buildSafeReference("channel", typeof data.channel === "string" ? data.channel : input.channelId),
      messageReference: typeof data.ts === "string" ? buildSafeReference("message", data.ts) : undefined,
      retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
      errorCode: ok ? undefined : normalizeSlackSmokeErrorCode(data.error, response.status),
      errorMessage: ok
        ? undefined
        : sanitizeSlackSmokeMessage(typeof data.error === "string" ? data.error : `Slack chat.postMessage failed with HTTP ${response.status}.`, [input.botToken, input.channelId, input.threadTs]),
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      channelReference: buildSafeReference("channel", input.channelId),
      errorCode: "slack.smoke.network_failed",
      errorMessage: sanitizeSlackSmokeMessage(error instanceof Error ? error.message : String(error), [input.botToken, input.channelId, input.threadTs]),
    };
  }
}

function formatSlackSmokeDryRunOutput(output: SlackSmokeOutput): string {
  const lines = [
    `Slack smoke ${output.live ? "live" : "dry-run"}: ${output.ready ? "ready" : "blocked"}`,
    `Required env: ${output.summary.passed}/${output.summary.required}`,
  ];
  for (const item of output.items) {
    lines.push(`- ${item.key}: ${item.status} (${item.note})`);
  }
  if (output.liveResult) {
    lines.push(`Live send: ${output.liveResult.ok ? "sent" : "failed"}`);
    if (output.liveResult.channelReference) {
      lines.push(`- channel: ${output.liveResult.channelReference}`);
    }
    if (output.liveResult.messageReference) {
      lines.push(`- message: ${output.liveResult.messageReference}`);
    }
    if (output.liveResult.errorCode) {
      lines.push(`- error: ${output.liveResult.errorCode}`);
    }
  }
  lines.push("Next commands:");
  for (const command of output.nextCommands) {
    lines.push(`- ${command}`);
  }
  return lines.join("\n");
}

function readEnv(envFile: string | undefined): Record<string, string | undefined> {
  return {
    ...(envFile ? parseEnvFile(readFileSync(envFile, "utf8")) : {}),
    ...process.env,
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

function normalizeSlackSmokeErrorCode(value: unknown, status: number): string {
  if (status === 429 || value === "ratelimited") {
    return "slack.smoke.rate_limited";
  }
  if (typeof value === "string" && value.trim()) {
    return `slack.smoke.${value.trim().replace(/[^a-z0-9_]+/gi, "_").toLowerCase()}`;
  }
  return "slack.smoke.post_message_failed";
}

function buildSafeReference(kind: string, value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length <= 8) {
    return `${kind} ${normalized.slice(0, 2)}...${normalized.slice(-2)}`;
  }
  return `${kind} ${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

function sanitizeSlackSmokeMessage(
  message: string | undefined,
  sensitiveValues: Array<string | undefined>,
): string | undefined {
  if (!message) {
    return undefined;
  }
  let sanitized = message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(xoxb|xapp)-[A-Za-z0-9-]+/gi, "[redacted]");
  for (const value of sensitiveValues
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item))
    .sort((left, right) => right.length - left.length)) {
    sanitized = sanitized.split(value).join("[redacted]");
  }
  return sanitized.slice(0, 1000);
}

void main();
