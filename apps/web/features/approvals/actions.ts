"use server";

import {
  approveChannelAccessRequestForActorSync,
  approveAgentAccessRequestForActorSync,
  approveDocumentPermissionRequestSync,
  approveKnowledgeProposalForActorSync,
  createApprovalRequestSync,
  listApprovalsSync,
  rejectChannelAccessRequestForActorSync,
  rejectAgentAccessRequestForActorSync,
  rejectDocumentPermissionRequestSync,
  rejectKnowledgeProposalForActorSync,
  reviewFeishuDataOperationApproval,
  reviewApprovalSync,
} from "@agent-space/services";
import type { ApprovalRequest } from "@agent-space/domain/workspace";
import type { KnowledgeAssignmentMode } from "@agent-space/domain/workspace";
import type { ApprovalItemKind } from "@/features/approvals/approval-queue-data";
import { requireCurrentWorkspaceContext } from "@/features/auth/server-workspace";
import { assertWorkspaceRoleForContext } from "@/features/auth/workspace-permissions";
import { revalidateWorkspacePaths } from "@/features/auth/workspace-revalidation";
import type { WorkspaceInvalidationEvent } from "@/features/dashboard/workspace-invalidation";
import {
  actionToastResult,
  successToast,
  type ActionToastResult,
} from "@/shared/lib/toast-action";

export async function createApprovalAction(input: {
  type: ApprovalRequest["type"];
  sourceId: string;
  agentId: string;
  channelName: string;
  contentPreview: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  createApprovalRequestSync(input, workspaceContext.currentWorkspace.id);
  revalidateApprovalRoutes(workspaceContext.currentWorkspace.slug);
}

export async function reviewApprovalAction(
  approvalId: string,
  decision: "approved" | "rejected",
  comment?: string,
): Promise<ActionToastResult<void>> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  assertWorkspaceRoleForContext(workspaceContext, "admin");
  if (!approvalId.trim()) {
    throw new Error("Missing approval id.");
  }
  reviewApprovalSync(approvalId, decision, comment, workspaceContext.currentWorkspace.id);
  revalidateApprovalRoutes(workspaceContext.currentWorkspace.slug);
  return actionToastResult(
    undefined,
    successToast(
      decision === "approved" ? "已批准" : "已驳回",
      decision === "approved" ? "Approved" : "Rejected",
    ),
    buildApprovalInvalidation(workspaceContext.currentWorkspace.id, {
      kind: "workspace_approval",
      actionId: approvalId.trim(),
    }),
  );
}

