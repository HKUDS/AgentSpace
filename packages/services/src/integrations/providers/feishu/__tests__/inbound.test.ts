import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { before, beforeEach } from "node:test";
import {
  createExternalIntegrationSync,
  createUserSync,
  createWorkspaceMembershipSync,
  DEFAULT_WORKSPACE_ID,
  getDatabase,
  listQueuedTasksSync,
  readExternalChannelBindingByExternalChatSync,
  readExternalMessageMappingByExternalMessageSync,
  readExternalIntegrationEventSync,
  registerDaemonRuntimesSync,
  type WorkspaceRole,
  upsertExternalChannelBindingSync,
  upsertExternalUserBindingSync,
} from "@agent-space/db";
import {
  bindEmployeeRuntimeSync,
  createEmployeeSync,
  ensureDirectChannelSync,
  initializeOrganizationSync,
  readWorkspaceStateSync,
  resetWorkspaceStateSync,
  writeWorkspaceStateSync,
} from "../../../../index.ts";
import { FEISHU_PROVIDER_ID } from "../constants.ts";
import { createFeishuAgentBotBindingSync } from "../agent-bot-bindings.ts";
import { FEISHU_EXTERNAL_GUEST_DISPLAY_NAME } from "../external-guests.ts";
import { readFeishuThreadBindingSync } from "../thread-bindings.ts";
import {
  processFeishuInboundEvent,
  processFeishuInboundEventSync,
  recordFeishuCardActionCallbackIgnoredSync,
  recordFeishuCallbackRejectedSync,
} from "../inbound.ts";

const originalCwd = process.cwd();
const repositoryRoot = existsSync(join(originalCwd, "Target.md")) ? originalCwd : join(originalCwd, "..", "..", "..", "..");
const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-feishu-inbound-"));
const databaseTestOptions = process.env.AGENT_SPACE_FEISHU_INBOUND_DB_TESTS === "1"
  ? {}
  : { skip: "Set AGENT_SPACE_FEISHU_INBOUND_DB_TESTS=1 with a test Postgres URL to run Feishu inbound DB integration tests." };

before(() => {
  writeFileSync(join(tempRoot, "Target.md"), "# test\n");
  mkdirSync(join(tempRoot, "data"), { recursive: true });
  const packagesLink = join(tempRoot, "packages");
  if (!existsSync(packagesLink)) {
    symlinkSync(join(repositoryRoot, "packages"), packagesLink, "dir");
  }
  process.chdir(tempRoot);
  process.env.AGENT_SPACE_DEPLOYMENT_MODE = "self_hosted";
  process.env.AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY = Buffer
    .from("0123456789abcdef0123456789abcdef", "utf8")
    .toString("base64");
});

beforeEach(() => {
  getDatabase().exec(`
    DELETE FROM external_message_outbox;
    DELETE FROM external_message_mapping;
    DELETE FROM external_thread_binding;
    DELETE FROM external_integration_event;
    DELETE FROM external_data_operation_run;
    DELETE FROM external_resource_binding;
    DELETE FROM external_channel_binding;
    DELETE FROM external_user_binding;
    DELETE FROM external_integration;
    DELETE FROM agent_task_queue;
    DELETE FROM employee_runtime_binding;
    DELETE FROM agent_runtime;
    DELETE FROM daemon_connection;
    DELETE FROM workspace_employee;
    DELETE FROM workspace_channel;
    DELETE FROM workspace_snapshot;
    DELETE FROM workspace_membership;
    DELETE FROM workspace;
    DELETE FROM users;
  `);
  resetWorkspaceStateSync(DEFAULT_WORKSPACE_ID);
  initializeOrganizationSync({
    organizationName: "Northstar Labs",
    ownerName: "Mina",
    ownerRole: "Owner",
    firstChannelName: "general",
  }, DEFAULT_WORKSPACE_ID);
});

