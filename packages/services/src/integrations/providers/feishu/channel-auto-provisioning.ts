import { createHash } from "node:crypto";
import {
  createExternalMessageOutboxSync,
  readExternalChannelBindingByExternalChatSync,
  readExternalChannelBindingByProviderChatSync,
  upsertExternalChannelBindingSync,
  type ExternalChannelBindingRecord,
  type ExternalIntegrationRecord,
} from "@agent-space/db";
import { addChannelEmployeesSync, createChannelSync } from "../../../channels/channels.ts";
import { readWorkspaceStateSync } from "../../../shared/state-io.ts";
import { sameValue, slugify } from "../../../shared/helpers.ts";
import { FEISHU_PROVIDER_ID } from "./constants.ts";
import { asRecord, asString } from "./events.ts";
import { buildFeishuInteractiveCardOutboundMessage } from "./outbound.ts";

export type FeishuChannelProvisionSource = "manual" | "bot_added" | "first_message" | "agentspace_created";
export type FeishuChannelReviewStatus = "approved" | "pending_admin_review" | "needs_identity_binding";
export type FeishuBotAddedAutoProvisionMode = "auto_create_channel" | "pending_admin_review" | "disabled";
export type FeishuFirstMessageAutoProvisionMode =
  | "auto_create_if_bot_mentioned"
  | "pending_admin_review"
  | "reply_with_setup_card"
  | "disabled";

export interface FeishuChannelAutoProvisionPolicy {
  botAdded: FeishuBotAddedAutoProvisionMode;
  firstMessage: FeishuFirstMessageAutoProvisionMode;
  reviewStatus: FeishuChannelReviewStatus;
}

export interface ResolveOrProvisionFeishuChannelBindingInput {
  workspaceId: string;
  integration: ExternalIntegrationRecord;
  agentId: string;
  externalChatId: string;
  externalChatType?: string;
  externalChatName?: string;
  provisionSource: Exclude<FeishuChannelProvisionSource, "manual" | "agentspace_created">;
  createdByExternalActorId?: string;
  createdByUserId?: string;
}

export interface FeishuChannelAutoProvisionResult {
  binding: ExternalChannelBindingRecord;
  channelName: string;
  createdChannel: boolean;
  createdBinding: boolean;
  reusedProviderChannel: boolean;
  addedAgentToChannel: boolean;
  provisionSource: FeishuChannelProvisionSource;
  reviewStatus: FeishuChannelReviewStatus;
}

export function readFeishuChannelAutoProvisionPolicy(
  integration: ExternalIntegrationRecord,
): FeishuChannelAutoProvisionPolicy {
  const config = parseJsonRecord(integration.configJson);
  const policy = asRecord(config?.channelAutoProvisioning)
    ?? asRecord(config?.autoProvisioning)
    ?? asRecord(config?.autoProvision);
  return {
    botAdded: normalizeBotAddedMode(asString(policy?.botAdded), "auto_create_channel"),
    firstMessage: normalizeFirstMessageMode(asString(policy?.firstMessage), "auto_create_if_bot_mentioned"),
    reviewStatus: normalizeReviewStatus(asString(policy?.reviewStatus), "approved") ?? "approved",
  };
}

export function shouldAutoProvisionFeishuChannelForFirstMessage(input: {
  integration: ExternalIntegrationRecord;
  botMentioned: boolean;
}): boolean {
  const policy = readFeishuChannelAutoProvisionPolicy(input.integration);
  if (policy.firstMessage === "disabled" || policy.firstMessage === "reply_with_setup_card") {
    return false;
  }
  if (policy.firstMessage === "pending_admin_review") {
    return true;
  }
  return input.botMentioned;
}

export function shouldAutoProvisionFeishuChannelForBotAdded(
  integration: ExternalIntegrationRecord,
): boolean {
  return readFeishuChannelAutoProvisionPolicy(integration).botAdded !== "disabled";
}

