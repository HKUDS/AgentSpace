import { createHash } from "node:crypto";
import type { ExternalIntegrationRecord } from "@agent-space/db";
import { readWorkspaceStateSync, writeWorkspaceStateSync } from "../../../shared/state-io.ts";
import { sameValue, uniqueNames } from "../../../shared/helpers.ts";
import { asRecord, asString } from "./events.ts";
import { isFeishuAgentBotBinding } from "./agent-bot-bindings.ts";
import { FEISHU_PROVIDER_ID } from "./constants.ts";

export type FeishuUnboundUserMode =
  | "ignore"
  | "reply_on_mention"
  | "reply_all"
  | "require_identity";

export type FeishuGuestPermissionProfile =
  | "none"
  | "channel_context_only"
  | "channel_readonly";

export type FeishuExternalGuestRestrictedAction =
  | "writes"
  | "approvals"
  | "private_resources"
  | "runtime_sensitive_tools";

export interface FeishuExternalParticipantPolicy {
  unboundUserMode: FeishuUnboundUserMode;
  guestPermissionProfile: FeishuGuestPermissionProfile;
  requireIdentityFor: FeishuExternalGuestRestrictedAction[];
}

export interface FeishuExternalGuestDecision {
  decision: "allow" | "ignore" | "require_identity";
  policy: FeishuExternalParticipantPolicy;
  reasonCode: string;
}

export interface FeishuExternalGuestIdentityRequirementDecision {
  decision: "allow" | "require_identity";
  action: FeishuExternalGuestRestrictedAction;
  policy: Pick<FeishuExternalParticipantPolicy, "requireIdentityFor">;
  reasonCode: string;
  policyConfigured: boolean;
}

export interface FeishuExternalGuestActor {
  actorType: "external_guest";
  provider: typeof FEISHU_PROVIDER_ID;
  workspaceId: string;
  tenantKey?: string;
  providerUserRefHash: string;
  providerDisplayName: string;
  sourceChatId: string;
  permissionProfile: FeishuGuestPermissionProfile;
  requireIdentityFor: FeishuExternalGuestRestrictedAction[];
}

export const FEISHU_EXTERNAL_GUEST_DISPLAY_NAME = "Feishu Guest";

export function evaluateFeishuExternalGuestPolicy(input: {
  integration: ExternalIntegrationRecord;
  botMentioned: boolean;
  threadContinuation?: boolean;
}): FeishuExternalGuestDecision {
  const policy = readFeishuExternalParticipantPolicy(input.integration);
  if (policy.unboundUserMode === "ignore") {
    return {
      decision: "ignore",
      policy,
      reasonCode: "feishu_external_guest_ignored",
    };
  }
  if (policy.unboundUserMode === "require_identity") {
    return {
      decision: "require_identity",
      policy,
      reasonCode: "feishu_external_guest_identity_required",
    };
  }
  if (policy.unboundUserMode === "reply_on_mention" && !input.botMentioned) {
    if (input.threadContinuation) {
      return {
        decision: "allow",
        policy,
        reasonCode: "feishu_external_guest_thread_continuation_allowed",
      };
    }
    return {
      decision: "ignore",
      policy,
      reasonCode: "feishu_external_guest_bot_mention_required",
    };
  }
  return {
    decision: "allow",
    policy,
    reasonCode: "feishu_external_guest_allowed",
  };
}

export function readFeishuExternalParticipantPolicy(
  integration: ExternalIntegrationRecord,
): FeishuExternalParticipantPolicy {
  const config = parseJsonRecord(integration.configJson);
  const policy = asRecord(config?.externalGuestPolicy)
    ?? asRecord(config?.externalParticipantPolicy);
  const defaultMode: FeishuUnboundUserMode = isFeishuAgentBotBinding(integration)
    ? "reply_on_mention"
    : "require_identity";
  return {
    unboundUserMode: normalizeUnboundUserMode(asString(policy?.unboundUserMode), defaultMode),
    guestPermissionProfile: normalizeGuestPermissionProfile(
      asString(policy?.guestPermissionProfile),
      "channel_context_only",
    ),
    requireIdentityFor: normalizeRestrictedActions(
      policy?.requireIdentityFor,
      defaultFeishuExternalGuestRequireIdentityFor(),
    ),
  };
}

export function evaluateFeishuExternalGuestIdentityRequirement(input: {
  policy: Pick<FeishuExternalParticipantPolicy, "requireIdentityFor">;
  action: FeishuExternalGuestRestrictedAction;
}): FeishuExternalGuestIdentityRequirementDecision {
  const policyConfigured = input.policy.requireIdentityFor.includes(input.action);
  if (policyConfigured || isHardRequiredExternalGuestIdentityAction(input.action)) {
    return {
      decision: "require_identity",
      action: input.action,
      policy: input.policy,
      reasonCode: resolveExternalGuestIdentityRequirementReasonCode(input.action),
      policyConfigured,
    };
  }
  return {
    decision: "allow",
    action: input.action,
    policy: input.policy,
    reasonCode: "feishu_external_guest_identity_not_required",
    policyConfigured,
  };
}

