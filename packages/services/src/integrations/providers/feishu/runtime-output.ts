import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  readExternalMessageMappingByAgentSpaceMessageSync,
  type ExternalResourceBindingProviderType,
  type ExternalMessageMappingRecord,
} from "@agent-space/db";
import type {
  ExternalDataOperationRequest,
  IntegrationRuntimeContext,
} from "../../core/index.ts";
import {
  recordExternalDataOperationFinishSync,
  recordExternalDataOperationPlanSync,
} from "../../core/data-operations.ts";
import {
  planBoundFeishuWriteDataOperationWithApproval,
  type FeishuDataOperationApprovalContext,
  type FeishuDataOperationWithApprovalResult,
} from "./approval.ts";
import type { FeishuApiClient } from "./client.ts";
import { FEISHU_PROVIDER_ID } from "./constants.ts";
import type { FeishuBoundDataOperationActor } from "./data-plane.ts";
import type { FeishuExternalGuestRestrictedAction } from "./external-guests.ts";
import { buildAgentSpaceSettingsIntegrationsDeepLink } from "./links.ts";
import {
  FEISHU_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH,
  resolveFeishuLarkCliOperationKind,
  summarizeFeishuLarkCliResultManifest,
  type FeishuLarkCliResourceGrant,
} from "./lark-cli.ts";
import { queueFeishuAgentStatusCardOutboxSync } from "./outbound.ts";

export const FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_KIND = "agent-space.feishu.data-operation.requests";
export const FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_SCHEMA_VERSION = 1;
export const FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_RELATIVE_PATH = "runtime-output/feishu-data-operation-requests.json";

export interface FeishuRuntimeDataOperationRequestManifestEntry {
  operationType: string;
  providerResourceType: ExternalResourceBindingProviderType;
  providerResourceToken: string;
  parameters?: Record<string, unknown>;
  contentPreview?: string;
}

export interface FeishuRuntimeDataOperationRequestsManifest {
  kind: typeof FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_KIND;
  schemaVersion: typeof FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_SCHEMA_VERSION;
  generatedBy: "agent-space-cli";
  requests: FeishuRuntimeDataOperationRequestManifestEntry[];
}

export interface FeishuRuntimeDataOperationRequestApplySummary {
  statusMessages: string[];
  warnings: string[];
  operationRunIds: string[];
  approvalIds: string[];
}

export interface FeishuLarkCliResultManifestOperationSummary {
  statusMessages: string[];
  warnings: string[];
  operationRunIds: string[];
}

type ReadFeishuRuntimeSourceMessageMapping = typeof readExternalMessageMappingByAgentSpaceMessageSync;

