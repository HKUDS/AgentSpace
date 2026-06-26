import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { cache } from "react";
import {
  buildLegacyAgentIdForEmployeeName,
  isSystemSkillName,
  inferAttachmentKind,
  listKnowledgeAssignmentPoliciesSync,
  listKnowledgeAssignmentsSync,
  listDocumentAgentAccessSync,
  listDocumentPermissionRequestsSync,
  listEmployeeSkillIdsByAgentIdMapSync,
  listWorkspaceSkillsSync,
  readWorkspaceStateSnapshotSync,
  resolveChannelHumanMemberNames,
  resolveAttachmentMediaType,
  getCostDashboardDataSync,
  getChannelAccessSummaryForActorSync,
  canReadChannelForActorSync,
  listBudgetsWithSpentSync,
  getPerformanceDashboardDataSync,
  normalizeRuntimeProviderHealth,
  normalizeCliHubReadiness,
  listNotificationsForRecipientSync,
  listAgentForkInvitationsForActorSync,
  listAgentForkInvitationsForSourceAgentSync,
  listAgentAccessRequestsForActorSync,
} from "@agent-space/services";
import type { AgentAccessRequestRecord, AgentForkInvitationRecord, PerformanceDashboardData, WorkspaceNotificationRecord } from "@agent-space/services";
import {
  DEFAULT_WORKSPACE_ID,
  countUsersSync,
  listAgentGoogleWorkspaceDelegationsSync,
  listDaemonApiTokensSync,
  listDaemonSnapshotsSync,
  listEmployeeRuntimeBindingsSync,
  listGoogleOAuthCredentialsSync,
  listQueuedTasksSync,
  listRuntimeAppOperationsSync,
  listRuntimeInstalledAppsSync,
  listRuntimeGrantsSync,
  listStoredSkillImportEventsSync,
  listAgentRouterProviderSessionsSync,
  listAgentTaskAttemptsSync,
  readAgentRouterSessionSync,
  listTaskMessagesForTaskSync,
  listTaskExecutionEventsSync,
  listWorkspaceRuntimeDisplayNamesSync,
  listWorkspaceMemberUsersSync,
  readActiveGoogleOAuthCredentialSync,
} from "@agent-space/db";
import type { BudgetAction, BudgetPeriod, BudgetScope, TaskExecutionEventRecord, TaskExecutionEventType, WorkspaceMemberUserRecord, WorkspaceRole } from "@agent-space/db";
import type {
  ActiveEmployee,
  AgentSpaceState,
  AutomationRule,
  ChannelRecord,
  ChannelDocument,
  ChannelDocumentVersion,
  DataTable,
  ExternalSheetOperationRun,
  KnowledgeAssignmentMode,
  KnowledgePage,
  LedgerItem,
  MessageAttachment,
  ScheduledTask,
  TaskRecord,
  TaskStatus,
  Template,
  WorkspaceSkill,
  WorkspaceMessage,
} from "@agent-space/domain/workspace";
import type {
  ChannelDocumentBlock,
  ChannelDocumentAccessRole,
  ChannelDocumentChangeSet,
  ChannelDocumentConflict,
  ChannelDocumentPresence,
  ChannelDocumentRun,
  ChannelDocumentRunStep,
} from "@agent-space/domain";
import { formatDaemonProviderLabel } from "@agent-space/domain";
import type { RuntimeProviderHealth } from "@agent-space/domain";
import { formatCompactTimestamp } from "@/shared/lib/time-format";
import {
  buildFeishuAgentBotSetupReference,
  listFeishuIntegrationSettingsItems,
} from "@/features/integrations/feishu/feishu-settings-data";
import type {
  FeishuAgentBotSetupReference,
  FeishuIntegrationSettingsItem,
} from "@/features/integrations/feishu/feishu-types";
export {
  getApprovalsPageData,
  getPendingApprovalCount,
  type ApprovalItem,
  type ApprovalItemKind,
  type ApprovalItemStatus,
  type ApprovalQueueActor,
  type ApprovalsPageData,
} from "@/features/approvals/approval-queue-data";

const readWorkspaceStateCached = cache((workspaceId: string) => readWorkspaceStateSnapshotSync(workspaceId));
const listWorkspaceSkillsCached = cache((workspaceId: string) => listWorkspaceSkillsSync(workspaceId));
const listKnowledgeAssignmentPoliciesCached = cache((workspaceId: string) => listKnowledgeAssignmentPoliciesSync(workspaceId));
const listKnowledgeAssignmentsCached = cache((workspaceId: string) => listKnowledgeAssignmentsSync(workspaceId));
const listDaemonSnapshotsCached = cache((workspaceId: string) => listDaemonSnapshotsSync(workspaceId));
const listEmployeeRuntimeBindingsCached = cache((workspaceId: string) => listEmployeeRuntimeBindingsSync(workspaceId));
const listQueuedTasksCached = cache((workspaceId: string) => listQueuedTasksSync({ workspaceId }));
const readAgentRouterSessionCached = cache((routerSessionId: string) => readAgentRouterSessionSync(routerSessionId));
const listAgentTaskAttemptsCached = cache((workspaceId: string, taskQueueId: string) =>
  listAgentTaskAttemptsSync({ workspaceId, taskQueueId, limit: 20 })
);
const listAgentRouterProviderSessionsCached = cache((workspaceId: string, routerSessionId: string) =>
  listAgentRouterProviderSessionsSync({ workspaceId, routerSessionId })
);
const listRuntimeInstalledAppsCached = cache((workspaceId: string) => listRuntimeInstalledAppsSync({ workspaceId }));
const listRuntimeAppOperationsCached = cache((workspaceId: string, limit: number) => listRuntimeAppOperationsSync({ workspaceId, limit }));
const listTaskExecutionEventsCached = cache((workspaceId: string, taskId: string, limit: number) =>
  listTaskExecutionEventsSync({ workspaceId, taskId, limit, order: "asc" })
);
const listRuntimeGrantsCached = cache((workspaceId: string) => listRuntimeGrantsSync(workspaceId));
const listWorkspaceRuntimeDisplayNamesCached = cache((workspaceId: string) =>
  listWorkspaceRuntimeDisplayNamesSync(workspaceId)
);
const listWorkspaceMemberUsersCached = cache((workspaceId: string) => listWorkspaceMemberUsersSync(workspaceId));
const listAgentGoogleWorkspaceDelegationsCached = cache((workspaceId: string) => listAgentGoogleWorkspaceDelegationsSync(workspaceId));
const listGoogleOAuthCredentialsCached = cache((workspaceId: string) => listGoogleOAuthCredentialsSync(workspaceId));
const readActiveGoogleOAuthCredentialCached = cache((workspaceId: string, userId: string) =>
  readActiveGoogleOAuthCredentialSync({ workspaceId, userId })
);
const listDaemonApiTokensCached = cache((workspaceId: string) => listDaemonApiTokensSync(workspaceId));
const listStoredSkillImportEventsCached = cache((workspaceId: string, limit: number) => listStoredSkillImportEventsSync(workspaceId, limit));
const getCostDashboardDataCached = cache((period: BudgetPeriod, workspaceId: string) => getCostDashboardDataSync(period, workspaceId));
const listBudgetsWithSpentCached = cache((workspaceId: string) => listBudgetsWithSpentSync(workspaceId));
const getPerformanceDashboardDataCached = cache((workspaceId: string) => getPerformanceDashboardDataSync(workspaceId));
const INBOX_TASK_ITEM_LIMIT = 60;
const TASK_BOARD_TASK_LIMIT = 180;
const AGENT_TASK_PREVIEW_LIMIT = 12;
const AGENT_KNOWLEDGE_PREVIEW_LIMIT = 20;
const AGENT_ASSIGNABLE_KNOWLEDGE_LIMIT = 120;
const KNOWLEDGE_PAGE_PREVIEW_LIMIT = 120;

export type InboxItemKind = "notification" | "task" | "channel" | "activity";

export interface InboxTimelineEntry {
  id: string;
  role: "human" | "agent" | "assistant" | "user" | "system";
  actor: string;
  timestamp: string;
  body: string;
  attachments?: MessageAttachment[];
  status?: "completed" | "error";
}

export type TaskExecutionTimelineCategory = "status" | "tool" | "artifact" | "approval" | "error" | "handoff";
export type TaskExecutionTimelineAction = "retry" | "grant_permission" | "handoff" | "mark_blocked" | "rollback";

export interface TaskExecutionTimelineEntry {
  id: string;
  type: TaskExecutionEventType;
  category: TaskExecutionTimelineCategory;
  title: string;
  summary?: string;
  severity: "info" | "warning" | "error";
  status?: "pending" | "running" | "succeeded" | "failed";
  createdAt: string;
  targetHref?: string;
  nextActions?: TaskExecutionTimelineAction[];
}

export interface RouterExecutionAttemptView {
  id: string;
  runtimeId: string;
  provider: string;
  providerSessionId?: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  errorText?: string;
  handoffSnapshotId?: string;
  routingMode?: string;
  fallbackReason?: string;
}

export interface RouterProviderSessionView {
  id: string;
  runtimeId: string;
  provider: string;
  providerSessionId: string;
  status: string;
  lastUsedAt?: string;
  lastError?: string;
}

export interface RouterExecutionView {
  routerSessionId: string;
  conversationKey?: string;
  sourceType?: string;
  continuationMode: "same_provider_resume" | "cold_rebuild" | "fallback";
  attempts: RouterExecutionAttemptView[];
  providerSessions: RouterProviderSessionView[];
}

export interface InboxItem {
  id: string;
  kind: InboxItemKind;
  title: string;
  subtitle: string;
  meta: string;
  channelKind?: "group" | "direct";
  timestamp: string;
  unread: boolean;
  statusLabel: string;
  statusTone: "neutral" | "positive" | "warning" | "danger";
  body: string;
  actionHref?: string;
  attachments?: MessageAttachment[];
  history: InboxTimelineEntry[];
  notification?: WorkspaceNotificationRecord;
  task?: TaskRecord;
  channelName?: string;
  activity?: LedgerItem;
  execution?: {
    queueId: string;
    queueStatus: string;
    runtimeId: string;
    runtimeName?: string;
    provider?: string;
    daemonMode?: "local" | "remote";
    serverUrl?: string;
    sessionId?: string;
    router?: RouterExecutionView;
    workDir?: string;
    workDirAccess?: "local" | "remote";
    workDirHostLabel?: string;
    errorText?: string;
    messageCount: number;
    currentEvent?: TaskExecutionTimelineEntry;
    timeline: TaskExecutionTimelineEntry[];
  };
}

export interface InboxPageData {
  items: InboxItem[];
  totalCount: number;
  unreadCount: number;
  notificationCount: number;
  taskCount: number;
  channelCount: number;
  activityCount: number;
}

interface DashboardCurrentUser {
  id: string;
  displayName?: string;
  role?: WorkspaceRole;
}

export interface ContactListItem {
  id: string;
  name: string;
  subtitle: string;
  summary: string;
  lastMessage?: string;
  updatedAt?: string;
  channelName?: string;
}

export interface ChannelListItem {
  id: string;
  name: string;
  channelName?: string;
  contactId?: string;
  humanContactUserId?: string;
  memberLabel: string;
  humanMemberNames?: string[];
  employeeNames?: string[];
  lastMessage?: string;
  updatedAt?: string;
  kind?: "group" | "direct";
  directParticipantKind?: "agent" | "human";
  displayName?: string;
  displaySubtitle?: string;
  avatarLabel?: string;
  memberCount?: number;
  unread?: boolean;
  canManage?: boolean;
  accessState?: "accessible" | "pending" | "requestable";
  accessRequestId?: string;
  feishu?: ChannelFeishuSummaryRecord;
}

export interface ChannelFeishuSummaryRecord {
  bindingCount: number;
  externalChatReference?: string;
  externalChatName?: string;
  externalChatType?: string;
  provisionSource?: string;
  reviewStatus?: string;
  connectedAgentBots: Array<{
    integrationId: string;
    displayName: string;
    agentId: string;
    status: string;
    unboundUserMode?: string;
    guestPermissionProfile?: string;
  }>;
  resourceBindings: Array<{
    id: string;
    integrationId: string;
    integrationDisplayName: string;
    providerResourceType: string;
    displayName?: string;
    canWrite: boolean;
    guestReadable: boolean;
    status: string;
  }>;
}

export interface ChannelThreadData {
  channelName: string;
  messages: WorkspaceMessage[];
}

export interface ChannelsPageData {
  workspaceId: string;
  googleWorkspace: {
    status: "connected" | "not_connected";
    email?: string;
    scopes?: string[];
    updatedAt?: string;
    expiresAt?: string;
  };
  channels: ChannelListItem[];
  threads: ChannelThreadData[];
  documents: ChannelDocumentRecord[];
  documentRuns: ChannelDocumentRunRecord[];
  documentConflicts: ChannelDocumentConflictRecord[];
  channelFiles: ChannelFileRecord[];
  mentionCandidates: Array<{
    id: string;
    label: string;
    subtitle: string;
    channels: string[];
    kind?: "agent" | "human";
  }>;
  channelMemberCandidates?: Array<{
    id: string;
    label: string;
    kind: "human" | "agent";
    meta: string;
    email?: string;
  }>;
  totalChannels: number;
  detailScope?: string[];
}

export type ChannelDetailPageData = Pick<
  ChannelsPageData,
  "channelFiles" | "detailScope" | "documentConflicts" | "documentRuns" | "documents" | "threads"
>;

export interface ChannelDocumentVersionRecord {
  id: string;
  summary: string;
  createdAt: string;
  createdBy: string;
  createdByType: ChannelDocumentVersion["createdByType"];
  triggerType: ChannelDocumentVersion["triggerType"];
  sourceMessageId?: string;
  sourceAttachmentId?: string;
  sourceAttachmentStoredPath?: string;
}

export interface ChannelDocumentChangeSetRecord {
  id: string;
  documentId: string;
  actorId: string;
  actorType: ChannelDocumentChangeSet["actorType"];
  baseVersionId: string;
  documentVersionId?: string;
  status: ChannelDocumentChangeSet["status"];
  sourceMessageId?: string;
  sourceTaskQueueId?: string;
  createdAt: string;
  operationSummary: string;
  retryable: boolean;
  sourceMessage?: {
    id: string;
    speaker: string;
    summary: string;
    time: string;
  };
  sourceTask?: {
    id: string;
    title: string;
    status: string;
  };
  sourceStep?: {
    id: string;
    runId: string;
    agentLabel: string;
    instruction: string;
    status: ChannelDocumentRunStep["status"];
  };
}

export interface ChannelDocumentPresenceRecord {
  actorId: string;
  actorType: ChannelDocumentPresence["actorType"];
  status: ChannelDocumentPresence["status"];
  updatedAt: string;
  isCurrentUser: boolean;
}

export interface ChannelDocumentAccessRecord {
  actorId: string;
  actorType: "human" | "agent";
  role: ChannelDocumentAccessRole;
  isCurrentUser: boolean;
}

export interface ChannelDocumentCollaboratorCandidateRecord {
  actorId: string;
  actorType: "human" | "agent";
  label: string;
  subtitle: string;
}

export interface ChannelDocumentSyncEventRecord {
  actorId: string;
  actorType: ChannelDocumentVersion["createdByType"];
  triggerType: ChannelDocumentVersion["triggerType"];
  versionId: string;
  createdAt: string;
  isRecent: boolean;
  sourceMessage?: {
    id: string;
    speaker: string;
    summary: string;
    time: string;
  };
  sourceTask?: {
    id: string;
    title: string;
    status: string;
  };
  sourceStep?: {
    id: string;
    runId: string;
    agentLabel: string;
    instruction: string;
    status: ChannelDocumentRunStep["status"];
  };
}

export interface ChannelDocumentRecord {
  id: string;
  channelName: string;
  title: string;
  slug: string;
  kind: ChannelDocument["kind"];
  storageMode: NonNullable<ChannelDocument["storageMode"]>;
  currentVersionId: string;
  summary: string;
  status: ChannelDocument["status"];
  updatedAt: string;
  updatedBy: string;
  lastEditorType: ChannelDocument["lastEditorType"];
  contentMarkdown: string;
  versionCount: number;
  conflictCount: number;
  versions: ChannelDocumentVersionRecord[];
  changeSets: ChannelDocumentChangeSetRecord[];
  activePresences: ChannelDocumentPresenceRecord[];
  currentUserRole: ChannelDocumentAccessRole;
  collaborators: ChannelDocumentAccessRecord[];
  availableCollaborators: ChannelDocumentCollaboratorCandidateRecord[];
  lastBackgroundSync?: ChannelDocumentSyncEventRecord;
  externalSheet?: {
    provider: "google_workspace";
    externalFileId: string;
    externalUrl: string;
    externalRevisionId?: string;
    syncStatus: NonNullable<ChannelDocument["externalSyncStatus"]>;
    externalMimeType?: string;
    externalUpdatedAt?: string;
  };
  externalSheetOperations: ChannelDocumentExternalSheetOperationRecord[];
}

