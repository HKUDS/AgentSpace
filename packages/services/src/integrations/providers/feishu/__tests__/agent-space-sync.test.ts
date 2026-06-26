import assert from "node:assert/strict";
import test from "node:test";
import type { ExternalResourceBindingRecord } from "@agent-space/db";
import type {
  ChannelDocument,
  ChannelDocumentKind,
  DataTable,
} from "@agent-space/domain/workspace";
import {
  type FeishuExternalChannelDocumentSyncDependencies,
  type FeishuExternalDataTableSyncDependencies,
  type FeishuResourceMetadataSyncDependencies,
  syncFeishuDataTablePreviewFromReadResultWithDependenciesForTests,
  syncFeishuDataTableApprovedWriteResultWithDependenciesForTests,
  syncFeishuResourceMetadataSnapshotWithDependenciesForTests,
  upsertFeishuExternalChannelDocumentWithDependenciesForTests,
  upsertFeishuExternalDataTableWithDependenciesForTests,
} from "../agent-space-sync.ts";

test("creates a Feishu external channel document for a resource binding target", () => {
  const fake = createFakeDocumentSync();

  const result = upsertFeishuExternalChannelDocumentWithDependenciesForTests({
    channelName: "tour visit",
    providerResourceType: "doc",
    providerResourceToken: "doccnTest123",
    providerResourceUrl: "https://example.feishu.cn/docx/doccnTest123",
    title: "Launch brief",
    createdBy: "Tianyu",
    createdByType: "human",
  }, fake.dependencies);

  assert.equal(result.created, true);
  assert.equal(result.document.title, "Launch brief");
  assert.equal(result.document.kind, "document");
  assert.equal(result.document.storageMode, "external");
  assert.equal(result.document.externalProvider, "feishu");
  assert.equal(result.document.externalFileId, "doccnTest123");
  assert.equal(result.document.externalUrl, "https://example.feishu.cn/docx/doccnTest123");
  assert.equal(result.document.externalMimeType, "application/vnd.feishu.doc");
  assert.equal(fake.documents.some((document) => document.id === result.document.id), true);
});

test("reuses matching Feishu external channel documents and rejects mismatched targets", () => {
  const fake = createFakeDocumentSync();

  const created = upsertFeishuExternalChannelDocumentWithDependenciesForTests({
    channelName: "tour visit",
    providerResourceType: "sheet",
    providerResourceToken: "shtcnTest123",
    providerResourceUrl: "https://example.feishu.cn/sheets/shtcnTest123",
    title: "Launch sheet",
    createdBy: "Tianyu",
    createdByType: "human",
  }, fake.dependencies);

  const reused = upsertFeishuExternalChannelDocumentWithDependenciesForTests({
    agentSpaceResourceId: created.document.id,
    providerResourceType: "sheet",
    providerResourceToken: "shtcnTest123",
    providerResourceUrl: "https://example.feishu.cn/sheets/shtcnTest123",
    createdBy: "Tianyu",
    createdByType: "human",
  }, fake.dependencies);

  assert.equal(reused.created, false);
  assert.equal(reused.document.id, created.document.id);
  assert.equal(reused.document.externalMimeType, "application/vnd.feishu.sheet");

  const nativeDocument = fake.createNativeDocument("native-doc-1");
  assert.throws(
    () => upsertFeishuExternalChannelDocumentWithDependenciesForTests({
      agentSpaceResourceId: nativeDocument.id,
      providerResourceType: "doc",
      providerResourceToken: "doccnOther",
      createdBy: "Tianyu",
      createdByType: "human",
    }, fake.dependencies),
    /feishu\.resource_binding\.channel_document_mismatch/,
  );
});

