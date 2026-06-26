import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { before, beforeEach } from "node:test";
import {
  cancelExternalMessageOutboxForIntegrationSync,
  createExternalDataOperationRunSync,
  createExternalIntegrationSync,
  createExternalMessageMappingSync,
  createExternalMessageOutboxSync,
  createStoredChannelSync,
  createUserSync,
  createWorkspaceSync,
  failExternalMessageOutboxSync,
  getDatabase,
  listExternalChannelBindingsSync,
  listExternalDataOperationRunsSync,
  listExternalIntegrationEventsSync,
  listExternalIntegrationsSync,
  listExternalMessageMappingsSync,
  listExternalMessageOutboxSync,
  listExternalResourceBindingsSync,
  listExternalUserBindingsSync,
  markExternalMessageOutboxLockedSync,
  readExternalChannelBindingByExternalChatSync,
  readExternalChannelBindingByProviderChatSync,
  readExternalDataOperationRunSync,
  readExternalIntegrationByAgentSync,
  readExternalMessageMappingByExternalMessageSync,
  readExternalResourceBindingByKeySync,
  readExternalUserBindingByExternalUserSync,
  recordExternalIntegrationEventSync,
  updateExternalDataOperationRunStatusSync,
  updateExternalIntegrationCredentialsSync,
  updateExternalIntegrationEventStatusSync,
  updateExternalIntegrationStatusSync,
  upsertExternalChannelBindingSync,
  upsertExternalResourceBindingSync,
  upsertExternalUserBindingSync,
} from "./index.ts";

const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-db-integrations-"));
const runIntegrationDbTests = process.env.AGENT_SPACE_DB_INTEGRATIONS_TESTS === "1";

before(() => {
  writeFileSync(join(tempRoot, "Target.md"), "# test\n");
  mkdirSync(join(tempRoot, "data"), { recursive: true });
  process.chdir(tempRoot);
});

beforeEach(() => {
  getDatabase().exec(`
    DELETE FROM external_data_operation_run;
    DELETE FROM external_message_outbox;
    DELETE FROM external_message_mapping;
    DELETE FROM external_resource_binding;
    DELETE FROM external_channel_binding;
    DELETE FROM external_user_binding;
    DELETE FROM external_integration_event;
    DELETE FROM external_integration;
    DELETE FROM workspace;
  `);
});

test("external integration list records keep encrypted credentials but do not contain raw app secrets", {
  skip: runIntegrationDbTests
    ? false
    : "Set AGENT_SPACE_DB_INTEGRATIONS_TESTS=1 with AGENT_SPACE_TEST_DATABASE_URL to run external integration DB tests.",
}, () => {
  const workspace = createWorkspaceSync({
    slug: "integrations-secret-list",
    name: "Integrations Secret List",
    createdBy: "system",
  });
  createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: "feishu",
    displayName: "Feishu Secret List",
    transportMode: "http_webhook",
    appId: "cli_test",
    encryptedCredentialsJson: {
      ciphertext: "encrypted-value",
      algorithm: "test-aes",
    },
    scopesJson: ["im:message", "docx:document"],
  });

  const integrations = listExternalIntegrationsSync({
    workspaceId: workspace.id,
    provider: "feishu",
  });

  assert.equal(integrations.length, 1);
  assert.equal(integrations[0]?.appId, "cli_test");
  assert.deepEqual(JSON.parse(integrations[0]?.encryptedCredentialsJson ?? "{}"), {
    ciphertext: "encrypted-value",
    algorithm: "test-aes",
  });
  assert.doesNotMatch(JSON.stringify(integrations), /app-secret-plain/);
});

