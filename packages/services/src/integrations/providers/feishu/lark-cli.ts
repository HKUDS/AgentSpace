import type {
  ExternalResourceBindingProviderType,
  ExternalResourceBindingRecord,
} from "@agent-space/db";
import {
  listExternalIntegrationsSync,
  listExternalResourceBindingsSync,
} from "@agent-space/db";
import type { RuntimeToolCapability } from "@agent-space/domain";
import type {
  ExternalDataOperationRequest,
  ExternalDataOperationResult,
} from "../../core/index.ts";
import { FEISHU_PROVIDER_ID } from "./constants.ts";

export const DEFAULT_FEISHU_LARK_CLI_COMMAND = "lark-cli";
export const FEISHU_LARK_CLI_EXECUTOR_ENV_NAMES = [
  "AGENT_SPACE_FEISHU_LARK_CLI_EXECUTOR",
  "AGENT_SPACE_LARK_CLI_EXECUTOR",
] as const;
export const FEISHU_LARK_CLI_OPERATION_MANIFEST_KIND = "agent-space.feishu.lark-cli.operation";
export const FEISHU_LARK_CLI_RESULT_MANIFEST_KIND = "agent-space.feishu.lark-cli.result";
export const FEISHU_LARK_CLI_MANIFEST_SCHEMA_VERSION = 1;
export const FEISHU_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH = "runtime-output/feishu-data-operation-result.json";

export type FeishuLarkCliOperationKind = "read" | "write";

export interface FeishuLarkCliResourceGrant {
  integrationId?: string;
  resourceBindingId?: string;
  providerResourceType: ExternalResourceBindingProviderType;
  providerResourceToken: string;
  providerResourceUrl?: string;
  baseToken?: string;
  tableId?: string;
  viewId?: string;
  allowedOperations?: FeishuLarkCliOperationKind[];
}

export interface BuildFeishuLarkCliRuntimeToolCapabilityInput {
  command?: string;
  id?: string;
  displayName?: string;
  source?: RuntimeToolCapability["source"];
  resourceGrants?: FeishuLarkCliResourceGrant[];
  includeDiagnostics?: boolean;
  env?: Record<string, string>;
}

export interface FeishuLarkCliOperationManifestResourceGrant {
  providerResourceType: ExternalResourceBindingProviderType;
  providerResourceToken: string;
  providerResourceUrl?: string;
  baseToken?: string;
  tableId?: string;
  viewId?: string;
  allowedOperations: FeishuLarkCliOperationKind[];
}

export interface FeishuLarkCliOperationManifest {
  kind: typeof FEISHU_LARK_CLI_OPERATION_MANIFEST_KIND;
  schemaVersion: typeof FEISHU_LARK_CLI_MANIFEST_SCHEMA_VERSION;
  provider: typeof FEISHU_PROVIDER_ID;
  operationRunId: string;
  operationType: string;
  operationKind: FeishuLarkCliOperationKind;
  payloadHash?: string;
  expiresAt: string;
  command: string;
  resultManifestPath: string;
  resourceGrant: FeishuLarkCliOperationManifestResourceGrant;
  allowedShellPatterns: string[];
  allowedResourceTokens: string[];
  requestSummary?: Record<string, unknown>;
  constraints: {
    noLongLivedCredentials: true;
    requiresPayloadHashForWrite: true;
  };
}

export interface BuildFeishuLarkCliOperationManifestInput {
  operationRunId: string;
  request: ExternalDataOperationRequest;
  resourceGrant: FeishuLarkCliResourceGrant;
  payloadHash?: string;
  expiresAt?: string;
  command?: string;
  resultManifestPath?: string;
  requestSummary?: Record<string, unknown>;
}

export type FeishuLarkCliRuntimeReadinessStatus = "disabled" | "available" | "blocked" | "unavailable";

export interface FeishuLarkCliRuntimeDiagnostic {
  status: FeishuLarkCliRuntimeReadinessStatus;
  reasonCode: string;
  message: string;
  command?: string;
  capability?: RuntimeToolCapability;
}

