import type { ExternalIntegrationHealthStatus } from "@agent-space/db";
import {
  createFeishuApiClient,
  fetchFeishuTenantAccessToken,
  type FeishuApiClient,
} from "./client.ts";
import { FEISHU_DEFAULT_SCOPES } from "./constants.ts";

export type FeishuScopeReadiness =
  | "verified"
  | "missing_required_scopes"
  | "unauthorized"
  | "manual_review_required"
  | "unavailable";

export interface FeishuHealthCheckResult {
  status: ExternalIntegrationHealthStatus;
  expireSeconds?: number;
  checkedAt: string;
  botOpenId?: string;
  botAppName?: string;
  scopeReadiness?: FeishuScopeReadiness;
  enabledScopes?: string[];
  missingScopes?: string[];
  scopeErrorMessage?: string;
  errorMessage?: string;
}

export async function checkFeishuIntegrationHealth(input: {
  appId: string;
  appSecret: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  clientFactory?: (tenantAccessToken: string) => FeishuApiClient;
}): Promise<FeishuHealthCheckResult> {
  const checkedAt = new Date().toISOString();
  try {
    const token = await fetchFeishuTenantAccessToken({
      appId: input.appId,
      appSecret: input.appSecret,
      baseUrl: input.baseUrl,
      fetchImpl: input.fetchImpl,
    });
    const client = input.clientFactory
      ? input.clientFactory(token.tenantAccessToken)
      : createFeishuApiClient({
        credentials: {
          appId: input.appId,
          appSecret: input.appSecret,
          tenantAccessToken: token.tenantAccessToken,
        },
        baseUrl: input.baseUrl,
        fetchImpl: input.fetchImpl,
      });
    const botInfo = await readFeishuBotInfo(client);
    const scopeStatus = await checkFeishuAppScopeReadiness(client);
    const sanitizedScopeStatus = {
      ...scopeStatus,
      scopeErrorMessage: sanitizeFeishuHealthErrorMessage(scopeStatus.scopeErrorMessage, [
        input.appId,
        input.appSecret,
        token.tenantAccessToken,
      ]),
    };
    const status = resolveFeishuHealthStatus(scopeStatus.scopeReadiness);
    return {
      status,
      expireSeconds: token.expireSeconds,
      checkedAt,
      botOpenId: botInfo.botOpenId,
      botAppName: botInfo.botAppName,
      errorMessage: status === "degraded" ? buildFeishuScopeHealthError(sanitizedScopeStatus) : undefined,
      ...sanitizedScopeStatus,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "error",
      checkedAt,
      scopeReadiness: "unavailable",
      errorMessage: sanitizeFeishuHealthErrorMessage(message, [
        input.appId,
        input.appSecret,
      ]),
    };
  }
}

export async function readFeishuBotInfo(client: FeishuApiClient): Promise<{
  botOpenId?: string;
  botAppName?: string;
}> {
  const response = await client.request<Record<string, unknown>>({
    method: "GET",
    path: "/open-apis/bot/v3/info",
  });
  const data = asRecord(response.data) ?? response;
  return {
    botOpenId: asString(data.open_id) ?? asString(data.bot_open_id),
    botAppName: asString(data.app_name) ?? asString(data.name),
  };
}

export async function readFeishuAppScopes(client: FeishuApiClient): Promise<string[]> {
  const response = await client.request<Record<string, unknown>>({
    method: "GET",
    path: "/open-apis/application/v6/scopes",
  });
  const code = typeof response.code === "number" ? response.code : undefined;
  if (code !== undefined && code !== 0) {
    throw new Error(typeof response.msg === "string" ? response.msg : "Feishu rejected the app scope request.");
  }
  return extractFeishuGrantedScopes(response);
}

async function checkFeishuAppScopeReadiness(client: FeishuApiClient): Promise<{
  scopeReadiness: FeishuScopeReadiness;
  enabledScopes?: string[];
  missingScopes?: string[];
  scopeErrorMessage?: string;
}> {
  try {
    const enabledScopes = await readFeishuAppScopes(client);
    const enabledScopeSet = new Set(enabledScopes);
    const missingScopes = FEISHU_DEFAULT_SCOPES.filter((scope) => !enabledScopeSet.has(scope));
    return {
      scopeReadiness: missingScopes.length > 0 ? "missing_required_scopes" : "verified",
      enabledScopes,
      missingScopes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      scopeReadiness: isFeishuScopeAuthorizationError(message) ? "unauthorized" : "manual_review_required",
      scopeErrorMessage: message,
    };
  }
}

function resolveFeishuHealthStatus(scopeReadiness: FeishuScopeReadiness): ExternalIntegrationHealthStatus {
  return scopeReadiness === "verified" ? "healthy" : "degraded";
}

function buildFeishuScopeHealthError(input: {
  scopeReadiness: FeishuScopeReadiness;
  missingScopes?: string[];
  scopeErrorMessage?: string;
}): string | undefined {
  if (input.scopeReadiness === "missing_required_scopes") {
    const missing = input.missingScopes && input.missingScopes.length > 0
      ? `: ${input.missingScopes.join(", ")}`
      : ".";
    return `Feishu integration is missing required scopes${missing}`;
  }
  if (input.scopeReadiness === "unauthorized") {
    return `Feishu app scope check was rejected by Feishu: ${input.scopeErrorMessage ?? "permission denied"}`;
  }
  if (input.scopeReadiness === "manual_review_required") {
    return `Feishu app scopes could not be verified automatically: ${input.scopeErrorMessage ?? "manual review required"}`;
  }
  return undefined;
}

function sanitizeFeishuHealthErrorMessage(
  message: string | undefined,
  sensitiveValues: Array<string | undefined>,
): string | undefined {
  if (!message) {
    return undefined;
  }
  let sanitized = message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(app_id|appId|app_secret|appSecret|tenant_access_token|tenantAccessToken|verification_token|verificationToken|encrypt_key|encryptKey)\b\s*[:=]\s*("[^"]+"|'[^']+'|[^,\s]+)/gi, "$1=[redacted]");
  for (const value of sensitiveValues
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item))
    .sort((left, right) => right.length - left.length)) {
    sanitized = sanitized.split(value).join("[redacted]");
  }
  return sanitized.slice(0, 1000);
}

function isFeishuScopeAuthorizationError(message: string): boolean {
  return /permission|unauthori[sz]ed|forbidden|access denied|permission denied|权限|授权/.test(
    message.toLowerCase(),
  );
}

function extractFeishuGrantedScopes(response: Record<string, unknown>): string[] {
  const data = asRecord(response.data) ?? response;
  const app = asRecord(data.app);
  const candidates = [
    data.scopes,
    data.items,
    app?.scopes,
    app?.items,
    response.scopes,
    response.items,
  ];
  const scopes: string[] = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }
    for (const item of candidate) {
      const scope = readGrantedScopeName(item);
      if (scope && !scopes.includes(scope)) {
        scopes.push(scope);
      }
    }
  }
  return scopes.sort();
}

function readGrantedScopeName(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const grantStatus = readNumber(record.grant_status) ?? readNumber(record.grantStatus);
  if (grantStatus !== undefined && grantStatus !== 1) {
    return undefined;
  }
  return asString(record.scope);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
