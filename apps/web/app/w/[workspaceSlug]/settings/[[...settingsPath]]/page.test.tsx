import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetWorkspacePermissionCenterSync,
} = vi.hoisted(() => ({
  mockGetWorkspacePermissionCenterSync: vi.fn(),
}));

const {
  mockListChannelAccessRequestsSync,
  mockListChannelInvitationsSync,
  mockListSessionsForUserSync,
  mockListWorkspaceInvitationsSync,
  mockListWorkspaceMemberUsersSync,
  mockReadWorkspaceSync,
  mockReadUserSync,
} = vi.hoisted(() => ({
  mockListChannelAccessRequestsSync: vi.fn(),
  mockListChannelInvitationsSync: vi.fn(),
  mockListSessionsForUserSync: vi.fn(),
  mockListWorkspaceInvitationsSync: vi.fn(),
  mockListWorkspaceMemberUsersSync: vi.fn(),
  mockReadWorkspaceSync: vi.fn(),
  mockReadUserSync: vi.fn(),
}));

const {
  mockBuildFeishuIntegrationCreationGuide,
  mockListFeishuAvailableChannels,
  mockListFeishuAvailableUsers,
  mockListFeishuIntegrationSettingsItems,
} = vi.hoisted(() => ({
  mockBuildFeishuIntegrationCreationGuide: vi.fn(),
  mockListFeishuAvailableChannels: vi.fn(),
  mockListFeishuAvailableUsers: vi.fn(),
  mockListFeishuIntegrationSettingsItems: vi.fn(),
}));

const { mockGetCurrentSession } = vi.hoisted(() => ({
  mockGetCurrentSession: vi.fn(),
}));

const { mockGetWorkspaceContextForIdentifier } = vi.hoisted(() => ({
  mockGetWorkspaceContextForIdentifier: vi.fn(),
}));

