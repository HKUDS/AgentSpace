import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockInstallSlackIntegrationFromOAuthCode,
  mockReadSlackOAuthConfig,
  mockReadWorkspaceMembershipSync,
  mockGetCurrentUser,
  mockVerifySlackOAuthCallbackState,
} = vi.hoisted(() => ({
  mockInstallSlackIntegrationFromOAuthCode: vi.fn(),
  mockReadSlackOAuthConfig: vi.fn(),
  mockReadWorkspaceMembershipSync: vi.fn(),
  mockGetCurrentUser: vi.fn(),
  mockVerifySlackOAuthCallbackState: vi.fn(),
}));

vi.mock("@agent-space/db", () => ({
  readWorkspaceMembershipSync: mockReadWorkspaceMembershipSync,
}));

vi.mock("@/features/auth/server-auth", () => ({
  getCurrentUser: mockGetCurrentUser,
}));

vi.mock("@/features/integrations/slack/slack-oauth", () => ({
  installSlackIntegrationFromOAuthCode: mockInstallSlackIntegrationFromOAuthCode,
  readSlackOAuthConfig: mockReadSlackOAuthConfig,
  verifySlackOAuthCallbackState: mockVerifySlackOAuthCallbackState,
}));

import { GET } from "./route";

describe("Slack OAuth callback route", () => {
  beforeEach(() => {
    mockInstallSlackIntegrationFromOAuthCode.mockReset();
    mockReadSlackOAuthConfig.mockReset();
    mockReadWorkspaceMembershipSync.mockReset();
    mockGetCurrentUser.mockReset();
    mockVerifySlackOAuthCallbackState.mockReset();

    mockReadSlackOAuthConfig.mockReturnValue({ appUrl: "https://agent.test" });
    mockVerifySlackOAuthCallbackState.mockResolvedValue({
      workspaceId: "workspace-1",
      userId: "user-1",
      displayName: "Team Slack",
      transportMode: "http_webhook",
      redirectAfter: "/w/workspace-alpha/settings/integrations",
    });
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
    });
    mockReadWorkspaceMembershipSync.mockReturnValue({
      status: "active",
      role: "admin",
    });
    mockInstallSlackIntegrationFromOAuthCode.mockResolvedValue({
      id: "slack-1",
    });
  });

  it("redirects successful callbacks back to settings with the integration id", async () => {
    const response = await GET(new Request("http://localhost/api/integrations/slack/oauth/callback?code=code-1&state=state-1"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://agent.test/w/workspace-alpha/settings/integrations?slackOAuth=connected&slackIntegrationId=slack-1");
    expect(mockVerifySlackOAuthCallbackState).toHaveBeenCalledWith("state-1");
    expect(mockInstallSlackIntegrationFromOAuthCode).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "user-1",
      code: "code-1",
      displayName: "Team Slack",
      transportMode: "http_webhook",
    });
  });

  it("redirects provider-side OAuth errors to the auth error page", async () => {
    const response = await GET(new Request("http://localhost/api/integrations/slack/oauth/callback?error=access_denied"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://agent.test/auth/error?code=access_denied");
    expect(mockInstallSlackIntegrationFromOAuthCode).not.toHaveBeenCalled();
  });

  it("redirects missing callback parameters to the auth error page", async () => {
    const response = await GET(new Request("http://localhost/api/integrations/slack/oauth/callback?state=state-1"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://agent.test/auth/error?code=slack.oauth.exchange_failed");
    expect(mockInstallSlackIntegrationFromOAuthCode).not.toHaveBeenCalled();
  });

  it("falls back to the request origin for early errors when OAuth config is missing", async () => {
    mockReadSlackOAuthConfig.mockImplementation(() => {
      throw new Error("AGENT_SPACE_SLACK_CLIENT_ID is required.");
    });

    const response = await GET(new Request("http://localhost/api/integrations/slack/oauth/callback?error=access_denied"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/auth/error?code=access_denied");
    expect(mockInstallSlackIntegrationFromOAuthCode).not.toHaveBeenCalled();
  });

  it("rejects callbacks for a different signed-in user", async () => {
    mockGetCurrentUser.mockResolvedValue({ id: "user-2" });

    const response = await GET(new Request("http://localhost/api/integrations/slack/oauth/callback?code=code-1&state=state-1"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://agent.test/w/workspace-alpha/settings/integrations?slackOAuthError=slack.oauth.unauthorized");
    expect(mockInstallSlackIntegrationFromOAuthCode).not.toHaveBeenCalled();
  });

  it("rejects callbacks when the user no longer has admin access", async () => {
    mockReadWorkspaceMembershipSync.mockReturnValue({
      status: "active",
      role: "member",
    });

    const response = await GET(new Request("http://localhost/api/integrations/slack/oauth/callback?code=code-1&state=state-1"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://agent.test/w/workspace-alpha/settings/integrations?slackOAuthError=slack.oauth.workspace_forbidden");
    expect(mockInstallSlackIntegrationFromOAuthCode).not.toHaveBeenCalled();
  });
});
