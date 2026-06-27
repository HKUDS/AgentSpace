import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFeishuDataOperationPolicyInput,
  buildFeishuDataOperationPayloadHash,
  buildFeishuReadOperationRequest,
  buildFeishuWriteOperationRequest,
  planFeishuDataOperation,
  summarizeFeishuDataOperationResponse,
  summarizeFeishuDataOperationRequest,
  summarizeFeishuStoredDataOperationPolicyDecision,
  summarizeFeishuStoredDataOperationPolicyInput,
  summarizeFeishuStoredDataOperationGovernanceContext,
  summarizeFeishuStoredDataOperationRequest,
  summarizeFeishuStoredDataOperationResultData,
} from "../operation-plan.ts";
import {
  resolveFeishuResourceDescriptorForType,
} from "../resource-resolver.ts";
import {
  buildFeishuDataOperationApprovalMetadata,
  buildFeishuDataOperationApprovalPreview,
  formatFeishuApprovalReviewerReference,
  sanitizeFeishuDataOperationApprovalMetadata,
} from "../approval.ts";
import {
  applyFeishuResourceBindingParameters,
  type FeishuAgentSpaceResourceAccessDependencies,
  validateApprovedFeishuDataOperationBinding,
  validateApprovedFeishuDataOperationRun,
  validateFeishuAgentSpaceResourceAccessForDataOperation,
  validateFeishuDataOperationScopes,
  validateFeishuResourceBindingScopes,
  validateFeishuResourceBindingForDataOperation,
} from "../data-plane.ts";
import type { ExternalDataOperationRequest } from "../../../core/index.ts";
import type {
  ExternalDataOperationRunRecord,
  ExternalResourceBindingRecord,
} from "@agent-space/db";

test("plans Feishu Docs read operation as an allowed blocks request", () => {
  const request = buildRequest({
    operationType: "docs.read_document",
    providerResourceType: "doc",
    providerResourceToken: "docxToken",
    parameters: { pageSize: 20 },
  });

  assert.deepEqual(buildFeishuReadOperationRequest(request), {
    method: "GET",
    path: "/open-apis/docx/v1/documents/docxToken/blocks",
    query: {
      page_size: 20,
      page_token: undefined,
    },
  });
  assert.equal(planFeishuDataOperation(request).decision, "allow");
});

test("plans Feishu Sheets read operation only when range is present", () => {
  const request = buildRequest({
    operationType: "sheets.read_range",
    providerResourceType: "sheet",
    providerResourceToken: "sheetToken",
    parameters: { range: "Sheet1!A1:B2" },
  });

  assert.deepEqual(buildFeishuReadOperationRequest(request), {
    method: "GET",
    path: "/open-apis/sheets/v2/spreadsheets/sheetToken/values/Sheet1!A1%3AB2",
  });
  assert.equal(planFeishuDataOperation(request).decision, "allow");

  assert.equal(planFeishuDataOperation({
    ...request,
    parameters: {},
  }).decision, "deny");
});

test("plans Feishu metadata refresh and schema read operations", () => {
  const docMetadataRequest = buildRequest({
    operationType: "docs.refresh_metadata",
    providerResourceType: "doc",
    providerResourceToken: "docToken",
    parameters: {
      docType: "docx",
      userIdType: "open_id",
    },
  });
  assert.deepEqual(buildFeishuReadOperationRequest(docMetadataRequest), {
    method: "POST",
    path: "/open-apis/drive/v1/metas/batch_query",
    query: {
      user_id_type: "open_id",
    },
    body: {
      request_docs: [
        {
          doc_token: "docToken",
          doc_type: "docx",
        },
      ],
      with_url: true,
    },
  });
  assert.equal(planFeishuDataOperation(docMetadataRequest).decision, "allow");

  assert.deepEqual(buildFeishuReadOperationRequest(buildRequest({
    operationType: "sheets.refresh_metadata",
    providerResourceType: "sheet",
    providerResourceToken: "sheetToken",
  })), {
    method: "GET",
    path: "/open-apis/sheets/v2/spreadsheets/sheetToken/metainfo",
  });

  assert.deepEqual(buildFeishuReadOperationRequest(buildRequest({
    operationType: "base.read_schema",
    providerResourceType: "base_view",
    providerResourceToken: "viewToken",
    parameters: {
      appToken: "appToken",
      tableId: "tbl123",
      pageSize: 100,
      pageToken: "next-page",
    },
  })), {
    method: "GET",
    path: "/open-apis/bitable/v1/apps/appToken/tables/tbl123/fields",
    query: {
      page_size: 100,
      page_token: "next-page",
    },
  });

  assert.equal(planFeishuDataOperation(buildRequest({
    operationType: "base.read_schema",
    providerResourceType: "base_view",
    providerResourceToken: "viewToken",
    parameters: { appToken: "appToken" },
  })).decision, "deny");
});

test("applies Feishu resource binding metadata to data operation requests", () => {
  const wikiMetadataRequest = applyFeishuResourceBindingParameters(
    buildRequest({
      operationType: "docs.refresh_metadata",
      providerResourceType: "doc",
      providerResourceToken: "wikiNodeToken",
    }),
    buildResourceBinding({
      providerResourceType: "doc",
      providerResourceToken: "wikiNodeToken",
      metadataJson: JSON.stringify({ docType: "wiki" }),
    }),
  );

  assert.deepEqual(wikiMetadataRequest.parameters, {
    docType: "wiki",
  });
  assert.deepEqual(buildFeishuReadOperationRequest(wikiMetadataRequest), {
    method: "POST",
    path: "/open-apis/drive/v1/metas/batch_query",
    query: {
      user_id_type: undefined,
    },
    body: {
      request_docs: [
        {
          doc_token: "wikiNodeToken",
          doc_type: "wiki",
        },
      ],
      with_url: true,
    },
  });

  const explicitDocTypeRequest = applyFeishuResourceBindingParameters(
    buildRequest({
      operationType: "docs.refresh_metadata",
      providerResourceType: "doc",
      providerResourceToken: "docToken",
      parameters: { docType: "docx" },
    }),
    buildResourceBinding({
      providerResourceType: "doc",
      providerResourceToken: "docToken",
      metadataJson: JSON.stringify({ docType: "wiki" }),
    }),
  );
  assert.deepEqual(explicitDocTypeRequest.parameters, {
    docType: "docx",
  });

  const baseReadRequest = applyFeishuResourceBindingParameters(
    buildRequest({
      operationType: "base.query_records",
      providerResourceType: "base_table",
      providerResourceToken: "tblToken",
      parameters: { pageSize: 10 },
    }),
    buildResourceBinding({
      providerResourceType: "base_table",
      providerResourceToken: "tblToken",
      metadataJson: JSON.stringify({ appToken: "appToken", tableId: "tblToken", viewId: "vewToken" }),
    }),
  );
  assert.deepEqual(baseReadRequest.parameters, {
    pageSize: 10,
    appToken: "appToken",
    tableId: "tblToken",
    viewId: "vewToken",
  });
});

test("builds Feishu Sheets approved write request for a single range", () => {
  const request = buildRequest({
    operationType: "sheets.update_range",
    providerResourceType: "sheet",
    providerResourceToken: "sheetToken",
    parameters: {
      range: "Sheet1!A1:B2",
      values: [["customer", 42]],
    },
  });

  assert.deepEqual(buildFeishuWriteOperationRequest(request), {
    method: "PUT",
    path: "/open-apis/sheets/v2/spreadsheets/sheetToken/values",
    body: {
      valueRange: {
        range: "Sheet1!A1:B2",
        values: [["customer", 42]],
      },
    },
  });
});

test("builds Feishu Docs approved create document requests", () => {
  const request = buildRequest({
    operationType: "docs.create_document",
    providerResourceType: "doc",
    providerResourceToken: "folderToken",
    parameters: {
      title: "Launch plan",
    },
  });

  assert.deepEqual(buildFeishuWriteOperationRequest(request), {
    method: "POST",
    path: "/open-apis/docx/v1/documents",
    body: {
      folder_token: "folderToken",
      title: "Launch plan",
    },
  });
  const plan = planFeishuDataOperation(request);
  assert.equal(plan.decision, "require_approval");
  assert.equal(plan.writeOperation, true);
  assert.equal(plan.reasonCode, "agent_action.external_document_write_requires_approval");
  assert.equal(plan.policyInput?.action.type, "external_document.write");
  assert.equal(plan.policyInput?.action.provider, "feishu");
  assert.equal(plan.policyDecision?.approvalType, "external_data_operation");

  assert.deepEqual(buildFeishuWriteOperationRequest(buildRequest({
    operationType: "docs.create_document",
    providerResourceType: "doc",
    providerResourceToken: "new",
    parameters: {
      title: "Untitled workspace note",
      folderToken: "explicitFolder",
    },
  })), {
    method: "POST",
    path: "/open-apis/docx/v1/documents",
    body: {
      folder_token: "explicitFolder",
      title: "Untitled workspace note",
    },
  });

  assert.equal(buildFeishuWriteOperationRequest(buildRequest({
    operationType: "docs.create_document",
    providerResourceType: "doc",
    providerResourceToken: "folderToken",
    parameters: {},
  })), null);
});

