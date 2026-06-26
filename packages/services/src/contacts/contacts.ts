import {
  createChannelParticipantSync,
  DEFAULT_WORKSPACE_ID,
  enqueueNativeTaskSync,
  listChannelParticipantsSync,
  listWorkspaceMemberUsersSync,
  readLatestConversationExecutionSync,
  readUserSync,
  readWorkspaceMembershipSync,
  type WorkspaceRole,
} from "@agent-space/db";
import { type AgentSpaceState, type ChannelRecord, type DirectConversationState, type MessageAttachment } from "@agent-space/domain/workspace";
import { ensureDirectChannelRecord, resolveCompatibleDirectChannelRecord } from "../channels/channels.ts";
import { ensureWorkspaceStateSync, writeWorkspaceStateSync } from "../shared/state-io.ts";
import {
  readConversationExecutionWorkspaceState,
  resolveConversationExecutionWorkspacePath,
  upsertConversationExecutionWorkspaceState,
} from "../shared/conversation-execution-workspaces.ts";
import { createOpaqueId, sameValue, uniqueNames } from "../shared/helpers.ts";
import {
  applyWorkspaceDataPolicyToExternalMessageInput,
  assertWorkspaceDataPolicyAllowsExternalMessageInput,
  buildExternalMessageData,
  getChannelHistoryFilePath,
  pushWorkspaceMessageToChannel,
  sortDirectConversations,
  type ExternalMessageInputContext,
} from "../shared/messaging.ts";
import {
  assertCanUseBoundEmployeeRuntimeForActorSync,
  assertCanUseEmployeeForActorSync,
} from "../runtime-access/runtime-access.ts";

export function sendContactMessageSync(
  contactId: string,
  content: string,
  workspaceId?: string,
  requesterUserId?: string,
): AgentSpaceState {
  return sendContactMessageWithAttachmentsSync(contactId, content, undefined, workspaceId, requesterUserId);
}

export function sendContactMessageWithAttachmentsSync(
  contactId: string,
  content: string,
  attachments?: MessageAttachment[],
  workspaceId?: string,
  requesterUserId?: string,
  externalInput?: ExternalMessageInputContext,
): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const effectiveWorkspaceId = workspaceId ?? DEFAULT_WORKSPACE_ID;
  const resolvedHumanMember = requesterUserId
    ? resolveHumanMemberNameForUser(state, effectiveWorkspaceId, requesterUserId) ?? resolveDefaultHumanMemberName(state, effectiveWorkspaceId)
    : resolveDefaultHumanMemberName(state, effectiveWorkspaceId);
  const humanMemberName = resolvedHumanMember?.name;
  if (!humanMemberName) {
    throw new Error("A signed-in human member is required for direct messages.");
  }
  if (resolvedHumanMember.changed) {
    writeWorkspaceStateSync(state, effectiveWorkspaceId);
  }
  return sendContactMessageForHumanWithAttachmentsSync(
    humanMemberName,
    contactId,
    content,
    attachments,
    workspaceId,
    requesterUserId,
    externalInput,
  );
}

