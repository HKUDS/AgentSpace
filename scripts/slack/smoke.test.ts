import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("Slack smoke dry-run rejects placeholder env without leaking ids", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-slack-smoke-"));
  try {
    const envPath = join(directory, ".env");
    writeFileSync(envPath, [
      "AGENT_SPACE_WORKSPACE_ID=default",
      "AGENT_SPACE_SLACK_INTEGRATION_ID=slack-1",
      "AGENT_SPACE_PUBLIC_APP_URL=https://agentspace.example.com",
      "SLACK_SMOKE_CALLBACK_URL=https://agentspace.example.com/api/integrations/slack/events",
      "SLACK_SMOKE_CHANNEL_ID=CHANGE_ME_SLACK_CHANNEL_ID",
      "SLACK_SMOKE_USER_ID=CHANGE_ME_SLACK_USER_ID",
    ].join("\n"));

    const result = spawnSync(process.execPath, [
      "--experimental-strip-types",
      "scripts/slack/smoke.ts",
      "--env-file",
      envPath,
      "--check-env",
      "--json",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {},
    });

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout) as {
      ready: boolean;
      missingRequired: string[];
    };
    assert.equal(output.ready, false);
    assert.ok(output.missingRequired.includes("SLACK_SMOKE_CHANNEL_ID"));
    assert.ok(output.missingRequired.includes("SLACK_SMOKE_USER_ID"));
    assert.doesNotMatch(result.stdout, /C123|U123|xoxb|xapp/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Slack smoke dry-run accepts filled non-secret env", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-slack-smoke-"));
  try {
    const envPath = join(directory, ".env");
    writeFileSync(envPath, [
      "AGENT_SPACE_WORKSPACE_ID=default",
      "AGENT_SPACE_SLACK_INTEGRATION_ID=slack-1",
      "AGENT_SPACE_PUBLIC_APP_URL=https://agentspace.test",
      "SLACK_SMOKE_CALLBACK_URL=https://agentspace.test/api/integrations/slack/events",
      "SLACK_SMOKE_CHANNEL_ID=C123",
      "SLACK_SMOKE_USER_ID=U123",
    ].join("\n"));

    const result = spawnSync(process.execPath, [
      "--experimental-strip-types",
      "scripts/slack/smoke.ts",
      "--env-file",
      envPath,
      "--check-env",
      "--json",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {},
    });

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout) as {
      ready: boolean;
      summary: {
        failed: number;
      };
    };
    assert.equal(output.ready, true);
    assert.equal(output.summary.failed, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Slack smoke live sends a disposable channel message with redacted output", async () => {
  const requests: Array<{
    authorization?: string;
    body: Record<string, unknown>;
  }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      requests.push({
        authorization: request.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
      });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        ok: true,
        channel: "C123LIVE",
        ts: "1783400000.000100",
      }));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const directory = mkdtempSync(join(tmpdir(), "agentspace-slack-smoke-"));
  try {
    const envPath = join(directory, ".env");
    writeFileSync(envPath, [
      "AGENT_SPACE_WORKSPACE_ID=default",
      "AGENT_SPACE_SLACK_INTEGRATION_ID=slack-1",
      "AGENT_SPACE_PUBLIC_APP_URL=https://agentspace.test",
      "SLACK_SMOKE_CALLBACK_URL=https://agentspace.test/api/integrations/slack/events",
      "SLACK_SMOKE_CHANNEL_ID=C123LIVE",
      "SLACK_SMOKE_USER_ID=U123LIVE",
      "SLACK_SMOKE_MESSAGE_TEXT=AgentSpace Slack smoke",
      "SLACK_BOT_TOKEN=xoxb-live-secret",
      `SLACK_API_BASE_URL=http://127.0.0.1:${address.port}`,
    ].join("\n"));

    const result = await runSmokeScript([
      "--env-file",
      envPath,
      "--live",
      "--json",
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.authorization, "Bearer xoxb-live-secret");
    assert.deepEqual(requests[0]?.body, {
      channel: "C123LIVE",
      text: "AgentSpace Slack smoke",
    });
    const output = JSON.parse(result.stdout) as {
      ready: boolean;
      live: boolean;
      liveResult?: {
        ok: boolean;
        channelReference?: string;
        messageReference?: string;
      };
    };
    assert.equal(output.ready, true);
    assert.equal(output.live, true);
    assert.equal(output.liveResult?.ok, true);
    assert.equal(output.liveResult?.channelReference, "channel C1...VE");
    assert.equal(output.liveResult?.messageReference, "message 1783...0100");
    assert.doesNotMatch(result.stdout, /xoxb-live-secret|C123LIVE|U123LIVE/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

test("Slack smoke live app_mention mode posts a bot mention from the configured post token", async () => {
  const requests: Array<{
    authorization?: string;
    body: Record<string, unknown>;
  }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      requests.push({
        authorization: request.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
      });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        ok: true,
        channel: "CAPPMENTION",
        ts: "1783400001.000200",
      }));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const directory = mkdtempSync(join(tmpdir(), "agentspace-slack-smoke-"));
  try {
    const envPath = join(directory, ".env");
    writeFileSync(envPath, [
      "AGENT_SPACE_WORKSPACE_ID=default",
      "AGENT_SPACE_SLACK_INTEGRATION_ID=slack-1",
      "AGENT_SPACE_PUBLIC_APP_URL=https://agentspace.test",
      "SLACK_SMOKE_CALLBACK_URL=https://agentspace.test/api/integrations/slack/events",
      "SLACK_SMOKE_CHANNEL_ID=CAPPMENTION",
      "SLACK_SMOKE_USER_ID=UPOSTER",
      "SLACK_SMOKE_MESSAGE_TEXT=@Atlas live app mention",
      "SLACK_SMOKE_LIVE_MODE=app_mention",
      "SLACK_SMOKE_BOT_USER_ID=UBOTLIVE",
      "SLACK_SMOKE_POST_TOKEN=xoxp-user-secret",
      "SLACK_BOT_TOKEN=xoxb-bot-secret",
      `SLACK_API_BASE_URL=http://127.0.0.1:${address.port}`,
    ].join("\n"));

    const result = await runSmokeScript([
      "--env-file",
      envPath,
      "--live",
      "--json",
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.authorization, "Bearer xoxp-user-secret");
    assert.deepEqual(requests[0]?.body, {
      channel: "CAPPMENTION",
      text: "<@UBOTLIVE> @Atlas live app mention",
    });
    const output = JSON.parse(result.stdout) as {
      ready: boolean;
      liveResult?: {
        ok: boolean;
        mode?: string;
        appMentionText?: boolean;
        channelReference?: string;
        botUserReference?: string;
        messageReference?: string;
      };
    };
    assert.equal(output.ready, true);
    assert.equal(output.liveResult?.ok, true);
    assert.equal(output.liveResult?.mode, "app_mention");
    assert.equal(output.liveResult?.appMentionText, true);
    assert.equal(output.liveResult?.channelReference, "channel CAPP...TION");
    assert.equal(output.liveResult?.botUserReference, "user UB...VE");
    assert.equal(output.liveResult?.messageReference, "message 1783...0200");
    assert.doesNotMatch(result.stdout, /xoxp-user-secret|xoxb-bot-secret|CAPPMENTION|UPOSTER|UBOTLIVE/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

test("Slack smoke live file_upload mode uses the external upload flow", async () => {
  const requests: Array<{
    path?: string;
    authorization?: string;
    contentType?: string;
    bodyText: string;
  }> = [];
  let baseUrl = "";
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      const path = request.url ?? "";
      const bodyText = Buffer.concat(chunks).toString("utf8");
      requests.push({
        path,
        authorization: request.headers.authorization,
        contentType: request.headers["content-type"],
        bodyText,
      });
      response.setHeader("content-type", "application/json");
      if (path.endsWith("/files.getUploadURLExternal")) {
        response.end(JSON.stringify({
          ok: true,
          upload_url: `${baseUrl}/upload/FSMOKEFILE123`,
          file_id: "FSMOKEFILE123",
        }));
        return;
      }
      if (path === "/upload/FSMOKEFILE123") {
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      if (path.endsWith("/files.completeUploadExternal")) {
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ ok: false, error: "not_found" }));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
  const directory = mkdtempSync(join(tmpdir(), "agentspace-slack-smoke-"));
  try {
    const envPath = join(directory, ".env");
    writeFileSync(envPath, [
      "AGENT_SPACE_WORKSPACE_ID=default",
      "AGENT_SPACE_SLACK_INTEGRATION_ID=slack-1",
      "AGENT_SPACE_PUBLIC_APP_URL=https://agentspace.test",
      "SLACK_SMOKE_CALLBACK_URL=https://agentspace.test/api/integrations/slack/events",
      "SLACK_SMOKE_CHANNEL_ID=CFILELIVE",
      "SLACK_SMOKE_USER_ID=UFILELIVE",
      "SLACK_SMOKE_MESSAGE_TEXT=AgentSpace Slack file smoke",
      "SLACK_SMOKE_LIVE_MODE=file_upload",
      "SLACK_SMOKE_FILE_NAME=agentspace-smoke.txt",
      "SLACK_SMOKE_FILE_TITLE=AgentSpace smoke file",
      "SLACK_SMOKE_FILE_CONTENT=hello from AgentSpace",
      "SLACK_SMOKE_FILE_MIME=text/plain",
      "SLACK_BOT_TOKEN=xoxb-file-secret",
      `SLACK_API_BASE_URL=${baseUrl}`,
    ].join("\n"));

    const result = await runSmokeScript([
      "--env-file",
      envPath,
      "--live",
      "--json",
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(requests.map((request) => request.path), [
      "/files.getUploadURLExternal",
      "/upload/FSMOKEFILE123",
      "/files.completeUploadExternal",
    ]);
    assert.equal(requests[0]?.authorization, "Bearer xoxb-file-secret");
    assert.deepEqual(JSON.parse(requests[0]?.bodyText ?? "{}"), {
      filename: "agentspace-smoke.txt",
      length: Buffer.byteLength("hello from AgentSpace"),
    });
    assert.equal(requests[1]?.contentType, "text/plain");
    assert.equal(requests[1]?.bodyText, "hello from AgentSpace");
    assert.deepEqual(JSON.parse(requests[2]?.bodyText ?? "{}"), {
      channel_id: "CFILELIVE",
      files: [{
        id: "FSMOKEFILE123",
        title: "AgentSpace smoke file",
      }],
      initial_comment: "AgentSpace Slack file smoke",
    });
    const output = JSON.parse(result.stdout) as {
      ready: boolean;
      liveResult?: {
        ok: boolean;
        mode?: string;
        fileUpload?: boolean;
        uploadCompleted?: boolean;
        channelReference?: string;
        fileReference?: string;
      };
    };
    assert.equal(output.ready, true);
    assert.equal(output.liveResult?.ok, true);
    assert.equal(output.liveResult?.mode, "file_upload");
    assert.equal(output.liveResult?.fileUpload, true);
    assert.equal(output.liveResult?.uploadCompleted, true);
    assert.equal(output.liveResult?.channelReference, "channel CFIL...LIVE");
    assert.equal(output.liveResult?.fileReference, "file FSMO...E123");
    assert.doesNotMatch(result.stdout, /xoxb-file-secret|CFILELIVE|UFILELIVE|FSMOKEFILE123|upload\/F/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

test("Slack smoke live evidence artifact accumulates redacted post, app mention, and file runs", async () => {
  const requests: Array<Record<string, unknown>> = [];
  let baseUrl = "";
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      const path = request.url ?? "";
      if (path.endsWith("/chat.postMessage")) {
        requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          ok: true,
          channel: "CEVIDENCE",
          ts: `178340000${requests.length}.000100`,
        }));
        return;
      }
      if (path.endsWith("/files.getUploadURLExternal")) {
        requests.push({ method: "files.getUploadURLExternal" });
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          ok: true,
          upload_url: `${baseUrl}/upload/FEVIDENCEFILE`,
          file_id: "FEVIDENCEFILE",
        }));
        return;
      }
      if (path === "/upload/FEVIDENCEFILE") {
        requests.push({ method: "file_upload_url" });
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      if (path.endsWith("/files.completeUploadExternal")) {
        requests.push({ method: "files.completeUploadExternal" });
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      response.statusCode = 404;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: false, error: "not_found" }));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
  const directory = mkdtempSync(join(tmpdir(), "agentspace-slack-smoke-"));
  try {
    const evidencePath = join(directory, "live.json");
    const envPath = join(directory, ".env");
    writeFileSync(envPath, [
      "AGENT_SPACE_WORKSPACE_ID=default",
      "AGENT_SPACE_SLACK_INTEGRATION_ID=slack-1",
      "AGENT_SPACE_PUBLIC_APP_URL=https://agentspace.test",
      "SLACK_SMOKE_CALLBACK_URL=https://agentspace.test/api/integrations/slack/events",
      "SLACK_SMOKE_CHANNEL_ID=CEVIDENCE",
      "SLACK_SMOKE_USER_ID=UEVIDENCE",
      "SLACK_SMOKE_APP_ID=AEVIDENCE123",
      "SLACK_SMOKE_TEAM_ID=TEVIDENCE123",
      "SLACK_SMOKE_MESSAGE_TEXT=AgentSpace Slack smoke",
      "SLACK_SMOKE_BOT_USER_ID=UBOTEVIDENCE",
      "SLACK_BOT_TOKEN=xoxb-bot-secret",
      "SLACK_SMOKE_POST_TOKEN=xoxp-user-secret",
      `SLACK_API_BASE_URL=${baseUrl}`,
    ].join("\n"));

    const postMessage = await runSmokeScript([
      "--env-file",
      envPath,
      "--live",
      "--evidence",
      evidencePath,
      "--json",
    ]);
    const appMention = await runSmokeScript([
      "--env-file",
      envPath,
      "--live",
      "--evidence",
      evidencePath,
      "--json",
    ], {
      SLACK_SMOKE_LIVE_MODE: "app_mention",
    });
    const fileUpload = await runSmokeScript([
      "--env-file",
      envPath,
      "--live",
      "--evidence",
      evidencePath,
      "--json",
    ], {
      SLACK_SMOKE_LIVE_MODE: "file_upload",
    });

    assert.equal(postMessage.status, 0, postMessage.stderr);
    assert.equal(appMention.status, 0, appMention.stderr);
    assert.equal(fileUpload.status, 0, fileUpload.stderr);
    const artifactText = readFileSync(evidencePath, "utf8");
    const artifact = JSON.parse(artifactText) as {
      provider?: string;
      context?: {
        workspaceId?: string;
        integrationId?: string;
        appReference?: string;
        teamReference?: string;
      };
      runs?: Array<{
        mode?: string;
        context?: {
          workspaceId?: string;
          integrationId?: string;
        };
        liveResult?: { mode?: string; appMentionText?: boolean; fileUpload?: boolean; uploadCompleted?: boolean };
      }>;
    };
    assert.equal(artifact.provider, "slack");
    assert.deepEqual(artifact.context, {
      workspaceId: "default",
      integrationId: "slack-1",
      appReference: "ref_3acb74de",
      teamReference: "ref_6db9d37d",
    });
    assert.deepEqual(artifact.runs?.map((run) => run.context?.integrationId), ["slack-1", "slack-1", "slack-1"]);
    assert.deepEqual(artifact.runs?.map((run) => run.liveResult?.mode), ["post_message", "app_mention", "file_upload"]);
    assert.equal(artifact.runs?.[1]?.liveResult?.appMentionText, true);
    assert.equal(artifact.runs?.[2]?.liveResult?.fileUpload, true);
    assert.equal(artifact.runs?.[2]?.liveResult?.uploadCompleted, true);
    assert.doesNotMatch(artifactText, /xoxb-bot-secret|xoxp-user-secret|CEVIDENCE|UEVIDENCE|UBOTEVIDENCE|AEVIDENCE123|TEVIDENCE123|FEVIDENCEFILE|1783400001\.000100/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

test("Slack webhook replay requires signing and app context env", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-slack-smoke-"));
  try {
    const envPath = join(directory, ".env");
    writeFileSync(envPath, [
      "AGENT_SPACE_WORKSPACE_ID=default",
      "AGENT_SPACE_SLACK_INTEGRATION_ID=slack-1",
      "AGENT_SPACE_PUBLIC_APP_URL=https://agentspace.test",
      "SLACK_SMOKE_CALLBACK_URL=https://agentspace.test/api/integrations/slack/events",
      "SLACK_SMOKE_CHANNEL_ID=C123",
      "SLACK_SMOKE_USER_ID=U123",
    ].join("\n"));

    const result = await runSmokeScript([
      "--env-file",
      envPath,
      "--replay-webhook",
      "--json",
    ]);

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout) as {
      ready: boolean;
      webhookReplay?: {
        attempted: boolean;
        errorCode?: string;
      };
      missingRequired: string[];
    };
    assert.equal(output.ready, false);
    assert.equal(output.webhookReplay?.attempted, false);
    assert.equal(output.webhookReplay?.errorCode, "slack.smoke.webhook_replay_env_incomplete");
    assert.ok(output.missingRequired.includes("SLACK_SIGNING_SECRET"));
    assert.ok(output.missingRequired.includes("SLACK_SMOKE_APP_ID"));
    assert.ok(output.missingRequired.includes("SLACK_SMOKE_TEAM_ID"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Slack webhook replay signs challenge and event requests without leaking ids", async () => {
  const signingSecret = "signing-secret";
  const requests: Array<{
    body: Record<string, unknown>;
    pathname: string;
    searchParams: URLSearchParams;
    signature?: string;
    timestamp?: string;
    signatureValid: boolean;
  }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const body = JSON.parse(bodyText) as Record<string, unknown>;
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const timestamp = String(request.headers["x-slack-request-timestamp"] ?? "");
      const signature = String(request.headers["x-slack-signature"] ?? "");
      requests.push({
        body,
        pathname: requestUrl.pathname,
        searchParams: requestUrl.searchParams,
        signature,
        timestamp,
        signatureValid: signature === signSlackBody(signingSecret, timestamp, bodyText),
      });
      response.setHeader("content-type", "application/json");
      if (body.type === "url_verification") {
        response.end(JSON.stringify({ challenge: body.challenge }));
        return;
      }
      response.end(JSON.stringify({
        ok: true,
        eventStatus: "ignored",
        dispatchStatus: "ignored",
        reasonCode: "slack.channel_binding_missing",
      }));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const directory = mkdtempSync(join(tmpdir(), "agentspace-slack-smoke-"));
  try {
    const envPath = join(directory, ".env");
    writeFileSync(envPath, [
      "AGENT_SPACE_WORKSPACE_ID=workspace-1",
      "AGENT_SPACE_SLACK_INTEGRATION_ID=slack-1",
      "AGENT_SPACE_PUBLIC_APP_URL=https://agentspace.test",
      "SLACK_SMOKE_CALLBACK_URL=https://agentspace.test/api/integrations/slack/events",
      "SLACK_SMOKE_CHANNEL_ID=CLOCAL123",
      "SLACK_SMOKE_USER_ID=ULOCAL123",
      "SLACK_SMOKE_MESSAGE_TEXT=AgentSpace Slack smoke",
      "SLACK_SIGNING_SECRET=signing-secret",
      "SLACK_SMOKE_APP_ID=ALOCAL123",
      "SLACK_SMOKE_TEAM_ID=TLOCAL123",
      "SLACK_SMOKE_BOT_USER_ID=UBOTLOCAL",
      `AGENT_SPACE_SMOKE_CALLBACK_BASE_URL=http://127.0.0.1:${address.port}`,
    ].join("\n"));

    const result = await runSmokeScript([
      "--env-file",
      envPath,
      "--replay-webhook",
      "--json",
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.pathname, "/api/integrations/slack/events");
    assert.equal(requests[0]?.searchParams.get("workspaceId"), "workspace-1");
    assert.equal(requests[0]?.searchParams.get("integrationId"), "slack-1");
    assert.equal(requests[0]?.signatureValid, true);
    assert.equal(requests[1]?.signatureValid, true);
    assert.equal(requests[1]?.body.api_app_id, "ALOCAL123");
    assert.equal(requests[1]?.body.team_id, "TLOCAL123");
    const event = requests[1]?.body.event as Record<string, unknown> | undefined;
    assert.equal(event?.channel, "CLOCAL123");
    assert.equal(event?.user, "ULOCAL123");
    assert.equal(event?.text, "<@UBOTLOCAL> AgentSpace Slack smoke");
    const output = JSON.parse(result.stdout) as {
      ready: boolean;
      mode: string;
      webhookReplay?: {
        ok: boolean;
        challenge?: { ok: boolean };
        event?: { ok: boolean; dispatchStatus?: string; reasonCode?: string };
      };
    };
    assert.equal(output.ready, true);
    assert.equal(output.mode, "webhook-replay");
    assert.equal(output.webhookReplay?.ok, true);
    assert.equal(output.webhookReplay?.challenge?.ok, true);
    assert.equal(output.webhookReplay?.event?.ok, true);
    assert.equal(output.webhookReplay?.event?.dispatchStatus, "ignored");
    assert.equal(output.webhookReplay?.event?.reasonCode, "slack.channel_binding_missing");
    assert.doesNotMatch(result.stdout, /signing-secret|ALOCAL123|TLOCAL123|CLOCAL123|ULOCAL123|UBOTLOCAL/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

async function runSmokeScript(args: string[], env: Record<string, string> = {}): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  const child = spawn(process.execPath, [
    "--experimental-strip-types",
    "scripts/slack/smoke.ts",
    ...args,
  ], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const status = await new Promise<number | null>((resolve) => {
    child.on("close", resolve);
  });
  return { status, stdout, stderr };
}

function signSlackBody(signingSecret: string, timestamp: string, body: string): string {
  return `v0=${createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${body}`, "utf8")
    .digest("hex")}`;
}
