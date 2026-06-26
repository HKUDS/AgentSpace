import {
  listExternalChannelBindingsSync,
  listExternalDataOperationRunsSync,
  listExternalIntegrationEventsSync,
  listExternalIntegrationsSync,
  listExternalMessageOutboxSync,
  listExternalResourceBindingsSync,
  listExternalUserBindingsSync,
  listStoredChannelsSync,
  listWorkspaceMemberUsersSync,
  type ExternalResourceBindingRecord,
  type WorkspaceRole,
} from "@agent-space/db";
import {
  FEISHU_AGENT_BOT_REQUIRED_CREDENTIAL_FIELDS,
  FEISHU_DEFAULT_SCOPES,
  FEISHU_EVENT_CALLBACK_PATH,
  FEISHU_FINAL_EVIDENCE_GATE_REQUIREMENTS,
  FEISHU_OPEN_PLATFORM_CONSOLE_URLS,
  FEISHU_OPEN_PLATFORM_SETUP_STEPS,
  FEISHU_PROVIDER_ID,
  FEISHU_REQUIRED_CREDENTIAL_FIELDS,
  FEISHU_REQUIRED_EVENTS,
  listActiveEmployeesSync,
  sanitizeFeishuOperationResponseSummary,
} from "@agent-space/services";
import { buildPublicAppUrl } from "@/features/auth/public-app-url";
import { hasWorkspaceRole } from "@/features/auth/workspace-permissions";
import { summarizeFeishuStoredCredentials } from "./feishu-credentials";
import {
  buildFeishuExternalIdReference,
  buildFeishuResourceReference,
} from "./feishu-resource-labels";
import type {
  FeishuAvailableChannelItem,
  FeishuAvailableAgentItem,
  FeishuAvailableUserItem,
  FeishuAgentBotChannelAutoProvisioningSettingsItem,
  FeishuAgentBotExternalGuestPolicySettingsItem,
  FeishuAgentBotSetupReference,
  FeishuChannelBindingSettingsItem,
  FeishuDataOperationRunSettingsItem,
  FeishuInboundBindingSuggestion,
  FeishuIntegrationCreationGuide,
  FeishuIntegrationSettingsItem,
  FeishuIntegrationEventSettingsItem,
  FeishuIntegrationSetupCheck,
  FeishuIntegrationSetupGuide,
  FeishuOutboxSettingsItem,
  FeishuResourceBindingSettingsItem,
  FeishuUserBindingSettingsItem,
} from "./feishu-types";

const FEISHU_SMOKE_EVIDENCE_PATH = "runtime-output/feishu-smoke/live.json";
const FEISHU_PUBLIC_APP_URL_PLACEHOLDER = "CHANGE_ME_PUBLIC_AGENTSPACE_URL";
const FEISHU_SECOND_AGENT_NAME_PLACEHOLDER = "CHANGE_ME_SECOND_AGENT_NAME";