export function readFeishuChannelBindingReviewStatus(
  binding: ExternalChannelBindingRecord,
): FeishuChannelReviewStatus {
  return readReviewStatus(binding) ?? "approved";
}

export function resolveOrProvisionFeishuChannelBindingSync(
  input: ResolveOrProvisionFeishuChannelBindingInput,
): FeishuChannelAutoProvisionResult {
  const workspaceId = input.workspaceId;
  const externalChatId = requireText(input.externalChatId, "feishu.channel_auto_provisioning.missing_chat_id");
  const agentId = requireText(input.agentId, "feishu.channel_auto_provisioning.missing_agent_id");
  const existingForIntegration = readExternalChannelBindingByExternalChatSync({
    workspaceId,
    integrationId: input.integration.id,
    externalChatId,
  });
  if (existingForIntegration) {
    if (existingForIntegration.status !== "active") {
      const restored = reactivateExistingFeishuChannelBindingSync({
        input,
        binding: existingForIntegration,
        agentId,
        externalChatId,
      });
      return {
        binding: restored.binding,
        channelName: restored.binding.channelName,
        createdChannel: false,
        createdBinding: false,
        reusedProviderChannel: false,
        addedAgentToChannel: restored.addedAgentToChannel,
        provisionSource: readProvisionSource(restored.binding) ?? input.provisionSource,
        reviewStatus: readReviewStatus(restored.binding) ?? "approved",
      };
    }
    const addedAgentToChannel = ensureAgentInChannelSync({
      workspaceId,
      channelName: existingForIntegration.channelName,
      agentId,
    });
    return {
      binding: existingForIntegration,
      channelName: existingForIntegration.channelName,
      createdChannel: false,
      createdBinding: false,
      reusedProviderChannel: false,
      addedAgentToChannel,
      provisionSource: readProvisionSource(existingForIntegration) ?? input.provisionSource,
      reviewStatus: readReviewStatus(existingForIntegration) ?? "approved",
    };
  }

  const providerBinding = readExternalChannelBindingByProviderChatSync({
    workspaceId,
    provider: FEISHU_PROVIDER_ID,
    tenantKey: input.integration.tenantKey,
    externalChatId,
    status: "active",
  });
  if (providerBinding) {
    const providerBindingAgentBot = readChannelBindingAgentBotMetadata(providerBinding);
    const addedAgentToChannel = ensureAgentInChannelSync({
      workspaceId,
      channelName: providerBinding.channelName,
      agentId,
    });
    const binding = upsertExternalChannelBindingSync({
      workspaceId,
      integrationId: input.integration.id,
      channelName: providerBinding.channelName,
      externalChatId,
      externalChatType: input.externalChatType ?? providerBinding.externalChatType,
      externalChatName: input.externalChatName ?? providerBinding.externalChatName,
      status: "active",
      syncMode: providerBinding.syncMode,
      metadataJson: buildChannelBindingMetadata({
        integration: input.integration,
        agentId,
        provisionSource: input.provisionSource,
        reviewStatus: readReviewStatus(providerBinding) ?? "approved",
        externalChatId,
        createdByExternalActorId: input.createdByExternalActorId,
        linkedFromBindingId: providerBinding.id,
        linkedFromAgentId: providerBindingAgentBot.agentId,
        linkedFromBotBindingId: providerBindingAgentBot.botBindingId,
      }),
      createdByUserId: input.createdByUserId,
    });
    return {
      binding,
      channelName: binding.channelName,
      createdChannel: false,
      createdBinding: true,
      reusedProviderChannel: true,
      addedAgentToChannel,
      provisionSource: input.provisionSource,
      reviewStatus: readReviewStatus(binding) ?? "approved",
    };
  }

  const policy = readFeishuChannelAutoProvisionPolicy(input.integration);
  const reviewStatus = isPendingReviewProvision(input.provisionSource, policy)
    ? "pending_admin_review"
    : policy.reviewStatus;
  const channelName = resolveAutoProvisionedChannelName({
    workspaceId,
    externalChatId,
    externalChatName: input.externalChatName,
  });
  createChannelSync({
    name: channelName,
    employeeNames: [agentId],
    kind: "group",
  }, workspaceId);
  const binding = upsertExternalChannelBindingSync({
    workspaceId,
    integrationId: input.integration.id,
    channelName,
    externalChatId,
    externalChatType: input.externalChatType ?? "group",
    externalChatName: input.externalChatName,
    status: "active",
    syncMode: "mirror",
    metadataJson: buildChannelBindingMetadata({
      integration: input.integration,
      agentId,
      provisionSource: input.provisionSource,
      reviewStatus,
      externalChatId,
      createdByExternalActorId: input.createdByExternalActorId,
    }),
    createdByUserId: input.createdByUserId,
  });
  return {
    binding,
    channelName,
    createdChannel: true,
    createdBinding: true,
    reusedProviderChannel: false,
    addedAgentToChannel: true,
    provisionSource: input.provisionSource,
    reviewStatus,
  };
}

