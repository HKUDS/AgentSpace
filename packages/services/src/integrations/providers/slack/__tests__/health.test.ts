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
  assert.equal(plan.commands.create, "agent-space integrations slack create --workspace-id workspace-1 --app-id CHANGE_ME_SLACK_APP_ID --team-id CHANGE_ME_SLACK_TEAM_ID --env-file scripts/slack/.env --json");
  assert.equal(plan.commands.healthCheck, "agent-space integrations slack health-check --workspace-id workspace-1 --integration slack-1 --json");
  assert.equal(plan.commands.readiness, "agent-space integrations slack readiness --workspace-id workspace-1 --integration slack-1 --strict --json");
  assert.equal(plan.commands.smokeEnv, "agent-space integrations slack smoke-env --workspace-id workspace-1 --integration slack-1 --app-url https://agentspace.test");
  assert.equal(plan.commands.workerDryRun, "agent-space integrations slack worker --workspace-id workspace-1 --integration slack-1 --dry-run --json");
  assert.match(plan.commands.webhookReplay, /--replay-webhook/);
  assert.match(plan.commands.livePostMessage, /--live --evidence runtime-output\/slack-smoke\/live\.json/);
  assert.match(plan.commands.liveAppMention, /SLACK_SMOKE_LIVE_MODE=app_mention/);
  assert.equal(plan.commands.drainOutbox, "agent-space integrations slack outbox drain --workspace-id workspace-1 --integration slack-1 --json");
  assert.match(plan.commands.liveFileUpload, /SLACK_SMOKE_LIVE_MODE=file_upload/);
  assert.equal(plan.commands.verifyLiveEvidence, "npm run smoke:slack:verify -- --env-file scripts/slack/.env --json");
  assert.equal(plan.commands.finalEvidence, "agent-space integrations slack evidence --workspace-id workspace-1 --integration slack-1 --live-smoke-evidence runtime-output/slack-smoke/live.json --strict --require all --json");
  assert.deepEqual(plan.manualActions.map((action) => action.id), [
    "native_agent_experience",
    "approval_block_actions",
  ]);
  assert.equal(plan.manualActions.find((action) => action.id === "native_agent_experience")?.status, "manual");
  assert.equal(plan.manualActions.find((action) => action.id === "approval_block_actions")?.status, "manual");
  assert.match(plan.manualActions.find((action) => action.id === "native_agent_experience")?.detail ?? "", /app_context_changed/);
  assert.match(plan.manualActions.find((action) => action.id === "approval_block_actions")?.detail ?? "", /approval status outbox/);
  assert.equal(plan.checklist.find((item) => item.id === "live_file_upload")?.status, "manual");
  assert.equal(plan.checklist.find((item) => item.id === "drain_outbox_reply")?.detail, plan.commands.drainOutbox);
  const nativeExperienceStep = plan.checklist.find((item) => item.id === "native_agent_experience");
  assert.equal(nativeExperienceStep?.status, "manual");
  assert.equal(nativeExperienceStep?.detail, plan.manualActions.find((action) => action.id === "native_agent_experience")?.detail);
  const approvalStep = plan.checklist.find((item) => item.id === "approval_block_actions");
  assert.equal(approvalStep?.status, "manual");
  assert.equal(approvalStep?.detail, plan.manualActions.find((action) => action.id === "approval_block_actions")?.detail);
  assert.equal(plan.checklist.find((item) => item.id === "verify_live_evidence")?.detail, "npm run smoke:slack:verify -- --env-file scripts/slack/.env --json");
  assert.equal(plan.checklist.find((item) => item.id === "final_evidence")?.status, "manual");
  assert.equal(env.ready, true);
  assert.match(env.template, /SLACK_SMOKE_CHANNEL_ID=CHANGE_ME_SLACK_CHANNEL_ID/);
  assert.match(env.template, /SLACK_SMOKE_APP_ID=CHANGE_ME_SLACK_APP_ID/);
  assert.match(env.template, /SLACK_SMOKE_TEAM_ID=CHANGE_ME_SLACK_TEAM_ID/);
  assert.match(env.template, /SLACK_SMOKE_LIVE_MODE=post_message/);
  assert.match(env.template, /SLACK_SMOKE_POST_TOKEN=/);
  assert.match(env.template, /SLACK_SMOKE_FILE_NAME=agentspace-slack-smoke\.txt/);
  assert.match(env.template, /SLACK_SMOKE_FILE_TITLE=AgentSpace Slack smoke file/);
  assert.match(env.template, /SLACK_SMOKE_FILE_CONTENT=AgentSpace Slack file smoke/);
  assert.match(env.template, /SLACK_SMOKE_FILE_MIME=text\/plain/);
  assert.match(env.template, /AGENT_SPACE_SMOKE_CALLBACK_BASE_URL=/);
  assert.match(env.nextCommands.join("\n"), /--replay-webhook/);
  assert.match(env.nextCommands.join("\n"), /--live --evidence runtime-output\/slack-smoke\/live\.json/);
  assert.match(env.nextCommands.join("\n"), /SLACK_SMOKE_LIVE_MODE=file_upload/);
  const envAppMentionIndex = env.nextCommands.findIndex((command) =>
    command.includes("SLACK_SMOKE_LIVE_MODE=app_mention")
  );
  const envDrainOutboxIndex = env.nextCommands.indexOf("agent-space integrations slack outbox drain --workspace-id workspace-1 --integration slack-1 --json");
  const envFileUploadIndex = env.nextCommands.findIndex((command) =>
    command.includes("SLACK_SMOKE_LIVE_MODE=file_upload")
  );
  assert.notEqual(envAppMentionIndex, -1);
  assert.notEqual(envDrainOutboxIndex, -1);
  assert.notEqual(envFileUploadIndex, -1);
  assert.ok(envDrainOutboxIndex > envAppMentionIndex);
  assert.ok(envFileUploadIndex > envDrainOutboxIndex);
  assert.ok(env.nextCommands.includes("npm run smoke:slack:verify -- --env-file scripts/slack/.env --json"));
  assert.match(env.nextCommands.join("\n"), /--live-smoke-evidence runtime-output\/slack-smoke\/live\.json --strict --require all/);
  assert.doesNotMatch(JSON.stringify({ plan, env }), /A111|T111|xoxb|xapp/);
});

