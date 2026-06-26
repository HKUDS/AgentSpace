import { createHash } from "node:crypto";
import type {
  ExternalDataOperationRunRecord,
  ExternalResourceBindingAgentSpaceType,
  ExternalResourceBindingRecord,
  WorkspaceRole,
} from "@agent-space/db";
import {
  readExternalResourceBindingByKeySync,
  readExternalDataOperationRunSync,
  readExternalIntegrationSync,
  updateExternalDataOperationRunStatusSync,
} from "@agent-space/db";
import { canReadChannelForActorSync } from "../../../channel-access/channel-access.ts";
import { canViewChannelDocumentSync } from "../../../documents/sync.ts";
import { readDataTableSync } from "../../../tables/tables.ts";
import type {
  ExternalDataOperationRequest,
  ExternalDataOperationResult,
  ExternalDocumentProviderAdapter,
  ExternalResourceDescriptor,
  ExternalResourceOperationDescriptor,
  IntegrationRuntimeContext,
} from "../../core/index.ts";
import {
  recordExternalDataOperationFinishSync,
  recordExternalDataOperationPlanSync,
} from "../../core/index.ts";
import { FEISHU_PROVIDER_ID } from "./constants.ts";
import type { FeishuApiClient } from "./client.ts";
import {
  buildFeishuBlockedOperationResult,
  buildFeishuDataOperationPayloadHash,
  buildFeishuWriteOperationRequest,
  planFeishuDataOperation,
  summarizeFeishuDataOperationResponse,
  summarizeFeishuStoredDataOperationGovernanceContext,
  summarizeFeishuStoredDataOperationRequest,
  summarizeFeishuStoredDataOperationPolicyDecision,
  summarizeFeishuStoredDataOperationPolicyInput,
  summarizeFeishuStoredDataOperationResultData,
} from "./operation-plan.ts";
import { resolveFeishuResourceDescriptor } from "./resource-resolver.ts";
import {
  syncFeishuDataTableApprovedWriteResultSync,
  syncFeishuDataTablePreviewFromReadResultSync,
  syncFeishuResourceMetadataSnapshotFromResultSync,
} from "./agent-space-sync.ts";
import type { FeishuGuestPermissionProfile } from "./external-guests.ts";

export const FEISHU_DATA_OPERATION_DESCRIPTORS: ExternalResourceOperationDescriptor[] = [
  {
    operationType: "docs.read_document",
    providerResourceTypes: ["doc"],
    description: "Read a Feishu Docs document.",
    writeOperation: false,
  },
  {
    operationType: "docs.refresh_metadata",
    providerResourceTypes: ["doc"],
    description: "Refresh Feishu Docs document metadata.",
    writeOperation: false,
  },
  {
    operationType: "docs.create_document",
    providerResourceTypes: ["doc"],
    description: "Create a Feishu Docs document through an approved AgentSpace operation.",
    writeOperation: true,
  },
  {
    operationType: "docs.update_document",
    providerResourceTypes: ["doc"],
    description: "Update a Feishu Docs document through an approved AgentSpace operation.",
    writeOperation: true,
  },
  {
    operationType: "sheets.read_range",
    providerResourceTypes: ["sheet"],
    description: "Read a Feishu Sheets range.",
    writeOperation: false,
  },
  {
    operationType: "sheets.refresh_metadata",
    providerResourceTypes: ["sheet"],
    description: "Refresh Feishu Sheets spreadsheet metadata.",
    writeOperation: false,
  },
  {
    operationType: "sheets.update_range",
    providerResourceTypes: ["sheet"],
    description: "Update a Feishu Sheets range through an approved AgentSpace operation.",
    writeOperation: true,
  },
  {
    operationType: "base.query_records",
    providerResourceTypes: ["base", "base_table", "base_view"],
    description: "Query Feishu Base records.",
    writeOperation: false,
  },
  {
    operationType: "base.read_schema",
    providerResourceTypes: ["base", "base_table", "base_view"],
    description: "Refresh Feishu Base table schema metadata.",
    writeOperation: false,
  },
  {
    operationType: "base.mutate_records",
    providerResourceTypes: ["base", "base_table"],
    description: "Mutate Feishu Base records through an approved AgentSpace operation.",
    writeOperation: true,
  },
];

export type FeishuDocumentProviderAdapter = ExternalDocumentProviderAdapter;

export const feishuDocumentProviderAdapter: FeishuDocumentProviderAdapter = {
  provider: FEISHU_PROVIDER_ID,
  supportedOperations: FEISHU_DATA_OPERATION_DESCRIPTORS,
  resolveResource(_context: IntegrationRuntimeContext, resourceUrlOrToken: string): ExternalResourceDescriptor | null {
    return resolveFeishuResourceDescriptor(resourceUrlOrToken);
  },
};

export type FeishuApprovedDataOperationValidationResult =
  | {
    ok: true;
    storedPayloadHash: string;
    computedPayloadHash: string;
  }
  | {
    ok: false;
    errorCode: string;
    errorMessage: string;
    failRun: boolean;
    data?: Record<string, unknown>;
  };

export interface FeishuUserDataOperationActor {
  actorType?: "user";
  userId: string;
  displayName?: string;
  role?: WorkspaceRole;
  agentId?: string;
  botBindingId?: string;
}

export interface FeishuExternalGuestDataOperationActor {
  actorType: "external_guest";
  providerUserRefHash: string;
  displayName?: string;
  permissionProfile?: FeishuGuestPermissionProfile;
  sourceChatId?: string;
  sourceChannelName?: string;
  agentId?: string;
  botBindingId?: string;
}

export type FeishuBoundDataOperationActor =
  | FeishuUserDataOperationActor
  | FeishuExternalGuestDataOperationActor;

export type FeishuResourceBindingValidationResult =
  | {
    ok: true;
    binding: ExternalResourceBindingRecord;
  }
  | {
    ok: false;
    errorCode: string;
    errorMessage: string;
    data?: Record<string, unknown>;
  };

export type FeishuAgentSpaceResourceAccessValidationResult =
  | {
    ok: true;
  }
  | {
    ok: false;
    errorCode: string;
    errorMessage: string;
    data?: Record<string, unknown>;
  };

export type FeishuDataOperationScopeValidationResult =
  | {
    ok: true;
    requiredScope?: string;
    availableScopes: string[];
  }
  | {
    ok: false;
    errorCode: string;
    errorMessage: string;
    requiredScope: string;
    availableScopes: string[];
    data: Record<string, unknown>;
  };

export type FeishuResourceBindingScopeValidationResult =
  | {
    ok: true;
    requiredScopes: string[];
    availableScopes: string[];
  }
  | {
    ok: false;
    errorCode: string;
    errorMessage: string;
    missingScopes: string[];
    requiredScopes: string[];
    availableScopes: string[];
    data: Record<string, unknown>;
  };

export type FeishuApprovedDataOperationBindingValidationResult = FeishuResourceBindingValidationResult;

