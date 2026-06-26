import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { before } from "node:test";
import type { ExternalMessageEnvelope, IntegrationRuntimeContext } from "../../../core/index.ts";
import { FEISHU_PROVIDER_ID } from "../constants.ts";
import {
  buildFeishuMessageResourceRequest,
  createFeishuInboundAttachmentDownloader,
  downloadFeishuInboundMessageAttachment,
  resolveFeishuInboundAttachmentDescriptor,
} from "../attachments.ts";

const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-feishu-attachments-"));
const context: IntegrationRuntimeContext = {
  workspaceId: "default",
  integrationId: "external-integration-feishu",
  provider: FEISHU_PROVIDER_ID,
};

before(() => {
  writeFileSync(join(tempRoot, "Target.md"), "# test\n");
  mkdirSync(join(tempRoot, "data"), { recursive: true });
  process.chdir(tempRoot);
});

test("buildFeishuMessageResourceRequest targets the Feishu message resource endpoint", () => {
  assert.deepEqual(buildFeishuMessageResourceRequest({
    externalMessageId: "om_1/needs encoding",
    fileKey: "file key",
    resourceType: "file",
  }), {
    method: "GET",
    path: "/open-apis/im/v1/messages/om_1%2Fneeds%20encoding/resources/file%20key",
    query: {
      type: "file",
    },
  });
});

test("createFeishuInboundAttachmentDownloader downloads and persists a Feishu file attachment", async () => {
  const requests: Array<{ url: string; method?: string; authorization?: string }> = [];
  const fetchImpl = (async (url, init) => {
    const urlText = url.toString();
    const headers = init?.headers as Record<string, string> | undefined;
    requests.push({
      url: urlText,
      method: init?.method,
      authorization: headers?.authorization,
    });

    if (urlText.endsWith("/open-apis/auth/v3/tenant_access_token/internal")) {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        app_id: "cli_test",
        app_secret: "secret",
      });
      return new Response(JSON.stringify({
        code: 0,
        tenant_access_token: "tenant-token",
        expire: 7200,
      }), {
        headers: { "content-type": "application/json" },
      });
    }

    assert.equal(urlText, "https://feishu.test/open-apis/im/v1/messages/om-file/resources/file_v2_456?type=file");
    assert.equal(headers?.authorization, "Bearer tenant-token");
    return new Response(Buffer.from("hello attachment", "utf8"), {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(Buffer.byteLength("hello attachment")),
      },
    });
  }) as typeof fetch;

  const downloader = createFeishuInboundAttachmentDownloader({
    workspaceId: "default",
    appId: "cli_test",
    appSecret: "secret",
    baseUrl: "https://feishu.test",
    fetchImpl,
    maxBytes: 1024,
  });
  const attachment = await downloader({
    context,
    message: buildExternalMessageEnvelope(),
    attachment: buildExternalMessageEnvelope().attachments[0]!,
    attachmentIndex: 0,
  });

  assert.ok(attachment);
  assert.equal(attachment.fileName, "brief.pdf");
  assert.equal(attachment.mediaType, "application/pdf");
  assert.equal(attachment.kind, "file");
  assert.equal(attachment.sizeBytes, Buffer.byteLength("hello attachment"));
  assert.ok(existsSync(attachment.storedPath));
  assert.equal(readFileSync(attachment.storedPath, "utf8"), "hello attachment");
  assert.equal(requests.length, 2);
});

test("downloadFeishuInboundMessageAttachment rejects declared oversize files before fetching bytes", async () => {
  await assert.rejects(
    downloadFeishuInboundMessageAttachment({
      workspaceId: "default",
      tenantAccessToken: "tenant-token",
      maxBytes: 8,
      fetchImpl: (async () => {
        throw new Error("resource fetch should not be called");
      }) as typeof fetch,
      attachment: {
        id: "om-file:file:file_v2_big",
        fileName: "large.zip",
        mediaType: "application/zip",
        sizeBytes: 9,
        metadata: {
          provider: FEISHU_PROVIDER_ID,
          externalMessageId: "om-file",
          resourceType: "file",
          fileKey: "file_v2_big",
          resourceEndpoint: "im.message.resource",
        },
      },
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "feishu.attachment_too_large",
  );
});

test("createFeishuInboundAttachmentDownloader rejects unsafe base URLs before tenant token fetch", async () => {
  let fetchCount = 0;
  const downloader = createFeishuInboundAttachmentDownloader({
    workspaceId: "default",
    appId: "cli_test",
    appSecret: "secret",
    baseUrl: "https://127.0.0.1",
    fetchImpl: (async () => {
      fetchCount += 1;
      throw new Error("fetch should not run");
    }) as typeof fetch,
  });

  await assert.rejects(
    downloader({
      context,
      message: buildExternalMessageEnvelope(),
      attachment: buildExternalMessageEnvelope().attachments[0]!,
      attachmentIndex: 0,
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "feishu.attachment_base_url_unsafe" &&
      !error.message.includes("127.0.0.1") &&
      !error.message.includes("secret"),
  );
  assert.equal(fetchCount, 0);
});

test("downloadFeishuInboundMessageAttachment rejects non-Feishu public base URLs", async () => {
  let fetchCount = 0;
  await assert.rejects(
    downloadFeishuInboundMessageAttachment({
      workspaceId: "default",
      tenantAccessToken: "tenant-token-secret",
      baseUrl: "https://example.com",
      fetchImpl: (async () => {
        fetchCount += 1;
        throw new Error("fetch should not run");
      }) as typeof fetch,
      attachment: buildExternalMessageEnvelope().attachments[0]!,
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "feishu.attachment_base_url_unsafe" &&
      !error.message.includes("example.com") &&
      !error.message.includes("tenant-token-secret"),
  );
  assert.equal(fetchCount, 0);
});

test("resolveFeishuInboundAttachmentDescriptor ignores non-Feishu attachment metadata", () => {
  assert.equal(resolveFeishuInboundAttachmentDescriptor({
    fileName: "other.txt",
    metadata: { provider: "slack" },
  }), null);
});

function buildExternalMessageEnvelope(): ExternalMessageEnvelope {
  return {
    provider: FEISHU_PROVIDER_ID,
    integrationId: "external-integration-feishu",
    externalEventId: "evt-file",
    eventType: "im.message.receive_v1",
    externalChatId: "oc_general",
    externalMessageId: "om-file",
    externalSenderId: "ou_mina",
    text: "@Atlas review",
    attachments: [{
      id: "om-file:file:file_v2_456",
      fileName: "brief.pdf",
      mediaType: "application/pdf",
      sizeBytes: Buffer.byteLength("hello attachment"),
      metadata: {
        provider: FEISHU_PROVIDER_ID,
        externalMessageId: "om-file",
        resourceType: "file",
        fileKey: "file_v2_456",
        resourceEndpoint: "im.message.resource",
      },
    }],
    rawPayload: {},
    receivedAt: "2026-06-24T00:00:00.000Z",
  };
}
