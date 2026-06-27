import type {
  ExternalDataOperationPlan,
  ExternalDataOperationPolicyDecision,
  ExternalDataOperationRequest,
  ExternalDataOperationResult,
} from "../../core/index.ts";
import { createHash } from "node:crypto";
import {
  decideAgentActionPolicySync,
  type AgentActionPolicyDecision,
  type AgentActionPolicyInput,
} from "../../../policies/agent-actions.ts";
import type { FeishuApiRequest } from "./client.ts";
import { FEISHU_DATA_OPERATION_DESCRIPTORS } from "./data-plane.ts";
import { summarizeFeishuResourceMetadataSnapshot } from "./agent-space-sync.ts";

export type FeishuDataOperationPolicyDecision = Exclude<ExternalDataOperationPolicyDecision, "approved">;

export interface FeishuDataOperationPlan extends ExternalDataOperationPlan {
  decision: FeishuDataOperationPolicyDecision;
  request?: FeishuApiRequest;
  policyInput?: AgentActionPolicyInput;
  policyDecision?: AgentActionPolicyDecision;
}

export interface FeishuDataOperationPolicyContext {
  workspaceId?: string;
  channelName?: string;
  taskId?: string;
}

const MAX_PREVIEW_ROWS = 5;
const MAX_PREVIEW_COLUMNS = 8;
const MAX_PREVIEW_FIELDS = 10;
const MAX_PREVIEW_TEXT_LENGTH = 160;

export function planFeishuDataOperation(
  request: ExternalDataOperationRequest,
  policyContext?: FeishuDataOperationPolicyContext,
): FeishuDataOperationPlan {
  const descriptor = FEISHU_DATA_OPERATION_DESCRIPTORS.find((item) =>
    item.operationType === request.operationType &&
    item.providerResourceTypes.includes(request.providerResourceType),
  );
  if (!descriptor) {
    return {
      decision: "deny",
      writeOperation: false,
      reasonCode: "unsupported_operation",
    };
  }
  if (descriptor.writeOperation) {
    const policyInput = buildFeishuDataOperationPolicyInput({
      request,
      writeOperation: true,
      policyContext,
    });
    const policyDecision = decideAgentActionPolicySync(policyInput);
    return {
      decision: policyDecision.decision,
      writeOperation: true,
      reasonCode: policyDecision.reasonCode,
      policyInput,
      policyDecision,
    };
  }

  const apiRequest = buildFeishuReadOperationRequest(request);
  if (!apiRequest) {
    return {
      decision: "deny",
      writeOperation: false,
      reasonCode: "invalid_operation_parameters",
    };
  }
  const policyInput = buildFeishuDataOperationPolicyInput({
    request,
    writeOperation: false,
    policyContext,
  });
  const policyDecision = decideAgentActionPolicySync(policyInput);
  if (policyDecision.decision !== "allow") {
    return {
      decision: policyDecision.decision,
      writeOperation: false,
      reasonCode: policyDecision.reasonCode,
      policyInput,
      policyDecision,
    };
  }

  return {
    decision: policyDecision.decision,
    writeOperation: false,
    request: apiRequest,
    reasonCode: policyDecision.reasonCode,
    policyInput,
    policyDecision,
  };
}

export function buildFeishuDataOperationPolicyInput(input: {
  request: ExternalDataOperationRequest;
  writeOperation: boolean;
  policyContext?: FeishuDataOperationPolicyContext;
}): AgentActionPolicyInput {
  const payloadHash = input.writeOperation
    ? buildFeishuDataOperationPayloadHash(input.request)
    : undefined;
  return {
    workspaceId: input.policyContext?.workspaceId
      ?? readStringParameter(input.request, "workspaceId")
      ?? "unknown",
    actor: buildFeishuDataOperationPolicyActor(input.request),
    channelName: input.policyContext?.channelName ?? readStringParameter(input.request, "channelName"),
    taskId: input.policyContext?.taskId ?? readStringParameter(input.request, "taskId"),
    action: {
      type: input.writeOperation ? "external_document.write" : "external_document.read",
      provider: "feishu",
      resourceType: `feishu.${input.request.providerResourceType}`,
      resourceId: input.request.providerResourceToken,
      operationSummary: buildFeishuDataOperationPolicySummary(input.request),
      payloadHash,
      riskLevel: input.writeOperation ? "medium" : "low",
    },
  };
}