test("bound Feishu messages enter the AgentSpace channel message and task queue path", databaseTestOptions, () => {
  const fixtures = seedBoundFeishuWorkspace();

  const result = processFeishuInboundEventSync({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: fixtures.integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    payload: buildFeishuMessagePayload({
      eventId: "evt-bound-1",
      messageId: "om-bound-1",
      text: '<at user_id="bot_open_id">@AgentSpaceBot</at> @Atlas summarize this',
    }),
    queueNotices: false,
  });

  assert.equal(result.dispatchStatus, "sent");
  assert.equal(result.mappedChannelName, "general");

  const state = readWorkspaceStateSync(DEFAULT_WORKSPACE_ID);
  const humanMessage = state.messages.find((message) =>
    message.channel === "general" &&
    message.speaker === "Mina" &&
    message.speakerUserId === fixtures.user.id &&
    message.summary === "@Atlas summarize this"
  );
  assert.ok(humanMessage);
  assert.deepEqual(humanMessage.data, {
    external_provider: FEISHU_PROVIDER_ID,
    external_provider_label: "Feishu/Lark",
    external_event_id: "evt-bound-1",
    external_message_id: "om-bound-1",
    external_chat_id: "oc_general",
    external_trust: "untrusted_user_message",
    workspace_data_policy_decision: "allow",
    workspace_data_policy_reason: "workspace_data.external_untrusted_user_message_allowed",
    workspace_data_classification: "external_untrusted_user_content",
    workspace_data_store: "true",
    workspace_data_search: "true",
    workspace_data_agent_context: "true",
  });
  const [queuedTask] = listQueuedTasksSync({ workspaceId: DEFAULT_WORKSPACE_ID });
  assert.ok(queuedTask);
  const queuedPayload = JSON.parse(queuedTask.inputJson) as {
    externalInput?: {
      provider?: string;
      externalEventId?: string;
      externalMessageId?: string;
      externalChatId?: string;
      trust?: string;
    };
  };
  assert.deepEqual(queuedPayload.externalInput, {
    provider: FEISHU_PROVIDER_ID,
    providerLabel: "Feishu/Lark",
    externalEventId: "evt-bound-1",
    externalMessageId: "om-bound-1",
    externalChatId: "oc_general",
    trust: "untrusted_user_message",
    workspaceDataPolicy: expectedWorkspaceDataPolicy({
      externalEventId: "evt-bound-1",
      externalMessageId: "om-bound-1",
      externalChatId: "oc_general",
    }),
  });

  const event = readExternalIntegrationEventSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    provider: FEISHU_PROVIDER_ID,
    externalEventId: "evt-bound-1",
  });
  assert.ok(event);
  const payloadSummary = JSON.parse(event.payloadJson) as {
    rawPayloadStored?: boolean;
    contentRedacted?: boolean;
    payloadHash?: string;
    message?: {
      messageId?: string;
      chatId?: string;
      contentLength?: number;
      contentHash?: string;
    };
  };
  assert.equal(payloadSummary.rawPayloadStored, false);
  assert.equal(payloadSummary.contentRedacted, true);
  assert.equal(payloadSummary.message?.messageId, "om-bound-1");
  assert.equal(payloadSummary.message?.chatId, "oc_general");
  assert.ok((payloadSummary.message?.contentLength ?? 0) > 0);
  assert.match(payloadSummary.message?.contentHash ?? "", /^[a-f0-9]{64}$/);
  assert.match(payloadSummary.payloadHash ?? "", /^[a-f0-9]{64}$/);
  assert.doesNotMatch(event.payloadJson, /summarize this/);
  assert.doesNotMatch(event.payloadJson, /AgentSpaceBot/);

  const mapping = readExternalMessageMappingByExternalMessageSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: fixtures.integration.id,
    externalMessageId: "om-bound-1",
  });
  assert.ok(mapping);
  assert.equal(JSON.parse(mapping.metadataJson).dispatchStatus, "sent");
});

test("bound Feishu direct messages enter the AgentSpace contact chat path without @Agent", databaseTestOptions, () => {
  const fixtures = seedBoundFeishuWorkspace({ bindChannel: false });
  const direct = ensureDirectChannelSync({
    humanMemberName: "Mina",
    employeeName: "Atlas",
  }, DEFAULT_WORKSPACE_ID);
  upsertExternalChannelBindingSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: fixtures.integration.id,
    channelName: direct.channelName,
    externalChatId: "oc_direct",
    externalChatType: "p2p",
    externalChatName: "Mina <> Atlas",
  });

  const result = processFeishuInboundEventSync({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: fixtures.integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    payload: buildFeishuMessagePayload({
      eventId: "evt-direct-1",
      messageId: "om-direct-1",
      chatId: "oc_direct",
      chatType: "p2p",
      text: "Please plan a quiet itinerary",
    }),
    queueNotices: false,
  });

  assert.equal(result.dispatchStatus, "sent");
  assert.equal(result.mappedChannelName, direct.channelName);

  const state = readWorkspaceStateSync(DEFAULT_WORKSPACE_ID);
  const humanMessage = state.messages.find((message) =>
    message.channel === direct.channelName &&
    message.speaker === "Mina" &&
    message.speakerUserId === fixtures.user.id &&
    message.summary === "Please plan a quiet itinerary"
  );
  assert.ok(humanMessage);
  assert.deepEqual(humanMessage.data, {
    external_provider: FEISHU_PROVIDER_ID,
    external_provider_label: "Feishu/Lark",
    external_event_id: "evt-direct-1",
    external_message_id: "om-direct-1",
    external_chat_id: "oc_direct",
    external_trust: "untrusted_user_message",
    workspace_data_policy_decision: "allow",
    workspace_data_policy_reason: "workspace_data.external_untrusted_user_message_allowed",
    workspace_data_classification: "external_untrusted_user_content",
    workspace_data_store: "true",
    workspace_data_search: "true",
    workspace_data_agent_context: "true",
  });
  const pendingMessage = state.messages.find((message) =>
    message.channel === direct.channelName &&
    message.speaker === "Atlas" &&
    message.status === "pending" &&
    message.code === "agent.pending"
  );
  assert.ok(pendingMessage);
  assert.equal(pendingMessage.data?.source_message_id, humanMessage.id);

  const [queuedTask] = listQueuedTasksSync({ workspaceId: DEFAULT_WORKSPACE_ID });
  assert.ok(queuedTask);
  const queuedPayload = JSON.parse(queuedTask.inputJson) as {
    contactId?: string;
    channelName?: string;
    channelMessage?: string;
    sourceMessageId?: string;
    externalInput?: {
      provider?: string;
      externalEventId?: string;
      externalMessageId?: string;
      externalChatId?: string;
      trust?: string;
    };
  };
  assert.equal(queuedPayload.contactId, "Atlas");
  assert.equal(queuedPayload.channelName, direct.channelName);
  assert.equal(queuedPayload.channelMessage, "Please plan a quiet itinerary");
  assert.equal(queuedPayload.sourceMessageId, humanMessage.id);
  assert.deepEqual(queuedPayload.externalInput, {
    provider: FEISHU_PROVIDER_ID,
    providerLabel: "Feishu/Lark",
    externalEventId: "evt-direct-1",
    externalMessageId: "om-direct-1",
    externalChatId: "oc_direct",
    trust: "untrusted_user_message",
    workspaceDataPolicy: expectedWorkspaceDataPolicy({
      externalEventId: "evt-direct-1",
      externalMessageId: "om-direct-1",
      externalChatId: "oc_direct",
    }),
  });

  const mapping = readExternalMessageMappingByExternalMessageSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: fixtures.integration.id,
    externalMessageId: "om-direct-1",
  });
  assert.ok(mapping);
  assert.equal(mapping.agentSpaceMessageId, humanMessage.id);
  assert.equal(JSON.parse(mapping.metadataJson).dispatchStatus, "sent");
});

