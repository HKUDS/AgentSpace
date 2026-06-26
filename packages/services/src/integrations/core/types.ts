import type {
  ExternalDataOperationActorType,
  ExternalIntegrationHealthStatus,
  ExternalIntegrationProvider,
  ExternalIntegrationTransportMode,
  ExternalResourceBindingProviderType,
} from "@agent-space/db";
import type { MessageAttachment } from "@agent-space/domain/workspace";

export type IntegrationCapability =
  | "message_transport"
  | "docs_data_plane"
  | "sheets_data_plane"
  | "base_data_plane";

export interface IntegrationProviderDescriptor {
  provider: ExternalIntegrationProvider;
  displayName: string;
  capabilities: IntegrationCapability[];
  supportedTransportModes: ExternalIntegrationTransportMode[];
  defaultScopes: string[];
  resourceTypes: ExternalResourceBindingProviderType[];
}

export interface IntegrationRuntimeContext {
  workspaceId: string;
  integrationId: string;
  provider: ExternalIntegrationProvider;
  actorUserId?: string;
}

export interface ExternalMessageAttachment {
  id?: string;
  fileName?: string;
  mediaType?: string;
  url?: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}

export interface ExternalMessageEnvelope {
  provider: ExternalIntegrationProvider;
  integrationId: string;
  externalEventId: string;
  eventType: string;
  externalChatId: string;
  externalMessageId: string;
  externalThreadId?: string;
  externalSenderId?: string;
  text?: string;
  attachments: ExternalMessageAttachment[];
  rawPayload: Record<string, unknown>;
  receivedAt: string;
}

export type NormalizedExternalMessageEvent = ExternalMessageEnvelope;

export interface AgentSpaceOutboundMessage {
  channelName: string;
  text: string;
  attachments?: MessageAttachment[];
  agentSpaceMessageId?: string;
  externalThreadId?: string;
  metadata?: Record<string, unknown>;
}

export type MessageTransportSendInput = AgentSpaceOutboundMessage;

export interface IntegrationHealth {
  status: ExternalIntegrationHealthStatus;
  checkedAt: string;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface ExternalDataOperationRequest {
  operationType: string;
  providerResourceType: ExternalResourceBindingProviderType;
  providerResourceToken: string;
  actorType: ExternalDataOperationActorType;
  actorId?: string;
  parameters: Record<string, unknown>;
}

export interface ExternalDataOperationResult {
  ok: boolean;
  data?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export type ExternalDataOperationPolicyDecision = "allow" | "require_approval" | "deny" | "approved";

export interface ExternalDataOperationPlan {
  decision: ExternalDataOperationPolicyDecision;
  writeOperation: boolean;
  reasonCode?: string;
}
