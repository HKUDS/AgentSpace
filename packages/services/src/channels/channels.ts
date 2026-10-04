import { type AgentSpaceState, type ChannelRecord } from "@agent-space/domain/workspace";
import { existsSync, renameSync, rmSync } from "node:fs";
import {
  createStoredChannelSync,
  DEFAULT_WORKSPACE_ID,
  deleteStoredChannelSync,
  deleteStoredTasksForChannelSync,
  listWorkspaceMemberUsersSync,
  readStoredChannelSync,
  renameStoredChannelReferencesSync,
  getDatabase,
  withTransaction,
  updateStoredChannelSync,
} from "@agent-space/db";
import { pruneOrphanWorkspaceAttachmentsSync } from "../attachments/attachments.ts";
import { ensureWorkspaceStateSync, writeWorkspaceStateSync } from "../shared/state-io.ts";
import { createOpaqueId, sameValue, uniqueNames } from "../shared/helpers.ts";
import { getChannelHistoryFilePath, pushWorkspaceMessageIfChannel, renameChannelHistoryFile, removeChannelHistoryFile } from "../shared/messaging.ts";

const SYSTEM_NOTICE = "System";

export function isDirectChannel(channel: Pick<ChannelRecord, "kind">): boolean {
  return channel.kind === "direct";
}

export function isGroupChannel(channel: Pick<ChannelRecord, "kind">): boolean {
  return !isDirectChannel(channel);
}

export function findDirectChannelRecord(
  state: AgentSpaceState,
  input: { humanMemberName: string; employeeName: string },
): ChannelRecord | undefined {
  const humanMemberName = input.humanMemberName.trim();
  const employeeName = input.employeeName.trim();
  if (!humanMemberName || !employeeName) {
    return undefined;
  }

  return state.channels.find(
    (channel) =>
      isDirectChannel(channel) &&
      (channel.humanMemberNames ?? []).some((name) => sameValue(name, humanMemberName)) &&
      channel.employeeNames.some((name) => sameValue(name, employeeName)),
  );
}

export function resolveChannelHumanMemberNames(
  state: AgentSpaceState,
  channel: Pick<ChannelRecord, "humanMemberNames" | "humanMembers">,
): string[] {
  const explicitNames = uniqueNames(channel.humanMemberNames ?? []);
  if (explicitNames.length > 0) {
    return explicitNames;
  }

  return state.humanMembers
    .slice(0, Math.max(0, channel.humanMembers))
    .map((member) => member.name);
}

export function resolveChannelHumanMemberCount(
  state: AgentSpaceState,
  channel: Pick<ChannelRecord, "humanMemberNames" | "humanMembers">,
): number {
  return resolveChannelHumanMemberNames(state, channel).length;
}

export function ensureDirectChannelRecord(
  state: AgentSpaceState,
  input: { humanMemberName: string; employeeName: string },
): ChannelRecord {
  const humanMemberName = input.humanMemberName.trim();
  const employeeName = input.employeeName.trim();
  const employee = state.activeEmployees.find((item) => sameValue(item.name, employeeName));
  if (!humanMemberName) {
    throw new Error("Human member name is required.");
  }
  if (!state.humanMembers.some((member) => sameValue(member.name, humanMemberName))) {
    state.humanMembers.push({ name: humanMemberName, role: "Member" });
  }
  if (!employee) {
    throw new Error(`Active employee "${employeeName}" does not exist.`);
  }

  let channel = findDirectChannelRecord(state, { humanMemberName, employeeName });
  if (!channel) {
    channel = {
      name: `direct-${createOpaqueId()}`,
      kind: "direct",
      humanMemberNames: [humanMemberName],
      humanMembers: 1,
      employeeNames: [employee.name],
    };
    state.channels.unshift(channel);
  } else {
    channel.kind = "direct";
    channel.humanMemberNames = uniqueNames([...(channel.humanMemberNames ?? []), humanMemberName]);
    channel.humanMembers = channel.humanMemberNames.length;
    channel.employeeNames = uniqueNames([...channel.employeeNames, employee.name]);
  }

  state.activeEmployees = state.activeEmployees.map((item) => {
    if (!sameValue(item.name, employee.name)) {
      return item;
    }
    if (item.channels.some((name) => sameValue(name, channel.name))) {
      return item;
    }
    return {
      ...item,
      channels: [...item.channels, channel.name],
    };
  });

  return channel;
}

