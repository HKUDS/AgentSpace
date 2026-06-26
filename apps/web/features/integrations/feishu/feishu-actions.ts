"use server";

import {
  cancelExternalMessageOutboxForIntegrationSync,
  createExternalIntegrationSync,
  deleteExternalIntegrationSync,
  readExternalChannelBindingByExternalChatSync,
  readExternalIntegrationSync,
  readExternalResourceBindingByKeySync,
  readExternalUserBindingByExternalUserSync,
  readExternalUserBindingByIdSync,
  readStoredChannelSync,
  readWorkspaceMembershipSync,
  updateExternalChannelBindingStatusSync,
  updateExternalIntegrationCredentialsSync,
  updateExternalIntegrationStatusSync,
  updateExternalIntegrationHealthSync,
  updateExternalResourceBindingStatusSync,
  updateExternalUserBindingStatusSync,
  upsertExternalChannelBindingSync,
  upsertExternalResourceBindingSync,
  upsertExternalUserBindingSync,
  type ExternalBindingStatus,
  type WorkspaceRole,
} from "@agent-space/db";
import {
  FEISHU_DEFAULT_SCOPES,
  FEISHU_EVENT_CALLBACK_PATH,
  FEISHU_PROVIDER_ID,
  checkFeishuIntegrationHealth,
  createFeishuAgentBotBindingSync,
  disableFeishuAgentBotBindingSync,
  resolveFeishuResourceDescriptorForType,
  rotateFeishuAgentBotCredentialsSync,
  tryRecordWorkspaceAuditEventSync,
  upsertFeishuExternalChannelDocumentSync,
  upsertFeishuExternalDataTableSync,
  validateFeishuResourceDescriptorForBinding,
  validateFeishuResourceBindingScopes,
} from "@agent-space/services";
import { readPublicAppUrl } from "@/features/auth/public-app-url";
import { requireCurrentWorkspaceContext } from "@/features/auth/server-workspace";
import { assertWorkspaceRoleForContext } from "@/features/auth/workspace-permissions";
import { revalidateWorkspacePaths } from "@/features/auth/workspace-revalidation";
import { SETTINGS_REVALIDATE_PATHS } from "@/features/settings/settings-sections";
import {
  buildEncryptedFeishuCredentials,
  readFeishuIntegrationCredentials,
} from "./feishu-credentials";
import {
  buildFeishuEventCallbackUrl,
  canManageFeishuIntegrations,
  listFeishuIntegrationSettingsItems,
} from "./feishu-settings-data";
import { assertCanManageFeishuUserBindingTarget } from "./feishu-user-binding-permissions";
import type {
  CreateFeishuChannelBindingInput,
  CreateFeishuAgentBotBindingInput,
  CreateFeishuIntegrationInput,
  CreateFeishuResourceBindingInput,
  CreateFeishuUserBindingInput,
  DeletedFeishuIntegrationResult,
  FeishuIntegrationSettingsItem,
  RotateFeishuAgentBotCredentialsInput,
  RotateFeishuIntegrationSecretInput,
  TestFeishuIntegrationConnectionInput,
  TestFeishuIntegrationConnectionResult,
  UpdateFeishuBindingStatusInput,
} from "./feishu-types";

export async function testFeishuIntegrationConnectionAction(
  input: TestFeishuIntegrationConnectionInput,
): Promise<TestFeishuIntegrationConnectionResult> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  assertWorkspaceRoleForContext(workspaceContext, "admin");

  const appId = input.appId.trim();
  const appSecret = input.appSecret.trim();
  if (!appId) {
    throw new Error("feishu.integration.missing_app_id");
  }
  if (!appSecret) {
    throw new Error("feishu.integration.missing_app_secret");
  }
  assertNoFeishuPlaceholderSetupValue(appId);
  assertNoFeishuPlaceholderSetupValue(appSecret);

  const health = await checkFeishuIntegrationHealth({
    appId,
    appSecret,
  });
  const errorCode = resolveFeishuHealthErrorCode({
    status: health.status,
    scopeReadiness: health.scopeReadiness,
  });

  return {
    status: health.status,
    checkedAt: health.checkedAt,
    botOpenId: health.botOpenId,
    botAppName: health.botAppName,
    scopeReadiness: health.scopeReadiness ?? (health.status === "healthy" ? "manual_review_required" : "unavailable"),
    requiredScopes: [...FEISHU_DEFAULT_SCOPES],
    enabledScopes: health.enabledScopes,
    missingScopes: health.missingScopes,
    scopeErrorMessage: sanitizeFeishuHealthErrorMessage(health.scopeErrorMessage, [
      appId,
      appSecret,
    ]),
    errorCode,
    errorMessage: sanitizeFeishuHealthErrorMessage(health.errorMessage, [
      appId,
      appSecret,
    ]),
  };
}

