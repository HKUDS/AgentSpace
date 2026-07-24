import {
  cancelQueuedTaskSync,
  DEFAULT_WORKSPACE_ID,
  enqueueNativeTaskSync,
  listQueuedTasksSync,
  readQueuedTaskSync,
  type QueuedTaskRecord,
} from "@agent-space/db";
import type {
  AgentSpaceState,
  ConversationAutoContinuationState,
} from "@agent-space/domain/workspace";
import { getChannelHistoryFilePath, buildChannelHistorySnapshot, pushWorkspaceMessageToChannel } from "../shared/messaging.ts";
import {
  readConversationExecutionWorkspaceState,
  resolveConversationExecutionWorkspacePath,
  upsertConversationExecutionWorkspaceState,
} from "../shared/conversation-execution-workspaces.ts";
import { ensureWorkspaceStateSync, writeWorkspaceStateSync } from "../shared/state-io.ts";
import { sameValue } from "../shared/helpers.ts";

const HOUR_MS = 60 * 60 * 1000;
export const AUTO_CONTINUATION_REPLY = "好的，如果没做完，继续往下收尾，如果做完了寻找有没有别的可以做的然后继续做";
const AUTO_CONTINUATION_COORDINATOR = "系统提示";

export interface AutoContinuationDirective {
  mode: "until";
  startedAt: string;
  until: string;
  instruction: string;
  durationMs: number;
}

export interface AutoContinuationDispatchResult {
  queued: boolean;
  reason?: "missing_task" | "missing_payload" | "inactive" | "stale_task" | "expired" | "missing_target" | "missing_runtime";
  queuedTaskId?: string;
  until?: string;
}

export interface StopAutoContinuationResult {
  stopped: boolean;
  reason?: "missing_target" | "inactive";
  cancelledTaskId?: string;
}

export function parseAutoContinuationDirective(
  message: string,
  now = new Date(),
): AutoContinuationDirective | null {
  const normalized = message.replace(/[，。；;]/g, " ");
  const durationMatch =
    /(?:从现在起|现在起|接下来|连续|持续|自动接管|接管|工作)?\s*(?:连续工作|持续工作|自动接管|接管|工作|连续)\s*(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|小时|个小时)/i.exec(normalized);
  if (durationMatch) {
    const hours = Number(durationMatch[1]);
    if (Number.isFinite(hours) && hours > 0) {
      return buildDirective(now, hours * HOUR_MS);
    }
  }

  const untilMatch =
    /(?:直到|到)\s*(今天|明天)?\s*(\d{1,2})(?:[:：点](\d{1,2}))?\s*(?:分)?/.exec(normalized);
  if (untilMatch && /(连续|持续|自动接管|接管|工作)/.test(normalized)) {
    const target = new Date(now.getTime());
    const dayWord = untilMatch[1];
    const hour = Number(untilMatch[2]);
    const minute = untilMatch[3] ? Number(untilMatch[3]) : 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      target.setHours(hour, minute, 0, 0);
      if (dayWord === "明天" || (dayWord !== "今天" && target.getTime() <= now.getTime())) {
        target.setDate(target.getDate() + 1);
      }
      const durationMs = target.getTime() - now.getTime();
      if (durationMs > 0) {
        return buildDirective(now, durationMs);
      }
    }
  }

  return null;
}

export function createAutoContinuationState(input: {
  directive: AutoContinuationDirective;
  requestedByUserId?: string;
  requestedByDisplayName?: string;
  sourceMessageId?: string;
}): ConversationAutoContinuationState {
  return {
    mode: "until",
    status: "active",
    startedAt: input.directive.startedAt,
    until: input.directive.until,
    instruction: input.directive.instruction,
    requestedByUserId: input.requestedByUserId,
    requestedByDisplayName: input.requestedByDisplayName,
    sourceMessageId: input.sourceMessageId,
    iteration: 0,
  };
}

