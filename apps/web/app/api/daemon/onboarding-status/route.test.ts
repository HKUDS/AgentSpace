import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetCurrentWorkspaceContext,
  mockListDaemonSnapshotsSync,
} = vi.hoisted(() => ({
  mockGetCurrentWorkspaceContext: vi.fn(),
  mockListDaemonSnapshotsSync: vi.fn(),
}));

vi.mock("@agent-space/db", () => ({
  listDaemonSnapshotsSync: mockListDaemonSnapshotsSync,
}));

vi.mock("@/features/auth/server-workspace", () => ({
  getCurrentWorkspaceContext: mockGetCurrentWorkspaceContext,
}));

import { GET } from "./route";

describe("daemon onboarding-status route", () => {
  beforeEach(() => {
    mockGetCurrentWorkspaceContext.mockReset();
    mockListDaemonSnapshotsSync.mockReset();
  });

  it("rejects unauthenticated requests", async () => {
    mockGetCurrentWorkspaceContext.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/daemon/onboarding-status?daemonKey=box-1"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Unauthorized." });
  });

  it("rejects non-admin workspace members", async () => {
    mockGetCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("member"));

    const response = await GET(new Request("http://localhost/api/daemon/onboarding-status?daemonKey=box-1"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Forbidden." });
    expect(mockListDaemonSnapshotsSync).not.toHaveBeenCalled();
  });

  it("returns runtime info for admins", async () => {
    mockGetCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin"));
    mockListDaemonSnapshotsSync.mockReturnValue([
      {
        daemon: {
          daemonKey: "box-1",
          status: "online",
        },
        runtimes: [
          {
            id: "runtime-1",
            provider: "codex",
            name: "Codex Runtime",
            status: "online",
          },
        ],
      },
    ]);

    const response = await GET(new Request("http://localhost/api/daemon/onboarding-status?daemonKey=box-1"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: "online",
      daemonKey: "box-1",
      runtimeCount: 1,
      runtimes: [
        {
          id: "runtime-1",
          provider: "codex",
          name: "Codex Runtime",
          status: "online",
        },
      ],
    });
  });

  it("returns expanded provider ids for mixed runtimes", async () => {
    mockGetCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin"));
    mockListDaemonSnapshotsSync.mockReturnValue([
      {
        daemon: {
          daemonKey: "box-2",
          status: "online",
        },
        runtimes: [
          {
            id: "runtime-antigravity",
            provider: "antigravity",
            name: "Antigravity Runtime",
            status: "online",
          },
          {
            id: "runtime-openclaw",
            provider: "openclaw",
            name: "OpenClaw Runtime",
            status: "online",
          },
          {
            id: "runtime-nanobot",
            provider: "nanobot",
            name: "NanoBot Runtime",
            status: "offline",
          },
          {
            id: "runtime-hermes",
            provider: "hermes",
            name: "Hermes Runtime",
            status: "online",
          },
        ],
      },
    ]);

    const response = await GET(new Request("http://localhost/api/daemon/onboarding-status?daemonKey=box-2"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: "online",
      daemonKey: "box-2",
      runtimeCount: 4,
      runtimes: [
        {
          id: "runtime-antigravity",
          provider: "antigravity",
          name: "Antigravity Runtime",
          status: "online",
        },
        {
          id: "runtime-openclaw",
          provider: "openclaw",
          name: "OpenClaw Runtime",
          status: "online",
        },
        {
          id: "runtime-nanobot",
          provider: "nanobot",
          name: "NanoBot Runtime",
          status: "offline",
        },
        {
          id: "runtime-hermes",
          provider: "hermes",
          name: "Hermes Runtime",
          status: "online",
        },
      ],
    });
  });
});

function buildWorkspaceContext(role: "owner" | "admin" | "member") {
  return {
    currentUser: {
      id: "user-1",
      organizationName: "Northstar Labs",
      displayName: "Tianyu",
      role: "owner",
      email: "tianyu@example.com",
    },
    currentWorkspace: {
      id: "workspace-1",
      slug: "workspace-1",
      name: "Northstar Labs",
      createdBy: "user-1",
      createdAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z",
    },
    currentMembership: {
      id: "membership-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      role,
      status: "active",
      joinedAt: "2026-04-22T00:00:00.000Z",
    },
    memberships: [],
    workspaces: [],
  };
}
