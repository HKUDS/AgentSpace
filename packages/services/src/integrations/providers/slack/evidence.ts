import {
  listExternalChannelBindingsSync,
  listExternalIntegrationEventsSync,
  listExternalIntegrationsSync,
  listExternalMessageMappingsSync,
  listExternalMessageOutboxSync,
  listExternalUserBindingsSync,
  type ExternalChannelBindingRecord,
  type ExternalIntegrationEventRecord,
  type ExternalIntegrationRecord,
  type ExternalMessageMappingRecord,
  type ExternalMessageOutboxRecord,
  type ExternalUserBindingRecord,
} from "@agent-space/db";
import { SLACK_PROVIDER_ID } from "./constants.ts";
import { buildSlackReference } from "./events.ts";

export type SlackEvidenceRequirement = "message" | "native" | "approval" | "files" | "all";

export interface SlackEvidenceReport {
  workspaceId: string;
  provider: typeof SLACK_PROVIDER_ID;
  generatedAt: string;
  required: SlackEvidenceRequirement;
  strict: boolean;
  integrationCount: number;
  strictSatisfied: boolean;
  summary: {
    messageSatisfiedCount: number;
    nativeSatisfiedCount: number;
    approvalSatisfiedCount: number;
    filesSatisfiedCount: number;
    unresolvedFailureCount: number;
  };
  liveSmokeEvidence?: SlackLiveSmokeEvidenceVerification;
  integrations: SlackEvidenceIntegrationItem[];
  nextCommands: string[];
}

export interface SlackLiveSmokeEvidenceVerification {
  present: boolean;
  valid: boolean;
  evidencePath?: string;
  issues: string[];
  summary?: {
    generatedAtPresent: boolean;
    generatedAtFresh: boolean;
    runCount: number;
    postMessageLiveOk: boolean;
    appMentionLiveOk: boolean;
    fileUploadLiveOk: boolean;
    unsafeRawValueCount: number;
  };
}

export interface SlackEvidenceIntegrationItem {
  integrationId: string;
  displayName: string;
  status: ExternalIntegrationRecord["status"];
  transportMode: ExternalIntegrationRecord["transportMode"];
  agentId?: string | null;
  healthStatus?: ExternalIntegrationRecord["lastHealthStatus"];
  appRef?: string;
  teamRef?: string;
  bindings: {
    activeChannels: number;
    activeUsers: number;
  };
  message: {
    satisfied: boolean;
    processedInboundEvents: number;
    inboundMappings: number;
    agentTaskQueueEvidence: number;
    outboundMappings: number;
    sentOutbox: number;
  };
  nativeExperience: {
    satisfied: boolean;
    agentContextEvidence: number;
    appHomeWelcomeEvidence: number;
    suggestedPromptsEvidence: number;
  };
  approvals: {
    satisfied: boolean;
    processedBlockActions: number;
    failedBlockActions: number;
    approvalStatusOutbox: number;
  };
  files: {
    satisfied: boolean;
    inboundFileMetadataEvents: number;
    inboundFileMetadataMappings: number;
    storedAttachmentEvidence: number;
    outboundUploadEvidence: number;
    unsafeFileMetadataRows: number;
  };
  failures: {
    failedEvents: number;
    failedOutbox: number;
    pendingOutbox: number;
  };
  blockers: string[];
  warnings: string[];
  requiredSatisfied: boolean;
  nextCommands: string[];
}

interface SlackEvidenceDependencies {
  listIntegrations?: typeof listExternalIntegrationsSync;
  listChannelBindings?: typeof listExternalChannelBindingsSync;
  listUserBindings?: typeof listExternalUserBindingsSync;
  listEvents?: typeof listExternalIntegrationEventsSync;
  listMessageMappings?: typeof listExternalMessageMappingsSync;
  listOutbox?: typeof listExternalMessageOutboxSync;
}

