import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateSlackOAuthAuthorizationUrl,
  mockGetCurrentWorkspaceContext,
} = vi.hoisted(() => ({
  mockCreateSlackOAuthAuthorizationUrl: vi.fn(),
  mockGetCurrentWorkspaceContext: vi.fn(),
}));

vi.mock("@/features/auth/server-workspace", () => ({
  getCurrentWorkspaceContext: mockGetCurrentWorkspaceContext,
}));

vi.mock("@/features/integrations/slack/slack-oauth", () => ({
  createSlackOAuthAuthorizationUrl: mockCreateSlackOAuthAuthorizationUrl,
}));

import { GET } from "./route";

describe("Slack OAuth start route", () => {
  beforeEach(() => {
    mockCreateSlackOAuthAuthorizationUrl.mockReset();
    mockGetCurrentWorkspaceContext.mockReset();

    mockCreateSlackOAuthAuthorizationUrl.mockResolvedValue("https://slack.com/oauth/v2/authorize?state=test");
    mockGetCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin"));
  });

  it("redirects admins to the generated Slack authorization URL", async () => {
    const response = await GET(new Request("http://localhost/api/integrations/slack/oauth/start"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://slack.com/oauth/v2/authorize?state=test");
    expect(mockCreateSlackOAuthAuthorizationUrl).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "user-1",
      displayName: undefined,
      transportMode: "http_webhook",
      redirectAfter: "/w/workspace-alpha/settings/integrations",
    });
  });

  it("passes display name, redirect target, and Socket Mode intent into state", async () => {
    await GET(new Request("http://localhost/api/integrations/slack/oauth/start?name=Team%20Slack&transport=websocket_worker&redirectAfter=/w/workspace-alpha/settings/integrations%3Ftab%3Dproviders"));

    expect(mockCreateSlackOAuthAuthorizationUrl).toHaveBeenCalledWith(expect.objectContaining({
      displayName: "Team Slack",
      transportMode: "websocket_worker",
      redirectAfter: "/w/workspace-alpha/settings/integrations?tab=providers",
    }));
  });

  it("redirects unauthenticated users back to the app root", async () => {
    mockGetCurrentWorkspaceContext.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/integrations/slack/oauth/start"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(mockCreateSlackOAuthAuthorizationUrl).not.toHaveBeenCalled();
  });

  it("redirects non-admins back to settings with an OAuth error", async () => {
    mockGetCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("member"));

    const response = await GET(new Request("http://localhost/api/integrations/slack/oauth/start"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/w/workspace-alpha/settings/integrations?slackOAuthError=slack.oauth.workspace_forbidden");
    expect(mockCreateSlackOAuthAuthorizationUrl).not.toHaveBeenCalled();
  });
});

function buildWorkspaceContext(role: "owner" | "admin" | "member") {
  return {
    currentUser: {
      id: "user-1",
    },
    currentWorkspace: {
      id: "workspace-1",
      slug: "workspace-alpha",
    },
    currentMembership: {
      role,
    },
  };
}
