import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { before, beforeEach } from "node:test";
import { resolvePostgresDatabaseUrl } from "./postgres-config.ts";
import {
  bindEmployeeRuntimeSync,
  chooseProviderSessionForTaskSync,
  claimNextQueuedTaskForRuntimeSync,
  completeQueuedTaskSync,
  createAgentRouterContextSnapshotSync,
  createAgentTaskAttemptSync,
  createWorkspaceSync,
  enqueueNativeTaskSync,
  failQueuedTaskSync,
  findActiveProviderSessionForRouterSync,
  getDatabase,
  listAgentRouterEventsSync,
  listAgentRouterProviderSessionsSync,
  listAgentRouterSessionsSync,
  listAgentTaskAttemptsSync,
  readAgentRouterSessionSync,
  readAgentTaskAttemptSync,
  readLatestAgentRouterContextSnapshotSync,
  readLatestAgentTaskAttemptForTaskSync,
  readQueuedTaskSync,
  registerDaemonRuntimesSync,
  resetWorkspaceExecutionStateSync,
  resolveRouterSessionForTaskSync,
  resolveTaskRouterConversationIdentity,
  startQueuedTaskSync,
  upsertAgentRouterProviderSessionSync,
} from "./index.ts";

const originalCwd = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-router-sessions-"));

before(() => {
  writeFileSync(join(tempRoot, "Target.md"), "# test\n");
  mkdirSync(join(tempRoot, "data"), { recursive: true });
  process.chdir(tempRoot);
});

beforeEach(() => {
  const db = getDatabase();
  db.exec(`
    DELETE FROM task_message;
    DELETE FROM task_execution_event;
    DELETE FROM token_usage;
    DELETE FROM agent_router_event;
    DELETE FROM agent_router_context_snapshot;
    DELETE FROM agent_task_attempt;
    DELETE FROM agent_router_provider_session;
    DELETE FROM agent_task_queue;
    DELETE FROM agent_router_session;
    DELETE FROM employee_runtime_binding;
    DELETE FROM agent_runtime;
    DELETE FROM daemon_connection;
    DELETE FROM workspace_snapshot;
    DELETE FROM workspace;
  `);
});

test("resolves stable router sessions for conversation tasks", () => {
  const workspace = createTestWorkspace("router-session-resolution");
  const firstTask = {
    id: "queue-first",
    workspaceId: workspace.id,
    agentId: "Atlas",
    triggerType: "channel_chat",
    inputJson: JSON.stringify({ channelName: "ops", title: "Ops thread" }),
    issueId: undefined,
  };
  const identity = resolveTaskRouterConversationIdentity(firstTask);
  assert.deepEqual(identity, {
    conversationKey: "channel_conversation:ops",
    sourceType: "channel_conversation",
    title: "Ops thread",
  });

  const first = resolveRouterSessionForTaskSync(firstTask);
  const second = resolveRouterSessionForTaskSync({
    id: "queue-second",
    workspaceId: workspace.id,
    agentId: "Atlas",
    triggerType: "mention_chat",
    inputJson: JSON.stringify({ channelName: "ops", title: "Follow-up" }),
    issueId: undefined,
  });
  const third = resolveRouterSessionForTaskSync({
    id: "queue-third",
    workspaceId: workspace.id,
    agentId: "Beacon",
    triggerType: "channel_chat",
    inputJson: JSON.stringify({ channelName: "ops" }),
    issueId: undefined,
  });

  assert.equal(second.id, first.id);
  assert.equal(second.conversationKey, "channel_conversation:ops");
  assert.equal(second.title, "Follow-up");
  assert.notEqual(third.id, first.id);
  assert.deepEqual(listAgentRouterSessionsSync({ workspaceId: workspace.id }).map((session) => session.id).sort(), [
    first.id,
    third.id,
  ].sort());
});

