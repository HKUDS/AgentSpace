import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWorkspaceSync,
  createDaemonApiTokenSync,
  createUserSync,
  createWorkspaceMembershipSync,
  enqueueNativeTaskSync,
  listRuntimeGrantsSync,
  listDaemonSnapshotsSync,
  listQueuedTasksSync,
  readQueuedTaskSync,
  listRuntimeInstalledAppsSync,
  listTaskExecutionEventsSync,
  readWorkspaceSync,
  registerDaemonRuntimesSync,
  createRuntimeAppOperationSync,
  completeRuntimeAppOperationSync,
  createExternalIntegrationSync,
  listExternalDataOperationRunsSync,
  createExternalMessageMappingSync,
  upsertRuntimeAppCatalogItemsSync,
  upsertAgentGoogleWorkspaceDelegationSync,
  upsertGoogleOAuthCredentialSync,
  listPendingExternalMessageOutboxSync,
  upsertExternalChannelBindingSync,
  upsertExternalResourceBindingSync,
} from "@agent-space/db";
import { getDatabase } from "@agent-space/db/database";
import {
  bindEmployeeRuntimeSync,
  addChannelEmployeesSync,
  createEmployeeSync,
  createExternalGoogleSheetChannelDocumentSync,
  createWorkspaceSkillSync,
  FEISHU_LARK_CLI_RESULT_MANIFEST_KIND,
  FEISHU_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH,
  grantDocumentAgentAccessSync,
  initializeOrganizationSync,
  readWorkspaceStateSync,
  resetWorkspaceStateSync,
  sendChannelHumanMessageSync,
  sendContactMessageSync,
  setEmployeeSkillIdsSync,
  unbindEmployeeRuntimeSync,
  writeWorkspaceStateSync,
} from "@agent-space/services";
import { POST as registerPOST } from "./register/route";
import { POST as heartbeatPOST } from "./heartbeat/route";
import { GET as installScriptGET } from "./install-script/route";
import { GET as packageGET } from "./package/route";
import { POST as claimPOST } from "./runtimes/[runtimeId]/tasks/claim/route";
import { POST as completePOST } from "./tasks/[taskId]/complete/route";
import { POST as failPOST } from "./tasks/[taskId]/fail/route";
import { GET as inputBundleGET } from "./tasks/[taskId]/input-bundle/route";
import { POST as outputBundlePOST } from "./tasks/[taskId]/output-bundle/route";
import { POST as runtimeApprovalPOST } from "./tasks/[taskId]/runtime-approvals/route";
import { GET as runtimeApprovalGET } from "./tasks/[taskId]/runtime-approvals/[approvalId]/route";
import { POST as startPOST } from "./tasks/[taskId]/start/route";
import { POST as appOperationClaimPOST } from "./runtimes/[runtimeId]/apps/operations/claim/route";
import { POST as appOperationStartPOST } from "./runtime-app-operations/[operationId]/start/route";
import { POST as appOperationCompletePOST } from "./runtime-app-operations/[operationId]/complete/route";
import { POST as appOperationFailPOST } from "./runtime-app-operations/[operationId]/fail/route";

const {
  mockGetGoogleWorkspaceAccessTokenForAgent,
  mockSyncGoogleSheetDocumentDrivePermissions,
} = vi.hoisted(() => ({
  mockGetGoogleWorkspaceAccessTokenForAgent: vi.fn(),
  mockSyncGoogleSheetDocumentDrivePermissions: vi.fn(),
}));

vi.mock("@/features/integrations/google-workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/integrations/google-workspace")>();
  return {
    ...actual,
    getGoogleWorkspaceAccessTokenForAgent: mockGetGoogleWorkspaceAccessTokenForAgent,
  };
});

vi.mock("@/features/integrations/google-drive-permissions", () => ({
  syncGoogleSheetDocumentDrivePermissions: mockSyncGoogleSheetDocumentDrivePermissions,
}));

const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-daemon-routes-"));
const originalCwd = process.cwd();
const repositoryRoot = existsSync(join(originalCwd, "Target.md")) ? originalCwd : join(originalCwd, "..", "..");

beforeAll(() => {
  writeFileSync(join(tempRoot, "Target.md"), "# test\n");
  mkdirSync(join(tempRoot, "data"), { recursive: true });
  const packagesLink = join(tempRoot, "packages");
  if (!existsSync(packagesLink)) {
    symlinkSync(join(repositoryRoot, "packages"), packagesLink, "dir");
  }
  process.chdir(tempRoot);
});

beforeEach(() => {
  resetWorkspaceStateSync();
  initializeOrganizationSync({
    organizationName: "Northstar Labs",
    ownerName: "Tianyu",
    ownerRole: "Founder",
    firstChannelName: "tour visit",
  });

  const db = getDatabase();
  db.exec("DELETE FROM task_message");
  db.exec("DELETE FROM task_execution_event");
  db.exec("DELETE FROM token_usage");
  db.exec("DELETE FROM agent_router_event");
  db.exec("DELETE FROM agent_router_context_snapshot");
  db.exec("DELETE FROM agent_task_attempt");
  db.exec("DELETE FROM agent_router_provider_session");
  db.exec("DELETE FROM agent_task_queue");
  db.exec("DELETE FROM agent_router_session");
  db.exec("DELETE FROM runtime_app_skill_binding");
  db.exec("DELETE FROM runtime_app_operation");
  db.exec("DELETE FROM runtime_installed_app");
  db.exec("DELETE FROM runtime_app_catalog_item");
  db.exec("DELETE FROM employee_runtime_binding");
  db.exec("DELETE FROM workspace_runtime_grant");
  db.exec("DELETE FROM agent_runtime");
  db.exec("DELETE FROM daemon_connection");
  db.exec("DELETE FROM daemon_api_token");
  db.exec("DELETE FROM agent_google_workspace_delegation");
  db.exec("DELETE FROM google_oauth_credential");
  db.exec("DELETE FROM external_message_outbox");
  db.exec("DELETE FROM external_message_mapping");
  db.exec("DELETE FROM external_thread_binding");
  db.exec("DELETE FROM external_data_operation_run");
  db.exec("DELETE FROM external_resource_binding");
  db.exec("DELETE FROM external_channel_binding");
  db.exec("DELETE FROM external_user_binding");
  db.exec("DELETE FROM external_integration_event");
  db.exec("DELETE FROM external_integration");
  vi.unstubAllEnvs();
  mockGetGoogleWorkspaceAccessTokenForAgent.mockReset();
  mockGetGoogleWorkspaceAccessTokenForAgent.mockResolvedValue({
    accessToken: "access-token",
    credential: { expiresAt: "2026-05-20T12:00:00.000Z" },
    delegation: { googleEmail: "owner@example.com" },
    delegatedUserDisplayName: "Owner",
  });
  mockSyncGoogleSheetDocumentDrivePermissions.mockReset();
  mockSyncGoogleSheetDocumentDrivePermissions.mockResolvedValue({
    status: "succeeded",
    sharedCount: 0,
    updatedCount: 0,
    revokedCount: 0,
    skippedCount: 1,
    failedCount: 0,
    message: "No Drive permission changes needed.",
  });
});

