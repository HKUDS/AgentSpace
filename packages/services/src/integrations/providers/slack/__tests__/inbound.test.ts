import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExternalIntegrationRecord,
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
  assert.equal(notice.metadataJson.reasonCode, undefined);
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
        assert.equal(metadata.reasonCode, "slack.channel_binding_missing");
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
        assert.equal(metadata.reasonCode, "slack.user_binding_missing");
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
        externalActorReference: resultExternalActorReference(sentMessages[0]?.externalInput),
        agentId: undefined,
        botBindingId: undefined,
      },
    },
  });
  assert.match(resultExternalActorReference(sentMessages[0]?.externalInput), /^ref_[a-f0-9]{8}$/);
  assert.notEqual(resultExternalActorReference(sentMessages[0]?.externalInput), "slack:U456");
  assert.doesNotMatch(JSON.stringify(sentMessages[0]?.externalInput?.actor), /U456/);
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
      taskAgentId: undefined,
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

test("records task evidence for bound Slack app mentions that target an AgentSpace agent", () => {
  const event = buildExternalIntegrationEvent({
    externalEventId: "EvMentionTask",
  });
  const channelBinding = buildExternalChannelBinding();
  const userBinding = buildExternalUserBinding();
  const mappingInputs: Record<string, unknown>[] = [];
  const taskResolutionInputs: Record<string, unknown>[] = [];
  const threadBindingInputs: Record<string, unknown>[] = [];

  const result = processSlackInboundEventSync({
    context,
    integration: buildExternalIntegration({
      appId: "A123",
      tenantKey: "T123",
    }),
    payload: buildSlackMentionPayload({
      eventId: "EvMentionTask",
      messageTs: "1783400008.000100",
      text: "<@UBOT> @Atlas handle launch blockers",
    }),
    dependencies: {
      recordEvent: () => event,
      readMessageMappingByExternalMessage: () => null,
      readChannelBindingByExternalChat: () => channelBinding,
      readUserBindingByExternalUser: () => userBinding,
      readUser: () => buildStoredUser(),
      readWorkspaceMembership: () => buildWorkspaceMembership(),
      canWriteChannelForActor: () => true,
      sendChannelHumanMessage: (
        _channelName,
        _speaker,
        summary,
        _attachments,
        _replyToMessageId,
        _workspaceId,
        _requesterUserId,
        _externalInput,
      ) => {
        assert.equal(summary, "@Atlas handle launch blockers");
        return {
          messages: [{
            id: "agent-space-message-task",
            data: {
              external_provider: SLACK_PROVIDER_ID,
              external_message_id: "1783400008.000100",
            },
            mentions: [{
              mentionType: "agent",
              agentId: "Atlas",
              label: "Atlas",
              token: "Atlas",
              inChannel: true,
            }],
          }],
        } as never;
      },
      resolveDispatchedTask: (input) => {
        taskResolutionInputs.push(input);
        return {
          id: "task-atlas-mention",
          routerSessionId: "router-atlas-mention",
        } as never;
      },
      recordThreadBinding: (input) => {
        threadBindingInputs.push({
          integrationId: input.integration.id,
          channelBindingId: input.channelBinding.id,
          agentId: input.agentId,
          taskQueueId: input.taskQueueId,
          routerSessionId: input.routerSessionId,
          agentSpaceMessageId: input.agentSpaceMessageId,
        });
        return { id: "thread-binding-atlas-mention" } as never;
      },
      createMessageMapping: (input) => {
        mappingInputs.push(input as Record<string, unknown>);
        return buildExternalMessageMapping({
          externalMessageId: String(input.externalMessageId),
          externalThreadId: String(input.externalThreadId),
          externalEventId: String(input.externalEventId),
          agentSpaceMessageId: input.agentSpaceMessageId,
          metadataJson: JSON.stringify(input.metadataJson),
        });
      },
      updateEventStatus: (input) => ({
        ...event,
        status: input.status,
        errorMessage: input.errorMessage,
      }),
    },
  });

  assert.equal(result.dispatchStatus, "sent");
  assert.equal(result.agentSpaceMessageId, "agent-space-message-task");
  assert.deepEqual(taskResolutionInputs, [{
    workspaceId: "workspace-1",
    channelName: "general",
    agentId: "Atlas",
    sourceMessageId: "agent-space-message-task",
  }]);
  assert.deepEqual(threadBindingInputs, [{
    integrationId: "slack-1",
    channelBindingId: "channel-binding-1",
    agentId: "Atlas",
    taskQueueId: "task-atlas-mention",
    routerSessionId: "router-atlas-mention",
    agentSpaceMessageId: "agent-space-message-task",
  }]);
  const metadata = mappingInputs[0]?.metadataJson as Record<string, unknown>;
  assert.equal(metadata.agentId, undefined);
  assert.equal(metadata.botBindingId, undefined);
  assert.equal(metadata.taskAgentId, "Atlas");
  assert.equal(metadata.taskQueueId, "task-atlas-mention");
  assert.equal(metadata.routerSessionId, "router-atlas-mention");
  assert.equal(metadata.threadBindingId, "thread-binding-atlas-mention");
  assert.equal(JSON.stringify(metadata).includes("C123"), false);
  assert.equal(JSON.stringify(metadata).includes("U456"), false);
});

