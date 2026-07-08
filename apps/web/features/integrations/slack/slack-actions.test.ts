import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireCurrentWorkspaceContext,
  mockReadPublicAppUrl,
  mockRevalidateWorkspacePaths,
} = vi.hoisted(() => ({
  mockRequireCurrentWorkspaceContext: vi.fn(),
  mockReadPublicAppUrl: vi.fn(),
  mockRevalidateWorkspacePaths: vi.fn(),
}));

const {
  mockCancelExternalMessageOutboxForIntegrationSync,
  mockCreateExternalIntegrationSync,
  mockDeleteExternalIntegrationSync,
  mockReadExternalChannelBindingByExternalChatSync,
  mockReadExternalIntegrationSync,
  mockReadExternalUserBindingByExternalUserSync,
  mockReadStoredChannelSync,
  mockReadWorkspaceMembershipSync,
  mockUpdateExternalIntegrationHealthSync,
  mockUpdateExternalIntegrationStatusSync,
  mockUpsertExternalChannelBindingSync,
  mockUpsertExternalUserBindingSync,
} = vi.hoisted(() => ({
  mockCancelExternalMessageOutboxForIntegrationSync: vi.fn(),
  mockCreateExternalIntegrationSync: vi.fn(),
  mockDeleteExternalIntegrationSync: vi.fn(),
  mockReadExternalChannelBindingByExternalChatSync: vi.fn(),
  mockReadExternalIntegrationSync: vi.fn(),
  mockReadExternalUserBindingByExternalUserSync: vi.fn(),
  mockReadStoredChannelSync: vi.fn(),
  mockReadWorkspaceMembershipSync: vi.fn(),
  mockUpdateExternalIntegrationHealthSync: vi.fn(),
  mockUpdateExternalIntegrationStatusSync: vi.fn(),
  mockUpsertExternalChannelBindingSync: vi.fn(),
  mockUpsertExternalUserBindingSync: vi.fn(),
}));

const {
  mockBuildEncryptedSlackCredentials,
  mockBuildSlackHealthSnapshotConfigJson,
  mockCheckSlackIntegrationHealth,
  mockReadSlackIntegrationCredentials,
  mockTryRecordWorkspaceAuditEventSync,
} = vi.hoisted(() => ({
  mockBuildEncryptedSlackCredentials: vi.fn(),
  mockBuildSlackHealthSnapshotConfigJson: vi.fn(),
  mockCheckSlackIntegrationHealth: vi.fn(),
  mockReadSlackIntegrationCredentials: vi.fn(),
  mockTryRecordWorkspaceAuditEventSync: vi.fn(),
}));

const {
  mockBuildSlackEventCallbackUrl,
  mockListSlackIntegrationSettingsItems,
} = vi.hoisted(() => ({
  mockBuildSlackEventCallbackUrl: vi.fn(),
  mockListSlackIntegrationSettingsItems: vi.fn(),
}));

vi.mock("@agent-space/db", () => ({
  cancelExternalMessageOutboxForIntegrationSync: mockCancelExternalMessageOutboxForIntegrationSync,
  createExternalIntegrationSync: mockCreateExternalIntegrationSync,
  deleteExternalIntegrationSync: mockDeleteExternalIntegrationSync,
  readExternalChannelBindingByExternalChatSync: mockReadExternalChannelBindingByExternalChatSync,
  readExternalIntegrationSync: mockReadExternalIntegrationSync,
  readExternalUserBindingByExternalUserSync: mockReadExternalUserBindingByExternalUserSync,
  readStoredChannelSync: mockReadStoredChannelSync,
  readWorkspaceMembershipSync: mockReadWorkspaceMembershipSync,
  updateExternalIntegrationHealthSync: mockUpdateExternalIntegrationHealthSync,
  updateExternalIntegrationStatusSync: mockUpdateExternalIntegrationStatusSync,
  upsertExternalChannelBindingSync: mockUpsertExternalChannelBindingSync,
  upsertExternalUserBindingSync: mockUpsertExternalUserBindingSync,
}));

