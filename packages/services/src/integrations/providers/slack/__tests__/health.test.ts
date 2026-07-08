import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExternalChannelBindingRecord,
  ExternalIntegrationRecord,
  ExternalUserBindingRecord,
} from "@agent-space/db";
import { SLACK_PROVIDER_ID } from "../constants.ts";
import {
  buildSlackAgentViewAppManifest,
  buildSlackReadinessReport,
  buildSlackSmokeEnvTemplateReport,
  buildSlackSmokePlanReport,
  checkSlackIntegrationHealth,
} from "../health.ts";

test("checks Slack auth scopes and Socket Mode app-level token without leaking tokens", async () => {
  const calls: string[] = [];
  const result = await checkSlackIntegrationHealth({
    botToken: "xoxb-secret",
    appLevelToken: "xapp-secret",
    transportMode: "websocket_worker",
    expectedAppId: "A111",
    expectedTeamId: "T111",
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/auth.test")) {
        return new Response(JSON.stringify({
          ok: true,
          user_id: "Ubot",
          team_id: "T111",
          team: "Agents",
          app_id: "A111",
        }), {
          status: 200,
          headers: {
            "x-oauth-scopes": "app_mentions:read,chat:write,channels:read,groups:read,im:read,im:history,users:read",
          },
        });
      }
      return new Response(JSON.stringify({
        ok: true,
        url: "wss://wss-primary.slack.com/link/?ticket=1",
      }), { status: 200 });
    },
  });

  assert.deepEqual(calls, [
    "https://slack.com/api/auth.test",
    "https://slack.com/api/apps.connections.open",
  ]);
  assert.equal(result.status, "healthy");
  assert.equal(result.socketMode?.ok, true);
  assert.equal(result.scopeReviewStatus, "verified");
  assert.deepEqual(result.missingScopes, []);
  assert.doesNotMatch(JSON.stringify(result), /xoxb-secret|xapp-secret/);
});

test("reports missing Slack scopes as degraded safe diagnostics", async () => {
  const result = await checkSlackIntegrationHealth({
    botToken: "xoxb-secret",
    expectedAppId: "A111",
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true,
      user_id: "Ubot",
      team_id: "T111",
      app_id: "A111",
    }), {
      status: 200,
      headers: {
        "x-oauth-scopes": "app_mentions:read,chat:write",
      },
    }),
  });

  assert.equal(result.status, "error");
  assert.equal(result.scopeReviewStatus, "missing");
  assert.ok(result.missingScopes?.includes("users:read"));
  assert.match(result.errorMessage ?? "", /Missing Slack bot scopes/);
  assert.doesNotMatch(JSON.stringify(result), /xoxb-secret/);
});

test("builds Slack readiness reports from local AgentSpace state", () => {
  const ready = makeIntegration({
    id: "slack-ready",
    lastHealthStatus: "healthy",
    scopesJson: JSON.stringify([
      "app_mentions:read",
      "chat:write",
      "channels:read",
      "groups:read",
      "im:read",
      "im:history",
      "users:read",
      "connections:write",
    ]),
    encryptedCredentialsJson: JSON.stringify({
      botToken: "enc",
      signingSecret: "enc",
      appLevelToken: "enc",
    }),
    transportMode: "websocket_worker",
    configJson: JSON.stringify({
      bot: {
        grantedScopes: ["app_mentions:read", "chat:write"],
        missingScopes: [],
        scopeReviewStatus: "verified",
      },
    }),
  });
  const missingBindings = makeIntegration({
    id: "slack-missing-bindings",
    lastHealthStatus: "degraded",
    encryptedCredentialsJson: JSON.stringify({
      botToken: "enc",
      signingSecret: "enc",
    }),
    scopesJson: JSON.stringify(["app_mentions:read"]),
  });

  const report = buildSlackReadinessReport({
    workspaceId: "workspace-1",
    required: "all",
    strict: true,
    dependencies: {
      listIntegrations() {
        return [ready, missingBindings];
      },
      listChannelBindings(input) {
        return input.integrationId === "slack-ready" ? [makeChannelBinding(input.integrationId)] : [];
      },
      listUserBindings(input) {
        return input.integrationId === "slack-ready" ? [makeUserBinding(input.integrationId)] : [];
      },
      listOutbox() {
        return [];
      },
    },
  });

  assert.equal(report.integrationCount, 2);
  assert.equal(report.readyForMessageSmokeCount, 1);
  assert.equal(report.readyForWorkerSmokeCount, 1);
  assert.equal(report.strictSatisfied, true);
  assert.deepEqual(report.integrations[0]?.blockers, []);
  assert.ok(report.integrations[1]?.blockers.includes("channel_binding_missing"));
  assert.ok(report.integrations[1]?.blockers.some((item) => item.startsWith("configured_bot_scopes_missing")));
});

