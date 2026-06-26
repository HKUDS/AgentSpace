import type { ExternalIntegrationProvider } from "@agent-space/db";
import type { AgentSpaceOutboundMessage, ExternalMessageEnvelope, IntegrationRuntimeContext } from "./types.ts";

export interface IncomingMessageRequest {
  headers: Record<string, string | string[] | undefined>;
  bodyText: string;
  payload: Record<string, unknown>;
}

export interface IncomingMessageVerificationResult {
  ok: boolean;
  challengeResponse?: Record<string, unknown>;
  reason?: string;
}

export interface ExternalOutboundMessagePayload {
  targetExternalChatId: string;
  targetExternalThreadId?: string;
  payload: Record<string, unknown>;
}

export interface MessageTransportAdapter {
  provider: ExternalIntegrationProvider;
  verifyIncomingRequest(
    context: IntegrationRuntimeContext,
    request: IncomingMessageRequest,
  ): Promise<IncomingMessageVerificationResult> | IncomingMessageVerificationResult;
  normalizeInboundMessage(
    context: IntegrationRuntimeContext,
    request: IncomingMessageRequest,
  ): Promise<ExternalMessageEnvelope | null> | ExternalMessageEnvelope | null;
  buildOutboundMessage(
    context: IntegrationRuntimeContext,
    message: AgentSpaceOutboundMessage,
  ): Promise<ExternalOutboundMessagePayload> | ExternalOutboundMessagePayload;
}
