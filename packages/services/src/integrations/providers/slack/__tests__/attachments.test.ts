import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { before } from "node:test";
import type { ExternalMessageEnvelope, IntegrationRuntimeContext } from "../../../core/index.ts";
import {
  createSlackInboundAttachmentCommandScanner,
  createSlackInboundAttachmentDownloader,
  downloadSlackInboundMessageAttachment,
  resolveSlackInboundAttachmentDescriptor,
  type SlackInboundAttachmentSecurityScanInput,
} from "../attachments.ts";
import { SLACK_PROVIDER_ID } from "../constants.ts";

const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-slack-attachments-"));
const context: IntegrationRuntimeContext = {
  workspaceId: "default",
  integrationId: "external-integration-slack",
  provider: SLACK_PROVIDER_ID,
};

before(() => {
  writeFileSync(join(tempRoot, "Target.md"), "# test\n");
  mkdirSync(join(tempRoot, "data"), { recursive: true });
  process.chdir(tempRoot);
});

test("createSlackInboundAttachmentDownloader fetches files.info and persists Slack private file bytes", async () => {
  const requests: Array<{ url: string; method?: string; authorization?: string; body?: string }> = [];
  const fetchImpl = (async (url, init) => {
    const urlText = url.toString();
    const headers = init?.headers as Record<string, string> | undefined;
    requests.push({
      url: urlText,
      method: init?.method,
      authorization: headers?.authorization,
      body: String(init?.body ?? ""),
    });

    if (urlText.endsWith("/files.info")) {
      assert.equal(headers?.authorization, "Bearer xoxb-test");
      assert.equal(String(init?.body), "file=FSECRET123");
      return new Response(JSON.stringify({
        ok: true,
        file: {
          id: "FSECRET123",
          title: "Roadmap.pdf",
          mimetype: "application/pdf",
          filetype: "pdf",
          size: Buffer.byteLength("slack attachment"),
          url_private_download: "https://files.slack.com/files-pri/T123-FSECRET123/download/roadmap.pdf",
        },
      }), {
        headers: { "content-type": "application/json" },
      });
    }

    assert.equal(urlText, "https://files.slack.com/files-pri/T123-FSECRET123/download/roadmap.pdf");
    assert.equal(headers?.authorization, "Bearer xoxb-test");
    return new Response(Buffer.from("slack attachment", "utf8"), {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(Buffer.byteLength("slack attachment")),
      },
    });
  }) as typeof fetch;

  const message = buildExternalMessageEnvelope();
  const downloader = createSlackInboundAttachmentDownloader({
    workspaceId: "default",
    botToken: "xoxb-test",
    fetchImpl,
    maxBytes: 1024,
    securityScanner: null,
  });
  const attachment = await downloader({
    context,
    payload: buildSlackFilePayload(),
    message,
    attachment: message.attachments[0]!,
    attachmentIndex: 0,
  });

  assert.ok(attachment);
  assert.equal(attachment.fileName, "Roadmap.pdf");
  assert.equal(attachment.mediaType, "application/pdf");
  assert.equal(attachment.kind, "file");
  assert.equal(attachment.sizeBytes, Buffer.byteLength("slack attachment"));
  assert.ok(existsSync(attachment.storedPath));
  assert.equal(readFileSync(attachment.storedPath, "utf8"), "slack attachment");
  assert.deepEqual(requests.map((request) => request.url), [
    "https://slack.com/api/files.info",
    "https://files.slack.com/files-pri/T123-FSECRET123/download/roadmap.pdf",
  ]);
});

