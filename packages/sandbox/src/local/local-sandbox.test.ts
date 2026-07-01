import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { platform } from "node:process";
import { join } from "node:path";
import test from "node:test";
import { LocalSandbox } from "./local-sandbox.ts";
import { createTrustedLocalSandboxPolicy } from "../policy.ts";

test("LocalSandbox.exec can keep stdin open for runtime responses", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "agent-space-local-sandbox-stdin-"));
  const scriptPath = join(workDir, "interactive.mjs");
  await writeFile(
    scriptPath,
    [
      "import { createInterface } from 'node:readline';",
      "const input = createInterface({ input: process.stdin });",
      "let index = 0;",
      "input.on('line', (line) => {",
      "  index += 1;",
      "  process.stdout.write(`${index === 1 ? 'first' : 'second'}:${line}\\n`);",
      "  if (index === 2) input.close();",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(scriptPath, 0o755);

  try {
    const sandbox = new LocalSandbox(workDir, "runtime-local-stdin-test");
    let wroteFollowup = false;
    const result = await sandbox.exec({
      command: process.execPath,
      args: [scriptPath],
      input: "hello\n",
      keepStdinOpen: true,
      onReady: (controller) => {
        setTimeout(() => {
          wroteFollowup = true;
          controller.writeStdin("world\n");
          controller.closeStdin();
        }, 10);
      },
      timeoutMs: 1_000,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(wroteFollowup, true);
    assert.match(result.stdout, /first:hello/);
    assert.match(result.stdout, /second:world/);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("LocalSandbox rejects path traversal and absolute paths", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "agent-space-local-sandbox-path-"));
  try {
    const sandbox = new LocalSandbox(workDir, "runtime-local-path-test");
    await assert.rejects(() => sandbox.readFile("../../etc/passwd"), /escapes sandbox root|resolves outside/);
    await assert.rejects(() => sandbox.writeFile("../../escape.txt", "nope"), /escapes sandbox root/);
    await assert.rejects(() => sandbox.readFile(join(workDir, "file.txt")), /Absolute sandbox paths are not allowed/);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("LocalSandbox validates realpath boundaries without prefix confusion", async () => {
  const parentDir = await mkdtemp(join(tmpdir(), "agent-space-local-sandbox-prefix-"));
  const workDir = join(parentDir, "task");
  const siblingDir = join(parentDir, "task-other");
  await mkdir(workDir, { recursive: true });
  await mkdir(siblingDir, { recursive: true });
  await writeFile(join(siblingDir, "outside.txt"), "outside", "utf8");

  try {
    const sandbox = new LocalSandbox(workDir, "runtime-local-prefix-test");
    await assert.rejects(() => sandbox.readFile("../task-other/outside.txt"), /escapes sandbox root/);
  } finally {
    await rm(parentDir, { recursive: true, force: true });
  }
});

test("LocalSandbox blocks symlink escape by default", { skip: platform === "win32" ? "Windows symlink permissions vary by host policy." : false }, async () => {
  const workDir = await mkdtemp(join(tmpdir(), "agent-space-local-sandbox-symlink-"));
  const outsideDir = await mkdtemp(join(tmpdir(), "agent-space-local-sandbox-outside-"));
  await writeFile(join(outsideDir, "secret.txt"), "must-not-read", "utf8");
  await symlink(outsideDir, join(workDir, "outside-link"));

  try {
    const sandbox = new LocalSandbox(workDir, "runtime-local-symlink-test");
    await assert.rejects(() => sandbox.readFile("outside-link/secret.txt"), /symlink|resolves outside/);
    await assert.rejects(() => sandbox.writeFile("outside-link/new.txt", "nope"), /symlink|resolves outside/);
  } finally {
    await rm(workDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
});

test("LocalSandbox does not inherit host secrets by default", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "agent-space-local-sandbox-env-"));
  const original = process.env.SANDBOX_TEST_SECRET;
  process.env.SANDBOX_TEST_SECRET = "must-not-leak";

  try {
    const sandbox = new LocalSandbox(workDir, "runtime-local-env-test");
    const result = await sandbox.exec({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.env.SANDBOX_TEST_SECRET || 'missing')"],
      timeoutMs: 1_000,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "missing");
    assert.equal(result.terminationReason, "completed");
  } finally {
    if (original === undefined) {
      delete process.env.SANDBOX_TEST_SECRET;
    } else {
      process.env.SANDBOX_TEST_SECRET = original;
    }
    await rm(workDir, { recursive: true, force: true });
  }
});

test("LocalSandbox allows explicit non-sensitive env keys and rewrites HOME/TMP", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "agent-space-local-sandbox-env-allow-"));

  try {
    const sandbox = new LocalSandbox(workDir, "runtime-local-env-allow-test");
    const result = await sandbox.exec({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write(JSON.stringify({ value: process.env.LANG, home: process.env.HOME, tmp: process.env.TMPDIR }))",
      ],
      env: {
        LANG: "C.UTF-8",
        HOME: "/host/home",
        TMPDIR: "/host/tmp",
        OPENAI_API_KEY: "must-not-leak",
      },
      timeoutMs: 1_000,
    });

    const parsed = JSON.parse(result.stdout) as { value: string; home: string; tmp: string };
    assert.equal(parsed.value, "C.UTF-8");
    assert.equal(parsed.home, join(workDir, ".home"));
    assert.equal(parsed.tmp, join(workDir, ".tmp"));
    assert.doesNotMatch(result.stdout, /must-not-leak/);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("LocalSandbox bounds stdout and reports output-limit termination", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "agent-space-local-sandbox-output-"));
  const policy = createTrustedLocalSandboxPolicy(workDir);
  policy.output.maxStdoutBytes = 16;
  policy.output.maxCombinedOutputBytes = 16;

  try {
    const sandbox = new LocalSandbox(workDir, "runtime-local-output-test", policy);
    const result = await sandbox.exec({
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(1024))"],
      timeoutMs: 1_000,
    });

    assert.equal(result.stdout.length, 16);
    assert.equal(result.stdoutTruncated, true);
    assert.equal(result.outputLimitExceeded, true);
    assert.equal(result.terminationReason, "output_limit");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("LocalSandbox enforces per-file and total write limits", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "agent-space-local-sandbox-write-limit-"));
  const policy = createTrustedLocalSandboxPolicy(workDir);
  policy.filesystem.maxFileBytes = 4;
  policy.filesystem.maxTotalWriteBytes = 6;

  try {
    const sandbox = new LocalSandbox(workDir, "runtime-local-write-limit-test", policy);
    await assert.rejects(() => sandbox.writeFile("too-large.txt", "12345"), /maxFileBytes/);
    await sandbox.writeFile("one.txt", "123");
    await sandbox.writeFile("two.txt", "123");
    await assert.rejects(() => sandbox.writeFile("three.txt", "1"), /maxTotalWriteBytes/);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