export function resolveCompatibleDirectChannelRecord(
  state: AgentSpaceState,
  employeeName: string,
): ChannelRecord | null {
  const employee = state.activeEmployees.find((item) => sameValue(item.name, employeeName));
  if (!employee) {
    return null;
  }

  const existingDirectChannels = state.channels.filter(
    (channel) =>
      isDirectChannel(channel) &&
      channel.employeeNames.some((name) => sameValue(name, employee.name)),
  );
  if (existingDirectChannels.length === 1) {
    return existingDirectChannels[0] ?? null;
  }
  if (existingDirectChannels.length > 1) {
    return null;
  }
  const humanName =
    state.directConversations.find((conversation) => sameValue(conversation.contactId, employee.name))?.humanMemberName
    ?? (state.humanMembers.length === 1 ? state.humanMembers[0]?.name : undefined);
  if (!humanName) {
    return null;
  }

  return (
    findDirectChannelRecord(state, {
      humanMemberName: humanName,
      employeeName: employee.name,
    }) ?? ensureDirectChannelRecord(state, {
      humanMemberName: humanName,
      employeeName: employee.name,
    })
  );
}

export function ensureDirectChannelSync(input: {
  humanMemberName: string;
  employeeName: string;
}, workspaceId?: string): { state: AgentSpaceState; channelName: string } {
  const state = ensureWorkspaceStateSync(workspaceId);
  const channel = ensureDirectChannelRecord(state, input);
  upsertStoredChannelRecordSync(channel, workspaceId);
  const written = writeWorkspaceStateSync(state, workspaceId);
  return {
    state: written,
    channelName: channel.name,
  };
}

export function removeChannelArtifactsFromState(
  state: AgentSpaceState,
  channelName: string,
  workspaceId?: string,
): AgentSpaceState {
  const documentIds = new Set(
    state.channelDocuments
      .filter((document) => sameValue(document.channelName, channelName))
      .map((document) => document.id),
  );
  const runIds = new Set(
    state.channelDocumentRuns
      .filter((run) => sameValue(run.channelName, channelName))
      .map((run) => run.id),
  );

  state.channels = state.channels.filter((item) => !sameValue(item.name, channelName));
  state.conversationExecutionWorkspaces = (state.conversationExecutionWorkspaces ?? []).filter(
    (workspace) => !sameValue(workspace.channelName, channelName),
  );
  state.messages = state.messages.filter((message) => !sameValue(message.channel ?? "", channelName));
  state.tasks = state.tasks.filter((task) => !sameValue(task.channel, channelName));
  state.approvals = state.approvals.filter((approval) => !sameValue(approval.channelName, channelName));
  state.dataTables = state.dataTables.map((table) =>
    sameValue(table.channelName ?? "", channelName)
      ? {
          ...table,
          channelName: undefined,
        }
      : table,
  );
  state.scheduledTasks = state.scheduledTasks.map((task) =>
    sameValue(task.channelName ?? "", channelName)
      ? {
          ...task,
          channelName: undefined,
        }
      : task,
  );
  state.channelDocuments = state.channelDocuments.filter((document) => !documentIds.has(document.id));
  state.channelDocumentVersions = state.channelDocumentVersions.filter((version) => !documentIds.has(version.documentId));
  state.channelDocumentBlocks = state.channelDocumentBlocks.filter((block) => !documentIds.has(block.documentId));
  state.channelDocumentAccesses = state.channelDocumentAccesses.filter((access) => !documentIds.has(access.documentId));
  state.channelDocumentChangeSets = state.channelDocumentChangeSets.filter((changeSet) => !documentIds.has(changeSet.documentId));
  state.channelDocumentConflicts = state.channelDocumentConflicts.filter((conflict) => !documentIds.has(conflict.documentId));
  state.channelDocumentPresences = state.channelDocumentPresences.filter((presence) => !documentIds.has(presence.documentId));
  state.channelDocumentRuns = state.channelDocumentRuns.filter((run) => !runIds.has(run.id));
  state.channelDocumentRunSteps = state.channelDocumentRunSteps.filter((step) => !runIds.has(step.runId));
  state.externalSheetOperationRuns = (state.externalSheetOperationRuns ?? []).filter(
    (run) => !documentIds.has(run.channelDocumentId),
  );
  state.activeEmployees = state.activeEmployees.map((employee) => ({
    ...employee,
    channels: employee.channels.filter((name) => !sameValue(name, channelName)),
  }));
  removeChannelHistoryFile(channelName, workspaceId);

  return state;
}