function buildFeishuDataOperationPolicyActor(
  request: ExternalDataOperationRequest,
): AgentActionPolicyInput["actor"] {
  const actorId = request.actorId?.trim();
  if (request.actorType === "agent") {
    return {
      type: "agent",
      agentId: actorId || "unknown-agent",
    };
  }
  if (request.actorType === "user") {
    return {
      type: "user",
      userId: actorId || "unknown-user",
    };
  }
  return {
    type: "system",
    systemId: actorId || "agent-space",
  };
}

function buildFeishuDataOperationPolicySummary(request: ExternalDataOperationRequest): string {
  const summary = summarizeFeishuDataOperationRequest(request);
  const target = readString(summary, "range")
    ?? formatFeishuDataOperationResourceReference({
      providerResourceType: request.providerResourceType,
      providerResourceToken: request.providerResourceToken,
      tableId: readString(summary, "tableId"),
    });
  return [
    request.operationType,
    `on Feishu ${request.providerResourceType}`,
    target ? `target ${target}` : undefined,
  ].filter((part): part is string => Boolean(part)).join(" ");
}

function formatFeishuDataOperationResourceReference(input: {
  providerResourceType: string;
  providerResourceToken: string;
  tableId?: string;
}): string {
  const tableId = input.tableId?.trim();
  const token = tableId || input.providerResourceToken.trim();
  const resourceType = tableId && input.providerResourceType === "base"
    ? "base_table"
    : input.providerResourceType.trim() || "resource";
  if (!token) {
    return `${resourceType} / resource`;
  }
  return `${resourceType} / resource ${hashFeishuShortReference(token)}`;
}

