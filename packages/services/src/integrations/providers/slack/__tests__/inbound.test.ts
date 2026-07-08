import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExternalChannelBindingRecord,
  ExternalIntegrationEventRecord,
  ExternalMessageMappingRecord,
  ExternalMessageOutboxRecord,
  ExternalUserBindingRecord,
  StoredUserRecord,
  StoredWorkspaceMembershipRecord,
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
      createNoticeOutbox: (input) => {
        calls.push("create-setup-notice");
        assert.equal(input.channelBindingId, undefined);
        assert.equal(input.targetExternalChatId, "C123");
        assert.equal(input.targetExternalThreadId, "1783400005.000100");
        const metadata = input.metadataJson as Record<string, unknown>;
        assert.equal(metadata.outboxSource, "inbound_setup_notice");
        assert.equal(metadata.noticeType, "channel_binding_missing");
        assert.doesNotMatch(JSON.stringify(metadata), /C123|U456|1783400005\.000100/);
        return buildExternalMessageOutbox(input as Partial<ExternalMessageOutboxRecord>);
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
  assert.equal(result.noticeOutbox?.targetExternalChatId, "C123");
  assert.equal(result.noticeOutbox?.targetExternalThreadId, "1783400005.000100");
  assert.equal(result.event.status, "ignored");
  assert.equal(result.message?.externalChatId, "C123");
  assert.deepEqual(calls, [
    "record-event",
    "read-existing-mapping",
    "read-channel-binding",
    "create-setup-notice",
    "mark-ignored",
  ]);
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
      createNoticeOutbox: (input) => {
        calls.push("create-identity-notice");
        assert.equal(input.channelBindingId, "channel-binding-1");
        assert.equal(input.targetExternalChatId, "C123");
        assert.equal(input.targetExternalThreadId, "1783400006.000100");
        const metadata = input.metadataJson as Record<string, unknown>;
        assert.equal(metadata.outboxSource, "inbound_identity_notice");
        assert.equal(metadata.noticeType, "user_binding_missing");
        assert.doesNotMatch(JSON.stringify(metadata), /C123|U456|1783400006\.000100/);
        return buildExternalMessageOutbox(input as Partial<ExternalMessageOutboxRecord>);
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
  assert.equal(result.noticeOutbox?.channelBindingId, "channel-binding-1");
  assert.equal(result.noticeOutbox?.targetExternalChatId, "C123");
  assert.equal(result.noticeOutbox?.targetExternalThreadId, "1783400006.000100");
  assert.equal(result.event.status, "ignored");
  assert.equal(result.message?.externalSenderId, "U456");
  assert.deepEqual(calls, [
    "record-event",
    "read-existing-mapping",
    "read-channel-binding",
    "read-user-binding",
    "create-identity-notice",
    "mark-ignored",
  ]);
});