test("dispatches agent-scoped Slack bot mentions as AgentSpace @agent messages", () => {
  const integrationId = "slack-agent-integration";
  const event = buildExternalIntegrationEvent({
    integrationId,
    externalEventId: "EvAgentDispatch",
  });
  const mappingInputs: Record<string, unknown>[] = [];
  const sentMessages: Array<{
    summary: string;
    externalInput?: Record<string, unknown>;
  }> = [];
  const routeGuardInputs: Record<string, unknown>[] = [];
  const taskResolutionInputs: Record<string, unknown>[] = [];
  const threadBindingInputs: Record<string, unknown>[] = [];

  const result = processSlackInboundEventSync({
    context: {
      workspaceId: "workspace-1",
      integrationId,
      provider: SLACK_PROVIDER_ID,
    },
    integration: buildExternalIntegration({
      id: integrationId,
      workspaceId: "workspace-1",
      agentId: "Atlas",
      configJson: JSON.stringify({
        bot: {
          botUserId: "UBOT",
        },
      }),
    }),
    payload: buildSlackMentionPayload({
      eventId: "EvAgentDispatch",
      messageTs: "1783400010.000100",
      text: "<@UBOT> prepare the launch checklist",
    }),
    dependencies: {
      recordEvent: () => event,
      readMessageMappingByExternalMessage: () => null,
      readChannelBindingByExternalChat: () => buildExternalChannelBinding({
        integrationId,
        channelName: "general",
        externalChatId: "C123",
      }),
      readUserBindingByExternalUser: () => buildExternalUserBinding({
        integrationId,
        userId: "user-1",
        externalUserId: "U456",
        displayName: "Mina Slack",
      }),
      readUser: () => buildStoredUser(),
      readWorkspaceMembership: () => buildWorkspaceMembership(),
      canWriteChannelForActor: () => true,
      evaluateAgentRouteGuard: (input) => {
        routeGuardInputs.push({
          workspaceId: input.workspaceId,
          channelName: input.channelName,
          agentId: input.integration?.agentId,
          actor: input.actor,
        });
        return { allowed: true };
      },
      sendChannelHumanMessage: (
        _channelName,
        _speaker,
        summary,
        _attachments,
        _replyToMessageId,
        _workspaceId,
        _requesterUserId,
        externalInput,
      ) => {
        sentMessages.push({
          summary,
          externalInput: externalInput as Record<string, unknown>,
        });
        return {
          messages: [{
            id: "agent-space-message-agent",
            data: {
              external_provider: SLACK_PROVIDER_ID,
              external_message_id: "1783400010.000100",
            },
          }],
        } as never;
      },
      resolveDispatchedTask: (input) => {
        taskResolutionInputs.push(input);
        return {
          id: "task-agent-1",
          routerSessionId: "router-agent-1",
        } as never;
      },
      recordThreadBinding: (input) => {
        threadBindingInputs.push({
          integrationId: input.integration.id,
          channelBindingId: input.channelBinding.id,
          agentId: input.agentId,
          taskQueueId: input.taskQueueId,
          routerSessionId: input.routerSessionId,
          agentSpaceMessageId: input.agentSpaceMessageId,
        });
        return { id: "thread-binding-agent" } as never;
      },
      createMessageMapping: (input) => {
        mappingInputs.push(input as Record<string, unknown>);
        return buildExternalMessageMapping({
          integrationId,
          externalMessageId: String(input.externalMessageId),
          externalThreadId: String(input.externalThreadId),
          externalEventId: String(input.externalEventId),
          agentSpaceMessageId: input.agentSpaceMessageId,
          metadataJson: JSON.stringify(input.metadataJson),
        });
      },
      updateEventStatus: (input) => ({
        ...event,
        status: input.status,
        errorMessage: input.errorMessage,
      }),
    },
  });

  assert.equal(result.dispatchStatus, "sent");
  assert.equal(result.event.status, "processed");
  assert.equal(result.mappedChannelName, "general");
  assert.equal(result.agentSpaceMessageId, "agent-space-message-agent");
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0]?.summary, "@Atlas prepare the launch checklist");
  assert.deepEqual(routeGuardInputs, [{
    workspaceId: "workspace-1",
    channelName: "general",
    agentId: "Atlas",
    actor: {
      userId: "user-1",
      displayName: "Mina",
      role: "member",
    },
  }]);
  assert.deepEqual(taskResolutionInputs, [{
    workspaceId: "workspace-1",
    channelName: "general",
    agentId: "Atlas",
    sourceMessageId: "agent-space-message-agent",
  }]);
  assert.deepEqual(threadBindingInputs, [{
    integrationId,
    channelBindingId: "channel-binding-1",
    agentId: "Atlas",
    taskQueueId: "task-agent-1",
    routerSessionId: "router-agent-1",
    agentSpaceMessageId: "agent-space-message-agent",
  }]);
  assert.deepEqual(sentMessages[0]?.externalInput, {
    provider: SLACK_PROVIDER_ID,
    providerLabel: "Slack",
    externalEventId: "EvAgentDispatch",
    externalMessageId: "1783400010.000100",
    externalChatId: "C123",
    externalContext: undefined,
    trust: "untrusted_user_message",
    actor: {
      actorType: "user",
      userId: "user-1",
      externalActorReference: resultExternalActorReference(sentMessages[0]?.externalInput),
      agentId: "Atlas",
      botBindingId: integrationId,
    },
  });
  assert.match(resultExternalActorReference(sentMessages[0]?.externalInput), /^ref_[a-f0-9]{8}$/);
  assert.notEqual(resultExternalActorReference(sentMessages[0]?.externalInput), "slack:U456");
  assert.doesNotMatch(JSON.stringify(sentMessages[0]?.externalInput?.actor), /U456/);

  assert.equal(mappingInputs.length, 1);
  assert.equal(mappingInputs[0]?.agentSpaceMessageId, result.agentSpaceMessageId);
  const metadata = mappingInputs[0]?.metadataJson as Record<string, unknown>;
  assert.equal(metadata.agentId, "Atlas");
  assert.equal(metadata.botBindingId, integrationId);
  assert.equal(metadata.taskAgentId, "Atlas");
  assert.equal(metadata.taskQueueId, "task-agent-1");
  assert.equal(metadata.routerSessionId, "router-agent-1");
  assert.equal(metadata.threadBindingId, "thread-binding-agent");
  assert.equal(JSON.stringify(metadata).includes("C123"), false);
  assert.equal(JSON.stringify(metadata).includes("U456"), false);
});

