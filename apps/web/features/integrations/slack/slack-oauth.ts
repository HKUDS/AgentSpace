import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import {
  createExternalIntegrationSync,
  listExternalIntegrationsSync,
  updateExternalIntegrationConfigSync,
  updateExternalIntegrationCredentialsSync,
  updateExternalIntegrationStatusSync,
  type ExternalIntegrationRecord,
  type ExternalIntegrationTransportMode,
} from "@agent-space/db";
import {
  buildEncryptedSlackCredentials,
  SLACK_DEFAULT_SCOPES,
  SLACK_EVENT_CALLBACK_PATH,
  SLACK_PROVIDER_ID,
  SLACK_SOCKET_MODE_SCOPES,
  tryRecordWorkspaceAuditEventSync,
} from "@agent-space/services";
import { readServerEnvValue } from "@/features/auth/server-env";

const SLACK_OAUTH_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const SLACK_OAUTH_STATE_COOKIE = "agent_space_slack_oauth_state";
const SLACK_OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

interface SlackOAuthStatePayload {
  csrf: string;
  workspaceId: string;
  userId: string;
  displayName?: string;
  transportMode: ExternalIntegrationTransportMode;
  redirectAfter?: string;
  createdAt: number;
}

export interface SlackOAuthConfig {
  appUrl: string;
  clientId: string;
  clientSecret: string;
  signingSecret: string;
  callbackUrl: string;
  stateSecret: string;
  appLevelToken?: string;
  apiBaseUrl?: string;
}

interface SlackOAuthAccessResult {
  ok: boolean;
  accessToken?: string;
  botUserId?: string;
  appId?: string;
  teamId?: string;
  teamName?: string;
  scopes: string[];
  errorCode?: string;
  errorMessage?: string;
}

export function readSlackOAuthConfig(): SlackOAuthConfig {
  const appUrl = readRequiredSlackOAuthEnv("AGENT_SPACE_APP_URL");
  const clientId = readRequiredSlackOAuthEnv("AGENT_SPACE_SLACK_CLIENT_ID");
  const clientSecret = readRequiredSlackOAuthEnv("AGENT_SPACE_SLACK_CLIENT_SECRET");
  const signingSecret = readRequiredSlackOAuthEnv("AGENT_SPACE_SLACK_SIGNING_SECRET");
  const callbackUrl = readServerEnvValue("AGENT_SPACE_SLACK_OAUTH_CALLBACK_URL")?.trim()
    || `${appUrl}/api/integrations/slack/oauth/callback`;
  const stateSecret = readRequiredSlackOAuthEnv("AGENT_SPACE_OAUTH_STATE_SECRET");
  const appLevelToken = readServerEnvValue("AGENT_SPACE_SLACK_APP_LEVEL_TOKEN")?.trim()
    || readServerEnvValue("SLACK_APP_TOKEN")?.trim()
    || undefined;
  const apiBaseUrl = readServerEnvValue("AGENT_SPACE_SLACK_API_BASE_URL")?.trim() || undefined;
  return {
    appUrl,
    clientId,
    clientSecret,
    signingSecret,
    callbackUrl,
    stateSecret,
    appLevelToken,
    apiBaseUrl,
  };
}

