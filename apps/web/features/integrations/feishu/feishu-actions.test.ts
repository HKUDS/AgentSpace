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
  mockReadExternalResourceBindingByKeySync,
  mockReadExternalUserBindingByExternalUserSync,
  mockReadExternalUserBindingByIdSync,
  mockReadStoredChannelSync,
  mockReadWorkspaceMembershipSync,
  mockUpdateExternalChannelBindingStatusSync,
  mockUpdateExternalIntegrationCredentialsSync,
  mockUpdateExternalIntegrationHealthSync,
  mockUpdateExternalIntegrationStatusSync,
  mockUpdateExternalResourceBindingStatusSync,
  mockUpdateExternalUserBindingStatusSync,
  mockUpsertExternalChannelBindingSync,
  mockUpsertExternalResourceBindingSync,
  mockUpsertExternalUserBindingSync,
} = vi.hoisted(() => ({
  mockCancelExternalMessageOutboxForIntegrationSync: vi.fn(),
  mockCreateExternalIntegrationSync: vi.fn(),
  mockDeleteExternalIntegrationSync: vi.fn(),
  mockReadExternalChannelBindingByExternalChatSync: vi.fn(),
  mockReadExternalIntegrationSync: vi.fn(),
  mockReadExternalResourceBindingByKeySync: vi.fn(),
  mockReadExternalUserBindingByExternalUserSync: vi.fn(),
  mockReadExternalUserBindingByIdSync: vi.fn(),
  mockReadStoredChannelSync: vi.fn(),
  mockReadWorkspaceMembershipSync: vi.fn(),
  mockUpdateExternalChannelBindingStatusSync: vi.fn(),
  mockUpdateExternalIntegrationCredentialsSync: vi.fn(),
  mockUpdateExternalIntegrationHealthSync: vi.fn(),
  mockUpdateExternalIntegrationStatusSync: vi.fn(),
  mockUpdateExternalResourceBindingStatusSync: vi.fn(),
  mockUpdateExternalUserBindingStatusSync: vi.fn(),
  mockUpsertExternalChannelBindingSync: vi.fn(),
  mockUpsertExternalResourceBindingSync: vi.fn(),
  mockUpsertExternalUserBindingSync: vi.fn(),
}));

const {
  mockCheckFeishuIntegrationHealth,
  mockCreateFeishuAgentBotBindingSync,
  mockDisableFeishuAgentBotBindingSync,
  mockResolveFeishuResourceDescriptorForType,
  mockRotateFeishuAgentBotCredentialsSync,
  mockTryRecordWorkspaceAuditEventSync,
  mockUpsertFeishuExternalChannelDocumentSync,
  mockUpsertFeishuExternalDataTableSync,
  mockValidateFeishuResourceDescriptorForBinding,
  mockValidateFeishuResourceBindingScopes,
} = vi.hoisted(() => ({
  mockCheckFeishuIntegrationHealth: vi.fn(),
  mockCreateFeishuAgentBotBindingSync: vi.fn(),
  mockDisableFeishuAgentBotBindingSync: vi.fn(),
  mockResolveFeishuResourceDescriptorForType: vi.fn(),
  mockRotateFeishuAgentBotCredentialsSync: vi.fn(),
  mockTryRecordWorkspaceAuditEventSync: vi.fn(),
  mockUpsertFeishuExternalChannelDocumentSync: vi.fn(),
  mockUpsertFeishuExternalDataTableSync: vi.fn(),
  mockValidateFeishuResourceDescriptorForBinding: vi.fn(),
  mockValidateFeishuResourceBindingScopes: vi.fn(),
}));

const {
  mockBuildEncryptedFeishuCredentials,
  mockReadFeishuIntegrationCredentials,
  mockBuildFeishuEventCallbackUrl,
  mockListFeishuIntegrationSettingsItems,
} = vi.hoisted(() => ({
  mockBuildEncryptedFeishuCredentials: vi.fn(),
  mockReadFeishuIntegrationCredentials: vi.fn(),
  mockBuildFeishuEventCallbackUrl: vi.fn(),
  mockListFeishuIntegrationSettingsItems: vi.fn(),
}));

vi.mock("@agent-space/db", () => ({
  cancelExternalMessageOutboxForIntegrationSync: mockCancelExternalMessageOutboxForIntegrationSync,
  createExternalIntegrationSync: mockCreateExternalIntegrationSync,
  deleteExternalIntegrationSync: mockDeleteExternalIntegrationSync,
  readExternalChannelBindingByExternalChatSync: mockReadExternalChannelBindingByExternalChatSync,
  readExternalIntegrationSync: mockReadExternalIntegrationSync,
  readExternalResourceBindingByKeySync: mockReadExternalResourceBindingByKeySync,
  readExternalUserBindingByExternalUserSync: mockReadExternalUserBindingByExternalUserSync,
  readExternalUserBindingByIdSync: mockReadExternalUserBindingByIdSync,
  readStoredChannelSync: mockReadStoredChannelSync,
  readWorkspaceMembershipSync: mockReadWorkspaceMembershipSync,
  updateExternalChannelBindingStatusSync: mockUpdateExternalChannelBindingStatusSync,
  updateExternalIntegrationCredentialsSync: mockUpdateExternalIntegrationCredentialsSync,
  updateExternalIntegrationHealthSync: mockUpdateExternalIntegrationHealthSync,
  updateExternalIntegrationStatusSync: mockUpdateExternalIntegrationStatusSync,
  updateExternalResourceBindingStatusSync: mockUpdateExternalResourceBindingStatusSync,
  updateExternalUserBindingStatusSync: mockUpdateExternalUserBindingStatusSync,
  upsertExternalChannelBindingSync: mockUpsertExternalChannelBindingSync,
  upsertExternalResourceBindingSync: mockUpsertExternalResourceBindingSync,
  upsertExternalUserBindingSync: mockUpsertExternalUserBindingSync,
}));

vi.mock("@agent-space/services", () => ({
  FEISHU_DEFAULT_SCOPES: ["im:message"],
  FEISHU_EVENT_CALLBACK_PATH: "/api/integrations/feishu/events",
  FEISHU_PROVIDER_ID: "feishu",
  checkFeishuIntegrationHealth: mockCheckFeishuIntegrationHealth,
  createFeishuAgentBotBindingSync: mockCreateFeishuAgentBotBindingSync,
  disableFeishuAgentBotBindingSync: mockDisableFeishuAgentBotBindingSync,
  resolveFeishuResourceDescriptorForType: mockResolveFeishuResourceDescriptorForType,
  rotateFeishuAgentBotCredentialsSync: mockRotateFeishuAgentBotCredentialsSync,
  tryRecordWorkspaceAuditEventSync: mockTryRecordWorkspaceAuditEventSync,
  upsertFeishuExternalChannelDocumentSync: mockUpsertFeishuExternalChannelDocumentSync,
  upsertFeishuExternalDataTableSync: mockUpsertFeishuExternalDataTableSync,
  validateFeishuResourceDescriptorForBinding: mockValidateFeishuResourceDescriptorForBinding,
  validateFeishuResourceBindingScopes: mockValidateFeishuResourceBindingScopes,
}));

vi.mock("@/features/auth/public-app-url", () => ({
  readPublicAppUrl: mockReadPublicAppUrl,
}));

vi.mock("@/features/auth/server-workspace", () => ({
  requireCurrentWorkspaceContext: mockRequireCurrentWorkspaceContext,
}));

