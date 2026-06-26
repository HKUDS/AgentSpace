export type WorkspaceMode = "im" | "market";
export type {
  AgentAssignableDocumentAccessRole,
  AgentDocumentContext,
  ChannelDocumentAccessRole,
  DocumentAccessRole,
  DocumentAction,
} from "./channel-document-collab.ts";
import type { ChannelDocumentRun, ChannelDocumentRunStep } from "./channel-document-runs.ts";
import type {
  ChannelDocumentAccess,
  ChannelDocumentBlock,
  ChannelDocumentChangeSet,
  ChannelDocumentConflict,
  ChannelDocumentPresence,
} from "./channel-document-collab.ts";
import type {
  CollaborationActivity,
  CollaborationChangeProposal,
  CollaborationComment,
  CollaborationCommentThread,
} from "./collaboration.ts";

export interface WorkspaceStat {
  label: string;
  value: string;
}

export interface NavItem {
  href: string;
  label: string;
  note: string;
}

export interface Channel {
  name: string;
  members: string;
}

export type ChannelKind = "group" | "direct";

export interface MaterialInput {
  id?: string;
  source: string;
  status: string;
  kind?: "note" | "file";
  originalPath?: string;
  storedPath?: string;
  sizeBytes?: number;
  preview?: string;
}

export interface MessageAttachment {
  id: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  kind: "image" | "file";
  storedPath: string;
  storageProvider?: "local" | "r2" | "s3";
  storageBucket?: string;
  storageRegion?: string;
  storageEndpoint?: string;
  storageKey?: string;
  storageUrl?: string;
  sha256?: string;
  deletedAt?: string;
  deletedByUserId?: string;
  deletedByDisplayName?: string;
}

export type MessageMention =
  | {
      agentId: string;
      label: string;
      token: string;
      mentionType: "agent";
      inChannel: boolean;
    }
  | {
      humanId: string;
      label: string;
      token: string;
      mentionType: "human";
      inChannel: boolean;
    };

export interface MessageAcknowledgement {
  userId?: string;
  label: string;
  acknowledgedAt: string;
}

export interface WorkspaceMessage {
  id: string;
  channel?: string;
  speaker: string;
  speakerUserId?: string;
  role: "human" | "agent";
  time: string;
  summary: string;
  code?: string;
  data?: Record<string, string>;
  status?: "pending" | "completed" | "error";
  kind?: "message" | "process";
  processType?: string;
  tool?: string;
  attachments?: MessageAttachment[];
  mentions?: MessageMention[];
  acknowledgements?: MessageAcknowledgement[];
  pinned?: boolean;
  pinnedAt?: string;
  replyToMessageId?: string;
}

export interface LedgerItem {
  title: string;
  note: string;
  code?: string;
  data?: Record<string, string>;
}

