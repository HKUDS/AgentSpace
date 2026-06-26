import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  readEffectiveRuntimeEnv,
  type ExternalIntegrationRecord,
} from "@agent-space/db";

const FEISHU_CREDENTIAL_VERSION = "v1";

export interface FeishuPlainCredentials {
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
}

interface StoredFeishuCredentials {
  appSecret?: string;
  verificationToken?: string;
  encryptKey?: string;
}

export function buildEncryptedFeishuCredentials(input: FeishuPlainCredentials): Record<string, string> {
  return {
    appSecret: encryptFeishuCredential(input.appSecret),
    ...(input.verificationToken ? { verificationToken: encryptFeishuCredential(input.verificationToken) } : {}),
    ...(input.encryptKey ? { encryptKey: encryptFeishuCredential(input.encryptKey) } : {}),
  };
}

export function readFeishuIntegrationCredentials(
  integration: ExternalIntegrationRecord,
): FeishuPlainCredentials {
  const stored = parseStoredFeishuCredentials(integration.encryptedCredentialsJson);
  return {
    appSecret: stored.appSecret ? decryptFeishuCredential(stored.appSecret) : "",
    verificationToken: stored.verificationToken ? decryptFeishuCredential(stored.verificationToken) : "",
    encryptKey: stored.encryptKey ? decryptFeishuCredential(stored.encryptKey) : undefined,
  };
}

export function summarizeFeishuStoredCredentials(
  integration: ExternalIntegrationRecord,
): {
  hasAppSecret: boolean;
  hasVerificationToken: boolean;
  hasEncryptKey: boolean;
} {
  const stored = parseStoredFeishuCredentials(integration.encryptedCredentialsJson);
  return {
    hasAppSecret: Boolean(stored.appSecret),
    hasVerificationToken: Boolean(stored.verificationToken),
    hasEncryptKey: Boolean(stored.encryptKey),
  };
}

function encryptFeishuCredential(value: string): string {
  const key = readFeishuCredentialEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    FEISHU_CREDENTIAL_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

function decryptFeishuCredential(value: string): string {
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split(":");
  if (
    version !== FEISHU_CREDENTIAL_VERSION ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext
  ) {
    throw new Error("feishu.credential_encryption_invalid");
  }

  const key = readFeishuCredentialEncryptionKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

function readFeishuCredentialEncryptionKey(): Buffer {
  const effectiveEnv = readEffectiveRuntimeEnv();
  const value =
    effectiveEnv.AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY?.trim()
    || effectiveEnv.AGENT_SPACE_INTEGRATION_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!value) {
    throw new Error("AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY is required to store Feishu credentials.");
  }

  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error("AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

function parseStoredFeishuCredentials(value: string): StoredFeishuCredentials {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      appSecret: typeof parsed.appSecret === "string" ? parsed.appSecret : undefined,
      verificationToken: typeof parsed.verificationToken === "string" ? parsed.verificationToken : undefined,
      encryptKey: typeof parsed.encryptKey === "string" ? parsed.encryptKey : undefined,
    };
  } catch {
    return {};
  }
}