export interface DiagnoseFeishuLarkCliRuntimeInput {
  environment?: Record<string, string | undefined>;
  commandExists?: (command: string) => boolean;
  source?: RuntimeToolCapability["source"];
  resourceGrants?: FeishuLarkCliResourceGrant[];
  includeDiagnostics?: boolean;
}

export function resolveFeishuLarkCliCommand(
  environment: Record<string, string | undefined> = process.env,
): string {
  for (const envName of FEISHU_LARK_CLI_EXECUTOR_ENV_NAMES) {
    const value = environment[envName]?.trim();
    if (value && !/\s/.test(value)) {
      return value;
    }
  }
  return DEFAULT_FEISHU_LARK_CLI_COMMAND;
}

export function diagnoseFeishuLarkCliRuntime(
  input: DiagnoseFeishuLarkCliRuntimeInput = {},
): FeishuLarkCliRuntimeDiagnostic {
  const environment = input.environment ?? process.env;
  const configuredExecutor = readConfiguredFeishuLarkCliExecutor(environment);
  if (configuredExecutor && /\s/.test(configuredExecutor.value)) {
    return {
      status: "blocked",
      reasonCode: "feishu.lark_cli.invalid_executor",
      message: `${configuredExecutor.envName} must be a single executable name or path without shell arguments.`,
      command: configuredExecutor.value,
    };
  }

  if (!isFeishuLarkCliRuntimeEnabled(environment)) {
    return {
      status: "disabled",
      reasonCode: "feishu.lark_cli.disabled",
      message: "Feishu lark-cli runtime capability is not enabled.",
    };
  }

  const command = resolveFeishuLarkCliCommand(environment);
  if (input.commandExists && !input.commandExists(command)) {
    return {
      status: "unavailable",
      reasonCode: "feishu.lark_cli.command_missing",
      message: `Feishu lark-cli command "${command}" is not available on the runtime PATH.`,
      command,
    };
  }

  const capability = buildFeishuLarkCliRuntimeToolCapability({
    command,
    source: input.source ?? "workspace",
    resourceGrants: input.resourceGrants ?? [],
    includeDiagnostics: input.includeDiagnostics,
  });
  if (!capability) {
    return {
      status: "blocked",
      reasonCode: "feishu.lark_cli.no_scoped_capability",
      message: "Feishu lark-cli is enabled, but no diagnostic command or scoped resource grant can be exposed.",
      command,
    };
  }

  return {
    status: "available",
    reasonCode: "feishu.lark_cli.available",
    message: "Feishu lark-cli runtime capability is available with scoped AgentSpace grants.",
    command,
    capability,
  };
}

export function resolveFeishuLarkCliOperationKind(operationType: string): FeishuLarkCliOperationKind {
  return FEISHU_LARK_CLI_WRITE_OPERATION_TYPES.has(operationType.trim()) ? "write" : "read";
}