export async function createFeishuIntegrationAction(
  input: CreateFeishuIntegrationInput,
): Promise<FeishuIntegrationSettingsItem> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  assertWorkspaceRoleForContext(workspaceContext, "admin");

  const displayName = input.displayName.trim() || "Feishu";
  const appId = input.appId.trim();
  const appSecret = input.appSecret.trim();
  const verificationToken = input.verificationToken?.trim();
  const encryptKey = input.encryptKey?.trim();
  const tenantKey = input.tenantKey?.trim();
  if (!appId) {
    throw new Error("feishu.integration.missing_app_id");
  }
  if (!appSecret) {
    throw new Error("feishu.integration.missing_app_secret");
  }
  if (input.transportMode !== "http_webhook" && input.transportMode !== "websocket_worker") {
    throw new Error("feishu.integration.invalid_transport_mode");
  }
  if (input.transportMode === "http_webhook" && !verificationToken) {
    throw new Error("feishu.integration.missing_verification_token");
  }
  assertNoFeishuPlaceholderSetupValue(appId);
  assertNoFeishuPlaceholderSetupValue(appSecret);
  assertNoFeishuPlaceholderSetupValue(verificationToken);
  assertNoFeishuPlaceholderSetupValue(encryptKey);
  assertNoFeishuPlaceholderSetupValue(tenantKey);

  let integration: ReturnType<typeof createExternalIntegrationSync>;
  try {
    integration = createExternalIntegrationSync({
      workspaceId: workspaceContext.currentWorkspace.id,
      provider: FEISHU_PROVIDER_ID,
      displayName,
      transportMode: input.transportMode,
      appId,
      tenantKey,
      encryptedCredentialsJson: buildEncryptedFeishuCredentials({
        appSecret,
        verificationToken: verificationToken ?? "",
        encryptKey,
      }),
      configJson: {
        eventCallbackPath: FEISHU_EVENT_CALLBACK_PATH,
        dataPlane: {
          docs: true,
          sheets: true,
          base: true,
        },
      },
      capabilitiesJson: {
        messageTransport: true,
        docsDataPlane: true,
        sheetsDataPlane: true,
        baseDataPlane: true,
      },
      scopesJson: [...FEISHU_DEFAULT_SCOPES],
      createdByUserId: workspaceContext.currentUser.id,
    });
  } catch (error) {
    throw normalizeFeishuIntegrationWriteError(error);
  }

  tryRecordWorkspaceAuditEventSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    title: "Feishu integration created",
    note: `${workspaceContext.currentUser.displayName} created Feishu integration "${displayName}".`,
    code: "workspace.external_integration_created",
    data: {
      actorType: "session_user",
      resourceType: "external_integration",
      resourceId: integration.id,
      provider: FEISHU_PROVIDER_ID,
      transportMode: input.transportMode,
    },
  });
  revalidateWorkspacePaths(workspaceContext.currentWorkspace.slug, SETTINGS_REVALIDATE_PATHS);

  return requireFeishuIntegrationSettingsItem({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    appUrl: readPublicAppUrl(),
    viewer: {
      role: workspaceContext.currentMembership.role,
      userId: workspaceContext.currentUser.id,
    },
  });
}

export async function createFeishuAgentBotBindingAction(
  input: CreateFeishuAgentBotBindingInput,
): Promise<FeishuIntegrationSettingsItem> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  assertWorkspaceRoleForContext(workspaceContext, "admin");

  let integration: ReturnType<typeof createFeishuAgentBotBindingSync>;
  try {
    integration = createFeishuAgentBotBindingSync({
      workspaceId: workspaceContext.currentWorkspace.id,
      agentId: input.agentId,
      displayName: input.displayName,
      transportMode: input.transportMode,
      appId: input.appId,
      appSecret: input.appSecret,
      verificationToken: input.verificationToken,
      encryptKey: input.encryptKey,
      tenantKey: input.tenantKey,
      channelAutoProvisioning: input.channelAutoProvisioning,
      externalGuestPolicy: input.externalGuestPolicy,
      createdByUserId: workspaceContext.currentUser.id,
    });
  } catch (error) {
    throw normalizeFeishuAgentBotBindingWriteError(error);
  }

  tryRecordWorkspaceAuditEventSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    title: "Feishu agent bot binding created",
    note: `${workspaceContext.currentUser.displayName} connected Feishu bot "${integration.displayName}" to agent "${integration.agentId}".`,
    code: "workspace.external_integration_created",
    data: {
      actorType: "session_user",
      resourceType: "external_integration",
      resourceId: integration.id,
      provider: FEISHU_PROVIDER_ID,
      agentId: integration.agentId,
      transportMode: integration.transportMode,
      secretRedacted: true,
    },
  });
  revalidateWorkspacePaths(workspaceContext.currentWorkspace.slug, SETTINGS_REVALIDATE_PATHS);

  return requireFeishuIntegrationSettingsItem({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    appUrl: readPublicAppUrl(),
    viewer: {
      role: workspaceContext.currentMembership.role,
      userId: workspaceContext.currentUser.id,
    },
  });
}

export async function disableFeishuIntegrationAction(
  integrationId: string,
): Promise<FeishuIntegrationSettingsItem> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  assertWorkspaceRoleForContext(workspaceContext, "admin");

  const integration = readExternalIntegrationSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId,
  });
  if (!integration || integration.provider !== FEISHU_PROVIDER_ID) {
    throw new Error("feishu.integration.not_found");
  }

  const updated = updateExternalIntegrationStatusSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    status: "disabled",
    updatedByUserId: workspaceContext.currentUser.id,
  });

  tryRecordWorkspaceAuditEventSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    title: "Feishu integration disabled",
    note: `${workspaceContext.currentUser.displayName} disabled Feishu integration "${updated.displayName}".`,
    code: "workspace.external_integration_disabled",
    data: {
      actorType: "session_user",
      resourceType: "external_integration",
      resourceId: updated.id,
      provider: FEISHU_PROVIDER_ID,
    },
  });
  revalidateWorkspacePaths(workspaceContext.currentWorkspace.slug, SETTINGS_REVALIDATE_PATHS);

  return requireFeishuIntegrationSettingsItem({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: updated.id,
    appUrl: readPublicAppUrl(),
  });
}

