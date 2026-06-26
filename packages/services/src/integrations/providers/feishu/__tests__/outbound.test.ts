import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { MessageAttachment } from "@agent-space/domain/workspace";
import { createIntegrationProviderError } from "../../../core/index.ts";
import type { FeishuApiClient, FeishuApiRequest, FeishuMultipartUploadRequest } from "../client.ts";
import {
  buildFeishuAttachmentOutboundMessage,
  buildFeishuAgentStatusCard,
  buildFeishuFileUploadRequest,
  buildFeishuImageUploadRequest,
  buildFeishuInteractiveCardOutboundMessage,
  buildFeishuMessageCreateRequest,
  buildFeishuOutboundMessagePolicyInput,
  buildFeishuTextOutboundMessages,
  computeFeishuOutboxNextAttemptAt,
  computeFeishuOutboxRetryDelaySeconds,
  decideFeishuOutboundMessagePolicy,
  formatFeishuOutboundError,
  normalizeFeishuOutboundError,
  resolveFeishuOutboundFileKey,
  resolveFeishuOutboundImageKey,
  resolveFeishuReplyTargetExternalMessageId,
  resolveFeishuOutboundMessageId,
  sendFeishuOutboxPayload,
  splitFeishuTextMessageChunks,
} from "../outbound.ts";

const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-feishu-outbound-pure-"));

test("buildFeishuMessageCreateRequest moves receive id type into query", () => {
  const request = buildFeishuMessageCreateRequest({
    receive_id_type: "chat_id",
    receive_id: "oc_general",
    msg_type: "text",
    content: JSON.stringify({ text: "hello" }),
  });

  assert.deepEqual(request, {
    method: "POST",
    path: "/open-apis/im/v1/messages",
    query: {
      receive_id_type: "chat_id",
    },
    body: {
      receive_id: "oc_general",
      msg_type: "text",
      content: JSON.stringify({ text: "hello" }),
    },
  });
});

test("buildFeishuMessageCreateRequest replies to a source Feishu message when present", () => {
  const request = buildFeishuMessageCreateRequest({
    receive_id_type: "chat_id",
    receive_id: "oc_general",
    reply_to_message_id: "om_source_1",
    msg_type: "text",
    content: JSON.stringify({ text: "reply" }),
  });

  assert.deepEqual(request, {
    method: "POST",
    path: "/open-apis/im/v1/messages/om_source_1/reply",
    body: {
      msg_type: "text",
      content: JSON.stringify({ text: "reply" }),
    },
  });
});

test("buildFeishuTextOutboundMessages splits long replies while preserving the Feishu thread target", () => {
  const messages = buildFeishuTextOutboundMessages({
    targetExternalChatId: "oc_general",
    targetExternalThreadId: "om_source_1",
    text: "第一段内容 second paragraph with enough text to split",
    maxTextBytes: 28,
  });

  assert.ok(messages.length > 1);
  for (const message of messages) {
    assert.equal(message.targetExternalChatId, "oc_general");
    assert.equal(message.targetExternalThreadId, "om_source_1");
    assert.equal(message.payload.reply_to_message_id, "om_source_1");
    assert.equal(message.payload.receive_id, "oc_general");
    assert.equal(message.payload.msg_type, "text");
  }

  const reconstructed = messages.map((message) => {
    const content = JSON.parse(String(message.payload.content)) as { text: string };
    return content.text.replace(/^\[\d+\/\d+\]\n/, "");
  }).join("");
  assert.equal(reconstructed, "第一段内容 second paragraph with enough text to split");
});

