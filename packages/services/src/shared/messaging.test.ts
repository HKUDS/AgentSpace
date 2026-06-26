import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWorkspaceDataPolicyToExternalMessageInput,
  buildExternalMessageData,
} from "./messaging.ts";

test("buildExternalMessageData converts untrusted external input into workspace message metadata", () => {
  assert.deepEqual(buildExternalMessageData({
    provider: "feishu",
    providerLabel: "Feishu/Lark",
    externalEventId: "evt-1",
    externalMessageId: "om-1",
    externalChatId: "oc-general",
    trust: "untrusted_user_message",
  }), {
    external_provider: "feishu",
    external_provider_label: "Feishu/Lark",
    external_event_id: "evt-1",
    external_message_id: "om-1",
    external_chat_id: "oc-general",
    external_trust: "untrusted_user_message",
    workspace_data_policy_decision: "allow",
    workspace_data_policy_reason: "workspace_data.external_untrusted_user_message_allowed",
    workspace_data_classification: "external_untrusted_user_content",
    workspace_data_store: "true",
    workspace_data_search: "true",
    workspace_data_agent_context: "true",
  });

  assert.equal(buildExternalMessageData(undefined), undefined);
});

test("applyWorkspaceDataPolicyToExternalMessageInput attaches reusable policy metadata", () => {
  const input = applyWorkspaceDataPolicyToExternalMessageInput({
    provider: "feishu",
    externalMessageId: "om-1",
    trust: "untrusted_user_message",
  }, "workspace-1");

  assert.equal(input?.workspaceDataPolicy?.decision, "allow");
  assert.equal(input?.workspaceDataPolicy?.classification, "external_untrusted_user_content");
  assert.deepEqual(input?.workspaceDataPolicy?.allowedUses, {
    storeInWorkspace: true,
    includeInSearch: true,
    includeInAgentContext: true,
  });
});