export function createChannelSync(input: {
  name: string;
  humanMemberNames?: string[];
  employeeNames?: string[];
  kind?: ChannelRecord["kind"];
}, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const humanMemberNames = uniqueNames(input.humanMemberNames ?? []);
  const employeeNames = uniqueNames(input.employeeNames ?? []);
  const name = input.name.trim();

  if (!name) {
    throw new Error("Channel name is required.");
  }

  if (state.channels.some((channel) => sameValue(channel.name, name))) {
    throw new Error(`Channel "${name}" already exists.`);
  }

  ensureLegacyHumanMembersForDisplayNames(state, humanMemberNames, workspaceId);
  for (const memberName of humanMemberNames) {
    if (!state.humanMembers.some((member) => sameValue(member.name, memberName))) {
      throw new Error(`Human member "${memberName}" does not exist.`);
    }
  }

  for (const employeeName of employeeNames) {
    if (!state.activeEmployees.some((employee) => sameValue(employee.name, employeeName))) {
      throw new Error(`Active employee "${employeeName}" does not exist.`);
    }
  }

  state.channels.push({
    name,
    kind: input.kind ?? "group",
    humanMemberNames,
    humanMembers: humanMemberNames.length,
    employeeNames: [...employeeNames],
  });
  upsertStoredChannelRecordSync(state.channels[state.channels.length - 1]!, workspaceId);

  state.activeEmployees = state.activeEmployees.map((employee) => {
    if (!employeeNames.some((employeeName) => sameValue(employee.name, employeeName))) {
      return employee;
    }
    if (employee.channels.some((channelName) => sameValue(channelName, name))) {
      return employee;
    }
    return {
      ...employee,
      channels: [...employee.channels, name],
    };
  });

  state.ledger.unshift({
    title: "Channel created",
    note: `Created channel ${name} with ${humanMemberNames.length} human member(s) and ${employeeNames.length} agent(s).`,
  });
  pushWorkspaceMessageIfChannel(state, name, {
    speaker: SYSTEM_NOTICE,
    role: "agent",
    summary: `Channel ${name} was created and is ready for collaboration.`,
    code: "channel.created_notice",
    data: { channel_name: name },
  }, workspaceId);

  return writeWorkspaceStateSync(state, workspaceId);
}

export function addChannelEmployeesToState(state: AgentSpaceState, input: {
  channelName: string;
  employeeNames: string[];
}): ChannelRecord {
  const channelName = input.channelName.trim();
  const employeeNames = uniqueNames(input.employeeNames ?? []);

  if (!channelName) {
    throw new Error("Channel name is required.");
  }
  if (employeeNames.length === 0) {
    throw new Error("Employee name is required.");
  }

  const channel = state.channels.find((item) => sameValue(item.name, channelName));
  if (!channel) {
    throw new Error(`Channel "${channelName}" does not exist.`);
  }
  if (isDirectChannel(channel)) {
    throw new Error("Cannot add agents to a direct channel.");
  }

  const resolvedEmployeeNames = employeeNames.map((employeeName) => {
    const employee = state.activeEmployees.find((item) => sameValue(item.name, employeeName));
    if (!employee) {
      throw new Error(`Active employee "${employeeName}" does not exist.`);
    }
    return employee.name;
  });
  channel.employeeNames = uniqueNames([...channel.employeeNames, ...resolvedEmployeeNames]);

  state.activeEmployees = state.activeEmployees.map((employee) => {
    if (!resolvedEmployeeNames.some((employeeName) => sameValue(employee.name, employeeName))) {
      return employee;
    }
    if (employee.channels.some((name) => sameValue(name, channel.name))) {
      return employee;
    }
    return {
      ...employee,
      channels: [...employee.channels, channel.name],
    };
  });

  return channel;
}

