import { appendTaskMessageSync, failQueuedTaskSync } from "@agent-space/db";
import { parseTaskPayload } from "agent-space-daemon";
import type { FailTaskRequest } from "@agent-space/domain";
import {
  continueAutoContinuationAfterTaskSync,
  failChannelDocumentRunStepSync,
  formatConversationFailureSummary,
  formatTaskFailureSummary,
  postMessageSync,
  queueFeishuChannelReplyOutboxSync,
  readWorkspaceStateSync,
  replacePendingChannelMessageSync,
  resolveCompatibleDirectChannelRecord,
  writeConversationExecutionWorkspaceStateSync,
  upsertDirectConversationStateSync,
  updateTaskStatusSync,
  writeWorkspaceStateSync,
} from "@agent-space/services";
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

  const body = (await request.json()) as Partial<FailTaskRequest>;
  if (!body.errorText?.trim()) {
    return Response.json({ error: "errorText is required." }, { status: 400 });
  }

  const payload = parseTaskPayload(task);
  const workspaceState = readWorkspaceStateSync(task.workspaceId);
  const effectiveChannelName =
    payload.channelName
      ?? (payload.contactId ? resolveCompatibleDirectChannelRecord(workspaceState, payload.contactId)?.name : undefined);
  failQueuedTaskSync({
    taskId: task.id,
    errorText: body.errorText.trim(),
    sessionId: body.sessionId,
    workDir: body.workDir,
    errorCode: body.errorCode,
    errorCategory: body.errorCategory,
    provider: body.provider,
    rawProviderMessage: body.rawProviderMessage,
  });
  const providerDiagnosticMessage = formatProviderDiagnosticMessage(body);
  if (providerDiagnosticMessage) {
    appendTaskMessageSync({
      taskId: task.id,
      type: "status",
      content: providerDiagnosticMessage,
    });
  }

  if (payload.taskId) {
    updateTaskStatusSync(payload.taskId, "blocked", task.workspaceId);
  }
  if (payload.orchestrationStepId) {
    writeWorkspaceStateSync(
      failChannelDocumentRunStepSync({
        queuedTaskId: task.id,
        errorText: body.errorText.trim(),
      }, task.workspaceId),
      task.workspaceId,
    );
  }
  if (effectiveChannelName && payload.channel) {
    const failureSummary = formatConversationFailureSummary({
      agentName: payload.assignee ?? task.agentId,
      channelName: payload.channel,
      errorText: body.errorText.trim(),
      isDirectConversation: Boolean(payload.contactId),
    });
    replacePendingChannelMessageSync({
      channel: payload.channel,
      pendingSpeaker: payload.assignee ?? task.agentId,
      speaker: "系统提示",
      role: "agent",
      summary: failureSummary,
      status: "error",
    }, task.workspaceId);
    for (const statusMessage of enqueueFeishuReplyOutboxBestEffort({
      workspaceId: task.workspaceId,
      channelName: payload.channel,
      text: failureSummary,
      sourceAgentSpaceMessageId: payload.sourceMessageId,
    })) {
      appendTaskMessageSync({
        taskId: task.id,
        type: "status",
        content: statusMessage,
      });
    }
    writeConversationExecutionWorkspaceStateSync({
      channelName: payload.channel,
      agentId: payload.assignee ?? task.agentId,
      contactId: payload.contactId,
      sessionId: body.sessionId,
      workDir: body.workDir,
      lastTaskQueueId: task.id,
      lastError: body.errorText.trim(),
    }, task.workspaceId);
    if (payload.contactId) {
      upsertDirectConversationStateSync(
        {
          contactId: payload.contactId,
          sessionId: body.sessionId,
          workDir: body.workDir,
        },
        task.workspaceId,
      );
    }
  } else if (payload.contactId) {
    writeConversationExecutionWorkspaceStateSync({
      channelName: effectiveChannelName ?? payload.channel ?? payload.contactId,
      agentId: payload.contactId,
      contactId: payload.contactId,
      sessionId: body.sessionId,
      workDir: body.workDir,
      lastTaskQueueId: task.id,
      lastError: body.errorText.trim(),
    }, task.workspaceId);
    upsertDirectConversationStateSync(
      {
        contactId: payload.contactId,
        sessionId: body.sessionId,
        workDir: body.workDir,
      },
      task.workspaceId,
    );
  } else if (payload.channel) {
    const failureSummary = formatTaskFailureSummary({
      title: payload.title || task.id,
      errorText: body.errorText.trim(),
    });
    postMessageSync({
      channel: payload.channel,
      speaker: "系统提示",
      role: "agent",
      summary: failureSummary,
      status: "error",
    }, task.workspaceId);
    for (const statusMessage of enqueueFeishuReplyOutboxBestEffort({
      workspaceId: task.workspaceId,
      channelName: payload.channel,
      text: failureSummary,
      sourceAgentSpaceMessageId: payload.sourceMessageId,
    })) {
      appendTaskMessageSync({
        taskId: task.id,
        type: "status",
        content: statusMessage,
      });
    }
    writeConversationExecutionWorkspaceStateSync({
      channelName: payload.channel,
      agentId: payload.assignee ?? task.agentId,
      sessionId: body.sessionId,
      workDir: body.workDir,
      lastTaskQueueId: task.id,
      lastError: body.errorText.trim(),
    }, task.workspaceId);
  }
  tryContinueAutoContinuation({
    taskId: task.id,
    workspaceId: task.workspaceId,
    sessionId: body.sessionId,
    workDir: body.workDir,
  });

  return Response.json({
    task: {
      id: task.id,
      status: "failed",
      errorText: body.errorText.trim(),
    },
  });
}

function enqueueFeishuReplyOutboxBestEffort(input: {
  workspaceId: string;
  channelName: string;
  text: string;
  agentSpaceMessageId?: string;
  sourceAgentSpaceMessageId?: string;
}): string[] {
  try {
    const outboxItems = queueFeishuChannelReplyOutboxSync(input);
    return outboxItems.length > 0 ? [`Feishu outbound queued: ${outboxItems.length} message(s).`] : [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [`Feishu outbound enqueue failed: ${message}`];
  }
}

function formatProviderDiagnosticMessage(body: Partial<FailTaskRequest>): string | undefined {
  const parts = [
    body.errorCode ? `code=${body.errorCode}` : undefined,
    body.errorCategory ? `category=${body.errorCategory}` : undefined,
    body.provider ? `provider=${body.provider}` : undefined,
    body.rawProviderMessage?.trim() ? `raw=${body.rawProviderMessage.trim()}` : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? `provider diagnostic: ${parts.join("; ")}` : undefined;
}

function tryContinueAutoContinuation(input: {
  taskId: string;
  workspaceId: string;
  sessionId?: string;
  workDir?: string;
}): void {
  try {
    continueAutoContinuationAfterTaskSync(input);
  } catch {
    // Failure reporting should not fail if the best-effort continuation enqueue fails.
  }
}
