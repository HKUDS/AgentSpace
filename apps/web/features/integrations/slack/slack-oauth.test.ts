import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalIntegrationRecord } from "@agent-space/db";

const {
  mockCreateExternalIntegrationSync,
  mockListExternalIntegrationsSync,
  mockUpdateExternalIntegrationConfigSync,
  mockUpdateExternalIntegrationCredentialsSync,
  mockUpdateExternalIntegrationStatusSync,
} = vi.hoisted(() => ({
  mockCreateExternalIntegrationSync: vi.fn(),
  mockListExternalIntegrationsSync: vi.fn(),
  mockUpdateExternalIntegrationConfigSync: vi.fn(),
  mockUpdateExternalIntegrationCredentialsSync: vi.fn(),
  mockUpdateExternalIntegrationStatusSync: vi.fn(),
}));

const {
  mockBuildEncryptedSlackCredentials,
  mockTryRecordWorkspaceAuditEventSync,
} = vi.hoisted(() => ({
  mockBuildEncryptedSlackCredentials: vi.fn(),
  mockTryRecordWorkspaceAuditEventSync: vi.fn(),
}));

const { mockReadServerEnvValue } = vi.hoisted(() => ({
  mockReadServerEnvValue: vi.fn(),
}));

vi.mock("@agent-space/db", () => ({
  createExternalIntegrationSync: mockCreateExternalIntegrationSync,
  listExternalIntegrationsSync: mockListExternalIntegrationsSync,
  updateExternalIntegrationConfigSync: mockUpdateExternalIntegrationConfigSync,
  updateExternalIntegrationCredentialsSync: mockUpdateExternalIntegrationCredentialsSync,
  updateExternalIntegrationStatusSync: mockUpdateExternalIntegrationStatusSync,
}));

vi.mock("@agent-space/services", () => ({
  buildEncryptedSlackCredentials: mockBuildEncryptedSlackCredentials,
  SLACK_DEFAULT_SCOPES: ["app_mentions:read", "chat:write"],
  SLACK_EVENT_CALLBACK_PATH: "/api/integrations/slack/events",
  SLACK_PROVIDER_ID: "slack",
  SLACK_SOCKET_MODE_SCOPES: ["connections:write"],
  tryRecordWorkspaceAuditEventSync: mockTryRecordWorkspaceAuditEventSync,
}));

vi.mock("@/features/auth/server-env", () => ({
  readServerEnvValue: mockReadServerEnvValue,
}));

import { installSlackIntegrationFromOAuthCode } from "./slack-oauth";

