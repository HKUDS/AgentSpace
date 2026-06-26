import type { MessageAttachment } from "@agent-space/domain/workspace";
import { persistWorkspaceAttachmentFromBytesSync } from "../../../attachments/attachments.ts";
import {
  createIntegrationProviderError,
  type ExternalMessageAttachment,
  type ExternalMessageEnvelope,
  type IntegrationRuntimeContext,
} from "../../core/index.ts";
import {
  fetchFeishuTenantAccessToken,
  type FeishuApiRequest,
} from "./client.ts";
import { FEISHU_PROVIDER_ID } from "./constants.ts";

export const FEISHU_INBOUND_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const FEISHU_INBOUND_ATTACHMENT_TIMEOUT_MS = 15_000;
const FEISHU_ATTACHMENT_ALLOWED_BASE_HOSTS = new Set([
  "open.feishu.cn",
  "open.larksuite.com",
]);

export type FeishuInboundMessageResourceType = "image" | "file";

export interface FeishuInboundAttachmentDescriptor {
  externalMessageId: string;
  fileKey: string;
  resourceType: FeishuInboundMessageResourceType;
  fileName: string;
  mediaType?: string;
  sizeBytes?: number;
  externalAttachmentId?: string;
}

export interface FeishuInboundAttachmentDownloadInput {
  context: IntegrationRuntimeContext;
  message: ExternalMessageEnvelope;
  attachment: ExternalMessageAttachment;
  attachmentIndex: number;
}

export type FeishuInboundAttachmentDownloader = (
  input: FeishuInboundAttachmentDownloadInput
) => MessageAttachment | null | Promise<MessageAttachment | null>;

export function createFeishuInboundAttachmentDownloader(input: {
  workspaceId: string;
  appId: string;
  appSecret: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
}): FeishuInboundAttachmentDownloader {
  let tenantAccessToken: string | undefined;

  return async (downloadInput) => {
    const baseUrl = resolveSafeFeishuAttachmentBaseUrl(input.baseUrl, {
      allowTestBaseUrl: Boolean(input.fetchImpl),
    });
    if (!tenantAccessToken) {
      const token = await fetchFeishuTenantAccessToken({
        appId: input.appId,
        appSecret: input.appSecret,
        baseUrl,
        fetchImpl: input.fetchImpl,
      });
      tenantAccessToken = token.tenantAccessToken;
    }

    return downloadFeishuInboundMessageAttachment({
      workspaceId: input.workspaceId,
      tenantAccessToken,
      attachment: downloadInput.attachment,
      externalMessageId: downloadInput.message.externalMessageId,
      baseUrl,
      fetchImpl: input.fetchImpl,
      maxBytes: input.maxBytes,
      timeoutMs: input.timeoutMs,
    });
  };
}

