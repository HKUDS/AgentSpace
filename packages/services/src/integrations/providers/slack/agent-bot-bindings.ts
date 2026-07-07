import {
  createExternalIntegrationSync,
  listExternalIntegrationsSync,
  readExternalIntegrationByAgentSync,
  readExternalIntegrationSync,
  updateExternalIntegrationStatusSync,
  type ExternalIntegrationRecord,
  type ExternalIntegrationTransportMode,
} from "@agent-space/db";
import {
  SLACK_DEFAULT_SCOPES,
  SLACK_EVENT_CALLBACK_PATH,
  SLACK_PROVIDER_ID,
  SLACK_SOCKET_MODE_SCOPES,
} from "./constants.ts";
import { buildEncryptedSlackCredentials } from "./credentials.ts";

export interface SlackAgentBotBinding extends ExternalIntegrationRecord {
  provider: typeof SLACK_PROVIDER_ID;
  agentId: string;
  appId: string;
}

export interface CreateSlackAgentBotBindingInput {
  workspaceId: string;
  agentId: string;
  displayName?: string;
  appId: string;
  botToken: string;
  signingSecret: string;
  transportMode?: ExternalIntegrationTransportMode;
  teamId?: string;
  appLevelToken?: string;
  clientId?: string;
  clientSecret?: string;
  createdByUserId?: string;
}

export interface DisableSlackAgentBotBindingInput {
  workspaceId: string;
  integrationId?: string;
  agentId?: string;
  updatedByUserId?: string;
}

export function createSlackAgentBotBindingSync(
  input: CreateSlackAgentBotBindingInput,
): SlackAgentBotBinding {
  const workspaceId = requireText(input.workspaceId, "slack.agent_bot_binding.missing_workspace_id");
  const agentId = requireText(input.agentId, "slack.agent_bot_binding.missing_agent_id");
  const appId = requireText(input.appId, "slack.agent_bot_binding.missing_app_id");
  const botToken = requireText(input.botToken, "slack.agent_bot_binding.missing_bot_token");
  const signingSecret = requireText(input.signingSecret, "slack.agent_bot_binding.missing_signing_secret");
  const transportMode = input.transportMode ?? "websocket_worker";
  const appLevelToken = optionalText(input.appLevelToken);
  validateTransportMode(transportMode);
  if (transportMode === "websocket_worker" && !appLevelToken) {
    throw new Error("slack.agent_bot_binding.missing_app_level_token");
  }
  assertNoPlaceholder(agentId, "agentId");
  assertNoPlaceholder(appId, "appId");
  assertNoPlaceholder(botToken, "botToken");
  assertNoPlaceholder(signingSecret, "signingSecret");
  assertNoPlaceholder(input.teamId, "teamId");
  assertNoPlaceholder(appLevelToken, "appLevelToken");
  assertNoPlaceholder(input.clientId, "clientId");
  assertNoPlaceholder(input.clientSecret, "clientSecret");

  try {
    const integration = createExternalIntegrationSync({
      workspaceId,
      provider: SLACK_PROVIDER_ID,
      displayName: optionalText(input.displayName) ?? `${agentId} Slack Bot`,
      transportMode,
      agentId,
      appId,
      tenantKey: optionalText(input.teamId),
      encryptedCredentialsJson: buildEncryptedSlackCredentials({
        botToken,
        signingSecret,
        appLevelToken,
        clientId: optionalText(input.clientId),
        clientSecret: optionalText(input.clientSecret),
      }),
      configJson: {
        eventCallbackPath: SLACK_EVENT_CALLBACK_PATH,
        agentBotBinding: true,
        capabilities: {
          messageTransport: true,
          socketMode: transportMode === "websocket_worker",
          agentView: false,
        },
      },
      capabilitiesJson: {
        messageTransport: true,
      },
      scopesJson: [
        ...SLACK_DEFAULT_SCOPES,
        ...(transportMode === "websocket_worker" || appLevelToken ? SLACK_SOCKET_MODE_SCOPES : []),
      ],
      createdByUserId: optionalText(input.createdByUserId),
    });
    return requireSlackAgentBotBinding(integration);
  } catch (error) {
    throw normalizeSlackAgentBotBindingError(error);
  }
}

export function listSlackAgentBotBindingsSync(input: {
  workspaceId: string;
  agentId?: string;
  includeDisabled?: boolean;
}): SlackAgentBotBinding[] {
  return listExternalIntegrationsSync({
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
    scope: "agent",
    agentId: optionalText(input.agentId),
    includeDisabled: input.includeDisabled,
  }).filter(isSlackAgentBotBinding);
}

