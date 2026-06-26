// Types
export type {
  StoredSkillRecord,
  StoredSkillFileRecord,
  StoredAgentSkillRecord,
  StoredKnowledgeAssignmentPolicyRecord,
  StoredAgentKnowledgePageRecord,
  StoredSkillImportEventRecord,
  ChannelAccessRequestStatus,
  ChannelInvitationStatus,
  ChannelParticipantStatus,
  StoredChannelAccessRequestRecord,
  StoredChannelInvitationRecord,
  StoredChannelParticipantRecord,
  DaemonApiTokenRecord,
  DaemonConnectionRecord,
  AgentRuntimeRecord,
  RuntimeRegistrationInput,
  RegisteredDaemonSnapshot,
  EmployeeRuntimeBindingRecord,
  WorkspaceRuntimeGrantPermission,
  WorkspaceRuntimeGrantRecord,
  WorkspaceRuntimeGrantStatus,
  AgentRouterSessionRecord,
  AgentRouterSessionStatus,
  AgentRouterProviderSessionRecord,
  AgentRouterProviderSessionStatus,
  AgentRouterEventRecord,
  AgentRouterActorType,
  AgentRouterContextSnapshotRecord,
  AgentRouterContextSnapshotType,
  AgentTaskAttemptRecord,
  AgentTaskAttemptStatus,
  DocumentAgentAccessRecord,
  DocumentAgentAccessRole,
  DocumentAgentAccessSubjectType,
  DocumentPermissionRequestExternalProvider,
  DocumentPermissionRequestRecord,
  DocumentPermissionRequestStatus,
  AgentAccessRequestRecord,
  AgentAccessRequestStatus,
  AgentAccessRequestType,
  KnowledgeProposalOperation,
  KnowledgeProposalRecord,
  KnowledgeProposalStatus,
  ResetKnowledgeProposalsResult,
  WorkspaceNotificationActorType,
  WorkspaceNotificationRecord,
  WorkspaceNotificationRecipientType,
  WorkspaceNotificationResourceType,
  WorkspaceNotificationSeverity,
  WorkspaceNotificationStatus,
  AgentForkInvitationStatus,
  StoredAgentForkInvitationRecord,
  StoredAgentForkSnapshotRecord,
  RuntimeAppCatalogItemRecord,
  RuntimeAppCatalogSource,
  RuntimeAppInstallStrategy,
  RuntimeAppOperationRecord,
  RuntimeAppOperationStatus,
  RuntimeAppOperationType,
  RuntimeAppRiskLevel,
  RuntimeAppSkillBindingRecord,
  RuntimeInstalledAppRecord,
  RuntimeInstalledAppStatus,
  NativeTaskStatus,
  QueuedTaskRecord,
  TaskMessageRecord,
  TaskExecutionEventRecord,
  TaskExecutionEventType,
  TaskExecutionEventSeverity,
  TaskExecutionEventStatus,
  EnqueueTaskInput,
  ModelPricingRecord,
  TokenUsageRecord,
  BudgetScope,
  BudgetPeriod,
  BudgetAction,
  BudgetRecord,
  // New multi-tenant types
  StoredWorkspaceRecord,
  StoredWorkspaceMembershipRecord,
  StoredWorkspaceInvitationRecord,
  WorkspaceInvitationStatus,
  WorkspaceRole,
  StoredUserRecord,
  StoredAuthIdentityRecord,
  StoredSessionRecord,
  AuthProvider,
  GoogleOAuthCredentialStatus,
  StoredGoogleOAuthCredentialRecord,
  AgentGoogleWorkspaceDelegationStatus,
  StoredAgentGoogleWorkspaceDelegationRecord,
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
} from "./types.ts";

