import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { before, beforeEach } from "node:test";
import {
  createExternalMessageMappingSync,
  createExternalIntegrationSync,
  createUserSync,
  createWorkspaceMembershipSync,
  DEFAULT_WORKSPACE_ID,
  createWorkspaceSync,
  getDatabase,
  listPendingExternalMessageOutboxSync,
  readExternalDataOperationRunSync,
  readExternalIntegrationEventSync,
  upsertExternalChannelBindingSync,
  upsertExternalResourceBindingSync,
  upsertExternalUserBindingSync,
} from "@agent-space/db";
import { FEISHU_PROVIDER_ID } from "../constants.ts";
import {
  executeFeishuDataOperationWithApproval,
  processFeishuCardActionCallback,
} from "../approval.ts";
import {
  executeApprovedFeishuDataOperation,
  executeBoundFeishuReadDataOperation,
  executeFeishuDataOperation,
  planBoundFeishuWriteDataOperation,
} from "../data-plane.ts";
import { buildFeishuDataOperationPayloadHash } from "../operation-plan.ts";
import type { ExternalDataOperationRequest } from "../../../core/index.ts";
import type { FeishuApiClient, FeishuApiRequest } from "../client.ts";
import {
  addChannelEmployeesSync,
  createChannelDocumentSync,
  createEmployeeSync,
  createExternalDataTableSync,
  initializeOrganizationSync,
  listApprovalsSync,
  resetWorkspaceStateSync,
} from "../../../../index.ts";