test("builds Feishu Docs approved block mutation requests", () => {
  const appendRequest = buildRequest({
    operationType: "docs.update_document",
    providerResourceType: "doc",
    providerResourceToken: "docToken",
    parameters: {
      mutation: "append_blocks",
      parentBlockId: "parentBlock",
      documentRevisionId: -1,
      clientToken: "client-token-1",
      blocks: [
        {
          block_type: 2,
          text: {
            elements: [
              {
                text_run: {
                  content: "Approved content",
                },
              },
            ],
          },
        },
      ],
    },
  });

  assert.deepEqual(buildFeishuWriteOperationRequest(appendRequest), {
    method: "POST",
    path: "/open-apis/docx/v1/documents/docToken/blocks/parentBlock/children",
    query: {
      document_revision_id: -1,
      user_id_type: undefined,
      client_token: "client-token-1",
    },
    body: {
      children: [
        {
          block_type: 2,
          text: {
            elements: [
              {
                text_run: {
                  content: "Approved content",
                },
              },
            ],
          },
        },
      ],
      index: -1,
    },
  });
  const plan = planFeishuDataOperation(appendRequest);
  assert.equal(plan.decision, "require_approval");
  assert.equal(plan.writeOperation, true);
  assert.equal(plan.reasonCode, "agent_action.external_document_write_requires_approval");
  assert.equal(plan.policyInput?.action.type, "external_document.write");

  assert.deepEqual(buildFeishuWriteOperationRequest(buildRequest({
    operationType: "docs.update_document",
    providerResourceType: "doc",
    providerResourceToken: "docToken",
    parameters: {
      mutation: "update_block",
      blockId: "block-1",
      userIdType: "open_id",
      block: {
        replace_text: {
          text: "Updated content",
        },
      },
    },
  })), {
    method: "PATCH",
    path: "/open-apis/docx/v1/documents/docToken/blocks/block-1",
    query: {
      document_revision_id: undefined,
      user_id_type: "open_id",
      client_token: undefined,
    },
    body: {
      replace_text: {
        text: "Updated content",
      },
    },
  });

  assert.deepEqual(buildFeishuWriteOperationRequest(buildRequest({
    operationType: "docs.update_document",
    providerResourceType: "doc",
    providerResourceToken: "docToken",
    parameters: {
      mutation: "batch_update",
      requests: [
        {
          block_id: "block-1",
          update_text_elements: {
            elements: [],
          },
        },
      ],
    },
  })), {
    method: "PATCH",
    path: "/open-apis/docx/v1/documents/docToken/blocks/batch_update",
    query: {
      document_revision_id: undefined,
      user_id_type: undefined,
      client_token: undefined,
    },
    body: {
      requests: [
        {
          block_id: "block-1",
          update_text_elements: {
            elements: [],
          },
        },
      ],
    },
  });
});

test("builds Feishu Base approved mutation requests", () => {
  const createRequest = buildRequest({
    operationType: "base.mutate_records",
    providerResourceType: "base_table",
    providerResourceToken: "tbl123",
    parameters: {
      appToken: "appToken",
      fields: {
        Status: "Ready",
      },
    },
  });

  assert.deepEqual(buildFeishuWriteOperationRequest(createRequest), {
    method: "POST",
    path: "/open-apis/bitable/v1/apps/appToken/tables/tbl123/records",
    query: {
      user_id_type: undefined,
    },
    body: {
      fields: {
        Status: "Ready",
      },
    },
  });

  const updateRequest = buildRequest({
    operationType: "base.mutate_records",
    providerResourceType: "base",
    providerResourceToken: "appToken",
    parameters: {
      tableId: "tbl123",
      recordId: "rec123",
      fields: {
        Status: "Done",
      },
      userIdType: "open_id",
    },
  });

  assert.deepEqual(buildFeishuWriteOperationRequest(updateRequest), {
    method: "PUT",
    path: "/open-apis/bitable/v1/apps/appToken/tables/tbl123/records/rec123",
    query: {
      user_id_type: "open_id",
    },
    body: {
      fields: {
        Status: "Done",
      },
    },
  });

  const batchUpdateRequest = buildRequest({
    operationType: "base.mutate_records",
    providerResourceType: "base_table",
    providerResourceToken: "tbl123",
    parameters: {
      appToken: "appToken",
      mutation: "batch_update",
      records: [
        {
          recordId: "rec123",
          fields: {
            Status: "Done",
          },
        },
      ],
    },
  });

  assert.deepEqual(buildFeishuWriteOperationRequest(batchUpdateRequest), {
    method: "POST",
    path: "/open-apis/bitable/v1/apps/appToken/tables/tbl123/records/batch_update",
    query: {
      user_id_type: undefined,
    },
    body: {
      records: [
        {
          record_id: "rec123",
          fields: {
            Status: "Done",
          },
        },
      ],
    },
  });
});

test("plans Feishu Base record query with explicit app token and table id", () => {
  const request = buildRequest({
    operationType: "base.query_records",
    providerResourceType: "base_table",
    providerResourceToken: "tbl123",
    parameters: {
      appToken: "appToken",
      viewId: "vew123",
      pageSize: 50,
    },
  });

  assert.deepEqual(buildFeishuReadOperationRequest(request), {
    method: "GET",
    path: "/open-apis/bitable/v1/apps/appToken/tables/tbl123/records",
    query: {
      page_size: 50,
      page_token: undefined,
      view_id: "vew123",
    },
  });
});

test("write operations require approval and unsupported operations are denied", () => {
  const writePlan = planFeishuDataOperation(buildRequest({
    operationType: "sheets.update_range",
    providerResourceType: "sheet",
    providerResourceToken: "sheetToken",
  }));
  assert.equal(writePlan.decision, "require_approval");
  assert.equal(writePlan.writeOperation, true);
  assert.equal(writePlan.reasonCode, "agent_action.external_document_write_requires_approval");
  assert.equal(writePlan.policyInput?.action.type, "external_document.write");
  assert.equal(writePlan.policyInput?.action.resourceType, "feishu.sheet");
  assert.equal(writePlan.policyInput?.action.payloadHash?.length, 64);

  assert.deepEqual(planFeishuDataOperation(buildRequest({
    operationType: "calendar.read",
    providerResourceType: "calendar",
    providerResourceToken: "cal",
  })), {
    decision: "deny",
    writeOperation: false,
    reasonCode: "unsupported_operation",
  });
});

test("builds TODO85-style policy input for Feishu data actions", () => {
  const request = buildRequest({
    operationType: "base.mutate_records",
    providerResourceType: "base_table",
    providerResourceToken: "tbl123",
    actorId: "Atlas",
    parameters: {
      appToken: "appToken",
      recordId: "rec123",
      fields: {
        Status: "Done",
      },
    },
  });

  assert.deepEqual(buildFeishuDataOperationPolicyInput({
    request,
    writeOperation: true,
    policyContext: {
      workspaceId: "workspace-1",
      channelName: "ops",
      taskId: "task-1",
    },
  }), {
    workspaceId: "workspace-1",
    actor: {
      type: "agent",
      agentId: "Atlas",
    },
    channelName: "ops",
    taskId: "task-1",
    action: {
      type: "external_document.write",
      provider: "feishu",
      resourceType: "feishu.base_table",
      resourceId: "tbl123",
      operationSummary: "base.mutate_records on Feishu base_table target base_table / resource 5ac06eb3",
      payloadHash: buildFeishuDataOperationPayloadHash(request),
      riskLevel: "medium",
    },
  });
});