test("keeps provider session mappings independent from router sessions", () => {
  const { workspaceId, runtimeId } = seedWorkspaceRuntime("router-provider");
  const routerSession = resolveRouterSessionForTaskSync({
    id: "queue-provider",
    workspaceId,
    agentId: "Atlas",
    triggerType: "manual",
    inputJson: "{}",
    issueId: "task-provider",
  });

  const providerSession = upsertAgentRouterProviderSessionSync({
    workspaceId,
    routerSessionId: routerSession.id,
    runtimeId,
    provider: "codex",
    providerSessionId: "provider-session-1",
    metadata: { taskQueueId: "queue-provider" },
  });
  const updated = upsertAgentRouterProviderSessionSync({
    workspaceId,
    routerSessionId: routerSession.id,
    runtimeId,
    provider: "codex",
    providerSessionId: "provider-session-2",
    metadata: { taskQueueId: "queue-provider-2" },
  });

  assert.equal(updated.id, providerSession.id);
  assert.equal(updated.providerSessionId, "provider-session-2");
  assert.equal(findActiveProviderSessionForRouterSync({
    workspaceId,
    routerSessionId: routerSession.id,
    runtimeId,
    provider: "codex",
  })?.providerSessionId, "provider-session-2");

  failQueuedTaskSync({
    taskId: seedQueue(workspaceId, runtimeId, routerSession.id, "queue-provider-fail"),
    errorText: "provider session expired",
    sessionId: "provider-session-2",
    errorCode: "provider.session_invalid",
    errorCategory: "provider",
    provider: "codex",
  });

  assert.equal(readAgentRouterSessionSync(routerSession.id)?.status, "active");
  assert.equal(findActiveProviderSessionForRouterSync({
    workspaceId,
    routerSessionId: routerSession.id,
    runtimeId,
    provider: "codex",
  }), null);
  assert.equal(listAgentRouterProviderSessionsSync({ routerSessionId: routerSession.id })[0]?.status, "invalid");
});

test("records attempts, events, and context snapshots for router sessions", () => {
  const { workspaceId, runtimeId } = seedWorkspaceRuntime("router-attempts");
  const task = enqueueNativeTaskSync({
    workspaceId,
    assignee: "Atlas",
    title: "Draft the brief",
    channel: "ops",
    priority: "high",
    triggerType: "channel_chat",
  });
  assert.ok(task?.routerSessionId);

  const claimed = claimNextQueuedTaskForRuntimeSync(runtimeId, workspaceId);
  assert.equal(claimed?.id, task.id);
  const attempt = readLatestAgentTaskAttemptForTaskSync(task.id);
  assert.ok(attempt);
  assert.equal(attempt.routerSessionId, task.routerSessionId);
  assert.equal(attempt.provider, "codex");
  assert.equal(listAgentTaskAttemptsSync({ routerSessionId: task.routerSessionId }).length, 1);

  startQueuedTaskSync(task.id);
  completeQueuedTaskSync({
    taskId: task.id,
    sessionId: "provider-session-complete",
    workDir: "/tmp/work",
    resultJson: { output: "Brief complete" },
  });

  const completedAttempt = readAgentTaskAttemptSync(attempt.id);
  assert.equal(completedAttempt?.status, "completed");
  assert.equal(completedAttempt?.providerSessionId, "provider-session-complete");
  assert.equal(chooseProviderSessionForTaskSync({ task: readQueuedTaskSync(task.id)! })?.providerSessionId, "provider-session-complete");

  const contextSnapshot = createAgentRouterContextSnapshotSync({
    workspaceId,
    routerSessionId: task.routerSessionId,
    taskQueueId: task.id,
    snapshotType: "context",
    contentMarkdown: "# Context",
    sourceEventIds: listAgentRouterEventsSync({ routerSessionId: task.routerSessionId }).map((event) => event.id),
  });
  assert.equal(readLatestAgentRouterContextSnapshotSync({
    workspaceId,
    routerSessionId: task.routerSessionId,
    snapshotType: "context",
  })?.id, contextSnapshot.id);
  assert.deepEqual(
    listAgentRouterEventsSync({ routerSessionId: task.routerSessionId })
      .map((event) => event.type)
      .filter((type) => !type.startsWith("task.")),
    ["task_queued", "runtime_selected", "provider_started", "final_answer"],
  );
  assert.ok(listAgentRouterEventsSync({ routerSessionId: task.routerSessionId })
    .some((event) => event.type === "task.completed"));
});