export function listFeishuIntegrationSettingsItems(input: {
  workspaceId: string;
  appUrl?: string;
  viewer?: {
    role: WorkspaceRole;
    userId: string;
  };
}): FeishuIntegrationSettingsItem[] {
  const canManage = canManageFeishuIntegrations(input.viewer?.role);
  return listExternalIntegrationsSync({
    workspaceId: input.workspaceId,
    provider: FEISHU_PROVIDER_ID,
    includeDisabled: true,
  }).map((integration) => {
    const credentialSummary = summarizeFeishuStoredCredentials(integration);
    const channelBindings = canManage
      ? listExternalChannelBindingsSync({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
      })
      : [];
    const userBindings = listExternalUserBindingsSync({
      workspaceId: input.workspaceId,
      integrationId: integration.id,
    }).filter((binding) => canManage || binding.userId === input.viewer?.userId);
    const resourceBindings = canManage
      ? listExternalResourceBindingsSync({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
      })
      : [];
    const operationRuns = canManage
      ? listExternalDataOperationRunsSync({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        limit: 10,
      })
      : [];
    const inboundEvents = canManage
      ? listExternalIntegrationEventsSync({
        workspaceId: input.workspaceId,
        provider: FEISHU_PROVIDER_ID,
        integrationId: integration.id,
        limit: 10,
      })
      : [];
    const failedOutboxItems = canManage
      ? listExternalMessageOutboxSync({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        status: "failed",
        limit: 5,
      })
      : [];
    const pendingOutboxItems = canManage
      ? listExternalMessageOutboxSync({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        status: "pending",
        limit: 5,
      }).filter((item) => Boolean(item.lastError))
      : [];
    const userBindingItems = userBindings.map((binding): FeishuUserBindingSettingsItem => ({
      id: binding.id,
      integrationId: binding.integrationId,
      userId: binding.userId,
      externalUserReference: buildFeishuExternalIdReference({
        kind: "user",
        value: binding.externalUserId,
      }),
      externalUserIdRedacted: true,
      externalUnionReference: binding.externalUnionId ? buildFeishuExternalIdReference({
        kind: "union",
        value: binding.externalUnionId,
      }) : undefined,
      externalOpenReference: binding.externalOpenId ? buildFeishuExternalIdReference({
        kind: "user",
        value: binding.externalOpenId,
      }) : undefined,
      externalEmailReference: binding.externalEmail ? buildFeishuExternalIdReference({
        kind: "email",
        value: binding.externalEmail,
      }) : undefined,
      displayName: binding.displayName,
      status: binding.status,
      createdAt: binding.createdAt,
      updatedAt: binding.updatedAt,
      lastSeenAt: binding.lastSeenAt,
    }));
    const channelBindingItems = channelBindings.map((binding): FeishuChannelBindingSettingsItem => {
      const metadata = readFeishuBindingMetadata(binding.metadataJson);
      return {
        id: binding.id,
        integrationId: binding.integrationId,
        channelName: binding.channelName,
        externalChatReference: buildFeishuExternalIdReference({
          kind: "chat",
          value: binding.externalChatId,
        }),
        externalChatIdRedacted: true,
        externalChatType: binding.externalChatType,
        externalChatName: binding.externalChatName,
        status: binding.status,
        syncMode: binding.syncMode,
        provisionSource: readFeishuChannelProvisionSource(metadata),
        reviewStatus: readFeishuChannelReviewStatus(metadata),
        agentId: readMetadataString(metadata, "agentId"),
        botBindingId: readMetadataString(metadata, "botBindingId"),
        linkedFromBindingId: readMetadataString(metadata, "linkedFromBindingId"),
        createdAt: binding.createdAt,
        updatedAt: binding.updatedAt,
      };
    });
    const resourceBindingItems = resourceBindings.map((binding): FeishuResourceBindingSettingsItem => ({
      id: binding.id,
      integrationId: binding.integrationId,
      providerResourceType: binding.providerResourceType,
      providerResourceReference: buildFeishuResourceReference(binding),
      providerResourceTokenRedacted: true,
      agentSpaceResourceType: binding.agentSpaceResourceType,
      agentSpaceResourceId: binding.agentSpaceResourceId,
      channelName: binding.channelName,
      displayName: binding.displayName,
      canWrite: readResourceBindingCanWrite(binding.permissionsJson),
      guestReadable: readResourceBindingGuestReadable(binding.permissionsJson),
      status: binding.status,
      createdAt: binding.createdAt,
      updatedAt: binding.updatedAt,
    }));
    const operationRunItems = operationRuns.map((run): FeishuDataOperationRunSettingsItem => ({
      id: run.id,
      integrationId: run.integrationId,
      resourceBindingId: run.resourceBindingId,
      operationType: run.operationType,
      providerResourceType: run.providerResourceType,
      providerResourceReference: buildFeishuResourceReference(run),
      providerResourceTokenRedacted: true,
      actorType: run.actorType,
      actorId: run.actorId,
      governanceContext: readFeishuDataOperationGovernanceContext(run.requestJson),
      status: run.status,
      policyDecision: readPolicyDecision(run.resultJson) ?? readPolicyDecision(run.requestJson),
      responseSummary: readResponseSummary(run.resultJson),
      resultPreview: readResultPreview(run.resultJson),
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    }));
    const recentOutboxFailures = [...failedOutboxItems, ...pendingOutboxItems]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt))
      .slice(0, 5)
      .map((item): FeishuOutboxSettingsItem => {
        const metadata = readFeishuBindingMetadata(item.metadataJson);
        return {
          id: item.id,
          integrationId: item.integrationId,
          channelBindingId: item.channelBindingId,
          agentId: readMetadataString(metadata, "agentId"),
          botBindingId: readMetadataString(metadata, "botBindingId"),
          targetExternalChatReference: buildFeishuExternalIdReference({
            kind: "chat",
            value: item.targetExternalChatId,
          }),
          targetExternalChatIdRedacted: true,
          targetExternalThreadReference: item.targetExternalThreadId ? buildFeishuExternalIdReference({
            kind: "thread",
            value: item.targetExternalThreadId,
          }) : undefined,
          targetExternalThreadIdRedacted: item.targetExternalThreadId ? true : undefined,
          agentSpaceMessageId: item.agentSpaceMessageId,
          status: item.status,
          attempts: item.attempts,
          nextAttemptAt: item.nextAttemptAt,
          lastError: item.lastError,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      });
    const recentInboundEvents = inboundEvents.map((event): FeishuIntegrationEventSettingsItem => ({
      id: event.id,
      integrationId: event.integrationId,
      externalEventId: event.externalEventId,
      eventType: event.eventType,
      status: event.status,
      errorMessage: event.errorMessage,
      bindingSuggestion: buildFeishuInboundBindingSuggestion(event.errorMessage, event.payloadJson),
      receivedAt: event.receivedAt,
      processedAt: event.processedAt,
    }));
    const callbackUrl = canManage
      ? buildFeishuEventCallbackUrl({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        appUrl: input.appUrl,
      })
      : "";
    const activeResourceTypes = new Set(
      resourceBindingItems
        .filter((binding) => binding.status === "active")
        .map((binding) => binding.providerResourceType),
    );
    const activeWritableResourceTypes = new Set(
      resourceBindingItems
        .filter((binding) => binding.status === "active" && binding.canWrite)
        .map((binding) => binding.providerResourceType),
    );
    const activeResourceBindings = resourceBindings.filter((binding) => binding.status === "active");
    const baseResourceCount = activeResourceBindings.filter((binding) =>
      binding.providerResourceType === "base" ||
      binding.providerResourceType === "base_table" ||
      binding.providerResourceType === "base_view"
    ).length;
    const baseReadyResourceCount = activeResourceBindings.filter(isFeishuSettingsBaseBindingDataPlaneReady).length;
    const baseWritableResourceCount = activeResourceBindings.filter((binding) =>
      isFeishuSettingsBaseBindingDataPlaneReady(binding) && readResourceBindingCanWrite(binding.permissionsJson)
    ).length;

    return {
      id: integration.id,
      displayName: integration.displayName,
      status: integration.status,
      transportMode: integration.transportMode,
      agentId: canManage ? integration.agentId : undefined,
      appId: canManage ? integration.appId : undefined,
      tenantKey: canManage ? integration.tenantKey : undefined,
      callbackUrl,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
      lastHealthStatus: canManage ? integration.lastHealthStatus : undefined,
      lastHealthCheckedAt: canManage ? integration.lastHealthCheckedAt : undefined,
      lastError: canManage ? integration.lastError : undefined,
      hasAppSecret: canManage && credentialSummary.hasAppSecret,
      hasVerificationToken: canManage && credentialSummary.hasVerificationToken,
      hasEncryptKey: canManage && credentialSummary.hasEncryptKey,
      userBindingCount: userBindingItems.filter((binding) => binding.status === "active").length,
      channelBindingCount: channelBindingItems.filter((binding) => binding.status === "active").length,
      resourceBindingCount: resourceBindingItems.filter((binding) => binding.status === "active").length,
      operationRunCount: operationRunItems.length,
      outboxFailureCount: recentOutboxFailures.length,
      userBindings: userBindingItems,
      channelBindings: channelBindingItems,
      resourceBindings: resourceBindingItems,
      operationRuns: operationRunItems,
      recentOutboxFailures,
      recentInboundEvents,
      channelAutoProvisioning: canManage && integration.agentId
        ? readFeishuAgentBotChannelAutoProvisioning(integration.configJson)
        : undefined,
      externalGuestPolicy: canManage && integration.agentId
        ? readFeishuAgentBotExternalGuestPolicy(integration.configJson)
        : undefined,
      setupGuide: canManage
        ? buildFeishuIntegrationSetupGuide({
          workspaceId: input.workspaceId,
          integrationId: integration.id,
          agentId: integration.agentId,
          transportMode: integration.transportMode,
          appUrl: input.appUrl,
          checks: buildFeishuIntegrationSetupChecks({
            transportMode: integration.transportMode,
            callbackUrl,
            hasAppSecret: credentialSummary.hasAppSecret,
            hasVerificationToken: credentialSummary.hasVerificationToken,
            hasEncryptKey: credentialSummary.hasEncryptKey,
            lastHealthStatus: integration.lastHealthStatus,
            channelBindingCount: channelBindingItems.filter((binding) => binding.status === "active").length,
            userBindingCount: userBindingItems.filter((binding) => binding.status === "active").length,
            activeResourceTypes,
            activeWritableResourceTypes,
            baseResourceCount,
            baseReadyResourceCount,
            baseWritableResourceCount,
            outboxFailureCount: recentOutboxFailures.length,
          }),
        })
        : undefined,
    };
  });
}

