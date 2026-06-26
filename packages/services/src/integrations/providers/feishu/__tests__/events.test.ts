import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import test from "node:test";
import {
  decryptFeishuEventPayload,
  isFeishuApprovalCardActionCallbackPayload,
  isFeishuCardActionCallbackPayload,
  resolveFeishuCallbackAppId,
  resolveFeishuCallbackTenantKey,
  validateFeishuCallbackContext,
  verifyFeishuRequestSignature,
} from "../events.ts";

test("decrypts Feishu encrypted event payloads with the official AES-CBC shape", () => {
  const encryptKey = "test encrypt key";
  const payload = {
    schema: "2.0",
    header: {
      token: "verify-token",
      event_id: "evt-encrypted-1",
      event_type: "im.message.receive_v1",
    },
    event: {
      message: {
        message_id: "om-encrypted-1",
      },
    },
  };
  const encryptedPayload = encryptFeishuEventPayloadForTest(encryptKey, payload);

  assert.deepEqual(decryptFeishuEventPayload({
    encryptedPayload,
    encryptKey,
  }), payload);
});

test("verifies Feishu encrypted event request signatures against the raw body", () => {
  const encryptKey = "test encrypt key";
  const timestamp = "1782280800";
  const nonce = "nonce-1";
  const rawBody = JSON.stringify({ encrypt: "encrypted-payload" });
  const signature = createHash("sha256")
    .update(`${timestamp}${nonce}${encryptKey}${rawBody}`, "utf8")
    .digest("hex");

  assert.equal(verifyFeishuRequestSignature({
    timestamp,
    nonce,
    encryptKey,
    rawBody,
    signature,
  }), true);
  assert.equal(verifyFeishuRequestSignature({
    timestamp,
    nonce,
    encryptKey,
    rawBody: `${rawBody}\n`,
    signature,
  }), false);
});

test("identifies Feishu message card action callback payloads", () => {
  assert.equal(isFeishuCardActionCallbackPayload({
    schema: "2.0",
    header: {
      event_type: "card.action.trigger",
    },
    event: {
      action: {
        value: {
          approvalId: "approval-1",
        },
      },
    },
  }), true);
  assert.equal(isFeishuCardActionCallbackPayload({
    schema: "2.0",
    header: {
      event_type: "im.message.message_card.action_v1",
    },
    event: {},
  }), true);
  assert.equal(isFeishuCardActionCallbackPayload({
    schema: "2.0",
    header: {
      event_type: "im.message.receive_v1",
    },
    event: {},
  }), false);
});

test("identifies approval card action callbacks separately from business card actions", () => {
  assert.equal(isFeishuApprovalCardActionCallbackPayload({
    schema: "2.0",
    header: {
      event_type: "card.action.trigger",
    },
    event: {
      action: {
        value: {
          approvalId: "approval-1",
          payloadHash: "hash-1",
          decision: "approved",
        },
      },
    },
  }), true);
  assert.equal(isFeishuApprovalCardActionCallbackPayload({
    schema: "2.0",
    header: {
      event_type: "card.action.trigger",
    },
    event: {
      action: {
        value: {
          action: "refresh_status",
          resourceId: "status-card-1",
        },
      },
    },
  }), false);
  assert.equal(isFeishuApprovalCardActionCallbackPayload({
    schema: "2.0",
    header: {
      event_type: "card.action.trigger",
    },
    event: {
      action: {
        value: JSON.stringify({
          approval_id: "approval-2",
          payload_hash: "hash-2",
        }),
      },
    },
  }), true);
});

test("validates Feishu callback app and tenant context", () => {
  const payload = {
    schema: "2.0",
    header: {
      event_type: "im.message.receive_v1",
      app_id: "cli_test",
      tenant_key: "tenant-1",
    },
    event: {},
  };

  assert.equal(resolveFeishuCallbackAppId(payload), "cli_test");
  assert.equal(resolveFeishuCallbackTenantKey(payload), "tenant-1");
  assert.deepEqual(validateFeishuCallbackContext({
    payload,
    expectedAppId: "cli_test",
    expectedTenantKey: "tenant-1",
  }), { ok: true });
  assert.deepEqual(validateFeishuCallbackContext({
    payload,
    expectedAppId: "cli_other",
  }), {
    ok: false,
    reasonCode: "feishu.callback_app_id_mismatch",
    errorMessage: "Feishu callback app_id does not match this integration.",
  });
  assert.deepEqual(validateFeishuCallbackContext({
    payload: {
      schema: "2.0",
      header: {
        event_type: "im.message.receive_v1",
        app_id: "cli_test",
      },
      event: {},
    },
    expectedAppId: "cli_test",
    expectedTenantKey: "tenant-1",
  }), {
    ok: false,
    reasonCode: "feishu.callback_tenant_key_missing",
    errorMessage: "Feishu callback tenant_key is missing for this tenant-scoped integration.",
  });
  assert.deepEqual(validateFeishuCallbackContext({
    payload,
    expectedTenantKey: "tenant-other",
  }), {
    ok: false,
    reasonCode: "feishu.callback_tenant_key_mismatch",
    errorMessage: "Feishu callback tenant_key does not match this integration.",
  });
});

function encryptFeishuEventPayloadForTest(
  encryptKey: string,
  payload: Record<string, unknown>,
): string {
  const key = createHash("sha256").update(encryptKey, "utf8").digest();
  const iv = Buffer.from("1234567890abcdef", "utf8");
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, ciphertext]).toString("base64");
}
