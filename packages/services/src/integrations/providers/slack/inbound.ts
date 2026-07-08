import {
  createExternalMessageMappingSync,
  readExternalChannelBindingByExternalChatSync,
  readExternalMessageMappingByExternalMessageSync,
  readExternalUserBindingByExternalUserSync,
  readUserSync,
  recordExternalIntegrationEventSync,
  updateExternalIntegrationEventStatusSync,
  type ExternalIntegrationEventRecord,
  type ExternalIntegrationRecord,
  type ExternalMessageMappingRecord,
} from "@agent-space/db";
import type { AgentSpaceState, WorkspaceMessage } from "@agent-space/domain/workspace";
import type { ExternalMessageEnvelope, IntegrationRuntimeContext } from "../../core/index.ts";
import { sendChannelHumanMessageSync } from "../../../messages/messages.ts";
import { SLACK_PROVIDER_ID } from "./constants.ts";
import {
  isSlackAgentContextChangedEvent,
  resolveSlackEventId,
  resolveSlackEventReceivedAt,
  resolveSlackEventType,
  resolveSlackAppHomeOpenedMessagesTabEvent,
  summarizeSlackAgentContextPayload,
  summarizeSlackInboundEventPayload,
} from "./events.ts";
import {
  ensureSlackAgentMentionText,
  normalizeSlackInboundMessage,
} from "./normalize-message.ts";
import { queueSlackAppHomeOpenedWelcomeOutboxSync } from "./outbound.ts";

export interface SlackInboundProcessResult {
  event: ExternalIntegrationEventRecord;
  message: ExternalMessageEnvelope | null;
  dispatchStatus: "sent" | "duplicate" | "ignored" | "failed";
  reasonCode?: string;
  mappedChannelName?: string;
  mapping?: ExternalMessageMappingRecord;
  agentSpaceMessageId?: string;
}

export interface ProcessSlackInboundEventInput {
  context: IntegrationRuntimeContext;
  payload: Record<string, unknown>;
  integration?: ExternalIntegrationRecord;
}