test("agent bot first messages auto-provision a channel and route @bot to the agent", databaseTestOptions, () => {
  const fixtures = seedBoundFeishuWorkspace({ agentBot: true, bindChannel: false });

  const result = processFeishuInboundEventSync({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: fixtures.integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    payload: buildFeishuMessagePayload({
      eventId: "evt-agent-bot-first-message",
      messageId: "om-agent-bot-first-message",
      chatId: "oc_launch",
      chatName: "Launch Room",
      threadId: "om-launch-root",
      text: '<at user_id="ou_bot_atlas">@Atlas Bot</at> summarize launch notes',
    }),
  });

  assert.equal(result.dispatchStatus, "sent");
  assert.ok(result.mappedChannelName);
  const state = readWorkspaceStateSync(DEFAULT_WORKSPACE_ID);
  const channel = state.channels.find((item) => item.name === result.mappedChannelName);
  assert.ok(channel);
  assert.ok(channel.employeeNames.includes("Atlas"));

  const humanMessage = state.messages.find((message) =>
    message.channel === result.mappedChannelName &&
    message.speaker === "Mina" &&
    message.summary === "@Atlas summarize launch notes"
  );
  assert.ok(humanMessage);
  const [queuedTask] = listQueuedTasksSync({ workspaceId: DEFAULT_WORKSPACE_ID });
  assert.equal(queuedTask?.agentId, "Atlas");

  const binding = readExternalChannelBindingByExternalChatSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: fixtures.integration.id,
    externalChatId: "oc_launch",
  });
  assert.ok(binding);
  assert.equal(binding.channelName, result.mappedChannelName);
  const metadata = JSON.parse(binding.metadataJson) as Record<string, unknown>;
  assert.equal(metadata.provisionSource, "first_message");
  assert.equal(metadata.reviewStatus, "approved");
  assert.equal(metadata.agentId, "Atlas");
  assert.equal(metadata.botBindingId, fixtures.integration.id);
  assert.doesNotMatch(binding.metadataJson, /oc_launch/);

  const threadBinding = readFeishuThreadBindingSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    tenantKey: fixtures.integration.tenantKey,
    externalChatId: "oc_launch",
    externalThreadId: "om-launch-root",
    agentId: "Atlas",
  });
  assert.ok(threadBinding);
  assert.equal(threadBinding.channelName, result.mappedChannelName);
  assert.equal(threadBinding.integrationId, fixtures.integration.id);
  assert.equal(threadBinding.taskQueueId, queuedTask?.id);
  assert.equal(threadBinding.agentSpaceMessageId, humanMessage.id);
  const threadMetadata = JSON.parse(threadBinding.metadataJson) as Record<string, unknown>;
  assert.equal(threadMetadata.agentId, "Atlas");
  assert.equal(threadMetadata.botBindingId, fixtures.integration.id);
  assert.equal(threadMetadata.actorType, "user");
  assert.doesNotMatch(threadBinding.metadataJson, /oc_launch|om-launch-root/);

  const mapping = readExternalMessageMappingByExternalMessageSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: fixtures.integration.id,
    externalMessageId: "om-agent-bot-first-message",
  });
  assert.ok(mapping);
  assert.equal(mapping.taskQueueId, queuedTask?.id);
  assert.equal(mapping.routerSessionId, queuedTask?.routerSessionId);
  assert.equal(JSON.parse(mapping.metadataJson).threadBindingId, threadBinding.id);
});

test("bot added events reuse an existing Feishu chat channel for additional agent bots", databaseTestOptions, () => {
  const fixtures = seedBoundFeishuWorkspace({ agentBot: true, bindChannel: false });
  createEmployeeSync({
    name: "Hermes",
    role: "Runner",
    remarkName: "Hermes",
    summary: "Delivery runner",
    fit: "Ready",
    origin: "test",
  }, DEFAULT_WORKSPACE_ID);
  const hermesBinding = createFeishuAgentBotBindingSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    agentId: "Hermes",
    appId: "cli_hermes_bot",
    appSecret: "secret-hermes",
  });

  const first = processFeishuInboundEventSync({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: fixtures.integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    payload: buildFeishuBotAddedPayload({
      eventId: "evt-atlas-bot-added",
      chatId: "oc_shared_group",
      chatName: "Shared Feishu Group",
    }),
  });
  const second = processFeishuInboundEventSync({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: hermesBinding.id,
      provider: FEISHU_PROVIDER_ID,
    },
    payload: buildFeishuBotAddedPayload({
      eventId: "evt-hermes-bot-added",
      chatId: "oc_shared_group",
      chatName: "Shared Feishu Group",
    }),
  });

  assert.equal(first.dispatchStatus, "sent");
  assert.equal(second.dispatchStatus, "sent");
  assert.equal(second.mappedChannelName, first.mappedChannelName);
  assert.ok(first.noticeOutbox);
  assert.ok(second.noticeOutbox);

  const state = readWorkspaceStateSync(DEFAULT_WORKSPACE_ID);
  const channel = state.channels.find((item) => item.name === first.mappedChannelName);
  assert.ok(channel);
  assert.deepEqual(channel.employeeNames.sort(), ["Atlas", "Hermes"]);
  assert.equal(state.channels.filter((item) => item.name === first.mappedChannelName).length, 1);

  const atlasChannelBinding = readExternalChannelBindingByExternalChatSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: fixtures.integration.id,
    externalChatId: "oc_shared_group",
  });
  const hermesChannelBinding = readExternalChannelBindingByExternalChatSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: hermesBinding.id,
    externalChatId: "oc_shared_group",
  });
  assert.equal(hermesChannelBinding?.channelName, first.mappedChannelName);
  const metadata = JSON.parse(hermesChannelBinding?.metadataJson ?? "{}") as Record<string, unknown>;
  assert.equal(metadata.provisionSource, "bot_added");
  assert.equal(metadata.agentId, "Hermes");
  assert.equal(metadata.linkedFromBindingId, atlasChannelBinding?.id);
});

