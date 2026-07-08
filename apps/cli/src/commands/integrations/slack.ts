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
  buildSlackEvidenceReport,
  buildSlackHealthSnapshotConfigJson,
  buildSlackReadinessReport,
  buildSlackSmokeEnvTemplateReport,
  buildSlackSmokePlanReport,
  checkSlackIntegrationHealth,
  createSlackAgentBotBindingSync,
  disableSlackAgentBotBindingSync,
  drainSlackOutboxMessages,
  readSlackIntegrationCredentials,
  SLACK_DEFAULT_SCOPES,
  SLACK_EVENT_CALLBACK_PATH,
  SLACK_INTERACTION_CALLBACK_PATH,
  SLACK_PROVIDER_ID,
  SLACK_SOCKET_MODE_SCOPES,
  startSlackSocketModeWorker,
  summarizeSlackStoredCredentials,
  type SlackAgentBotBinding,
  type SlackEvidenceRequirement,
  type SlackReadinessRequirement,
  type SlackSocketModeWorkerMetrics,
} from "@agent-space/services";
import { getNumberFlag, getStringFlag, parseArgs } from "../../lib/args.ts";
import { writeData, type OutputFormat } from "../../lib/format.ts";

type EnvMap = Record<string, string | undefined>;

interface SlackIntegrationCommandDependencies {
  createIntegration?: typeof createSlackIntegrationForCli;
  createChannelBinding?: typeof createSlackChannelBindingForCli;
  createUserBinding?: typeof createSlackUserBindingForCli;
  createAgentBotBinding?: typeof createSlackAgentBotBindingForCli;
  disableAgentBot?: typeof disableSlackAgentBotForCli;
  runHealthCheck?: typeof runSlackHealthCheckForCli;
  buildReadinessReport?: typeof buildSlackReadinessReport;
  buildEvidenceReport?: typeof buildSlackEvidenceReport;
  buildSmokePlanReport?: typeof buildSlackSmokePlanReport;
  buildSmokeEnvTemplateReport?: typeof buildSlackSmokeEnvTemplateReport;
  runWorker?: typeof runSlackWorkerForCli;
  drainOutbox?: typeof drainSlackOutboxForCli;
}

