"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewApprovalQueueItemAction } from "@/features/approvals/actions";
import { buildWorkspacePath, parseWorkspacePathname } from "@/features/auth/workspace-paths";
import type { ApprovalItemStatus, ApprovalsPageData } from "@/features/dashboard/data";
import type { WorkspaceInvalidationEvent } from "@/features/dashboard/workspace-invalidation";
import { useWorkspaceModuleNavigation } from "@/features/dashboard/workspace-module-navigation";
import { refreshWorkspaceModule } from "@/features/dashboard/workspace-module-refresh";
import { useLanguage } from "@/features/i18n/language-provider";
import { AppIcon } from "@/shared/ui/app-icon";
import { EmptyState } from "@/shared/ui/empty-state";
import { runToastAction } from "@/shared/lib/toast-action";
import { formatCompactTimestamp } from "@/shared/lib/time-format";
import { useFeedbackToast } from "@/shared/ui/feedback-toast-provider";

type FilterKey = "all" | ApprovalItemStatus;
type KnowledgeDraft = {
  title: string;
  markdown: string;
  tagsText: string;
  parentId: string;
  assignmentMode: "all_agents" | "selected_agents";
  assignedEmployeesText: string;
};

const EMPTY_KNOWLEDGE_DRAFT: KnowledgeDraft = {
  title: "",
  markdown: "",
  tagsText: "",
  parentId: "",
  assignmentMode: "selected_agents",
  assignedEmployeesText: "",
};