export interface FeishuAgentSpaceResourceAccessDependencies {
  canViewChannelDocument(input: {
    documentId: string;
    actorId: string;
    actorType: "human" | "agent";
    workspaceId: string;
  }): boolean;
  readDataTable(input: {
    tableId: string;
    workspaceId: string;
  }): {
    id: string;
    channelName?: string;
    status: "active" | "archived";
    externalProvider?: string;
    externalResourceType?: string;
    externalResourceToken?: string;
  } | null;
  canReadChannel(input: {
    workspaceId: string;
    channelName?: string | null;
    actor: FeishuUserDataOperationActor;
  }): boolean;
}

export async function executeFeishuDataOperation(input: {
  context: IntegrationRuntimeContext;
  client: FeishuApiClient;
  request: ExternalDataOperationRequest;
  resourceBindingId?: string;
}): Promise<{
  runId: string;
  result: ExternalDataOperationResult;
}> {
  const scopeValidation = validateFeishuDataOperationScopesForContext({
    context: input.context,
    request: input.request,
  });
  if (!scopeValidation.ok) {
    return recordFeishuDataOperationDeniedSync({
      context: input.context,
      request: input.request,
      resourceBindingId: input.resourceBindingId,
      reasonCode: scopeValidation.errorCode,
      errorMessage: scopeValidation.errorMessage,
      data: scopeValidation.data,
    });
  }

  const plan = planFeishuDataOperation(input.request, {
    workspaceId: input.context.workspaceId,
  });
  if (plan.decision === "require_approval") {
    const payloadHash = buildFeishuDataOperationPayloadHash(input.request);
    const storedPolicyDecision = summarizeFeishuStoredDataOperationPolicyDecision(plan.policyDecision, input.request);
    const run = recordExternalDataOperationPlanSync({
      context: input.context,
      resourceBindingId: input.resourceBindingId,
      request: input.request,
      status: "pending",
      requestJson: {
        policyDecision: plan.decision,
        policyReasonCode: plan.reasonCode,
        governanceContext: summarizeFeishuStoredDataOperationGovernanceContext(input.request),
        policyInput: summarizeFeishuStoredDataOperationPolicyInput(plan.policyInput, input.request),
        agentActionPolicyDecision: storedPolicyDecision,
        policyAuditData: storedPolicyDecision?.auditData,
        approvalType: storedPolicyDecision?.approvalType,
        requiredReviewerRole: storedPolicyDecision?.requiredReviewerRole,
        writeOperation: true,
        payloadHash,
        requestSummary: summarizeFeishuStoredDataOperationRequest(input.request),
      },
    });
    return {
      runId: run.id,
      result: {
        ok: false,
        errorCode: "feishu.data_operation_requires_approval",
        errorMessage: "Feishu write operations require AgentSpace approval before execution.",
        data: {
          policyDecision: plan.decision,
          payloadHash,
          runStatus: run.status,
        },
      },
    };
  }

  const storedPolicyDecision = summarizeFeishuStoredDataOperationPolicyDecision(plan.policyDecision, input.request);
  const run = recordExternalDataOperationPlanSync({
    context: input.context,
    resourceBindingId: input.resourceBindingId,
    request: input.request,
    status: "running",
    requestJson: {
      policyDecision: plan.decision,
      policyReasonCode: plan.reasonCode,
      governanceContext: summarizeFeishuStoredDataOperationGovernanceContext(input.request),
      policyInput: summarizeFeishuStoredDataOperationPolicyInput(plan.policyInput, input.request),
      agentActionPolicyDecision: storedPolicyDecision,
      policyAuditData: storedPolicyDecision?.auditData,
      requestSummary: summarizeFeishuStoredDataOperationRequest(input.request),
    },
  });

  const result = await runFeishuDataOperationPlan({
    client: input.client,
    plan,
    request: input.request,
  });
  recordFeishuDataOperationFinishSync({
    workspaceId: input.context.workspaceId,
    runId: run.id,
    result,
  });

  return {
    runId: run.id,
    result,
  };
}

export async function executeBoundFeishuReadDataOperation(input: {
  context: IntegrationRuntimeContext;
  client: FeishuApiClient;
  request: ExternalDataOperationRequest;
  actor?: FeishuBoundDataOperationActor;
}): Promise<{
  runId: string;
  result: ExternalDataOperationResult;
  resourceBinding?: ExternalResourceBindingRecord;
}> {
  const plan = planFeishuDataOperation(input.request, {
    workspaceId: input.context.workspaceId,
  });
  if (plan.writeOperation) {
    return recordFeishuDataOperationDeniedSync({
      context: input.context,
      request: input.request,
      reasonCode: "feishu.data_operation_write_requires_approval",
      errorMessage: "Feishu write operations must use the approved write operation flow.",
    });
  }

  const binding = readExternalResourceBindingByKeySync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    providerResourceType: input.request.providerResourceType,
    providerResourceToken: input.request.providerResourceToken,
  });
  const bindingValidation = validateFeishuResourceBindingForDataOperation({
    context: input.context,
    request: input.request,
    binding,
  });
  if (!bindingValidation.ok) {
    return recordFeishuDataOperationDeniedSync({
      context: input.context,
      request: input.request,
      reasonCode: bindingValidation.errorCode,
      errorMessage: bindingValidation.errorMessage,
      data: bindingValidation.data,
    });
  }
  const requestWithActorContext = applyFeishuDataOperationGovernanceContext(input.request, {
    actor: input.actor,
    binding: bindingValidation.binding,
    integrationId: input.context.integrationId,
  });

  if (input.actor && isFeishuExternalGuestDataOperationActor(input.actor)) {
    const guestAccessValidation = validateFeishuExternalGuestResourceReadForDataOperation({
      request: requestWithActorContext,
      binding: bindingValidation.binding,
      actor: input.actor,
    });
    if (!guestAccessValidation.ok) {
      return recordFeishuDataOperationDeniedSync({
        context: input.context,
        request: requestWithActorContext,
        resourceBindingId: bindingValidation.binding.id,
        reasonCode: guestAccessValidation.errorCode,
        errorMessage: guestAccessValidation.errorMessage,
        data: guestAccessValidation.data,
      });
    }
  }

  if (
    bindingValidation.binding.channelName &&
    input.actor &&
    isFeishuUserDataOperationActor(input.actor) &&
    !canReadChannelForActorSync({
      workspaceId: input.context.workspaceId,
      channelName: bindingValidation.binding.channelName,
      actor: input.actor,
    })
  ) {
    return recordFeishuDataOperationDeniedSync({
      context: input.context,
      request: requestWithActorContext,
      resourceBindingId: bindingValidation.binding.id,
      reasonCode: "feishu.data_operation_channel_access_denied",
      errorMessage: "Actor cannot read the AgentSpace channel bound to this Feishu resource.",
      data: {
        channelName: bindingValidation.binding.channelName,
      },
    });
  }

  const resourceAccessValidation = validateFeishuAgentSpaceResourceAccessForDataOperation({
    context: input.context,
    request: requestWithActorContext,
    binding: bindingValidation.binding,
    actor: input.actor,
  });
  if (!resourceAccessValidation.ok) {
    return recordFeishuDataOperationDeniedSync({
      context: input.context,
      request: requestWithActorContext,
      resourceBindingId: bindingValidation.binding.id,
      reasonCode: resourceAccessValidation.errorCode,
      errorMessage: resourceAccessValidation.errorMessage,
      data: resourceAccessValidation.data,
    });
  }

  const executed = await executeFeishuDataOperation({
    context: input.context,
    client: input.client,
    request: applyFeishuResourceBindingParameters(requestWithActorContext, bindingValidation.binding),
    resourceBindingId: bindingValidation.binding.id,
  });
  syncFeishuDataTablePreviewFromReadResultSync({
    workspaceId: input.context.workspaceId,
    binding: bindingValidation.binding,
    result: executed.result,
  });
  syncFeishuResourceMetadataSnapshotFromResultSync({
    workspaceId: input.context.workspaceId,
    binding: bindingValidation.binding,
    result: executed.result,
  });
  return {
    ...executed,
    resourceBinding: bindingValidation.binding,
  };
}

