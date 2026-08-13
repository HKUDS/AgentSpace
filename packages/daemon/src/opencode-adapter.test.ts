import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runAgentRouter } from "./agent-router/index.ts";

test("runAgentRouter classifies an OpenCode auth error event", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "opencode-adapter-auth-"));
  const binDir = join(workDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const opencodePath = join(binDir, "opencode");
  writeExecutable(
    opencodePath,
    [
      "#!/bin/sh",
      "printf '%s\\n' '{\"type\":\"error\",\"error\":{\"name\":\"APIError\",\"data\":{\"message\":\"Incorrect API key provided: sk-invalid-key-123\",\"statusCode\":401}}}'",
    ].join("\n"),
  );

  try {
    const result = await runAgentRouter({
      version: 1,
      harness: "opencode",
      prompt: "hello",
      cwd: workDir,
      executablePath: opencodePath,
      model: "deepseek/deepseek-v4-pro",
      timeoutMs: 5_000,
    });

    assert.equal(result.status, "failed");
    assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === "harness.auth_invalid"), true);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runAgentRouter reports a broken preflight when OpenCode auth is missing", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "opencode-adapter-preflight-"));
  const binDir = join(workDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const opencodePath = join(binDir, "opencode");
  writeExecutable(opencodePath, "#!/bin/sh\necho should-not-run\n");

  try {
    const result = await runAgentRouter({
      version: 1,
      harness: "opencode",
      prompt: "hello",
      cwd: workDir,
      executablePath: opencodePath,
      env: { HOME: workDir },
      timeoutMs: 5_000,
    });

    assert.equal(result.status, "failed");
    assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === "harness.auth_invalid"), true);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content, "utf8");
  chmodSync(path, 0o755);
}
