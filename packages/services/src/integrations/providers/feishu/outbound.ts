import {
  completeExternalMessageOutboxSync,
  createExternalMessageMappingSync,
  failExternalMessageOutboxSync,
  listExternalChannelBindingsSync,
  listExternalIntegrationsSync,
  listPendingExternalMessageOutboxSync,
  markExternalMessageOutboxLockedSync,
  readExternalIntegrationSync,
  readExternalMessageMappingByAgentSpaceMessageSync,
  readExternalChannelBindingSync,
  type ExternalIntegrationRecord,
  type ExternalMessageMappingRecord,
  type ExternalMessageOutboxRecord,
} from "@agent-space/db";
import type { MessageAttachment } from "@agent-space/domain/workspace";
import { readFileSync } from "node:fs";
import {
  IntegrationProviderError,
  createIntegrationProviderError,
  enqueueExternalOutboundMessageSync,
  type AgentSpaceOutboundMessage,
  type ExternalOutboundMessagePayload,
  type IntegrationRuntimeContext,
} from "../../core/index.ts";
import {
  decideAgentActionPolicySync,
  type AgentActionPolicyDecision,
  type AgentActionPolicyInput,
} from "../../../policies/agent-actions.ts";
import {
  createFeishuApiClient,
  fetchFeishuTenantAccessToken,
  type FeishuApiClient,
  type FeishuApiRequest,
  type FeishuMultipartUploadRequest,
} from "./client.ts";
import { FEISHU_PROVIDER_ID } from "./constants.ts";
import { readFeishuIntegrationCredentials } from "./credentials.ts";
import { buildAgentSpaceChannelDeepLink } from "./links.ts";
import { createAttachmentStorageClient } from "../../../attachments/storage.ts";

export const FEISHU_TEXT_MESSAGE_MAX_BYTES = 120 * 1024;
export const FEISHU_OUTBOX_MAX_ATTEMPTS = 10;
export const FEISHU_OUTBOUND_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const FEISHU_OUTBOUND_ATTACHMENT_PAYLOAD_KIND = "agent_space_feishu_attachment_v1";
const FEISHU_CARD_TEXT_MAX_CHARS = 900;

export interface FeishuOutboxProcessResult {
  outboxId: string;
  status: "sent" | "failed";
  externalMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
  terminal?: boolean;
  nextAttemptAt?: string;
}

export interface FeishuOutboundErrorInfo {
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
  terminal: boolean;
}

export interface FeishuOutboxDrainResult {
  workspaceId: string;
  provider: typeof FEISHU_PROVIDER_ID;
  integrationCount: number;
  processedCount: number;
  sentCount: number;
  failedCount: number;
  results: Array<{
    integrationId: string;
    outboxId: string;
    status: FeishuOutboxProcessResult["status"];
    externalMessageId?: string;
    errorCode?: string;
    errorMessage?: string;
    retryable?: boolean;
    terminal?: boolean;
    nextAttemptAt?: string;
  }>;
  errors: Array<{
    integrationId: string;
    errorMessage: string;
  }>;
}

export interface FeishuOutboundMessagePolicyResult {
  policyInput: AgentActionPolicyInput;
  decision: AgentActionPolicyDecision;
}

export interface FeishuOutboundAttachmentRef {
  id: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  kind: MessageAttachment["kind"];
  storedPath: string;
  storageProvider?: MessageAttachment["storageProvider"];
  storageBucket?: string;
  storageRegion?: string;
  storageEndpoint?: string;
  storageKey?: string;
  sha256?: string;
}

export interface FeishuOutboundAttachmentPayload extends Record<string, unknown> {
  agent_space_payload_kind: typeof FEISHU_OUTBOUND_ATTACHMENT_PAYLOAD_KIND;
  receive_id_type: "chat_id";
  receive_id: string;
  reply_to_message_id?: string;
  attachment: FeishuOutboundAttachmentRef;
}

export type FeishuAgentStatusCardStatus =
  | "thinking"
  | "complete"
  | "failed"
  | "approval_required";

export interface FeishuApprovalCardActionPayload {
  approvalId: string;
  payloadHash: string;
  token: string;
}

export function buildFeishuTextOutboundMessage(input: {
  targetExternalChatId: string;
  text: string;
  targetExternalThreadId?: string;
}): ExternalOutboundMessagePayload {
  return {
    targetExternalChatId: input.targetExternalChatId,
    targetExternalThreadId: input.targetExternalThreadId,
    payload: {
      receive_id_type: "chat_id",
      receive_id: input.targetExternalChatId,
      ...(input.targetExternalThreadId ? { reply_to_message_id: input.targetExternalThreadId } : {}),
      msg_type: "text",
      content: JSON.stringify({ text: input.text }),
    },
  };
}

export function buildFeishuInteractiveCardOutboundMessage(input: {
  targetExternalChatId: string;
  card: Record<string, unknown>;
  targetExternalThreadId?: string;
}): ExternalOutboundMessagePayload {
  return {
    targetExternalChatId: input.targetExternalChatId,
    targetExternalThreadId: input.targetExternalThreadId,
    payload: {
      receive_id_type: "chat_id",
      receive_id: input.targetExternalChatId,
      ...(input.targetExternalThreadId ? { reply_to_message_id: input.targetExternalThreadId } : {}),
      msg_type: "interactive",
      content: JSON.stringify(input.card),
    },
  };
}

export function buildFeishuAgentStatusCard(input: {
  status: FeishuAgentStatusCardStatus;
  channelName: string;
  agentNames: string[];
  message?: string;
  actionUrl?: string;
  taskId?: string;
  approvalAction?: FeishuApprovalCardActionPayload;
}): Record<string, unknown> {
  const statusView = resolveFeishuAgentStatusCardView(input.status);
  const agentLabel = uniqueNonEmpty(input.agentNames).join(", ") || "Agent";
  const lines = [
    `**${escapeFeishuCardMarkdown(agentLabel)}** · ${statusView.label}`,
    `Channel: ${escapeFeishuCardMarkdown(input.channelName)}`,
    input.taskId ? `Task: ${escapeFeishuCardMarkdown(input.taskId)}` : undefined,
    input.message ? "" : undefined,
    input.message ? truncateFeishuCardText(input.message) : undefined,
  ].filter((line): line is string => line !== undefined);
  const elements: Record<string, unknown>[] = [{
    tag: "markdown",
    content: lines.join("\n"),
  }];
  const actions: Record<string, unknown>[] = [];
  if (input.status === "approval_required" && input.approvalAction) {
    actions.push({
      tag: "button",
      text: {
        tag: "plain_text",
        content: "Approve",
      },
      type: "primary",
      value: buildFeishuApprovalCardActionValue(input.approvalAction, "approved"),
    });
    actions.push({
      tag: "button",
      text: {
        tag: "plain_text",
        content: "Reject",
      },
      type: "danger",
      value: buildFeishuApprovalCardActionValue(input.approvalAction, "rejected"),
    });
  }
  if (input.actionUrl) {
    actions.push({
      tag: "button",
      text: {
        tag: "plain_text",
        content: "Open AgentSpace",
      },
      type: "primary",
      url: input.actionUrl,
    });
  }
  if (actions.length > 0) {
    elements.push({
      tag: "action",
      actions,
    });
  }
  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: statusView.template,
      title: {
        tag: "plain_text",
        content: `${agentLabel} · AgentSpace`,
      },
    },
    elements,
  };
}

