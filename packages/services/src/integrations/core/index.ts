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
  enqueueExternalOutboundMessageSync,
  listDueExternalOutboundMessagesSync,
} from "./outbox.ts";
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
