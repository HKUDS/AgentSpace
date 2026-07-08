import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  ExternalIntegrationRecord,
  ExternalMessageOutboxRecord,
} from "@agent-space/db";
import {
  buildSlackAgentStatusCardOutboundMessage,
  buildSlackAppHomeOpenedWelcomeOutboundMessage,
  buildSlackAssistantSuggestedPromptsOutboundMessage,
  buildSlackFileUploadOutboundMessage,
  buildSlackTextOutboundMessage,
  processSlackOutboxMessage,
  resolveSlackReplyTargetExternalMessageId,
  selectSlackOutboundChannelBindingForReply,
  sendSlackAssistantSuggestedPrompts,
  sendSlackChatPostMessage,
  sendSlackFileUploadExternal,
} from "../outbound.ts";

test("builds Slack text outbound payloads with thread targets", () => {
  const outbound = buildSlackTextOutboundMessage({
    targetExternalChatId: "C123",
    targetExternalThreadId: "1783400000.000100",
    text: "Agent reply",
  });

  assert.deepEqual(outbound, {
    targetExternalChatId: "C123",
    targetExternalThreadId: "1783400000.000100",
    payload: {
      channel: "C123",
      text: "Agent reply",
      thread_ts: "1783400000.000100",
    },
  });
});

test("sends Slack chat.postMessage payloads", async () => {
  const calls: Array<{
    url: string;
    init?: RequestInit;
  }> = [];
  const result = await sendSlackChatPostMessage({
    botToken: "xoxb-test",
    payload: {
      channel: "C123",
      text: "Agent reply",
      thread_ts: "1783400000.000100",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        ok: true,
        channel: "C123",
        ts: "1783400002.000100",
      }), { status: 200 });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.ts, "1783400002.000100");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://slack.com/api/chat.postMessage");
  assert.equal((calls[0]?.init?.headers as Record<string, string>).Authorization, "Bearer xoxb-test");
});

test("normalizes terminal Slack chat.postMessage provider errors", async () => {
  for (const providerError of ["channel_not_found", "not_in_channel", "missing_scope", "invalid_auth"]) {
    const result = await sendSlackChatPostMessage({
      botToken: "xoxb-secret-token",
      payload: {
        channel: "C123",
        text: "Agent reply",
      },
      fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: providerError }), {
        status: 200,
      }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 200);
    assert.equal(result.errorCode, `slack.outbound.${providerError}`);
    assert.equal(result.errorMessage, `Slack chat.postMessage failed: slack.outbound.${providerError}`);
    assert.doesNotMatch(JSON.stringify(result), /xoxb-secret-token|C123/);
  }
});

test("builds Slack external file upload payloads without deprecated files.upload", () => {
  const outbound = buildSlackFileUploadOutboundMessage({
    targetExternalChatId: "C123",
    targetExternalThreadId: "1783400000.000100",
    text: "Here is the chart.",
    attachments: [{
      id: "att-1",
      fileName: "chart.png",
      mediaType: "image/png",
      kind: "image",
      sizeBytes: 12,
      storedPath: "/tmp/chart.png",
    }],
  });

  assert.equal(outbound.targetExternalChatId, "C123");
  assert.equal(outbound.targetExternalThreadId, "1783400000.000100");
  assert.deepEqual(outbound.payload, {
    method: "files.completeUploadExternal",
    channel_id: "C123",
    thread_ts: "1783400000.000100",
    initial_comment: "Here is the chart.",
    files: [{
      attachmentId: "att-1",
      filename: "chart.png",
      title: "chart.png",
      mediaType: "image/png",
      sizeBytes: 12,
      storedPath: "/tmp/chart.png",
    }],
  });
  assert.doesNotMatch(JSON.stringify(outbound), /files\.upload/);
});