export interface ChannelDocumentExternalSheetOperationRecord {
  id: string;
  actorType: ExternalSheetOperationRun["actorType"];
  actorId: string;
  delegatedUserId?: string;
  delegatedUserDisplayName?: string;
  delegatedGoogleEmail?: string;
  credentialDelegationId?: string;
  status: ExternalSheetOperationRun["status"];
  intent: string;
  operationType: ExternalSheetOperationRun["operationType"];
  rangeA1?: string;
  affectedRows?: number;
  affectedCells?: number;
  requestSummary: string;
  responseSummary?: string;
  errorCode?: string;
  errorMessage?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface ChannelDocumentRunRecord {
  id: string;
  channelName: string;
  sourceMessageId: string;
  sourceSummary: string;
  mode: ChannelDocumentRun["mode"];
  status: ChannelDocumentRun["status"];
  createdAt: string;
  updatedAt: string;
  steps: Array<{
    id: string;
    agentId: string;
    agentLabel: string;
    instruction: string;
    status: ChannelDocumentRunStep["status"];
    handoffKind: ChannelDocumentRunStep["handoffKind"];
    documentId?: string;
    documentVersionId?: string;
    lastError?: string;
    lastWarning?: string;
  }>;
}

export interface ChannelDocumentConflictRecord {
  id: string;
  documentId: string;
  documentTitle: string;
  blockId: string;
  status: ChannelDocumentConflict["status"];
  createdAt: string;
  leftChangeSet?: ChannelDocumentChangeSetRecord;
  rightChangeSet?: ChannelDocumentChangeSetRecord;
  mergePreview?: {
    mode: "document" | "block";
    currentLabel: string;
    currentContentMarkdown: string;
    incomingLabel: string;
    incomingContentMarkdown: string;
    suggestedDraftContentMarkdown: string;
    suggestedDraftTitle?: string;
    suggestedDraftSummary?: string;
  };
}

export interface ChannelFileRecord {
  id: string;
  channelName: string;
  fileName: string;
  sourceMessageId?: string;
  sourceSpeaker?: string;
  sourceTime?: string;
  uploaderUserId?: string;
  uploaderDisplayName?: string;
  previewText?: string;
  mediaType: string;
  sizeBytes: number;
  kind: MessageAttachment["kind"];
  isMarkdown: boolean;
  canDelete: boolean;
  deleteBlockedReason?: string;
  retainedBecauseReferenced: boolean;
}

export type WorkspaceAgentStatus = "online" | "busy" | "blocked" | "linked" | "error";

interface ManagementRecordBase {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  status: WorkspaceAgentStatus;
  statusLabel: string;
  tags: string[];
}

export interface AgentWorkAreaRecord {
  id: string;
  queueId: string;
  title: string;
  channel?: string;
  queueStatus: string;
  taskStatus?: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  sessionId?: string;
  router?: RouterExecutionView;
  workDir?: string;
  workDirAccess?: "local" | "remote";
  workDirHostLabel?: string;
  errorText?: string;
}

export interface WorkspaceAgentGoogleWorkspaceDelegationRecord {
  status: "not_delegated" | "connected" | "reconnect_required" | "revoked";
  delegationId?: string;
  userId?: string;
  delegatedByDisplayName?: string;
  googleEmail?: string;
  scopes?: string[];
  updatedAt?: string;
  expiresAt?: string;
  canRevoke: boolean;
}

export interface WorkspaceAgentDocumentAccessRecord {
  id: string;
  documentId: string;
  documentTitle: string;
  channelName: string;
  role: "viewer" | "editor" | "forwarder";
  source: "explicit_grant";
  storageMode: "native" | "external";
  externalProvider?: string;
  externalFileId?: string;
  externalUrl?: string;
  latestExternalRunStatus?: string;
  latestExternalRunAt?: string;
  latestExternalRunError?: string;
  updatedAt: string;
}

export interface WorkspaceAgentDocumentPermissionRequestRecord {
  id: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requestedRole: "viewer" | "editor" | "forwarder";
  targetLabel: string;
  documentId?: string;
  documentTitle?: string;
  externalProvider?: string;
  externalFileId?: string;
  externalUrl?: string;
  requestedForChannelName?: string;
  reason: string;
  decisionNote?: string;
  createdAt: string;
  decidedAt?: string;
}

export interface WorkspaceAgentDocumentAccessSummaryRecord {
  readableCount: number;
  editableCount: number;
  forwardableCount: number;
  externalCount: number;
  pendingRequestCount: number;
  rejectedRequestCount: number;
  grants: WorkspaceAgentDocumentAccessRecord[];
  requests: WorkspaceAgentDocumentPermissionRequestRecord[];
}

export interface WorkspaceAgentForkInvitationView {
  id: string;
  sourceAgentName: string;
  sourceAgentDisplayName: string;
  targetUserId: string;
  targetDisplayName?: string;
  createdByUserId: string;
  createdByDisplayName?: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  createdAt: string;
  updatedAt: string;
  acceptedAgentName?: string;
  acceptedRuntimeId?: string;
  contextNote?: string;
  copyProfile: boolean;
  copyInstructions: boolean;
  copySkills: boolean;
  copyKnowledgeAssignments: boolean;
  copiedSkillCount: number;
  copiedKnowledgePageCount: number;
  suggestedAgentName: string;
}

export interface WorkspaceAgentAccessRequestView {
  id: string;
  sourceAgentName: string;
  requesterUserId: string;
  requesterDisplayName?: string;
  requestType: "fork_copy" | "channel_use";
  targetChannelName?: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reason: string;
  resolverUserId?: string;
  resolverDisplayName?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  forkInvitationId?: string;
  canDecide: boolean;
}

export interface DigitalEmployeeShowcaseAgentRecord extends ManagementRecordBase {
  kind: "digital_employee_showcase_agent";
  internalName: string;
  role: string;
  summary: string;
  fit: string;
  traits: string[];
  ownerUserId?: string;
  ownerDisplayName?: string;
  managedByLabel: string;
  canManage: boolean;
  isOwnedByCurrentUser: boolean;
  channelMemberAccess: "enabled" | "disabled";
  channels: string[];
  commonChannels: string[];
  skillCount: number;
  knowledgeCount: number;
  skillHighlights: Array<{
    name: string;
    summary?: string;
  }>;
  knowledgeHighlights: Array<{
    title: string;
    source: "direct" | "inherited";
  }>;
  readiness: {
    status: "ready" | "needs_runtime" | "runtime_offline" | "provider_unusable" | "unknown";
    label: string;
    reason?: string;
  };
  usageHints: string[];
  lastActivityAt?: string;
  requestableActions: Array<"fork_copy" | "channel_use">;
  forkedFrom?: {
    sourceAgentName: string;
    invitationId: string;
  };
  pendingRequest?: WorkspaceAgentAccessRequestView;
  latestRequest?: WorkspaceAgentAccessRequestView;
  pendingForkInvitation?: WorkspaceAgentForkInvitationView;
  reviewableRequests: WorkspaceAgentAccessRequestView[];
}

export interface WorkspaceAgentRecord extends ManagementRecordBase {
  kind: "agent";
  internalName: string;
  ownerUserId?: string;
  ownerDisplayName?: string;
  canManage: boolean;
  canManageChannelMemberAccess: boolean;
  channelMemberAccess: "enabled" | "disabled";
  origin: string;
  fit: string;
  summary: string;
  skills: WorkspaceSkill[];
  channels: string[];
  tasks: TaskRecord[];
  recentMessages: WorkspaceMessage[];
  boundContainerId?: string;
  boundContainerName?: string;
  boundContainerStatus?: "online" | "offline";
  boundProvider?: string;
  boundProviderHealth?: RuntimeProviderHealth;
  boundAt?: string;
  workAreas: AgentWorkAreaRecord[];
  instructions?: string;
  knowledge?: WorkspaceAgentKnowledgeRecord;
  googleWorkspaceDelegation?: WorkspaceAgentGoogleWorkspaceDelegationRecord;
  feishuAgentBot?: FeishuIntegrationSettingsItem;
  feishuAgentBotSetupReference?: FeishuAgentBotSetupReference;
  canManageFeishuAgentBot?: boolean;
  documentAccess?: WorkspaceAgentDocumentAccessSummaryRecord;
  forkedFrom?: {
    sourceAgentName: string;
    invitationId: string;
  };
  forkInvitations?: WorkspaceAgentForkInvitationView[];
}

export interface KnowledgeAgentOption {
  id: string;
  employeeName: string;
  name: string;
  subtitle: string;
  status: WorkspaceAgentStatus;
}

export interface KnowledgeAssignedAgentRecord extends KnowledgeAgentOption {
  assignedAt?: string;
  assignedBy?: string;
}

export interface KnowledgePageRecord extends KnowledgePage {
  assignmentMode: KnowledgeAssignmentMode;
  assignmentUpdatedAt?: string;
  assignmentUpdatedBy?: string;
  assignedAgents: KnowledgeAssignedAgentRecord[];
  assignedAgentIds: string[];
  assignedEmployeeNames: string[];
  assignedAgentCount: number;
  effectiveAgentCount: number;
  assignmentSummary: string;
}

export interface KnowledgeAssignmentStats {
  allAgentsPageCount: number;
  selectedAgentsPageCount: number;
  unconfiguredPageCount: number;
}

export interface AgentKnowledgePageRecord {
  id: string;
  title: string;
  tags: string[];
  updatedAt: string;
  assignmentMode: KnowledgeAssignmentMode;
  sourceLabel?: string;
}

export interface WorkspaceAgentKnowledgeRecord {
  directPageIds: string[];
  inheritedPages: AgentKnowledgePageRecord[];
  directPages: AgentKnowledgePageRecord[];
  assignablePages: AgentKnowledgePageRecord[];
  totalAvailableCount: number;
  directCount: number;
  inheritedCount: number;
}

export interface ContainerRecord extends ManagementRecordBase {
  kind: "container";
  runtimeId: string;
  provider: string;
  displayName?: string;
  daemonKey: string;
  deviceName: string;
  runtimeStatus: "online" | "offline";
  providerHealth: RuntimeProviderHealth;
  daemonMode?: "local" | "remote";
  serverUrl?: string;
  version?: string;
  lastHeartbeatAt?: string;
  executablePath?: string;
  daemonPid?: string;
  cliHubReadiness?: CliHubReadinessRecord;
  installedApps: RuntimeInstalledAppView[];
  recentAppOperations: RuntimeAppOperationView[];
  grantedMembers: RuntimeGrantMember[];
  canManageGrants: boolean;
  boundEmployees: string[];
  agentCount: number;
  queueCounts: {
    queued: number;
    running: number;
    failed: number;
    completed: number;
  };
  recentExecutions: Array<{
    queueId: string;
    taskId?: string;
    title: string;
    assignee: string;
    channel?: string;
    queueStatus: string;
    taskStatus?: string;
    messageCount: number;
    startedAt?: string;
    finishedAt?: string;
    sessionId?: string;
    router?: RouterExecutionView;
    workDir?: string;
    workDirAccess?: "local" | "remote";
    workDirHostLabel?: string;
    errorText?: string;
    taskMessages: Array<{
      id: string;
      type: string;
      content: string;
      createdAt: string;
      status: "completed" | "error";
    }>;
    timeline: TaskExecutionTimelineEntry[];
  }>;
}

export interface CliHubReadinessRecord {
  checkedAt?: string;
  python: ReadinessItemView;
  pip: ReadinessItemView;
  cliHub: ReadinessItemView;
  npm: ReadinessItemView;
  uv: ReadinessItemView;
}

export interface RuntimeInstalledAppView {
  source: string;
  name: string;
  displayName: string;
  version: string;
  entryPoint: string;
  status: string;
  enabled: boolean;
  lastError?: string;
  updatedAt: string;
}

export interface RuntimeAppOperationView {
  id: string;
  appSource: string;
  appName: string;
  operation: string;
  status: string;
  createdAt: string;
  errorMessage?: string;
}

export interface RuntimeGrantMember {
  userId: string;
  displayName: string;
  primaryEmail?: string;
  role: WorkspaceRole;
}

export interface AgentsPageData {
  containers: ContainerRecord[];
  agents: WorkspaceAgentRecord[];
  showcaseAgents: DigitalEmployeeShowcaseAgentRecord[];
  daemonSnapshots: DaemonSnapshotView[];
  daemonTokens: DaemonTokenView[];
  workspaceSkills: WorkspaceSkill[];
  channels: Array<{
    name: string;
    memberLabel: string;
  }>;
  workspaceMembers: RuntimeGrantMember[];
  pendingForkInvitations: WorkspaceAgentForkInvitationView[];
  containerOptions: Array<{
    id: string;
    label: string;
    provider: string;
    status: "online" | "offline";
    providerHealth: RuntimeProviderHealth;
    serverName: string;
    daemonKey: string;
    mode?: "local" | "remote";
  }>;
  currentUserId?: string;
  currentMembershipRole?: WorkspaceRole;
  canConnectRuntimes: boolean;
  canManageRuntimes: boolean;
  canManageAllAgents: boolean;
  canCreateAgent: boolean;
  totalAgents: number;
  containerCount: number;
  boundAgentCount: number;
  unboundAgentCount: number;
  activeTaskCount: number;
  activeWorkAreaCount: number;
}

export interface DaemonSnapshotView {
  daemonKey: string;
  deviceName: string;
  status: "online" | "offline";
  lastHeartbeatAt?: string;
  mode: "local" | "remote";
  serverUrl?: string;
  runtimeName?: string;
  googleWorkspaceReadiness?: GoogleWorkspaceReadinessView;
  runtimes: Array<{
    id: string;
    provider: string;
    name: string;
    displayName?: string;
    status: "online" | "offline";
    providerHealth: RuntimeProviderHealth;
    lastHeartbeatAt?: string;
    version: string;
  }>;
}

export interface GoogleWorkspaceReadinessView {
  checkedAt?: string;
  executor: string;
  agentSpaceOutput: ReadinessItemView;
  gws: ReadinessItemView;
  bwrap: ReadinessItemView & {
    supportsPerms?: boolean;
  };
  latestOperationFailure?: {
    operationType: string;
    errorCode?: string;
    errorMessage?: string;
    finishedAt?: string;
  };
}

export interface ReadinessItemView {
  available: boolean;
  version?: string;
  error?: string;
}

export interface DaemonTokenView {
  id: string;
  label: string;
  status: "active" | "revoked";
  createdBy: string;
  lastUsedAt?: string;
  createdAt: string;
  revokedAt?: string;
}

export interface SkillsPageData {
  skills: Array<WorkspaceSkill & {
    isBuiltin: boolean;
  }>;
  totalSkills: number;
  assignedSkillCount: number;
  recentImports: Array<{
    id: string;
    skillId?: string;
    skillName: string;
    sourceType: string;
    sourceUrl?: string;
    importMode: "created" | "renamed" | "replaced";
    importedAt: string;
    warnings: string[];
  }>;
  agents: Array<{
    id: string;
    name: string;
    internalName: string;
    skillIds: string[];
  }>;
}

function isDirectChannelRecord(channel: Pick<ChannelRecord, "kind">): boolean {
  return channel.kind === "direct";
}

function normalizeChannelScope(channelNames?: string[]): Set<string> | null {
  if (!channelNames) {
    return null;
  }
  const normalized = channelNames.map((name) => name.trim()).filter(Boolean);
  return new Set(normalized);
}

function resolveDirectChannelForContact(
  state: AgentSpaceState,
  currentUserDisplayName: string | undefined,
  employeeName: string,
  workspaceId?: string,
  currentUserId?: string,
  currentMembershipRole?: WorkspaceRole,
): ChannelRecord | null {
  const candidates = state.channels.filter(
    (channel) =>
      isDirectChannelRecord(channel) &&
      channel.employeeNames.some((name) => sameText(name, employeeName)),
  );
  if (candidates.length === 0) {
    return null;
  }

  if (workspaceId && currentUserId) {
    return (
      candidates.find((channel) =>
        canReadChannelForActorSync({
          workspaceId,
          channelName: channel.name,
          actor: {
            userId: currentUserId,
            displayName: currentUserDisplayName,
            role: currentMembershipRole,
          },
        }),
      ) ?? null
    );
  }

  if (currentUserDisplayName?.trim()) {
    return (
      candidates.find((channel) =>
        (channel.humanMemberNames ?? []).some((name) => sameText(name, currentUserDisplayName)),
      ) ?? null
    );
  }

  return candidates[0] ?? null;
}

function resolveChannelMemberCount(channel: Pick<ChannelRecord, "humanMembers" | "employeeNames">): number {
  const humanCount = Array.isArray((channel as { humanMemberNames?: string[] }).humanMemberNames)
    ? ((channel as { humanMemberNames?: string[] }).humanMemberNames?.length ?? channel.humanMembers)
    : channel.humanMembers;
  return Math.max(0, humanCount) + channel.employeeNames.length;
}

function buildChannelListItem(
  channel: ChannelRecord,
  state: AgentSpaceState,
): ChannelListItem {
  if (isDirectChannelRecord(channel)) {
    const directEmployee = state.activeEmployees.find((employee) =>
      channel.employeeNames.some((name) => sameText(name, employee.name)),
    );
    const humanDirectNames = directEmployee ? [] : resolveChannelHumanMemberNames(state, channel);
    const humanDirectDisplayName = humanDirectNames.length > 0 ? humanDirectNames.join(" / ") : channel.name;
    return {
      id: channel.name,
      name: channel.name,
      memberLabel: `${resolveChannelMemberCount(channel)} humans / ${channel.employeeNames.length} agents`,
      humanMemberNames: resolveChannelHumanMemberNames(state, channel),
      employeeNames: [...channel.employeeNames],
      kind: "direct",
      directParticipantKind: directEmployee ? "agent" : "human",
      displayName: directEmployee?.remarkName?.trim() || directEmployee?.name || humanDirectDisplayName,
      displaySubtitle: directEmployee?.name || "Human direct",
      avatarLabel: directEmployee ? "✦" : humanDirectDisplayName.slice(0, 1).toUpperCase(),
      memberCount: resolveChannelMemberCount(channel),
      canManage: false,
    };
  }

  return {
    id: channel.name,
    name: channel.name,
    memberLabel: `${resolveChannelMemberCount(channel)} humans / ${channel.employeeNames.length} agents`,
    humanMemberNames: resolveChannelHumanMemberNames(state, channel),
    employeeNames: [...channel.employeeNames],
    kind: "group",
    displayName: channel.name,
    avatarLabel: "#",
    memberCount: resolveChannelMemberCount(channel),
    canManage: true,
  };
}

interface MentionUnreadViewer {
  userId?: string;
  displayName?: string;
  ownedAgentNames: Set<string>;
}

function buildMentionUnreadViewer(
  state: AgentSpaceState,
  currentUserDisplayName: string | undefined,
  currentUserId: string | undefined,
): MentionUnreadViewer {
  return {
    userId: currentUserId,
    displayName: currentUserDisplayName?.trim() || undefined,
    ownedAgentNames: new Set(
      currentUserId
        ? (state.activeEmployees ?? [])
            .filter((employee) => employee.ownerUserId === currentUserId)
            .map((employee) => employee.name)
        : [],
    ),
  };
}

function hasUnreadMentionForViewer(messagesNewestFirst: WorkspaceMessage[], viewer: MentionUnreadViewer): boolean {
  if (!viewer.displayName && viewer.ownedAgentNames.size === 0) {
    return false;
  }

  for (const message of messagesNewestFirst) {
    if (viewer.displayName && sameText(message.speaker, viewer.displayName)) {
      return false;
    }

    const mentionsViewer = message.mentions?.some((mention) => isMentionForViewer(mention, viewer)) ?? false;
    if (mentionsViewer && !isMessageAcknowledgedByViewer(message, viewer)) {
      return true;
    }
  }

  return false;
}

function isMentionForViewer(
  mention: NonNullable<WorkspaceMessage["mentions"]>[number],
  viewer: MentionUnreadViewer,
): boolean {
  if (mention.mentionType === "human") {
    return Boolean(
      viewer.displayName
        && (
          sameText(mention.humanId, viewer.displayName)
          || sameText(mention.label, viewer.displayName)
          || sameText(mention.token, viewer.displayName)
        ),
    );
  }

  return Array.from(viewer.ownedAgentNames).some((agentName) =>
    sameText(mention.agentId, agentName) || sameText(mention.label, agentName),
  );
}

function isMessageAcknowledgedByViewer(message: WorkspaceMessage, viewer: MentionUnreadViewer): boolean {
  return message.acknowledgements?.some((acknowledgement) => {
    if (viewer.userId && acknowledgement.userId === viewer.userId) {
      return true;
    }
    if (viewer.displayName && sameText(acknowledgement.label, viewer.displayName)) {
      return true;
    }
    return Array.from(viewer.ownedAgentNames).some((agentName) => sameText(acknowledgement.label, agentName));
  }) ?? false;
}


function buildChannelWorkspaceArtifacts(
  state: AgentSpaceState,
  queuedTasks: ReturnType<typeof listQueuedTasksSync>,
  currentUserDisplayName: string | undefined,
  visibleChannelNames: Set<string>,
  workspaceId: string,
  currentUserId?: string,
  currentMembershipRole?: WorkspaceRole,
): {
  documents: ChannelDocumentRecord[];
  documentRuns: ChannelDocumentRunRecord[];
  documentConflicts: ChannelDocumentConflictRecord[];
  channelFiles: ChannelFileRecord[];
} {
  if (visibleChannelNames.size === 0) {
    return {
      documents: [],
      documentRuns: [],
      documentConflicts: [],
      channelFiles: [],
    };
  }

  const workspaceMemberUsers = listWorkspaceMemberUsersCached(workspaceId);
  const documentById = new Map((state.channelDocuments ?? []).map((document) => [document.id, document]));
  const documentVersionsById = new Map((state.channelDocumentVersions ?? []).map((version) => [version.id, version]));
  const documentVersionsByDocumentId = new Map<string, ChannelDocumentVersion[]>();
  for (const version of state.channelDocumentVersions ?? []) {
    const versions = documentVersionsByDocumentId.get(version.documentId) ?? [];
    versions.push(version);
    documentVersionsByDocumentId.set(version.documentId, versions);
  }
  for (const [documentId, versions] of documentVersionsByDocumentId) {
    documentVersionsByDocumentId.set(
      documentId,
      versions.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    );
  }
  const documentAccessesByDocumentId = new Map<string, NonNullable<AgentSpaceState["channelDocumentAccesses"]>>();
  for (const access of state.channelDocumentAccesses ?? []) {
    const accesses = documentAccessesByDocumentId.get(access.documentId) ?? [];
    accesses.push(access);
    documentAccessesByDocumentId.set(access.documentId, accesses);
  }
  const documentBlocksByDocumentId = new Map<string, ChannelDocumentBlock[]>();
  for (const block of state.channelDocumentBlocks ?? []) {
    const blocks = documentBlocksByDocumentId.get(block.documentId) ?? [];
    blocks.push(block);
    documentBlocksByDocumentId.set(block.documentId, blocks);
  }
  for (const [documentId, blocks] of documentBlocksByDocumentId) {
    documentBlocksByDocumentId.set(documentId, blocks.sort((left, right) => left.order - right.order));
  }
  const messageIndex = new Map((state.messages ?? []).map((message) => [message.id, message]));
  const queuedTaskIndex = new Map(queuedTasks.map((task) => [task.id, task]));
  const rawChangeSetIndex = new Map((state.channelDocumentChangeSets ?? []).map((changeSet) => [changeSet.id, changeSet]));
  const runStepByQueuedTaskId = new Map(
    (state.channelDocumentRunSteps ?? [])
      .filter((step) => typeof step.queuedTaskId === "string" && step.queuedTaskId.length > 0)
      .map((step) => [step.queuedTaskId!, step]),
  );
  const runStepByDocumentVersionId = new Map(
    (state.channelDocumentRunSteps ?? [])
      .filter((step) => typeof step.documentVersionId === "string" && step.documentVersionId.length > 0)
      .map((step) => [step.documentVersionId!, step]),
  );
  const channelDocumentChangeSets = (state.channelDocumentChangeSets ?? []).map((changeSet) =>
    buildChannelDocumentChangeSetRecord(changeSet, {
      messageIndex,
      queuedTaskIndex,
      runStepByQueuedTaskId,
      runStepByDocumentVersionId,
    }),
  );
  const changeSetIndex = new Map(channelDocumentChangeSets.map((changeSet) => [changeSet.id, changeSet]));
  const changeSetsByDocumentId = new Map<string, ChannelDocumentChangeSetRecord[]>();
  for (const changeSet of channelDocumentChangeSets) {
    const changeSets = changeSetsByDocumentId.get(changeSet.documentId) ?? [];
    changeSets.push(changeSet);
    changeSetsByDocumentId.set(changeSet.documentId, changeSets);
  }
  const runStepsByRunId = new Map<string, ChannelDocumentRunStep[]>();
  for (const step of state.channelDocumentRunSteps ?? []) {
    const steps = runStepsByRunId.get(step.runId) ?? [];
    steps.push(step);
    runStepsByRunId.set(step.runId, steps);
  }
  for (const [runId, steps] of runStepsByRunId) {
    runStepsByRunId.set(
      runId,
      steps.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()),
    );
  }
  const activePresencesByDocumentId = new Map<string, ChannelDocumentPresenceRecord[]>();
  const now = Date.now();
  for (const presence of state.channelDocumentPresences ?? []) {
    const updatedAt = new Date(presence.updatedAt).getTime();
    if (!Number.isFinite(updatedAt) || now - updatedAt > CHANNEL_DOCUMENT_PRESENCE_TTL_MS) {
      continue;
    }
    const record: ChannelDocumentPresenceRecord = {
      actorId: presence.actorId,
      actorType: presence.actorType,
      status: presence.status,
      updatedAt: presence.updatedAt,
      isCurrentUser:
        typeof currentUserDisplayName === "string" && currentUserDisplayName.length > 0
          ? currentUserDisplayName.localeCompare(presence.actorId, "zh-CN", { sensitivity: "base" }) === 0
          : false,
    };
    const list = activePresencesByDocumentId.get(presence.documentId) ?? [];
    list.push(record);
    activePresencesByDocumentId.set(presence.documentId, list);
  }
  for (const [documentId, presences] of activePresencesByDocumentId) {
    activePresencesByDocumentId.set(
      documentId,
      presences.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()),
    );
  }
  const externalSheetOperationsByDocumentId = new Map<string, ChannelDocumentExternalSheetOperationRecord[]>();
  for (const run of state.externalSheetOperationRuns ?? []) {
    const list = externalSheetOperationsByDocumentId.get(run.channelDocumentId) ?? [];
    list.push({
      id: run.id,
      actorType: run.actorType,
      actorId: run.actorId,
      delegatedUserId: run.delegatedUserId,
      delegatedUserDisplayName: run.delegatedUserDisplayName,
      delegatedGoogleEmail: run.delegatedGoogleEmail,
      credentialDelegationId: run.credentialDelegationId,
      status: run.status,
      intent: run.intent,
      operationType: run.operationType,
      rangeA1: run.rangeA1,
      affectedRows: run.affectedRows,
      affectedCells: run.affectedCells,
      requestSummary: run.requestSummary,
      responseSummary: run.responseSummary,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    });
    externalSheetOperationsByDocumentId.set(run.channelDocumentId, list);
  }
  for (const [documentId, runs] of externalSheetOperationsByDocumentId) {
    externalSheetOperationsByDocumentId.set(
      documentId,
      runs.sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()),
    );
  }
  const openConflictsByDocumentId = new Map<string, ChannelDocumentConflict[]>();
  for (const conflict of state.channelDocumentConflicts ?? []) {
    if (conflict.status !== "open") {
      continue;
    }
    const conflicts = openConflictsByDocumentId.get(conflict.documentId) ?? [];
    conflicts.push(conflict);
    openConflictsByDocumentId.set(conflict.documentId, conflicts);
  }
  const collaboratorCandidatePool = [
    ...workspaceMemberUsers.map((member) => ({
      actorId: member.displayName,
      actorType: "human" as const,
      label: member.displayName,
      subtitle: member.primaryEmail ?? formatWorkspaceRoleLabel(member.role),
    })),
    ...state.activeEmployees.map((employee) => ({
      actorId: employee.name,
      actorType: "agent" as const,
      label: employee.remarkName?.trim() || employee.name,
      subtitle: employee.role,
    })),
  ].sort((left, right) => left.label.localeCompare(right.label, "zh-CN", { sensitivity: "base" }));
  const attachmentReferenceIndex = buildAttachmentReferenceIndex(state);

  const documents = (state.channelDocuments ?? [])
    .filter((document) => visibleChannelNames.has(document.channelName))
    .flatMap((document) => {
      const versions = documentVersionsByDocumentId.get(document.id) ?? [];
      const currentVersion = documentVersionsById.get(document.currentVersionId) ?? versions[0];
      const lastBackgroundSync = currentVersion
        ? buildChannelDocumentSyncEventRecord(currentVersion, {
            messageIndex,
            queuedTaskIndex,
            runStepByDocumentVersionId,
          })
        : undefined;
      const collaborators = (documentAccessesByDocumentId.get(document.id) ?? [])
        .map((access) => ({
          actorId: access.actorId,
          actorType: access.actorType,
          role: access.role,
          isCurrentUser:
            typeof currentUserDisplayName === "string" && currentUserDisplayName.length > 0
              ? currentUserDisplayName.localeCompare(access.actorId, "zh-CN", { sensitivity: "base" }) === 0
              : false,
        }))
        .sort((left, right) => {
          const rank = (role: ChannelDocumentAccessRole) =>
            role === "owner" ? 0 : role === "forwarder" ? 1 : role === "editor" ? 2 : 3;
          const diff = rank(left.role) - rank(right.role);
          if (diff !== 0) {
            return diff;
          }
          return left.actorId.localeCompare(right.actorId, "zh-CN", { sensitivity: "base" });
        });
      const currentUserAccess = collaborators.find((access) => access.isCurrentUser);
      if (typeof currentUserDisplayName === "string" && currentUserDisplayName.length > 0 && !currentUserAccess) {
        return [];
      }
      const currentUserRole = currentUserAccess?.role ?? "viewer";
      const collaboratorKeys = new Set(
        collaborators.map((access) => `${access.actorType}:${access.actorId.toLocaleLowerCase("zh-CN")}`),
      );
      const availableCollaborators = collaboratorCandidatePool.filter(
        (candidate) => !collaboratorKeys.has(`${candidate.actorType}:${candidate.actorId.toLocaleLowerCase("zh-CN")}`),
      );

      return [{
        id: document.id,
        channelName: document.channelName,
        title: document.title,
        slug: document.slug,
        kind: document.kind,
        storageMode: document.storageMode ?? "native",
        currentVersionId: document.currentVersionId,
        summary: document.summary,
        status: document.status,
        updatedAt: document.updatedAt,
        updatedBy: document.updatedBy,
        lastEditorType: document.lastEditorType,
        contentMarkdown: currentVersion?.contentMarkdown ?? "",
        versionCount: versions.length,
        conflictCount: openConflictsByDocumentId.get(document.id)?.length ?? 0,
        versions: versions.map((version) => ({
          id: version.id,
          summary: version.summary,
          createdAt: version.createdAt,
          createdBy: version.createdBy,
          createdByType: version.createdByType,
          triggerType: version.triggerType,
          sourceMessageId: version.sourceMessageId,
          sourceAttachmentId: version.sourceAttachmentId,
          sourceAttachmentStoredPath: version.sourceAttachmentStoredPath,
        })),
        changeSets: changeSetsByDocumentId.get(document.id) ?? [],
        activePresences: activePresencesByDocumentId.get(document.id) ?? [],
        currentUserRole,
        collaborators,
        availableCollaborators,
        lastBackgroundSync,
        externalSheet: buildExternalSheetRecord(document),
        externalSheetOperations: externalSheetOperationsByDocumentId.get(document.id) ?? [],
      } satisfies ChannelDocumentRecord];
    });
  const accessibleDocumentIds = new Set(documents.map((document) => document.id));

  const documentRuns = (state.channelDocumentRuns ?? [])
    .filter((run) => visibleChannelNames.has(run.channelName))
    .map((run) => ({
      id: run.id,
      channelName: run.channelName,
      sourceMessageId: run.sourceMessageId,
      sourceSummary: run.sourceSummary,
      mode: run.mode,
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      steps: (runStepsByRunId.get(run.id) ?? [])
        .filter((step) => !step.documentId || accessibleDocumentIds.has(step.documentId))
        .map((step) => ({
          id: step.id,
          agentId: step.agentId,
          agentLabel: step.agentLabel,
          instruction: step.instruction,
          status: step.status,
          handoffKind: step.handoffKind,
          documentId: step.documentId,
          documentVersionId: step.documentVersionId,
          lastError: step.lastError,
          lastWarning: step.lastWarning,
        })),
    }) satisfies ChannelDocumentRunRecord);

  const documentConflicts = (state.channelDocumentConflicts ?? [])
    .filter((conflict) => {
      const document = documentById.get(conflict.documentId);
      return Boolean(document && visibleChannelNames.has(document.channelName) && accessibleDocumentIds.has(document.id));
    })
    .map((conflict) => {
      const document = documentById.get(conflict.documentId);
      const currentVersion =
        document ? documentVersionsById.get(document.currentVersionId) : undefined;
      const currentBlocks = documentBlocksByDocumentId.get(conflict.documentId) ?? [];
      return {
        id: conflict.id,
        documentId: conflict.documentId,
        documentTitle: document?.title ?? conflict.documentId,
        blockId: conflict.blockId,
        status: conflict.status,
        createdAt: conflict.createdAt,
        leftChangeSet: changeSetIndex.get(conflict.leftChangeSetId),
        rightChangeSet: changeSetIndex.get(conflict.rightChangeSetId),
        mergePreview: buildChannelDocumentConflictMergePreview({
          conflict,
          document,
          currentVersion,
          currentBlocks,
          rightChangeSet: rawChangeSetIndex.get(conflict.rightChangeSetId),
        }),
      } satisfies ChannelDocumentConflictRecord;
    });

  const channelFiles: ChannelFileRecord[] = [];
  const seenChannelFileIds = new Set<string>();
  for (const message of state.messages ?? []) {
    for (const attachment of message.attachments ?? []) {
      if (attachment.deletedAt) {
        continue;
      }
      const channelName = message.channel ?? "";
      if (
        channelName.trim().length === 0 ||
        !visibleChannelNames.has(channelName) ||
        seenChannelFileIds.has(attachment.id)
      ) {
        continue;
      }
      seenChannelFileIds.add(attachment.id);
      const mediaType = resolveAttachmentMediaType(attachment.fileName, attachment.mediaType);
      const deleteMetadata = buildChannelFileDeleteMetadata({
        state,
        message,
        attachment,
        attachmentReferenceIndex,
        currentUserDisplayName,
        currentUserId,
        currentMembershipRole,
      });
      channelFiles.push({
        id: attachment.id,
        channelName,
        fileName: attachment.fileName,
        sourceMessageId: message.id,
        sourceSpeaker: message.speaker,
        sourceTime: message.time,
        uploaderUserId: message.role === "human" ? message.speakerUserId : undefined,
        uploaderDisplayName: message.role === "human" ? message.speaker : undefined,
        previewText: mediaType === "text/markdown" ? readMarkdownDocumentPreviewText(attachment.storedPath) : mediaType,
        mediaType,
        sizeBytes: attachment.sizeBytes,
        kind: inferAttachmentKind(mediaType),
        isMarkdown: mediaType === "text/markdown",
        canDelete: deleteMetadata.canDelete,
        deleteBlockedReason: deleteMetadata.deleteBlockedReason,
        retainedBecauseReferenced: deleteMetadata.retainedBecauseReferenced,
      });
    }
  }

  return {
    documents,
    documentRuns,
    documentConflicts,
    channelFiles,
  };
}