test("dispatches bound Slack messages through AgentSpace and records inbound mappings", () => {
  const event = buildExternalIntegrationEvent({
    externalEventId: "EvDispatch",
  });
  const channelBinding = buildExternalChannelBinding();
  const userBinding = buildExternalUserBinding();
  const sentMessages: Array<{
    channelName: string;
    speaker: string;
    summary: string;
    workspaceId?: string;
    requesterUserId?: string;
    externalInput?: Record<string, unknown>;
  }> = [];
  const mappingInputs: Record<string, unknown>[] = [];
  const calls: string[] = [];

  const result = processSlackInboundEventSync({
    context,
    payload: buildSlackMentionPayload({
      eventId: "EvDispatch",
      messageTs: "1783400007.000100",
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
        return channelBinding;
      },
      readUserBindingByExternalUser: (input) => {
        calls.push("read-user-binding");
        assert.equal(input.externalUserId, "U456");
        return userBinding;
      },
      readUser: (userId) => {
        calls.push("read-user");
        assert.equal(userId, "user-1");
        return buildStoredUser();
      },
      readWorkspaceMembership: (workspaceId, userId) => {
        calls.push("read-membership");
        assert.equal(workspaceId, "workspace-1");
        assert.equal(userId, "user-1");
        return buildWorkspaceMembership();
      },
      canWriteChannelForActor: (input) => {
        calls.push("check-channel-write");
        assert.equal(input.channelName, "general");
        assert.equal(input.actor.userId, "user-1");
        assert.equal(input.actor.role, "member");
        return true;
      },
      sendChannelHumanMessage: (
        channelName,
        speaker,
        summary,
        _attachments,
        _replyToMessageId,
        workspaceId,
        requesterUserId,
        externalInput,
      ) => {
        calls.push("send-human-message");
        sentMessages.push({
          channelName,
          speaker,
          summary,
          workspaceId,
          requesterUserId,
          externalInput: externalInput as Record<string, unknown>,
        });
        return {
          messages: [{
            id: "agent-space-message-1",
            data: {
              external_provider: SLACK_PROVIDER_ID,
              external_message_id: "1783400007.000100",
            },
          }],
        } as never;
      },
      createMessageMapping: (input) => {
        calls.push("create-message-mapping");
        mappingInputs.push(input as Record<string, unknown>);
        return buildExternalMessageMapping({
          externalMessageId: String(input.externalMessageId),
          externalThreadId: String(input.externalThreadId),
          externalEventId: String(input.externalEventId),
          agentSpaceMessageId: input.agentSpaceMessageId,
          metadataJson: JSON.stringify(input.metadataJson),
        });
      },
      updateEventStatus: (input) => {
        calls.push("mark-processed");
        assert.equal(input.status, "processed");
        return {
          ...event,
          status: "processed",
        };
      },
    },
  });

  assert.equal(result.dispatchStatus, "sent");
  assert.equal(result.event.status, "processed");
  assert.equal(result.mappedChannelName, "general");
  assert.equal(result.agentSpaceMessageId, "agent-space-message-1");
  assert.equal(sentMessages.length, 1);
  assert.deepEqual(sentMessages[0], {
    channelName: "general",
    speaker: "Mina",
    summary: "dispatch safely",
    workspaceId: "workspace-1",
    requesterUserId: "user-1",
    externalInput: {
      provider: SLACK_PROVIDER_ID,
      providerLabel: "Slack",
      externalEventId: "EvDispatch",
      externalMessageId: "1783400007.000100",
      externalChatId: "C123",
      externalContext: undefined,
      trust: "untrusted_user_message",
      actor: {
        actorType: "user",
        userId: "user-1",
        externalActorReference: "slack:U456",
        agentId: undefined,
        botBindingId: undefined,
      },
    },
  });
  assert.equal(mappingInputs.length, 1);
  assert.deepEqual(mappingInputs[0], {
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    channelBindingId: "channel-binding-1",
    direction: "inbound",
    externalMessageId: "1783400007.000100",
    externalThreadId: "1783400007.000100",
    externalSenderId: "U456",
    externalEventId: "EvDispatch",
    agentSpaceMessageId: "agent-space-message-1",
    metadataJson: {
      provider: SLACK_PROVIDER_ID,
      channelName: "general",
      slackChannelType: "channel",
      agentContext: undefined,
      agentId: undefined,
      botBindingId: undefined,
      taskQueueId: undefined,
      routerSessionId: undefined,
      threadBindingId: undefined,
    },
  });
  assert.deepEqual(calls, [
    "record-event",
    "read-existing-mapping",
    "read-channel-binding",
    "read-user-binding",
    "read-user",
    "read-membership",
    "check-channel-write",
    "send-human-message",
    "create-message-mapping",
    "mark-processed",
  ]);
});

test("marks Slack inbound events failed when AgentSpace dispatch throws", () => {
  const event = buildExternalIntegrationEvent({
    externalEventId: "EvDispatchFailed",
  });
  let createMappingCalled = false;

  const result = processSlackInboundEventSync({
    context,
    payload: buildSlackMentionPayload({
      eventId: "EvDispatchFailed",
      messageTs: "1783400008.000100",
    }),
    dependencies: {
      recordEvent: () => event,
      readMessageMappingByExternalMessage: () => null,
      readChannelBindingByExternalChat: () => buildExternalChannelBinding(),
      readUserBindingByExternalUser: () => buildExternalUserBinding(),
      readUser: () => buildStoredUser(),
      readWorkspaceMembership: () => buildWorkspaceMembership(),
      canWriteChannelForActor: () => true,
      sendChannelHumanMessage: () => {
        throw new Error("workspace dispatch exploded");
      },
      createMessageMapping: () => {
        createMappingCalled = true;
        return buildExternalMessageMapping();
      },
      updateEventStatus: (input) => {
        assert.equal(input.status, "failed");
        assert.equal(input.errorMessage, "workspace dispatch exploded");
        return {
          ...event,
          status: "failed",
          errorMessage: input.errorMessage,
        };
      },
    },
  });

  assert.equal(result.dispatchStatus, "failed");
  assert.equal(result.reasonCode, "slack.dispatch_failed");
  assert.equal(result.event.status, "failed");
  assert.equal(result.event.errorMessage, "workspace dispatch exploded");
  assert.equal(result.mapping, undefined);
  assert.equal(createMappingCalled, false);
});