test("summarizes Feishu external guest readable resource access for stored evidence", () => {
  const request = buildRequest({
    operationType: "docs.read_document",
    providerResourceType: "doc",
    providerResourceToken: "docToken",
    parameters: {
      feishuGovernance: {
        provider: "feishu",
        agentId: "Atlas",
        botBindingId: "integration-1",
        channelName: "travel",
        actorType: "external_guest",
        actorUserId: "user-should-not-survive",
        externalActorReference: "guest-ref-safe-123",
        externalGuestPermissionProfile: "channel_context_only",
        externalGuestResourceAccess: "guest_readable_current_channel",
        externalChatReference: "chat-ref-safe-123",
      },
    },
  });

  assert.deepEqual(summarizeFeishuStoredDataOperationGovernanceContext(request), {
    provider: "feishu",
    agentId: "Atlas",
    botBindingId: "integration-1",
    channelName: "travel",
    actorType: "external_guest",
    externalActorReference: "guest-ref-safe-123",
    externalGuestPermissionProfile: "channel_context_only",
    externalGuestResourceAccess: "guest_readable_current_channel",
    externalChatReference: "chat-ref-safe-123",
    resourceReference: "doc / resource 2b507ee2",
    resourceIdRedacted: true,
  });
});

test("Base record updates without the required Feishu scope return a typed permission error", () => {
  const request = buildRequest({
    operationType: "base.mutate_records",
    providerResourceType: "base_table",
    providerResourceToken: "tbl123",
    parameters: {
      appToken: "appToken",
      mutation: "update_record",
      recordId: "rec123",
      fields: {
        Status: "Done",
      },
    },
  });

  const missing = validateFeishuDataOperationScopes({
    request,
    scopesJson: JSON.stringify(["sheets:spreadsheet", "docx:document"]),
  });

  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.errorCode, "feishu.data_operation_scope_missing");
    assert.equal(missing.requiredScope, "bitable:app");
    assert.equal(missing.data.operationType, "base.mutate_records");
    assert.deepEqual(missing.availableScopes, ["docx:document", "sheets:spreadsheet"]);
  }

  assert.deepEqual(validateFeishuDataOperationScopes({
    request,
    scopesJson: JSON.stringify(["bitable:app"]),
  }), {
    ok: true,
    requiredScope: "bitable:app",
    availableScopes: ["bitable:app"],
  });
});

test("read operations without the required Feishu scope return typed permission errors", () => {
  const docRead = buildRequest({
    operationType: "docs.read_document",
    providerResourceType: "doc",
    providerResourceToken: "docToken",
  });
  const docMissing = validateFeishuDataOperationScopes({
    request: docRead,
    scopesJson: JSON.stringify(["sheets:spreadsheet"]),
  });
  assert.equal(docMissing.ok, false);
  if (!docMissing.ok) {
    assert.equal(docMissing.errorCode, "feishu.data_operation_scope_missing");
    assert.equal(docMissing.requiredScope, "docx:document");
  }

  const sheetRead = buildRequest({
    operationType: "sheets.read_range",
    providerResourceType: "sheet",
    providerResourceToken: "sheetToken",
    parameters: { range: "Sheet1!A1:B2" },
  });
  const sheetMissing = validateFeishuDataOperationScopes({
    request: sheetRead,
    scopesJson: JSON.stringify(["docx:document"]),
  });
  assert.equal(sheetMissing.ok, false);
  if (!sheetMissing.ok) {
    assert.equal(sheetMissing.errorCode, "feishu.data_operation_scope_missing");
    assert.equal(sheetMissing.requiredScope, "sheets:spreadsheet");
  }

  assert.deepEqual(validateFeishuDataOperationScopes({
    request: docRead,
    scopesJson: JSON.stringify(["docx:document"]),
  }), {
    ok: true,
    requiredScope: "docx:document",
    availableScopes: ["docx:document"],
  });
});

test("Feishu resource bindings validate the provider scopes needed for live data-plane smoke", () => {
  const docMissing = validateFeishuResourceBindingScopes({
    providerResourceType: "doc",
    scopesJson: JSON.stringify(["docx:document", "sheets:spreadsheet"]),
  });
  assert.equal(docMissing.ok, false);
  if (!docMissing.ok) {
    assert.equal(docMissing.errorCode, "feishu.resource_binding_scope_missing");
    assert.deepEqual(docMissing.requiredScopes, ["docx:document", "drive:drive"]);
    assert.deepEqual(docMissing.missingScopes, ["drive:drive"]);
    assert.deepEqual(docMissing.availableScopes, ["docx:document", "sheets:spreadsheet"]);
    assert.equal(docMissing.data.providerResourceType, "doc");
  }

  assert.deepEqual(validateFeishuResourceBindingScopes({
    providerResourceType: "sheet",
    scopesJson: JSON.stringify(["sheets:spreadsheet"]),
  }), {
    ok: true,
    requiredScopes: ["sheets:spreadsheet"],
    availableScopes: ["sheets:spreadsheet"],
  });

  assert.deepEqual(validateFeishuResourceBindingScopes({
    providerResourceType: "base_table",
    scopesJson: JSON.stringify(["*"]),
  }), {
    ok: true,
    requiredScopes: ["bitable:app"],
    availableScopes: ["*"],
  });
});

test("write operation payload hash is stable and summaries avoid raw write content", () => {
  const request = buildRequest({
    operationType: "sheets.update_range",
    providerResourceType: "sheet",
    providerResourceToken: "sheetToken",
    parameters: {
      range: "Sheet1!A1:B2",
      values: [["secret customer", "secret amount"]],
    },
  });
  const reorderedRequest = buildRequest({
    operationType: "sheets.update_range",
    providerResourceType: "sheet",
    providerResourceToken: "sheetToken",
    parameters: {
      values: [["secret customer", "secret amount"]],
      range: "Sheet1!A1:B2",
    },
  });

  assert.equal(
    buildFeishuDataOperationPayloadHash(request),
    buildFeishuDataOperationPayloadHash(reorderedRequest),
  );
  const summary = summarizeFeishuDataOperationRequest(request);
  assert.deepEqual(summary, {
    operationType: "sheets.update_range",
    providerResourceType: "sheet",
    providerResourceToken: "sheetToken",
    parameterKeys: ["range", "values"],
    range: "Sheet1!A1:B2",
    appToken: undefined,
    tableId: undefined,
    viewId: undefined,
    mutation: undefined,
    parentBlockId: undefined,
    blockId: undefined,
    folderToken: undefined,
    hasTitle: false,
    titleLength: undefined,
    rowCount: 2,
    recordCount: undefined,
    blockCount: undefined,
    requestCount: undefined,
    fieldNames: undefined,
  });
  assert.equal(JSON.stringify(summary).includes("secret customer"), false);
  const storedSummary = summarizeFeishuStoredDataOperationRequest(request);
  assert.equal(storedSummary.providerResourceToken, undefined);
  assert.equal(storedSummary.providerResourceReference, "sheet / resource d3a9815d");
  assert.equal(storedSummary.providerResourceTokenRedacted, true);
  assert.equal(JSON.stringify(storedSummary).includes("sheetToken"), false);

  const policyInput = buildFeishuDataOperationPolicyInput({
    request,
    writeOperation: true,
    policyContext: {
      workspaceId: "workspace-1",
      channelName: "ops",
      taskId: "task-1",
    },
  });
  const storedPolicyInput = summarizeFeishuStoredDataOperationPolicyInput(policyInput, request);
  const storedPolicyAction = storedPolicyInput?.action as Record<string, unknown>;
  assert.equal(storedPolicyAction.resourceId, undefined);
  assert.equal(storedPolicyAction.resourceReference, "sheet / resource d3a9815d");
  assert.equal(storedPolicyAction.resourceIdRedacted, true);
  assert.equal(storedPolicyAction.payloadHash, buildFeishuDataOperationPayloadHash(request));
  assert.equal(storedPolicyAction.operationSummary, "sheets.update_range on Feishu sheet target Sheet1!A1:B2");
  assert.equal(JSON.stringify(storedPolicyInput).includes("sheetToken"), false);

  const plan = planFeishuDataOperation(request);
  const storedPolicyDecision = summarizeFeishuStoredDataOperationPolicyDecision(plan.policyDecision, request);
  assert.equal(storedPolicyDecision?.auditData?.resourceId, undefined);
  assert.equal(storedPolicyDecision?.auditData?.resourceReference, "sheet / resource d3a9815d");
  assert.equal(storedPolicyDecision?.auditData?.resourceIdRedacted, true);
  assert.equal(JSON.stringify(storedPolicyDecision).includes("sheetToken"), false);

  const docsSummary = summarizeFeishuDataOperationRequest(buildRequest({
    operationType: "docs.update_document",
    providerResourceType: "doc",
    providerResourceToken: "docToken",
    parameters: {
      mutation: "append_blocks",
      parentBlockId: "parentBlock",
      blocks: [
        {
          text: {
            elements: [
              {
                text_run: {
                  content: "secret document paragraph",
                },
              },
            ],
          },
        },
      ],
    },
  }));
  assert.deepEqual(docsSummary, {
    operationType: "docs.update_document",
    providerResourceType: "doc",
    providerResourceToken: "docToken",
    parameterKeys: ["blocks", "mutation", "parentBlockId"],
    range: undefined,
    appToken: undefined,
    tableId: undefined,
    viewId: undefined,
    mutation: "append_blocks",
    parentBlockId: "parentBlock",
    blockId: undefined,
    folderToken: undefined,
    hasTitle: false,
    titleLength: undefined,
    rowCount: undefined,
    recordCount: undefined,
    blockCount: 1,
    requestCount: undefined,
    fieldNames: undefined,
  });
  assert.equal(JSON.stringify(docsSummary).includes("secret document paragraph"), false);

  const createDocsSummary = summarizeFeishuDataOperationRequest(buildRequest({
    operationType: "docs.create_document",
    providerResourceType: "doc",
    providerResourceToken: "folderToken",
    parameters: {
      title: "secret launch plan",
      folderToken: "folderToken",
    },
  }));
  assert.deepEqual(createDocsSummary, {
    operationType: "docs.create_document",
    providerResourceType: "doc",
    providerResourceToken: "folderToken",
    parameterKeys: ["folderToken", "title"],
    range: undefined,
    appToken: undefined,
    tableId: undefined,
    viewId: undefined,
    mutation: undefined,
    parentBlockId: undefined,
    blockId: undefined,
    folderToken: "folderToken",
    hasTitle: true,
    titleLength: 18,
    rowCount: undefined,
    recordCount: undefined,
    blockCount: undefined,
    requestCount: undefined,
    fieldNames: undefined,
  });
  assert.equal(JSON.stringify(createDocsSummary).includes("secret launch plan"), false);
});