vi.mock("@agent-space/services", () => ({
  buildEncryptedSlackCredentials: mockBuildEncryptedSlackCredentials,
  buildSlackHealthSnapshotConfigJson: mockBuildSlackHealthSnapshotConfigJson,
  checkSlackIntegrationHealth: mockCheckSlackIntegrationHealth,
  readSlackIntegrationCredentials: mockReadSlackIntegrationCredentials,
  SLACK_DEFAULT_SCOPES: ["app_mentions:read", "chat:write"],
  SLACK_EVENT_CALLBACK_PATH: "/api/integrations/slack/events",
  SLACK_INTERACTION_CALLBACK_PATH: "/api/integrations/slack/interactions",
  SLACK_PROVIDER_ID: "slack",
  SLACK_SOCKET_MODE_SCOPES: ["connections:write"],
  tryRecordWorkspaceAuditEventSync: mockTryRecordWorkspaceAuditEventSync,
}));

vi.mock("@/features/auth/public-app-url", () => ({
  readPublicAppUrl: mockReadPublicAppUrl,
}));

vi.mock("@/features/auth/server-workspace", () => ({
  requireCurrentWorkspaceContext: mockRequireCurrentWorkspaceContext,
}));

vi.mock("@/features/auth/workspace-permissions", () => ({
  assertWorkspaceRoleForContext: (
    context: { currentMembership: { role: "owner" | "admin" | "member" } },
    minimumRole: "owner" | "admin" | "member",
    message = "Forbidden.",
  ) => {
    const rank = { member: 0, admin: 1, owner: 2 };
    if (rank[context.currentMembership.role] < rank[minimumRole]) {
      throw new Error(message);
    }
  },
}));

vi.mock("@/features/auth/workspace-revalidation", () => ({
  revalidateWorkspacePaths: mockRevalidateWorkspacePaths,
}));

vi.mock("@/features/settings/settings-sections", () => ({
  SETTINGS_REVALIDATE_PATHS: ["/settings/integrations"],
}));

vi.mock("./slack-settings-data", () => ({
  buildSlackEventCallbackUrl: mockBuildSlackEventCallbackUrl,
  canManageSlackIntegrations: (role?: "owner" | "admin" | "member") =>
    role === undefined || role === "owner" || role === "admin",
  listSlackIntegrationSettingsItems: mockListSlackIntegrationSettingsItems,
}));

import {
  checkSlackIntegrationHealthAction,
  createSlackIntegrationAction,
  createSlackUserBindingAction,
} from "./slack-actions";