test("buildFeishuAttachmentOutboundMessage stores only attachment metadata for deferred upload", () => {
  const outbound = buildFeishuAttachmentOutboundMessage({
    targetExternalChatId: "oc_general",
    targetExternalThreadId: "om_source_1",
    attachment: createAttachment({
      id: "att-chart",
      fileName: "chart.png",
      mediaType: "image/png",
      kind: "image",
      storedPath: "/tmp/chart.png",
      storageUrl: "https://storage.example/signed-chart.png?X-Amz-Signature=secret",
    }),
  });

  assert.equal(outbound.targetExternalChatId, "oc_general");
  assert.equal(outbound.targetExternalThreadId, "om_source_1");
  assert.deepEqual(outbound.payload, {
    agent_space_payload_kind: "agent_space_feishu_attachment_v1",
    receive_id_type: "chat_id",
    receive_id: "oc_general",
    reply_to_message_id: "om_source_1",
    attachment: {
      id: "att-chart",
      fileName: "chart.png",
      mediaType: "image/png",
      sizeBytes: 5,
      kind: "image",
      storedPath: "/tmp/chart.png",
      storageProvider: "local",
      storageBucket: undefined,
      storageRegion: undefined,
      storageEndpoint: undefined,
      storageKey: undefined,
      sha256: undefined,
    },
  });
  assert.equal(JSON.stringify(outbound.payload).includes("signed-chart.png"), false);
  assert.equal(JSON.stringify(outbound.payload).includes("X-Amz-Signature"), false);
});

test("buildFeishuAgentStatusCard wraps status cards as Feishu interactive messages", () => {
  const card = buildFeishuAgentStatusCard({
    status: "complete",
    channelName: "general",
    agentNames: ["Atlas", "Atlas", "Nova"],
    message: "Finished the itinerary and saved the summary.",
    actionUrl: "https://agentspace.test/w/northstar/im?focus=channel%3Ageneral",
    taskId: "task-123",
  });
  const outbound = buildFeishuInteractiveCardOutboundMessage({
    targetExternalChatId: "oc_general",
    targetExternalThreadId: "om_root",
    card,
  });

  assert.equal(outbound.targetExternalChatId, "oc_general");
  assert.equal(outbound.targetExternalThreadId, "om_root");
  assert.equal(outbound.payload.msg_type, "interactive");
  assert.equal(outbound.payload.receive_id, "oc_general");
  assert.equal(outbound.payload.reply_to_message_id, "om_root");

  const parsed = JSON.parse(String(outbound.payload.content)) as {
    header: { template: string; title: { content: string } };
    elements: Array<{
      content?: string;
      actions?: Array<{ url?: string; text?: { content?: string } }>;
    }>;
  };
  assert.equal(parsed.header.template, "green");
  assert.equal(parsed.header.title.content, "AgentSpace · Complete");
  assert.match(parsed.elements[0]?.content ?? "", /\*\*Atlas, Nova\*\* · Complete/);
  assert.match(parsed.elements[0]?.content ?? "", /Channel: general/);
  assert.match(parsed.elements[0]?.content ?? "", /Task: task-123/);
  assert.equal(parsed.elements[1]?.actions?.[0]?.text?.content, "Open AgentSpace");
  assert.equal(parsed.elements[1]?.actions?.[0]?.url, "https://agentspace.test/w/northstar/im?focus=channel%3Ageneral");
});

test("buildFeishuAgentStatusCard adds safe approval action values", () => {
  const card = buildFeishuAgentStatusCard({
    status: "approval_required",
    channelName: "general",
    agentNames: ["Atlas"],
    message: "Atlas requested sheets.update_range on Feishu Sheet.",
    approvalAction: {
      approvalId: "approval-1",
      payloadHash: "hash-1",
      token: "short-token",
    },
  });

  const actionElement = (card.elements as Array<{
    actions?: Array<{
      text?: { content?: string };
      value?: Record<string, string>;
    }>;
  }>).find((element) => element.actions);
  assert.deepEqual(actionElement?.actions?.map((action) => ({
    label: action.text?.content,
    value: action.value,
  })), [
    {
      label: "Approve",
      value: {
        approvalId: "approval-1",
        decision: "approved",
        payloadHash: "hash-1",
        token: "short-token",
      },
    },
    {
      label: "Reject",
      value: {
        approvalId: "approval-1",
        decision: "rejected",
        payloadHash: "hash-1",
        token: "short-token",
      },
    },
  ]);
  assert.equal(JSON.stringify(card).includes("operationRequest"), false);
});

