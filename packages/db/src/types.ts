// ─── New multi-tenant types ───────────────────────────────────────────────

/** A workspace — the primary isolation boundary */
export interface StoredWorkspaceRecord {
  id: string;
  slug: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  joinCode?: string;
  joinCodeUpdatedAt?: string;
  joinCodeUpdatedBy?: string;
}

/** Membership tying a user to a workspace with a role */
export type WorkspaceRole = "owner" | "admin" | "member";

export interface StoredWorkspaceMembershipRecord {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  status: "active" | "invited" | "removed";
  joinedAt: string;
  invitedBy?: string;
}

export type WorkspaceInvitationStatus = "active" | "accepted" | "revoked" | "expired";

export interface StoredWorkspaceInvitationRecord {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  tokenHash: string;
  status: WorkspaceInvitationStatus;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
}

/** The new user table — replaces auth_user */
export interface StoredUserRecord {
  id: string;
  displayName: string;
  avatarUrl?: string;
  primaryEmail?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

/** An identity from an external auth provider (e.g. Google) */
export type AuthProvider = "google" | "password" | "email";

export interface StoredAuthIdentityRecord {
  id: string;
  userId: string;
  provider: AuthProvider;
  providerSubject: string;
  email?: string;
  emailVerified: boolean;
  profileJson: string;
  createdAt: string;
  updatedAt: string;
}

/** Server-side session (replaces auth_session token model) */
export interface StoredSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  lastSeenAt: string;
  createdAt: string;
  ipAddress?: string;
  userAgent?: string;
  revokedAt?: string;
}

export type GoogleOAuthCredentialStatus = "active" | "revoked";

export interface StoredGoogleOAuthCredentialRecord {
  id: string;
  workspaceId: string;
  userId: string;
  googleSubject?: string;
  googleEmail?: string;
  scopes: string;
  accessTokenEncrypted?: string;
  refreshTokenEncrypted?: string;
  expiresAt?: string;
  status: GoogleOAuthCredentialStatus;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
}

export type AgentGoogleWorkspaceDelegationStatus = "active" | "revoked";

export interface StoredAgentGoogleWorkspaceDelegationRecord {
  id: string;
  workspaceId: string;
  employeeName: string;
  userId: string;
  googleOAuthCredentialId: string;
  status: AgentGoogleWorkspaceDelegationStatus;
  scopes: string;
  googleEmail?: string;
  grantedByUserId: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
}

export type ExternalIntegrationProvider = string;
export type ExternalIntegrationStatus = "active" | "disabled" | "error";
export type ExternalIntegrationTransportMode = "http_webhook" | "websocket_worker";
export type ExternalIntegrationHealthStatus = "unknown" | "healthy" | "degraded" | "error";

export interface ExternalIntegrationRecord {
  id: string;
  workspaceId: string;
  provider: ExternalIntegrationProvider;
  displayName: string;
  status: ExternalIntegrationStatus;
  transportMode: ExternalIntegrationTransportMode;
  appId?: string;
  tenantKey?: string;
  encryptedCredentialsJson: string;
  configJson: string;
  capabilitiesJson: string;
  scopesJson: string;
  createdByUserId?: string;
  updatedByUserId?: string;
  createdAt: string;
  updatedAt: string;
  disabledAt?: string;
  lastHealthStatus?: ExternalIntegrationHealthStatus;
  lastHealthCheckedAt?: string;
  lastError?: string;
}

export type ExternalBindingStatus = "active" | "disabled" | "archived";

export interface ExternalUserBindingRecord {
  id: string;
  workspaceId: string;
  integrationId: string;
  userId: string;
  externalUserId: string;
  externalUnionId?: string;
  externalOpenId?: string;
  externalEmail?: string;
  displayName?: string;
  status: ExternalBindingStatus;
  metadataJson: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
}

export type ExternalChannelBindingSyncMode = "mirror" | "ingest_only" | "send_only";

export interface ExternalChannelBindingRecord {
  id: string;
  workspaceId: string;
  integrationId: string;
  channelName: string;
  externalChatId: string;
  externalChatType?: string;
  externalChatName?: string;
  status: ExternalBindingStatus;
  syncMode: ExternalChannelBindingSyncMode;
  metadataJson: string;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
  disabledAt?: string;
}

export type ExternalResourceBindingProviderType = string;
export type ExternalResourceBindingAgentSpaceType = string;

