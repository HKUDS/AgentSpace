import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SidebarVisibilityProvider,
  SIDEBAR_VISIBILITY_STORAGE_KEY,
} from "@/features/dashboard/sidebar-visibility-provider";
import { WORKSPACE_ONBOARDING_REPLAY_EVENT } from "@/features/dashboard/onboarding-guide";
import { SettingsPageClient } from "@/features/settings/settings-page-client";
import { LanguageProvider } from "@/features/i18n/language-provider";

const {
  mockPermissionsUpdateWorkspaceMemberRoleAction,
} = vi.hoisted(() => ({
  mockPermissionsUpdateWorkspaceMemberRoleAction: vi.fn(),
}));

const {
  mockAddWorkspaceMemberAction,
  mockCreateWorkspaceInvitationAction,
  mockRemoveWorkspaceMemberAction,
  mockReissueWorkspaceInvitationAction,
  mockRotateWorkspaceJoinCodeAction,
  mockRevokeOtherSessionsAction,
  mockRevokeSessionAction,
  mockRevokeWorkspaceInvitationAction,
  mockTransferWorkspaceOwnershipAction,
  mockUpdateCurrentUserProfileAction,
  mockCheckFeishuIntegrationHealthAction,
  mockCreateFeishuChannelBindingAction,
  mockCreateFeishuAgentBotBindingAction,
  mockCreateFeishuIntegrationAction,
  mockCreateFeishuResourceBindingAction,
  mockCreateFeishuUserBindingAction,
  mockDeleteFeishuIntegrationAction,
  mockDisableFeishuIntegrationAction,
  mockDisableFeishuAgentBotBindingAction,
  mockPauseFeishuChannelBindingAction,
  mockPauseFeishuResourceBindingAction,
  mockResumeFeishuIntegrationAction,
  mockResumeFeishuChannelBindingAction,
  mockResumeFeishuResourceBindingAction,
  mockResumeFeishuUserBindingAction,
  mockRevokeFeishuChannelBindingAction,
  mockRevokeFeishuResourceBindingAction,
  mockRevokeFeishuUserBindingAction,
  mockRotateFeishuIntegrationSecretAction,
  mockRotateFeishuAgentBotCredentialsAction,
  mockTestFeishuIntegrationConnectionAction,
  mockUpdateWorkspaceProfileAction,
  mockUpdateWorkspaceMemberRoleAction,
} = vi.hoisted(() => ({
  mockAddWorkspaceMemberAction: vi.fn(),
  mockCreateWorkspaceInvitationAction: vi.fn(),
  mockRemoveWorkspaceMemberAction: vi.fn(),
  mockReissueWorkspaceInvitationAction: vi.fn(),
  mockRotateWorkspaceJoinCodeAction: vi.fn(),
  mockRevokeOtherSessionsAction: vi.fn(),
  mockRevokeSessionAction: vi.fn(),
  mockRevokeWorkspaceInvitationAction: vi.fn(),
  mockTransferWorkspaceOwnershipAction: vi.fn(),
  mockUpdateCurrentUserProfileAction: vi.fn(),
  mockCheckFeishuIntegrationHealthAction: vi.fn(),
  mockCreateFeishuChannelBindingAction: vi.fn(),
  mockCreateFeishuAgentBotBindingAction: vi.fn(),
  mockCreateFeishuIntegrationAction: vi.fn(),
  mockCreateFeishuResourceBindingAction: vi.fn(),
  mockCreateFeishuUserBindingAction: vi.fn(),
  mockDeleteFeishuIntegrationAction: vi.fn(),
  mockDisableFeishuIntegrationAction: vi.fn(),
  mockDisableFeishuAgentBotBindingAction: vi.fn(),
  mockPauseFeishuChannelBindingAction: vi.fn(),
  mockPauseFeishuResourceBindingAction: vi.fn(),
  mockResumeFeishuIntegrationAction: vi.fn(),
  mockResumeFeishuChannelBindingAction: vi.fn(),
  mockResumeFeishuResourceBindingAction: vi.fn(),
  mockResumeFeishuUserBindingAction: vi.fn(),
  mockRevokeFeishuChannelBindingAction: vi.fn(),
  mockRevokeFeishuResourceBindingAction: vi.fn(),
  mockRevokeFeishuUserBindingAction: vi.fn(),
  mockRotateFeishuIntegrationSecretAction: vi.fn(),
  mockRotateFeishuAgentBotCredentialsAction: vi.fn(),
  mockTestFeishuIntegrationConnectionAction: vi.fn(),
  mockUpdateWorkspaceProfileAction: vi.fn(),
  mockUpdateWorkspaceMemberRoleAction: vi.fn(),
}));

vi.mock("@/features/settings/actions", () => ({
  addWorkspaceMemberAction: mockAddWorkspaceMemberAction,
  createWorkspaceInvitationAction: mockCreateWorkspaceInvitationAction,
  removeWorkspaceMemberAction: mockRemoveWorkspaceMemberAction,
  reissueWorkspaceInvitationAction: mockReissueWorkspaceInvitationAction,
  rotateWorkspaceJoinCodeAction: mockRotateWorkspaceJoinCodeAction,
  revokeOtherSessionsAction: mockRevokeOtherSessionsAction,
  revokeSessionAction: mockRevokeSessionAction,
  revokeWorkspaceInvitationAction: mockRevokeWorkspaceInvitationAction,
  transferWorkspaceOwnershipAction: mockTransferWorkspaceOwnershipAction,
  updateCurrentUserProfileAction: mockUpdateCurrentUserProfileAction,
  updateWorkspaceProfileAction: mockUpdateWorkspaceProfileAction,
  updateWorkspaceMemberRoleAction: mockUpdateWorkspaceMemberRoleAction,
}));

