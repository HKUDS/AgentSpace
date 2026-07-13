import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDaemonApiTokenSync,
  enqueueNativeTaskSync,
  listDaemonSnapshotsSync,
  listTaskMessagesForTaskSync,
} from "@agent-space/db";
import { getDatabase } from "@agent-space/db/database";
import {
  bindEmployeeRuntimeSync,
  createEmployeeSync,
  initializeOrganizationSync,
  readWorkspaceStateSync,
  resetWorkspaceStateSync,
  sendChannelHumanMessageSync,
  sendContactMessageSync,
  writeWorkspaceStateSync,
} from "@agent-space/services";
import { HttpDaemonClient } from "agent-space-daemon/daemon-client";
import { POST as registerPOST } from "./register/route";
import { POST as heartbeatPOST } from "./heartbeat/route";
import { POST as deregisterPOST } from "./deregister/route";
import { POST as claimPOST } from "./runtimes/[runtimeId]/tasks/claim/route";
import { POST as startPOST } from "./tasks/[taskId]/start/route";
import { POST as messagesPOST } from "./tasks/[taskId]/messages/route";
import { POST as failPOST } from "./tasks/[taskId]/fail/route";
import { GET as inputBundleGET } from "./tasks/[taskId]/input-bundle/route";
import { POST as outputBundlePOST } from "./tasks/[taskId]/output-bundle/route";
import { POST as completePOST } from "./tasks/[taskId]/complete/route";

const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-remote-daemon-integration-"));
const repositoryRoot = resolve(process.cwd(), "../..");

beforeAll(() => {
  writeFileSync(join(tempRoot, "Target.md"), "# test\n");
  mkdirSync(join(tempRoot, "data"), { recursive: true });
  symlinkSync(join(repositoryRoot, "packages"), join(tempRoot, "packages"), "dir");
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
  db.exec("DELETE FROM employee_runtime_binding");
  db.exec("DELETE FROM agent_runtime");
  db.exec("DELETE FROM daemon_connection");
  db.exec("DELETE FROM daemon_api_token");
});

