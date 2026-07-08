import { appendFileSync, existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentSpaceState,
  DirectConversationState,
  MessageAttachment,
  MessageMention,
  WorkspaceMessage,
} from "@agent-space/domain/workspace";
import type { ChannelDocumentRunStep } from "@agent-space/domain";
import type { MentionCandidate } from "@agent-space/domain";
import {
  DEFAULT_WORKSPACE_ID,
  enqueueNativeTaskSync,
  getWorkspaceChannelHistoryDirPath,
  readLatestChannelExecutionSync,
} from "@agent-space/db";
import {
  markChannelDocumentRunStepQueued,
} from "../documents/runs.ts";
import {
  STATE_DIR,
  createOpaqueId,
  formatTimeOfDay,
  nowTime,
  sameValue,
  slugify,
  resolveRepositoryRoot,
} from "./helpers.ts";
import {
  readConversationExecutionWorkspaceState,
  resolveConversationExecutionWorkspacePath,
  upsertConversationExecutionWorkspaceState,
} from "./conversation-execution-workspaces.ts";
import {
  assertCanUseBoundEmployeeRuntimeInChannelForActorSync,
  assertCanUseEmployeeInChannelForActorSync,
} from "../runtime-access/runtime-access.ts";
import {
  decideWorkspaceDataPolicyForExternalMessageSync,
  type WorkspaceDataPolicyDecision,
} from "../policies/workspace-data.ts";

export interface ExternalMessageInputContext {
  provider: string;
  providerLabel?: string;
  externalEventId?: string;
  externalMessageId?: string;
  externalChatId?: string;
  externalContext?: string;
  trust: "untrusted_user_message";
  actor?: {
    actorType: "user" | "external_guest";
    userId?: string;
    externalActorReference?: string;
    externalGuestPermissionProfile?: string;
    externalGuestRequireIdentityFor?: string[];
    agentId?: string;
    botBindingId?: string;
  };
  workspaceDataPolicy?: WorkspaceDataPolicyDecision;
}

export function applyWorkspaceDataPolicyToExternalMessageInput(
  input: ExternalMessageInputContext | undefined,
  workspaceId = DEFAULT_WORKSPACE_ID,
  options?: {
    hasAttachments?: boolean;
    contentHash?: string;
  },
): ExternalMessageInputContext | undefined {
  if (!input) {
    return undefined;
  }

  return {
    ...input,
    workspaceDataPolicy: input.workspaceDataPolicy ?? decideWorkspaceDataPolicyForExternalMessageSync({
      workspaceId,
      source: {
        type: "external_message",
        provider: input.provider,
        providerLabel: input.providerLabel,
        externalEventId: input.externalEventId,
        externalMessageId: input.externalMessageId,
        externalChatId: input.externalChatId,
        trust: input.trust,
      },
      content: {
        kind: "message",
        hasAttachments: options?.hasAttachments,
        contentHash: options?.contentHash,
      },
    }),
  };
}

export function assertWorkspaceDataPolicyAllowsExternalMessageInput(
  input: ExternalMessageInputContext | undefined,
): void {
  if (!input) {
    return;
  }
  const policy = input.workspaceDataPolicy;
  if (
    !policy ||
    policy.decision !== "allow" ||
    !policy.allowedUses.storeInWorkspace ||
    !policy.allowedUses.includeInAgentContext
  ) {
    throw new Error(`External message rejected by workspace data policy: ${policy?.reasonCode ?? "workspace_data.policy_missing"}`);
  }
}

