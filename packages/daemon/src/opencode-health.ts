import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderHealthSnapshot } from "@agent-space/domain";

export type OpenCodeHealthStatus = "healthy" | "degraded" | "broken" | "unknown";
export type OpenCodeProviderErrorCategory =
  | "auth"
  | "model"
  | "tool"
  | "protocol"
  | "runtime"
  | "configuration";
export type OpenCodeProviderErrorCode =
  | "provider.cli_missing"
  | "provider.auth_invalid"
  | "provider.model_unavailable"
  | "provider.session_invalid"
  | "provider.tool_missing"
  | "provider.tool_unauthorized"
  | "provider.tool_permission_denied"
  | "provider.empty_response"
  | "provider.protocol_parse_failed"
  | "provider.timeout"
  | "provider.runtime_generic_failure";

export interface OpenCodeProviderError {
  provider: "opencode";
  code: OpenCodeProviderErrorCode;
  category: OpenCodeProviderErrorCategory;
  message: string;
  rawProviderMessage: string;
}

export interface OpenCodeProviderHealth {
  provider: "opencode";
  status: OpenCodeHealthStatus;
  usable: boolean;
  checkedAt: string;
  authSource: {
    model?: string;
    authConfigPath: string;
  };
  error?: OpenCodeProviderError;
  details: {
    model?: string;
    hasAuthConfig: boolean;
    configuredProviderCount: number;
    modelProviderConfigured: boolean;
  };
}

interface OpenCodeAuthProviders {
  apiProviderIds: string[];
  allProviderIds: string[];
}

export function inspectOpenCodeProviderHealth(input: {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  model?: string;
  now?: Date;
} = {}): OpenCodeProviderHealth {
  const env = input.env ?? process.env;
  const homeDir = input.homeDir ?? env.HOME ?? homedir();
  const model = input.model?.trim() || env.OPENCODE_MODEL?.trim() || undefined;
  const authConfigPath = join(homeDir, ".local", "share", "opencode", "auth.json");
  const hasAuthConfig = existsSync(authConfigPath);
  const authProviders = hasAuthConfig ? readOpenCodeAuthProviders(authConfigPath) : { apiProviderIds: [], allProviderIds: [] };
  const configuredProviderCount = authProviders.apiProviderIds.length;
  const modelProvider = resolveModelProvider(model);
  const modelProviderConfigured = modelProvider ? authProviders.allProviderIds.includes(modelProvider) : true;
  const checkedAt = (input.now ?? new Date()).toISOString();

  const base = {
    provider: "opencode" as const,
    checkedAt,
    authSource: { model, authConfigPath },
    details: {
      model,
      hasAuthConfig,
      configuredProviderCount,
      modelProviderConfigured,
    },
  };

  if (!hasAuthConfig || configuredProviderCount === 0) {
    return {
      ...base,
      status: "broken",
      usable: false,
      error: buildOpenCodeError(
        "provider.auth_invalid",
        "auth",
        "OpenCode 当前不可用：未检测到已配置的 API key，请先完成 OpenCode 认证。",
        "auth.json is missing or has no api-typed provider",
      ),
    };
  }

  if (model && !modelProviderConfigured) {
    return {
      ...base,
      status: "degraded",
      usable: true,
      error: buildOpenCodeError(
        "provider.model_unavailable",
        "model",
        "OpenCode 当前不可用：指定的 model 对应 provider 未在本地认证配置中注册，无法确认该路由可用。",
        `model provider ${modelProvider ?? "(unknown)"} is not configured in auth.json`,
      ),
    };
  }

  return {
    ...base,
    status: "healthy",
    usable: true,
  };
}

export function buildOpenCodeProviderHealthSnapshot(health: OpenCodeProviderHealth): ProviderHealthSnapshot {
  const reason = health.error?.message ?? (
    health.status === "healthy"
      ? "OpenCode provider preflight passed."
      : health.status === "degraded"
        ? "OpenCode provider is available but the requested model route has not been verified."
        : health.status === "unknown"
          ? "OpenCode provider health has not been checked."
          : "OpenCode provider is currently unavailable."
  );

  return {
    status: health.status,
    reason,
    checkedAt: health.checkedAt,
    error: health.error
      ? {
          provider: "opencode",
          code: health.error.code,
          category: health.error.category,
          message: health.error.message,
          rawProviderMessage: health.error.rawProviderMessage,
        }
      : undefined,
  };
}