export async function reviewApprovalQueueItemAction(
  kind: ApprovalItemKind,
  actionId: string,
  decision: "approved" | "rejected",
  comment?: string,
  knowledgeProposalEdits?: {
    title?: string;
    contentMarkdown?: string;
    tags?: string[];
    parentId?: string | null;
    assignmentMode?: KnowledgeAssignmentMode;
    assignedEmployeeNames?: string[];
  },
): Promise<ActionToastResult<{ knowledgePageId?: string } | undefined>> {
  const workspaceContext = await requireCurrentWorkspaceContext();
  if (!actionId.trim()) {
    throw new Error("Missing approval id.");
  }
  const trimmedActionId = actionId.trim();
  let knowledgePageId: string | undefined;
  if (kind === "workspace_approval") {
    assertWorkspaceRoleForContext(workspaceContext, "admin");
    const approval = listApprovalsSync(workspaceContext.currentWorkspace.id)
      .find((item) => item.id === trimmedActionId);
    if (approval?.type === "external_data_operation" && approval.metadata?.provider === "feishu") {
      await reviewFeishuDataOperationApproval({
        workspaceId: workspaceContext.currentWorkspace.id,
        approvalId: trimmedActionId,
        decision,
        reviewerComment: comment,
      });
    } else {
      reviewApprovalSync(trimmedActionId, decision, comment, workspaceContext.currentWorkspace.id);
    }
  } else if (kind === "channel_access") {
    if (decision === "approved") {
      approveChannelAccessRequestForActorSync({
        workspaceId: workspaceContext.currentWorkspace.id,
        requestId: trimmedActionId,
        actor: {
          userId: workspaceContext.currentUser.id,
          displayName: workspaceContext.currentUser.displayName,
          role: workspaceContext.currentMembership.role,
        },
      });
    } else {
      rejectChannelAccessRequestForActorSync({
        workspaceId: workspaceContext.currentWorkspace.id,
        requestId: trimmedActionId,
        actor: {
          userId: workspaceContext.currentUser.id,
          displayName: workspaceContext.currentUser.displayName,
          role: workspaceContext.currentMembership.role,
        },
      });
    }
  } else if (kind === "document_permission") {
    const input = {
      workspaceId: workspaceContext.currentWorkspace.id,
      requestId: trimmedActionId,
      decidedByUserId: workspaceContext.currentUser.id,
      decisionNote: comment,
    };
    if (decision === "approved") {
      approveDocumentPermissionRequestSync(input);
    } else {
      rejectDocumentPermissionRequestSync(input);
    }
  } else if (kind === "agent_access") {
    const input = {
      workspaceId: workspaceContext.currentWorkspace.id,
      requestId: trimmedActionId,
      actorUserId: workspaceContext.currentUser.id,
    };
    if (decision === "approved") {
      approveAgentAccessRequestForActorSync(input);
    } else {
      rejectAgentAccessRequestForActorSync(input);
    }
  } else if (kind === "knowledge_proposal") {
    const input = {
      workspaceId: workspaceContext.currentWorkspace.id,
      proposalId: trimmedActionId,
      actor: {
        userId: workspaceContext.currentUser.id,
        displayName: workspaceContext.currentUser.displayName,
        role: workspaceContext.currentMembership.role,
      },
      reviewerComment: comment,
      ...(decision === "approved" ? knowledgeProposalEdits : undefined),
    };
    if (decision === "approved") {
      const result = approveKnowledgeProposalForActorSync(input);
      knowledgePageId = result.knowledgePage?.id;
    } else {
      rejectKnowledgeProposalForActorSync(input);
    }
  } else {
    throw new Error("Unsupported approval type.");
  }

  revalidateApprovalRoutes(workspaceContext.currentWorkspace.slug);
  return actionToastResult(
    knowledgePageId ? { knowledgePageId } : undefined,
    successToast(
      knowledgePageId
        ? "已批准，知识页已创建或更新。"
        : decision === "approved"
          ? "已批准"
          : "已驳回",
      knowledgePageId
        ? "Approved. The knowledge page was created or updated."
        : decision === "approved"
          ? "Approved"
          : "Rejected",
    ),
    buildApprovalInvalidation(workspaceContext.currentWorkspace.id, {
      actionId: trimmedActionId,
      kind,
      knowledgePageId,
    }),
  );
}

function revalidateApprovalRoutes(workspaceSlug: string): void {
  revalidateWorkspacePaths(workspaceSlug, [
    "/approvals",
    "/inbox",
    "/agents",
    "/im",
    "/settings/access",
    "/settings/permissions",
    "/knowledge",
  ]);
}

function buildApprovalInvalidation(
  workspaceId: string,
  input: {
    actionId: string;
    kind: ApprovalItemKind;
    knowledgePageId?: string;
  },
): WorkspaceInvalidationEvent {
  const modules: WorkspaceInvalidationEvent["modules"] = [
    "approvals",
    "inbox",
    "agents",
    "im",
    "settings",
  ];
  const resources: WorkspaceInvalidationEvent["resources"] = [
    { type: "approval", id: input.actionId },
  ];

  if (input.kind === "channel_access") {
    resources.push({ type: "channel" });
  }
  if (input.kind === "document_permission") {
    resources.push({ type: "document" });
  }
  if (input.kind === "agent_access") {
    resources.push({ type: "agent" });
  }
  if (input.kind === "knowledge_proposal") {
    modules.push("knowledge");
    resources.push(input.knowledgePageId
      ? { type: "document", id: input.knowledgePageId }
      : { type: "document" });
  }

  return {
    workspaceId,
    modules,
    resources,
    shell: "counters",
  };
}
