import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const installerPath = join(repoRoot, "deploy", "install-remote-daemon.sh");

test("install script readiness hook passes when agent-space, gws, and bwrap are compatible", () => {
  const binDir = mkdtempSync(join(tmpdir(), "agent-space-install-bin-"));
  try {
    writeExecutable(binDir, "agent-space", [
      "#!/bin/sh",
      "if [ \"$1\" = \"output\" ]; then",
      "  exit 0",
      "fi",
      "exit 1",
      "",
    ].join("\n"));
    writeExecutable(binDir, "gws", "#!/bin/sh\necho gws 1.0.0\n");
    writeExecutable(binDir, "bwrap", [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then",
      "  echo bubblewrap 1.0.0",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"--help\" ]; then",
      "  echo 'usage: bwrap --perms MODE PATH'",
      "  exit 0",
      "fi",
      "exit 1",
      "",
    ].join("\n"));

    const result = runReadinessHook(binDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /readiness checks passed/i);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("install script readiness hook fails when agent-space output is unavailable", () => {
  const binDir = mkdtempSync(join(tmpdir(), "agent-space-install-bin-"));
  try {
    writeExecutable(binDir, "agent-space", "#!/bin/sh\nexit 1\n");
    writeExecutable(binDir, "gws", "#!/bin/sh\necho gws 1.0.0\n");
    writeCompatibleBwrap(binDir);

    const result = runReadinessHook(binDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /agent-space output --help failed/i);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("install script readiness hook warns but passes when gws is missing", () => {
  const binDir = mkdtempSync(join(tmpdir(), "agent-space-install-bin-"));
  try {
    writeAgentSpaceOutput(binDir);
    writeCompatibleBwrap(binDir);

    const result = runReadinessHook(binDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /gws CLI was not found/i);
    assert.match(result.stderr, /Google Workspace features will be unavailable/i);
    assert.match(result.stdout, /readiness checks passed/i);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("install script readiness hook prints gws version failure output but still passes", () => {
  const binDir = mkdtempSync(join(tmpdir(), "agent-space-install-bin-"));
  try {
    writeAgentSpaceOutput(binDir);
    writeExecutable(binDir, "gws", [
      "#!/bin/sh",
      "echo 'GLIBC_2.34 not found' >&2",
      "exit 1",
      "",
    ].join("\n"));
    writeCompatibleBwrap(binDir);

    const result = runReadinessHook(binDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /gws --version failed/i);
    assert.match(result.stderr, /GLIBC_2\.34 not found/i);
    assert.match(result.stderr, /Google Workspace features will be unavailable/i);
    assert.match(result.stdout, /readiness checks passed/i);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

test("install script readiness hook warns but passes when bwrap does not support --perms", () => {
  const binDir = mkdtempSync(join(tmpdir(), "agent-space-install-bin-"));
  try {
    writeAgentSpaceOutput(binDir);
    writeExecutable(binDir, "gws", "#!/bin/sh\necho gws 1.0.0\n");
    writeExecutable(binDir, "bwrap", [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then",
      "  echo bubblewrap 0.9.0",
      "  exit 0",
      "fi",
      "if [ \"$1\" = \"--help\" ]; then",
      "  echo 'usage: bwrap'",
      "  exit 0",
      "fi",
      "exit 1",
      "",
    ].join("\n"));

    const result = runReadinessHook(binDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /does not support --perms/i);
    assert.match(result.stdout, /readiness checks passed/i);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});

for (const useBaseDefaults of [false, true]) {
test(`install script prints installed daemon version${useBaseDefaults ? " using base-dir defaults" : " with explicit paths"}`, () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-install-version-"));
  const packagePath = join(tempRoot, "agent-space-daemon-test.tgz");
  const npmDir = join(tempRoot, "npm-bin");
  const providerBinDir = join(tempRoot, "provider-bin");
  const baseDir = join(tempRoot, "state");
  const installRoot = useBaseDefaults ? join(baseDir, "runtime") : join(tempRoot, "runtime");
  const envFile = join(baseDir, "daemon.env");
  const launcherPath = join(baseDir, "start-daemon.sh");

  try {
    mkdirSync(npmDir, { recursive: true });
    mkdirSync(providerBinDir, { recursive: true });
    writeFileSync(packagePath, "not-a-real-tarball", "utf8");
    writeAgentSpaceOutput(providerBinDir);
    writeExecutable(providerBinDir, "gws", "#!/bin/sh\necho gws 1.0.0\n");
    writeCompatibleBwrap(providerBinDir);
    writeExecutable(npmDir, "npm", [
      "#!/bin/sh",
      "prefix=''",
      "while [ $# -gt 0 ]; do",
      "  if [ \"$1\" = \"--prefix\" ]; then",
      "    prefix=\"$2\"",
      "    shift 2",
      "    continue",
      "  fi",
      "  shift",
      "done",
      "mkdir -p \"$prefix/bin\"",
      "cat > \"$prefix/bin/agent-space-daemon\" <<'DAEMON'",
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then echo 9.8.7-test; exit 0; fi",
      "if [ \"$1\" = \"status\" ]; then echo '{\"running\":true}'; exit 0; fi",
      "if [ \"$1\" = \"stop\" ]; then exit 0; fi",
      "if [ \"$1\" = \"start\" ]; then echo 'Remote daemon started (pid 123).'; exit 0; fi",
      "exit 0",
      "DAEMON",
      "chmod +x \"$prefix/bin/agent-space-daemon\"",
      "cat > \"$prefix/bin/agent-space\" <<'CLI'",
      "#!/bin/sh",
      "if [ \"$1\" = \"output\" ]; then exit 0; fi",
      "exit 1",
      "CLI",
      "chmod +x \"$prefix/bin/agent-space\"",
      "exit 0",
      "",
    ].join("\n"));

    const result = spawnSync("bash", [
      installerPath,
      "--package", packagePath,
      "--server-url", "https://agentspace.example",
      "--daemon-token", "adt_test",
      "--daemon-id", "daemon-test",
      "--base-dir", baseDir,
      ...(useBaseDefaults ? [] : ["--env-file", envFile, "--launcher", launcherPath, "--install-root", installRoot]),
      "--path", `${providerBinDir}:${process.env.PATH ?? ""}`,
    ], {
      env: {
        ...process.env,
        HOME: join(tempRoot, "home"),
        AGENT_SPACE_DAEMON_HOME: "",
        AGENT_SPACE_DAEMON_STATE_DIR: "",
        AGENT_SPACE_DAEMON_INSTALL_ROOT: "",
        AGENT_SPACE_DAEMON_ENV_FILE: "",
        AGENT_SPACE_DAEMON_LAUNCHER: "",
        PATH: `${npmDir}:${process.env.PATH ?? ""}`,
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Installed agent-space-daemon version: 9\.8\.7-test/);
    assert.match(result.stdout, /Version:\n  9\.8\.7-test/);
    assert.equal(existsSync(envFile), true);
    assert.equal(existsSync(launcherPath), true);
    assert.match(readFileSync(envFile, "utf8"), new RegExp(`AGENT_SPACE_DAEMON_STATE_DIR=${escapeRegExp(baseDir)}`));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
}

test("install script installs gws into the daemon runtime when it is missing", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-install-gws-"));
  const packagePath = join(tempRoot, "agent-space-daemon-test.tgz");
  const npmDir = join(tempRoot, "npm-bin");
  const providerBinDir = join(tempRoot, "provider-bin");
  const baseDir = join(tempRoot, "state");
  const installRoot = join(tempRoot, "runtime");
  const envFile = join(baseDir, "daemon.env");
  const launcherPath = join(baseDir, "start-daemon.sh");

  try {
    mkdirSync(npmDir, { recursive: true });
    mkdirSync(providerBinDir, { recursive: true });
    writeFileSync(packagePath, "not-a-real-tarball", "utf8");
    writeCompatibleBwrap(providerBinDir);
    writeExecutable(npmDir, "npm", [
      "#!/bin/sh",
      "prefix=''",
      "pkg=''",
      "while [ $# -gt 0 ]; do",
      "  if [ \"$1\" = \"--prefix\" ]; then",
      "    prefix=\"$2\"",
      "    shift 2",
      "    continue",
      "  fi",
      "  pkg=\"$1\"",
      "  shift",
      "done",
      "printf '%s\\n' \"$pkg\" >> " + shellQuote(join(tempRoot, "npm-packages.txt")),
      "mkdir -p \"$prefix/bin\"",
      "if [ \"$pkg\" = \"@googleworkspace/cli\" ]; then",
      "  cat > \"$prefix/bin/gws\" <<'GWS'",
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then echo gws 1.0.0; exit 0; fi",
      "exit 0",
      "GWS",
      "  chmod +x \"$prefix/bin/gws\"",
      "  exit 0",
      "fi",
      "cat > \"$prefix/bin/agent-space-daemon\" <<'DAEMON'",
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then echo 9.8.7-test; exit 0; fi",
      "if [ \"$1\" = \"status\" ]; then echo '{\"running\":true}'; exit 0; fi",
      "if [ \"$1\" = \"stop\" ]; then exit 0; fi",
      "if [ \"$1\" = \"start\" ]; then echo 'Remote daemon started (pid 123).'; exit 0; fi",
      "exit 0",
      "DAEMON",
      "chmod +x \"$prefix/bin/agent-space-daemon\"",
      "cat > \"$prefix/bin/agent-space\" <<'CLI'",
      "#!/bin/sh",
      "if [ \"$1\" = \"output\" ]; then exit 0; fi",
      "exit 1",
      "CLI",
      "chmod +x \"$prefix/bin/agent-space\"",
      "exit 0",
      "",
    ].join("\n"));

    const result = spawnSync("bash", [
      installerPath,
      "--package", packagePath,
      "--server-url", "https://agentspace.example",
      "--daemon-token", "adt_test",
      "--daemon-id", "daemon-test",
      "--base-dir", baseDir,
      "--env-file", envFile,
      "--launcher", launcherPath,
      "--install-root", installRoot,
      "--path", providerBinDir,
      "--no-start",
    ], {
      env: {
        ...process.env,
        PATH: `${npmDir}:${process.env.PATH ?? ""}`,
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /gws CLI was not found; installing @googleworkspace\/cli/);
    assert.match(readText(join(tempRoot, "npm-packages.txt")), /@googleworkspace\/cli/);
    assert.match(readText(envFile), new RegExp(`PATH=${escapeRegExp(`${installRoot}/bin`)}`));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("install script continues agent install when installed gws cannot run", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-install-gws-fail-"));
  const packagePath = join(tempRoot, "agent-space-daemon-test.tgz");
  const npmDir = join(tempRoot, "npm-bin");
  const providerBinDir = join(tempRoot, "provider-bin");
  const baseDir = join(tempRoot, "state");
  const installRoot = join(tempRoot, "runtime");
  const envFile = join(baseDir, "daemon.env");
  const launcherPath = join(baseDir, "start-daemon.sh");

  try {
    mkdirSync(npmDir, { recursive: true });
    mkdirSync(providerBinDir, { recursive: true });
    writeFileSync(packagePath, "not-a-real-tarball", "utf8");
    writeCompatibleBwrap(providerBinDir);
    writeExecutable(npmDir, "npm", [
      "#!/bin/sh",
      "prefix=''",
      "pkg=''",
      "while [ $# -gt 0 ]; do",
      "  if [ \"$1\" = \"--prefix\" ]; then",
      "    prefix=\"$2\"",
      "    shift 2",
      "    continue",
      "  fi",
      "  pkg=\"$1\"",
      "  shift",
      "done",
      "mkdir -p \"$prefix/bin\"",
      "if [ \"$pkg\" = \"@googleworkspace/cli\" ]; then",
      "  cat > \"$prefix/bin/gws\" <<'GWS'",
      "#!/bin/sh",
      "echo 'GLIBC_2.34 not found' >&2",
      "exit 1",
      "GWS",
      "  chmod +x \"$prefix/bin/gws\"",
      "  exit 0",
      "fi",
      "cat > \"$prefix/bin/agent-space-daemon\" <<'DAEMON'",
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then echo 9.8.7-test; exit 0; fi",
      "if [ \"$1\" = \"status\" ]; then echo '{\"running\":true}'; exit 0; fi",
      "if [ \"$1\" = \"stop\" ]; then exit 0; fi",
      "if [ \"$1\" = \"start\" ]; then echo 'Remote daemon started (pid 123).'; exit 0; fi",
      "exit 0",
      "DAEMON",
      "chmod +x \"$prefix/bin/agent-space-daemon\"",
      "cat > \"$prefix/bin/agent-space\" <<'CLI'",
      "#!/bin/sh",
      "if [ \"$1\" = \"output\" ]; then exit 0; fi",
      "exit 1",
      "CLI",
      "chmod +x \"$prefix/bin/agent-space\"",
      "exit 0",
      "",
    ].join("\n"));

    const result = spawnSync("bash", [
      installerPath,
      "--package", packagePath,
      "--server-url", "https://agentspace.example",
      "--daemon-token", "adt_test",
      "--daemon-id", "daemon-test",
      "--base-dir", baseDir,
      "--env-file", envFile,
      "--launcher", launcherPath,
      "--install-root", installRoot,
      "--path", providerBinDir,
      "--no-start",
    ], {
      env: {
        ...process.env,
        PATH: `${npmDir}:${process.env.PATH ?? ""}`,
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /gws --version failed/i);
    assert.match(result.stderr, /GLIBC_2\.34 not found/i);
    assert.match(result.stderr, /Google Workspace features will be unavailable/i);
    assert.match(result.stdout, /User-space remote daemon bootstrap completed/);
    assert.match(result.stdout, /"gws":\{"available":false/);
    assert.match(readText(envFile), new RegExp(`PATH=${escapeRegExp(`${installRoot}/bin`)}`));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("install script update-existing reinstalls into the existing daemon binary root", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-install-update-root-"));
  const packagePath = join(tempRoot, "agent-space-daemon-test.tgz");
  const npmDir = join(tempRoot, "npm-bin");
  const providerBinDir = join(tempRoot, "provider-bin");
  const baseDir = join(tempRoot, "state");
  const existingRoot = join(tempRoot, "existing-runtime");
  const defaultRoot = join(baseDir, "runtime");
  const envFile = join(baseDir, "daemon.env");
  const launcherPath = join(baseDir, "start-daemon.sh");

  try {
    mkdirSync(npmDir, { recursive: true });
    mkdirSync(providerBinDir, { recursive: true });
    mkdirSync(join(existingRoot, "bin"), { recursive: true });
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(packagePath, "not-a-real-tarball", "utf8");
    writeAgentSpaceOutput(providerBinDir);
    writeExecutable(providerBinDir, "gws", "#!/bin/sh\necho gws 1.0.0\n");
    writeCompatibleBwrap(providerBinDir);
    writeExecutable(join(existingRoot, "bin"), "agent-space-daemon", [
      "#!/bin/sh",
      "if [ \"$1\" = \"stop\" ]; then exit 0; fi",
      "exit 0",
      "",
    ].join("\n"));
    writeFileSync(envFile, [
      "AGENT_SPACE_SERVER_URL=https://agentspace.example",
      "AGENT_SPACE_DAEMON_TOKEN=adt_existing",
      "AGENT_SPACE_DAEMON_ID=daemon-existing",
      "AGENT_SPACE_DEVICE_NAME=device-existing",
      "AGENT_SPACE_RUNTIME_NAME=Remote\\ Agent",
      `AGENT_SPACE_DAEMON_STATE_DIR=${shellQuote(baseDir)}`,
      `AGENT_SPACE_DAEMON_BIN=${shellQuote(join(existingRoot, "bin", "agent-space-daemon"))}`,
      "",
    ].join("\n"), "utf8");
    writeExecutable(npmDir, "npm", [
      "#!/bin/sh",
      "prefix=''",
      "while [ $# -gt 0 ]; do",
      "  if [ \"$1\" = \"--prefix\" ]; then",
      "    prefix=\"$2\"",
      "    shift 2",
      "    continue",
      "  fi",
      "  shift",
      "done",
      "printf '%s\\n' \"$prefix\" > " + shellQuote(join(tempRoot, "npm-prefix.txt")),
      "mkdir -p \"$prefix/bin\"",
      "cat > \"$prefix/bin/agent-space-daemon\" <<'DAEMON'",
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then echo 1.2.3-updated; exit 0; fi",
      "if [ \"$1\" = \"status\" ]; then echo '{\"running\":true}'; exit 0; fi",
      "if [ \"$1\" = \"stop\" ]; then exit 0; fi",
      "if [ \"$1\" = \"start\" ]; then echo 'Remote daemon started (pid 456).'; exit 0; fi",
      "exit 0",
      "DAEMON",
      "chmod +x \"$prefix/bin/agent-space-daemon\"",
      "cat > \"$prefix/bin/agent-space\" <<'CLI'",
      "#!/bin/sh",
      "if [ \"$1\" = \"output\" ]; then exit 0; fi",
      "exit 1",
      "CLI",
      "chmod +x \"$prefix/bin/agent-space\"",
      "exit 0",
      "",
    ].join("\n"));

    const result = spawnSync("bash", [
      installerPath,
      "--update-existing",
      "--package", packagePath,
      "--base-dir", baseDir,
      "--env-file", envFile,
      "--launcher", launcherPath,
      "--path", `${providerBinDir}:${process.env.PATH ?? ""}`,
      "--no-start",
    ], {
      env: {
        ...process.env,
        PATH: `${npmDir}:${process.env.PATH ?? ""}`,
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readText(join(tempRoot, "npm-prefix.txt")).trim(), existingRoot);
    assert.equal(exists(defaultRoot), false);
    const updatedEnv = readText(envFile);
    assert.match(updatedEnv, new RegExp(`AGENT_SPACE_DAEMON_INSTALL_ROOT=${escapeRegExp(existingRoot)}`));
    assert.match(updatedEnv, new RegExp(`AGENT_SPACE_DAEMON_BIN=${escapeRegExp(join(existingRoot, "bin", "agent-space-daemon"))}`));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

function runReadinessHook(binDir: string): SpawnSyncReturns<string> {
  return spawnSync("bash", [installerPath], {
    env: {
      ...process.env,
      AGENT_SPACE_INSTALLER_TEST_HOOK: "verify-google-sheets-readiness",
      AGENT_SPACE_INSTALLER_TEST_PATH: binDir,
    },
    encoding: "utf8",
  });
}

function writeAgentSpaceOutput(binDir: string): void {
  writeExecutable(binDir, "agent-space", [
    "#!/bin/sh",
    "if [ \"$1\" = \"output\" ]; then",
    "  exit 0",
    "fi",
    "exit 1",
    "",
  ].join("\n"));
}

function writeCompatibleBwrap(binDir: string): void {
  writeExecutable(binDir, "bwrap", [
    "#!/bin/sh",
    "if [ \"$1\" = \"--version\" ]; then",
    "  echo bubblewrap 1.0.0",
    "  exit 0",
    "fi",
    "if [ \"$1\" = \"--help\" ]; then",
    "  echo 'usage: bwrap --perms MODE PATH'",
    "  exit 0",
    "fi",
    "exit 1",
    "",
  ].join("\n"));
}

function writeExecutable(binDir: string, name: string, contents: string): void {
  const path = join(binDir, name);
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function exists(path: string): boolean {
  return existsSync(path);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