test("approved data operations refuse changed payloads before execution", () => {
  const request = buildRequest({
    operationType: "sheets.update_range",
    providerResourceType: "sheet",
    providerResourceToken: "sheetToken",
    parameters: {
      range: "Sheet1!A1:B2",
      values: [["approved"]],
    },
  });
  const payloadHash = buildFeishuDataOperationPayloadHash(request);
  const run = buildRun({
    request,
    requestJson: JSON.stringify({
      policyDecision: "require_approval",
      payloadHash,
    }),
  });

  assert.deepEqual(validateApprovedFeishuDataOperationRun({
    context: {
      workspaceId: run.workspaceId,
      integrationId: run.integrationId,
      provider: "feishu",
    },
    run,
    request,
    approvedPayloadHash: payloadHash,
  }), {
    ok: true,
    storedPayloadHash: payloadHash,
    computedPayloadHash: payloadHash,
  });

  const changedRequest = buildRequest({
    ...request,
    parameters: {
      range: "Sheet1!A1:B2",
      values: [["changed after approval"]],
    },
  });
  const rejected = validateApprovedFeishuDataOperationRun({
    context: {
      workspaceId: run.workspaceId,
      integrationId: run.integrationId,
      provider: "feishu",
    },
    run,
    request: changedRequest,
    approvedPayloadHash: payloadHash,
  });

  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.errorCode, "feishu.data_operation_payload_hash_mismatch");
    assert.equal(rejected.failRun, true);
  }
});

test("approved data operations refuse approval hash mismatches", () => {
  const request = buildRequest({
    operationType: "base.mutate_records",
    providerResourceType: "base_table",
    providerResourceToken: "tbl123",
    parameters: {
      appToken: "appToken",
      fields: {
        Status: "Ready",
      },
    },
  });
  const run = buildRun({
    request,
    requestJson: JSON.stringify({
      policyDecision: "require_approval",
      policyInput: buildFeishuDataOperationPolicyInput({
        request,
        writeOperation: true,
        policyContext: {
          workspaceId: "workspace-1",
          channelName: "ops",
          taskId: "task-1",
        },
      }),
      agentActionPolicyDecision: {
        decision: "require_approval",
        reasonCode: "agent_action.external_document_write_requires_approval",
      },
      payloadHash: buildFeishuDataOperationPayloadHash(request),
    }),
  });

  const rejected = validateApprovedFeishuDataOperationRun({
    context: {
      workspaceId: run.workspaceId,
      integrationId: run.integrationId,
      provider: "feishu",
    },
    run,
    request,
    approvedPayloadHash: "not-the-approved-payload",
  });

  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.errorCode, "feishu.data_operation_approval_payload_hash_mismatch");
    assert.equal(rejected.failRun, true);
  }
});

test("approved data operations revalidate write bindings before execution", () => {
  const request = buildRequest({
    operationType: "sheets.update_range",
    providerResourceType: "sheet",
    providerResourceToken: "sheetToken",
    parameters: {
      range: "Sheet1!A1:B2",
      values: [["approved"]],
    },
  });
  const writableBinding = buildResourceBinding({
    providerResourceType: "sheet",
    providerResourceToken: "sheetToken",
    permissionsJson: JSON.stringify({ canWrite: true }),
  });
  const run = buildRun({
    request,
    resourceBindingId: writableBinding.id,
    requestJson: JSON.stringify({
      policyDecision: "require_approval",
      payloadHash: buildFeishuDataOperationPayloadHash(request),
    }),
  });
  const context = {
    workspaceId: run.workspaceId,
    integrationId: run.integrationId,
    provider: "feishu",
  };

  assert.deepEqual(validateApprovedFeishuDataOperationBinding({
    context,
    run,
    request,
    binding: writableBinding,
  }), {
    ok: true,
    binding: writableBinding,
  });

  const missingBindingId = validateApprovedFeishuDataOperationBinding({
    context,
    run: buildRun({
      request,
      requestJson: run.requestJson,
    }),
    request,
    binding: writableBinding,
  });
  assert.equal(missingBindingId.ok, false);
  if (!missingBindingId.ok) {
    assert.equal(missingBindingId.errorCode, "feishu.data_operation_resource_binding_missing");
  }

  const archivedBinding = validateApprovedFeishuDataOperationBinding({
    context,
    run,
    request,
    binding: {
      ...writableBinding,
      status: "archived",
    },
  });
  assert.equal(archivedBinding.ok, false);
  if (!archivedBinding.ok) {
    assert.equal(archivedBinding.errorCode, "feishu.data_operation_resource_binding_inactive");
  }

  const writeRevoked = validateApprovedFeishuDataOperationBinding({
    context,
    run,
    request,
    binding: {
      ...writableBinding,
      permissionsJson: JSON.stringify({ canRead: true }),
    },
  });
  assert.equal(writeRevoked.ok, false);
  if (!writeRevoked.ok) {
    assert.equal(writeRevoked.errorCode, "feishu.data_operation_resource_write_denied");
  }

  const replacedBinding = validateApprovedFeishuDataOperationBinding({
    context,
    run,
    request,
    binding: {
      ...writableBinding,
      id: "external-resource-binding-replaced",
    },
  });
  assert.equal(replacedBinding.ok, false);
  if (!replacedBinding.ok) {
    assert.equal(replacedBinding.errorCode, "feishu.data_operation_resource_binding_id_mismatch");
  }
});