export async function planBoundFeishuWriteDataOperation(input: {
  context: IntegrationRuntimeContext;
  client: FeishuApiClient;
  request: ExternalDataOperationRequest;
  actor?: FeishuBoundDataOperationActor;
}): Promise<{
  runId: string;
  result: ExternalDataOperationResult;
  resourceBinding?: ExternalResourceBindingRecord;
  request?: ExternalDataOperationRequest;
}> {
  const plan = planFeishuDataOperation(input.request, {
    workspaceId: input.context.workspaceId,
  });
  if (!plan.writeOperation) {
    return recordFeishuDataOperationDeniedSync({
      context: input.context,
      request: input.request,
      reasonCode: "feishu.data_operation_read_requires_read_flow",
      errorMessage: "Feishu read operations must use the bound read operation flow.",
    });
  }

  const binding = readExternalResourceBindingByKeySync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    providerResourceType: input.request.providerResourceType,
    providerResourceToken: input.request.providerResourceToken,
  });
  const bindingValidation = validateFeishuResourceBindingForDataOperation({
    context: input.context,
    request: input.request,
    binding,
    operationKind: "write",
  });
  if (!bindingValidation.ok) {
    return recordFeishuDataOperationDeniedSync({
      context: input.context,
      request: input.request,
      reasonCode: bindingValidation.errorCode,
      errorMessage: bindingValidation.errorMessage,
      data: bindingValidation.data,
    });
  }
  const requestWithActorContext = applyFeishuDataOperationGovernanceContext(input.request, {
    actor: input.actor,
    binding: bindingValidation.binding,
    integrationId: input.context.integrationId,
  });

  if (input.actor && isFeishuExternalGuestDataOperationActor(input.actor)) {
    const denied = recordFeishuDataOperationDeniedSync({
      context: input.context,
      request: requestWithActorContext,
      resourceBindingId: bindingValidation.binding.id,
      reasonCode: "feishu.data_operation_external_guest_requires_identity",
      errorMessage: "External guests must bind an AgentSpace identity before writing Feishu resources.",
      data: {
        requireIdentity: true,
      },
    });
    return {
      ...denied,
      resourceBinding: bindingValidation.binding,
      request: requestWithActorContext,
    };
  }

  if (
    bindingValidation.binding.channelName &&
    input.actor &&
    isFeishuUserDataOperationActor(input.actor) &&
    !canReadChannelForActorSync({
      workspaceId: input.context.workspaceId,
      channelName: bindingValidation.binding.channelName,
      actor: input.actor,
    })
  ) {
    return recordFeishuDataOperationDeniedSync({
      context: input.context,
      request: requestWithActorContext,
      resourceBindingId: bindingValidation.binding.id,
      reasonCode: "feishu.data_operation_channel_access_denied",
      errorMessage: "Actor cannot read the AgentSpace channel bound to this Feishu resource.",
      data: {
        channelName: bindingValidation.binding.channelName,
      },
    });
  }

  const resourceAccessValidation = validateFeishuAgentSpaceResourceAccessForDataOperation({
    context: input.context,
    request: requestWithActorContext,
    binding: bindingValidation.binding,
    actor: input.actor,
  });
  if (!resourceAccessValidation.ok) {
    return recordFeishuDataOperationDeniedSync({
      context: input.context,
      request: requestWithActorContext,
      resourceBindingId: bindingValidation.binding.id,
      reasonCode: resourceAccessValidation.errorCode,
      errorMessage: resourceAccessValidation.errorMessage,
      data: resourceAccessValidation.data,
    });
  }

  const requestWithBindingContext = applyFeishuResourceBindingParameters({
    ...requestWithActorContext,
    parameters: {
      ...requestWithActorContext.parameters,
      channelName: requestWithActorContext.parameters.channelName ?? bindingValidation.binding.channelName,
    },
  }, bindingValidation.binding);
  const executed = await executeFeishuDataOperation({
    context: input.context,
    client: input.client,
    request: requestWithBindingContext,
    resourceBindingId: bindingValidation.binding.id,
  });
  return {
    ...executed,
    resourceBinding: bindingValidation.binding,
    request: requestWithBindingContext,
  };
}

export function validateFeishuAgentSpaceResourceAccessForDataOperation(input: {
  context: IntegrationRuntimeContext;
  request: ExternalDataOperationRequest;
  binding: ExternalResourceBindingRecord;
  actor?: FeishuBoundDataOperationActor;
  dependencies?: FeishuAgentSpaceResourceAccessDependencies;
}): FeishuAgentSpaceResourceAccessValidationResult {
  const dependencies = input.dependencies ?? defaultFeishuAgentSpaceResourceAccessDependencies;
  if (input.actor && isFeishuExternalGuestDataOperationActor(input.actor)) {
    return validateFeishuExternalGuestResourceReadForDataOperation({
      request: input.request,
      binding: input.binding,
      actor: input.actor,
    });
  }
  const resourceType = normalizeAgentSpaceResourceType(input.binding.agentSpaceResourceType);
  if (resourceType === "channel_document") {
    const actor = resolveFeishuDocumentAccessActor(input.request, input.actor);
    if (!actor) {
      return { ok: true };
    }
    if (!dependencies.canViewChannelDocument({
      documentId: input.binding.agentSpaceResourceId,
      actorId: actor.actorId,
      actorType: actor.actorType,
      workspaceId: input.context.workspaceId,
    })) {
      return {
        ok: false,
        errorCode: "feishu.data_operation_channel_document_access_denied",
        errorMessage: "Actor cannot view the AgentSpace channel document bound to this Feishu resource.",
        data: {
          agentSpaceResourceId: input.binding.agentSpaceResourceId,
          actorType: actor.actorType,
          actorId: actor.actorId,
        },
      };
    }
    return { ok: true };
  }

  if (resourceType === "data_table") {
    const table = dependencies.readDataTable({
      tableId: input.binding.agentSpaceResourceId,
      workspaceId: input.context.workspaceId,
    });
    if (!table) {
      return {
        ok: false,
        errorCode: "feishu.data_operation_data_table_not_found",
        errorMessage: "AgentSpace data table bound to this Feishu resource does not exist.",
        data: {
          agentSpaceResourceId: input.binding.agentSpaceResourceId,
        },
      };
    }
    if (table.status !== "active") {
      return {
        ok: false,
        errorCode: "feishu.data_operation_data_table_inactive",
        errorMessage: "AgentSpace data table bound to this Feishu resource is not active.",
        data: {
          agentSpaceResourceId: table.id,
          tableStatus: table.status,
        },
      };
    }
    if (
      table.externalProvider &&
      (table.externalProvider !== FEISHU_PROVIDER_ID ||
        table.externalResourceToken !== input.binding.providerResourceToken)
    ) {
      return {
        ok: false,
        errorCode: "feishu.data_operation_data_table_binding_mismatch",
        errorMessage: "AgentSpace data table external metadata does not match the requested Feishu resource.",
        data: {
          agentSpaceResourceId: table.id,
          tableExternalProvider: table.externalProvider,
          tableExternalResourceType: table.externalResourceType,
        },
      };
    }
    const channelName = input.binding.channelName ?? table.channelName;
    if (
      input.actor &&
      isFeishuUserDataOperationActor(input.actor) &&
      channelName &&
      !dependencies.canReadChannel({
        workspaceId: input.context.workspaceId,
        channelName,
        actor: input.actor,
      })
    ) {
      return {
        ok: false,
        errorCode: "feishu.data_operation_data_table_channel_access_denied",
        errorMessage: "Actor cannot read the AgentSpace channel linked to this Feishu data table.",
        data: {
          agentSpaceResourceId: table.id,
          channelName,
        },
      };
    }
  }

  return { ok: true };
}

