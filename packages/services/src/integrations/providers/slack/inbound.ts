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
import type { AgentSpaceState, MessageAttachment, WorkspaceMessage } from "@agent-space/domain/workspace";
import type { ExternalMessageEnvelope, IntegrationRuntimeContext } from "../../core/index.ts";
import { sendChannelHumanMessageSync } from "../../../messages/messages.ts";
import type { SlackInboundAttachmentDownloader } from "./attachments.ts";
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
  attachmentDownloader?: SlackInboundAttachmentDownloader;
}

interface SlackInboundPreparedDispatch {
  context: IntegrationRuntimeContext;
  payload: Record<string, unknown>;
  externalEventId: string;
  event: ExternalIntegrationEventRecord;
  integration?: ExternalIntegrationRecord;
  message: ExternalMessageEnvelope;
  channelBinding: NonNullable<ReturnType<typeof readExternalChannelBindingByExternalChatSync>>;
  userBinding: NonNullable<ReturnType<typeof readExternalUserBindingByExternalUserSync>>;
  displayName: string;
  text: string;
  agentContext: ReturnType<typeof summarizeSlackAgentContextPayload>;
}

type SlackInboundPrepareResult =
  | {
    ready: true;
    dispatch: SlackInboundPreparedDispatch;
  }
  | {
    ready: false;
    result: SlackInboundProcessResult;
  };

export function processSlackInboundEventSync(input: ProcessSlackInboundEventInput): SlackInboundProcessResult {
  const prepared = prepareSlackInboundDispatchSync(input);
  if (!prepared.ready) {
    return prepared.result;
  }
  const attachments = resolveSlackInboundAttachmentsSync({
    context: input.context,
    payload: input.payload,
    message: prepared.dispatch.message,
    attachmentDownloader: input.attachmentDownloader,
  });
  return dispatchPreparedSlackInboundEventSync({
    ...prepared.dispatch,
    attachments,
  });
}

export async function processSlackInboundEvent(input: ProcessSlackInboundEventInput): Promise<SlackInboundProcessResult> {
  const prepared = prepareSlackInboundDispatchSync(input);
  if (!prepared.ready) {
    return prepared.result;
  }

  let attachments: MessageAttachment[];
  try {
    attachments = await resolveSlackInboundAttachments({
      context: input.context,
      payload: input.payload,
      message: prepared.dispatch.message,
      attachmentDownloader: input.attachmentDownloader,
    });
  } catch (error) {
    return finishFailedDispatch({
      ...prepared.dispatch,
      reasonCode: "slack_attachment_download_failed",
      error,
    });
  }

  return dispatchPreparedSlackInboundEventSync({
    ...prepared.dispatch,
    attachments,
  });
}

function prepareSlackInboundDispatchSync(input: ProcessSlackInboundEventInput): SlackInboundPrepareResult {
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
    return {
      ready: false,
      result: finishIgnored({
        context: input.context,
        event,
        message: null,
        reasonCode: "slack.agent_context_changed",
      }),
    };
  }
  const appHomeOpened = resolveSlackAppHomeOpenedMessagesTabEvent(input.payload);
  if (appHomeOpened) {
    const agentContext = summarizeSlackAgentContextPayload(input.payload);
    if (!input.integration) {
      return {
        ready: false,
        result: finishIgnored({
          context: input.context,
          event,
          message: null,
          reasonCode: "slack.app_home_opened_integration_missing",
        }),
      };
    }
    const welcomeResult = queueSlackAppHomeOpenedWelcomeOutboxSync({
      workspaceId: input.context.workspaceId,
      integration: input.integration,
      externalChatId: appHomeOpened.externalChatId,
      externalUserId: appHomeOpened.externalUserId,
      externalEventId,
      agentContext,
    });
    return {
      ready: false,
      result: finishIgnored({
        context: input.context,
        event,
        message: null,
        reasonCode: welcomeResult.status === "queued"
          ? "slack.app_home_opened_welcome_queued"
          : welcomeResult.reasonCode,
      }),
    };
  }
  const botUserId = readSlackBotUserId(input.integration?.configJson);
  const message = normalizeSlackInboundMessage({
    context: input.context,
    payload: input.payload,
    botUserId,
  });
  if (!message) {
    return {
      ready: false,
      result: finishIgnored({
        context: input.context,
        event,
        message: null,
        reasonCode: "slack.non_message_event",
      }),
    };
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
      ready: false,
      result: {
        event: ignored,
        message,
        dispatchStatus: "duplicate",
        reasonCode: "duplicate_external_message",
        mapping: existingMapping,
      },
    };
  }

  const channelBinding = readExternalChannelBindingByExternalChatSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    externalChatId: message.externalChatId,
  });
  if (!channelBinding || channelBinding.status !== "active") {
    return {
      ready: false,
      result: finishIgnored({
        context: input.context,
        event,
        message,
        reasonCode: "slack.channel_binding_missing",
      }),
    };
  }

  const userBinding = message.externalSenderId
    ? readExternalUserBindingByExternalUserSync({
        workspaceId: input.context.workspaceId,
        integrationId: input.context.integrationId,
        externalUserId: message.externalSenderId,
      })
    : null;
  if (!userBinding || userBinding.status !== "active") {
    return {
      ready: false,
      result: finishIgnored({
        context: input.context,
        event,
        message,
        reasonCode: "slack.user_binding_missing",
      }),
    };
  }

  const user = readUserSync(userBinding.userId);
  const displayName = user?.displayName ?? userBinding.displayName ?? `Slack ${message.externalSenderId}`;
  const text = ensureSlackAgentMentionText({
    text: message.text ?? "",
    agentId: input.integration?.agentId,
  });
  const agentContext = summarizeSlackAgentContextPayload(input.payload);
  return {
    ready: true,
    dispatch: {
      context: input.context,
      payload: input.payload,
      externalEventId,
      event,
      integration: input.integration,
      message,
      channelBinding,
      userBinding,
      displayName,
      text,
      agentContext,
    },
  };
}