test("external integrations are unique by workspace provider tenant and app", {
  skip: runIntegrationDbTests
    ? false
    : "Set AGENT_SPACE_DB_INTEGRATIONS_TESTS=1 with AGENT_SPACE_TEST_DATABASE_URL to run external integration DB tests.",
}, () => {
  const workspace = createWorkspaceSync({
    slug: "integrations-app-tenant",
    name: "Integrations App Tenant",
    createdBy: "system",
  });
  createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: "feishu",
    displayName: "Feishu One",
    transportMode: "http_webhook",
    appId: "cli_same",
    tenantKey: "tenant-1",
  });

  assert.throws(() => createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: "feishu",
    displayName: "Feishu Duplicate",
    transportMode: "websocket_worker",
    appId: " cli_same ",
    tenantKey: " tenant-1 ",
  }), /External integration app and tenant are already connected/);

  const differentTenant = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: "feishu",
    displayName: "Feishu Other Tenant",
    transportMode: "http_webhook",
    appId: "cli_same",
    tenantKey: "tenant-2",
  });
  const emptyTenant = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: "feishu",
    displayName: "Feishu Empty Tenant",
    transportMode: "http_webhook",
    appId: "cli_empty_tenant",
  });
  const rotating = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: "feishu",
    displayName: "Feishu Rotating",
    transportMode: "http_webhook",
    appId: "cli_rotating",
    tenantKey: "tenant-rotating",
  });

  assert.throws(() => updateExternalIntegrationCredentialsSync({
    workspaceId: workspace.id,
    integrationId: rotating.id,
    appId: "cli_same",
    tenantKey: "tenant-2",
    encryptedCredentialsJson: {},
  }), /External integration app and tenant are already connected/);

  assert.throws(() => updateExternalIntegrationCredentialsSync({
    workspaceId: workspace.id,
    integrationId: rotating.id,
    appId: " cli_empty_tenant ",
    tenantKey: "",
    encryptedCredentialsJson: {},
  }), /External integration app and tenant are already connected/);

  const updated = updateExternalIntegrationCredentialsSync({
    workspaceId: workspace.id,
    integrationId: rotating.id,
    appId: " cli_unique_rotated ",
    tenantKey: "",
    encryptedCredentialsJson: {},
  });
  assert.equal(updated.appId, "cli_unique_rotated");
  assert.equal(updated.tenantKey, undefined);
  assert.equal(differentTenant.tenantKey, "tenant-2");
  assert.equal(emptyTenant.tenantKey, undefined);
});

test("external integrations can be scoped to agent bot bindings", {
  skip: runIntegrationDbTests
    ? false
    : "Set AGENT_SPACE_DB_INTEGRATIONS_TESTS=1 with AGENT_SPACE_TEST_DATABASE_URL to run external integration DB tests.",
}, () => {
  const workspace = createWorkspaceSync({
    slug: "integrations-agent-bots",
    name: "Integrations Agent Bots",
    createdBy: "system",
  });
  const codexBot = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: "feishu",
    displayName: "Codex Feishu Bot",
    transportMode: "websocket_worker",
    agentId: " Codex ",
    appId: "codex_bot_app",
  });
  const workspaceLevel = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: "feishu",
    displayName: "Workspace Feishu",
    transportMode: "http_webhook",
    appId: "workspace_app",
  });

  assert.equal(codexBot.agentId, "Codex");
  assert.equal(readExternalIntegrationByAgentSync({
    workspaceId: workspace.id,
    provider: "feishu",
    agentId: "Codex",
  })?.id, codexBot.id);
  assert.deepEqual(listExternalIntegrationsSync({
    workspaceId: workspace.id,
    provider: "feishu",
    scope: "agent",
  }).map((integration) => integration.id), [codexBot.id]);
  assert.deepEqual(listExternalIntegrationsSync({
    workspaceId: workspace.id,
    provider: "feishu",
    scope: "workspace",
  }).map((integration) => integration.id), [workspaceLevel.id]);
  assert.throws(() => createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: "feishu",
    displayName: "Codex Feishu Bot Duplicate",
    transportMode: "websocket_worker",
    agentId: "Codex",
    appId: "codex_bot_app_2",
  }), /External integration agent is already connected/);

  updateExternalIntegrationStatusSync({
    workspaceId: workspace.id,
    integrationId: codexBot.id,
    status: "disabled",
  });
  const replacement = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: "feishu",
    displayName: "Codex Feishu Bot Replacement",
    transportMode: "websocket_worker",
    agentId: "Codex",
    appId: "codex_bot_app_3",
  });
  assert.equal(replacement.agentId, "Codex");
});