describe("Slack actions", () => {
  beforeEach(() => {
    mockRequireCurrentWorkspaceContext.mockReset();
    mockReadPublicAppUrl.mockReset();
    mockRevalidateWorkspacePaths.mockReset();
    mockCancelExternalMessageOutboxForIntegrationSync.mockReset();
    mockCreateExternalIntegrationSync.mockReset();
    mockDeleteExternalIntegrationSync.mockReset();
    mockReadExternalChannelBindingByExternalChatSync.mockReset();
    mockReadExternalIntegrationSync.mockReset();
    mockReadExternalUserBindingByExternalUserSync.mockReset();
    mockReadStoredChannelSync.mockReset();
    mockReadWorkspaceMembershipSync.mockReset();
    mockUpdateExternalIntegrationHealthSync.mockReset();
    mockUpdateExternalIntegrationStatusSync.mockReset();
    mockUpsertExternalChannelBindingSync.mockReset();
    mockUpsertExternalUserBindingSync.mockReset();
    mockBuildEncryptedSlackCredentials.mockReset();
    mockBuildSlackHealthSnapshotConfigJson.mockReset();
    mockCheckSlackIntegrationHealth.mockReset();
    mockReadSlackIntegrationCredentials.mockReset();
    mockTryRecordWorkspaceAuditEventSync.mockReset();
    mockBuildSlackEventCallbackUrl.mockReset();
    mockListSlackIntegrationSettingsItems.mockReset();

    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockReadPublicAppUrl.mockReturnValue("https://agent.test");
    mockBuildSlackEventCallbackUrl.mockReturnValue("https://agent.test/api/integrations/slack/events");
    mockListSlackIntegrationSettingsItems.mockReturnValue([buildSettingsItem()]);
  });

  it("creates Slack integrations with encrypted credentials and setup metadata", async () => {
    mockBuildEncryptedSlackCredentials.mockReturnValue({
      botToken: "enc-bot",
      signingSecret: "enc-signing",
    });
    mockCreateExternalIntegrationSync.mockReturnValue(buildIntegration());

    const result = await createSlackIntegrationAction({
      displayName: "Slack",
      transportMode: "http_webhook",
      appId: "A111",
      teamId: "T111",
      botToken: "xoxb-real",
      signingSecret: "signing-real",
    });

    expect(result.id).toBe("slack-1");
    expect(mockCreateExternalIntegrationSync).toHaveBeenCalledWith(expect.objectContaining({
      provider: "slack",
      displayName: "Slack",
      transportMode: "http_webhook",
      appId: "A111",
      tenantKey: "T111",
      encryptedCredentialsJson: {
        botToken: "enc-bot",
        signingSecret: "enc-signing",
      },
      configJson: {
        eventCallbackPath: "/api/integrations/slack/events",
        interactionCallbackPath: "/api/integrations/slack/interactions",
        capabilities: {
          messageTransport: true,
          socketMode: false,
        },
      },
      capabilitiesJson: {
        messageTransport: true,
      },
      scopesJson: ["app_mentions:read", "chat:write"],
    }));
    expect(JSON.stringify(mockCreateExternalIntegrationSync.mock.calls[0]?.[0])).not.toContain("xoxb-real");
  });

  it("rejects generated Slack setup placeholders before writing", async () => {
    await expect(createSlackIntegrationAction({
      displayName: "Slack",
      transportMode: "http_webhook",
      appId: "CHANGE_ME_SLACK_APP_ID",
      teamId: "T111",
      botToken: "xoxb-real",
      signingSecret: "signing-real",
    })).rejects.toThrow("slack.integration.placeholder_value");

    expect(mockBuildEncryptedSlackCredentials).not.toHaveBeenCalled();
    expect(mockCreateExternalIntegrationSync).not.toHaveBeenCalled();
  });

  it("returns structured Slack credential encryption setup errors", async () => {
    mockBuildEncryptedSlackCredentials.mockImplementationOnce(() => {
      throw new Error("AGENT_SPACE_SLACK_CREDENTIAL_ENCRYPTION_KEY is required to store Slack credentials.");
    });

    await expect(createSlackIntegrationAction({
      displayName: "Slack",
      transportMode: "http_webhook",
      appId: "A111",
      teamId: "T111",
      botToken: "xoxb-real",
      signingSecret: "signing-real",
    })).rejects.toThrow("slack.integration.credential_encryption_key_missing");

    mockBuildEncryptedSlackCredentials.mockImplementationOnce(() => {
      throw new Error("AGENT_SPACE_SLACK_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
    });

    await expect(createSlackIntegrationAction({
      displayName: "Slack",
      transportMode: "http_webhook",
      appId: "A111",
      teamId: "T111",
      botToken: "xoxb-real",
      signingSecret: "signing-real",
    })).rejects.toThrow("slack.integration.credential_encryption_key_invalid");

    expect(mockCreateExternalIntegrationSync).not.toHaveBeenCalled();
  });

  it("requires an app-level token for Socket Mode integrations", async () => {
    await expect(createSlackIntegrationAction({
      displayName: "Slack",
      transportMode: "websocket_worker",
      appId: "A111",
      botToken: "xoxb-real",
      signingSecret: "signing-real",
    })).rejects.toThrow("slack.integration.missing_app_level_token");

    expect(mockCreateExternalIntegrationSync).not.toHaveBeenCalled();
  });

  it("lets members bind only their own Slack user", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("member", "user-1"));
    mockReadExternalIntegrationSync.mockReturnValue(buildIntegration());
    mockReadWorkspaceMembershipSync.mockReturnValue({ userId: "user-1" });
    mockReadExternalUserBindingByExternalUserSync.mockReturnValue(null);
    mockUpsertExternalUserBindingSync.mockReturnValue({
      id: "user-binding-1",
      integrationId: "slack-1",
      userId: "user-1",
    });

    await createSlackUserBindingAction({
      integrationId: "slack-1",
      userId: "user-1",
      externalUserId: "U111",
      displayName: "Mina",
    });

    expect(mockUpsertExternalUserBindingSync).toHaveBeenCalledWith(expect.objectContaining({
      integrationId: "slack-1",
      userId: "user-1",
      externalUserId: "U111",
      displayName: "Mina",
      status: "active",
    }));

    await expect(createSlackUserBindingAction({
      integrationId: "slack-1",
      userId: "user-2",
      externalUserId: "U222",
    })).rejects.toThrow("slack.user_binding.forbidden");
  });

  it("checks Slack health and records the provider snapshot", async () => {
    const integration = buildIntegration();
    mockReadExternalIntegrationSync.mockReturnValue(integration);
    mockReadSlackIntegrationCredentials.mockReturnValue({ botToken: "xoxb-real" });
    mockCheckSlackIntegrationHealth.mockResolvedValue({
      status: "healthy",
      checkedAt: "2026-07-07T00:00:00.000Z",
      botUserId: "Ubot",
      teamId: "T111",
    });
    mockBuildSlackHealthSnapshotConfigJson.mockReturnValue({
      bot: {
        botUserId: "Ubot",
      },
    });
    mockUpdateExternalIntegrationHealthSync.mockReturnValue(integration);

    await checkSlackIntegrationHealthAction("slack-1");

    expect(mockCheckSlackIntegrationHealth).toHaveBeenCalledWith({
      botToken: "xoxb-real",
      appLevelToken: undefined,
      transportMode: "http_webhook",
      expectedAppId: "A111",
      expectedTeamId: "T111",
    });
    expect(mockUpdateExternalIntegrationHealthSync).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      integrationId: "slack-1",
      lastHealthStatus: "healthy",
      lastError: undefined,
      configJson: {
        bot: {
          botUserId: "Ubot",
        },
      },
    });
  });
});

