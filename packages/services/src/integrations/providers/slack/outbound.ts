import { existsSync, readFileSync } from "node:fs";
import {
  completeExternalMessageOutboxSync,
  createExternalMessageMappingSync,
  failExternalMessageOutboxSync,
  listExternalChannelBindingsSync,
  listExternalIntegrationsSync,
  listPendingExternalMessageOutboxSync,
  markExternalMessageOutboxLockedSync,
  readExternalChannelBindingSync,
  readExternalIntegrationSync,
  readExternalMessageMappingByExternalMessageSync,
  readExternalMessageMappingByAgentSpaceMessageSync,
  type ExternalIntegrationRecord,
  type ExternalMessageMappingRecord,
  type ExternalMessageOutboxRecord,
} from "@agent-space/db";
import type { MessageAttachment } from "@agent-space/domain/workspace";
import {
  enqueueExternalOutboundMessageSync,
  type AgentSpaceOutboundMessage,
  type ExternalOutboundMessagePayload,
  type IntegrationRuntimeContext,
} from "../../core/index.ts";
import { SLACK_OUTBOX_MAX_ATTEMPTS, SLACK_PROVIDER_ID, SLACK_TEXT_MESSAGE_MAX_CHARS } from "./constants.ts";
import { readSlackIntegrationCredentials } from "./credentials.ts";
import { buildSlackReference, type SlackAgentContextSummary } from "./events.ts";

export interface SlackOutboxProcessResult {
  outboxId: string;
  status: "sent" | "failed";
  externalMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
  terminal?: boolean;
  nextAttemptAt?: string;
}

export interface SlackOutboxDrainResult {
  workspaceId: string;
  provider: typeof SLACK_PROVIDER_ID;
  integrationCount: number;
  processedCount: number;
  sentCount: number;
  failedCount: number;
  results: Array<{
    integrationId: string;
    outboxId: string;
    status: SlackOutboxProcessResult["status"];
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

export type SlackAppHomeOpenedWelcomeQueueResult =
  | {
    status: "queued";
    outbox: ExternalMessageOutboxRecord;
    suggestedPromptsOutbox: ExternalMessageOutboxRecord;
    mapping: ExternalMessageMappingRecord;
  }
  | {
    status: "skipped";
    reasonCode: "slack.app_home_opened_welcome_already_queued";
    mapping: ExternalMessageMappingRecord;
  };

export interface SlackTextOutboundPayload extends Record<string, unknown> {
  channel: string;
  text: string;
  thread_ts?: string;
}

export interface SlackBlockKitOutboundPayload extends SlackTextOutboundPayload {
  blocks: Record<string, unknown>[];
  unfurl_links?: boolean;
  unfurl_media?: boolean;
}

export type SlackChatPostMessagePayload = SlackTextOutboundPayload | SlackBlockKitOutboundPayload;

export interface SlackAssistantSuggestedPrompt {
  title: string;
  message: string;
}

export interface SlackAssistantSuggestedPromptsPayload extends Record<string, unknown> {
  method: "assistant.threads.setSuggestedPrompts";
  channel_id: string;
  prompts: SlackAssistantSuggestedPrompt[];
  title?: string;
  thread_ts?: string;
}

export type SlackOutboundApiPayload =
  | SlackChatPostMessagePayload
  | SlackAssistantSuggestedPromptsPayload
  | SlackFileUploadOutboundPayload;

export type SlackAgentStatusCardStatus =
  | "thinking"
  | "complete"
  | "failed"
  | "approval_required";

export interface SlackApprovalBlockActionPayload {
  approvalId: string;
  payloadHash: string;
  token: string;
}

export interface SlackApiMethodResult {
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
  retryAfterSeconds?: number;
  status: number;
}

export interface SlackApiPostMessageResult extends SlackApiMethodResult {
  channel?: string;
  ts?: string;
}

export interface SlackApiFileUploadResult extends SlackApiMethodResult {
  fileRefs?: string[];
}

export interface SlackFileUploadItem {
  attachmentId: string;
  filename: string;
  title: string;
  mediaType?: string;
  sizeBytes: number;
  storedPath: string;
}

export interface SlackFileUploadOutboundPayload extends Record<string, unknown> {
  method: "files.completeUploadExternal";
  channel_id: string;
  files: SlackFileUploadItem[];
  initial_comment?: string;
  thread_ts?: string;
}

export function buildSlackTextOutboundMessage(input: {
  targetExternalChatId: string;
  text: string;
  targetExternalThreadId?: string;
}): ExternalOutboundMessagePayload {
  const text = truncateSlackText(input.text);
  return {
    targetExternalChatId: input.targetExternalChatId,
    targetExternalThreadId: input.targetExternalThreadId,
    payload: {
      channel: input.targetExternalChatId,
      text,
      ...(input.targetExternalThreadId ? { thread_ts: input.targetExternalThreadId } : {}),
    },
  };
}

export function buildSlackFileUploadOutboundMessage(input: {
  targetExternalChatId: string;
  attachments: MessageAttachment[];
  text?: string;
  targetExternalThreadId?: string;
}): ExternalOutboundMessagePayload {
  const files = normalizeSlackFileUploadItems(input.attachments);
  if (files.length === 0) {
    throw new Error("slack.file_upload_payload_empty");
  }
  const initialComment = input.text?.trim();
  return {
    targetExternalChatId: input.targetExternalChatId,
    targetExternalThreadId: input.targetExternalThreadId,
    payload: {
      method: "files.completeUploadExternal",
      channel_id: input.targetExternalChatId,
      files,
      ...(initialComment ? { initial_comment: truncateSlackText(initialComment) } : {}),
      ...(input.targetExternalThreadId ? { thread_ts: input.targetExternalThreadId } : {}),
    } satisfies SlackFileUploadOutboundPayload,
  };
}

export function buildSlackBlockKitOutboundMessage(input: {
  targetExternalChatId: string;
  text: string;
  blocks: Record<string, unknown>[];
  targetExternalThreadId?: string;
}): ExternalOutboundMessagePayload {
  const text = truncateSlackText(input.text);
  return {
    targetExternalChatId: input.targetExternalChatId,
    targetExternalThreadId: input.targetExternalThreadId,
    payload: {
      channel: input.targetExternalChatId,
      text,
      blocks: input.blocks,
      unfurl_links: false,
      unfurl_media: false,
      ...(input.targetExternalThreadId ? { thread_ts: input.targetExternalThreadId } : {}),
    } satisfies SlackBlockKitOutboundPayload,
  };
}

export function buildSlackAppHomeOpenedWelcomeOutboundMessage(input: {
  targetExternalChatId: string;
  agentId?: string | null;
}): ExternalOutboundMessagePayload {
  const agentId = readString(input.agentId);
  const title = agentId
    ? `AgentSpace is ready for ${agentId}.`
    : "AgentSpace is ready in Slack.";
  const intro = agentId
    ? `You are connected to *${escapeSlackMrkdwn(agentId)}* through AgentSpace.`
    : "You are connected to AgentSpace through Slack.";
  return buildSlackBlockKitOutboundMessage({
    targetExternalChatId: input.targetExternalChatId,
    text: title,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${escapeSlackMrkdwn(title)}*\n${intro}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Send a message here to start a governed AgentSpace conversation. Admins can also bind Slack channels and users for channel replies.",
        },
      },
      {
        type: "context",
        elements: [{
          type: "mrkdwn",
          text: "Workspace permissions, approvals, and audit trails stay controlled by AgentSpace.",
        }],
      },
    ],
  });
}