export async function disableFeishuAgentBotBindingAction(
  integrationId: string,
): Promise<FeishuIntegrationSettingsItem> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  assertWorkspaceRoleForContext(workspaceContext, "admin");

  let integration: ReturnType<typeof disableFeishuAgentBotBindingSync>;
  try {
    integration = disableFeishuAgentBotBindingSync({
      workspaceId: workspaceContext.currentWorkspace.id,
      integrationId,
      updatedByUserId: workspaceContext.currentUser.id,
    });
  } catch (error) {
    throw normalizeFeishuAgentBotBindingWriteError(error);
  }

  tryRecordWorkspaceAuditEventSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    title: "Feishu agent bot binding disabled",
    note: `${workspaceContext.currentUser.displayName} disabled Feishu bot "${integration.displayName}" for agent "${integration.agentId}".`,
    code: "workspace.external_integration_disabled",
    data: {
      actorType: "session_user",
      resourceType: "external_integration",
      resourceId: integration.id,
      provider: FEISHU_PROVIDER_ID,
      agentId: integration.agentId,
      secretRedacted: true,
    },
  });
  revalidateWorkspacePaths(workspaceContext.currentWorkspace.slug, SETTINGS_REVALIDATE_PATHS);

  return requireFeishuIntegrationSettingsItem({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    appUrl: readPublicAppUrl(),
    viewer: {
      role: workspaceContext.currentMembership.role,
      userId: workspaceContext.currentUser.id,
    },
  });
}

export async function deleteFeishuIntegrationAction(
  integrationId: string,
): Promise<DeletedFeishuIntegrationResult> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  assertWorkspaceRoleForContext(workspaceContext, "admin");

  const integration = readExternalIntegrationSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId,
  });
  if (!integration || integration.provider !== FEISHU_PROVIDER_ID) {
    throw new Error("feishu.integration.not_found");
  }
  const cancelledOutboxCount = cancelExternalMessageOutboxForIntegrationSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    reason: "feishu.integration.deleted",
  });
  const deleted = deleteExternalIntegrationSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
  });

  tryRecordWorkspaceAuditEventSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    title: "Feishu integration deleted",
    note: `${workspaceContext.currentUser.displayName} deleted Feishu integration "${deleted.displayName}".`,
    code: "workspace.external_integration_deleted",
    data: {
      actorType: "session_user",
      resourceType: "external_integration",
      resourceId: deleted.id,
      provider: FEISHU_PROVIDER_ID,
      cancelledOutboxCount,
    },
  });
  revalidateWorkspacePaths(workspaceContext.currentWorkspace.slug, SETTINGS_REVALIDATE_PATHS);

  return { integrationId: deleted.id };
}

export async function resumeFeishuIntegrationAction(
  integrationId: string,
): Promise<FeishuIntegrationSettingsItem> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  assertWorkspaceRoleForContext(workspaceContext, "admin");

  const integration = readExternalIntegrationSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId,
  });
  if (!integration || integration.provider !== FEISHU_PROVIDER_ID) {
    throw new Error("feishu.integration.not_found");
  }

  const updated = updateExternalIntegrationStatusSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    status: "active",
    updatedByUserId: workspaceContext.currentUser.id,
  });

  tryRecordWorkspaceAuditEventSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    title: "Feishu integration resumed",
    note: `${workspaceContext.currentUser.displayName} resumed Feishu integration "${updated.displayName}".`,
    code: "workspace.external_integration_resumed",
    data: {
      actorType: "session_user",
      resourceType: "external_integration",
      resourceId: updated.id,
      provider: FEISHU_PROVIDER_ID,
    },
  });
  revalidateWorkspacePaths(workspaceContext.currentWorkspace.slug, SETTINGS_REVALIDATE_PATHS);

  return requireFeishuIntegrationSettingsItem({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: updated.id,
    appUrl: readPublicAppUrl(),
  });
}

export async function rotateFeishuIntegrationSecretAction(
  input: RotateFeishuIntegrationSecretInput,
): Promise<FeishuIntegrationSettingsItem> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  assertWorkspaceRoleForContext(workspaceContext, "admin");

  const integration = readExternalIntegrationSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: input.integrationId,
  });
  if (!integration || integration.provider !== FEISHU_PROVIDER_ID) {
    throw new Error("feishu.integration.not_found");
  }

  const appId = input.appId?.trim() || integration.appId || "";
  const appSecret = input.appSecret.trim();
  const verificationToken = input.verificationToken?.trim();
  const encryptKey = input.encryptKey?.trim();
  const tenantKey = input.tenantKey?.trim() ?? integration.tenantKey;
  if (!appId) {
    throw new Error("feishu.integration.missing_app_id");
  }
  if (!appSecret) {
    throw new Error("feishu.integration.missing_app_secret");
  }
  if (integration.transportMode === "http_webhook" && !verificationToken) {
    throw new Error("feishu.integration.missing_verification_token");
  }
  assertNoFeishuPlaceholderSetupValue(appId);
  assertNoFeishuPlaceholderSetupValue(appSecret);
  assertNoFeishuPlaceholderSetupValue(verificationToken);
  assertNoFeishuPlaceholderSetupValue(encryptKey);
  assertNoFeishuPlaceholderSetupValue(tenantKey);

  let updated: ReturnType<typeof updateExternalIntegrationCredentialsSync>;
  try {
    updated = updateExternalIntegrationCredentialsSync({
      workspaceId: workspaceContext.currentWorkspace.id,
      integrationId: integration.id,
      appId,
      tenantKey,
      encryptedCredentialsJson: buildEncryptedFeishuCredentials({
        appSecret,
        verificationToken: verificationToken ?? "",
        encryptKey,
      }),
      updatedByUserId: workspaceContext.currentUser.id,
    });
  } catch (error) {
    throw normalizeFeishuIntegrationWriteError(error);
  }

  tryRecordWorkspaceAuditEventSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    title: "Feishu integration credentials rotated",
    note: `${workspaceContext.currentUser.displayName} rotated credentials for Feishu integration "${updated.displayName}".`,
    code: "workspace.external_integration_credentials_rotated",
    data: {
      actorType: "session_user",
      resourceType: "external_integration",
      resourceId: updated.id,
      provider: FEISHU_PROVIDER_ID,
      appId,
    },
  });
  revalidateWorkspacePaths(workspaceContext.currentWorkspace.slug, SETTINGS_REVALIDATE_PATHS);

  return requireFeishuIntegrationSettingsItem({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: updated.id,
    appUrl: readPublicAppUrl(),
  });
}

