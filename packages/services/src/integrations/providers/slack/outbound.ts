import {
  completeExternalMessageOutboxSync,
  createExternalMessageMappingSync,
  failExternalMessageOutboxSync,
  listPendingExternalMessageOutboxSync,
  markExternalMessageOutboxLockedSync,
  readExternalIntegrationSync,
  type ExternalIntegrationRecord,
  type ExternalMessageOutboxRecord,
} from "@agent-space/db";
import type { ExternalOutboundMessagePayload } from "../../core/index.ts";
import { SLACK_OUTBOX_MAX_ATTEMPTS, SLACK_PROVIDER_ID, SLACK_TEXT_MESSAGE_MAX_CHARS } from "./constants.ts";
import { readSlackIntegrationCredentials } from "./credentials.ts";

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

export interface SlackTextOutboundPayload extends Record<string, unknown> {
  channel: string;
  text: string;
  thread_ts?: string;
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
        channel: response.channel ?? payload.channel,
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
  payload: SlackTextOutboundPayload;
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

function readSlackOutboundPayload(value: string): SlackTextOutboundPayload {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  const channel = typeof parsed.channel === "string" ? parsed.channel.trim() : "";
  const text = typeof parsed.text === "string" ? parsed.text : "";
  const threadTs = typeof parsed.thread_ts === "string" ? parsed.thread_ts.trim() : undefined;
  if (!channel || !text.trim()) {
    throw new Error("slack.outbound_payload_invalid");
  }
  return {
    channel,
    text: truncateSlackText(text),
    ...(threadTs ? { thread_ts: threadTs } : {}),
  };
}

function truncateSlackText(text: string): string {
  return text.length > SLACK_TEXT_MESSAGE_MAX_CHARS
    ? `${text.slice(0, SLACK_TEXT_MESSAGE_MAX_CHARS - 30)}\n\n[truncated by AgentSpace]`
    : text;
}

function isSlackOutboundErrorRetryable(response: SlackApiPostMessageResult): boolean {
  if (response.status === 429 || response.status >= 500 || response.status === 0) {
    return true;
  }
  return response.errorCode === "ratelimited" ||
    response.errorCode === "fatal_error" ||
    response.errorCode === "internal_error";
}