test("builds Feishu image and file upload requests", () => {
  assert.deepEqual(buildFeishuImageUploadRequest({
    fileName: "chart.png",
    mediaType: "image/png",
    contentBytes: Buffer.from("image"),
  }), {
    method: "POST",
    path: "/open-apis/im/v1/images",
    fields: {
      image_type: "message",
    },
    file: {
      fieldName: "image",
      fileName: "chart.png",
      mediaType: "image/png",
      contentBytes: Buffer.from("image"),
    },
  });

  assert.deepEqual(buildFeishuFileUploadRequest({
    fileName: "brief.pdf",
    mediaType: "application/pdf",
    contentBytes: Buffer.from("pdf"),
  }), {
    method: "POST",
    path: "/open-apis/im/v1/files",
    fields: {
      file_type: "pdf",
      file_name: "brief.pdf",
    },
    file: {
      fieldName: "file",
      fileName: "brief.pdf",
      mediaType: "application/pdf",
      contentBytes: Buffer.from("pdf"),
    },
  });
});

test("resolveFeishuReplyTargetExternalMessageId uses the inbound thread before falling back to message id", () => {
  assert.equal(resolveFeishuReplyTargetExternalMessageId({
    externalThreadId: " om_root ",
    externalMessageId: "om_source",
  }), "om_root");
  assert.equal(resolveFeishuReplyTargetExternalMessageId({
    externalThreadId: undefined,
    externalMessageId: " om_source ",
  }), "om_source");
  assert.equal(resolveFeishuReplyTargetExternalMessageId({
    externalThreadId: " ",
    externalMessageId: " ",
  }), undefined);
  assert.equal(resolveFeishuReplyTargetExternalMessageId(null), undefined);
});

test("buildFeishuOutboundMessagePolicyInput summarizes external sends without message content", () => {
  const payloadJson = JSON.stringify({
    receive_id_type: "chat_id",
    receive_id: "oc_general",
    reply_to_message_id: "om_source_1",
    msg_type: "text",
    content: JSON.stringify({ text: "secret customer update" }),
  });
  const policyInput = buildFeishuOutboundMessagePolicyInput({
    context: {
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      provider: "feishu",
    },
    outbox: {
      targetExternalChatId: "oc_general",
      targetExternalThreadId: "om_source_1",
      agentSpaceMessageId: "message-1",
      payloadJson,
    },
  });

  assert.equal(policyInput.action.type, "external_message.send");
  assert.equal(policyInput.action.provider, "feishu");
  assert.equal(policyInput.action.resourceType, "feishu.chat");
  assert.equal(policyInput.action.resourceId, "oc_general");
  assert.equal(policyInput.action.riskLevel, "low");
  assert.equal(policyInput.action.operationSummary, "Send Feishu text reply to a bound chat.");
  assert.equal(JSON.stringify(policyInput).includes("secret customer update"), false);

  const policy = decideFeishuOutboundMessagePolicy({
    context: {
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      provider: "feishu",
    },
    outbox: {
      targetExternalChatId: "oc_general",
      targetExternalThreadId: "om_source_1",
      agentSpaceMessageId: "message-1",
      payloadJson,
    },
  });
  assert.equal(policy.decision.decision, "allow");
  assert.equal(policy.decision.reasonCode, "agent_action.low_risk_external_message_send_allowed");
});

test("splitFeishuTextMessageChunks keeps UTF-8 characters intact and labels chunks", () => {
  const chunks = splitFeishuTextMessageChunks("飞书消息🙂需要分片", 20);

  assert.ok(chunks.length > 1);
  assert.match(chunks[0] ?? "", /^\[1\/\d+\]\n/);
  assert.equal(chunks.map((chunk) => chunk.replace(/^\[\d+\/\d+\]\n/, "")).join(""), "飞书消息🙂需要分片");
});