export function buildFeishuLarkCliOperationManifest(
  input: BuildFeishuLarkCliOperationManifestInput,
): FeishuLarkCliOperationManifest | undefined {
  const operationRunId = readString(input.operationRunId);
  const operationType = readString(input.request.operationType);
  const command = (input.command?.trim() || resolveFeishuLarkCliCommand()).trim();
  if (!operationRunId || !operationType || !command || /\s/.test(command)) {
    return undefined;
  }

  const operationKind = resolveFeishuLarkCliOperationKind(operationType);
  const allowedOperations = normalizeAllowedOperations(input.resourceGrant.allowedOperations);
  if (!allowedOperations.includes(operationKind)) {
    return undefined;
  }

  const payloadHash = readString(input.payloadHash);
  if (operationKind === "write" && !payloadHash) {
    return undefined;
  }

  if (
    input.request.providerResourceType !== input.resourceGrant.providerResourceType ||
    !feishuOperationRequestMatchesGrant(input.request, input.resourceGrant)
  ) {
    return undefined;
  }

  const allowedResourceTokens = dedupeStrings([
    input.resourceGrant.providerResourceToken,
    input.resourceGrant.baseToken,
    input.resourceGrant.tableId,
    input.resourceGrant.viewId,
  ].map(safePatternLiteral).filter((value): value is string => Boolean(value)));
  if (allowedResourceTokens.length === 0) {
    return undefined;
  }

  const allowedShellPatterns = buildFeishuLarkCliAllowedShellPatterns({
    command,
    includeWritePatterns: operationKind === "write",
    resourceGrants: [{
      ...input.resourceGrant,
      allowedOperations,
    }],
  });
  if (allowedShellPatterns.length === 0) {
    return undefined;
  }

  const resourceGrant: FeishuLarkCliOperationManifestResourceGrant = {
    providerResourceType: input.resourceGrant.providerResourceType,
    providerResourceToken: input.resourceGrant.providerResourceToken.trim(),
    allowedOperations,
  };
  if (input.resourceGrant.providerResourceUrl?.trim()) {
    resourceGrant.providerResourceUrl = truncateString(input.resourceGrant.providerResourceUrl.trim(), 1000);
  }
  if (input.resourceGrant.baseToken?.trim()) {
    resourceGrant.baseToken = input.resourceGrant.baseToken.trim();
  }
  if (input.resourceGrant.tableId?.trim()) {
    resourceGrant.tableId = input.resourceGrant.tableId.trim();
  }
  if (input.resourceGrant.viewId?.trim()) {
    resourceGrant.viewId = input.resourceGrant.viewId.trim();
  }

  const requestSummary = input.requestSummary
    ? sanitizeManifestSummaryObject(input.requestSummary)
    : undefined;

  return {
    kind: FEISHU_LARK_CLI_OPERATION_MANIFEST_KIND,
    schemaVersion: FEISHU_LARK_CLI_MANIFEST_SCHEMA_VERSION,
    provider: FEISHU_PROVIDER_ID,
    operationRunId,
    operationType,
    operationKind,
    ...(payloadHash ? { payloadHash } : {}),
    expiresAt: input.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    command,
    resultManifestPath: input.resultManifestPath ?? FEISHU_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH,
    resourceGrant,
    allowedShellPatterns,
    allowedResourceTokens,
    ...(requestSummary && Object.keys(requestSummary).length > 0 ? { requestSummary } : {}),
    constraints: {
      noLongLivedCredentials: true,
      requiresPayloadHashForWrite: true,
    },
  };
}

