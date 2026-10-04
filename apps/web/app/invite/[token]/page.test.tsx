import { beforeEach, describe, expect, it, vi } from "vitest";

const { acceptInvitation, getCurrentUser, readInvitation } = vi.hoisted(() => ({
  acceptInvitation: vi.fn(),
  getCurrentUser: vi.fn(),
  readInvitation: vi.fn(),
}));

vi.mock("@/features/auth/server-auth", () => ({
  getCurrentUser,
  hasRegisteredUsersSync: () => true,
}));
vi.mock("@/features/auth/workspace-invitations", () => ({
  acceptWorkspaceInvitationForUser: acceptInvitation,
  readWorkspaceInvitationDetailsSync: readInvitation,
}));
vi.mock("@/features/auth/auth-screen", () => ({ AuthScreen: () => null }));
vi.mock("@/features/auth/invitation-status-screen", () => ({ InvitationStatusScreen: () => null }));

import InvitationPage from "./page";

describe("workspace invitation page", () => {
  beforeEach(() => {
    acceptInvitation.mockReset();
    getCurrentUser.mockResolvedValue({ id: "user-1", displayName: "Alex" });
    readInvitation.mockReturnValue({
      status: "active", email: "alex@example.com", workspaceName: "Research",
    });
  });

  it("propagates the Next.js redirect after accepting an invitation", async () => {
    acceptInvitation.mockResolvedValue({ workspaceSlug: "research" });
    await expect(InvitationPage({ params: Promise.resolve({ token: "invite-1" }) }))
      .rejects.toMatchObject({ message: "NEXT_REDIRECT", digest: expect.stringContaining("/w/research/im") });
    expect(acceptInvitation).toHaveBeenCalledWith({ token: "invite-1", userId: "user-1", actorDisplayName: "Alex" });
  });

  it("still displays an acceptance failure when joining fails", async () => {
    acceptInvitation.mockRejectedValue(new Error("workspace.invitation.email_mismatch"));
    const page = await InvitationPage({ params: Promise.resolve({ token: "invite-1" }) });
    expect(page.props).toMatchObject({ status: "accept_failed", reasonCode: "workspace.invitation.email_mismatch" });
  });
});
