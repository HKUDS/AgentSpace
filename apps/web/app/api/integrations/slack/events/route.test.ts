import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockListExternalIntegrationsSync,
  mockReadExternalIntegrationSync,
} = vi.hoisted(() => ({
  mockListExternalIntegrationsSync: vi.fn(),
  mockReadExternalIntegrationSync: vi.fn(),
}));

const {
  mockDrainSlackOutboxMessages,
  mockProcessSlackInboundEvent,
  mockReadSlackIntegrationCredentials,
  mockVerifySlackRequestSignature,
} = vi.hoisted(() => ({
  mockDrainSlackOutboxMessages: vi.fn(),
  mockProcessSlackInboundEvent: vi.fn(),
  mockReadSlackIntegrationCredentials: vi.fn(),
  mockVerifySlackRequestSignature: vi.fn(),
}));

vi.mock("@agent-space/db", () => ({
  listExternalIntegrationsSync: mockListExternalIntegrationsSync,
  readExternalIntegrationSync: mockReadExternalIntegrationSync,
}));

vi.mock("@agent-space/services", async () => {
  const actual = await vi.importActual<typeof import("@agent-space/services")>("@agent-space/services");
  return {
    ...actual,
    drainSlackOutboxMessages: mockDrainSlackOutboxMessages,
    processSlackInboundEvent: mockProcessSlackInboundEvent,
    readSlackIntegrationCredentials: mockReadSlackIntegrationCredentials,
    verifySlackRequestSignature: mockVerifySlackRequestSignature,
  };
});

import { POST } from "./route";

describe("Slack event route", () => {
  beforeEach(() => {
    mockListExternalIntegrationsSync.mockReset();
    mockReadExternalIntegrationSync.mockReset();
    mockDrainSlackOutboxMessages.mockReset();
    mockProcessSlackInboundEvent.mockReset();
    mockReadSlackIntegrationCredentials.mockReset();
    mockVerifySlackRequestSignature.mockReset();

    const integration = {
      id: "external-integration-slack",
      workspaceId: "workspace-1",
      provider: "slack",
      displayName: "Slack",
      status: "active",
      transportMode: "http_webhook",
      appId: "A123",
      tenantKey: "T123",
      encryptedCredentialsJson: "{}",
      configJson: "{}",
      capabilitiesJson: "{}",
      scopesJson: "[]",
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z",
    };
    mockReadExternalIntegrationSync.mockReturnValue(integration);
    mockListExternalIntegrationsSync.mockReturnValue([integration]);
    mockReadSlackIntegrationCredentials.mockReturnValue({
      botToken: "xoxb-test",
      signingSecret: "secret",
    });
    mockVerifySlackRequestSignature.mockReturnValue(true);
    mockDrainSlackOutboxMessages.mockResolvedValue({
      workspaceId: "workspace-1",
      provider: "slack",
      integrationCount: 1,
      processedCount: 0,
      sentCount: 0,
      failedCount: 0,
      results: [],
      errors: [],
    });
    mockProcessSlackInboundEvent.mockResolvedValue({
      event: {
        externalEventId: "Ev123",
        status: "processed",
      },
      message: {
        externalMessageId: "1783400000.000100",
      },
      dispatchStatus: "sent",
      mappedChannelName: "general",
      agentSpaceMessageId: "message-1",
    });
  });

  it("returns Slack URL verification challenge after signature validation", async () => {
    const response = await POST(buildRequest({
      type: "url_verification",
      challenge: "challenge-value",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      challenge: "challenge-value",
    });
    expect(mockVerifySlackRequestSignature).toHaveBeenCalledTimes(1);
    expect(mockProcessSlackInboundEvent).not.toHaveBeenCalled();
  });

  it("rejects invalid signatures", async () => {
    mockVerifySlackRequestSignature.mockReturnValue(false);

    const response = await POST(buildRequest({
      type: "url_verification",
      challenge: "challenge-value",
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid Slack request signature.",
    });
  });

  it("processes signed Slack event callbacks", async () => {
    const response = await POST(buildRequest({
      type: "event_callback",
      api_app_id: "A123",
      team_id: "T123",
      event_id: "Ev123",
      event: {
        type: "app_mention",
        channel: "C123",
        user: "U123",
        text: "<@UBOT> @Atlas summarize",
        ts: "1783400000.000100",
      },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      eventId: "Ev123",
      eventStatus: "processed",
      dispatchStatus: "sent",
      mappedChannelName: "general",
      agentSpaceMessageId: "message-1",
    });
    expect(mockProcessSlackInboundEvent).toHaveBeenCalledWith(expect.objectContaining({
      context: {
        workspaceId: "workspace-1",
        integrationId: "external-integration-slack",
        provider: "slack",
      },
    }));
    expect(mockDrainSlackOutboxMessages).toHaveBeenCalledTimes(1);
  });
});

function buildRequest(payload: Record<string, unknown>): NextRequest {
  return new NextRequest("https://agent.test/api/integrations/slack/events?workspaceId=workspace-1&integrationId=external-integration-slack", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": "1783400000",
      "x-slack-signature": "v0=signature",
    },
    body: JSON.stringify(payload),
  });
}
