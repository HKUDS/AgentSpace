import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { before, beforeEach } from "node:test";
import {
  createExternalIntegrationSync,
  createUserSync,
  createWorkspaceMembershipSync,
  DEFAULT_WORKSPACE_ID,
  getDatabase,
  listExternalMessageOutboxSync,
  listExternalThreadBindingsSync,
  listQueuedTasksSync,
  registerDaemonRuntimesSync,
  upsertExternalChannelBindingSync,
  upsertExternalUserBindingSync,
} from "@agent-space/db";
import {
  addChannelEmployeesSync,
  bindEmployeeRuntimeSync,
  createEmployeeSync,
  initializeOrganizationSync,
  readWorkspaceStateSync,
  resetWorkspaceStateSync,
} from "../../../../index.ts";
import { SLACK_PROVIDER_ID } from "../constants.ts";
import { processSlackInboundEventSync } from "../inbound.ts";

const originalCwd = process.cwd();
const repositoryRoot = existsSync(join(originalCwd, "Target.md")) ? originalCwd : join(originalCwd, "..", "..", "..", "..");
const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-slack-inbound-"));
const databaseTestOptions = process.env.AGENT_SPACE_SLACK_INBOUND_DB_TESTS === "1"
  ? {}
  : { skip: "Set AGENT_SPACE_SLACK_INBOUND_DB_TESTS=1 with a test Postgres URL to run Slack inbound DB integration tests." };

before(() => {
  writeFileSync(join(tempRoot, "Target.md"), "# test\n");
  mkdirSync(join(tempRoot, "data"), { recursive: true });
  const packagesLink = join(tempRoot, "packages");
  if (!existsSync(packagesLink)) {
    symlinkSync(join(repositoryRoot, "packages"), packagesLink, "dir");
  }
  process.chdir(tempRoot);
});