test("external user bindings are unique by AgentSpace user and Feishu user", {
  skip: runIntegrationDbTests
    ? false
    : "Set AGENT_SPACE_DB_INTEGRATIONS_TESTS=1 with AGENT_SPACE_TEST_DATABASE_URL to run external integration DB tests.",
}, () => {
  const { workspace, integration, user } = seedIntegrationWorkspace("users");
  const first = upsertExternalUserBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    userId: user.id,
    externalUserId: "ou_first",
    externalUnionId: "on_first",
    displayName: "Mina",
  });
  const updated = upsertExternalUserBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    userId: user.id,
    externalUserId: "ou_second",
    externalUnionId: "on_second",
    displayName: "Mina Updated",
  });

  assert.equal(updated.id, first.id);
  assert.equal(updated.externalUserId, "ou_second");
  assert.equal(updated.displayName, "Mina Updated");
  assert.equal(listExternalUserBindingsSync({ workspaceId: workspace.id, integrationId: integration.id }).length, 1);
  assert.equal(readExternalUserBindingByExternalUserSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    externalUserId: "ou_first",
  }), null);
  assert.equal(readExternalUserBindingByExternalUserSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    externalUserId: "ou_second",
  })?.id, first.id);

  const otherUser = createUserSync({
    displayName: "Other User",
    primaryEmail: "other-users@example.com",
  });
  assert.throws(() => upsertExternalUserBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    userId: otherUser.id,
    externalUserId: "ou_second",
  }));
});

test("external channel bindings are unique by AgentSpace channel and Feishu chat", {
  skip: runIntegrationDbTests
    ? false
    : "Set AGENT_SPACE_DB_INTEGRATIONS_TESTS=1 with AGENT_SPACE_TEST_DATABASE_URL to run external integration DB tests.",
}, () => {
  const { workspace, integration } = seedIntegrationWorkspace("channels");
  createStoredChannelSync({
    name: "general",
    kind: "group",
    humanMembers: 0,
    humanMemberNames: [],
    employeeNames: [],
  }, workspace.id);
  createStoredChannelSync({
    name: "ops",
    kind: "group",
    humanMembers: 0,
    humanMemberNames: [],
    employeeNames: [],
  }, workspace.id);

  const first = upsertExternalChannelBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    channelName: "general",
    externalChatId: "oc_first",
    externalChatType: "group",
    externalChatName: "General",
  });
  const updated = upsertExternalChannelBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    channelName: "general",
    externalChatId: "oc_second",
    externalChatType: "group",
    externalChatName: "General Updated",
  });

  assert.equal(updated.id, first.id);
  assert.equal(updated.externalChatId, "oc_second");
  assert.equal(updated.externalChatName, "General Updated");
  assert.equal(listExternalChannelBindingsSync({ workspaceId: workspace.id, integrationId: integration.id }).length, 1);
  assert.equal(readExternalChannelBindingByExternalChatSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    externalChatId: "oc_second",
  })?.id, first.id);

  assert.throws(() => upsertExternalChannelBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    channelName: "ops",
    externalChatId: "oc_second",
  }));
});

