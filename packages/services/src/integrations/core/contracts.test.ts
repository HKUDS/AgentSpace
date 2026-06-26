import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  clearIntegrationProviderAdaptersForTests,
  createFakeIntegrationProviderAdapter,
  FAKE_INTEGRATION_PROVIDER_ID,
  IntegrationProviderError,
  listIntegrationProviderAdapters,
  readIntegrationProviderAdapter,
  registerIntegrationProviderAdapter,
  type IncomingMessageRequest,
  type IntegrationRuntimeContext,
} from "./index.ts";

const context: IntegrationRuntimeContext = {
  workspaceId: "workspace-1",
  integrationId: "integration-1",
  provider: FAKE_INTEGRATION_PROVIDER_ID,
};

beforeEach(() => {
  clearIntegrationProviderAdaptersForTests();
});

test("integration registry only returns registered provider adapters", () => {
  assert.equal(readIntegrationProviderAdapter(FAKE_INTEGRATION_PROVIDER_ID), null);

  const adapter = createFakeIntegrationProviderAdapter();
  registerIntegrationProviderAdapter(adapter);

  assert.equal(readIntegrationProviderAdapter(FAKE_INTEGRATION_PROVIDER_ID), adapter);
  assert.deepEqual(
    listIntegrationProviderAdapters().map((item) => item.descriptor.provider),
    [FAKE_INTEGRATION_PROVIDER_ID],
  );
});

test("fake message transport verifies, normalizes, and builds outbound messages", () => {
  const adapter = createFakeIntegrationProviderAdapter({
    now: () => "2026-06-24T00:00:00.000Z",
  });
  const transport = adapter.messageTransport;
  assert.ok(transport);

  const challenge = transport.verifyIncomingRequest(context, incomingRequest({
    challenge: "challenge-value",
  }));
  assert.deepEqual(challenge, {
    ok: true,
    challengeResponse: { challenge: "challenge-value" },
  });

  const verified = transport.verifyIncomingRequest(context, incomingRequest({
    token: "valid",
    type: "message",
  }));
  assert.equal(verified.ok, true);

  const normalized = transport.normalizeInboundMessage(context, incomingRequest({
    type: "message",
    externalEventId: "evt-1",
    externalChatId: "chat-1",
    externalMessageId: "msg-1",
    externalSenderId: "user-1",
    text: "hello",
  }));
  assert.ok(normalized);
  assert.equal(normalized.provider, FAKE_INTEGRATION_PROVIDER_ID);
  assert.equal(normalized.externalChatId, "chat-1");
  assert.equal(normalized.externalMessageId, "msg-1");
  assert.equal(normalized.text, "hello");
  assert.equal(normalized.receivedAt, "2026-06-24T00:00:00.000Z");

  const outbound = transport.buildOutboundMessage(context, {
    channelName: "general",
    text: "Agent reply",
    externalThreadId: "thread-1",
    metadata: {
      externalChatId: "chat-1",
    },
  });
  assert.deepEqual(outbound, {
    targetExternalChatId: "chat-1",
    targetExternalThreadId: "thread-1",
    payload: {
      msg_type: "text",
      text: "Agent reply",
    },
  });
});

test("adapter errors are normalized as IntegrationProviderError", () => {
  const adapter = createFakeIntegrationProviderAdapter();
  const transport = adapter.messageTransport;
  assert.ok(transport);

  assert.throws(
    () => transport.buildOutboundMessage(context, {
      channelName: "general",
      text: "Agent reply",
    }),
    (error) =>
      error instanceof IntegrationProviderError &&
      error.provider === FAKE_INTEGRATION_PROVIDER_ID &&
      error.code === "fake.external_chat_missing",
  );
});

test("provider health checks are explicit and do not require a blocking page fetch", () => {
  let healthCheckCount = 0;
  const adapter = createFakeIntegrationProviderAdapter({
    now: () => "2026-06-24T00:00:00.000Z",
    onHealthCheck: () => {
      healthCheckCount += 1;
    },
  });
  assert.ok(adapter.checkHealth);

  const health = adapter.checkHealth(context);

  assert.equal(healthCheckCount, 1);
  assert.deepEqual(health, {
    status: "healthy",
    checkedAt: "2026-06-24T00:00:00.000Z",
    metadata: {
      blockingPageFetch: false,
    },
  });
});

test("fake document provider resolves resources and blocks unplanned writes", () => {
  const adapter = createFakeIntegrationProviderAdapter();
  const documentProvider = adapter.documentProvider;
  assert.ok(documentProvider);

  const resource = documentProvider.resolveResource(context, "fake://doc/doc-1");
  assert.deepEqual(resource, {
    providerResourceType: "doc",
    providerResourceToken: "doc-1",
    providerResourceUrl: "fake://doc/doc-1",
    displayName: "Fake doc doc-1",
  });

  const read = documentProvider.executeOperation?.(context, {
    operationType: "doc.read",
    providerResourceType: "doc",
    providerResourceToken: "doc-1",
    actorType: "agent",
    actorId: "Atlas",
    parameters: {},
  });
  assert.deepEqual(read, {
    ok: true,
    data: {
      operationType: "doc.read",
      providerResourceToken: "doc-1",
      writeOperation: false,
    },
  });

  const unplannedWrite = documentProvider.executeOperation?.(context, {
    operationType: "doc.update",
    providerResourceType: "doc",
    providerResourceToken: "doc-1",
    actorType: "agent",
    actorId: "Atlas",
    parameters: {
      content: "raw write",
    },
  });
  assert.deepEqual(unplannedWrite, {
    ok: false,
    errorCode: "fake.policy_required",
    errorMessage: "Fake write operations require a policy decision and payload hash.",
  });

  const approvedWrite = documentProvider.executeOperation?.(context, {
    operationType: "doc.update",
    providerResourceType: "doc",
    providerResourceToken: "doc-1",
    actorType: "agent",
    actorId: "Atlas",
    parameters: {
      policyDecision: "approved",
      payloadHash: "sha256:test",
      content: "raw write",
    },
  });
  assert.deepEqual(approvedWrite, {
    ok: true,
    data: {
      operationType: "doc.update",
      providerResourceToken: "doc-1",
      writeOperation: true,
    },
  });
});

function incomingRequest(payload: Record<string, unknown>): IncomingMessageRequest {
  return {
    headers: {},
    bodyText: JSON.stringify(payload),
    payload,
  };
}
