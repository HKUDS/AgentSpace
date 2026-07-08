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
        app_context: {
          entities: [{
            type: "slack#/types/channel_id",
            value: "C_VIEWED",
            team_id: "T_VIEWED",
          }],
        },
      },
    },
  });

  assert.ok(message);
  assert.equal(message.externalChatId, "D123");
  assert.equal(message.externalThreadId, "1783400000.000100");
  assert.equal(message.text, "hello from DM");
  assert.equal(message.rawPayload.hasAgentContext, true);
  assert.doesNotMatch(JSON.stringify(message.rawPayload), /C_VIEWED|T_VIEWED/);
});

test("normalizes Slack file metadata without exposing private URLs", () => {
  const message = normalizeSlackInboundMessage({
    context,
    botUserId: "UBOT",
    payload: {
      type: "event_callback",
      event_id: "EvFile",
      event_time: 1783400100,
      api_app_id: "A123",
      team_id: "T123",
      event: {
        type: "app_mention",
        channel: "C123",
        user: "U456",
        text: "<@UBOT>",
        ts: "1783400100.000100",
        files: [{
          id: "FSECRET123",
          title: "Roadmap.pdf",
          mimetype: "application/pdf",
          filetype: "pdf",
          size: 12345,
          mode: "hosted",
          url_private: "https://files.slack.com/files-pri/T123-FSECRET123/roadmap.pdf",
          url_private_download: "https://files.slack.com/files-pri/T123-FSECRET123/download/roadmap.pdf",
          permalink: "https://workspace.slack.com/files/U456/FSECRET123/roadmap.pdf",
        }],
      },
    },
  });

  assert.ok(message);
  assert.equal(message.text, "Shared 1 Slack file: Roadmap.pdf.");
  assert.equal(message.attachments.length, 1);
  assert.match(message.attachments[0]?.id ?? "", /^ref_[a-f0-9]{8}$/);
  assert.equal(message.attachments[0]?.fileName, "Roadmap.pdf");
  assert.equal(message.attachments[0]?.mediaType, "application/pdf");
  assert.equal(message.attachments[0]?.sizeBytes, 12345);
  assert.equal(message.attachments[0]?.url, undefined);
  assert.deepEqual(message.attachments[0]?.metadata, {
    provider: SLACK_PROVIDER_ID,
    source: "slack_file_metadata",
    fileRef: message.attachments[0]?.id,
    fileType: "pdf",
    mode: "hosted",
    isExternal: false,
    privateUrlRedacted: true,
    permalinkRedacted: true,
    downloadStatus: "not_downloaded",
    rawSlackFileIdStored: false,
    privateUrlStored: false,
  });
  assert.equal(message.rawPayload.hasFiles, true);
  assert.equal(message.rawPayload.fileCount, 1);
  assert.doesNotMatch(JSON.stringify(message), /FSECRET123|files\.slack\.com|url_private|workspace\.slack\.com\/files/);
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

test("ignores Slack message subtypes that should not dispatch tasks", () => {
  for (const subtype of ["bot_message", "message_changed", "message_deleted", "channel_join", "thread_broadcast"]) {
    assert.equal(normalizeSlackInboundMessage({
      context,
      botUserId: "UBOT",
      payload: {
        type: "event_callback",
        event: {
          type: "message",
          subtype,
          channel_type: "channel",
          channel: "C123",
          user: "U456",
          text: "<@UBOT> should stay ignored",
          ts: "1783400002.000100",
        },
      },
    }), null, subtype);
  }

  assert.equal(normalizeSlackInboundMessage({
    context,
    botUserId: "UBOT",
    payload: {
      type: "event_callback",
      event: {
        type: "message",
        hidden: true,
        channel_type: "channel",
        channel: "C123",
        user: "U456",
        text: "<@UBOT> hidden edit",
        ts: "1783400002.000200",
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