export async function rotateFeishuAgentBotCredentialsAction(
  input: RotateFeishuAgentBotCredentialsInput,
): Promise<FeishuIntegrationSettingsItem> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  assertWorkspaceRoleForContext(workspaceContext, "admin");

  let updated: ReturnType<typeof rotateFeishuAgentBotCredentialsSync>;
  try {
    updated = rotateFeishuAgentBotCredentialsSync({
      workspaceId: workspaceContext.currentWorkspace.id,
      integrationId: input.integrationId,
      appId: input.appId,
      appSecret: input.appSecret,
      verificationToken: input.verificationToken,
      encryptKey: input.encryptKey,
      tenantKey: input.tenantKey,
      updatedByUserId: workspaceContext.currentUser.id,
    });
  } catch (error) {
    throw normalizeFeishuAgentBotBindingWriteError(error);
  }

  tryRecordWorkspaceAuditEventSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    title: "Feishu agent bot credentials rotated",
    note: `${workspaceContext.currentUser.displayName} rotated credentials for Feishu bot "${updated.displayName}".`,
    code: "workspace.external_integration_credentials_rotated",
    data: {
      actorType: "session_user",
      resourceType: "external_integration",
      resourceId: updated.id,
      provider: FEISHU_PROVIDER_ID,
      agentId: updated.agentId,
      secretRedacted: true,
    },
  });
  revalidateWorkspacePaths(workspaceContext.currentWorkspace.slug, SETTINGS_REVALIDATE_PATHS);

  return requireFeishuIntegrationSettingsItem({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: updated.id,
    appUrl: readPublicAppUrl(),
    viewer: {
      role: workspaceContext.currentMembership.role,
      userId: workspaceContext.currentUser.id,
    },
  });
}

export async function checkFeishuIntegrationHealthAction(
  integrationId: string,
): Promise<FeishuIntegrationSettingsItem> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  assertWorkspaceRoleForContext(workspaceContext, "admin");

  const integration = requireActiveFeishuIntegration({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId,
  });
  let credentials: ReturnType<typeof readFeishuIntegrationCredentials>;
  try {
    credentials = readFeishuIntegrationCredentials(integration);
  } catch (error) {
    throw normalizeFeishuIntegrationWriteError(error);
  }
  const health = await checkFeishuIntegrationHealth({
    appId: integration.appId ?? "",
    appSecret: credentials.appSecret,
  });
  updateExternalIntegrationHealthSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    lastHealthStatus: health.status,
    lastError: sanitizeFeishuHealthErrorMessage(health.errorMessage, [
      integration.appId,
      credentials.appSecret,
    ]),
  });

  tryRecordWorkspaceAuditEventSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    title: "Feishu integration health checked",
    note: `${workspaceContext.currentUser.displayName} checked Feishu integration "${integration.displayName}" with status "${health.status}".`,
    code: "workspace.external_integration_health_checked",
    data: {
      actorType: "session_user",
      resourceType: "external_integration",
      resourceId: integration.id,
      provider: FEISHU_PROVIDER_ID,
      healthStatus: health.status,
      botOpenId: health.botOpenId,
      botAppName: health.botAppName,
    },
  });
  revalidateWorkspacePaths(workspaceContext.currentWorkspace.slug, SETTINGS_REVALIDATE_PATHS);

  return requireFeishuIntegrationSettingsItem({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    appUrl: readPublicAppUrl(),
    viewer: {
      role: workspaceContext.currentMembership.role,
      userId: workspaceContext.currentUser.id,
    },
  });
}

function resolveFeishuHealthErrorCode(input: {
  status: TestFeishuIntegrationConnectionResult["status"];
  scopeReadiness?: TestFeishuIntegrationConnectionResult["scopeReadiness"];
}): string | undefined {
  if (input.status === "healthy") {
    return undefined;
  }
  if (input.scopeReadiness === "missing_required_scopes") {
    return "feishu.integration.scope_missing";
  }
  if (input.scopeReadiness === "unauthorized") {
    return "feishu.integration.scope_unauthorized";
  }
  if (input.scopeReadiness === "manual_review_required") {
    return "feishu.integration.scope_manual_review_required";
  }
  return "feishu.integration.connection_failed";
}

function normalizeFeishuIntegrationWriteError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "External integration app and tenant are already connected.") {
    return new Error("feishu.integration.duplicate_app_tenant");
  }
  if (message === "AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY is required to store Feishu credentials.") {
    return new Error("feishu.integration.credential_encryption_key_missing");
  }
  if (message === "AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.") {
    return new Error("feishu.integration.credential_encryption_key_invalid");
  }
  return error instanceof Error ? error : new Error(message);
}

function normalizeFeishuAgentBotBindingWriteError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("feishu.agent_bot_binding.placeholder_value:")) {
    return new Error("feishu.agent_bot_binding.placeholder_value");
  }
  return error instanceof Error ? error : new Error(message);
}

