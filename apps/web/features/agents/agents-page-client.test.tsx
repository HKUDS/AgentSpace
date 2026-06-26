import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsPageClient } from "@/features/agents/agents-page-client";
import { AgentDetail } from "@/features/agents/components/agent-detail";
import { WorkspaceModuleNavigationProvider } from "@/features/dashboard/workspace-module-navigation";
import {
  approveAgentAccessRequestAction,
  cancelAgentAccessRequestAction,
  createContainerInstallTokenAction,
  createAgentAccessRequestAction,
  createWorkspaceAgentAction,
  deleteWorkspaceRuntimeAction,
  rejectAgentAccessRequestAction,
  pruneOldOfflineDaemonsAction,
  setWorkspaceAgentChannelMemberAccessAction,
  updateWorkspaceRuntimeDisplayNameAction,
} from "@/features/agents/actions";
import {
  createFeishuAgentBotBindingAction,
  rotateFeishuAgentBotCredentialsAction,
} from "@/features/integrations/feishu/feishu-actions";
import { LanguageProvider } from "@/features/i18n/language-provider";
import { FeedbackToastProvider } from "@/shared/ui/feedback-toast-provider";
import type { AgentsPageData } from "@/features/dashboard/data";

const searchParams = new URLSearchParams();
const mockRefresh = vi.fn();
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
    replace: mockReplace,
  }),
  usePathname: () => "/w/workspace-alpha/agents",
  useSearchParams: () => ({
    get: (key: string) => searchParams.get(key),
  }),
}));

vi.mock("@/features/agents/actions", () => ({
  acceptAgentForkInvitationAction: vi.fn(async () => ({ data: undefined })),
  approveAgentAccessRequestAction: vi.fn(async () => ({ data: undefined })),
  bindWorkspaceAgentRuntimeAction: vi.fn(async () => {}),
  cancelAgentAccessRequestAction: vi.fn(async () => ({ data: undefined })),
  createContainerInstallTokenAction: vi.fn(async () => ({ id: "daemon-token-1", label: "container", token: "adt_test" })),
  createAgentAccessRequestAction: vi.fn(async () => ({ data: undefined })),
  createAgentForkInvitationAction: vi.fn(async () => ({ data: undefined })),
  createWorkspaceAgentAction: vi.fn(async () => {}),
  createWorkspaceTaskAction: vi.fn(async () => {}),
  deleteWorkspaceAgentAction: vi.fn(async () => {}),
  deleteWorkspaceRuntimeAction: vi.fn(async () => {}),
  grantWorkspaceRuntimeUseAction: vi.fn(async () => {}),
  pruneOldOfflineDaemonsAction: vi.fn(async () => ({ data: { removedCount: 1 } })),
  rejectAgentAccessRequestAction: vi.fn(async () => ({ data: undefined })),
  revokeAgentForkInvitationAction: vi.fn(async () => ({ data: undefined })),
  revokeWorkspaceAgentGoogleWorkspaceDelegationAction: vi.fn(async () => {}),
  revokeWorkspaceRuntimeUseAction: vi.fn(async () => {}),
  setWorkspaceAgentChannelMemberAccessAction: vi.fn(async () => {}),
  setWorkspaceAgentKnowledgeAssignmentsAction: vi.fn(async () => ({ data: undefined })),
  setWorkspaceAgentSkillAssignmentsAction: vi.fn(async () => {}),
  unbindWorkspaceAgentRuntimeAction: vi.fn(async () => {}),
  updateWorkspaceAgentInstructionsAction: vi.fn(async () => {}),
  updateWorkspaceRuntimeDisplayNameAction: vi.fn(async () => {}),
}));

vi.mock("@/features/settings/actions", () => ({
  createDaemonApiTokenAction: vi.fn(async () => ({
    data: {
      id: "daemon-token-2",
      label: "build-box-1",
      token: "adt_secret_value",
    },
  })),
  revokeDaemonApiTokenAction: vi.fn(async () => {}),
}));

