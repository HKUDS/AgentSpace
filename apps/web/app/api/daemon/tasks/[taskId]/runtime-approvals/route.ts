import { createExternalMessageOutboxSync } from "@agent-space/db";
import {
  buildFeishuIdentityBindingRequiredCard,
  buildFeishuInteractiveCardOutboundMessage,
  buildSlackApprovalBlockAction,
  createRuntimeToolApprovalRequestSync,
  evaluateFeishuExternalGuestRuntimeToolIdentityRequirementFromTaskInput,
  queueSlackAgentStatusCardOutboxSync,
  type FeishuRuntimeToolIdentityRequirement,
} from "@agent-space/services";
import type { CreateRuntimeApprovalRequest } from "@agent-space/domain";
import { readTaskForWorkspace, requireDaemonAuth } from "../../../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  const auth = requireDaemonAuth(request);
  if (auth instanceof Response) {
    return auth;
  }

  const { taskId } = await context.params;
  const task = readTaskForWorkspace(taskId, auth.workspaceId);
  if (task instanceof Response) {
    return task;
  }

  const body = (await request.json()) as Partial<CreateRuntimeApprovalRequest>;
  if (!body.provider || !body.runtimeId || !body.toolName || !body.contentPreview) {
    return Response.json({ error: "provider, runtimeId, toolName, and contentPreview are required." }, { status: 400 });
  }
  if (body.runtimeId !== task.runtimeId) {
    return Response.json({ error: "Runtime approval does not match the task runtime." }, { status: 400 });
  }

  const identityRequirement = evaluateFeishuExternalGuestRuntimeToolIdentityRequirementFromTaskInput(task.inputJson);
  if (identityRequirement.required) {
    const identityNoticeQueued = queueFeishuRuntimeToolIdentityRequiredNoticeBestEffort({
      workspaceId: auth.workspaceId,
      taskAgentId: task.agentId,
      identityRequirement,
    });
    return Response.json({
      error: "External guests must bind an AgentSpace identity before approving runtime-sensitive tools.",
      errorCode: "feishu.runtime_tool_external_guest_requires_identity",
      reasonCode: identityRequirement.reasonCode,
      requireIdentity: true,
      actorType: "external_guest",
      externalActorReference: identityRequirement.externalActorReference,
      identityNoticeQueued,
    }, { status: 403 });
  }

  const approval = createRuntimeToolApprovalRequestSync({
    sourceId: task.id,
    agentId: task.agentId,
    channelName: resolveTaskChannelName(task.inputJson),
    toolName: body.toolName,
    toolInput: body.toolInput,
    contentPreview: body.contentPreview,
    provider: body.provider,
    runtimeId: body.runtimeId,
    sessionId: body.sessionId,
  }, auth.workspaceId);
  const slackApprovalCardQueued = queueSlackRuntimeToolApprovalCardBestEffort({
    workspaceId: auth.workspaceId,
    taskInputJson: task.inputJson,
    taskId: task.id,
    approval,
  });

  return Response.json({
    approval: {
      approvalId: approval.id,
      status: approval.status,
      reviewerComment: approval.reviewerComment,
    },
    slackApprovalCardQueued,
  });
}

function resolveTaskChannelName(inputJson: string): string {
  try {
    const parsed = JSON.parse(inputJson) as Record<string, unknown>;
    return readString(parsed.channelName) ?? readString(parsed.channel) ?? readString(parsed.contactId) ?? "";
  } catch {
    return "";
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function queueFeishuRuntimeToolIdentityRequiredNoticeBestEffort(input: {
  workspaceId: string;
  taskAgentId: string;
  identityRequirement: FeishuRuntimeToolIdentityRequirement;
}): boolean {
  const integrationId = input.identityRequirement.botBindingId;
  const targetExternalChatId = input.identityRequirement.externalChatId;
  if (!integrationId || !targetExternalChatId) {
    return false;
  }
  try {
    const outbound = buildFeishuInteractiveCardOutboundMessage({
      targetExternalChatId,
      targetExternalThreadId: input.identityRequirement.externalMessageId,
      card: buildFeishuIdentityBindingRequiredCard({
        agentId: input.identityRequirement.agentId ?? input.taskAgentId,
      }),
    });
    createExternalMessageOutboxSync({
      workspaceId: input.workspaceId,
      integrationId,
      targetExternalChatId: outbound.targetExternalChatId,
      targetExternalThreadId: outbound.targetExternalThreadId,
      payloadJson: outbound.payload,
    });
    return true;
  } catch {
    return false;
  }
}

function queueSlackRuntimeToolApprovalCardBestEffort(input: {
  workspaceId: string;
  taskInputJson: string;
  taskId: string;
  approval: ReturnType<typeof createRuntimeToolApprovalRequestSync>;
}): boolean {
  try {
    const taskInput = parseTaskInput(input.taskInputJson);
    const queued = queueSlackAgentStatusCardOutboxSync({
      workspaceId: input.workspaceId,
      channelName: input.approval.channelName,
      agentId: input.approval.agentId,
      status: "approval_required",
      agentNames: [input.approval.agentId],
      message: input.approval.contentPreview,
      taskId: input.taskId,
      sourceAgentSpaceMessageId: readString(taskInput.sourceMessageId),
      approvalAction: buildSlackApprovalBlockAction(input.approval),
    });
    return queued.length > 0;
  } catch {
    return false;
  }
}

function parseTaskInput(inputJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(inputJson) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