function buildWorkspaceContext(role: "owner" | "admin" | "member", userId: string) {
  return {
    currentMembership: {
      role,
    },
    currentUser: {
      id: userId,
      displayName: userId === "admin-1" ? "Admin" : "Mina",
    },
    currentWorkspace: {
      id: "workspace-1",
      slug: "workspace",
    },
  };
}

function buildIntegration() {
  return {
    id: "slack-1",
    workspaceId: "workspace-1",
    provider: "slack",
    displayName: "Slack",
    status: "active",
    transportMode: "http_webhook",
    appId: "A111",
    tenantKey: "T111",
    encryptedCredentialsJson: "{}",
    configJson: "{}",
    capabilitiesJson: "{}",
    scopesJson: "[]",
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
  };
}

function buildSettingsItem() {
  return {
    id: "slack-1",
    displayName: "Slack",
    status: "active",
    transportMode: "http_webhook",
    appId: "A111",
    teamId: "T111",
    callbackUrl: "https://agent.test/api/integrations/slack/events",
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
    hasBotToken: true,
    hasSigningSecret: true,
    hasAppLevelToken: false,
    channelBindingCount: 0,
    userBindingCount: 0,
    outboxFailureCount: 0,
    userBindings: [],
    channelBindings: [],
    recentOutboxFailures: [],
    recentInboundEvents: [],
  };
}