export function readSlackAgentBotBindingByAgentSync(input: {
  workspaceId: string;
  agentId: string;
  includeDisabled?: boolean;
}): SlackAgentBotBinding | null {
  const record = readExternalIntegrationByAgentSync({
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
    agentId: input.agentId,
    includeDisabled: input.includeDisabled,
  });
  return isSlackAgentBotBinding(record) ? record : null;
}

export function disableSlackAgentBotBindingSync(
  input: DisableSlackAgentBotBindingInput,
): SlackAgentBotBinding {
  const binding = resolveSlackAgentBotBindingSync(input);
  const updated = updateExternalIntegrationStatusSync({
    workspaceId: input.workspaceId,
    integrationId: binding.id,
    status: "disabled",
    updatedByUserId: optionalText(input.updatedByUserId),
  });
  return requireSlackAgentBotBinding(updated);
}

export function resolveSlackAgentBotBindingSync(input: {
  workspaceId: string;
  integrationId?: string;
  agentId?: string;
  includeDisabled?: boolean;
}): SlackAgentBotBinding {
  const workspaceId = requireText(input.workspaceId, "slack.agent_bot_binding.missing_workspace_id");
  const integrationId = optionalText(input.integrationId);
  const agentId = optionalText(input.agentId);
  const record = integrationId
    ? readExternalIntegrationSync({ workspaceId, integrationId })
    : agentId
      ? readExternalIntegrationByAgentSync({
        workspaceId,
        provider: SLACK_PROVIDER_ID,
        agentId,
        includeDisabled: input.includeDisabled,
      })
      : null;
  if (!record || (record.status === "disabled" && !input.includeDisabled)) {
    throw new Error("slack.agent_bot_binding.not_found");
  }
  return requireSlackAgentBotBinding(record);
}

export function isSlackAgentBotBinding(
  record: ExternalIntegrationRecord | null | undefined,
): record is SlackAgentBotBinding {
  return Boolean(
    record
      && record.provider === SLACK_PROVIDER_ID
      && optionalText(record.agentId)
      && optionalText(record.appId),
  );
}

function requireSlackAgentBotBinding(record: ExternalIntegrationRecord | null | undefined): SlackAgentBotBinding {
  if (!isSlackAgentBotBinding(record)) {
    throw new Error("slack.agent_bot_binding.not_found");
  }
  return record;
}

function validateTransportMode(value: ExternalIntegrationTransportMode): void {
  if (value !== "http_webhook" && value !== "websocket_worker") {
    throw new Error("slack.agent_bot_binding.invalid_transport_mode");
  }
}

function normalizeSlackAgentBotBindingError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/app and tenant are already connected/.test(message)) {
    return new Error("slack.agent_bot_binding.duplicate_app_team");
  }
  if (/agent is already connected/.test(message)) {
    return new Error("slack.agent_bot_binding.duplicate_agent");
  }
  if (/AGENT_SPACE_SLACK_CREDENTIAL_ENCRYPTION_KEY is required/.test(message)) {
    return new Error("slack.agent_bot_binding.credential_encryption_key_missing");
  }
  if (/AGENT_SPACE_SLACK_CREDENTIAL_ENCRYPTION_KEY must be/.test(message)) {
    return new Error("slack.agent_bot_binding.credential_encryption_key_invalid");
  }
  return error instanceof Error ? error : new Error(message);
}

function requireText(value: string | undefined, errorCode: string): string {
  const normalized = optionalText(value);
  if (!normalized) {
    throw new Error(errorCode);
  }
  return normalized;
}

function optionalText(value: string | undefined | null): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assertNoPlaceholder(value: string | undefined | null, fieldName: string): void {
  if (!value) {
    return;
  }
  const normalized = value.trim();
  const tokenized = normalized.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (
    /^change_me/i.test(normalized)
    || /^replace_me/i.test(normalized)
    || /^your[_\s-]/i.test(normalized)
    || /^<.+>$/.test(normalized)
    || /^\{.+\}$/.test(normalized)
    || tokenized === "xxx"
    || tokenized === "todo"
    || tokenized === "placeholder"
    || /(^|_)(todo|placeholder|example)($|_)/.test(tokenized)
  ) {
    throw new Error(`slack.agent_bot_binding.placeholder_value:${fieldName}`);
  }
}
