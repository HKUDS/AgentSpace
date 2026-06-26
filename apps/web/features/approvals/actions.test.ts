import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockApproveAgentAccessRequestForActorSync,
  mockApproveChannelAccessRequestForActorSync,
  mockApproveDocumentPermissionRequestSync,
  mockApproveKnowledgeProposalForActorSync,
  mockCreateApprovalRequestSync,
  mockListApprovalsSync,
  mockRejectAgentAccessRequestForActorSync,
  mockRejectChannelAccessRequestForActorSync,
  mockRejectDocumentPermissionRequestSync,
  mockRejectKnowledgeProposalForActorSync,
  mockReviewFeishuDataOperationApproval,
  mockReviewApprovalSync,
  mockRequireCurrentWorkspaceContext,
  mockRevalidateWorkspacePaths,
} = vi.hoisted(() => ({
  mockApproveAgentAccessRequestForActorSync: vi.fn(),
  mockApproveChannelAccessRequestForActorSync: vi.fn(),
  mockApproveDocumentPermissionRequestSync: vi.fn(),
  mockApproveKnowledgeProposalForActorSync: vi.fn(),
  mockCreateApprovalRequestSync: vi.fn(),
  mockListApprovalsSync: vi.fn(),
  mockRejectAgentAccessRequestForActorSync: vi.fn(),
  mockRejectChannelAccessRequestForActorSync: vi.fn(),
  mockRejectDocumentPermissionRequestSync: vi.fn(),
  mockRejectKnowledgeProposalForActorSync: vi.fn(),
  mockReviewFeishuDataOperationApproval: vi.fn(),
  mockReviewApprovalSync: vi.fn(),
  mockRequireCurrentWorkspaceContext: vi.fn(),
  mockRevalidateWorkspacePaths: vi.fn(),
}));

vi.mock("@agent-space/services", () => ({
  approveAgentAccessRequestForActorSync: mockApproveAgentAccessRequestForActorSync,
  approveChannelAccessRequestForActorSync: mockApproveChannelAccessRequestForActorSync,
  approveDocumentPermissionRequestSync: mockApproveDocumentPermissionRequestSync,
  approveKnowledgeProposalForActorSync: mockApproveKnowledgeProposalForActorSync,
  createApprovalRequestSync: mockCreateApprovalRequestSync,
  listApprovalsSync: mockListApprovalsSync,
  rejectAgentAccessRequestForActorSync: mockRejectAgentAccessRequestForActorSync,
  rejectChannelAccessRequestForActorSync: mockRejectChannelAccessRequestForActorSync,
  rejectDocumentPermissionRequestSync: mockRejectDocumentPermissionRequestSync,
  rejectKnowledgeProposalForActorSync: mockRejectKnowledgeProposalForActorSync,
  reviewFeishuDataOperationApproval: mockReviewFeishuDataOperationApproval,
  reviewApprovalSync: mockReviewApprovalSync,
}));

vi.mock("@/features/auth/server-workspace", () => ({
  requireCurrentWorkspaceContext: mockRequireCurrentWorkspaceContext,
}));

vi.mock("@/features/auth/workspace-revalidation", () => ({
  revalidateWorkspacePaths: mockRevalidateWorkspacePaths,
}));

import { createApprovalAction, reviewApprovalAction, reviewApprovalQueueItemAction } from "./actions";