export function ApprovalsPageClient({
  data,
  onDataChanged,
  onInvalidation,
}: {
  data: ApprovalsPageData;
  onDataChanged?: () => void;
  onInvalidation?: (event: WorkspaceInvalidationEvent) => void;
}) {
  const { tx } = useLanguage();
  const router = useRouter();
  const { navigateWorkspaceModule } = useWorkspaceModuleNavigation();
  const workspaceSlug = typeof window !== "undefined" ? parseWorkspacePathname(window.location.pathname).workspaceSlug : undefined;
  const { pushToast } = useFeedbackToast();
  const [selectedId, setSelectedId] = useState<string | null>(data.approvals[0]?.id ?? null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [reviewComment, setReviewComment] = useState("");
  const [knowledgeDraft, setKnowledgeDraft] = useState<KnowledgeDraft>(EMPTY_KNOWLEDGE_DRAFT);
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const [mobilePane, setMobilePane] = useState<"list" | "detail">("list");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 860px)");
    const handleChange = (event?: MediaQueryListEvent): void => {
      setIsCompactLayout(event ? event.matches : mediaQuery.matches);
    };

    handleChange();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  const filteredApprovals = useMemo(() => {
    if (filter === "all") return data.approvals;
    return data.approvals.filter((a) => a.status === filter);
  }, [data.approvals, filter]);

  const selected = filteredApprovals.find((a) => a.id === selectedId) ?? filteredApprovals[0] ?? null;

  useEffect(() => {
    const selectedExists = selectedId ? filteredApprovals.some((approval) => approval.id === selectedId) : false;
    if (!selectedExists) {
      setSelectedId(filteredApprovals[0]?.id ?? null);
    }
  }, [filteredApprovals, selectedId]);

  useEffect(() => {
    if (selected?.type !== "knowledge_proposal" || !selected.detail) {
      setKnowledgeDraft(EMPTY_KNOWLEDGE_DRAFT);
      return;
    }

    setKnowledgeDraft({
      title: selected.detail.title ?? "",
      markdown: selected.detail.markdown ?? "",
      tagsText: readStringArrayMetadata(selected.metadata?.tags).join(", "),
      parentId: typeof selected.metadata?.parentId === "string" ? selected.metadata.parentId : "",
      assignmentMode: selected.detail.assignmentMode ?? "selected_agents",
      assignedEmployeesText: selected.detail.assignedEmployeeNames?.join(", ") ?? "",
    });
  }, [selected?.id, selected?.type, selected?.detail, selected?.metadata]);

  useEffect(() => {
    if (!isCompactLayout) {
      setMobilePane("list");
      return;
    }

    if (!selected) {
      setMobilePane("list");
    }
  }, [isCompactLayout, selected]);

  function handleReview(approvalId: string, decision: "approved" | "rejected"): void {
    startTransition(async () => {
      await runToastAction({
        action: () => {
          const approval = data.approvals.find((item) => item.id === approvalId);
          if (!approval) {
            throw new Error("Approval item does not exist.");
          }
          return reviewApprovalQueueItemAction(
            approval.kind,
            approval.actionId,
            decision,
            reviewComment.trim() || undefined,
            approval.kind === "knowledge_proposal" && decision === "approved"
              ? buildKnowledgeProposalEdits(knowledgeDraft, approval.detail)
              : undefined,
          );
        },
        onSuccess: async (result, actionResult) => {
          setReviewComment("");
          if (actionResult.invalidation) {
            onInvalidation?.(actionResult.invalidation);
          }
          const approval = data.approvals.find((item) => item.id === approvalId);
          if (decision === "approved" && approval?.kind === "knowledge_proposal") {
            const knowledgePageId = result?.knowledgePageId ?? approval.detail?.createdKnowledgePageId;
            if (workspaceSlug && knowledgePageId) {
              const href = buildWorkspacePath(workspaceSlug, `/knowledge?page=${encodeURIComponent(knowledgePageId)}`);
              if (!navigateWorkspaceModule(href)) {
                router.push(href);
              }
            }
          }
          refreshWorkspaceModule(onDataChanged, router);
        },
        pushToast,
        tx,
      });
    });
  }

  const filterTabs: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: "all", label: tx("全部", "All"), count: data.totalCount },
    { key: "pending", label: tx("待审批", "Pending"), count: data.pendingCount },
    { key: "approved", label: tx("已批准", "Approved"), count: data.approvedCount },
    { key: "rejected", label: tx("已驳回", "Rejected"), count: data.rejectedCount },
    { key: "cancelled", label: tx("已取消", "Cancelled"), count: data.cancelledCount },
  ];
  const showListPane = !isCompactLayout || mobilePane === "list";
  const showDetailPane = !isCompactLayout || mobilePane === "detail";

  return (
    <section className={`approvals-shell${isCompactLayout ? " approvals-shell--compact" : ""}`}>
      {showListPane ? (
        <aside className="approvals-list-pane">
          <div className="approvals-filters">
            {filterTabs.map((tab) => (
              <button
                className={`approvals-filter-tab${filter === tab.key ? " approvals-filter-tab--active" : ""}`}
                key={tab.key}
                onClick={() => {
                  setFilter(tab.key);
                  if (isCompactLayout) {
                    setMobilePane("list");
                  }
                }}
                type="button"
              >
                {tab.label}
                <small>{tab.count}</small>
              </button>
            ))}
          </div>

          <div className="approvals-list">
            {filteredApprovals.length === 0 ? (
              <EmptyState
                body={tx("当前筛选下没有审批记录。切换状态，或等待新的任务产出进入审核流。", "There are no approvals in the current filter. Switch status or wait for new items to enter review.")}
                eyebrow={tx("审批", "Approvals")}
                title={tx("暂无审批记录", "No approvals yet")}
                variant="cool"
              />
            ) : (
              filteredApprovals.map((approval) => (
                <button
                  className={`approvals-list-item${selected?.id === approval.id ? " approvals-list-item--selected" : ""}`}
                  key={approval.id}
                  onClick={() => {
                    setSelectedId(approval.id);
                    if (isCompactLayout) {
                      setMobilePane("detail");
                    }
                  }}
                  type="button"
                >
                  <div className="approvals-list-item__header">
                    <span className={`approvals-status-badge approvals-status-badge--${approval.status}`}>
                      {translateApprovalStatus(tx, approval.status)}
                    </span>
                    <span className="approvals-list-item__type">{translateApprovalType(tx, approval.type)}</span>
                  </div>
                  <div className="approvals-list-item__body">
                    <strong>{approval.agentDisplayName}</strong>
                    <span className="approvals-list-item__channel">{approval.channelName}</span>
                  </div>
                  <p className="approvals-list-item__preview">{approval.contentPreview}</p>
                </button>
              ))
            )}
          </div>
        </aside>
      ) : null}

      {showDetailPane ? (
        <main className="approvals-detail-pane">
          {selected ? (
            <div className="approvals-detail">
              <div className="approvals-detail__header">
                <div className="approvals-detail__header-main">
                  {isCompactLayout ? (
                    <button
                      aria-label={tx("返回列表", "Back to list")}
                      className="approvals-detail__back"
                      onClick={() => setMobilePane("list")}
                      type="button"
                    >
                      <AppIcon name="arrowLeft" />
                    </button>
                  ) : null}
                  <h2>{translateApprovalType(tx, selected.type)}</h2>
                </div>
                <span className={`approvals-status-badge approvals-status-badge--${selected.status}`}>
                  {translateApprovalStatus(tx, selected.status)}
                </span>
              </div>

              <div className="approvals-detail__meta">
                <div className="approvals-detail__meta-row">
                  <span className="approvals-detail__label">{tx("提交人", "Submitted by")}</span>
                  <span>{selected.agentDisplayName}</span>
                </div>
                <div className="approvals-detail__meta-row">
                  <span className="approvals-detail__label">{tx("群组", "Group")}</span>
                  <span>{selected.channelName}</span>
                </div>
                <div className="approvals-detail__meta-row">
                  <span className="approvals-detail__label">{tx("提交时间", "Submitted")}</span>
                  <span>{formatDateTime(selected.createdAt)}</span>
                </div>
                {selected.reviewedAt ? (
                  <div className="approvals-detail__meta-row">
                    <span className="approvals-detail__label">{tx("审批时间", "Reviewed")}</span>
                    <span>{formatDateTime(selected.reviewedAt)}</span>
                  </div>
                ) : null}
              </div>

              <div className="approvals-detail__content">
                <h3>{tx("内容预览", "Content Preview")}</h3>
                <div className="approvals-detail__preview-box">{selected.contentPreview}</div>
              </div>

              {selected.type === "knowledge_proposal" ? (
                <KnowledgeProposalDetail
                  draft={knowledgeDraft}
                  editable={selected.status === "pending"}
                  selected={selected}
                  tx={tx}
                  onDraftChange={setKnowledgeDraft}
                />
              ) : null}

              {selected.reviewerComment ? (
                <div className="approvals-detail__comment">
                  <h3>{tx("审批意见", "Review Comment")}</h3>
                  <p>{selected.reviewerComment}</p>
                </div>
              ) : null}

              {selected.status === "pending" ? (
                <div className="approvals-detail__actions">
                  <textarea
                    className="approvals-detail__comment-input"
                    placeholder={tx("审批意见（可选）", "Review comment (optional)")}
                    rows={3}
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                  />
                  <div className="approvals-detail__buttons">
                    <button
                      className="approvals-btn approvals-btn--approve"
                      disabled={isPending}
                      onClick={() => handleReview(selected.id, "approved")}
                      type="button"
                    >
                      {tx("批准", "Approve")}
                    </button>
                    <button
                      className="approvals-btn approvals-btn--reject"
                      disabled={isPending}
                      onClick={() => handleReview(selected.id, "rejected")}
                      type="button"
                    >
                      {tx("驳回", "Reject")}
                    </button>
                  </div>
                </div>
              ) : null}

            </div>
          ) : (
            <EmptyState
              body={tx("从左侧选择一个审批项，查看上下文、审批意见和可执行动作。", "Select an approval item to inspect its context, review notes, and available actions.")}
              eyebrow={tx("审批详情", "Approval detail")}
              title={tx("等待选择审批项", "Choose an approval")}
            />
          )}
        </main>
      ) : null}
    </section>
  );
}

