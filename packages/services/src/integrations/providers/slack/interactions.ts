import {
  listApprovalsSync,
  reviewApprovalSync,
} from "../../../approvals/approvals.ts";
import { tryRecordWorkspaceAuditEventSync } from "../../../shared/audit.ts";
import type { ApprovalRequest } from "@agent-space/domain/workspace";
import {
  readExternalUserBindingByExternalUserSync,
  readWorkspaceMembershipSync,
  recordExternalIntegrationEventSync,
  updateExternalIntegrationEventStatusSync,
} from "@agent-space/db";
import type { ExternalDataOperationResult, IntegrationRuntimeContext } from "../../core/index.ts";
import { FEISHU_PROVIDER_ID } from "../feishu/constants.ts";
import { reviewFeishuDataOperationApproval } from "../feishu/approval.ts";
import { SLACK_PROVIDER_ID } from "./constants.ts";
import {
  asRecord,
  asString,
  buildSlackReference,
  resolveSlackCallbackAppId,
  resolveSlackCallbackTeamId,
} from "./events.ts";
import {
  buildSlackApprovalBlockAction,
  buildSlackApprovalPayloadHash,
} from "./approval-actions.ts";
import {
  queueSlackAgentStatusCardOutboxSync,
  type SlackApprovalBlockActionPayload,
  type SlackAgentStatusCardStatus,
} from "./outbound.ts";

export {
  buildSlackApprovalBlockAction,
  buildSlackApprovalPayloadHash,
} from "./approval-actions.ts";

export interface SlackBlockActionCallbackResult {
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

export interface SlackApprovalBlockAction extends SlackApprovalBlockActionPayload {
  decision: "approved" | "rejected";
}

export interface SlackBlockActionCallbackDependencies {
  recordEvent?: typeof recordExternalIntegrationEventSync;
  updateEventStatus?: typeof updateExternalIntegrationEventStatusSync;
  readUserBinding?: typeof readExternalUserBindingByExternalUserSync;
  readMembership?: typeof readWorkspaceMembershipSync;
  listApprovals?: typeof listApprovalsSync;
  reviewRuntimeApproval?: typeof reviewApprovalSync;
  reviewFeishuDataOperation?: typeof reviewFeishuDataOperationApproval;
  recordAudit?: typeof tryRecordWorkspaceAuditEventSync;
}

export function isSlackInteractionPayload(value: Record<string, unknown>): boolean {
  return value.type === "block_actions" ||
    value.type === "view_submission" ||
    value.type === "view_closed" ||
    value.type === "shortcut" ||
    value.type === "message_action";
}

export function isSlackBlockActionsPayload(value: Record<string, unknown>): boolean {
  return value.type === "block_actions" && Array.isArray(value.actions);
}

export async function processSlackBlockActionCallback(input: {
  context: IntegrationRuntimeContext;
  payload: Record<string, unknown>;
  feishuBaseUrl?: string;
  fetchImpl?: typeof fetch;
  dependencies?: SlackBlockActionCallbackDependencies;
}): Promise<SlackBlockActionCallbackResult> {
  const dependencies = resolveSlackBlockActionCallbackDependencies(input.dependencies);
  const action = parseSlackApprovalBlockActionPayload(input.payload);
  const externalEventId = resolveSlackInteractionEventId(input.payload, action);
  dependencies.recordEvent({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    provider: SLACK_PROVIDER_ID,
    externalEventId,
    eventType: asString(input.payload.type) ?? "block_actions",
    payloadJson: summarizeSlackInteractionPayload(input.payload, action),
  });

  if (!action) {
    return finishSlackBlockActionCallback({
      dependencies,
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "ignored",
      reasonCode: "slack_block_action_payload_invalid",
      handled: false,
    });
  }

  const operatorUserId = resolveSlackInteractionUserId(input.payload);
  if (!operatorUserId) {
    return finishSlackBlockActionCallback({
      dependencies,
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "ignored",
      reasonCode: "slack_block_action_user_missing",
      handled: false,
      approvalId: action.approvalId,
      decision: action.decision,
    });
  }

  const userBinding = dependencies.readUserBinding({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    externalUserId: operatorUserId,
  });
  if (!userBinding || userBinding.status !== "active") {
    return finishSlackBlockActionCallback({
      dependencies,
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "ignored",
      reasonCode: "slack_block_action_user_unbound",
      handled: false,
      approvalId: action.approvalId,
      decision: action.decision,
    });
  }
  const membership = dependencies.readMembership(input.context.workspaceId, userBinding.userId);
  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
    return finishSlackBlockActionCallback({
      dependencies,
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "ignored",
      reasonCode: "slack_block_action_reviewer_forbidden",
      handled: false,
      approvalId: action.approvalId,
      decision: action.decision,
      reviewerUserId: userBinding.userId,
    });
  }

