import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockReadExternalIntegrationSync } = vi.hoisted(() => ({
  mockReadExternalIntegrationSync: vi.fn(),
}));

const { mockReadFeishuIntegrationCredentials } = vi.hoisted(() => ({
  mockReadFeishuIntegrationCredentials: vi.fn(),
}));

const {
  mockAttachmentDownloader,
  mockCreateFeishuInboundAttachmentDownloader,
  mockDrainFeishuOutboxMessages,
  mockProcessFeishuInboundEvent,
  mockProcessFeishuCardActionCallback,
  mockRecordFeishuCardActionCallbackIgnoredSync,
  mockRecordFeishuCallbackRejectedSync,
} = vi.hoisted(() => ({
  mockAttachmentDownloader: vi.fn(),
  mockCreateFeishuInboundAttachmentDownloader: vi.fn(),
  mockDrainFeishuOutboxMessages: vi.fn(),
  mockProcessFeishuInboundEvent: vi.fn(),
  mockProcessFeishuCardActionCallback: vi.fn(),
  mockRecordFeishuCardActionCallbackIgnoredSync: vi.fn(),
  mockRecordFeishuCallbackRejectedSync: vi.fn(),
}));

vi.mock("@agent-space/db", () => ({
  readExternalIntegrationSync: mockReadExternalIntegrationSync,
}));

vi.mock("@/features/integrations/feishu/feishu-credentials", () => ({
  readFeishuIntegrationCredentials: mockReadFeishuIntegrationCredentials,
}));

vi.mock("@agent-space/services", () => {
  function readToken(payload: Record<string, unknown>): string | undefined {
    const header = typeof payload.header === "object" && payload.header !== null
      ? payload.header as Record<string, unknown>
      : undefined;
    return typeof header?.token === "string"
      ? header.token
      : typeof payload.token === "string"
        ? payload.token
        : undefined;
  }

  function readHeaderString(payload: Record<string, unknown>, key: string): string | undefined {
    const header = typeof payload.header === "object" && payload.header !== null
      ? payload.header as Record<string, unknown>
      : undefined;
    return typeof header?.[key] === "string" ? header[key] : undefined;
  }

  return {
    FEISHU_PROVIDER_ID: "feishu",
    buildFeishuUrlVerificationResponse: (payload: { challenge: string }) => ({
      challenge: payload.challenge,
    }),
    decryptFeishuEventPayload: (input: { encryptedPayload: string }) =>
      JSON.parse(Buffer.from(input.encryptedPayload, "base64url").toString("utf8")) as Record<string, unknown>,
    isFeishuEncryptedPayload: (payload: Record<string, unknown>) =>
      typeof payload.encrypt === "string" && payload.encrypt.length > 0,
    isFeishuCardActionCallbackPayload: (payload: Record<string, unknown>) => {
      const header = typeof payload.header === "object" && payload.header !== null
        ? payload.header as Record<string, unknown>
        : undefined;
      const eventType = typeof header?.event_type === "string"
        ? header.event_type
        : typeof payload.type === "string"
          ? payload.type
          : "";
      const normalized = eventType.toLowerCase();
      return normalized.includes("card") && normalized.includes("action");
    },
    isFeishuApprovalCardActionCallbackPayload: (payload: Record<string, unknown>) => {
      const event = typeof payload.event === "object" && payload.event !== null
        ? payload.event as Record<string, unknown>
        : undefined;
      const action = typeof event?.action === "object" && event.action !== null
        ? event.action as Record<string, unknown>
        : undefined;
      const value = typeof action?.value === "object" && action.value !== null
        ? action.value as Record<string, unknown>
        : undefined;
      return typeof value?.approvalId === "string" || typeof value?.payloadHash === "string";
    },
    isFeishuUrlVerificationPayload: (payload: Record<string, unknown>) =>
      payload.type === "url_verification" && typeof payload.challenge === "string",
    createFeishuInboundAttachmentDownloader: mockCreateFeishuInboundAttachmentDownloader,
    drainFeishuOutboxMessages: mockDrainFeishuOutboxMessages,
    processFeishuCardActionCallback: mockProcessFeishuCardActionCallback,
    processFeishuInboundEvent: mockProcessFeishuInboundEvent,
    recordFeishuCardActionCallbackIgnoredSync: mockRecordFeishuCardActionCallbackIgnoredSync,
    recordFeishuCallbackRejectedSync: mockRecordFeishuCallbackRejectedSync,
    validateFeishuCallbackContext: (input: {
      payload: Record<string, unknown>;
      expectedAppId?: string | null;
      expectedTenantKey?: string | null;
    }) => {
      const appId = readHeaderString(input.payload, "app_id");
      if (input.expectedAppId && appId && appId !== input.expectedAppId) {
        return {
          ok: false,
          reasonCode: "feishu.callback_app_id_mismatch",
          errorMessage: "Feishu callback app_id does not match this integration.",
        };
      }
      const tenantKey = readHeaderString(input.payload, "tenant_key");
      if (input.expectedTenantKey && !tenantKey) {
        return {
          ok: false,
          reasonCode: "feishu.callback_tenant_key_missing",
          errorMessage: "Feishu callback tenant_key is missing for this tenant-scoped integration.",
        };
      }
      if (input.expectedTenantKey && tenantKey !== input.expectedTenantKey) {
        return {
          ok: false,
          reasonCode: "feishu.callback_tenant_key_mismatch",
          errorMessage: "Feishu callback tenant_key does not match this integration.",
        };
      }
      return { ok: true };
    },
    verifyFeishuCallbackToken: (input: {
      payload: Record<string, unknown>;
      verificationToken?: string;
    }) => readToken(input.payload) === input.verificationToken,
    verifyFeishuRequestSignature: (input: { signature?: string | null }) =>
      input.signature === "valid-signature",
  };
});

