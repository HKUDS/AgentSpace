import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExternalChannelBindingRecord,
  ExternalIntegrationEventRecord,
  ExternalMessageMappingRecord,
} from "@agent-space/db";
import {
  buildSlackInboundPermissionNoticeOutbox,
  processSlackInboundEventSync,
} from "../inbound.ts";
import { SLACK_PROVIDER_ID } from "../constants.ts";

const context = {
  workspaceId: "workspace-1",
  integrationId: "slack-1",
  provider: SLACK_PROVIDER_ID,
};

test("builds Slack permission denial notices for the original thread with safe metadata", () => {
  const notice = buildSlackInboundPermissionNoticeOutbox({
    message: {
      externalChatId: "C_SHARED_SECRET",
      externalThreadId: "1783400003.000100",
    },
    text: "Your AgentSpace account cannot access this channel.",
  });

  assert.equal(notice.targetExternalChatId, "C_SHARED_SECRET");
  assert.equal(notice.targetExternalThreadId, "1783400003.000100");
  assert.deepEqual(notice.payload, {
    channel: "C_SHARED_SECRET",
    thread_ts: "1783400003.000100",
    text: "Your AgentSpace account cannot access this channel.",
  });
  assert.equal(notice.metadataJson.provider, "slack");
  assert.equal(notice.metadataJson.outboxSource, "inbound_permission_notice");
  assert.equal(notice.metadataJson.noticeType, "permission_denied");
  assert.match(String(notice.metadataJson.externalChatReference), /^ref_[a-f0-9]{8}$/);
  assert.match(String(notice.metadataJson.externalThreadReference), /^ref_[a-f0-9]{8}$/);
  assert.doesNotMatch(JSON.stringify(notice.metadataJson), /C_SHARED_SECRET|1783400003\.000100/);
});

test("ignores duplicate Slack messages before dispatching another task", () => {
  const event = buildExternalIntegrationEvent({
    externalEventId: "EvDuplicate",
    eventType: "event_callback.app_mention",
    status: "received",
  });
  const existingMapping = buildExternalMessageMapping({
    externalMessageId: "1783400004.000100",
    externalEventId: "EvOriginal",
  });
  const calls: string[] = [];

  const result = processSlackInboundEventSync({
    context,
    payload: {
      type: "event_callback",
      event_id: "EvDuplicate",
      event_time: 1783400004,
      api_app_id: "A123",
      team_id: "T123",
      event: {
        type: "app_mention",
        channel: "C123",
        user: "U456",
        text: "<@UBOT> please do this once",
        ts: "1783400004.000100",
      },
    },
    dependencies: {
      recordEvent: (input) => {
        calls.push("record-event");
        assert.equal(input.workspaceId, "workspace-1");
        assert.equal(input.integrationId, "slack-1");
        assert.equal(input.provider, SLACK_PROVIDER_ID);
        assert.equal(input.externalEventId, "EvDuplicate");
        return event;
      },
      readMessageMappingByExternalMessage: (input) => {
        calls.push("read-existing-mapping");
        assert.deepEqual(input, {
          workspaceId: "workspace-1",
          integrationId: "slack-1",
          externalMessageId: "1783400004.000100",
        });
        return existingMapping;
      },
      updateEventStatus: (input) => {
        calls.push("mark-ignored");
        assert.equal(input.workspaceId, "workspace-1");
        assert.equal(input.provider, SLACK_PROVIDER_ID);
        assert.equal(input.externalEventId, "EvDuplicate");
        assert.equal(input.status, "ignored");
        assert.equal(input.errorMessage, "duplicate_external_message");
        return {
          ...event,
          status: "ignored",
          errorMessage: "duplicate_external_message",
        };
      },
    },
  });

  assert.equal(result.dispatchStatus, "duplicate");
  assert.equal(result.reasonCode, "duplicate_external_message");
  assert.equal(result.event.status, "ignored");
  assert.equal(result.mapping, existingMapping);
  assert.equal(result.message?.text, "please do this once");
  assert.deepEqual(calls, ["record-event", "read-existing-mapping", "mark-ignored"]);
});