// Database
export {
  getDataDirPath,
  getWorkspaceDataDirPath,
  getDatabaseConnectionLabel,
} from "./database.ts";
export {
  findRepositoryRoot,
  loadRepositoryEnvIntoProcess,
  parseDotEnv,
  readEffectiveRuntimeEnv,
  readRepositoryEnvValue,
  readRepositoryEnvValues,
  resolveRepositoryEnvFilePath,
  resolveRepositoryRoot,
} from "./repository-env.ts";
export {
  getDatabase,
  withTransaction,
  countRows,
  readMetadataValue,
  randomLikeId,
  DEFAULT_WORKSPACE_ID,
} from "./database.ts";
export {
  getDaemonChannelWorkDirPath,
  getDaemonRemoteTaskWorkDirPath,
  getDaemonTaskWorkDirPath,
  getDaemonWorkspaceExecutionRootDir,
  getLocalDaemonStateDirPath,
  getSystemWorkspaceDataDirPath,
  getWorkspaceAttachmentsDirPath,
  getWorkspaceChannelHistoryDirPath,
  getWorkspaceDaemonRemoteStagingDirPath,
  sanitizeStoragePathSegment,
  SYSTEM_WORKSPACE_ID,
} from "./storage-paths.ts";
export {
  readStoredAttachmentSync,
  replaceStoredAttachmentsSync,
  type StoredAttachmentRecord,
} from "./attachments.ts";

// Auth
export {
  createAuthIdentitySync,
  countActiveSessionsForUserSync,
  countWorkspaceMembersSync,
  countUsersSync,
  createPasswordAuthIdentitySync,
  createSessionSync,
  createUserSync,
  deleteSessionByTokenHashSync,
  listSessionsForUserSync,
  listWorkspaceMemberUsersSync,
  readAuthIdentityByProviderSubjectSync,
  readPasswordAuthIdentityByEmailSync,
  readSessionByTokenHashSync,
  readUserByEmailSync,
  readUserSync,
  revokeOtherSessionsForUserSync,
  revokeSessionByIdSync,
  touchSessionLastSeenSync,
  updateUserSync,
  type PasswordAuthIdentityRecord,
  type WorkspaceMemberUserRecord,
} from "./user-auth.ts";

export {
  listAgentGoogleWorkspaceDelegationsSync,
  readActiveAgentGoogleWorkspaceDelegationSync,
  readAgentGoogleWorkspaceDelegationSync,
  revokeAgentGoogleWorkspaceDelegationSync,
  upsertAgentGoogleWorkspaceDelegationSync,
} from "./agent-google-workspace-delegations.ts";

export {
  listGoogleOAuthCredentialsSync,
  readActiveGoogleOAuthCredentialSync,
  readGoogleOAuthCredentialSync,
  revokeGoogleOAuthCredentialSync,
  upsertGoogleOAuthCredentialSync,
} from "./google-oauth-credentials.ts";

export {
  cancelExternalMessageOutboxForIntegrationSync,
  completeExternalMessageOutboxSync,
  createExternalDataOperationRunSync,
  createExternalIntegrationSync,
  createExternalMessageMappingSync,
  createExternalMessageOutboxSync,
  deleteExternalIntegrationSync,
  failExternalMessageOutboxSync,
  listExternalChannelBindingsSync,
  listExternalDataOperationRunsSync,
  listExternalIntegrationEventsSync,
  listExternalIntegrationsSync,
  listExternalMessageMappingsSync,
  listExternalMessageOutboxSync,
  listExternalResourceBindingsSync,
  listExternalUserBindingsSync,
  listPendingExternalMessageOutboxSync,
  markExternalMessageOutboxLockedSync,
  readExternalChannelBindingByExternalChatSync,
  readExternalChannelBindingSync,
  readExternalDataOperationRunSync,
  readExternalIntegrationEventSync,
  readExternalIntegrationSync,
  readExternalMessageMappingByAgentSpaceMessageSync,
  readExternalMessageMappingByExternalMessageSync,
  readExternalMessageOutboxSync,
  readExternalResourceBindingByKeySync,
  readExternalUserBindingByIdSync,
  readExternalUserBindingByExternalUserSync,
  readExternalUserBindingSync,
  recordExternalIntegrationEventSync,
  updateExternalDataOperationRunStatusSync,
  updateExternalChannelBindingStatusSync,
  updateExternalIntegrationCredentialsSync,
  updateExternalIntegrationEventStatusSync,
  updateExternalIntegrationHealthSync,
  updateExternalIntegrationStatusSync,
  updateExternalResourceBindingStatusSync,
  updateExternalUserBindingStatusSync,
  upsertExternalChannelBindingSync,
  upsertExternalResourceBindingSync,
  upsertExternalUserBindingSync,
} from "./integrations/external-integrations.ts";

