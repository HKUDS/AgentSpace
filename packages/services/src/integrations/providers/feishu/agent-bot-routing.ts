import {
  readExternalIntegrationSync,
  type ExternalIntegrationRecord,
} from "@agent-space/db";
import { sameValue } from "../../../shared/helpers.ts";
import { isFeishuAgentBotBinding, type FeishuAgentBotBinding } from "./agent-bot-bindings.ts";
import {
  asRecord,
  asString,
  resolveFeishuEventType,
} from "./events.ts";

export interface FeishuAgentBotRoute {
  binding: FeishuAgentBotBinding;
  agentId: string;
  botMentioned: boolean;
}

export interface FeishuChatDescriptor {
  externalChatId: string;
  externalChatType?: string;
  externalChatName?: string;
}

export function resolveFeishuAgentBotRouteSync(input: {
  workspaceId: string;
  integrationId: string;
  payload: Record<string, unknown>;
}): FeishuAgentBotRoute | null {
  const integration = readExternalIntegrationSync({
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
  });
  if (!isActiveFeishuAgentBotBinding(integration)) {
    return null;
  }
  return {
    binding: integration,
    agentId: integration.agentId,
    botMentioned: isFeishuAgentBotMentioned(input.payload, integration),
  };
}

export function isFeishuBotAddedToChatPayload(payload: Record<string, unknown>): boolean {
  const eventType = resolveFeishuEventType(payload).trim().toLowerCase();
  if (
    eventType === "im.chat.member.bot.added_v1" ||
    eventType === "im.chat.member.bot.added" ||
    eventType === "im.chat.member.bot.add_v1"
  ) {
    return true;
  }
  return eventType.includes("chat") &&
    eventType.includes("bot") &&
    (eventType.includes("added") || eventType.includes("add"));
}

export function resolveFeishuChatDescriptor(payload: Record<string, unknown>): FeishuChatDescriptor | null {
  const event = asRecord(payload.event);
  const message = asRecord(event?.message);
  const chat = asRecord(event?.chat) ?? asRecord(message?.chat);
  const externalChatId = asString(message?.chat_id)
    ?? asString(event?.chat_id)
    ?? asString(chat?.chat_id)
    ?? asString(chat?.id);
  if (!externalChatId) {
    return null;
  }
  return {
    externalChatId,
    externalChatType: asString(message?.chat_type)
      ?? asString(event?.chat_type)
      ?? asString(chat?.chat_type)
      ?? asString(chat?.type),
    externalChatName: asString(message?.chat_name)
      ?? asString(event?.chat_name)
      ?? asString(chat?.name)
      ?? asString(chat?.chat_name),
  };
}

export function ensureFeishuAgentMentionText(input: {
  text?: string;
  agentId: string;
}): string {
  const agentId = input.agentId.trim();
  const text = input.text?.trim() ?? "";
  if (!agentId) {
    return text;
  }
  if (containsAgentMention(text, agentId)) {
    return text;
  }
  return text ? `@${agentId} ${text}` : `@${agentId}`;
}

export function isFeishuBotSenderPayload(input: {
  payload: Record<string, unknown>;
  externalSenderId?: string;
  binding?: FeishuAgentBotBinding;
}): boolean {
  const senderType = resolveFeishuSenderType(input.payload);
  if (senderType === "bot" || senderType === "app" || senderType === "application") {
    return true;
  }

  const senderId = input.externalSenderId?.trim();
  const botOpenId = input.binding ? readFeishuAgentBotOpenId(input.binding) : undefined;
  return Boolean(senderId && botOpenId && senderId === botOpenId);
}

function isActiveFeishuAgentBotBinding(
  integration: ExternalIntegrationRecord | null,
): integration is FeishuAgentBotBinding {
  return isFeishuAgentBotBinding(integration) && integration.status === "active";
}

export function isFeishuAgentBotMentioned(
  payload: Record<string, unknown>,
  binding: FeishuAgentBotBinding,
): boolean {
  const event = asRecord(payload.event);
  const message = asRecord(event?.message);
  if (!message) {
    return false;
  }
  if (message.mentioned_bot === true || message.mentionedBot === true) {
    return true;
  }
  const botOpenId = readFeishuAgentBotOpenId(binding);
  const mentions = Array.isArray(message.mentions) ? message.mentions : [];
  for (const mention of mentions) {
    const record = asRecord(mention);
    if (!record) {
      continue;
    }
    const mentionOpenId = asString(record.open_id)
      ?? asString(record.openId)
      ?? asString(record.user_id)
      ?? asString(record.userId)
      ?? asString(record.id);
    if (mentionOpenId && botOpenId && mentionOpenId === botOpenId) {
      return true;
    }
  }

  if (!botOpenId) {
    return false;
  }
  return extractFeishuAtMentionIds(asString(message.content)).some((mentionId) => mentionId === botOpenId);
}

function containsAgentMention(text: string, agentId: string): boolean {
  const matches = text.match(/@([^\s，,。:：]+)/g) ?? [];
  return matches.some((token) => sameValue(token.slice(1), agentId));
}

function extractFeishuAtMentionIds(content: string | undefined): string[] {
  const candidates = [content, readTextFromFeishuContentJson(content)]
    .filter((value): value is string => Boolean(value));
  const mentionIds: string[] = [];
  for (const candidate of candidates) {
    const matches = candidate.matchAll(/<at\b([^>]*)>/gi);
    for (const match of matches) {
      const attrs = match[1] ?? "";
      const id = readFeishuAtAttribute(attrs, "open_id")
        ?? readFeishuAtAttribute(attrs, "openId")
        ?? readFeishuAtAttribute(attrs, "user_id")
        ?? readFeishuAtAttribute(attrs, "userId")
        ?? readFeishuAtAttribute(attrs, "id");
      if (id && !mentionIds.includes(id)) {
        mentionIds.push(id);
      }
    }
  }
  return mentionIds;
}

function readTextFromFeishuContentJson(content: string | undefined): string | undefined {
  if (!content) {
    return undefined;
  }
  try {
    const parsed = asRecord(JSON.parse(content));
    return asString(parsed?.text)
      ?? asString(parsed?.content)
      ?? asString(parsed?.markdown);
  } catch {
    return undefined;
  }
}

function readFeishuAtAttribute(attrs: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]+)"|'([^']+)'|([^\\s>]+))`, "i");
  const match = attrs.match(pattern);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function resolveFeishuSenderType(payload: Record<string, unknown>): string | undefined {
  const event = asRecord(payload.event);
  const message = asRecord(event?.message);
  const sender = asRecord(event?.sender);
  const senderId = asRecord(sender?.sender_id);
  return normalizeSenderType(
    asString(sender?.sender_type)
      ?? asString(sender?.senderType)
      ?? asString(senderId?.sender_type)
      ?? asString(senderId?.senderType)
      ?? asString(event?.sender_type)
      ?? asString(event?.senderType)
      ?? asString(message?.sender_type)
      ?? asString(message?.senderType),
  );
}

function normalizeSenderType(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase().replace(/[_\s-]+/g, "_");
}

export function readFeishuAgentBotOpenId(binding: FeishuAgentBotBinding): string | undefined {
  const config = parseJsonRecord(binding.configJson);
  const bot = asRecord(config?.bot);
  return asString(bot?.openId) ?? asString(bot?.open_id);
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}