export function continueAutoContinuationAfterTaskSync(input: {
  taskId: string;
  workspaceId?: string;
  sessionId?: string;
  workDir?: string;
  now?: Date;
}): AutoContinuationDispatchResult {
  const task = readQueuedTaskSync(input.taskId);
  if (!task) {
    return { queued: false, reason: "missing_task" };
  }

  const payload = parseAutoContinuationTaskPayload(task);
  const workspaceId = input.workspaceId ?? task.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const channelName = payload.channelName ?? payload.channel;
  const agentId = payload.assignee ?? task.agentId;
  if (!channelName || !agentId) {
    return { queued: false, reason: "missing_payload" };
  }

  const state = ensureWorkspaceStateSync(workspaceId);
  const workspace = readConversationExecutionWorkspaceState(state, {
    channelName,
    agentId,
    contactId: payload.contactId,
  });
  const autoContinuation = workspace?.autoContinuation ?? payload.autoContinuation;
  if (!autoContinuation || autoContinuation.status !== "active") {
    return { queued: false, reason: "inactive" };
  }
  if (workspace?.lastTaskQueueId && workspace.lastTaskQueueId !== task.id) {
    return { queued: false, reason: "stale_task", until: autoContinuation.until };
  }

  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  if (!isFuture(autoContinuation.until, now)) {
    upsertConversationExecutionWorkspaceState(state, {
      channelName,
      agentId,
      contactId: payload.contactId,
      lastTaskQueueId: task.id,
      autoContinuation: {
        ...autoContinuation,
        status: "expired",
        lastContinuedAt: nowIso,
      },
    });
    writeWorkspaceStateSync(state, workspaceId);
    return { queued: false, reason: "expired", until: autoContinuation.until };
  }

  const agent = state.activeEmployees.find((employee) => sameValue(employee.name, agentId));
  const channel = state.channels.find((item) => sameValue(item.name, channelName));
  if (!agent || !channel) {
    return { queued: false, reason: "missing_target", until: autoContinuation.until };
  }

  const agentHasActiveTask = listQueuedTasksSync({ workspaceId })
    .some((t) => t.agentId === agentId && (t.status === "claimed" || t.status === "running"));
  if (agentHasActiveTask) {
    return { queued: false, reason: "agent_busy", until: autoContinuation.until };
  }

  const nextContinuation: ConversationAutoContinuationState = {
    ...autoContinuation,
    iteration: autoContinuation.iteration + 1,
    lastContinuedAt: nowIso,
  };
  const speaker = autoContinuation.requestedByDisplayName ?? task.requestedByDisplayName ?? "自动接管";
  const followupMessage = pushWorkspaceMessageToChannel(state, channel.name, {
    speaker,
    role: "human",
    summary: autoContinuation.instruction,
    code: "auto_continuation.reply",
    data: {
      agent_name: agent.name,
      previous_task_id: task.id,
      until: autoContinuation.until,
    },
  }, workspaceId);

  const sessionId = input.sessionId ?? task.sessionId ?? workspace?.sessionId ?? payload.channelSessionId;
  const workDir = input.workDir ?? task.workDir ?? workspace?.workDir ?? resolveConversationExecutionWorkspacePath({
    workspaceId,
    channelName: channel.name,
    agentId: agent.name,
  });
  const queued = enqueueNativeTaskSync({
    workspaceId,
    assignee: agent.name,
    title: `自动接管 · ${channel.name} · ${agent.name}`,
    channel: channel.name,
    priority: "medium",
    triggerType: payload.contactId ? "channel_chat" : "mention_chat",
    requestedByUserId: autoContinuation.requestedByUserId ?? task.requestedByUserId,
    requestedByDisplayName: autoContinuation.requestedByDisplayName ?? task.requestedByDisplayName,
    metadata: {
      contactId: payload.contactId,
      sourceChannel: channel.name,
      sourceMessageId: followupMessage.id,
      mentionType: payload.contactId ? undefined : "agent",
      mentionedAgentIds: [agent.name],
      mentionedAgentLabels: [payload.assigneeMentionToken ?? agent.remarkName?.trim() ?? agent.name],
      assigneeMentionToken: payload.assigneeMentionToken ?? agent.remarkName?.trim() ?? agent.name,
      channelName: channel.name,
      channelMessage: autoContinuation.instruction,
      channelHistory: buildChannelHistorySnapshot(state, channel.name),
      channelHistoryPath: getChannelHistoryFilePath(channel.name, workspaceId),
      channelSessionId: sessionId,
      autoContinuation: nextContinuation,
      attachments: [],
    },
  });

  if (!queued) {
    pushWorkspaceMessageToChannel(state, channel.name, {
      speaker: "系统提示",
      role: "agent",
      summary: `${agent.name} 当前没有可执行的运行时，自动接管已暂停。`,
      code: "auto_continuation.unavailable",
      data: { agent_name: agent.name },
      status: "error",
    }, workspaceId);
    upsertConversationExecutionWorkspaceState(state, {
      channelName: channel.name,
      agentId: agent.name,
      contactId: payload.contactId,
      lastTaskQueueId: task.id,
      lastError: "No executable runtime is bound.",
      autoContinuation: {
        ...nextContinuation,
        status: "expired",
      },
    });
    writeWorkspaceStateSync(state, workspaceId);
    return { queued: false, reason: "missing_runtime", until: autoContinuation.until };
  }

  upsertConversationExecutionWorkspaceState(state, {
    channelName: channel.name,
    agentId: agent.name,
    contactId: payload.contactId,
    sessionId,
    workDir,
    lastTaskQueueId: queued.id,
    lastError: null,
    autoContinuation: nextContinuation,
  });
  pushWorkspaceMessageToChannel(state, channel.name, {
    speaker: agent.name,
    role: "agent",
    summary: "Thinking",
    code: "agent.pending",
    data: { agent_name: agent.name },
    status: "pending",
  }, workspaceId);
  writeWorkspaceStateSync(state, workspaceId);

  return { queued: true, queuedTaskId: queued.id, until: autoContinuation.until };
}

