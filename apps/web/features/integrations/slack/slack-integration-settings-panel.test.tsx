import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { SlackIntegrationSettingsPanel } from "./slack-integration-settings-panel";
import type {
  SlackAvailableChannelItem,
  SlackAvailableUserItem,
  SlackIntegrationCreationGuide,
  SlackIntegrationSettingsItem,
} from "./slack-types";

vi.mock("./slack-actions", () => ({
  checkSlackIntegrationHealthAction: vi.fn(),
  createSlackChannelBindingAction: vi.fn(),
  createSlackIntegrationAction: vi.fn(),
  createSlackUserBindingAction: vi.fn(),
  deleteSlackIntegrationAction: vi.fn(),
  disableSlackIntegrationAction: vi.fn(),
  resumeSlackIntegrationAction: vi.fn(),
}));

const tx = (_zh: string, en: string) => en;

describe("SlackIntegrationSettingsPanel", () => {
  it("renders admin Slack create, health, channel binding, and user binding surfaces", () => {
    renderPanel("admin");

    expect(screen.getByRole("region", { name: "Slack integrations" })).toBeInTheDocument();
    expect(screen.getAllByText("Create Slack Integration").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Slack Apps" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Slack Channel Mappings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Slack User Bindings" })).toBeInTheDocument();
    expect(screen.getByLabelText("Slack App ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Slack Conversation ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Slack User ID")).toBeInTheDocument();
    expect(screen.getAllByText("Slack Agent").length).toBeGreaterThan(0);
    expect(screen.getByText(/Slack Conversation: launch-room/)).toBeInTheDocument();
    expect(screen.getByText(/Slack Channel: slack:C_S...RAL/)).toBeInTheDocument();
    expect(screen.getByText(/Conversation Reference: slack:C_S...RAL/)).toBeInTheDocument();
    expect(screen.getByText(/User Reference: slack:U_M...INA/)).toBeInTheDocument();
    expect(screen.getByText(/Health: Healthy/)).toBeInTheDocument();
    expect(screen.getByText("Outbound Failures")).toBeInTheDocument();
    expect(screen.getByText("slack.outbound.missing_scope")).toBeInTheDocument();
    expect(screen.getByText("Slack Acceptance Checks")).toBeInTheDocument();
    expect(screen.getByText("Slack App Manifest")).toBeInTheDocument();
    expect(screen.getByText("Copy Manifest")).toBeInTheDocument();
    expect(screen.getByText(/"request_url": "https:\/\/agent\.test\/api\/integrations\/slack\/events/)).toBeInTheDocument();
  });

  it("hides admin-only Slack integration data from members", () => {
    renderPanel("member");

    expect(screen.getByText("My Slack Binding")).toBeInTheDocument();
    expect(screen.getByText("Available Integrations")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Slack User Bindings" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Mina (mina@example.com)")).toBeDisabled();
    expect(screen.getByText(/User Reference: slack:U_M...INA/)).toBeInTheDocument();

    expect(screen.queryByText("Create Slack Integration")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Slack Apps" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Slack Channel Mappings" })).not.toBeInTheDocument();
    expect(screen.queryByText("Outbound Failures")).not.toBeInTheDocument();
    expect(screen.queryByText("launch-room")).not.toBeInTheDocument();
    expect(screen.queryByText(/slack:C_S...RAL/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Kai/)).not.toBeInTheDocument();
    expect(screen.queryByText(/slack:U_K...AIT/)).not.toBeInTheDocument();
  });
});

function renderPanel(currentMembershipRole: "admin" | "member") {
  render(
    <SlackIntegrationSettingsPanel
      availableChannels={availableChannels}
      availableUsers={availableUsers}
      currentMembershipRole={currentMembershipRole}
      currentUserId="user-mina"
      isPending={false}
      refreshSettingsData={vi.fn()}
      slackIntegrationCreationGuide={creationGuide}
      slackIntegrations={[integration]}
      startTransition={(callback) => {
        callback();
      }}
      tx={tx}
    />,
  );
}

const availableChannels: SlackAvailableChannelItem[] = [
  { name: "general", kind: "group" },
  { name: "ops", kind: "group" },
];

const availableUsers: SlackAvailableUserItem[] = [
  {
    userId: "user-mina",
    displayName: "Mina",
    primaryEmail: "mina@example.com",
    role: "member",
  },
  {
    userId: "user-kai",
    displayName: "Kai",
    primaryEmail: "kai@example.com",
    role: "member",
  },
];

