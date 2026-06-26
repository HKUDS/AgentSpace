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

function isActiveFeishuAgentBotBinding(
  integration: ExternalIntegrationRecord | null,
): integration is FeishuAgentBotBinding {
  return isFeishuAgentBotBinding(integration) && integration.status === "active";
}

function isFeishuAgentBotMentioned(
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
  const mentions = Array.isArray(message.mentions) ? message.mentions : [];
  for (const mention of mentions) {
    const record = asRecord(mention);
    if (!record) {
      continue;
    }
    if (record.is_bot === true || record.isBot === true) {
      return true;
    }
    const mentionOpenId = asString(record.open_id) ?? asString(record.openId);
    const botOpenId = readBotOpenId(binding);
    if (mentionOpenId && botOpenId && mentionOpenId === botOpenId) {
      return true;
    }
  }

  const content = asString(message.content);
  return Boolean(content && /<at\b[^>]*>.*?<\/at>/i.test(content));
}

function containsAgentMention(text: string, agentId: string): boolean {
  const matches = text.match(/@([^\s，,。:：]+)/g) ?? [];
  return matches.some((token) => sameValue(token.slice(1), agentId));
}

function readBotOpenId(binding: FeishuAgentBotBinding): string | undefined {
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