export function buildSlackEvidenceReport(input: {
  workspaceId: string;
  integrationId?: string;
  strict?: boolean;
  required?: SlackEvidenceRequirement;
  liveSmokeEvidencePath?: string;
  liveSmokeEvidence?: unknown;
  requireLiveSmokeEvidence?: boolean;
  dependencies?: SlackEvidenceDependencies;
}): SlackEvidenceReport {
  const dependencies = input.dependencies ?? {};
  const required = input.required ?? "message";
  const integrations = (dependencies.listIntegrations ?? listExternalIntegrationsSync)({
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
    includeDisabled: true,
  }).filter((integration) =>
    !input.integrationId || integration.id === input.integrationId
  );
  const items = integrations.map((integration) => buildSlackEvidenceIntegrationItem({
    workspaceId: input.workspaceId,
    integration,
    required,
    dependencies,
  }));
  const liveSmokeEvidence = input.requireLiveSmokeEvidence ||
    input.liveSmokeEvidencePath ||
    input.liveSmokeEvidence !== undefined
    ? verifySlackLiveSmokeEvidence({
      evidencePath: input.liveSmokeEvidencePath,
      evidence: input.liveSmokeEvidence,
      requireFileUploadEvidence: required === "files" || required === "all",
    })
    : undefined;
  const strictSatisfied = items.some((item) => item.requiredSatisfied) &&
    (!liveSmokeEvidence || liveSmokeEvidence.valid);
  return {
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
    generatedAt: new Date().toISOString(),
    required,
    strict: Boolean(input.strict),
    integrationCount: items.length,
    strictSatisfied,
    summary: {
      messageSatisfiedCount: items.filter((item) => item.message.satisfied).length,
      nativeSatisfiedCount: items.filter((item) => item.nativeExperience.satisfied).length,
      approvalSatisfiedCount: items.filter((item) => item.approvals.satisfied).length,
      filesSatisfiedCount: items.filter((item) => item.files.satisfied).length,
      unresolvedFailureCount: items.reduce((count, item) => count + item.failures.failedEvents + item.failures.failedOutbox, 0),
    },
    ...(liveSmokeEvidence ? { liveSmokeEvidence } : {}),
    integrations: items,
    nextCommands: buildSlackEvidenceNextCommands(input.workspaceId, input.integrationId, required),
  };
}

export function verifySlackLiveSmokeEvidence(input: {
  evidencePath?: string;
  evidence?: unknown;
  requireFileUploadEvidence?: boolean;
}): SlackLiveSmokeEvidenceVerification {
  const artifact = parseJsonRecord(input.evidence);
  if (!artifact) {
    return {
      present: false,
      valid: false,
      ...(input.evidencePath ? { evidencePath: input.evidencePath } : {}),
      issues: ["slack_live_smoke_evidence_missing"],
    };
  }

  const generatedAt = readJsonStringFieldFromRecord(artifact, "generatedAt");
  const generatedAtFresh = generatedAt ? isFreshIsoTimestamp(generatedAt, 24 * 60 * 60 * 1000) : false;
  const runs = readSlackLiveSmokeEvidenceRuns(artifact);
  const postMessageLiveOk = runs.some((run) => {
    const liveResult = parseJsonRecord(run.liveResult);
    return readJsonStringFieldFromRecord(run, "mode") === "live" &&
      run.ready === true &&
      liveResult?.ok === true &&
      readJsonStringFieldFromRecord(liveResult, "mode") === "post_message";
  });
  const appMentionLiveOk = runs.some((run) => {
    const liveResult = parseJsonRecord(run.liveResult);
    return readJsonStringFieldFromRecord(run, "mode") === "live" &&
      run.ready === true &&
      liveResult?.ok === true &&
      liveResult.appMentionText === true &&
      readJsonStringFieldFromRecord(liveResult, "mode") === "app_mention";
  });
  const fileUploadLiveOk = runs.some((run) => {
    const liveResult = parseJsonRecord(run.liveResult);
    return readJsonStringFieldFromRecord(run, "mode") === "live" &&
      run.ready === true &&
      liveResult?.ok === true &&
      liveResult.fileUpload === true &&
      liveResult.uploadCompleted === true &&
      readJsonStringFieldFromRecord(liveResult, "mode") === "file_upload";
  });
  const unsafeRawValueCount = countUnsafeSlackLiveSmokeEvidenceValues(artifact);
  const issues = [
    ...(generatedAt ? [] : ["slack_live_smoke_generated_at_missing"]),
    ...(generatedAtFresh ? [] : ["slack_live_smoke_evidence_stale"]),
    ...(postMessageLiveOk ? [] : ["slack_live_post_message_evidence_missing"]),
    ...(appMentionLiveOk ? [] : ["slack_live_app_mention_evidence_missing"]),
    ...(!input.requireFileUploadEvidence || fileUploadLiveOk ? [] : ["slack_live_file_upload_evidence_missing"]),
    ...(unsafeRawValueCount === 0 ? [] : ["slack_live_smoke_evidence_unsafe"]),
  ];

  return {
    present: true,
    valid: issues.length === 0,
    ...(input.evidencePath ? { evidencePath: input.evidencePath } : {}),
    issues,
    summary: {
      generatedAtPresent: Boolean(generatedAt),
      generatedAtFresh,
      runCount: runs.length,
      postMessageLiveOk,
      appMentionLiveOk,
      fileUploadLiveOk,
      unsafeRawValueCount,
    },
  };
}