function translateApprovalStatus(tx: (zh: string, en: string) => string, status: ApprovalItemStatus): string {
  const map: Record<ApprovalItemStatus, [string, string]> = {
    pending: ["待审批", "Pending"],
    approved: ["已批准", "Approved"],
    rejected: ["已驳回", "Rejected"],
    revised: ["已修改", "Revised"],
    cancelled: ["已取消", "Cancelled"],
    stale: ["已过期", "Stale"],
  };
  const [zh, en] = map[status] ?? [status, status];
  return tx(zh, en);
}

function translateApprovalType(tx: (zh: string, en: string) => string, type: string): string {
  const map: Record<string, [string, string]> = {
    task_output: ["任务产出", "Task Output"],
    document_update: ["文档更新", "Document Update"],
    message_draft: ["消息草稿", "Message Draft"],
    runtime_tool: ["工具权限", "Tool Permission"],
    external_data_operation: ["外部数据操作", "External Data Operation"],
    channel_access: ["群访问申请", "Channel Access"],
    document_permission: ["文档权限申请", "Document Permission"],
    agent_access: ["Agent 权限申请", "Agent Access"],
    knowledge_proposal: ["知识候选", "Knowledge Proposal"],
  };
  const [zh, en] = map[type] ?? [type, type];
  return tx(zh, en);
}