export function buildExternalMessageData(input: ExternalMessageInputContext | undefined): Record<string, string> | undefined {
  const governedInput = applyWorkspaceDataPolicyToExternalMessageInput(input);
  if (!governedInput) {
    return undefined;
  }
  const policy = governedInput.workspaceDataPolicy;
  const externalContext = normalizeExternalContextString(governedInput.externalContext);
  return {
    external_provider: governedInput.provider,
    ...(governedInput.providerLabel ? { external_provider_label: governedInput.providerLabel } : {}),
    ...(governedInput.externalEventId ? { external_event_id: governedInput.externalEventId } : {}),
    ...(governedInput.externalMessageId ? { external_message_id: governedInput.externalMessageId } : {}),
    ...(governedInput.externalChatId ? { external_chat_id: governedInput.externalChatId } : {}),
    ...(externalContext ? { external_context: externalContext } : {}),
    external_trust: governedInput.trust,
    ...(policy ? {
      workspace_data_policy_decision: policy.decision,
      workspace_data_policy_reason: policy.reasonCode,
      workspace_data_classification: policy.classification,
      workspace_data_store: String(policy.allowedUses.storeInWorkspace),
      workspace_data_search: String(policy.allowedUses.includeInSearch),
      workspace_data_agent_context: String(policy.allowedUses.includeInAgentContext),
    } : {}),
  };
}

function normalizeExternalContextString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > 4000 ? trimmed.slice(0, 4000).trimEnd() : trimmed;
}

export function pushWorkspaceMessageIfChannel(
  state: AgentSpaceState,
  channel: string | undefined,
  input: {
    speaker: string;
    speakerUserId?: string;
    role: "human" | "agent";
    summary: string;
    code?: string;
    data?: Record<string, string>;
    attachments?: MessageAttachment[];
    mentions?: MessageMention[];
  },
  workspaceId = DEFAULT_WORKSPACE_ID,
): void {
  if (!channel || !state.channels.some((item) => sameValue(item.name, channel))) {
    return;
  }

  pushWorkspaceMessageToChannel(state, channel, input, workspaceId);
}

export function pushWorkspaceMessageToChannel(
  state: AgentSpaceState,
  channel: string,
  input: {
    speaker: string;
    speakerUserId?: string;
    role: "human" | "agent";
    summary: string;
    code?: string;
    data?: Record<string, string>;
    status?: "pending" | "completed" | "error";
    attachments?: MessageAttachment[];
    mentions?: MessageMention[];
    replyToMessageId?: string;
  },
  workspaceId = DEFAULT_WORKSPACE_ID,
): WorkspaceMessage {
  const message = createWorkspaceMessageRecord({
    channel,
    speaker: input.speaker,
    speakerUserId: input.speakerUserId,
    role: input.role,
    summary: input.summary,
    code: input.code,
    data: input.data,
    status: input.status ?? "completed",
    attachments: input.attachments,
    mentions: input.mentions,
    replyToMessageId: input.replyToMessageId,
  });
  state.messages.unshift(message);

  if ((input.status ?? "completed") !== "pending") {
    appendChannelHistoryEntry(channel, {
      speaker: input.speaker,
      role: input.role,
      summary: input.summary,
      status: input.status ?? "completed",
      mentions: input.mentions,
      attachments: input.attachments,
    }, workspaceId);
  }

  return message;
}

export function createWorkspaceMessageRecord(input: {
  channel?: string;
  speaker: string;
  speakerUserId?: string;
  role: "human" | "agent";
  summary: string;
  code?: string;
  data?: Record<string, string>;
  status?: "pending" | "completed" | "error";
  attachments?: MessageAttachment[];
  mentions?: MessageMention[];
  replyToMessageId?: string;
}): WorkspaceMessage {
  return {
    id: `message-${createOpaqueId()}`,
    channel: input.channel,
    speaker: input.speaker,
    speakerUserId: input.speakerUserId,
    role: input.role,
    time: nowTime(),
    summary: input.summary,
    code: input.code,
    data: input.data,
    status: input.status ?? "completed",
    attachments: input.attachments,
    mentions: input.mentions && input.mentions.length > 0 ? input.mentions : undefined,
    replyToMessageId: input.replyToMessageId,
  };
}

export function buildMentionCandidates(state: AgentSpaceState, channelName: string): MentionCandidate[] {
  return state.activeEmployees.map((employee) => ({
    agentId: employee.name,
    label: employee.remarkName?.trim() || employee.name,
    aliases: [employee.name, employee.remarkName?.trim() || employee.name],
    inChannel: employee.channels.some((name) => sameValue(name, channelName)),
  }));
}