function hashFeishuShortReference(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function formatFeishuResponseReference(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? `ref_${hashFeishuShortReference(trimmed)}` : undefined;
}

function normalizeFeishuResponseReference(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.startsWith("ref_") ? trimmed : formatFeishuResponseReference(trimmed);
}

function normalizeFeishuResponseReferences(values: string[] | undefined): string[] | undefined {
  const references = values
    ?.map(normalizeFeishuResponseReference)
    .filter((value): value is string => Boolean(value));
  return references && references.length > 0 ? references : undefined;
}

export function buildFeishuReadOperationRequest(
  request: ExternalDataOperationRequest,
): FeishuApiRequest | null {
  if (request.operationType === "docs.read_document" && request.providerResourceType === "doc") {
    return {
      method: "GET",
      path: `/open-apis/docx/v1/documents/${encodeURIComponent(request.providerResourceToken)}/blocks`,
      query: {
        page_size: readNumberParameter(request, "pageSize"),
        page_token: readStringParameter(request, "pageToken"),
      },
    };
  }

  if (request.operationType === "docs.refresh_metadata" && request.providerResourceType === "doc") {
    return {
      method: "POST",
      path: "/open-apis/drive/v1/metas/batch_query",
      query: {
        user_id_type: readStringParameter(request, "userIdType"),
      },
      body: {
        request_docs: [
          {
            doc_token: request.providerResourceToken,
            doc_type: readStringParameter(request, "docType") ?? "doc",
          },
        ],
        with_url: true,
      },
    };
  }

  if (request.operationType === "sheets.read_range" && request.providerResourceType === "sheet") {
    const range = readStringParameter(request, "range");
    if (!range) {
      return null;
    }
    return {
      method: "GET",
      path: `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(request.providerResourceToken)}/values/${encodeURIComponent(range)}`,
    };
  }

  if (request.operationType === "sheets.refresh_metadata" && request.providerResourceType === "sheet") {
    return {
      method: "GET",
      path: `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(request.providerResourceToken)}/metainfo`,
    };
  }

  if (
    request.operationType === "base.query_records" &&
    (request.providerResourceType === "base" || request.providerResourceType === "base_table" || request.providerResourceType === "base_view")
  ) {
    const appToken = request.providerResourceType === "base"
      ? request.providerResourceToken
      : readStringParameter(request, "appToken");
    const tableId = request.providerResourceType === "base_table"
      ? request.providerResourceToken
      : readStringParameter(request, "tableId");
    const viewId = readStringParameter(request, "viewId");
    if (!appToken || !tableId) {
      return null;
    }
    return {
      method: "GET",
      path: `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records`,
      query: {
        page_size: readNumberParameter(request, "pageSize"),
        page_token: readStringParameter(request, "pageToken"),
        view_id: viewId,
      },
    };
  }

  if (
    request.operationType === "base.read_schema" &&
    (request.providerResourceType === "base" || request.providerResourceType === "base_table" || request.providerResourceType === "base_view")
  ) {
    const appToken = request.providerResourceType === "base"
      ? request.providerResourceToken
      : readStringParameter(request, "appToken");
    const tableId = request.providerResourceType === "base_table"
      ? request.providerResourceToken
      : readStringParameter(request, "tableId");
    if (!appToken || !tableId) {
      return null;
    }
    return {
      method: "GET",
      path: `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields`,
      query: {
        page_size: readNumberParameter(request, "pageSize"),
        page_token: readStringParameter(request, "pageToken"),
      },
    };
  }

  return null;
}

export function buildFeishuWriteOperationRequest(
  request: ExternalDataOperationRequest,
): FeishuApiRequest | null {
  if (request.operationType === "docs.create_document" && request.providerResourceType === "doc") {
    return buildFeishuDocsCreateRequest(request);
  }

  if (request.operationType === "docs.update_document" && request.providerResourceType === "doc") {
    return buildFeishuDocsMutationRequest(request);
  }

  if (request.operationType === "sheets.update_range" && request.providerResourceType === "sheet") {
    const range = readStringParameter(request, "range");
    const values = readNestedArrayParameter(request, "values");
    if (!range || !values) {
      return null;
    }
    return {
      method: "PUT",
      path: `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(request.providerResourceToken)}/values`,
      body: {
        valueRange: {
          range,
          values,
        },
      },
    };
  }

  if (
    request.operationType === "base.mutate_records" &&
    (request.providerResourceType === "base" || request.providerResourceType === "base_table")
  ) {
    return buildFeishuBaseMutationRequest(request);
  }

  return null;
}

export function buildFeishuBlockedOperationResult(input: {
  decision: FeishuDataOperationPolicyDecision;
  reasonCode: string;
}): ExternalDataOperationResult {
  return {
    ok: false,
    errorCode: input.reasonCode,
    errorMessage: input.decision === "require_approval"
      ? "Feishu write operations require AgentSpace approval before execution."
      : "Feishu data operation is not allowed.",
    data: {
      policyDecision: input.decision,
    },
  };
}

export function buildFeishuDataOperationPayloadHash(request: ExternalDataOperationRequest): string {
  return createHash("sha256")
    .update(stableStringify({
      operationType: request.operationType,
      providerResourceType: request.providerResourceType,
      providerResourceToken: request.providerResourceToken,
      parameters: request.parameters,
    }))
    .digest("hex");
}

export function summarizeFeishuDataOperationRequest(request: ExternalDataOperationRequest): Record<string, unknown> {
  const parameterKeys = Object.keys(request.parameters).sort();
  return {
    operationType: request.operationType,
    providerResourceType: request.providerResourceType,
    providerResourceToken: request.providerResourceToken,
    parameterKeys,
    range: readStringParameter(request, "range"),
    appToken: readStringParameter(request, "appToken"),
    tableId: readStringParameter(request, "tableId"),
    viewId: readStringParameter(request, "viewId"),
    mutation: readStringParameter(request, "mutation") ?? readStringParameter(request, "action"),
    parentBlockId: readStringParameter(request, "parentBlockId"),
    blockId: readStringParameter(request, "blockId"),
    folderToken: readStringParameter(request, "folderToken") ?? readStringParameter(request, "folder_token"),
    hasTitle: Boolean(readStringParameter(request, "title")),
    titleLength: readStringParameter(request, "title")?.length,
    rowCount: countArrayParameter(request, "rows") ?? countNestedArrayParameter(request, "values"),
    recordCount: countArrayParameter(request, "records"),
    blockCount: countArrayParameter(request, "blocks"),
    requestCount: countArrayParameter(request, "requests"),
    fieldNames: readFieldNames(request),
  };
}

export function summarizeFeishuStoredDataOperationRequest(request: ExternalDataOperationRequest): Record<string, unknown> {
  const summary = summarizeFeishuDataOperationRequest(request);
  const providerResourceType = readString(summary, "providerResourceType");
  const providerResourceToken = readString(summary, "providerResourceToken");
  if (providerResourceType && providerResourceToken) {
    summary.providerResourceReference = formatFeishuDataOperationResourceReference({
      providerResourceType,
      providerResourceToken,
      tableId: readString(summary, "tableId"),
    });
    summary.providerResourceTokenRedacted = true;
  }
  delete summary.providerResourceToken;
  delete summary.appToken;
  delete summary.tableId;
  delete summary.viewId;
  delete summary.folderToken;
  delete summary.parentBlockId;
  delete summary.blockId;
  return summary;
}

export function summarizeFeishuStoredDataOperationGovernanceContext(
  request: ExternalDataOperationRequest,
): Record<string, unknown> | undefined {
  const governance = readRecordParameter(request, "feishuGovernance")
    ?? readRecordParameter(request, "governanceContext");
  if (!governance) {
    return undefined;
  }
  const actorType = normalizeFeishuGovernanceActorType(readString(governance, "actorType"));
  const context = removeUndefinedProperties({
    provider: "feishu",
    agentId: readString(governance, "agentId"),
    botBindingId: readString(governance, "botBindingId"),
    channelName: readString(governance, "channelName"),
    actorType,
    actorUserId: actorType === "user" ? readString(governance, "actorUserId") : undefined,
    externalActorReference: readString(governance, "externalActorReference")
      ?? readString(governance, "externalGuestReference"),
    externalGuestPermissionProfile: actorType === "external_guest"
      ? readString(governance, "externalGuestPermissionProfile")
      : undefined,
    externalGuestRequireIdentityFor: actorType === "external_guest"
      ? readStringArray(governance.externalGuestRequireIdentityFor)
      : undefined,
    externalGuestResourceAccess: actorType === "external_guest"
      ? readString(governance, "externalGuestResourceAccess")
      : undefined,
    externalChatReference: readString(governance, "externalChatReference"),
    resourceReference: formatFeishuDataOperationResourceReference({
      providerResourceType: request.providerResourceType,
      providerResourceToken: request.providerResourceToken,
      tableId: readStringParameter(request, "tableId"),
    }),
    resourceIdRedacted: true,
  });
  return Object.keys(context).length > 1 ? context : undefined;
}

export function summarizeFeishuStoredDataOperationPolicyInput(
  policyInput: AgentActionPolicyInput | undefined,
  request: ExternalDataOperationRequest,
): AgentActionPolicyInput | undefined {
  if (!policyInput) {
    return undefined;
  }
  const action = { ...policyInput.action } as Record<string, unknown>;
  const resourceId = readString(action, "resourceId");
  if (resourceId) {
    action.resourceReference = formatFeishuDataOperationResourceReference({
      providerResourceType: request.providerResourceType,
      providerResourceToken: resourceId,
      tableId: readStringParameter(request, "tableId"),
    });
    action.resourceIdRedacted = true;
    delete action.resourceId;
  }
  return {
    ...policyInput,
    action: action as AgentActionPolicyInput["action"],
  };
}

export function summarizeFeishuStoredDataOperationPolicyDecision(
  policyDecision: AgentActionPolicyDecision | undefined,
  request: ExternalDataOperationRequest,
): AgentActionPolicyDecision | undefined {
  if (!policyDecision) {
    return undefined;
  }
  const auditData = sanitizeFeishuStoredDataOperationPolicyAuditData(policyDecision.auditData, request);
  return {
    ...policyDecision,
    ...(auditData ? { auditData } : {}),
  };
}

function sanitizeFeishuStoredDataOperationPolicyAuditData(
  auditData: Record<string, unknown> | undefined,
  request: ExternalDataOperationRequest,
): Record<string, unknown> | undefined {
  if (!auditData) {
    return undefined;
  }
  const sanitized = { ...auditData };
  const resourceId = readString(sanitized, "resourceId");
  if (resourceId) {
    sanitized.resourceReference = formatFeishuDataOperationResourceReference({
      providerResourceType: request.providerResourceType,
      providerResourceToken: resourceId,
      tableId: readStringParameter(request, "tableId"),
    });
    sanitized.resourceIdRedacted = true;
    delete sanitized.resourceId;
  }
  return sanitized;
}

export function summarizeFeishuOperationResponse(response: Record<string, unknown>): Record<string, unknown> {
  const data = asRecord(response.data);
  const record = asRecord(data?.record);
  const document = asRecord(data?.document);
  return sanitizeFeishuOperationResponseSummary({
    code: response.code,
    messageRedacted: hasPresentValue(response.msg) ? true : undefined,
    hasData: Boolean(data),
    itemCount: countKnownItems(data ?? response),
    documentReference: formatFeishuResponseReference(readString(document, "document_id") ?? readString(document, "documentId")),
    revision: readNumber(data, "revision"),
    updatedRangeRedacted: readString(data, "updatedRange") ? true : undefined,
    updatedRows: readNumber(data, "updatedRows"),
    updatedColumns: readNumber(data, "updatedColumns"),
    updatedCells: readNumber(data, "updatedCells"),
    recordReference: formatFeishuResponseReference(readString(record, "id") ?? readString(record, "record_id")),
    recordReferences: readRecordIds(data)?.map(formatFeishuResponseReference).filter((value): value is string => Boolean(value)),
  }) ?? {};
}

export function sanitizeFeishuOperationResponseSummary(
  summary: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!summary) {
    return undefined;
  }
  const rawRecordReferences = readStringArray(summary.recordReferences);
  const rawRecordIds = readStringArray(summary.recordIds);
  const recordReferences = normalizeFeishuResponseReferences(rawRecordReferences)
    ?? rawRecordIds?.map(formatFeishuResponseReference).filter((value): value is string => Boolean(value));
  return removeUndefinedProperties({
    code: readSafeResponseCode(summary.code),
    messageRedacted: (readBoolean(summary, "messageRedacted") === true || hasPresentValue(summary.msg)) ? true : undefined,
    hasData: readBoolean(summary, "hasData"),
    itemCount: readNumber(summary, "itemCount"),
    documentReference: normalizeFeishuResponseReference(readString(summary, "documentReference"))
      ?? formatFeishuResponseReference(readString(summary, "documentId")),
    revision: readNumber(summary, "revision"),
    updatedRangeRedacted: readBoolean(summary, "updatedRangeRedacted") === true || Boolean(readString(summary, "updatedRange"))
      ? true
      : undefined,
    updatedRows: readNumber(summary, "updatedRows"),
    updatedColumns: readNumber(summary, "updatedColumns"),
    updatedCells: readNumber(summary, "updatedCells"),
    recordReference: normalizeFeishuResponseReference(readString(summary, "recordReference"))
      ?? formatFeishuResponseReference(readString(summary, "recordId")),
    recordReferences,
  });
}