// Workspace state
export {
  ensureWorkspaceStateRecordSync,
  readWorkspaceStateRecordSync,
  writeWorkspaceStateRecordSync,
  getDatabaseStatusSync,
  resetWorkspaceExecutionStateSync,
  WORKSPACE_STATE_VERSION,
  readWorkspaceStateVersion,
  readWorkspaceStateCurrentVersionSync,
  WorkspaceStateConflictError,
} from "./workspace-state.ts";

// Daemons
export {
  registerDaemonRuntimesSync,
  heartbeatDaemonSync,
  markDaemonOfflineSync,
  readDaemonConnectionSync,
  readAgentRuntimeSync,
  deleteAgentRuntimeSync,
  readDaemonSnapshotSync,
  listDaemonSnapshotsSync,
  pruneOfflineDaemonsSync,
} from "./daemons.ts";

// Runtime display names
export {
  listWorkspaceRuntimeDisplayNamesSync,
  updateWorkspaceRuntimeDisplayNameSync,
} from "./runtime-display-names.ts";

// Daemon tokens
export {
  createDaemonApiTokenSync,
  listDaemonApiTokensSync,
  readDaemonApiTokenSync,
  revokeDaemonApiTokenSync,
  validateDaemonApiTokenSync,
} from "./daemon-tokens.ts";

// Employee bindings
export {
  bindEmployeeRuntimeSync,
  unbindEmployeeRuntimeSync,
  deleteEmployeeExecutionStateSync,
  readEmployeeRuntimeBindingSync,
  listEmployeeRuntimeBindingsSync,
} from "./employee-bindings.ts";

// Agent fork invitations
export {
  acceptAgentForkInvitationSync,
  createAgentForkInvitationSync,
  listAgentForkInvitationsSync,
  readAgentForkInvitationSync,
  readAgentForkSnapshotByInvitationSync,
  revokeAgentForkInvitationSync,
  type CreateAgentForkInvitationRecordInput,
  type ListAgentForkInvitationsOptions,
} from "./agent-fork-invitations.ts";

// Agent access requests
export {
  approveAgentAccessRequestSync,
  cancelAgentAccessRequestSync,
  createAgentAccessRequestSync,
  listAgentAccessRequestsSync,
  readAgentAccessRequestSync,
  rejectAgentAccessRequestSync,
  type CreateAgentAccessRequestInput,
  type CreateAgentAccessRequestResult,
  type ListAgentAccessRequestsOptions,
} from "./agent-access-requests.ts";

// Agent router sessions
export {
  chooseProviderSessionForTaskSync,
  createAgentRouterContextSnapshotSync,
  createAgentTaskAttemptSync,
  findActiveProviderSessionForRouterSync,
  listAgentRouterEventsSync,
  listAgentRouterProviderSessionsSync,
  listAgentRouterSessionsSync,
  listAgentTaskAttemptsSync,
  markAgentRouterProviderSessionInvalidSync,
  readAgentRouterContextSnapshotSync,
  readAgentRouterEventSync,
  readAgentRouterProviderSessionSync,
  readAgentRouterSessionForTaskSync,
  readAgentRouterSessionSync,
  readAgentTaskAttemptSync,
  readLatestAgentRouterContextSnapshotSync,
  readLatestAgentTaskAttemptForTaskSync,
  recordAgentRouterEventSync,
  resolveRouterSessionForTaskSync,
  resolveTaskRouterConversationIdentity,
  updateAgentRouterSessionMemorySync,
  updateAgentTaskAttemptSync,
  upsertAgentRouterProviderSessionSync,
  upsertAgentRouterSessionSync,
  type AgentRouterConversationIdentity,
} from "./agent-router-sessions.ts";

// Runtime grants
export {
  canUserUseRuntimeSync,
  grantRuntimeUseToUserSync,
  listRuntimeGrantsForUserSync,
  listRuntimeGrantsSync,
  revokeRuntimeUseFromUserSync,
} from "./runtime-grants.ts";

// Document agent access
export {
  approveDocumentPermissionRequestSync,
  cancelDocumentPermissionRequestSync,
  createDocumentPermissionRequestSync,
  grantDocumentAgentAccessSync,
  linkDocumentPermissionRequestDocumentSync,
  listDocumentAgentAccessSync,
  listDocumentPermissionRequestsSync,
  readDocumentAgentAccessSync,
  readDocumentPermissionRequestSync,
  rejectDocumentPermissionRequestSync,
  revokeDocumentAgentAccessSync,
} from "./document-agent-access.ts";