test("external channel bindings can be resolved by provider tenant and chat across integrations", {
  skip: runIntegrationDbTests
    ? false
    : "Set AGENT_SPACE_DB_INTEGRATIONS_TESTS=1 with AGENT_SPACE_TEST_DATABASE_URL to run external integration DB tests.",
}, () => {
  const { workspace, integration } = seedIntegrationWorkspace("provider-chat");
  const secondIntegration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: "feishu",
    displayName: "Hermes Feishu Bot",
    transportMode: "websocket_worker",
    agentId: "Hermes",
    appId: "cli_provider_chat_hermes",
  });
  const otherTenantIntegration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: "feishu",
    displayName: "Other Tenant Bot",
    transportMode: "websocket_worker",
    agentId: "OtherTenant",
    appId: "cli_provider_chat_other",
    tenantKey: "tenant-other",
  });
  createStoredChannelSync({
    name: "general",
    kind: "group",
    humanMembers: 0,
    humanMemberNames: [],
    employeeNames: [],
  }, workspace.id);
  createStoredChannelSync({
    name: "other",
    kind: "group",
    humanMembers: 0,
    humanMemberNames: [],
    employeeNames: [],
  }, workspace.id);

  const binding = upsertExternalChannelBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    channelName: "general",
    externalChatId: "oc_shared",
    externalChatType: "group",
    externalChatName: "Shared Chat",
  });
  upsertExternalChannelBindingSync({
    workspaceId: workspace.id,
    integrationId: otherTenantIntegration.id,
    channelName: "other",
    externalChatId: "oc_shared",
    externalChatType: "group",
    externalChatName: "Other Tenant Shared Chat",
  });

  assert.equal(readExternalChannelBindingByProviderChatSync({
    workspaceId: workspace.id,
    provider: "feishu",
    externalChatId: "oc_shared",
  })?.id, binding.id);
  assert.equal(readExternalChannelBindingByProviderChatSync({
    workspaceId: workspace.id,
    provider: "feishu",
    externalChatId: "oc_shared",
    tenantKey: "tenant-other",
  })?.integrationId, otherTenantIntegration.id);
  assert.equal(readExternalChannelBindingByProviderChatSync({
    workspaceId: workspace.id,
    provider: "feishu",
    externalChatId: "oc_missing",
  }), null);
  assert.equal(secondIntegration.agentId, "Hermes");
});

test("external resource bindings are unique by provider resource key", {
  skip: runIntegrationDbTests
    ? false
    : "Set AGENT_SPACE_DB_INTEGRATIONS_TESTS=1 with AGENT_SPACE_TEST_DATABASE_URL to run external integration DB tests.",
}, () => {
  const { workspace, integration } = seedIntegrationWorkspace("resources");
  const first = upsertExternalResourceBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    providerResourceType: "sheet",
    providerResourceToken: "shtcnTest",
    providerResourceUrl: "https://example.feishu.cn/sheets/shtcnTest",
    agentSpaceResourceType: "data_table",
    agentSpaceResourceId: "table-1",
    displayName: "Launch Sheet",
    permissionsJson: { read: true },
  });
  const updated = upsertExternalResourceBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    providerResourceType: "sheet",
    providerResourceToken: "shtcnTest",
    providerResourceUrl: "https://example.feishu.cn/sheets/shtcnTest",
    agentSpaceResourceType: "data_table",
    agentSpaceResourceId: "table-2",
    displayName: "Launch Sheet Updated",
    permissionsJson: { read: true, write: true },
  });

  assert.equal(updated.id, first.id);
  assert.equal(updated.agentSpaceResourceId, "table-2");
  assert.equal(updated.displayName, "Launch Sheet Updated");
  assert.deepEqual(JSON.parse(updated.permissionsJson), { read: true, write: true });
  assert.equal(listExternalResourceBindingsSync({ workspaceId: workspace.id, integrationId: integration.id }).length, 1);
  assert.equal(readExternalResourceBindingByKeySync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    providerResourceType: "sheet",
    providerResourceToken: "shtcnTest",
  })?.id, first.id);
});