export function summarizeFeishuLarkCliResultManifest(value: unknown): ExternalDataOperationResult {
  const manifest = readObject(value);
  if (!manifest) {
    return buildInvalidResultManifestResult("Feishu lark-cli result manifest must be a JSON object.");
  }
  if (
    manifest.kind !== FEISHU_LARK_CLI_RESULT_MANIFEST_KIND ||
    manifest.schemaVersion !== FEISHU_LARK_CLI_MANIFEST_SCHEMA_VERSION
  ) {
    return buildInvalidResultManifestResult("Feishu lark-cli result manifest has an unsupported kind or schema version.");
  }

  const status = readString(manifest.status)?.toLowerCase();
  const explicitOk = typeof manifest.ok === "boolean" ? manifest.ok : undefined;
  if (explicitOk === undefined && !status) {
    return buildInvalidResultManifestResult("Feishu lark-cli result manifest must include ok or status.");
  }
  const ok = explicitOk ?? (status === "succeeded" || status === "success" || status === "ok");
  const dataObject = readObject(manifest.data);
  const resourceObject = readObject(manifest.resource);
  const metricsObject = readObject(manifest.metrics);
  const sources = [manifest, dataObject, resourceObject, metricsObject].filter((source): source is Record<string, unknown> =>
    Boolean(source)
  );

  const range = readFirstString(sources, ["range", "rangeA1", "updatedRange"], 240);
  const resource = compactObject({
    documentReference: readFirstFeishuReference(sources, ["documentId", "document_id"]),
    spreadsheetReference: readFirstFeishuReference(sources, ["spreadsheetToken", "spreadsheet_token"]),
    baseReference: readFirstFeishuReference(sources, ["baseToken", "appToken", "base_token", "app_token"]),
    tableReference: readFirstFeishuReference(sources, ["tableId", "table_id"]),
    viewReference: readFirstFeishuReference(sources, ["viewId", "view_id"]),
    rangeRedacted: range ? true : undefined,
    recordReferences: readFirstFeishuReferenceArray(sources, ["recordIds", "record_ids"]),
    createdRecordReferences: readFirstFeishuReferenceArray(sources, ["createdRecordIds", "created_record_ids"]),
    updatedRecordReferences: readFirstFeishuReferenceArray(sources, ["updatedRecordIds", "updated_record_ids"]),
    artifactPath: readFirstRuntimeOutputPath(sources, ["artifactPath", "resultPath", "result_artifact_path"]),
  });
  const hasResponseSummary = Boolean(readFirstString(sources, ["responseSummary", "summary", "message"], 1000));
  const metrics = compactObject({
    rowCount: readFirstNumber(sources, ["rowCount", "row_count"]),
    cellCount: readFirstNumber(sources, ["cellCount", "cell_count"]),
    recordCount: readFirstNumber(sources, ["recordCount", "record_count"]),
    affectedRows: readFirstNumber(sources, ["affectedRows", "affected_rows"]),
    affectedCells: readFirstNumber(sources, ["affectedCells", "affected_cells"]),
    requestCount: readFirstNumber(sources, ["requestCount", "request_count"]),
    truncated: readFirstBoolean(sources, ["truncated"]),
  });
  const resultData = compactObject({
    source: "lark-cli",
    resultManifestKind: FEISHU_LARK_CLI_RESULT_MANIFEST_KIND,
    provider: FEISHU_PROVIDER_ID,
    operationRunId: readFirstSafeIdentifier(sources, ["operationRunId", "operation_run_id", "runId"]),
    payloadHash: readFirstSafeIdentifier(sources, ["payloadHash", "payload_hash"]),
    operationType: readFirstSafeIdentifier(sources, ["operationType", "operation_type"]),
    providerResourceType: readFirstSafeIdentifier(sources, ["providerResourceType", "provider_resource_type"]),
    externalRevisionReference: readFirstFeishuReference(sources, ["externalRevisionId", "revisionId", "revision_id"]),
    responseSummaryRedacted: hasResponseSummary ? true : undefined,
    ...(Object.keys(resource).length > 0 ? { resource } : {}),
    ...(Object.keys(metrics).length > 0 ? { metrics } : {}),
  });

  return {
    ok,
    data: resultData,
    errorCode: ok
      ? undefined
      : readString(manifest.errorCode) ?? "feishu.lark_cli.result_failed",
    errorMessage: ok
      ? undefined
      : truncateString(readString(manifest.errorMessage) ?? "Feishu lark-cli operation failed.", 1000),
  };
}

export function isFeishuLarkCliRuntimeEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  if (readBooleanEnvironmentFlag(environment.AGENT_SPACE_FEISHU_LARK_CLI_ENABLED)) {
    return true;
  }
  return FEISHU_LARK_CLI_EXECUTOR_ENV_NAMES.some((envName) => Boolean(environment[envName]?.trim()));
}

export function buildFeishuLarkCliDiagnosticRuntimeToolCapability(input: {
  environment?: Record<string, string | undefined>;
  source?: RuntimeToolCapability["source"];
} = {}): RuntimeToolCapability | undefined {
  const environment = input.environment ?? process.env;
  if (!isFeishuLarkCliRuntimeEnabled(environment)) {
    return undefined;
  }
  return buildFeishuLarkCliRuntimeToolCapability({
    command: resolveFeishuLarkCliCommand(environment),
    id: "feishu:lark-cli:diagnostic",
    source: input.source ?? "builtin",
    includeDiagnostics: true,
  });
}

export function buildFeishuLarkCliRuntimeToolCapability(
  input: BuildFeishuLarkCliRuntimeToolCapabilityInput = {},
): RuntimeToolCapability | undefined {
  const command = (input.command?.trim() || resolveFeishuLarkCliCommand()).trim();
  if (!command || /\s/.test(command)) {
    return undefined;
  }
  const allowedShellPatterns = buildFeishuLarkCliAllowedShellPatterns({
    command,
    resourceGrants: input.resourceGrants ?? [],
    includeDiagnostics: input.includeDiagnostics,
  });
  if (allowedShellPatterns.length === 0) {
    return undefined;
  }
  return {
    id: input.id ?? "feishu:lark-cli",
    command,
    displayName: input.displayName ?? "Feishu/Lark CLI",
    binPath: isPathLike(command) ? command : undefined,
    allowedShellPatterns,
    diagnosticCommands: [`command -v ${shellQuote(command)}`],
    env: input.env,
    source: input.source ?? "workspace",
  };
}