test("sendFeishuOutboxPayload returns Feishu message id from API response", async () => {
  const requests: FeishuApiRequest[] = [];
  const client: FeishuApiClient = {
    async request(input) {
      requests.push(input);
      return {
        code: 0,
        msg: "ok message_id=om_sent_1",
        data: {
          message_id: "om_sent_1",
        },
      };
    },
  };

  const result = await sendFeishuOutboxPayload({
    client,
    payloadJson: JSON.stringify({
      receive_id_type: "chat_id",
      receive_id: "oc_general",
      msg_type: "text",
      content: JSON.stringify({ text: "hello" }),
    }),
  });

  assert.equal(result.externalMessageId, "om_sent_1");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.path, "/open-apis/im/v1/messages");
  assert.equal(result.safeResponseSummary.code, 0);
  assert.equal(result.safeResponseSummary.messageRedacted, true);
  assert.equal(typeof result.safeResponseSummary.messageReference, "string");
  const serializedSummary = JSON.stringify(result.safeResponseSummary);
  assert.equal(serializedSummary.includes("om_sent_1"), false);
  assert.equal(serializedSummary.includes("ok message_id"), false);
});

test("sendFeishuOutboxPayload uploads image attachments before sending image messages", async () => {
  const storedPath = writeTempAttachmentFile("chart.png", "image-bytes");
  const payload = buildFeishuAttachmentOutboundMessage({
    targetExternalChatId: "oc_general",
    targetExternalThreadId: "om_source_1",
    attachment: createAttachment({
      id: "att-chart",
      fileName: "chart.png",
      mediaType: "image/png",
      kind: "image",
      storedPath,
      sizeBytes: Buffer.byteLength("image-bytes"),
    }),
  }).payload;
  const uploads: FeishuMultipartUploadRequest[] = [];
  const requests: FeishuApiRequest[] = [];
  const client: FeishuApiClient = {
    async upload(input) {
      uploads.push(input);
      return {
        code: 0,
        msg: "ok image_key=img_v3_chart",
        data: {
          image_key: "img_v3_chart",
        },
      };
    },
    async request(input) {
      requests.push(input);
      return {
        code: 0,
        msg: "ok message_id=om_image_reply",
        data: {
          message_id: "om_image_reply",
        },
      };
    },
  };

  const result = await sendFeishuOutboxPayload({ client, payloadJson: payload });

  assert.equal(result.externalMessageId, "om_image_reply");
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0]?.path, "/open-apis/im/v1/images");
  assert.equal(uploads[0]?.fields?.image_type, "message");
  assert.equal(uploads[0]?.file.fieldName, "image");
  assert.equal(Buffer.from(uploads[0]?.file.contentBytes ?? []).toString("utf8"), "image-bytes");
  assert.deepEqual(requests, [{
    method: "POST",
    path: "/open-apis/im/v1/messages/om_source_1/reply",
    body: {
      msg_type: "image",
      content: JSON.stringify({ image_key: "img_v3_chart" }),
    },
  }]);
  const imageUploadSummary = result.safeResponseSummary.upload as Record<string, unknown>;
  const imageSendSummary = result.safeResponseSummary.send as Record<string, unknown>;
  assert.deepEqual(result.safeResponseSummary, {
    attachmentId: "att-chart",
    attachmentFileName: "chart.png",
    upload: {
      msgType: "image",
      imageKeyReference: imageUploadSummary.imageKeyReference,
    },
    send: {
      code: 0,
      messageRedacted: true,
      messageReference: imageSendSummary.messageReference,
    },
  });
  assert.equal(typeof imageUploadSummary.imageKeyReference, "string");
  assert.equal(String(imageUploadSummary.imageKeyReference).startsWith("ref_"), true);
  assert.equal(typeof imageSendSummary.messageReference, "string");
  const serializedSummary = JSON.stringify(result.safeResponseSummary);
  assert.equal(serializedSummary.includes("img_v3_chart"), false);
  assert.equal(serializedSummary.includes("om_image_reply"), false);
  assert.equal(serializedSummary.includes("ok message_id"), false);
});

