import {
  listExternalChannelBindingsSync,
  listExternalIntegrationEventsSync,
  listExternalIntegrationsSync,
  listExternalMessageOutboxSync,
  listExternalUserBindingsSync,
  listStoredChannelsSync,
  listWorkspaceMemberUsersSync,
  type WorkspaceRole,
} from "@agent-space/db";
import {
  buildSlackReference,
  SLACK_DEFAULT_SCOPES,
  SLACK_EVENT_CALLBACK_PATH,
  SLACK_PROVIDER_ID,
  SLACK_REQUIRED_CREDENTIAL_FIELDS,
  SLACK_REQUIRED_EVENTS,
  SLACK_SOCKET_MODE_CREDENTIAL_FIELDS,
  SLACK_SOCKET_MODE_SCOPES,
  summarizeSlackStoredCredentials,
} from "@agent-space/services";
import { buildPublicAppUrl } from "@/features/auth/public-app-url";
import { hasWorkspaceRole } from "@/features/auth/workspace-permissions";
import type {
  SlackAvailableChannelItem,
  SlackAvailableUserItem,
  SlackChannelBindingSettingsItem,
  SlackInboundBindingSuggestion,
  SlackIntegrationCreationGuide,
  SlackIntegrationEventSettingsItem,
  SlackIntegrationSettingsItem,
  SlackIntegrationSetupCheck,
  SlackIntegrationSetupGuide,
  SlackOutboxSettingsItem,
  SlackUserBindingSettingsItem,
} from "./slack-types";

const SLACK_DEVELOPER_CONSOLE_URL = "https://api.slack.com/apps";
const SLACK_CHANNEL_ID_PLACEHOLDER = "CHANGE_ME_SLACK_CHANNEL_ID";
const SLACK_USER_ID_PLACEHOLDER = "CHANGE_ME_SLACK_USER_ID";