function KnowledgeProposalDetail({
  draft,
  editable,
  onDraftChange,
  selected,
  tx,
}: {
  draft: KnowledgeDraft;
  editable: boolean;
  onDraftChange: (draft: KnowledgeDraft) => void;
  selected: ApprovalsPageData["approvals"][number];
  tx: (zh: string, en: string) => string;
}) {
  const detail = selected.detail;
  if (!detail) {
    return null;
  }
  const assignment = detail.assignmentMode === "all_agents"
    ? tx("全部 Agent", "All agents")
    : detail.assignedEmployeeNames && detail.assignedEmployeeNames.length > 0
      ? detail.assignedEmployeeNames.join(", ")
      : tx("指定 Agent", "Selected agents");
  const displayedTitle = editable ? draft.title : detail.title;
  const displayedMarkdown = editable ? draft.markdown : detail.markdown;
  const displayedAssignmentMode = editable ? draft.assignmentMode : detail.assignmentMode;
  const displayedAssignedEmployees = editable
    ? parseCommaSeparatedText(draft.assignedEmployeesText)
    : detail.assignedEmployeeNames ?? [];
  const diffLines = detail.operation === "update"
    ? buildMarkdownDiff(detail.currentMarkdown ?? "", displayedMarkdown ?? "")
    : [];
  const knowledgePageHref = detail.createdKnowledgePageId
    ? `/knowledge?page=${encodeURIComponent(detail.createdKnowledgePageId)}`
    : undefined;
  return (
    <div className="approvals-knowledge-detail">
      {displayedAssignmentMode === "all_agents" ? (
        <div className="approvals-knowledge-detail__risk">
          <strong>{tx("影响全部 Agent", "Affects all agents")}</strong>
          <span>{tx("批准后，这篇知识会进入所有 Agent 后续任务上下文。", "After approval, this knowledge enters every agent's future task context.")}</span>
        </div>
      ) : null}
      <div className="approvals-knowledge-detail__grid">
        <div>
          <span className="approvals-detail__label">{tx("知识标题", "Knowledge title")}</span>
          <strong>{displayedTitle}</strong>
        </div>
        <div>
          <span className="approvals-detail__label">{tx("操作", "Operation")}</span>
          <strong>{detail.operation === "update" ? tx("更新现有页面", "Update existing page") : tx("新增知识页", "Create page")}</strong>
        </div>
        <div>
          <span className="approvals-detail__label">{tx("影响范围", "Assignment")}</span>
          <strong>
            {displayedAssignmentMode === detail.assignmentMode
              ? assignment
              : displayedAssignmentMode === "all_agents"
                ? tx("全部 Agent", "All agents")
                : displayedAssignedEmployees.join(", ") || tx("指定 Agent", "Selected agents")}
          </strong>
        </div>
        {detail.targetKnowledgePageTitle || detail.targetKnowledgePageId ? (
          <div>
            <span className="approvals-detail__label">{tx("目标页面", "Target page")}</span>
            <strong>{detail.targetKnowledgePageTitle ?? detail.targetKnowledgePageId}</strong>
          </div>
        ) : null}
        {detail.baseUpdatedAt ? (
          <div>
            <span className="approvals-detail__label">{tx("基准版本", "Base version")}</span>
            <strong>{formatDateTime(detail.baseUpdatedAt)}</strong>
          </div>
        ) : null}
      </div>
      {editable ? (
        <div className="approvals-knowledge-edit">
          <label>
            <span className="approvals-detail__label">{tx("标题", "Title")}</span>
            <input
              value={draft.title}
              onChange={(event) => onDraftChange({ ...draft, title: event.currentTarget.value })}
            />
          </label>
          <label>
            <span className="approvals-detail__label">{tx("标签", "Tags")}</span>
            <input
              placeholder={tx("用逗号分隔", "Comma separated")}
              value={draft.tagsText}
              onChange={(event) => onDraftChange({ ...draft, tagsText: event.currentTarget.value })}
            />
          </label>
          <label>
            <span className="approvals-detail__label">{tx("父页面 ID", "Parent page ID")}</span>
            <input
              value={draft.parentId}
              onChange={(event) => onDraftChange({ ...draft, parentId: event.currentTarget.value })}
            />
          </label>
          <label>
            <span className="approvals-detail__label">{tx("分配范围", "Assignment")}</span>
            <select
              value={draft.assignmentMode}
              onChange={(event) => onDraftChange({
                ...draft,
                assignmentMode: event.currentTarget.value === "all_agents" ? "all_agents" : "selected_agents",
              })}
            >
              <option value="selected_agents">{tx("指定 Agent", "Selected agents")}</option>
              <option value="all_agents">{tx("全部 Agent", "All agents")}</option>
            </select>
          </label>
          {draft.assignmentMode === "selected_agents" ? (
            <label>
              <span className="approvals-detail__label">{tx("指定 Agent", "Assigned agents")}</span>
              <input
                placeholder={tx("用逗号分隔", "Comma separated")}
                value={draft.assignedEmployeesText}
                onChange={(event) => onDraftChange({ ...draft, assignedEmployeesText: event.currentTarget.value })}
              />
            </label>
          ) : null}
          <label className="approvals-knowledge-edit__body">
            <span className="approvals-detail__label">{tx("正文", "Body")}</span>
            <textarea
              rows={8}
              value={draft.markdown}
              onChange={(event) => onDraftChange({ ...draft, markdown: event.currentTarget.value })}
            />
          </label>
        </div>
      ) : null}
      {detail.reason ? (
        <div className="approvals-detail__comment">
          <h3>{tx("沉淀理由", "Reason")}</h3>
          <p>{detail.reason}</p>
        </div>
      ) : null}
      <div className="approvals-detail__content">
        <h3>{tx("Markdown 正文", "Markdown Body")}</h3>
        <pre className="approvals-detail__markdown">{displayedMarkdown}</pre>
      </div>
      {detail.operation === "update" ? (
        <div className="approvals-detail__content">
          <h3>{tx("Markdown Diff", "Markdown Diff")}</h3>
          <pre className="approvals-detail__markdown approvals-detail__markdown--diff">
            {diffLines.length > 0 ? diffLines.join("\n") : tx("目标页面没有可比较的正文。", "No target body is available for comparison.")}
          </pre>
        </div>
      ) : null}
      {knowledgePageHref ? (
        <a className="approvals-detail__knowledge-link" href={knowledgePageHref}>
          {tx("打开知识页", "Open knowledge page")}
        </a>
      ) : null}
    </div>
  );
}

