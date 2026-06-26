import { NextResponse, type NextRequest } from "next/server";
import {
  listExternalIntegrationsSync,
  readExternalIntegrationSync,
  type ExternalIntegrationRecord,
} from "@agent-space/db";
import {
  FEISHU_PROVIDER_ID,
  buildFeishuUrlVerificationResponse,
  createFeishuInboundAttachmentDownloader,
  decryptFeishuEventPayload,
  drainFeishuOutboxMessages,
  isFeishuEncryptedPayload,
  isFeishuApprovalCardActionCallbackPayload,
  isFeishuCardActionCallbackPayload,
  isFeishuUrlVerificationPayload,
  processFeishuCardActionCallback,
  processFeishuInboundEvent,
  recordFeishuCardActionCallbackIgnoredSync,
  recordFeishuCallbackRejectedSync,
  resolveFeishuCallbackAppId,
  resolveFeishuCallbackTenantKey,
  validateFeishuCallbackContext,
  verifyFeishuCallbackToken,
  verifyFeishuRequestSignature,
} from "@agent-space/services";
import { readFeishuIntegrationCredentials } from "@/features/integrations/feishu/feishu-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
  const integrationId = request.nextUrl.searchParams.get("integrationId")?.trim();
  if (!workspaceId) {
    return NextResponse.json({ error: "Missing Feishu integration context." }, { status: 400 });
  }

  const requestPayload = await readJsonPayload(request);
  if (!requestPayload) {
    return NextResponse.json({ error: "Invalid Feishu event payload." }, { status: 400 });
  }

  const integrationResolveResult = resolveFeishuWebhookIntegration({
    workspaceId,
    integrationId,
    payload: requestPayload.payload,
  });
  if (!integrationResolveResult.ok) {
    return NextResponse.json({ error: integrationResolveResult.error }, { status: integrationResolveResult.status });
  }
  const integration = integrationResolveResult.integration;

  const credentials = readFeishuIntegrationCredentials(integration);
  const payloadResult = resolveFeishuEventPayload({
    request,
    rawBody: requestPayload.rawBody,
    payload: requestPayload.payload,
    encryptKey: credentials.encryptKey,
  });
  if (!payloadResult.ok) {
    return NextResponse.json({ error: payloadResult.errorMessage }, { status: payloadResult.status });
  }
  const payload = payloadResult.payload;
  if (!verifyFeishuCallbackToken({
    payload,
    verificationToken: credentials.verificationToken,
  })) {
    return NextResponse.json({ error: "Invalid Feishu verification token." }, { status: 401 });
  }

  if (isFeishuUrlVerificationPayload(payload)) {
    return NextResponse.json(buildFeishuUrlVerificationResponse(payload));
  }

  const contextValidation = validateFeishuCallbackContext({
    payload,
    expectedAppId: integration.appId,
    expectedTenantKey: integration.tenantKey,
  });
  if (!contextValidation.ok) {
    const result = recordFeishuCallbackRejectedSync({
      context: {
        workspaceId,
        integrationId: integration.id,
        provider: FEISHU_PROVIDER_ID,
      },
      payload,
      reasonCode: contextValidation.reasonCode,
    });
    return NextResponse.json({
      ok: false,
      error: contextValidation.errorMessage,
      errorCode: contextValidation.reasonCode,
      eventId: result.event.externalEventId,
      eventStatus: result.event.status,
    }, { status: 401 });
  }

  if (isFeishuCardActionCallbackPayload(payload)) {
    if (!isFeishuApprovalCardActionCallbackPayload(payload)) {
      const result = recordFeishuCardActionCallbackIgnoredSync({
        context: {
          workspaceId,
          integrationId: integration.id,
          provider: FEISHU_PROVIDER_ID,
        },
        payload,
        reasonCode: "feishu_card_action_non_approval_ignored",
      });
      return NextResponse.json({
        ok: true,
        eventId: result.event.externalEventId,
        eventStatus: result.event.status,
        dispatchStatus: result.dispatchStatus,
        reasonCode: result.reasonCode,
        cardAction: {
          handled: false,
          reasonCode: result.reasonCode,
        },
      });
    }

    const result = await processFeishuCardActionCallback({
      context: {
        workspaceId,
        integrationId: integration.id,
        provider: FEISHU_PROVIDER_ID,
      },
      payload,
      baseUrl: process.env.AGENT_SPACE_FEISHU_API_BASE_URL,
    });
    return NextResponse.json({
      ok: true,
      eventId: result.eventId,
      eventStatus: result.eventStatus,
      dispatchStatus: result.handled ? "sent" : result.eventStatus,
      reasonCode: result.reasonCode,
      cardAction: {
        handled: result.handled,
        reasonCode: result.reasonCode,
        approvalId: result.approvalId,
        decision: result.decision,
        reviewerUserId: result.reviewerUserId,
        execution: result.execution,
      },
    });
  }

  let result: Awaited<ReturnType<typeof processFeishuInboundEvent>>;
  try {
    result = await processFeishuInboundEvent({
      context: {
        workspaceId,
        integrationId: integration.id,
        provider: FEISHU_PROVIDER_ID,
      },
      payload,
      attachmentDownloader: createFeishuInboundAttachmentDownloader({
        workspaceId,
        appId: integration.appId ?? "",
        appSecret: credentials.appSecret,
        baseUrl: process.env.AGENT_SPACE_FEISHU_API_BASE_URL,
      }),
    });
  } catch (error) {
    return NextResponse.json(buildFeishuWebhookErrorResponse({
      errorCode: "feishu.webhook_processing_failed",
      errorMessage: "Feishu webhook event processing failed.",
      error,
    }), { status: 500 });
  }

  const outboxDrain = await drainFeishuWebhookOutbox({
    workspaceId,
    integrationId: integration.id,
  });

  return NextResponse.json({
    ok: true,
    eventId: result.event.externalEventId,
    eventStatus: result.event.status,
    dispatchStatus: result.dispatchStatus,
    reasonCode: result.reasonCode,
    messageId: result.message?.externalMessageId,
    mappedChannelName: result.mappedChannelName,
    noticeOutboxId: result.noticeOutbox?.id,
    outboxDrain,
  });
}