test("unbound Feishu users can dispatch as a governed external guest on agent bot mentions", databaseTestOptions, () => {
  const fixtures = seedBoundFeishuWorkspace({ agentBot: true, bindUser: false });

  const result = processFeishuInboundEventSync({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: fixtures.integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    payload: buildFeishuMessagePayload({
      eventId: "evt-agent-bot-guest",
      messageId: "om-agent-bot-guest",
      text: '<at user_id="ou_bot_atlas">@Atlas Bot</at> help with this error',
    }),
  });

  assert.equal(result.dispatchStatus, "sent");
  assert.equal(result.reasonCode, undefined);
  const state = readWorkspaceStateSync(DEFAULT_WORKSPACE_ID);
  assert.ok(state.humanMembers.some((member) => member.name === FEISHU_EXTERNAL_GUEST_DISPLAY_NAME));
  const channel = state.channels.find((item) => item.name === "general");
  assert.ok(channel?.humanMemberNames?.includes(FEISHU_EXTERNAL_GUEST_DISPLAY_NAME));
  const humanMessage = state.messages.find((message) =>
    message.channel === "general" &&
    message.speaker === FEISHU_EXTERNAL_GUEST_DISPLAY_NAME &&
    message.summary === "@Atlas help with this error"
  );
  assert.ok(humanMessage);
  assert.equal(humanMessage.speakerUserId, undefined);
  const [queuedTask] = listQueuedTasksSync({ workspaceId: DEFAULT_WORKSPACE_ID });
  assert.equal(queuedTask?.agentId, "Atlas");
  assert.equal(queuedTask?.requestedByUserId, undefined);
  assert.equal(queuedTask?.requestedByDisplayName, FEISHU_EXTERNAL_GUEST_DISPLAY_NAME);

  const mapping = readExternalMessageMappingByExternalMessageSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: fixtures.integration.id,
    externalMessageId: "om-agent-bot-guest",
  });
  assert.ok(mapping);
  const metadata = JSON.parse(mapping.metadataJson) as Record<string, unknown>;
  assert.equal(metadata.actorType, "external_guest");
  assert.equal(metadata.externalGuestPermissionProfile, "channel_context_only");
  assert.equal(metadata.agentId, "Atlas");
  assert.equal(metadata.botBindingId, fixtures.integration.id);
  assert.match(String(metadata.externalGuestReference), /^[a-f0-9]{64}$/);
  assert.doesNotMatch(mapping.metadataJson, /ou_mina|on_mina/);
});

test("bound Feishu file messages attach downloaded files to messages and task metadata", databaseTestOptions, async () => {
  const fixtures = seedBoundFeishuWorkspace();
  let downloadCount = 0;

  const result = await processFeishuInboundEvent({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: fixtures.integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    payload: buildFeishuMessagePayload({
      eventId: "evt-file-1",
      messageId: "om-file-1",
      messageType: "file",
      content: {
        text: "@Atlas review this",
        file_key: "file_v2_456",
        file_name: "brief.pdf",
        mime_type: "application/pdf",
        file_size: 7,
      },
    }),
    queueNotices: false,
    attachmentDownloader(input) {
      downloadCount += 1;
      assert.equal(input.message.externalMessageId, "om-file-1");
      assert.equal(input.attachment.fileName, "brief.pdf");
      return {
        id: "attachment-feishu-brief",
        fileName: input.attachment.fileName ?? "brief.pdf",
        mediaType: input.attachment.mediaType ?? "application/pdf",
        sizeBytes: 7,
        kind: "file",
        storedPath: "runtime-output/test/brief.pdf",
      };
    },
  });

  assert.equal(result.dispatchStatus, "sent");
  assert.equal(downloadCount, 1);

  const state = readWorkspaceStateSync(DEFAULT_WORKSPACE_ID);
  const humanMessage = state.messages.find((message) =>
    message.channel === "general" &&
    message.speakerUserId === fixtures.user.id &&
    message.summary === "@Atlas review this"
  );
  assert.ok(humanMessage);
  assert.equal(humanMessage.attachments?.length, 1);
  assert.equal(humanMessage.attachments?.[0]?.fileName, "brief.pdf");
  assert.equal(humanMessage.attachments?.[0]?.mediaType, "application/pdf");
  assert.ok(humanMessage.attachments?.[0]?.storedPath);

  const [queuedTask] = listQueuedTasksSync({ workspaceId: DEFAULT_WORKSPACE_ID });
  assert.ok(queuedTask);
  const queuedPayload = JSON.parse(queuedTask.inputJson) as {
    attachments?: Array<{
      fileName?: string;
      storedPath?: string;
      mediaType?: string;
      kind?: string;
    }>;
  };
  assert.deepEqual(queuedPayload.attachments, [{
    fileName: "brief.pdf",
    storedPath: humanMessage.attachments?.[0]?.storedPath,
    mediaType: "application/pdf",
    kind: "file",
  }]);

  const mapping = readExternalMessageMappingByExternalMessageSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: fixtures.integration.id,
    externalMessageId: "om-file-1",
  });
  assert.ok(mapping);
  const metadata = JSON.parse(mapping.metadataJson) as {
    dispatchStatus?: string;
    attachmentCount?: number;
    downloadedAttachmentCount?: number;
  };
  assert.equal(metadata.dispatchStatus, "sent");
  assert.equal(metadata.attachmentCount, 1);
  assert.equal(metadata.downloadedAttachmentCount, 1);
});

