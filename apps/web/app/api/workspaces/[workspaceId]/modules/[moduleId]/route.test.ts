import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetWorkspaceContextForIdentifier,
  mockLoadWorkspaceModuleDataWithMeta,
  mockGetCurrentSession,
} = vi.hoisted(() => ({
  mockGetWorkspaceContextForIdentifier: vi.fn(),
  mockLoadWorkspaceModuleDataWithMeta: vi.fn(),
  mockGetCurrentSession: vi.fn(),
}));

vi.mock("@/features/auth/server-auth", () => ({
  getCurrentSession: mockGetCurrentSession,
}));

vi.mock("@/features/auth/server-workspace", () => ({
  getWorkspaceContextForIdentifier: mockGetWorkspaceContextForIdentifier,
}));

vi.mock("@/features/dashboard/workspace-module-loaders", async () => {
  const actual = await vi.importActual<typeof import("@/features/dashboard/workspace-module-loaders")>(
    "@/features/dashboard/workspace-module-loaders",
  );
  return {
    ...actual,
    loadWorkspaceModuleDataWithMeta: mockLoadWorkspaceModuleDataWithMeta,
  };
});

import { GET } from "./route";

describe("workspace module route", () => {
  beforeEach(() => {
    mockGetWorkspaceContextForIdentifier.mockReset();
    mockLoadWorkspaceModuleDataWithMeta.mockReset();
    mockGetCurrentSession.mockReset();
    mockGetCurrentSession.mockResolvedValue({ id: "current-session" });
    mockGetWorkspaceContextForIdentifier.mockResolvedValue(buildWorkspaceContext());
    mockLoadWorkspaceModuleDataWithMeta.mockResolvedValue({
      data: {
        moduleId: "performance",
        data: { totalTasks: 0, overallCompletionRate: 0, overallErrorRate: 0, overallAvgResponseTimeMs: null, agents: [] },
      },
      meta: {
        durationMs: 12,
      },
    });
  });

  it("returns module data for migrated workspace modules", async () => {
    const response = await GET(
      new Request("http://localhost/api/workspaces/workspace-alpha/modules/performance"),
      { params: Promise.resolve({ workspaceId: "workspace-alpha", moduleId: "performance" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockGetWorkspaceContextForIdentifier).toHaveBeenCalledWith("workspace-alpha");
    expect(mockLoadWorkspaceModuleDataWithMeta).toHaveBeenCalledWith("performance", "workspace-1", {
      id: "user-1",
      displayName: "Tianyu",
      email: "tianyu@example.com",
      role: "owner",
    }, {
      accessScope: "workspace",
      channelNames: undefined,
      query: expect.any(URLSearchParams),
      settingsPath: undefined,
    });
    expect(payload).toMatchObject({
      data: {
        moduleId: "performance",
      },
      meta: {
        moduleId: "performance",
        workspaceId: "workspace-1",
        workspaceSlug: "workspace-alpha",
        durationMs: 12,
      },
    });
  });

  it("rejects channel-scoped guests", async () => {
    mockGetWorkspaceContextForIdentifier.mockResolvedValue(buildWorkspaceContext({ accessScope: "channel" }));

    const response = await GET(
      new Request("http://localhost/api/workspaces/workspace-alpha/modules/performance"),
      { params: Promise.resolve({ workspaceId: "workspace-alpha", moduleId: "performance" }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Forbidden." });
    expect(mockLoadWorkspaceModuleDataWithMeta).not.toHaveBeenCalled();
  });

  it("allows channel-scoped guests to load the IM module", async () => {
    mockGetWorkspaceContextForIdentifier.mockResolvedValue(buildWorkspaceContext({
      accessScope: "channel",
      channelNames: ["tour visit"],
    }));
    mockLoadWorkspaceModuleDataWithMeta.mockResolvedValue({
      data: {
        moduleId: "im",
        currentUserDisplayName: "Tianyu",
        data: { workspaceId: "workspace-1", channels: [] },
      },
      meta: {
        durationMs: 12,
      },
    });

    const response = await GET(
      new Request("http://localhost/api/workspaces/workspace-alpha/modules/im?focus=channel%3Atour+visit"),
      { params: Promise.resolve({ workspaceId: "workspace-alpha", moduleId: "im" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockLoadWorkspaceModuleDataWithMeta).toHaveBeenCalledWith("im", "workspace-1", {
      id: "user-1",
      displayName: "Tianyu",
      email: "tianyu@example.com",
      role: "owner",
    }, {
      accessScope: "channel",
      channelNames: ["tour visit"],
      query: expect.any(URLSearchParams),
      settingsPath: undefined,
    });
    const query = mockLoadWorkspaceModuleDataWithMeta.mock.calls[0]?.[3]?.query as URLSearchParams;
    expect(query.get("focus")).toBe("channel:tour visit");
    expect(payload.data).toMatchObject({ moduleId: "im" });
  });

  it("passes settings section path to the module loader", async () => {
    mockLoadWorkspaceModuleDataWithMeta.mockResolvedValue({
      data: {
        moduleId: "settings",
        data: { initialSection: "members" },
      },
      meta: {
        durationMs: 12,
      },
    });

    const response = await GET(
      new Request("http://localhost/api/workspaces/workspace-alpha/modules/settings?section=members"),
      { params: Promise.resolve({ workspaceId: "workspace-alpha", moduleId: "settings" }) },
    );

    expect(response.status).toBe(200);
    expect(mockLoadWorkspaceModuleDataWithMeta).toHaveBeenCalledWith("settings", "workspace-1", {
      id: "user-1",
      displayName: "Tianyu",
      email: "tianyu@example.com",
      role: "owner",
      sessionId: "current-session",
    }, {
      accessScope: "workspace",
      channelNames: undefined,
      query: expect.any(URLSearchParams),
      settingsPath: ["members"],
    });
  });

  it("loads the contacts module through the migrated module API", async () => {
    mockLoadWorkspaceModuleDataWithMeta.mockResolvedValue({
      data: {
        moduleId: "contacts",
        currentUserDisplayName: "Tianyu",
        data: { channels: [], contacts: [], threads: [] },
      },
      meta: {
        durationMs: 12,
      },
    });

    const response = await GET(
      new Request("http://localhost/api/workspaces/workspace-alpha/modules/contacts"),
      { params: Promise.resolve({ workspaceId: "workspace-alpha", moduleId: "contacts" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockLoadWorkspaceModuleDataWithMeta).toHaveBeenCalledWith("contacts", "workspace-1", {
      id: "user-1",
      displayName: "Tianyu",
      email: "tianyu@example.com",
      role: "owner",
    }, {
      accessScope: "workspace",
      channelNames: undefined,
      query: expect.any(URLSearchParams),
      settingsPath: undefined,
    });
    expect(payload.data).toMatchObject({
      moduleId: "contacts",
      currentUserDisplayName: "Tianyu",
    });
  });

  it("returns forbidden for inaccessible settings sections", async () => {
    const { SettingsSectionForbiddenError } = await import("@/features/settings/settings-page-loader");
    mockLoadWorkspaceModuleDataWithMeta.mockRejectedValue(new SettingsSectionForbiddenError("members"));

    const response = await GET(
      new Request("http://localhost/api/workspaces/workspace-alpha/modules/settings?section=members"),
      { params: Promise.resolve({ workspaceId: "workspace-alpha", moduleId: "settings" }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Forbidden." });
  });

  it("returns not found for unknown modules", async () => {
    const response = await GET(
      new Request("http://localhost/api/workspaces/workspace-alpha/modules/unknown"),
      { params: Promise.resolve({ workspaceId: "workspace-alpha", moduleId: "unknown" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Unknown workspace module." });
  });
});

function buildWorkspaceContext(options: { accessScope?: "workspace" | "channel"; channelNames?: string[] } = {}) {
  return {
    accessScope: options.accessScope ?? "workspace",
    currentUser: {
      id: "user-1",
      organizationName: "Northstar Labs",
      displayName: "Tianyu",
      role: "owner",
      email: "tianyu@example.com",
    },
    currentWorkspace: {
      id: "workspace-1",
      slug: "workspace-alpha",
      name: "Northstar Labs",
      createdBy: "user-1",
      createdAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z",
    },
    currentMembership: {
      id: "membership-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      role: "owner",
      status: "active",
      joinedAt: "2026-04-22T00:00:00.000Z",
    },
    memberships: [],
    workspaces: [],
    channelNames: options.channelNames,
  };
}
