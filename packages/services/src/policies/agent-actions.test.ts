import assert from "node:assert/strict";
import test from "node:test";
import { decideAgentActionPolicySync, type AgentActionPolicyInput } from "./agent-actions.ts";

test("Agent action policy allows external document reads after resource checks", () => {
  const decision = decideAgentActionPolicySync(policyInput({
    action: {
      type: "external_document.read",
      resourceType: "feishu.sheet",
      resourceId: "sheetToken",
      operationSummary: "Read Feishu Sheet range Sheet1!A1:B2.",
      provider: "feishu",
      riskLevel: "low",
    },
  }));

  assert.equal(decision.decision, "allow");
  assert.equal(decision.reasonCode, "agent_action.external_document_read_allowed");
  assert.deepEqual(decision.auditData, {
    workspaceId: "workspace-1",
    actorType: "agent",
    actorId: "Atlas",
    channelName: "general",
    taskId: "task-1",
    runtimeId: undefined,
    actionType: "external_document.read",
    provider: "feishu",
    resourceType: "feishu.sheet",
    resourceId: "sheetToken",
    riskLevel: "low",
    hasPayloadHash: false,
  });
});

test("Agent action policy requires approval for external document writes", () => {
  const decision = decideAgentActionPolicySync(policyInput({
    action: {
      type: "external_document.write",
      resourceType: "feishu.sheet",
      resourceId: "sheetToken",
      operationSummary: "Update Feishu Sheet range Sheet1!A1:B2.",
      payloadHash: "sha256:test",
      provider: "feishu",
      riskLevel: "medium",
    },
  }));

  assert.equal(decision.decision, "require_approval");
  assert.equal(decision.reasonCode, "agent_action.external_document_write_requires_approval");
  assert.equal(decision.approvalType, "external_data_operation");
  assert.equal(decision.requiredReviewerRole, "channel_manager");
  assert.equal(decision.auditData?.hasPayloadHash, true);
});

test("Agent action policy allows low-risk bound external transport messages", () => {
  const decision = decideAgentActionPolicySync(policyInput({
    action: {
      type: "external_message.send",
      resourceType: "feishu.chat",
      resourceId: "oc_general",
      operationSummary: "Send Feishu text reply to a bound chat.",
      provider: "feishu",
      riskLevel: "low",
    },
  }));

  assert.equal(decision.decision, "allow");
  assert.equal(decision.reasonCode, "agent_action.low_risk_external_message_send_allowed");
});

test("Agent action policy requires approval for external messages without low-risk transport context", () => {
  const decision = decideAgentActionPolicySync(policyInput({
    action: {
      type: "external_message.send",
      resourceType: "feishu.chat",
      resourceId: "oc_general",
      operationSummary: "Send Feishu announcement.",
      provider: "feishu",
      riskLevel: "medium",
    },
  }));

  assert.equal(decision.decision, "require_approval");
  assert.equal(decision.reasonCode, "agent_action.external_message_send_requires_approval");
  assert.equal(decision.approvalType, "external_message_send");
});

test("Agent action policy denies invalid actor inputs before provider execution", () => {
  const decision = decideAgentActionPolicySync({
    workspaceId: "workspace-1",
    actor: {
      type: "agent",
      agentId: "",
    },
    action: {
      type: "external_document.read",
      operationSummary: "Read Feishu Doc.",
    },
  });

  assert.equal(decision.decision, "deny");
  assert.equal(decision.reasonCode, "agent_action.actor_missing");
});

function policyInput(input: {
  action: AgentActionPolicyInput["action"];
}): AgentActionPolicyInput {
  return {
    workspaceId: "workspace-1",
    actor: {
      type: "agent",
      agentId: "Atlas",
    },
    channelName: "general",
    taskId: "task-1",
    action: input.action,
  };
}