export function stopAutoContinuationSync(input: {
  channelName: string;
  agentId: string;
  contactId?: string;
  workspaceId?: string;
  requestedByDisplayName?: string;
}): StopAutoContinuationResult {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const state = ensureWorkspaceStateSync(workspaceId);
  const workspace = readConversationExecutionWorkspaceState(state, {
    channelName: input.channelName,
    agentId: input.agentId,
    contactId: input.contactId,
  });
  if (!workspace?.autoContinuation) {
    return { stopped: false, reason: "missing_target" };
  }
  if (workspace.autoContinuation.status !== "active") {
    return { stopped: false, reason: "inactive" };
  }

  const nowIso = new Date().toISOString();
  let cancelledTaskId: string | undefined;
  if (workspace.lastTaskQueueId) {
    const task = readQueuedTaskSync(workspace.lastTaskQueueId);
    if (task?.status === "queued") {
      cancelQueuedTaskSync({
        taskId: task.id,
        errorText: "Auto continuation was stopped by the user.",
      });
      cancelledTaskId = task.id;
    }
  }

  const stoppedContinuation: ConversationAutoContinuationState = {
    ...workspace.autoContinuation,
    status: "stopped",
    lastContinuedAt: nowIso,
  };
  upsertConversationExecutionWorkspaceState(state, {
    channelName: input.channelName,
    agentId: input.agentId,
    contactId: input.contactId,
    lastTaskQueueId: workspace.lastTaskQueueId,
    autoContinuation: stoppedContinuation,
    updatedAt: nowIso,
  });
  pushWorkspaceMessageToChannel(state, input.channelName, {
    speaker: AUTO_CONTINUATION_COORDINATOR,
    role: "agent",
    summary: `Auto continuation stopped for ${input.agentId}.`,
    code: "auto_continuation.stopped_notice",
    data: {
      agent_name: input.agentId,
      until: stoppedContinuation.until,
      stopped_by: input.requestedByDisplayName ?? "",
      cancelled_task_id: cancelledTaskId ?? "",
    },
  }, workspaceId);
  state.ledger.unshift({
    title: "Auto continuation stopped",
    note: `${input.requestedByDisplayName ?? "A user"} stopped auto continuation for ${input.agentId} in ${input.channelName}.`,
    code: "auto_continuation.stopped",
    data: {
      channel_name: input.channelName,
      agent_name: input.agentId,
      cancelled_task_id: cancelledTaskId ?? "",
    },
  });
  writeWorkspaceStateSync(state, workspaceId);

  return { stopped: true, cancelledTaskId };
}

function buildDirective(now: Date, durationMs: number): AutoContinuationDirective {
  return {
    mode: "until",
    startedAt: now.toISOString(),
    until: new Date(now.getTime() + durationMs).toISOString(),
    instruction: AUTO_CONTINUATION_REPLY,
    durationMs,
  };
}

function isFuture(iso: string, now: Date): boolean {
  const untilMs = Date.parse(iso);
  return Number.isFinite(untilMs) && untilMs > now.getTime();
}

function parseAutoContinuationTaskPayload(task: QueuedTaskRecord): {
  assignee?: string;
  channel?: string;
  contactId?: string;
  channelName?: string;
  channelSessionId?: string;
  assigneeMentionToken?: string;
  autoContinuation?: ConversationAutoContinuationState;
} {
  try {
    const parsed = JSON.parse(task.inputJson) as Record<string, unknown>;
    return {
      assignee: typeof parsed.assignee === "string" ? parsed.assignee : undefined,
      channel: typeof parsed.channel === "string" ? parsed.channel : undefined,
      contactId: typeof parsed.contactId === "string" ? parsed.contactId : undefined,
      channelName: typeof parsed.channelName === "string" ? parsed.channelName : undefined,
      channelSessionId: typeof parsed.channelSessionId === "string" ? parsed.channelSessionId : undefined,
      assigneeMentionToken: typeof parsed.assigneeMentionToken === "string" ? parsed.assigneeMentionToken : undefined,
      autoContinuation: parseAutoContinuationState(parsed.autoContinuation),
    };
  } catch {
    return {};
  }
}

function parseAutoContinuationState(input: unknown): ConversationAutoContinuationState | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const value = input as Record<string, unknown>;
  if (
    value.mode !== "until" ||
    (value.status !== "active" && value.status !== "expired" && value.status !== "stopped") ||
    typeof value.startedAt !== "string" ||
    typeof value.until !== "string" ||
    typeof value.instruction !== "string"
  ) {
    return undefined;
  }
  return {
    mode: "until",
    status: value.status,
    startedAt: value.startedAt,
    until: value.until,
    instruction: value.instruction,
    requestedByUserId: typeof value.requestedByUserId === "string" ? value.requestedByUserId : undefined,
    requestedByDisplayName: typeof value.requestedByDisplayName === "string" ? value.requestedByDisplayName : undefined,
    sourceMessageId: typeof value.sourceMessageId === "string" ? value.sourceMessageId : undefined,
    iteration: typeof value.iteration === "number" && Number.isFinite(value.iteration) ? value.iteration : 0,
    lastContinuedAt: typeof value.lastContinuedAt === "string" ? value.lastContinuedAt : undefined,
  };
}