export function buildFeishuIdentityBindingRequiredCard(input: {
  agentId: string;
  settingsUrl?: string;
}): Record<string, unknown> {
  const agentLabel = input.agentId.trim() || "Agent";
  const elements: Record<string, unknown>[] = [{
    tag: "markdown",
    content: [
      "**AgentSpace identity required**",
      `Agent: ${escapeFeishuCardMarkdown(agentLabel)}`,
      "请先绑定 AgentSpace 身份后继续。未绑定飞书用户只能在允许的低权限 guest 策略下试用，不能执行需要真实身份的操作。",
    ].join("\n"),
  }];
  if (input.settingsUrl) {
    elements.push({
      tag: "action",
      actions: [{
        tag: "button",
        text: {
          tag: "plain_text",
          content: "Open AgentSpace",
        },
        type: "primary",
        url: input.settingsUrl,
      }],
    });
  }
  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: "yellow",
      title: {
        tag: "plain_text",
        content: `${agentLabel} · AgentSpace`,
      },
    },
    elements,
  };
}

export function buildFeishuAgentThreadCollaborationCard(input: {
  currentAgentId: string;
  previousAgentIds: string[];
  actionUrl?: string;
}): Record<string, unknown> {
  const currentAgent = input.currentAgentId.trim() || "Agent";
  const previousAgents = uniqueNonEmpty(input.previousAgentIds).filter((agentId) => agentId !== currentAgent);
  const previousLabel = previousAgents.length > 0 ? previousAgents.join(", ") : "another agent";
  const elements: Record<string, unknown>[] = [{
    tag: "markdown",
    content: [
      "**AgentSpace agent joined this thread**",
      `Current: ${escapeFeishuCardMarkdown(currentAgent)}`,
      `Existing context: ${escapeFeishuCardMarkdown(previousLabel)}`,
      "AgentSpace keeps each agent task binding separate, so this thread can continue as a governed multi-agent collaboration.",
    ].join("\n"),
  }];
  if (input.actionUrl) {
    elements.push({
      tag: "action",
      actions: [{
        tag: "button",
        text: {
          tag: "plain_text",
          content: "Open AgentSpace",
        },
        type: "primary",
        url: input.actionUrl,
      }],
    });
  }
  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: "blue",
      title: {
        tag: "plain_text",
        content: `${currentAgent} · AgentSpace`,
      },
    },
    elements,
  };
}

export function buildFeishuAgentStatusCardOutboundMessage(input: {
  targetExternalChatId: string;
  targetExternalThreadId?: string;
  status: FeishuAgentStatusCardStatus;
  workspaceId: string;
  channelName: string;
  agentNames: string[];
  message?: string;
  taskId?: string;
  approvalAction?: FeishuApprovalCardActionPayload;
  actionUrl?: string | null;
}): ExternalOutboundMessagePayload {
  return buildFeishuInteractiveCardOutboundMessage({
    targetExternalChatId: input.targetExternalChatId,
    targetExternalThreadId: input.targetExternalThreadId,
    card: buildFeishuAgentStatusCard({
      status: input.status,
      channelName: input.channelName,
      agentNames: input.agentNames,
      message: input.message,
      taskId: input.taskId,
      approvalAction: input.approvalAction,
      actionUrl: input.actionUrl === null
        ? undefined
        : input.actionUrl ?? buildAgentSpaceChannelDeepLink({
          workspaceId: input.workspaceId,
          channelName: input.channelName,
        }),
    }),
  });
}

export function buildFeishuTextOutboundMessages(input: {
  targetExternalChatId: string;
  text: string;
  targetExternalThreadId?: string;
  maxTextBytes?: number;
  agentId?: string;
}): ExternalOutboundMessagePayload[] {
  const agentPrefix = buildFeishuTextAgentPrefix(input.agentId);
  const maxTextBytes = input.maxTextBytes ?? FEISHU_TEXT_MESSAGE_MAX_BYTES;
  const textMaxBytes = agentPrefix
    ? Math.max(1, maxTextBytes - Buffer.byteLength(agentPrefix, "utf8"))
    : maxTextBytes;
  return splitFeishuTextMessageChunks(input.text, textMaxBytes).map((text) =>
    buildFeishuTextOutboundMessage({
      targetExternalChatId: input.targetExternalChatId,
      targetExternalThreadId: input.targetExternalThreadId,
      text: agentPrefix ? `${agentPrefix}${text}` : text,
  }));
}

function buildFeishuApprovalCardActionValue(
  input: FeishuApprovalCardActionPayload,
  decision: "approved" | "rejected",
): Record<string, string> {
  return {
    approvalId: input.approvalId,
    decision,
    payloadHash: input.payloadHash,
    token: input.token,
  };
}

export function buildFeishuAttachmentOutboundMessage(input: {
  targetExternalChatId: string;
  attachment: MessageAttachment;
  targetExternalThreadId?: string;
}): ExternalOutboundMessagePayload {
  return {
    targetExternalChatId: input.targetExternalChatId,
    targetExternalThreadId: input.targetExternalThreadId,
    payload: {
      agent_space_payload_kind: FEISHU_OUTBOUND_ATTACHMENT_PAYLOAD_KIND,
      receive_id_type: "chat_id",
      receive_id: input.targetExternalChatId,
      ...(input.targetExternalThreadId ? { reply_to_message_id: input.targetExternalThreadId } : {}),
      attachment: serializeFeishuOutboundAttachment(input.attachment),
    } satisfies FeishuOutboundAttachmentPayload,
  };
}

export function splitFeishuTextMessageChunks(
  text: string,
  maxTextBytes = FEISHU_TEXT_MESSAGE_MAX_BYTES,
): string[] {
  const maxBytes = Math.max(1, Math.floor(maxTextBytes));
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return [text];
  }

  let labelBytes = 0;
  let chunks = splitTextByUtf8Bytes(text, maxBytes);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const nextLabelBytes = Buffer.byteLength(`[${chunks.length}/${chunks.length}]\n`, "utf8");
    if (nextLabelBytes === labelBytes) {
      break;
    }
    labelBytes = nextLabelBytes;
    chunks = splitTextByUtf8Bytes(text, Math.max(1, maxBytes - labelBytes));
  }

  return chunks.map((chunk, index) => `[${index + 1}/${chunks.length}]\n${chunk}`);
}

function buildFeishuTextAgentPrefix(agentId: string | undefined): string {
  const agentLabel = agentId?.trim();
  return agentLabel ? `${agentLabel} · AgentSpace\n` : "";
}