export function addChannelEmployeesSync(input: {
  channelName: string;
  employeeNames: string[];
}, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const channel = addChannelEmployeesToState(state, input);
  updateStoredChannelSync(channel.name, channel, workspaceId);
  return writeWorkspaceStateSync(state, workspaceId);
}

export function updateChannelHumanMemberNamesSync(input: {
  channelName: string;
  humanMemberNames: string[];
}, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const channel = state.channels.find((item) => sameValue(item.name, input.channelName));
  if (!channel) {
    throw new Error(`Channel "${input.channelName}" does not exist.`);
  }

  ensureLegacyHumanMembersForDisplayNames(state, input.humanMemberNames, workspaceId);
  const humanMemberNames = uniqueNames(input.humanMemberNames).filter((memberName) =>
    state.humanMembers.some((member) => sameValue(member.name, memberName)),
  );
  channel.humanMemberNames = humanMemberNames;
  channel.humanMembers = humanMemberNames.length;
  updateStoredChannelSync(channel.name, channel, workspaceId);
  return writeWorkspaceStateSync(state, workspaceId);
}

export function deleteChannelSync(channelName: string, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const channel = state.channels.find((item) => sameValue(item.name, channelName));
  if (!channel) {
    throw new Error(`Channel "${channelName}" does not exist.`);
  }

  deleteStoredChannelSync(channelName, workspaceId);
  deleteStoredTasksForChannelSync(channelName, workspaceId);
  removeChannelArtifactsFromState(state, channelName, workspaceId);
  state.ledger.unshift({
    title: "Channel deleted",
    note: `Channel ${channelName} was deleted along with related messages, tasks, and memberships.`,
  });

  const written = writeWorkspaceStateSync(state, workspaceId);
  pruneOrphanWorkspaceAttachmentsSync(workspaceId ?? DEFAULT_WORKSPACE_ID);
  return written;
}

export function renameChannelSync(channelName: string, nextName: string, workspaceId?: string): AgentSpaceState {
  return withTransaction(getDatabase(), () => renameChannelInTransaction(channelName, nextName, workspaceId));
}