export function sendContactMessageForHumanWithAttachmentsSync(
  humanMemberName: string,
  contactId: string,
  content: string,
  attachments?: MessageAttachment[],
  workspaceId?: string,
  requesterUserId?: string,
  externalInput?: ExternalMessageInputContext,
): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const effectiveWorkspaceId = workspaceId ?? DEFAULT_WORKSPACE_ID;
  const contact = state.activeEmployees.find((employee) => sameValue(employee.name, contactId));
  if (!contact) {
    throw new Error(`Active employee "${contactId}" does not exist.`);
  }
  if (requesterUserId) {
    assertCanUseEmployeeForActorSync({
      workspaceId: effectiveWorkspaceId,
      employeeName: contact.name,
      actorUserId: requesterUserId,
    });
    assertCanUseBoundEmployeeRuntimeForActorSync({
      workspaceId: effectiveWorkspaceId,
      employeeName: contact.name,
      actorUserId: requesterUserId,
    });
  }

  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Message content is required.");
  }
  const governedExternalInput = applyWorkspaceDataPolicyToExternalMessageInput(externalInput, effectiveWorkspaceId, {
    hasAttachments: Boolean(attachments && attachments.length > 0),
  });
  assertWorkspaceDataPolicyAllowsExternalMessageInput(governedExternalInput);

  const directChannel = ensureDirectChannelRecord(state, {
    humanMemberName,
    employeeName: contact.name,
  });
  const existingExecutionWorkspace = readConversationExecutionWorkspaceState(state, {
    channelName: directChannel.name,
    agentId: contact.name,
    contactId: contact.name,
  });
  const humanMessage = pushWorkspaceMessageToChannel(state, directChannel.name, {
    speaker: humanMemberName,
    speakerUserId: requesterUserId,
    role: "human",
    summary: trimmed,
    status: "completed",
    attachments,
    data: buildExternalMessageData(governedExternalInput),
  }, effectiveWorkspaceId);
  const lastExecution = readLatestConversationExecutionSync(
    contact.name,
    {
      channelName: directChannel.name,
      contactId: contact.name,
    },
    effectiveWorkspaceId,
  );
  const resumedSessionId = existingExecutionWorkspace?.sessionId ?? lastExecution?.sessionId;
  const resumedWorkDir = existingExecutionWorkspace?.workDir ?? lastExecution?.workDir;
  const queued = enqueueNativeTaskSync({
    workspaceId: effectiveWorkspaceId,
    assignee: contact.name,
    title: `联系人私聊 · ${contact.name}`,
    channel: directChannel.name,
    priority: "medium",
    triggerType: "channel_chat",
    requestedByUserId: requesterUserId,
    requestedByDisplayName: humanMemberName,
    metadata: {
      contactId: contact.name,
      sourceMessageId: humanMessage.id,
      channelName: directChannel.name,
      channelMessage: trimmed,
      channelHistory: state.messages
        .filter((message) => sameValue(message.channel ?? "", directChannel.name))
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
        })),
      channelHistoryPath: getChannelHistoryFilePath(directChannel.name, effectiveWorkspaceId),
      channelSessionId: resumedSessionId,
      ...(governedExternalInput ? { externalInput: governedExternalInput } : {}),
      attachments:
        attachments?.map((attachment) => ({
          fileName: attachment.fileName,
          storedPath: attachment.storedPath,
          mediaType: attachment.mediaType,
          kind: attachment.kind,
        })) ?? [],
    },
  });

  if (!queued) {
    pushWorkspaceMessageToChannel(state, directChannel.name, {
      speaker: "System",
      role: "agent",
      summary: `${contact.name} does not have an executable container bound and cannot process this direct message.`,
      code: "contact.unavailable",
      data: { contact_name: contact.name },
      status: "error",
    }, effectiveWorkspaceId);
  } else {
    pushWorkspaceMessageToChannel(state, directChannel.name, {
      speaker: contact.name,
      role: "agent",
      summary: "Thinking",
      code: "agent.pending",
      data: {
        agent_name: contact.name,
        source_message_id: humanMessage.id,
      },
      status: "pending",
    }, effectiveWorkspaceId);
    state.ledger.unshift({
      title: "Direct message queued",
      note: `${humanMemberName} started a direct message with ${contact.name}, and it was queued for an agent.`,
    });
    upsertConversationExecutionWorkspaceState(state, {
      channelName: directChannel.name,
      agentId: contact.name,
      contactId: contact.name,
      humanMemberName,
      sessionId: resumedSessionId,
      workDir: resumedWorkDir ?? resolveConversationExecutionWorkspacePath({
        workspaceId: effectiveWorkspaceId,
        channelName: directChannel.name,
        agentId: contact.name,
      }),
      lastTaskQueueId: queued.id,
      lastError: null,
    });
  }

  const shell = ensureLegacyContactShell(state, contact.name, contact, true, humanMemberName);
  if (shell) {
    upsertDirectConversationStateSync(
      {
        contactId: contact.name,
        humanMemberName,
        sessionId: lastExecution?.sessionId,
        workDir: lastExecution?.workDir,
      },
      effectiveWorkspaceId,
      state,
    );
  }

  return writeWorkspaceStateSync(state, effectiveWorkspaceId);
}

