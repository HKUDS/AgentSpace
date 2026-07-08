export {
  IntegrationProviderError,
  createIntegrationProviderError,
} from "./errors.ts";
export {
  type ExternalResourceDescriptor,
  type ExternalResourceOperationDescriptor,
  type ExternalDocumentProviderAdapter,
} from "./document-provider.ts";
export {
  type ExternalOutboundMessagePayload,
  type IncomingMessageRequest,
  type IncomingMessageVerificationResult,
  type MessageTransportAdapter,
} from "./message-transport.ts";
export {
  clearIntegrationProviderAdaptersForTests,
  listIntegrationProviderAdapters,
  readIntegrationProviderAdapter,
  registerIntegrationProviderAdapter,
  type IntegrationProviderAdapter,
} from "./registry.ts";
export {
  recordExternalDataOperationFinishSync,
  recordExternalDataOperationPlanSync,
  recordExternalDataOperationStartSync,
} from "./data-operations.ts";
export {
  buildExternalNoticeMetadata,
  type ExternalNoticeMetadataInput,
} from "./notices.ts";
export {
  recordExternalInboundEventSync,
  resolveExternalInboundDuplicateMessageSync,
  resolveExternalDispatchedTaskFromRecords,
  resolveExternalDispatchedTaskSync,
  type ExternalInboundDuplicateMessageInput,
  type ExternalInboundDuplicateMessageResult,
  type ExternalInboundEventRecordInput,
  type ExternalDispatchedTaskLookupInput,
  type ExternalDispatchedTaskMatchInput,
  type ExternalDispatchedTaskRecord,
} from "./inbound-dispatch.ts";
export {
  enqueueExternalOutboundMessageSync,
  listDueExternalOutboundMessagesSync,
} from "./outbox.ts";
export {
  buildExternalIdHash,
  buildExternalIdReference,
  buildLabeledExternalIdReference,
  buildOptionalExternalIdReference,
  type ExternalReferenceOptions,
} from "./references.ts";
export {
  createExternalWorkerMetrics,
  recordExternalWorkerOutboxMetrics,
  type ExternalWorkerError,
  type ExternalWorkerMetrics,
} from "./worker-metrics.ts";
export {
  createFakeIntegrationProviderAdapter,
  FAKE_INTEGRATION_PROVIDER_ID,
  type FakeIntegrationProviderAdapterOptions,
} from "./fake-adapter.ts";
export type {
  AgentSpaceOutboundMessage,
  ExternalDataOperationRequest,
  ExternalDataOperationPlan,
  ExternalDataOperationPolicyDecision,
  ExternalDataOperationResult,
  ExternalMessageAttachment,
  ExternalMessageEnvelope,
  IntegrationHealth,
  IntegrationCapability,
  IntegrationProviderDescriptor,
  IntegrationRuntimeContext,
  MessageTransportSendInput,
  NormalizedExternalMessageEvent,
} from "./types.ts";
