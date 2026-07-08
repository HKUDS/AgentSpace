import type { MessageAttachment } from "@agent-space/domain/workspace";
import { persistWorkspaceAttachmentFromBytesSync } from "../../../attachments/attachments.ts";
import {
  createIntegrationProviderError,
  type ExternalMessageAttachment,
  type ExternalMessageEnvelope,
  type IntegrationRuntimeContext,
} from "../../core/index.ts";
import { SLACK_PROVIDER_ID } from "./constants.ts";
import {
  asRecord,
  asString,
  buildSlackReference,
} from "./events.ts";

export const SLACK_INBOUND_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const SLACK_INBOUND_ATTACHMENT_TIMEOUT_MS = 15_000;

const SLACK_FILE_DOWNLOAD_ALLOWED_HOSTS = new Set([
  "files.slack.com",
]);

export interface SlackInboundAttachmentDescriptor {
  fileRef: string;
  fileId?: string;
  fileName: string;
  mediaType?: string;
  fileType?: string;
  sizeBytes?: number;
  downloadUrl?: string;
  mode?: string;
  isExternal?: boolean;
}

export interface SlackInboundAttachmentDownloadInput {
  context: IntegrationRuntimeContext;
  message: ExternalMessageEnvelope;
  attachment: ExternalMessageAttachment;
  attachmentIndex: number;
  payload: Record<string, unknown>;
}

export type SlackInboundAttachmentDownloader = (
  input: SlackInboundAttachmentDownloadInput
) => MessageAttachment | null | Promise<MessageAttachment | null>;

export function createSlackInboundAttachmentDownloader(input: {
  workspaceId: string;
  botToken: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
}): SlackInboundAttachmentDownloader {
  return async (downloadInput) =>
    downloadSlackInboundMessageAttachment({
      workspaceId: input.workspaceId,
      botToken: input.botToken,
      payload: downloadInput.payload,
      attachment: downloadInput.attachment,
      attachmentIndex: downloadInput.attachmentIndex,
      baseUrl: input.baseUrl,
      fetchImpl: input.fetchImpl,
      maxBytes: input.maxBytes,
      timeoutMs: input.timeoutMs,
    });
}

