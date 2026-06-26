import { createHash } from "node:crypto";
import {
  createExternalIntegrationSync,
  listExternalChannelBindingsSync,
  listExternalDataOperationRunsSync,
  listExternalIntegrationEventsSync,
  listExternalIntegrationsSync,
  listExternalMessageMappingsSync,
  listExternalMessageOutboxSync,
  listExternalResourceBindingsSync,
  listExternalThreadBindingsSync,
  listExternalUserBindingsSync,
  readExternalChannelBindingByExternalChatSync,
  readExternalIntegrationSync,
  readExternalResourceBindingByKeySync,
  readExternalUserBindingByExternalUserSync,
  readStoredChannelSync,
  readWorkspaceMembershipSync,
  updateExternalIntegrationHealthSync,
  upsertExternalChannelBindingSync,
  upsertExternalResourceBindingSync,
  upsertExternalUserBindingSync,
  type ExternalChannelBindingRecord,
  type ExternalBindingStatus,
  type ExternalDataOperationRunRecord,
  type ExternalIntegrationHealthStatus,
  type ExternalIntegrationEventRecord,
  type ExternalIntegrationRecord,
  type ExternalIntegrationTransportMode,
  type ExternalMessageMappingRecord,
  type ExternalMessageOutboxRecord,
  type ExternalResourceBindingRecord,
  type ExternalThreadBindingRecord,
  type ExternalUserBindingRecord,
} from "@agent-space/db";
import { readFileSync } from "node:fs";
import {
  checkFeishuIntegrationHealth,
  buildFeishuHealthSnapshotConfigJson,
  buildEncryptedFeishuCredentials,
  createFeishuApiClient,
  createFeishuAgentBotBindingSync,
  disableFeishuAgentBotBindingSync,
  drainFeishuOutboxMessages,
  executeBoundFeishuReadDataOperation,
  fetchFeishuTenantAccessToken,
  FEISHU_AGENT_BOT_REQUIRED_CREDENTIAL_FIELDS,
  FEISHU_BOT_SMOKE_SCOPES,
  FEISHU_DATA_PLANE_SMOKE_SCOPES,
  FEISHU_DEFAULT_SCOPES,
  FEISHU_EVENT_CALLBACK_PATH,
  FEISHU_FINAL_EVIDENCE_GATE_REQUIREMENTS,
  FEISHU_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH,
  FEISHU_OPEN_PLATFORM_CONSOLE_URLS,
  FEISHU_OPEN_PLATFORM_SETUP_STEPS,
  FEISHU_OPENAPI_REQUIRED_DESTRUCTIVE_LIVE_SMOKE_STEPS,
  FEISHU_OPENAPI_REQUIRED_LIVE_SMOKE_STEPS,
  FEISHU_OPENAPI_REQUIRED_REQUEST_STEPS,
  FEISHU_PROVIDER_ID,
  FEISHU_REQUIRED_CREDENTIAL_FIELDS,
  FEISHU_REQUIRED_EVENTS,
  readFeishuIntegrationCredentials,
  readFeishuChannelAutoProvisionPolicy,
  readFeishuExternalParticipantPolicy,
  planBoundFeishuWriteDataOperation,
  planBoundFeishuWriteDataOperationWithApproval,
  reviewFeishuDataOperationApproval,
  resolveFeishuResourceDescriptorForType,
  sanitizeFeishuOperationResponseSummary,
  startFeishuWebSocketWorker,
  summarizeFeishuStoredCredentials,
  tryRecordWorkspaceAuditEventSync,
  rotateFeishuAgentBotCredentialsSync,
  updateFeishuAgentBotPolicySync,
  upsertFeishuExternalChannelDocumentSync,
  upsertFeishuExternalDataTableSync,
  validateFeishuResourceDescriptorForBinding,
  validateFeishuResourceBindingScopes,
  type ExternalDataOperationRequest,
  type ExternalDataOperationResult,
  type FeishuDataOperationApprovalContext,
  type FeishuAgentBotChannelAutoProvisioningInput,
  type FeishuAgentBotExternalGuestPolicyInput,
  type FeishuAgentBotBinding,
  type FeishuChannelAutoProvisionPolicy,
  type FeishuExternalParticipantPolicy,
  type FeishuApiClient,
  type FeishuApiRequest,
  type FeishuHealthCheckResult,
  type FeishuWebSocketWorkerMetrics,
} from "@agent-space/services";
import { getNumberFlag, getStringFlag, parseArgs } from "../../lib/args.ts";
import { writeData, type OutputFormat } from "../../lib/format.ts";

const FEISHU_CLI_PLACEHOLDERS = {
  publicAppUrl: "CHANGE_ME_PUBLIC_AGENTSPACE_URL",
  integrationId: "CHANGE_ME_FEISHU_INTEGRATION_ID",
  agentSpaceChannel: "CHANGE_ME_AGENTSPACE_CHANNEL",
  agentName: "CHANGE_ME_AGENT_NAME",
  secondAgentName: "CHANGE_ME_SECOND_AGENT_NAME",
  agentSpaceUserId: "CHANGE_ME_AGENTSPACE_USER_ID",
  approvalId: "CHANGE_ME_FEISHU_APPROVAL_ID",
  feishuChatId: "CHANGE_ME_FEISHU_CHAT_ID",
  feishuOpenId: "CHANGE_ME_FEISHU_OPEN_ID",
  docResource: "CHANGE_ME_FEISHU_DOC_URL_OR_TOKEN",
  docBlockId: "CHANGE_ME_FEISHU_DOC_BLOCK_ID",
  sheetResource: "CHANGE_ME_FEISHU_SHEET_URL_OR_TOKEN",
  sheetRange: "CHANGE_ME_FEISHU_SHEET_RANGE",
  sheetWriteRange: "CHANGE_ME_FEISHU_SHEET_WRITE_RANGE",
  baseResource: "CHANGE_ME_FEISHU_BASE_TABLE_URL_WITH_APP_TOKEN",
  baseRecordId: "CHANGE_ME_FEISHU_BASE_RECORD_ID",
} as const;

export interface FeishuReadinessReport {
  workspaceId: string;
  requiredReadiness: FeishuRequiredReadiness;
  integrationCount: number;
  readyForBotSmokeCount: number;
  readyForDataPlaneSmokeCount: number;
  readyForWorkerSmokeCount: number;
  strictSatisfied: boolean;
  integrations: FeishuIntegrationReadiness[];
}

export interface FeishuIntegrationReadiness {
  id: string;
  displayName: string;
  agentId?: string;
  status: string;
  transportMode: string;
  appConfigured: boolean;
  credentialsConfigured: boolean;
  healthStatus: string;
  channelBindings: BindingCountSummary;
  userBindings: BindingCountSummary;
  resourceBindings: BindingCountSummary & {
    doc: number;
    docWritable: number;
    sheet: number;
    sheetWritable: number;
    base: number;
    baseReady: number;
    baseWritable: number;
  };
  outboxFailures: number;
  pendingOutboxWithErrors: number;
  scopes: {
    configuredCount: number;
    missingForBotSmoke: string[];
    missingForDataPlaneSmoke: string[];
  };
  readyForBotSmoke: boolean;
  readyForDataPlaneSmoke: boolean;
  readyForWorkerSmoke: boolean;
  setupChecks: FeishuReadinessSetupCheck[];
  issues: string[];
}

export type FeishuReadinessSetupCheckStatus = "ready" | "missing" | "attention";

export interface FeishuReadinessSetupCheck {
  key:
    | "credentials"
    | "health"
    | "transport"
    | "chat_binding"
    | "user_binding"
    | "doc_binding"
    | "sheet_binding"
    | "base_binding"
    | "outbox";
  status: FeishuReadinessSetupCheckStatus;
  current: number | string;
  required?: number | string;
  issues: string[];
}

export interface FeishuSmokePlanReport {
  workspaceId: string;
  requiredReadiness: FeishuRequiredReadiness;
  integrationCount: number;
  strictSatisfied: boolean;
  selectedBotIntegrationId?: string;
  selectedDataPlaneIntegrationId?: string;
  selectedWorkerIntegrationId?: string;
  appSetup: FeishuOpenPlatformSetupSummary;
  runtimeSetup: FeishuRuntimeSetupSummary;
  smokeHarness: FeishuSmokeHarnessSummary;
  workerHarness: FeishuWorkerHarnessSummary;
  evidenceGates: FeishuSmokePlanEvidenceGate[];
  readinessSummary: {
    readyForBotSmokeCount: number;
    readyForDataPlaneSmokeCount: number;
    readyForWorkerSmokeCount: number;
  };
  steps: FeishuSmokePlanStep[];
}

export type FeishuSmokePlanEvidenceGateKey =
  | "bot_reply"
  | "native_agent_bot"
  | "guest_policy"
  | "worker_restart"
  | "worker_card_action"
  | "data_plane"
  | "failure_visibility"
  | "openapi_artifact";

export interface FeishuSmokePlanEvidenceGate {
  key: FeishuSmokePlanEvidenceGateKey;
  required: string;
}

export interface FeishuOpenPlatformSetupSummary {
  callbackUrlStatus: "ready" | "app_url_missing" | "integration_missing";
  callbackUrl?: string;
  developerConsoleUrl: string;
  requiredCredentialFields: string[];
  requiredEvents: string[];
  botScopes: string[];
  dataPlaneScopes: string[];
  setupSteps: FeishuOpenPlatformSetupStep[];
}

export interface FeishuOpenPlatformSetupStep {
  id: string;
  consoleUrl: string;
  required: string[];
}

export interface FeishuRuntimeSetupSummary {
  credentialEncryption: FeishuCredentialEncryptionReadiness;
}

export interface FeishuCredentialEncryptionReadiness {
  status: "ready" | "missing" | "invalid";
  checkedEnvNames: string[];
  configuredEnvName?: string;
  issue?: string;
}

export interface FeishuSmokeHarnessSummary {
  envExamplePath: string;
  envFilePath: string;
  evidencePath: string;
  appUrl?: string;
  callbackUrl?: string;
  requiredLiveSteps: number;
  destructiveLiveChecks: number;
  destructiveLiveStepNames: string[];
  prepareEnvCommand: string;
  checkEnvCommand: string;
  strictLiveCommand: string;
  verifyEvidenceCommand: string;
}

export interface FeishuSmokeEnvTemplateReport {
  workspaceId: string;
  integrationCount: number;
  selectedIntegrationId?: string;
  appUrl?: string;
  envFilePath: string;
  entries: FeishuSmokeEnvTemplateEntry[];
  issues: string[];
}

export interface FeishuSmokeEnvTemplateEntry {
  key: string;
  value: string;
  secret: boolean;
  required: boolean;
  source: "integration" | "app-url" | "placeholder" | "env";
  note?: string;
}

export interface FeishuIntegrationCreateCliResult {
  ok: true;
  workspaceId: string;
  integrationId: string;
  displayName: string;
  status: string;
  transportMode: ExternalIntegrationTransportMode;
  appId: string;
  tenantKeyConfigured: boolean;
  credentialsStored: {
    appSecret: boolean;
    verificationToken: boolean;
    encryptKey: boolean;
  };
  requiredCredentialFields: string[];
  requiredEvents: string[];
  requiredScopeCount: number;
  openPlatformSetup: FeishuOpenPlatformSetupSummary;
  secretRedacted: true;
  auditRecorded: boolean;
  nextCommands: {
    healthCheck: string;
    smokePlan: string;
    smokeEnv: string;
    checkEnv: string;
    strictLiveSmoke: string;
    verifyOpenApiEvidence: string;
    finalEvidence: string;
    bindChannel: string;
    bindUser: string;
    bindResourceDoc: string;
    bindResourceSheet: string;
    bindResourceBase: string;
  };
}

export interface FeishuCliErrorReport {
  ok: false;
  errorCode: string;
  errorMessage: string;
  nextStep?: string;
}

export interface FeishuIntegrationCreateCliInput {
  workspaceId: string;
  displayName?: string;
  transportMode?: string;
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey?: string;
  tenantKey?: string;
  createdByUserId?: string;
  appUrl?: string;
}

export interface FeishuAgentBotCliInput {
  workspaceId: string;
  agentId?: string;
  integrationId?: string;
  displayName?: string;
  transportMode?: string;
  appId?: string;
  appSecret?: string;
  verificationToken?: string;
  encryptKey?: string;
  tenantKey?: string;
  channelAutoProvisioning?: FeishuAgentBotChannelAutoProvisioningInput;
  externalGuestPolicy?: FeishuAgentBotExternalGuestPolicyInput;
  actorUserId?: string;
}

export interface FeishuAgentBotCliResult {
  ok: true;
  kind: "agent_bot";
  operation: "created" | "rotated" | "disabled" | "policy_updated" | "policy_read";
  workspaceId: string;
  integrationId: string;
  agentId: string;
  displayName: string;
  status: string;
  transportMode: string;
  appId: string;
  tenantKeyConfigured: boolean;
  credentials: {
    hasAppSecret: boolean;
    hasVerificationToken: boolean;
    hasEncryptKey: boolean;
  };
  channelAutoProvisioning: FeishuChannelAutoProvisionPolicy;
  externalGuestPolicy: FeishuExternalParticipantPolicy;
  secretRedacted: true;
}

export interface FeishuBindingCliResult {
  ok: true;
  kind: "channel" | "user" | "resource";
  workspaceId: string;
  integrationId: string;
  bindingId: string;
  status: string;
  externalIdRedacted: true;
  auditRecorded: boolean;
  channelName?: string;
  userId?: string;
  providerResourceType?: string;
  agentSpaceResourceType?: string;
  agentSpaceResourceId?: string;
}

export interface FeishuChannelBindingsCliReport {
  ok: true;
  workspaceId: string;
  integrationId?: string;
  integrationCount: number;
  bindingCount: number;
  activeBindingCount: number;
  externalIdsRedacted: true;
  integrations: FeishuChannelBindingsIntegrationSummary[];
  bindings: FeishuChannelBindingCliItem[];
}

export interface FeishuChannelBindingsIntegrationSummary {
  integrationId: string;
  displayName: string;
  agentId?: string;
  status: string;
  bindingCount: number;
  activeBindingCount: number;
}

export interface FeishuChannelBindingCliItem {
  bindingId: string;
  integrationId: string;
  integrationDisplayName: string;
  integrationAgentId?: string;
  channelName: string;
  externalChatReference: string;
  externalChatIdRedacted: true;
  externalChatType?: string;
  externalChatName?: string;
  status: string;
  syncMode: string;
  provisionSource?: string;
  reviewStatus?: string;
  agentId?: string;
  botBindingId?: string;
  linkedFromBindingId?: string;
  linkedFromAgentId?: string;
  linkedFromBotBindingId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeishuDataOperationCliResult {
  ok: boolean;
  workspaceId: string;
  integrationId: string;
  operationType: string;
  providerResourceType: string;
  externalIdRedacted: true;
  liveApiCalled: boolean;
  approvalRequired: boolean;
  approvalId?: string;
  approvalStatus?: string;
  runId?: string;
  runStatus?: string;
  resourceBindingId?: string;
  resultOk?: boolean;
  errorCode?: string;
  errorMessage?: string;
  payloadHash?: string;
  responseSummary?: Record<string, unknown>;
  previewSummary?: Record<string, unknown>;
}

export interface FeishuDataOperationApprovalReviewCliResult {
  ok: boolean;
  workspaceId: string;
  approvalId: string;
  decision?: "approved" | "rejected";
  approvalStatus?: string;
  externalIdRedacted: true;
  execution?: {
    runId: string;
    resultOk: boolean;
    runStatus: "succeeded" | "failed";
    errorCode?: string;
    errorMessage?: string;
    payloadHash?: string;
    responseSummary?: Record<string, unknown>;
    previewSummary?: Record<string, unknown>;
  };
  errorCode?: string;
  errorMessage?: string;
}

export interface FeishuWorkerHarnessSummary {
  integrationId?: string;
  systemdUnitPath: string;
  systemdEnvExamplePath: string;
  dockerComposePath: string;
  dockerEnvExamplePath: string;
  dryRunCommand: string;
  startCommand: string;
  systemdRestartCommand: string;
  dockerRestartCommand: string;
}

export interface FeishuSmokePlanStep {
  id: string;
  area: "setup" | "bot" | "data-plane" | "worker" | "failure";
  title: string;
  status: "done" | "pending" | "blocked";
  detail: string;
  command?: string;
  issues?: string[];
}

export interface FeishuHealthCheckCliReport {
  workspaceId: string;
  integrationId?: string;
  agentId?: string;
  agentOnly?: boolean;
  integrationCount: number;
  checkedCount: number;
  healthyCount: number;
  degradedCount: number;
  errorCount: number;
  strictSatisfied: boolean;
  persisted: boolean;
  results: FeishuHealthCheckCliItem[];
}

export interface FeishuHealthCheckCliItem {
  id: string;
  displayName: string;
  agentId?: string;
  status: ExternalIntegrationHealthStatus;
  previousHealthStatus?: string;
  checkedAt: string;
  botAppName?: string;
  scopeReadiness?: string;
  enabledScopeCount?: number;
  missingScopes?: string[];
  errorCode?: string;
  errorMessage?: string;
  persisted: boolean;
}

export interface FeishuEvidenceReport {
  workspaceId: string;
  requiredEvidence: FeishuEvidenceRequirement;
  integrationCount: number;
  strictSatisfied: boolean;
  openApiEvidence?: FeishuOpenApiSmokeEvidenceVerification;
  summary: {
    botSatisfiedCount: number;
    nativeExperienceSatisfiedCount: number;
    guestPolicySatisfiedCount: number;
    dataPlaneSatisfiedCount: number;
    workerSatisfiedCount: number;
    failureVisibleCount: number;
  };
  integrations: FeishuIntegrationEvidence[];
}

export interface FeishuIntegrationEvidence {
  id: string;
  displayName: string;
  transportMode: string;
  bot: {
    processedInboundEvents: number;
    inboundMessageMappings: number;
    sentOutboxItems: number;
    outboundMessageMappings: number;
    correlatedReplyMappings: number;
    satisfied: boolean;
  };
  nativeExperience: {
    agentBotRouteEvidence: number;
    nativeBotReplyEvidence: number;
    boundUserMentionEvidence: number;
    externalGuestMentionEvidence: number;
    agentChannelPolicyDeniedEvidence: number;
    botSenderLoopGuardEvidence: number;
    autoProvisionedChannelBindings: number;
    botAddedAutoProvisionedChannelBindings: number;
    firstMessageAutoProvisionedChannelBindings: number;
    reusedProviderChannelBindings: number;
    threadTaskBindings: number;
    threadContinuationEvidence: number;
    threadCollaborationEvidence: number;
    satisfied: boolean;
  };
  guestPolicy: {
    externalGuestAllowedEvidence: number;
    externalGuestReplyAllEvidence: number;
    externalGuestRequireIdentityEvidence: number;
    externalGuestIgnoreEvidence: number;
    externalGuestMentionRequiredEvidence: number;
    satisfied: boolean;
  };
  dataPlane: {
    docReadSucceeded: number;
    agentDocReadSucceeded: number;
    docWriteSucceeded: number;
    docApprovedWritesSucceeded: number;
    sheetReadSucceeded: number;
    sheetWriteSucceeded: number;
    sheetApprovedWritesSucceeded: number;
    sheetApprovedWriteSyncSucceeded: number;
    baseReadSucceeded: number;
    baseMutateSucceeded: number;
    baseApprovedMutationsSucceeded: number;
    baseApprovedMutationSyncSucceeded: number;
    userActorEvidence: number;
    externalGuestActorEvidence: number;
    externalGuestWriteDeniedEvidence: number;
    satisfied: boolean;
  };
  worker: {
    correlatedReplyMappings: number;
    requiredCorrelatedReplies: number;
    restartRecoverySatisfied: boolean;
    processedApprovalCardActions: number;
    approvalCardActionSatisfied: boolean;
    satisfied: boolean;
  };
  failureVisibility: {
    healthStatus: ExternalIntegrationHealthStatus;
    healthFailureVisible: boolean;
    providerFailureVisible: boolean;
    agentBotFailureEvidence: number;
    failedEvents: number;
    failedOutboxItems: number;
    failedDataOperations: number;
    satisfied: boolean;
  };
  issues: string[];
  remediationSteps: FeishuEvidenceRemediationStep[];
}

export interface FeishuOpenApiSmokeEvidenceVerification {
  evidencePath?: string;
  present: boolean;
  valid: boolean;
  issues: string[];
  remediationSteps: FeishuEvidenceRemediationStep[];
  summary?: {
    live: boolean;
    strictLive: boolean;
    strictLiveSatisfied: boolean;
    liveChecks: number;
    livePassed: number;
    liveSkipped: number;
    liveFailed: number;
    destructiveLiveChecks: number;
    requiredLiveSteps: number;
  };
}

export interface FeishuEvidenceRemediationStep {
  stepId: string;
  title: string;
  detail: string;
  issues: string[];
  command?: string;
}

interface BindingCountSummary {
  active: number;
  total: number;
}

type FeishuRequiredReadiness = "bot" | "data-plane" | "worker";

type FeishuEvidenceRequirement = "bot" | "native" | "guest-policy" | "data-plane" | "worker" | "failure" | "all";

interface BuildFeishuReadinessReportInput {
  workspaceId: string;
  integrationId?: string;
  agentId?: string;
  agentOnly?: boolean;
  requiredReadiness?: FeishuRequiredReadiness;
  integrations?: ExternalIntegrationRecord[];
  channelBindingsByIntegrationId?: Record<string, ExternalChannelBindingRecord[]>;
  userBindingsByIntegrationId?: Record<string, ExternalUserBindingRecord[]>;
  resourceBindingsByIntegrationId?: Record<string, ExternalResourceBindingRecord[]>;
  failedOutboxByIntegrationId?: Record<string, ExternalMessageOutboxRecord[]>;
  pendingOutboxByIntegrationId?: Record<string, ExternalMessageOutboxRecord[]>;
}

interface BuildFeishuSmokePlanReportInput extends BuildFeishuReadinessReportInput {
  appUrl?: string;
  runtimeEnv?: Record<string, string | undefined>;
}

interface BuildFeishuEvidenceReportInput {
  workspaceId: string;
  integrationId?: string;
  requiredEvidence?: FeishuEvidenceRequirement;
  openApiEvidencePath?: string;
  openApiEvidence?: unknown;
  integrations?: ExternalIntegrationRecord[];
  eventsByIntegrationId?: Record<string, ExternalIntegrationEventRecord[]>;
  messageMappingsByIntegrationId?: Record<string, ExternalMessageMappingRecord[]>;
  outboxByIntegrationId?: Record<string, ExternalMessageOutboxRecord[]>;
  channelBindingsByIntegrationId?: Record<string, ExternalChannelBindingRecord[]>;
  threadBindingsByIntegrationId?: Record<string, ExternalThreadBindingRecord[]>;
  dataOperationsByIntegrationId?: Record<string, ExternalDataOperationRunRecord[]>;
}

interface FeishuExpectedCallbackRouteProof {
  callbackRoute: string;
  callbackRouteFingerprint: string;
}

interface BuildFeishuSmokeEnvTemplateReportInput {
  workspaceId: string;
  integrationId?: string;
  appUrl?: string;
  integrations?: ExternalIntegrationRecord[];
}

type FeishuApiUploadRequest = Parameters<NonNullable<FeishuApiClient["upload"]>>[0];

export async function runFeishuIntegrationCommand(args: string[], format: OutputFormat): Promise<number> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printFeishuIntegrationHelp();
    return subcommand ? 0 : 1;
  }
  const parsed = parseArgs(rest);
  if (subcommand === "worker" && hasHelpFlag(parsed.flags)) {
    printFeishuIntegrationHelp();
    return 0;
  }
  if (subcommand === "create" && hasHelpFlag(parsed.flags)) {
    printFeishuIntegrationHelp();
    return 0;
  }
  if (
    (
      subcommand === "bind-agent-bot" ||
      subcommand === "disable-agent-bot" ||
      subcommand === "rotate-agent-bot-secret" ||
      subcommand === "auto-provision-policy"
    ) &&
    hasHelpFlag(parsed.flags)
  ) {
    printFeishuIntegrationHelp();
    return 0;
  }
  if (subcommand === "readiness" && hasHelpFlag(parsed.flags)) {
    printFeishuIntegrationHelp();
    return 0;
  }
  if (subcommand === "agent-bot-readiness" && hasHelpFlag(parsed.flags)) {
    printFeishuIntegrationHelp();
    return 0;
  }
  if (subcommand === "smoke-plan" && hasHelpFlag(parsed.flags)) {
    printFeishuIntegrationHelp();
    return 0;
  }
  if (subcommand === "smoke-env" && hasHelpFlag(parsed.flags)) {
    printFeishuIntegrationHelp();
    return 0;
  }
  if (subcommand === "health-check" && hasHelpFlag(parsed.flags)) {
    printFeishuIntegrationHelp();
    return 0;
  }
  if (subcommand === "evidence" && hasHelpFlag(parsed.flags)) {
    printFeishuIntegrationHelp();
    return 0;
  }
  if (subcommand === "data-operation" && hasHelpFlag(parsed.flags)) {
    printFeishuIntegrationHelp();
    return 0;
  }
  if (subcommand === "review-data-operation" && hasHelpFlag(parsed.flags)) {
    printFeishuIntegrationHelp();
    return 0;
  }
  if (subcommand === "channel-bindings" && hasHelpFlag(parsed.flags)) {
    printFeishuIntegrationHelp();
    return 0;
  }
  if (
    (subcommand === "bind-channel" || subcommand === "bind-user" || subcommand === "bind-resource") &&
    hasHelpFlag(parsed.flags)
  ) {
    printFeishuIntegrationHelp();
    return 0;
  }

  if (
    subcommand !== "worker" &&
    subcommand !== "create" &&
    subcommand !== "bind-agent-bot" &&
    subcommand !== "disable-agent-bot" &&
    subcommand !== "rotate-agent-bot-secret" &&
    subcommand !== "auto-provision-policy" &&
    subcommand !== "readiness" &&
    subcommand !== "agent-bot-readiness" &&
    subcommand !== "smoke-plan" &&
    subcommand !== "smoke-env" &&
    subcommand !== "health-check" &&
    subcommand !== "evidence" &&
    subcommand !== "data-operation" &&
    subcommand !== "review-data-operation" &&
    subcommand !== "channel-bindings" &&
    subcommand !== "bind-channel" &&
    subcommand !== "bind-user" &&
    subcommand !== "bind-resource"
  ) {
    printFeishuIntegrationHelp();
    return 1;
  }

  const workspaceId = getStringFlag(parsed.flags, "workspace-id")
    ?? getStringFlag(parsed.flags, "workspace")
    ?? process.env.AGENT_SPACE_WORKSPACE_ID?.trim()
    ?? "default";
  const integrationId = getStringFlag(parsed.flags, "integration")
    ?? getStringFlag(parsed.flags, "integration-id")
    ?? process.env.AGENT_SPACE_FEISHU_INTEGRATION_ID?.trim();
  const limit = getNumberFlag(parsed.flags, "limit", 50);
  const lockedBy = getStringFlag(parsed.flags, "locked-by")
    ?? process.env.AGENT_SPACE_FEISHU_WORKER_ID?.trim()
    ?? "agent-space-feishu-worker";
  const baseUrl = getStringFlag(parsed.flags, "base-url")
    ?? process.env.AGENT_SPACE_FEISHU_API_BASE_URL?.trim();
  const appUrl = getStringFlag(parsed.flags, "app-url")
    ?? readFeishuCliPublicAppUrl();
  const domain = getStringFlag(parsed.flags, "domain")
    ?? process.env.AGENT_SPACE_FEISHU_WS_DOMAIN?.trim();
  const dryRun = hasBooleanFlag(parsed.flags, "dry-run");
  const includeWebhookIntegrations = hasBooleanFlag(parsed.flags, "include-webhook");
  const drainOutboxOnly = hasBooleanFlag(parsed.flags, "drain-outbox") || hasBooleanFlag(parsed.flags, "once");
  const strictReadiness = hasBooleanFlag(parsed.flags, "strict");
  const createdByUserId = getStringFlag(parsed.flags, "created-by-user-id")
    ?? getStringFlag(parsed.flags, "created-by");

  if (subcommand === "readiness") {
    const requiredReadiness = parseRequiredReadiness(getStringFlag(parsed.flags, "require"));
    const report = buildFeishuReadinessReport({
      workspaceId,
      integrationId,
      requiredReadiness,
    });
    writeData(format, report);
    return report.integrationCount === 0 || (strictReadiness && !report.strictSatisfied) ? 1 : 0;
  }

  if (subcommand === "agent-bot-readiness") {
    const requiredReadiness = parseRequiredReadiness(getStringFlag(parsed.flags, "require"));
    const report = buildFeishuReadinessReport({
      workspaceId,
      integrationId,
      agentId: getStringFlag(parsed.flags, "agent")
        ?? getStringFlag(parsed.flags, "agent-id")
        ?? getStringFlag(parsed.flags, "agent-name"),
      agentOnly: true,
      requiredReadiness,
    });
    writeData(format, report);
    return report.integrationCount === 0 || (strictReadiness && !report.strictSatisfied) ? 1 : 0;
  }

  if (subcommand === "create") {
    try {
      const report = createFeishuIntegrationForCli(buildFeishuCreateCliInputFromFlags({
        workspaceId,
        flags: parsed.flags,
        createdByUserId,
        appUrl,
        env: readFeishuCreateCliEnv({
          envFilePath: getStringFlag(parsed.flags, "env-file"),
        }),
      }));
      writeData(format, report);
      return 0;
    } catch (error) {
      const report = buildFeishuCliCreateErrorReport(error);
      if (!report) {
        throw error;
      }
      writeData(format, report);
      return 1;
    }
  }

  if (subcommand === "bind-agent-bot") {
    try {
      const report = createFeishuAgentBotBindingForCli(buildFeishuAgentBotCliInputFromFlags({
        workspaceId,
        flags: parsed.flags,
        actorUserId: createdByUserId,
        env: readFeishuCreateCliEnv({
          envFilePath: getStringFlag(parsed.flags, "env-file"),
        }),
      }));
      writeData(format, report);
      return 0;
    } catch (error) {
      const report = buildFeishuCliAgentBotErrorReport(error);
      if (!report) {
        throw error;
      }
      writeData(format, report);
      return 1;
    }
  }

  if (subcommand === "disable-agent-bot") {
    try {
      const report = disableFeishuAgentBotForCli({
        workspaceId,
        integrationId,
        agentId: getStringFlag(parsed.flags, "agent") ?? getStringFlag(parsed.flags, "agent-id") ?? getStringFlag(parsed.flags, "agent-name"),
        actorUserId: createdByUserId,
      });
      writeData(format, report);
      return 0;
    } catch (error) {
      const report = buildFeishuCliAgentBotErrorReport(error);
      if (!report) {
        throw error;
      }
      writeData(format, report);
      return 1;
    }
  }

  if (subcommand === "rotate-agent-bot-secret") {
    try {
      const env = readFeishuCreateCliEnv({
        envFilePath: getStringFlag(parsed.flags, "env-file"),
      });
      const report = rotateFeishuAgentBotCredentialsForCli({
        workspaceId,
        integrationId,
        agentId: getStringFlag(parsed.flags, "agent") ?? getStringFlag(parsed.flags, "agent-id") ?? getStringFlag(parsed.flags, "agent-name"),
        appId: validateOptionalFeishuAgentBotValue("app_id", readStringFlagOrEnv({
          flags: parsed.flags,
          flagKeys: ["app-id", "app_id"],
          envFlagKeys: ["app-id-env", "app_id_env"],
          defaultEnvNames: [],
          env,
        })),
        appSecret: requireNonPlaceholderFeishuAgentBotValue("app_secret", requireStringFlagOrEnv({
          flags: parsed.flags,
          flagKeys: ["app-secret", "app_secret"],
          envFlagKeys: ["app-secret-env", "app_secret_env"],
          defaultEnvNames: ["FEISHU_APP_SECRET", "AGENT_SPACE_FEISHU_APP_SECRET"],
          missingCode: "feishu.agent_bot_binding.missing_app_secret",
          env,
        })),
        verificationToken: validateOptionalFeishuAgentBotValue("verification_token", readStringFlagOrEnv({
          flags: parsed.flags,
          flagKeys: ["verification-token", "verification_token"],
          envFlagKeys: ["verification-token-env", "verification_token_env"],
          defaultEnvNames: ["FEISHU_VERIFICATION_TOKEN", "AGENT_SPACE_FEISHU_VERIFICATION_TOKEN"],
          env,
        })),
        encryptKey: validateOptionalFeishuAgentBotValue("encrypt_key", readStringFlagOrEnv({
          flags: parsed.flags,
          flagKeys: ["encrypt-key", "encrypt_key"],
          envFlagKeys: ["encrypt-key-env", "encrypt_key_env"],
          defaultEnvNames: ["FEISHU_ENCRYPT_KEY", "AGENT_SPACE_FEISHU_ENCRYPT_KEY"],
          env,
        })),
        tenantKey: validateOptionalFeishuAgentBotValue("tenant_key", readStringFlagOrEnv({
          flags: parsed.flags,
          flagKeys: ["tenant-key", "tenant_key"],
          envFlagKeys: ["tenant-key-env", "tenant_key_env"],
          defaultEnvNames: [],
          env,
        })),
        actorUserId: createdByUserId,
      });
      writeData(format, report);
      return 0;
    } catch (error) {
      const report = buildFeishuCliAgentBotErrorReport(error);
      if (!report) {
        throw error;
      }
      writeData(format, report);
      return 1;
    }
  }

  if (subcommand === "auto-provision-policy") {
    try {
      const report = updateFeishuAgentBotPolicyForCli(buildFeishuAgentBotPolicyCliInputFromFlags({
        workspaceId,
        integrationId,
        flags: parsed.flags,
        actorUserId: createdByUserId,
      }));
      writeData(format, report);
      return 0;
    } catch (error) {
      const report = buildFeishuCliAgentBotErrorReport(error);
      if (!report) {
        throw error;
      }
      writeData(format, report);
      return 1;
    }
  }

  if (subcommand === "smoke-plan") {
    const requiredReadiness = parseRequiredReadiness(getStringFlag(parsed.flags, "require"));
    const report = buildFeishuSmokePlanReport({
      workspaceId,
      integrationId,
      requiredReadiness,
      appUrl,
    });
    writeData(format, report);
    return getFeishuSmokePlanExitCode(report, { strict: strictReadiness });
  }

  if (subcommand === "smoke-env") {
    const report = buildFeishuSmokeEnvTemplateReport({
      workspaceId,
      integrationId,
      appUrl,
    });
    if (format === "json") {
      writeData(format, report);
    } else {
      const output = formatFeishuSmokeEnvCommandText(report);
      if (output.stderr) {
        console.error(output.stderr);
      }
      if (output.stdout) {
        console.log(output.stdout);
      }
    }
    return getFeishuSmokeEnvExitCode(report);
  }

  if (subcommand === "evidence") {
    const report = buildFeishuEvidenceReport({
      workspaceId,
      integrationId,
      requiredEvidence: parseEvidenceRequirement(getStringFlag(parsed.flags, "require")),
      openApiEvidencePath: getStringFlag(parsed.flags, "openapi-evidence")
        ?? getStringFlag(parsed.flags, "open-api-evidence")
        ?? getStringFlag(parsed.flags, "evidence-artifact"),
    });
    writeData(format, report);
    return report.integrationCount === 0 || (strictReadiness && !report.strictSatisfied) ? 1 : 0;
  }

  if (subcommand === "health-check") {
    const agentId = getStringFlag(parsed.flags, "agent")
      ?? getStringFlag(parsed.flags, "agent-id")
      ?? getStringFlag(parsed.flags, "agent-name");
    const report = await runFeishuHealthCheckCli({
      workspaceId,
      integrationId,
      agentId,
      agentOnly: Boolean(agentId),
      baseUrl,
      persist: !dryRun,
    });
    writeData(format, report);
    return report.integrationCount === 0 ||
      report.errorCount > 0 ||
      (strictReadiness && !report.strictSatisfied)
      ? 1
      : 0;
  }

  if (subcommand === "data-operation") {
    const report = await runFeishuDataOperationForCli({
      workspaceId,
      integrationId: requireCliIntegrationId(integrationId),
      operation: requireStringFlag(parsed.flags, "operation"),
      providerResourceType: getStringFlag(parsed.flags, "type"),
      resourceUrlOrToken: requireStringFlag(parsed.flags, "resource"),
      actorType: getStringFlag(parsed.flags, "actor-type"),
      actorId: getStringFlag(parsed.flags, "actor-id"),
      approvalAgentId: getStringFlag(parsed.flags, "approval-agent")
        ?? getStringFlag(parsed.flags, "approval-agent-id"),
      approvalChannelName: getStringFlag(parsed.flags, "approval-channel")
        ?? getStringFlag(parsed.flags, "approval-channel-name"),
      approvalContentPreview: getStringFlag(parsed.flags, "approval-preview"),
      baseUrl,
      parameters: buildFeishuCliDataOperationParameters(parsed.flags),
    });
    writeData(format, report);
    return report.ok ? 0 : 1;
  }

  if (subcommand === "review-data-operation") {
    const report = await runFeishuDataOperationApprovalReviewForCli({
      workspaceId,
      approvalId: requireStringFlag(parsed.flags, "approval-id"),
      decision: requireStringFlag(parsed.flags, "decision"),
      reviewerComment: getStringFlag(parsed.flags, "comment"),
      baseUrl,
    });
    writeData(format, report);
    return report.ok ? 0 : 1;
  }

  if (subcommand === "channel-bindings") {
    try {
      const report = buildFeishuChannelBindingsCliReport({
        workspaceId,
        integrationId,
        status: parseFeishuBindingStatusFlag(getStringFlag(parsed.flags, "status")),
      });
      writeData(format, report);
      return 0;
    } catch (error) {
      const report = buildFeishuCliBindingErrorReport(error);
      if (!report) {
        throw error;
      }
      writeData(format, report);
      return 1;
    }
  }

  if (subcommand === "bind-channel") {
    try {
      const report = createFeishuChannelBindingForCli({
        workspaceId,
        integrationId: requireCliIntegrationId(integrationId),
        channelName: requireStringFlag(parsed.flags, "channel"),
        externalChatId: requireStringFlag(parsed.flags, "chat-id"),
        externalChatType: getStringFlag(parsed.flags, "chat-type") ?? "group",
        externalChatName: getStringFlag(parsed.flags, "chat-name"),
        createdByUserId,
      });
      writeData(format, report);
      return 0;
    } catch (error) {
      const report = buildFeishuCliBindingErrorReport(error);
      if (!report) {
        throw error;
      }
      writeData(format, report);
      return 1;
    }
  }

  if (subcommand === "bind-user") {
    try {
      const report = createFeishuUserBindingForCli({
        workspaceId,
        integrationId: requireCliIntegrationId(integrationId),
        userId: requireStringFlag(parsed.flags, "user-id"),
        externalUserId: requireStringFlag(parsed.flags, "open-id"),
        externalUnionId: getStringFlag(parsed.flags, "union-id"),
        externalOpenId: getStringFlag(parsed.flags, "feishu-user-id"),
        externalEmail: getStringFlag(parsed.flags, "email"),
        displayName: getStringFlag(parsed.flags, "display-name"),
      });
      writeData(format, report);
      return 0;
    } catch (error) {
      const report = buildFeishuCliBindingErrorReport(error);
      if (!report) {
        throw error;
      }
      writeData(format, report);
      return 1;
    }
  }

  if (subcommand === "bind-resource") {
    try {
      const report = createFeishuResourceBindingForCli({
        workspaceId,
        integrationId: requireCliIntegrationId(integrationId),
        providerResourceType: requireStringFlag(parsed.flags, "type"),
        resourceUrlOrToken: requireStringFlag(parsed.flags, "resource"),
        agentSpaceResourceType: requireStringFlag(parsed.flags, "agent-space-type"),
        agentSpaceResourceId: getStringFlag(parsed.flags, "agent-space-id") ?? "",
        channelName: getStringFlag(parsed.flags, "channel"),
        displayName: getStringFlag(parsed.flags, "display-name"),
        allowWrite: hasBooleanFlag(parsed.flags, "allow-write"),
        guestReadable: hasBooleanFlag(parsed.flags, "guest-readable"),
        createdByUserId,
        createdBy: getStringFlag(parsed.flags, "created-by-name") ?? "AgentSpace CLI",
      });
      writeData(format, report);
      return 0;
    } catch (error) {
      const report = buildFeishuCliBindingErrorReport(error);
      if (!report) {
        throw error;
      }
      writeData(format, report);
      return 1;
    }
  }

  if (!drainOutboxOnly) {
    const worker = await startFeishuWebSocketWorker({
      workspaceId,
      integrationId,
      lockedBy,
      baseUrl,
      domain,
      drainOutboxLimit: limit,
      dryRun,
      includeWebhookIntegrations,
    });
    writeData(format, worker.summary);
    if (dryRun) {
      return worker.summary.errors.length > 0 ? 1 : 0;
    }
    if (worker.summary.startedCount === 0) {
      worker.close();
      return worker.summary.errors.length > 0 ? 1 : 0;
    }
    await waitForShutdownSignal();
    worker.close();
    writeData(format, {
      ...worker.summary,
      metrics: worker.metrics,
      connectionStatuses: worker.getConnectionStatuses(),
    });
    return getFeishuWorkerExitCode(worker.metrics);
  }

  const result = await drainFeishuOutboxMessages({
    workspaceId,
    integrationId,
    limit,
    lockedBy,
    baseUrl,
  });
  writeData(format, result);
  return result.errors.length > 0 && result.processedCount === 0 ? 1 : 0;
}

