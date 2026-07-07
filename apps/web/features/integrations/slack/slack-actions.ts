"use server";

import {
  cancelExternalMessageOutboxForIntegrationSync,
  createExternalIntegrationSync,
  deleteExternalIntegrationSync,
  readExternalChannelBindingByExternalChatSync,
  readExternalIntegrationSync,
  readExternalUserBindingByExternalUserSync,
  readStoredChannelSync,
  readWorkspaceMembershipSync,
  updateExternalIntegrationHealthSync,
  updateExternalIntegrationStatusSync,
  upsertExternalChannelBindingSync,
  upsertExternalUserBindingSync,
  type WorkspaceRole,
} from "@agent-space/db";
import {
  buildEncryptedSlackCredentials,
  buildSlackHealthSnapshotConfigJson,
  checkSlackIntegrationHealth,
  readSlackIntegrationCredentials,
  SLACK_DEFAULT_SCOPES,
  SLACK_EVENT_CALLBACK_PATH,
  SLACK_PROVIDER_ID,
  SLACK_SOCKET_MODE_SCOPES,
  tryRecordWorkspaceAuditEventSync,
} from "@agent-space/services";
import { readPublicAppUrl } from "@/features/auth/public-app-url";
import { requireCurrentWorkspaceContext } from "@/features/auth/server-workspace";
import { assertWorkspaceRoleForContext } from "@/features/auth/workspace-permissions";
import { revalidateWorkspacePaths } from "@/features/auth/workspace-revalidation";
import { SETTINGS_REVALIDATE_PATHS } from "@/features/settings/settings-sections";
import {
  buildSlackEventCallbackUrl,
  canManageSlackIntegrations,
  listSlackIntegrationSettingsItems,
} from "./slack-settings-data";
import type {
  CreateSlackChannelBindingInput,
  CreateSlackIntegrationInput,
  CreateSlackUserBindingInput,
  DeletedSlackIntegrationResult,
  SlackIntegrationSettingsItem,
} from "./slack-types";

export async function createSlackIntegrationAction(
  input: CreateSlackIntegrationInput,
): Promise<SlackIntegrationSettingsItem> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  assertWorkspaceRoleForContext(workspaceContext, "admin");

  const displayName = input.displayName.trim() || "Slack";
  const appId = input.appId.trim();
  const teamId = input.teamId?.trim();
  const botToken = input.botToken.trim();
  const signingSecret = input.signingSecret.trim();
  const appLevelToken = input.appLevelToken?.trim();
  if (!appId) {
    throw new Error("slack.integration.missing_app_id");
  }
  if (!botToken) {
    throw new Error("slack.integration.missing_bot_token");
  }
  if (!signingSecret) {
    throw new Error("slack.integration.missing_signing_secret");
  }
  if (input.transportMode !== "http_webhook" && input.transportMode !== "websocket_worker") {
    throw new Error("slack.integration.invalid_transport_mode");
  }
  if (input.transportMode === "websocket_worker" && !appLevelToken) {
    throw new Error("slack.integration.missing_app_level_token");
  }
  assertNoSlackPlaceholderSetupValue(appId);
  assertNoSlackPlaceholderSetupValue(teamId);
  assertNoSlackPlaceholderSetupValue(botToken);
  assertNoSlackPlaceholderSetupValue(signingSecret);
  assertNoSlackPlaceholderSetupValue(appLevelToken);

  let integration: ReturnType<typeof createExternalIntegrationSync>;
  try {
    integration = createExternalIntegrationSync({
      workspaceId: workspaceContext.currentWorkspace.id,
      provider: SLACK_PROVIDER_ID,
      displayName,
      transportMode: input.transportMode,
      appId,
      tenantKey: teamId,
      encryptedCredentialsJson: buildEncryptedSlackCredentials({
        botToken,
        signingSecret,
        appLevelToken,
      }),
      configJson: {
        eventCallbackPath: SLACK_EVENT_CALLBACK_PATH,
        capabilities: {
          messageTransport: true,
          socketMode: input.transportMode === "websocket_worker",
        },
      },
      capabilitiesJson: {
        messageTransport: true,
      },
      scopesJson: [
        ...SLACK_DEFAULT_SCOPES,
        ...(input.transportMode === "websocket_worker" || appLevelToken ? SLACK_SOCKET_MODE_SCOPES : []),
      ],
      createdByUserId: workspaceContext.currentUser.id,
    });
  } catch (error) {
    throw normalizeSlackIntegrationWriteError(error);
  }

  tryRecordWorkspaceAuditEventSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    title: "Slack integration created",
    note: `${workspaceContext.currentUser.displayName} created Slack integration "${displayName}".`,
    code: "workspace.external_integration_created",
    data: {
      actorType: "session_user",
      resourceType: "external_integration",
      resourceId: integration.id,
      provider: SLACK_PROVIDER_ID,
      transportMode: input.transportMode,
      secretRedacted: true,
    },
  });
  revalidateWorkspacePaths(workspaceContext.currentWorkspace.slug, SETTINGS_REVALIDATE_PATHS);

  return requireSlackIntegrationSettingsItem({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    appUrl: readPublicAppUrl(),
    viewer: {
      role: workspaceContext.currentMembership.role,
      userId: workspaceContext.currentUser.id,
    },
  });
}

