import {
  createIntegrationProviderError,
  type AgentSpaceOutboundMessage,
  type ExternalMessageEnvelope,
  type ExternalOutboundMessagePayload,
  type IncomingMessageRequest,
  type IncomingMessageVerificationResult,
  type IntegrationProviderAdapter,
  type IntegrationRuntimeContext,
} from "../../core/index.ts";
import { SLACK_PROVIDER_DESCRIPTOR, SLACK_PROVIDER_ID } from "./constants.ts";
import {
  buildSlackUrlVerificationResponse,
  isSlackUrlVerificationPayload,
} from "./events.ts";
import { normalizeSlackInboundMessage } from "./normalize-message.ts";
import { buildSlackTextOutboundMessage } from "./outbound.ts";

export const slackIntegrationProviderAdapter: IntegrationProviderAdapter = {
  descriptor: SLACK_PROVIDER_DESCRIPTOR,
  messageTransport: {
    provider: SLACK_PROVIDER_ID,
    verifyIncomingRequest(
      _context: IntegrationRuntimeContext,
      request: IncomingMessageRequest,
    ): IncomingMessageVerificationResult {
      if (isSlackUrlVerificationPayload(request.payload)) {
        return {
          ok: true,
          challengeResponse: buildSlackUrlVerificationResponse(request.payload),
        };
      }
      return {
        ok: false,
        reason: "slack.signature_requires_stored_credentials",
      };
    },
    normalizeInboundMessage(
      context: IntegrationRuntimeContext,
      request: IncomingMessageRequest,
    ): ExternalMessageEnvelope | null {
      return normalizeSlackInboundMessage({
        context,
        payload: request.payload,
      });
    },
    buildOutboundMessage(
      _context: IntegrationRuntimeContext,
      message: AgentSpaceOutboundMessage,
    ): ExternalOutboundMessagePayload {
      const targetExternalChatId = typeof message.metadata?.externalChatId === "string"
        ? message.metadata.externalChatId
        : undefined;
      if (!targetExternalChatId) {
        throw createIntegrationProviderError({
          provider: SLACK_PROVIDER_ID,
          code: "slack.external_chat_missing",
          message: "Slack outbound messages require an external channel id or an active channel binding.",
        });
      }
      return buildSlackTextOutboundMessage({
        targetExternalChatId,
        targetExternalThreadId: message.externalThreadId,
        text: message.text,
      });
    },
  },
};
