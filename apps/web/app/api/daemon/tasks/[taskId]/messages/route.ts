import {
  appendTaskMessageSync,
  markAgentRouterProviderSessionInvalidSync,
  recordAgentRouterEventSync,
  type QueuedTaskRecord,
} from "@agent-space/db";
import type { DaemonProvider, DaemonTaskMessageInput, ReportTaskMessagesRequest } from "@agent-space/domain";
import { parseTaskPayload } from "agent-space-daemon";
import { streamAgentChannelReplyDeltaSync } from "@agent-space/services";
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

  const body = (await request.json()) as Partial<ReportTaskMessagesRequest>;
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "messages[] is required." }, { status: 400 });
  }

  const payload = parseTaskPayload(task);
  const appended = body.messages.map((message) => appendSingleMessage(task, payload, message));
  return Response.json({ messages: appended });
}

function appendSingleMessage(
  task: QueuedTaskRecord,
  payload: ReturnType<typeof parseTaskPayload>,
  message: DaemonTaskMessageInput,
) {
  if (message.type === "provider_session_invalid") {
    handleProviderSessionInvalid(task, message);
  }
  streamChannelReplyDeltaBestEffort(task, payload, message);
  return appendTaskMessageSync({
    taskId: task.id,
    type: message.type === "provider_session_invalid" ? "status" : message.type,
    content: message.content,
    tool: message.tool,
    inputJson: message.inputJson,
    output: message.output,
  });
}

function streamChannelReplyDeltaBestEffort(
  task: QueuedTaskRecord,
  payload: ReturnType<typeof parseTaskPayload>,
  message: DaemonTaskMessageInput,
): void {
  if (message.type !== "text" || !message.content) {
    return;
  }
  const channelName = payload.channelName ?? payload.channel;
  const pendingSpeaker = payload.assignee ?? payload.contactId ?? task.agentId;
  if (!channelName || !pendingSpeaker) {
    return;
  }

  try {
    streamAgentChannelReplyDeltaSync({
      channel: channelName,
      pendingSpeaker,
      delta: message.content,
      sourceTaskQueueId: task.id,
    }, task.workspaceId);
  } catch (error) {
    console.error(
      `Failed to stream channel reply delta for ${task.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function handleProviderSessionInvalid(task: QueuedTaskRecord, message: DaemonTaskMessageInput): void {
  if (!task.routerSessionId) {
    return;
  }
  const data = message.inputJson ?? {};
  const provider = typeof data.provider === "string" ? data.provider as DaemonProvider : undefined;
  const sessionId = typeof data.sessionId === "string" ? data.sessionId : undefined;
  markAgentRouterProviderSessionInvalidSync({
    workspaceId: task.workspaceId,
    routerSessionId: task.routerSessionId,
    runtimeId: task.runtimeId,
    provider,
    providerSessionId: sessionId,
    lastError: message.content ?? "Provider session was invalid.",
  });
  recordAgentRouterEventSync({
    workspaceId: task.workspaceId,
    routerSessionId: task.routerSessionId,
    taskQueueId: task.id,
    type: "provider_session_invalid",
    actorType: "runtime",
    actorId: task.runtimeId,
    runtimeId: task.runtimeId,
    provider,
    summary: message.content,
    data: {
      providerSessionId: sessionId,
      code: typeof data.code === "string" ? data.code : "provider.session_invalid",
    },
  });
}