test("external message mappings are idempotent by external message id", {
  skip: runIntegrationDbTests
    ? false
    : "Set AGENT_SPACE_DB_INTEGRATIONS_TESTS=1 with AGENT_SPACE_TEST_DATABASE_URL to run external integration DB tests.",
}, () => {
  const { workspace, integration } = seedIntegrationWorkspace("mappings");
  const first = createExternalMessageMappingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    direction: "inbound",
    externalMessageId: "om_1",
    externalThreadId: "om_root",
    externalSenderId: "ou_mina",
    externalEventId: "evt_1",
    metadataJson: { dispatchStatus: "dispatching" },
  });
  const updated = createExternalMessageMappingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    direction: "inbound",
    externalMessageId: "om_1",
    agentSpaceMessageId: "message-1",
    metadataJson: { dispatchStatus: "sent" },
  });

  assert.equal(updated.id, first.id);
  assert.equal(updated.externalThreadId, "om_root");
  assert.equal(updated.externalSenderId, "ou_mina");
  assert.equal(updated.agentSpaceMessageId, "message-1");
  assert.deepEqual(JSON.parse(updated.metadataJson), { dispatchStatus: "sent" });
  assert.equal(readExternalMessageMappingByExternalMessageSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    externalMessageId: "om_1",
  })?.id, first.id);
  const outbound = createExternalMessageMappingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    direction: "outbound",
    externalMessageId: "om_reply_1",
    externalThreadId: "om_1",
    agentSpaceMessageId: "message-reply-1",
    metadataJson: { dispatchStatus: "sent" },
  });
  const mappings = listExternalMessageMappingsSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    limit: 10,
  });
  assert.deepEqual(mappings.map((mapping) => mapping.id), [outbound.id, first.id]);
  assert.deepEqual(listExternalMessageMappingsSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    direction: "outbound",
  }).map((mapping) => mapping.id), [outbound.id]);
});

test("external data operation runs preserve payload hashes through status transitions", {
  skip: runIntegrationDbTests
    ? false
    : "Set AGENT_SPACE_DB_INTEGRATIONS_TESTS=1 with AGENT_SPACE_TEST_DATABASE_URL to run external integration DB tests.",
}, () => {
  const { workspace, integration } = seedIntegrationWorkspace("data-runs");
  const run = createExternalDataOperationRunSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    operationType: "sheets.update_range",
    providerResourceType: "sheet",
    providerResourceToken: "shtcnTest",
    actorType: "agent",
    actorId: "Atlas",
    status: "pending",
    requestJson: {
      payloadHash: "sha256:test-payload",
      policyDecision: "require_approval",
      contentPreview: "Sheet1!A1:B2",
    },
  });

  const running = updateExternalDataOperationRunStatusSync({
    workspaceId: workspace.id,
    runId: run.id,
    status: "running",
  });
  assert.equal(running.status, "running");
  assert.ok(running.startedAt);

  const succeeded = updateExternalDataOperationRunStatusSync({
    workspaceId: workspace.id,
    runId: run.id,
    status: "succeeded",
    resultJson: {
      revision: "rev-1",
      rowCount: 2,
    },
  });
  assert.equal(succeeded.status, "succeeded");
  assert.ok(succeeded.finishedAt);
  assert.deepEqual(JSON.parse(succeeded.resultJson), {
    revision: "rev-1",
    rowCount: 2,
  });

  const stored = readExternalDataOperationRunSync({
    workspaceId: workspace.id,
    runId: run.id,
  });
  assert.ok(stored);
  assert.deepEqual(JSON.parse(stored.requestJson), {
    payloadHash: "sha256:test-payload",
    policyDecision: "require_approval",
    contentPreview: "Sheet1!A1:B2",
  });
  assert.deepEqual(
    listExternalDataOperationRunsSync({
      workspaceId: workspace.id,
      integrationId: integration.id,
      status: "succeeded",
    }).map((item) => item.id),
    [run.id],
  );
});

