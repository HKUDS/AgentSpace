import {
  readExternalThreadBindingSync,
  upsertExternalThreadBindingSync,
  type ExternalChannelBindingRecord,
  type ExternalIntegrationRecord,
  type ExternalThreadBindingRecord,
} from "@agent-space/db";
import type { ExternalMessageEnvelope } from "../../core/index.ts";
import { buildSlackReference } from "./events.ts";
import { SLACK_PROVIDER_ID } from "./constants.ts";

export interface RecordSlackThreadBindingInput {
  workspaceId: string;
  integration: ExternalIntegrationRecord;
  channelBinding: ExternalChannelBindingRecord;
  message: ExternalMessageEnvelope;
  agentId: string;
  taskQueueId?: string;
  routerSessionId?: string;
  agentSpaceMessageId?: string;
}

export interface ReadSlackThreadBindingInput {
  workspaceId: string;
  tenantKey?: string;
  externalChatId: string;
  externalThreadId: string;
  agentId: string;
}

export function recordSlackThreadBindingSync(
  input: RecordSlackThreadBindingInput,
): ExternalThreadBindingRecord | null {
  const externalThreadId = resolveSlackThreadBindingKey(input.message);
  if (!externalThreadId) {
    return null;
  }
  return upsertExternalThreadBindingSync({
    workspaceId: input.workspaceId,
    integrationId: input.integration.id,
    channelBindingId: input.channelBinding.id,
    provider: SLACK_PROVIDER_ID,
    tenantKey: input.integration.tenantKey,
    externalChatId: input.message.externalChatId,
    externalThreadId,
    channelName: input.channelBinding.channelName,
    agentId: input.agentId,
    taskQueueId: input.taskQueueId,
    agentSpaceMessageId: input.agentSpaceMessageId,
    metadataJson: {
      provider: SLACK_PROVIDER_ID,
      externalChatReference: buildSlackReference(input.message.externalChatId),
      externalThreadReference: buildSlackReference(externalThreadId),
      agentId: input.agentId,
      botBindingId: input.integration.id,
      routerSessionId: input.routerSessionId,
      updatedAt: new Date().toISOString(),
    },
    lastMessageAt: input.message.receivedAt,
  });
}

export function readSlackThreadBindingSync(
  input: ReadSlackThreadBindingInput,
): ExternalThreadBindingRecord | null {
  return readExternalThreadBindingSync({
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
    tenantKey: input.tenantKey,
    externalChatId: input.externalChatId,
    externalThreadId: input.externalThreadId,
    agentId: input.agentId,
    status: "active",
  });
}

export function resolveSlackThreadBindingKey(message: ExternalMessageEnvelope): string | undefined {
  return message.externalThreadId?.trim() || message.externalMessageId.trim() || undefined;
}