export function canManageFeishuIntegrations(role?: WorkspaceRole): boolean {
  return role === undefined || hasWorkspaceRole(role, "admin");
}

export function buildFeishuIntegrationCreationGuide(input: {
  workspaceId: string;
  appUrl?: string;
}): FeishuIntegrationCreationGuide {
  const callbackUrlTemplate = buildFeishuEventCallbackUrl({
    workspaceId: input.workspaceId,
    integrationId: "created-integration-id",
    appUrl: input.appUrl,
  });
  return {
    requiredCredentialFields: [...FEISHU_REQUIRED_CREDENTIAL_FIELDS],
    requiredEvents: [...FEISHU_REQUIRED_EVENTS],
    requiredScopes: [...FEISHU_DEFAULT_SCOPES],
    eventCallbackPath: FEISHU_EVENT_CALLBACK_PATH,
    publicAppUrlStatus: input.appUrl?.trim() ? "configured" : "missing",
    ...(input.appUrl?.trim() ? { publicAppUrl: input.appUrl.trim() } : {}),
    callbackUrlTemplate,
    developerConsoleUrl: FEISHU_OPEN_PLATFORM_CONSOLE_URLS.appList,
    openPlatformSetupSteps: buildFeishuOpenPlatformSetupSteps(),
  };
}

