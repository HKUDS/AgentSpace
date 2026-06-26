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

export interface FeishuExternalParticipantPolicy {
  unboundUserMode: FeishuUnboundUserMode;
  guestPermissionProfile: FeishuGuestPermissionProfile;
  requireIdentityFor: string[];
}

export interface FeishuExternalGuestDecision {
  decision: "allow" | "ignore" | "require_identity";
  policy: FeishuExternalParticipantPolicy;
  reasonCode: string;
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
}

export const FEISHU_EXTERNAL_GUEST_DISPLAY_NAME = "Feishu Guest";

export function evaluateFeishuExternalGuestPolicy(input: {
  integration: ExternalIntegrationRecord;
  botMentioned: boolean;
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
    requireIdentityFor: normalizeStringArray(policy?.requireIdentityFor, [
      "writes",
      "approvals",
      "private_resources",
      "runtime_sensitive_tools",
    ]),
  };
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

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const normalized = value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter(Boolean);
  return normalized.length > 0 ? normalized : fallback;
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
