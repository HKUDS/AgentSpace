import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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