export function summarizeFeishuDataOperationResponse(
  request: ExternalDataOperationRequest,
  response: Record<string, unknown>,
): Record<string, unknown> {
  const preview = buildFeishuDataOperationPreview(request, response);
  const metadataSnapshot = summarizeFeishuResourceMetadataSnapshot(response);
  return {
    responseSummary: summarizeFeishuOperationResponse(response),
    ...(preview ? { resultPreview: preview } : {}),
    ...(metadataSnapshot ? { resourceMetadataSnapshot: metadataSnapshot } : {}),
  };
}

export function summarizeFeishuStoredDataOperationResultData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const responseSummary = sanitizeFeishuOperationResponseSummary(asRecord(data.responseSummary));
  const resultPreview = asRecord(data.resultPreview);
  const { responseSummary: _responseSummary, resultPreview: _resultPreview, ...storedData } = data;
  return {
    ...storedData,
    ...(responseSummary ? { responseSummary } : {}),
    ...(resultPreview
      ? {
        resultPreviewStored: false,
        resultPreviewSummary: summarizeFeishuStoredResultPreview(resultPreview),
      }
      : {}),
  };
}

function summarizeFeishuStoredResultPreview(preview: Record<string, unknown>): Record<string, unknown> {
  const kind = readString(preview, "kind");
  if (kind === "doc_blocks") {
    return {
      kind,
      blockCount: readNumber(preview, "blockCount"),
      previewBlockCount: readArray(preview, "blocks")?.length,
    };
  }
  if (kind === "sheet_values") {
    const range = readString(preview, "range");
    return {
      kind,
      ...(range ? { rangeRedacted: true } : {}),
      rowCount: readNumber(preview, "rowCount"),
      columnCount: readNumber(preview, "columnCount"),
      previewRowCount: readArray(preview, "rows")?.length,
    };
  }
  if (kind === "base_records") {
    const records = readArray(preview, "records");
    return {
      kind,
      recordCount: readNumber(preview, "recordCount"),
      previewRecordCount: records?.length,
      fieldNames: summarizePreviewFieldNames(records),
    };
  }
  return {
    kind,
    previewKeys: Object.keys(preview).sort().slice(0, MAX_PREVIEW_FIELDS),
  };
}

