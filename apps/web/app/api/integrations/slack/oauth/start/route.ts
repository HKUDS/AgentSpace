import { NextResponse } from "next/server";
import { buildPublicAppUrl } from "@/features/auth/public-app-url";
import { getCurrentWorkspaceContext } from "@/features/auth/server-workspace";
import { assertWorkspaceRoleForContext } from "@/features/auth/workspace-permissions";
import { buildWorkspacePath } from "@/features/auth/workspace-paths";
import { createSlackOAuthAuthorizationUrl } from "@/features/integrations/slack/slack-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const workspaceContext = await getCurrentWorkspaceContext();
  if (!workspaceContext) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  const url = new URL(request.url);
  const redirectAfter = url.searchParams.get("redirectAfter")?.trim()
    || buildWorkspacePath(workspaceContext.currentWorkspace.slug, "/settings/integrations");
  const displayName = url.searchParams.get("name")?.trim() || undefined;
  const transportMode = url.searchParams.get("transport") === "websocket_worker"
    ? "websocket_worker"
    : "http_webhook";
  try {
    assertWorkspaceRoleForContext(workspaceContext, "admin", "slack.oauth.workspace_forbidden");
    const authorizationUrl = await createSlackOAuthAuthorizationUrl({
      workspaceId: workspaceContext.currentWorkspace.id,
      userId: workspaceContext.currentUser.id,
      displayName,
      transportMode,
      redirectAfter,
    });
    return NextResponse.redirect(authorizationUrl);
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : "slack.oauth.start_failed";
    return NextResponse.redirect(buildPublicAppUrl(
      appendStatusParam(redirectAfter, "slackOAuthError", errorCode),
      `${url.protocol}//${url.host}`,
    ));
  }
}

function appendStatusParam(path: string, key: string, value: string): string {
  const url = new URL(path, "http://agent-space.local");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}
