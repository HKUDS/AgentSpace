import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  detectAgentRouterHarnesses,
  listAgentRouterHarnesses,
  runAgentRouter,
  type AgentRouterEvent,
} from "./agent-router/index.ts";

test("listAgentRouterHarnesses exposes the MVP native harnesses", () => {
  assert.deepEqual(listAgentRouterHarnesses(), [
    { id: "claude", label: "Claude Code" },
    { id: "codex", label: "Codex CLI" },
    { id: "opencode", label: "OpenCode" },
    { id: "openclaw", label: "OpenClaw" },
    { id: "hermes", label: "Hermes Agent" },
  ]);
});

test("detectAgentRouterHarnesses reports available and missing CLIs", async () => {
  const binDir = mkdtempSync(join(tmpdir(), "agent-router-detect-"));
  const originalPath = process.env.PATH;

  try {
    writeExecutable(join(binDir, "claude"), "#!/bin/sh\necho claude 1.2.3\n");
    writeExecutable(join(binDir, "codex"), "#!/bin/sh\necho codex 4.5.6\n");
    writeExecutable(join(binDir, "opencode"), "#!/bin/sh\necho opencode 0.3.0\n");
    writeExecutable(
      join(binDir, "hermes-agent"),
      "#!/bin/sh\nif [ \"$1\" = 'version' ]; then echo hermes 0.2.0; else echo unknown option >&2; exit 2; fi\n",
    );
    process.env.PATH = binDir;

    const detected = await detectAgentRouterHarnesses();
    assert.deepEqual(
      detected.harnesses.map((harness) => ({ id: harness.id, status: harness.status, version: harness.version })),
      [
        { id: "claude", status: "available", version: "claude 1.2.3" },
        { id: "codex", status: "available", version: "codex 4.5.6" },
        { id: "opencode", status: "available", version: "opencode 0.3.0" },
        { id: "openclaw", status: "missing", version: undefined },
        { id: "hermes", status: "available", version: "hermes 0.2.0" },
      ],
    );
  } finally {
    process.env.PATH = originalPath;
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("runAgentRouter launches Hermes in headless text mode with model and runtime tool PATH", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-router-hermes-"));
  const providerBinDir = join(workDir, "provider-bin");
  const toolBinDir = join(workDir, "tool-bin");
  const hermesPath = join(providerBinDir, "hermes");
  const fakeCliPath = join(toolBinDir, "fake-cli");
  const argsPath = join(workDir, "hermes-args.txt");
  const seenPathFile = join(workDir, "seen-path.txt");
  const originalPath = process.env.PATH;

  try {
    writeExecutable(
      hermesPath,
      [
        "#!/bin/sh",
        "printf '%s\\n' \"$@\" > \"$HERMES_ARGS_PATH\"",
        "printf '%s' \"$PATH\" > \"$SEEN_PATH_FILE\"",
        "if command -v fake-cli >/dev/null 2>&1; then",
        "  printf '%s\\n' 'hermes text output'",
        "else",
        "  printf '%s\\n' 'tool missing'",
        "fi",
      ].join("\n"),
    );
    writeExecutable(fakeCliPath, "#!/bin/sh\necho fake-cli-ok\n");
    process.env.PATH = providerBinDir;

    const result = await runAgentRouter({
      version: 1,
      harness: "hermes",
      prompt: "hello hermes",
      cwd: workDir,
      executablePath: hermesPath,
      model: "nous-hermes",
      env: {
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
      timeoutMs: 1_000,
    });
    const args = readFileSync(argsPath, "utf8").trim().split(/\r?\n/);
    const seenPath = readFileSync(seenPathFile, "utf8").split(delimiter);

    assert.equal(result.status, "completed");
    assert.equal(result.outputText, "hermes text output");
    assert.deepEqual(args, ["-z", "hello hermes", "--yolo", "--model", "nous-hermes"]);
    assert.equal(seenPath.includes(toolBinDir), true);
  } finally {
    process.env.PATH = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runAgentRouter returns structured Hermes diagnostics for nonzero and empty responses", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-router-hermes-diagnostics-"));
  const binDir = join(workDir, "bin");
  const hermesPath = join(binDir, "hermes");
  const originalPath = process.env.PATH;

  try {
    writeExecutable(
      hermesPath,
      [
        "#!/bin/sh",
        "if [ \"$HERMES_SLEEP\" = '1' ]; then",
        "  sleep 2",
        "fi",
        "if [ \"$HERMES_EMPTY\" = '1' ]; then",
        "  exit 0",
        "fi",
        "printf '%s\\n' 'auth failed: login required' >&2",
        "exit 42",
      ].join("\n"),
    );
    process.env.PATH = binDir;

    const failed = await runAgentRouter({
      version: 1,
      harness: "hermes",
      prompt: "fail",
      cwd: workDir,
      executablePath: hermesPath,
      timeoutMs: 1_000,
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.diagnostics.some((diagnostic) => diagnostic.code === "harness.exited_nonzero"), true);
    assert.match(failed.diagnostics.find((diagnostic) => diagnostic.code === "harness.exited_nonzero")?.rawProviderMessage ?? "", /login required/);

    const empty = await runAgentRouter({
      version: 1,
      harness: "hermes",
      prompt: "empty",
      cwd: workDir,
      executablePath: hermesPath,
      env: { HERMES_EMPTY: "1" },
      timeoutMs: 1_000,
    });
    assert.equal(empty.status, "failed");
    assert.equal(empty.diagnostics.some((diagnostic) => diagnostic.code === "harness.empty_response"), true);

    const timeout = await runAgentRouter({
      version: 1,
      harness: "hermes",
      prompt: "slow",
      cwd: workDir,
      executablePath: hermesPath,
      env: { HERMES_SLEEP: "1" },
      timeoutMs: 50,
    });
    assert.equal(timeout.status, "timeout");
    assert.equal(timeout.diagnostics.some((diagnostic) => diagnostic.code === "harness.timeout"), true);
  } finally {
    process.env.PATH = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runAgentRouter normalizes Claude stream-json text, tool, session, and result output", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-router-claude-"));
  const binDir = join(workDir, "bin");
  const claudePath = join(binDir, "claude");
  const stdinPath = join(workDir, "stdin.jsonl");
  const argsPath = join(workDir, "args.txt");
  const originalPath = process.env.PATH;

  try {
    writeExecutable(
      claudePath,
      [
        "#!/bin/sh",
        "mkdir -p \"$(dirname \"$CLAUDE_STDIN_PATH\")\"",
        "cat > \"$CLAUDE_STDIN_PATH\"",
        "printf '%s\\n' \"$@\" > \"$CLAUDE_ARGS_PATH\"",
        "printf '%s\\n' '{\"type\":\"assistant\",\"session_id\":\"claude-session\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"thinking\"}]}}'",
        "printf '%s\\n' '{\"type\":\"tool_use\",\"name\":\"Bash\",\"input\":{\"command\":\"pwd\"}}'",
        "printf '%s\\n' '{\"type\":\"tool_result\",\"name\":\"Bash\",\"output\":\"ok\"}'",
        "printf '%s\\n' '{\"type\":\"result\",\"session_id\":\"claude-session\",\"result\":\"final claude text\",\"usage\":{\"input_tokens\":2,\"output_tokens\":3}}'",
      ].join("\n"),
    );
    process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;

    const events: AgentRouterEvent[] = [];
    const result = await runAgentRouter({
      version: 1,
      harness: "claude",
      prompt: "hello claude",
      cwd: workDir,
      model: "sonnet",
      mode: "plan",
      env: {
        CLAUDE_STDIN_PATH: stdinPath,
        CLAUDE_ARGS_PATH: argsPath,
      },
      timeoutMs: 1_000,
    }, {
      emit: (event) => events.push(event),
    });

    assert.equal(result.status, "completed");
    assert.equal(result.outputText, "final claude text");
    assert.equal(result.sessionId, "claude-session");
    assert.equal(events.some((event) => event.type === "tool_started" && event.tool === "Bash"), true);
    assert.equal(events.some((event) => event.type === "tool_finished" && event.tool === "Bash"), true);
    assert.equal(events.some((event) => event.type === "session_updated" && event.sessionId === "claude-session"), true);
    assert.match(readFileSync(stdinPath, "utf8"), /hello claude/);
    assert.deepEqual(readFileSync(argsPath, "utf8").trim().split(/\r?\n/).slice(0, 7), [
      "-p",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--verbose",
      "--model",
    ]);
  } finally {
    process.env.PATH = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runAgentRouter normalizes Codex JSON events, output file, and resume launch", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-router-codex-"));
  const binDir = join(workDir, "bin");
  const codexPath = join(binDir, "codex");
  const argsPath = join(workDir, "args.txt");
  const originalPath = process.env.PATH;

  try {
    writeExecutable(
      codexPath,
      [
        "#!/bin/sh",
        "printf '%s\\n' \"$@\" > \"$CODEX_ARGS_PATH\"",
        "prev=''",
        "for arg in \"$@\"; do",
        "  if [ \"$prev\" = '-o' ]; then",
        "    printf '%s' 'codex file output' > \"$arg\"",
        "  fi",
        "  prev=\"$arg\"",
        "done",
        "printf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"codex-session\"}'",
        "printf '%s\\n' '{\"type\":\"item.started\",\"item\":{\"type\":\"commandExecution\",\"command\":\"pwd\"}}'",
        "printf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"type\":\"commandExecution\",\"aggregatedOutput\":\"/tmp\"}}'",
      ].join("\n"),
    );
    process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;

    const events: AgentRouterEvent[] = [];
    const result = await runAgentRouter({
      version: 1,
      harness: "codex",
      prompt: "continue codex",
      cwd: workDir,
      sessionId: "codex-prev",
      env: { CODEX_ARGS_PATH: argsPath },
      timeoutMs: 1_000,
    }, {
      emit: (event) => events.push(event),
    });

    const args = readFileSync(argsPath, "utf8").trim().split(/\r?\n/);
    assert.equal(result.status, "completed");
    assert.equal(result.outputText, "codex file output");
    assert.equal(result.sessionId, "codex-session");
    assert.deepEqual(args.slice(0, 2), ["exec", "resume"]);
    assert.equal(args.includes("codex-prev"), true);
    assert.equal(args.includes("--cd"), false);
    assert.equal(events.some((event) => event.type === "tool_started" && event.tool === "exec_command"), true);
    assert.equal(events.some((event) => event.type === "tool_output" && event.tool === "exec_command"), true);
  } finally {
    process.env.PATH = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runAgentRouter handles Codex snake_case events without treating successful tool output as auth failure", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-router-codex-snake-"));
  const binDir = join(workDir, "bin");
  const codexPath = join(binDir, "codex");
  const originalPath = process.env.PATH;

  try {
    writeExecutable(
      codexPath,
      [
        "#!/bin/sh",
        "printf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"codex-snake-session\"}'",
        "printf '%s\\n' '{\"type\":\"item.started\",\"item\":{\"type\":\"command_execution\",\"command\":\"gws read\"}}'",
        "printf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"type\":\"command_execution\",\"aggregated_output\":\"docs mention unauthorized 401 api key text, but command succeeded\",\"exit_code\":0,\"status\":\"completed\"}}'",
        "printf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"snake final text\"}}'",
        "printf '%s\\n' '{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":4,\"output_tokens\":5}}'",
      ].join("\n"),
    );
    process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;

    const events: AgentRouterEvent[] = [];
    const result = await runAgentRouter({
      version: 1,
      harness: "codex",
      prompt: "snake codex",
      cwd: workDir,
      timeoutMs: 1_000,
    }, {
      emit: (event) => events.push(event),
    });

    assert.equal(result.status, "completed");
    assert.equal(result.outputText, "snake final text");
    assert.equal(result.sessionId, "codex-snake-session");
    assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === "harness.auth_invalid"), false);
    assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === "harness.auth_required"), false);
    assert.equal(events.some((event) => event.type === "tool_started" && event.tool === "exec_command"), true);
    assert.equal(events.some((event) => event.type === "tool_output" && event.tool === "exec_command"), true);
  } finally {
    process.env.PATH = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runAgentRouter normalizes OpenCode JSON text, session, usage, and launch args", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-router-opencode-"));
  const providerBinDir = join(workDir, "provider-bin");
  const toolBinDir = join(workDir, "tool-bin");
  const opencodePath = join(providerBinDir, "opencode");
  const fakeCliPath = join(toolBinDir, "fake-cli");
  const argsPath = join(workDir, "opencode-args.txt");
  const seenPathFile = join(workDir, "seen-path.txt");
  const originalPath = process.env.PATH;

  try {
    writeExecutable(
      opencodePath,
      [
        "#!/bin/sh",
        "printf '%s\\n' \"$@\" > \"$OPENCODE_ARGS_PATH\"",
        "printf '%s' \"$PATH\" > \"$SEEN_PATH_FILE\"",
        "if ! command -v fake-cli >/dev/null 2>&1; then",
        "  printf '%s\\n' 'missing fake cli' >&2",
        "  exit 3",
        "fi",
        "printf '%s\\n' '{\"type\":\"step_start\",\"sessionID\":\"ses_1\",\"part\":{\"text\":\"thinking\"}}'",
        "printf '%s\\n' '{\"type\":\"text\",\"sessionID\":\"ses_1\",\"part\":{\"text\":\"final answer\"}}'",
        "printf '%s\\n' '{\"type\":\"step_finish\",\"sessionID\":\"ses_1\",\"part\":{\"tokens\":{\"input\":5,\"output\":7}}}'",
      ].join("\n"),
    );
    writeExecutable(fakeCliPath, "#!/bin/sh\necho fake-cli-ok\n");
    process.env.PATH = providerBinDir;

    const events: AgentRouterEvent[] = [];
    const result = await runAgentRouter({
      version: 1,
      harness: "opencode",
      prompt: "hello opencode",
      cwd: workDir,
      executablePath: opencodePath,
      model: "openrouter/openai/gpt-4.1",
      sessionId: "ses_prev",
      env: {
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
      timeoutMs: 1_000,
    }, {
      emit: (event) => events.push(event),
    });
    const args = readFileSync(argsPath, "utf8").trim().split(/\r?\n/);
    const seenPath = readFileSync(seenPathFile, "utf8").split(delimiter);

    assert.equal(result.status, "completed");
    assert.equal(result.outputText, "final answer");
    assert.equal(result.sessionId, "ses_1");
    assert.deepEqual(args, [
      "run",
      "--format",
      "json",
      "--session",
      "ses_prev",
      "--model",
      "openrouter/openai/gpt-4.1",
      "hello opencode",
    ]);
    assert.equal(seenPath.includes(toolBinDir), true);
    assert.equal(events.some((event) => event.type === "session_updated" && event.sessionId === "ses_1"), true);
    assert.equal(events.some((event) => event.type === "thought_delta" && event.text === "thinking"), true);
    assert.equal(events.some((event) => event.type === "text_delta" && event.text === "final answer"), true);
    assert.equal(events.some((event) => event.type === "tool_output" && event.tool === "usage"), true);
  } finally {
    process.env.PATH = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runAgentRouter returns structured OpenCode diagnostics for nonzero, empty, and timeout", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-router-opencode-diagnostics-"));
  const binDir = join(workDir, "bin");
  const opencodePath = join(binDir, "opencode");
  const originalPath = process.env.PATH;

  try {
    writeExecutable(
      opencodePath,
      [
        "#!/bin/sh",
        "if [ \"$OPENCODE_SLEEP\" = '1' ]; then",
        "  sleep 2",
        "fi",
        "if [ \"$OPENCODE_EMPTY\" = '1' ]; then",
        "  exit 0",
        "fi",
        "if [ \"$OPENCODE_INVALID_JSON\" = '1' ]; then",
        "  printf '%s\\n' '{\"type\":\"text\",\"sessionID\":\"ses_partial\",\"part\":{\"text\":\"partial output\"}}'",
        "  printf '%s\\n' '{not-json'",
        "  exit 0",
        "fi",
        "printf '%s\\n' 'OpenCode auth failed' >&2",
        "exit 42",
      ].join("\n"),
    );
    process.env.PATH = binDir;

    const failed = await runAgentRouter({
      version: 1,
      harness: "opencode",
      prompt: "fail",
      cwd: workDir,
      executablePath: opencodePath,
      timeoutMs: 1_000,
    });
    assert.equal(failed.status, "failed");
    assert.equal(failed.diagnostics.some((diagnostic) => diagnostic.code === "harness.exited_nonzero"), true);
    assert.match(failed.diagnostics.find((diagnostic) => diagnostic.code === "harness.exited_nonzero")?.rawProviderMessage ?? "", /OpenCode auth failed/);

    const empty = await runAgentRouter({
      version: 1,
      harness: "opencode",
      prompt: "empty",
      cwd: workDir,
      executablePath: opencodePath,
      env: { OPENCODE_EMPTY: "1" },
      timeoutMs: 1_000,
    });
    assert.equal(empty.status, "failed");
    assert.equal(empty.diagnostics.some((diagnostic) => diagnostic.code === "harness.empty_response"), true);

    const partialInvalid = await runAgentRouter({
      version: 1,
      harness: "opencode",
      prompt: "partial-invalid",
      cwd: workDir,
      executablePath: opencodePath,
      env: { OPENCODE_INVALID_JSON: "1" },
      timeoutMs: 1_000,
    });
    assert.equal(partialInvalid.status, "completed");
    assert.equal(partialInvalid.outputText, "partial output");
    assert.equal(partialInvalid.diagnostics.some((diagnostic) => diagnostic.code === "harness.protocol_parse_failed"), true);

    const timeout = await runAgentRouter({
      version: 1,
      harness: "opencode",
      prompt: "slow",
      cwd: workDir,
      executablePath: opencodePath,
      env: { OPENCODE_SLEEP: "1" },
      timeoutMs: 50,
    });
    assert.equal(timeout.status, "timeout");
    assert.equal(timeout.diagnostics.some((diagnostic) => diagnostic.code === "harness.timeout"), true);
  } finally {
    process.env.PATH = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runAgentRouter includes daemon and Google Workspace CLIs in provider PATH", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-router-provider-path-"));
  const providerBinDir = join(workDir, "provider-bin");
  const daemonBinDir = join(workDir, "daemon-runtime", "bin");
  const gwsBinDir = join(workDir, "gws-bin");
  const codexPath = join(providerBinDir, "codex");
  const daemonPath = join(daemonBinDir, "agent-space");
  const gwsPath = join(gwsBinDir, "gws");
  const seenPathFile = join(workDir, "seen-path.txt");
  const originalDaemonBin = process.env.AGENT_SPACE_DAEMON_BIN;
  const originalPath = process.env.PATH;

  try {
    mkdirSync(providerBinDir, { recursive: true });
    mkdirSync(daemonBinDir, { recursive: true });
    mkdirSync(gwsBinDir, { recursive: true });
    writeExecutable(
      codexPath,
      [
        "#!/bin/sh",
        "printf '%s' \"$PATH\" > \"$SEEN_PATH_FILE\"",
        "prev=''",
        "for arg in \"$@\"; do",
        "  if [ \"$prev\" = '-o' ]; then",
        "    if command -v agent-space >/dev/null 2>&1 && command -v gws >/dev/null 2>&1; then",
        "      printf '%s' 'path ok' > \"$arg\"",
        "    else",
        "      printf '%s' 'path missing' > \"$arg\"",
        "    fi",
        "  fi",
        "  prev=\"$arg\"",
        "done",
      ].join("\n"),
    );
    writeExecutable(daemonPath, "#!/bin/sh\nexit 0\n");
    writeExecutable(gwsPath, "#!/bin/sh\nexit 0\n");

    process.env.PATH = `${providerBinDir}${delimiter}${gwsBinDir}`;
    process.env.AGENT_SPACE_DAEMON_BIN = join(daemonBinDir, "agent-space-daemon");

    const result = await runAgentRouter({
      version: 1,
      harness: "codex",
      prompt: "check path",
      cwd: workDir,
      executablePath: codexPath,
      env: {
        PATH: providerBinDir,
        SEEN_PATH_FILE: seenPathFile,
      },
      runtimeToolCapabilities: [{
        id: "google-workspace",
        command: "gws",
        displayName: "Google Workspace",
        binDir: gwsBinDir,
        allowedShellPatterns: ["gws *"],
        source: "builtin",
      }],
      timeoutMs: 1_000,
    });
    const seenPath = readFileSync(seenPathFile, "utf8").split(delimiter);

    assert.equal(result.status, "completed");
    assert.equal(result.outputText, "path ok");
    assert.equal(seenPath[0], providerBinDir);
    assert.equal(seenPath.includes(daemonBinDir), true);
    assert.equal(seenPath.includes(gwsBinDir), true);
  } finally {
    if (originalDaemonBin === undefined) {
      delete process.env.AGENT_SPACE_DAEMON_BIN;
    } else {
      process.env.AGENT_SPACE_DAEMON_BIN = originalDaemonBin;
    }
    process.env.PATH = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runAgentRouter translates fake runtime tool capabilities into PATH, Claude allowedTools, and diagnostics", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-router-tool-capability-"));
  const providerBinDir = join(workDir, "provider-bin");
  const toolBinDir = join(workDir, "tool-bin");
  const claudePath = join(providerBinDir, "claude");
  const fakeCliPath = join(toolBinDir, "fake-cli");
  const argsPath = join(workDir, "claude-args.txt");
  const seenPathFile = join(workDir, "seen-path.txt");
  const originalPath = process.env.PATH;

  try {
    writeExecutable(
      claudePath,
      [
        "#!/bin/sh",
        "printf '%s\\n' \"$@\" > \"$CLAUDE_ARGS_PATH\"",
        "printf '%s' \"$PATH\" > \"$SEEN_PATH_FILE\"",
        "if command -v fake-cli >/dev/null 2>&1; then",
        "  fake-cli smoke >/dev/null",
        "fi",
        "cat >/dev/null",
        "printf '%s\\n' '{\"type\":\"result\",\"session_id\":\"cap-session\",\"result\":\"cap ok\"}'",
      ].join("\n"),
    );
    writeExecutable(fakeCliPath, "#!/bin/sh\nprintf '%s\\n' fake-cli-ok\n");
    process.env.PATH = providerBinDir;

    const result = await runAgentRouter({
      version: 1,
      harness: "claude",
      prompt: "use fake cli",
      cwd: workDir,
      executablePath: claudePath,
      env: {
        CLAUDE_ARGS_PATH: argsPath,
        SEEN_PATH_FILE: seenPathFile,
      },
      allowedTools: ["Read"],
      runtimeToolCapabilities: [{
        id: "fake-cli",
        command: "fake-cli",
        displayName: "Fake CLI",
        binDir: toolBinDir,
        allowedShellPatterns: ["fake-cli *", "fake-cli status"],
        diagnosticCommands: ["command -v fake-cli", "fake-cli smoke"],
        source: "runtime",
      }],
      timeoutMs: 1_000,
    });
    const args = readFileSync(argsPath, "utf8").trim().split(/\r?\n/);
    const seenPath = readFileSync(seenPathFile, "utf8").split(delimiter);

    assert.equal(result.status, "completed");
    assert.equal(result.outputText, "cap ok");
    assert.equal(seenPath.includes(toolBinDir), true);
    assert.equal(args.includes("--allowedTools"), true);
    assert.equal(args.includes("Bash(fake-cli *)"), true);
    assert.equal(args.includes("Bash(fake-cli status)"), true);
    assert.equal(result.diagnostics.some((diagnostic) =>
      diagnostic.code === "harness.tool_available" &&
      diagnostic.message.includes("fake-cli smoke")
    ), true);
  } finally {
    process.env.PATH = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runAgentRouter distinguishes denied and missing runtime tool capabilities before provider launch", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-router-tool-denied-"));
  const binDir = join(workDir, "bin");
  const codexPath = join(binDir, "codex");
  const originalPath = process.env.PATH;

  try {
    writeExecutable(codexPath, "#!/bin/sh\nexit 0\n");
    process.env.PATH = binDir;

    const denied = await runAgentRouter({
      version: 1,
      harness: "codex",
      prompt: "try tool",
      cwd: workDir,
      executablePath: codexPath,
      runtimeToolCapabilities: [{
        id: "denied-tool",
        command: "denied-tool",
        allowedShellPatterns: ["denied-tool *"],
        diagnosticCommands: ["command -v denied-tool"],
        source: "workspace",
        status: "denied",
        denialReason: "Agent lacks workspace grant.",
      }],
      timeoutMs: 1_000,
    });
    assert.equal(denied.status, "failed");
    assert.equal(denied.diagnostics[0]?.code, "harness.tool_unauthorized");
    assert.match(denied.diagnostics[0]?.rawProviderMessage ?? "", /workspace grant/);

    const missing = await runAgentRouter({
      version: 1,
      harness: "codex",
      prompt: "try missing",
      cwd: workDir,
      executablePath: codexPath,
      runtimeToolCapabilities: [{
        id: "missing-tool",
        command: "missing-tool",
        allowedShellPatterns: ["missing-tool *"],
        diagnosticCommands: ["command -v missing-tool"],
        source: "runtime",
      }],
      timeoutMs: 1_000,
    });
    assert.equal(missing.status, "failed");
    assert.equal(missing.diagnostics[0]?.code, "harness.tool_missing");
  } finally {
    process.env.PATH = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runAgentRouter reports Claude provider permission denials as tool_permission_denied diagnostics", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-router-claude-tool-denial-"));
  const binDir = join(workDir, "bin");
  const claudePath = join(binDir, "claude");
  const originalPath = process.env.PATH;

  try {
    writeExecutable(
      claudePath,
      [
        "#!/bin/sh",
        "cat >/dev/null",
        "printf '%s\\n' '{\"type\":\"result\",\"session_id\":\"denied-session\",\"result\":\"need permission\",\"permission_denials\":[{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"fake-cli status\"}}]}'",
      ].join("\n"),
    );
    process.env.PATH = binDir;

    const result = await runAgentRouter({
      version: 1,
      harness: "claude",
      prompt: "try fake cli",
      cwd: workDir,
      executablePath: claudePath,
      allowedTools: ["Read"],
      timeoutMs: 1_000,
    });

    assert.equal(result.status, "failed");
    assert.equal(result.diagnostics.some((diagnostic) =>
      diagnostic.code === "harness.tool_permission_denied" &&
      diagnostic.message.includes("fake-cli status")
    ), true);
    assert.equal(result.events.some((event) =>
      event.type === "approval_requested" &&
      event.contentPreview.includes("fake-cli status")
    ), true);
  } finally {
    process.env.PATH = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runAgentRouter normalizes OpenClaw JSON output and nonzero diagnostics", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-router-openclaw-"));
  const binDir = join(workDir, "bin");
  const openClawPath = join(binDir, "openclaw");
  const argsPath = join(workDir, "args.txt");
  const originalPath = process.env.PATH;

  try {
    writeExecutable(
      openClawPath,
      [
        "#!/bin/sh",
        "printf '%s\\n' \"$@\" > \"$OPENCLAW_ARGS_PATH\"",
        "if [ \"$OPENCLAW_FAIL_AUTH\" = '1' ]; then",
        "  printf '%s\\n' '401 unauthorized: login required' >&2",
        "  exit 1",
        "fi",
        "printf '%s\\n' '{\"sessionId\":\"openclaw-session\",\"message\":{\"content\":\"openclaw text\"},\"usage\":{\"inputTokens\":5,\"outputTokens\":8}}'",
      ].join("\n"),
    );
    process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;

    const ok = await runAgentRouter({
      version: 1,
      harness: "openclaw",
      prompt: "hello claw",
      cwd: workDir,
      model: "openclaw-model",
      mode: "medium",
      env: { OPENCLAW_ARGS_PATH: argsPath, OPENCLAW_PROFILE: "test-profile" },
      timeoutMs: 1_000,
    });
    const args = readFileSync(argsPath, "utf8").trim().split(/\r?\n/);

    assert.equal(ok.status, "completed");
    assert.equal(ok.outputText, "openclaw text");
    assert.equal(ok.sessionId, "openclaw-session");
    assert.deepEqual(args.slice(0, 2), ["--profile", "test-profile"]);
    assert.equal(args.includes("--thinking"), true);

    const failed = await runAgentRouter({
      version: 1,
      harness: "openclaw",
      prompt: "hello claw",
      cwd: workDir,
      env: { OPENCLAW_ARGS_PATH: argsPath, OPENCLAW_FAIL_AUTH: "1" },
      timeoutMs: 1_000,
    });

    assert.equal(failed.status, "failed");
    assert.equal(failed.diagnostics.some((diagnostic) => diagnostic.code === "harness.auth_invalid"), true);
    assert.equal(failed.diagnostics.some((diagnostic) => diagnostic.code === "harness.exited_nonzero"), true);
    assert.match(failed.diagnostics.find((diagnostic) => diagnostic.code === "harness.auth_invalid")?.rawProviderMessage ?? "", /unauthorized/);
  } finally {
    process.env.PATH = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runAgentRouter performs OpenClaw daemon preflight before CLI launch", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-router-openclaw-preflight-"));
  const binDir = join(workDir, "bin");
  const openClawPath = join(binDir, "openclaw");
  const countPath = join(workDir, "count.txt");
  const originalPath = process.env.PATH;

  try {
    writeExecutable(
      openClawPath,
      [
        "#!/bin/sh",
        "count=0",
        "if [ -f \"$OPENCLAW_COUNT_PATH\" ]; then count=$(cat \"$OPENCLAW_COUNT_PATH\"); fi",
        "count=$((count + 1))",
        "printf '%s' \"$count\" > \"$OPENCLAW_COUNT_PATH\"",
        "printf '%s\\n' '{\"sessionId\":\"should-not-run\",\"message\":{\"content\":\"ran\"}}'",
      ].join("\n"),
    );
    writeFileSync(join(workDir, "task.json"), "{}", "utf8");
    process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;

    const result = await runAgentRouter({
      version: 1,
      harness: "openclaw",
      prompt: "hello claw",
      cwd: workDir,
      executablePath: openClawPath,
      openClawEphemeralAgent: true,
      env: {
        OPENCLAW_COUNT_PATH: countPath,
        AGENT_SPACE_CONTEXT_TASK_ID: "task-openclaw",
      },
      timeoutMs: 1_000,
    });

    assert.equal(result.status, "failed");
    assert.equal(result.diagnostics[0]?.code, "harness.profile_missing");
    assert.equal(existsSync(countPath), false);
  } finally {
    process.env.PATH = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runAgentRouter maps OpenClaw model, session, tool, and protocol diagnostics", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-router-openclaw-diagnostics-"));
  const binDir = join(workDir, "bin");
  const openClawPath = join(binDir, "openclaw");
  const originalPath = process.env.PATH;

  try {
    writeExecutable(
      openClawPath,
      [
        "#!/bin/sh",
        "case \"$OPENCLAW_SCENARIO\" in",
        "  model) printf '%s\\n' 'model missing-model not found' >&2; exit 1 ;;",
        "  session) printf '%s\\n' 'session stale-session not found' >&2; exit 1 ;;",
        "  tool) printf '%s\\n' 'tool fake-cli not found in PATH' >&2; exit 1 ;;",
        "  invalid) printf '%s\\n' '{ invalid json'; exit 0 ;;",
        "esac",
        "printf '%s\\n' '{\"sessionId\":\"ok\",\"message\":{\"content\":\"ok\"}}'",
      ].join("\n"),
    );
    process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;

    const model = await runAgentRouter({
      version: 1,
      harness: "openclaw",
      prompt: "hi",
      cwd: workDir,
      executablePath: openClawPath,
      env: { OPENCLAW_SCENARIO: "model" },
      timeoutMs: 1_000,
    });
    assert.equal(model.diagnostics.some((diagnostic) => diagnostic.code === "harness.model_unavailable"), true);

    const session = await runAgentRouter({
      version: 1,
      harness: "openclaw",
      prompt: "hi",
      cwd: workDir,
      executablePath: openClawPath,
      sessionId: "stale-session",
      env: { OPENCLAW_SCENARIO: "session" },
      timeoutMs: 1_000,
    });
    assert.equal(session.diagnostics.some((diagnostic) => diagnostic.code === "harness.session_missing"), true);

    const tool = await runAgentRouter({
      version: 1,
      harness: "openclaw",
      prompt: "hi",
      cwd: workDir,
      executablePath: openClawPath,
      env: { OPENCLAW_SCENARIO: "tool" },
      timeoutMs: 1_000,
    });
    assert.equal(tool.diagnostics.some((diagnostic) => diagnostic.code === "harness.tool_missing"), true);

    const invalid = await runAgentRouter({
      version: 1,
      harness: "openclaw",
      prompt: "hi",
      cwd: workDir,
      executablePath: openClawPath,
      env: { OPENCLAW_SCENARIO: "invalid" },
      timeoutMs: 1_000,
    });
    assert.equal(invalid.status, "failed");
    assert.equal(invalid.diagnostics.some((diagnostic) => diagnostic.code === "harness.protocol_parse_failed"), true);
  } finally {
    process.env.PATH = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runAgentRouter redacts OpenClaw secrets from diagnostics", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-router-openclaw-redaction-"));
  const binDir = join(workDir, "bin");
  const openClawPath = join(binDir, "openclaw");
  const originalPath = process.env.PATH;

  try {
    writeExecutable(
      openClawPath,
      [
        "#!/bin/sh",
        "printf '%s\\n' '401 unauthorized OPENCLAW_API_KEY=supersecret-token Authorization: Bearer anothersecret' >&2",
        "exit 1",
      ].join("\n"),
    );
    process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;

    const result = await runAgentRouter({
      version: 1,
      harness: "openclaw",
      prompt: "hi",
      cwd: workDir,
      executablePath: openClawPath,
      env: { OPENCLAW_API_KEY: "supersecret-token" },
      timeoutMs: 1_000,
    });
    const raw = result.diagnostics.map((diagnostic) => `${diagnostic.rawProviderMessage ?? ""}\n${diagnostic.stderrTail ?? ""}`).join("\n");

    assert.equal(raw.includes("supersecret-token"), false);
    assert.equal(raw.includes("anothersecret"), false);
    assert.match(raw, /redacted/);
  } finally {
    process.env.PATH = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runAgentRouter returns timeout and empty-response diagnostics", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-router-diagnostics-"));
  const binDir = join(workDir, "bin");
  const claudePath = join(binDir, "claude");
  const codexPath = join(binDir, "codex");
  const originalPath = process.env.PATH;

  try {
    writeExecutable(claudePath, "#!/bin/sh\nsleep 2\n");
    writeExecutable(codexPath, "#!/bin/sh\nexit 0\n");
    process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;

    const timeout = await runAgentRouter({
      version: 1,
      harness: "claude",
      prompt: "slow",
      cwd: workDir,
      timeoutMs: 50,
    });
    assert.equal(timeout.status, "timeout");
    assert.equal(timeout.diagnostics[0]?.code, "harness.timeout");

    const empty = await runAgentRouter({
      version: 1,
      harness: "codex",
      prompt: "empty",
      cwd: workDir,
      timeoutMs: 1_000,
    });
    assert.equal(empty.status, "failed");
    assert.equal(empty.diagnostics.some((diagnostic) => diagnostic.code === "harness.empty_response"), true);
  } finally {
    process.env.PATH = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("agent-router CLI emits JSONL events and result in --json-events mode", () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-router-cli-"));
  const binDir = join(workDir, "bin");
  const codexPath = join(binDir, "codex");
  const originalPath = process.env.PATH;

  try {
    writeExecutable(
      codexPath,
      [
        "#!/bin/sh",
        "prev=''",
        "for arg in \"$@\"; do",
        "  if [ \"$prev\" = '-o' ]; then",
        "    printf '%s' 'cli codex output' > \"$arg\"",
        "  fi",
        "  prev=\"$arg\"",
        "done",
        "printf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"cli-session\"}'",
      ].join("\n"),
    );
    process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;

    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        join(process.cwd(), "packages/daemon/src/agent-router/cli.ts"),
        "run",
        "--harness",
        "codex",
        "--cwd",
        workDir,
        "--json-events",
        "ping",
      ],
      { encoding: "utf8", env: process.env },
    );
    const lines = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(lines.some((line) => line.type === "harness_started"), true);
    assert.equal(lines.at(-1)?.type, "result");
    assert.equal(lines.at(-1)?.status, "completed");
    assert.equal(lines.at(-1)?.outputText, "cli codex output");
  } finally {
    process.env.PATH = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("agent-router CLI emits Hermes result JSONL in --json-events mode", () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-router-cli-hermes-"));
  const binDir = join(workDir, "bin");
  const hermesPath = join(binDir, "hermes");
  const originalPath = process.env.PATH;

  try {
    writeExecutable(
      hermesPath,
      [
        "#!/bin/sh",
        "printf '%s\\n' 'cli hermes output'",
      ].join("\n"),
    );
    process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;

    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        join(process.cwd(), "packages/daemon/src/agent-router/cli.ts"),
        "run",
        "--harness",
        "hermes",
        "--cwd",
        workDir,
        "--json-events",
        "ping",
      ],
      { encoding: "utf8", env: process.env },
    );
    const lines = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(lines.some((line) => line.type === "harness_started"), true);
    assert.equal(lines.at(-1)?.type, "result");
    assert.equal(lines.at(-1)?.status, "completed");
    assert.equal(lines.at(-1)?.outputText, "cli hermes output");
  } finally {
    process.env.PATH = originalPath;
    rmSync(workDir, { recursive: true, force: true });
  }
});

function writeExecutable(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  chmodSync(path, 0o755);
}