test("Feishu approval metadata keeps execution payload server-side and sanitizes it for queue data", () => {
  const request = buildRequest({
    operationType: "sheets.update_range",
    providerResourceType: "sheet",
    providerResourceToken: "sheetToken",
    parameters: {
      range: "Sheet1!A1:B2",
      values: [["secret write value"]],
    },
  });
  const run = buildRun({
    request,
    requestJson: JSON.stringify({
      policyDecision: "require_approval",
      policyInput: buildFeishuDataOperationPolicyInput({
        request,
        writeOperation: true,
        policyContext: {
          workspaceId: "workspace-1",
          channelName: "ops",
          taskId: "task-1",
        },
      }),
      agentActionPolicyDecision: {
        decision: "require_approval",
        reasonCode: "agent_action.external_document_write_requires_approval",
      },
      payloadHash: buildFeishuDataOperationPayloadHash(request),
    }),
  });

  const metadata = buildFeishuDataOperationApprovalMetadata({
    context: {
      workspaceId: run.workspaceId,
      integrationId: run.integrationId,
      provider: "feishu",
    },
    run,
    request,
  });

  assert.equal(metadata.operationRequest.parameters.values, request.parameters.values);
  assert.equal(metadata.agentActionPolicyInput?.action.type, "external_document.write");
  assert.equal(metadata.agentActionPolicyInput?.channelName, "ops");
  assert.equal(typeof metadata.feishuCardActionToken, "string");
  assert.ok((metadata.feishuCardActionToken ?? "").length >= 12);
  const sanitized = sanitizeFeishuDataOperationApprovalMetadata(metadata);
  assert.equal(sanitized?.operationRequest, undefined);
  assert.equal(sanitized?.feishuCardActionToken, undefined);
  assert.equal(sanitized?.providerResourceToken, undefined);
  assert.equal(sanitized?.providerResourceReference, "sheet / resource d3a9815d");
  assert.equal(sanitized?.providerResourceTokenRedacted, true);
  assert.equal((sanitized?.requestSummary as Record<string, unknown> | undefined)?.providerResourceToken, undefined);
  assert.equal((sanitized?.requestSummary as Record<string, unknown> | undefined)?.providerResourceReference, "sheet / resource d3a9815d");
  assert.equal((sanitized?.requestSummary as Record<string, unknown> | undefined)?.providerResourceTokenRedacted, true);
  const sanitizedPolicyAction = ((sanitized?.agentActionPolicyInput as Record<string, unknown> | undefined)?.action ?? {}) as Record<string, unknown>;
  assert.equal(sanitizedPolicyAction.resourceId, undefined);
  assert.equal(sanitizedPolicyAction.resourceReference, "sheet / resource d3a9815d");
  assert.equal(sanitizedPolicyAction.resourceIdRedacted, true);
  assert.equal(sanitizedPolicyAction.operationSummary, "sheets.update_range on Feishu sheet target Sheet1!A1:B2");
  assert.equal(JSON.stringify(sanitized).includes("secret write value"), false);
  assert.equal(JSON.stringify(sanitized).includes("sheetToken"), false);
  assert.equal(sanitized?.payloadHash, buildFeishuDataOperationPayloadHash(request));
});

test("Feishu approval metadata can retain AgentSpace reply context for review receipts", () => {
  const request: ExternalDataOperationRequest = {
    operationType: "sheets.update_range",
    providerResourceType: "sheet",
    providerResourceToken: "shtcnReceipt123",
    actorType: "agent",
    actorId: "Atlas",
    parameters: {
      range: "Sheet1!A1:B1",
      values: [["receipt"]],
    },
  };
  const run = buildRun({
    request,
    requestJson: JSON.stringify({
      policyInput: buildFeishuDataOperationPolicyInput({
        request,
        writeOperation: true,
        policyContext: {
          workspaceId: "workspace-1",
          channelName: "ops",
          taskId: "task-receipt-1",
        },
      }),
    }),
  });
  const metadata = {
    ...buildFeishuDataOperationApprovalMetadata({
      context: {
        workspaceId: run.workspaceId,
        integrationId: run.integrationId,
        provider: "feishu",
      },
      run,
      request,
    }),
    sourceAgentSpaceMessageId: "message-source-1",
    taskId: "task-receipt-1",
  };

  assert.equal(metadata.sourceAgentSpaceMessageId, "message-source-1");
  assert.equal(metadata.taskId, "task-receipt-1");
  const sanitized = sanitizeFeishuDataOperationApprovalMetadata(metadata);
  assert.equal(sanitized?.sourceAgentSpaceMessageId, "message-source-1");
  assert.equal(sanitized?.taskId, "task-receipt-1");
  assert.equal(JSON.stringify(sanitized).includes("shtcnReceipt123"), false);
  assert.equal(sanitized?.operationRequest, undefined);
  assert.equal(JSON.stringify(sanitized?.requestSummary ?? {}).includes("[[\"receipt\"]]"), false);
});

test("Feishu approval previews use resource references instead of raw resource tokens", () => {
  const request = buildRequest({
    operationType: "docs.create_document",
    providerResourceType: "doc",
    providerResourceToken: "folderToken",
    parameters: {
      title: "Launch plan",
      folderToken: "folderToken",
    },
  });
  const requestSummary = summarizeFeishuDataOperationRequest(request);

  const preview = buildFeishuDataOperationApprovalPreview({
    agentId: "Atlas",
    request,
    requestSummary,
  });

  assert.equal(preview, "Atlas requested docs.create_document on Feishu Docs (doc / resource 56a2f76a).");
  assert.equal(preview.includes("folderToken"), false);
});

test("Feishu approval reviewer references avoid raw external user ids", () => {
  assert.equal(formatFeishuApprovalReviewerReference({
    displayName: " Mina ",
    externalUserId: "ou_mina",
  }), "Mina");
  assert.equal(formatFeishuApprovalReviewerReference({
    externalUserId: "ou_mina",
  }), "user 7cefd02d");
  assert.equal(formatFeishuApprovalReviewerReference({}), "Feishu user");
});

test("Feishu read operations require an active matching resource binding", () => {
  const request = buildRequest({
    operationType: "docs.read_document",
    providerResourceType: "doc",
    providerResourceToken: "docToken",
  });
  const binding = buildResourceBinding({
    providerResourceType: "doc",
    providerResourceToken: "docToken",
    status: "active",
  });
  const context = {
    workspaceId: binding.workspaceId,
    integrationId: binding.integrationId,
    provider: "feishu",
  };

  assert.deepEqual(validateFeishuResourceBindingForDataOperation({
    context,
    request,
    binding,
  }), {
    ok: true,
    binding,
  });

  const missing = validateFeishuResourceBindingForDataOperation({
    context,
    request,
    binding: null,
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.errorCode, "feishu.data_operation_resource_unbound");
    assert.deepEqual(missing.data?.bindingSuggestion, {
      provider: "feishu",
      action: "create_resource_binding",
      providerResourceType: "doc",
      providerResourceToken: "docToken",
      recommendedAgentSpaceResourceType: "channel_document",
      operationType: "docs.read_document",
    });
  }

  const inactive = validateFeishuResourceBindingForDataOperation({
    context,
    request,
    binding: {
      ...binding,
      status: "disabled",
    },
  });
  assert.equal(inactive.ok, false);
  if (!inactive.ok) {
    assert.equal(inactive.errorCode, "feishu.data_operation_resource_binding_inactive");
  }

  const mismatched = validateFeishuResourceBindingForDataOperation({
    context,
    request,
    binding: {
      ...binding,
      providerResourceToken: "otherDocToken",
    },
  });
  assert.equal(mismatched.ok, false);
  if (!mismatched.ok) {
    assert.equal(mismatched.errorCode, "feishu.data_operation_resource_binding_mismatch");
  }
});

test("Feishu read operation binding can explicitly deny reads", () => {
  const request = buildRequest({
    operationType: "sheets.read_range",
    providerResourceType: "sheet",
    providerResourceToken: "sheetToken",
    parameters: { range: "Sheet1!A1:B2" },
  });
  const binding = buildResourceBinding({
    providerResourceType: "sheet",
    providerResourceToken: "sheetToken",
    permissionsJson: JSON.stringify({ canRead: false }),
  });
  const denied = validateFeishuResourceBindingForDataOperation({
    context: {
      workspaceId: binding.workspaceId,
      integrationId: binding.integrationId,
      provider: "feishu",
    },
    request,
    binding,
  });

  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.equal(denied.errorCode, "feishu.data_operation_resource_read_denied");
  }
});

test("Feishu Doc bindings reject mismatched doc type context", () => {
  const request = buildRequest({
    operationType: "docs.refresh_metadata",
    providerResourceType: "doc",
    providerResourceToken: "wikiNodeToken",
    parameters: { docType: "docx" },
  });
  const binding = buildResourceBinding({
    providerResourceType: "doc",
    providerResourceToken: "wikiNodeToken",
    metadataJson: JSON.stringify({ docType: "wiki" }),
  });
  const context = {
    workspaceId: binding.workspaceId,
    integrationId: binding.integrationId,
    provider: "feishu",
  };

  const rejected = validateFeishuResourceBindingForDataOperation({
    context,
    request,
    binding,
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.errorCode, "feishu.data_operation_doc_binding_context_mismatch");
    assert.equal(rejected.data?.field, "docType");
    assert.equal(JSON.stringify(rejected).includes("wikiNodeToken"), false);
  }

  const valid = validateFeishuResourceBindingForDataOperation({
    context,
    request: {
      ...request,
      parameters: { docType: "wiki" },
    },
    binding,
  });
  assert.equal(valid.ok, true);
});

