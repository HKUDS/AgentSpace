import {
  createExternalMessageOutboxSync,
  createExternalMessageMappingSync,
  listQueuedTasksSync,
  readExternalChannelBindingByExternalChatSync,
  readExternalMessageMappingByExternalMessageSync,
  readExternalUserBindingByExternalUserSync,
  readUserSync,
  readWorkspaceMembershipSync,
  recordExternalIntegrationEventSync,
  updateExternalIntegrationEventStatusSync,
  type ExternalChannelBindingRecord,
  type ExternalIntegrationEventRecord,
  type ExternalIntegrationRecord,
  type ExternalMessageMappingRecord,
  type ExternalMessageOutboxRecord,
  type ExternalUserBindingRecord,
  type QueuedTaskRecord,
} from "@agent-space/db";
import type { ChannelRecord, MessageAttachment } from "@agent-space/domain/workspace";
import type { ExternalMessageEnvelope, IntegrationRuntimeContext } from "../../core/index.ts";
import { sendContactMessageWithAttachmentsSync } from "../../../contacts/contacts.ts";
import { sendChannelHumanMessageSync } from "../../../messages/messages.ts";
import { canWriteChannelForActorSync } from "../../../channel-access/channel-access.ts";
import { sameValue } from "../../../shared/helpers.ts";
import { readWorkspaceStateSync } from "../../../shared/state-io.ts";
import type { ExternalMessageInputContext } from "../../../shared/messaging.ts";
import type { FeishuInboundAttachmentDownloader } from "./attachments.ts";
import { FEISHU_PROVIDER_ID } from "./constants.ts";
import { buildAgentSpaceSettingsIntegrationsDeepLink } from "./links.ts";
import {
  asRecord,
  asString,
  isFeishuCardActionCallbackPayload,
  resolveFeishuEventId,
  resolveFeishuEventReceivedAt,
  resolveFeishuEventType,
} from "./events.ts";
import { summarizeFeishuInboundEventPayload } from "./event-summary.ts";
import { normalizeFeishuInboundMessage } from "./normalize-message.ts";
import {
  buildFeishuTextOutboundMessage,
  queueFeishuAgentStatusCardOutboxSync,
} from "./outbound.ts";
import {
  ensureFeishuAgentMentionText,
  isFeishuBotAddedToChatPayload,
  resolveFeishuAgentBotRouteSync,
  resolveFeishuChatDescriptor,
  type FeishuAgentBotRoute,
} from "./agent-bot-routing.ts";
import {
  queueFeishuChannelAutoProvisionConfirmationOutboxSync,
  resolveOrProvisionFeishuChannelBindingSync,
  shouldAutoProvisionFeishuChannelForBotAdded,
  shouldAutoProvisionFeishuChannelForFirstMessage,
} from "./channel-auto-provisioning.ts";
import {
  buildFeishuExternalGuestActor,
  ensureFeishuExternalGuestChannelActorSync,
  evaluateFeishuExternalGuestPolicy,
  type FeishuExternalGuestActor,
} from "./external-guests.ts";
import { recordFeishuThreadBindingSync } from "./thread-bindings.ts";

export interface FeishuInboundRecordResult {
  event: ExternalIntegrationEventRecord;
  message: ExternalMessageEnvelope | null;
  mappedChannelName?: string;
}

export type FeishuInboundDispatchStatus =
  | "sent"
  | "duplicate"
  | "ignored"
  | "failed";

export interface FeishuInboundProcessResult extends FeishuInboundRecordResult {
  dispatchStatus: FeishuInboundDispatchStatus;
  reasonCode?: string;
  mapping?: ExternalMessageMappingRecord;
  noticeOutbox?: ExternalMessageOutboxRecord;
}

export interface ProcessFeishuInboundEventInput {
  context: IntegrationRuntimeContext;
  payload: Record<string, unknown>;
  queueNotices?: boolean;
  attachmentDownloader?: FeishuInboundAttachmentDownloader;
}

interface FeishuInboundPreparedDispatch {
  context: IntegrationRuntimeContext;
  externalEventId: string;
  event: ExternalIntegrationEventRecord;
  message: ExternalMessageEnvelope;
  channelBinding: ExternalChannelBindingRecord;
  userBinding?: ExternalUserBindingRecord;
  userId?: string;
  actorType: "user" | "external_guest";
  externalGuestActor?: FeishuExternalGuestActor;
  agentId?: string;
  botBindingId?: string;
  agentBotIntegration?: ExternalIntegrationRecord;
  text: string;
  displayName: string;
}

type FeishuInboundPrepareResult =
  | {
    ready: true;
    dispatch: FeishuInboundPreparedDispatch;
  }
  | {
    ready: false;
    result: FeishuInboundProcessResult;
  };

