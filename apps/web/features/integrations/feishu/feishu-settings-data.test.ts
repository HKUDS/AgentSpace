import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockListActiveEmployeesSync,
  mockListExternalChannelBindingsSync,
  mockListExternalDataOperationRunsSync,
  mockListExternalIntegrationEventsSync,
  mockListExternalIntegrationsSync,
  mockListExternalMessageOutboxSync,
  mockListExternalResourceBindingsSync,
  mockListExternalUserBindingsSync,
  mockListStoredChannelsSync,
  mockListWorkspaceMemberUsersSync,
} = vi.hoisted(() => ({
  mockListActiveEmployeesSync: vi.fn(),
  mockListExternalChannelBindingsSync: vi.fn(),
  mockListExternalDataOperationRunsSync: vi.fn(),
  mockListExternalIntegrationEventsSync: vi.fn(),
  mockListExternalIntegrationsSync: vi.fn(),
  mockListExternalMessageOutboxSync: vi.fn(),
  mockListExternalResourceBindingsSync: vi.fn(),
  mockListExternalUserBindingsSync: vi.fn(),
  mockListStoredChannelsSync: vi.fn(),
  mockListWorkspaceMemberUsersSync: vi.fn(),
}));

vi.mock("@agent-space/db", () => ({
  listExternalChannelBindingsSync: mockListExternalChannelBindingsSync,
  listExternalDataOperationRunsSync: mockListExternalDataOperationRunsSync,
  listExternalIntegrationEventsSync: mockListExternalIntegrationEventsSync,
  listExternalIntegrationsSync: mockListExternalIntegrationsSync,
  listExternalMessageOutboxSync: mockListExternalMessageOutboxSync,
  listExternalResourceBindingsSync: mockListExternalResourceBindingsSync,
  listExternalUserBindingsSync: mockListExternalUserBindingsSync,
  listStoredChannelsSync: mockListStoredChannelsSync,
  listWorkspaceMemberUsersSync: mockListWorkspaceMemberUsersSync,
}));

vi.mock("@agent-space/services", () => ({
  FEISHU_DEFAULT_SCOPES: [
    "im:message",
    "im:message:send_as_bot",
    "contact:user.base:readonly",
    "docx:document",
    "drive:drive",
    "sheets:spreadsheet",
    "bitable:app",
  ],
  FEISHU_EVENT_CALLBACK_PATH: "/api/integrations/feishu/events",
  FEISHU_FINAL_EVIDENCE_GATE_REQUIREMENTS: {
    botReply: "processed_inbound + correlated_reply_mapping",
    workerRestart: "two_correlated_websocket_replies",
    workerCardAction: "processed_approval_card_action",
    dataPlane: "doc_read + agent_runtime_doc_read_from_lark_cli_manifest + approved_doc_write + sheet_read + approved_sheet_write_with_agentspace_sync + base_read + approved_base_mutation_with_agentspace_sync",
    failureVisibility: "provider_failure_row + degraded_or_error_health",
  },
  FEISHU_OPEN_PLATFORM_CONSOLE_URLS: {
    appList: "https://open.feishu.cn/app",
  },
  FEISHU_OPEN_PLATFORM_SETUP_STEPS: [
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
  ],
  FEISHU_PROVIDER_ID: "feishu",
  FEISHU_REQUIRED_CREDENTIAL_FIELDS: ["app_id", "app_secret", "verification_token", "encrypt_key"],
  FEISHU_REQUIRED_EVENTS: ["im.message.receive_v1", "card.action.trigger"],
  listActiveEmployeesSync: mockListActiveEmployeesSync,
  sanitizeFeishuOperationResponseSummary: (summary: Record<string, unknown> | undefined) => summary,
  summarizeFeishuStoredCredentials: () => ({
    hasAppSecret: true,
    hasEncryptKey: true,
    hasVerificationToken: true,
  }),
}));