function buildChannelFileDeleteMetadata(input: {
  state: AgentSpaceState;
  message: WorkspaceMessage;
  attachment: MessageAttachment;
  attachmentReferenceIndex?: AttachmentReferenceIndex;
  currentUserDisplayName?: string;
  currentUserId?: string;
  currentMembershipRole?: WorkspaceRole;
}): Pick<ChannelFileRecord, "canDelete" | "deleteBlockedReason" | "retainedBecauseReferenced"> {
  const retainedBecauseReferenced = isAttachmentReferencedByKnowledgeOrDocument(
    input.state,
    input.attachment,
    input.attachmentReferenceIndex,
  );
  if (!input.currentUserId) {
    return {
      canDelete: false,
      deleteBlockedReason: "Sign in to delete this file.",
      retainedBecauseReferenced,
    };
  }
  if (isWorkspaceManagerRole(input.currentMembershipRole)) {
    return { canDelete: true, retainedBecauseReferenced };
  }
  if (input.message.role !== "human") {
    return {
      canDelete: false,
      deleteBlockedReason: "Only workspace admins can delete agent output files.",
      retainedBecauseReferenced,
    };
  }
  if (input.message.speakerUserId) {
    if (input.message.speakerUserId === input.currentUserId) {
      return { canDelete: true, retainedBecauseReferenced };
    }
    return {
      canDelete: false,
      deleteBlockedReason: "Only the uploader or a workspace admin can delete this file.",
      retainedBecauseReferenced,
    };
  }
  if (input.currentUserDisplayName?.trim() && sameText(input.message.speaker, input.currentUserDisplayName)) {
    return { canDelete: true, retainedBecauseReferenced };
  }
  return {
    canDelete: false,
    deleteBlockedReason: "Only the uploader or a workspace admin can delete this file.",
    retainedBecauseReferenced,
  };
}

interface AttachmentReferenceIndex {
  ids: Set<string>;
  storedPaths: Set<string>;
}

function buildAttachmentReferenceIndex(state: AgentSpaceState): AttachmentReferenceIndex {
  const ids = new Set<string>();
  const storedPaths = new Set<string>();

  for (const page of state.knowledgePages ?? []) {
    if (page.sourceAttachmentId) {
      ids.add(page.sourceAttachmentId);
    }
    if (page.sourceAttachmentStoredPath) {
      storedPaths.add(resolve(page.sourceAttachmentStoredPath));
    }
  }

  for (const version of state.channelDocumentVersions ?? []) {
    if (version.sourceAttachmentId) {
      ids.add(version.sourceAttachmentId);
    }
    if (version.sourceAttachmentStoredPath) {
      storedPaths.add(resolve(version.sourceAttachmentStoredPath));
    }
  }

  return { ids, storedPaths };
}

function isAttachmentReferencedByKnowledgeOrDocument(
  state: AgentSpaceState,
  attachment: MessageAttachment,
  referenceIndex = buildAttachmentReferenceIndex(state),
): boolean {
  const storedPath = resolve(attachment.storedPath);
  return referenceIndex.ids.has(attachment.id) || referenceIndex.storedPaths.has(storedPath);
}

function getVisibleWorkspaceChannelNames(
  state: AgentSpaceState,
  currentUserDisplayName?: string,
): Set<string> {
  if (!currentUserDisplayName?.trim()) {
    return new Set();
  }

  return new Set(
    state.channels
      .filter((channel) =>
        resolveChannelHumanMemberNames(state, channel).some((memberName) => sameText(memberName, currentUserDisplayName)),
      )
    .map((channel) => channel.name),
  );
}

function buildExternalSheetRecord(document: ChannelDocument): ChannelDocumentRecord["externalSheet"] {
  if (
    document.kind !== "sheet" ||
    document.storageMode !== "external" ||
    document.externalProvider !== "google_workspace" ||
    !document.externalFileId ||
    !document.externalUrl
  ) {
    return undefined;
  }

  return {
    provider: "google_workspace",
    externalFileId: document.externalFileId,
    externalUrl: document.externalUrl,
    externalRevisionId: document.externalRevisionId,
    syncStatus: document.externalSyncStatus ?? "unknown",
    externalMimeType: document.externalMimeType,
    externalUpdatedAt: document.externalUpdatedAt,
  };
}

function buildKnowledgeDocumentPageRecords(
  documents: ChannelDocumentRecord[],
  channelFiles: ChannelFileRecord[],
  knowledgePages: KnowledgePage[],
): KnowledgeDocumentPageRecord[] {
  const linkIndex = new Map<string, KnowledgeDocumentPageRecord["linkedKnowledgePages"]>();
  const linkedChannelDocumentIndex = new Map<string, KnowledgeDocumentPageRecord["linkedChannelDocuments"]>();

  for (const page of knowledgePages) {
    const link = { id: page.id, title: page.title };
    if (page.sourceAttachmentId) {
      const key = `attachment:${page.sourceAttachmentId}`;
      const existing = linkIndex.get(key) ?? [];
      existing.push(link);
      linkIndex.set(key, existing);
    }
    if (page.sourceChannelDocumentId) {
      const key = `channelDocument:${page.sourceChannelDocumentId}`;
      const existing = linkIndex.get(key) ?? [];
      existing.push(link);
      linkIndex.set(key, existing);
    }
  }

  for (const document of documents) {
    const attachmentIds = new Set(
      document.versions
        .map((version) => version.sourceAttachmentId)
        .filter((attachmentId): attachmentId is string => typeof attachmentId === "string" && attachmentId.length > 0),
    );

    for (const attachmentId of attachmentIds) {
      const key = `attachment:${attachmentId}`;
      const existing = linkedChannelDocumentIndex.get(key) ?? [];
      existing.push({
        id: document.id,
        title: document.title,
        channelName: document.channelName,
      });
      linkedChannelDocumentIndex.set(key, existing);
    }
  }

  const documentPageMap = new Map<string, KnowledgeDocumentPageRecord>();

  for (const document of documents) {
    const fileName = `${document.slug || document.title}.md`;
    const previewText = document.contentMarkdown.trim() || document.summary.trim();
    const sourceAttachmentId = document.versions.find((version) => version.sourceAttachmentId)?.sourceAttachmentId;
    documentPageMap.set(`channelDocument:${document.id}`, {
      id: `channelDocument:${document.id}`,
      sourceType: "channelDocument",
      sourceId: document.id,
      title: document.title,
      summary: document.summary || "Shared Markdown document",
      previewText,
      fileName,
      mediaType: "text/markdown",
      sizeBytes: Buffer.byteLength(document.contentMarkdown, "utf8"),
      kind: "file",
      isMarkdown: true,
      channelName: document.channelName,
      sourceMessageId: document.versions[0]?.sourceMessageId,
      sourceSpeaker: document.updatedBy,
      sourceTime: document.updatedAt,
      updatedAt: document.updatedAt,
      updatedBy: document.updatedBy,
      status: document.status,
      sourceAttachmentId,
      linkedChannelDocuments: [],
      linkedKnowledgePages: linkIndex.get(`channelDocument:${document.id}`) ?? [],
    });
  }

  for (const file of channelFiles) {
    documentPageMap.set(`attachment:${file.id}`, {
      id: `attachment:${file.id}`,
      sourceType: "attachment",
      sourceId: file.id,
      title: file.fileName,
      summary: [file.channelName, file.sourceSpeaker, file.mediaType].filter(Boolean).join(" · ") || file.fileName,
      previewText: file.previewText ?? file.mediaType,
      fileName: file.fileName,
      mediaType: file.mediaType,
      sizeBytes: file.sizeBytes,
      kind: file.kind,
      isMarkdown: file.isMarkdown,
      channelName: file.channelName,
      sourceMessageId: file.sourceMessageId,
      sourceSpeaker: file.sourceSpeaker,
      sourceTime: file.sourceTime,
      updatedAt: file.sourceTime ?? "",
      updatedBy: file.sourceSpeaker ?? "",
      status: "shared",
      linkedChannelDocuments: linkedChannelDocumentIndex.get(`attachment:${file.id}`) ?? [],
      linkedKnowledgePages: linkIndex.get(`attachment:${file.id}`) ?? [],
    });
  }

  for (const page of knowledgePages) {
    if (!page.sourceAttachmentId || !page.sourceAttachmentStoredPath) {
      continue;
    }

    const key = `attachment:${page.sourceAttachmentId}`;
    if (documentPageMap.has(key)) {
      continue;
    }

    documentPageMap.set(key, buildSyntheticAttachmentRecord({
      attachmentId: page.sourceAttachmentId,
      storedPath: page.sourceAttachmentStoredPath,
      updatedAt: page.updatedAt,
      updatedBy: page.createdBy,
      linkedKnowledgePages: linkIndex.get(key) ?? [],
      linkedChannelDocuments: linkedChannelDocumentIndex.get(key) ?? [],
    }));
  }

  for (const document of documents) {
    for (const version of document.versions) {
      if (!version.sourceAttachmentId || !version.sourceAttachmentStoredPath) {
        continue;
      }

      const key = `attachment:${version.sourceAttachmentId}`;
      const existing = documentPageMap.get(key);
      if (existing) {
        if (!existing.channelName) {
          existing.channelName = document.channelName;
        }
        if (!existing.sourceTime) {
          existing.sourceTime = version.createdAt;
        }
        if (!existing.updatedAt) {
          existing.updatedAt = version.createdAt;
        }
        if (!existing.updatedBy) {
          existing.updatedBy = version.createdBy;
        }
        existing.linkedChannelDocuments = dedupeLinkedChannelDocuments([
          ...existing.linkedChannelDocuments,
          ...(linkedChannelDocumentIndex.get(key) ?? []),
        ]);
        continue;
      }

      documentPageMap.set(key, buildSyntheticAttachmentRecord({
        attachmentId: version.sourceAttachmentId,
        storedPath: version.sourceAttachmentStoredPath,
        channelName: document.channelName,
        updatedAt: version.createdAt,
        updatedBy: version.createdBy,
        linkedKnowledgePages: linkIndex.get(key) ?? [],
        linkedChannelDocuments: linkedChannelDocumentIndex.get(key) ?? [],
      }));
    }
  }

  return [...documentPageMap.values()].sort((left, right) => {
    const timeDiff = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    if (Number.isFinite(timeDiff) && timeDiff !== 0) {
      return timeDiff;
    }
    return left.title.localeCompare(right.title, "zh-CN", { sensitivity: "base" });
  });
}

function buildSyntheticAttachmentRecord(input: {
  attachmentId: string;
  storedPath: string;
  channelName?: string;
  updatedAt: string;
  updatedBy: string;
  linkedKnowledgePages: KnowledgeDocumentPageRecord["linkedKnowledgePages"];
  linkedChannelDocuments: KnowledgeDocumentPageRecord["linkedChannelDocuments"];
}): KnowledgeDocumentPageRecord {
  const fileName = deriveAttachmentFileName(input.attachmentId, input.storedPath);
  const mediaType = resolveAttachmentMediaType(fileName);
  const sizeBytes = existsSync(input.storedPath) ? statSync(input.storedPath).size : 0;

  return {
    id: `attachment:${input.attachmentId}`,
    sourceType: "attachment",
    sourceId: input.attachmentId,
    title: fileName,
    summary: input.channelName ? `Preserved attachment · #${input.channelName}` : "Preserved attachment",
    previewText: mediaType === "text/markdown" ? readMarkdownDocumentPreviewText(input.storedPath) : mediaType,
    fileName,
    mediaType,
    sizeBytes,
    kind: inferAttachmentKind(mediaType),
    isMarkdown: mediaType === "text/markdown",
    channelName: input.channelName,
    updatedAt: input.updatedAt,
    updatedBy: input.updatedBy,
    status: "shared",
    linkedChannelDocuments: dedupeLinkedChannelDocuments(input.linkedChannelDocuments),
    linkedKnowledgePages: input.linkedKnowledgePages,
  };
}

function deriveAttachmentFileName(attachmentId: string, storedPath: string): string {
  const storedName = basename(storedPath.replace(/\\/g, "/"));
  const prefix = `${attachmentId}-`;
  return storedName.startsWith(prefix) ? storedName.slice(prefix.length) : storedName;
}

function readMarkdownDocumentPreviewText(storedPath: string): string {
  if (!existsSync(storedPath)) {
    return "";
  }

  try {
    return readFileSync(storedPath, "utf8").trim();
  } catch {
    return "";
  }
}

function dedupeLinkedChannelDocuments(
  documents: KnowledgeDocumentPageRecord["linkedChannelDocuments"],
): KnowledgeDocumentPageRecord["linkedChannelDocuments"] {
  return documents.filter(
    (document, index, all) =>
      all.findIndex((candidate) => candidate.id === document.id) === index,
  );
}

function buildFeishuChannelSummaryByChannelName(input: {
  workspaceId: string;
  canView: boolean;
  viewer?: {
    role: WorkspaceRole;
    userId: string;
  };
}): Map<string, ChannelFeishuSummaryRecord> {
  if (!input.canView) {
    return new Map();
  }

  const summaries = new Map<string, ChannelFeishuSummaryRecord>();
  const connectedBotKeys = new Set<string>();
  const resourceKeys = new Set<string>();
  const integrations = listFeishuIntegrationSettingsItems({
    workspaceId: input.workspaceId,
    viewer: input.viewer,
  });

  const ensureSummary = (channelName: string): ChannelFeishuSummaryRecord => {
    const current = summaries.get(channelName);
    if (current) {
      return current;
    }
    const next: ChannelFeishuSummaryRecord = {
      bindingCount: 0,
      connectedAgentBots: [],
      resourceBindings: [],
    };
    summaries.set(channelName, next);
    return next;
  };

  for (const integration of integrations) {
    for (const binding of integration.channelBindings) {
      if (binding.status === "archived") {
        continue;
      }
      const summary = ensureSummary(binding.channelName);
      summary.bindingCount += 1;
      if (!summary.externalChatReference || binding.status === "active") {
        summary.externalChatReference = binding.externalChatReference;
        summary.externalChatName = binding.externalChatName;
        summary.externalChatType = binding.externalChatType;
        summary.provisionSource = binding.provisionSource;
        summary.reviewStatus = binding.reviewStatus;
      }
      if (integration.agentId && binding.status === "active") {
        const key = `${binding.channelName}:${integration.id}:${integration.agentId}`;
        if (!connectedBotKeys.has(key)) {
          connectedBotKeys.add(key);
          summary.connectedAgentBots.push({
            integrationId: integration.id,
            displayName: integration.displayName,
            agentId: integration.agentId,
            status: integration.status,
            unboundUserMode: integration.externalGuestPolicy?.unboundUserMode,
            guestPermissionProfile: integration.externalGuestPolicy?.guestPermissionProfile,
          });
        }
      }
    }

    for (const resourceBinding of integration.resourceBindings) {
      if (!resourceBinding.channelName || resourceBinding.status === "archived") {
        continue;
      }
      const key = `${resourceBinding.channelName}:${integration.id}:${resourceBinding.id}`;
      if (resourceKeys.has(key)) {
        continue;
      }
      resourceKeys.add(key);
      const summary = ensureSummary(resourceBinding.channelName);
      summary.resourceBindings.push({
        id: resourceBinding.id,
        integrationId: integration.id,
        integrationDisplayName: integration.displayName,
        providerResourceType: resourceBinding.providerResourceType,
        displayName: resourceBinding.displayName,
        canWrite: resourceBinding.canWrite,
        guestReadable: resourceBinding.guestReadable,
        status: resourceBinding.status,
      });
    }
  }

  return summaries;
}

const CHANNEL_DOCUMENT_PRESENCE_TTL_MS = 90_000;
const CHANNEL_DOCUMENT_SYNC_EVENT_TTL_MS = 10 * 60_000;

export function getChannelsPageData(
  currentUserDisplayName?: string,
  workspaceId = DEFAULT_WORKSPACE_ID,
  currentUserId?: string,
  currentMembershipRole?: WorkspaceRole,
  options?: { channelNames?: string[]; detailChannelNames?: string[] },
): ChannelsPageData {
  const state = readWorkspaceStateCached(workspaceId);
  const queuedTasks = listQueuedTasksCached(workspaceId);
  const googleCredential = currentUserId ? readActiveGoogleOAuthCredentialCached(workspaceId, currentUserId) : null;
  const channelScope = normalizeChannelScope(options?.channelNames);
  const channelScoped = channelScope !== null;
  const workspaceMembers = channelScoped ? [] : listWorkspaceMemberUsersCached(workspaceId);
  const messagesByChannelName = new Map<string, WorkspaceMessage[]>();
  const firstMessageIndexByChannelName = new Map<string, number>();
  for (const [index, message] of (state.messages ?? []).entries()) {
    const channelName = message.channel;
    if (!channelName) {
      continue;
    }
    const messages = messagesByChannelName.get(channelName) ?? [];
    messages.push(message);
    messagesByChannelName.set(channelName, messages);
    if (!firstMessageIndexByChannelName.has(channelName)) {
      firstMessageIndexByChannelName.set(channelName, index);
    }
  }
  const groupChannels = (state.channels ?? []).filter((channel) => (
    !isDirectChannelRecord(channel)
    && (!channelScope || channelScope.has(channel.name))
  ));
  const isWorkspaceManager = !currentUserId || isWorkspaceManagerRole(currentMembershipRole);
  const groupChannelAccess = new Map(
    groupChannels.map((channel) => {
      const summary = isWorkspaceManager
        ? { channelName: channel.name, state: "accessible" as const }
        : currentUserId
        ? getChannelAccessSummaryForActorSync({
            workspaceId,
            channelName: channel.name,
            actor: {
              userId: currentUserId,
              displayName: currentUserDisplayName,
              role: currentMembershipRole,
            },
          })
        : { channelName: channel.name, state: "accessible" as const };
      return [channel.name, summary];
    }),
  );
  const canSeeAllAgents = isWorkspaceManager;
  const canManageChannels = isWorkspaceManager;
  const feishuChannelSummaryByChannelName = buildFeishuChannelSummaryByChannelName({
    workspaceId,
    canView: isWorkspaceManager,
    viewer: currentUserId && currentMembershipRole
      ? {
        role: currentMembershipRole,
        userId: currentUserId,
      }
      : undefined,
  });
  const mentionUnreadViewer = buildMentionUnreadViewer(state, currentUserDisplayName, currentUserId);
  const visibleEmployees = channelScoped
    ? (state.activeEmployees ?? []).filter((employee) =>
        groupChannels.some((channel) => channel.employeeNames.some((name) => sameText(name, employee.name))),
      )
    : canSeeAllAgents
    ? (state.activeEmployees ?? [])
    : (state.activeEmployees ?? []).filter((employee) => employee.ownerUserId === currentUserId);
  const channelMemberCandidates = channelScoped
    ? []
    : [
        ...workspaceMembers.map((member) => ({
          id: member.userId,
          label: member.displayName,
          kind: "human" as const,
          meta: member.primaryEmail ?? member.role,
          email: member.primaryEmail,
        })),
        ...visibleEmployees.map((employee) => ({
          id: employee.name,
          label: employee.remarkName?.trim() || employee.name,
          kind: "agent" as const,
          meta: employee.name,
        })),
      ].sort((left, right) => left.label.localeCompare(right.label, "zh-CN", { sensitivity: "base" }));
  const directContacts = channelScoped ? [] : visibleEmployees.map((employee) => {
    const directChannel = resolveDirectChannelForContact(
      state,
      currentUserDisplayName,
      employee.name,
      workspaceId,
      currentUserId,
      currentMembershipRole,
    );
    const directChannelView = directChannel ? buildChannelListItem(directChannel, state) : null;
    const directChannelMessages = directChannel
      ? messagesByChannelName.get(directChannel.name) ?? []
      : [];
    const latestMessage = directChannelMessages[0];
    const latestMessageIndex = directChannel ? firstMessageIndexByChannelName.get(directChannel.name) ?? -1 : -1;

    return {
      channel: {
        id: `contact:${employee.name}`,
        name: directChannel?.name ?? employee.name,
        channelName: directChannel?.name,
        contactId: employee.name,
        kind: "direct" as const,
        displayName: employee.remarkName?.trim() || employee.name,
        displaySubtitle: employee.name,
        avatarLabel: "✦",
        memberLabel: directChannelView?.memberLabel ?? buildSyntheticDirectMemberLabel(state, currentUserDisplayName),
        memberCount: directChannelView?.memberCount ?? buildSyntheticDirectMemberCount(state, currentUserDisplayName),
        canManage: false,
        lastMessage: latestMessage?.summary,
        updatedAt: latestMessage?.time,
        unread: hasUnreadMentionForViewer(directChannelMessages, mentionUnreadViewer),
      } satisfies ChannelListItem,
      latestMessageIndex,
      messages: directChannel
        ? directChannelMessages
            .slice()
            .reverse()
        : [],
    };
  });
  const accessibleGroupChannels = groupChannels.filter((channel) => groupChannelAccess.get(channel.name)?.state === "accessible");
  const visibleChannels = [
    ...accessibleGroupChannels,
    ...directContacts.map(({ channel }) => channel),
  ];
  const visibleChannelNames = new Set(visibleChannels.map((channel) => channel.name));
  const detailChannelScope = normalizeChannelScope(options?.detailChannelNames);
  const detailChannelNames = detailChannelScope
    ? new Set([...visibleChannelNames].filter((channelName) => detailChannelScope.has(channelName)))
    : visibleChannelNames;
  const workspaceArtifacts = buildChannelWorkspaceArtifacts(
    state,
    queuedTasks,
    currentUserDisplayName,
    detailChannelNames,
    workspaceId,
    currentUserId,
    currentMembershipRole,
  );

  const threads = [
    ...accessibleGroupChannels.map((channel) => ({
      channelName: channel.name,
      messages: detailChannelNames.has(channel.name)
        ? (messagesByChannelName.get(channel.name) ?? [])
            .slice()
            .reverse()
        : [],
    })),
    ...directContacts.map(({ channel, messages }) => ({
      channelName: channel.id,
      messages: channel.channelName && detailChannelNames.has(channel.channelName) ? messages : [],
    })),
  ];

  const channels = [
    ...groupChannels.map((channel) => {
      const access = groupChannelAccess.get(channel.name);
      const channelMessages = messagesByChannelName.get(channel.name) ?? [];
      const latestMessage = channelMessages[0];
      const latestMessageIndex = firstMessageIndexByChannelName.get(channel.name) ?? -1;
      return {
        channel: {
          ...buildChannelListItem(channel, state),
          canManage: canManageChannels,
          accessState: access?.state ?? "accessible",
          accessRequestId: access?.requestId,
          feishu: feishuChannelSummaryByChannelName.get(channel.name),
          lastMessage: access?.state === "accessible" ? latestMessage?.summary : undefined,
          updatedAt: access?.state === "accessible" ? latestMessage?.time : undefined,
          unread: access?.state === "accessible" ? hasUnreadMentionForViewer(channelMessages, mentionUnreadViewer) : false,
        } satisfies ChannelListItem,
        latestMessageIndex: access?.state === "accessible" ? latestMessageIndex : -1,
      };
    }),
    ...directContacts.map(({ channel, latestMessageIndex }) => ({
      channel,
      latestMessageIndex,
    })),
  ]
    .sort((left, right) => {
      const leftHasMessages = left.latestMessageIndex >= 0;
      const rightHasMessages = right.latestMessageIndex >= 0;
      if (leftHasMessages && rightHasMessages) {
        return left.latestMessageIndex - right.latestMessageIndex;
      }
      if (leftHasMessages) {
        return -1;
      }
      if (rightHasMessages) {
        return 1;
      }
      return (left.channel.displayName ?? left.channel.name).localeCompare(
        right.channel.displayName ?? right.channel.name,
        "zh-CN",
        { sensitivity: "base" },
      );
    })
    .map(({ channel }) => channel);
  const mentionableEmployees =
    channelScoped || canSeeAllAgents
      ? visibleEmployees
      : buildMemberMentionableEmployees(state, visibleEmployees, accessibleGroupChannels);

  return {
    workspaceId,
    googleWorkspace: googleCredential
      ? {
          status: "connected",
          email: googleCredential.googleEmail,
          scopes: googleCredential.scopes.split(/\s+/).filter(Boolean),
          updatedAt: googleCredential.updatedAt,
          expiresAt: googleCredential.expiresAt,
        }
      : { status: "not_connected" },
    channels,
    threads,
    documents: workspaceArtifacts.documents,
    documentRuns: workspaceArtifacts.documentRuns,
    documentConflicts: workspaceArtifacts.documentConflicts,
    channelFiles: workspaceArtifacts.channelFiles,
    mentionCandidates: [
      ...mentionableEmployees.map((employee) => ({
        id: employee.name,
        label: employee.remarkName?.trim() || employee.name,
        subtitle: employee.name,
        channels: [...employee.channels],
        kind: "agent" as const,
      })),
      ...buildHumanMentionCandidates(state, accessibleGroupChannels, workspaceMembers),
    ]
      .sort((left, right) => left.label.localeCompare(right.label, "zh-CN", { sensitivity: "base" })),
    channelMemberCandidates,
    totalChannels: channels.length,
    detailScope: detailChannelScope ? [...detailChannelNames] : undefined,
  };
}