  const approval = dependencies.listApprovals(input.context.workspaceId).find((item) => item.id === action.approvalId);
  if (!approval || approval.status !== "pending") {
    return finishSlackBlockActionCallback({
      dependencies,
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "failed",
      reasonCode: "slack_block_action_approval_invalid",
      handled: false,
      approvalId: action.approvalId,
      decision: action.decision,
      reviewerUserId: userBinding.userId,
    });
  }
  if (buildSlackApprovalPayloadHash(approval) !== action.payloadHash) {
    return finishSlackBlockActionCallback({
      dependencies,
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "failed",
      reasonCode: "slack_block_action_payload_hash_mismatch",
      handled: false,
      approvalId: approval.id,
      decision: action.decision,
      reviewerUserId: userBinding.userId,
    });
  }

  dependencies.recordAudit({
    workspaceId: input.context.workspaceId,
    title: "Slack approval callback",
    note: `Slack user binding ${userBinding.id} reviewed approval ${approval.id}.`,
    code: "slack.approval.block_action",
    data: {
      approvalId: approval.id,
      decision: action.decision,
      reviewerUserId: userBinding.userId,
      externalEventId,
    },
  });

  try {
    const reviewerComment = `Reviewed from Slack Block Kit by ${formatSlackApprovalReviewerReference(userBinding)}.`;
    const execution = await reviewSlackApprovalFromBlockAction({
      workspaceId: input.context.workspaceId,
      approval,
      decision: action.decision,
      reviewerComment,
      feishuBaseUrl: input.feishuBaseUrl,
      fetchImpl: input.fetchImpl,
      dependencies,
    });
    return finishSlackBlockActionCallback({
      dependencies,
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "processed",
      handled: true,
      approvalId: approval.id,
      decision: action.decision,
      reviewerUserId: userBinding.userId,
      execution,
    });
  } catch (error) {
    return finishSlackBlockActionCallback({
      dependencies,
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "failed",
      reasonCode: resolveSlackBlockActionReviewErrorCode(error),
      handled: false,
      approvalId: approval.id,
      decision: action.decision,
      reviewerUserId: userBinding.userId,
    });
  }
}

async function reviewSlackApprovalFromBlockAction(input: {
  workspaceId: string;
  approval: ApprovalRequest;
  decision: "approved" | "rejected";
  reviewerComment: string;
  feishuBaseUrl?: string;
  fetchImpl?: typeof fetch;
  dependencies: Required<SlackBlockActionCallbackDependencies>;
}): Promise<SlackBlockActionCallbackResult["execution"]> {
  if (input.approval.type === "runtime_tool") {
    input.dependencies.reviewRuntimeApproval(
      input.approval.id,
      input.decision,
      input.reviewerComment,
      input.workspaceId,
    );
    return undefined;
  }
  if (
    input.approval.type === "external_data_operation" &&
    readMetadataString(input.approval.metadata, "provider") === FEISHU_PROVIDER_ID
  ) {
    const reviewed = await input.dependencies.reviewFeishuDataOperation({
      workspaceId: input.workspaceId,
      approvalId: input.approval.id,
      decision: input.decision,
      reviewerComment: input.reviewerComment,
      baseUrl: input.feishuBaseUrl,
      fetchImpl: input.fetchImpl,
    });
    queueSlackApprovalReviewStatusCardBestEffort({
      workspaceId: input.workspaceId,
      approval: reviewed.approval,
      status: resolveSlackApprovalReviewStatus(input.decision, reviewed.execution),
      message: buildSlackExternalDataOperationReviewStatusMessage({
        decision: input.decision,
        approval: input.approval,
        execution: reviewed.execution,
      }),
    });
    return reviewed.execution;
  }
  throw new Error("slack_block_action_approval_type_unsupported");
}

