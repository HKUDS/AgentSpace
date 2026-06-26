import assert from "node:assert/strict";
import test from "node:test";
import { FEISHU_PROVIDER_ID } from "../constants.ts";
import {
  isFeishuAgentBotMentioned,
  isFeishuBotSenderPayload,
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