function dispatchPreparedSlackInboundEventSync(input: SlackInboundPreparedDispatch & {
  attachments: MessageAttachment[];
}): SlackInboundProcessResult {
  const externalContext = buildSlackExternalContext({
    agentContext: input.agentContext,
    attachments: input.message.attachments,
    downloadedAttachments: input.attachments,
  });
  let state: AgentSpaceState;
  try {
    state = sendChannelHumanMessageSync(
      input.channelBinding.channelName,
      input.displayName,
      input.text,
      input.attachments,
      undefined,
      input.context.workspaceId,
      input.userBinding.userId,
      {
        provider: SLACK_PROVIDER_ID,
        providerLabel: "Slack",
        externalEventId: input.message.externalEventId,
        externalMessageId: input.message.externalMessageId,
        externalChatId: input.message.externalChatId,
        externalContext,
        trust: "untrusted_user_message",
        actor: {
          actorType: "user",
          userId: input.userBinding.userId,
          externalActorReference: `slack:${input.message.externalSenderId}`,
          agentId: input.integration?.agentId,
          botBindingId: input.integration?.agentId ? input.integration.id : undefined,
        },
      },
    );
  } catch (error) {
    const failed = updateExternalIntegrationEventStatusSync({
      workspaceId: input.context.workspaceId,
      provider: SLACK_PROVIDER_ID,
      externalEventId: input.externalEventId,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return {
      event: failed,
      message: input.message,
      mappedChannelName: input.channelBinding.channelName,
      dispatchStatus: "failed",
      reasonCode: "slack.dispatch_failed",
    };
  }

  const agentSpaceMessage = findDispatchedWorkspaceMessage(state, input.message);
  const fileMetadata = buildSlackFileStorageMetadata({
    attachments: input.message.attachments,
    downloadedAttachments: input.attachments,
  });
  const mapping = createExternalMessageMappingSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    channelBindingId: input.channelBinding.id,
    direction: "inbound",
    externalMessageId: input.message.externalMessageId,
    externalThreadId: input.message.externalThreadId,
    externalSenderId: input.message.externalSenderId,
    externalEventId: input.message.externalEventId,
    agentSpaceMessageId: agentSpaceMessage?.id,
    metadataJson: {
      provider: SLACK_PROVIDER_ID,
      channelName: input.channelBinding.channelName,
      slackChannelType: input.channelBinding.externalChatType,
      agentContext: input.agentContext,
      ...fileMetadata,
    },
  });
  const processed = updateExternalIntegrationEventStatusSync({
    workspaceId: input.context.workspaceId,
    provider: SLACK_PROVIDER_ID,
    externalEventId: input.externalEventId,
    status: "processed",
  });
  return {
    event: processed,
    message: input.message,
    mappedChannelName: input.channelBinding.channelName,
    dispatchStatus: "sent",
    mapping,
    agentSpaceMessageId: agentSpaceMessage?.id,
  };
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

function finishFailedDispatch(input: SlackInboundPreparedDispatch & {
  reasonCode: string;
  error: unknown;
}): SlackInboundProcessResult {
  const failed = updateExternalIntegrationEventStatusSync({
    workspaceId: input.context.workspaceId,
    provider: SLACK_PROVIDER_ID,
    externalEventId: input.externalEventId,
    status: "failed",
    errorMessage: input.error instanceof Error ? input.error.message : String(input.error),
  });
  const fileMetadata = buildSlackFileStorageMetadata({
    attachments: input.message.attachments,
    downloadedAttachments: [],
    failed: true,
  });
  const mapping = createExternalMessageMappingSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    channelBindingId: input.channelBinding.id,
    direction: "inbound",
    externalMessageId: input.message.externalMessageId,
    externalThreadId: input.message.externalThreadId,
    externalSenderId: input.message.externalSenderId,
    externalEventId: input.message.externalEventId,
    metadataJson: {
      provider: SLACK_PROVIDER_ID,
      channelName: input.channelBinding.channelName,
      slackChannelType: input.channelBinding.externalChatType,
      agentContext: input.agentContext,
      ...fileMetadata,
    },
  });
  return {
    event: failed,
    message: input.message,
    mappedChannelName: input.channelBinding.channelName,
    dispatchStatus: "failed",
    reasonCode: input.reasonCode,
    mapping,
  };
}