export function buildFeishuLarkCliAllowedShellPatterns(input: {
  command?: string;
  resourceGrants?: FeishuLarkCliResourceGrant[];
  includeDiagnostics?: boolean;
  includeWritePatterns?: boolean;
} = {}): string[] {
  const command = input.command?.trim() || DEFAULT_FEISHU_LARK_CLI_COMMAND;
  const patterns = [
    ...(input.includeDiagnostics ? [
      `${command} --version`,
      `${command} auth status`,
      `${command} schema *`,
    ] : []),
  ];

  for (const grant of input.resourceGrants ?? []) {
    const readPatterns = buildReadPatternsForGrant(command, grant);
    patterns.push(...readPatterns);
    if (input.includeWritePatterns && grant.allowedOperations?.includes("write")) {
      patterns.push(...buildWritePatternsForGrant(command, grant));
    }
  }

  return dedupeStrings(patterns);
}

export function listFeishuLarkCliResourceGrantsForChannelSync(input: {
  workspaceId: string;
  channelName?: string;
}): FeishuLarkCliResourceGrant[] {
  const channelName = input.channelName?.trim();
  if (!channelName) {
    return [];
  }
  return listExternalIntegrationsSync({
    workspaceId: input.workspaceId,
    provider: FEISHU_PROVIDER_ID,
  })
    .filter((integration) => integration.status === "active")
    .flatMap((integration) =>
      listExternalResourceBindingsSync({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        channelName,
        status: "active",
      }).map(buildResourceGrantFromBinding).filter((grant): grant is FeishuLarkCliResourceGrant => grant !== null)
    );
}

export function buildFeishuLarkCliResourceGrantFromBinding(
  binding: ExternalResourceBindingRecord,
): FeishuLarkCliResourceGrant | null {
  return buildResourceGrantFromBinding(binding);
}

const FEISHU_LARK_CLI_WRITE_OPERATION_TYPES = new Set([
  "docs.create_document",
  "docs.update_document",
  "sheets.update_range",
  "base.mutate_records",
]);

function buildResourceGrantFromBinding(binding: ExternalResourceBindingRecord): FeishuLarkCliResourceGrant | null {
  const metadata = readJsonObject(binding.metadataJson);
  const permissions = readJsonObject(binding.permissionsJson);
  const baseToken = readString(metadata.baseToken)
    ?? readString(metadata.appToken)
    ?? extractFeishuBaseToken(binding.providerResourceUrl)
    ?? (binding.providerResourceType === "base" ? binding.providerResourceToken : undefined);
  const tableId = readString(metadata.tableId)
    ?? (binding.providerResourceType === "base_table" ? binding.providerResourceToken : undefined)
    ?? extractFeishuBaseTableId(binding.providerResourceUrl);
  const viewId = readString(metadata.viewId)
    ?? (binding.providerResourceType === "base_view" ? binding.providerResourceToken : undefined)
    ?? extractFeishuBaseViewId(binding.providerResourceUrl);
  const canWrite = permissions.canWrite === true || permissions.write === true;
  return {
    integrationId: binding.integrationId,
    resourceBindingId: binding.id,
    providerResourceType: binding.providerResourceType,
    providerResourceToken: binding.providerResourceToken,
    providerResourceUrl: binding.providerResourceUrl,
    baseToken,
    tableId,
    viewId,
    allowedOperations: canWrite ? ["read", "write"] : ["read"],
  };
}