export function processFeishuInboundEventSync(input: ProcessFeishuInboundEventInput): FeishuInboundProcessResult {
  const prepared = prepareFeishuInboundDispatchSync(input);
  if (!prepared.ready) {
    return prepared.result;
  }
  const attachments = resolveFeishuInboundAttachmentsSync({
    context: input.context,
    message: prepared.dispatch.message,
    attachmentDownloader: input.attachmentDownloader,
  });
  return dispatchPreparedFeishuInboundEventSync({
    ...prepared.dispatch,
    attachments,
  });
}

export async function processFeishuInboundEvent(
  input: ProcessFeishuInboundEventInput,
): Promise<FeishuInboundProcessResult> {
  const prepared = prepareFeishuInboundDispatchSync(input);
  if (!prepared.ready) {
    return prepared.result;
  }

  let attachments: MessageAttachment[];
  try {
    attachments = await resolveFeishuInboundAttachments({
      context: input.context,
      message: prepared.dispatch.message,
      attachmentDownloader: input.attachmentDownloader,
    });
  } catch (error) {
    return finishFailedDispatch({
      ...prepared.dispatch,
      reasonCode: "feishu_attachment_download_failed",
      error,
    });
  }

  return dispatchPreparedFeishuInboundEventSync({
    ...prepared.dispatch,
    attachments,
  });
}