export function appendFeishuRuntimeDataOperationRequest(
  workDir: string,
  request: FeishuRuntimeDataOperationRequestManifestEntry,
): FeishuRuntimeDataOperationRequestsManifest {
  const normalized = normalizeFeishuRuntimeDataOperationRequest(request);
  const manifestPath = join(workDir, FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_RELATIVE_PATH);
  const manifest = readFeishuRuntimeDataOperationRequestsManifest(workDir) ?? {
    kind: FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_KIND,
    schemaVersion: FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_SCHEMA_VERSION,
    generatedBy: "agent-space-cli" as const,
    requests: [],
  };
  manifest.requests.push(normalized);
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export function readFeishuRuntimeDataOperationRequestsManifest(
  workDir: string,
): FeishuRuntimeDataOperationRequestsManifest | undefined {
  const manifestPath = join(workDir, FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_RELATIVE_PATH);
  if (!existsSync(manifestPath)) {
    return undefined;
  }
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  return parseFeishuRuntimeDataOperationRequestsManifest(parsed);
}

export async function applyFeishuRuntimeDataOperationRequests(input: {
  workDir: string;
  workspaceId: string;
  actorName: string;
  sourceTaskQueueId?: string;
  sourceChannelName?: string;
  sourceAgentSpaceMessageId?: string;
  resourceGrants: FeishuLarkCliResourceGrant[];
  planWriteOperationWithApproval?: typeof planBoundFeishuWriteDataOperationWithApproval;
  queueAgentStatusCard?: typeof queueFeishuAgentStatusCardOutboxSync;
  readSourceMessageMapping?: ReadFeishuRuntimeSourceMessageMapping;
  client?: FeishuApiClient;
}): Promise<FeishuRuntimeDataOperationRequestApplySummary> {
  const manifestPath = join(input.workDir, FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_RELATIVE_PATH);
  if (!existsSync(manifestPath)) {
    return emptyFeishuRuntimeDataOperationRequestSummary();
  }

  let manifest: FeishuRuntimeDataOperationRequestsManifest;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
    manifest = parseFeishuRuntimeDataOperationRequestsManifest(parsed);
  } catch {
    return {
      ...emptyFeishuRuntimeDataOperationRequestSummary(),
      warnings: ["Feishu runtime data-operation request manifest could not be parsed; no approval requests were created."],
    };
  }

  const channelName = input.sourceChannelName?.trim();
  if (!channelName) {
    return {
      ...emptyFeishuRuntimeDataOperationRequestSummary(),
      warnings: ["Feishu runtime data-operation requests require a channel task context; no approval requests were created."],
    };
  }

  const statusMessages: string[] = [];
  const warnings: string[] = [];
  const operationRunIds: string[] = [];
  const approvalIds: string[] = [];
  const planWriteOperationWithApproval = input.planWriteOperationWithApproval ?? planBoundFeishuWriteDataOperationWithApproval;
  const queueAgentStatusCard = input.queueAgentStatusCard ?? queueFeishuAgentStatusCardOutboxSync;
  const client = input.client ?? createNoopFeishuWritePlanClient();

  for (const [index, entry] of manifest.requests.slice(0, 20).entries()) {
    const operationKind = resolveFeishuLarkCliOperationKind(entry.operationType);
    if (operationKind !== "write") {
      warnings.push(`Feishu runtime data-operation request ${index + 1} was ignored because only write approval requests are supported.`);
      continue;
    }

    const grant = findFeishuRuntimeDataOperationGrant({
      resourceGrants: input.resourceGrants,
      providerResourceType: entry.providerResourceType,
      providerResourceToken: entry.providerResourceToken,
    });
    if (!grant?.integrationId || !grant.resourceBindingId) {
      warnings.push(`Feishu runtime data-operation request ${index + 1} did not match an active writable AgentSpace resource binding.`);
      continue;
    }

    const sourceContext = resolveFeishuRuntimeDataOperationSourceContext({
      workspaceId: input.workspaceId,
      sourceAgentSpaceMessageId: input.sourceAgentSpaceMessageId,
      actorName: input.actorName,
      channelName,
      readSourceMessageMapping: input.readSourceMessageMapping,
    });
    const governanceContext = buildFeishuRuntimeDataOperationGovernanceContext({
      actorName: input.actorName,
      channelName,
      sourceContext,
    });
    const request: ExternalDataOperationRequest = {
      operationType: entry.operationType,
      providerResourceType: grant.providerResourceType,
      providerResourceToken: grant.providerResourceToken,
      actorType: "agent",
      actorId: input.actorName,
      parameters: removeUndefinedProperties({
        ...(entry.parameters ?? {}),
        channelName,
        taskId: input.sourceTaskQueueId,
        feishuGovernance: governanceContext,
      }),
    };
    const approval = removeUndefinedProperties({
      agentId: input.actorName,
      channelName,
      sourceId: input.sourceTaskQueueId,
      sourceAgentSpaceMessageId: input.sourceAgentSpaceMessageId,
      taskId: input.sourceTaskQueueId,
      contentPreview: sanitizeFeishuRuntimeApprovalPreview(entry.contentPreview, grant),
      metadata: {
        source: "runtime-output-feishu-data-operation-request",
        resultManifestPath: FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_RELATIVE_PATH,
        governanceContext,
      },
    }) as FeishuDataOperationApprovalContext;

    try {
      const planned = await planWriteOperationWithApproval({
        context: {
          workspaceId: input.workspaceId,
          integrationId: grant.integrationId,
          provider: FEISHU_PROVIDER_ID,
        } satisfies IntegrationRuntimeContext,
        client,
        request,
        actor: sourceContext.actor,
        approval,
      });
      operationRunIds.push(planned.runId);
      if (planned.approval?.id) {
        approvalIds.push(planned.approval.id);
        statusMessages.push(`Feishu ${entry.operationType} approval request created: ${planned.approval.id}.`);
      } else if (planned.result.errorCode) {
        warnings.push(`Feishu runtime data-operation request ${index + 1} did not create an approval: ${planned.result.errorCode}.`);
        const identityNoticeCount = queueFeishuExternalGuestIdentityRequiredCardBestEffort({
          workspaceId: input.workspaceId,
          channelName,
          actorName: input.actorName,
          taskId: input.sourceTaskQueueId,
          sourceAgentSpaceMessageId: input.sourceAgentSpaceMessageId,
          sourceContext,
          errorCode: planned.result.errorCode,
          queueAgentStatusCard,
        });
        if (identityNoticeCount > 0) {
          statusMessages.push("Feishu external guest identity binding notice queued.");
        }
      } else {
        statusMessages.push(`Feishu ${entry.operationType} data-operation run recorded: ${planned.runId}.`);
      }
    } catch (error) {
      warnings.push(`Feishu runtime data-operation request ${index + 1} failed: ${sanitizeFeishuRuntimeErrorMessage(error, grant)}.`);
    }
  }

  return {
    statusMessages,
    warnings,
    operationRunIds,
    approvalIds,
  };
}