export function getFeishuWorkerExitCode(metrics: Pick<
  FeishuWebSocketWorkerMetrics,
  "connectionErrorCount" | "failedCount" | "processedCount"
>): number {
  if (metrics.processedCount > 0) {
    return 0;
  }
  return metrics.failedCount > 0 || metrics.connectionErrorCount > 0 ? 1 : 0;
}

export function createFeishuIntegrationForCli(
  input: FeishuIntegrationCreateCliInput,
  deps: {
    createIntegration?: typeof createExternalIntegrationSync;
    encryptCredentials?: typeof buildEncryptedFeishuCredentials;
    auditRecorder?: typeof tryRecordWorkspaceAuditEventSync;
  } = {},
): FeishuIntegrationCreateCliResult {
  const createIntegration = deps.createIntegration ?? createExternalIntegrationSync;
  const encryptCredentials = deps.encryptCredentials ?? buildEncryptedFeishuCredentials;
  const auditRecorder = deps.auditRecorder ?? tryRecordWorkspaceAuditEventSync;
  const displayName = normalizeOptionalText(input.displayName) ?? "Feishu";
  const transportMode = parseFeishuCliTransportMode(input.transportMode);
  const appId = requireNonEmpty(input.appId, "feishu.create.missing_app_id");
  const appSecret = requireNonEmpty(input.appSecret, "feishu.create.missing_app_secret");
  const verificationToken = requireNonEmpty(input.verificationToken, "feishu.create.missing_verification_token");
  const encryptKey = normalizeOptionalText(input.encryptKey);
  const tenantKey = normalizeOptionalText(input.tenantKey);

  let encryptedCredentialsJson: Record<string, string>;
  try {
    encryptedCredentialsJson = encryptCredentials({
      appSecret,
      verificationToken,
      encryptKey,
    });
  } catch (error) {
    throw normalizeFeishuCreateCliError(error);
  }

  let integration: ExternalIntegrationRecord;
  try {
    integration = createIntegration({
      workspaceId: input.workspaceId,
      provider: FEISHU_PROVIDER_ID,
      displayName,
      transportMode,
      appId,
      tenantKey,
      encryptedCredentialsJson,
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
      createdByUserId: normalizeOptionalText(input.createdByUserId),
    });
  } catch (error) {
    throw normalizeFeishuCreateCliError(error);
  }
  const flags = `--workspace-id ${input.workspaceId} --integration ${integration.id}`;
  const appUrlFlag = normalizeOptionalText(input.appUrl)
    ? ` --app-url ${normalizeOptionalText(input.appUrl)}`
    : "";
  const smokeHarness = buildFeishuSmokeHarnessSummary({
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    appUrl: input.appUrl,
  });
  const auditRecorded = auditRecorder({
    workspaceId: input.workspaceId,
    title: "Feishu integration created from CLI",
    note: `Feishu CLI created integration "${integration.displayName}".`,
    code: "workspace.external_integration_created",
    data: {
      actorType: "cli",
      resourceType: "external_integration",
      resourceId: integration.id,
      provider: FEISHU_PROVIDER_ID,
      transportMode: integration.transportMode,
      appId: integration.appId,
      tenantKeyConfigured: Boolean(integration.tenantKey),
      secretRedacted: true,
    },
  });

  return {
    ok: true,
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    displayName: integration.displayName,
    status: integration.status,
    transportMode: integration.transportMode,
    appId: integration.appId ?? "",
    tenantKeyConfigured: Boolean(integration.tenantKey),
    credentialsStored: {
      appSecret: true,
      verificationToken: true,
      encryptKey: Boolean(encryptKey),
    },
    requiredCredentialFields: [...FEISHU_REQUIRED_CREDENTIAL_FIELDS],
    requiredEvents: [...FEISHU_REQUIRED_EVENTS],
    requiredScopeCount: FEISHU_DEFAULT_SCOPES.length,
    openPlatformSetup: buildFeishuOpenPlatformSetupSummary({
      hasIntegration: true,
      hasAppUrl: Boolean(smokeHarness.appUrl),
      callbackUrl: smokeHarness.callbackUrl,
    }),
    secretRedacted: true,
    auditRecorded,
    nextCommands: {
      healthCheck: `agent-space integrations feishu health-check ${flags} --strict --json`,
      smokePlan: `agent-space integrations feishu smoke-plan ${flags}${appUrlFlag} --json`,
      smokeEnv: smokeHarness.prepareEnvCommand,
      checkEnv: smokeHarness.checkEnvCommand,
      strictLiveSmoke: smokeHarness.strictLiveCommand,
      verifyOpenApiEvidence: smokeHarness.verifyEvidenceCommand,
      finalEvidence: `agent-space integrations feishu evidence ${flags} --openapi-evidence ${smokeHarness.evidencePath} --strict --require all --json`,
      bindChannel: `agent-space integrations feishu bind-channel ${flags} --channel ${FEISHU_CLI_PLACEHOLDERS.agentSpaceChannel} --chat-id ${FEISHU_CLI_PLACEHOLDERS.feishuChatId} --json`,
      bindUser: `agent-space integrations feishu bind-user ${flags} --user-id ${FEISHU_CLI_PLACEHOLDERS.agentSpaceUserId} --open-id ${FEISHU_CLI_PLACEHOLDERS.feishuOpenId} --json`,
      bindResourceDoc: `agent-space integrations feishu bind-resource ${flags} --type doc --resource ${FEISHU_CLI_PLACEHOLDERS.docResource} --agent-space-type channel_document --channel ${FEISHU_CLI_PLACEHOLDERS.agentSpaceChannel} --allow-write --json`,
      bindResourceSheet: `agent-space integrations feishu bind-resource ${flags} --type sheet --resource ${FEISHU_CLI_PLACEHOLDERS.sheetResource} --agent-space-type data_table --channel ${FEISHU_CLI_PLACEHOLDERS.agentSpaceChannel} --allow-write --json`,
      bindResourceBase: `agent-space integrations feishu bind-resource ${flags} --type base_table --resource ${FEISHU_CLI_PLACEHOLDERS.baseResource} --agent-space-type data_table --channel ${FEISHU_CLI_PLACEHOLDERS.agentSpaceChannel} --allow-write --json`,
    },
  };
}

export function createFeishuAgentBotBindingForCli(
  input: FeishuAgentBotCliInput,
  deps: {
    createBinding?: typeof createFeishuAgentBotBindingSync;
  } = {},
): FeishuAgentBotCliResult {
  const createBinding = deps.createBinding ?? createFeishuAgentBotBindingSync;
  const binding = createBinding({
    workspaceId: input.workspaceId,
    agentId: requireNonEmpty(input.agentId, "feishu.agent_bot_binding.missing_agent_id"),
    displayName: normalizeOptionalText(input.displayName),
    transportMode: parseFeishuAgentBotCliTransportMode(input.transportMode),
    appId: requireNonEmpty(input.appId, "feishu.agent_bot_binding.missing_app_id"),
    appSecret: requireNonEmpty(input.appSecret, "feishu.agent_bot_binding.missing_app_secret"),
    tenantKey: normalizeOptionalText(input.tenantKey),
    verificationToken: normalizeOptionalText(input.verificationToken),
    encryptKey: normalizeOptionalText(input.encryptKey),
    createdByUserId: normalizeOptionalText(input.actorUserId),
    ...(input.channelAutoProvisioning ? { channelAutoProvisioning: input.channelAutoProvisioning } : {}),
    ...(input.externalGuestPolicy ? { externalGuestPolicy: input.externalGuestPolicy } : {}),
  });
  return buildFeishuAgentBotCliResult("created", binding);
}

export function rotateFeishuAgentBotCredentialsForCli(
  input: FeishuAgentBotCliInput,
  deps: {
    rotateCredentials?: typeof rotateFeishuAgentBotCredentialsSync;
  } = {},
): FeishuAgentBotCliResult {
  const rotateCredentials = deps.rotateCredentials ?? rotateFeishuAgentBotCredentialsSync;
  const binding = rotateCredentials({
    workspaceId: input.workspaceId,
    integrationId: normalizeOptionalText(input.integrationId),
    agentId: normalizeOptionalText(input.agentId),
    appId: normalizeOptionalText(input.appId),
    appSecret: requireNonEmpty(input.appSecret, "feishu.agent_bot_binding.missing_app_secret"),
    tenantKey: normalizeOptionalText(input.tenantKey),
    verificationToken: normalizeOptionalText(input.verificationToken),
    encryptKey: normalizeOptionalText(input.encryptKey),
    updatedByUserId: normalizeOptionalText(input.actorUserId),
  });
  return buildFeishuAgentBotCliResult("rotated", binding);
}

export function disableFeishuAgentBotForCli(
  input: FeishuAgentBotCliInput,
  deps: {
    disableBinding?: typeof disableFeishuAgentBotBindingSync;
  } = {},
): FeishuAgentBotCliResult {
  const disableBinding = deps.disableBinding ?? disableFeishuAgentBotBindingSync;
  const binding = disableBinding({
    workspaceId: input.workspaceId,
    integrationId: normalizeOptionalText(input.integrationId),
    agentId: normalizeOptionalText(input.agentId),
    updatedByUserId: normalizeOptionalText(input.actorUserId),
  });
  return buildFeishuAgentBotCliResult("disabled", binding);
}

export function updateFeishuAgentBotPolicyForCli(
  input: FeishuAgentBotCliInput,
  deps: {
    updatePolicy?: typeof updateFeishuAgentBotPolicySync;
  } = {},
): FeishuAgentBotCliResult {
  const updatePolicy = deps.updatePolicy ?? updateFeishuAgentBotPolicySync;
  const hasPolicyPatch = Boolean(input.channelAutoProvisioning || input.externalGuestPolicy);
  const binding = updatePolicy({
    workspaceId: input.workspaceId,
    integrationId: normalizeOptionalText(input.integrationId),
    agentId: normalizeOptionalText(input.agentId),
    ...(input.channelAutoProvisioning ? { channelAutoProvisioning: input.channelAutoProvisioning } : {}),
    ...(input.externalGuestPolicy ? { externalGuestPolicy: input.externalGuestPolicy } : {}),
    updatedByUserId: normalizeOptionalText(input.actorUserId),
  });
  return buildFeishuAgentBotCliResult(hasPolicyPatch ? "policy_updated" : "policy_read", binding);
}

function buildFeishuAgentBotCliResult(
  operation: FeishuAgentBotCliResult["operation"],
  binding: FeishuAgentBotBinding,
): FeishuAgentBotCliResult {
  return {
    ok: true,
    kind: "agent_bot",
    operation,
    workspaceId: binding.workspaceId,
    integrationId: binding.id,
    agentId: binding.agentId,
    displayName: binding.displayName,
    status: binding.status,
    transportMode: binding.transportMode,
    appId: binding.appId,
    tenantKeyConfigured: Boolean(binding.tenantKey),
    credentials: summarizeFeishuStoredCredentials(binding),
    channelAutoProvisioning: readFeishuChannelAutoProvisionPolicy(binding),
    externalGuestPolicy: readFeishuExternalParticipantPolicy(binding),
    secretRedacted: true,
  };
}

export function buildFeishuCreateCliInputFromFlags(input: {
  workspaceId: string;
  flags: Record<string, string | boolean>;
  createdByUserId?: string;
  appUrl?: string;
  env?: Record<string, string | undefined>;
}): FeishuIntegrationCreateCliInput {
  const appId = requireNonPlaceholderFeishuCreateValue("app_id", requireStringFlagOrEnv({
    flags: input.flags,
    flagKeys: ["app-id", "app_id"],
    envFlagKeys: ["app-id-env", "app_id_env"],
    defaultEnvNames: ["FEISHU_APP_ID", "AGENT_SPACE_FEISHU_APP_ID"],
    missingCode: "feishu.create.missing_app_id",
    env: input.env,
  }));
  const appSecret = requireNonPlaceholderFeishuCreateValue("app_secret", requireStringFlagOrEnv({
    flags: input.flags,
    flagKeys: ["app-secret", "app_secret"],
    envFlagKeys: ["app-secret-env", "app_secret_env"],
    defaultEnvNames: ["FEISHU_APP_SECRET", "AGENT_SPACE_FEISHU_APP_SECRET"],
    missingCode: "feishu.create.missing_app_secret",
    env: input.env,
  }));
  const verificationToken = requireNonPlaceholderFeishuCreateValue("verification_token", requireStringFlagOrEnv({
    flags: input.flags,
    flagKeys: ["verification-token", "verification_token"],
    envFlagKeys: ["verification-token-env", "verification_token_env"],
    defaultEnvNames: ["FEISHU_VERIFICATION_TOKEN", "AGENT_SPACE_FEISHU_VERIFICATION_TOKEN"],
    missingCode: "feishu.create.missing_verification_token",
    env: input.env,
  }));
  const encryptKey = validateOptionalFeishuCreateValue("encrypt_key", readStringFlagOrEnv({
    flags: input.flags,
    flagKeys: ["encrypt-key", "encrypt_key"],
    envFlagKeys: ["encrypt-key-env", "encrypt_key_env"],
    defaultEnvNames: ["FEISHU_ENCRYPT_KEY", "AGENT_SPACE_FEISHU_ENCRYPT_KEY"],
    env: input.env,
  }));
  const tenantKey = validateOptionalFeishuCreateValue("tenant_key", readStringFlagOrEnv({
    flags: input.flags,
    flagKeys: ["tenant-key", "tenant_key"],
    envFlagKeys: ["tenant-key-env", "tenant_key_env"],
    defaultEnvNames: ["FEISHU_TENANT_KEY", "AGENT_SPACE_FEISHU_TENANT_KEY"],
    env: input.env,
  }));
  return {
    workspaceId: input.workspaceId,
    displayName: getStringFlag(input.flags, "name") ?? getStringFlag(input.flags, "display-name"),
    transportMode: getStringFlag(input.flags, "transport") ?? getStringFlag(input.flags, "mode"),
    appId,
    appSecret,
    verificationToken,
    encryptKey,
    tenantKey,
    createdByUserId: input.createdByUserId,
    appUrl: input.appUrl,
  };
}

export function buildFeishuAgentBotCliInputFromFlags(input: {
  workspaceId: string;
  flags: Record<string, string | boolean>;
  actorUserId?: string;
  env?: Record<string, string | undefined>;
}): FeishuAgentBotCliInput {
  const agentId = requireNonPlaceholderFeishuAgentBotValue("agent_id", requireStringFlagValue({
    flags: input.flags,
    keys: ["agent", "agent-id", "agent-name"],
    missingCode: "feishu.agent_bot_binding.missing_agent_id",
  }));
  const appId = requireNonPlaceholderFeishuAgentBotValue("app_id", requireStringFlagOrEnv({
    flags: input.flags,
    flagKeys: ["app-id", "app_id"],
    envFlagKeys: ["app-id-env", "app_id_env"],
    defaultEnvNames: ["FEISHU_APP_ID", "AGENT_SPACE_FEISHU_APP_ID"],
    missingCode: "feishu.agent_bot_binding.missing_app_id",
    env: input.env,
  }));
  const appSecret = requireNonPlaceholderFeishuAgentBotValue("app_secret", requireStringFlagOrEnv({
    flags: input.flags,
    flagKeys: ["app-secret", "app_secret"],
    envFlagKeys: ["app-secret-env", "app_secret_env"],
    defaultEnvNames: ["FEISHU_APP_SECRET", "AGENT_SPACE_FEISHU_APP_SECRET"],
    missingCode: "feishu.agent_bot_binding.missing_app_secret",
    env: input.env,
  }));
  const verificationToken = validateOptionalFeishuAgentBotValue("verification_token", readStringFlagOrEnv({
    flags: input.flags,
    flagKeys: ["verification-token", "verification_token"],
    envFlagKeys: ["verification-token-env", "verification_token_env"],
    defaultEnvNames: ["FEISHU_VERIFICATION_TOKEN", "AGENT_SPACE_FEISHU_VERIFICATION_TOKEN"],
    env: input.env,
  }));
  const encryptKey = validateOptionalFeishuAgentBotValue("encrypt_key", readStringFlagOrEnv({
    flags: input.flags,
    flagKeys: ["encrypt-key", "encrypt_key"],
    envFlagKeys: ["encrypt-key-env", "encrypt_key_env"],
    defaultEnvNames: ["FEISHU_ENCRYPT_KEY", "AGENT_SPACE_FEISHU_ENCRYPT_KEY"],
    env: input.env,
  }));
  const tenantKey = validateOptionalFeishuAgentBotValue("tenant_key", readStringFlagOrEnv({
    flags: input.flags,
    flagKeys: ["tenant-key", "tenant_key"],
    envFlagKeys: ["tenant-key-env", "tenant_key_env"],
    defaultEnvNames: ["FEISHU_TENANT_KEY", "AGENT_SPACE_FEISHU_TENANT_KEY"],
    env: input.env,
  }));
  return {
    workspaceId: input.workspaceId,
    agentId,
    displayName: getStringFlag(input.flags, "name") ?? getStringFlag(input.flags, "display-name"),
    transportMode: getStringFlag(input.flags, "transport") ?? getStringFlag(input.flags, "mode") ?? "websocket_worker",
    appId,
    appSecret,
    verificationToken,
    encryptKey,
    tenantKey,
    channelAutoProvisioning: buildFeishuAgentBotChannelAutoProvisioningFromFlags(input.flags),
    externalGuestPolicy: buildFeishuAgentBotExternalGuestPolicyFromFlags(input.flags),
    actorUserId: input.actorUserId,
  };
}

export function buildFeishuAgentBotPolicyCliInputFromFlags(input: {
  workspaceId: string;
  integrationId?: string;
  flags: Record<string, string | boolean>;
  actorUserId?: string;
}): FeishuAgentBotCliInput {
  return {
    workspaceId: input.workspaceId,
    integrationId: normalizeOptionalText(input.integrationId),
    agentId: getStringFlag(input.flags, "agent")
      ?? getStringFlag(input.flags, "agent-id")
      ?? getStringFlag(input.flags, "agent-name"),
    channelAutoProvisioning: buildFeishuAgentBotChannelAutoProvisioningFromFlags(input.flags),
    externalGuestPolicy: buildFeishuAgentBotExternalGuestPolicyFromFlags(input.flags),
    actorUserId: input.actorUserId,
  };
}

export function readFeishuCreateCliEnv(input: {
  envFilePath?: string;
  env?: Record<string, string | undefined>;
} = {}): Record<string, string | undefined> {
  const env = input.env ?? process.env;
  if (!input.envFilePath?.trim()) {
    return env;
  }

  return {
    ...parseFeishuCliEnvFile(readFileSync(input.envFilePath, "utf8")),
    ...env,
  };
}

function buildFeishuAgentBotChannelAutoProvisioningFromFlags(
  flags: Record<string, string | boolean>,
): FeishuAgentBotChannelAutoProvisioningInput | undefined {
  const botAdded = readFeishuPolicyFlag(flags, ["bot-added-policy", "bot_added_policy"], [
    "auto_create_channel",
    "pending_admin_review",
    "disabled",
  ], "feishu.agent_bot_binding.invalid_channel_auto_provisioning_policy");
  const firstMessage = readFeishuPolicyFlag(flags, ["first-message-policy", "first_message_policy"], [
    "auto_create_if_bot_mentioned",
    "pending_admin_review",
    "reply_with_setup_card",
    "disabled",
  ], "feishu.agent_bot_binding.invalid_channel_auto_provisioning_policy");
  const reviewStatus = readFeishuPolicyFlag(flags, ["review-status", "review_status"], [
    "approved",
    "pending_admin_review",
    "needs_identity_binding",
  ], "feishu.agent_bot_binding.invalid_channel_auto_provisioning_policy");
  const policy = {
    ...(botAdded ? { botAdded } : {}),
    ...(firstMessage ? { firstMessage } : {}),
    ...(reviewStatus ? { reviewStatus } : {}),
  };
  return Object.keys(policy).length > 0
    ? policy
    : undefined;
}

function buildFeishuAgentBotExternalGuestPolicyFromFlags(
  flags: Record<string, string | boolean>,
): FeishuAgentBotExternalGuestPolicyInput | undefined {
  const unboundUserMode = readFeishuPolicyFlag(flags, ["unbound-user-mode", "unbound_user_mode"], [
    "ignore",
    "reply_on_mention",
    "reply_all",
    "require_identity",
  ], "feishu.agent_bot_binding.invalid_external_guest_policy");
  const guestPermissionProfile = readFeishuPolicyFlag(flags, ["guest-permission-profile", "guest_permission_profile"], [
    "none",
    "channel_context_only",
    "channel_readonly",
  ], "feishu.agent_bot_binding.invalid_external_guest_policy");
  const requireIdentityFor = readFeishuPolicyListFlag(flags, ["require-identity-for", "require_identity_for"]);
  const policy = {
    ...(unboundUserMode ? { unboundUserMode } : {}),
    ...(guestPermissionProfile ? { guestPermissionProfile } : {}),
    ...(requireIdentityFor ? { requireIdentityFor } : {}),
  };
  return Object.keys(policy).length > 0
    ? policy
    : undefined;
}

function readFeishuPolicyFlag<T extends string>(
  flags: Record<string, string | boolean>,
  keys: string[],
  allowedValues: readonly T[],
  errorCode: string,
): T | undefined {
  const value = readStringFlagByKeys(flags, keys);
  if (!value) {
    return undefined;
  }
  if (allowedValues.includes(value as T)) {
    return value as T;
  }
  throw new Error(errorCode);
}

