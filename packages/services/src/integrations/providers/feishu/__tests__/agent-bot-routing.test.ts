import assert from "node:assert/strict";
import test from "node:test";
import { FEISHU_PROVIDER_ID } from "../constants.ts";
import {
  isFeishuAgentBotMentioned,
  isFeishuBotSenderPayload,
  isFeishuKnownAgentBotSenderPayload,
  resolveFeishuChatDescriptor,
} from "../agent-bot-routing.ts";
import type { FeishuAgentBotBinding } from "../agent-bot-bindings.ts";

test("identifies Feishu app and bot senders before AgentSpace routing", () => {
  assert.equal(isFeishuBotSenderPayload({
    payload: buildPayload({ senderType: "app" }),
    externalSenderId: "ou_any_bot",
  }), true);
  assert.equal(isFeishuBotSenderPayload({
    payload: buildPayload({ messageSenderType: "bot" }),
    externalSenderId: "ou_any_bot",
  }), true);
  assert.equal(isFeishuBotSenderPayload({
    payload: buildPayload({ senderType: "user" }),
    externalSenderId: "ou_mina",
  }), false);
});

test("identifies bot senders by the current agent bot open id", () => {
  const binding = buildAgentBotBinding({
    botOpenId: "ou_bot_atlas",
  });

  assert.equal(isFeishuBotSenderPayload({
    payload: buildPayload({ senderType: "user" }),
    externalSenderId: "ou_bot_atlas",
    binding,
  }), true);
  assert.equal(isFeishuBotSenderPayload({
    payload: buildPayload({ senderType: "user" }),
    externalSenderId: "ou_mina",
    binding,
  }), false);
});

test("identifies senders from any known Feishu agent bot open id", () => {
  const binding = buildAgentBotBinding({
    botOpenId: "ou_bot_atlas",
  });

  assert.equal(isFeishuKnownAgentBotSenderPayload({
    payload: buildPayload({ senderType: "user" }),
    externalSenderId: "ou_bot_hermes",
    binding,
    knownBotOpenIds: ["ou_bot_atlas", "ou_bot_hermes"],
  }), true);
  assert.equal(isFeishuKnownAgentBotSenderPayload({
    payload: buildPayload({ senderType: "user" }),
    externalSenderId: "ou_mina",
    binding,
    knownBotOpenIds: ["ou_bot_atlas", "ou_bot_hermes"],
  }), false);
});

test("routes only mentions of the current Feishu agent bot", () => {
  const binding = buildAgentBotBinding({
    botOpenId: "ou_bot_atlas",
  });

  assert.equal(isFeishuAgentBotMentioned(buildPayload({
    content: { text: '<at user_id="ou_bot_atlas">@Atlas Bot</at> help' },
  }), binding), true);
  assert.equal(isFeishuAgentBotMentioned(buildPayload({
    mentions: [{
      open_id: "ou_bot_atlas",
      is_bot: true,
    }],
    content: { text: '<at user_id="ou_bot_atlas">@Atlas Bot</at> help' },
  }), binding), true);
  assert.equal(isFeishuAgentBotMentioned(buildPayload({
    mentions: [{
      open_id: "ou_bot_hermes",
      is_bot: true,
    }],
    content: { text: '<at user_id="ou_bot_hermes">@Hermes Bot</at> help' },
  }), binding), false);
  assert.equal(isFeishuAgentBotMentioned(buildPayload({
    mentions: [{
      is_bot: true,
    }],
    content: { text: '<at user_id="ou_bot_hermes">@Hermes Bot</at> help' },
  }), binding), false);
  assert.equal(isFeishuAgentBotMentioned(buildPayload({
    mentionedBot: true,
    content: { text: '<at user_id="ou_unknown">@Bot</at> help' },
  }), binding), true);
});

test("resolves Feishu chat descriptors from bot-added payload variants", () => {
  assert.deepEqual(resolveFeishuChatDescriptor({
    event: {
      chatId: "oc_event_camel",
      chatType: "group",
      chatName: "Event Camel Room",
    },
  }), {
    externalChatId: "oc_event_camel",
    externalChatName: "Event Camel Room",
    externalChatType: "group",
  });
  assert.deepEqual(resolveFeishuChatDescriptor({
    event: {
      chat: {
        open_chat_id: "oc_nested_snake",
        type: "group",
        i18n_names: {
          en_us: "Nested Snake Room",
          zh_cn: "Nested CN Room",
        },
      },
    },
  }), {
    externalChatId: "oc_nested_snake",
    externalChatName: "Nested CN Room",
    externalChatType: "group",
  });
  assert.deepEqual(resolveFeishuChatDescriptor({
    event: {
      message: {
        chatId: "oc_message_camel",
        chatType: "p2p",
        chatI18nNames: {
          enUs: "Message Camel Room",
        },
      },
    },
  }), {
    externalChatId: "oc_message_camel",
    externalChatName: "Message Camel Room",
    externalChatType: "p2p",
  });
  assert.equal(resolveFeishuChatDescriptor({ event: {} }), null);
});

function buildPayload(input: {
  senderType?: string;
  messageSenderType?: string;
  mentionedBot?: boolean;
  mentions?: Record<string, unknown>[];
  content?: Record<string, unknown>;
} = {}): Record<string, unknown> {
  return {
    schema: "2.0",
    header: {
      event_id: "evt-bot-sender",
      event_type: "im.message.receive_v1",
    },
    event: {
      sender: {
        sender_type: input.senderType,
        sender_id: {
          open_id: "ou_sender",
        },
      },
      message: {
        chat_id: "oc_general",
        message_id: "om-bot-sender",
        sender_type: input.messageSenderType,
        mentioned_bot: input.mentionedBot,
        mentions: input.mentions,
        content: JSON.stringify(input.content ?? { text: "hello" }),
      },
    },
  };
}

function buildAgentBotBinding(input: {
  botOpenId: string;
}): FeishuAgentBotBinding {
  return {
    id: "external-integration-agent-bot",
    workspaceId: "default",
    provider: FEISHU_PROVIDER_ID,
    displayName: "Atlas Feishu Bot",
    status: "active",
    transportMode: "websocket_worker",
    agentId: "Atlas",
    appId: "cli_atlas_bot",
    configJson: JSON.stringify({
      bot: {
        openId: input.botOpenId,
      },
    }),
    encryptedCredentialsJson: "{}",
    capabilitiesJson: "{}",
    scopesJson: "[]",
    createdAt: "2026-06-26T00:00:00.000Z",
    updatedAt: "2026-06-26T00:00:00.000Z",
    lastHealthStatus: "unknown",
  } as FeishuAgentBotBinding;
}