test("routes multiple agent-scoped Slack bots in one Slack channel independently", () => {
  const atlas = dispatchAgentScopedSlackInbound({
    integrationId: "slack-atlas",
    agentId: "Atlas",
    botUserId: "UATLAS",
    eventId: "EvAtlasDispatch",
    appId: "A_ATLAS",
    messageTs: "1783400011.000100",
    text: "<@UATLAS> summarize the launch plan",
    channelId: "C_SHARED",
  });
  const nova = dispatchAgentScopedSlackInbound({
    integrationId: "slack-nova",
    agentId: "Nova",
    botUserId: "UNOVA",
    eventId: "EvNovaDispatch",
    appId: "A_NOVA",
    messageTs: "1783400011.000200",
    text: "<@UNOVA> review the metrics",
    channelId: "C_SHARED",
  });

  assert.equal(atlas.result.dispatchStatus, "sent");
  assert.equal(nova.result.dispatchStatus, "sent");
  assert.equal(atlas.sentMessages[0]?.summary, "@Atlas summarize the launch plan");
  assert.equal(nova.sentMessages[0]?.summary, "@Nova review the metrics");
  assert.equal(atlas.routeGuardInputs[0]?.agentId, "Atlas");
  assert.equal(nova.routeGuardInputs[0]?.agentId, "Nova");
  assert.equal(atlas.taskResolutionInputs[0]?.agentId, "Atlas");
  assert.equal(nova.taskResolutionInputs[0]?.agentId, "Nova");
  assert.equal(atlas.threadBindingInputs[0]?.taskQueueId, "task-atlas");
  assert.equal(nova.threadBindingInputs[0]?.taskQueueId, "task-nova");

  const atlasMetadata = atlas.mappingInputs[0]?.metadataJson as Record<string, unknown>;
  const novaMetadata = nova.mappingInputs[0]?.metadataJson as Record<string, unknown>;
  assert.equal(atlasMetadata.agentId, "Atlas");
  assert.equal(novaMetadata.agentId, "Nova");
  assert.equal(atlasMetadata.botBindingId, "slack-atlas");
  assert.equal(novaMetadata.botBindingId, "slack-nova");
  assert.equal(atlasMetadata.threadBindingId, "thread-atlas");
  assert.equal(novaMetadata.threadBindingId, "thread-nova");
  assert.equal(JSON.stringify(atlasMetadata).includes("C_SHARED"), false);
  assert.equal(JSON.stringify(novaMetadata).includes("C_SHARED"), false);
});