export function queueFeishuOutboundMessageSync(input: {
  context: IntegrationRuntimeContext;
  message: AgentSpaceOutboundMessage;
}): ExternalMessageOutboxRecord {
  const channelBinding = readExternalChannelBindingSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    channelName: input.message.channelName,
  });
  if (!channelBinding || channelBinding.status !== "active") {
    throw new Error("Active Feishu channel binding is required before sending outbound messages.");
  }
  if (channelBinding.syncMode === "ingest_only") {
    throw new Error("Feishu channel binding is ingest-only and cannot send outbound messages.");
  }

  const integration = readExternalIntegrationSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
  });
  const outboxItems = buildFeishuOutboundMessages({
    targetExternalChatId: channelBinding.externalChatId,
    targetExternalThreadId: input.message.externalThreadId,
    text: input.message.text,
    attachments: input.message.attachments,
    agentId: integration?.agentId,
  }).map((outbound) => enqueueExternalOutboundMessageSync({
    context: input.context,
    channelBindingId: channelBinding.id,
    agentSpaceMessageId: input.message.agentSpaceMessageId,
    outbound,
    metadataJson: buildFeishuQueuedOutboxMetadata({
      source: "direct_outbound_message",
      outbound,
      integration,
    }),
  }));
  return outboxItems[0]!;
}

export function queueFeishuChannelReplyOutboxSync(input: {
  workspaceId: string;
  channelName: string;
  agentId?: string;
  text: string;
  attachments?: MessageAttachment[];
  agentSpaceMessageId?: string;
  sourceAgentSpaceMessageId?: string;
}): ExternalMessageOutboxRecord[] {
  const candidates = listFeishuOutboundIntegrationCandidatesSync({
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    sourceAgentSpaceMessageId: input.sourceAgentSpaceMessageId,
  });
  const outboxItems: ExternalMessageOutboxRecord[] = [];

  for (const { integration, sourceMapping } of candidates) {
    const channelBinding = selectFeishuOutboundChannelBindingForReply({
      channelBindings: listExternalChannelBindingsSync({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        status: "active",
      }),
      channelName: input.channelName,
      sourceMapping,
    });
    if (!channelBinding) {
      continue;
    }

    for (const outbound of buildFeishuOutboundMessages({
      targetExternalChatId: channelBinding.externalChatId,
      targetExternalThreadId: resolveFeishuReplyTargetExternalMessageId(sourceMapping),
      text: input.text,
      attachments: input.attachments,
      agentId: integration.agentId,
    })) {
      outboxItems.push(enqueueExternalOutboundMessageSync({
        context: {
          workspaceId: input.workspaceId,
          integrationId: integration.id,
          provider: FEISHU_PROVIDER_ID,
        },
        channelBindingId: channelBinding.id,
        agentSpaceMessageId: input.agentSpaceMessageId,
        outbound,
        metadataJson: buildFeishuQueuedOutboxMetadata({
          source: "agent_reply",
          outbound,
          integration,
        }),
      }));
    }
  }

  return outboxItems;
}

export function queueFeishuAgentStatusCardOutboxSync(input: {
  workspaceId: string;
  channelName: string;
  agentId?: string;
  status: FeishuAgentStatusCardStatus;
  agentNames: string[];
  message?: string;
  taskId?: string;
  agentSpaceMessageId?: string;
  sourceAgentSpaceMessageId?: string;
  approvalAction?: FeishuApprovalCardActionPayload;
  actionUrl?: string | null;
}): ExternalMessageOutboxRecord[] {
  const candidates = listFeishuOutboundIntegrationCandidatesSync({
    workspaceId: input.workspaceId,
    agentId: input.agentId ?? resolveSingleAgentName(input.agentNames),
    sourceAgentSpaceMessageId: input.sourceAgentSpaceMessageId,
  });
  const outboxItems: ExternalMessageOutboxRecord[] = [];

  for (const { integration, sourceMapping } of candidates) {
    const channelBinding = selectFeishuOutboundChannelBindingForReply({
      channelBindings: listExternalChannelBindingsSync({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        status: "active",
      }),
      channelName: input.channelName,
      sourceMapping,
    });
    if (!channelBinding) {
      continue;
    }

    const outbound = buildFeishuAgentStatusCardOutboundMessage({
      targetExternalChatId: channelBinding.externalChatId,
      targetExternalThreadId: resolveFeishuReplyTargetExternalMessageId(sourceMapping),
      status: input.status,
      workspaceId: input.workspaceId,
      channelName: input.channelName,
      agentNames: input.agentNames,
      message: input.message,
      taskId: input.taskId,
      approvalAction: input.approvalAction,
      actionUrl: input.actionUrl,
    });
    outboxItems.push(enqueueExternalOutboundMessageSync({
      context: {
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        provider: FEISHU_PROVIDER_ID,
      },
      channelBindingId: channelBinding.id,
      agentSpaceMessageId: input.agentSpaceMessageId,
      outbound,
      metadataJson: buildFeishuQueuedOutboxMetadata({
        source: "agent_status_card",
        outbound,
        integration,
      }),
    }));
  }

  return outboxItems;
}

function buildFeishuQueuedOutboxMetadata(input: {
  source: "direct_outbound_message" | "agent_reply" | "agent_status_card";
  outbound: Pick<ExternalOutboundMessagePayload, "targetExternalChatId" | "targetExternalThreadId">;
  integration?: Pick<ExternalIntegrationRecord, "id" | "agentId"> | null;
}): Record<string, unknown> {
  const agentId = asString(input.integration?.agentId);
  return {
    provider: FEISHU_PROVIDER_ID,
    outboxSource: input.source,
    externalChatReference: formatFeishuOutboundReference(input.outbound.targetExternalChatId),
    externalThreadReference: formatFeishuOutboundReference(input.outbound.targetExternalThreadId),
    agentId,
    botBindingId: agentId ? input.integration?.id : undefined,
  };
}

interface FeishuOutboundIntegrationCandidate {
  integration: ExternalIntegrationRecord;
  sourceMapping?: ExternalMessageMappingRecord | null;
}

function listFeishuOutboundIntegrationCandidatesSync(input: {
  workspaceId: string;
  agentId?: string;
  sourceAgentSpaceMessageId?: string;
}): FeishuOutboundIntegrationCandidate[] {
  const sourceAgentSpaceMessageId = input.sourceAgentSpaceMessageId?.trim();
  if (sourceAgentSpaceMessageId) {
    const sourceMapped = resolveFeishuSourceMappedOutboundIntegrationSync({
      workspaceId: input.workspaceId,
      sourceAgentSpaceMessageId,
    });
    if (sourceMapped) {
      return sourceMapped.integration.status === "active" ? [sourceMapped] : [];
    }
  }

  return listActiveFeishuOutboundIntegrationsSync({
    workspaceId: input.workspaceId,
    agentId: input.agentId,
  }).map((integration) => ({
    integration,
    sourceMapping: sourceAgentSpaceMessageId
      ? readExternalMessageMappingByAgentSpaceMessageSync({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        agentSpaceMessageId: sourceAgentSpaceMessageId,
        direction: "inbound",
      })
      : null,
  }));
}

function resolveFeishuSourceMappedOutboundIntegrationSync(input: {
  workspaceId: string;
  sourceAgentSpaceMessageId: string;
}): FeishuOutboundIntegrationCandidate | null {
  for (const integration of listExternalIntegrationsSync({
    workspaceId: input.workspaceId,
    provider: FEISHU_PROVIDER_ID,
    includeDisabled: true,
  })) {
    const sourceMapping = readExternalMessageMappingByAgentSpaceMessageSync({
      workspaceId: input.workspaceId,
      integrationId: integration.id,
      agentSpaceMessageId: input.sourceAgentSpaceMessageId,
      direction: "inbound",
    });
    if (sourceMapping) {
      return { integration, sourceMapping };
    }
  }
  return null;
}