import { POST } from "./route";

describe("Feishu event route", () => {
  beforeEach(() => {
    mockReadExternalIntegrationSync.mockReset();
    mockReadFeishuIntegrationCredentials.mockReset();
    mockAttachmentDownloader.mockReset();
    mockCreateFeishuInboundAttachmentDownloader.mockReset();
    mockDrainFeishuOutboxMessages.mockReset();
    mockProcessFeishuInboundEvent.mockReset();
    mockProcessFeishuCardActionCallback.mockReset();
    mockRecordFeishuCardActionCallbackIgnoredSync.mockReset();
    mockRecordFeishuCallbackRejectedSync.mockReset();
    mockCreateFeishuInboundAttachmentDownloader.mockReturnValue(mockAttachmentDownloader);

    mockReadExternalIntegrationSync.mockReturnValue({
      id: "external-integration-1",
      workspaceId: "workspace-1",
      provider: "feishu",
      displayName: "Feishu",
      status: "active",
      transportMode: "http_webhook",
      appId: "cli_test",
      encryptedCredentialsJson: "{}",
      configJson: "{}",
      capabilitiesJson: "{}",
      scopesJson: "[]",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
    });
    mockReadFeishuIntegrationCredentials.mockReturnValue({
      appSecret: "secret",
      verificationToken: "verify-token",
      encryptKey: "encrypt-key",
    });
    mockProcessFeishuInboundEvent.mockResolvedValue({
      event: {
        externalEventId: "evt-1",
        status: "processed",
      },
      dispatchStatus: "sent",
      message: {
        externalMessageId: "om-1",
      },
      mappedChannelName: "ops",
    });
    mockProcessFeishuCardActionCallback.mockResolvedValue({
      eventId: "evt-card-action-1",
      eventStatus: "processed",
      handled: true,
      approvalId: "approval-1",
      decision: "approved",
      reviewerUserId: "user-1",
    });
    mockRecordFeishuCardActionCallbackIgnoredSync.mockReturnValue({
      event: {
        externalEventId: "evt-card-non-approval-1",
        status: "ignored",
      },
      dispatchStatus: "ignored",
      reasonCode: "feishu_card_action_non_approval_ignored",
      message: null,
    });
    mockRecordFeishuCallbackRejectedSync.mockReturnValue({
      event: {
        externalEventId: "evt-tenant-mismatch",
        status: "failed",
      },
      dispatchStatus: "failed",
      reasonCode: "feishu.callback_tenant_key_mismatch",
      message: null,
    });
    mockDrainFeishuOutboxMessages.mockResolvedValue({
      processedCount: 1,
      sentCount: 1,
      failedCount: 0,
    });
  });

  it("rejects requests without integration context", async () => {
    const response = await POST(buildRequest("https://example.com/api/integrations/feishu/events", {
      token: "verify-token",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Missing Feishu integration context.",
    });
  });

  it("rejects requests with the wrong verification token", async () => {
    const response = await POST(buildRequest(
      "https://example.com/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=external-integration-1",
      { token: "wrong-token" },
    ));

    expect(response.status).toBe(401);
    expect(mockProcessFeishuInboundEvent).not.toHaveBeenCalled();
  });

  it("responds to URL verification challenges after token validation", async () => {
    const response = await POST(buildRequest(
      "https://example.com/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=external-integration-1",
      {
        type: "url_verification",
        token: "verify-token",
        challenge: "challenge-value",
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      challenge: "challenge-value",
    });
    expect(mockProcessFeishuInboundEvent).not.toHaveBeenCalled();
  });

  it("rejects event callbacks whose tenant key does not match the integration", async () => {
    mockReadExternalIntegrationSync.mockReturnValueOnce({
      id: "external-integration-1",
      workspaceId: "workspace-1",
      provider: "feishu",
      displayName: "Feishu",
      status: "active",
      transportMode: "http_webhook",
      appId: "cli_test",
      tenantKey: "tenant-allowed",
      encryptedCredentialsJson: "{}",
      configJson: "{}",
      capabilitiesJson: "{}",
      scopesJson: "[]",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
    });
    const payload = {
      header: {
        token: "verify-token",
        event_id: "evt-tenant-mismatch",
        event_type: "im.message.receive_v1",
        app_id: "cli_test",
        tenant_key: "tenant-other",
      },
      event: {},
    };

    const response = await POST(buildRequest(
      "https://example.com/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=external-integration-1",
      payload,
    ));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "feishu.callback_tenant_key_mismatch",
      eventId: "evt-tenant-mismatch",
      eventStatus: "failed",
    });
    expect(mockRecordFeishuCallbackRejectedSync).toHaveBeenCalledWith({
      context: {
        workspaceId: "workspace-1",
        integrationId: "external-integration-1",
        provider: "feishu",
      },
      payload,
      reasonCode: "feishu.callback_tenant_key_mismatch",
    });
    expect(mockCreateFeishuInboundAttachmentDownloader).not.toHaveBeenCalled();
    expect(mockProcessFeishuInboundEvent).not.toHaveBeenCalled();
    expect(mockDrainFeishuOutboxMessages).not.toHaveBeenCalled();
  });

  it("records verified event callbacks", async () => {
    const response = await POST(buildRequest(
      "https://example.com/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=external-integration-1",
      {
        header: {
          token: "verify-token",
          event_id: "evt-1",
          event_type: "im.message.receive_v1",
        },
        event: {},
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      eventId: "evt-1",
      eventStatus: "processed",
      dispatchStatus: "sent",
      messageId: "om-1",
      mappedChannelName: "ops",
      outboxDrain: {
        processedCount: 1,
        sentCount: 1,
        failedCount: 0,
      },
    });
    expect(mockCreateFeishuInboundAttachmentDownloader).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      appId: "cli_test",
      appSecret: "secret",
      baseUrl: undefined,
    });
    expect(mockProcessFeishuInboundEvent).toHaveBeenCalledWith({
      context: {
        workspaceId: "workspace-1",
        integrationId: "external-integration-1",
        provider: "feishu",
      },
      payload: {
        header: {
          token: "verify-token",
          event_id: "evt-1",
          event_type: "im.message.receive_v1",
        },
        event: {},
      },
      attachmentDownloader: mockAttachmentDownloader,
    });
    expect(mockDrainFeishuOutboxMessages).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      integrationId: "external-integration-1",
      lockedBy: "agent-space-webhook",
      limit: 5,
    });
  });

  it("records Feishu card action callbacks without dispatching approval work", async () => {
    const payload = {
      header: {
        token: "verify-token",
        event_id: "evt-card-action-1",
        event_type: "card.action.trigger",
      },
      event: {
        action: {
          value: {
            approvalId: "approval-1",
            decision: "approved",
            payloadHash: "hash-secret-ish",
          },
        },
        operator: {
          open_id: "ou_mina",
        },
      },
    };

    const response = await POST(buildRequest(
      "https://example.com/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=external-integration-1",
      payload,
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      eventId: "evt-card-action-1",
      eventStatus: "processed",
      dispatchStatus: "sent",
      cardAction: {
        handled: true,
        approvalId: "approval-1",
        decision: "approved",
        reviewerUserId: "user-1",
      },
    });
    expect(mockProcessFeishuCardActionCallback).toHaveBeenCalledWith({
      context: {
        workspaceId: "workspace-1",
        integrationId: "external-integration-1",
        provider: "feishu",
      },
      payload,
      baseUrl: undefined,
    });
    expect(mockCreateFeishuInboundAttachmentDownloader).not.toHaveBeenCalled();
    expect(mockProcessFeishuInboundEvent).not.toHaveBeenCalled();
    expect(mockDrainFeishuOutboxMessages).not.toHaveBeenCalled();
  });

  it("records non-approval Feishu card actions without dispatching or draining outbox", async () => {
    const payload = {
      header: {
        token: "verify-token",
        event_id: "evt-card-non-approval-1",
        event_type: "card.action.trigger",
      },
      event: {
        action: {
          value: {
            action: "refresh_status",
            resourceId: "status-card-1",
          },
        },
        operator: {
          open_id: "ou_mina",
        },
      },
    };

    const response = await POST(buildRequest(
      "https://example.com/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=external-integration-1",
      payload,
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      eventId: "evt-card-non-approval-1",
      eventStatus: "ignored",
      dispatchStatus: "ignored",
      reasonCode: "feishu_card_action_non_approval_ignored",
      cardAction: {
        handled: false,
        reasonCode: "feishu_card_action_non_approval_ignored",
      },
    });
    expect(mockRecordFeishuCardActionCallbackIgnoredSync).toHaveBeenCalledWith({
      context: {
        workspaceId: "workspace-1",
        integrationId: "external-integration-1",
        provider: "feishu",
      },
      payload,
      reasonCode: "feishu_card_action_non_approval_ignored",
    });
    expect(mockProcessFeishuCardActionCallback).not.toHaveBeenCalled();
    expect(mockCreateFeishuInboundAttachmentDownloader).not.toHaveBeenCalled();
    expect(mockProcessFeishuInboundEvent).not.toHaveBeenCalled();
    expect(mockDrainFeishuOutboxMessages).not.toHaveBeenCalled();
  });

  it("decrypts signed encrypted event callbacks before validation and dispatch", async () => {
    const decryptedPayload = {
      header: {
        token: "verify-token",
        event_id: "evt-encrypted-1",
        event_type: "im.message.receive_v1",
      },
      event: {
        message: {
          message_id: "om-encrypted-1",
        },
      },
    };
    mockProcessFeishuInboundEvent.mockResolvedValueOnce({
      event: {
        externalEventId: "evt-encrypted-1",
        status: "processed",
      },
      dispatchStatus: "sent",
      message: {
        externalMessageId: "om-encrypted-1",
      },
      mappedChannelName: "ops",
    });

    const response = await POST(buildRequest(
      "https://example.com/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=external-integration-1",
      {
        encrypt: Buffer.from(JSON.stringify(decryptedPayload), "utf8").toString("base64url"),
      },
      {
        "x-lark-request-timestamp": "1782280800",
        "x-lark-request-nonce": "nonce-1",
        "x-lark-signature": "valid-signature",
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      eventId: "evt-encrypted-1",
      dispatchStatus: "sent",
      messageId: "om-encrypted-1",
    });
    expect(mockProcessFeishuInboundEvent).toHaveBeenCalledWith({
      context: {
        workspaceId: "workspace-1",
        integrationId: "external-integration-1",
        provider: "feishu",
      },
      payload: decryptedPayload,
      attachmentDownloader: mockAttachmentDownloader,
    });
  });

  it("rejects encrypted callbacks with invalid signatures", async () => {
    const response = await POST(buildRequest(
      "https://example.com/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=external-integration-1",
      {
        encrypt: Buffer.from(JSON.stringify({ token: "verify-token" }), "utf8").toString("base64url"),
      },
      {
        "x-lark-request-timestamp": "1782280800",
        "x-lark-request-nonce": "nonce-1",
        "x-lark-signature": "invalid-signature",
      },
    ));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid Feishu request signature.",
    });
    expect(mockProcessFeishuInboundEvent).not.toHaveBeenCalled();
  });

  it("returns ignored callback results for unsupported events", async () => {
    mockProcessFeishuInboundEvent.mockResolvedValueOnce({
      event: {
        externalEventId: "evt-unsupported-1",
        status: "ignored",
      },
      dispatchStatus: "ignored",
      reasonCode: "non_message_event",
    });

    const response = await POST(buildRequest(
      "https://example.com/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=external-integration-1",
      {
        header: {
          token: "verify-token",
          event_id: "evt-unsupported-1",
          event_type: "contact.user.created_v3",
        },
        event: {},
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      eventId: "evt-unsupported-1",
      eventStatus: "ignored",
      dispatchStatus: "ignored",
      reasonCode: "non_message_event",
    });
  });

  it("returns duplicate callback results without treating retries as failures", async () => {
    mockProcessFeishuInboundEvent.mockResolvedValueOnce({
      event: {
        externalEventId: "evt-duplicate-1",
        status: "ignored",
      },
      dispatchStatus: "duplicate",
      reasonCode: "duplicate_external_message",
      message: {
        externalMessageId: "om-duplicate-1",
      },
      mappedChannelName: "ops",
    });

    const response = await POST(buildRequest(
      "https://example.com/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=external-integration-1",
      {
        header: {
          token: "verify-token",
          event_id: "evt-duplicate-1",
          event_type: "im.message.receive_v1",
        },
        event: {},
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      eventId: "evt-duplicate-1",
      eventStatus: "ignored",
      dispatchStatus: "duplicate",
      reasonCode: "duplicate_external_message",
      messageId: "om-duplicate-1",
      mappedChannelName: "ops",
    });
  });

  it("returns a typed error response when event processing fails", async () => {
    mockProcessFeishuInboundEvent.mockImplementationOnce(() => {
      throw new Error("SDK failed with app_secret=do-not-leak");
    });

    const response = await POST(buildRequest(
      "https://example.com/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=external-integration-1",
      {
        header: {
          token: "verify-token",
          event_id: "evt-sdk-error",
          event_type: "im.message.receive_v1",
        },
        event: {},
      },
    ));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "feishu.webhook_processing_failed",
      error: "Feishu webhook event processing failed.",
      errorMessage: "SDK failed with app_secret=[redacted]",
    });
    expect(mockDrainFeishuOutboxMessages).not.toHaveBeenCalled();
  });

  it("returns typed outbox drain errors without failing verified event callbacks", async () => {
    mockDrainFeishuOutboxMessages.mockRejectedValueOnce(new Error("missing Bearer tenant-token-secret"));

    const response = await POST(buildRequest(
      "https://example.com/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=external-integration-1",
      {
        header: {
          token: "verify-token",
          event_id: "evt-drain-error",
          event_type: "im.message.receive_v1",
        },
        event: {},
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      eventId: "evt-1",
      outboxDrain: {
        processedCount: 0,
        sentCount: 0,
        failedCount: 1,
        errorCode: "feishu.webhook_outbox_drain_failed",
        errorMessage: "missing Bearer [redacted]",
      },
    });
  });
});

function buildRequest(
  url: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(url, {
    body: JSON.stringify(payload),
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    method: "POST",
  });
}
