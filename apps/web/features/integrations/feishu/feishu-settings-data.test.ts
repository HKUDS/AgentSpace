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
  FEISHU_AGENT_BOT_REQUIRED_CREDENTIAL_FIELDS: ["app_id", "app_secret"],
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
    nativeAgentBot: "agent_bot_route + bound_user_bot_mention + external_guest_bot_mention + bot_added_auto_provision + first_message_auto_provision + multi_agent_channel_reuse + thread_task_binding + thread_continuation + thread_collaboration + bot_sender_loop_guard + agent_channel_policy_denial_without_reply",
    guestPolicy: "external_guest_allow + external_guest_reply_all + external_guest_require_identity + external_guest_ignore + external_guest_mention_required",
    workerRestart: "two_correlated_websocket_replies",
    workerCardAction: "processed_approval_card_action",
    dataPlane: "doc_read + agent_runtime_doc_read_from_lark_cli_manifest + approved_doc_write + sheet_read + approved_sheet_write_with_agentspace_sync + base_read + approved_base_mutation_with_agentspace_sync + user_actor + external_guest_actor + external_guest_read_guest_readable_current_channel + external_guest_bound_write_denied",
    failureVisibility: "provider_failure_row + degraded_or_error_health + agent_bot_failure_evidence",
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
      required: ["event_callback_url", "im.message.receive_v1", "im.chat.member.bot.added_v1", "card.action.trigger"],
    },
  ],
  FEISHU_PROVIDER_ID: "feishu",
  FEISHU_REQUIRED_CREDENTIAL_FIELDS: ["app_id", "app_secret", "verification_token"],
  FEISHU_REQUIRED_EVENTS: ["im.message.receive_v1", "im.chat.member.bot.added_v1", "card.action.trigger"],
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
        metadataJson: JSON.stringify({
          provisionSource: "bot_added",
          reviewStatus: "approved",
          agentId: "Codex",
          botBindingId: "agent-bot-codex",
        }),
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
      requiredCredentialFields: ["app_id", "app_secret", "verification_token"],
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
          required: ["event_callback_url", "im.message.receive_v1", "im.chat.member.bot.added_v1", "card.action.trigger"],
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
          metadataJson: JSON.stringify({
            provider: "feishu",
            agentId: "Codex",
            botBindingId: "agent-bot-codex",
          }),
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
      provisionSource: binding.provisionSource,
      reviewStatus: binding.reviewStatus,
      agentId: binding.agentId,
      botBindingId: binding.botBindingId,
    }))).toEqual([
      {
        channelName: "general",
        externalChatReference: "chat b2295ba0",
        externalChatIdRedacted: true,
        provisionSource: "bot_added",
        reviewStatus: "approved",
        agentId: "Codex",
        botBindingId: "agent-bot-codex",
      },
    ]);
    expect(item?.recentOutboxFailures).toEqual([
      {
        id: "outbox-1",
        integrationId: "feishu-1",
        channelBindingId: "channel-binding-1",
        agentId: "Codex",
        botBindingId: "agent-bot-codex",
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
      requiredCredentialFields: ["app_id", "app_secret", "verification_token"],
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
          required: ["event_callback_url", "im.message.receive_v1", "im.chat.member.bot.added_v1", "card.action.trigger"],
        },
      ],
      checks: [
        {
          key: "credentials",
          status: "ready",
          current: "complete",
          required: "app_id/app_secret/verification_token",
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
          key: "native_agent_bot",
          required: "agent_bot_route + bound_user_bot_mention + external_guest_bot_mention + bot_added_auto_provision + first_message_auto_provision + multi_agent_channel_reuse + thread_task_binding + thread_continuation + thread_collaboration + bot_sender_loop_guard + agent_channel_policy_denial_without_reply",
        },
        {
          key: "guest_policy",
          required: "external_guest_allow + external_guest_reply_all + external_guest_require_identity + external_guest_ignore + external_guest_mention_required",
        },
        {
          key: "data_plane",
          required: "doc_read + agent_runtime_doc_read_from_lark_cli_manifest + approved_doc_write + sheet_read + approved_sheet_write_with_agentspace_sync + base_read + approved_base_mutation_with_agentspace_sync + user_actor + external_guest_actor + external_guest_read_guest_readable_current_channel + external_guest_bound_write_denied",
        },
        {
          key: "failure_visibility",
          required: "provider_failure_row + degraded_or_error_health + agent_bot_failure_evidence",
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
    expect(JSON.stringify(item)).not.toContain("ou_new_user");
    expect(JSON.stringify(item)).not.toContain("on_new_user");
    expect(JSON.stringify(item)).not.toContain("feishu_user_1");
    expect(JSON.stringify(item)).not.toContain("oc_general");
    expect(JSON.stringify(item)).not.toContain("oc_new_chat");
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
          externalUserReference: expect.stringMatching(/^user [0-9a-f]{8}$/),
          externalUserIdRedacted: true,
          externalUnionReference: expect.stringMatching(/^union [0-9a-f]{8}$/),
          externalUnionIdRedacted: true,
          externalOpenReference: expect.stringMatching(/^user [0-9a-f]{8}$/),
          externalOpenIdRedacted: true,
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
          externalChatReference: expect.stringMatching(/^chat [0-9a-f]{8}$/),
          externalChatIdRedacted: true,
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

  it("surfaces agent bot governance policy from Feishu config", () => {
    mockListExternalIntegrationsSync.mockReturnValue([
      buildIntegration({
        id: "agent-bot-atlas",
        displayName: "Atlas Feishu Bot",
        agentId: "Atlas",
        transportMode: "websocket_worker",
        configJson: JSON.stringify({
          channelAutoProvisioning: {
            botAdded: "pending_admin_review",
            firstMessage: "reply_with_setup_card",
            reviewStatus: "needs_identity_binding",
          },
          externalGuestPolicy: {
            unboundUserMode: "require_identity",
            guestPermissionProfile: "none",
            requireIdentityFor: ["writes", "approvals"],
          },
        }),
      }),
      buildIntegration({
        id: "agent-bot-hermes",
        displayName: "Hermes Feishu Bot",
        agentId: "Hermes",
        transportMode: "websocket_worker",
        configJson: JSON.stringify({
          externalGuestPolicy: {
            requireIdentityFor: ["writes", "admin_panel", "writes", "runtime_sensitive_tools"],
          },
        }),
      }),
      buildIntegration({
        id: "agent-bot-vega",
        displayName: "Vega Feishu Bot",
        agentId: "Vega",
        transportMode: "websocket_worker",
        configJson: JSON.stringify({
          externalGuestPolicy: {
            requireIdentityFor: [],
          },
        }),
      }),
      buildIntegration({
        id: "agent-bot-codex",
        displayName: "Codex Feishu Bot",
        agentId: "Codex",
        transportMode: "websocket_worker",
      }),
    ]);

    const [atlas, hermes, vega, codex] = listFeishuIntegrationSettingsItems({
      workspaceId: "workspace-1",
      appUrl: "https://agent.test",
      viewer: {
        role: "admin",
        userId: "admin-1",
      },
    });

    expect(atlas?.channelAutoProvisioning).toEqual({
      botAdded: "pending_admin_review",
      firstMessage: "reply_with_setup_card",
      reviewStatus: "needs_identity_binding",
    });
    expect(atlas?.externalGuestPolicy).toEqual({
      unboundUserMode: "require_identity",
      guestPermissionProfile: "none",
      requireIdentityFor: ["writes", "approvals"],
    });
    expect(atlas?.setupGuide?.commands.botReadiness).toBe(
      "agent-space integrations feishu agent-bot-readiness --workspace-id workspace-1 --agent Atlas --strict --require bot --json",
    );
    expect(atlas?.setupGuide?.commands.dataPlaneReadiness).toBe(
      "agent-space integrations feishu agent-bot-readiness --workspace-id workspace-1 --agent Atlas --strict --require data-plane --json",
    );
    expect(atlas?.setupGuide?.commands.autoProvisionPolicy).toBe(
      "agent-space integrations feishu auto-provision-policy --workspace-id workspace-1 --agent Atlas --bot-added-policy auto_create_channel --first-message-policy auto_create_if_bot_mentioned --unbound-user-mode reply_on_mention --guest-permission-profile channel_context_only --json",
    );
    expect(atlas?.setupGuide?.commands.channelBindings).toBe(
      "agent-space integrations feishu channel-bindings --workspace-id workspace-1 --integration agent-bot-atlas --json",
    );
    expect(atlas?.setupGuide?.requiredCredentialFields).toEqual(["app_id", "app_secret"]);
    expect(atlas?.setupGuide?.checks.find((check) => check.key === "credentials")).toEqual({
      key: "credentials",
      status: "ready",
      current: "complete",
      required: "app_id/app_secret",
    });
    expect(hermes?.externalGuestPolicy?.requireIdentityFor).toEqual([
      "writes",
      "runtime_sensitive_tools",
    ]);
    expect(vega?.externalGuestPolicy?.requireIdentityFor).toEqual([]);
    expect(codex?.channelAutoProvisioning).toEqual({
      botAdded: "auto_create_channel",
      firstMessage: "auto_create_if_bot_mentioned",
      reviewStatus: "approved",
    });
    expect(codex?.externalGuestPolicy).toEqual({
      unboundUserMode: "reply_on_mention",
      guestPermissionProfile: "channel_context_only",
      requireIdentityFor: [
        "writes",
        "approvals",
        "private_resources",
        "runtime_sensitive_tools",
      ],
    });
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

function buildIntegration(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
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