export function buildFeishuAgentBotSetupReference(): FeishuAgentBotSetupReference {
  return {
    requiredCredentialFields: [...FEISHU_AGENT_BOT_REQUIRED_CREDENTIAL_FIELDS],
    requiredEvents: [...FEISHU_REQUIRED_EVENTS],
    requiredScopes: [...FEISHU_DEFAULT_SCOPES],
    eventCallbackPath: FEISHU_EVENT_CALLBACK_PATH,
  };
}

export function listFeishuAvailableChannels(input: {
  workspaceId: string;
}): FeishuAvailableChannelItem[] {
  return listStoredChannelsSync(input.workspaceId).map((channel) => ({
    name: channel.name,
    kind: channel.kind,
  }));
}

export function listFeishuAvailableAgents(_input: {
  workspaceId: string;
}): FeishuAvailableAgentItem[] {
  return listActiveEmployeesSync().map((agent) => ({
    id: agent.name,
    name: agent.name,
    role: agent.role,
    remarkName: agent.remarkName,
  }));
}

export function listFeishuAvailableUsers(input: {
  workspaceId: string;
}): FeishuAvailableUserItem[] {
  return listWorkspaceMemberUsersSync(input.workspaceId).map((member) => ({
    userId: member.userId,
    displayName: member.displayName,
    primaryEmail: member.primaryEmail,
    role: member.role,
  }));
}

export function buildFeishuEventCallbackUrl(input: {
  workspaceId: string;
  integrationId: string;
  appUrl?: string;
}): string {
  const searchParams = new URLSearchParams({
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
  });
  return buildPublicAppUrl(`${FEISHU_EVENT_CALLBACK_PATH}?${searchParams.toString()}`, input.appUrl);
}

function buildFeishuIntegrationSetupGuide(input: {
  workspaceId: string;
  integrationId: string;
  agentId?: string;
  transportMode: string;
  appUrl?: string;
  checks: FeishuIntegrationSetupCheck[];
}): FeishuIntegrationSetupGuide {
  const flags = `--workspace-id ${input.workspaceId} --integration ${input.integrationId}`;
  const agentFlags = input.agentId
    ? `--workspace-id ${input.workspaceId} --agent ${input.agentId}`
    : flags;
  const readinessCommand = input.agentId
    ? "agent-bot-readiness"
    : "readiness";
  const appUrlFlag = `--app-url ${input.appUrl?.trim() || FEISHU_PUBLIC_APP_URL_PLACEHOLDER}`;
  return {
    requiredCredentialFields: resolveFeishuSetupGuideRequiredCredentialFields({
      agentId: input.agentId,
      transportMode: input.transportMode,
    }),
    requiredEvents: [...FEISHU_REQUIRED_EVENTS],
    requiredScopes: [...FEISHU_DEFAULT_SCOPES],
    eventCallbackPath: FEISHU_EVENT_CALLBACK_PATH,
    developerConsoleUrl: FEISHU_OPEN_PLATFORM_CONSOLE_URLS.appList,
    openPlatformSetupSteps: buildFeishuOpenPlatformSetupSteps(),
    checks: input.checks,
    evidenceGates: buildFeishuEvidenceGates(input.transportMode),
    commands: {
      healthCheck: `agent-space integrations feishu health-check ${agentFlags} --strict --json`,
      bindSecondAgentBot: `agent-space integrations feishu bind-agent-bot --workspace-id ${input.workspaceId} --agent ${FEISHU_SECOND_AGENT_NAME_PLACEHOLDER} --env-file scripts/feishu/.env --app-id-env FEISHU_SECOND_AGENT_APP_ID --app-secret-env FEISHU_SECOND_AGENT_APP_SECRET --json`,
      botReadiness: `agent-space integrations feishu ${readinessCommand} ${agentFlags} --strict --require bot --json`,
      dataPlaneReadiness: `agent-space integrations feishu ${readinessCommand} ${agentFlags} --strict --require data-plane --json`,
      workerReadiness: `agent-space integrations feishu ${readinessCommand} ${agentFlags} --strict --require worker --json`,
      ...(input.agentId
        ? {
          autoProvisionPolicy: `agent-space integrations feishu auto-provision-policy ${agentFlags} --bot-added-policy auto_create_channel --first-message-policy auto_create_if_bot_mentioned --unbound-user-mode reply_on_mention --guest-permission-profile channel_context_only --json`,
          channelBindings: `agent-space integrations feishu channel-bindings ${flags} --json`,
        }
        : {}),
      smokeEnv: `agent-space integrations feishu smoke-env ${flags} ${appUrlFlag} > scripts/feishu/.env`,
      checkEnv: "npm run smoke:feishu -- --env-file scripts/feishu/.env --check-env --json --require-todo120-native",
      strictLiveSmoke: `npm run smoke:feishu -- --env-file scripts/feishu/.env --live --strict-live --evidence ${FEISHU_SMOKE_EVIDENCE_PATH} --json --require-todo120-native`,
      verifyOpenApiEvidence: `npm run smoke:feishu -- --verify-evidence ${FEISHU_SMOKE_EVIDENCE_PATH} --json`,
      smokePlan: `agent-space integrations feishu smoke-plan ${flags} ${appUrlFlag} --json`,
      evidence: `agent-space integrations feishu evidence ${flags} --openapi-evidence ${FEISHU_SMOKE_EVIDENCE_PATH} --strict --require all --json`,
    },
  };
}