describe("remote daemon client integration", () => {
  it("preserves expanded provider ids across HTTP registration", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "integration-daemon",
      createdBy: "Tianyu",
    });
    const restoreFetch = installDaemonRouteFetch();
    const client = new HttpDaemonClient("http://daemon.test", daemonToken.token, {
      retryDelayMs: 0,
      maxRetryAttempts: 2,
    });

    try {
      const registered = await client.register({
        daemonKey: "integration-box-expanded",
        deviceName: "Integration Box",
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
      });

      assert.deepEqual(
        registered.runtimes.map((runtime) => runtime.provider).sort(),
        ["opencode", "antigravity", "openclaw", "nanobot", "hermes"].sort(),
      );
    } finally {
      restoreFetch();
    }
  });

  it("can complete a direct-channel task through the HTTP daemon API", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "integration-daemon",
      createdBy: "Tianyu",
    });
    const restoreFetch = installDaemonRouteFetch();
    const client = new HttpDaemonClient("http://daemon.test", daemonToken.token, {
      retryDelayMs: 0,
      maxRetryAttempts: 2,
    });

    try {
      const registered = await client.register({
        daemonKey: "integration-box",
        deviceName: "Integration Box",
        runtimes: [
          {
            provider: "codex",
            name: "Remote Codex",
            version: "test",
          },
        ],
      });
      const runtimeId = registered.runtimes[0]?.id;
      assert.ok(runtimeId);

      createEmployeeSync({
        name: "Atlas",
        role: "Planner",
      });
      bindEmployeeRuntimeSync("Atlas", runtimeId);
      sendContactMessageSync("Atlas", "帮我整理大阪行程。");

      await client.sendHeartbeat("integration-box");
      const claimed = await client.claimTask(runtimeId);
      assert.ok(claimed.task);

      await client.startTask(claimed.task.id);
      const inputBundle = await client.getInputBundle(claimed.task.id);
      assert.equal(inputBundle.taskId, claimed.task.id);
      assert.ok(inputBundle.files.some((file) => file.path === "prompt.txt"));
      assert.ok(inputBundle.files.some((file) => file.path === "task.json"));
      assert.ok(inputBundle.prompt.includes("当前共享会话"));
      assert.ok(inputBundle.prompt.includes("会话消息: 帮我整理大阪行程。"));
      assert.equal(inputBundle.prompt.includes("用户消息: 帮我整理大阪行程。"), false);

      await client.reportMessages(claimed.task.id, {
        messages: [
          {
            type: "thinking",
            content: "正在整理大阪行程。",
          },
        ],
      });

      await client.uploadOutputBundle(claimed.task.id, {
        version: 1,
        format: "json-inline-v1",
        files: [
          {
            path: "runtime-output/agent-output.json",
            contentBase64: Buffer.from(
              JSON.stringify({
                text: "我先给你一版大阪行程草案。",
                attachments: [
                  {
                    path: "runtime-output/artifacts/itinerary.txt",
                    name: "itinerary.txt",
                    mediaType: "text/plain",
                  },
                ],
              }),
              "utf8",
            ).toString("base64"),
          },
          {
            path: "runtime-output/artifacts/itinerary.txt",
            contentBase64: Buffer.from("day 1: Osaka", "utf8").toString("base64"),
          },
        ],
      });

      await client.completeTask(claimed.task.id, {
        outputText: "我先给你一版大阪行程草案。",
        sessionId: "remote-session-1",
      });

      const taskMessages = listTaskMessagesForTaskSync(claimed.task.id);
      expect(taskMessages.some((message) => message.type === "thinking")).toBe(true);

      const state = readWorkspaceStateSync();
      const directChannel = state.channels.find(
        (channel) => channel.kind === "direct" && channel.employeeNames.some((name) => name === "Atlas"),
      );
      expect(directChannel).toBeTruthy();
      const channelMessages = state.messages.filter((message) => message.channel === directChannel?.name);
      expect(channelMessages.some((message) => message.role === "agent" && message.status === "pending")).toBe(false);
      expect(channelMessages[0]?.summary).toBe("我先给你一版大阪行程草案。");
      expect(channelMessages[0]?.attachments?.[0]?.fileName).toBe("itinerary.txt");

      sendContactMessageSync("Atlas", "继续细化第二天安排。");
      const resumed = await client.claimTask(runtimeId);
      assert.ok(resumed.task);
      const resumedPayload = JSON.parse(resumed.task.inputJson) as { channelSessionId?: string };
      expect(resumedPayload.channelSessionId).toBe("remote-session-1");

      await client.deregister("integration-box");
      const snapshot = listDaemonSnapshotsSync().find((item) => item.daemon.daemonKey === "integration-box");
      expect(snapshot?.daemon.status).toBe("offline");
      expect(snapshot?.runtimes.every((runtime) => runtime.status === "offline")).toBe(true);
    } finally {
      restoreFetch();
    }
  });

  it("can complete a manual task that updates a channel document", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "integration-daemon",
      createdBy: "Tianyu",
    });
    const restoreFetch = installDaemonRouteFetch();
    const client = new HttpDaemonClient("http://daemon.test", daemonToken.token, {
      retryDelayMs: 0,
      maxRetryAttempts: 2,
    });

    try {
      const registered = await client.register({
        daemonKey: "integration-box-2",
        deviceName: "Integration Box 2",
        runtimes: [
          {
            provider: "codex",
            name: "Remote Codex",
            version: "test",
          },
        ],
      });
      const runtimeId = registered.runtimes[0]?.id;
      assert.ok(runtimeId);

      createEmployeeSync({
        name: "Atlas",
        role: "Planner",
      });
      bindEmployeeRuntimeSync("Atlas", runtimeId);
      const stateWithMembership = readWorkspaceStateSync();
      const atlas = stateWithMembership.activeEmployees.find((employee) => employee.name === "Atlas");
      if (atlas) {
        atlas.channels = ["tour visit"];
      }
      stateWithMembership.channels = stateWithMembership.channels.map((channel) =>
        channel.name === "tour visit"
          ? {
              ...channel,
              employeeNames: ["Atlas"],
            }
          : channel,
      );
      writeWorkspaceStateSync(stateWithMembership);

      const queued = enqueueNativeTaskSync({
        assignee: "Atlas",
        title: "Update channel doc",
        priority: "medium",
        triggerType: "manual",
        metadata: {
          title: "Update channel doc",
          channel: "tour visit",
          channelName: "tour visit",
        },
      });
      expect(queued?.id).toBeTruthy();

      const claimed = await client.claimTask(runtimeId);
      expect(claimed.task).toBeTruthy();

      await client.startTask(claimed.task!.id);
      await client.getInputBundle(claimed.task!.id);

      await client.uploadOutputBundle(claimed.task!.id, {
        version: 1,
        format: "json-inline-v1",
        files: [
          {
            path: "runtime-output/channel-documents.json",
            contentBase64: Buffer.from(
              JSON.stringify({
                documents: [
                  {
                    title: "大阪-濑户内海行程",
                    contentPath: "runtime-output/artifacts/trip-plan.md",
                    mode: "create_or_update",
                  },
                ],
              }),
              "utf8",
            ).toString("base64"),
          },
          {
            path: "runtime-output/artifacts/trip-plan.md",
            contentBase64: Buffer.from("# 大阪行程\n\n- Day 1", "utf8").toString("base64"),
          },
        ],
      });

      await client.completeTask(claimed.task!.id, {
        outputText: "文档已更新。",
      });

      const state = readWorkspaceStateSync();
      expect(state.channelDocuments.length).toBe(1);
      expect(state.channelDocuments[0]?.title).toBe("大阪-濑户内海行程");
      expect(state.messages[0]?.summary).toBe("文档已更新。");

      await client.deregister("integration-box-2");
      const snapshot = listDaemonSnapshotsSync().find((item) => item.daemon.daemonKey === "integration-box-2");
      expect(snapshot?.daemon.status).toBe("offline");
    } finally {
      restoreFetch();
    }
  });

  it("can complete a mention_chat task through the HTTP daemon API", async () => {
    const daemonToken = createDaemonApiTokenSync({
      label: "integration-daemon",
      createdBy: "Tianyu",
    });
    const restoreFetch = installDaemonRouteFetch();
    const client = new HttpDaemonClient("http://daemon.test", daemonToken.token, {
      retryDelayMs: 0,
      maxRetryAttempts: 2,
    });

    try {
      const registered = await client.register({
        daemonKey: "integration-box-3",
        deviceName: "Integration Box 3",
        runtimes: [
          {
            provider: "codex",
            name: "Remote Codex",
            version: "test",
          },
        ],
      });
      const runtimeId = registered.runtimes[0]?.id;
      assert.ok(runtimeId);

      createEmployeeSync({
        name: "Atlas",
        role: "Planner",
      });
      bindEmployeeRuntimeSync("Atlas", runtimeId);
      const stateWithMembership = readWorkspaceStateSync();
      const atlas = stateWithMembership.activeEmployees.find((employee) => employee.name === "Atlas");
      if (atlas) {
        atlas.channels = ["tour visit"];
      }
      stateWithMembership.channels = stateWithMembership.channels.map((channel) =>
        channel.name === "tour visit"
          ? {
              ...channel,
              employeeNames: ["Atlas"],
            }
          : channel,
      );
      writeWorkspaceStateSync(stateWithMembership);

      sendChannelHumanMessageSync("tour visit", "Tianyu", "@Atlas 请继续补全大阪的行程安排。");

      const claimed = await client.claimTask(runtimeId);
      assert.ok(claimed.task);
      assert.equal(claimed.task.triggerType, "mention_chat");

      await client.startTask(claimed.task.id);
      const inputBundle = await client.getInputBundle(claimed.task.id);
      assert.ok(inputBundle.prompt.includes("@Atlas") || inputBundle.prompt.includes("Atlas"));

      await client.reportMessages(claimed.task.id, {
        messages: [
          {
            type: "thinking",
            content: "正在补全大阪段安排。",
          },
        ],
      });

      await client.completeTask(claimed.task.id, {
        outputText: "我已经补全了大阪段的行程安排。",
      });

      const state = readWorkspaceStateSync();
      const channelMessages = state.messages.filter((message) => message.channel === "tour visit");
      expect(channelMessages.some((message) => message.speaker === "Atlas" && message.status === "pending")).toBe(false);
      expect(channelMessages[0]?.summary).toBe("我已经补全了大阪段的行程安排。");

      await client.deregister("integration-box-3");
      const snapshot = listDaemonSnapshotsSync().find((item) => item.daemon.daemonKey === "integration-box-3");
      expect(snapshot?.daemon.status).toBe("offline");
    } finally {
      restoreFetch();
    }
  });
});