export interface WorkspaceSkillFile {
  id: string;
  path: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSkill {
  id: string;
  name: string;
  description: string;
  files: WorkspaceSkillFile[];
  sourceType?: string;
  sourceUrl?: string;
  configJson?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveEmployee {
  name: string;
  role: string;
  remarkName?: string;
  ownerUserId?: string;
  channelMemberAccess?: AgentChannelMemberAccess;
  origin: string;
  summary: string;
  traits: string[];
  fit: string;
  /**
   * @deprecated Compatibility snapshot only. Read current agent-skill assignments
   * from dedicated `agent_skill` storage via services instead of treating this
   * field as source of truth.
   */
  skillIds: string[];
  channels: string[];
  status: "active";
  instructions?: string;
}

export type AgentChannelMemberAccess = "enabled" | "disabled";

export interface HumanMember {
  name: string;
  role: string;
}

export interface ChannelRecord {
  name: string;
  kind?: ChannelKind;
  humanMemberNames?: string[];
  humanMembers: number;
  employeeNames: string[];
}

export type ChannelDocumentKind = "markdown" | "sheet" | "deck" | "document";
export type ChannelDocumentStorageMode = "native" | "external";
export type ChannelDocumentExternalProvider = "google_workspace" | "feishu" | "notion" | "microsoft_365";
export type ExternalDocumentProvider = ChannelDocumentExternalProvider;
export type ChannelDocumentJsonContent = Record<string, unknown> | unknown[];
export type ExternalDocumentSyncStatus = "ok" | "permission_error" | "missing" | "unknown";
export type ChannelDocumentStatus = "active" | "archived";
export type ChannelDocumentEditorType = "human" | "agent";
export type ChannelDocumentTriggerType = "manual" | "agent" | "handoff";

export interface ChannelDocument {
  id: string;
  channelName: string;
  title: string;
  slug: string;
  kind: ChannelDocumentKind;
  storageMode: ChannelDocumentStorageMode;
  linkedTableId?: string;
  externalProvider?: ChannelDocumentExternalProvider;
  externalFileId?: string;
  externalUrl?: string;
  externalRevisionId?: string;
  status: ChannelDocumentStatus;
  currentVersionId: string;
  summary: string;
  externalSyncStatus?: ExternalDocumentSyncStatus;
  externalMimeType?: string;
  externalUpdatedAt?: string;
  lastEditorType: ChannelDocumentEditorType;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelDocumentVersion {
  id: string;
  documentId: string;
  contentMarkdown: string;
  contentJson?: ChannelDocumentJsonContent;
  summary: string;
  createdBy: string;
  createdByType: ChannelDocumentEditorType;
  triggerType: ChannelDocumentTriggerType;
  sourceMessageId?: string;
  sourceAttachmentId?: string;
  sourceAttachmentStoredPath?: string;
  sourceTaskQueueId?: string;
  createdAt: string;
}

export type ExternalSheetOperationRunStatus = "queued" | "running" | "succeeded" | "failed";
export type ExternalSheetOperationType =
  | "create"
  | "read"
  | "append_text"
  | "append_rows"
  | "update_values"
  | "batch_update"
  | "share"
  | "metadata_refresh";

export interface ExternalSheetResultPreview {
  rowCount?: number;
  cellCount?: number;
  headers?: string[];
  rowsPreview?: unknown[][];
  truncated?: boolean;
}

export interface ExternalSheetOperationRun {
  id: string;
  workspaceId: string;
  channelDocumentId: string;
  provider: "google_workspace";
  externalFileId: string;
  actorType: "agent" | "human" | "system";
  actorId: string;
  delegatedUserId?: string;
  delegatedUserDisplayName?: string;
  delegatedGoogleEmail?: string;
  credentialDelegationId?: string;
  status: ExternalSheetOperationRunStatus;
  intent: string;
  operationType: ExternalSheetOperationType;
  rangeA1?: string;
  affectedRows?: number;
  affectedCells?: number;
  requestSummary: string;
  responseSummary?: string;
  resultArtifactPath?: string;
  resultArtifactFileName?: string;
  resultArtifactMediaType?: string;
  resultArtifactSizeBytes?: number;
  resultPreview?: ExternalSheetResultPreview;
  errorCode?: string;
  errorMessage?: string;
  startedAt: string;
  finishedAt?: string;
}

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";

export interface TaskRecord {
  id: string;
  title: string;
  channel: string;
  assignee: string;
  priority: "low" | "medium" | "high";
  status: TaskStatus;
  sortOrder?: number;
  labels?: string[];
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "revised";

export interface ApprovalRequest {
  id: string;
  type: "task_output" | "document_update" | "message_draft" | "runtime_tool" | "knowledge_proposal" | "external_data_operation";
  sourceId: string;
  agentId: string;
  channelName: string;
  status: ApprovalStatus;
  contentPreview: string;
  metadata?: Record<string, unknown>;
  reviewerComment?: string;
  createdAt: string;
  reviewedAt?: string;
}

export interface DirectConversationState {
  contactId: string;
  humanMemberName?: string;
  updatedAt: string;
  sessionId?: string;
  workDir?: string;
}

export interface ConversationExecutionWorkspaceState {
  conversationKey: string;
  conversationKind: "direct" | "group";
  channelName: string;
  agentId: string;
  contactId?: string;
  humanMemberName?: string;
  updatedAt: string;
  lastTaskQueueId?: string;
  sessionId?: string;
  workDir?: string;
  lastError?: string;
  autoContinuation?: ConversationAutoContinuationState;
}

export interface ConversationAutoContinuationState {
  mode: "until";
  status: "active" | "expired" | "stopped";
  startedAt: string;
  until: string;
  instruction: string;
  requestedByUserId?: string;
  requestedByDisplayName?: string;
  sourceMessageId?: string;
  iteration: number;
  lastContinuedAt?: string;
}

export type KnowledgeAssignmentMode = "all_agents" | "selected_agents";

export interface KnowledgePage {
  id: string;
  parentId: string | null;
  title: string;
  contentMarkdown: string;
  sortOrder: number;
  tags: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  assignmentMode?: KnowledgeAssignmentMode;
  assignmentUpdatedAt?: string;
  assignmentUpdatedBy?: string;
  sourceAttachmentId?: string;
  sourceAttachmentStoredPath?: string;
  sourceChannelDocumentId?: string;
  sourceKnowledgeProposalId?: string;
  sourceApprovalId?: string;
  sourceTaskQueueId?: string;
  sourceAgentName?: string;
}

// ── Structured Tables (#25) ──

export type DataColumnType = "text" | "number" | "select" | "date" | "person" | "checkbox";
export type DataTableStatus = "active" | "archived";
export type DataTableExternalProvider = "feishu" | "google_workspace";

export interface DataTableExternalPreview {
  kind?: string;
  rowCount?: number;
  columnCount?: number;
  rowsPreview?: unknown[][];
  recordCount?: number;
  fieldNames?: string[];
  recordsPreview?: Array<{
    recordId?: string;
    fieldsPreview: Record<string, unknown>;
  }>;
  truncated?: boolean;
  updatedAt?: string;
}

export interface DataColumn {
  id: string;
  name: string;
  type: DataColumnType;
  options?: string[];
  required?: boolean;
}

export interface DataRow {
  id: string;
  cells: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DataTable {
  id: string;
  name: string;
  channelName?: string;
  columns: DataColumn[];
  rows: DataRow[];
  externalProvider?: DataTableExternalProvider;
  externalResourceType?: string;
  externalResourceToken?: string;
  externalUrl?: string;
  externalSyncStatus?: ExternalDocumentSyncStatus;
  externalUpdatedAt?: string;
  externalMetadata?: Record<string, unknown>;
  externalPreview?: DataTableExternalPreview;
  status: DataTableStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ── Automation Workflows (#27) ──

export type AutomationTriggerType = "message_received" | "task_completed" | "document_updated" | "schedule";
export type AutomationConditionOperator = "equals" | "contains" | "matches";
export type AutomationActionType = "send_message" | "create_task" | "mention_agent" | "update_table" | "webhook";
export type AutomationStatus = "active" | "paused";

export interface AutomationTrigger {
  type: AutomationTriggerType;
  config: Record<string, unknown>;
}

export interface AutomationCondition {
  field: string;
  operator: AutomationConditionOperator;
  value: string;
}

export interface AutomationAction {
  type: AutomationActionType;
  config: Record<string, unknown>;
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  lastTriggeredAt?: string;
  runCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ── Calendar / Scheduled Tasks (#28) ──

export type ScheduledTaskRepeat = "once" | "daily" | "weekly" | "monthly" | "cron";
export type ScheduledTaskStatus = "active" | "paused" | "completed";

export interface ScheduledTask {
  id: string;
  title: string;
  description: string;
  assignee?: string;
  channelName?: string;
  repeat: ScheduledTaskRepeat;
  cronExpression?: string;
  scheduledAt: string;
  nextRunAt?: string;
  lastRunAt?: string;
  status: ScheduledTaskStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ── Templates (#29) ──

export type TemplateCategory = "channel" | "task" | "skill" | "workflow";

export interface Template {
  id: string;
  category: TemplateCategory;
  name: string;
  description: string;
  configJson: string;
  builtIn: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSpaceState {
  organizationName: string;
  pendingHandoffs: number;
  humanMembers: HumanMember[];
  /**
   * @deprecated Compatibility snapshot only. Read current workspace skills from
   * dedicated `skill` / `skill_file` storage via services instead of treating
   * this field as source of truth.
   */
  skills: WorkspaceSkill[];
  activeEmployees: ActiveEmployee[];
  directConversations: DirectConversationState[];
  conversationExecutionWorkspaces?: ConversationExecutionWorkspaceState[];
  channels: ChannelRecord[];
  channelDocuments: ChannelDocument[];
  channelDocumentVersions: ChannelDocumentVersion[];
  channelDocumentBlocks: ChannelDocumentBlock[];
  channelDocumentAccesses: ChannelDocumentAccess[];
  channelDocumentChangeSets: ChannelDocumentChangeSet[];
  channelDocumentConflicts: ChannelDocumentConflict[];
  channelDocumentPresences: ChannelDocumentPresence[];
  channelDocumentRuns: ChannelDocumentRun[];
  channelDocumentRunSteps: ChannelDocumentRunStep[];
  externalSheetOperationRuns: ExternalSheetOperationRun[];
  collaborationCommentThreads: CollaborationCommentThread[];
  collaborationComments: CollaborationComment[];
  collaborationActivities: CollaborationActivity[];
  collaborationChangeProposals: CollaborationChangeProposal[];
  materials: MaterialInput[];
  knowledgePages: KnowledgePage[];
  messages: WorkspaceMessage[];
  tasks: TaskRecord[];
  approvals: ApprovalRequest[];
  dataTables: DataTable[];
  automationRules: AutomationRule[];
  scheduledTasks: ScheduledTask[];
  templates: Template[];
  ledger: LedgerItem[];
}

export type WorkspaceEventType =
  | "workspace.initialized"
  | "channel.created"
  | "material.added"
  | "material.imported"
  | "material.parsed"
  | "candidate.generated"
  | "candidate.updated"
  | "message.posted"
  | "employee.recruited"
  | "candidate.created"
  | "employee.created"
  | "task.created"
  | "task.updated"
  | "approval.created"
  | "approval.reviewed"
  | "workspace.reset";

export type WorkspaceEventSource = "cli" | "web" | "system";

export interface WorkspaceEvent {
  revision: number;
  type: WorkspaceEventType;
  source: WorkspaceEventSource;
  summary: string;
  occurredAt: string;
}

export interface WorkspaceSyncState {
  revision: number;
  updatedAt: string;
  lastEvent: WorkspaceEvent | null;
}

export interface WorkspaceSnapshot {
  navItems: NavItem[];
  stats: WorkspaceStat[];
  channels: Channel[];
  skills: WorkspaceSkill[];
  channelDocuments: ChannelDocument[];
  channelDocumentVersions: ChannelDocumentVersion[];
  channelDocumentBlocks: ChannelDocumentBlock[];
  channelDocumentAccesses: ChannelDocumentAccess[];
  channelDocumentChangeSets: ChannelDocumentChangeSet[];
  channelDocumentConflicts: ChannelDocumentConflict[];
  channelDocumentPresences: ChannelDocumentPresence[];
  channelDocumentRuns: ChannelDocumentRun[];
  channelDocumentRunSteps: ChannelDocumentRunStep[];
  externalSheetOperationRuns: ExternalSheetOperationRun[];
  collaborationCommentThreads: CollaborationCommentThread[];
  collaborationComments: CollaborationComment[];
  collaborationActivities: CollaborationActivity[];
  collaborationChangeProposals: CollaborationChangeProposal[];
  materials: MaterialInput[];
  knowledgePages: KnowledgePage[];
  messages: WorkspaceMessage[];
  activeEmployees: ActiveEmployee[];
  tasks: TaskRecord[];
  approvals: ApprovalRequest[];
  dataTables: DataTable[];
  automationRules: AutomationRule[];
  scheduledTasks: ScheduledTask[];
  templates: Template[];
  ledger: LedgerItem[];
}

export const navItems: NavItem[] = [
  { href: "/im", label: "Channels", note: "Team conversation" },
  { href: "/contacts", label: "Contacts", note: "Direct messages" },
  { href: "/market", label: "Market", note: "In development" },
];

const defaultActiveEmployees: ActiveEmployee[] = [];

export const defaultWorkspaceState: AgentSpaceState = {
  organizationName: "AgentSpace",
  pendingHandoffs: 0,
  humanMembers: [],
  skills: [],
  activeEmployees: defaultActiveEmployees,
  directConversations: [],
  conversationExecutionWorkspaces: [],
  channels: [],
  channelDocuments: [],
  channelDocumentVersions: [],
  channelDocumentBlocks: [],
  channelDocumentAccesses: [],
  channelDocumentChangeSets: [],
  channelDocumentConflicts: [],
  channelDocumentPresences: [],
  channelDocumentRuns: [],
  channelDocumentRunSteps: [],
  externalSheetOperationRuns: [],
  collaborationCommentThreads: [],
  collaborationComments: [],
  collaborationActivities: [],
  collaborationChangeProposals: [],
  materials: [],
  knowledgePages: [],
  messages: [],
  tasks: [],
  approvals: [],
  dataTables: [],
  automationRules: [],
  scheduledTasks: [],
  templates: [],
  ledger: [],
};

export function createDefaultWorkspaceState(): AgentSpaceState {
  return structuredClone(defaultWorkspaceState);
}

export function createWorkspaceSnapshot(state: AgentSpaceState): WorkspaceSnapshot {
  return {
    navItems,
    stats: [
      { label: "Active Agents", value: formatCount(state.activeEmployees.length) },
      { label: "Open Handoffs", value: formatCount(state.pendingHandoffs) },
      { label: "Human Members", value: formatCount(state.humanMembers.length) },
    ],
    channels: state.channels.map((channel) => ({
      name: channel.name,
      members: `${channel.humanMembers} humans / ${channel.employeeNames.length} agents`,
    })),
    skills: state.skills,
    channelDocuments: state.channelDocuments,
    channelDocumentVersions: state.channelDocumentVersions,
    channelDocumentBlocks: state.channelDocumentBlocks,
    channelDocumentAccesses: state.channelDocumentAccesses,
    channelDocumentChangeSets: state.channelDocumentChangeSets,
    channelDocumentConflicts: state.channelDocumentConflicts,
    channelDocumentPresences: state.channelDocumentPresences,
    channelDocumentRuns: state.channelDocumentRuns,
    channelDocumentRunSteps: state.channelDocumentRunSteps,
    externalSheetOperationRuns: state.externalSheetOperationRuns,
    collaborationCommentThreads: state.collaborationCommentThreads,
    collaborationComments: state.collaborationComments,
    collaborationActivities: state.collaborationActivities,
    collaborationChangeProposals: state.collaborationChangeProposals,
    materials: state.materials,
    knowledgePages: state.knowledgePages,
    messages: state.messages,
    activeEmployees: state.activeEmployees,
    tasks: state.tasks,
    approvals: state.approvals,
    dataTables: state.dataTables,
    automationRules: state.automationRules,
    scheduledTasks: state.scheduledTasks,
    templates: state.templates,
    ledger: state.ledger,
  };
}

export const workspaceSnapshot: WorkspaceSnapshot = createWorkspaceSnapshot(createDefaultWorkspaceState());

function formatCount(value: number): string {
  return String(value).padStart(2, "0");
}
