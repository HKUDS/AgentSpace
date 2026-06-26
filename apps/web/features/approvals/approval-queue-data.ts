import { cache } from "react";
import {
  listAgentAccessRequestsForActorSync,
  listKnowledgeProposalsForWorkspaceSync,
  listDocumentPermissionRequestsSync,
  readWorkspaceStateSnapshotSync,
  sanitizeFeishuDataOperationApprovalMetadata,
} from "@agent-space/services";
import {
  DEFAULT_WORKSPACE_ID,
  listChannelAccessRequestsSync,
  readActiveGoogleOAuthCredentialSync,
  readUserSync,
} from "@agent-space/db";
import type { WorkspaceRole } from "@agent-space/db";
import { allowsDocumentAction } from "@agent-space/domain";
import type { ApprovalRequest, ApprovalStatus, ChannelDocument } from "@agent-space/domain/workspace";

const CHANNEL_ACCESS_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;

const readWorkspaceStateCached = cache((workspaceId: string) => readWorkspaceStateSnapshotSync(workspaceId));
const listChannelAccessRequestsCached = cache((workspaceId: string) =>
  listChannelAccessRequestsSync(workspaceId, { statuses: [...CHANNEL_ACCESS_STATUSES] })
);
const listDocumentPermissionRequestsCached = cache((workspaceId: string) =>
  listDocumentPermissionRequestsSync({ workspaceId })
);
const listAgentAccessRequestsCached = cache((workspaceId: string, actorUserId: string) =>
  listAgentAccessRequestsForActorSync({
    workspaceId,
    actorUserId,
    statuses: ["pending", "approved", "rejected", "cancelled"],
  })
);
const readUserCached = cache((userId: string) => readUserSync(userId));
const readActiveGoogleOAuthCredentialCached = cache((workspaceId: string, userId: string) =>
  readActiveGoogleOAuthCredentialSync({ workspaceId, userId })
);

export type ApprovalItemKind = "workspace_approval" | "channel_access" | "document_permission" | "agent_access" | "knowledge_proposal";
export type ApprovalItemStatus = ApprovalStatus | "cancelled" | "stale";

export interface ApprovalQueueActor {
  userId?: string;
  displayName?: string;
  role?: WorkspaceRole;
}

export interface ApprovalItem {
  id: string;
  actionId: string;
  kind: ApprovalItemKind;
  type: ApprovalRequest["type"] | "channel_access" | "document_permission" | "agent_access";
  sourceId: string;
  agentId: string;
  agentDisplayName: string;
  channelName: string;
  status: ApprovalItemStatus;
  contentPreview: string;
  metadata?: Record<string, unknown>;
  detail?: {
    title?: string;
    markdown?: string;
    reason?: string;
    summary?: string;
    operation?: "create" | "update";
    assignmentMode?: "all_agents" | "selected_agents";
    assignedEmployeeNames?: string[];
    targetKnowledgePageTitle?: string;
    targetKnowledgePageId?: string;
    baseUpdatedAt?: string;
    createdKnowledgePageId?: string;
    currentMarkdown?: string;
  };
  reviewerComment?: string;
  createdAt: string;
  reviewedAt?: string;
}

export interface ApprovalsPageData {
  approvals: ApprovalItem[];
  totalCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  cancelledCount: number;
}

export function getApprovalsPageData(
  workspaceId = DEFAULT_WORKSPACE_ID,
  actor?: ApprovalQueueActor,
): ApprovalsPageData {
  const approvals = buildApprovalItems(workspaceId, actor);

  return {
    approvals,
    totalCount: approvals.length,
    pendingCount: approvals.filter((approval) => approval.status === "pending").length,
    approvedCount: approvals.filter((approval) => approval.status === "approved").length,
    rejectedCount: approvals.filter((approval) => approval.status === "rejected").length,
    cancelledCount: approvals.filter((approval) => approval.status === "cancelled" || approval.status === "stale").length,
  };
}

export function getPendingApprovalCount(
  workspaceId = DEFAULT_WORKSPACE_ID,
  actor?: ApprovalQueueActor,
): number {
  return buildApprovalItems(workspaceId, actor).filter((approval) => approval.status === "pending").length;
}