type FeishuWebhookIntegrationResolveResult =
  | {
    ok: true;
    integration: ExternalIntegrationRecord;
  }
  | {
    ok: false;
    status: 400 | 404;
    error: string;
  };

function resolveFeishuWebhookIntegration(input: {
  workspaceId: string;
  integrationId?: string;
  payload: Record<string, unknown>;
}): FeishuWebhookIntegrationResolveResult {
  const integrationId = input.integrationId?.trim();
  if (integrationId) {
    const integration = readExternalIntegrationSync({
      workspaceId: input.workspaceId,
      integrationId,
    });
    return isActiveFeishuIntegration(integration)
      ? { ok: true, integration }
      : { ok: false, status: 404, error: "Feishu integration is not active." };
  }

  if (isFeishuEncryptedPayload(input.payload)) {
    return {
      ok: false,
      status: 400,
      error: "Encrypted Feishu events require an integration id in the callback URL.",
    };
  }

  const appId = resolveFeishuCallbackAppId(input.payload);
  if (!appId) {
    return {
      ok: false,
      status: 400,
      error: "Missing Feishu integration context.",
    };
  }

  const tenantKey = resolveFeishuCallbackTenantKey(input.payload);
  const candidates = listExternalIntegrationsSync({
    workspaceId: input.workspaceId,
    provider: FEISHU_PROVIDER_ID,
  }).filter((integration) =>
    integration.status === "active" &&
    integration.appId === appId);
  const exactTenant = candidates.filter((integration) =>
    (integration.tenantKey ?? "") === (tenantKey ?? ""));
  const matches = exactTenant.length > 0
    ? exactTenant
    : tenantKey
      ? []
      : candidates;
  if (matches.length === 1 && matches[0]) {
    return { ok: true, integration: matches[0] };
  }
  if (matches.length > 1 || (!tenantKey && candidates.length > 1)) {
    return {
      ok: false,
      status: 400,
      error: "Feishu callback app_id matches multiple integrations; tenant_key is required.",
    };
  }
  return {
    ok: false,
    status: 404,
    error: "Feishu integration is not active.",
  };
}