function buildSlackEvidenceIntegrationItem(input: {
  workspaceId: string;
  integration: ExternalIntegrationRecord;
  required: SlackEvidenceRequirement;
  dependencies: SlackEvidenceDependencies;
}): SlackEvidenceIntegrationItem {
  const { integration } = input;
  const channelBindings = (input.dependencies.listChannelBindings ?? listExternalChannelBindingsSync)({
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    status: "active",
  });
  const userBindings = (input.dependencies.listUserBindings ?? listExternalUserBindingsSync)({
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    status: "active",
  });
  const events = (input.dependencies.listEvents ?? listExternalIntegrationEventsSync)({
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
    integrationId: integration.id,
    limit: 200,
  });
  const mappings = (input.dependencies.listMessageMappings ?? listExternalMessageMappingsSync)({
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    limit: 500,
  });
  const outbox = (input.dependencies.listOutbox ?? listExternalMessageOutboxSync)({
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    limit: 500,
  });

  const message = buildMessageEvidence(events, mappings, outbox, channelBindings, userBindings, integration);
  const nativeExperience = buildNativeEvidence(events, mappings, outbox);
  const approvals = buildApprovalEvidence(events, outbox);
  const files = buildFileEvidence(events, mappings, outbox);
  const failures = {
    failedEvents: events.filter((event) => event.status === "failed").length,
    failedOutbox: outbox.filter((item) => item.status === "failed").length,
    pendingOutbox: outbox.filter((item) => item.status === "pending").length,
  };
  const blockers = [
    ...(message.satisfied ? [] : buildSlackMessageEvidenceBlockers(message, integration, channelBindings, userBindings, failures)),
    ...(input.required === "native" || input.required === "all"
      ? nativeExperience.satisfied ? [] : buildSlackNativeEvidenceBlockers(nativeExperience)
      : []),
    ...(input.required === "approval" || input.required === "all"
      ? approvals.satisfied ? [] : ["slack_approval_block_action_evidence_missing"]
      : []),
    ...(input.required === "files" || input.required === "all"
      ? files.satisfied ? [] : buildSlackFileEvidenceBlockers(files)
      : []),
  ];
  const warnings = [
    ...(failures.pendingOutbox > 0 ? ["pending_outbox_messages"] : []),
    ...(failures.failedEvents > 0 ? ["failed_events_visible"] : []),
    ...(failures.failedOutbox > 0 ? ["failed_outbox_visible"] : []),
  ];
  const requiredSatisfied = isSlackEvidenceRequirementSatisfied(input.required, {
    message: message.satisfied,
    native: nativeExperience.satisfied,
    approval: approvals.satisfied,
    files: files.satisfied,
  });
  return {
    integrationId: integration.id,
    displayName: integration.displayName,
    status: integration.status,
    transportMode: integration.transportMode,
    agentId: integration.agentId,
    healthStatus: integration.lastHealthStatus,
    appRef: integration.appId ? buildSlackReference(integration.appId) : undefined,
    teamRef: integration.tenantKey ? buildSlackReference(integration.tenantKey) : undefined,
    bindings: {
      activeChannels: channelBindings.length,
      activeUsers: userBindings.length,
    },
    message,
    nativeExperience,
    approvals,
    files,
    failures,
    blockers: Array.from(new Set(blockers)),
    warnings: Array.from(new Set(warnings)),
    requiredSatisfied,
    nextCommands: buildSlackEvidenceIntegrationNextCommands(input.workspaceId, integration.id),
  };
}

