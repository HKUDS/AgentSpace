import {
  listExternalIntegrationsSync,
  readExternalIntegrationSync,
  type ExternalIntegrationRecord,
} from "@agent-space/db";
import { sameValue } from "../../../shared/helpers.ts";
import { isFeishuAgentBotBinding, type FeishuAgentBotBinding } from "./agent-bot-bindings.ts";
import { FEISHU_PROVIDER_ID } from "./constants.ts";
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
    ?? asString(message?.chatId)
    ?? asString(event?.chat_id)
    ?? asString(event?.chatId)
    ?? asString(chat?.chat_id)
    ?? asString(chat?.chatId)
    ?? asString(chat?.open_chat_id)
    ?? asString(chat?.openChatId)
    ?? asString(chat?.id);
  if (!externalChatId) {
    return null;
  }
  return {
    externalChatId,
    externalChatType: asString(message?.chat_type)
      ?? asString(message?.chatType)
      ?? asString(event?.chat_type)
      ?? asString(event?.chatType)
      ?? asString(chat?.chat_type)
      ?? asString(chat?.chatType)
      ?? asString(chat?.type),
    externalChatName: resolveFeishuChatName({ event, message, chat }),
  };
}

function resolveFeishuChatName(input: {
  event: Record<string, unknown> | null;
  message: Record<string, unknown> | null;
  chat: Record<string, unknown> | null;
}): string | undefined {
  return firstText(
    asString(input.message?.chat_name),
    asString(input.message?.chatName),
    asString(input.event?.chat_name),
    asString(input.event?.chatName),
    asString(input.chat?.name),
    asString(input.chat?.chat_name),
    asString(input.chat?.chatName),
    readFeishuI18nName(input.message?.chat_i18n_names),
    readFeishuI18nName(input.message?.chatI18nNames),
    readFeishuI18nName(input.event?.chat_i18n_names),
    readFeishuI18nName(input.event?.chatI18nNames),
    readFeishuI18nName(input.chat?.i18n_names),
    readFeishuI18nName(input.chat?.i18nNames),
    readFeishuI18nName(input.chat?.chat_i18n_names),
    readFeishuI18nName(input.chat?.chatI18nNames),
  );
}

function readFeishuI18nName(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  return firstText(
    asString(record.zh_cn),
    asString(record.zhCn),
    asString(record.en_us),
    asString(record.enUs),
    asString(record.ja_jp),
    asString(record.jaJp),
    ...Object.values(record).map(asString),
  );
}

function firstText(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value?.trim()))?.trim();
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

export function isFeishuKnownAgentBotSenderPayloadSync(input: {
  workspaceId: string;
  payload: Record<string, unknown>;
  externalSenderId?: string;
  binding?: FeishuAgentBotBinding;
}): boolean {
  const currentTenantKey = input.binding?.tenantKey?.trim();
  const knownBotOpenIds = listExternalIntegrationsSync({
    workspaceId: input.workspaceId,
    provider: FEISHU_PROVIDER_ID,
    scope: "agent",
  })
    .filter((integration): integration is FeishuAgentBotBinding =>
      isActiveFeishuAgentBotBinding(integration) &&
      isSameFeishuTenantScope(currentTenantKey, integration.tenantKey)
    )
    .map(readFeishuAgentBotOpenId)
    .filter((value): value is string => Boolean(value));

  return isFeishuKnownAgentBotSenderPayload({
    payload: input.payload,
    externalSenderId: input.externalSenderId,
    binding: input.binding,
    knownBotOpenIds,
  });
}

export function isFeishuKnownAgentBotSenderPayload(input: {
  payload: Record<string, unknown>;
  externalSenderId?: string;
  binding?: FeishuAgentBotBinding;
  knownBotOpenIds?: readonly string[];
}): boolean {
  if (isFeishuBotSenderPayload(input)) {
    return true;
  }
  const senderId = input.externalSenderId?.trim();
  return Boolean(senderId && input.knownBotOpenIds?.some((botOpenId) => botOpenId.trim() === senderId));
}

function isSameFeishuTenantScope(
  currentTenantKey: string | undefined,
  candidateTenantKey: string | undefined,
): boolean {
  const candidate = candidateTenantKey?.trim();
  return !currentTenantKey || !candidate || candidate === currentTenantKey;
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
