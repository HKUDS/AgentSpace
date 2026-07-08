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

  const messages = readWorkspaceStateSync(DEFAULT_WORKSPACE_ID).messages;
  const atlasMessage = messages.find((message) => message.data?.external_message_id === "1783400000.000100");
  const novaMessage = messages.find((message) => message.data?.external_message_id === "1783400000.000200");
  assert.equal(atlasMessage?.summary, "@Atlas summarize the launch plan");
  assert.equal(novaMessage?.summary, "@Nova review the metrics");
  assert.equal(atlasMessage?.mentions?.[0]?.token, "Atlas");
  assert.equal(novaMessage?.mentions?.[0]?.token, "Nova");
  assert.equal(atlasMessage?.data?.external_actor_agent_id, "Atlas");
  assert.equal(novaMessage?.data?.external_actor_agent_id, "Nova");
  assert.equal(atlasMessage?.data?.external_bot_binding_id, atlasIntegration.id);
  assert.equal(novaMessage?.data?.external_bot_binding_id, novaIntegration.id);
  assert.equal(String(atlasMessage?.data?.external_context).includes("C_VIEWED"), false);
  assert.equal(String(atlasMessage?.data?.external_context).includes("T_SHARED"), false);
  assert.match(atlasMessage?.data?.external_context ?? "", /"slackAgentContext"/);

  const atlasMappingMetadata = JSON.parse(atlasResult.mapping?.metadataJson ?? "{}") as Record<string, unknown>;
  assert.equal(JSON.stringify(atlasMappingMetadata).includes("C_VIEWED"), false);
  assert.equal(JSON.stringify(atlasMappingMetadata).includes("T_SHARED"), false);
  assert.equal(typeof atlasMappingMetadata.agentContext, "object");

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

function buildSlackMentionPayload(input: {
  eventId: string;
  appId: string;
  botUserId: string;
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
      user: "UMINA",
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