export function getChannelListPageData(
  currentUserDisplayName?: string,
  workspaceId = DEFAULT_WORKSPACE_ID,
  currentUserId?: string,
  currentMembershipRole?: WorkspaceRole,
  options?: { channelNames?: string[]; initialDetailChannelNames?: string[] },
): ChannelsPageData {
  return getChannelsPageData(
    currentUserDisplayName,
    workspaceId,
    currentUserId,
    currentMembershipRole,
    {
      channelNames: options?.channelNames,
      detailChannelNames: options?.initialDetailChannelNames ?? [],
    },
  );
}

export function getChannelDetailData(
  input: {
    channelName: string;
    currentUserDisplayName?: string;
    workspaceId?: string;
    currentUserId?: string;
    currentMembershipRole?: WorkspaceRole;
  },
): ChannelDetailPageData {
  const channelName = input.channelName.trim();
  const data = getChannelsPageData(
    input.currentUserDisplayName,
    input.workspaceId ?? DEFAULT_WORKSPACE_ID,
    input.currentUserId,
    input.currentMembershipRole,
    { detailChannelNames: [channelName] },
  );

  return {
    threads: data.threads.filter(
      (thread) =>
        thread.channelName === channelName ||
        thread.messages.some((message) => message.channel === channelName),
    ),
    documents: data.documents,
    documentRuns: data.documentRuns,
    documentConflicts: data.documentConflicts,
    channelFiles: data.channelFiles,
    detailScope: data.detailScope,
  };
}

function buildMemberMentionableEmployees(
  state: AgentSpaceState,
  ownedEmployees: ActiveEmployee[],
  accessibleGroupChannels: ChannelRecord[],
): ActiveEmployee[] {
  const accessibleChannelAgentNames = new Set(
    accessibleGroupChannels.flatMap((channel) => channel.employeeNames),
  );
  const rows = new Map<string, ActiveEmployee>();
  for (const employee of ownedEmployees) {
    rows.set(employee.name, employee);
  }
  for (const employee of state.activeEmployees ?? []) {
    if (
      (employee.channelMemberAccess ?? "enabled") !== "enabled" ||
      !accessibleChannelAgentNames.has(employee.name)
    ) {
      continue;
    }
    rows.set(employee.name, employee);
  }
  return Array.from(rows.values());
}

function buildHumanMentionCandidates(
  state: AgentSpaceState,
  channels: ChannelRecord[],
  workspaceMembers: WorkspaceMemberUserRecord[],
): ChannelsPageData["mentionCandidates"] {
  const rows = new Map<string, {
    id: string;
    label: string;
    subtitle: string;
    channels: Set<string>;
    kind: "human";
  }>();

  for (const channel of channels) {
    for (const memberName of resolveChannelHumanMemberNames(state, channel)) {
      const label = memberName.trim();
      if (!label) {
        continue;
      }
      const key = label.toLocaleLowerCase("zh-CN");
      const workspaceMember = workspaceMembers.find((member) => sameText(member.displayName, label));
      const legacyMember = state.humanMembers.find((member) => sameText(member.name, label));
      const existing = rows.get(key);
      if (existing) {
        existing.channels.add(channel.name);
        continue;
      }
      rows.set(key, {
        id: workspaceMember ? `human:${workspaceMember.userId}` : `human:${label}`,
        label,
        subtitle: workspaceMember?.primaryEmail ?? legacyMember?.role ?? "Member",
        channels: new Set([channel.name]),
        kind: "human",
      });
    }
  }

  return Array.from(rows.values()).map((row) => ({
    id: row.id,
    label: row.label,
    subtitle: row.subtitle,
    channels: Array.from(row.channels),
    kind: row.kind,
  }));
}

function buildSyntheticDirectHumanMemberCount(
  state: AgentSpaceState,
  currentUserDisplayName: string | undefined,
): number {
  if (currentUserDisplayName?.trim()) {
    return 1;
  }
  return state.humanMembers.length > 0 ? 1 : 0;
}

function buildSyntheticDirectMemberCount(
  state: AgentSpaceState,
  currentUserDisplayName: string | undefined,
): number {
  return buildSyntheticDirectHumanMemberCount(state, currentUserDisplayName) + 1;
}

function buildSyntheticDirectMemberLabel(
  state: AgentSpaceState,
  currentUserDisplayName: string | undefined,
): string {
  return `${buildSyntheticDirectHumanMemberCount(state, currentUserDisplayName)} humans / 1 agents`;
}

export function getInboxPageData(
  workspaceId = DEFAULT_WORKSPACE_ID,
  currentUser?: DashboardCurrentUser,
): InboxPageData {
  const state = readWorkspaceStateCached(workspaceId);
  const messagesByChannelName = buildMessagesByChannelName(state.messages ?? []);
  const readableChannels = buildReadableChannelLookup(state, workspaceId, currentUser);
  const runtimeSnapshots = listDaemonSnapshotsCached(workspaceId);
  const bindings = listEmployeeRuntimeBindingsCached(workspaceId);
  const queuedTasks = listQueuedTasksCached(workspaceId);
  const installedApps = listRuntimeInstalledAppsCached(workspaceId);
  const runtimeAppOperations = listRuntimeAppOperationsCached(workspaceId, 200);
  const runtimeDisplayNames = buildRuntimeDisplayNameIndex(workspaceId);
  const runtimeRecords = buildNativeRuntimeRecords(state, runtimeSnapshots, bindings, queuedTasks, runtimeDisplayNames, installedApps, runtimeAppOperations);
  const runtimeIndex = new Map(runtimeRecords.map((runtime) => [runtime.runtimeId, runtime]));
  const taskItems = buildTaskInboxItems(
    state,
    new Map(bindings.map((binding) => [binding.employeeName, binding])),
    runtimeIndex,
    queuedTasks,
    workspaceId,
    currentUser,
    readableChannels,
    messagesByChannelName,
  );
  const notificationItems = buildNotificationInboxItems(state, workspaceId, currentUser);
  const channelItems = buildChannelInboxItems(
    state,
    runtimeIndex,
    queuedTasks,
    workspaceId,
    currentUser,
    readableChannels,
    messagesByChannelName,
  );
  const activityItems = buildActivityInboxItems(state, workspaceId, currentUser, readableChannels);
  const items = [...notificationItems, ...taskItems, ...channelItems, ...activityItems];

  return {
    items,
    totalCount: items.length,
    unreadCount: items.filter((item) => item.unread).length,
    notificationCount: notificationItems.length,
    taskCount: taskItems.length,
    channelCount: channelItems.length,
    activityCount: activityItems.length,
  };
}

interface ReadableChannelLookup {
  canRead(channelName?: string | null): boolean;
}

function buildReadableChannelLookup(
  state: AgentSpaceState,
  workspaceId: string,
  currentUser?: DashboardCurrentUser,
): ReadableChannelLookup {
  if (!currentUser?.id) {
    return { canRead: () => true };
  }

  const isManager = isWorkspaceManagerRole(currentUser.role);
  const channelByName = new Map(
    state.channels.map((channel) => [normalizeChannelLookupKey(channel.name), channel]),
  );
  const readableChannelNames = new Set<string>();

  for (const channel of state.channels) {
    const key = normalizeChannelLookupKey(channel.name);
    if (isManager && channel.kind !== "direct") {
      readableChannelNames.add(key);
      continue;
    }
    if (
      canReadChannelForActorSync({
        workspaceId,
        channelName: channel.name,
        actor: {
          userId: currentUser.id,
          displayName: currentUser.displayName,
          role: currentUser.role,
        },
      })
    ) {
      readableChannelNames.add(key);
    }
  }

  return {
    canRead(channelName) {
      const key = normalizeChannelLookupKey(channelName ?? "");
      if (!key) {
        return true;
      }
      const channel = channelByName.get(key);
      if (isManager && channel?.kind !== "direct") {
        return true;
      }
      return readableChannelNames.has(key);
    },
  };
}

function buildMessagesByChannelName(messages: WorkspaceMessage[]): Map<string, WorkspaceMessage[]> {
  const byChannel = new Map<string, WorkspaceMessage[]>();
  for (const message of messages) {
    const channelName = message.channel;
    if (!channelName) {
      continue;
    }
    const channelMessages = byChannel.get(channelName) ?? [];
    channelMessages.push(message);
    byChannel.set(channelName, channelMessages);
  }
  return byChannel;
}

