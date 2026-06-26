import { createHash } from "node:crypto";
import { FEISHU_PROVIDER_ID } from "./constants.ts";
import {
  asRecord,
  asString,
  resolveFeishuCallbackAppId,
  resolveFeishuCallbackTenantKey,
  resolveFeishuEventId,
  resolveFeishuEventReceivedAt,
  resolveFeishuEventType,
} from "./events.ts";

export function summarizeFeishuInboundEventPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const event = asRecord(payload.event);
  const message = asRecord(event?.message);
  const sender = asRecord(event?.sender);
  const senderId = asRecord(sender?.sender_id);
  const content = asString(message?.content);
  return {
    provider: FEISHU_PROVIDER_ID,
    externalEventId: resolveFeishuEventId(payload),
    eventType: resolveFeishuEventType(payload),
    appId: resolveFeishuCallbackAppId(payload),
    tenantKey: resolveFeishuCallbackTenantKey(payload),
    receivedAt: resolveFeishuEventReceivedAt(payload),
    payloadHash: sha256Json(payload),
    rawPayloadStored: false,
    contentRedacted: Boolean(content),
    message: message ? {
      messageId: asString(message.message_id),
      chatId: asString(message.chat_id),
      threadId: asString(message.thread_id) ?? asString(message.root_id),
      messageType: asString(message.message_type),
      contentLength: content ? Buffer.byteLength(content, "utf8") : 0,
      contentHash: content ? sha256Text(content) : undefined,
    } : undefined,
    sender: senderId ? {
      openId: asString(senderId.open_id),
      unionId: asString(senderId.union_id),
      userId: asString(senderId.user_id),
    } : undefined,
  };
}

function sha256Json(value: unknown): string {
  return sha256Text(JSON.stringify(value));
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