test("creates and reuses Feishu external data tables for sheet and base resources", () => {
  const fake = createFakeDataTableSync();

  const created = upsertFeishuExternalDataTableWithDependenciesForTests({
    channelName: "tour visit",
    providerResourceType: "base_table",
    providerResourceToken: "tblTest123",
    providerResourceUrl: "https://example.feishu.cn/base/appTest123?table=tblTest123",
    title: "Launch base",
    metadata: {
      appToken: "appTest123",
      tableId: "tblTest123",
    },
    createdBy: "Tianyu",
  }, fake.dependencies);

  assert.equal(created.created, true);
  assert.equal(created.table.name, "Launch base");
  assert.equal(created.table.channelName, "tour visit");
  assert.equal(created.table.externalProvider, "feishu");
  assert.equal(created.table.externalResourceType, "base_table");
  assert.equal(created.table.externalResourceToken, "tblTest123");
  assert.deepEqual(created.table.externalMetadata, {
    appToken: "appTest123",
    tableId: "tblTest123",
  });

  const reused = upsertFeishuExternalDataTableWithDependenciesForTests({
    agentSpaceResourceId: created.table.id,
    providerResourceType: "base_table",
    providerResourceToken: "tblTest123",
    providerResourceUrl: "https://example.feishu.cn/base/appTest123?table=tblTest123",
    metadata: {
      appToken: "appTest123",
      tableId: "tblTest123",
      viewId: "vewTest123",
    },
    createdBy: "Tianyu",
  }, fake.dependencies);

  assert.equal(reused.created, false);
  assert.equal(reused.table.id, created.table.id);
  assert.deepEqual(reused.table.externalMetadata, {
    appToken: "appTest123",
    tableId: "tblTest123",
    viewId: "vewTest123",
  });

  const mismatched = fake.createExternalTable("table-other", {
    externalProvider: "feishu",
    externalResourceToken: "shtcnOther",
  });
  assert.throws(
    () => upsertFeishuExternalDataTableWithDependenciesForTests({
      agentSpaceResourceId: mismatched.id,
      providerResourceType: "sheet",
      providerResourceToken: "shtcnTest123",
      createdBy: "Tianyu",
    }, fake.dependencies),
    /feishu\.resource_binding\.data_table_mismatch/,
  );

  assert.throws(
    () => upsertFeishuExternalDataTableWithDependenciesForTests({
      providerResourceType: "doc",
      providerResourceToken: "doccnTest123",
      createdBy: "Tianyu",
    }, fake.dependencies),
    /feishu\.resource_binding\.unsupported_data_table_resource/,
  );
});

test("syncs Feishu sheet and base read previews into external data table metadata", () => {
  const fake = createFakeDataTableSync();
  const sheetTable = fake.createExternalTable("table-sheet", {
    externalResourceType: "sheet",
    externalResourceToken: "shtcnTest123",
  });

  const sheetSync = syncFeishuDataTablePreviewFromReadResultWithDependenciesForTests({
    workspaceId: "workspace-1",
    binding: buildResourceBinding({
      agentSpaceResourceType: "data_table",
      agentSpaceResourceId: sheetTable.id,
      providerResourceType: "sheet",
      providerResourceToken: "shtcnTest123",
      providerResourceUrl: "https://example.feishu.cn/sheets/shtcnTest123",
    }),
    result: {
      ok: true,
      data: {
        resultPreview: {
          kind: "sheet_values",
          rowCount: 3,
          columnCount: 2,
          rows: [["Name", "Score"], ["Atlas", 42]],
        },
      },
    },
  }, fake.previewDependencies);

  assert.equal(sheetSync.synced, true);
  assert.equal(sheetTable.externalProvider, "feishu");
  assert.deepEqual(sheetTable.externalPreview, {
    kind: "sheet_values",
    rowCount: 3,
    columnCount: 2,
    rowsPreview: [["Name", "Score"], ["Atlas", 42]],
    truncated: true,
    updatedAt: "2026-06-24T00:00:00.000Z",
  });

  const baseTable = fake.createExternalTable("table-base", {
    externalResourceType: "base_table",
    externalResourceToken: "tblTest123",
  });
  const baseSync = syncFeishuDataTablePreviewFromReadResultWithDependenciesForTests({
    workspaceId: "workspace-1",
    binding: buildResourceBinding({
      agentSpaceResourceType: "data_table",
      agentSpaceResourceId: baseTable.id,
      providerResourceType: "base_table",
      providerResourceToken: "tblTest123",
    }),
    result: {
      ok: true,
      data: {
        resultPreview: {
          kind: "base_records",
          recordCount: 2,
          records: [
            {
              recordId: "rec1",
              fieldNames: ["Amount", "Status"],
              fieldsPreview: {
                Amount: 42,
                Status: "Ready",
              },
            },
          ],
        },
      },
    },
  }, fake.previewDependencies);

  assert.equal(baseSync.synced, true);
  assert.deepEqual(baseTable.externalPreview, {
    kind: "base_records",
    recordCount: 2,
    fieldNames: ["Amount", "Status"],
    recordsPreview: [
      {
        recordId: "rec1",
        fieldsPreview: {
          Amount: 42,
          Status: "Ready",
        },
      },
    ],
    truncated: true,
    updatedAt: "2026-06-24T00:00:00.000Z",
  });

  const skipped = syncFeishuDataTablePreviewFromReadResultWithDependenciesForTests({
    workspaceId: "workspace-1",
    binding: buildResourceBinding({
      agentSpaceResourceType: "channel_document",
      agentSpaceResourceId: "doc-1",
      providerResourceType: "sheet",
      providerResourceToken: "shtcnTest123",
    }),
    result: {
      ok: true,
      data: {
        resultPreview: {
          kind: "sheet_values",
          rows: [],
        },
      },
    },
  }, fake.previewDependencies);

  assert.deepEqual(skipped, {
    synced: false,
    reasonCode: "feishu.data_table_preview_not_bound_to_table",
  });
});

