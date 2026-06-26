import assert from "node:assert/strict";
import test from "node:test";
import { FEISHU_PROVIDER_ID } from "../constants.ts";
import {
  normalizeFeishuChannelSdkMessage,
  normalizeFeishuInboundMessage,
} from "../normalize-message.ts";

const context = {
  workspaceId: "default",
  integrationId: "external-integration-feishu",
  provider: FEISHU_PROVIDER_ID,
};

test("normalizes Feishu text messages and removes bot at tags", () => {
  const message = normalizeFeishuInboundMessage({
    context,
    payload: buildPayload({
      messageId: "om-text",
      content: { text: '<at user_id="bot_open_id">@AgentSpaceBot</at> @Atlas summarize this' },
    }),
  });

  assert.equal(message?.text, "@Atlas summarize this");
  assert.equal(message?.externalChatId, "oc_general");
  assert.equal(message?.externalSenderId, "ou_mina");
});

test("downgrades Feishu markdown message content to text", () => {
  const message = normalizeFeishuInboundMessage({
    context,
    payload: buildPayload({
      messageId: "om-markdown",
      messageType: "markdown",
      content: {
        markdown: '<at user_id="bot_open_id">@AgentSpaceBot</at> @Atlas **summarize** the launch notes',
      },
    }),
  });

  assert.equal(message?.text, "@Atlas **summarize** the launch notes");
});

test("downgrades Feishu post message content to title and plain text", () => {
  const message = normalizeFeishuInboundMessage({
    context,
    payload: buildPayload({
      messageId: "om-post",
      messageType: "post",
      content: {
        post: {
          zh_cn: {
            title: "Launch Plan",
            content: [
              [
                { tag: "at", user_name: "@AgentSpaceBot" },
                { tag: "text", text: " @Atlas summarize " },
              ],
              [
                { tag: "a", text: "source doc", href: "https://northstar.feishu.cn/docx/doc_token" },
              ],
            ],
          },
        },
      },
    }),
  });

  assert.equal(message?.text, "Launch Plan @Atlas summarize source doc");
});

test("normalizes Feishu image messages into downloadable attachment descriptors", () => {
  const message = normalizeFeishuInboundMessage({
    context,
    payload: buildPayload({
      messageId: "om-image",
      messageType: "image",
      content: {
        text: "@Atlas inspect this image",
        image_key: "img_v2_123",
        file_name: "diagram.png",
        mime_type: "image/png",
        size: 42,
      },
    }),
  });

  assert.equal(message?.text, "@Atlas inspect this image");
  assert.equal(message?.attachments.length, 1);
  assert.deepEqual(message?.attachments[0], {
    id: "om-image:image:img_v2_123",
    fileName: "diagram.png",
    mediaType: "image/png",
    sizeBytes: 42,
    metadata: {
      provider: FEISHU_PROVIDER_ID,
      externalMessageId: "om-image",
      resourceType: "image",
      fileKey: "img_v2_123",
      resourceEndpoint: "im.message.resource",
    },
  });
});

test("normalizes Feishu file messages into downloadable attachment descriptors", () => {
  const message = normalizeFeishuInboundMessage({
    context,
    payload: buildPayload({
      messageId: "om-file",
      messageType: "file",
      content: {
        text: "@Atlas review",
        file_key: "file_v2_456",
        file_name: "brief.pdf",
        mime_type: "application/pdf",
        file_size: "2048",
      },
    }),
  });

  assert.equal(message?.text, "@Atlas review");
  assert.equal(message?.attachments[0]?.id, "om-file:file:file_v2_456");
  assert.equal(message?.attachments[0]?.fileName, "brief.pdf");
  assert.equal(message?.attachments[0]?.mediaType, "application/pdf");
  assert.equal(message?.attachments[0]?.sizeBytes, 2048);
  assert.deepEqual(message?.attachments[0]?.metadata, {
    provider: FEISHU_PROVIDER_ID,
    externalMessageId: "om-file",
    resourceType: "file",
    fileKey: "file_v2_456",
    resourceEndpoint: "im.message.resource",
  });
});