export function processSlackInboundEventSync(input: ProcessSlackInboundEventInput): SlackInboundProcessResult {
  const externalEventId = resolveSlackEventId(input.payload);
  const event = recordExternalIntegrationEventSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    provider: SLACK_PROVIDER_ID,
    externalEventId,
    eventType: resolveSlackEventType(input.payload),
    payloadJson: summarizeSlackInboundEventPayload(input.payload),
    receivedAt: resolveSlackEventReceivedAt(input.payload),
  });
  if (isSlackAgentContextChangedEvent(input.payload)) {
    return finishIgnored({
      context: input.context,
      event,
      message: null,
      reasonCode: "slack.agent_context_changed",
    });
  }
  const appHomeOpened = resolveSlackAppHomeOpenedMessagesTabEvent(input.payload);
  if (appHomeOpened) {
    const agentContext = summarizeSlackAgentContextPayload(input.payload);
    if (!input.integration) {
      return finishIgnored({
        context: input.context,
        event,
        message: null,
        reasonCode: "slack.app_home_opened_integration_missing",
      });
    }
    const welcomeResult = queueSlackAppHomeOpenedWelcomeOutboxSync({
      workspaceId: input.context.workspaceId,
      integration: input.integration,
      externalChatId: appHomeOpened.externalChatId,
      externalUserId: appHomeOpened.externalUserId,
      externalEventId,
      agentContext,
    });
    return finishIgnored({
      context: input.context,
      event,
      message: null,
      reasonCode: welcomeResult.status === "queued"
        ? "slack.app_home_opened_welcome_queued"
        : welcomeResult.reasonCode,
    });
  }
  const botUserId = readSlackBotUserId(input.integration?.configJson);
  const message = normalizeSlackInboundMessage({
    context: input.context,
    payload: input.payload,
    botUserId,
  });
  if (!message) {
    return finishIgnored({
      context: input.context,
      event,
      message: null,
      reasonCode: "slack.non_message_event",
    });
  }

  const existingMapping = readExternalMessageMappingByExternalMessageSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    externalMessageId: message.externalMessageId,
  });
  if (existingMapping) {
    const ignored = updateExternalIntegrationEventStatusSync({
      workspaceId: input.context.workspaceId,
      provider: SLACK_PROVIDER_ID,
      externalEventId,
      status: "ignored",
      errorMessage: "duplicate_external_message",
    });
    return {
      event: ignored,
      message,
      dispatchStatus: "duplicate",
      reasonCode: "duplicate_external_message",
      mapping: existingMapping,
    };
  }

  const channelBinding = readExternalChannelBindingByExternalChatSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    externalChatId: message.externalChatId,
  });
  if (!channelBinding || channelBinding.status !== "active") {
    return finishIgnored({
      context: input.context,
      event,
      message,
      reasonCode: "slack.channel_binding_missing",
    });
  }

  const userBinding = message.externalSenderId
    ? readExternalUserBindingByExternalUserSync({
        workspaceId: input.context.workspaceId,
        integrationId: input.context.integrationId,
        externalUserId: message.externalSenderId,
      })
    : null;
  if (!userBinding || userBinding.status !== "active") {
    return finishIgnored({
      context: input.context,
      event,
      message,
      reasonCode: "slack.user_binding_missing",
    });
  }

  const user = readUserSync(userBinding.userId);
  const displayName = user?.displayName ?? userBinding.displayName ?? `Slack ${message.externalSenderId}`;
  const text = ensureSlackAgentMentionText({
    text: message.text ?? "",
    agentId: input.integration?.agentId,
  });
  const agentContext = summarizeSlackAgentContextPayload(input.payload);
  const externalContext = agentContext
    ? JSON.stringify({ slackAgentContext: agentContext })
    : undefined;
  let state: AgentSpaceState;
  try {
    state = sendChannelHumanMessageSync(
      channelBinding.channelName,
      displayName,
      text,
      [],
      undefined,
      input.context.workspaceId,
      userBinding.userId,
      {
        provider: SLACK_PROVIDER_ID,
        providerLabel: "Slack",
        externalEventId: message.externalEventId,
        externalMessageId: message.externalMessageId,
        externalChatId: message.externalChatId,
        externalContext,
        trust: "untrusted_user_message",
        actor: {
          actorType: "user",
          userId: userBinding.userId,
          externalActorReference: `slack:${message.externalSenderId}`,
          agentId: input.integration?.agentId,
          botBindingId: input.integration?.agentId ? input.integration.id : undefined,
        },
      },
    );
  } catch (error) {
    const failed = updateExternalIntegrationEventStatusSync({
      workspaceId: input.context.workspaceId,
      provider: SLACK_PROVIDER_ID,
      externalEventId,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return {
      event: failed,
      message,
      mappedChannelName: channelBinding.channelName,
      dispatchStatus: "failed",
      reasonCode: "slack.dispatch_failed",
    };
  }

  const agentSpaceMessage = findDispatchedWorkspaceMessage(state, message);
  const mapping = createExternalMessageMappingSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    channelBindingId: channelBinding.id,
    direction: "inbound",
    externalMessageId: message.externalMessageId,
    externalThreadId: message.externalThreadId,
    externalSenderId: message.externalSenderId,
    externalEventId: message.externalEventId,
    agentSpaceMessageId: agentSpaceMessage?.id,
    metadataJson: {
      provider: SLACK_PROVIDER_ID,
      channelName: channelBinding.channelName,
      slackChannelType: channelBinding.externalChatType,
      agentContext,
    },
  });
  const processed = updateExternalIntegrationEventStatusSync({
    workspaceId: input.context.workspaceId,
    provider: SLACK_PROVIDER_ID,
    externalEventId,
    status: "processed",
  });
  return {
    event: processed,
    message,
    mappedChannelName: channelBinding.channelName,
    dispatchStatus: "sent",
    mapping,
    agentSpaceMessageId: agentSpaceMessage?.id,
  };
}

export async function processSlackInboundEvent(input: ProcessSlackInboundEventInput): Promise<SlackInboundProcessResult> {
  return processSlackInboundEventSync(input);
}

function finishIgnored(input: {
  context: IntegrationRuntimeContext;
  event: ExternalIntegrationEventRecord;
  message: ExternalMessageEnvelope | null;
  reasonCode: string;
}): SlackInboundProcessResult {
  const ignored = updateExternalIntegrationEventStatusSync({
    workspaceId: input.context.workspaceId,
    provider: SLACK_PROVIDER_ID,
    externalEventId: input.event.externalEventId,
    status: "ignored",
    errorMessage: input.reasonCode,
  });
  return {
    event: ignored,
    message: input.message,
    dispatchStatus: "ignored",
    reasonCode: input.reasonCode,
  };
}

function findDispatchedWorkspaceMessage(
  state: AgentSpaceState,
  externalMessage: ExternalMessageEnvelope,
): WorkspaceMessage | undefined {
  return state.messages.find((message) =>
    message.data?.external_provider === SLACK_PROVIDER_ID &&
    message.data.external_message_id === externalMessage.externalMessageId
  );
}

function readSlackBotUserId(configJson: string | undefined): string | undefined {
  if (!configJson) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(configJson) as Record<string, unknown>;
    const bot = typeof parsed.bot === "object" && parsed.bot !== null && !Array.isArray(parsed.bot)
      ? parsed.bot as Record<string, unknown>
      : undefined;
    return typeof bot?.botUserId === "string" ? bot.botUserId : undefined;
  } catch {
    return undefined;
  }
}
