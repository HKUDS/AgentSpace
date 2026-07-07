import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockListExternalChannelBindingsSync,
  mockListExternalIntegrationEventsSync,
  mockListExternalIntegrationsSync,
  mockListExternalMessageOutboxSync,
  mockListExternalUserBindingsSync,
  mockListStoredChannelsSync,
  mockListWorkspaceMemberUsersSync,
} = vi.hoisted(() => ({
  mockListExternalChannelBindingsSync: vi.fn(),
  mockListExternalIntegrationEventsSync: vi.fn(),
  mockListExternalIntegrationsSync: vi.fn(),
  mockListExternalMessageOutboxSync: vi.fn(),
  mockListExternalUserBindingsSync: vi.fn(),
  mockListStoredChannelsSync: vi.fn(),
  mockListWorkspaceMemberUsersSync: vi.fn(),
}));

vi.mock("@agent-space/db", () => ({
  listExternalChannelBindingsSync: mockListExternalChannelBindingsSync,
  listExternalIntegrationEventsSync: mockListExternalIntegrationEventsSync,
  listExternalIntegrationsSync: mockListExternalIntegrationsSync,
  listExternalMessageOutboxSync: mockListExternalMessageOutboxSync,
  listExternalUserBindingsSync: mockListExternalUserBindingsSync,
  listStoredChannelsSync: mockListStoredChannelsSync,
  listWorkspaceMemberUsersSync: mockListWorkspaceMemberUsersSync,
}));