// Knowledge proposals
export {
  createKnowledgeProposalSync,
  decideKnowledgeProposalSync,
  listKnowledgeProposalsSync,
  readKnowledgeProposalByApprovalIdSync,
  readKnowledgeProposalSync,
  resetKnowledgeProposalsSync,
  updateKnowledgeProposalApprovalIdSync,
  type CreateKnowledgeProposalInput,
  type DecideKnowledgeProposalInput,
  type ListKnowledgeProposalsOptions,
} from "./knowledge-proposals.ts";

// Notifications
export {
  archiveWorkspaceNotificationSync,
  countUnreadWorkspaceNotificationsSync,
  createWorkspaceNotificationSync,
  createWorkspaceNotificationsSync,
  listWorkspaceNotificationsForRecipientSync,
  markWorkspaceNotificationReadSync,
  type CreateWorkspaceNotificationInput,
  type ListWorkspaceNotificationsOptions,
  type WorkspaceNotificationRecipient,
} from "./notifications.ts";

// Runtime apps
export {
  claimNextRuntimeAppOperationForRuntimeSync,
  completeRuntimeAppOperationSync,
  createRuntimeAppOperationSync,
  failRuntimeAppOperationSync,
  listRuntimeAppCatalogItemsSync,
  listRuntimeAppOperationsSync,
  listRuntimeAppSkillBindingsSync,
  listRuntimeInstalledAppsSync,
  readRuntimeAppCatalogHealthSync,
  readRuntimeAppCatalogItemSync,
  readRuntimeAppOperationSync,
  readRuntimeInstalledAppSync,
  startRuntimeAppOperationSync,
  upsertRuntimeAppCatalogItemsSync,
  upsertRuntimeAppSkillBindingSync,
  type CompleteRuntimeAppOperationInput,
  type CreateRuntimeAppOperationInput,
  type FailRuntimeAppOperationInput,
  type UpsertRuntimeAppCatalogItemInput,
} from "./runtime-apps.ts";

// Skills
export {
  listStoredWorkspaceSkillsSync,
  readStoredWorkspaceSkillSync,
  createStoredWorkspaceSkillSync,
  updateStoredWorkspaceSkillMetaSync,
  upsertStoredWorkspaceSkillFileSync,
  deleteStoredWorkspaceSkillFileSync,
  deleteStoredWorkspaceSkillSync,
  listStoredAgentSkillAssignmentsSync,
  recordStoredSkillImportEventSync,
  listStoredSkillImportEventsSync,
  replaceStoredWorkspaceSkillsSync,
  replaceStoredAgentSkillAssignmentsSync,
  setStoredEmployeeSkillAssignmentsSync,
  resetStoredWorkspaceSkillsSync,
} from "./skills.ts";

// Knowledge assignments
export {
  listStoredKnowledgeAssignmentPoliciesSync,
  setStoredKnowledgePageAssignmentPolicySync,
  deleteStoredKnowledgeAssignmentPoliciesForPagesSync,
  listStoredAgentKnowledgePageAssignmentsSync,
  listStoredKnowledgeAssignmentsByPageIdSync,
  listStoredKnowledgeAssignmentsByEmployeeSync,
  setStoredKnowledgePageAssignedEmployeesSync,
  setStoredEmployeeKnowledgePageAssignmentsSync,
  deleteStoredKnowledgeAssignmentsForPagesSync,
  deleteStoredKnowledgeAssignmentsForEmployeeSync,
  resetStoredKnowledgeAssignmentsSync,
} from "./knowledge-assignments.ts";

// Task queue
export {
  enqueueNativeTaskSync,
  listQueuedTasksSync,
  readLatestConversationExecutionSync,
  readLatestChannelExecutionSync,
  readQueuedTaskSync,
  claimNextQueuedTaskForRuntimeSync,
  startQueuedTaskSync,
  completeQueuedTaskSync,
  failQueuedTaskSync,
  cancelQueuedTaskSync,
} from "./task-queue.ts";

// Task messages
export { appendTaskMessageSync, listTaskMessagesForTaskSync } from "./task-messages.ts";