export async function disableSlackIntegrationAction(
  integrationId: string,
): Promise<SlackIntegrationSettingsItem> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  assertWorkspaceRoleForContext(workspaceContext, "admin");
  const integration = readSlackIntegration({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId,
  });

  const updated = updateExternalIntegrationStatusSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    status: "disabled",
    updatedByUserId: workspaceContext.currentUser.id,
  });
  tryRecordWorkspaceAuditEventSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    title: "Slack integration disabled",
    note: `${workspaceContext.currentUser.displayName} disabled Slack integration "${updated.displayName}".`,
    code: "workspace.external_integration_disabled",
    data: {
      actorType: "session_user",
      resourceType: "external_integration",
      resourceId: updated.id,
      provider: SLACK_PROVIDER_ID,
    },
  });
  revalidateWorkspacePaths(workspaceContext.currentWorkspace.slug, SETTINGS_REVALIDATE_PATHS);

  return requireSlackIntegrationSettingsItem({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: updated.id,
    appUrl: readPublicAppUrl(),
    viewer: {
      role: workspaceContext.currentMembership.role,
      userId: workspaceContext.currentUser.id,
    },
  });
}

export async function resumeSlackIntegrationAction(
  integrationId: string,
): Promise<SlackIntegrationSettingsItem> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  assertWorkspaceRoleForContext(workspaceContext, "admin");
  const integration = readSlackIntegration({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId,
  });

  const updated = updateExternalIntegrationStatusSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    status: "active",
    updatedByUserId: workspaceContext.currentUser.id,
  });
  tryRecordWorkspaceAuditEventSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    title: "Slack integration resumed",
    note: `${workspaceContext.currentUser.displayName} resumed Slack integration "${updated.displayName}".`,
    code: "workspace.external_integration_resumed",
    data: {
      actorType: "session_user",
      resourceType: "external_integration",
      resourceId: updated.id,
      provider: SLACK_PROVIDER_ID,
    },
  });
  revalidateWorkspacePaths(workspaceContext.currentWorkspace.slug, SETTINGS_REVALIDATE_PATHS);

  return requireSlackIntegrationSettingsItem({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: updated.id,
    appUrl: readPublicAppUrl(),
    viewer: {
      role: workspaceContext.currentMembership.role,
      userId: workspaceContext.currentUser.id,
    },
  });
}

export async function deleteSlackIntegrationAction(
  integrationId: string,
): Promise<DeletedSlackIntegrationResult> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  assertWorkspaceRoleForContext(workspaceContext, "admin");
  const integration = readSlackIntegration({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId,
  });
  const cancelledOutboxCount = cancelExternalMessageOutboxForIntegrationSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    reason: "slack.integration.deleted",
  });
  const deleted = deleteExternalIntegrationSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
  });

  tryRecordWorkspaceAuditEventSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    title: "Slack integration deleted",
    note: `${workspaceContext.currentUser.displayName} deleted Slack integration "${deleted.displayName}".`,
    code: "workspace.external_integration_deleted",
    data: {
      actorType: "session_user",
      resourceType: "external_integration",
      resourceId: deleted.id,
      provider: SLACK_PROVIDER_ID,
      cancelledOutboxCount,
    },
  });
  revalidateWorkspacePaths(workspaceContext.currentWorkspace.slug, SETTINGS_REVALIDATE_PATHS);

  return { integrationId: deleted.id };
}