test("ignores agent-scoped Slack bot self-loop messages before dispatch", () => {
  const integrationId = "slack-self-loop";
  const event = buildExternalIntegrationEvent({
    integrationId,
    externalEventId: "EvSelfLoop",
  });
  const calls: string[] = [];

  const result = processSlackInboundEventSync({
    context: {
      workspaceId: "workspace-1",
      integrationId,
      provider: SLACK_PROVIDER_ID,
    },
    integration: buildExternalIntegration({
      id: integrationId,
      workspaceId: "workspace-1",
      agentId: "Atlas",
      configJson: JSON.stringify({
        bot: {
          botUserId: "UBOT",
        },
      }),
    }),
    payload: buildSlackMentionPayload({
      eventId: "EvSelfLoop",
      messageTs: "1783400012.000100",
      text: "<@UBOT> loop back into AgentSpace",
      user: "UBOT",
    }),
    dependencies: {
      recordEvent: () => {
        calls.push("record-event");
        return event;
      },
      readMessageMappingByExternalMessage: () => {
        assert.fail("self-loop message should not reach duplicate lookup");
      },
      readChannelBindingByExternalChat: () => {
        assert.fail("self-loop message should not reach channel binding lookup");
      },
      sendChannelHumanMessage: () => {
        assert.fail("self-loop message should not dispatch to AgentSpace");
      },
      updateEventStatus: (input) => {
        calls.push("mark-ignored");
        assert.equal(input.status, "ignored");
        assert.equal(input.errorMessage, "slack.non_message_event");
        return {
          ...event,
          status: "ignored",
          errorMessage: input.errorMessage,
        };
      },
    },
  });

  assert.equal(result.dispatchStatus, "ignored");
  assert.equal(result.reasonCode, "slack.non_message_event");
  assert.equal(result.message, null);
  assert.deepEqual(calls, ["record-event", "mark-ignored"]);
});