test("sendFeishuOutboxPayload uploads unsupported image media as file messages", async () => {
  const storedPath = writeTempAttachmentFile("diagram.svg", "<svg />");
  const payload = buildFeishuAttachmentOutboundMessage({
    targetExternalChatId: "oc_general",
    attachment: createAttachment({
      id: "att-svg",
      fileName: "diagram.svg",
      mediaType: "image/svg+xml",
      kind: "image",
      storedPath,
      sizeBytes: Buffer.byteLength("<svg />"),
    }),
  }).payload;
  const uploads: FeishuMultipartUploadRequest[] = [];
  const requests: FeishuApiRequest[] = [];
  const client: FeishuApiClient = {
    async upload(input) {
      uploads.push(input);
      return {
        code: 0,
        msg: "ok file_key=file_v3_svg",
        data: {
          file_key: "file_v3_svg",
        },
      };
    },
    async request(input) {
      requests.push(input);
      return {
        code: 0,
        msg: "ok message_id=om_file_reply",
        data: {
          message_id: "om_file_reply",
        },
      };
    },
  };

  const result = await sendFeishuOutboxPayload({ client, payloadJson: payload });

  assert.equal(result.externalMessageId, "om_file_reply");
  assert.equal(uploads[0]?.path, "/open-apis/im/v1/files");
  assert.equal(uploads[0]?.fields?.file_type, "stream");
  assert.deepEqual(requests[0], {
    method: "POST",
    path: "/open-apis/im/v1/messages",
    query: {
      receive_id_type: "chat_id",
    },
    body: {
      receive_id: "oc_general",
      msg_type: "file",
      content: JSON.stringify({ file_key: "file_v3_svg" }),
    },
  });
  const fileUploadSummary = result.safeResponseSummary.upload as Record<string, unknown>;
  const fileSendSummary = result.safeResponseSummary.send as Record<string, unknown>;
  assert.deepEqual(result.safeResponseSummary, {
    attachmentId: "att-svg",
    attachmentFileName: "diagram.svg",
    upload: {
      msgType: "file",
      fileKeyReference: fileUploadSummary.fileKeyReference,
    },
    send: {
      code: 0,
      messageRedacted: true,
      messageReference: fileSendSummary.messageReference,
    },
  });
  assert.equal(typeof fileUploadSummary.fileKeyReference, "string");
  assert.equal(typeof fileSendSummary.messageReference, "string");
  const serializedSummary = JSON.stringify(result.safeResponseSummary);
  assert.equal(serializedSummary.includes("file_v3_svg"), false);
  assert.equal(serializedSummary.includes("om_file_reply"), false);
  assert.equal(serializedSummary.includes("ok message_id"), false);
});