export function sendHumanDirectMessageSync(input: {
  workspaceId?: string;
  actorUserId: string;
  targetUserId: string;
  content: string;
  attachments?: MessageAttachment[];
  replyToMessageId?: string;
}): AgentSpaceState {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const actorUserId = input.actorUserId.trim();
  const targetUserId = input.targetUserId.trim();
  if (!actorUserId || !targetUserId) {
    throw new Error("Human direct message participants are required.");
  }
  if (actorUserId === targetUserId) {
    throw new Error("Cannot start a direct message with yourself.");
  }

  const actor = readUserSync(actorUserId);
  const target = readUserSync(targetUserId);
  const actorMembership = readWorkspaceMembershipSync(workspaceId, actorUserId);
  const targetMembership = readWorkspaceMembershipSync(workspaceId, targetUserId);
  if (!actor || !target || !actorMembership || !targetMembership) {
    throw new Error("Human direct messages require both users to be active workspace members.");
  }

  const trimmed = input.content.trim();
  if (!trimmed) {
    throw new Error("Message content is required.");
  }

  const state = ensureWorkspaceStateSync(workspaceId);
  ensureHumanMemberSnapshot(state, actor.displayName, actorMembership.role);
  ensureHumanMemberSnapshot(state, target.displayName, targetMembership.role);

  let channel = resolveHumanDirectChannelForUsersSync({
    workspaceId,
    state,
    userIds: [actorUserId, targetUserId],
  });
  let createdChannel = false;
  if (!channel) {
    channel = {
      name: `direct-${createOpaqueId()}`,
      kind: "direct",
      humanMemberNames: uniqueNames([actor.displayName, target.displayName]),
      humanMembers: 2,
      employeeNames: [],
    };
    state.channels.unshift(channel);
    state.ledger.unshift({
      title: "Human direct conversation created",
      note: `${actor.displayName} started a direct conversation with ${target.displayName}.`,
    });
    createdChannel = true;
  } else {
    channel.humanMemberNames = uniqueNames([actor.displayName, target.displayName]);
    channel.humanMembers = channel.humanMemberNames.length;
  }

  pushWorkspaceMessageToChannel(state, channel.name, {
    speaker: actor.displayName,
    role: "human",
    summary: trimmed,
    status: "completed",
    attachments: input.attachments,
    replyToMessageId: input.replyToMessageId?.trim() || undefined,
  }, workspaceId);

  const written = writeWorkspaceStateSync(state, workspaceId);
  ensureHumanDirectParticipants(workspaceId, channel.name, actorUserId, targetUserId, actorUserId);

  if (createdChannel) {
    const writtenChannel = written.channels.find((item) => sameValue(item.name, channel.name));
    if (writtenChannel) {
      writtenChannel.humanMemberNames = channel.humanMemberNames;
      writtenChannel.humanMembers = channel.humanMembers;
    }
  }

  return written;
}

