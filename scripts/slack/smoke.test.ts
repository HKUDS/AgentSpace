import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

async function runSmokeScript(args: string[]): Promise<{
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
    env: {},
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