function buildFeishuOpenPlatformSetupSteps(): FeishuIntegrationSetupGuide["openPlatformSetupSteps"] {
  return FEISHU_OPEN_PLATFORM_SETUP_STEPS.map((step) => ({
    id: step.id,
    consoleUrl: step.consoleUrl,
    required: [...step.required],
  }));
}

function resolveFeishuSetupGuideRequiredCredentialFields(input: {
  agentId?: string;
  transportMode: string;
}): string[] {
  return input.agentId && input.transportMode === "websocket_worker"
    ? [...FEISHU_AGENT_BOT_REQUIRED_CREDENTIAL_FIELDS]
    : [...FEISHU_REQUIRED_CREDENTIAL_FIELDS];
}

function buildFeishuEvidenceGates(transportMode: string): FeishuIntegrationSetupGuide["evidenceGates"] {
  return [
    {
      key: "bot_reply",
      required: FEISHU_FINAL_EVIDENCE_GATE_REQUIREMENTS.botReply,
    },
    {
      key: "native_agent_bot",
      required: FEISHU_FINAL_EVIDENCE_GATE_REQUIREMENTS.nativeAgentBot,
    },
    {
      key: "guest_policy",
      required: FEISHU_FINAL_EVIDENCE_GATE_REQUIREMENTS.guestPolicy,
    },
    ...(transportMode === "websocket_worker"
      ? [{
        key: "worker_restart" as const,
        required: FEISHU_FINAL_EVIDENCE_GATE_REQUIREMENTS.workerRestart,
      }, {
        key: "worker_card_action" as const,
        required: FEISHU_FINAL_EVIDENCE_GATE_REQUIREMENTS.workerCardAction,
      }]
      : []),
    {
      key: "data_plane",
      required: FEISHU_FINAL_EVIDENCE_GATE_REQUIREMENTS.dataPlane,
    },
    {
      key: "failure_visibility",
      required: FEISHU_FINAL_EVIDENCE_GATE_REQUIREMENTS.failureVisibility,
    },
    {
      key: "openapi_artifact",
      required: `strict_live_artifact:${FEISHU_SMOKE_EVIDENCE_PATH}`,
    },
  ];
}