function prepareFeishuInboundDispatchSync(input: ProcessFeishuInboundEventInput): FeishuInboundPrepareResult {
  const externalEventId = resolveFeishuEventId(input.payload);
  const eventType = resolveFeishuEventType(input.payload);
  const event = recordExternalIntegrationEventSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    provider: FEISHU_PROVIDER_ID,
    externalEventId,
    eventType,
    payloadJson: summarizeFeishuInboundEventPayload(input.payload),
  });
  const agentBotRoute = resolveFeishuAgentBotRouteSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    payload: input.payload,
  });

  if (isFeishuCardActionCallbackPayload(input.payload)) {
    return {
      ready: false,
      result: finishIgnored({
        context: input.context,
        event,
        message: null,
        reasonCode: "feishu_card_action_approval_unsupported",
      }),
    };
  }

  if (isFeishuBotAddedToChatPayload(input.payload)) {
    return {
      ready: false,
      result: processFeishuBotAddedToChatEventSync({
        context: input.context,
        payload: input.payload,
        event,
        externalEventId,
        agentBotRoute,
        queueNotices: input.queueNotices,
      }),
    };
  }

  const message = normalizeFeishuInboundMessage(input);
  if (!message) {
    return {
      ready: false,
      result: finishIgnored({
        context: input.context,
        event,
        message: null,
        reasonCode: "non_message_event",
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
      provider: FEISHU_PROVIDER_ID,
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

  let channelBinding = readExternalChannelBindingByExternalChatSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    externalChatId: message.externalChatId,
  });
  let channelAutoProvisionNotice: ExternalMessageOutboxRecord | undefined;
  if ((!channelBinding || channelBinding.status !== "active") && agentBotRoute) {
    const chatDescriptor = resolveFeishuChatDescriptor(input.payload) ?? {
      externalChatId: message.externalChatId,
      externalChatType: resolveFeishuChatType(message),
    };
    if (shouldAutoProvisionFeishuChannelForFirstMessage({
      integration: agentBotRoute.binding,
      botMentioned: agentBotRoute.botMentioned,
    })) {
      const provisioned = resolveOrProvisionFeishuChannelBindingSync({
        workspaceId: input.context.workspaceId,
        integration: agentBotRoute.binding,
        agentId: agentBotRoute.agentId,
        externalChatId: chatDescriptor.externalChatId,
        externalChatType: chatDescriptor.externalChatType,
        externalChatName: chatDescriptor.externalChatName,
        provisionSource: "first_message",
      });
      channelBinding = provisioned.binding;
      channelAutoProvisionNotice = input.queueNotices === false
        ? undefined
        : queueFeishuChannelAutoProvisionConfirmationOutboxSync({
          workspaceId: input.context.workspaceId,
          integrationId: input.context.integrationId,
          binding: provisioned.binding,
          agentId: agentBotRoute.agentId,
          result: provisioned,
          targetExternalThreadId: message.externalThreadId,
        });
    }
  }
  if (!channelBinding || channelBinding.status !== "active") {
    const mapping = createFeishuInboundMapping({
      context: input.context,
      message,
      agentId: agentBotRoute?.agentId,
      botBindingId: agentBotRoute?.binding.id,
      reasonCode: "external_channel_unbound",
      dispatchStatus: "ignored",
    });
    const noticeOutbox = input.queueNotices === false
      ? undefined
      : queueFeishuInboundNoticeSync({
        context: input.context,
        message,
        text: buildFeishuChannelBindingNotice({ workspaceId: input.context.workspaceId }),
      });
    return {
      ready: false,
      result: finishIgnored({
        context: input.context,
        event,
        message,
        mappedChannelName: undefined,
        reasonCode: "external_channel_unbound",
        mapping,
        noticeOutbox,
      }),
    };
  }

  const externalSenderId = message.externalSenderId?.trim();
  if (!externalSenderId) {
    const mapping = createFeishuInboundMapping({
      context: input.context,
      message,
      channelBindingId: channelBinding.id,
      mappedChannelName: channelBinding.channelName,
      reasonCode: "external_sender_missing",
      dispatchStatus: "ignored",
    });
    return {
      ready: false,
      result: finishIgnored({
        context: input.context,
        event,
        message,
        mappedChannelName: channelBinding.channelName,
        reasonCode: "external_sender_missing",
        mapping,
      }),
    };
  }

  const userBinding = readExternalUserBindingByExternalUserSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    externalUserId: externalSenderId,
  });
  const user = userBinding ? readUserSync(userBinding.userId) : null;
  const membership = userBinding
    ? readWorkspaceMembershipSync(input.context.workspaceId, userBinding.userId)
    : null;
  if (!userBinding || userBinding.status !== "active" || !user || !membership) {
    const guestDecision = agentBotRoute
      ? evaluateFeishuExternalGuestPolicy({
        integration: agentBotRoute.binding,
        botMentioned: agentBotRoute.botMentioned,
      })
      : null;
    if (agentBotRoute && guestDecision?.decision === "allow") {
      const route = agentBotRoute;
      const displayName = ensureFeishuExternalGuestChannelActorSync({
        workspaceId: input.context.workspaceId,
        channelName: channelBinding.channelName,
      });
      const externalGuestActor = buildFeishuExternalGuestActor({
        workspaceId: input.context.workspaceId,
        tenantKey: route.binding.tenantKey,
        externalUserId: externalSenderId,
        sourceChatId: message.externalChatId,
        permissionProfile: guestDecision.policy.guestPermissionProfile,
      });
      const text = resolveRoutedFeishuText({
        message,
        agentBotRoute: route,
      });
      if (!text) {
        const mapping = createFeishuInboundMapping({
          context: input.context,
          message,
          channelBindingId: channelBinding.id,
          mappedChannelName: channelBinding.channelName,
          actorType: "external_guest",
          agentId: route.agentId,
          botBindingId: route.binding.id,
          externalGuestActor,
          reasonCode: "empty_message",
          dispatchStatus: "ignored",
        });
        return {
          ready: false,
          result: finishIgnored({
            context: input.context,
            event,
            message,
            mappedChannelName: channelBinding.channelName,
            reasonCode: "empty_message",
            mapping,
            noticeOutbox: channelAutoProvisionNotice,
          }),
        };
      }
      createFeishuInboundMapping({
        context: input.context,
        message,
        channelBindingId: channelBinding.id,
        mappedChannelName: channelBinding.channelName,
        actorType: "external_guest",
        agentId: route.agentId,
        botBindingId: route.binding.id,
        externalGuestActor,
        dispatchStatus: "dispatching",
      });
      return {
        ready: true,
        dispatch: {
          context: input.context,
          externalEventId,
          event,
          message,
          channelBinding,
          actorType: "external_guest",
          externalGuestActor,
          text,
          displayName,
          agentId: route.agentId,
          botBindingId: route.binding.id,
          agentBotIntegration: route.binding,
        },
      };
    }
    const mapping = createFeishuInboundMapping({
      context: input.context,
      message,
      channelBindingId: channelBinding.id,
      mappedChannelName: channelBinding.channelName,
      agentId: agentBotRoute?.agentId,
      botBindingId: agentBotRoute?.binding.id,
      reasonCode: "external_user_unbound",
      dispatchStatus: "ignored",
    });
    const noticeOutbox = input.queueNotices === false
      ? undefined
      : queueFeishuInboundNoticeSync({
        context: input.context,
        message,
        channelBindingId: channelBinding.id,
        text: buildFeishuUserBindingNotice({ workspaceId: input.context.workspaceId }),
      });
    return {
      ready: false,
      result: finishIgnored({
        context: input.context,
        event,
        message,
        mappedChannelName: channelBinding.channelName,
        reasonCode: "external_user_unbound",
        mapping,
        noticeOutbox,
      }),
    };
  }

  if (!canWriteChannelForActorSync({
    workspaceId: input.context.workspaceId,
    channelName: channelBinding.channelName,
    actor: {
      userId: userBinding.userId,
      displayName: user.displayName || userBinding.displayName,
      role: membership.role,
    },
  })) {
    const mapping = createFeishuInboundMapping({
      context: input.context,
      message,
      channelBindingId: channelBinding.id,
      mappedChannelName: channelBinding.channelName,
      userId: userBinding.userId,
      actorType: "user",
      agentId: agentBotRoute?.agentId,
      botBindingId: agentBotRoute?.binding.id,
      reasonCode: "external_channel_access_denied",
      dispatchStatus: "ignored",
    });
    const noticeOutbox = input.queueNotices === false
      ? undefined
      : queueFeishuInboundNoticeSync({
        context: input.context,
        message,
        channelBindingId: channelBinding.id,
        text: "你已绑定 AgentSpace 账号，但没有这个 AgentSpace channel 的访问权限。请先在 AgentSpace 申请或让管理员添加频道权限。",
      });
    return {
      ready: false,
      result: finishIgnored({
        context: input.context,
        event,
        message,
        mappedChannelName: channelBinding.channelName,
        reasonCode: "external_channel_access_denied",
        mapping,
        noticeOutbox,
      }),
    };
  }

  const text = resolveRoutedFeishuText({ message, agentBotRoute });
  if (!text) {
    const mapping = createFeishuInboundMapping({
      context: input.context,
      message,
      channelBindingId: channelBinding.id,
      mappedChannelName: channelBinding.channelName,
      userId: userBinding.userId,
      actorType: "user",
      agentId: agentBotRoute?.agentId,
      botBindingId: agentBotRoute?.binding.id,
      reasonCode: "empty_message",
      dispatchStatus: "ignored",
    });
    return {
      ready: false,
      result: finishIgnored({
        context: input.context,
        event,
        message,
        mappedChannelName: channelBinding.channelName,
        reasonCode: "empty_message",
        mapping,
      }),
    };
  }

  createFeishuInboundMapping({
    context: input.context,
    message,
    channelBindingId: channelBinding.id,
    mappedChannelName: channelBinding.channelName,
    userId: userBinding.userId,
    actorType: "user",
    agentId: agentBotRoute?.agentId,
    botBindingId: agentBotRoute?.binding.id,
    dispatchStatus: "dispatching",
  });
  const displayName = user.displayName || userBinding.displayName || externalSenderId;

  return {
    ready: true,
    dispatch: {
      context: input.context,
      externalEventId,
      event,
      message,
      channelBinding,
      userBinding,
      userId: userBinding.userId,
      actorType: "user",
      agentId: agentBotRoute?.agentId,
      botBindingId: agentBotRoute?.binding.id,
      agentBotIntegration: agentBotRoute?.binding,
      text,
      displayName,
    },
  };
}

