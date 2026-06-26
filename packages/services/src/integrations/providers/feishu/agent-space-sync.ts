import type {
  ExternalResourceBindingRecord,
} from "@agent-space/db";
import type {
  ChannelDocument,
  ChannelDocumentEditorType,
  ChannelDocumentKind,
  DataTable,
  DataTableExternalPreview,
} from "@agent-space/domain/workspace";
import type { ExternalDataOperationResult } from "../../core/index.ts";
import {
  createChannelDocumentSync,
  readChannelDocumentSync,
  updateExternalChannelDocumentMetadataSync,
} from "../../../documents/sync.ts";
import {
  createExternalDataTableSync,
  readDataTableSync,
  updateExternalDataTableMetadataSync,
} from "../../../tables/tables.ts";

export interface FeishuExternalChannelDocumentInput {
  channelName?: string;
  agentSpaceResourceId?: string;
  providerResourceType: string;
  providerResourceToken: string;
  providerResourceUrl?: string;
  title?: string;
  externalRevisionId?: string;
  externalUpdatedAt?: string;
  createdBy: string;
  createdByType: ChannelDocumentEditorType;
}

export interface FeishuExternalChannelDocumentSyncResult {
  document: ChannelDocument;
  created: boolean;
}

export interface FeishuExternalDataTableInput {
  channelName?: string;
  agentSpaceResourceId?: string;
  providerResourceType: string;
  providerResourceToken: string;
  providerResourceUrl?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  externalUpdatedAt?: string;
  createdBy: string;
}

export interface FeishuExternalDataTableSyncResult {
  table: DataTable;
  created: boolean;
}

export type FeishuDataTablePreviewSyncResult =
  | {
    synced: true;
    table: DataTable;
    preview: DataTableExternalPreview;
  }
  | {
    synced: false;
    reasonCode: string;
    errorMessage?: string;
  };

export type FeishuApprovedDataTableWriteSyncResult =
  | {
    synced: true;
    table: DataTable;
    lastApprovedWrite: FeishuApprovedDataTableWriteSummary;
  }
  | {
    synced: false;
    reasonCode: string;
    errorMessage?: string;
  };

export interface FeishuApprovedDataTableWriteSummary {
  operationType: string;
  runId: string;
  approvalId?: string;
  payloadHash?: string;
  policyDecision?: string;
  code?: string | number;
  hasData?: boolean;
  itemCount?: number;
  revision?: number;
  updatedRangeRedacted?: boolean;
  updatedRows?: number;
  updatedColumns?: number;
  updatedCells?: number;
  documentReference?: string;
  recordReference?: string;
  recordReferences?: string[];
  updatedAt: string;
}

export interface FeishuResourceMetadataSnapshot {
  title?: string;
  revisionId?: string;
  syncStatus?: "ok" | "permission_error" | "missing" | "unknown";
  externalUpdatedAt?: string;
  ownerId?: string;
  schema?: {
    fields: Array<{
      id?: string;
      name: string;
      type?: string;
      required?: boolean;
      options?: string[];
    }>;
  };
}

export type FeishuResourceMetadataSyncResult =
  | {
    synced: true;
    snapshot: FeishuResourceMetadataSnapshot;
    targetType: "channel_document" | "data_table";
    targetId: string;
  }
  | {
    synced: false;
    reasonCode: string;
    errorMessage?: string;
  };

export interface FeishuExternalChannelDocumentSyncDependencies {
  readChannelDocument(documentId: string, workspaceId?: string): ChannelDocument | null;
  createChannelDocument(
    input: Parameters<typeof createChannelDocumentSync>[0],
    workspaceId?: string,
  ): { document: ChannelDocument };
  updateExternalChannelDocumentMetadata(
    input: Parameters<typeof updateExternalChannelDocumentMetadataSync>[0],
    workspaceId?: string,
  ): ChannelDocument;
  now(): string;
}

export interface FeishuExternalDataTableSyncDependencies {
  readDataTable(tableId: string, workspaceId?: string): DataTable | null;
  createExternalDataTable(
    input: Parameters<typeof createExternalDataTableSync>[0],
    workspaceId?: string,
  ): DataTable;
  updateExternalDataTableMetadata(
    tableId: string,
    input: Parameters<typeof updateExternalDataTableMetadataSync>[1],
    workspaceId?: string,
  ): DataTable;
  now(): string;
}