test("dispatches Slack agent_view DMs with governed redacted app context", () => {
  const dm = dispatchAgentScopedSlackInbound({
    integrationId: "slack-agent-view-dm",
    agentId: "Atlas",
    botUserId: "UATLAS",
    eventId: "EvAgentViewDm",
    appId: "A_ATLAS",
    messageTs: "1783400013.000100",
    eventType: "message",
    channelId: "D_ATLAS",
    channelType: "im",
    text: "inspect the selected brief",
    appContext: {
      entities: [{
        type: "slack#/types/channel_id",
        value: "C_SECRET_VIEWED",
        team_id: "T_SECRET_TEAM",
        enterprise_id: "E_SECRET_ENTERPRISE",
      }],
    },
  });

  assert.equal(dm.result.dispatchStatus, "sent");
  assert.equal(dm.sentMessages[0]?.summary, "@Atlas inspect the selected brief");
  assert.equal(dm.channelWriteInputs.length, 1);
  assert.equal(dm.routeGuardInputs.length, 1);
  assert.equal(dm.channelWriteInputs[0]?.channelName, "general");
  assert.equal(dm.routeGuardInputs[0]?.agentId, "Atlas");
  const externalInput = dm.sentMessages[0]?.externalInput;
  const actor = externalInput?.actor as Record<string, unknown> | undefined;
  assert.equal(externalInput?.trust, "untrusted_user_message");
  assert.equal(actor?.agentId, "Atlas");
  assert.equal(actor?.botBindingId, "slack-agent-view-dm");

  const externalContext = String(externalInput?.externalContext);
  const parsedExternalContext = JSON.parse(externalContext) as Record<string, unknown>;
  const slackAgentContext = parsedExternalContext.slackAgentContext as Record<string, unknown>;
  assert.equal(slackAgentContext.source, "app_context");
  assert.equal(slackAgentContext.hasEntities, true);
  assert.doesNotMatch(externalContext, /C_SECRET_VIEWED|T_SECRET_TEAM|E_SECRET_ENTERPRISE/);
  assert.match(externalContext, /ref_[a-f0-9]{8}/);

  const metadata = dm.mappingInputs[0]?.metadataJson as Record<string, unknown>;
  assert.equal(typeof metadata.agentContext, "object");
  assert.equal(metadata.agentId, "Atlas");
  assert.equal(metadata.botBindingId, "slack-agent-view-dm");
  assert.doesNotMatch(JSON.stringify(metadata), /C_SECRET_VIEWED|T_SECRET_TEAM|E_SECRET_ENTERPRISE|D_ATLAS/);
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

test("queues a Slack notice when the target agent runtime is unavailable", () => {
  const event = buildExternalIntegrationEvent({
    integrationId: "slack-agent-1",
    externalEventId: "EvRuntimeUnavailable",
  });
  let sendCalled = false;
  let noticeInput: Record<string, unknown> | undefined;
  let ignoredMappingMetadata: Record<string, unknown> | undefined;

  const result = processSlackInboundEventSync({
    context: {
      workspaceId: "workspace-1",
      integrationId: "slack-agent-1",
      provider: SLACK_PROVIDER_ID,
    },
    integration: buildExternalIntegration({
      id: "slack-agent-1",
      workspaceId: "workspace-1",
      appId: "A123",
      tenantKey: "T123",
      agentId: "Atlas",
    }),
    payload: buildSlackMentionPayload({
      eventId: "EvRuntimeUnavailable",
      messageTs: "1783400010.000100",
      text: "<@UBOT> @Atlas take this",
    }),
    dependencies: {
      recordEvent: () => event,
      readMessageMappingByExternalMessage: () => null,
      readChannelBindingByExternalChat: () => buildExternalChannelBinding({
        id: "channel-binding-atlas",
        integrationId: "slack-agent-1",
      }),
      readUserBindingByExternalUser: () => buildExternalUserBinding({
        integrationId: "slack-agent-1",
      }),
      readUser: () => buildStoredUser(),
      readWorkspaceMembership: () => buildWorkspaceMembership(),
      canWriteChannelForActor: () => true,
      evaluateAgentRouteGuard: () => ({
        allowed: false,
        reasonCode: "slack.agent_runtime_unavailable",
      }),
      sendChannelHumanMessage: () => {
        sendCalled = true;
        throw new Error("send should not run when runtime is unavailable");
      },
      createMessageMapping: (input) => {
        ignoredMappingMetadata = input.metadataJson as Record<string, unknown>;
        return buildExternalMessageMapping({
          integrationId: "slack-agent-1",
          channelBindingId: "channel-binding-atlas",
          externalMessageId: String(input.externalMessageId),
          externalThreadId: String(input.externalThreadId),
          externalEventId: String(input.externalEventId),
          metadataJson: JSON.stringify(input.metadataJson),
        });
      },
      createNoticeOutbox: (input) => {
        noticeInput = input as Record<string, unknown>;
        return buildExternalMessageOutbox({
          ...(input as Partial<ExternalMessageOutboxRecord>),
          integrationId: "slack-agent-1",
          channelBindingId: "channel-binding-atlas",
        });
      },
      updateEventStatus: (input) => {
        assert.equal(input.status, "ignored");
        assert.equal(input.errorMessage, "slack.agent_runtime_unavailable");
        return {
          ...event,
          status: "ignored",
          errorMessage: input.errorMessage,
        };
      },
    },
  });

  assert.equal(result.dispatchStatus, "ignored");
  assert.equal(result.reasonCode, "slack.agent_runtime_unavailable");
  assert.equal(result.event.status, "ignored");
  assert.equal(result.event.errorMessage, "slack.agent_runtime_unavailable");
  assert.equal(sendCalled, false);
  assert.equal(ignoredMappingMetadata?.dispatchStatus, "ignored");
  assert.equal(ignoredMappingMetadata?.reasonCode, "slack.agent_runtime_unavailable");
  assert.equal(noticeInput?.channelBindingId, "channel-binding-atlas");
  assert.equal(noticeInput?.targetExternalChatId, "C123");
  assert.equal(noticeInput?.targetExternalThreadId, "1783400010.000100");
  const noticeMetadata = noticeInput?.metadataJson as Record<string, unknown> | undefined;
  assert.equal(noticeMetadata?.outboxSource, "inbound_permission_notice");
  assert.equal(noticeMetadata?.noticeType, "permission_denied");
  assert.equal(noticeMetadata?.reasonCode, "slack.agent_runtime_unavailable");
  assert.doesNotMatch(JSON.stringify(noticeMetadata), /C123|U456|1783400010\.000100/);
});

function resultExternalActorReference(externalInput: Record<string, unknown> | undefined): string {
  const actor = externalInput?.actor as Record<string, unknown> | undefined;
  return typeof actor?.externalActorReference === "string" ? actor.externalActorReference : "";
}

function buildSlackMentionPayload(input: {
  eventId: string;
  messageTs: string;
  appId?: string;
  teamId?: string;
  eventType?: "app_mention" | "message";
  channelId?: string;
  channelType?: string;
  user?: string;
  text?: string;
  appContext?: Record<string, unknown>;
}): Record<string, unknown> {
  const event: Record<string, unknown> = {
    type: input.eventType ?? "app_mention",
    channel: input.channelId ?? "C123",
    user: input.user ?? "U456",
    text: input.text ?? "<@UBOT> dispatch safely",
    ts: input.messageTs,
  };
  if (input.channelType) {
    event.channel_type = input.channelType;
  }
  if (input.appContext) {
    event.app_context = input.appContext;
  }
  return {
    type: "event_callback",
    event_id: input.eventId,
    event_time: 1783400005,
    api_app_id: input.appId ?? "A123",
    team_id: input.teamId ?? "T123",
    event,
  };
}

function dispatchAgentScopedSlackInbound(input: {
  integrationId: string;
  agentId: string;
  botUserId: string;
  eventId: string;
  appId: string;
  messageTs: string;
  text: string;
  eventType?: "app_mention" | "message";
  channelId?: string;
  channelType?: string;
  appContext?: Record<string, unknown>;
}) {
  const channelId = input.channelId ?? "C123";
  const agentSlug = input.agentId.toLowerCase();
  const event = buildExternalIntegrationEvent({
    integrationId: input.integrationId,
    externalEventId: input.eventId,
    eventType: input.eventType === "message"
      ? "event_callback.message"
      : "event_callback.app_mention",
  });
  const sentMessages: Array<{
    summary: string;
    externalInput?: Record<string, unknown>;
  }> = [];
  const channelWriteInputs: Record<string, unknown>[] = [];
  const routeGuardInputs: Record<string, unknown>[] = [];
  const taskResolutionInputs: Record<string, unknown>[] = [];
  const threadBindingInputs: Record<string, unknown>[] = [];
  const mappingInputs: Record<string, unknown>[] = [];

  const result = processSlackInboundEventSync({
    context: {
      workspaceId: "workspace-1",
      integrationId: input.integrationId,
      provider: SLACK_PROVIDER_ID,
    },
    integration: buildExternalIntegration({
      id: input.integrationId,
      workspaceId: "workspace-1",
      appId: input.appId,
      tenantKey: "T123",
      agentId: input.agentId,
      configJson: JSON.stringify({
        bot: {
          botUserId: input.botUserId,
        },
      }),
    }),
    payload: buildSlackMentionPayload({
      eventId: input.eventId,
      appId: input.appId,
      messageTs: input.messageTs,
      eventType: input.eventType,
      channelId,
      channelType: input.channelType,
      text: input.text,
      appContext: input.appContext,
    }),
    dependencies: {
      recordEvent: () => event,
      readMessageMappingByExternalMessage: () => null,
      readChannelBindingByExternalChat: (lookup) => {
        assert.equal(lookup.integrationId, input.integrationId);
        assert.equal(lookup.externalChatId, channelId);
        return buildExternalChannelBinding({
          id: `channel-binding-${agentSlug}`,
          integrationId: input.integrationId,
          channelName: "general",
          externalChatId: channelId,
          externalChatType: input.channelType === "im" ? "im" : "channel",
        });
      },
      readUserBindingByExternalUser: (lookup) => {
        assert.equal(lookup.integrationId, input.integrationId);
        assert.equal(lookup.externalUserId, "U456");
        return buildExternalUserBinding({
          id: `user-binding-${agentSlug}`,
          integrationId: input.integrationId,
          userId: "user-1",
          externalUserId: "U456",
          displayName: "Mina Slack",
        });
      },
      readUser: () => buildStoredUser(),
      readWorkspaceMembership: () => buildWorkspaceMembership(),
      canWriteChannelForActor: (guardInput) => {
        channelWriteInputs.push({
          channelName: guardInput.channelName,
          actor: guardInput.actor,
        });
        return true;
      },
      evaluateAgentRouteGuard: (guardInput) => {
        routeGuardInputs.push({
          workspaceId: guardInput.workspaceId,
          channelName: guardInput.channelName,
          agentId: guardInput.integration?.agentId,
          actor: guardInput.actor,
        });
        return { allowed: true };
      },
      sendChannelHumanMessage: (
        _channelName,
        _speaker,
        summary,
        _attachments,
        _replyToMessageId,
        _workspaceId,
        _requesterUserId,
        externalInput,
      ) => {
        sentMessages.push({
          summary,
          externalInput: externalInput as Record<string, unknown>,
        });
        return {
          messages: [{
            id: `message-${agentSlug}`,
            data: {
              external_provider: SLACK_PROVIDER_ID,
              external_message_id: input.messageTs,
            },
          }],
        } as never;
      },
      resolveDispatchedTask: (taskInput) => {
        taskResolutionInputs.push(taskInput);
        return {
          id: `task-${agentSlug}`,
          routerSessionId: `router-${agentSlug}`,
        } as never;
      },
      recordThreadBinding: (threadInput) => {
        threadBindingInputs.push({
          integrationId: threadInput.integration.id,
          channelBindingId: threadInput.channelBinding.id,
          agentId: threadInput.agentId,
          taskQueueId: threadInput.taskQueueId,
          routerSessionId: threadInput.routerSessionId,
          agentSpaceMessageId: threadInput.agentSpaceMessageId,
        });
        return { id: `thread-${agentSlug}` } as never;
      },
      createMessageMapping: (mappingInput) => {
        mappingInputs.push(mappingInput as Record<string, unknown>);
        return buildExternalMessageMapping({
          integrationId: input.integrationId,
          channelBindingId: `channel-binding-${agentSlug}`,
          externalMessageId: String(mappingInput.externalMessageId),
          externalThreadId: String(mappingInput.externalThreadId),
          externalEventId: String(mappingInput.externalEventId),
          agentSpaceMessageId: mappingInput.agentSpaceMessageId,
          metadataJson: JSON.stringify(mappingInput.metadataJson),
        });
      },
      updateEventStatus: (statusInput) => ({
        ...event,
        status: statusInput.status,
        errorMessage: statusInput.errorMessage,
      }),
    },
  });

  return {
    result,
    sentMessages,
    channelWriteInputs,
    routeGuardInputs,
    taskResolutionInputs,
    threadBindingInputs,
    mappingInputs,
  };
}

function buildExternalIntegration(
  overrides: Partial<ExternalIntegrationRecord> = {},
): ExternalIntegrationRecord {
  return {
    id: "slack-1",
    workspaceId: "workspace-1",
    provider: SLACK_PROVIDER_ID,
    displayName: "Slack",
    status: "active",
    transportMode: "websocket_worker",
    encryptedCredentialsJson: "{}",
    configJson: "{}",
    capabilitiesJson: "{}",
    scopesJson: "[]",
    createdAt: "2026-07-07T04:53:20.000Z",
    updatedAt: "2026-07-07T04:53:20.000Z",
    ...overrides,
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