function dispatchPreparedFeishuInboundEventSync(input: FeishuInboundPreparedDispatch & {
  attachments: MessageAttachment[];
}): FeishuInboundProcessResult {
  let agentSpaceMessageId: string | undefined;
  let pendingAgentNames: string[] = [];
  let dispatchedTask: QueuedTaskRecord | null = null;
  try {
    const externalInput = buildFeishuExternalInput(input.message);
    const directContactId = resolveFeishuDirectContactIdSync({
      workspaceId: input.context.workspaceId,
      channelBinding: input.channelBinding,
      message: input.message,
    });
    const nextState = directContactId
      ? sendContactMessageWithAttachmentsSync(
        directContactId,
        input.text,
        input.attachments,
        input.context.workspaceId,
        input.userId,
        externalInput,
      )
      : sendChannelHumanMessageSync(
        input.channelBinding.channelName,
        input.displayName,
        input.text,
        input.attachments,
        undefined,
        input.context.workspaceId,
        input.userId,
        externalInput,
      );
    agentSpaceMessageId = nextState.messages.find((candidate) =>
      candidate.role === "human" &&
      candidate.channel === input.channelBinding.channelName &&
      (input.userId ? candidate.speakerUserId === input.userId : candidate.speaker === input.displayName) &&
      candidate.summary === input.text
    )?.id;
    pendingAgentNames = agentSpaceMessageId
      ? nextState.messages
        .filter((candidate) =>
          candidate.channel === input.channelBinding.channelName &&
          candidate.role === "agent" &&
          candidate.status === "pending" &&
          candidate.code === "agent.pending" &&
          candidate.data?.source_message_id === agentSpaceMessageId)
        .map((candidate) => candidate.speaker)
      : [];
    dispatchedTask = agentSpaceMessageId && input.agentId
      ? resolveFeishuDispatchedTaskSync({
        workspaceId: input.context.workspaceId,
        channelName: input.channelBinding.channelName,
        agentId: input.agentId,
        sourceMessageId: agentSpaceMessageId,
      })
      : null;
  } catch (error) {
    return finishFailedDispatch({
      ...input,
      reasonCode: "agent_space_dispatch_failed",
      error,
    });
  }

  const threadBinding = input.agentBotIntegration && input.agentId && agentSpaceMessageId
    ? recordFeishuThreadBindingSync({
      workspaceId: input.context.workspaceId,
      integration: input.agentBotIntegration,
      channelBinding: input.channelBinding,
      message: input.message,
      agentId: input.agentId,
      botBindingId: input.botBindingId,
      actorType: input.actorType,
      taskQueueId: dispatchedTask?.id,
      routerSessionId: dispatchedTask?.routerSessionId,
      agentSpaceMessageId,
    })
    : null;

  const mapping = createFeishuInboundMapping({
    context: input.context,
    message: input.message,
    channelBindingId: input.channelBinding.id,
    mappedChannelName: input.channelBinding.channelName,
    userId: input.userId,
    actorType: input.actorType,
    externalGuestActor: input.externalGuestActor,
    agentId: input.agentId,
    botBindingId: input.botBindingId,
    taskQueueId: dispatchedTask?.id,
    routerSessionId: dispatchedTask?.routerSessionId,
    threadBindingId: threadBinding?.id,
    agentSpaceMessageId,
    dispatchStatus: "sent",
    downloadedAttachmentCount: input.attachments.length,
  });
  if (agentSpaceMessageId && pendingAgentNames.length > 0) {
    queueFeishuAgentStatusCardBestEffort({
      workspaceId: input.context.workspaceId,
      channelName: input.channelBinding.channelName,
      agentId: input.agentId,
      agentNames: pendingAgentNames,
      sourceAgentSpaceMessageId: agentSpaceMessageId,
      message: "AgentSpace has queued the requested agent work.",
    });
  }
  const processed = updateExternalIntegrationEventStatusSync({
    workspaceId: input.context.workspaceId,
    provider: FEISHU_PROVIDER_ID,
    externalEventId: input.externalEventId,
    status: "processed",
  });

  return {
    event: processed,
    message: input.message,
    mappedChannelName: input.channelBinding.channelName,
    dispatchStatus: "sent",
    mapping,
  };
}