export function validateFeishuResourceBindingForDataOperation(input: {
  context: IntegrationRuntimeContext;
  request: ExternalDataOperationRequest;
  binding?: ExternalResourceBindingRecord | null;
  operationKind?: "read" | "write";
}): FeishuResourceBindingValidationResult {
  if (!input.binding) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_resource_unbound",
      errorMessage: "Feishu data operation requires an active AgentSpace resource binding.",
      data: {
        providerResourceType: input.request.providerResourceType,
        providerResourceToken: input.request.providerResourceToken,
        bindingSuggestion: buildFeishuResourceBindingSuggestion(input.request),
      },
    };
  }
  if (
    input.binding.workspaceId !== input.context.workspaceId ||
    input.binding.integrationId !== input.context.integrationId
  ) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_resource_binding_context_mismatch",
      errorMessage: "Feishu resource binding does not belong to this integration context.",
      data: {
        bindingWorkspaceId: input.binding.workspaceId,
        bindingIntegrationId: input.binding.integrationId,
      },
    };
  }
  if (input.binding.status !== "active") {
    return {
      ok: false,
      errorCode: "feishu.data_operation_resource_binding_inactive",
      errorMessage: "Feishu resource binding is not active.",
      data: {
        bindingStatus: input.binding.status,
      },
    };
  }
  if (
    input.binding.providerResourceType !== input.request.providerResourceType ||
    input.binding.providerResourceToken !== input.request.providerResourceToken
  ) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_resource_binding_mismatch",
      errorMessage: "Feishu resource binding does not match the requested resource.",
      data: {
        bindingProviderResourceType: input.binding.providerResourceType,
        requestProviderResourceType: input.request.providerResourceType,
      },
    };
  }
  const baseContextIssue = validateFeishuBaseResourceBindingContext(input.request, input.binding);
  if (baseContextIssue) {
    return baseContextIssue;
  }
  const docContextIssue = validateFeishuDocResourceBindingContext(input.request, input.binding);
  if (docContextIssue) {
    return docContextIssue;
  }
  const permissions = readJsonObject(input.binding.permissionsJson);
  const operationKind = input.operationKind ?? "read";
  if (operationKind === "read" && (permissions.canRead === false || permissions.read === false)) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_resource_read_denied",
      errorMessage: "Feishu resource binding does not allow read operations.",
    };
  }
  if (
    operationKind === "write" &&
    permissions.canWrite !== true &&
    permissions.write !== true
  ) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_resource_write_denied",
      errorMessage: "Feishu resource binding does not allow write operations.",
    };
  }

  return {
    ok: true,
    binding: input.binding,
  };
}

function validateFeishuDocResourceBindingContext(
  request: ExternalDataOperationRequest,
  binding: ExternalResourceBindingRecord,
): FeishuResourceBindingValidationResult | null {
  if (request.providerResourceType !== "doc" || !request.operationType.startsWith("docs.")) {
    return null;
  }
  const metadata = readJsonObject(binding.metadataJson);
  const currentDocType = readString(metadata, "docType");
  const requestedDocType = readStringParameterValue(request.parameters.docType);
  if (currentDocType && requestedDocType && currentDocType !== requestedDocType) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_doc_binding_context_mismatch",
      errorMessage: "Feishu Docs operation context does not match the current AgentSpace resource binding.",
      data: {
        providerResourceType: request.providerResourceType,
        field: "docType",
      },
    };
  }
  return null;
}

function validateFeishuBaseResourceBindingContext(
  request: ExternalDataOperationRequest,
  binding: ExternalResourceBindingRecord,
): FeishuResourceBindingValidationResult | null {
  if (request.providerResourceType !== "base" &&
    request.providerResourceType !== "base_table" &&
    request.providerResourceType !== "base_view"
  ) {
    return null;
  }
  if (!request.operationType.startsWith("base.")) {
    return null;
  }
  const metadata = readJsonObject(binding.metadataJson);
  const appToken = request.providerResourceType === "base"
    ? request.providerResourceToken
    : readStringParameterValue(request.parameters.appToken)
      ?? readStringParameterValue(request.parameters.baseToken)
      ?? readString(metadata, "appToken")
      ?? readString(metadata, "baseToken");
  const tableId = request.providerResourceType === "base_table"
    ? request.providerResourceToken
    : readStringParameterValue(request.parameters.tableId)
      ?? readString(metadata, "tableId");
  if (!appToken) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_base_app_token_missing",
      errorMessage: "Feishu Base table operations require a Base app token. Bind the Base table with a URL that includes the app token, or pass appToken explicitly.",
      data: {
        providerResourceType: request.providerResourceType,
        missing: "appToken",
      },
    };
  }
  if (!tableId) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_base_table_id_missing",
      errorMessage: "Feishu Base operations require a table id. Bind a Base table URL that includes table=..., or pass tableId explicitly.",
      data: {
        providerResourceType: request.providerResourceType,
        missing: "tableId",
      },
    };
  }
  const currentAppToken = readString(metadata, "appToken") ?? readString(metadata, "baseToken");
  const requestedAppToken = request.providerResourceType === "base"
    ? request.providerResourceToken
    : readStringParameterValue(request.parameters.appToken)
      ?? readStringParameterValue(request.parameters.baseToken);
  if (currentAppToken && requestedAppToken && currentAppToken !== requestedAppToken) {
    return buildFeishuBaseBindingContextMismatch({
      field: "appToken",
      providerResourceType: request.providerResourceType,
    });
  }
  const currentTableId = readString(metadata, "tableId");
  const requestedTableId = request.providerResourceType === "base_table"
    ? request.providerResourceToken
    : readStringParameterValue(request.parameters.tableId);
  if (currentTableId && requestedTableId && currentTableId !== requestedTableId) {
    return buildFeishuBaseBindingContextMismatch({
      field: "tableId",
      providerResourceType: request.providerResourceType,
    });
  }
  const currentViewId = readString(metadata, "viewId");
  const requestedViewId = request.providerResourceType === "base_view"
    ? request.providerResourceToken
    : readStringParameterValue(request.parameters.viewId);
  if (currentViewId && requestedViewId && currentViewId !== requestedViewId) {
    return buildFeishuBaseBindingContextMismatch({
      field: "viewId",
      providerResourceType: request.providerResourceType,
    });
  }
  return null;
}

