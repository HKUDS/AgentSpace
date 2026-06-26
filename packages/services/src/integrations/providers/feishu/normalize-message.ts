import type {
  ExternalMessageAttachment,
  ExternalMessageEnvelope,
  IntegrationRuntimeContext,
} from "../../core/index.ts";
import { FEISHU_PROVIDER_ID } from "./constants.ts";
import {
  asRecord,
  asString,
  resolveFeishuEventId,
  resolveFeishuEventReceivedAt,
  resolveFeishuEventType,
} from "./events.ts";

export interface FeishuChannelSdkResourceDescriptor {
  type?: string;
  fileKey?: string;
  fileName?: string;
  durationMs?: number;
  coverImageKey?: string;
}

export interface FeishuChannelSdkMentionInfo {
  key?: string;
  openId?: string;
  userId?: string;
  name?: string;
  isBot?: boolean;
}

export interface FeishuChannelSdkNormalizedMessage {
  messageId?: string;
  chatId?: string;
  chatType?: "p2p" | "group" | string;
  senderId?: string;
  senderName?: string;
  content?: string;
  rawContentType?: string;
  resources?: FeishuChannelSdkResourceDescriptor[];
  mentions?: FeishuChannelSdkMentionInfo[];
  mentionAll?: boolean;
  mentionedBot?: boolean;
  rootId?: string;
  threadId?: string;
  replyToMessageId?: string;
  createTime?: number;
  raw?: unknown;
}

export function normalizeFeishuInboundMessage(input: {
  context: IntegrationRuntimeContext;
  payload: Record<string, unknown>;
}): ExternalMessageEnvelope | null {
  const event = asRecord(input.payload.event);
  const message = asRecord(event?.message);
  if (!event || !message) {
    return null;
  }

  const externalChatId = asString(message.chat_id);
  const externalMessageId = asString(message.message_id);
  if (!externalChatId || !externalMessageId) {
    return null;
  }

  return {
    provider: FEISHU_PROVIDER_ID,
    integrationId: input.context.integrationId,
    externalEventId: resolveFeishuEventId(input.payload),
    eventType: resolveFeishuEventType(input.payload),
    externalChatId,
    externalMessageId,
    externalThreadId: asString(message.thread_id) ?? asString(message.root_id),
    externalSenderId: resolveFeishuSenderId(event),
    text: resolveFeishuMessageText(message),
    attachments: resolveFeishuMessageAttachments(message, externalMessageId),
    rawPayload: input.payload,
    receivedAt: resolveFeishuEventReceivedAt(input.payload),
  };
}

export function normalizeFeishuChannelSdkMessage(input: {
  context: IntegrationRuntimeContext;
  message: FeishuChannelSdkNormalizedMessage;
  eventType?: string;
  externalEventId?: string;
  rawPayload?: Record<string, unknown>;
  receivedAt?: string;
}): ExternalMessageEnvelope | null {
  const externalChatId = asString(input.message.chatId);
  const externalMessageId = asString(input.message.messageId);
  if (!externalChatId || !externalMessageId) {
    return null;
  }

  const externalEventId = input.externalEventId?.trim()
    || `feishu-channel:${externalMessageId}`;
  const eventType = input.eventType?.trim() || "im.message.receive_v1";

  return {
    provider: FEISHU_PROVIDER_ID,
    integrationId: input.context.integrationId,
    externalEventId,
    eventType,
    externalChatId,
    externalMessageId,
    externalThreadId: asString(input.message.threadId)
      ?? asString(input.message.rootId)
      ?? asString(input.message.replyToMessageId),
    externalSenderId: asString(input.message.senderId),
    text: resolveFeishuChannelSdkText(input.message),
    attachments: resolveFeishuChannelSdkAttachments(input.message.resources, externalMessageId),
    rawPayload: input.rawPayload ?? buildFeishuChannelSdkRawPayload({
      message: input.message,
      externalEventId,
      eventType,
    }),
    receivedAt: input.receivedAt ?? resolveFeishuChannelSdkReceivedAt(input.message.createTime),
  };
}

function resolveFeishuSenderId(event: Record<string, unknown>): string | undefined {
  const sender = asRecord(event.sender);
  const senderId = asRecord(sender?.sender_id);
  return asString(senderId?.open_id)
    ?? asString(senderId?.union_id)
    ?? asString(senderId?.user_id);
}

