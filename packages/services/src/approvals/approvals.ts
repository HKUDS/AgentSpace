import {
  DEFAULT_WORKSPACE_ID,
  buildTaskExecutionEventContext,
  listQueuedTasksSync,
  listWorkspaceMembershipsSync,
  readQueuedTaskSync,
  readUserSync,
} from "@agent-space/db";
import type { AgentSpaceState, ApprovalRequest, ApprovalStatus } from "@agent-space/domain/workspace";
import { ensureWorkspaceStateSync, writeWorkspaceStateSync } from "../shared/state-io.ts";
import { sameValue, createOpaqueId } from "../shared/helpers.ts";
import { recordTaskExecutionEventSync } from "../task-execution-events.ts";
import { createNotificationsSync, postNotificationChannelMessageSync } from "../notifications/notifications.ts";

const SYSTEM_SPEAKER = "系统提示";

export function listApprovalsSync(workspaceId?: string): ApprovalRequest[] {
  return ensureWorkspaceStateSync(workspaceId).approvals;
}

export function createApprovalRequestSync(input: {
  type: ApprovalRequest["type"];
  sourceId: string;
  agentId: string;
  channelName: string;
  contentPreview: string;
  metadata?: Record<string, unknown>;
}, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);

  if (!state.activeEmployees.some((employee) => sameValue(employee.name, input.agentId))) {
    throw new Error(`Agent "${input.agentId}" does not exist.`);
  }

  if (!state.channels.some((channel) => sameValue(channel.name, input.channelName))) {
    throw new Error(`Channel "${input.channelName}" does not exist.`);
  }

  const now = new Date().toISOString();
  const approval: ApprovalRequest = {
    id: `approval-${createOpaqueId()}`,
    type: input.type,
    sourceId: input.sourceId,
    agentId: input.agentId,
    channelName: input.channelName,
    status: "pending",
    contentPreview: input.contentPreview,
    metadata: input.metadata,
    createdAt: now,
  };

  state.approvals.unshift(approval);
  state.ledger.unshift({
    title: "Approval requested",
    note: `${input.agentId} submitted ${input.type} for review in ${input.channelName}.`,
  });
  recordApprovalExecutionEvent(approval, workspaceId);
  createApprovalRequestedNotifications(approval, workspaceId ?? DEFAULT_WORKSPACE_ID);

  writeWorkspaceStateSync(state, workspaceId);
  postNotificationChannelMessageSync({
    workspaceId: workspaceId ?? DEFAULT_WORKSPACE_ID,
    channelName: input.channelName,
    summary: buildApprovalConversationSummary(approval),
    code: "approval.created",
    data: buildApprovalMessageData(approval),
    speaker: SYSTEM_SPEAKER,
  });
  return ensureWorkspaceStateSync(workspaceId);
}

export function createRuntimeToolApprovalRequestSync(input: {
  sourceId: string;
  agentId: string;
  channelName: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  contentPreview: string;
  provider?: string;
  runtimeId?: string;
  sessionId?: string;
}, workspaceId?: string): ApprovalRequest {
  const existing = listApprovalsSync(workspaceId).find((approval) =>
    approval.type === "runtime_tool" &&
    approval.sourceId === input.sourceId &&
    approval.status === "pending" &&
    approval.metadata &&
    approval.metadata.toolName === input.toolName &&
    JSON.stringify(approval.metadata.toolInput ?? {}) === JSON.stringify(input.toolInput ?? {})
  );
  if (existing) {
    return existing;
  }

  const state = createApprovalRequestSync({
    type: "runtime_tool",
    sourceId: input.sourceId,
    agentId: input.agentId,
    channelName: input.channelName,
    contentPreview: input.contentPreview,
    metadata: {
      toolName: input.toolName,
      toolInput: input.toolInput ?? {},
      provider: input.provider,
      runtimeId: input.runtimeId,
      sessionId: input.sessionId,
    },
  }, workspaceId);

  const created = state.approvals[0];
  if (!created) {
    throw new Error("Runtime tool approval could not be created.");
  }
  return created;
}

