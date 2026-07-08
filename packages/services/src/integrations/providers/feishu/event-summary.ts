import { createHash } from "node:crypto";
import { buildLabeledExternalIdReference } from "../../core/index.ts";
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
  const externalEventId = resolveFeishuEventId(payload);
  const messageId = asString(message?.message_id);
  const chatId = asString(message?.chat_id);
  const threadId = asString(message?.thread_id) ?? asString(message?.root_id);
  const openId = asString(senderId?.open_id);
  const unionId = asString(senderId?.union_id);
  const userId = asString(senderId?.user_id);
  return {
    provider: FEISHU_PROVIDER_ID,
    externalEventReference: buildSafeExternalReference("event", externalEventId),
    externalEventIdRedacted: Boolean(externalEventId),
    eventType: resolveFeishuEventType(payload),
    appId: resolveFeishuCallbackAppId(payload),
    tenantKey: resolveFeishuCallbackTenantKey(payload),
    receivedAt: resolveFeishuEventReceivedAt(payload),
    payloadHash: sha256Json(payload),
    rawPayloadStored: false,
    contentRedacted: Boolean(content),
    message: message ? {
      messageReference: buildSafeExternalReference("message", messageId),
      messageIdRedacted: Boolean(messageId),
      chatReference: buildSafeExternalReference("chat", chatId),
      chatIdRedacted: Boolean(chatId),
      threadReference: buildSafeExternalReference("thread", threadId),
      threadIdRedacted: Boolean(threadId),
      messageType: asString(message.message_type),
      contentLength: content ? Buffer.byteLength(content, "utf8") : 0,
      contentHash: content ? sha256Text(content) : undefined,
    } : undefined,
    sender: senderId ? {
      openIdReference: buildSafeExternalReference("user", openId),
      openIdRedacted: Boolean(openId),
      unionIdReference: buildSafeExternalReference("union", unionId),
      unionIdRedacted: Boolean(unionId),
      userIdReference: buildSafeExternalReference("user", userId),
      userIdRedacted: Boolean(userId),
    } : undefined,
  };
}

export function summarizeFeishuApprovalCardActionEventPayload(
  payload: Record<string, unknown>,
  action: {
    approvalId: string;
    decision: "approved" | "rejected";
    payloadHash: string;
  },
): Record<string, unknown> {
  return {
    ...summarizeFeishuInboundEventPayload(payload),
    approvalCardAction: {
      provider: FEISHU_PROVIDER_ID,
      kind: "data_operation_approval",
      approvalId: action.approvalId,
      payloadHash: action.payloadHash,
      decision: action.decision,
      tokenStored: false,
      rawActionPayloadStored: false,
    },
  };
}

function sha256Json(value: unknown): string {
  return sha256Text(JSON.stringify(value));
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function buildSafeExternalReference(kind: string, value: string | undefined): string | undefined {
  return buildLabeledExternalIdReference(kind, value, {
    hashLength: 16,
  });
}
