import { readFileSync } from "node:fs";
import {
  createExternalIntegrationSync,
  readExternalIntegrationSync,
  updateExternalIntegrationHealthSync,
  upsertExternalChannelBindingSync,
  upsertExternalUserBindingSync,
} from "@agent-space/db";
import {
  buildEncryptedSlackCredentials,
  buildSlackHealthSnapshotConfigJson,
  checkSlackIntegrationHealth,
  drainSlackOutboxMessages,
  readSlackIntegrationCredentials,
  SLACK_DEFAULT_SCOPES,
  SLACK_EVENT_CALLBACK_PATH,
  SLACK_PROVIDER_ID,
  startSlackSocketModeWorker,
  summarizeSlackStoredCredentials,
  type SlackSocketModeWorkerMetrics,
} from "@agent-space/services";
import { getNumberFlag, getStringFlag, parseArgs } from "../../lib/args.ts";
import { writeData, type OutputFormat } from "../../lib/format.ts";

type EnvMap = Record<string, string | undefined>;

export async function runSlackIntegrationCommand(args: string[], format: OutputFormat): Promise<number> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printSlackHelp();
    return subcommand ? 0 : 1;
  }

  const parsed = parseArgs(rest);
  if (hasHelpFlag(parsed.flags)) {
    printSlackHelp();
    return 0;
  }

  if (subcommand === "create") {
    const result = createSlackIntegrationForCli(parsed.flags);
    writeData(format, result);
    return 0;
  }
  if (subcommand === "bind-channel") {
    const result = createSlackChannelBindingForCli(parsed.flags);
    writeData(format, result);
    return 0;
  }
  if (subcommand === "bind-user") {
    const result = createSlackUserBindingForCli(parsed.flags);
    writeData(format, result);
    return 0;
  }
  if (subcommand === "health-check") {
    const result = await runSlackHealthCheckForCli(parsed.flags);
    writeData(format, result);
    return result.health.status === "healthy" ? 0 : 1;
  }
  if (subcommand === "worker") {
    const result = await runSlackWorkerForCli(parsed.flags, format);
    return result;
  }
  if (subcommand === "outbox") {
    const [outboxSubcommand] = parsed.positionals;
    if (outboxSubcommand !== "drain") {
      printSlackHelp();
      return 1;
    }
    const result = await drainSlackOutboxForCli(parsed.flags);
    writeData(format, result);
    return result.errors.length > 0 && result.processedCount === 0 ? 1 : 0;
  }

  printSlackHelp();
  return 1;
}

export function createSlackIntegrationForCli(flags: Record<string, string | boolean>): Record<string, unknown> {
  const workspaceId = getStringFlag(flags, "workspace-id") ?? "default";
  const env = readSlackCliEnv(getStringFlag(flags, "env-file"));
  const botTokenEnv = getStringFlag(flags, "bot-token-env") ?? "SLACK_BOT_TOKEN";
  const signingSecretEnv = getStringFlag(flags, "signing-secret-env") ?? "SLACK_SIGNING_SECRET";
  const appLevelTokenEnv = getStringFlag(flags, "app-level-token-env");
  const clientIdEnv = getStringFlag(flags, "client-id-env");
  const clientSecretEnv = getStringFlag(flags, "client-secret-env");
  const botToken = readRequiredEnv(env, botTokenEnv, "slack.create.missing_bot_token");
  const signingSecret = readRequiredEnv(env, signingSecretEnv, "slack.create.missing_signing_secret");
  const appId = requireText(getStringFlag(flags, "app-id"), "slack.create.missing_app_id");
  const teamId = getStringFlag(flags, "team-id") ?? getStringFlag(flags, "tenant-key");
  const transportMode = normalizeTransportMode(getStringFlag(flags, "transport") ?? "http_webhook");

  assertNoPlaceholder(botToken, botTokenEnv);
  assertNoPlaceholder(signingSecret, signingSecretEnv);
  assertNoPlaceholder(appId, "app-id");
  assertNoPlaceholder(teamId, "team-id");

  const integration = createExternalIntegrationSync({
    workspaceId,
    provider: SLACK_PROVIDER_ID,
    displayName: getStringFlag(flags, "name") ?? "Slack",
    transportMode,
    appId,
    tenantKey: teamId,
    encryptedCredentialsJson: buildEncryptedSlackCredentials({
      botToken,
      signingSecret,
      appLevelToken: appLevelTokenEnv ? readOptionalEnv(env, appLevelTokenEnv) : undefined,
      clientId: clientIdEnv ? readOptionalEnv(env, clientIdEnv) : undefined,
      clientSecret: clientSecretEnv ? readOptionalEnv(env, clientSecretEnv) : undefined,
    }),
    configJson: {
      eventCallbackPath: SLACK_EVENT_CALLBACK_PATH,
      capabilities: {
        messageTransport: true,
      },
    },
    capabilitiesJson: {
      messageTransport: true,
    },
    scopesJson: [...SLACK_DEFAULT_SCOPES],
    createdByUserId: getStringFlag(flags, "created-by-user-id"),
  });

  return summarizeSlackIntegrationForCli(integration);
}