function buildFeishuBaseBindingContextMismatch(input: {
  field: "appToken" | "tableId" | "viewId";
  providerResourceType: string;
}): FeishuResourceBindingValidationResult {
  return {
    ok: false,
    errorCode: "feishu.data_operation_base_binding_context_mismatch",
    errorMessage: "Feishu Base operation context does not match the current AgentSpace resource binding.",
    data: {
      providerResourceType: input.providerResourceType,
      field: input.field,
    },
  };
}

function buildFeishuResourceBindingSuggestion(
  request: ExternalDataOperationRequest,
): Record<string, unknown> {
  return {
    provider: FEISHU_PROVIDER_ID,
    action: "create_resource_binding",
    providerResourceType: request.providerResourceType,
    providerResourceToken: request.providerResourceToken,
    recommendedAgentSpaceResourceType: resolveRecommendedAgentSpaceResourceTypeForFeishuBinding(request.providerResourceType),
    operationType: request.operationType,
  };
}

function resolveRecommendedAgentSpaceResourceTypeForFeishuBinding(
  providerResourceType: string,
): "channel_document" | "data_table" | "external_resource" {
  if (providerResourceType === "doc") {
    return "channel_document";
  }
  if (providerResourceType === "sheet" || providerResourceType === "base" || providerResourceType === "base_table" || providerResourceType === "base_view") {
    return "data_table";
  }
  return "external_resource";
}

export function validateFeishuDataOperationScopes(input: {
  request: ExternalDataOperationRequest;
  scopesJson?: string | readonly string[] | null;
}): FeishuDataOperationScopeValidationResult {
  const requiredScope = resolveRequiredFeishuDataOperationScope(input.request);
  const availableScopes = readFeishuScopeList(input.scopesJson);
  if (!requiredScope || availableScopes.includes(requiredScope) || availableScopes.includes("*")) {
    return {
      ok: true,
      requiredScope,
      availableScopes,
    };
  }

  return {
    ok: false,
    errorCode: "feishu.data_operation_scope_missing",
    errorMessage: `Feishu integration is missing required scope "${requiredScope}" for this data operation.`,
    requiredScope,
    availableScopes,
    data: {
      requiredScope,
      availableScopes,
      operationType: input.request.operationType,
      providerResourceType: input.request.providerResourceType,
    },
  };
}

export function validateFeishuResourceBindingScopes(input: {
  providerResourceType: string;
  scopesJson?: string | readonly string[] | null;
}): FeishuResourceBindingScopeValidationResult {
  const requiredScopes = resolveRequiredFeishuResourceBindingScopes(input.providerResourceType);
  const availableScopes = readFeishuScopeList(input.scopesJson);
  const hasWildcard = availableScopes.includes("*");
  const missingScopes = hasWildcard
    ? []
    : requiredScopes.filter((scope) => !availableScopes.includes(scope));
  if (missingScopes.length === 0) {
    return {
      ok: true,
      requiredScopes,
      availableScopes,
    };
  }

  return {
    ok: false,
    errorCode: "feishu.resource_binding_scope_missing",
    errorMessage: `Feishu integration is missing required scopes for ${input.providerResourceType} binding.`,
    missingScopes,
    requiredScopes,
    availableScopes,
    data: {
      providerResourceType: input.providerResourceType,
      missingScopes,
      requiredScopes,
      availableScopes,
    },
  };
}

export async function executeApprovedFeishuDataOperation(input: {
  context: IntegrationRuntimeContext;
  client: FeishuApiClient;
  runId: string;
  request: ExternalDataOperationRequest;
  approvalId?: string;
  approvedPayloadHash?: string;
}): Promise<{
  runId: string;
  result: ExternalDataOperationResult;
}> {
  const run = readExternalDataOperationRunSync({
    workspaceId: input.context.workspaceId,
    runId: input.runId,
  });
  if (!run) {
    return {
      runId: input.runId,
      result: {
        ok: false,
        errorCode: "feishu.data_operation_run_not_found",
        errorMessage: "Feishu data operation run does not exist.",
      },
    };
  }

  const validation = validateApprovedFeishuDataOperationRun({
    context: input.context,
    run,
    request: input.request,
    approvedPayloadHash: input.approvedPayloadHash,
  });
  if (!validation.ok) {
    const result: ExternalDataOperationResult = {
      ok: false,
      errorCode: validation.errorCode,
      errorMessage: validation.errorMessage,
      data: validation.data,
    };
    if (validation.failRun) {
      recordFeishuDataOperationFinishSync({
        workspaceId: input.context.workspaceId,
        runId: run.id,
        result,
      });
    }
    return {
      runId: run.id,
      result,
    };
  }

  const scopeValidation = validateFeishuDataOperationScopesForContext({
    context: input.context,
    request: input.request,
  });
  if (!scopeValidation.ok) {
    const result: ExternalDataOperationResult = {
      ok: false,
      errorCode: scopeValidation.errorCode,
      errorMessage: scopeValidation.errorMessage,
      data: {
        policyDecision: "approved",
        payloadHash: validation.storedPayloadHash,
        approvalId: input.approvalId,
        ...scopeValidation.data,
      },
    };
    recordFeishuDataOperationFinishSync({
      workspaceId: input.context.workspaceId,
      runId: run.id,
      result,
    });
    return {
      runId: run.id,
      result,
    };
  }

  const binding = readExternalResourceBindingByKeySync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    providerResourceType: input.request.providerResourceType,
    providerResourceToken: input.request.providerResourceToken,
  });
  const bindingValidation = validateApprovedFeishuDataOperationBinding({
    context: input.context,
    run,
    request: input.request,
    binding,
  });
  if (!bindingValidation.ok) {
    const result: ExternalDataOperationResult = {
      ok: false,
      errorCode: bindingValidation.errorCode,
      errorMessage: bindingValidation.errorMessage,
      data: {
        policyDecision: "approved",
        payloadHash: validation.storedPayloadHash,
        approvalId: input.approvalId,
        ...bindingValidation.data,
      },
    };
    recordFeishuDataOperationFinishSync({
      workspaceId: input.context.workspaceId,
      runId: run.id,
      result,
    });
    return {
      runId: run.id,
      result,
    };
  }

  const apiRequest = buildFeishuWriteOperationRequest(input.request);
  if (!apiRequest) {
    const result: ExternalDataOperationResult = {
      ok: false,
      errorCode: "feishu.data_operation_invalid_write_request",
      errorMessage: "Feishu write operation parameters are invalid or unsupported.",
      data: {
        policyDecision: "approved",
        payloadHash: validation.storedPayloadHash,
        approvalId: input.approvalId,
      },
    };
    recordFeishuDataOperationFinishSync({
      workspaceId: input.context.workspaceId,
      runId: run.id,
      result,
    });
    return {
      runId: run.id,
      result,
    };
  }

  updateExternalDataOperationRunStatusSync({
    workspaceId: input.context.workspaceId,
    runId: run.id,
    status: "running",
    resultJson: {
      policyDecision: "approved",
      payloadHash: validation.storedPayloadHash,
      approvalId: input.approvalId,
    },
  });

  const result = await runFeishuApiRequest({
    client: input.client,
    request: apiRequest,
    operationRequest: input.request,
    policyDecision: "approved",
    payloadHash: validation.storedPayloadHash,
    approvalId: input.approvalId,
  });
  let finalResult = result;
  if (result.ok) {
    const dataTableWriteSync = syncFeishuDataTableApprovedWriteResultSync({
      workspaceId: input.context.workspaceId,
      binding: bindingValidation.binding,
      operationType: input.request.operationType,
      runId: run.id,
      result,
      approvalId: input.approvalId,
      payloadHash: validation.storedPayloadHash,
    });
    const metadataSync = syncFeishuResourceMetadataSnapshotFromResultSync({
      workspaceId: input.context.workspaceId,
      binding: bindingValidation.binding,
      result,
      updatedBy: "Feishu",
    });
    finalResult = withFeishuApprovedWriteAgentSpaceSyncSummary(result, {
      dataTableWriteSync,
      metadataSync,
    });
  }
  recordFeishuDataOperationFinishSync({
    workspaceId: input.context.workspaceId,
    runId: run.id,
    result: finalResult,
  });

  return {
    runId: run.id,
    result: finalResult,
  };
}