export function buildChannelHistorySnapshot(state: AgentSpaceState, channelName: string): Array<{
  speaker: string;
  role?: string;
  summary: string;
  time?: string;
  status?: string;
  kind?: string;
  processType?: string;
  mentions: string[];
  attachments: string[];
}> {
  return state.messages
    .filter((message) => sameValue(message.channel ?? "", channelName))
    .slice()
    .reverse()
    .map((message) => ({
      speaker: message.speaker,
      role: message.role,
      summary: message.summary,
      time: message.time,
      status: message.status,
      kind: message.kind,
      processType: message.processType,
      mentions: message.mentions?.map((item) => item.token) ?? [],
      attachments: message.attachments?.map((attachment) => attachment.fileName) ?? [],
    }));
}

export function enqueueChannelMentionStepSync(
  state: AgentSpaceState,
  input: {
    channelName: string;
    sourceMessage?: WorkspaceMessage;
    fullMessage: string;
    attachments?: MessageAttachment[];
    step: ChannelDocumentRunStep;
    mentionedAgentIds: string[];
    mentionedAgentLabels: string[];
    handoffDocumentIds?: string[];
    handoffDocumentVersionIds?: string[];
    externalInput?: ExternalMessageInputContext;
    workspaceId?: string;
    requesterUserId?: string;
    requesterDisplayName?: string;
  },
): boolean {
  const agent = state.activeEmployees.find((employee) => sameValue(employee.name, input.step.agentId));
  if (!agent) {
    return false;
  }

  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const externalInput = applyWorkspaceDataPolicyToExternalMessageInput(input.externalInput, workspaceId, {
    hasAttachments: Boolean(input.attachments && input.attachments.length > 0),
  });
  assertWorkspaceDataPolicyAllowsExternalMessageInput(externalInput);
  if (input.requesterUserId) {
    assertCanUseEmployeeInChannelForActorSync({
      workspaceId,
      employeeName: agent.name,
      channelName: input.channelName,
      actorUserId: input.requesterUserId,
      actorDisplayName: input.requesterDisplayName,
    });
    assertCanUseBoundEmployeeRuntimeInChannelForActorSync({
      workspaceId,
      employeeName: agent.name,
      channelName: input.channelName,
      actorUserId: input.requesterUserId,
      actorDisplayName: input.requesterDisplayName,
    });
  }
  const existingExecutionWorkspace = readConversationExecutionWorkspaceState(state, {
    channelName: input.channelName,
    agentId: agent.name,
  });
  const lastExecution = readLatestChannelExecutionSync(agent.name, input.channelName, workspaceId);
  const resumedSessionId = existingExecutionWorkspace?.sessionId ?? lastExecution?.sessionId;
  const resumedWorkDir = existingExecutionWorkspace?.workDir ?? lastExecution?.workDir;
  const queued = enqueueNativeTaskSync({
    workspaceId,
    assignee: agent.name,
    title: `@提及 · ${input.channelName} · ${input.step.agentLabel}`,
    channel: input.channelName,
    priority: "medium",
    triggerType: "mention_chat",
    requestedByUserId: input.requesterUserId,
    requestedByDisplayName: input.requesterDisplayName,
    metadata: {
      orchestrationRunId: input.step.runId,
      orchestrationStepId: input.step.id,
      stepInstruction: input.step.instruction,
      stepDependsOnIds: input.step.dependsOnStepIds,
      stepHandoffKind: input.step.handoffKind,
      handoffDocumentIds: input.handoffDocumentIds ?? [],
      handoffDocumentVersionIds: input.handoffDocumentVersionIds ?? [],
      sourceChannel: input.channelName,
      sourceMessageId: input.sourceMessage?.id,
      mentionType: "agent",
      mentionedAgentIds: input.mentionedAgentIds,
      mentionedAgentLabels: input.mentionedAgentLabels,
      assigneeMentionToken: input.step.agentLabel,
      channelName: input.channelName,
      channelMessage: input.fullMessage,
      channelHistory: buildChannelHistorySnapshot(state, input.channelName),
      channelHistoryPath: getChannelHistoryFilePath(input.channelName, workspaceId),
      channelSessionId: resumedSessionId,
      ...(externalInput ? { externalInput } : {}),
      attachments:
        input.attachments?.map((attachment) => ({
          fileName: attachment.fileName,
          storedPath: attachment.storedPath,
          mediaType: attachment.mediaType,
          kind: attachment.kind,
        })) ?? [],
    },
  });

  if (!queued) {
    return false;
  }

  upsertConversationExecutionWorkspaceState(state, {
    channelName: input.channelName,
    agentId: agent.name,
    sessionId: resumedSessionId,
    workDir: resumedWorkDir ?? resolveConversationExecutionWorkspacePath({
      workspaceId,
      channelName: input.channelName,
      agentId: agent.name,
    }),
    lastTaskQueueId: queued.id,
    lastError: null,
  });

  markChannelDocumentRunStepQueued(state, input.step.id, queued.id);
  pushWorkspaceMessageToChannel(state, input.channelName, {
    speaker: agent.name,
    role: "agent",
    summary: "Thinking",
    code: "agent.pending",
    data: { agent_name: agent.name },
    status: "pending",
  }, workspaceId);
  return true;
}