export function applyFeishuLarkCliResultManifestOperations(input: {
  workDir: string;
  workspaceId: string;
  actorName: string;
  resourceGrants: FeishuLarkCliResourceGrant[];
  recordPlan?: typeof recordExternalDataOperationPlanSync;
  recordFinish?: typeof recordExternalDataOperationFinishSync;
}): FeishuLarkCliResultManifestOperationSummary {
  const manifestPath = join(input.workDir, FEISHU_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH);
  if (!existsSync(manifestPath)) {
    return { statusMessages: [], warnings: [], operationRunIds: [] };
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    return {
      statusMessages: [],
      warnings: ["Feishu lark-cli result manifest could not be parsed; no AgentSpace data operation evidence was recorded."],
      operationRunIds: [],
    };
  }

  const manifestObject = readPlainObject(manifest);
  const operationType = readStringField(manifestObject, "operationType") ??
    readStringField(manifestObject, "operation_type");
  const providerResourceType = readStringField(manifestObject, "providerResourceType") ??
    readStringField(manifestObject, "provider_resource_type");
  const providerResourceToken = readStringField(manifestObject, "providerResourceToken") ??
    readStringField(manifestObject, "provider_resource_token");
  if (!operationType || !providerResourceType || !providerResourceToken) {
    return {
      statusMessages: [],
      warnings: ["Feishu lark-cli result manifest is missing operation/resource fields; no AgentSpace data operation evidence was recorded."],
      operationRunIds: [],
    };
  }

  const operationKind = resolveFeishuLarkCliOperationKind(operationType);
  if (operationKind !== "read") {
    return {
      statusMessages: [],
      warnings: ["Feishu lark-cli write result manifest was ignored; Feishu writes must execute through AgentSpace approval and payload-hash governance."],
      operationRunIds: [],
    };
  }

  const grant = findFeishuLarkCliResultGrant({
    resourceGrants: input.resourceGrants,
    providerResourceType,
    providerResourceToken,
  });
  if (!grant?.integrationId || !grant.resourceBindingId) {
    return {
      statusMessages: [],
      warnings: ["Feishu lark-cli result manifest did not match an active AgentSpace resource binding; no evidence was recorded."],
      operationRunIds: [],
    };
  }

  const summarizedResult = summarizeFeishuLarkCliResultManifest(manifest);
  const redactedResult = redactFeishuLarkCliResultForGrant(summarizedResult, grant);
  const recordPlan = input.recordPlan ?? recordExternalDataOperationPlanSync;
  const recordFinish = input.recordFinish ?? recordExternalDataOperationFinishSync;
  const governanceContext = buildFeishuRuntimeDataOperationGovernanceContext({
    actorName: input.actorName,
  });
  const run = recordPlan({
    context: {
      workspaceId: input.workspaceId,
      integrationId: grant.integrationId,
      provider: FEISHU_PROVIDER_ID,
    },
    resourceBindingId: grant.resourceBindingId,
    request: {
      operationType,
      providerResourceType: grant.providerResourceType,
      providerResourceToken: grant.providerResourceToken,
      actorType: "agent",
      actorId: input.actorName,
      parameters: {
        source: "lark-cli-result-manifest",
        resultManifestPath: FEISHU_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH,
        feishuGovernance: governanceContext,
      },
    },
    requestJson: {
      source: "lark-cli-result-manifest",
      resultManifestPath: FEISHU_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH,
      operationKind,
      governanceContext,
    },
    status: "running",
  });
  const finished = recordFinish({
    workspaceId: input.workspaceId,
    runId: run.id,
    result: {
      ...redactedResult,
      data: {
        ...(redactedResult.data ?? {}),
        operationRunId: run.id,
        runtimeResultManifest: {
          path: FEISHU_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH,
        },
      },
    },
  });

  return {
    statusMessages: [
      `Feishu lark-cli ${operationKind} result recorded as ${finished.status} data operation evidence.`,
    ],
    warnings: [],
    operationRunIds: [finished.id],
  };
}