test("Feishu Base table bindings require app token context for data operations", () => {
  const request = buildRequest({
    operationType: "base.query_records",
    providerResourceType: "base_table",
    providerResourceToken: "tblToken",
  });
  const binding = buildResourceBinding({
    providerResourceType: "base_table",
    providerResourceToken: "tblToken",
    metadataJson: "{}",
  });
  const context = {
    workspaceId: binding.workspaceId,
    integrationId: binding.integrationId,
    provider: "feishu",
  };

  const missingAppToken = validateFeishuResourceBindingForDataOperation({
    context,
    request,
    binding,
  });
  assert.equal(missingAppToken.ok, false);
  if (!missingAppToken.ok) {
    assert.equal(missingAppToken.errorCode, "feishu.data_operation_base_app_token_missing");
    assert.equal(missingAppToken.data?.missing, "appToken");
  }

  const explicitAppToken = validateFeishuResourceBindingForDataOperation({
    context,
    request: {
      ...request,
      parameters: {
        appToken: "appToken",
      },
    },
    binding,
  });
  assert.equal(explicitAppToken.ok, true);

  const metadataAppToken = validateFeishuResourceBindingForDataOperation({
    context,
    request,
    binding: {
      ...binding,
      metadataJson: JSON.stringify({ appToken: "appToken", tableId: "tblToken" }),
    },
  });
  assert.equal(metadataAppToken.ok, true);

  const appTokenMismatch = validateFeishuResourceBindingForDataOperation({
    context,
    request: {
      ...request,
      parameters: {
        appToken: "otherBaseAppToken",
      },
    },
    binding: {
      ...binding,
      metadataJson: JSON.stringify({ appToken: "boundBaseAppToken", tableId: "tblToken" }),
    },
  });
  assert.equal(appTokenMismatch.ok, false);
  if (!appTokenMismatch.ok) {
    assert.equal(appTokenMismatch.errorCode, "feishu.data_operation_base_binding_context_mismatch");
    assert.equal(appTokenMismatch.data?.field, "appToken");
    assert.equal(JSON.stringify(appTokenMismatch).includes("boundBaseAppToken"), false);
    assert.equal(JSON.stringify(appTokenMismatch).includes("otherBaseAppToken"), false);
  }

  const tableIdMismatch = validateFeishuResourceBindingForDataOperation({
    context,
    request,
    binding: {
      ...binding,
      metadataJson: JSON.stringify({ appToken: "appToken", tableId: "otherTable" }),
    },
  });
  assert.equal(tableIdMismatch.ok, false);
  if (!tableIdMismatch.ok) {
    assert.equal(tableIdMismatch.errorCode, "feishu.data_operation_base_binding_context_mismatch");
    assert.equal(tableIdMismatch.data?.field, "tableId");
    assert.equal(JSON.stringify(tableIdMismatch).includes("tblToken"), false);
    assert.equal(JSON.stringify(tableIdMismatch).includes("otherTable"), false);
  }
});

test("Feishu Base view bindings require table id context for data operations", () => {
  const request = buildRequest({
    operationType: "base.query_records",
    providerResourceType: "base_view",
    providerResourceToken: "vewToken",
    parameters: {
      appToken: "appToken",
    },
  });
  const binding = buildResourceBinding({
    providerResourceType: "base_view",
    providerResourceToken: "vewToken",
    metadataJson: JSON.stringify({ appToken: "appToken", viewId: "vewToken" }),
  });
  const context = {
    workspaceId: binding.workspaceId,
    integrationId: binding.integrationId,
    provider: "feishu",
  };

  const missingTableId = validateFeishuResourceBindingForDataOperation({
    context,
    request,
    binding,
  });
  assert.equal(missingTableId.ok, false);
  if (!missingTableId.ok) {
    assert.equal(missingTableId.errorCode, "feishu.data_operation_base_table_id_missing");
    assert.equal(missingTableId.data?.missing, "tableId");
  }

  const valid = validateFeishuResourceBindingForDataOperation({
    context,
    request: {
      ...request,
      parameters: {
        ...request.parameters,
        tableId: "tblToken",
      },
    },
    binding,
  });
  assert.equal(valid.ok, true);

  const viewTableMismatch = validateFeishuResourceBindingForDataOperation({
    context,
    request: {
      ...request,
      parameters: {
        ...request.parameters,
        tableId: "otherTable",
      },
    },
    binding: {
      ...binding,
      metadataJson: JSON.stringify({ appToken: "appToken", tableId: "tblToken", viewId: "vewToken" }),
    },
  });
  assert.equal(viewTableMismatch.ok, false);
  if (!viewTableMismatch.ok) {
    assert.equal(viewTableMismatch.errorCode, "feishu.data_operation_base_binding_context_mismatch");
    assert.equal(viewTableMismatch.data?.field, "tableId");
    assert.equal(JSON.stringify(viewTableMismatch).includes("otherTable"), false);
  }

  const viewIdMismatch = validateFeishuResourceBindingForDataOperation({
    context,
    request,
    binding: {
      ...binding,
      metadataJson: JSON.stringify({ appToken: "appToken", tableId: "tblToken", viewId: "otherView" }),
    },
  });
  assert.equal(viewIdMismatch.ok, false);
  if (!viewIdMismatch.ok) {
    assert.equal(viewIdMismatch.errorCode, "feishu.data_operation_base_binding_context_mismatch");
    assert.equal(viewIdMismatch.data?.field, "viewId");
    assert.equal(JSON.stringify(viewIdMismatch).includes("vewToken"), false);
    assert.equal(JSON.stringify(viewIdMismatch).includes("otherView"), false);
  }
});

test("Feishu write operation binding requires an explicit write grant", () => {
  const request = buildRequest({
    operationType: "sheets.update_range",
    providerResourceType: "sheet",
    providerResourceToken: "sheetToken",
    parameters: {
      range: "Sheet1!A1:B2",
      values: [["secret write value"]],
    },
  });
  const binding = buildResourceBinding({
    providerResourceType: "sheet",
    providerResourceToken: "sheetToken",
  });
  const denied = validateFeishuResourceBindingForDataOperation({
    context: {
      workspaceId: binding.workspaceId,
      integrationId: binding.integrationId,
      provider: "feishu",
    },
    request,
    binding,
    operationKind: "write",
  });

  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.equal(denied.errorCode, "feishu.data_operation_resource_write_denied");
  }

  const allowedBinding = {
    ...binding,
    permissionsJson: JSON.stringify({ canWrite: true }),
  };
  assert.deepEqual(validateFeishuResourceBindingForDataOperation({
    context: {
      workspaceId: binding.workspaceId,
      integrationId: binding.integrationId,
      provider: "feishu",
    },
    request,
    binding: allowedBinding,
    operationKind: "write",
  }), {
    ok: true,
    binding: allowedBinding,
  });
});

