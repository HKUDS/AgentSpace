import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockListExternalIntegrationsSync,
  mockRecordExternalIntegrationEventSync,
  mockReadExternalIntegrationSync,
} = vi.hoisted(() => ({
  mockListExternalIntegrationsSync: vi.fn(),
  mockRecordExternalIntegrationEventSync: vi.fn(),
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
  recordExternalIntegrationEventSync: mockRecordExternalIntegrationEventSync,
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
    mockRecordExternalIntegrationEventSync.mockReset();
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
      type: "event_callback",
      api_app_id: "A123",
      team_id: "T123",
      event_id: "EvBadSignature",
      event_time: 1783400000,
      event: {
        type: "app_mention",
        channel: "C123",
        user: "U123",
        text: "<@UBOT> ignore this",
        ts: "1783400000.000100",
      },
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid Slack request signature.",
    });
    expect(mockRecordExternalIntegrationEventSync).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      integrationId: "external-integration-slack",
      provider: "slack",
      externalEventId: "EvBadSignature",
      eventType: "event_callback.app_mention",
      status: "ignored",
      errorMessage: "slack.invalid_signature",
    }));
    expect(JSON.stringify(mockRecordExternalIntegrationEventSync.mock.calls[0]?.[0]?.payloadJson)).not.toContain("C123");
    expect(JSON.stringify(mockRecordExternalIntegrationEventSync.mock.calls[0]?.[0]?.payloadJson)).not.toContain("U123");
  });

  it("rejects unsigned Slack event callbacks", async () => {
    mockVerifySlackRequestSignature.mockImplementation(({ signature }) => Boolean(signature));

    const response = await POST(buildRequest({
      type: "event_callback",
      api_app_id: "A123",
      team_id: "T123",
      event_id: "EvUnsigned",
      event: {
        type: "app_mention",
        channel: "C123",
        user: "U123",
        text: "<@UBOT> unsigned",
        ts: "1783400000.000150",
      },
    }, { signature: null }));

    expect(response.status).toBe(401);
    expect(mockVerifySlackRequestSignature).toHaveBeenCalledWith(expect.objectContaining({
      signature: null,
    }));
    expect(mockRecordExternalIntegrationEventSync).toHaveBeenCalledWith(expect.objectContaining({
      externalEventId: "EvUnsigned",
      status: "ignored",
      errorMessage: "slack.invalid_signature",
    }));
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

  it("resolves agent-scoped Slack bot integrations by api_app_id when no integration id is supplied", async () => {
    const workspaceIntegration = {
      id: "external-integration-slack-workspace",
      workspaceId: "workspace-1",
      provider: "slack",
      displayName: "Slack Workspace",
      status: "active",
      transportMode: "http_webhook",
      appId: "A_WORKSPACE",
      tenantKey: "T123",
      encryptedCredentialsJson: "{}",
      configJson: "{}",
      capabilitiesJson: "{}",
      scopesJson: "[]",
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z",
    };
    const atlasIntegration = {
      ...workspaceIntegration,
      id: "external-integration-slack-atlas",
      displayName: "Slack Atlas Bot",
      appId: "A_ATLAS",
      agentId: "Atlas",
    };
    mockListExternalIntegrationsSync.mockReturnValue([workspaceIntegration, atlasIntegration]);

    const response = await POST(buildRequest({
      type: "event_callback",
      api_app_id: "A_ATLAS",
      team_id: "T123",
      event_id: "EvAtlas",
      event: {
        type: "app_mention",
        channel: "C123",
        user: "U123",
        text: "<@UATLAS> summarize",
        ts: "1783400000.000200",
      },
    }, { integrationId: null }));

    expect(response.status).toBe(200);
    expect(mockReadExternalIntegrationSync).not.toHaveBeenCalled();
    expect(mockReadSlackIntegrationCredentials).toHaveBeenCalledWith(expect.objectContaining({
      id: "external-integration-slack-atlas",
      agentId: "Atlas",
    }));
    expect(mockProcessSlackInboundEvent).toHaveBeenCalledWith(expect.objectContaining({
      context: {
        workspaceId: "workspace-1",
        integrationId: "external-integration-slack-atlas",
        provider: "slack",
      },
      integration: expect.objectContaining({
        id: "external-integration-slack-atlas",
        agentId: "Atlas",
      }),
    }));
  });

  it("records safe rejected event summaries for Slack callback context mismatch", async () => {
    const response = await POST(buildRequest({
      type: "event_callback",
      api_app_id: "A_WRONG",
      team_id: "T123",
      event_id: "EvWrongApp",
      event_time: 1783400000,
      event: {
        type: "app_mention",
        channel: "C_SECRET_CHANNEL",
        user: "U_SECRET_USER",
        text: "<@UBOT> raw secret text",
        ts: "1783400000.000300",
      },
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      errorCode: "slack.callback_app_id_mismatch",
    });
    expect(mockProcessSlackInboundEvent).not.toHaveBeenCalled();
    expect(mockRecordExternalIntegrationEventSync).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      integrationId: "external-integration-slack",
      provider: "slack",
      externalEventId: "EvWrongApp",
      eventType: "event_callback.app_mention",
      status: "ignored",
      errorMessage: "slack.callback_app_id_mismatch",
    }));
    const serializedRecord = JSON.stringify(mockRecordExternalIntegrationEventSync.mock.calls[0]?.[0]);
    expect(serializedRecord).not.toContain("C_SECRET_CHANNEL");
    expect(serializedRecord).not.toContain("U_SECRET_USER");
    expect(serializedRecord).not.toContain("raw secret text");
  });
});

function buildRequest(
  payload: Record<string, unknown>,
  options: { integrationId?: string | null; signature?: string | null } = {},
): NextRequest {
  const integrationId = options.integrationId === undefined ? "external-integration-slack" : options.integrationId;
  const url = new URL("https://agent.test/api/integrations/slack/events");
  url.searchParams.set("workspaceId", "workspace-1");
  if (integrationId) {
    url.searchParams.set("integrationId", integrationId);
  }
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": "1783400000",
      ...(options.signature !== null ? { "x-slack-signature": options.signature ?? "v0=signature" } : {}),
    },
    body: JSON.stringify(payload),
  });
}
