import { NextResponse, type NextRequest } from "next/server";
import {
  listExternalIntegrationsSync,
  readExternalIntegrationSync,
  type ExternalIntegrationRecord,
} from "@agent-space/db";
import {
  SLACK_PROVIDER_ID,
  isSlackBlockActionsPayload,
  isSlackInteractionPayload,
  processSlackBlockActionCallback,
  readSlackIntegrationCredentials,
  resolveSlackCallbackAppId,
  resolveSlackCallbackTeamId,
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

  const requestPayload = await readInteractionPayload(request);
  if (!requestPayload) {
    return NextResponse.json({ error: "Invalid Slack interaction payload." }, { status: 400 });
  }

  const integrationResolveResult = resolveSlackInteractionIntegration({
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
    return NextResponse.json({ error: "Invalid Slack request signature." }, { status: 401 });
  }

  if (!isSlackInteractionPayload(requestPayload.payload)) {
    return NextResponse.json({ error: "Unsupported Slack interaction payload." }, { status: 400 });
  }

  const contextValidation = validateSlackCallbackContext({
    payload: requestPayload.payload,
    expectedAppId: integration.appId,
    expectedTeamId: integration.tenantKey,
  });
  if (!contextValidation.ok) {
    return NextResponse.json({
      ok: false,
      error: contextValidation.errorMessage,
      errorCode: contextValidation.reasonCode,
    }, { status: 401 });
  }

  if (!isSlackBlockActionsPayload(requestPayload.payload)) {
    return NextResponse.json({
      ok: true,
      dispatchStatus: "ignored",
      reasonCode: "slack_interaction_unsupported",
    });
  }

  const result = await processSlackBlockActionCallback({
    context: {
      workspaceId,
      integrationId: integration.id,
      provider: SLACK_PROVIDER_ID,
    },
    payload: requestPayload.payload,
  });

  return NextResponse.json({
    ok: true,
    eventId: result.eventId,
    eventStatus: result.eventStatus,
    dispatchStatus: result.handled ? "processed" : result.eventStatus,
    reasonCode: result.reasonCode,
    blockAction: {
      handled: result.handled,
      reasonCode: result.reasonCode,
      approvalId: result.approvalId,
      decision: result.decision,
      reviewerUserId: result.reviewerUserId,
    },
  });
}

type SlackInteractionIntegrationResolveResult =
  | {
    ok: true;
    integration: ExternalIntegrationRecord;
  }
  | {
    ok: false;
    status: 400 | 404;
    error: string;
  };

function resolveSlackInteractionIntegration(input: {
  workspaceId: string;
  integrationId?: string;
  payload: Record<string, unknown>;
}): SlackInteractionIntegrationResolveResult {
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

async function readInteractionPayload(request: NextRequest): Promise<{
  rawBody: string;
  payload: Record<string, unknown>;
} | null> {
  const rawBody = await request.text();
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const payload = new URLSearchParams(rawBody).get("payload");
    return payload ? parseJsonPayload(rawBody, payload) : null;
  }
  return parseJsonPayload(rawBody, rawBody);
}

function parseJsonPayload(rawBody: string, payload: string): {
  rawBody: string;
  payload: Record<string, unknown>;
} | null {
  try {
    const parsed = JSON.parse(payload) as unknown;
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