function buildReadPatternsForGrant(command: string, grant: FeishuLarkCliResourceGrant): string[] {
  const token = safePatternLiteral(grant.providerResourceToken);
  if (!token) {
    return [];
  }
  if (grant.providerResourceType === "doc") {
    return [
      `${command} docs +fetch *${token}*`,
    ];
  }
  if (grant.providerResourceType === "sheet") {
    return [
      `${command} sheets +workbook-info *${token}*`,
      `${command} sheets +sheet-info *${token}*`,
      `${command} sheets +csv-get *${token}*`,
      `${command} sheets +cells-get *${token}*`,
    ];
  }
  const baseToken = safePatternLiteral(grant.baseToken ?? (grant.providerResourceType === "base" ? grant.providerResourceToken : undefined));
  if (!baseToken) {
    return [];
  }
  const patterns = [
    `${command} base +table-list *${baseToken}*`,
    `${command} base +table-get *${baseToken}*`,
    `${command} base +field-list *${baseToken}*`,
    `${command} base +record-list *${baseToken}*`,
    `${command} base +record-search *${baseToken}*`,
  ];
  const tableId = safePatternLiteral(grant.tableId);
  if (tableId) {
    patterns.push(
      `${command} base +table-get *${baseToken}*${tableId}*`,
      `${command} base +field-list *${baseToken}*${tableId}*`,
      `${command} base +record-list *${baseToken}*${tableId}*`,
      `${command} base +record-search *${baseToken}*${tableId}*`,
    );
  }
  const viewId = safePatternLiteral(grant.viewId);
  if (viewId) {
    patterns.push(
      `${command} base +record-list *${baseToken}*${viewId}*`,
      `${command} base +record-search *${baseToken}*${viewId}*`,
    );
  }
  return patterns;
}

function buildWritePatternsForGrant(command: string, grant: FeishuLarkCliResourceGrant): string[] {
  const token = safePatternLiteral(grant.providerResourceToken);
  if (!token) {
    return [];
  }
  if (grant.providerResourceType === "doc") {
    return [
      `${command} docs +update *${token}*`,
    ];
  }
  if (grant.providerResourceType === "sheet") {
    return [
      `${command} sheets +csv-put *${token}*`,
      `${command} sheets +cells-set *${token}*`,
      `${command} sheets +batch-update *${token}*`,
    ];
  }
  const baseToken = safePatternLiteral(grant.baseToken ?? (grant.providerResourceType === "base" ? grant.providerResourceToken : undefined));
  const tableId = safePatternLiteral(grant.tableId);
  if (!baseToken || (grant.providerResourceType !== "base" && !tableId)) {
    return [];
  }
  const scope = tableId ? `${baseToken}*${tableId}` : baseToken;
  return [
    `${command} base +record-create *${scope}*`,
    `${command} base +record-update *${scope}*`,
    `${command} base +record-batch-create *${scope}*`,
    `${command} base +record-batch-update *${scope}*`,
  ];
}