vi.mock("@/features/integrations/feishu/feishu-actions", () => ({
  checkFeishuIntegrationHealthAction: mockCheckFeishuIntegrationHealthAction,
  createFeishuAgentBotBindingAction: mockCreateFeishuAgentBotBindingAction,
  createFeishuChannelBindingAction: mockCreateFeishuChannelBindingAction,
  createFeishuIntegrationAction: mockCreateFeishuIntegrationAction,
  createFeishuResourceBindingAction: mockCreateFeishuResourceBindingAction,
  createFeishuUserBindingAction: mockCreateFeishuUserBindingAction,
  deleteFeishuIntegrationAction: mockDeleteFeishuIntegrationAction,
  disableFeishuAgentBotBindingAction: mockDisableFeishuAgentBotBindingAction,
  disableFeishuIntegrationAction: mockDisableFeishuIntegrationAction,
  pauseFeishuChannelBindingAction: mockPauseFeishuChannelBindingAction,
  pauseFeishuResourceBindingAction: mockPauseFeishuResourceBindingAction,
  resumeFeishuIntegrationAction: mockResumeFeishuIntegrationAction,
  resumeFeishuChannelBindingAction: mockResumeFeishuChannelBindingAction,
  resumeFeishuResourceBindingAction: mockResumeFeishuResourceBindingAction,
  resumeFeishuUserBindingAction: mockResumeFeishuUserBindingAction,
  revokeFeishuChannelBindingAction: mockRevokeFeishuChannelBindingAction,
  revokeFeishuResourceBindingAction: mockRevokeFeishuResourceBindingAction,
  revokeFeishuUserBindingAction: mockRevokeFeishuUserBindingAction,
  rotateFeishuAgentBotCredentialsAction: mockRotateFeishuAgentBotCredentialsAction,
  rotateFeishuIntegrationSecretAction: mockRotateFeishuIntegrationSecretAction,
  testFeishuIntegrationConnectionAction: mockTestFeishuIntegrationConnectionAction,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock("@/features/permissions/actions", () => ({
  permissionsAddChannelDocumentCollaboratorAction: vi.fn(),
  permissionsAddWorkspaceMemberToChannelAction: vi.fn(),
  permissionsApproveAgentAccessRequestAction: vi.fn(),
  permissionsApproveChannelAccessRequestAction: vi.fn(),
  permissionsBindAgentRuntimeAction: vi.fn(),
  permissionsCreateDaemonApiTokenAction: vi.fn(),
  permissionsCreateWorkspaceInvitationAction: vi.fn(),
  permissionsDisconnectGoogleWorkspaceAction: vi.fn(),
  permissionsGrantRuntimeUseAction: vi.fn(),
  permissionsRejectAgentAccessRequestAction: vi.fn(),
  permissionsRejectChannelAccessRequestAction: vi.fn(),
  permissionsReissueWorkspaceInvitationAction: vi.fn(),
  permissionsRemoveChannelDocumentCollaboratorAction: vi.fn(),
  permissionsRemoveWorkspaceMemberAction: vi.fn(),
  permissionsRemoveWorkspaceMemberFromChannelAction: vi.fn(),
  permissionsRevokeAgentGoogleWorkspaceDelegationAction: vi.fn(),
  permissionsRevokeChannelInvitationAction: vi.fn(),
  permissionsRevokeDaemonApiTokenAction: vi.fn(),
  permissionsRevokeRuntimeUseAction: vi.fn(),
  permissionsRevokeWorkspaceInvitationAction: vi.fn(),
  permissionsSetAgentChannelMemberAccessAction: vi.fn(),
  permissionsSetAgentKnowledgeAssignmentsAction: vi.fn(),
  permissionsSetAgentSkillAssignmentsAction: vi.fn(),
  permissionsSyncExternalGoogleSheetPermissionsAction: vi.fn(),
  permissionsUnbindAgentRuntimeAction: vi.fn(),
  permissionsUpdateChannelDocumentAccessRoleAction: vi.fn(),
  permissionsUpdateWorkspaceMemberRoleAction: mockPermissionsUpdateWorkspaceMemberRoleAction,
}));

describe("SettingsPageClient", () => {
  function renderSettingsPage(
    props: Partial<ComponentProps<typeof SettingsPageClient>> = {},
  ) {
    return render(
      <LanguageProvider initialLanguage="zh">
        <SidebarVisibilityProvider>
          <SettingsPageClient feishuIntegrationCreationGuide={buildFeishuCreationGuide()} {...props} />
        </SidebarVisibilityProvider>
      </LanguageProvider>,
    );
  }

  beforeEach(() => {
    window.localStorage.clear();
    mockAddWorkspaceMemberAction.mockReset();
    mockCreateWorkspaceInvitationAction.mockReset();
    mockRemoveWorkspaceMemberAction.mockReset();
    mockReissueWorkspaceInvitationAction.mockReset();
    mockRotateWorkspaceJoinCodeAction.mockReset();
    mockRevokeOtherSessionsAction.mockReset();
    mockRevokeSessionAction.mockReset();
    mockRevokeWorkspaceInvitationAction.mockReset();
    mockTransferWorkspaceOwnershipAction.mockReset();
    mockUpdateCurrentUserProfileAction.mockReset();
    mockCheckFeishuIntegrationHealthAction.mockReset();
    mockCreateFeishuAgentBotBindingAction.mockReset();
    mockCreateFeishuChannelBindingAction.mockReset();
    mockCreateFeishuIntegrationAction.mockReset();
    mockCreateFeishuResourceBindingAction.mockReset();
    mockCreateFeishuUserBindingAction.mockReset();
    mockDeleteFeishuIntegrationAction.mockReset();
    mockDisableFeishuAgentBotBindingAction.mockReset();
    mockDisableFeishuIntegrationAction.mockReset();
    mockPauseFeishuChannelBindingAction.mockReset();
    mockPauseFeishuResourceBindingAction.mockReset();
    mockResumeFeishuIntegrationAction.mockReset();
    mockResumeFeishuChannelBindingAction.mockReset();
    mockResumeFeishuResourceBindingAction.mockReset();
    mockResumeFeishuUserBindingAction.mockReset();
    mockRevokeFeishuChannelBindingAction.mockReset();
    mockRevokeFeishuResourceBindingAction.mockReset();
    mockRevokeFeishuUserBindingAction.mockReset();
    mockRotateFeishuAgentBotCredentialsAction.mockReset();
    mockRotateFeishuIntegrationSecretAction.mockReset();
    mockTestFeishuIntegrationConnectionAction.mockReset();
    mockUpdateWorkspaceProfileAction.mockReset();
    mockUpdateWorkspaceMemberRoleAction.mockReset();
    mockPermissionsUpdateWorkspaceMemberRoleAction.mockReset();
  });

  it("switches the display language with a select field", async () => {
    const user = userEvent.setup();

    renderSettingsPage({ initialSection: "preferences" });

    const languageSelect = screen.getByRole("combobox", { name: "显示语言" });
    expect(languageSelect).toHaveValue("zh");

    await user.selectOptions(languageSelect, "en");

    expect(languageSelect).toHaveValue("en");
    expect(window.localStorage.getItem("agent-space-language")).toBe("en");
  });

  it("persists sidebar visibility toggles in local storage", async () => {
    const user = userEvent.setup();

    renderSettingsPage({ initialSection: "preferences" });

    expect(screen.getByRole("switch", { name: "应用市场" })).toBeChecked();

    const approvalsSwitch = screen.getByRole("switch", { name: "审批" });
    expect(approvalsSwitch).not.toBeChecked();

    await user.click(approvalsSwitch);

    expect(approvalsSwitch).toBeChecked();
    expect(JSON.parse(window.localStorage.getItem(SIDEBAR_VISIBILITY_STORAGE_KEY) ?? "{}")).toMatchObject({
      approvals: true,
    });
  });

  it("dispatches the onboarding replay event from preferences", async () => {
    const user = userEvent.setup();
    const replayListener = vi.fn();
    window.addEventListener(WORKSPACE_ONBOARDING_REPLAY_EVENT, replayListener);

    renderSettingsPage({ initialSection: "preferences" });

    expect(screen.getByText(/重新运行 Agent 搭建向导/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重看新手引导" }));

    expect(replayListener).toHaveBeenCalledTimes(1);
    window.removeEventListener(WORKSPACE_ONBOARDING_REPLAY_EVENT, replayListener);
  });

  it("renders sessions and disables revoking the current device", async () => {
    renderSettingsPage({
      currentSessionId: "session-current",
      initialSection: "security",
      sessions: [
        {
          id: "session-current",
          createdAt: "2026-04-22T00:00:00.000Z",
          expiresAt: "2026-05-22T00:00:00.000Z",
          lastSeenAt: "2026-04-22T00:00:00.000Z",
          ipAddress: "127.0.0.1",
          userAgent: "Current Browser",
        },
        {
          id: "session-other",
          createdAt: "2026-04-20T00:00:00.000Z",
          expiresAt: "2026-05-20T00:00:00.000Z",
          lastSeenAt: "2026-04-21T00:00:00.000Z",
          ipAddress: "10.0.0.2",
          userAgent: "Other Browser",
        },
      ],
    });

    expect(screen.getByText("Current Browser")).toBeInTheDocument();
    expect(screen.getByText("Other Browser")).toBeInTheDocument();

    const revokeButtons = screen.getAllByRole("button", { name: "撤销" });
    expect(revokeButtons[0]).toBeDisabled();
    expect(revokeButtons[1]).not.toBeDisabled();
  });

  it("revokes other devices from the settings page", async () => {
    const user = userEvent.setup();
    const onDataChanged = vi.fn();

    renderSettingsPage({
      currentSessionId: "session-current",
      initialSection: "security",
      onDataChanged,
      sessions: [
        {
          id: "session-current",
          createdAt: "2026-04-22T00:00:00.000Z",
          expiresAt: "2026-05-22T00:00:00.000Z",
          lastSeenAt: "2026-04-22T00:00:00.000Z",
        },
        {
          id: "session-other",
          createdAt: "2026-04-20T00:00:00.000Z",
          expiresAt: "2026-05-20T00:00:00.000Z",
          lastSeenAt: "2026-04-21T00:00:00.000Z",
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "退出其他设备" }));

    expect(mockRevokeOtherSessionsAction).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(onDataChanged).toHaveBeenCalledTimes(1);
    });
  });

  it("refreshes security data after revoking an individual session", async () => {
    const user = userEvent.setup();
    const onDataChanged = vi.fn();

    renderSettingsPage({
      currentSessionId: "session-current",
      initialSection: "security",
      onDataChanged,
      sessions: [
        {
          id: "session-current",
          createdAt: "2026-04-22T00:00:00.000Z",
          expiresAt: "2026-05-22T00:00:00.000Z",
          lastSeenAt: "2026-04-22T00:00:00.000Z",
        },
        {
          id: "session-other",
          createdAt: "2026-04-20T00:00:00.000Z",
          expiresAt: "2026-05-20T00:00:00.000Z",
          lastSeenAt: "2026-04-21T00:00:00.000Z",
        },
      ],
    });

    const revokeButtons = screen.getAllByRole("button", { name: "撤销" });
    await user.click(revokeButtons[1]!);

    expect(mockRevokeSessionAction).toHaveBeenCalledWith("session-other");
    await waitFor(() => {
      expect(onDataChanged).toHaveBeenCalledTimes(1);
    });
  });

  it("renders role-aware settings navigation for owners", () => {
    const { container } = renderSettingsPage({
      currentMembershipRole: "owner",
      currentWorkspaceName: "Mars Labs",
      initialSection: "account",
    });

    expect(screen.queryByRole("link", { name: /设置总览/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /账号资料/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /偏好设置/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /权限中心/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /成员与角色/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /邀请与访问/i }).length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".settings-nav__divider")).toHaveLength(1);
  });

  it("shows admin navigation without owner-only workspace basics", () => {
    renderSettingsPage({
      currentMembershipRole: "admin",
      currentWorkspaceName: "Mars Labs",
      initialSection: "account",
    });

    expect(screen.getAllByRole("link", { name: /账号资料/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /偏好设置/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /安全与会话/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /权限中心/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /成员与角色/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /邀请与访问/i }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("link", { name: /工作区基础/i })).toHaveLength(0);
  });

  it("updates the current user profile from the account section", async () => {
    const user = userEvent.setup();

    renderSettingsPage({
      currentMembershipRole: "owner",
      currentUserDisplayName: "Mina",
      currentUserId: "user-1",
      initialSection: "account",
      members: [
        {
          userId: "user-1",
          displayName: "Mina",
          primaryEmail: "mina@example.com",
          role: "owner",
        },
      ],
    });

    await user.clear(screen.getByRole("textbox", { name: "用户名" }));
    await user.type(screen.getByRole("textbox", { name: "用户名" }), "Mina Chen");
    await user.click(screen.getByRole("button", { name: "保存用户名" }));

    expect(mockUpdateCurrentUserProfileAction).toHaveBeenCalledWith({
      displayName: "Mina Chen",
    });
    expect(await screen.findByText("用户名已更新。")).toBeInTheDocument();
  });

  it("lets owners manage workspace, members, and access from focused sections", async () => {
    const user = userEvent.setup();
    const sharedProps: ComponentProps<typeof SettingsPageClient> = {
      currentMembershipRole: "owner",
      currentUserDisplayName: "Mina",
      currentUserId: "user-1",
      currentWorkspaceName: "Mars Labs",
      currentWorkspaceSlug: "mars-labs",
      invitations: [
        {
          id: "invite-1",
          email: "invitee@example.com",
          role: "member",
          status: "active",
          createdAt: "2026-04-22T00:00:00.000Z",
          expiresAt: "2026-04-29T00:00:00.000Z",
          acceptedAt: undefined,
        },
      ],
      members: [
        {
          userId: "user-1",
          displayName: "Mina",
          primaryEmail: "mina@example.com",
          role: "owner",
        },
        {
          userId: "user-2",
          displayName: "Alex",
          primaryEmail: "alex@example.com",
          role: "admin",
        },
      ],
    };

    const { rerender } = renderSettingsPage({
      ...sharedProps,
      initialSection: "workspace",
    });

    await user.clear(screen.getByLabelText("工作区名称"));
    await user.type(screen.getByLabelText("工作区名称"), "Mars Foundry");
    await user.click(screen.getByRole("button", { name: "保存工作区设置" }));

    expect(mockUpdateWorkspaceProfileAction).toHaveBeenCalledWith({
      name: "Mars Foundry",
    });

    rerender(
      <LanguageProvider>
        <SidebarVisibilityProvider>
          <SettingsPageClient {...sharedProps} initialSection="access" />
        </SidebarVisibilityProvider>
      </LanguageProvider>,
    );

    mockCreateWorkspaceInvitationAction.mockResolvedValue({
      id: "invite-2",
      email: "invitee@example.com",
      role: "member",
      expiresAt: "2026-04-29T00:00:00.000Z",
      invitePath: "/invite/wsi_test",
    });
    await user.type(screen.getByRole("textbox", { name: "邀请邮箱" }), "invitee@example.com");
    await user.click(screen.getByRole("button", { name: "创建邀请" }));

    expect(mockCreateWorkspaceInvitationAction).toHaveBeenCalledWith({
      email: "invitee@example.com",
      role: "member",
    });

    rerender(
      <LanguageProvider>
        <SidebarVisibilityProvider>
          <SettingsPageClient {...sharedProps} initialSection="members" />
        </SidebarVisibilityProvider>
      </LanguageProvider>,
    );

    await user.type(screen.getByRole("textbox", { name: "用户邮箱" }), "alex@example.com");
    await user.selectOptions(screen.getAllByRole("combobox", { name: "角色" })[0]!, "admin");
    await user.click(screen.getByRole("button", { name: "添加成员" }));

    expect(mockAddWorkspaceMemberAction).toHaveBeenCalledWith({
      email: "alex@example.com",
      role: "admin",
    });

    await user.click(screen.getByRole("button", { name: "转移所有权" }));
    expect(mockTransferWorkspaceOwnershipAction).toHaveBeenCalledWith("user-2");
  });

  it("lets admins manage members without owner-only ownership transfer", () => {
    renderSettingsPage({
      currentMembershipRole: "admin",
      currentUserDisplayName: "Mina",
      currentUserId: "user-1",
      initialSection: "members",
      members: [
        {
          userId: "user-1",
          displayName: "Mina",
          primaryEmail: "mina@example.com",
          role: "admin",
        },
        {
          userId: "user-2",
          displayName: "Alex",
          primaryEmail: "alex@example.com",
          role: "member",
        },
      ],
    });

    expect(screen.getByRole("button", { name: "添加成员" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除成员" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "转移所有权" })).toBeNull();
  });

  it("hides workspace management navigation for plain members", () => {
    renderSettingsPage({
      currentMembershipRole: "member",
      currentUserDisplayName: "Mina",
      currentUserId: "user-1",
      currentWorkspaceName: "Mars Labs",
      currentWorkspaceSlug: "mars-labs",
      initialSection: "account",
      members: [
        {
          userId: "user-1",
          displayName: "Mina",
          primaryEmail: "mina@example.com",
          role: "member",
        },
      ],
    });

    expect(screen.getAllByRole("link", { name: /账号资料/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /偏好设置/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("安全与会话").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /权限中心/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /外部集成/i }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("link", { name: /工作区基础/i })).toHaveLength(0);
    expect(screen.queryAllByRole("link", { name: /成员与角色/i })).toHaveLength(0);
    expect(screen.queryAllByRole("link", { name: /邀请与访问/i })).toHaveLength(0);
  });

  it("renders the unified permissions center without exposing token fields", () => {
    const { container } = renderSettingsPage({
      currentMembershipRole: "owner",
      currentUserDisplayName: "Mina",
      currentUserId: "user-1",
      currentWorkspaceName: "Mars Labs",
      currentWorkspaceSlug: "mars-labs",
      initialSection: "permissions",
      permissions: {
        tree: [
          {
            id: "workspace:workspace-mars",
            resourceType: "workspace",
            label: "Mars Labs",
            status: "active",
            source: "workspace_role",
            bindings: [
              {
                subjectType: "human",
                subjectId: "user-1",
                subjectLabel: "Mina <mina@example.com>",
                permission: "owner",
                source: "workspace_role",
                status: "active",
                editable: false,
              },
            ],
            children: [
              {
                id: "runtime:runtime-1",
                parentId: "workspace:workspace-mars",
                resourceType: "runtime",
                label: "Codex runtime",
                status: "active",
                source: "runtime_grant",
                metadata: { runtimeId: "runtime-1" },
                bindings: [],
              },
            ],
          },
        ],
        actors: [
          {
            subjectType: "human",
            subjectId: "user-1",
            subjectLabel: "Mina <mina@example.com>",
            status: "active",
            permissions: [
              {
                nodeId: "workspace:workspace-mars",
                resourceType: "workspace",
                resourceLabel: "Mars Labs",
                permission: "owner",
                source: "workspace_role",
                status: "active",
                editable: false,
              },
            ],
            diagnostics: [],
          },
        ],
        diagnostics: [],
        catalog: {
          members: [
            {
              userId: "user-1",
              displayName: "Mina",
              primaryEmail: "mina@example.com",
              role: "owner",
            },
          ],
          agents: [],
          skills: [],
          knowledgePages: [],
        },
      },
    });

    expect(screen.getByText("权限地图")).toBeInTheDocument();
    expect(screen.getAllByText("Mars Labs").length).toBeGreaterThan(0);
    expect(screen.getByText("Codex runtime")).toBeInTheDocument();
    expect(container.textContent).not.toContain("tokenHash");
    expect(container.textContent).not.toContain("accessTokenEncrypted");
    expect(container.textContent).not.toContain("refreshTokenEncrypted");
  });

  it("creates Feishu user, channel, and resource mappings from integrations settings", async () => {
    const user = userEvent.setup();
    const updatedIntegration = buildFeishuIntegration({
      userBindingCount: 1,
      channelBindingCount: 1,
      resourceBindingCount: 1,
      operationRunCount: 1,
      operationRuns: [
        {
          id: "run-1",
          integrationId: "feishu-1",
          operationType: "sheets.read_range",
          providerResourceType: "sheet",
          providerResourceReference: "sheet / resource cab203c1",
          providerResourceTokenRedacted: true,
          actorType: "agent",
          actorId: "Atlas",
          status: "succeeded",
          policyDecision: "allow",
          responseSummary: "Feishu response code 0.",
          resultPreview: {
            kind: "sheet_values",
            range: "Sheet1!A1:B2",
            rowCount: 2,
            rows: [["Name", "Score"], ["Atlas", 42]],
          },
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
        },
      ],
    });
    mockCreateFeishuUserBindingAction.mockResolvedValue(updatedIntegration);
    mockCreateFeishuChannelBindingAction.mockResolvedValue(updatedIntegration);
    mockCreateFeishuResourceBindingAction.mockResolvedValue(updatedIntegration);
    mockCheckFeishuIntegrationHealthAction.mockResolvedValue({
      ...updatedIntegration,
      lastHealthStatus: "healthy",
      lastHealthCheckedAt: "2026-06-24T00:00:00.000Z",
    });

    renderSettingsPage({
      currentMembershipRole: "admin",
      feishuAvailableChannels: [
        { name: "general", kind: "group" },
        { name: "ops", kind: "group" },
      ],
      feishuAvailableUsers: [
        { userId: "user-1", displayName: "Mina", primaryEmail: "mina@example.com", role: "admin" },
      ],
      feishuIntegrations: [buildFeishuIntegration()],
      initialSection: "integrations",
    });

    expect(screen.getByText("/api/integrations/feishu/events")).toBeInTheDocument();
    expect(screen.getByText("im.message.receive_v1")).toBeInTheDocument();
    expect(screen.getAllByText("docx:document").length).toBeGreaterThan(0);
    expect(screen.getAllByText("sheets:spreadsheet").length).toBeGreaterThan(0);
    expect(screen.getAllByText("bitable:app").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "检查连接" }));
    await waitFor(() => {
      expect(mockCheckFeishuIntegrationHealthAction).toHaveBeenCalledWith("feishu-1");
    });
    await screen.findByText("飞书连接检查通过。");

    await user.type(screen.getByRole("textbox", { name: "飞书 Open ID" }), "ou_mina");
    await user.type(screen.getByRole("textbox", { name: "飞书 Union ID" }), "on_mina");
    await user.type(screen.getByRole("textbox", { name: "飞书邮箱" }), "mina@example.com");
    await user.click(screen.getByRole("button", { name: "保存用户绑定" }));

    await waitFor(() => {
      expect(mockCreateFeishuUserBindingAction).toHaveBeenCalledWith({
        integrationId: "feishu-1",
        userId: "user-1",
        externalUserId: "ou_mina",
        externalUnionId: "on_mina",
        externalOpenId: "",
        externalEmail: "mina@example.com",
        displayName: "",
      });
    });

    const channelSelect = screen.getByRole("combobox", { name: "AgentSpace 频道" });
    await waitFor(() => {
      expect(channelSelect).toBeEnabled();
    });
    await user.selectOptions(channelSelect, "ops");
    await waitFor(() => {
      expect(channelSelect).toHaveValue("ops");
    });
    await user.type(screen.getByRole("textbox", { name: "飞书会话 ID" }), "oc_ops");
    await user.click(screen.getByRole("button", { name: "保存会话映射" }));

    await waitFor(() => {
      expect(mockCreateFeishuChannelBindingAction).toHaveBeenCalledWith({
        integrationId: "feishu-1",
        channelName: "ops",
        externalChatId: "oc_ops",
        externalChatType: "group",
        externalChatName: "",
      });
    });

    const resourceTypeSelect = screen.getByRole("combobox", { name: "飞书类型" });
    await waitFor(() => {
      expect(resourceTypeSelect).toBeEnabled();
    });
    const resourceScopeHint = screen.getByLabelText("飞书资源绑定权限");
    expect(within(resourceScopeHint).getByText("docx:document")).toBeInTheDocument();
    expect(within(resourceScopeHint).getByText("drive:drive")).toBeInTheDocument();
    expect(resourceScopeHint).toHaveTextContent("推荐类型");
    expect(resourceScopeHint).toHaveTextContent("频道文档");
    const agentSpaceTypeSelect = screen.getByRole("combobox", { name: "AgentSpace 类型" });
    expect(agentSpaceTypeSelect).toHaveValue("channel_document");
    await user.selectOptions(resourceTypeSelect, "base_table");
    await waitFor(() => {
      expect(resourceTypeSelect).toHaveValue("base_table");
      expect(agentSpaceTypeSelect).toHaveValue("data_table");
    });
    expect(within(resourceScopeHint).getByText("bitable:app")).toBeInTheDocument();
    expect(resourceScopeHint).toHaveTextContent("数据表");
    await user.selectOptions(resourceTypeSelect, "sheet");
    await waitFor(() => {
      expect(resourceTypeSelect).toHaveValue("sheet");
      expect(agentSpaceTypeSelect).toHaveValue("data_table");
    });
    expect(within(resourceScopeHint).getByText("sheets:spreadsheet")).toBeInTheDocument();
    expect(resourceScopeHint).toHaveTextContent("数据表");
    await user.type(screen.getByRole("textbox", { name: "飞书链接或 Token" }), "https://example.feishu.cn/sheets/shtcnTest123");
    await user.selectOptions(screen.getByRole("combobox", { name: "关联频道" }), "general");
    await user.type(screen.getByRole("textbox", { name: "显示名称" }), "Launch Sheet");
    await user.click(screen.getByRole("checkbox", { name: "允许审批后的写入" }));
    await user.click(screen.getByRole("button", { name: "保存资源映射" }));

    expect(mockCreateFeishuResourceBindingAction).toHaveBeenCalledWith({
      integrationId: "feishu-1",
      providerResourceType: "sheet",
      resourceUrlOrToken: "https://example.feishu.cn/sheets/shtcnTest123",
      agentSpaceResourceType: "data_table",
      agentSpaceResourceId: "",
      channelName: "general",
      displayName: "Launch Sheet",
      allowWrite: true,
    });
    expect(screen.getByText("sheets.read_range")).toBeInTheDocument();
    expect(screen.getByText(/策略: allow/)).toBeInTheDocument();
    expect(screen.getByText("Feishu response code 0.")).toBeInTheDocument();
    expect(screen.getByLabelText("结果预览")).toHaveTextContent("sheet_values");
    expect(screen.getByLabelText("结果预览")).toHaveTextContent("Sheet1!A1:B2");
  });

  it("creates an agent-scoped Feishu bot binding from integrations settings", async () => {
    const user = userEvent.setup();
    mockCreateFeishuAgentBotBindingAction.mockResolvedValue(buildFeishuIntegration({
      id: "agent-bot-codex",
      displayName: "Codex Feishu Bot",
      agentId: "Codex",
      transportMode: "websocket_worker",
      appId: "cli_codex_bot",
    }));

    renderSettingsPage({
      currentMembershipRole: "admin",
      feishuAvailableAgents: [
        { id: "Codex", name: "Codex", role: "Engineer" },
      ],
      feishuAvailableChannels: [],
      feishuAvailableUsers: [],
      feishuIntegrations: [],
      initialSection: "integrations",
    });

    await user.selectOptions(screen.getByRole("combobox", { name: "Agent" }), "Codex");
    await user.type(screen.getAllByLabelText("App ID")[0], "cli_codex_bot");
    await user.type(screen.getAllByLabelText("App Secret")[0], "secret_codex_bot");
    await user.click(screen.getByRole("button", { name: "绑定 Bot" }));

    await waitFor(() => {
      expect(mockCreateFeishuAgentBotBindingAction).toHaveBeenCalledWith({
        agentId: "Codex",
        displayName: "",
        transportMode: "websocket_worker",
        appId: "cli_codex_bot",
        appSecret: "secret_codex_bot",
        verificationToken: "",
        encryptKey: "",
        tenantKey: "",
      });
    });
    expect(await screen.findByText("Agent 飞书 Bot 已绑定。")).toBeInTheDocument();
  });

  it("renders Feishu smoke readiness checks in the integration guide", () => {
    renderSettingsPage({
      currentMembershipRole: "admin",
      feishuAvailableChannels: [],
      feishuAvailableUsers: [],
      feishuIntegrations: [
        buildFeishuIntegration({
          setupGuide: buildFeishuSetupGuide(),
        }),
      ],
      initialSection: "integrations",
    });

    const readiness = screen.getByLabelText("飞书联调状态");
    expect(within(readiness).getByText("凭据完整")).toBeInTheDocument();
    expect(within(readiness).getAllByText("就绪").length).toBeGreaterThan(0);
    expect(within(readiness).getByText("Doc 绑定")).toBeInTheDocument();
    expect(within(readiness).getAllByText("缺失").length).toBeGreaterThan(0);
    expect(within(readiness).getByText("出站队列")).toBeInTheDocument();
    const evidenceGates = screen.getByLabelText("飞书证据门禁");
    expect(within(evidenceGates).getByText("Bot 回复证据")).toBeInTheDocument();
    expect(within(evidenceGates).getByText("数据面证据")).toBeInTheDocument();
    expect(within(evidenceGates).getByText("失败可见证据")).toBeInTheDocument();
    expect(within(evidenceGates).getByText("OpenAPI 证据")).toBeInTheDocument();
    expect(within(evidenceGates).getByText("processed_inbound + correlated_reply_mapping")).toBeInTheDocument();
    expect(within(evidenceGates).getByText(
      "doc_read + agent_runtime_doc_read_from_lark_cli_manifest + approved_doc_write + sheet_read + approved_sheet_write_with_agentspace_sync + base_read + approved_base_mutation_with_agentspace_sync",
    )).toBeInTheDocument();
    const checklist = screen.getByLabelText("飞书联调清单");
    expect(within(checklist).getByText("回调路径")).toBeInTheDocument();
    expect(within(checklist).getByText("/api/integrations/feishu/events")).toBeInTheDocument();
    expect(within(checklist).getByText("创建自建应用")).toBeInTheDocument();
    expect(within(checklist).getAllByText("https://open.feishu.cn/app").length).toBeGreaterThan(0);
    expect(screen.getByText("检查联调环境")).toBeInTheDocument();
    expect(screen.getByText("npm run smoke:feishu -- --env-file scripts/feishu/.env --check-env --json")).toBeInTheDocument();
    expect(screen.getByText("严格实测")).toBeInTheDocument();
    expect(screen.getByText(
      "npm run smoke:feishu -- --env-file scripts/feishu/.env --live --strict-live --evidence runtime-output/feishu-smoke/live.json --json",
    )).toBeInTheDocument();
    expect(screen.getByText("校验 OpenAPI 证据")).toBeInTheDocument();
    expect(screen.getByText(
      "npm run smoke:feishu -- --verify-evidence runtime-output/feishu-smoke/live.json --json",
    )).toBeInTheDocument();
  });

  it("tests Feishu integration credentials before saving", async () => {
    const user = userEvent.setup();
    mockTestFeishuIntegrationConnectionAction.mockResolvedValue({
      status: "healthy",
      checkedAt: "2026-06-24T00:00:00.000Z",
      botOpenId: "ou_bot",
      botAppName: "AgentSpace Bot",
      scopeReadiness: "manual_review_required",
      requiredScopes: ["im:message", "docx:document"],
    });

    renderSettingsPage({
      currentMembershipRole: "admin",
      feishuAvailableChannels: [],
      feishuAvailableUsers: [],
      feishuIntegrationCreationGuide: {
        requiredCredentialFields: ["app_id", "app_secret", "verification_token", "encrypt_key", "tenant_key"],
        requiredEvents: ["im.message.receive_v1", "card.action.trigger", "custom.integration.event"],
        requiredScopes: ["im:message", "docx:document", "custom.integration.scope"],
        eventCallbackPath: "/api/integrations/feishu/events",
        publicAppUrlStatus: "configured",
        publicAppUrl: "https://agent.test",
        callbackUrlTemplate: "https://agent.test/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=created-integration-id",
        developerConsoleUrl: "https://open.feishu.cn/app",
        openPlatformSetupSteps: buildFeishuOpenPlatformSetupSteps(),
      },
      feishuIntegrations: [],
      initialSection: "integrations",
    });

    const createPanel = screen.getByLabelText("创建工作区级飞书集成");
    await user.type(within(createPanel).getByLabelText("App ID"), "cli_test");
    await user.type(within(createPanel).getByLabelText("App Secret"), "secret_test");
    await user.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() => {
      expect(mockTestFeishuIntegrationConnectionAction).toHaveBeenCalledWith({
        appId: "cli_test",
        appSecret: "secret_test",
      });
    });
    const summary = await screen.findByLabelText("飞书连接测试摘要");
    expect(summary).toHaveTextContent("连接测试");
    expect(summary).toHaveTextContent("正常");
    expect(summary).toHaveTextContent("Bot: AgentSpace Bot (ou_bot)");
    expect(summary).toHaveTextContent("请在飞书开放平台确认已启用以下权限。");
    expect(within(summary).getByText("im:message")).toBeInTheDocument();
    expect(within(summary).getByText("docx:document")).toBeInTheDocument();
    expect(screen.getByText("飞书连接测试通过，请确认权限清单后保存。")).toBeInTheDocument();
  });

  it("creates a Feishu integration from the settings wizard without echoing secrets", async () => {
    const user = userEvent.setup();
    const createdSetupGuide = buildFeishuSetupGuide();
    createdSetupGuide.commands = {
      ...createdSetupGuide.commands,
      healthCheck: "agent-space integrations feishu health-check --workspace-id workspace-1 --integration feishu-created --strict --json",
      botReadiness: "agent-space integrations feishu readiness --workspace-id workspace-1 --integration feishu-created --strict --require bot --json",
      dataPlaneReadiness: "agent-space integrations feishu readiness --workspace-id workspace-1 --integration feishu-created --strict --require data-plane --json",
      workerReadiness: "agent-space integrations feishu readiness --workspace-id workspace-1 --integration feishu-created --strict --require worker --json",
      smokeEnv: "agent-space integrations feishu smoke-env --workspace-id workspace-1 --integration feishu-created --app-url https://agent.test > scripts/feishu/.env",
      strictLiveSmoke: "npm run smoke:feishu -- --env-file scripts/feishu/.env --live --strict-live --evidence runtime-output/feishu-smoke/live.json --json",
      verifyOpenApiEvidence: "npm run smoke:feishu -- --verify-evidence runtime-output/feishu-smoke/live.json --json",
      smokePlan: "agent-space integrations feishu smoke-plan --workspace-id workspace-1 --integration feishu-created --app-url https://agent.test --json",
      evidence: "agent-space integrations feishu evidence --workspace-id workspace-1 --integration feishu-created --openapi-evidence runtime-output/feishu-smoke/live.json --strict --require all --json",
    };
    mockCreateFeishuIntegrationAction.mockResolvedValue(buildFeishuIntegration({
      id: "feishu-created",
      displayName: "Launch Feishu",
      appId: "cli_launch",
      tenantKey: "tenant_launch",
      hasEncryptKey: true,
      setupGuide: createdSetupGuide,
    }));

    renderSettingsPage({
      currentMembershipRole: "admin",
      feishuAvailableChannels: [],
      feishuAvailableUsers: [],
      feishuIntegrationCreationGuide: {
        requiredCredentialFields: ["app_id", "app_secret", "verification_token", "encrypt_key", "tenant_key"],
        requiredEvents: ["im.message.receive_v1", "card.action.trigger", "custom.integration.event"],
        requiredScopes: ["im:message", "docx:document", "custom.integration.scope"],
        eventCallbackPath: "/api/integrations/feishu/events",
        publicAppUrlStatus: "configured",
        publicAppUrl: "https://agent.test",
        callbackUrlTemplate: "https://agent.test/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=created-integration-id",
        developerConsoleUrl: "https://open.feishu.cn/app",
        openPlatformSetupSteps: buildFeishuOpenPlatformSetupSteps(),
      },
      feishuIntegrations: [],
      initialSection: "integrations",
    });

    const setupSummary = screen.getByLabelText("飞书开放平台配置");
    expect(within(setupSummary).getByText("app_id")).toBeInTheDocument();
    expect(within(setupSummary).getByText("app_secret")).toBeInTheDocument();
    expect(within(setupSummary).getByText("verification_token")).toBeInTheDocument();
    expect(within(setupSummary).getByText("encrypt_key")).toBeInTheDocument();
    expect(within(setupSummary).getByText("tenant_key")).toBeInTheDocument();
    expect(within(setupSummary).getByText("创建自建应用")).toBeInTheDocument();
    expect(within(setupSummary).getAllByText("https://open.feishu.cn/app").length).toBeGreaterThan(0);
    expect(within(setupSummary).getByText("Public URL 已配置")).toBeInTheDocument();
    expect(within(setupSummary).getByText("https://agent.test")).toBeInTheDocument();
    expect(within(setupSummary).getByText("https://agent.test/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=created-integration-id")).toBeInTheDocument();
    expect(within(setupSummary).getByText("im.message.receive_v1")).toBeInTheDocument();
    expect(within(setupSummary).getByText("custom.integration.event")).toBeInTheDocument();
    expect(within(setupSummary).getByText("custom.integration.scope")).toBeInTheDocument();

    const createPanel = screen.getByLabelText("创建工作区级飞书集成");
    await user.clear(within(createPanel).getByLabelText("名称"));
    await user.type(within(createPanel).getByLabelText("名称"), "Launch Feishu");
    await user.type(within(createPanel).getByLabelText("App ID"), "cli_launch");
    await user.click(within(createPanel).getByText("自定义高级功能"));
    await user.type(within(createPanel).getByLabelText("Tenant Key"), "tenant_launch");
    await user.type(within(createPanel).getByLabelText("App Secret"), "secret_launch");
    await user.type(within(createPanel).getByLabelText("Verification Token"), "verify_launch");
    await user.type(within(createPanel).getByLabelText("Encrypt Key"), "encrypt_launch");
    await user.click(screen.getByRole("button", { name: "创建集成" }));

    await waitFor(() => {
      expect(mockCreateFeishuIntegrationAction).toHaveBeenCalledWith({
        displayName: "Launch Feishu",
        transportMode: "websocket_worker",
        appId: "cli_launch",
        appSecret: "secret_launch",
        verificationToken: "verify_launch",
        encryptKey: "encrypt_launch",
        tenantKey: "tenant_launch",
      });
    });
    expect(await screen.findByText(
      "飞书集成已创建。请在下方集成卡片继续执行健康检查、生成联调环境、检查联调环境、严格实测、OpenAPI 证据校验和最终证据命令。",
    )).toBeInTheDocument();
    expect(within(createPanel).getByLabelText("App Secret")).toHaveValue("");
    expect(within(createPanel).getByLabelText("Verification Token")).toHaveValue("");
    expect(within(createPanel).getByLabelText("Encrypt Key")).toHaveValue("");
    expect(screen.getAllByText("Launch Feishu").length).toBeGreaterThan(0);
    expect(screen.getByText("cli_launch")).toBeInTheDocument();
    const checklist = screen.getByLabelText("飞书联调清单");
    expect(within(checklist).getByText(
      "agent-space integrations feishu smoke-env --workspace-id workspace-1 --integration feishu-created --app-url https://agent.test > scripts/feishu/.env",
    )).toBeInTheDocument();
    expect(within(checklist).getByText(
      "npm run smoke:feishu -- --env-file scripts/feishu/.env --check-env --json",
    )).toBeInTheDocument();
    expect(within(checklist).getByText(
      "npm run smoke:feishu -- --env-file scripts/feishu/.env --live --strict-live --evidence runtime-output/feishu-smoke/live.json --json",
    )).toBeInTheDocument();
    expect(within(checklist).getByText(
      "npm run smoke:feishu -- --verify-evidence runtime-output/feishu-smoke/live.json --json",
    )).toBeInTheDocument();
    expect(within(checklist).getByText(
      "agent-space integrations feishu evidence --workspace-id workspace-1 --integration feishu-created --openapi-evidence runtime-output/feishu-smoke/live.json --strict --require all --json",
    )).toBeInTheDocument();
  });

  it("shows Feishu credential encryption setup errors from the create wizard", async () => {
    const user = userEvent.setup();
    mockCreateFeishuIntegrationAction.mockRejectedValue(
      new Error("feishu.integration.credential_encryption_key_missing"),
    );

    renderSettingsPage({
      currentMembershipRole: "admin",
      feishuIntegrations: [],
      initialSection: "integrations",
    });

    const createPanel = screen.getByLabelText("创建工作区级飞书集成");
    await user.type(within(createPanel).getByLabelText("App ID"), "cli_launch");
    await user.type(within(createPanel).getByLabelText("App Secret"), "secret_launch");
    await user.type(within(createPanel).getByLabelText("Verification Token"), "verify_launch");
    await user.click(screen.getByRole("button", { name: "创建集成" }));

    expect(await screen.findByText(
      "AgentSpace 未配置飞书凭据加密密钥。请设置 AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY。",
    )).toBeInTheDocument();
    expect(mockCreateFeishuIntegrationAction).toHaveBeenCalledWith(expect.objectContaining({
      appId: "cli_launch",
      appSecret: "secret_launch",
      verificationToken: "verify_launch",
    }));
  });

  it("lets members bind only their own Feishu identity from integrations settings", async () => {
    const user = userEvent.setup();
    mockCreateFeishuUserBindingAction.mockResolvedValue(buildFeishuIntegration({
      userBindingCount: 1,
      userBindings: [
        {
          id: "user-binding-1",
          integrationId: "feishu-1",
          userId: "user-1",
          externalUserReference: "user 7cefd02d",
          externalUserIdRedacted: true,
          status: "active",
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
        },
      ],
    }));
    mockRevokeFeishuUserBindingAction.mockResolvedValue(buildFeishuIntegration({
      userBindingCount: 0,
      userBindings: [
        {
          id: "user-binding-1",
          integrationId: "feishu-1",
          userId: "user-1",
          externalUserReference: "user 7cefd02d",
          externalUserIdRedacted: true,
          status: "archived",
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
        },
      ],
    }));

    renderSettingsPage({
      currentMembershipRole: "member",
      currentUserDisplayName: "Mina",
      currentUserId: "user-1",
      feishuAvailableUsers: [
        { userId: "user-1", displayName: "Mina", primaryEmail: "mina@example.com", role: "member" },
      ],
      feishuIntegrations: [buildFeishuIntegration()],
      initialSection: "integrations",
    });

    expect(screen.getByText("我的飞书绑定")).toBeInTheDocument();
    expect(screen.queryByText("创建飞书集成")).toBeNull();
    expect(screen.queryByRole("button", { name: "检查连接" })).toBeNull();
    expect(screen.queryByText("飞书会话映射")).toBeNull();
    expect(screen.queryByText("飞书资源映射")).toBeNull();
    expect(screen.queryByText("飞书数据操作记录")).toBeNull();
    expect(screen.getByRole("textbox", { name: "AgentSpace 用户" })).toHaveValue("Mina (mina@example.com)");

    await user.type(screen.getByRole("textbox", { name: "飞书 Open ID" }), "ou_mina");
    await user.click(screen.getByRole("button", { name: "保存用户绑定" }));

    await waitFor(() => {
      expect(mockCreateFeishuUserBindingAction).toHaveBeenCalledWith({
        integrationId: "feishu-1",
        userId: "user-1",
        externalUserId: "ou_mina",
        externalUnionId: "",
        externalOpenId: "",
        externalEmail: "",
        displayName: "",
      });
    });

    const bindingCard = await screen.findByText(/user 7cefd02d/);
    await user.click(within(bindingCard.closest("article")!).getByRole("button", { name: "撤销" }));

    await waitFor(() => {
      expect(mockRevokeFeishuUserBindingAction).toHaveBeenCalledWith({ bindingId: "user-binding-1" });
    });
  });

  it("shows Feishu user binding coverage to admins", () => {
    renderSettingsPage({
      currentMembershipRole: "admin",
      feishuAvailableUsers: [
        { userId: "user-1", displayName: "Mina", primaryEmail: "mina@example.com", role: "admin" },
        { userId: "user-2", displayName: "Alex", primaryEmail: "alex@example.com", role: "member" },
        { userId: "user-3", displayName: "Noor", primaryEmail: "noor@example.com", role: "member" },
      ],
      feishuIntegrations: [buildFeishuIntegration({
        userBindingCount: 1,
        userBindings: [
          {
            id: "user-binding-1",
            integrationId: "feishu-1",
            userId: "user-1",
            externalUserReference: "user 7cefd02d",
            externalUserIdRedacted: true,
            status: "active",
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
          },
          {
            id: "user-binding-2",
            integrationId: "feishu-1",
            userId: "user-3",
            externalUserReference: "user e18fff90",
            externalUserIdRedacted: true,
            status: "archived",
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
          },
        ],
      })],
      initialSection: "integrations",
    });

    const coverage = screen.getByLabelText("飞书用户绑定覆盖率");
    expect(coverage).toHaveTextContent("绑定覆盖率");
    expect(coverage).toHaveTextContent("1 / 3");
    expect(coverage).toHaveTextContent("未绑定：Alex, Noor");
  });

  it("resumes disabled Feishu integrations and rotates stored credentials", async () => {
    const user = userEvent.setup();
    const disabledIntegration = buildFeishuIntegration({
      displayName: "Disabled Feishu",
      status: "disabled",
      appId: "cli_old",
      tenantKey: "tenant_old",
    });
    mockResumeFeishuIntegrationAction.mockResolvedValue({
      ...disabledIntegration,
      status: "active",
    });
    mockRotateFeishuIntegrationSecretAction.mockResolvedValue({
      ...disabledIntegration,
      appId: "cli_new",
      tenantKey: "tenant_new",
      lastHealthStatus: "unknown",
      hasEncryptKey: true,
    });

    renderSettingsPage({
      currentMembershipRole: "admin",
      feishuAvailableChannels: [],
      feishuAvailableUsers: [],
      feishuIntegrations: [disabledIntegration],
      initialSection: "integrations",
    });

    const integrationCard = screen.getByText("Disabled Feishu").closest("article");
    expect(integrationCard).toBeTruthy();
    const card = within(integrationCard!);

    await user.click(card.getByRole("button", { name: "启用" }));
    await waitFor(() => {
      expect(mockResumeFeishuIntegrationAction).toHaveBeenCalledWith("feishu-1");
    });
    await waitFor(() => {
      expect(card.getByRole("textbox", { name: "App ID" })).toBeEnabled();
    });

    await user.clear(card.getByRole("textbox", { name: "App ID" }));
    await user.type(card.getByRole("textbox", { name: "App ID" }), "cli_new");
    await user.clear(card.getByRole("textbox", { name: "Tenant Key" }));
    await user.type(card.getByRole("textbox", { name: "Tenant Key" }), "tenant_new");
    await user.type(card.getByLabelText("新 App Secret"), "secret_new");
    await user.type(card.getByLabelText("新 Verification Token"), "verify_new");
    await user.type(card.getByLabelText("新 Encrypt Key"), "encrypt_new");
    await user.click(card.getByRole("button", { name: "保存新凭据" }));

    await waitFor(() => {
      expect(mockRotateFeishuIntegrationSecretAction).toHaveBeenCalledWith({
        integrationId: "feishu-1",
        appId: "cli_new",
        appSecret: "secret_new",
        verificationToken: "verify_new",
        encryptKey: "encrypt_new",
        tenantKey: "tenant_new",
      });
    });
  });

  it("shows recent Feishu outbound failures in the integrations section", () => {
    renderSettingsPage({
      currentMembershipRole: "admin",
      feishuAvailableChannels: [],
      feishuAvailableUsers: [],
      feishuIntegrations: [
        buildFeishuIntegration({
          outboxFailureCount: 1,
          recentOutboxFailures: [
            {
              id: "outbox-1",
              integrationId: "feishu-1",
              targetExternalChatReference: "chat b2295ba0",
              targetExternalChatIdRedacted: true,
              status: "pending",
              attempts: 2,
              nextAttemptAt: "2026-06-24T00:01:00.000Z",
              lastError: "feishu.outbound.network_unreachable: fetch failed ECONNRESET",
              createdAt: "2026-06-24T00:00:00.000Z",
              updatedAt: "2026-06-24T00:00:30.000Z",
            },
          ],
        }),
      ],
      initialSection: "integrations",
    });

    expect(screen.getByText("出站失败")).toBeInTheDocument();
    expect(screen.getByText("最近出站失败")).toBeInTheDocument();
    expect(screen.getByText("待重试")).toBeInTheDocument();
    expect(screen.getByText(/尝试: 2/)).toBeInTheDocument();
    expect(screen.getByText(/下次重试: 2026-06-24T00:01:00.000Z/)).toBeInTheDocument();
    expect(screen.getByText(/飞书会话: chat b2295ba0/)).toBeInTheDocument();
    expect(screen.getByText("feishu.outbound.network_unreachable: fetch failed ECONNRESET")).toBeInTheDocument();
    expect(screen.queryByText(/oc_general/)).not.toBeInTheDocument();
  });

  it("shows recent Feishu inbound events and unbound reasons in the integrations section", () => {
    renderSettingsPage({
      currentMembershipRole: "admin",
      feishuAvailableChannels: [],
      feishuAvailableUsers: [],
      feishuIntegrations: [
        buildFeishuIntegration({
          recentInboundEvents: [
            {
              id: "event-1",
              integrationId: "feishu-1",
              externalEventId: "evt-user-unbound",
              eventType: "im.message.receive_v1",
              status: "ignored",
              errorMessage: "external_user_unbound",
              bindingSuggestion: {
                kind: "user",
                externalUserId: "ou_unbound",
                externalUnionId: "on_unbound",
                externalOpenId: "feishu_user_unbound",
              },
              receivedAt: "2026-06-24T00:02:00.000Z",
              processedAt: "2026-06-24T00:02:01.000Z",
            },
            {
              id: "event-2",
              integrationId: "feishu-1",
              externalEventId: "evt-channel-unbound",
              eventType: "im.message.receive_v1",
              status: "ignored",
              errorMessage: "external_channel_unbound",
              bindingSuggestion: {
                kind: "channel",
                externalChatId: "oc_unbound",
              },
              receivedAt: "2026-06-24T00:01:00.000Z",
              processedAt: "2026-06-24T00:01:01.000Z",
            },
          ],
        }),
      ],
      initialSection: "integrations",
    });

    expect(screen.getByText("最近入站事件")).toBeInTheDocument();
    expect(screen.getByText("未绑定用户: 1")).toBeInTheDocument();
    expect(screen.getByText("未绑定群: 1")).toBeInTheDocument();
    expect(screen.getAllByText("已忽略")).toHaveLength(2);
    expect(screen.getByText("evt-user-unbound")).toBeInTheDocument();
    expect(screen.getByText("原因: external_user_unbound")).toBeInTheDocument();
    expect(screen.getByText("原因: external_channel_unbound")).toBeInTheDocument();
    expect(screen.getByText("建议绑定用户")).toBeInTheDocument();
    expect(screen.getByText("ou_unbound")).toBeInTheDocument();
    expect(screen.getByText("on_unbound")).toBeInTheDocument();
    expect(screen.getByText("feishu_user_unbound")).toBeInTheDocument();
    expect(screen.getByText("建议绑定群")).toBeInTheDocument();
    expect(screen.getByText("oc_unbound")).toBeInTheDocument();
  });

  it("surfaces Feishu data operation scope and resource failures to admins", () => {
    renderSettingsPage({
      currentMembershipRole: "admin",
      feishuAvailableChannels: [],
      feishuAvailableUsers: [],
      feishuIntegrations: [
        buildFeishuIntegration({
          operationRunCount: 2,
          operationRuns: [
            {
              id: "run-succeeded",
              integrationId: "feishu-1",
              operationType: "docs.read_document",
              providerResourceType: "doc",
              providerResourceReference: "doc / resource cf3ca15d",
              providerResourceTokenRedacted: true,
              actorType: "agent",
              actorId: "Atlas",
              status: "succeeded",
              policyDecision: "allow",
              responseSummary: "Feishu response code 0.",
              createdAt: "2026-06-24T00:00:00.000Z",
              updatedAt: "2026-06-24T00:00:00.000Z",
            },
            {
              id: "run-failed",
              integrationId: "feishu-1",
              operationType: "sheets.read_range",
              providerResourceType: "sheet",
              providerResourceReference: "sheet / resource 23f2e033",
              providerResourceTokenRedacted: true,
              actorType: "agent",
              actorId: "Atlas",
              status: "failed",
              policyDecision: "deny",
              errorCode: "feishu.data_operation_scope_missing",
              errorMessage: "Feishu integration is missing required scope \"sheets:spreadsheet\" for this data operation.",
              createdAt: "2026-06-24T00:02:00.000Z",
              updatedAt: "2026-06-24T00:02:30.000Z",
            },
          ],
        }),
      ],
      initialSection: "integrations",
    });

    const diagnostics = screen.getByLabelText("飞书数据操作失败诊断");
    expect(diagnostics).toHaveTextContent("最近数据操作失败");
    expect(diagnostics).toHaveTextContent("缺少飞书 API scope");
    expect(diagnostics).toHaveTextContent("Feishu · sheets.read_range · sheet / resource 23f2e033");
    expect(within(diagnostics).getByText("feishu.data_operation_scope_missing")).toBeInTheDocument();
    expect(within(diagnostics).getByText("Feishu integration is missing required scope \"sheets:spreadsheet\" for this data operation.")).toBeInTheDocument();
    expect(screen.getByText("错误码: feishu.data_operation_scope_missing")).toBeInTheDocument();
    expect(screen.getByText("资源: sheet / resource 23f2e033")).toBeInTheDocument();
    expect(screen.queryByText(/shtcnScopeMissing/)).not.toBeInTheDocument();
  });

  it("summarizes Feishu resource binding health for admins", () => {
    renderSettingsPage({
      currentMembershipRole: "admin",
      feishuAvailableChannels: [],
      feishuAvailableUsers: [],
      feishuIntegrations: [
        buildFeishuIntegration({
          resourceBindingCount: 3,
          resourceBindings: [
            {
              id: "resource-binding-active",
              integrationId: "feishu-1",
              providerResourceType: "doc",
              providerResourceReference: "doc / resource f8ccdd86",
              providerResourceTokenRedacted: true,
              agentSpaceResourceType: "channel_document",
              agentSpaceResourceId: "doc-1",
              displayName: "Active Doc",
              canWrite: false,
              guestReadable: true,
              status: "active",
              createdAt: "2026-06-24T00:00:00.000Z",
              updatedAt: "2026-06-24T00:00:00.000Z",
            },
            {
              id: "resource-binding-paused",
              integrationId: "feishu-1",
              providerResourceType: "sheet",
              providerResourceReference: "sheet / resource 960ee2a5",
              providerResourceTokenRedacted: true,
              agentSpaceResourceType: "data_table",
              agentSpaceResourceId: "table-1",
              displayName: "Paused Sheet",
              canWrite: true,
              guestReadable: false,
              status: "disabled",
              createdAt: "2026-06-24T00:01:00.000Z",
              updatedAt: "2026-06-24T00:03:00.000Z",
            },
            {
              id: "resource-binding-archived",
              integrationId: "feishu-1",
              providerResourceType: "base",
              providerResourceReference: "base / resource daf16a16",
              providerResourceTokenRedacted: true,
              agentSpaceResourceType: "data_table",
              agentSpaceResourceId: "table-2",
              displayName: "Archived Base",
              canWrite: false,
              guestReadable: false,
              status: "archived",
              createdAt: "2026-06-24T00:02:00.000Z",
              updatedAt: "2026-06-24T00:02:30.000Z",
            },
          ],
        }),
      ],
      initialSection: "integrations",
    });

    const health = screen.getByLabelText("飞书资源绑定健康");
    expect(health).toHaveTextContent("资源绑定健康");
    expect(health).toHaveTextContent("启用: 1");
    expect(health).toHaveTextContent("暂停: 1");
    expect(health).toHaveTextContent("归档: 1");
    expect(health).toHaveTextContent("最近异常: Paused Sheet · 暂停");
    expect(screen.getByText("飞书: doc / resource f8ccdd86")).toBeInTheDocument();
    expect(screen.getByText("飞书: sheet / resource 960ee2a5")).toBeInTheDocument();
    expect(screen.getByText("飞书: base / resource daf16a16")).toBeInTheDocument();
    expect(screen.queryByText(/doccnActive|shtcnPaused|baseArchived/)).not.toBeInTheDocument();
    expect(screen.getByText("写入: 需审批")).toBeInTheDocument();
    expect(screen.getAllByText("写入: 未授权")).toHaveLength(2);
    expect(screen.getByText("状态: 暂停")).toBeInTheDocument();
  });

  it("manages Feishu integration and binding lifecycle actions", async () => {
    const user = userEvent.setup();
    const integration = buildFeishuIntegration({
      userBindingCount: 1,
      channelBindingCount: 1,
      resourceBindingCount: 1,
      userBindings: [
        {
          id: "user-binding-1",
          integrationId: "feishu-1",
          userId: "user-1",
          externalUserReference: "user 7cefd02d",
          externalUserIdRedacted: true,
          status: "active",
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
        },
      ],
      channelBindings: [
        {
          id: "channel-binding-1",
          integrationId: "feishu-1",
          channelName: "general",
          externalChatReference: "chat b2295ba0",
          externalChatIdRedacted: true,
          status: "active",
          syncMode: "mirror",
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
        },
      ],
      resourceBindings: [
        {
          id: "resource-binding-1",
          integrationId: "feishu-1",
          providerResourceType: "sheet",
          providerResourceReference: "sheet / resource cab203c1",
          providerResourceTokenRedacted: true,
          agentSpaceResourceType: "data_table",
          agentSpaceResourceId: "table-1",
          displayName: "Launch Sheet",
          canWrite: true,
          guestReadable: false,
          status: "active",
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
        },
      ],
    });
    mockPauseFeishuChannelBindingAction.mockResolvedValue(integration);
    mockRevokeFeishuChannelBindingAction.mockResolvedValue(integration);
    mockRevokeFeishuUserBindingAction.mockResolvedValue(integration);
    mockPauseFeishuResourceBindingAction.mockResolvedValue(integration);
    mockRevokeFeishuResourceBindingAction.mockResolvedValue(integration);
    mockDisableFeishuIntegrationAction.mockResolvedValue(integration);
    mockDeleteFeishuIntegrationAction.mockResolvedValue({ integrationId: "feishu-1" });

    renderSettingsPage({
      currentMembershipRole: "admin",
      feishuAvailableChannels: [{ name: "general", kind: "group" }],
      feishuAvailableUsers: [
        { userId: "user-1", displayName: "Mina", primaryEmail: "mina@example.com", role: "admin" },
      ],
      feishuIntegrations: [integration],
      initialSection: "integrations",
    });

    const channelCard = screen.getByText("general").closest("article");
    expect(channelCard).toBeTruthy();
    await user.click(within(channelCard!).getByRole("button", { name: "暂停" }));
    await waitFor(() => {
      expect(mockPauseFeishuChannelBindingAction).toHaveBeenCalledWith({ bindingId: "channel-binding-1" });
    });
    await user.click(within(channelCard!).getByRole("button", { name: "撤销" }));
    expect(mockRevokeFeishuChannelBindingAction).toHaveBeenCalledWith({ bindingId: "channel-binding-1" });

    const userCard = screen.getByText("Mina").closest("article");
    expect(userCard).toBeTruthy();
    await user.click(within(userCard!).getByRole("button", { name: "撤销" }));
    expect(mockRevokeFeishuUserBindingAction).toHaveBeenCalledWith({ bindingId: "user-binding-1" });

    const resourceCard = screen.getByText("Launch Sheet").closest("article");
    expect(resourceCard).toBeTruthy();
    await user.click(within(resourceCard!).getByRole("button", { name: "暂停" }));
    await waitFor(() => {
      expect(mockPauseFeishuResourceBindingAction).toHaveBeenCalledWith({ bindingId: "resource-binding-1" });
    });
    await user.click(within(resourceCard!).getByRole("button", { name: "撤销" }));
    await waitFor(() => {
      expect(mockRevokeFeishuResourceBindingAction).toHaveBeenCalledWith({ bindingId: "resource-binding-1" });
    });

    const integrationCard = screen.getByText("cli_a").closest("article");
    expect(integrationCard).toBeTruthy();
    await user.click(within(integrationCard!).getByRole("button", { name: "停用" }));
    await waitFor(() => {
      expect(mockDisableFeishuIntegrationAction).toHaveBeenCalledWith("feishu-1");
    });
    await user.click(within(integrationCard!).getByRole("button", { name: "删除" }));
    await waitFor(() => {
      expect(mockDeleteFeishuIntegrationAction).toHaveBeenCalledWith("feishu-1");
    });
  });
});

function buildFeishuIntegration(
  overrides: Partial<NonNullable<ComponentProps<typeof SettingsPageClient>["feishuIntegrations"]>[number]> = {},
): NonNullable<ComponentProps<typeof SettingsPageClient>["feishuIntegrations"]>[number] {
  return {
    id: "feishu-1",
    displayName: "Feishu",
    status: "active",
    transportMode: "http_webhook",
    appId: "cli_a",
    callbackUrl: "https://agent.test/api/integrations/feishu/events",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    hasAppSecret: true,
    hasVerificationToken: true,
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
    ...overrides,
  };
}

function buildFeishuSetupGuide(): NonNullable<
  NonNullable<ComponentProps<typeof SettingsPageClient>["feishuIntegrations"]>[number]["setupGuide"]
> {
  return {
    requiredCredentialFields: ["app_id", "app_secret", "verification_token", "encrypt_key"],
    requiredEvents: ["im.message.receive_v1", "card.action.trigger"],
    requiredScopes: ["im:message", "docx:document", "sheets:spreadsheet", "bitable:app"],
    eventCallbackPath: "/api/integrations/feishu/events",
    developerConsoleUrl: "https://open.feishu.cn/app",
    openPlatformSetupSteps: buildFeishuOpenPlatformSetupSteps(),
    checks: [
      {
        key: "credentials",
        status: "ready",
        current: "complete",
        required: "app_id/app_secret/verification_token/encrypt_key",
      },
      {
        key: "doc_binding",
        status: "missing",
        current: 0,
        required: 1,
      },
      {
        key: "outbox",
        status: "ready",
        current: 0,
        required: 0,
      },
    ],
    evidenceGates: [
      {
        key: "bot_reply",
        required: "processed_inbound + correlated_reply_mapping",
      },
      {
        key: "data_plane",
        required: "doc_read + agent_runtime_doc_read_from_lark_cli_manifest + approved_doc_write + sheet_read + approved_sheet_write_with_agentspace_sync + base_read + approved_base_mutation_with_agentspace_sync",
      },
      {
        key: "failure_visibility",
        required: "provider_failure_row + degraded_or_error_health",
      },
      {
        key: "openapi_artifact",
        required: "strict_live_artifact:runtime-output/feishu-smoke/live.json",
      },
    ],
    commands: {
      healthCheck: "agent-space integrations feishu health-check --workspace-id workspace-1 --integration feishu-1 --strict --json",
      botReadiness: "agent-space integrations feishu readiness --workspace-id workspace-1 --integration feishu-1 --strict --require bot --json",
      dataPlaneReadiness: "agent-space integrations feishu readiness --workspace-id workspace-1 --integration feishu-1 --strict --require data-plane --json",
      workerReadiness: "agent-space integrations feishu readiness --workspace-id workspace-1 --integration feishu-1 --strict --require worker --json",
      smokeEnv: "agent-space integrations feishu smoke-env --workspace-id workspace-1 --integration feishu-1 --app-url https://agent.test > scripts/feishu/.env",
      checkEnv: "npm run smoke:feishu -- --env-file scripts/feishu/.env --check-env --json",
      strictLiveSmoke: "npm run smoke:feishu -- --env-file scripts/feishu/.env --live --strict-live --evidence runtime-output/feishu-smoke/live.json --json",
      verifyOpenApiEvidence: "npm run smoke:feishu -- --verify-evidence runtime-output/feishu-smoke/live.json --json",
      smokePlan: "agent-space integrations feishu smoke-plan --workspace-id workspace-1 --integration feishu-1 --app-url https://agent.test --json",
      evidence: "agent-space integrations feishu evidence --workspace-id workspace-1 --integration feishu-1 --openapi-evidence runtime-output/feishu-smoke/live.json --strict --require all --json",
    },
  };
}

function buildFeishuCreationGuide(): NonNullable<
  ComponentProps<typeof SettingsPageClient>["feishuIntegrationCreationGuide"]
> {
  return {
    requiredCredentialFields: ["app_id", "app_secret", "verification_token", "encrypt_key"],
    requiredEvents: ["im.message.receive_v1", "card.action.trigger"],
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
    publicAppUrlStatus: "configured",
    publicAppUrl: "https://agent.test",
    callbackUrlTemplate: "https://agent.test/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=created-integration-id",
    developerConsoleUrl: "https://open.feishu.cn/app",
    openPlatformSetupSteps: buildFeishuOpenPlatformSetupSteps(),
  };
}

function buildFeishuOpenPlatformSetupSteps() {
  return [
    {
      id: "create_custom_app",
      consoleUrl: "https://open.feishu.cn/app",
      required: ["app_id", "app_secret"],
    },
    {
      id: "configure_event_subscription",
      consoleUrl: "https://open.feishu.cn/app",
      required: ["event_callback_url", "im.message.receive_v1", "card.action.trigger"],
    },
  ];
}
