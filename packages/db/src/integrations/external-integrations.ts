import { DEFAULT_WORKSPACE_ID, getDatabase, randomLikeId } from "../database.ts";
import type {
  ExternalBindingStatus,
  ExternalChannelBindingRecord,
  ExternalChannelBindingSyncMode,
  ExternalDataOperationActorType,
  ExternalDataOperationRunRecord,
  ExternalDataOperationRunStatus,
  ExternalIntegrationEventRecord,
  ExternalIntegrationEventStatus,
  ExternalIntegrationHealthStatus,
  ExternalIntegrationProvider,
  ExternalIntegrationRecord,
  ExternalIntegrationStatus,
  ExternalIntegrationTransportMode,
  ExternalMessageDirection,
  ExternalMessageMappingRecord,
  ExternalMessageOutboxRecord,
  ExternalMessageOutboxStatus,
  ExternalResourceBindingAgentSpaceType,
  ExternalResourceBindingProviderType,
  ExternalResourceBindingRecord,
  ExternalUserBindingRecord,
} from "../types.ts";

type JsonInput = string | Record<string, unknown> | unknown[] | undefined;

const DEFAULT_JSON_OBJECT = "{}";
const DEFAULT_JSON_ARRAY = "[]";

export function createExternalIntegrationSync(input: {
  workspaceId?: string;
  provider: ExternalIntegrationProvider;
  displayName: string;
  transportMode: ExternalIntegrationTransportMode;
  appId?: string;
  tenantKey?: string;
  encryptedCredentialsJson?: JsonInput;
  configJson?: JsonInput;
  capabilitiesJson?: JsonInput;
  scopesJson?: JsonInput;
  createdByUserId?: string;
}): ExternalIntegrationRecord {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const provider = normalizeRequiredText(input.provider, "External integration provider is required.");
  const displayName = normalizeRequiredText(input.displayName, "External integration display name is required.");
  const appId = normalizeOptionalText(input.appId);
  const tenantKey = normalizeOptionalText(input.tenantKey);
  assertExternalIntegrationAppTenantUnique({
    workspaceId,
    provider,
    appId,
    tenantKey,
  });
  const id = `external-integration-${randomLikeId()}`;
  const now = new Date().toISOString();

  getDatabase().prepare(
    `INSERT INTO external_integration (
       id,
       workspace_id,
       provider,
       display_name,
       status,
       transport_mode,
       app_id,
       tenant_key,
       encrypted_credentials_json,
       config_json,
       capabilities_json,
       scopes_json,
       created_by_user_id,
       updated_by_user_id,
       created_at,
       updated_at,
       last_health_status
     ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown')`,
  ).run(
    id,
    workspaceId,
    provider,
    displayName,
    input.transportMode,
    appId,
    tenantKey,
    normalizeJsonInput(input.encryptedCredentialsJson, DEFAULT_JSON_OBJECT),
    normalizeJsonInput(input.configJson, DEFAULT_JSON_OBJECT),
    normalizeJsonInput(input.capabilitiesJson, DEFAULT_JSON_OBJECT),
    normalizeJsonInput(input.scopesJson, DEFAULT_JSON_ARRAY),
    normalizeOptionalText(input.createdByUserId),
    normalizeOptionalText(input.createdByUserId),
    now,
    now,
  );

  const record = readExternalIntegrationSync({ workspaceId, integrationId: id });
  if (!record) {
    throw new Error("External integration could not be read back.");
  }
  return record;
}

export function readExternalIntegrationSync(input: {
  workspaceId?: string;
  integrationId: string;
}): ExternalIntegrationRecord | null {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const row = getDatabase().prepare(
    `${selectExternalIntegrationSql()}
     WHERE workspace_id = ? AND id = ?`,
  ).get(workspaceId, input.integrationId.trim()) as Record<string, unknown> | undefined;

  return row ? mapExternalIntegrationRecord(row) : null;
}

export function listExternalIntegrationsSync(options: {
  workspaceId?: string;
  provider?: ExternalIntegrationProvider;
  includeDisabled?: boolean;
} = {}): ExternalIntegrationRecord[] {
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const where = ["workspace_id = ?"];
  const params: unknown[] = [workspaceId];
  if (options.provider) {
    where.push("provider = ?");
    params.push(options.provider);
  }
  if (!options.includeDisabled) {
    where.push("status <> 'disabled'");
  }

  const rows = getDatabase().prepare(
    `${selectExternalIntegrationSql()}
     WHERE ${where.join(" AND ")}
     ORDER BY updated_at DESC, id DESC`,
  ).all(...params) as Array<Record<string, unknown>>;

  return rows.map(mapExternalIntegrationRecord).filter((record): record is ExternalIntegrationRecord => record !== null);
}

export function deleteExternalIntegrationSync(input: {
  workspaceId?: string;
  integrationId: string;
}): ExternalIntegrationRecord {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const record = requireExternalIntegration({ workspaceId, integrationId: input.integrationId });
  getDatabase().prepare(
    `DELETE FROM external_integration
     WHERE workspace_id = ? AND id = ?`,
  ).run(workspaceId, input.integrationId.trim());
  return record;
}

export function updateExternalIntegrationStatusSync(input: {
  workspaceId?: string;
  integrationId: string;
  status: ExternalIntegrationStatus;
  updatedByUserId?: string;
  lastError?: string;
}): ExternalIntegrationRecord {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const now = new Date().toISOString();
  const result = getDatabase().prepare(
    `UPDATE external_integration
     SET status = ?,
         updated_by_user_id = ?,
         updated_at = ?,
         disabled_at = CASE WHEN ? = 'disabled' THEN COALESCE(disabled_at, ?) ELSE NULL END,
         last_error = ?
     WHERE workspace_id = ? AND id = ?`,
  ).run(
    input.status,
    normalizeOptionalText(input.updatedByUserId),
    now,
    input.status,
    now,
    normalizeOptionalText(input.lastError),
    workspaceId,
    input.integrationId.trim(),
  );

  if (result.changes === 0) {
    throw new Error("External integration does not exist.");
  }
  return requireExternalIntegration({ workspaceId, integrationId: input.integrationId });
}

export function updateExternalIntegrationHealthSync(input: {
  workspaceId?: string;
  integrationId: string;
  lastHealthStatus: ExternalIntegrationHealthStatus;
  lastError?: string;
}): ExternalIntegrationRecord {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const now = new Date().toISOString();
  const result = getDatabase().prepare(
    `UPDATE external_integration
     SET last_health_status = ?,
         last_health_checked_at = ?,
         last_error = ?,
         updated_at = ?
     WHERE workspace_id = ? AND id = ?`,
  ).run(
    input.lastHealthStatus,
    now,
    normalizeOptionalText(input.lastError),
    now,
    workspaceId,
    input.integrationId.trim(),
  );

  if (result.changes === 0) {
    throw new Error("External integration does not exist.");
  }
  return requireExternalIntegration({ workspaceId, integrationId: input.integrationId });
}

export function updateExternalIntegrationCredentialsSync(input: {
  workspaceId?: string;
  integrationId: string;
  appId?: string;
  tenantKey?: string;
  encryptedCredentialsJson: JsonInput;
  updatedByUserId?: string;
}): ExternalIntegrationRecord {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const integration = requireExternalIntegration({ workspaceId, integrationId: input.integrationId });
  const appId = normalizeOptionalText(input.appId);
  const tenantKey = normalizeOptionalText(input.tenantKey);
  assertExternalIntegrationAppTenantUnique({
    workspaceId,
    provider: integration.provider,
    appId,
    tenantKey,
    excludeIntegrationId: integration.id,
  });
  const now = new Date().toISOString();
  const result = getDatabase().prepare(
    `UPDATE external_integration
     SET app_id = ?,
         tenant_key = ?,
         encrypted_credentials_json = ?,
         updated_by_user_id = ?,
         updated_at = ?,
         last_health_status = 'unknown',
         last_health_checked_at = NULL,
         last_error = NULL
     WHERE workspace_id = ? AND id = ?`,
  ).run(
    appId,
    tenantKey,
    normalizeJsonInput(input.encryptedCredentialsJson, DEFAULT_JSON_OBJECT),
    normalizeOptionalText(input.updatedByUserId),
    now,
    workspaceId,
    input.integrationId.trim(),
  );

  if (result.changes === 0) {
    throw new Error("External integration does not exist.");
  }
  return requireExternalIntegration({ workspaceId, integrationId: input.integrationId });
}