test("downloadSlackInboundMessageAttachment rejects declared oversize files before calling Slack", async () => {
  let fetchCount = 0;
  await assert.rejects(
    downloadSlackInboundMessageAttachment({
      workspaceId: "default",
      botToken: "xoxb-test",
      payload: buildSlackFilePayload({
        size: 9,
      }),
      attachment: {
        ...buildExternalMessageEnvelope().attachments[0]!,
        sizeBytes: 9,
      },
      attachmentIndex: 0,
      maxBytes: 8,
      fetchImpl: (async () => {
        fetchCount += 1;
        throw new Error("fetch should not run");
      }) as typeof fetch,
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "slack.attachment_too_large",
  );
  assert.equal(fetchCount, 0);
});

test("downloadSlackInboundMessageAttachment rejects unsafe private file URLs without leaking secrets", async () => {
  let fileFetchCount = 0;
  await assert.rejects(
    downloadSlackInboundMessageAttachment({
      workspaceId: "default",
      botToken: "xoxb-secret-token",
      payload: buildSlackFilePayload(),
      attachment: buildExternalMessageEnvelope().attachments[0]!,
      attachmentIndex: 0,
      fetchImpl: (async (url, init) => {
        const urlText = url.toString();
        if (urlText.endsWith("/files.info")) {
          assert.equal((init?.headers as Record<string, string>)?.authorization, "Bearer xoxb-secret-token");
          return new Response(JSON.stringify({
            ok: true,
            file: {
              id: "FSECRET123",
              title: "Roadmap.pdf",
              mimetype: "application/pdf",
              size: 12,
              url_private_download: "https://127.0.0.1/private.pdf",
            },
          }));
        }
        fileFetchCount += 1;
        throw new Error("unsafe file URL fetch should not run");
      }) as typeof fetch,
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "slack.attachment_download_url_unsafe" &&
      !error.message.includes("127.0.0.1") &&
      !error.message.includes("xoxb-secret-token"),
  );
  assert.equal(fileFetchCount, 0);
});

test("downloadSlackInboundMessageAttachment records clean security scan evidence", async () => {
  let scanInput: SlackInboundAttachmentSecurityScanInput | undefined;
  const attachment = await downloadSlackInboundMessageAttachment({
    workspaceId: "default",
    botToken: "xoxb-test",
    payload: buildSlackFilePayload(),
    attachment: buildExternalMessageEnvelope().attachments[0]!,
    attachmentIndex: 0,
    fetchImpl: buildSlackFileFetch("clean attachment bytes"),
    securityScanner(input) {
      scanInput = input;
      return {
        status: "clean",
        engine: "unit-scanner",
        reference: "scan-123",
      };
    },
  });

  assert.equal(scanInput?.fileName, "Roadmap.pdf");
  assert.equal(scanInput?.mediaType, "application/pdf");
  assert.equal(Buffer.from(scanInput?.contentBytes ?? []).toString("utf8"), "clean attachment bytes");
  assert.equal(attachment.securityScanStatus, "clean");
  assert.equal(attachment.securityScanEngine, "unit-scanner");
  assert.equal(attachment.securityScanRef, "scan-123");
});

test("downloadSlackInboundMessageAttachment blocks files rejected by security scanner", async () => {
  await assert.rejects(
    downloadSlackInboundMessageAttachment({
      workspaceId: "default",
      botToken: "xoxb-secret-token",
      payload: buildSlackFilePayload(),
      attachment: buildExternalMessageEnvelope().attachments[0]!,
      attachmentIndex: 0,
      fetchImpl: buildSlackFileFetch("blocked secret bytes", "xoxb-secret-token"),
      securityScanner() {
        return {
          status: "blocked",
          engine: "unit-scanner",
          reference: "Eicar-Test-Signature",
        };
      },
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "slack.attachment_security_scan_blocked" &&
      !error.message.includes("blocked secret bytes") &&
      !error.message.includes("xoxb-secret-token"),
  );
});

test("createSlackInboundAttachmentCommandScanner reads bytes from stdin and blocks configured exit codes", async () => {
  const scanner = createSlackInboundAttachmentCommandScanner({
    command: process.execPath,
    args: ["-e", [
      "let data = '';",
      "process.stdin.on('data', (chunk) => { data += chunk; });",
      "process.stdin.on('end', () => {",
      "  if (data.includes('blocked')) {",
      "    console.log('stream: Eicar-Test-Signature FOUND');",
      "    process.exit(1);",
      "  }",
      "  process.exit(0);",
      "});",
    ].join("")],
    engine: "node-test-scanner",
    timeoutMs: 5_000,
  });

  const clean = await scanner(buildSecurityScanInput("safe bytes"));
  const blocked = await scanner(buildSecurityScanInput("blocked bytes"));

  assert.deepEqual(clean, {
    status: "clean",
    engine: "node-test-scanner",
    reference: undefined,
  });
  assert.deepEqual(blocked, {
    status: "blocked",
    engine: "node-test-scanner",
    reference: "Eicar-Test-Signature",
    message: "Configured Slack attachment security scanner blocked the file.",
  });
});

test("resolveSlackInboundAttachmentDescriptor ignores non-Slack attachment metadata", () => {
  assert.equal(resolveSlackInboundAttachmentDescriptor({
    payload: buildSlackFilePayload(),
    attachment: {
      fileName: "other.txt",
      metadata: { provider: "feishu" },
    },
    attachmentIndex: 0,
  }), null);
});

function buildExternalMessageEnvelope(): ExternalMessageEnvelope {
  return {
    provider: SLACK_PROVIDER_ID,
    integrationId: "external-integration-slack",
    externalEventId: "EvFile",
    eventType: "event_callback.message",
    externalChatId: "C123",
    externalMessageId: "1783400000.000100",
    externalSenderId: "U123",
    text: "Shared 1 Slack file: Roadmap.pdf.",
    attachments: [{
      id: "ref_f9d46936",
      fileName: "Roadmap.pdf",
      mediaType: "application/pdf",
      sizeBytes: Buffer.byteLength("slack attachment"),
      metadata: {
        provider: SLACK_PROVIDER_ID,
        source: "slack_file_metadata",
        fileRef: "ref_f9d46936",
        fileType: "pdf",
        mode: "hosted",
        privateUrlRedacted: true,
        permalinkRedacted: true,
        downloadStatus: "not_downloaded",
        rawSlackFileIdStored: false,
        privateUrlStored: false,
      },
    }],
    rawPayload: {},
    receivedAt: "2026-07-08T00:00:00.000Z",
  };
}

function buildSlackFileFetch(content: string, expectedToken = "xoxb-test"): typeof fetch {
  return (async (url, init) => {
    const urlText = url.toString();
    if (urlText.endsWith("/files.info")) {
      return new Response(JSON.stringify({
        ok: true,
        file: {
          id: "FSECRET123",
          title: "Roadmap.pdf",
          mimetype: "application/pdf",
          filetype: "pdf",
          size: Buffer.byteLength(content),
          url_private_download: "https://files.slack.com/files-pri/T123-FSECRET123/download/roadmap.pdf",
        },
      }), {
        headers: { "content-type": "application/json" },
      });
    }
    assert.equal(urlText, "https://files.slack.com/files-pri/T123-FSECRET123/download/roadmap.pdf");
    assert.equal((init?.headers as Record<string, string> | undefined)?.authorization, `Bearer ${expectedToken}`);
    return new Response(Buffer.from(content, "utf8"), {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(Buffer.byteLength(content)),
      },
    });
  }) as typeof fetch;
}

function buildSecurityScanInput(content: string): SlackInboundAttachmentSecurityScanInput {
  return {
    workspaceId: "default",
    fileName: "Roadmap.pdf",
    mediaType: "application/pdf",
    sizeBytes: Buffer.byteLength(content),
    contentBytes: Buffer.from(content, "utf8"),
    descriptor: {
      fileRef: "ref_f9d46936",
      fileName: "Roadmap.pdf",
      mediaType: "application/pdf",
    },
  };
}

function buildSlackFilePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "event_callback",
    event_id: "EvFile",
    event: {
      type: "message",
      subtype: "file_share",
      channel: "C123",
      user: "U123",
      ts: "1783400000.000100",
      files: [{
        id: "FSECRET123",
        title: "Roadmap.pdf",
        name: "roadmap.pdf",
        mimetype: "application/pdf",
        filetype: "pdf",
        size: Buffer.byteLength("slack attachment"),
        mode: "hosted",
        url_private: "https://files.slack.com/files-pri/T123-FSECRET123/roadmap.pdf",
        url_private_download: "https://files.slack.com/files-pri/T123-FSECRET123/download/roadmap.pdf",
        ...overrides,
      }],
    },
  };
}