export function getChannelHistoryFilePath(channelName: string, workspaceId = DEFAULT_WORKSPACE_ID): string {
  return join(getChannelHistoryDirPath(workspaceId), `${slugify(channelName)}.md`);
}

export function renameChannelHistoryFile(previousName: string, nextName: string, workspaceId = DEFAULT_WORKSPACE_ID): void {
  const previousPath = getChannelHistoryFilePath(previousName, workspaceId);
  const nextPath = getChannelHistoryFilePath(nextName, workspaceId);

  if (existsSync(previousPath) && previousPath !== nextPath) {
    renameSync(previousPath, nextPath);
  }

  ensureChannelHistoryFile(nextName, workspaceId);
}

export function removeChannelHistoryFile(channelName: string, workspaceId = DEFAULT_WORKSPACE_ID): void {
  const filePath = getChannelHistoryFilePath(channelName, workspaceId);
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true });
  }
}

export function sortDirectConversations(threads: DirectConversationState[]): DirectConversationState[] {
  return [...threads].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

// ── Private channel history helpers ──────────────────────────────────

function getChannelHistoryDirPath(workspaceId = DEFAULT_WORKSPACE_ID): string {
  return getWorkspaceChannelHistoryDirPath(workspaceId);
}

function ensureChannelHistoryFile(channelName: string, workspaceId = DEFAULT_WORKSPACE_ID): void {
  const filePath = getChannelHistoryFilePath(channelName, workspaceId);
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `# 群聊记录：${channelName}\n\n`, "utf8");
  }
}

function appendChannelHistoryEntry(
  channelName: string,
  input: {
    speaker: string;
    role: "human" | "agent";
    summary: string;
    status: "pending" | "completed" | "error";
    mentions?: MessageMention[];
    attachments?: MessageAttachment[];
  },
  workspaceId = DEFAULT_WORKSPACE_ID,
): void {
  ensureChannelHistoryFile(channelName, workspaceId);
  const filePath = getChannelHistoryFilePath(channelName, workspaceId);
  const mentionBlock =
    input.mentions && input.mentions.length > 0
      ? `\n\n提及：\n${input.mentions.map((mention) => `- @${mention.token} -> ${mention.label}`).join("\n")}`
      : "";
  const attachmentBlock =
    input.attachments && input.attachments.length > 0
      ? `\n\n附件：\n${input.attachments.map((attachment) => `- ${attachment.fileName}`).join("\n")}`
      : "";
  appendFileSync(
    filePath,
    `## ${formatTimeOfDay()} · ${input.speaker} · ${input.role} · ${input.status}\n\n${input.summary}${mentionBlock}${attachmentBlock}\n\n`,
    "utf8",
  );
}