test("builds Slack smoke plan and env template without raw external ids", () => {
  const integration = makeIntegration({
    id: "slack-1",
    appId: "A111",
    tenantKey: "T111",
    lastHealthStatus: "healthy",
    encryptedCredentialsJson: JSON.stringify({
      botToken: "enc",
      signingSecret: "enc",
    }),
    scopesJson: JSON.stringify([
      "app_mentions:read",
      "chat:write",
      "channels:read",
      "groups:read",
      "im:read",
      "im:history",
      "users:read",
    ]),
  });
  const dependencies = {
    listIntegrations() {
      return [integration];
    },
    listChannelBindings() {
      return [makeChannelBinding("slack-1")];
    },
    listUserBindings() {
      return [makeUserBinding("slack-1")];
    },
    listOutbox() {
      return [];
    },
  };

  const plan = buildSlackSmokePlanReport({
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    appUrl: "https://agentspace.test/",
    dependencies,
  });
  const env = buildSlackSmokeEnvTemplateReport({
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    appUrl: "https://agentspace.test/",
    dependencies,
  });

  assert.equal(plan.callbackUrl, "https://agentspace.test/api/integrations/slack/events");
  assert.equal(plan.readiness.strictSatisfied, true);
  assert.equal(plan.appSetup.interactionCallbackPath, "/api/integrations/slack/interactions");
  assert.equal(plan.appSetup.agentView.enabled, true);
  assert.equal(plan.appSetup.agentView.manifestFeature, "features.agent_view");
  assert.ok(plan.appSetup.botScopes.includes("assistant:write"));
  assert.deepEqual(plan.appSetup.agentViewEvents.sort(), [
    "app_context_changed",
    "app_home_opened",
    "message.im",
  ].sort());
  assert.ok(plan.appSetup.requiredEvents.includes("app_context_changed"));
  assert.equal(plan.appSetup.manifest.features.agent_view.agent_description.includes("AgentSpace"), true);
  assert.equal(plan.appSetup.manifest.settings.event_subscriptions.request_url, "https://agentspace.test/api/integrations/slack/events");
  assert.equal(plan.appSetup.manifest.settings.interactivity.request_url, "https://agentspace.test/api/integrations/slack/interactions");
  assert.equal(plan.appSetup.manifest.settings.socket_mode_enabled, true);
  assert.equal(env.ready, true);
  assert.match(env.template, /SLACK_SMOKE_CHANNEL_ID=CHANGE_ME_SLACK_CHANNEL_ID/);
  assert.doesNotMatch(JSON.stringify({ plan, env }), /A111|T111|xoxb|xapp/);
});

test("builds Slack agent_view app manifests with normalized prompts and bot names", () => {
  const manifest = buildSlackAgentViewAppManifest({
    appName: "AgentSpace Enterprise Native Agent Experience",
    botDisplayName: "Agent Space Bot!",
    appUrl: "https://agentspace.example.test/",
    socketMode: false,
    agentDescription: "Use AgentSpace from Slack.",
    suggestedPrompts: [{
      title: "Review approvals",
      message: "Show pending approvals that need my attention.",
    }],
  });

  assert.equal(manifest.display_information.name, "AgentSpace Enterprise Native Agent");
  assert.equal(manifest.features.bot_user.display_name, "agent-space-bot");
  assert.equal(manifest.features.app_home.messages_tab_enabled, true);
  assert.equal(manifest.features.agent_view.agent_description, "Use AgentSpace from Slack.");
  assert.deepEqual(manifest.features.agent_view.suggested_prompts, [{
    title: "Review approvals",
    message: "Show pending approvals that need my attention.",
  }]);
  assert.deepEqual(manifest.oauth_config.scopes.bot.sort(), [
    "app_mentions:read",
    "assistant:write",
    "channels:read",
    "chat:write",
    "files:read",
    "files:write",
    "groups:read",
    "im:history",
    "im:read",
    "users:read",
  ].sort());
  assert.deepEqual(manifest.settings.event_subscriptions.bot_events.sort(), [
    "app_context_changed",
    "app_home_opened",
    "app_mention",
    "message.im",
  ].sort());
  assert.equal(manifest.settings.interactivity.is_enabled, true);
  assert.equal(manifest.settings.socket_mode_enabled, false);
});

function makeIntegration(overrides: Partial<ExternalIntegrationRecord> = {}): ExternalIntegrationRecord {
  return {
    id: "slack-1",
    workspaceId: "workspace-1",
    provider: SLACK_PROVIDER_ID,
    displayName: "Slack",
    status: "active",
    transportMode: "http_webhook",
    appId: "A111",
    tenantKey: "T111",
    encryptedCredentialsJson: JSON.stringify({}),
    configJson: JSON.stringify({}),
    capabilitiesJson: "{}",
    scopesJson: JSON.stringify([]),
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
  };
}

function makeChannelBinding(integrationId: string): ExternalChannelBindingRecord {
  return {
    id: `channel-${integrationId}`,
    workspaceId: "workspace-1",
    integrationId,
    channelName: "general",
    externalChatId: "C111",
    externalChatType: "channel",
    status: "active",
    syncMode: "mirror",
    metadataJson: "{}",
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
  };
}

function makeUserBinding(integrationId: string): ExternalUserBindingRecord {
  return {
    id: `user-${integrationId}`,
    workspaceId: "workspace-1",
    integrationId,
    userId: "user-1",
    externalUserId: "U111",
    status: "active",
    metadataJson: "{}",
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
  };
}