function buildFeishuIntegrationSetupChecks(input: {
  transportMode: string;
  callbackUrl: string;
  hasAppSecret: boolean;
  hasVerificationToken: boolean;
  hasEncryptKey: boolean;
  lastHealthStatus?: string;
  channelBindingCount: number;
  userBindingCount: number;
  activeResourceTypes: Set<string>;
  activeWritableResourceTypes: Set<string>;
  baseResourceCount: number;
  baseReadyResourceCount: number;
  baseWritableResourceCount: number;
  outboxFailureCount: number;
}): FeishuIntegrationSetupCheck[] {
  const requiresVerificationToken = input.transportMode === "http_webhook";
  const hasCoreCredentials = input.hasAppSecret && (!requiresVerificationToken || input.hasVerificationToken);
  const missingRecommendedEncryptKey = requiresVerificationToken && hasCoreCredentials && !input.hasEncryptKey;
  const callbackStatus = resolveFeishuCallbackOrWorkerStatus({
    transportMode: input.transportMode,
    callbackUrl: input.callbackUrl,
  });
  const healthStatus = input.lastHealthStatus === "healthy"
    ? "ready"
    : input.lastHealthStatus && input.lastHealthStatus !== "unknown"
      ? "attention"
      : "missing";
  const hasDocBinding = input.activeResourceTypes.has("doc");
  const hasSheetBinding = input.activeResourceTypes.has("sheet");
  const hasWritableDocBinding = input.activeWritableResourceTypes.has("doc");
  const hasWritableSheetBinding = input.activeWritableResourceTypes.has("sheet");

  return [
    {
      key: "credentials",
      status: hasCoreCredentials
        ? missingRecommendedEncryptKey ? "attention" : "ready"
        : "missing",
      current: hasCoreCredentials && !missingRecommendedEncryptKey
        ? "complete"
        : missingRecommendedEncryptKey
          ? "missing_encrypt_key"
          : "incomplete",
      required: requiresVerificationToken
        ? "app_id/app_secret/verification_token"
        : "app_id/app_secret",
    },
    {
      key: "callback_or_worker",
      status: callbackStatus,
      current: input.transportMode === "websocket_worker"
        ? "websocket_worker"
        : input.callbackUrl.startsWith("http")
          ? "public_callback"
          : "relative_callback",
      required: "https_callback_or_websocket_worker",
    },
    {
      key: "health",
      status: healthStatus,
      current: input.lastHealthStatus ?? "unknown",
      required: "healthy",
    },
    {
      key: "chat_binding",
      status: input.channelBindingCount > 0 ? "ready" : "missing",
      current: input.channelBindingCount,
      required: 1,
    },
    {
      key: "user_binding",
      status: input.userBindingCount > 0 ? "ready" : "missing",
      current: input.userBindingCount,
      required: 1,
    },
    {
      key: "doc_binding",
      status: hasWritableDocBinding ? "ready" : hasDocBinding ? "attention" : "missing",
      current: hasWritableDocBinding ? 1 : hasDocBinding ? "0/1" : 0,
      required: "1 writable binding",
    },
    {
      key: "sheet_binding",
      status: hasWritableSheetBinding ? "ready" : hasSheetBinding ? "attention" : "missing",
      current: hasWritableSheetBinding ? 1 : hasSheetBinding ? "0/1" : 0,
      required: "1 writable binding",
    },
    buildFeishuBaseSetupCheck(input.baseResourceCount, input.baseReadyResourceCount, input.baseWritableResourceCount),
    {
      key: "outbox",
      status: input.outboxFailureCount === 0 ? "ready" : "attention",
      current: input.outboxFailureCount,
      required: 0,
    },
  ];
}

function buildFeishuBaseSetupCheck(
  baseResourceCount: number,
  baseReadyResourceCount: number,
  baseWritableResourceCount: number,
): FeishuIntegrationSetupCheck {
  if (baseWritableResourceCount > 0) {
    return {
      key: "base_binding",
      status: "ready",
      current: baseWritableResourceCount,
      required: "1 writable data-plane-ready Base binding",
    };
  }
  if (baseReadyResourceCount > 0) {
    return {
      key: "base_binding",
      status: "attention",
      current: `${baseWritableResourceCount}/${baseReadyResourceCount}`,
      required: "1 writable data-plane-ready Base binding",
    };
  }
  if (baseResourceCount > 0) {
    return {
      key: "base_binding",
      status: "attention",
      current: `${baseReadyResourceCount}/${baseResourceCount}`,
      required: "1 data-plane-ready Base binding",
    };
  }
  return {
    key: "base_binding",
    status: "missing",
    current: 0,
    required: 1,
  };
}

function isFeishuSettingsBaseBindingDataPlaneReady(binding: ExternalResourceBindingRecord): boolean {
  if (binding.providerResourceType === "base") {
    return Boolean(binding.providerResourceToken.trim());
  }
  if (binding.providerResourceType !== "base_table" && binding.providerResourceType !== "base_view") {
    return false;
  }
  const metadata = readFeishuBindingMetadata(binding.metadataJson);
  const appToken = readMetadataString(metadata, "appToken") ?? readMetadataString(metadata, "baseToken");
  const tableId = binding.providerResourceType === "base_table"
    ? binding.providerResourceToken.trim()
    : readMetadataString(metadata, "tableId");
  return Boolean(appToken && tableId);
}