export function listSlackIntegrationSettingsItems(input: {
  workspaceId: string;
  appUrl?: string;
  viewer?: {
    role: WorkspaceRole;
    userId: string;
  };
}): SlackIntegrationSettingsItem[] {
  const canManage = canManageSlackIntegrations(input.viewer?.role);
  return listExternalIntegrationsSync({
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
    includeDisabled: true,
  }).map((integration) => {
    const credentialSummary = summarizeSlackStoredCredentials(integration);
    const channelBindings = canManage
      ? listExternalChannelBindingsSync({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
      })
      : [];
    const userBindings = listExternalUserBindingsSync({
      workspaceId: input.workspaceId,
      integrationId: integration.id,
    }).filter((binding) => canManage || binding.userId === input.viewer?.userId);
    const inboundEvents = canManage
      ? listExternalIntegrationEventsSync({
        workspaceId: input.workspaceId,
        provider: SLACK_PROVIDER_ID,
        integrationId: integration.id,
        limit: 10,
      })
      : [];
    const failedOutboxItems = canManage
      ? listExternalMessageOutboxSync({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        status: "failed",
        limit: 5,
      })
      : [];
    const pendingOutboxItems = canManage
      ? listExternalMessageOutboxSync({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        status: "pending",
        limit: 5,
      }).filter((item) => Boolean(item.lastError))
      : [];
    const userBindingItems = userBindings.map((binding): SlackUserBindingSettingsItem => ({
      id: binding.id,
      integrationId: binding.integrationId,
      userId: binding.userId,
      externalUserReference: buildSlackReference(binding.externalUserId),
      externalUserIdRedacted: true,
      displayName: binding.displayName,
      status: binding.status,
      createdAt: binding.createdAt,
      updatedAt: binding.updatedAt,
      lastSeenAt: binding.lastSeenAt,
    }));
    const channelBindingItems = channelBindings.map((binding): SlackChannelBindingSettingsItem => ({
      id: binding.id,
      integrationId: binding.integrationId,
      channelName: binding.channelName,
      externalChannelReference: buildSlackReference(binding.externalChatId),
      externalChannelIdRedacted: true,
      externalChannelType: binding.externalChatType,
      externalChannelName: binding.externalChatName,
      status: binding.status,
      syncMode: binding.syncMode,
      createdAt: binding.createdAt,
      updatedAt: binding.updatedAt,
    }));
    const recentOutboxFailures = [...failedOutboxItems, ...pendingOutboxItems]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt))
      .slice(0, 5)
      .map((item): SlackOutboxSettingsItem => ({
        id: item.id,
        integrationId: item.integrationId,
        channelBindingId: item.channelBindingId,
        targetExternalChannelReference: buildSlackReference(item.targetExternalChatId),
        targetExternalChannelIdRedacted: true,
        targetExternalThreadReference: item.targetExternalThreadId
          ? buildSlackReference(item.targetExternalThreadId)
          : undefined,
        targetExternalThreadIdRedacted: item.targetExternalThreadId ? true : undefined,
        agentSpaceMessageId: item.agentSpaceMessageId,
        status: item.status,
        attempts: item.attempts,
        nextAttemptAt: item.nextAttemptAt,
        lastError: item.lastError,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
    const recentInboundEvents = inboundEvents.map((event): SlackIntegrationEventSettingsItem => ({
      id: event.id,
      integrationId: event.integrationId,
      externalEventReference: buildSlackReference(event.externalEventId),
      externalEventIdRedacted: true,
      eventType: event.eventType,
      status: event.status,
      errorMessage: event.errorMessage,
      bindingSuggestion: buildSlackInboundBindingSuggestion(event.errorMessage, event.payloadJson),
      receivedAt: event.receivedAt,
      processedAt: event.processedAt,
    }));
    const callbackUrl = canManage
      ? buildSlackEventCallbackUrl({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        appUrl: input.appUrl,
      })
      : "";
    const activeChannelBindingCount = channelBindingItems.filter((binding) => binding.status === "active").length;
    const activeUserBindingCount = userBindingItems.filter((binding) => binding.status === "active").length;

    return {
      id: integration.id,
      displayName: integration.displayName,
      status: integration.status,
      transportMode: integration.transportMode,
      agentId: canManage ? integration.agentId : undefined,
      appId: canManage ? integration.appId : undefined,
      teamId: canManage ? integration.tenantKey : undefined,
      callbackUrl,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
      lastHealthStatus: canManage ? integration.lastHealthStatus : undefined,
      lastHealthCheckedAt: canManage ? integration.lastHealthCheckedAt : undefined,
      lastError: canManage ? integration.lastError : undefined,
      hasBotToken: canManage && credentialSummary.hasBotToken,
      hasSigningSecret: canManage && credentialSummary.hasSigningSecret,
      hasAppLevelToken: canManage && credentialSummary.hasAppLevelToken,
      channelBindingCount: activeChannelBindingCount,
      userBindingCount: activeUserBindingCount,
      outboxFailureCount: recentOutboxFailures.length,
      userBindings: userBindingItems,
      channelBindings: channelBindingItems,
      recentOutboxFailures,
      recentInboundEvents,
      setupGuide: canManage
        ? buildSlackIntegrationSetupGuide({
          workspaceId: input.workspaceId,
          integrationId: integration.id,
          transportMode: integration.transportMode,
          appUrl: input.appUrl,
          checks: buildSlackIntegrationSetupChecks({
            transportMode: integration.transportMode,
            callbackUrl,
            hasBotToken: credentialSummary.hasBotToken,
            hasSigningSecret: credentialSummary.hasSigningSecret,
            hasAppLevelToken: credentialSummary.hasAppLevelToken,
            lastHealthStatus: integration.lastHealthStatus,
            channelBindingCount: activeChannelBindingCount,
            userBindingCount: activeUserBindingCount,
            outboxFailureCount: recentOutboxFailures.length,
          }),
        })
        : undefined,
    };
  });
}

export function canManageSlackIntegrations(role?: WorkspaceRole): boolean {
  return role === undefined || hasWorkspaceRole(role, "admin");
}

export function buildSlackIntegrationCreationGuide(input: {
  workspaceId: string;
  appUrl?: string;
}): SlackIntegrationCreationGuide {
  const callbackUrlTemplate = buildSlackEventCallbackUrl({
    workspaceId: input.workspaceId,
    integrationId: "created-integration-id",
    appUrl: input.appUrl,
  });
  return {
    requiredCredentialFields: [...SLACK_REQUIRED_CREDENTIAL_FIELDS],
    requiredEvents: [...SLACK_REQUIRED_EVENTS],
    requiredScopes: [...SLACK_DEFAULT_SCOPES],
    socketModeCredentialFields: [...SLACK_SOCKET_MODE_CREDENTIAL_FIELDS],
    socketModeScopes: [...SLACK_SOCKET_MODE_SCOPES],
    eventCallbackPath: SLACK_EVENT_CALLBACK_PATH,
    publicAppUrlStatus: input.appUrl?.trim() ? "configured" : "missing",
    ...(input.appUrl?.trim() ? { publicAppUrl: input.appUrl.trim() } : {}),
    callbackUrlTemplate,
    developerConsoleUrl: SLACK_DEVELOPER_CONSOLE_URL,
    commands: {
      create: `agent-space integrations slack create --workspace-id ${input.workspaceId} --app-id CHANGE_ME_SLACK_APP_ID --team-id CHANGE_ME_SLACK_TEAM_ID --env-file scripts/slack/.env --bot-token-env SLACK_BOT_TOKEN --signing-secret-env SLACK_SIGNING_SECRET --json`,
      healthCheck: `agent-space integrations slack health-check --workspace-id ${input.workspaceId} --integration created-integration-id --json`,
      bindChannel: `agent-space integrations slack bind-channel --workspace-id ${input.workspaceId} --integration created-integration-id --channel general --slack-channel ${SLACK_CHANNEL_ID_PLACEHOLDER} --json`,
      bindUser: `agent-space integrations slack bind-user --workspace-id ${input.workspaceId} --integration created-integration-id --user-id CHANGE_ME_AGENTSPACE_USER_ID --slack-user ${SLACK_USER_ID_PLACEHOLDER} --json`,
      outboxDrain: `agent-space integrations slack outbox drain --workspace-id ${input.workspaceId} --integration created-integration-id --json`,
    },
  };
}

export function listSlackAvailableChannels(input: {
  workspaceId: string;
}): SlackAvailableChannelItem[] {
  return listStoredChannelsSync(input.workspaceId).map((channel) => ({
    name: channel.name,
    kind: channel.kind,
  }));
}

export function listSlackAvailableUsers(input: {
  workspaceId: string;
}): SlackAvailableUserItem[] {
  return listWorkspaceMemberUsersSync(input.workspaceId).map((member) => ({
    userId: member.userId,
    displayName: member.displayName,
    primaryEmail: member.primaryEmail,
    role: member.role,
  }));
}

export function buildSlackEventCallbackUrl(input: {
  workspaceId: string;
  integrationId: string;
  appUrl?: string;
}): string {
  const searchParams = new URLSearchParams({
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
  });
  return buildPublicAppUrl(`${SLACK_EVENT_CALLBACK_PATH}?${searchParams.toString()}`, input.appUrl);
}

function buildSlackIntegrationSetupGuide(input: {
  workspaceId: string;
  integrationId: string;
  transportMode: string;
  appUrl?: string;
  checks: SlackIntegrationSetupCheck[];
}): SlackIntegrationSetupGuide {
  const flags = `--workspace-id ${input.workspaceId} --integration ${input.integrationId}`;
  return {
    requiredCredentialFields: input.transportMode === "websocket_worker"
      ? [...SLACK_REQUIRED_CREDENTIAL_FIELDS, ...SLACK_SOCKET_MODE_CREDENTIAL_FIELDS]
      : [...SLACK_REQUIRED_CREDENTIAL_FIELDS],
    requiredEvents: [...SLACK_REQUIRED_EVENTS],
    requiredScopes: input.transportMode === "websocket_worker"
      ? [...SLACK_DEFAULT_SCOPES, ...SLACK_SOCKET_MODE_SCOPES]
      : [...SLACK_DEFAULT_SCOPES],
    eventCallbackPath: SLACK_EVENT_CALLBACK_PATH,
    developerConsoleUrl: SLACK_DEVELOPER_CONSOLE_URL,
    checks: input.checks,
    commands: {
      healthCheck: `agent-space integrations slack health-check ${flags} --json`,
      bindChannel: `agent-space integrations slack bind-channel ${flags} --channel general --slack-channel ${SLACK_CHANNEL_ID_PLACEHOLDER} --json`,
      bindUser: `agent-space integrations slack bind-user ${flags} --user-id CHANGE_ME_AGENTSPACE_USER_ID --slack-user ${SLACK_USER_ID_PLACEHOLDER} --json`,
      outboxDrain: `agent-space integrations slack outbox drain ${flags} --json`,
    },
  };
}

function buildSlackIntegrationSetupChecks(input: {
  transportMode: string;
  callbackUrl: string;
  hasBotToken: boolean;
  hasSigningSecret: boolean;
  hasAppLevelToken: boolean;
  lastHealthStatus?: string;
  channelBindingCount: number;
  userBindingCount: number;
  outboxFailureCount: number;
}): SlackIntegrationSetupCheck[] {
  const needsAppLevelToken = input.transportMode === "websocket_worker";
  const hasRequiredCredentials = input.hasBotToken && input.hasSigningSecret && (!needsAppLevelToken || input.hasAppLevelToken);
  const healthStatus = input.lastHealthStatus === "healthy"
    ? "ready"
    : input.lastHealthStatus && input.lastHealthStatus !== "unknown"
      ? "attention"
      : "missing";
  return [
    {
      key: "credentials",
      status: hasRequiredCredentials ? "ready" : "missing",
      current: hasRequiredCredentials ? "complete" : "incomplete",
      required: needsAppLevelToken ? "bot_token/signing_secret/app_level_token" : "bot_token/signing_secret",
    },
    {
      key: "callback_or_socket",
      status: input.transportMode === "websocket_worker"
        ? "ready"
        : input.callbackUrl.startsWith("http")
          ? "ready"
          : "attention",
      current: input.transportMode === "websocket_worker" ? "socket_mode" : input.callbackUrl,
      required: "public_callback_or_socket_mode",
    },
    {
      key: "health",
      status: healthStatus,
      current: input.lastHealthStatus ?? "unknown",
      required: "healthy",
    },
    {
      key: "channel_binding",
      status: input.channelBindingCount > 0 ? "ready" : "missing",
      current: input.channelBindingCount,
      required: 1,
    },
    {
      key: "user_binding",
      status: input.userBindingCount > 0 ? "ready" : "missing",
      current: input.userBindingCount,
      required: 1,
    },
    {
      key: "outbox",
      status: input.outboxFailureCount === 0 ? "ready" : "attention",
      current: input.outboxFailureCount,
      required: 0,
    },
  ];
}

function buildSlackInboundBindingSuggestion(
  errorMessage: string | undefined,
  payloadJson: string,
): SlackInboundBindingSuggestion | undefined {
  if (errorMessage !== "slack.channel_binding_missing" && errorMessage !== "slack.user_binding_missing") {
    return undefined;
  }
  const payload = parseJsonRecord(payloadJson) ?? {};
  if (errorMessage === "slack.channel_binding_missing") {
    return {
      kind: "channel",
      externalChannelReference: readString(payload.channelRef) ?? "ref_unknown",
      externalChannelIdRedacted: true,
    };
  }
  return {
    kind: "user",
    externalUserReference: readString(payload.userRef) ?? "ref_unknown",
    externalUserIdRedacted: true,
  };
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
