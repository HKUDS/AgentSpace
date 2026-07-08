import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  buildSlackUrlVerificationResponse,
  isSlackUrlVerificationPayload,
  resolveSlackCallbackAppId,
  resolveSlackCallbackTeamId,
  resolveSlackEventId,
  resolveSlackEventType,
  summarizeSlackAgentContextPayload,
  summarizeSlackInboundEventPayload,
  validateSlackCallbackContext,
  verifySlackRequestSignature,
} from "../events.ts";

test("verifies Slack request signatures with timestamp replay protection", () => {
  const signingSecret = "slack_signing_secret";
  const rawBody = JSON.stringify({ type: "event_callback", event_id: "Ev123" });
  const timestamp = "1783400000";
  const signature = `v0=${createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${rawBody}`, "utf8")
    .digest("hex")}`;

  assert.equal(verifySlackRequestSignature({
    signingSecret,
    timestamp,
    rawBody,
    signature,
    nowMs: 1783400000 * 1000,
  }), true);

  assert.equal(verifySlackRequestSignature({
    signingSecret,
    timestamp,
    rawBody,
    signature: "v0=wrong",
    nowMs: 1783400000 * 1000,
  }), false);

  assert.equal(verifySlackRequestSignature({
    signingSecret,
    timestamp,
    rawBody,
    signature,
    nowMs: (1783400000 + 301) * 1000,
  }), false);
});

test("handles Slack URL verification payloads", () => {
  const payload = {
    type: "url_verification",
    challenge: "challenge-value",
  };

  assert.equal(isSlackUrlVerificationPayload(payload), true);
  assert.deepEqual(buildSlackUrlVerificationResponse(payload), {
    challenge: "challenge-value",
  });
});

test("resolves Slack callback context and event identity", () => {
  const payload = {
    type: "event_callback",
    api_app_id: "A123",
    team_id: "T123",
    event_id: "Ev123",
    event: {
      type: "app_mention",
      channel: "C123",
      user: "U123",
      ts: "1710000000.000100",
    },
  };

  assert.equal(resolveSlackCallbackAppId(payload), "A123");
  assert.equal(resolveSlackCallbackTeamId(payload), "T123");
  assert.equal(resolveSlackEventId(payload), "Ev123");
  assert.equal(resolveSlackEventType(payload), "event_callback.app_mention");
  assert.deepEqual(validateSlackCallbackContext({
    payload,
    expectedAppId: "A123",
    expectedTeamId: "T123",
  }), { ok: true });
  assert.equal(validateSlackCallbackContext({
    payload,
    expectedAppId: "A999",
    expectedTeamId: "T123",
  }).ok, false);
});

test("summarizes Slack agent context without storing raw external ids", () => {
  const payload = {
    type: "event_callback",
    api_app_id: "A123",
    team_id: "T_SECRET",
    event_id: "EvContext",
    event: {
      type: "app_context_changed",
      user: "U_SECRET",
      context: {
        entities: [
          {
            type: "slack#/types/channel_id",
            value: "C_SECRET",
            team_id: "T_SECRET",
          },
          {
            type: "slack#/types/list_id",
            value: "F_SECRET",
            enterprise_id: "E_SECRET",
          },
        ],
      },
    },
  };

  const agentContext = summarizeSlackAgentContextPayload(payload);
  assert.ok(agentContext);
  assert.equal(agentContext.source, "context");
  assert.equal(agentContext.hasEntities, true);
  assert.equal(agentContext.entityCount, 2);
  assert.equal(agentContext.entities[0]?.type, "slack#/types/channel_id");
  assert.match(agentContext.entities[0]?.valueRef ?? "", /^ref_[a-f0-9]{8}$/);

  const eventSummary = summarizeSlackInboundEventPayload(payload);
  assert.equal(eventSummary.hasAgentContext, true);
  assert.doesNotMatch(JSON.stringify(eventSummary), /C_SECRET|F_SECRET|T_SECRET|E_SECRET|U_SECRET/);
});