export function validateApprovedFeishuDataOperationRun(input: {
  context: IntegrationRuntimeContext;
  run: ExternalDataOperationRunRecord;
  request: ExternalDataOperationRequest;
  approvedPayloadHash?: string;
}): FeishuApprovedDataOperationValidationResult {
  if (input.run.workspaceId !== input.context.workspaceId || input.run.integrationId !== input.context.integrationId) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_context_mismatch",
      errorMessage: "Feishu data operation run does not belong to this integration context.",
      failRun: false,
      data: {
        runWorkspaceId: input.run.workspaceId,
        runIntegrationId: input.run.integrationId,
      },
    };
  }

  if (input.run.status !== "pending") {
    return {
      ok: false,
      errorCode: "feishu.data_operation_not_pending",
      errorMessage: "Feishu data operation run is not pending approval.",
      failRun: false,
      data: {
        runStatus: input.run.status,
      },
    };
  }

  if (!runMatchesRequest(input.run, input.request)) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_request_mismatch",
      errorMessage: "Approved Feishu data operation request does not match the pending run.",
      failRun: true,
      data: {
        runOperationType: input.run.operationType,
        requestOperationType: input.request.operationType,
        runProviderResourceType: input.run.providerResourceType,
        requestProviderResourceType: input.request.providerResourceType,
      },
    };
  }

  const storedPayloadHash = readPayloadHash(input.run.requestJson);
  if (!storedPayloadHash) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_payload_hash_missing",
      errorMessage: "Pending Feishu data operation run does not include a payload hash.",
      failRun: true,
    };
  }

  const approvedPayloadHash = input.approvedPayloadHash?.trim();
  if (approvedPayloadHash && approvedPayloadHash !== storedPayloadHash) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_approval_payload_hash_mismatch",
      errorMessage: "Feishu data operation approval payload hash does not match the pending run.",
      failRun: true,
      data: {
        storedPayloadHash,
        approvedPayloadHash,
      },
    };
  }

  const computedPayloadHash = buildFeishuDataOperationPayloadHash(input.request);
  if (computedPayloadHash !== storedPayloadHash) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_payload_hash_mismatch",
      errorMessage: "Feishu data operation payload changed after approval and was refused.",
      failRun: true,
      data: {
        storedPayloadHash,
        computedPayloadHash,
      },
    };
  }

  return {
    ok: true,
    storedPayloadHash,
    computedPayloadHash,
  };
}

export function validateApprovedFeishuDataOperationBinding(input: {
  context: IntegrationRuntimeContext;
  run: ExternalDataOperationRunRecord;
  request: ExternalDataOperationRequest;
  binding?: ExternalResourceBindingRecord | null;
}): FeishuApprovedDataOperationBindingValidationResult {
  const resourceBindingId = input.run.resourceBindingId?.trim();
  if (!resourceBindingId) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_resource_binding_missing",
      errorMessage: "Approved Feishu write operations require the original AgentSpace resource binding.",
      data: {
        operationType: input.request.operationType,
        providerResourceType: input.request.providerResourceType,
      },
    };
  }

  if (!input.binding) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_resource_binding_missing",
      errorMessage: "Approved Feishu write operation resource binding no longer exists.",
      data: {
        resourceBindingId,
        operationType: input.request.operationType,
        providerResourceType: input.request.providerResourceType,
      },
    };
  }

  if (input.binding.id !== resourceBindingId) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_resource_binding_id_mismatch",
      errorMessage: "Approved Feishu write operation resource binding no longer matches the pending run.",
      data: {
        runResourceBindingId: resourceBindingId,
        currentResourceBindingId: input.binding.id,
      },
    };
  }

  return validateFeishuResourceBindingForDataOperation({
    context: input.context,
    request: input.request,
    binding: input.binding,
    operationKind: "write",
  });
}

async function runFeishuDataOperationPlan(input: {
  client: FeishuApiClient;
  plan: ReturnType<typeof planFeishuDataOperation>;
  request: ExternalDataOperationRequest;
}): Promise<ExternalDataOperationResult> {
  if (input.plan.decision !== "allow" || !input.plan.request) {
    return buildFeishuBlockedOperationResult({
      decision: input.plan.decision,
      reasonCode: input.plan.reasonCode ?? "operation_not_allowed",
    });
  }

  return runFeishuApiRequest({
    client: input.client,
    request: input.plan.request,
    operationRequest: input.request,
    policyDecision: input.plan.decision,
  });
}

async function runFeishuApiRequest(input: {
  client: FeishuApiClient;
  request: Parameters<FeishuApiClient["request"]>[0];
  operationRequest: ExternalDataOperationRequest;
  policyDecision: string;
  payloadHash?: string;
  approvalId?: string;
}): Promise<ExternalDataOperationResult> {
  try {
    const response = await input.client.request<Record<string, unknown>>(input.request);
    return {
      ok: true,
      data: {
        policyDecision: input.policyDecision,
        payloadHash: input.payloadHash,
        approvalId: input.approvalId,
        ...summarizeFeishuDataOperationResponse(input.operationRequest, response),
      },
    };
  } catch (error) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      data: {
        policyDecision: input.policyDecision,
        payloadHash: input.payloadHash,
        approvalId: input.approvalId,
      },
    };
  }
}

function runMatchesRequest(
  run: ExternalDataOperationRunRecord,
  request: ExternalDataOperationRequest,
): boolean {
  return run.operationType === request.operationType &&
    run.providerResourceType === request.providerResourceType &&
    run.providerResourceToken === request.providerResourceToken &&
    run.actorType === request.actorType &&
    normalizeOptionalText(run.actorId) === normalizeOptionalText(request.actorId);
}