function daemonHeaders(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

describe("daemon API routes", () => {
  it("serves a hosted install script with baked server defaults", async () => {
    const response = await installScriptGET(
      new Request("http://localhost/api/daemon/install-script"),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/x-shellscript");
    expect(body).toContain("DEFAULT_SERVER_URL='http://localhost'");
    expect(body).toContain("DEFAULT_PACKAGE_URL='http://localhost/api/daemon/package'");
  });

  it("rejects package downloads without a daemon bearer token", async () => {
    const response = await packageGET(
      new Request("http://localhost/api/daemon/package"),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toMatch(/missing daemon bearer token/i);
  });

  it("serves the standalone daemon tarball to authenticated daemon tokens", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });
    const packagePath = join(tempRoot, "agent-space-daemon-test.tgz");
    writeFileSync(packagePath, Buffer.alloc(2048, 1));
    process.env.AGENT_SPACE_DAEMON_PACKAGE_PATH = packagePath;

    try {
      const response = await packageGET(
        new Request("http://localhost/api/daemon/package", {
          headers: {
            authorization: `Bearer ${daemonToken.token}`,
          },
        }),
      );
      const body = Buffer.from(await response.arrayBuffer());

      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toContain("agent-space-daemon-test.tgz");
      expect(body.length).toBeGreaterThan(1024);
    } finally {
      delete process.env.AGENT_SPACE_DAEMON_PACKAGE_PATH;
      rmSync(packagePath, { force: true });
    }
  });

  it("rejects register requests without a daemon bearer token", async () => {
    const response = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          daemonKey: "no-auth",
          deviceName: "No Auth",
          runtimes: [{ provider: "codex", name: "Remote Codex" }],
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toMatch(/missing daemon bearer token/i);
  });

  it("rejects register requests with an invalid daemon token", async () => {
    const response = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders("adt_invalid"),
        body: JSON.stringify({
          daemonKey: "bad-auth",
          deviceName: "Bad Auth",
          runtimes: [{ provider: "codex", name: "Remote Codex" }],
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toMatch(/invalid daemon token/i);
  });

  it("rejects register requests with unsupported provider ids", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });

    const response = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "bad-provider",
          deviceName: "Bad Provider",
          runtimes: [{ provider: "future-bot", name: "Future Bot" }],
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/unsupported provider/i);
  });

  it("registers and heartbeats a remote daemon with daemon token auth", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });

    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-1",
          deviceName: "Build Box 1",
          runtimes: [
            {
              provider: "codex",
              name: "Remote Codex",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();

    expect(registerResponse.status).toBe(200);
    expect(registerPayload.daemon.daemonKey).toBe("build-box-1");
    expect(registerPayload.runtimes).toHaveLength(1);

    const heartbeatResponse = await heartbeatPOST(
      new Request("http://localhost/api/daemon/heartbeat", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-1",
          metadata: {
            mode: "remote",
            googleWorkspaceReadiness: {
              executor: "gws",
              gws: { available: true, version: "gws 0.22.5" },
            },
          },
          runtimes: [{
            id: registerPayload.runtimes[0].id,
            provider: "codex",
            metadata: {
              providerHealth: {
                status: "healthy",
                reason: "Provider preflight passed.",
              },
            },
          }],
        }),
      }),
    );
    const heartbeatPayload = await heartbeatResponse.json();

    expect(heartbeatResponse.status).toBe(200);
    expect(heartbeatPayload.daemon.status).toBe("online");
    expect(heartbeatPayload.daemon.lastHeartbeatAt).toBeTruthy();
    expect(JSON.parse(listDaemonSnapshotsSync()[0]!.daemon.metadataJson).googleWorkspaceReadiness.gws.version).toBe("gws 0.22.5");
    expect(heartbeatPayload.runtimes[0].metadata.providerHealth.status).toBe("healthy");

    const repeatedHeartbeatResponse = await heartbeatPOST(
      new Request("http://localhost/api/daemon/heartbeat", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-1",
        }),
      }),
    );
    const repeatedHeartbeatPayload = await repeatedHeartbeatResponse.json();

    expect(repeatedHeartbeatResponse.status).toBe(200);
    expect(repeatedHeartbeatPayload.daemon.status).toBe("online");
  });

  it("grants runtimes to the workspace member who created the daemon token", async () => {
    const member = createUserSync({
      primaryEmail: "member-runtime@example.com",
      displayName: "Runtime Member",
    });
    createWorkspaceMembershipSync({
      workspaceId: "default",
      userId: member.id,
      role: "member",
    });
    const daemonToken = createDaemonApiTokenSync({
      label: "member-daemon",
      createdBy: member.id,
    });

    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "member-box-1",
          deviceName: "Member Box 1",
          runtimes: [
            {
              provider: "codex",
              name: "Member Codex",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();

    expect(registerResponse.status).toBe(200);
    expect(listRuntimeGrantsSync("default")).toMatchObject([
      {
        runtimeId: registerPayload.runtimes[0].id,
        userId: member.id,
        grantedByUserId: member.id,
        status: "active",
      },
    ]);
  });

  it("registers mixed expanded providers without filtering their ids", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });

    const response = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-2",
          deviceName: "Build Box 2",
          runtimes: [
            {
              provider: "opencode",
              name: "OpenCode Runtime",
              version: "0.1.0",
            },
            {
              provider: "antigravity",
              name: "Antigravity Runtime",
              version: "0.9.0",
            },
            {
              provider: "openclaw",
              name: "OpenClaw Runtime",
              version: "0.2.0",
            },
            {
              provider: "nanobot",
              name: "NanoBot Runtime",
              version: "0.3.0",
            },
            {
              provider: "hermes",
              name: "Hermes Runtime",
              version: "0.4.0",
            },
          ],
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.runtimes).toHaveLength(5);
    expect(
      payload.runtimes
        .map((runtime: { provider: string }) => runtime.provider)
        .sort(),
    ).toEqual(["antigravity", "hermes", "nanobot", "opencode", "openclaw"].sort());
  });

  it("claims a queued task and builds an input bundle with prompt and attachment files", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });

    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-2",
          deviceName: "Build Box 2",
          runtimes: [
            {
              provider: "codex",
              name: "Remote Codex",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();
    const runtimeId = registerPayload.runtimes[0].id as string;

    createEmployeeSync({
      name: "Atlas",
      role: "Planner",
    });
    addChannelEmployeesSync({ channelName: "tour visit", employeeNames: ["Atlas"] });
    bindEmployeeRuntimeSync("Atlas", runtimeId);

    const attachmentsDir = join(tempRoot, "data", "workspaces", "default", "attachments");
    mkdirSync(attachmentsDir, { recursive: true });
    const storedPath = join(attachmentsDir, "att-manual-note.txt");
    writeFileSync(storedPath, "input attachment", "utf8");

    const queued = enqueueNativeTaskSync({
      assignee: "Atlas",
      title: "Draft itinerary reply",
      priority: "medium",
      triggerType: "manual",
      metadata: {
        title: "Draft itinerary reply",
        attachments: [
          {
            fileName: "manual-note.txt",
            storedPath,
            mediaType: "text/plain",
            kind: "file",
          },
        ],
      },
    });

    expect(queued?.id).toBeTruthy();

    const claimResponse = await claimPOST(
      new Request(`http://localhost/api/daemon/runtimes/${runtimeId}/tasks/claim`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
      }),
      { params: Promise.resolve({ runtimeId }) },
    );
    const claimPayload = await claimResponse.json();

    expect(claimResponse.status).toBe(200);
    expect(claimPayload.task.id).toBe(queued?.id);

    const bundleResponse = await inputBundleGET(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/input-bundle`, {
        headers: daemonHeaders(daemonToken.token),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );
    const bundlePayload = await bundleResponse.json();

    expect(bundleResponse.status).toBe(200);
    expect(bundlePayload.taskId).toBe(queued?.id);
    expect(bundlePayload.prompt).toContain("任务标题: Draft itinerary reply");
    expect(bundlePayload.files.some((file: { path: string }) => file.path === "prompt.txt")).toBe(true);
    expect(bundlePayload.files.some((file: { path: string }) => file.path === "task.json")).toBe(true);
    expect(bundlePayload.files.some((file: { path: string }) => file.path === "attachments/01-manual-note.txt")).toBe(true);
  });

  it("includes only installed runtime apps and available runtime app skills in task input bundles", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });
    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-runtime-context",
          deviceName: "Build Box Runtime Context",
          runtimes: [
            {
              provider: "codex",
              name: "Runtime With App",
              version: "test",
            },
            {
              provider: "claude",
              name: "Runtime Without App",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();
    const runtimeWithAppId = registerPayload.runtimes.find((runtime: { provider: string }) => runtime.provider === "codex").id as string;
    const runtimeWithoutAppId = registerPayload.runtimes.find((runtime: { provider: string }) => runtime.provider === "claude").id as string;

    upsertRuntimeAppCatalogItemsSync([{
      source: "clihub_harness",
      name: "mermaid",
      displayName: "Mermaid",
      description: "Render diagrams",
      entryPoint: "mmdc",
      installStrategy: "cli_hub",
      skillMd: "skills/cli-anything-mermaid/SKILL.md",
      registryJson: "{}",
    }]);
    const operation = createRuntimeAppOperationSync({
      runtimeId: runtimeWithAppId,
      appSource: "clihub_harness",
      appName: "mermaid",
      operation: "install",
      commandPlanJson: JSON.stringify({
        app: { source: "clihub_harness", name: "mermaid", version: "", entryPoint: "mmdc" },
        strategy: "cli_hub",
        commands: [],
        verifyCommands: [],
        risk: "low",
        requiresApproval: true,
        notes: [],
      }),
    });
    completeRuntimeAppOperationSync({
      operationId: operation.id,
      installedApp: {
        displayName: "Mermaid",
        version: "1.0.0",
        entryPoint: "mmdc",
        installStrategy: "cli_hub",
      },
    });
    const skill = createWorkspaceSkillSync({
      name: "clihub-mermaid",
      description: "Mermaid runtime app usage",
      content: "Use `mmdc` only when the bound runtime exposes Mermaid.",
      sourceType: "clihub_runtime_app",
      configJson: JSON.stringify({
        runtimeApp: {
          source: "clihub_harness",
          name: "mermaid",
        },
      }),
    });

    createEmployeeSync({ name: "Atlas", role: "Planner" });
    setEmployeeSkillIdsSync("Atlas", [skill.id]);
    bindEmployeeRuntimeSync("Atlas", runtimeWithAppId);
    const availableTask = enqueueNativeTaskSync({
      assignee: "Atlas",
      title: "Render a diagram",
      priority: "medium",
      triggerType: "manual",
      metadata: { title: "Render a diagram" },
    });
    expect(availableTask?.id).toBeTruthy();
    const availableBundleResponse = await inputBundleGET(
      new Request(`http://localhost/api/daemon/tasks/${availableTask?.id}/input-bundle`, {
        headers: daemonHeaders(daemonToken.token),
      }),
      { params: Promise.resolve({ taskId: availableTask!.id }) },
    );
    const availableBundle = await availableBundleResponse.json();

    expect(availableBundleResponse.status).toBe(200);
    expect(availableBundle.metadata.runtimeApps.status).toBe("available");
    expect(availableBundle.metadata.runtimeApps.apps[0].name).toBe("mermaid");
    expect(availableBundle.metadata.runtimeToolCapabilities.status).toBe("available");
    expect(availableBundle.metadata.runtimeToolCapabilities.capabilities[0]).toMatchObject({
      id: "clihub:clihub_harness:mermaid",
      command: "mmdc",
      source: "cli-hub",
    });
    expect(availableBundle.prompt).toContain("当前绑定 runtime 已安装并启用的 CLI-Hub runtime apps: 1 个。");
    expect(availableBundle.prompt).toContain("SKILL.md: skills/cli-anything-mermaid/SKILL.md");
    expect(availableBundle.files.some((file: { path: string }) => file.path.includes("clihub-mermaid"))).toBe(true);

    unbindEmployeeRuntimeSync("Atlas");
    bindEmployeeRuntimeSync("Atlas", runtimeWithoutAppId);
    const unavailableTask = enqueueNativeTaskSync({
      assignee: "Atlas",
      title: "Try diagram elsewhere",
      priority: "medium",
      triggerType: "manual",
      metadata: { title: "Try diagram elsewhere" },
    });
    expect(unavailableTask?.id).toBeTruthy();
    const unavailableBundleResponse = await inputBundleGET(
      new Request(`http://localhost/api/daemon/tasks/${unavailableTask?.id}/input-bundle`, {
        headers: daemonHeaders(daemonToken.token),
      }),
      { params: Promise.resolve({ taskId: unavailableTask!.id }) },
    );
    const unavailableBundle = await unavailableBundleResponse.json();

    expect(unavailableBundleResponse.status).toBe(200);
    expect(unavailableBundle.metadata.runtimeApps.status).toBe("none");
    expect(unavailableBundle.metadata.runtimeToolCapabilities.status).toBe("available");
    expect(unavailableBundle.metadata.runtimeToolCapabilities.capabilities).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "clihub:clihub_harness:mermaid" }),
      ]),
    );
    expect(unavailableBundle.prompt).toContain("当前绑定 runtime 未报告已安装的 CLI-Hub runtime app");
    expect(unavailableBundle.files.some((file: { path: string }) => file.path.includes("clihub-mermaid"))).toBe(false);
  });

  it("injects Google Workspace create-sheet capability without existing external documents", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });
    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-gws-create",
          deviceName: "Build Box GWS Create",
          runtimes: [
            {
              provider: "codex",
              name: "Remote Codex",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();
    const runtimeId = registerPayload.runtimes[0].id as string;
    createEmployeeSync({ name: "Atlas", role: "Planner" });
    addChannelEmployeesSync({ channelName: "tour visit", employeeNames: ["Atlas"] });
    bindEmployeeRuntimeSync("Atlas", runtimeId);
    const user = createUserSync({
      primaryEmail: "owner@example.com",
      displayName: "Owner",
    });
    const credential = upsertGoogleOAuthCredentialSync({
      workspaceId: "default",
      userId: user.id,
      googleEmail: "owner@example.com",
      scopes: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets",
      accessTokenEncrypted: "access-token",
      refreshTokenEncrypted: "refresh-token",
    });
    upsertAgentGoogleWorkspaceDelegationSync({
      workspaceId: "default",
      employeeName: "Atlas",
      userId: user.id,
      googleOAuthCredentialId: credential.id,
      scopes: credential.scopes,
      googleEmail: credential.googleEmail,
      grantedByUserId: user.id,
    });
    const queued = enqueueNativeTaskSync({
      assignee: "Atlas",
      title: "Create forecast sheet",
      priority: "medium",
      triggerType: "manual",
      metadata: {
        title: "Create forecast sheet",
        channel: "tour visit",
        channelName: "tour visit",
      },
    });

    const response = await inputBundleGET(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/input-bundle`, {
        headers: daemonHeaders(daemonToken.token),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );
    const bundle = await response.json();

    expect(response.status).toBe(200);
    expect(bundle.metadata.googleWorkspace.status).toBe("available");
    expect(bundle.metadata.googleWorkspace.capabilities).toContain("create_sheet");
    expect(bundle.metadata.googleWorkspace.env.GOOGLE_WORKSPACE_CLI_TOKEN).toBe("access-token");
    const patterns = bundle.metadata.runtimeToolCapabilities.capabilities.flatMap(
      (capability: { allowedShellPatterns: string[] }) => capability.allowedShellPatterns,
    );
    expect(patterns).toContain("gws drive files create *");
    expect(patterns).toContain("agent-space output external-document create-google-sheet *");
    expect(bundle.prompt).toContain("external-document create-google-sheet");
  });

  it("claims and completes runtime app operations through daemon routes", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });

    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-apps",
          deviceName: "Build Box Apps",
          runtimes: [
            {
              provider: "codex",
              name: "Remote Codex",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();
    const runtimeId = registerPayload.runtimes[0].id as string;

    upsertRuntimeAppCatalogItemsSync([{
      source: "clihub_harness",
      name: "mermaid",
      displayName: "Mermaid",
      entryPoint: "mmdc",
      installStrategy: "cli_hub",
      registryJson: "{}",
    }]);
    const operation = createRuntimeAppOperationSync({
      runtimeId,
      appSource: "clihub_harness",
      appName: "mermaid",
      operation: "install",
      commandPlanJson: JSON.stringify({
        app: { source: "clihub_harness", name: "mermaid", version: "", entryPoint: "mmdc" },
        strategy: "cli_hub",
        commands: [{ executable: "cli-hub", args: ["install", "mermaid"] }],
        verifyCommands: [],
        risk: "low",
        requiresApproval: true,
        notes: [],
      }),
    });

    const claimResponse = await appOperationClaimPOST(
      new Request(`http://localhost/api/daemon/runtimes/${runtimeId}/apps/operations/claim`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
      }),
      { params: Promise.resolve({ runtimeId }) },
    );
    const claimPayload = await claimResponse.json();

    expect(claimResponse.status).toBe(200);
    expect(claimPayload.operation.id).toBe(operation.id);
    expect(claimPayload.operation.commandPlan.commands[0].executable).toBe("cli-hub");

    const startResponse = await appOperationStartPOST(
      new Request(`http://localhost/api/daemon/runtime-app-operations/${operation.id}/start`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
      }),
      { params: Promise.resolve({ operationId: operation.id }) },
    );
    expect(startResponse.status).toBe(200);

    const completeResponse = await appOperationCompletePOST(
      new Request(`http://localhost/api/daemon/runtime-app-operations/${operation.id}/complete`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          safeStdoutTail: "installed",
          installedApp: {
            displayName: "Mermaid",
            version: "1.0.0",
            entryPoint: "mmdc",
            installStrategy: "cli_hub",
          },
        }),
      }),
      { params: Promise.resolve({ operationId: operation.id }) },
    );
    const completePayload = await completeResponse.json();

    expect(completeResponse.status).toBe(200);
    expect(completePayload.operation.status).toBe("succeeded");
    const installed = listRuntimeInstalledAppsSync({ runtimeId });
    expect(installed[0]?.status).toBe("installed");
    expect(installed[0]?.entryPoint).toBe("mmdc");
  });

  it("records failed runtime app operation details through daemon routes", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });
    const snapshot = registerDaemonRuntimesSync({
      daemonKey: "build-box-app-failure",
      deviceName: "Build Box Failure",
      runtimes: [{ provider: "codex", name: "Remote Codex", version: "test" }],
    });
    const runtimeId = snapshot.runtimes[0]!.id;
    const operation = createRuntimeAppOperationSync({
      runtimeId,
      appSource: "clihub_harness",
      appName: "missing",
      operation: "install",
      commandPlanJson: JSON.stringify({
        app: { source: "clihub_harness", name: "missing", version: "", entryPoint: "" },
        strategy: "cli_hub",
        commands: [],
        verifyCommands: [],
        risk: "low",
        requiresApproval: true,
        notes: [],
      }),
    });

    const failResponse = await appOperationFailPOST(
      new Request(`http://localhost/api/daemon/runtime-app-operations/${operation.id}/fail`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          errorCode: "runtime_app.command_failed",
          errorMessage: "cli-hub exited with code 1",
          safeStderrTail: "not found",
        }),
      }),
      { params: Promise.resolve({ operationId: operation.id }) },
    );
    const failPayload = await failResponse.json();

    expect(failResponse.status).toBe(200);
    expect(failPayload.operation.status).toBe("failed");
    expect(failPayload.operation.errorMessage).toBe("cli-hub exited with code 1");
  });

  it("does not hand the same queued task to concurrent claim requests", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });

    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-2b",
          deviceName: "Build Box 2B",
          runtimes: [
            {
              provider: "codex",
              name: "Remote Codex",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();
    const runtimeId = registerPayload.runtimes[0].id as string;

    createEmployeeSync({
      name: "Atlas",
      role: "Planner",
    });
    addChannelEmployeesSync({ channelName: "tour visit", employeeNames: ["Atlas"] });
    bindEmployeeRuntimeSync("Atlas", runtimeId);

    const queued = enqueueNativeTaskSync({
      assignee: "Atlas",
      title: "Concurrent claim task",
      priority: "medium",
      triggerType: "manual",
      metadata: {
        title: "Concurrent claim task",
      },
    });

    expect(queued?.id).toBeTruthy();

    const [firstResponse, secondResponse] = await Promise.all([
      claimPOST(
        new Request(`http://localhost/api/daemon/runtimes/${runtimeId}/tasks/claim`, {
          method: "POST",
          headers: daemonHeaders(daemonToken.token),
        }),
        { params: Promise.resolve({ runtimeId }) },
      ),
      claimPOST(
        new Request(`http://localhost/api/daemon/runtimes/${runtimeId}/tasks/claim`, {
          method: "POST",
          headers: daemonHeaders(daemonToken.token),
        }),
        { params: Promise.resolve({ runtimeId }) },
      ),
    ]);

    const [firstPayload, secondPayload] = await Promise.all([firstResponse.json(), secondResponse.json()]);
    const claimedIds = [firstPayload.task?.id, secondPayload.task?.id].filter(Boolean);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(claimedIds).toEqual([queued?.id]);
  });

  it("creates and reads runtime tool approvals for daemon tasks", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });

    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-approval",
          deviceName: "Build Box Approval",
          runtimes: [
            {
              provider: "claude",
              name: "Remote Claude",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();
    const runtimeId = registerPayload.runtimes[0].id as string;

    createEmployeeSync({
      name: "Atlas",
      role: "Planner",
    });
    addChannelEmployeesSync({ channelName: "tour visit", employeeNames: ["Atlas"] });
    bindEmployeeRuntimeSync("Atlas", runtimeId);

    const queued = enqueueNativeTaskSync({
      assignee: "Atlas",
      title: "Needs tool approval",
      priority: "medium",
      triggerType: "manual",
      metadata: {
        title: "Needs tool approval",
        channel: "tour visit",
      },
    });

    const createResponse = await runtimeApprovalPOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/runtime-approvals`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          provider: "claude",
          runtimeId,
          sessionId: "session-1",
          toolName: "Bash",
          toolInput: { command: "gws +read --help" },
          contentPreview: "Bash: gws +read --help",
        }),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );
    const createPayload = await createResponse.json();

    expect(createResponse.status).toBe(200);
    expect(createPayload.approval.status).toBe("pending");

    const readResponse = await runtimeApprovalGET(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/runtime-approvals/${createPayload.approval.approvalId}`, {
        headers: daemonHeaders(daemonToken.token),
      }),
      { params: Promise.resolve({ taskId: queued!.id, approvalId: createPayload.approval.approvalId }) },
    );
    const readPayload = await readResponse.json();

    expect(readResponse.status).toBe(200);
    expect(readPayload.approval.approvalId).toBe(createPayload.approval.approvalId);
    expect(readPayload.approval.status).toBe("pending");

    const workspaceState = readWorkspaceStateSync();
    const approval = workspaceState.approvals.find((item) => item.id === createPayload.approval.approvalId);
    expect(approval?.type).toBe("runtime_tool");
    expect(approval?.metadata?.toolName).toBe("Bash");
  });

  it("requires identity before Feishu external guests can approve runtime tools", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });

    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-feishu-guest-runtime-approval",
          deviceName: "Build Box Feishu Guest Runtime Approval",
          runtimes: [
            {
              provider: "claude",
              name: "Remote Claude",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();
    const runtimeId = registerPayload.runtimes[0].id as string;

    createEmployeeSync({
      name: "Atlas",
      role: "Planner",
    });
    addChannelEmployeesSync({ channelName: "tour visit", employeeNames: ["Atlas"] });
    bindEmployeeRuntimeSync("Atlas", runtimeId);
    const feishuIntegration = createExternalIntegrationSync({
      workspaceId: "default",
      provider: "feishu",
      displayName: "Atlas Feishu Bot",
      transportMode: "websocket_worker",
      agentId: "Atlas",
      appId: "cli_atlas_feishu_runtime_guest",
    });

    const queued = enqueueNativeTaskSync({
      assignee: "Atlas",
      title: "Feishu guest needs tool approval",
      priority: "medium",
      triggerType: "mention_chat",
      metadata: {
        title: "Feishu guest needs tool approval",
        channel: "tour visit",
        channelName: "tour visit",
        externalInput: {
          provider: "feishu",
          providerLabel: "Feishu/Lark",
          externalEventId: "evt-feishu-runtime-guest",
          externalMessageId: "om-feishu-runtime-guest",
          externalChatId: "oc-feishu-runtime-guest",
          trust: "untrusted_user_message",
          actor: {
            actorType: "external_guest",
            externalActorReference: "a".repeat(64),
            externalGuestPermissionProfile: "channel_context_only",
            externalGuestRequireIdentityFor: ["writes", "approvals", "runtime_sensitive_tools"],
            agentId: "Atlas",
            botBindingId: feishuIntegration.id,
          },
        },
      },
    });

    const createResponse = await runtimeApprovalPOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/runtime-approvals`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          provider: "claude",
          runtimeId,
          sessionId: "session-guest-1",
          toolName: "Bash",
          toolInput: { command: "gws +write launch-plan" },
          contentPreview: "Bash: gws +write launch-plan",
        }),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );
    const createPayload = await createResponse.json();

    expect(createResponse.status).toBe(403);
    expect(createPayload).toMatchObject({
      errorCode: "feishu.runtime_tool_external_guest_requires_identity",
      reasonCode: "feishu_external_guest_runtime_sensitive_tool_identity_required",
      requireIdentity: true,
      actorType: "external_guest",
      externalActorReference: "a".repeat(64),
      identityNoticeQueued: true,
    });
    expect(readWorkspaceStateSync().approvals.some((approval) => approval.type === "runtime_tool")).toBe(false);
    const outbox = listPendingExternalMessageOutboxSync({
      workspaceId: "default",
      integrationId: feishuIntegration.id,
    });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.targetExternalChatId).toBe("oc-feishu-runtime-guest");
    expect(outbox[0]?.targetExternalThreadId).toBe("om-feishu-runtime-guest");
    expect(outbox[0]?.payloadJson).toContain("identity required");
    expect(outbox[0]?.payloadJson).not.toContain("a".repeat(64));
  });

  it("completes a task with an output bundle and writes attachments back into workspace messages", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });

    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-3",
          deviceName: "Build Box 3",
          runtimes: [
            {
              provider: "codex",
              name: "Remote Codex",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();
    const runtimeId = registerPayload.runtimes[0].id as string;

    createEmployeeSync({
      name: "Atlas",
      role: "Planner",
    });
    addChannelEmployeesSync({ channelName: "tour visit", employeeNames: ["Atlas"] });
    bindEmployeeRuntimeSync("Atlas", runtimeId);

    const queued = enqueueNativeTaskSync({
      assignee: "Atlas",
      title: "Draft reply",
      priority: "medium",
      triggerType: "manual",
      metadata: {
        title: "Draft reply",
        channel: "tour visit",
      },
    });

    const outputBundleResponse = await outputBundlePOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/output-bundle`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          version: 1,
          format: "json-inline-v1",
          files: [
            {
              path: "runtime-output/agent-output.json",
              contentBase64: Buffer.from(
                JSON.stringify({
                  text: "图表已生成。",
                  attachments: [
                    {
                      path: "runtime-output/artifacts/chart.png",
                      name: "chart.png",
                      mediaType: "image/png",
                    },
                  ],
                }),
                "utf8",
              ).toString("base64"),
            },
            {
              path: "runtime-output/artifacts/chart.png",
              contentBase64: Buffer.from("fake-image-content", "utf8").toString("base64"),
            },
          ],
        }),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );

    expect(outputBundleResponse.status).toBe(202);
    expect(listTaskExecutionEventsSync({ taskId: queued!.id }).some((event) => event.type === "artifact_detected")).toBe(true);

    const completeResponse = await completePOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/complete`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          outputText: "图表已生成。",
        }),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );
    const completePayload = await completeResponse.json();

    expect(completeResponse.status).toBe(200);
    expect(completePayload.task.status).toBe("completed");

    const state = readWorkspaceStateSync();
    expect(state.messages[0]?.summary).toBe("图表已生成。");
    expect(state.messages[0]?.attachments?.[0]?.fileName).toBe("chart.png");
    const timelineTypes = listTaskExecutionEventsSync({ taskId: queued!.id }).map((event) => event.type);
    expect(timelineTypes).toContain("artifact_collected");
    expect(timelineTypes).toContain("completed");
  });

  it("processes external sheet result manifests into operation runs", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });

    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-sheets",
          deviceName: "Build Box Sheets",
          runtimes: [
            {
              provider: "codex",
              name: "Remote Codex",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();
    const runtimeId = registerPayload.runtimes[0].id as string;

    createEmployeeSync({
      name: "Atlas",
      role: "Planner",
    });
    bindEmployeeRuntimeSync("Atlas", runtimeId);
    const user = createUserSync({
      primaryEmail: "owner@example.com",
      displayName: "Owner",
    });
    const credential = upsertGoogleOAuthCredentialSync({
      workspaceId: "default",
      userId: user.id,
      googleEmail: "owner@example.com",
      scopes: "https://www.googleapis.com/auth/drive.file",
      accessTokenEncrypted: "access-token",
      refreshTokenEncrypted: "refresh-token",
    });
    upsertAgentGoogleWorkspaceDelegationSync({
      workspaceId: "default",
      employeeName: "Atlas",
      userId: user.id,
      googleOAuthCredentialId: credential.id,
      scopes: credential.scopes,
      googleEmail: "owner@example.com",
      grantedByUserId: user.id,
    });
    const { document } = createExternalGoogleSheetChannelDocumentSync({
      channelName: "tour visit",
      title: "Competitors",
      externalFileId: "google-file-1",
      externalUrl: "https://docs.google.com/spreadsheets/d/google-file-1/edit",
      createdBy: "Tianyu",
      createdByType: "human",
    });
    grantDocumentAgentAccessSync({
      workspaceId: "default",
      documentId: document.id,
      agentName: "Atlas",
      role: "viewer",
      grantedByUserId: user.id,
    });

    const queued = enqueueNativeTaskSync({
      assignee: "Atlas",
      title: "Append sheet rows",
      priority: "medium",
      triggerType: "manual",
      metadata: {
        title: "Append sheet rows",
        channel: "tour visit",
        channelName: "tour visit",
      },
    });

    const outputBundleResponse = await outputBundlePOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/output-bundle`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          version: 1,
          format: "json-inline-v1",
          files: [
            {
              path: "runtime-output/external-sheets-results.json",
              contentBase64: Buffer.from(
                JSON.stringify({
                  results: [
                    {
                      documentId: document.id,
                      operation: "read",
                      range: "Research!A1:B2",
                      resultPath: "runtime-output/artifacts/sheets/read-1.json",
                      summary: "Read 2 rows and 4 cells.",
                      requestSummary: "Read competitor rows.",
                      rowCount: 2,
                      cellCount: 4,
                      headers: ["Name", "Type"],
                      rowsPreview: [["Name", "Type"], ["Acme", "SaaS"]],
                      truncated: false,
                    },
                  ],
                }),
                "utf8",
              ).toString("base64"),
            },
            {
              path: "runtime-output/artifacts/sheets/read-1.json",
              contentBase64: Buffer.from(
                JSON.stringify({
                  range: "Research!A1:B2",
                  values: [["Name", "Type"], ["Acme", "SaaS"]],
                }),
                "utf8",
              ).toString("base64"),
            },
          ],
        }),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );

    expect(outputBundleResponse.status).toBe(202);

    const completeResponse = await completePOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/complete`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          outputText: "已提交表格操作。",
        }),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );

    expect(completeResponse.status).toBe(200);
    const state = readWorkspaceStateSync();
    const run = state.externalSheetOperationRuns.find((item) => item.channelDocumentId === document.id);
    expect(run?.status).toBe("succeeded");
    expect(run?.operationType).toBe("read");
    expect(run?.rangeA1).toBe("Research!A1:B2");
    expect(run?.responseSummary).toBe("Read 2 rows and 4 cells.");
    expect(run?.resultArtifactPath).toContain("external-sheet-results");
  });

  it("processes Feishu lark-cli result manifests into data operation evidence", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });

    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-feishu-lark-cli-result",
          deviceName: "Build Box Feishu Lark CLI Result",
          runtimes: [
            {
              provider: "codex",
              name: "Remote Codex",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();
    const runtimeId = registerPayload.runtimes[0].id as string;

    createEmployeeSync({
      name: "Atlas",
      role: "Planner",
    });
    addChannelEmployeesSync({ channelName: "tour visit", employeeNames: ["Atlas"] });
    bindEmployeeRuntimeSync("Atlas", runtimeId);

    const integration = createExternalIntegrationSync({
      provider: "feishu",
      displayName: "Feishu",
      transportMode: "http_webhook",
      appId: "cli_test",
      encryptedCredentialsJson: {},
      configJson: {},
      capabilitiesJson: {},
      scopesJson: [],
    });
    const resourceBinding = upsertExternalResourceBindingSync({
      integrationId: integration.id,
      providerResourceType: "doc",
      providerResourceToken: "doccnRoute123",
      providerResourceUrl: "https://example.feishu.cn/docx/doccnRoute123",
      agentSpaceResourceType: "channel_document",
      agentSpaceResourceId: "channel-document-feishu-doc",
      channelName: "tour visit",
      displayName: "Quarterly Roadmap",
      permissionsJson: {
        canWrite: false,
      },
      metadataJson: {},
    });

    const queued = enqueueNativeTaskSync({
      assignee: "Atlas",
      title: "Read Feishu doc",
      priority: "medium",
      triggerType: "manual",
      metadata: {
        title: "Read Feishu doc",
        channel: "tour visit",
        channelName: "tour visit",
      },
    });

    const outputBundleResponse = await outputBundlePOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/output-bundle`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          version: 1,
          format: "json-inline-v1",
          files: [
            {
              path: FEISHU_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH,
              contentBase64: Buffer.from(
                JSON.stringify({
                  kind: FEISHU_LARK_CLI_RESULT_MANIFEST_KIND,
                  schemaVersion: 1,
                  ok: true,
                  operationType: "docs.read_document",
                  providerResourceType: "doc",
                  providerResourceToken: "doccnRoute123",
                  responseSummary: "Fetched Quarterly Roadmap content.",
                  data: {
                    documentId: "doccnRoute123",
                    blockCount: 8,
                  },
                }),
                "utf8",
              ).toString("base64"),
            },
          ],
        }),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );

    expect(outputBundleResponse.status).toBe(202);

    const completeResponse = await completePOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/complete`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          outputText: "已读取飞书文档。",
        }),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );
    const completePayload = await completeResponse.json();

    expect(completeResponse.status).toBe(200);
    expect(completePayload.task.status).toBe("completed");

    const runs = listExternalDataOperationRunsSync({
      workspaceId: "default",
      integrationId: integration.id,
      resourceBindingId: resourceBinding.id,
      limit: 5,
    });
    expect(runs).toHaveLength(1);
    const run = runs[0]!;
    expect(run).toMatchObject({
      status: "succeeded",
      operationType: "docs.read_document",
      providerResourceType: "doc",
      providerResourceToken: "doccnRoute123",
      actorType: "agent",
      actorId: "Atlas",
    });
    const resultJson = JSON.parse(run.resultJson) as {
      responseSummaryRedacted?: boolean;
      runtimeResultManifest?: {
        path?: string;
      };
    };
    expect(resultJson.responseSummaryRedacted).toBe(true);
    expect(resultJson.runtimeResultManifest?.path).toBe(FEISHU_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH);
    expect(JSON.stringify(resultJson)).not.toContain("Quarterly Roadmap");
    expect(JSON.stringify(resultJson)).not.toContain("doccnRoute123");

    const completedTask = readQueuedTaskSync(queued!.id);
    expect(completedTask?.resultJson).toBeTruthy();
    const taskResult = JSON.parse(completedTask!.resultJson!) as {
      feishuLarkCliDataOperationRunIds?: string[];
    };
    expect(taskResult.feishuLarkCliDataOperationRunIds).toEqual([run.id]);
  });

  it("processes agent-created Google Sheet manifests into channel documents", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });

    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-create-sheet",
          deviceName: "Build Box Create Sheet",
          runtimes: [
            {
              provider: "codex",
              name: "Remote Codex",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();
    const runtimeId = registerPayload.runtimes[0].id as string;

    createEmployeeSync({
      name: "Atlas",
      role: "Planner",
    });
    addChannelEmployeesSync({ channelName: "tour visit", employeeNames: ["Atlas"] });
    bindEmployeeRuntimeSync("Atlas", runtimeId);
    const user = createUserSync({
      primaryEmail: "owner@example.com",
      displayName: "Owner",
    });
    const credential = upsertGoogleOAuthCredentialSync({
      workspaceId: "default",
      userId: user.id,
      googleEmail: "owner@example.com",
      scopes: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets",
      accessTokenEncrypted: "access-token",
      refreshTokenEncrypted: "refresh-token",
    });
    upsertAgentGoogleWorkspaceDelegationSync({
      workspaceId: "default",
      employeeName: "Atlas",
      userId: user.id,
      googleOAuthCredentialId: credential.id,
      scopes: credential.scopes,
      googleEmail: credential.googleEmail,
      grantedByUserId: user.id,
    });

    const queued = enqueueNativeTaskSync({
      assignee: "Atlas",
      title: "Create sheet",
      priority: "medium",
      triggerType: "manual",
      metadata: {
        title: "Create sheet",
        channel: "tour visit",
        channelName: "tour visit",
      },
    });

    const outputBundleResponse = await outputBundlePOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/output-bundle`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          version: 1,
          format: "json-inline-v1",
          files: [
            {
              path: "runtime-output/external-documents.json",
              contentBase64: Buffer.from(
                JSON.stringify({
                  version: 1,
                  generatedBy: "agent-space-cli",
                  operations: [
                    {
                      operationType: "create_google_sheet",
                      targetChannel: "tour visit",
                      title: "Created Forecast",
                      summary: "Agent-created forecast sheet.",
                      externalFileId: "spreadsheet-created-123",
                      externalUrl: "https://docs.google.com/spreadsheets/d/spreadsheet-created-123/edit",
                      externalMimeType: "application/vnd.google-apps.spreadsheet",
                      resultPath: "runtime-output/artifacts/sheets/create-sheet.json",
                    },
                  ],
                }),
                "utf8",
              ).toString("base64"),
            },
            {
              path: "runtime-output/artifacts/sheets/create-sheet.json",
              contentBase64: Buffer.from(
                JSON.stringify({
                  id: "spreadsheet-created-123",
                  webViewLink: "https://docs.google.com/spreadsheets/d/spreadsheet-created-123/edit",
                  mimeType: "application/vnd.google-apps.spreadsheet",
                  modifiedTime: "2026-05-20T00:00:00.000Z",
                }),
                "utf8",
              ).toString("base64"),
            },
          ],
        }),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );
    expect(outputBundleResponse.status).toBe(202);

    const completeResponse = await completePOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/complete`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          outputText: "已创建表格。",
        }),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );

    expect(completeResponse.status).toBe(200);
    const state = readWorkspaceStateSync();
    const document = state.channelDocuments.find((item) => item.externalFileId === "spreadsheet-created-123");
    expect(document).toMatchObject({
      channelName: "tour visit",
      title: "Created Forecast",
      kind: "sheet",
      storageMode: "external",
      externalProvider: "google_workspace",
      externalMimeType: "application/vnd.google-apps.spreadsheet",
      externalSyncStatus: "ok",
      createdBy: "Atlas",
      lastEditorType: "agent",
    });
    const run = state.externalSheetOperationRuns.find((item) => item.channelDocumentId === document?.id && item.operationType === "create");
    expect(run).toMatchObject({
      status: "succeeded",
      actorType: "agent",
      actorId: "Atlas",
      delegatedGoogleEmail: "owner@example.com",
    });
    expect(run?.resultArtifactPath).toContain("external-sheet-results");
    expect(mockSyncGoogleSheetDocumentDrivePermissions).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "access-token",
        workspaceId: "default",
        documentId: document?.id,
        actorId: "Atlas",
        actorType: "agent",
      }),
    );
  });

  it("rejects output bundles that try to escape the staging directory", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });

    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-4",
          deviceName: "Build Box 4",
          runtimes: [
            {
              provider: "codex",
              name: "Remote Codex",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();
    const runtimeId = registerPayload.runtimes[0].id as string;

    createEmployeeSync({
      name: "Atlas",
      role: "Planner",
    });
    bindEmployeeRuntimeSync("Atlas", runtimeId);

    const queued = enqueueNativeTaskSync({
      assignee: "Atlas",
      title: "Bad bundle",
      priority: "medium",
      triggerType: "manual",
      metadata: {
        title: "Bad bundle",
      },
    });

    const response = await outputBundlePOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/output-bundle`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          version: 1,
          format: "json-inline-v1",
          files: [
            {
              path: "../escape.txt",
              contentBase64: Buffer.from("bad", "utf8").toString("base64"),
            },
          ],
        }),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/invalid output bundle path/i);
  });

  it("rejects output bundles outside runtime-output", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });

    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-runtime-output-only",
          deviceName: "Build Box Runtime Output Only",
          runtimes: [
            {
              provider: "codex",
              name: "Remote Codex",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();
    const runtimeId = registerPayload.runtimes[0].id as string;

    createEmployeeSync({
      name: "Atlas",
      role: "Planner",
    });
    bindEmployeeRuntimeSync("Atlas", runtimeId);

    const queued = enqueueNativeTaskSync({
      assignee: "Atlas",
      title: "Bad bundle prefix",
      priority: "medium",
      triggerType: "manual",
      metadata: {
        title: "Bad bundle prefix",
      },
    });

    const response = await outputBundlePOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/output-bundle`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          version: 1,
          format: "json-inline-v1",
          files: [
            {
              path: "artifacts/chart.png",
              contentBase64: Buffer.from("bad", "utf8").toString("base64"),
            },
          ],
        }),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/runtime-output/i);
  });

  it("rejects cross-workspace task reads for daemon tokens and records an audit entry", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "default-daemon",
      createdBy: "Tianyu",
    });

    if (!readWorkspaceSync("workspace-mars")) {
      createWorkspaceSync({
        id: "workspace-mars",
        slug: "workspace-mars",
        name: "Mars Workspace",
        createdBy: "Tianyu",
      });
    }
    resetWorkspaceStateSync("workspace-mars");
    const marsSnapshot = registerDaemonRuntimesSync({
      workspaceId: "workspace-mars",
      daemonKey: "mars-box-1",
      deviceName: "Mars Box 1",
      runtimes: [
        {
          provider: "codex",
          name: "Mars Codex",
          version: "test",
        },
      ],
    });
    const marsRuntimeId = marsSnapshot.runtimes[0]?.id as string;

    createEmployeeSync({
      name: "Nova",
      role: "Planner",
    }, "workspace-mars");
    bindEmployeeRuntimeSync("Nova", marsRuntimeId, "workspace-mars");

    const queued = enqueueNativeTaskSync({
      workspaceId: "workspace-mars",
      assignee: "Nova",
      title: "Mars only task",
      priority: "medium",
      triggerType: "manual",
      metadata: {
        title: "Mars only task",
      },
    });

    expect(queued?.id).toBeTruthy();

    const response = await inputBundleGET(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/input-bundle`, {
        headers: daemonHeaders(daemonToken.token),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Task does not belong to this workspace." });
    expect(readWorkspaceStateSync().ledger[0]).toMatchObject({
      code: "workspace.cross_workspace_access_denied",
      data: expect.objectContaining({
        actorType: "daemon_token",
        resourceType: "task",
        resourceId: queued!.id,
        requestedWorkspaceId: "workspace-mars",
      }),
    });
  });

  it("keeps task state stable when start and fail are called repeatedly", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });

    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-7",
          deviceName: "Build Box 7",
          runtimes: [
            {
              provider: "codex",
              name: "Remote Codex",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();
    const runtimeId = registerPayload.runtimes[0].id as string;

    createEmployeeSync({
      name: "Atlas",
      role: "Planner",
    });
    bindEmployeeRuntimeSync("Atlas", runtimeId);

    const queued = enqueueNativeTaskSync({
      assignee: "Atlas",
      title: "retry me",
      priority: "medium",
      triggerType: "manual",
      metadata: {
        title: "retry me",
        channel: "tour visit",
      },
    });
    expect(queued?.id).toBeTruthy();

    const firstStart = await startPOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/start`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );
    const secondStart = await startPOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/start`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );

    expect(firstStart.status).toBe(200);
    expect(secondStart.status).toBe(200);

    const firstFail = await failPOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/fail`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          errorText: "temporary failure",
        }),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );
    const secondFail = await failPOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/fail`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          errorText: "temporary failure",
        }),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );

    expect(firstFail.status).toBe(200);
    expect(secondFail.status).toBe(200);

    const queuedTask = listQueuedTasksSync().find((task) => task.id === queued?.id);
    expect(queuedTask?.status).toBe("failed");
  });

  it("does not post daemon start notices into direct-contact conversations", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });

    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-direct-start",
          deviceName: "Build Box Direct Start",
          runtimes: [
            {
              provider: "codex",
              name: "Remote Codex",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();
    const runtimeId = registerPayload.runtimes[0].id as string;

    createEmployeeSync({
      name: "Atlas",
      role: "Planner",
    });
    bindEmployeeRuntimeSync("Atlas", runtimeId);
    sendContactMessageSync("Atlas", "帮我整理一下大阪行程。");

    const queued = listQueuedTasksSync().find((task) => task.agentId === "Atlas" && task.triggerType === "channel_chat");
    expect(queued?.id).toBeTruthy();

    const beforeState = readWorkspaceStateSync();
    const directChannelName = beforeState.channels.find(
      (channel) => channel.kind === "direct" && channel.employeeNames.some((name) => name === "Atlas"),
    )?.name;
    expect(directChannelName).toBeTruthy();
    const beforeMessageCount = beforeState.messages.filter((message) => message.channel === directChannelName).length;

    const response = await startPOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/start`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );

    expect(response.status).toBe(200);
    const afterMessages = readWorkspaceStateSync().messages.filter((message) => message.channel === directChannelName);
    expect(afterMessages).toHaveLength(beforeMessageCount);
    expect(afterMessages.some((message) => message.summary.includes("开始执行"))).toBe(false);
    expect(listTaskExecutionEventsSync({ taskId: queued!.id }).some((event) => event.type === "workspace_prepared")).toBe(true);
  });

  it("completes a remote direct-channel task and replaces the pending channel reply", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });

    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-5",
          deviceName: "Build Box 5",
          runtimes: [
            {
              provider: "codex",
              name: "Remote Codex",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();
    const runtimeId = registerPayload.runtimes[0].id as string;

    createEmployeeSync({
      name: "Atlas",
      role: "Planner",
    });
    bindEmployeeRuntimeSync("Atlas", runtimeId);
    sendContactMessageSync("Atlas", "帮我整理一下大阪行程。");

    const queued = listQueuedTasksSync().find((task) => task.agentId === "Atlas" && task.triggerType === "channel_chat");
    expect(queued?.id).toBeTruthy();

    const completeResponse = await completePOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/complete`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          outputText: "我先给你一版大阪行程草案。",
        }),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );

    expect(completeResponse.status).toBe(200);
    const state = readWorkspaceStateSync();
    const directChannel = state.channels.find(
      (channel) => channel.kind === "direct" && channel.employeeNames.some((name) => name === "Atlas"),
    );
    expect(directChannel?.name).toBeTruthy();
    const channelMessages = state.messages.filter((message) => message.channel === directChannel?.name);
    expect(channelMessages.some((message) => message.role === "agent" && message.status === "pending")).toBe(false);
    expect(channelMessages[0]?.summary).toBe("我先给你一版大阪行程草案。");
  });

  it("labels remote direct-channel task failures as direct conversations", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });

    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-direct-fail",
          deviceName: "Build Box Direct Fail",
          runtimes: [
            {
              provider: "codex",
              name: "Remote Codex",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();
    const runtimeId = registerPayload.runtimes[0].id as string;

    createEmployeeSync({
      name: "Atlas",
      role: "Planner",
    });
    bindEmployeeRuntimeSync("Atlas", runtimeId);
    sendContactMessageSync("Atlas", "帮我整理一下大阪行程。");

    const queued = listQueuedTasksSync().find((task) => task.agentId === "Atlas" && task.triggerType === "channel_chat");
    expect(queued?.id).toBeTruthy();

    const failResponse = await failPOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/fail`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          errorText: "temporary failure",
        }),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );

    expect(failResponse.status).toBe(200);
    const state = readWorkspaceStateSync();
    const directChannel = state.channels.find(
      (channel) => channel.kind === "direct" && channel.employeeNames.some((name) => name === "Atlas"),
    );
    const channelMessages = state.messages.filter((message) => message.channel === directChannel?.name);
    expect(channelMessages[0]?.summary).toContain("在私聊");
    expect(channelMessages[0]?.summary).not.toContain("在群聊");
  });

  it("queues a Feishu outbox reply when a remote mention_chat task fails", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });

    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-feishu-fail",
          deviceName: "Build Box Feishu Fail",
          runtimes: [
            {
              provider: "codex",
              name: "Remote Codex",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();
    const runtimeId = registerPayload.runtimes[0].id as string;

    createEmployeeSync({
      name: "Atlas",
      role: "Planner",
    });
    bindEmployeeRuntimeSync("Atlas", runtimeId);
    addChannelEmployeesSync({ channelName: "tour visit", employeeNames: ["Atlas"] });
    sendChannelHumanMessageSync("tour visit", "Tianyu", "@Atlas 请补全大阪行程安排。");
    const sourceMessage = readWorkspaceStateSync().messages.find(
      (message) =>
        message.channel === "tour visit" &&
        message.role === "human" &&
        message.summary === "@Atlas 请补全大阪行程安排。",
    );
    expect(sourceMessage?.id).toBeTruthy();

    const integration = createExternalIntegrationSync({
      provider: "feishu",
      displayName: "Feishu",
      transportMode: "http_webhook",
      appId: "cli_test",
      encryptedCredentialsJson: {},
      configJson: {},
      capabilitiesJson: {},
      scopesJson: [],
    });
    const channelBinding = upsertExternalChannelBindingSync({
      integrationId: integration.id,
      channelName: "tour visit",
      externalChatId: "oc_tour",
      externalChatType: "group",
      externalChatName: "tour visit",
      status: "active",
      syncMode: "mirror",
    });
    createExternalMessageMappingSync({
      integrationId: integration.id,
      channelBindingId: channelBinding.id,
      direction: "inbound",
      externalMessageId: "om_source",
      externalThreadId: "om_root",
      externalSenderId: "ou_tianyu",
      agentSpaceMessageId: sourceMessage!.id,
      metadataJson: {},
    });

    const queued = listQueuedTasksSync().find((task) => task.agentId === "Atlas" && task.triggerType === "mention_chat");
    expect(queued?.id).toBeTruthy();

    const failResponse = await failPOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/fail`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          errorText: "temporary failure",
        }),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );

    expect(failResponse.status).toBe(200);
    const outbox = listPendingExternalMessageOutboxSync({
      integrationId: integration.id,
      limit: 10,
    });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.channelBindingId).toBe(channelBinding.id);
    expect(outbox[0]?.agentSpaceMessageId).toBeUndefined();
    expect(outbox[0]?.targetExternalChatId).toBe("oc_tour");
    expect(outbox[0]?.targetExternalThreadId).toBe("om_root");
    const outboundPayload = JSON.parse(outbox[0]!.payloadJson) as {
      reply_to_message_id?: string;
      content?: string;
    };
    expect(outboundPayload.reply_to_message_id).toBe("om_root");
    expect(JSON.parse(outboundPayload.content ?? "{}").text).toContain("temporary failure");
  });

  it("completes a remote mention_chat task and replaces the pending channel reply", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "remote-daemon",
      createdBy: "Tianyu",
    });

    const registerResponse = await registerPOST(
      new Request("http://localhost/api/daemon/register", {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          daemonKey: "build-box-6",
          deviceName: "Build Box 6",
          runtimes: [
            {
              provider: "codex",
              name: "Remote Codex",
              version: "test",
            },
          ],
        }),
      }),
    );
    const registerPayload = await registerResponse.json();
    const runtimeId = registerPayload.runtimes[0].id as string;

    createEmployeeSync({
      name: "Atlas",
      role: "Planner",
    });
    createEmployeeSync({
      name: "Nova",
      role: "Reviewer",
    });
    bindEmployeeRuntimeSync("Atlas", runtimeId);
    bindEmployeeRuntimeSync("Nova", runtimeId);
    const stateWithMembership = readWorkspaceStateSync();
    const atlas = stateWithMembership.activeEmployees.find((employee) => employee.name === "Atlas");
    if (atlas) {
      atlas.channels = ["tour visit"];
    }
    const nova = stateWithMembership.activeEmployees.find((employee) => employee.name === "Nova");
    if (nova) {
      nova.channels = ["tour visit"];
    }
    stateWithMembership.channels = stateWithMembership.channels.map((channel) =>
      channel.name === "tour visit"
        ? {
            ...channel,
            employeeNames: ["Atlas", "Nova"],
          }
        : channel,
    );
    writeWorkspaceStateSync(stateWithMembership);
    sendChannelHumanMessageSync("tour visit", "Tianyu", "@Atlas 请补全大阪行程安排。");
    const sourceMessage = readWorkspaceStateSync().messages.find(
      (message) =>
        message.channel === "tour visit" &&
        message.role === "human" &&
        message.summary === "@Atlas 请补全大阪行程安排。",
    );
    expect(sourceMessage?.id).toBeTruthy();

    const integration = createExternalIntegrationSync({
      provider: "feishu",
      displayName: "Feishu",
      transportMode: "http_webhook",
      appId: "cli_test",
      encryptedCredentialsJson: {},
      configJson: {},
      capabilitiesJson: {},
      scopesJson: [],
    });
    const channelBinding = upsertExternalChannelBindingSync({
      integrationId: integration.id,
      channelName: "tour visit",
      externalChatId: "oc_tour",
      externalChatType: "group",
      externalChatName: "tour visit",
      status: "active",
      syncMode: "mirror",
    });
    createExternalMessageMappingSync({
      integrationId: integration.id,
      channelBindingId: channelBinding.id,
      direction: "inbound",
      externalMessageId: "om_source",
      externalThreadId: "om_root",
      externalSenderId: "ou_tianyu",
      agentSpaceMessageId: sourceMessage!.id,
      metadataJson: {},
    });

    const queued = listQueuedTasksSync().find((task) => task.agentId === "Atlas" && task.triggerType === "mention_chat");
    expect(queued?.id).toBeTruthy();

    const completeResponse = await completePOST(
      new Request(`http://localhost/api/daemon/tasks/${queued?.id}/complete`, {
        method: "POST",
        headers: daemonHeaders(daemonToken.token),
        body: JSON.stringify({
          outputText: "@Nova 我已经补全了大阪段的安排，请你继续检查预算。",
        }),
      }),
      { params: Promise.resolve({ taskId: queued!.id }) },
    );

    expect(completeResponse.status).toBe(200);
    const messages = readWorkspaceStateSync().messages.filter((message) => message.channel === "tour visit");
    expect(messages.some((message) => message.speaker === "Atlas" && message.status === "pending")).toBe(false);
    expect(messages.some((message) => message.speaker === "Nova" && message.status === "pending")).toBe(true);
    const atlasReply = messages.find((message) => message.speaker === "Atlas" && message.status === "completed");
    expect(atlasReply?.summary).toBe("@Nova 我已经补全了大阪段的安排，请你继续检查预算。");
    expect(atlasReply?.mentions?.[0]).toMatchObject({ mentionType: "agent", token: "Nova" });
    const novaQueued = listQueuedTasksSync().find((task) => task.agentId === "Nova" && task.triggerType === "mention_chat");
    expect(novaQueued).toBeTruthy();
    const payload = JSON.parse(novaQueued!.inputJson) as {
      mentionSource?: string;
      initiatorAgentId?: string;
      sourceMessageId?: string;
      sourceTaskQueueId?: string;
      channelMessage?: string;
    };
    expect(payload.mentionSource).toBe("agent_output");
    expect(payload.initiatorAgentId).toBe("Atlas");
    expect(payload.sourceMessageId).toBe(atlasReply?.id);
    expect(payload.sourceTaskQueueId).toBe(queued?.id);
    expect(payload.channelMessage).toBe("@Nova 我已经补全了大阪段的安排，请你继续检查预算。");

    const outbox = listPendingExternalMessageOutboxSync({
      integrationId: integration.id,
      limit: 10,
    });
    expect(outbox).toHaveLength(2);
    for (const item of outbox) {
      expect(item.channelBindingId).toBe(channelBinding.id);
      expect(item.agentSpaceMessageId).toBe(atlasReply?.id);
      expect(item.targetExternalChatId).toBe("oc_tour");
      expect(item.targetExternalThreadId).toBe("om_root");
    }
    const outboundPayloads = outbox.map((item) => JSON.parse(item.payloadJson) as {
      receive_id_type?: string;
      receive_id?: string;
      reply_to_message_id?: string;
      msg_type?: string;
      content?: string;
    });
    const textPayload = outboundPayloads.find((payload) => payload.msg_type === "text");
    const cardPayload = outboundPayloads.find((payload) => payload.msg_type === "interactive");
    expect(textPayload).toBeTruthy();
    expect(cardPayload).toBeTruthy();
    for (const payloadItem of outboundPayloads) {
      expect(payloadItem.receive_id_type).toBe("chat_id");
      expect(payloadItem.receive_id).toBe("oc_tour");
      expect(payloadItem.reply_to_message_id).toBe("om_root");
    }
    expect(JSON.parse(textPayload?.content ?? "{}")).toMatchObject({
      text: "@Nova 我已经补全了大阪段的安排，请你继续检查预算。",
    });
    expect(cardPayload?.content).toContain("Atlas");
  });
});