function readFeishuBindingMetadata(metadataJson: string | null | undefined): Record<string, unknown> {
  if (!metadataJson) {
    return {};
  }
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function readMetadataString(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function readFeishuChannelProvisionSource(
  metadata: Record<string, unknown>,
): FeishuChannelBindingSettingsItem["provisionSource"] {
  return readAllowedValue(metadata.provisionSource, [
    "manual",
    "bot_added",
    "first_message",
    "agentspace_created",
  ] as const);
}

function readFeishuChannelReviewStatus(
  metadata: Record<string, unknown>,
): FeishuChannelBindingSettingsItem["reviewStatus"] {
  return readAllowedValue(metadata.reviewStatus, [
    "approved",
    "pending_admin_review",
    "needs_identity_binding",
  ] as const);
}

function readFeishuAgentBotChannelAutoProvisioning(
  configJson: unknown,
): FeishuAgentBotChannelAutoProvisioningSettingsItem | undefined {
  const config = parseConfigRecord(configJson);
  const policy = asRecord(config?.channelAutoProvisioning);
  if (!policy) {
    return {
      botAdded: "auto_create_channel",
      firstMessage: "auto_create_if_bot_mentioned",
      reviewStatus: "approved",
    };
  }
  const botAdded = readAllowedValue(policy.botAdded, [
    "auto_create_channel",
    "pending_admin_review",
    "disabled",
  ] as const);
  const firstMessage = readAllowedValue(policy.firstMessage, [
    "auto_create_if_bot_mentioned",
    "pending_admin_review",
    "reply_with_setup_card",
    "disabled",
  ] as const);
  const reviewStatus = readAllowedValue(policy.reviewStatus, [
    "approved",
    "pending_admin_review",
    "needs_identity_binding",
  ] as const);
  return {
    botAdded: botAdded ?? "auto_create_channel",
    firstMessage: firstMessage ?? "auto_create_if_bot_mentioned",
    reviewStatus: reviewStatus ?? "approved",
  };
}

function readFeishuAgentBotExternalGuestPolicy(
  configJson: unknown,
): FeishuAgentBotExternalGuestPolicySettingsItem | undefined {
  const config = parseConfigRecord(configJson);
  const policy = asRecord(config?.externalGuestPolicy);
  if (!policy) {
    return {
      unboundUserMode: "reply_on_mention",
      guestPermissionProfile: "channel_context_only",
      requireIdentityFor: [
        "writes",
        "approvals",
        "private_resources",
        "runtime_sensitive_tools",
      ],
    };
  }
  const unboundUserMode = readAllowedValue(policy.unboundUserMode, [
    "ignore",
    "reply_on_mention",
    "reply_all",
    "require_identity",
  ] as const);
  const guestPermissionProfile = readAllowedValue(policy.guestPermissionProfile, [
    "none",
    "channel_context_only",
    "channel_readonly",
  ] as const);
  return {
    unboundUserMode: unboundUserMode ?? "reply_on_mention",
    guestPermissionProfile: guestPermissionProfile ?? "channel_context_only",
    requireIdentityFor: readFeishuExternalGuestIdentityRequirements(policy.requireIdentityFor),
  };
}

function readFeishuExternalGuestIdentityRequirements(value: unknown): string[] {
  const defaultRequirements = [
    "writes",
    "approvals",
    "private_resources",
    "runtime_sensitive_tools",
  ];
  if (!Array.isArray(value)) {
    return defaultRequirements;
  }
  if (value.length === 0) {
    return [];
  }
  const normalized = value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter((item) =>
      item === "writes" ||
      item === "approvals" ||
      item === "private_resources" ||
      item === "runtime_sensitive_tools"
    );
  return normalized.length > 0 ? Array.from(new Set(normalized)) : defaultRequirements;
}

function parseConfigRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    return parseJsonRecord(value);
  }
  return asRecord(value);
}

function readAllowedValue<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
): T | undefined {
  return typeof value === "string" && allowedValues.includes(value as T)
    ? value as T
    : undefined;
}

function resolveFeishuCallbackOrWorkerStatus(input: {
  transportMode: string;
  callbackUrl: string;
}): FeishuIntegrationSetupCheck["status"] {
  if (input.transportMode === "websocket_worker") {
    return "ready";
  }
  if (input.callbackUrl.startsWith("https://")) {
    return "ready";
  }
  if (input.callbackUrl.startsWith("http://")) {
    return "attention";
  }
  return "missing";
}

