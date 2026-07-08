import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  SLACK_SIGNATURE_TOLERANCE_SECONDS,
  SLACK_SIGNATURE_VERSION,
} from "./constants.ts";

export interface SlackUrlVerificationPayload extends Record<string, unknown> {
  type: "url_verification";
  challenge: string;
  token?: string;
}

export interface SlackEventCallbackPayload extends Record<string, unknown> {
  type: "event_callback";
  event_id?: string;
  event_time?: number;
  api_app_id?: string;
  team_id?: string;
  event?: Record<string, unknown>;
}

export interface SlackAgentContextEntitySummary {
  type?: string;
  valueRef?: string;
  teamRef?: string;
  enterpriseRef?: string;
}

export interface SlackAgentContextSummary {
  source: "app_context" | "context";
  hasEntities: boolean;
  entityCount: number;
  entities: SlackAgentContextEntitySummary[];
}

export interface SlackInboundFileSummary {
  fileRef: string;
  displayName?: string;
  mediaType?: string;
  fileType?: string;
  sizeBytes?: number;
  mode?: string;
  isExternal?: boolean;
  privateUrlRedacted: boolean;
  permalinkRedacted: boolean;
}

export interface SlackAppHomeOpenedMessagesTabEvent {
  externalChatId: string;
  externalUserId: string;
  tab: "messages";
}

export type SlackCallbackContextValidationResult =
  | {
    ok: true;
  }
  | {
    ok: false;
    reasonCode:
      | "slack.callback_app_id_mismatch"
      | "slack.callback_team_id_missing"
      | "slack.callback_team_id_mismatch";
    errorMessage: string;
  };

export function isSlackUrlVerificationPayload(value: Record<string, unknown>): value is SlackUrlVerificationPayload {
  return value.type === "url_verification" && typeof value.challenge === "string";
}

export function buildSlackUrlVerificationResponse(payload: SlackUrlVerificationPayload): Record<string, string> {
  return { challenge: payload.challenge };
}