export function queueFeishuChannelAutoProvisionConfirmationOutboxSync(input: {
  workspaceId: string;
  integrationId: string;
  binding: ExternalChannelBindingRecord;
  agentId: string;
  result: Pick<FeishuChannelAutoProvisionResult, "createdChannel" | "reusedProviderChannel" | "reviewStatus">;
  targetExternalThreadId?: string;
}) {
  const outbound = buildFeishuInteractiveCardOutboundMessage({
    targetExternalChatId: input.binding.externalChatId,
    targetExternalThreadId: input.targetExternalThreadId,
    card: buildFeishuChannelAutoProvisionConfirmationCard({
      channelName: input.binding.channelName,
      agentId: input.agentId,
      createdChannel: input.result.createdChannel,
      reusedProviderChannel: input.result.reusedProviderChannel,
      reviewStatus: input.result.reviewStatus,
    }),
  });
  return createExternalMessageOutboxSync({
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
    channelBindingId: input.binding.id,
    targetExternalChatId: outbound.targetExternalChatId,
    targetExternalThreadId: outbound.targetExternalThreadId,
    payloadJson: outbound.payload,
  });
}

export function queueFeishuChannelSetupCardOutboxSync(input: {
  workspaceId: string;
  integrationId: string;
  targetExternalChatId: string;
  targetExternalThreadId?: string;
  agentId: string;
  settingsUrl?: string;
}) {
  const outbound = buildFeishuInteractiveCardOutboundMessage({
    targetExternalChatId: input.targetExternalChatId,
    targetExternalThreadId: input.targetExternalThreadId,
    card: buildFeishuChannelSetupCard({
      agentId: input.agentId,
      settingsUrl: input.settingsUrl,
    }),
  });
  return createExternalMessageOutboxSync({
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
    targetExternalChatId: outbound.targetExternalChatId,
    targetExternalThreadId: outbound.targetExternalThreadId,
    payloadJson: outbound.payload,
  });
}

function reactivateExistingFeishuChannelBindingSync(input: {
  input: ResolveOrProvisionFeishuChannelBindingInput;
  binding: ExternalChannelBindingRecord;
  agentId: string;
  externalChatId: string;
}): {
  binding: ExternalChannelBindingRecord;
  addedAgentToChannel: boolean;
} {
  const addedAgentToChannel = ensureAgentInChannelSync({
    workspaceId: input.input.workspaceId,
    channelName: input.binding.channelName,
    agentId: input.agentId,
  });
  const binding = upsertExternalChannelBindingSync({
    workspaceId: input.input.workspaceId,
    integrationId: input.input.integration.id,
    channelName: input.binding.channelName,
    externalChatId: input.externalChatId,
    externalChatType: input.input.externalChatType ?? input.binding.externalChatType,
    externalChatName: input.input.externalChatName ?? input.binding.externalChatName,
    status: "active",
    syncMode: input.binding.syncMode,
    metadataJson: buildChannelBindingMetadata({
      integration: input.input.integration,
      agentId: input.agentId,
      provisionSource: input.input.provisionSource,
      reviewStatus: readReviewStatus(input.binding) ?? "approved",
      externalChatId: input.externalChatId,
      createdByExternalActorId: input.input.createdByExternalActorId,
      restoredFromStatus: input.binding.status,
      restoredBindingId: input.binding.id,
    }),
    createdByUserId: input.input.createdByUserId,
  });
  return {
    binding,
    addedAgentToChannel,
  };
}

