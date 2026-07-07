import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  readEffectiveRuntimeEnv,
  type ExternalIntegrationRecord,
} from "@agent-space/db";

const SLACK_CREDENTIAL_VERSION = "v1";

export interface SlackPlainCredentials {
  botToken: string;
  signingSecret?: string;
  appLevelToken?: string;
  clientId?: string;
  clientSecret?: string;
}

interface StoredSlackCredentials {
  botToken?: string;
  signingSecret?: string;
  appLevelToken?: string;
  clientId?: string;
  clientSecret?: string;
}

export function buildEncryptedSlackCredentials(input: SlackPlainCredentials): Record<string, string> {
  return {
    botToken: encryptSlackCredential(input.botToken),
    ...(input.signingSecret ? { signingSecret: encryptSlackCredential(input.signingSecret) } : {}),
    ...(input.appLevelToken ? { appLevelToken: encryptSlackCredential(input.appLevelToken) } : {}),
    ...(input.clientId ? { clientId: encryptSlackCredential(input.clientId) } : {}),
    ...(input.clientSecret ? { clientSecret: encryptSlackCredential(input.clientSecret) } : {}),
  };
}

export function readSlackIntegrationCredentials(
  integration: ExternalIntegrationRecord,
): SlackPlainCredentials {
  const stored = parseStoredSlackCredentials(integration.encryptedCredentialsJson);
  return {
    botToken: stored.botToken ? decryptSlackCredential(stored.botToken) : "",
    signingSecret: stored.signingSecret ? decryptSlackCredential(stored.signingSecret) : "",
    appLevelToken: stored.appLevelToken ? decryptSlackCredential(stored.appLevelToken) : "",
    clientId: stored.clientId ? decryptSlackCredential(stored.clientId) : "",
    clientSecret: stored.clientSecret ? decryptSlackCredential(stored.clientSecret) : "",
  };
}

export function summarizeSlackStoredCredentials(
  integration: ExternalIntegrationRecord,
): {
  hasBotToken: boolean;
  hasSigningSecret: boolean;
  hasAppLevelToken: boolean;
  hasClientId: boolean;
  hasClientSecret: boolean;
} {
  const stored = parseStoredSlackCredentials(integration.encryptedCredentialsJson);
  return {
    hasBotToken: Boolean(stored.botToken),
    hasSigningSecret: Boolean(stored.signingSecret),
    hasAppLevelToken: Boolean(stored.appLevelToken),
    hasClientId: Boolean(stored.clientId),
    hasClientSecret: Boolean(stored.clientSecret),
  };
}

function encryptSlackCredential(value: string): string {
  const key = readSlackCredentialEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SLACK_CREDENTIAL_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

function decryptSlackCredential(value: string): string {
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split(":");
  if (
    version !== SLACK_CREDENTIAL_VERSION ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext
  ) {
    throw new Error("slack.credential_encryption_invalid");
  }

  const key = readSlackCredentialEncryptionKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

function readSlackCredentialEncryptionKey(): Buffer {
  const effectiveEnv = readEffectiveRuntimeEnv();
  const value =
    effectiveEnv.AGENT_SPACE_SLACK_CREDENTIAL_ENCRYPTION_KEY?.trim()
    || effectiveEnv.AGENT_SPACE_INTEGRATION_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!value) {
    throw new Error("AGENT_SPACE_SLACK_CREDENTIAL_ENCRYPTION_KEY is required to store Slack credentials.");
  }

  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error("AGENT_SPACE_SLACK_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

function parseStoredSlackCredentials(value: string): StoredSlackCredentials {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      botToken: typeof parsed.botToken === "string" ? parsed.botToken : undefined,
      signingSecret: typeof parsed.signingSecret === "string" ? parsed.signingSecret : undefined,
      appLevelToken: typeof parsed.appLevelToken === "string" ? parsed.appLevelToken : undefined,
      clientId: typeof parsed.clientId === "string" ? parsed.clientId : undefined,
      clientSecret: typeof parsed.clientSecret === "string" ? parsed.clientSecret : undefined,
    };
  } catch {
    return {};
  }
}