vi.mock("@agent-space/services", () => ({
  buildSlackReference: (value: string) => `ref_${value}`,
  SLACK_DEFAULT_SCOPES: ["app_mentions:read", "chat:write"],
  SLACK_EVENT_CALLBACK_PATH: "/api/integrations/slack/events",
  SLACK_INTERACTION_CALLBACK_PATH: "/api/integrations/slack/interactions",
  SLACK_PROVIDER_ID: "slack",
  SLACK_REQUIRED_CREDENTIAL_FIELDS: ["bot_token", "signing_secret"],
  SLACK_REQUIRED_EVENTS: ["app_mention", "message.im", "app_home_opened"],
  SLACK_SOCKET_MODE_CREDENTIAL_FIELDS: ["app_level_token"],
  SLACK_SOCKET_MODE_SCOPES: ["connections:write"],
  summarizeSlackStoredCredentials: () => ({
    hasAppLevelToken: true,
    hasBotToken: true,
    hasClientId: false,
    hasClientSecret: false,
    hasSigningSecret: true,
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
  buildSlackIntegrationCreationGuide,
  listSlackIntegrationSettingsItems,
} from "./slack-settings-data";

describe("Slack settings data", () => {
  beforeEach(() => {
    mockListExternalChannelBindingsSync.mockReset();
    mockListExternalIntegrationEventsSync.mockReset();
    mockListExternalIntegrationsSync.mockReset();
    mockListExternalMessageOutboxSync.mockReset();
    mockListExternalUserBindingsSync.mockReset();
    mockListStoredChannelsSync.mockReset();
    mockListWorkspaceMemberUsersSync.mockReset();

    mockListExternalIntegrationsSync.mockReturnValue([buildIntegration()]);
    mockListExternalUserBindingsSync.mockReturnValue([
      buildUserBinding("binding-1", "user-1", "U111"),
      buildUserBinding("binding-2", "user-2", "U222"),
    ]);
    mockListExternalChannelBindingsSync.mockReturnValue([
      {
        id: "channel-binding-1",
        integrationId: "slack-1",
        channelName: "general",
        externalChatId: "C111",
        externalChatType: "channel",
        externalChatName: "general",
        metadataJson: "{}",
        status: "active",
        syncMode: "mirror",
        createdAt: "2026-07-07T00:00:00.000Z",
        updatedAt: "2026-07-07T00:00:00.000Z",
      },
    ]);
    mockListExternalIntegrationEventsSync.mockReturnValue([
      {
        id: "event-1",
        integrationId: "slack-1",
        externalEventId: "Ev111",
        eventType: "event_callback.app_mention",
        status: "ignored",
        errorMessage: "slack.channel_binding_missing",
        payloadJson: JSON.stringify({
          channelRef: "ref_C999",
          userRef: "ref_U999",
        }),
        receivedAt: "2026-07-07T00:00:00.000Z",
        processedAt: "2026-07-07T00:00:01.000Z",
      },
    ]);
    mockListExternalMessageOutboxSync.mockReturnValue([]);
  });

  it("filters Slack integration settings down to self-service identity data for members", () => {
    const [item] = listSlackIntegrationSettingsItems({
      workspaceId: "workspace-1",
      appUrl: "https://agent.test",
      viewer: {
        role: "member",
        userId: "user-1",
      },
    });

    expect(item?.userBindings.map((binding) => binding.userId)).toEqual(["user-1"]);
    expect(item?.channelBindings).toEqual([]);
    expect(item?.recentOutboxFailures).toEqual([]);
    expect(item?.recentInboundEvents).toEqual([]);
    expect(item?.appId).toBeUndefined();
    expect(item?.teamId).toBeUndefined();
    expect(item?.callbackUrl).toBe("");
    expect(item?.setupGuide).toBeUndefined();
    expect(item?.hasBotToken).toBe(false);
    expect(JSON.stringify(item)).not.toContain("xoxb-secret");
    expect(mockListExternalChannelBindingsSync).not.toHaveBeenCalled();
    expect(mockListExternalIntegrationEventsSync).not.toHaveBeenCalled();
    expect(mockListExternalMessageOutboxSync).not.toHaveBeenCalled();
  });

  it("summarizes admin Slack settings with redacted external references and setup checks", () => {
    const [item] = listSlackIntegrationSettingsItems({
      workspaceId: "workspace-1",
      appUrl: "https://agent.test",
      viewer: {
        role: "admin",
        userId: "admin-1",
      },
    });

    expect(item).toMatchObject({
      id: "slack-1",
      appId: "A111",
      teamId: "T111",
      callbackUrl: "https://agent.test/api/integrations/slack/events?workspaceId=workspace-1&integrationId=slack-1",
      hasBotToken: true,
      hasSigningSecret: true,
      channelBindingCount: 1,
      userBindingCount: 2,
    });
    expect(item?.channelBindings[0]?.externalChannelReference).toBe("ref_C111");
    expect(item?.userBindings[0]?.externalUserReference).toBe("ref_U111");
    expect(item?.recentInboundEvents[0]?.externalEventReference).toBe("ref_Ev111");
    expect(item?.recentInboundEvents[0]?.bindingSuggestion).toEqual({
      kind: "channel",
      externalChannelReference: "ref_C999",
      externalChannelIdRedacted: true,
    });
    expect(item?.setupGuide?.checks.map((check) => check.key)).toEqual([
      "credentials",
      "callback_or_socket",
      "health",
      "channel_binding",
      "user_binding",
      "outbox",
    ]);
  });

  it("builds the create-integration guide from shared Slack setup constants", () => {
    expect(buildSlackIntegrationCreationGuide({
      workspaceId: "workspace-1",
      appUrl: "https://agent.test",
    })).toEqual({
      requiredCredentialFields: ["bot_token", "signing_secret"],
      requiredEvents: ["app_mention", "message.im", "app_home_opened"],
      requiredScopes: ["app_mentions:read", "chat:write"],
      socketModeCredentialFields: ["app_level_token"],
      socketModeScopes: ["connections:write"],
      eventCallbackPath: "/api/integrations/slack/events",
      interactionCallbackPath: "/api/integrations/slack/interactions",
      publicAppUrlStatus: "configured",
      publicAppUrl: "https://agent.test",
      callbackUrlTemplate: "https://agent.test/api/integrations/slack/events?workspaceId=workspace-1&integrationId=created-integration-id",
      interactionCallbackUrlTemplate: "https://agent.test/api/integrations/slack/interactions?workspaceId=workspace-1&integrationId=created-integration-id",
      oauthStartUrl: "https://agent.test/api/integrations/slack/oauth/start",
      oauthCallbackUrlTemplate: "https://agent.test/api/integrations/slack/oauth/callback",
      developerConsoleUrl: "https://api.slack.com/apps",
      commands: {
        create: "agent-space integrations slack create --workspace-id workspace-1 --app-id CHANGE_ME_SLACK_APP_ID --team-id CHANGE_ME_SLACK_TEAM_ID --env-file scripts/slack/.env --bot-token-env SLACK_BOT_TOKEN --signing-secret-env SLACK_SIGNING_SECRET --json",
        bindAgentBot: "agent-space integrations slack bind-agent-bot --workspace-id workspace-1 --agent CHANGE_ME_AGENTSPACE_AGENT_NAME --app-id CHANGE_ME_SLACK_APP_ID --team-id CHANGE_ME_SLACK_TEAM_ID --env-file scripts/slack/.env --bot-token-env SLACK_BOT_TOKEN --signing-secret-env SLACK_SIGNING_SECRET --app-level-token-env SLACK_APP_TOKEN --json",
        healthCheck: "agent-space integrations slack health-check --workspace-id workspace-1 --integration created-integration-id --json",
        bindChannel: "agent-space integrations slack bind-channel --workspace-id workspace-1 --integration created-integration-id --channel general --slack-channel CHANGE_ME_SLACK_CHANNEL_ID --json",
        bindUser: "agent-space integrations slack bind-user --workspace-id workspace-1 --integration created-integration-id --user-id CHANGE_ME_AGENTSPACE_USER_ID --slack-user CHANGE_ME_SLACK_USER_ID --json",
        outboxDrain: "agent-space integrations slack outbox drain --workspace-id workspace-1 --integration created-integration-id --json",
      },
    });
  });
});

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
    encryptedCredentialsJson: JSON.stringify({
      botToken: "xoxb-secret",
      signingSecret: "signing-secret",
    }),
    configJson: "{}",
    capabilitiesJson: "{}",
    scopesJson: "[]",
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
    lastHealthStatus: "healthy",
    lastHealthCheckedAt: "2026-07-07T00:00:00.000Z",
  };
}

function buildUserBinding(id: string, userId: string, externalUserId: string) {
  return {
    id,
    integrationId: "slack-1",
    userId,
    externalUserId,
    metadataJson: "{}",
    status: "active",
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
  };
}