export function reviewApprovalSync(
  approvalId: string,
  decision: "approved" | "rejected",
  comment?: string,
  workspaceId?: string,
): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const approval = state.approvals.find((item) => item.id === approvalId);

  if (!approval) {
    throw new Error(`Approval "${approvalId}" does not exist.`);
  }

  if (approval.status !== "pending") {
    throw new Error(`Approval "${approvalId}" is already ${approval.status}.`);
  }

  approval.status = decision;
  approval.reviewerComment = comment;
  approval.reviewedAt = new Date().toISOString();
  updateApprovalConversationMessages(state, approval);

  state.ledger.unshift({
    title: `Approval ${decision}`,
    note: `${approval.agentId}'s ${approval.type} was ${decision}${comment ? `: ${comment}` : ""}.`,
  });
  createApprovalDecisionNotifications(approval, decision, workspaceId ?? DEFAULT_WORKSPACE_ID, state);

  writeWorkspaceStateSync(state, workspaceId);
  postNotificationChannelMessageSync({
    workspaceId: workspaceId ?? DEFAULT_WORKSPACE_ID,
    channelName: approval.channelName,
    summary: `Approval for ${approval.agentId}'s ${approval.type} was ${decision}.${comment ? ` Comment: ${comment}` : ""}`,
    code: `approval.${decision}`,
    data: { ...buildApprovalMessageData(approval), decision },
    speaker: SYSTEM_SPEAKER,
  });
  return ensureWorkspaceStateSync(workspaceId);
}

function recordApprovalExecutionEvent(approval: ApprovalRequest, workspaceId?: string): void {
  const queued =
    readQueuedTaskSync(approval.sourceId)
    ?? listQueuedTasksSync({ workspaceId }).find((task) => task.issueId === approval.sourceId);
  if (!queued) {
    return;
  }
  const context = buildTaskExecutionEventContext(queued);
  recordTaskExecutionEventSync({
    ...context,
    type: "approval_requested",
    title: "Approval requested",
    summary: `${approval.agentId} requested approval for ${approval.type}.`,
    severity: "warning",
    status: "pending",
    data: {
      approvalId: approval.id,
      approvalType: approval.type,
      sourceId: approval.sourceId,
      triggerType: context.triggerType,
    },
  });
}

function createApprovalRequestedNotifications(approval: ApprovalRequest, workspaceId: string): void {
  const recipients = listWorkspaceMembershipsSync(workspaceId)
    .filter((membership) => membership.role === "owner" || membership.role === "admin")
    .map((membership) => readUserSync(membership.userId))
    .filter((user): user is NonNullable<ReturnType<typeof readUserSync>> => Boolean(user));

  createNotificationsSync(recipients.map((recipient) => ({
    workspaceId,
    recipientType: "human",
    recipientId: recipient.id,
    actorType: "agent",
    actorId: approval.agentId,
    type: "approval.requested",
    resourceType: "approval",
    resourceId: approval.id,
    channelName: approval.channelName,
    title: "Approval requested",
    body: buildApprovalConversationSummary(approval),
    actionHref: "/approvals",
    severity: "warning",
    dedupeKey: `approval.requested:${workspaceId}:${approval.id}:${recipient.id}`,
    metadata: {
      approvalId: approval.id,
      approvalType: approval.type,
      agentId: approval.agentId,
      channelName: approval.channelName,
      sourceId: approval.sourceId,
    },
  })));
}