function buildApprovalItems(workspaceId: string, actor?: ApprovalQueueActor): ApprovalItem[] {
  const state = readWorkspaceStateCached(workspaceId);
  const employeeIndex = new Map(
    state.activeEmployees.map((employee) => [normalizeKey(employee.name), employee]),
  );
  const documentById = new Map(state.channelDocuments.map((document) => [document.id, document]));

  const workspaceApprovals: ApprovalItem[] = (state.approvals ?? [])
    .filter((approval) => approval.type !== "knowledge_proposal")
    .map((approval) => {
    const employee = employeeIndex.get(normalizeKey(approval.agentId));
    return {
      id: `workspace-approval:${approval.id}`,
      actionId: approval.id,
      kind: "workspace_approval",
      type: approval.type,
      sourceId: approval.sourceId,
      agentId: approval.agentId,
      agentDisplayName: employee?.remarkName?.trim() || approval.agentId,
      channelName: approval.channelName,
      status: approval.status,
      contentPreview: approval.contentPreview,
      metadata: sanitizeApprovalMetadata(approval),
      reviewerComment: approval.reviewerComment,
      createdAt: approval.createdAt,
      reviewedAt: approval.reviewedAt,
    };
  });

  const isManager = isWorkspaceManager(actor);
  const channelAccessApprovals: ApprovalItem[] = isManager
    ? listChannelAccessRequestsCached(workspaceId).map((request) => {
        const requester = readUserCached(request.userId);
        const requesterName = requester?.displayName ?? requester?.primaryEmail ?? request.userId;
        const reviewedAt = request.resolvedAt;
        return {
          id: `channel-access:${request.id}`,
          actionId: request.id,
          kind: "channel_access",
          type: "channel_access",
          sourceId: request.id,
          agentId: request.userId,
          agentDisplayName: requesterName,
          channelName: request.channelName,
          status: request.status,
          contentPreview: request.note?.trim()
            || `${requesterName} requested access to ${request.channelName}.`,
          metadata: {
            requesterUserId: request.userId,
            requesterEmail: requester?.primaryEmail,
            resolvedBy: request.resolvedBy,
          },
          createdAt: request.requestedAt,
          reviewedAt,
        };
      })
    : [];

  const documentPermissionApprovals: ApprovalItem[] = listDocumentPermissionRequestsCached(workspaceId)
    .filter((request) => canActorSeeDocumentPermissionRequest(workspaceId, actor, request, documentById.get(request.documentId ?? "")))
    .map((request) => {
      const employee = employeeIndex.get(normalizeKey(request.requestedByAgentName));
      const document = request.documentId ? documentById.get(request.documentId) : undefined;
      const channelName = request.requestedForChannelName ?? document?.channelName ?? "Workspace";
      const targetLabel = document?.title ?? request.externalUrl ?? request.externalFileId ?? request.documentId ?? "external document";
      return {
        id: `document-permission:${request.id}`,
        actionId: request.id,
        kind: "document_permission",
        type: "document_permission",
        sourceId: request.sourceTaskId ?? request.id,
        agentId: request.requestedByAgentName,
        agentDisplayName: employee?.remarkName?.trim() || request.requestedByAgentName,
        channelName,
        status: request.status,
        contentPreview: request.reason?.trim()
          || `${request.requestedByAgentName} requested ${request.requestedRole} access to ${targetLabel}.`,
        metadata: {
          requestId: request.id,
          documentId: request.documentId,
          documentTitle: document?.title,
          externalProvider: request.externalProvider,
          externalFileId: request.externalFileId,
          externalUrl: request.externalUrl,
          requestedRole: request.requestedRole,
          requestedForChannelName: request.requestedForChannelName,
        },
        reviewerComment: request.decisionNote,
        createdAt: request.createdAt,
        reviewedAt: request.decidedAt,
      };
    });

  const agentAccessApprovals: ApprovalItem[] = actor?.userId
    ? listAgentAccessRequestsCached(workspaceId, actor.userId)
        .filter((request) => canActorReviewAgentAccessRequest(actor, request, employeeIndex))
        .map((request) => {
          const employee = employeeIndex.get(normalizeKey(request.sourceAgentName));
          const requester = readUserCached(request.requesterUserId);
          const requesterName = requester?.displayName ?? requester?.primaryEmail ?? request.requesterUserId;
          return {
            id: `agent-access:${request.id}`,
            actionId: request.id,
            kind: "agent_access",
            type: "agent_access",
            sourceId: request.sourceAgentName,
            agentId: request.requesterUserId,
            agentDisplayName: requesterName,
            channelName: "Workspace",
            status: request.status,
            contentPreview: request.reason?.trim()
              || `${requesterName} requested a copy of ${employee?.remarkName?.trim() || request.sourceAgentName}.`,
            metadata: {
              requestId: request.id,
              sourceAgentName: request.sourceAgentName,
              sourceAgentDisplayName: employee?.remarkName?.trim() || request.sourceAgentName,
              requesterUserId: request.requesterUserId,
              requestType: request.requestType,
              forkInvitationId: request.forkInvitationId,
            },
            createdAt: request.createdAt,
            reviewedAt: request.resolvedAt,
          } satisfies ApprovalItem;
        })
    : [];

  const knowledgeProposalApprovals: ApprovalItem[] = isManager
    ? listKnowledgeProposalsForWorkspaceSync({ workspaceId }).map((proposal) => {
        const employee = employeeIndex.get(normalizeKey(proposal.sourceAgentName));
        const targetPage = proposal.targetKnowledgePageId
          ? state.knowledgePages.find((page) => page.id === proposal.targetKnowledgePageId)
          : undefined;
        return {
          id: `knowledge-proposal:${proposal.id}`,
          actionId: proposal.id,
          kind: "knowledge_proposal",
          type: "knowledge_proposal",
          sourceId: proposal.sourceTaskQueueId,
          agentId: proposal.sourceAgentName,
          agentDisplayName: employee?.remarkName?.trim() || proposal.sourceAgentName,
          channelName: proposal.sourceChannelName ?? "Workspace",
          status: proposal.status,
          contentPreview: proposal.summary?.trim()
            || `${proposal.operation === "create" ? "Create" : "Update"} knowledge page: ${proposal.title}`,
          metadata: {
            proposalId: proposal.id,
            approvalId: proposal.approvalId,
            operation: proposal.operation,
            assignmentMode: proposal.assignmentMode,
            assignedEmployeeNames: proposal.assignedEmployeeNames,
            targetKnowledgePageId: proposal.targetKnowledgePageId,
            parentId: proposal.parentId,
            tags: proposal.tags,
            createdKnowledgePageId: proposal.createdKnowledgePageId,
          },
          detail: {
            title: proposal.title,
            markdown: proposal.contentMarkdown,
            reason: proposal.reason,
            summary: proposal.summary,
            operation: proposal.operation,
            assignmentMode: proposal.assignmentMode,
            assignedEmployeeNames: proposal.assignedEmployeeNames,
            targetKnowledgePageId: proposal.targetKnowledgePageId,
            targetKnowledgePageTitle: targetPage?.title,
            baseUpdatedAt: proposal.baseUpdatedAt,
            createdKnowledgePageId: proposal.createdKnowledgePageId,
            currentMarkdown: targetPage?.contentMarkdown,
          },
          reviewerComment: proposal.reviewerComment,
          createdAt: proposal.createdAt,
          reviewedAt: proposal.decidedAt,
        };
      })
    : [];

  return [
    ...workspaceApprovals,
    ...channelAccessApprovals,
    ...documentPermissionApprovals,
    ...agentAccessApprovals,
    ...knowledgeProposalApprovals,
  ].sort((left, right) => compareByDateDesc(left.createdAt, right.createdAt));
}