function buildFeishuDataOperationPreview(
  request: ExternalDataOperationRequest,
  response: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (request.operationType === "docs.read_document") {
    return buildFeishuDocsBlocksPreview(response);
  }
  if (request.operationType === "sheets.read_range") {
    return buildFeishuSheetValuesPreview(request, response);
  }
  if (request.operationType === "base.query_records") {
    return buildFeishuBaseRecordsPreview(response);
  }
  return undefined;
}

function buildFeishuDocsBlocksPreview(response: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = asRecord(response.data) ?? response;
  const items = readArray(data, "items") ?? readArray(data, "blocks");
  if (!items) {
    return undefined;
  }
  return {
    kind: "doc_blocks",
    blockCount: items.length,
    blocks: items.slice(0, MAX_PREVIEW_ROWS).map((item) => {
      const block = asRecord(item) ?? {};
      return {
        blockId: readString(block, "block_id") ?? readString(block, "id"),
        blockType: readString(block, "block_type") ?? readString(block, "type"),
        textPreview: truncatePreviewText(extractTextPreview(block)),
      };
    }),
  };
}

function buildFeishuSheetValuesPreview(
  request: ExternalDataOperationRequest,
  response: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const data = asRecord(response.data) ?? response;
  const valueRange = asRecord(data.valueRange) ?? asRecord(data.value_range) ?? data;
  const values = readArray(valueRange, "values");
  if (!values) {
    return undefined;
  }
  const rows = values
    .slice(0, MAX_PREVIEW_ROWS)
    .map((row) => Array.isArray(row)
      ? row.slice(0, MAX_PREVIEW_COLUMNS).map(normalizePreviewValue)
      : [normalizePreviewValue(row)]);
  return {
    kind: "sheet_values",
    range: readString(valueRange, "range") ?? readStringParameter(request, "range"),
    rowCount: values.length,
    columnCount: values.reduce<number>((max, row) => Math.max(max, Array.isArray(row) ? row.length : 1), 0),
    rows,
  };
}