test("Slack smoke plan setup commands use workspace and integration placeholders before creation", () => {
  const plan = buildSlackSmokePlanReport({
    workspaceId: "workspace-2",
    strict: true,
    required: "all",
    dependencies: {
      listIntegrations() {
        return [];
      },
      listChannelBindings() {
        return [];
      },
      listUserBindings() {
        return [];
      },
      listOutbox() {
        return [];
      },
    },
  });

  assert.equal(plan.commands.create, "agent-space integrations slack create --workspace-id workspace-2 --app-id CHANGE_ME_SLACK_APP_ID --team-id CHANGE_ME_SLACK_TEAM_ID --env-file scripts/slack/.env --json");
  assert.equal(plan.commands.healthCheck, "agent-space integrations slack health-check --workspace-id workspace-2 --integration CHANGE_ME_SLACK_INTEGRATION_ID --json");
  assert.equal(plan.commands.readiness, "agent-space integrations slack readiness --workspace-id workspace-2 --integration CHANGE_ME_SLACK_INTEGRATION_ID --strict --json");
  assert.equal(plan.commands.smokeEnv, "agent-space integrations slack smoke-env --workspace-id workspace-2 --integration CHANGE_ME_SLACK_INTEGRATION_ID --app-url https://agentspace.example.com");
  assert.equal(plan.commands.workerDryRun, "agent-space integrations slack worker --workspace-id workspace-2 --integration CHANGE_ME_SLACK_INTEGRATION_ID --dry-run --json");
  assert.equal(plan.commands.bindChannel, "agent-space integrations slack bind-channel --workspace-id workspace-2 --integration CHANGE_ME_SLACK_INTEGRATION_ID --channel CHANGE_ME_AGENTSPACE_CHANNEL --slack-channel CHANGE_ME_SLACK_CHANNEL_ID --json");
  assert.equal(plan.commands.bindUser, "agent-space integrations slack bind-user --workspace-id workspace-2 --integration CHANGE_ME_SLACK_INTEGRATION_ID --user-id CHANGE_ME_AGENTSPACE_USER_ID --slack-user CHANGE_ME_SLACK_USER_ID --json");
  assert.equal(plan.commands.drainOutbox, "agent-space integrations slack outbox drain --workspace-id workspace-2 --integration CHANGE_ME_SLACK_INTEGRATION_ID --json");
  assert.equal(plan.commands.finalEvidence, "agent-space integrations slack evidence --workspace-id workspace-2 --integration CHANGE_ME_SLACK_INTEGRATION_ID --live-smoke-evidence runtime-output/slack-smoke/live.json --strict --require all --json");
  assert.equal(plan.checklist.find((item) => item.id === "health_check")?.detail, plan.commands.healthCheck);
  assert.equal(plan.checklist.find((item) => item.id === "drain_outbox_reply")?.detail, plan.commands.drainOutbox);
  assert.equal(plan.checklist.find((item) => item.id === "worker")?.detail, plan.commands.workerDryRun);
  assert.equal(plan.checklist.find((item) => item.id === "final_evidence")?.detail, plan.commands.finalEvidence);
  assert.deepEqual(plan.manualActions.map((action) => [action.id, action.status]), [
    ["native_agent_experience", "blocked"],
    ["approval_block_actions", "blocked"],
  ]);
  assert.equal(
    plan.checklist.find((item) => item.id === "native_agent_experience")?.detail,
    plan.manualActions.find((action) => action.id === "native_agent_experience")?.detail,
  );
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