function assertNoFeishuPlaceholderSetupValue(value: string | undefined): void {
  if (!value) {
    return;
  }
  if (isFeishuPlaceholderSetupValue(value)) {
    throw new Error("feishu.integration.placeholder_value");
  }
}

function assertNoFeishuPlaceholderBindingValue(value: string | undefined, errorCode: string): void {
  if (!value) {
    return;
  }
  if (isFeishuPlaceholderSetupValue(value)) {
    throw new Error(errorCode);
  }
}

function isFeishuPlaceholderSetupValue(value: string): boolean {
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
    /(^|_)(todo|placeholder)($|_)/.test(tokenized);
}

function sanitizeFeishuHealthErrorMessage(
  message: string | undefined,
  sensitiveValues: Array<string | undefined>,
): string | undefined {
  const original = message?.trim();
  if (!original) {
    return undefined;
  }
  let sanitized = original
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(app_secret|appSecret|tenant_access_token|tenantAccessToken|verification_token|verificationToken|encrypt_key|encryptKey)\b\s*[:=]\s*("[^"]+"|'[^']+'|[^,\s]+)/g, "$1=[redacted]");
  for (const value of sensitiveValues) {
    const normalized = value?.trim();
    if (!normalized) {
      continue;
    }
    sanitized = sanitized.split(normalized).join("[redacted]");
  }
  return sanitized.length > 500 ? `${sanitized.slice(0, 497)}...` : sanitized;
}

export async function createFeishuChannelBindingAction(
  input: CreateFeishuChannelBindingInput,
): Promise<FeishuIntegrationSettingsItem> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  assertWorkspaceRoleForContext(workspaceContext, "admin");

  const channelName = input.channelName.trim();
  const externalChatId = input.externalChatId.trim();
  if (!channelName) {
    throw new Error("feishu.channel_binding.missing_channel");
  }
  if (!externalChatId) {
    throw new Error("feishu.channel_binding.missing_external_chat_id");
  }
  assertNoFeishuPlaceholderBindingValue(channelName, "feishu.channel_binding.placeholder_value");
  assertNoFeishuPlaceholderBindingValue(externalChatId, "feishu.channel_binding.placeholder_value");
  const integration = requireActiveFeishuIntegration({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: input.integrationId,
  });
  if (!readStoredChannelSync(channelName, workspaceContext.currentWorkspace.id)) {
    throw new Error("feishu.channel_binding.channel_not_found");
  }
  const existingExternalChatBinding = readExternalChannelBindingByExternalChatSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    externalChatId,
  });
  if (existingExternalChatBinding && existingExternalChatBinding.channelName !== channelName) {
    throw new Error("feishu.channel_binding.external_chat_taken");
  }

  const binding = upsertExternalChannelBindingSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    channelName,
    externalChatId,
    externalChatType: input.externalChatType?.trim(),
    externalChatName: input.externalChatName?.trim(),
    status: "active",
    syncMode: "mirror",
    createdByUserId: workspaceContext.currentUser.id,
  });

  tryRecordWorkspaceAuditEventSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    title: "Feishu channel binding saved",
    note: `${workspaceContext.currentUser.displayName} mapped AgentSpace channel "${channelName}" to a Feishu chat.`,
    code: "workspace.external_channel_binding_upserted",
    data: {
      actorType: "session_user",
      resourceType: "external_channel_binding",
      resourceId: binding.id,
      provider: FEISHU_PROVIDER_ID,
      integrationId: integration.id,
      channelName,
      externalIdRedacted: true,
    },
  });
  revalidateWorkspacePaths(workspaceContext.currentWorkspace.slug, SETTINGS_REVALIDATE_PATHS);

  return requireFeishuIntegrationSettingsItem({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    appUrl: readPublicAppUrl(),
    viewer: {
      role: workspaceContext.currentMembership.role,
      userId: workspaceContext.currentUser.id,
    },
  });
}

export async function pauseFeishuChannelBindingAction(
  input: UpdateFeishuBindingStatusInput,
): Promise<FeishuIntegrationSettingsItem> {
  return updateFeishuBindingStatusAction({
    bindingId: input.bindingId,
    bindingKind: "channel",
    status: "disabled",
    auditCode: "workspace.external_channel_binding_disabled",
    auditTitle: "Feishu channel binding disabled",
  });
}

export async function resumeFeishuChannelBindingAction(
  input: UpdateFeishuBindingStatusInput,
): Promise<FeishuIntegrationSettingsItem> {
  return updateFeishuBindingStatusAction({
    bindingId: input.bindingId,
    bindingKind: "channel",
    status: "active",
    auditCode: "workspace.external_channel_binding_resumed",
    auditTitle: "Feishu channel binding resumed",
  });
}

export async function revokeFeishuChannelBindingAction(
  input: UpdateFeishuBindingStatusInput,
): Promise<FeishuIntegrationSettingsItem> {
  return updateFeishuBindingStatusAction({
    bindingId: input.bindingId,
    bindingKind: "channel",
    status: "archived",
    auditCode: "workspace.external_channel_binding_archived",
    auditTitle: "Feishu channel binding archived",
  });
}