function readFeishuPolicyListFlag(
  flags: Record<string, string | boolean>,
  keys: string[],
): string[] | undefined {
  const value = readStringFlagByKeys(flags, keys);
  if (!value) {
    return undefined;
  }
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function readStringFlagByKeys(
  flags: Record<string, string | boolean>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = getStringFlag(flags, key);
    if (value?.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function createFeishuChannelBindingForCli(
  input: {
    workspaceId: string;
    integrationId: string;
    channelName: string;
    externalChatId: string;
    externalChatType?: string;
    externalChatName?: string;
    createdByUserId?: string;
  },
  deps: {
    readIntegration?: typeof readExternalIntegrationSync;
    readChannel?: typeof readStoredChannelSync;
    readBindingByExternalChat?: typeof readExternalChannelBindingByExternalChatSync;
    upsertBinding?: typeof upsertExternalChannelBindingSync;
    auditRecorder?: typeof tryRecordWorkspaceAuditEventSync;
  } = {},
): FeishuBindingCliResult {
  const readIntegration = deps.readIntegration ?? readExternalIntegrationSync;
  const readChannel = deps.readChannel ?? readStoredChannelSync;
  const readBindingByExternalChat = deps.readBindingByExternalChat ?? readExternalChannelBindingByExternalChatSync;
  const upsertBinding = deps.upsertBinding ?? upsertExternalChannelBindingSync;
  const auditRecorder = deps.auditRecorder ?? tryRecordWorkspaceAuditEventSync;
  const integrationId = requireNonPlaceholderFeishuBindingValue(
    requireNonEmpty(input.integrationId, "feishu.integration.missing_integration_id"),
    "feishu.integration.placeholder_value",
  );
  const channelName = requireNonPlaceholderFeishuBindingValue(
    requireNonEmpty(input.channelName, "feishu.bind_channel.missing_channel"),
    "feishu.bind_channel.placeholder_value",
  );
  const externalChatId = requireNonPlaceholderFeishuBindingValue(
    requireNonEmpty(input.externalChatId, "feishu.bind_channel.missing_chat_id"),
    "feishu.bind_channel.placeholder_value",
  );
  const integration = requireActiveFeishuCliIntegration({
    workspaceId: input.workspaceId,
    integrationId,
    readIntegration,
  });
  if (!readChannel(channelName, input.workspaceId)) {
    throw new Error("feishu.bind_channel.channel_not_found");
  }
  const existingExternalChatBinding = readBindingByExternalChat({
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    externalChatId,
  });
  if (existingExternalChatBinding && existingExternalChatBinding.channelName !== channelName) {
    throw new Error("feishu.bind_channel.external_chat_taken");
  }

  const binding = upsertBinding({
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    channelName,
    externalChatId,
    externalChatType: normalizeOptionalText(input.externalChatType),
    externalChatName: normalizeOptionalText(input.externalChatName),
    status: "active",
    syncMode: "mirror",
    createdByUserId: normalizeOptionalText(input.createdByUserId),
  });
  const auditRecorded = auditRecorder({
    workspaceId: input.workspaceId,
    title: "Feishu channel binding saved from CLI",
    note: `Feishu CLI mapped AgentSpace channel "${channelName}" to a Feishu chat.`,
    code: "workspace.external_channel_binding_upserted",
    data: {
      actorType: "cli",
      resourceType: "external_channel_binding",
      resourceId: binding.id,
      provider: FEISHU_PROVIDER_ID,
      integrationId: integration.id,
      channelName: binding.channelName,
      externalIdRedacted: true,
    },
  });

  return {
    ok: true,
    kind: "channel",
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    bindingId: binding.id,
    status: binding.status,
    externalIdRedacted: true,
    auditRecorded,
    channelName: binding.channelName,
  };
}

export function buildFeishuChannelBindingsCliReport(input: {
  workspaceId: string;
  integrationId?: string;
  status?: ExternalBindingStatus;
  integrations?: ExternalIntegrationRecord[];
  channelBindingsByIntegrationId?: Record<string, ExternalChannelBindingRecord[]>;
}): FeishuChannelBindingsCliReport {
  const integrations = (input.integrations ?? listExternalIntegrationsSync({
    workspaceId: input.workspaceId,
    provider: FEISHU_PROVIDER_ID,
    includeDisabled: true,
  })).filter((integration) => !input.integrationId || integration.id === input.integrationId);
  const bindingsByIntegrationId = new Map<string, ExternalChannelBindingRecord[]>();
  for (const integration of integrations) {
    bindingsByIntegrationId.set(
      integration.id,
      input.channelBindingsByIntegrationId?.[integration.id] ?? listExternalChannelBindingsSync({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        status: input.status,
      }),
    );
  }
  const bindings = integrations.flatMap((integration) =>
    (bindingsByIntegrationId.get(integration.id) ?? []).map((binding) =>
      buildFeishuChannelBindingCliItem({
        integration,
        binding,
      })
    )
  );

  return {
    ok: true,
    workspaceId: input.workspaceId,
    ...(input.integrationId ? { integrationId: input.integrationId } : {}),
    integrationCount: integrations.length,
    bindingCount: bindings.length,
    activeBindingCount: bindings.filter((binding) => binding.status === "active").length,
    externalIdsRedacted: true,
    integrations: integrations.map((integration) => {
      const channelBindings = bindingsByIntegrationId.get(integration.id) ?? [];
      return {
        integrationId: integration.id,
        displayName: integration.displayName,
        ...(integration.agentId ? { agentId: integration.agentId } : {}),
        status: integration.status,
        bindingCount: channelBindings.length,
        activeBindingCount: channelBindings.filter((binding) => binding.status === "active").length,
      };
    }),
    bindings,
  };
}

function buildFeishuChannelBindingCliItem(input: {
  integration: ExternalIntegrationRecord;
  binding: ExternalChannelBindingRecord;
}): FeishuChannelBindingCliItem {
  const metadata = readJsonRecord(input.binding.metadataJson) ?? {};
  const provisionSource = readStringMetadata(metadata.provisionSource);
  const reviewStatus = readStringMetadata(metadata.reviewStatus);
  const agentId = readStringMetadata(metadata.agentId) ?? input.integration.agentId;
  const botBindingId = readStringMetadata(metadata.botBindingId);
  const linkedFromBindingId = readStringMetadata(metadata.linkedFromBindingId);
  const linkedFromAgentId = readStringMetadata(metadata.linkedFromAgentId);
  const linkedFromBotBindingId = readStringMetadata(metadata.linkedFromBotBindingId);
  return {
    bindingId: input.binding.id,
    integrationId: input.integration.id,
    integrationDisplayName: input.integration.displayName,
    ...(input.integration.agentId ? { integrationAgentId: input.integration.agentId } : {}),
    channelName: input.binding.channelName,
    externalChatReference: buildFeishuCliExternalReference("chat", input.binding.externalChatId),
    externalChatIdRedacted: true,
    ...(input.binding.externalChatType ? { externalChatType: input.binding.externalChatType } : {}),
    ...(input.binding.externalChatName ? { externalChatName: input.binding.externalChatName } : {}),
    status: input.binding.status,
    syncMode: input.binding.syncMode,
    ...(provisionSource ? { provisionSource } : {}),
    ...(reviewStatus ? { reviewStatus } : {}),
    ...(agentId ? { agentId } : {}),
    ...(botBindingId ? { botBindingId } : {}),
    ...(linkedFromBindingId ? { linkedFromBindingId } : {}),
    ...(linkedFromAgentId ? { linkedFromAgentId } : {}),
    ...(linkedFromBotBindingId ? { linkedFromBotBindingId } : {}),
    createdAt: input.binding.createdAt,
    updatedAt: input.binding.updatedAt,
  };
}

export function createFeishuUserBindingForCli(
  input: {
    workspaceId: string;
    integrationId: string;
    userId: string;
    externalUserId: string;
    externalUnionId?: string;
    externalOpenId?: string;
    externalEmail?: string;
    displayName?: string;
  },
  deps: {
    readIntegration?: typeof readExternalIntegrationSync;
    readMembership?: typeof readWorkspaceMembershipSync;
    readBindingByExternalUser?: typeof readExternalUserBindingByExternalUserSync;
    upsertBinding?: typeof upsertExternalUserBindingSync;
    auditRecorder?: typeof tryRecordWorkspaceAuditEventSync;
  } = {},
): FeishuBindingCliResult {
  const readIntegration = deps.readIntegration ?? readExternalIntegrationSync;
  const readMembership = deps.readMembership ?? readWorkspaceMembershipSync;
  const readBindingByExternalUser = deps.readBindingByExternalUser ?? readExternalUserBindingByExternalUserSync;
  const upsertBinding = deps.upsertBinding ?? upsertExternalUserBindingSync;
  const auditRecorder = deps.auditRecorder ?? tryRecordWorkspaceAuditEventSync;
  const integrationId = requireNonPlaceholderFeishuBindingValue(
    requireNonEmpty(input.integrationId, "feishu.integration.missing_integration_id"),
    "feishu.integration.placeholder_value",
  );
  const userId = requireNonPlaceholderFeishuBindingValue(
    requireNonEmpty(input.userId, "feishu.bind_user.missing_user_id"),
    "feishu.bind_user.placeholder_value",
  );
  const externalUserId = requireNonPlaceholderFeishuBindingValue(
    requireNonEmpty(input.externalUserId, "feishu.bind_user.missing_open_id"),
    "feishu.bind_user.placeholder_value",
  );
  const externalUnionId = validateOptionalFeishuBindingValue(
    input.externalUnionId,
    "feishu.bind_user.placeholder_value",
  );
  const externalOpenId = validateOptionalFeishuBindingValue(
    input.externalOpenId,
    "feishu.bind_user.placeholder_value",
  );
  const externalEmail = validateOptionalFeishuBindingValue(
    input.externalEmail,
    "feishu.bind_user.placeholder_value",
  );
  const integration = requireActiveFeishuCliIntegration({
    workspaceId: input.workspaceId,
    integrationId,
    readIntegration,
  });
  if (!readMembership(input.workspaceId, userId)) {
    throw new Error("feishu.bind_user.user_not_found");
  }
  const existingExternalBinding = readBindingByExternalUser({
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    externalUserId,
  });
  if (existingExternalBinding && existingExternalBinding.userId !== userId) {
    throw new Error("feishu.bind_user.external_user_taken");
  }

  const binding = upsertBinding({
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    userId,
    externalUserId,
    externalUnionId,
    externalOpenId,
    externalEmail,
    displayName: normalizeOptionalText(input.displayName),
    status: "active",
  });
  const auditRecorded = auditRecorder({
    workspaceId: input.workspaceId,
    title: "Feishu user binding saved from CLI",
    note: `Feishu CLI mapped AgentSpace user "${userId}" to a Feishu user.`,
    code: "workspace.external_user_binding_upserted",
    data: {
      actorType: "cli",
      resourceType: "external_user_binding",
      resourceId: binding.id,
      provider: FEISHU_PROVIDER_ID,
      integrationId: integration.id,
      userId: binding.userId,
      externalIdRedacted: true,
    },
  });

  return {
    ok: true,
    kind: "user",
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    bindingId: binding.id,
    status: binding.status,
    externalIdRedacted: true,
    auditRecorded,
    userId: binding.userId,
  };
}

export function createFeishuResourceBindingForCli(
  input: {
    workspaceId: string;
    integrationId: string;
    providerResourceType: string;
    resourceUrlOrToken: string;
    agentSpaceResourceType: string;
    agentSpaceResourceId?: string;
    channelName?: string;
    displayName?: string;
    allowWrite?: boolean;
    guestReadable?: boolean;
    createdByUserId?: string;
    createdBy?: string;
  },
  deps: {
    readIntegration?: typeof readExternalIntegrationSync;
    readChannel?: typeof readStoredChannelSync;
    resolveResourceDescriptor?: typeof resolveFeishuResourceDescriptorForType;
    syncChannelDocument?: typeof upsertFeishuExternalChannelDocumentSync;
    syncDataTable?: typeof upsertFeishuExternalDataTableSync;
    readBindingByResourceKey?: typeof readExternalResourceBindingByKeySync;
    upsertBinding?: typeof upsertExternalResourceBindingSync;
    auditRecorder?: typeof tryRecordWorkspaceAuditEventSync;
  } = {},
): FeishuBindingCliResult {
  const readIntegration = deps.readIntegration ?? readExternalIntegrationSync;
  const readChannel = deps.readChannel ?? readStoredChannelSync;
  const resolveResourceDescriptor = deps.resolveResourceDescriptor ?? resolveFeishuResourceDescriptorForType;
  const syncChannelDocument = deps.syncChannelDocument ?? upsertFeishuExternalChannelDocumentSync;
  const syncDataTable = deps.syncDataTable ?? upsertFeishuExternalDataTableSync;
  const readBindingByResourceKey = deps.readBindingByResourceKey ?? readExternalResourceBindingByKeySync;
  const upsertBinding = deps.upsertBinding ?? upsertExternalResourceBindingSync;
  const auditRecorder = deps.auditRecorder ?? tryRecordWorkspaceAuditEventSync;
  const integrationId = requireNonPlaceholderFeishuBindingValue(
    requireNonEmpty(input.integrationId, "feishu.integration.missing_integration_id"),
    "feishu.integration.placeholder_value",
  );
  const providerResourceType = requireNonPlaceholderFeishuBindingValue(
    requireNonEmpty(input.providerResourceType, "feishu.bind_resource.missing_type"),
    "feishu.bind_resource.placeholder_value",
  );
  const resourceUrlOrToken = requireNonPlaceholderFeishuBindingValue(
    requireNonEmpty(input.resourceUrlOrToken, "feishu.bind_resource.missing_resource"),
    "feishu.bind_resource.placeholder_value",
  );
  const integration = requireActiveFeishuCliIntegration({
    workspaceId: input.workspaceId,
    integrationId,
    readIntegration,
  });
  const descriptor = resolveResourceDescriptor(providerResourceType, resourceUrlOrToken);
  if (!descriptor) {
    throw new Error("feishu.bind_resource.invalid_resource");
  }
  const descriptorValidation = validateFeishuResourceDescriptorForBinding(descriptor);
  if (!descriptorValidation.ok) {
    throw new Error(descriptorValidation.errorCode.replace("feishu.resource_binding.", "feishu.bind_resource."));
  }
  const scopeValidation = validateFeishuResourceBindingScopes({
    providerResourceType: descriptor.providerResourceType,
    scopesJson: integration.scopesJson,
  });
  if (!scopeValidation.ok) {
    throw new Error("feishu.bind_resource.scope_missing");
  }

  const agentSpaceResourceType = requireNonEmpty(
    input.agentSpaceResourceType,
    "feishu.bind_resource.missing_agent_space_type",
  );
  if (isFeishuCliPlaceholderValue(agentSpaceResourceType)) {
    throw new Error("feishu.bind_resource.placeholder_value");
  }
  let agentSpaceResourceId = validateOptionalFeishuBindingValue(
    input.agentSpaceResourceId,
    "feishu.bind_resource.placeholder_value",
  ) ?? "";
  let channelName = validateOptionalFeishuBindingValue(
    input.channelName,
    "feishu.bind_resource.placeholder_value",
  );
  const displayName = normalizeOptionalText(input.displayName);
  if (
    !agentSpaceResourceId &&
    agentSpaceResourceType !== "channel_document" &&
    agentSpaceResourceType !== "data_table"
  ) {
    throw new Error("feishu.bind_resource.missing_agent_space_id");
  }
  if (channelName && !readChannel(channelName, input.workspaceId)) {
    throw new Error("feishu.bind_resource.channel_not_found");
  }
  const existingResourceBinding = readBindingByResourceKey({
    workspaceId: input.workspaceId,
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
      throw new Error("feishu.bind_resource.external_resource_taken");
    }
    agentSpaceResourceId = existingResourceBinding.agentSpaceResourceId;
    channelName = channelName ?? existingResourceBinding.channelName;
  }

  let metadataJson: Record<string, unknown> = descriptor.metadata ?? {};
  if (agentSpaceResourceType === "channel_document") {
    const syncedDocument = syncChannelDocument({
      channelName,
      agentSpaceResourceId,
      providerResourceType: descriptor.providerResourceType,
      providerResourceToken: descriptor.providerResourceToken,
      providerResourceUrl: descriptor.providerResourceUrl,
      title: displayName,
      createdBy: normalizeOptionalText(input.createdBy) ?? "AgentSpace CLI",
      createdByType: "human",
    }, input.workspaceId);
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
    const syncedTable = syncDataTable({
      channelName,
      agentSpaceResourceId,
      providerResourceType: descriptor.providerResourceType,
      providerResourceToken: descriptor.providerResourceToken,
      providerResourceUrl: descriptor.providerResourceUrl,
      title: displayName,
      metadata: descriptor.metadata ?? {},
      createdBy: normalizeOptionalText(input.createdBy) ?? "AgentSpace CLI",
    }, input.workspaceId);
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

  const binding = upsertBinding({
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    providerResourceType: descriptor.providerResourceType,
    providerResourceToken: descriptor.providerResourceToken,
    providerResourceUrl: descriptor.providerResourceUrl,
    agentSpaceResourceType,
    agentSpaceResourceId,
    channelName,
    displayName,
    status: "active",
    permissionsJson: buildFeishuCliResourceBindingPermissions({
      allowWrite: input.allowWrite,
      guestReadable: input.guestReadable,
    }),
    metadataJson,
    createdByUserId: normalizeOptionalText(input.createdByUserId),
  });
  const auditRecorded = auditRecorder({
    workspaceId: input.workspaceId,
    title: "Feishu resource binding saved from CLI",
    note: `Feishu CLI mapped a Feishu ${descriptor.providerResourceType} resource to AgentSpace.`,
    code: "workspace.external_resource_binding_upserted",
    data: {
      actorType: "cli",
      resourceType: "external_resource_binding",
      resourceId: binding.id,
      provider: FEISHU_PROVIDER_ID,
      integrationId: integration.id,
      providerResourceType: binding.providerResourceType,
      agentSpaceResourceType: binding.agentSpaceResourceType,
      agentSpaceResourceId: binding.agentSpaceResourceId,
      channelName: binding.channelName,
      writeAllowed: input.allowWrite === true,
      guestReadable: input.guestReadable === true,
      externalIdRedacted: true,
    },
  });

  return {
    ok: true,
    kind: "resource",
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    bindingId: binding.id,
    status: binding.status,
    externalIdRedacted: true,
    auditRecorded,
    channelName: binding.channelName,
    providerResourceType: binding.providerResourceType,
    agentSpaceResourceType: binding.agentSpaceResourceType,
    agentSpaceResourceId: binding.agentSpaceResourceId,
  };
}

function buildFeishuCliResourceBindingPermissions(input: {
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

export async function runFeishuDataOperationForCli(
  input: {
    workspaceId: string;
    integrationId: string;
    operation: string;
    providerResourceType?: string;
    resourceUrlOrToken: string;
    actorType?: string;
    actorId?: string;
    approvalAgentId?: string;
    approvalChannelName?: string;
    approvalContentPreview?: string;
    baseUrl?: string;
    parameters?: Record<string, unknown>;
  },
  deps: {
    readIntegration?: typeof readExternalIntegrationSync;
    readCredentials?: typeof readFeishuIntegrationCredentials;
    resolveResourceDescriptor?: typeof resolveFeishuResourceDescriptorForType;
    fetchTenantAccessToken?: typeof fetchFeishuTenantAccessToken;
    createClient?: typeof createFeishuApiClient;
    executeReadOperation?: typeof executeBoundFeishuReadDataOperation;
    planWriteOperation?: typeof planBoundFeishuWriteDataOperation;
    planWriteOperationWithApproval?: typeof planBoundFeishuWriteDataOperationWithApproval;
  } = {},
): Promise<FeishuDataOperationCliResult> {
  const readIntegration = deps.readIntegration ?? readExternalIntegrationSync;
  const readCredentials = deps.readCredentials ?? readFeishuIntegrationCredentials;
  const resolveResourceDescriptor = deps.resolveResourceDescriptor ?? resolveFeishuResourceDescriptorForType;
  const fetchTenantAccessToken = deps.fetchTenantAccessToken ?? fetchFeishuTenantAccessToken;
  const createClient = deps.createClient ?? createFeishuApiClient;
  const executeReadOperation = deps.executeReadOperation ?? executeBoundFeishuReadDataOperation;
  const planWriteOperation = deps.planWriteOperation ?? planBoundFeishuWriteDataOperation;
  const planWriteOperationWithApproval = deps.planWriteOperationWithApproval ?? planBoundFeishuWriteDataOperationWithApproval;
  const placeholderIssue = findFeishuCliDataOperationPlaceholderIssue(input);
  if (placeholderIssue) {
    return buildFeishuCliDataOperationPlaceholderResult(input, placeholderIssue);
  }
  const operation = resolveFeishuCliDataOperation(input.operation, input.providerResourceType);
  const integration = requireActiveFeishuCliIntegration({
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
    readIntegration,
  });
  const descriptor = resolveResourceDescriptor(
    operation.providerResourceType,
    requireNonEmpty(input.resourceUrlOrToken, "feishu.data_operation.missing_resource"),
  );
  if (!descriptor) {
    throw new Error("feishu.data_operation.invalid_resource");
  }

  const request: ExternalDataOperationRequest = {
    operationType: operation.operationType,
    providerResourceType: descriptor.providerResourceType,
    providerResourceToken: descriptor.providerResourceToken,
    actorType: parseFeishuCliDataOperationActorType(input.actorType),
    actorId: normalizeOptionalText(input.actorId),
    parameters: {
      ...(descriptor.metadata ?? {}),
      ...(operation.defaultParameters ?? {}),
      ...(input.parameters ?? {}),
    },
  };
  const sensitiveValues = [
    integration.appId,
    descriptor.providerResourceToken,
    descriptor.providerResourceUrl,
    input.resourceUrlOrToken,
    readFeishuMetadataString(request.parameters, "appToken"),
    readFeishuMetadataString(request.parameters, "baseToken"),
    readFeishuMetadataString(request.parameters, "tableId"),
  ];
  let liveApiCalled = false;

  try {
    const baseParameterIssue = findFeishuCliBaseDataOperationParameterIssue(request);
    if (baseParameterIssue) {
      throw new Error(baseParameterIssue);
    }
    const context = {
      workspaceId: input.workspaceId,
      integrationId: integration.id,
      provider: FEISHU_PROVIDER_ID,
    };
    const approvalContext = buildFeishuCliDataOperationApprovalContext(input);
    if (approvalContext && !operation.writeOperation) {
      throw new Error("feishu.data_operation_approval_requires_write_operation");
    }
    const executed = operation.writeOperation
      ? approvalContext
        ? await planWriteOperationWithApproval({
          context,
          client: createNoopFeishuCliWritePlanClient(),
          request,
          approval: approvalContext,
        })
        : await planWriteOperation({
          context,
          client: createNoopFeishuCliWritePlanClient(),
          request,
        })
      : await executeReadOperation({
        context,
        client: createLazyFeishuCliDataOperationReadClient({
          integration,
          baseUrl: input.baseUrl,
          readCredentials,
          fetchTenantAccessToken,
          createClient,
          sensitiveValues,
          onInitialize: () => {
            liveApiCalled = true;
          },
        }),
        request,
      });

    return buildFeishuDataOperationCliResult({
      workspaceId: input.workspaceId,
      integrationId: integration.id,
      request,
      result: executed.result,
      runId: executed.runId,
      resourceBindingId: executed.resourceBinding?.id,
      liveApiCalled,
      sensitiveValues,
    });
  } catch (error) {
    return {
      ok: false,
      workspaceId: input.workspaceId,
      integrationId: integration.id,
      operationType: request.operationType,
      providerResourceType: request.providerResourceType,
      externalIdRedacted: true,
      liveApiCalled,
      approvalRequired: false,
      errorCode: error instanceof Error && error.message ? error.message : "feishu.data_operation.cli_failed",
      errorMessage: sanitizeFeishuCliHealthErrorMessage(
        error instanceof Error ? error.message : String(error),
        sensitiveValues,
      ),
    };
  }
}

export async function runFeishuDataOperationApprovalReviewForCli(
  input: {
    workspaceId: string;
    approvalId: string;
    decision: string;
    reviewerComment?: string;
    baseUrl?: string;
  },
  deps: {
    reviewApproval?: typeof reviewFeishuDataOperationApproval;
  } = {},
): Promise<FeishuDataOperationApprovalReviewCliResult> {
  const approvalId = input.approvalId.trim();
  if (!approvalId) {
    return buildFeishuDataOperationApprovalReviewInputError({
      workspaceId: input.workspaceId,
      approvalId: "unknown",
      errorCode: "feishu.data_operation_review.missing_approval_id",
      errorMessage: "Feishu data-operation review requires --approval-id.",
    });
  }
  if (isFeishuCliPlaceholderValue(approvalId)) {
    return buildFeishuDataOperationApprovalReviewInputError({
      workspaceId: input.workspaceId,
      approvalId: "unknown",
      errorCode: "feishu.data_operation_review.placeholder_value",
      errorMessage: "Feishu data-operation review approval-id contains a placeholder value; replace CHANGE_ME_* placeholders before rerunning.",
    });
  }
  const decision = parseFeishuCliApprovalReviewDecisionResult(input.decision);
  if (!decision.ok) {
    return buildFeishuDataOperationApprovalReviewInputError({
      workspaceId: input.workspaceId,
      approvalId,
      errorCode: decision.errorCode,
      errorMessage: decision.errorMessage,
    });
  }
  const reviewApproval = deps.reviewApproval ?? reviewFeishuDataOperationApproval;
  try {
    const reviewed = await reviewApproval({
      workspaceId: input.workspaceId,
      approvalId,
      decision: decision.value,
      reviewerComment: normalizeOptionalText(input.reviewerComment),
      baseUrl: input.baseUrl,
    });
    const execution = reviewed.execution
      ? buildFeishuDataOperationApprovalReviewExecutionSummary(reviewed.execution)
      : undefined;
    return {
      ok: decision.value === "rejected" ? true : execution?.resultOk === true,
      workspaceId: input.workspaceId,
      approvalId,
      decision: decision.value,
      approvalStatus: reviewed.approval.status,
      externalIdRedacted: true,
      execution,
    };
  } catch (error) {
    return {
      ok: false,
      workspaceId: input.workspaceId,
      approvalId,
      decision: decision.value,
      externalIdRedacted: true,
      errorCode: error instanceof Error && error.message ? error.message : "feishu.data_operation_review.failed",
      errorMessage: sanitizeFeishuCliHealthErrorMessage(
        error instanceof Error ? error.message : String(error),
        [],
      ),
    };
  }
}

function buildFeishuDataOperationApprovalReviewInputError(input: {
  workspaceId: string;
  approvalId: string;
  errorCode: string;
  errorMessage: string;
}): FeishuDataOperationApprovalReviewCliResult {
  return {
    ok: false,
    workspaceId: input.workspaceId,
    approvalId: input.approvalId,
    externalIdRedacted: true,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  };
}

function parseFeishuCliApprovalReviewDecisionResult(value: string): {
  ok: true;
  value: "approved" | "rejected";
} | {
  ok: false;
  errorCode: string;
  errorMessage: string;
} {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_review.missing_decision",
      errorMessage: "Feishu data-operation review requires --decision approved|rejected.",
    };
  }
  if (normalized === "approved" || normalized === "approve") {
    return {
      ok: true,
      value: "approved",
    };
  }
  if (normalized === "rejected" || normalized === "reject") {
    return {
      ok: true,
      value: "rejected",
    };
  }
  return {
    ok: false,
    errorCode: "feishu.data_operation_review.invalid_decision",
    errorMessage: "Feishu data-operation review decision must be approved or rejected.",
  };
}

function buildFeishuDataOperationApprovalReviewExecutionSummary(input: {
  runId: string;
  result: ExternalDataOperationResult;
}): NonNullable<FeishuDataOperationApprovalReviewCliResult["execution"]> {
  const data = asRecord(input.result.data);
  return {
    runId: input.runId,
    resultOk: input.result.ok,
    runStatus: input.result.ok ? "succeeded" : "failed",
    errorCode: input.result.errorCode,
    errorMessage: sanitizeFeishuCliHealthErrorMessage(input.result.errorMessage, []),
    payloadHash: readStringFromRecord(data, "payloadHash"),
    responseSummary: sanitizeFeishuOperationResponseSummary(asRecord(data?.responseSummary)),
    previewSummary: summarizeFeishuCliDataOperationPreview(asRecord(data?.resultPreview)),
  };
}

function findFeishuCliDataOperationPlaceholderIssue(input: {
  integrationId: string;
  operation: string;
  providerResourceType?: string;
  resourceUrlOrToken: string;
  actorType?: string;
  actorId?: string;
  approvalAgentId?: string;
  approvalChannelName?: string;
  approvalContentPreview?: string;
  parameters?: Record<string, unknown>;
}): string | undefined {
  const candidates: Array<[string, string | undefined]> = [
    ["integration", input.integrationId],
    ["operation", input.operation],
    ["type", input.providerResourceType],
    ["resource", input.resourceUrlOrToken],
    ["actor_type", input.actorType],
    ["actor_id", input.actorId],
    ["approval_agent", input.approvalAgentId],
    ["approval_channel", input.approvalChannelName],
    ["approval_preview", input.approvalContentPreview],
  ];
  for (const [field, value] of candidates) {
    if (value && isFeishuCliPlaceholderValue(value)) {
      return field;
    }
  }
  return findFeishuCliDataOperationParameterPlaceholder(input.parameters);
}

function findFeishuCliDataOperationParameterPlaceholder(
  parameters: Record<string, unknown> | undefined,
  path = "parameters",
): string | undefined {
  if (!parameters) {
    return undefined;
  }
  for (const [key, value] of Object.entries(parameters)) {
    const fieldPath = `${path}.${key}`;
    if (typeof value === "string" && isFeishuCliPlaceholderValue(value)) {
      return fieldPath;
    }
    if (Array.isArray(value)) {
      const arrayIssue = findFeishuCliDataOperationArrayPlaceholder(value, fieldPath);
      if (arrayIssue) {
        return arrayIssue;
      }
      continue;
    }
    if (value && typeof value === "object") {
      const objectIssue = findFeishuCliDataOperationParameterPlaceholder(value as Record<string, unknown>, fieldPath);
      if (objectIssue) {
        return objectIssue;
      }
    }
  }
  return undefined;
}

function findFeishuCliDataOperationArrayPlaceholder(values: unknown[], path: string): string | undefined {
  for (const [index, value] of values.entries()) {
    const fieldPath = `${path}[${index}]`;
    if (typeof value === "string" && isFeishuCliPlaceholderValue(value)) {
      return fieldPath;
    }
    if (Array.isArray(value)) {
      const arrayIssue = findFeishuCliDataOperationArrayPlaceholder(value, fieldPath);
      if (arrayIssue) {
        return arrayIssue;
      }
      continue;
    }
    if (value && typeof value === "object") {
      const objectIssue = findFeishuCliDataOperationParameterPlaceholder(value as Record<string, unknown>, fieldPath);
      if (objectIssue) {
        return objectIssue;
      }
    }
  }
  return undefined;
}

function buildFeishuCliDataOperationApprovalContext(input: {
  approvalAgentId?: string;
  approvalChannelName?: string;
  approvalContentPreview?: string;
}): FeishuDataOperationApprovalContext | undefined {
  const agentId = normalizeOptionalText(input.approvalAgentId);
  const channelName = normalizeOptionalText(input.approvalChannelName);
  const contentPreview = normalizeOptionalText(input.approvalContentPreview);
  if (!agentId && !channelName && !contentPreview) {
    return undefined;
  }
  if (!agentId) {
    throw new Error("feishu.data_operation_approval_agent_missing");
  }
  if (!channelName) {
    throw new Error("feishu.data_operation_approval_channel_missing");
  }
  return {
    agentId,
    channelName,
    contentPreview,
  };
}

function buildFeishuCliDataOperationPlaceholderResult(
  input: {
    workspaceId: string;
    integrationId: string;
    operation: string;
    providerResourceType?: string;
  },
  fieldPath: string,
): FeishuDataOperationCliResult {
  return {
    ok: false,
    workspaceId: input.workspaceId,
    integrationId: isFeishuCliPlaceholderValue(input.integrationId) ? "unknown" : input.integrationId,
    operationType: isFeishuCliPlaceholderValue(input.operation)
      ? "unknown"
      : normalizeOptionalText(input.operation) ?? "unknown",
    providerResourceType: input.providerResourceType && !isFeishuCliPlaceholderValue(input.providerResourceType)
      ? input.providerResourceType
      : "unknown",
    externalIdRedacted: true,
    liveApiCalled: false,
    approvalRequired: false,
    errorCode: "feishu.data_operation.placeholder_value",
    errorMessage: `Feishu data-operation input ${fieldPath} contains a placeholder value; replace CHANGE_ME_* placeholders before rerunning.`,
  };
}

export function buildFeishuCliDataOperationParameters(flags: Record<string, string | boolean>): Record<string, unknown> {
  const parameters: Record<string, unknown> = {};
  copyStringFlagAsParameter(flags, parameters, "range", "range");
  copyStringFlagAsParameter(flags, parameters, "page-token", "pageToken");
  copyStringFlagAsParameter(flags, parameters, "app-token", "appToken");
  copyStringFlagAsParameter(flags, parameters, "table-id", "tableId");
  copyStringFlagAsParameter(flags, parameters, "view-id", "viewId");
  copyStringFlagAsParameter(flags, parameters, "record-id", "recordId");
  copyStringFlagAsParameter(flags, parameters, "mutation", "mutation");
  copyStringFlagAsParameter(flags, parameters, "title", "title");
  copyStringFlagAsParameter(flags, parameters, "folder-token", "folderToken");
  copyStringFlagAsParameter(flags, parameters, "parent-block-id", "parentBlockId");
  copyStringFlagAsParameter(flags, parameters, "block-id", "blockId");
  copyStringFlagAsParameter(flags, parameters, "client-token", "clientToken");
  copyStringFlagAsParameter(flags, parameters, "user-id-type", "userIdType");
  const pageSize = getOptionalNumberFlag(flags, "page-size");
  if (pageSize !== undefined) {
    parameters.pageSize = pageSize;
  }
  const documentRevisionId = getOptionalNumberFlag(flags, "document-revision-id");
  if (documentRevisionId !== undefined) {
    parameters.documentRevisionId = documentRevisionId;
  }
  const index = getOptionalNumberFlag(flags, "index");
  if (index !== undefined) {
    parameters.index = index;
  }
  copyJsonFlagAsParameter(flags, parameters, "values-json", "values");
  copyJsonFlagAsParameter(flags, parameters, "fields-json", "fields");
  copyJsonFlagAsParameter(flags, parameters, "records-json", "records");
  copyJsonFlagAsParameter(flags, parameters, "block-json", "block");
  copyJsonFlagAsParameter(flags, parameters, "body-json", "body");
  copyJsonFlagAsParameter(flags, parameters, "update-json", "update");
  copyJsonFlagAsParameter(flags, parameters, "blocks-json", "blocks");
  copyJsonFlagAsParameter(flags, parameters, "children-json", "children");
  copyJsonFlagAsParameter(flags, parameters, "requests-json", "requests");
  return parameters;
}

function findFeishuCliBaseDataOperationParameterIssue(
  request: ExternalDataOperationRequest,
): string | undefined {
  if (!request.operationType.startsWith("base.")) {
    return undefined;
  }
  if (request.providerResourceType === "base") {
    return readFeishuMetadataString(request.parameters, "tableId")
      ? undefined
      : "feishu.data_operation_base_table_id_missing";
  }
  if (request.providerResourceType !== "base_table" && request.providerResourceType !== "base_view") {
    return undefined;
  }
  const hasAppToken = Boolean(
    readFeishuMetadataString(request.parameters, "appToken") ??
      readFeishuMetadataString(request.parameters, "baseToken"),
  );
  if (!hasAppToken) {
    return "feishu.data_operation_base_app_token_missing";
  }
  if (request.providerResourceType === "base_view" && !readFeishuMetadataString(request.parameters, "tableId")) {
    return "feishu.data_operation_base_table_id_missing";
  }
  return undefined;
}

function resolveFeishuCliDataOperation(
  operation: string,
  providerResourceType?: string,
): {
  operationType: string;
  providerResourceType: string;
  writeOperation: boolean;
  defaultParameters?: Record<string, unknown>;
} {
  const normalized = requireNonEmpty(operation, "feishu.data_operation.missing_operation");
  const aliases: Record<string, {
    operationType: string;
    providerResourceType: string;
    writeOperation: boolean;
    defaultParameters?: Record<string, unknown>;
  }> = {
    "read-doc": {
      operationType: "docs.read_document",
      providerResourceType: "doc",
      writeOperation: false,
    },
    "plan-doc-create": {
      operationType: "docs.create_document",
      providerResourceType: "doc",
      writeOperation: true,
    },
    "plan-doc-update": {
      operationType: "docs.update_document",
      providerResourceType: "doc",
      writeOperation: true,
    },
    "plan-doc-append": {
      operationType: "docs.update_document",
      providerResourceType: "doc",
      writeOperation: true,
      defaultParameters: { mutation: "append_blocks" },
    },
    "read-sheet": {
      operationType: "sheets.read_range",
      providerResourceType: "sheet",
      writeOperation: false,
    },
    "query-base": {
      operationType: "base.query_records",
      providerResourceType: "base_table",
      writeOperation: false,
    },
    "read-base": {
      operationType: "base.query_records",
      providerResourceType: "base_table",
      writeOperation: false,
    },
    "plan-sheet-write": {
      operationType: "sheets.update_range",
      providerResourceType: "sheet",
      writeOperation: true,
    },
    "plan-base-update": {
      operationType: "base.mutate_records",
      providerResourceType: "base_table",
      writeOperation: true,
      defaultParameters: { mutation: "update_record" },
    },
  };
  const aliased = aliases[normalized];
  if (aliased) {
    return {
      ...aliased,
      providerResourceType: normalizeOptionalText(providerResourceType) ?? aliased.providerResourceType,
    };
  }

  const operationType = normalized;
  const inferredProviderResourceType = normalizeOptionalText(providerResourceType)
    ?? inferFeishuCliDataOperationResourceType(operationType);
  if (!inferredProviderResourceType) {
    throw new Error("feishu.data_operation.missing_type");
  }
  return {
    operationType,
    providerResourceType: inferredProviderResourceType,
    writeOperation: isFeishuCliWriteDataOperation(operationType),
  };
}

function inferFeishuCliDataOperationResourceType(operationType: string): string | undefined {
  if (operationType.startsWith("docs.")) {
    return "doc";
  }
  if (operationType.startsWith("sheets.")) {
    return "sheet";
  }
  if (operationType.startsWith("base.")) {
    return "base_table";
  }
  return undefined;
}

function isFeishuCliWriteDataOperation(operationType: string): boolean {
  return operationType === "docs.create_document" ||
    operationType === "docs.update_document" ||
    operationType === "sheets.update_range" ||
    operationType === "base.mutate_records";
}

function parseFeishuCliDataOperationActorType(value: string | undefined): ExternalDataOperationRequest["actorType"] {
  const normalized = normalizeOptionalText(value) ?? "agent";
  if (normalized === "agent" || normalized === "user" || normalized === "system") {
    return normalized;
  }
  throw new Error("feishu.data_operation.invalid_actor_type");
}

async function createFeishuCliDataOperationReadClient(input: {
  integration: ExternalIntegrationRecord;
  baseUrl?: string;
  readCredentials: typeof readFeishuIntegrationCredentials;
  fetchTenantAccessToken: typeof fetchFeishuTenantAccessToken;
  createClient: typeof createFeishuApiClient;
  sensitiveValues: Array<string | undefined>;
}): Promise<FeishuApiClient> {
  const credentials = input.readCredentials(input.integration);
  input.sensitiveValues.push(credentials.appSecret);
  const tenant = await input.fetchTenantAccessToken({
    appId: input.integration.appId ?? "",
    appSecret: credentials.appSecret,
    baseUrl: input.baseUrl,
  });
  input.sensitiveValues.push(tenant.tenantAccessToken);
  return input.createClient({
    credentials: {
      appId: input.integration.appId ?? "",
      appSecret: credentials.appSecret,
      tenantAccessToken: tenant.tenantAccessToken,
    },
    baseUrl: input.baseUrl,
  });
}

function createLazyFeishuCliDataOperationReadClient(input: {
  integration: ExternalIntegrationRecord;
  baseUrl?: string;
  readCredentials: typeof readFeishuIntegrationCredentials;
  fetchTenantAccessToken: typeof fetchFeishuTenantAccessToken;
  createClient: typeof createFeishuApiClient;
  sensitiveValues: Array<string | undefined>;
  onInitialize?: () => void;
}): FeishuApiClient {
  let clientPromise: Promise<FeishuApiClient> | undefined;
  const readClient = () => {
    if (!clientPromise) {
      input.onInitialize?.();
      clientPromise = createFeishuCliDataOperationReadClient(input);
    }
    return clientPromise;
  };
  return {
    async request<T = unknown>(request: FeishuApiRequest) {
      const client = await readClient();
      return client.request<T>(request);
    },
    async upload<T = unknown>(request: FeishuApiUploadRequest) {
      const client = await readClient();
      if (!client.upload) {
        throw new Error("feishu.data_operation.upload_unavailable");
      }
      return client.upload<T>(request);
    },
  };
}

function createNoopFeishuCliWritePlanClient(): FeishuApiClient {
  return {
    async request() {
      throw new Error("feishu.data_operation.write_plan_unexpected_api_call");
    },
  };
}

function buildFeishuDataOperationCliResult(input: {
  workspaceId: string;
  integrationId: string;
  request: ExternalDataOperationRequest;
  result: ExternalDataOperationResult;
  runId: string;
  resourceBindingId?: string;
  liveApiCalled: boolean;
  sensitiveValues: Array<string | undefined>;
}): FeishuDataOperationCliResult {
  const data = asRecord(input.result.data);
  const approvalRequired = input.result.errorCode === "feishu.data_operation_requires_approval" ||
    readStringFromRecord(data, "policyDecision") === "require_approval";
  const approvalId = readStringFromRecord(data, "approvalId");
  return {
    ok: input.result.ok || approvalRequired,
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
    operationType: input.request.operationType,
    providerResourceType: input.request.providerResourceType,
    externalIdRedacted: true,
    liveApiCalled: input.liveApiCalled,
    approvalRequired,
    ...(approvalId
      ? {
          approvalId,
          approvalStatus: approvalRequired ? "pending" : undefined,
        }
      : {}),
    runId: input.runId,
    runStatus: readStringFromRecord(data, "runStatus")
      ?? (input.result.ok ? "succeeded" : approvalRequired ? "pending" : "failed"),
    resourceBindingId: input.resourceBindingId,
    resultOk: input.result.ok,
    errorCode: input.result.errorCode,
    errorMessage: sanitizeFeishuCliHealthErrorMessage(input.result.errorMessage, input.sensitiveValues),
    payloadHash: readStringFromRecord(data, "payloadHash"),
    responseSummary: sanitizeFeishuOperationResponseSummary(asRecord(data?.responseSummary)),
    previewSummary: summarizeFeishuCliDataOperationPreview(asRecord(data?.resultPreview)),
  };
}

function summarizeFeishuCliDataOperationPreview(preview: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!preview) {
    return undefined;
  }
  const kind = readStringFromRecord(preview, "kind");
  if (kind === "doc_blocks") {
    return {
      kind,
      blockCount: readNumberFromRecord(preview, "blockCount"),
      previewBlockCount: Array.isArray(preview.blocks) ? preview.blocks.length : undefined,
    };
  }
  if (kind === "sheet_values") {
    const range = readStringFromRecord(preview, "range");
    return {
      kind,
      ...(range ? { rangeRedacted: true } : {}),
      rowCount: readNumberFromRecord(preview, "rowCount"),
      columnCount: readNumberFromRecord(preview, "columnCount"),
      previewRowCount: Array.isArray(preview.rows) ? preview.rows.length : undefined,
    };
  }
  if (kind === "base_records") {
    const records = Array.isArray(preview.records) ? preview.records : [];
    return {
      kind,
      recordCount: readNumberFromRecord(preview, "recordCount"),
      previewRecordCount: records.length,
      fieldNames: Array.from(new Set(records.flatMap((record) =>
        Object.keys(asRecord(record)?.fieldsPreview ?? {}),
      ))).sort(),
    };
  }
  return {
    kind,
    previewKeys: Object.keys(preview).sort().slice(0, 10),
  };
}

function copyStringFlagAsParameter(
  flags: Record<string, string | boolean>,
  parameters: Record<string, unknown>,
  flag: string,
  parameter: string,
): void {
  const value = normalizeOptionalText(getStringFlag(flags, flag));
  if (value) {
    parameters[parameter] = value;
  }
}

function copyJsonFlagAsParameter(
  flags: Record<string, string | boolean>,
  parameters: Record<string, unknown>,
  flag: string,
  parameter: string,
): void {
  const value = getStringFlag(flags, flag);
  if (value === undefined) {
    return;
  }
  try {
    parameters[parameter] = JSON.parse(value) as unknown;
  } catch {
    throw new Error(`feishu.data_operation.invalid_${flag.replace(/-/g, "_")}`);
  }
}

function getOptionalNumberFlag(flags: Record<string, string | boolean>, key: string): number | undefined {
  const value = getStringFlag(flags, key);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`feishu.data_operation.invalid_${key.replace(/-/g, "_")}`);
  }
  return parsed;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readStringFromRecord(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function readNumberFromRecord(value: Record<string, unknown> | undefined, key: string): number | undefined {
  const candidate = value?.[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function requireActiveFeishuCliIntegration(input: {
  workspaceId: string;
  integrationId: string;
  readIntegration: typeof readExternalIntegrationSync;
}): ExternalIntegrationRecord {
  const integration = input.readIntegration({
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
  });
  if (!integration || integration.provider !== FEISHU_PROVIDER_ID) {
    throw new Error("feishu.integration.not_found");
  }
  if (integration.status !== "active") {
    throw new Error("feishu.integration.not_active");
  }
  return integration;
}

function requireCliIntegrationId(value: string | undefined): string {
  return requireNonEmpty(value, "feishu.integration.missing_integration_id");
}

function requireStringFlagValue(input: {
  flags: Record<string, string | boolean>;
  keys: string[];
  missingCode: string;
}): string {
  for (const key of input.keys) {
    const value = normalizeOptionalText(getStringFlag(input.flags, key));
    if (value) {
      return value;
    }
  }
  throw new Error(input.missingCode);
}

function requireStringFlag(flags: Record<string, string | boolean>, key: string): string {
  return requireNonEmpty(getStringFlag(flags, key), `feishu.cli.missing_${key.replace(/-/g, "_")}`);
}

function requireStringFlagOrEnv(input: {
  flags: Record<string, string | boolean>;
  flagKeys: string[];
  envFlagKeys: string[];
  defaultEnvNames: string[];
  missingCode: string;
  env?: Record<string, string | undefined>;
}): string {
  const value = readStringFlagOrEnv(input);
  if (!value) {
    throw new Error(input.missingCode);
  }
  return value;
}

function readStringFlagOrEnv(input: {
  flags: Record<string, string | boolean>;
  flagKeys: string[];
  envFlagKeys: string[];
  defaultEnvNames: string[];
  env?: Record<string, string | undefined>;
}): string | undefined {
  const env = input.env ?? process.env;
  for (const key of input.flagKeys) {
    const value = normalizeOptionalText(getStringFlag(input.flags, key));
    if (value) {
      return value;
    }
  }
  for (const key of input.envFlagKeys) {
    const envName = normalizeOptionalText(getStringFlag(input.flags, key));
    if (!envName) {
      continue;
    }
    const value = normalizeOptionalText(env[envName]);
    if (!value) {
      throw new Error(`feishu.cli.missing_env_value:${envName}`);
    }
    return value;
  }
  for (const envName of input.defaultEnvNames) {
    const value = normalizeOptionalText(env[envName]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function parseFeishuCliEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const normalizedLine = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`feishu.cli.invalid_env_file_line:${index + 1}`);
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`feishu.cli.invalid_env_name:${index + 1}`);
    }
    values[key] = parseFeishuCliEnvFileValue(normalizedLine.slice(separatorIndex + 1).trim(), index + 1);
  }
  return values;
}

function parseFeishuCliEnvFileValue(value: string, lineNumber: number): string {
  if (!value) {
    return "";
  }
  const quote = value[0];
  if (quote === "\"" || quote === "'") {
    let escaped = false;
    let output = "";
    for (let index = 1; index < value.length; index += 1) {
      const char = value[index];
      if (escaped) {
        output += char === "n" && quote === "\"" ? "\n" : char;
        escaped = false;
        continue;
      }
      if (char === "\\" && quote === "\"") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        return output;
      }
      output += char;
    }
    throw new Error(`feishu.cli.invalid_env_file_quote:${lineNumber}`);
  }

  const commentIndex = value.indexOf(" #");
  return (commentIndex >= 0 ? value.slice(0, commentIndex) : value).trim();
}

function requireNonEmpty(value: string | undefined, errorCode: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(errorCode);
  }
  return normalized;
}

function requireNonPlaceholderFeishuCreateValue(field: string, value: string): string {
  if (isFeishuCreatePlaceholderValue(value)) {
    throw new Error(`feishu.create.placeholder_value:${field}`);
  }
  return value;
}

function requireNonPlaceholderFeishuAgentBotValue(field: string, value: string): string {
  if (isFeishuCliPlaceholderValue(value)) {
    throw new Error(`feishu.agent_bot_binding.placeholder_value:${field}`);
  }
  return value;
}

function requireNonPlaceholderFeishuBindingValue(value: string, errorCode: string): string {
  if (isFeishuCliPlaceholderValue(value)) {
    throw new Error(errorCode);
  }
  return value;
}

function validateOptionalFeishuBindingValue(value: string | undefined, errorCode: string): string | undefined {
  const normalized = normalizeOptionalText(value);
  if (normalized && isFeishuCliPlaceholderValue(normalized)) {
    throw new Error(errorCode);
  }
  return normalized;
}

function validateOptionalFeishuCreateValue(field: string, value: string | undefined): string | undefined {
  if (value && isFeishuCreatePlaceholderValue(value)) {
    throw new Error(`feishu.create.placeholder_value:${field}`);
  }
  return value;
}

function validateOptionalFeishuAgentBotValue(field: string, value: string | undefined): string | undefined {
  if (value && isFeishuCliPlaceholderValue(value)) {
    throw new Error(`feishu.agent_bot_binding.placeholder_value:${field}`);
  }
  return value;
}

function isFeishuCreatePlaceholderValue(value: string): boolean {
  return isFeishuCliPlaceholderValue(value);
}

function isFeishuCliPlaceholderValue(value: string): boolean {
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

function normalizeFeishuCreateCliError(error: unknown): Error {
  const report = buildFeishuCliCreateErrorReport(error);
  return report ? new Error(report.errorCode) : error instanceof Error ? error : new Error(String(error));
}

function buildFeishuCliCreateErrorReport(error: unknown): FeishuCliErrorReport | undefined {
  const message = error instanceof Error ? error.message : String(error);
  switch (message) {
    case "AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY is required to store Feishu credentials.":
    case "feishu.create.credential_encryption_key_missing":
      return {
        ok: false,
        errorCode: "feishu.create.credential_encryption_key_missing",
        errorMessage: "AgentSpace credential encryption key is missing.",
        nextStep: "export AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY=$(openssl rand -base64 32)",
      };
    case "AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.":
    case "feishu.create.credential_encryption_key_invalid":
      return {
        ok: false,
        errorCode: "feishu.create.credential_encryption_key_invalid",
        errorMessage: "AgentSpace credential encryption key must be a base64-encoded 32-byte key.",
        nextStep: "export AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY=$(openssl rand -base64 32)",
      };
    case "External integration app and tenant are already connected.":
    case "feishu.create.duplicate_app_tenant":
      return {
        ok: false,
        errorCode: "feishu.create.duplicate_app_tenant",
        errorMessage: "This Feishu App ID and Tenant Key are already connected to the workspace.",
      };
    case "feishu.create.missing_app_id":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu App ID is required.",
        nextStep: "Set --app-id or --app-id-env FEISHU_APP_ID.",
      };
    case "feishu.create.missing_app_secret":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu App Secret is required.",
        nextStep: "Set --app-secret or --app-secret-env FEISHU_APP_SECRET.",
      };
    case "feishu.create.missing_verification_token":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu Verification Token is required.",
        nextStep: "Set --verification-token or --verification-token-env FEISHU_VERIFICATION_TOKEN.",
      };
    case "feishu.create.invalid_transport_mode":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu transport must be http_webhook or websocket_worker.",
      };
  }

  if (message.startsWith("feishu.cli.missing_env_value:")) {
    const envName = message.slice("feishu.cli.missing_env_value:".length);
    return {
      ok: false,
      errorCode: "feishu.create.missing_env_value",
      errorMessage: `Environment variable ${envName} is not set.`,
      nextStep: `Set ${envName} or choose a different --*-env variable.`,
    };
  }
  if (message.startsWith("feishu.create.placeholder_value:")) {
    const fieldName = message.slice("feishu.create.placeholder_value:".length);
    return {
      ok: false,
      errorCode: "feishu.create.placeholder_value",
      errorMessage: `Feishu create input contains a placeholder value for ${fieldName}.`,
      nextStep: `Replace ${fieldName} with the real value from Feishu Open Platform before creating the integration.`,
    };
  }
  if (message.startsWith("feishu.cli.invalid_env_file_line:")) {
    return {
      ok: false,
      errorCode: "feishu.create.invalid_env_file",
      errorMessage: "Feishu create env file contains a line that is not KEY=value.",
    };
  }
  if (message.startsWith("feishu.cli.invalid_env_name:")) {
    return {
      ok: false,
      errorCode: "feishu.create.invalid_env_file",
      errorMessage: "Feishu create env file contains an invalid environment variable name.",
    };
  }
  if (message.startsWith("feishu.cli.invalid_env_file_quote:")) {
    return {
      ok: false,
      errorCode: "feishu.create.invalid_env_file",
      errorMessage: "Feishu create env file contains an unterminated quoted value.",
    };
  }

  return undefined;
}

