import {
  grantRuntimeUseToUserSync,
  readDaemonConnectionSync,
  readWorkspaceMembershipSync,
  registerDaemonRuntimesSync,
} from "@agent-space/db";
import { isDaemonProvider, type RegisterDaemonRequest, type RegisterDaemonResponse } from "@agent-space/domain";
import { tryRecordWorkspaceAuditEventSync } from "@agent-space/services";
import { requireDaemonAuth } from "../_lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const auth = requireDaemonAuth(request);
  if (auth instanceof Response) {
    return auth;
  }

  const body = (await request.json()) as Partial<RegisterDaemonRequest>;
  if (!body.daemonKey || !body.deviceName || !Array.isArray(body.runtimes) || body.runtimes.length === 0) {
    return Response.json({ error: "daemonKey, deviceName, and runtimes[] are required." }, { status: 400 });
  }
  if (body.runtimes.some((runtime) => !runtime?.provider || !isDaemonProvider(runtime.provider))) {
    return Response.json({ error: "runtimes[].provider contains an unsupported provider id." }, { status: 400 });
  }
  if (body.workspaceId && body.workspaceId !== auth.workspaceId) {
    tryRecordWorkspaceAuditEventSync({
      workspaceId: auth.workspaceId,
      title: "Cross-workspace daemon access denied",
      note:
        `Daemon register request declared workspace "${body.workspaceId}" while the daemon token `
        + `belongs to workspace "${auth.workspaceId}".`,
      code: "workspace.cross_workspace_access_denied",
      data: {
        actorType: "daemon_token",
        resourceType: "daemon_registration",
        requestedWorkspaceId: body.workspaceId,
      },
    });
    return Response.json({ error: "workspaceId does not match the daemon token." }, { status: 403 });
  }

  const daemonKey = body.daemonKey.trim();
  const existingDaemon = readDaemonConnectionSync(daemonKey);
  if (existingDaemon && existingDaemon.workspaceId !== auth.workspaceId) {
    return denyCrossWorkspaceRegistration({
      workspaceId: auth.workspaceId,
      daemonKey,
      targetWorkspaceId: existingDaemon.workspaceId,
    });
  }

  let snapshot: ReturnType<typeof registerDaemonRuntimesSync>;
  try {
    snapshot = registerDaemonRuntimesSync({
      daemonKey,
      deviceName: body.deviceName.trim(),
      workspaceId: auth.workspaceId,
      metadata: body.metadata,
      runtimes: body.runtimes.map((runtime) => ({
        provider: runtime.provider,
        name: runtime.name.trim(),
        version: runtime.version?.trim(),
        deviceInfo: runtime.deviceInfo?.trim(),
        metadata: runtime.metadata,
      })),
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "daemon.workspace_mismatch") {
      throw error;
    }
    return denyCrossWorkspaceRegistration({
      workspaceId: auth.workspaceId,
      daemonKey,
      targetWorkspaceId: readDaemonConnectionSync(daemonKey)?.workspaceId,
    });
  }
  grantRegisteredRuntimesToTokenCreator({
    workspaceId: auth.workspaceId,
    createdBy: auth.token.createdBy,
    runtimeIds: snapshot.runtimes.map((runtime) => runtime.id),
  });

  const response: RegisterDaemonResponse = {
    daemon: {
      daemonKey: snapshot.daemon.daemonKey,
      status: snapshot.daemon.status,
      workspaceId: snapshot.daemon.workspaceId,
    },
    runtimes: snapshot.runtimes.map((runtime) => ({
      id: runtime.id,
      provider: runtime.provider,
      name: runtime.name,
      status: runtime.status,
    })),
  };

  return Response.json(response);
}

function denyCrossWorkspaceRegistration(input: {
  workspaceId: string;
  daemonKey: string;
  targetWorkspaceId?: string;
}): Response {
  tryRecordWorkspaceAuditEventSync({
    workspaceId: input.workspaceId,
    title: "Cross-workspace daemon access denied",
    note:
      `Daemon token for workspace "${input.workspaceId}" was denied registration of daemon "${input.daemonKey}"`
      + (input.targetWorkspaceId ? ` in workspace "${input.targetWorkspaceId}".` : "."),
    code: "workspace.cross_workspace_access_denied",
    data: {
      actorType: "daemon_token",
      resourceType: "daemon_registration",
      resourceId: input.daemonKey,
      requestedWorkspaceId: input.targetWorkspaceId,
    },
  });
  return Response.json({ error: "Daemon does not belong to this workspace." }, { status: 403 });
}

function grantRegisteredRuntimesToTokenCreator(input: {
  workspaceId: string;
  createdBy: string;
  runtimeIds: string[];
}): void {
  const userId = input.createdBy.trim();
  const membership = userId ? readWorkspaceMembershipSync(input.workspaceId, userId) : null;
  if (membership?.role !== "member") {
    return;
  }

  for (const runtimeId of input.runtimeIds) {
    grantRuntimeUseToUserSync({
      workspaceId: input.workspaceId,
      runtimeId,
      userId,
      grantedByUserId: userId,
    });
  }
}