test("duplicate Feishu external message ids are ignored without dispatching twice", databaseTestOptions, () => {
  const fixtures = seedBoundFeishuWorkspace();
  const payload = buildFeishuMessagePayload({
    eventId: "evt-duplicate-1",
    messageId: "om-duplicate-1",
    text: "@Atlas do this once",
  });

  processFeishuInboundEventSync({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: fixtures.integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    payload,
    queueNotices: false,
  });
  const firstMessageCount = readWorkspaceStateSync(DEFAULT_WORKSPACE_ID).messages.length;
  const firstTaskCount = listQueuedTasksSync({ workspaceId: DEFAULT_WORKSPACE_ID }).length;

  const duplicate = processFeishuInboundEventSync({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: fixtures.integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    payload: {
      ...payload,
      header: {
        ...(payload.header as Record<string, unknown>),
        event_id: "evt-duplicate-retry",
      },
    },
    queueNotices: false,
  });

  assert.equal(duplicate.dispatchStatus, "duplicate");
  assert.equal(readWorkspaceStateSync(DEFAULT_WORKSPACE_ID).messages.length, firstMessageCount);
  assert.equal(listQueuedTasksSync({ workspaceId: DEFAULT_WORKSPACE_ID }).length, firstTaskCount);
});

test("legacy Feishu card action ignored path records a safe payload summary", databaseTestOptions, () => {
  const fixtures = seedBoundFeishuWorkspace();
  const payload = {
    schema: "2.0",
    header: {
      event_id: "evt-card-action-1",
      event_type: "card.action.trigger",
      create_time: "1782220800000",
      token: "verify-token",
    },
    event: {
      action: {
        value: {
          approvalId: "approval-1",
          decision: "approved",
          payloadHash: "hash-secret-ish",
        },
      },
      operator: {
        operator_id: {
          open_id: "ou_mina",
        },
      },
    },
  };

  const result = recordFeishuCardActionCallbackIgnoredSync({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: fixtures.integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    payload,
  });

  assert.equal(result.dispatchStatus, "ignored");
  assert.equal(result.reasonCode, "feishu_card_action_approval_unsupported");
  assert.equal(result.message, null);
  assert.equal(countHumanMessages(), 0);
  assert.equal(listQueuedTasksSync({ workspaceId: DEFAULT_WORKSPACE_ID }).length, 0);

  const event = readExternalIntegrationEventSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    provider: FEISHU_PROVIDER_ID,
    externalEventId: "evt-card-action-1",
  });
  assert.ok(event);
  assert.equal(event.status, "ignored");
  assert.equal(event.errorMessage, "feishu_card_action_approval_unsupported");
  const summary = JSON.parse(event.payloadJson) as {
    rawPayloadStored?: boolean;
    contentRedacted?: boolean;
    eventType?: string;
    payloadHash?: string;
  };
  assert.equal(summary.rawPayloadStored, false);
  assert.equal(summary.contentRedacted, false);
  assert.equal(summary.eventType, "card.action.trigger");
  assert.match(summary.payloadHash ?? "", /^[a-f0-9]{64}$/);
  assert.doesNotMatch(event.payloadJson, /approval-1|hash-secret-ish|approved/);
});

test("non-approval Feishu card action callbacks are safely ignored", databaseTestOptions, () => {
  const fixtures = seedBoundFeishuWorkspace();
  const payload = {
    schema: "2.0",
    header: {
      event_id: "evt-card-business-1",
      event_type: "card.action.trigger",
      create_time: "1782220800000",
      token: "verify-token",
    },
    event: {
      action: {
        value: {
          action: "refresh_status",
          resourceId: "status-card-1",
        },
      },
      operator: {
        operator_id: {
          open_id: "ou_mina",
        },
      },
    },
  };

  const result = recordFeishuCardActionCallbackIgnoredSync({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: fixtures.integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    payload,
    reasonCode: "feishu_card_action_non_approval_ignored",
  });

  assert.equal(result.dispatchStatus, "ignored");
  assert.equal(result.reasonCode, "feishu_card_action_non_approval_ignored");
  assert.equal(result.message, null);
  assert.equal(countHumanMessages(), 0);
  assert.equal(listQueuedTasksSync({ workspaceId: DEFAULT_WORKSPACE_ID }).length, 0);

  const event = readExternalIntegrationEventSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    provider: FEISHU_PROVIDER_ID,
    externalEventId: "evt-card-business-1",
  });
  assert.ok(event);
  assert.equal(event.status, "ignored");
  assert.equal(event.errorMessage, "feishu_card_action_non_approval_ignored");
  assert.doesNotMatch(event.payloadJson, /refresh_status|status-card-1/);
});