export interface FeishuDataTablePreviewSyncDependencies {
  updateExternalDataTableMetadata(
    tableId: string,
    input: Parameters<typeof updateExternalDataTableMetadataSync>[1],
    workspaceId?: string,
  ): DataTable;
  now(): string;
}

export interface FeishuApprovedDataTableWriteSyncDependencies {
  readDataTable(tableId: string, workspaceId?: string): DataTable | null;
  updateExternalDataTableMetadata(
    tableId: string,
    input: Parameters<typeof updateExternalDataTableMetadataSync>[1],
    workspaceId?: string,
  ): DataTable;
  now(): string;
}

export interface FeishuResourceMetadataSyncDependencies {
  updateExternalChannelDocumentMetadata(
    input: Parameters<typeof updateExternalChannelDocumentMetadataSync>[0],
    workspaceId?: string,
  ): ChannelDocument;
  updateExternalDataTableMetadata(
    tableId: string,
    input: Parameters<typeof updateExternalDataTableMetadataSync>[1],
    workspaceId?: string,
  ): DataTable;
}

export function upsertFeishuExternalChannelDocumentSync(
  input: FeishuExternalChannelDocumentInput,
  workspaceId?: string,
): FeishuExternalChannelDocumentSyncResult {
  return upsertFeishuExternalChannelDocumentWithDependenciesForTests(input, {
    readChannelDocument: readOptionalChannelDocument,
    createChannelDocument: createChannelDocumentSync,
    updateExternalChannelDocumentMetadata: updateExternalChannelDocumentMetadataSync,
    now: () => new Date().toISOString(),
  }, workspaceId);
}

export function upsertFeishuExternalChannelDocumentWithDependenciesForTests(
  input: FeishuExternalChannelDocumentInput,
  dependencies: FeishuExternalChannelDocumentSyncDependencies,
  workspaceId?: string,
): FeishuExternalChannelDocumentSyncResult {
  const token = input.providerResourceToken.trim();
  if (!token) {
    throw new Error("feishu.resource_binding.invalid_resource");
  }

  const existingDocument = input.agentSpaceResourceId?.trim()
    ? dependencies.readChannelDocument(input.agentSpaceResourceId.trim(), workspaceId)
    : null;
  if (existingDocument) {
    if (
      existingDocument.storageMode !== "external" ||
      existingDocument.externalProvider !== "feishu" ||
      existingDocument.externalFileId !== token
    ) {
      throw new Error("feishu.resource_binding.channel_document_mismatch");
    }
    return {
      document: dependencies.updateExternalChannelDocumentMetadata({
        documentId: existingDocument.id,
        externalRevisionId: input.externalRevisionId,
        externalSyncStatus: "ok",
        externalMimeType: resolveFeishuExternalMimeType(input.providerResourceType),
        externalUpdatedAt: input.externalUpdatedAt ?? dependencies.now(),
        updatedBy: input.createdBy,
      }, workspaceId),
      created: false,
    };
  }

  const channelName = input.channelName?.trim();
  if (!channelName) {
    throw new Error("feishu.resource_binding.missing_channel_document_channel");
  }

  const resourceLabel = resolveFeishuResourceLabel(input.providerResourceType);
  const title = input.title?.trim() || `${resourceLabel} ${token}`;
  const externalUrl = input.providerResourceUrl?.trim() || token;
  const created = dependencies.createChannelDocument({
    channelName,
    title,
    kind: resolveFeishuChannelDocumentKind(input.providerResourceType),
    storageMode: "external",
    contentMarkdown: [
      `${resourceLabel}: ${title}`,
      "",
      externalUrl,
    ].join("\n"),
    summary: `${resourceLabel} external document`,
    externalProvider: "feishu",
    externalFileId: token,
    externalUrl,
    externalRevisionId: input.externalRevisionId?.trim() || undefined,
    externalSyncStatus: "ok",
    externalMimeType: resolveFeishuExternalMimeType(input.providerResourceType),
    externalUpdatedAt: input.externalUpdatedAt?.trim() || dependencies.now(),
    createdBy: input.createdBy,
    createdByType: input.createdByType,
    triggerType: "manual",
  }, workspaceId);

  return {
    document: created.document,
    created: true,
  };
}