export async function createFeishuUserBindingAction(
  input: CreateFeishuUserBindingInput,
): Promise<FeishuIntegrationSettingsItem> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  const userId = input.userId.trim();
  const externalUserId = input.externalUserId.trim();
  if (!userId) {
    throw new Error("feishu.user_binding.missing_user");
  }
  if (!externalUserId) {
    throw new Error("feishu.user_binding.missing_external_user_id");
  }
  assertNoFeishuPlaceholderBindingValue(userId, "feishu.user_binding.placeholder_value");
  assertNoFeishuPlaceholderBindingValue(externalUserId, "feishu.user_binding.placeholder_value");
  assertNoFeishuPlaceholderBindingValue(input.externalUnionId?.trim(), "feishu.user_binding.placeholder_value");
  assertNoFeishuPlaceholderBindingValue(input.externalOpenId?.trim(), "feishu.user_binding.placeholder_value");
  assertNoFeishuPlaceholderBindingValue(input.externalEmail?.trim(), "feishu.user_binding.placeholder_value");
  assertCanManageFeishuUserBindingTarget({
    actorRole: workspaceContext.currentMembership.role,
    actorUserId: workspaceContext.currentUser.id,
    targetUserId: userId,
  });
  const integration = requireActiveFeishuIntegration({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: input.integrationId,
  });
  if (!readWorkspaceMembershipSync(workspaceContext.currentWorkspace.id, userId)) {
    throw new Error("feishu.user_binding.user_not_found");
  }
  const existingExternalBinding = readExternalUserBindingByExternalUserSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    externalUserId,
  });
  if (existingExternalBinding && existingExternalBinding.userId !== userId) {
    throw new Error("feishu.user_binding.external_user_taken");
  }

  const binding = upsertExternalUserBindingSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    userId,
    externalUserId,
    externalUnionId: input.externalUnionId?.trim(),
    externalOpenId: input.externalOpenId?.trim(),
    externalEmail: input.externalEmail?.trim(),
    displayName: input.displayName?.trim(),
    status: "active",
  });

  tryRecordWorkspaceAuditEventSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    title: "Feishu user binding saved",
    note: `${workspaceContext.currentUser.displayName} mapped AgentSpace user "${userId}" to a Feishu user.`,
    code: "workspace.external_user_binding_upserted",
    data: {
      actorType: "session_user",
      resourceType: "external_user_binding",
      resourceId: binding.id,
      provider: FEISHU_PROVIDER_ID,
      integrationId: integration.id,
      userId,
      externalIdRedacted: true,
    },
  });
  revalidateWorkspacePaths(workspaceContext.currentWorkspace.slug, SETTINGS_REVALIDATE_PATHS);

  return requireFeishuIntegrationSettingsItem({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    appUrl: readPublicAppUrl(),
    viewer: {
      role: workspaceContext.currentMembership.role,
      userId: workspaceContext.currentUser.id,
    },
  });
}

export async function resumeFeishuUserBindingAction(
  input: UpdateFeishuBindingStatusInput,
): Promise<FeishuIntegrationSettingsItem> {
  return updateFeishuBindingStatusAction({
    bindingId: input.bindingId,
    bindingKind: "user",
    status: "active",
    auditCode: "workspace.external_user_binding_resumed",
    auditTitle: "Feishu user binding resumed",
  });
}

export async function revokeFeishuUserBindingAction(
  input: UpdateFeishuBindingStatusInput,
): Promise<FeishuIntegrationSettingsItem> {
  return updateFeishuBindingStatusAction({
    bindingId: input.bindingId,
    bindingKind: "user",
    status: "archived",
    auditCode: "workspace.external_user_binding_archived",
    auditTitle: "Feishu user binding archived",
  });
}