export function buildFeishuCliAgentBotErrorReport(error: unknown): FeishuCliErrorReport | undefined {
  const message = error instanceof Error ? error.message : String(error);
  switch (message) {
    case "AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY is required to store Feishu credentials.":
    case "feishu.agent_bot_binding.credential_encryption_key_missing":
      return {
        ok: false,
        errorCode: "feishu.agent_bot_binding.credential_encryption_key_missing",
        errorMessage: "AgentSpace credential encryption key is missing.",
        nextStep: "export AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY=$(openssl rand -base64 32)",
      };
    case "AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.":
    case "feishu.agent_bot_binding.credential_encryption_key_invalid":
      return {
        ok: false,
        errorCode: "feishu.agent_bot_binding.credential_encryption_key_invalid",
        errorMessage: "AgentSpace credential encryption key must be a base64-encoded 32-byte key.",
        nextStep: "export AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY=$(openssl rand -base64 32)",
      };
    case "feishu.agent_bot_binding.duplicate_app_tenant":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "This Feishu App ID and Tenant Key are already connected to an AgentSpace bot binding.",
      };
    case "feishu.agent_bot_binding.duplicate_agent":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "This AgentSpace agent already has an active Feishu bot binding.",
        nextStep: "Disable or rotate the existing agent bot binding instead of creating a second active binding.",
      };
    case "feishu.agent_bot_binding.missing_agent_id":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "AgentSpace agent id or name is required.",
        nextStep: "Set --agent <agent-id-or-name>.",
      };
    case "feishu.agent_bot_binding.missing_app_id":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu App ID is required.",
        nextStep: "Set --app-id or --app-id-env FEISHU_APP_ID.",
      };
    case "feishu.agent_bot_binding.missing_app_secret":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu App Secret is required.",
        nextStep: "Set --app-secret or --app-secret-env FEISHU_APP_SECRET.",
      };
    case "feishu.agent_bot_binding.missing_verification_token":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu Verification Token is required for EventCallback mode.",
        nextStep: "Use default WebSocket worker mode or set --verification-token.",
      };
    case "feishu.agent_bot_binding.invalid_transport_mode":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu agent bot transport must be http_webhook or websocket_worker.",
      };
    case "feishu.agent_bot_binding.invalid_channel_auto_provisioning_policy":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu agent bot auto-provisioning policy is invalid.",
        nextStep: "Use --bot-added-policy auto_create_channel|pending_admin_review|disabled and --first-message-policy auto_create_if_bot_mentioned|pending_admin_review|reply_with_setup_card|disabled.",
      };
    case "feishu.agent_bot_binding.invalid_external_guest_policy":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu agent bot external guest policy is invalid.",
        nextStep: "Use --unbound-user-mode ignore|reply_on_mention|reply_all|require_identity and --guest-permission-profile none|channel_context_only|channel_readonly.",
      };
    case "feishu.agent_bot_binding.not_found":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu agent bot binding was not found.",
        nextStep: "Pass --agent <agent-id-or-name> or --integration <integration-id> for an existing agent bot binding.",
      };
  }

  if (message.startsWith("feishu.cli.missing_env_value:")) {
    const envName = message.slice("feishu.cli.missing_env_value:".length);
    return {
      ok: false,
      errorCode: "feishu.agent_bot_binding.missing_env_value",
      errorMessage: `Environment variable ${envName} is not set.`,
      nextStep: `Set ${envName} or choose a different --*-env variable.`,
    };
  }
  if (message.startsWith("feishu.agent_bot_binding.placeholder_value:")) {
    const fieldName = message.slice("feishu.agent_bot_binding.placeholder_value:".length);
    return {
      ok: false,
      errorCode: "feishu.agent_bot_binding.placeholder_value",
      errorMessage: `Feishu agent bot input contains a placeholder value for ${fieldName}.`,
      nextStep: `Replace ${fieldName} with the real value from Feishu Open Platform before binding the bot.`,
    };
  }
  if (message.startsWith("feishu.cli.invalid_env_file_line:")) {
    return {
      ok: false,
      errorCode: "feishu.agent_bot_binding.invalid_env_file",
      errorMessage: "Feishu agent bot env file contains a line that is not KEY=value.",
    };
  }
  if (message.startsWith("feishu.cli.invalid_env_name:")) {
    return {
      ok: false,
      errorCode: "feishu.agent_bot_binding.invalid_env_file",
      errorMessage: "Feishu agent bot env file contains an invalid environment variable name.",
    };
  }
  if (message.startsWith("feishu.cli.invalid_env_file_quote:")) {
    return {
      ok: false,
      errorCode: "feishu.agent_bot_binding.invalid_env_file",
      errorMessage: "Feishu agent bot env file contains an unterminated quoted value.",
    };
  }

  return undefined;
}

export function buildFeishuCliBindingErrorReport(error: unknown): FeishuCliErrorReport | undefined {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("feishu.cli.missing_")) {
    const flagName = message.slice("feishu.cli.missing_".length).replace(/_/g, "-");
    return {
      ok: false,
      errorCode: message,
      errorMessage: `Missing required Feishu binding flag --${flagName}.`,
      nextStep: `Rerun the bind command with --${flagName}.`,
    };
  }

  switch (message) {
    case "feishu.integration.missing_integration_id":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu integration id is required.",
        nextStep: "Pass --integration <id> or set AGENT_SPACE_FEISHU_INTEGRATION_ID.",
      };
    case "feishu.integration.not_found":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu integration was not found in this workspace.",
        nextStep: "Run agent-space integrations feishu create or check --workspace-id / --integration.",
      };
    case "feishu.integration.not_active":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu integration is not active.",
        nextStep: "Resume the Feishu integration before creating bindings.",
      };
    case "feishu.integration.placeholder_value":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu integration id still contains a placeholder value.",
        nextStep: "Replace the generated CHANGE_ME_* placeholder with an existing Feishu integration id before rerunning the binding command.",
      };
    case "feishu.bindings.invalid_status":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu binding status filter is invalid.",
        nextStep: "Pass --status active, --status disabled, or --status archived.",
      };
    case "feishu.bind_channel.placeholder_value":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu channel binding input contains a placeholder value.",
        nextStep: "Replace the generated CHANGE_ME_* placeholders with a real AgentSpace channel and Feishu chat id.",
      };
    case "feishu.bind_channel.missing_channel":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "AgentSpace channel name is required.",
        nextStep: "Pass --channel <channel-name>.",
      };
    case "feishu.bind_channel.missing_chat_id":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu chat id is required.",
        nextStep: "Pass --chat-id <feishu-chat-id> from an unbound event suggestion.",
      };
    case "feishu.bind_channel.channel_not_found":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "AgentSpace channel was not found.",
        nextStep: "Create the AgentSpace channel first or pass a different --channel value.",
      };
    case "feishu.bind_channel.external_chat_taken":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "This Feishu chat is already mapped to another AgentSpace channel.",
        nextStep: "Have a workspace admin review or revoke the existing Feishu channel binding before retrying.",
      };
    case "feishu.bind_user.missing_user_id":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "AgentSpace user id is required.",
        nextStep: "Pass --user-id <agent-space-user-id>.",
      };
    case "feishu.bind_user.missing_open_id":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu Open ID is required.",
        nextStep: "Pass --open-id <feishu-open-id> from an unbound event suggestion.",
      };
    case "feishu.bind_user.user_not_found":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "AgentSpace workspace user was not found.",
        nextStep: "Invite the user to the AgentSpace workspace before binding their Feishu identity.",
      };
    case "feishu.bind_user.external_user_taken":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "This Feishu Open ID is already bound to another AgentSpace user.",
        nextStep: "Have a workspace admin review or revoke the existing Feishu user binding before retrying.",
      };
    case "feishu.bind_user.placeholder_value":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu user binding input contains a placeholder value.",
        nextStep: "Replace the generated CHANGE_ME_* placeholders with a real AgentSpace user id and Feishu Open ID.",
      };
    case "feishu.bind_resource.missing_type":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu resource type is required.",
        nextStep: "Pass --type doc|sheet|base|base_table|base_view.",
      };
    case "feishu.bind_resource.missing_resource":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu resource URL or token is required.",
        nextStep: "Pass --resource <doc-url|sheet-url|base-table-url-with-app-token>.",
      };
    case "feishu.bind_resource.invalid_resource":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu resource URL or token could not be recognized.",
        nextStep: "Use a supported Feishu Doc, Sheet, Base app/table, or Base view URL/token.",
      };
    case "feishu.bind_resource.base_app_token_missing":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu Base table/view binding requires a Base app token.",
        nextStep: "Pass --resource <base-table-url-with-app-token>; a raw table/view id is not enough for AgentSpace data-plane governance.",
      };
    case "feishu.bind_resource.base_table_id_missing":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu Base view binding requires table context.",
        nextStep: "Pass a Base view URL that includes both table=... and view=....",
      };
    case "feishu.bind_resource.scope_missing":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu integration is missing the Docs / Sheets / Base scopes required for this resource binding.",
        nextStep: "Enable the required Feishu Open Platform scopes, install/publish the app, run health-check, then rerun bind-resource.",
      };
    case "feishu.bind_resource.placeholder_value":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "Feishu resource binding input contains a placeholder value.",
        nextStep: "Replace the generated CHANGE_ME_* placeholders with a real Feishu resource URL/token and AgentSpace target.",
      };
    case "feishu.bind_resource.missing_agent_space_type":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "AgentSpace resource type is required.",
        nextStep: "Pass --agent-space-type channel_document|data_table|knowledge_page.",
      };
    case "feishu.bind_resource.missing_agent_space_id":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "AgentSpace resource id is required for this resource type.",
        nextStep: "Pass --agent-space-id <id>, or use channel_document/data_table with --channel to let AgentSpace create the local resource.",
      };
    case "feishu.bind_resource.channel_not_found":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "AgentSpace channel for the resource binding was not found.",
        nextStep: "Create the AgentSpace channel first or pass a different --channel value.",
      };
    case "feishu.bind_resource.external_resource_taken":
      return {
        ok: false,
        errorCode: message,
        errorMessage: "This Feishu resource is already bound to another AgentSpace resource.",
        nextStep: "Have a workspace admin review or archive the existing Feishu resource binding before retrying.",
      };
  }

  return undefined;
}

function parseFeishuCliTransportMode(value: string | undefined): ExternalIntegrationTransportMode {
  const normalized = normalizeOptionalText(value) ?? "http_webhook";
  if (normalized === "http_webhook" || normalized === "http-webhook" || normalized === "webhook" || normalized === "http") {
    return "http_webhook";
  }
  if (
    normalized === "websocket_worker" ||
    normalized === "websocket-worker" ||
    normalized === "websocket" ||
    normalized === "worker"
  ) {
    return "websocket_worker";
  }
  throw new Error("feishu.create.invalid_transport_mode");
}

function parseFeishuAgentBotCliTransportMode(value: string | undefined): ExternalIntegrationTransportMode {
  try {
    return parseFeishuCliTransportMode(value ?? "websocket_worker");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "feishu.create.invalid_transport_mode") {
      throw new Error("feishu.agent_bot_binding.invalid_transport_mode");
    }
    throw error;
  }
}

function parseFeishuBindingStatusFlag(value: string | undefined): ExternalBindingStatus | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized === "active" || normalized === "disabled" || normalized === "archived") {
    return normalized;
  }
  throw new Error("feishu.bindings.invalid_status");
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function buildFeishuReadinessReport(input: BuildFeishuReadinessReportInput): FeishuReadinessReport {
  const requiredReadiness = input.requiredReadiness ?? "bot";
  const integrations = (input.integrations ?? listExternalIntegrationsSync({
    workspaceId: input.workspaceId,
    provider: FEISHU_PROVIDER_ID,
    includeDisabled: true,
  })).filter((integration) =>
    (!input.integrationId || integration.id === input.integrationId) &&
    (!input.agentId || integration.agentId === input.agentId) &&
    (!input.agentOnly || Boolean(integration.agentId))
  );

  const readinessItems = integrations.map((integration) => {
    const channelBindings = input.channelBindingsByIntegrationId?.[integration.id]
      ?? listExternalChannelBindingsSync({ workspaceId: input.workspaceId, integrationId: integration.id });
    const userBindings = input.userBindingsByIntegrationId?.[integration.id]
      ?? listExternalUserBindingsSync({ workspaceId: input.workspaceId, integrationId: integration.id });
    const resourceBindings = input.resourceBindingsByIntegrationId?.[integration.id]
      ?? listExternalResourceBindingsSync({ workspaceId: input.workspaceId, integrationId: integration.id });
    const failedOutbox = input.failedOutboxByIntegrationId?.[integration.id]
      ?? listExternalMessageOutboxSync({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        status: "failed",
        limit: 20,
      });
    const pendingOutbox = input.pendingOutboxByIntegrationId?.[integration.id]
      ?? listExternalMessageOutboxSync({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        status: "pending",
        limit: 20,
      }).filter((item) => Boolean(item.lastError));
    return buildFeishuIntegrationReadiness({
      integration,
      channelBindings,
      userBindings,
      resourceBindings,
      failedOutbox,
      pendingOutbox,
    });
  });

  return {
    workspaceId: input.workspaceId,
    requiredReadiness,
    integrationCount: readinessItems.length,
    readyForBotSmokeCount: readinessItems.filter((item) => item.readyForBotSmoke).length,
    readyForDataPlaneSmokeCount: readinessItems.filter((item) => item.readyForDataPlaneSmoke).length,
    readyForWorkerSmokeCount: readinessItems.filter((item) => item.readyForWorkerSmoke).length,
    strictSatisfied: readinessItems.some((item) => isFeishuReadinessSatisfied(item, requiredReadiness)),
    integrations: readinessItems,
  };
}

export async function runFeishuHealthCheckCli(input: {
  workspaceId: string;
  integrationId?: string;
  agentId?: string;
  agentOnly?: boolean;
  baseUrl?: string;
  persist?: boolean;
  integrations?: ExternalIntegrationRecord[];
  healthChecker?: (input: {
    appId: string;
    appSecret: string;
    baseUrl?: string;
  }) => Promise<FeishuHealthCheckResult>;
  readCredentials?: typeof readFeishuIntegrationCredentials;
  updateHealth?: typeof updateExternalIntegrationHealthSync;
}): Promise<FeishuHealthCheckCliReport> {
  const integrations = (input.integrations ?? listExternalIntegrationsSync({
    workspaceId: input.workspaceId,
    provider: FEISHU_PROVIDER_ID,
    includeDisabled: true,
  })).filter((integration) =>
    (!input.integrationId || integration.id === input.integrationId) &&
    (!input.agentId || integration.agentId === input.agentId) &&
    (!input.agentOnly || Boolean(integration.agentId))
  );
  const healthChecker = input.healthChecker ?? checkFeishuIntegrationHealth;
  const readCredentials = input.readCredentials ?? readFeishuIntegrationCredentials;
  const updateHealth = input.updateHealth ?? updateExternalIntegrationHealthSync;
  const persist = input.persist !== false;
  const results: FeishuHealthCheckCliItem[] = [];

  for (const integration of integrations) {
    const credentials = readCredentials(integration);
    const health = await healthChecker({
      appId: integration.appId ?? "",
      appSecret: credentials.appSecret,
      baseUrl: input.baseUrl,
    });
    const errorMessage = sanitizeFeishuCliHealthErrorMessage(health.errorMessage, [
      integration.appId,
      credentials.appSecret,
    ]);
    if (persist) {
      updateHealth({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        lastHealthStatus: health.status,
        lastError: errorMessage,
        configJson: buildFeishuHealthSnapshotConfigJson({
          configJson: integration.configJson,
          health,
        }),
      });
    }
    results.push(buildFeishuHealthCheckCliItem({
      integration,
      health,
      errorMessage,
      persisted: persist,
    }));
  }

  return {
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
    agentId: input.agentId,
    agentOnly: input.agentOnly,
    integrationCount: integrations.length,
    checkedCount: results.length,
    healthyCount: results.filter((item) => item.status === "healthy").length,
    degradedCount: results.filter((item) => item.status === "degraded").length,
    errorCount: results.filter((item) => item.status === "error").length,
    strictSatisfied: results.length > 0 && results.every((item) => item.status === "healthy"),
    persisted: persist,
    results,
  };
}

export function buildFeishuEvidenceReport(input: BuildFeishuEvidenceReportInput): FeishuEvidenceReport {
  const requiredEvidence = input.requiredEvidence ?? "bot";
  const integrations = (input.integrations ?? listExternalIntegrationsSync({
    workspaceId: input.workspaceId,
    provider: FEISHU_PROVIDER_ID,
    includeDisabled: true,
  })).filter((integration) => !input.integrationId || integration.id === input.integrationId);
  const evidenceItems = integrations.map((integration) => {
    const events = input.eventsByIntegrationId?.[integration.id] ?? listExternalIntegrationEventsSync({
      workspaceId: input.workspaceId,
      integrationId: integration.id,
      provider: FEISHU_PROVIDER_ID,
      limit: 100,
    });
    const outbox = input.outboxByIntegrationId?.[integration.id] ?? listExternalMessageOutboxSync({
      workspaceId: input.workspaceId,
      integrationId: integration.id,
      limit: 100,
    });
    const messageMappings = input.messageMappingsByIntegrationId?.[integration.id] ?? listExternalMessageMappingsSync({
      workspaceId: input.workspaceId,
      integrationId: integration.id,
      limit: 100,
    });
    const channelBindings = input.channelBindingsByIntegrationId?.[integration.id] ?? listExternalChannelBindingsSync({
      workspaceId: input.workspaceId,
      integrationId: integration.id,
    });
    const threadBindings = input.threadBindingsByIntegrationId?.[integration.id] ??
      listExternalThreadBindingsSync({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        provider: FEISHU_PROVIDER_ID,
        limit: 100,
      });
    const dataOperations = input.dataOperationsByIntegrationId?.[integration.id] ??
      listExternalDataOperationRunsSync({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        limit: 100,
      });
    return buildFeishuIntegrationEvidence({
      workspaceId: input.workspaceId,
      integration,
      events,
      messageMappings,
      outbox,
      channelBindings,
      threadBindings,
      dataOperations,
    });
  });
  const agentSpaceStrictSatisfied = evidenceItems.some((item) => isFeishuEvidenceSatisfied(item, requiredEvidence));
  const expectedCallbackRouteProof = input.integrationId
    ? buildFeishuExpectedCallbackRouteProof({
      workspaceId: input.workspaceId,
      integrationId: input.integrationId,
    })
    : undefined;
  const openApiEvidence = input.openApiEvidencePath || input.openApiEvidence !== undefined
    ? verifyFeishuOpenApiSmokeEvidence({
      evidencePath: input.openApiEvidencePath,
      evidence: input.openApiEvidence,
      expectedCallbackRouteProof,
      remediationContext: {
        workspaceId: input.workspaceId,
        integrationId: input.integrationId,
      },
    })
    : undefined;

  return {
    workspaceId: input.workspaceId,
    requiredEvidence,
    integrationCount: integrations.length,
    strictSatisfied: agentSpaceStrictSatisfied && (!openApiEvidence || openApiEvidence.valid),
    ...(openApiEvidence ? { openApiEvidence } : {}),
    summary: {
      botSatisfiedCount: evidenceItems.filter((item) => item.bot.satisfied).length,
      nativeExperienceSatisfiedCount: evidenceItems.filter((item) => item.nativeExperience.satisfied).length,
      guestPolicySatisfiedCount: evidenceItems.filter((item) => item.guestPolicy.satisfied).length,
      dataPlaneSatisfiedCount: evidenceItems.filter((item) => item.dataPlane.satisfied).length,
      workerSatisfiedCount: evidenceItems.filter((item) => item.worker.satisfied).length,
      failureVisibleCount: evidenceItems.filter((item) => item.failureVisibility.satisfied).length,
    },
    integrations: evidenceItems,
  };
}

export function buildFeishuSmokeEnvTemplateReport(
  input: BuildFeishuSmokeEnvTemplateReportInput,
): FeishuSmokeEnvTemplateReport {
  const integrations = (input.integrations ?? listExternalIntegrationsSync({
    workspaceId: input.workspaceId,
    provider: FEISHU_PROVIDER_ID,
    includeDisabled: true,
  })).filter((integration) => !input.integrationId || integration.id === input.integrationId);
  const selectedIntegration = integrations.find((integration) => integration.status === "active") ?? integrations[0];
  const appUrl = normalizeFeishuCliPublicAppUrl(input.appUrl);
  const callbackUrl = selectedIntegration && appUrl
    ? buildFeishuCliEventCallbackUrl({
      appUrl,
      workspaceId: input.workspaceId,
      integrationId: selectedIntegration.id,
    })
    : "CHANGE_ME_AGENTSPACE_CALLBACK_URL";
  const appId = selectedIntegration?.appId?.trim();
  const issues = [
    ...(integrations.length === 0 ? ["integration_missing"] : []),
    ...(selectedIntegration && selectedIntegration.status !== "active" ? ["selected_integration_not_active"] : []),
    ...(selectedIntegration && !appId ? ["app_id_missing"] : []),
    ...(!appUrl ? ["app_url_missing"] : []),
  ];

  return {
    workspaceId: input.workspaceId,
    integrationCount: integrations.length,
    selectedIntegrationId: selectedIntegration?.id,
    appUrl,
    envFilePath: "scripts/feishu/.env",
    issues,
    entries: [
      {
        key: "FEISHU_APP_ID",
        value: appId || "CHANGE_ME_FEISHU_APP_ID",
        secret: false,
        required: true,
        source: appId ? "integration" : "placeholder",
      },
      {
        key: "FEISHU_APP_SECRET",
        value: "CHANGE_ME_FEISHU_APP_SECRET",
        secret: true,
        required: true,
        source: "placeholder",
        note: "Fill from Feishu developer console; AgentSpace never prints saved app secrets.",
      },
      {
        key: "FEISHU_VERIFICATION_TOKEN",
        value: "CHANGE_ME_FEISHU_VERIFICATION_TOKEN",
        secret: true,
        required: true,
        source: "placeholder",
        note: "Use the same verification token saved on the AgentSpace integration.",
      },
      {
        key: "FEISHU_ENCRYPT_KEY",
        value: "CHANGE_ME_FEISHU_ENCRYPT_KEY",
        secret: true,
        required: false,
        source: "placeholder",
        note: "Use when Feishu event encryption is enabled; create can read it via --encrypt-key-env.",
      },
      {
        key: "FEISHU_SECOND_AGENT_APP_ID",
        value: "CHANGE_ME_SECOND_AGENT_APP_ID",
        secret: false,
        required: false,
        source: "placeholder",
        note: "Optional for isolated OpenAPI smoke; required for TODO120 Phase 6 multi-agent smoke as the second disposable Feishu app id.",
      },
      {
        key: "FEISHU_SECOND_AGENT_APP_SECRET",
        value: "CHANGE_ME_SECOND_AGENT_APP_SECRET",
        secret: true,
        required: false,
        source: "placeholder",
        note: "Optional for isolated OpenAPI smoke; required for TODO120 Phase 6 multi-agent smoke as the second Feishu app secret.",
      },
      {
        key: "FEISHU_API_BASE_URL",
        value: process.env.AGENT_SPACE_FEISHU_API_BASE_URL?.trim() || "https://open.feishu.cn",
        secret: false,
        required: false,
        source: process.env.AGENT_SPACE_FEISHU_API_BASE_URL?.trim() ? "env" : "placeholder",
      },
      {
        key: "FEISHU_SMOKE_CALLBACK_URL",
        value: callbackUrl,
        secret: false,
        required: true,
        source: appUrl && selectedIntegration ? "app-url" : "placeholder",
        note: "Generated from --app-url/AGENT_SPACE_APP_URL plus workspace/integration ids.",
      },
      {
        key: "FEISHU_SMOKE_CHAT_ID",
        value: "CHANGE_ME_FEISHU_CHAT_ID",
        secret: false,
        required: true,
        source: "placeholder",
      },
      {
        key: "FEISHU_SMOKE_DOC_TOKEN",
        value: "CHANGE_ME_DOCX_TOKEN",
        secret: false,
        required: true,
        source: "placeholder",
      },
      {
        key: "FEISHU_SMOKE_DOC_PARENT_BLOCK_ID",
        value: "CHANGE_ME_DOCX_PARENT_BLOCK_ID",
        secret: false,
        required: true,
        source: "placeholder",
      },
      {
        key: "FEISHU_SMOKE_DOC_APPEND_BLOCKS_JSON",
        value: "[{\"block_type\":2,\"text\":{\"elements\":[{\"text_run\":{\"content\":\"AgentSpace smoke\"}}]}}]",
        secret: false,
        required: true,
        source: "placeholder",
      },
      {
        key: "FEISHU_SMOKE_SHEET_TOKEN",
        value: "CHANGE_ME_SHEET_TOKEN",
        secret: false,
        required: true,
        source: "placeholder",
      },
      {
        key: "FEISHU_SMOKE_SHEET_RANGE",
        value: "Sheet1!A1:B2",
        secret: false,
        required: false,
        source: "placeholder",
        note: "Optional sheet read range; strict live smoke defaults to this range when unset.",
      },
      {
        key: "FEISHU_SMOKE_SHEET_WRITE_RANGE",
        value: "Sheet1!A1:B1",
        secret: false,
        required: true,
        source: "placeholder",
      },
      {
        key: "FEISHU_SMOKE_SHEET_WRITE_VALUES_JSON",
        value: "[[\"AgentSpace smoke\"]]",
        secret: false,
        required: true,
        source: "placeholder",
      },
      {
        key: "FEISHU_SMOKE_BASE_APP_TOKEN",
        value: "CHANGE_ME_BASE_APP_TOKEN",
        secret: false,
        required: true,
        source: "placeholder",
      },
      {
        key: "FEISHU_SMOKE_BASE_TABLE_ID",
        value: "CHANGE_ME_BASE_TABLE_ID",
        secret: false,
        required: true,
        source: "placeholder",
      },
      {
        key: "FEISHU_SMOKE_BASE_RECORD_ID",
        value: "CHANGE_ME_BASE_RECORD_ID",
        secret: false,
        required: true,
        source: "placeholder",
      },
      {
        key: "FEISHU_SMOKE_BASE_UPDATE_FIELDS_JSON",
        value: "{\"Smoke\":\"AgentSpace\"}",
        secret: false,
        required: true,
        source: "placeholder",
      },
    ],
  };
}

interface FeishuDataPlaneSmokeCommands {
  liveDocReadCommand: string;
  liveDocWriteCommand: string;
  liveSheetReadCommand: string;
  liveSheetWriteCommand: string;
  liveBaseCommand: string;
}

function buildFeishuDataPlaneSmokeCommands(input: {
  workspaceId: string;
  integrationId: string;
}): FeishuDataPlaneSmokeCommands {
  const reviewDataOperationCommand = `agent-space integrations feishu review-data-operation --workspace-id ${input.workspaceId} --approval-id ${FEISHU_CLI_PLACEHOLDERS.approvalId} --decision approved --json`;
  return {
    liveDocReadCommand: `agent-space integrations feishu data-operation --workspace-id ${input.workspaceId} --integration ${input.integrationId} --operation read-doc --resource ${FEISHU_CLI_PLACEHOLDERS.docResource} --json`,
    liveDocWriteCommand: [
      `agent-space integrations feishu data-operation --workspace-id ${input.workspaceId} --integration ${input.integrationId} --operation plan-doc-append --resource ${FEISHU_CLI_PLACEHOLDERS.docResource} --parent-block-id ${FEISHU_CLI_PLACEHOLDERS.docBlockId} --blocks-json '[{"block_type":2,"text":{"elements":[{"text_run":{"content":"AgentSpace smoke"}}]}}]' --approval-agent ${FEISHU_CLI_PLACEHOLDERS.agentName} --approval-channel ${FEISHU_CLI_PLACEHOLDERS.agentSpaceChannel} --json`,
      reviewDataOperationCommand,
    ].join("\n"),
    liveSheetReadCommand: `agent-space integrations feishu data-operation --workspace-id ${input.workspaceId} --integration ${input.integrationId} --operation read-sheet --resource ${FEISHU_CLI_PLACEHOLDERS.sheetResource} --range ${FEISHU_CLI_PLACEHOLDERS.sheetRange} --json`,
    liveSheetWriteCommand: [
      `agent-space integrations feishu data-operation --workspace-id ${input.workspaceId} --integration ${input.integrationId} --operation plan-sheet-write --resource ${FEISHU_CLI_PLACEHOLDERS.sheetResource} --range ${FEISHU_CLI_PLACEHOLDERS.sheetWriteRange} --values-json '[["AgentSpace smoke"]]' --approval-agent ${FEISHU_CLI_PLACEHOLDERS.agentName} --approval-channel ${FEISHU_CLI_PLACEHOLDERS.agentSpaceChannel} --json`,
      reviewDataOperationCommand,
    ].join("\n"),
    liveBaseCommand: [
      `agent-space integrations feishu data-operation --workspace-id ${input.workspaceId} --integration ${input.integrationId} --operation query-base --resource ${FEISHU_CLI_PLACEHOLDERS.baseResource} --json`,
      `agent-space integrations feishu data-operation --workspace-id ${input.workspaceId} --integration ${input.integrationId} --operation plan-base-update --resource ${FEISHU_CLI_PLACEHOLDERS.baseResource} --record-id ${FEISHU_CLI_PLACEHOLDERS.baseRecordId} --fields-json '{"Smoke":"AgentSpace"}' --approval-agent ${FEISHU_CLI_PLACEHOLDERS.agentName} --approval-channel ${FEISHU_CLI_PLACEHOLDERS.agentSpaceChannel} --json`,
      reviewDataOperationCommand,
    ].join("\n"),
  };
}

