import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { before } from "node:test";
import { createDefaultWorkspaceState } from "@agent-space/domain/workspace";
import { getDatabase, listStoredChannelsSync, registerDaemonRuntimesSync, upsertAgentRouterSessionSync, createWorkspaceNotificationSync } from "@agent-space/db";
import { createChannelDocumentSync, readWorkspaceStateSync, writeWorkspaceStateSync } from "../index.ts";
import { renameChannelSync } from "./channels.ts";
import { getChannelHistoryFilePath } from "../shared/messaging.ts";

const originalCwd = process.cwd();
const root = mkdtempSync(join(tmpdir(), "agent-space-channel-rename-"));
const workspaceId = "rename-workspace";
before(() => {
  mkdirSync(join(root, "data"));
  writeFileSync(join(root, "Target.md"), "# test\n");
  process.chdir(root);
});
test.after(() => process.chdir(originalCwd));

function seed() {
  const state = createDefaultWorkspaceState();
  state.humanMembers = [{ name: "Owner", role: "Owner" }];
  state.channels = ["ops", "unrelated"].map((name) => ({ name, humanMemberNames: ["Owner"], humanMembers: 1, employeeNames: [] }));
  writeWorkspaceStateSync(state, workspaceId);
  return getDatabase();
}

test("renaming keeps collaboration resources and operational references in the same channel", () => {
  const db = seed();
  const document = createChannelDocumentSync({ channelName: "ops", title: "Notes", contentMarkdown: "ops is literal content", createdBy: "Owner", createdByType: "human" }, workspaceId);
  const state = readWorkspaceStateSync(workspaceId);
  const timestamp = new Date().toISOString();
  state.channelDocumentRuns.push({ id: "run", channelName: "ops", sourceMessageId: "message", sourceSummary: "ops", mode: "parallel", status: "completed", createdAt: timestamp, updatedAt: timestamp });
  state.approvals.push({ id: "approval", type: "task_output", sourceId: "task", agentId: "Atlas", channelName: "ops", status: "pending", contentPreview: "ops", createdAt: timestamp });
  state.dataTables.push({ id: "table", name: "ops", channelName: "ops", columns: [], rows: [], status: "active", createdBy: "Owner", createdAt: timestamp, updatedAt: timestamp });
  state.scheduledTasks.push({ id: "schedule", title: "ops", description: "ops", channelName: "ops", repeat: "once", scheduledAt: timestamp, status: "active", createdBy: "Owner", createdAt: timestamp, updatedAt: timestamp });
  state.tasks.push({ id: "task", title: "ops", channel: "ops", assignee: "Atlas", priority: "medium", status: "todo" });
  state.conversationExecutionWorkspaces = [{ conversationKey: "group:ops:Atlas", conversationKind: "group", channelName: "ops", agentId: "Atlas", updatedAt: timestamp, workDir: "/existing/workdir", sessionId: "session" }];
  writeWorkspaceStateSync(state, workspaceId);
  const router = upsertAgentRouterSessionSync({ workspaceId, agentId: "Atlas", conversationKey: "channel_conversation:ops", sourceType: "channel_conversation" });
  const daemon = registerDaemonRuntimesSync({ workspaceId, daemonKey: "rename-fixture", deviceName: "test", runtimes: [{ provider: "opencode", name: "test" }] });
  const runtime = daemon.runtimes[0];
  assert.ok(runtime);
  const historyPath = getChannelHistoryFilePath("ops", workspaceId);
  writeFileSync(historyPath, "# Existing conversation\n");
  db.prepare(`INSERT INTO agent_task_queue (id, workspace_id, agent_id, runtime_id, router_session_id, trigger_type, status, input_json, queued_at, created_at, updated_at)
    VALUES ('rename-queued', ?, 'Atlas', ?, ?, 'channel_chat', 'queued', ?, ?, ?, ?)`).run(workspaceId, runtime.id, router.id, JSON.stringify({ channel: "ops", channelName: "ops", sourceChannel: "ops", channelHistoryPath: historyPath, title: "ops", sourceContext: { governance: { channelName: "ops" } } }), timestamp, timestamp, timestamp);
  db.prepare(`INSERT INTO token_usage (id, workspace_id, task_queue_id, agent_id, model_id, cost_usd, channel_name, created_at)
    VALUES ('usage', ?, 'rename-queued', 'Atlas', 'test', 1, 'ops', ?)`).run(workspaceId, timestamp);
  db.prepare(`INSERT INTO budget (id, workspace_id, scope, scope_id, limit_usd, created_at, updated_at)
    VALUES ('budget', ?, 'channel', 'ops', 10, ?, ?)`).run(workspaceId, timestamp, timestamp);
  const notification = createWorkspaceNotificationSync({ workspaceId, recipientType: "human", recipientId: "Owner", type: "test", resourceType: "channel", resourceId: "ops", channelName: "ops", title: "ops", body: "ops", actionHref: "/im?focus=channel%3Aops", metadata: { channelName: "ops", literal: "ops" } });

  renameChannelSync("OPS", "planning", workspaceId);
  const renamed = readWorkspaceStateSync(workspaceId);
  assert.equal(renamed.channelDocuments.find((item) => item.id === document.document.id)?.channelName, "planning");
  assert.equal(renamed.channelDocumentRuns[0]?.channelName, "planning");
  assert.equal(renamed.approvals[0]?.channelName, "planning");
  assert.equal(renamed.dataTables[0]?.channelName, "planning");
  assert.equal(renamed.scheduledTasks[0]?.channelName, "planning");
  assert.equal(renamed.tasks[0]?.channel, "planning");
  assert.equal(renamed.conversationExecutionWorkspaces?.[0]?.conversationKey, "group:planning:Atlas");
  assert.equal(renamed.conversationExecutionWorkspaces?.[0]?.workDir, "/existing/workdir");
  assert.equal(renamed.conversationExecutionWorkspaces?.[0]?.sessionId, "session");
  assert.ok(listStoredChannelsSync(workspaceId).some((channel) => channel.name === "unrelated"));
  const queued = db.prepare("SELECT input_json AS payload FROM agent_task_queue WHERE id = 'rename-queued'").get();
  const payload = JSON.parse(String(queued?.payload));
  assert.equal(payload.channel, "planning");
  assert.equal(payload.channelName, "planning");
  assert.equal(payload.sourceChannel, "planning");
  assert.equal(payload.channelHistoryPath, getChannelHistoryFilePath("planning", workspaceId));
  assert.equal(payload.sourceContext.governance.channelName, "planning");
  assert.equal(payload.title, "ops");
  assert.match(readFileSync(payload.channelHistoryPath, "utf8"), /Existing conversation/);
  assert.equal(db.prepare("SELECT channel_name AS name FROM token_usage WHERE id = 'usage'").get()?.name, "planning");
  assert.equal(db.prepare("SELECT scope_id AS name FROM budget WHERE id = 'budget'").get()?.name, "planning");
  assert.equal(db.prepare("SELECT conversation_key AS name FROM agent_router_session WHERE id = ?").get(router.id)?.name, "channel_conversation:planning");
  const notice = db.prepare('SELECT channel_name AS name, resource_id AS resource, action_href AS href, metadata_json AS metadata FROM workspace_notification WHERE id = ?').get(notification.id);
  assert.equal(notice?.name, "planning");
  assert.equal(notice?.resource, "planning");
  assert.equal(new URL(String(notice?.href), "https://workspace.invalid").searchParams.get("focus"), "channel:planning");
  assert.equal(JSON.parse(String(notice?.metadata)).literal, "ops");
});