const { mockRedirect, mockNotFound } = vi.hoisted(() => ({
  mockRedirect: vi.fn((target: string) => {
    throw new Error(`redirect:${target}`);
  }),
  mockNotFound: vi.fn(() => {
    throw new Error("notFound");
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
}));

vi.mock("@agent-space/db", () => ({
  listChannelAccessRequestsSync: mockListChannelAccessRequestsSync,
  listChannelInvitationsSync: mockListChannelInvitationsSync,
  listSessionsForUserSync: mockListSessionsForUserSync,
  listWorkspaceInvitationsSync: mockListWorkspaceInvitationsSync,
  listWorkspaceMemberUsersSync: mockListWorkspaceMemberUsersSync,
  readWorkspaceSync: mockReadWorkspaceSync,
  readUserSync: mockReadUserSync,
}));

vi.mock("@agent-space/services", () => ({
  getWorkspacePermissionCenterSync: mockGetWorkspacePermissionCenterSync,
}));

vi.mock("@/features/auth/server-auth", () => ({
  getCurrentSession: mockGetCurrentSession,
}));

vi.mock("@/features/auth/server-workspace", () => ({
  getWorkspaceContextForIdentifier: mockGetWorkspaceContextForIdentifier,
}));

vi.mock("@/features/auth/public-app-url", () => ({
  readPublicAppUrl: () => undefined,
}));

vi.mock("@/features/integrations/feishu/feishu-settings-data", () => ({
  buildFeishuIntegrationCreationGuide: mockBuildFeishuIntegrationCreationGuide,
  canManageFeishuIntegrations: (role?: "owner" | "admin" | "member") =>
    role === undefined || role === "owner" || role === "admin",
  listFeishuAvailableChannels: mockListFeishuAvailableChannels,
  listFeishuAvailableUsers: mockListFeishuAvailableUsers,
  listFeishuIntegrationSettingsItems: mockListFeishuIntegrationSettingsItems,
}));

import WorkspaceSettingsPage from "./page";
import { WorkspaceInitialModuleData } from "@/features/dashboard/workspace-initial-module-data";

function getSettingsPageData(page: Awaited<ReturnType<typeof WorkspaceSettingsPage>>) {
  expect(page.type).toBe(WorkspaceInitialModuleData);
  return page.props.moduleData.data;
}

describe("workspace settings route", () => {
  beforeEach(() => {
    mockRedirect.mockClear();
    mockNotFound.mockClear();
    mockGetCurrentSession.mockReset();
    mockGetWorkspaceContextForIdentifier.mockReset();
    mockGetWorkspacePermissionCenterSync.mockReset();
    mockListChannelAccessRequestsSync.mockReset();
    mockListChannelInvitationsSync.mockReset();
    mockListSessionsForUserSync.mockReset();
    mockListWorkspaceInvitationsSync.mockReset();
    mockListWorkspaceMemberUsersSync.mockReset();
    mockListFeishuAvailableChannels.mockReset();
    mockListFeishuAvailableUsers.mockReset();
    mockListFeishuIntegrationSettingsItems.mockReset();
    mockBuildFeishuIntegrationCreationGuide.mockReset();
    mockReadWorkspaceSync.mockReset();
    mockReadUserSync.mockReset();

    mockGetCurrentSession.mockResolvedValue({ id: "session-1" });
    mockGetWorkspaceContextForIdentifier.mockResolvedValue({
      currentMembership: { role: "owner" },
      currentUser: {
        id: "user-1",
        displayName: "Mina",
        email: "mina@example.com",
      },
      currentWorkspace: {
        id: "workspace-mars",
        name: "Mars Labs",
        slug: "mars-labs",
      },
    });
    mockReadWorkspaceSync.mockReturnValue({
      id: "workspace-mars",
      name: "Mars Labs",
      slug: "mars-labs",
    });
    mockListSessionsForUserSync.mockReturnValue([{ id: "session-1" }]);
    mockListChannelAccessRequestsSync.mockReturnValue([]);
    mockListChannelInvitationsSync.mockReturnValue([]);
    mockListWorkspaceInvitationsSync.mockReturnValue([{ id: "invite-1" }]);
    mockListWorkspaceMemberUsersSync.mockReturnValue([{ userId: "user-1" }]);
    mockListFeishuAvailableChannels.mockReturnValue([{ name: "general", kind: "group" }]);
    mockListFeishuAvailableUsers.mockReturnValue([{ userId: "user-1", displayName: "Mina", role: "owner" }]);
    mockListFeishuIntegrationSettingsItems.mockReturnValue([{ id: "feishu-1" }]);
    mockBuildFeishuIntegrationCreationGuide.mockReturnValue({
      requiredCredentialFields: ["app_id", "app_secret", "verification_token", "encrypt_key"],
      requiredEvents: ["im.message.receive_v1", "card.action.trigger"],
      requiredScopes: ["im:message", "docx:document", "sheets:spreadsheet", "bitable:app"],
      eventCallbackPath: "/api/integrations/feishu/events",
      developerConsoleUrl: "https://open.feishu.cn/app",
      openPlatformSetupSteps: [
        {
          id: "create_custom_app",
          consoleUrl: "https://open.feishu.cn/app",
          required: ["app_id", "app_secret"],
        },
      ],
    });
    mockReadUserSync.mockReturnValue({ displayName: "Mina" });
    mockGetWorkspacePermissionCenterSync.mockReturnValue({
      tree: [],
      actors: [],
      diagnostics: [],
      catalog: {
        members: [],
        agents: [],
        skills: [],
        knowledgePages: [],
      },
    });
  });

  it("redirects the settings home to the account section", async () => {
    await expect(WorkspaceSettingsPage({
      params: Promise.resolve({ workspaceSlug: "mars-labs" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("redirect:/w/mars-labs/settings/account");
    expect(mockListWorkspaceMemberUsersSync).not.toHaveBeenCalled();
    expect(mockListWorkspaceInvitationsSync).not.toHaveBeenCalled();
    expect(mockListSessionsForUserSync).not.toHaveBeenCalled();
  });

  it("drops legacy section query params when redirecting the settings home", async () => {
    await expect(WorkspaceSettingsPage({
      params: Promise.resolve({ workspaceSlug: "mars-labs" }),
      searchParams: Promise.resolve({ section: "bogus", source: "legacy" }),
    })).rejects.toThrow("redirect:/w/mars-labs/settings/account?source=legacy");
  });

  it("loads only security data for the security section", async () => {
    const page = await WorkspaceSettingsPage({
      params: Promise.resolve({ workspaceSlug: "mars-labs", settingsPath: ["security"] }),
      searchParams: Promise.resolve({}),
    });

    const data = getSettingsPageData(page);
    expect(data.initialSection).toBe("security");
    expect(data.members).toEqual([]);
    expect(data.invitations).toEqual([]);
    expect(data.sessions).toEqual([{ id: "session-1" }]);
    expect(data.feishuAvailableChannels).toEqual([]);
    expect(data.feishuAvailableUsers).toEqual([]);
    expect(data.feishuIntegrations).toEqual([]);
    expect(mockListWorkspaceMemberUsersSync).not.toHaveBeenCalled();
    expect(mockListWorkspaceInvitationsSync).not.toHaveBeenCalled();
    expect(mockListSessionsForUserSync).toHaveBeenCalledWith("user-1");
  });

  it("seeds the workspace module cache with settings initial data", async () => {
    const page = await WorkspaceSettingsPage({
      params: Promise.resolve({ workspaceSlug: "mars-labs", settingsPath: ["members"] }),
      searchParams: Promise.resolve({}),
    });

    expect(page.type).toBe(WorkspaceInitialModuleData);
    expect(page.props.moduleData.moduleId).toBe("settings");
    expect(page.props.moduleData.data.initialSection).toBe("members");
    expect(page.props.workspaceId).toBe("workspace-mars");
  });

  it("loads only members data for the members section", async () => {
    const page = await WorkspaceSettingsPage({
      params: Promise.resolve({ workspaceSlug: "mars-labs", settingsPath: ["members"] }),
      searchParams: Promise.resolve({}),
    });

    const data = getSettingsPageData(page);
    expect(data.initialSection).toBe("members");
    expect(data.members).toEqual([{ userId: "user-1" }]);
    expect(data.invitations).toEqual([]);
    expect(data.sessions).toEqual([]);
    expect(data.feishuAvailableChannels).toEqual([]);
    expect(data.feishuAvailableUsers).toEqual([]);
    expect(data.feishuIntegrations).toEqual([]);
    expect(mockListWorkspaceMemberUsersSync).toHaveBeenCalledWith("workspace-mars");
    expect(mockListWorkspaceInvitationsSync).not.toHaveBeenCalled();
    expect(mockListSessionsForUserSync).not.toHaveBeenCalled();
  });

  it("loads only invitation data for the access section", async () => {
    const page = await WorkspaceSettingsPage({
      params: Promise.resolve({ workspaceSlug: "mars-labs", settingsPath: ["access"] }),
      searchParams: Promise.resolve({}),
    });

    const data = getSettingsPageData(page);
    expect(data.initialSection).toBe("access");
    expect(data.members).toEqual([]);
    expect(data.invitations).toEqual([{ id: "invite-1" }]);
    expect(data.channelAccessRequests).toEqual([]);
    expect(data.channelInvitations).toEqual([]);
    expect(data.sessions).toEqual([]);
    expect(data.feishuAvailableChannels).toEqual([]);
    expect(data.feishuAvailableUsers).toEqual([]);
    expect(data.feishuIntegrations).toEqual([]);
    expect(mockListWorkspaceInvitationsSync).toHaveBeenCalledWith("workspace-mars", {
      statuses: ["active", "accepted", "revoked", "expired"],
    });
    expect(mockListChannelAccessRequestsSync).toHaveBeenCalledWith("workspace-mars", { statuses: ["pending"] });
    expect(mockListChannelInvitationsSync).toHaveBeenCalledWith("workspace-mars", { statuses: ["pending"] });
    expect(mockListWorkspaceMemberUsersSync).not.toHaveBeenCalled();
    expect(mockListSessionsForUserSync).not.toHaveBeenCalled();
  });

  it("loads only Feishu integration data for the integrations section", async () => {
    const page = await WorkspaceSettingsPage({
      params: Promise.resolve({ workspaceSlug: "mars-labs", settingsPath: ["integrations"] }),
      searchParams: Promise.resolve({}),
    });

    const data = getSettingsPageData(page);
    expect(data.initialSection).toBe("integrations");
    expect(data.feishuAvailableChannels).toEqual([{ name: "general", kind: "group" }]);
    expect(data.feishuAvailableUsers).toEqual([{ userId: "user-1", displayName: "Mina", role: "owner" }]);
    expect(data.feishuIntegrationCreationGuide).toEqual({
      requiredCredentialFields: ["app_id", "app_secret", "verification_token", "encrypt_key"],
      requiredEvents: ["im.message.receive_v1", "card.action.trigger"],
      requiredScopes: ["im:message", "docx:document", "sheets:spreadsheet", "bitable:app"],
      eventCallbackPath: "/api/integrations/feishu/events",
      developerConsoleUrl: "https://open.feishu.cn/app",
      openPlatformSetupSteps: [
        {
          id: "create_custom_app",
          consoleUrl: "https://open.feishu.cn/app",
          required: ["app_id", "app_secret"],
        },
      ],
    });
    expect(data.feishuIntegrations).toEqual([{ id: "feishu-1" }]);
    expect(data.members).toEqual([]);
    expect(data.invitations).toEqual([]);
    expect(data.sessions).toEqual([]);
    expect(mockListFeishuAvailableChannels).toHaveBeenCalledWith({
      workspaceId: "workspace-mars",
    });
    expect(mockListFeishuAvailableUsers).toHaveBeenCalledWith({
      workspaceId: "workspace-mars",
    });
    expect(mockListFeishuIntegrationSettingsItems).toHaveBeenCalledWith({
      workspaceId: "workspace-mars",
      appUrl: undefined,
      viewer: {
        role: "owner",
        userId: "user-1",
      },
    });
    expect(mockBuildFeishuIntegrationCreationGuide).toHaveBeenCalledTimes(1);
    expect(mockListWorkspaceMemberUsersSync).not.toHaveBeenCalled();
    expect(mockListWorkspaceInvitationsSync).not.toHaveBeenCalled();
    expect(mockListSessionsForUserSync).not.toHaveBeenCalled();
  });

  it("loads only self-service Feishu identity data for members", async () => {
    mockGetWorkspaceContextForIdentifier.mockResolvedValue(buildWorkspaceContext("member"));
    mockListFeishuAvailableUsers.mockReturnValue([
      { userId: "user-1", displayName: "Mina", role: "member" },
      { userId: "user-2", displayName: "Alex", role: "member" },
    ]);

    const page = await WorkspaceSettingsPage({
      params: Promise.resolve({ workspaceSlug: "mars-labs", settingsPath: ["integrations"] }),
      searchParams: Promise.resolve({}),
    });

    const data = getSettingsPageData(page);
    expect(data.initialSection).toBe("integrations");
    expect(data.feishuAvailableChannels).toEqual([]);
    expect(data.feishuAvailableUsers).toEqual([{ userId: "user-1", displayName: "Mina", role: "member" }]);
    expect(mockListFeishuAvailableChannels).not.toHaveBeenCalled();
    expect(mockListFeishuIntegrationSettingsItems).toHaveBeenCalledWith({
      workspaceId: "workspace-mars",
      appUrl: undefined,
      viewer: {
        role: "member",
        userId: "user-1",
      },
    });
  });

  it("loads only permission-center data for the permissions section", async () => {
    const page = await WorkspaceSettingsPage({
      params: Promise.resolve({ workspaceSlug: "mars-labs", settingsPath: ["permissions"] }),
      searchParams: Promise.resolve({}),
    });

    const data = getSettingsPageData(page);
    expect(data.initialSection).toBe("permissions");
    expect(data.permissions).toEqual({
      tree: [],
      actors: [],
      diagnostics: [],
      catalog: {
        members: [],
        agents: [],
        skills: [],
        knowledgePages: [],
      },
    });
    expect(mockGetWorkspacePermissionCenterSync).toHaveBeenCalledWith({
      workspaceId: "workspace-mars",
      actor: {
        userId: "user-1",
        displayName: "Mina",
        role: "owner",
      },
    });
    expect(mockListWorkspaceMemberUsersSync).not.toHaveBeenCalled();
    expect(mockListWorkspaceInvitationsSync).not.toHaveBeenCalled();
    expect(mockListSessionsForUserSync).not.toHaveBeenCalled();
  });

  it("does not load detail datasets for the workspace section", async () => {
    const page = await WorkspaceSettingsPage({
      params: Promise.resolve({ workspaceSlug: "mars-labs", settingsPath: ["workspace"] }),
      searchParams: Promise.resolve({}),
    });

    const data = getSettingsPageData(page);
    expect(data.initialSection).toBe("workspace");
    expect(data.members).toEqual([]);
    expect(data.invitations).toEqual([]);
    expect(data.sessions).toEqual([]);
    expect(mockListWorkspaceMemberUsersSync).not.toHaveBeenCalled();
    expect(mockListWorkspaceInvitationsSync).not.toHaveBeenCalled();
    expect(mockListSessionsForUserSync).not.toHaveBeenCalled();
  });

  it("redirects legacy query sections to the new nested settings path", async () => {
    await expect(WorkspaceSettingsPage({
      params: Promise.resolve({ workspaceSlug: "mars-labs" }),
      searchParams: Promise.resolve({ section: "members", source: "legacy" }),
    })).rejects.toThrow("redirect:/w/mars-labs/settings/members?source=legacy");
  });

  it.each([
    { role: "member", section: "members" },
    { role: "member", section: "access" },
    { role: "member", section: "workspace" },
    { role: "admin", section: "workspace" },
  ] as const)("blocks sections the current role cannot access: $role -> $section", async ({ role, section }) => {
    mockGetWorkspaceContextForIdentifier.mockResolvedValue(buildWorkspaceContext(role));

    await expect(WorkspaceSettingsPage({
      params: Promise.resolve({ workspaceSlug: "mars-labs", settingsPath: [section] }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("notFound");
  });

  it.each([
    { role: "member", section: "security" },
    { role: "member", section: "permissions" },
    { role: "member", section: "integrations" },
    { role: "admin", section: "integrations" },
    { role: "admin", section: "members" },
    { role: "admin", section: "access" },
    { role: "owner", section: "workspace" },
  ] as const)("allows accessible sections for the current role: $role -> $section", async ({ role, section }) => {
    mockGetWorkspaceContextForIdentifier.mockResolvedValue(buildWorkspaceContext(role));

    const page = await WorkspaceSettingsPage({
      params: Promise.resolve({ workspaceSlug: "mars-labs", settingsPath: [section] }),
      searchParams: Promise.resolve({}),
    });

    expect(getSettingsPageData(page).initialSection).toBe(section);
  });
});

function buildWorkspaceContext(role: "owner" | "admin" | "member") {
  return {
    currentMembership: { role },
    currentUser: {
      id: "user-1",
      displayName: "Mina",
      email: "mina@example.com",
    },
    currentWorkspace: {
      id: "workspace-mars",
      name: "Mars Labs",
      slug: "mars-labs",
    },
  };
}