function resolveFeishuDispatchedTaskSync(input: {
  workspaceId: string;
  channelName: string;
  agentId: string;
  sourceMessageId: string;
}): QueuedTaskRecord | null {
  return listQueuedTasksSync({ workspaceId: input.workspaceId })
    .filter((task) => task.agentId === input.agentId)
    .filter((task) => {
      const payload = parseJsonRecord(task.inputJson);
      return payload?.sourceMessageId === input.sourceMessageId &&
        payload.channelName === input.channelName;
    })
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0] ?? null;
}

function queueFeishuAgentStatusCardBestEffort(input: {
  workspaceId: string;
  channelName: string;
  agentId?: string;
  agentNames: string[];
  sourceAgentSpaceMessageId: string;
  message: string;
}): void {
  try {
    queueFeishuAgentStatusCardOutboxSync({
      workspaceId: input.workspaceId,
      channelName: input.channelName,
      agentId: input.agentId,
      status: "thinking",
      agentNames: input.agentNames,
      sourceAgentSpaceMessageId: input.sourceAgentSpaceMessageId,
      message: input.message,
    });
  } catch {
    // External status cards are best-effort; the internal AgentSpace dispatch already succeeded.
  }
}

function buildFeishuExternalInput(message: ExternalMessageEnvelope): ExternalMessageInputContext {
  return {
    provider: FEISHU_PROVIDER_ID,
    providerLabel: "Feishu/Lark",
    externalEventId: message.externalEventId,
    externalMessageId: message.externalMessageId,
    externalChatId: message.externalChatId,
    trust: "untrusted_user_message",
  };
}

