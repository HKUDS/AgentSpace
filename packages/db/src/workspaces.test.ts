import test, { before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_WORKSPACE_ID,
  createWorkspaceSync,
  getDatabase,
  hardDeleteWorkspaceSync,
  readWorkspaceSync,
  writeWorkspaceStateRecordSync,
} from "./index.ts";

const originalCwd = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-db-workspaces-"));

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
    DELETE FROM daemon_api_token;
    DELETE FROM daemon_connection;
    DELETE FROM budget;
    DELETE FROM skill_import_event;
    DELETE FROM agent_skill;
    DELETE FROM agent_knowledge_page;
    DELETE FROM knowledge_page_assignment_policy;
    DELETE FROM skill_file;
    DELETE FROM skill;
    DELETE FROM workspace_task;
    DELETE FROM workspace_channel;
    DELETE FROM workspace_employee;
    DELETE FROM google_oauth_credential;
    DELETE FROM workspace_invitation;
    DELETE FROM workspace_membership;
    DELETE FROM workspace_snapshot;
    DELETE FROM workspace;
    DELETE FROM users;
  `);
});

test("hardDeleteWorkspaceSync removes all workspace-scoped records without touching other workspaces", () => {
  const purgeTarget = createWorkspaceSync({
    id: "workspace-purge",
    slug: "workspace-purge",
    name: "Purge Target",
    createdBy: "system",
  });
  const survivor = createWorkspaceSync({
    id: "workspace-keep",
    slug: "workspace-keep",
    name: "Keep Workspace",
    createdBy: "system",
  });

  seedWorkspaceRecords(purgeTarget.id, "purge");
  seedWorkspaceRecords(survivor.id, "keep");

  const result = hardDeleteWorkspaceSync(purgeTarget.id);
  const db = getDatabase();

  assert.equal(result.deletedWorkspace, true);
  assert.equal(result.removedWorkspaceRows, 1);
  assert.equal(result.removedWorkspaceSnapshotRows, 1);
  assert.equal(result.removedQueuedTaskRows, 1);
  assert.equal(result.removedTaskMessageRows, 1);
  assert.equal(result.removedTokenUsageRows, 1);
  assert.equal(result.removedAgentRouterSessionRows, 1);
  assert.equal(result.removedAgentRouterProviderSessionRows, 1);
  assert.equal(result.removedAgentTaskAttemptRows, 1);
  assert.equal(result.removedAgentRouterEventRows, 1);
  assert.equal(result.removedAgentRouterContextSnapshotRows, 1);
  assert.equal(result.removedRuntimeRows, 1);
  assert.equal(result.removedDaemonRows, 1);
  assert.equal(result.removedSkillRows, 1);
  assert.equal(result.removedBudgetRows, 1);
  assert.equal(result.removedRuntimeDisplayNameRows, 1);
  assert.equal(result.removedGoogleOAuthCredentialRows, 1);
  assert.equal(result.removedKnowledgeAssignmentPolicyRows, 1);
  assert.equal(result.removedAgentKnowledgePageRows, 1);

  assert.equal(readWorkspaceSync(purgeTarget.id), null);
  assert.equal(countWhere(db, "workspace_snapshot", "id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "workspace_membership", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "workspace_invitation", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "google_oauth_credential", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "workspace_channel", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "workspace_employee", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "workspace_task", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "daemon_connection", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "daemon_api_token", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "agent_runtime", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "workspace_runtime_display_name", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "employee_runtime_binding", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "agent_task_queue", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "agent_router_session", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "agent_router_provider_session", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "agent_task_attempt", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "agent_router_event", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "agent_router_context_snapshot", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "token_usage", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "skill", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "agent_skill", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "knowledge_page_assignment_policy", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "agent_knowledge_page", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "skill_import_event", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "budget", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "external_integration", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "external_user_binding", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "external_channel_binding", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "external_resource_binding", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "external_message_mapping", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "external_message_outbox", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "external_thread_binding", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "external_data_operation_run", "workspace_id", purgeTarget.id), 0);
  assert.equal(countWhere(db, "external_integration_event", "workspace_id", purgeTarget.id), 0);
  assert.equal(
    (
      db.prepare(
        `SELECT COUNT(*) AS count
         FROM skill_file sf
         INNER JOIN skill s ON s.id = sf.skill_id
         WHERE s.workspace_id = ?`,
      ).get(purgeTarget.id) as { count: number }
    ).count,
    0,
  );
  assert.equal(
    (
      db.prepare(
        `SELECT COUNT(*) AS count
         FROM task_message tm
         INNER JOIN agent_task_queue q ON q.id = tm.task_id
         WHERE q.workspace_id = ?`,
      ).get(purgeTarget.id) as { count: number }
    ).count,
    0,
  );

  assert.notEqual(readWorkspaceSync(survivor.id), null);
  assert.equal(countWhere(db, "workspace_channel", "workspace_id", survivor.id), 1);
  assert.equal(countWhere(db, "agent_task_queue", "workspace_id", survivor.id), 1);
  assert.equal(countWhere(db, "agent_router_session", "workspace_id", survivor.id), 1);
  assert.equal(countWhere(db, "agent_router_provider_session", "workspace_id", survivor.id), 1);
  assert.equal(countWhere(db, "agent_task_attempt", "workspace_id", survivor.id), 1);
  assert.equal(countWhere(db, "agent_router_event", "workspace_id", survivor.id), 1);
  assert.equal(countWhere(db, "agent_router_context_snapshot", "workspace_id", survivor.id), 1);
  assert.equal(countWhere(db, "google_oauth_credential", "workspace_id", survivor.id), 1);
  assert.equal(countWhere(db, "skill", "workspace_id", survivor.id), 1);
  assert.equal(countWhere(db, "agent_knowledge_page", "workspace_id", survivor.id), 1);
  assert.equal(countWhere(db, "external_integration", "workspace_id", survivor.id), 1);
  assert.equal(countWhere(db, "external_user_binding", "workspace_id", survivor.id), 1);
  assert.equal(countWhere(db, "external_channel_binding", "workspace_id", survivor.id), 1);
  assert.equal(countWhere(db, "external_resource_binding", "workspace_id", survivor.id), 1);
  assert.equal(countWhere(db, "external_message_mapping", "workspace_id", survivor.id), 1);
  assert.equal(countWhere(db, "external_message_outbox", "workspace_id", survivor.id), 1);
  assert.equal(countWhere(db, "external_thread_binding", "workspace_id", survivor.id), 1);
  assert.equal(countWhere(db, "external_data_operation_run", "workspace_id", survivor.id), 1);
  assert.equal(countWhere(db, "external_integration_event", "workspace_id", survivor.id), 1);
});

test("hardDeleteWorkspaceSync rejects the default workspace", () => {
  assert.throws(
    () => hardDeleteWorkspaceSync(DEFAULT_WORKSPACE_ID),
    /Cannot hard-delete the default workspace/,
  );
});

function seedWorkspaceRecords(workspaceId: string, suffix: string): void {
  const db = getDatabase();
  const now = "2026-01-01T00:00:00.000Z";
  writeWorkspaceStateRecordSync({
    organizationName: `${suffix} org`,
    humanMembers: [],
    activeEmployees: [],
    channels: [],
    messages: [],
    pendingHandoffs: 0,
    pendingApprovals: [],
    tasks: [],
    materials: [],
    knowledgePages: [],
    tables: [],
    automations: [],
    schedules: [],
    templates: [],
    channelDocuments: [],
    channelDocumentAccesses: [],
    ledger: [],
    skills: [],
  }, workspaceId, { skipVersionCheck: true });

  db.prepare(
    `INSERT INTO users (id, display_name, primary_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(`user-${suffix}`, `User ${suffix}`, `${suffix}@example.com`, now, now);

  db.prepare(
    `INSERT INTO workspace_membership (id, workspace_id, user_id, role, status, joined_at, invited_by)
     VALUES (?, ?, ?, 'owner', 'active', ?, 'system')`,
  ).run(`membership-${suffix}`, workspaceId, `user-${suffix}`, now);

  db.prepare(
    `INSERT INTO workspace_invitation (id, workspace_id, email, role, token_hash, status, invited_by, created_at, expires_at)
     VALUES (?, ?, ?, 'member', ?, 'active', 'system', ?, ?)`,
  ).run(`invite-${suffix}`, workspaceId, `${suffix}@example.com`, `token-${suffix}`, now, "2030-01-01T00:00:00.000Z");

  db.prepare(
    `INSERT INTO google_oauth_credential (
       id,
       workspace_id,
       user_id,
       google_subject,
       google_email,
       scopes,
       access_token_encrypted,
       refresh_token_encrypted,
       status,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, 'https://www.googleapis.com/auth/drive.file', 'access-token', 'refresh-token', 'active', ?, ?)`,
  ).run(`google-oauth-${suffix}`, workspaceId, `user-${suffix}`, `google-sub-${suffix}`, `${suffix}@example.com`, now, now);

  db.prepare(
    `INSERT INTO workspace_channel (id, workspace_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(`channel-${suffix}`, workspaceId, `channel-${suffix}`, now, now);

  db.prepare(
    `INSERT INTO external_integration (
       id,
       workspace_id,
       provider,
       display_name,
       status,
       transport_mode,
       app_id,
       encrypted_credentials_json,
       config_json,
       capabilities_json,
       scopes_json,
       created_at,
       updated_at,
       last_health_status
     ) VALUES (?, ?, 'feishu', ?, 'active', 'http_webhook', ?, '{}', '{}', '{}', '[]', ?, ?, 'unknown')`,
  ).run(`external-integration-${suffix}`, workspaceId, `Feishu ${suffix}`, `cli_${suffix}`, now, now);

  db.prepare(
    `INSERT INTO external_user_binding (
       id,
       workspace_id,
       integration_id,
       user_id,
       external_user_id,
       display_name,
       status,
       metadata_json,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'active', '{}', ?, ?)`,
  ).run(
    `external-user-binding-${suffix}`,
    workspaceId,
    `external-integration-${suffix}`,
    `user-${suffix}`,
    `ou_${suffix}`,
    `User ${suffix}`,
    now,
    now,
  );

  db.prepare(
    `INSERT INTO external_channel_binding (
       id,
       workspace_id,
       integration_id,
       channel_name,
       external_chat_id,
       external_chat_type,
       external_chat_name,
       status,
       sync_mode,
       metadata_json,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, 'group', ?, 'active', 'mirror', '{}', ?, ?)`,
  ).run(
    `external-channel-binding-${suffix}`,
    workspaceId,
    `external-integration-${suffix}`,
    `channel-${suffix}`,
    `oc_${suffix}`,
    `Chat ${suffix}`,
    now,
    now,
  );

  db.prepare(
    `INSERT INTO external_resource_binding (
       id,
       workspace_id,
       integration_id,
       provider_resource_type,
       provider_resource_token,
       provider_resource_url,
       agent_space_resource_type,
       agent_space_resource_id,
       channel_name,
       display_name,
       status,
       permissions_json,
       metadata_json,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, 'sheet', ?, ?, 'data_table', ?, ?, ?, 'active', '{"read":true}', '{}', ?, ?)`,
  ).run(
    `external-resource-binding-${suffix}`,
    workspaceId,
    `external-integration-${suffix}`,
    `sht_${suffix}`,
    `https://example.feishu.cn/sheets/sht_${suffix}`,
    `table-${suffix}`,
    `channel-${suffix}`,
    `Sheet ${suffix}`,
    now,
    now,
  );

  db.prepare(
    `INSERT INTO external_message_mapping (
       id,
       workspace_id,
       integration_id,
       channel_binding_id,
       direction,
       external_message_id,
       external_thread_id,
       external_sender_id,
       external_event_id,
       agent_space_message_id,
       metadata_json,
       created_at
     ) VALUES (?, ?, ?, ?, 'inbound', ?, ?, ?, ?, ?, '{}', ?)`,
  ).run(
    `external-message-mapping-${suffix}`,
    workspaceId,
    `external-integration-${suffix}`,
    `external-channel-binding-${suffix}`,
    `om_${suffix}`,
    `om_root_${suffix}`,
    `ou_${suffix}`,
    `evt_mapping_${suffix}`,
    `message-${suffix}`,
    now,
  );

  db.prepare(
    `INSERT INTO external_message_outbox (
       id,
       workspace_id,
       integration_id,
       channel_binding_id,
       target_external_chat_id,
       payload_json,
       status,
       attempts,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, '{"msg_type":"text"}', 'pending', 0, ?, ?)`,
  ).run(
    `external-message-outbox-${suffix}`,
    workspaceId,
    `external-integration-${suffix}`,
    `external-channel-binding-${suffix}`,
    `oc_${suffix}`,
    now,
    now,
  );

  db.prepare(
    `INSERT INTO external_data_operation_run (
       id,
       workspace_id,
       integration_id,
       resource_binding_id,
       operation_type,
       provider_resource_type,
       provider_resource_token,
       actor_type,
       actor_id,
       status,
       request_json,
       result_json,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, 'sheets.update_range', 'sheet', ?, 'agent', ?, 'pending', '{"payloadHash":"sha256:test"}', '{}', ?, ?)`,
  ).run(
    `external-data-operation-${suffix}`,
    workspaceId,
    `external-integration-${suffix}`,
    `external-resource-binding-${suffix}`,
    `sht_${suffix}`,
    `employee-${suffix}`,
    now,
    now,
  );

  db.prepare(
    `INSERT INTO external_integration_event (
       id,
       workspace_id,
       integration_id,
       provider,
       external_event_id,
       event_type,
       status,
       payload_json,
       received_at
     ) VALUES (?, ?, ?, 'feishu', ?, 'im.message.receive_v1', 'received', '{}', ?)`,
  ).run(
    `external-integration-event-${suffix}`,
    workspaceId,
    `external-integration-${suffix}`,
    `evt_${suffix}`,
    now,
  );

  db.prepare(
    `INSERT INTO workspace_employee (workspace_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run(workspaceId, `employee-${suffix}`, now, now);

  db.prepare(
    `INSERT INTO workspace_task (id, workspace_id, title, channel_name, assignee, priority, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'normal', 'todo', ?, ?)`,
  ).run(`workspace-task-${suffix}`, workspaceId, `Task ${suffix}`, `channel-${suffix}`, `employee-${suffix}`, now, now);

  db.prepare(
    `INSERT INTO daemon_connection (id, workspace_id, daemon_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(`daemon-${suffix}`, workspaceId, `daemon-key-${suffix}`, now, now);

  db.prepare(
    `INSERT INTO daemon_api_token (id, workspace_id, label, token_hash, created_by, created_at)
     VALUES (?, ?, ?, ?, 'system', ?)`,
  ).run(`token-${suffix}`, workspaceId, `Daemon ${suffix}`, `daemon-token-hash-${suffix}`, now);

  db.prepare(
    `INSERT INTO agent_runtime (id, workspace_id, daemon_connection_id, provider, name, created_at, updated_at)
     VALUES (?, ?, ?, 'codex', ?, ?, ?)`,
  ).run(`runtime-${suffix}`, workspaceId, `daemon-${suffix}`, `Runtime ${suffix}`, now, now);

  db.prepare(
    `INSERT INTO workspace_runtime_display_name (workspace_id, runtime_id, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(workspaceId, `runtime-${suffix}`, `Display ${suffix}`, now, now);

  db.prepare(
    `INSERT INTO employee_runtime_binding (workspace_id, employee_name, runtime_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(workspaceId, `employee-${suffix}`, `runtime-${suffix}`, now, now);

  db.prepare(
    `INSERT INTO agent_task_queue (
      id,
      workspace_id,
      agent_id,
      runtime_id,
      router_session_id,
      status,
      input_json,
      queued_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, 'queued', '{}', ?, ?, ?)`,
  ).run(`queue-${suffix}`, workspaceId, `agent:${suffix}`, `runtime-${suffix}`, `router-session-${suffix}`, now, now, now);

  db.prepare(
    `INSERT INTO external_thread_binding (
       id,
       workspace_id,
       integration_id,
       channel_binding_id,
       provider,
       tenant_key,
       external_chat_id,
       external_thread_id,
       channel_name,
       agent_id,
       task_queue_id,
       agent_space_message_id,
       status,
       metadata_json,
       last_message_at,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, 'feishu', '', ?, ?, ?, ?, ?, ?, 'active', '{}', ?, ?, ?)`,
  ).run(
    `external-thread-binding-${suffix}`,
    workspaceId,
    `external-integration-${suffix}`,
    `external-channel-binding-${suffix}`,
    `oc_${suffix}`,
    `om_root_${suffix}`,
    `channel-${suffix}`,
    `agent:${suffix}`,
    `queue-${suffix}`,
    `message-${suffix}`,
    now,
    now,
    now,
  );

  db.prepare(
    `INSERT INTO agent_router_session (
      id,
      workspace_id,
      agent_id,
      conversation_key,
      source_type,
      status,
      title,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, 'task', 'active', ?, ?, ?)`,
  ).run(`router-session-${suffix}`, workspaceId, `agent:${suffix}`, `task:queue-${suffix}`, `Router ${suffix}`, now, now);

  db.prepare(
    `INSERT INTO agent_router_provider_session (
      id,
      workspace_id,
      router_session_id,
      runtime_id,
      provider,
      provider_session_id,
      status,
      last_used_at,
      metadata_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, 'codex', ?, 'active', ?, '{}', ?, ?)`,
  ).run(`provider-session-${suffix}`, workspaceId, `router-session-${suffix}`, `runtime-${suffix}`, `native-session-${suffix}`, now, now, now);

  db.prepare(
    `INSERT INTO agent_task_attempt (
      id,
      workspace_id,
      task_queue_id,
      router_session_id,
      runtime_id,
      provider,
      provider_session_id,
      status,
      metadata_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, 'codex', ?, 'claimed', '{}', ?, ?)`,
  ).run(`attempt-${suffix}`, workspaceId, `queue-${suffix}`, `router-session-${suffix}`, `runtime-${suffix}`, `native-session-${suffix}`, now, now);

  db.prepare(
    `INSERT INTO agent_router_event (
      id,
      workspace_id,
      router_session_id,
      task_queue_id,
      attempt_id,
      type,
      actor_type,
      runtime_id,
      provider,
      summary,
      data_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, 'runtime_selected', 'system', ?, 'codex', ?, '{}', ?)`,
  ).run(`router-event-${suffix}`, workspaceId, `router-session-${suffix}`, `queue-${suffix}`, `attempt-${suffix}`, `runtime-${suffix}`, `Event ${suffix}`, now);

  db.prepare(
    `INSERT INTO agent_router_context_snapshot (
      id,
      workspace_id,
      router_session_id,
      task_queue_id,
      snapshot_type,
      content_markdown,
      source_event_ids_json,
      created_at
    ) VALUES (?, ?, ?, ?, 'context', ?, '[]', ?)`,
  ).run(`router-snapshot-${suffix}`, workspaceId, `router-session-${suffix}`, `queue-${suffix}`, `# Snapshot ${suffix}`, now);

  db.prepare(
    `INSERT INTO task_message (id, task_id, seq, type, content, created_at)
     VALUES (?, ?, 1, 'text', ?, ?)`,
  ).run(`message-${suffix}`, `queue-${suffix}`, `Task message ${suffix}`, now);

  db.prepare(
    `INSERT INTO token_usage (
      id,
      workspace_id,
      task_queue_id,
      agent_id,
      model_id,
      input_tokens,
      output_tokens,
      cost_usd,
      created_at
    ) VALUES (?, ?, ?, ?, 'gpt-5', 10, 5, 0.12, ?)`,
  ).run(`usage-${suffix}`, workspaceId, `queue-${suffix}`, `agent:${suffix}`, now);

  db.prepare(
    `INSERT INTO skill (id, workspace_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(`skill-${suffix}`, workspaceId, `skill-${suffix}`, now, now);

  db.prepare(
    `INSERT INTO skill_file (id, skill_id, path, content, created_at, updated_at)
     VALUES (?, ?, 'SKILL.md', ?, ?, ?)`,
  ).run(`skill-file-${suffix}`, `skill-${suffix}`, `skill body ${suffix}`, now, now);

  db.prepare(
    `INSERT INTO agent_skill (workspace_id, agent_id, employee_name, skill_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(workspaceId, `agent:${suffix}`, `employee-${suffix}`, `skill-${suffix}`, now);

  db.prepare(
    `INSERT INTO knowledge_page_assignment_policy (workspace_id, knowledge_page_id, assignment_mode, updated_at, updated_by)
     VALUES (?, ?, 'selected_agents', ?, 'system')`,
  ).run(workspaceId, `knowledge-${suffix}`, now);

  db.prepare(
    `INSERT INTO agent_knowledge_page (workspace_id, agent_id, employee_name, knowledge_page_id, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, 'system')`,
  ).run(workspaceId, `agent:${suffix}`, `employee-${suffix}`, `knowledge-${suffix}`, now);

  db.prepare(
    `INSERT INTO skill_import_event (id, workspace_id, skill_id, skill_name, source_type, imported_at)
     VALUES (?, ?, ?, ?, 'manual', ?)`,
  ).run(`skill-import-${suffix}`, workspaceId, `skill-${suffix}`, `skill-${suffix}`, now);

  db.prepare(
    `INSERT INTO budget (
      id,
      workspace_id,
      scope,
      scope_id,
      limit_usd,
      period,
      action,
      warning_threshold,
      enabled,
      created_by,
      created_at,
      updated_at
    ) VALUES (?, ?, 'workspace', ?, 25, 'monthly', 'warn', 0.8, 1, 'system', ?, ?)`,
  ).run(`budget-${suffix}`, workspaceId, workspaceId, now, now);
}

function countWhere(db: ReturnType<typeof getDatabase>, tableName: string, columnName: string, value: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE ${columnName} = ?`).get(value) as { count: number }
  ).count;
}

test.after(() => {
  process.chdir(originalCwd);
});
