import { createHash } from "node:crypto";
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
import type { IntegrationRuntimeContext } from "../../core/index.ts";
import { SLACK_PROVIDER_ID } from "./constants.ts";
import {
  asRecord,
  asString,
  buildSlackReference,
  resolveSlackCallbackAppId,
  resolveSlackCallbackTeamId,
} from "./events.ts";
import type { SlackApprovalBlockActionPayload } from "./outbound.ts";

export interface SlackBlockActionCallbackResult {
  eventId: string;
  eventStatus: "processed" | "ignored" | "failed";
  handled: boolean;
  reasonCode?: string;
  approvalId?: string;
  decision?: "approved" | "rejected";
  reviewerUserId?: string;
}

export interface SlackApprovalBlockAction extends SlackApprovalBlockActionPayload {
  decision: "approved" | "rejected";
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

export function buildSlackApprovalBlockAction(approval: ApprovalRequest): SlackApprovalBlockActionPayload {
  return {
    approvalId: approval.id,
    payloadHash: buildSlackApprovalPayloadHash(approval),
    token: "",
  };
}

export function buildSlackApprovalPayloadHash(approval: ApprovalRequest): string {
  return createHash("sha256")
    .update(JSON.stringify({
      id: approval.id,
      type: approval.type,
      sourceId: approval.sourceId,
      agentId: approval.agentId,
      channelName: approval.channelName,
      contentPreview: approval.contentPreview,
      metadata: approval.metadata ?? {},
    }), "utf8")
    .digest("hex");
}

export async function processSlackBlockActionCallback(input: {
  context: IntegrationRuntimeContext;
  payload: Record<string, unknown>;
}): Promise<SlackBlockActionCallbackResult> {
  const action = parseSlackApprovalBlockActionPayload(input.payload);
  const externalEventId = resolveSlackInteractionEventId(input.payload, action);
  recordExternalIntegrationEventSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    provider: SLACK_PROVIDER_ID,
    externalEventId,
    eventType: asString(input.payload.type) ?? "block_actions",
    payloadJson: summarizeSlackInteractionPayload(input.payload, action),
  });

  if (!action) {
    return finishSlackBlockActionCallback({
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
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "ignored",
      reasonCode: "slack_block_action_user_missing",
      handled: false,
      approvalId: action.approvalId,
      decision: action.decision,
    });
  }

  const userBinding = readExternalUserBindingByExternalUserSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    externalUserId: operatorUserId,
  });
  if (!userBinding || userBinding.status !== "active") {
    return finishSlackBlockActionCallback({
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "ignored",
      reasonCode: "slack_block_action_user_unbound",
      handled: false,
      approvalId: action.approvalId,
      decision: action.decision,
    });
  }
  const membership = readWorkspaceMembershipSync(input.context.workspaceId, userBinding.userId);
  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
    return finishSlackBlockActionCallback({
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

  const approval = listApprovalsSync(input.context.workspaceId).find((item) => item.id === action.approvalId);
  if (!approval || approval.status !== "pending") {
    return finishSlackBlockActionCallback({
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
  if (approval.type !== "runtime_tool") {
    return finishSlackBlockActionCallback({
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "failed",
      reasonCode: "slack_block_action_approval_type_unsupported",
      handled: false,
      approvalId: approval.id,
      decision: action.decision,
      reviewerUserId: userBinding.userId,
    });
  }
  if (buildSlackApprovalPayloadHash(approval) !== action.payloadHash) {
    return finishSlackBlockActionCallback({
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

  tryRecordWorkspaceAuditEventSync({
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
    reviewApprovalSync(
      approval.id,
      action.decision,
      `Reviewed from Slack Block Kit by ${formatSlackApprovalReviewerReference(userBinding)}.`,
      input.context.workspaceId,
    );
    return finishSlackBlockActionCallback({
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "processed",
      handled: true,
      approvalId: approval.id,
      decision: action.decision,
      reviewerUserId: userBinding.userId,
    });
  } catch {
    return finishSlackBlockActionCallback({
      workspaceId: input.context.workspaceId,
      externalEventId,
      status: "failed",
      reasonCode: "slack_block_action_review_failed",
      handled: false,
      approvalId: approval.id,
      decision: action.decision,
      reviewerUserId: userBinding.userId,
    });
  }
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
          kind: "runtime_tool_approval",
          approvalId: action.approvalId,
          decision: action.decision,
          payloadHash: action.payloadHash,
          tokenStored: false,
          rawActionPayloadStored: false,
        }
      : undefined,
  };
}

function finishSlackBlockActionCallback(input: {
  workspaceId: string;
  externalEventId: string;
  status: "processed" | "ignored" | "failed";
  handled: boolean;
  reasonCode?: string;
  approvalId?: string;
  decision?: "approved" | "rejected";
  reviewerUserId?: string;
}): SlackBlockActionCallbackResult {
  updateExternalIntegrationEventStatusSync({
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
  };
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
