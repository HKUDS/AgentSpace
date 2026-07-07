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
  mockProcessSlackBlockActionCallback,
  mockReadSlackIntegrationCredentials,
  mockVerifySlackRequestSignature,
} = vi.hoisted(() => ({
  mockProcessSlackBlockActionCallback: vi.fn(),
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
    processSlackBlockActionCallback: mockProcessSlackBlockActionCallback,
    readSlackIntegrationCredentials: mockReadSlackIntegrationCredentials,
    verifySlackRequestSignature: mockVerifySlackRequestSignature,
  };
});

import { POST } from "./route";

describe("Slack interactions route", () => {
  beforeEach(() => {
    mockListExternalIntegrationsSync.mockReset();
    mockReadExternalIntegrationSync.mockReset();
    mockProcessSlackBlockActionCallback.mockReset();
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
    mockProcessSlackBlockActionCallback.mockResolvedValue({
      eventId: "slack-interaction-1",
      eventStatus: "processed",
      handled: true,
      approvalId: "approval-1",
      decision: "approved",
      reviewerUserId: "user-1",
    });
  });

  it("processes signed Slack Block Kit approval actions from form payloads", async () => {
    const response = await POST(buildFormRequest({
      type: "block_actions",
      api_app_id: "A123",
      team: {
        id: "T123",
      },
      user: {
        id: "U123",
      },
      trigger_id: "trigger-1",
      actions: [{
        action_id: "agentspace_approval_approve",
        value: JSON.stringify({
          provider: "slack",
          kind: "runtime_tool_approval",
          approvalId: "approval-1",
          decision: "approved",
          payloadHash: "hash-1",
        }),
      }],
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      eventId: "slack-interaction-1",
      eventStatus: "processed",
      dispatchStatus: "processed",
      blockAction: {
        handled: true,
        approvalId: "approval-1",
        decision: "approved",
        reviewerUserId: "user-1",
      },
    });
    expect(mockVerifySlackRequestSignature).toHaveBeenCalledWith(expect.objectContaining({
      signingSecret: "secret",
      rawBody: expect.stringContaining("payload="),
      signature: "v0=signature",
    }));
    expect(mockProcessSlackBlockActionCallback).toHaveBeenCalledWith(expect.objectContaining({
      context: {
        workspaceId: "workspace-1",
        integrationId: "external-integration-slack",
        provider: "slack",
      },
    }));
  });

  it("rejects invalid Slack interaction signatures", async () => {
    mockVerifySlackRequestSignature.mockReturnValue(false);

    const response = await POST(buildFormRequest({
      type: "block_actions",
      api_app_id: "A123",
      team: {
        id: "T123",
      },
      actions: [],
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid Slack request signature.",
    });
    expect(mockProcessSlackBlockActionCallback).not.toHaveBeenCalled();
  });

  it("resolves agent-scoped Slack bot interactions by api_app_id when no integration id is supplied", async () => {
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

    const response = await POST(buildFormRequest({
      type: "block_actions",
      api_app_id: "A_ATLAS",
      team: {
        id: "T123",
      },
      user: {
        id: "U123",
      },
      trigger_id: "trigger-atlas-1",
      actions: [{
        action_id: "agentspace_approval_approve",
        value: JSON.stringify({
          provider: "slack",
          kind: "approval_review",
          approvalId: "approval-1",
          decision: "approved",
          payloadHash: "hash-1",
        }),
      }],
    }, { integrationId: null }));

    expect(response.status).toBe(200);
    expect(mockReadExternalIntegrationSync).not.toHaveBeenCalled();
    expect(mockReadSlackIntegrationCredentials).toHaveBeenCalledWith(expect.objectContaining({
      id: "external-integration-slack-atlas",
      agentId: "Atlas",
    }));
    expect(mockProcessSlackBlockActionCallback).toHaveBeenCalledWith(expect.objectContaining({
      context: {
        workspaceId: "workspace-1",
        integrationId: "external-integration-slack-atlas",
        provider: "slack",
      },
    }));
  });
});

function buildFormRequest(
  payload: Record<string, unknown>,
  options: { integrationId?: string | null } = {},
): NextRequest {
  const body = new URLSearchParams({
    payload: JSON.stringify(payload),
  });
  const integrationId = options.integrationId === undefined ? "external-integration-slack" : options.integrationId;
  const url = new URL("https://agent.test/api/integrations/slack/interactions");
  url.searchParams.set("workspaceId", "workspace-1");
  if (integrationId) {
    url.searchParams.set("integrationId", integrationId);
  }
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": "1783400000",
      "x-slack-signature": "v0=signature",
    },
    body,
  });
}
