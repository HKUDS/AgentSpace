import {
  listExternalChannelBindingsSync,
  listExternalIntegrationsSync,
  listExternalMessageOutboxSync,
  listExternalUserBindingsSync,
  type ExternalIntegrationHealthStatus,
  type ExternalIntegrationRecord,
} from "@agent-space/db";
import {
  SLACK_AGENT_VIEW_EVENTS,
  SLACK_AGENT_VIEW_SCOPES,
  SLACK_BOT_MESSAGE_SCOPES,
  SLACK_EVENT_CALLBACK_PATH,
  SLACK_FILE_DOWNLOAD_SCOPES,
  SLACK_FILE_UPLOAD_SCOPES,
  SLACK_INTERACTION_CALLBACK_PATH,
  SLACK_PROVIDER_ID,
  SLACK_REQUIRED_EVENTS,
  SLACK_SOCKET_MODE_SCOPES,
} from "./constants.ts";
import { summarizeSlackStoredCredentials } from "./credentials.ts";
import { openSlackSocketModeConnection } from "./socket-worker.ts";

export interface SlackHealthCheckResult {
  status: ExternalIntegrationHealthStatus;
  checkedAt: string;
  botUserId?: string;
  teamId?: string;
  teamName?: string;
  appId?: string;
  grantedScopes?: string[];
  missingScopes?: string[];
  scopeReviewStatus?: "verified" | "manual_review" | "missing";
  socketMode?: SlackSocketModeHealthResult;
  checks: SlackHealthCheckItem[];
  errorMessage?: string;
}

export interface SlackHealthCheckItem {
  name: string;
  status: "pass" | "warn" | "fail";
  detail?: string;
  nextStep?: string;
}

export interface SlackSocketModeHealthResult {
  checked: boolean;
  ok: boolean;
  urlAvailable?: boolean;
  errorMessage?: string;
}

export interface SlackReadinessReport {
  workspaceId: string;
  provider: typeof SLACK_PROVIDER_ID;
  generatedAt: string;
  required: SlackReadinessRequirement;
  strict: boolean;
  integrationCount: number;
  readyForMessageSmokeCount: number;
  readyForWorkerSmokeCount: number;
  strictSatisfied: boolean;
  integrations: SlackReadinessIntegrationItem[];
}

export type SlackReadinessRequirement = "message" | "worker" | "all";

export interface SlackReadinessIntegrationItem {
  integrationId: string;
  displayName: string;
  status: ExternalIntegrationRecord["status"];
  transportMode: ExternalIntegrationRecord["transportMode"];
  appIdPresent: boolean;
  teamIdPresent: boolean;
  healthStatus: ExternalIntegrationRecord["lastHealthStatus"];
  credentials: ReturnType<typeof summarizeSlackStoredCredentials>;
  scopes: {
    configured: string[];
    requiredBotScopes: string[];
    requiredSocketScopes: string[];
    missingConfiguredBotScopes: string[];
    missingConfiguredSocketScopes: string[];
    lastGrantedScopes?: string[];
    lastMissingScopes?: string[];
    lastScopeReviewStatus?: SlackHealthCheckResult["scopeReviewStatus"];
  };
  bindings: {
    activeChannels: number;
    activeUsers: number;
  };
  outbox: {
    pending: number;
    failed: number;
  };
  readyForMessageSmoke: boolean;
  readyForWorkerSmoke: boolean;
  blockers: string[];
  warnings: string[];
  nextCommands: string[];
}

export interface SlackSmokePlanReport {
  workspaceId: string;
  provider: typeof SLACK_PROVIDER_ID;
  generatedAt: string;
  strict: boolean;
  appUrl?: string;
  callbackUrl?: string;
  callbackUrlStatus: "ready" | "app_url_missing";
  readiness: SlackReadinessReport;
  appSetup: {
    callbackPath: typeof SLACK_EVENT_CALLBACK_PATH;
    interactionCallbackPath: typeof SLACK_INTERACTION_CALLBACK_PATH;
    requiredEvents: string[];
    agentViewEvents: string[];
    botScopes: string[];
    socketModeScopes: string[];
    credentialFields: string[];
    agentView: {
      enabled: boolean;
      requiredScope: typeof SLACK_AGENT_VIEW_SCOPES[number];
      manifestFeature: "features.agent_view";
    };
    manifest: SlackAppManifest;
  };
  commands: Record<string, string>;
  checklist: Array<{
    id: string;
    status: "ready" | "blocked" | "manual";
    detail: string;
  }>;
}

export interface SlackAppManifestSuggestedPrompt {
  title: string;
  message: string;
}