test("syncs approved Feishu data table writes as safe metadata summaries", () => {
  const fake = createFakeDataTableSync();
  const table = fake.createExternalTable("table-sheet", {
    externalResourceType: "sheet",
    externalResourceToken: "shtcnTest123",
    externalMetadata: {
      appToken: "appTest123",
      tableId: "tblTest123",
    },
  });

  const synced = syncFeishuDataTableApprovedWriteResultWithDependenciesForTests({
    workspaceId: "workspace-1",
    binding: buildResourceBinding({
      agentSpaceResourceType: "data_table",
      agentSpaceResourceId: table.id,
      providerResourceType: "sheet",
      providerResourceToken: "shtcnTest123",
      providerResourceUrl: "https://example.feishu.cn/sheets/shtcnTest123",
    }),
    operationType: "sheets.update_range",
    runId: "run-1",
    approvalId: "approval-1",
    payloadHash: "payload-hash-1",
    result: {
      ok: true,
      data: {
        policyDecision: "approved",
        responseSummary: {
          code: "app_secret=should-not-store",
          msg: "ok doccnShouldNotStore recShouldNotStore",
          hasData: true,
          itemCount: 1,
          revision: 17,
          updatedRange: "SecretSheet!A1:B2",
          updatedRows: 2,
          updatedColumns: 2,
          updatedCells: 4,
          documentId: "doccnShouldNotStore",
          recordId: "recShouldNotStore",
          recordIds: ["recShouldNotStore", "recAlsoHidden"],
        },
      },
    },
  }, fake.approvedWriteDependencies);

  assert.equal(synced.synced, true);
  assert.deepEqual(table.externalMetadata?.appToken, "appTest123");
  const lastApprovedWrite = table.externalMetadata?.lastApprovedWrite as Record<string, unknown>;
  assert.equal(lastApprovedWrite.operationType, "sheets.update_range");
  assert.equal(lastApprovedWrite.runId, "run-1");
  assert.equal(lastApprovedWrite.approvalId, "approval-1");
  assert.equal(lastApprovedWrite.payloadHash, "payload-hash-1");
  assert.equal(lastApprovedWrite.policyDecision, "approved");
  assert.equal(lastApprovedWrite.code, "[string-code]");
  assert.equal(lastApprovedWrite.updatedRangeRedacted, true);
  assert.equal(lastApprovedWrite.updatedRows, 2);
  assert.equal(typeof lastApprovedWrite.documentReference, "string");
  assert.equal(typeof lastApprovedWrite.recordReference, "string");
  assert.ok(Array.isArray(lastApprovedWrite.recordReferences));
  const stored = JSON.stringify(table.externalMetadata);
  assert.equal(stored.includes("SecretSheet!A1:B2"), false);
  assert.equal(stored.includes("doccnShouldNotStore"), false);
  assert.equal(stored.includes("recShouldNotStore"), false);
  assert.equal(stored.includes("recAlsoHidden"), false);
  assert.equal(stored.includes("ok doccnShouldNotStore"), false);
  assert.equal(stored.includes("should-not-store"), false);
});