function processFeishuBotAddedToChatEventSync(input: {
  context: IntegrationRuntimeContext;
  payload: Record<string, unknown>;
  event: ExternalIntegrationEventRecord;
  externalEventId: string;
  agentBotRoute: FeishuAgentBotRoute | null;
  queueNotices?: boolean;
}): FeishuInboundProcessResult {
  if (!input.agentBotRoute) {
    return finishIgnored({
      context: input.context,
      event: input.event,
      message: null,
      reasonCode: "feishu_bot_added_workspace_integration_ignored",
    });
  }
  const chatDescriptor = resolveFeishuChatDescriptor(input.payload);
  if (!chatDescriptor) {
    return finishIgnored({
      context: input.context,
      event: input.event,
      message: null,
      reasonCode: "feishu_bot_added_chat_missing",
    });
  }
  if (!shouldAutoProvisionFeishuChannelForBotAdded(input.agentBotRoute.binding)) {
    return finishIgnored({
      context: input.context,
      event: input.event,
      message: null,
      reasonCode: "feishu_bot_added_auto_provision_disabled",
    });
  }

  try {
    const provisioned = resolveOrProvisionFeishuChannelBindingSync({
      workspaceId: input.context.workspaceId,
      integration: input.agentBotRoute.binding,
      agentId: input.agentBotRoute.agentId,
      externalChatId: chatDescriptor.externalChatId,
      externalChatType: chatDescriptor.externalChatType ?? "group",
      externalChatName: chatDescriptor.externalChatName,
      provisionSource: "bot_added",
    });
    const noticeOutbox = input.queueNotices === false
      ? undefined
      : queueFeishuChannelAutoProvisionConfirmationOutboxSync({
        workspaceId: input.context.workspaceId,
        integrationId: input.context.integrationId,
        binding: provisioned.binding,
        agentId: input.agentBotRoute.agentId,
        result: provisioned,
      });
    const processed = updateExternalIntegrationEventStatusSync({
      workspaceId: input.context.workspaceId,
      provider: FEISHU_PROVIDER_ID,
      externalEventId: input.externalEventId,
      status: "processed",
    });
    return {
      event: processed,
      message: null,
      mappedChannelName: provisioned.channelName,
      dispatchStatus: "sent",
      reasonCode: "feishu_bot_added_channel_provisioned",
      noticeOutbox,
    };
  } catch (error) {
    const failed = updateExternalIntegrationEventStatusSync({
      workspaceId: input.context.workspaceId,
      provider: FEISHU_PROVIDER_ID,
      externalEventId: input.externalEventId,
      status: "failed",
      errorMessage: formatFeishuInboundErrorMessage(error),
    });
    return {
      event: failed,
      message: null,
      dispatchStatus: "failed",
      reasonCode: "feishu_bot_added_channel_provision_failed",
    };
  }
}

function resolveFeishuDirectContactIdSync(input: {
  workspaceId: string;
  channelBinding: ExternalChannelBindingRecord;
  message: ExternalMessageEnvelope;
}): string | null {
  if (!isFeishuDirectChat(input.channelBinding.externalChatType) && !isFeishuDirectChat(resolveFeishuChatType(input.message))) {
    return null;
  }

  const state = readWorkspaceStateSync(input.workspaceId);
  const channel = state.channels.find((item) => sameValue(item.name, input.channelBinding.channelName));
  if (!channel || channel.kind !== "direct") {
    return null;
  }

  return resolveSingleDirectEmployeeName(channel);
}

function resolveSingleDirectEmployeeName(channel: Pick<ChannelRecord, "employeeNames">): string | null {
  const employeeNames: string[] = [];
  for (const name of channel.employeeNames) {
    const trimmed = name.trim();
    if (trimmed && !employeeNames.some((item) => sameValue(item, trimmed))) {
      employeeNames.push(trimmed);
    }
  }
  return employeeNames.length === 1 ? employeeNames[0] ?? null : null;
}

function isFeishuDirectChat(chatType: string | undefined): boolean {
  const normalized = chatType?.trim().toLowerCase();
  return normalized === "p2p" || normalized === "direct" || normalized === "private";
}

function resolveFeishuChatType(message: ExternalMessageEnvelope): string | undefined {
  const event = asRecord(message.rawPayload.event);
  const feishuMessage = asRecord(event?.message);
  return asString(feishuMessage?.chat_type);
}

export function recordFeishuCardActionCallbackIgnoredSync(input: {
  context: IntegrationRuntimeContext;
  payload: Record<string, unknown>;
  reasonCode?: string;
}): FeishuInboundProcessResult {
  const externalEventId = resolveFeishuEventId(input.payload);
  const eventType = resolveFeishuEventType(input.payload);
  const event = recordExternalIntegrationEventSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    provider: FEISHU_PROVIDER_ID,
    externalEventId,
    eventType,
    payloadJson: summarizeFeishuInboundEventPayload(input.payload),
  });

  return finishIgnored({
    context: input.context,
    event,
    message: null,
    reasonCode: input.reasonCode ?? "feishu_card_action_approval_unsupported",
  });
}

export function recordFeishuCallbackRejectedSync(input: {
  context: IntegrationRuntimeContext;
  payload: Record<string, unknown>;
  reasonCode: string;
}): FeishuInboundProcessResult {
  const externalEventId = resolveFeishuEventId(input.payload);
  const eventType = resolveFeishuEventType(input.payload);
  const event = recordExternalIntegrationEventSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    provider: FEISHU_PROVIDER_ID,
    externalEventId,
    eventType,
    status: "failed",
    errorMessage: input.reasonCode,
    payloadJson: summarizeFeishuInboundEventPayload(input.payload),
  });

  return {
    event,
    message: null,
    dispatchStatus: "failed",
    reasonCode: input.reasonCode,
  };
}