export interface SlackAppManifest {
  _metadata: {
    major_version: 2;
    minor_version: 1;
  };
  display_information: {
    name: string;
    description: string;
    background_color: string;
  };
  features: {
    app_home: {
      home_tab_enabled: boolean;
      messages_tab_enabled: boolean;
      messages_tab_read_only_enabled: boolean;
    };
    agent_view: {
      agent_description: string;
      suggested_prompts: SlackAppManifestSuggestedPrompt[];
    };
    bot_user: {
      display_name: string;
      always_online: boolean;
    };
  };
  oauth_config: {
    scopes: {
      bot: string[];
    };
  };
  settings: {
    event_subscriptions: {
      request_url: string;
      bot_events: string[];
    };
    interactivity: {
      is_enabled: true;
      request_url: string;
    };
    socket_mode_enabled: boolean;
    org_deploy_enabled: false;
    token_rotation_enabled: false;
    is_hosted: false;
  };
}

export interface SlackSmokeEnvTemplateReport {
  workspaceId: string;
  provider: typeof SLACK_PROVIDER_ID;
  generatedAt: string;
  ready: boolean;
  integrationId?: string;
  appUrl?: string;
  callbackUrl?: string;
  missing: string[];
  template: string;
  nextCommands: string[];
}

export async function checkSlackIntegrationHealth(input: {
  botToken: string;
  appLevelToken?: string;
  transportMode?: ExternalIntegrationRecord["transportMode"];
  expectedAppId?: string;
  expectedTeamId?: string;
  requiredBotScopes?: readonly string[];
  checkSocketMode?: boolean;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<SlackHealthCheckResult> {
  const checkedAt = new Date().toISOString();
  const botToken = input.botToken.trim();
  const checks: SlackHealthCheckItem[] = [];
  if (!botToken) {
    checks.push({
      name: "bot_token",
      status: "fail",
      detail: "Slack bot token is missing.",
      nextStep: "Create or rotate the Slack integration with SLACK_BOT_TOKEN.",
    });
    return {
      status: "error",
      checkedAt,
      checks,
      errorMessage: "Slack bot token is missing.",
    };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${input.baseUrl ?? "https://slack.com/api"}/auth.test`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "",
    });
    const data = await response.json() as Record<string, unknown>;
    if (response.ok && data.ok === true) {
      checks.push({
        name: "auth_test",
        status: "pass",
        detail: "Slack auth.test accepted the saved bot token.",
      });
      const grantedScopes = readSlackScopesHeader(response.headers.get("x-oauth-scopes"));
      const requiredBotScopes = [...(input.requiredBotScopes ?? SLACK_BOT_MESSAGE_SCOPES)];
      const missingScopes = grantedScopes
        ? requiredBotScopes.filter((scope) => !grantedScopes.includes(scope))
        : [];
      if (grantedScopes && missingScopes.length === 0) {
        checks.push({
          name: "bot_scopes",
          status: "pass",
          detail: "Slack returned x-oauth-scopes and all required bot scopes were present.",
        });
      } else if (grantedScopes && missingScopes.length > 0) {
        checks.push({
          name: "bot_scopes",
          status: "fail",
          detail: `Missing Slack bot scopes: ${missingScopes.join(", ")}.`,
          nextStep: "Update the Slack app OAuth scopes, reinstall the app, and rerun health-check.",
        });
      } else {
        checks.push({
          name: "bot_scopes",
          status: "warn",
          detail: "Slack did not return x-oauth-scopes; scope coverage needs manual review.",
          nextStep: "Confirm the Slack app includes the documented bot scopes before live smoke.",
        });
      }

      const appId = typeof data.app_id === "string" ? data.app_id : undefined;
      const teamId = typeof data.team_id === "string" ? data.team_id : undefined;
      if (input.expectedAppId?.trim() && appId && appId !== input.expectedAppId.trim()) {
        checks.push({
          name: "app_id_match",
          status: "fail",
          detail: "Slack auth.test app_id does not match the AgentSpace integration.",
          nextStep: "Use credentials from the same Slack app saved in this integration.",
        });
      } else if (input.expectedAppId?.trim()) {
        checks.push({
          name: "app_id_match",
          status: "pass",
        });
      }
      if (input.expectedTeamId?.trim() && teamId && teamId !== input.expectedTeamId.trim()) {
        checks.push({
          name: "team_id_match",
          status: "fail",
          detail: "Slack auth.test team_id does not match the AgentSpace integration.",
          nextStep: "Use credentials installed into the same Slack workspace saved in this integration.",
        });
      } else if (input.expectedTeamId?.trim()) {
        checks.push({
          name: "team_id_match",
          status: "pass",
        });
      }

      const socketMode = await maybeCheckSlackSocketMode({
        appLevelToken: input.appLevelToken,
        baseUrl: input.baseUrl,
        fetchImpl,
        required: input.checkSocketMode === true || input.transportMode === "websocket_worker",
        checks,
      });
      const failed = checks.some((item) => item.status === "fail");
      const warned = checks.some((item) => item.status === "warn");
      return {
        status: failed ? "error" : warned ? "degraded" : "healthy",
        checkedAt,
        botUserId: typeof data.user_id === "string" ? data.user_id : undefined,
        teamId,
        teamName: typeof data.team === "string" ? data.team : undefined,
        appId,
        ...(grantedScopes ? { grantedScopes } : {}),
        missingScopes,
        scopeReviewStatus: grantedScopes ? (missingScopes.length > 0 ? "missing" : "verified") : "manual_review",
        ...(socketMode ? { socketMode } : {}),
        checks,
        errorMessage: failed
          ? checks.filter((item) => item.status === "fail").map((item) => item.detail ?? item.name).join("; ")
          : undefined,
      };
    }
    checks.push({
      name: "auth_test",
      status: "fail",
      detail: sanitizeSlackHealthErrorMessage(typeof data.error === "string" ? data.error : `Slack auth.test failed with HTTP ${response.status}.`, [botToken]),
    });
    return {
      status: "error",
      checkedAt,
      checks,
      errorMessage: sanitizeSlackHealthErrorMessage(typeof data.error === "string" ? data.error : `Slack auth.test failed with HTTP ${response.status}.`, [botToken]),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({
      name: "auth_test",
      status: "fail",
      detail: sanitizeSlackHealthErrorMessage(message, [botToken]),
    });
    return {
      status: "error",
      checkedAt,
      checks,
      errorMessage: sanitizeSlackHealthErrorMessage(message, [botToken]),
    };
  }
}

export function buildSlackHealthSnapshotConfigJson(input: {
  configJson: string;
  health: SlackHealthCheckResult;
}): Record<string, unknown> {
  const config = parseJsonRecord(input.configJson) ?? {};
  const currentBot = parseJsonRecord(config.bot) ?? {};
  const currentHealth = parseJsonRecord(config.health) ?? {};
  return {
    ...config,
    bot: {
      ...currentBot,
      ...(input.health.botUserId ? { botUserId: input.health.botUserId } : {}),
      ...(input.health.teamId ? { teamId: input.health.teamId } : {}),
      ...(input.health.teamName ? { teamName: input.health.teamName } : {}),
      ...(input.health.appId ? { appId: input.health.appId } : {}),
      ...(input.health.grantedScopes ? { grantedScopes: input.health.grantedScopes } : {}),
      ...(input.health.missingScopes ? { missingScopes: input.health.missingScopes } : {}),
      ...(input.health.scopeReviewStatus ? { scopeReviewStatus: input.health.scopeReviewStatus } : {}),
      lastHealthCheckedAt: input.health.checkedAt,
    },
    health: {
      ...currentHealth,
      lastSlackHealthCheck: {
        status: input.health.status,
        checkedAt: input.health.checkedAt,
        scopeReviewStatus: input.health.scopeReviewStatus,
        missingScopes: input.health.missingScopes ?? [],
        socketMode: input.health.socketMode
          ? {
              checked: input.health.socketMode.checked,
              ok: input.health.socketMode.ok,
              urlAvailable: input.health.socketMode.urlAvailable,
              errorMessage: input.health.socketMode.errorMessage,
            }
          : undefined,
      },
    },
  };
}

export function buildSlackReadinessReport(input: {
  workspaceId: string;
  integrationId?: string;
  strict?: boolean;
  required?: SlackReadinessRequirement;
  dependencies?: SlackReadinessDependencies;
}): SlackReadinessReport {
  const dependencies = input.dependencies ?? {};
  const integrations = (dependencies.listIntegrations ?? listExternalIntegrationsSync)({
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
    includeDisabled: true,
  }).filter((integration) => !input.integrationId || integration.id === input.integrationId);
  const items = integrations.map((integration) =>
    buildSlackReadinessIntegrationItem({
      workspaceId: input.workspaceId,
      integration,
      dependencies,
    }));
  const required = input.required ?? "message";
  return {
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
    generatedAt: new Date().toISOString(),
    required,
    strict: Boolean(input.strict),
    integrationCount: items.length,
    readyForMessageSmokeCount: items.filter((item) => item.readyForMessageSmoke).length,
    readyForWorkerSmokeCount: items.filter((item) => item.readyForWorkerSmoke).length,
    strictSatisfied: items.some((item) => isSlackReadinessItemSatisfied(item, required)),
    integrations: items,
  };
}

export function buildSlackSmokePlanReport(input: {
  workspaceId: string;
  integrationId?: string;
  appUrl?: string;
  strict?: boolean;
  required?: SlackReadinessRequirement;
  dependencies?: SlackReadinessDependencies;
}): SlackSmokePlanReport {
  const readiness = buildSlackReadinessReport({
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
    strict: input.strict,
    required: input.required,
    dependencies: input.dependencies,
  });
  const appUrl = normalizeOptionalUrl(input.appUrl);
  const callbackUrl = appUrl ? `${appUrl}${SLACK_EVENT_CALLBACK_PATH}` : undefined;
  const interactionCallbackUrl = appUrl ? `${appUrl}${SLACK_INTERACTION_CALLBACK_PATH}` : undefined;
  const integrationFlag = input.integrationId ? ` --integration ${input.integrationId}` : "";
  const appUrlFlag = appUrl ? ` --app-url ${appUrl}` : " --app-url https://agentspace.example.com";
  const liveSmokeEvidencePath = "runtime-output/slack-smoke/live.json";
  const manifest = buildSlackAgentViewAppManifest({
    appName: "AgentSpace",
    botDisplayName: "agentspace",
    appUrl,
    socketMode: true,
  });
  const commands = {
    create: "agent-space integrations slack create --workspace-id default --app-id CHANGE_ME_SLACK_APP_ID --team-id CHANGE_ME_SLACK_TEAM_ID --env-file scripts/slack/.env --json",
    healthCheck: `agent-space integrations slack health-check --workspace-id ${input.workspaceId}${integrationFlag} --json`,
    readiness: `agent-space integrations slack readiness --workspace-id ${input.workspaceId}${integrationFlag} --strict --json`,
    smokeEnv: `agent-space integrations slack smoke-env --workspace-id ${input.workspaceId}${integrationFlag}${appUrlFlag}`,
    workerDryRun: `agent-space integrations slack worker --workspace-id ${input.workspaceId}${integrationFlag} --dry-run --json`,
    bindChannel: `agent-space integrations slack bind-channel --workspace-id ${input.workspaceId}${integrationFlag || " --integration CHANGE_ME_SLACK_INTEGRATION_ID"} --channel CHANGE_ME_AGENTSPACE_CHANNEL --slack-channel CHANGE_ME_SLACK_CHANNEL_ID --json`,
    bindUser: `agent-space integrations slack bind-user --workspace-id ${input.workspaceId}${integrationFlag || " --integration CHANGE_ME_SLACK_INTEGRATION_ID"} --user-id CHANGE_ME_AGENTSPACE_USER_ID --slack-user CHANGE_ME_SLACK_USER_ID --json`,
    drySmoke: "npm run smoke:slack -- --env-file scripts/slack/.env --check-env --json",
    webhookReplay: "npm run smoke:slack -- --env-file scripts/slack/.env --replay-webhook --json",
    livePostMessage: `npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence ${liveSmokeEvidencePath} --json`,
    liveAppMention: `SLACK_SMOKE_LIVE_MODE=app_mention npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence ${liveSmokeEvidencePath} --json`,
    liveFileUpload: `SLACK_SMOKE_LIVE_MODE=file_upload npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence ${liveSmokeEvidencePath} --json`,
    verifyLiveEvidence: "npm run smoke:slack:verify -- --env-file scripts/slack/.env --json",
    finalEvidence: `agent-space integrations slack evidence --workspace-id ${input.workspaceId}${integrationFlag} --live-smoke-evidence ${liveSmokeEvidencePath} --strict --require all --json`,
  };
  return {
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
    generatedAt: new Date().toISOString(),
    strict: Boolean(input.strict),
    appUrl,
    callbackUrl,
    callbackUrlStatus: callbackUrl ? "ready" : "app_url_missing",
    readiness,
    appSetup: {
      callbackPath: SLACK_EVENT_CALLBACK_PATH,
      interactionCallbackPath: SLACK_INTERACTION_CALLBACK_PATH,
      requiredEvents: uniqueStrings([...SLACK_REQUIRED_EVENTS, ...SLACK_AGENT_VIEW_EVENTS]),
      agentViewEvents: [...SLACK_AGENT_VIEW_EVENTS],
      botScopes: uniqueStrings([
        ...SLACK_BOT_MESSAGE_SCOPES,
        ...SLACK_AGENT_VIEW_SCOPES,
        ...SLACK_FILE_DOWNLOAD_SCOPES,
        ...SLACK_FILE_UPLOAD_SCOPES,
      ]),
      socketModeScopes: [...SLACK_SOCKET_MODE_SCOPES],
      credentialFields: ["bot_token", "signing_secret", "app_level_token"],
      agentView: {
        enabled: true,
        requiredScope: "assistant:write",
        manifestFeature: "features.agent_view",
      },
      manifest,
    },
    commands,
    checklist: [
      {
        id: "configure_slack_app",
        status: "manual",
        detail: "Create or update the Slack app with the listed OAuth scopes and event subscriptions.",
      },
      {
        id: "callback_url",
        status: callbackUrl ? "ready" : "blocked",
        detail: callbackUrl && interactionCallbackUrl
          ? `${callbackUrl} ; ${interactionCallbackUrl}`
          : "Provide --app-url so AgentSpace can build the Slack Events and Interactivity callback URLs.",
      },
      {
        id: "health_check",
        status: readiness.integrations.some((item) => item.healthStatus === "healthy") ? "ready" : "blocked",
        detail: commands.healthCheck,
      },
      {
        id: "bindings",
        status: readiness.integrations.some((item) => item.bindings.activeChannels > 0 && item.bindings.activeUsers > 0) ? "ready" : "blocked",
        detail: "Bind one Slack channel and one Slack user before live message smoke.",
      },
      {
        id: "worker",
        status: readiness.readyForWorkerSmokeCount > 0 ? "ready" : "manual",
        detail: commands.workerDryRun,
      },
      {
        id: "live_post_message",
        status: readiness.readyForMessageSmokeCount > 0 ? "manual" : "blocked",
        detail: commands.livePostMessage,
      },
      {
        id: "live_app_mention",
        status: readiness.readyForMessageSmokeCount > 0 ? "manual" : "blocked",
        detail: commands.liveAppMention,
      },
      {
        id: "live_file_upload",
        status: readiness.readyForMessageSmokeCount > 0 ? "manual" : "blocked",
        detail: commands.liveFileUpload,
      },
      {
        id: "verify_live_evidence",
        status: readiness.readyForMessageSmokeCount > 0 ? "manual" : "blocked",
        detail: commands.verifyLiveEvidence,
      },
      {
        id: "final_evidence",
        status: readiness.strictSatisfied ? "manual" : "blocked",
        detail: commands.finalEvidence,
      },
    ],
  };
}

export function buildSlackSmokeEnvTemplateReport(input: {
  workspaceId: string;
  integrationId?: string;
  appUrl?: string;
  dependencies?: SlackReadinessDependencies;
}): SlackSmokeEnvTemplateReport {
  const dependencies = input.dependencies ?? {};
  const integrations = (dependencies.listIntegrations ?? listExternalIntegrationsSync)({
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
    includeDisabled: true,
  }).filter((integration) => !input.integrationId || integration.id === input.integrationId);
  const integration = integrations.find((item) => item.status === "active") ?? integrations[0];
  const appUrl = normalizeOptionalUrl(input.appUrl);
  const callbackUrl = appUrl ? `${appUrl}${SLACK_EVENT_CALLBACK_PATH}` : undefined;
  const missing = [
    ...(integration ? [] : ["integration"]),
    ...(appUrl ? [] : ["app_url"]),
  ];
  const integrationId = integration?.id ?? input.integrationId ?? "CHANGE_ME_SLACK_INTEGRATION_ID";
  const templateLines = [
    "# AgentSpace Slack smoke environment. Do not commit filled copies.",
    `AGENT_SPACE_WORKSPACE_ID=${input.workspaceId}`,
    `AGENT_SPACE_SLACK_INTEGRATION_ID=${integrationId}`,
    `AGENT_SPACE_PUBLIC_APP_URL=${appUrl ?? "https://agentspace.example.com"}`,
    `SLACK_SMOKE_CALLBACK_URL=${callbackUrl ?? "https://agentspace.example.com/api/integrations/slack/events"}`,
    "SLACK_SMOKE_CHANNEL_ID=CHANGE_ME_SLACK_CHANNEL_ID",
    "SLACK_SMOKE_USER_ID=CHANGE_ME_SLACK_USER_ID",
    "SLACK_SMOKE_APP_ID=CHANGE_ME_SLACK_APP_ID",
    "SLACK_SMOKE_TEAM_ID=CHANGE_ME_SLACK_TEAM_ID",
    "SLACK_SMOKE_BOT_USER_ID=",
    "SLACK_SMOKE_MESSAGE_TEXT=AgentSpace Slack smoke",
    "SLACK_SMOKE_THREAD_TS=",
    "SLACK_SMOKE_LIVE_MODE=post_message",
    "SLACK_SMOKE_POST_TOKEN=",
    "SLACK_SMOKE_FILE_NAME=agentspace-slack-smoke.txt",
    "SLACK_SMOKE_FILE_TITLE=AgentSpace Slack smoke file",
    "SLACK_SMOKE_FILE_CONTENT=AgentSpace Slack file smoke",
    "SLACK_SMOKE_FILE_MIME=text/plain",
    "AGENT_SPACE_SMOKE_CALLBACK_BASE_URL=",
  ];
  const liveSmokeEvidencePath = "runtime-output/slack-smoke/live.json";
  const nextCommands = [
    `agent-space integrations slack health-check --workspace-id ${input.workspaceId} --integration ${integrationId} --json`,
    `agent-space integrations slack readiness --workspace-id ${input.workspaceId} --integration ${integrationId} --strict --json`,
    "npm run smoke:slack -- --env-file scripts/slack/.env --check-env --json",
    "npm run smoke:slack -- --env-file scripts/slack/.env --replay-webhook --json",
    `npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence ${liveSmokeEvidencePath} --json`,
    `SLACK_SMOKE_LIVE_MODE=app_mention npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence ${liveSmokeEvidencePath} --json`,
    `SLACK_SMOKE_LIVE_MODE=file_upload npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence ${liveSmokeEvidencePath} --json`,
    "npm run smoke:slack:verify -- --env-file scripts/slack/.env --json",
    `agent-space integrations slack evidence --workspace-id ${input.workspaceId} --integration ${integrationId} --live-smoke-evidence ${liveSmokeEvidencePath} --strict --require all --json`,
  ];
  return {
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
    generatedAt: new Date().toISOString(),
    ready: missing.length === 0,
    integrationId: integration?.id ?? input.integrationId,
    appUrl,
    callbackUrl,
    missing,
    template: `${templateLines.join("\n")}\n`,
    nextCommands,
  };
}

export function buildSlackAgentViewAppManifest(input: {
  appName?: string;
  botDisplayName?: string;
  appUrl?: string;
  socketMode?: boolean;
  agentDescription?: string;
  suggestedPrompts?: SlackAppManifestSuggestedPrompt[];
} = {}): SlackAppManifest {
  const appName = truncateSlackManifestText(input.appName?.trim() || "AgentSpace", 35);
  const botDisplayName = normalizeSlackBotDisplayName(input.botDisplayName) || "agentspace";
  const appUrl = normalizeOptionalUrl(input.appUrl);
  const callbackUrl = appUrl
    ? `${appUrl}${SLACK_EVENT_CALLBACK_PATH}`
    : "https://agentspace.example.com/api/integrations/slack/events";
  const interactionCallbackUrl = appUrl
    ? `${appUrl}${SLACK_INTERACTION_CALLBACK_PATH}`
    : "https://agentspace.example.com/api/integrations/slack/interactions";
  return {
    _metadata: {
      major_version: 2,
      minor_version: 1,
    },
    display_information: {
      name: appName,
      description: "Governed AgentSpace agents in Slack.",
      background_color: "#1D4ED8",
    },
    features: {
      app_home: {
        home_tab_enabled: false,
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
      agent_view: {
        agent_description: truncateSlackManifestText(
          input.agentDescription?.trim()
            || "Talk to governed AgentSpace agents from Slack while keeping workspace permissions, approvals, and audit trails in AgentSpace.",
          300,
        ),
        suggested_prompts: normalizeSlackSuggestedPrompts(input.suggestedPrompts),
      },
      bot_user: {
        display_name: botDisplayName,
        always_online: false,
      },
    },
    oauth_config: {
      scopes: {
        bot: uniqueStrings([
          ...SLACK_BOT_MESSAGE_SCOPES,
          ...SLACK_AGENT_VIEW_SCOPES,
          ...SLACK_FILE_DOWNLOAD_SCOPES,
          ...SLACK_FILE_UPLOAD_SCOPES,
        ]),
      },
    },
    settings: {
      event_subscriptions: {
        request_url: callbackUrl,
        bot_events: uniqueStrings([...SLACK_REQUIRED_EVENTS, ...SLACK_AGENT_VIEW_EVENTS]),
      },
      interactivity: {
        is_enabled: true,
        request_url: interactionCallbackUrl,
      },
      socket_mode_enabled: Boolean(input.socketMode),
      org_deploy_enabled: false,
      token_rotation_enabled: false,
      is_hosted: false,
    },
  };
}

interface SlackReadinessDependencies {
  listIntegrations?: typeof listExternalIntegrationsSync;
  listChannelBindings?: typeof listExternalChannelBindingsSync;
  listUserBindings?: typeof listExternalUserBindingsSync;
  listOutbox?: typeof listExternalMessageOutboxSync;
}

function buildSlackReadinessIntegrationItem(input: {
  workspaceId: string;
  integration: ExternalIntegrationRecord;
  dependencies: SlackReadinessDependencies;
}): SlackReadinessIntegrationItem {
  const { integration } = input;
  const credentials = summarizeSlackStoredCredentials(integration);
  const configuredScopes = readJsonStringArray(integration.scopesJson);
  const missingConfiguredBotScopes = SLACK_BOT_MESSAGE_SCOPES.filter((scope) => !configuredScopes.includes(scope));
  const requiredSocketScopes = integration.transportMode === "websocket_worker" ? [...SLACK_SOCKET_MODE_SCOPES] : [];
  const missingConfiguredSocketScopes = requiredSocketScopes.filter((scope) => !configuredScopes.includes(scope));
  const channelBindings = (input.dependencies.listChannelBindings ?? listExternalChannelBindingsSync)({
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    status: "active",
  });
  const userBindings = (input.dependencies.listUserBindings ?? listExternalUserBindingsSync)({
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    status: "active",
  });
  const pendingOutbox = (input.dependencies.listOutbox ?? listExternalMessageOutboxSync)({
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    status: "pending",
    limit: 50,
  });
  const failedOutbox = (input.dependencies.listOutbox ?? listExternalMessageOutboxSync)({
    workspaceId: input.workspaceId,
    integrationId: integration.id,
    status: "failed",
    limit: 50,
  });
  const config = parseJsonRecord(integration.configJson) ?? {};
  const bot = parseJsonRecord(config.bot) ?? {};
  const blockers: string[] = [];
  const warnings: string[] = [];

  pushBlocker(blockers, integration.status === "active", "integration_not_active");
  pushBlocker(blockers, Boolean(integration.appId?.trim()), "slack_app_id_missing");
  pushBlocker(blockers, credentials.hasBotToken, "bot_token_missing");
  pushBlocker(blockers, credentials.hasSigningSecret, "signing_secret_missing");
  pushBlocker(blockers, channelBindings.length > 0, "channel_binding_missing");
  pushBlocker(blockers, userBindings.length > 0, "user_binding_missing");
  pushBlocker(blockers, integration.lastHealthStatus === "healthy", "health_check_required_or_unhealthy");
  if (missingConfiguredBotScopes.length > 0) {
    blockers.push(`configured_bot_scopes_missing:${missingConfiguredBotScopes.join(",")}`);
  }
  if (failedOutbox.length > 0) {
    blockers.push("failed_outbox_visible");
  }
  if (pendingOutbox.length > 0) {
    warnings.push("pending_outbox_messages");
  }
  if (readJsonStringArray(bot.missingScopes).length > 0) {
    blockers.push(`last_health_missing_scopes:${readJsonStringArray(bot.missingScopes).join(",")}`);
  }
  if (bot.scopeReviewStatus === "manual_review") {
    warnings.push("bot_scopes_manual_review_required");
  }

  const workerBlockers: string[] = [];
  if (integration.transportMode !== "websocket_worker") {
    workerBlockers.push("transport_mode_not_socket");
  }
  if (!credentials.hasAppLevelToken) {
    workerBlockers.push("app_level_token_missing");
  }
  if (missingConfiguredSocketScopes.length > 0) {
    workerBlockers.push(`configured_socket_scopes_missing:${missingConfiguredSocketScopes.join(",")}`);
  }

  const messageBlockers = [...blockers];
  const readyForMessageSmoke = messageBlockers.length === 0;
  const readyForWorkerSmoke = blockers.filter((item) =>
    !item.startsWith("channel_binding_missing") &&
    !item.startsWith("user_binding_missing") &&
    !item.startsWith("signing_secret_missing")).length === 0 && workerBlockers.length === 0;
  const allBlockers = [...new Set([...blockers, ...workerBlockers])];
  const integrationFlag = `--integration ${integration.id}`;
  return {
    integrationId: integration.id,
    displayName: integration.displayName,
    status: integration.status,
    transportMode: integration.transportMode,
    appIdPresent: Boolean(integration.appId?.trim()),
    teamIdPresent: Boolean(integration.tenantKey?.trim()),
    healthStatus: integration.lastHealthStatus,
    credentials,
    scopes: {
      configured: configuredScopes,
      requiredBotScopes: [...SLACK_BOT_MESSAGE_SCOPES],
      requiredSocketScopes,
      missingConfiguredBotScopes,
      missingConfiguredSocketScopes,
      lastGrantedScopes: readJsonStringArray(bot.grantedScopes),
      lastMissingScopes: readJsonStringArray(bot.missingScopes),
      lastScopeReviewStatus: bot.scopeReviewStatus === "verified" || bot.scopeReviewStatus === "manual_review" || bot.scopeReviewStatus === "missing"
        ? bot.scopeReviewStatus
        : undefined,
    },
    bindings: {
      activeChannels: channelBindings.length,
      activeUsers: userBindings.length,
    },
    outbox: {
      pending: pendingOutbox.length,
      failed: failedOutbox.length,
    },
    readyForMessageSmoke,
    readyForWorkerSmoke,
    blockers: allBlockers,
    warnings,
    nextCommands: [
      `agent-space integrations slack health-check --workspace-id ${input.workspaceId} ${integrationFlag} --json`,
      `agent-space integrations slack bind-channel --workspace-id ${input.workspaceId} ${integrationFlag} --channel CHANGE_ME_AGENTSPACE_CHANNEL --slack-channel CHANGE_ME_SLACK_CHANNEL_ID --json`,
      `agent-space integrations slack bind-user --workspace-id ${input.workspaceId} ${integrationFlag} --user-id CHANGE_ME_AGENTSPACE_USER_ID --slack-user CHANGE_ME_SLACK_USER_ID --json`,
      integration.transportMode === "websocket_worker"
        ? `agent-space integrations slack worker --workspace-id ${input.workspaceId} ${integrationFlag} --dry-run --json`
        : `agent-space integrations slack readiness --workspace-id ${input.workspaceId} ${integrationFlag} --strict --json`,
    ],
  };
}

function isSlackReadinessItemSatisfied(
  item: SlackReadinessIntegrationItem,
  required: SlackReadinessRequirement,
): boolean {
  if (required === "worker") {
    return item.readyForWorkerSmoke;
  }
  if (required === "all") {
    return item.readyForMessageSmoke && (item.transportMode === "websocket_worker" ? item.readyForWorkerSmoke : true);
  }
  return item.readyForMessageSmoke;
}

function pushBlocker(blockers: string[], condition: boolean, blocker: string): void {
  if (!condition) {
    blockers.push(blocker);
  }
}

async function maybeCheckSlackSocketMode(input: {
  appLevelToken?: string;
  baseUrl?: string;
  fetchImpl: typeof fetch;
  required: boolean;
  checks: SlackHealthCheckItem[];
}): Promise<SlackSocketModeHealthResult | undefined> {
  if (!input.required && !input.appLevelToken?.trim()) {
    return undefined;
  }
  const appLevelToken = input.appLevelToken?.trim();
  if (!appLevelToken) {
    const errorMessage = "Slack app-level token is missing for Socket Mode.";
    input.checks.push({
      name: "socket_mode",
      status: "fail",
      detail: errorMessage,
      nextStep: "Create an xapp token with connections:write and rotate the Slack integration.",
    });
    return {
      checked: true,
      ok: false,
      errorMessage,
    };
  }
  try {
    await openSlackSocketModeConnection({
      appLevelToken,
      baseUrl: input.baseUrl,
      fetchImpl: input.fetchImpl,
    });
    input.checks.push({
      name: "socket_mode",
      status: "pass",
      detail: "Slack apps.connections.open accepted the saved app-level token.",
    });
    return {
      checked: true,
      ok: true,
      urlAvailable: true,
    };
  } catch (error) {
    const message = sanitizeSlackHealthErrorMessage(error instanceof Error ? error.message : String(error), [appLevelToken])
      ?? "Slack Socket Mode health check failed.";
    input.checks.push({
      name: "socket_mode",
      status: "fail",
      detail: message,
      nextStep: "Confirm the app-level token has connections:write and Socket Mode is enabled.",
    });
    return {
      checked: true,
      ok: false,
      errorMessage: message,
    };
  }
}

function readSlackScopesHeader(value: string | null): string[] | undefined {
  const scopes = value
    ?.split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  return scopes && scopes.length > 0 ? [...new Set(scopes)].sort() : undefined;
}

function readJsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function normalizeOptionalUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\/+$/g, "");
  if (!trimmed || /CHANGE_ME|REPLACE_ME|example\.com/i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function normalizeSlackSuggestedPrompts(
  prompts: SlackAppManifestSuggestedPrompt[] | undefined,
): SlackAppManifestSuggestedPrompt[] {
  const normalized = (prompts && prompts.length > 0
    ? prompts
    : [
        {
          title: "Plan next steps",
          message: "Help me turn this request into a concrete plan with owners and next actions.",
        },
        {
          title: "Summarize context",
          message: "Summarize the relevant AgentSpace context and identify what still needs human approval.",
        },
      ]).map((prompt) => ({
        title: truncateSlackManifestText(prompt.title.trim(), 75),
        message: truncateSlackManifestText(prompt.message.trim(), 300),
      })).filter((prompt) => prompt.title && prompt.message);
  return normalized.slice(0, 4);
}

function normalizeSlackBotDisplayName(value: string | undefined): string | undefined {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || undefined;
}

function truncateSlackManifestText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength).trimEnd() : value;
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function sanitizeSlackHealthErrorMessage(
  message: string | undefined,
  sensitiveValues: Array<string | undefined>,
): string | undefined {
  if (!message) {
    return undefined;
  }
  let sanitized = message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(xoxb|xapp)-[A-Za-z0-9-]+/gi, "[redacted]");
  for (const value of sensitiveValues
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item))
    .sort((left, right) => right.length - left.length)) {
    sanitized = sanitized.split(value).join("[redacted]");
  }
  return sanitized.slice(0, 1000);
}

function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}
