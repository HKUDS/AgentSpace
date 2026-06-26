import assert from "node:assert/strict";
import test from "node:test";
import {
  decideWorkspaceDataPolicyForExternalMessageSync,
  type WorkspaceDataPolicyInput,
} from "./workspace-data.ts";

test("Workspace data policy allows labeled untrusted external user messages with explicit uses", () => {
  const decision = decideWorkspaceDataPolicyForExternalMessageSync(policyInput());

  assert.equal(decision.decision, "allow");
  assert.equal(decision.reasonCode, "workspace_data.external_untrusted_user_message_allowed");
  assert.equal(decision.classification, "external_untrusted_user_content");
  assert.deepEqual(decision.allowedUses, {
    storeInWorkspace: true,
    includeInSearch: true,
    includeInAgentContext: true,
  });
  assert.deepEqual(decision.auditData, {
    workspaceId: "workspace-1",
    sourceType: "external_message",
    provider: "feishu",
    providerLabel: "Feishu/Lark",
    externalEventId: "evt-1",
    externalMessageId: "om-1",
    externalChatId: "oc-general",
    trust: "untrusted_user_message",
    contentKind: "message",
    hasAttachments: true,
    hasContentHash: false,
  });
});

test("Workspace data policy denies external messages without required trust label", () => {
  const decision = decideWorkspaceDataPolicyForExternalMessageSync(policyInput({
    source: {
      type: "external_message",
      provider: "feishu",
      trust: "system",
    },
  }));

  assert.equal(decision.decision, "deny");
  assert.equal(decision.reasonCode, "workspace_data.external_trust_invalid");
  assert.deepEqual(decision.allowedUses, {
    storeInWorkspace: false,
    includeInSearch: false,
    includeInAgentContext: false,
  });
});

function policyInput(overrides?: Partial<WorkspaceDataPolicyInput>): WorkspaceDataPolicyInput {
  return {
    workspaceId: "workspace-1",
    source: {
      type: "external_message",
      provider: "feishu",
      providerLabel: "Feishu/Lark",
      externalEventId: "evt-1",
      externalMessageId: "om-1",
      externalChatId: "oc-general",
      trust: "untrusted_user_message",
    },
    content: {
      kind: "message",
      hasAttachments: true,
    },
    ...overrides,
  };
}
