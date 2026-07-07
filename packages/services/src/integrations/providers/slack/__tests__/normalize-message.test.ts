import assert from "node:assert/strict";
import test from "node:test";
import { SLACK_PROVIDER_ID } from "../constants.ts";
import {
  cleanSlackMessageText,
  ensureSlackAgentMentionText,
  normalizeSlackInboundMessage,
} from "../normalize-message.ts";

const context = {
  workspaceId: "workspace-1",
  integrationId: "external-integration-slack",
  provider: SLACK_PROVIDER_ID,
};

test("normalizes Slack app mentions and removes the bot mention", () => {
  const message = normalizeSlackInboundMessage({
    context,
    botUserId: "UBOT",
    payload: {
      type: "event_callback",
      event_id: "Ev123",
      event_time: 1783400000,
      api_app_id: "A123",
      team_id: "T123",
      event: {
        type: "app_mention",
        channel: "C123",
        user: "U456",
        text: "<@UBOT> @Atlas summarize <https://example.com|the report>",
        ts: "1783400000.000100",
      },
    },
  });

  assert.ok(message);
  assert.equal(message.provider, SLACK_PROVIDER_ID);
  assert.equal(message.externalChatId, "C123");
  assert.equal(message.externalMessageId, "1783400000.000100");
  assert.equal(message.externalThreadId, "1783400000.000100");
  assert.equal(message.externalSenderId, "U456");
  assert.equal(message.text, "@Atlas summarize the report (https://example.com)");
});

test("normalizes Slack direct messages", () => {
  const message = normalizeSlackInboundMessage({
    context,
    payload: {
      type: "event_callback",
      event_id: "EvDM",
      event: {
        type: "message",
        channel_type: "im",
        channel: "D123",
        user: "U456",
        text: "hello from DM",
        ts: "1783400001.000100",
        thread_ts: "1783400000.000100",
      },
    },
  });

  assert.ok(message);
  assert.equal(message.externalChatId, "D123");
  assert.equal(message.externalThreadId, "1783400000.000100");
  assert.equal(message.text, "hello from DM");
});

test("ignores Slack bot and self messages", () => {
  assert.equal(normalizeSlackInboundMessage({
    context,
    payload: {
      type: "event_callback",
      event: {
        type: "message",
        channel_type: "im",
        channel: "D123",
        user: "U456",
        bot_id: "B123",
        text: "bot noise",
        ts: "1783400001.000100",
      },
    },
  }), null);

  assert.equal(normalizeSlackInboundMessage({
    context,
    botUserId: "UBOT",
    payload: {
      type: "event_callback",
      event: {
        type: "message",
        channel_type: "im",
        channel: "D123",
        user: "UBOT",
        text: "self loop",
        ts: "1783400001.000100",
      },
    },
  }), null);
});

test("cleans Slack mrkdwn entities and can inject agent-scoped mentions", () => {
  assert.equal(
    cleanSlackMessageText({ text: "<@U123> see <#C123|general> &amp; <https://example.com|link>" }),
    "@slack-user-ref_64a7152b see #general & link (https://example.com)",
  );
  assert.equal(ensureSlackAgentMentionText({
    text: "please inspect this",
    agentId: "Codex",
  }), "@Codex please inspect this");
  assert.equal(ensureSlackAgentMentionText({
    text: "@Codex please inspect this",
    agentId: "Codex",
  }), "@Codex please inspect this");
});
