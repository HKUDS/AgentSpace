import type { ExternalMessageAttachment, ExternalMessageEnvelope, IntegrationRuntimeContext } from "../../core/index.ts";
import {
  asRecord,
  asString,
  buildSlackReference,
  resolveSlackEventId,
  resolveSlackEventReceivedAt,
  resolveSlackEventType,
  summarizeSlackInboundFilesPayload,
  summarizeSlackInboundEventPayload,
  type SlackInboundFileSummary,
} from "./events.ts";
import { SLACK_PROVIDER_ID } from "./constants.ts";

export interface NormalizeSlackInboundMessageInput {
  context: IntegrationRuntimeContext;
  payload: Record<string, unknown>;
  botUserId?: string;
}

export function normalizeSlackInboundMessage(
  input: NormalizeSlackInboundMessageInput,
): ExternalMessageEnvelope | null {
  const event = asRecord(input.payload.event);
  if (!event || !isSupportedSlackMessageEvent(event, input.botUserId)) {
    return null;
  }
  const externalChatId = asString(event.channel);
  const externalMessageId = asString(event.ts);
  const externalSenderId = asString(event.user);
  const rawText = asString(event.text) ?? "";
  if (!externalChatId || !externalMessageId || !externalSenderId) {
    return null;
  }
  const text = cleanSlackMessageText({
    text: rawText,
    botUserId: input.botUserId,
    removeLeadingMention: event.type === "app_mention",
  });
  const attachments = summarizeSlackInboundFilesPayload(input.payload).map(buildSlackExternalMessageAttachment);
  const normalizedText = text || buildSlackInboundFileOnlyText(attachments);
  if (!normalizedText) {
    return null;
  }

  return {
    provider: SLACK_PROVIDER_ID,
    integrationId: input.context.integrationId,
    externalEventId: resolveSlackEventId(input.payload),
    eventType: resolveSlackEventType(input.payload),
    externalChatId,
    externalMessageId,
    externalThreadId: asString(event.thread_ts) ?? externalMessageId,
    externalSenderId,
    text: normalizedText,
    attachments,
    rawPayload: summarizeSlackInboundEventPayload(input.payload),
    receivedAt: resolveSlackEventReceivedAt(input.payload),
  };
}

export function ensureSlackAgentMentionText(input: {
  text: string;
  agentId?: string | null;
}): string {
  const text = input.text.trim();
  const agentId = input.agentId?.trim();
  if (!agentId) {
    return text;
  }
  const mentionPattern = new RegExp(`(^|\\s)@${escapeRegExp(agentId)}(?=\\s|$|[，。,.!?])`, "i");
  return mentionPattern.test(text) ? text : `@${agentId} ${text}`;
}

export function cleanSlackMessageText(input: {
  text: string;
  botUserId?: string;
  removeLeadingMention?: boolean;
}): string {
  let text = decodeSlackEntities(input.text);
  const botUserId = input.botUserId?.trim();
  if (botUserId) {
    text = text.replace(new RegExp(`<@${escapeRegExp(botUserId)}>\\s*`, "g"), "");
  } else if (input.removeLeadingMention) {
    text = text.replace(/^<@[A-Z0-9]+>\s*/i, "");
  }
  text = text.replace(/<@([A-Z0-9]+)>/gi, (_match, userId: string) =>
    `@slack-user-${buildSlackReference(userId)}`);
  text = text.replace(/<#([A-Z0-9]+)(?:\|([^>]+))?>/gi, (_match, channelId: string, label: string | undefined) =>
    label ? `#${label}` : `#slack-channel-${buildSlackReference(channelId)}`);
  text = text.replace(/<([^|>]+)\|([^>]+)>/g, (_match, url: string, label: string) =>
    `${label} (${url})`);
  text = text.replace(/<([^>]+)>/g, "$1");
  return text.replace(/\s+/g, " ").trim();
}

function isSupportedSlackMessageEvent(event: Record<string, unknown>, botUserId: string | undefined): boolean {
  const type = asString(event.type);
  if (type !== "app_mention" && type !== "message") {
    return false;
  }
  const subtype = asString(event.subtype);
  if ((subtype && subtype !== "file_share") || asString(event.bot_id) || event.hidden === true) {
    return false;
  }
  const senderId = asString(event.user);
  if (botUserId && senderId === botUserId) {
    return false;
  }
  if (type === "app_mention") {
    return true;
  }
  const channelType = asString(event.channel_type);
  if (channelType === "im") {
    return true;
  }
  const text = asString(event.text) ?? "";
  return Boolean(botUserId && text.includes(`<@${botUserId}>`));
}

function buildSlackExternalMessageAttachment(file: SlackInboundFileSummary): ExternalMessageAttachment {
  return {
    id: file.fileRef,
    fileName: file.displayName,
    mediaType: file.mediaType,
    sizeBytes: file.sizeBytes,
    metadata: {
      provider: SLACK_PROVIDER_ID,
      source: "slack_file_metadata",
      fileRef: file.fileRef,
      fileType: file.fileType,
      mode: file.mode,
      isExternal: file.isExternal,
      privateUrlRedacted: file.privateUrlRedacted,
      permalinkRedacted: file.permalinkRedacted,
      downloadStatus: "not_downloaded",
      rawSlackFileIdStored: false,
      privateUrlStored: false,
    },
  };
}

function buildSlackInboundFileOnlyText(attachments: ExternalMessageAttachment[]): string {
  if (attachments.length === 0) {
    return "";
  }
  const names = attachments
    .map((attachment) => attachment.fileName?.trim())
    .filter((name): name is string => Boolean(name))
    .slice(0, 3);
  const label = attachments.length === 1 ? "file" : "files";
  const suffix = names.length > 0 ? `: ${names.join(", ")}` : "";
  return `Shared ${attachments.length} Slack ${label}${suffix}. File contents have not been downloaded into AgentSpace yet.`;
}

function decodeSlackEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