test("Feishu callbacks rejected by tenant context are audited with safe app and tenant metadata", databaseTestOptions, () => {
  const fixtures = seedBoundFeishuWorkspace();
  const payload = {
    schema: "2.0",
    header: {
      event_id: "evt-tenant-rejected-1",
      event_type: "im.message.receive_v1",
      create_time: "1782220800000",
      token: "verify-token",
      app_id: "cli_wrong",
      tenant_key: "tenant-wrong",
    },
    event: {
      message: {
        message_id: "om-tenant-rejected-1",
        chat_id: "oc_general",
        chat_type: "group",
        message_type: "text",
        content: JSON.stringify({ text: "@Atlas tenant mismatch secret text" }),
      },
      sender: {
        sender_id: {
          open_id: "ou_mina",
        },
      },
    },
  };

  const result = recordFeishuCallbackRejectedSync({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: fixtures.integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    payload,
    reasonCode: "feishu.callback_tenant_key_mismatch",
  });

  assert.equal(result.dispatchStatus, "failed");
  assert.equal(result.reasonCode, "feishu.callback_tenant_key_mismatch");
  assert.equal(result.message, null);
  assert.equal(countHumanMessages(), 0);
  assert.equal(listQueuedTasksSync({ workspaceId: DEFAULT_WORKSPACE_ID }).length, 0);

  const event = readExternalIntegrationEventSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    provider: FEISHU_PROVIDER_ID,
    externalEventId: "evt-tenant-rejected-1",
  });
  assert.ok(event);
  assert.equal(event.status, "failed");
  assert.equal(event.errorMessage, "feishu.callback_tenant_key_mismatch");
  const summary = JSON.parse(event.payloadJson) as {
    appId?: string;
    tenantKey?: string;
    contentRedacted?: boolean;
    message?: {
      contentHash?: string;
      contentLength?: number;
    };
  };
  assert.equal(summary.appId, "cli_wrong");
  assert.equal(summary.tenantKey, "tenant-wrong");
  assert.equal(summary.contentRedacted, true);
  assert.match(summary.message?.contentHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(typeof summary.message?.contentLength, "number");
  assert.doesNotMatch(event.payloadJson, /tenant mismatch secret text/);
});

test("unbound Feishu users are ignored and queued for a binding notice", databaseTestOptions, () => {
  const fixtures = seedBoundFeishuWorkspace({ bindUser: false });

  const result = withAgentSpaceAppUrl("https://agentspace.test", () =>
    processFeishuInboundEventSync({
      context: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        integrationId: fixtures.integration.id,
        provider: FEISHU_PROVIDER_ID,
      },
      payload: buildFeishuMessagePayload({
        eventId: "evt-unbound-user",
        messageId: "om-unbound-user",
        text: "@Atlas hello",
      }),
    }));

  assert.equal(result.dispatchStatus, "ignored");
  assert.equal(result.reasonCode, "external_user_unbound");
  assert.ok(result.noticeOutbox);
  assert.equal(countHumanMessages(), 0);
  assert.equal(listQueuedTasksSync({ workspaceId: DEFAULT_WORKSPACE_ID }).length, 0);

  const mapping = readExternalMessageMappingByExternalMessageSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: fixtures.integration.id,
    externalMessageId: "om-unbound-user",
  });
  assert.ok(mapping);
  const metadata = JSON.parse(mapping.metadataJson) as Record<string, unknown>;
  assert.equal(metadata.dispatchStatus, "ignored");
  assert.equal(metadata.reasonCode, "external_user_unbound");

  const noticePayload = JSON.parse(result.noticeOutbox.payloadJson) as { content?: string };
  const noticeContent = JSON.parse(String(noticePayload.content)) as { text?: string };
  assert.match(noticeContent.text ?? "", /还没有绑定 AgentSpace 账号/);
  assert.match(noticeContent.text ?? "", /https:\/\/agentspace\.test\/w\/default\/settings\/integrations#feishu-user-bindings/);
  assert.doesNotMatch(noticeContent.text ?? "", /ou_mina|on_mina|om-unbound-user/);
});

test("unbound Feishu users do not trigger attachment downloads", databaseTestOptions, async () => {
  const fixtures = seedBoundFeishuWorkspace({ bindUser: false });
  let downloadCount = 0;

  const result = await processFeishuInboundEvent({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: fixtures.integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    payload: buildFeishuMessagePayload({
      eventId: "evt-unbound-user-file",
      messageId: "om-unbound-user-file",
      messageType: "file",
      content: {
        text: "@Atlas review",
        file_key: "file_v2_unbound",
        file_name: "secret.pdf",
        mime_type: "application/pdf",
        file_size: 7,
      },
    }),
    attachmentDownloader() {
      downloadCount += 1;
      throw new Error("download should not run");
    },
  });

  assert.equal(result.dispatchStatus, "ignored");
  assert.equal(result.reasonCode, "external_user_unbound");
  assert.equal(downloadCount, 0);
  assert.equal(countHumanMessages(), 0);
  assert.equal(listQueuedTasksSync({ workspaceId: DEFAULT_WORKSPACE_ID }).length, 0);
});