export function upsertExternalUserBindingSync(input: {
  workspaceId?: string;
  integrationId: string;
  userId: string;
  externalUserId: string;
  externalUnionId?: string;
  externalOpenId?: string;
  externalEmail?: string;
  displayName?: string;
  status?: ExternalBindingStatus;
  metadataJson?: JsonInput;
  lastSeenAt?: string;
}): ExternalUserBindingRecord {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const integrationId = normalizeRequiredText(input.integrationId, "External user binding integration id is required.");
  const userId = normalizeRequiredText(input.userId, "External user binding user id is required.");
  const externalUserId = normalizeRequiredText(input.externalUserId, "External user binding external user id is required.");
  const id = `external-user-binding-${randomLikeId()}`;
  const now = new Date().toISOString();

  getDatabase().prepare(
    `INSERT INTO external_user_binding (
       id,
       workspace_id,
       integration_id,
       user_id,
       external_user_id,
       external_union_id,
       external_open_id,
       external_email,
       display_name,
       status,
       metadata_json,
       created_at,
       updated_at,
       last_seen_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(integration_id, user_id)
     DO UPDATE SET
       external_user_id = EXCLUDED.external_user_id,
       external_union_id = EXCLUDED.external_union_id,
       external_open_id = EXCLUDED.external_open_id,
       external_email = EXCLUDED.external_email,
       display_name = EXCLUDED.display_name,
       status = EXCLUDED.status,
       metadata_json = EXCLUDED.metadata_json,
       updated_at = EXCLUDED.updated_at,
       last_seen_at = EXCLUDED.last_seen_at`,
  ).run(
    id,
    workspaceId,
    integrationId,
    userId,
    externalUserId,
    normalizeOptionalText(input.externalUnionId),
    normalizeOptionalText(input.externalOpenId),
    normalizeOptionalEmail(input.externalEmail),
    normalizeOptionalText(input.displayName),
    input.status ?? "active",
    normalizeJsonInput(input.metadataJson, DEFAULT_JSON_OBJECT),
    now,
    now,
    normalizeOptionalText(input.lastSeenAt),
  );

  const record = readExternalUserBindingSync({ workspaceId, integrationId, userId });
  if (!record) {
    throw new Error("External user binding could not be read back.");
  }
  return record;
}

export function readExternalUserBindingSync(input: {
  workspaceId?: string;
  integrationId: string;
  userId: string;
}): ExternalUserBindingRecord | null {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const row = getDatabase().prepare(
    `${selectExternalUserBindingSql()}
     WHERE workspace_id = ? AND integration_id = ? AND user_id = ?`,
  ).get(workspaceId, input.integrationId.trim(), input.userId.trim()) as Record<string, unknown> | undefined;

  return row ? mapExternalUserBindingRecord(row) : null;
}

export function readExternalUserBindingByExternalUserSync(input: {
  workspaceId?: string;
  integrationId: string;
  externalUserId: string;
}): ExternalUserBindingRecord | null {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const row = getDatabase().prepare(
    `${selectExternalUserBindingSql()}
     WHERE workspace_id = ? AND integration_id = ? AND external_user_id = ?`,
  ).get(workspaceId, input.integrationId.trim(), input.externalUserId.trim()) as Record<string, unknown> | undefined;

  return row ? mapExternalUserBindingRecord(row) : null;
}

export function readExternalUserBindingByIdSync(input: {
  workspaceId?: string;
  bindingId: string;
}): ExternalUserBindingRecord | null {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const row = getDatabase().prepare(
    `${selectExternalUserBindingSql()}
     WHERE workspace_id = ? AND id = ?`,
  ).get(workspaceId, input.bindingId.trim()) as Record<string, unknown> | undefined;

  return row ? mapExternalUserBindingRecord(row) : null;
}

export function listExternalUserBindingsSync(options: {
  workspaceId?: string;
  integrationId: string;
  status?: ExternalBindingStatus;
}): ExternalUserBindingRecord[] {
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const where = ["workspace_id = ?", "integration_id = ?"];
  const params: unknown[] = [workspaceId, options.integrationId.trim()];
  if (options.status) {
    where.push("status = ?");
    params.push(options.status);
  }

  const rows = getDatabase().prepare(
    `${selectExternalUserBindingSql()}
     WHERE ${where.join(" AND ")}
     ORDER BY updated_at DESC, id DESC`,
  ).all(...params) as Array<Record<string, unknown>>;

  return rows.map(mapExternalUserBindingRecord).filter((record): record is ExternalUserBindingRecord => record !== null);
}

export function updateExternalUserBindingStatusSync(input: {
  workspaceId?: string;
  bindingId: string;
  status: ExternalBindingStatus;
}): ExternalUserBindingRecord {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const now = new Date().toISOString();
  const result = getDatabase().prepare(
    `UPDATE external_user_binding
     SET status = ?,
         updated_at = ?,
         last_seen_at = CASE WHEN ? = 'active' THEN last_seen_at ELSE NULL END
     WHERE workspace_id = ? AND id = ?`,
  ).run(input.status, now, input.status, workspaceId, input.bindingId.trim());

  if (result.changes === 0) {
    throw new Error("External user binding does not exist.");
  }
  return requireExternalUserBinding({ workspaceId, bindingId: input.bindingId });
}

export function upsertExternalChannelBindingSync(input: {
  workspaceId?: string;
  integrationId: string;
  channelName: string;
  externalChatId: string;
  externalChatType?: string;
  externalChatName?: string;
  status?: ExternalBindingStatus;
  syncMode?: ExternalChannelBindingSyncMode;
  metadataJson?: JsonInput;
  createdByUserId?: string;
}): ExternalChannelBindingRecord {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const integrationId = normalizeRequiredText(input.integrationId, "External channel binding integration id is required.");
  const channelName = normalizeRequiredText(input.channelName, "External channel binding channel name is required.");
  const externalChatId = normalizeRequiredText(input.externalChatId, "External channel binding external chat id is required.");
  const id = `external-channel-binding-${randomLikeId()}`;
  const now = new Date().toISOString();

  getDatabase().prepare(
    `INSERT INTO external_channel_binding (
       id,
       workspace_id,
       integration_id,
       channel_name,
       external_chat_id,
       external_chat_type,
       external_chat_name,
       status,
       sync_mode,
       metadata_json,
       created_by_user_id,
       created_at,
       updated_at,
       disabled_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(integration_id, channel_name)
     DO UPDATE SET
       external_chat_id = EXCLUDED.external_chat_id,
       external_chat_type = EXCLUDED.external_chat_type,
       external_chat_name = EXCLUDED.external_chat_name,
       status = EXCLUDED.status,
       sync_mode = EXCLUDED.sync_mode,
       metadata_json = EXCLUDED.metadata_json,
       updated_at = EXCLUDED.updated_at,
       disabled_at = CASE WHEN EXCLUDED.status = 'disabled' THEN COALESCE(external_channel_binding.disabled_at, EXCLUDED.updated_at) ELSE NULL END`,
  ).run(
    id,
    workspaceId,
    integrationId,
    channelName,
    externalChatId,
    normalizeOptionalText(input.externalChatType),
    normalizeOptionalText(input.externalChatName),
    input.status ?? "active",
    input.syncMode ?? "mirror",
    normalizeJsonInput(input.metadataJson, DEFAULT_JSON_OBJECT),
    normalizeOptionalText(input.createdByUserId),
    now,
    now,
  );

  const record = readExternalChannelBindingSync({ workspaceId, integrationId, channelName });
  if (!record) {
    throw new Error("External channel binding could not be read back.");
  }
  return record;
}