export function recordFeishuInboundEventSync(input: {
  context: IntegrationRuntimeContext;
  payload: Record<string, unknown>;
}): FeishuInboundRecordResult {
  const externalEventId = resolveFeishuEventId(input.payload);
  const eventType = resolveFeishuEventType(input.payload);
  const event = recordExternalIntegrationEventSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    provider: FEISHU_PROVIDER_ID,
    externalEventId,
    eventType,
    payloadJson: summarizeFeishuInboundEventPayload(input.payload),
  });

  const message = normalizeFeishuInboundMessage(input);
  if (!message) {
    const ignored = updateExternalIntegrationEventStatusSync({
      workspaceId: input.context.workspaceId,
      provider: FEISHU_PROVIDER_ID,
      externalEventId,
      status: "ignored",
    });
    return { event: ignored, message: null };
  }

  const channelBinding = readExternalChannelBindingByExternalChatSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    externalChatId: message.externalChatId,
  });

  createExternalMessageMappingSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    channelBindingId: channelBinding?.id,
    direction: "inbound",
    externalMessageId: message.externalMessageId,
    externalThreadId: message.externalThreadId,
    externalSenderId: message.externalSenderId,
    externalEventId: message.externalEventId,
    metadataJson: {
      eventType: message.eventType,
      mappedChannelName: channelBinding?.channelName,
    },
  });

  const processed = updateExternalIntegrationEventStatusSync({
    workspaceId: input.context.workspaceId,
    provider: FEISHU_PROVIDER_ID,
    externalEventId,
    status: "processed",
  });

  return {
    event: processed,
    message,
    mappedChannelName: channelBinding?.channelName,
  };
}

function finishIgnored(input: {
  context: IntegrationRuntimeContext;
  event: ExternalIntegrationEventRecord;
  message: ExternalMessageEnvelope | null;
  mappedChannelName?: string;
  reasonCode: string;
  mapping?: ExternalMessageMappingRecord;
  noticeOutbox?: ExternalMessageOutboxRecord;
}): FeishuInboundProcessResult {
  const ignored = updateExternalIntegrationEventStatusSync({
    workspaceId: input.context.workspaceId,
    provider: FEISHU_PROVIDER_ID,
    externalEventId: input.event.externalEventId,
    status: "ignored",
    errorMessage: input.reasonCode,
  });
  return {
    event: ignored,
    message: input.message,
    mappedChannelName: input.mappedChannelName,
    dispatchStatus: "ignored",
    reasonCode: input.reasonCode,
    mapping: input.mapping,
    noticeOutbox: input.noticeOutbox,
  };
}