test("does not return a task claimed by another connection after selection", () => {
  const { workspaceId, runtimeId } = seedWorkspaceRuntime("router-claim-race");
  const task = enqueueNativeTaskSync({
    workspaceId,
    assignee: "Atlas",
    title: "Claim exactly once",
    channel: "ops",
    priority: "high",
    triggerType: "channel_chat",
  });
  assert.ok(task?.routerSessionId);
  const db = getDatabase();
  const originalPrepare = db.prepare;
  let competingClaim = false;
  db.prepare = function (sql) {
    const statement = originalPrepare.call(db, sql);
    if (!competingClaim && /SELECT id\s+FROM agent_task_queue/.test(sql)) {
      const originalGet = statement.get;
      statement.get = function (...params) {
        const selected = originalGet.apply(statement, params);
        assert.ok(selected);
        competingClaim = true;
        const competitor = spawnSync(process.execPath, ["-e", `
          const { Client } = require(process.argv[1]);
          const client = new Client({ connectionString: process.env.AGENT_SPACE_TEST_DATABASE_URL });
          (async () => {
            await client.connect();
            const result = await client.query(
              "UPDATE agent_task_queue SET status = 'claimed' WHERE id = $1 AND status = 'queued'",
              [process.argv[2]],
            );
            if (result.rowCount !== 1) throw new Error("Competing claim did not win.");
            await client.end();
          })().catch(error => { console.error(error); process.exitCode = 1; });
        `, createRequire(import.meta.url).resolve("pg"), task.id], {
          env: { ...process.env, AGENT_SPACE_TEST_DATABASE_URL: resolvePostgresDatabaseUrl() },
          encoding: "utf8",
          timeout: 15_000,
        });
        assert.equal(competitor.status, 0, competitor.stderr);
        return selected;
      };
    }
    return statement;
  };
  try {
    assert.equal(claimNextQueuedTaskForRuntimeSync(runtimeId, workspaceId), null);
  } finally {
    db.prepare = originalPrepare;
  }
  assert.equal(competingClaim, true);
  assert.equal(readQueuedTaskSync(task.id)?.status, "claimed");
  assert.deepEqual(listAgentTaskAttemptsSync({ routerSessionId: task.routerSessionId }), []);
});

test("resetWorkspaceExecutionStateSync clears router execution rows", () => {
  const { workspaceId, runtimeId } = seedWorkspaceRuntime("router-reset");
  const taskId = seedQueue(workspaceId, runtimeId, "router-reset-session", "queue-reset");
  createAgentTaskAttemptSync({
    workspaceId,
    taskQueueId: taskId,
    routerSessionId: "router-reset-session",
    runtimeId,
    provider: "codex",
  });

  const reset = resetWorkspaceExecutionStateSync(workspaceId);

  assert.equal(reset.removedAgentTaskAttemptRows, 1);
  assert.equal(reset.removedAgentRouterSessionRows, 1);
  assert.deepEqual(listAgentRouterSessionsSync({ workspaceId }), []);
  assert.deepEqual(listAgentTaskAttemptsSync({ workspaceId }), []);
});

function createTestWorkspace(prefix: string): ReturnType<typeof createWorkspaceSync> {
  const suffix = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  return createWorkspaceSync({
    id: `${prefix}-${suffix}`,
    slug: `${prefix}-${suffix}`,
    name: `${prefix} ${suffix}`,
    createdBy: "test",
  });
}

function seedWorkspaceRuntime(prefix: string): { workspaceId: string; runtimeId: string } {
  const workspace = createTestWorkspace(prefix);
  const runtime = registerDaemonRuntimesSync({
    workspaceId: workspace.id,
    daemonKey: `${workspace.id}-daemon`,
    deviceName: `${workspace.id} daemon`,
    runtimes: [{ provider: "codex", name: "Codex Runtime" }],
  }).runtimes[0];
  assert.ok(runtime?.id);
  bindEmployeeRuntimeSync({
    workspaceId: workspace.id,
    employeeName: "Atlas",
    runtimeId: runtime.id,
  });
  return { workspaceId: workspace.id, runtimeId: runtime.id };
}

function seedQueue(workspaceId: string, runtimeId: string, routerSessionId: string, queueId: string): string {
  getDatabase().prepare(
    `INSERT INTO agent_router_session (
      id,
      workspace_id,
      agent_id,
      conversation_key,
      source_type,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, 'Atlas', ?, 'task', 'active', ?, ?)
    ON CONFLICT(id) DO NOTHING`,
  ).run(routerSessionId, workspaceId, `task:${queueId}`, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  getDatabase().prepare(
    `INSERT INTO agent_task_queue (
      id,
      workspace_id,
      agent_id,
      runtime_id,
      router_session_id,
      issue_id,
      trigger_type,
      priority,
      status,
      input_json,
      queued_at,
      created_at,
      updated_at
    ) VALUES (?, ?, 'Atlas', ?, ?, ?, 'manual', 0, 'claimed', '{}', ?, ?, ?)`,
  ).run(queueId, workspaceId, runtimeId, routerSessionId, queueId, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  return queueId;
}

test.after(() => {
  process.chdir(originalCwd);
});