function buildMessageEvidence(
  events: ExternalIntegrationEventRecord[],
  mappings: ExternalMessageMappingRecord[],
  outbox: ExternalMessageOutboxRecord[],
  channelBindings: ExternalChannelBindingRecord[],
  userBindings: ExternalUserBindingRecord[],
  integration: ExternalIntegrationRecord,
): SlackEvidenceIntegrationItem["message"] {
  const processedInboundEvents = events.filter((event) =>
    event.status === "processed" &&
    (event.eventType === "event_callback.app_mention" || event.eventType === "event_callback.message")
  ).length;
  const inboundMappings = mappings.filter((mapping) => mapping.direction === "inbound").length;
  const agentTaskQueueEvidence = mappings.filter((mapping) =>
    mapping.direction === "inbound" && hasSlackAgentTaskQueueEvidence(mapping, integration)
  ).length;
  const outboundMappings = mappings.filter((mapping) => mapping.direction === "outbound" && !isSlackAppHomeWelcomeMapping(mapping)).length;
  const sentOutbox = outbox.filter((item) => item.status === "sent").length;
  const failedOutbox = outbox.filter((item) => item.status === "failed").length;
  const satisfied = integration.status === "active" &&
    channelBindings.length > 0 &&
    userBindings.length > 0 &&
    processedInboundEvents > 0 &&
    inboundMappings > 0 &&
    agentTaskQueueEvidence > 0 &&
    (outboundMappings > 0 || sentOutbox > 0) &&
    failedOutbox === 0;
  return {
    satisfied,
    processedInboundEvents,
    inboundMappings,
    agentTaskQueueEvidence,
    outboundMappings,
    sentOutbox,
  };
}

function buildNativeEvidence(
  events: ExternalIntegrationEventRecord[],
  mappings: ExternalMessageMappingRecord[],
  outbox: ExternalMessageOutboxRecord[],
): SlackEvidenceIntegrationItem["nativeExperience"] {
  const agentContextEvidence = events.filter((event) => hasSlackAgentContextEvidence(event.payloadJson)).length +
    mappings.filter((mapping) => hasSlackAgentContextEvidence(mapping.metadataJson)).length;
  const appHomeWelcomeEvidence = mappings.filter(isSlackAppHomeWelcomeMapping).length +
    outbox.filter((item) => readJsonStringField(item.metadataJson, "outboxSource") === "app_home_opened_welcome").length;
  const suggestedPromptsEvidence = outbox.filter((item) =>
    readJsonStringField(item.metadataJson, "assistantMethod") === "assistant.threads.setSuggestedPrompts"
  ).length;
  return {
    satisfied: agentContextEvidence > 0 && appHomeWelcomeEvidence > 0 && suggestedPromptsEvidence > 0,
    agentContextEvidence,
    appHomeWelcomeEvidence,
    suggestedPromptsEvidence,
  };
}

function buildApprovalEvidence(
  events: ExternalIntegrationEventRecord[],
  outbox: ExternalMessageOutboxRecord[],
): SlackEvidenceIntegrationItem["approvals"] {
  const blockActionEvents = events.filter((event) => event.eventType === "block_actions");
  return {
    satisfied: blockActionEvents.some((event) => event.status === "processed"),
    processedBlockActions: blockActionEvents.filter((event) => event.status === "processed").length,
    failedBlockActions: blockActionEvents.filter((event) => event.status === "failed").length,
    approvalStatusOutbox: outbox.filter((item) =>
      readJsonStringField(item.metadataJson, "outboxSource") === "agent_status_card"
    ).length,
  };
}