function installDaemonRouteFetch(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const request = new Request(url.toString(), init);
    return dispatchToRoute(request);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function dispatchToRoute(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/api/daemon/register") {
    return registerPOST(request);
  }
  if (request.method === "POST" && url.pathname === "/api/daemon/heartbeat") {
    return heartbeatPOST(request);
  }
  if (request.method === "POST" && url.pathname === "/api/daemon/deregister") {
    return deregisterPOST(request);
  }
  if (request.method === "POST" && /^\/api\/daemon\/runtimes\/[^/]+\/tasks\/claim$/.test(url.pathname)) {
    const runtimeId = url.pathname.split("/")[4] ?? "";
    return claimPOST(request, { params: Promise.resolve({ runtimeId }) });
  }
  if (request.method === "POST" && /^\/api\/daemon\/tasks\/[^/]+\/start$/.test(url.pathname)) {
    const taskId = url.pathname.split("/")[4] ?? "";
    return startPOST(request, { params: Promise.resolve({ taskId }) });
  }
  if (request.method === "GET" && /^\/api\/daemon\/tasks\/[^/]+\/input-bundle$/.test(url.pathname)) {
    const taskId = url.pathname.split("/")[4] ?? "";
    return inputBundleGET(request, { params: Promise.resolve({ taskId }) });
  }
  if (request.method === "POST" && /^\/api\/daemon\/tasks\/[^/]+\/messages$/.test(url.pathname)) {
    const taskId = url.pathname.split("/")[4] ?? "";
    return messagesPOST(request, { params: Promise.resolve({ taskId }) });
  }
  if (request.method === "POST" && /^\/api\/daemon\/tasks\/[^/]+\/output-bundle$/.test(url.pathname)) {
    const taskId = url.pathname.split("/")[4] ?? "";
    return outputBundlePOST(request, { params: Promise.resolve({ taskId }) });
  }
  if (request.method === "POST" && /^\/api\/daemon\/tasks\/[^/]+\/complete$/.test(url.pathname)) {
    const taskId = url.pathname.split("/")[4] ?? "";
    return completePOST(request, { params: Promise.resolve({ taskId }) });
  }
  if (request.method === "POST" && /^\/api\/daemon\/tasks\/[^/]+\/fail$/.test(url.pathname)) {
    const taskId = url.pathname.split("/")[4] ?? "";
    return failPOST(request, { params: Promise.resolve({ taskId }) });
  }
  return Response.json({ error: "Not found." }, { status: 404 });
}