test("listExternalMessageOutboxSync filters by integration and status", {
  skip: runIntegrationDbTests
    ? false
    : "Set AGENT_SPACE_DB_INTEGRATIONS_TESTS=1 with AGENT_SPACE_TEST_DATABASE_URL to run external integration DB tests.",
}, () => {
  const workspace = createWorkspaceSync({
    slug: "integrations-outbox",
    name: "Integrations Outbox",
    createdBy: "system",
  });
  const feishu = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: "feishu",
    displayName: "Feishu",
    transportMode: "http_webhook",
  });
  const slack = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: "slack",
    displayName: "Slack",
    transportMode: "http_webhook",
  });
  const retrying = createExternalMessageOutboxSync({
    workspaceId: workspace.id,
    integrationId: feishu.id,
    targetExternalChatId: "oc_general",
    payloadJson: { msg_type: "text" },
  });
  const failed = createExternalMessageOutboxSync({
    workspaceId: workspace.id,
    integrationId: feishu.id,
    targetExternalChatId: "oc_general",
    payloadJson: { msg_type: "text" },
  });
  const other = createExternalMessageOutboxSync({
    workspaceId: workspace.id,
    integrationId: slack.id,
    targetExternalChatId: "C123",
    payloadJson: { text: "hello" },
  });

  failExternalMessageOutboxSync({
    workspaceId: workspace.id,
    outboxId: retrying.id,
    lastError: "feishu.outbound.network_unreachable: fetch failed",
    nextAttemptAt: "2026-06-24T00:01:00.000Z",
  });
  failExternalMessageOutboxSync({
    workspaceId: workspace.id,
    outboxId: failed.id,
    lastError: "feishu.outbound.permission_denied: missing scope",
    terminal: true,
  });
  failExternalMessageOutboxSync({
    workspaceId: workspace.id,
    outboxId: other.id,
    lastError: "slack.outbound.failed",
    terminal: true,
  });

  const feishuItems = listExternalMessageOutboxSync({
    workspaceId: workspace.id,
    integrationId: feishu.id,
  });
  assert.deepEqual(new Set(feishuItems.map((item) => item.id)), new Set([retrying.id, failed.id]));

  const pending = listExternalMessageOutboxSync({
    workspaceId: workspace.id,
    integrationId: feishu.id,
    status: "pending",
  });
  assert.deepEqual(pending.map((item) => item.id), [retrying.id]);
  assert.equal(pending[0]?.lastError, "feishu.outbound.network_unreachable: fetch failed");
  assert.equal(pending[0]?.nextAttemptAt, "2026-06-24T00:01:00.000Z");

  const failedItems = listExternalMessageOutboxSync({
    workspaceId: workspace.id,
    integrationId: feishu.id,
    status: "failed",
  });
  assert.deepEqual(failedItems.map((item) => item.id), [failed.id]);
  assert.equal(failedItems[0]?.lastError, "feishu.outbound.permission_denied: missing scope");
});

test("cancelExternalMessageOutboxForIntegrationSync cancels pending and locked items", {
  skip: runIntegrationDbTests
    ? false
    : "Set AGENT_SPACE_DB_INTEGRATIONS_TESTS=1 with AGENT_SPACE_TEST_DATABASE_URL to run external integration DB tests.",
}, () => {
  const workspace = createWorkspaceSync({
    slug: "integrations-outbox-cancel",
    name: "Integrations Outbox Cancel",
    createdBy: "system",
  });
  const feishu = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: "feishu",
    displayName: "Feishu",
    transportMode: "http_webhook",
  });
  const slack = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: "slack",
    displayName: "Slack",
    transportMode: "http_webhook",
  });
  const pending = createExternalMessageOutboxSync({
    workspaceId: workspace.id,
    integrationId: feishu.id,
    targetExternalChatId: "oc_general",
    payloadJson: { msg_type: "text" },
    nextAttemptAt: "2026-06-24T00:01:00.000Z",
  });
  const locked = createExternalMessageOutboxSync({
    workspaceId: workspace.id,
    integrationId: feishu.id,
    targetExternalChatId: "oc_general",
    payloadJson: { msg_type: "text" },
  });
  const failed = createExternalMessageOutboxSync({
    workspaceId: workspace.id,
    integrationId: feishu.id,
    targetExternalChatId: "oc_general",
    payloadJson: { msg_type: "text" },
  });
  const other = createExternalMessageOutboxSync({
    workspaceId: workspace.id,
    integrationId: slack.id,
    targetExternalChatId: "C123",
    payloadJson: { text: "hello" },
  });

  markExternalMessageOutboxLockedSync({
    workspaceId: workspace.id,
    outboxId: locked.id,
    lockedBy: "worker-1",
  });
  failExternalMessageOutboxSync({
    workspaceId: workspace.id,
    outboxId: failed.id,
    lastError: "feishu.outbound.permission_denied: missing scope",
    terminal: true,
  });

  const cancelledCount = cancelExternalMessageOutboxForIntegrationSync({
    workspaceId: workspace.id,
    integrationId: feishu.id,
    reason: "feishu.integration.deleted",
  });

  assert.equal(cancelledCount, 2);
  const feishuItems = listExternalMessageOutboxSync({
    workspaceId: workspace.id,
    integrationId: feishu.id,
  });
  const byId = new Map(feishuItems.map((item) => [item.id, item]));
  assert.equal(byId.get(pending.id)?.status, "cancelled");
  assert.equal(byId.get(pending.id)?.lastError, "feishu.integration.deleted");
  assert.equal(byId.get(pending.id)?.nextAttemptAt, undefined);
  assert.equal(byId.get(locked.id)?.status, "cancelled");
  assert.equal(byId.get(locked.id)?.lockedBy, undefined);
  assert.equal(byId.get(failed.id)?.status, "failed");

  const otherItems = listExternalMessageOutboxSync({
    workspaceId: workspace.id,
    integrationId: slack.id,
  });
  assert.deepEqual(otherItems.map((item) => item.id), [other.id]);
  assert.equal(otherItems[0]?.status, "pending");
});

