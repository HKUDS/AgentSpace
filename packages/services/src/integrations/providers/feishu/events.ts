import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";

export interface FeishuUrlVerificationPayload extends Record<string, unknown> {
  type: "url_verification";
  challenge: string;
  token?: string;
}

export interface FeishuEncryptedPayload extends Record<string, unknown> {
  encrypt: string;
}

export interface FeishuEventHeader {
  event_id?: string;
  event_type?: string;
  create_time?: string;
  token?: string;
  app_id?: string;
  tenant_key?: string;
}

export interface FeishuEventPayload {
  schema?: string;
  header?: FeishuEventHeader;
  event?: Record<string, unknown>;
}

export type FeishuCallbackContextValidationResult =
  | {
    ok: true;
  }
  | {
    ok: false;
    reasonCode:
      | "feishu.callback_app_id_mismatch"
      | "feishu.callback_tenant_key_missing"
      | "feishu.callback_tenant_key_mismatch";
    errorMessage: string;
  };

export function isFeishuUrlVerificationPayload(value: Record<string, unknown>): value is FeishuUrlVerificationPayload {
  return value.type === "url_verification" && typeof value.challenge === "string";
}

export function isFeishuEncryptedPayload(value: Record<string, unknown>): value is FeishuEncryptedPayload {
  return typeof value.encrypt === "string" && value.encrypt.trim().length > 0;
}

export function isFeishuCardActionCallbackPayload(value: Record<string, unknown>): boolean {
  const eventType = resolveFeishuEventType(value).trim().toLowerCase();
  if (
    eventType === "card.action.trigger" ||
    eventType === "im.message.message_card.action_v1" ||
    eventType === "message_card.action"
  ) {
    return true;
  }

  return eventType.includes("card") && eventType.includes("action");
}

export function isFeishuApprovalCardActionCallbackPayload(value: Record<string, unknown>): boolean {
  if (!isFeishuCardActionCallbackPayload(value)) {
    return false;
  }
  const event = asRecord(value.event);
  const action = asRecord(event?.action);
  const actionValue = readActionValueRecord(action?.value);
  return Boolean(
    asString(actionValue?.approvalId) ??
    asString(actionValue?.approval_id) ??
    asString(actionValue?.payloadHash) ??
    asString(actionValue?.payload_hash) ??
    asString(actionValue?.approvalToken) ??
    asString(actionValue?.approval_token)
  );
}

export function buildFeishuUrlVerificationResponse(payload: FeishuUrlVerificationPayload): Record<string, string> {
  return { challenge: payload.challenge };
}

export function validateFeishuCallbackContext(input: {
  payload: Record<string, unknown>;
  expectedAppId?: string | null;
  expectedTenantKey?: string | null;
}): FeishuCallbackContextValidationResult {
  const expectedAppId = input.expectedAppId?.trim();
  const expectedTenantKey = input.expectedTenantKey?.trim();
  const actualAppId = resolveFeishuCallbackAppId(input.payload);
  const actualTenantKey = resolveFeishuCallbackTenantKey(input.payload);
  if (expectedAppId && actualAppId && actualAppId !== expectedAppId) {
    return {
      ok: false,
      reasonCode: "feishu.callback_app_id_mismatch",
      errorMessage: "Feishu callback app_id does not match this integration.",
    };
  }
  if (expectedTenantKey && !actualTenantKey) {
    return {
      ok: false,
      reasonCode: "feishu.callback_tenant_key_missing",
      errorMessage: "Feishu callback tenant_key is missing for this tenant-scoped integration.",
    };
  }
  if (expectedTenantKey && actualTenantKey !== expectedTenantKey) {
    return {
      ok: false,
      reasonCode: "feishu.callback_tenant_key_mismatch",
      errorMessage: "Feishu callback tenant_key does not match this integration.",
    };
  }
  return { ok: true };
}

export function decryptFeishuEventPayload(input: {
  encryptedPayload: string;
  encryptKey: string;
}): Record<string, unknown> {
  const key = createHash("sha256").update(input.encryptKey, "utf8").digest();
  const encrypted = Buffer.from(input.encryptedPayload, "base64");
  if (encrypted.length <= 16) {
    throw new Error("feishu.encrypted_event_invalid");
  }
  const iv = encrypted.subarray(0, 16);
  const ciphertext = encrypted.subarray(16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
  const parsed = JSON.parse(plaintext) as unknown;
  const record = asRecord(parsed);
  if (!record) {
    throw new Error("feishu.encrypted_event_payload_invalid");
  }
  return record;
}

export function verifyFeishuRequestSignature(input: {
  timestamp?: string | null;
  nonce?: string | null;
  encryptKey: string;
  rawBody: string;
  signature?: string | null;
}): boolean {
  const timestamp = input.timestamp?.trim();
  const nonce = input.nonce?.trim();
  const signature = input.signature?.trim();
  if (!timestamp || !nonce || !signature) {
    return false;
  }
  const expected = createHash("sha256")
    .update(`${timestamp}${nonce}${input.encryptKey}${input.rawBody}`, "utf8")
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const signatureBuffer = Buffer.from(signature, "utf8");
  return expectedBuffer.length === signatureBuffer.length &&
    timingSafeEqual(expectedBuffer, signatureBuffer);
}

export function resolveFeishuEventId(payload: Record<string, unknown>): string {
  const header = asRecord(payload.header);
  return asString(header?.event_id)
    ?? asString(payload.uuid)
    ?? asString(payload.event_id)
    ?? `feishu-event-${Date.now()}`;
}

export function resolveFeishuEventType(payload: Record<string, unknown>): string {
  const header = asRecord(payload.header);
  return asString(header?.event_type)
    ?? asString(payload.type)
    ?? "unknown";
}

export function resolveFeishuEventReceivedAt(payload: Record<string, unknown>): string {
  const header = asRecord(payload.header);
  const createTime = asString(header?.create_time);
  if (createTime) {
    const timestampMs = Number(createTime.length === 10 ? `${createTime}000` : createTime);
    if (Number.isFinite(timestampMs) && timestampMs > 0) {
      return new Date(timestampMs).toISOString();
    }
  }
  return new Date().toISOString();
}

export function resolveFeishuCallbackAppId(payload: Record<string, unknown>): string | undefined {
  const header = asRecord(payload.header);
  const event = asRecord(payload.event);
  return asString(header?.app_id)
    ?? asString(header?.appId)
    ?? asString(payload.app_id)
    ?? asString(payload.appId)
    ?? asString(event?.app_id)
    ?? asString(event?.appId);
}

export function resolveFeishuCallbackTenantKey(payload: Record<string, unknown>): string | undefined {
  const header = asRecord(payload.header);
  const event = asRecord(payload.event);
  return asString(header?.tenant_key)
    ?? asString(header?.tenantKey)
    ?? asString(payload.tenant_key)
    ?? asString(payload.tenantKey)
    ?? asString(event?.tenant_key)
    ?? asString(event?.tenantKey);
}

export function verifyFeishuCallbackToken(input: {
  payload: Record<string, unknown>;
  verificationToken?: string;
}): boolean {
  const expected = input.verificationToken?.trim();
  if (!expected) {
    return true;
  }
  const header = asRecord(input.payload.header);
  const token = asString(header?.token) ?? asString(input.payload.token);
  return token === expected;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readActionValueRecord(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (record) {
    return record;
  }
  if (typeof value !== "string" || !value.trim().startsWith("{")) {
    return null;
  }
  try {
    return asRecord(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}