function buildFeishuBaseRecordsPreview(response: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = asRecord(response.data) ?? response;
  const records = readArray(data, "items") ?? readArray(data, "records");
  if (!records) {
    return undefined;
  }
  return {
    kind: "base_records",
    recordCount: records.length,
    records: records.slice(0, MAX_PREVIEW_ROWS).map((item) => {
      const record = asRecord(item) ?? {};
      const fields = asRecord(record.fields) ?? {};
      const fieldNames = Object.keys(fields).sort().slice(0, MAX_PREVIEW_FIELDS);
      return {
        recordId: readString(record, "record_id") ?? readString(record, "id"),
        fieldNames,
        fieldsPreview: Object.fromEntries(fieldNames.map((fieldName) => [
          fieldName,
          normalizePreviewValue(fields[fieldName]),
        ])),
      };
    }),
  };
}

function buildFeishuDocsCreateRequest(request: ExternalDataOperationRequest): FeishuApiRequest | null {
  const title = readStringParameter(request, "title");
  if (!title) {
    return null;
  }
  const folderToken = readStringParameter(request, "folderToken")
    ?? readStringParameter(request, "folder_token")
    ?? resolveCreateDocumentFolderTokenFallback(request.providerResourceToken);
  return {
    method: "POST",
    path: "/open-apis/docx/v1/documents",
    body: {
      ...(folderToken ? { folder_token: folderToken } : {}),
      title,
    },
  };
}

function resolveCreateDocumentFolderTokenFallback(providerResourceToken: string): string | undefined {
  const token = providerResourceToken.trim();
  return token && token !== "new" && token !== "__new__" ? token : undefined;
}

function buildFeishuDocsMutationRequest(request: ExternalDataOperationRequest): FeishuApiRequest | null {
  const query = buildFeishuDocumentMutationQuery(request);
  const mutation = readStringParameter(request, "mutation")
    ?? readStringParameter(request, "action")
    ?? inferDocsMutationType(request);
  if (mutation === "append" || mutation === "append_blocks" || mutation === "create" || mutation === "create_blocks") {
    const parentBlockId = readStringParameter(request, "parentBlockId")
      ?? readStringParameter(request, "parent_block_id")
      ?? readStringParameter(request, "blockId")
      ?? request.providerResourceToken;
    const children = readRecordArrayParameter(request, "children")
      ?? readRecordArrayParameter(request, "blocks");
    if (!parentBlockId || !children) {
      return null;
    }
    return {
      method: "POST",
      path: `/open-apis/docx/v1/documents/${encodeURIComponent(request.providerResourceToken)}/blocks/${encodeURIComponent(parentBlockId)}/children`,
      query,
      body: {
        children,
        index: readNumberParameter(request, "index") ?? -1,
      },
    };
  }

  if (mutation === "update" || mutation === "update_block") {
    const blockId = readStringParameter(request, "blockId") ?? readStringParameter(request, "block_id");
    const block = readRecordParameter(request, "block")
      ?? readRecordParameter(request, "update")
      ?? readRecordParameter(request, "body");
    if (!blockId || !block) {
      return null;
    }
    return {
      method: "PATCH",
      path: `/open-apis/docx/v1/documents/${encodeURIComponent(request.providerResourceToken)}/blocks/${encodeURIComponent(blockId)}`,
      query,
      body: block,
    };
  }

  if (mutation === "batch_update" || mutation === "batch_update_blocks") {
    const requests = readRecordArrayParameter(request, "requests");
    if (!requests) {
      return null;
    }
    return {
      method: "PATCH",
      path: `/open-apis/docx/v1/documents/${encodeURIComponent(request.providerResourceToken)}/blocks/batch_update`,
      query,
      body: {
        requests,
      },
    };
  }

  return null;
}