export function parseSlackApprovalBlockActionPayload(
  payload: Record<string, unknown>,
): SlackApprovalBlockAction | null {
  const action = readSlackPrimaryAction(payload);
  const value = asString(action?.value);
  const parsedValue = value ? parseJsonRecord(value) : undefined;
  const approvalId = asString(parsedValue?.approvalId) ?? asString(parsedValue?.approval_id);
  const payloadHash = asString(parsedValue?.payloadHash) ?? asString(parsedValue?.payload_hash);
  const token = asString(parsedValue?.token) ?? "";
  const rawDecision = (
    asString(parsedValue?.decision) ??
    decisionFromSlackActionId(asString(action?.action_id))
  )?.trim().toLowerCase();
  const decision = rawDecision === "approved" || rawDecision === "approve"
    ? "approved"
    : rawDecision === "rejected" || rawDecision === "reject"
      ? "rejected"
      : undefined;
  if (!approvalId || !payloadHash || !decision) {
    return null;
  }
  return {
    approvalId,
    decision,
    payloadHash,
    token,
  };
}

function summarizeSlackInteractionPayload(
  payload: Record<string, unknown>,
  action: SlackApprovalBlockAction | null,
): Record<string, unknown> {
  const channel = asRecord(payload.channel);
  const message = asRecord(payload.message);
  const container = asRecord(payload.container);
  const rawAction = readSlackPrimaryAction(payload);
  return {
    type: asString(payload.type) ?? "unknown",
    rawPayloadStored: false,
    appRef: optionalSlackReference(resolveSlackCallbackAppId(payload)),
    teamRef: optionalSlackReference(resolveSlackCallbackTeamId(payload)),
    userRef: optionalSlackReference(resolveSlackInteractionUserId(payload)),
    channelRef: optionalSlackReference(asString(channel?.id) ?? asString(container?.channel_id)),
    messageRef: optionalSlackReference(asString(message?.ts) ?? asString(container?.message_ts)),
    actionId: asString(rawAction?.action_id),
    blockId: asString(rawAction?.block_id),
    approvalBlockAction: action
      ? {
          provider: SLACK_PROVIDER_ID,
          kind: "approval_review",
          approvalId: action.approvalId,
          decision: action.decision,
          payloadHash: action.payloadHash,
          tokenStored: false,
          rawActionPayloadStored: false,
        }
      : undefined,
  };
}

function queueSlackApprovalReviewStatusCardBestEffort(input: {
  workspaceId: string;
  approval: ApprovalRequest;
  status: SlackAgentStatusCardStatus;
  message: string;
}): void {
  try {
    queueSlackAgentStatusCardOutboxSync({
      workspaceId: input.workspaceId,
      channelName: input.approval.channelName,
      agentId: input.approval.agentId,
      status: input.status,
      agentNames: [input.approval.agentId],
      message: input.message,
      taskId: readMetadataString(input.approval.metadata, "taskId"),
      sourceAgentSpaceMessageId: readMetadataString(input.approval.metadata, "sourceAgentSpaceMessageId"),
      requireSourceMapping: true,
    });
  } catch {
    // Slack review receipts are external notifications; approval/run state remains authoritative.
  }
}