test("sendFeishuOutboxPayload fails when Feishu response has no message id", async () => {
  const client: FeishuApiClient = {
    async request() {
      return { code: 0, msg: "ok", data: {} };
    },
  };

  await assert.rejects(
    sendFeishuOutboxPayload({
      client,
      payloadJson: {
        receive_id: "oc_general",
        msg_type: "text",
        content: JSON.stringify({ text: "hello" }),
      },
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "feishu.outbound.missing_message_id" &&
      /message id/.test(error.message),
  );
});

test("sendFeishuOutboxPayload normalizes rejected Feishu API responses", async () => {
  const client: FeishuApiClient = {
    async request() {
      return {
        code: 99991663,
        msg: "permission denied: missing im:message scope app_secret=secret-value Bearer tenant-token-secret",
        data: {},
      };
    },
  };

  await assert.rejects(
    sendFeishuOutboxPayload({
      client,
      payloadJson: {
        receive_id: "oc_general",
        msg_type: "text",
        content: JSON.stringify({ text: "hello" }),
      },
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal("code" in error ? error.code : undefined, "feishu.outbound.permission_denied");
      assert.match(error.message, /missing im:message scope/);
      assert.match(error.message, /app_secret=\[redacted\]/);
      assert.match(error.message, /Bearer \[redacted\]/);
      assert.equal(error.message.includes("secret-value"), false);
      assert.equal(error.message.includes("tenant-token-secret"), false);
      assert.equal(JSON.stringify((error as { cause?: unknown }).cause).includes("secret-value"), false);
      assert.equal(JSON.stringify((error as { cause?: unknown }).cause).includes("tenant-token-secret"), false);
      return true;
    },
  );
});

test("normalizes Feishu outbound retry and terminal errors", () => {
  const network = normalizeFeishuOutboundError(new Error("fetch failed ECONNRESET"), { attempts: 1 });
  assert.deepEqual(network, {
    errorCode: "feishu.outbound.network_unreachable",
    errorMessage: "fetch failed ECONNRESET",
    retryable: true,
    terminal: false,
  });

  const exhausted = normalizeFeishuOutboundError(new Error("fetch failed ECONNRESET"), { attempts: 10 });
  assert.equal(exhausted.retryable, true);
  assert.equal(exhausted.terminal, true);

  const tokenServerError = normalizeFeishuOutboundError(createIntegrationProviderError({
    provider: "feishu",
    code: "feishu.tenant_token_http_error",
    message: "Feishu tenant token request failed with HTTP 500.",
  }), { attempts: 1 });
  assert.equal(tokenServerError.retryable, true);
  assert.equal(tokenServerError.terminal, false);

  const invalid = normalizeFeishuOutboundError(createIntegrationProviderError({
    provider: "feishu",
    code: "feishu.outbound.invalid_payload",
    message: "invalid payload app_secret='secret-value' verificationToken=verify-value token=raw-token",
  }), { attempts: 1 });
  assert.equal(invalid.retryable, false);
  assert.equal(invalid.terminal, true);
  assert.equal(invalid.errorMessage.includes("secret-value"), false);
  assert.equal(invalid.errorMessage.includes("verify-value"), false);
  assert.equal(invalid.errorMessage.includes("raw-token"), false);
  assert.equal(
    formatFeishuOutboundError(invalid),
    "feishu.outbound.invalid_payload: invalid payload app_secret=[redacted] verificationToken=[redacted] token=[redacted]",
  );
});

test("computes Feishu outbox exponential backoff", () => {
  assert.equal(computeFeishuOutboxRetryDelaySeconds(1), 30);
  assert.equal(computeFeishuOutboxRetryDelaySeconds(2), 60);
  assert.equal(computeFeishuOutboxRetryDelaySeconds(9), 3600);
  assert.equal(
    computeFeishuOutboxNextAttemptAt(2, new Date("2026-06-24T00:00:00.000Z")),
    "2026-06-24T00:01:00.000Z",
  );
});

test("resolveFeishuOutboundMessageId supports direct and nested response shapes", () => {
  assert.equal(resolveFeishuOutboundMessageId({ message_id: "om_direct" }), "om_direct");
  assert.equal(resolveFeishuOutboundMessageId({ data: { messageId: "om_nested" } }), "om_nested");
  assert.equal(resolveFeishuOutboundImageKey({ data: { image_key: "img_nested" } }), "img_nested");
  assert.equal(resolveFeishuOutboundFileKey({ fileKey: "file_direct" }), "file_direct");
});

function createAttachment(input: {
  id: string;
  fileName: string;
  mediaType: string;
  kind: MessageAttachment["kind"];
  storedPath: string;
  sizeBytes?: number;
  storageUrl?: string;
}): MessageAttachment {
  return {
    id: input.id,
    fileName: input.fileName,
    mediaType: input.mediaType,
    sizeBytes: input.sizeBytes ?? 5,
    kind: input.kind,
    storedPath: input.storedPath,
    storageProvider: "local",
    storageUrl: input.storageUrl,
  };
}

function writeTempAttachmentFile(fileName: string, content: string): string {
  const dir = join(tempRoot, "attachments");
  mkdirSync(dir, { recursive: true });
  const storedPath = join(dir, fileName);
  writeFileSync(storedPath, content, "utf8");
  return storedPath;
}
