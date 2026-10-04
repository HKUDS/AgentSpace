import { NextResponse } from "next/server";
import { getWorkspaceContextForIdentifier } from "@/features/auth/server-workspace";
import { getCurrentSession } from "@/features/auth/server-auth";
import {
  isWorkspaceModuleLoaderId,
  loadWorkspaceModuleDataWithMeta,
} from "@/features/dashboard/workspace-module-loaders";
import { SettingsSectionForbiddenError } from "@/features/settings/settings-page-loader";
import {
  isWorkspaceModuleId,
} from "@/features/dashboard/workspace-module-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceId: string; moduleId: string }> },
): Promise<NextResponse> {
  const { workspaceId: workspaceIdentifier, moduleId: rawModuleId } = await context.params;
  const workspaceContext = await getWorkspaceContextForIdentifier(workspaceIdentifier);
  if (!workspaceContext) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (
    workspaceContext.currentWorkspace.id !== workspaceIdentifier &&
    workspaceContext.currentWorkspace.slug !== workspaceIdentifier
  ) {
    return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  }
  if (!isWorkspaceModuleId(rawModuleId)) {
    return NextResponse.json({ error: "Unknown workspace module." }, { status: 404 });
  }
  if (!isWorkspaceModuleLoaderId(rawModuleId)) {
    return NextResponse.json({ error: "Workspace module loader is not available yet." }, { status: 501 });
  }
  if (workspaceContext.accessScope === "channel" && rawModuleId !== "im") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const requestUrl = new URL(request.url);
  let result;
  try {
    result = await loadWorkspaceModuleDataWithMeta(
      rawModuleId,
      workspaceContext.currentWorkspace.id,
      {
        id: workspaceContext.currentUser.id,
        displayName: workspaceContext.currentUser.displayName,
        email: workspaceContext.currentUser.email,
        role: workspaceContext.currentMembership.role,
        ...(rawModuleId === "settings" ? { sessionId: (await getCurrentSession())?.id } : {}),
      },
      {
        accessScope: workspaceContext.accessScope ?? "workspace",
        channelNames: workspaceContext.channelNames,
        query: requestUrl.searchParams,
        settingsPath: rawModuleId === "settings" ? [requestUrl.searchParams.get("section") ?? ""].filter(Boolean) : undefined,
      },
    );
  } catch (error) {
    if (error instanceof SettingsSectionForbiddenError) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    throw error;
  }

  return NextResponse.json({
    data: result.data,
    meta: {
      moduleId: rawModuleId,
      workspaceId: workspaceContext.currentWorkspace.id,
      workspaceSlug: workspaceContext.currentWorkspace.slug,
      durationMs: result.meta.durationMs,
      query: Object.fromEntries(requestUrl.searchParams.entries()),
    },
  });
}