describe("Slack OAuth installation", () => {
  beforeEach(() => {
    mockCreateExternalIntegrationSync.mockReset();
    mockListExternalIntegrationsSync.mockReset();
    mockUpdateExternalIntegrationConfigSync.mockReset();
    mockUpdateExternalIntegrationCredentialsSync.mockReset();
    mockUpdateExternalIntegrationStatusSync.mockReset();
    mockBuildEncryptedSlackCredentials.mockReset();
    mockTryRecordWorkspaceAuditEventSync.mockReset();
    mockReadServerEnvValue.mockReset();

    mockReadServerEnvValue.mockImplementation((name: string) => ({
      AGENT_SPACE_APP_URL: "https://agent.test",
      AGENT_SPACE_SLACK_CLIENT_ID: "client-1",
      AGENT_SPACE_SLACK_CLIENT_SECRET: "client-secret-real",
      AGENT_SPACE_SLACK_SIGNING_SECRET: "signing-real",
      AGENT_SPACE_OAUTH_STATE_SECRET: "state-secret",
      AGENT_SPACE_SLACK_API_BASE_URL: "https://slack.test/api",
    })[name]);
    mockBuildEncryptedSlackCredentials.mockReturnValue({
      botToken: "enc-bot",
      signingSecret: "enc-signing",
      clientId: "enc-client-id",
      clientSecret: "enc-client-secret",
    });
    mockCreateExternalIntegrationSync.mockImplementation((input) => buildIntegration({
      displayName: input.displayName,
      appId: input.appId,
      tenantKey: input.tenantKey,
      encryptedCredentialsJson: JSON.stringify(input.encryptedCredentialsJson),
      configJson: JSON.stringify(input.configJson),
      scopesJson: JSON.stringify(input.scopesJson),
      transportMode: input.transportMode,
    }));
    mockListExternalIntegrationsSync.mockReturnValue([]);
  });

  it("exchanges an OAuth code and creates an encrypted Slack integration", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      access_token: "xoxb-real-token",
      bot_user_id: "UBOT",
      app_id: "A123",
      team: {
        id: "T123",
        name: "Moon Lab",
      },
      scope: "app_mentions:read,chat:write",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const result = await installSlackIntegrationFromOAuthCode({
      workspaceId: "workspace-1",
      userId: "user-1",
      code: "oauth-code-1",
      transportMode: "http_webhook",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.id).toBe("slack-1");
    expect(fetchImpl).toHaveBeenCalledWith("https://slack.test/api/oauth.v2.access", expect.objectContaining({
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
    }));
    const requestBody = fetchImpl.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(requestBody.get("code")).toBe("oauth-code-1");
    expect(requestBody.get("client_id")).toBe("client-1");
    expect(requestBody.get("client_secret")).toBe("client-secret-real");
    expect(requestBody.get("redirect_uri")).toBe("https://agent.test/api/integrations/slack/oauth/callback");
    expect(mockBuildEncryptedSlackCredentials).toHaveBeenCalledWith({
      botToken: "xoxb-real-token",
      signingSecret: "signing-real",
      appLevelToken: undefined,
      clientId: "client-1",
      clientSecret: "client-secret-real",
    });
    expect(mockCreateExternalIntegrationSync).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      provider: "slack",
      displayName: "Slack · Moon Lab",
      transportMode: "http_webhook",
      appId: "A123",
      tenantKey: "T123",
      encryptedCredentialsJson: {
        botToken: "enc-bot",
        signingSecret: "enc-signing",
        clientId: "enc-client-id",
        clientSecret: "enc-client-secret",
      },
      configJson: expect.objectContaining({
        eventCallbackPath: "/api/integrations/slack/events",
        oauth: expect.objectContaining({
          botUserId: "UBOT",
          teamName: "Moon Lab",
        }),
      }),
      capabilitiesJson: {
        messageTransport: true,
      },
      scopesJson: ["app_mentions:read", "chat:write"],
      createdByUserId: "user-1",
    }));
    expect(JSON.stringify(mockCreateExternalIntegrationSync.mock.calls[0]?.[0])).not.toContain("xoxb-real-token");
    expect(JSON.stringify(mockCreateExternalIntegrationSync.mock.calls[0]?.[0])).not.toContain("signing-real");
    expect(mockTryRecordWorkspaceAuditEventSync).toHaveBeenCalledWith(expect.objectContaining({
      title: "Slack integration installed with OAuth",
      data: expect.objectContaining({
        oauthInstalled: true,
        secretRedacted: true,
      }),
    }));
  });

  it("refreshes an existing Slack integration and reactivates disabled records", async () => {
    mockListExternalIntegrationsSync.mockReturnValue([buildIntegration({
      status: "disabled",
      appId: "A123",
      tenantKey: "T123",
    })]);
    mockUpdateExternalIntegrationCredentialsSync.mockReturnValue(buildIntegration({
      status: "disabled",
      appId: "A123",
      tenantKey: "T123",
    }));
    mockUpdateExternalIntegrationConfigSync.mockReturnValue(buildIntegration({
      status: "disabled",
      appId: "A123",
      tenantKey: "T123",
    }));
    mockUpdateExternalIntegrationStatusSync.mockReturnValue(buildIntegration({
      status: "active",
      appId: "A123",
      tenantKey: "T123",
    }));
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      access_token: "xoxb-refreshed",
      app_id: "A123",
      team: {
        id: "T123",
      },
      scope: "chat:write",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const result = await installSlackIntegrationFromOAuthCode({
      workspaceId: "workspace-1",
      userId: "user-1",
      code: "oauth-code-2",
      displayName: "Ignored for existing",
      transportMode: "http_webhook",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.status).toBe("active");
    expect(mockCreateExternalIntegrationSync).not.toHaveBeenCalled();
    expect(mockUpdateExternalIntegrationCredentialsSync).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      integrationId: "slack-1",
      appId: "A123",
      tenantKey: "T123",
      updatedByUserId: "user-1",
    }));
    expect(mockUpdateExternalIntegrationConfigSync).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      integrationId: "slack-1",
      updatedByUserId: "user-1",
    }));
    expect(mockUpdateExternalIntegrationStatusSync).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      integrationId: "slack-1",
      status: "active",
      updatedByUserId: "user-1",
    });
    expect(mockTryRecordWorkspaceAuditEventSync).toHaveBeenCalledWith(expect.objectContaining({
      title: "Slack integration OAuth credentials refreshed",
    }));
  });

  it("rejects failed exchanges without creating integrations", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: "invalid_code",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(installSlackIntegrationFromOAuthCode({
      workspaceId: "workspace-1",
      userId: "user-1",
      code: "bad-code",
      transportMode: "http_webhook",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow("slack.oauth.invalid_code");

    expect(mockCreateExternalIntegrationSync).not.toHaveBeenCalled();
    expect(mockUpdateExternalIntegrationCredentialsSync).not.toHaveBeenCalled();
    expect(mockTryRecordWorkspaceAuditEventSync).not.toHaveBeenCalled();
  });
});

function buildIntegration(overrides: Partial<ExternalIntegrationRecord> = {}): ExternalIntegrationRecord {
  return {
    id: "slack-1",
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
    createdByUserId: "user-1",
    updatedByUserId: "user-1",
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    lastHealthStatus: "unknown",
    lastHealthCheckedAt: undefined,
    lastError: undefined,
    ...overrides,
  };
}