function sanitizeApprovalMetadata(approval: ApprovalRequest): Record<string, unknown> | undefined {
  if (approval.type === "external_data_operation") {
    return sanitizeFeishuDataOperationApprovalMetadata(approval.metadata);
  }
  return approval.metadata;
}

function canActorSeeDocumentPermissionRequest(
  workspaceId: string,
  actor: ApprovalQueueActor | undefined,
  request: ReturnType<typeof listDocumentPermissionRequestsSync>[number],
  document?: ChannelDocument,
): boolean {
  if (isWorkspaceManager(actor)) {
    return true;
  }
  if (!actor?.userId) {
    return true;
  }
  if (document && actor.displayName) {
    const state = readWorkspaceStateCached(workspaceId);
    const access = state.channelDocumentAccesses.find((item) =>
      item.documentId === document.id &&
      item.actorType === "human" &&
      sameText(item.actorId, actor.displayName ?? "") &&
      allowsDocumentAction(item.role, "manage")
    );
    if (access) {
      return true;
    }
  }
  if (request.externalProvider === "google_workspace" && (request.externalFileId || request.externalUrl)) {
    const credential = readActiveGoogleOAuthCredentialCached(workspaceId, actor.userId);
    return Boolean(credential?.refreshTokenEncrypted);
  }
  return false;
}

function canActorReviewAgentAccessRequest(
  actor: ApprovalQueueActor | undefined,
  request: ReturnType<typeof listAgentAccessRequestsForActorSync>[number],
  employeeIndex: Map<string, ReturnType<typeof readWorkspaceStateSnapshotSync>["activeEmployees"][number]>,
): boolean {
  if (isWorkspaceManager(actor)) {
    return true;
  }
  if (!actor?.userId) {
    return false;
  }
  const employee = employeeIndex.get(normalizeKey(request.sourceAgentName));
  return Boolean(employee?.ownerUserId && employee.ownerUserId === actor.userId);
}

function isWorkspaceManager(actor?: ApprovalQueueActor): boolean {
  return !actor?.userId || actor.role === "owner" || actor.role === "admin";
}

function compareByDateDesc(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
    return right.localeCompare(left);
  }
  return rightTime - leftTime;
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function sameText(left: string, right: string): boolean {
  return left.localeCompare(right, "zh-CN", { sensitivity: "base" }) === 0;
}
