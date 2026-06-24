import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { formatDaemonProviderLabel } from "@agent-space/domain";
import {
  detectProviders,
  readProviderTaskFailureMetadata,
  resolveModelId,
  runProviderTask,
  type ProviderRuntimeRecord,
} from "./provider-runtime.ts";
import { inspectOpenClawDaemonAuthHealth, normalizeOpenClawProviderError } from "./openclaw-health.ts";

test("detectProviders includes opencode, openclaw, nanobot, and hermes when their CLIs are on PATH", () => {
  const binDir = mkdtempSync(join(tmpdir(), "agent-space-provider-bin-"));
  const originalPath = process.env.PATH;

  try {
    for (const command of ["opencode", "openclaw", "nanobot"]) {
      const filePath = join(binDir, command);
      writeFileSync(filePath, "#!/bin/sh\necho 0.1.0\n", "utf8");
      chmodSync(filePath, 0o755);
    }
    const hermesPath = join(binDir, "hermes-agent");
    writeFileSync(
      hermesPath,
      "#!/bin/sh\nif [ \"$1\" = 'version' ]; then echo hermes 0.2.0; fi\n",
      "utf8",
    );
    chmodSync(hermesPath, 0o755);

    process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;

    const detected = detectProviders();
    assert.equal(detected.some((provider) => provider.provider === "opencode"), true);
    assert.equal(detected.some((provider) => provider.provider === "openclaw"), true);
    assert.equal(detected.some((provider) => provider.provider === "nanobot"), true);
    const hermes = detected.find((provider) => provider.provider === "hermes");
    assert.equal(Boolean(hermes), true);
    assert.equal(hermes?.version, "hermes 0.2.0");
  } finally {
    process.env.PATH = originalPath;
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("detectProviders allows Claude Code when the daemon is running as root", async () => {
  const binDir = mkdtempSync(join(tmpdir(), "agent-space-provider-bin-"));
  const originalPath = process.env.PATH;

  try {
    for (const command of ["claude", "codex"]) {
      const filePath = join(binDir, command);
      writeFileSync(filePath, "#!/bin/sh\necho 1.0.0\n", "utf8");
      chmodSync(filePath, 0o755);
    }

    process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;

    await withProcessGetuid(0, () => {
      const detected = detectProviders();
      assert.equal(detected.some((provider) => provider.provider === "claude"), true);
      assert.equal(detected.some((provider) => provider.provider === "codex"), true);
    });

    await withProcessGetuid(1000, () => {
      const detected = detectProviders();
      assert.equal(detected.some((provider) => provider.provider === "claude"), true);
    });
  } finally {
    process.env.PATH = originalPath;
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("resolveModelId returns provider-specific defaults and overrides for expanded providers", () => {
  const baseRuntime: Omit<ProviderRuntimeRecord, "provider"> = {
    id: "runtime-1",
    workspaceId: "default",
    name: "Runtime",
    status: "online",
    metadata: {
      executablePath: "/usr/bin/mock",
      mode: "remote",
    },
  };

  const originalOpenCodeModel = process.env.OPENCODE_MODEL;
  const originalOpenClawModel = process.env.OPENCLAW_MODEL;
  const originalNanoBotModel = process.env.NANOBOT_MODEL;
  const originalCodexModel = process.env.CODEX_MODEL;
  const originalHermesModel = process.env.HERMES_MODEL;
  const originalHermesInferenceModel = process.env.HERMES_INFERENCE_MODEL;

  try {
    delete process.env.CODEX_MODEL;
    delete process.env.OPENCODE_MODEL;
    delete process.env.OPENCLAW_MODEL;
    delete process.env.NANOBOT_MODEL;
    delete process.env.HERMES_MODEL;
    delete process.env.HERMES_INFERENCE_MODEL;

    assert.equal(resolveModelId({ ...baseRuntime, provider: "codex" }), undefined);
    assert.equal(resolveModelId({ ...baseRuntime, provider: "opencode" }), "opencode-default");
    assert.equal(resolveModelId({ ...baseRuntime, provider: "openclaw" }), undefined);
    assert.equal(resolveModelId({ ...baseRuntime, provider: "nanobot" }), "nanobot-default");
    assert.equal(resolveModelId({ ...baseRuntime, provider: "hermes" }), undefined);

    process.env.CODEX_MODEL = "gpt-5.5";
    process.env.OPENCODE_MODEL = "openrouter/openai/gpt-4.1";
    process.env.OPENCLAW_MODEL = "openrouter/anthropic/claude-sonnet";
    process.env.NANOBOT_MODEL = "gpt-4.1-mini";
    process.env.HERMES_INFERENCE_MODEL = "nous-hermes-config";

    assert.equal(resolveModelId({ ...baseRuntime, provider: "codex" }), "gpt-5.5");
    assert.equal(resolveModelId({ ...baseRuntime, provider: "opencode" }), "openrouter/openai/gpt-4.1");
    assert.equal(resolveModelId({ ...baseRuntime, provider: "openclaw" }), "openrouter/anthropic/claude-sonnet");
    assert.equal(resolveModelId({
      ...baseRuntime,
      provider: "openclaw",
      metadata: {
        ...baseRuntime.metadata,
        openClawModel: "runtime/override-model",
      },
    }), "runtime/override-model");
    assert.equal(resolveModelId({ ...baseRuntime, provider: "nanobot" }), "gpt-4.1-mini");
    assert.equal(resolveModelId({ ...baseRuntime, provider: "hermes" }), "nous-hermes-config");

    process.env.HERMES_MODEL = "nous-hermes";
    assert.equal(resolveModelId({ ...baseRuntime, provider: "hermes" }), "nous-hermes");
  } finally {
    if (originalCodexModel === undefined) {
      delete process.env.CODEX_MODEL;
    } else {
      process.env.CODEX_MODEL = originalCodexModel;
    }
    if (originalOpenCodeModel === undefined) {
      delete process.env.OPENCODE_MODEL;
    } else {
      process.env.OPENCODE_MODEL = originalOpenCodeModel;
    }
    if (originalOpenClawModel === undefined) {
      delete process.env.OPENCLAW_MODEL;
    } else {
      process.env.OPENCLAW_MODEL = originalOpenClawModel;
    }
    if (originalNanoBotModel === undefined) {
      delete process.env.NANOBOT_MODEL;
    } else {
      process.env.NANOBOT_MODEL = originalNanoBotModel;
    }
    if (originalHermesModel === undefined) {
      delete process.env.HERMES_MODEL;
    } else {
      process.env.HERMES_MODEL = originalHermesModel;
    }
    if (originalHermesInferenceModel === undefined) {
      delete process.env.HERMES_INFERENCE_MODEL;
    } else {
      process.env.HERMES_INFERENCE_MODEL = originalHermesInferenceModel;
    }
  }
});

test("formatDaemonProviderLabel returns friendly labels for expanded providers", () => {
  assert.equal(formatDaemonProviderLabel("opencode"), "OpenCode");
  assert.equal(formatDaemonProviderLabel("openclaw"), "OpenClaw");
  assert.equal(formatDaemonProviderLabel("nanobot"), "NanoBot");
  assert.equal(formatDaemonProviderLabel("hermes"), "Hermes Agent");
});

test("runProviderTask resumes Codex sessions when sessionId is provided", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-codex-resume-"));
  const binPath = join(workDir, "codex");
  const argsPath = join(workDir, "codex-args.json");
  writeFileSync(
    binPath,
    [
      "#!/bin/sh",
      ": > \"$CODEX_ARGS_PATH\"",
      "for arg in \"$@\"; do",
      "  printf '%s\\n' \"$arg\" >> \"$CODEX_ARGS_PATH\"",
      "done",
      "previous_arg=\"\"",
      "for arg in \"$@\"; do",
      "  if [ \"$previous_arg\" = \"-o\" ]; then",
      "    printf '%s' 'resumed output' > \"$arg\"",
      "  fi",
      "  previous_arg=\"$arg\"",
      "done",
      "printf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"session-next\"}'",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(binPath, 0o755);

  const runtime: ProviderRuntimeRecord = {
    id: "runtime-codex-test",
    workspaceId: "default",
    provider: "codex",
    name: "Codex",
    status: "online",
    metadata: {
      executablePath: binPath,
      mode: "remote",
    },
  };

  try {
    const result = await runProviderTask(runtime, "continue work", workDir, {
      sessionId: "session-prev",
      contextEnv: { CODEX_ARGS_PATH: argsPath },
      taskTimeoutMs: 1_000,
    });
    const args = readFileSync(argsPath, "utf8").trim().split(/\r?\n/);

    assert.equal(result.output, "resumed output");
    assert.equal(result.sessionId, "session-next");
    assert.deepEqual(args.slice(0, 2), ["exec", "resume"]);
    assert.equal(args.includes("session-prev"), true);
    assert.equal(args.includes("--cd"), false);
    assert.equal(args.includes("--model"), false);
    assert.equal(args.includes("--dangerously-bypass-approvals-and-sandbox"), true);
    assert.equal(args.includes("sandbox_mode=\"danger-full-access\""), true);
    assert.equal(args.includes("approval_policy=\"never\""), true);
    assert.equal(args.includes("shell_environment_policy.inherit=\"all\""), true);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runProviderTask adds daemon bin directory to provider PATH", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-codex-provider-path-"));
  const providerBinDir = join(workDir, "provider-bin");
  const daemonBinDir = join(workDir, "daemon-runtime", "bin");
  const binPath = join(providerBinDir, "codex");
  const daemonBinPath = join(daemonBinDir, "agent-space-daemon");
  const seenPathFile = join(workDir, "seen-path.txt");
  mkdirSync(providerBinDir, { recursive: true });
  mkdirSync(daemonBinDir, { recursive: true });
  writeFileSync(
    binPath,
    [
      "#!/bin/sh",
      "printf '%s' \"$PATH\" > \"$SEEN_PATH_FILE\"",
      "previous_arg=\"\"",
      "for arg in \"$@\"; do",
      "  if [ \"$previous_arg\" = \"-o\" ]; then",
      "    if command -v agent-space-daemon >/dev/null 2>&1; then",
      "      printf '%s' 'path ok' > \"$arg\"",
      "    else",
      "      printf '%s' 'path missing' > \"$arg\"",
      "    fi",
      "  fi",
      "  previous_arg=\"$arg\"",
      "done",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(daemonBinPath, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(binPath, 0o755);
  chmodSync(daemonBinPath, 0o755);

  const runtime: ProviderRuntimeRecord = {
    id: "runtime-codex-path-test",
    workspaceId: "default",
    provider: "codex",
    name: "Codex",
    status: "online",
    metadata: {
      executablePath: binPath,
      mode: "remote",
    },
  };
  const originalDaemonBin = process.env.AGENT_SPACE_DAEMON_BIN;

  try {
    process.env.AGENT_SPACE_DAEMON_BIN = daemonBinPath;
    const result = await runProviderTask(runtime, "check path", workDir, {
      contextEnv: {
        PATH: providerBinDir,
        SEEN_PATH_FILE: seenPathFile,
      },
      taskTimeoutMs: 1_000,
    });
    const seenPath = readFileSync(seenPathFile, "utf8").split(delimiter);

    assert.equal(result.output, "path ok");
    assert.equal(seenPath[0], providerBinDir);
    assert.equal(seenPath.includes(daemonBinDir), true);
  } finally {
    if (originalDaemonBin === undefined) {
      delete process.env.AGENT_SPACE_DAEMON_BIN;
    } else {
      process.env.AGENT_SPACE_DAEMON_BIN = originalDaemonBin;
    }
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runProviderTask starts a new Codex conversation when resume rollout is missing", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-codex-stale-resume-"));
  const binPath = join(workDir, "codex");
  const argsDir = join(workDir, "args");
  const countPath = join(workDir, "count.txt");
  mkdirSync(argsDir, { recursive: true });
  writeFileSync(
    binPath,
    [
      "#!/bin/sh",
      "count=0",
      "if [ -f \"$CODEX_COUNT_PATH\" ]; then",
      "  count=$(cat \"$CODEX_COUNT_PATH\")",
      "fi",
      "count=$((count + 1))",
      "printf '%s' \"$count\" > \"$CODEX_COUNT_PATH\"",
      "args_path=\"$CODEX_ARGS_DIR/invocation-$count.txt\"",
      ": > \"$args_path\"",
      "output_path=\"\"",
      "previous_arg=\"\"",
      "for arg in \"$@\"; do",
      "  printf '%s\\n' \"$arg\" >> \"$args_path\"",
      "  if [ \"$previous_arg\" = \"-o\" ]; then",
      "    output_path=\"$arg\"",
      "  fi",
      "  previous_arg=\"$arg\"",
      "done",
      "if [ \"$count\" = \"1\" ]; then",
      "  printf '%s\\n' 'Error: thread/resume: thread/resume failed: no rollout found for thread id session-stale (code -32600)' >&2",
      "  exit 1",
      "fi",
      "printf '%s' 'fresh codex reply' > \"$output_path\"",
      "printf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"session-fresh\"}'",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(binPath, 0o755);

  const runtime: ProviderRuntimeRecord = {
    id: "runtime-codex-stale-resume-test",
    workspaceId: "default",
    provider: "codex",
    name: "Codex",
    status: "online",
    metadata: {
      executablePath: binPath,
      mode: "remote",
    },
  };

  try {
    const events: Array<{ type: string; content?: string }> = [];
    const result = await runProviderTask(runtime, "continue work", workDir, {
      sessionId: "session-stale",
      contextEnv: {
        CODEX_ARGS_DIR: argsDir,
        CODEX_COUNT_PATH: countPath,
      },
      taskTimeoutMs: 1_000,
      onEvent: (event) => {
        events.push(event);
      },
    });

    const firstArgs = readFileSync(join(argsDir, "invocation-1.txt"), "utf8").trim().split(/\r?\n/);
    const secondArgs = readFileSync(join(argsDir, "invocation-2.txt"), "utf8").trim().split(/\r?\n/);

    assert.equal(result.output, "fresh codex reply");
    assert.equal(result.sessionId, "session-fresh");
    assert.deepEqual(firstArgs.slice(0, 2), ["exec", "resume"]);
    assert.equal(firstArgs.includes("session-stale"), true);
    assert.equal(secondArgs.slice(0, 2).join(" "), "exec --json");
    assert.equal(secondArgs.includes("session-stale"), false);
    assert.equal(secondArgs.includes("--cd"), true);
    assert.equal(events.some((event) => event.type === "status" && event.content?.includes("starting a new conversation")), true);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runProviderTask sends Claude prompts through stream-json stdin", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-claude-stdin-"));
  const binPath = join(workDir, "claude");
  const argsPath = join(workDir, "claude-args.txt");
  const stdinPath = join(workDir, "claude-stdin.json");
  writeFileSync(
    binPath,
    [
      "#!/bin/sh",
      ": > \"$CLAUDE_ARGS_PATH\"",
      "for arg in \"$@\"; do",
      "  printf '%s\\n' \"$arg\" >> \"$CLAUDE_ARGS_PATH\"",
      "done",
      "cat > \"$CLAUDE_STDIN_PATH\"",
      "printf '%s\\n' '{\"type\":\"system\",\"session_id\":\"session-next\"}'",
      "printf '%s\\n' '{\"type\":\"result\",\"result\":\"hello from claude\",\"session_id\":\"session-next\",\"usage\":{\"input_tokens\":3,\"output_tokens\":4}}'",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(binPath, 0o755);

  const runtime: ProviderRuntimeRecord = {
    id: "runtime-claude-test",
    workspaceId: "default",
    provider: "claude",
    name: "Claude",
    status: "online",
    metadata: {
      executablePath: binPath,
      mode: "remote",
    },
  };

  try {
    await withProcessGetuid(1000, async () => {
      const events: Array<{ type: string; inputJson?: Record<string, unknown> }> = [];
      const result = await runProviderTask(runtime, "write a short reply", workDir, {
        contextEnv: {
          CLAUDE_ARGS_PATH: argsPath,
          CLAUDE_STDIN_PATH: stdinPath,
        },
        taskTimeoutMs: 1_000,
        onEvent: (event) => {
          events.push(event);
        },
      });

      const args = readFileSync(argsPath, "utf8").trim().split(/\r?\n/);
      const input = JSON.parse(readFileSync(stdinPath, "utf8")) as {
        type: string;
        message: { role: string; content: Array<{ type: string; text: string }> };
      };

      assert.equal(result.output, "hello from claude");
      assert.equal(result.sessionId, "session-next");
      assert.equal(args.includes("write a short reply"), false);
      assert.deepEqual(args.slice(0, 4), ["-p", "--output-format", "stream-json", "--input-format"]);
      assert.equal(args[4], "stream-json");
      assert.equal(args.includes("--permission-mode"), true);
      assert.equal(args.includes("bypassPermissions"), true);
      assert.equal(args.includes("--dangerously-skip-permissions"), true);
      assert.deepEqual(args.slice(-2), ["--tools", "default"]);
      assert.equal(input.type, "user");
      assert.equal(input.message.role, "user");
      assert.equal(input.message.content[0]?.text, "write a short reply");
      assert.equal(events.some((event) => event.type === "usage" && event.inputJson?.input_tokens === 3), true);
    });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runProviderTask starts a new Claude conversation when resume session is missing", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-claude-stale-resume-"));
  const binPath = join(workDir, "claude");
  const argsDir = join(workDir, "args");
  const countPath = join(workDir, "count.txt");
  mkdirSync(argsDir, { recursive: true });
  writeFileSync(
    binPath,
    [
      "#!/bin/sh",
      "count=0",
      "if [ -f \"$CLAUDE_COUNT_PATH\" ]; then",
      "  count=$(cat \"$CLAUDE_COUNT_PATH\")",
      "fi",
      "count=$((count + 1))",
      "printf '%s' \"$count\" > \"$CLAUDE_COUNT_PATH\"",
      "args_path=\"$CLAUDE_ARGS_DIR/invocation-$count.txt\"",
      ": > \"$args_path\"",
      "for arg in \"$@\"; do",
      "  printf '%s\\n' \"$arg\" >> \"$args_path\"",
      "done",
      "cat > /dev/null",
      "if [ \"$count\" = \"1\" ]; then",
      "  printf '%s\\n' '{\"type\":\"result\",\"session_id\":\"session-stale\",\"errors\":[\"No conversation found with session ID: session-stale\"]}'",
      "  printf '%s\\n' 'No conversation found with session ID: session-stale' >&2",
      "  exit 1",
      "fi",
      "printf '%s\\n' '{\"type\":\"result\",\"result\":\"fresh reply\",\"session_id\":\"session-fresh\",\"usage\":{\"input_tokens\":5,\"output_tokens\":6}}'",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(binPath, 0o755);

  const runtime: ProviderRuntimeRecord = {
    id: "runtime-claude-stale-resume-test",
    workspaceId: "default",
    provider: "claude",
    name: "Claude",
    status: "online",
    metadata: {
      executablePath: binPath,
      mode: "remote",
    },
  };

  try {
    await withProcessGetuid(1000, async () => {
      const events: Array<{ type: string; content?: string }> = [];
      const result = await runProviderTask(runtime, "continue the chat", workDir, {
        sessionId: "session-stale",
        contextEnv: {
          CLAUDE_ARGS_DIR: argsDir,
          CLAUDE_COUNT_PATH: countPath,
        },
        taskTimeoutMs: 1_000,
        onEvent: (event) => {
          events.push(event);
        },
      });

      const firstArgs = readFileSync(join(argsDir, "invocation-1.txt"), "utf8").trim().split(/\r?\n/);
      const secondArgs = readFileSync(join(argsDir, "invocation-2.txt"), "utf8").trim().split(/\r?\n/);

      assert.equal(result.output, "fresh reply");
      assert.equal(result.sessionId, "session-fresh");
      assert.equal(firstArgs.includes("--resume"), true);
      assert.equal(firstArgs.includes("session-stale"), true);
      assert.equal(secondArgs.includes("--resume"), false);
      assert.equal(secondArgs.includes("session-stale"), false);
      assert.equal(events.some((event) => event.type === "status" && event.content?.includes("starting a new conversation")), true);
    });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runProviderTask keeps built-in Claude tool grants narrow when running as root", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-claude-root-permissions-"));
  const providerBinDir = join(workDir, "provider-bin");
  const gwsBinDir = join(workDir, "gws-bin");
  const binPath = join(providerBinDir, "claude");
  const gwsPath = join(gwsBinDir, "gws");
  const argsPath = join(workDir, "claude-args.txt");
  const originalPath = process.env.PATH;
  mkdirSync(providerBinDir, { recursive: true });
  mkdirSync(gwsBinDir, { recursive: true });
  writeFileSync(
    binPath,
    [
      "#!/bin/sh",
      ": > \"$CLAUDE_ARGS_PATH\"",
      "for arg in \"$@\"; do",
      "  printf '%s\\n' \"$arg\" >> \"$CLAUDE_ARGS_PATH\"",
      "done",
      "IFS= read -r _prompt",
      "printf '%s\\n' '{\"type\":\"result\",\"result\":\"root claude ok\",\"session_id\":\"session-root\"}'",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(gwsPath, "#!/bin/sh\necho gws 1.0.0\n", "utf8");
  chmodSync(binPath, 0o755);
  chmodSync(gwsPath, 0o755);

  const runtime: ProviderRuntimeRecord = {
    id: "runtime-claude-root-permissions-test",
    workspaceId: "default",
    provider: "claude",
    name: "Claude",
    status: "online",
    metadata: {
      executablePath: binPath,
      mode: "remote",
    },
  };

  try {
    process.env.PATH = `${providerBinDir}${delimiter}${gwsBinDir}`;
    await withProcessGetuid(0, async () => {
      const result = await runProviderTask(runtime, "hi", workDir, {
        contextEnv: {
          CLAUDE_ARGS_PATH: argsPath,
          GOOGLE_WORKSPACE_CLI_TOKEN: "secret-token",
        },
        taskTimeoutMs: 1_000,
      });
      const args = readFileSync(argsPath, "utf8").trim().split(/\r?\n/);

      assert.equal(result.output, "root claude ok");
      assert.equal(result.sessionId, "session-root");
      assert.equal(args.includes("--permission-mode"), true);
      assert.equal(args.includes("auto"), true);
      assert.equal(args.includes("--allowedTools"), true);
      assert.equal(args.includes("Bash(gws *)"), false);
      assert.equal(args.includes("Bash(gws +*)"), false);
      assert.equal(args.includes("Bash(gws sheets *)"), false);
      assert.equal(args.includes("Bash(gws --version)"), true);
      assert.equal(args.includes("Bash(command -v *)"), true);
      assert.equal(args.includes("Bash(agent-space output *)"), false);
      assert.equal(args.includes("Bash(agent-space output text *)"), true);
      assert.equal(args.includes("Bash(agent-space output attach *)"), true);
      assert.equal(args.includes("Bash(agent-space output document *)"), false);
      assert.equal(args.includes("Bash(agent-space output skill import *)"), false);
      assert.equal(args.includes("Bash(agent-space output sheets-result add *)"), false);
      assert.equal(args.includes("Bash(agent-space output external-document link-google-sheet *)"), false);
      assert.equal(args.includes("Bash(agent-space output permission request-document *)"), false);
      assert.equal(args.includes("Bash(agent-space output google-docs *)"), false);
      assert.equal(args.includes("Bash(*) Read Write Edit Glob Grep"), false);
      assert.equal(args.includes("bypassPermissions"), false);
      assert.equal(args.includes("--dangerously-skip-permissions"), false);
    });
  } finally {
    process.env.PATH = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runProviderTask exposes CLI-Hub runtime app capabilities without adapter-specific code", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-claude-clihub-capability-"));
  const providerBinDir = join(workDir, "provider-bin");
  const toolBinDir = join(workDir, "tool-bin");
  const binPath = join(providerBinDir, "claude");
  const fakeCliPath = join(toolBinDir, "fooctl");
  const argsPath = join(workDir, "claude-args.txt");
  const seenPathFile = join(workDir, "seen-path.txt");
  const originalPath = process.env.PATH;
  mkdirSync(providerBinDir, { recursive: true });
  mkdirSync(toolBinDir, { recursive: true });
  writeFileSync(
    binPath,
    [
      "#!/bin/sh",
      "printf '%s\\n' \"$@\" > \"$CLAUDE_ARGS_PATH\"",
      "printf '%s' \"$PATH\" > \"$SEEN_PATH_FILE\"",
      "IFS= read -r _prompt",
      "printf '%s\\n' '{\"type\":\"result\",\"result\":\"foo ok\",\"session_id\":\"foo-session\"}'",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(fakeCliPath, "#!/bin/sh\necho fooctl ok\n", "utf8");
  chmodSync(binPath, 0o755);
  chmodSync(fakeCliPath, 0o755);

  const runtime: ProviderRuntimeRecord = {
    id: "runtime-claude-clihub-capability-test",
    workspaceId: "default",
    provider: "claude",
    name: "Claude",
    status: "online",
    metadata: {
      executablePath: binPath,
      mode: "remote",
    },
  };

  try {
    process.env.PATH = `${providerBinDir}${delimiter}${toolBinDir}`;
    await withProcessGetuid(0, async () => {
      const result = await runProviderTask(runtime, "use fooctl", workDir, {
        contextEnv: {
          CLAUDE_ARGS_PATH: argsPath,
          SEEN_PATH_FILE: seenPathFile,
        },
        runtimeApps: [{
          source: "clihub_public",
          name: "foo",
          displayName: "Foo CLI",
          entryPoint: "fooctl",
        }],
        taskTimeoutMs: 1_000,
      });
      const args = readFileSync(argsPath, "utf8").trim().split(/\r?\n/);
      const seenPath = readFileSync(seenPathFile, "utf8").split(delimiter);

      assert.equal(result.output, "foo ok");
      assert.equal(result.sessionId, "foo-session");
      assert.equal(seenPath.includes(toolBinDir), true);
      assert.equal(args.includes("Bash(fooctl *)"), true);
      assert.equal(args.includes("Bash(fooctl --help)"), true);
      assert.equal(args.includes("Bash(command -v fooctl)"), true);
    });
  } finally {
    process.env.PATH = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runProviderTask maps missing and unauthorized runtime tool capabilities to distinct provider errors", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-runtime-tool-diagnostics-"));
  const binPath = join(workDir, "codex");
  writeFileSync(binPath, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(binPath, 0o755);

  const runtime: ProviderRuntimeRecord = {
    id: "runtime-tool-diagnostics-test",
    workspaceId: "default",
    provider: "codex",
    name: "Codex",
    status: "online",
    metadata: {
      executablePath: binPath,
      mode: "remote",
    },
  };

  try {
    await assert.rejects(
      () => runProviderTask(runtime, "try denied tool", workDir, {
        runtimeToolCapabilities: [{
          id: "denied-tool",
          command: "denied-tool",
          allowedShellPatterns: ["denied-tool *"],
          source: "workspace",
          status: "denied",
          denialReason: "Agent lacks workspace grant.",
        }],
        taskTimeoutMs: 1_000,
      }),
      (error) => {
        const metadata = readProviderTaskFailureMetadata(error);
        assert.equal(metadata?.providerError?.code, "provider.tool_unauthorized");
        assert.match(metadata?.providerError?.rawProviderMessage ?? "", /workspace grant/);
        return true;
      },
    );

    await assert.rejects(
      () => runProviderTask(runtime, "try missing tool", workDir, {
        runtimeToolCapabilities: [{
          id: "missing-tool",
          command: "missing-tool",
          allowedShellPatterns: ["missing-tool *"],
          diagnosticCommands: ["command -v missing-tool"],
          source: "runtime",
        }],
        taskTimeoutMs: 1_000,
      }),
      (error) => {
        const metadata = readProviderTaskFailureMetadata(error);
        assert.equal(metadata?.providerError?.code, "provider.tool_missing");
        return true;
      },
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runProviderTask routes Hermes through AgentRouter with model, PATH capabilities, and structured errors", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-hermes-provider-"));
  const providerBinDir = join(workDir, "provider-bin");
  const daemonBinDir = join(workDir, "daemon-bin");
  const toolBinDir = join(workDir, "tool-bin");
  const binPath = join(providerBinDir, "hermes");
  const daemonBinPath = join(daemonBinDir, "agent-space-daemon");
  const agentSpacePath = join(daemonBinDir, "agent-space");
  const fakeCliPath = join(toolBinDir, "fake-cli");
  const argsPath = join(workDir, "hermes-args.txt");
  const seenPathFile = join(workDir, "seen-path.txt");
  const originalHermesModel = process.env.HERMES_MODEL;
  const originalDaemonBin = process.env.AGENT_SPACE_DAEMON_BIN;
  mkdirSync(providerBinDir, { recursive: true });
  mkdirSync(daemonBinDir, { recursive: true });
  mkdirSync(toolBinDir, { recursive: true });
  writeFileSync(
    binPath,
    [
      "#!/bin/sh",
      "printf '%s\\n' \"$@\" > \"$HERMES_ARGS_PATH\"",
      "printf '%s' \"$PATH\" > \"$SEEN_PATH_FILE\"",
      "if [ \"$HERMES_FAIL\" = '1' ]; then",
      "  printf '%s\\n' 'Hermes auth failed' >&2",
      "  exit 7",
      "fi",
      "if command -v fake-cli >/dev/null 2>&1; then",
      "  if command -v agent-space >/dev/null 2>&1; then",
      "    printf '%s\\n' 'hermes provider output'",
      "  else",
      "    printf '%s\\n' 'missing agent-space'",
      "  fi",
      "else",
      "  printf '%s\\n' 'missing fake cli'",
      "fi",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(daemonBinPath, "#!/bin/sh\nexit 0\n", "utf8");
  writeFileSync(agentSpacePath, "#!/bin/sh\necho agent-space\n", "utf8");
  writeFileSync(fakeCliPath, "#!/bin/sh\necho fake-cli-ok\n", "utf8");
  chmodSync(binPath, 0o755);
  chmodSync(daemonBinPath, 0o755);
  chmodSync(agentSpacePath, 0o755);
  chmodSync(fakeCliPath, 0o755);

  const runtime: ProviderRuntimeRecord = {
    id: "runtime-hermes-test",
    workspaceId: "default",
    provider: "hermes",
    name: "Hermes",
    status: "online",
    metadata: {
      executablePath: binPath,
      mode: "remote",
    },
  };

  try {
    process.env.AGENT_SPACE_DAEMON_BIN = daemonBinPath;
    process.env.HERMES_MODEL = "nous-hermes";
    const result = await runProviderTask(runtime, "write a short reply", workDir, {
      sessionId: "previous-hermes-session",
      contextEnv: {
        HERMES_ARGS_PATH: argsPath,
        SEEN_PATH_FILE: seenPathFile,
      },
      runtimeToolCapabilities: [{
        id: "fake-cli",
        command: "fake-cli",
        displayName: "Fake CLI",
        binDir: toolBinDir,
        allowedShellPatterns: ["fake-cli *"],
        source: "runtime",
      }],
      taskTimeoutMs: 1_000,
    });
    const args = readFileSync(argsPath, "utf8").trim().split(/\r?\n/);
    const seenPath = readFileSync(seenPathFile, "utf8").split(delimiter);

    assert.equal(result.output, "hermes provider output");
    assert.equal(result.sessionId, undefined);
    assert.deepEqual(args, ["-z", "write a short reply", "--yolo", "--model", "nous-hermes"]);
    assert.equal(seenPath.includes(daemonBinDir), true);
    assert.equal(seenPath.includes(toolBinDir), true);

    await assert.rejects(
      () => runProviderTask(runtime, "fail please", workDir, {
        contextEnv: {
          HERMES_ARGS_PATH: argsPath,
          SEEN_PATH_FILE: seenPathFile,
          HERMES_FAIL: "1",
        },
        taskTimeoutMs: 1_000,
      }),
      (error) => {
        const metadata = readProviderTaskFailureMetadata(error);
        assert.equal(metadata?.providerError?.provider, "hermes");
        assert.equal(metadata?.providerError?.code, "provider.runtime_generic_failure");
        assert.equal(metadata?.providerError?.category, "runtime");
        assert.match(metadata?.providerError?.rawProviderMessage ?? "", /Hermes auth failed/);
        return true;
      },
    );
  } finally {
    if (originalHermesModel === undefined) {
      delete process.env.HERMES_MODEL;
    } else {
      process.env.HERMES_MODEL = originalHermesModel;
    }
    if (originalDaemonBin === undefined) {
      delete process.env.AGENT_SPACE_DAEMON_BIN;
    } else {
      process.env.AGENT_SPACE_DAEMON_BIN = originalDaemonBin;
    }
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runProviderTask routes OpenCode through AgentRouter with model, session, and PATH capabilities", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-opencode-provider-"));
  const providerBinDir = join(workDir, "provider-bin");
  const daemonBinDir = join(workDir, "daemon-bin");
  const toolBinDir = join(workDir, "tool-bin");
  const binPath = join(providerBinDir, "opencode");
  const daemonBinPath = join(daemonBinDir, "agent-space-daemon");
  const fakeCliPath = join(toolBinDir, "fake-cli");
  const argsPath = join(workDir, "opencode-args.txt");
  const seenPathFile = join(workDir, "seen-path.txt");
  const originalOpenCodeModel = process.env.OPENCODE_MODEL;
  const originalDaemonBin = process.env.AGENT_SPACE_DAEMON_BIN;
  mkdirSync(providerBinDir, { recursive: true });
  mkdirSync(daemonBinDir, { recursive: true });
  mkdirSync(toolBinDir, { recursive: true });
  writeFileSync(
    binPath,
    [
      "#!/bin/sh",
      "printf '%s\\n' \"$@\" > \"$OPENCODE_ARGS_PATH\"",
      "printf '%s' \"$PATH\" > \"$SEEN_PATH_FILE\"",
      "if command -v fake-cli >/dev/null 2>&1 && command -v agent-space-daemon >/dev/null 2>&1; then",
      "  printf '%s\\n' '{\"type\":\"step_start\",\"sessionID\":\"opencode-session\",\"part\":{\"text\":\"working\"}}'",
      "  printf '%s\\n' '{\"type\":\"text\",\"sessionID\":\"opencode-session\",\"part\":{\"text\":\"opencode provider output\"}}'",
      "  printf '%s\\n' '{\"type\":\"step_finish\",\"sessionID\":\"opencode-session\",\"part\":{\"tokens\":{\"input\":3,\"output\":4}}}'",
      "else",
      "  printf '%s\\n' 'missing runtime path'",
      "fi",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(daemonBinPath, "#!/bin/sh\nexit 0\n", "utf8");
  writeFileSync(fakeCliPath, "#!/bin/sh\necho fake-cli-ok\n", "utf8");
  chmodSync(binPath, 0o755);
  chmodSync(daemonBinPath, 0o755);
  chmodSync(fakeCliPath, 0o755);

  const runtime: ProviderRuntimeRecord = {
    id: "runtime-opencode-test",
    workspaceId: "default",
    provider: "opencode",
    name: "OpenCode",
    status: "online",
    metadata: {
      executablePath: binPath,
      mode: "remote",
    },
  };

  try {
    process.env.AGENT_SPACE_DAEMON_BIN = daemonBinPath;
    process.env.OPENCODE_MODEL = "openrouter/openai/gpt-4.1";
    const events: Array<{ type: string; content?: string }> = [];
    const result = await runProviderTask(runtime, "write a short reply", workDir, {
      sessionId: "previous-opencode-session",
      contextEnv: {
        OPENCODE_ARGS_PATH: argsPath,
        SEEN_PATH_FILE: seenPathFile,
      },
      runtimeToolCapabilities: [{
        id: "fake-cli",
        command: "fake-cli",
        displayName: "Fake CLI",
        binDir: toolBinDir,
        allowedShellPatterns: ["fake-cli *"],
        source: "runtime",
      }],
      onEvent: (event) => events.push(event),
      taskTimeoutMs: 1_000,
    });
    const args = readFileSync(argsPath, "utf8").trim().split(/\r?\n/);
    const seenPath = readFileSync(seenPathFile, "utf8").split(delimiter);

    assert.equal(result.output, "opencode provider output");
    assert.equal(result.sessionId, "opencode-session");
    assert.deepEqual(args, [
      "run",
      "--format",
      "json",
      "--session",
      "previous-opencode-session",
      "--model",
      "openrouter/openai/gpt-4.1",
      "write a short reply",
    ]);
    assert.equal(seenPath.includes(daemonBinDir), true);
    assert.equal(seenPath.includes(toolBinDir), true);
    assert.equal(events.some((event) => event.type === "usage"), true);
  } finally {
    if (originalOpenCodeModel === undefined) {
      delete process.env.OPENCODE_MODEL;
    } else {
      process.env.OPENCODE_MODEL = originalOpenCodeModel;
    }
    if (originalDaemonBin === undefined) {
      delete process.env.AGENT_SPACE_DAEMON_BIN;
    } else {
      process.env.AGENT_SPACE_DAEMON_BIN = originalDaemonBin;
    }
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runProviderTask maps Hermes capability and empty-response diagnostics to provider errors", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-hermes-diagnostics-"));
  const binPath = join(workDir, "hermes");
  writeFileSync(binPath, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(binPath, 0o755);

  const runtime: ProviderRuntimeRecord = {
    id: "runtime-hermes-diagnostics-test",
    workspaceId: "default",
    provider: "hermes",
    name: "Hermes",
    status: "online",
    metadata: {
      executablePath: binPath,
      mode: "remote",
    },
  };

  try {
    await assert.rejects(
      () => runProviderTask(runtime, "try denied tool", workDir, {
        runtimeToolCapabilities: [{
          id: "denied-tool",
          command: "denied-tool",
          allowedShellPatterns: ["denied-tool *"],
          source: "workspace",
          status: "denied",
          denialReason: "Agent lacks workspace grant.",
        }],
        taskTimeoutMs: 1_000,
      }),
      (error) => {
        const metadata = readProviderTaskFailureMetadata(error);
        assert.equal(metadata?.providerError?.provider, "hermes");
        assert.equal(metadata?.providerError?.code, "provider.tool_unauthorized");
        assert.match(metadata?.providerError?.rawProviderMessage ?? "", /workspace grant/);
        return true;
      },
    );

    await assert.rejects(
      () => runProviderTask(runtime, "try missing tool", workDir, {
        runtimeToolCapabilities: [{
          id: "missing-tool",
          command: "missing-tool",
          allowedShellPatterns: ["missing-tool *"],
          diagnosticCommands: ["command -v missing-tool"],
          source: "runtime",
        }],
        taskTimeoutMs: 1_000,
      }),
      (error) => {
        const metadata = readProviderTaskFailureMetadata(error);
        assert.equal(metadata?.providerError?.provider, "hermes");
        assert.equal(metadata?.providerError?.code, "provider.tool_missing");
        return true;
      },
    );

    await assert.rejects(
      () => runProviderTask(runtime, "empty", workDir, {
        taskTimeoutMs: 1_000,
      }),
      (error) => {
        const metadata = readProviderTaskFailureMetadata(error);
        assert.equal(metadata?.providerError?.provider, "hermes");
        assert.equal(metadata?.providerError?.code, "provider.empty_response");
        return true;
      },
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runProviderTask routes Claude control requests through approval callback under root", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-claude-control-request-"));
  const binPath = join(workDir, "claude");
  const stdinPath = join(workDir, "claude-stdin.jsonl");
  writeFileSync(
    binPath,
    [
      "#!/bin/sh",
      "IFS= read -r first",
      "printf '%s\\n' \"$first\" > \"$CLAUDE_STDIN_PATH\"",
      "printf '%s\\n' '{\"type\":\"control_request\",\"request_id\":\"req-42\",\"request\":{\"subtype\":\"tool_use\",\"tool_name\":\"Bash\",\"input\":{\"command\":\"ls\"}}}'",
      "IFS= read -r second",
      "printf '%s\\n' \"$second\" >> \"$CLAUDE_STDIN_PATH\"",
      "printf '%s\\n' '{\"type\":\"result\",\"result\":\"approved\",\"session_id\":\"session-control\"}'",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(binPath, 0o755);

  const runtime: ProviderRuntimeRecord = {
    id: "runtime-claude-control-request-test",
    workspaceId: "default",
    provider: "claude",
    name: "Claude",
    status: "online",
    metadata: {
      executablePath: binPath,
      mode: "remote",
    },
  };

  try {
    await withProcessGetuid(0, async () => {
      const approvals: Array<{ toolName: string; command?: string }> = [];
      const result = await runProviderTask(runtime, "run ls", workDir, {
        contextEnv: {
          CLAUDE_STDIN_PATH: stdinPath,
        },
        onApprovalRequest: async (request) => {
          approvals.push({
            toolName: request.toolName,
            command: typeof request.toolInput?.command === "string" ? request.toolInput.command : undefined,
          });
          return { decision: "approved" };
        },
        taskTimeoutMs: 1_000,
      });
      const stdinLines = readFileSync(stdinPath, "utf8").trim().split(/\r?\n/);
      const promptInput = JSON.parse(stdinLines[0] ?? "") as { type: string };
      const response = JSON.parse(stdinLines[1] ?? "") as {
        type: string;
        response: {
          request_id: string;
          response: { behavior: string; updatedInput: { command?: string } };
        };
      };

      assert.equal(result.output, "approved");
      assert.equal(result.sessionId, "session-control");
      assert.equal(promptInput.type, "user");
      assert.equal(response.type, "control_response");
      assert.equal(response.response.request_id, "req-42");
      assert.equal(response.response.response.behavior, "allow");
      assert.equal(response.response.response.updatedInput.command, "ls");
      assert.deepEqual(approvals, [{ toolName: "Bash", command: "ls" }]);
    });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runProviderTask asks for approval and retries Claude permission denials under root", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-claude-permission-denial-"));
  const binPath = join(workDir, "claude");
  const argsPath = join(workDir, "claude-args.txt");
  const countPath = join(workDir, "count.txt");
  writeFileSync(
    binPath,
    [
      "#!/bin/sh",
      "count=0",
      "if [ -f \"$CLAUDE_COUNT_PATH\" ]; then",
      "  count=$(cat \"$CLAUDE_COUNT_PATH\")",
      "fi",
      "count=$((count + 1))",
      "printf '%s' \"$count\" > \"$CLAUDE_COUNT_PATH\"",
      "printf '%s\\n' \"-- invocation $count --\" >> \"$CLAUDE_ARGS_PATH\"",
      "for arg in \"$@\"; do",
      "  printf '%s\\n' \"$arg\" >> \"$CLAUDE_ARGS_PATH\"",
      "done",
      "IFS= read -r _prompt",
      "if [ \"$count\" = \"1\" ]; then",
      "  printf '%s\\n' '{\"type\":\"result\",\"result\":\"need approval\",\"session_id\":\"session-denied\",\"permission_denials\":[{\"tool_name\":\"Bash\",\"tool_use_id\":\"tool-1\",\"tool_input\":{\"command\":\"gws +read --help\"}}]}'",
      "else",
      "  printf '%s\\n' '{\"type\":\"result\",\"result\":\"continued after approval\",\"session_id\":\"session-denied\"}'",
      "fi",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(binPath, 0o755);

  const runtime: ProviderRuntimeRecord = {
    id: "runtime-claude-permission-denial-test",
    workspaceId: "default",
    provider: "claude",
    name: "Claude",
    status: "online",
    metadata: {
      executablePath: binPath,
      mode: "remote",
    },
  };

  try {
    await withProcessGetuid(0, async () => {
      const approvals: Array<{ toolName: string; command?: string }> = [];
      const result = await runProviderTask(runtime, "run gws", workDir, {
        contextEnv: {
          CLAUDE_ARGS_PATH: argsPath,
          CLAUDE_COUNT_PATH: countPath,
        },
        onApprovalRequest: async (request) => {
          approvals.push({
            toolName: request.toolName,
            command: typeof request.toolInput?.command === "string" ? request.toolInput.command : undefined,
          });
          return { decision: "approved" };
        },
        taskTimeoutMs: 1_000,
      });
      const args = readFileSync(argsPath, "utf8");

      assert.equal(result.output, "continued after approval");
      assert.equal(result.sessionId, "session-denied");
      assert.deepEqual(approvals, [{ toolName: "Bash", command: "gws +read --help" }]);
      assert.match(args, /--resume\nsession-denied/);
      assert.match(args, /Bash\(gws \+read --help\)/);
    });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runProviderTask uses Claude assistant text as fallback when result event is missing", async () => {
  const fixture = createClaudeRuntimeFixture([
    "#!/bin/sh",
    "cat >/dev/null",
    "printf '%s\\n' '{\"type\":\"assistant\",\"session_id\":\"session-text\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"fallback answer\"}]}}'",
    "",
  ]);

  try {
    await withProcessGetuid(1000, async () => {
      const result = await runProviderTask(fixture.runtime, "summarize", fixture.workDir, {
        taskTimeoutMs: 1_000,
      });

      assert.equal(result.output, "fallback answer");
      assert.equal(result.sessionId, "session-text");
    });
  } finally {
    rmSync(fixture.workDir, { recursive: true, force: true });
  }
});

test("runProviderTask reports Claude usage-only responses with structured diagnostics", async () => {
  const fixture = createClaudeRuntimeFixture([
    "#!/bin/sh",
    "cat >/dev/null",
    "printf '%s\\n' '{\"type\":\"result\",\"session_id\":\"session-usage\",\"usage\":{\"input_tokens\":2,\"output_tokens\":0}}'",
    "",
  ]);

  try {
    await withProcessGetuid(1000, async () => {
      await assert.rejects(
        () => runProviderTask(fixture.runtime, "summarize", fixture.workDir, { taskTimeoutMs: 1_000 }),
        (error) => {
          const metadata = readProviderTaskFailureMetadata(error);
          assert.equal(metadata?.providerError?.code, "provider.empty_response.no_text_event");
          assert.equal(metadata?.sessionId, "session-usage");
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /events=result:1/);
          assert.match(message, /resultEvent=true/);
          assert.match(message, /textEvent=false/);
          return true;
        },
      );
    });
  } finally {
    rmSync(fixture.workDir, { recursive: true, force: true });
  }
});

test("runProviderTask reports Claude non-JSON stdout as a protocol diagnostic", async () => {
  const fixture = createClaudeRuntimeFixture([
    "#!/bin/sh",
    "cat >/dev/null",
    "printf '%s\\n' 'not json output'",
    "",
  ]);

  try {
    await withProcessGetuid(1000, async () => {
      await assert.rejects(
        () => runProviderTask(fixture.runtime, "summarize", fixture.workDir, { taskTimeoutMs: 1_000 }),
        (error) => {
          const metadata = readProviderTaskFailureMetadata(error);
          assert.equal(metadata?.providerError?.code, "provider.protocol_parse_failed");
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /nonJsonLines=1/);
          assert.match(message, /stdoutTail="not json output"/);
          return true;
        },
      );
    });
  } finally {
    rmSync(fixture.workDir, { recursive: true, force: true });
  }
});

test("runProviderTask includes sanitized Claude stderr tail on empty stdout", async () => {
  const fixture = createClaudeRuntimeFixture([
    "#!/bin/sh",
    "cat >/dev/null",
    "printf '%s\\n' 'ANTHROPIC_API_KEY=secret-value failure detail' >&2",
    "",
  ]);

  try {
    await withProcessGetuid(1000, async () => {
      await assert.rejects(
        () => runProviderTask(fixture.runtime, "summarize", fixture.workDir, { taskTimeoutMs: 1_000 }),
        (error) => {
          const metadata = readProviderTaskFailureMetadata(error);
          assert.equal(metadata?.providerError?.code, "provider.empty_response.stdout_empty");
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /stderrTail=.*ANTHROPIC_API_KEY=\[redacted\]/);
          assert.doesNotMatch(message, /secret-value/);
          return true;
        },
      );
    });
  } finally {
    rmSync(fixture.workDir, { recursive: true, force: true });
  }
});

test("runProviderTask reports Claude timeouts with execution diagnostics", async () => {
  const fixture = createClaudeRuntimeFixture([
    "#!/bin/sh",
    "cat >/dev/null",
    "sleep 1",
    "",
  ]);

  try {
    await withProcessGetuid(1000, async () => {
      await assert.rejects(
        () => runProviderTask(fixture.runtime, "summarize", fixture.workDir, { taskTimeoutMs: 20 }),
        (error) => {
          const metadata = readProviderTaskFailureMetadata(error);
          assert.equal(metadata?.providerError?.code, "provider.timeout");
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /claude timed out after 20ms/);
          assert.match(message, /timedOut=true/);
          return true;
        },
      );
    });
  } finally {
    rmSync(fixture.workDir, { recursive: true, force: true });
  }
});

test("runProviderTask allows Claude execution under root", async () => {
  const fixture = createClaudeRuntimeFixture([
    "#!/bin/sh",
    "IFS= read -r _prompt",
    "printf '%s\\n' '{\"type\":\"result\",\"result\":\"root claude ok\",\"session_id\":\"session-root\"}'",
    "",
  ]);
  try {
    await withProcessGetuid(0, async () => {
      const result = await runProviderTask(fixture.runtime, "hi", fixture.workDir, { taskTimeoutMs: 1_000 });
      assert.equal(result.output, "root claude ok");
      assert.equal(result.sessionId, "session-root");
    });
  } finally {
    rmSync(fixture.workDir, { recursive: true, force: true });
  }
});

test("inspectOpenClawDaemonAuthHealth reports missing task auth profiles as broken", () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-openclaw-health-"));

  try {
    const result = inspectOpenClawDaemonAuthHealth({
      workDir,
      env: {},
      homeDir: join(workDir, "home"),
    });

    assert.equal(result.provider, "openclaw");
    assert.equal(result.status, "broken");
    assert.equal(result.usable, false);
    assert.equal(result.error?.code, "provider.profile_missing");
    assert.match(result.error?.message ?? "", /auth profile/i);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

function createClaudeRuntimeFixture(scriptLines: string[]): {
  workDir: string;
  runtime: ProviderRuntimeRecord;
} {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-claude-diagnostics-"));
  const binPath = join(workDir, "claude");
  writeFileSync(binPath, scriptLines.join("\n"), "utf8");
  chmodSync(binPath, 0o755);
  return {
    workDir,
    runtime: {
      id: "runtime-claude-diagnostics-test",
      workspaceId: "default",
      provider: "claude",
      name: "Claude",
      status: "online",
      metadata: {
        executablePath: binPath,
        mode: "remote",
      },
    },
  };
}

async function withProcessGetuid<T>(uid: number, run: () => T | Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process, "getuid");
  Object.defineProperty(process, "getuid", {
    configurable: true,
    writable: true,
    value: () => uid,
  });
  try {
    return await run();
  } finally {
    if (descriptor) {
      Object.defineProperty(process, "getuid", descriptor);
    } else {
      delete (process as typeof process & { getuid?: () => number }).getuid;
    }
  }
}

test("inspectOpenClawDaemonAuthHealth reports missing model mappings separately", () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-openclaw-health-"));

  try {
    mkdirSync(join(workDir, "agent"), { recursive: true });
    writeFileSync(
      join(workDir, "agent", "auth-profiles.json"),
      JSON.stringify({ profiles: { "openrouter:default": { provider: "openrouter" } } }),
      "utf8",
    );

    const result = inspectOpenClawDaemonAuthHealth({
      workDir,
      env: {},
      homeDir: join(workDir, "home"),
    });

    assert.equal(result.status, "broken");
    assert.equal(result.error?.code, "provider.model_unavailable");
    assert.equal(result.error?.category, "model");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("inspectOpenClawDaemonAuthHealth reports usable and degraded states", () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-openclaw-health-"));

  try {
    mkdirSync(join(workDir, "agent"), { recursive: true });
    writeFileSync(
      join(workDir, "agent", "auth-profiles.json"),
      JSON.stringify({ profiles: { "openrouter:default": { provider: "openrouter" } } }),
      "utf8",
    );
    writeFileSync(
      join(workDir, "agent", "models.json"),
      JSON.stringify({ default: "openrouter/google/gemini-3.1-pro-preview" }),
      "utf8",
    );

    const usable = inspectOpenClawDaemonAuthHealth({
      workDir,
      env: {},
      homeDir: join(workDir, "home"),
    });
    assert.equal(usable.status, "healthy");
    assert.equal(usable.usable, true);

    const degraded = inspectOpenClawDaemonAuthHealth({
      env: { OPENCLAW_PROFILE: "default" },
      homeDir: join(workDir, "home"),
    });
    assert.equal(degraded.status, "degraded");
    assert.equal(degraded.usable, true);
    assert.equal(degraded.error?.code, "provider.profile_missing");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("normalizeOpenClawProviderError maps auth and profile failures to structured codes", () => {
  const authFailure = normalizeOpenClawProviderError("HTTP 401: User not found.");
  assert.equal(authFailure?.code, "provider.auth_invalid");
  assert.equal(authFailure?.category, "auth");
  assert.equal(authFailure?.provider, "openclaw");

  const profileFailure = normalizeOpenClawProviderError("openclaw profile default not found");
  assert.equal(profileFailure?.code, "provider.profile_missing");
  assert.equal(profileFailure?.category, "profile");

  const modelFailure = normalizeOpenClawProviderError("model acme/missing not found");
  assert.equal(modelFailure?.code, "provider.model_unavailable");

  const sessionFailure = normalizeOpenClawProviderError("session stale-session not found");
  assert.equal(sessionFailure?.code, "provider.session_invalid");
});

test("runProviderTask returns OpenClaw final text without keyword-classifying it", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-openclaw-task-"));
  const binPath = join(workDir, "openclaw");
  writeFileSync(
    binPath,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"agents\" ]; then",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"agent\" ]; then",
      "  echo 'HTTP 401: User not found.'",
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(binPath, 0o755);

  const runtime: ProviderRuntimeRecord = {
    id: "runtime-openclaw-test",
    workspaceId: "default",
    provider: "openclaw",
    name: "OpenClaw",
    status: "online",
    metadata: {
      executablePath: binPath,
      mode: "local",
    },
  };

  try {
    const result = await runProviderTask(runtime, "hi", workDir, { taskTimeoutMs: 1_000 });
    assert.equal(result.output, "HTTP 401: User not found.");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runProviderTask maps OpenClaw router diagnostics to provider errors", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-openclaw-diagnostic-"));
  const binPath = join(workDir, "openclaw");
  writeFileSync(
    binPath,
    [
      "#!/bin/sh",
      "printf '%s\\n' 'model missing-model not found' >&2",
      "exit 1",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(binPath, 0o755);

  const runtime = createOpenClawRuntime(binPath);

  try {
    await assert.rejects(
      () => runProviderTask(runtime, "hi", workDir, { taskTimeoutMs: 1_000 }),
      (error) => {
        const metadata = readProviderTaskFailureMetadata(error);
        assert.equal(metadata?.providerError?.code, "provider.model_unavailable");
        assert.equal(metadata?.providerError?.category, "model");
        assert.match(metadata?.providerError?.rawProviderMessage ?? "", /missing-model/);
        return true;
      },
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runProviderTask retries OpenClaw when resume session is missing", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-openclaw-stale-session-"));
  const binPath = join(workDir, "openclaw");
  const argsDir = join(workDir, "args");
  const countPath = join(workDir, "count.txt");
  mkdirSync(argsDir, { recursive: true });
  writeFileSync(
    binPath,
    [
      "#!/bin/sh",
      "count=0",
      "if [ -f \"$OPENCLAW_COUNT_PATH\" ]; then count=$(cat \"$OPENCLAW_COUNT_PATH\"); fi",
      "count=$((count + 1))",
      "printf '%s' \"$count\" > \"$OPENCLAW_COUNT_PATH\"",
      "printf '%s\\n' \"$@\" > \"$OPENCLAW_ARGS_DIR/invocation-$count.txt\"",
      "if [ \"$count\" = \"1\" ]; then",
      "  printf '%s\\n' 'session stale-openclaw not found' >&2",
      "  exit 1",
      "fi",
      "if [ \"$1\" = \"agents\" ]; then",
      "  exit 0",
      "fi",
      "printf '%s\\n' '{\"sessionId\":\"fresh-openclaw\",\"message\":{\"content\":\"fresh claw reply\"}}'",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(binPath, 0o755);

  const runtime = createOpenClawRuntime(binPath);

  try {
    const events: Array<{ type: string; content?: string }> = [];
    const result = await runProviderTask(runtime, "continue", workDir, {
      sessionId: "stale-openclaw",
      contextEnv: {
        OPENCLAW_ARGS_DIR: argsDir,
        OPENCLAW_COUNT_PATH: countPath,
      },
      taskTimeoutMs: 1_000,
      onEvent: (event) => events.push(event),
    });
    const firstArgs = readFileSync(join(argsDir, "invocation-1.txt"), "utf8").trim().split(/\r?\n/);
    const secondArgs = readFileSync(join(argsDir, "invocation-2.txt"), "utf8").trim().split(/\r?\n/);

    assert.equal(result.output, "fresh claw reply");
    assert.equal(result.sessionId, "fresh-openclaw");
    assert.equal(firstArgs.includes("--session-id"), true);
    assert.equal(firstArgs.includes("stale-openclaw"), true);
    assert.equal(secondArgs.includes("--session-id"), false);
    assert.equal(secondArgs.includes("agents"), true);
    assert.equal(secondArgs.includes("add"), true);
    const thirdArgs = readFileSync(join(argsDir, "invocation-3.txt"), "utf8").trim().split(/\r?\n/);
    assert.equal(thirdArgs.includes("--agent"), true);
    assert.equal(events.some((event) => event.type === "status" && event.content?.includes("starting a new conversation")), true);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runProviderTask fails OpenClaw daemon preflight before provider launch", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-openclaw-preflight-"));
  const binPath = join(workDir, "openclaw");
  const countPath = join(workDir, "count.txt");
  writeFileSync(binPath, "#!/bin/sh\nprintf '1' > \"$OPENCLAW_COUNT_PATH\"\necho should-not-run\n", "utf8");
  writeFileSync(join(workDir, "task.json"), "{}", "utf8");
  chmodSync(binPath, 0o755);

  const runtime = createOpenClawRuntime(binPath);

  try {
    await assert.rejects(
      () => runProviderTask(runtime, "hi", workDir, {
        contextEnv: {
          OPENCLAW_COUNT_PATH: countPath,
          AGENT_SPACE_CONTEXT_TASK_ID: "task-openclaw",
        },
        taskTimeoutMs: 1_000,
      }),
      (error) => {
        const metadata = readProviderTaskFailureMetadata(error);
        assert.equal(metadata?.providerError?.code, "provider.profile_missing");
        assert.equal(existsSync(countPath), false);
        return true;
      },
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runProviderTask keeps OpenClaw execution on AgentRouter launch shape", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-openclaw-router-only-"));
  const binPath = join(workDir, "openclaw");
  const argsPath = join(workDir, "args.txt");
  writeFileSync(
    binPath,
    [
      "#!/bin/sh",
      "printf '%s\\n' \"$@\" >> \"$OPENCLAW_ARGS_PATH\"",
      "if [ \"$1\" = \"agents\" ]; then exit 0; fi",
      "printf '%s\\n' '{\"sessionId\":\"router-session\",\"message\":{\"content\":\"router only\"}}'",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(binPath, 0o755);

  const runtime = createOpenClawRuntime(binPath);

  try {
    const result = await runProviderTask(runtime, "hi", workDir, {
      contextEnv: { OPENCLAW_ARGS_PATH: argsPath },
      taskTimeoutMs: 1_000,
    });
    const argsText = readFileSync(argsPath, "utf8");

    assert.equal(result.output, "router only");
    assert.match(argsText, /agents\nadd/);
    assert.match(argsText, /agent\n--local/);
    assert.match(argsText, /--json/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

function createOpenClawRuntime(binPath: string): ProviderRuntimeRecord {
  return {
    id: "runtime-openclaw-test",
    workspaceId: "default",
    provider: "openclaw",
    name: "OpenClaw",
    status: "online",
    metadata: {
      executablePath: binPath,
      mode: "local",
    },
  };
}
