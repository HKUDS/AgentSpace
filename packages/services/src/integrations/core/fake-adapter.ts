import { createIntegrationProviderError } from "./errors.ts";
import type { ExternalDocumentProviderAdapter } from "./document-provider.ts";
import type {
  ExternalOutboundMessagePayload,
  IncomingMessageRequest,
  IncomingMessageVerificationResult,
  MessageTransportAdapter,
} from "./message-transport.ts";
import type {
  AgentSpaceOutboundMessage,
  ExternalDataOperationRequest,
  ExternalDataOperationResult,
  ExternalMessageEnvelope,
  IntegrationHealth,
  IntegrationProviderDescriptor,
  IntegrationRuntimeContext,
} from "./types.ts";
import type { IntegrationProviderAdapter } from "./registry.ts";

export const FAKE_INTEGRATION_PROVIDER_ID = "fake";

export interface FakeIntegrationProviderAdapterOptions {
  now?: () => string;
  onHealthCheck?: () => void;
}

export function createFakeIntegrationProviderAdapter(
  options: FakeIntegrationProviderAdapterOptions = {},
): IntegrationProviderAdapter {
  const now = options.now ?? (() => new Date().toISOString());
  const descriptor: IntegrationProviderDescriptor = {
    provider: FAKE_INTEGRATION_PROVIDER_ID,
    displayName: "Fake Integration",
    capabilities: ["message_transport", "docs_data_plane"],
    supportedTransportModes: ["http_webhook"],
    defaultScopes: ["fake:messages", "fake:documents"],
    resourceTypes: ["doc"],
  };

  return {
    descriptor,
    messageTransport: createFakeMessageTransport(now),
    documentProvider: createFakeDocumentProvider(),
    checkHealth(): IntegrationHealth {
      options.onHealthCheck?.();
      return {
        status: "healthy",
        checkedAt: now(),
        metadata: {
          blockingPageFetch: false,
        },
      };
    },
  };
}

function createFakeMessageTransport(now: () => string): MessageTransportAdapter {
  return {
    provider: FAKE_INTEGRATION_PROVIDER_ID,
    verifyIncomingRequest(
      _context: IntegrationRuntimeContext,
      request: IncomingMessageRequest,
    ): IncomingMessageVerificationResult {
      const challenge = readString(request.payload.challenge);
      if (challenge) {
        return {
          ok: true,
          challengeResponse: { challenge },
        };
      }

      return {
        ok: readString(request.payload.token) === "valid" || request.headers["x-fake-signature"] === "valid",
        reason: "fake_signature_invalid",
      };
    },
    normalizeInboundMessage(
      context: IntegrationRuntimeContext,
      request: IncomingMessageRequest,
    ): ExternalMessageEnvelope | null {
      if (readString(request.payload.type) !== "message") {
        return null;
      }
      const externalChatId = readString(request.payload.externalChatId);
      const externalMessageId = readString(request.payload.externalMessageId);
      if (!externalChatId || !externalMessageId) {
        return null;
      }
      return {
        provider: FAKE_INTEGRATION_PROVIDER_ID,
        integrationId: context.integrationId,
        externalEventId: readString(request.payload.externalEventId) ?? `fake-event-${externalMessageId}`,
        eventType: "fake.message",
        externalChatId,
        externalMessageId,
        externalThreadId: readString(request.payload.externalThreadId),
        externalSenderId: readString(request.payload.externalSenderId),
        text: readString(request.payload.text),
        attachments: [],
        rawPayload: request.payload,
        receivedAt: now(),
      };
    },
    buildOutboundMessage(
      _context: IntegrationRuntimeContext,
      message: AgentSpaceOutboundMessage,
    ): ExternalOutboundMessagePayload {
      const targetExternalChatId = readString(message.metadata?.externalChatId);
      if (!targetExternalChatId) {
        throw createIntegrationProviderError({
          provider: FAKE_INTEGRATION_PROVIDER_ID,
          code: "fake.external_chat_missing",
          message: "Fake outbound messages require an external chat id.",
        });
      }
      return {
        targetExternalChatId,
        targetExternalThreadId: message.externalThreadId,
        payload: {
          msg_type: "text",
          text: message.text,
        },
      };
    },
  };
}

function createFakeDocumentProvider(): ExternalDocumentProviderAdapter {
  const supportedOperations = [
    {
      operationType: "doc.read",
      providerResourceTypes: ["doc"],
      description: "Read a fake document.",
      writeOperation: false,
    },
    {
      operationType: "doc.update",
      providerResourceTypes: ["doc"],
      description: "Update a fake document.",
      writeOperation: true,
    },
  ];

  return {
    provider: FAKE_INTEGRATION_PROVIDER_ID,
    supportedOperations,
    resolveResource(_context: IntegrationRuntimeContext, resourceUrlOrToken: string) {
      const parsed = parseFakeResource(resourceUrlOrToken);
      return parsed
        ? {
          providerResourceType: parsed.type,
          providerResourceToken: parsed.token,
          providerResourceUrl: `fake://${parsed.type}/${parsed.token}`,
          displayName: `Fake ${parsed.type} ${parsed.token}`,
        }
        : null;
    },
    executeOperation(
      _context: IntegrationRuntimeContext,
      request: ExternalDataOperationRequest,
    ): ExternalDataOperationResult {
      const descriptor = supportedOperations.find((operation) =>
        operation.operationType === request.operationType &&
        operation.providerResourceTypes.includes(request.providerResourceType)
      );
      if (!descriptor) {
        return {
          ok: false,
          errorCode: "fake.unsupported_operation",
          errorMessage: "Unsupported fake operation.",
        };
      }
      if (descriptor.writeOperation && !hasPolicyProof(request)) {
        return {
          ok: false,
          errorCode: "fake.policy_required",
          errorMessage: "Fake write operations require a policy decision and payload hash.",
        };
      }
      return {
        ok: true,
        data: {
          operationType: request.operationType,
          providerResourceToken: request.providerResourceToken,
          writeOperation: descriptor.writeOperation,
        },
      };
    },
  };
}

function hasPolicyProof(request: ExternalDataOperationRequest): boolean {
  const decision = readString(request.parameters.policyDecision);
  const payloadHash = readString(request.parameters.payloadHash);
  return Boolean(
    payloadHash &&
    (decision === "allow" || decision === "approved"),
  );
}

function parseFakeResource(value: string): { type: string; token: string } | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "fake:") {
      return null;
    }
    const type = parsed.hostname.trim();
    const token = parsed.pathname.replace(/^\/+/, "").trim();
    return type && token ? { type, token } : null;
  } catch {
    return null;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
