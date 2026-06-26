import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildEncryptedFeishuCredentials,
  readFeishuIntegrationCredentials,
  summarizeFeishuStoredCredentials,
} from "../credentials.ts";

test("Feishu credentials are encrypted at rest and only summarized for settings", () => {
  const originalRepositoryRoot = process.env.AGENT_SPACE_REPOSITORY_ROOT;
  const originalFeishuKey = process.env.AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY;
  const repositoryRoot = mkdtempSync(join(tmpdir(), "agentspace-feishu-credentials-"));
  writeFileSync(join(repositoryRoot, "Target.md"), "test\n");

  process.env.AGENT_SPACE_REPOSITORY_ROOT = repositoryRoot;
  process.env.AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY = Buffer
    .from("0123456789abcdef0123456789abcdef", "utf8")
    .toString("base64");

  try {
    const encrypted = buildEncryptedFeishuCredentials({
      appSecret: "super-secret-app-secret",
      verificationToken: "verify-token",
      encryptKey: "encrypt-key",
    });
    const serialized = JSON.stringify(encrypted);
    const integration = {
      encryptedCredentialsJson: serialized,
    } as Parameters<typeof readFeishuIntegrationCredentials>[0];

    assert.match(encrypted.appSecret, /^v1:[^:]+:[^:]+:[^:]+$/);
    assert.match(encrypted.verificationToken, /^v1:[^:]+:[^:]+:[^:]+$/);
    assert.match(encrypted.encryptKey ?? "", /^v1:[^:]+:[^:]+:[^:]+$/);
    assert.doesNotMatch(serialized, /super-secret-app-secret|verify-token|encrypt-key/);
    assert.deepEqual(summarizeFeishuStoredCredentials(integration), {
      hasAppSecret: true,
      hasVerificationToken: true,
      hasEncryptKey: true,
    });
    assert.deepEqual(readFeishuIntegrationCredentials(integration), {
      appSecret: "super-secret-app-secret",
      verificationToken: "verify-token",
      encryptKey: "encrypt-key",
    });
  } finally {
    restoreOptionalEnv("AGENT_SPACE_REPOSITORY_ROOT", originalRepositoryRoot);
    restoreOptionalEnv("AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY", originalFeishuKey);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

function restoreOptionalEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