export function buildFeishuSmokePlanReport(input: BuildFeishuSmokePlanReportInput): FeishuSmokePlanReport {
  const readiness = buildFeishuReadinessReport(input);
  const botCandidate = selectFeishuReadinessCandidate(readiness.integrations, "bot");
  const dataPlaneCandidate = selectFeishuReadinessCandidate(readiness.integrations, "data-plane");
  const workerCandidate = selectFeishuReadinessCandidate(readiness.integrations, "worker");
  const setupCandidate = botCandidate ?? dataPlaneCandidate ?? readiness.integrations[0];
  const hasIntegration = readiness.integrationCount > 0;
  const hasConfiguredAppCredentials = readiness.integrations.some((item) =>
    item.appConfigured && item.credentialsConfigured
  );
  const hasHealthChecked = readiness.integrations.some((item) => item.healthStatus !== "unknown");
  const hasBotAndDataPlaneScopes = readiness.integrations.some((item) =>
    item.scopes.missingForBotSmoke.length === 0 &&
    item.scopes.missingForDataPlaneSmoke.length === 0
  );
  const hasChannelBinding = readiness.integrations.some((item) => item.channelBindings.active > 0);
  const hasUserBinding = readiness.integrations.some((item) => item.userBindings.active > 0);
  const hasAnyDocBinding = readiness.integrations.some((item) => item.resourceBindings.doc > 0);
  const hasDocBinding = readiness.integrations.some((item) => item.resourceBindings.docWritable > 0);
  const hasAnySheetBinding = readiness.integrations.some((item) => item.resourceBindings.sheet > 0);
  const hasSheetBinding = readiness.integrations.some((item) => item.resourceBindings.sheetWritable > 0);
  const hasAnyBaseBinding = readiness.integrations.some((item) => item.resourceBindings.base > 0);
  const hasBaseReadyBinding = readiness.integrations.some((item) => item.resourceBindings.baseReady > 0);
  const hasBaseBinding = readiness.integrations.some((item) => item.resourceBindings.baseWritable > 0);
  const readyForBot = readiness.readyForBotSmokeCount > 0;
  const readyForDataPlane = readiness.readyForDataPlaneSmokeCount > 0;
  const agentBotIntegrationCount = readiness.integrations.filter((item) => item.agentId).length;
  const hasSecondAgentBot = agentBotIntegrationCount >= 2;
  const webSocketCandidate = workerCandidate?.transportMode === "websocket_worker"
    ? workerCandidate
    : readiness.integrations.find((item) => item.transportMode === "websocket_worker");
  const readyForWorkerSmoke = readiness.readyForWorkerSmokeCount > 0;
  const botIssues = botCandidate?.issues ?? [];
  const dataPlaneIssues = dataPlaneCandidate?.issues ?? [];
  const workerIssues = readyForWorkerSmoke
    ? []
    : buildFeishuWorkerSmokeIssues(webSocketCandidate, botIssues);
  const missingBotScopes = uniqueStrings(readiness.integrations.flatMap((item) => item.scopes.missingForBotSmoke));
  const missingDataPlaneScopes = uniqueStrings(readiness.integrations.flatMap((item) =>
    item.scopes.missingForDataPlaneSmoke
  ));
  const smokeHarness = buildFeishuSmokeHarnessSummary({
    workspaceId: readiness.workspaceId,
    integrationId: setupCandidate?.id,
    appUrl: input.appUrl,
  });
  const appSetup = buildFeishuOpenPlatformSetupSummary({
    hasIntegration,
    hasAppUrl: Boolean(smokeHarness.appUrl),
    callbackUrl: smokeHarness.callbackUrl,
    requiredCredentialFields: resolveFeishuCliOpenPlatformRequiredCredentialFields(setupCandidate),
  });
  const runtimeSetup = buildFeishuRuntimeSetupSummary(input.runtimeEnv);
  const workerHarness = buildFeishuWorkerHarnessSummary({
    workspaceId: readiness.workspaceId,
    integrationId: webSocketCandidate?.id,
  });
  const setupIntegrationFlag = setupCandidate?.id ?? FEISHU_CLI_PLACEHOLDERS.integrationId;
  const credentialEncryptionReady = runtimeSetup.credentialEncryption.status === "ready";
  const credentialEncryptionIssues = credentialEncryptionReady
    ? []
    : [runtimeSetup.credentialEncryption.issue ?? `credential_encryption_${runtimeSetup.credentialEncryption.status}`];
  const evidenceGates = buildFeishuSmokePlanEvidenceGates({
    hasWebSocketIntegration: readiness.integrations.some((item) => item.transportMode === "websocket_worker"),
    openApiEvidencePath: smokeHarness.evidencePath,
  });
  const dataPlaneIntegrationFlag = dataPlaneCandidate?.id ?? setupIntegrationFlag;
  const dataPlaneSmokeCommands = buildFeishuDataPlaneSmokeCommands({
    workspaceId: readiness.workspaceId,
    integrationId: dataPlaneIntegrationFlag,
  });

  return {
    workspaceId: readiness.workspaceId,
    requiredReadiness: readiness.requiredReadiness,
    integrationCount: readiness.integrationCount,
    strictSatisfied: readiness.strictSatisfied,
    selectedBotIntegrationId: botCandidate?.id,
    selectedDataPlaneIntegrationId: dataPlaneCandidate?.id,
    selectedWorkerIntegrationId: workerCandidate?.readyForWorkerSmoke ? workerCandidate.id : undefined,
    appSetup,
    runtimeSetup,
    smokeHarness,
    workerHarness,
    evidenceGates,
    readinessSummary: {
      readyForBotSmokeCount: readiness.readyForBotSmokeCount,
      readyForDataPlaneSmokeCount: readiness.readyForDataPlaneSmokeCount,
      readyForWorkerSmokeCount: readiness.readyForWorkerSmokeCount,
    },
    steps: [
      {
        id: "configure_credential_encryption_key",
        area: "setup",
        title: "Configure AgentSpace credential encryption key",
        status: credentialEncryptionReady ? "done" : "pending",
        detail: credentialEncryptionReady
          ? `AgentSpace credential encryption key is configured via ${runtimeSetup.credentialEncryption.configuredEnvName}.`
          : "Set a base64-encoded 32-byte AgentSpace credential encryption key before creating a Feishu integration from CLI.",
        command: credentialEncryptionReady
          ? undefined
          : "export AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY=$(openssl rand -base64 32)",
        issues: credentialEncryptionIssues,
      },
      {
        id: "prepare_feishu_create_env",
        area: "setup",
        title: "Prepare Feishu agent bot env file",
        status: hasIntegration ? "done" : "pending",
        detail: hasIntegration
          ? "A Feishu agent bot binding or integration already exists; use smoke-env for workspace-specific live smoke resources."
          : "Create scripts/feishu/.env from the checked-in template, then replace the Feishu app credential placeholders before binding an AgentSpace agent to its Feishu bot.",
        command: hasIntegration
          ? undefined
          : "test -f scripts/feishu/.env || cp scripts/feishu/env.example scripts/feishu/.env",
        issues: [],
      },
      {
        id: "bind_feishu_agent_bot",
        area: "setup",
        title: "Bind one AgentSpace agent to its Feishu bot",
        status: hasIntegration ? "done" : credentialEncryptionReady ? "pending" : "blocked",
        detail: hasIntegration
          ? `Found ${readiness.integrationCount} Feishu integration/bot binding record(s) in this workspace.`
          : "Create a Feishu custom app for a specific AgentSpace agent, then bind it with App ID + App Secret. WebSocket worker is the default quick start; EventCallback verification token/encrypt key stay in advanced setup.",
        command: hasIntegration
          ? undefined
          : `agent-space integrations feishu bind-agent-bot --workspace-id ${readiness.workspaceId} --agent ${FEISHU_CLI_PLACEHOLDERS.agentName} --env-file scripts/feishu/.env --app-id-env FEISHU_APP_ID --app-secret-env FEISHU_APP_SECRET --json`,
        issues: hasIntegration ? [] : credentialEncryptionIssues,
      },
      {
        id: "configure_app_credentials",
        area: "setup",
        title: "Configure agent bot app credentials",
        status: prereqStatus(hasIntegration, hasConfiguredAppCredentials),
        detail: hasConfiguredAppCredentials
          ? "AgentSpace has a Feishu app id plus required secret configuration for at least one agent bot binding."
          : "For quick start, save only App ID and App Secret on the agent bot binding. Add verification token and encrypt key only when using EventCallback.",
        issues: collectSetupIssues(setupCandidate, ["app_id_missing", "credentials_incomplete"]),
      },
      {
        id: "configure_bot_events_and_scopes",
        area: "setup",
        title: "Configure bot events and required scopes",
        status: prereqStatus(hasIntegration, hasBotAndDataPlaneScopes),
        detail: "Enable im.message.receive_v1, im.chat.member.bot.added_v1, bot permissions, and Docs/Sheets/Base scopes in Feishu Open Platform.",
        issues: hasIntegration
          ? [...missingBotScopes, ...missingDataPlaneScopes].map((scope) => `missing_scope:${scope}`)
          : ["integration_missing"],
      },
      {
        id: "check_connection_health",
        area: "setup",
        title: "Run AgentSpace health check",
        status: prereqStatus(hasIntegration, hasHealthChecked),
        detail: "Run Test connection in settings or the readiness CLI so manual smoke is not attempted against unknown health.",
        command: `agent-space integrations feishu readiness --workspace-id ${readiness.workspaceId} --json`,
        issues: collectSetupIssues(setupCandidate, ["health_not_checked", "health_error", "health_degraded"]),
      },
      {
        id: "prepare_live_smoke_env",
        area: "setup",
        title: "Prepare isolated Feishu smoke env file",
        status: hasIntegration ? "pending" : "blocked",
        detail: "Copy the checked-in template, fill it with disposable Feishu smoke resources, and keep the resulting env file out of git.",
        command: smokeHarness.prepareEnvCommand,
        issues: hasIntegration ? [] : ["integration_missing"],
      },
      {
        id: "check_live_smoke_env",
        area: "setup",
        title: "Check isolated Feishu smoke env file",
        status: hasIntegration ? "pending" : "blocked",
        detail: "Validate that the live smoke env has real app, callback, IM, Docs, Sheets, and Base values before calling Feishu.",
        command: smokeHarness.checkEnvCommand,
        issues: hasIntegration ? [] : ["integration_missing"],
      },
      {
        id: "bind_feishu_chat",
        area: "bot",
        title: "Manual fallback: bind Feishu group to an AgentSpace channel",
        status: prereqStatus(hasIntegration, hasChannelBinding),
        detail: "TODO120's primary path is automatic: adding the agent bot to a Feishu group should create or reuse the AgentSpace channel. Use this manual binding only as a fallback when auto-provisioning is disabled or under admin review.",
        command: `agent-space integrations feishu bind-channel --workspace-id ${readiness.workspaceId} --integration ${setupIntegrationFlag} --channel ${FEISHU_CLI_PLACEHOLDERS.agentSpaceChannel} --chat-id ${FEISHU_CLI_PLACEHOLDERS.feishuChatId} --json`,
        issues: collectSetupIssues(botCandidate, ["channel_binding_missing"]),
      },
      {
        id: "bind_feishu_user",
        area: "bot",
        title: "Bind Feishu user to an AgentSpace user",
        status: prereqStatus(hasIntegration, hasUserBinding),
        detail: "Bind the Feishu sender to a workspace member so inbound messages remain governed by AgentSpace permissions.",
        command: `agent-space integrations feishu bind-user --workspace-id ${readiness.workspaceId} --integration ${setupIntegrationFlag} --user-id ${FEISHU_CLI_PLACEHOLDERS.agentSpaceUserId} --open-id ${FEISHU_CLI_PLACEHOLDERS.feishuOpenId} --json`,
        issues: collectSetupIssues(botCandidate, ["user_binding_missing"]),
      },
      {
        id: "run_bot_readiness_gate",
        area: "bot",
        title: "Pass local bot smoke readiness gate",
        status: readyForBot ? "done" : "blocked",
        detail: readyForBot
          ? `Bot smoke prerequisites pass for ${formatIntegrationLabel(botCandidate)}.`
          : "Local prerequisites are incomplete; do not treat live bot smoke as meaningful yet.",
        command: `agent-space integrations feishu readiness --workspace-id ${readiness.workspaceId} --strict --require bot --json`,
        issues: readyForBot ? [] : botIssues,
      },
      {
        id: "live_bot_message_reply",
        area: "bot",
        title: "Live smoke: @agent-specific Feishu bot and verify reply",
        status: readyForBot ? "pending" : "blocked",
        detail: "In the mapped Feishu group, mention the concrete agent bot, such as @Codex Bot, without any /agent command. Verify AgentSpace records agentId + botBindingId, queues the internal task, and replies from the same Feishu bot identity in the same thread.",
        issues: readyForBot ? [] : botIssues,
      },
      {
        id: "live_agent_bot_direct_mention",
        area: "bot",
        title: "Live smoke: direct @agent bot route evidence",
        status: readyForBot ? "pending" : "blocked",
        detail: "From a bound Feishu user, directly @ the agent-specific bot and verify the inbound mapping records the concrete agentId, botBindingId, task, and message evidence without using /agent routing text.",
        issues: readyForBot ? [] : botIssues,
      },
      {
        id: "live_agent_bot_channel_auto_provision",
        area: "bot",
        title: "Live smoke: agent bot auto-provisions channel",
        status: hasIntegration ? "pending" : "blocked",
        detail: "Add the agent's Feishu bot to a new Feishu group and verify AgentSpace creates or binds the channel automatically with provisionSource=bot_added, safe chat reference metadata, agent membership, and a confirmation card.",
        issues: hasIntegration ? [] : ["integration_missing"],
      },
      {
        id: "live_agent_bot_first_message_auto_provision",
        area: "bot",
        title: "Live smoke: first mentioned message provisions channel",
        status: hasIntegration ? "pending" : "blocked",
        detail: "In a Feishu group that has no AgentSpace channel binding yet, send the first message mentioning the concrete agent bot. Verify AgentSpace records provisionSource=first_message, creates or binds the channel according to policy, and does not require a /agent command.",
        issues: hasIntegration ? [] : ["integration_missing"],
      },
      {
        id: "bind_second_feishu_agent_bot",
        area: "setup",
        title: "Bind second AgentSpace agent to its Feishu bot",
        status: hasSecondAgentBot ? "done" : hasIntegration && credentialEncryptionReady ? "pending" : "blocked",
        detail: hasSecondAgentBot
          ? `Found ${agentBotIntegrationCount} agent-scoped Feishu bot binding records for multi-agent smoke.`
          : "Create a second Feishu custom app, such as HermesAgent Bot, and bind it to a different AgentSpace agent before testing same-group reuse and thread collaboration.",
        command: hasSecondAgentBot
          ? undefined
          : `agent-space integrations feishu bind-agent-bot --workspace-id ${readiness.workspaceId} --agent ${FEISHU_CLI_PLACEHOLDERS.secondAgentName} --env-file scripts/feishu/.env --app-id-env FEISHU_SECOND_AGENT_APP_ID --app-secret-env FEISHU_SECOND_AGENT_APP_SECRET --json`,
        issues: hasSecondAgentBot
          ? []
          : hasIntegration
            ? credentialEncryptionIssues
            : ["integration_missing", ...credentialEncryptionIssues],
      },
      {
        id: "live_multi_agent_bot_channel_reuse",
        area: "bot",
        title: "Live smoke: second agent bot reuses channel",
        status: hasSecondAgentBot ? "pending" : "blocked",
        detail: "After the second agent bot binding exists, add that bot to the same Feishu group and verify AgentSpace reuses the existing channel, adds only that agent membership, and records linkedFromBindingId plus different linkedFromAgentId/linkedFromBotBindingId metadata instead of creating a duplicate channel.",
        issues: hasSecondAgentBot ? [] : ["second_agent_bot_missing"],
      },
      {
        id: "live_multi_agent_thread_collaboration",
        area: "bot",
        title: "Live smoke: second agent bot joins an active thread",
        status: readyForBot && hasSecondAgentBot ? "pending" : "blocked",
        detail: "Mention one agent-specific Feishu bot in a mapped group thread, then mention the second agent bot in that same Feishu thread. Verify AgentSpace keeps separate thread bindings, records threadCollaboration=true with collaborator agent ids, and sends the collaboration card without raw Feishu ids.",
        issues: readyForBot && hasSecondAgentBot
          ? []
          : uniqueStrings([
            ...botIssues,
            ...(hasSecondAgentBot ? [] : ["second_agent_bot_missing"]),
          ]),
      },
      {
        id: "live_feishu_thread_task_binding",
        area: "bot",
        title: "Live smoke: Feishu thread binds to AgentSpace task",
        status: readyForBot ? "pending" : "blocked",
        detail: "Mention the agent bot in a Feishu thread and verify AgentSpace records the thread binding with taskQueueId, agentSpaceMessageId, agentId, botBindingId, and a safe thread reference.",
        issues: readyForBot ? [] : botIssues,
      },
      {
        id: "live_feishu_thread_continuation",
        area: "bot",
        title: "Live smoke: Feishu thread follow-up continues",
        status: readyForBot ? "pending" : "blocked",
        detail: "After a mentioned agent bot message creates a Feishu thread binding, send a follow-up in the same Feishu thread without mentioning the bot and verify AgentSpace records threadContinuation=true with the same safe thread binding reference.",
        issues: readyForBot ? [] : botIssues,
      },
      {
        id: "live_external_guest_agent_bot_mention",
        area: "bot",
        title: "Live smoke: unbound Feishu user routes as external guest",
        status: readyForBot ? "pending" : "blocked",
        detail: "From a Feishu user that is not bound to AgentSpace, mention the agent bot and verify AgentSpace dispatches a low-permission external_guest actor without creating a real workspace member or leaking raw Feishu user ids.",
        issues: readyForBot ? [] : botIssues,
      },
      {
        id: "live_external_guest_reply_all",
        area: "bot",
        title: "Live smoke: reply_all external guest dispatch",
        status: readyForBot ? "pending" : "blocked",
        detail: "Temporarily set the agent bot external guest policy to reply_all, send an unbound Feishu message without mentioning the bot, and verify AgentSpace still routes it to the bot's agent as channel_context_only external_guest.",
        issues: readyForBot ? [] : botIssues,
      },
      {
        id: "live_external_guest_identity_required",
        area: "bot",
        title: "Live smoke: external guest must bind identity",
        status: readyForBot ? "pending" : "blocked",
        detail: "Temporarily set the agent bot external guest policy to require_identity, mention the bot from an unbound Feishu user, and verify AgentSpace records the require_identity decision plus the identity-binding notice.",
        issues: readyForBot ? [] : botIssues,
      },
      {
        id: "live_external_guest_reply_disabled",
        area: "bot",
        title: "Live smoke: external guest replies can be disabled",
        status: readyForBot ? "pending" : "blocked",
        detail: "Temporarily set the agent bot external guest policy to ignore, mention the bot from an unbound Feishu user, and verify AgentSpace records the ignore decision without dispatching a task or sending a reply.",
        issues: readyForBot ? [] : botIssues,
      },
      {
        id: "live_unmentioned_guest_message_ignored",
        area: "bot",
        title: "Live smoke: unmentioned guest message is ignored",
        status: readyForBot ? "pending" : "blocked",
        detail: "With reply_on_mention enabled, send an unbound Feishu group message that does not mention the agent bot and verify AgentSpace records the bot-mention-required decision without dispatching.",
        issues: readyForBot ? [] : botIssues,
      },
      {
        id: "live_bound_user_data_operation",
        area: "data-plane",
        title: "Live smoke: bound Feishu user actor audit",
        status: readyForBot && readyForDataPlane ? "pending" : "blocked",
        detail: "From a Feishu user that is bound to an AgentSpace user, ask the concrete agent bot to use a bound Doc/Sheet/Base resource. Verify the data operation records governanceContext.actorType=user, actorUserId, agentId, botBindingId, and safe audit references without raw Feishu ids.",
        command: dataPlaneSmokeCommands.liveDocReadCommand,
        issues: readyForBot && readyForDataPlane ? [] : uniqueStrings([...botIssues, ...dataPlaneIssues]),
      },
      {
        id: "live_external_guest_write_denied",
        area: "data-plane",
        title: "Live smoke: external guest write requires identity",
        status: readyForBot && readyForDataPlane ? "pending" : "blocked",
        detail: "From an unbound Feishu user, ask the concrete agent bot to write the bound smoke Sheet. Verify AgentSpace records external_guest governance, refuses the final Feishu write with require_identity, sends the identity-binding notice, and does not create a real workspace member.",
        issues: readyForBot && readyForDataPlane ? [] : uniqueStrings([...botIssues, ...dataPlaneIssues]),
      },
      {
        id: "live_agent_channel_policy_disabled",
        area: "bot",
        title: "Live smoke: disabled agent/channel policy blocks replies",
        status: readyForBot ? "pending" : "blocked",
        detail: "Disable the agent's channel-member access or remove the agent from the mapped AgentSpace channel, mention the Feishu agent bot, and verify AgentSpace records the policy denial without writing a channel message, queueing a task, or sending a bot reply.",
        issues: readyForBot ? [] : botIssues,
      },
      {
        id: "live_agent_bound_doc_summary",
        area: "data-plane",
        title: "Live smoke: agent bot summarizes a bound Feishu Doc",
        status: readyForBot && readyForDataPlane ? "pending" : "blocked",
        detail: "In the mapped Feishu group, ask the concrete agent bot, such as @Codex Bot, to summarize the already-bound Feishu Doc. Verify the agent uses AgentSpace-scoped lark-cli/resource context, creates normal task/reply evidence, and sends the answer back to the Feishu thread.",
        issues: readyForBot && readyForDataPlane ? [] : uniqueStrings([...botIssues, ...dataPlaneIssues]),
      },
      {
        id: "run_websocket_worker_dry_run",
        area: "worker",
        title: "Self-hosted smoke: validate WebSocket worker selection",
        status: readyForWorkerSmoke ? "pending" : "blocked",
        detail: "Dry-run the self-hosted worker on websocket_worker integrations before opening a live WebSocket connection.",
        command: workerHarness.dryRunCommand,
        issues: workerIssues,
      },
      {
        id: "live_websocket_receive_message",
        area: "worker",
        title: "Live smoke: receive Feishu message through WebSocket worker",
        status: readyForWorkerSmoke ? "pending" : "blocked",
        detail: "Start the worker in a self-hosted environment, mention the concrete agent bot in a mapped Feishu group, then trigger one Sheet/Base approval card action from Feishu; verify both bypass the HTTP callback route while still creating the AgentSpace task/reply and approval execution.",
        command: workerHarness.startCommand,
        issues: workerIssues,
      },
      {
        id: "live_websocket_worker_restart",
        area: "worker",
        title: "Live smoke: restart WebSocket worker and verify recovery",
        status: readyForWorkerSmoke ? "pending" : "blocked",
        detail: "Restart the deployed worker, verify it reconnects, then send another Feishu message and confirm processing/outbox still work. The final evidence gate expects two correlated WebSocket replies: one before restart and one after restart.",
        command: workerHarness.systemdRestartCommand,
        issues: workerIssues,
      },
      {
        id: "bind_feishu_doc_sheet_base",
        area: "data-plane",
        title: "Bind Feishu Doc, Sheet, and Base resources",
        status: prereqStatus(hasIntegration, hasDocBinding && hasSheetBinding && hasBaseBinding),
        detail: "Bind one Feishu Doc, one Sheet, and one Base table to AgentSpace resources for data-plane smoke.",
        command: [
          `agent-space integrations feishu bind-resource --workspace-id ${readiness.workspaceId} --integration ${setupIntegrationFlag} --type doc --resource ${FEISHU_CLI_PLACEHOLDERS.docResource} --agent-space-type channel_document --channel ${FEISHU_CLI_PLACEHOLDERS.agentSpaceChannel} --allow-write --json`,
          `agent-space integrations feishu bind-resource --workspace-id ${readiness.workspaceId} --integration ${setupIntegrationFlag} --type sheet --resource ${FEISHU_CLI_PLACEHOLDERS.sheetResource} --agent-space-type data_table --channel ${FEISHU_CLI_PLACEHOLDERS.agentSpaceChannel} --allow-write --json`,
          `agent-space integrations feishu bind-resource --workspace-id ${readiness.workspaceId} --integration ${setupIntegrationFlag} --type base_table --resource ${FEISHU_CLI_PLACEHOLDERS.baseResource} --agent-space-type data_table --channel ${FEISHU_CLI_PLACEHOLDERS.agentSpaceChannel} --allow-write --json`,
        ].join("\n"),
        issues: collectDataPlaneBindingIssues({
          hasDocBinding,
          hasAnyDocBinding,
          hasSheetBinding,
          hasAnySheetBinding,
          hasBaseBinding,
          hasAnyBaseBinding,
          hasBaseReadyBinding,
        }),
      },
      {
        id: "run_data_plane_readiness_gate",
        area: "data-plane",
        title: "Pass local data-plane smoke readiness gate",
        status: readyForDataPlane ? "done" : "blocked",
        detail: readyForDataPlane
          ? `Docs/Sheets/Base prerequisites pass for ${formatIntegrationLabel(dataPlaneCandidate)}.`
          : "Data-plane prerequisites are incomplete; live Doc/Sheet/Base smoke would be inconclusive.",
        command: `agent-space integrations feishu readiness --workspace-id ${readiness.workspaceId} --strict --require data-plane --json`,
        issues: readyForDataPlane ? [] : dataPlaneIssues,
      },
      {
        id: "live_doc_read",
        area: "data-plane",
        title: "Live smoke: read bound Feishu Doc",
        status: readyForDataPlane ? "pending" : "blocked",
        detail: "Read the bound Feishu Doc through AgentSpace and verify the operation run stores only a safe summary.",
        command: dataPlaneSmokeCommands.liveDocReadCommand,
        issues: readyForDataPlane ? [] : dataPlaneIssues,
      },
      {
        id: "live_doc_write_with_approval",
        area: "data-plane",
        title: "Live smoke: approve a small Doc write",
        status: readyForDataPlane ? "pending" : "blocked",
        detail: "Create a governed Doc append approval from CLI, review the returned approval id through the same AgentSpace approval execution path, then verify payload hash check, Feishu write, and safe result summary.",
        command: dataPlaneSmokeCommands.liveDocWriteCommand,
        issues: readyForDataPlane ? [] : dataPlaneIssues,
      },
      {
        id: "live_sheet_read",
        area: "data-plane",
        title: "Live smoke: read bound Feishu Sheet",
        status: readyForDataPlane ? "pending" : "blocked",
        detail: "Read a small bound Sheet range through AgentSpace and verify the operation run stores only a safe summary.",
        command: dataPlaneSmokeCommands.liveSheetReadCommand,
        issues: readyForDataPlane ? [] : dataPlaneIssues,
      },
      {
        id: "live_sheet_write_with_approval",
        area: "data-plane",
        title: "Live smoke: approve a small Sheet write",
        status: readyForDataPlane ? "pending" : "blocked",
        detail: "Create a governed Sheet write approval from CLI, review the returned approval id through the same AgentSpace approval execution path, then verify payload hash check, Feishu write, AgentSpace data table sync, and safe result summary.",
        command: dataPlaneSmokeCommands.liveSheetWriteCommand,
        issues: readyForDataPlane ? [] : dataPlaneIssues,
      },
      {
        id: "live_base_preview_and_update",
        area: "data-plane",
        title: "Live smoke: preview and update one Base record",
        status: readyForDataPlane ? "pending" : "blocked",
        detail: "Read Base records, create a governed Base update approval from CLI, review the returned approval id through the same AgentSpace approval execution path, then verify the operation run and AgentSpace data table sync succeed.",
        command: dataPlaneSmokeCommands.liveBaseCommand,
        issues: readyForDataPlane ? [] : dataPlaneIssues,
      },
      {
        id: "run_openapi_live_smoke_harness",
        area: "data-plane",
        title: "Live smoke: run isolated Feishu callback and OpenAPI harness",
        status: readyForDataPlane ? "pending" : "blocked",
        detail: `Run the throwaway smoke harness after check-env passes. It must pass ${smokeHarness.requiredLiveSteps} live checks, including destructive writes for ${smokeHarness.destructiveLiveStepNames.join(", ")}, before saving the redacted OpenAPI evidence artifact consumed by the final AgentSpace evidence gate.`,
        command: smokeHarness.strictLiveCommand,
        issues: readyForDataPlane ? [] : dataPlaneIssues,
      },
      {
        id: "verify_live_smoke_evidence",
        area: "data-plane",
        title: "Verify redacted Feishu live smoke evidence",
        status: readyForDataPlane ? "pending" : "blocked",
        detail: `Validate that the saved evidence artifact came from a strict live run, includes all ${smokeHarness.requiredLiveSteps} required IM/Docs/Sheets/Base checks plus ${smokeHarness.destructiveLiveChecks} destructive write checks, and keeps resource tokens redacted.`,
        command: smokeHarness.verifyEvidenceCommand,
        issues: readyForDataPlane ? [] : dataPlaneIssues,
      },
      {
        id: "live_failure_visibility",
        area: "failure",
        title: "Live smoke: verify visible provider failure",
        status: hasIntegration ? "pending" : "blocked",
        detail: "Temporarily revoke a Feishu scope, use a wrong secret, or stop Feishu API access, then refresh health and verify a failed outbox/data-operation row plus degraded/error health are visible without leaking secrets.",
        command: `agent-space integrations feishu health-check --workspace-id ${readiness.workspaceId} --integration ${setupIntegrationFlag} --json`,
        issues: hasIntegration ? [] : ["integration_missing"],
      },
      {
        id: "verify_agentspace_live_evidence",
        area: "failure",
        title: "Verify AgentSpace-side Feishu live smoke evidence",
        status: readyForBot && readyForDataPlane ? "pending" : "blocked",
        detail: "After live native agent bot, guest-policy, data-plane, worker, and failure smoke, verify local AgentSpace DB evidence without exposing external ids or resource tokens. Native evidence requires agent-specific bot routing, auto-provisioning, multi-agent channel reuse, thread/task binding, thread continuation, thread collaboration, bot sender loop guard, and disabled-policy no-reply proof; guest evidence requires allow, reply_all, require_identity, ignore, and mention-required decisions.",
        command: `agent-space integrations feishu evidence --workspace-id ${readiness.workspaceId} --integration ${setupIntegrationFlag} --openapi-evidence ${smokeHarness.evidencePath} --strict --require all --json`,
        issues: readyForBot && readyForDataPlane ? [] : uniqueStrings([...botIssues, ...dataPlaneIssues]),
      },
    ],
  };
}

export function getFeishuSmokePlanExitCode(
  report: Pick<FeishuSmokePlanReport, "strictSatisfied">,
  input: { strict: boolean },
): number {
  return input.strict && !report.strictSatisfied ? 1 : 0;
}

function buildFeishuSmokePlanEvidenceGates(input: {
  hasWebSocketIntegration: boolean;
  openApiEvidencePath: string;
}): FeishuSmokePlanEvidenceGate[] {
  return [
    {
      key: "bot_reply",
      required: FEISHU_FINAL_EVIDENCE_GATE_REQUIREMENTS.botReply,
    },
    {
      key: "native_agent_bot",
      required: FEISHU_FINAL_EVIDENCE_GATE_REQUIREMENTS.nativeAgentBot,
    },
    {
      key: "guest_policy",
      required: FEISHU_FINAL_EVIDENCE_GATE_REQUIREMENTS.guestPolicy,
    },
    ...(input.hasWebSocketIntegration
      ? [{
        key: "worker_restart" as const,
        required: FEISHU_FINAL_EVIDENCE_GATE_REQUIREMENTS.workerRestart,
      }, {
        key: "worker_card_action" as const,
        required: FEISHU_FINAL_EVIDENCE_GATE_REQUIREMENTS.workerCardAction,
      }]
      : []),
    {
      key: "data_plane",
      required: FEISHU_FINAL_EVIDENCE_GATE_REQUIREMENTS.dataPlane,
    },
    {
      key: "failure_visibility",
      required: FEISHU_FINAL_EVIDENCE_GATE_REQUIREMENTS.failureVisibility,
    },
    {
      key: "openapi_artifact",
      required: `strict_live_artifact:${input.openApiEvidencePath}`,
    },
  ];
}

function parseRequiredReadiness(value: string | undefined): FeishuRequiredReadiness {
  if (!value || value === "bot") {
    return "bot";
  }
  if (value === "data-plane" || value === "data_plane" || value === "data") {
    return "data-plane";
  }
  if (value === "worker" || value === "websocket" || value === "websocket-worker") {
    return "worker";
  }
  throw new Error("Invalid --require value. Use bot, data-plane, or worker.");
}

function parseEvidenceRequirement(value: string | undefined): FeishuEvidenceRequirement {
  if (!value || value === "bot") {
    return "bot";
  }
  if (value === "native" || value === "native-experience" || value === "agent-bot") {
    return "native";
  }
  if (value === "guest-policy" || value === "guest_policy" || value === "external-guest") {
    return "guest-policy";
  }
  if (value === "data-plane" || value === "data_plane" || value === "data") {
    return "data-plane";
  }
  if (value === "worker" || value === "websocket" || value === "websocket-worker") {
    return "worker";
  }
  if (value === "failure" || value === "failures") {
    return "failure";
  }
  if (value === "all") {
    return "all";
  }
  throw new Error("Invalid --require value. Use bot, native, guest-policy, data-plane, worker, failure, or all.");
}