function buildFeishuInboundBindingSuggestion(
  reasonCode: string | undefined,
  payloadJson: string,
): FeishuInboundBindingSuggestion | undefined {
  if (reasonCode !== "external_channel_unbound" && reasonCode !== "external_user_unbound") {
    return undefined;
  }
  const payload = parseJsonRecord(payloadJson);
  if (!payload) {
    return undefined;
  }
  const message = asRecord(payload.message);
  const sender = asRecord(payload.sender);
  if (reasonCode === "external_channel_unbound") {
    const safeChatReference = asString(message?.chatReference) ?? asString(message?.externalChatReference);
    if (safeChatReference) {
      return {
        kind: "channel",
        externalChatReference: safeChatReference,
        externalChatIdRedacted: true,
      };
    }
    const externalChatId = asString(message?.chatId);
    return externalChatId
      ? {
        kind: "channel",
        externalChatReference: buildFeishuExternalIdReference({
          kind: "chat",
          value: externalChatId,
        }),
        externalChatIdRedacted: true,
      }
      : undefined;
  }

  const safeUserReference = asString(sender?.openIdReference)
    ?? asString(sender?.userReference)
    ?? asString(sender?.externalUserReference);
  const externalUserId = asString(sender?.openId);
  if (!safeUserReference && !externalUserId) {
    return undefined;
  }
  const safeUnionReference = asString(sender?.unionIdReference) ?? asString(sender?.externalUnionReference);
  const safeOpenReference = asString(sender?.userIdReference) ?? asString(sender?.externalOpenReference);
  const externalUnionId = asString(sender?.unionId);
  const externalOpenId = asString(sender?.userId);
  return {
    kind: "user",
    externalUserReference: safeUserReference ?? buildFeishuExternalIdReference({
      kind: "user",
      value: externalUserId,
    }),
    externalUserIdRedacted: true,
    externalUnionReference: safeUnionReference ?? (externalUnionId
      ? buildFeishuExternalIdReference({
        kind: "union",
        value: externalUnionId,
      })
      : undefined),
    externalUnionIdRedacted: safeUnionReference || externalUnionId ? true : undefined,
    externalOpenReference: safeOpenReference ?? (externalOpenId
      ? buildFeishuExternalIdReference({
        kind: "user",
        value: externalOpenId,
      })
      : undefined),
    externalOpenIdRedacted: safeOpenReference || externalOpenId ? true : undefined,
  };
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(value) as unknown);
  } catch {
    return undefined;
  }
}

function readResourceBindingCanWrite(permissionsJson: string): boolean {
  const permissions = parseJsonRecord(permissionsJson);
  return permissions?.canWrite === true || permissions?.write === true;
}

function readResourceBindingGuestReadable(permissionsJson: string): boolean {
  const permissions = parseJsonRecord(permissionsJson);
  const externalGuest = asRecord(permissions?.externalGuest)
    ?? asRecord(permissions?.external_guest);
  return permissions?.guestReadable === true ||
    permissions?.externalGuestReadable === true ||
    externalGuest?.read === true ||
    externalGuest?.canRead === true;
}

function readFeishuDataOperationGovernanceContext(
  requestJson: string,
): FeishuDataOperationRunSettingsItem["governanceContext"] {
  const parsed = parseJsonRecord(requestJson);
  const context = asRecord(parsed?.governanceContext);
  if (!context || context.provider !== FEISHU_PROVIDER_ID) {
    return undefined;
  }
  const actorType = readGovernanceActorType(asString(context.actorType));
  return {
    provider: FEISHU_PROVIDER_ID,
    actorType,
    agentId: asString(context.agentId),
    botBindingId: asString(context.botBindingId),
    channelName: asString(context.channelName),
    actorUserId: actorType === "user" ? asString(context.actorUserId) : undefined,
    externalActorReference: actorType === "external_guest" ? asString(context.externalActorReference) : undefined,
    externalGuestPermissionProfile: actorType === "external_guest"
      ? asString(context.externalGuestPermissionProfile)
      : undefined,
  };
}

function readGovernanceActorType(
  value: string | undefined,
): "user" | "external_guest" | "agent" | "system" | undefined {
  return value === "user" || value === "external_guest" || value === "agent" || value === "system"
    ? value
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPolicyDecision(requestJson: string): string | undefined {
  try {
    const parsed = JSON.parse(requestJson) as Record<string, unknown>;
    return typeof parsed.policyDecision === "string" ? parsed.policyDecision : undefined;
  } catch {
    return undefined;
  }
}

function readResponseSummary(resultJson: string): string | undefined {
  try {
    const parsed = JSON.parse(resultJson) as Record<string, unknown>;
    if (typeof parsed.responseSummary === "string" && parsed.responseSummary.trim()) {
      return "responseSummaryRedacted: true";
    }
    return formatResponseSummary(sanitizeFeishuOperationResponseSummary(asRecord(parsed.responseSummary)));
  } catch {
    return undefined;
  }
}

function formatResponseSummary(summary: Record<string, unknown> | undefined): string | undefined {
  if (!summary || Object.keys(summary).length === 0) {
    return undefined;
  }
  return Object.entries(summary)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join(", ");
}

function readResultPreview(resultJson: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(resultJson) as Record<string, unknown>;
    const resultPreview = parsed.resultPreview;
    return resultPreview && typeof resultPreview === "object" && !Array.isArray(resultPreview)
      ? resultPreview as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}
