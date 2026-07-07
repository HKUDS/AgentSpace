import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { before, beforeEach } from "node:test";
import {
  createWorkspaceSync,
  getDatabase,
} from "@agent-space/db";
import {
  createSlackAgentBotBindingSync,
  disableSlackAgentBotBindingSync,
  listSlackAgentBotBindingsSync,
  readSlackAgentBotBindingByAgentSync,
} from "../agent-bot-bindings.ts";
import {
  readSlackIntegrationCredentials,
  summarizeSlackStoredCredentials,
} from "../credentials.ts";

const originalCwd = process.cwd();
const repositoryRoot = existsSync(join(originalCwd, "Target.md")) ? originalCwd : join(originalCwd, "..", "..", "..", "..");
const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-slack-agent-bots-"));
const databaseTestOptions = process.env.AGENT_SPACE_SLACK_AGENT_BOT_DB_TESTS === "1"
  ? {}
  : { skip: "Set AGENT_SPACE_SLACK_AGENT_BOT_DB_TESTS=1 with a test Postgres URL to run Slack agent bot DB tests." };

before(() => {
  writeFileSync(join(tempRoot, "Target.md"), "# test\n");
  mkdirSync(join(tempRoot, "data"), { recursive: true });
  const packagesLink = join(tempRoot, "packages");
  if (!existsSync(packagesLink)) {
    symlinkSync(join(repositoryRoot, "packages"), packagesLink, "dir");
  }
  process.chdir(tempRoot);
  process.env.AGENT_SPACE_SLACK_CREDENTIAL_ENCRYPTION_KEY = Buffer
    .from("0123456789abcdef0123456789abcdef", "utf8")
    .toString("base64");
});

beforeEach(() => {
  getDatabase().exec(`
    DELETE FROM external_integration_event;
    DELETE FROM external_message_outbox;
    DELETE FROM external_message_mapping;
    DELETE FROM external_thread_binding;
    DELETE FROM external_channel_binding;
    DELETE FROM external_user_binding;
    DELETE FROM external_integration;
    DELETE FROM workspace;
  `);
});

test("Slack agent bot binding defaults to Socket Mode with encrypted credentials", databaseTestOptions, () => {
  const workspace = createWorkspaceSync({
    slug: "slack-agent-bot-basic",
    name: "Slack Agent Bot Basic",
    createdBy: "system",
  });

  const binding = createSlackAgentBotBindingSync({
    workspaceId: workspace.id,
    agentId: "Codex",
    appId: "A123",
    teamId: "T123",
    botToken: "xoxb-secret",
    signingSecret: "signing-secret",
    appLevelToken: "xapp-secret",
  });

  assert.equal(binding.agentId, "Codex");
  assert.equal(binding.transportMode, "websocket_worker");
  assert.equal(binding.displayName, "Codex Slack Bot");
  assert.deepEqual(summarizeSlackStoredCredentials(binding), {
    hasBotToken: true,
    hasSigningSecret: true,
    hasAppLevelToken: true,
    hasClientId: false,
    hasClientSecret: false,
  });
  assert.deepEqual(readSlackIntegrationCredentials(binding), {
    botToken: "xoxb-secret",
    signingSecret: "signing-secret",
    appLevelToken: "xapp-secret",
    clientId: "",
    clientSecret: "",
  });
  assert.deepEqual(JSON.parse(binding.configJson), {
    eventCallbackPath: "/api/integrations/slack/events",
    agentBotBinding: true,
    capabilities: {
      messageTransport: true,
      socketMode: true,
      agentView: false,
    },
  });
  assert.equal(readSlackAgentBotBindingByAgentSync({
    workspaceId: workspace.id,
    agentId: "Codex",
  })?.id, binding.id);
  assert.deepEqual(listSlackAgentBotBindingsSync({
    workspaceId: workspace.id,
  }).map((item) => item.id), [binding.id]);
  assert.doesNotMatch(binding.encryptedCredentialsJson, /xoxb-secret|signing-secret|xapp-secret/);
});

test("Slack agent bot binding rejects placeholders and duplicate active agent ownership", databaseTestOptions, () => {
  const workspace = createWorkspaceSync({
    slug: "slack-agent-bot-duplicates",
    name: "Slack Agent Bot Duplicates",
    createdBy: "system",
  });

  createSlackAgentBotBindingSync({
    workspaceId: workspace.id,
    agentId: "Codex",
    appId: "A123",
    botToken: "xoxb-secret",
    signingSecret: "signing-secret",
    appLevelToken: "xapp-secret",
  });

  assert.throws(() => createSlackAgentBotBindingSync({
    workspaceId: workspace.id,
    agentId: "Codex",
    appId: "A456",
    botToken: "xoxb-other",
    signingSecret: "signing-other",
    appLevelToken: "xapp-other",
  }), /slack\.agent_bot_binding\.duplicate_agent/);
  assert.throws(() => createSlackAgentBotBindingSync({
    workspaceId: workspace.id,
    agentId: "Atlas",
    appId: "CHANGE_ME_SLACK_APP_ID",
    botToken: "xoxb-other",
    signingSecret: "signing-other",
    appLevelToken: "xapp-other",
  }), /slack\.agent_bot_binding\.placeholder_value:appId/);
});

test("Slack agent bot binding can be disabled by agent", databaseTestOptions, () => {
  const workspace = createWorkspaceSync({
    slug: "slack-agent-bot-disable",
    name: "Slack Agent Bot Disable",
    createdBy: "system",
  });
  const binding = createSlackAgentBotBindingSync({
    workspaceId: workspace.id,
    agentId: "Codex",
    appId: "A123",
    botToken: "xoxb-secret",
    signingSecret: "signing-secret",
    appLevelToken: "xapp-secret",
  });

  const disabled = disableSlackAgentBotBindingSync({
    workspaceId: workspace.id,
    agentId: "Codex",
    updatedByUserId: "admin-1",
  });

  assert.equal(disabled.id, binding.id);
  assert.equal(disabled.status, "disabled");
  assert.equal(readSlackAgentBotBindingByAgentSync({
    workspaceId: workspace.id,
    agentId: "Codex",
  }), null);
  assert.equal(readSlackAgentBotBindingByAgentSync({
    workspaceId: workspace.id,
    agentId: "Codex",
    includeDisabled: true,
  })?.id, binding.id);
});
