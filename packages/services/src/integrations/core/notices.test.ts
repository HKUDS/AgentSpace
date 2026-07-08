import assert from "node:assert/strict";
import test from "node:test";
import { buildExternalNoticeMetadata } from "./notices.ts";

test("builds provider-neutral notice metadata with safe references", () => {
  const metadata = buildExternalNoticeMetadata({
    provider: "slack",
    outboxSource: "inbound_setup_notice",
    noticeType: "channel_binding_missing",
    reasonCode: "slack.channel_binding_missing",
    externalChatId: "C_SECRET",
    externalThreadId: "1783400005.000100",
  });

  assert.deepEqual(metadata, {
    provider: "slack",
    outboxSource: "inbound_setup_notice",
    noticeType: "channel_binding_missing",
    noticeSource: undefined,
    reasonCode: "slack.channel_binding_missing",
    externalChatReference: "ref_9eb669fe",
    externalThreadReference: "ref_5085b843",
  });
  assert.doesNotMatch(JSON.stringify(metadata), /C_SECRET|1783400005\.000100/);
});

test("supports provider-specific reference formats and extra audit fields", () => {
  const metadata = buildExternalNoticeMetadata({
    provider: "feishu",
    noticeType: "identity_binding_required",
    noticeSource: "external_guest_policy",
    reasonCode: "feishu_external_guest_identity_required",
    externalChatId: "oc_secret",
    externalThreadId: "om_secret",
    buildExternalReference: (value) => `safe:${value.length}`,
    extra: {
      actorType: "external_guest",
      workspaceMemberCreated: false,
    },
  });

  assert.deepEqual(metadata, {
    provider: "feishu",
    outboxSource: undefined,
    noticeType: "identity_binding_required",
    noticeSource: "external_guest_policy",
    reasonCode: "feishu_external_guest_identity_required",
    actorType: "external_guest",
    workspaceMemberCreated: false,
    externalChatReference: "safe:9",
    externalThreadReference: "safe:9",
  });
});