const integration: SlackIntegrationSettingsItem = {
  id: "slack-1",
  displayName: "Slack Agent",
  status: "active",
  transportMode: "websocket_worker",
  agentId: "Atlas",
  appId: "A_SLACK",
  teamId: "T_SLACK",
  callbackUrl: "https://agent.test/api/integrations/slack/events?workspaceId=workspace-1&integrationId=slack-1",
  createdAt: "2026-07-08T00:00:00.000Z",
  updatedAt: "2026-07-08T00:05:00.000Z",
  lastHealthStatus: "healthy",
  lastHealthCheckedAt: "2026-07-08T00:04:00.000Z",
  hasBotToken: true,
  hasSigningSecret: true,
  hasAppLevelToken: true,
  channelBindingCount: 1,
  userBindingCount: 2,
  outboxFailureCount: 1,
  userBindings: [
    {
      id: "user-binding-mina",
      integrationId: "slack-1",
      userId: "user-mina",
      externalUserReference: "slack:U_M...INA",
      externalUserIdRedacted: true,
      displayName: "Mina Slack",
      status: "active",
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
    },
    {
      id: "user-binding-kai",
      integrationId: "slack-1",
      userId: "user-kai",
      externalUserReference: "slack:U_K...AIT",
      externalUserIdRedacted: true,
      displayName: "Kai Slack",
      status: "active",
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
    },
  ],
  channelBindings: [
    {
      id: "channel-binding-general",
      integrationId: "slack-1",
      channelName: "general",
      externalChannelReference: "slack:C_S...RAL",
      externalChannelIdRedacted: true,
      externalChannelType: "channel",
      externalChannelName: "launch-room",
      status: "active",
      syncMode: "mirror",
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
    },
  ],
  recentOutboxFailures: [
    {
      id: "outbox-1",
      integrationId: "slack-1",
      channelBindingId: "channel-binding-general",
      targetExternalChannelReference: "slack:C_S...RAL",
      targetExternalChannelIdRedacted: true,
      targetExternalThreadReference: "slack:1720...0100",
      targetExternalThreadIdRedacted: true,
      status: "failed",
      attempts: 2,
      lastError: "slack.outbound.missing_scope",
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:03:00.000Z",
    },
  ],
  recentInboundEvents: [
    {
      id: "event-1",
      integrationId: "slack-1",
      externalEventReference: "slack:Ev...001",
      externalEventIdRedacted: true,
      eventType: "event_callback:app_mention",
      status: "ignored",
      errorMessage: "slack.channel_binding_missing",
      receivedAt: "2026-07-08T00:02:00.000Z",
      bindingSuggestion: {
        kind: "channel",
        externalChannelReference: "slack:C_N...EED",
        externalChannelIdRedacted: true,
      },
    },
  ],
  setupGuide: {
    requiredCredentialFields: ["botToken", "signingSecret"],
    requiredEvents: ["app_mention", "message.im"],
    requiredScopes: ["app_mentions:read", "chat:write"],
    eventCallbackPath: "/api/integrations/slack/events",
    interactionCallbackPath: "/api/integrations/slack/interactions",
    developerConsoleUrl: "https://api.slack.com/apps",
    checks: [
      { key: "credentials", status: "ready", current: "stored" },
      { key: "channel_binding", status: "ready", current: 1, required: 1 },
      { key: "user_binding", status: "ready", current: 2, required: 1 },
    ],
    commands: {
      healthCheck: "agent-space integrations slack health-check --workspace-id workspace-1 --integration slack-1 --json",
      bindChannel: "agent-space integrations slack bind-channel --workspace-id workspace-1 --integration slack-1 --channel general --slack-channel CHANGE_ME --json",
      bindUser: "agent-space integrations slack bind-user --workspace-id workspace-1 --integration slack-1 --user-id user-mina --slack-user CHANGE_ME --json",
      outboxDrain: "agent-space integrations slack outbox drain --workspace-id workspace-1 --integration slack-1 --json",
    },
  },
};

const creationGuide: SlackIntegrationCreationGuide = {
  requiredCredentialFields: ["botToken", "signingSecret"],
  requiredEvents: ["app_mention", "message.im", "app_home_opened"],
  requiredScopes: ["app_mentions:read", "chat:write", "im:read"],
  socketModeCredentialFields: ["appLevelToken"],
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
  manifestJson: JSON.stringify({
    settings: {
      event_subscriptions: {
        request_url: "https://agent.test/api/integrations/slack/events?workspaceId=workspace-1&integrationId=created-integration-id",
      },
    },
  }, null, 2),
  commands: {
    create: "agent-space integrations slack create --workspace-id workspace-1 --json",
    bindAgentBot: "agent-space integrations slack bind-agent-bot --workspace-id workspace-1 --agent CHANGE_ME --json",
    healthCheck: "agent-space integrations slack health-check --workspace-id workspace-1 --integration created-integration-id --json",
    bindChannel: "agent-space integrations slack bind-channel --workspace-id workspace-1 --integration created-integration-id --channel general --slack-channel CHANGE_ME --json",
    bindUser: "agent-space integrations slack bind-user --workspace-id workspace-1 --integration created-integration-id --user-id user-mina --slack-user CHANGE_ME --json",
    outboxDrain: "agent-space integrations slack outbox drain --workspace-id workspace-1 --integration created-integration-id --json",
  },
};
