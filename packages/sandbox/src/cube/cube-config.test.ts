import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  CUBE_MOUNT_WORKDIR_ENV,
  CUBE_EXPERIMENTAL_ENABLE_ENV,
  LEGACY_CUBE_API_KEY_ENV,
  LEGACY_CUBE_API_URL_ENV,
  LEGACY_CUBE_TEMPLATE_ID_ENV,
  LEGACY_SANDBOX_PROVIDER_ENV,
  SANDBOX_TASK_TIMEOUT_ENV,
  resolveCubeSandboxConfig,
  resolveSandboxProvider,
} from "../index.ts";
import type { SandboxConnectOptions } from "../types.ts";

function buildOptions(env: NodeJS.ProcessEnv = {}): SandboxConnectOptions {
  return {
    runtimeId: "runtime-cube-test",
    workDir: "/tmp/agent-space-cube-test",
    env,
  };
}

function expectedResolvedWorkDir(): string {
  return resolve(buildOptions().workDir);
}

test("resolveSandboxProvider falls back to local and honors legacy provider env", () => {
  assert.equal(resolveSandboxProvider(buildOptions()), "local");
  assert.equal(
    resolveSandboxProvider(buildOptions({
      [LEGACY_SANDBOX_PROVIDER_ENV]: "cube",
      [CUBE_EXPERIMENTAL_ENABLE_ENV]: "true",
    })),
    "cube",
  );
  assert.equal(
    resolveSandboxProvider({
      ...buildOptions(),
      provider: "local",
      env: { [LEGACY_SANDBOX_PROVIDER_ENV]: "cube" },
    }),
    "local",
  );
});

test("resolveSandboxProvider requires an explicit experimental guard for cube", () => {
  assert.throws(
    () => resolveSandboxProvider(buildOptions({ [LEGACY_SANDBOX_PROVIDER_ENV]: "cube" })),
    /AGENT_SPACE_CUBE_ENABLE_EXPERIMENTAL/,
  );
});

test("resolveCubeSandboxConfig reads E2B-compatible env vars and derives timeout seconds", () => {
  const config = resolveCubeSandboxConfig(buildOptions({
    [LEGACY_CUBE_API_URL_ENV]: "http://127.0.0.1:3000/",
    [LEGACY_CUBE_API_KEY_ENV]: "dummy",
    [LEGACY_CUBE_TEMPLATE_ID_ENV]: "tpl-demo",
    [SANDBOX_TASK_TIMEOUT_ENV]: "60000",
  }));

  assert.equal(config.apiUrl, "http://127.0.0.1:3000");
  assert.equal(config.apiKey, "dummy");
  assert.equal(config.templateId, "tpl-demo");
  assert.equal(config.timeoutSeconds, 60);
  assert.equal(config.mountWorkDir, false);
  assert.deepEqual(config.metadata, {
    "agent-space.runtime-id": "runtime-cube-test",
    "agent-space.work-dir": expectedResolvedWorkDir(),
  });
});

test("resolveCubeSandboxConfig prefers AGENT_SPACE_* env names over legacy Cube aliases", () => {
  const config = resolveCubeSandboxConfig(buildOptions({
    AGENT_SPACE_CUBE_API_URL: "http://cube-primary.test",
    AGENT_SPACE_CUBE_API_KEY: "primary-key",
    AGENT_SPACE_CUBE_TEMPLATE_ID: "tpl-primary",
    [LEGACY_CUBE_API_URL_ENV]: "http://cube-legacy.test",
    [LEGACY_CUBE_API_KEY_ENV]: "legacy-key",
    [LEGACY_CUBE_TEMPLATE_ID_ENV]: "tpl-legacy",
  }));

  assert.equal(config.apiUrl, "http://cube-primary.test");
  assert.equal(config.apiKey, "primary-key");
  assert.equal(config.templateId, "tpl-primary");
});

test("resolveCubeSandboxConfig can mount the daemon workDir into the Cube sandbox", () => {
  const config = resolveCubeSandboxConfig(buildOptions({
    [LEGACY_CUBE_API_URL_ENV]: "http://127.0.0.1:3000",
    [LEGACY_CUBE_API_KEY_ENV]: "dummy",
    [LEGACY_CUBE_TEMPLATE_ID_ENV]: "tpl-demo",
    [CUBE_MOUNT_WORKDIR_ENV]: "true",
  }));

  assert.equal(config.mountWorkDir, true);
  assert.equal(config.mountPath, "/workspace");
  assert.equal(config.metadata["agent-space.mount-path"], "/workspace");
  assert.equal(
    config.metadata["host-mount"],
    JSON.stringify([{ hostPath: expectedResolvedWorkDir(), mountPath: "/workspace", readOnly: false }]),
  );
});

test("resolveCubeSandboxConfig rejects missing Cube connection env", () => {
  assert.throws(
    () => resolveCubeSandboxConfig(buildOptions({ [LEGACY_CUBE_API_KEY_ENV]: "dummy" })),
    /AGENT_SPACE_CUBE_API_URL or E2B_API_URL/,
  );
});

test("resolveCubeSandboxConfig rejects invalid explicit Cube timeout seconds", () => {
  assert.throws(
    () => resolveCubeSandboxConfig(buildOptions({
      [LEGACY_CUBE_API_URL_ENV]: "http://127.0.0.1:3000",
      [LEGACY_CUBE_API_KEY_ENV]: "dummy",
      [LEGACY_CUBE_TEMPLATE_ID_ENV]: "tpl-demo",
      AGENT_SPACE_CUBE_TIMEOUT_SECONDS: "0",
    })),
    /AGENT_SPACE_CUBE_TIMEOUT_SECONDS must be a positive integer/,
  );
});
