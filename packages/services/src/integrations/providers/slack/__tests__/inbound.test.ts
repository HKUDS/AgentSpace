import assert from "node:assert/strict";
import test from "node:test";
import { buildSlackInboundPermissionNoticeOutbox } from "../inbound.ts";

test("builds Slack permission denial notices for the original thread with safe metadata", () => {
  const notice = buildSlackInboundPermissionNoticeOutbox({
    message: {
      externalChatId: "C_SHARED_SECRET",
      externalThreadId: "1783400003.000100",
    },
    text: "Your AgentSpace account cannot access this channel.",
  });

  assert.equal(notice.targetExternalChatId, "C_SHARED_SECRET");
  assert.equal(notice.targetExternalThreadId, "1783400003.000100");
  assert.deepEqual(notice.payload, {
    channel: "C_SHARED_SECRET",
    thread_ts: "1783400003.000100",
    text: "Your AgentSpace account cannot access this channel.",
  });
  assert.equal(notice.metadataJson.provider, "slack");
  assert.equal(notice.metadataJson.outboxSource, "inbound_permission_notice");
  assert.equal(notice.metadataJson.noticeType, "permission_denied");
  assert.match(String(notice.metadataJson.externalChatReference), /^ref_[a-f0-9]{8}$/);
  assert.match(String(notice.metadataJson.externalThreadReference), /^ref_[a-f0-9]{8}$/);
  assert.doesNotMatch(JSON.stringify(notice.metadataJson), /C_SHARED_SECRET|1783400003\.000100/);
});