test("unbound Feishu channels are ignored and queued for an admin binding notice", databaseTestOptions, () => {
  const fixtures = seedBoundFeishuWorkspace({ bindChannel: false });

  const result = withAgentSpaceAppUrl(undefined, () =>
    processFeishuInboundEventSync({
      context: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        integrationId: fixtures.integration.id,
        provider: FEISHU_PROVIDER_ID,
      },
      payload: buildFeishuMessagePayload({
        eventId: "evt-unbound-channel",
        messageId: "om-unbound-channel",
        text: "@Atlas hello",
      }),
    }));

  assert.equal(result.dispatchStatus, "ignored");
  assert.equal(result.reasonCode, "external_channel_unbound");
  assert.ok(result.noticeOutbox);
  assert.equal(countHumanMessages(), 0);
  assert.equal(listQueuedTasksSync({ workspaceId: DEFAULT_WORKSPACE_ID }).length, 0);

  const mapping = readExternalMessageMappingByExternalMessageSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: fixtures.integration.id,
    externalMessageId: "om-unbound-channel",
  });
  assert.ok(mapping);
  const metadata = JSON.parse(mapping.metadataJson) as Record<string, unknown>;
  assert.equal(metadata.dispatchStatus, "ignored");
  assert.equal(metadata.reasonCode, "external_channel_unbound");
  assert.equal(metadata.mappedChannelName, undefined);

  const noticePayload = JSON.parse(result.noticeOutbox.payloadJson) as { content?: string };
  const noticeContent = JSON.parse(String(noticePayload.content)) as { text?: string };
  assert.match(noticeContent.text ?? "", /还没有绑定到 AgentSpace channel/);
  assert.doesNotMatch(noticeContent.text ?? "", /https?:\/\//);
});

test("bound Feishu users without channel access are ignored and queued for a denial notice", databaseTestOptions, () => {
  const fixtures = seedBoundFeishuWorkspace({
    userDisplayName: "Rin",
    userEmail: "rin@example.com",
    workspaceRole: "member",
  });

  const result = processFeishuInboundEventSync({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: fixtures.integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    payload: buildFeishuMessagePayload({
      eventId: "evt-channel-denied",
      messageId: "om-channel-denied",
      text: "@Atlas hello",
    }),
  });

  assert.equal(result.dispatchStatus, "ignored");
  assert.equal(result.reasonCode, "external_channel_access_denied");
  assert.ok(result.noticeOutbox);
  assert.equal(countHumanMessages(), 0);
  assert.equal(listQueuedTasksSync({ workspaceId: DEFAULT_WORKSPACE_ID }).length, 0);

  const mapping = readExternalMessageMappingByExternalMessageSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: fixtures.integration.id,
    externalMessageId: "om-channel-denied",
  });
  assert.ok(mapping);
  const metadata = JSON.parse(mapping.metadataJson) as Record<string, unknown>;
  assert.equal(metadata.dispatchStatus, "ignored");
  assert.equal(metadata.reasonCode, "external_channel_access_denied");
  assert.equal(metadata.userId, fixtures.user.id);

  const noticePayload = JSON.parse(result.noticeOutbox.payloadJson) as { content?: string };
  const noticeContent = JSON.parse(String(noticePayload.content)) as { text?: string };
  assert.match(noticeContent.text ?? "", /没有这个 AgentSpace channel 的访问权限/);
});

test("out-of-channel Feishu agent mentions reuse the AgentSpace mention error", databaseTestOptions, () => {
  const fixtures = seedBoundFeishuWorkspace({ includeOutOfChannelAgent: true });

  const result = processFeishuInboundEventSync({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: fixtures.integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    payload: buildFeishuMessagePayload({
      eventId: "evt-out-of-channel-agent",
      messageId: "om-out-of-channel-agent",
      text: "@Hermes hello",
    }),
  });

  assert.equal(result.dispatchStatus, "failed");
  assert.equal(result.reasonCode, "agent_space_dispatch_failed");
  assert.equal(result.noticeOutbox, undefined);
  assert.match(result.event.errorMessage ?? "", /以下 Agent 不在当前群组中：@Hermes/);
  assert.equal(countHumanMessages(), 0);
  assert.equal(listQueuedTasksSync({ workspaceId: DEFAULT_WORKSPACE_ID }).length, 0);

  const mapping = readExternalMessageMappingByExternalMessageSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: fixtures.integration.id,
    externalMessageId: "om-out-of-channel-agent",
  });
  assert.ok(mapping);
  const metadata = JSON.parse(mapping.metadataJson) as Record<string, unknown>;
  assert.equal(metadata.dispatchStatus, "failed");
  assert.equal(metadata.reasonCode, "agent_space_dispatch_failed");
  assert.match(String(metadata.errorMessage), /以下 Agent 不在当前群组中：@Hermes/);
  assert.equal(metadata.userId, fixtures.user.id);
});