function resolveFeishuMessageText(message: Record<string, unknown>): string | undefined {
  const content = asString(message.content);
  if (!content) {
    return undefined;
  }
  try {
    const parsed = asRecord(JSON.parse(content));
    if (!parsed) {
      return normalizeFeishuText(content);
    }
    return normalizeFeishuText(resolveFeishuParsedMessageText(parsed) ?? content);
  } catch {
    return normalizeFeishuText(content);
  }
}

function resolveFeishuMessageAttachments(
  message: Record<string, unknown>,
  externalMessageId: string,
): ExternalMessageAttachment[] {
  const messageType = asString(message.message_type) ?? asString(message.msg_type);
  if (messageType !== "image" && messageType !== "file") {
    return [];
  }

  const content = parseFeishuMessageContentRecord(message);
  const resourceType = messageType;
  const fileKey = resourceType === "image"
    ? asString(content?.image_key) ?? asString(message.image_key)
    : asString(content?.file_key) ?? asString(message.file_key);
  if (!fileKey) {
    return [];
  }

  const mediaType = asString(content?.mime_type)
    ?? asString(content?.media_type)
    ?? asString(content?.content_type)
    ?? (resourceType === "image" ? "image/jpeg" : undefined);
  const fileName = asString(content?.file_name)
    ?? asString(content?.name)
    ?? asString(message.file_name)
    ?? defaultFeishuAttachmentFileName({ fileKey, mediaType, resourceType });
  const sizeBytes = resolveFeishuAttachmentSizeBytes(content ?? message);

  return [{
    id: `${externalMessageId}:${resourceType}:${fileKey}`,
    fileName,
    mediaType,
    sizeBytes,
    metadata: {
      provider: FEISHU_PROVIDER_ID,
      externalMessageId,
      resourceType,
      fileKey,
      resourceEndpoint: "im.message.resource",
    },
  }];
}

function parseFeishuMessageContentRecord(message: Record<string, unknown>): Record<string, unknown> | null {
  const content = asString(message.content);
  if (!content) {
    return null;
  }
  try {
    return asRecord(JSON.parse(content));
  } catch {
    return null;
  }
}

function resolveFeishuAttachmentSizeBytes(record: Record<string, unknown>): number | undefined {
  for (const key of ["file_size", "size", "size_bytes"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.floor(parsed);
      }
    }
  }
  return undefined;
}

function defaultFeishuAttachmentFileName(input: {
  fileKey: string;
  mediaType?: string;
  resourceType: "image" | "file";
}): string {
  const extension = input.resourceType === "image"
    ? extensionFromImageMediaType(input.mediaType)
    : ".bin";
  return `${input.fileKey}${extension}`;
}

function resolveFeishuChannelSdkText(message: FeishuChannelSdkNormalizedMessage): string | undefined {
  const content = asString(message.content);
  return content ? normalizeFeishuText(content) : undefined;
}

function resolveFeishuChannelSdkAttachments(
  resources: FeishuChannelSdkResourceDescriptor[] | undefined,
  externalMessageId: string,
): ExternalMessageAttachment[] {
  if (!Array.isArray(resources)) {
    return [];
  }

  return resources
    .map((resource) => normalizeFeishuChannelSdkAttachment(resource, externalMessageId))
    .filter((attachment): attachment is ExternalMessageAttachment => attachment !== null);
}

function normalizeFeishuChannelSdkAttachment(
  resource: FeishuChannelSdkResourceDescriptor,
  externalMessageId: string,
): ExternalMessageAttachment | null {
  const resourceType = normalizeFeishuChannelSdkResourceType(resource.type);
  const fileKey = asString(resource.fileKey);
  if (!resourceType || !fileKey) {
    return null;
  }

  return {
    id: `${externalMessageId}:${resourceType}:${fileKey}`,
    fileName: asString(resource.fileName) ?? defaultFeishuAttachmentFileName({
      fileKey,
      mediaType: mediaTypeFromFeishuChannelSdkResourceType(resourceType),
      resourceType: resourceType === "image" ? "image" : "file",
    }),
    mediaType: mediaTypeFromFeishuChannelSdkResourceType(resourceType),
    metadata: {
      provider: FEISHU_PROVIDER_ID,
      externalMessageId,
      resourceType,
      fileKey,
      resourceEndpoint: "channel_sdk.normalized_message.resources",
      ...(typeof resource.durationMs === "number" ? { durationMs: resource.durationMs } : {}),
      ...(asString(resource.coverImageKey) ? { coverImageKey: resource.coverImageKey } : {}),
    },
  };
}