export function buildSlackAssistantSuggestedPromptsOutboundMessage(input: {
  targetExternalChatId: string;
  title?: string;
  prompts?: SlackAssistantSuggestedPrompt[];
  targetExternalThreadId?: string;
  agentId?: string | null;
}): ExternalOutboundMessagePayload {
  const prompts = normalizeSlackAssistantSuggestedPrompts(input.prompts, input.agentId);
  const title = input.title?.trim() || "Suggested prompts";
  return {
    targetExternalChatId: input.targetExternalChatId,
    targetExternalThreadId: input.targetExternalThreadId,
    payload: {
      method: "assistant.threads.setSuggestedPrompts",
      channel_id: input.targetExternalChatId,
      prompts,
      title: truncateSlackBlockText(title),
      ...(input.targetExternalThreadId ? { thread_ts: input.targetExternalThreadId } : {}),
    } satisfies SlackAssistantSuggestedPromptsPayload,
  };
}

export function buildSlackAgentStatusBlocks(input: {
  status: SlackAgentStatusCardStatus;
  channelName: string;
  agentNames: string[];
  message?: string;
  taskId?: string;
  approvalAction?: SlackApprovalBlockActionPayload;
  actionUrl?: string;
}): Record<string, unknown>[] {
  const statusView = resolveSlackAgentStatusCardView(input.status);
  const agentLabel = uniqueNonEmpty(input.agentNames).join(", ") || "Agent";
  const lines = [
    `*${escapeSlackMrkdwn(agentLabel)}* · ${statusView.label}`,
    `Channel: ${escapeSlackMrkdwn(input.channelName)}`,
    input.taskId ? `Task: ${escapeSlackMrkdwn(input.taskId)}` : undefined,
    input.message ? "" : undefined,
    input.message ? truncateSlackBlockText(input.message) : undefined,
  ].filter((line): line is string => line !== undefined);
  const blocks: Record<string, unknown>[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: lines.join("\n"),
      },
    },
    {
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `${statusView.context} · AgentSpace`,
      }],
    },
  ];
  const actionElements: Record<string, unknown>[] = [];
  if (input.status === "approval_required" && input.approvalAction) {
    actionElements.push({
      type: "button",
      text: {
        type: "plain_text",
        text: "Approve",
        emoji: true,
      },
      style: "primary",
      action_id: "agentspace_approval_approve",
      value: buildSlackApprovalBlockActionValue(input.approvalAction, "approved"),
    });
    actionElements.push({
      type: "button",
      text: {
        type: "plain_text",
        text: "Reject",
        emoji: true,
      },
      style: "danger",
      action_id: "agentspace_approval_reject",
      value: buildSlackApprovalBlockActionValue(input.approvalAction, "rejected"),
    });
  }
  if (input.actionUrl) {
    actionElements.push({
      type: "button",
      text: {
        type: "plain_text",
        text: "Open AgentSpace",
        emoji: true,
      },
      action_id: "agentspace_open",
      url: input.actionUrl,
    });
  }
  if (actionElements.length > 0) {
    blocks.push({
      type: "actions",
      block_id: "agentspace_actions",
      elements: actionElements,
    });
  }
  return blocks;
}

export function buildSlackAgentStatusCardOutboundMessage(input: {
  targetExternalChatId: string;
  targetExternalThreadId?: string;
  status: SlackAgentStatusCardStatus;
  channelName: string;
  agentNames: string[];
  message?: string;
  taskId?: string;
  approvalAction?: SlackApprovalBlockActionPayload;
  actionUrl?: string | null;
}): ExternalOutboundMessagePayload {
  const agentLabel = uniqueNonEmpty(input.agentNames).join(", ") || "Agent";
  const statusView = resolveSlackAgentStatusCardView(input.status);
  return buildSlackBlockKitOutboundMessage({
    targetExternalChatId: input.targetExternalChatId,
    targetExternalThreadId: input.targetExternalThreadId,
    text: `${agentLabel} · ${statusView.label}`,
    blocks: buildSlackAgentStatusBlocks({
      status: input.status,
      channelName: input.channelName,
      agentNames: input.agentNames,
      message: input.message,
      taskId: input.taskId,
      approvalAction: input.approvalAction,
      actionUrl: input.actionUrl === null ? undefined : input.actionUrl,
    }),
  });
}

export function queueSlackOutboundMessageSync(input: {
  context: IntegrationRuntimeContext;
  message: AgentSpaceOutboundMessage;
}): ExternalMessageOutboxRecord {
  const channelBinding = readExternalChannelBindingSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    channelName: input.message.channelName,
  });
  if (!channelBinding || channelBinding.status !== "active") {
    throw new Error("Active Slack channel binding is required before sending outbound messages.");
  }
  if (channelBinding.syncMode === "ingest_only") {
    throw new Error("Slack channel binding is ingest-only and cannot send outbound messages.");
  }

  const integration = readExternalIntegrationSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
  });
  const outbound = buildSlackTextOutboundMessage({
    targetExternalChatId: channelBinding.externalChatId,
    targetExternalThreadId: input.message.externalThreadId,
    text: appendSlackAttachmentNotice(input.message.text, input.message.attachments),
  });
  const textOutbox = enqueueExternalOutboundMessageSync({
    context: input.context,
    channelBindingId: channelBinding.id,
    agentSpaceMessageId: input.message.agentSpaceMessageId,
    outbound,
    metadataJson: buildSlackQueuedOutboxMetadata({
      source: "direct_outbound_message",
      outbound,
      integration,
      attachmentCount: countSendableSlackAttachments(input.message.attachments),
    }),
  });
  queueSlackFileUploadOutboxSync({
    context: input.context,
    integration,
    channelBindingId: channelBinding.id,
    agentSpaceMessageId: input.message.agentSpaceMessageId,
    targetExternalChatId: channelBinding.externalChatId,
    targetExternalThreadId: input.message.externalThreadId,
    attachments: input.message.attachments,
  });
  return textOutbox;
}

