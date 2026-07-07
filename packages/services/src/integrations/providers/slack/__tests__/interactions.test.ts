import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSlackApprovalBlockAction,
  buildSlackApprovalPayloadHash,
  isSlackBlockActionsPayload,
  isSlackInteractionPayload,
  parseSlackApprovalBlockActionPayload,
} from "../interactions.ts";

test("parses Slack approval Block Kit action values", () => {
  const payload = {
    type: "block_actions",
    user: {
      id: "U123",
    },
    actions: [{
      action_id: "agentspace_approval_approve",
      value: JSON.stringify({
        provider: "slack",
        kind: "runtime_tool_approval",
        approvalId: "approval-1",
        payloadHash: "payload-hash-1",
      }),
    }],
  };

  assert.equal(isSlackInteractionPayload(payload), true);
  assert.equal(isSlackBlockActionsPayload(payload), true);
  assert.deepEqual(parseSlackApprovalBlockActionPayload(payload), {
    approvalId: "approval-1",
    decision: "approved",
    payloadHash: "payload-hash-1",
    token: "",
  });
});

test("builds stable Slack approval action hashes without storing raw action payloads", () => {
  const approval = {
    id: "approval-1",
    type: "runtime_tool" as const,
    sourceId: "task-1",
    agentId: "Atlas",
    channelName: "general",
    status: "pending" as const,
    contentPreview: "Run shell command",
    metadata: {
      toolName: "shell",
      toolInput: {
        command: "npm test",
      },
    },
    createdAt: "2026-07-08T00:00:00.000Z",
  };

  const action = buildSlackApprovalBlockAction(approval);
  assert.equal(action.approvalId, "approval-1");
  assert.equal(action.payloadHash, buildSlackApprovalPayloadHash(approval));
  assert.equal(action.token, "");
  assert.match(action.payloadHash, /^[a-f0-9]{64}$/);
  assert.notEqual(buildSlackApprovalPayloadHash({
    ...approval,
    contentPreview: "Run another command",
  }), action.payloadHash);
});
