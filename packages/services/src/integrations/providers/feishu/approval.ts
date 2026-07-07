import { randomBytes } from "node:crypto";
import type {
  ExternalDataOperationRunRecord,
  ExternalResourceBindingRecord,
} from "@agent-space/db";
import {
  listExternalUserBindingsSync,
  readExternalUserBindingByExternalUserSync,
  readExternalDataOperationRunSync,
  readExternalIntegrationSync,
  readWorkspaceMembershipSync,
  recordExternalIntegrationEventSync,
  updateExternalDataOperationRunStatusSync,
  updateExternalIntegrationEventStatusSync,
} from "@agent-space/db";
import type { ApprovalRequest } from "@agent-space/domain/workspace";
import {
  createApprovalRequestSync,
  listApprovalsSync,
  reviewApprovalSync,
} from "../../../approvals/approvals.ts";
import {
  decideAgentActionPolicySync,
  type AgentActionPolicyDecision,
  type AgentActionPolicyInput,
} from "../../../policies/agent-actions.ts";
import { tryRecordWorkspaceAuditEventSync } from "../../../shared/audit.ts";
import type {
  ExternalDataOperationRequest,
  ExternalDataOperationResult,
  IntegrationRuntimeContext,
} from "../../core/index.ts";
import { FEISHU_PROVIDER_ID } from "./constants.ts";
import {
  asRecord,
  asString,
  resolveFeishuEventId,
  resolveFeishuEventType,
} from "./events.ts";
import {
  summarizeFeishuApprovalCardActionEventPayload,
  summarizeFeishuInboundEventPayload,
} from "./event-summary.ts";
import {
  createFeishuApiClient,
  fetchFeishuTenantAccessToken,
  type FeishuApiClient,
} from "./client.ts";
import { readFeishuIntegrationCredentials } from "./credentials.ts";
import {
  executeApprovedFeishuDataOperation,
  executeFeishuDataOperation,
  planBoundFeishuWriteDataOperation,
  type FeishuBoundDataOperationActor,
} from "./data-plane.ts";
import {
  buildFeishuDataOperationPayloadHash,
  summarizeFeishuStoredDataOperationRequest,
} from "./operation-plan.ts";
import { queueFeishuAgentStatusCardOutboxSync } from "./outbound.ts";
import { buildSlackApprovalBlockAction } from "../slack/approval-actions.ts";
import { queueSlackAgentStatusCardOutboxSync } from "../slack/outbound.ts";

export interface FeishuDataOperationApprovalContext {
  agentId: string;
  channelName: string;
  sourceId?: string;
  contentPreview?: string;
  metadata?: Record<string, unknown>;
  sourceAgentSpaceMessageId?: string;
  taskId?: string;
}

export interface FeishuDataOperationApprovalMetadata {
  provider: typeof FEISHU_PROVIDER_ID;
  integrationId: string;
  resourceBindingId?: string;
  operationRunId: string;
  operationType: string;
  providerResourceType: string;
  providerResourceToken: string;
  payloadHash: string;
  requestSummary: Record<string, unknown>;
  operationRequest: ExternalDataOperationRequest;
  agentActionPolicyInput?: AgentActionPolicyInput;
  agentActionPolicyDecision?: AgentActionPolicyDecision;
  governanceContext?: Record<string, unknown>;
  feishuCardActionToken?: string;
  feishuCardActionExpiresAt?: string;
  sourceAgentSpaceMessageId?: string;
  taskId?: string;
}

export interface FeishuDataOperationWithApprovalResult {
  runId: string;
  result: ExternalDataOperationResult;
  approval?: ApprovalRequest;
  resourceBinding?: ExternalResourceBindingRecord;
}

export interface FeishuCardActionCallbackResult {
  eventId: string;
  eventStatus: "processed" | "ignored" | "failed";
  handled: boolean;
  reasonCode?: string;
  approvalId?: string;
  decision?: "approved" | "rejected";
  reviewerUserId?: string;
  execution?: {
    runId: string;
    result: ExternalDataOperationResult;
  };
}

export async function executeFeishuDataOperationWithApproval(input: {
  context: IntegrationRuntimeContext;
  client: FeishuApiClient;
  request: ExternalDataOperationRequest;
  resourceBindingId?: string;
  approval: FeishuDataOperationApprovalContext;
}): Promise<FeishuDataOperationWithApprovalResult> {
  const executed = await executeFeishuDataOperation({
    context: input.context,
    client: input.client,
    request: input.request,
    resourceBindingId: input.resourceBindingId,
  });
  if (executed.result.errorCode !== "feishu.data_operation_requires_approval") {
    return executed;
  }

  const run = readExternalDataOperationRunSync({
    workspaceId: input.context.workspaceId,
    runId: executed.runId,
  });
  if (!run) {
    throw new Error(`Feishu data operation run "${executed.runId}" does not exist.`);
  }

  const payloadHash = readString(executed.result.data, "payloadHash")
    ?? buildFeishuDataOperationPayloadHash(input.request);
  const approval = createFeishuDataOperationApprovalRequestSync({
    context: input.context,
    run,
    request: input.request,
    payloadHash,
    approval: input.approval,
    resourceBindingId: input.resourceBindingId,
  });

  return {
    ...executed,
    result: {
      ...executed.result,
      data: {
        ...(executed.result.data ?? {}),
        approvalId: approval.id,
      },
    },
    approval,
  };
}