test("syncs Feishu metadata snapshots into channel documents and data tables", () => {
  const fakeDocuments = createFakeDocumentSync();
  const createdDocument = upsertFeishuExternalChannelDocumentWithDependenciesForTests({
    channelName: "tour visit",
    providerResourceType: "doc",
    providerResourceToken: "doccnTest123",
    providerResourceUrl: "https://example.feishu.cn/docx/doccnTest123",
    title: "Launch brief",
    createdBy: "Tianyu",
    createdByType: "human",
  }, fakeDocuments.dependencies);
  const fakeTables = createFakeDataTableSync();
  const table = fakeTables.createExternalTable("table-base", {
    externalResourceType: "base_table",
    externalResourceToken: "tblTest123",
    externalMetadata: {
      appToken: "appTest123",
    },
  });
  const metadataDependencies: FeishuResourceMetadataSyncDependencies = {
    updateExternalChannelDocumentMetadata: fakeDocuments.dependencies.updateExternalChannelDocumentMetadata,
    updateExternalDataTableMetadata: fakeTables.dependencies.updateExternalDataTableMetadata,
  };

  const documentSync = syncFeishuResourceMetadataSnapshotWithDependenciesForTests({
    workspaceId: "workspace-1",
    binding: buildResourceBinding({
      agentSpaceResourceType: "channel_document",
      agentSpaceResourceId: createdDocument.document.id,
      providerResourceType: "doc",
      providerResourceToken: "doccnTest123",
    }),
    response: {
      code: 0,
      data: {
        document: {
          title: "Launch brief v2",
          revision_id: "rev-2",
          updatedAt: "2026-06-23T21:20:00.000Z",
          owner_id: "ou_owner",
        },
      },
    },
  }, metadataDependencies);

  assert.equal(documentSync.synced, true);
  assert.equal(createdDocument.document.title, "Launch brief v2");
  assert.equal(createdDocument.document.externalRevisionId, "rev-2");
  assert.equal(createdDocument.document.externalSyncStatus, "ok");
  assert.equal(createdDocument.document.externalUpdatedAt, "2026-06-23T21:20:00.000Z");

  const tableSync = syncFeishuResourceMetadataSnapshotWithDependenciesForTests({
    workspaceId: "workspace-1",
    binding: buildResourceBinding({
      agentSpaceResourceType: "data_table",
      agentSpaceResourceId: table.id,
      providerResourceType: "base_table",
      providerResourceToken: "tblTest123",
      providerResourceUrl: "https://example.feishu.cn/base/appTest123?table=tblTest123",
      metadataJson: JSON.stringify({ appToken: "appTest123", tableId: "tblTest123" }),
    }),
    response: {
      code: 0,
      data: {
        table: {
          name: "Launch base v2",
          revision: 8,
        },
        fields: [
          {
            field_id: "fldStatus",
            field_name: "Status",
            type: "single_select",
            property: {
              options: [{ name: "Ready" }, { name: "Blocked" }],
            },
          },
        ],
      },
    },
  }, metadataDependencies);

  assert.equal(tableSync.synced, true);
  assert.equal(table.name, "Launch base v2");
  assert.deepEqual(table.externalMetadata, {
    appToken: "appTest123",
    tableId: "tblTest123",
    metadataSnapshot: {
      title: "Launch base v2",
      revisionId: "8",
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
    },
  });
});

function createFakeDocumentSync(): {
  documents: ChannelDocument[];
  createNativeDocument(id: string): ChannelDocument;
  dependencies: FeishuExternalChannelDocumentSyncDependencies;
} {
  const documents: ChannelDocument[] = [];
  const now = "2026-06-24T00:00:00.000Z";

  function createNativeDocument(id: string): ChannelDocument {
    const document: ChannelDocument = {
      id,
      channelName: "tour visit",
      title: "Native notes",
      slug: "native-notes",
      kind: "markdown",
      storageMode: "native",
      status: "active",
      currentVersionId: `${id}-version`,
      summary: "Native notes",
      lastEditorType: "human",
      createdBy: "Tianyu",
      updatedBy: "Tianyu",
      createdAt: now,
      updatedAt: now,
    };
    documents.push(document);
    return document;
  }

  const dependencies: FeishuExternalChannelDocumentSyncDependencies = {
    readChannelDocument(documentId) {
      return documents.find((document) => document.id === documentId) ?? null;
    },
    createChannelDocument(input) {
      const id = `doc-${documents.length + 1}`;
      const document: ChannelDocument = {
        id,
        channelName: input.channelName,
        title: input.title,
        slug: input.title.toLowerCase().replace(/\s+/g, "-"),
        kind: (input.kind ?? "markdown") as ChannelDocumentKind,
        storageMode: input.storageMode ?? "native",
        linkedTableId: input.linkedTableId,
        externalProvider: input.externalProvider,
        externalFileId: input.externalFileId,
        externalUrl: input.externalUrl,
        externalRevisionId: input.externalRevisionId,
        status: "active",
        currentVersionId: `${id}-version`,
        summary: input.summary ?? "",
        externalSyncStatus: input.externalSyncStatus,
        externalMimeType: input.externalMimeType,
        externalUpdatedAt: input.externalUpdatedAt,
        lastEditorType: input.createdByType,
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      };
      documents.push(document);
      return { document };
    },
    updateExternalChannelDocumentMetadata(input) {
      const document = documents.find((candidate) => candidate.id === input.documentId);
      assert.ok(document);
      document.title = input.title ?? document.title;
      document.externalRevisionId = input.externalRevisionId ?? document.externalRevisionId;
      document.externalSyncStatus = input.externalSyncStatus ?? document.externalSyncStatus;
      document.externalMimeType = input.externalMimeType ?? document.externalMimeType;
      document.externalUpdatedAt = input.externalUpdatedAt ?? document.externalUpdatedAt;
      document.updatedBy = input.updatedBy ?? document.updatedBy;
      document.updatedAt = now;
      return document;
    },
    now: () => now,
  };

  return {
    documents,
    createNativeDocument,
    dependencies,
  };
}