export async function createSlackOAuthAuthorizationUrl(input: {
  workspaceId: string;
  userId: string;
  displayName?: string;
  transportMode?: ExternalIntegrationTransportMode;
  redirectAfter?: string;
}): Promise<string> {
  const config = readSlackOAuthConfig();
  const transportMode = input.transportMode === "websocket_worker" ? "websocket_worker" : "http_webhook";
  if (transportMode === "websocket_worker" && !config.appLevelToken) {
    throw new Error("slack.oauth.app_level_token_missing");
  }
  const statePayload: SlackOAuthStatePayload = {
    csrf: randomBytes(16).toString("hex"),
    workspaceId: input.workspaceId,
    userId: input.userId,
    displayName: input.displayName?.trim() || undefined,
    transportMode,
    redirectAfter: normalizeSlackOAuthRedirectAfter(input.redirectAfter),
    createdAt: Date.now(),
  };
  const state = signSlackOAuthState(statePayload, config.stateSecret);
  const cookieStore = await cookies();
  cookieStore.set(SLACK_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: SLACK_OAUTH_STATE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    scope: SLACK_DEFAULT_SCOPES.join(","),
    state,
  });
  return `${SLACK_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export async function verifySlackOAuthCallbackState(state: string): Promise<{
  workspaceId: string;
  userId: string;
  displayName?: string;
  transportMode: ExternalIntegrationTransportMode;
  redirectAfter?: string;
}> {
  const config = readSlackOAuthConfig();
  const cookieStore = await cookies();
  const cookieState = cookieStore.get(SLACK_OAUTH_STATE_COOKIE)?.value?.trim();
  cookieStore.set(SLACK_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  if (!cookieState || cookieState !== state.trim()) {
    throw new Error("slack.oauth.state_invalid");
  }
  const payload = readAndVerifySlackOAuthState(cookieState, config.stateSecret);
  if (
    payload.transportMode !== "http_webhook" &&
    payload.transportMode !== "websocket_worker"
  ) {
    throw new Error("slack.oauth.state_invalid");
  }
  if (Date.now() - payload.createdAt > SLACK_OAUTH_STATE_MAX_AGE_SECONDS * 1000) {
    throw new Error("slack.oauth.state_invalid");
  }
  return {
    workspaceId: payload.workspaceId,
    userId: payload.userId,
    displayName: payload.displayName,
    transportMode: payload.transportMode,
    redirectAfter: payload.redirectAfter,
  };
}

export async function installSlackIntegrationFromOAuthCode(input: {
  workspaceId: string;
  userId: string;
  code: string;
  displayName?: string;
  transportMode: ExternalIntegrationTransportMode;
  fetchImpl?: typeof fetch;
}): Promise<ExternalIntegrationRecord> {
  const config = readSlackOAuthConfig();
  if (input.transportMode === "websocket_worker" && !config.appLevelToken) {
    throw new Error("slack.oauth.app_level_token_missing");
  }
  const access = await exchangeSlackOAuthCode({
    code: input.code,
    config,
    fetchImpl: input.fetchImpl,
  });
  if (!access.ok || !access.accessToken || !access.appId) {
    throw new Error(access.errorCode || "slack.oauth.exchange_failed");
  }
  const displayName = input.displayName?.trim()
    || (access.teamName ? `Slack · ${access.teamName}` : "Slack");
  const encryptedCredentialsJson = buildEncryptedSlackCredentials({
    botToken: access.accessToken,
    signingSecret: config.signingSecret,
    appLevelToken: input.transportMode === "websocket_worker" ? config.appLevelToken : undefined,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });
  const configJson = buildSlackOAuthIntegrationConfigJson({
    transportMode: input.transportMode,
    access,
  });
  const scopesJson = [
    ...new Set([
      ...SLACK_DEFAULT_SCOPES,
      ...access.scopes,
      ...(input.transportMode === "websocket_worker" ? SLACK_SOCKET_MODE_SCOPES : []),
    ]),
  ];
  const existing = findExistingSlackOAuthIntegration({
    workspaceId: input.workspaceId,
    appId: access.appId,
    teamId: access.teamId,
  });
  const integration = existing
    ? updateExistingSlackOAuthIntegration({
      integration: existing,
      workspaceId: input.workspaceId,
      userId: input.userId,
      appId: access.appId,
      teamId: access.teamId,
      encryptedCredentialsJson,
      configJson,
    })
    : createExternalIntegrationSync({
      workspaceId: input.workspaceId,
      provider: SLACK_PROVIDER_ID,
      displayName,
      transportMode: input.transportMode,
      appId: access.appId,
      tenantKey: access.teamId,
      encryptedCredentialsJson,
      configJson,
      capabilitiesJson: {
        messageTransport: true,
      },
      scopesJson,
      createdByUserId: input.userId,
    });

  tryRecordWorkspaceAuditEventSync({
    workspaceId: input.workspaceId,
    title: existing ? "Slack integration OAuth credentials refreshed" : "Slack integration installed with OAuth",
    note: existing
      ? "Slack OAuth install refreshed an existing integration without exposing credentials."
      : "Slack OAuth install created a Slack integration without exposing credentials.",
    code: existing ? "workspace.external_integration_credentials_updated" : "workspace.external_integration_created",
    data: {
      actorType: "session_user",
      actorUserId: input.userId,
      resourceType: "external_integration",
      resourceId: integration.id,
      provider: SLACK_PROVIDER_ID,
      oauthInstalled: true,
      secretRedacted: true,
    },
  });
  return integration;
}

async function exchangeSlackOAuthCode(input: {
  code: string;
  config: SlackOAuthConfig;
  fetchImpl?: typeof fetch;
}): Promise<SlackOAuthAccessResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const body = new URLSearchParams({
      code: input.code,
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      redirect_uri: input.config.callbackUrl,
    });
    const response = await fetchImpl(`${input.config.apiBaseUrl ?? "https://slack.com/api"}/oauth.v2.access`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const data = await response.json() as Record<string, unknown>;
    const ok = response.ok && data.ok === true;
    if (!ok) {
      const errorCode = typeof data.error === "string" ? data.error : "exchange_failed";
      return {
        ok: false,
        scopes: [],
        errorCode: `slack.oauth.${errorCode}`,
        errorMessage: sanitizeSlackOAuthMessage(errorCode, [input.config.clientSecret]),
      };
    }
    const team = readRecord(data.team);
    return {
      ok: true,
      accessToken: typeof data.access_token === "string" ? data.access_token : undefined,
      botUserId: typeof data.bot_user_id === "string" ? data.bot_user_id : undefined,
      appId: typeof data.app_id === "string" ? data.app_id : undefined,
      teamId: typeof team?.id === "string" ? team.id : undefined,
      teamName: typeof team?.name === "string" ? team.name : undefined,
      scopes: readSlackOAuthScopes(data.scope),
    };
  } catch (error) {
    return {
      ok: false,
      scopes: [],
      errorCode: "slack.oauth.exchange_failed",
      errorMessage: sanitizeSlackOAuthMessage(error instanceof Error ? error.message : String(error), [input.config.clientSecret]),
    };
  }
}

function updateExistingSlackOAuthIntegration(input: {
  integration: ExternalIntegrationRecord;
  workspaceId: string;
  userId: string;
  appId: string;
  teamId?: string;
  encryptedCredentialsJson: Record<string, string>;
  configJson: Record<string, unknown>;
}): ExternalIntegrationRecord {
  const updated = updateExternalIntegrationCredentialsSync({
    workspaceId: input.workspaceId,
    integrationId: input.integration.id,
    appId: input.appId,
    tenantKey: input.teamId,
    encryptedCredentialsJson: input.encryptedCredentialsJson,
    updatedByUserId: input.userId,
  });
  const updatedConfig = updateExternalIntegrationConfigSync({
    workspaceId: input.workspaceId,
    integrationId: updated.id,
    configJson: input.configJson,
    updatedByUserId: input.userId,
  });
  if (updatedConfig.status !== "active") {
    return updateExternalIntegrationStatusSync({
      workspaceId: input.workspaceId,
      integrationId: updatedConfig.id,
      status: "active",
      updatedByUserId: input.userId,
    });
  }
  return updatedConfig;
}

function findExistingSlackOAuthIntegration(input: {
  workspaceId: string;
  appId: string;
  teamId?: string;
}): ExternalIntegrationRecord | undefined {
  return listExternalIntegrationsSync({
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
    includeDisabled: true,
  }).find((integration) =>
    integration.appId === input.appId &&
    (integration.tenantKey ?? "") === (input.teamId ?? ""));
}

function buildSlackOAuthIntegrationConfigJson(input: {
  transportMode: ExternalIntegrationTransportMode;
  access: SlackOAuthAccessResult;
}): Record<string, unknown> {
  return {
    eventCallbackPath: SLACK_EVENT_CALLBACK_PATH,
    capabilities: {
      messageTransport: true,
      socketMode: input.transportMode === "websocket_worker",
    },
    oauth: {
      installedAt: new Date().toISOString(),
      botUserId: input.access.botUserId,
      teamName: input.access.teamName,
      scopeCount: input.access.scopes.length,
    },
  };
}

function signSlackOAuthState(payload: SlackOAuthStatePayload, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function readAndVerifySlackOAuthState(value: string, secret: string): SlackOAuthStatePayload {
  const [encodedPayload, signature] = value.split(".");
  if (!encodedPayload || !signature) {
    throw new Error("slack.oauth.state_invalid");
  }
  const expectedSignature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  if (!timingSafeStringEqual(signature, expectedSignature)) {
    throw new Error("slack.oauth.state_invalid");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as unknown;
  } catch {
    throw new Error("slack.oauth.state_invalid");
  }
  const payload = readRecord(parsed);
  if (
    !payload ||
    typeof payload.csrf !== "string" ||
    typeof payload.workspaceId !== "string" ||
    typeof payload.userId !== "string" ||
    typeof payload.createdAt !== "number"
  ) {
    throw new Error("slack.oauth.state_invalid");
  }
  return payload as unknown as SlackOAuthStatePayload;
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function readRequiredSlackOAuthEnv(name: string): string {
  const value = readServerEnvValue(name)?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function normalizeSlackOAuthRedirectAfter(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return undefined;
  }
  return trimmed;
}

function readSlackOAuthScopes(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function sanitizeSlackOAuthMessage(
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