function buildFeishuIntegrationEvidence(input: {
  workspaceId: string;
  integration: ExternalIntegrationRecord;
  events: ExternalIntegrationEventRecord[];
  messageMappings: ExternalMessageMappingRecord[];
  outbox: ExternalMessageOutboxRecord[];
  channelBindings: ExternalChannelBindingRecord[];
  threadBindings: ExternalThreadBindingRecord[];
  dataOperations: ExternalDataOperationRunRecord[];
}): FeishuIntegrationEvidence {
  const processedInboundEvents = input.events.filter((event) =>
    event.eventType === "im.message.receive_v1" && event.status === "processed"
  ).length;
  const processedApprovalCardActions = input.events.filter((event) =>
    isFeishuApprovalCardActionEventType(event.eventType) && event.status === "processed"
  ).length;
  const failedEvents = input.events.filter((event) => event.status === "failed").length;
  const inboundMessageMappings = input.messageMappings.filter((mapping) => mapping.direction === "inbound").length;
  const outboundMessageMappings = input.messageMappings.filter((mapping) => mapping.direction === "outbound").length;
  const correlatedReplyMappings = countCorrelatedFeishuReplyMappings(input.messageMappings);
  const nativeBotReplyEvidence = countFeishuNativeBotReplyEvidence(input.messageMappings);
  const agentBotRouteEvidence = countFeishuAgentBotRouteEvidence(input.messageMappings);
  const boundUserMentionEvidence = countFeishuNativeActorMentionEvidence(input.messageMappings, "user");
  const externalGuestMentionEvidence = countFeishuNativeActorMentionEvidence(input.messageMappings, "external_guest");
  const agentChannelPolicyDeniedEvidence = countFeishuAgentChannelPolicyDeniedEvidence(input.messageMappings);
  const botSenderLoopGuardEvidence = countFeishuBotSenderLoopGuardEvidence(input.messageMappings);
  const externalGuestAllowedEvidence = countFeishuExternalGuestPolicyEvidence(input.messageMappings, {
    decision: "allow",
    dispatchStatus: "sent",
  });
  const externalGuestReplyAllEvidence = countFeishuExternalGuestReplyAllEvidence(input.messageMappings);
  const externalGuestRequireIdentityEvidence = countFeishuExternalGuestPolicyEvidence(input.messageMappings, {
    decision: "require_identity",
    reasonCode: "feishu_external_guest_identity_required",
    dispatchStatus: "ignored",
  });
  const externalGuestIgnoreEvidence = countFeishuExternalGuestPolicyEvidence(input.messageMappings, {
    decision: "ignore",
    reasonCode: "feishu_external_guest_ignored",
    unboundUserMode: "ignore",
    dispatchStatus: "ignored",
  });
  const externalGuestMentionRequiredEvidence = countFeishuExternalGuestPolicyEvidence(input.messageMappings, {
    decision: "ignore",
    reasonCode: "feishu_external_guest_bot_mention_required",
    unboundUserMode: "reply_on_mention",
    dispatchStatus: "ignored",
  });
  const autoProvisionedChannelBindings = countFeishuAutoProvisionedChannelBindings(input.channelBindings);
  const botAddedAutoProvisionedChannelBindings = countFeishuAutoProvisionedChannelBindings(
    input.channelBindings,
    "bot_added",
  );
  const firstMessageAutoProvisionedChannelBindings = countFeishuAutoProvisionedChannelBindings(
    input.channelBindings,
    "first_message",
  );
  const reusedProviderChannelBindings = countFeishuReusedProviderChannelBindings(input.channelBindings);
  const threadTaskBindings = countFeishuThreadTaskBindingEvidence(input.threadBindings);
  const threadContinuationEvidence = countFeishuThreadContinuationEvidence(input.messageMappings);
  const threadCollaborationEvidence = countFeishuThreadCollaborationEvidence(input.threadBindings);
  const sentOutboxItems = input.outbox.filter((item) => item.status === "sent").length;
  const failedOutboxItems = input.outbox.filter((item) =>
    item.status === "failed" || (item.status === "pending" && Boolean(item.lastError))
  ).length;
  const failedOutboxAgentBotEvidence = countFeishuFailedOutboxAgentBotEvidence(input.outbox);
  const healthStatus = input.integration.lastHealthStatus ?? "unknown";
  const healthFailureVisible = healthStatus === "degraded" || healthStatus === "error";
  const docReadSucceeded = countNonRuntimeFeishuDocReadOperations(input.dataOperations);
  const agentDocReadSucceeded = countAgentRuntimeFeishuDocReadOperations(input.dataOperations);
  const docWriteSucceeded = countSucceededFeishuOperations(input.dataOperations, [
    "docs.create_document",
    "docs.update_document",
  ]);
  const docApprovedWritesSucceeded = countApprovedSucceededFeishuOperations(input.dataOperations, [
    "docs.create_document",
    "docs.update_document",
  ]);
  const sheetReadSucceeded = countSucceededFeishuOperations(input.dataOperations, ["sheets.read_range"]);
  const sheetWriteSucceeded = countSucceededFeishuOperations(input.dataOperations, ["sheets.update_range"]);
  const sheetApprovedWritesSucceeded = countApprovedSucceededFeishuOperations(input.dataOperations, [
    "sheets.update_range",
  ]);
  const sheetApprovedWriteSyncSucceeded = countApprovedSyncedFeishuDataTableWriteOperations(input.dataOperations, [
    "sheets.update_range",
  ]);
  const baseReadSucceeded = countSucceededFeishuOperations(input.dataOperations, ["base.query_records"]);
  const baseMutateSucceeded = countSucceededFeishuOperations(input.dataOperations, ["base.mutate_records"]);
  const baseApprovedMutationsSucceeded = countApprovedSucceededFeishuOperations(input.dataOperations, [
    "base.mutate_records",
  ]);
  const baseApprovedMutationSyncSucceeded = countApprovedSyncedFeishuDataTableWriteOperations(input.dataOperations, [
    "base.mutate_records",
  ]);
  const userActorEvidence = countFeishuGovernanceActorEvidence(input.dataOperations, "user");
  const externalGuestActorEvidence = countFeishuGovernanceActorEvidence(input.dataOperations, "external_guest");
  const externalGuestWriteDeniedEvidence = countFeishuExternalGuestWriteDeniedEvidence(input.dataOperations);
  const failedDataOperations = input.dataOperations.filter((operation) => operation.status === "failed").length;
  const failedDataOperationAgentBotEvidence = countFeishuFailedDataOperationAgentBotEvidence(input.dataOperations);
  const agentBotFailureEvidence = failedOutboxAgentBotEvidence + failedDataOperationAgentBotEvidence;
  const botSatisfied = processedInboundEvents > 0 &&
    sentOutboxItems > 0 &&
    inboundMessageMappings > 0 &&
    outboundMessageMappings > 0 &&
    correlatedReplyMappings > 0;
  const nativeExperienceSatisfied = agentBotRouteEvidence > 0 &&
    nativeBotReplyEvidence > 0 &&
    boundUserMentionEvidence > 0 &&
    externalGuestMentionEvidence > 0 &&
    agentChannelPolicyDeniedEvidence > 0 &&
    botSenderLoopGuardEvidence > 0 &&
    autoProvisionedChannelBindings > 0 &&
    botAddedAutoProvisionedChannelBindings > 0 &&
    firstMessageAutoProvisionedChannelBindings > 0 &&
    reusedProviderChannelBindings > 0 &&
    threadTaskBindings > 0 &&
    threadContinuationEvidence > 0 &&
    threadCollaborationEvidence > 0;
  const guestPolicySatisfied = externalGuestAllowedEvidence > 0 &&
    externalGuestReplyAllEvidence > 0 &&
    externalGuestRequireIdentityEvidence > 0 &&
    externalGuestIgnoreEvidence > 0 &&
    externalGuestMentionRequiredEvidence > 0;
  const dataPlaneSatisfied = docReadSucceeded > 0 &&
    agentDocReadSucceeded > 0 &&
    docApprovedWritesSucceeded > 0 &&
    sheetReadSucceeded > 0 &&
    sheetApprovedWriteSyncSucceeded > 0 &&
    baseReadSucceeded > 0 &&
    baseApprovedMutationSyncSucceeded > 0 &&
    userActorEvidence > 0 &&
    externalGuestActorEvidence > 0 &&
    externalGuestWriteDeniedEvidence > 0;
  const requiredWorkerCorrelatedReplies = input.integration.transportMode === "websocket_worker" ? 2 : 0;
  const workerRestartRecoverySatisfied = correlatedReplyMappings >= requiredWorkerCorrelatedReplies;
  const workerApprovalCardActionSatisfied = input.integration.transportMode !== "websocket_worker" ||
    processedApprovalCardActions > 0;
  const workerSatisfied = input.integration.transportMode === "websocket_worker" &&
    botSatisfied &&
    workerRestartRecoverySatisfied &&
    workerApprovalCardActionSatisfied;
  const providerFailureVisible = failedOutboxItems > 0 || failedDataOperations > 0;
  const failureSatisfied = providerFailureVisible && healthFailureVisible && agentBotFailureEvidence > 0;
  const issues = buildFeishuEvidenceIssues({
    integration: input.integration,
    botSatisfied,
    nativeExperienceSatisfied,
    guestPolicySatisfied,
    dataPlaneSatisfied,
    workerSatisfied,
    failureSatisfied,
    processedInboundEvents,
    inboundMessageMappings,
    sentOutboxItems,
    outboundMessageMappings,
    correlatedReplyMappings,
    agentBotRouteEvidence,
    nativeBotReplyEvidence,
    boundUserMentionEvidence,
    externalGuestMentionEvidence,
    agentChannelPolicyDeniedEvidence,
    botSenderLoopGuardEvidence,
    externalGuestAllowedEvidence,
    externalGuestReplyAllEvidence,
    externalGuestRequireIdentityEvidence,
    externalGuestIgnoreEvidence,
    externalGuestMentionRequiredEvidence,
    autoProvisionedChannelBindings,
    botAddedAutoProvisionedChannelBindings,
    firstMessageAutoProvisionedChannelBindings,
    reusedProviderChannelBindings,
    threadTaskBindings,
    threadContinuationEvidence,
    threadCollaborationEvidence,
    docReadSucceeded,
    agentDocReadSucceeded,
    docWriteSucceeded,
    docApprovedWritesSucceeded,
    sheetReadSucceeded,
    sheetWriteSucceeded,
    sheetApprovedWritesSucceeded,
    sheetApprovedWriteSyncSucceeded,
    baseReadSucceeded,
    baseMutateSucceeded,
    baseApprovedMutationsSucceeded,
    baseApprovedMutationSyncSucceeded,
    userActorEvidence,
    externalGuestActorEvidence,
    externalGuestWriteDeniedEvidence,
    workerRestartRecoverySatisfied,
    workerApprovalCardActionSatisfied,
    providerFailureVisible,
    healthFailureVisible,
    agentBotFailureEvidence,
  });
  const remediationSteps = buildFeishuIntegrationEvidenceRemediationSteps({
    workspaceId: input.workspaceId,
    integration: input.integration,
    issues,
  });

  return {
    id: input.integration.id,
    displayName: input.integration.displayName,
    transportMode: input.integration.transportMode,
    bot: {
      processedInboundEvents,
      inboundMessageMappings,
      sentOutboxItems,
      outboundMessageMappings,
      correlatedReplyMappings,
      satisfied: botSatisfied,
    },
    nativeExperience: {
      agentBotRouteEvidence,
      nativeBotReplyEvidence,
      boundUserMentionEvidence,
      externalGuestMentionEvidence,
      agentChannelPolicyDeniedEvidence,
      botSenderLoopGuardEvidence,
      autoProvisionedChannelBindings,
      botAddedAutoProvisionedChannelBindings,
      firstMessageAutoProvisionedChannelBindings,
      reusedProviderChannelBindings,
      threadTaskBindings,
      threadContinuationEvidence,
      threadCollaborationEvidence,
      satisfied: nativeExperienceSatisfied,
    },
    guestPolicy: {
      externalGuestAllowedEvidence,
      externalGuestReplyAllEvidence,
      externalGuestRequireIdentityEvidence,
      externalGuestIgnoreEvidence,
      externalGuestMentionRequiredEvidence,
      satisfied: guestPolicySatisfied,
    },
    dataPlane: {
      docReadSucceeded,
      agentDocReadSucceeded,
      docWriteSucceeded,
      docApprovedWritesSucceeded,
      sheetReadSucceeded,
      sheetWriteSucceeded,
      sheetApprovedWritesSucceeded,
      sheetApprovedWriteSyncSucceeded,
      baseReadSucceeded,
      baseMutateSucceeded,
      baseApprovedMutationsSucceeded,
      baseApprovedMutationSyncSucceeded,
      userActorEvidence,
      externalGuestActorEvidence,
      externalGuestWriteDeniedEvidence,
      satisfied: dataPlaneSatisfied,
    },
    worker: {
      correlatedReplyMappings,
      requiredCorrelatedReplies: requiredWorkerCorrelatedReplies,
      restartRecoverySatisfied: workerRestartRecoverySatisfied,
      processedApprovalCardActions,
      approvalCardActionSatisfied: workerApprovalCardActionSatisfied,
      satisfied: workerSatisfied,
    },
    failureVisibility: {
      healthStatus,
      healthFailureVisible,
      providerFailureVisible,
      agentBotFailureEvidence,
      failedEvents,
      failedOutboxItems,
      failedDataOperations,
      satisfied: failureSatisfied,
    },
    issues,
    remediationSteps,
  };
}

function countSucceededFeishuOperations(
  operations: readonly ExternalDataOperationRunRecord[],
  operationTypes: readonly string[],
): number {
  const allowed = new Set(operationTypes);
  return operations.filter((operation) =>
    operation.status === "succeeded" && allowed.has(operation.operationType)
  ).length;
}

function countNonRuntimeFeishuDocReadOperations(
  operations: readonly ExternalDataOperationRunRecord[],
): number {
  return operations.filter((operation) =>
    operation.status === "succeeded" &&
    operation.operationType === "docs.read_document" &&
    !hasFeishuAgentRuntimeDocReadEvidence(operation)
  ).length;
}

function countApprovedSucceededFeishuOperations(
  operations: readonly ExternalDataOperationRunRecord[],
  operationTypes: readonly string[],
): number {
  const allowed = new Set(operationTypes);
  return operations.filter((operation) =>
    operation.status === "succeeded" &&
    allowed.has(operation.operationType) &&
    hasFeishuApprovedWriteEvidence(operation)
  ).length;
}

function countApprovedSyncedFeishuDataTableWriteOperations(
  operations: readonly ExternalDataOperationRunRecord[],
  operationTypes: readonly string[],
): number {
  const allowed = new Set(operationTypes);
  return operations.filter((operation) =>
    operation.status === "succeeded" &&
    allowed.has(operation.operationType) &&
    hasFeishuApprovedWriteEvidence(operation) &&
    hasFeishuApprovedDataTableWriteSyncEvidence(operation)
  ).length;
}

function countAgentRuntimeFeishuDocReadOperations(
  operations: readonly ExternalDataOperationRunRecord[],
): number {
  return operations.filter((operation) =>
    operation.status === "succeeded" &&
    operation.operationType === "docs.read_document" &&
    operation.actorType === "agent" &&
    hasFeishuAgentRuntimeDocReadEvidence(operation)
  ).length;
}

function hasFeishuAgentRuntimeDocReadEvidence(operation: ExternalDataOperationRunRecord): boolean {
  const request = readJsonRecord(operation.requestJson);
  const result = readJsonRecord(operation.resultJson);
  const runtimeResultManifest = isRecord(result?.runtimeResultManifest)
    ? result.runtimeResultManifest
    : undefined;
  return request?.source === "lark-cli-result-manifest" &&
    request.resultManifestPath === FEISHU_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH &&
    runtimeResultManifest?.path === FEISHU_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH;
}

function hasFeishuApprovedWriteEvidence(operation: ExternalDataOperationRunRecord): boolean {
  const result = readJsonRecord(operation.resultJson);
  return result?.policyDecision === "approved" &&
    typeof result.approvalId === "string" &&
    result.approvalId.trim().length > 0 &&
    typeof result.payloadHash === "string" &&
    result.payloadHash.trim().length > 0;
}

function hasFeishuApprovedDataTableWriteSyncEvidence(operation: ExternalDataOperationRunRecord): boolean {
  const result = readJsonRecord(operation.resultJson);
  const agentSpaceSync = isRecord(result?.agentSpaceSync) ? result.agentSpaceSync : undefined;
  return agentSpaceSync?.dataTableLastApprovedWriteSynced === true;
}

function countFeishuGovernanceActorEvidence(
  operations: readonly ExternalDataOperationRunRecord[],
  actorType: "user" | "external_guest",
): number {
  return operations.filter((operation) => {
    const governanceContext = readFeishuGovernanceContext(operation);
    if (governanceContext?.actorType !== actorType) {
      return false;
    }
    if (!hasNonEmptyString(governanceContext.agentId) || !hasNonEmptyString(governanceContext.botBindingId)) {
      return false;
    }
    if (actorType === "user") {
      return hasNonEmptyString(governanceContext.actorUserId);
    }
    return hasNonEmptyString(governanceContext.externalActorReference) &&
      hasNonEmptyString(governanceContext.externalGuestPermissionProfile);
  }).length;
}

function countFeishuExternalGuestWriteDeniedEvidence(
  operations: readonly ExternalDataOperationRunRecord[],
): number {
  return operations.filter((operation) =>
    readFeishuGovernanceActorType(operation) === "external_guest" &&
    countFeishuGovernanceActorEvidence([operation], "external_guest") === 1 &&
    operation.status === "failed" &&
    operation.errorCode === "feishu.data_operation_external_guest_requires_identity"
  ).length;
}

function readFeishuGovernanceActorType(
  operation: ExternalDataOperationRunRecord,
): "user" | "external_guest" | "agent" | "system" | undefined {
  const governanceContext = readFeishuGovernanceContext(operation);
  const actorType = typeof governanceContext?.actorType === "string"
    ? governanceContext.actorType
    : undefined;
  return actorType === "user" ||
    actorType === "external_guest" ||
    actorType === "agent" ||
    actorType === "system"
    ? actorType
    : undefined;
}

function readFeishuGovernanceContext(operation: ExternalDataOperationRunRecord): Record<string, unknown> | undefined {
  const request = readJsonRecord(operation.requestJson);
  return isRecord(request?.governanceContext)
    ? request.governanceContext
    : isRecord(request?.feishuGovernance)
      ? request.feishuGovernance
      : undefined;
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFeishuApprovalCardActionEventType(eventType: string): boolean {
  const normalized = eventType.trim().toLowerCase();
  return normalized === "card.action.trigger" ||
    normalized === "im.message.message_card.action_v1" ||
    normalized === "message_card.action";
}

function readJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readStringMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildFeishuCliExternalReference(kind: string, value: string): string {
  return `${kind}:${createHash("sha256").update(`${kind}:${value}`, "utf8").digest("hex").slice(0, 16)}`;
}

function buildFeishuEvidenceIssues(input: {
  integration: ExternalIntegrationRecord;
  botSatisfied: boolean;
  nativeExperienceSatisfied: boolean;
  guestPolicySatisfied: boolean;
  dataPlaneSatisfied: boolean;
  workerSatisfied: boolean;
  failureSatisfied: boolean;
  processedInboundEvents: number;
  inboundMessageMappings: number;
  sentOutboxItems: number;
  outboundMessageMappings: number;
  correlatedReplyMappings: number;
  agentBotRouteEvidence: number;
  nativeBotReplyEvidence: number;
  boundUserMentionEvidence: number;
  externalGuestMentionEvidence: number;
  agentChannelPolicyDeniedEvidence: number;
  botSenderLoopGuardEvidence: number;
  externalGuestAllowedEvidence: number;
  externalGuestReplyAllEvidence: number;
  externalGuestRequireIdentityEvidence: number;
  externalGuestIgnoreEvidence: number;
  externalGuestMentionRequiredEvidence: number;
  autoProvisionedChannelBindings: number;
  botAddedAutoProvisionedChannelBindings: number;
  firstMessageAutoProvisionedChannelBindings: number;
  reusedProviderChannelBindings: number;
  threadTaskBindings: number;
  threadContinuationEvidence: number;
  threadCollaborationEvidence: number;
  docReadSucceeded: number;
  agentDocReadSucceeded: number;
  docWriteSucceeded: number;
  docApprovedWritesSucceeded: number;
  sheetReadSucceeded: number;
  sheetWriteSucceeded: number;
  sheetApprovedWritesSucceeded: number;
  sheetApprovedWriteSyncSucceeded: number;
  baseReadSucceeded: number;
  baseMutateSucceeded: number;
  baseApprovedMutationsSucceeded: number;
  baseApprovedMutationSyncSucceeded: number;
  userActorEvidence: number;
  externalGuestActorEvidence: number;
  externalGuestWriteDeniedEvidence: number;
  workerRestartRecoverySatisfied: boolean;
  workerApprovalCardActionSatisfied: boolean;
  providerFailureVisible: boolean;
  healthFailureVisible: boolean;
  agentBotFailureEvidence: number;
}): string[] {
  const issues: string[] = [];
  if (!input.botSatisfied) {
    if (input.processedInboundEvents === 0) {
      issues.push("processed_inbound_event_missing");
    }
    if (input.inboundMessageMappings === 0) {
      issues.push("inbound_message_mapping_missing");
    }
    if (input.sentOutboxItems === 0) {
      issues.push("sent_outbox_missing");
    }
    if (input.outboundMessageMappings === 0) {
      issues.push("outbound_message_mapping_missing");
    }
    if (input.correlatedReplyMappings === 0) {
      issues.push("correlated_reply_mapping_missing");
    }
  }
  if (!input.nativeExperienceSatisfied) {
    if (input.agentBotRouteEvidence === 0) {
      issues.push("agent_bot_route_evidence_missing");
    }
    if (input.nativeBotReplyEvidence === 0) {
      issues.push("native_agent_bot_reply_evidence_missing");
    }
    if (input.boundUserMentionEvidence === 0) {
      issues.push("bound_user_bot_mention_evidence_missing");
    }
    if (input.externalGuestMentionEvidence === 0) {
      issues.push("external_guest_bot_mention_evidence_missing");
    }
    if (input.agentChannelPolicyDeniedEvidence === 0) {
      issues.push("agent_channel_policy_disabled_evidence_missing");
    }
    if (input.botSenderLoopGuardEvidence === 0) {
      issues.push("bot_sender_loop_guard_evidence_missing");
    }
    if (input.autoProvisionedChannelBindings === 0) {
      issues.push("channel_auto_provision_evidence_missing");
    }
    if (input.botAddedAutoProvisionedChannelBindings === 0) {
      issues.push("bot_added_auto_provision_evidence_missing");
    }
    if (input.firstMessageAutoProvisionedChannelBindings === 0) {
      issues.push("first_message_auto_provision_evidence_missing");
    }
    if (input.reusedProviderChannelBindings === 0) {
      issues.push("multi_agent_channel_reuse_evidence_missing");
    }
    if (input.threadTaskBindings === 0) {
      issues.push("thread_task_binding_evidence_missing");
    }
    if (input.threadContinuationEvidence === 0) {
      issues.push("thread_continuation_evidence_missing");
    }
    if (input.threadCollaborationEvidence === 0) {
      issues.push("thread_collaboration_evidence_missing");
    }
  }
  if (!input.guestPolicySatisfied) {
    if (input.externalGuestAllowedEvidence === 0) {
      issues.push("external_guest_policy_allow_evidence_missing");
    }
    if (input.externalGuestReplyAllEvidence === 0) {
      issues.push("external_guest_policy_reply_all_evidence_missing");
    }
    if (input.externalGuestRequireIdentityEvidence === 0) {
      issues.push("external_guest_policy_require_identity_evidence_missing");
    }
    if (input.externalGuestIgnoreEvidence === 0) {
      issues.push("external_guest_policy_ignore_evidence_missing");
    }
    if (input.externalGuestMentionRequiredEvidence === 0) {
      issues.push("external_guest_policy_mention_required_evidence_missing");
    }
  }
  if (!input.dataPlaneSatisfied) {
    if (input.docReadSucceeded === 0) {
      issues.push("doc_read_evidence_missing");
    } else if (input.agentDocReadSucceeded === 0) {
      issues.push("agent_doc_read_evidence_missing");
    }
    if (input.docWriteSucceeded === 0) {
      issues.push("doc_write_evidence_missing");
    } else if (input.docApprovedWritesSucceeded === 0) {
      issues.push("doc_write_approval_evidence_missing");
    }
    if (input.sheetReadSucceeded === 0) {
      issues.push("sheet_read_evidence_missing");
    }
    if (input.sheetWriteSucceeded === 0) {
      issues.push("sheet_write_evidence_missing");
    } else if (input.sheetApprovedWritesSucceeded === 0) {
      issues.push("sheet_write_approval_evidence_missing");
    } else if (input.sheetApprovedWriteSyncSucceeded === 0) {
      issues.push("sheet_write_agentspace_sync_evidence_missing");
    }
    if (input.baseReadSucceeded === 0) {
      issues.push("base_read_evidence_missing");
    }
    if (input.baseMutateSucceeded === 0) {
      issues.push("base_mutate_evidence_missing");
    } else if (input.baseApprovedMutationsSucceeded === 0) {
      issues.push("base_mutate_approval_evidence_missing");
    } else if (input.baseApprovedMutationSyncSucceeded === 0) {
      issues.push("base_mutate_agentspace_sync_evidence_missing");
    }
    if (input.userActorEvidence === 0) {
      issues.push("user_actor_data_operation_evidence_missing");
    }
    if (input.externalGuestActorEvidence === 0) {
      issues.push("external_guest_actor_data_operation_evidence_missing");
    } else if (input.externalGuestWriteDeniedEvidence === 0) {
      issues.push("external_guest_write_deny_evidence_missing");
    }
  }
  if (input.integration.transportMode === "websocket_worker") {
    if (!input.botSatisfied) {
      issues.push("websocket_worker_receive_evidence_missing");
    } else if (!input.workerRestartRecoverySatisfied) {
      issues.push("websocket_worker_restart_evidence_missing");
    }
    if (!input.workerApprovalCardActionSatisfied) {
      issues.push("websocket_worker_card_action_evidence_missing");
    }
  }
  if (!input.failureSatisfied) {
    if (!input.providerFailureVisible) {
      issues.push("provider_failure_evidence_missing");
    }
    if (!input.healthFailureVisible) {
      issues.push("health_failure_evidence_missing");
    }
    if (input.providerFailureVisible && input.agentBotFailureEvidence === 0) {
      issues.push("agent_bot_failure_evidence_missing");
    }
    issues.push("failure_visibility_evidence_missing");
  }
  return issues;
}

interface FeishuEvidenceRemediationSpec {
  stepId: string;
  title: string;
  detail: string;
  command?: string;
}

function buildFeishuIntegrationEvidenceRemediationSteps(input: {
  workspaceId: string;
  integration: ExternalIntegrationRecord;
  issues: readonly string[];
}): FeishuEvidenceRemediationStep[] {
  const grouped = new Map<string, FeishuEvidenceRemediationStep>();
  for (const issue of input.issues) {
    const spec = mapFeishuEvidenceIssueToRemediationSpec({
      issue,
      workspaceId: input.workspaceId,
      integration: input.integration,
    });
    if (!spec) {
      continue;
    }
    const current = grouped.get(spec.stepId);
    if (current) {
      current.issues = uniqueStrings([...current.issues, issue]);
      continue;
    }
    grouped.set(spec.stepId, {
      stepId: spec.stepId,
      title: spec.title,
      detail: spec.detail,
      issues: [issue],
      ...(spec.command ? { command: spec.command } : {}),
    });
  }
  return [...grouped.values()];
}

function mapFeishuEvidenceIssueToRemediationSpec(input: {
  issue: string;
  workspaceId: string;
  integration: ExternalIntegrationRecord;
}): FeishuEvidenceRemediationSpec | undefined {
  const dataPlaneCommands = buildFeishuDataPlaneSmokeCommands({
    workspaceId: input.workspaceId,
    integrationId: input.integration.id,
  });
  const workerHarness = buildFeishuWorkerHarnessSummary({
    workspaceId: input.workspaceId,
    integrationId: input.integration.id,
  });

  switch (input.issue) {
    case "processed_inbound_event_missing":
    case "inbound_message_mapping_missing":
    case "sent_outbox_missing":
    case "outbound_message_mapping_missing":
    case "correlated_reply_mapping_missing":
      return {
        stepId: "live_bot_message_reply",
        title: "Live smoke: @Agent in Feishu and verify reply",
        detail: "Send a message in the bound Feishu group mentioning the AgentSpace bot and an Agent, then wait for the AgentSpace reply to land back in the same Feishu thread.",
      };
    case "agent_bot_route_evidence_missing":
    case "bound_user_bot_mention_evidence_missing":
      return {
        stepId: "live_agent_bot_direct_mention",
        title: "Live smoke: @agent bot routes to its AgentSpace agent",
        detail: "From a bound Feishu user, mention the agent-specific Feishu bot in a group and verify AgentSpace records a sent inbound mapping with agentId, botBindingId, task, and message evidence.",
      };
    case "external_guest_bot_mention_evidence_missing":
      return {
        stepId: "live_external_guest_agent_bot_mention",
        title: "Live smoke: unbound Feishu user routes as external guest",
        detail: "From an unbound Feishu user, mention the agent-specific bot and verify AgentSpace records external_guest actor metadata without raw Feishu user ids.",
      };
    case "external_guest_policy_allow_evidence_missing":
      return {
        stepId: "live_external_guest_agent_bot_mention",
        title: "Live smoke: unbound Feishu user routes as external guest",
        detail: "From an unbound Feishu user, mention the agent-specific bot and verify AgentSpace records external_guest policy allow metadata plus the low-permission task dispatch.",
      };
    case "external_guest_policy_reply_all_evidence_missing":
      return {
        stepId: "live_external_guest_reply_all",
        title: "Live smoke: external guest reply_all dispatches without mention",
        detail: "Set the agent bot external guest policy to reply_all, send an unbound Feishu message without mentioning the bot, and verify AgentSpace records the reply_all allow decision plus the low-permission task dispatch.",
      };
    case "external_guest_policy_require_identity_evidence_missing":
      return {
        stepId: "live_external_guest_identity_required",
        title: "Live smoke: external guest is asked to bind identity",
        detail: "Set the agent bot external guest policy to require_identity, mention the bot from an unbound Feishu user, and verify AgentSpace records the require_identity decision and sends the binding notice.",
      };
    case "external_guest_policy_ignore_evidence_missing":
      return {
        stepId: "live_external_guest_reply_disabled",
        title: "Live smoke: external guest replies can be disabled",
        detail: "Set the agent bot external guest policy to ignore, mention the bot from an unbound Feishu user, and verify AgentSpace records the ignore decision without dispatching a task or reply.",
      };
    case "external_guest_policy_mention_required_evidence_missing":
      return {
        stepId: "live_unmentioned_guest_message_ignored",
        title: "Live smoke: unmentioned guest message is ignored",
        detail: "With reply_on_mention enabled, send an unbound Feishu message that does not mention the agent bot and verify AgentSpace records the bot-mention-required decision without dispatching.",
      };
    case "agent_channel_policy_disabled_evidence_missing":
      return {
        stepId: "live_agent_channel_policy_disabled",
        title: "Live smoke: disabled agent/channel policy blocks replies",
        detail: "Disable the agent's channel-member access or remove the agent from the mapped AgentSpace channel, mention the Feishu agent bot, and verify AgentSpace records the policy denial without writing a channel message, queueing a task, or sending a bot reply.",
      };
    case "channel_auto_provision_evidence_missing":
      return {
        stepId: "live_agent_bot_channel_auto_provision",
        title: "Live smoke: agent bot auto-provisions channel",
        detail: "Add the agent bot to a new Feishu group or send a first mentioned message in an unbound group, then verify the channel binding metadata records bot_added or first_message auto-provisioning.",
      };
    case "bot_added_auto_provision_evidence_missing":
      return {
        stepId: "live_agent_bot_channel_auto_provision",
        title: "Live smoke: agent bot auto-provisions channel",
        detail: "Add the agent bot to a new Feishu group and verify the channel binding metadata records provisionSource=bot_added with safe chat reference metadata.",
      };
    case "first_message_auto_provision_evidence_missing":
      return {
        stepId: "live_agent_bot_first_message_auto_provision",
        title: "Live smoke: first mentioned message provisions channel",
        detail: "Send the first mentioned message from an unbound Feishu group and verify AgentSpace records provisionSource=first_message.",
      };
    case "multi_agent_channel_reuse_evidence_missing":
      return {
        stepId: "live_multi_agent_bot_channel_reuse",
        title: "Live smoke: second agent bot reuses channel",
        detail: "Add a second agent bot to the same Feishu group and verify AgentSpace adds that agent to the existing channel with linkedFromBindingId plus different linkedFromAgentId/linkedFromBotBindingId metadata instead of creating a duplicate channel.",
      };
    case "thread_task_binding_evidence_missing":
      return {
        stepId: "live_feishu_thread_task_binding",
        title: "Live smoke: Feishu thread binds to AgentSpace task",
        detail: "Mention the agent bot in a Feishu thread and verify AgentSpace records the thread binding with taskQueueId, agentSpaceMessageId, agentId, and botBindingId.",
      };
    case "thread_continuation_evidence_missing":
      return {
        stepId: "live_feishu_thread_continuation",
        title: "Live smoke: Feishu thread follow-up continues without re-mention",
        detail: "After a mentioned agent bot message creates a Feishu thread binding, send a follow-up in the same Feishu thread without mentioning the bot and verify AgentSpace records threadContinuation=true with taskQueueId, agentId, botBindingId, and the same safe thread binding reference.",
      };
    case "thread_collaboration_evidence_missing":
      return {
        stepId: "live_multi_agent_thread_collaboration",
        title: "Live smoke: second agent bot joins an active thread",
        detail: "Mention one agent bot in a Feishu thread, then mention a second agent bot in that same thread and verify AgentSpace keeps separate thread bindings, records threadCollaboration=true, and sends the collaboration card without raw Feishu ids.",
      };
    case "bot_sender_loop_guard_evidence_missing":
      return {
        stepId: "live_multi_agent_thread_collaboration",
        title: "Live smoke: second agent bot joins an active thread",
        detail: "Mention one agent bot in a Feishu thread, then have another registered agent bot reply or mention it in the same group; verify AgentSpace records feishu_bot_sender_ignored without dispatching a task or leaking raw Feishu ids.",
      };
    case "doc_read_evidence_missing":
      return {
        stepId: "live_doc_read",
        title: "Live smoke: read bound Feishu Doc",
        detail: "Run the AgentSpace data-operation Doc read smoke so a succeeded, non-runtime Doc read operation is recorded.",
        command: dataPlaneCommands.liveDocReadCommand,
      };
    case "agent_doc_read_evidence_missing":
      return {
        stepId: "live_agent_bound_doc_summary",
        title: "Live smoke: @Agent summarizes a bound Feishu Doc",
        detail: "Ask an Agent from the bound Feishu group to summarize the already-bound Doc so AgentSpace records the lark-cli result-manifest Doc read evidence.",
      };
    case "doc_write_evidence_missing":
    case "doc_write_approval_evidence_missing":
      return {
        stepId: "live_doc_write_with_approval",
        title: "Live smoke: approve a small Doc write",
        detail: "Create and approve the governed Doc append operation so the operation run carries approved policy metadata and a safe Feishu write result.",
        command: dataPlaneCommands.liveDocWriteCommand,
      };
    case "sheet_read_evidence_missing":
      return {
        stepId: "live_sheet_read",
        title: "Live smoke: read bound Feishu Sheet",
        detail: "Run the AgentSpace data-operation Sheet read smoke so a succeeded safe range preview is recorded.",
        command: dataPlaneCommands.liveSheetReadCommand,
      };
    case "sheet_write_evidence_missing":
    case "sheet_write_approval_evidence_missing":
    case "sheet_write_agentspace_sync_evidence_missing":
      return {
        stepId: "live_sheet_write_with_approval",
        title: "Live smoke: approve a small Sheet write",
        detail: "Create and approve the governed Sheet write smoke, then let AgentSpace sync the bound data table preview from the approved write result.",
        command: dataPlaneCommands.liveSheetWriteCommand,
      };
    case "base_read_evidence_missing":
    case "base_mutate_evidence_missing":
    case "base_mutate_approval_evidence_missing":
    case "base_mutate_agentspace_sync_evidence_missing":
      return {
        stepId: "live_base_preview_and_update",
        title: "Live smoke: preview and update one Base record",
        detail: "Run the Base preview plus approved Base update smoke so AgentSpace records both safe read evidence and approved data-table sync evidence.",
        command: dataPlaneCommands.liveBaseCommand,
      };
    case "user_actor_data_operation_evidence_missing":
      return {
        stepId: "live_bound_user_data_operation",
        title: "Live smoke: bound Feishu user data operation",
        detail: "Bind one Feishu user to an AgentSpace user, then ask that user to trigger a governed Doc/Sheet/Base operation so the run records governanceContext.actorType=user.",
        command: dataPlaneCommands.liveDocReadCommand,
      };
    case "external_guest_actor_data_operation_evidence_missing":
    case "external_guest_write_deny_evidence_missing":
      return {
        stepId: "live_external_guest_write_denied",
        title: "Live smoke: external guest write is denied",
        detail: "From an unbound Feishu user, ask an agent bot to write a bound Sheet/Base resource and verify AgentSpace records external_guest governance plus the identity-required denial.",
        command: dataPlaneCommands.liveSheetWriteCommand,
      };
    case "websocket_worker_receive_evidence_missing":
      return {
        stepId: "live_websocket_receive_message",
        title: "Live smoke: receive Feishu message through WebSocket worker",
        detail: "Start the self-hosted WebSocket worker, send a bound Feishu message, and verify the AgentSpace task/reply path runs without the HTTP callback route.",
        command: workerHarness.startCommand,
      };
    case "websocket_worker_restart_evidence_missing":
      return {
        stepId: "live_websocket_worker_restart",
        title: "Live smoke: restart WebSocket worker and verify recovery",
        detail: "Restart the WebSocket worker and send another bound Feishu message so the final evidence gate sees two correlated WebSocket replies.",
        command: workerHarness.systemdRestartCommand,
      };
    case "websocket_worker_card_action_evidence_missing":
      return {
        stepId: "live_websocket_receive_message",
        title: "Live smoke: receive Feishu message through WebSocket worker",
        detail: "Trigger one approval card action through the self-hosted worker so AgentSpace proves card-button governance without a public callback URL.",
        command: workerHarness.startCommand,
      };
    case "provider_failure_evidence_missing":
    case "health_failure_evidence_missing":
    case "agent_bot_failure_evidence_missing":
    case "failure_visibility_evidence_missing":
      return {
        stepId: "live_failure_visibility",
        title: "Live smoke: verify visible provider failure",
        detail: "Temporarily use a wrong agent bot secret, revoke a required scope, or force a failed agent-bot outbox/data operation, then refresh Feishu health until degraded/error status and a provider failure row with agentId and botBindingId evidence are both visible.",
        command: `agent-space integrations feishu health-check --workspace-id ${input.workspaceId} --integration ${input.integration.id} --json`,
      };
    default:
      return undefined;
  }
}

function countCorrelatedFeishuReplyMappings(
  mappings: readonly ExternalMessageMappingRecord[],
): number {
  const inboundMappings = mappings.filter((mapping) => mapping.direction === "inbound");
  const inboundMessageIds = new Set(inboundMappings.map((mapping) => mapping.externalMessageId));
  const inboundThreadIds = new Set(inboundMappings
    .map((mapping) => mapping.externalThreadId)
    .filter((threadId): threadId is string => Boolean(threadId)));
  return mappings.filter((mapping) => {
    if (mapping.direction !== "outbound" || !mapping.externalThreadId) {
      return false;
    }
    const matchesInboundMessage = inboundMessageIds.has(mapping.externalThreadId);
    const matchesInboundThread = inboundThreadIds.has(mapping.externalThreadId);
    if (!matchesInboundMessage && !matchesInboundThread) {
      return false;
    }
    const inbound = inboundMappings.find((candidate) =>
      candidate.externalMessageId === mapping.externalThreadId ||
      candidate.externalThreadId === mapping.externalThreadId
    );
    return !inbound?.channelBindingId ||
      !mapping.channelBindingId ||
      inbound.channelBindingId === mapping.channelBindingId;
  }).length;
}

function countFeishuNativeBotReplyEvidence(
  mappings: readonly ExternalMessageMappingRecord[],
): number {
  const inboundMappings = mappings.filter((mapping) => mapping.direction === "inbound");
  return mappings.filter((mapping) => {
    if (mapping.direction !== "outbound" || !mapping.externalThreadId) {
      return false;
    }
    const inbound = inboundMappings.find((candidate) =>
      candidate.externalMessageId === mapping.externalThreadId ||
      candidate.externalThreadId === mapping.externalThreadId
    );
    if (
      !inbound ||
      (inbound.channelBindingId && mapping.channelBindingId && inbound.channelBindingId !== mapping.channelBindingId)
    ) {
      return false;
    }
    const inboundMetadata = readJsonRecord(inbound.metadataJson);
    const outboundMetadata = readJsonRecord(mapping.metadataJson);
    if (
      inboundMetadata?.provider !== FEISHU_PROVIDER_ID ||
      outboundMetadata?.provider !== FEISHU_PROVIDER_ID ||
      !hasNonEmptyString(inboundMetadata.agentId) ||
      !hasNonEmptyString(inboundMetadata.botBindingId) ||
      !hasNonEmptyString(inboundMetadata.externalChatReference) ||
      outboundMetadata.agentId !== inboundMetadata.agentId ||
      outboundMetadata.botBindingId !== inboundMetadata.botBindingId ||
      !hasNonEmptyString(outboundMetadata.externalChatReference)
    ) {
      return false;
    }
    const policyInput = isRecord(outboundMetadata.agentActionPolicyInput)
      ? outboundMetadata.agentActionPolicyInput
      : undefined;
    const action = isRecord(policyInput?.action) ? policyInput.action : undefined;
    return hasNonEmptyString(action?.resourceReference) &&
      action?.resourceIdRedacted === true &&
      !hasNonEmptyString(action?.resourceId);
  }).length;
}

function countFeishuAgentBotRouteEvidence(
  mappings: readonly ExternalMessageMappingRecord[],
): number {
  return mappings.filter((mapping) => {
    if (mapping.direction !== "inbound" || !mapping.taskQueueId || !mapping.agentSpaceMessageId) {
      return false;
    }
    const metadata = readJsonRecord(mapping.metadataJson);
    return metadata?.provider === FEISHU_PROVIDER_ID &&
      metadata.dispatchStatus === "sent" &&
      typeof metadata.agentId === "string" &&
      metadata.agentId.trim().length > 0 &&
      typeof metadata.botBindingId === "string" &&
      metadata.botBindingId.trim().length > 0;
  }).length;
}

function countFeishuNativeActorMentionEvidence(
  mappings: readonly ExternalMessageMappingRecord[],
  actorType: "user" | "external_guest",
): number {
  return mappings.filter((mapping) => {
    if (mapping.direction !== "inbound" || !mapping.taskQueueId || !mapping.agentSpaceMessageId) {
      return false;
    }
    const metadata = readJsonRecord(mapping.metadataJson);
    if (
      metadata?.provider !== FEISHU_PROVIDER_ID ||
      metadata.dispatchStatus !== "sent" ||
      metadata.actorType !== actorType ||
      typeof metadata.agentId !== "string" ||
      metadata.agentId.trim().length === 0 ||
      typeof metadata.botBindingId !== "string" ||
      metadata.botBindingId.trim().length === 0
    ) {
      return false;
    }
    if (actorType === "external_guest") {
      return typeof metadata.externalGuestReference === "string" &&
        metadata.externalGuestReference.trim().length > 0 &&
        typeof metadata.externalGuestPermissionProfile === "string" &&
        metadata.externalGuestPermissionProfile.trim().length > 0;
    }
    return typeof metadata.userId === "string" && metadata.userId.trim().length > 0;
  }).length;
}

function countFeishuAgentChannelPolicyDeniedEvidence(
  mappings: readonly ExternalMessageMappingRecord[],
): number {
  const policyDenialReasonCodes = new Set([
    "feishu_agent_not_enabled_in_channel",
    "feishu_agent_channel_member_access_disabled",
    "feishu_agent_unavailable_to_actor",
    "feishu_agent_runtime_unavailable",
    "feishu_agent_runtime_unavailable_to_actor",
  ]);
  return mappings.filter((mapping) => {
    if (mapping.direction !== "inbound" || mapping.taskQueueId || mapping.agentSpaceMessageId) {
      return false;
    }
    const metadata = readJsonRecord(mapping.metadataJson);
    const reasonCode = typeof metadata?.reasonCode === "string" ? metadata.reasonCode : undefined;
    return metadata?.provider === FEISHU_PROVIDER_ID &&
      metadata.dispatchStatus === "ignored" &&
      typeof metadata.agentId === "string" &&
      metadata.agentId.trim().length > 0 &&
      typeof metadata.botBindingId === "string" &&
      metadata.botBindingId.trim().length > 0 &&
      typeof metadata.externalChatReference === "string" &&
      metadata.externalChatReference.trim().length > 0 &&
      Boolean(reasonCode && policyDenialReasonCodes.has(reasonCode));
  }).length;
}

function countFeishuBotSenderLoopGuardEvidence(
  mappings: readonly ExternalMessageMappingRecord[],
): number {
  return mappings.filter((mapping) => {
    if (mapping.direction !== "inbound" || mapping.taskQueueId || mapping.agentSpaceMessageId) {
      return false;
    }
    const metadata = readJsonRecord(mapping.metadataJson);
    return metadata?.provider === FEISHU_PROVIDER_ID &&
      metadata.dispatchStatus === "ignored" &&
      metadata.reasonCode === "feishu_bot_sender_ignored" &&
      typeof metadata.agentId === "string" &&
      metadata.agentId.trim().length > 0 &&
      typeof metadata.botBindingId === "string" &&
      metadata.botBindingId.trim().length > 0 &&
      typeof metadata.externalChatReference === "string" &&
      metadata.externalChatReference.trim().length > 0;
  }).length;
}

function countFeishuExternalGuestPolicyEvidence(
  mappings: readonly ExternalMessageMappingRecord[],
  input: {
    decision: "allow" | "ignore" | "require_identity";
    dispatchStatus: "sent" | "ignored";
    reasonCode?: string;
    unboundUserMode?: string;
  },
): number {
  return mappings.filter((mapping) => {
    if (mapping.direction !== "inbound") {
      return false;
    }
    const metadata = readJsonRecord(mapping.metadataJson);
    if (
      metadata?.provider !== FEISHU_PROVIDER_ID ||
      metadata.actorType !== "external_guest" ||
      metadata.dispatchStatus !== input.dispatchStatus ||
      metadata.externalGuestPolicyDecision !== input.decision ||
      typeof metadata.externalGuestReference !== "string" ||
      metadata.externalGuestReference.trim().length === 0 ||
      typeof metadata.agentId !== "string" ||
      metadata.agentId.trim().length === 0 ||
      typeof metadata.botBindingId !== "string" ||
      metadata.botBindingId.trim().length === 0
    ) {
      return false;
    }
    if (input.reasonCode && metadata.externalGuestPolicyReasonCode !== input.reasonCode) {
      return false;
    }
    if (input.unboundUserMode && metadata.externalGuestUnboundUserMode !== input.unboundUserMode) {
      return false;
    }
    return true;
  }).length;
}

function countFeishuExternalGuestReplyAllEvidence(
  mappings: readonly ExternalMessageMappingRecord[],
): number {
  return mappings.filter((mapping) => {
    if (mapping.direction !== "inbound" || !mapping.taskQueueId || !mapping.agentSpaceMessageId) {
      return false;
    }
    const metadata = readJsonRecord(mapping.metadataJson);
    return metadata?.provider === FEISHU_PROVIDER_ID &&
      metadata.actorType === "external_guest" &&
      metadata.dispatchStatus === "sent" &&
      metadata.externalGuestPolicyDecision === "allow" &&
      metadata.externalGuestPolicyReasonCode === "feishu_external_guest_allowed" &&
      metadata.externalGuestUnboundUserMode === "reply_all" &&
      typeof metadata.externalGuestReference === "string" &&
      metadata.externalGuestReference.trim().length > 0 &&
      typeof metadata.externalGuestPermissionProfile === "string" &&
      metadata.externalGuestPermissionProfile.trim().length > 0 &&
      typeof metadata.agentId === "string" &&
      metadata.agentId.trim().length > 0 &&
      typeof metadata.botBindingId === "string" &&
      metadata.botBindingId.trim().length > 0;
  }).length;
}

function countFeishuAutoProvisionedChannelBindings(
  bindings: readonly ExternalChannelBindingRecord[],
  provisionSource?: "bot_added" | "first_message",
): number {
  return bindings.filter((binding) => {
    if (binding.status !== "active") {
      return false;
    }
    const metadata = readJsonRecord(binding.metadataJson);
    const source = typeof metadata?.provisionSource === "string" ? metadata.provisionSource : undefined;
    if (provisionSource ? source !== provisionSource : source !== "bot_added" && source !== "first_message") {
      return false;
    }
    return metadata?.provider === FEISHU_PROVIDER_ID &&
      typeof metadata.agentId === "string" &&
      metadata.agentId.trim().length > 0 &&
      typeof metadata.botBindingId === "string" &&
      metadata.botBindingId.trim().length > 0 &&
      typeof metadata.externalChatReference === "string" &&
      metadata.externalChatReference.trim().length > 0;
  }).length;
}

function countFeishuReusedProviderChannelBindings(
  bindings: readonly ExternalChannelBindingRecord[],
): number {
  return bindings.filter((binding) => {
    if (binding.status !== "active") {
      return false;
    }
    const metadata = readJsonRecord(binding.metadataJson);
    const agentId = hasNonEmptyString(metadata?.agentId) ? metadata.agentId.trim() : "";
    const botBindingId = hasNonEmptyString(metadata?.botBindingId) ? metadata.botBindingId.trim() : "";
    const linkedFromAgentId = hasNonEmptyString(metadata?.linkedFromAgentId)
      ? metadata.linkedFromAgentId.trim()
      : "";
    const linkedFromBotBindingId = hasNonEmptyString(metadata?.linkedFromBotBindingId)
      ? metadata.linkedFromBotBindingId.trim()
      : "";
    return metadata?.provider === FEISHU_PROVIDER_ID &&
      metadata.provisionSource === "bot_added" &&
      typeof metadata.linkedFromBindingId === "string" &&
      metadata.linkedFromBindingId.trim().length > 0 &&
      agentId.length > 0 &&
      botBindingId.length > 0 &&
      linkedFromAgentId.length > 0 &&
      linkedFromAgentId !== agentId &&
      linkedFromBotBindingId.length > 0 &&
      linkedFromBotBindingId !== botBindingId &&
      typeof metadata.externalChatReference === "string" &&
      metadata.externalChatReference.trim().length > 0;
  }).length;
}

function countFeishuThreadTaskBindingEvidence(
  bindings: readonly ExternalThreadBindingRecord[],
): number {
  return bindings.filter((binding) => {
    if (binding.provider !== FEISHU_PROVIDER_ID || binding.status !== "active") {
      return false;
    }
    if (!binding.taskQueueId || !binding.agentSpaceMessageId || !binding.agentId) {
      return false;
    }
    const metadata = readJsonRecord(binding.metadataJson);
    return metadata?.provider === FEISHU_PROVIDER_ID &&
      typeof metadata.agentId === "string" &&
      metadata.agentId.trim().length > 0 &&
      typeof metadata.botBindingId === "string" &&
      metadata.botBindingId.trim().length > 0 &&
      typeof metadata.externalChatReference === "string" &&
      metadata.externalChatReference.trim().length > 0 &&
      typeof metadata.externalThreadReference === "string" &&
      metadata.externalThreadReference.trim().length > 0;
  }).length;
}

function countFeishuThreadContinuationEvidence(
  mappings: readonly ExternalMessageMappingRecord[],
): number {
  return mappings.filter((mapping) => {
    if (mapping.direction !== "inbound" || !mapping.taskQueueId || !mapping.agentSpaceMessageId) {
      return false;
    }
    const metadata = readJsonRecord(mapping.metadataJson);
    return metadata?.provider === FEISHU_PROVIDER_ID &&
      metadata.dispatchStatus === "sent" &&
      metadata.threadContinuation === true &&
      typeof metadata.threadBindingId === "string" &&
      metadata.threadBindingId.trim().length > 0 &&
      typeof metadata.agentId === "string" &&
      metadata.agentId.trim().length > 0 &&
      typeof metadata.botBindingId === "string" &&
      metadata.botBindingId.trim().length > 0 &&
      typeof metadata.externalChatReference === "string" &&
      metadata.externalChatReference.trim().length > 0;
  }).length;
}

function countFeishuThreadCollaborationEvidence(
  bindings: readonly ExternalThreadBindingRecord[],
): number {
  return bindings.filter((binding) => {
    if (binding.provider !== FEISHU_PROVIDER_ID || binding.status !== "active") {
      return false;
    }
    if (!binding.taskQueueId || !binding.agentSpaceMessageId || !binding.agentId) {
      return false;
    }
    const metadata = readJsonRecord(binding.metadataJson);
    const agentId = hasNonEmptyString(metadata?.agentId) ? metadata.agentId.trim() : "";
    return metadata?.provider === FEISHU_PROVIDER_ID &&
      metadata.threadCollaboration === true &&
      agentId.length > 0 &&
      binding.agentId.trim() === agentId &&
      hasDifferentFeishuCollaboratingAgentId(metadata.collaboratingAgentIds, agentId) &&
      typeof metadata.botBindingId === "string" &&
      metadata.botBindingId.trim().length > 0 &&
      typeof metadata.externalChatReference === "string" &&
      metadata.externalChatReference.trim().length > 0 &&
      typeof metadata.externalThreadReference === "string" &&
      metadata.externalThreadReference.trim().length > 0;
  }).length;
}

function hasDifferentFeishuCollaboratingAgentId(value: unknown, currentAgentId: string): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.some((agentId) =>
    typeof agentId === "string" &&
    agentId.trim().length > 0 &&
    agentId.trim() !== currentAgentId
  );
}