function createFakeDataTableSync(): {
  tables: DataTable[];
  createExternalTable(id: string, overrides?: Partial<DataTable>): DataTable;
  dependencies: FeishuExternalDataTableSyncDependencies;
  previewDependencies: FeishuExternalDataTableSyncDependencies;
  approvedWriteDependencies: FeishuExternalDataTableSyncDependencies;
} {
  const tables: DataTable[] = [];
  const now = "2026-06-24T00:00:00.000Z";

  function createExternalTable(id: string, overrides: Partial<DataTable> = {}): DataTable {
    const table: DataTable = {
      id,
      name: "External table",
      channelName: "tour visit",
      columns: [],
      rows: [],
      externalProvider: "feishu",
      externalResourceType: "sheet",
      externalResourceToken: "shtcnTest123",
      externalSyncStatus: "ok",
      status: "active",
      createdBy: "Tianyu",
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    tables.push(table);
    return table;
  }

  const dependencies: FeishuExternalDataTableSyncDependencies = {
    readDataTable(tableId) {
      return tables.find((table) => table.id === tableId) ?? null;
    },
    createExternalDataTable(input) {
      return createExternalTable(`table-${tables.length + 1}`, {
        name: input.name,
        channelName: input.channelName,
        columns: [],
        rows: [],
        externalProvider: input.externalProvider,
        externalResourceType: input.externalResourceType,
        externalResourceToken: input.externalResourceToken,
        externalUrl: input.externalUrl,
        externalSyncStatus: input.externalSyncStatus,
        externalUpdatedAt: input.externalUpdatedAt,
        externalMetadata: input.externalMetadata,
        externalPreview: input.externalPreview,
        createdBy: input.createdBy,
      });
    },
    updateExternalDataTableMetadata(tableId, input) {
      const table = tables.find((candidate) => candidate.id === tableId);
      assert.ok(table);
      table.name = input.name ?? table.name;
      table.channelName = input.channelName ?? table.channelName;
      table.externalProvider = input.externalProvider ?? table.externalProvider;
      table.externalResourceType = input.externalResourceType ?? table.externalResourceType;
      table.externalResourceToken = input.externalResourceToken ?? table.externalResourceToken;
      table.externalUrl = input.externalUrl ?? table.externalUrl;
      table.externalSyncStatus = input.externalSyncStatus ?? table.externalSyncStatus;
      table.externalUpdatedAt = input.externalUpdatedAt ?? table.externalUpdatedAt;
      table.externalMetadata = input.externalMetadata ?? table.externalMetadata;
      table.externalPreview = input.externalPreview ?? table.externalPreview;
      table.updatedAt = now;
      return table;
    },
    now: () => now,
  };

  return {
    tables,
    createExternalTable,
    dependencies,
    previewDependencies: dependencies,
    approvedWriteDependencies: dependencies,
  };
}

function buildResourceBinding(input: Partial<ExternalResourceBindingRecord>): ExternalResourceBindingRecord {
  return {
    id: input.id ?? "external-resource-binding-1",
    workspaceId: input.workspaceId ?? "workspace-1",
    integrationId: input.integrationId ?? "integration-1",
    providerResourceType: input.providerResourceType ?? "sheet",
    providerResourceToken: input.providerResourceToken ?? "shtcnTest123",
    providerResourceUrl: input.providerResourceUrl,
    agentSpaceResourceType: input.agentSpaceResourceType ?? "data_table",
    agentSpaceResourceId: input.agentSpaceResourceId ?? "table-1",
    channelName: input.channelName,
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