beforeEach(() => {
  getDatabase().exec(`
    DELETE FROM external_message_outbox;
    DELETE FROM external_message_mapping;
    DELETE FROM external_thread_binding;
    DELETE FROM external_integration_event;
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
});

test("agent-scoped Slack bots in the same Slack channel route to their own AgentSpace agents", databaseTestOptions, () => {
  seedSlackAgentBotWorkspace();
  const user = createUserSync({
    displayName: "Mina",
    primaryEmail: "mina-slack-bots@example.com",
  });
  createWorkspaceMembershipSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    userId: user.id,
    role: "member",
  });

  const atlasIntegration = createSlackAgentBotIntegration({
    displayName: "Slack Atlas Bot",
    appId: "A_ATLAS",
    agentId: "Atlas",
    botUserId: "UATLAS",
  });
  const novaIntegration = createSlackAgentBotIntegration({
    displayName: "Slack Nova Bot",
    appId: "A_NOVA",
    agentId: "Nova",
    botUserId: "UNOVA",
  });
  for (const integration of [atlasIntegration, novaIntegration]) {
    upsertExternalChannelBindingSync({
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: integration.id,
      channelName: "general",
      externalChatId: "C_SHARED",
      externalChatType: "channel",
      externalChatName: "shared-agent-channel",
    });
    upsertExternalUserBindingSync({
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: integration.id,
      userId: user.id,
      externalUserId: "UMINA",
      displayName: "Mina",
    });
  }

  const atlasResult = processSlackInboundEventSync({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: atlasIntegration.id,
      provider: SLACK_PROVIDER_ID,
    },
    integration: atlasIntegration,
    payload: buildSlackMentionPayload({
      eventId: "EvAtlas",
      appId: "A_ATLAS",
      botUserId: "UATLAS",
      messageTs: "1783400000.000100",
      text: "<@UATLAS> summarize the launch plan",
      appContext: {
        entities: [{
          type: "slack#/types/channel_id",
          value: "C_VIEWED",
          team_id: "T_SHARED",
        }],
      },
    }),
  });
  const novaResult = processSlackInboundEventSync({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: novaIntegration.id,
      provider: SLACK_PROVIDER_ID,
    },
    integration: novaIntegration,
    payload: buildSlackMentionPayload({
      eventId: "EvNova",
      appId: "A_NOVA",
      botUserId: "UNOVA",
      messageTs: "1783400000.000200",
      text: "<@UNOVA> review the metrics",
    }),
  });

  assert.equal(atlasResult.dispatchStatus, "sent");
  assert.equal(novaResult.dispatchStatus, "sent");
  assert.equal(atlasResult.mappedChannelName, "general");
  assert.equal(novaResult.mappedChannelName, "general");

  const queuedTasks = listQueuedTasksSync();
  assert.equal(queuedTasks.filter((task) => task.agentId === "Atlas").length, 1);
  assert.equal(queuedTasks.filter((task) => task.agentId === "Nova").length, 1);
  const atlasTask = queuedTasks.find((task) => task.agentId === "Atlas");
  const novaTask = queuedTasks.find((task) => task.agentId === "Nova");
  const atlasTaskInput = JSON.parse(atlasTask?.inputJson ?? "{}") as {
    externalInput?: {
      actor?: {
        agentId?: string;
        botBindingId?: string;
      };
    };
  };
  const novaTaskInput = JSON.parse(novaTask?.inputJson ?? "{}") as {
    externalInput?: {
      actor?: {
        agentId?: string;
        botBindingId?: string;
      };
    };
  };
  assert.equal(atlasTaskInput.externalInput?.actor?.agentId, "Atlas");
  assert.equal(novaTaskInput.externalInput?.actor?.agentId, "Nova");
  assert.equal(atlasTaskInput.externalInput?.actor?.botBindingId, atlasIntegration.id);
  assert.equal(novaTaskInput.externalInput?.actor?.botBindingId, novaIntegration.id);

  const messages = readWorkspaceStateSync(DEFAULT_WORKSPACE_ID).messages;
  const atlasMessage = messages.find((message) => message.data?.external_message_id === "1783400000.000100");
  const novaMessage = messages.find((message) => message.data?.external_message_id === "1783400000.000200");
  assert.equal(atlasMessage?.summary, "@Atlas summarize the launch plan");
  assert.equal(novaMessage?.summary, "@Nova review the metrics");
  assert.equal(atlasMessage?.mentions?.[0]?.token, "Atlas");
  assert.equal(novaMessage?.mentions?.[0]?.token, "Nova");
  assert.equal(String(atlasMessage?.data?.external_context).includes("C_VIEWED"), false);
  assert.equal(String(atlasMessage?.data?.external_context).includes("T_SHARED"), false);
  assert.match(atlasMessage?.data?.external_context ?? "", /"slackAgentContext"/);

  const atlasMappingMetadata = JSON.parse(atlasResult.mapping?.metadataJson ?? "{}") as Record<string, unknown>;
  assert.equal(JSON.stringify(atlasMappingMetadata).includes("C_VIEWED"), false);
  assert.equal(JSON.stringify(atlasMappingMetadata).includes("T_SHARED"), false);
  assert.equal(typeof atlasMappingMetadata.agentContext, "object");

  const threadBindings = listExternalThreadBindingsSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    provider: SLACK_PROVIDER_ID,
    externalChatId: "C_SHARED",
  });
  assert.equal(threadBindings.length, 2);
  const atlasThreadBinding = threadBindings.find((binding) => binding.agentId === "Atlas");
  const novaThreadBinding = threadBindings.find((binding) => binding.agentId === "Nova");
  assert.equal(atlasThreadBinding?.integrationId, atlasIntegration.id);
  assert.equal(novaThreadBinding?.integrationId, novaIntegration.id);
  assert.equal(atlasThreadBinding?.externalThreadId, "1783400000.000100");
  assert.equal(novaThreadBinding?.externalThreadId, "1783400000.000200");
  assert.equal(atlasThreadBinding?.taskQueueId, atlasTask?.id);
  assert.equal(novaThreadBinding?.taskQueueId, novaTask?.id);
  assert.equal(atlasThreadBinding?.agentSpaceMessageId, atlasMessage?.id);
  assert.equal(novaThreadBinding?.agentSpaceMessageId, novaMessage?.id);
  assert.equal(atlasMappingMetadata.threadBindingId, atlasThreadBinding?.id);
  const atlasThreadMetadata = JSON.parse(atlasThreadBinding?.metadataJson ?? "{}") as Record<string, unknown>;
  assert.equal(atlasThreadMetadata.provider, SLACK_PROVIDER_ID);
  assert.equal(atlasThreadMetadata.agentId, "Atlas");
  assert.equal(atlasThreadMetadata.botBindingId, atlasIntegration.id);
  assert.equal(JSON.stringify(atlasThreadMetadata).includes("C_SHARED"), false);
  assert.equal(JSON.stringify(atlasThreadMetadata).includes("1783400000.000100"), false);

  const welcomeResult = processSlackInboundEventSync({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: atlasIntegration.id,
      provider: SLACK_PROVIDER_ID,
    },
    integration: atlasIntegration,
    payload: buildSlackAppHomeOpenedPayload({
      eventId: "EvAtlasHome",
      appId: "A_ATLAS",
      userId: "UMINA",
      channelId: "D_ATLAS",
    }),
  });
  const duplicateWelcomeResult = processSlackInboundEventSync({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: atlasIntegration.id,
      provider: SLACK_PROVIDER_ID,
    },
    integration: atlasIntegration,
    payload: buildSlackAppHomeOpenedPayload({
      eventId: "EvAtlasHomeAgain",
      appId: "A_ATLAS",
      userId: "UMINA",
      channelId: "D_ATLAS",
    }),
  });
  assert.equal(welcomeResult.reasonCode, "slack.app_home_opened_welcome_queued");
  assert.equal(duplicateWelcomeResult.reasonCode, "slack.app_home_opened_welcome_already_queued");

  const welcomeOutbox = listExternalMessageOutboxSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: atlasIntegration.id,
  }).filter((item) => item.targetExternalChatId === "D_ATLAS");
  assert.equal(welcomeOutbox.length, 2);
  const parsedOutbox = welcomeOutbox.map((item) => ({
    item,
    metadata: JSON.parse(item.metadataJson) as Record<string, unknown>,
  }));
  const welcomeMetadata = parsedOutbox.find((entry) => entry.metadata.outboxSource === "app_home_opened_welcome")?.metadata;
  const promptsMetadata = parsedOutbox.find((entry) => entry.metadata.outboxSource === "assistant_suggested_prompts")?.metadata;
  assert.ok(welcomeMetadata);
  assert.ok(promptsMetadata);
  assert.equal(welcomeMetadata.outboxSource, "app_home_opened_welcome");
  assert.equal(promptsMetadata.assistantMethod, "assistant.threads.setSuggestedPrompts");
  assert.equal(JSON.stringify(welcomeMetadata).includes("D_ATLAS"), false);
  assert.equal(JSON.stringify(welcomeMetadata).includes("UMINA"), false);
  assert.equal(JSON.stringify(promptsMetadata).includes("D_ATLAS"), false);
  assert.equal(JSON.stringify(promptsMetadata).includes("UMINA"), false);
});

test("bound Slack channel app mentions create AgentSpace agent tasks", databaseTestOptions, () => {
  seedSlackAgentBotWorkspace();
  const user = createUserSync({
    displayName: "Mina",
    primaryEmail: "mina-slack-workspace@example.com",
  });
  createWorkspaceMembershipSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    userId: user.id,
    role: "member",
  });

  const integration = createSlackWorkspaceIntegration({
    displayName: "Slack Workspace App",
    appId: "A_WORKSPACE",
    botUserId: "UWORKSPACE",
  });
  const channelBinding = upsertExternalChannelBindingSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: integration.id,
    channelName: "general",
    externalChatId: "C_SHARED",
    externalChatType: "channel",
    externalChatName: "shared-agent-channel",
  });
  upsertExternalUserBindingSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: integration.id,
    userId: user.id,
    externalUserId: "UMINA",
    displayName: "Mina",
  });

  const result = processSlackInboundEventSync({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: integration.id,
      provider: SLACK_PROVIDER_ID,
    },
    integration,
    payload: buildSlackMentionPayload({
      eventId: "EvWorkspaceAtlas",
      appId: "A_WORKSPACE",
      botUserId: "UWORKSPACE",
      messageTs: "1783400001.000100",
      text: "<@UWORKSPACE> @Atlas handle launch blockers",
    }),
  });

  assert.equal(result.dispatchStatus, "sent");
  assert.equal(result.mappedChannelName, "general");

  const tasks = listQueuedTasksSync({ workspaceId: DEFAULT_WORKSPACE_ID });
  assert.equal(tasks.length, 1);
  const task = tasks[0];
  assert.equal(task?.agentId, "Atlas");
  const taskInput = JSON.parse(task?.inputJson ?? "{}") as Record<string, unknown>;
  assert.equal(taskInput.channelName, "general");

  const messages = readWorkspaceStateSync(DEFAULT_WORKSPACE_ID).messages;
  const agentSpaceMessage = messages.find((message) => message.data?.external_message_id === "1783400001.000100");
  assert.equal(agentSpaceMessage?.summary, "@Atlas handle launch blockers");
  assert.equal(agentSpaceMessage?.mentions?.[0]?.agentId, "Atlas");
  assert.equal(taskInput.sourceMessageId, agentSpaceMessage?.id);
  assert.equal(result.agentSpaceMessageId, agentSpaceMessage?.id);

  const threadBindings = listExternalThreadBindingsSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    provider: SLACK_PROVIDER_ID,
    externalChatId: "C_SHARED",
  });
  assert.equal(threadBindings.length, 1);
  const threadBinding = threadBindings[0];
  assert.equal(threadBinding?.integrationId, integration.id);
  assert.equal(threadBinding?.channelBindingId, channelBinding.id);
  assert.equal(threadBinding?.agentId, "Atlas");
  assert.equal(threadBinding?.taskQueueId, task?.id);
  assert.equal(threadBinding?.agentSpaceMessageId, agentSpaceMessage?.id);
  assert.equal(threadBinding?.externalThreadId, "1783400001.000100");

  const metadata = JSON.parse(result.mapping?.metadataJson ?? "{}") as Record<string, unknown>;
  assert.equal(metadata.provider, SLACK_PROVIDER_ID);
  assert.equal(metadata.channelName, "general");
  assert.equal(metadata.agentId, undefined);
  assert.equal(metadata.botBindingId, undefined);
  assert.equal(metadata.taskAgentId, "Atlas");
  assert.equal(metadata.taskQueueId, task?.id);
  assert.equal(metadata.routerSessionId, task?.routerSessionId);
  assert.equal(metadata.threadBindingId, threadBinding?.id);
  assert.equal(JSON.stringify(metadata).includes("C_SHARED"), false);
  assert.equal(JSON.stringify(metadata).includes("UMINA"), false);
});

test("Slack inbound ignores channel permission denial with a thread notice", databaseTestOptions, () => {
  seedSlackAgentBotWorkspace();
  const user = createUserSync({
    displayName: "Ravi",
    primaryEmail: "ravi-slack-denied@example.com",
  });
  createWorkspaceMembershipSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    userId: user.id,
    role: "member",
  });
  const integration = createSlackAgentBotIntegration({
    displayName: "Slack Atlas Bot",
    appId: "A_ATLAS",
    agentId: "Atlas",
    botUserId: "UATLAS",
  });
  const channelBinding = upsertExternalChannelBindingSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: integration.id,
    channelName: "general",
    externalChatId: "C_SHARED",
    externalChatType: "channel",
    externalChatName: "shared-agent-channel",
  });
  upsertExternalUserBindingSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: integration.id,
    userId: user.id,
    externalUserId: "URAVI",
    displayName: "Ravi",
  });

  const result = processSlackInboundEventSync({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: integration.id,
      provider: SLACK_PROVIDER_ID,
    },
    integration,
    payload: buildSlackMentionPayload({
      eventId: "EvDenied",
      appId: "A_ATLAS",
      botUserId: "UATLAS",
      userId: "URAVI",
      messageTs: "1783400003.000100",
      text: "<@UATLAS> draft a launch update",
    }),
  });

  assert.equal(result.dispatchStatus, "ignored");
  assert.equal(result.reasonCode, "slack.channel_access_denied");
  assert.equal(result.mappedChannelName, "general");
  assert.equal(result.noticeOutbox?.channelBindingId, channelBinding.id);
  assert.equal(listQueuedTasksSync().length, 0);

  const metadata = JSON.parse(result.mapping?.metadataJson ?? "{}") as Record<string, unknown>;
  assert.equal(metadata.dispatchStatus, "ignored");
  assert.equal(metadata.reasonCode, "slack.channel_access_denied");
  assert.equal(metadata.userId, user.id);
  assert.equal(JSON.stringify(metadata).includes("URAVI"), false);
  assert.equal(JSON.stringify(metadata).includes("C_SHARED"), false);

  const outbox = listExternalMessageOutboxSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: integration.id,
  });
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0]?.id, result.noticeOutbox?.id);
  assert.equal(outbox[0]?.targetExternalChatId, "C_SHARED");
  assert.equal(outbox[0]?.targetExternalThreadId, "1783400003.000100");
  const payload = JSON.parse(outbox[0]?.payloadJson ?? "{}") as Record<string, unknown>;
  assert.equal(payload.channel, "C_SHARED");
  assert.equal(payload.thread_ts, "1783400003.000100");
  assert.match(String(payload.text), /cannot access this channel/);
  const outboxMetadata = JSON.parse(outbox[0]?.metadataJson ?? "{}") as Record<string, unknown>;
  assert.equal(outboxMetadata.outboxSource, "inbound_permission_notice");
  assert.equal(outboxMetadata.noticeType, "permission_denied");
  assert.equal(outboxMetadata.reasonCode, "slack.channel_access_denied");
  assert.equal(JSON.stringify(outboxMetadata).includes("C_SHARED"), false);
  assert.equal(JSON.stringify(outboxMetadata).includes("URAVI"), false);
});

function seedSlackAgentBotWorkspace(): void {
  resetWorkspaceStateSync(DEFAULT_WORKSPACE_ID);
  initializeOrganizationSync({
    organizationName: "Northstar Labs",
    ownerName: "Mina",
    ownerRole: "Owner",
    firstChannelName: "general",
  }, DEFAULT_WORKSPACE_ID);
  for (const agentName of ["Atlas", "Nova"]) {
    createEmployeeSync({
      name: agentName,
      role: "Agent",
      remarkName: agentName,
      summary: `${agentName} helper`,
      fit: "Ready",
      origin: "test",
    }, DEFAULT_WORKSPACE_ID);
  }
  addChannelEmployeesSync({
    channelName: "general",
    employeeNames: ["Atlas", "Nova"],
  }, DEFAULT_WORKSPACE_ID);
  bindRuntimeForAgent("Atlas");
  bindRuntimeForAgent("Nova");
}

function bindRuntimeForAgent(agentName: string): void {
  const runtime = registerDaemonRuntimesSync({
    daemonKey: `slack-${agentName.toLowerCase()}-${Math.random().toString(36).slice(2)}`,
    deviceName: "Slack test runtime",
    runtimes: [{ provider: "codex", name: `${agentName} Runtime` }],
  }).runtimes[0];
  assert.ok(runtime);
  bindEmployeeRuntimeSync(agentName, runtime.id, DEFAULT_WORKSPACE_ID);
}

function createSlackAgentBotIntegration(input: {
  displayName: string;
  appId: string;
  agentId: string;
  botUserId: string;
}) {
  return createExternalIntegrationSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    provider: SLACK_PROVIDER_ID,
    displayName: input.displayName,
    transportMode: "websocket_worker",
    appId: input.appId,
    tenantKey: "T_SHARED",
    agentId: input.agentId,
    configJson: {
      bot: {
        botUserId: input.botUserId,
      },
    },
  });
}

function createSlackWorkspaceIntegration(input: {
  displayName: string;
  appId: string;
  botUserId: string;
}) {
  return createExternalIntegrationSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    provider: SLACK_PROVIDER_ID,
    displayName: input.displayName,
    transportMode: "http_webhook",
    appId: input.appId,
    tenantKey: "T_SHARED",
    configJson: {
      bot: {
        botUserId: input.botUserId,
      },
    },
  });
}

function buildSlackMentionPayload(input: {
  eventId: string;
  appId: string;
  botUserId: string;
  userId?: string;
  messageTs: string;
  text: string;
  appContext?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    type: "event_callback",
    event_id: input.eventId,
    api_app_id: input.appId,
    team_id: "T_SHARED",
    event_time: 1783400000,
    event: {
      type: "app_mention",
      channel: "C_SHARED",
      channel_type: "channel",
      user: input.userId ?? "UMINA",
      text: input.text,
      ts: input.messageTs,
      event_ts: input.messageTs,
      bot_id: undefined,
      bot_user_id: input.botUserId,
      app_context: input.appContext,
    },
  };
}

function buildSlackAppHomeOpenedPayload(input: {
  eventId: string;
  appId: string;
  userId: string;
  channelId: string;
}): Record<string, unknown> {
  return {
    type: "event_callback",
    event_id: input.eventId,
    api_app_id: input.appId,
    team_id: "T_SHARED",
    event_time: 1783400000,
    event: {
      type: "app_home_opened",
      tab: "messages",
      channel: input.channelId,
      user: input.userId,
      event_ts: "1783400002.000100",
    },
  };
}