vi.mock("@/features/auth/public-app-url", () => ({
  buildPublicAppUrl: (path: string, appUrl?: string) => `${appUrl ?? ""}${path}`,
}));

vi.mock("@/features/auth/workspace-permissions", () => ({
  hasWorkspaceRole: (
    role: "owner" | "admin" | "member",
    minimumRole: "owner" | "admin" | "member",
  ) => {
    const rank = { member: 0, admin: 1, owner: 2 };
    return rank[role] >= rank[minimumRole];
  },
}));

import {
  buildFeishuIntegrationCreationGuide,
  listFeishuAvailableAgents,
  listFeishuIntegrationSettingsItems,
} from "./feishu-settings-data";

describe("Feishu settings data", () => {
  beforeEach(() => {
    mockListActiveEmployeesSync.mockReset();
    mockListExternalChannelBindingsSync.mockReset();
    mockListExternalDataOperationRunsSync.mockReset();
    mockListExternalIntegrationEventsSync.mockReset();
    mockListExternalIntegrationsSync.mockReset();
    mockListExternalMessageOutboxSync.mockReset();
    mockListExternalResourceBindingsSync.mockReset();
    mockListExternalUserBindingsSync.mockReset();
    mockListStoredChannelsSync.mockReset();
    mockListWorkspaceMemberUsersSync.mockReset();

    mockListExternalIntegrationsSync.mockReturnValue([buildIntegration()]);
    mockListActiveEmployeesSync.mockReturnValue([]);
    mockListExternalUserBindingsSync.mockReturnValue([
      buildUserBinding("binding-1", "user-1", "ou_mina"),
      buildUserBinding("binding-2", "user-2", "ou_alex"),
    ]);
    mockListExternalChannelBindingsSync.mockReturnValue([
      {
        id: "channel-binding-1",
        integrationId: "feishu-1",
        channelName: "general",
        externalChatId: "oc_general",
        status: "active",
        syncMode: "mirror",
        createdAt: "2026-06-24T00:00:00.000Z",
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    ]);
    mockListExternalResourceBindingsSync.mockReturnValue([]);
    mockListExternalDataOperationRunsSync.mockReturnValue([]);
    mockListExternalIntegrationEventsSync.mockReturnValue([
      {
        id: "event-1",
        integrationId: "feishu-1",
        externalEventId: "evt-1",
        eventType: "im.message.receive_v1",
        status: "ignored",
        errorMessage: "external_user_unbound",
        payloadJson: JSON.stringify({
          message: {
            chatId: "oc_launch",
            contentHash: "hash-only",
          },
          sender: {
            openId: "ou_new_user",
            unionId: "on_new_user",
            userId: "feishu_user_1",
          },
        }),
        receivedAt: "2026-06-24T00:00:00.000Z",
        processedAt: "2026-06-24T00:00:01.000Z",
      },
      {
        id: "event-2",
        integrationId: "feishu-1",
        externalEventId: "evt-2",
        eventType: "im.message.receive_v1",
        status: "ignored",
        errorMessage: "external_channel_unbound",
        payloadJson: JSON.stringify({
          message: {
            chatId: "oc_new_chat",
            contentHash: "hash-only",
          },
          sender: {
            openId: "ou_existing_user",
          },
        }),
        receivedAt: "2026-06-24T00:00:02.000Z",
        processedAt: "2026-06-24T00:00:03.000Z",
      },
    ]);
    mockListExternalMessageOutboxSync.mockReturnValue([]);
  });

  it("filters Feishu integration settings down to self-service identity data for members", () => {
    const [item] = listFeishuIntegrationSettingsItems({
      workspaceId: "workspace-1",
      appUrl: "https://agent.test",
      viewer: {
        role: "member",
        userId: "user-1",
      },
    });

    expect(item?.userBindings.map((binding) => binding.userId)).toEqual(["user-1"]);
    expect(item?.channelBindings).toEqual([]);
    expect(item?.resourceBindings).toEqual([]);
    expect(item?.operationRuns).toEqual([]);
    expect(item?.recentOutboxFailures).toEqual([]);
    expect(item?.recentInboundEvents).toEqual([]);
    expect(item?.appId).toBeUndefined();
    expect(item?.tenantKey).toBeUndefined();
    expect(item?.callbackUrl).toBe("");
    expect(item?.setupGuide).toBeUndefined();
    expect(item?.hasAppSecret).toBe(false);
    expect(JSON.stringify(item)).not.toContain("encrypted-secret-marker");
    expect(mockListExternalChannelBindingsSync).not.toHaveBeenCalled();
    expect(mockListExternalIntegrationEventsSync).not.toHaveBeenCalled();
    expect(mockListExternalMessageOutboxSync).not.toHaveBeenCalled();
  });

  it("builds the create-integration guide from shared Feishu setup constants", () => {
    expect(buildFeishuIntegrationCreationGuide({
      workspaceId: "workspace-1",
      appUrl: "https://agent.test",
    })).toEqual({
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
      openPlatformSetupSteps: [
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
      ],
    });
  });

  it("marks the create-integration callback template as missing when public app URL is unavailable", () => {
    expect(buildFeishuIntegrationCreationGuide({
      workspaceId: "workspace-1",
    })).toMatchObject({
      eventCallbackPath: "/api/integrations/feishu/events",
      publicAppUrlStatus: "missing",
      callbackUrlTemplate: "/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=created-integration-id",
    });
  });

  it("uses shell-safe public URL placeholders in settings setup commands", () => {
    const [item] = listFeishuIntegrationSettingsItems({
      workspaceId: "workspace-1",
      viewer: {
        role: "admin",
        userId: "admin-1",
      },
    });

    expect(item?.setupGuide?.commands.smokeEnv).toBe(
      "agent-space integrations feishu smoke-env --workspace-id workspace-1 --integration feishu-1 --app-url CHANGE_ME_PUBLIC_AGENTSPACE_URL > scripts/feishu/.env",
    );
    expect(item?.setupGuide?.commands.smokePlan).toBe(
      "agent-space integrations feishu smoke-plan --workspace-id workspace-1 --integration feishu-1 --app-url CHANGE_ME_PUBLIC_AGENTSPACE_URL --json",
    );
    expect(JSON.stringify(item?.setupGuide?.commands)).not.toContain("<public-url>");
  });

  it("keeps full Feishu settings data for admins", () => {
    mockListExternalMessageOutboxSync.mockImplementation((input: { status?: string }) => {
      if (input.status !== "failed") {
        return [];
      }
      return [
        {
          id: "outbox-1",
          integrationId: "feishu-1",
          channelBindingId: "channel-binding-1",
          targetExternalChatId: "oc_general",
          targetExternalThreadId: "om_thread_1",
          agentSpaceMessageId: "message-1",
          status: "failed",
          attempts: 3,
          lastError: "feishu.outbound.network_unreachable",
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:01:00.000Z",
        },
      ];
    });

    const [item] = listFeishuIntegrationSettingsItems({
      workspaceId: "workspace-1",
      appUrl: "https://agent.test",
      viewer: {
        role: "admin",
        userId: "admin-1",
      },
    });

    expect(item?.userBindings.map((binding) => ({
      userId: binding.userId,
      externalUserReference: binding.externalUserReference,
      externalUserIdRedacted: binding.externalUserIdRedacted,
    }))).toEqual([
      {
        userId: "user-1",
        externalUserReference: "user 7cefd02d",
        externalUserIdRedacted: true,
      },
      {
        userId: "user-2",
        externalUserReference: "user f9ad891a",
        externalUserIdRedacted: true,
      },
    ]);
    expect(item?.channelBindings.map((binding) => ({
      channelName: binding.channelName,
      externalChatReference: binding.externalChatReference,
      externalChatIdRedacted: binding.externalChatIdRedacted,
    }))).toEqual([
      {
        channelName: "general",
        externalChatReference: "chat b2295ba0",
        externalChatIdRedacted: true,
      },
    ]);
    expect(item?.recentOutboxFailures).toEqual([
      {
        id: "outbox-1",
        integrationId: "feishu-1",
        channelBindingId: "channel-binding-1",
        targetExternalChatReference: "chat b2295ba0",
        targetExternalChatIdRedacted: true,
        targetExternalThreadReference: "thread 296234ee",
        targetExternalThreadIdRedacted: true,
        agentSpaceMessageId: "message-1",
        status: "failed",
        attempts: 3,
        lastError: "feishu.outbound.network_unreachable",
        createdAt: "2026-06-24T00:00:00.000Z",
        updatedAt: "2026-06-24T00:01:00.000Z",
      },
    ]);
    expect(item?.appId).toBe("cli_a");
    expect(item?.tenantKey).toBe("tenant-1");
    expect(item?.callbackUrl).toContain("/api/integrations/feishu/events");
    expect(item?.hasAppSecret).toBe(true);
    expect(item?.setupGuide).toEqual({
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
      developerConsoleUrl: "https://open.feishu.cn/app",
      openPlatformSetupSteps: [
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
      ],
      checks: [
        {
          key: "credentials",
          status: "ready",
          current: "complete",
          required: "app_id/app_secret/verification_token/encrypt_key",
        },
        {
          key: "callback_or_worker",
          status: "ready",
          current: "public_callback",
          required: "https_callback_or_websocket_worker",
        },
        {
          key: "health",
          status: "missing",
          current: "unknown",
          required: "healthy",
        },
        {
          key: "chat_binding",
          status: "ready",
          current: 1,
          required: 1,
        },
        {
          key: "user_binding",
          status: "ready",
          current: 2,
          required: 1,
        },
        {
          key: "doc_binding",
          status: "missing",
          current: 0,
          required: "1 writable binding",
        },
        {
          key: "sheet_binding",
          status: "missing",
          current: 0,
          required: "1 writable binding",
        },
        {
          key: "base_binding",
          status: "missing",
          current: 0,
          required: 1,
        },
        {
          key: "outbox",
          status: "attention",
          current: 1,
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
    });
    expect(JSON.stringify(item)).not.toContain("encrypted-secret-marker");
    expect(JSON.stringify(item)).not.toContain("summarize confidential text");
    expect(JSON.stringify(item)).not.toContain("ou_mina");
    expect(JSON.stringify(item)).not.toContain("ou_alex");
    expect(JSON.stringify(item)).not.toContain("oc_general");
    expect(JSON.stringify(item)).not.toContain("om_thread_1");
    expect(item?.recentInboundEvents).toEqual([
      {
        id: "event-1",
        integrationId: "feishu-1",
        externalEventId: "evt-1",
        eventType: "im.message.receive_v1",
        status: "ignored",
        errorMessage: "external_user_unbound",
        bindingSuggestion: {
          kind: "user",
          externalUserId: "ou_new_user",
          externalUnionId: "on_new_user",
          externalOpenId: "feishu_user_1",
        },
        receivedAt: "2026-06-24T00:00:00.000Z",
        processedAt: "2026-06-24T00:00:01.000Z",
      },
      {
        id: "event-2",
        integrationId: "feishu-1",
        externalEventId: "evt-2",
        eventType: "im.message.receive_v1",
        status: "ignored",
        errorMessage: "external_channel_unbound",
        bindingSuggestion: {
          kind: "channel",
          externalChatId: "oc_new_chat",
        },
        receivedAt: "2026-06-24T00:00:02.000Z",
        processedAt: "2026-06-24T00:00:03.000Z",
      },
    ]);
  });

  it("derives Feishu resource write grants without exposing permissions JSON", () => {
    mockListExternalResourceBindingsSync.mockReturnValue([
      buildResourceBinding({
        id: "resource-binding-read",
        providerResourceType: "doc",
        providerResourceToken: "doccnRead",
        permissionsJson: "{}",
      }),
      buildResourceBinding({
        id: "resource-binding-write",
        providerResourceType: "sheet",
        providerResourceToken: "shtcnWrite",
        permissionsJson: JSON.stringify({ canRead: true, canWrite: true, externalGuestReadable: true }),
      }),
    ]);

    const [item] = listFeishuIntegrationSettingsItems({
      workspaceId: "workspace-1",
      appUrl: "https://agent.test",
      viewer: {
        role: "admin",
        userId: "admin-1",
      },
    });

    expect(item?.resourceBindings.map((binding) => ({
      id: binding.id,
      providerResourceReference: binding.providerResourceReference,
      providerResourceTokenRedacted: binding.providerResourceTokenRedacted,
      canWrite: binding.canWrite,
      guestReadable: binding.guestReadable,
    }))).toEqual([
      {
        id: "resource-binding-read",
        providerResourceReference: "doc / resource 5785f798",
        providerResourceTokenRedacted: true,
        canWrite: false,
        guestReadable: false,
      },
      {
        id: "resource-binding-write",
        providerResourceReference: "sheet / resource d63d785e",
        providerResourceTokenRedacted: true,
        canWrite: true,
        guestReadable: true,
      },
    ]);
    expect(JSON.stringify(item)).not.toContain("permissionsJson");
    expect(JSON.stringify(item)).not.toContain("doccnRead");
    expect(JSON.stringify(item)).not.toContain("shtcnWrite");
  });

  it("surfaces Feishu data-operation governance actor context without raw external ids", () => {
    mockListExternalDataOperationRunsSync.mockReturnValue([
      buildDataOperationRun({
        requestJson: JSON.stringify({
          policyDecision: "deny",
          governanceContext: {
            provider: "feishu",
            actorType: "external_guest",
            agentId: "Atlas",
            botBindingId: "feishu-1",
            channelName: "general",
            externalActorReference: "guest-ref-abc123",
            externalGuestPermissionProfile: "channel_context_only",
          },
        }),
      }),
    ]);

    const [item] = listFeishuIntegrationSettingsItems({
      workspaceId: "workspace-1",
      appUrl: "https://agent.test",
      viewer: {
        role: "admin",
        userId: "admin-1",
      },
    });

    expect(item?.operationRuns[0]?.governanceContext).toEqual({
      provider: "feishu",
      actorType: "external_guest",
      agentId: "Atlas",
      botBindingId: "feishu-1",
      channelName: "general",
      externalActorReference: "guest-ref-abc123",
      externalGuestPermissionProfile: "channel_context_only",
    });
    expect(JSON.stringify(item)).not.toContain("ou_guest_raw");
  });

  it("marks Base table setup readiness as attention when app token metadata is missing", () => {
    mockListExternalResourceBindingsSync.mockReturnValue([
      buildResourceBinding({
        id: "resource-binding-doc",
        providerResourceType: "doc",
        providerResourceToken: "doccnReady",
        permissionsJson: "{}",
      }),
      buildResourceBinding({
        id: "resource-binding-sheet",
        providerResourceType: "sheet",
        providerResourceToken: "shtcnReady",
        permissionsJson: "{}",
      }),
      buildResourceBinding({
        id: "resource-binding-base",
        providerResourceType: "base_table",
        providerResourceToken: "tblSecret",
        permissionsJson: JSON.stringify({ canRead: true, canWrite: true }),
        metadataJson: "{}",
      }),
    ]);

    const [item] = listFeishuIntegrationSettingsItems({
      workspaceId: "workspace-1",
      appUrl: "https://agent.test",
      viewer: {
        role: "admin",
        userId: "admin-1",
      },
    });

    const baseCheck = item?.setupGuide?.checks.find((check) => check.key === "base_binding");
    expect(baseCheck).toEqual({
      key: "base_binding",
      status: "attention",
      current: "0/1",
      required: "1 data-plane-ready Base binding",
    });
    expect(JSON.stringify(item)).not.toContain("tblSecret");
  });

  it("adds worker approval card evidence gate for websocket integrations", () => {
    mockListExternalIntegrationsSync.mockReturnValue([
      {
        ...buildIntegration(),
        transportMode: "websocket_worker",
      },
    ]);

    const [item] = listFeishuIntegrationSettingsItems({
      workspaceId: "workspace-1",
      appUrl: "https://agent.test",
      viewer: {
        role: "admin",
        userId: "admin-1",
      },
    });

    expect(item?.setupGuide?.evidenceGates).toEqual(expect.arrayContaining([
      {
        key: "worker_restart",
        required: "two_correlated_websocket_replies",
      },
      {
        key: "worker_card_action",
        required: "processed_approval_card_action",
      },
    ]));
  });

  it("lists active AgentSpace agents for Feishu bot binding forms", () => {
    mockListActiveEmployeesSync.mockReturnValue([
      {
        name: "Codex",
        role: "Engineer",
        remarkName: "code",
      },
      {
        name: "HermesAgent",
        role: "Researcher",
      },
    ]);

    expect(listFeishuAvailableAgents({ workspaceId: "workspace-1" })).toEqual([
      {
        id: "Codex",
        name: "Codex",
        role: "Engineer",
        remarkName: "code",
      },
      {
        id: "HermesAgent",
        name: "HermesAgent",
        role: "Researcher",
        remarkName: undefined,
      },
    ]);
  });
});

function buildIntegration() {
  return {
    id: "feishu-1",
    workspaceId: "workspace-1",
    provider: "feishu",
    displayName: "Feishu",
    status: "active",
    transportMode: "http_webhook",
    appId: "cli_a",
    tenantKey: "tenant-1",
    encryptedCredentialsJson: JSON.stringify({
      appSecret: "encrypted-secret-marker",
      verificationToken: "encrypted-verification-marker",
      encryptKey: "encrypted-key-marker",
    }),
    configJson: {},
    capabilitiesJson: {},
    scopesJson: [],
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
  };
}

function buildUserBinding(id: string, userId: string, externalUserId: string) {
  return {
    id,
    workspaceId: "workspace-1",
    integrationId: "feishu-1",
    userId,
    externalUserId,
    status: "active",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
  };
}

function buildResourceBinding(input: {
  id: string;
  providerResourceType: string;
  providerResourceToken: string;
  permissionsJson: string;
  metadataJson?: string;
}) {
  return {
    id: input.id,
    workspaceId: "workspace-1",
    integrationId: "feishu-1",
    providerResourceType: input.providerResourceType,
    providerResourceToken: input.providerResourceToken,
    providerResourceUrl: undefined,
    agentSpaceResourceType: input.providerResourceType === "doc" ? "channel_document" : "data_table",
    agentSpaceResourceId: input.providerResourceType === "doc" ? "doc-1" : "table-1",
    channelName: "general",
    displayName: undefined,
    status: "active",
    permissionsJson: input.permissionsJson,
    metadataJson: input.metadataJson ?? "{}",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
  };
}

function buildDataOperationRun(input: {
  requestJson?: string;
  resultJson?: string;
} = {}) {
  return {
    id: "operation-run-1",
    workspaceId: "workspace-1",
    integrationId: "feishu-1",
    resourceBindingId: "resource-binding-1",
    operationType: "sheets.update_range",
    providerResourceType: "sheet",
    providerResourceToken: "shtcnSecretRun",
    actorType: "agent",
    actorId: "Atlas",
    status: "failed",
    requestJson: input.requestJson ?? "{}",
    resultJson: input.resultJson ?? "{}",
    errorCode: "feishu.data_operation_external_guest_requires_identity",
    errorMessage: "External guests must bind an AgentSpace identity before writing Feishu resources.",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
  };
}