export async function planBoundFeishuWriteDataOperationWithApproval(input: {
  context: IntegrationRuntimeContext;
  client: FeishuApiClient;
  request: ExternalDataOperationRequest;
  actor?: FeishuBoundDataOperationActor;
  approval: FeishuDataOperationApprovalContext;
}): Promise<FeishuDataOperationWithApprovalResult> {
  const planned = await planBoundFeishuWriteDataOperation({
    context: input.context,
    client: input.client,
    request: input.request,
    actor: input.actor,
  });
  if (planned.result.errorCode !== "feishu.data_operation_requires_approval") {
    return planned;
  }

  const run = readExternalDataOperationRunSync({
    workspaceId: input.context.workspaceId,
    runId: planned.runId,
  });
  if (!run) {
    throw new Error(`Feishu data operation run "${planned.runId}" does not exist.`);
  }

  const operationRequest = planned.request ?? input.request;
  const payloadHash = readString(planned.result.data, "payloadHash")
    ?? buildFeishuDataOperationPayloadHash(operationRequest);
  const approval = createFeishuDataOperationApprovalRequestSync({
    context: input.context,
    run,
    request: operationRequest,
    payloadHash,
    approval: input.approval,
    resourceBindingId: planned.resourceBinding?.id,
  });

  return {
    ...planned,
    result: {
      ...planned.result,
      data: {
        ...(planned.result.data ?? {}),
        approvalId: approval.id,
      },
    },
    approval,
  };
}

export function createFeishuDataOperationApprovalRequestSync(input: {
  context: IntegrationRuntimeContext;
  run: ExternalDataOperationRunRecord;
  request: ExternalDataOperationRequest;
  payloadHash?: string;
  resourceBindingId?: string;
  approval: FeishuDataOperationApprovalContext;
}): ApprovalRequest {
  const existing = listApprovalsSync(input.context.workspaceId).find((approval) =>
    approval.type === "external_data_operation" &&
    approval.sourceId === input.run.id &&
    approval.status === "pending" &&
    readString(approval.metadata, "provider") === FEISHU_PROVIDER_ID
  );
  if (existing) {
    return existing;
  }

  const metadata = {
    ...buildFeishuDataOperationApprovalMetadata(input),
    ...(input.approval.sourceAgentSpaceMessageId
      ? { sourceAgentSpaceMessageId: input.approval.sourceAgentSpaceMessageId }
      : {}),
    ...(input.approval.taskId ? { taskId: input.approval.taskId } : {}),
  };
  const state = createApprovalRequestSync({
    type: "external_data_operation",
    sourceId: input.run.id,
    agentId: input.approval.agentId,
    channelName: input.approval.channelName,
    contentPreview: input.approval.contentPreview?.trim()
      || buildFeishuDataOperationApprovalPreview({
        agentId: input.approval.agentId,
        request: input.request,
        requestSummary: metadata.requestSummary,
      }),
    metadata: {
      ...input.approval.metadata,
      ...metadata,
    },
  }, input.context.workspaceId);

  const created = state.approvals.find((approval) =>
    approval.type === "external_data_operation" &&
    approval.sourceId === input.run.id &&
    readString(approval.metadata, "provider") === FEISHU_PROVIDER_ID
  );
  if (!created) {
    throw new Error("Feishu data operation approval could not be created.");
  }
  queueFeishuDataOperationApprovalCardBestEffort({
    workspaceId: input.context.workspaceId,
    channelName: input.approval.channelName,
    agentId: input.approval.agentId,
    approval: created,
    sourceAgentSpaceMessageId: input.approval.sourceAgentSpaceMessageId,
    taskId: input.approval.taskId,
  });
  queueSlackDataOperationApprovalCardBestEffort({
    workspaceId: input.context.workspaceId,
    channelName: input.approval.channelName,
    agentId: input.approval.agentId,
    approval: created,
    sourceAgentSpaceMessageId: input.approval.sourceAgentSpaceMessageId,
    taskId: input.approval.taskId,
  });
  return created;
}