test("ignores permission-denied Slack inbound messages without dispatching tasks", () => {
  const event = buildExternalIntegrationEvent({
    externalEventId: "EvPermissionDenied",
  });
  let sendCalled = false;
  let noticeInput: Record<string, unknown> | undefined;
  let ignoredMappingMetadata: Record<string, unknown> | undefined;

  const result = processSlackInboundEventSync({
    context,
    payload: buildSlackMentionPayload({
      eventId: "EvPermissionDenied",
      messageTs: "1783400009.000100",
    }),
    dependencies: {
      recordEvent: () => event,
      readMessageMappingByExternalMessage: () => null,
      readChannelBindingByExternalChat: () => buildExternalChannelBinding(),
      readUserBindingByExternalUser: () => buildExternalUserBinding(),
      readUser: () => buildStoredUser(),
      readWorkspaceMembership: () => buildWorkspaceMembership(),
      canWriteChannelForActor: () => false,
      sendChannelHumanMessage: () => {
        sendCalled = true;
        throw new Error("send should not run for denied users");
      },
      createMessageMapping: (input) => {
        ignoredMappingMetadata = input.metadataJson as Record<string, unknown>;
        return buildExternalMessageMapping({
          externalMessageId: String(input.externalMessageId),
          externalThreadId: String(input.externalThreadId),
          externalEventId: String(input.externalEventId),
          metadataJson: JSON.stringify(input.metadataJson),
        });
      },
      createNoticeOutbox: (input) => {
        noticeInput = input as Record<string, unknown>;
        return buildExternalMessageOutbox(input as Partial<ExternalMessageOutboxRecord>);
      },
      updateEventStatus: (input) => {
        assert.equal(input.status, "ignored");
        assert.equal(input.errorMessage, "slack.channel_access_denied");
        return {
          ...event,
          status: "ignored",
          errorMessage: input.errorMessage,
        };
      },
    },
  });

  assert.equal(result.dispatchStatus, "ignored");
  assert.equal(result.reasonCode, "slack.channel_access_denied");
  assert.equal(result.event.status, "ignored");
  assert.equal(result.noticeOutbox?.targetExternalChatId, "C123");
  assert.equal(result.noticeOutbox?.targetExternalThreadId, "1783400009.000100");
  assert.equal(sendCalled, false);
  assert.equal(ignoredMappingMetadata?.dispatchStatus, "ignored");
  assert.equal(ignoredMappingMetadata?.reasonCode, "slack.channel_access_denied");
  assert.equal(ignoredMappingMetadata?.userId, "user-1");
  assert.equal(noticeInput?.channelBindingId, "channel-binding-1");
  assert.equal(noticeInput?.targetExternalChatId, "C123");
  assert.equal(noticeInput?.targetExternalThreadId, "1783400009.000100");
  assert.doesNotMatch(JSON.stringify(noticeInput?.metadataJson), /C123|U456|1783400009\.000100/);
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

function buildExternalUserBinding(
  overrides: Partial<ExternalUserBindingRecord> = {},
): ExternalUserBindingRecord {
  return {
    id: "user-binding-1",
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    userId: "user-1",
    externalUserId: "U456",
    displayName: "Mina Slack",
    status: "active",
    metadataJson: "{}",
    createdAt: "2026-07-07T04:53:20.000Z",
    updatedAt: "2026-07-07T04:53:20.000Z",
    ...overrides,
  };
}

function buildStoredUser(overrides: Partial<StoredUserRecord> = {}): StoredUserRecord {
  return {
    id: "user-1",
    displayName: "Mina",
    primaryEmail: "mina@example.com",
    createdAt: "2026-07-07T04:53:20.000Z",
    updatedAt: "2026-07-07T04:53:20.000Z",
    ...overrides,
  };
}

function buildWorkspaceMembership(
  overrides: Partial<StoredWorkspaceMembershipRecord> = {},
): StoredWorkspaceMembershipRecord {
  return {
    id: "membership-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    role: "member",
    status: "active",
    joinedAt: "2026-07-07T04:53:20.000Z",
    ...overrides,
  };
}

function buildExternalMessageOutbox(
  overrides: Partial<ExternalMessageOutboxRecord> = {},
): ExternalMessageOutboxRecord {
  const payloadJson = typeof overrides.payloadJson === "string"
    ? overrides.payloadJson
    : JSON.stringify(overrides.payloadJson ?? {});
  const metadataJson = typeof overrides.metadataJson === "string"
    ? overrides.metadataJson
    : JSON.stringify(overrides.metadataJson ?? {});
  return {
    id: "outbox-1",
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    channelBindingId: "channel-binding-1",
    targetExternalChatId: "C123",
    targetExternalThreadId: "1783400009.000100",
    payloadJson,
    metadataJson,
    status: "pending",
    attempts: 0,
    createdAt: "2026-07-07T04:53:20.000Z",
    updatedAt: "2026-07-07T04:53:20.000Z",
    ...overrides,
    payloadJson,
    metadataJson,
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