// Task execution events
export {
  recordTaskExecutionEventSync,
  listTaskExecutionEventsSync,
  buildTaskExecutionEventContext,
  type TaskExecutionEventInput,
  type TaskExecutionEventListOptions,
  type TaskExecutionEventContext,
} from "./task-execution-events.ts";

// Token usage
export {
  ensureDefaultPricingSync,
  listModelPricingSync,
  readModelPricingSync,
  computeCostUsd,
  recordTokenUsageSync,
  listTokenUsageSync,
  getAgentCostSummarySync,
  getWorkspaceCostSummarySync,
} from "./token-usage.ts";

// Budgets
export {
  upsertBudgetSync,
  readBudgetByIdSync,
  readBudgetSync,
  listBudgetsSync,
  toggleBudgetSync,
  deleteBudgetSync,
  getSpentUsdSync,
  getMonthStartIso,
} from "./budgets.ts";


// Workspaces
export {
  createWorkspaceSync,
  ensureWorkspaceJoinCodesSync,
  hardDeleteWorkspaceSync,
  readWorkspaceSync,
  readWorkspaceByJoinCodeSync,
  listWorkspacesSync,
  rotateWorkspaceJoinCodeSync,
  updateWorkspaceSync,
  archiveWorkspaceSync,
  type HardDeleteWorkspaceResult,
} from "./workspaces.ts";

// Workspace memberships
export {
  createWorkspaceMembershipSync,
  readWorkspaceMembershipSync,
  listWorkspaceMembershipsSync,
  listUserWorkspacesSync,
  transferWorkspaceOwnershipSync,
  upsertWorkspaceMembershipSync,
  updateWorkspaceMembershipRoleSync,
  removeWorkspaceMembershipSync,
} from "./workspace-memberships.ts";
export {
  acceptWorkspaceInvitationSync,
  countActiveWorkspaceInvitationsSync,
  createWorkspaceInvitationSync,
  listWorkspaceInvitationsSync,
  readActiveWorkspaceInvitationByTokenSync,
  readWorkspaceInvitationByTokenSync,
  revokeWorkspaceInvitationSync,
  type CreatedWorkspaceInvitationRecord,
} from "./workspace-invitations.ts";

// Channel access
export {
  acceptChannelInvitationSync,
  approveChannelAccessRequestSync,
  cancelChannelAccessRequestSync,
  cancelChannelInvitationSync,
  createChannelAccessRequestSync,
  createChannelInvitationSync,
  createChannelParticipantSync,
  expireChannelInvitationSync,
  listChannelAccessRequestsSync,
  listChannelInvitationsSync,
  listChannelParticipantsForUserSync,
  listChannelParticipantsSync,
  listWorkspaceChannelParticipantsSync,
  readChannelAccessRequestSync,
  readChannelInvitationSync,
  readChannelParticipantSync,
  rejectChannelAccessRequestSync,
  rejectChannelInvitationSync,
  removeChannelParticipantSync,
  revokeChannelInvitationSync,
  type CreateChannelAccessRequestInput,
  type CreateChannelInvitationInput,
  type CreateChannelParticipantInput,
  type ListChannelAccessRequestsOptions,
  type ListChannelInvitationsOptions,
  type ListChannelParticipantsOptions,
} from "./channel-access.ts";

// Workspace channels / employees / tasks
export {
  listStoredChannelsSync,
  readStoredChannelSync,
  createStoredChannelSync,
  updateStoredChannelSync,
  deleteStoredChannelSync,
  replaceStoredChannelsSync,
} from "./workspace-channels.ts";
export {
  listStoredEmployeesSync,
  readStoredEmployeeSync,
  createStoredEmployeeSync,
  updateStoredEmployeeSync,
  deleteStoredEmployeeSync,
  replaceStoredEmployeesSync,
} from "./workspace-employees.ts";
export {
  listStoredTasksSync,
  readStoredTaskSync,
  createStoredTaskSync,
  updateStoredTaskSync,
  deleteStoredTaskSync,
  deleteStoredTasksForChannelSync,
  deleteStoredTasksForAssigneeSync,
  renameStoredTasksChannelSync,
  replaceStoredTasksSync,
} from "./workspace-tasks.ts";