export function createSlackChannelBindingForCli(flags: Record<string, string | boolean>): Record<string, unknown> {
  const workspaceId = getStringFlag(flags, "workspace-id") ?? "default";
  const integrationId = requireText(
    getStringFlag(flags, "integration") ?? getStringFlag(flags, "integration-id"),
    "slack.bind_channel.missing_integration",
  );
  const channelName = requireText(getStringFlag(flags, "channel"), "slack.bind_channel.missing_channel");
  const slackChannel = requireText(
    getStringFlag(flags, "slack-channel") ?? getStringFlag(flags, "channel-id"),
    "slack.bind_channel.missing_slack_channel",
  );
  assertActiveSlackIntegration(workspaceId, integrationId);
  const binding = upsertExternalChannelBindingSync({
    workspaceId,
    integrationId,
    channelName,
    externalChatId: slackChannel,
    externalChatType: getStringFlag(flags, "type") ?? inferSlackChannelType(slackChannel),
    externalChatName: getStringFlag(flags, "name"),
    metadataJson: {
      provider: SLACK_PROVIDER_ID,
      provisionSource: "manual",
    },
    createdByUserId: getStringFlag(flags, "created-by-user-id"),
  });
  return {
    ok: true,
    bindingId: binding.id,
    integrationId: binding.integrationId,
    channelName: binding.channelName,
    externalChatReference: buildExternalIdReference("channel", binding.externalChatId),
    status: binding.status,
  };
}

export function createSlackUserBindingForCli(flags: Record<string, string | boolean>): Record<string, unknown> {
  const workspaceId = getStringFlag(flags, "workspace-id") ?? "default";
  const integrationId = requireText(
    getStringFlag(flags, "integration") ?? getStringFlag(flags, "integration-id"),
    "slack.bind_user.missing_integration",
  );
  const userId = requireText(getStringFlag(flags, "user-id"), "slack.bind_user.missing_user_id");
  const slackUser = requireText(
    getStringFlag(flags, "slack-user") ?? getStringFlag(flags, "slack-user-id"),
    "slack.bind_user.missing_slack_user",
  );
  assertActiveSlackIntegration(workspaceId, integrationId);
  const binding = upsertExternalUserBindingSync({
    workspaceId,
    integrationId,
    userId,
    externalUserId: slackUser,
    displayName: getStringFlag(flags, "display-name"),
    metadataJson: {
      provider: SLACK_PROVIDER_ID,
    },
  });
  return {
    ok: true,
    bindingId: binding.id,
    integrationId: binding.integrationId,
    userId: binding.userId,
    externalUserReference: buildExternalIdReference("user", binding.externalUserId),
    status: binding.status,
  };
}

export async function runSlackHealthCheckForCli(flags: Record<string, string | boolean>): Promise<Record<string, unknown> & {
  health: Awaited<ReturnType<typeof checkSlackIntegrationHealth>>;
}> {
  const workspaceId = getStringFlag(flags, "workspace-id") ?? "default";
  const integrationId = requireText(
    getStringFlag(flags, "integration") ?? getStringFlag(flags, "integration-id"),
    "slack.health_check.missing_integration",
  );
  const integration = assertActiveSlackIntegration(workspaceId, integrationId);
  const credentials = readSlackIntegrationCredentials(integration);
  const health = await checkSlackIntegrationHealth({
    botToken: credentials.botToken,
    baseUrl: getStringFlag(flags, "base-url"),
  });
  const updated = updateExternalIntegrationHealthSync({
    workspaceId,
    integrationId: integration.id,
    lastHealthStatus: health.status,
    lastError: health.errorMessage,
    configJson: buildSlackHealthSnapshotConfigJson({
      configJson: integration.configJson,
      health,
    }),
  });
  return {
    ok: health.status === "healthy",
    integrationId: updated.id,
    health,
  };
}

