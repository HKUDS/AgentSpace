import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalsPageClient } from "@/features/approvals/approvals-page-client";
import { reviewApprovalQueueItemAction } from "@/features/approvals/actions";
import { WorkspaceModuleNavigationProvider } from "@/features/dashboard/workspace-module-navigation";
import { LanguageProvider } from "@/features/i18n/language-provider";
import { FeedbackToastProvider } from "@/shared/ui/feedback-toast-provider";
import type { ApprovalsPageData } from "@/features/dashboard/data";

const routerPush = vi.fn();
const routerRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPush,
    refresh: routerRefresh,
  }),
}));

vi.mock("@/features/approvals/actions", () => ({
  reviewApprovalQueueItemAction: vi.fn(async () => {}),
}));

function mockMatchMedia(matches: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: "(max-width: 860px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

const data: ApprovalsPageData = {
  approvals: [
    {
      id: "workspace-approval:approval-1",
      actionId: "approval-1",
      kind: "workspace_approval",
      type: "task_output",
      sourceId: "task-1",
      agentId: "atlas",
      agentDisplayName: "Atlas",
      channelName: "travel",
      status: "pending",
      contentPreview: "请审批大阪行程草稿",
      createdAt: "2026-04-10T09:00:00.000Z",
    },
    {
      id: "channel-access:request-1",
      actionId: "request-1",
      kind: "channel_access",
      type: "channel_access",
      sourceId: "request-1",
      agentId: "user-1",
      agentDisplayName: "Tianyu",
      channelName: "private-planning",
      status: "pending",
      contentPreview: "Tianyu requested access to private-planning.",
      createdAt: "2026-04-10T08:45:00.000Z",
    },
    {
      id: "workspace-approval:approval-2",
      actionId: "approval-2",
      kind: "workspace_approval",
      type: "message_draft",
      sourceId: "message-1",
      agentId: "nova",
      agentDisplayName: "Nova",
      channelName: "launch",
      status: "approved",
      contentPreview: "请审批发布公告",
      reviewerComment: "已确认",
      createdAt: "2026-04-10T08:00:00.000Z",
      reviewedAt: "2026-04-10T08:30:00.000Z",
    },
    {
      id: "knowledge-proposal:proposal-1",
      actionId: "proposal-1",
      kind: "knowledge_proposal",
      type: "knowledge_proposal",
      sourceId: "task-2",
      agentId: "atlas",
      agentDisplayName: "Atlas",
      channelName: "travel",
      status: "pending",
      contentPreview: "Create knowledge page: Osaka access checklist",
      metadata: {
        tags: ["travel"],
      },
      detail: {
        title: "Osaka access checklist",
        markdown: "# Checklist\n\n- Ask for approval",
        reason: "Reusable after this task",
        operation: "create",
        assignmentMode: "selected_agents",
        assignedEmployeeNames: ["Atlas"],
      },
      createdAt: "2026-04-10T07:30:00.000Z",
    },
  ],
  totalCount: 4,
  pendingCount: 3,
  approvedCount: 1,
  rejectedCount: 0,
  cancelledCount: 0,
};

describe("ApprovalsPageClient", () => {
  beforeEach(() => {
    mockMatchMedia(false);
    routerPush.mockClear();
    routerRefresh.mockClear();
    vi.mocked(reviewApprovalQueueItemAction).mockClear();
  });

  it("switches between approvals list and detail on compact layouts", async () => {
    mockMatchMedia(true);
    const user = userEvent.setup();

    render(
      <LanguageProvider initialLanguage="zh">
        <FeedbackToastProvider>
          <ApprovalsPageClient data={data} />
        </FeedbackToastProvider>
      </LanguageProvider>,
    );

    expect(screen.getByRole("button", { name: /请审批大阪行程草稿/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回列表" })).not.toBeInTheDocument();
    expect(screen.queryByText("内容预览")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /请审批大阪行程草稿/i }));

    expect(await screen.findByRole("button", { name: "返回列表" })).toBeInTheDocument();
    expect(screen.getByText("任务产出")).toBeInTheDocument();
    expect(screen.getByText("内容预览")).toBeInTheDocument();
    expect(screen.getByText("请审批大阪行程草稿")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "返回列表" }));

    expect(screen.getByRole("button", { name: /请审批大阪行程草稿/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回列表" })).not.toBeInTheDocument();
  });

  it("renders channel access approvals in the merged approvals list", () => {
    render(
      <LanguageProvider initialLanguage="zh">
        <FeedbackToastProvider>
          <ApprovalsPageClient data={data} />
        </FeedbackToastProvider>
      </LanguageProvider>,
    );

    expect(screen.getByRole("button", { name: /Tianyu requested access to private-planning/i })).toBeInTheDocument();
    expect(screen.getAllByText("群访问申请")[0]).toBeInTheDocument();
  });

  it("renders knowledge proposal detail with markdown body", async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider initialLanguage="zh">
        <FeedbackToastProvider>
          <ApprovalsPageClient data={data} />
        </FeedbackToastProvider>
      </LanguageProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Osaka access checklist/i }));

    expect(screen.getAllByText("知识候选")[0]).toBeInTheDocument();
    expect(screen.getByText("Markdown 正文")).toBeInTheDocument();
    expect(screen.getAllByText(/Ask for approval/i).length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("Osaka access checklist")).toBeInTheDocument();
  });

  it("submits edited knowledge proposal fields and opens the created page", async () => {
    const user = userEvent.setup();
    const onDataChanged = vi.fn();
    const onInvalidation = vi.fn();
    const navigateWorkspaceModule = vi.fn(() => true);
    const invalidation = {
      workspaceId: "workspace-1",
      modules: ["approvals" as const, "knowledge" as const],
      resources: [
        { type: "approval" as const, id: "proposal-1" },
        { type: "document" as const, id: "knowledge-page-created" },
      ],
      shell: "counters" as const,
    };
    vi.mocked(reviewApprovalQueueItemAction).mockResolvedValueOnce({
      data: { knowledgePageId: "knowledge-page-created" },
      invalidation,
      toast: { tone: "success", zh: "已批准", en: "Approved" },
    });
    window.history.pushState({}, "", "/w/workspace-alpha/approvals");

    render(
      <LanguageProvider initialLanguage="zh">
        <FeedbackToastProvider>
          <WorkspaceModuleNavigationProvider navigateWorkspaceModule={navigateWorkspaceModule}>
            <ApprovalsPageClient data={data} onDataChanged={onDataChanged} onInvalidation={onInvalidation} />
          </WorkspaceModuleNavigationProvider>
        </FeedbackToastProvider>
      </LanguageProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Osaka access checklist/i }));
    await user.clear(screen.getByDisplayValue("Osaka access checklist"));
    await user.type(screen.getByLabelText("标题"), "Edited checklist");
    await user.clear(screen.getByLabelText("正文"));
    await user.type(screen.getByLabelText("正文"), "# Edited");
    await user.click(screen.getByRole("button", { name: "批准" }));

    expect(reviewApprovalQueueItemAction).toHaveBeenCalledWith(
      "knowledge_proposal",
      "proposal-1",
      "approved",
      undefined,
      expect.objectContaining({
        title: "Edited checklist",
        contentMarkdown: "# Edited",
        tags: ["travel"],
        assignmentMode: "selected_agents",
        assignedEmployeeNames: ["Atlas"],
      }),
    );
    expect(onInvalidation).toHaveBeenCalledWith(invalidation);
    expect(onDataChanged).toHaveBeenCalledTimes(1);
    expect(routerRefresh).not.toHaveBeenCalled();
    expect(navigateWorkspaceModule).toHaveBeenCalledWith("/w/workspace-alpha/knowledge?page=knowledge-page-created");
    expect(routerPush).not.toHaveBeenCalled();
  });
});
