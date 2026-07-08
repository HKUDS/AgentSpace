import {
  listQueuedTasksSync,
  type QueuedTaskRecord,
} from "@agent-space/db";

export interface ExternalDispatchedTaskLookupInput {
  workspaceId: string;
  channelName: string;
  agentId: string;
  sourceMessageId: string;
  listQueuedTasks?: typeof listQueuedTasksSync;
}

export interface ExternalDispatchedTaskMatchInput {
  channelName: string;
  agentId: string;
  sourceMessageId: string;
}

export type ExternalDispatchedTaskRecord = Pick<QueuedTaskRecord, "agentId" | "inputJson" | "createdAt">;

export function resolveExternalDispatchedTaskSync(
  input: ExternalDispatchedTaskLookupInput,
): QueuedTaskRecord | null {
  const listQueuedTasks = input.listQueuedTasks ?? listQueuedTasksSync;
  return resolveExternalDispatchedTaskFromRecords(listQueuedTasks({ workspaceId: input.workspaceId }), input);
}

export function resolveExternalDispatchedTaskFromRecords<T extends ExternalDispatchedTaskRecord>(
  tasks: T[],
  input: ExternalDispatchedTaskMatchInput,
): T | null {
  return tasks
    .filter((task) => task.agentId === input.agentId)
    .filter((task) => {
      const payload = parseJsonRecord(task.inputJson);
      return payload?.sourceMessageId === input.sourceMessageId &&
        payload.channelName === input.channelName;
    })
    .sort((left, right) => dateTime(right.createdAt) - dateTime(left.createdAt))[0] ?? null;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function dateTime(value: string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}
