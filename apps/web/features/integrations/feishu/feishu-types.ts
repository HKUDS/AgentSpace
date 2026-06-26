import type {
  ExternalBindingStatus,
  ExternalDataOperationActorType,
  ExternalDataOperationRunStatus,
  ExternalIntegrationEventStatus,
  ExternalIntegrationHealthStatus,
  ExternalIntegrationStatus,
  ExternalIntegrationTransportMode,
  ExternalMessageOutboxStatus,
  ExternalResourceBindingAgentSpaceType,
  ExternalResourceBindingProviderType,
} from "@agent-space/db";

export interface FeishuAvailableChannelItem {
  name: string;
  kind?: string;
}

export interface FeishuAvailableUserItem {
  userId: string;
  displayName: string;
  primaryEmail?: string;
  role: string;
}

export interface FeishuUserBindingSettingsItem {
  id: string;
  integrationId: string;
  userId: string;
  externalUserReference: string;
  externalUserIdRedacted: true;
  externalUnionReference?: string;
  externalOpenReference?: string;
  externalEmailReference?: string;
  displayName?: string;
  status: ExternalBindingStatus;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
}

export interface FeishuChannelBindingSettingsItem {
  id: string;
  integrationId: string;
  channelName: string;
  externalChatReference: string;
  externalChatIdRedacted: true;
  externalChatType?: string;
  externalChatName?: string;
  status: ExternalBindingStatus;
  syncMode: "mirror" | "ingest_only" | "send_only";
  createdAt: string;
  updatedAt: string;
}