export function verifySlackRequestSignature(input: {
  signingSecret?: string | null;
  timestamp?: string | null;
  rawBody: string;
  signature?: string | null;
  nowMs?: number;
}): boolean {
  const signingSecret = input.signingSecret?.trim();
  const timestamp = input.timestamp?.trim();
  const signature = input.signature?.trim();
  if (!signingSecret || !timestamp || !signature) {
    return false;
  }
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
    return false;
  }
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > SLACK_SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const baseString = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${input.rawBody}`;
  const expected = `${SLACK_SIGNATURE_VERSION}=${createHmac("sha256", signingSecret)
    .update(baseString, "utf8")
    .digest("hex")}`;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const signatureBuffer = Buffer.from(signature, "utf8");
  return expectedBuffer.length === signatureBuffer.length &&
    timingSafeEqual(expectedBuffer, signatureBuffer);
}

export function validateSlackCallbackContext(input: {
  payload: Record<string, unknown>;
  expectedAppId?: string | null;
  expectedTeamId?: string | null;
}): SlackCallbackContextValidationResult {
  const expectedAppId = input.expectedAppId?.trim();
  const expectedTeamId = input.expectedTeamId?.trim();
  const actualAppId = resolveSlackCallbackAppId(input.payload);
  const actualTeamId = resolveSlackCallbackTeamId(input.payload);
  if (expectedAppId && actualAppId && actualAppId !== expectedAppId) {
    return {
      ok: false,
      reasonCode: "slack.callback_app_id_mismatch",
      errorMessage: "Slack callback app id does not match this integration.",
    };
  }
  if (expectedTeamId && !actualTeamId) {
    return {
      ok: false,
      reasonCode: "slack.callback_team_id_missing",
      errorMessage: "Slack callback team id is missing for this team-scoped integration.",
    };
  }
  if (expectedTeamId && actualTeamId !== expectedTeamId) {
    return {
      ok: false,
      reasonCode: "slack.callback_team_id_mismatch",
      errorMessage: "Slack callback team id does not match this integration.",
    };
  }
  return { ok: true };
}

export function resolveSlackEventId(payload: Record<string, unknown>): string {
  return asString(payload.event_id)
    ?? asString(payload.envelope_id)
    ?? asString(payload.eventId)
    ?? `slack-event-${Date.now()}`;
}

export function resolveSlackEventType(payload: Record<string, unknown>): string {
  const event = asRecord(payload.event);
  const innerType = asString(event?.type);
  return innerType
    ? `${asString(payload.type) ?? "event"}.${innerType}`
    : asString(payload.type) ?? "unknown";
}

export function resolveSlackEventReceivedAt(payload: Record<string, unknown>): string {
  const eventTime = readNumber(payload.event_time);
  if (eventTime && eventTime > 0) {
    return new Date(eventTime * 1000).toISOString();
  }
  return new Date().toISOString();
}

export function resolveSlackCallbackAppId(payload: Record<string, unknown>): string | undefined {
  const event = asRecord(payload.event);
  return asString(payload.api_app_id)
    ?? asString(payload.app_id)
    ?? asString(payload.appId)
    ?? asString(event?.api_app_id)
    ?? asString(event?.app_id)
    ?? asString(event?.appId);
}

export function resolveSlackCallbackTeamId(payload: Record<string, unknown>): string | undefined {
  const team = asRecord(payload.team);
  const event = asRecord(payload.event);
  const authorization = Array.isArray(payload.authorizations)
    ? asRecord(payload.authorizations[0])
    : undefined;
  return asString(payload.team_id)
    ?? asString(payload.teamId)
    ?? asString(team?.id)
    ?? asString(event?.team)
    ?? asString(event?.team_id)
    ?? asString(authorization?.team_id);
}

export function isSlackAgentContextChangedEvent(payload: Record<string, unknown>): boolean {
  const event = asRecord(payload.event);
  return asString(event?.type) === "app_context_changed";
}

export function resolveSlackAppHomeOpenedMessagesTabEvent(
  payload: Record<string, unknown>,
): SlackAppHomeOpenedMessagesTabEvent | undefined {
  const event = asRecord(payload.event);
  if (asString(event?.type) !== "app_home_opened" || asString(event?.tab) !== "messages") {
    return undefined;
  }
  const externalChatId = asString(event?.channel);
  const externalUserId = asString(event?.user);
  return externalChatId && externalUserId
    ? { externalChatId, externalUserId, tab: "messages" }
    : undefined;
}

export function summarizeSlackAgentContextPayload(
  payload: Record<string, unknown>,
): SlackAgentContextSummary | undefined {
  const resolved = resolveSlackAgentContext(payload);
  if (!resolved) {
    return undefined;
  }
  const entityRecords = Array.isArray(resolved.context.entities)
    ? resolved.context.entities.flatMap((entity) => {
        const record = asRecord(entity);
        return record ? [record] : [];
      })
    : [];
  const entities = [
    ...entityRecords.flatMap((entity) => {
      const summary = summarizeSlackAgentContextEntity(entity);
      return summary ? [summary] : [];
    }),
    ...summarizeSlackLegacyContextEntity(resolved.context),
  ].slice(0, 10);
  return {
    source: resolved.source,
    hasEntities: entities.length > 0,
    entityCount: entityRecords.length,
    entities,
  };
}

export function summarizeSlackInboundEventPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const event = asRecord(payload.event);
  const text = asString(event?.text);
  const channel = asString(event?.channel);
  const user = asString(event?.user);
  const messageTs = asString(event?.ts);
  const threadTs = asString(event?.thread_ts);
  const agentContext = summarizeSlackAgentContextPayload(payload);
  const files = summarizeSlackInboundFilesPayload(payload);
  return {
    type: asString(payload.type) ?? "unknown",
    eventType: resolveSlackEventType(payload),
    eventRef: buildSlackReference(resolveSlackEventId(payload)),
    appRef: buildOptionalSlackReference(resolveSlackCallbackAppId(payload)),
    teamRef: buildOptionalSlackReference(resolveSlackCallbackTeamId(payload)),
    channelRef: buildOptionalSlackReference(channel),
    userRef: buildOptionalSlackReference(user),
    messageRef: buildOptionalSlackReference(messageTs),
    threadRef: buildOptionalSlackReference(threadTs),
    hasText: Boolean(text),
    textLength: text?.length ?? 0,
    hasFiles: files.length > 0,
    fileCount: files.length,
    files: files.length > 0 ? files : undefined,
    hasAgentContext: Boolean(agentContext),
    agentContext,
  };
}

export function summarizeSlackInboundFilesPayload(payload: Record<string, unknown>): SlackInboundFileSummary[] {
  const event = asRecord(payload.event);
  return summarizeSlackInboundFiles(event?.files);
}

export function buildSlackReference(value: string): string {
  return `ref_${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8)}`;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function buildOptionalSlackReference(value: string | undefined): string | undefined {
  return value ? buildSlackReference(value) : undefined;
}

function buildSlackContextValueReference(value: unknown): string | undefined {
  const stringValue = asString(value);
  if (stringValue) {
    return buildSlackReference(stringValue);
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  try {
    return buildSlackReference(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

function resolveSlackAgentContext(payload: Record<string, unknown>): {
  source: SlackAgentContextSummary["source"];
  context: Record<string, unknown>;
} | undefined {
  const event = asRecord(payload.event);
  const appContext = asRecord(event?.app_context) ?? asRecord(payload.app_context);
  if (appContext) {
    return { source: "app_context", context: appContext };
  }
  const context = asRecord(event?.context) ?? asRecord(payload.context);
  return context ? { source: "context", context } : undefined;
}

function summarizeSlackAgentContextEntity(
  entity: Record<string, unknown>,
): SlackAgentContextEntitySummary | undefined {
  const summary = {
    type: truncateSlackContextText(asString(entity.type), 120),
    valueRef: buildSlackContextValueReference(entity.value),
    teamRef: buildOptionalSlackReference(asString(entity.team_id)),
    enterpriseRef: buildOptionalSlackReference(asString(entity.enterprise_id)),
  };
  return hasSlackAgentContextEntitySignal(summary) ? summary : undefined;
}

function summarizeSlackLegacyContextEntity(
  context: Record<string, unknown>,
): SlackAgentContextEntitySummary[] {
  const channelId = asString(context.channel_id);
  if (!channelId) {
    return [];
  }
  return [{
    type: "slack#/types/channel_id",
    valueRef: buildSlackReference(channelId),
    teamRef: buildOptionalSlackReference(asString(context.team_id)),
    enterpriseRef: buildOptionalSlackReference(asString(context.enterprise_id)),
  }];
}

function summarizeSlackInboundFiles(value: unknown): SlackInboundFileSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const file = asRecord(item);
    if (!file) {
      return [];
    }
    const summary = summarizeSlackInboundFile(file);
    return summary ? [summary] : [];
  }).slice(0, 10);
}

function summarizeSlackInboundFile(file: Record<string, unknown>): SlackInboundFileSummary | undefined {
  const fileId = asString(file.id) ?? asString(file.file_id);
  const displayName = truncateSlackContextText(
    asString(file.title) ?? asString(file.name) ?? asString(file.pretty_type),
    160,
  );
  const mediaType = truncateSlackContextText(asString(file.mimetype), 120);
  const fileType = truncateSlackContextText(asString(file.filetype), 80);
  const sizeBytes = readNumber(file.size);
  const mode = truncateSlackContextText(asString(file.mode), 40);
  const fallbackSeed = JSON.stringify({
    displayName,
    mediaType,
    fileType,
    sizeBytes,
    mode,
  });
  const fileRef = buildSlackReference(fileId ?? fallbackSeed);
  if (!fileRef) {
    return undefined;
  }
  return {
    fileRef,
    displayName,
    mediaType,
    fileType,
    sizeBytes,
    mode,
    isExternal: file.is_external === true,
    privateUrlRedacted: Boolean(asString(file.url_private) || asString(file.url_private_download)),
    permalinkRedacted: Boolean(asString(file.permalink) || asString(file.permalink_public)),
  };
}

function hasSlackAgentContextEntitySignal(entity: SlackAgentContextEntitySummary): boolean {
  return Boolean(entity.type || entity.valueRef || entity.teamRef || entity.enterpriseRef);
}

function truncateSlackContextText(value: string | undefined, maxLength: number): string | undefined {
  return value && value.length > maxLength ? value.slice(0, maxLength).trimEnd() : value;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