function emptyFeishuRuntimeDataOperationRequestSummary(): FeishuRuntimeDataOperationRequestApplySummary {
  return {
    statusMessages: [],
    warnings: [],
    operationRunIds: [],
    approvalIds: [],
  };
}

function queueFeishuExternalGuestIdentityRequiredCardBestEffort(input: {
  workspaceId: string;
  channelName: string;
  actorName: string;
  taskId?: string;
  sourceAgentSpaceMessageId?: string;
  sourceContext: FeishuRuntimeDataOperationSourceContext;
  errorCode?: string;
  queueAgentStatusCard: typeof queueFeishuAgentStatusCardOutboxSync;
}): number {
  if (input.errorCode !== "feishu.data_operation_external_guest_requires_identity") {
    return 0;
  }
  try {
    const agentId = readStringField(input.sourceContext.governance, "agentId") ?? input.actorName;
    const settingsUrl = buildAgentSpaceSettingsIntegrationsDeepLink({
      workspaceId: input.workspaceId,
      target: "user-bindings",
    });
    return input.queueAgentStatusCard({
      workspaceId: input.workspaceId,
      channelName: input.channelName,
      agentId,
      status: "failed",
      agentNames: [agentId],
      message: "External guests must bind an AgentSpace identity before writing Feishu Docs, Sheets, or Base resources.",
      taskId: input.taskId,
      sourceAgentSpaceMessageId: input.sourceAgentSpaceMessageId,
      actionUrl: settingsUrl ?? null,
    }).length;
  } catch {
    return 0;
  }
}

interface FeishuRuntimeDataOperationSourceContext {
  actor?: FeishuBoundDataOperationActor;
  governance: Record<string, unknown>;
}

function resolveFeishuRuntimeDataOperationSourceContext(input: {
  workspaceId: string;
  sourceAgentSpaceMessageId?: string;
  actorName: string;
  channelName: string;
  readSourceMessageMapping?: ReadFeishuRuntimeSourceMessageMapping;
}): FeishuRuntimeDataOperationSourceContext {
  let sourceMapping: ExternalMessageMappingRecord | null = null;
  if (input.sourceAgentSpaceMessageId) {
    try {
      const readSourceMessageMapping = input.readSourceMessageMapping ?? readExternalMessageMappingByAgentSpaceMessageSync;
      sourceMapping = readSourceMessageMapping({
        workspaceId: input.workspaceId,
        agentSpaceMessageId: input.sourceAgentSpaceMessageId,
        direction: "inbound",
      });
    } catch {
      sourceMapping = null;
    }
  }
  if (!sourceMapping) {
    return {
      governance: {
        actorType: "agent",
        agentId: input.actorName,
        channelName: input.channelName,
      },
    };
  }
  return buildFeishuRuntimeDataOperationSourceContextFromMapping({
    mapping: sourceMapping,
    actorName: input.actorName,
    channelName: input.channelName,
  });
}