test("claimed inputs stop a rename before any channel identity changes", () => {
  const db = getDatabase();
  db.prepare("UPDATE agent_task_queue SET status = 'claimed' WHERE id = 'rename-queued'").run();
  assert.throws(() => renameChannelSync("planning", "changed", workspaceId), /running tasks/);
  assert.ok(readWorkspaceStateSync(workspaceId).channels.some((item) => item.name === "planning"));
  assert.ok(listStoredChannelsSync(workspaceId).some((item) => item.name === "planning"));
});

test("a relational conflict rolls back earlier migrated rows", () => {
  const db = getDatabase();
  const timestamp = new Date().toISOString();
  db.prepare("UPDATE agent_task_queue SET status = 'queued' WHERE id = 'rename-queued'").run();
  db.prepare(`INSERT INTO budget (id, workspace_id, scope, scope_id, limit_usd, created_at, updated_at)
    VALUES ('destination-budget', ?, 'channel', 'collision', 10, ?, ?)`).run(workspaceId, timestamp, timestamp);
  assert.throws(() => renameChannelSync("planning", "collision", workspaceId), /duplicate key/);
  assert.equal(db.prepare("SELECT channel_name AS name FROM token_usage WHERE id = 'usage'").get()?.name, "planning");
  assert.equal(db.prepare("SELECT channel_name AS name FROM workspace_task WHERE id = 'task'").get()?.name, "planning");
  assert.ok(listStoredChannelsSync(workspaceId).some((item) => item.name === "planning"));
  assert.ok(readWorkspaceStateSync(workspaceId).channels.some((item) => item.name === "planning"));
});

test("a failed snapshot save rolls back the relational rename", () => {
  const db = getDatabase();
  const prepare = db.prepare;
  db.prepare = (sql) => {
    if (/UPDATE workspace_snapshot/i.test(sql)) throw new Error("Snapshot save failed");
    return prepare.call(db, sql);
  };
  try {
    assert.throws(() => renameChannelSync("planning", "late-failure", workspaceId), /Snapshot save failed/);
  } finally {
    db.prepare = prepare;
  }
  assert.equal(db.prepare("SELECT channel_name AS name FROM token_usage WHERE id = 'usage'").get()?.name, "planning");
  assert.ok(listStoredChannelsSync(workspaceId).some((item) => item.name === "planning"));
  assert.ok(readWorkspaceStateSync(workspaceId).channels.some((item) => item.name === "planning"));
});