test("Feishu bound reads enforce AgentSpace document and data table access", () => {
  const context = {
    workspaceId: "workspace-1",
    integrationId: "integration-1",
    provider: "feishu",
  };
  const documentRequest = buildRequest({
    operationType: "docs.read_document",
    providerResourceType: "doc",
    providerResourceToken: "docToken",
    actorType: "agent",
    actorId: "Atlas",
  });
  const documentBinding = buildResourceBinding({
    providerResourceType: "doc",
    providerResourceToken: "docToken",
    agentSpaceResourceType: "channel_document",
    agentSpaceResourceId: "doc-1",
  });
  const documentDenied = validateFeishuAgentSpaceResourceAccessForDataOperation({
    context,
    request: documentRequest,
    binding: documentBinding,
    dependencies: buildAccessDependencies({
      canViewChannelDocument: false,
    }),
  });
  assert.equal(documentDenied.ok, false);
  if (!documentDenied.ok) {
    assert.equal(documentDenied.errorCode, "feishu.data_operation_channel_document_access_denied");
  }

  const documentAllowed = validateFeishuAgentSpaceResourceAccessForDataOperation({
    context,
    request: documentRequest,
    binding: documentBinding,
    dependencies: buildAccessDependencies({
      canViewChannelDocument: true,
    }),
  });
  assert.deepEqual(documentAllowed, { ok: true });

  const tableRequest = buildRequest({
    operationType: "sheets.read_range",
    providerResourceType: "sheet",
    providerResourceToken: "sheetToken",
    actorType: "user",
    actorId: "user-1",
    parameters: { range: "Sheet1!A1:B2" },
  });
  const tableBinding = buildResourceBinding({
    providerResourceType: "sheet",
    providerResourceToken: "sheetToken",
    agentSpaceResourceType: "data_table",
    agentSpaceResourceId: "table-1",
  });
  const tableNotFound = validateFeishuAgentSpaceResourceAccessForDataOperation({
    context,
    request: tableRequest,
    binding: tableBinding,
    actor: { userId: "user-1", displayName: "Mina", role: "member" },
    dependencies: buildAccessDependencies({
      readDataTable: null,
    }),
  });
  assert.equal(tableNotFound.ok, false);
  if (!tableNotFound.ok) {
    assert.equal(tableNotFound.errorCode, "feishu.data_operation_data_table_not_found");
  }

  const tableMismatch = validateFeishuAgentSpaceResourceAccessForDataOperation({
    context,
    request: tableRequest,
    binding: tableBinding,
    actor: { userId: "user-1", displayName: "Mina", role: "member" },
    dependencies: buildAccessDependencies({
      readDataTable: {
        id: "table-1",
        status: "active",
        externalProvider: "google_workspace",
        externalResourceToken: "sheetToken",
      },
    }),
  });
  assert.equal(tableMismatch.ok, false);
  if (!tableMismatch.ok) {
    assert.equal(tableMismatch.errorCode, "feishu.data_operation_data_table_binding_mismatch");
  }

  const tableChannelDenied = validateFeishuAgentSpaceResourceAccessForDataOperation({
    context,
    request: tableRequest,
    binding: tableBinding,
    actor: { userId: "user-1", displayName: "Mina", role: "member" },
    dependencies: buildAccessDependencies({
      readDataTable: {
        id: "table-1",
        status: "active",
        externalProvider: "feishu",
        externalResourceToken: "sheetToken",
        channelName: "ops",
      },
      canReadChannel: false,
    }),
  });
  assert.equal(tableChannelDenied.ok, false);
  if (!tableChannelDenied.ok) {
    assert.equal(tableChannelDenied.errorCode, "feishu.data_operation_data_table_channel_access_denied");
  }

  const tableAllowed = validateFeishuAgentSpaceResourceAccessForDataOperation({
    context,
    request: tableRequest,
    binding: tableBinding,
    actor: { userId: "user-1", displayName: "Mina", role: "member" },
    dependencies: buildAccessDependencies({
      readDataTable: {
        id: "table-1",
        status: "active",
        externalProvider: "feishu",
        externalResourceToken: "sheetToken",
        channelName: "ops",
      },
      canReadChannel: true,
    }),
  });
  assert.deepEqual(tableAllowed, { ok: true });
});

test("resolves Feishu Base table and view URLs with scoped metadata", () => {
  const table = resolveFeishuResourceDescriptorForType(
    "base_table",
    "https://example.feishu.cn/base/appToken123?table=tbl456&view=vew789",
  );
  assert.deepEqual(table, {
    providerResourceType: "base_table",
    providerResourceToken: "tbl456",
    providerResourceUrl: "https://example.feishu.cn/base/appToken123?table=tbl456&view=vew789",
    metadata: {
      appToken: "appToken123",
      tableId: "tbl456",
      viewId: "vew789",
    },
  });

  const view = resolveFeishuResourceDescriptorForType(
    "base_view",
    "https://example.feishu.cn/base/appToken123?table=tbl456&view=vew789",
  );
  assert.deepEqual(view, {
    providerResourceType: "base_view",
    providerResourceToken: "vew789",
    providerResourceUrl: "https://example.feishu.cn/base/appToken123?table=tbl456&view=vew789",
    metadata: {
      appToken: "appToken123",
      tableId: "tbl456",
      viewId: "vew789",
    },
  });
});

test("summarizes Feishu read responses into capped previews", () => {
  const docsSummary = summarizeFeishuDataOperationResponse(
    buildRequest({
      operationType: "docs.read_document",
      providerResourceType: "doc",
      providerResourceToken: "docToken",
    }),
    {
      code: 0,
      data: {
        items: [
          {
            block_id: "block-1",
            block_type: "text",
            text: {
              elements: [
                { text: "A very useful Feishu document paragraph." },
              ],
            },
          },
        ],
      },
    },
  );
  assert.deepEqual(docsSummary.resultPreview, {
    kind: "doc_blocks",
    blockCount: 1,
    blocks: [
      {
        blockId: "block-1",
        blockType: "text",
        textPreview: "A very useful Feishu document paragraph.",
      },
    ],
  });

  const sheetSummary = summarizeFeishuDataOperationResponse(
    buildRequest({
      operationType: "sheets.read_range",
      providerResourceType: "sheet",
      providerResourceToken: "sheetToken",
      parameters: { range: "Sheet1!A1:C2" },
    }),
    {
      code: 0,
      data: {
        valueRange: {
          range: "Sheet1!A1:C2",
          values: [
            ["Name", "Amount", "Notes"],
            ["Mina", 42, "Keep this preview short"],
          ],
        },
      },
    },
  );
  assert.deepEqual(sheetSummary.resultPreview, {
    kind: "sheet_values",
    range: "Sheet1!A1:C2",
    rowCount: 2,
    columnCount: 3,
    rows: [
      ["Name", "Amount", "Notes"],
      ["Mina", 42, "Keep this preview short"],
    ],
  });

  const baseSummary = summarizeFeishuDataOperationResponse(
    buildRequest({
      operationType: "base.query_records",
      providerResourceType: "base_table",
      providerResourceToken: "tbl123",
      parameters: { appToken: "appToken" },
    }),
    {
      code: 0,
      data: {
        items: [
          {
            record_id: "rec123",
            fields: {
              Amount: 42,
              Status: "Ready",
            },
          },
        ],
      },
    },
  );
  assert.deepEqual(baseSummary.resultPreview, {
    kind: "base_records",
    recordCount: 1,
    records: [
      {
        recordId: "rec123",
        fieldNames: ["Amount", "Status"],
        fieldsPreview: {
          Amount: 42,
          Status: "Ready",
        },
      },
    ],
  });

  const createDocSummary = summarizeFeishuDataOperationResponse(
    buildRequest({
      operationType: "docs.create_document",
      providerResourceType: "doc",
      providerResourceToken: "folderToken",
      parameters: { title: "Launch plan" },
    }),
    {
      code: 0,
      msg: "ok doccnCreated123",
      data: {
        document: {
          document_id: "doccnCreated123",
          title: "Launch plan",
          revision_id: "rev-1",
        },
      },
    },
  );
  const createDocResponseSummary = createDocSummary.responseSummary as Record<string, unknown>;
  assert.equal(createDocResponseSummary.code, 0);
  assert.equal(createDocResponseSummary.messageRedacted, true);
  assert.equal(createDocResponseSummary.hasData, true);
  assert.equal(typeof createDocResponseSummary.documentReference, "string");
  assert.equal(String(createDocResponseSummary.documentReference).startsWith("ref_"), true);
  assert.equal(JSON.stringify(createDocSummary).includes("doccnCreated123"), false);
  assert.equal(JSON.stringify(createDocSummary).includes("ok doccnCreated123"), false);
});

test("summarizes stored Feishu operation results without raw previews", () => {
  const storedDocResult = summarizeFeishuStoredDataOperationResultData({
    policyDecision: "allow",
    responseSummary: {
      code: "tenant_access_token=secret",
      msg: "ok doccnSecret recSecret",
      hasData: true,
      updatedRange: "Secret!A1:B2",
      documentId: "doccnSecret",
      recordId: "recSecret",
      recordIds: ["recSecret", "recAlsoSecret"],
    },
    resultPreview: {
      kind: "doc_blocks",
      blockCount: 1,
      blocks: [
        {
          blockId: "block-1",
          blockType: "text",
          textPreview: "confidential document paragraph",
        },
      ],
    },
  });

  assert.deepEqual(storedDocResult, {
    policyDecision: "allow",
    responseSummary: {
      code: "[string-code]",
      messageRedacted: true,
      hasData: true,
      documentReference: (storedDocResult.responseSummary as Record<string, unknown>).documentReference,
      updatedRangeRedacted: true,
      recordReference: (storedDocResult.responseSummary as Record<string, unknown>).recordReference,
      recordReferences: (storedDocResult.responseSummary as Record<string, unknown>).recordReferences,
    },
    resultPreviewStored: false,
    resultPreviewSummary: {
      kind: "doc_blocks",
      blockCount: 1,
      previewBlockCount: 1,
    },
  });
  const storedDocSerialized = JSON.stringify(storedDocResult);
  assert.equal(storedDocSerialized.includes("confidential document paragraph"), false);
  assert.equal(storedDocSerialized.includes("tenant_access_token=secret"), false);
  assert.equal(storedDocSerialized.includes("ok doccnSecret recSecret"), false);
  assert.equal(storedDocSerialized.includes("Secret!A1:B2"), false);
  assert.equal(storedDocSerialized.includes("doccnSecret"), false);
  assert.equal(storedDocSerialized.includes("recSecret"), false);
  assert.equal(storedDocSerialized.includes("recAlsoSecret"), false);

  const storedSheetResult = summarizeFeishuStoredDataOperationResultData({
    resultPreview: {
      kind: "sheet_values",
      range: "Plan!A1:B2",
      rowCount: 2,
      columnCount: 2,
      rows: [["Name", "Secret amount"], ["Mina", "999"]],
    },
  });

  assert.deepEqual(storedSheetResult, {
    resultPreviewStored: false,
    resultPreviewSummary: {
      kind: "sheet_values",
      rangeRedacted: true,
      rowCount: 2,
      columnCount: 2,
      previewRowCount: 2,
    },
  });
  assert.equal(JSON.stringify(storedSheetResult).includes("Plan!A1:B2"), false);
  assert.equal(JSON.stringify(storedSheetResult).includes("Secret amount"), false);
  assert.equal(JSON.stringify(storedSheetResult).includes("999"), false);

  const storedBaseResult = summarizeFeishuStoredDataOperationResultData({
    resultPreview: {
      kind: "base_records",
      recordCount: 1,
      records: [
        {
          recordId: "rec-1",
          fieldNames: ["Amount", "Status"],
          fieldsPreview: {
            Amount: "secret amount",
            Status: "Ready",
          },
        },
      ],
    },
  });

  assert.deepEqual(storedBaseResult, {
    resultPreviewStored: false,
    resultPreviewSummary: {
      kind: "base_records",
      recordCount: 1,
      previewRecordCount: 1,
      fieldNames: ["Amount", "Status"],
    },
  });
  assert.equal(JSON.stringify(storedBaseResult).includes("secret amount"), false);
  assert.equal(JSON.stringify(storedBaseResult).includes("Ready"), false);
});