function buildFileEvidence(
  events: ExternalIntegrationEventRecord[],
  mappings: ExternalMessageMappingRecord[],
  outbox: ExternalMessageOutboxRecord[],
): SlackEvidenceIntegrationItem["files"] {
  const inboundFileMetadataEvents = events.filter((event) =>
    event.status === "processed" && hasSlackFileMetadataEvidence(event.payloadJson)
  ).length;
  const inboundFileMetadataMappings = mappings.filter((mapping) =>
    mapping.direction === "inbound" && hasSlackFileMetadataEvidence(mapping.metadataJson)
  ).length;
  const storedAttachmentEvidence = mappings.filter((mapping) =>
    hasSlackStoredAttachmentEvidence(mapping.metadataJson)
  ).length;
  const outboundUploadEvidence = outbox.filter((item) =>
    item.status === "sent" &&
    (hasSlackOutboundFileUploadEvidence(item.metadataJson) || hasSlackOutboundFileUploadEvidence(item.payloadJson))
  ).length;
  const unsafeFileMetadataRows = [
    ...events.map((event) => event.payloadJson),
    ...mappings.map((mapping) => mapping.metadataJson),
    ...outbox.map((item) => item.metadataJson),
  ].filter(hasUnsafeSlackFileMetadata).length;
  return {
    satisfied: inboundFileMetadataEvents > 0 &&
      inboundFileMetadataMappings > 0 &&
      storedAttachmentEvidence > 0 &&
      outboundUploadEvidence > 0 &&
      unsafeFileMetadataRows === 0,
    inboundFileMetadataEvents,
    inboundFileMetadataMappings,
    storedAttachmentEvidence,
    outboundUploadEvidence,
    unsafeFileMetadataRows,
  };
}

function buildSlackMessageEvidenceBlockers(
  message: SlackEvidenceIntegrationItem["message"],
  integration: ExternalIntegrationRecord,
  channelBindings: ExternalChannelBindingRecord[],
  userBindings: ExternalUserBindingRecord[],
  failures: SlackEvidenceIntegrationItem["failures"],
): string[] {
  const blockers: string[] = [];
  if (integration.status !== "active") {
    blockers.push("integration_not_active");
  }
  if (channelBindings.length === 0) {
    blockers.push("channel_binding_missing");
  }
  if (userBindings.length === 0) {
    blockers.push("user_binding_missing");
  }
  if (message.processedInboundEvents === 0) {
    blockers.push("processed_inbound_event_evidence_missing");
  }
  if (message.inboundMappings === 0) {
    blockers.push("inbound_mapping_evidence_missing");
  }
  if (message.agentTaskQueueEvidence === 0) {
    blockers.push("agent_task_queue_evidence_missing");
  }
  if (message.outboundMappings === 0 && message.sentOutbox === 0) {
    blockers.push("outbound_reply_evidence_missing");
  }
  if (failures.failedOutbox > 0) {
    blockers.push("failed_outbox_unresolved");
  }
  return blockers;
}

function buildSlackNativeEvidenceBlockers(native: SlackEvidenceIntegrationItem["nativeExperience"]): string[] {
  const blockers: string[] = [];
  if (native.agentContextEvidence === 0) {
    blockers.push("agent_context_evidence_missing");
  }
  if (native.appHomeWelcomeEvidence === 0) {
    blockers.push("app_home_welcome_evidence_missing");
  }
  if (native.suggestedPromptsEvidence === 0) {
    blockers.push("suggested_prompts_evidence_missing");
  }
  return blockers;
}

function buildSlackFileEvidenceBlockers(files: SlackEvidenceIntegrationItem["files"]): string[] {
  const blockers: string[] = [];
  if (files.inboundFileMetadataEvents === 0) {
    blockers.push("slack_inbound_file_metadata_event_evidence_missing");
  }
  if (files.inboundFileMetadataMappings === 0) {
    blockers.push("slack_inbound_file_metadata_mapping_evidence_missing");
  }
  if (files.storedAttachmentEvidence === 0) {
    blockers.push("slack_file_attachment_storage_evidence_missing");
  }
  if (files.outboundUploadEvidence === 0) {
    blockers.push("slack_outbound_file_upload_evidence_missing");
  }
  if (files.unsafeFileMetadataRows > 0) {
    blockers.push("slack_file_metadata_unsafe");
  }
  return blockers;
}