export function normalizeOpenCodeProviderError(rawMessage: string): OpenCodeProviderError | undefined {
  const trimmed = sanitizeOpenCodeDiagnosticOutput(rawMessage.trim());
  if (!trimmed) {
    return undefined;
  }

  if (/\b401\b|incorrect api key|invalid api key|invalid_api_key|api key (not found|missing)|unauthorized|authentication (failed|error)|not authenticated|no api key|apierror/i.test(trimmed)) {
    return buildOpenCodeError(
      "provider.auth_invalid",
      "auth",
      "OpenCode 当前不可用：认证失败，请检查 daemon 继承的 OpenCode API key。",
      trimmed,
    );
  }

  if (/session (not found|missing|invalid)|unknown session|session_id .*not found|conversation (not found|missing)/i.test(trimmed)) {
    return buildOpenCodeError(
      "provider.session_invalid",
      "runtime",
      "OpenCode 当前会话不可用：旧 session 不存在，需要重新开启会话。",
      trimmed,
    );
  }

  if (/model (not found|unavailable|does not exist)|no such model|unknown model|invalid model|unsupported model|model not available/i.test(trimmed)) {
    return buildOpenCodeError(
      "provider.model_unavailable",
      "model",
      "OpenCode 当前不可用：配置的 model 不存在或不可用。",
      trimmed,
    );
  }

  if (/tool (unauthorized|not authorized)|not authorized|workspace grant|requires approval/i.test(trimmed)) {
    return buildOpenCodeError(
      "provider.tool_unauthorized",
      "tool",
      "OpenCode 当前不可用：任务需要的 tool 未被授权。",
      trimmed,
    );
  }

  if (/permission denied|operation not permitted|tool (denied|rejected)|tool call rejected/i.test(trimmed)) {
    return buildOpenCodeError(
      "provider.tool_permission_denied",
      "tool",
      "OpenCode 当前不可用：provider 拒绝了 tool 调用。",
      trimmed,
    );
  }

  if (/command not found|no such file or directory|tool (not found|missing)|executable (not found|missing)|not in path/i.test(trimmed)) {
    return buildOpenCodeError(
      "provider.tool_missing",
      "tool",
      "OpenCode 当前不可用：任务需要的 CLI/tool 不存在或不在 PATH。",
      trimmed,
    );
  }

  if (/invalid json|json parse|unexpected token|parse (error|failed)|protocol/i.test(trimmed)) {
    return buildOpenCodeError(
      "provider.protocol_parse_failed",
      "protocol",
      "OpenCode 输出协议无法解析。",
      trimmed,
    );
  }

  return undefined;
}

function buildOpenCodeError(
  code: OpenCodeProviderErrorCode,
  category: OpenCodeProviderErrorCategory,
  message: string,
  rawProviderMessage = message,
): OpenCodeProviderError {
  return {
    provider: "opencode",
    code,
    category,
    message,
    rawProviderMessage: sanitizeOpenCodeDiagnosticOutput(rawProviderMessage),
  };
}

function readOpenCodeAuthProviders(path: string): OpenCodeAuthProviders {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const entries = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.entries(parsed as Record<string, unknown>)
      : [];
    const apiProviderIds: string[] = [];
    const allProviderIds: string[] = [];
    for (const [id, value] of entries) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const config = value as Record<string, unknown>;
      allProviderIds.push(id);
      if (config.type === "api" && (typeof config.key === "string" || typeof config.accessToken === "string")) {
        apiProviderIds.push(id);
      }
    }
    return { apiProviderIds, allProviderIds };
  } catch {
    return { apiProviderIds: [], allProviderIds: [] };
  }
}

function resolveModelProvider(model: string | undefined): string | undefined {
  if (!model) {
    return undefined;
  }
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) {
    return undefined;
  }
  return model.slice(0, slash);
}

function sanitizeOpenCodeDiagnosticOutput(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, "[redacted-secret]")
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|API[_-]?KEY|AUTH)[A-Z0-9_]*\s*=\s*)[^\s"']+/gi, "$1[redacted]")
    .replace(/([?&](?:access_token|refresh_token|token|api_key)=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/("(?:token|accessToken|refreshToken|apiKey|api_key|secret|key)"\s*:\s*")[^"]+/gi, "$1[redacted]")
    .replace(/(Authorization:\s*)[^\r\n]+/gi, "$1[redacted]");
}