function normalizeFeishuChannelSdkResourceType(value: string | undefined): string | undefined {
  if (
    value === "image" ||
    value === "file" ||
    value === "audio" ||
    value === "video" ||
    value === "sticker"
  ) {
    return value;
  }
  return undefined;
}

function mediaTypeFromFeishuChannelSdkResourceType(resourceType: string): string | undefined {
  if (resourceType === "image") {
    return "image/jpeg";
  }
  if (resourceType === "audio") {
    return "audio/mpeg";
  }
  if (resourceType === "video") {
    return "video/mp4";
  }
  if (resourceType === "sticker") {
    return "image/webp";
  }
  return undefined;
}

function resolveFeishuChannelSdkReceivedAt(createTime: number | undefined): string {
  if (typeof createTime === "number" && Number.isFinite(createTime) && createTime > 0) {
    const timestampMs = createTime < 10_000_000_000 ? createTime * 1000 : createTime;
    return new Date(timestampMs).toISOString();
  }
  return new Date().toISOString();
}

function buildFeishuChannelSdkRawPayload(input: {
  message: FeishuChannelSdkNormalizedMessage;
  externalEventId: string;
  eventType: string;
}): Record<string, unknown> {
  return {
    schema: "channel_sdk_normalized",
    header: {
      event_id: input.externalEventId,
      event_type: input.eventType,
    },
    event: {
      sender: {
        sender_id: {
          open_id: input.message.senderId,
        },
        sender_name: input.message.senderName,
      },
      message: {
        chat_id: input.message.chatId,
        chat_type: input.message.chatType,
        message_id: input.message.messageId,
        message_type: input.message.rawContentType,
        thread_id: input.message.threadId,
        root_id: input.message.rootId,
        reply_to_message_id: input.message.replyToMessageId,
        mentioned_bot: input.message.mentionedBot,
        mention_all: input.message.mentionAll,
        resources: input.message.resources ?? [],
        mentions: input.message.mentions ?? [],
      },
    },
  };
}

function extensionFromImageMediaType(mediaType?: string): string {
  if (mediaType === "image/png") {
    return ".png";
  }
  if (mediaType === "image/gif") {
    return ".gif";
  }
  if (mediaType === "image/webp") {
    return ".webp";
  }
  return ".jpg";
}

function resolveFeishuParsedMessageText(parsed: Record<string, unknown>): string | undefined {
  return asString(parsed.text)
    ?? asString(parsed.content)
    ?? asString(parsed.markdown)
    ?? resolveFeishuPostMessageText(parsed);
}

function resolveFeishuPostMessageText(parsed: Record<string, unknown>): string | undefined {
  const post = asRecord(parsed.post) ?? parsed;
  const locale = resolveFeishuPostLocale(post);
  if (!locale) {
    return undefined;
  }

  const title = asString(locale.title);
  const body = flattenFeishuPostContent(locale.content);
  return joinTextParts([title, body]);
}

function resolveFeishuPostLocale(post: Record<string, unknown>): Record<string, unknown> | null {
  for (const key of ["zh_cn", "en_us", "ja_jp"]) {
    const locale = asRecord(post[key]);
    if (locale) {
      return locale;
    }
  }

  if (Array.isArray(post.content) || asString(post.title)) {
    return post;
  }

  for (const value of Object.values(post)) {
    const locale = asRecord(value);
    if (locale && (Array.isArray(locale.content) || asString(locale.title))) {
      return locale;
    }
  }

  return null;
}

function flattenFeishuPostContent(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return joinTextParts(value.map((item) => flattenFeishuPostContent(item)));
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const tag = asString(record.tag);
  if (tag === "text") {
    return asString(record.text);
  }
  if (tag === "a") {
    return asString(record.text) ?? asString(record.href);
  }
  if (tag === "at") {
    const label = asString(record.user_name)
      ?? asString(record.name)
      ?? asString(record.text);
    return label ? `<at>${label}</at>` : undefined;
  }

  return asString(record.text)
    ?? asString(record.name)
    ?? flattenFeishuPostContent(record.content)
    ?? flattenFeishuPostContent(record.elements);
}

function joinTextParts(parts: Array<string | undefined>): string | undefined {
  const text = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
  return text || undefined;
}

function normalizeFeishuText(value: string): string {
  return value
    .replace(/<at\b[^>]*>.*?<\/at>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