test("normalizes @larksuite/channel messages into the AgentSpace envelope", () => {
  const message = normalizeFeishuChannelSdkMessage({
    context,
    externalEventId: "evt-channel-sdk-1",
    message: {
      messageId: "om-channel-sdk",
      chatId: "oc_general",
      chatType: "group",
      senderId: "ou_mina",
      senderName: "Mina",
      content: '<at user_id="bot_open_id">@AgentSpaceBot</at> @Atlas inspect the launch brief',
      rawContentType: "post",
      rootId: "om-root",
      createTime: 1782220800000,
      mentionedBot: true,
      mentionAll: false,
      mentions: [{
        key: "bot_open_id",
        openId: "bot_open_id",
        name: "AgentSpaceBot",
        isBot: true,
      }],
      resources: [{
        type: "image",
        fileKey: "img_v2_789",
        fileName: "brief.png",
      }, {
        type: "video",
        fileKey: "vid_v2_456",
        durationMs: 1200,
        coverImageKey: "img_cover_1",
      }, {
        type: "unknown",
        fileKey: "ignored",
      }],
    },
  });

  assert.equal(message?.provider, FEISHU_PROVIDER_ID);
  assert.equal(message?.integrationId, "external-integration-feishu");
  assert.equal(message?.externalEventId, "evt-channel-sdk-1");
  assert.equal(message?.eventType, "im.message.receive_v1");
  assert.equal(message?.externalChatId, "oc_general");
  assert.equal(message?.externalMessageId, "om-channel-sdk");
  assert.equal(message?.externalThreadId, "om-root");
  assert.equal(message?.externalSenderId, "ou_mina");
  assert.equal(message?.text, "@Atlas inspect the launch brief");
  assert.equal(message?.receivedAt, "2026-06-23T13:20:00.000Z");
  assert.deepEqual(message?.attachments, [{
    id: "om-channel-sdk:image:img_v2_789",
    fileName: "brief.png",
    mediaType: "image/jpeg",
    metadata: {
      provider: FEISHU_PROVIDER_ID,
      externalMessageId: "om-channel-sdk",
      resourceType: "image",
      fileKey: "img_v2_789",
      resourceEndpoint: "channel_sdk.normalized_message.resources",
    },
  }, {
    id: "om-channel-sdk:video:vid_v2_456",
    fileName: "vid_v2_456.bin",
    mediaType: "video/mp4",
    metadata: {
      provider: FEISHU_PROVIDER_ID,
      externalMessageId: "om-channel-sdk",
      resourceType: "video",
      fileKey: "vid_v2_456",
      resourceEndpoint: "channel_sdk.normalized_message.resources",
      durationMs: 1200,
      coverImageKey: "img_cover_1",
    },
  }]);
  assert.equal(message?.rawPayload.schema, "channel_sdk_normalized");
});

test("ignores incomplete @larksuite/channel messages before AgentSpace dispatch", () => {
  assert.equal(normalizeFeishuChannelSdkMessage({
    context,
    message: {
      chatId: "oc_general",
      senderId: "ou_mina",
      content: "@Atlas hello",
    },
  }), null);
});

function buildPayload(input: {
  messageId: string;
  content: Record<string, unknown>;
  messageType?: string;
}): Record<string, unknown> {
  return {
    schema: "2.0",
    header: {
      event_id: `evt-${input.messageId}`,
      event_type: "im.message.receive_v1",
      create_time: "1782220800000",
    },
    event: {
      sender: {
        sender_id: {
          open_id: "ou_mina",
          union_id: "on_mina",
          user_id: "user_feishu_mina",
        },
      },
      message: {
        chat_id: "oc_general",
        chat_type: "group",
        message_id: input.messageId,
        message_type: input.messageType ?? "text",
        content: JSON.stringify(input.content),
      },
    },
  };
}