function seedBoundFeishuWorkspace(input: {
  agentBot?: boolean;
  bindChannel?: boolean;
  bindUser?: boolean;
  includeOutOfChannelAgent?: boolean;
  userDisplayName?: string;
  userEmail?: string;
  workspaceRole?: WorkspaceRole;
} = {}) {
  const displayName = input.userDisplayName ?? "Mina";
  const user = createUserSync({
    displayName,
    primaryEmail: input.userEmail ?? "mina@example.com",
  });
  createWorkspaceMembershipSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    userId: user.id,
    role: input.workspaceRole ?? "owner",
  });
  createEmployeeSync({
    name: "Atlas",
    role: "Planner",
    remarkName: "Atlas",
    summary: "Trip planner",
    fit: "Ready",
    origin: "test",
  }, DEFAULT_WORKSPACE_ID);
  if (input.includeOutOfChannelAgent) {
    createEmployeeSync({
      name: "Hermes",
      role: "Runner",
      remarkName: "Hermes",
      summary: "Out-of-channel runner",
      fit: "Ready",
      origin: "test",
    }, DEFAULT_WORKSPACE_ID);
  }

  const state = readWorkspaceStateSync(DEFAULT_WORKSPACE_ID);
  writeWorkspaceStateSync({
    ...state,
    activeEmployees: state.activeEmployees.map((employee) =>
      employee.name === "Atlas"
        ? { ...employee, channels: ["general"] }
        : employee,
    ),
    channels: state.channels.map((channel) =>
      channel.name === "general"
        ? {
          ...channel,
          employeeNames: ["Atlas"],
        }
        : channel,
    ),
  }, DEFAULT_WORKSPACE_ID);

  const runtime = registerDaemonRuntimesSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    daemonKey: `feishu-inbound-test-${Math.random().toString(36).slice(2)}`,
    deviceName: "Feishu inbound test",
    runtimes: [{ provider: "codex", name: "Atlas Runtime" }],
  }).runtimes[0];
  assert.ok(runtime);
  bindEmployeeRuntimeSync("Atlas", runtime.id, DEFAULT_WORKSPACE_ID);

  const integration = input.agentBot
    ? createFeishuAgentBotBindingSync({
      workspaceId: DEFAULT_WORKSPACE_ID,
      agentId: "Atlas",
      appId: "cli_atlas_bot",
      appSecret: "secret-atlas",
    })
    : createExternalIntegrationSync({
      workspaceId: DEFAULT_WORKSPACE_ID,
      provider: FEISHU_PROVIDER_ID,
      displayName: "Feishu",
      transportMode: "http_webhook",
      appId: "cli_test",
    });
  if (input.bindChannel !== false) {
    upsertExternalChannelBindingSync({
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: integration.id,
      channelName: "general",
      externalChatId: "oc_general",
      externalChatType: "group",
      externalChatName: "General",
    });
  }
  if (input.bindUser !== false) {
    upsertExternalUserBindingSync({
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: integration.id,
      userId: user.id,
      externalUserId: "ou_mina",
      externalUnionId: "on_mina",
      displayName,
    });
  }

  return { integration, user };
}

function buildFeishuMessagePayload(input: {
  eventId: string;
  messageId: string;
  chatId?: string;
  chatType?: string;
  chatName?: string;
  threadId?: string;
  text?: string;
  content?: Record<string, unknown>;
  messageType?: string;
}): Record<string, unknown> {
  return {
    schema: "2.0",
    header: {
      event_id: input.eventId,
      event_type: "im.message.receive_v1",
      create_time: "1782220800000",
      token: "verify-token",
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
        chat_id: input.chatId ?? "oc_general",
        chat_type: input.chatType ?? "group",
        chat_name: input.chatName,
        message_id: input.messageId,
        thread_id: input.threadId,
        message_type: input.messageType ?? "text",
        content: JSON.stringify(input.content ?? { text: input.text }),
      },
    },
  };
}

function buildFeishuBotAddedPayload(input: {
  eventId: string;
  chatId: string;
  chatName?: string;
  chatType?: string;
}): Record<string, unknown> {
  return {
    schema: "2.0",
    header: {
      event_id: input.eventId,
      event_type: "im.chat.member.bot.added_v1",
      create_time: "1782220800000",
      token: "verify-token",
    },
    event: {
      chat_id: input.chatId,
      chat_type: input.chatType ?? "group",
      chat_name: input.chatName,
    },
  };
}

function countHumanMessages(): number {
  return readWorkspaceStateSync(DEFAULT_WORKSPACE_ID).messages.filter((message) => message.role === "human").length;
}

function expectedWorkspaceDataPolicy(input: {
  externalEventId: string;
  externalMessageId: string;
  externalChatId: string;
  hasAttachments?: boolean;
}): Record<string, unknown> {
  return {
    decision: "allow",
    reasonCode: "workspace_data.external_untrusted_user_message_allowed",
    reason: "External untrusted user messages may be stored and used as ordinary workspace user content after source labeling.",
    classification: "external_untrusted_user_content",
    allowedUses: {
      storeInWorkspace: true,
      includeInSearch: true,
      includeInAgentContext: true,
    },
    auditData: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      sourceType: "external_message",
      provider: FEISHU_PROVIDER_ID,
      providerLabel: "Feishu/Lark",
      externalEventId: input.externalEventId,
      externalMessageId: input.externalMessageId,
      externalChatId: input.externalChatId,
      trust: "untrusted_user_message",
      contentKind: "message",
      hasAttachments: Boolean(input.hasAttachments),
      hasContentHash: false,
    },
  };
}

function withAgentSpaceAppUrl<T>(appUrl: string | undefined, run: () => T): T {
  const previous = {
    AGENT_SPACE_APP_URL: process.env.AGENT_SPACE_APP_URL,
    NEXT_PUBLIC_AGENT_SPACE_APP_URL: process.env.NEXT_PUBLIC_AGENT_SPACE_APP_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };
  setOptionalEnv("AGENT_SPACE_APP_URL", appUrl);
  setOptionalEnv("NEXT_PUBLIC_AGENT_SPACE_APP_URL", undefined);
  setOptionalEnv("NEXT_PUBLIC_APP_URL", undefined);

  try {
    return run();
  } finally {
    setOptionalEnv("AGENT_SPACE_APP_URL", previous.AGENT_SPACE_APP_URL);
    setOptionalEnv("NEXT_PUBLIC_AGENT_SPACE_APP_URL", previous.NEXT_PUBLIC_AGENT_SPACE_APP_URL);
    setOptionalEnv("NEXT_PUBLIC_APP_URL", previous.NEXT_PUBLIC_APP_URL);
  }
}

function setOptionalEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