export function defaultFeishuExternalGuestRequireIdentityFor(): FeishuExternalGuestRestrictedAction[] {
  return [
    "writes",
    "approvals",
    "private_resources",
    "runtime_sensitive_tools",
  ];
}

export function ensureFeishuExternalGuestChannelActorSync(input: {
  workspaceId: string;
  channelName: string;
}): string {
  const state = readWorkspaceStateSync(input.workspaceId);
  const channel = state.channels.find((item) => sameValue(item.name, input.channelName));
  if (!channel) {
    throw new Error(`Channel "${input.channelName}" does not exist.`);
  }
  let changed = false;
  if (!state.humanMembers.some((member) => sameValue(member.name, FEISHU_EXTERNAL_GUEST_DISPLAY_NAME))) {
    state.humanMembers.push({
      name: FEISHU_EXTERNAL_GUEST_DISPLAY_NAME,
      role: "External Guest",
    });
    changed = true;
  }
  if (!resolveHumanNames(channel).some((name) => sameValue(name, FEISHU_EXTERNAL_GUEST_DISPLAY_NAME))) {
    channel.humanMemberNames = uniqueNames([
      ...resolveHumanNames(channel),
      FEISHU_EXTERNAL_GUEST_DISPLAY_NAME,
    ]);
    channel.humanMembers = channel.humanMemberNames.length;
    changed = true;
  }
  if (changed) {
    writeWorkspaceStateSync(state, input.workspaceId);
  }
  return FEISHU_EXTERNAL_GUEST_DISPLAY_NAME;
}

export function buildFeishuExternalGuestActor(input: {
  workspaceId: string;
  tenantKey?: string;
  externalUserId?: string;
  sourceChatId: string;
  permissionProfile: FeishuGuestPermissionProfile;
  requireIdentityFor?: FeishuExternalGuestRestrictedAction[];
}): FeishuExternalGuestActor {
  return {
    actorType: "external_guest",
    provider: FEISHU_PROVIDER_ID,
    workspaceId: input.workspaceId,
    tenantKey: input.tenantKey,
    providerUserRefHash: hashExternalRef([
      FEISHU_PROVIDER_ID,
      input.workspaceId,
      input.tenantKey ?? "",
      input.externalUserId ?? "unknown",
    ].join(":")),
    providerDisplayName: FEISHU_EXTERNAL_GUEST_DISPLAY_NAME,
    sourceChatId: input.sourceChatId,
    permissionProfile: input.permissionProfile,
    requireIdentityFor: input.requireIdentityFor ?? defaultFeishuExternalGuestRequireIdentityFor(),
  };
}

function normalizeUnboundUserMode(
  value: string | undefined,
  fallback: FeishuUnboundUserMode,
): FeishuUnboundUserMode {
  return value === "ignore" ||
    value === "reply_on_mention" ||
    value === "reply_all" ||
    value === "require_identity"
    ? value
    : fallback;
}

function normalizeGuestPermissionProfile(
  value: string | undefined,
  fallback: FeishuGuestPermissionProfile,
): FeishuGuestPermissionProfile {
  return value === "none" ||
    value === "channel_context_only" ||
    value === "channel_readonly"
    ? value
    : fallback;
}

function normalizeRestrictedActions(
  value: unknown,
  fallback: FeishuExternalGuestRestrictedAction[],
): FeishuExternalGuestRestrictedAction[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const normalized = value
    .map((item) => typeof item === "string" ? normalizeRestrictedAction(item) : undefined)
    .filter((item): item is FeishuExternalGuestRestrictedAction => item !== undefined);
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeRestrictedAction(value: string): FeishuExternalGuestRestrictedAction | undefined {
  const normalized = value.trim();
  return normalized === "writes" ||
    normalized === "approvals" ||
    normalized === "private_resources" ||
    normalized === "runtime_sensitive_tools"
    ? normalized
    : undefined;
}

function isHardRequiredExternalGuestIdentityAction(action: FeishuExternalGuestRestrictedAction): boolean {
  return action === "writes" || action === "approvals";
}

function resolveExternalGuestIdentityRequirementReasonCode(action: FeishuExternalGuestRestrictedAction): string {
  switch (action) {
    case "writes":
      return "feishu_external_guest_write_identity_required";
    case "approvals":
      return "feishu_external_guest_approval_identity_required";
    case "private_resources":
      return "feishu_external_guest_private_resource_identity_required";
    case "runtime_sensitive_tools":
      return "feishu_external_guest_runtime_sensitive_tool_identity_required";
  }
}

function resolveHumanNames(channel: {
  humanMemberNames?: string[];
}): string[] {
  return Array.isArray(channel.humanMemberNames) ? channel.humanMemberNames : [];
}

function hashExternalRef(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}
