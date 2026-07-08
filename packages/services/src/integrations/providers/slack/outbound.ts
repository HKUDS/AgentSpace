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

export interface SlackApiPostMessageResult {
  ok: boolean;
  channel?: string;
  ts?: string;
  errorCode?: string;
  errorMessage?: string;
  retryAfterSeconds?: number;
  status: number;
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
  return enqueueExternalOutboundMessageSync({
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
  return { status: "queued", outbox, mapping };
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

  const retryable = isSlackOutboundErrorRetryable(response);
  const terminal = !retryable || locked.attempts >= SLACK_OUTBOX_MAX_ATTEMPTS;
  const nextAttemptAt = retryable && !terminal
    ? computeSlackOutboxNextAttemptAt(response.retryAfterSeconds)
    : undefined;
  failExternalMessageOutboxSync({
    workspaceId: input.workspaceId,
    outboxId: locked.id,
    lastError: response.errorMessage ?? response.errorCode ?? "Slack outbound message failed.",
    nextAttemptAt,
    terminal,
  });
  return {
    outboxId: locked.id,
    status: "failed",
    errorCode: response.errorCode,
    errorMessage: response.errorMessage,
    retryable,
    terminal,
    nextAttemptAt,
  };
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

export function computeSlackOutboxNextAttemptAt(retryAfterSeconds = 60): string {
  return new Date(Date.now() + Math.max(1, retryAfterSeconds) * 1000).toISOString();
}

function readSlackOutboundPayload(value: string): SlackChatPostMessagePayload {
  const parsed = JSON.parse(value) as Record<string, unknown>;
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

function buildSlackQueuedOutboxMetadata(input: {
  source: "direct_outbound_message" | "agent_reply" | "agent_status_card" | "app_home_opened_welcome";
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
    attachmentsUploaded: false,
    attachmentCount: input.attachmentCount && input.attachmentCount > 0 ? input.attachmentCount : undefined,
  };
}

function buildSlackAppHomeOpenedWelcomeExternalMessageId(input: {
  externalChatId: string;
  externalUserId: string;
}): string {
  return `slack-app-home-welcome-${buildSlackReference(`${input.externalChatId}:${input.externalUserId}`).slice(4)}`;
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

function appendSlackAttachmentNotice(text: string, attachments: MessageAttachment[] | undefined): string {
  const count = countSendableSlackAttachments(attachments);
  if (count <= 0) {
    return text;
  }
  const suffix = count === 1
    ? "[1 attachment is available in AgentSpace. Slack file upload is not enabled for this integration yet.]"
    : `[${count} attachments are available in AgentSpace. Slack file upload is not enabled for this integration yet.]`;
  return [text, suffix].filter((part) => part.trim()).join("\n\n");
}

function countSendableSlackAttachments(attachments: MessageAttachment[] | undefined): number {
  return (attachments ?? []).filter((attachment) => !attachment.deletedAt).length;
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

function isSlackOutboundErrorRetryable(response: SlackApiPostMessageResult): boolean {
  if (response.status === 429 || response.status >= 500 || response.status === 0) {
    return true;
  }
  return response.errorCode === "ratelimited" ||
    response.errorCode === "fatal_error" ||
    response.errorCode === "internal_error";
}