function safePatternLiteral(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^[A-Za-z0-9_.:-]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function formatFeishuLarkCliReference(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("ref_")) {
    return trimmed;
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < trimmed.length; index += 1) {
    hash ^= trimmed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `ref_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeAllowedOperations(
  allowedOperations: FeishuLarkCliOperationKind[] | undefined,
): FeishuLarkCliOperationKind[] {
  const result = dedupeStrings((allowedOperations ?? ["read"]).filter(isFeishuLarkCliOperationKind));
  return result.length > 0 ? result as FeishuLarkCliOperationKind[] : ["read"];
}

function isFeishuLarkCliOperationKind(value: string): value is FeishuLarkCliOperationKind {
  return value === "read" || value === "write";
}

function feishuOperationRequestMatchesGrant(
  request: ExternalDataOperationRequest,
  grant: FeishuLarkCliResourceGrant,
): boolean {
  const requestToken = request.providerResourceToken.trim();
  const grantToken = grant.providerResourceToken.trim();
  if (requestToken === grantToken) {
    return true;
  }
  return request.operationType === "docs.create_document" && (requestToken === "new" || requestToken === "__new__");
}

function extractFeishuBaseToken(value: string | undefined): string | undefined {
  return extractFirstMatch(value, /\/base\/([A-Za-z0-9_-]+)/);
}

function extractFeishuBaseTableId(value: string | undefined): string | undefined {
  return extractFirstMatch(value, /[?&]table=([A-Za-z0-9_-]+)/);
}

function extractFeishuBaseViewId(value: string | undefined): string | undefined {
  return extractFirstMatch(value, /[?&]view=([A-Za-z0-9_-]+)/);
}

function extractFirstMatch(value: string | undefined, pattern: RegExp): string | undefined {
  const match = value ? pattern.exec(value) : null;
  return match?.[1];
}

function readJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readConfiguredFeishuLarkCliExecutor(
  environment: Record<string, string | undefined>,
): { envName: string; value: string } | undefined {
  for (const envName of FEISHU_LARK_CLI_EXECUTOR_ENV_NAMES) {
    const value = environment[envName]?.trim();
    if (value) {
      return { envName, value };
    }
  }
  return undefined;
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function buildInvalidResultManifestResult(errorMessage: string): ExternalDataOperationResult {
  return {
    ok: false,
    errorCode: "feishu.lark_cli.invalid_result_manifest",
    errorMessage,
  };
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function readFirstSafeIdentifier(
  sources: Record<string, unknown>[],
  keys: string[],
): string | undefined {
  const value = readFirstString(sources, keys, 240);
  return safePatternLiteral(value);
}

function readFirstFeishuReference(
  sources: Record<string, unknown>[],
  keys: string[],
): string | undefined {
  return formatFeishuLarkCliReference(readFirstSafeIdentifier(sources, keys));
}

function readFirstString(
  sources: Record<string, unknown>[],
  keys: string[],
  maxLength: number,
): string | undefined {
  for (const source of sources) {
    for (const key of keys) {
      const value = readString(source[key]);
      if (value) {
        return truncateString(value, maxLength);
      }
    }
  }
  return undefined;
}

function readFirstNumber(
  sources: Record<string, unknown>[],
  keys: string[],
): number | undefined {
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }
  }
  return undefined;
}

function readFirstBoolean(
  sources: Record<string, unknown>[],
  keys: string[],
): boolean | undefined {
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "boolean") {
        return value;
      }
    }
  }
  return undefined;
}

function readFirstStringArray(
  sources: Record<string, unknown>[],
  keys: string[],
): string[] | undefined {
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (Array.isArray(value)) {
        const values = value
          .map((entry) => safePatternLiteral(readString(entry)))
          .filter((entry): entry is string => Boolean(entry))
          .slice(0, 50);
        if (values.length > 0) {
          return values;
        }
      }
    }
  }
  return undefined;
}

function readFirstFeishuReferenceArray(
  sources: Record<string, unknown>[],
  keys: string[],
): string[] | undefined {
  const values = readFirstStringArray(sources, keys);
  const references = values
    ?.map(formatFeishuLarkCliReference)
    .filter((value): value is string => Boolean(value));
  return references && references.length > 0 ? references : undefined;
}

function readFirstRuntimeOutputPath(
  sources: Record<string, unknown>[],
  keys: string[],
): string | undefined {
  const value = readFirstString(sources, keys, 500);
  if (!value || value.includes("..") || !value.startsWith("runtime-output/")) {
    return undefined;
  }
  return value;
}

function sanitizeManifestSummaryObject(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 40)) {
    if (!/^[A-Za-z0-9_.:-]+$/.test(key) || isUnsafeSummaryKey(key)) {
      continue;
    }
    const safeValue = sanitizeManifestSummaryValue(entry, 0);
    if (safeValue !== undefined) {
      result[key] = safeValue;
    }
  }
  return result;
}

function sanitizeManifestSummaryValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return truncateString(value, 240);
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value) && depth < 1) {
    const result = value
      .map((entry) => sanitizeManifestSummaryValue(entry, depth + 1))
      .filter((entry) => entry !== undefined)
      .slice(0, 20);
    return result.length > 0 ? result : undefined;
  }
  if (value && typeof value === "object" && !Array.isArray(value) && depth < 1) {
    return sanitizeManifestSummaryObject(value as Record<string, unknown>);
  }
  return undefined;
}

function isUnsafeSummaryKey(key: string): boolean {
  return /(secret|credential|password|encrypt|token|content|text|blocks|rows|records|values)/i.test(key);
}

function truncateString(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function readBooleanEnvironmentFlag(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function isPathLike(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