export async function createFeishuResourceBindingAction(
  input: CreateFeishuResourceBindingInput,
): Promise<FeishuIntegrationSettingsItem> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  assertWorkspaceRoleForContext(workspaceContext, "admin");
  assertNoFeishuPlaceholderBindingValue(
    input.providerResourceType.trim(),
    "feishu.resource_binding.placeholder_value",
  );
  assertNoFeishuPlaceholderBindingValue(
    input.resourceUrlOrToken.trim(),
    "feishu.resource_binding.placeholder_value",
  );
  assertNoFeishuPlaceholderBindingValue(
    input.agentSpaceResourceType.trim(),
    "feishu.resource_binding.placeholder_value",
  );
  assertNoFeishuPlaceholderBindingValue(
    input.agentSpaceResourceId.trim(),
    "feishu.resource_binding.placeholder_value",
  );
  assertNoFeishuPlaceholderBindingValue(
    input.channelName?.trim(),
    "feishu.resource_binding.placeholder_value",
  );
  const integration = requireActiveFeishuIntegration({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: input.integrationId,
  });
  const descriptor = resolveFeishuResourceDescriptor(input.providerResourceType, input.resourceUrlOrToken);
  if (!descriptor) {
    throw new Error("feishu.resource_binding.invalid_resource");
  }
  const descriptorValidation = validateFeishuResourceDescriptorForBinding(descriptor);
  if (!descriptorValidation.ok) {
    throw new Error(descriptorValidation.errorCode);
  }
  const scopeValidation = validateFeishuResourceBindingScopes({
    providerResourceType: descriptor.providerResourceType,
    scopesJson: integration.scopesJson,
  });
  if (!scopeValidation.ok) {
    throw new Error("feishu.resource_binding.scope_missing");
  }
  const agentSpaceResourceType = input.agentSpaceResourceType.trim();
  let agentSpaceResourceId = input.agentSpaceResourceId.trim();
  let channelName = input.channelName?.trim();
  if (!agentSpaceResourceType) {
    throw new Error("feishu.resource_binding.missing_agent_space_resource_type");
  }
  if (
    !agentSpaceResourceId &&
    agentSpaceResourceType !== "channel_document" &&
    agentSpaceResourceType !== "data_table"
  ) {
    throw new Error("feishu.resource_binding.missing_agent_space_resource_id");
  }
  if (channelName && !readStoredChannelSync(channelName, workspaceContext.currentWorkspace.id)) {
    throw new Error("feishu.resource_binding.channel_not_found");
  }
  const existingResourceBinding = readExternalResourceBindingByKeySync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    providerResourceType: descriptor.providerResourceType,
    providerResourceToken: descriptor.providerResourceToken,
  });
  if (existingResourceBinding && existingResourceBinding.status !== "archived") {
    if (
      existingResourceBinding.agentSpaceResourceType !== agentSpaceResourceType ||
      (agentSpaceResourceId && existingResourceBinding.agentSpaceResourceId !== agentSpaceResourceId) ||
      (channelName && (existingResourceBinding.channelName ?? "") !== channelName)
    ) {
      throw new Error("feishu.resource_binding.external_resource_taken");
    }
    agentSpaceResourceId = existingResourceBinding.agentSpaceResourceId;
    channelName = channelName ?? existingResourceBinding.channelName;
  }

  let metadataJson: Record<string, unknown> = descriptor.metadata ?? {};
  if (agentSpaceResourceType === "channel_document") {
    const syncedDocument = upsertFeishuExternalChannelDocumentSync({
      channelName,
      agentSpaceResourceId,
      providerResourceType: descriptor.providerResourceType,
      providerResourceToken: descriptor.providerResourceToken,
      providerResourceUrl: descriptor.providerResourceUrl,
      title: input.displayName?.trim(),
      createdBy: workspaceContext.currentUser.displayName,
      createdByType: "human",
    }, workspaceContext.currentWorkspace.id);
    agentSpaceResourceId = syncedDocument.document.id;
    channelName = syncedDocument.document.channelName;
    metadataJson = {
      ...metadataJson,
      agentSpaceSync: {
        channelDocumentId: syncedDocument.document.id,
        channelName: syncedDocument.document.channelName,
        created: syncedDocument.created,
      },
    };
  } else if (agentSpaceResourceType === "data_table") {
    const syncedTable = upsertFeishuExternalDataTableSync({
      channelName,
      agentSpaceResourceId,
      providerResourceType: descriptor.providerResourceType,
      providerResourceToken: descriptor.providerResourceToken,
      providerResourceUrl: descriptor.providerResourceUrl,
      title: input.displayName?.trim(),
      metadata: descriptor.metadata ?? {},
      createdBy: workspaceContext.currentUser.displayName,
    }, workspaceContext.currentWorkspace.id);
    agentSpaceResourceId = syncedTable.table.id;
    channelName = syncedTable.table.channelName ?? channelName;
    metadataJson = {
      ...metadataJson,
      agentSpaceSync: {
        dataTableId: syncedTable.table.id,
        channelName: syncedTable.table.channelName,
        created: syncedTable.created,
      },
    };
  }

  const binding = upsertExternalResourceBindingSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    providerResourceType: descriptor.providerResourceType,
    providerResourceToken: descriptor.providerResourceToken,
    providerResourceUrl: descriptor.providerResourceUrl,
    agentSpaceResourceType,
    agentSpaceResourceId,
    channelName,
    displayName: input.displayName?.trim(),
    status: "active",
    permissionsJson: buildFeishuResourceBindingPermissions({
      allowWrite: input.allowWrite,
      guestReadable: input.guestReadable,
    }),
    metadataJson,
    createdByUserId: workspaceContext.currentUser.id,
  });

  tryRecordWorkspaceAuditEventSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    title: "Feishu resource binding saved",
    note: `${workspaceContext.currentUser.displayName} mapped a Feishu ${descriptor.providerResourceType} resource to AgentSpace.`,
    code: "workspace.external_resource_binding_upserted",
    data: {
      actorType: "session_user",
      resourceType: "external_resource_binding",
      resourceId: binding.id,
      provider: FEISHU_PROVIDER_ID,
      integrationId: integration.id,
      providerResourceType: descriptor.providerResourceType,
      agentSpaceResourceType,
      agentSpaceResourceId,
      writeAllowed: input.allowWrite === true,
      guestReadable: input.guestReadable === true,
      externalIdRedacted: true,
    },
  });
  revalidateWorkspacePaths(workspaceContext.currentWorkspace.slug, SETTINGS_REVALIDATE_PATHS);

  return requireFeishuIntegrationSettingsItem({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    appUrl: readPublicAppUrl(),
    viewer: {
      role: workspaceContext.currentMembership.role,
      userId: workspaceContext.currentUser.id,
    },
  });
}

function buildFeishuResourceBindingPermissions(input: {
  allowWrite?: boolean;
  guestReadable?: boolean;
}): Record<string, boolean> | undefined {
  const permissions: Record<string, boolean> = {};
  if (input.allowWrite) {
    permissions.canRead = true;
    permissions.canWrite = true;
  }
  if (input.guestReadable) {
    permissions.canRead = true;
    permissions.externalGuestReadable = true;
  }
  return Object.keys(permissions).length > 0 ? permissions : undefined;
}

export async function pauseFeishuResourceBindingAction(
  input: UpdateFeishuBindingStatusInput,
): Promise<FeishuIntegrationSettingsItem> {
  return updateFeishuBindingStatusAction({
    bindingId: input.bindingId,
    bindingKind: "resource",
    status: "disabled",
    auditCode: "workspace.external_resource_binding_disabled",
    auditTitle: "Feishu resource binding disabled",
  });
}

export async function resumeFeishuResourceBindingAction(
  input: UpdateFeishuBindingStatusInput,
): Promise<FeishuIntegrationSettingsItem> {
  return updateFeishuBindingStatusAction({
    bindingId: input.bindingId,
    bindingKind: "resource",
    status: "active",
    auditCode: "workspace.external_resource_binding_resumed",
    auditTitle: "Feishu resource binding resumed",
  });
}