export function readExternalChannelBindingSync(input: {
  workspaceId?: string;
  integrationId: string;
  channelName: string;
}): ExternalChannelBindingRecord | null {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const row = getDatabase().prepare(
    `${selectExternalChannelBindingSql()}
     WHERE workspace_id = ? AND integration_id = ? AND channel_name = ?`,
  ).get(workspaceId, input.integrationId.trim(), input.channelName.trim()) as Record<string, unknown> | undefined;

  return row ? mapExternalChannelBindingRecord(row) : null;
}

export function readExternalChannelBindingByExternalChatSync(input: {
  workspaceId?: string;
  integrationId: string;
  externalChatId: string;
}): ExternalChannelBindingRecord | null {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const row = getDatabase().prepare(
    `${selectExternalChannelBindingSql()}
     WHERE workspace_id = ? AND integration_id = ? AND external_chat_id = ?`,
  ).get(workspaceId, input.integrationId.trim(), input.externalChatId.trim()) as Record<string, unknown> | undefined;

  return row ? mapExternalChannelBindingRecord(row) : null;
}

export function listExternalChannelBindingsSync(options: {
  workspaceId?: string;
  integrationId: string;
  status?: ExternalBindingStatus;
}): ExternalChannelBindingRecord[] {
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const where = ["workspace_id = ?", "integration_id = ?"];
  const params: unknown[] = [workspaceId, options.integrationId.trim()];
  if (options.status) {
    where.push("status = ?");
    params.push(options.status);
  }

  const rows = getDatabase().prepare(
    `${selectExternalChannelBindingSql()}
     WHERE ${where.join(" AND ")}
     ORDER BY updated_at DESC, channel_name ASC`,
  ).all(...params) as Array<Record<string, unknown>>;

  return rows.map(mapExternalChannelBindingRecord).filter((record): record is ExternalChannelBindingRecord => record !== null);
}

export function updateExternalChannelBindingStatusSync(input: {
  workspaceId?: string;
  bindingId: string;
  status: ExternalBindingStatus;
}): ExternalChannelBindingRecord {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const now = new Date().toISOString();
  const result = getDatabase().prepare(
    `UPDATE external_channel_binding
     SET status = ?,
         updated_at = ?,
         disabled_at = CASE WHEN ? = 'disabled' THEN COALESCE(disabled_at, ?) ELSE NULL END
     WHERE workspace_id = ? AND id = ?`,
  ).run(input.status, now, input.status, now, workspaceId, input.bindingId.trim());

  if (result.changes === 0) {
    throw new Error("External channel binding does not exist.");
  }
  return requireExternalChannelBinding({ workspaceId, bindingId: input.bindingId });
}

export function upsertExternalResourceBindingSync(input: {
  workspaceId?: string;
  integrationId: string;
  providerResourceType: ExternalResourceBindingProviderType;
  providerResourceToken: string;
  providerResourceUrl?: string;
  agentSpaceResourceType: ExternalResourceBindingAgentSpaceType;
  agentSpaceResourceId: string;
  channelName?: string;
  displayName?: string;
  status?: ExternalBindingStatus;
  permissionsJson?: JsonInput;
  metadataJson?: JsonInput;
  createdByUserId?: string;
}): ExternalResourceBindingRecord {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const integrationId = normalizeRequiredText(input.integrationId, "External resource binding integration id is required.");
  const providerResourceType = normalizeRequiredText(input.providerResourceType, "External resource provider type is required.");
  const providerResourceToken = normalizeRequiredText(input.providerResourceToken, "External resource token is required.");
  const agentSpaceResourceType = normalizeRequiredText(input.agentSpaceResourceType, "AgentSpace resource type is required.");
  const agentSpaceResourceId = normalizeRequiredText(input.agentSpaceResourceId, "AgentSpace resource id is required.");
  const id = `external-resource-binding-${randomLikeId()}`;
  const now = new Date().toISOString();

  getDatabase().prepare(
    `INSERT INTO external_resource_binding (
       id,
       workspace_id,
       integration_id,
       provider_resource_type,
       provider_resource_token,
       provider_resource_url,
       agent_space_resource_type,
       agent_space_resource_id,
       channel_name,
       display_name,
       status,
       permissions_json,
       metadata_json,
       created_by_user_id,
       created_at,
       updated_at,
       archived_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(integration_id, provider_resource_type, provider_resource_token)
     DO UPDATE SET
       provider_resource_url = EXCLUDED.provider_resource_url,
       agent_space_resource_type = EXCLUDED.agent_space_resource_type,
       agent_space_resource_id = EXCLUDED.agent_space_resource_id,
       channel_name = EXCLUDED.channel_name,
       display_name = EXCLUDED.display_name,
       status = EXCLUDED.status,
       permissions_json = EXCLUDED.permissions_json,
       metadata_json = EXCLUDED.metadata_json,
       updated_at = EXCLUDED.updated_at,
       archived_at = CASE WHEN EXCLUDED.status = 'archived' THEN COALESCE(external_resource_binding.archived_at, EXCLUDED.updated_at) ELSE NULL END`,
  ).run(
    id,
    workspaceId,
    integrationId,
    providerResourceType,
    providerResourceToken,
    normalizeOptionalText(input.providerResourceUrl),
    agentSpaceResourceType,
    agentSpaceResourceId,
    normalizeOptionalText(input.channelName),
    normalizeOptionalText(input.displayName),
    input.status ?? "active",
    normalizeJsonInput(input.permissionsJson, DEFAULT_JSON_OBJECT),
    normalizeJsonInput(input.metadataJson, DEFAULT_JSON_OBJECT),
    normalizeOptionalText(input.createdByUserId),
    now,
    now,
  );

  const record = readExternalResourceBindingByKeySync({
    workspaceId,
    integrationId,
    providerResourceType,
    providerResourceToken,
  });
  if (!record) {
    throw new Error("External resource binding could not be read back.");
  }
  return record;
}

export function readExternalResourceBindingByKeySync(input: {
  workspaceId?: string;
  integrationId: string;
  providerResourceType: ExternalResourceBindingProviderType;
  providerResourceToken: string;
}): ExternalResourceBindingRecord | null {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const row = getDatabase().prepare(
    `${selectExternalResourceBindingSql()}
     WHERE workspace_id = ?
       AND integration_id = ?
       AND provider_resource_type = ?
       AND provider_resource_token = ?`,
  ).get(
    workspaceId,
    input.integrationId.trim(),
    input.providerResourceType.trim(),
    input.providerResourceToken.trim(),
  ) as Record<string, unknown> | undefined;

  return row ? mapExternalResourceBindingRecord(row) : null;
}

export function listExternalResourceBindingsSync(options: {
  workspaceId?: string;
  integrationId: string;
  channelName?: string;
  status?: ExternalBindingStatus;
}): ExternalResourceBindingRecord[] {
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const where = ["workspace_id = ?", "integration_id = ?"];
  const params: unknown[] = [workspaceId, options.integrationId.trim()];
  if (options.channelName?.trim()) {
    where.push("channel_name = ?");
    params.push(options.channelName.trim());
  }
  if (options.status) {
    where.push("status = ?");
    params.push(options.status);
  }

  const rows = getDatabase().prepare(
    `${selectExternalResourceBindingSql()}
     WHERE ${where.join(" AND ")}
     ORDER BY updated_at DESC, id DESC`,
  ).all(...params) as Array<Record<string, unknown>>;

  return rows.map(mapExternalResourceBindingRecord).filter((record): record is ExternalResourceBindingRecord => record !== null);
}

export function updateExternalResourceBindingStatusSync(input: {
  workspaceId?: string;
  bindingId: string;
  status: ExternalBindingStatus;
}): ExternalResourceBindingRecord {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const now = new Date().toISOString();
  const result = getDatabase().prepare(
    `UPDATE external_resource_binding
     SET status = ?,
         updated_at = ?,
         archived_at = CASE WHEN ? = 'archived' THEN COALESCE(archived_at, ?) ELSE NULL END
     WHERE workspace_id = ? AND id = ?`,
  ).run(input.status, now, input.status, now, workspaceId, input.bindingId.trim());

  if (result.changes === 0) {
    throw new Error("External resource binding does not exist.");
  }
  return requireExternalResourceBinding({ workspaceId, bindingId: input.bindingId });
}