export async function checkSlackIntegrationHealthAction(
  integrationId: string,
): Promise<SlackIntegrationSettingsItem> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  assertWorkspaceRoleForContext(workspaceContext, "admin");

  const integration = requireActiveSlackIntegration({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId,
  });
  let credentials: ReturnType<typeof readSlackIntegrationCredentials>;
  try {
    credentials = readSlackIntegrationCredentials(integration);
  } catch (error) {
    throw normalizeSlackIntegrationWriteError(error);
  }
  const health = await checkSlackIntegrationHealth({
    botToken: credentials.botToken,
    appLevelToken: credentials.appLevelToken,
    transportMode: integration.transportMode,
    expectedAppId: integration.appId,
    expectedTeamId: integration.tenantKey,
  });
  updateExternalIntegrationHealthSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    lastHealthStatus: health.status,
    lastError: health.errorMessage,
    configJson: buildSlackHealthSnapshotConfigJson({
      configJson: integration.configJson,
      health,
    }),
  });
  tryRecordWorkspaceAuditEventSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    title: "Slack integration health checked",
    note: `${workspaceContext.currentUser.displayName} checked Slack integration "${integration.displayName}" with status "${health.status}".`,
    code: "workspace.external_integration_health_checked",
    data: {
      actorType: "session_user",
      resourceType: "external_integration",
      resourceId: integration.id,
      provider: SLACK_PROVIDER_ID,
      healthStatus: health.status,
      botUserId: health.botUserId,
      teamId: health.teamId,
    },
  });
  revalidateWorkspacePaths(workspaceContext.currentWorkspace.slug, SETTINGS_REVALIDATE_PATHS);

  return requireSlackIntegrationSettingsItem({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    appUrl: readPublicAppUrl(),
    viewer: {
      role: workspaceContext.currentMembership.role,
      userId: workspaceContext.currentUser.id,
    },
  });
}

export async function createSlackChannelBindingAction(
  input: CreateSlackChannelBindingInput,
): Promise<SlackIntegrationSettingsItem> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  assertWorkspaceRoleForContext(workspaceContext, "admin");

  const channelName = input.channelName.trim();
  const externalChannelId = input.externalChannelId.trim();
  if (!channelName) {
    throw new Error("slack.channel_binding.missing_channel");
  }
  if (!externalChannelId) {
    throw new Error("slack.channel_binding.missing_external_channel_id");
  }
  assertNoSlackPlaceholderBindingValue(channelName, "slack.channel_binding.placeholder_value");
  assertNoSlackPlaceholderBindingValue(externalChannelId, "slack.channel_binding.placeholder_value");
  const integration = requireActiveSlackIntegration({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: input.integrationId,
  });
  if (!readStoredChannelSync(channelName, workspaceContext.currentWorkspace.id)) {
    throw new Error("slack.channel_binding.channel_not_found");
  }
  const existingExternalBinding = readExternalChannelBindingByExternalChatSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    externalChatId: externalChannelId,
  });
  if (existingExternalBinding && existingExternalBinding.channelName !== channelName) {
    throw new Error("slack.channel_binding.external_channel_taken");
  }

  const binding = upsertExternalChannelBindingSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    channelName,
    externalChatId: externalChannelId,
    externalChatType: input.externalChannelType?.trim() || inferSlackChannelType(externalChannelId),
    externalChatName: input.externalChannelName?.trim(),
    status: "active",
    syncMode: "mirror",
    metadataJson: {
      provider: SLACK_PROVIDER_ID,
      provisionSource: "manual",
    },
    createdByUserId: workspaceContext.currentUser.id,
  });
  tryRecordWorkspaceAuditEventSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    title: "Slack channel binding saved",
    note: `${workspaceContext.currentUser.displayName} mapped AgentSpace channel "${channelName}" to a Slack conversation.`,
    code: "workspace.external_channel_binding_upserted",
    data: {
      actorType: "session_user",
      resourceType: "external_channel_binding",
      resourceId: binding.id,
      provider: SLACK_PROVIDER_ID,
      integrationId: integration.id,
      channelName,
      externalIdRedacted: true,
    },
  });
  revalidateWorkspacePaths(workspaceContext.currentWorkspace.slug, SETTINGS_REVALIDATE_PATHS);

  return requireSlackIntegrationSettingsItem({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    appUrl: readPublicAppUrl(),
    viewer: {
      role: workspaceContext.currentMembership.role,
      userId: workspaceContext.currentUser.id,
    },
  });
}

