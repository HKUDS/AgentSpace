import { createIntegrationProviderError } from "../../core/index.ts";
import { FEISHU_PROVIDER_ID } from "./constants.ts";

const FEISHU_ALLOWED_API_BASE_HOSTS = new Set([
  "open.feishu.cn",
  "open.larksuite.com",
]);

export interface FeishuClientCredentials {
  appId: string;
  appSecret: string;
  tenantAccessToken?: string;
}

export interface FeishuTenantAccessTokenResult {
  tenantAccessToken: string;
  expireSeconds?: number;
}

export interface FeishuApiRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
}

export interface FeishuMultipartUploadRequest {
  method: "POST";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  fields?: Record<string, string | number | boolean | undefined>;
  file: {
    fieldName: string;
    fileName: string;
    mediaType?: string;
    contentBytes: Uint8Array;
  };
}

export interface FeishuApiClient {
  request<T = unknown>(input: FeishuApiRequest): Promise<T>;
  upload?<T = unknown>(input: FeishuMultipartUploadRequest): Promise<T>;
}

export function createFeishuApiClient(input: {
  credentials: FeishuClientCredentials;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): FeishuApiClient {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw createIntegrationProviderError({
      provider: FEISHU_PROVIDER_ID,
      code: "feishu.fetch_unavailable",
      message: "Fetch is not available for Feishu API calls.",
    });
  }

  const baseUrl = resolveSafeFeishuApiBaseUrl(input.baseUrl, {
    allowTestBaseUrl: Boolean(input.fetchImpl),
  });
  const token = input.credentials.tenantAccessToken;

  return {
    async request<T = unknown>(request: FeishuApiRequest): Promise<T> {
      if (!token) {
        throw createIntegrationProviderError({
          provider: FEISHU_PROVIDER_ID,
          code: "feishu.tenant_token_missing",
          message: "Feishu tenant access token is required before API calls can be made.",
        });
      }

      const url = new URL(`${baseUrl}${request.path}`);
      for (const [key, value] of Object.entries(request.query ?? {})) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }

      const response = await fetchImpl(url, {
        method: request.method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: request.body ? JSON.stringify(request.body) : undefined,
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw createIntegrationProviderError({
          provider: FEISHU_PROVIDER_ID,
          code: "feishu.api_http_error",
          message: `Feishu API request failed with HTTP ${response.status}.`,
          cause: payload,
        });
      }

      return payload as T;
    },

    async upload<T = unknown>(request: FeishuMultipartUploadRequest): Promise<T> {
      if (!token) {
        throw createIntegrationProviderError({
          provider: FEISHU_PROVIDER_ID,
          code: "feishu.tenant_token_missing",
          message: "Feishu tenant access token is required before API calls can be made.",
        });
      }

      const url = buildFeishuApiUrl(baseUrl, request.path, request.query);
      const formData = new FormData();
      for (const [key, value] of Object.entries(request.fields ?? {})) {
        if (value !== undefined) {
          formData.set(key, String(value));
        }
      }
      formData.set(
        request.file.fieldName,
        new Blob([toArrayBuffer(request.file.contentBytes)], {
          type: request.file.mediaType || "application/octet-stream",
        }),
        request.file.fileName,
      );

      const response = await fetchImpl(url, {
        method: request.method,
        headers: {
          authorization: `Bearer ${token}`,
        },
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw createIntegrationProviderError({
          provider: FEISHU_PROVIDER_ID,
          code: "feishu.api_http_error",
          message: `Feishu API request failed with HTTP ${response.status}.`,
          cause: payload,
        });
      }

      return payload as T;
    },
  };
}

export async function fetchFeishuTenantAccessToken(input: {
  appId: string;
  appSecret: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<FeishuTenantAccessTokenResult> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw createIntegrationProviderError({
      provider: FEISHU_PROVIDER_ID,
      code: "feishu.fetch_unavailable",
      message: "Fetch is not available for Feishu API calls.",
    });
  }
  const appId = input.appId.trim();
  const appSecret = input.appSecret.trim();
  if (!appId || !appSecret) {
    throw createIntegrationProviderError({
      provider: FEISHU_PROVIDER_ID,
      code: "feishu.credentials_missing",
      message: "Feishu app id and app secret are required.",
    });
  }

  const baseUrl = resolveSafeFeishuApiBaseUrl(input.baseUrl, {
    allowTestBaseUrl: Boolean(input.fetchImpl),
  });
  const response = await fetchImpl(`${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret,
    }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw createIntegrationProviderError({
      provider: FEISHU_PROVIDER_ID,
      code: "feishu.tenant_token_http_error",
      message: `Feishu tenant token request failed with HTTP ${response.status}.`,
      cause: payload,
    });
  }

  const code = typeof payload.code === "number" ? payload.code : undefined;
  if (code !== undefined && code !== 0) {
    throw createIntegrationProviderError({
      provider: FEISHU_PROVIDER_ID,
      code: "feishu.tenant_token_rejected",
      message: typeof payload.msg === "string" ? payload.msg : "Feishu rejected the tenant token request.",
      cause: payload,
    });
  }

  const tenantAccessToken = asString(payload.tenant_access_token) ?? asString(payload.tenantAccessToken);
  if (!tenantAccessToken) {
    throw createIntegrationProviderError({
      provider: FEISHU_PROVIDER_ID,
      code: "feishu.tenant_token_missing",
      message: "Feishu tenant token response did not include tenant_access_token.",
      cause: payload,
    });
  }

  return {
    tenantAccessToken,
    expireSeconds: typeof payload.expire === "number" ? payload.expire : undefined,
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function buildFeishuApiUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): URL {
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function resolveSafeFeishuApiBaseUrl(
  value: string | undefined,
  options: { allowTestBaseUrl?: boolean } = {},
): string {
  const baseUrl = value?.replace(/\/+$/, "") || "https://open.feishu.cn";
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw unsafeFeishuApiBaseUrlError();
  }
  const hostname = parsed.hostname.toLowerCase();
  if (canUseUnsafeFeishuApiBaseUrlForTests(parsed, hostname)) {
    return `${parsed.protocol}//${hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  }
  const isAllowedHost = FEISHU_ALLOWED_API_BASE_HOSTS.has(hostname) ||
    (options.allowTestBaseUrl === true && hostname.endsWith(".test"));
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.port ||
    !isAllowedHost ||
    isLocalOrPrivateHostname(hostname)
  ) {
    throw unsafeFeishuApiBaseUrlError();
  }
  return `${parsed.protocol}//${hostname}`;
}

function canUseUnsafeFeishuApiBaseUrlForTests(parsed: URL, hostname: string): boolean {
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.AGENT_SPACE_FEISHU_ALLOW_UNSAFE_TEST_API_BASE_URL !== "1"
  ) {
    return false;
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    return false;
  }
  return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    isLocalOrPrivateHostname(hostname);
}

function unsafeFeishuApiBaseUrlError(): Error {
  return createIntegrationProviderError({
    provider: FEISHU_PROVIDER_ID,
    code: "feishu.api_base_url_unsafe",
    message: "Feishu API calls only allow official Feishu OpenAPI base URLs.",
  });
}

function isLocalOrPrivateHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return true;
  }
  if (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80")) {
    return true;
  }
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const first = parts[0] ?? -1;
  const second = parts[1] ?? -1;
  return first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first === 0;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const result = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(result).set(bytes);
  return result;
}
