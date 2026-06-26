import type {
  ExternalDataOperationRequest,
  ExternalDataOperationResult,
  IntegrationRuntimeContext,
} from "./types.ts";

export interface ExternalResourceDescriptor {
  providerResourceType: string;
  providerResourceToken: string;
  providerResourceUrl?: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
}

export interface ExternalResourceOperationDescriptor {
  operationType: string;
  providerResourceTypes: string[];
  description: string;
  writeOperation: boolean;
}

export interface ExternalDocumentProviderAdapter {
  provider: string;
  supportedOperations: ExternalResourceOperationDescriptor[];
  resolveResource(
    context: IntegrationRuntimeContext,
    resourceUrlOrToken: string,
  ): Promise<ExternalResourceDescriptor | null> | ExternalResourceDescriptor | null;
  executeOperation?(
    context: IntegrationRuntimeContext,
    request: ExternalDataOperationRequest,
  ): Promise<ExternalDataOperationResult> | ExternalDataOperationResult;
}
