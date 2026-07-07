import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSlackTextOutboundMessage,
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