export interface FeishuResourceBindingSettingsItem {
  id: string;
  integrationId: string;
  providerResourceType: ExternalResourceBindingProviderType;
  providerResourceReference: string;
  providerResourceTokenRedacted: true;
  agentSpaceResourceType: ExternalResourceBindingAgentSpaceType;
  agentSpaceResourceId: string;
  channelName?: string;
  displayName?: string;
  canWrite: boolean;
  status: ExternalBindingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface FeishuDataOperationRunSettingsItem {
  id: string;
  integrationId: string;
  resourceBindingId?: string;
  operationType: string;
  providerResourceType: string;
  providerResourceReference: string;
  providerResourceTokenRedacted: true;
  actorType: ExternalDataOperationActorType;
  actorId?: string;
  status: ExternalDataOperationRunStatus;
  policyDecision?: string;
  responseSummary?: string;
  resultPreview?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeishuOutboxSettingsItem {
  id: string;
  integrationId: string;
  channelBindingId?: string;
  targetExternalChatReference: string;
  targetExternalChatIdRedacted: true;
  targetExternalThreadReference?: string;
  targetExternalThreadIdRedacted?: true;
  agentSpaceMessageId?: string;
  status: ExternalMessageOutboxStatus;
  attempts: number;
  nextAttemptAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeishuIntegrationEventSettingsItem {
  id: string;
  integrationId?: string;
  externalEventId: string;
  eventType: string;
  status: ExternalIntegrationEventStatus;
  errorMessage?: string;
  bindingSuggestion?: FeishuInboundBindingSuggestion;
  receivedAt: string;
  processedAt?: string;
}

export type FeishuInboundBindingSuggestion =
  | {
    kind: "channel";
    externalChatId: string;
  }
  | {
    kind: "user";
    externalUserId: string;
    externalUnionId?: string;
    externalOpenId?: string;
  };

export interface FeishuIntegrationSettingsItem {
  id: string;
  displayName: string;
  status: ExternalIntegrationStatus;
  transportMode: ExternalIntegrationTransportMode;
  appId?: string;
  tenantKey?: string;
  callbackUrl: string;
  createdAt: string;
  updatedAt: string;
  lastHealthStatus?: ExternalIntegrationHealthStatus;
  lastHealthCheckedAt?: string;
  lastError?: string;
  hasAppSecret: boolean;
  hasVerificationToken: boolean;
  hasEncryptKey: boolean;
  userBindingCount: number;
  channelBindingCount: number;
  resourceBindingCount: number;
  operationRunCount: number;
  outboxFailureCount: number;
  userBindings: FeishuUserBindingSettingsItem[];
  channelBindings: FeishuChannelBindingSettingsItem[];
  resourceBindings: FeishuResourceBindingSettingsItem[];
  operationRuns: FeishuDataOperationRunSettingsItem[];
  recentOutboxFailures: FeishuOutboxSettingsItem[];
  recentInboundEvents: FeishuIntegrationEventSettingsItem[];
  setupGuide?: FeishuIntegrationSetupGuide;
}

export interface FeishuIntegrationSetupGuide {
  requiredCredentialFields: string[];
  requiredEvents: string[];
  requiredScopes: string[];
  eventCallbackPath: string;
  developerConsoleUrl: string;
  openPlatformSetupSteps: FeishuOpenPlatformSetupStep[];
  checks: FeishuIntegrationSetupCheck[];
  evidenceGates: FeishuIntegrationEvidenceGate[];
  commands: {
    healthCheck: string;
    botReadiness: string;
    dataPlaneReadiness: string;
    workerReadiness: string;
    smokeEnv: string;
    checkEnv: string;
    strictLiveSmoke: string;
    verifyOpenApiEvidence: string;
    smokePlan: string;
    evidence: string;
  };
}

export interface FeishuIntegrationCreationGuide {
  requiredCredentialFields: string[];
  requiredEvents: string[];
  requiredScopes: string[];
  eventCallbackPath: string;
  publicAppUrlStatus: "configured" | "missing";
  publicAppUrl?: string;
  callbackUrlTemplate: string;
  developerConsoleUrl: string;
  openPlatformSetupSteps: FeishuOpenPlatformSetupStep[];
}

export interface FeishuOpenPlatformSetupStep {
  id: string;
  consoleUrl: string;
  required: string[];
}

export type FeishuIntegrationEvidenceGateKey =
  | "bot_reply"
  | "worker_restart"
  | "worker_card_action"
  | "data_plane"
  | "failure_visibility"
  | "openapi_artifact";

export interface FeishuIntegrationEvidenceGate {
  key: FeishuIntegrationEvidenceGateKey;
  required: string;
}

export type FeishuIntegrationSetupCheckKey =
  | "credentials"
  | "callback_or_worker"
  | "health"
  | "chat_binding"
  | "user_binding"
  | "doc_binding"
  | "sheet_binding"
  | "base_binding"
  | "outbox";

export type FeishuIntegrationSetupCheckStatus = "ready" | "missing" | "attention";

export interface FeishuIntegrationSetupCheck {
  key: FeishuIntegrationSetupCheckKey;
  status: FeishuIntegrationSetupCheckStatus;
  current: number | string;
  required?: number | string;
}

export interface CreateFeishuIntegrationInput {
  displayName: string;
  transportMode: ExternalIntegrationTransportMode;
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  tenantKey?: string;
}

export interface TestFeishuIntegrationConnectionInput {
  appId: string;
  appSecret: string;
}

export interface TestFeishuIntegrationConnectionResult {
  status: ExternalIntegrationHealthStatus;
  checkedAt: string;
  botOpenId?: string;
  botAppName?: string;
  scopeReadiness: "verified" | "missing_required_scopes" | "unauthorized" | "manual_review_required" | "unavailable";
  requiredScopes: string[];
  enabledScopes?: string[];
  missingScopes?: string[];
  scopeErrorMessage?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface RotateFeishuIntegrationSecretInput {
  integrationId: string;
  appId?: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  tenantKey?: string;
}

export interface DeletedFeishuIntegrationResult {
  integrationId: string;
}

export interface UpdateFeishuBindingStatusInput {
  bindingId: string;
}

export interface CreateFeishuChannelBindingInput {
  integrationId: string;
  channelName: string;
  externalChatId: string;
  externalChatType?: string;
  externalChatName?: string;
}

export interface CreateFeishuUserBindingInput {
  integrationId: string;
  userId: string;
  externalUserId: string;
  externalUnionId?: string;
  externalOpenId?: string;
  externalEmail?: string;
  displayName?: string;
}

export interface CreateFeishuResourceBindingInput {
  integrationId: string;
  providerResourceType: ExternalResourceBindingProviderType;
  resourceUrlOrToken: string;
  agentSpaceResourceType: ExternalResourceBindingAgentSpaceType;
  agentSpaceResourceId: string;
  channelName?: string;
  displayName?: string;
  allowWrite?: boolean;
}