function normalizeChannelLookupKey(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function buildNotificationInboxItems(
  state: AgentSpaceState,
  workspaceId: string,
  currentUser?: DashboardCurrentUser,
): InboxItem[] {
  if (!currentUser?.id) {
    return [];
  }

  const ownedAgentNames = state.activeEmployees
    .filter((employee) => employee.ownerUserId === currentUser.id)
    .map((employee) => employee.name);
  const notifications = [
    ...listNotificationsForRecipientSync({
      workspaceId,
      recipientType: "human",
      recipientId: currentUser.id,
      includeArchived: false,
      limit: 100,
    }),
    ...ownedAgentNames.flatMap((agentName) =>
      listNotificationsForRecipientSync({
        workspaceId,
        recipientType: "agent",
        recipientId: agentName,
        includeArchived: false,
        limit: 50,
      }),
    ),
  ].sort((left, right) => {
    const byTime = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    return byTime || right.id.localeCompare(left.id);
  });

  return notifications.map((notification) => ({
    id: `notification:${notification.id}`,
    kind: "notification",
    title: notification.title,
    subtitle: notification.recipientType === "agent" ? `Agent · ${notification.recipientId}` : "Notification",
    meta: notification.channelName ? `#${notification.channelName}` : formatNotificationResourceType(notification.resourceType),
    timestamp: formatAbsoluteDateTime(notification.createdAt),
    unread: notification.status === "unread",
    statusLabel: formatNotificationStatus(notification.status),
    statusTone: toneForNotification(notification),
    body: notification.body,
    actionHref: notification.actionHref,
    notification,
    channelName: notification.channelName,
    history: [
      {
        id: `notification-entry-${notification.id}`,
        role: "system",
        actor: notification.actorId ?? "AgentSpace",
        timestamp: formatAbsoluteDateTime(notification.createdAt),
        body: notification.body,
      },
    ],
  }));
}

interface AgentsPageDataOptions {
  workspaceId?: string;
  currentUserId?: string;
  currentMembershipRole?: WorkspaceRole;
}

export function getAgentsPageData(input: string | AgentsPageDataOptions = DEFAULT_WORKSPACE_ID): AgentsPageData {
  const options = resolveAgentsPageDataOptions(input);
  const workspaceId = options.workspaceId;
  const currentUserId = options.currentUserId;
  const currentMembershipRole = options.currentMembershipRole;
  const canManageAllAgents = !currentUserId || isWorkspaceManagerRole(currentMembershipRole);
  const canManageRuntimes = canManageAllAgents;
  const canConnectRuntimes = canManageRuntimes || currentMembershipRole === "member";
  const state = readWorkspaceStateCached(workspaceId);
  const workspaceSkills = listWorkspaceSkillsCached(workspaceId);
  const workspaceSkillSummaries = shouldUseLoadtestDashboardPayloadLimits()
    ? workspaceSkills.map(summarizeWorkspaceSkillForAgentPage)
    : workspaceSkills;
  const workspaceSkillIndex = new Map(workspaceSkillSummaries.map((skill) => [skill.id, skill]));
  const skillIdsByAgentId = listEmployeeSkillIdsByAgentIdMapSync(workspaceId);
  const knowledgePolicies = listKnowledgeAssignmentPoliciesCached(workspaceId);
  const knowledgeAssignments = listKnowledgeAssignmentsCached(workspaceId);
  const knowledgePolicyIndex = new Map(knowledgePolicies.map((policy) => [policy.knowledgePageId, policy]));
  const runtimeSnapshots = listDaemonSnapshotsCached(workspaceId);
  const bindings = listEmployeeRuntimeBindingsCached(workspaceId);
  const queuedTasks = listQueuedTasksCached(workspaceId);
  const installedApps = listRuntimeInstalledAppsCached(workspaceId);
  const runtimeAppOperations = listRuntimeAppOperationsCached(workspaceId, 200);
  const runtimeDisplayNames = buildRuntimeDisplayNameIndex(workspaceId);
  const workspaceMembers = listWorkspaceMemberUsersCached(workspaceId).map(mapWorkspaceMemberForRuntimeGrant);
  const memberByUserId = new Map(workspaceMembers.map((member) => [member.userId, member]));
  const employeeDisplayNameByName = new Map(
    state.activeEmployees.map((employee) => [employee.name, employee.remarkName?.trim() || employee.name]),
  );
  const googleCredentialByUserId = new Map(listGoogleOAuthCredentialsCached(workspaceId).map((credential) => [credential.userId, credential]));
  const googleDelegationByEmployeeName = new Map(
    listAgentGoogleWorkspaceDelegationsCached(workspaceId)
      .filter((delegation) => delegation.status === "active")
      .map((delegation) => [delegation.employeeName, delegation]),
  );
  const documentAccessByEmployeeName = buildWorkspaceAgentDocumentAccessSummaries(workspaceId, state);
  const feishuAgentBotByAgentId = new Map(
    canManageAllAgents
      ? listFeishuIntegrationSettingsItems({
        workspaceId,
        viewer: currentUserId && currentMembershipRole
          ? {
            role: currentMembershipRole,
            userId: currentUserId,
          }
          : undefined,
      })
        .filter((integration) => integration.agentId)
        .map((integration) => [integration.agentId!, integration])
      : [],
  );
  const feishuAgentBotSetupReference = canManageAllAgents
    ? buildFeishuAgentBotSetupReference()
    : undefined;
  const activeRuntimeGrants = listRuntimeGrantsCached(workspaceId).filter((grant) => grant.status === "active");
  const grantsByRuntimeId = new Map<string, RuntimeGrantMember[]>();
  for (const grant of activeRuntimeGrants) {
    const member = memberByUserId.get(grant.userId);
    if (!member) {
      continue;
    }
    const next = grantsByRuntimeId.get(grant.runtimeId) ?? [];
    next.push(member);
    grantsByRuntimeId.set(grant.runtimeId, next);
  }
  const allContainers = buildNativeRuntimeRecords(state, runtimeSnapshots, bindings, queuedTasks, runtimeDisplayNames, installedApps, runtimeAppOperations)
    .map((container) => ({
      ...container,
      grantedMembers: grantsByRuntimeId.get(container.runtimeId) ?? [],
      canManageGrants: canManageRuntimes,
    }))
    .sort(compareContainers);
  const activeContainers = allContainers.filter((container) => container.status === "linked");
  const grantedRuntimeIdsForCurrentUser = new Set(
    currentUserId
      ? activeRuntimeGrants
          .filter((grant) => grant.userId === currentUserId)
          .map((grant) => grant.runtimeId)
      : [],
  );
  const visibleContainers = canManageRuntimes
    ? activeContainers
    : activeContainers
        .filter((container) => grantedRuntimeIdsForCurrentUser.has(container.runtimeId))
        .map((container) => redactContainerForMember(container, state, currentUserId));
  const containerIndex = new Map(allContainers.map((container) => [container.runtimeId, container]));
  const bindingIndex = new Map(bindings.map((binding) => [binding.employeeName, binding]));
  const allWorkspaceAgentRecords = state.activeEmployees
    .map((employee) =>
      buildWorkspaceAgentRecord(
        employee,
        state,
        workspaceSkillIndex,
        skillIdsByAgentId,
        bindingIndex.get(employee.name),
        containerIndex,
        queuedTasks,
        buildWorkspaceAgentKnowledgeRecord(employee, state.knowledgePages, knowledgePolicyIndex, knowledgeAssignments),
        documentAccessByEmployeeName.get(employee.name) ?? createEmptyAgentDocumentAccessSummary(),
      ),
    )
    .map((agent) => ({
      ...agent,
      ownerDisplayName: agent.ownerUserId ? memberByUserId.get(agent.ownerUserId)?.displayName : undefined,
      forkedFrom: parseAgentForkOrigin(agent.origin),
      googleWorkspaceDelegation: buildWorkspaceAgentGoogleWorkspaceDelegationRecord(
        googleDelegationByEmployeeName.get(agent.internalName),
        googleCredentialByUserId,
        memberByUserId,
        currentUserId,
      ),
      feishuAgentBot: feishuAgentBotByAgentId.get(agent.internalName),
      feishuAgentBotSetupReference,
      canManageFeishuAgentBot: canManageAllAgents,
      canManage: canManageAllAgents || (typeof currentUserId === "string" && agent.ownerUserId === currentUserId),
      canManageChannelMemberAccess: canManageAllAgents || (typeof currentUserId === "string" && agent.ownerUserId === currentUserId),
    }))
    .sort(compareAgents);
  const workspaceAgents = allWorkspaceAgentRecords
    .filter((agent) => canManageAllAgents || agent.ownerUserId === currentUserId)
    .map((agent) => {
      const forkInvitations = currentUserId && agent.canManage
        ? listAgentForkInvitationsForSourceAgentSync({
            workspaceId,
            sourceAgentName: agent.internalName,
            actorUserId: currentUserId,
            statuses: ["pending"],
          }).map((invitation) => buildAgentForkInvitationView(invitation, {
            memberByUserId,
            employeeDisplayNameByName,
            currentUserDisplayName: memberByUserId.get(invitation.targetUserId)?.displayName,
          }))
        : [];
      return {
        ...agent,
        forkInvitations,
      };
    })
    .map((agent) => canManageAllAgents ? agent : redactWorkspaceAgentForMember(agent))
    .sort(compareAgents);
  const agentsBoundToActiveContainers = workspaceAgents.filter(
    (agent) => agent.boundContainerId && visibleContainers.some((container) => container.runtimeId === agent.boundContainerId),
  );
  const containerOptions = visibleContainers.map((container) => ({
    id: container.runtimeId,
    label: container.displayName ?? container.name,
    provider: container.provider,
    status: container.status === "linked" ? "online" as const : "offline" as const,
    providerHealth: container.providerHealth,
    serverName: canManageRuntimes ? container.deviceName : container.name,
    daemonKey: canManageRuntimes ? container.daemonKey : "",
    mode: container.daemonMode,
  }));
  const pendingForkInvitations = currentUserId
    ? listAgentForkInvitationsForActorSync({
        workspaceId,
        actorUserId: currentUserId,
        statuses: ["pending"],
      })
        .filter((invitation) => invitation.targetUserId === currentUserId)
        .map((invitation) => buildAgentForkInvitationView(invitation, {
          memberByUserId,
          employeeDisplayNameByName,
          currentUserDisplayName: memberByUserId.get(currentUserId)?.displayName,
        }))
    : [];
  const agentAccessRequests = currentUserId
    ? listAgentAccessRequestsForActorSync({
        workspaceId,
        actorUserId: currentUserId,
        statuses: ["pending", "approved", "rejected", "cancelled"],
      })
    : [];
  const showcaseAgents = buildDigitalEmployeeShowcaseAgents({
    agents: allWorkspaceAgentRecords,
    state,
    memberByUserId,
    currentUserId,
    currentMembershipRole,
    accessRequests: agentAccessRequests,
    pendingForkInvitations,
  });

  return {
    containers: visibleContainers,
    agents: workspaceAgents,
    showcaseAgents,
    daemonSnapshots: canManageRuntimes ? listDaemonSnapshotViews(workspaceId) : [],
    daemonTokens: canManageRuntimes ? listDaemonTokenViews(workspaceId, memberByUserId) : [],
    workspaceSkills: workspaceSkillSummaries,
    channels: state.channels.map((channel) => ({
      name: channel.name,
      memberLabel: `${resolveChannelHumanMemberNames(state, channel).length} 人类 / ${channel.employeeNames.length} agent`,
    })),
    workspaceMembers,
    pendingForkInvitations,
    containerOptions,
    currentUserId,
    currentMembershipRole,
    canConnectRuntimes,
    canManageRuntimes,
    canManageAllAgents,
    canCreateAgent: canManageAllAgents || containerOptions.length > 0,
    totalAgents: workspaceAgents.length,
    containerCount: visibleContainers.length,
    boundAgentCount: agentsBoundToActiveContainers.length,
    unboundAgentCount: workspaceAgents.length - agentsBoundToActiveContainers.length,
    activeTaskCount: state.tasks.filter((task) => task.status !== "done").length,
    activeWorkAreaCount: workspaceAgents.reduce((sum, agent) => sum + agent.workAreas.length, 0),
  };
}

function resolveAgentsPageDataOptions(input: string | AgentsPageDataOptions): Required<Pick<AgentsPageDataOptions, "workspaceId">> & Omit<AgentsPageDataOptions, "workspaceId"> {
  if (typeof input === "string") {
    return { workspaceId: input };
  }
  return {
    workspaceId: input.workspaceId ?? DEFAULT_WORKSPACE_ID,
    currentUserId: input.currentUserId,
    currentMembershipRole: input.currentMembershipRole,
  };
}

function summarizeWorkspaceSkillForAgentPage(skill: WorkspaceSkill): WorkspaceSkill {
  return {
    ...skill,
    files: skill.files.map((file) => ({
      ...file,
      content: "",
    })),
  };
}

function limitLoadtestDashboardPayload<T>(items: T[], limit: number): T[] {
  return shouldUseLoadtestDashboardPayloadLimits() ? items.slice(0, limit) : items;
}

function shouldUseLoadtestDashboardPayloadLimits(): boolean {
  const configured = process.env.AGENT_SPACE_DASHBOARD_PAYLOAD_LIMITS_ENABLED?.trim().toLowerCase();
  if (configured) {
    return configured !== "0" && configured !== "false";
  }
  return process.env.LOADTEST_MODE === "local";
}

function isWorkspaceManagerRole(role: WorkspaceRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

function formatWorkspaceRoleLabel(role: WorkspaceRole): string {
  if (role === "owner") {
    return "Owner";
  }
  if (role === "admin") {
    return "Admin";
  }
  return "Member";
}

function canSeeWorkspaceDiagnostics(currentUser?: DashboardCurrentUser): boolean {
  return !currentUser?.id || isWorkspaceManagerRole(currentUser.role);
}

function redactInboxExecutionForMember(
  execution: NonNullable<InboxItem["execution"]>,
  currentUser?: DashboardCurrentUser,
): NonNullable<InboxItem["execution"]> {
  if (canSeeWorkspaceDiagnostics(currentUser)) {
    return execution;
  }
  return {
    ...execution,
    serverUrl: undefined,
    sessionId: undefined,
    workDir: undefined,
    workDirHostLabel: undefined,
  };
}

function buildTaskExecutionTimeline(
  taskId: string,
  workspaceId: string,
  limit = 80,
): TaskExecutionTimelineEntry[] {
  return listTaskExecutionEventsCached(workspaceId, taskId, limit).map(mapTaskExecutionTimelineEntry);
}

function buildRouterExecutionView(
  queuedTask: ReturnType<typeof listQueuedTasksSync>[number] | undefined,
): RouterExecutionView | undefined {
  if (!queuedTask?.routerSessionId) {
    return undefined;
  }
  const session = readAgentRouterSessionCached(queuedTask.routerSessionId);
  if (!session) {
    return undefined;
  }
  const attempts = listAgentTaskAttemptsCached(queuedTask.workspaceId, queuedTask.id);
  const providerSessions = listAgentRouterProviderSessionsCached(queuedTask.workspaceId, session.id);
  const latestAttempt = attempts.at(-1);
  const latestMetadata = latestAttempt ? safeParseJson(latestAttempt.metadataJson) : {};
  const fallbackReason = readString(latestMetadata.fallbackReason);
  const continuationMode =
    fallbackReason
      ? "fallback"
      : latestAttempt?.providerSessionId
        ? "same_provider_resume"
        : "cold_rebuild";

  return {
    routerSessionId: session.id,
    conversationKey: session.conversationKey,
    sourceType: session.sourceType,
    continuationMode,
    attempts: attempts.map((attempt) => {
      const metadata = safeParseJson(attempt.metadataJson);
      return {
        id: attempt.id,
        runtimeId: attempt.runtimeId,
        provider: attempt.provider,
        providerSessionId: attempt.providerSessionId,
        status: attempt.status,
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        errorText: attempt.errorText,
        handoffSnapshotId: attempt.handoffSnapshotId,
        routingMode: readString(metadata.routingMode),
        fallbackReason: readString(metadata.fallbackReason),
      };
    }),
    providerSessions: providerSessions.map((providerSession) => ({
      id: providerSession.id,
      runtimeId: providerSession.runtimeId,
      provider: providerSession.provider,
      providerSessionId: providerSession.providerSessionId,
      status: providerSession.status,
      lastUsedAt: providerSession.lastUsedAt,
      lastError: providerSession.lastError,
    })),
  };
}

function mapTaskExecutionTimelineEntry(event: TaskExecutionEventRecord): TaskExecutionTimelineEntry {
  const data = safeParseJson(event.dataJson);
  return {
    id: event.id,
    type: event.type,
    category: categoryForExecutionEvent(event.type),
    title: event.title,
    summary: event.summary,
    severity: event.severity,
    status: event.status,
    createdAt: event.createdAt,
    targetHref: readSafeRelativeHref(data.targetHref),
    nextActions: resolveExecutionEventActions(event, data),
  };
}

function categoryForExecutionEvent(type: TaskExecutionEventType): TaskExecutionTimelineCategory {
  if (type === "tool_started" || type === "tool_finished") {
    return "tool";
  }
  if (type === "artifact_detected" || type === "artifact_collected") {
    return "artifact";
  }
  if (type === "approval_requested") {
    return "approval";
  }
  if (type === "blocked" || type === "failed" || type === "cancelled") {
    return "error";
  }
  if (type === "handoff_created") {
    return "handoff";
  }
  return "status";
}

function resolveExecutionEventActions(
  event: TaskExecutionEventRecord,
  data: Record<string, unknown>,
): TaskExecutionTimelineAction[] | undefined {
  if (event.type !== "blocked" && event.type !== "failed" && event.type !== "cancelled") {
    return undefined;
  }
  const joined = `${event.summary ?? ""} ${readString(data.errorCode) ?? ""} ${readString(data.errorCategory) ?? ""}`.toLowerCase();
  if (/\b(auth|permission|credential|profile|forbidden|unauthorized|denied)\b/.test(joined)) {
    return ["grant_permission", "retry", "handoff"];
  }
  if (event.type === "blocked") {
    return ["mark_blocked", "handoff", "retry"];
  }
  if (event.type === "cancelled") {
    return ["retry", "handoff"];
  }
  return ["retry", "rollback", "handoff"];
}

function readSafeRelativeHref(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value.startsWith("/") ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function mapWorkspaceMemberForRuntimeGrant(member: WorkspaceMemberUserRecord): RuntimeGrantMember {
  return {
    userId: member.userId,
    displayName: member.displayName,
    primaryEmail: member.primaryEmail,
    role: member.role,
  };
}

function buildWorkspaceAgentGoogleWorkspaceDelegationRecord(
  delegation: ReturnType<typeof listAgentGoogleWorkspaceDelegationsSync>[number] | undefined,
  googleCredentialByUserId: Map<string, ReturnType<typeof listGoogleOAuthCredentialsSync>[number]>,
  memberByUserId: Map<string, RuntimeGrantMember>,
  currentUserId: string | undefined,
): WorkspaceAgentGoogleWorkspaceDelegationRecord {
  if (!delegation) {
    return {
      status: "not_delegated",
      canRevoke: false,
    };
  }

  const credential = googleCredentialByUserId.get(delegation.userId);
  const status =
    delegation.status === "revoked"
      ? "revoked"
      : !credential || credential.status !== "active" || credential.id !== delegation.googleOAuthCredentialId || !credential.refreshTokenEncrypted
        ? "reconnect_required"
        : "connected";
  return {
    status,
    delegationId: delegation.id,
    userId: delegation.userId,
    delegatedByDisplayName: memberByUserId.get(delegation.userId)?.displayName,
    googleEmail: delegation.googleEmail ?? credential?.googleEmail,
    scopes: delegation.scopes.split(/\s+/).filter(Boolean),
    updatedAt: delegation.updatedAt,
    expiresAt: credential?.expiresAt,
    canRevoke: currentUserId === delegation.userId,
  };
}

function redactContainerForMember(
  container: ContainerRecord,
  state: AgentSpaceState,
  currentUserId: string | undefined,
): ContainerRecord {
  const ownedEmployeeNames = new Set(
    state.activeEmployees
      .filter((employee) => employee.ownerUserId === currentUserId)
      .map((employee) => employee.name),
  );
  return {
    ...container,
    subtitle: `${formatDaemonProviderLabel(container.provider)} · ${container.name}`,
    daemonKey: "",
    serverUrl: undefined,
    executablePath: undefined,
    daemonPid: undefined,
    boundEmployees: container.boundEmployees.filter((employeeName) => ownedEmployeeNames.has(employeeName)),
    agentCount: container.boundEmployees.filter((employeeName) => ownedEmployeeNames.has(employeeName)).length,
    recentExecutions: container.recentExecutions
      .filter((execution) => ownedEmployeeNames.has(execution.assignee))
      .map((execution) => ({
        ...execution,
        sessionId: undefined,
        workDir: undefined,
        workDirHostLabel: undefined,
      })),
    canManageGrants: false,
  };
}

function redactWorkspaceAgentForMember(agent: WorkspaceAgentRecord): WorkspaceAgentRecord {
  return {
    ...agent,
    workAreas: agent.workAreas.map((area) => ({
      ...area,
      sessionId: undefined,
      workDir: undefined,
      workDirHostLabel: undefined,
    })),
  };
}

function parseAgentForkOrigin(origin: string): WorkspaceAgentRecord["forkedFrom"] {
  const match = /^agent-fork:(.*):([^:]+)$/.exec(origin);
  if (!match) {
    return undefined;
  }
  return {
    sourceAgentName: match[1] ?? "",
    invitationId: match[2] ?? "",
  };
}

function buildAgentForkInvitationView(
  invitation: AgentForkInvitationRecord,
  context: {
    memberByUserId: Map<string, RuntimeGrantMember>;
    employeeDisplayNameByName: Map<string, string>;
    currentUserDisplayName?: string;
  },
): WorkspaceAgentForkInvitationView {
  const sourceAgentDisplayName =
    invitation.snapshot?.profile?.remarkName?.trim()
    || context.employeeDisplayNameByName.get(invitation.sourceAgentName)
    || invitation.sourceAgentName;
  const targetDisplayName = context.memberByUserId.get(invitation.targetUserId)?.displayName;
  return {
    id: invitation.id,
    sourceAgentName: invitation.sourceAgentName,
    sourceAgentDisplayName,
    targetUserId: invitation.targetUserId,
    targetDisplayName,
    createdByUserId: invitation.createdByUserId,
    createdByDisplayName: context.memberByUserId.get(invitation.createdByUserId)?.displayName,
    status: invitation.status,
    createdAt: invitation.createdAt,
    updatedAt: invitation.updatedAt,
    acceptedAgentName: invitation.acceptedAgentName,
    acceptedRuntimeId: invitation.acceptedRuntimeId,
    contextNote: invitation.options.contextNote ?? invitation.snapshot?.contextNote,
    copyProfile: invitation.options.copyProfile,
    copyInstructions: invitation.options.copyInstructions,
    copySkills: invitation.options.copySkills,
    copyKnowledgeAssignments: invitation.options.copyKnowledgeAssignments,
    copiedSkillCount: invitation.snapshot?.skillIds.length ?? 0,
    copiedKnowledgePageCount: invitation.snapshot?.knowledgePageIds.length ?? 0,
    suggestedAgentName: suggestForkAgentName(
      sourceAgentDisplayName,
      context.currentUserDisplayName ?? targetDisplayName,
    ),
  };
}

function buildDigitalEmployeeShowcaseAgents(input: {
  agents: WorkspaceAgentRecord[];
  state: AgentSpaceState;
  memberByUserId: Map<string, RuntimeGrantMember>;
  currentUserId?: string;
  currentMembershipRole?: WorkspaceRole;
  accessRequests: AgentAccessRequestRecord[];
  pendingForkInvitations: WorkspaceAgentForkInvitationView[];
}): DigitalEmployeeShowcaseAgentRecord[] {
  const isManager = isWorkspaceManagerRole(input.currentMembershipRole);
  const employeeByName = new Map(input.state.activeEmployees.map((employee) => [employee.name, employee]));
  const requestsBySourceAgent = new Map<string, WorkspaceAgentAccessRequestView[]>();
  for (const request of input.accessRequests) {
    const sourceAgent = input.agents.find((agent) => agent.internalName === request.sourceAgentName);
    const view = buildAgentAccessRequestView(request, {
      memberByUserId: input.memberByUserId,
      canDecide: Boolean(
        input.currentUserId &&
        request.status === "pending" &&
        (isManager || sourceAgent?.ownerUserId === input.currentUserId),
      ),
    });
    const list = requestsBySourceAgent.get(request.sourceAgentName) ?? [];
    list.push(view);
    requestsBySourceAgent.set(request.sourceAgentName, list);
  }
  for (const [sourceAgentName, requests] of requestsBySourceAgent) {
    requestsBySourceAgent.set(
      sourceAgentName,
      requests.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()),
    );
  }
  const pendingInvitationBySourceName = new Map(
    input.pendingForkInvitations.map((invitation) => [invitation.sourceAgentName, invitation]),
  );

  return input.agents.map((agent) => {
    const employee = employeeByName.get(agent.internalName);
    const accessRequests = requestsBySourceAgent.get(agent.internalName) ?? [];
    const requesterRequests = input.currentUserId
      ? accessRequests.filter((request) => request.requesterUserId === input.currentUserId)
      : [];
    const pendingRequest = requesterRequests.find((request) => request.status === "pending");
    const latestRequest = requesterRequests[0];
    const reviewableRequests = accessRequests.filter((request) => request.canDecide && request.status === "pending");
    const commonChannels = resolveShowcaseCommonChannels({
      state: input.state,
      agentChannels: agent.channels,
      currentUserId: input.currentUserId,
      currentMembershipRole: input.currentMembershipRole,
      memberByUserId: input.memberByUserId,
    });
    const publicChannels = resolveShowcasePublicAgentChannels(input.state, agent.channels);
    const skillCount = agent.skills.length;
    const knowledgeCount = (agent.knowledge?.directCount ?? 0) + (agent.knowledge?.inheritedCount ?? 0);
    const skillHighlights = agent.skills.slice(0, 3).map((skill) => ({
      name: skill.name,
      summary: skill.description,
    }));
    const knowledgeHighlights = buildShowcaseKnowledgeHighlights(agent.knowledge);
    const readiness = buildShowcaseReadiness(agent);
    const lastActivityAt = resolveShowcaseLastActivityAt(agent);
    const requestableActions = buildShowcaseRequestableActions({
      agent,
      commonChannels,
      pendingRequest,
      pendingForkInvitation: pendingInvitationBySourceName.get(agent.internalName),
    });
    const usageHints = buildShowcaseUsageHints({
      commonChannels,
      skillCount,
      knowledgeCount,
      readiness,
      requestableActions,
      channelMemberAccess: agent.channelMemberAccess,
    });
    const ownerDisplayName = agent.ownerUserId ? input.memberByUserId.get(agent.ownerUserId)?.displayName : undefined;
    const managedByLabel = ownerDisplayName ?? "Workspace managed";
    return {
      id: `showcase:${agent.internalName}`,
      kind: "digital_employee_showcase_agent",
      name: agent.name,
      subtitle: agent.internalName,
      description: agent.summary || agent.fit || employee?.role || "Workspace digital employee",
      status: agent.status,
      statusLabel: agent.statusLabel,
      tags: [
        agent.channelMemberAccess === "enabled" ? "channel_use_enabled" : "request_only",
        `${skillCount} skills`,
        `${knowledgeCount} knowledge`,
        ...commonChannels.slice(0, 2).map((channelName) => `#${channelName}`),
      ],
      internalName: agent.internalName,
      role: employee?.role ?? agent.subtitle,
      summary: agent.summary,
      fit: agent.fit,
      traits: employee?.traits ?? [],
      ownerUserId: agent.ownerUserId,
      ownerDisplayName,
      managedByLabel,
      canManage: agent.canManage,
      isOwnedByCurrentUser: Boolean(input.currentUserId && agent.ownerUserId === input.currentUserId),
      channelMemberAccess: agent.channelMemberAccess,
      channels: publicChannels,
      commonChannels,
      skillCount,
      knowledgeCount,
      skillHighlights,
      knowledgeHighlights,
      readiness,
      usageHints,
      lastActivityAt,
      requestableActions,
      forkedFrom: agent.forkedFrom,
      pendingRequest,
      latestRequest,
      pendingForkInvitation: pendingInvitationBySourceName.get(agent.internalName),
      reviewableRequests,
    } satisfies DigitalEmployeeShowcaseAgentRecord;
  }).sort(compareAgents);
}

function buildAgentAccessRequestView(
  request: AgentAccessRequestRecord,
  context: {
    memberByUserId: Map<string, RuntimeGrantMember>;
    canDecide: boolean;
  },
): WorkspaceAgentAccessRequestView {
  return {
    id: request.id,
    sourceAgentName: request.sourceAgentName,
    requesterUserId: request.requesterUserId,
    requesterDisplayName: context.memberByUserId.get(request.requesterUserId)?.displayName,
    requestType: request.requestType,
    targetChannelName: request.targetChannelName,
    status: request.status,
    reason: request.reason,
    resolverUserId: request.resolverUserId,
    resolverDisplayName: request.resolverUserId ? context.memberByUserId.get(request.resolverUserId)?.displayName : undefined,
    resolvedAt: request.resolvedAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    forkInvitationId: request.forkInvitationId,
    canDecide: context.canDecide,
  };
}

function resolveShowcaseCommonChannels(input: {
  state: AgentSpaceState;
  agentChannels: string[];
  currentUserId?: string;
  currentMembershipRole?: WorkspaceRole;
  memberByUserId: Map<string, RuntimeGrantMember>;
}): string[] {
  const publicAgentChannels = resolveShowcasePublicAgentChannels(input.state, input.agentChannels);
  if (isWorkspaceManagerRole(input.currentMembershipRole)) {
    return publicAgentChannels;
  }
  if (!input.currentUserId) {
    return [];
  }
  const currentDisplayName = input.memberByUserId.get(input.currentUserId)?.displayName;
  if (!currentDisplayName) {
    return [];
  }
  return publicAgentChannels.filter((channelName) => {
    const channel = input.state.channels.find((item) => sameText(item.name, channelName));
    return Boolean(channel && resolveChannelHumanMemberNames(input.state, channel).some((memberName) => sameText(memberName, currentDisplayName)));
  });
}

function resolveShowcasePublicAgentChannels(state: AgentSpaceState, agentChannels: string[]): string[] {
  return agentChannels.filter((channelName) => {
    const channel = state.channels.find((item) => sameText(item.name, channelName));
    return channel?.kind !== "direct";
  });
}

function buildShowcaseKnowledgeHighlights(
  knowledge?: WorkspaceAgentKnowledgeRecord,
): DigitalEmployeeShowcaseAgentRecord["knowledgeHighlights"] {
  if (!knowledge) {
    return [];
  }
  return [
    ...knowledge.directPages.map((page) => ({ title: page.title, source: "direct" as const })),
    ...knowledge.inheritedPages.map((page) => ({ title: page.title, source: "inherited" as const })),
  ].slice(0, 3);
}

function buildShowcaseReadiness(
  agent: WorkspaceAgentRecord,
): DigitalEmployeeShowcaseAgentRecord["readiness"] {
  if (agent.boundProviderHealth?.providerUsable === "unusable") {
    return {
      status: "provider_unusable",
      label: "Provider 不可用",
      reason: agent.boundProviderHealth.lastProviderErrorCode ?? agent.boundProviderHealth.providerHealthReason,
    };
  }
  if (agent.boundContainerStatus === "offline") {
    return {
      status: "runtime_offline",
      label: "执行引擎离线",
      reason: agent.boundContainerName,
    };
  }
  if (!agent.boundContainerId) {
    return {
      status: "needs_runtime",
      label: "未绑定执行引擎",
      reason: "复制后需绑定你可用的执行引擎",
    };
  }
  if (agent.boundContainerStatus === "online" || agent.status === "linked" || agent.status === "busy") {
    return {
      status: "ready",
      label: "可用",
      reason: agent.boundProvider ? `${agent.boundProvider} · ${agent.boundContainerName ?? "runtime"}` : agent.boundContainerName,
    };
  }
  return {
    status: "unknown",
    label: "状态未知",
  };
}

function resolveShowcaseLastActivityAt(agent: WorkspaceAgentRecord): string | undefined {
  const candidates = [
    ...agent.workAreas.map((area) => area.updatedAt),
    ...agent.recentMessages.map((message) => message.time),
  ].filter((value): value is string => Boolean(value));
  return candidates.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
}

function buildShowcaseRequestableActions(input: {
  agent: WorkspaceAgentRecord;
  commonChannels: string[];
  pendingRequest?: WorkspaceAgentAccessRequestView;
  pendingForkInvitation?: WorkspaceAgentForkInvitationView;
}): Array<"fork_copy" | "channel_use"> {
  if (input.agent.canManage || input.pendingRequest || input.pendingForkInvitation) {
    return [];
  }
  const actions: Array<"fork_copy" | "channel_use"> = ["fork_copy"];
  if (input.agent.channelMemberAccess !== "enabled" && input.commonChannels.length > 0) {
    actions.push("channel_use");
  }
  return actions;
}

function buildShowcaseUsageHints(input: {
  commonChannels: string[];
  skillCount: number;
  knowledgeCount: number;
  readiness: DigitalEmployeeShowcaseAgentRecord["readiness"];
  requestableActions: Array<"fork_copy" | "channel_use">;
  channelMemberAccess: "enabled" | "disabled";
}): string[] {
  const hints: string[] = [];
  if (input.commonChannels.length > 0 && input.channelMemberAccess === "enabled") {
    hints.push(`可在共同频道调用：${input.commonChannels.slice(0, 2).join("、")}`);
  } else if (input.requestableActions.includes("channel_use")) {
    hints.push(`可申请在共同频道使用：${input.commonChannels.slice(0, 2).join("、")}`);
  }
  if (input.skillCount > 0) {
    hints.push(`${input.skillCount} 个技能`);
  }
  if (input.knowledgeCount > 0) {
    hints.push(`${input.knowledgeCount} 份知识`);
  }
  if (input.readiness.status === "needs_runtime") {
    hints.push("复制后需绑定执行引擎");
  }
  return hints.slice(0, 4);
}

function suggestForkAgentName(sourceAgentDisplayName: string, targetDisplayName?: string): string {
  const source = sourceAgentDisplayName.trim() || "Agent";
  const target = targetDisplayName?.trim();
  if (target) {
    return `${target} ${source}`.slice(0, 80);
  }
  return `${source} copy`.slice(0, 80);
}

function buildWorkspaceAgentDocumentAccessSummaries(
  workspaceId: string,
  state: AgentSpaceState,
): Map<string, WorkspaceAgentDocumentAccessSummaryRecord> {
  const documentById = new Map(state.channelDocuments.map((document) => [document.id, document]));
  const latestRunByDocumentId = new Map<string, ExternalSheetOperationRun>();
  for (const run of state.externalSheetOperationRuns ?? []) {
    const existing = latestRunByDocumentId.get(run.channelDocumentId);
    const runTime = new Date(run.finishedAt ?? run.startedAt).getTime();
    const existingTime = existing ? new Date(existing.finishedAt ?? existing.startedAt).getTime() : 0;
    if (!existing || runTime > existingTime) {
      latestRunByDocumentId.set(run.channelDocumentId, run);
    }
  }

  const summaries = new Map<string, WorkspaceAgentDocumentAccessSummaryRecord>();
  const ensureSummary = (employeeName: string): WorkspaceAgentDocumentAccessSummaryRecord => {
    const existing = summaries.get(employeeName);
    if (existing) {
      return existing;
    }
    const created = createEmptyAgentDocumentAccessSummary();
    summaries.set(employeeName, created);
    return created;
  };

  for (const access of listDocumentAgentAccessSync({ workspaceId })) {
    if (access.revokedAt) {
      continue;
    }
    const document = documentById.get(access.documentId);
    const latestRun = latestRunByDocumentId.get(access.documentId);
    const summary = ensureSummary(access.subjectId);
    summary.grants.push({
      id: access.id,
      documentId: access.documentId,
      documentTitle: document?.title ?? access.documentId,
      channelName: document?.channelName ?? "",
      role: access.role,
      source: "explicit_grant",
      storageMode: document?.storageMode ?? "native",
      externalProvider: document?.externalProvider,
      externalFileId: document?.externalFileId,
      externalUrl: document?.externalUrl,
      latestExternalRunStatus: latestRun?.status,
      latestExternalRunAt: latestRun?.finishedAt ?? latestRun?.startedAt,
      latestExternalRunError: latestRun?.errorMessage,
      updatedAt: access.updatedAt,
    });
  }

  for (const request of listDocumentPermissionRequestsSync({ workspaceId })) {
    const document = request.documentId ? documentById.get(request.documentId) : undefined;
    const summary = ensureSummary(request.requestedByAgentName);
    summary.requests.push({
      id: request.id,
      status: request.status,
      requestedRole: request.requestedRole,
      targetLabel: document?.title ?? request.externalUrl ?? request.externalFileId ?? request.documentId ?? request.id,
      documentId: request.documentId,
      documentTitle: document?.title,
      externalProvider: request.externalProvider,
      externalFileId: request.externalFileId,
      externalUrl: request.externalUrl,
      requestedForChannelName: request.requestedForChannelName,
      reason: request.reason,
      decisionNote: request.decisionNote,
      createdAt: request.createdAt,
      decidedAt: request.decidedAt,
    });
  }

  for (const summary of summaries.values()) {
    summary.grants.sort((left, right) => roleRankForAgentDocumentAccess(left.role) - roleRankForAgentDocumentAccess(right.role) || left.documentTitle.localeCompare(right.documentTitle, "zh-CN", { sensitivity: "base" }));
    summary.requests.sort((left, right) => new Date(right.decidedAt ?? right.createdAt).getTime() - new Date(left.decidedAt ?? left.createdAt).getTime());
    summary.readableCount = summary.grants.length;
    summary.editableCount = summary.grants.filter((grant) => grant.role === "editor" || grant.role === "forwarder").length;
    summary.forwardableCount = summary.grants.filter((grant) => grant.role === "forwarder").length;
    summary.externalCount = summary.grants.filter((grant) => grant.storageMode === "external").length;
    summary.pendingRequestCount = summary.requests.filter((request) => request.status === "pending").length;
    summary.rejectedRequestCount = summary.requests.filter((request) => request.status === "rejected").length;
  }

  return summaries;
}

function createEmptyAgentDocumentAccessSummary(): WorkspaceAgentDocumentAccessSummaryRecord {
  return {
    readableCount: 0,
    editableCount: 0,
    forwardableCount: 0,
    externalCount: 0,
    pendingRequestCount: 0,
    rejectedRequestCount: 0,
    grants: [],
    requests: [],
  };
}

function roleRankForAgentDocumentAccess(role: WorkspaceAgentDocumentAccessRecord["role"]): number {
  if (role === "forwarder") {
    return 0;
  }
  if (role === "editor") {
    return 1;
  }
  return 2;
}

export function listDaemonSnapshotViews(workspaceId = DEFAULT_WORKSPACE_ID): DaemonSnapshotView[] {
  const runtimeDisplayNames = buildRuntimeDisplayNameIndex(workspaceId);
  const latestExternalSheetFailure = findLatestExternalSheetFailure(readWorkspaceStateCached(workspaceId));
  return listDaemonSnapshotsCached(workspaceId).map((snapshot) => {
    const daemonMetadata = safeParseJson(snapshot.daemon.metadataJson);
    const runtimeName = typeof daemonMetadata.runtimeName === "string" && daemonMetadata.runtimeName.trim()
      ? daemonMetadata.runtimeName.trim()
      : undefined;
    return {
      daemonKey: snapshot.daemon.daemonKey,
      deviceName: snapshot.daemon.deviceName,
      status: snapshot.daemon.status,
      lastHeartbeatAt: snapshot.daemon.lastHeartbeatAt,
      mode: daemonMetadata.mode === "remote" ? "remote" : "local",
      serverUrl: typeof daemonMetadata.serverUrl === "string" ? daemonMetadata.serverUrl : undefined,
      runtimeName,
      googleWorkspaceReadiness: buildGoogleWorkspaceReadinessView(
        daemonMetadata.googleWorkspaceReadiness,
        latestExternalSheetFailure,
      ),
      runtimes: snapshot.runtimes.map((runtime) => ({
        id: runtime.id,
        provider: runtime.provider,
        name: runtime.name,
        displayName: runtimeDisplayNames.get(runtime.id),
        status: runtime.status,
        providerHealth: normalizeRuntimeProviderHealth({
          runtimeStatus: runtime.status,
          runtimeMetadata: safeParseJson(runtime.metadataJson),
          lastError: runtime.lastError,
        }),
        lastHeartbeatAt: runtime.lastHeartbeatAt,
        version: runtime.version,
      })),
    };
  });
}

function buildGoogleWorkspaceReadinessView(
  value: unknown,
  latestFailure: ExternalSheetOperationRun | undefined,
): GoogleWorkspaceReadinessView | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return latestFailure
      ? {
          executor: "gws",
          agentSpaceOutput: { available: false, error: "No daemon readiness heartbeat has been recorded yet." },
          gws: { available: false, error: "No daemon readiness heartbeat has been recorded yet." },
          bwrap: { available: false, error: "No daemon readiness heartbeat has been recorded yet." },
          latestOperationFailure: buildLatestOperationFailureView(latestFailure),
        }
      : undefined;
  }

  const record = value as Record<string, unknown>;
  const bwrap = readReadinessItem(record.bwrap);
  return {
    checkedAt: readOptionalString(record.checkedAt),
    executor: readOptionalString(record.executor) ?? "gws",
    agentSpaceOutput: readReadinessItem(record.agentSpaceOutput),
    gws: readReadinessItem(record.gws),
    bwrap: {
      ...bwrap,
      supportsPerms: readOptionalBoolean((record.bwrap as Record<string, unknown> | undefined)?.supportsPerms),
    },
    latestOperationFailure: buildLatestOperationFailureView(latestFailure),
  };
}