function listActiveFeishuOutboundIntegrationsSync(input: {
  workspaceId: string;
  agentId?: string;
}): ExternalIntegrationRecord[] {
  const agentId = input.agentId?.trim();
  if (agentId) {
    const agentIntegrations = listExternalIntegrationsSync({
      workspaceId: input.workspaceId,
      provider: FEISHU_PROVIDER_ID,
      agentId,
    }).filter((integration) => integration.status === "active");
    if (agentIntegrations.length > 0) {
      return agentIntegrations;
    }
  }

  return listExternalIntegrationsSync({
    workspaceId: input.workspaceId,
    provider: FEISHU_PROVIDER_ID,
    scope: "workspace",
  }).filter((integration) => integration.status === "active");
}

function resolveSingleAgentName(agentNames: string[]): string | undefined {
  const normalized = agentNames.map((name) => name.trim()).filter(Boolean);
  return normalized.length === 1 ? normalized[0] : undefined;
}

function buildFeishuOutboundMessages(input: {
  targetExternalChatId: string;
  text: string;
  attachments?: MessageAttachment[];
  targetExternalThreadId?: string;
  maxTextBytes?: number;
  agentId?: string;
}): ExternalOutboundMessagePayload[] {
  const textMessages = buildFeishuTextOutboundMessages({
    targetExternalChatId: input.targetExternalChatId,
    targetExternalThreadId: input.targetExternalThreadId,
    text: input.text,
    maxTextBytes: input.maxTextBytes,
    agentId: input.agentId,
  });
  const attachmentMessages = (input.attachments ?? [])
    .filter((attachment) => !attachment.deletedAt)
    .map((attachment) => buildFeishuAttachmentOutboundMessage({
      targetExternalChatId: input.targetExternalChatId,
      targetExternalThreadId: input.targetExternalThreadId,
      attachment,
    }));
  return [...textMessages, ...attachmentMessages];
}

export function resolveFeishuReplyTargetExternalMessageId(
  sourceMapping: { externalThreadId?: string; externalMessageId?: string } | null | undefined,
): string | undefined {
  return sourceMapping?.externalThreadId?.trim()
    || sourceMapping?.externalMessageId?.trim()
    || undefined;
}

export function selectFeishuOutboundChannelBindingForReply<T extends {
  id: string;
  channelName: string;
  syncMode: string;
}>(input: {
  channelBindings: T[];
  channelName: string;
  sourceMapping?: { channelBindingId?: string } | null;
}): T | null {
  const sendableBindings = input.channelBindings.filter((binding) => binding.syncMode !== "ingest_only");
  const sourceChannelBindingId = input.sourceMapping?.channelBindingId?.trim();
  if (sourceChannelBindingId) {
    return sendableBindings.find((binding) => binding.id === sourceChannelBindingId) ?? null;
  }
  const channelName = input.channelName.trim();
  return sendableBindings.find((binding) => binding.channelName === channelName) ?? null;
}

export function buildFeishuOutboundMessagePolicyInput(input: {
  context: IntegrationRuntimeContext;
  outbox: Pick<ExternalMessageOutboxRecord,
    "targetExternalChatId" |
    "targetExternalThreadId" |
    "agentSpaceMessageId" |
    "payloadJson"
  >;
}): AgentActionPolicyInput {
  const summary = summarizeFeishuOutboundPayloadForPolicy(input.outbox.payloadJson);
  return {
    workspaceId: input.context.workspaceId,
    actor: {
      type: "system",
      systemId: "feishu-outbox",
    },
    action: {
      type: "external_message.send",
      provider: FEISHU_PROVIDER_ID,
      resourceType: "feishu.chat",
      resourceId: input.outbox.targetExternalChatId,
      operationSummary: buildFeishuOutboundPolicySummary({
        msgType: summary.msgType,
        hasAttachment: summary.hasAttachment,
        isReply: Boolean(input.outbox.targetExternalThreadId),
      }),
      riskLevel: "low",
    },
  };
}

export function decideFeishuOutboundMessagePolicy(input: {
  context: IntegrationRuntimeContext;
  outbox: Pick<ExternalMessageOutboxRecord,
    "targetExternalChatId" |
    "targetExternalThreadId" |
    "agentSpaceMessageId" |
    "payloadJson"
  >;
}): FeishuOutboundMessagePolicyResult {
  const policyInput = buildFeishuOutboundMessagePolicyInput(input);
  return {
    policyInput,
    decision: decideAgentActionPolicySync(policyInput),
  };
}

export function buildFeishuOutboundMappingMetadata(input: {
  integration?: Pick<ExternalIntegrationRecord, "id" | "agentId"> | null;
  outbox: Pick<ExternalMessageOutboxRecord, "id" | "targetExternalChatId" | "targetExternalThreadId">;
  policy: FeishuOutboundMessagePolicyResult;
  feishuResponse: Record<string, unknown>;
}): Record<string, unknown> {
  const agentId = asString(input.integration?.agentId);
  return {
    provider: FEISHU_PROVIDER_ID,
    outboxId: input.outbox.id,
    externalChatReference: formatFeishuOutboundReference(input.outbox.targetExternalChatId),
    externalThreadReference: formatFeishuOutboundReference(input.outbox.targetExternalThreadId),
    agentId,
    botBindingId: agentId ? input.integration?.id : undefined,
    agentActionPolicyInput: buildSafeFeishuOutboundPolicyInput(input.policy.policyInput),
    agentActionPolicyDecision: buildSafeFeishuOutboundPolicyDecision(input.policy.decision),
    feishuResponse: input.feishuResponse,
  };
}

function buildSafeFeishuOutboundPolicyInput(policyInput: AgentActionPolicyInput): Record<string, unknown> {
  const { action, ...rest } = policyInput;
  const { resourceId, ...safeAction } = action;
  return {
    ...rest,
    action: {
      ...safeAction,
      resourceReference: formatFeishuOutboundReference(resourceId),
      resourceIdRedacted: Boolean(resourceId),
    },
  };
}

function buildSafeFeishuOutboundPolicyDecision(
  decision: AgentActionPolicyDecision,
): Record<string, unknown> {
  const auditData = isRecord(decision.auditData)
    ? { ...decision.auditData }
    : undefined;
  const resourceId = asString(auditData?.resourceId);
  if (auditData && resourceId) {
    delete auditData.resourceId;
    auditData.resourceReference = formatFeishuOutboundReference(resourceId);
    auditData.resourceIdRedacted = true;
  }
  return {
    ...decision,
    auditData,
  };
}

export async function processDueFeishuOutboxMessages(input: {
  context: IntegrationRuntimeContext;
  client: FeishuApiClient;
  lockedBy: string;
  now?: string;
  limit?: number;
}): Promise<FeishuOutboxProcessResult[]> {
  const pending = listPendingExternalMessageOutboxSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    now: input.now,
    limit: input.limit,
  });
  const results: FeishuOutboxProcessResult[] = [];

  for (const item of pending) {
    results.push(await processFeishuOutboxMessage({
      context: input.context,
      client: input.client,
      outboxId: item.id,
      lockedBy: input.lockedBy,
    }));
  }

  return results;
}