export interface ExternalResourceBindingRecord {
  id: string;
  workspaceId: string;
  integrationId: string;
  providerResourceType: ExternalResourceBindingProviderType;
  providerResourceToken: string;
  providerResourceUrl?: string;
  agentSpaceResourceType: ExternalResourceBindingAgentSpaceType;
  agentSpaceResourceId: string;
  channelName?: string;
  displayName?: string;
  status: ExternalBindingStatus;
  permissionsJson: string;
  metadataJson: string;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export type ExternalMessageDirection = "inbound" | "outbound";

export interface ExternalMessageMappingRecord {
  id: string;
  workspaceId: string;
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
  metadataJson: string;
  createdAt: string;
}

export type ExternalMessageOutboxStatus = "pending" | "locked" | "sent" | "failed" | "cancelled";

export interface ExternalMessageOutboxRecord {
  id: string;
  workspaceId: string;
  integrationId: string;
  channelBindingId?: string;
  targetExternalChatId: string;
  targetExternalThreadId?: string;
  agentSpaceMessageId?: string;
  payloadJson: string;
  status: ExternalMessageOutboxStatus;
  attempts: number;
  nextAttemptAt?: string;
  lockedAt?: string;
  lockedBy?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
}

export type ExternalDataOperationRunStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";
export type ExternalDataOperationActorType = "user" | "agent" | "system";

export interface ExternalDataOperationRunRecord {
  id: string;
  workspaceId: string;
  integrationId: string;
  resourceBindingId?: string;
  operationType: string;
  providerResourceType: ExternalResourceBindingProviderType;
  providerResourceToken: string;
  actorType: ExternalDataOperationActorType;
  actorId?: string;
  status: ExternalDataOperationRunStatus;
  requestJson: string;
  resultJson: string;
  errorCode?: string;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type ExternalIntegrationEventStatus = "received" | "processed" | "ignored" | "failed";

export interface ExternalIntegrationEventRecord {
  id: string;
  workspaceId: string;
  integrationId?: string;
  provider: ExternalIntegrationProvider;
  externalEventId: string;
  eventType: string;
  status: ExternalIntegrationEventStatus;
  payloadJson: string;
  errorMessage?: string;
  receivedAt: string;
  processedAt?: string;
}

import type { DaemonProvider } from "@agent-space/domain";
import type { KnowledgeAssignmentMode } from "@agent-space/domain/workspace";

export interface DaemonConnectionRecord {
  id: string;
  workspaceId: string;
  daemonKey: string;
  deviceName: string;
  status: "online" | "offline";
  metadataJson: string;
  lastHeartbeatAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRuntimeRecord {
  id: string;
  workspaceId: string;
  daemonConnectionId?: string;
  provider: DaemonProvider;
  name: string;
  version: string;
  status: "online" | "offline";
  deviceInfo: string;
  metadataJson: string;
  connectedAt?: string;
  lastHeartbeatAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceRuntimeDisplayNameRecord {
  workspaceId: string;
  runtimeId: string;
  displayName: string;
  updatedByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeRegistrationInput {
  provider: DaemonProvider;
  name: string;
  version?: string;
  deviceInfo?: string;
  metadata?: Record<string, unknown>;
}

export interface RegisteredDaemonSnapshot {
  daemon: DaemonConnectionRecord;
  runtimes: AgentRuntimeRecord[];
}

export interface DaemonApiTokenRecord {
  id: string;
  workspaceId: string;
  label: string;
  tokenHash: string;
  status: "active" | "revoked";
  createdBy: string;
  lastUsedAt?: string;
  createdAt: string;
  revokedAt?: string;
}

export interface EmployeeRuntimeBindingRecord {
  workspaceId: string;
  employeeName: string;
  runtimeId: string;
  provider: DaemonProvider;
  runtimeName: string;
  boundAt: string;
  updatedAt: string;
}

export type AgentRouterSessionStatus = "active" | "closed";
export type AgentRouterProviderSessionStatus = "active" | "invalid" | "expired";
export type AgentRouterActorType = "human" | "agent" | "runtime" | "system";
export type AgentRouterContextSnapshotType = "context" | "memory" | "handoff";
export type AgentTaskAttemptStatus = "claimed" | "running" | "completed" | "failed" | "cancelled";

export interface AgentRouterSessionRecord {
  id: string;
  workspaceId: string;
  agentId: string;
  conversationKey?: string;
  sourceType: string;
  status: AgentRouterSessionStatus;
  title?: string;
  summary?: string;
  memorySummary?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface AgentRouterProviderSessionRecord {
  id: string;
  workspaceId: string;
  routerSessionId: string;
  runtimeId: string;
  provider: DaemonProvider;
  providerSessionId: string;
  status: AgentRouterProviderSessionStatus;
  lastUsedAt?: string;
  lastError?: string;
  metadataJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRouterEventRecord {
  id: string;
  workspaceId: string;
  routerSessionId: string;
  taskQueueId?: string;
  attemptId?: string;
  type: string;
  actorType: AgentRouterActorType;
  actorId?: string;
  runtimeId?: string;
  provider?: DaemonProvider;
  summary?: string;
  dataJson: string;
  createdAt: string;
}

export interface AgentRouterContextSnapshotRecord {
  id: string;
  workspaceId: string;
  routerSessionId: string;
  taskQueueId?: string;
  snapshotType: AgentRouterContextSnapshotType;
  contentMarkdown: string;
  sourceEventIdsJson: string;
  createdAt: string;
}

export interface AgentTaskAttemptRecord {
  id: string;
  workspaceId: string;
  taskQueueId: string;
  routerSessionId: string;
  runtimeId: string;
  provider: DaemonProvider;
  providerSessionId?: string;
  status: AgentTaskAttemptStatus;
  startedAt?: string;
  finishedAt?: string;
  errorText?: string;
  handoffSnapshotId?: string;
  metadataJson: string;
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceRuntimeGrantPermission = "use";
export type WorkspaceRuntimeGrantStatus = "active" | "revoked";

export interface WorkspaceRuntimeGrantRecord {
  id: string;
  workspaceId: string;
  runtimeId: string;
  userId: string;
  permission: WorkspaceRuntimeGrantPermission;
  status: WorkspaceRuntimeGrantStatus;
  grantedByUserId: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
}

export type DocumentAgentAccessRole = "forwarder" | "editor" | "viewer";
export type DocumentAgentAccessSubjectType = "agent";

export interface DocumentAgentAccessRecord {
  id: string;
  workspaceId: string;
  documentId: string;
  subjectType: DocumentAgentAccessSubjectType;
  subjectId: string;
  role: DocumentAgentAccessRole;
  scope: "document";
  grantedByUserId: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
}

export type DocumentPermissionRequestStatus = "pending" | "approved" | "rejected" | "cancelled";
export type DocumentPermissionRequestExternalProvider = "google_workspace" | "notion" | "microsoft_365";

export interface DocumentPermissionRequestRecord {
  id: string;
  workspaceId: string;
  documentId?: string;
  externalProvider?: DocumentPermissionRequestExternalProvider;
  externalFileId?: string;
  externalUrl?: string;
  requestedRole: DocumentAgentAccessRole;
  requestedByAgentName: string;
  requestedForChannelName?: string;
  triggeredByUserId?: string;
  reason: string;
  status: DocumentPermissionRequestStatus;
  decidedByUserId?: string;
  decisionNote?: string;
  sourceTaskId?: string;
  createdAt: string;
  decidedAt?: string;
}

export type AgentAccessRequestType = "fork_copy" | "channel_use";
export type AgentAccessRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface AgentAccessRequestRecord {
  id: string;
  workspaceId: string;
  sourceAgentName: string;
  requesterUserId: string;
  requestType: AgentAccessRequestType;
  targetChannelName?: string;
  status: AgentAccessRequestStatus;
  reason: string;
  resolverUserId?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  forkInvitationId?: string;
  auditDataJson: string;
}

export type KnowledgeProposalOperation = "create" | "update";
export type KnowledgeProposalStatus = "pending" | "approved" | "rejected" | "stale" | "cancelled";

export interface KnowledgeProposalRecord {
  id: string;
  workspaceId: string;
  sourceTaskQueueId: string;
  sourceChannelName?: string;
  sourceAgentName: string;
  operation: KnowledgeProposalOperation;
  status: KnowledgeProposalStatus;
  title: string;
  contentMarkdown: string;
  summary?: string;
  reason?: string;
  tags: string[];
  parentId?: string;
  assignmentMode: KnowledgeAssignmentMode;
  assignedEmployeeNames: string[];
  targetKnowledgePageId?: string;
  baseUpdatedAt?: string;
  createdKnowledgePageId?: string;
  approvalId?: string;
  decidedByUserId?: string;
  decidedAt?: string;
  reviewerComment?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResetKnowledgeProposalsResult {
  removedKnowledgeProposalRows: number;
}

export type WorkspaceNotificationRecipientType = "human" | "agent";
export type WorkspaceNotificationActorType = "human" | "agent" | "system";
export type WorkspaceNotificationResourceType =
  | "workspace"
  | "workspace_member"
  | "agent"
  | "agent_fork_invitation"
  | "channel"
  | "document"
  | "runtime"
  | "task"
  | "approval";
export type WorkspaceNotificationSeverity = "info" | "success" | "warning" | "critical";
export type WorkspaceNotificationStatus = "unread" | "read" | "archived";

export interface WorkspaceNotificationRecord {
  id: string;
  workspaceId: string;
  recipientType: WorkspaceNotificationRecipientType;
  recipientId: string;
  actorType?: WorkspaceNotificationActorType;
  actorId?: string;
  type: string;
  resourceType: WorkspaceNotificationResourceType;
  resourceId?: string;
  channelName?: string;
  title: string;
  body: string;
  actionHref?: string;
  severity: WorkspaceNotificationSeverity;
  status: WorkspaceNotificationStatus;
  dedupeKey?: string;
  metadataJson: string;
  createdAt: string;
  readAt?: string;
  archivedAt?: string;
}

export type AgentForkInvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface StoredAgentForkInvitationRecord {
  id: string;
  workspaceId: string;
  sourceAgentName: string;
  targetUserId: string;
  status: AgentForkInvitationStatus;
  optionsJson: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  acceptedAgentName?: string;
  acceptedRuntimeId?: string;
}

export interface StoredAgentForkSnapshotRecord {
  id: string;
  workspaceId: string;
  invitationId: string;
  sourceAgentName: string;
  snapshotJson: string;
  createdAt: string;
}

export type RuntimeAppCatalogSource = "clihub_harness" | "clihub_public";
export type RuntimeAppInstallStrategy = "cli_hub" | "pip" | "npm" | "uv" | "bundled" | "manual";
export type RuntimeInstalledAppStatus = "installed" | "installing" | "failed" | "disabled" | "missing";
export type RuntimeAppOperationType = "install" | "update" | "uninstall" | "verify" | "disable" | "enable";
export type RuntimeAppOperationStatus = "pending" | "claimed" | "running" | "succeeded" | "failed" | "cancelled";
export type RuntimeAppRiskLevel = "low" | "medium" | "high";

export interface RuntimeAppCatalogItemRecord {
  source: RuntimeAppCatalogSource;
  name: string;
  displayName: string;
  description: string;
  version: string;
  category: string;
  entryPoint: string;
  installStrategy: RuntimeAppInstallStrategy | "";
  installCmd?: string;
  uninstallCmd?: string;
  updateCmd?: string;
  skillMd?: string;
  requiresText?: string;
  homepage?: string;
  registryJson: string;
  syncedAt: string;
}

export interface RuntimeInstalledAppRecord {
  id: string;
  workspaceId: string;
  runtimeId: string;
  source: RuntimeAppCatalogSource;
  name: string;
  displayName: string;
  version: string;
  entryPoint: string;
  status: RuntimeInstalledAppStatus;
  installStrategy: RuntimeAppInstallStrategy | "";
  enabled: boolean;
  installedByUserId?: string;
  installedAt?: string;
  updatedAt: string;
  lastCheckedAt?: string;
  lastError?: string;
  metadataJson: string;
}

export interface RuntimeAppOperationRecord {
  id: string;
  workspaceId: string;
  runtimeId: string;
  appSource: RuntimeAppCatalogSource;
  appName: string;
  operation: RuntimeAppOperationType;
  status: RuntimeAppOperationStatus;
  requestedByUserId?: string;
  commandPlanJson: string;
  safeStdoutTail?: string;
  safeStderrTail?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface RuntimeAppSkillBindingRecord {
  workspaceId: string;
  runtimeAppId: string;
  skillId: string;
  source: RuntimeAppCatalogSource;
  name: string;
  createdAt: string;
}

export interface StoredSkillRecord {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  sourceType: string;
  sourceUrl?: string;
  configJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredSkillFileRecord {
  id: string;
  skillId: string;
  path: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAgentSkillRecord {
  workspaceId: string;
  agentId?: string;
  employeeName: string;
  skillId: string;
  createdAt: string;
}

export interface StoredKnowledgeAssignmentPolicyRecord {
  workspaceId: string;
  knowledgePageId: string;
  assignmentMode: KnowledgeAssignmentMode;
  updatedAt: string;
  updatedBy: string;
}

export interface StoredAgentKnowledgePageRecord {
  workspaceId: string;
  agentId?: string;
  employeeName: string;
  knowledgePageId: string;
  createdAt: string;
  createdBy: string;
}

export interface StoredSkillImportEventRecord {
  id: string;
  workspaceId: string;
  skillId?: string;
  skillName: string;
  sourceType: string;
  sourceUrl?: string;
  importMode: "created" | "renamed" | "replaced";
  metadataJson: string;
  importedAt: string;
}

export type ChannelParticipantStatus = "active" | "removed";

export interface StoredChannelParticipantRecord {
  id: string;
  workspaceId: string;
  channelName: string;
  userId: string;
  status: ChannelParticipantStatus;
  addedBy?: string;
  joinedAt: string;
  removedAt?: string;
  updatedAt: string;
}

export type ChannelAccessRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface StoredChannelAccessRequestRecord {
  id: string;
  workspaceId: string;
  channelName: string;
  userId: string;
  status: ChannelAccessRequestStatus;
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  note?: string;
}

export type ChannelInvitationStatus = "pending" | "accepted" | "rejected" | "revoked" | "expired";

export interface StoredChannelInvitationRecord {
  id: string;
  workspaceId: string;
  channelName: string;
  inviteeUserId?: string;
  inviteeEmail?: string;
  invitedBy: string;
  status: ChannelInvitationStatus;
  createdAt: string;
  expiresAt?: string;
  respondedAt?: string;
  respondedBy?: string;
}

export type NativeTaskStatus = "queued" | "claimed" | "running" | "completed" | "failed" | "cancelled";
export const TASK_EXECUTION_EVENT_TYPES = [
  "queued",
  "assigned",
  "workspace_prepared",
  "context_loaded",
  "tool_started",
  "tool_finished",
  "artifact_detected",
  "artifact_collected",
  "approval_requested",
  "approval_reviewed",
  "blocked",
  "handoff_created",
  "message_posted",
  "completed",
  "failed",
  "cancelled",
] as const;
export type TaskExecutionEventType = typeof TASK_EXECUTION_EVENT_TYPES[number];
export type TaskExecutionEventSeverity = "info" | "warning" | "error";
export type TaskExecutionEventStatus = "pending" | "running" | "succeeded" | "failed";

export interface QueuedTaskRecord {
  id: string;
  workspaceId: string;
  agentId: string;
  runtimeId: string;
  routerSessionId?: string;
  issueId?: string;
  triggerType: string;
  priority: number;
  status: NativeTaskStatus;
  inputJson: string;
  requestedByUserId?: string;
  requestedByDisplayName?: string;
  resultJson?: string;
  errorText?: string;
  sessionId?: string;
  workDir?: string;
  queuedAt: string;
  claimedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskMessageRecord {
  id: string;
  taskId: string;
  seq: number;
  type: string;
  tool?: string;
  content?: string;
  inputJson?: string;
  output?: string;
  createdAt: string;
}

export interface TaskExecutionEventRecord {
  id: string;
  workspaceId: string;
  taskId: string;
  channelName: string;
  agentId: string;
  runtimeId?: string;
  runId?: string;
  type: TaskExecutionEventType;
  title: string;
  summary?: string;
  severity: TaskExecutionEventSeverity;
  status?: TaskExecutionEventStatus;
  dataJson: string;
  createdAt: string;
}

export interface EnqueueTaskInput {
  workspaceId?: string;
  taskId?: string;
  assignee: string;
  title: string;
  channel?: string;
  priority: "low" | "medium" | "high";
  triggerType?: string;
  requestedByUserId?: string;
  requestedByDisplayName?: string;
  metadata?: Record<string, unknown>;
}

export function isNativeTaskStatus(value: unknown): value is NativeTaskStatus {
  return (
    value === "queued" ||
    value === "claimed" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  );
}

export function isTaskExecutionEventType(value: unknown): value is TaskExecutionEventType {
  return typeof value === "string" && TASK_EXECUTION_EVENT_TYPES.includes(value as TaskExecutionEventType);
}

export function isTaskExecutionEventSeverity(value: unknown): value is TaskExecutionEventSeverity {
  return value === "info" || value === "warning" || value === "error";
}

export function isTaskExecutionEventStatus(value: unknown): value is TaskExecutionEventStatus {
  return value === "pending" || value === "running" || value === "succeeded" || value === "failed";
}

export interface ModelPricingRecord {
  modelId: string;
  displayName: string;
  inputPer1M: number;
  outputPer1M: number;
  updatedAt: string;
}

export interface TokenUsageRecord {
  id: string;
  workspaceId: string;
  taskQueueId: string;
  agentId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  channelName?: string;
  createdAt: string;
}

export type BudgetScope = "workspace" | "agent" | "channel";
export type BudgetPeriod = "monthly" | "total";
export type BudgetAction = "pause" | "approve" | "warn";

export interface BudgetRecord {
  id: string;
  workspaceId: string;
  scope: BudgetScope;
  scopeId: string;
  limitUsd: number;
  period: BudgetPeriod;
  action: BudgetAction;
  warningThreshold: number;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export function priorityToNumber(priority: EnqueueTaskInput["priority"]): number {
  if (priority === "high") {
    return 3;
  }
  if (priority === "medium") {
    return 2;
  }
  return 1;
}