export function postHumanDirectSystemMessageSync(input: {
  workspaceId?: string;
  leftUserId: string;
  rightUserId: string;
  summary: string;
  code: string;
  data?: Record<string, string | undefined>;
}): AgentSpaceState {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const leftUserId = input.leftUserId.trim();
  const rightUserId = input.rightUserId.trim();
  if (!leftUserId || !rightUserId || leftUserId === rightUserId) {
    throw new Error("Human direct system message participants are required.");
  }

  const left = readUserSync(leftUserId);
  const right = readUserSync(rightUserId);
  const leftMembership = readWorkspaceMembershipSync(workspaceId, leftUserId);
  const rightMembership = readWorkspaceMembershipSync(workspaceId, rightUserId);
  if (!left || !right || !leftMembership || !rightMembership) {
    throw new Error("Human direct system messages require both users to be active workspace members.");
  }

  const summary = input.summary.trim();
  if (!summary) {
    throw new Error("Message content is required.");
  }

  const state = ensureWorkspaceStateSync(workspaceId);
  ensureHumanMemberSnapshot(state, left.displayName, leftMembership.role);
  ensureHumanMemberSnapshot(state, right.displayName, rightMembership.role);

  let channel = resolveHumanDirectChannelForUsersSync({
    workspaceId,
    state,
    userIds: [leftUserId, rightUserId],
  });
  let createdChannel = false;
  if (!channel) {
    channel = {
      name: `direct-${createOpaqueId()}`,
      kind: "direct",
      humanMemberNames: uniqueNames([left.displayName, right.displayName]),
      humanMembers: 2,
      employeeNames: [],
    };
    state.channels.unshift(channel);
    state.ledger.unshift({
      title: "Human direct conversation created",
      note: `System started a direct conversation between ${left.displayName} and ${right.displayName}.`,
    });
    createdChannel = true;
  } else {
    channel.humanMemberNames = uniqueNames([left.displayName, right.displayName]);
    channel.humanMembers = channel.humanMemberNames.length;
  }

  pushWorkspaceMessageToChannel(state, channel.name, {
    speaker: "系统提示",
    role: "agent",
    summary,
    code: input.code,
    data: compactStringRecord(input.data ?? {}),
    status: "completed",
  }, workspaceId);

  const written = writeWorkspaceStateSync(state, workspaceId);
  ensureHumanDirectParticipants(workspaceId, channel.name, leftUserId, rightUserId, leftUserId);

  if (createdChannel) {
    const writtenChannel = written.channels.find((item) => sameValue(item.name, channel.name));
    if (writtenChannel) {
      writtenChannel.humanMemberNames = channel.humanMemberNames;
      writtenChannel.humanMembers = channel.humanMembers;
    }
  }

  return written;
}

export function resolveHumanDirectChannelForUsersSync(input: {
  workspaceId?: string;
  userIds: [string, string];
  state?: AgentSpaceState;
}): ChannelRecord | null {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const [leftUserId, rightUserId] = input.userIds.map((userId) => userId.trim()) as [string, string];
  if (!leftUserId || !rightUserId || leftUserId === rightUserId) {
    return null;
  }

  const state = input.state ?? ensureWorkspaceStateSync(workspaceId);
  const directChannels = state.channels.filter((channel) =>
    channel.kind === "direct" && channel.employeeNames.length === 0,
  );
  for (const channel of directChannels) {
    const participantIds = listChannelParticipantsSync(workspaceId, channel.name)
      .map((participant) => participant.userId);
    if (participantIds.includes(leftUserId) && participantIds.includes(rightUserId)) {
      return channel;
    }
  }

  const leftUser = readUserSync(leftUserId);
  const rightUser = readUserSync(rightUserId);
  if (!leftUser || !rightUser) {
    return null;
  }
  return directChannels.find((channel) => {
    const names = channel.humanMemberNames ?? [];
    return (
      names.some((name) => sameValue(name, leftUser.displayName)) &&
      names.some((name) => sameValue(name, rightUser.displayName))
    );
  }) ?? null;
}

function compactStringRecord(input: Record<string, string | undefined>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.trim()) {
      output[key] = value;
    }
  }
  return output;
}