export function upsertFeishuExternalDataTableSync(
  input: FeishuExternalDataTableInput,
  workspaceId?: string,
): FeishuExternalDataTableSyncResult {
  return upsertFeishuExternalDataTableWithDependenciesForTests(input, {
    readDataTable: readOptionalDataTable,
    createExternalDataTable: createExternalDataTableSync,
    updateExternalDataTableMetadata: updateExternalDataTableMetadataSync,
    now: () => new Date().toISOString(),
  }, workspaceId);
}

export function upsertFeishuExternalDataTableWithDependenciesForTests(
  input: FeishuExternalDataTableInput,
  dependencies: FeishuExternalDataTableSyncDependencies,
  workspaceId?: string,
): FeishuExternalDataTableSyncResult {
  const token = input.providerResourceToken.trim();
  if (!token || !isFeishuDataTableResourceType(input.providerResourceType)) {
    throw new Error("feishu.resource_binding.unsupported_data_table_resource");
  }

  const existingTable = input.agentSpaceResourceId?.trim()
    ? dependencies.readDataTable(input.agentSpaceResourceId.trim(), workspaceId)
    : null;
  if (existingTable) {
    if (
      existingTable.externalProvider &&
      (existingTable.externalProvider !== "feishu" || existingTable.externalResourceToken !== token)
    ) {
      throw new Error("feishu.resource_binding.data_table_mismatch");
    }
    return {
      table: dependencies.updateExternalDataTableMetadata(existingTable.id, {
        channelName: input.channelName ?? existingTable.channelName,
        externalProvider: "feishu",
        externalResourceType: input.providerResourceType,
        externalResourceToken: token,
        externalUrl: input.providerResourceUrl,
        externalSyncStatus: "ok",
        externalUpdatedAt: input.externalUpdatedAt ?? dependencies.now(),
        externalMetadata: input.metadata,
      }, workspaceId),
      created: false,
    };
  }

  const resourceLabel = resolveFeishuResourceLabel(input.providerResourceType);
  const title = input.title?.trim() || `${resourceLabel} ${token}`;
  return {
    table: dependencies.createExternalDataTable({
      name: title,
      channelName: input.channelName,
      columns: [],
      createdBy: input.createdBy,
      externalProvider: "feishu",
      externalResourceType: input.providerResourceType,
      externalResourceToken: token,
      externalUrl: input.providerResourceUrl,
      externalSyncStatus: "ok",
      externalUpdatedAt: input.externalUpdatedAt?.trim() || dependencies.now(),
      externalMetadata: input.metadata,
    }, workspaceId),
    created: true,
  };
}

export function syncFeishuDataTablePreviewFromReadResultSync(input: {
  workspaceId: string;
  binding: ExternalResourceBindingRecord;
  result: ExternalDataOperationResult;
}): FeishuDataTablePreviewSyncResult {
  return syncFeishuDataTablePreviewFromReadResultWithDependenciesForTests(input, {
    updateExternalDataTableMetadata: updateExternalDataTableMetadataSync,
    now: () => new Date().toISOString(),
  });
}

