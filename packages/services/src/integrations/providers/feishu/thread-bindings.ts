import {
  listExternalThreadBindingsSync,
  readExternalThreadBindingSync,
  upsertExternalThreadBindingSync,
  type ExternalChannelBindingRecord,
  type ExternalIntegrationRecord,
  type ExternalThreadBindingRecord,
} from "@agent-space/db";
import { buildExternalIdHash, type ExternalMessageEnvelope } from "../../core/index.ts";
import { FEISHU_PROVIDER_ID } from "./constants.ts";

export interface RecordFeishuThreadBindingInput {
  workspaceId: string;
  integration: ExternalIntegrationRecord;
  channelBinding: ExternalChannelBindingRecord;
  message: ExternalMessageEnvelope;
  agentId: string;
  botBindingId?: string;
  actorType?: "user" | "external_guest";
  taskQueueId?: string;
  routerSessionId?: string;
  agentSpaceMessageId?: string;
  collaboratingAgentIds?: string[];
  collaboratingBotBindingIds?: string[];
}

export interface ReadFeishuThreadBindingInput {
  workspaceId: string;
  tenantKey?: string;
  externalChatId: string;
  externalThreadId: string;
  agentId: string;
}

export function recordFeishuThreadBindingSync(
  input: RecordFeishuThreadBindingInput,
): ExternalThreadBindingRecord | null {
  const externalThreadId = resolveFeishuThreadBindingKey(input.message);
  if (!externalThreadId) {
    return null;
  }
  const metadata = buildFeishuThreadBindingMetadata({
    externalChatId: input.message.externalChatId,
    externalThreadId,
    agentId: input.agentId,
    botBindingId: input.botBindingId ?? input.integration.id,
    actorType: input.actorType,
    routerSessionId: input.routerSessionId,
    collaboratingAgentIds: input.collaboratingAgentIds,
    collaboratingBotBindingIds: input.collaboratingBotBindingIds,
  });
  return upsertExternalThreadBindingSync({
    workspaceId: input.workspaceId,
    integrationId: input.integration.id,
    channelBindingId: input.channelBinding.id,
    provider: FEISHU_PROVIDER_ID,
    tenantKey: input.integration.tenantKey,
    externalChatId: input.message.externalChatId,
    externalThreadId,
    channelName: input.channelBinding.channelName,
    agentId: input.agentId,
    taskQueueId: input.taskQueueId,
    agentSpaceMessageId: input.agentSpaceMessageId,
    metadataJson: metadata,
    lastMessageAt: input.message.receivedAt,
  });
}

export function readFeishuThreadBindingSync(
  input: ReadFeishuThreadBindingInput,
): ExternalThreadBindingRecord | null {
  return readExternalThreadBindingSync({
    workspaceId: input.workspaceId,
    provider: FEISHU_PROVIDER_ID,
    tenantKey: input.tenantKey,
    externalChatId: input.externalChatId,
    externalThreadId: input.externalThreadId,
    agentId: input.agentId,
    status: "active",
  });
}

export function listFeishuThreadBindingsForChatSync(input: {
  workspaceId: string;
  tenantKey?: string;
  externalChatId: string;
  externalThreadId?: string;
}): ExternalThreadBindingRecord[] {
  return listExternalThreadBindingsSync({
    workspaceId: input.workspaceId,
    provider: FEISHU_PROVIDER_ID,
    tenantKey: input.tenantKey,
    externalChatId: input.externalChatId,
    externalThreadId: input.externalThreadId,
    status: "active",
  });
}

export function resolveFeishuThreadBindingKey(message: ExternalMessageEnvelope): string | undefined {
  return message.externalThreadId?.trim() || message.externalMessageId.trim() || undefined;
}

function buildFeishuThreadBindingMetadata(input: {
  externalChatId: string;
  externalThreadId: string;
  agentId: string;
  botBindingId: string;
  actorType?: "user" | "external_guest";
  routerSessionId?: string;
  collaboratingAgentIds?: string[];
  collaboratingBotBindingIds?: string[];
}): Record<string, unknown> {
  const collaboratingAgentIds = uniqueNonEmpty(input.collaboratingAgentIds ?? [])
    .filter((agentId) => agentId !== input.agentId);
  const collaboratingBotBindingIds = uniqueNonEmpty(input.collaboratingBotBindingIds ?? [])
    .filter((botBindingId) => botBindingId !== input.botBindingId);
  return {
    provider: FEISHU_PROVIDER_ID,
    externalChatReference: shortHash(input.externalChatId),
    externalThreadReference: shortHash(input.externalThreadId),
    agentId: input.agentId,
    botBindingId: input.botBindingId,
    actorType: input.actorType,
    routerSessionId: input.routerSessionId,
    threadCollaboration: collaboratingAgentIds.length > 0 && collaboratingBotBindingIds.length > 0 ? true : undefined,
    collaboratingAgentIds: collaboratingAgentIds.length > 0 ? collaboratingAgentIds : undefined,
    collaboratingBotBindingIds: collaboratingBotBindingIds.length > 0 ? collaboratingBotBindingIds : undefined,
    updatedAt: new Date().toISOString(),
  };
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  const unique: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (normalized && !unique.includes(normalized)) {
      unique.push(normalized);
    }
  }
  return unique;
}

function shortHash(value: string): string {
  return buildExternalIdHash(value, 16);
}
