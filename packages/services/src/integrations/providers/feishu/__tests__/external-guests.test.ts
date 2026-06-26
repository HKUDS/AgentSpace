import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateFeishuExternalGuestIdentityRequirement,
  type FeishuExternalParticipantPolicy,
} from "../external-guests.ts";

test("external guest identity requirements keep writes and approvals hard-gated", () => {
  const relaxedPolicy: Pick<FeishuExternalParticipantPolicy, "requireIdentityFor"> = {
    requireIdentityFor: [],
  };

  assert.deepEqual(evaluateFeishuExternalGuestIdentityRequirement({
    policy: relaxedPolicy,
    action: "writes",
  }), {
    decision: "require_identity",
    action: "writes",
    policy: relaxedPolicy,
    reasonCode: "feishu_external_guest_write_identity_required",
    policyConfigured: false,
  });
  assert.equal(evaluateFeishuExternalGuestIdentityRequirement({
    policy: relaxedPolicy,
    action: "approvals",
  }).decision, "require_identity");
});

test("external guest identity requirements honor configurable private resource gates", () => {
  const policy: Pick<FeishuExternalParticipantPolicy, "requireIdentityFor"> = {
    requireIdentityFor: ["private_resources"],
  };

  assert.deepEqual(evaluateFeishuExternalGuestIdentityRequirement({
    policy,
    action: "private_resources",
  }), {
    decision: "require_identity",
    action: "private_resources",
    policy,
    reasonCode: "feishu_external_guest_private_resource_identity_required",
    policyConfigured: true,
  });
  assert.deepEqual(evaluateFeishuExternalGuestIdentityRequirement({
    policy,
    action: "runtime_sensitive_tools",
  }), {
    decision: "allow",
    action: "runtime_sensitive_tools",
    policy,
    reasonCode: "feishu_external_guest_identity_not_required",
    policyConfigured: false,
  });
});