function finishFailedDispatch(input: FeishuInboundPreparedDispatch & {
  reasonCode: string;
  error: unknown;
}): FeishuInboundProcessResult {
  const errorMessage = formatFeishuInboundErrorMessage(input.error);
  const mapping = createFeishuInboundMapping({
    context: input.context,
    message: input.message,
    channelBindingId: input.channelBinding.id,
    mappedChannelName: input.channelBinding.channelName,
    userId: input.userId,
    actorType: input.actorType,
    externalGuestActor: input.externalGuestActor,
    agentId: input.agentId,
    botBindingId: input.botBindingId,
    reasonCode: input.reasonCode,
    dispatchStatus: "failed",
    errorMessage,
  });
  const failed = updateExternalIntegrationEventStatusSync({
    workspaceId: input.context.workspaceId,
    provider: FEISHU_PROVIDER_ID,
    externalEventId: input.externalEventId,
    status: "failed",
    errorMessage,
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

function resolveFeishuInboundAttachmentsSync(input: {
  context: IntegrationRuntimeContext;
  message: ExternalMessageEnvelope;
  attachmentDownloader?: FeishuInboundAttachmentDownloader;
}): MessageAttachment[] {
  if (!input.attachmentDownloader || input.message.attachments.length === 0) {
    return [];
  }

  const attachments: MessageAttachment[] = [];
  for (const [attachmentIndex, attachment] of input.message.attachments.entries()) {
    const resolved = input.attachmentDownloader({
      context: input.context,
      message: input.message,
      attachment,
      attachmentIndex,
    });
    if (isPromiseLike(resolved)) {
      throw new Error("feishu.attachment_downloader_async_in_sync_path");
    }
    if (resolved) {
      attachments.push(resolved);
    }
  }
  return attachments;
}

async function resolveFeishuInboundAttachments(input: {
  context: IntegrationRuntimeContext;
  message: ExternalMessageEnvelope;
  attachmentDownloader?: FeishuInboundAttachmentDownloader;
}): Promise<MessageAttachment[]> {
  if (!input.attachmentDownloader || input.message.attachments.length === 0) {
    return [];
  }

  const attachments: MessageAttachment[] = [];
  for (const [attachmentIndex, attachment] of input.message.attachments.entries()) {
    const resolved = await input.attachmentDownloader({
      context: input.context,
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

function createFeishuInboundMapping(input: {
  context: IntegrationRuntimeContext;
  message: ExternalMessageEnvelope;
  channelBindingId?: string;
  mappedChannelName?: string;
  userId?: string;
  actorType?: "user" | "external_guest";
  externalGuestActor?: FeishuExternalGuestActor;
  agentId?: string;
  botBindingId?: string;
  taskQueueId?: string;
  routerSessionId?: string;
  threadBindingId?: string;
  agentSpaceMessageId?: string;
  dispatchStatus: string;
  reasonCode?: string;
  errorMessage?: string;
  downloadedAttachmentCount?: number;
}): ExternalMessageMappingRecord {
  return createExternalMessageMappingSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    channelBindingId: input.channelBindingId,
    direction: "inbound",
    externalMessageId: input.message.externalMessageId,
    externalThreadId: input.message.externalThreadId,
    externalSenderId: input.message.externalSenderId,
    externalEventId: input.message.externalEventId,
    agentSpaceMessageId: input.agentSpaceMessageId,
    taskQueueId: input.taskQueueId,
    routerSessionId: input.routerSessionId,
    metadataJson: {
      provider: FEISHU_PROVIDER_ID,
      eventType: input.message.eventType,
      externalChatId: input.message.externalChatId,
      mappedChannelName: input.mappedChannelName,
      userId: input.userId,
      actorType: input.actorType ?? (input.userId ? "user" : undefined),
      externalGuestReference: input.externalGuestActor?.providerUserRefHash,
      externalGuestPermissionProfile: input.externalGuestActor?.permissionProfile,
      agentId: input.agentId,
      botBindingId: input.botBindingId,
      threadBindingId: input.threadBindingId,
      dispatchStatus: input.dispatchStatus,
      reasonCode: input.reasonCode,
      errorMessage: input.errorMessage,
      attachmentCount: input.message.attachments.length,
      downloadedAttachmentCount: input.downloadedAttachmentCount,
    },
  });
}

function resolveRoutedFeishuText(input: {
  message: ExternalMessageEnvelope;
  agentBotRoute: FeishuAgentBotRoute | null;
}): string | undefined {
  const text = input.message.text?.trim();
  if (!input.agentBotRoute?.botMentioned) {
    return text;
  }
  return ensureFeishuAgentMentionText({
    text,
    agentId: input.agentBotRoute.agentId,
  });
}

export { summarizeFeishuInboundEventPayload } from "./event-summary.ts";

function formatFeishuInboundErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\b(app_secret|appSecret|tenant_access_token|tenantAccessToken|verification_token|verificationToken|encrypt_key|encryptKey)\b\s*[:=]\s*("[^"]+"|'[^']+'|[^,\s]+)/g, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]");
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as { then?: unknown })?.then === "function";
}

function queueFeishuInboundNoticeSync(input: {
  context: IntegrationRuntimeContext;
  message: ExternalMessageEnvelope;
  channelBindingId?: string;
  text: string;
}): ExternalMessageOutboxRecord {
  const outbound = buildFeishuTextOutboundMessage({
    targetExternalChatId: input.message.externalChatId,
    targetExternalThreadId: input.message.externalThreadId,
    text: input.text,
  });
  return createExternalMessageOutboxSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    channelBindingId: input.channelBindingId,
    targetExternalChatId: outbound.targetExternalChatId,
    targetExternalThreadId: outbound.targetExternalThreadId,
    payloadJson: outbound.payload,
  });
}

function buildFeishuChannelBindingNotice(input: {
  workspaceId: string;
}): string {
  const settingsUrl = buildAgentSpaceSettingsIntegrationsDeepLink({
    workspaceId: input.workspaceId,
    target: "channel-bindings",
  });
  if (!settingsUrl) {
    return "这个飞书群还没有绑定到 AgentSpace channel。请 workspace 管理员在 AgentSpace 设置页完成绑定。";
  }
  return `这个飞书群还没有绑定到 AgentSpace channel。请 workspace 管理员打开 ${settingsUrl} 完成绑定。`;
}

function buildFeishuUserBindingNotice(input: {
  workspaceId: string;
}): string {
  const settingsUrl = buildAgentSpaceSettingsIntegrationsDeepLink({
    workspaceId: input.workspaceId,
    target: "user-bindings",
  });
  if (!settingsUrl) {
    return "你还没有绑定 AgentSpace 账号。请在 AgentSpace 设置页完成飞书账号绑定后再调度 Agent。";
  }
  return `你还没有绑定 AgentSpace 账号。请打开 ${settingsUrl} 完成飞书账号绑定后再调度 Agent。`;
}
