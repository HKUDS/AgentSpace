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

export function summarizeSlackInboundEventPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const event = asRecord(payload.event);
  const text = asString(event?.text);
  const channel = asString(event?.channel);
  const user = asString(event?.user);
  const messageTs = asString(event?.ts);
  const threadTs = asString(event?.thread_ts);
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
  };
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

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