describe("approval actions", () => {
  beforeEach(() => {
    mockApproveAgentAccessRequestForActorSync.mockReset();
    mockApproveChannelAccessRequestForActorSync.mockReset();
    mockApproveDocumentPermissionRequestSync.mockReset();
    mockApproveKnowledgeProposalForActorSync.mockReset();
    mockCreateApprovalRequestSync.mockReset();
    mockListApprovalsSync.mockReset();
    mockListApprovalsSync.mockReturnValue([]);
    mockRejectAgentAccessRequestForActorSync.mockReset();
    mockRejectChannelAccessRequestForActorSync.mockReset();
    mockRejectDocumentPermissionRequestSync.mockReset();
    mockRejectKnowledgeProposalForActorSync.mockReset();
    mockReviewFeishuDataOperationApproval.mockReset();
    mockReviewApprovalSync.mockReset();
    mockRequireCurrentWorkspaceContext.mockReset();
    mockRevalidateWorkspacePaths.mockReset();
  });

  it("allows members to create approval requests", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("member"));

    await createApprovalAction({
      type: "message_draft",
      sourceId: "task-1",
      agentId: "atlas",
      channelName: "tour-visit",
      contentPreview: "Need approval",
    });

    expect(mockCreateApprovalRequestSync).toHaveBeenCalledWith({
      type: "message_draft",
      sourceId: "task-1",
      agentId: "atlas",
      channelName: "tour-visit",
      contentPreview: "Need approval",
    }, "workspace-1");
  });

  it("rejects members when reviewing approvals", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("member"));

    await expect(reviewApprovalAction("approval-1", "approved")).rejects.toThrow("Forbidden.");
    expect(mockReviewApprovalSync).not.toHaveBeenCalled();
  });

  it("allows admins to review approvals", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin"));

    const result = await reviewApprovalAction("approval-1", "approved", "Ship it");

    expect(mockReviewApprovalSync).toHaveBeenCalledWith("approval-1", "approved", "Ship it", "workspace-1");
    expect(mockRevalidateWorkspacePaths).toHaveBeenCalledWith("workspace-1", [
      "/approvals",
      "/inbox",
      "/agents",
      "/im",
      "/settings/access",
      "/settings/permissions",
      "/knowledge",
    ]);
    expect(result.invalidation).toEqual({
      workspaceId: "workspace-1",
      modules: ["approvals", "inbox", "agents", "im", "settings"],
      resources: [{ type: "approval", id: "approval-1" }],
      shell: "counters",
    });
  });

  it("executes Feishu data operation approvals from the merged approval queue", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin"));
    mockListApprovalsSync.mockReturnValue([{
      id: "approval-feishu-1",
      type: "external_data_operation",
      sourceId: "external-data-operation-1",
      agentId: "Atlas",
      channelName: "tour-visit",
      status: "pending",
      contentPreview: "Atlas requested a Feishu Sheet update.",
      metadata: {
        provider: "feishu",
        operationRunId: "external-data-operation-1",
      },
      createdAt: "2026-06-24T00:00:00.000Z",
    }]);

    const result = await reviewApprovalQueueItemAction("workspace_approval", "approval-feishu-1", "approved", "Looks good");

    expect(mockReviewFeishuDataOperationApproval).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      approvalId: "approval-feishu-1",
      decision: "approved",
      reviewerComment: "Looks good",
    });
    expect(mockReviewApprovalSync).not.toHaveBeenCalled();
    expect(result.invalidation).toEqual({
      workspaceId: "workspace-1",
      modules: ["approvals", "inbox", "agents", "im", "settings"],
      resources: [{ type: "approval", id: "approval-feishu-1" }],
      shell: "counters",
    });
  });

  it("reviews channel access requests from the merged approval queue", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin"));

    const result = await reviewApprovalQueueItemAction("channel_access", "request-1", "approved");

    expect(mockApproveChannelAccessRequestForActorSync).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      requestId: "request-1",
      actor: {
        userId: "user-1",
        displayName: "Tianyu",
        role: "admin",
      },
    });
    expect(result.invalidation).toEqual({
      workspaceId: "workspace-1",
      modules: ["approvals", "inbox", "agents", "im", "settings"],
      resources: [
        { type: "approval", id: "request-1" },
        { type: "channel" },
      ],
      shell: "counters",
    });
  });

  it("reviews document permission requests from the merged approval queue", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin"));

    await reviewApprovalQueueItemAction("document_permission", "document-request-1", "rejected", "No");

    expect(mockRejectDocumentPermissionRequestSync).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      requestId: "document-request-1",
      decidedByUserId: "user-1",
      decisionNote: "No",
    });
  });

  it("reviews agent access requests from the merged approval queue", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin"));

    const result = await reviewApprovalQueueItemAction("agent_access", "agent-request-1", "approved");

    expect(mockApproveAgentAccessRequestForActorSync).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      requestId: "agent-request-1",
      actorUserId: "user-1",
    });
    expect(result.invalidation).toEqual({
      workspaceId: "workspace-1",
      modules: ["approvals", "inbox", "agents", "im", "settings"],
      resources: [
        { type: "approval", id: "agent-request-1" },
        { type: "agent" },
      ],
      shell: "counters",
    });
  });

  it("reviews knowledge proposals from the merged approval queue", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("owner"));
    mockApproveKnowledgeProposalForActorSync.mockReturnValue({ knowledgePage: { id: "knowledge-page-1" } });

    const result = await reviewApprovalQueueItemAction(
      "knowledge_proposal",
      "knowledge-proposal-1",
      "approved",
      "Keep it",
      {
        title: "Edited title",
        assignmentMode: "selected_agents",
        assignedEmployeeNames: ["Atlas"],
      },
    );

    expect(mockApproveKnowledgeProposalForActorSync).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      proposalId: "knowledge-proposal-1",
      actor: {
        userId: "user-1",
        displayName: "Tianyu",
        role: "owner",
      },
      reviewerComment: "Keep it",
      title: "Edited title",
      assignmentMode: "selected_agents",
      assignedEmployeeNames: ["Atlas"],
    });
    expect(result.data).toEqual({ knowledgePageId: "knowledge-page-1" });
    expect(result.invalidation).toEqual({
      workspaceId: "workspace-1",
      modules: ["approvals", "inbox", "agents", "im", "settings", "knowledge"],
      resources: [
        { type: "approval", id: "knowledge-proposal-1" },
        { type: "document", id: "knowledge-page-1" },
      ],
      shell: "counters",
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