test("summarizes Feishu metadata and schema responses into resource snapshots", () => {
  const docMetadataSummary = summarizeFeishuDataOperationResponse(
    buildRequest({
      operationType: "docs.refresh_metadata",
      providerResourceType: "doc",
      providerResourceToken: "docToken",
    }),
    {
      code: 0,
      data: {
        metas: [
          {
            doc_token: "docToken",
            doc_type: "doc",
            title: "Launch brief",
            owner_id: "ou_owner",
            latest_modify_time: "1652066345",
          },
        ],
      },
    },
  );
  const docSnapshot = docMetadataSummary.resourceMetadataSnapshot as Record<string, unknown>;
  assert.equal(docSnapshot.title, "Launch brief");
  assert.equal(docSnapshot.ownerId, "ou_owner");
  assert.equal(docSnapshot.externalUpdatedAt, "2022-05-09T03:19:05.000Z");
  assert.equal(docSnapshot.syncStatus, "ok");

  const baseSchemaSummary = summarizeFeishuDataOperationResponse(
    buildRequest({
      operationType: "base.read_schema",
      providerResourceType: "base_table",
      providerResourceToken: "tbl123",
      parameters: { appToken: "appToken" },
    }),
    {
      code: 0,
      data: {
        items: [
          {
            field_id: "fldStatus",
            field_name: "Status",
            field_type: "single_select",
            property: {
              options: [{ name: "Ready" }, { name: "Blocked" }],
            },
          },
        ],
      },
    },
  );
  assert.deepEqual(baseSchemaSummary.resourceMetadataSnapshot, {
    title: undefined,
    revisionId: undefined,
    syncStatus: "ok",
    externalUpdatedAt: undefined,
    ownerId: undefined,
    schema: {
      fields: [
        {
          id: "fldStatus",
          name: "Status",
          type: "single_select",
          required: undefined,
          options: ["Ready", "Blocked"],
        },
      ],
    },
  });
});

test("validates Feishu external guest reads against guest-readable current-channel bindings", () => {
  const request = buildRequest({
    operationType: "docs.read_document",
    providerResourceType: "doc",
    providerResourceToken: "docToken",
    parameters: {
      channelName: "travel",
    },
  });
  const actor = {
    actorType: "external_guest" as const,
    providerUserRefHash: "guest-ref-1",
    permissionProfile: "channel_context_only" as const,
    sourceChannelName: "travel",
  };

  assert.deepEqual(validateFeishuAgentSpaceResourceAccessForDataOperation({
    context: {
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      provider: "feishu",
    },
    request,
    binding: buildResourceBinding({
      providerResourceType: "doc",
      providerResourceToken: "docToken",
      permissionsJson: JSON.stringify({ externalGuestReadable: true }),
    }),
    actor,
  }), { ok: true });

  const privateResource = validateFeishuAgentSpaceResourceAccessForDataOperation({
    context: {
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      provider: "feishu",
    },
    request,
    binding: buildResourceBinding({
      providerResourceType: "doc",
      providerResourceToken: "docToken",
      permissionsJson: JSON.stringify({ canRead: true }),
    }),
    actor,
  });
  assert.equal(privateResource.ok, false);
  assert.equal(privateResource.ok ? undefined : privateResource.errorCode, "feishu.data_operation_external_guest_resource_denied");

  const otherChannel = validateFeishuAgentSpaceResourceAccessForDataOperation({
    context: {
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      provider: "feishu",
    },
    request: {
      ...request,
      parameters: {
        channelName: "private-planning",
      },
    },
    binding: buildResourceBinding({
      providerResourceType: "doc",
      providerResourceToken: "docToken",
      permissionsJson: JSON.stringify({ externalGuestReadable: true }),
    }),
    actor,
  });
  assert.equal(otherChannel.ok, false);
  assert.equal(otherChannel.ok ? undefined : otherChannel.errorCode, "feishu.data_operation_external_guest_channel_scope_denied");
});

function buildRequest(
  input: Partial<ExternalDataOperationRequest> & Pick<ExternalDataOperationRequest, "operationType" | "providerResourceType" | "providerResourceToken">,
): ExternalDataOperationRequest {
  return {
    operationType: input.operationType,
    providerResourceType: input.providerResourceType,
    providerResourceToken: input.providerResourceToken,
    actorType: input.actorType ?? "agent",
    actorId: input.actorId ?? "Atlas",
    parameters: input.parameters ?? {},
  };
}

function buildResourceBinding(
  input: Partial<ExternalResourceBindingRecord> & Pick<ExternalResourceBindingRecord, "providerResourceType" | "providerResourceToken">,
): ExternalResourceBindingRecord {
  return {
    id: input.id ?? "external-resource-binding-1",
    workspaceId: input.workspaceId ?? "workspace-1",
    integrationId: input.integrationId ?? "integration-1",
    providerResourceType: input.providerResourceType,
    providerResourceToken: input.providerResourceToken,
    providerResourceUrl: input.providerResourceUrl,
    agentSpaceResourceType: input.agentSpaceResourceType ?? "channel_document",
    agentSpaceResourceId: input.agentSpaceResourceId ?? "document-1",
    channelName: input.channelName ?? "travel",
    displayName: input.displayName,
    status: input.status ?? "active",
    permissionsJson: input.permissionsJson ?? "{}",
    metadataJson: input.metadataJson ?? "{}",
    createdByUserId: input.createdByUserId,
    createdAt: input.createdAt ?? "2026-06-24T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-06-24T00:00:00.000Z",
    archivedAt: input.archivedAt,
  };
}

function buildRun(input: {
  request: ExternalDataOperationRequest;
  requestJson: string;
  resourceBindingId?: string;
}): ExternalDataOperationRunRecord {
  return {
    id: "external-data-operation-run-1",
    workspaceId: "workspace-1",
    integrationId: "integration-1",
    resourceBindingId: input.resourceBindingId,
    operationType: input.request.operationType,
    providerResourceType: input.request.providerResourceType,
    providerResourceToken: input.request.providerResourceToken,
    actorType: input.request.actorType,
    actorId: input.request.actorId,
    status: "pending",
    requestJson: input.requestJson,
    resultJson: "{}",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
  };
}

function buildAccessDependencies(input: {
  canViewChannelDocument?: boolean;
  readDataTable?: ReturnType<FeishuAgentSpaceResourceAccessDependencies["readDataTable"]>;
  canReadChannel?: boolean;
} = {}): FeishuAgentSpaceResourceAccessDependencies {
  return {
    canViewChannelDocument() {
      return input.canViewChannelDocument ?? true;
    },
    readDataTable() {
      if ("readDataTable" in input) {
        return input.readDataTable ?? null;
      }
      return {
        id: "table-1",
        status: "active",
        externalProvider: "feishu",
        externalResourceToken: "sheetToken",
      };
    },
    canReadChannel() {
      return input.canReadChannel ?? true;
    },
  };
}