test("uploads Slack files with the external upload flow", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "agentspace-slack-upload-"));
  const filePath = join(tempDir, "chart.png");
  writeFileSync(filePath, Buffer.from("chart-bytes"));
  const calls: Array<{
    url: string;
    init?: RequestInit;
  }> = [];

  try {
    const result = await sendSlackFileUploadExternal({
      botToken: "xoxb-test",
      payload: {
        method: "files.completeUploadExternal",
        channel_id: "C123",
        thread_ts: "1783400000.000100",
        files: [{
          attachmentId: "att-1",
          filename: "chart.png",
          title: "chart.png",
          mediaType: "image/png",
          sizeBytes: 11,
          storedPath: filePath,
        }],
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/files.getUploadURLExternal")) {
          return new Response(JSON.stringify({
            ok: true,
            upload_url: "https://files.slack.com/upload/v1/TICKET",
            file_id: "FSECRET123",
          }), { status: 200 });
        }
        if (String(url) === "https://files.slack.com/upload/v1/TICKET") {
          return new Response("", { status: 200 });
        }
        if (String(url).endsWith("/files.completeUploadExternal")) {
          return new Response(JSON.stringify({
            ok: true,
            files: [{ id: "FSECRET123", title: "chart.png" }],
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: false, error: "unexpected" }), { status: 500 });
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.fileRefs?.length, 1);
    assert.match(result.fileRefs?.[0] ?? "", /^ref_[a-f0-9]{8}$/);
    assert.deepEqual(calls.map((call) => call.url), [
      "https://slack.com/api/files.getUploadURLExternal",
      "https://files.slack.com/upload/v1/TICKET",
      "https://slack.com/api/files.completeUploadExternal",
    ]);
    const ticketBody = JSON.parse(String(calls[0]?.init?.body ?? "{}")) as Record<string, unknown>;
    assert.deepEqual(ticketBody, {
      filename: "chart.png",
      length: 11,
    });
    assert.equal((calls[0]?.init?.headers as Record<string, string>).Authorization, "Bearer xoxb-test");
    assert.equal((calls[1]?.init?.headers as Record<string, string>)["content-type"], "image/png");
    assert.deepEqual(
      JSON.parse(String(calls[2]?.init?.body ?? "{}")),
      {
        channel_id: "C123",
        thread_ts: "1783400000.000100",
        files: [{ id: "FSECRET123", title: "chart.png" }],
      },
    );
    assert.equal(calls.some((call) => call.url.includes("files.upload")), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("builds Slack Block Kit approval status cards with safe action values", () => {
  const outbound = buildSlackAgentStatusCardOutboundMessage({
    targetExternalChatId: "C123",
    targetExternalThreadId: "1783400000.000100",
    status: "approval_required",
    channelName: "general",
    agentNames: ["Atlas"],
    message: "Atlas requested sheets.update_range.",
    taskId: "task-approval-1",
    approvalAction: {
      approvalId: "approval-1",
      payloadHash: "payload-hash-1",
      token: "approval-token-1",
    },
  });

  const payload = outbound.payload as {
    channel?: string;
    text?: string;
    thread_ts?: string;
    blocks?: Array<{
      type?: string;
      elements?: Array<{
        action_id?: string;
        value?: string;
        style?: string;
      }>;
    }>;
  };
  assert.equal(payload.channel, "C123");
  assert.equal(payload.thread_ts, "1783400000.000100");
  assert.equal(payload.text, "Atlas · Approval required");
  assert.equal(payload.blocks?.[0]?.type, "section");
  const actions = payload.blocks?.find((block) => block.type === "actions")?.elements ?? [];
  assert.equal(actions.length, 2);
  assert.equal(actions[0]?.action_id, "agentspace_approval_approve");
  assert.equal(actions[0]?.style, "primary");
  assert.equal(actions[1]?.action_id, "agentspace_approval_reject");
  assert.equal(actions[1]?.style, "danger");
  assert.deepEqual(JSON.parse(actions[0]?.value ?? "{}"), {
    provider: "slack",
    kind: "approval_review",
    approvalId: "approval-1",
    decision: "approved",
    payloadHash: "payload-hash-1",
    token: "approval-token-1",
  });
  assert.deepEqual(JSON.parse(actions[1]?.value ?? "{}"), {
    provider: "slack",
    kind: "approval_review",
    approvalId: "approval-1",
    decision: "rejected",
    payloadHash: "payload-hash-1",
    token: "approval-token-1",
  });
});

test("builds Slack app_home_opened welcome messages", () => {
  const outbound = buildSlackAppHomeOpenedWelcomeOutboundMessage({
    targetExternalChatId: "D123",
    agentId: "Atlas",
  });

  assert.equal(outbound.targetExternalChatId, "D123");
  const payload = outbound.payload as {
    channel?: string;
    text?: string;
    blocks?: Array<{ type?: string; text?: { text?: string } }>;
  };
  assert.equal(payload.channel, "D123");
  assert.equal(payload.text, "AgentSpace is ready for Atlas.");
  assert.equal(payload.blocks?.[0]?.type, "section");
  assert.match(payload.blocks?.[0]?.text?.text ?? "", /AgentSpace is ready for Atlas/);
  assert.match(JSON.stringify(payload.blocks), /Workspace permissions/);
});

test("builds Slack assistant suggested prompt payloads", () => {
  const outbound = buildSlackAssistantSuggestedPromptsOutboundMessage({
    targetExternalChatId: "D123",
    agentId: "Atlas",
    prompts: [{
      title: "Review approvals",
      message: "Show pending approvals.",
    }],
  });

  assert.equal(outbound.targetExternalChatId, "D123");
  assert.deepEqual(outbound.payload, {
    method: "assistant.threads.setSuggestedPrompts",
    channel_id: "D123",
    title: "Suggested prompts",
    prompts: [{
      title: "Review approvals",
      message: "Show pending approvals.",
    }],
  });
});

test("sends Slack assistant suggested prompt payloads", async () => {
  const calls: Array<{
    url: string;
    init?: RequestInit;
  }> = [];
  const result = await sendSlackAssistantSuggestedPrompts({
    botToken: "xoxb-test",
    payload: {
      method: "assistant.threads.setSuggestedPrompts",
      channel_id: "D123",
      title: "Suggested prompts",
      prompts: [{
        title: "Plan next steps",
        message: "Help me plan.",
      }],
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://slack.com/api/assistant.threads.setSuggestedPrompts");
  const body = JSON.parse(String(calls[0]?.init?.body ?? "{}")) as Record<string, unknown>;
  assert.equal(body.channel_id, "D123");
  assert.equal(body.method, undefined);
  assert.equal((calls[0]?.init?.headers as Record<string, string>).Authorization, "Bearer xoxb-test");
});

test("sends Slack chat.postMessage Block Kit payloads", async () => {
  const calls: Array<{
    url: string;
    init?: RequestInit;
  }> = [];
  const result = await sendSlackChatPostMessage({
    botToken: "xoxb-test",
    payload: {
      channel: "C123",
      text: "Atlas · Approval required",
      thread_ts: "1783400000.000100",
      blocks: [{
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Atlas* · Approval required",
        },
      }],
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        ok: true,
        channel: "C123",
        ts: "1783400002.000100",
      }), { status: 200 });
    },
  });

  assert.equal(result.ok, true);
  const sent = JSON.parse(String(calls[0]?.init?.body ?? "{}")) as {
    channel?: string;
    text?: string;
    thread_ts?: string;
    blocks?: unknown[];
  };
  assert.equal(sent.channel, "C123");
  assert.equal(sent.text, "Atlas · Approval required");
  assert.equal(sent.thread_ts, "1783400000.000100");
  assert.equal(Array.isArray(sent.blocks), true);
});

test("selects Slack reply channel bindings from source mappings first", () => {
  const selected = selectSlackOutboundChannelBindingForReply({
    channelName: "general",
    sourceMapping: {
      channelBindingId: "binding-source",
    },
    channelBindings: [
      {
        id: "binding-other",
        channelName: "general",
        syncMode: "mirror",
      },
      {
        id: "binding-source",
        channelName: "ops",
        syncMode: "mirror",
      },
    ],
  });

  assert.equal(selected?.id, "binding-source");
  assert.equal(selectSlackOutboundChannelBindingForReply({
    channelName: "general",
    sourceMapping: {
      channelBindingId: "binding-ingest",
    },
    channelBindings: [{
      id: "binding-ingest",
      channelName: "general",
      syncMode: "ingest_only",
    }],
  }), null);
  assert.equal(resolveSlackReplyTargetExternalMessageId({
    externalThreadId: "1783400000.000100",
    externalMessageId: "1783400000.000099",
  }), "1783400000.000100");
});

test("surfaces Slack rate limits as retryable results", async () => {
  const result = await sendSlackChatPostMessage({
    botToken: "xoxb-test",
    payload: {
      channel: "C123",
      text: "Agent reply",
    },
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: "ratelimited" }), {
      status: 429,
      headers: {
        "retry-after": "42",
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "slack.rate_limited");
  assert.equal(result.retryAfterSeconds, 42);
});

test("keeps Slack outbox messages pending for retry after rate limits", async () => {
  const outbox = buildExternalMessageOutbox({
    attempts: 0,
    payloadJson: JSON.stringify({
      channel: "C123",
      text: "Agent reply",
      thread_ts: "1783400000.000100",
    }),
  });
  const locked = buildExternalMessageOutbox({
    ...outbox,
    status: "locked",
    attempts: 1,
    lockedBy: "slack-worker-test",
    lockedAt: "2026-07-07T04:53:20.000Z",
  });
  let failedInput: {
    workspaceId?: string;
    outboxId: string;
    lastError: string;
    nextAttemptAt?: string;
    terminal?: boolean;
  } | undefined;

  const result = await processSlackOutboxMessage({
    workspaceId: "workspace-1",
    outbox,
    integration: buildExternalIntegration(),
    lockedBy: "slack-worker-test",
    dependencies: {
      markOutboxLocked: (input) => {
        assert.deepEqual(input, {
          workspaceId: "workspace-1",
          outboxId: "outbox-1",
          lockedBy: "slack-worker-test",
        });
        return locked;
      },
      readCredentials: () => ({ botToken: "xoxb-test" }),
      sendChatPostMessage: async (input) => {
        assert.equal(input.botToken, "xoxb-test");
        assert.deepEqual(input.payload, {
          channel: "C123",
          text: "Agent reply",
          thread_ts: "1783400000.000100",
        });
        return {
          ok: false,
          status: 429,
          errorCode: "slack.rate_limited",
          errorMessage: "Slack rate limited chat.postMessage.",
          retryAfterSeconds: 42,
        };
      },
      failOutbox: (input) => {
        failedInput = input;
        assert.equal(input.workspaceId, "workspace-1");
        assert.equal(input.outboxId, "outbox-1");
        assert.equal(input.lastError, "Slack rate limited chat.postMessage.");
        assert.equal(input.terminal, false);
        assert.match(input.nextAttemptAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
        return {
          ...locked,
          status: "pending",
          nextAttemptAt: input.nextAttemptAt,
          lastError: input.lastError,
          lockedAt: undefined,
          lockedBy: undefined,
        };
      },
      completeOutbox: () => {
        assert.fail("rate-limited outbox must not be marked sent");
      },
      createMessageMapping: () => {
        assert.fail("rate-limited outbox must not create outbound mapping");
      },
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "slack.rate_limited");
  assert.equal(result.retryable, true);
  assert.equal(result.terminal, false);
  assert.equal(result.nextAttemptAt, failedInput?.nextAttemptAt);
  assert.ok(result.nextAttemptAt);
});

test("marks Slack outbox provider auth failures terminal with safe diagnostics", async () => {
  const outbox = buildExternalMessageOutbox({
    payloadJson: JSON.stringify({
      channel: "CSECRET123",
      text: "Agent reply",
      thread_ts: "1783400000.000100",
    }),
  });
  const locked = buildExternalMessageOutbox({
    ...outbox,
    status: "locked",
    attempts: 1,
    lockedBy: "slack-worker-test",
    lockedAt: "2026-07-07T04:53:20.000Z",
  });
  let failedInput: {
    workspaceId?: string;
    outboxId: string;
    lastError: string;
    nextAttemptAt?: string;
    terminal?: boolean;
  } | undefined;

  const result = await processSlackOutboxMessage({
    workspaceId: "workspace-1",
    outbox,
    integration: buildExternalIntegration(),
    lockedBy: "slack-worker-test",
    dependencies: {
      markOutboxLocked: () => locked,
      readCredentials: () => ({ botToken: "xoxb-secret-token" }),
      sendChatPostMessage: async (input) => {
        assert.equal(input.botToken, "xoxb-secret-token");
        assert.equal(input.payload.channel, "CSECRET123");
        return {
          ok: false,
          status: 200,
          errorCode: "slack.outbound.invalid_auth",
          errorMessage: "Slack chat.postMessage failed: slack.outbound.invalid_auth",
        };
      },
      failOutbox: (input) => {
        failedInput = input;
        assert.equal(input.workspaceId, "workspace-1");
        assert.equal(input.outboxId, "outbox-1");
        assert.equal(input.lastError, "Slack chat.postMessage failed: slack.outbound.invalid_auth");
        assert.equal(input.terminal, true);
        assert.equal(input.nextAttemptAt, undefined);
        assert.doesNotMatch(JSON.stringify(input), /xoxb-secret-token|CSECRET123/);
        return {
          ...locked,
          status: "failed",
          lastError: input.lastError,
          lockedAt: undefined,
          lockedBy: undefined,
        };
      },
      completeOutbox: () => {
        assert.fail("terminal auth failure must not be marked sent");
      },
      createMessageMapping: () => {
        assert.fail("terminal auth failure must not create outbound mapping");
      },
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "slack.outbound.invalid_auth");
  assert.equal(result.errorMessage, "Slack chat.postMessage failed: slack.outbound.invalid_auth");
  assert.equal(result.retryable, false);
  assert.equal(result.terminal, true);
  assert.equal(result.nextAttemptAt, undefined);
  assert.equal(result.errorMessage, failedInput?.lastError);
  assert.doesNotMatch(JSON.stringify(result), /xoxb-secret-token|CSECRET123/);
});

function buildExternalIntegration(
  overrides: Partial<ExternalIntegrationRecord> = {},
): ExternalIntegrationRecord {
  return {
    id: "slack-1",
    workspaceId: "workspace-1",
    provider: "slack",
    displayName: "Slack",
    status: "active",
    transportMode: "http_webhook",
    appId: "A123",
    tenantKey: "T123",
    encryptedCredentialsJson: "{}",
    configJson: "{}",
    capabilitiesJson: "[]",
    scopesJson: "[]",
    createdAt: "2026-07-07T04:53:20.000Z",
    updatedAt: "2026-07-07T04:53:20.000Z",
    ...overrides,
  };
}

function buildExternalMessageOutbox(
  overrides: Partial<ExternalMessageOutboxRecord> = {},
): ExternalMessageOutboxRecord {
  return {
    id: "outbox-1",
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    channelBindingId: "channel-binding-1",
    targetExternalChatId: "C123",
    targetExternalThreadId: "1783400000.000100",
    agentSpaceMessageId: "message-1",
    payloadJson: JSON.stringify({
      channel: "C123",
      text: "Agent reply",
      thread_ts: "1783400000.000100",
    }),
    metadataJson: "{}",
    status: "pending",
    attempts: 0,
    createdAt: "2026-07-07T04:53:20.000Z",
    updatedAt: "2026-07-07T04:53:20.000Z",
    ...overrides,
  };
}