export async function downloadSlackInboundMessageAttachment(input: {
  workspaceId: string;
  botToken: string;
  payload: Record<string, unknown>;
  attachment: ExternalMessageAttachment;
  attachmentIndex?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
}): Promise<MessageAttachment> {
  const botToken = input.botToken.trim();
  if (!botToken) {
    throw createIntegrationProviderError({
      provider: SLACK_PROVIDER_ID,
      code: "slack.bot_token_missing",
      message: "Slack bot token is missing.",
    });
  }
  const descriptor = resolveSlackInboundAttachmentDescriptor({
    payload: input.payload,
    attachment: input.attachment,
    attachmentIndex: input.attachmentIndex,
  });
  if (!descriptor) {
    throw createIntegrationProviderError({
      provider: SLACK_PROVIDER_ID,
      code: "slack.attachment_descriptor_invalid",
      message: "Slack inbound attachment is missing file metadata.",
    });
  }

  const maxBytes = normalizePositiveInteger(input.maxBytes, SLACK_INBOUND_ATTACHMENT_MAX_BYTES);
  if (descriptor.sizeBytes !== undefined && descriptor.sizeBytes > maxBytes) {
    throw createIntegrationProviderError({
      provider: SLACK_PROVIDER_ID,
      code: "slack.attachment_too_large",
      message: `Slack attachment exceeds the ${maxBytes} byte download limit.`,
    });
  }

  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw createIntegrationProviderError({
      provider: SLACK_PROVIDER_ID,
      code: "slack.fetch_unavailable",
      message: "Fetch is not available for Slack attachment downloads.",
    });
  }

  const fileInfoDescriptor = descriptor.fileId
    ? await fetchSlackFileInfoDescriptor({
        botToken,
        fileId: descriptor.fileId,
        fallback: descriptor,
        baseUrl: input.baseUrl,
        fetchImpl,
      })
    : descriptor;
  const downloadUrl = fileInfoDescriptor.downloadUrl ?? descriptor.downloadUrl;
  if (!downloadUrl) {
    throw createIntegrationProviderError({
      provider: SLACK_PROVIDER_ID,
      code: "slack.attachment_download_url_missing",
      message: "Slack attachment does not include a downloadable private file URL.",
    });
  }

  const safeDownloadUrl = resolveSafeSlackFileDownloadUrl(downloadUrl, {
    allowTestUrl: Boolean(input.fetchImpl),
  });
  const timeoutMs = normalizePositiveInteger(input.timeoutMs, SLACK_INBOUND_ATTACHMENT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(safeDownloadUrl, {
      method: "GET",
      headers: {
        authorization: `Bearer ${botToken}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw createIntegrationProviderError({
        provider: SLACK_PROVIDER_ID,
        code: "slack.attachment_download_http_error",
        message: `Slack attachment download failed with HTTP ${response.status}.`,
      });
    }

    const declaredLength = parseContentLength(response.headers.get("content-length"));
    if (declaredLength !== undefined && declaredLength > maxBytes) {
      throw createIntegrationProviderError({
        provider: SLACK_PROVIDER_ID,
        code: "slack.attachment_too_large",
        message: `Slack attachment exceeds the ${maxBytes} byte download limit.`,
      });
    }

    const mediaType = resolveSafeSlackAttachmentMediaType({
      descriptor: fileInfoDescriptor,
      responseMediaType: response.headers.get("content-type") ?? undefined,
    });
    const contentBytes = await readSlackAttachmentBodyWithLimit(response, maxBytes);
    return persistWorkspaceAttachmentFromBytesSync({
      workspaceId: input.workspaceId,
      contentBytes,
      fileName: fileInfoDescriptor.fileName,
      mediaType,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw createIntegrationProviderError({
        provider: SLACK_PROVIDER_ID,
        code: "slack.attachment_download_timeout",
        message: `Slack attachment download exceeded the ${timeoutMs} ms timeout.`,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function resolveSlackInboundAttachmentDescriptor(input: {
  payload: Record<string, unknown>;
  attachment: ExternalMessageAttachment;
  attachmentIndex?: number;
}): SlackInboundAttachmentDescriptor | null {
  const metadata = asRecord(input.attachment.metadata) ?? {};
  if (metadata.provider !== SLACK_PROVIDER_ID || metadata.source !== "slack_file_metadata") {
    return null;
  }
  const fileRef = asString(metadata.fileRef) ?? input.attachment.id?.trim();
  if (!fileRef) {
    return null;
  }

  const rawFiles = readSlackRawFileRecords(input.payload);
  const indexed = input.attachmentIndex !== undefined ? rawFiles[input.attachmentIndex] : undefined;
  const matched = rawFiles.find((file) => {
    const fileId = asString(file.id) ?? asString(file.file_id);
    return fileId ? buildSlackReference(fileId) === fileRef : false;
  }) ?? indexed;
  const fileId = matched ? asString(matched.id) ?? asString(matched.file_id) : undefined;
  const fileName = normalizeSlackFileName(
    asString(input.attachment.fileName) ??
      asString(matched?.title) ??
      asString(matched?.name) ??
      "slack-file",
  );
  return {
    fileRef,
    fileId,
    fileName,
    mediaType: normalizeMediaType(input.attachment.mediaType ?? asString(matched?.mimetype)),
    fileType: truncateText(asString(matched?.filetype) ?? asString(metadata.fileType), 80),
    sizeBytes: normalizeOptionalSizeBytes(input.attachment.sizeBytes ?? readNumber(matched?.size)),
    downloadUrl: asString(matched?.url_private_download) ?? asString(matched?.url_private),
    mode: truncateText(asString(matched?.mode) ?? asString(metadata.mode), 40),
    isExternal: matched?.is_external === true || metadata.isExternal === true,
  };
}

async function fetchSlackFileInfoDescriptor(input: {
  botToken: string;
  fileId: string;
  fallback: SlackInboundAttachmentDescriptor;
  baseUrl?: string;
  fetchImpl: typeof fetch;
}): Promise<SlackInboundAttachmentDescriptor> {
  const response = await input.fetchImpl(`${input.baseUrl ?? "https://slack.com/api"}/files.info`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.botToken}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ file: input.fileId }),
  });
  const data = await readJsonResponse(response);
  if (!(response.ok && data.ok === true)) {
    const errorCode = typeof data.error === "string" ? data.error : `http_${response.status}`;
    throw createIntegrationProviderError({
      provider: SLACK_PROVIDER_ID,
      code: "slack.file_info_failed",
      message: `Slack files.info failed: ${errorCode}`,
    });
  }
  const file = asRecord(data.file);
  if (!file) {
    return input.fallback;
  }
  return {
    ...input.fallback,
    fileName: normalizeSlackFileName(
      asString(file.title) ?? asString(file.name) ?? input.fallback.fileName,
    ),
    mediaType: normalizeMediaType(asString(file.mimetype)) ?? input.fallback.mediaType,
    fileType: truncateText(asString(file.filetype) ?? input.fallback.fileType, 80),
    sizeBytes: normalizeOptionalSizeBytes(readNumber(file.size)) ?? input.fallback.sizeBytes,
    downloadUrl: asString(file.url_private_download) ?? asString(file.url_private) ?? input.fallback.downloadUrl,
    mode: truncateText(asString(file.mode) ?? input.fallback.mode, 40),
    isExternal: file.is_external === true || input.fallback.isExternal === true,
  };
}

async function readSlackAttachmentBodyWithLimit(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const body = response.body;
  if (!body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    assertSlackAttachmentSizeWithinLimit(buffer.byteLength, maxBytes);
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
    assertSlackAttachmentSizeWithinLimit(totalBytes, maxBytes);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, totalBytes);
}

function assertSlackAttachmentSizeWithinLimit(sizeBytes: number, maxBytes: number): void {
  if (sizeBytes <= maxBytes) {
    return;
  }
  throw createIntegrationProviderError({
    provider: SLACK_PROVIDER_ID,
    code: "slack.attachment_too_large",
    message: `Slack attachment exceeds the ${maxBytes} byte download limit.`,
  });
}

function resolveSafeSlackAttachmentMediaType(input: {
  descriptor: SlackInboundAttachmentDescriptor;
  responseMediaType?: string;
}): string {
  const responseMediaType = normalizeMediaType(input.responseMediaType);
  const descriptorMediaType = normalizeMediaType(input.descriptor.mediaType);
  const mediaType = responseMediaType
    ?? descriptorMediaType
    ?? "application/octet-stream";
  if (isBlockedSlackFileMediaType(mediaType)) {
    throw createIntegrationProviderError({
      provider: SLACK_PROVIDER_ID,
      code: "slack.attachment_media_type_unsupported",
      message: `Slack attachment media type "${mediaType}" is not supported.`,
    });
  }
  return mediaType;
}

function resolveSafeSlackFileDownloadUrl(
  value: string,
  options: { allowTestUrl?: boolean } = {},
): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw unsafeSlackFileDownloadUrlError();
  }
  const hostname = parsed.hostname.toLowerCase();
  const isAllowedHost = SLACK_FILE_DOWNLOAD_ALLOWED_HOSTS.has(hostname) ||
    hostname.endsWith(".slack-files.com") ||
    (options.allowTestUrl === true && hostname.endsWith(".test"));
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    !isAllowedHost ||
    isLocalOrPrivateHostname(hostname)
  ) {
    throw unsafeSlackFileDownloadUrlError();
  }
  return parsed.toString();
}

function unsafeSlackFileDownloadUrlError(): Error {
  return createIntegrationProviderError({
    provider: SLACK_PROVIDER_ID,
    code: "slack.attachment_download_url_unsafe",
    message: "Slack attachment downloads only allow Slack private file URLs.",
  });
}

function readSlackRawFileRecords(payload: Record<string, unknown>): Record<string, unknown>[] {
  const event = asRecord(payload.event);
  const files = Array.isArray(event?.files) ? event.files : [];
  return files.flatMap((file) => {
    const record = asRecord(file);
    return record ? [record] : [];
  });
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
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

function isBlockedSlackFileMediaType(mediaType: string): boolean {
  return mediaType === "text/html" ||
    mediaType === "application/xhtml+xml" ||
    mediaType === "application/javascript" ||
    mediaType === "text/javascript" ||
    mediaType === "application/x-msdownload" ||
    mediaType === "application/x-sh";
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

function normalizeSlackFileName(value: string): string {
  const trimmed = value.trim() || "slack-file";
  return trimmed.length > 255 ? trimmed.slice(0, 255).trimEnd() : trimmed;
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  return value && value.length > maxLength ? value.slice(0, maxLength).trimEnd() : value;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