export function syncFeishuDataTablePreviewFromReadResultWithDependenciesForTests(
  input: {
    workspaceId: string;
    binding: ExternalResourceBindingRecord;
    result: ExternalDataOperationResult;
  },
  dependencies: FeishuDataTablePreviewSyncDependencies,
): FeishuDataTablePreviewSyncResult {
  if (input.binding.agentSpaceResourceType !== "data_table") {
    return {
      synced: false,
      reasonCode: "feishu.data_table_preview_not_bound_to_table",
    };
  }
  if (!input.result.ok) {
    return {
      synced: false,
      reasonCode: "feishu.data_table_preview_result_failed",
    };
  }
  const resultData = asRecord(input.result.data);
  const preview = buildFeishuDataTableExternalPreview(resultData?.resultPreview, dependencies.now());
  if (!preview) {
    return {
      synced: false,
      reasonCode: "feishu.data_table_preview_unavailable",
    };
  }

  try {
    const table = dependencies.updateExternalDataTableMetadata(input.binding.agentSpaceResourceId, {
      externalProvider: "feishu",
      externalResourceType: input.binding.providerResourceType,
      externalResourceToken: input.binding.providerResourceToken,
      externalUrl: input.binding.providerResourceUrl,
      externalSyncStatus: "ok",
      externalUpdatedAt: preview.updatedAt,
      externalPreview: preview,
    }, input.workspaceId);
    return {
      synced: true,
      table,
      preview,
    };
  } catch (error) {
    return {
      synced: false,
      reasonCode: "feishu.data_table_preview_sync_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export function syncFeishuDataTableApprovedWriteResultSync(input: {
  workspaceId: string;
  binding: ExternalResourceBindingRecord;
  operationType: string;
  runId: string;
  result: ExternalDataOperationResult;
  approvalId?: string;
  payloadHash?: string;
}): FeishuApprovedDataTableWriteSyncResult {
  return syncFeishuDataTableApprovedWriteResultWithDependenciesForTests(input, {
    readDataTable: readOptionalDataTable,
    updateExternalDataTableMetadata: updateExternalDataTableMetadataSync,
    now: () => new Date().toISOString(),
  });
}

export function syncFeishuDataTableApprovedWriteResultWithDependenciesForTests(
  input: {
    workspaceId: string;
    binding: ExternalResourceBindingRecord;
    operationType: string;
    runId: string;
    result: ExternalDataOperationResult;
    approvalId?: string;
    payloadHash?: string;
  },
  dependencies: FeishuApprovedDataTableWriteSyncDependencies,
): FeishuApprovedDataTableWriteSyncResult {
  if (input.binding.agentSpaceResourceType !== "data_table") {
    return {
      synced: false,
      reasonCode: "feishu.data_table_write_not_bound_to_table",
    };
  }
  if (!input.result.ok) {
    return {
      synced: false,
      reasonCode: "feishu.data_table_write_result_failed",
    };
  }

  const table = dependencies.readDataTable(input.binding.agentSpaceResourceId, input.workspaceId);
  if (!table) {
    return {
      synced: false,
      reasonCode: "feishu.data_table_write_target_missing",
    };
  }

  const lastApprovedWrite = buildFeishuApprovedDataTableWriteSummary({
    operationType: input.operationType,
    runId: input.runId,
    approvalId: input.approvalId,
    payloadHash: input.payloadHash,
    result: input.result,
    updatedAt: dependencies.now(),
  });

  try {
    const updated = dependencies.updateExternalDataTableMetadata(input.binding.agentSpaceResourceId, {
      externalProvider: "feishu",
      externalResourceType: input.binding.providerResourceType,
      externalResourceToken: input.binding.providerResourceToken,
      externalUrl: input.binding.providerResourceUrl,
      externalSyncStatus: "ok",
      externalUpdatedAt: lastApprovedWrite.updatedAt,
      externalMetadata: {
        ...(asRecord(table.externalMetadata) ?? {}),
        lastApprovedWrite,
      },
    }, input.workspaceId);
    return {
      synced: true,
      table: updated,
      lastApprovedWrite,
    };
  } catch (error) {
    return {
      synced: false,
      reasonCode: "feishu.data_table_write_sync_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export function syncFeishuResourceMetadataSnapshotSync(input: {
  workspaceId: string;
  binding: ExternalResourceBindingRecord;
  response: Record<string, unknown>;
  updatedBy?: string;
}): FeishuResourceMetadataSyncResult {
  const snapshot = summarizeFeishuResourceMetadataSnapshot(input.response);
  if (!snapshot) {
    return {
      synced: false,
      reasonCode: "feishu.resource_metadata_unavailable",
    };
  }
  return syncFeishuResourceMetadataSnapshotWithDependenciesForTests({
    workspaceId: input.workspaceId,
    binding: input.binding,
    snapshot,
    updatedBy: input.updatedBy,
  }, {
    updateExternalChannelDocumentMetadata: updateExternalChannelDocumentMetadataSync,
    updateExternalDataTableMetadata: updateExternalDataTableMetadataSync,
  });
}

export function syncFeishuResourceMetadataSnapshotFromResultSync(input: {
  workspaceId: string;
  binding: ExternalResourceBindingRecord;
  result: ExternalDataOperationResult;
  updatedBy?: string;
}): FeishuResourceMetadataSyncResult {
  if (!input.result.ok) {
    return {
      synced: false,
      reasonCode: "feishu.resource_metadata_result_failed",
    };
  }
  const resultData = asRecord(input.result.data);
  const snapshot = normalizeFeishuResourceMetadataSnapshot(resultData?.resourceMetadataSnapshot);
  if (!snapshot) {
    return {
      synced: false,
      reasonCode: "feishu.resource_metadata_unavailable",
    };
  }
  return syncFeishuResourceMetadataSnapshotWithDependenciesForTests({
    workspaceId: input.workspaceId,
    binding: input.binding,
    snapshot,
    updatedBy: input.updatedBy,
  }, {
    updateExternalChannelDocumentMetadata: updateExternalChannelDocumentMetadataSync,
    updateExternalDataTableMetadata: updateExternalDataTableMetadataSync,
  });
}

export function syncFeishuResourceMetadataSnapshotWithDependenciesForTests(
  input: {
    workspaceId: string;
    binding: ExternalResourceBindingRecord;
    response?: Record<string, unknown>;
    snapshot?: FeishuResourceMetadataSnapshot;
    updatedBy?: string;
  },
  dependencies: FeishuResourceMetadataSyncDependencies,
): FeishuResourceMetadataSyncResult {
  const snapshot = input.snapshot ?? (input.response ? summarizeFeishuResourceMetadataSnapshot(input.response) : undefined);
  if (!snapshot) {
    return {
      synced: false,
      reasonCode: "feishu.resource_metadata_unavailable",
    };
  }

  try {
    if (input.binding.agentSpaceResourceType === "channel_document") {
      dependencies.updateExternalChannelDocumentMetadata({
        documentId: input.binding.agentSpaceResourceId,
        title: snapshot.title,
        externalRevisionId: snapshot.revisionId,
        externalSyncStatus: snapshot.syncStatus,
        externalUpdatedAt: snapshot.externalUpdatedAt,
        updatedBy: input.updatedBy ?? "Feishu",
      }, input.workspaceId);
      return {
        synced: true,
        snapshot,
        targetType: "channel_document",
        targetId: input.binding.agentSpaceResourceId,
      };
    }
    if (input.binding.agentSpaceResourceType === "data_table") {
      const bindingMetadata = readJsonObject(input.binding.metadataJson);
      dependencies.updateExternalDataTableMetadata(input.binding.agentSpaceResourceId, {
        name: snapshot.title,
        externalProvider: "feishu",
        externalResourceType: input.binding.providerResourceType,
        externalResourceToken: input.binding.providerResourceToken,
        externalUrl: input.binding.providerResourceUrl,
        externalSyncStatus: snapshot.syncStatus,
        externalUpdatedAt: snapshot.externalUpdatedAt,
        externalMetadata: {
          ...bindingMetadata,
          metadataSnapshot: snapshot,
        },
      }, input.workspaceId);
      return {
        synced: true,
        snapshot,
        targetType: "data_table",
        targetId: input.binding.agentSpaceResourceId,
      };
    }
    return {
      synced: false,
      reasonCode: "feishu.resource_metadata_unsupported_agent_space_resource",
    };
  } catch (error) {
    return {
      synced: false,
      reasonCode: "feishu.resource_metadata_sync_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export function summarizeFeishuResourceMetadataSnapshot(
  response: Record<string, unknown>,
): FeishuResourceMetadataSnapshot | undefined {
  const snapshot = buildFeishuResourceMetadataSnapshot(response);
  return hasFeishuResourceMetadataSnapshotContent(snapshot) ? snapshot : undefined;
}

function normalizeFeishuResourceMetadataSnapshot(value: unknown): FeishuResourceMetadataSnapshot | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const schema = normalizeFeishuResourceMetadataSchema(record.schema);
  const snapshot: FeishuResourceMetadataSnapshot = {
    title: readString(record, "title"),
    revisionId: readString(record, "revisionId"),
    syncStatus: normalizeFeishuMetadataSyncStatus(record.syncStatus),
    externalUpdatedAt: readString(record, "externalUpdatedAt"),
    ownerId: readString(record, "ownerId"),
    schema,
  };
  return hasFeishuResourceMetadataSnapshotContent(snapshot) ? snapshot : undefined;
}

function normalizeFeishuResourceMetadataSchema(value: unknown): FeishuResourceMetadataSnapshot["schema"] {
  const schema = asRecord(value);
  const fields = schema?.fields;
  if (!Array.isArray(fields)) {
    return undefined;
  }
  const normalizedFields: NonNullable<FeishuResourceMetadataSnapshot["schema"]>["fields"] = [];
  for (const item of fields) {
    const field = asRecord(item);
    const name = readString(field, "name");
    if (!name) {
      continue;
    }
    normalizedFields.push({
      id: readString(field, "id"),
      name,
      type: readString(field, "type"),
      required: readBoolean(field, "required"),
      options: readStringArray(field?.options),
    });
  }
  return normalizedFields.length > 0 ? { fields: normalizedFields } : undefined;
}

function normalizeFeishuMetadataSyncStatus(value: unknown): FeishuResourceMetadataSnapshot["syncStatus"] {
  return value === "ok" || value === "permission_error" || value === "missing" || value === "unknown"
    ? value
    : undefined;
}

function readOptionalChannelDocument(documentId: string | undefined, workspaceId: string | undefined): ChannelDocument | null {
  const id = documentId?.trim();
  if (!id) {
    return null;
  }
  try {
    return readChannelDocumentSync(id, workspaceId).document;
  } catch (error) {
    if (error instanceof Error && error.message.includes(`Channel document "${id}" does not exist.`)) {
      return null;
    }
    throw error;
  }
}

function readOptionalDataTable(tableId: string, workspaceId: string | undefined): DataTable | null {
  return readDataTableSync(tableId, workspaceId) ?? null;
}

function resolveFeishuChannelDocumentKind(providerResourceType: string): ChannelDocumentKind {
  return providerResourceType === "sheet" ? "sheet" : "document";
}

function isFeishuDataTableResourceType(providerResourceType: string): boolean {
  return providerResourceType === "sheet" ||
    providerResourceType === "base" ||
    providerResourceType === "base_table" ||
    providerResourceType === "base_view";
}

function buildFeishuDataTableExternalPreview(value: unknown, updatedAt: string): DataTableExternalPreview | undefined {
  const preview = asRecord(value);
  const kind = readString(preview, "kind");
  if (kind === "sheet_values") {
    const rowsPreview = readNestedRows(preview?.rows);
    return {
      kind,
      rowCount: readNumber(preview, "rowCount"),
      columnCount: readNumber(preview, "columnCount"),
      rowsPreview,
      truncated: isPreviewTruncated(readNumber(preview, "rowCount"), rowsPreview.length),
      updatedAt,
    };
  }
  if (kind === "base_records") {
    const records = readArray(preview, "records");
    const recordsPreview = records.map((item) => {
      const record = asRecord(item);
      return {
        recordId: readString(record, "recordId"),
        fieldsPreview: asRecord(record?.fieldsPreview) ?? {},
      };
    });
    const fieldNames = Array.from(new Set(records.flatMap((item) => {
      const record = asRecord(item);
      const names = record?.fieldNames;
      return Array.isArray(names) ? names.filter((name): name is string => typeof name === "string") : [];
    }))).sort();
    return {
      kind,
      recordCount: readNumber(preview, "recordCount"),
      fieldNames,
      recordsPreview,
      truncated: isPreviewTruncated(readNumber(preview, "recordCount"), recordsPreview.length),
      updatedAt,
    };
  }
  return undefined;
}

function buildFeishuApprovedDataTableWriteSummary(input: {
  operationType: string;
  runId: string;
  approvalId?: string;
  payloadHash?: string;
  result: ExternalDataOperationResult;
  updatedAt: string;
}): FeishuApprovedDataTableWriteSummary {
  const resultData = asRecord(input.result.data);
  const responseSummary = asRecord(resultData?.responseSummary);
  const recordReferences = normalizeFeishuShortReferences(readStringArray(responseSummary?.recordReferences))
    ?? readStringArray(responseSummary?.recordIds)?.map(formatFeishuShortReference);
  return removeUndefinedProperties({
    operationType: input.operationType,
    runId: input.runId,
    approvalId: input.approvalId?.trim() || undefined,
    payloadHash: input.payloadHash?.trim() || undefined,
    policyDecision: readString(resultData, "policyDecision"),
    code: readSafeScalarCode(responseSummary?.code),
    hasData: readBoolean(responseSummary, "hasData"),
    itemCount: readNumber(responseSummary, "itemCount"),
    revision: readNumber(responseSummary, "revision"),
    updatedRangeRedacted: readBoolean(responseSummary, "updatedRangeRedacted") === true ||
      Boolean(readString(responseSummary, "updatedRange")) ||
      undefined,
    updatedRows: readNumber(responseSummary, "updatedRows"),
    updatedColumns: readNumber(responseSummary, "updatedColumns"),
    updatedCells: readNumber(responseSummary, "updatedCells"),
    documentReference: normalizeFeishuShortReference(readString(responseSummary, "documentReference"))
      ?? readLegacyFeishuShortReference(responseSummary, "documentId"),
    recordReference: normalizeFeishuShortReference(readString(responseSummary, "recordReference"))
      ?? readLegacyFeishuShortReference(responseSummary, "recordId"),
    recordReferences,
    updatedAt: input.updatedAt,
  });
}

function readSafeScalarCode(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return "[string-code]";
  }
  return undefined;
}

function formatFeishuShortReference(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `ref_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeFeishuShortReference(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.startsWith("ref_") ? trimmed : formatFeishuShortReference(trimmed);
}

function normalizeFeishuShortReferences(values: string[] | undefined): string[] | undefined {
  const references = values
    ?.map(normalizeFeishuShortReference)
    .filter((value): value is string => Boolean(value));
  return references && references.length > 0 ? references : undefined;
}

function readLegacyFeishuShortReference(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = readString(record, key);
  return value ? formatFeishuShortReference(value) : undefined;
}

function removeUndefinedProperties<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function buildFeishuResourceMetadataSnapshot(response: Record<string, unknown>): FeishuResourceMetadataSnapshot {
  const data = asRecord(response.data) ?? response;
  const firstMeta = readFirstRecord(readArray(data, "metas"));
  const spreadsheet = asRecord(data.spreadsheet);
  const candidates = [
    data,
    firstMeta,
    asRecord(data.document),
    spreadsheet,
    asRecord(spreadsheet?.properties),
    asRecord(data.sheet),
    asRecord(data.app),
    asRecord(data.table),
    asRecord(data.view),
    asRecord(data.meta),
    asRecord(data.metadata),
  ].filter((item): item is Record<string, unknown> => Boolean(item));
  const title = readFirstString(candidates, [
    "title",
    "name",
    "document_title",
    "documentTitle",
    "spreadsheet_title",
    "spreadsheetTitle",
    "table_name",
    "tableName",
  ]);
  const revisionId = readFirstStringOrNumber(candidates, [
    "revision",
    "revision_id",
    "revisionId",
    "rev",
    "version",
    "version_id",
    "versionId",
  ]);
  const externalUpdatedAt = readFirstTimestamp(candidates, [
    "updated_at",
    "updatedAt",
    "update_time",
    "updateTime",
    "modified_time",
    "modifiedTime",
    "last_modified_time",
    "lastModifiedTime",
    "latest_modify_time",
    "latestModifyTime",
  ]);
  const ownerId = readFirstString(candidates, [
    "owner_id",
    "ownerId",
    "owner_user_id",
    "ownerUserId",
    "creator_id",
    "creatorId",
  ]);
  return {
    title,
    revisionId,
    syncStatus: resolveFeishuMetadataSyncStatus(response),
    externalUpdatedAt,
    ownerId,
    schema: buildFeishuBaseSchemaSnapshot(data),
  };
}

function hasFeishuResourceMetadataSnapshotContent(snapshot: FeishuResourceMetadataSnapshot): boolean {
  return Boolean(
    snapshot.title ||
    snapshot.revisionId ||
    snapshot.externalUpdatedAt ||
    snapshot.ownerId ||
    snapshot.schema?.fields.length,
  );
}

function buildFeishuBaseSchemaSnapshot(data: Record<string, unknown>): FeishuResourceMetadataSnapshot["schema"] {
  const fields: NonNullable<FeishuResourceMetadataSnapshot["schema"]>["fields"] = [];
  for (const item of readArray(data, "fields").concat(readArray(data, "items"))) {
    const field = asRecord(item);
    const name = readString(field, "field_name") ??
      readString(field, "fieldName") ??
      readString(field, "name") ??
      readString(field, "title");
    if (!name) {
      continue;
    }
    fields.push({
      id: readString(field, "field_id") ?? readString(field, "fieldId") ?? readString(field, "id"),
      name,
      type: readString(field, "type") ?? readString(field, "field_type") ?? readString(field, "fieldType"),
      required: readBoolean(field, "required"),
      options: readStringArray(asRecord(field?.property)?.options ?? field?.options),
    });
  }
  return fields.length > 0 ? { fields } : undefined;
}

function resolveFeishuMetadataSyncStatus(response: Record<string, unknown>): FeishuResourceMetadataSnapshot["syncStatus"] {
  const code = readNumber(response, "code");
  if (code === undefined || code === 0) {
    return "ok";
  }
  const msg = readString(response, "msg")?.toLocaleLowerCase("en-US") ?? "";
  if (msg.includes("permission") || msg.includes("forbidden")) {
    return "permission_error";
  }
  if (msg.includes("not found") || msg.includes("missing") || msg.includes("deleted")) {
    return "missing";
  }
  return "unknown";
}

function isPreviewTruncated(total: number | undefined, visible: number): boolean {
  return typeof total === "number" && total > visible;
}

function readNestedRows(value: unknown): unknown[][] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((row): row is unknown[] => Array.isArray(row));
}

function readFirstRecord(value: unknown[]): Record<string, unknown> | undefined {
  for (const item of value) {
    const record = asRecord(item);
    if (record) {
      return record;
    }
  }
  return undefined;
}

function readArray(record: Record<string, unknown> | undefined, key: string): unknown[] {
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(record: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function readFirstString(records: Array<Record<string, unknown>>, keys: string[]): string | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = readString(record, key);
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

function readFirstStringOrNumber(records: Array<Record<string, unknown>>, keys: string[]): string | undefined {
  for (const record of records) {
    for (const key of keys) {
      const stringValue = readString(record, key);
      if (stringValue) {
        return stringValue;
      }
      const numberValue = readNumber(record, key);
      if (numberValue !== undefined) {
        return String(numberValue);
      }
    }
  }
  return undefined;
}

function readFirstTimestamp(records: Array<Record<string, unknown>>, keys: string[]): string | undefined {
  for (const record of records) {
    for (const key of keys) {
      const stringValue = readString(record, key);
      if (stringValue) {
        return normalizeTimestampString(stringValue);
      }
      const numberValue = readNumber(record, key);
      if (numberValue !== undefined) {
        const milliseconds = numberValue > 10_000_000_000 ? numberValue : numberValue * 1000;
        return new Date(milliseconds).toISOString();
      }
    }
  }
  return undefined;
}

function normalizeTimestampString(value: string): string {
  if (/^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      const milliseconds = parsed > 10_000_000_000 ? parsed : parsed * 1000;
      return new Date(milliseconds).toISOString();
    }
  }
  return value;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.map((item) => {
    if (typeof item === "string") {
      return item.trim();
    }
    const record = asRecord(item);
    return readString(record, "name") ?? readString(record, "text") ?? readString(record, "value");
  }).filter((item): item is string => Boolean(item));
  return strings.length > 0 ? strings : undefined;
}

function readJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function resolveFeishuResourceLabel(providerResourceType: string): string {
  switch (providerResourceType) {
    case "sheet":
      return "Feishu Sheet";
    case "base":
      return "Feishu Base";
    case "base_table":
      return "Feishu Base Table";
    case "base_view":
      return "Feishu Base View";
    case "docx":
      return "Feishu Docx";
    case "wiki":
      return "Feishu Wiki";
    default:
      return "Feishu Doc";
  }
}

function resolveFeishuExternalMimeType(providerResourceType: string): string {
  switch (providerResourceType) {
    case "sheet":
      return "application/vnd.feishu.sheet";
    case "base":
    case "base_table":
    case "base_view":
      return "application/vnd.feishu.base";
    case "docx":
      return "application/vnd.feishu.docx";
    case "wiki":
      return "application/vnd.feishu.wiki";
    default:
      return "application/vnd.feishu.doc";
  }
}