function queueFeishuDataOperationApprovalCardBestEffort(input: {
  workspaceId: string;
  channelName: string;
  agentId: string;
  approval: ApprovalRequest;
  sourceAgentSpaceMessageId?: string;
  taskId?: string;
}): void {
  try {
    queueFeishuAgentStatusCardOutboxSync({
      workspaceId: input.workspaceId,
      channelName: input.channelName,
      status: "approval_required",
      agentNames: [input.agentId],
      message: input.approval.contentPreview,
      taskId: input.taskId,
      sourceAgentSpaceMessageId: input.sourceAgentSpaceMessageId,
      approvalAction: buildFeishuApprovalCardAction(input.approval),
    });
  } catch {
    // Feishu cards are external notifications; approval creation and audit remain the source of truth.
  }
}

function queueSlackDataOperationApprovalCardBestEffort(input: {
  workspaceId: string;
  channelName: string;
  agentId: string;
  approval: ApprovalRequest;
  sourceAgentSpaceMessageId?: string;
  taskId?: string;
}): void {
  try {
    queueSlackAgentStatusCardOutboxSync({
      workspaceId: input.workspaceId,
      channelName: input.channelName,
      agentId: input.agentId,
      status: "approval_required",
      agentNames: [input.agentId],
      message: input.approval.contentPreview,
      taskId: input.taskId,
      sourceAgentSpaceMessageId: input.sourceAgentSpaceMessageId,
      approvalAction: buildSlackApprovalBlockAction(input.approval),
      requireSourceMapping: true,
    });
  } catch {
    // Slack cards are external notifications; approval creation and audit remain the source of truth.
  }
}

function queueFeishuDataOperationReviewStatusCardBestEffort(input: {
  workspaceId: string;
  approval: ApprovalRequest;
  metadata: FeishuDataOperationApprovalMetadata;
  status: "complete" | "failed";
  message: string;
}): void {
  try {
    queueFeishuAgentStatusCardOutboxSync({
      workspaceId: input.workspaceId,
      channelName: input.approval.channelName,
      status: input.status,
      agentNames: [input.approval.agentId],
      message: input.message,
      taskId: input.metadata.taskId,
      sourceAgentSpaceMessageId: input.metadata.sourceAgentSpaceMessageId,
    });
  } catch {
    // Feishu review receipts are external notifications; approval/run state remains authoritative.
  }
}

function buildFeishuDataOperationReviewStatusMessage(input: {
  decision: "approved" | "rejected";
  metadata: Pick<FeishuDataOperationApprovalMetadata, "operationType" | "operationRunId">;
  execution?: {
    runId: string;
    result: ExternalDataOperationResult;
  };
}): string {
  if (input.decision === "rejected") {
    return `Rejected ${input.metadata.operationType}. No Feishu write was executed.`;
  }
  if (input.execution?.result.ok) {
    return `Approved ${input.metadata.operationType} completed. Operation run ${input.execution.runId}.`;
  }
  return `Approved ${input.metadata.operationType} failed. Operation run ${input.execution?.runId ?? input.metadata.operationRunId}.`;
}

