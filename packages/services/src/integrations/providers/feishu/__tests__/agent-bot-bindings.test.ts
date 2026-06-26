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
  createFeishuAgentBotBindingSync,
  disableFeishuAgentBotBindingSync,
  listFeishuAgentBotBindingsSync,
  readFeishuAgentBotBindingByAgentSync,
  rotateFeishuAgentBotCredentialsSync,
} from "../agent-bot-bindings.ts";
import {
  readFeishuIntegrationCredentials,
  summarizeFeishuStoredCredentials,
} from "../credentials.ts";

const originalCwd = process.cwd();
const repositoryRoot = existsSync(join(originalCwd, "Target.md")) ? originalCwd : join(originalCwd, "..", "..", "..", "..");
const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-feishu-agent-bots-"));
const databaseTestOptions = process.env.AGENT_SPACE_FEISHU_AGENT_BOT_DB_TESTS === "1"
  ? {}
  : { skip: "Set AGENT_SPACE_FEISHU_AGENT_BOT_DB_TESTS=1 with a test Postgres URL to run Feishu agent bot DB tests." };

before(() => {
  writeFileSync(join(tempRoot, "Target.md"), "# test\n");
  mkdirSync(join(tempRoot, "data"), { recursive: true });
  const packagesLink = join(tempRoot, "packages");
  if (!existsSync(packagesLink)) {
    symlinkSync(join(repositoryRoot, "packages"), packagesLink, "dir");
  }
  process.chdir(tempRoot);
  process.env.AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY = Buffer
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

test("Feishu agent bot binding defaults to websocket worker with only app credentials", databaseTestOptions, () => {
  const workspace = createWorkspaceSync({
    slug: "feishu-agent-bot-basic",
    name: "Feishu Agent Bot Basic",
    createdBy: "system",
  });

  const binding = createFeishuAgentBotBindingSync({
    workspaceId: workspace.id,
    agentId: "Codex",
    appId: "cli_codex_bot",
    appSecret: "super-secret",
  });

  assert.equal(binding.agentId, "Codex");
  assert.equal(binding.transportMode, "websocket_worker");
  assert.equal(binding.displayName, "Codex Feishu Bot");
  assert.deepEqual(summarizeFeishuStoredCredentials(binding), {
    hasAppSecret: true,
    hasVerificationToken: false,
    hasEncryptKey: false,
  });
  assert.deepEqual(readFeishuIntegrationCredentials(binding), {
    appSecret: "super-secret",
    verificationToken: "",
    encryptKey: undefined,
  });
  assert.equal(readFeishuAgentBotBindingByAgentSync({
    workspaceId: workspace.id,
    agentId: "Codex",
  })?.id, binding.id);
  assert.deepEqual(listFeishuAgentBotBindingsSync({
    workspaceId: workspace.id,
  }).map((item) => item.id), [binding.id]);
});

test("Feishu agent bot binding keeps EventCallback verification token in advanced credentials", databaseTestOptions, () => {
  const workspace = createWorkspaceSync({
    slug: "feishu-agent-bot-webhook",
    name: "Feishu Agent Bot Webhook",
    createdBy: "system",
  });

  assert.throws(() => createFeishuAgentBotBindingSync({
    workspaceId: workspace.id,
    agentId: "Codex",
    appId: "cli_codex_webhook",
    appSecret: "super-secret",
    transportMode: "http_webhook",
  }), /feishu\.agent_bot_binding\.missing_verification_token/);

  const binding = createFeishuAgentBotBindingSync({
    workspaceId: workspace.id,
    agentId: "Codex",
    appId: "cli_codex_webhook",
    appSecret: "super-secret",
    transportMode: "http_webhook",
    verificationToken: "verify-token",
    encryptKey: "encrypt-key",
  });

  assert.equal(binding.transportMode, "http_webhook");
  assert.deepEqual(summarizeFeishuStoredCredentials(binding), {
    hasAppSecret: true,
    hasVerificationToken: true,
    hasEncryptKey: true,
  });
});

test("Feishu agent bot binding rejects placeholders and duplicate bot ownership", databaseTestOptions, () => {
  const workspace = createWorkspaceSync({
    slug: "feishu-agent-bot-duplicates",
    name: "Feishu Agent Bot Duplicates",
    createdBy: "system",
  });

  assert.throws(() => createFeishuAgentBotBindingSync({
    workspaceId: workspace.id,
    agentId: "Codex",
    appId: "CHANGE_ME_APP_ID",
    appSecret: "super-secret",
  }), /feishu\.agent_bot_binding\.placeholder_value:appId/);

  createFeishuAgentBotBindingSync({
    workspaceId: workspace.id,
    agentId: "Codex",
    appId: "cli_codex_bot",
    appSecret: "super-secret",
  });
  assert.throws(() => createFeishuAgentBotBindingSync({
    workspaceId: workspace.id,
    agentId: "Codex",
    appId: "cli_codex_bot_2",
    appSecret: "super-secret",
  }), /feishu\.agent_bot_binding\.duplicate_agent/);
  assert.throws(() => createFeishuAgentBotBindingSync({
    workspaceId: workspace.id,
    agentId: "HermesAgent",
    appId: "cli_codex_bot",
    appSecret: "super-secret",
  }), /feishu\.agent_bot_binding\.duplicate_app_tenant/);
});

test("Feishu agent bot credentials can be rotated and disabled without exposing secrets", databaseTestOptions, () => {
  const workspace = createWorkspaceSync({
    slug: "feishu-agent-bot-rotate",
    name: "Feishu Agent Bot Rotate",
    createdBy: "system",
  });
  const binding = createFeishuAgentBotBindingSync({
    workspaceId: workspace.id,
    agentId: "Codex",
    appId: "cli_codex_rotating",
    appSecret: "first-secret",
    transportMode: "http_webhook",
    verificationToken: "verify-token",
  });

  const rotated = rotateFeishuAgentBotCredentialsSync({
    workspaceId: workspace.id,
    integrationId: binding.id,
    appSecret: "second-secret",
  });
  assert.deepEqual(readFeishuIntegrationCredentials(rotated), {
    appSecret: "second-secret",
    verificationToken: "verify-token",
    encryptKey: undefined,
  });
  assert.doesNotMatch(JSON.stringify(rotated), /first-secret|second-secret|verify-token/);

  const disabled = disableFeishuAgentBotBindingSync({
    workspaceId: workspace.id,
    agentId: "Codex",
  });
  assert.equal(disabled.status, "disabled");
  assert.equal(readFeishuAgentBotBindingByAgentSync({
    workspaceId: workspace.id,
    agentId: "Codex",
  }), null);
  assert.equal(readFeishuAgentBotBindingByAgentSync({
    workspaceId: workspace.id,
    agentId: "Codex",
    includeDisabled: true,
  })?.id, binding.id);
});