async function drainSlackOutboxForCli(flags: Record<string, string | boolean>) {
  return drainSlackOutboxMessages({
    workspaceId: getStringFlag(flags, "workspace-id") ?? "default",
    integrationId: getStringFlag(flags, "integration") ?? getStringFlag(flags, "integration-id"),
    limit: getNumberFlag(flags, "limit", 50),
    lockedBy: getStringFlag(flags, "locked-by") ?? "agent-space-cli",
    baseUrl: getStringFlag(flags, "base-url"),
  });
}

export async function runSlackWorkerForCli(
  flags: Record<string, string | boolean>,
  format: OutputFormat,
): Promise<number> {
  const workspaceId = getStringFlag(flags, "workspace-id")
    ?? process.env.AGENT_SPACE_WORKSPACE_ID?.trim()
    ?? "default";
  const integrationId = getStringFlag(flags, "integration")
    ?? getStringFlag(flags, "integration-id")
    ?? process.env.AGENT_SPACE_SLACK_INTEGRATION_ID?.trim();
  const limit = getNumberFlag(flags, "limit", 50);
  const lockedBy = getStringFlag(flags, "locked-by")
    ?? process.env.AGENT_SPACE_SLACK_WORKER_ID?.trim()
    ?? "agent-space-slack-worker";
  const baseUrl = getStringFlag(flags, "base-url")
    ?? process.env.AGENT_SPACE_SLACK_API_BASE_URL?.trim();
  const dryRun = flags["dry-run"] === true;
  const includeWebhookIntegrations = flags["include-webhook"] === true;
  const drainOutboxOnly = flags["drain-outbox"] === true || flags.once === true;

  if (drainOutboxOnly) {
    const result = await drainSlackOutboxMessages({
      workspaceId,
      integrationId,
      limit,
      lockedBy,
      baseUrl,
    });
    writeData(format, result);
    return result.errors.length > 0 && result.processedCount === 0 ? 1 : 0;
  }

  const worker = await startSlackSocketModeWorker({
    workspaceId,
    integrationId,
    lockedBy,
    baseUrl,
    dryRun,
    drainOutboxLimit: limit,
    includeWebhookIntegrations,
  });
  writeData(format, worker.summary);
  if (dryRun) {
    return worker.summary.errors.length > 0 ? 1 : 0;
  }
  if (worker.summary.startedCount === 0) {
    worker.close();
    return worker.summary.errors.length > 0 ? 1 : 0;
  }
  await waitForShutdownSignal();
  worker.close();
  writeData(format, {
    ...worker.summary,
    metrics: worker.metrics,
    connectionStatuses: worker.getConnectionStatuses(),
  });
  return getSlackWorkerExitCode(worker.metrics);
}

function summarizeSlackIntegrationForCli(integration: ReturnType<typeof createExternalIntegrationSync>): Record<string, unknown> {
  const credentialSummary = summarizeSlackStoredCredentials(integration);
  return {
    ok: true,
    integrationId: integration.id,
    workspaceId: integration.workspaceId,
    provider: integration.provider,
    displayName: integration.displayName,
    transportMode: integration.transportMode,
    appId: integration.appId,
    teamId: integration.tenantKey,
    eventCallbackPath: SLACK_EVENT_CALLBACK_PATH,
    credentialSummary,
  };
}

function assertActiveSlackIntegration(workspaceId: string, integrationId: string) {
  const integration = readExternalIntegrationSync({ workspaceId, integrationId });
  if (!integration || integration.provider !== SLACK_PROVIDER_ID || integration.status !== "active") {
    throw new Error("slack.integration_not_active");
  }
  return integration;
}