export async function revokeFeishuResourceBindingAction(
  input: UpdateFeishuBindingStatusInput,
): Promise<FeishuIntegrationSettingsItem> {
  return updateFeishuBindingStatusAction({
    bindingId: input.bindingId,
    bindingKind: "resource",
    status: "archived",
    auditCode: "workspace.external_resource_binding_archived",
    auditTitle: "Feishu resource binding archived",
  });
}

async function updateFeishuBindingStatusAction(input: {
  bindingId: string;
  bindingKind: "channel" | "resource" | "user";
  status: ExternalBindingStatus;
  auditCode: string;
  auditTitle: string;
}): Promise<FeishuIntegrationSettingsItem> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  let existingUserBinding:
    | ReturnType<typeof readExternalUserBindingByIdSync>
    | null = null;
  let integration: ReturnType<typeof readExternalIntegrationSync> | null = null;

  if (input.bindingKind === "user") {
    existingUserBinding = readExternalUserBindingByIdSync({
      workspaceId: workspaceContext.currentWorkspace.id,
      bindingId: input.bindingId,
    });
    if (!existingUserBinding) {
      throw new Error("feishu.user_binding.not_found");
    }
    assertCanManageFeishuUserBindingTarget({
      actorRole: workspaceContext.currentMembership.role,
      actorUserId: workspaceContext.currentUser.id,
      targetUserId: existingUserBinding.userId,
    });
    integration = readExternalIntegrationSync({
      workspaceId: workspaceContext.currentWorkspace.id,
      integrationId: existingUserBinding.integrationId,
    });
    if (!integration || integration.provider !== FEISHU_PROVIDER_ID) {
      throw new Error("feishu.integration.not_found");
    }
  } else {
    assertWorkspaceRoleForContext(workspaceContext, "admin");
  }

  const binding = updateExternalBindingStatus({
    workspaceId: workspaceContext.currentWorkspace.id,
    bindingId: input.bindingId,
    bindingKind: input.bindingKind,
    status: input.status,
  });
  integration ??= readExternalIntegrationSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: binding.integrationId,
  });
  if (!integration || integration.provider !== FEISHU_PROVIDER_ID) {
    throw new Error("feishu.integration.not_found");
  }

  tryRecordWorkspaceAuditEventSync({
    workspaceId: workspaceContext.currentWorkspace.id,
    title: input.auditTitle,
    note: `${workspaceContext.currentUser.displayName} set Feishu ${input.bindingKind} binding "${input.bindingId}" to "${input.status}".`,
    code: input.auditCode,
    data: {
      actorType: "session_user",
      resourceType: `external_${input.bindingKind}_binding`,
      resourceId: input.bindingId,
      provider: FEISHU_PROVIDER_ID,
      integrationId: integration.id,
      status: input.status,
      ...(existingUserBinding ? { userId: existingUserBinding.userId } : {}),
    },
  });
  revalidateWorkspacePaths(workspaceContext.currentWorkspace.slug, SETTINGS_REVALIDATE_PATHS);

  return requireFeishuIntegrationSettingsItem({
    workspaceId: workspaceContext.currentWorkspace.id,
    integrationId: integration.id,
    appUrl: readPublicAppUrl(),
    viewer: {
      role: workspaceContext.currentMembership.role,
      userId: workspaceContext.currentUser.id,
    },
  });
}

function updateExternalBindingStatus(input: {
  workspaceId: string;
  bindingId: string;
  bindingKind: "channel" | "resource" | "user";
  status: ExternalBindingStatus;
}): { id: string; integrationId: string } {
  if (input.bindingKind === "channel") {
    return updateExternalChannelBindingStatusSync({
      workspaceId: input.workspaceId,
      bindingId: input.bindingId,
      status: input.status,
    });
  }
  if (input.bindingKind === "resource") {
    return updateExternalResourceBindingStatusSync({
      workspaceId: input.workspaceId,
      bindingId: input.bindingId,
      status: input.status,
    });
  }
  return updateExternalUserBindingStatusSync({
    workspaceId: input.workspaceId,
    bindingId: input.bindingId,
    status: input.status,
  });
}

function requireFeishuIntegrationSettingsItem(input: {
  workspaceId: string;
  integrationId: string;
  appUrl?: string;
  viewer?: {
    role: WorkspaceRole;
    userId: string;
  };
}): FeishuIntegrationSettingsItem {
  const item = listFeishuIntegrationSettingsItems({
    workspaceId: input.workspaceId,
    appUrl: input.appUrl,
    viewer: input.viewer,
  }).find((candidate) => candidate.id === input.integrationId);
  if (!item) {
    throw new Error("feishu.integration.not_found");
  }
  if (!canManageFeishuIntegrations(input.viewer?.role)) {
    return item;
  }
  return {
    ...item,
    callbackUrl: buildFeishuEventCallbackUrl(input),
  };
}

function requireActiveFeishuIntegration(input: {
  workspaceId: string;
  integrationId: string;
}) {
  const integration = readExternalIntegrationSync({
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
  });
  if (!integration || integration.provider !== FEISHU_PROVIDER_ID) {
    throw new Error("feishu.integration.not_found");
  }
  if (integration.status === "disabled") {
    throw new Error("feishu.integration.disabled");
  }
  return integration;
}

function resolveFeishuResourceDescriptor(
  providerResourceType: string,
  value: string,
) {
  return resolveFeishuResourceDescriptorForType(providerResourceType, value);
}