function buildFeishuRuntimeDataOperationSourceContextFromMapping(input: {
  mapping: ExternalMessageMappingRecord;
  actorName: string;
  channelName: string;
}): FeishuRuntimeDataOperationSourceContext {
  const metadata = parseJsonRecord(input.mapping.metadataJson);
  const actorType = readStringField(metadata, "actorType");
  const agentId = readStringField(metadata, "agentId") ?? input.actorName;
  const botBindingId = readStringField(metadata, "botBindingId");
  if (actorType === "external_guest") {
    const externalActorReference = readStringField(metadata, "externalGuestReference")
      ?? readStringField(metadata, "externalActorReference")
      ?? `mapping_${input.mapping.id}`;
    const permissionProfile = normalizeFeishuGuestPermissionProfile(
      readStringField(metadata, "externalGuestPermissionProfile"),
    );
    const requireIdentityFor = readRestrictedActionsField(metadata, "externalGuestRequireIdentityFor");
    return {
      actor: {
        actorType: "external_guest",
        providerUserRefHash: externalActorReference,
        permissionProfile,
        requireIdentityFor,
        sourceChannelName: input.channelName,
        agentId,
        botBindingId,
      },
      governance: removeUndefinedProperties({
        actorType: "external_guest",
        agentId,
        botBindingId,
        channelName: input.channelName,
        externalActorReference,
        externalGuestPermissionProfile: permissionProfile,
        externalGuestRequireIdentityFor: requireIdentityFor,
      }),
    };
  }
  if (actorType === "user") {
    return {
      governance: removeUndefinedProperties({
        actorType: "user",
        actorUserId: readStringField(metadata, "userId"),
        agentId,
        botBindingId,
        channelName: input.channelName,
      }),
    };
  }
  return {
    governance: removeUndefinedProperties({
      actorType: "agent",
      agentId,
      botBindingId,
      channelName: input.channelName,
    }),
  };
}

function buildFeishuRuntimeDataOperationGovernanceContext(input: {
  actorName: string;
  channelName?: string;
  sourceContext?: FeishuRuntimeDataOperationSourceContext;
}): Record<string, unknown> {
  return removeUndefinedProperties({
    provider: FEISHU_PROVIDER_ID,
    actorType: input.sourceContext
      ? readStringField(input.sourceContext.governance, "actorType")
      : "agent",
    agentId: readStringField(input.sourceContext?.governance, "agentId") ?? input.actorName,
    botBindingId: readStringField(input.sourceContext?.governance, "botBindingId"),
    channelName: readStringField(input.sourceContext?.governance, "channelName") ?? input.channelName,
    actorUserId: readStringField(input.sourceContext?.governance, "actorUserId"),
    externalActorReference: readStringField(input.sourceContext?.governance, "externalActorReference"),
    externalGuestPermissionProfile: readStringField(input.sourceContext?.governance, "externalGuestPermissionProfile"),
    externalGuestRequireIdentityFor: readRestrictedActionsField(
      input.sourceContext?.governance,
      "externalGuestRequireIdentityFor",
    ),
  });
}

function parseFeishuRuntimeDataOperationRequestsManifest(
  value: unknown,
): FeishuRuntimeDataOperationRequestsManifest {
  const manifest = readPlainObject(value);
  if (
    manifest?.kind !== FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_KIND ||
    manifest.schemaVersion !== FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_SCHEMA_VERSION ||
    manifest.generatedBy !== "agent-space-cli" ||
    !Array.isArray(manifest.requests)
  ) {
    throw new Error("Invalid Feishu runtime data-operation request manifest.");
  }
  return {
    kind: FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_KIND,
    schemaVersion: FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_SCHEMA_VERSION,
    generatedBy: "agent-space-cli",
    requests: manifest.requests.map((request) =>
      normalizeFeishuRuntimeDataOperationRequest(readPlainObject(request) ?? {})
    ),
  };
}

function normalizeFeishuRuntimeDataOperationRequest(
  request: Partial<FeishuRuntimeDataOperationRequestManifestEntry>,
): FeishuRuntimeDataOperationRequestManifestEntry {
  const operationType = readString(request.operationType);
  const providerResourceType = readString(request.providerResourceType);
  const providerResourceToken = readString(request.providerResourceToken);
  if (!operationType || !providerResourceType || !providerResourceToken) {
    throw new Error("Feishu runtime data-operation requests require operationType, providerResourceType, and providerResourceToken.");
  }
  const normalized: FeishuRuntimeDataOperationRequestManifestEntry = {
    operationType,
    providerResourceType: providerResourceType as ExternalResourceBindingProviderType,
    providerResourceToken,
  };
  const parameters = readPlainObject(request.parameters);
  const contentPreview = readString(request.contentPreview);
  if (parameters) {
    normalized.parameters = parameters;
  }
  if (contentPreview) {
    normalized.contentPreview = contentPreview;
  }
  return normalized;
}