function queueSlackFileUploadOutboxSync(input: {
  context: IntegrationRuntimeContext;
  integration?: Pick<ExternalIntegrationRecord, "id" | "agentId"> | null;
  channelBindingId?: string;
  agentSpaceMessageId?: string;
  targetExternalChatId: string;
  targetExternalThreadId?: string;
  attachments?: MessageAttachment[];
}): ExternalMessageOutboxRecord | null {
  const attachments = (input.attachments ?? []).filter(isSendableSlackAttachment);
  if (attachments.length === 0) {
    return null;
  }
  const outbound = buildSlackFileUploadOutboundMessage({
    targetExternalChatId: input.targetExternalChatId,
    targetExternalThreadId: input.targetExternalThreadId,
    attachments,
  });
  return enqueueExternalOutboundMessageSync({
    context: input.context,
    channelBindingId: input.channelBindingId,
    agentSpaceMessageId: input.agentSpaceMessageId,
    outbound,
    metadataJson: {
      ...buildSlackQueuedOutboxMetadata({
        source: "slack_file_upload",
        outbound,
        integration: input.integration,
        attachmentCount: attachments.length,
      }),
      slackUploadFlow: "external_upload",
      method: "files.completeUploadExternal",
      files: buildSlackQueuedFileUploadMetadata((outbound.payload as SlackFileUploadOutboundPayload).files),
    },
  });
}

export function queueSlackAppHomeOpenedWelcomeOutboxSync(input: {
  workspaceId: string;
  integration: Pick<ExternalIntegrationRecord, "id" | "agentId">;
  externalChatId: string;
  externalUserId: string;
  externalEventId?: string;
  agentContext?: SlackAgentContextSummary;
}): SlackAppHomeOpenedWelcomeQueueResult {
  const externalMessageId = buildSlackAppHomeOpenedWelcomeExternalMessageId({
    externalChatId: input.externalChatId,
    externalUserId: input.externalUserId,
  });
  const existingMapping = readExternalMessageMappingByExternalMessageSync({
    workspaceId: input.workspaceId,
    integrationId: input.integration.id,
    externalMessageId,
  });
  if (existingMapping) {
    return {
      status: "skipped",
      reasonCode: "slack.app_home_opened_welcome_already_queued",
      mapping: existingMapping,
    };
  }

  const outbound = buildSlackAppHomeOpenedWelcomeOutboundMessage({
    targetExternalChatId: input.externalChatId,
    agentId: input.integration.agentId,
  });
  const mapping = createExternalMessageMappingSync({
    workspaceId: input.workspaceId,
    integrationId: input.integration.id,
    direction: "outbound",
    externalMessageId,
    externalThreadId: externalMessageId,
    externalSenderId: input.externalUserId,
    externalEventId: input.externalEventId,
    agentSpaceMessageId: externalMessageId,
    metadataJson: {
      provider: SLACK_PROVIDER_ID,
      mappingSource: "app_home_opened_welcome",
      externalChatReference: formatSlackOutboundReference(input.externalChatId),
      externalUserReference: formatSlackOutboundReference(input.externalUserId),
      agentContext: input.agentContext,
    },
  });
  const outbox = enqueueExternalOutboundMessageSync({
    context: {
      workspaceId: input.workspaceId,
      integrationId: input.integration.id,
      provider: SLACK_PROVIDER_ID,
    },
    agentSpaceMessageId: externalMessageId,
    outbound,
    metadataJson: {
      ...buildSlackQueuedOutboxMetadata({
        source: "app_home_opened_welcome",
        outbound,
        integration: input.integration,
      }),
      onboardingKey: externalMessageId,
      externalUserReference: formatSlackOutboundReference(input.externalUserId),
      agentContext: input.agentContext,
    },
  });
  const suggestedPromptsOutbox = queueSlackAssistantSuggestedPromptsOutboxSync({
    workspaceId: input.workspaceId,
    integration: input.integration,
    externalChatId: input.externalChatId,
    externalUserId: input.externalUserId,
    source: "app_home_opened",
    agentContext: input.agentContext,
  });
  return { status: "queued", outbox, suggestedPromptsOutbox, mapping };
}

export function queueSlackAssistantSuggestedPromptsOutboxSync(input: {
  workspaceId: string;
  integration: Pick<ExternalIntegrationRecord, "id" | "agentId">;
  externalChatId: string;
  externalUserId?: string;
  externalThreadId?: string;
  source: "app_home_opened" | "manual";
  title?: string;
  prompts?: SlackAssistantSuggestedPrompt[];
  agentContext?: SlackAgentContextSummary;
}): ExternalMessageOutboxRecord {
  const outbound = buildSlackAssistantSuggestedPromptsOutboundMessage({
    targetExternalChatId: input.externalChatId,
    targetExternalThreadId: input.externalThreadId,
    title: input.title ?? "Suggested prompts",
    prompts: input.prompts,
    agentId: input.integration.agentId,
  });
  return enqueueExternalOutboundMessageSync({
    context: {
      workspaceId: input.workspaceId,
      integrationId: input.integration.id,
      provider: SLACK_PROVIDER_ID,
    },
    outbound,
    metadataJson: {
      ...buildSlackQueuedOutboxMetadata({
        source: "assistant_suggested_prompts",
        outbound,
        integration: input.integration,
      }),
      assistantMethod: "assistant.threads.setSuggestedPrompts",
      promptSource: input.source,
      externalUserReference: formatSlackOutboundReference(input.externalUserId),
      agentContext: input.agentContext,
    },
  });
}