function readReadinessItem(value: unknown): ReadinessItemView {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { available: false, error: "Readiness check is missing." };
  }
  const record = value as Record<string, unknown>;
  return {
    available: record.available === true,
    version: readOptionalString(record.version),
    error: readOptionalString(record.error),
  };
}

function findLatestExternalSheetFailure(state: AgentSpaceState): ExternalSheetOperationRun | undefined {
  return [...(state.externalSheetOperationRuns ?? [])]
    .filter((run) => run.status === "failed")
    .sort((left, right) =>
      new Date(right.finishedAt ?? right.startedAt).getTime() - new Date(left.finishedAt ?? left.startedAt).getTime()
    )[0];
}

function buildLatestOperationFailureView(run: ExternalSheetOperationRun | undefined): GoogleWorkspaceReadinessView["latestOperationFailure"] {
  if (!run) {
    return undefined;
  }
  return {
    operationType: run.operationType,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    finishedAt: run.finishedAt ?? run.startedAt,
  };
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function buildRuntimeDisplayNameIndex(workspaceId: string): Map<string, string> {
  return new Map(
    listWorkspaceRuntimeDisplayNamesCached(workspaceId)
      .map((record) => [record.runtimeId, record.displayName.trim()] as const)
      .filter((entry) => entry[1].length > 0),
  );
}

export function listDaemonTokenViews(
  workspaceId = DEFAULT_WORKSPACE_ID,
  memberByUserId = new Map<string, RuntimeGrantMember>(),
): DaemonTokenView[] {
  return listDaemonApiTokensCached(workspaceId).map((token) => ({
    id: token.id,
    label: token.label,
    status: token.status,
    createdBy: memberByUserId.get(token.createdBy)?.displayName ?? token.createdBy,
    lastUsedAt: token.lastUsedAt,
    createdAt: token.createdAt,
    revokedAt: token.revokedAt,
  }));
}

export function getSkillsPageData(workspaceId = DEFAULT_WORKSPACE_ID): SkillsPageData {
  const state = readWorkspaceStateCached(workspaceId);
  const workspaceSkills = listWorkspaceSkillsCached(workspaceId);
  const skillIdsByAgentId = listEmployeeSkillIdsByAgentIdMapSync(workspaceId);
  const assignedSkillCount = Array.from(skillIdsByAgentId.values()).reduce((sum, skillIds) => sum + skillIds.length, 0);
  const recentImports = listStoredSkillImportEventsCached(workspaceId, 12).map((event) => ({
    id: event.id,
    skillId: event.skillId,
    skillName: event.skillName,
    sourceType: event.sourceType,
    sourceUrl: event.sourceUrl,
    importMode: event.importMode,
    importedAt: event.importedAt,
    warnings: readSkillImportWarnings(event.metadataJson),
  }));

  return {
    skills: workspaceSkills.map((skill) => ({
      ...skill,
      isBuiltin: isSystemSkillName(skill.name),
    })),
    totalSkills: workspaceSkills.length,
    assignedSkillCount,
    recentImports,
    agents: state.activeEmployees.map((employee) => ({
      id: buildLegacyAgentIdForEmployeeName(employee.name),
      name: employee.remarkName?.trim() || employee.name,
      internalName: employee.name,
      skillIds: skillIdsByAgentId.get(buildLegacyAgentIdForEmployeeName(employee.name)) ?? [],
    })),
  };
}

function readSkillImportWarnings(metadataJson: string): string[] {
  try {
    const parsed = JSON.parse(metadataJson) as { warnings?: unknown };
    return Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((warning): warning is string => typeof warning === "string")
      : [];
  } catch {
    return [];
  }
}

function buildNativeRuntimeRecords(
  state: AgentSpaceState,
  runtimeSnapshots: ReturnType<typeof listDaemonSnapshotsSync>,
  bindings: ReturnType<typeof listEmployeeRuntimeBindingsSync>,
  queuedTasks: ReturnType<typeof listQueuedTasksSync>,
  runtimeDisplayNames: Map<string, string>,
  installedApps: ReturnType<typeof listRuntimeInstalledAppsSync> = [],
  runtimeAppOperations: ReturnType<typeof listRuntimeAppOperationsSync> = [],
): ContainerRecord[] {
  const boundEmployeesByRuntime = new Map<string, string[]>();
  for (const binding of bindings) {
    const next = boundEmployeesByRuntime.get(binding.runtimeId) ?? [];
    next.push(binding.employeeName);
    boundEmployeesByRuntime.set(binding.runtimeId, next);
  }

  const workspaceTaskById = new Map(state.tasks.map((task) => [task.id, task]));
  const queuedTasksByRuntime = new Map<string, ReturnType<typeof listQueuedTasksSync>>();
  for (const queuedTask of queuedTasks) {
    const next = queuedTasksByRuntime.get(queuedTask.runtimeId) ?? [];
    next.push(queuedTask);
    queuedTasksByRuntime.set(queuedTask.runtimeId, next);
  }
  const installedAppsByRuntime = new Map<string, ReturnType<typeof listRuntimeInstalledAppsSync>>();
  for (const app of installedApps) {
    const next = installedAppsByRuntime.get(app.runtimeId) ?? [];
    next.push(app);
    installedAppsByRuntime.set(app.runtimeId, next);
  }
  const appOperationsByRuntime = new Map<string, ReturnType<typeof listRuntimeAppOperationsSync>>();
  for (const operation of runtimeAppOperations) {
    const next = appOperationsByRuntime.get(operation.runtimeId) ?? [];
    next.push(operation);
    appOperationsByRuntime.set(operation.runtimeId, next);
  }

  return runtimeSnapshots.flatMap((snapshot) =>
    snapshot.runtimes.map((runtime) =>
      buildNativeRuntimeRecord(
        snapshot.daemon,
        runtime,
        runtimeDisplayNames.get(runtime.id),
        boundEmployeesByRuntime.get(runtime.id) ?? [],
        queuedTasksByRuntime.get(runtime.id) ?? [],
        installedAppsByRuntime.get(runtime.id) ?? [],
        appOperationsByRuntime.get(runtime.id) ?? [],
        workspaceTaskById,
      ),
    ),
  );
}

function buildTaskInboxItems(
  state: AgentSpaceState,
  bindings: Map<string, { runtimeId: string }>,
  runtimeIndex: Map<string, ContainerRecord>,
  queuedTasks: ReturnType<typeof listQueuedTasksSync>,
  workspaceId: string,
  currentUser?: DashboardCurrentUser,
  readableChannels: ReadableChannelLookup = buildReadableChannelLookup(state, workspaceId, currentUser),
  messagesByChannelName: Map<string, WorkspaceMessage[]> = buildMessagesByChannelName(state.messages ?? []),
): InboxItem[] {
  const queueByIssueId = new Map(queuedTasks.map((task) => [task.issueId ?? "", task]));
  const employeeByName = new Map(state.activeEmployees.map((employee) => [employee.name, employee]));
  const canSeeAllAgents = canSeeWorkspaceDiagnostics(currentUser);
  const tasks = state.tasks.filter((task) => {
    if (!currentUser?.id) {
      return true;
    }
    if (!readableChannels.canRead(task.channel)) {
      return false;
    }
    if (canSeeAllAgents) {
      return true;
    }
    const employee = employeeByName.get(task.assignee);
    return Boolean(
      employee &&
      (
        employee.ownerUserId === currentUser.id ||
        (
          (employee.channelMemberAccess ?? "enabled") === "enabled" &&
          employee.channels.some((channelName) => sameText(channelName, task.channel))
        )
      ),
    );
  });

  return limitLoadtestDashboardPayload(tasks, INBOX_TASK_ITEM_LIMIT).map((task) => {
    const relatedMessages = (messagesByChannelName.get(task.channel) ?? [])
      .slice(0, 6)
      .reverse()
      .map((message, index) => ({
        id: `task-message-${task.id}-${index}`,
        role: message.role,
        actor: message.speaker,
        timestamp: formatAbsoluteDateTime(message.time),
        body: message.summary,
        attachments: message.attachments,
      }));
    const queued = queueByIssueId.get(task.id);
    const boundRuntimeId = bindings.get(task.assignee)?.runtimeId;
    const runtime = queued?.runtimeId ? runtimeIndex.get(queued.runtimeId) : boundRuntimeId ? runtimeIndex.get(boundRuntimeId) : undefined;
    const workDirAccess: "local" | "remote" | undefined =
      runtime?.daemonMode === "remote" ? "remote" : runtime?.daemonMode === "local" ? "local" : undefined;
    const workDirHostLabel = runtime?.deviceName;
    const executionMessageCount = queued ? listTaskMessagesForTaskSync(queued.id).length : 0;
    const timeline = queued ? buildTaskExecutionTimeline(queued.id, workspaceId) : [];
    const router = buildRouterExecutionView(queued);
    const history = relatedMessages.slice(-12);
    const queuedStatus = queued ? formatNativeQueueStatus(queued.status) : undefined;

    return {
      id: `task:${task.id}`,
      kind: "task",
      title: task.title,
      subtitle: `${task.assignee} · ${formatTaskStatus(task.status)}`,
      meta: `${task.channel} · ${formatPriority(task.priority)}${queuedStatus ? ` · ${queuedStatus}` : ""}`,
      timestamp: formatTaskStatus(task.status),
      unread: task.status !== "done",
      statusLabel: formatTaskStatus(task.status),
      statusTone: toneForTask(task.status),
      body: `任务已分派给 ${task.assignee}，当前群组为 ${task.channel}，优先级 ${formatPriority(task.priority)}。`,
      history,
      task,
      channelName: task.channel,
      execution: queued
        ? redactInboxExecutionForMember({
            queueId: queued.id,
            queueStatus: formatNativeQueueStatus(queued.status),
            runtimeId: queued.runtimeId,
            runtimeName: runtime?.name,
            provider: runtime?.provider,
            daemonMode: runtime?.daemonMode,
            serverUrl: runtime?.serverUrl,
            sessionId: queued.sessionId,
            router,
            workDir: queued.workDir,
            workDirAccess,
            workDirHostLabel,
            errorText: queued.errorText,
            messageCount: executionMessageCount,
            currentEvent: timeline.at(-1),
            timeline,
          }, currentUser)
        : boundRuntimeId
          ? redactInboxExecutionForMember({
              queueId: "",
              queueStatus: "not_queued",
              runtimeId: boundRuntimeId,
              runtimeName: runtime?.name,
              provider: runtime?.provider,
              messageCount: 0,
              timeline: [],
            }, currentUser)
          : undefined,
    };
  });
}

function buildChannelInboxItems(
  state: AgentSpaceState,
  runtimeIndex: Map<string, ContainerRecord>,
  queuedTasks: ReturnType<typeof listQueuedTasksSync>,
  workspaceId: string,
  currentUser?: DashboardCurrentUser,
  readableChannels: ReadableChannelLookup = buildReadableChannelLookup(state, workspaceId, currentUser),
  messagesByChannelName: Map<string, WorkspaceMessage[]> = buildMessagesByChannelName(state.messages ?? []),
): InboxItem[] {
  const items: InboxItem[] = [];
  const queuedTaskIndex = new Map(queuedTasks.map((queuedTask) => [queuedTask.id, queuedTask]));
  const employeeByName = new Map(state.activeEmployees.map((employee) => [employee.name, employee]));
  const canSeeAllAgents = canSeeWorkspaceDiagnostics(currentUser);
  const mentionUnreadViewer = buildMentionUnreadViewer(state, currentUser?.displayName, currentUser?.id);

  for (const channel of state.channels) {
    if (currentUser?.id && !readableChannels.canRead(channel.name)) {
      continue;
    }
    const channelMessages = messagesByChannelName.get(channel.name) ?? [];
    if (channelMessages.length === 0) {
      continue;
    }

    const latestMessage = channelMessages[0];
    const channelView = buildChannelListItem(channel, state);
    const isDirect = channelView.kind === "direct";
    const workspaceExecutions = (state.conversationExecutionWorkspaces ?? [])
      .filter((workspace) => canSeeAllAgents || employeeByName.get(workspace.agentId)?.ownerUserId === currentUser?.id)
      .filter((workspace) => workspace.channelName === channel.name)
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
    const latestExecutionWorkspace = workspaceExecutions[0];
    const queuedTask = latestExecutionWorkspace?.lastTaskQueueId
      ? queuedTaskIndex.get(latestExecutionWorkspace.lastTaskQueueId)
      : undefined;
    const runtime = queuedTask?.runtimeId ? runtimeIndex.get(queuedTask.runtimeId) : undefined;
    const executionMessageCount = queuedTask ? listTaskMessagesForTaskSync(queuedTask.id).length : 0;
    const timeline = queuedTask ? buildTaskExecutionTimeline(queuedTask.id, workspaceId) : [];
    const router = buildRouterExecutionView(queuedTask);

    items.push({
      id: `channel:${channel.name}`,
      kind: "channel",
      title: isDirect ? channelView.displayName ?? channel.name : `#${channel.name}`,
      subtitle: latestMessage.speaker,
      meta: isDirect ? channelView.displaySubtitle ?? "Direct" : `${resolveChannelHumanMemberNames(state, channel).length} humans / ${channel.employeeNames.length} agents`,
      channelKind: channelView.kind,
      timestamp: formatAbsoluteDateTime(latestMessage.time),
      unread: hasUnreadMentionForViewer(channelMessages, mentionUnreadViewer),
      statusLabel: latestMessage.role === "agent" ? "Agent" : "Human",
      statusTone: latestMessage.role === "agent" ? "positive" : "neutral",
      body: latestMessage.summary,
      attachments: latestMessage.attachments,
      history: channelMessages.slice(0, 8).reverse().map((message, index) => ({
        id: `channel-entry-${channel.name}-${index}`,
        role: message.role,
        actor: message.speaker,
        timestamp: formatAbsoluteDateTime(message.time),
        body: message.summary,
        attachments: message.attachments,
      })),
      channelName: channel.name,
      execution: latestExecutionWorkspace
        ? redactInboxExecutionForMember({
            queueId: latestExecutionWorkspace.lastTaskQueueId ?? latestExecutionWorkspace.conversationKey,
            queueStatus: queuedTask ? formatNativeQueueStatus(queuedTask.status) : "not_queued",
            runtimeId: queuedTask?.runtimeId ?? "",
            runtimeName: runtime?.name,
            provider: runtime?.provider,
            daemonMode: runtime?.daemonMode,
            serverUrl: runtime?.serverUrl,
            sessionId: latestExecutionWorkspace.sessionId,
            router,
            workDir: latestExecutionWorkspace.workDir,
            workDirAccess:
              runtime?.daemonMode === "remote" ? "remote" : runtime?.daemonMode === "local" ? "local" : undefined,
            workDirHostLabel: runtime?.deviceName,
            errorText: latestExecutionWorkspace.lastError ?? queuedTask?.errorText,
            messageCount: executionMessageCount,
            currentEvent: timeline.at(-1),
            timeline,
          }, currentUser)
        : undefined,
    });
  }

  return items;
}

function buildActivityInboxItems(
  state: AgentSpaceState,
  workspaceId: string,
  currentUser?: DashboardCurrentUser,
  readableChannels: ReadableChannelLookup = buildReadableChannelLookup(state, workspaceId, currentUser),
): InboxItem[] {
  return state.ledger
    .filter((entry) => {
      const channelName = entry.data?.channel_name;
      if (!channelName || !currentUser?.id) {
        return true;
      }
      return readableChannels.canRead(channelName);
    })
    .slice(0, 8)
    .map((entry, index) => ({
    id: `activity:${index}`,
    kind: "activity",
    title: entry.title,
    subtitle: "Workspace log",
    meta: state.organizationName,
    timestamp: `更新 ${index + 1}`,
    unread: false,
    statusLabel: "System",
    statusTone: "neutral",
    body: entry.note,
    activity: entry,
    history: [
      {
        id: `activity-entry-${index}`,
        role: "system",
        actor: "AgentSpace",
        timestamp: `记录 ${index + 1}`,
        body: entry.note,
      },
    ],
  }));
}

function buildWorkspaceAgentRecord(
  employee: ActiveEmployee,
  state: AgentSpaceState,
  workspaceSkillIndex: Map<string, WorkspaceSkill>,
  skillIdsByAgentId: Map<string, string[]>,
  binding:
    | {
        runtimeId: string;
        runtimeName: string;
        provider: string;
        boundAt: string;
      }
    | undefined,
  runtimeIndex: Map<string, ContainerRecord>,
  queuedTasks: ReturnType<typeof listQueuedTasksSync>,
  knowledge: WorkspaceAgentKnowledgeRecord,
  documentAccess: WorkspaceAgentDocumentAccessSummaryRecord,
): WorkspaceAgentRecord {
  const assignedSkillIds = skillIdsByAgentId.get(buildLegacyAgentIdForEmployeeName(employee.name)) ?? [];
  const assignedSkills = assignedSkillIds
    .map((skillId) => workspaceSkillIndex.get(skillId))
    .filter((skill): skill is WorkspaceSkill => Boolean(skill));
  const tasks = state.tasks.filter((task) => task.assignee === employee.name);
  const taskPreview = limitLoadtestDashboardPayload(tasks, AGENT_TASK_PREVIEW_LIMIT);
  const recentMessages = state.messages.filter((message) => isMessageRelevantToAgent(message, employee.name, tasks)).slice(0, 6);
  const runtime = binding?.runtimeId ? runtimeIndex.get(binding.runtimeId) : undefined;
  const workspaceTaskIndex = new Map(state.tasks.map((task) => [task.id, task]));
  const workAreaMap = new Map<string, AgentWorkAreaRecord>();
  const relevantQueuedTasks = queuedTasks
    .filter((queuedTask) => queuedTask.agentId === employee.name)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  const queuedTaskIndex = new Map(relevantQueuedTasks.map((queuedTask) => [queuedTask.id, queuedTask]));

  for (const workspace of (state.conversationExecutionWorkspaces ?? []).filter((workspace) => workspace.agentId === employee.name)) {
    const queuedTask = workspace.lastTaskQueueId ? queuedTaskIndex.get(workspace.lastTaskQueueId) : undefined;
    const task = queuedTask?.issueId ? workspaceTaskIndex.get(queuedTask.issueId) : undefined;

    workAreaMap.set(workspace.conversationKey, {
      id: workspace.conversationKey,
      queueId: workspace.lastTaskQueueId ?? workspace.conversationKey,
      title: workspace.contactId ?? task?.title ?? workspace.channelName,
      channel: workspace.channelName,
      queueStatus: queuedTask ? formatNativeQueueStatus(queuedTask.status) : "not_queued",
      taskStatus: task ? formatTaskStatus(task.status) : undefined,
      updatedAt: formatAbsoluteDateTime(workspace.updatedAt),
      startedAt: queuedTask?.startedAt,
      finishedAt: queuedTask?.finishedAt,
      sessionId: workspace.sessionId,
      router: buildRouterExecutionView(queuedTask),
      workDir: workspace.workDir,
      workDirAccess: runtime?.daemonMode === "remote" ? "remote" : runtime?.daemonMode === "local" ? "local" : undefined,
      workDirHostLabel: runtime?.deviceName,
      errorText: workspace.lastError ?? queuedTask?.errorText,
    });
  }

  for (const queuedTask of relevantQueuedTasks) {
    const task = queuedTask.issueId ? workspaceTaskIndex.get(queuedTask.issueId) : undefined;
    const payload = safeParseQueuePayloadWithMetadata(queuedTask.inputJson);
    const workAreaKey =
      payload.channelName
        ? `channel:${payload.channelName}`
        : payload.contactId
          ? `contact:${payload.contactId}`
          : task?.channel
            ? `channel:${task.channel}`
            : queuedTask.workDir ?? queuedTask.id;

    if (workAreaMap.has(workAreaKey)) {
      continue;
    }

    workAreaMap.set(workAreaKey, {
      id: queuedTask.id,
      queueId: queuedTask.id,
      title: task?.title ?? safeReadTaskTitle(queuedTask.inputJson) ?? queuedTask.id,
      channel: payload.channelName ?? task?.channel,
      queueStatus: formatNativeQueueStatus(queuedTask.status),
      taskStatus: task ? formatTaskStatus(task.status) : undefined,
      updatedAt: formatAbsoluteDateTime(queuedTask.updatedAt),
      startedAt: queuedTask.startedAt,
      finishedAt: queuedTask.finishedAt,
      sessionId: queuedTask.sessionId,
      router: buildRouterExecutionView(queuedTask),
      workDir: queuedTask.workDir,
      workDirAccess: runtime?.daemonMode === "remote" ? "remote" : runtime?.daemonMode === "local" ? "local" : undefined,
      workDirHostLabel: runtime?.deviceName,
      errorText: queuedTask.errorText,
    });
  }

  const workAreas = Array.from(workAreaMap.values());

  const status = statusForWorkspaceAgent(tasks, workAreas, runtime?.status);

  return {
    id: buildLegacyAgentIdForEmployeeName(employee.name),
    kind: "agent",
    name: employee.remarkName?.trim() || employee.name,
    subtitle: employee.name,
    description: employee.summary,
    status,
    statusLabel: labelForAgentStatus(status),
    tags: [
      employee.origin,
      assignedSkills.length > 0 ? `${assignedSkills.length} skills` : "no_skills",
      employee.channels.length > 0 ? `${employee.channels.length} channels` : "unassigned_channels",
      tasks.length > 0 ? `${tasks.length} tasks` : "no_tasks",
    ],
    internalName: employee.name,
    ownerUserId: employee.ownerUserId,
    canManage: true,
    canManageChannelMemberAccess: true,
    channelMemberAccess: employee.channelMemberAccess ?? (employee.ownerUserId ? "disabled" : "enabled"),
    origin: employee.origin,
    fit: employee.fit,
    summary: employee.summary,
    skills: assignedSkills,
    channels: employee.channels,
    tasks: taskPreview,
    recentMessages,
    boundContainerId: binding?.runtimeId,
    boundContainerName: runtime?.name ?? binding?.runtimeName,
    boundContainerStatus: runtime ? (runtime.status === "linked" ? "online" : "offline") : undefined,
    boundProvider: binding?.provider,
    boundProviderHealth: runtime?.providerHealth,
    boundAt: binding?.boundAt,
    workAreas,
    instructions: employee.instructions,
    knowledge,
    documentAccess,
    googleWorkspaceDelegation: {
      status: "not_delegated",
      canRevoke: false,
    },
  };
}

function buildNativeRuntimeRecord(
  daemon: {
    daemonKey: string;
    deviceName: string;
    status: "online" | "offline";
    metadataJson: string;
    lastHeartbeatAt?: string;
  },
  runtime: {
    id: string;
    provider: string;
    name: string;
    version: string;
    status: "online" | "offline";
    deviceInfo: string;
    metadataJson: string;
    lastHeartbeatAt?: string;
    lastError?: string;
  },
  displayName: string | undefined,
  boundEmployees: string[],
  queuedTasks: ReturnType<typeof listQueuedTasksSync>,
  installedApps: ReturnType<typeof listRuntimeInstalledAppsSync>,
  runtimeAppOperations: ReturnType<typeof listRuntimeAppOperationsSync>,
  workspaceTaskById: Map<string, TaskRecord>,
): ContainerRecord {
  const runtimeMetadata = safeParseJson(runtime.metadataJson);
  const daemonMetadata = safeParseJson(daemon.metadataJson);
  const daemonMode = resolveDaemonMode(runtimeMetadata, daemonMetadata);
  const executionWorkDirAccess: "local" | "remote" = daemonMode === "remote" ? "remote" : "local";
  const serverUrl = typeof daemonMetadata.serverUrl === "string" ? daemonMetadata.serverUrl : undefined;
  const status: WorkspaceAgentStatus = runtime.status === "online" ? "linked" : "error";
  const providerHealth = normalizeRuntimeProviderHealth({
    runtimeStatus: runtime.status,
    runtimeMetadata,
    lastError: runtime.lastError,
  });
  const providerLabel = formatDaemonProviderLabel(runtime.provider);
  const trimmedDisplayName = displayName?.trim();
  const queueCounts = {
    queued: queuedTasks.filter((task) => task.status === "queued" || task.status === "claimed").length,
    running: queuedTasks.filter((task) => task.status === "running").length,
    failed: queuedTasks.filter((task) => task.status === "failed").length,
    completed: queuedTasks.filter((task) => task.status === "completed").length,
  };
  const recentExecutions = queuedTasks
    .slice()
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, 8)
    .map((queuedTask) => {
      const task = queuedTask.issueId ? workspaceTaskById.get(queuedTask.issueId) : undefined;
      const payload = safeParseQueuePayloadWithMetadata(queuedTask.inputJson);
      const taskMessages = listTaskMessagesForTaskSync(queuedTask.id).map((message) => ({
        id: message.id,
        type: message.type,
        content: message.content ?? message.output ?? message.type,
        createdAt: message.createdAt,
        status: (message.type === "error" ? "error" : "completed") as "error" | "completed",
      }));
      const timeline = buildTaskExecutionTimeline(queuedTask.id, queuedTask.workspaceId, 8);
      const router = buildRouterExecutionView(queuedTask);
      return {
        queueId: queuedTask.id,
        taskId: queuedTask.issueId,
        title: task?.title ?? safeReadTaskTitle(queuedTask.inputJson) ?? queuedTask.id,
        assignee: task?.assignee ?? queuedTask.agentId,
        channel: task?.channel ?? payload.channelName,
        queueStatus: formatNativeQueueStatus(queuedTask.status),
        taskStatus: task ? formatTaskStatus(task.status) : undefined,
        messageCount: taskMessages.length,
        startedAt: queuedTask.startedAt,
        finishedAt: queuedTask.finishedAt,
        sessionId: queuedTask.sessionId,
        router,
        workDir: queuedTask.workDir,
        workDirAccess: executionWorkDirAccess,
        workDirHostLabel: runtime.deviceInfo || daemon.deviceName,
        errorText: queuedTask.errorText,
        taskMessages,
        timeline,
      };
    });
  const cliHubReadiness = normalizeCliHubReadiness(daemonMetadata.cliHubReadiness);
  const installedAppViews = installedApps.map((app) => ({
    source: app.source,
    name: app.name,
    displayName: app.displayName,
    version: app.version,
    entryPoint: app.entryPoint,
    status: app.status,
    enabled: app.enabled,
    lastError: app.lastError,
    updatedAt: app.updatedAt,
  }));
  const recentAppOperations = runtimeAppOperations
    .slice()
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 8)
    .map((operation) => ({
      id: operation.id,
      appSource: operation.appSource,
      appName: operation.appName,
      operation: operation.operation,
      status: operation.status,
      createdAt: operation.createdAt,
      errorMessage: operation.errorMessage,
    }));

  return {
    id: `runtime:${runtime.id}`,
    kind: "container",
    name: runtime.name,
    subtitle: `${providerLabel} · ${runtime.deviceInfo || daemon.deviceName}`,
    description:
      runtime.status === "online" && providerHealth.providerUsable === "unusable"
        ? `Provider unavailable: ${providerHealth.providerHealthReason ?? providerHealth.lastProviderErrorMessage ?? "health check failed"}`
        : runtime.status === "online"
        ? "The container is online and can host independent work areas for multiple agents."
        : runtime.lastError || "The container is currently offline.",
    status,
    statusLabel: labelForAgentStatus(status),
    tags: [
      daemon.deviceName,
      runtime.version || "version_unavailable",
      runtime.lastHeartbeatAt ?? daemon.lastHeartbeatAt ?? "heartbeat_unavailable",
    ],
    runtimeId: runtime.id,
    provider: runtime.provider,
    displayName: trimmedDisplayName || undefined,
    daemonKey: daemon.daemonKey,
    deviceName: runtime.deviceInfo || daemon.deviceName,
    runtimeStatus: runtime.status,
    providerHealth,
    daemonMode,
    serverUrl,
    version: runtime.version || undefined,
    lastHeartbeatAt: runtime.lastHeartbeatAt ?? daemon.lastHeartbeatAt,
    executablePath:
      typeof runtimeMetadata.executablePath === "string" ? runtimeMetadata.executablePath : undefined,
    daemonPid: typeof daemonMetadata.pid === "string" ? daemonMetadata.pid : undefined,
    cliHubReadiness,
    installedApps: installedAppViews,
    recentAppOperations,
    grantedMembers: [],
    canManageGrants: false,
    boundEmployees,
    agentCount: boundEmployees.length,
    queueCounts,
    recentExecutions,
  };
}