test("listExternalIntegrationEventsSync filters recent webhook events", {
  skip: runIntegrationDbTests
    ? false
    : "Set AGENT_SPACE_DB_INTEGRATIONS_TESTS=1 with AGENT_SPACE_TEST_DATABASE_URL to run external integration DB tests.",
}, () => {
  const workspace = createWorkspaceSync({
    slug: "integrations-events",
    name: "Integrations Events",
    createdBy: "system",
  });
  const feishu = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: "feishu",
    displayName: "Feishu",
    transportMode: "http_webhook",
  });
  const slack = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: "slack",
    displayName: "Slack",
    transportMode: "http_webhook",
  });

  recordExternalIntegrationEventSync({
    workspaceId: workspace.id,
    integrationId: feishu.id,
    provider: "feishu",
    externalEventId: "evt-old",
    eventType: "im.message.receive_v1",
    receivedAt: "2026-06-24T00:00:00.000Z",
  });
  recordExternalIntegrationEventSync({
    workspaceId: workspace.id,
    integrationId: feishu.id,
    provider: "feishu",
    externalEventId: "evt-unbound",
    eventType: "im.message.receive_v1",
    receivedAt: "2026-06-24T00:02:00.000Z",
  });
  recordExternalIntegrationEventSync({
    workspaceId: workspace.id,
    integrationId: slack.id,
    provider: "slack",
    externalEventId: "evt-slack",
    eventType: "message",
    receivedAt: "2026-06-24T00:03:00.000Z",
  });
  updateExternalIntegrationEventStatusSync({
    workspaceId: workspace.id,
    provider: "feishu",
    externalEventId: "evt-unbound",
    status: "ignored",
    errorMessage: "external_user_unbound",
  });

  const recentFeishu = listExternalIntegrationEventsSync({
    workspaceId: workspace.id,
    provider: "feishu",
    integrationId: feishu.id,
    limit: 1,
  });
  assert.deepEqual(recentFeishu.map((event) => event.externalEventId), ["evt-unbound"]);
  assert.equal(recentFeishu[0]?.errorMessage, "external_user_unbound");

  const ignored = listExternalIntegrationEventsSync({
    workspaceId: workspace.id,
    provider: "feishu",
    integrationId: feishu.id,
    status: "ignored",
  });
  assert.deepEqual(ignored.map((event) => event.externalEventId), ["evt-unbound"]);
});

function seedIntegrationWorkspace(suffix: string) {
  const workspace = createWorkspaceSync({
    slug: `integrations-${suffix}`,
    name: `Integrations ${suffix}`,
    createdBy: "system",
  });
  const user = createUserSync({
    displayName: `User ${suffix}`,
    primaryEmail: `${suffix}@example.com`,
  });
  const integration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: "feishu",
    displayName: "Feishu",
    transportMode: "http_webhook",
    appId: `cli_${suffix.replace(/[^a-z0-9]/gi, "_")}`,
  });
  return {
    workspace,
    user,
    integration,
  };
}