function countFeishuFailedOutboxAgentBotEvidence(
  outbox: readonly ExternalMessageOutboxRecord[],
): number {
  return outbox.filter((item) => {
    if (item.status !== "failed" && !(item.status === "pending" && Boolean(item.lastError))) {
      return false;
    }
    const metadata = readJsonRecord(item.metadataJson);
    return metadata?.provider === FEISHU_PROVIDER_ID &&
      hasNonEmptyString(metadata.agentId) &&
      hasNonEmptyString(metadata.botBindingId);
  }).length;
}

function countFeishuFailedDataOperationAgentBotEvidence(
  operations: readonly ExternalDataOperationRunRecord[],
): number {
  return operations.filter((operation) => {
    if (operation.status !== "failed") {
      return false;
    }
    const governanceContext = readFeishuGovernanceContext(operation);
    return hasNonEmptyString(governanceContext?.agentId) &&
      hasNonEmptyString(governanceContext?.botBindingId);
  }).length;
}

function verifyFeishuOpenApiSmokeEvidence(input: {
  evidencePath?: string;
  evidence?: unknown;
  expectedCallbackRouteProof?: FeishuExpectedCallbackRouteProof;
  remediationContext?: {
    workspaceId: string;
    integrationId?: string;
  };
}): FeishuOpenApiSmokeEvidenceVerification {
  if (!input.evidencePath && input.evidence === undefined) {
    const issues = ["openapi_evidence_missing"];
    return {
      present: false,
      valid: false,
      issues,
      remediationSteps: buildFeishuOpenApiEvidenceRemediationSteps({
        issues,
        context: input.remediationContext,
      }),
    };
  }

  let evidence = input.evidence;
  if (evidence === undefined && input.evidencePath) {
    try {
      evidence = JSON.parse(readFileSync(input.evidencePath, "utf8")) as unknown;
    } catch {
      const issues = ["openapi_evidence_unreadable"];
      return {
        evidencePath: input.evidencePath,
        present: false,
        valid: false,
        issues,
        remediationSteps: buildFeishuOpenApiEvidenceRemediationSteps({
          issues,
          context: input.remediationContext,
        }),
      };
    }
  }

  const issues: string[] = [];
  const output = isRecord(evidence) ? evidence : undefined;
  const summary = isRecord(output?.summary) ? output.summary : undefined;
  const steps = Array.isArray(output?.steps) ? output.steps : [];

  if (!output) {
    issues.push("openapi_evidence_not_object");
  }
  if (output?.live !== true) {
    issues.push("openapi_not_live_run");
  }
  if (output?.strictLive !== true) {
    issues.push("openapi_not_strict_live_run");
  }
  if (summary?.strictLiveSatisfied !== true) {
    issues.push("openapi_strict_live_not_satisfied");
  }
  if (readNumber(summary?.liveSkipped) !== 0) {
    issues.push("openapi_live_steps_skipped");
  }
  if (readNumber(summary?.liveFailed) !== 0) {
    issues.push("openapi_live_steps_failed");
  }
  if (Array.isArray(summary?.missingEnv) && summary.missingEnv.length > 0) {
    issues.push("openapi_missing_live_env");
  }
  if (readNumber(summary?.liveChecks) < FEISHU_OPENAPI_REQUIRED_LIVE_SMOKE_STEPS.length) {
    issues.push("openapi_live_check_summary_incomplete");
  }
  if (readNumber(summary?.livePassed) < FEISHU_OPENAPI_REQUIRED_LIVE_SMOKE_STEPS.length) {
    issues.push("openapi_live_passed_summary_incomplete");
  }

  for (const stepName of FEISHU_OPENAPI_REQUIRED_LIVE_SMOKE_STEPS) {
    const step = steps.find((item) => isFeishuOpenApiSmokeStepNamed(item, stepName));
    if (!step) {
      issues.push(`openapi_required_step_missing:${stepName}`);
      continue;
    }
    if (step.status !== "pass") {
      issues.push(`openapi_required_step_not_passed:${stepName}`);
    }
    if (step.liveCheck !== true) {
      issues.push(`openapi_required_step_not_marked_live:${stepName}`);
    }
  }

  const callbackStep = steps.find((item) => isFeishuOpenApiSmokeStepNamed(item, "AgentSpace callback URL verification"));
  if (!hasValidFeishuCallbackRouteProof(callbackStep)) {
    issues.push("openapi_callback_route_proof_missing");
  } else if (
    input.expectedCallbackRouteProof &&
    !matchesFeishuCallbackRouteProof(callbackStep, input.expectedCallbackRouteProof)
  ) {
    issues.push("openapi_callback_route_proof_mismatch");
  }

  for (const stepName of FEISHU_OPENAPI_REQUIRED_REQUEST_STEPS) {
    const step = steps.find((item) => isFeishuOpenApiSmokeStepNamed(item, stepName));
    if (!step) {
      continue;
    }
    if (!hasFeishuOpenApiSmokeRequestSummary(step)) {
      issues.push(`openapi_required_request_summary_missing:${stepName}`);
    }
  }

  const sheetWrite = steps.find((item) => isFeishuOpenApiSmokeStepNamed(item, "Sheets write values"));
  const docAppend = steps.find((item) => isFeishuOpenApiSmokeStepNamed(item, "Docs docx append blocks"));
  const baseUpdate = steps.find((item) => isFeishuOpenApiSmokeStepNamed(item, "Base update record"));
  if (docAppend?.destructive !== true) {
    issues.push("openapi_doc_append_not_marked_destructive");
  }
  if (sheetWrite?.destructive !== true) {
    issues.push("openapi_sheet_write_not_marked_destructive");
  }
  if (baseUpdate?.destructive !== true) {
    issues.push("openapi_base_update_not_marked_destructive");
  }
  if (readNumber(summary?.destructiveLiveChecks) < FEISHU_OPENAPI_REQUIRED_DESTRUCTIVE_LIVE_SMOKE_STEPS.length) {
    issues.push("openapi_destructive_live_checks_missing");
  }

  for (const step of steps) {
    if (!isFeishuOpenApiSmokeStep(step)) {
      continue;
    }
    if (isRecord(step.request) && !hasFeishuOpenApiSmokeRequestSummary(step)) {
      issues.push(`openapi_request_summary_malformed:${step.name}`);
    } else if (hasFeishuOpenApiSmokeRequestSummary(step) && !isRedactedFeishuOpenApiSmokeRequestPath(step.request.path)) {
      issues.push(`openapi_request_path_not_redacted:${step.name}`);
    }
    if (typeof step.detail === "string" && containsRawFeishuOpenApiEvidenceIdentifier(step.detail)) {
      issues.push(`openapi_raw_feishu_identifier_in_detail:${step.name}`);
    }
    if (typeof step.detail === "string" && containsAgentSpaceCallbackUrlOpenApiEvidence(step.detail)) {
      issues.push(`openapi_callback_url_in_detail:${step.name}`);
    }
  }
  if (containsFeishuSecretLikeEvidence(JSON.stringify(evidence))) {
    issues.push("openapi_secret_like_value_in_evidence");
  }
  if (containsRawFeishuOpenApiEvidenceIdentifier(JSON.stringify(evidence))) {
    issues.push("openapi_raw_feishu_identifier_in_evidence");
  }
  if (containsAgentSpaceCallbackUrlOpenApiEvidence(JSON.stringify(evidence))) {
    issues.push("openapi_callback_url_in_evidence");
  }

  return {
    ...(input.evidencePath ? { evidencePath: input.evidencePath } : {}),
    present: true,
    valid: issues.length === 0,
    issues,
    remediationSteps: buildFeishuOpenApiEvidenceRemediationSteps({
      issues,
      context: input.remediationContext,
    }),
    summary: {
      live: output?.live === true,
      strictLive: output?.strictLive === true,
      strictLiveSatisfied: summary?.strictLiveSatisfied === true,
      liveChecks: readNumber(summary?.liveChecks),
      livePassed: readNumber(summary?.livePassed),
      liveSkipped: readNumber(summary?.liveSkipped),
      liveFailed: readNumber(summary?.liveFailed),
      destructiveLiveChecks: readNumber(summary?.destructiveLiveChecks),
      requiredLiveSteps: FEISHU_OPENAPI_REQUIRED_LIVE_SMOKE_STEPS.length,
    },
  };
}

function buildFeishuOpenApiEvidenceRemediationSteps(input: {
  issues: readonly string[];
  context?: {
    workspaceId: string;
    integrationId?: string;
  };
}): FeishuEvidenceRemediationStep[] {
  if (input.issues.length === 0) {
    return [];
  }
  const harness = input.context
    ? buildFeishuSmokeHarnessSummary(input.context)
    : undefined;
  return [{
    stepId: "run_openapi_live_smoke_harness",
    title: "Live smoke: run isolated Feishu callback and OpenAPI harness",
    detail: "Regenerate the strict live OpenAPI evidence artifact after check-env passes; the artifact must include the current callback fingerprint, all required IM/Docs/Sheets/Base live checks, destructive write checks, and redacted request summaries.",
    issues: uniqueStrings([...input.issues]),
    command: harness
      ? `${harness.strictLiveCommand}\n${harness.verifyEvidenceCommand}`
      : "npm run smoke:feishu -- --env-file scripts/feishu/.env --live --strict-live --evidence runtime-output/feishu-smoke/live.json --json\nnpm run smoke:feishu -- --verify-evidence runtime-output/feishu-smoke/live.json --json",
  }];
}

function isFeishuOpenApiSmokeStepNamed(value: unknown, name: string): value is Record<string, unknown> {
  return isFeishuOpenApiSmokeStep(value) && value.name === name;
}

function isFeishuOpenApiSmokeStep(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && typeof value.name === "string";
}

function hasFeishuOpenApiSmokeRequestSummary(
  step: Record<string, unknown>,
): step is Record<string, unknown> & { request: { method: string; path: string } } {
  if (!isRecord(step.request)) {
    return false;
  }
  return typeof step.request.method === "string" &&
    typeof step.request.path === "string" &&
    step.request.path.trim().length > 0;
}

function isRedactedFeishuOpenApiSmokeRequestPath(path: string): boolean {
  if (!path.startsWith("/open-apis/")) {
    return false;
  }
  if (path.startsWith("/open-apis/docx/v1/documents/")) {
    return [
      "/open-apis/docx/v1/documents/:doc_token/blocks",
      "/open-apis/docx/v1/documents/:doc_token/blocks/:parent_block_id/children",
    ].includes(path);
  }
  if (path.startsWith("/open-apis/sheets/v2/spreadsheets/")) {
    return [
      "/open-apis/sheets/v2/spreadsheets/:sheet_token/metainfo",
      "/open-apis/sheets/v2/spreadsheets/:sheet_token/values",
      "/open-apis/sheets/v2/spreadsheets/:sheet_token/values/:range",
    ].includes(path);
  }
  if (path.startsWith("/open-apis/bitable/v1/apps/")) {
    return [
      "/open-apis/bitable/v1/apps/:app_token/tables",
      "/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records",
      "/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/:record_id",
    ].includes(path);
  }
  return true;
}