export function queueSlackChannelReplyOutboxSync(input: {
  workspaceId: string;
  channelName: string;
  agentId?: string;
  text: string;
  attachments?: MessageAttachment[];
  agentSpaceMessageId?: string;
  sourceAgentSpaceMessageId?: string;
}): ExternalMessageOutboxRecord[] {
  const candidates = listSlackOutboundIntegrationCandidatesSync({
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    sourceAgentSpaceMessageId: input.sourceAgentSpaceMessageId,
  });
  const outboxItems: ExternalMessageOutboxRecord[] = [];

  for (const { integration, sourceMapping } of candidates) {
    const channelBinding = selectSlackOutboundChannelBindingForReply({
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
    const outbound = buildSlackTextOutboundMessage({
      targetExternalChatId: channelBinding.externalChatId,
      targetExternalThreadId: resolveSlackReplyTargetExternalMessageId(sourceMapping),
      text: appendSlackAttachmentNotice(input.text, input.attachments),
    });
    outboxItems.push(enqueueExternalOutboundMessageSync({
      context: {
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        provider: SLACK_PROVIDER_ID,
      },
      channelBindingId: channelBinding.id,
      agentSpaceMessageId: input.agentSpaceMessageId,
      outbound,
      metadataJson: buildSlackQueuedOutboxMetadata({
        source: "agent_reply",
        outbound,
        integration,
        attachmentCount: countSendableSlackAttachments(input.attachments),
      }),
    }));
    const uploadOutbox = queueSlackFileUploadOutboxSync({
      context: {
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        provider: SLACK_PROVIDER_ID,
      },
      integration,
      channelBindingId: channelBinding.id,
      agentSpaceMessageId: input.agentSpaceMessageId,
      targetExternalChatId: channelBinding.externalChatId,
      targetExternalThreadId: resolveSlackReplyTargetExternalMessageId(sourceMapping),
      attachments: input.attachments,
    });
    if (uploadOutbox) {
      outboxItems.push(uploadOutbox);
    }
  }

  return outboxItems;
}

export function queueSlackAgentStatusCardOutboxSync(input: {
  workspaceId: string;
  channelName: string;
  agentId?: string;
  status: SlackAgentStatusCardStatus;
  agentNames: string[];
  message?: string;
  taskId?: string;
  agentSpaceMessageId?: string;
  sourceAgentSpaceMessageId?: string;
  approvalAction?: SlackApprovalBlockActionPayload;
  actionUrl?: string | null;
  requireSourceMapping?: boolean;
}): ExternalMessageOutboxRecord[] {
  const candidates = listSlackOutboundIntegrationCandidatesSync({
    workspaceId: input.workspaceId,
    agentId: input.agentId ?? resolveSingleAgentName(input.agentNames),
    sourceAgentSpaceMessageId: input.sourceAgentSpaceMessageId,
    requireSourceMapping: input.requireSourceMapping,
  });
  const outboxItems: ExternalMessageOutboxRecord[] = [];

  for (const { integration, sourceMapping } of candidates) {
    const channelBinding = selectSlackOutboundChannelBindingForReply({
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
    const outbound = buildSlackAgentStatusCardOutboundMessage({
      targetExternalChatId: channelBinding.externalChatId,
      targetExternalThreadId: resolveSlackReplyTargetExternalMessageId(sourceMapping),
      status: input.status,
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
        provider: SLACK_PROVIDER_ID,
      },
      channelBindingId: channelBinding.id,
      agentSpaceMessageId: input.agentSpaceMessageId,
      outbound,
      metadataJson: buildSlackQueuedOutboxMetadata({
        source: "agent_status_card",
        outbound,
        integration,
      }),
    }));
  }

  return outboxItems;
}

export async function drainSlackOutboxMessages(input: {
  workspaceId: string;
  integrationId?: string;
  lockedBy: string;
  limit?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<SlackOutboxDrainResult> {
  const items = listPendingExternalMessageOutboxSync({
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
    limit: input.limit,
  });
  const integrationIds = new Set<string>();
  const results: SlackOutboxDrainResult["results"] = [];
  const errors: SlackOutboxDrainResult["errors"] = [];

  for (const item of items) {
    const integration = readExternalIntegrationSync({
      workspaceId: input.workspaceId,
      integrationId: item.integrationId,
    });
    if (!integration || integration.provider !== SLACK_PROVIDER_ID || integration.status !== "active") {
      continue;
    }
    integrationIds.add(integration.id);
    try {
      const result = await processSlackOutboxMessage({
        workspaceId: input.workspaceId,
        outbox: item,
        integration,
        lockedBy: input.lockedBy,
        baseUrl: input.baseUrl,
        fetchImpl: input.fetchImpl,
      });
      results.push({
        integrationId: integration.id,
        outboxId: result.outboxId,
        status: result.status,
        externalMessageId: result.externalMessageId,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        retryable: result.retryable,
        terminal: result.terminal,
        nextAttemptAt: result.nextAttemptAt,
      });
    } catch (error) {
      errors.push({
        integrationId: integration.id,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
    integrationCount: integrationIds.size,
    processedCount: results.length,
    sentCount: results.filter((result) => result.status === "sent").length,
    failedCount: results.filter((result) => result.status === "failed").length,
    results,
    errors,
  };
}

export async function processSlackOutboxMessage(input: {
  workspaceId: string;
  outbox: ExternalMessageOutboxRecord;
  integration: ExternalIntegrationRecord;
  lockedBy: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<SlackOutboxProcessResult> {
  const locked = markExternalMessageOutboxLockedSync({
    workspaceId: input.workspaceId,
    outboxId: input.outbox.id,
    lockedBy: input.lockedBy,
  });
  const credentials = readSlackIntegrationCredentials(input.integration);
  const payload = readSlackOutboundPayload(locked.payloadJson);
  if (isSlackFileUploadPayload(payload)) {
    const response = await sendSlackFileUploadExternal({
      botToken: credentials.botToken,
      payload,
      baseUrl: input.baseUrl,
      fetchImpl: input.fetchImpl,
    });
    if (response.ok) {
      completeExternalMessageOutboxSync({
        workspaceId: input.workspaceId,
        outboxId: locked.id,
      });
      createExternalMessageMappingSync({
        workspaceId: input.workspaceId,
        integrationId: input.integration.id,
        channelBindingId: locked.channelBindingId,
        direction: "outbound",
        externalMessageId: `slack-file-upload-${locked.id}`,
        externalThreadId: payload.thread_ts,
        agentSpaceMessageId: locked.agentSpaceMessageId,
        metadataJson: {
          provider: SLACK_PROVIDER_ID,
          mappingSource: "slack_file_upload",
          outboxSource: "slack_file_upload",
          slackUploadFlow: "external_upload",
          method: "files.completeUploadExternal",
          externalChatReference: formatSlackOutboundReference(payload.channel_id),
          externalThreadReference: formatSlackOutboundReference(payload.thread_ts),
          files: buildSlackFileUploadEvidenceMetadata(payload.files, response.fileRefs),
          rawSlackFileIdStored: false,
        },
      });
      return {
        outboxId: locked.id,
        status: "sent",
      };
    }
    return failSlackOutboxWithResponse({
      workspaceId: input.workspaceId,
      locked,
      response,
      defaultErrorMessage: "Slack file upload failed.",
    });
  }
  if (isSlackAssistantSuggestedPromptsPayload(payload)) {
    const response = await sendSlackAssistantSuggestedPrompts({
      botToken: credentials.botToken,
      payload,
      baseUrl: input.baseUrl,
      fetchImpl: input.fetchImpl,
    });
    if (response.ok) {
      completeExternalMessageOutboxSync({
        workspaceId: input.workspaceId,
        outboxId: locked.id,
      });
      return {
        outboxId: locked.id,
        status: "sent",
      };
    }
    return failSlackOutboxWithResponse({
      workspaceId: input.workspaceId,
      locked,
      response,
      defaultErrorMessage: "Slack assistant.threads.setSuggestedPrompts failed.",
    });
  }
  const response = await sendSlackChatPostMessage({
    botToken: credentials.botToken,
    payload,
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
  });
  if (response.ok && response.ts) {
    completeExternalMessageOutboxSync({
      workspaceId: input.workspaceId,
      outboxId: locked.id,
    });
    createExternalMessageMappingSync({
      workspaceId: input.workspaceId,
      integrationId: input.integration.id,
      channelBindingId: locked.channelBindingId,
      direction: "outbound",
      externalMessageId: response.ts,
      externalThreadId: payload.thread_ts,
      agentSpaceMessageId: locked.agentSpaceMessageId,
      metadataJson: {
        provider: SLACK_PROVIDER_ID,
        externalChatReference: formatSlackOutboundReference(response.channel ?? payload.channel),
        externalThreadReference: formatSlackOutboundReference(payload.thread_ts),
        externalChatIdRedacted: true,
      },
    });
    return {
      outboxId: locked.id,
      status: "sent",
      externalMessageId: response.ts,
    };
  }

  return failSlackOutboxWithResponse({
    workspaceId: input.workspaceId,
    locked,
    response,
    defaultErrorMessage: "Slack outbound message failed.",
  });
}

export async function sendSlackChatPostMessage(input: {
  botToken: string;
  payload: SlackChatPostMessagePayload;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<SlackApiPostMessageResult> {
  const botToken = input.botToken.trim();
  if (!botToken) {
    return {
      ok: false,
      status: 0,
      errorCode: "slack.bot_token_missing",
      errorMessage: "Slack bot token is missing.",
    };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${input.baseUrl ?? "https://slack.com/api"}/chat.postMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(input.payload),
  });
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "");
    return {
      ok: false,
      status: response.status,
      errorCode: "slack.rate_limited",
      errorMessage: "Slack rate limited chat.postMessage.",
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    };
  }
  let data: Record<string, unknown> = {};
  try {
    data = await response.json() as Record<string, unknown>;
  } catch {
    data = {};
  }
  if (response.ok && data.ok === true) {
    return {
      ok: true,
      status: response.status,
      channel: typeof data.channel === "string" ? data.channel : undefined,
      ts: typeof data.ts === "string" ? data.ts : undefined,
    };
  }
  const errorCode = typeof data.error === "string" ? data.error : `http_${response.status}`;
  return {
    ok: false,
    status: response.status,
    errorCode,
    errorMessage: `Slack chat.postMessage failed: ${errorCode}`,
  };
}

export async function sendSlackAssistantSuggestedPrompts(input: {
  botToken: string;
  payload: SlackAssistantSuggestedPromptsPayload;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<SlackApiMethodResult> {
  const botToken = input.botToken.trim();
  if (!botToken) {
    return {
      ok: false,
      status: 0,
      errorCode: "slack.bot_token_missing",
      errorMessage: "Slack bot token is missing.",
    };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = {
    channel_id: input.payload.channel_id,
    prompts: input.payload.prompts,
    ...(input.payload.title ? { title: input.payload.title } : {}),
    ...(input.payload.thread_ts ? { thread_ts: input.payload.thread_ts } : {}),
  };
  const response = await fetchImpl(`${input.baseUrl ?? "https://slack.com/api"}/assistant.threads.setSuggestedPrompts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "");
    return {
      ok: false,
      status: response.status,
      errorCode: "slack.rate_limited",
      errorMessage: "Slack rate limited assistant.threads.setSuggestedPrompts.",
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    };
  }
  let data: Record<string, unknown> = {};
  try {
    data = await response.json() as Record<string, unknown>;
  } catch {
    data = {};
  }
  if (response.ok && data.ok === true) {
    return {
      ok: true,
      status: response.status,
    };
  }
  const errorCode = typeof data.error === "string" ? data.error : `http_${response.status}`;
  return {
    ok: false,
    status: response.status,
    errorCode,
    errorMessage: `Slack assistant.threads.setSuggestedPrompts failed: ${errorCode}`,
  };
}

export async function sendSlackFileUploadExternal(input: {
  botToken: string;
  payload: SlackFileUploadOutboundPayload;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<SlackApiFileUploadResult> {
  const botToken = input.botToken.trim();
  if (!botToken) {
    return {
      ok: false,
      status: 0,
      errorCode: "slack.bot_token_missing",
      errorMessage: "Slack bot token is missing.",
    };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const uploadedFiles: Array<{ fileId: string; title: string }> = [];
  for (const file of input.payload.files) {
    const content = readSlackFileUploadContent(file);
    if (!content.ok) {
      return content;
    }
    const ticket = await requestSlackFileUploadUrl({
      botToken,
      filename: file.filename,
      length: content.bytes.byteLength,
      baseUrl: input.baseUrl,
      fetchImpl,
    });
    if (!ticket.ok) {
      return ticket;
    }
    const uploaded = await uploadSlackFileBytes({
      uploadUrl: ticket.uploadUrl,
      bytes: content.bytes,
      mediaType: file.mediaType,
      fetchImpl,
    });
    if (!uploaded.ok) {
      return uploaded;
    }
    uploadedFiles.push({
      fileId: ticket.fileId,
      title: file.title,
    });
  }

  const completed = await completeSlackFileUploadExternal({
    botToken,
    channelId: input.payload.channel_id,
    files: uploadedFiles,
    initialComment: input.payload.initial_comment,
    threadTs: input.payload.thread_ts,
    baseUrl: input.baseUrl,
    fetchImpl,
  });
  if (!completed.ok) {
    return completed;
  }
  return {
    ...completed,
    fileRefs: uploadedFiles.map((file) => formatSlackOutboundReference(file.fileId)).filter((ref): ref is string => Boolean(ref)),
  };
}

async function requestSlackFileUploadUrl(input: {
  botToken: string;
  filename: string;
  length: number;
  baseUrl?: string;
  fetchImpl: typeof fetch;
}): Promise<SlackApiMethodResult & { uploadUrl: string; fileId: string }> {
  const response = await input.fetchImpl(`${input.baseUrl ?? "https://slack.com/api"}/files.getUploadURLExternal`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.botToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      filename: input.filename,
      length: input.length,
    }),
  });
  const rateLimited = readSlackRateLimitedResponse(response, "files.getUploadURLExternal");
  if (rateLimited) {
    return { ...rateLimited, uploadUrl: "", fileId: "" };
  }
  const data = await readSlackJsonResponse(response);
  if (response.ok && data.ok === true && typeof data.upload_url === "string" && typeof data.file_id === "string") {
    return {
      ok: true,
      status: response.status,
      uploadUrl: data.upload_url,
      fileId: data.file_id,
    };
  }
  const errorCode = typeof data.error === "string" ? data.error : `http_${response.status}`;
  return {
    ok: false,
    status: response.status,
    errorCode,
    errorMessage: `Slack files.getUploadURLExternal failed: ${errorCode}`,
    uploadUrl: "",
    fileId: "",
  };
}

async function uploadSlackFileBytes(input: {
  uploadUrl: string;
  bytes: Uint8Array;
  mediaType?: string;
  fetchImpl: typeof fetch;
}): Promise<SlackApiMethodResult> {
  const body = input.bytes.buffer.slice(
    input.bytes.byteOffset,
    input.bytes.byteOffset + input.bytes.byteLength,
  ) as ArrayBuffer;
  const response = await input.fetchImpl(input.uploadUrl, {
    method: "POST",
    headers: {
      "content-type": input.mediaType || "application/octet-stream",
      "content-length": String(input.bytes.byteLength),
    },
    body,
  });
  const rateLimited = readSlackRateLimitedResponse(response, "file_upload_url");
  if (rateLimited) {
    return rateLimited;
  }
  if (response.ok) {
    return {
      ok: true,
      status: response.status,
    };
  }
  return {
    ok: false,
    status: response.status,
    errorCode: `slack.file_upload_http_${response.status}`,
    errorMessage: `Slack file upload URL returned HTTP ${response.status}.`,
  };
}

async function completeSlackFileUploadExternal(input: {
  botToken: string;
  channelId: string;
  files: Array<{ fileId: string; title: string }>;
  initialComment?: string;
  threadTs?: string;
  baseUrl?: string;
  fetchImpl: typeof fetch;
}): Promise<SlackApiMethodResult> {
  const response = await input.fetchImpl(`${input.baseUrl ?? "https://slack.com/api"}/files.completeUploadExternal`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.botToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel_id: input.channelId,
      files: input.files.map((file) => ({
        id: file.fileId,
        title: file.title,
      })),
      ...(input.initialComment ? { initial_comment: input.initialComment } : {}),
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
    }),
  });
  const rateLimited = readSlackRateLimitedResponse(response, "files.completeUploadExternal");
  if (rateLimited) {
    return rateLimited;
  }
  const data = await readSlackJsonResponse(response);
  if (response.ok && data.ok === true) {
    return {
      ok: true,
      status: response.status,
    };
  }
  const errorCode = typeof data.error === "string" ? data.error : `http_${response.status}`;
  return {
    ok: false,
    status: response.status,
    errorCode,
    errorMessage: `Slack files.completeUploadExternal failed: ${errorCode}`,
  };
}

function readSlackFileUploadContent(file: SlackFileUploadItem): SlackApiMethodResult & { bytes: Uint8Array } {
  if (!file.storedPath || !existsSync(file.storedPath)) {
    return {
      ok: false,
      status: 400,
      errorCode: "slack.file_unreadable",
      errorMessage: "Slack file upload source attachment is not readable from local storage.",
      bytes: new Uint8Array(),
    };
  }
  try {
    const bytes = readFileSync(file.storedPath);
    if (bytes.byteLength <= 0) {
      return {
        ok: false,
        status: 400,
        errorCode: "slack.file_empty",
        errorMessage: "Slack file upload source attachment is empty.",
        bytes: new Uint8Array(),
      };
    }
    return {
      ok: true,
      status: 0,
      bytes,
    };
  } catch {
    return {
      ok: false,
      status: 400,
      errorCode: "slack.file_unreadable",
      errorMessage: "Slack file upload source attachment is not readable from local storage.",
      bytes: new Uint8Array(),
    };
  }
}

function readSlackRateLimitedResponse(response: Response, method: string): SlackApiMethodResult | null {
  if (response.status !== 429) {
    return null;
  }
  const retryAfter = Number(response.headers.get("retry-after") ?? "");
  return {
    ok: false,
    status: response.status,
    errorCode: "slack.rate_limited",
    errorMessage: `Slack rate limited ${method}.`,
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  };
}

async function readSlackJsonResponse(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function computeSlackOutboxNextAttemptAt(retryAfterSeconds = 60): string {
  return new Date(Date.now() + Math.max(1, retryAfterSeconds) * 1000).toISOString();
}

function readSlackOutboundPayload(value: string): SlackOutboundApiPayload {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  if (parsed.method === "files.completeUploadExternal") {
    return readSlackFileUploadPayload(parsed);
  }
  if (parsed.method === "assistant.threads.setSuggestedPrompts") {
    return readSlackAssistantSuggestedPromptsPayload(parsed);
  }
  const channel = typeof parsed.channel === "string" ? parsed.channel.trim() : "";
  const text = typeof parsed.text === "string" ? parsed.text : "";
  const threadTs = typeof parsed.thread_ts === "string" ? parsed.thread_ts.trim() : undefined;
  const blocks = readSlackBlocks(parsed.blocks);
  if (!channel || !text.trim()) {
    throw new Error("slack.outbound_payload_invalid");
  }
  return {
    channel,
    text: truncateSlackText(text),
    ...(blocks ? { blocks, unfurl_links: false, unfurl_media: false } : {}),
    ...(threadTs ? { thread_ts: threadTs } : {}),
  };
}

function readSlackFileUploadPayload(parsed: Record<string, unknown>): SlackFileUploadOutboundPayload {
  const channelId = typeof parsed.channel_id === "string" ? parsed.channel_id.trim() : "";
  const threadTs = typeof parsed.thread_ts === "string" ? parsed.thread_ts.trim() : undefined;
  const initialComment = typeof parsed.initial_comment === "string" ? parsed.initial_comment.trim() : undefined;
  const files = Array.isArray(parsed.files)
    ? parsed.files.flatMap((file): SlackFileUploadItem[] => {
        if (!file || typeof file !== "object" || Array.isArray(file)) {
          return [];
        }
        const record = file as Record<string, unknown>;
        const attachmentId = readString(record.attachmentId);
        const filename = readString(record.filename);
        const storedPath = readString(record.storedPath);
        const sizeBytes = typeof record.sizeBytes === "number" && Number.isFinite(record.sizeBytes)
          ? record.sizeBytes
          : 0;
        if (!attachmentId || !filename || !storedPath || sizeBytes <= 0) {
          return [];
        }
        return [{
          attachmentId,
          filename,
          title: readString(record.title) ?? filename,
          storedPath,
          sizeBytes,
          mediaType: readString(record.mediaType),
        }];
      })
    : [];
  if (!channelId || files.length === 0) {
    throw new Error("slack.file_upload_payload_invalid");
  }
  return {
    method: "files.completeUploadExternal",
    channel_id: channelId,
    files,
    ...(initialComment ? { initial_comment: truncateSlackText(initialComment) } : {}),
    ...(threadTs ? { thread_ts: threadTs } : {}),
  };
}

function readSlackAssistantSuggestedPromptsPayload(
  parsed: Record<string, unknown>,
): SlackAssistantSuggestedPromptsPayload {
  const channelId = typeof parsed.channel_id === "string" ? parsed.channel_id.trim() : "";
  const threadTs = typeof parsed.thread_ts === "string" ? parsed.thread_ts.trim() : undefined;
  const title = typeof parsed.title === "string" ? parsed.title.trim() : undefined;
  const prompts = normalizeSlackAssistantSuggestedPrompts(Array.isArray(parsed.prompts)
    ? parsed.prompts.flatMap((prompt): SlackAssistantSuggestedPrompt[] => {
        if (!prompt || typeof prompt !== "object" || Array.isArray(prompt)) {
          return [];
        }
        const record = prompt as Record<string, unknown>;
        return typeof record.title === "string" && typeof record.message === "string"
          ? [{ title: record.title, message: record.message }]
          : [];
      })
    : undefined);
  if (!channelId || prompts.length === 0) {
    throw new Error("slack.assistant_suggested_prompts_payload_invalid");
  }
  return {
    method: "assistant.threads.setSuggestedPrompts",
    channel_id: channelId,
    prompts,
    ...(title ? { title: truncateSlackBlockText(title) } : {}),
    ...(threadTs ? { thread_ts: threadTs } : {}),
  };
}

function isSlackAssistantSuggestedPromptsPayload(
  payload: SlackOutboundApiPayload,
): payload is SlackAssistantSuggestedPromptsPayload {
  return "method" in payload && payload.method === "assistant.threads.setSuggestedPrompts";
}

function isSlackFileUploadPayload(
  payload: SlackOutboundApiPayload,
): payload is SlackFileUploadOutboundPayload {
  return "method" in payload && payload.method === "files.completeUploadExternal";
}

function buildSlackQueuedOutboxMetadata(input: {
  source:
    | "direct_outbound_message"
    | "agent_reply"
    | "agent_status_card"
    | "app_home_opened_welcome"
    | "assistant_suggested_prompts"
    | "slack_file_upload";
  outbound: Pick<ExternalOutboundMessagePayload, "targetExternalChatId" | "targetExternalThreadId">;
  integration?: Pick<ExternalIntegrationRecord, "id" | "agentId"> | null;
  attachmentCount?: number;
}): Record<string, unknown> {
  const agentId = readString(input.integration?.agentId);
  return {
    provider: SLACK_PROVIDER_ID,
    outboxSource: input.source,
    externalChatReference: formatSlackOutboundReference(input.outbound.targetExternalChatId),
    externalThreadReference: formatSlackOutboundReference(input.outbound.targetExternalThreadId),
    agentId,
    botBindingId: agentId ? input.integration?.id : undefined,
    attachmentsUploaded: input.source === "slack_file_upload" ? undefined : false,
    attachmentCount: input.attachmentCount && input.attachmentCount > 0 ? input.attachmentCount : undefined,
  };
}

function buildSlackAppHomeOpenedWelcomeExternalMessageId(input: {
  externalChatId: string;
  externalUserId: string;
}): string {
  return `slack-app-home-welcome-${buildSlackReference(`${input.externalChatId}:${input.externalUserId}`).slice(4)}`;
}

function normalizeSlackAssistantSuggestedPrompts(
  prompts: SlackAssistantSuggestedPrompt[] | undefined,
  agentId?: string | null,
): SlackAssistantSuggestedPrompt[] {
  const agentLabel = readString(agentId) ?? "AgentSpace";
  const source = prompts && prompts.length > 0
    ? prompts
    : [
        {
          title: "Plan next steps",
          message: `Ask ${agentLabel} to turn this request into concrete next actions.`,
        },
        {
          title: "Summarize context",
          message: `Ask ${agentLabel} to summarize the relevant AgentSpace context.`,
        },
        {
          title: "Review approvals",
          message: `Ask ${agentLabel} what approvals or human decisions are still needed.`,
        },
      ];
  return source.map((prompt) => ({
    title: truncateSlackBlockText(prompt.title.trim()).slice(0, 75).trimEnd(),
    message: truncateSlackBlockText(prompt.message.trim()),
  })).filter((prompt) => prompt.title && prompt.message).slice(0, 4);
}

function failSlackOutboxWithResponse(input: {
  workspaceId: string;
  locked: ExternalMessageOutboxRecord;
  response: SlackApiMethodResult;
  defaultErrorMessage: string;
}): SlackOutboxProcessResult {
  const retryable = isSlackOutboundErrorRetryable(input.response);
  const terminal = !retryable || input.locked.attempts >= SLACK_OUTBOX_MAX_ATTEMPTS;
  const nextAttemptAt = retryable && !terminal
    ? computeSlackOutboxNextAttemptAt(input.response.retryAfterSeconds)
    : undefined;
  failExternalMessageOutboxSync({
    workspaceId: input.workspaceId,
    outboxId: input.locked.id,
    lastError: input.response.errorMessage ?? input.response.errorCode ?? input.defaultErrorMessage,
    nextAttemptAt,
    terminal,
  });
  return {
    outboxId: input.locked.id,
    status: "failed",
    errorCode: input.response.errorCode,
    errorMessage: input.response.errorMessage,
    retryable,
    terminal,
    nextAttemptAt,
  };
}

interface SlackOutboundIntegrationCandidate {
  integration: ExternalIntegrationRecord;
  sourceMapping?: ExternalMessageMappingRecord | null;
}

function listSlackOutboundIntegrationCandidatesSync(input: {
  workspaceId: string;
  agentId?: string;
  sourceAgentSpaceMessageId?: string;
  requireSourceMapping?: boolean;
}): SlackOutboundIntegrationCandidate[] {
  const sourceAgentSpaceMessageId = input.sourceAgentSpaceMessageId?.trim();
  if (sourceAgentSpaceMessageId) {
    const sourceMapped = resolveSlackSourceMappedOutboundIntegrationSync({
      workspaceId: input.workspaceId,
      sourceAgentSpaceMessageId,
    });
    if (sourceMapped) {
      return sourceMapped.integration.status === "active" ? [sourceMapped] : [];
    }
    if (input.requireSourceMapping) {
      return [];
    }
  } else if (input.requireSourceMapping) {
    return [];
  }

  return listActiveSlackOutboundIntegrationsSync({
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

function resolveSlackSourceMappedOutboundIntegrationSync(input: {
  workspaceId: string;
  sourceAgentSpaceMessageId: string;
}): SlackOutboundIntegrationCandidate | null {
  for (const integration of listExternalIntegrationsSync({
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
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

function listActiveSlackOutboundIntegrationsSync(input: {
  workspaceId: string;
  agentId?: string;
}): ExternalIntegrationRecord[] {
  const agentId = input.agentId?.trim();
  if (agentId) {
    const agentIntegrations = listExternalIntegrationsSync({
      workspaceId: input.workspaceId,
      provider: SLACK_PROVIDER_ID,
      agentId,
    }).filter((integration) => integration.status === "active");
    if (agentIntegrations.length > 0) {
      return agentIntegrations;
    }
  }

  return listExternalIntegrationsSync({
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
    scope: "workspace",
  }).filter((integration) => integration.status === "active");
}

export function resolveSlackReplyTargetExternalMessageId(
  sourceMapping: { externalThreadId?: string; externalMessageId?: string } | null | undefined,
): string | undefined {
  return sourceMapping?.externalThreadId?.trim()
    || sourceMapping?.externalMessageId?.trim()
    || undefined;
}

export function selectSlackOutboundChannelBindingForReply<T extends {
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

function resolveSingleAgentName(agentNames: string[]): string | undefined {
  const normalized = agentNames.map((name) => name.trim()).filter(Boolean);
  return normalized.length === 1 ? normalized[0] : undefined;
}

function buildSlackApprovalBlockActionValue(
  input: SlackApprovalBlockActionPayload,
  decision: "approved" | "rejected",
): string {
  return JSON.stringify({
    provider: SLACK_PROVIDER_ID,
    kind: "approval_review",
    approvalId: input.approvalId,
    decision,
    payloadHash: input.payloadHash,
    token: input.token,
  });
}

function resolveSlackAgentStatusCardView(status: SlackAgentStatusCardStatus): {
  label: string;
  context: string;
} {
  switch (status) {
    case "thinking":
      return { label: "Working", context: "Task is running" };
    case "complete":
      return { label: "Complete", context: "Task finished" };
    case "failed":
      return { label: "Failed", context: "Task needs attention" };
    case "approval_required":
      return { label: "Approval required", context: "Review required" };
  }
}

function normalizeSlackFileUploadItems(attachments: MessageAttachment[]): SlackFileUploadItem[] {
  return attachments
    .filter(isSendableSlackAttachment)
    .map((attachment) => ({
      attachmentId: attachment.id,
      filename: truncateSlackFileName(attachment.fileName || "attachment"),
      title: truncateSlackFileName(attachment.fileName || "attachment"),
      mediaType: attachment.mediaType,
      sizeBytes: attachment.sizeBytes,
      storedPath: attachment.storedPath,
    }))
    .filter((file) => file.attachmentId && file.filename && file.storedPath && file.sizeBytes > 0)
    .slice(0, 10);
}

function buildSlackQueuedFileUploadMetadata(files: SlackFileUploadItem[]): Array<Record<string, unknown>> {
  return files.map((file) => ({
    attachmentId: file.attachmentId,
    fileName: file.filename,
    mediaType: file.mediaType,
    sizeBytes: file.sizeBytes,
    uploadStatus: "pending",
    rawSlackFileIdStored: false,
  }));
}

function buildSlackFileUploadEvidenceMetadata(
  files: SlackFileUploadItem[],
  fileRefs: string[] | undefined,
): Array<Record<string, unknown>> {
  return files.map((file, index) => ({
    attachmentId: file.attachmentId,
    fileName: file.filename,
    mediaType: file.mediaType,
    sizeBytes: file.sizeBytes,
    fileRef: fileRefs?.[index],
    uploadStatus: "sent",
    rawSlackFileIdStored: false,
  }));
}

function appendSlackAttachmentNotice(text: string, attachments: MessageAttachment[] | undefined): string {
  const count = countSendableSlackAttachments(attachments);
  if (count <= 0) {
    return text;
  }
  const suffix = count === 1
    ? "[1 attachment will be uploaded to Slack separately.]"
    : `[${count} attachments will be uploaded to Slack separately.]`;
  return [text, suffix].filter((part) => part.trim()).join("\n\n");
}

function countSendableSlackAttachments(attachments: MessageAttachment[] | undefined): number {
  return (attachments ?? []).filter(isSendableSlackAttachment).length;
}

function isSendableSlackAttachment(attachment: MessageAttachment): boolean {
  return !attachment.deletedAt &&
    Boolean(attachment.id) &&
    Boolean(attachment.storedPath) &&
    attachment.sizeBytes > 0;
}

function readSlackBlocks(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const blocks = value.filter((item): item is Record<string, unknown> =>
    typeof item === "object" && item !== null && !Array.isArray(item));
  return blocks.length > 0 ? blocks : undefined;
}

function truncateSlackText(text: string): string {
  return text.length > SLACK_TEXT_MESSAGE_MAX_CHARS
    ? `${text.slice(0, SLACK_TEXT_MESSAGE_MAX_CHARS - 30)}\n\n[truncated by AgentSpace]`
    : text;
}

function truncateSlackBlockText(text: string): string {
  return text.length > 2800
    ? `${text.slice(0, 2769)}\n\n[truncated by AgentSpace]`
    : text;
}

function truncateSlackFileName(value: string): string {
  const trimmed = value.trim() || "attachment";
  return trimmed.length > 255 ? trimmed.slice(0, 255).trimEnd() : trimmed;
}

function escapeSlackMrkdwn(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function formatSlackOutboundReference(value: string | undefined): string | undefined {
  return value ? buildSlackReference(value) : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isSlackOutboundErrorRetryable(response: SlackApiMethodResult): boolean {
  if (response.status === 429 || response.status >= 500 || response.status === 0) {
    return true;
  }
  return response.errorCode === "ratelimited" ||
    response.errorCode === "fatal_error" ||
    response.errorCode === "internal_error";
}