function compareContainers(left: ContainerRecord, right: ContainerRecord): number {
  const leftPriority = priorityForAgentStatus(left.status);
  const rightPriority = priorityForAgentStatus(right.status);
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return left.name.localeCompare(right.name, "zh-CN", { sensitivity: "base" });
}

function compareAgents(left: ManagementRecordBase, right: ManagementRecordBase): number {
  const leftPriority = priorityForAgentStatus(left.status);
  const rightPriority = priorityForAgentStatus(right.status);
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return left.name.localeCompare(right.name, "zh-CN", { sensitivity: "base" });
}

function safeParseJson(value: string): Record<string, unknown> {
  if (!value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function resolveDaemonMode(
  runtimeMetadata: Record<string, unknown>,
  daemonMetadata: Record<string, unknown>,
): "local" | "remote" {
  const runtimeMode = runtimeMetadata.mode;
  if (runtimeMode === "local" || runtimeMode === "remote") {
    return runtimeMode;
  }
  const daemonMode = daemonMetadata.mode;
  if (daemonMode === "local" || daemonMode === "remote") {
    return daemonMode;
  }
  return "local";
}

function toneForTask(status: TaskStatus): InboxItem["statusTone"] {
  if (status === "done") {
    return "positive";
  }
  if (status === "blocked") {
    return "danger";
  }
  if (status === "in_progress") {
    return "warning";
  }
  return "neutral";
}

function toneForNotification(notification: WorkspaceNotificationRecord): InboxItem["statusTone"] {
  if (notification.severity === "critical") {
    return "danger";
  }
  if (notification.severity === "warning") {
    return "warning";
  }
  if (notification.severity === "success") {
    return "positive";
  }
  return "neutral";
}

function formatNotificationStatus(status: WorkspaceNotificationRecord["status"]): string {
  if (status === "unread") {
    return "Unread";
  }
  if (status === "archived") {
    return "Archived";
  }
  return "Read";
}

function formatNotificationResourceType(resourceType: WorkspaceNotificationRecord["resourceType"]): string {
  if (resourceType === "workspace_member") {
    return "Workspace member";
  }
  return resourceType.charAt(0).toUpperCase() + resourceType.slice(1);
}

function statusForWorkspaceAgent(
  tasks: TaskRecord[],
  workAreas: AgentWorkAreaRecord[],
  containerStatus?: WorkspaceAgentStatus,
): WorkspaceAgentStatus {
  if (containerStatus === "error") {
    return "error";
  }
  if (tasks.some((task) => task.status === "blocked")) {
    return "blocked";
  }
  if (workAreas.some((area) => area.queueStatus === "running" || area.queueStatus === "claimed" || area.queueStatus === "queued")) {
    return "busy";
  }
  if (tasks.some((task) => task.status === "in_progress")) {
    return "busy";
  }
  return "online";
}

function formatTaskStatus(status: TaskStatus): string {
  return status;
}

function formatPriority(priority: TaskRecord["priority"]): string {
  return priority;
}

function labelForAgentStatus(status: WorkspaceAgentStatus): string {
  return status;
}

function priorityForAgentStatus(status: WorkspaceAgentStatus): number {
  if (status === "error") {
    return 0;
  }
  if (status === "blocked") {
    return 1;
  }
  if (status === "busy") {
    return 2;
  }
  if (status === "linked") {
    return 3;
  }
  return 4;
}

function formatAbsoluteDateTime(value: string): string {
  return formatCompactTimestamp(value, { emptyFallback: value });
}

function formatNativeQueueStatus(status: string): string {
  return status;
}

function safeReadTaskTitle(inputJson: string): string | undefined {
  try {
    const parsed = JSON.parse(inputJson) as Record<string, unknown>;
    return typeof parsed.title === "string" ? parsed.title : undefined;
  } catch {
    return undefined;
  }
}

function safeParseQueuePayloadWithMetadata(inputJson: string): {
  contactId?: string;
  channelName?: string;
  mentionedAgentIds?: string[];
} {
  try {
    const parsed = JSON.parse(inputJson) as Record<string, unknown>;
    return {
      contactId: typeof parsed.contactId === "string" ? parsed.contactId : undefined,
      channelName: typeof parsed.channelName === "string" ? parsed.channelName : undefined,
      mentionedAgentIds: Array.isArray(parsed.mentionedAgentIds)
        ? parsed.mentionedAgentIds.filter((item): item is string => typeof item === "string")
        : undefined,
    };
  } catch {
    return {};
  }
}

function buildChannelDocumentChangeSetRecord(
  changeSet: ChannelDocumentChangeSet,
  context: {
    messageIndex: Map<string, WorkspaceMessage>;
    queuedTaskIndex: Map<string, ReturnType<typeof listQueuedTasksSync>[number]>;
    runStepByQueuedTaskId: Map<string, ChannelDocumentRunStep>;
    runStepByDocumentVersionId: Map<string, ChannelDocumentRunStep>;
  },
): ChannelDocumentChangeSetRecord {
  const sourceMessage = changeSet.sourceMessageId ? context.messageIndex.get(changeSet.sourceMessageId) : undefined;
  const sourceTask = changeSet.sourceTaskQueueId ? context.queuedTaskIndex.get(changeSet.sourceTaskQueueId) : undefined;
  const sourceStep =
    (changeSet.sourceTaskQueueId ? context.runStepByQueuedTaskId.get(changeSet.sourceTaskQueueId) : undefined) ??
    (changeSet.documentVersionId ? context.runStepByDocumentVersionId.get(changeSet.documentVersionId) : undefined);

  return {
    id: changeSet.id,
    documentId: changeSet.documentId,
    actorId: changeSet.actorId,
    actorType: changeSet.actorType,
    baseVersionId: changeSet.baseVersionId,
    documentVersionId: changeSet.documentVersionId,
    status: changeSet.status,
    sourceMessageId: changeSet.sourceMessageId,
    sourceTaskQueueId: changeSet.sourceTaskQueueId,
    createdAt: changeSet.createdAt,
    operationSummary: summarizeChangeSetOperations(changeSet.operationsJson),
    sourceMessage: sourceMessage
      ? {
          id: sourceMessage.id,
          speaker: sourceMessage.speaker,
          summary: sourceMessage.summary,
          time: sourceMessage.time,
        }
      : undefined,
    sourceTask: sourceTask
      ? {
          id: sourceTask.id,
          title: safeReadTaskTitle(sourceTask.inputJson) ?? sourceTask.id,
          status: sourceTask.status,
        }
      : undefined,
    sourceStep: sourceStep
      ? {
          id: sourceStep.id,
          runId: sourceStep.runId,
          agentLabel: sourceStep.agentLabel,
          instruction: sourceStep.instruction,
          status: sourceStep.status,
        }
      : undefined,
    retryable: isRetryableChangeSetOperations(changeSet.operationsJson),
  };
}

function buildChannelDocumentSyncEventRecord(
  version: ChannelDocumentVersion,
  context: {
    messageIndex: Map<string, WorkspaceMessage>;
    queuedTaskIndex: Map<string, ReturnType<typeof listQueuedTasksSync>[number]>;
    runStepByDocumentVersionId: Map<string, ChannelDocumentRunStep>;
  },
): ChannelDocumentSyncEventRecord | undefined {
  if (version.triggerType === "manual" && version.createdByType === "human") {
    return undefined;
  }

  const sourceMessage = version.sourceMessageId ? context.messageIndex.get(version.sourceMessageId) : undefined;
  const sourceTask = version.sourceTaskQueueId ? context.queuedTaskIndex.get(version.sourceTaskQueueId) : undefined;
  const sourceStep = context.runStepByDocumentVersionId.get(version.id);
  const createdAt = new Date(version.createdAt).getTime();

  return {
    actorId: version.createdBy,
    actorType: version.createdByType,
    triggerType: version.triggerType,
    versionId: version.id,
    createdAt: version.createdAt,
    isRecent: Number.isFinite(createdAt) ? Date.now() - createdAt <= CHANNEL_DOCUMENT_SYNC_EVENT_TTL_MS : false,
    sourceMessage: sourceMessage
      ? {
          id: sourceMessage.id,
          speaker: sourceMessage.speaker,
          summary: sourceMessage.summary,
          time: sourceMessage.time,
        }
      : undefined,
    sourceTask: sourceTask
      ? {
          id: sourceTask.id,
          title: safeReadTaskTitle(sourceTask.inputJson) ?? sourceTask.id,
          status: sourceTask.status,
        }
      : undefined,
    sourceStep: sourceStep
      ? {
          id: sourceStep.id,
          runId: sourceStep.runId,
          agentLabel: sourceStep.agentLabel,
          instruction: sourceStep.instruction,
          status: sourceStep.status,
        }
      : undefined,
  };
}

function buildChannelDocumentConflictMergePreview(input: {
  conflict: ChannelDocumentConflict;
  document?: ChannelDocument;
  currentVersion?: ChannelDocumentVersion;
  currentBlocks: ChannelDocumentBlock[];
  rightChangeSet?: ChannelDocumentChangeSet;
}): ChannelDocumentConflictRecord["mergePreview"] {
  const parsedOperations = parseChannelDocumentChangeSetOperations(input.rightChangeSet?.operationsJson);
  if (parsedOperations.length === 0) {
    return undefined;
  }

  const replaceDocumentOperation = parsedOperations.find((operation) => operation.op === "replace_document");
  if (replaceDocumentOperation && typeof replaceDocumentOperation.contentMarkdown === "string") {
    return {
      mode: "document",
      currentLabel: "当前版本",
      currentContentMarkdown: input.currentVersion?.contentMarkdown ?? "",
      incomingLabel: "冲突改动",
      incomingContentMarkdown: replaceDocumentOperation.contentMarkdown,
      suggestedDraftContentMarkdown: replaceDocumentOperation.contentMarkdown,
      suggestedDraftTitle:
        typeof replaceDocumentOperation.title === "string" && replaceDocumentOperation.title.trim().length > 0
          ? replaceDocumentOperation.title
          : input.document?.title,
      suggestedDraftSummary:
        typeof replaceDocumentOperation.summary === "string" && replaceDocumentOperation.summary.trim().length > 0
          ? replaceDocumentOperation.summary
          : input.document?.summary,
    };
  }

  const focusedOperation =
    parsedOperations.find(
      (operation) =>
        "blockId" in operation &&
        typeof operation.blockId === "string" &&
        operation.blockId === input.conflict.blockId,
    ) ?? parsedOperations[0];
  if (!focusedOperation) {
    return undefined;
  }
  const currentBlock = input.currentBlocks.find((block) => block.id === input.conflict.blockId);
  const suggestedBlocks = buildSuggestedConflictDraftBlocks(input.currentBlocks, parsedOperations);
  if (!suggestedBlocks) {
    return undefined;
  }

  let incomingLabel = "冲突改动";
  let incomingContentMarkdown = "";
  if (focusedOperation.op === "replace_block") {
    incomingLabel = "冲突块内容";
    incomingContentMarkdown = focusedOperation.contentMarkdown;
  } else if (focusedOperation.op === "delete_block") {
    incomingLabel = "冲突删除动作";
    incomingContentMarkdown = "(该块会被删除)";
  } else if (focusedOperation.op === "insert_after") {
    incomingLabel = "冲突插入内容";
    incomingContentMarkdown = focusedOperation.contentMarkdown;
  }

  return {
    mode: "block",
    currentLabel: currentBlock?.heading ? `当前块 · ${currentBlock.heading}` : "当前块",
    currentContentMarkdown: currentBlock?.contentMarkdown ?? input.currentVersion?.contentMarkdown ?? "",
    incomingLabel,
    incomingContentMarkdown,
    suggestedDraftContentMarkdown: serializeConflictDraftBlocks(suggestedBlocks),
    suggestedDraftTitle: input.document?.title,
    suggestedDraftSummary: input.document?.summary,
  };
}

function parseChannelDocumentChangeSetOperations(
  operationsJson: string | undefined,
): Array<
  | { op: "replace_document"; title?: string; contentMarkdown?: string; summary?: string }
  | { op: "replace_block"; blockId: string; contentMarkdown: string; heading?: string }
  | { op: "insert_after"; afterBlockId?: string; contentMarkdown: string; heading?: string }
  | { op: "delete_block"; blockId: string }
> {
  if (!operationsJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(operationsJson) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const result: Array<
      | { op: "replace_document"; title?: string; contentMarkdown?: string; summary?: string }
      | { op: "replace_block"; blockId: string; contentMarkdown: string; heading?: string }
      | { op: "insert_after"; afterBlockId?: string; contentMarkdown: string; heading?: string }
      | { op: "delete_block"; blockId: string }
    > = [];

    for (const operation of parsed) {
      if (!operation || typeof operation !== "object") {
        continue;
      }
      const candidate = operation as {
        op?: unknown;
        title?: unknown;
        contentMarkdown?: unknown;
        summary?: unknown;
        blockId?: unknown;
        afterBlockId?: unknown;
        heading?: unknown;
      };
      if (candidate.op === "replace_document") {
        result.push({
          op: "replace_document",
          title: typeof candidate.title === "string" ? candidate.title : undefined,
          contentMarkdown: typeof candidate.contentMarkdown === "string" ? candidate.contentMarkdown : undefined,
          summary: typeof candidate.summary === "string" ? candidate.summary : undefined,
        });
        continue;
      }
      if (candidate.op === "replace_block" && typeof candidate.blockId === "string" && typeof candidate.contentMarkdown === "string") {
        result.push({
          op: "replace_block",
          blockId: candidate.blockId,
          contentMarkdown: candidate.contentMarkdown,
          heading: typeof candidate.heading === "string" ? candidate.heading : undefined,
        });
        continue;
      }
      if (candidate.op === "insert_after" && typeof candidate.contentMarkdown === "string") {
        result.push({
          op: "insert_after",
          afterBlockId: typeof candidate.afterBlockId === "string" ? candidate.afterBlockId : undefined,
          contentMarkdown: candidate.contentMarkdown,
          heading: typeof candidate.heading === "string" ? candidate.heading : undefined,
        });
        continue;
      }
      if (candidate.op === "delete_block" && typeof candidate.blockId === "string") {
        result.push({ op: "delete_block", blockId: candidate.blockId });
      }
    }

    return result;
  } catch {
    return [];
  }
}

function buildSuggestedConflictDraftBlocks(
  blocks: ChannelDocumentBlock[],
  operations: ReturnType<typeof parseChannelDocumentChangeSetOperations>,
): ChannelDocumentBlock[] | null {
  const nextBlocks = blocks.map((block) => ({ ...block }));

  for (const operation of operations) {
    if (operation.op === "replace_block") {
      const index = nextBlocks.findIndex((block) => block.id === operation.blockId);
      if (index < 0) {
        return null;
      }
      nextBlocks[index] = {
        ...nextBlocks[index]!,
        heading: operation.heading ?? nextBlocks[index]!.heading,
        contentMarkdown: operation.contentMarkdown,
      };
      continue;
    }

    if (operation.op === "delete_block") {
      const index = nextBlocks.findIndex((block) => block.id === operation.blockId);
      if (index < 0) {
        return null;
      }
      nextBlocks.splice(index, 1);
      continue;
    }

    if (operation.op === "insert_after") {
      const insertIndex = operation.afterBlockId
        ? nextBlocks.findIndex((block) => block.id === operation.afterBlockId) + 1
        : 0;
      if (operation.afterBlockId && insertIndex <= 0) {
        return null;
      }
      const nextIndex = insertIndex < 0 ? nextBlocks.length : insertIndex;
      nextBlocks.splice(nextIndex, 0, {
        id: `preview-block-${nextIndex}`,
        documentId: nextBlocks[0]?.documentId ?? "",
        parentId: undefined,
        type: "section",
        order: nextIndex,
        heading: operation.heading,
        contentMarkdown: operation.contentMarkdown,
        revision: 0,
        updatedBy: "preview",
        updatedAt: new Date(0).toISOString(),
      });
      continue;
    }
  }

  return nextBlocks.map((block, index) => ({ ...block, order: index }));
}

function serializeConflictDraftBlocks(blocks: ChannelDocumentBlock[]): string {
  return blocks
    .map((block) => block.contentMarkdown.trim())
    .filter((value) => value.length > 0)
    .join("\n\n");
}

function summarizeChangeSetOperations(operationsJson: string): string {
  try {
    const parsed = JSON.parse(operationsJson) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return "未知改动";
    }

    const counts = new Map<string, number>();
    for (const operation of parsed) {
      if (!operation || typeof operation !== "object") {
        continue;
      }
      const op = typeof (operation as { op?: unknown }).op === "string" ? (operation as { op: string }).op : "unknown";
      counts.set(op, (counts.get(op) ?? 0) + 1);
    }

    if (counts.size === 0) {
      return "未知改动";
    }

    const labels: string[] = [];
    if (counts.has("replace_document")) {
      labels.push("整篇覆盖");
    }
    if (counts.has("replace_block")) {
      labels.push(`替换 ${counts.get("replace_block")} 个块`);
    }
    if (counts.has("insert_after")) {
      labels.push(`插入 ${counts.get("insert_after")} 个块`);
    }
    if (counts.has("delete_block")) {
      labels.push(`删除 ${counts.get("delete_block")} 个块`);
    }
    if (counts.has("unknown")) {
      labels.push(`其他变更 ${counts.get("unknown")}`);
    }

    return labels.join(" / ");
  } catch {
    return "未知改动";
  }
}

function isRetryableChangeSetOperations(operationsJson: string): boolean {
  try {
    const parsed = JSON.parse(operationsJson) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return false;
    }
    return parsed.every((operation) => {
      if (!operation || typeof operation !== "object") {
        return false;
      }
      const candidate = operation as {
        op?: unknown;
        contentMarkdown?: unknown;
      };
      if (candidate.op === "replace_document") {
        return typeof candidate.contentMarkdown === "string";
      }
      if (candidate.op === "replace_block" || candidate.op === "insert_after") {
        return typeof candidate.contentMarkdown === "string";
      }
      return candidate.op === "delete_block";
    });
  } catch {
    return false;
  }
}