function readSlackCliEnv(envFile: string | undefined): EnvMap {
  return {
    ...process.env,
    ...(envFile ? parseEnvFile(readFileSync(envFile, "utf8")) : {}),
  };
}

function parseEnvFile(contents: string): EnvMap {
  const env: EnvMap = {};
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

function readRequiredEnv(env: EnvMap, name: string, errorCode: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(errorCode);
  }
  assertNoPlaceholder(value, name);
  return value;
}

function readOptionalEnv(env: EnvMap, name: string): string | undefined {
  const value = env[name]?.trim();
  if (!value) {
    return undefined;
  }
  assertNoPlaceholder(value, name);
  return value;
}

function requireText(value: string | undefined, errorCode: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(errorCode);
  }
  return trimmed;
}

function normalizeTransportMode(value: string) {
  if (value === "http_webhook" || value === "websocket_worker") {
    return value;
  }
  throw new Error("slack.create.invalid_transport_mode");
}

function assertNoPlaceholder(value: string | undefined, fieldName: string): void {
  if (!value) {
    return;
  }
  if (/CHANGE_ME|REPLACE_ME|example\.com|xxx/i.test(value)) {
    throw new Error(`slack.placeholder_value:${fieldName}`);
  }
}

function inferSlackChannelType(value: string): string {
  if (value.startsWith("D")) {
    return "im";
  }
  if (value.startsWith("G")) {
    return "group";
  }
  if (value.startsWith("C")) {
    return "channel";
  }
  return "unknown";
}

function buildExternalIdReference(kind: string, value: string): string {
  return `${kind} ${value.slice(0, 4)}...${value.slice(-4)}`;
}

function hasHelpFlag(flags: Record<string, string | boolean>): boolean {
  return flags.help === true || flags.h === true;
}

function getSlackWorkerExitCode(metrics: SlackSocketModeWorkerMetrics): number {
  if (metrics.connectionErrorCount > 0 && metrics.processedCount === 0) {
    return 1;
  }
  if (metrics.failedCount > 0 && metrics.processedCount === 0 && metrics.ignoredCount === 0 && metrics.duplicateCount === 0) {
    return 1;
  }
  return 0;
}

async function waitForShutdownSignal(): Promise<void> {
  await new Promise<void>((resolve) => {
    const cleanup = () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    };
    const onSignal = () => {
      cleanup();
      resolve();
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}

function printSlackHelp(): void {
  console.log(`Usage:
  agent-space integrations slack create --workspace-id <id> --app-id <A...> [--team-id <T...>] [--env-file scripts/slack/.env] [--bot-token-env SLACK_BOT_TOKEN] [--signing-secret-env SLACK_SIGNING_SECRET] [--app-level-token-env SLACK_APP_TOKEN] [--transport http_webhook|websocket_worker] [--json]
  agent-space integrations slack bind-channel --workspace-id <id> --integration <id> --channel <agent-space-channel> --slack-channel <C...|G...|D...> [--type channel|group|im|mpim] [--json]
  agent-space integrations slack bind-user --workspace-id <id> --integration <id> --user-id <agent-space-user-id> --slack-user <U...> [--json]
  agent-space integrations slack worker [--workspace-id <id>] [--integration <id>] [--limit <n>] [--base-url <url>] [--locked-by <id>] [--dry-run] [--include-webhook] [--drain-outbox|--once] [--json]
  agent-space integrations slack health-check --workspace-id <id> --integration <id> [--base-url <url>] [--json]
  agent-space integrations slack outbox drain [--workspace-id <id>] [--integration <id>] [--limit <n>] [--base-url <url>] [--locked-by <id>] [--json]

Options:
  --workspace-id <id>          AgentSpace workspace id; defaults to default
  --app-id <A...>              Slack app id
  --team-id <T...>             Slack team id stored as tenant key
  --bot-token-env <name>       Env var containing xoxb bot token; defaults to SLACK_BOT_TOKEN
  --signing-secret-env <name>  Env var containing Slack signing secret; defaults to SLACK_SIGNING_SECRET
  --app-level-token-env <name> Env var containing xapp app-level token for Socket Mode
  --dry-run                    Validate Socket Mode worker config without opening live connections
  --include-webhook            Include HTTP webhook integrations in worker diagnostics
  --json                       Print machine-readable output`);
}