export async function downloadFeishuInboundMessageAttachment(input: {
  workspaceId: string;
  tenantAccessToken: string;
  attachment: ExternalMessageAttachment;
  externalMessageId?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
}): Promise<MessageAttachment> {
  const descriptor = resolveFeishuInboundAttachmentDescriptor(input.attachment, input.externalMessageId);
  if (!descriptor) {
    throw createIntegrationProviderError({
      provider: FEISHU_PROVIDER_ID,
      code: "feishu.attachment_descriptor_invalid",
      message: "Feishu inbound attachment is missing message resource metadata.",
    });
  }

  const maxBytes = normalizePositiveInteger(input.maxBytes, FEISHU_INBOUND_ATTACHMENT_MAX_BYTES);
  if (descriptor.sizeBytes !== undefined && descriptor.sizeBytes > maxBytes) {
    throw createIntegrationProviderError({
      provider: FEISHU_PROVIDER_ID,
      code: "feishu.attachment_too_large",
      message: `Feishu attachment exceeds the ${maxBytes} byte download limit.`,
    });
  }

  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw createIntegrationProviderError({
      provider: FEISHU_PROVIDER_ID,
      code: "feishu.fetch_unavailable",
      message: "Fetch is not available for Feishu attachment downloads.",
    });
  }

  const request = buildFeishuMessageResourceRequest(descriptor);
  const baseUrl = resolveSafeFeishuAttachmentBaseUrl(input.baseUrl, {
    allowTestBaseUrl: Boolean(input.fetchImpl),
  });
  const url = new URL(`${baseUrl}${request.path}`);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const timeoutMs = normalizePositiveInteger(input.timeoutMs, FEISHU_INBOUND_ATTACHMENT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: request.method,
      headers: {
        authorization: `Bearer ${input.tenantAccessToken}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw createIntegrationProviderError({
        provider: FEISHU_PROVIDER_ID,
        code: "feishu.attachment_download_http_error",
        message: `Feishu attachment download failed with HTTP ${response.status}.`,
      });
    }

    const declaredLength = parseContentLength(response.headers.get("content-length"));
    if (declaredLength !== undefined && declaredLength > maxBytes) {
      throw createIntegrationProviderError({
        provider: FEISHU_PROVIDER_ID,
        code: "feishu.attachment_too_large",
        message: `Feishu attachment exceeds the ${maxBytes} byte download limit.`,
      });
    }

    const mediaType = resolveSafeFeishuAttachmentMediaType({
      descriptor,
      responseMediaType: response.headers.get("content-type") ?? undefined,
    });
    const contentBytes = await readFeishuAttachmentBodyWithLimit(response, maxBytes);
    return persistWorkspaceAttachmentFromBytesSync({
      workspaceId: input.workspaceId,
      contentBytes,
      fileName: descriptor.fileName,
      mediaType,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw createIntegrationProviderError({
        provider: FEISHU_PROVIDER_ID,
        code: "feishu.attachment_download_timeout",
        message: `Feishu attachment download exceeded the ${timeoutMs} ms timeout.`,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function buildFeishuMessageResourceRequest(
  descriptor: Pick<FeishuInboundAttachmentDescriptor, "externalMessageId" | "fileKey" | "resourceType">,
): FeishuApiRequest {
  return {
    method: "GET",
    path: `/open-apis/im/v1/messages/${encodeURIComponent(descriptor.externalMessageId)}/resources/${encodeURIComponent(descriptor.fileKey)}`,
    query: {
      type: descriptor.resourceType,
    },
  };
}

export function resolveFeishuInboundAttachmentDescriptor(
  attachment: ExternalMessageAttachment,
  fallbackExternalMessageId?: string,
): FeishuInboundAttachmentDescriptor | null {
  const metadata = isRecord(attachment.metadata) ? attachment.metadata : {};
  if (metadata.provider !== FEISHU_PROVIDER_ID || metadata.resourceEndpoint !== "im.message.resource") {
    return null;
  }

  const resourceType = metadata.resourceType === "image" || metadata.resourceType === "file"
    ? metadata.resourceType
    : undefined;
  const fileKey = asString(metadata.fileKey);
  const externalMessageId = asString(metadata.externalMessageId) ?? fallbackExternalMessageId?.trim();
  const fileName = attachment.fileName?.trim();
  if (!resourceType || !fileKey || !externalMessageId || !fileName) {
    return null;
  }

  return {
    externalMessageId,
    fileKey,
    resourceType,
    fileName,
    mediaType: attachment.mediaType,
    sizeBytes: normalizeOptionalSizeBytes(attachment.sizeBytes),
    externalAttachmentId: attachment.id,
  };
}

async function readFeishuAttachmentBodyWithLimit(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const body = response.body;
  if (!body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    assertFeishuAttachmentSizeWithinLimit(buffer.byteLength, maxBytes);
    return buffer;
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    const chunk = Buffer.from(result.value);
    totalBytes += chunk.byteLength;
    assertFeishuAttachmentSizeWithinLimit(totalBytes, maxBytes);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, totalBytes);
}

function assertFeishuAttachmentSizeWithinLimit(sizeBytes: number, maxBytes: number): void {
  if (sizeBytes <= maxBytes) {
    return;
  }
  throw createIntegrationProviderError({
    provider: FEISHU_PROVIDER_ID,
    code: "feishu.attachment_too_large",
    message: `Feishu attachment exceeds the ${maxBytes} byte download limit.`,
  });
}

function resolveSafeFeishuAttachmentMediaType(input: {
  descriptor: FeishuInboundAttachmentDescriptor;
  responseMediaType?: string;
}): string {
  const responseMediaType = normalizeMediaType(input.responseMediaType);
  const descriptorMediaType = normalizeMediaType(input.descriptor.mediaType);

  if (input.descriptor.resourceType === "image") {
    if (responseMediaType && isAllowedFeishuImageMediaType(responseMediaType)) {
      return responseMediaType;
    }
    if (responseMediaType && responseMediaType !== "application/octet-stream") {
      throw createIntegrationProviderError({
        provider: FEISHU_PROVIDER_ID,
        code: "feishu.attachment_media_type_unsupported",
        message: `Feishu image attachment media type "${responseMediaType}" is not supported.`,
      });
    }
    if (descriptorMediaType && isAllowedFeishuImageMediaType(descriptorMediaType)) {
      return descriptorMediaType;
    }
    return "image/jpeg";
  }

  const mediaType = responseMediaType
    ?? descriptorMediaType
    ?? "application/octet-stream";
  if (input.descriptor.resourceType === "file" && isBlockedFeishuFileMediaType(mediaType)) {
    throw createIntegrationProviderError({
      provider: FEISHU_PROVIDER_ID,
      code: "feishu.attachment_media_type_unsupported",
      message: `Feishu file attachment media type "${mediaType}" is not supported.`,
    });
  }
  return mediaType;
}

function normalizeMediaType(value: string | undefined): string | undefined {
  const mediaType = value?.split(";")[0]?.trim().toLowerCase();
  if (!mediaType) {
    return undefined;
  }
  if (mediaType.length > 120 || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mediaType)) {
    return undefined;
  }
  return mediaType;
}

function isAllowedFeishuImageMediaType(mediaType: string): boolean {
  return mediaType === "image/jpeg"
    || mediaType === "image/png"
    || mediaType === "image/gif"
    || mediaType === "image/webp";
}

function isBlockedFeishuFileMediaType(mediaType: string): boolean {
  return mediaType === "text/html"
    || mediaType === "application/xhtml+xml"
    || mediaType === "application/javascript"
    || mediaType === "text/javascript"
    || mediaType === "application/x-msdownload"
    || mediaType === "application/x-sh";
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

function normalizeOptionalSizeBytes(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function resolveSafeFeishuAttachmentBaseUrl(
  value: string | undefined,
  options: { allowTestBaseUrl?: boolean } = {},
): string {
  const baseUrl = value?.replace(/\/+$/, "") || "https://open.feishu.cn";
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw unsafeFeishuAttachmentBaseUrlError();
  }
  const hostname = parsed.hostname.toLowerCase();
  const isAllowedHost = FEISHU_ATTACHMENT_ALLOWED_BASE_HOSTS.has(hostname) ||
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
    throw unsafeFeishuAttachmentBaseUrlError();
  }
  return `${parsed.protocol}//${hostname}`;
}

function unsafeFeishuAttachmentBaseUrlError(): Error {
  return createIntegrationProviderError({
    provider: FEISHU_PROVIDER_ID,
    code: "feishu.attachment_base_url_unsafe",
    message: "Feishu attachment downloads only allow official Feishu OpenAPI base URLs.",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