function isSlackEvidenceRequirementSatisfied(
  required: SlackEvidenceRequirement,
  evidence: {
    message: boolean;
    native: boolean;
    approval: boolean;
    files: boolean;
  },
): boolean {
  if (required === "message") {
    return evidence.message;
  }
  if (required === "native") {
    return evidence.message && evidence.native;
  }
  if (required === "approval") {
    return evidence.message && evidence.approval;
  }
  if (required === "files") {
    return evidence.message && evidence.files;
  }
  return evidence.message && evidence.native && evidence.approval && evidence.files;
}

function isSlackAppHomeWelcomeMapping(mapping: ExternalMessageMappingRecord): boolean {
  return readJsonStringField(mapping.metadataJson, "mappingSource") === "app_home_opened_welcome";
}

function hasSlackAgentTaskQueueEvidence(
  mapping: ExternalMessageMappingRecord,
  integration: ExternalIntegrationRecord,
): boolean {
  const metadata = parseJsonRecord(mapping.metadataJson);
  if (!metadata) {
    return false;
  }
  const taskQueueId = readJsonStringFieldFromRecord(metadata, "taskQueueId");
  if (!taskQueueId) {
    return false;
  }
  const taskAgentId = readJsonStringFieldFromRecord(metadata, "taskAgentId") ??
    readJsonStringFieldFromRecord(metadata, "agentId");
  if (!taskAgentId) {
    return false;
  }
  return integration.agentId ? taskAgentId === integration.agentId : true;
}

function hasSlackAgentContextEvidence(metadataJson: string): boolean {
  const metadata = parseJsonRecord(metadataJson);
  const agentContext = parseJsonRecord(metadata?.agentContext) ?? parseJsonRecord(metadata?.slackAgentContext);
  return Boolean(agentContext) || metadata?.hasAgentContext === true;
}

function hasSlackFileMetadataEvidence(metadataJson: string): boolean {
  const metadata = parseJsonRecord(metadataJson);
  return Boolean(
    metadata?.hasFiles === true ||
    readPositiveNumber(metadata?.fileCount) ||
    readPositiveNumber(metadata?.slackFileCount) ||
    readObjectArray(metadata?.files).length > 0 ||
    readObjectArray(metadata?.slackFiles).length > 0
  );
}

function hasSlackStoredAttachmentEvidence(metadataJson: string): boolean {
  const metadata = parseJsonRecord(metadataJson);
  return Boolean(
    readPositiveNumber(metadata?.slackStoredAttachmentCount) ||
    metadata?.slackFileDownloadStatus === "stored_attachment" ||
    readObjectArray(metadata?.slackFiles).some((file) =>
      readJsonStringFieldFromRecord(file, "downloadStatus") === "stored_attachment"
    )
  );
}

function hasSlackOutboundFileUploadEvidence(metadataJson: string): boolean {
  const metadata = parseJsonRecord(metadataJson);
  return Boolean(
    metadata?.outboxSource === "slack_file_upload" ||
    metadata?.slackUploadFlow === "external_upload" ||
    metadata?.method === "files.completeUploadExternal" ||
    readObjectArray(metadata?.files).some((file) =>
      readJsonStringFieldFromRecord(file, "uploadStatus") === "sent"
    )
  );
}

function hasUnsafeSlackFileMetadata(metadataJson: string): boolean {
  const metadata = parseJsonRecord(metadataJson);
  return metadata ? hasUnsafeSlackFileMetadataValue(metadata) : false;
}

function hasUnsafeSlackFileMetadataValue(value: unknown, key = ""): boolean {
  if (typeof value === "string") {
    return hasUnsafeSlackFileString(value, key);
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasUnsafeSlackFileMetadataValue(item, key));
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return Object.entries(value).some(([entryKey, entryValue]) =>
    isUnsafeSlackFileMetadataKey(entryKey) || hasUnsafeSlackFileMetadataValue(entryValue, entryKey)
  );
}

function isUnsafeSlackFileMetadataKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return lowerKey === "url_private" ||
    lowerKey === "url_private_download" ||
    lowerKey === "permalink" ||
    lowerKey === "permalink_public";
}

function hasUnsafeSlackFileString(value: string, key: string): boolean {
  if (/files\.slack\.com|slack-files\.com|url_private/i.test(value)) {
    return true;
  }
  const lowerKey = key.toLowerCase();
  if ((lowerKey === "id" || lowerKey === "file_id" || lowerKey === "fileid" || lowerKey.endsWith("fileid")) &&
    /^F[A-Z0-9_-]{4,}$/.test(value)
  ) {
    return true;
  }
  return false;
}

function readJsonStringField(metadataJson: string, field: string): string | undefined {
  const metadata = parseJsonRecord(metadataJson);
  return metadata ? readJsonStringFieldFromRecord(metadata, field) : undefined;
}

function readJsonStringFieldFromRecord(metadata: Record<string, unknown>, field: string): string | undefined {
  const value = metadata?.[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readObjectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item)
      )
    : [];
}

function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function readSlackLiveSmokeEvidenceRuns(artifact: Record<string, unknown>): Record<string, unknown>[] {
  const runs = readObjectArray(artifact.runs);
  if (runs.length > 0) {
    return runs;
  }
  return artifact.mode === "live" || artifact.liveResult ? [artifact] : [];
}

function isFreshIsoTimestamp(value: string, maxAgeMs: number): boolean {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  const ageMs = Date.now() - timestamp;
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

function countUnsafeSlackLiveSmokeEvidenceValues(value: unknown): number {
  if (typeof value === "string") {
    return isUnsafeSlackLiveSmokeEvidenceString(value) ? 1 : 0;
  }
  if (Array.isArray(value)) {
    let count = 0;
    for (const item of value) {
      count += countUnsafeSlackLiveSmokeEvidenceValues(item);
    }
    return count;
  }
  if (typeof value !== "object" || value === null) {
    return 0;
  }
  let count = 0;
  for (const item of Object.values(value as Record<string, unknown>)) {
    count += countUnsafeSlackLiveSmokeEvidenceValues(item);
  }
  return count;
}

function isUnsafeSlackLiveSmokeEvidenceString(value: string): boolean {
  return /\b(xox[abprs]?|xapp)-[A-Za-z0-9-]+\b/i.test(value) ||
    /\b[ACDGTUWF][A-Z0-9]{7,}\b/.test(value) ||
    /\b\d{10}\.\d{6}\b/.test(value) ||
    /files\.slack\.com|slack-files\.com|url_private/i.test(value);
}

function buildSlackEvidenceNextCommands(
  workspaceId: string,
  integrationId: string | undefined,
  required: SlackEvidenceRequirement,
): string[] {
  const integrationFlag = integrationId ? ` --integration ${integrationId}` : "";
  const evidencePath = "runtime-output/slack-smoke/live.json";
  return [
    `agent-space integrations slack readiness --workspace-id ${workspaceId}${integrationFlag} --strict --json`,
    `agent-space integrations slack smoke-plan --workspace-id ${workspaceId}${integrationFlag} --strict --require message --json`,
    `npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence ${evidencePath} --json`,
    `SLACK_SMOKE_LIVE_MODE=app_mention npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence ${evidencePath} --json`,
    `SLACK_SMOKE_LIVE_MODE=file_upload npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence ${evidencePath} --json`,
    `agent-space integrations slack evidence --workspace-id ${workspaceId}${integrationFlag} --live-smoke-evidence ${evidencePath} --strict --require ${required} --json`,
  ];
}

function buildSlackEvidenceIntegrationNextCommands(workspaceId: string, integrationId: string): string[] {
  const flags = `--workspace-id ${workspaceId} --integration ${integrationId}`;
  return [
    `agent-space integrations slack health-check ${flags} --json`,
    `agent-space integrations slack readiness ${flags} --strict --json`,
    `agent-space integrations slack outbox drain ${flags} --json`,
  ];
}