function buildFeishuDocumentMutationQuery(request: ExternalDataOperationRequest): FeishuApiRequest["query"] {
  return {
    document_revision_id: readNumberParameter(request, "documentRevisionId")
      ?? readNumberParameter(request, "document_revision_id"),
    user_id_type: readStringParameter(request, "userIdType"),
    client_token: readStringParameter(request, "clientToken"),
  };
}

function inferDocsMutationType(request: ExternalDataOperationRequest): string | undefined {
  if (readRecordArrayParameter(request, "requests")) {
    return "batch_update";
  }
  if (
    (readStringParameter(request, "blockId") || readStringParameter(request, "block_id")) &&
    (readRecordParameter(request, "block") || readRecordParameter(request, "update") || readRecordParameter(request, "body"))
  ) {
    return "update_block";
  }
  if (readRecordArrayParameter(request, "children") || readRecordArrayParameter(request, "blocks")) {
    return "append_blocks";
  }
  return undefined;
}

function buildFeishuBaseMutationRequest(request: ExternalDataOperationRequest): FeishuApiRequest | null {
  const appToken = request.providerResourceType === "base"
    ? request.providerResourceToken
    : readStringParameter(request, "appToken");
  const tableId = request.providerResourceType === "base_table"
    ? request.providerResourceToken
    : readStringParameter(request, "tableId");
  if (!appToken || !tableId) {
    return null;
  }

  const query = {
    user_id_type: readStringParameter(request, "userIdType"),
  };
  const mutation = readStringParameter(request, "mutation")
    ?? readStringParameter(request, "action")
    ?? inferBaseMutationType(request);
  if (mutation === "create" || mutation === "create_record") {
    const fields = readRecordParameter(request, "fields");
    if (!fields) {
      return null;
    }
    return {
      method: "POST",
      path: `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records`,
      query,
      body: { fields },
    };
  }

  if (mutation === "update" || mutation === "update_record") {
    const recordId = readStringParameter(request, "recordId");
    const fields = readRecordParameter(request, "fields");
    if (!recordId || !fields) {
      return null;
    }
    return {
      method: "PUT",
      path: `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`,
      query,
      body: { fields },
    };
  }

  if (mutation === "batch_create" || mutation === "batch_create_records") {
    const records = readRecordArrayParameter(request, "records");
    if (!records) {
      return null;
    }
    return {
      method: "POST",
      path: `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_create`,
      query,
      body: { records },
    };
  }

  if (mutation === "batch_update" || mutation === "batch_update_records") {
    const records = readRecordArrayParameter(request, "records");
    const normalizedRecords = records?.map(normalizeBitableRecordId);
    if (!normalizedRecords || !normalizedRecords.every((record) => Boolean(readString(record, "record_id")))) {
      return null;
    }
    return {
      method: "POST",
      path: `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_update`,
      query,
      body: { records: normalizedRecords },
    };
  }

  return null;
}

function inferBaseMutationType(request: ExternalDataOperationRequest): string | undefined {
  if (readStringParameter(request, "recordId") && readRecordParameter(request, "fields")) {
    return "update_record";
  }
  if (readRecordParameter(request, "fields")) {
    return "create_record";
  }
  const records = readRecordArrayParameter(request, "records");
  if (!records) {
    return undefined;
  }
  return records.some((record) => readString(record, "record_id") ?? readString(record, "recordId"))
    ? "batch_update_records"
    : "batch_create_records";
}

