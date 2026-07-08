import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildEncryptedSlackCredentials,
  readSlackIntegrationCredentials,
  summarizeSlackStoredCredentials,
} from "../credentials.ts";

test("Slack credentials are encrypted at rest and only summarized for settings", () => {
  const originalRepositoryRoot = process.env.AGENT_SPACE_REPOSITORY_ROOT;
  const originalSlackKey = process.env.AGENT_SPACE_SLACK_CREDENTIAL_ENCRYPTION_KEY;
  const originalIntegrationKey = process.env.AGENT_SPACE_INTEGRATION_CREDENTIAL_ENCRYPTION_KEY;
  const repositoryRoot = mkdtempSync(join(tmpdir(), "agentspace-slack-credentials-"));
  writeFileSync(join(repositoryRoot, "Target.md"), "test\n");

  process.env.AGENT_SPACE_REPOSITORY_ROOT = repositoryRoot;
  delete process.env.AGENT_SPACE_SLACK_CREDENTIAL_ENCRYPTION_KEY;
  process.env.AGENT_SPACE_INTEGRATION_CREDENTIAL_ENCRYPTION_KEY = Buffer
    .from("0123456789abcdef0123456789abcdef", "utf8")
    .toString("base64");

  try {
    const encrypted = buildEncryptedSlackCredentials({
      botToken: "xoxb-super-secret",
      signingSecret: "signing-secret",
      appLevelToken: "xapp-app-secret",
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    const serialized = JSON.stringify(encrypted);
    const integration = {
      encryptedCredentialsJson: serialized,
    } as Parameters<typeof readSlackIntegrationCredentials>[0];

    assert.match(encrypted.botToken, /^v1:[^:]+:[^:]+:[^:]+$/);
    assert.match(encrypted.signingSecret ?? "", /^v1:[^:]+:[^:]+:[^:]+$/);
    assert.match(encrypted.appLevelToken ?? "", /^v1:[^:]+:[^:]+:[^:]+$/);
    assert.match(encrypted.clientId ?? "", /^v1:[^:]+:[^:]+:[^:]+$/);
    assert.match(encrypted.clientSecret ?? "", /^v1:[^:]+:[^:]+:[^:]+$/);
    assert.doesNotMatch(serialized, /xoxb-super-secret|signing-secret|xapp-app-secret|client-id|client-secret/);
    assert.deepEqual(summarizeSlackStoredCredentials(integration), {
      hasBotToken: true,
      hasSigningSecret: true,
      hasAppLevelToken: true,
      hasClientId: true,
      hasClientSecret: true,
    });
    assert.deepEqual(readSlackIntegrationCredentials(integration), {
      botToken: "xoxb-super-secret",
      signingSecret: "signing-secret",
      appLevelToken: "xapp-app-secret",
      clientId: "client-id",
      clientSecret: "client-secret",
    });
  } finally {
    restoreOptionalEnv("AGENT_SPACE_REPOSITORY_ROOT", originalRepositoryRoot);
    restoreOptionalEnv("AGENT_SPACE_SLACK_CREDENTIAL_ENCRYPTION_KEY", originalSlackKey);
    restoreOptionalEnv("AGENT_SPACE_INTEGRATION_CREDENTIAL_ENCRYPTION_KEY", originalIntegrationKey);
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