test("ignores Slack messages when the channel is not bound", () => {
  const event = buildExternalIntegrationEvent({
    externalEventId: "EvMissingChannel",
  });
  const calls: string[] = [];

  const result = processSlackInboundEventSync({
    context,
    payload: buildSlackMentionPayload({
      eventId: "EvMissingChannel",
      messageTs: "1783400005.000100",
    }),
    dependencies: {
      recordEvent: () => {
        calls.push("record-event");
        return event;
      },
      readMessageMappingByExternalMessage: () => {
        calls.push("read-existing-mapping");
        return null;
      },
      readChannelBindingByExternalChat: (input) => {
        calls.push("read-channel-binding");
        assert.equal(input.externalChatId, "C123");
        return null;
      },
      readUserBindingByExternalUser: () => {
        assert.fail("user binding lookup should not run when channel binding is missing");
      },
      updateEventStatus: (input) => {
        calls.push("mark-ignored");
        assert.equal(input.status, "ignored");
        assert.equal(input.errorMessage, "slack.channel_binding_missing");
        return {
          ...event,
          status: "ignored",
          errorMessage: "slack.channel_binding_missing",
        };
      },
    },
  });

  assert.equal(result.dispatchStatus, "ignored");
  assert.equal(result.reasonCode, "slack.channel_binding_missing");
  assert.equal(result.mapping, undefined);
  assert.equal(result.event.status, "ignored");
  assert.equal(result.message?.externalChatId, "C123");
  assert.deepEqual(calls, ["record-event", "read-existing-mapping", "read-channel-binding", "mark-ignored"]);
});

test("ignores Slack messages when the sender is not bound", () => {
  const event = buildExternalIntegrationEvent({
    externalEventId: "EvMissingUser",
  });
  const channelBinding = buildExternalChannelBinding();
  const calls: string[] = [];

  const result = processSlackInboundEventSync({
    context,
    payload: buildSlackMentionPayload({
      eventId: "EvMissingUser",
      messageTs: "1783400006.000100",
    }),
    dependencies: {
      recordEvent: () => {
        calls.push("record-event");
        return event;
      },
      readMessageMappingByExternalMessage: () => {
        calls.push("read-existing-mapping");
        return null;
      },
      readChannelBindingByExternalChat: () => {
        calls.push("read-channel-binding");
        return channelBinding;
      },
      readUserBindingByExternalUser: (input) => {
        calls.push("read-user-binding");
        assert.deepEqual(input, {
          workspaceId: "workspace-1",
          integrationId: "slack-1",
          externalUserId: "U456",
        });
        return null;
      },
      updateEventStatus: (input) => {
        calls.push("mark-ignored");
        assert.equal(input.status, "ignored");
        assert.equal(input.errorMessage, "slack.user_binding_missing");
        return {
          ...event,
          status: "ignored",
          errorMessage: "slack.user_binding_missing",
        };
      },
    },
  });

  assert.equal(result.dispatchStatus, "ignored");
  assert.equal(result.reasonCode, "slack.user_binding_missing");
  assert.equal(result.mapping, undefined);
  assert.equal(result.event.status, "ignored");
  assert.equal(result.message?.externalSenderId, "U456");
  assert.deepEqual(calls, [
    "record-event",
    "read-existing-mapping",
    "read-channel-binding",
    "read-user-binding",
    "mark-ignored",
  ]);
});

function buildSlackMentionPayload(input: {
  eventId: string;
  messageTs: string;
}): Record<string, unknown> {
  return {
    type: "event_callback",
    event_id: input.eventId,
    event_time: 1783400005,
    api_app_id: "A123",
    team_id: "T123",
    event: {
      type: "app_mention",
      channel: "C123",
      user: "U456",
      text: "<@UBOT> dispatch safely",
      ts: input.messageTs,
    },
  };
}

function buildExternalChannelBinding(
  overrides: Partial<ExternalChannelBindingRecord> = {},
): ExternalChannelBindingRecord {
  return {
    id: "channel-binding-1",
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    channelName: "general",
    externalChatId: "C123",
    externalChatType: "channel",
    externalChatName: "launch-channel",
    status: "active",
    syncMode: "mirror",
    metadataJson: "{}",
    createdAt: "2026-07-07T04:53:20.000Z",
    updatedAt: "2026-07-07T04:53:20.000Z",
    ...overrides,
  };
}

function buildExternalIntegrationEvent(
  overrides: Partial<ExternalIntegrationEventRecord> = {},
): ExternalIntegrationEventRecord {
  return {
    id: "event-1",
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    provider: SLACK_PROVIDER_ID,
    externalEventId: "Ev123",
    eventType: "event_callback.app_mention",
    status: "received",
    payloadJson: "{}",
    receivedAt: "2026-07-07T04:53:20.000Z",
    ...overrides,
  };
}

function buildExternalMessageMapping(
  overrides: Partial<ExternalMessageMappingRecord> = {},
): ExternalMessageMappingRecord {
  return {
    id: "mapping-1",
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    channelBindingId: "channel-binding-1",
    direction: "inbound",
    externalMessageId: "1783400004.000100",
    externalThreadId: "1783400004.000100",
    externalSenderId: "U456",
    externalEventId: "Ev123",
    agentSpaceMessageId: "message-1",
    metadataJson: "{}",
    createdAt: "2026-07-07T04:53:20.000Z",
    ...overrides,
  };
}
