import type { ExternalIntegrationHealthStatus } from "@agent-space/db";

export interface SlackHealthCheckResult {
  status: ExternalIntegrationHealthStatus;
  checkedAt: string;
  botUserId?: string;
  teamId?: string;
  teamName?: string;
  appId?: string;
  errorMessage?: string;
}

export async function checkSlackIntegrationHealth(input: {
  botToken: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<SlackHealthCheckResult> {
  const checkedAt = new Date().toISOString();
  const botToken = input.botToken.trim();
  if (!botToken) {
    return {
      status: "error",
      checkedAt,
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
      return {
        status: "healthy",
        checkedAt,
        botUserId: typeof data.user_id === "string" ? data.user_id : undefined,
        teamId: typeof data.team_id === "string" ? data.team_id : undefined,
        teamName: typeof data.team === "string" ? data.team : undefined,
        appId: typeof data.app_id === "string" ? data.app_id : undefined,
      };
    }
    return {
      status: "error",
      checkedAt,
      errorMessage: sanitizeSlackHealthErrorMessage(typeof data.error === "string" ? data.error : `Slack auth.test failed with HTTP ${response.status}.`, [botToken]),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "error",
      checkedAt,
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
  return {
    ...config,
    bot: {
      ...currentBot,
      ...(input.health.botUserId ? { botUserId: input.health.botUserId } : {}),
      ...(input.health.teamId ? { teamId: input.health.teamId } : {}),
      ...(input.health.teamName ? { teamName: input.health.teamName } : {}),
      ...(input.health.appId ? { appId: input.health.appId } : {}),
      lastHealthCheckedAt: input.health.checkedAt,
    },
  };
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