function readStringParameter(request: ExternalDataOperationRequest, key: string): string | undefined {
  const value = request.parameters[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumberParameter(request: ExternalDataOperationRequest, key: string): number | undefined {
  const value = request.parameters[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readRecordParameter(request: ExternalDataOperationRequest, key: string): Record<string, unknown> | undefined {
  return asRecord(request.parameters[key]);
}

function readRecordArrayParameter(request: ExternalDataOperationRequest, key: string): Record<string, unknown>[] | undefined {
  const value = request.parameters[key];
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => Boolean(asRecord(item)))) {
    return undefined;
  }
  return value as Record<string, unknown>[];
}

function readNestedArrayParameter(request: ExternalDataOperationRequest, key: string): unknown[][] | undefined {
  const value = request.parameters[key];
  if (!Array.isArray(value) || !value.every((item) => Array.isArray(item))) {
    return undefined;
  }
  return value as unknown[][];
}

function countArrayParameter(request: ExternalDataOperationRequest, key: string): number | undefined {
  const value = request.parameters[key];
  return Array.isArray(value) ? value.length : undefined;
}

function countNestedArrayParameter(request: ExternalDataOperationRequest, key: string): number | undefined {
  const value = request.parameters[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.reduce((sum, row) => sum + (Array.isArray(row) ? row.length : 1), 0);
}

function readFieldNames(request: ExternalDataOperationRequest): string[] | undefined {
  const fields = readRecordParameter(request, "fields");
  if (fields) {
    return Object.keys(fields).sort();
  }

  const records = request.parameters.records;
  if (!Array.isArray(records)) {
    return undefined;
  }
  const names = new Set<string>();
  for (const record of records) {
    const fields = asRecord(asRecord(record)?.fields);
    if (!fields) {
      continue;
    }
    for (const key of Object.keys(fields)) {
      names.add(key);
    }
  }
  return names.size > 0 ? Array.from(names).sort() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readArray(value: Record<string, unknown>, key: string): unknown[] | undefined {
  const candidate = value[key];
  return Array.isArray(candidate) ? candidate : undefined;
}

function readString(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function readNumber(value: Record<string, unknown> | undefined, key: string): number | undefined {
  const candidate = value?.[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function readBoolean(value: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const candidate = value?.[key];
  return typeof candidate === "boolean" ? candidate : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value
    .map((item) => typeof item === "string" ? item.trim() : undefined)
    .filter((item): item is string => Boolean(item));
  return strings.length > 0 ? strings : undefined;
}

function readSafeResponseCode(value: unknown): number | string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return "[string-code]";
  }
  return undefined;
}

function hasPresentValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  return typeof value === "string" ? Boolean(value.trim()) : true;
}

function normalizeFeishuGovernanceActorType(
  value: string | undefined,
): "user" | "external_guest" | "agent" | "system" | undefined {
  return value === "user" || value === "external_guest" || value === "agent" || value === "system"
    ? value
    : undefined;
}

function removeUndefinedProperties<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function readRecordIds(value: Record<string, unknown> | undefined): string[] | undefined {
  const records = value?.records;
  if (!Array.isArray(records)) {
    return undefined;
  }
  const ids = records
    .map((record) => readString(asRecord(record), "record_id") ?? readString(asRecord(record), "id"))
    .filter((id): id is string => Boolean(id));
  return ids.length > 0 ? ids : undefined;
}

function summarizePreviewFieldNames(records: unknown[] | undefined): string[] | undefined {
  const fieldNames = new Set<string>();
  for (const record of records ?? []) {
    const names = readArray(asRecord(record) ?? {}, "fieldNames");
    for (const name of names ?? []) {
      if (typeof name === "string" && name.trim()) {
        fieldNames.add(name.trim());
      }
    }
  }
  return fieldNames.size > 0
    ? [...fieldNames].sort().slice(0, MAX_PREVIEW_FIELDS)
    : undefined;
}

function normalizePreviewValue(value: unknown): unknown {
  if (typeof value === "string") {
    return truncatePreviewText(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_PREVIEW_COLUMNS).map(normalizePreviewValue);
  }
  const record = asRecord(value);
  if (!record) {
    return String(value);
  }
  const entries = Object.keys(record).sort().slice(0, MAX_PREVIEW_FIELDS).map((key) => [
    key,
    normalizePreviewValue(record[key]),
  ]);
  return Object.fromEntries(entries);
}

function extractTextPreview(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(extractTextPreview).filter(Boolean).join(" ");
  }
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const direct = readString(record, "text")
    ?? readString(record, "content")
    ?? readString(record, "plain_text");
  if (direct) {
    return direct;
  }
  return [
    record.text,
    record.content,
    record.elements,
    record.children,
    record.paragraph,
    record.heading,
  ].map(extractTextPreview).filter(Boolean).join(" ") || undefined;
}

function truncatePreviewText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_PREVIEW_TEXT_LENGTH
    ? `${collapsed.slice(0, MAX_PREVIEW_TEXT_LENGTH)}...`
    : collapsed;
}

function normalizeBitableRecordId(record: Record<string, unknown>): Record<string, unknown> {
  const recordId = readString(record, "record_id") ?? readString(record, "recordId");
  if (!recordId) {
    return record;
  }
  const normalized: Record<string, unknown> = { ...record, record_id: recordId };
  delete normalized.recordId;
  return normalized;
}

function countKnownItems(value: Record<string, unknown>): number | undefined {
  const candidates = [
    value.items,
    value.records,
    value.valueRange,
    value.values,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.length;
    }
    const nested = asRecord(candidate);
    if (Array.isArray(nested?.values)) {
      return nested.values.length;
    }
  }
  return undefined;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