export async function drainFeishuOutboxMessages(input: {
  workspaceId: string;
  integrationId?: string;
  lockedBy: string;
  now?: string;
  limit?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<FeishuOutboxDrainResult> {
  const integrations = resolveFeishuDrainIntegrations({
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
  });
  const results: FeishuOutboxDrainResult["results"] = [];
  const errors: FeishuOutboxDrainResult["errors"] = [];

  for (const integration of integrations) {
    try {
      const credentials = readFeishuIntegrationCredentials(integration);
      const token = await fetchFeishuTenantAccessToken({
        appId: integration.appId ?? "",
        appSecret: credentials.appSecret,
        baseUrl: input.baseUrl,
        fetchImpl: input.fetchImpl,
      });
      const client = createFeishuApiClient({
        credentials: {
          appId: integration.appId ?? "",
          appSecret: credentials.appSecret,
          tenantAccessToken: token.tenantAccessToken,
        },
        baseUrl: input.baseUrl,
        fetchImpl: input.fetchImpl,
      });
      const processed = await processDueFeishuOutboxMessages({
        context: {
          workspaceId: input.workspaceId,
          integrationId: integration.id,
          provider: FEISHU_PROVIDER_ID,
        },
        client,
        lockedBy: input.lockedBy,
        now: input.now,
        limit: input.limit,
      });
      results.push(...processed.map((item) => ({
        integrationId: integration.id,
        outboxId: item.outboxId,
        status: item.status,
        externalMessageId: item.externalMessageId,
        errorCode: item.errorCode,
        errorMessage: item.errorMessage,
        retryable: item.retryable,
        terminal: item.terminal,
        nextAttemptAt: item.nextAttemptAt,
      })));
    } catch (error) {
      const errorInfo = normalizeFeishuOutboundError(error, { attempts: FEISHU_OUTBOX_MAX_ATTEMPTS });
      errors.push({
        integrationId: integration.id,
        errorMessage: formatFeishuOutboundError(errorInfo),
      });
    }
  }

  const sentCount = results.filter((item) => item.status === "sent").length;
  const failedCount = results.filter((item) => item.status === "failed").length + errors.length;
  return {
    workspaceId: input.workspaceId,
    provider: FEISHU_PROVIDER_ID,
    integrationCount: integrations.length,
    processedCount: results.length,
    sentCount,
    failedCount,
    results,
    errors,
  };
}

export async function processFeishuOutboxMessage(input: {
  context: IntegrationRuntimeContext;
  client: FeishuApiClient;
  outboxId: string;
  lockedBy: string;
}): Promise<FeishuOutboxProcessResult> {
  let locked: ExternalMessageOutboxRecord;
  try {
    locked = markExternalMessageOutboxLockedSync({
      workspaceId: input.context.workspaceId,
      outboxId: input.outboxId,
      lockedBy: input.lockedBy,
    });
  } catch (error) {
    return {
      outboxId: input.outboxId,
      status: "failed",
      errorCode: "feishu.outbound.lock_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      retryable: false,
      terminal: true,
    };
  }

  try {
    const policy = decideFeishuOutboundMessagePolicy({
      context: input.context,
      outbox: locked,
    });
    if (policy.decision.decision !== "allow") {
      const errorInfo: FeishuOutboundErrorInfo = {
        errorCode: policy.decision.reasonCode,
        errorMessage: policy.decision.reason,
        retryable: false,
        terminal: true,
      };
      failExternalMessageOutboxSync({
        workspaceId: input.context.workspaceId,
        outboxId: locked.id,
        lastError: formatFeishuOutboundError(errorInfo),
        terminal: true,
      });
      return {
        outboxId: locked.id,
        status: "failed",
        errorCode: errorInfo.errorCode,
        errorMessage: errorInfo.errorMessage,
        retryable: false,
        terminal: true,
      };
    }
    const sent = await sendFeishuOutboxPayload({
      client: input.client,
      payloadJson: locked.payloadJson,
    });
    const integration = readExternalIntegrationSync({
      workspaceId: input.context.workspaceId,
      integrationId: input.context.integrationId,
    });
    createExternalMessageMappingSync({
      workspaceId: input.context.workspaceId,
      integrationId: input.context.integrationId,
      channelBindingId: locked.channelBindingId,
      direction: "outbound",
      externalMessageId: sent.externalMessageId,
      externalThreadId: locked.targetExternalThreadId,
      agentSpaceMessageId: locked.agentSpaceMessageId,
      metadataJson: buildFeishuOutboundMappingMetadata({
        integration,
        outbox: locked,
        policy,
        feishuResponse: sent.safeResponseSummary,
      }),
    });
    completeExternalMessageOutboxSync({
      workspaceId: input.context.workspaceId,
      outboxId: locked.id,
    });
    return {
      outboxId: locked.id,
      status: "sent",
      externalMessageId: sent.externalMessageId,
    };
  } catch (error) {
    const errorInfo = normalizeFeishuOutboundError(error, { attempts: locked.attempts });
    const nextAttemptAt = errorInfo.terminal
      ? undefined
      : computeFeishuOutboxNextAttemptAt(locked.attempts);
    failExternalMessageOutboxSync({
      workspaceId: input.context.workspaceId,
      outboxId: locked.id,
      lastError: formatFeishuOutboundError(errorInfo),
      nextAttemptAt,
      terminal: errorInfo.terminal,
    });
    return {
      outboxId: locked.id,
      status: "failed",
      errorCode: errorInfo.errorCode,
      errorMessage: errorInfo.errorMessage,
      retryable: errorInfo.retryable,
      terminal: errorInfo.terminal,
      nextAttemptAt,
    };
  }
}

export async function sendFeishuOutboxPayload(input: {
  client: FeishuApiClient;
  payloadJson: string | Record<string, unknown>;
}): Promise<{
  externalMessageId: string;
  safeResponseSummary: Record<string, unknown>;
}> {
  const payload = typeof input.payloadJson === "string"
    ? parseFeishuOutboundPayload(input.payloadJson)
    : input.payloadJson;
  if (isFeishuOutboundAttachmentPayload(payload)) {
    return sendFeishuAttachmentOutboxPayload({
      client: input.client,
      payload,
    });
  }

  const request = buildFeishuMessageCreateRequest(payload);
  const response = await input.client.request<Record<string, unknown>>(request);
  const responseError = resolveFeishuOutboundApiResponseError(response);
  if (responseError) {
    throw responseError;
  }
  const externalMessageId = resolveFeishuOutboundMessageId(response);
  if (!externalMessageId) {
    throw createIntegrationProviderError({
      provider: FEISHU_PROVIDER_ID,
      code: "feishu.outbound.missing_message_id",
      message: "Feishu outbound response did not include a message id.",
      cause: summarizeFeishuOutboundResponse(response),
    });
  }
  return {
    externalMessageId,
    safeResponseSummary: summarizeFeishuOutboundResponse(response),
  };
}

export async function sendFeishuAttachmentOutboxPayload(input: {
  client: FeishuApiClient;
  payload: FeishuOutboundAttachmentPayload;
}): Promise<{
  externalMessageId: string;
  safeResponseSummary: Record<string, unknown>;
}> {
  const uploaded = await uploadFeishuOutboundAttachment({
    client: input.client,
    attachment: input.payload.attachment,
  });
  const messagePayload = {
    receive_id_type: input.payload.receive_id_type,
    receive_id: input.payload.receive_id,
    ...(input.payload.reply_to_message_id ? { reply_to_message_id: input.payload.reply_to_message_id } : {}),
    msg_type: uploaded.msgType,
    content: JSON.stringify(uploaded.content),
  };
  const response = await input.client.request<Record<string, unknown>>(buildFeishuMessageCreateRequest(messagePayload));
  const responseError = resolveFeishuOutboundApiResponseError(response);
  if (responseError) {
    throw responseError;
  }
  const externalMessageId = resolveFeishuOutboundMessageId(response);
  if (!externalMessageId) {
    throw createIntegrationProviderError({
      provider: FEISHU_PROVIDER_ID,
      code: "feishu.outbound.missing_message_id",
      message: "Feishu outbound response did not include a message id.",
      cause: summarizeFeishuOutboundResponse(response),
    });
  }

  return {
    externalMessageId,
    safeResponseSummary: {
      attachmentId: input.payload.attachment.id,
      attachmentFileName: input.payload.attachment.fileName,
      upload: uploaded.safeResponseSummary,
      send: summarizeFeishuOutboundResponse(response),
    },
  };
}

export async function uploadFeishuOutboundAttachment(input: {
  client: FeishuApiClient;
  attachment: FeishuOutboundAttachmentRef;
}): Promise<{
  msgType: "image" | "file";
  content: Record<string, string>;
  safeResponseSummary: Record<string, unknown>;
}> {
  if (!input.client.upload) {
    throw createIntegrationProviderError({
      provider: FEISHU_PROVIDER_ID,
      code: "feishu.outbound.upload_unavailable",
      message: "Feishu API client does not support multipart attachment uploads.",
    });
  }
  if (input.attachment.sizeBytes <= 0) {
    throw createIntegrationProviderError({
      provider: FEISHU_PROVIDER_ID,
      code: "feishu.outbound.attachment_empty",
      message: "Feishu outbound attachment cannot be empty.",
    });
  }
  if (input.attachment.sizeBytes > FEISHU_OUTBOUND_ATTACHMENT_MAX_BYTES) {
    throw createIntegrationProviderError({
      provider: FEISHU_PROVIDER_ID,
      code: "feishu.outbound.attachment_too_large",
      message: `Feishu outbound attachment exceeds the ${FEISHU_OUTBOUND_ATTACHMENT_MAX_BYTES} byte limit.`,
    });
  }

  let contentBytes: Uint8Array;
  try {
    contentBytes = await readFeishuOutboundAttachmentBytes(input.attachment);
  } catch (error) {
    throw createIntegrationProviderError({
      provider: FEISHU_PROVIDER_ID,
      code: "feishu.outbound.attachment_unavailable",
      message: `Feishu outbound attachment "${input.attachment.fileName}" could not be read from AgentSpace storage.`,
      cause: error,
    });
  }
  if (contentBytes.byteLength <= 0) {
    throw createIntegrationProviderError({
      provider: FEISHU_PROVIDER_ID,
      code: "feishu.outbound.attachment_empty",
      message: "Feishu outbound attachment cannot be empty.",
    });
  }
  if (contentBytes.byteLength > FEISHU_OUTBOUND_ATTACHMENT_MAX_BYTES) {
    throw createIntegrationProviderError({
      provider: FEISHU_PROVIDER_ID,
      code: "feishu.outbound.attachment_too_large",
      message: `Feishu outbound attachment exceeds the ${FEISHU_OUTBOUND_ATTACHMENT_MAX_BYTES} byte limit.`,
    });
  }

  const uploadAsImage =
    input.attachment.kind === "image" &&
    isSupportedFeishuOutboundImageMediaType(input.attachment.mediaType);
  const response = await input.client.upload<Record<string, unknown>>(
    uploadAsImage
      ? buildFeishuImageUploadRequest({
        fileName: input.attachment.fileName,
        mediaType: input.attachment.mediaType,
        contentBytes,
      })
      : buildFeishuFileUploadRequest({
        fileName: input.attachment.fileName,
        mediaType: input.attachment.mediaType,
        contentBytes,
      }),
  );
  const responseError = resolveFeishuOutboundApiResponseError(response);
  if (responseError) {
    throw responseError;
  }

  if (uploadAsImage) {
    const imageKey = resolveFeishuOutboundImageKey(response);
    if (!imageKey) {
      throw createIntegrationProviderError({
        provider: FEISHU_PROVIDER_ID,
        code: "feishu.outbound.missing_image_key",
        message: "Feishu image upload response did not include an image key.",
        cause: summarizeFeishuOutboundResponse(response),
      });
    }
    return {
      msgType: "image",
      content: { image_key: imageKey },
      safeResponseSummary: {
        msgType: "image",
        imageKeyReference: formatFeishuOutboundReference(imageKey),
      },
    };
  }

  const fileKey = resolveFeishuOutboundFileKey(response);
  if (!fileKey) {
    throw createIntegrationProviderError({
      provider: FEISHU_PROVIDER_ID,
      code: "feishu.outbound.missing_file_key",
      message: "Feishu file upload response did not include a file key.",
      cause: summarizeFeishuOutboundResponse(response),
    });
  }
  return {
    msgType: "file",
    content: { file_key: fileKey },
    safeResponseSummary: {
      msgType: "file",
      fileKeyReference: formatFeishuOutboundReference(fileKey),
    },
  };
}

async function readFeishuOutboundAttachmentBytes(
  attachment: FeishuOutboundAttachmentRef,
): Promise<Uint8Array> {
  if (!attachment.storageProvider || attachment.storageProvider === "local") {
    return readFileSync(attachment.storedPath);
  }
  return createAttachmentStorageClient().getObject({
    storageProvider: attachment.storageProvider,
    storageBucket: attachment.storageBucket,
    storageRegion: attachment.storageRegion,
    storageEndpoint: attachment.storageEndpoint,
    storageKey: attachment.storageKey,
    storedPath: attachment.storedPath,
  });
}

export function buildFeishuImageUploadRequest(input: {
  fileName: string;
  mediaType: string;
  contentBytes: Uint8Array;
}): FeishuMultipartUploadRequest {
  return {
    method: "POST",
    path: "/open-apis/im/v1/images",
    fields: {
      image_type: "message",
    },
    file: {
      fieldName: "image",
      fileName: input.fileName,
      mediaType: input.mediaType,
      contentBytes: input.contentBytes,
    },
  };
}

export function buildFeishuFileUploadRequest(input: {
  fileName: string;
  mediaType: string;
  contentBytes: Uint8Array;
}): FeishuMultipartUploadRequest {
  return {
    method: "POST",
    path: "/open-apis/im/v1/files",
    fields: {
      file_type: resolveFeishuOutboundFileType(input.fileName, input.mediaType),
      file_name: input.fileName,
    },
    file: {
      fieldName: "file",
      fileName: input.fileName,
      mediaType: input.mediaType,
      contentBytes: input.contentBytes,
    },
  };
}

export function buildFeishuMessageCreateRequest(
  payload: Record<string, unknown>,
): FeishuApiRequest {
  const replyToMessageId = typeof payload.reply_to_message_id === "string" && payload.reply_to_message_id.trim()
    ? payload.reply_to_message_id.trim()
    : undefined;
  if (replyToMessageId) {
    const {
      receive_id: _receiveId,
      receive_id_type: _receiveIdType,
      reply_to_message_id: _replyToMessageId,
      ...body
    } = payload;
    return {
      method: "POST",
      path: `/open-apis/im/v1/messages/${encodeURIComponent(replyToMessageId)}/reply`,
      body,
    };
  }

  const receiveIdType = typeof payload.receive_id_type === "string" && payload.receive_id_type.trim()
    ? payload.receive_id_type.trim()
    : "chat_id";
  const {
    receive_id_type: _receiveIdType,
    ...body
  } = payload;
  return {
    method: "POST",
    path: "/open-apis/im/v1/messages",
    query: {
      receive_id_type: receiveIdType,
    },
    body,
  };
}

export function resolveFeishuOutboundMessageId(response: Record<string, unknown>): string | undefined {
  const data = asRecord(response.data);
  return asString(data?.message_id)
    ?? asString(data?.messageId)
    ?? asString(response.message_id)
    ?? asString(response.messageId);
}

export function resolveFeishuOutboundImageKey(response: Record<string, unknown>): string | undefined {
  const data = asRecord(response.data);
  return asString(data?.image_key)
    ?? asString(data?.imageKey)
    ?? asString(response.image_key)
    ?? asString(response.imageKey);
}

export function resolveFeishuOutboundFileKey(response: Record<string, unknown>): string | undefined {
  const data = asRecord(response.data);
  return asString(data?.file_key)
    ?? asString(data?.fileKey)
    ?? asString(response.file_key)
    ?? asString(response.fileKey);
}

function parseFeishuOutboundPayload(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) {
    throw createIntegrationProviderError({
      provider: FEISHU_PROVIDER_ID,
      code: "feishu.outbound.invalid_payload",
      message: "Feishu outbound payload must be a JSON object.",
    });
  }
  return parsed;
}

function summarizeFeishuOutboundPayloadForPolicy(payloadJson: string): {
  msgType?: string;
  hasAttachment: boolean;
} {
  try {
    const payload = parseFeishuOutboundPayload(payloadJson);
    const msgType = asString(payload.msg_type);
    return {
      msgType: msgType ?? (isFeishuOutboundAttachmentPayload(payload) ? "attachment" : undefined),
      hasAttachment: isFeishuOutboundAttachmentPayload(payload),
    };
  } catch {
    return {
      msgType: "invalid",
      hasAttachment: false,
    };
  }
}

function buildFeishuOutboundPolicySummary(input: {
  msgType?: string;
  hasAttachment: boolean;
  isReply: boolean;
}): string {
  const messageKind = input.hasAttachment
    ? "attachment"
    : input.msgType?.trim() || "message";
  return `Send Feishu ${messageKind} ${input.isReply ? "reply" : "message"} to a bound chat.`;
}

function isFeishuOutboundAttachmentPayload(payload: Record<string, unknown>): payload is FeishuOutboundAttachmentPayload {
  if (payload.agent_space_payload_kind !== FEISHU_OUTBOUND_ATTACHMENT_PAYLOAD_KIND) {
    return false;
  }
  const attachment = asRecord(payload.attachment);
  return payload.receive_id_type === "chat_id" &&
    typeof payload.receive_id === "string" &&
    Boolean(payload.receive_id.trim()) &&
    Boolean(attachment) &&
    typeof attachment?.id === "string" &&
    typeof attachment.fileName === "string" &&
    typeof attachment.mediaType === "string" &&
    typeof attachment.sizeBytes === "number" &&
    typeof attachment.storedPath === "string";
}

function resolveFeishuOutboundApiResponseError(response: Record<string, unknown>): IntegrationProviderError | undefined {
  const code = typeof response.code === "number" ? response.code : undefined;
  if (code === undefined || code === 0) {
    return undefined;
  }
  const msg = asString(response.msg) ?? asString(response.message) ?? "Feishu rejected the outbound message request.";
  return createIntegrationProviderError({
    provider: FEISHU_PROVIDER_ID,
    code: normalizeFeishuOutboundApiErrorCode(code, msg),
    message: `Feishu rejected outbound message request: ${sanitizeFeishuOutboundMessageText(msg)}`,
    cause: summarizeFeishuOutboundResponse(response),
  });
}

function summarizeFeishuOutboundResponse(response: Record<string, unknown>): Record<string, unknown> {
  const data = asRecord(response.data);
  return {
    code: readSafeFeishuOutboundCode(response.code),
    messageRedacted: hasPresentFeishuOutboundValue(response.msg) ? true : undefined,
    messageReference: formatFeishuOutboundReference(asString(data?.message_id) ?? asString(response.message_id)),
  };
}

function readSafeFeishuOutboundCode(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return "[string-code]";
  }
  return undefined;
}

function hasPresentFeishuOutboundValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  return typeof value === "string" ? Boolean(value.trim()) : true;
}

function formatFeishuOutboundReference(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("ref_")) {
    return trimmed;
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < trimmed.length; index += 1) {
    hash ^= trimmed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `ref_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function normalizeFeishuOutboundError(
  error: unknown,
  options: { attempts?: number; maxAttempts?: number } = {},
): FeishuOutboundErrorInfo {
  const attempts = Math.max(0, Math.floor(options.attempts ?? 0));
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? FEISHU_OUTBOX_MAX_ATTEMPTS));
  const errorCode = resolveFeishuOutboundErrorCode(error);
  const retryable = isRetryableFeishuOutboundError(errorCode, error);
  return {
    errorCode,
    errorMessage: sanitizeFeishuOutboundErrorMessage(error),
    retryable,
    terminal: !retryable || attempts >= maxAttempts,
  };
}

export function formatFeishuOutboundError(errorInfo: FeishuOutboundErrorInfo): string {
  return truncateString(`${errorInfo.errorCode}: ${errorInfo.errorMessage}`, 1000);
}

export function computeFeishuOutboxRetryDelaySeconds(attempts: number): number {
  return Math.min(3600, Math.max(30, 30 * (2 ** Math.max(0, Math.floor(attempts) - 1))));
}

export function computeFeishuOutboxNextAttemptAt(attempts: number, now: Date = new Date()): string {
  return new Date(now.getTime() + computeFeishuOutboxRetryDelaySeconds(attempts) * 1000).toISOString();
}

function normalizeFeishuOutboundApiErrorCode(code: number, message: string): string {
  const normalizedMessage = message.toLowerCase();
  if (/rate|too many|qps|限流|频率/.test(normalizedMessage)) {
    return "feishu.outbound.rate_limited";
  }
  if (/permission|scope|unauthori[sz]ed|forbidden|access denied|权限/.test(normalizedMessage)) {
    return "feishu.outbound.permission_denied";
  }
  if (/not found|missing|不存在/.test(normalizedMessage)) {
    return "feishu.outbound.resource_not_found";
  }
  if (/invalid|bad request|参数|格式/.test(normalizedMessage)) {
    return "feishu.outbound.invalid_request";
  }
  if (code >= 500_000) {
    return "feishu.outbound.provider_unavailable";
  }
  return "feishu.outbound.api_rejected";
}

function resolveFeishuOutboundErrorCode(error: unknown): string {
  if (error instanceof IntegrationProviderError) {
    return error.code;
  }
  const structuralCode = isRecord(error) ? asString(error.code) : undefined;
  if (structuralCode?.startsWith("feishu.")) {
    return structuralCode;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("feishu.")) {
    return message.split(/\s+/)[0] ?? "feishu.outbound.failed";
  }
  if (/timeout|timed out/i.test(message)) {
    return "feishu.outbound.timeout";
  }
  if (/network|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return "feishu.outbound.network_unreachable";
  }
  return "feishu.outbound.failed";
}

function isRetryableFeishuOutboundError(errorCode: string, error: unknown): boolean {
  if (errorCode === "feishu.api_http_error" || errorCode === "feishu.tenant_token_http_error") {
    const httpStatus = parseHttpStatus(error instanceof Error ? error.message : String(error));
    return httpStatus === undefined ||
      httpStatus === 408 ||
      httpStatus === 409 ||
      httpStatus === 425 ||
      httpStatus === 429 ||
      httpStatus >= 500;
  }
  if (FEISHU_OUTBOUND_TERMINAL_ERROR_CODES.has(errorCode)) {
    return false;
  }
  return FEISHU_OUTBOUND_RETRYABLE_ERROR_CODES.has(errorCode) || errorCode === "feishu.outbound.failed";
}

const FEISHU_OUTBOUND_RETRYABLE_ERROR_CODES = new Set([
  "feishu.outbound.failed",
  "feishu.outbound.network_unreachable",
  "feishu.outbound.timeout",
  "feishu.outbound.rate_limited",
  "feishu.outbound.provider_unavailable",
]);

const FEISHU_OUTBOUND_TERMINAL_ERROR_CODES = new Set([
  "feishu.credentials_missing",
  "feishu.fetch_unavailable",
  "feishu.tenant_token_missing",
  "feishu.tenant_token_rejected",
  "feishu.outbound.attachment_empty",
  "feishu.outbound.attachment_too_large",
  "feishu.outbound.attachment_unavailable",
  "feishu.outbound.api_rejected",
  "feishu.outbound.invalid_payload",
  "feishu.outbound.invalid_request",
  "feishu.outbound.missing_message_id",
  "feishu.outbound.missing_image_key",
  "feishu.outbound.missing_file_key",
  "feishu.outbound.permission_denied",
  "feishu.outbound.resource_not_found",
  "feishu.outbound.upload_unavailable",
]);

function sanitizeFeishuOutboundErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return truncateString(sanitizeFeishuOutboundMessageText(message), 1000);
}

function sanitizeFeishuOutboundMessageText(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /(app_secret|appSecret|tenant_access_token|tenantAccessToken|encrypt_key|encryptKey|verification_token|verificationToken|access_token|accessToken|token|secret)\s*[:=]\s*['"]?[A-Za-z0-9._~+/=-]+['"]?/gi,
      "$1=[redacted]",
    );
}

function parseHttpStatus(message: string): number | undefined {
  const match = /HTTP\s+(\d{3})/i.exec(message);
  return match ? Number(match[1]) : undefined;
}

function truncateString(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function splitTextByUtf8Bytes(text: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (current && currentBytes + characterBytes > maxBytes) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    if (characterBytes > maxBytes) {
      chunks.push(character);
      continue;
    }
    current += character;
    currentBytes += characterBytes;
  }

  if (current || chunks.length === 0) {
    chunks.push(current);
  }
  return chunks;
}

function serializeFeishuOutboundAttachment(attachment: MessageAttachment): FeishuOutboundAttachmentRef {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    mediaType: attachment.mediaType,
    sizeBytes: attachment.sizeBytes,
    kind: attachment.kind,
    storedPath: attachment.storedPath,
    storageProvider: attachment.storageProvider,
    storageBucket: attachment.storageBucket,
    storageRegion: attachment.storageRegion,
    storageEndpoint: attachment.storageEndpoint,
    storageKey: attachment.storageKey,
    sha256: attachment.sha256,
  };
}

function resolveFeishuAgentStatusCardView(status: FeishuAgentStatusCardStatus): {
  label: string;
  template: string;
} {
  if (status === "complete") {
    return {
      label: "Complete",
      template: "green",
    };
  }
  if (status === "failed") {
    return {
      label: "Failed",
      template: "red",
    };
  }
  if (status === "approval_required") {
    return {
      label: "Approval required",
      template: "orange",
    };
  }
  return {
    label: "Thinking",
    template: "blue",
  };
}

function uniqueNonEmpty(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && !result.includes(trimmed)) {
      result.push(trimmed);
    }
  }
  return result;
}

function truncateFeishuCardText(value: string): string {
  const trimmed = value.trim();
  const truncated = trimmed.length > FEISHU_CARD_TEXT_MAX_CHARS
    ? `${trimmed.slice(0, FEISHU_CARD_TEXT_MAX_CHARS - 3)}...`
    : trimmed;
  return escapeFeishuCardMarkdown(truncated);
}

function escapeFeishuCardMarkdown(value: string): string {
  return value.replace(/[<>]/g, (match) => (match === "<" ? "&lt;" : "&gt;"));
}

function isSupportedFeishuOutboundImageMediaType(mediaType: string): boolean {
  const normalized = mediaType.toLowerCase();
  return normalized === "image/jpeg"
    || normalized === "image/png"
    || normalized === "image/webp"
    || normalized === "image/gif"
    || normalized === "image/bmp"
    || normalized === "image/x-icon"
    || normalized === "image/vnd.microsoft.icon"
    || normalized === "image/tiff"
    || normalized === "image/heic";
}

function resolveFeishuOutboundFileType(fileName: string, mediaType: string): string {
  const extension = fileName.split(".").pop()?.trim().toLowerCase();
  if (extension === "doc" || extension === "docx") {
    return "doc";
  }
  if (extension === "xls" || extension === "xlsx") {
    return "xls";
  }
  if (extension === "ppt" || extension === "pptx") {
    return "ppt";
  }
  if (extension === "mp4" || extension === "mp3" || extension === "pdf") {
    return extension;
  }
  if (mediaType === "application/pdf") {
    return "pdf";
  }
  if (mediaType.startsWith("video/")) {
    return "mp4";
  }
  if (mediaType.startsWith("audio/")) {
    return "mp3";
  }
  return "stream";
}

function resolveFeishuDrainIntegrations(input: {
  workspaceId: string;
  integrationId?: string;
}): ExternalIntegrationRecord[] {
  if (input.integrationId?.trim()) {
    const integration = readExternalIntegrationSync({
      workspaceId: input.workspaceId,
      integrationId: input.integrationId,
    });
    if (!integration || integration.provider !== FEISHU_PROVIDER_ID) {
      throw new Error("Feishu integration does not exist.");
    }
    return integration.status === "active" ? [integration] : [];
  }

  return listExternalIntegrationsSync({
    workspaceId: input.workspaceId,
    provider: FEISHU_PROVIDER_ID,
  }).filter((integration) => integration.status === "active");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