export async function createSlackUserBindingAction(
  input: CreateSlackUserBindingInput,
): Promise<SlackIntegrationSettingsItem> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  const userId = input.userId.trim();
  const externalUserId = input.externalUserId.trim();
  if (!userId) {
    throw new Error("slack.user_binding.missing_user");
  }
  if (!externalUserId) {
    throw new Error("slack.user_binding.missing_external_user_id");
  }
  assertNoSlackPlaceholderBindingValue(userId, "slack.user_binding.placeholder_value");
  assertNoSlackPlaceholderBindingValue(externalUserId, "slack.user_binding.placeholder_value");
  assertCanManageSlackUserBindingTarget({
    actorRole: workspaceContext.currentMembership.role,
    actorUserId: workspaceContext.currentUser.id,
    targetUserId: userId,
  });
  const integration = requireActiveSlackIntegration({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: input.integrationId,
  });
  if (!readWorkspaceMembershipSync(workspaceContext.currentWorkspace.id, userId)) {
    throw new Error("slack.user_binding.user_not_found");
  }
  const existingExternalBinding = readExternalUserBindingByExternalUserSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    externalUserId,
  });
  if (existingExternalBinding && existingExternalBinding.userId !== userId) {
    throw new Error("slack.user_binding.external_user_taken");
  }

  const binding = upsertExternalUserBindingSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    userId,
    externalUserId,
    displayName: input.displayName?.trim(),
    status: "active",
    metadataJson: {
      provider: SLACK_PROVIDER_ID,
    },
  });
  tryRecordWorkspaceAuditEventSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    title: "Slack user binding saved",
    note: `${workspaceContext.currentUser.displayName} mapped AgentSpace user "${userId}" to a Slack user.`,
    code: "workspace.external_user_binding_upserted",
    data: {
      actorType: "session_user",
      resourceType: "external_user_binding",
      resourceId: binding.id,
      provider: SLACK_PROVIDER_ID,
      integrationId: integration.id,
      userId,
      externalIdRedacted: true,
    },
  });
  revalidateWorkspacePaths(workspaceContext.currentWorkspace.slug, SETTINGS_REVALIDATE_PATHS);

  return requireSlackIntegrationSettingsItem({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    appUrl: readPublicAppUrl(),
    viewer: {
      role: workspaceContext.currentMembership.role,
      userId: workspaceContext.currentUser.id,
    },
  });
}

function readSlackIntegration(input: {
  workspaceId: string;
  integrationId: string;
}) {
  const integration = readExternalIntegrationSync({
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
  });
  if (!integration || integration.provider !== SLACK_PROVIDER_ID) {
    throw new Error("slack.integration.not_found");
  }
  return integration;
}

function requireActiveSlackIntegration(input: {
  workspaceId: string;
  integrationId: string;
}) {
  const integration = readSlackIntegration(input);
  if (integration.status === "disabled") {
    throw new Error("slack.integration.disabled");
  }
  return integration;
}

function requireSlackIntegrationSettingsItem(input: {
  workspaceId: string;
  integrationId: string;
  appUrl?: string;
  viewer?: {
    role: WorkspaceRole;
    userId: string;
  };
}): SlackIntegrationSettingsItem {
  const item = listSlackIntegrationSettingsItems({
    workspaceId: input.workspaceId,
    appUrl: input.appUrl,
    viewer: input.viewer,
  }).find((candidate) => candidate.id === input.integrationId);
  if (!item) {
    throw new Error("slack.integration.not_found");
  }
  if (!canManageSlackIntegrations(input.viewer?.role)) {
    return item;
  }
  return {
    ...item,
    callbackUrl: buildSlackEventCallbackUrl(input),
  };
}

function assertCanManageSlackUserBindingTarget(input: {
  actorRole: WorkspaceRole;
  actorUserId: string;
  targetUserId: string;
}): void {
  if (canManageSlackIntegrations(input.actorRole) || input.actorUserId === input.targetUserId) {
    return;
  }
  throw new Error("slack.user_binding.forbidden");
}

function normalizeSlackIntegrationWriteError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "External integration app and tenant are already connected.") {
    return new Error("slack.integration.duplicate_app_team");
  }
  if (message === "AGENT_SPACE_SLACK_CREDENTIAL_ENCRYPTION_KEY is required to store Slack credentials.") {
    return new Error("slack.integration.credential_encryption_key_missing");
  }
  if (message === "AGENT_SPACE_SLACK_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.") {
    return new Error("slack.integration.credential_encryption_key_invalid");
  }
  return error instanceof Error ? error : new Error(message);
}

function assertNoSlackPlaceholderSetupValue(value: string | undefined): void {
  if (!value) {
    return;
  }
  if (isSlackPlaceholderSetupValue(value)) {
    throw new Error("slack.integration.placeholder_value");
  }
}

function assertNoSlackPlaceholderBindingValue(value: string | undefined, errorCode: string): void {
  if (!value) {
    return;
  }
  if (isSlackPlaceholderSetupValue(value)) {
    throw new Error(errorCode);
  }
}

function isSlackPlaceholderSetupValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const tokenized = normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (tokenized.startsWith("change_me") || tokenized.startsWith("replace_me")) {
    return true;
  }
  if (tokenized === "xxx" || tokenized === "todo" || tokenized === "placeholder") {
    return true;
  }
  return /(^|_)xxx($|_)/.test(tokenized) ||
    /(^|_)(todo|placeholder|example)($|_)/.test(tokenized);
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
