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
import { FEISHU_PROVIDER_DESCRIPTOR, FEISHU_PROVIDER_ID } from "./constants.ts";
import { feishuDocumentProviderAdapter } from "./data-plane.ts";
import {
  buildFeishuUrlVerificationResponse,
  isFeishuUrlVerificationPayload,
  verifyFeishuCallbackToken,
} from "./events.ts";
import { normalizeFeishuInboundMessage } from "./normalize-message.ts";
import { buildFeishuTextOutboundMessage } from "./outbound.ts";

export const feishuIntegrationProviderAdapter: IntegrationProviderAdapter = {
  descriptor: FEISHU_PROVIDER_DESCRIPTOR,
  messageTransport: {
    provider: FEISHU_PROVIDER_ID,
    verifyIncomingRequest(
      _context: IntegrationRuntimeContext,
      request: IncomingMessageRequest,
    ): IncomingMessageVerificationResult {
      if (isFeishuUrlVerificationPayload(request.payload)) {
        return {
          ok: true,
          challengeResponse: buildFeishuUrlVerificationResponse(request.payload),
        };
      }
      return {
        ok: verifyFeishuCallbackToken({ payload: request.payload }),
      };
    },
    normalizeInboundMessage(
      context: IntegrationRuntimeContext,
      request: IncomingMessageRequest,
    ): ExternalMessageEnvelope | null {
      return normalizeFeishuInboundMessage({
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
          provider: FEISHU_PROVIDER_ID,
          code: "feishu.external_chat_missing",
          message: "Feishu outbound messages require an external chat id or an active channel binding.",
        });
      }
      return buildFeishuTextOutboundMessage({
        targetExternalChatId,
        targetExternalThreadId: message.externalThreadId,
        text: message.text,
      });
    },
  },
  documentProvider: feishuDocumentProviderAdapter,
};