function isActiveFeishuIntegration(
  integration: ExternalIntegrationRecord | null,
): integration is ExternalIntegrationRecord {
  return Boolean(integration && integration.provider === FEISHU_PROVIDER_ID && integration.status === "active");
}

async function drainFeishuWebhookOutbox(input: {
  workspaceId: string;
  integrationId: string;
}): Promise<{
  processedCount: number;
  sentCount: number;
  failedCount: number;
  errorCode?: string;
  errorMessage?: string;
}> {
  try {
    const outboxDrain = await drainFeishuOutboxMessages({
      workspaceId: input.workspaceId,
      integrationId: input.integrationId,
      lockedBy: "agent-space-webhook",
      limit: 5,
    });
    return {
      processedCount: outboxDrain.processedCount,
      sentCount: outboxDrain.sentCount,
      failedCount: outboxDrain.failedCount,
    };
  } catch (error) {
    return {
      processedCount: 0,
      sentCount: 0,
      failedCount: 1,
      errorCode: "feishu.webhook_outbox_drain_failed",
      errorMessage: formatFeishuWebhookErrorMessage(error),
    };
  }
}

function buildFeishuWebhookErrorResponse(input: {
  errorCode: string;
  errorMessage: string;
  error?: unknown;
}): {
  ok: false;
  errorCode: string;
  error: string;
  errorMessage: string;
} {
  return {
    ok: false,
    errorCode: input.errorCode,
    error: input.errorMessage,
    errorMessage: input.error ? formatFeishuWebhookErrorMessage(input.error) : input.errorMessage,
  };
}

function formatFeishuWebhookErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactFeishuWebhookErrorText(message || "Feishu webhook operation failed.");
}

function redactFeishuWebhookErrorText(value: string): string {
  return value
    .replace(/(app[_-]?secret|encrypt[_-]?key|tenant[_-]?access[_-]?token|access[_-]?token|token|secret|password)=([^\s,;&]+)/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .slice(0, 500);
}

type FeishuPayloadResolveResult =
  | {
    ok: true;
    payload: Record<string, unknown>;
  }
  | {
    ok: false;
    status: 400 | 401;
    errorMessage: string;
  };

function resolveFeishuEventPayload(input: {
  request: NextRequest;
  rawBody: string;
  payload: Record<string, unknown>;
  encryptKey?: string;
}): FeishuPayloadResolveResult {
  if (!isFeishuEncryptedPayload(input.payload)) {
    return {
      ok: true,
      payload: input.payload,
    };
  }

  const encryptKey = input.encryptKey?.trim();
  if (!encryptKey) {
    return {
      ok: false,
      status: 400,
      errorMessage: "Feishu encrypted event requires an encrypt key.",
    };
  }

  const signatureOk = verifyFeishuRequestSignature({
    timestamp: input.request.headers.get("x-lark-request-timestamp"),
    nonce: input.request.headers.get("x-lark-request-nonce"),
    signature: input.request.headers.get("x-lark-signature"),
    encryptKey,
    rawBody: input.rawBody,
  });
  if (!signatureOk) {
    return {
      ok: false,
      status: 401,
      errorMessage: "Invalid Feishu request signature.",
    };
  }

  try {
    return {
      ok: true,
      payload: decryptFeishuEventPayload({
        encryptedPayload: input.payload.encrypt,
        encryptKey,
      }),
    };
  } catch {
    return {
      ok: false,
      status: 400,
      errorMessage: "Invalid Feishu encrypted event payload.",
    };
  }
}

async function readJsonPayload(request: NextRequest): Promise<{
  rawBody: string;
  payload: Record<string, unknown>;
} | null> {
  try {
    const rawBody = await request.text();
    const value = JSON.parse(rawBody) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? {
        rawBody,
        payload: value as Record<string, unknown>,
      }
      : null;
  } catch {
    return null;
  }
}