function formatDateTime(value: string): string {
  return formatCompactTimestamp(value, { emptyFallback: value });
}

function buildMarkdownDiff(before: string, after: string): string[] {
  const beforeLines = before.trimEnd().split(/\r?\n/);
  const afterLines = after.trimEnd().split(/\r?\n/);
  const maxLength = Math.max(beforeLines.length, afterLines.length);
  const result: string[] = [];
  for (let index = 0; index < maxLength; index += 1) {
    const left = beforeLines[index];
    const right = afterLines[index];
    if (left === right) {
      if (left !== undefined) {
        result.push(`  ${left}`);
      }
      continue;
    }
    if (left !== undefined) {
      result.push(`- ${left}`);
    }
    if (right !== undefined) {
      result.push(`+ ${right}`);
    }
  }
  return result.slice(0, 240);
}

function buildKnowledgeProposalEdits(
  draft: KnowledgeDraft,
  detail: ApprovalsPageData["approvals"][number]["detail"],
):
  | {
      title?: string;
      contentMarkdown?: string;
      tags?: string[];
      parentId?: string | null;
      assignmentMode?: "all_agents" | "selected_agents";
      assignedEmployeeNames?: string[];
    }
  | undefined {
  if (!detail) {
    return undefined;
  }
  return {
    title: draft.title.trim() || detail.title,
    contentMarkdown: draft.markdown,
    tags: parseCommaSeparatedText(draft.tagsText),
    parentId: draft.parentId.trim() || null,
    assignmentMode: draft.assignmentMode,
    assignedEmployeeNames: draft.assignmentMode === "selected_agents"
      ? parseCommaSeparatedText(draft.assignedEmployeesText)
      : [],
  };
}

function parseCommaSeparatedText(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readStringArrayMetadata(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
