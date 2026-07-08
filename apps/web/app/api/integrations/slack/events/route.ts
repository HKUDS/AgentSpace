import { NextResponse, type NextRequest } from "next/server";
import {
  listExternalIntegrationsSync,
  recordExternalIntegrationEventSync,
  readExternalIntegrationSync,
  type ExternalIntegrationRecord,
} from "@agent-space/db";
import {
  SLACK_PROVIDER_ID,
  buildSlackUrlVerificationResponse,
  createSlackInboundAttachmentDownloader,
  drainSlackOutboxMessages,
  isSlackUrlVerificationPayload,
  processSlackInboundEvent,
  readSlackIntegrationCredentials,
  resolveSlackCallbackAppId,
  resolveSlackCallbackTeamId,
  resolveSlackEventId,
  resolveSlackEventReceivedAt,
  resolveSlackEventType,
  summarizeSlackInboundEventPayload,
  validateSlackCallbackContext,
  verifySlackRequestSignature,
} from "@agent-space/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
  const integrationId = request.nextUrl.searchParams.get("integrationId")?.trim();
  if (!workspaceId) {
    return NextResponse.json({ error: "Missing Slack integration context." }, { status: 400 });
  }

  const requestPayload = await readJsonPayload(request);
  if (!requestPayload) {
    return NextResponse.json({ error: "Invalid Slack event payload." }, { status: 400 });
  }

  const integrationResolveResult = resolveSlackWebhookIntegration({
    workspaceId,
    integrationId,
    payload: requestPayload.payload,
  });
  if (!integrationResolveResult.ok) {
    return NextResponse.json({ error: integrationResolveResult.error }, { status: integrationResolveResult.status });
  }
  const integration = integrationResolveResult.integration;
  const credentials = readSlackIntegrationCredentials(integration);

  if (!verifySlackRequestSignature({
    signingSecret: credentials.signingSecret,
    timestamp: request.headers.get("x-slack-request-timestamp"),
    rawBody: requestPayload.rawBody,
    signature: request.headers.get("x-slack-signature"),
  })) {
    recordRejectedSlackWebhookEvent({
      workspaceId,
      integration,
      payload: requestPayload.payload,
      reasonCode: "slack.invalid_signature",
    });
    return NextResponse.json({ error: "Invalid Slack request signature." }, { status: 401 });
  }

  if (isSlackUrlVerificationPayload(requestPayload.payload)) {
    return NextResponse.json(buildSlackUrlVerificationResponse(requestPayload.payload));
  }

  const contextValidation = validateSlackCallbackContext({
    payload: requestPayload.payload,
    expectedAppId: integration.appId,
    expectedTeamId: integration.tenantKey,
  });
  if (!contextValidation.ok) {
    recordRejectedSlackWebhookEvent({
      workspaceId,
      integration,
      payload: requestPayload.payload,
      reasonCode: contextValidation.reasonCode,
    });
    return NextResponse.json({
      ok: false,
      error: contextValidation.errorMessage,
      errorCode: contextValidation.reasonCode,
    }, { status: 401 });
  }

  let result: Awaited<ReturnType<typeof processSlackInboundEvent>>;
  try {
    result = await processSlackInboundEvent({
      context: {
        workspaceId,
        integrationId: integration.id,
        provider: SLACK_PROVIDER_ID,
      },
      payload: requestPayload.payload,
      integration,
      attachmentDownloader: createSlackInboundAttachmentDownloader({
        workspaceId,
        botToken: credentials.botToken,
      }),
    });
  } catch (error) {
    return NextResponse.json(buildSlackWebhookErrorResponse({
      errorCode: "slack.webhook_processing_failed",
      errorMessage: "Slack webhook event processing failed.",
    }), { status: 500 });
  }

  const outboxDrain = await drainSlackWebhookOutbox({
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
    agentSpaceMessageId: result.agentSpaceMessageId,
    outboxDrain,
  });
}

function recordRejectedSlackWebhookEvent(input: {
  workspaceId: string;
  integration: ExternalIntegrationRecord;
  payload: Record<string, unknown>;
  reasonCode: string;
}): void {
  try {
    recordExternalIntegrationEventSync({
      workspaceId: input.workspaceId,
      integrationId: input.integration.id,
      provider: SLACK_PROVIDER_ID,
      externalEventId: resolveSlackEventId(input.payload),
      eventType: resolveSlackEventType(input.payload),
      status: "ignored",
      payloadJson: summarizeSlackInboundEventPayload(input.payload),
      errorMessage: input.reasonCode,
      receivedAt: resolveSlackEventReceivedAt(input.payload),
    });
  } catch {
    // Slack still needs the rejection response even if local audit storage is unavailable.
  }
}

type SlackWebhookIntegrationResolveResult =
  | {
    ok: true;
    integration: ExternalIntegrationRecord;
  }
  | {
    ok: false;
    status: 400 | 404;
    error: string;
  };

function resolveSlackWebhookIntegration(input: {
  workspaceId: string;
  integrationId?: string;
  payload: Record<string, unknown>;
}): SlackWebhookIntegrationResolveResult {
  const integrationId = input.integrationId?.trim();
  if (integrationId) {
    const integration = readExternalIntegrationSync({
      workspaceId: input.workspaceId,
      integrationId,
    });
    return isActiveSlackIntegration(integration)
      ? { ok: true, integration }
      : { ok: false, status: 404, error: "Slack integration is not active." };
  }

  const appId = resolveSlackCallbackAppId(input.payload);
  if (!appId) {
    return {
      ok: false,
      status: 400,
      error: "Missing Slack integration context.",
    };
  }

  const teamId = resolveSlackCallbackTeamId(input.payload);
  const candidates = listExternalIntegrationsSync({
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
  }).filter((integration) =>
    integration.status === "active" &&
    integration.appId === appId);
  const exactTeam = candidates.filter((integration) =>
    (integration.tenantKey ?? "") === (teamId ?? ""));
  const matches = exactTeam.length > 0
    ? exactTeam
    : teamId
      ? []
      : candidates;
  if (matches.length === 1 && matches[0]) {
    return { ok: true, integration: matches[0] };
  }
  if (matches.length > 1 || (!teamId && candidates.length > 1)) {
    return {
      ok: false,
      status: 400,
      error: "Slack callback app id matches multiple integrations; team id is required.",
    };
  }
  return {
    ok: false,
    status: 404,
    error: "Slack integration is not active.",
  };
}

function isActiveSlackIntegration(
  integration: ExternalIntegrationRecord | null,
): integration is ExternalIntegrationRecord {
  return Boolean(integration && integration.provider === SLACK_PROVIDER_ID && integration.status === "active");
}

async function readJsonPayload(request: NextRequest): Promise<{
  rawBody: string;
  payload: Record<string, unknown>;
} | null> {
  const rawBody = await request.text();
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return {
      rawBody,
      payload: parsed as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

async function drainSlackWebhookOutbox(input: {
  workspaceId: string;
  integrationId: string;
}): Promise<Awaited<ReturnType<typeof drainSlackOutboxMessages>> | { ok: false; errorMessage: string }> {
  try {
    return await drainSlackOutboxMessages({
      workspaceId: input.workspaceId,
      integrationId: input.integrationId,
      lockedBy: "slack-webhook",
      limit: 10,
    });
  } catch (error) {
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildSlackWebhookErrorResponse(input: {
  errorCode: string;
  errorMessage: string;
}): {
  ok: false;
  errorCode: string;
  errorMessage: string;
} {
  return {
    ok: false,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
  };
}