const originalCwd = process.cwd();
const repositoryRoot = existsSync(join(originalCwd, "Target.md")) ? originalCwd : join(originalCwd, "..", "..", "..", "..");
const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-feishu-data-plane-"));
const databaseTestOptions = process.env.AGENT_SPACE_FEISHU_DATA_PLANE_DB_TESTS === "1"
  ? {}
  : { skip: "Set AGENT_SPACE_FEISHU_DATA_PLANE_DB_TESTS=1 with a test Postgres URL to run Feishu data-plane DB integration tests." };

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
    DELETE FROM external_message_mapping;
    DELETE FROM external_message_outbox;
    DELETE FROM external_user_binding;
    DELETE FROM external_thread_binding;
    DELETE FROM external_channel_binding;
    DELETE FROM external_data_operation_run;
    DELETE FROM external_resource_binding;
    DELETE FROM external_integration;
    DELETE FROM workspace_membership;
    DELETE FROM users;
    DELETE FROM workspace;
  `);
});

function initializeGeneralChannelForDataPlaneTest(workspaceId: string): void {
  resetWorkspaceStateSync(workspaceId);
  initializeOrganizationSync({
    organizationName: "Northstar Labs",
    ownerName: "Mina",
    ownerRole: "Owner",
    firstChannelName: "general",
  }, workspaceId);
}

test("bound Feishu Doc reads create an operation run with a safe result summary", databaseTestOptions, async () => {
  const workspace = createWorkspaceSync({
    slug: "feishu-doc-read",
    name: "Feishu Doc Read",
    createdBy: "system",
  });
  initializeGeneralChannelForDataPlaneTest(workspace.id);
  createEmployeeSync({
    name: "Atlas",
    role: "Planner",
    remarkName: "Atlas",
    summary: "Trip planner",
    fit: "Ready",
    origin: "test",
  }, workspace.id);
  addChannelEmployeesSync({
    channelName: "general",
    employeeNames: ["Atlas"],
  }, workspace.id);
  const document = createChannelDocumentSync({
    channelName: "general",
    title: "Launch brief",
    createdBy: "Atlas",
    createdByType: "agent",
  }, workspace.id).document;
  const integration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: FEISHU_PROVIDER_ID,
    displayName: "Feishu",
    transportMode: "http_webhook",
    scopesJson: ["docx:document"],
  });
  const binding = upsertExternalResourceBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    providerResourceType: "doc",
    providerResourceToken: "doccnBound123",
    providerResourceUrl: "https://example.feishu.cn/docx/doccnBound123",
    agentSpaceResourceType: "channel_document",
    agentSpaceResourceId: document.id,
    channelName: "general",
    displayName: "Launch brief",
  });
  const requests: FeishuApiRequest[] = [];
  const client: FeishuApiClient = {
    async request<T>(request: FeishuApiRequest): Promise<T> {
      requests.push(request);
      return {
        code: 0,
        data: {
          items: [
            {
              block_id: "block-1",
              block_type: "text",
              text: {
                elements: [
                  { text: "confidential launch details" },
                ],
              },
            },
          ],
        },
      } as T;
    },
  };

  const executed = await executeBoundFeishuReadDataOperation({
    context: {
      workspaceId: workspace.id,
      integrationId: integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    client,
    request: {
      operationType: "docs.read_document",
      providerResourceType: "doc",
      providerResourceToken: "doccnBound123",
      actorType: "agent",
      actorId: "Atlas",
      parameters: { pageSize: 20 },
    },
  });

  assert.equal(executed.result.ok, true);
  assert.equal(executed.resourceBinding?.id, binding.id);
  assert.deepEqual(requests, [{
    method: "GET",
    path: "/open-apis/docx/v1/documents/doccnBound123/blocks",
    query: {
      page_size: 20,
      page_token: undefined,
    },
  }]);

  const run = readExternalDataOperationRunSync({
    workspaceId: workspace.id,
    runId: executed.runId,
  });
  assert.ok(run);
  assert.equal(run.status, "succeeded");
  assert.equal(run.resourceBindingId, binding.id);
  assert.equal(run.operationType, "docs.read_document");
  assert.equal(run.providerResourceType, "doc");
  assert.equal(run.providerResourceToken, "doccnBound123");
  assert.equal(run.actorType, "agent");
  assert.equal(run.actorId, "Atlas");

  const requestJson = JSON.parse(run.requestJson) as Record<string, unknown>;
  assert.deepEqual(requestJson.governanceContext, {
    provider: "feishu",
    agentId: "Atlas",
    botBindingId: integration.id,
    channelName: "general",
    actorType: "agent",
  });
  const resultJson = JSON.parse(run.resultJson) as Record<string, unknown>;
  assert.equal(resultJson.policyDecision, "allow");
  assert.equal(JSON.stringify(resultJson).includes("confidential launch details"), false);
  assert.equal(JSON.stringify(resultJson).includes("resultPreviewSummary"), true);
});

test("agent bot Feishu reads record bound user governance context", databaseTestOptions, async () => {
  const workspace = createWorkspaceSync({
    slug: "feishu-bound-user-doc-read",
    name: "Feishu Bound User Doc Read",
    createdBy: "system",
  });
  initializeGeneralChannelForDataPlaneTest(workspace.id);
  createEmployeeSync({
    name: "Atlas",
    role: "Planner",
    remarkName: "Atlas",
    summary: "Trip planner",
    fit: "Ready",
    origin: "test",
  }, workspace.id);
  addChannelEmployeesSync({
    channelName: "general",
    employeeNames: ["Atlas"],
  }, workspace.id);
  const document = createChannelDocumentSync({
    channelName: "general",
    title: "Bound user brief",
    createdBy: "Atlas",
    createdByType: "agent",
  }, workspace.id).document;
  const user = createUserSync({
    displayName: "Mina",
    primaryEmail: "mina-bound-user-doc-read@example.com",
  });
  createWorkspaceMembershipSync({
    workspaceId: workspace.id,
    userId: user.id,
    role: "admin",
  });
  const integration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: FEISHU_PROVIDER_ID,
    displayName: "Atlas Feishu Bot",
    transportMode: "websocket_worker",
    scopesJson: ["docx:document"],
  });
  const binding = upsertExternalResourceBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    providerResourceType: "doc",
    providerResourceToken: "doccnBoundUser123",
    providerResourceUrl: "https://example.feishu.cn/docx/doccnBoundUser123",
    agentSpaceResourceType: "channel_document",
    agentSpaceResourceId: document.id,
    channelName: "general",
    displayName: "Bound user brief",
  });
  const client: FeishuApiClient = {
    async request<T>(): Promise<T> {
      return {
        code: 0,
        data: {
          items: [],
        },
      } as T;
    },
  };

  const executed = await executeBoundFeishuReadDataOperation({
    context: {
      workspaceId: workspace.id,
      integrationId: integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    client,
    request: {
      operationType: "docs.read_document",
      providerResourceType: "doc",
      providerResourceToken: "doccnBoundUser123",
      actorType: "agent",
      actorId: "Atlas",
      parameters: {
        channelName: "general",
      },
    },
    actor: {
      actorType: "user",
      userId: user.id,
      displayName: "Mina",
      role: "admin",
    },
  });

  assert.equal(executed.result.ok, true);
  assert.equal(executed.resourceBinding?.id, binding.id);
  const run = readExternalDataOperationRunSync({
    workspaceId: workspace.id,
    runId: executed.runId,
  });
  assert.ok(run);
  assert.equal(run.actorType, "agent");
  assert.equal(run.actorId, "Atlas");
  const requestJson = JSON.parse(run.requestJson) as Record<string, unknown>;
  assert.deepEqual(requestJson.governanceContext, {
    provider: "feishu",
    agentId: "Atlas",
    botBindingId: integration.id,
    channelName: "general",
    actorType: "user",
    actorUserId: user.id,
  });
});

test("external guest Feishu reads require guest-readable current-channel resource bindings", databaseTestOptions, async () => {
  const workspace = createWorkspaceSync({
    slug: "feishu-guest-doc-read",
    name: "Feishu Guest Doc Read",
    createdBy: "system",
  });
  initializeGeneralChannelForDataPlaneTest(workspace.id);
  const integration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: FEISHU_PROVIDER_ID,
    displayName: "Feishu Atlas Bot",
    transportMode: "websocket_worker",
    scopesJson: ["docx:document"],
  });
  const binding = upsertExternalResourceBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    providerResourceType: "doc",
    providerResourceToken: "doccnGuest123",
    providerResourceUrl: "https://example.feishu.cn/docx/doccnGuest123",
    agentSpaceResourceType: "channel_document",
    agentSpaceResourceId: "channel-document-guest",
    channelName: "general",
    displayName: "Guest readable brief",
    permissionsJson: {
      externalGuestReadable: true,
    },
  });
  const requests: FeishuApiRequest[] = [];
  const client: FeishuApiClient = {
    async request<T>(request: FeishuApiRequest): Promise<T> {
      requests.push(request);
      return {
        code: 0,
        data: {
          items: [],
        },
      } as T;
    },
  };

  const executed = await executeBoundFeishuReadDataOperation({
    context: {
      workspaceId: workspace.id,
      integrationId: integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    client,
    request: {
      operationType: "docs.read_document",
      providerResourceType: "doc",
      providerResourceToken: "doccnGuest123",
      actorType: "agent",
      actorId: "Atlas",
      parameters: {
        channelName: "general",
      },
    },
    actor: {
      actorType: "external_guest",
      providerUserRefHash: "guest-ref-safe-123",
      permissionProfile: "channel_context_only",
      sourceChatId: "oc_raw_chat_should_not_persist",
      sourceChannelName: "general",
      agentId: "Atlas",
      botBindingId: integration.id,
    },
  });

  assert.equal(executed.result.ok, true);
  assert.equal(executed.resourceBinding?.id, binding.id);
  assert.equal(requests.length, 1);
  const run = readExternalDataOperationRunSync({
    workspaceId: workspace.id,
    runId: executed.runId,
  });
  assert.ok(run);
  assert.equal(run.actorType, "agent");
  assert.equal(run.actorId, "Atlas");
  const requestJson = JSON.parse(run.requestJson) as Record<string, unknown>;
  assert.deepEqual(requestJson.governanceContext, {
    provider: "feishu",
    agentId: "Atlas",
    botBindingId: integration.id,
    channelName: "general",
    actorType: "external_guest",
    externalActorReference: "guest-ref-safe-123",
    externalGuestPermissionProfile: "channel_context_only",
    externalChatReference: "ref_2762fdc95dd841bb",
  });
  assert.equal(JSON.stringify(requestJson).includes("oc_raw_chat_should_not_persist"), false);
});

test("external guest Feishu writes require identity before approval planning", databaseTestOptions, async () => {
  const workspace = createWorkspaceSync({
    slug: "feishu-guest-sheet-write",
    name: "Feishu Guest Sheet Write",
    createdBy: "system",
  });
  initializeGeneralChannelForDataPlaneTest(workspace.id);
  const integration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: FEISHU_PROVIDER_ID,
    displayName: "Feishu Atlas Bot",
    transportMode: "websocket_worker",
    scopesJson: ["sheets:spreadsheet"],
  });
  const table = createExternalDataTableSync({
    name: "Guest write sheet",
    channelName: "general",
    externalProvider: FEISHU_PROVIDER_ID,
    externalResourceType: "sheet",
    externalResourceToken: "shtcnGuestWrite123",
    externalUrl: "https://example.feishu.cn/sheets/shtcnGuestWrite123",
  }, workspace.id);
  const binding = upsertExternalResourceBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    providerResourceType: "sheet",
    providerResourceToken: "shtcnGuestWrite123",
    providerResourceUrl: "https://example.feishu.cn/sheets/shtcnGuestWrite123",
    agentSpaceResourceType: "data_table",
    agentSpaceResourceId: table.id,
    channelName: "general",
    displayName: "Guest write sheet",
    permissionsJson: {
      canWrite: true,
    },
  });
  const client: FeishuApiClient = {
    async request() {
      throw new Error("external guest writes should not call Feishu API or create approval execution");
    },
  };

  const planned = await planBoundFeishuWriteDataOperation({
    context: {
      workspaceId: workspace.id,
      integrationId: integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    client,
    request: {
      operationType: "sheets.update_range",
      providerResourceType: "sheet",
      providerResourceToken: "shtcnGuestWrite123",
      actorType: "agent",
      actorId: "Atlas",
      parameters: {
        range: "Plan!A1:B1",
        values: [["blocked"]],
        channelName: "general",
      },
    },
    actor: {
      actorType: "external_guest",
      providerUserRefHash: "guest-ref-write-123",
      permissionProfile: "channel_context_only",
      sourceChannelName: "general",
      agentId: "Atlas",
      botBindingId: integration.id,
    },
  });

  assert.equal(planned.result.ok, false);
  assert.equal(planned.result.errorCode, "feishu.data_operation_external_guest_requires_identity");
  assert.equal(planned.resourceBinding?.id, binding.id);
  assert.equal(planned.result.data?.requireIdentity, true);
  const run = readExternalDataOperationRunSync({
    workspaceId: workspace.id,
    runId: planned.runId,
  });
  assert.ok(run);
  assert.equal(run.status, "failed");
  assert.equal(run.resourceBindingId, binding.id);
  const requestJson = JSON.parse(run.requestJson) as Record<string, unknown>;
  assert.deepEqual(requestJson.governanceContext, {
    provider: "feishu",
    agentId: "Atlas",
    botBindingId: integration.id,
    channelName: "general",
    actorType: "external_guest",
    externalActorReference: "guest-ref-write-123",
    externalGuestPermissionProfile: "channel_context_only",
  });
  assert.equal(JSON.stringify(requestJson).includes("blocked"), false);
});

test("approved Feishu Sheet writes update a pending operation run with a safe result summary", databaseTestOptions, async () => {
  const workspace = createWorkspaceSync({
    slug: "feishu-sheet-write",
    name: "Feishu Sheet Write",
    createdBy: "system",
  });
  initializeGeneralChannelForDataPlaneTest(workspace.id);
  const integration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: FEISHU_PROVIDER_ID,
    displayName: "Feishu",
    transportMode: "http_webhook",
    scopesJson: ["sheets:spreadsheet"],
  });
  const table = createExternalDataTableSync({
    name: "Planning sheet",
    channelName: "general",
    externalProvider: FEISHU_PROVIDER_ID,
    externalResourceType: "sheet",
    externalResourceToken: "shtcnBound123",
    externalUrl: "https://example.feishu.cn/sheets/shtcnBound123",
  }, workspace.id);
  const binding = upsertExternalResourceBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    providerResourceType: "sheet",
    providerResourceToken: "shtcnBound123",
    providerResourceUrl: "https://example.feishu.cn/sheets/shtcnBound123",
    agentSpaceResourceType: "data_table",
    agentSpaceResourceId: table.id,
    channelName: "general",
    displayName: "Planning sheet",
    permissionsJson: {
      canWrite: true,
    },
  });
  const request: ExternalDataOperationRequest = {
    operationType: "sheets.update_range",
    providerResourceType: "sheet",
    providerResourceToken: "shtcnBound123",
    actorType: "agent",
    actorId: "Atlas",
    parameters: {
      range: "Plan!A1:B2",
      values: [
        ["secret customer", 42],
        ["Mina", "private note"],
      ],
    },
  };
  const payloadHash = buildFeishuDataOperationPayloadHash(request);
  const requests: FeishuApiRequest[] = [];
  const client: FeishuApiClient = {
    async request<T>(apiRequest: FeishuApiRequest): Promise<T> {
      requests.push(apiRequest);
      return {
        code: 0,
        data: {
          revision: 17,
          updatedRange: "Plan!A1:B2",
          updatedRows: 2,
          updatedColumns: 2,
          updatedCells: 4,
        },
      } as T;
    },
  };

  const pending = await executeFeishuDataOperation({
    context: {
      workspaceId: workspace.id,
      integrationId: integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    client,
    request,
    resourceBindingId: binding.id,
  });

  assert.equal(pending.result.ok, false);
  assert.equal(pending.result.errorCode, "feishu.data_operation_requires_approval");
  assert.deepEqual(requests, []);
  const pendingRun = readExternalDataOperationRunSync({
    workspaceId: workspace.id,
    runId: pending.runId,
  });
  assert.ok(pendingRun);
  assert.equal(pendingRun.status, "pending");
  assert.equal(pendingRun.resourceBindingId, binding.id);
  const pendingRequestJson = JSON.parse(pendingRun.requestJson) as Record<string, unknown>;
  assert.equal(pendingRequestJson.policyDecision, "require_approval");
  assert.equal(pendingRequestJson.payloadHash, payloadHash);
  assert.equal(JSON.stringify(pendingRequestJson).includes("secret customer"), false);

  const approved = await executeApprovedFeishuDataOperation({
    context: {
      workspaceId: workspace.id,
      integrationId: integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    client,
    runId: pending.runId,
    request,
    approvalId: "approval-sheet-1",
    approvedPayloadHash: payloadHash,
  });

  assert.equal(approved.result.ok, true, JSON.stringify(approved.result));
  assert.deepEqual(requests, [{
    method: "PUT",
    path: "/open-apis/sheets/v2/spreadsheets/shtcnBound123/values",
    body: {
      valueRange: {
        range: "Plan!A1:B2",
        values: [
          ["secret customer", 42],
          ["Mina", "private note"],
        ],
      },
    },
  }]);

  const completedRun = readExternalDataOperationRunSync({
    workspaceId: workspace.id,
    runId: pending.runId,
  });
  assert.ok(completedRun);
  assert.equal(completedRun.status, "succeeded");
  const resultJson = JSON.parse(completedRun.resultJson) as Record<string, unknown>;
  assert.equal(resultJson.policyDecision, "approved");
  assert.equal(resultJson.payloadHash, payloadHash);
  assert.equal(resultJson.approvalId, "approval-sheet-1");
  const responseSummary = resultJson.responseSummary as Record<string, unknown>;
  assert.equal(responseSummary.revision, 17);
  assert.equal(responseSummary.updatedRangeRedacted, true);
  assert.equal(responseSummary.updatedRows, 2);
  assert.equal(responseSummary.updatedColumns, 2);
  assert.equal(responseSummary.updatedCells, 4);
  assert.equal(JSON.stringify(resultJson).includes("secret customer"), false);
  assert.equal(JSON.stringify(resultJson).includes("private note"), false);
  assert.equal(JSON.stringify(resultJson).includes("Plan!A1:B2"), false);
});

test("approved Feishu Base mutations create and update records with safe result summaries", databaseTestOptions, async () => {
  const workspace = createWorkspaceSync({
    slug: "feishu-base-write",
    name: "Feishu Base Write",
    createdBy: "system",
  });
  initializeGeneralChannelForDataPlaneTest(workspace.id);
  const integration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: FEISHU_PROVIDER_ID,
    displayName: "Feishu",
    transportMode: "http_webhook",
    scopesJson: ["bitable:app"],
  });
  const table = createExternalDataTableSync({
    name: "Planning base table",
    channelName: "general",
    externalProvider: FEISHU_PROVIDER_ID,
    externalResourceType: "base_table",
    externalResourceToken: "tblBound123",
    externalUrl: "https://example.feishu.cn/base/appToken123?table=tblBound123",
    externalMetadata: {
      appToken: "appToken123",
      tableId: "tblBound123",
    },
  }, workspace.id);
  const binding = upsertExternalResourceBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    providerResourceType: "base_table",
    providerResourceToken: "tblBound123",
    providerResourceUrl: "https://example.feishu.cn/base/appToken123?table=tblBound123",
    agentSpaceResourceType: "data_table",
    agentSpaceResourceId: table.id,
    channelName: "general",
    displayName: "Planning base table",
    metadataJson: {
      appToken: "appToken123",
      tableId: "tblBound123",
    },
    permissionsJson: {
      canWrite: true,
    },
  });
  const createRequest: ExternalDataOperationRequest = {
    operationType: "base.mutate_records",
    providerResourceType: "base_table",
    providerResourceToken: "tblBound123",
    actorType: "agent",
    actorId: "Atlas",
    parameters: {
      appToken: "appToken123",
      fields: {
        Status: "secret ready",
        Amount: 42,
      },
    },
  };
  const updateRequest: ExternalDataOperationRequest = {
    operationType: "base.mutate_records",
    providerResourceType: "base_table",
    providerResourceToken: "tblBound123",
    actorType: "agent",
    actorId: "Atlas",
    parameters: {
      appToken: "appToken123",
      mutation: "update_record",
      recordId: "recCreated123",
      fields: {
        Status: "secret done",
      },
    },
  };
  const requests: FeishuApiRequest[] = [];
  const client: FeishuApiClient = {
    async request<T>(apiRequest: FeishuApiRequest): Promise<T> {
      requests.push(apiRequest);
      return {
        code: 0,
        data: {
          record: {
            record_id: "recCreated123",
          },
        },
      } as T;
    },
  };

  const createRun = await createAndApproveWriteOperation({
    workspaceId: workspace.id,
    integrationId: integration.id,
    bindingId: binding.id,
    client,
    request: createRequest,
    approvalId: "approval-base-create",
  });
  const updateRun = await createAndApproveWriteOperation({
    workspaceId: workspace.id,
    integrationId: integration.id,
    bindingId: binding.id,
    client,
    request: updateRequest,
    approvalId: "approval-base-update",
  });

  assert.deepEqual(requests, [
    {
      method: "POST",
      path: "/open-apis/bitable/v1/apps/appToken123/tables/tblBound123/records",
      query: {
        user_id_type: undefined,
      },
      body: {
        fields: {
          Status: "secret ready",
          Amount: 42,
        },
      },
    },
    {
      method: "PUT",
      path: "/open-apis/bitable/v1/apps/appToken123/tables/tblBound123/records/recCreated123",
      query: {
        user_id_type: undefined,
      },
      body: {
        fields: {
          Status: "secret done",
        },
      },
    },
  ]);

  assert.equal(createRun.status, "succeeded");
  assert.equal(updateRun.status, "succeeded");
  const createResult = JSON.parse(createRun.resultJson) as Record<string, unknown>;
  const updateResult = JSON.parse(updateRun.resultJson) as Record<string, unknown>;
  assert.equal(typeof (createResult.responseSummary as Record<string, unknown>).recordReference, "string");
  assert.equal(typeof (updateResult.responseSummary as Record<string, unknown>).recordReference, "string");
  assert.equal(JSON.stringify(createRun.requestJson).includes("secret ready"), false);
  assert.equal(JSON.stringify(updateRun.requestJson).includes("secret done"), false);
  assert.equal(JSON.stringify(createResult).includes("secret ready"), false);
  assert.equal(JSON.stringify(updateResult).includes("secret done"), false);
  assert.equal(JSON.stringify(createResult).includes("recCreated123"), false);
  assert.equal(JSON.stringify(updateResult).includes("recCreated123"), false);
});

test("Feishu write approvals enqueue approval-required cards in the source thread", databaseTestOptions, async () => {
  resetWorkspaceStateSync(DEFAULT_WORKSPACE_ID);
  initializeOrganizationSync({
    organizationName: "Northstar Labs",
    ownerName: "Mina",
    ownerRole: "Owner",
    firstChannelName: "general",
  }, DEFAULT_WORKSPACE_ID);
  createEmployeeSync({
    name: "Atlas",
    role: "Planner",
    remarkName: "Atlas",
    summary: "Trip planner",
    fit: "Ready",
    origin: "test",
  }, DEFAULT_WORKSPACE_ID);

  const integration = createExternalIntegrationSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    provider: FEISHU_PROVIDER_ID,
    displayName: "Feishu",
    transportMode: "http_webhook",
    scopesJson: ["sheets:spreadsheet"],
  });
  const channelBinding = upsertExternalChannelBindingSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: integration.id,
    channelName: "general",
    externalChatId: "oc_general",
    externalChatType: "group",
    externalChatName: "General",
    syncMode: "mirror",
  });
  createExternalMessageMappingSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: integration.id,
    channelBindingId: channelBinding.id,
    direction: "inbound",
    externalMessageId: "om_source",
    externalThreadId: "om_root",
    externalSenderId: "ou_mina",
    agentSpaceMessageId: "agent-space-source-message-1",
    metadataJson: {},
  });
  const binding = upsertExternalResourceBindingSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: integration.id,
    providerResourceType: "sheet",
    providerResourceToken: "shtcnApproval123",
    providerResourceUrl: "https://example.feishu.cn/sheets/shtcnApproval123",
    agentSpaceResourceType: "data_table",
    agentSpaceResourceId: "data-table-approval",
    channelName: "general",
    displayName: "Approval sheet",
  });
  const request: ExternalDataOperationRequest = {
    operationType: "sheets.update_range",
    providerResourceType: "sheet",
    providerResourceToken: "shtcnApproval123",
    actorType: "agent",
    actorId: "Atlas",
    parameters: {
      range: "Plan!A1:B2",
      values: [["secret customer", 42]],
    },
  };
  const client: FeishuApiClient = {
    async request() {
      throw new Error("write approval should not execute Feishu API before review");
    },
  };

  const pending = await executeFeishuDataOperationWithApproval({
    context: {
      workspaceId: DEFAULT_WORKSPACE_ID,
      integrationId: integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    client,
    request,
    resourceBindingId: binding.id,
    approval: {
      agentId: "Atlas",
      channelName: "general",
      sourceAgentSpaceMessageId: "agent-space-source-message-1",
      taskId: "task-approval-1",
    },
  });

  assert.equal(pending.result.ok, false);
  assert.equal(pending.result.errorCode, "feishu.data_operation_requires_approval");
  assert.ok(pending.approval);

  const queuedCards = listPendingExternalMessageOutboxSync({
    workspaceId: DEFAULT_WORKSPACE_ID,
    integrationId: integration.id,
  });
  assert.equal(queuedCards.length, 1);
  assert.equal(queuedCards[0]?.targetExternalChatId, "oc_general");
  assert.equal(queuedCards[0]?.targetExternalThreadId, "om_root");

  const payload = JSON.parse(queuedCards[0]?.payloadJson ?? "{}") as {
    msg_type?: string;
    reply_to_message_id?: string;
    content?: string;
  };
  assert.equal(payload.msg_type, "interactive");
  assert.equal(payload.reply_to_message_id, "om_root");

  const card = JSON.parse(String(payload.content)) as {
    header: { template: string; title: { content: string } };
    elements: Array<{ content?: string }>;
  };
  assert.equal(card.header.template, "orange");
  assert.equal(card.header.title.content, "Atlas · AgentSpace");
  assert.match(card.elements[0]?.content ?? "", /\*\*Atlas\*\* · Approval required/);
  assert.match(card.elements[0]?.content ?? "", /Task: task-approval-1/);
  assert.match(card.elements[0]?.content ?? "", /requested sheets\.update_range/);
  assert.equal(JSON.stringify(card).includes("secret customer"), false);
});

test("Feishu approval card callbacks validate user binding token hash and execute approved writes", databaseTestOptions, async () => {
  const workspace = createWorkspaceSync({
    slug: "feishu-card-approval",
    name: "Feishu Card Approval",
    createdBy: "system",
  });
  resetWorkspaceStateSync(workspace.id);
  initializeOrganizationSync({
    organizationName: "Northstar Labs",
    ownerName: "Mina",
    ownerRole: "Owner",
    firstChannelName: "general",
  }, workspace.id);
  createEmployeeSync({
    name: "Atlas",
    role: "Planner",
    remarkName: "Atlas",
    summary: "Trip planner",
    fit: "Ready",
    origin: "test",
  }, workspace.id);
  const reviewer = createUserSync({
    displayName: "Mina",
    primaryEmail: "mina-card-approval@example.com",
  });
  createWorkspaceMembershipSync({
    workspaceId: workspace.id,
    userId: reviewer.id,
    role: "admin",
  });

  const integration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: FEISHU_PROVIDER_ID,
    displayName: "Feishu",
    transportMode: "http_webhook",
    scopesJson: ["sheets:spreadsheet"],
  });
  upsertExternalUserBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    userId: reviewer.id,
    externalUserId: "ou_mina",
  });
  const channelBinding = upsertExternalChannelBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    channelName: "general",
    externalChatId: "oc_general",
    externalChatType: "group",
    externalChatName: "General",
    syncMode: "mirror",
  });
  createExternalMessageMappingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    channelBindingId: channelBinding.id,
    direction: "inbound",
    externalMessageId: "om_card_source",
    externalThreadId: "om_card_root",
    externalSenderId: "ou_mina",
    agentSpaceMessageId: "agent-space-card-source-message-1",
    metadataJson: {},
  });
  const table = createExternalDataTableSync({
    name: "Approval sheet",
    channelName: "general",
    externalProvider: FEISHU_PROVIDER_ID,
    externalResourceType: "sheet",
    externalResourceToken: "shtcnCardApproval123",
    externalUrl: "https://example.feishu.cn/sheets/shtcnCardApproval123",
  }, workspace.id);
  const binding = upsertExternalResourceBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    providerResourceType: "sheet",
    providerResourceToken: "shtcnCardApproval123",
    providerResourceUrl: "https://example.feishu.cn/sheets/shtcnCardApproval123",
    agentSpaceResourceType: "data_table",
    agentSpaceResourceId: table.id,
    channelName: "general",
    displayName: "Approval sheet",
    permissionsJson: {
      canWrite: true,
    },
  });
  const request: ExternalDataOperationRequest = {
    operationType: "sheets.update_range",
    providerResourceType: "sheet",
    providerResourceToken: "shtcnCardApproval123",
    actorType: "agent",
    actorId: "Atlas",
    parameters: {
      range: "Plan!A1:B2",
      values: [["approved from card", 42]],
    },
  };
  const requests: FeishuApiRequest[] = [];
  const client: FeishuApiClient = {
    async request<T>(apiRequest: FeishuApiRequest): Promise<T> {
      requests.push(apiRequest);
      return {
        code: 0,
        data: {
          revision: 19,
          updatedRange: "Plan!A1:B2",
          updatedRows: 1,
          updatedColumns: 2,
          updatedCells: 2,
        },
      } as T;
    },
  };

  const pending = await executeFeishuDataOperationWithApproval({
    context: {
      workspaceId: workspace.id,
      integrationId: integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    client,
    request,
    resourceBindingId: binding.id,
    approval: {
      agentId: "Atlas",
      channelName: "general",
      sourceAgentSpaceMessageId: "agent-space-card-source-message-1",
      taskId: "task-card-approval",
    },
  });
  assert.ok(pending.approval);
  const queuedApprovalCards = listPendingExternalMessageOutboxSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
  });
  assert.equal(queuedApprovalCards.length, 1);
  assert.equal(queuedApprovalCards[0]?.targetExternalThreadId, "om_card_root");
  const approvalMetadata = pending.approval.metadata ?? {};
  const token = String(approvalMetadata.feishuCardActionToken ?? "");
  const payloadHash = String(approvalMetadata.payloadHash ?? "");
  assert.ok(token);
  assert.ok(payloadHash);

  const callback = await processFeishuCardActionCallback({
    context: {
      workspaceId: workspace.id,
      integrationId: integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    payload: {
      schema: "2.0",
      header: {
        event_id: "evt-card-approve-1",
        event_type: "card.action.trigger",
        create_time: "1782220800000",
      },
      event: {
        action: {
          value: {
            approvalId: pending.approval.id,
            decision: "approved",
            payloadHash,
            token,
          },
        },
        operator: {
          operator_id: {
            open_id: "ou_mina",
          },
        },
      },
    },
    client,
  });

  assert.equal(callback.handled, true);
  assert.equal(callback.eventStatus, "processed");
  assert.equal(callback.approvalId, pending.approval.id);
  assert.equal(callback.reviewerUserId, reviewer.id);
  assert.equal(callback.execution?.result.ok, true, JSON.stringify(callback.execution?.result));
  const reviewedApproval = listApprovalsSync(workspace.id).find((item) => item.id === pending.approval?.id);
  assert.equal(reviewedApproval?.reviewerComment, "Reviewed from Feishu card by user 7cefd02d.");
  assert.doesNotMatch(reviewedApproval?.reviewerComment ?? "", /ou_mina/);
  assert.deepEqual(requests, [{
    method: "PUT",
    path: "/open-apis/sheets/v2/spreadsheets/shtcnCardApproval123/values",
    body: {
      valueRange: {
        range: "Plan!A1:B2",
        values: [["approved from card", 42]],
      },
    },
  }]);

  const completedRun = readExternalDataOperationRunSync({
    workspaceId: workspace.id,
    runId: pending.runId,
  });
  assert.equal(completedRun?.status, "succeeded");
  const queuedCards = listPendingExternalMessageOutboxSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
  });
  assert.equal(queuedCards.length, 2);
  assert.equal(queuedCards[1]?.targetExternalThreadId, "om_card_root");
  const receiptPayload = JSON.parse(queuedCards[1]?.payloadJson ?? "{}") as {
    msg_type?: string;
    reply_to_message_id?: string;
    content?: string;
  };
  assert.equal(receiptPayload.msg_type, "interactive");
  assert.equal(receiptPayload.reply_to_message_id, "om_card_root");
  const receiptCard = JSON.parse(String(receiptPayload.content)) as {
    header: { template: string; title: { content: string } };
    elements: Array<{ content?: string }>;
  };
  assert.equal(receiptCard.header.template, "green");
  assert.equal(receiptCard.header.title.content, "Atlas · AgentSpace");
  assert.match(receiptCard.elements[0]?.content ?? "", /Approved sheets\.update_range completed/);
  assert.equal(JSON.stringify(receiptCard).includes("approved from card"), false);
  const event = readExternalIntegrationEventSync({
    workspaceId: workspace.id,
    provider: FEISHU_PROVIDER_ID,
    externalEventId: "evt-card-approve-1",
  });
  assert.equal(event?.status, "processed");
  assert.equal(event?.errorMessage, undefined);
  assert.doesNotMatch(event?.payloadJson ?? "", /short-token|approved from card/);
});

async function createAndApproveWriteOperation(input: {
  workspaceId: string;
  integrationId: string;
  bindingId: string;
  client: FeishuApiClient;
  request: ExternalDataOperationRequest;
  approvalId: string;
}) {
  const payloadHash = buildFeishuDataOperationPayloadHash(input.request);
  const pending = await executeFeishuDataOperation({
    context: {
      workspaceId: input.workspaceId,
      integrationId: input.integrationId,
      provider: FEISHU_PROVIDER_ID,
    },
    client: input.client,
    request: input.request,
    resourceBindingId: input.bindingId,
  });
  assert.equal(pending.result.ok, false);
  assert.equal(pending.result.errorCode, "feishu.data_operation_requires_approval");
  const pendingRun = readExternalDataOperationRunSync({
    workspaceId: input.workspaceId,
    runId: pending.runId,
  });
  assert.ok(pendingRun);
  assert.equal(pendingRun.status, "pending");
  assert.equal(pendingRun.resourceBindingId, input.bindingId);

  const approved = await executeApprovedFeishuDataOperation({
    context: {
      workspaceId: input.workspaceId,
      integrationId: input.integrationId,
      provider: FEISHU_PROVIDER_ID,
    },
    client: input.client,
    runId: pending.runId,
    request: input.request,
    approvalId: input.approvalId,
    approvedPayloadHash: payloadHash,
  });
  assert.equal(approved.result.ok, true, JSON.stringify(approved.result));

  const completedRun = readExternalDataOperationRunSync({
    workspaceId: input.workspaceId,
    runId: pending.runId,
  });
  assert.ok(completedRun);
  return completedRun;
}
