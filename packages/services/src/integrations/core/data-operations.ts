import {
  createExternalDataOperationRunSync,
  updateExternalDataOperationRunStatusSync,
  type ExternalDataOperationRunStatus,
  type ExternalDataOperationRunRecord,
} from "@agent-space/db";
import type {
  ExternalDataOperationRequest,
  ExternalDataOperationResult,
  IntegrationRuntimeContext,
} from "./types.ts";

export function recordExternalDataOperationStartSync(input: {
  context: IntegrationRuntimeContext;
  resourceBindingId?: string;
  request: ExternalDataOperationRequest;
}): ExternalDataOperationRunRecord {
  return recordExternalDataOperationRunSync({
    ...input,
    status: "running",
    requestJson: input.request.parameters,
  });
}

export function recordExternalDataOperationPlanSync(input: {
  context: IntegrationRuntimeContext;
  resourceBindingId?: string;
  request: ExternalDataOperationRequest;
  requestJson?: Record<string, unknown>;
  status?: ExternalDataOperationRunStatus;
}): ExternalDataOperationRunRecord {
  return recordExternalDataOperationRunSync({
    ...input,
    status: input.status ?? "pending",
    requestJson: input.requestJson ?? input.request.parameters,
  });
}

function recordExternalDataOperationRunSync(input: {
  context: IntegrationRuntimeContext;
  resourceBindingId?: string;
  request: ExternalDataOperationRequest;
  requestJson: Record<string, unknown>;
  status: ExternalDataOperationRunStatus;
}): ExternalDataOperationRunRecord {
  return createExternalDataOperationRunSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    resourceBindingId: input.resourceBindingId,
    operationType: input.request.operationType,
    providerResourceType: input.request.providerResourceType,
    providerResourceToken: input.request.providerResourceToken,
    actorType: input.request.actorType,
    actorId: input.request.actorId,
    status: input.status,
    requestJson: input.requestJson,
  });
}

export function recordExternalDataOperationFinishSync(input: {
  workspaceId: string;
  runId: string;
  result: ExternalDataOperationResult;
}): ExternalDataOperationRunRecord {
  return updateExternalDataOperationRunStatusSync({
    workspaceId: input.workspaceId,
    runId: input.runId,
    status: input.result.ok ? "succeeded" : "failed",
    resultJson: input.result.data ?? {},
    errorCode: input.result.errorCode,
    errorMessage: input.result.errorMessage,
  });
}