export async function runSlackIntegrationCommand(
  args: string[],
  format: OutputFormat,
  deps: SlackIntegrationCommandDependencies = {},
): Promise<number> {
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
    const result = (deps.createIntegration ?? createSlackIntegrationForCli)(parsed.flags);
    writeData(format, result);
    return 0;
  }
  if (subcommand === "bind-channel") {
    const result = (deps.createChannelBinding ?? createSlackChannelBindingForCli)(parsed.flags);
    writeData(format, result);
    return 0;
  }
  if (subcommand === "bind-user") {
    const result = (deps.createUserBinding ?? createSlackUserBindingForCli)(parsed.flags);
    writeData(format, result);
    return 0;
  }
  if (subcommand === "bind-agent-bot") {
    const result = (deps.createAgentBotBinding ?? createSlackAgentBotBindingForCli)(parsed.flags);
    writeData(format, result);
    return 0;
  }
  if (subcommand === "disable-agent-bot") {
    const result = (deps.disableAgentBot ?? disableSlackAgentBotForCli)(parsed.flags);
    writeData(format, result);
    return 0;
  }
  if (subcommand === "health-check") {
    const result = await (deps.runHealthCheck ?? runSlackHealthCheckForCli)(parsed.flags);
    writeData(format, result);
    return result.health.status === "healthy" ? 0 : 1;
  }
  if (subcommand === "readiness") {
    const buildReadinessReport = deps.buildReadinessReport ?? buildSlackReadinessReport;
    const result = buildReadinessReport({
      workspaceId: getStringFlag(parsed.flags, "workspace-id") ?? "default",
      integrationId: getStringFlag(parsed.flags, "integration") ?? getStringFlag(parsed.flags, "integration-id"),
      strict: parsed.flags.strict === true,
      required: readSlackReadinessRequirement(parsed.flags),
    });
    writeData(format, result);
    return result.strict && !result.strictSatisfied ? 1 : 0;
  }
  if (subcommand === "evidence") {
    const buildEvidenceReport = deps.buildEvidenceReport ?? buildSlackEvidenceReport;
    const result = buildEvidenceReport({
      workspaceId: getStringFlag(parsed.flags, "workspace-id") ?? "default",
      integrationId: getStringFlag(parsed.flags, "integration") ?? getStringFlag(parsed.flags, "integration-id"),
      strict: parsed.flags.strict === true,
      required: readSlackEvidenceRequirement(parsed.flags),
    });
    writeData(format, result);
    return result.strict && !result.strictSatisfied ? 1 : 0;
  }
  if (subcommand === "smoke-plan") {
    const buildSmokePlanReport = deps.buildSmokePlanReport ?? buildSlackSmokePlanReport;
    const result = buildSmokePlanReport({
      workspaceId: getStringFlag(parsed.flags, "workspace-id") ?? "default",
      integrationId: getStringFlag(parsed.flags, "integration") ?? getStringFlag(parsed.flags, "integration-id"),
      appUrl: getStringFlag(parsed.flags, "app-url") ?? process.env.AGENT_SPACE_APP_URL ?? process.env.NEXT_PUBLIC_AGENT_SPACE_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL,
      strict: parsed.flags.strict === true,
      required: readSlackReadinessRequirement(parsed.flags),
    });
    writeData(format, result);
    return result.strict && !result.readiness.strictSatisfied ? 1 : 0;
  }
  if (subcommand === "smoke-env") {
    const buildSmokeEnvTemplateReport = deps.buildSmokeEnvTemplateReport ?? buildSlackSmokeEnvTemplateReport;
    const result = buildSmokeEnvTemplateReport({
      workspaceId: getStringFlag(parsed.flags, "workspace-id") ?? "default",
      integrationId: getStringFlag(parsed.flags, "integration") ?? getStringFlag(parsed.flags, "integration-id"),
      appUrl: getStringFlag(parsed.flags, "app-url") ?? process.env.AGENT_SPACE_APP_URL ?? process.env.NEXT_PUBLIC_AGENT_SPACE_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL,
    });
    if (format === "json") {
      writeData(format, result);
    } else if (result.ready) {
      console.log(result.template);
    } else {
      writeData(format, {
        ok: false,
        missing: result.missing.join(","),
        nextCommands: result.nextCommands.join(" ; "),
      });
    }
    return result.ready ? 0 : 1;
  }
  if (subcommand === "worker") {
    const result = await (deps.runWorker ?? runSlackWorkerForCli)(parsed.flags, format);
    return result;
  }
  if (subcommand === "outbox") {
    const [outboxSubcommand] = parsed.positionals;
    if (outboxSubcommand !== "drain") {
      printSlackHelp();
      return 1;
    }
    const result = await (deps.drainOutbox ?? drainSlackOutboxForCli)(parsed.flags);
    writeData(format, result);
    return result.errors.length > 0 && result.processedCount === 0 ? 1 : 0;
  }

  printSlackHelp();
  return 1;
}

export function createSlackIntegrationForCli(
  flags: Record<string, string | boolean>,
  deps: {
    createIntegration?: typeof createExternalIntegrationSync;
    encryptCredentials?: typeof buildEncryptedSlackCredentials;
  } = {},
): Record<string, unknown> {
  const createIntegration = deps.createIntegration ?? createExternalIntegrationSync;
  const encryptCredentials = deps.encryptCredentials ?? buildEncryptedSlackCredentials;
  const workspaceId = getStringFlag(flags, "workspace-id") ?? "default";
  const env = readSlackCliEnv(getStringFlag(flags, "env-file"));
  const botTokenEnv = getStringFlag(flags, "bot-token-env") ?? "SLACK_BOT_TOKEN";
  const signingSecretEnv = getStringFlag(flags, "signing-secret-env") ?? "SLACK_SIGNING_SECRET";
  const appLevelTokenEnv = getStringFlag(flags, "app-level-token-env");
  const clientIdEnv = getStringFlag(flags, "client-id-env");
  const clientSecretEnv = getStringFlag(flags, "client-secret-env");
  const botToken = readRequiredEnv(env, botTokenEnv, "slack.create.missing_bot_token");
  const signingSecret = readRequiredEnv(env, signingSecretEnv, "slack.create.missing_signing_secret");
  const appLevelToken = appLevelTokenEnv ? readOptionalEnv(env, appLevelTokenEnv) : undefined;
  const clientId = clientIdEnv ? readOptionalEnv(env, clientIdEnv) : undefined;
  const clientSecret = clientSecretEnv ? readOptionalEnv(env, clientSecretEnv) : undefined;
  const appId = requireText(getStringFlag(flags, "app-id"), "slack.create.missing_app_id");
  const teamId = getStringFlag(flags, "team-id") ?? getStringFlag(flags, "tenant-key");
  const transportMode = normalizeTransportMode(getStringFlag(flags, "transport") ?? "http_webhook");
  if (transportMode === "websocket_worker" && !appLevelToken) {
    throw new Error("slack.create.missing_app_level_token");
  }

  assertNoPlaceholder(botToken, botTokenEnv);
  assertNoPlaceholder(signingSecret, signingSecretEnv);
  assertNoPlaceholder(appLevelToken, appLevelTokenEnv ?? "app-level-token");
  assertNoPlaceholder(appId, "app-id");
  assertNoPlaceholder(teamId, "team-id");

  const integration = createIntegration({
    workspaceId,
    provider: SLACK_PROVIDER_ID,
    displayName: getStringFlag(flags, "name") ?? "Slack",
    transportMode,
    appId,
    tenantKey: teamId,
    encryptedCredentialsJson: encryptCredentials({
      botToken,
      signingSecret,
      appLevelToken,
      clientId,
      clientSecret,
    }),
    configJson: {
      eventCallbackPath: SLACK_EVENT_CALLBACK_PATH,
      interactionCallbackPath: SLACK_INTERACTION_CALLBACK_PATH,
      capabilities: {
        messageTransport: true,
      },
    },
      capabilitiesJson: {
        messageTransport: true,
      },
    scopesJson: [
      ...SLACK_DEFAULT_SCOPES,
      ...(transportMode === "websocket_worker" || appLevelToken ? SLACK_SOCKET_MODE_SCOPES : []),
    ],
    createdByUserId: getStringFlag(flags, "created-by-user-id"),
  });

  return summarizeSlackIntegrationForCli(integration);
}