function resolveDefaultHumanMemberName(
  state: AgentSpaceState,
  workspaceId: string,
): { name: string; changed: boolean } | undefined {
  const legacyName = state.humanMembers[0]?.name;
  if (legacyName) {
    return { name: legacyName, changed: false };
  }
  const workspaceMember = listWorkspaceMemberUsersSync(workspaceId)[0];
  if (!workspaceMember) {
    return undefined;
  }
  return {
    name: workspaceMember.displayName,
    changed: ensureHumanMemberSnapshot(state, workspaceMember.displayName, workspaceMember.role),
  };
}

function resolveHumanMemberNameForUser(
  state: AgentSpaceState,
  workspaceId: string,
  userId: string,
): { name: string; changed: boolean } | undefined {
  const user = readUserSync(userId);
  const membership = readWorkspaceMembershipSync(workspaceId, userId);
  if (!user || !membership) {
    return undefined;
  }
  return {
    name: user.displayName,
    changed: ensureHumanMemberSnapshot(state, user.displayName, membership.role),
  };
}

export function upsertDirectConversationStateSync(
  input: {
    contactId: string;
    humanMemberName?: string;
    sessionId?: string | null;
    workDir?: string | null;
  },
  workspaceId?: string,
  stateArg?: AgentSpaceState,
): AgentSpaceState {
  const state = stateArg ?? ensureWorkspaceStateSync(workspaceId);
  const employee = state.activeEmployees.find((item) => sameValue(item.name, input.contactId));
  const shell = ensureLegacyContactShell(
    state,
    input.contactId,
    employee,
    Boolean(input.sessionId || input.workDir || input.humanMemberName),
    input.humanMemberName,
  );
  if (!shell) {
    throw new Error(`Direct conversation "${input.contactId}" does not exist.`);
  }

  shell.updatedAt = new Date().toISOString();
  shell.humanMemberName = input.humanMemberName ?? shell.humanMemberName;
  shell.sessionId = input.sessionId === null ? undefined : (input.sessionId ?? shell.sessionId);
  shell.workDir = input.workDir === null ? undefined : (input.workDir ?? shell.workDir);
  state.directConversations = sortDirectConversations(state.directConversations);
  return stateArg ? state : writeWorkspaceStateSync(state, workspaceId);
}

function ensureLegacyContactShell(
  state: AgentSpaceState,
  contactId: string,
  employee?: AgentSpaceState["activeEmployees"][number],
  required = false,
  humanMemberName?: string,
): DirectConversationState | null {
  const existing = state.directConversations.find((item) => sameValue(item.contactId, contactId));
  if (existing) {
    return existing;
  }
  if (!employee || !required) {
    return null;
  }

  const shell: DirectConversationState = {
    contactId: employee.name,
    humanMemberName: humanMemberName ?? state.humanMembers[0]?.name,
    updatedAt: new Date().toISOString(),
  };
  state.directConversations.unshift(shell);
  return shell;
}

function ensureHumanDirectParticipants(
  workspaceId: string,
  channelName: string,
  actorUserId: string,
  targetUserId: string,
  addedBy: string,
): void {
  createChannelParticipantSync({
    workspaceId,
    channelName,
    userId: actorUserId,
    addedBy,
  });
  createChannelParticipantSync({
    workspaceId,
    channelName,
    userId: targetUserId,
    addedBy,
  });
}

function ensureHumanMemberSnapshot(
  state: AgentSpaceState,
  displayName: string,
  role: WorkspaceRole,
): boolean {
  if (state.humanMembers.some((member) => sameValue(member.name, displayName))) {
    return false;
  }
  state.humanMembers.push({
    name: displayName,
    role: formatWorkspaceRole(role),
  });
  return true;
}

function formatWorkspaceRole(role: WorkspaceRole): string {
  if (role === "owner") {
    return "Owner";
  }
  if (role === "admin") {
    return "Admin";
  }
  return "Member";
}

function resolveLegacyContactMirrorChannel(state: AgentSpaceState, contactId: string): string | null {
  return resolveCompatibleDirectChannelRecord(state, contactId)?.name ?? null;
}