function resolveSlackInboundAttachmentsSync(input: {
  context: IntegrationRuntimeContext;
  payload: Record<string, unknown>;
  message: ExternalMessageEnvelope;
  attachmentDownloader?: SlackInboundAttachmentDownloader;
}): MessageAttachment[] {
  if (!input.attachmentDownloader || input.message.attachments.length === 0) {
    return [];
  }

  const attachments: MessageAttachment[] = [];
  for (const [attachmentIndex, attachment] of input.message.attachments.entries()) {
    const resolved = input.attachmentDownloader({
      context: input.context,
      payload: input.payload,
      message: input.message,
      attachment,
      attachmentIndex,
    });
    if (isPromiseLike(resolved)) {
      throw new Error("slack.attachment_downloader_async_in_sync_path");
    }
    if (resolved) {
      attachments.push(resolved);
    }
  }
  return attachments;
}

async function resolveSlackInboundAttachments(input: {
  context: IntegrationRuntimeContext;
  payload: Record<string, unknown>;
  message: ExternalMessageEnvelope;
  attachmentDownloader?: SlackInboundAttachmentDownloader;
}): Promise<MessageAttachment[]> {
  if (!input.attachmentDownloader || input.message.attachments.length === 0) {
    return [];
  }

  const attachments: MessageAttachment[] = [];
  for (const [attachmentIndex, attachment] of input.message.attachments.entries()) {
    const resolved = await input.attachmentDownloader({
      context: input.context,
      payload: input.payload,
      message: input.message,
      attachment,
      attachmentIndex,
    });
    if (resolved) {
      attachments.push(resolved);
    }
  }
  return attachments;
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

function buildSlackExternalContext(input: {
  agentContext: ReturnType<typeof summarizeSlackAgentContextPayload>;
  attachments: ExternalMessageEnvelope["attachments"];
  downloadedAttachments: MessageAttachment[];
}): string | undefined {
  const fileMetadata = buildSlackFileStorageMetadata({
    attachments: input.attachments,
    downloadedAttachments: input.downloadedAttachments,
  });
  const payload = {
    ...(input.agentContext ? { slackAgentContext: input.agentContext } : {}),
    ...fileMetadata,
  };
  return Object.keys(payload).length > 0 ? JSON.stringify(payload) : undefined;
}

function buildSlackFileStorageMetadata(input: {
  attachments: ExternalMessageEnvelope["attachments"];
  downloadedAttachments: MessageAttachment[];
  failed?: boolean;
}): Record<string, unknown> {
  if (input.attachments.length === 0) {
    return {};
  }
  const downloadedByName = new Map(
    input.downloadedAttachments.map((attachment) => [attachment.fileName, attachment]),
  );
  const slackFiles = input.attachments.map((attachment) => {
    const downloaded = attachment.fileName ? downloadedByName.get(attachment.fileName) : undefined;
    return {
      ...buildSafeSlackFileAttachmentMetadata(attachment),
      downloadStatus: downloaded
        ? "stored_attachment"
        : input.failed ? "download_failed" : "not_downloaded",
      storedAttachmentRef: downloaded ? buildSafeAttachmentReference(downloaded) : undefined,
      storageProvider: downloaded ? downloaded.storageProvider ?? "local" : undefined,
      securityScanStatus: downloaded ? "basic_policy_passed" : "not_scanned",
      rawSlackFileIdStored: false,
      privateUrlStored: false,
    };
  });
  const storedAttachmentCount = input.downloadedAttachments.length;
  return {
    slackFiles,
    slackFileCount: input.attachments.length,
    slackStoredAttachmentCount: storedAttachmentCount || undefined,
    slackFileDownloadStatus: storedAttachmentCount > 0
      ? "stored_attachment"
      : input.failed ? "download_failed" : "metadata_only",
  };
}

function buildSafeSlackFileAttachmentMetadata(attachment: ExternalMessageEnvelope["attachments"][number]): Record<string, unknown> {
  const metadata = attachment.metadata ?? {};
  return {
    provider: SLACK_PROVIDER_ID,
    source: "slack_file_metadata",
    fileRef: readMetadataString(metadata, "fileRef") ?? attachment.id,
    fileName: attachment.fileName,
    mediaType: attachment.mediaType,
    sizeBytes: attachment.sizeBytes,
    fileType: readMetadataString(metadata, "fileType"),
    mode: readMetadataString(metadata, "mode"),
    isExternal: metadata.isExternal === true,
    privateUrlRedacted: metadata.privateUrlRedacted === true,
    permalinkRedacted: metadata.permalinkRedacted === true,
  };
}

function buildSafeAttachmentReference(attachment: MessageAttachment): string {
  return `att_${attachment.id.slice(0, 12)}`;
}

function readMetadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return Boolean(value && typeof (value as Promise<T>).then === "function");
}