export function applyFeishuResourceBindingParameters(
  request: ExternalDataOperationRequest,
  binding: ExternalResourceBindingRecord,
): ExternalDataOperationRequest {
  const metadata = readJsonObject(binding.metadataJson);
  if (request.providerResourceType === "doc") {
    const docType = readString(metadata, "docType");
    if (!docType || request.parameters.docType !== undefined) {
      return request;
    }
    return {
      ...request,
      parameters: {
        ...request.parameters,
        docType,
      },
    };
  }
  if (request.providerResourceType !== "base_table" && request.providerResourceType !== "base_view") {
    return request;
  }
  return {
    ...request,
    parameters: {
      ...request.parameters,
      appToken: request.parameters.appToken ?? readString(metadata, "appToken") ?? readString(metadata, "baseToken"),
      tableId: request.parameters.tableId ?? readString(metadata, "tableId"),
      viewId: request.parameters.viewId ?? readString(metadata, "viewId"),
    },
  };
}

const defaultFeishuAgentSpaceResourceAccessDependencies: FeishuAgentSpaceResourceAccessDependencies = {
  canViewChannelDocument(input) {
    try {
      return canViewChannelDocumentSync(
        input.documentId,
        input.actorId,
        input.actorType,
        input.workspaceId,
      );
    } catch {
      return false;
    }
  },
  readDataTable(input) {
    return readDataTableSync(input.tableId, input.workspaceId) ?? null;
  },
  canReadChannel(input) {
    return canReadChannelForActorSync(input);
  },
};

export function isFeishuExternalGuestDataOperationActor(
  actor: FeishuBoundDataOperationActor | undefined,
): actor is FeishuExternalGuestDataOperationActor {
  return actor?.actorType === "external_guest";
}

function isFeishuUserDataOperationActor(
  actor: FeishuBoundDataOperationActor | undefined,
): actor is FeishuUserDataOperationActor {
  return Boolean(actor) && actor?.actorType !== "external_guest";
}

function validateFeishuExternalGuestResourceReadForDataOperation(input: {
  request: ExternalDataOperationRequest;
  binding: ExternalResourceBindingRecord;
  actor: FeishuExternalGuestDataOperationActor;
}): FeishuAgentSpaceResourceAccessValidationResult {
  if (input.actor.permissionProfile === "none") {
    return {
      ok: false,
      errorCode: "feishu.data_operation_external_guest_resource_denied",
      errorMessage: "External guest policy does not allow Feishu resource reads.",
      data: {
        actorType: "external_guest",
        externalActorReference: input.actor.providerUserRefHash,
        externalGuestPermissionProfile: input.actor.permissionProfile,
      },
    };
  }
  if (!isFeishuResourceBindingGuestReadable(input.binding)) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_external_guest_resource_denied",
      errorMessage: "External guests can only read Feishu resources explicitly marked guest-readable.",
      data: {
        actorType: "external_guest",
        externalActorReference: input.actor.providerUserRefHash,
      },
    };
  }
  const bindingChannelName = input.binding.channelName?.trim();
  const requestChannelName = readStringParameterValue(input.request.parameters.channelName)
    ?? input.actor.sourceChannelName?.trim();
  if (!bindingChannelName || !requestChannelName) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_external_guest_channel_scope_denied",
      errorMessage: "External guest Feishu reads must be scoped to the current AgentSpace channel.",
      data: {
        actorType: "external_guest",
        externalActorReference: input.actor.providerUserRefHash,
      },
    };
  }
  if (requestChannelName && requestChannelName !== bindingChannelName) {
    return {
      ok: false,
      errorCode: "feishu.data_operation_external_guest_channel_scope_denied",
      errorMessage: "External guests can only read Feishu resources bound to the current channel.",
      data: {
        actorType: "external_guest",
        externalActorReference: input.actor.providerUserRefHash,
        channelName: bindingChannelName,
      },
    };
  }
  return { ok: true };
}

function isFeishuResourceBindingGuestReadable(binding: ExternalResourceBindingRecord): boolean {
  const permissions = readJsonObject(binding.permissionsJson);
  const externalGuest = readRecordValue(permissions.externalGuest)
    ?? readRecordValue(permissions.external_guest);
  return readBooleanValue(permissions.guestReadable) === true ||
    readBooleanValue(permissions.externalGuestReadable) === true ||
    readBooleanValue(externalGuest?.read) === true ||
    readBooleanValue(externalGuest?.canRead) === true;
}

function applyFeishuDataOperationGovernanceContext(
  request: ExternalDataOperationRequest,
  input: {
    actor?: FeishuBoundDataOperationActor;
    binding?: ExternalResourceBindingRecord;
    integrationId?: string;
  },
): ExternalDataOperationRequest {
  const existing = readRecordValue(request.parameters.feishuGovernance)
    ?? readRecordValue(request.parameters.governanceContext)
    ?? {};
  const actorType = readFeishuGovernanceActorType(existing)
    ?? resolveFeishuDataOperationGovernanceActorType(request, input.actor);
  const channelName = readStringValue(existing.channelName)
    ?? input.binding?.channelName?.trim()
    ?? readStringParameterValue(request.parameters.channelName);
  const externalGuest = isFeishuExternalGuestDataOperationActor(input.actor) ? input.actor : undefined;
  const userActor = isFeishuUserDataOperationActor(input.actor) ? input.actor : undefined;
  const governanceContext = removeUndefinedProperties({
    ...existing,
    provider: FEISHU_PROVIDER_ID,
    agentId: readStringValue(existing.agentId)
      ?? externalGuest?.agentId
      ?? userActor?.agentId
      ?? (request.actorType === "agent" ? request.actorId?.trim() : undefined),
    botBindingId: readStringValue(existing.botBindingId)
      ?? externalGuest?.botBindingId
      ?? userActor?.botBindingId
      ?? (actorType !== "system" ? input.integrationId : undefined),
    channelName,
    actorType,
    actorUserId: actorType === "user"
      ? readStringValue(existing.actorUserId) ?? userActor?.userId.trim() ?? request.actorId?.trim()
      : undefined,
    externalActorReference: actorType === "external_guest"
      ? readStringValue(existing.externalActorReference)
        ?? readStringValue(existing.externalGuestReference)
        ?? externalGuest?.providerUserRefHash
      : readStringValue(existing.externalActorReference),
    externalGuestPermissionProfile: actorType === "external_guest"
      ? readStringValue(existing.externalGuestPermissionProfile) ?? externalGuest?.permissionProfile
      : undefined,
    externalChatReference: readStringValue(existing.externalChatReference)
      ?? hashFeishuAuditReference(externalGuest?.sourceChatId),
  });
  if (Object.keys(governanceContext).length === 0) {
    return request;
  }
  return {
    ...request,
    parameters: {
      ...request.parameters,
      feishuGovernance: governanceContext,
    },
  };
}