function resolveSlackApprovalReviewStatus(
  decision: "approved" | "rejected",
  execution: SlackBlockActionCallbackResult["execution"],
): SlackAgentStatusCardStatus {
  if (decision === "rejected") {
    return "failed";
  }
  return execution?.result.ok ? "complete" : "failed";
}

function buildSlackExternalDataOperationReviewStatusMessage(input: {
  decision: "approved" | "rejected";
  approval: ApprovalRequest;
  execution?: SlackBlockActionCallbackResult["execution"];
}): string {
  const operationType = readMetadataString(input.approval.metadata, "operationType") ?? "external data operation";
  const runId = input.execution?.runId ?? readMetadataString(input.approval.metadata, "operationRunId") ?? "unknown";
  if (input.decision === "rejected") {
    return `Rejected ${operationType}. No provider write was executed.`;
  }
  if (input.execution?.result.ok) {
    return `Approved ${operationType} completed. Operation run ${runId}.`;
  }
  return `Approved ${operationType} failed. Operation run ${runId}.`;
}

function finishSlackBlockActionCallback(input: {
  dependencies: Required<SlackBlockActionCallbackDependencies>;
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
}): SlackBlockActionCallbackResult {
  input.dependencies.updateEventStatus({
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
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

function resolveSlackBlockActionCallbackDependencies(
  dependencies: SlackBlockActionCallbackDependencies | undefined,
): Required<SlackBlockActionCallbackDependencies> {
  return {
    recordEvent: dependencies?.recordEvent ?? recordExternalIntegrationEventSync,
    updateEventStatus: dependencies?.updateEventStatus ?? updateExternalIntegrationEventStatusSync,
    readUserBinding: dependencies?.readUserBinding ?? readExternalUserBindingByExternalUserSync,
    readMembership: dependencies?.readMembership ?? readWorkspaceMembershipSync,
    listApprovals: dependencies?.listApprovals ?? listApprovalsSync,
    reviewRuntimeApproval: dependencies?.reviewRuntimeApproval ?? reviewApprovalSync,
    reviewFeishuDataOperation: dependencies?.reviewFeishuDataOperation ?? reviewFeishuDataOperationApproval,
    recordAudit: dependencies?.recordAudit ?? tryRecordWorkspaceAuditEventSync,
  };
}

function resolveSlackBlockActionReviewErrorCode(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("slack_block_action_")) {
    return error.message;
  }
  return "slack_block_action_review_failed";
}

function resolveSlackInteractionEventId(
  payload: Record<string, unknown>,
  action: SlackApprovalBlockAction | null,
): string {
  const raw = asString(payload.trigger_id)
    ?? asString(readSlackPrimaryAction(payload)?.action_ts)
    ?? [
      action?.approvalId,
      action?.decision,
      asString(payload.type),
      Date.now().toString(),
    ].filter(Boolean).join(":");
  return `slack-interaction-${buildSlackReference(raw).replace(/^ref_/, "")}`;
}

function resolveSlackInteractionUserId(payload: Record<string, unknown>): string | undefined {
  const user = asRecord(payload.user);
  return asString(user?.id)
    ?? asString(payload.user_id)
    ?? asString(payload.userId);
}

function readSlackPrimaryAction(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  return Array.isArray(payload.actions) ? asRecord(payload.actions[0]) : undefined;
}

function decisionFromSlackActionId(actionId: string | undefined): string | undefined {
  if (!actionId) {
    return undefined;
  }
  if (actionId.includes("approve")) {
    return "approved";
  }
  if (actionId.includes("reject")) {
    return "rejected";
  }
  return undefined;
}

function formatSlackApprovalReviewerReference(input: {
  displayName?: string;
  externalUserId?: string;
}): string {
  const displayName = input.displayName?.trim();
  if (displayName) {
    return displayName;
  }
  const externalUserId = input.externalUserId?.trim();
  return externalUserId ? `user ${buildSlackReference(externalUserId)}` : "Slack user";
}

function optionalSlackReference(value: string | undefined): string | undefined {
  return value ? buildSlackReference(value) : undefined;
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function readMetadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