function containsFeishuSecretLikeEvidence(serialized: string): boolean {
  return [
    /\bBearer\s+[A-Za-z0-9._-]{8,}/i,
    /\b(?:tenant_access_token|tenantAccessToken|app_secret|appSecret|verification_token|verificationToken|encrypt_key|encryptKey)\b\s*[:=]\s*["']?[A-Za-z0-9._-]{4,}/i,
  ].some((pattern) => pattern.test(serialized));
}

function containsRawFeishuOpenApiEvidenceIdentifier(serialized: string): boolean {
  return [
    /\b(?:doccn|doxcn|shtcn|bascn)[A-Za-z0-9_-]{4,}\b/i,
    /\b(?:tbl|vew)[A-Za-z0-9_-]{4,}\b/i,
    /\brec(?!eive|ord)[A-Za-z0-9_-]{4,}\b/i,
    /\b(?:oc|ou|om|on)_[A-Za-z0-9_-]{4,}\b/i,
    /\b[\p{L}\p{N}_. -]{1,80}![A-Z]{1,3}\d+(?::[A-Z]{1,3}\d+)?\b/u,
  ].some((pattern) => pattern.test(serialized));
}

function containsAgentSpaceCallbackUrlOpenApiEvidence(serialized: string): boolean {
  return /https?:\/\/[^"'\s<>]+\/api\/integrations\/feishu\/events(?:\?[^"'\s<>]*)?/i.test(serialized);
}

function buildFeishuExpectedCallbackRouteProof(input: {
  workspaceId: string;
  integrationId: string;
}): FeishuExpectedCallbackRouteProof {
  const routeKey = `/api/integrations/feishu/events?workspaceId=${input.workspaceId}&integrationId=${input.integrationId}`;
  return {
    callbackRoute: "/api/integrations/feishu/events",
    callbackRouteFingerprint: `sha256:${createHash("sha256").update(routeKey, "utf8").digest("hex").slice(0, 16)}`,
  };
}

function hasValidFeishuCallbackRouteProof(step: unknown): boolean {
  if (!isRecord(step)) {
    return false;
  }
  return step.callbackRoute === "/api/integrations/feishu/events" &&
    typeof step.callbackRouteFingerprint === "string" &&
    /^sha256:[a-f0-9]{16}$/.test(step.callbackRouteFingerprint);
}

function matchesFeishuCallbackRouteProof(
  step: unknown,
  expected: FeishuExpectedCallbackRouteProof,
): boolean {
  if (!isRecord(step)) {
    return false;
  }
  return step.callbackRoute === expected.callbackRoute &&
    step.callbackRouteFingerprint === expected.callbackRouteFingerprint;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isFeishuEvidenceSatisfied(
  item: FeishuIntegrationEvidence,
  requiredEvidence: FeishuEvidenceRequirement,
): boolean {
  if (requiredEvidence === "native") {
    return item.nativeExperience.satisfied;
  }
  if (requiredEvidence === "guest-policy") {
    return item.guestPolicy.satisfied;
  }
  if (requiredEvidence === "data-plane") {
    return item.dataPlane.satisfied;
  }
  if (requiredEvidence === "worker") {
    return item.worker.satisfied;
  }
  if (requiredEvidence === "failure") {
    return item.failureVisibility.satisfied;
  }
  if (requiredEvidence === "all") {
    return item.bot.satisfied &&
      item.nativeExperience.satisfied &&
      item.guestPolicy.satisfied &&
      item.dataPlane.satisfied &&
      item.failureVisibility.satisfied &&
      (item.transportMode !== "websocket_worker" || item.worker.satisfied);
  }
  return item.bot.satisfied;
}

function buildFeishuIntegrationReadiness(input: {
  integration: ExternalIntegrationRecord;
  channelBindings: ExternalChannelBindingRecord[];
  userBindings: ExternalUserBindingRecord[];
  resourceBindings: ExternalResourceBindingRecord[];
  failedOutbox: ExternalMessageOutboxRecord[];
  pendingOutbox: ExternalMessageOutboxRecord[];
}): FeishuIntegrationReadiness {
  const credentialSummary = summarizeFeishuStoredCredentials(input.integration);
  const activeChannelBindings = input.channelBindings.filter((binding) => binding.status === "active");
  const activeUserBindings = input.userBindings.filter((binding) => binding.status === "active");
  const activeResourceBindings = input.resourceBindings.filter((binding) => binding.status === "active");
  const docResourceCount = activeResourceBindings.filter((binding) => binding.providerResourceType === "doc").length;
  const docWritableResourceCount = activeResourceBindings.filter((binding) =>
    binding.providerResourceType === "doc" && isFeishuResourceBindingWriteEnabled(binding)
  ).length;
  const sheetResourceCount = activeResourceBindings.filter((binding) => binding.providerResourceType === "sheet").length;
  const sheetWritableResourceCount = activeResourceBindings.filter((binding) =>
    binding.providerResourceType === "sheet" && isFeishuResourceBindingWriteEnabled(binding)
  ).length;
  const baseResourceCount = activeResourceBindings.filter((binding) =>
    binding.providerResourceType === "base" ||
    binding.providerResourceType === "base_table" ||
    binding.providerResourceType === "base_view"
  ).length;
  const baseReadyResourceCount = activeResourceBindings.filter(isFeishuReadinessBaseBindingDataPlaneReady).length;
  const baseWritableResourceCount = activeResourceBindings.filter((binding) =>
    isFeishuReadinessBaseBindingDataPlaneReady(binding) && isFeishuResourceBindingWriteEnabled(binding)
  ).length;
  const availableScopes = readFeishuReadinessScopeList(input.integration.scopesJson);
  const missingBotScopes = findMissingFeishuReadinessScopes(availableScopes, FEISHU_BOT_SMOKE_SCOPES);
  const missingDataPlaneScopes = findMissingFeishuReadinessScopes(availableScopes, FEISHU_DATA_PLANE_SMOKE_SCOPES);
  const appConfigured = Boolean(input.integration.appId?.trim());
  const credentialsConfigured = credentialSummary.hasAppSecret &&
    (!doesFeishuReadinessRequireVerificationToken(input.integration) || credentialSummary.hasVerificationToken);
  const healthStatus = input.integration.lastHealthStatus ?? "unknown";
  const issues = buildFeishuReadinessIssues({
    integration: input.integration,
    appConfigured,
    credentialsConfigured,
    healthStatus,
    activeChannelBindingCount: activeChannelBindings.length,
    activeUserBindingCount: activeUserBindings.length,
    docResourceCount,
    docWritableResourceCount,
    sheetResourceCount,
    sheetWritableResourceCount,
    baseResourceCount,
    baseReadyResourceCount,
    baseWritableResourceCount,
    failedOutboxCount: input.failedOutbox.length,
    pendingOutboxWithErrorsCount: input.pendingOutbox.length,
    missingBotScopes,
    missingDataPlaneScopes,
  });
  const readyForBotSmoke = input.integration.status === "active" &&
    appConfigured &&
    credentialsConfigured &&
    activeChannelBindings.length > 0 &&
    activeUserBindings.length > 0 &&
    healthStatus !== "unknown" &&
    healthStatus !== "error" &&
    input.failedOutbox.length === 0 &&
    input.pendingOutbox.length === 0 &&
    missingBotScopes.length === 0;
  const readyForDataPlaneSmoke = readyForBotSmoke &&
    healthStatus === "healthy" &&
    docResourceCount > 0 &&
    docWritableResourceCount > 0 &&
    sheetResourceCount > 0 &&
    sheetWritableResourceCount > 0 &&
    baseReadyResourceCount > 0 &&
    baseWritableResourceCount > 0 &&
    missingDataPlaneScopes.length === 0;
  const readyForWorkerSmoke = readyForBotSmoke && input.integration.transportMode === "websocket_worker";
  const setupChecks = buildFeishuReadinessSetupChecks({
    integration: input.integration,
    appConfigured,
    hasAppSecret: credentialSummary.hasAppSecret,
    hasVerificationToken: credentialSummary.hasVerificationToken,
    hasEncryptKey: credentialSummary.hasEncryptKey,
    healthStatus,
    activeChannelBindingCount: activeChannelBindings.length,
    activeUserBindingCount: activeUserBindings.length,
    docResourceCount,
    docWritableResourceCount,
    sheetResourceCount,
    sheetWritableResourceCount,
    baseResourceCount,
    baseReadyResourceCount,
    baseWritableResourceCount,
    failedOutboxCount: input.failedOutbox.length,
    pendingOutboxWithErrorsCount: input.pendingOutbox.length,
  });

  return {
    id: input.integration.id,
    displayName: input.integration.displayName,
    agentId: input.integration.agentId,
    status: input.integration.status,
    transportMode: input.integration.transportMode,
    appConfigured,
    credentialsConfigured,
    healthStatus,
    channelBindings: {
      active: activeChannelBindings.length,
      total: input.channelBindings.length,
    },
    userBindings: {
      active: activeUserBindings.length,
      total: input.userBindings.length,
    },
    resourceBindings: {
      active: activeResourceBindings.length,
      total: input.resourceBindings.length,
      doc: docResourceCount,
      docWritable: docWritableResourceCount,
      sheet: sheetResourceCount,
      sheetWritable: sheetWritableResourceCount,
      base: baseResourceCount,
      baseReady: baseReadyResourceCount,
      baseWritable: baseWritableResourceCount,
    },
    outboxFailures: input.failedOutbox.length,
    pendingOutboxWithErrors: input.pendingOutbox.length,
    scopes: {
      configuredCount: availableScopes.length,
      missingForBotSmoke: missingBotScopes,
      missingForDataPlaneSmoke: missingDataPlaneScopes,
    },
    readyForBotSmoke,
    readyForDataPlaneSmoke,
    readyForWorkerSmoke,
    setupChecks,
    issues,
  };
}

function buildFeishuReadinessSetupChecks(input: {
  integration: ExternalIntegrationRecord;
  appConfigured: boolean;
  hasAppSecret: boolean;
  hasVerificationToken: boolean;
  hasEncryptKey: boolean;
  healthStatus: string;
  activeChannelBindingCount: number;
  activeUserBindingCount: number;
  docResourceCount: number;
  docWritableResourceCount: number;
  sheetResourceCount: number;
  sheetWritableResourceCount: number;
  baseResourceCount: number;
  baseReadyResourceCount: number;
  baseWritableResourceCount: number;
  failedOutboxCount: number;
  pendingOutboxWithErrorsCount: number;
}): FeishuReadinessSetupCheck[] {
  const requiresVerificationToken = doesFeishuReadinessRequireVerificationToken(input.integration);
  const hasCoreCredentials = input.appConfigured &&
    input.hasAppSecret &&
    (!requiresVerificationToken || input.hasVerificationToken);
  const missingRecommendedEncryptKey = requiresVerificationToken && hasCoreCredentials && !input.hasEncryptKey;
  const credentialsIssues = [
    ...(!input.appConfigured ? ["app_id_missing"] : []),
    ...(!input.hasAppSecret ? ["app_secret_missing"] : []),
    ...(requiresVerificationToken && !input.hasVerificationToken ? ["verification_token_missing"] : []),
    ...(missingRecommendedEncryptKey ? ["encrypt_key_missing"] : []),
  ];
  const outboxIssueCount = input.failedOutboxCount + input.pendingOutboxWithErrorsCount;

  return [
    {
      key: "credentials",
      status: hasCoreCredentials
        ? missingRecommendedEncryptKey ? "attention" : "ready"
        : "missing",
      current: hasCoreCredentials && !missingRecommendedEncryptKey
        ? "complete"
        : missingRecommendedEncryptKey
          ? "missing_encrypt_key"
          : "incomplete",
      required: requiresVerificationToken
        ? "app_id/app_secret/verification_token"
        : "app_id/app_secret",
      issues: credentialsIssues,
    },
    {
      key: "health",
      status: input.healthStatus === "healthy"
        ? "ready"
        : input.healthStatus === "unknown"
          ? "missing"
          : "attention",
      current: input.healthStatus,
      required: "healthy",
      issues: input.healthStatus === "healthy"
        ? []
        : input.healthStatus === "unknown"
          ? ["health_not_checked"]
          : [`health_${input.healthStatus}`],
    },
    {
      key: "transport",
      status: input.integration.transportMode === "websocket_worker" || input.integration.transportMode === "http_webhook"
        ? "ready"
        : "missing",
      current: input.integration.transportMode,
      required: "http_webhook_or_websocket_worker",
      issues: input.integration.transportMode === "websocket_worker" || input.integration.transportMode === "http_webhook"
        ? []
        : ["transport_mode_invalid"],
    },
    buildCountReadinessSetupCheck("chat_binding", input.activeChannelBindingCount, "channel_binding_missing"),
    buildCountReadinessSetupCheck("user_binding", input.activeUserBindingCount, "user_binding_missing"),
    buildFeishuWritableReadinessSetupCheck(
      "doc_binding",
      input.docResourceCount,
      input.docWritableResourceCount,
      "doc_resource_binding_missing",
      "doc_resource_write_grant_missing",
    ),
    buildFeishuWritableReadinessSetupCheck(
      "sheet_binding",
      input.sheetResourceCount,
      input.sheetWritableResourceCount,
      "sheet_resource_binding_missing",
      "sheet_resource_write_grant_missing",
    ),
    buildFeishuBaseReadinessSetupCheck(input.baseResourceCount, input.baseReadyResourceCount, input.baseWritableResourceCount),
    {
      key: "outbox",
      status: outboxIssueCount === 0 ? "ready" : "attention",
      current: outboxIssueCount,
      required: 0,
      issues: [
        ...(input.failedOutboxCount > 0 ? ["outbox_failed_items"] : []),
        ...(input.pendingOutboxWithErrorsCount > 0 ? ["outbox_retry_errors"] : []),
      ],
    },
  ];
}

function doesFeishuReadinessRequireVerificationToken(
  integration: Pick<ExternalIntegrationRecord, "transportMode">,
): boolean {
  return integration.transportMode === "http_webhook";
}

function buildCountReadinessSetupCheck(
  key: Extract<
    FeishuReadinessSetupCheck["key"],
    "chat_binding" | "user_binding" | "doc_binding" | "sheet_binding" | "base_binding"
  >,
  count: number,
  issue: string,
): FeishuReadinessSetupCheck {
  return {
    key,
    status: count > 0 ? "ready" : "missing",
    current: count,
    required: 1,
    issues: count > 0 ? [] : [issue],
  };
}

function buildFeishuBaseReadinessSetupCheck(
  baseResourceCount: number,
  baseReadyResourceCount: number,
  baseWritableResourceCount: number,
): FeishuReadinessSetupCheck {
  if (baseWritableResourceCount > 0) {
    return {
      key: "base_binding",
      status: "ready",
      current: baseWritableResourceCount,
      required: "1 writable data-plane-ready Base binding",
      issues: [],
    };
  }
  if (baseReadyResourceCount > 0) {
    return {
      key: "base_binding",
      status: "attention",
      current: `${baseWritableResourceCount}/${baseReadyResourceCount}`,
      required: "1 writable data-plane-ready Base binding",
      issues: ["base_resource_write_grant_missing"],
    };
  }
  if (baseResourceCount > 0) {
    return {
      key: "base_binding",
      status: "attention",
      current: `${baseReadyResourceCount}/${baseResourceCount}`,
      required: "1 data-plane-ready Base binding",
      issues: ["base_resource_app_token_missing"],
    };
  }
  return buildCountReadinessSetupCheck("base_binding", 0, "base_resource_binding_missing");
}

function buildFeishuWritableReadinessSetupCheck(
  key: Extract<FeishuReadinessSetupCheck["key"], "doc_binding" | "sheet_binding">,
  resourceCount: number,
  writableResourceCount: number,
  missingIssue: string,
  writeIssue: string,
): FeishuReadinessSetupCheck {
  if (writableResourceCount > 0) {
    return {
      key,
      status: "ready",
      current: writableResourceCount,
      required: "1 writable binding",
      issues: [],
    };
  }
  if (resourceCount > 0) {
    return {
      key,
      status: "attention",
      current: `${writableResourceCount}/${resourceCount}`,
      required: "1 writable binding",
      issues: [writeIssue],
    };
  }
  return {
    key,
    status: "missing",
    current: 0,
    required: "1 writable binding",
    issues: [missingIssue],
  };
}

function isFeishuReadinessBaseBindingDataPlaneReady(binding: ExternalResourceBindingRecord): boolean {
  const providerResourceType = binding.providerResourceType;
  if (providerResourceType === "base") {
    return Boolean(binding.providerResourceToken.trim());
  }
  if (providerResourceType !== "base_table" && providerResourceType !== "base_view") {
    return false;
  }
  const metadata = readFeishuReadinessBindingMetadata(binding.metadataJson);
  const appToken = readFeishuMetadataString(metadata, "appToken")
    ?? readFeishuMetadataString(metadata, "baseToken");
  const tableId = providerResourceType === "base_table"
    ? binding.providerResourceToken.trim()
    : readFeishuMetadataString(metadata, "tableId");
  return Boolean(appToken && tableId);
}

function isFeishuResourceBindingWriteEnabled(binding: ExternalResourceBindingRecord): boolean {
  const permissions = readFeishuReadinessBindingMetadata(binding.permissionsJson);
  return permissions.canWrite === true || permissions.write === true;
}

function readFeishuReadinessBindingMetadata(metadataJson: string | null | undefined): Record<string, unknown> {
  if (!metadataJson) {
    return {};
  }
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function readFeishuMetadataString(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function buildFeishuReadinessIssues(input: {
  integration: ExternalIntegrationRecord;
  appConfigured: boolean;
  credentialsConfigured: boolean;
  healthStatus: string;
  activeChannelBindingCount: number;
  activeUserBindingCount: number;
  docResourceCount: number;
  docWritableResourceCount: number;
  sheetResourceCount: number;
  sheetWritableResourceCount: number;
  baseResourceCount: number;
  baseReadyResourceCount: number;
  baseWritableResourceCount: number;
  failedOutboxCount: number;
  pendingOutboxWithErrorsCount: number;
  missingBotScopes: string[];
  missingDataPlaneScopes: string[];
}): string[] {
  const issues: string[] = [];
  if (input.integration.status !== "active") {
    issues.push("integration_not_active");
  }
  if (!input.appConfigured) {
    issues.push("app_id_missing");
  }
  if (!input.credentialsConfigured) {
    issues.push("credentials_incomplete");
  }
  if (input.healthStatus === "unknown") {
    issues.push("health_not_checked");
  } else if (input.healthStatus !== "healthy") {
    issues.push(`health_${input.healthStatus}`);
  }
  if (input.activeChannelBindingCount === 0) {
    issues.push("channel_binding_missing");
  }
  if (input.activeUserBindingCount === 0) {
    issues.push("user_binding_missing");
  }
  if (input.missingBotScopes.length > 0) {
    issues.push("bot_scope_missing");
  }
  if (input.docResourceCount === 0) {
    issues.push("doc_resource_binding_missing");
  } else if (input.docWritableResourceCount === 0) {
    issues.push("doc_resource_write_grant_missing");
  }
  if (input.sheetResourceCount === 0) {
    issues.push("sheet_resource_binding_missing");
  } else if (input.sheetWritableResourceCount === 0) {
    issues.push("sheet_resource_write_grant_missing");
  }
  if (input.baseResourceCount === 0) {
    issues.push("base_resource_binding_missing");
  } else if (input.baseReadyResourceCount === 0) {
    issues.push("base_resource_app_token_missing");
  } else if (input.baseWritableResourceCount === 0) {
    issues.push("base_resource_write_grant_missing");
  }
  if (input.missingDataPlaneScopes.length > 0) {
    issues.push("data_plane_scope_missing");
  }
  if (input.failedOutboxCount > 0) {
    issues.push("outbox_failed_items");
  }
  if (input.pendingOutboxWithErrorsCount > 0) {
    issues.push("outbox_retry_errors");
  }
  return issues;
}

function readFeishuReadinessScopeList(scopesJson: string | readonly string[] | null | undefined): string[] {
  if (Array.isArray(scopesJson)) {
    return normalizeFeishuReadinessScopeList(scopesJson);
  }
  if (typeof scopesJson !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(scopesJson) as unknown;
    return Array.isArray(parsed) ? normalizeFeishuReadinessScopeList(parsed) : [];
  } catch {
    return normalizeFeishuReadinessScopeList(scopesJson.split(/\s+/));
  }
}

function normalizeFeishuReadinessScopeList(scopes: readonly unknown[]): string[] {
  return Array.from(new Set(scopes
    .filter((scope): scope is string => typeof scope === "string")
    .map((scope) => scope.trim())
    .filter(Boolean)))
    .sort();
}

function findMissingFeishuReadinessScopes(
  availableScopes: readonly string[],
  requiredScopes: readonly string[],
): string[] {
  if (availableScopes.includes("*")) {
    return [];
  }
  const available = new Set(availableScopes);
  return requiredScopes.filter((scope) => !available.has(scope));
}

function buildFeishuSmokeHarnessSummary(input: {
  workspaceId: string;
  integrationId?: string;
  appUrl?: string;
}): FeishuSmokeHarnessSummary {
  const envExamplePath = "scripts/feishu/env.example";
  const envFilePath = "scripts/feishu/.env";
  const evidencePath = "runtime-output/feishu-smoke/live.json";
  const integrationFlag = input.integrationId ? ` --integration ${input.integrationId}` : "";
  const appUrl = normalizeFeishuCliPublicAppUrl(input.appUrl);
  const appUrlFlag = appUrl ?? FEISHU_CLI_PLACEHOLDERS.publicAppUrl;
  const callbackUrl = appUrl && input.integrationId
    ? buildFeishuCliEventCallbackUrl({
      appUrl,
      workspaceId: input.workspaceId,
      integrationId: input.integrationId,
    })
    : undefined;
  return {
    envExamplePath,
    envFilePath,
    evidencePath,
    ...(appUrl ? { appUrl } : {}),
    ...(callbackUrl ? { callbackUrl } : {}),
    requiredLiveSteps: FEISHU_OPENAPI_REQUIRED_LIVE_SMOKE_STEPS.length,
    destructiveLiveChecks: FEISHU_OPENAPI_REQUIRED_DESTRUCTIVE_LIVE_SMOKE_STEPS.length,
    destructiveLiveStepNames: [...FEISHU_OPENAPI_REQUIRED_DESTRUCTIVE_LIVE_SMOKE_STEPS],
    prepareEnvCommand: `agent-space integrations feishu smoke-env --workspace-id ${input.workspaceId}${integrationFlag} --app-url ${appUrlFlag} > ${envFilePath}`,
    checkEnvCommand: `npm run smoke:feishu -- --env-file ${envFilePath} --check-env --json`,
    strictLiveCommand: `npm run smoke:feishu -- --env-file ${envFilePath} --live --strict-live --evidence ${evidencePath} --json`,
    verifyEvidenceCommand: `npm run smoke:feishu -- --verify-evidence ${evidencePath} --json`,
  };
}

function buildFeishuOpenPlatformSetupSummary(input: {
  hasIntegration: boolean;
  hasAppUrl: boolean;
  callbackUrl?: string;
  requiredCredentialFields?: readonly string[];
}): FeishuOpenPlatformSetupSummary {
  return {
    callbackUrlStatus: input.callbackUrl
      ? "ready"
      : input.hasIntegration && !input.hasAppUrl
        ? "app_url_missing"
        : "integration_missing",
    ...(input.callbackUrl ? { callbackUrl: input.callbackUrl } : {}),
    developerConsoleUrl: FEISHU_OPEN_PLATFORM_CONSOLE_URLS.appList,
    requiredCredentialFields: [...(input.requiredCredentialFields ?? FEISHU_REQUIRED_CREDENTIAL_FIELDS)],
    requiredEvents: [...FEISHU_REQUIRED_EVENTS],
    botScopes: [...FEISHU_BOT_SMOKE_SCOPES],
    dataPlaneScopes: [...FEISHU_DATA_PLANE_SMOKE_SCOPES],
    setupSteps: buildFeishuOpenPlatformSetupSteps(),
  };
}

function resolveFeishuCliOpenPlatformRequiredCredentialFields(
  integration: FeishuIntegrationReadiness | undefined,
): readonly string[] {
  if (!integration || (integration.agentId && integration.transportMode === "websocket_worker")) {
    return FEISHU_AGENT_BOT_REQUIRED_CREDENTIAL_FIELDS;
  }
  return FEISHU_REQUIRED_CREDENTIAL_FIELDS;
}

function buildFeishuOpenPlatformSetupSteps(): FeishuOpenPlatformSetupStep[] {
  return FEISHU_OPEN_PLATFORM_SETUP_STEPS.map((step) => ({
    id: step.id,
    consoleUrl: step.consoleUrl,
    required: [...step.required],
  }));
}

function buildFeishuRuntimeSetupSummary(env: Record<string, string | undefined> = process.env): FeishuRuntimeSetupSummary {
  return {
    credentialEncryption: buildFeishuCredentialEncryptionReadiness(env),
  };
}

function buildFeishuCredentialEncryptionReadiness(
  env: Record<string, string | undefined>,
): FeishuCredentialEncryptionReadiness {
  const checkedEnvNames = [
    "AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY",
    "AGENT_SPACE_INTEGRATION_CREDENTIAL_ENCRYPTION_KEY",
  ];
  const configuredEnvName = checkedEnvNames.find((envName) => Boolean(env[envName]?.trim()));
  if (!configuredEnvName) {
    return {
      status: "missing",
      checkedEnvNames,
      issue: "credential_encryption_key_missing",
    };
  }

  const key = Buffer.from(env[configuredEnvName]?.trim() ?? "", "base64");
  if (key.length !== 32) {
    return {
      status: "invalid",
      checkedEnvNames,
      configuredEnvName,
      issue: "credential_encryption_key_invalid",
    };
  }

  return {
    status: "ready",
    checkedEnvNames,
    configuredEnvName,
  };
}

function renderFeishuSmokeEnvTemplate(report: FeishuSmokeEnvTemplateReport): string {
  const lines = [
    "# AgentSpace Feishu smoke env",
    "# Generated by: agent-space integrations feishu smoke-env",
    `# Workspace: ${report.workspaceId}`,
    `# Integration: ${report.selectedIntegrationId ?? "missing"}`,
    "# Secrets are placeholders. Fill them from the Feishu developer console or the integration setup.",
  ];
  if (report.issues.length > 0) {
    lines.push(`# Issues: ${report.issues.join(", ")}`);
  }
  lines.push("");
  for (const entry of report.entries) {
    if (entry.note) {
      lines.push(`# ${entry.note}`);
    }
    if (entry.secret) {
      lines.push(`# secret: ${entry.key}`);
    }
    lines.push(`${entry.key}=${entry.value}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function formatFeishuSmokeEnvCommandText(
  report: FeishuSmokeEnvTemplateReport,
): { stdout?: string; stderr?: string } {
  if (report.issues.length > 0) {
    return {
      stderr: `Feishu smoke-env is not ready (${report.issues.join(", ")}). Fix the AgentSpace Feishu integration setup and rerun smoke-env; no env template was printed.`,
    };
  }

  return {
    stdout: renderFeishuSmokeEnvTemplate(report),
  };
}

export function getFeishuSmokeEnvExitCode(report: Pick<FeishuSmokeEnvTemplateReport, "issues">): number {
  return report.issues.length > 0 ? 1 : 0;
}

function buildFeishuCliEventCallbackUrl(input: {
  appUrl: string;
  workspaceId: string;
  integrationId: string;
}): string {
  const searchParams = new URLSearchParams({
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
  });
  return buildFeishuCliPublicUrl(`${FEISHU_EVENT_CALLBACK_PATH}?${searchParams.toString()}`, input.appUrl);
}

function buildFeishuCliPublicUrl(path: string, appUrl: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(normalizedPath, appUrl.endsWith("/") ? appUrl : `${appUrl}/`).toString();
}

function readFeishuCliPublicAppUrl(): string | undefined {
  return normalizeFeishuCliPublicAppUrl(
    process.env.AGENT_SPACE_APP_URL?.trim()
    || process.env.NEXT_PUBLIC_AGENT_SPACE_APP_URL?.trim()
    || process.env.NEXT_PUBLIC_APP_URL?.trim(),
  );
}

function normalizeFeishuCliPublicAppUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (isFeishuCliPlaceholderValue(value)) {
    return undefined;
  }
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function buildFeishuHealthCheckCliItem(input: {
  integration: ExternalIntegrationRecord;
  health: FeishuHealthCheckResult;
  errorMessage?: string;
  persisted: boolean;
}): FeishuHealthCheckCliItem {
  return {
    id: input.integration.id,
    displayName: input.integration.displayName,
    agentId: input.integration.agentId,
    status: input.health.status,
    previousHealthStatus: input.integration.lastHealthStatus,
    checkedAt: input.health.checkedAt,
    botAppName: input.health.botAppName,
    scopeReadiness: input.health.scopeReadiness,
    enabledScopeCount: input.health.enabledScopes?.length,
    missingScopes: input.health.missingScopes,
    errorCode: resolveFeishuHealthCliErrorCode(input.health),
    errorMessage: input.errorMessage,
    persisted: input.persisted,
  };
}

function resolveFeishuHealthCliErrorCode(health: FeishuHealthCheckResult): string | undefined {
  if (health.status === "healthy") {
    return undefined;
  }
  if (health.scopeReadiness === "missing_required_scopes") {
    return "feishu.integration.scope_missing";
  }
  if (health.scopeReadiness === "unauthorized") {
    return "feishu.integration.scope_unauthorized";
  }
  if (health.scopeReadiness === "manual_review_required") {
    return "feishu.integration.scope_manual_review_required";
  }
  return "feishu.integration.connection_failed";
}

function sanitizeFeishuCliHealthErrorMessage(
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
    if (!value) {
      continue;
    }
    sanitized = sanitized.split(value).join("[redacted]");
  }
  return sanitized.slice(0, 1000);
}

function buildFeishuWorkerHarnessSummary(input: {
  workspaceId: string;
  integrationId?: string;
}): FeishuWorkerHarnessSummary {
  const systemdUnitPath = "deploy/systemd/agentspace-feishu-worker.service";
  const systemdEnvExamplePath = "deploy/systemd/agentspace-feishu-worker.env.example";
  const dockerComposePath = "deploy/feishu-worker/docker-compose.yml";
  const dockerEnvExamplePath = "deploy/feishu-worker/feishu-worker.env.example";
  const integrationFlag = input.integrationId ? ` --integration ${input.integrationId}` : "";
  return {
    ...(input.integrationId ? { integrationId: input.integrationId } : {}),
    systemdUnitPath,
    systemdEnvExamplePath,
    dockerComposePath,
    dockerEnvExamplePath,
    dryRunCommand:
      `agent-space integrations feishu worker --workspace-id ${input.workspaceId}${integrationFlag} --dry-run --json`,
    startCommand: `agent-space integrations feishu worker --workspace-id ${input.workspaceId}${integrationFlag} --json`,
    systemdRestartCommand: "sudo systemctl restart agentspace-feishu-worker && sudo systemctl status agentspace-feishu-worker --no-pager",
    dockerRestartCommand: `docker compose -f ${dockerComposePath} restart feishu-worker && docker compose -f ${dockerComposePath} logs --tail=100 feishu-worker`,
  };
}

function selectFeishuReadinessCandidate(
  items: readonly FeishuIntegrationReadiness[],
  gate: FeishuRequiredReadiness,
): FeishuIntegrationReadiness | undefined {
  return [...items].sort((left, right) => {
    const scoreDelta = scoreFeishuReadinessCandidate(right, gate) - scoreFeishuReadinessCandidate(left, gate);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return `${left.displayName}:${left.id}`.localeCompare(`${right.displayName}:${right.id}`);
  })[0];
}

function isFeishuReadinessSatisfied(
  item: FeishuIntegrationReadiness,
  gate: FeishuRequiredReadiness,
): boolean {
  if (gate === "data-plane") {
    return item.readyForDataPlaneSmoke;
  }
  if (gate === "worker") {
    return item.readyForWorkerSmoke;
  }
  return item.readyForBotSmoke;
}

function scoreFeishuReadinessCandidate(
  item: FeishuIntegrationReadiness,
  gate: FeishuRequiredReadiness,
): number {
  let score = 0;
  if (gate === "bot" && item.readyForBotSmoke) {
    score += 100;
  }
  if (gate === "data-plane" && item.readyForDataPlaneSmoke) {
    score += 100;
  }
  if (gate === "worker" && item.readyForWorkerSmoke) {
    score += 100;
  }
  if (item.status === "active") {
    score += 8;
  }
  if (item.appConfigured) {
    score += 4;
  }
  if (item.credentialsConfigured) {
    score += 4;
  }
  if (item.healthStatus !== "unknown" && item.healthStatus !== "error") {
    score += 4;
  }
  if (item.healthStatus === "healthy") {
    score += 2;
  }
  if (item.channelBindings.active > 0) {
    score += 4;
  }
  if (item.userBindings.active > 0) {
    score += 4;
  }
  if (item.scopes.missingForBotSmoke.length === 0) {
    score += 4;
  }
  if (gate === "worker" && item.transportMode === "websocket_worker") {
    score += 12;
  }
  if (gate === "data-plane") {
    if (item.resourceBindings.docWritable > 0) {
      score += 2;
    }
    if (item.resourceBindings.sheetWritable > 0) {
      score += 2;
    }
    if (item.resourceBindings.baseWritable > 0) {
      score += 2;
    }
    if (item.scopes.missingForDataPlaneSmoke.length === 0) {
      score += 4;
    }
  }
  return score;
}

function prereqStatus(
  hasIntegration: boolean,
  conditionMet: boolean,
): FeishuSmokePlanStep["status"] {
  if (conditionMet) {
    return "done";
  }
  return hasIntegration ? "pending" : "blocked";
}

function collectSetupIssues(
  candidate: FeishuIntegrationReadiness | undefined,
  issueCodes: readonly string[],
): string[] {
  if (!candidate) {
    return ["integration_missing"];
  }
  const issueSet = new Set(issueCodes);
  return candidate.issues.filter((issue) => issueSet.has(issue));
}

function collectDataPlaneBindingIssues(input: {
  hasDocBinding: boolean;
  hasAnyDocBinding: boolean;
  hasSheetBinding: boolean;
  hasAnySheetBinding: boolean;
  hasBaseBinding: boolean;
  hasAnyBaseBinding: boolean;
  hasBaseReadyBinding: boolean;
}): string[] {
  const issues: string[] = [];
  if (!input.hasDocBinding) {
    issues.push(input.hasAnyDocBinding ? "doc_resource_write_grant_missing" : "doc_resource_binding_missing");
  }
  if (!input.hasSheetBinding) {
    issues.push(input.hasAnySheetBinding ? "sheet_resource_write_grant_missing" : "sheet_resource_binding_missing");
  }
  if (!input.hasBaseBinding) {
    issues.push(
      !input.hasAnyBaseBinding
        ? "base_resource_binding_missing"
        : input.hasBaseReadyBinding
          ? "base_resource_write_grant_missing"
          : "base_resource_app_token_missing",
    );
  }
  return issues;
}

function buildFeishuWorkerSmokeIssues(
  candidate: FeishuIntegrationReadiness | undefined,
  botIssues: readonly string[],
): string[] {
  if (!candidate) {
    return ["websocket_worker_integration_missing"];
  }
  return uniqueStrings([
    ...(candidate.transportMode === "websocket_worker" ? [] : ["websocket_worker_integration_missing"]),
    ...candidate.issues.filter((issue) =>
      issue === "integration_not_active" ||
      issue === "app_id_missing" ||
      issue === "credentials_incomplete" ||
      issue === "health_not_checked" ||
      issue === "health_error" ||
      issue === "channel_binding_missing" ||
      issue === "user_binding_missing" ||
      issue === "bot_scope_missing"
    ),
    ...botIssues.filter((issue) =>
      issue === "channel_binding_missing" ||
      issue === "user_binding_missing" ||
      issue === "bot_scope_missing"
    ),
  ]);
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function formatIntegrationLabel(candidate: FeishuIntegrationReadiness | undefined): string {
  if (!candidate) {
    return "the selected Feishu integration";
  }
  return `${candidate.displayName} (${candidate.id})`;
}

function hasBooleanFlag(flags: Record<string, string | boolean>, key: string): boolean {
  const value = flags[key];
  return value === true || value === "true" || value === "1";
}

function hasHelpFlag(flags: Record<string, string | boolean>): boolean {
  return flags.help === true || flags.h === true;
}

function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      process.off("SIGINT", finish);
      process.off("SIGTERM", finish);
      resolve();
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}

function printFeishuIntegrationHelp(): void {
  console.log(`Usage:
  agent-space integrations feishu create --workspace-id <id> [--env-file scripts/feishu/.env] --app-id-env FEISHU_APP_ID --app-secret-env FEISHU_APP_SECRET --verification-token-env FEISHU_VERIFICATION_TOKEN [--encrypt-key-env FEISHU_ENCRYPT_KEY] [--tenant-key-env FEISHU_TENANT_KEY] [--name <name>] [--transport http_webhook|websocket_worker] [--app-url <url>] [--json]
  agent-space integrations feishu bind-agent-bot --workspace-id <id> --agent <agent-id-or-name> [--env-file scripts/feishu/.env] --app-id-env FEISHU_APP_ID --app-secret-env FEISHU_APP_SECRET [--transport websocket_worker|http_webhook] [--verification-token-env FEISHU_VERIFICATION_TOKEN] [--encrypt-key-env FEISHU_ENCRYPT_KEY] [--tenant-key-env FEISHU_TENANT_KEY] [--json]
  agent-space integrations feishu rotate-agent-bot-secret --workspace-id <id> (--agent <agent-id-or-name>|--integration <id>) [--env-file scripts/feishu/.env] --app-secret-env FEISHU_APP_SECRET [--app-id-env FEISHU_APP_ID] [--json]
  agent-space integrations feishu disable-agent-bot --workspace-id <id> (--agent <agent-id-or-name>|--integration <id>) [--json]
  agent-space integrations feishu auto-provision-policy --workspace-id <id> (--agent <agent-id-or-name>|--integration <id>) [--bot-added-policy auto_create_channel|pending_admin_review|disabled] [--first-message-policy auto_create_if_bot_mentioned|pending_admin_review|reply_with_setup_card|disabled] [--review-status approved|pending_admin_review|needs_identity_binding] [--unbound-user-mode ignore|reply_on_mention|reply_all|require_identity] [--guest-permission-profile none|channel_context_only|channel_readonly] [--require-identity-for writes,approvals] [--json]
  agent-space integrations feishu agent-bot-readiness --workspace-id <id> [--agent <agent-id-or-name>|--integration <id>] [--strict] [--require bot|data-plane|worker] [--json]
  agent-space integrations feishu worker [--workspace-id <id>] [--integration <id>] [--limit <n>] [--base-url <url>] [--domain <host>] [--locked-by <id>] [--dry-run] [--include-webhook] [--drain-outbox|--once] [--json]
  agent-space integrations feishu readiness [--workspace-id <id>] [--integration <id>] [--strict] [--require bot|data-plane|worker] [--json]
  agent-space integrations feishu smoke-plan [--workspace-id <id>] [--integration <id>] [--app-url <url>] [--strict] [--require bot|data-plane|worker] [--json]
  agent-space integrations feishu smoke-env [--workspace-id <id>] [--integration <id>] [--app-url <url>] [--json]
  agent-space integrations feishu health-check [--workspace-id <id>] [--integration <id>|--agent <agent-id-or-name>] [--base-url <url>] [--dry-run] [--strict] [--json]
  agent-space integrations feishu evidence [--workspace-id <id>] [--integration <id>] [--openapi-evidence <path>] [--strict] [--require bot|native|guest-policy|data-plane|worker|failure|all] [--json]
  agent-space integrations feishu data-operation --workspace-id <id> --integration <id> --operation read-doc|plan-doc-create|plan-doc-update|plan-doc-append|read-sheet|query-base|plan-sheet-write|plan-base-update --resource <url-or-token> [--type doc|sheet|base|base_table|base_view] [--title <doc-title>] [--folder-token <folder-token>] [--parent-block-id <block-id>] [--block-id <block-id>] [--document-revision-id <n>] [--client-token <token>] [--blocks-json <json>] [--children-json <json>] [--block-json <json>] [--app-token <base-app-token>] [--table-id <base-table-id>] [--range <sheet-range>] [--values-json <json>] [--record-id <id>] [--fields-json <json>] [--approval-agent <agent-id> --approval-channel <channel>] [--json]
  agent-space integrations feishu review-data-operation --workspace-id <id> --approval-id <approval-id> --decision approved|rejected [--comment <text>] [--base-url <url>] [--json]
  agent-space integrations feishu channel-bindings --workspace-id <id> [--integration <id>] [--status active|disabled|archived] [--json]
  agent-space integrations feishu bind-channel --workspace-id <id> --integration <id> --channel <name> --chat-id <oc_xxx> [--chat-type group|p2p] [--chat-name <name>] [--json]
  agent-space integrations feishu bind-user --workspace-id <id> --integration <id> --user-id <agent-space-user-id> --open-id <ou_xxx> [--union-id <on_xxx>] [--feishu-user-id <id>] [--json]
  agent-space integrations feishu bind-resource --workspace-id <id> --integration <id> --type doc|sheet|base|base_table|base_view --resource <url-or-token> --agent-space-type channel_document|data_table|knowledge_page [--agent-space-id <id>] [--channel <name>] [--allow-write] [--guest-readable] [--json]

Options:
  --workspace-id <id>      AgentSpace workspace id; defaults to AGENT_SPACE_WORKSPACE_ID or default
  --integration <id>       Limit the worker, drain, readiness, or health run to one Feishu integration
  --agent <id-or-name>     Agent bot commands: AgentSpace agent id/name to bind to a Feishu bot
  --env-file <path>        Create: read FEISHU_* credentials from a local KEY=value file; process env wins
  --app-id-env <name>      Create/bind: read Feishu app id from an env var; defaults also check FEISHU_APP_ID
  --app-secret-env <name>  Create/bind/rotate: read Feishu app secret from an env var; defaults also check FEISHU_APP_SECRET
  --verification-token-env <name> Create/bind: read verification token from an env var; defaults also check FEISHU_VERIFICATION_TOKEN
  --encrypt-key-env <name> Create/bind: read encrypt key from an env var; defaults also check FEISHU_ENCRYPT_KEY
  --app-id <id>            Create/bind fallback for Feishu app id
  --app-secret <secret>    Create/bind/rotate fallback for Feishu app secret; env input is preferred
  --verification-token <token> Create/bind fallback for event verification token; env input is preferred
  --encrypt-key <key>      Create/bind fallback for event encrypt key; env input is preferred
  --bot-added-policy <mode> Agent bot bind/policy: auto_create_channel|pending_admin_review|disabled
  --first-message-policy <mode> Agent bot bind/policy: auto_create_if_bot_mentioned|pending_admin_review|reply_with_setup_card|disabled
  --review-status <status> Agent bot bind/policy: approved|pending_admin_review|needs_identity_binding for auto-provisioned channels
  --unbound-user-mode <mode> Agent bot bind/policy: ignore|reply_on_mention|reply_all|require_identity
  --guest-permission-profile <profile> Agent bot bind/policy: none|channel_context_only|channel_readonly
  --require-identity-for <csv> Agent bot bind/policy: comma-separated operations that require a bound AgentSpace identity
  --guest-readable       Resource bind: allow external guests to read this bound resource in its current channel
  --limit <n>              Outbox drain batch size; defaults to 50
  --base-url <url>         Feishu OpenAPI base URL; defaults to AGENT_SPACE_FEISHU_API_BASE_URL
  --app-url <url>          Public AgentSpace URL used by smoke-plan/smoke-env callback values
  --title <text>           Data operation: Feishu Doc create title; stored output only reports length
  --folder-token <token>   Data operation: Feishu Doc create folder token when different from --resource
  --parent-block-id <id>   Data operation: Feishu Doc append/create child blocks under this block
  --block-id <id>          Data operation: Feishu Doc update target block
  --document-revision-id <n> Data operation: Feishu Doc mutation revision guard
  --client-token <token>   Data operation: Feishu Doc mutation idempotency token
  --app-token <token>      Data operation: Feishu Base app token when --resource is a Base table/view id
  --table-id <id>          Data operation: Feishu Base table id when --type base/base_view is used
  --approval-agent <id>    Data operation write plans: also create a pending AgentSpace approval request for this agent
  --approval-channel <name> Data operation write plans: approval channel used with --approval-agent
  --approval-preview <text> Data operation write plans: optional safe approval preview text
  --approval-id <id>       Review data operation: approval id returned by a write plan or shown in AgentSpace approvals
  --decision <value>       Review data operation: approved/approve or rejected/reject
  --status <value>         Binding list filter: active|disabled|archived
  --domain <host>          Feishu WebSocket domain; defaults to AGENT_SPACE_FEISHU_WS_DOMAIN
  --locked-by <id>         Worker lock owner; defaults to AGENT_SPACE_FEISHU_WORKER_ID or agent-space-feishu-worker
  --dry-run                Validate WebSocket worker config without opening live connections
  --include-webhook        Include http_webhook integrations in dry-run/start selection
  --drain-outbox, --once   Drain due Feishu outbox messages once without opening WebSocket connections
  create                   Create a workspace-level AgentSpace Feishu integration with encrypted credentials
  bind-agent-bot           Bind one AgentSpace agent to one Feishu bot; default transport only needs App ID + App Secret
  rotate-agent-bot-secret  Rotate an existing agent bot binding secret without exposing it in output
  disable-agent-bot        Disable an existing agent bot binding
  auto-provision-policy    View/update agent bot auto-provisioning and external guest policy
  agent-bot-readiness      Summarize readiness for agent-scoped Feishu bot bindings
  readiness                Summarize local AgentSpace-side prerequisites for Feishu manual smoke
  smoke-plan               Generate the live Feishu manual smoke checklist from current local readiness
  smoke-env                Print a safe scripts/feishu/.env template with placeholders for secrets/resources
  health-check             Refresh saved Feishu health/scope status; --dry-run skips persistence
  evidence                 Summarize AgentSpace-side Feishu live smoke evidence from local DB state
  data-operation           Run a bound Feishu read or create a governed pending write/approval operation; output redacts resource tokens
  review-data-operation    Approve/reject a Feishu data operation approval and execute approved writes through AgentSpace governance
  channel-bindings         List Feishu chat -> AgentSpace channel bindings with redacted chat references
  bind-channel             Create/update a Feishu chat -> AgentSpace channel binding; output redacts chat id
  bind-user                Create/update a Feishu Open ID -> AgentSpace user binding; output redacts external ids
  bind-resource            Create/update a Feishu Docs/Sheets/Base resource binding; output redacts resource tokens
  --openapi-evidence <path> Evidence: also verify redacted strict live smoke artifact from npm run smoke:feishu
  --strict                 Readiness/smoke-plan/evidence: require matching proof; health-check: require all healthy
  --require <kind>         Gate to enforce: bot, data-plane, worker; evidence also accepts native, guest-policy, failure, or all
  --json                   Print machine-readable output`);
}
