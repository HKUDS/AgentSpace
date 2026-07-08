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
const SLACK_LOCAL_EVIDENCE_FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface SlackEvidenceReport {
  workspaceId: string;
  provider: typeof SLACK_PROVIDER_ID;
  generatedAt: string;
  required: SlackEvidenceRequirement;
  strict: boolean;
  integrationCount: number;
  strictSatisfied: boolean;
  blockers: string[];
  summary: {
    messageSatisfiedCount: number;
    nativeSatisfiedCount: number;
    approvalSatisfiedCount: number;
    filesSatisfiedCount: number;
    unresolvedFailureCount: number;
    staleEvidenceRowCount: number;
    unhealthyIntegrationCount: number;
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
    freshRunCount: number;
    staleRunCount: number;
    postMessageLiveOk: boolean;
    appMentionLiveOk: boolean;
    fileUploadLiveOk: boolean;
    contextMatched: boolean;
    satisfiedIntegrationIds: string[];
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
  healthCheck: {
    required: boolean;
    healthy: boolean;
    fresh: boolean;
    checkedAt?: string;
    maxAgeHours: number;
  };
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
  freshness: {
    required: boolean;
    maxAgeHours: number;
    staleEvidenceRows: number;
    freshEvents: number;
    freshMappings: number;
    freshOutbox: number;
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

interface SlackLiveSmokeExpectedIntegrationContext {
  integrationId: string;
  appReference?: string;
  teamReference?: string;
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
    requireFreshEvidence: Boolean(input.strict),
    dependencies,
  }));
  const liveSmokeEvidence = input.requireLiveSmokeEvidence ||
    input.liveSmokeEvidencePath ||
    input.liveSmokeEvidence !== undefined
    ? verifySlackLiveSmokeEvidence({
      evidencePath: input.liveSmokeEvidencePath,
      evidence: input.liveSmokeEvidence,
      requireFileUploadEvidence: required === "files" || required === "all",
      expectedWorkspaceId: input.workspaceId,
      expectedIntegrationIds: integrations.map((integration) => integration.id),
      expectedIntegrations: integrations.map((integration) => ({
        integrationId: integration.id,
        ...(integration.appId ? { appReference: buildSlackReference(integration.appId) } : {}),
        ...(integration.tenantKey ? { teamReference: buildSlackReference(integration.tenantKey) } : {}),
      })),
    })
    : undefined;
  const liveSatisfiedIntegrationIds = liveSmokeEvidence?.summary?.satisfiedIntegrationIds;
  const strictSatisfied = items.some((item) =>
    item.requiredSatisfied &&
    (!liveSmokeEvidence || (
      liveSmokeEvidence.valid &&
      (!liveSatisfiedIntegrationIds || liveSatisfiedIntegrationIds.includes(item.integrationId))
    ))
  );
  const blockers = buildSlackEvidenceReportBlockers({
    selectedIntegrationId: input.integrationId,
    items,
    liveSmokeEvidence,
    strictSatisfied,
  });
  return {
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
    generatedAt: new Date().toISOString(),
    required,
    strict: Boolean(input.strict),
    integrationCount: items.length,
    strictSatisfied,
    blockers,
    summary: {
      messageSatisfiedCount: items.filter((item) => item.message.satisfied).length,
      nativeSatisfiedCount: items.filter((item) => item.nativeExperience.satisfied).length,
      approvalSatisfiedCount: items.filter((item) => item.approvals.satisfied).length,
      filesSatisfiedCount: items.filter((item) => item.files.satisfied).length,
      unresolvedFailureCount: items.reduce((count, item) => count + item.failures.failedEvents + item.failures.failedOutbox, 0),
      staleEvidenceRowCount: items.reduce((count, item) => count + item.freshness.staleEvidenceRows, 0),
      unhealthyIntegrationCount: items.filter((item) => item.healthCheck.required && (!item.healthCheck.healthy || !item.healthCheck.fresh)).length,
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
  expectedWorkspaceId?: string;
  expectedIntegrationIds?: string[];
  expectedIntegrations?: SlackLiveSmokeExpectedIntegrationContext[];
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
  const relevantLiveRuns = runs.filter((run) => {
    const liveResult = parseJsonRecord(run.liveResult);
    const mode = readJsonStringFieldFromRecord(liveResult ?? {}, "mode");
    return mode === "post_message" ||
      mode === "app_mention" ||
      mode === "file_upload";
  });
  const freshRelevantLiveRuns = relevantLiveRuns.filter((run) => isSlackLiveSmokeRunFresh(run, artifact));
  const expectedContext = {
    workspaceId: input.expectedWorkspaceId,
    integrations: input.expectedIntegrations ??
      (input.expectedIntegrationIds ?? []).map((integrationId) => ({ integrationId })),
  };
  const postMessageLiveOk = runs.some((run) => {
    const liveResult = parseJsonRecord(run.liveResult);
    return isSlackLiveSmokeRunOk(run, artifact, liveResult, "post_message") &&
      hasSlackLiveSmokeResultReferences(liveResult, ["channelReference", "messageReference"]) &&
      slackLiveSmokeContextMatches(run, artifact, expectedContext);
  });
  const appMentionLiveOk = runs.some((run) => {
    const liveResult = parseJsonRecord(run.liveResult);
    if (!liveResult) {
      return false;
    }
    return isSlackLiveSmokeRunOk(run, artifact, liveResult, "app_mention") &&
      hasSlackLiveSmokeResultReferences(liveResult, ["channelReference", "botUserReference"]) &&
      liveResult.appMentionText === true &&
      slackLiveSmokeContextMatches(run, artifact, expectedContext);
  });
  const fileUploadLiveOk = runs.some((run) => {
    const liveResult = parseJsonRecord(run.liveResult);
    if (!liveResult) {
      return false;
    }
    return isSlackLiveSmokeRunOk(run, artifact, liveResult, "file_upload") &&
      hasSlackLiveSmokeResultReferences(liveResult, ["channelReference", "fileReference"]) &&
      liveResult.fileUpload === true &&
      liveResult.uploadCompleted === true &&
      slackLiveSmokeContextMatches(run, artifact, expectedContext);
  });
  const contextMatched = freshRelevantLiveRuns.length > 0 &&
    freshRelevantLiveRuns.every((run) => slackLiveSmokeContextMatches(run, artifact, expectedContext));
  const satisfiedIntegrationIds = buildSlackLiveSmokeSatisfiedIntegrationIds({
    artifact,
    runs,
    expectedContext,
    requireFileUploadEvidence: Boolean(input.requireFileUploadEvidence),
  });
  const unsafeRawValueCount = countUnsafeSlackLiveSmokeEvidenceValues(artifact);
  const issues = [
    ...(generatedAt ? [] : ["slack_live_smoke_generated_at_missing"]),
    ...(generatedAtFresh ? [] : ["slack_live_smoke_evidence_stale"]),
    ...(contextMatched ? [] : ["slack_live_smoke_context_mismatch"]),
    ...(expectedContext.integrations.length > 0 && satisfiedIntegrationIds.length === 0 ? ["slack_live_smoke_integration_evidence_missing"] : []),
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
      freshRunCount: freshRelevantLiveRuns.length,
      staleRunCount: relevantLiveRuns.length - freshRelevantLiveRuns.length,
      postMessageLiveOk,
      appMentionLiveOk,
      fileUploadLiveOk,
      contextMatched,
      satisfiedIntegrationIds,
      unsafeRawValueCount,
    },
  };
}

function buildSlackEvidenceReportBlockers(input: {
  selectedIntegrationId?: string;
  items: SlackEvidenceIntegrationItem[];
  liveSmokeEvidence?: SlackLiveSmokeEvidenceVerification;
  strictSatisfied: boolean;
}): string[] {
  if (input.strictSatisfied) {
    return [];
  }

  const blockers: string[] = [];
  if (input.items.length === 0) {
    blockers.push(input.selectedIntegrationId ? "selected_integration_missing" : "active_slack_integration_missing");
  }
  for (const item of input.items) {
    blockers.push(...item.blockers);
  }
  if (input.liveSmokeEvidence && !input.liveSmokeEvidence.valid) {
    blockers.push(...input.liveSmokeEvidence.issues);
  }
  const liveSatisfiedIntegrationIds = input.liveSmokeEvidence?.summary?.satisfiedIntegrationIds ?? [];
  if (
    input.liveSmokeEvidence?.valid &&
    input.items.some((item) => item.requiredSatisfied) &&
    !input.items.some((item) => item.requiredSatisfied && liveSatisfiedIntegrationIds.includes(item.integrationId))
  ) {
    blockers.push("slack_live_smoke_local_evidence_integration_mismatch");
  }
  if (!input.strictSatisfied && blockers.length === 0) {
    blockers.push("strict_slack_evidence_not_satisfied");
  }
  return Array.from(new Set(blockers));
}

function buildSlackEvidenceIntegrationItem(input: {
  workspaceId: string;
  integration: ExternalIntegrationRecord;
  required: SlackEvidenceRequirement;
  requireFreshEvidence: boolean;
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

  const freshEvents = input.requireFreshEvidence ? events.filter(isFreshSlackEvidenceEvent) : events;
  const freshMappings = input.requireFreshEvidence ? mappings.filter(isFreshSlackEvidenceMapping) : mappings;
  const freshOutbox = input.requireFreshEvidence ? outbox.filter(isFreshSlackEvidenceOutbox) : outbox;
  const rawMessage = buildMessageEvidence(events, mappings, outbox, channelBindings, userBindings, integration);
  const rawNativeExperience = buildNativeEvidence(events, mappings, outbox);
  const rawApprovals = buildApprovalEvidence(events, outbox);
  const rawFiles = buildFileEvidence(events, mappings, outbox);
  const message = buildMessageEvidence(freshEvents, freshMappings, freshOutbox, channelBindings, userBindings, integration);
  const nativeExperience = buildNativeEvidence(freshEvents, freshMappings, freshOutbox);
  const approvals = buildApprovalEvidence(freshEvents, freshOutbox);
  const files = buildFileEvidence(freshEvents, freshMappings, freshOutbox);
  const failures = {
    failedEvents: events.filter((event) => event.status === "failed").length,
    failedOutbox: outbox.filter((item) => item.status === "failed").length,
    pendingOutbox: outbox.filter((item) => item.status === "pending").length,
  };
  const rawRequiredSatisfied = isSlackEvidenceRequirementSatisfied(input.required, {
    message: rawMessage.satisfied,
    native: rawNativeExperience.satisfied,
    approval: rawApprovals.satisfied,
    files: rawFiles.satisfied,
  });
  const freshness = {
    required: input.requireFreshEvidence,
    maxAgeHours: SLACK_LOCAL_EVIDENCE_FRESHNESS_WINDOW_MS / (60 * 60 * 1000),
    staleEvidenceRows: input.requireFreshEvidence
      ? events.length + mappings.length + outbox.length - freshEvents.length - freshMappings.length - freshOutbox.length
      : 0,
    freshEvents: freshEvents.length,
    freshMappings: freshMappings.length,
    freshOutbox: freshOutbox.length,
  };
  const locallySatisfied = isSlackEvidenceRequirementSatisfied(input.required, {
    message: message.satisfied,
    native: nativeExperience.satisfied,
    approval: approvals.satisfied,
    files: files.satisfied,
  });
  const staleEvidenceBlocksRequired = input.requireFreshEvidence &&
    rawRequiredSatisfied &&
    !locallySatisfied &&
    freshness.staleEvidenceRows > 0;
  const healthCheck = {
    required: input.requireFreshEvidence,
    healthy: integration.lastHealthStatus === "healthy",
    fresh: isFreshIsoTimestamp(integration.lastHealthCheckedAt ?? "", SLACK_LOCAL_EVIDENCE_FRESHNESS_WINDOW_MS),
    checkedAt: integration.lastHealthCheckedAt,
    maxAgeHours: SLACK_LOCAL_EVIDENCE_FRESHNESS_WINDOW_MS / (60 * 60 * 1000),
  };
  const blockers = [
    ...(healthCheck.required && !healthCheck.healthy ? ["health_check_required_or_unhealthy"] : []),
    ...(healthCheck.required && !healthCheck.fresh ? ["health_check_stale_or_missing"] : []),
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
    ...(staleEvidenceBlocksRequired ? ["local_evidence_stale"] : []),
  ];
  const warnings = [
    ...(healthCheck.required && (!healthCheck.healthy || !healthCheck.fresh) ? ["health_check_not_ready"] : []),
    ...(freshness.staleEvidenceRows > 0 ? ["stale_local_evidence_ignored"] : []),
    ...(failures.pendingOutbox > 0 ? ["pending_outbox_messages"] : []),
    ...(failures.failedEvents > 0 ? ["failed_events_visible"] : []),
    ...(failures.failedOutbox > 0 ? ["failed_outbox_visible"] : []),
  ];
  const requiredSatisfied = locallySatisfied &&
    failures.failedOutbox === 0 &&
    (!healthCheck.required || (healthCheck.healthy && healthCheck.fresh));
  return {
    integrationId: integration.id,
    displayName: integration.displayName,
    status: integration.status,
    transportMode: integration.transportMode,
    agentId: integration.agentId,
    healthStatus: integration.lastHealthStatus,
    appRef: integration.appId ? buildSlackReference(integration.appId) : undefined,
    teamRef: integration.tenantKey ? buildSlackReference(integration.tenantKey) : undefined,
    healthCheck,
    bindings: {
      activeChannels: channelBindings.length,
      activeUsers: userBindings.length,
    },
    message,
    nativeExperience,
    approvals,
    files,
    freshness,
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

function isSlackLiveSmokeRunOk(
  run: Record<string, unknown>,
  artifact: Record<string, unknown>,
  liveResult: Record<string, unknown> | undefined,
  mode: "post_message" | "app_mention" | "file_upload",
): boolean {
  return isSlackLiveSmokeRunFresh(run, artifact) &&
    readJsonStringFieldFromRecord(run, "mode") === "live" &&
    run.ready === true &&
    liveResult?.ok === true &&
    readJsonStringFieldFromRecord(liveResult, "mode") === mode;
}

function isSlackLiveSmokeRunFresh(run: Record<string, unknown>, artifact: Record<string, unknown>): boolean {
  const hasAccumulatedRuns = readObjectArray(artifact.runs).length > 0;
  const generatedAt = readJsonStringFieldFromRecord(run, "generatedAt") ??
    (!hasAccumulatedRuns || run === artifact ? readJsonStringFieldFromRecord(artifact, "generatedAt") : undefined);
  return generatedAt ? isFreshIsoTimestamp(generatedAt, 24 * 60 * 60 * 1000) : false;
}

function hasSlackLiveSmokeResultReferences(
  liveResult: Record<string, unknown> | undefined,
  requiredKeys: string[],
): boolean {
  return liveResult
    ? requiredKeys.every((key) => Boolean(readJsonStringFieldFromRecord(liveResult, key)))
    : false;
}

function buildSlackLiveSmokeSatisfiedIntegrationIds(input: {
  artifact: Record<string, unknown>;
  runs: Record<string, unknown>[];
  expectedContext: {
    workspaceId?: string;
    integrations: SlackLiveSmokeExpectedIntegrationContext[];
  };
  requireFileUploadEvidence: boolean;
}): string[] {
  if (input.expectedContext.integrations.length === 0) {
    return [];
  }
  const satisfied = input.expectedContext.integrations.filter((expectedIntegration) => {
    const runMatchesIntegration = (run: Record<string, unknown>): boolean => {
      const context = readSlackLiveSmokeRunContext(run, input.artifact);
      return (!input.expectedContext.workspaceId || context.workspaceId === input.expectedContext.workspaceId) &&
        slackLiveSmokeIntegrationContextMatches(context, expectedIntegration);
    };
    const postMessageLiveOk = input.runs.some((run) => {
      const liveResult = parseJsonRecord(run.liveResult);
      return runMatchesIntegration(run) &&
        isSlackLiveSmokeRunOk(run, input.artifact, liveResult, "post_message") &&
        hasSlackLiveSmokeResultReferences(liveResult, ["channelReference", "messageReference"]);
    });
    const appMentionLiveOk = input.runs.some((run) => {
      const liveResult = parseJsonRecord(run.liveResult);
      return Boolean(liveResult) &&
        runMatchesIntegration(run) &&
        isSlackLiveSmokeRunOk(run, input.artifact, liveResult, "app_mention") &&
        hasSlackLiveSmokeResultReferences(liveResult, ["channelReference", "botUserReference"]) &&
        liveResult?.appMentionText === true;
    });
    const fileUploadLiveOk = input.runs.some((run) => {
      const liveResult = parseJsonRecord(run.liveResult);
      return Boolean(liveResult) &&
        runMatchesIntegration(run) &&
        isSlackLiveSmokeRunOk(run, input.artifact, liveResult, "file_upload") &&
        hasSlackLiveSmokeResultReferences(liveResult, ["channelReference", "fileReference"]) &&
        liveResult?.fileUpload === true &&
        liveResult?.uploadCompleted === true;
    });
    return postMessageLiveOk &&
      appMentionLiveOk &&
      (!input.requireFileUploadEvidence || fileUploadLiveOk);
  });
  return satisfied.map((integration) => integration.integrationId);
}

function slackLiveSmokeContextMatches(
  run: Record<string, unknown>,
  artifact: Record<string, unknown>,
  expected: {
    workspaceId?: string;
    integrations: SlackLiveSmokeExpectedIntegrationContext[];
  },
): boolean {
  if (!expected.workspaceId && expected.integrations.length === 0) {
    return true;
  }
  const context = readSlackLiveSmokeRunContext(run, artifact);
  if (expected.workspaceId && context.workspaceId !== expected.workspaceId) {
    return false;
  }
  if (expected.integrations.length > 0 && !expected.integrations.some((integration) =>
    slackLiveSmokeIntegrationContextMatches(context, integration)
  )) {
    return false;
  }
  return true;
}

function slackLiveSmokeIntegrationContextMatches(
  context: {
    integrationId?: string;
    appReference?: string;
    teamReference?: string;
  },
  expected: SlackLiveSmokeExpectedIntegrationContext,
): boolean {
  if (context.integrationId !== expected.integrationId) {
    return false;
  }
  if (expected.appReference && context.appReference !== expected.appReference) {
    return false;
  }
  if (expected.teamReference && context.teamReference !== expected.teamReference) {
    return false;
  }
  return true;
}

function readSlackLiveSmokeRunContext(
  run: Record<string, unknown>,
  artifact: Record<string, unknown>,
): {
  workspaceId?: string;
  integrationId?: string;
  appReference?: string;
  teamReference?: string;
} {
  const runContext = parseJsonRecord(run.context);
  const allowArtifactContextFallback = !runContext && (run === artifact || readObjectArray(artifact.runs).length === 0);
  const context = runContext ?? (allowArtifactContextFallback ? parseJsonRecord(artifact.context) : undefined);
  return {
    workspaceId: context ? readJsonStringFieldFromRecord(context, "workspaceId") : undefined,
    integrationId: context ? readJsonStringFieldFromRecord(context, "integrationId") : undefined,
    appReference: context ? readJsonStringFieldFromRecord(context, "appReference") : undefined,
    teamReference: context ? readJsonStringFieldFromRecord(context, "teamReference") : undefined,
  };
}

function isFreshSlackEvidenceEvent(event: ExternalIntegrationEventRecord): boolean {
  return isFreshIsoTimestamp(event.processedAt ?? event.receivedAt, SLACK_LOCAL_EVIDENCE_FRESHNESS_WINDOW_MS);
}

function isFreshSlackEvidenceMapping(mapping: ExternalMessageMappingRecord): boolean {
  return isFreshIsoTimestamp(mapping.createdAt, SLACK_LOCAL_EVIDENCE_FRESHNESS_WINDOW_MS);
}

function isFreshSlackEvidenceOutbox(item: ExternalMessageOutboxRecord): boolean {
  return isFreshIsoTimestamp(item.sentAt ?? item.updatedAt ?? item.createdAt, SLACK_LOCAL_EVIDENCE_FRESHNESS_WINDOW_MS);
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
  const readinessRequirement = required === "all" ? "all" : "message";
  return [
    `agent-space integrations slack readiness --workspace-id ${workspaceId}${integrationFlag} --strict --json`,
    `agent-space integrations slack smoke-plan --workspace-id ${workspaceId}${integrationFlag} --strict --require ${readinessRequirement} --json`,
    `npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence ${evidencePath} --json`,
    `SLACK_SMOKE_LIVE_MODE=app_mention npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence ${evidencePath} --json`,
    `SLACK_SMOKE_LIVE_MODE=file_upload npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence ${evidencePath} --json`,
    "npm run smoke:slack:verify -- --env-file scripts/slack/.env --json",
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