export function createExternalMessageMappingSync(input: {
  workspaceId?: string;
  integrationId: string;
  channelBindingId?: string;
  direction: ExternalMessageDirection;
  externalMessageId: string;
  externalThreadId?: string;
  externalSenderId?: string;
  externalEventId?: string;
  agentSpaceMessageId?: string;
  taskQueueId?: string;
  routerSessionId?: string;
  metadataJson?: JsonInput;
}): ExternalMessageMappingRecord {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const integrationId = normalizeRequiredText(input.integrationId, "External message mapping integration id is required.");
  const externalMessageId = normalizeRequiredText(input.externalMessageId, "External message id is required.");
  const id = `external-message-mapping-${randomLikeId()}`;
  const now = new Date().toISOString();

  getDatabase().prepare(
    `INSERT INTO external_message_mapping (
       id,
       workspace_id,
       integration_id,
       channel_binding_id,
       direction,
       external_message_id,
       external_thread_id,
       external_sender_id,
       external_event_id,
       agent_space_message_id,
       task_queue_id,
       router_session_id,
       metadata_json,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(integration_id, external_message_id)
     DO UPDATE SET
       channel_binding_id = COALESCE(EXCLUDED.channel_binding_id, external_message_mapping.channel_binding_id),
       external_thread_id = COALESCE(EXCLUDED.external_thread_id, external_message_mapping.external_thread_id),
       external_sender_id = COALESCE(EXCLUDED.external_sender_id, external_message_mapping.external_sender_id),
       external_event_id = COALESCE(EXCLUDED.external_event_id, external_message_mapping.external_event_id),
       agent_space_message_id = COALESCE(EXCLUDED.agent_space_message_id, external_message_mapping.agent_space_message_id),
       task_queue_id = COALESCE(EXCLUDED.task_queue_id, external_message_mapping.task_queue_id),
       router_session_id = COALESCE(EXCLUDED.router_session_id, external_message_mapping.router_session_id),
       metadata_json = EXCLUDED.metadata_json`,
  ).run(
    id,
    workspaceId,
    integrationId,
    normalizeOptionalText(input.channelBindingId),
    input.direction,
    externalMessageId,
    normalizeOptionalText(input.externalThreadId),
    normalizeOptionalText(input.externalSenderId),
    normalizeOptionalText(input.externalEventId),
    normalizeOptionalText(input.agentSpaceMessageId),
    normalizeOptionalText(input.taskQueueId),
    normalizeOptionalText(input.routerSessionId),
    normalizeJsonInput(input.metadataJson, DEFAULT_JSON_OBJECT),
    now,
  );

  const record = readExternalMessageMappingByExternalMessageSync({ workspaceId, integrationId, externalMessageId });
  if (!record) {
    throw new Error("External message mapping could not be read back.");
  }
  return record;
}

export function readExternalMessageMappingByExternalMessageSync(input: {
  workspaceId?: string;
  integrationId: string;
  externalMessageId: string;
}): ExternalMessageMappingRecord | null {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const row = getDatabase().prepare(
    `${selectExternalMessageMappingSql()}
     WHERE workspace_id = ? AND integration_id = ? AND external_message_id = ?`,
  ).get(workspaceId, input.integrationId.trim(), input.externalMessageId.trim()) as Record<string, unknown> | undefined;

  return row ? mapExternalMessageMappingRecord(row) : null;
}