function isMessageRelevantToAgent(message: WorkspaceMessage, agentName: string, tasks: TaskRecord[]): boolean {
  if (sameText(message.speaker, agentName) || message.speaker.includes(agentName)) {
    return true;
  }

  if (message.mentions?.some((mention) =>
    mention.mentionType === "agent" && (sameText(mention.agentId, agentName) || sameText(mention.label, agentName))
  )) {
    return true;
  }

  for (const task of tasks) {
    if (task.title.length > 0 && message.summary.includes(task.title)) {
      return true;
    }
  }

  return false;
}

function sameText(left: string, right: string): boolean {
  return left.localeCompare(right, "zh-CN", { sensitivity: "base" }) === 0;
}

export type TaskBoardGroupBy = "status" | "assignee" | "priority" | "channel";

export interface TaskBoardColumn {
  key: string;
  label: string;
  tasks: TaskRecord[];
}

export interface TaskBoardPageData {
  tasks: TaskRecord[];
  columns: TaskBoardColumn[];
  agents: Array<{ id: string; name: string }>;
  channels: Array<{ name: string }>;
  totalCount: number;
  todoCount: number;
  inProgressCount: number;
  doneCount: number;
}

export function getTaskBoardPageData(
  groupBy: TaskBoardGroupBy = "status",
  workspaceId = DEFAULT_WORKSPACE_ID,
  currentUser?: DashboardCurrentUser,
): TaskBoardPageData {
  const state = readWorkspaceStateCached(workspaceId);
  const canSeeAllAgents = canSeeWorkspaceDiagnostics(currentUser);
  const readableChannels = buildReadableChannelLookup(state, workspaceId, currentUser);
  const visibleChannels = currentUser?.id
    ? state.channels.filter((channel) => readableChannels.canRead(channel.name))
    : state.channels;
  const visibleChannelNames = new Set(visibleChannels.map((channel) => channel.name));
  const visibleChannelAgentNames = new Set(visibleChannels.flatMap((channel) => channel.employeeNames));
  const visibleAgents = canSeeAllAgents
    ? state.activeEmployees
    : state.activeEmployees.filter((employee) =>
        employee.ownerUserId === currentUser?.id ||
        (
          (employee.channelMemberAccess ?? "enabled") === "enabled" &&
          visibleChannelAgentNames.has(employee.name)
        ),
      );
  const visibleAgentNames = new Set(visibleAgents.map((employee) => employee.name));
  const tasks = state.tasks
    .filter((task) => canSeeAllAgents || visibleAgentNames.has(task.assignee))
    .filter((task) => !currentUser?.id || visibleChannelNames.has(task.channel))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const taskPreview = limitLoadtestDashboardPayload(tasks, TASK_BOARD_TASK_LIMIT);

  const columns = buildTaskBoardColumns(taskPreview, groupBy, state);

  return {
    tasks: taskPreview,
    columns,
    agents: visibleAgents.map((employee) => ({
      id: employee.name,
      name: employee.remarkName?.trim() || employee.name,
    })),
    channels: visibleChannels.map((channel) => ({ name: channel.name })),
    totalCount: tasks.length,
    todoCount: tasks.filter((t) => t.status === "todo").length,
    inProgressCount: tasks.filter((t) => t.status === "in_progress").length,
    doneCount: tasks.filter((t) => t.status === "done").length,
  };
}

function buildTaskBoardColumns(
  tasks: TaskRecord[],
  groupBy: TaskBoardGroupBy,
  state: AgentSpaceState,
): TaskBoardColumn[] {
  if (groupBy === "status") {
    const statuses: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];
    const labels: Record<TaskStatus, string> = {
      todo: "Todo",
      in_progress: "In Progress",
      blocked: "Blocked",
      done: "Done",
    };
    return statuses.map((status) => ({
      key: status,
      label: labels[status],
      tasks: tasks.filter((t) => t.status === status),
    }));
  }

  if (groupBy === "assignee") {
    const assignees = [...new Set(tasks.map((t) => t.assignee))];
    const employeeIndex = new Map(
      state.activeEmployees.map((e) => [e.name, e]),
    );
    return assignees.map((assignee) => ({
      key: assignee,
      label: employeeIndex.get(assignee)?.remarkName?.trim() || assignee,
      tasks: tasks.filter((t) => t.assignee === assignee),
    }));
  }

  if (groupBy === "priority") {
    const priorities: Array<TaskRecord["priority"]> = ["high", "medium", "low"];
    return priorities.map((priority) => ({
      key: priority,
      label: priority.charAt(0).toUpperCase() + priority.slice(1),
      tasks: tasks.filter((t) => t.priority === priority),
    }));
  }

  // groupBy === "channel"
  const channelNames = [...new Set(tasks.map((t) => t.channel))];
  return channelNames.map((channelName) => ({
    key: channelName,
    label: `#${channelName}`,
    tasks: tasks.filter((t) => t.channel === channelName),
  }));
}

export function readAuthenticatedUserCountSync(): number {
  return countUsersSync();
}

// ── Org Chart ──

export interface OrgChartNode {
  id: string;
  name: string;
  displayName: string;
  role: string;
  type: "human" | "agent";
  channels: string[];
  status: "online" | "offline";
}

export interface OrgChartPageData {
  humans: OrgChartNode[];
  agents: OrgChartNode[];
  channels: Array<{ name: string; agentNames: string[] }>;
  totalHumans: number;
  totalAgents: number;
}

export function getOrgChartPageData(workspaceId = DEFAULT_WORKSPACE_ID): OrgChartPageData {
  const state = readWorkspaceStateCached(workspaceId);
  const workspaceMembers = listWorkspaceMemberUsersCached(workspaceId);
  const bindings = listEmployeeRuntimeBindingsCached(workspaceId);
  const boundNames = new Set(bindings.map((b) => b.employeeName));

  const humans: OrgChartNode[] = workspaceMembers.map((member) => ({
    id: member.userId,
    name: member.displayName,
    displayName: member.displayName,
    role: formatWorkspaceRoleLabel(member.role),
    type: "human" as const,
    channels: state.channels
      .filter((ch) => resolveChannelHumanMemberNames(state, ch).some((name) => sameText(name, member.displayName)))
      .map((ch) => ch.name),
    status: "online" as const,
  }));

  const agents: OrgChartNode[] = state.activeEmployees.map((e) => ({
    id: e.name,
    name: e.name,
    displayName: e.remarkName?.trim() || e.name,
    role: e.role,
    type: "agent" as const,
    channels: e.channels,
    status: boundNames.has(e.name) ? ("online" as const) : ("offline" as const),
  }));

  const channels = state.channels.map((ch) => ({
    name: ch.name,
    agentNames: ch.employeeNames,
  }));

  return {
    humans,
    agents,
    channels,
    totalHumans: humans.length,
    totalAgents: agents.length,
  };
}

// ── Costs ──

export interface CostPageData {
  agents: Array<{
    agentId: string;
    displayName: string;
    modelId: string;
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    taskCount: number;
    avgCostPerTask: number;
  }>;
  totalCostUsd: number;
  totalTasks: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  models: Array<{ modelId: string; displayName: string; inputPer1M: number; outputPer1M: number }>;
  recentUsage: Array<{
    id: string;
    agentId: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    channelName?: string;
    createdAt: string;
  }>;
}

export function getCostPageData(
  period: "monthly" | "total" = "monthly",
  workspaceId = DEFAULT_WORKSPACE_ID,
): CostPageData {
  return getCostDashboardDataCached(period, workspaceId);
}

// ── Budgets ──

export interface BudgetPageItem {
  id: string;
  scope: BudgetScope;
  scopeId: string;
  limitUsd: number;
  period: BudgetPeriod;
  action: BudgetAction;
  warningThreshold: number;
  enabled: boolean;
  spentUsd: number;
  percentUsed: number;
}

export interface BudgetPageData {
  budgets: BudgetPageItem[];
  agents: Array<{ id: string; name: string }>;
  channels: Array<{ name: string }>;
}

export function getBudgetPageData(workspaceId = DEFAULT_WORKSPACE_ID): BudgetPageData {
  const state = readWorkspaceStateCached(workspaceId);
  const budgets = listBudgetsWithSpentCached(workspaceId);

  return {
    budgets: budgets.map((b) => ({
      id: b.id,
      scope: b.scope,
      scopeId: b.scopeId,
      limitUsd: b.limitUsd,
      period: b.period,
      action: b.action,
      warningThreshold: b.warningThreshold,
      enabled: b.enabled,
      spentUsd: b.spentUsd,
      percentUsed: b.percentUsed,
    })),
    agents: state.activeEmployees.map((e) => ({
      id: e.name,
      name: e.remarkName?.trim() || e.name,
    })),
    channels: state.channels.map((ch) => ({ name: ch.name })),
  };
}

// ── Knowledge ──

export interface KnowledgePageData {
  pages: KnowledgePageRecord[];
  totalCount: number;
  rootCount: number;
  agentOptions: KnowledgeAgentOption[];
  assignmentStats: KnowledgeAssignmentStats;
  materials: Array<{ id: string; source: string; preview?: string }>;
  documentPages: KnowledgeDocumentPageRecord[];
  documentCount: number;
  linkedDocumentCount: number;
}

export interface KnowledgeDocumentPageRecord {
  id: string;
  sourceType: "attachment" | "channelDocument";
  sourceId: string;
  title: string;
  summary: string;
  previewText: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  kind: MessageAttachment["kind"];
  isMarkdown: boolean;
  channelName?: string;
  sourceMessageId?: string;
  sourceSpeaker?: string;
  sourceTime?: string;
  updatedAt: string;
  updatedBy: string;
  status: "active" | "archived" | "shared";
  sourceAttachmentId?: string;
  linkedChannelDocuments: Array<{
    id: string;
    title: string;
    channelName: string;
  }>;
  linkedKnowledgePages: Array<{
    id: string;
    title: string;
  }>;
}

export function getKnowledgePageData(
  currentUserDisplayName?: string,
  workspaceId = DEFAULT_WORKSPACE_ID,
): KnowledgePageData {
  const state = readWorkspaceStateCached(workspaceId);
  const knowledgePolicies = listKnowledgeAssignmentPoliciesCached(workspaceId);
  const knowledgeAssignments = listKnowledgeAssignmentsCached(workspaceId);
  const knowledgePolicyIndex = new Map(knowledgePolicies.map((policy) => [policy.knowledgePageId, policy]));
  const agentOptions = buildKnowledgeAgentOptions(state);
  const knowledgePageRecords = buildKnowledgePageRecords(
    state.knowledgePages,
    agentOptions,
    knowledgePolicyIndex,
    knowledgeAssignments,
  );
  const queuedTasks = listQueuedTasksCached(workspaceId);
  const visibleChannelNames = getVisibleWorkspaceChannelNames(state, currentUserDisplayName);
  const workspaceArtifacts = buildChannelWorkspaceArtifacts(
    state,
    queuedTasks,
    currentUserDisplayName,
    visibleChannelNames,
    workspaceId,
  );
  const documentPages = buildKnowledgeDocumentPageRecords(
    workspaceArtifacts.documents,
    workspaceArtifacts.channelFiles,
    state.knowledgePages,
  );
  const knowledgePagePreview = limitLoadtestDashboardPayload(knowledgePageRecords, KNOWLEDGE_PAGE_PREVIEW_LIMIT);

  return {
    pages: knowledgePagePreview,
    totalCount: state.knowledgePages.length,
    rootCount: state.knowledgePages.filter((page) => page.parentId === null).length,
    agentOptions,
    assignmentStats: buildKnowledgeAssignmentStats(knowledgePageRecords, state.knowledgePages),
    materials: state.materials.map((m) => ({
      id: m.id ?? "",
      source: m.source,
      preview: m.preview,
    })),
    documentPages,
    documentCount: documentPages.length,
    linkedDocumentCount: documentPages.filter((document) => document.linkedKnowledgePages.length > 0).length,
  };
}

function buildKnowledgeAgentOptions(state: AgentSpaceState): KnowledgeAgentOption[] {
  return state.activeEmployees.map((employee) => ({
    id: buildLegacyAgentIdForEmployeeName(employee.name),
    employeeName: employee.name,
    name: employee.remarkName?.trim() || employee.name,
    subtitle: employee.name,
    status: "linked",
  }));
}

function buildKnowledgePageRecords(
  pages: KnowledgePage[],
  agentOptions: KnowledgeAgentOption[],
  policyIndex: Map<string, ReturnType<typeof listKnowledgeAssignmentPoliciesSync>[number]>,
  assignments: ReturnType<typeof listKnowledgeAssignmentsSync>,
): KnowledgePageRecord[] {
  const agentByEmployeeName = new Map(agentOptions.map((agent) => [agent.employeeName, agent]));
  const assignmentsByPageId = new Map<string, ReturnType<typeof listKnowledgeAssignmentsSync>>();
  for (const assignment of assignments) {
    const next = assignmentsByPageId.get(assignment.knowledgePageId) ?? [];
    next.push(assignment);
    assignmentsByPageId.set(assignment.knowledgePageId, next);
  }

  return pages.map((page) => {
    const policy = policyIndex.get(page.id);
    const assignmentMode = policy?.assignmentMode ?? page.assignmentMode ?? "all_agents";
    const pageAssignments = assignmentsByPageId.get(page.id) ?? [];
    const assignedAgents = pageAssignments.flatMap((assignment) => {
      const agent = agentByEmployeeName.get(assignment.employeeName);
      if (!agent) {
        return [];
      }
      return [{
        ...agent,
        assignedAt: assignment.createdAt,
        assignedBy: assignment.createdBy,
      } satisfies KnowledgeAssignedAgentRecord];
    });
    const effectiveAgentCount = assignmentMode === "all_agents" ? agentOptions.length : assignedAgents.length;

    return {
      ...page,
      assignmentMode,
      assignmentUpdatedAt: policy?.updatedAt ?? page.assignmentUpdatedAt,
      assignmentUpdatedBy: policy?.updatedBy ?? page.assignmentUpdatedBy,
      assignedAgents,
      assignedAgentIds: assignedAgents.map((agent) => agent.id),
      assignedEmployeeNames: assignedAgents.map((agent) => agent.employeeName),
      assignedAgentCount: assignedAgents.length,
      effectiveAgentCount,
      assignmentSummary:
        assignmentMode === "all_agents"
          ? `${effectiveAgentCount} agents`
          : assignedAgents.length > 0
            ? assignedAgents.map((agent) => agent.name).join(", ")
            : "No agents assigned",
    };
  });
}

function buildKnowledgeAssignmentStats(
  records: KnowledgePageRecord[],
  sourcePages: KnowledgePage[],
): KnowledgeAssignmentStats {
  return {
    allAgentsPageCount: records.filter((page) => page.assignmentMode === "all_agents").length,
    selectedAgentsPageCount: records.filter((page) => page.assignmentMode === "selected_agents").length,
    unconfiguredPageCount: sourcePages.filter((page) => !page.assignmentMode).length,
  };
}

function buildWorkspaceAgentKnowledgeRecord(
  employee: ActiveEmployee,
  pages: KnowledgePage[],
  policyIndex: Map<string, ReturnType<typeof listKnowledgeAssignmentPoliciesSync>[number]>,
  assignments: ReturnType<typeof listKnowledgeAssignmentsSync>,
): WorkspaceAgentKnowledgeRecord {
  const directPageIds = assignments
    .filter((assignment) => assignment.employeeName === employee.name)
    .map((assignment) => assignment.knowledgePageId);
  const directPageIdSet = new Set(directPageIds);
  const inheritedPages: AgentKnowledgePageRecord[] = [];
  const directPages: AgentKnowledgePageRecord[] = [];
  const assignablePages: AgentKnowledgePageRecord[] = [];

  for (const page of pages) {
    const assignmentMode = policyIndex.get(page.id)?.assignmentMode ?? page.assignmentMode ?? "all_agents";
    const record = buildAgentKnowledgePageRecord(page, assignmentMode);
    if (assignmentMode === "all_agents") {
      inheritedPages.push(record);
      continue;
    }
    if (directPageIdSet.has(page.id)) {
      directPages.push(record);
      continue;
    }
    assignablePages.push(record);
  }

  return {
    directPageIds,
    inheritedPages: limitLoadtestDashboardPayload(inheritedPages, AGENT_KNOWLEDGE_PREVIEW_LIMIT),
    directPages: limitLoadtestDashboardPayload(directPages, AGENT_KNOWLEDGE_PREVIEW_LIMIT),
    assignablePages: limitLoadtestDashboardPayload(assignablePages, AGENT_ASSIGNABLE_KNOWLEDGE_LIMIT),
    totalAvailableCount: inheritedPages.length + directPages.length,
    directCount: directPages.length,
    inheritedCount: inheritedPages.length,
  };
}

function buildAgentKnowledgePageRecord(
  page: KnowledgePage,
  assignmentMode: KnowledgeAssignmentMode,
): AgentKnowledgePageRecord {
  return {
    id: page.id,
    title: page.title,
    tags: page.tags,
    updatedAt: page.updatedAt,
    assignmentMode,
    sourceLabel: page.sourceChannelDocumentId
      ? "Shared document"
      : page.sourceAttachmentId
        ? "Shared attachment"
        : undefined,
  };
}

// ── Performance ──

export function getPerformancePageData(workspaceId = DEFAULT_WORKSPACE_ID): PerformanceDashboardData {
  return getPerformanceDashboardDataCached(workspaceId);
}

// ── Data Tables (#25) ──

export interface DataTablesPageData {
  tables: DataTable[];
  totalCount: number;
  activeCount: number;
  channels: Array<{ name: string }>;
  agents: Array<{ id: string; name: string }>;
}

export function getDataTablesPageData(workspaceId = DEFAULT_WORKSPACE_ID): DataTablesPageData {
  const state = readWorkspaceStateCached(workspaceId);
  const tables = state.dataTables ?? [];

  return {
    tables,
    totalCount: tables.length,
    activeCount: tables.filter((t) => t.status === "active").length,
    channels: state.channels.map((ch) => ({ name: ch.name })),
    agents: state.activeEmployees.map((e) => ({
      id: e.name,
      name: e.remarkName?.trim() || e.name,
    })),
  };
}

// ── Automations (#27) ──

export interface AutomationsPageData {
  rules: AutomationRule[];
  documentRuns: ChannelDocumentRunRecord[];
  autoContinuationRuns: AutoContinuationRunRecord[];
  totalCount: number;
  enabledCount: number;
  documentRunCount: number;
  autoContinuationRunCount: number;
  channels: Array<{ name: string }>;
  agents: Array<{ id: string; name: string }>;
}

export interface AutoContinuationRunRecord {
  id: string;
  channelName: string;
  agentId: string;
  contactId?: string;
  status: "active" | "expired" | "stopped";
  startedAt: string;
  until: string;
  instruction: string;
  iteration: number;
  lastContinuedAt?: string;
  updatedAt: string;
  lastTaskQueueId?: string;
  lastTaskStatus?: string;
}

export function getAutomationsPageData(workspaceId = DEFAULT_WORKSPACE_ID): AutomationsPageData {
  const state = readWorkspaceStateCached(workspaceId);
  const queuedTaskById = new Map(listQueuedTasksCached(workspaceId).map((task) => [task.id, task]));
  const rules = state.automationRules ?? [];
  const documentRuns = (state.channelDocumentRuns ?? [])
    .slice()
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .map((run) => ({
      id: run.id,
      channelName: run.channelName,
      sourceMessageId: run.sourceMessageId,
      sourceSummary: run.sourceSummary,
      mode: run.mode,
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      steps: (state.channelDocumentRunSteps ?? [])
        .filter((step) => step.runId === run.id)
        .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
        .map((step) => ({
          id: step.id,
          agentId: step.agentId,
          agentLabel: step.agentLabel,
          instruction: step.instruction,
          status: step.status,
          handoffKind: step.handoffKind,
          documentId: step.documentId,
          documentVersionId: step.documentVersionId,
          lastError: step.lastError,
          lastWarning: step.lastWarning,
        })),
    }) satisfies ChannelDocumentRunRecord);
  const autoContinuationRuns = (state.conversationExecutionWorkspaces ?? [])
    .filter((workspace) => Boolean(workspace.autoContinuation))
    .slice()
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .map((workspace) => ({
      id: `${workspace.channelName}:${workspace.agentId}:${workspace.contactId ?? ""}:${workspace.autoContinuation!.startedAt}`,
      channelName: workspace.channelName,
      agentId: workspace.agentId,
      contactId: workspace.contactId,
      status: workspace.autoContinuation!.status,
      startedAt: workspace.autoContinuation!.startedAt,
      until: workspace.autoContinuation!.until,
      instruction: workspace.autoContinuation!.instruction,
      iteration: workspace.autoContinuation!.iteration,
      lastContinuedAt: workspace.autoContinuation!.lastContinuedAt,
      updatedAt: workspace.updatedAt,
      lastTaskQueueId: workspace.lastTaskQueueId,
      lastTaskStatus: workspace.lastTaskQueueId ? queuedTaskById.get(workspace.lastTaskQueueId)?.status : undefined,
    }) satisfies AutoContinuationRunRecord);

  return {
    rules,
    documentRuns,
    autoContinuationRuns,
    totalCount: rules.length + 2,
    enabledCount: rules.filter((r) => r.enabled).length + 2,
    documentRunCount: documentRuns.length,
    autoContinuationRunCount: autoContinuationRuns.length,
    channels: state.channels.map((ch) => ({ name: ch.name })),
    agents: state.activeEmployees.map((e) => ({
      id: e.name,
      name: e.remarkName?.trim() || e.name,
    })),
  };
}

// ── Calendar / Schedules (#28) ──

export interface CalendarPageData {
  scheduledTasks: ScheduledTask[];
  totalCount: number;
  activeCount: number;
  channels: Array<{ name: string }>;
  agents: Array<{ id: string; name: string }>;
}

export function getCalendarPageData(workspaceId = DEFAULT_WORKSPACE_ID): CalendarPageData {
  const state = readWorkspaceStateCached(workspaceId);
  const scheduledTasks = state.scheduledTasks ?? [];

  return {
    scheduledTasks,
    totalCount: scheduledTasks.length,
    activeCount: scheduledTasks.filter((t) => t.status === "active").length,
    channels: state.channels.map((ch) => ({ name: ch.name })),
    agents: state.activeEmployees.map((e) => ({
      id: e.name,
      name: e.remarkName?.trim() || e.name,
    })),
  };
}

// ── Templates (#29) ──

export interface TemplatesPageData {
  templates: Template[];
  totalCount: number;
  builtInCount: number;
  customCount: number;
}

export function getTemplatesPageData(workspaceId = DEFAULT_WORKSPACE_ID): TemplatesPageData {
  const state = readWorkspaceStateCached(workspaceId);
  const templates = state.templates ?? [];

  return {
    templates,
    totalCount: templates.length,
    builtInCount: templates.filter((t) => t.builtIn).length,
    customCount: templates.filter((t) => !t.builtIn).length,
  };
}
