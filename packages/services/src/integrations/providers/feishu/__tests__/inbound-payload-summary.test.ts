import assert from "node:assert/strict";
import test from "node:test";
import { summarizeFeishuInboundEventPayload } from "../inbound.ts";

test("summarizeFeishuInboundEventPayload redacts raw message content", () => {
  const summary = summarizeFeishuInboundEventPayload({
    schema: "2.0",
    header: {
      event_id: "evt-redacted",
      event_type: "im.message.receive_v1",
      create_time: "1782288000000",
    },
    event: {
      sender: {
        sender_id: {
          open_id: "ou_sender",
          union_id: "on_sender",
        },
      },
      message: {
        message_id: "om_secret",
        chat_id: "oc_general",
        message_type: "text",
        content: JSON.stringify({
          text: "@Atlas summarize the confidential launch plan",
        }),
      },
    },
  });

  assert.equal(summary.rawPayloadStored, false);
  assert.equal(summary.contentRedacted, true);
  assert.equal((summary.message as Record<string, unknown>).messageId, "om_secret");
  assert.equal((summary.message as Record<string, unknown>).chatId, "oc_general");
  assert.equal((summary.message as Record<string, unknown>).messageType, "text");
  assert.match(String((summary.message as Record<string, unknown>).contentHash), /^[a-f0-9]{64}$/);
  assert.match(String(summary.payloadHash), /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(summary), /confidential launch plan/);
});
