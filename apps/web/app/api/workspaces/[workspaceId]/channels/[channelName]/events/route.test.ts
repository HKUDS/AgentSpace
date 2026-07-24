import { describe, expect, it, beforeEach, vi } from "vitest";

const {
  mockCanReadChannelForActorSync,
  mockGetWorkspaceAccessForIdentifier,
  mockSubscribeWorkspaceRealtimeEvents,
} = vi.hoisted(() => ({
  mockCanReadChannelForActorSync: vi.fn(),
  mockGetWorkspaceAccessForIdentifier: vi.fn(),
  mockSubscribeWorkspaceRealtimeEvents: vi.fn(),
}));

vi.mock("@agent-space/services", () => ({
  canReadChannelForActorSync: mockCanReadChannelForActorSync,
  subscribeWorkspaceRealtimeEvents: mockSubscribeWorkspaceRealtimeEvents,
}));

vi.mock("@/features/auth/server-workspace", () => ({
  getWorkspaceAccessForIdentifier: mockGetWorkspaceAccessForIdentifier,
}));

import { GET } from "./route";

describe("channel realtime events route", () => {
  beforeEach(() => {
    mockCanReadChannelForActorSync.mockReset();
    mockGetWorkspaceAccessForIdentifier.mockReset();
    mockSubscribeWorkspaceRealtimeEvents.mockReset();
    mockCanReadChannelForActorSync.mockReturnValue(true);
    mockGetWorkspaceAccessForIdentifier.mockResolvedValue({
      status: "ok",
      context: buildWorkspaceContext(),
    });
  });

  it("rejects unauthenticated requests", async () => {
    mockGetWorkspaceAccessForIdentifier.mockResolvedValue({ status: "unauthenticated" });

    const response = await GET(new Request("http://localhost/events"), {
      params: Promise.resolve({ workspaceId: "workspace-1", channelName: "general" }),
    });

    expect(response.status).toBe(401);
    expect(mockSubscribeWorkspaceRealtimeEvents).not.toHaveBeenCalled();
  });

  it("rejects requests without channel read access", async () => {
    mockCanReadChannelForActorSync.mockReturnValue(false);

    const response = await GET(new Request("http://localhost/events"), {
      params: Promise.resolve({ workspaceId: "workspace-1", channelName: "secret" }),
    });

    expect(response.status).toBe(403);
    expect(mockSubscribeWorkspaceRealtimeEvents).not.toHaveBeenCalled();
  });

  it("streams matching channel events without leaking other channels", async () => {
    let listener: ((event: {
      type: "channel.message.created" | "channel.message.updated";
      workspaceId: string;
      channelName: string;
      messageId: string;
      sequence: number;
      createdAt?: string;
      updatedAt?: string;
    }) => void) | null = null;
    mockSubscribeWorkspaceRealtimeEvents.mockImplementation((_workspaceId, nextListener) => {
      listener = nextListener;
      return vi.fn();
    });

    const response = await GET(new Request("http://localhost/events"), {
      params: Promise.resolve({ workspaceId: "workspace-1", channelName: "general" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const retryChunk = await reader.read();
    expect(decoder.decode(retryChunk.value)).toContain("retry: 2000");

    expect(listener).not.toBeNull();
    const emit = listener!;
    emit({
      type: "channel.message.created",
      workspaceId: "workspace-1",
      channelName: "other",
      messageId: "message-hidden",
      sequence: 1,
      createdAt: "2026-05-01T00:00:00.000Z",
    });
    emit({
      type: "channel.message.created",
      workspaceId: "workspace-1",
      channelName: "general",
      messageId: "message-visible",
      sequence: 2,
      createdAt: "2026-05-01T00:00:01.000Z",
    });

    const eventChunk = await reader.read();
    const eventText = decoder.decode(eventChunk.value);
    expect(eventText).toContain("event: channel.message.created");
    expect(eventText).toContain("message-visible");
    expect(eventText).not.toContain("message-hidden");

    emit({
      type: "channel.message.updated",
      workspaceId: "workspace-1",
      channelName: "general",
      messageId: "message-visible",
      sequence: 3,
      updatedAt: "2026-05-01T00:00:02.000Z",
    });

    const updateChunk = await reader.read();
    const updateText = decoder.decode(updateChunk.value);
    expect(updateText).toContain("event: channel.message.updated");
    expect(updateText).toContain("message-visible");
    expect(updateText).toContain("2026-05-01T00:00:02.000Z");
    await reader.cancel();
  });
});

function buildWorkspaceContext() {
  return {
    currentUser: {
      id: "user-1",
      displayName: "Tianyu",
      email: "tianyu@example.com",
    },
    currentWorkspace: {
      id: "workspace-1",
      slug: "workspace-1",
      name: "Northstar Labs",
    },
    currentMembership: {
      id: "membership-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      role: "member",
      status: "active",
      joinedAt: "2026-01-01T00:00:00.000Z",
    },
    memberships: [],
    workspaces: [],
    accessScope: "workspace",
  };
}
