import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSlackAgentStatusCardOutboundMessage,
  buildSlackAppHomeOpenedWelcomeOutboundMessage,
  buildSlackAssistantSuggestedPromptsOutboundMessage,
  buildSlackTextOutboundMessage,
  resolveSlackReplyTargetExternalMessageId,
  selectSlackOutboundChannelBindingForReply,
  sendSlackAssistantSuggestedPrompts,
  sendSlackChatPostMessage,
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
