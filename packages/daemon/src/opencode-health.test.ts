import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildOpenCodeProviderHealthSnapshot,
  inspectOpenCodeProviderHealth,
  normalizeOpenCodeProviderError,
} from "./opencode-health.ts";

test("normalizeOpenCodeProviderError classifies an auth failure", () => {
  const error = normalizeOpenCodeProviderError(
    "APIError Incorrect API key provided: sk-invalid-key-123. status 401",
  );
  assert.equal(error?.provider, "opencode");
  assert.equal(error?.code, "provider.auth_invalid");
  assert.equal(error?.category, "auth");
});

test("normalizeOpenCodeProviderError redacts API keys from the raw message", () => {
  const error = normalizeOpenCodeProviderError(
    "401 unauthorized: api_key=sk-super-secret-key-abcdef",
  );
  assert.equal(error?.code, "provider.auth_invalid");
  assert.equal(error?.rawProviderMessage.includes("sk-super-secret-key-abcdef"), false);
});

test("normalizeOpenCodeProviderError classifies a model failure", () => {
  const error = normalizeOpenCodeProviderError("Error: model not found: gpt-99-does-not-exist");
  assert.equal(error?.code, "provider.model_unavailable");
  assert.equal(error?.category, "model");
});

test("normalizeOpenCodeProviderError classifies an invalid session", () => {
  const error = normalizeOpenCodeProviderError("session not found: ses_12345");
  assert.equal(error?.code, "provider.session_invalid");
});

test("normalizeOpenCodeProviderError classifies a missing tool", () => {
  const error = normalizeOpenCodeProviderError("bash: command not found");
  assert.equal(error?.code, "provider.tool_missing");
});

test("normalizeOpenCodeProviderError classifies an unauthorized tool", () => {
  const error = normalizeOpenCodeProviderError("tool call rejected: requires approval");
  assert.equal(error?.code, "provider.tool_unauthorized");
});

test("normalizeOpenCodeProviderError classifies a permission denial", () => {
  const error = normalizeOpenCodeProviderError("permission denied when executing command");
  assert.equal(error?.code, "provider.tool_permission_denied");
});

test("normalizeOpenCodeProviderError classifies a protocol parse failure", () => {
  const error = normalizeOpenCodeProviderError("invalid json: unexpected token near end of output");
  assert.equal(error?.code, "provider.protocol_parse_failed");
});

test("normalizeOpenCodeProviderError returns undefined for unclassifiable text", () => {
  assert.equal(normalizeOpenCodeProviderError("Unexpected server error. Check server logs for details."), undefined);
  assert.equal(normalizeOpenCodeProviderError(""), undefined);
  assert.equal(normalizeOpenCodeProviderError("   "), undefined);
});

test("inspectOpenCodeProviderHealth reports broken when auth.json is missing", () => {
  const tmp = mkdtempSync(join(tmpdir(), "opencode-health-missing-"));
  try {
    const health = inspectOpenCodeProviderHealth({ homeDir: tmp, model: "deepseek/deepseek-v4-pro" });
    assert.equal(health.status, "broken");
    assert.equal(health.usable, false);
    assert.equal(health.error?.code, "provider.auth_invalid");
    assert.equal(health.details.hasAuthConfig, false);
    assert.equal(health.details.configuredProviderCount, 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("inspectOpenCodeProviderHealth reports healthy when the model provider is configured", () => {
  const tmp = mkdtempSync(join(tmpdir(), "opencode-health-ok-"));
  try {
    const authDir = join(tmp, ".local", "share", "opencode");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(join(authDir, "auth.json"), JSON.stringify({
      deepseek: { type: "api", key: "sk-test" },
      moonshotai: { type: "oauth" },
    }));

    const health = inspectOpenCodeProviderHealth({ homeDir: tmp, model: "deepseek/deepseek-v4-pro" });
    assert.equal(health.status, "healthy");
    assert.equal(health.usable, true);
    assert.equal(health.details.hasAuthConfig, true);
    assert.equal(health.details.configuredProviderCount, 1);
    assert.equal(health.details.modelProviderConfigured, true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("inspectOpenCodeProviderHealth reports degraded when the model provider is not configured", () => {
  const tmp = mkdtempSync(join(tmpdir(), "opencode-health-degraded-"));
  try {
    const authDir = join(tmp, ".local", "share", "opencode");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(join(authDir, "auth.json"), JSON.stringify({
      deepseek: { type: "api", key: "sk-test" },
    }));

    const health = inspectOpenCodeProviderHealth({ homeDir: tmp, model: "anthropic/claude-sonnet-4-5" });
    assert.equal(health.status, "degraded");
    assert.equal(health.usable, true);
    assert.equal(health.error?.code, "provider.model_unavailable");
    assert.equal(health.details.modelProviderConfigured, false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("buildOpenCodeProviderHealthSnapshot maps a broken health to a snapshot", () => {
  const tmp = mkdtempSync(join(tmpdir(), "opencode-health-snapshot-"));
  try {
    const health = inspectOpenCodeProviderHealth({ homeDir: tmp, model: "deepseek/deepseek-v4-pro" });
    const snapshot = buildOpenCodeProviderHealthSnapshot(health);
    assert.equal(snapshot.status, "broken");
    assert.equal(snapshot.error?.provider, "opencode");
    assert.equal(snapshot.error?.code, "provider.auth_invalid");
    assert.equal(typeof snapshot.reason, "string");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