function ensureAgentInChannelSync(input: {
  workspaceId: string;
  channelName: string;
  agentId: string;
}): boolean {
  const state = readWorkspaceStateSync(input.workspaceId);
  const channel = state.channels.find((item) => sameValue(item.name, input.channelName));
  if (!channel) {
    throw new Error(`Channel "${input.channelName}" does not exist.`);
  }
  if (channel.employeeNames.some((name) => sameValue(name, input.agentId))) {
    return false;
  }
  addChannelEmployeesSync({
    channelName: channel.name,
    employeeNames: [input.agentId],
  }, input.workspaceId);
  return true;
}

function resolveAutoProvisionedChannelName(input: {
  workspaceId: string;
  externalChatId: string;
  externalChatName?: string;
}): string {
  const state = readWorkspaceStateSync(input.workspaceId);
  const existingNames = state.channels.map((channel) => channel.name);
  const suffix = shortHash(input.externalChatId);
  const baseSource = input.externalChatName?.trim() || `feishu-${suffix}`;
  const base = truncateChannelName(`feishu-${slugify(baseSource)}`);
  if (!existingNames.some((name) => sameValue(name, base))) {
    return base;
  }
  const withHash = truncateChannelName(`${base}-${suffix}`);
  if (!existingNames.some((name) => sameValue(name, withHash))) {
    return withHash;
  }
  for (let index = 2; index < 100; index += 1) {
    const candidate = truncateChannelName(`${base}-${suffix}-${index}`);
    if (!existingNames.some((name) => sameValue(name, candidate))) {
      return candidate;
    }
  }
  return `feishu-${suffix}-${Date.now().toString(36)}`;
}

function buildChannelBindingMetadata(input: {
  integration: ExternalIntegrationRecord;
  agentId: string;
  provisionSource: FeishuChannelProvisionSource;
  reviewStatus: FeishuChannelReviewStatus;
  externalChatId: string;
  createdByExternalActorId?: string;
  linkedFromBindingId?: string;
  linkedFromAgentId?: string;
  linkedFromBotBindingId?: string;
  restoredFromStatus?: string;
  restoredBindingId?: string;
}): Record<string, unknown> {
  const createdByExternalActorReference = input.createdByExternalActorId
    ? shortHash(input.createdByExternalActorId)
    : undefined;
  return {
    provider: FEISHU_PROVIDER_ID,
    provisionSource: input.provisionSource,
    reviewStatus: input.reviewStatus,
    agentId: input.agentId,
    botBindingId: input.integration.id,
    tenantKey: input.integration.tenantKey,
    externalChatReference: shortHash(input.externalChatId),
    createdByExternalActorReference,
    linkedFromBindingId: input.linkedFromBindingId,
    linkedFromAgentId: input.linkedFromAgentId,
    linkedFromBotBindingId: input.linkedFromBotBindingId,
    restoredFromStatus: input.restoredFromStatus,
    restoredBindingId: input.restoredBindingId,
    autoProvisionedAt: new Date().toISOString(),
  };
}

function buildFeishuChannelAutoProvisionConfirmationCard(input: {
  channelName: string;
  agentId: string;
  createdChannel: boolean;
  reusedProviderChannel: boolean;
  reviewStatus: FeishuChannelReviewStatus;
}): Record<string, unknown> {
  const action = input.createdChannel
    ? "AgentSpace channel 已自动创建"
    : input.reusedProviderChannel
      ? "已复用现有 AgentSpace channel"
      : "AgentSpace channel 已确认";
  return {
    config: { wide_screen_mode: true },
    header: {
      template: input.reviewStatus === "approved" ? "green" : "yellow",
      title: {
        tag: "plain_text",
        content: `${input.agentId} · AgentSpace`,
      },
    },
    elements: [{
      tag: "markdown",
      content: [
        `**${action}**`,
        `Channel: ${input.channelName}`,
        `Agent: ${input.agentId}`,
        `Review: ${input.reviewStatus}`,
      ].join("\n"),
    }],
  };
}

