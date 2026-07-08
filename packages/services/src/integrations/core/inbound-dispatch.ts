import {
  listQueuedTasksSync,
  readExternalMessageMappingByExternalMessageSync,
  recordExternalIntegrationEventSync,
  updateExternalIntegrationEventStatusSync,
  type ExternalIntegrationEventRecord,
  type ExternalMessageMappingRecord,
  type QueuedTaskRecord,
} from "@agent-space/db";
import type { IntegrationRuntimeContext } from "./types.ts";

export interface ExternalInboundEventRecordInput {
  context: IntegrationRuntimeContext;
  externalEventId: string;
  eventType: string;
  payloadJson?: Parameters<typeof recordExternalIntegrationEventSync>[0]["payloadJson"];
  receivedAt?: string;
  recordEvent?: typeof recordExternalIntegrationEventSync;
}

export interface ExternalInboundDuplicateMessageInput {
  context: IntegrationRuntimeContext;
  externalEventId: string;
  externalMessageId: string;
  readMessageMappingByExternalMessage?: typeof readExternalMessageMappingByExternalMessageSync;
  updateEventStatus?: typeof updateExternalIntegrationEventStatusSync;
}

export interface ExternalInboundDuplicateMessageResult {
  event: ExternalIntegrationEventRecord;
  mapping: ExternalMessageMappingRecord;
  reasonCode: "duplicate_external_message";
}

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

export function recordExternalInboundEventSync(
  input: ExternalInboundEventRecordInput,
): ExternalIntegrationEventRecord {
  const recordEvent = input.recordEvent ?? recordExternalIntegrationEventSync;
  return recordEvent({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    provider: input.context.provider,
    externalEventId: input.externalEventId,
    eventType: input.eventType,
    payloadJson: input.payloadJson,
    receivedAt: input.receivedAt,
  });
}

export function resolveExternalInboundDuplicateMessageSync(
  input: ExternalInboundDuplicateMessageInput,
): ExternalInboundDuplicateMessageResult | null {
  const readMessageMapping = input.readMessageMappingByExternalMessage
    ?? readExternalMessageMappingByExternalMessageSync;
  const mapping = readMessageMapping({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    externalMessageId: input.externalMessageId,
  });
  if (!mapping) {
    return null;
  }

  const updateEventStatus = input.updateEventStatus ?? updateExternalIntegrationEventStatusSync;
  const event = updateEventStatus({
    workspaceId: input.context.workspaceId,
    provider: input.context.provider,
    externalEventId: input.externalEventId,
    status: "ignored",
    errorMessage: "duplicate_external_message",
  });
  return {
    event,
    mapping,
    reasonCode: "duplicate_external_message",
  };
}

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