function renameChannelInTransaction(channelName: string, nextName: string, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const trimmedNextName = nextName.trim();
  const channel = state.channels.find((item) => sameValue(item.name, channelName));

  if (!channel) {
    throw new Error(`Channel "${channelName}" does not exist.`);
  }
  if (!trimmedNextName) {
    throw new Error("Next channel name is required.");
  }
  if (sameValue(channel.name, trimmedNextName)) {
    return state;
  }
  if (state.channels.some((item) => !sameValue(item.name, channelName) && sameValue(item.name, trimmedNextName))) {
    throw new Error(`Channel "${trimmedNextName}" already exists.`);
  }

  // Resolve the stored spelling before updating relational references.
  channelName = channel.name;
  renameStoredChannelReferencesSync(channelName, trimmedNextName,
    getChannelHistoryFilePath(channelName, workspaceId), getChannelHistoryFilePath(trimmedNextName, workspaceId), workspaceId);

  state.channels = state.channels.map((item) =>
    sameValue(item.name, channelName)
      ? {
          ...item,
          name: trimmedNextName,
        }
      : item,
  );
  state.messages = state.messages.map((message) =>
    sameValue(message.channel ?? "", channelName)
      ? {
          ...message,
          channel: trimmedNextName,
        }
      : message,
  );
  state.conversationExecutionWorkspaces = (state.conversationExecutionWorkspaces ?? []).map((workspace) =>
    sameValue(workspace.channelName, channelName)
      ? {
          ...workspace,
          channelName: trimmedNextName,
          conversationKey: `${workspace.conversationKind}:${trimmedNextName}:${workspace.agentId}`,
        }
      : workspace,
  );
  state.tasks = state.tasks.map((task) =>
    sameValue(task.channel, channelName)
      ? {
          ...task,
          channel: trimmedNextName,
        }
      : task,
  );
  state.activeEmployees = state.activeEmployees.map((employee) => ({
    ...employee,
    channels: employee.channels.map((name) => (sameValue(name, channelName) ? trimmedNextName : name)),
  }));
  state.channelDocuments = state.channelDocuments.map((document) =>
    sameValue(document.channelName, channelName) ? { ...document, channelName: trimmedNextName } : document);
  state.channelDocumentRuns = state.channelDocumentRuns.map((run) =>
    sameValue(run.channelName, channelName) ? { ...run, channelName: trimmedNextName } : run);
  state.approvals = state.approvals.map((approval) => {
    if (!sameValue(approval.channelName, channelName)) return approval;
    const metadata = { ...approval.metadata };
    if (metadata.channelName === channelName) metadata.channelName = trimmedNextName;
    const governance = metadata.governanceContext as Record<string, unknown> | undefined;
    if (governance?.channelName === channelName) {
      metadata.governanceContext = { ...governance, channelName: trimmedNextName };
    }
    return { ...approval, channelName: trimmedNextName, metadata };
  });
  state.dataTables = state.dataTables.map((table) =>
    sameValue(table.channelName ?? "", channelName) ? { ...table, channelName: trimmedNextName } : table);
  state.scheduledTasks = state.scheduledTasks.map((task) =>
    sameValue(task.channelName ?? "", channelName) ? { ...task, channelName: trimmedNextName } : task);
  const renamedChannel = state.channels.find((item) => sameValue(item.name, trimmedNextName));
  if (renamedChannel) {
    updateStoredChannelSync(channelName, renamedChannel, workspaceId);
  }
  state.ledger.unshift({
    title: "Channel renamed",
    note: `Channel ${channelName} was renamed to ${trimmedNextName}.`,
  });
  const previousHistoryPath = getChannelHistoryFilePath(channelName, workspaceId);
  const nextHistoryPath = getChannelHistoryFilePath(trimmedNextName, workspaceId);
  const previousHistoryExists = existsSync(previousHistoryPath);
  if (previousHistoryPath !== nextHistoryPath && existsSync(nextHistoryPath)) {
    throw new Error("A history file already exists for the new channel name.");
  }
  const written = writeWorkspaceStateSync(state, workspaceId);
  try {
    renameChannelHistoryFile(channelName, trimmedNextName, workspaceId);
    pushWorkspaceMessageIfChannel(written, trimmedNextName, {
      speaker: SYSTEM_NOTICE,
      role: "agent",
      summary: `Channel ${channelName} was renamed to ${trimmedNextName}.`,
      code: "channel.renamed_notice",
      data: { previous_name: channelName, next_name: trimmedNextName },
    }, workspaceId);
    return writeWorkspaceStateSync(written, workspaceId);
  } catch (error) {
    if (previousHistoryPath !== nextHistoryPath && existsSync(nextHistoryPath)) {
      if (previousHistoryExists && !existsSync(previousHistoryPath)) renameSync(nextHistoryPath, previousHistoryPath);
      else if (!previousHistoryExists) rmSync(nextHistoryPath);
    }
    throw error;
  }
}

function upsertStoredChannelRecordSync(channel: ChannelRecord, workspaceId?: string): void {
  const existing = readStoredChannelSync(channel.name, workspaceId);
  if (existing) {
    updateStoredChannelSync(channel.name, channel, workspaceId);
    return;
  }
  createStoredChannelSync(channel, workspaceId);
}

function ensureLegacyHumanMembersForDisplayNames(
  state: AgentSpaceState,
  displayNames: string[],
  workspaceId?: string,
): void {
  const missingNames = uniqueNames(displayNames).filter(
    (displayName) => !state.humanMembers.some((member) => sameValue(member.name, displayName)),
  );
  if (missingNames.length === 0) {
    return;
  }

  const workspaceMembers = listWorkspaceMemberUsersSync(workspaceId ?? DEFAULT_WORKSPACE_ID);
  for (const displayName of missingNames) {
    const workspaceMember = workspaceMembers.find((member) => sameValue(member.displayName, displayName));
    if (!workspaceMember || state.humanMembers.some((member) => sameValue(member.name, workspaceMember.displayName))) {
      continue;
    }
    state.humanMembers.push({
      name: workspaceMember.displayName,
      role: formatLegacyWorkspaceRole(workspaceMember.role),
    });
  }
}

function formatLegacyWorkspaceRole(role: string): string {
  if (role === "owner") {
    return "Owner";
  }
  if (role === "admin") {
    return "Admin";
  }
  return "Member";
}