function findFeishuRuntimeDataOperationGrant(input: {
  resourceGrants: FeishuLarkCliResourceGrant[];
  providerResourceType: string;
  providerResourceToken: string;
}): FeishuLarkCliResourceGrant | undefined {
  const token = input.providerResourceToken.trim();
  return input.resourceGrants.find((grant) =>
    grant.providerResourceType === input.providerResourceType &&
    grant.allowedOperations?.includes("write") === true &&
    [
      grant.providerResourceToken,
      grant.baseToken,
      grant.tableId,
      grant.viewId,
    ].some((value) => value?.trim() === token)
  );
}

function findFeishuLarkCliResultGrant(input: {
  resourceGrants: FeishuLarkCliResourceGrant[];
  providerResourceType: string;
  providerResourceToken: string;
}): FeishuLarkCliResourceGrant | undefined {
  const token = input.providerResourceToken.trim();
  return input.resourceGrants.find((grant) =>
    grant.providerResourceType === input.providerResourceType &&
    grant.allowedOperations?.includes("read") !== false &&
    [
      grant.providerResourceToken,
      grant.baseToken,
      grant.tableId,
      grant.viewId,
    ].some((value) => value?.trim() === token)
  );
}

function redactFeishuLarkCliResultForGrant(
  result: ReturnType<typeof summarizeFeishuLarkCliResultManifest>,
  grant: FeishuLarkCliResourceGrant,
): ReturnType<typeof summarizeFeishuLarkCliResultManifest> {
  return {
    ...result,
    errorMessage: result.errorMessage
      ? redactFeishuRuntimeMessage(result.errorMessage, grant)
      : undefined,
  };
}

function sanitizeFeishuRuntimeApprovalPreview(
  value: string | undefined,
  grant: FeishuLarkCliResourceGrant,
): string | undefined {
  const preview = value?.trim();
  if (!preview) {
    return undefined;
  }
  return redactFeishuRuntimeMessage(preview, grant);
}

function sanitizeFeishuRuntimeErrorMessage(
  error: unknown,
  grant: FeishuLarkCliResourceGrant,
): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactFeishuRuntimeMessage(message, grant);
}

function redactFeishuRuntimeMessage(
  message: string,
  grant: FeishuLarkCliResourceGrant,
): string {
  const sensitiveValues = [
    grant.providerResourceToken,
    grant.providerResourceUrl,
    grant.baseToken,
    grant.tableId,
    grant.viewId,
  ].filter((value): value is string => Boolean(value?.trim()));
  let redacted = message;
  for (const value of sensitiveValues) {
    redacted = redacted.split(value).join("[redacted]");
  }
  return redacted
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(app_secret|appSecret|tenant_access_token|tenantAccessToken|verification_token|verificationToken|encrypt_key|encryptKey)\b\s*[:=]\s*("[^"]+"|'[^']+'|[^,\s]+)/gi, "$1=[redacted]")
    .slice(0, 1000);
}

function createNoopFeishuWritePlanClient(): FeishuApiClient {
  return {
    async request() {
      throw new Error("Feishu runtime data-operation approval planning must not call the Feishu API before approval.");
    },
  };
}

function readPlainObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readStringField(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readRestrictedActionsField(
  source: Record<string, unknown> | undefined,
  key: string,
): FeishuExternalGuestRestrictedAction[] | undefined {
  const value = source?.[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((item) => typeof item === "string" ? normalizeRestrictedAction(item) : undefined)
    .filter((item): item is FeishuExternalGuestRestrictedAction => item !== undefined);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRestrictedAction(value: string): FeishuExternalGuestRestrictedAction | undefined {
  const normalized = value.trim();
  return normalized === "writes" ||
    normalized === "approvals" ||
    normalized === "private_resources" ||
    normalized === "runtime_sensitive_tools"
    ? normalized
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeFeishuGuestPermissionProfile(
  value: string | undefined,
): "none" | "channel_context_only" | "channel_readonly" | undefined {
  return value === "none" || value === "channel_context_only" || value === "channel_readonly"
    ? value
    : undefined;
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    return readPlainObject(JSON.parse(value) as unknown);
  } catch {
    return undefined;
  }
}

function removeUndefinedProperties<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      delete value[key];
    }
  }
  return value;
}