function createApprovalDecisionNotifications(
  approval: ApprovalRequest,
  decision: "approved" | "rejected",
  workspaceId: string,
  state: AgentSpaceState,
): void {
  const employee = state.activeEmployees.find((item) => sameValue(item.name, approval.agentId));
  const owner = employee?.ownerUserId ? readUserSync(employee.ownerUserId) : null;
  const title = decision === "approved" ? "Approval approved" : "Approval rejected";
  const body = buildApprovalConversationSummary(approval);

  createNotificationsSync([
    {
      workspaceId,
      recipientType: "agent",
      recipientId: approval.agentId,
      actorType: "system",
      actorId: "approval",
      type: decision === "approved" ? "approval.approved" : "approval.rejected",
      resourceType: "approval",
      resourceId: approval.id,
      channelName: approval.channelName,
      title,
      body,
      actionHref: `/im?focus=${encodeURIComponent(`channel:${approval.channelName}`)}`,
      severity: decision === "approved" ? "success" : "warning",
      dedupeKey: `approval.${decision}:${workspaceId}:${approval.id}:${approval.agentId}`,
      metadata: {
        approvalId: approval.id,
        approvalType: approval.type,
        agentId: approval.agentId,
        channelName: approval.channelName,
        sourceId: approval.sourceId,
        reviewerComment: approval.reviewerComment,
      },
    },
    ...(owner
      ? [{
          workspaceId,
          recipientType: "human" as const,
          recipientId: owner.id,
          actorType: "system" as const,
          actorId: "approval",
          type: decision === "approved" ? "approval.approved.owner" : "approval.rejected.owner",
          resourceType: "approval" as const,
          resourceId: approval.id,
          channelName: approval.channelName,
          title,
          body,
          actionHref: `/im?focus=${encodeURIComponent(`channel:${approval.channelName}`)}`,
          severity: decision === "approved" ? "success" as const : "warning" as const,
          dedupeKey: `approval.${decision}.owner:${workspaceId}:${approval.id}:${owner.id}`,
          metadata: {
            approvalId: approval.id,
            approvalType: approval.type,
            agentId: approval.agentId,
            channelName: approval.channelName,
            sourceId: approval.sourceId,
            reviewerComment: approval.reviewerComment,
          },
        }]
      : []),
  ]);
}

function updateApprovalConversationMessages(state: AgentSpaceState, approval: ApprovalRequest): void {
  for (const message of state.messages) {
    if (message.code !== "approval.created" || message.data?.approval_id !== approval.id) {
      continue;
    }
    message.summary = buildApprovalConversationSummary(approval);
    message.data = buildApprovalMessageData(approval);
  }
}

function buildApprovalConversationSummary(approval: ApprovalRequest): string {
  if (approval.type === "runtime_tool") {
    const toolName = readMetadataString(approval.metadata, "toolName") ?? "tool";
    if (approval.status === "pending") {
      return `${approval.agentId} requested permission to run ${toolName}: ${approval.contentPreview}`;
    }
    return `${approval.agentId}'s ${toolName} permission was ${approval.status}: ${approval.contentPreview}`;
  }
  if (approval.type === "external_data_operation") {
    const provider = readMetadataString(approval.metadata, "provider") ?? "external";
    const operationType = readMetadataString(approval.metadata, "operationType") ?? "data operation";
    if (approval.status === "pending") {
      return `${approval.agentId} requested approval for ${provider} ${operationType}: ${approval.contentPreview}`;
    }
    return `${approval.agentId}'s ${provider} ${operationType} approval was ${approval.status}: ${approval.contentPreview}`;
  }
  if (approval.status === "pending") {
    return `${approval.agentId} submitted a ${approval.type} for approval.`;
  }
  return `${approval.agentId}'s ${approval.type} approval was ${approval.status}.`;
}

function buildApprovalMessageData(approval: ApprovalRequest): Record<string, string> {
  const metadata = approval.metadata ?? {};
  return compactRecord({
    approval_id: approval.id,
    approval_type: approval.type,
    approval_status: approval.status,
    source_id: approval.sourceId,
    agent_id: approval.agentId,
    content_preview: approval.contentPreview,
    tool_name: readMetadataString(metadata, "toolName"),
    provider: readMetadataString(metadata, "provider"),
    runtime_id: readMetadataString(metadata, "runtimeId"),
    session_id: readMetadataString(metadata, "sessionId"),
    operation_run_id: readMetadataString(metadata, "operationRunId"),
    operation_type: readMetadataString(metadata, "operationType"),
    provider_resource_type: readMetadataString(metadata, "providerResourceType"),
    payload_hash: readMetadataString(metadata, "payloadHash"),
    reviewed_at: approval.reviewedAt,
    reviewer_comment: approval.reviewerComment,
  });
}

function readMetadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compactRecord(input: Record<string, string | undefined>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.trim()) {
      output[key] = value;
    }
  }
  return output;
}