function resolveFeishuDataOperationGovernanceActorType(
  request: ExternalDataOperationRequest,
  actor: FeishuBoundDataOperationActor | undefined,
): "user" | "external_guest" | "agent" | "system" {
  if (isFeishuExternalGuestDataOperationActor(actor)) {
    return "external_guest";
  }
  if (isFeishuUserDataOperationActor(actor)) {
    return "user";
  }
  if (request.actorType === "user") {
    return "user";
  }
  if (request.actorType === "agent") {
    return "agent";
  }
  return "system";
}

function readFeishuGovernanceActorType(
  value: Record<string, unknown>,
): "user" | "external_guest" | "agent" | "system" | undefined {
  const actorType = readStringValue(value.actorType);
  return actorType === "user" ||
    actorType === "external_guest" ||
    actorType === "agent" ||
    actorType === "system"
    ? actorType
    : undefined;
}

function normalizeAgentSpaceResourceType(value: string): ExternalResourceBindingAgentSpaceType | undefined {
  if (value === "channel_document" || value === "data_table" || value === "knowledge_page") {
    return value;
  }
  return undefined;
}

function resolveFeishuDocumentAccessActor(
  request: ExternalDataOperationRequest,
  actor?: FeishuBoundDataOperationActor,
): { actorId: string; actorType: "human" | "agent" } | undefined {
  if (request.actorType === "agent") {
    const actorId = request.actorId?.trim();
    return actorId ? { actorId, actorType: "agent" } : undefined;
  }
  if (request.actorType === "user") {
    const actorId = isFeishuUserDataOperationActor(actor)
      ? actor.displayName?.trim() || actor.userId.trim() || request.actorId?.trim()
      : request.actorId?.trim();
    return actorId ? { actorId, actorType: "human" } : undefined;
  }
  return undefined;
}

function validateFeishuDataOperationScopesForContext(input: {
  context: IntegrationRuntimeContext;
  request: ExternalDataOperationRequest;
}): FeishuDataOperationScopeValidationResult {
  const integration = readExternalIntegrationSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
  });
  return validateFeishuDataOperationScopes({
    request: input.request,
    scopesJson: integration?.scopesJson,
  });
}

function resolveRequiredFeishuDataOperationScope(request: ExternalDataOperationRequest): string | undefined {
  if (request.operationType === "docs.refresh_metadata") {
    return "drive:drive";
  }
  if (request.providerResourceType === "doc" || request.operationType.startsWith("docs.")) {
    return "docx:document";
  }
  if (request.providerResourceType === "sheet" || request.operationType.startsWith("sheets.")) {
    return "sheets:spreadsheet";
  }
  if (request.providerResourceType === "base" ||
    request.providerResourceType === "base_table" ||
    request.providerResourceType === "base_view" ||
    request.operationType.startsWith("base.")
  ) {
    return "bitable:app";
  }
  return undefined;
}

function resolveRequiredFeishuResourceBindingScopes(providerResourceType: string): string[] {
  if (providerResourceType === "doc") {
    return ["docx:document", "drive:drive"];
  }
  if (providerResourceType === "sheet") {
    return ["sheets:spreadsheet"];
  }
  if (
    providerResourceType === "base" ||
    providerResourceType === "base_table" ||
    providerResourceType === "base_view"
  ) {
    return ["bitable:app"];
  }
  return [];
}

function readFeishuScopeList(scopesJson: string | readonly string[] | null | undefined): string[] {
  if (Array.isArray(scopesJson)) {
    return normalizeScopeList(scopesJson);
  }
  if (typeof scopesJson !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(scopesJson) as unknown;
    return Array.isArray(parsed) ? normalizeScopeList(parsed) : [];
  } catch {
    return normalizeScopeList(scopesJson.split(/\s+/));
  }
}

function normalizeScopeList(values: readonly unknown[]): string[] {
  return Array.from(new Set(values
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter((value) => value.length > 0)))
    .sort();
}

function readPayloadHash(requestJson: string): string | undefined {
  try {
    const parsed = JSON.parse(requestJson) as Record<string, unknown>;
    const payloadHash = parsed.payloadHash;
    return typeof payloadHash === "string" && payloadHash.trim() ? payloadHash.trim() : undefined;
  } catch {
    return undefined;
  }
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function readStringParameterValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recordFeishuDataOperationDeniedSync(input: {
  context: IntegrationRuntimeContext;
  request: ExternalDataOperationRequest;
  resourceBindingId?: string;
  reasonCode: string;
  errorMessage: string;
  data?: Record<string, unknown>;
}): {
  runId: string;
  result: ExternalDataOperationResult;
} {
  const result: ExternalDataOperationResult = {
    ok: false,
    errorCode: input.reasonCode,
    errorMessage: input.errorMessage,
    data: {
      policyDecision: "deny",
      policyReasonCode: input.reasonCode,
      ...(input.data ?? {}),
    },
  };
  const run = recordExternalDataOperationPlanSync({
    context: input.context,
    resourceBindingId: input.resourceBindingId,
    request: input.request,
    status: "failed",
    requestJson: {
      policyDecision: "deny",
      policyReasonCode: input.reasonCode,
      governanceContext: summarizeFeishuStoredDataOperationGovernanceContext(input.request),
      requestSummary: summarizeFeishuStoredDataOperationRequest(input.request),
    },
  });
  recordFeishuDataOperationFinishSync({
    workspaceId: input.context.workspaceId,
    runId: run.id,
    result,
  });
  return {
    runId: run.id,
    result,
  };
}

function recordFeishuDataOperationFinishSync(input: {
  workspaceId: string;
  runId: string;
  result: ExternalDataOperationResult;
}): ExternalDataOperationRunRecord {
  const data = input.result.data && typeof input.result.data === "object" && !Array.isArray(input.result.data)
    ? summarizeFeishuStoredDataOperationResultData(input.result.data as Record<string, unknown>)
    : input.result.data;
  return recordExternalDataOperationFinishSync({
    workspaceId: input.workspaceId,
    runId: input.runId,
    result: {
      ...input.result,
      data,
    },
  });
}

function withFeishuApprovedWriteAgentSpaceSyncSummary(
  result: ExternalDataOperationResult,
  input: {
    dataTableWriteSync: ReturnType<typeof syncFeishuDataTableApprovedWriteResultSync>;
    metadataSync: ReturnType<typeof syncFeishuResourceMetadataSnapshotFromResultSync>;
  },
): ExternalDataOperationResult {
  const data = result.data && typeof result.data === "object" && !Array.isArray(result.data)
    ? result.data as Record<string, unknown>
    : {};
  return {
    ...result,
    data: {
      ...data,
      agentSpaceSync: {
        dataTableLastApprovedWriteSynced: input.dataTableWriteSync.synced,
        ...(!input.dataTableWriteSync.synced ? { dataTableReasonCode: input.dataTableWriteSync.reasonCode } : {}),
        resourceMetadataSynced: input.metadataSync.synced,
        ...(input.metadataSync.synced ? { resourceMetadataTargetType: input.metadataSync.targetType } : {}),
        ...(!input.metadataSync.synced ? { resourceMetadataReasonCode: input.metadataSync.reasonCode } : {}),
      },
    },
  };
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

function readString(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function readStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBooleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readRecordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function removeUndefinedProperties<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function hashFeishuAuditReference(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return `ref_${createHash("sha256").update(trimmed).digest("hex").slice(0, 16)}`;
}