vi.mock("@/features/integrations/feishu/feishu-actions", () => ({
  createFeishuAgentBotBindingAction: vi.fn(async () => ({
    id: "feishu-agent-bot-planner",
    displayName: "Planner Feishu Bot",
    status: "active",
    transportMode: "websocket_worker",
    agentId: "planner",
    appId: "cli_planner",
    callbackUrl: "",
    createdAt: "2026-04-10T08:00:00.000Z",
    updatedAt: "2026-04-10T08:00:00.000Z",
    hasAppSecret: true,
    hasVerificationToken: false,
    hasEncryptKey: false,
    userBindingCount: 0,
    channelBindingCount: 0,
    resourceBindingCount: 0,
    operationRunCount: 0,
    outboxFailureCount: 0,
    userBindings: [],
    channelBindings: [],
    resourceBindings: [],
    operationRuns: [],
    recentOutboxFailures: [],
    recentInboundEvents: [],
  })),
  disableFeishuAgentBotBindingAction: vi.fn(async () => ({
    id: "feishu-agent-bot-planner",
    displayName: "Planner Feishu Bot",
    status: "disabled",
    transportMode: "websocket_worker",
    agentId: "planner",
    callbackUrl: "",
    createdAt: "2026-04-10T08:00:00.000Z",
    updatedAt: "2026-04-10T08:00:00.000Z",
    hasAppSecret: true,
    hasVerificationToken: false,
    hasEncryptKey: false,
    userBindingCount: 0,
    channelBindingCount: 0,
    resourceBindingCount: 0,
    operationRunCount: 0,
    outboxFailureCount: 0,
    userBindings: [],
    channelBindings: [],
    resourceBindings: [],
    operationRuns: [],
    recentOutboxFailures: [],
    recentInboundEvents: [],
  })),
  rotateFeishuAgentBotCredentialsAction: vi.fn(async () => ({
    id: "feishu-agent-bot-planner",
    displayName: "Planner Feishu Bot",
    status: "active",
    transportMode: "websocket_worker",
    agentId: "planner",
    callbackUrl: "",
    createdAt: "2026-04-10T08:00:00.000Z",
    updatedAt: "2026-04-10T08:00:00.000Z",
    hasAppSecret: true,
    hasVerificationToken: false,
    hasEncryptKey: false,
    userBindingCount: 0,
    channelBindingCount: 0,
    resourceBindingCount: 0,
    operationRunCount: 0,
    outboxFailureCount: 0,
    userBindings: [],
    channelBindings: [],
    resourceBindings: [],
    operationRuns: [],
    recentOutboxFailures: [],
    recentInboundEvents: [],
  })),
  updateFeishuAgentBotPolicyAction: vi.fn(async () => ({
    id: "feishu-agent-bot-planner",
    displayName: "Planner Feishu Bot",
    status: "active",
    transportMode: "websocket_worker",
    agentId: "planner",
    callbackUrl: "",
    createdAt: "2026-04-10T08:00:00.000Z",
    updatedAt: "2026-04-10T08:00:00.000Z",
    hasAppSecret: true,
    hasVerificationToken: false,
    hasEncryptKey: false,
    userBindingCount: 0,
    channelBindingCount: 0,
    resourceBindingCount: 0,
    operationRunCount: 0,
    outboxFailureCount: 0,
    userBindings: [],
    channelBindings: [],
    resourceBindings: [],
    operationRuns: [],
    recentOutboxFailures: [],
    recentInboundEvents: [],
  })),
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

const data: AgentsPageData = {
  containers: [
    {
      id: "container-1",
      kind: "container",
      name: "Local Runtime",
      subtitle: "Codex runtime",
      description: "Connected runtime",
      status: "linked",
      statusLabel: "在线",
      tags: [],
      runtimeId: "runtime-1",
      provider: "codex",
      daemonKey: "daemon-1",
      deviceName: "MacBook",
      version: "1.0.0",
      lastHeartbeatAt: "2026-04-10T09:00:00.000Z",
      runtimeStatus: "online",
      providerHealth: {
        runtimeStatus: "online",
        providerHealth: "healthy",
        providerUsable: "usable",
      },
      grantedMembers: [],
      canManageGrants: true,
      boundEmployees: ["planner"],
      agentCount: 1,
      queueCounts: {
        queued: 0,
        running: 1,
        failed: 0,
        completed: 2,
      },
      installedApps: [],
      recentAppOperations: [],
      recentExecutions: [],
    },
  ],
  agents: [
    {
      id: "agent:planner",
      kind: "agent",
      name: "Planner",
      subtitle: "Travel planner",
      description: "Plans itineraries",
      status: "linked",
      statusLabel: "在线",
      tags: [],
      internalName: "planner",
      origin: "workspace",
      canManage: true,
      canManageChannelMemberAccess: true,
      channelMemberAccess: "enabled",
      fit: "Great for planning",
      summary: "Plans itineraries and travel docs",
      skills: [],
      channels: ["travel"],
      tasks: [],
      recentMessages: [],
      boundContainerId: "runtime-1",
      boundContainerName: "Local Runtime",
      boundContainerStatus: "online",
      boundProvider: "codex",
      boundProviderHealth: {
        runtimeStatus: "online",
        providerHealth: "healthy",
        providerUsable: "usable",
      },
      boundAt: "2026-04-10T08:00:00.000Z",
      workAreas: [
        {
          id: "group:travel:planner",
          queueId: "group:travel:planner",
          title: "travel",
          channel: "travel",
          queueStatus: "completed",
          updatedAt: "2026-04-10 10:00",
          sessionId: "sess-1",
          workDir: "/tmp/travel-workspace",
          workDirAccess: "remote",
          workDirHostLabel: "Build Box 1",
          errorText: "上一次执行失败",
        },
      ],
      instructions: "Keep plans concise.",
      knowledge: {
        directPageIds: ["knowledge-planner-playbook"],
        inheritedPages: [
          {
            id: "knowledge-shared-handbook",
            title: "Shared handbook",
            tags: ["shared"],
            updatedAt: "2026-04-10T08:00:00.000Z",
            assignmentMode: "all_agents",
          },
        ],
        directPages: [
          {
            id: "knowledge-planner-playbook",
            title: "Planner playbook",
            tags: ["planning"],
            updatedAt: "2026-04-10T08:00:00.000Z",
            assignmentMode: "selected_agents",
          },
        ],
        assignablePages: [
          {
            id: "knowledge-legal-memo",
            title: "Legal memo",
            tags: ["legal"],
            updatedAt: "2026-04-10T08:00:00.000Z",
            assignmentMode: "selected_agents",
          },
        ],
        totalAvailableCount: 2,
        directCount: 1,
        inheritedCount: 1,
      },
      documentAccess: {
        readableCount: 1,
        editableCount: 1,
        forwardableCount: 1,
        externalCount: 1,
        pendingRequestCount: 1,
        rejectedRequestCount: 0,
        grants: [
          {
            id: "grant-1",
            documentId: "doc-1",
            documentTitle: "Travel budget",
            channelName: "travel",
            role: "forwarder",
            source: "explicit_grant",
            storageMode: "external",
            externalProvider: "google_workspace",
            externalFileId: "sheet-1",
            externalUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
            latestExternalRunStatus: "succeeded",
            latestExternalRunAt: "2026-04-10T08:00:00.000Z",
            updatedAt: "2026-04-10T08:00:00.000Z",
          },
        ],
        requests: [
          {
            id: "request-1",
            status: "pending",
            requestedRole: "editor",
            targetLabel: "Vendor notes",
            requestedForChannelName: "travel",
            reason: "Need to update the shared vendor notes.",
            createdAt: "2026-04-10T08:00:00.000Z",
          },
        ],
      },
      feishuAgentBotSetupReference: {
        requiredCredentialFields: ["app_id", "app_secret"],
        requiredEvents: ["im.message.receive_v1", "im.chat.member.bot.added_v1", "card.action.trigger"],
        requiredScopes: [
          "im:message",
          "im:message:send_as_bot",
          "contact:user.base:readonly",
          "docx:document",
          "drive:drive",
          "sheets:spreadsheet",
          "bitable:app",
        ],
        eventCallbackPath: "/api/integrations/feishu/events",
      },
    },
  ],
  showcaseAgents: [
    {
      id: "agent:designer",
      kind: "digital_employee_showcase_agent",
      name: "Design Partner",
      subtitle: "Digital employee",
      description: "Shapes product concepts",
      status: "linked",
      statusLabel: "在线",
      tags: ["product"],
      internalName: "designer",
      role: "Product Designer",
      summary: "Helps turn product ideas into reviewable interface plans.",
      fit: "Design exploration",
      traits: ["界面设计", "评审材料"],
      ownerUserId: "user-designer-owner",
      ownerDisplayName: "Dana",
      managedByLabel: "Dana 管理",
      canManage: false,
      isOwnedByCurrentUser: false,
      channelMemberAccess: "enabled",
      channels: ["travel"],
      commonChannels: ["travel"],
      skillCount: 2,
      knowledgeCount: 1,
      skillHighlights: [
        { name: "interface-review", summary: "Review product UI flows" },
        { name: "brief-writing", summary: "Prepare design briefs" },
      ],
      knowledgeHighlights: [
        { title: "Design handbook", source: "direct" },
      ],
      readiness: {
        status: "ready",
        label: "可用",
        reason: "codex · Local Runtime",
      },
      usageHints: ["可在共同频道调用：travel", "2 个技能", "1 份知识"],
      lastActivityAt: "2026-04-10T09:30:00.000Z",
      requestableActions: ["fork_copy"],
      reviewableRequests: [],
    },
  ],
  daemonSnapshots: [
    {
      daemonKey: "daemon-1",
      deviceName: "Build Box 1",
      status: "online",
      lastHeartbeatAt: "2026-04-10T09:00:00.000Z",
      mode: "remote",
      serverUrl: "https://daemon.example.com",
      runtimeName: "Remote Agent",
      googleWorkspaceReadiness: {
        checkedAt: "2026-04-10T09:00:00.000Z",
        executor: "gws",
        agentSpaceOutput: {
          available: true,
          version: "agent-space output",
        },
        gws: {
          available: true,
          version: "gws 0.22.5",
        },
        bwrap: {
          available: true,
          version: "bubblewrap 0.11.0",
          supportsPerms: true,
        },
      },
      runtimes: [
        {
          id: "runtime-1",
          provider: "codex",
          name: "Remote Codex",
          status: "online",
          lastHeartbeatAt: "2026-04-10T09:00:00.000Z",
          version: "1.0.0",
          providerHealth: {
            runtimeStatus: "online",
            providerHealth: "healthy",
            providerUsable: "usable",
          },
        },
      ],
    },
  ],
  daemonTokens: [
    {
      id: "daemon-token-1",
      label: "build-box-1",
      status: "active",
      createdBy: "Tianyu",
      lastUsedAt: "2026-04-10T09:00:00.000Z",
      createdAt: "2026-04-10T08:00:00.000Z",
    },
  ],
  workspaceSkills: [],
  workspaceMembers: [],
  pendingForkInvitations: [],
  channels: [
    {
      name: "travel",
      memberLabel: "1 人类 / 1 agent",
    },
  ],
  containerOptions: [
    {
      id: "runtime-1",
      label: "Local Runtime",
      provider: "codex",
      status: "online",
      serverName: "MacBook",
      daemonKey: "daemon-1",
      mode: "remote",
      providerHealth: {
        runtimeStatus: "online",
        providerHealth: "healthy",
        providerUsable: "usable",
      },
    },
  ],
  canManageRuntimes: true,
  canConnectRuntimes: true,
  canManageAllAgents: true,
  canCreateAgent: true,
  totalAgents: 1,
  containerCount: 1,
  boundAgentCount: 1,
  unboundAgentCount: 0,
  activeTaskCount: 0,
  activeWorkAreaCount: 0,
};

afterEach(() => {
  vi.useRealTimers();
});

function renderAgentsPage(
  pageData: AgentsPageData = data,
  props?: {
    onDataChanged?: () => void;
    onInvalidation?: AgentsPageClientProps["onInvalidation"];
    navigateWorkspaceModule?: (href: string, options?: { replace?: boolean }) => boolean;
  },
) {
  const content = (
    <AgentsPageClient
      data={pageData}
      onDataChanged={props?.onDataChanged}
      onInvalidation={props?.onInvalidation}
    />
  );

  return render(
    <LanguageProvider initialLanguage="zh">
      <FeedbackToastProvider>
        {props?.navigateWorkspaceModule ? (
          <WorkspaceModuleNavigationProvider navigateWorkspaceModule={props.navigateWorkspaceModule}>
            {content}
          </WorkspaceModuleNavigationProvider>
        ) : content}
      </FeedbackToastProvider>
    </LanguageProvider>,
  );
}

type AgentsPageClientProps = ComponentProps<typeof AgentsPageClient>;

function buildAgentFeishuBot(
  overrides: Partial<NonNullable<AgentsPageData["agents"][number]["feishuAgentBot"]>> = {},
): NonNullable<AgentsPageData["agents"][number]["feishuAgentBot"]> {
  return {
    id: "feishu-agent-bot-planner",
    displayName: "Planner Feishu Bot",
    status: "active",
    transportMode: "websocket_worker",
    agentId: "planner",
    appId: "cli_planner",
    callbackUrl: "",
    createdAt: "2026-04-10T08:00:00.000Z",
    updatedAt: "2026-04-10T08:00:00.000Z",
    lastHealthStatus: "healthy",
    hasAppSecret: true,
    hasVerificationToken: false,
    hasEncryptKey: false,
    userBindingCount: 1,
    channelBindingCount: 2,
    resourceBindingCount: 0,
    operationRunCount: 0,
    outboxFailureCount: 0,
    userBindings: [],
    channelBindings: [],
    resourceBindings: [],
    operationRuns: [],
    recentOutboxFailures: [],
    recentInboundEvents: [],
    channelAutoProvisioning: {
      botAdded: "auto_create_channel",
      firstMessage: "auto_create_if_bot_mentioned",
      reviewStatus: "approved",
    },
    externalGuestPolicy: {
      unboundUserMode: "reply_on_mention",
      guestPermissionProfile: "channel_context_only",
      requireIdentityFor: ["writes", "approvals", "private_resources", "runtime_sensitive_tools"],
    },
    setupGuide: {
      requiredCredentialFields: ["app_id", "app_secret"],
      requiredEvents: ["im.message.receive_v1", "im.chat.member.bot.added_v1", "card.action.trigger"],
      requiredScopes: ["im:message"],
      eventCallbackPath: "/api/integrations/feishu/events",
      developerConsoleUrl: "https://open.feishu.cn/app",
      openPlatformSetupSteps: [],
      checks: [],
      evidenceGates: [],
      commands: {
        healthCheck: "agent-space integrations feishu health-check --workspace-id workspace-1 --agent planner --strict --json",
        bindSecondAgentBot: "agent-space integrations feishu bind-agent-bot --workspace-id workspace-1 --agent CHANGE_ME_SECOND_AGENT_NAME --env-file scripts/feishu/.env --app-id-env FEISHU_SECOND_AGENT_APP_ID --app-secret-env FEISHU_SECOND_AGENT_APP_SECRET --json",
        botReadiness: "agent-space integrations feishu agent-bot-readiness --workspace-id workspace-1 --agent planner --strict --require bot --json",
        dataPlaneReadiness: "agent-space integrations feishu agent-bot-readiness --workspace-id workspace-1 --agent planner --strict --require data-plane --json",
        workerReadiness: "agent-space integrations feishu agent-bot-readiness --workspace-id workspace-1 --agent planner --strict --require worker --json",
        autoProvisionPolicy: "agent-space integrations feishu auto-provision-policy --workspace-id workspace-1 --agent planner --bot-added-policy auto_create_channel --first-message-policy auto_create_if_bot_mentioned --unbound-user-mode reply_on_mention --guest-permission-profile channel_context_only --json",
        agentChannelAccessDisable: "agent-space integrations feishu agent-channel-access --workspace-id workspace-1 --agent planner --access disabled --json",
        agentChannelAccessRestore: "agent-space integrations feishu agent-channel-access --workspace-id workspace-1 --agent planner --access enabled --json",
        channelBindings: "agent-space integrations feishu channel-bindings --workspace-id workspace-1 --integration feishu-agent-bot-planner --json",
        smokeEnv: "agent-space integrations feishu smoke-env --workspace-id workspace-1 --integration feishu-agent-bot-planner --app-url https://agent.test > scripts/feishu/.env",
        checkEnv: "npm run smoke:feishu -- --env-file scripts/feishu/.env --check-env --json --require-todo120-native",
        strictLiveSmoke: "npm run smoke:feishu -- --env-file scripts/feishu/.env --live --strict-live --evidence runtime-output/feishu-smoke/live.json --json --require-todo120-native",
        verifyOpenApiEvidence: "npm run smoke:feishu -- --verify-evidence runtime-output/feishu-smoke/live.json --json",
        smokePlan: "agent-space integrations feishu smoke-plan --workspace-id workspace-1 --integration feishu-agent-bot-planner --app-url https://agent.test --json",
        evidence: "agent-space integrations feishu evidence --workspace-id workspace-1 --integration feishu-agent-bot-planner --openapi-evidence runtime-output/feishu-smoke/live.json --strict --require all --json",
      },
    },
    ...overrides,
  };
}

describe("AgentsPageClient", () => {
  beforeEach(() => {
    Array.from(searchParams.keys()).forEach((key) => searchParams.delete(key));
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.mocked(createWorkspaceAgentAction).mockResolvedValue({ data: undefined });
    vi.mocked(createAgentAccessRequestAction).mockResolvedValue({ data: undefined });
    vi.mocked(approveAgentAccessRequestAction).mockResolvedValue({ data: undefined });
    vi.mocked(cancelAgentAccessRequestAction).mockResolvedValue({ data: undefined });
    vi.mocked(rejectAgentAccessRequestAction).mockResolvedValue({ data: undefined });
    vi.mocked(deleteWorkspaceRuntimeAction).mockResolvedValue({ data: undefined });
    vi.mocked(updateWorkspaceRuntimeDisplayNameAction).mockResolvedValue({ data: undefined });
    mockMatchMedia(false);
    mockRefresh.mockReset();
    mockReplace.mockReset();
    vi.useRealTimers();
  });

  it("switches between agent list and detail on compact layouts", async () => {
    mockMatchMedia(true);
    const user = userEvent.setup();

    renderAgentsPage();

    expect(screen.getByRole("button", { name: /Planner/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回列表" })).not.toBeInTheDocument();
    expect(screen.queryByText("保存 Instructions")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Planner/i }));

    expect(await screen.findByRole("button", { name: "返回列表" })).toBeInTheDocument();
    expect(screen.getByText("Agent 详情")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存 Instructions" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Workspaces" }));
    expect(screen.getByText("执行工作区")).toBeInTheDocument();
    expect(screen.getByText(/可复用会话: sess-1/)).toBeInTheDocument();
    expect(screen.getByText(/远程执行工作区: Build Box 1/)).toBeInTheDocument();
    expect(screen.getByText("上一次执行失败")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "返回列表" }));

    expect(screen.getByRole("button", { name: /Planner/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回列表" })).not.toBeInTheDocument();
  });

  it("renders a help hint beside the new agent action", async () => {
    const user = userEvent.setup();

    renderAgentsPage();

    const helpButton = screen.getByRole("button", { name: "新建 Agent 说明" });
    expect(screen.getByRole("button", { name: "新建 Agent" })).toBeInTheDocument();
    expect(helpButton).toBeInTheDocument();
    await user.hover(helpButton);
    expect(await screen.findByText("Agent 可先创建，后续再绑定执行引擎和 skills。")).toBeInTheDocument();
  });

  it("shows agent knowledge assignments", async () => {
    const user = userEvent.setup();

    renderAgentsPage();

    await user.click(screen.getByRole("button", { name: "Knowledge" }));
    expect(screen.getByText("Shared handbook")).toBeInTheDocument();
    expect(screen.getByText("Planner playbook")).toBeInTheDocument();
  });

  it("shows agent document access and permission requests", async () => {
    const user = userEvent.setup();

    renderAgentsPage();

    await user.click(screen.getByRole("button", { name: "文档权限" }));

    expect(screen.getByText("Travel budget")).toBeInTheDocument();
    expect(screen.getByText("Vendor notes")).toBeInTheDocument();
    expect(screen.getByText("Need to update the shared vendor notes.")).toBeInTheDocument();
    expect(screen.getAllByText("可转发").length).toBeGreaterThan(0);
    expect(screen.getByText("待审批")).toBeInTheDocument();
  });

  it("requests a copy from the digital employee showcase", async () => {
    searchParams.set("mode", "showcase");
    const user = userEvent.setup();

    renderAgentsPage();

    expect(screen.getByRole("heading", { name: "数字员工展板" })).toBeInTheDocument();
    expect(screen.getByText("Design Partner")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "申请复制给我" }));
    await user.type(screen.getByLabelText("申请说明"), "用于整理旅行产品的评审材料");
    await user.click(screen.getByRole("button", { name: "发送申请" }));

    await waitFor(() => {
      expect(createAgentAccessRequestAction).toHaveBeenCalledWith({
        sourceAgentName: "designer",
        requestType: "fork_copy",
        targetChannelName: undefined,
        reason: "用于整理旅行产品的评审材料",
      });
    });
  });

  it("requests channel use from the digital employee showcase", async () => {
    searchParams.set("mode", "showcase");
    const user = userEvent.setup();

    renderAgentsPage({
      ...data,
      showcaseAgents: [
        {
          ...data.showcaseAgents[0]!,
          channelMemberAccess: "disabled",
          requestableActions: ["fork_copy", "channel_use"],
          usageHints: ["可申请在共同频道使用：travel", "2 个技能", "1 份知识"],
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "申请使用权限" }));
    await user.click(screen.getByRole("radio", { name: /在频道使用/ }));
    await user.type(screen.getByLabelText("申请说明"), "希望在旅行频道里调用它整理设计反馈");
    await user.click(screen.getByRole("button", { name: "发送申请" }));

    await waitFor(() => {
      expect(createAgentAccessRequestAction).toHaveBeenCalledWith({
        sourceAgentName: "designer",
        requestType: "channel_use",
        targetChannelName: "travel",
        reason: "希望在旅行频道里调用它整理设计反馈",
      });
    });
  });

  it("shows a review queue on the digital employee showcase", async () => {
    searchParams.set("mode", "showcase");
    const user = userEvent.setup();

    renderAgentsPage({
      ...data,
      showcaseAgents: [
        {
          ...data.showcaseAgents[0]!,
          reviewableRequests: [
            {
              id: "agent-access-request-1",
              sourceAgentName: "designer",
              requesterUserId: "user-requester",
              requesterDisplayName: "Mina",
              requestType: "channel_use",
              targetChannelName: "travel",
              status: "pending",
              reason: "Use it for design review in the travel channel.",
              createdAt: "2026-04-10T09:00:00.000Z",
              updatedAt: "2026-04-10T09:00:00.000Z",
              canDecide: true,
            },
          ],
        },
      ],
    });

    expect(screen.getByLabelText("待我审批")).toBeInTheDocument();
    expect(screen.getByText("Use it for design review in the travel channel.")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "批准" })[0]!);

    await waitFor(() => {
      expect(approveAgentAccessRequestAction).toHaveBeenCalledWith({
        requestId: "agent-access-request-1",
      });
    });
  });

  it("shows provider usability in agent settings", async () => {
    const user = userEvent.setup();
    const brokenData: AgentsPageData = {
      ...data,
      agents: [
        {
          ...data.agents[0]!,
          boundProviderHealth: {
            runtimeStatus: "online",
            providerHealth: "broken",
            providerUsable: "unusable",
            providerHealthReason: "Authentication failed.",
            lastProviderErrorCode: "provider.auth_invalid",
            lastProviderErrorMessage: "Token expired.",
          },
        },
      ],
    };

    renderAgentsPage(brokenData);

    await user.click(screen.getByRole("button", { name: "设置" }));

    expect(screen.getByText("Provider 状态")).toBeInTheDocument();
    expect(screen.getAllByText("不可用").length).toBeGreaterThan(0);
    expect(screen.getByText(/provider.auth_invalid/)).toBeInTheDocument();
  });

  it("shows an agent-scoped Feishu bot in agent settings", async () => {
    const user = userEvent.setup();

    renderAgentsPage({
      ...data,
      agents: [
        {
          ...data.agents[0]!,
          feishuAgentBot: buildAgentFeishuBot(),
          canManageFeishuAgentBot: true,
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "设置" }));

    expect(screen.getByText("Feishu Bot")).toBeInTheDocument();
    expect(screen.getByText("Planner Feishu Bot")).toBeInTheDocument();
    expect(screen.getByText("健康")).toBeInTheDocument();
    expect(screen.getByText("agent-space integrations feishu health-check --workspace-id workspace-1 --agent planner --strict --json")).toBeInTheDocument();
    expect(screen.getByText("agent-space integrations feishu bind-agent-bot --workspace-id workspace-1 --agent CHANGE_ME_SECOND_AGENT_NAME --env-file scripts/feishu/.env --app-id-env FEISHU_SECOND_AGENT_APP_ID --app-secret-env FEISHU_SECOND_AGENT_APP_SECRET --json")).toBeInTheDocument();
    expect(screen.getByText("先在 scripts/feishu/.env 填入第二个飞书 app 凭据，再运行此命令创建 AgentSpace 里的第二个 Bot 绑定。")).toBeInTheDocument();
    expect(screen.getByText("agent-space integrations feishu agent-channel-access --workspace-id workspace-1 --agent planner --access disabled --json")).toBeInTheDocument();
    expect(screen.getByText("agent-space integrations feishu agent-channel-access --workspace-id workspace-1 --agent planner --access enabled --json")).toBeInTheDocument();
    expect(screen.getByText("npm run smoke:feishu -- --env-file scripts/feishu/.env --check-env --json --require-todo120-native")).toBeInTheDocument();
    expect(screen.getByText("npm run smoke:feishu -- --env-file scripts/feishu/.env --live --strict-live --evidence runtime-output/feishu-smoke/live.json --json --require-todo120-native")).toBeInTheDocument();
    expect(screen.getByText("agent-space integrations feishu evidence --workspace-id workspace-1 --integration feishu-agent-bot-planner --openapi-evidence runtime-output/feishu-smoke/live.json --strict --require all --json")).toBeInTheDocument();
    expect(screen.getByText("im.chat.member.bot.added_v1")).toBeInTheDocument();
    expect(screen.getByText("im:message")).toBeInTheDocument();
    expect(screen.getByText("调整治理策略")).toBeInTheDocument();
  });

  it("binds a Feishu bot from agent settings with only App ID and App Secret", async () => {
    const user = userEvent.setup();

    renderAgentsPage({
      ...data,
      agents: [
        {
          ...data.agents[0]!,
          canManageFeishuAgentBot: true,
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByText("im.chat.member.bot.added_v1")).toBeInTheDocument();
    expect(screen.getByText("sheets:spreadsheet")).toBeInTheDocument();
    await user.type(screen.getByLabelText("App ID"), "cli_planner");
    await user.type(screen.getByLabelText("App Secret"), "secret_planner");
    await user.click(screen.getByRole("button", { name: "绑定 Bot" }));

    await waitFor(() => {
      expect(createFeishuAgentBotBindingAction).toHaveBeenCalledWith({
        agentId: "planner",
        displayName: "",
        transportMode: "websocket_worker",
        appId: "cli_planner",
        appSecret: "secret_planner",
        verificationToken: "",
        encryptKey: "",
        tenantKey: "",
        channelAutoProvisioning: {
          botAdded: "auto_create_channel",
          firstMessage: "auto_create_if_bot_mentioned",
          reviewStatus: "approved",
        },
        externalGuestPolicy: {
          unboundUserMode: "reply_on_mention",
          guestPermissionProfile: "channel_context_only",
          requireIdentityFor: [
            "writes",
            "approvals",
            "private_resources",
            "runtime_sensitive_tools",
          ],
        },
      });
    });
  });

  it("binds a Feishu bot from agent settings with EventCallback advanced options", async () => {
    const user = userEvent.setup();

    renderAgentsPage({
      ...data,
      agents: [
        {
          ...data.agents[0]!,
          canManageFeishuAgentBot: true,
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.type(screen.getByLabelText("App ID"), "cli_planner_event");
    await user.type(screen.getByLabelText("App Secret"), "secret_planner_event");
    await user.click(screen.getByText("自定义高级功能"));
    await user.type(screen.getByLabelText("名称"), "Planner Event Bot");
    await user.selectOptions(screen.getByLabelText("连接方式"), "http_webhook");
    await user.type(screen.getByLabelText("Tenant Key"), "tenant_planner");
    await user.type(screen.getByLabelText(/Verification Token/), "verify_planner");
    await user.type(screen.getByLabelText("Encrypt Key"), "encrypt_planner");
    await user.selectOptions(screen.getByLabelText("机器人进群"), "pending_admin_review");
    await user.selectOptions(screen.getByLabelText("首次消息"), "reply_with_setup_card");
    await user.selectOptions(screen.getByLabelText("建群审核状态"), "needs_identity_binding");
    await user.selectOptions(screen.getByLabelText("未绑定用户"), "require_identity");
    await user.selectOptions(screen.getByLabelText("访客权限"), "none");
    await user.click(screen.getByRole("button", { name: "绑定 Bot" }));

    await waitFor(() => {
      expect(createFeishuAgentBotBindingAction).toHaveBeenCalledWith({
        agentId: "planner",
        displayName: "Planner Event Bot",
        transportMode: "http_webhook",
        appId: "cli_planner_event",
        appSecret: "secret_planner_event",
        verificationToken: "verify_planner",
        encryptKey: "encrypt_planner",
        tenantKey: "tenant_planner",
        channelAutoProvisioning: {
          botAdded: "pending_admin_review",
          firstMessage: "reply_with_setup_card",
          reviewStatus: "needs_identity_binding",
        },
        externalGuestPolicy: {
          unboundUserMode: "require_identity",
          guestPermissionProfile: "none",
          requireIdentityFor: [
            "writes",
            "approvals",
            "private_resources",
            "runtime_sensitive_tools",
          ],
        },
      });
    });
  });

  it("rotates EventCallback Feishu bot credentials from agent settings", async () => {
    const user = userEvent.setup();

    renderAgentsPage({
      ...data,
      agents: [
        {
          ...data.agents[0]!,
          feishuAgentBot: buildAgentFeishuBot({
            transportMode: "http_webhook",
            appId: "cli_planner_old",
            tenantKey: "tenant_old",
            hasVerificationToken: true,
            hasEncryptKey: true,
          }),
          canManageFeishuAgentBot: true,
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByText("轮换凭据", { selector: "span" }));
    await user.type(screen.getByLabelText("App ID"), "cli_planner_rotated");
    await user.type(screen.getByLabelText("新 App Secret"), "secret_rotated");
    await user.type(screen.getByLabelText("Tenant Key"), "tenant_rotated");
    await user.type(screen.getByLabelText("Verification Token"), "verify_rotated");
    await user.type(screen.getByLabelText("Encrypt Key"), "encrypt_rotated");
    await user.click(screen.getByRole("button", { name: "轮换凭据" }));

    await waitFor(() => {
      expect(rotateFeishuAgentBotCredentialsAction).toHaveBeenCalledWith({
        integrationId: "feishu-agent-bot-planner",
        appId: "cli_planner_rotated",
        appSecret: "secret_rotated",
        tenantKey: "tenant_rotated",
        verificationToken: "verify_rotated",
        encryptKey: "encrypt_rotated",
      });
    });
  });

  it("lets admins toggle channel member access for a workspace agent", async () => {
    const user = userEvent.setup();

    renderAgentsPage();

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("switch", { name: "允许群成员调用" }));

    await waitFor(() => {
      expect(setWorkspaceAgentChannelMemberAccessAction).toHaveBeenCalledWith({
        employeeName: "planner",
        channelMemberAccess: "disabled",
      });
    });
  });

  it("lets admins toggle channel member access for a personal agent", async () => {
    const user = userEvent.setup();

    renderAgentsPage({
      ...data,
      agents: [
        {
          ...data.agents[0]!,
          ownerUserId: "user-agent-owner",
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("switch", { name: "允许群成员调用" }));

    await waitFor(() => {
      expect(setWorkspaceAgentChannelMemberAccessAction).toHaveBeenCalledWith({
        employeeName: "planner",
        channelMemberAccess: "disabled",
      });
    });
  });

  it("shows server identity in the execution engine picker", async () => {
    const user = userEvent.setup();
    const dataWithEngines: AgentsPageData = {
      ...data,
      containerOptions: [
        data.containerOptions[0]!,
        {
          id: "runtime-2",
          label: "Local Runtime",
          provider: "hermes",
          status: "online",
          providerHealth: {
            runtimeStatus: "online",
            providerHealth: "healthy",
            providerUsable: "usable",
          },
          serverName: "Build Box 2",
          daemonKey: "daemon-2",
          mode: "remote",
        },
      ],
    };

    renderAgentsPage(dataWithEngines);

    await user.click(screen.getByRole("button", { name: "新建 Agent" }));
    expect(screen.getByRole("button", { name: "执行引擎" })).toBeInTheDocument();
    expect(screen.getByText("MacBook")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "执行引擎" }));

    expect(screen.getByText("Build Box 2")).toBeInTheDocument();
    expect(screen.getByText("Hermes Agent")).toBeInTheDocument();
    expect(screen.getByText("daemon-2")).toBeInTheDocument();
  });

  it("creates an agent from the finance template with preloaded skills", async () => {
    const user = userEvent.setup();
    const dataWithPreloadedSkill: AgentsPageData = {
      ...data,
      workspaceSkills: [
        {
          id: "skill-finance",
          name: "financial-analysis-agent",
          description: "Financial analysis workflow imported from Skill Hub.",
          sourceType: "skills.sh",
          sourceUrl: "https://skills.sh/qodex-ai/ai-agent-skills/financial-analysis-agent",
          configJson: "{}",
          files: [],
          createdAt: "2026-04-10T08:00:00.000Z",
          updatedAt: "2026-04-10T08:00:00.000Z",
        },
      ],
    };

    renderAgentsPage(dataWithPreloadedSkill);

    await user.click(screen.getByRole("button", { name: "新建 Agent" }));

    expect(screen.getByRole("button", { name: /财务分析 Agent/ })).toBeInTheDocument();
    expect(screen.getByText("已准备 1/1 个预置技能")).toBeInTheDocument();
    expect(screen.getByText("Financial Analysis Agent")).toBeInTheDocument();
    expect(screen.getByText("模板技能由系统预置并在创建时自动绑定，无需手动导入。")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "从模板创建" }).at(-1)!);

    await waitFor(() => {
      expect(createWorkspaceAgentAction).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "finance-analyst",
          remarkName: "财务分析 Agent",
          runtimeId: "runtime-1",
          templateId: "finance-analyst",
        }),
      );
    });
  });

  it("passes action invalidation hints through the workbench callback", async () => {
    const user = userEvent.setup();
    const onDataChanged = vi.fn();
    const onInvalidation = vi.fn();
    const invalidation = {
      workspaceId: "workspace-1",
      modules: ["agents" as const],
      resources: [{ type: "agent" as const, id: "Atlas" }],
      shell: "counters" as const,
    };
    vi.mocked(createWorkspaceAgentAction).mockResolvedValueOnce({
      data: undefined,
      invalidation,
    });

    renderAgentsPage(data, { onDataChanged, onInvalidation });

    await user.click(screen.getByRole("button", { name: "新建 Agent" }));
    await user.click(screen.getAllByRole("button", { name: "从模板创建" }).at(-1)!);

    await waitFor(() => expect(createWorkspaceAgentAction).toHaveBeenCalled());
    expect(onInvalidation).toHaveBeenCalledWith(invalidation);
    expect(onDataChanged).toHaveBeenCalledTimes(1);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("renders a help hint beside the connect server action", async () => {
    searchParams.set("mode", "container");
    const user = userEvent.setup();

    renderAgentsPage();

    const helpButton = screen.getByRole("button", { name: "接入服务器说明" });
    expect(screen.getByRole("button", { name: "接入服务器" })).toBeInTheDocument();
    expect(helpButton).toBeInTheDocument();
    await user.hover(helpButton);
    expect(await screen.findByText("接入服务器后会自动上报可用执行引擎。")).toBeInTheDocument();
  });

  it("lets regular members view execution engines assigned to them", () => {
    searchParams.set("mode", "container");

    renderAgentsPage({
      ...data,
      canManageRuntimes: false,
      canConnectRuntimes: true,
      canManageAllAgents: false,
      daemonSnapshots: [],
      daemonTokens: [],
      containers: data.containers.map((container) => ({
        ...container,
        daemonKey: "",
        canManageGrants: false,
        grantedMembers: [],
      })),
      containerOptions: data.containerOptions.map((option) => ({
        ...option,
        daemonKey: "",
      })),
    });

    expect(screen.getByRole("heading", { name: "在线执行引擎" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Local Runtime/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "接入服务器" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /服务器管理/ })).not.toBeInTheDocument();
  });

  it("lets regular members open the execution engine view before any engine is assigned", async () => {
    searchParams.set("mode", "container");
    const user = userEvent.setup();

    renderAgentsPage({
      ...data,
      canManageRuntimes: false,
      canConnectRuntimes: true,
      canManageAllAgents: false,
      daemonSnapshots: [],
      daemonTokens: [],
      containers: [],
      containerOptions: [],
      containerCount: 0,
      boundAgentCount: 0,
    });

    expect(screen.getByRole("heading", { name: "在线执行引擎" })).toBeInTheDocument();
    expect(screen.getByText("当前没有在线执行引擎。先接入一台服务器。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /服务器管理/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "接入服务器" }));

    expect(createContainerInstallTokenAction).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: "接入服务器" })).toBeInTheDocument();
  });

  it("saves a custom execution engine remark", async () => {
    searchParams.set("mode", "container");
    const user = userEvent.setup();

    renderAgentsPage();

    await user.click(screen.getAllByRole("button", { name: "编辑备注名" })[0]);
    await user.type(screen.getByLabelText("备注名"), "办公室 Mac mini");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(updateWorkspaceRuntimeDisplayNameAction).toHaveBeenCalledWith({
        runtimeId: "runtime-1",
        displayName: "办公室 Mac mini",
      });
    });
  });

  it("lets admins delete an execution engine from the container view", async () => {
    searchParams.set("mode", "container");
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderAgentsPage();

    await user.click(screen.getByRole("button", { name: /删除执行引擎 Local Runtime/ }));

    await waitFor(() => {
      expect(deleteWorkspaceRuntimeAction).toHaveBeenCalledWith("runtime-1");
    });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("generates a bash install command from the container view", async () => {
    searchParams.set("mode", "container");
    const user = userEvent.setup();

    renderAgentsPage();

    await user.click(screen.getByRole("button", { name: "接入服务器" }));

    expect(createContainerInstallTokenAction).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: "接入服务器" })).toBeInTheDocument();
    expect(screen.getByDisplayValue(/bash <\(curl -fsSL http:\/\/localhost(?::3000)?\/api\/daemon\/install-script\)/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/--daemon-token "adt_test"/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/--daemon-id "daemon-/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "我已运行" })).toBeInTheDocument();
  });

  it("clears the create server deep link through workbench navigation when mounted as a module", async () => {
    searchParams.set("mode", "container");
    searchParams.set("create", "server");
    const navigateWorkspaceModule = vi.fn(() => true);

    renderAgentsPage(data, { navigateWorkspaceModule });

    expect(await screen.findByRole("heading", { name: "接入服务器" })).toBeInTheDocument();
    expect(navigateWorkspaceModule).toHaveBeenCalledWith(
      "/w/workspace-alpha/agents?mode=container",
      { replace: true },
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("generates a bash update command for an existing runtime", async () => {
    searchParams.set("mode", "container");
    const user = userEvent.setup();

    renderAgentsPage();

    await user.click(screen.getByRole("button", { name: "更新 Runtime" }));

    expect(createContainerInstallTokenAction).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: "更新 Runtime" })).toBeInTheDocument();
    expect(screen.getByDisplayValue(/bash <\(curl -fsSL http:\/\/localhost(?::3000)?\/api\/daemon\/install-script\)/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/--update-existing/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/--server-url "http:\/\/localhost(?::3000)?"/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/--daemon-token "adt_test"/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/--daemon-id "daemon-1"/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/--device-name "Build Box 1"/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/--runtime-name "Remote Agent"/)).toBeInTheDocument();
    expect(screen.getByText("daemon-token-1")).toBeInTheDocument();
  });

  it("polls onboarding status after the user confirms the install command was run", async () => {
    searchParams.set("mode", "container");
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: "online",
          runtimeCount: 1,
          runtimes: [{ id: "runtime-1", status: "online" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    renderAgentsPage();

    await user.click(screen.getByRole("button", { name: "接入服务器" }));
    await user.click(await screen.findByRole("button", { name: "我已运行" }));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/daemon\/onboarding-status\?daemonKey=daemon-/),
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(await screen.findByText("新执行引擎已上线。")).toBeInTheDocument();
  });

  it("shows daemon status and token management under the container tab", async () => {
    searchParams.set("mode", "container");
    const user = userEvent.setup();

    renderAgentsPage();

    expect(screen.queryByRole("heading", { name: "服务器接入令牌" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /服务器管理/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /服务器管理/ }));

    expect(screen.getByText("Build Box 1")).toBeInTheDocument();
    expect(screen.getByText("Remote Codex")).toBeInTheDocument();
    expect(screen.getByText(/Google Sheets readiness/)).toBeInTheDocument();
    expect(screen.getByText(/agent-space output: 可用/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "服务器接入令牌" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "创建新令牌" }));

    expect(await screen.findByText("新令牌已创建")).toBeInTheDocument();
    expect(screen.getByText("adt_secret_value")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清理旧 daemon" }));

    expect(pruneOldOfflineDaemonsAction).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("polls router.refresh while daemon or work area activity is active", () => {
    vi.useFakeTimers();

    renderAgentsPage();

    vi.advanceTimersByTime(3100);

    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});

describe("AgentDetail", () => {
  it("searches and updates agent knowledge assignments", async () => {
    const user = userEvent.setup();
    const onSetKnowledgePageIds = vi.fn();

    render(
      <LanguageProvider initialLanguage="zh">
        <AgentDetail
          containerOptions={data.containerOptions}
          pending={false}
          record={data.agents[0]!}
          workspaceSkills={[]}
          onBindContainer={vi.fn()}
          onDeleteAgent={vi.fn()}
          onSaveInstructions={vi.fn()}
          onSetKnowledgePageIds={onSetKnowledgePageIds}
          onSetSkillIds={vi.fn()}
          onUnbindContainer={vi.fn()}
        />
      </LanguageProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Knowledge" }));
    await user.click(screen.getByRole("button", { name: "添加知识" }));
    await user.type(await screen.findByPlaceholderText("搜索知识页"), "legal");
    await user.click(await screen.findByRole("button", { name: /Legal memo/i }));

    await waitFor(() => {
      expect(onSetKnowledgePageIds).toHaveBeenCalledWith([
        "knowledge-planner-playbook",
        "knowledge-legal-memo",
      ]);
    });
  });
});
