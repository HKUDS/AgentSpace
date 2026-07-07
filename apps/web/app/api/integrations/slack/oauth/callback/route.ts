import { NextResponse } from "next/server";
import { readWorkspaceMembershipSync } from "@agent-space/db";
import { buildPublicAppUrl } from "@/features/auth/public-app-url";
import { getCurrentUser } from "@/features/auth/server-auth";
import { hasWorkspaceRole } from "@/features/auth/workspace-permissions";
import {
  installSlackIntegrationFromOAuthCode,
  readSlackOAuthConfig,
  verifySlackOAuthCallbackState,
} from "@/features/integrations/slack/slack-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const appUrl = readSlackOAuthRedirectBaseUrl(`${url.protocol}//${url.host}`);
  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const error = url.searchParams.get("error")?.trim();

  if (error) {
    return NextResponse.redirect(buildPublicAppUrl(`/auth/error?code=${encodeURIComponent(error)}`, appUrl));
  }
  if (!code || !state) {
    return NextResponse.redirect(buildPublicAppUrl("/auth/error?code=slack.oauth.exchange_failed", appUrl));
  }

  let redirectAfter: string | undefined;
  try {
    const verifiedState = await verifySlackOAuthCallbackState(state);
    redirectAfter = verifiedState.redirectAfter;
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.id !== verifiedState.userId) {
      throw new Error("slack.oauth.unauthorized");
    }
    const membership = readWorkspaceMembershipSync(verifiedState.workspaceId, currentUser.id);
    if (!membership || membership.status !== "active" || !hasWorkspaceRole(membership.role, "admin")) {
      throw new Error("slack.oauth.workspace_forbidden");
    }
    const integration = await installSlackIntegrationFromOAuthCode({
      workspaceId: verifiedState.workspaceId,
      userId: currentUser.id,
      code,
      displayName: verifiedState.displayName,
      transportMode: verifiedState.transportMode,
    });
    const redirectPath = appendStatusParam(
      redirectAfter || "/settings/integrations",
      "slackOAuth",
      "connected",
      {
        slackIntegrationId: integration.id,
      },
    );
    return NextResponse.redirect(buildPublicAppUrl(redirectPath, appUrl));
  } catch (callbackError) {
    const codeValue = callbackError instanceof Error ? callbackError.message : "slack.oauth.exchange_failed";
    const target = redirectAfter
      ? appendStatusParam(redirectAfter, "slackOAuthError", codeValue)
      : `/auth/error?code=${encodeURIComponent(codeValue)}`;
    return NextResponse.redirect(buildPublicAppUrl(target, appUrl));
  }
}

function appendStatusParam(
  path: string,
  key: string,
  value: string,
  extraParams?: Record<string, string>,
): string {
  const url = new URL(path, "http://agent-space.local");
  url.searchParams.set(key, value);
  for (const [paramKey, paramValue] of Object.entries(extraParams ?? {})) {
    url.searchParams.set(paramKey, paramValue);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function readSlackOAuthRedirectBaseUrl(fallbackAppUrl: string): string {
  try {
    return readSlackOAuthConfig().appUrl;
  } catch {
    return fallbackAppUrl;
  }
}