vi.mock("@/features/auth/workspace-permissions", () => ({
  hasWorkspaceRole: (
    role: "owner" | "admin" | "member",
    minimumRole: "owner" | "admin" | "member",
  ) => {
    const rank = { member: 0, admin: 1, owner: 2 };
    return rank[role] >= rank[minimumRole];
  },
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

vi.mock("./feishu-credentials", () => ({
  buildEncryptedFeishuCredentials: mockBuildEncryptedFeishuCredentials,
  readFeishuIntegrationCredentials: mockReadFeishuIntegrationCredentials,
}));

vi.mock("./feishu-settings-data", () => ({
  buildFeishuEventCallbackUrl: mockBuildFeishuEventCallbackUrl,
  canManageFeishuIntegrations: (role?: "owner" | "admin" | "member") =>
    role === undefined || role === "owner" || role === "admin",
  listFeishuIntegrationSettingsItems: mockListFeishuIntegrationSettingsItems,
}));

import {
  checkFeishuIntegrationHealthAction,
  createFeishuAgentBotBindingAction,
  createFeishuChannelBindingAction,
  createFeishuIntegrationAction,
  createFeishuResourceBindingAction,
  createFeishuUserBindingAction,
  deleteFeishuIntegrationAction,
  pauseFeishuChannelBindingAction,
  rotateFeishuAgentBotCredentialsAction,
  rotateFeishuIntegrationSecretAction,
  revokeFeishuUserBindingAction,
  testFeishuIntegrationConnectionAction,
} from "./feishu-actions";

describe("Feishu actions", () => {
  beforeEach(() => {
    mockRequireCurrentWorkspaceContext.mockReset();
    mockReadPublicAppUrl.mockReset();
    mockRevalidateWorkspacePaths.mockReset();
    mockCancelExternalMessageOutboxForIntegrationSync.mockReset();
    mockCreateExternalIntegrationSync.mockReset();
    mockDeleteExternalIntegrationSync.mockReset();
    mockReadExternalChannelBindingByExternalChatSync.mockReset();
    mockReadExternalIntegrationSync.mockReset();
    mockReadExternalResourceBindingByKeySync.mockReset();
    mockReadExternalUserBindingByExternalUserSync.mockReset();
    mockReadExternalUserBindingByIdSync.mockReset();
    mockReadStoredChannelSync.mockReset();
    mockReadWorkspaceMembershipSync.mockReset();
    mockUpdateExternalChannelBindingStatusSync.mockReset();
    mockUpdateExternalIntegrationCredentialsSync.mockReset();
    mockUpdateExternalIntegrationHealthSync.mockReset();
    mockUpdateExternalIntegrationStatusSync.mockReset();
    mockUpdateExternalResourceBindingStatusSync.mockReset();
    mockUpdateExternalUserBindingStatusSync.mockReset();
    mockUpsertExternalChannelBindingSync.mockReset();
    mockUpsertExternalResourceBindingSync.mockReset();
    mockUpsertExternalUserBindingSync.mockReset();
    mockCheckFeishuIntegrationHealth.mockReset();
    mockCreateFeishuAgentBotBindingSync.mockReset();
    mockDisableFeishuAgentBotBindingSync.mockReset();
    mockResolveFeishuResourceDescriptorForType.mockReset();
    mockRotateFeishuAgentBotCredentialsSync.mockReset();
    mockTryRecordWorkspaceAuditEventSync.mockReset();
    mockUpsertFeishuExternalChannelDocumentSync.mockReset();
    mockUpsertFeishuExternalDataTableSync.mockReset();
    mockValidateFeishuResourceDescriptorForBinding.mockReset();
    mockValidateFeishuResourceBindingScopes.mockReset();
    mockBuildEncryptedFeishuCredentials.mockReset();
    mockReadFeishuIntegrationCredentials.mockReset();
    mockBuildFeishuEventCallbackUrl.mockReset();
    mockListFeishuIntegrationSettingsItems.mockReset();

    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("member", "user-1"));
    mockReadPublicAppUrl.mockReturnValue("https://agentspace.test");
    mockBuildFeishuEventCallbackUrl.mockReturnValue("https://agentspace.test/api/integrations/feishu/events");
    mockListFeishuIntegrationSettingsItems.mockReturnValue([buildSettingsItem()]);
    mockCancelExternalMessageOutboxForIntegrationSync.mockReturnValue(0);
    mockReadExternalIntegrationSync.mockReturnValue(buildIntegration());
    mockReadExternalChannelBindingByExternalChatSync.mockReturnValue(null);
    mockReadExternalResourceBindingByKeySync.mockReturnValue(null);
    mockReadExternalUserBindingByExternalUserSync.mockReturnValue(null);
    mockReadWorkspaceMembershipSync.mockReturnValue(buildMembership("member", "user-1"));
    mockValidateFeishuResourceBindingScopes.mockReturnValue({
      ok: true,
      requiredScopes: [],
      availableScopes: [],
    });
    mockValidateFeishuResourceDescriptorForBinding.mockReturnValue({ ok: true });
    mockUpsertExternalUserBindingSync.mockReturnValue(buildUserBinding("user-1"));
    mockUpdateExternalUserBindingStatusSync.mockReturnValue(buildUserBinding("user-1", "archived"));
  });

  it("allows members to create their own Feishu user binding", async () => {
    const result = await createFeishuUserBindingAction({
      integrationId: "integration-1",
      userId: " user-1 ",
      externalUserId: " ou_member ",
    });

    expect(mockUpsertExternalUserBindingSync).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      userId: "user-1",
      externalUserId: "ou_member",
      status: "active",
    }));
    expect(mockTryRecordWorkspaceAuditEventSync).toHaveBeenCalledWith(expect.objectContaining({
      code: "workspace.external_user_binding_upserted",
      note: "Member One mapped AgentSpace user \"user-1\" to a Feishu user.",
      data: expect.objectContaining({
        resourceId: "binding-1",
        provider: "feishu",
        integrationId: "integration-1",
        userId: "user-1",
        externalIdRedacted: true,
      }),
    }));
    expect(JSON.stringify(mockTryRecordWorkspaceAuditEventSync.mock.calls)).not.toContain("ou_member");
    expect(result.callbackUrl).toBe("");
  });

  it("redacts Feishu chat ids from channel binding audit payloads", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockReadStoredChannelSync.mockReturnValue({
      id: "channel-general",
      workspaceId: "workspace-1",
      name: "general",
    });
    mockUpsertExternalChannelBindingSync.mockReturnValue({
      id: "channel-binding-1",
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      channelName: "general",
      externalChatId: "oc_general",
      status: "active",
    });

    await createFeishuChannelBindingAction({
      integrationId: "integration-1",
      channelName: " general ",
      externalChatId: " oc_general ",
      externalChatType: "group",
      externalChatName: "General Chat",
    });

    expect(mockUpsertExternalChannelBindingSync).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      channelName: "general",
      externalChatId: "oc_general",
      externalChatType: "group",
      externalChatName: "General Chat",
      status: "active",
      syncMode: "mirror",
      createdByUserId: "admin-1",
    }));
    expect(mockTryRecordWorkspaceAuditEventSync).toHaveBeenCalledWith(expect.objectContaining({
      code: "workspace.external_channel_binding_upserted",
      note: "Member One mapped AgentSpace channel \"general\" to a Feishu chat.",
      data: expect.objectContaining({
        resourceId: "channel-binding-1",
        provider: "feishu",
        integrationId: "integration-1",
        channelName: "general",
        externalIdRedacted: true,
      }),
    }));
    expect(JSON.stringify(mockTryRecordWorkspaceAuditEventSync.mock.calls)).not.toContain("oc_general");
  });

  it("rejects Feishu chats already mapped to another AgentSpace channel before writing", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockReadStoredChannelSync.mockReturnValue({
      id: "channel-general",
      workspaceId: "workspace-1",
      name: "general",
    });
    mockReadExternalChannelBindingByExternalChatSync.mockReturnValue({
      id: "channel-binding-2",
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      channelName: "launch",
      externalChatId: "oc_general",
      status: "active",
    });

    await expect(createFeishuChannelBindingAction({
      integrationId: "integration-1",
      channelName: "general",
      externalChatId: "oc_general",
      externalChatType: "group",
    })).rejects.toThrow("feishu.channel_binding.external_chat_taken");

    expect(mockReadExternalChannelBindingByExternalChatSync).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      externalChatId: "oc_general",
    });
    expect(mockUpsertExternalChannelBindingSync).not.toHaveBeenCalled();
    expect(mockTryRecordWorkspaceAuditEventSync).not.toHaveBeenCalled();
  });

  it("rejects members binding another AgentSpace user before writing", async () => {
    await expect(createFeishuUserBindingAction({
      integrationId: "integration-1",
      userId: "user-2",
      externalUserId: "ou_other",
    })).rejects.toThrow("feishu.user_binding.forbidden");

    expect(mockReadExternalIntegrationSync).not.toHaveBeenCalled();
    expect(mockUpsertExternalUserBindingSync).not.toHaveBeenCalled();
  });

  it("rejects Feishu Open IDs already bound to another AgentSpace user before writing", async () => {
    mockReadExternalUserBindingByExternalUserSync.mockReturnValue(buildUserBinding("user-2"));

    await expect(createFeishuUserBindingAction({
      integrationId: "integration-1",
      userId: "user-1",
      externalUserId: "ou_user-2",
    })).rejects.toThrow("feishu.user_binding.external_user_taken");

    expect(mockReadExternalUserBindingByExternalUserSync).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      externalUserId: "ou_user-2",
    });
    expect(mockUpsertExternalUserBindingSync).not.toHaveBeenCalled();
    expect(mockTryRecordWorkspaceAuditEventSync).not.toHaveBeenCalled();
  });

  it("allows members to revoke their own Feishu user binding", async () => {
    mockReadExternalUserBindingByIdSync.mockReturnValue(buildUserBinding("user-1"));

    await revokeFeishuUserBindingAction({ bindingId: "binding-1" });

    expect(mockReadExternalIntegrationSync).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      integrationId: "integration-1",
    });
    expect(mockUpdateExternalUserBindingStatusSync).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      bindingId: "binding-1",
      status: "archived",
    });
  });

  it("rejects members revoking another user's Feishu binding before writing", async () => {
    mockReadExternalUserBindingByIdSync.mockReturnValue(buildUserBinding("user-2"));

    await expect(revokeFeishuUserBindingAction({ bindingId: "binding-1" }))
      .rejects.toThrow("feishu.user_binding.forbidden");

    expect(mockReadExternalIntegrationSync).not.toHaveBeenCalled();
    expect(mockUpdateExternalUserBindingStatusSync).not.toHaveBeenCalled();
  });

  it("rejects non-Feishu user bindings before writing", async () => {
    mockReadExternalUserBindingByIdSync.mockReturnValue(buildUserBinding("user-1", "active", "slack-integration-1"));
    mockReadExternalIntegrationSync.mockReturnValue(buildIntegration({
      id: "slack-integration-1",
      provider: "slack",
    }));

    await expect(revokeFeishuUserBindingAction({ bindingId: "binding-1" }))
      .rejects.toThrow("feishu.integration.not_found");

    expect(mockUpdateExternalUserBindingStatusSync).not.toHaveBeenCalled();
  });

  it("keeps channel binding status changes admin-only", async () => {
    await expect(pauseFeishuChannelBindingAction({ bindingId: "channel-binding-1" }))
      .rejects.toThrow("Forbidden.");

    expect(mockUpdateExternalChannelBindingStatusSync).not.toHaveBeenCalled();
  });

  it("keeps integration and channel binding creation/deletion admin-only", async () => {
    await expect(createFeishuIntegrationAction({
      displayName: "Feishu",
      transportMode: "http_webhook",
      appId: "cli_a",
      appSecret: "secret",
      verificationToken: "verify",
    })).rejects.toThrow("Forbidden.");
    await expect(deleteFeishuIntegrationAction("integration-1")).rejects.toThrow("Forbidden.");
    await expect(createFeishuChannelBindingAction({
      integrationId: "integration-1",
      channelName: "general",
      externalChatId: "oc_general",
    })).rejects.toThrow("Forbidden.");

    expect(mockCreateExternalIntegrationSync).not.toHaveBeenCalled();
    expect(mockCancelExternalMessageOutboxForIntegrationSync).not.toHaveBeenCalled();
    expect(mockDeleteExternalIntegrationSync).not.toHaveBeenCalled();
    expect(mockUpsertExternalChannelBindingSync).not.toHaveBeenCalled();
  });

  it("returns a stable error code when creating a duplicate Feishu app tenant integration", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockBuildEncryptedFeishuCredentials.mockReturnValue({
      appSecret: "v1:app-secret-ciphertext",
      verificationToken: "v1:verification-token-ciphertext",
    });
    mockCreateExternalIntegrationSync.mockImplementation(() => {
      throw new Error("External integration app and tenant are already connected.");
    });

    await expect(createFeishuIntegrationAction({
      displayName: "Feishu Duplicate",
      transportMode: "http_webhook",
      appId: "cli_dup",
      appSecret: "secret",
      verificationToken: "verify",
      tenantKey: "tenant-dup",
    })).rejects.toThrow("feishu.integration.duplicate_app_tenant");

    expect(mockCreateExternalIntegrationSync).toHaveBeenCalled();
    expect(mockTryRecordWorkspaceAuditEventSync).not.toHaveBeenCalled();
    expect(mockRevalidateWorkspacePaths).not.toHaveBeenCalled();
  });

	  it("returns stable error codes for missing or invalid Feishu credential encryption key", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockBuildEncryptedFeishuCredentials.mockImplementationOnce(() => {
      throw new Error("AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY is required to store Feishu credentials.");
    });

    await expect(createFeishuIntegrationAction({
      displayName: "Feishu",
      transportMode: "http_webhook",
      appId: "cli_key_missing",
      appSecret: "secret",
      verificationToken: "verify",
    })).rejects.toThrow("feishu.integration.credential_encryption_key_missing");

    expect(mockCreateExternalIntegrationSync).not.toHaveBeenCalled();
    expect(mockTryRecordWorkspaceAuditEventSync).not.toHaveBeenCalled();
    expect(mockRevalidateWorkspacePaths).not.toHaveBeenCalled();

    mockReadExternalIntegrationSync.mockReturnValue(buildIntegration({
      id: "integration-rotate",
      appId: "cli_old",
      tenantKey: "tenant-old",
    }));
    mockBuildEncryptedFeishuCredentials.mockImplementationOnce(() => {
      throw new Error("AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
    });

    await expect(rotateFeishuIntegrationSecretAction({
      integrationId: "integration-rotate",
      appId: "cli_key_invalid",
      appSecret: "secret",
      verificationToken: "verify",
      tenantKey: "tenant-invalid",
    })).rejects.toThrow("feishu.integration.credential_encryption_key_invalid");

    expect(mockUpdateExternalIntegrationCredentialsSync).not.toHaveBeenCalled();
  });

  it("rejects Feishu setup placeholder values before testing or persisting credentials", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));

    await expect(testFeishuIntegrationConnectionAction({
      appId: "cli_xxx",
      appSecret: "secret",
    })).rejects.toThrow("feishu.integration.placeholder_value");
    expect(mockCheckFeishuIntegrationHealth).not.toHaveBeenCalled();

    await expect(createFeishuIntegrationAction({
      displayName: "Feishu",
      transportMode: "http_webhook",
      appId: "cli_create",
      appSecret: "CHANGE-ME-FEISHU-APP-SECRET",
      verificationToken: "verify",
    })).rejects.toThrow("feishu.integration.placeholder_value");
    expect(mockBuildEncryptedFeishuCredentials).not.toHaveBeenCalled();
    expect(mockCreateExternalIntegrationSync).not.toHaveBeenCalled();

    mockReadExternalIntegrationSync.mockReturnValue(buildIntegration({
      id: "integration-rotate",
      appId: "cli_old",
      tenantKey: "tenant-old",
    }));
    await expect(rotateFeishuIntegrationSecretAction({
      integrationId: "integration-rotate",
      appId: "cli_rotated",
      appSecret: "secret",
      verificationToken: "verify",
      tenantKey: "tenant_xxx",
    })).rejects.toThrow("feishu.integration.placeholder_value");
    expect(mockUpdateExternalIntegrationCredentialsSync).not.toHaveBeenCalled();
  });

  it("rejects Feishu binding placeholder values before reading integration state or writing", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));

    await expect(createFeishuChannelBindingAction({
      integrationId: "integration-1",
      channelName: "general",
      externalChatId: "CHANGE-ME-FEISHU-CHAT-ID",
      externalChatType: "group",
    })).rejects.toThrow("feishu.channel_binding.placeholder_value");

    await expect(createFeishuUserBindingAction({
      integrationId: "integration-1",
      userId: "user-1",
      externalUserId: "ou_xxx",
    })).rejects.toThrow("feishu.user_binding.placeholder_value");

    await expect(createFeishuResourceBindingAction({
      integrationId: "integration-1",
      providerResourceType: "sheet",
      resourceUrlOrToken: "CHANGE-ME-FEISHU-SHEET-URL-OR-TOKEN",
      agentSpaceResourceType: "data_table",
      agentSpaceResourceId: "",
      channelName: "general",
      allowWrite: true,
    })).rejects.toThrow("feishu.resource_binding.placeholder_value");

    expect(mockReadExternalIntegrationSync).not.toHaveBeenCalled();
    expect(mockReadStoredChannelSync).not.toHaveBeenCalled();
    expect(mockReadWorkspaceMembershipSync).not.toHaveBeenCalled();
    expect(mockResolveFeishuResourceDescriptorForType).not.toHaveBeenCalled();
    expect(mockUpsertExternalChannelBindingSync).not.toHaveBeenCalled();
    expect(mockUpsertExternalUserBindingSync).not.toHaveBeenCalled();
    expect(mockUpsertExternalResourceBindingSync).not.toHaveBeenCalled();
    expect(mockTryRecordWorkspaceAuditEventSync).not.toHaveBeenCalled();
  });

  it("returns a stable error code when rotating credentials into a duplicate Feishu app tenant", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockReadExternalIntegrationSync.mockReturnValue(buildIntegration({
      id: "integration-rotate",
      appId: "cli_old",
      tenantKey: "tenant-old",
    }));
    mockBuildEncryptedFeishuCredentials.mockReturnValue({
      appSecret: "v1:app-secret-ciphertext",
      verificationToken: "v1:verification-token-ciphertext",
    });
    mockUpdateExternalIntegrationCredentialsSync.mockImplementation(() => {
      throw new Error("External integration app and tenant are already connected.");
    });

    await expect(rotateFeishuIntegrationSecretAction({
      integrationId: "integration-rotate",
      appId: "cli_dup",
      appSecret: "secret",
      verificationToken: "verify",
      tenantKey: "tenant-dup",
    })).rejects.toThrow("feishu.integration.duplicate_app_tenant");

    expect(mockUpdateExternalIntegrationCredentialsSync).toHaveBeenCalled();
    expect(mockTryRecordWorkspaceAuditEventSync).not.toHaveBeenCalled();
    expect(mockRevalidateWorkspacePaths).not.toHaveBeenCalled();
  });

  it("cancels pending Feishu outbox before deleting the integration", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockCancelExternalMessageOutboxForIntegrationSync.mockReturnValue(2);
    mockDeleteExternalIntegrationSync.mockReturnValue(buildIntegration({
      id: "integration-1",
      displayName: "Feishu",
    }));

    const result = await deleteFeishuIntegrationAction("integration-1");

    expect(mockCancelExternalMessageOutboxForIntegrationSync).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      reason: "feishu.integration.deleted",
    });
    expect(mockDeleteExternalIntegrationSync).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      integrationId: "integration-1",
    });
    expect(mockCancelExternalMessageOutboxForIntegrationSync.mock.invocationCallOrder[0])
      .toBeLessThan(mockDeleteExternalIntegrationSync.mock.invocationCallOrder[0]);
    expect(mockTryRecordWorkspaceAuditEventSync).toHaveBeenCalledWith(expect.objectContaining({
      code: "workspace.external_integration_deleted",
      data: expect.objectContaining({
        provider: "feishu",
        resourceId: "integration-1",
        cancelledOutboxCount: 2,
      }),
    }));
    expect(result).toEqual({ integrationId: "integration-1" });
  });

  it("lets admins bind a Feishu Doc to an AgentSpace channel document", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockReadStoredChannelSync.mockReturnValue({ name: "general" });
    mockResolveFeishuResourceDescriptorForType.mockReturnValue({
      providerResourceType: "doc",
      providerResourceToken: "doccnLaunch123",
      providerResourceUrl: "https://example.feishu.cn/docx/doccnLaunch123",
    });
    mockUpsertFeishuExternalChannelDocumentSync.mockReturnValue({
      created: true,
      document: {
        id: "channel-document-feishu-1",
        channelName: "general",
      },
    });
    mockUpsertExternalResourceBindingSync.mockReturnValue({
      id: "resource-binding-1",
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      providerResourceType: "doc",
      providerResourceToken: "doccnLaunch123",
      providerResourceUrl: "https://example.feishu.cn/docx/doccnLaunch123",
      agentSpaceResourceType: "channel_document",
      agentSpaceResourceId: "channel-document-feishu-1",
      channelName: "general",
      displayName: "Launch brief",
      status: "active",
      permissionsJson: "{}",
      metadataJson: "{}",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
    });

    const result = await createFeishuResourceBindingAction({
      integrationId: "integration-1",
      providerResourceType: "doc",
      resourceUrlOrToken: " https://example.feishu.cn/docx/doccnLaunch123 ",
      agentSpaceResourceType: "channel_document",
      agentSpaceResourceId: "",
      channelName: " general ",
      displayName: " Launch brief ",
      allowWrite: true,
      guestReadable: true,
    });

    expect(mockResolveFeishuResourceDescriptorForType).toHaveBeenCalledWith(
      "doc",
      " https://example.feishu.cn/docx/doccnLaunch123 ",
    );
    expect(mockValidateFeishuResourceBindingScopes).toHaveBeenCalledWith({
      providerResourceType: "doc",
      scopesJson: [],
    });
    expect(mockUpsertFeishuExternalChannelDocumentSync).toHaveBeenCalledWith({
      channelName: "general",
      agentSpaceResourceId: "",
      providerResourceType: "doc",
      providerResourceToken: "doccnLaunch123",
      providerResourceUrl: "https://example.feishu.cn/docx/doccnLaunch123",
      title: "Launch brief",
      createdBy: "Member One",
      createdByType: "human",
    }, "workspace-1");
    expect(mockUpsertExternalResourceBindingSync).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      providerResourceType: "doc",
      providerResourceToken: "doccnLaunch123",
      providerResourceUrl: "https://example.feishu.cn/docx/doccnLaunch123",
      agentSpaceResourceType: "channel_document",
      agentSpaceResourceId: "channel-document-feishu-1",
      channelName: "general",
      displayName: "Launch brief",
      status: "active",
      permissionsJson: {
        canRead: true,
        canWrite: true,
        externalGuestReadable: true,
      },
      createdByUserId: "admin-1",
      metadataJson: {
        agentSpaceSync: {
          channelDocumentId: "channel-document-feishu-1",
          channelName: "general",
          created: true,
        },
      },
    }));
    expect(mockUpsertFeishuExternalDataTableSync).not.toHaveBeenCalled();
    expect(mockTryRecordWorkspaceAuditEventSync).toHaveBeenCalledWith(expect.objectContaining({
      code: "workspace.external_resource_binding_upserted",
      note: "Member One mapped a Feishu doc resource to AgentSpace.",
      data: expect.objectContaining({
        provider: "feishu",
        resourceId: "resource-binding-1",
        providerResourceType: "doc",
        agentSpaceResourceType: "channel_document",
        agentSpaceResourceId: "channel-document-feishu-1",
        writeAllowed: true,
        guestReadable: true,
        externalIdRedacted: true,
      }),
    }));
    expect(JSON.stringify(mockTryRecordWorkspaceAuditEventSync.mock.calls)).not.toContain("doccnLaunch123");
    expect(result.id).toBe("integration-1");
  });

  it("rejects Feishu resources already bound to another AgentSpace target before syncing local resources", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockReadStoredChannelSync.mockReturnValue({ name: "general" });
    mockResolveFeishuResourceDescriptorForType.mockReturnValue({
      providerResourceType: "sheet",
      providerResourceToken: "shtcnLaunch123",
      providerResourceUrl: "https://example.feishu.cn/sheets/shtcnLaunch123",
    });
    mockReadExternalResourceBindingByKeySync.mockReturnValue({
      id: "resource-binding-2",
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      providerResourceType: "sheet",
      providerResourceToken: "shtcnLaunch123",
      agentSpaceResourceType: "data_table",
      agentSpaceResourceId: "data-table-launch",
      channelName: "launch",
      status: "active",
    });

    await expect(createFeishuResourceBindingAction({
      integrationId: "integration-1",
      providerResourceType: "sheet",
      resourceUrlOrToken: "https://example.feishu.cn/sheets/shtcnLaunch123",
      agentSpaceResourceType: "data_table",
      agentSpaceResourceId: "",
      channelName: "general",
      displayName: "Launch Sheet",
      allowWrite: true,
    })).rejects.toThrow("feishu.resource_binding.external_resource_taken");

    expect(mockReadExternalResourceBindingByKeySync).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      providerResourceType: "sheet",
      providerResourceToken: "shtcnLaunch123",
    });
    expect(mockUpsertFeishuExternalDataTableSync).not.toHaveBeenCalled();
    expect(mockUpsertExternalResourceBindingSync).not.toHaveBeenCalled();
    expect(mockTryRecordWorkspaceAuditEventSync).not.toHaveBeenCalledWith(expect.objectContaining({
      code: "workspace.external_resource_binding_upserted",
    }));
  });

  it("reuses the existing AgentSpace target when rebinding the same Feishu resource", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockResolveFeishuResourceDescriptorForType.mockReturnValue({
      providerResourceType: "sheet",
      providerResourceToken: "shtcnLaunch123",
      providerResourceUrl: "https://example.feishu.cn/sheets/shtcnLaunch123",
    });
    mockReadExternalResourceBindingByKeySync.mockReturnValue({
      id: "resource-binding-1",
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      providerResourceType: "sheet",
      providerResourceToken: "shtcnLaunch123",
      agentSpaceResourceType: "data_table",
      agentSpaceResourceId: "data-table-existing",
      channelName: "general",
      status: "active",
    });
    mockUpsertFeishuExternalDataTableSync.mockReturnValue({
      created: false,
      table: {
        id: "data-table-existing",
        channelName: "general",
      },
    });
    mockUpsertExternalResourceBindingSync.mockReturnValue({
      id: "resource-binding-1",
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      providerResourceType: "sheet",
      providerResourceToken: "shtcnLaunch123",
      agentSpaceResourceType: "data_table",
      agentSpaceResourceId: "data-table-existing",
      channelName: "general",
      status: "active",
      permissionsJson: "{}",
      metadataJson: "{}",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
    });

    await createFeishuResourceBindingAction({
      integrationId: "integration-1",
      providerResourceType: "sheet",
      resourceUrlOrToken: "https://example.feishu.cn/sheets/shtcnLaunch123",
      agentSpaceResourceType: "data_table",
      agentSpaceResourceId: "",
      displayName: "Launch Sheet",
      allowWrite: true,
    });

    expect(mockUpsertFeishuExternalDataTableSync).toHaveBeenCalledWith(expect.objectContaining({
      agentSpaceResourceId: "data-table-existing",
      channelName: "general",
      providerResourceToken: "shtcnLaunch123",
    }), "workspace-1");
    expect(mockUpsertExternalResourceBindingSync).toHaveBeenCalledWith(expect.objectContaining({
      agentSpaceResourceId: "data-table-existing",
      channelName: "general",
      providerResourceToken: "shtcnLaunch123",
    }));
  });

  it("rejects Feishu resource binding before syncing local resources when required scopes are missing", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockReadExternalIntegrationSync.mockReturnValue(buildIntegration({
      scopesJson: JSON.stringify(["im:message"]),
    }));
    mockResolveFeishuResourceDescriptorForType.mockReturnValue({
      providerResourceType: "sheet",
      providerResourceToken: "shtcnLaunch123",
      providerResourceUrl: "https://example.feishu.cn/sheets/shtcnLaunch123",
    });
    mockValidateFeishuResourceBindingScopes.mockReturnValue({
      ok: false,
      errorCode: "feishu.resource_binding_scope_missing",
      errorMessage: "Feishu integration is missing required scopes for sheet binding.",
      missingScopes: ["sheets:spreadsheet"],
      requiredScopes: ["sheets:spreadsheet"],
      availableScopes: ["im:message"],
      data: {},
    });

    await expect(createFeishuResourceBindingAction({
      integrationId: "integration-1",
      providerResourceType: "sheet",
      resourceUrlOrToken: "https://example.feishu.cn/sheets/shtcnLaunch123",
      agentSpaceResourceType: "data_table",
      agentSpaceResourceId: "",
      channelName: "general",
      displayName: "Launch Sheet",
      allowWrite: true,
    })).rejects.toThrow("feishu.resource_binding.scope_missing");

    expect(mockValidateFeishuResourceBindingScopes).toHaveBeenCalledWith({
      providerResourceType: "sheet",
      scopesJson: JSON.stringify(["im:message"]),
    });
    expect(mockUpsertFeishuExternalChannelDocumentSync).not.toHaveBeenCalled();
    expect(mockUpsertFeishuExternalDataTableSync).not.toHaveBeenCalled();
    expect(mockUpsertExternalResourceBindingSync).not.toHaveBeenCalled();
    expect(mockTryRecordWorkspaceAuditEventSync).not.toHaveBeenCalledWith(expect.objectContaining({
      code: "workspace.external_resource_binding_upserted",
    }));
  });

  it("rejects incomplete Base table bindings before syncing local resources", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockReadExternalIntegrationSync.mockReturnValue(buildIntegration());
    mockResolveFeishuResourceDescriptorForType.mockReturnValue({
      providerResourceType: "base_table",
      providerResourceToken: "tblLaunch123",
      metadata: {
        tableId: "tblLaunch123",
      },
    });
    mockValidateFeishuResourceDescriptorForBinding.mockReturnValue({
      ok: false,
      errorCode: "feishu.resource_binding.base_app_token_missing",
      errorMessage: "Feishu Base table/view bindings require a Base app token.",
      data: {
        missing: "appToken",
      },
    });

    await expect(createFeishuResourceBindingAction({
      integrationId: "integration-1",
      providerResourceType: "base_table",
      resourceUrlOrToken: "tblLaunch123",
      agentSpaceResourceType: "data_table",
      agentSpaceResourceId: "",
      channelName: "general",
      displayName: "Launch Base",
      allowWrite: true,
    })).rejects.toThrow("feishu.resource_binding.base_app_token_missing");

    expect(mockValidateFeishuResourceDescriptorForBinding).toHaveBeenCalledWith({
      providerResourceType: "base_table",
      providerResourceToken: "tblLaunch123",
      metadata: {
        tableId: "tblLaunch123",
      },
    });
    expect(mockValidateFeishuResourceBindingScopes).not.toHaveBeenCalled();
    expect(mockUpsertFeishuExternalChannelDocumentSync).not.toHaveBeenCalled();
    expect(mockUpsertFeishuExternalDataTableSync).not.toHaveBeenCalled();
    expect(mockUpsertExternalResourceBindingSync).not.toHaveBeenCalled();
    expect(mockTryRecordWorkspaceAuditEventSync).not.toHaveBeenCalledWith(expect.objectContaining({
      code: "workspace.external_resource_binding_upserted",
    }));
  });

  it("tests Feishu app credentials without persisting secrets", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockCheckFeishuIntegrationHealth.mockResolvedValue({
      status: "healthy",
      checkedAt: "2026-06-24T00:00:00.000Z",
      tenantAccessToken: "tenant-secret-token",
      expireSeconds: 7200,
      botOpenId: "ou_bot",
      botAppName: "AgentSpace Bot",
      scopeReadiness: "verified",
      enabledScopes: ["im:message"],
      missingScopes: [],
    });

    const result = await testFeishuIntegrationConnectionAction({
      appId: " cli_test ",
      appSecret: " secret_test ",
    });

    expect(mockCheckFeishuIntegrationHealth).toHaveBeenCalledWith({
      appId: "cli_test",
      appSecret: "secret_test",
    });
    expect(result).toEqual({
      status: "healthy",
      checkedAt: "2026-06-24T00:00:00.000Z",
      botOpenId: "ou_bot",
      botAppName: "AgentSpace Bot",
      scopeReadiness: "verified",
      requiredScopes: ["im:message"],
      enabledScopes: ["im:message"],
      missingScopes: [],
      scopeErrorMessage: undefined,
      errorCode: undefined,
      errorMessage: undefined,
    });
    expect(JSON.stringify(result)).not.toContain("tenant-secret-token");
    expect(mockCreateExternalIntegrationSync).not.toHaveBeenCalled();
    expect(mockUpdateExternalIntegrationHealthSync).not.toHaveBeenCalled();
    expect(mockTryRecordWorkspaceAuditEventSync).not.toHaveBeenCalled();
  });

  it("returns typed safe errors when Feishu credential testing fails", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockCheckFeishuIntegrationHealth.mockResolvedValue({
      status: "error",
      checkedAt: "2026-06-24T00:01:00.000Z",
      tenantAccessToken: "tenant-secret-token",
      errorMessage: "bad credentials for app_id cli_test app_secret=secret_test Bearer tenant-secret-token",
    });

    const result = await testFeishuIntegrationConnectionAction({
      appId: " cli_test ",
      appSecret: " secret_test ",
    });

    expect(result.status).toBe("error");
    expect(result.scopeReadiness).toBe("unavailable");
    expect(result.errorCode).toBe("feishu.integration.connection_failed");
    expect(result.errorMessage).toContain("[redacted]");
    expect(JSON.stringify(result)).not.toContain("cli_test");
    expect(JSON.stringify(result)).not.toContain("secret_test");
    expect(JSON.stringify(result)).not.toContain("tenant-secret-token");
    expect(mockCreateExternalIntegrationSync).not.toHaveBeenCalled();
    expect(mockUpdateExternalIntegrationHealthSync).not.toHaveBeenCalled();
    expect(mockTryRecordWorkspaceAuditEventSync).not.toHaveBeenCalled();
  });

  it("returns typed safe scope errors when Feishu scope inspection is unauthorized", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockCheckFeishuIntegrationHealth.mockResolvedValue({
      status: "degraded",
      checkedAt: "2026-06-24T00:02:00.000Z",
      tenantAccessToken: "tenant-secret-token",
      botOpenId: "ou_bot",
      botAppName: "AgentSpace Bot",
      scopeReadiness: "unauthorized",
      scopeErrorMessage: "permission denied for app_id cli_test app_secret=secret_test Bearer tenant-secret-token",
      errorMessage: "Feishu app scope check was rejected by Feishu: permission denied for cli_test",
    });

    const result = await testFeishuIntegrationConnectionAction({
      appId: " cli_test ",
      appSecret: " secret_test ",
    });

    expect(result.status).toBe("degraded");
    expect(result.scopeReadiness).toBe("unauthorized");
    expect(result.errorCode).toBe("feishu.integration.scope_unauthorized");
    expect(result.scopeErrorMessage).toContain("[redacted]");
    expect(result.errorMessage).toContain("[redacted]");
    expect(JSON.stringify(result)).not.toContain("cli_test");
    expect(JSON.stringify(result)).not.toContain("secret_test");
    expect(JSON.stringify(result)).not.toContain("tenant-secret-token");
    expect(mockCreateExternalIntegrationSync).not.toHaveBeenCalled();
    expect(mockUpdateExternalIntegrationHealthSync).not.toHaveBeenCalled();
    expect(mockTryRecordWorkspaceAuditEventSync).not.toHaveBeenCalled();
  });

  it("returns typed safe scope errors when Feishu scope inspection needs manual review", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockCheckFeishuIntegrationHealth.mockResolvedValue({
      status: "degraded",
      checkedAt: "2026-06-24T00:02:30.000Z",
      tenantAccessToken: "tenant-secret-token",
      botOpenId: "ou_bot",
      botAppName: "AgentSpace Bot",
      scopeReadiness: "manual_review_required",
      scopeErrorMessage: "scope API unavailable for app_id cli_test app_secret=secret_test Bearer tenant-secret-token",
      errorMessage: "Feishu app scopes could not be verified automatically for cli_test app_secret=secret_test Bearer tenant-secret-token",
    });

    const result = await testFeishuIntegrationConnectionAction({
      appId: " cli_test ",
      appSecret: " secret_test ",
    });

    expect(result.status).toBe("degraded");
    expect(result.scopeReadiness).toBe("manual_review_required");
    expect(result.errorCode).toBe("feishu.integration.scope_manual_review_required");
    expect(result.scopeErrorMessage).toContain("[redacted]");
    expect(result.errorMessage).toContain("[redacted]");
    expect(JSON.stringify(result)).not.toContain("cli_test");
    expect(JSON.stringify(result)).not.toContain("secret_test");
    expect(JSON.stringify(result)).not.toContain("tenant-secret-token");
    expect(mockCreateExternalIntegrationSync).not.toHaveBeenCalled();
    expect(mockUpdateExternalIntegrationHealthSync).not.toHaveBeenCalled();
    expect(mockTryRecordWorkspaceAuditEventSync).not.toHaveBeenCalled();
  });

  it("persists degraded Feishu scope health reasons without leaking secrets", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockReadExternalIntegrationSync.mockReturnValue(buildIntegration({
      appId: "cli_health",
    }));
    mockReadFeishuIntegrationCredentials.mockReturnValue({
      appSecret: "secret_health",
      verificationToken: "verify_health",
    });
    mockCheckFeishuIntegrationHealth.mockResolvedValue({
      status: "degraded",
      checkedAt: "2026-06-24T00:03:00.000Z",
      tenantAccessToken: "tenant-secret-token",
      scopeReadiness: "unauthorized",
      errorMessage: "Feishu app scope check was rejected by Feishu: permission denied for cli_health secret_health Bearer tenant-secret-token",
    });

    await checkFeishuIntegrationHealthAction("integration-1");

    expect(mockUpdateExternalIntegrationHealthSync).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      lastHealthStatus: "degraded",
      lastError: expect.stringContaining("[redacted]"),
    });
    const lastError = mockUpdateExternalIntegrationHealthSync.mock.calls[0]?.[0]?.lastError as string;
    expect(lastError).toContain("permission denied");
    expect(lastError).not.toContain("cli_health");
    expect(lastError).not.toContain("secret_health");
    expect(lastError).not.toContain("tenant-secret-token");
  });

  it("returns a stable error code when health checks cannot decrypt stored Feishu credentials", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockReadExternalIntegrationSync.mockReturnValue(buildIntegration({
      appId: "cli_health",
    }));
    mockReadFeishuIntegrationCredentials.mockImplementation(() => {
      throw new Error("AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY is required to store Feishu credentials.");
    });

    await expect(checkFeishuIntegrationHealthAction("integration-1"))
      .rejects.toThrow("feishu.integration.credential_encryption_key_missing");

    expect(mockCheckFeishuIntegrationHealth).not.toHaveBeenCalled();
    expect(mockUpdateExternalIntegrationHealthSync).not.toHaveBeenCalled();
    expect(mockTryRecordWorkspaceAuditEventSync).not.toHaveBeenCalled();
  });

  it("stores encrypted credentials and keeps Feishu create audit data secret-free", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockBuildEncryptedFeishuCredentials.mockReturnValue({
      appSecret: "v1:app-secret-ciphertext",
      verificationToken: "v1:verification-token-ciphertext",
      encryptKey: "v1:encrypt-key-ciphertext",
    });
    mockCreateExternalIntegrationSync.mockReturnValue(buildIntegration({
      id: "integration-created",
      encryptedCredentialsJson: JSON.stringify({
        appSecret: "v1:app-secret-ciphertext",
        verificationToken: "v1:verification-token-ciphertext",
        encryptKey: "v1:encrypt-key-ciphertext",
      }),
    }));
    mockListFeishuIntegrationSettingsItems.mockReturnValue([
      buildSettingsItem({ id: "integration-created" }),
    ]);

    const result = await createFeishuIntegrationAction({
      displayName: "Feishu",
      transportMode: "http_webhook",
      appId: " cli_create ",
      appSecret: " raw-app-secret ",
      verificationToken: " raw-verification-token ",
      encryptKey: " raw-encrypt-key ",
      tenantKey: " tenant-create ",
    });

    expect(mockBuildEncryptedFeishuCredentials).toHaveBeenCalledWith({
      appSecret: "raw-app-secret",
      verificationToken: "raw-verification-token",
      encryptKey: "raw-encrypt-key",
    });
    expect(mockCreateExternalIntegrationSync).toHaveBeenCalledWith(expect.objectContaining({
      appId: "cli_create",
      tenantKey: "tenant-create",
      encryptedCredentialsJson: {
        appSecret: "v1:app-secret-ciphertext",
        verificationToken: "v1:verification-token-ciphertext",
        encryptKey: "v1:encrypt-key-ciphertext",
      },
    }));
    expectNoFeishuSecretLeak(mockCreateExternalIntegrationSync.mock.calls[0]?.[0]);
    expectNoFeishuSecretLeak(mockTryRecordWorkspaceAuditEventSync.mock.calls[0]?.[0]);
    expectNoFeishuSecretLeak(result);
  });

  it("creates agent bot bindings through the Feishu service without leaking secrets", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockCreateFeishuAgentBotBindingSync.mockReturnValue(buildIntegration({
      id: "agent-bot-codex",
      displayName: "Codex Feishu Bot",
      transportMode: "websocket_worker",
      agentId: "Codex",
      appId: "cli_codex_bot",
      encryptedCredentialsJson: JSON.stringify({
        appSecret: "v1:app-secret-ciphertext",
      }),
    }));
    mockListFeishuIntegrationSettingsItems.mockReturnValue([
      buildSettingsItem({
        id: "agent-bot-codex",
        agentId: "Codex",
      }),
    ]);

    const result = await createFeishuAgentBotBindingAction({
      agentId: " Codex ",
      displayName: "",
      transportMode: "websocket_worker",
      appId: " cli_codex_bot ",
      appSecret: " raw-agent-secret ",
      verificationToken: "",
      encryptKey: "",
      tenantKey: "",
      channelAutoProvisioning: {
        botAdded: "pending_admin_review",
        firstMessage: "reply_with_setup_card",
        reviewStatus: "pending_admin_review",
      },
      externalGuestPolicy: {
        unboundUserMode: "require_identity",
        guestPermissionProfile: "none",
        requireIdentityFor: ["writes", "approvals"],
      },
    });

    expect(mockCreateFeishuAgentBotBindingSync).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      agentId: " Codex ",
      appId: " cli_codex_bot ",
      appSecret: " raw-agent-secret ",
      transportMode: "websocket_worker",
      channelAutoProvisioning: {
        botAdded: "pending_admin_review",
        firstMessage: "reply_with_setup_card",
        reviewStatus: "pending_admin_review",
      },
      externalGuestPolicy: {
        unboundUserMode: "require_identity",
        guestPermissionProfile: "none",
        requireIdentityFor: ["writes", "approvals"],
      },
      createdByUserId: "admin-1",
    }));
    expectNoFeishuSecretLeak(mockTryRecordWorkspaceAuditEventSync.mock.calls[0]?.[0]);
    expectNoFeishuSecretLeak(result);
  });

  it("rotates agent bot credentials through the Feishu service", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockRotateFeishuAgentBotCredentialsSync.mockReturnValue(buildIntegration({
      id: "agent-bot-codex",
      displayName: "Codex Feishu Bot",
      transportMode: "websocket_worker",
      agentId: "Codex",
      appId: "cli_codex_bot",
      encryptedCredentialsJson: JSON.stringify({
        appSecret: "v1:rotated-app-secret-ciphertext",
      }),
    }));
    mockListFeishuIntegrationSettingsItems.mockReturnValue([
      buildSettingsItem({
        id: "agent-bot-codex",
        agentId: "Codex",
      }),
    ]);

    await rotateFeishuAgentBotCredentialsAction({
      integrationId: "agent-bot-codex",
      appSecret: "raw-rotated-secret",
    });

    expect(mockRotateFeishuAgentBotCredentialsSync).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      integrationId: "agent-bot-codex",
      appSecret: "raw-rotated-secret",
      updatedByUserId: "admin-1",
    }));
    expectNoFeishuSecretLeak(mockTryRecordWorkspaceAuditEventSync.mock.calls[0]?.[0]);
  });

  it("allows WebSocket worker integrations to start with only App ID and App Secret", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockBuildEncryptedFeishuCredentials.mockReturnValue({
      appSecret: "v1:app-secret-ciphertext",
    });
    mockCreateExternalIntegrationSync.mockReturnValue(buildIntegration({
      id: "integration-websocket",
      transportMode: "websocket_worker",
      encryptedCredentialsJson: JSON.stringify({
        appSecret: "v1:app-secret-ciphertext",
      }),
    }));
    mockListFeishuIntegrationSettingsItems.mockReturnValue([
      buildSettingsItem({
        id: "integration-websocket",
        transportMode: "websocket_worker",
      }),
    ]);

    await createFeishuIntegrationAction({
      displayName: "Feishu",
      transportMode: "websocket_worker",
      appId: "cli_ws",
      appSecret: "secret",
    });

    expect(mockBuildEncryptedFeishuCredentials).toHaveBeenCalledWith({
      appSecret: "secret",
      verificationToken: "",
      encryptKey: undefined,
    });
    expect(mockCreateExternalIntegrationSync).toHaveBeenCalledWith(expect.objectContaining({
      appId: "cli_ws",
      transportMode: "websocket_worker",
      encryptedCredentialsJson: {
        appSecret: "v1:app-secret-ciphertext",
      },
    }));
  });

  it("keeps Verification Token required for EventCallback integrations", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));

    await expect(createFeishuIntegrationAction({
      displayName: "Feishu",
      transportMode: "http_webhook",
      appId: "cli_callback",
      appSecret: "secret",
    })).rejects.toThrow("feishu.integration.missing_verification_token");

    expect(mockBuildEncryptedFeishuCredentials).not.toHaveBeenCalled();
    expect(mockCreateExternalIntegrationSync).not.toHaveBeenCalled();
  });

  it("stores encrypted rotated credentials and keeps rotation audit data secret-free", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockBuildEncryptedFeishuCredentials.mockReturnValue({
      appSecret: "v1:ciphertext-rotated-app",
      verificationToken: "v1:ciphertext-rotated-verification",
      encryptKey: "v1:ciphertext-rotated-encrypt",
    });
    mockReadExternalIntegrationSync.mockReturnValue(buildIntegration({
      id: "integration-rotate",
      appId: "cli_old",
      tenantKey: "tenant-old",
    }));
    mockUpdateExternalIntegrationCredentialsSync.mockReturnValue(buildIntegration({
      id: "integration-rotate",
      appId: "cli_rotated",
      tenantKey: "tenant-rotated",
      encryptedCredentialsJson: JSON.stringify({
        appSecret: "v1:ciphertext-rotated-app",
        verificationToken: "v1:ciphertext-rotated-verification",
        encryptKey: "v1:ciphertext-rotated-encrypt",
      }),
    }));
    mockListFeishuIntegrationSettingsItems.mockReturnValue([
      buildSettingsItem({ id: "integration-rotate" }),
    ]);

    const result = await rotateFeishuIntegrationSecretAction({
      integrationId: "integration-rotate",
      appId: " cli_rotated ",
      appSecret: " rotated-app-secret ",
      verificationToken: " rotated-verification-token ",
      encryptKey: " rotated-encrypt-key ",
      tenantKey: " tenant-rotated ",
    });

    expect(mockBuildEncryptedFeishuCredentials).toHaveBeenCalledWith({
      appSecret: "rotated-app-secret",
      verificationToken: "rotated-verification-token",
      encryptKey: "rotated-encrypt-key",
    });
    expect(mockUpdateExternalIntegrationCredentialsSync).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      integrationId: "integration-rotate",
      appId: "cli_rotated",
      tenantKey: "tenant-rotated",
      encryptedCredentialsJson: {
        appSecret: "v1:ciphertext-rotated-app",
        verificationToken: "v1:ciphertext-rotated-verification",
        encryptKey: "v1:ciphertext-rotated-encrypt",
      },
      updatedByUserId: "admin-1",
    });
    expectNoFeishuSecretLeak(mockUpdateExternalIntegrationCredentialsSync.mock.calls[0]?.[0]);
    expectNoFeishuSecretLeak(mockTryRecordWorkspaceAuditEventSync.mock.calls[0]?.[0]);
    expectNoFeishuSecretLeak(result);
  });

  it("allows WebSocket worker credential rotation without a Verification Token", async () => {
    mockRequireCurrentWorkspaceContext.mockResolvedValue(buildWorkspaceContext("admin", "admin-1"));
    mockBuildEncryptedFeishuCredentials.mockReturnValue({
      appSecret: "v1:ciphertext-rotated-app",
    });
    mockReadExternalIntegrationSync.mockReturnValue(buildIntegration({
      id: "integration-rotate-websocket",
      transportMode: "websocket_worker",
      appId: "cli_old",
      tenantKey: undefined,
    }));
    mockUpdateExternalIntegrationCredentialsSync.mockReturnValue(buildIntegration({
      id: "integration-rotate-websocket",
      transportMode: "websocket_worker",
      appId: "cli_ws_rotated",
      encryptedCredentialsJson: JSON.stringify({
        appSecret: "v1:ciphertext-rotated-app",
      }),
    }));
    mockListFeishuIntegrationSettingsItems.mockReturnValue([
      buildSettingsItem({
        id: "integration-rotate-websocket",
        transportMode: "websocket_worker",
      }),
    ]);

    await rotateFeishuIntegrationSecretAction({
      integrationId: "integration-rotate-websocket",
      appId: "cli_ws_rotated",
      appSecret: "rotated-secret",
    });

    expect(mockBuildEncryptedFeishuCredentials).toHaveBeenCalledWith({
      appSecret: "rotated-secret",
      verificationToken: "",
      encryptKey: undefined,
    });
    expect(mockUpdateExternalIntegrationCredentialsSync).toHaveBeenCalledWith(expect.objectContaining({
      integrationId: "integration-rotate-websocket",
      appId: "cli_ws_rotated",
      encryptedCredentialsJson: {
        appSecret: "v1:ciphertext-rotated-app",
      },
    }));
  });
});

function expectNoFeishuSecretLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain("raw-app-secret");
  expect(serialized).not.toContain("raw-verification-token");
  expect(serialized).not.toContain("raw-encrypt-key");
  expect(serialized).not.toContain("rotated-app-secret");
  expect(serialized).not.toContain("rotated-verification-token");
  expect(serialized).not.toContain("rotated-encrypt-key");
  expect(serialized).not.toContain("tenant-secret-token");
}

function buildWorkspaceContext(role: "owner" | "admin" | "member", userId: string) {
  return {
    currentWorkspace: {
      id: "workspace-1",
      slug: "workspace-1",
      name: "Workspace 1",
      createdBy: "system",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
    },
    currentUser: {
      id: userId,
      displayName: "Member One",
      primaryEmail: "member@example.com",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
    },
    currentMembership: buildMembership(role, userId),
  };
}

function buildMembership(role: "owner" | "admin" | "member", userId: string) {
  return {
    id: `membership-${userId}`,
    workspaceId: "workspace-1",
    userId,
    role,
    status: "active",
    joinedAt: "2026-06-24T00:00:00.000Z",
  };
}

function buildIntegration(overrides: Record<string, unknown> = {}) {
  return {
    id: "integration-1",
    workspaceId: "workspace-1",
    provider: "feishu",
    displayName: "Feishu",
    status: "active",
    transportMode: "http_webhook",
    appId: "cli_a",
    tenantKey: "tenant-1",
    encryptedCredentialsJson: "{}",
    configJson: {},
    capabilitiesJson: {},
    scopesJson: [],
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    ...overrides,
  };
}

function buildUserBinding(
  userId: string,
  status: "active" | "disabled" | "archived" = "active",
  integrationId = "integration-1",
) {
  return {
    id: "binding-1",
    workspaceId: "workspace-1",
    integrationId,
    userId,
    externalUserId: `ou_${userId}`,
    status,
    metadataJson: {},
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
  };
}

function buildSettingsItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "integration-1",
    displayName: "Feishu",
    status: "active",
    transportMode: "http_webhook",
    appId: "cli_a",
    callbackUrl: "",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    hasAppSecret: true,
    hasVerificationToken: true,
    hasEncryptKey: true,
    userBindingCount: 1,
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