export async function reviewFeishuDataOperationApproval(input: {
  workspaceId: string;
  approvalId: string;
  decision: "approved" | "rejected";
  reviewerComment?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  client?: FeishuApiClient;
}): Promise<{
  approval: ApprovalRequest;
  execution?: {
    runId: string;
    result: ExternalDataOperationResult;
  };
}> {
  const approval = readFeishuDataOperationApproval(input.workspaceId, input.approvalId);
  const metadata = readFeishuDataOperationApprovalMetadata(approval);
  validateFeishuApprovalPolicyForReview(approval, metadata);
  const run = readExternalDataOperationRunSync({
    workspaceId: input.workspaceId,
    runId: metadata.operationRunId,
  });
  if (!run) {
    throw new Error(`Feishu data operation run "${metadata.operationRunId}" does not exist.`);
  }

  if (input.decision === "rejected") {
    const reviewedState = reviewApprovalSync(
      approval.id,
      "rejected",
      input.reviewerComment,
      input.workspaceId,
    );
    if (run.status === "pending") {
      updateExternalDataOperationRunStatusSync({
        workspaceId: input.workspaceId,
        runId: run.id,
        status: "cancelled",
        resultJson: {
          policyDecision: "rejected",
          approvalId: approval.id,
          payloadHash: metadata.payloadHash,
        },
        errorCode: "feishu.data_operation_rejected",
        errorMessage: "Feishu data operation approval was rejected.",
      });
    }
    const reviewedApproval = requireReviewedApproval(reviewedState.approvals, approval.id);
    queueFeishuDataOperationReviewStatusCardBestEffort({
      workspaceId: input.workspaceId,
      approval: reviewedApproval,
      metadata,
      status: "failed",
      message: buildFeishuDataOperationReviewStatusMessage({
        decision: "rejected",
        metadata,
      }),
    });
    return {
      approval: reviewedApproval,
    };
  }

  const reviewedState = reviewApprovalSync(
    approval.id,
    "approved",
    input.reviewerComment,
    input.workspaceId,
  );
  try {
    const client = input.client ?? await createFeishuApprovedOperationClient({
      workspaceId: input.workspaceId,
      integrationId: metadata.integrationId,
      baseUrl: input.baseUrl,
      fetchImpl: input.fetchImpl,
    });
    const execution = await executeApprovedFeishuDataOperation({
      context: {
        workspaceId: input.workspaceId,
        integrationId: metadata.integrationId,
        provider: FEISHU_PROVIDER_ID,
      },
      client,
      runId: metadata.operationRunId,
      request: metadata.operationRequest,
      approvalId: approval.id,
      approvedPayloadHash: metadata.payloadHash,
    });
    const reviewedApproval = requireReviewedApproval(reviewedState.approvals, approval.id);
    queueFeishuDataOperationReviewStatusCardBestEffort({
      workspaceId: input.workspaceId,
      approval: reviewedApproval,
      metadata,
      status: execution.result.ok ? "complete" : "failed",
      message: buildFeishuDataOperationReviewStatusMessage({
        decision: "approved",
        metadata,
        execution,
      }),
    });
    return {
      approval: reviewedApproval,
      execution,
    };
  } catch (error) {
    const result: ExternalDataOperationResult = {
      ok: false,
      errorCode: "feishu.data_operation_approval_execution_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      data: {
        policyDecision: "approved",
        approvalId: approval.id,
        payloadHash: metadata.payloadHash,
      },
    };
    if (run.status === "pending") {
      updateExternalDataOperationRunStatusSync({
        workspaceId: input.workspaceId,
        runId: run.id,
        status: "failed",
        resultJson: result.data,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      });
    }
    const reviewedApproval = requireReviewedApproval(reviewedState.approvals, approval.id);
    const execution = {
      runId: run.id,
      result,
    };
    queueFeishuDataOperationReviewStatusCardBestEffort({
      workspaceId: input.workspaceId,
      approval: reviewedApproval,
      metadata,
      status: "failed",
      message: buildFeishuDataOperationReviewStatusMessage({
        decision: "approved",
        metadata,
        execution,
      }),
    });
    return {
      approval: reviewedApproval,
      execution,
    };
  }
}

export async function processFeishuCardActionCallback(input: {
  context: IntegrationRuntimeContext;
  payload: Record<string, unknown>;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  client?: FeishuApiClient;
}): Promise<FeishuCardActionCallbackResult> {
  const externalEventId = resolveFeishuEventId(input.payload);
  const eventType = resolveFeishuEventType(input.payload);
  const action = parseFeishuApprovalCardActionPayload(input.payload);
  recordExternalIntegrationEventSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    provider: FEISHU_PROVIDER_ID,
    externalEventId,
    eventType,
    payloadJson: action
      ? summarizeFeishuApprovalCardActionEventPayload(input.payload, action)
      : summarizeFeishuInboundEventPayload(input.payload),
  });

  if (!action) {
    return finishFeishuCardActionCallback({
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "ignored",
      reasonCode: "feishu_card_action_payload_invalid",
      handled: false,
    });
  }

  const operatorOpenId = resolveFeishuCardActionOperatorOpenId(input.payload);
  if (!operatorOpenId) {
    return finishFeishuCardActionCallback({
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "ignored",
      reasonCode: "feishu_card_action_operator_missing",
      handled: false,
      approvalId: action.approvalId,
      decision: action.decision,
    });
  }

  const userBinding = readFeishuCardActionUserBinding({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    operatorOpenId,
  });
  if (!userBinding || userBinding.status !== "active") {
    return finishFeishuCardActionCallback({
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "ignored",
      reasonCode: "feishu_card_action_user_unbound",
      handled: false,
      approvalId: action.approvalId,
      decision: action.decision,
    });
  }
  const membership = readWorkspaceMembershipSync(input.context.workspaceId, userBinding.userId);
  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
    return finishFeishuCardActionCallback({
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "ignored",
      reasonCode: "feishu_card_action_reviewer_forbidden",
      handled: false,
      approvalId: action.approvalId,
      decision: action.decision,
      reviewerUserId: userBinding.userId,
    });
  }

  let approval: ApprovalRequest;
  let metadata: FeishuDataOperationApprovalMetadata;
  try {
    approval = readFeishuDataOperationApproval(input.context.workspaceId, action.approvalId);
    metadata = readFeishuDataOperationApprovalMetadata(approval);
    validateFeishuApprovalPolicyForReview(approval, metadata);
  } catch {
    return finishFeishuCardActionCallback({
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "failed",
      reasonCode: "feishu_card_action_approval_invalid",
      handled: false,
      approvalId: action.approvalId,
      decision: action.decision,
      reviewerUserId: userBinding.userId,
    });
  }

  if (
    metadata.integrationId !== input.context.integrationId ||
    metadata.feishuCardActionToken !== action.token ||
    metadata.payloadHash !== action.payloadHash
  ) {
    return finishFeishuCardActionCallback({
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "failed",
      reasonCode: "feishu_card_action_token_mismatch",
      handled: false,
      approvalId: approval.id,
      decision: action.decision,
      reviewerUserId: userBinding.userId,
    });
  }
  if (metadata.feishuCardActionExpiresAt && Date.parse(metadata.feishuCardActionExpiresAt) < Date.now()) {
    return finishFeishuCardActionCallback({
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "failed",
      reasonCode: "feishu_card_action_token_expired",
      handled: false,
      approvalId: approval.id,
      decision: action.decision,
      reviewerUserId: userBinding.userId,
    });
  }

  tryRecordWorkspaceAuditEventSync({
    workspaceId: input.context.workspaceId,
    title: "Feishu approval callback",
    note: `Feishu user binding ${userBinding.id} reviewed approval ${approval.id}.`,
    code: "feishu.approval.card_action",
    data: {
      approvalId: approval.id,
      decision: action.decision,
      reviewerUserId: userBinding.userId,
      externalEventId,
    },
  });

  try {
    const reviewed = await reviewFeishuDataOperationApproval({
      workspaceId: input.context.workspaceId,
      approvalId: approval.id,
      decision: action.decision,
      reviewerComment: `Reviewed from Feishu card by ${formatFeishuApprovalReviewerReference(userBinding)}.`,
      baseUrl: input.baseUrl,
      fetchImpl: input.fetchImpl,
      client: input.client,
    });
    return finishFeishuCardActionCallback({
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "processed",
      handled: true,
      approvalId: approval.id,
      decision: action.decision,
      reviewerUserId: userBinding.userId,
      execution: reviewed.execution,
    });
  } catch {
    return finishFeishuCardActionCallback({
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "failed",
      reasonCode: "feishu_card_action_review_failed",
      handled: false,
      approvalId: approval.id,
      decision: action.decision,
      reviewerUserId: userBinding.userId,
    });
  }
}

export function sanitizeFeishuDataOperationApprovalMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (readString(metadata, "provider") !== FEISHU_PROVIDER_ID) {
    return metadata;
  }
  const sanitized = { ...(metadata ?? {}) };
  const providerResourceType = readString(sanitized, "providerResourceType");
  const providerResourceToken = readString(sanitized, "providerResourceToken");
  if (providerResourceType && providerResourceToken) {
    sanitized.providerResourceReference = formatFeishuApprovalResourceReference({
      providerResourceType,
      providerResourceToken,
    });
    sanitized.providerResourceTokenRedacted = true;
  }
  delete sanitized.operationRequest;
  delete sanitized.feishuCardActionToken;
  delete sanitized.providerResourceToken;
  sanitized.requestSummary = sanitizeFeishuApprovalRequestSummary(readRecord(metadata?.requestSummary));
  sanitized.agentActionPolicyInput = sanitizeFeishuApprovalPolicyInput(
    readRecord(metadata?.agentActionPolicyInput),
    {
      providerResourceType,
      providerResourceToken,
      requestSummary: readRecord(metadata?.requestSummary),
    },
  );
  return sanitized;
}

export function buildFeishuDataOperationApprovalMetadata(input: {
  context: IntegrationRuntimeContext;
  run: ExternalDataOperationRunRecord;
  request: ExternalDataOperationRequest;
  payloadHash?: string;
  resourceBindingId?: string;
}): FeishuDataOperationApprovalMetadata {
  return {
    provider: FEISHU_PROVIDER_ID,
    integrationId: input.context.integrationId,
    resourceBindingId: input.resourceBindingId ?? input.run.resourceBindingId,
    operationRunId: input.run.id,
    operationType: input.request.operationType,
    providerResourceType: input.request.providerResourceType,
    providerResourceToken: input.request.providerResourceToken,
    payloadHash: input.payloadHash ?? buildFeishuDataOperationPayloadHash(input.request),
    requestSummary: summarizeFeishuStoredDataOperationRequest(input.request),
    operationRequest: input.request,
    agentActionPolicyInput: readRunRequestJsonRecord(input.run.requestJson, "policyInput") as AgentActionPolicyInput | undefined,
    agentActionPolicyDecision: readRunRequestJsonRecord(input.run.requestJson, "agentActionPolicyDecision") as AgentActionPolicyDecision | undefined,
    governanceContext: readRunRequestJsonRecord(input.run.requestJson, "governanceContext"),
    feishuCardActionToken: createFeishuApprovalCardActionToken(),
    feishuCardActionExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export function buildFeishuDataOperationApprovalPreview(input: {
  agentId: string;
  request: ExternalDataOperationRequest;
  requestSummary: Record<string, unknown>;
}): string {
  const resourceLabel = input.request.providerResourceType === "sheet"
    ? "Feishu Sheet"
    : input.request.providerResourceType.startsWith("base")
      ? "Feishu Base"
      : "Feishu Docs";
  const target = readString(input.requestSummary, "range")
    ?? readString(input.requestSummary, "providerResourceReference")
    ?? formatFeishuApprovalResourceReference({
      providerResourceType: input.request.providerResourceType,
      providerResourceToken: input.request.providerResourceToken,
      tableId: readString(input.requestSummary, "tableId"),
    });
  return `${input.agentId} requested ${input.request.operationType} on ${resourceLabel}${target ? ` (${target})` : ""}.`;
}

function sanitizeFeishuApprovalRequestSummary(
  summary: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!summary) {
    return summary;
  }
  const sanitized = { ...summary };
  const providerResourceType = readString(sanitized, "providerResourceType");
  const providerResourceToken = readString(sanitized, "providerResourceToken");
  if (providerResourceType && providerResourceToken) {
    sanitized.providerResourceReference = formatFeishuApprovalResourceReference({
      providerResourceType,
      providerResourceToken,
      tableId: readString(sanitized, "tableId"),
    });
    sanitized.providerResourceTokenRedacted = true;
  }
  delete sanitized.providerResourceToken;
  delete sanitized.appToken;
  delete sanitized.tableId;
  delete sanitized.viewId;
  delete sanitized.folderToken;
  delete sanitized.parentBlockId;
  delete sanitized.blockId;
  return sanitized;
}

function sanitizeFeishuApprovalPolicyInput(
  policyInput: Record<string, unknown> | undefined,
  context: {
    providerResourceType?: string;
    providerResourceToken?: string;
    requestSummary?: Record<string, unknown>;
  },
): Record<string, unknown> | undefined {
  if (!policyInput) {
    return policyInput;
  }
  const sanitized = { ...policyInput };
  const action = readRecord(policyInput.action);
  if (!action) {
    return sanitized;
  }
  const sanitizedAction = { ...action };
  const rawIdentifiers = readFeishuApprovalRawResourceIdentifiers(context);
  const providerResourceType = context.providerResourceType ?? readString(context.requestSummary, "providerResourceType");
  const providerResourceToken = context.providerResourceToken ?? readString(sanitizedAction, "resourceId");
  if (providerResourceType && providerResourceToken) {
    sanitizedAction.resourceReference = formatFeishuApprovalResourceReference({
      providerResourceType,
      providerResourceToken,
      tableId: readString(context.requestSummary, "tableId"),
    });
    sanitizedAction.resourceIdRedacted = true;
  }
  const operationSummary = readString(sanitizedAction, "operationSummary");
  if (operationSummary) {
    sanitizedAction.operationSummary = redactFeishuApprovalRawIdentifiers(operationSummary, rawIdentifiers);
  }
  delete sanitizedAction.resourceId;
  sanitized.action = sanitizedAction;
  return sanitized;
}

function readFeishuApprovalRawResourceIdentifiers(input: {
  providerResourceType?: string;
  providerResourceToken?: string;
  requestSummary?: Record<string, unknown>;
}): Array<{ raw: string; reference: string }> {
  const items: Array<{ raw: string; reference: string }> = [];
  if (input.providerResourceType && input.providerResourceToken) {
    items.push({
      raw: input.providerResourceToken,
      reference: formatFeishuApprovalResourceReference({
        providerResourceType: input.providerResourceType,
        providerResourceToken: input.providerResourceToken,
      }),
    });
  }
  const summary = input.requestSummary;
  const tableId = readString(summary, "tableId");
  if (input.providerResourceType && input.providerResourceToken && tableId) {
    items.push({
      raw: tableId,
      reference: formatFeishuApprovalResourceReference({
        providerResourceType: input.providerResourceType,
        providerResourceToken: input.providerResourceToken,
        tableId,
      }),
    });
  }
  for (const key of ["appToken", "viewId", "folderToken", "parentBlockId", "blockId"]) {
    const raw = readString(summary, key);
    if (raw) {
      items.push({
        raw,
        reference: `resource ${hashFeishuShortReference(raw)}`,
      });
    }
  }
  return items;
}

function redactFeishuApprovalRawIdentifiers(
  value: string,
  identifiers: Array<{ raw: string; reference: string }>,
): string {
  let redacted = value;
  for (const item of identifiers) {
    redacted = redacted.split(item.raw).join(item.reference);
  }
  return redacted;
}

function formatFeishuApprovalResourceReference(input: {
  providerResourceType: string;
  providerResourceToken: string;
  tableId?: string;
}): string {
  const tableId = input.tableId?.trim();
  const token = tableId || input.providerResourceToken.trim();
  const resourceType = tableId && input.providerResourceType === "base"
    ? "base_table"
    : input.providerResourceType.trim() || "resource";
  if (!token) {
    return `${resourceType} / resource`;
  }
  return `${resourceType} / resource ${hashFeishuShortReference(token)}`;
}

export function formatFeishuApprovalReviewerReference(input: {
  displayName?: string;
  externalUserId?: string;
}): string {
  const displayName = input.displayName?.trim();
  if (displayName) {
    return displayName;
  }
  const externalUserId = input.externalUserId?.trim();
  if (!externalUserId) {
    return "Feishu user";
  }
  return `user ${hashFeishuShortReference(externalUserId)}`;
}

function hashFeishuShortReference(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function readFeishuDataOperationApproval(workspaceId: string, approvalId: string): ApprovalRequest {
  const approval = listApprovalsSync(workspaceId).find((item) => item.id === approvalId);
  if (!approval) {
    throw new Error(`Approval "${approvalId}" does not exist.`);
  }
  if (
    approval.type !== "external_data_operation" ||
    readString(approval.metadata, "provider") !== FEISHU_PROVIDER_ID
  ) {
    throw new Error(`Approval "${approvalId}" is not a Feishu data operation approval.`);
  }
  return approval;
}

function readFeishuDataOperationApprovalMetadata(approval: ApprovalRequest): FeishuDataOperationApprovalMetadata {
  const metadata = approval.metadata ?? {};
  const integrationId = readString(metadata, "integrationId");
  const operationRunId = readString(metadata, "operationRunId");
  const operationType = readString(metadata, "operationType");
  const providerResourceType = readString(metadata, "providerResourceType");
  const providerResourceToken = readString(metadata, "providerResourceToken");
  const payloadHash = readString(metadata, "payloadHash");
  const requestSummary = readRecord(metadata.requestSummary);
  const operationRequest = readExternalDataOperationRequest(metadata.operationRequest);
  if (
    !integrationId ||
    !operationRunId ||
    !operationType ||
    !providerResourceType ||
    !providerResourceToken ||
    !payloadHash ||
    !requestSummary ||
    !operationRequest
  ) {
    throw new Error(`Feishu data operation approval "${approval.id}" is missing execution metadata.`);
  }
  return {
    provider: FEISHU_PROVIDER_ID,
    integrationId,
    resourceBindingId: readString(metadata, "resourceBindingId"),
    operationRunId,
    operationType,
    providerResourceType,
    providerResourceToken,
    payloadHash,
    requestSummary,
    operationRequest,
    agentActionPolicyInput: readRecord(metadata.agentActionPolicyInput) as AgentActionPolicyInput | undefined,
    agentActionPolicyDecision: readRecord(metadata.agentActionPolicyDecision) as AgentActionPolicyDecision | undefined,
    feishuCardActionToken: readString(metadata, "feishuCardActionToken"),
    feishuCardActionExpiresAt: readString(metadata, "feishuCardActionExpiresAt"),
    sourceAgentSpaceMessageId: readString(metadata, "sourceAgentSpaceMessageId"),
    taskId: readString(metadata, "taskId"),
  };
}

function buildFeishuApprovalCardAction(approval: ApprovalRequest): {
  approvalId: string;
  payloadHash: string;
  token: string;
} | undefined {
  const metadata = readRecord(approval.metadata);
  const payloadHash = readString(metadata, "payloadHash");
  const token = readString(metadata, "feishuCardActionToken");
  if (!payloadHash || !token) {
    return undefined;
  }
  return {
    approvalId: approval.id,
    payloadHash,
    token,
  };
}

function createFeishuApprovalCardActionToken(): string {
  return randomBytes(12).toString("base64url");
}

function parseFeishuApprovalCardActionPayload(payload: Record<string, unknown>): {
  approvalId: string;
  decision: "approved" | "rejected";
  payloadHash: string;
  token: string;
} | null {
  const event = asRecord(payload.event);
  const action = asRecord(event?.action);
  const value = asRecord(action?.value);
  const valueRecord = value ?? undefined;
  const approvalId = readString(valueRecord, "approvalId") ?? readString(valueRecord, "approval_id");
  const payloadHash = readString(valueRecord, "payloadHash") ?? readString(valueRecord, "payload_hash");
  const token = readString(valueRecord, "token") ?? readString(valueRecord, "approvalToken") ?? readString(valueRecord, "approval_token");
  const rawDecision = readString(valueRecord, "decision")?.trim().toLowerCase();
  const decision = rawDecision === "approved" || rawDecision === "approve"
    ? "approved"
    : rawDecision === "rejected" || rawDecision === "reject"
      ? "rejected"
      : undefined;
  if (!approvalId || !payloadHash || !token || !decision) {
    return null;
  }
  return {
    approvalId,
    decision,
    payloadHash,
    token,
  };
}

function resolveFeishuCardActionOperatorOpenId(payload: Record<string, unknown>): string | undefined {
  const event = asRecord(payload.event);
  const operator = asRecord(event?.operator);
  const operatorId = asRecord(operator?.operator_id);
  return asString(operatorId?.open_id)
    ?? asString(operator?.open_id)
    ?? asString(operator?.openId)
    ?? asString(event?.operator_open_id);
}

function readFeishuCardActionUserBinding(input: {
  workspaceId: string;
  integrationId: string;
  operatorOpenId: string;
}) {
  return readExternalUserBindingByExternalUserSync({
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
    externalUserId: input.operatorOpenId,
  }) ?? listExternalUserBindingsSync({
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
    status: "active",
  }).find((binding) => binding.externalOpenId === input.operatorOpenId) ?? null;
}

function validateFeishuApprovalPolicyForReview(
  approval: ApprovalRequest,
  metadata: FeishuDataOperationApprovalMetadata,
): void {
  const policyInput = metadata.agentActionPolicyInput;
  const policyDecision = metadata.agentActionPolicyDecision;
  if (!policyInput || !policyDecision) {
    throw new Error(`Feishu data operation approval "${approval.id}" is missing policy metadata.`);
  }
  const freshDecision = decideAgentActionPolicySync(policyInput);
  if (
    policyInput.action.type !== "external_document.write" ||
    freshDecision.decision !== "require_approval" ||
    freshDecision.reasonCode !== policyDecision.reasonCode
  ) {
    throw new Error(`Feishu data operation approval "${approval.id}" failed policy re-check.`);
  }
}

function finishFeishuCardActionCallback(input: {
  workspaceId: string;
  externalEventId: string;
  status: "processed" | "ignored" | "failed";
  handled: boolean;
  reasonCode?: string;
  approvalId?: string;
  decision?: "approved" | "rejected";
  reviewerUserId?: string;
  execution?: {
    runId: string;
    result: ExternalDataOperationResult;
  };
}): FeishuCardActionCallbackResult {
  updateExternalIntegrationEventStatusSync({
    workspaceId: input.workspaceId,
    provider: FEISHU_PROVIDER_ID,
    externalEventId: input.externalEventId,
    status: input.status,
    errorMessage: input.reasonCode,
  });
  return {
    eventId: input.externalEventId,
    eventStatus: input.status,
    handled: input.handled,
    reasonCode: input.reasonCode,
    approvalId: input.approvalId,
    decision: input.decision,
    reviewerUserId: input.reviewerUserId,
    execution: input.execution,
  };
}

async function createFeishuApprovedOperationClient(input: {
  workspaceId: string;
  integrationId: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<FeishuApiClient> {
  const integration = readExternalIntegrationSync({
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
  });
  if (!integration || integration.provider !== FEISHU_PROVIDER_ID || integration.status !== "active") {
    throw new Error("Active Feishu integration is required to execute approved data operations.");
  }
  const credentials = readFeishuIntegrationCredentials(integration);
  const token = await fetchFeishuTenantAccessToken({
    appId: integration.appId ?? "",
    appSecret: credentials.appSecret,
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
  });
  return createFeishuApiClient({
    credentials: {
      appId: integration.appId ?? "",
      appSecret: credentials.appSecret,
      tenantAccessToken: token.tenantAccessToken,
    },
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
  });
}

function requireReviewedApproval(approvals: ApprovalRequest[], approvalId: string): ApprovalRequest {
  const approval = approvals.find((item) => item.id === approvalId);
  if (!approval) {
    throw new Error(`Approval "${approvalId}" could not be read back.`);
  }
  return approval;
}

function readExternalDataOperationRequest(value: unknown): ExternalDataOperationRequest | undefined {
  const record = readRecord(value);
  if (!record) {
    return undefined;
  }
  const operationType = readString(record, "operationType");
  const providerResourceType = readString(record, "providerResourceType");
  const providerResourceToken = readString(record, "providerResourceToken");
  const actorType = readString(record, "actorType");
  const parameters = readRecord(record.parameters);
  if (
    !operationType ||
    !providerResourceType ||
    !providerResourceToken ||
    !isExternalDataOperationActorType(actorType) ||
    !parameters
  ) {
    return undefined;
  }
  return {
    operationType,
    providerResourceType,
    providerResourceToken,
    actorType,
    actorId: readString(record, "actorId"),
    parameters,
  };
}

function readRunRequestJsonRecord(requestJson: string, key: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(requestJson) as unknown;
    const record = readRecord(parsed);
    return readRecord(record?.[key]);
  } catch {
    return undefined;
  }
}

function isExternalDataOperationActorType(value: string | undefined): value is ExternalDataOperationRequest["actorType"] {
  return value === "user" || value === "agent" || value === "system";
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}