export function readExternalMessageMappingByAgentSpaceMessageSync(input: {
  workspaceId?: string;
  integrationId?: string;
  agentSpaceMessageId: string;
  direction?: ExternalMessageDirection;
}): ExternalMessageMappingRecord | null {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const where = ["workspace_id = ?", "agent_space_message_id = ?"];
  const params: unknown[] = [workspaceId, input.agentSpaceMessageId.trim()];
  if (input.integrationId?.trim()) {
    where.push("integration_id = ?");
    params.push(input.integrationId.trim());
  }
  if (input.direction) {
    where.push("direction = ?");
    params.push(input.direction);
  }

  const row = getDatabase().prepare(
    `${selectExternalMessageMappingSql()}
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
  ).get(...params) as Record<string, unknown> | undefined;

  return row ? mapExternalMessageMappingRecord(row) : null;
}

export function listExternalMessageMappingsSync(options: {
  workspaceId?: string;
  integrationId?: string;
  direction?: ExternalMessageDirection;
  limit?: number;
} = {}): ExternalMessageMappingRecord[] {
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const where = ["workspace_id = ?"];
  const params: unknown[] = [workspaceId];
  if (options.integrationId?.trim()) {
    where.push("integration_id = ?");
    params.push(options.integrationId.trim());
  }
  if (options.direction) {
    where.push("direction = ?");
    params.push(options.direction);
  }
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const rows = getDatabase().prepare(
    `${selectExternalMessageMappingSql()}
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC, id DESC
     LIMIT ${limit}`,
  ).all(...params) as Array<Record<string, unknown>>;

  return rows.map(mapExternalMessageMappingRecord).filter((record): record is ExternalMessageMappingRecord => record !== null);
}

export function createExternalMessageOutboxSync(input: {
  workspaceId?: string;
  integrationId: string;
  channelBindingId?: string;
  targetExternalChatId: string;
  targetExternalThreadId?: string;
  agentSpaceMessageId?: string;
  payloadJson: JsonInput;
  nextAttemptAt?: string;
}): ExternalMessageOutboxRecord {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const integrationId = normalizeRequiredText(input.integrationId, "External message outbox integration id is required.");
  const targetExternalChatId = normalizeRequiredText(input.targetExternalChatId, "External message outbox target chat id is required.");
  const id = `external-message-outbox-${randomLikeId()}`;
  const now = new Date().toISOString();

  getDatabase().prepare(
    `INSERT INTO external_message_outbox (
       id,
       workspace_id,
       integration_id,
       channel_binding_id,
       target_external_chat_id,
       target_external_thread_id,
       agent_space_message_id,
       payload_json,
       status,
       attempts,
       next_attempt_at,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
  ).run(
    id,
    workspaceId,
    integrationId,
    normalizeOptionalText(input.channelBindingId),
    targetExternalChatId,
    normalizeOptionalText(input.targetExternalThreadId),
    normalizeOptionalText(input.agentSpaceMessageId),
    normalizeJsonInput(input.payloadJson, DEFAULT_JSON_OBJECT),
    normalizeOptionalText(input.nextAttemptAt),
    now,
    now,
  );

  return requireExternalMessageOutbox({ workspaceId, outboxId: id });
}

export function readExternalMessageOutboxSync(input: {
  workspaceId?: string;
  outboxId: string;
}): ExternalMessageOutboxRecord | null {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const row = getDatabase().prepare(
    `${selectExternalMessageOutboxSql()}
     WHERE workspace_id = ? AND id = ?`,
  ).get(workspaceId, input.outboxId.trim()) as Record<string, unknown> | undefined;

  return row ? mapExternalMessageOutboxRecord(row) : null;
}

export function listPendingExternalMessageOutboxSync(options: {
  workspaceId?: string;
  integrationId?: string;
  now?: string;
  limit?: number;
} = {}): ExternalMessageOutboxRecord[] {
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const dueAt = options.now ?? new Date().toISOString();
  const where = [
    "workspace_id = ?",
    "status = 'pending'",
    "(next_attempt_at IS NULL OR next_attempt_at <= ?)",
  ];
  const params: unknown[] = [workspaceId, dueAt];
  if (options.integrationId?.trim()) {
    where.push("integration_id = ?");
    params.push(options.integrationId.trim());
  }
  const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
  const rows = getDatabase().prepare(
    `${selectExternalMessageOutboxSql()}
     WHERE ${where.join(" AND ")}
     ORDER BY COALESCE(next_attempt_at, created_at) ASC, created_at ASC, id ASC
     LIMIT ${limit}`,
  ).all(...params) as Array<Record<string, unknown>>;

  return rows.map(mapExternalMessageOutboxRecord).filter((record): record is ExternalMessageOutboxRecord => record !== null);
}

export function listExternalMessageOutboxSync(options: {
  workspaceId?: string;
  integrationId?: string;
  status?: ExternalMessageOutboxStatus;
  limit?: number;
} = {}): ExternalMessageOutboxRecord[] {
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const where = ["workspace_id = ?"];
  const params: unknown[] = [workspaceId];
  if (options.integrationId?.trim()) {
    where.push("integration_id = ?");
    params.push(options.integrationId.trim());
  }
  if (options.status) {
    where.push("status = ?");
    params.push(options.status);
  }
  const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
  const rows = getDatabase().prepare(
    `${selectExternalMessageOutboxSql()}
     WHERE ${where.join(" AND ")}
     ORDER BY updated_at DESC, created_at DESC, id DESC
     LIMIT ${limit}`,
  ).all(...params) as Array<Record<string, unknown>>;

  return rows.map(mapExternalMessageOutboxRecord).filter((record): record is ExternalMessageOutboxRecord => record !== null);
}

export function markExternalMessageOutboxLockedSync(input: {
  workspaceId?: string;
  outboxId: string;
  lockedBy: string;
}): ExternalMessageOutboxRecord {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const now = new Date().toISOString();
  const result = getDatabase().prepare(
    `UPDATE external_message_outbox
     SET status = 'locked',
         attempts = attempts + 1,
         locked_at = ?,
         locked_by = ?,
         updated_at = ?
     WHERE workspace_id = ? AND id = ? AND status = 'pending'`,
  ).run(now, normalizeRequiredText(input.lockedBy, "External message outbox lock owner is required."), now, workspaceId, input.outboxId.trim());

  if (result.changes === 0) {
    throw new Error("External message outbox item is not pending or does not exist.");
  }
  return requireExternalMessageOutbox({ workspaceId, outboxId: input.outboxId });
}

export function completeExternalMessageOutboxSync(input: {
  workspaceId?: string;
  outboxId: string;
}): ExternalMessageOutboxRecord {
  return updateExternalMessageOutboxTerminalStatus({
    workspaceId: input.workspaceId,
    outboxId: input.outboxId,
    status: "sent",
    sentAt: new Date().toISOString(),
  });
}

export function failExternalMessageOutboxSync(input: {
  workspaceId?: string;
  outboxId: string;
  lastError: string;
  nextAttemptAt?: string;
  terminal?: boolean;
}): ExternalMessageOutboxRecord {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const now = new Date().toISOString();
  const status: ExternalMessageOutboxStatus = input.terminal ? "failed" : "pending";
  const result = getDatabase().prepare(
    `UPDATE external_message_outbox
     SET status = ?,
         locked_at = NULL,
         locked_by = NULL,
         last_error = ?,
         next_attempt_at = ?,
         updated_at = ?
     WHERE workspace_id = ? AND id = ?`,
  ).run(
    status,
    normalizeRequiredText(input.lastError, "External message outbox failure reason is required."),
    normalizeOptionalText(input.nextAttemptAt),
    now,
    workspaceId,
    input.outboxId.trim(),
  );

  if (result.changes === 0) {
    throw new Error("External message outbox item does not exist.");
  }
  return requireExternalMessageOutbox({ workspaceId, outboxId: input.outboxId });
}

export function cancelExternalMessageOutboxForIntegrationSync(input: {
  workspaceId?: string;
  integrationId: string;
  reason?: string;
}): number {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const integrationId = normalizeRequiredText(input.integrationId, "External message outbox integration id is required.");
  const now = new Date().toISOString();
  const reason = normalizeOptionalText(input.reason);
  const result = getDatabase().prepare(
    `UPDATE external_message_outbox
     SET status = 'cancelled',
         locked_at = NULL,
         locked_by = NULL,
         last_error = COALESCE(?, last_error),
         next_attempt_at = NULL,
         updated_at = ?
     WHERE workspace_id = ?
       AND integration_id = ?
       AND status IN ('pending', 'locked')`,
  ).run(reason, now, workspaceId, integrationId);

  return result.changes;
}

export function createExternalDataOperationRunSync(input: {
  workspaceId?: string;
  integrationId: string;
  resourceBindingId?: string;
  operationType: string;
  providerResourceType: ExternalResourceBindingProviderType;
  providerResourceToken: string;
  actorType: ExternalDataOperationActorType;
  actorId?: string;
  status?: ExternalDataOperationRunStatus;
  requestJson?: JsonInput;
}): ExternalDataOperationRunRecord {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const id = `external-data-operation-${randomLikeId()}`;
  const now = new Date().toISOString();
  const status = input.status ?? "pending";
  const startedAt = status === "running" ? now : null;

  getDatabase().prepare(
    `INSERT INTO external_data_operation_run (
       id,
       workspace_id,
       integration_id,
       resource_binding_id,
       operation_type,
       provider_resource_type,
       provider_resource_token,
       actor_type,
       actor_id,
       status,
       request_json,
       result_json,
       started_at,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
  ).run(
    id,
    workspaceId,
    normalizeRequiredText(input.integrationId, "External data operation integration id is required."),
    normalizeOptionalText(input.resourceBindingId),
    normalizeRequiredText(input.operationType, "External data operation type is required."),
    normalizeRequiredText(input.providerResourceType, "External data operation provider resource type is required."),
    normalizeRequiredText(input.providerResourceToken, "External data operation provider resource token is required."),
    input.actorType,
    normalizeOptionalText(input.actorId),
    status,
    normalizeJsonInput(input.requestJson, DEFAULT_JSON_OBJECT),
    startedAt,
    now,
    now,
  );

  return requireExternalDataOperationRun({ workspaceId, runId: id });
}

export function updateExternalDataOperationRunStatusSync(input: {
  workspaceId?: string;
  runId: string;
  status: ExternalDataOperationRunStatus;
  resultJson?: JsonInput;
  errorCode?: string;
  errorMessage?: string;
}): ExternalDataOperationRunRecord {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const now = new Date().toISOString();
  const finishedAt = input.status === "succeeded" || input.status === "failed" || input.status === "cancelled" ? now : null;
  const result = getDatabase().prepare(
    `UPDATE external_data_operation_run
     SET status = ?,
         result_json = ?,
         error_code = ?,
         error_message = ?,
         started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, ?) ELSE started_at END,
         finished_at = COALESCE(?, finished_at),
         updated_at = ?
     WHERE workspace_id = ? AND id = ?`,
  ).run(
    input.status,
    normalizeJsonInput(input.resultJson, DEFAULT_JSON_OBJECT),
    normalizeOptionalText(input.errorCode),
    normalizeOptionalText(input.errorMessage),
    input.status,
    now,
    finishedAt,
    now,
    workspaceId,
    input.runId.trim(),
  );

  if (result.changes === 0) {
    throw new Error("External data operation run does not exist.");
  }
  return requireExternalDataOperationRun({ workspaceId, runId: input.runId });
}

export function readExternalDataOperationRunSync(input: {
  workspaceId?: string;
  runId: string;
}): ExternalDataOperationRunRecord | null {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const row = getDatabase().prepare(
    `${selectExternalDataOperationRunSql()}
     WHERE workspace_id = ? AND id = ?`,
  ).get(workspaceId, input.runId.trim()) as Record<string, unknown> | undefined;

  return row ? mapExternalDataOperationRunRecord(row) : null;
}

export function listExternalDataOperationRunsSync(options: {
  workspaceId?: string;
  integrationId?: string;
  resourceBindingId?: string;
  status?: ExternalDataOperationRunStatus;
  limit?: number;
} = {}): ExternalDataOperationRunRecord[] {
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const where = ["workspace_id = ?"];
  const params: unknown[] = [workspaceId];
  if (options.integrationId?.trim()) {
    where.push("integration_id = ?");
    params.push(options.integrationId.trim());
  }
  if (options.resourceBindingId?.trim()) {
    where.push("resource_binding_id = ?");
    params.push(options.resourceBindingId.trim());
  }
  if (options.status) {
    where.push("status = ?");
    params.push(options.status);
  }
  const limit = Math.max(1, Math.min(options.limit ?? 25, 200));

  const rows = getDatabase().prepare(
    `${selectExternalDataOperationRunSql()}
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC, id DESC
     LIMIT ${limit}`,
  ).all(...params) as Array<Record<string, unknown>>;

  return rows.map(mapExternalDataOperationRunRecord).filter((record): record is ExternalDataOperationRunRecord => record !== null);
}

export function recordExternalIntegrationEventSync(input: {
  workspaceId?: string;
  integrationId?: string;
  provider: ExternalIntegrationProvider;
  externalEventId: string;
  eventType: string;
  status?: ExternalIntegrationEventStatus;
  payloadJson?: JsonInput;
  errorMessage?: string;
  receivedAt?: string;
}): ExternalIntegrationEventRecord {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const provider = normalizeRequiredText(input.provider, "External integration event provider is required.");
  const externalEventId = normalizeRequiredText(input.externalEventId, "External integration event id is required.");
  const id = `external-integration-event-${randomLikeId()}`;
  const receivedAt = input.receivedAt ?? new Date().toISOString();

  getDatabase().prepare(
    `INSERT INTO external_integration_event (
       id,
       workspace_id,
       integration_id,
       provider,
       external_event_id,
       event_type,
       status,
       payload_json,
       error_message,
       received_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, provider, external_event_id)
     DO UPDATE SET
       integration_id = COALESCE(EXCLUDED.integration_id, external_integration_event.integration_id),
       event_type = EXCLUDED.event_type,
       status = EXCLUDED.status,
       payload_json = EXCLUDED.payload_json,
       error_message = EXCLUDED.error_message`,
  ).run(
    id,
    workspaceId,
    normalizeOptionalText(input.integrationId),
    provider,
    externalEventId,
    normalizeRequiredText(input.eventType, "External integration event type is required."),
    input.status ?? "received",
    normalizeJsonInput(input.payloadJson, DEFAULT_JSON_OBJECT),
    normalizeOptionalText(input.errorMessage),
    receivedAt,
  );

  const record = readExternalIntegrationEventSync({ workspaceId, provider, externalEventId });
  if (!record) {
    throw new Error("External integration event could not be read back.");
  }
  return record;
}

export function readExternalIntegrationEventSync(input: {
  workspaceId?: string;
  provider: ExternalIntegrationProvider;
  externalEventId: string;
}): ExternalIntegrationEventRecord | null {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const row = getDatabase().prepare(
    `${selectExternalIntegrationEventSql()}
     WHERE workspace_id = ? AND provider = ? AND external_event_id = ?`,
  ).get(workspaceId, input.provider, input.externalEventId.trim()) as Record<string, unknown> | undefined;

  return row ? mapExternalIntegrationEventRecord(row) : null;
}

export function listExternalIntegrationEventsSync(options: {
  workspaceId?: string;
  provider?: ExternalIntegrationProvider;
  integrationId?: string;
  status?: ExternalIntegrationEventStatus;
  limit?: number;
} = {}): ExternalIntegrationEventRecord[] {
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const where = ["workspace_id = ?"];
  const params: unknown[] = [workspaceId];
  if (options.provider) {
    where.push("provider = ?");
    params.push(options.provider);
  }
  if (options.integrationId?.trim()) {
    where.push("integration_id = ?");
    params.push(options.integrationId.trim());
  }
  if (options.status) {
    where.push("status = ?");
    params.push(options.status);
  }
  const limit = Math.max(1, Math.min(options.limit ?? 25, 200));
  const rows = getDatabase().prepare(
    `${selectExternalIntegrationEventSql()}
     WHERE ${where.join(" AND ")}
     ORDER BY received_at DESC, id DESC
     LIMIT ${limit}`,
  ).all(...params) as Array<Record<string, unknown>>;

  return rows.map(mapExternalIntegrationEventRecord).filter((record): record is ExternalIntegrationEventRecord => record !== null);
}

export function updateExternalIntegrationEventStatusSync(input: {
  workspaceId?: string;
  provider: ExternalIntegrationProvider;
  externalEventId: string;
  status: ExternalIntegrationEventStatus;
  errorMessage?: string;
}): ExternalIntegrationEventRecord {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const processedAt = input.status === "processed" || input.status === "ignored" || input.status === "failed"
    ? new Date().toISOString()
    : null;
  const result = getDatabase().prepare(
    `UPDATE external_integration_event
     SET status = ?,
         error_message = ?,
         processed_at = COALESCE(?, processed_at)
     WHERE workspace_id = ? AND provider = ? AND external_event_id = ?`,
  ).run(
    input.status,
    normalizeOptionalText(input.errorMessage),
    processedAt,
    workspaceId,
    input.provider,
    input.externalEventId.trim(),
  );

  if (result.changes === 0) {
    throw new Error("External integration event does not exist.");
  }
  const event = readExternalIntegrationEventSync(input);
  if (!event) {
    throw new Error("External integration event could not be read back.");
  }
  return event;
}

function updateExternalMessageOutboxTerminalStatus(input: {
  workspaceId?: string;
  outboxId: string;
  status: "sent" | "cancelled";
  sentAt?: string;
}): ExternalMessageOutboxRecord {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const now = new Date().toISOString();
  const result = getDatabase().prepare(
    `UPDATE external_message_outbox
     SET status = ?,
         locked_at = NULL,
         locked_by = NULL,
         sent_at = ?,
         updated_at = ?
     WHERE workspace_id = ? AND id = ?`,
  ).run(input.status, normalizeOptionalText(input.sentAt), now, workspaceId, input.outboxId.trim());

  if (result.changes === 0) {
    throw new Error("External message outbox item does not exist.");
  }
  return requireExternalMessageOutbox({ workspaceId, outboxId: input.outboxId });
}

function requireExternalIntegration(input: { workspaceId: string; integrationId: string }): ExternalIntegrationRecord {
  const record = readExternalIntegrationSync(input);
  if (!record) {
    throw new Error("External integration could not be read back.");
  }
  return record;
}

function assertExternalIntegrationAppTenantUnique(input: {
  workspaceId: string;
  provider: ExternalIntegrationProvider;
  appId: string | null;
  tenantKey: string | null;
  excludeIntegrationId?: string;
}): void {
  if (!input.appId) {
    return;
  }
  const params: unknown[] = [
    input.workspaceId,
    input.provider,
    input.appId,
    input.tenantKey,
  ];
  const excludeClause = input.excludeIntegrationId
    ? "AND id <> ?"
    : "";
  if (input.excludeIntegrationId) {
    params.push(input.excludeIntegrationId);
  }
  const row = getDatabase().prepare(
    `${selectExternalIntegrationSql()}
     WHERE workspace_id = ?
       AND provider = ?
       AND app_id = ?
       AND COALESCE(tenant_key, '') = COALESCE(?, '')
       ${excludeClause}
     LIMIT 1`,
  ).get(...params) as Record<string, unknown> | undefined;
  if (row) {
    throw new Error("External integration app and tenant are already connected.");
  }
}

function requireExternalUserBinding(input: { workspaceId: string; bindingId: string }): ExternalUserBindingRecord {
  const record = readExternalUserBindingByIdSync(input);
  if (!record) {
    throw new Error("External user binding could not be read back.");
  }
  return record;
}

function requireExternalChannelBinding(input: { workspaceId: string; bindingId: string }): ExternalChannelBindingRecord {
  const row = getDatabase().prepare(
    `${selectExternalChannelBindingSql()}
     WHERE workspace_id = ? AND id = ?`,
  ).get(input.workspaceId, input.bindingId.trim()) as Record<string, unknown> | undefined;
  const record = row ? mapExternalChannelBindingRecord(row) : null;
  if (!record) {
    throw new Error("External channel binding could not be read back.");
  }
  return record;
}

function requireExternalResourceBinding(input: { workspaceId: string; bindingId: string }): ExternalResourceBindingRecord {
  const row = getDatabase().prepare(
    `${selectExternalResourceBindingSql()}
     WHERE workspace_id = ? AND id = ?`,
  ).get(input.workspaceId, input.bindingId.trim()) as Record<string, unknown> | undefined;
  const record = row ? mapExternalResourceBindingRecord(row) : null;
  if (!record) {
    throw new Error("External resource binding could not be read back.");
  }
  return record;
}

function requireExternalMessageOutbox(input: { workspaceId: string; outboxId: string }): ExternalMessageOutboxRecord {
  const record = readExternalMessageOutboxSync(input);
  if (!record) {
    throw new Error("External message outbox item could not be read back.");
  }
  return record;
}

function requireExternalDataOperationRun(input: { workspaceId: string; runId: string }): ExternalDataOperationRunRecord {
  const record = readExternalDataOperationRunSync(input);
  if (!record) {
    throw new Error("External data operation run could not be read back.");
  }
  return record;
}

function selectExternalIntegrationSql(): string {
  return `SELECT
    id,
    workspace_id AS workspaceId,
    provider,
    display_name AS displayName,
    status,
    transport_mode AS transportMode,
    app_id AS appId,
    tenant_key AS tenantKey,
    encrypted_credentials_json AS encryptedCredentialsJson,
    config_json AS configJson,
    capabilities_json AS capabilitiesJson,
    scopes_json AS scopesJson,
    created_by_user_id AS createdByUserId,
    updated_by_user_id AS updatedByUserId,
    created_at AS createdAt,
    updated_at AS updatedAt,
    disabled_at AS disabledAt,
    last_health_status AS lastHealthStatus,
    last_health_checked_at AS lastHealthCheckedAt,
    last_error AS lastError
   FROM external_integration`;
}

function selectExternalUserBindingSql(): string {
  return `SELECT
    id,
    workspace_id AS workspaceId,
    integration_id AS integrationId,
    user_id AS userId,
    external_user_id AS externalUserId,
    external_union_id AS externalUnionId,
    external_open_id AS externalOpenId,
    external_email AS externalEmail,
    display_name AS displayName,
    status,
    metadata_json AS metadataJson,
    created_at AS createdAt,
    updated_at AS updatedAt,
    last_seen_at AS lastSeenAt
   FROM external_user_binding`;
}

function selectExternalChannelBindingSql(): string {
  return `SELECT
    id,
    workspace_id AS workspaceId,
    integration_id AS integrationId,
    channel_name AS channelName,
    external_chat_id AS externalChatId,
    external_chat_type AS externalChatType,
    external_chat_name AS externalChatName,
    status,
    sync_mode AS syncMode,
    metadata_json AS metadataJson,
    created_by_user_id AS createdByUserId,
    created_at AS createdAt,
    updated_at AS updatedAt,
    disabled_at AS disabledAt
   FROM external_channel_binding`;
}

function selectExternalResourceBindingSql(): string {
  return `SELECT
    id,
    workspace_id AS workspaceId,
    integration_id AS integrationId,
    provider_resource_type AS providerResourceType,
    provider_resource_token AS providerResourceToken,
    provider_resource_url AS providerResourceUrl,
    agent_space_resource_type AS agentSpaceResourceType,
    agent_space_resource_id AS agentSpaceResourceId,
    channel_name AS channelName,
    display_name AS displayName,
    status,
    permissions_json AS permissionsJson,
    metadata_json AS metadataJson,
    created_by_user_id AS createdByUserId,
    created_at AS createdAt,
    updated_at AS updatedAt,
    archived_at AS archivedAt
   FROM external_resource_binding`;
}

function selectExternalMessageMappingSql(): string {
  return `SELECT
    id,
    workspace_id AS workspaceId,
    integration_id AS integrationId,
    channel_binding_id AS channelBindingId,
    direction,
    external_message_id AS externalMessageId,
    external_thread_id AS externalThreadId,
    external_sender_id AS externalSenderId,
    external_event_id AS externalEventId,
    agent_space_message_id AS agentSpaceMessageId,
    task_queue_id AS taskQueueId,
    router_session_id AS routerSessionId,
    metadata_json AS metadataJson,
    created_at AS createdAt
   FROM external_message_mapping`;
}

function selectExternalMessageOutboxSql(): string {
  return `SELECT
    id,
    workspace_id AS workspaceId,
    integration_id AS integrationId,
    channel_binding_id AS channelBindingId,
    target_external_chat_id AS targetExternalChatId,
    target_external_thread_id AS targetExternalThreadId,
    agent_space_message_id AS agentSpaceMessageId,
    payload_json AS payloadJson,
    status,
    attempts,
    next_attempt_at AS nextAttemptAt,
    locked_at AS lockedAt,
    locked_by AS lockedBy,
    last_error AS lastError,
    created_at AS createdAt,
    updated_at AS updatedAt,
    sent_at AS sentAt
   FROM external_message_outbox`;
}

function selectExternalDataOperationRunSql(): string {
  return `SELECT
    id,
    workspace_id AS workspaceId,
    integration_id AS integrationId,
    resource_binding_id AS resourceBindingId,
    operation_type AS operationType,
    provider_resource_type AS providerResourceType,
    provider_resource_token AS providerResourceToken,
    actor_type AS actorType,
    actor_id AS actorId,
    status,
    request_json AS requestJson,
    result_json AS resultJson,
    error_code AS errorCode,
    error_message AS errorMessage,
    started_at AS startedAt,
    finished_at AS finishedAt,
    created_at AS createdAt,
    updated_at AS updatedAt
   FROM external_data_operation_run`;
}

function selectExternalIntegrationEventSql(): string {
  return `SELECT
    id,
    workspace_id AS workspaceId,
    integration_id AS integrationId,
    provider,
    external_event_id AS externalEventId,
    event_type AS eventType,
    status,
    payload_json AS payloadJson,
    error_message AS errorMessage,
    received_at AS receivedAt,
    processed_at AS processedAt
   FROM external_integration_event`;
}

function mapExternalIntegrationRecord(value: Record<string, unknown>): ExternalIntegrationRecord | null {
  if (
    typeof value.id !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.provider !== "string" ||
    typeof value.displayName !== "string" ||
    !isExternalIntegrationStatus(value.status) ||
    !isExternalIntegrationTransportMode(value.transportMode) ||
    typeof value.encryptedCredentialsJson !== "string" ||
    typeof value.configJson !== "string" ||
    typeof value.capabilitiesJson !== "string" ||
    typeof value.scopesJson !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    workspaceId: value.workspaceId,
    provider: value.provider,
    displayName: value.displayName,
    status: value.status,
    transportMode: value.transportMode,
    appId: asOptionalString(value.appId),
    tenantKey: asOptionalString(value.tenantKey),
    encryptedCredentialsJson: value.encryptedCredentialsJson,
    configJson: value.configJson,
    capabilitiesJson: value.capabilitiesJson,
    scopesJson: value.scopesJson,
    createdByUserId: asOptionalString(value.createdByUserId),
    updatedByUserId: asOptionalString(value.updatedByUserId),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    disabledAt: asOptionalString(value.disabledAt),
    lastHealthStatus: isExternalIntegrationHealthStatus(value.lastHealthStatus) ? value.lastHealthStatus : undefined,
    lastHealthCheckedAt: asOptionalString(value.lastHealthCheckedAt),
    lastError: asOptionalString(value.lastError),
  };
}

function mapExternalUserBindingRecord(value: Record<string, unknown>): ExternalUserBindingRecord | null {
  if (
    typeof value.id !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.integrationId !== "string" ||
    typeof value.userId !== "string" ||
    typeof value.externalUserId !== "string" ||
    !isExternalBindingStatus(value.status) ||
    typeof value.metadataJson !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    workspaceId: value.workspaceId,
    integrationId: value.integrationId,
    userId: value.userId,
    externalUserId: value.externalUserId,
    externalUnionId: asOptionalString(value.externalUnionId),
    externalOpenId: asOptionalString(value.externalOpenId),
    externalEmail: asOptionalString(value.externalEmail),
    displayName: asOptionalString(value.displayName),
    status: value.status,
    metadataJson: value.metadataJson,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    lastSeenAt: asOptionalString(value.lastSeenAt),
  };
}

function mapExternalChannelBindingRecord(value: Record<string, unknown>): ExternalChannelBindingRecord | null {
  if (
    typeof value.id !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.integrationId !== "string" ||
    typeof value.channelName !== "string" ||
    typeof value.externalChatId !== "string" ||
    !isExternalBindingStatus(value.status) ||
    !isExternalChannelBindingSyncMode(value.syncMode) ||
    typeof value.metadataJson !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    workspaceId: value.workspaceId,
    integrationId: value.integrationId,
    channelName: value.channelName,
    externalChatId: value.externalChatId,
    externalChatType: asOptionalString(value.externalChatType),
    externalChatName: asOptionalString(value.externalChatName),
    status: value.status,
    syncMode: value.syncMode,
    metadataJson: value.metadataJson,
    createdByUserId: asOptionalString(value.createdByUserId),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    disabledAt: asOptionalString(value.disabledAt),
  };
}

function mapExternalResourceBindingRecord(value: Record<string, unknown>): ExternalResourceBindingRecord | null {
  if (
    typeof value.id !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.integrationId !== "string" ||
    typeof value.providerResourceType !== "string" ||
    typeof value.providerResourceToken !== "string" ||
    typeof value.agentSpaceResourceType !== "string" ||
    typeof value.agentSpaceResourceId !== "string" ||
    !isExternalBindingStatus(value.status) ||
    typeof value.permissionsJson !== "string" ||
    typeof value.metadataJson !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    workspaceId: value.workspaceId,
    integrationId: value.integrationId,
    providerResourceType: value.providerResourceType,
    providerResourceToken: value.providerResourceToken,
    providerResourceUrl: asOptionalString(value.providerResourceUrl),
    agentSpaceResourceType: value.agentSpaceResourceType,
    agentSpaceResourceId: value.agentSpaceResourceId,
    channelName: asOptionalString(value.channelName),
    displayName: asOptionalString(value.displayName),
    status: value.status,
    permissionsJson: value.permissionsJson,
    metadataJson: value.metadataJson,
    createdByUserId: asOptionalString(value.createdByUserId),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    archivedAt: asOptionalString(value.archivedAt),
  };
}

function mapExternalMessageMappingRecord(value: Record<string, unknown>): ExternalMessageMappingRecord | null {
  if (
    typeof value.id !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.integrationId !== "string" ||
    !isExternalMessageDirection(value.direction) ||
    typeof value.externalMessageId !== "string" ||
    typeof value.metadataJson !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    workspaceId: value.workspaceId,
    integrationId: value.integrationId,
    channelBindingId: asOptionalString(value.channelBindingId),
    direction: value.direction,
    externalMessageId: value.externalMessageId,
    externalThreadId: asOptionalString(value.externalThreadId),
    externalSenderId: asOptionalString(value.externalSenderId),
    externalEventId: asOptionalString(value.externalEventId),
    agentSpaceMessageId: asOptionalString(value.agentSpaceMessageId),
    taskQueueId: asOptionalString(value.taskQueueId),
    routerSessionId: asOptionalString(value.routerSessionId),
    metadataJson: value.metadataJson,
    createdAt: value.createdAt,
  };
}

function mapExternalMessageOutboxRecord(value: Record<string, unknown>): ExternalMessageOutboxRecord | null {
  if (
    typeof value.id !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.integrationId !== "string" ||
    typeof value.targetExternalChatId !== "string" ||
    typeof value.payloadJson !== "string" ||
    !isExternalMessageOutboxStatus(value.status) ||
    typeof value.attempts !== "number" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    workspaceId: value.workspaceId,
    integrationId: value.integrationId,
    channelBindingId: asOptionalString(value.channelBindingId),
    targetExternalChatId: value.targetExternalChatId,
    targetExternalThreadId: asOptionalString(value.targetExternalThreadId),
    agentSpaceMessageId: asOptionalString(value.agentSpaceMessageId),
    payloadJson: value.payloadJson,
    status: value.status,
    attempts: value.attempts,
    nextAttemptAt: asOptionalString(value.nextAttemptAt),
    lockedAt: asOptionalString(value.lockedAt),
    lockedBy: asOptionalString(value.lockedBy),
    lastError: asOptionalString(value.lastError),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    sentAt: asOptionalString(value.sentAt),
  };
}

function mapExternalDataOperationRunRecord(value: Record<string, unknown>): ExternalDataOperationRunRecord | null {
  if (
    typeof value.id !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.integrationId !== "string" ||
    typeof value.operationType !== "string" ||
    typeof value.providerResourceType !== "string" ||
    typeof value.providerResourceToken !== "string" ||
    !isExternalDataOperationActorType(value.actorType) ||
    !isExternalDataOperationRunStatus(value.status) ||
    typeof value.requestJson !== "string" ||
    typeof value.resultJson !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    workspaceId: value.workspaceId,
    integrationId: value.integrationId,
    resourceBindingId: asOptionalString(value.resourceBindingId),
    operationType: value.operationType,
    providerResourceType: value.providerResourceType,
    providerResourceToken: value.providerResourceToken,
    actorType: value.actorType,
    actorId: asOptionalString(value.actorId),
    status: value.status,
    requestJson: value.requestJson,
    resultJson: value.resultJson,
    errorCode: asOptionalString(value.errorCode),
    errorMessage: asOptionalString(value.errorMessage),
    startedAt: asOptionalString(value.startedAt),
    finishedAt: asOptionalString(value.finishedAt),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function mapExternalIntegrationEventRecord(value: Record<string, unknown>): ExternalIntegrationEventRecord | null {
  if (
    typeof value.id !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.provider !== "string" ||
    typeof value.externalEventId !== "string" ||
    typeof value.eventType !== "string" ||
    !isExternalIntegrationEventStatus(value.status) ||
    typeof value.payloadJson !== "string" ||
    typeof value.receivedAt !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    workspaceId: value.workspaceId,
    integrationId: asOptionalString(value.integrationId),
    provider: value.provider,
    externalEventId: value.externalEventId,
    eventType: value.eventType,
    status: value.status,
    payloadJson: value.payloadJson,
    errorMessage: asOptionalString(value.errorMessage),
    receivedAt: value.receivedAt,
    processedAt: asOptionalString(value.processedAt),
  };
}

function normalizeRequiredText(value: string, message: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

function normalizeOptionalText(value: string | undefined | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeOptionalEmail(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizeJsonInput(value: JsonInput, fallback: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : fallback;
  }
  if (value === undefined) {
    return fallback;
  }
  return JSON.stringify(value);
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isExternalIntegrationStatus(value: unknown): value is ExternalIntegrationStatus {
  return value === "active" || value === "disabled" || value === "error";
}

function isExternalIntegrationTransportMode(value: unknown): value is ExternalIntegrationTransportMode {
  return value === "http_webhook" || value === "websocket_worker";
}

function isExternalIntegrationHealthStatus(value: unknown): value is ExternalIntegrationHealthStatus {
  return value === "unknown" || value === "healthy" || value === "degraded" || value === "error";
}

function isExternalBindingStatus(value: unknown): value is ExternalBindingStatus {
  return value === "active" || value === "disabled" || value === "archived";
}

function isExternalChannelBindingSyncMode(value: unknown): value is ExternalChannelBindingSyncMode {
  return value === "mirror" || value === "ingest_only" || value === "send_only";
}

function isExternalMessageDirection(value: unknown): value is ExternalMessageDirection {
  return value === "inbound" || value === "outbound";
}

function isExternalMessageOutboxStatus(value: unknown): value is ExternalMessageOutboxStatus {
  return value === "pending" || value === "locked" || value === "sent" || value === "failed" || value === "cancelled";
}

function isExternalDataOperationRunStatus(value: unknown): value is ExternalDataOperationRunStatus {
  return value === "pending" || value === "running" || value === "succeeded" || value === "failed" || value === "cancelled";
}

function isExternalDataOperationActorType(value: unknown): value is ExternalDataOperationActorType {
  return value === "user" || value === "agent" || value === "system";
}

function isExternalIntegrationEventStatus(value: unknown): value is ExternalIntegrationEventStatus {
  return value === "received" || value === "processed" || value === "ignored" || value === "failed";
}