export function createSlackChannelBindingForCli(
  flags: Record<string, string | boolean>,
  deps: {
    readIntegration?: typeof readExternalIntegrationSync;
    upsertChannelBinding?: typeof upsertExternalChannelBindingSync;
  } = {},
): Record<string, unknown> {
  const readIntegration = deps.readIntegration ?? readExternalIntegrationSync;
  const upsertChannelBinding = deps.upsertChannelBinding ?? upsertExternalChannelBindingSync;
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
  assertActiveSlackIntegration(workspaceId, integrationId, readIntegration);
  const binding = upsertChannelBinding({
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

export function createSlackUserBindingForCli(
  flags: Record<string, string | boolean>,
  deps: {
    readIntegration?: typeof readExternalIntegrationSync;
    upsertUserBinding?: typeof upsertExternalUserBindingSync;
  } = {},
): Record<string, unknown> {
  const readIntegration = deps.readIntegration ?? readExternalIntegrationSync;
  const upsertUserBinding = deps.upsertUserBinding ?? upsertExternalUserBindingSync;
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
  assertActiveSlackIntegration(workspaceId, integrationId, readIntegration);
  const binding = upsertUserBinding({
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

export function createSlackAgentBotBindingForCli(
  flags: Record<string, string | boolean>,
  deps: {
    createBinding?: typeof createSlackAgentBotBindingSync;
  } = {},
): Record<string, unknown> {
  const createBinding = deps.createBinding ?? createSlackAgentBotBindingSync;
  const workspaceId = getStringFlag(flags, "workspace-id") ?? "default";
  const env = readSlackCliEnv(getStringFlag(flags, "env-file"));
  const botTokenEnv = getStringFlag(flags, "bot-token-env") ?? "SLACK_BOT_TOKEN";
  const signingSecretEnv = getStringFlag(flags, "signing-secret-env") ?? "SLACK_SIGNING_SECRET";
  const appLevelTokenEnv = getStringFlag(flags, "app-level-token-env") ?? "SLACK_APP_TOKEN";
  const clientIdEnv = getStringFlag(flags, "client-id-env");
  const clientSecretEnv = getStringFlag(flags, "client-secret-env");
  const transportMode = normalizeTransportMode(getStringFlag(flags, "transport") ?? "websocket_worker");
  const appLevelToken = readOptionalEnv(env, appLevelTokenEnv);
  const binding = createBinding({
    workspaceId,
    agentId: requireText(
      getStringFlag(flags, "agent") ?? getStringFlag(flags, "agent-id") ?? getStringFlag(flags, "agent-name"),
      "slack.agent_bot_binding.missing_agent_id",
    ),
    displayName: getStringFlag(flags, "name"),
    transportMode,
    appId: readFlagOrEnv({
      flags,
      env,
      flagName: "app-id",
      envFlagName: "app-id-env",
      defaultEnvName: "SLACK_APP_ID",
      errorCode: "slack.agent_bot_binding.missing_app_id",
    }),
    teamId: getStringFlag(flags, "team-id") ?? getStringFlag(flags, "tenant-key"),
    botToken: readRequiredEnv(env, botTokenEnv, "slack.agent_bot_binding.missing_bot_token"),
    signingSecret: readRequiredEnv(env, signingSecretEnv, "slack.agent_bot_binding.missing_signing_secret"),
    appLevelToken,
    clientId: clientIdEnv ? readOptionalEnv(env, clientIdEnv) : undefined,
    clientSecret: clientSecretEnv ? readOptionalEnv(env, clientSecretEnv) : undefined,
    createdByUserId: getStringFlag(flags, "created-by-user-id"),
  });
  return summarizeSlackAgentBotBindingForCli("created", binding);
}

export function disableSlackAgentBotForCli(
  flags: Record<string, string | boolean>,
  deps: {
    disableBinding?: typeof disableSlackAgentBotBindingSync;
  } = {},
): Record<string, unknown> {
  const disableBinding = deps.disableBinding ?? disableSlackAgentBotBindingSync;
  const workspaceId = getStringFlag(flags, "workspace-id") ?? "default";
  const binding = disableBinding({
    workspaceId,
    integrationId: getStringFlag(flags, "integration") ?? getStringFlag(flags, "integration-id"),
    agentId: getStringFlag(flags, "agent") ?? getStringFlag(flags, "agent-id") ?? getStringFlag(flags, "agent-name"),
    updatedByUserId: getStringFlag(flags, "updated-by-user-id") ?? getStringFlag(flags, "created-by-user-id"),
  });
  return summarizeSlackAgentBotBindingForCli("disabled", binding);
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
    appLevelToken: credentials.appLevelToken,
    transportMode: integration.transportMode,
    expectedAppId: integration.appId,
    expectedTeamId: integration.tenantKey,
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
  deps: {
    drainOutboxMessages?: typeof drainSlackOutboxMessages;
    startWorker?: typeof startSlackSocketModeWorker;
  } = {},
): Promise<number> {
  const drainOutbox = deps.drainOutboxMessages ?? drainSlackOutboxMessages;
  const startWorker = deps.startWorker ?? startSlackSocketModeWorker;
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
  const feishuBaseUrl = getStringFlag(flags, "feishu-base-url")
    ?? process.env.AGENT_SPACE_FEISHU_API_BASE_URL?.trim();
  const dryRun = flags["dry-run"] === true;
  const includeWebhookIntegrations = flags["include-webhook"] === true;
  const drainOutboxOnly = flags["drain-outbox"] === true || flags.once === true;

  if (drainOutboxOnly) {
    const result = await drainOutbox({
      workspaceId,
      integrationId,
      limit,
      lockedBy,
      baseUrl,
    });
    writeData(format, result);
    return result.errors.length > 0 && result.processedCount === 0 ? 1 : 0;
  }

  const worker = await startWorker({
    workspaceId,
    integrationId,
    lockedBy,
    baseUrl,
    feishuBaseUrl,
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
    agentId: integration.agentId,
    appId: integration.appId,
    teamId: integration.tenantKey,
    eventCallbackPath: SLACK_EVENT_CALLBACK_PATH,
    interactionCallbackPath: SLACK_INTERACTION_CALLBACK_PATH,
    credentialSummary,
    secretRedacted: true,
  };
}

function summarizeSlackAgentBotBindingForCli(action: "created" | "disabled", integration: SlackAgentBotBinding): Record<string, unknown> {
  const flags = `--workspace-id ${integration.workspaceId} --integration ${integration.id}`;
  return {
    ...summarizeSlackIntegrationForCli(integration),
    action,
    agentId: integration.agentId,
    agentBotBinding: true,
    secretRedacted: true,
    nextCommands: {
      healthCheck: `agent-space integrations slack health-check ${flags} --json`,
      workerDryRun: `agent-space integrations slack worker --workspace-id ${integration.workspaceId} --integration ${integration.id} --dry-run --json`,
      bindChannel: `agent-space integrations slack bind-channel ${flags} --channel CHANGE_ME_AGENTSPACE_CHANNEL --slack-channel CHANGE_ME_SLACK_CHANNEL_ID --json`,
      bindUser: `agent-space integrations slack bind-user ${flags} --user-id CHANGE_ME_AGENTSPACE_USER_ID --slack-user CHANGE_ME_SLACK_USER_ID --json`,
      smokePlan: `agent-space integrations slack smoke-plan ${flags} --app-url https://agentspace.example.com`,
    },
  };
}

function assertActiveSlackIntegration(
  workspaceId: string,
  integrationId: string,
  readIntegration: typeof readExternalIntegrationSync = readExternalIntegrationSync,
) {
  const integration = readIntegration({ workspaceId, integrationId });
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

function readFlagOrEnv(input: {
  flags: Record<string, string | boolean>;
  env: EnvMap;
  flagName: string;
  envFlagName: string;
  defaultEnvName: string;
  errorCode: string;
}): string {
  const flaggedValue = getStringFlag(input.flags, input.flagName)?.trim();
  if (flaggedValue) {
    assertNoPlaceholder(flaggedValue, input.flagName);
    return flaggedValue;
  }
  const envName = getStringFlag(input.flags, input.envFlagName) ?? input.defaultEnvName;
  return readRequiredEnv(input.env, envName, input.errorCode);
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

function readSlackReadinessRequirement(flags: Record<string, string | boolean>): SlackReadinessRequirement {
  const value = getStringFlag(flags, "require") ?? "message";
  if (value === "message" || value === "worker" || value === "all") {
    return value;
  }
  throw new Error("slack.readiness.invalid_requirement");
}

function readSlackEvidenceRequirement(flags: Record<string, string | boolean>): SlackEvidenceRequirement {
  const value = getStringFlag(flags, "require") ?? "message";
  if (value === "message" || value === "native" || value === "approval" || value === "files" || value === "all") {
    return value;
  }
  throw new Error("slack.evidence.invalid_requirement");
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
  agent-space integrations slack bind-agent-bot --workspace-id <id> --agent <agent-id-or-name> [--app-id <A...>|--app-id-env SLACK_APP_ID] [--team-id <T...>] [--env-file scripts/slack/.env] [--bot-token-env SLACK_BOT_TOKEN] [--signing-secret-env SLACK_SIGNING_SECRET] [--app-level-token-env SLACK_APP_TOKEN] [--transport websocket_worker|http_webhook] [--json]
  agent-space integrations slack disable-agent-bot --workspace-id <id> (--agent <agent-id-or-name>|--integration <id>) [--json]
  agent-space integrations slack bind-channel --workspace-id <id> --integration <id> --channel <agent-space-channel> --slack-channel <C...|G...|D...> [--type channel|group|im|mpim] [--json]
  agent-space integrations slack bind-user --workspace-id <id> --integration <id> --user-id <agent-space-user-id> --slack-user <U...> [--json]
  agent-space integrations slack worker [--workspace-id <id>] [--integration <id>] [--limit <n>] [--base-url <url>] [--feishu-base-url <url>] [--locked-by <id>] [--dry-run] [--include-webhook] [--drain-outbox|--once] [--json]
  agent-space integrations slack health-check --workspace-id <id> --integration <id> [--base-url <url>] [--json]
  agent-space integrations slack readiness [--workspace-id <id>] [--integration <id>] [--strict] [--require message|worker|all] [--json]
  agent-space integrations slack evidence [--workspace-id <id>] [--integration <id>] [--strict] [--require message|native|approval|files|all] [--json]
  agent-space integrations slack smoke-plan [--workspace-id <id>] [--integration <id>] [--app-url <url>] [--strict] [--require message|worker|all] [--json]
  agent-space integrations slack smoke-env [--workspace-id <id>] [--integration <id>] [--app-url <url>] [--json]
  agent-space integrations slack outbox drain [--workspace-id <id>] [--integration <id>] [--limit <n>] [--base-url <url>] [--locked-by <id>] [--json]

Options:
  --workspace-id <id>          AgentSpace workspace id; defaults to default
  --app-id <A...>              Slack app id
  --team-id <T...>             Slack team id stored as tenant key
  --agent <agent-id-or-name>   AgentSpace agent id/name for an agent-scoped Slack bot
  --bot-token-env <name>       Env var containing xoxb bot token; defaults to SLACK_BOT_TOKEN
  --signing-secret-env <name>  Env var containing Slack signing secret; defaults to SLACK_SIGNING_SECRET
  --app-level-token-env <name> Env var containing xapp app-level token for Socket Mode
  --app-url <url>              Public AgentSpace URL used to build Slack callback smoke env
  --feishu-base-url <url>      Feishu OpenAPI base URL for Slack approval execution; defaults to AGENT_SPACE_FEISHU_API_BASE_URL
  --require message|worker|all Readiness/smoke gate to enforce; defaults to message
  --require message|native|approval|files|all Evidence gate to enforce for the evidence command
  --strict                     Exit non-zero unless the requested gate is satisfied
  --dry-run                    Validate Socket Mode worker config without opening live connections
  --include-webhook            Include HTTP webhook integrations in worker diagnostics
  --json                       Print machine-readable output`);
}