function buildFeishuChannelSetupCard(input: {
  agentId: string;
  settingsUrl?: string;
}): Record<string, unknown> {
  const elements: Record<string, unknown>[] = [{
    tag: "markdown",
    content: [
      "**AgentSpace channel setup required**",
      `Agent: ${input.agentId}`,
      "这个飞书群还没有连接 AgentSpace channel。管理员完成 channel 绑定后，AgentSpace 才会在这里调度 Agent。",
    ].join("\n"),
  }];
  if (input.settingsUrl) {
    elements.push({
      tag: "action",
      actions: [{
        tag: "button",
        text: {
          tag: "plain_text",
          content: "Open AgentSpace",
        },
        type: "primary",
        url: input.settingsUrl,
      }],
    });
  }
  return {
    config: { wide_screen_mode: true },
    header: {
      template: "yellow",
      title: {
        tag: "plain_text",
        content: `${input.agentId} · AgentSpace`,
      },
    },
    elements,
  };
}

function readProvisionSource(binding: ExternalChannelBindingRecord): FeishuChannelProvisionSource | undefined {
  const metadata = parseJsonRecord(binding.metadataJson);
  const value = asString(metadata?.provisionSource);
  return value === "manual" ||
    value === "bot_added" ||
    value === "first_message" ||
    value === "agentspace_created"
    ? value
    : undefined;
}

function readReviewStatus(binding: ExternalChannelBindingRecord): FeishuChannelReviewStatus | undefined {
  const metadata = parseJsonRecord(binding.metadataJson);
  return normalizeReviewStatus(asString(metadata?.reviewStatus), undefined);
}

function readChannelBindingAgentBotMetadata(
  binding: ExternalChannelBindingRecord,
): { agentId?: string; botBindingId?: string } {
  const metadata = parseJsonRecord(binding.metadataJson);
  const agentId = asString(metadata?.agentId)?.trim();
  const botBindingId = asString(metadata?.botBindingId)?.trim();
  return {
    agentId: agentId ? agentId : undefined,
    botBindingId: botBindingId ? botBindingId : undefined,
  };
}

function normalizeBotAddedMode(
  value: string | undefined,
  fallback: FeishuBotAddedAutoProvisionMode,
): FeishuBotAddedAutoProvisionMode {
  return value === "auto_create_channel" || value === "pending_admin_review" || value === "disabled"
    ? value
    : fallback;
}

function normalizeFirstMessageMode(
  value: string | undefined,
  fallback: FeishuFirstMessageAutoProvisionMode,
): FeishuFirstMessageAutoProvisionMode {
  return value === "auto_create_if_bot_mentioned" ||
    value === "pending_admin_review" ||
    value === "reply_with_setup_card" ||
    value === "disabled"
    ? value
    : fallback;
}

function normalizeReviewStatus(
  value: string | undefined,
  fallback: FeishuChannelReviewStatus | undefined,
): FeishuChannelReviewStatus | undefined {
  return value === "approved" || value === "pending_admin_review" || value === "needs_identity_binding"
    ? value
    : fallback;
}

function isPendingReviewProvision(
  source: FeishuChannelProvisionSource,
  policy: FeishuChannelAutoProvisionPolicy,
): boolean {
  return (source === "bot_added" && policy.botAdded === "pending_admin_review") ||
    (source === "first_message" && policy.firstMessage === "pending_admin_review");
}

function requireText(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(errorCode);
  }
  return normalized;
}

function truncateChannelName(value: string): string {
  return value.length > 64 ? value.slice(0, 64).replace(/-+$/g, "") : value;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}
