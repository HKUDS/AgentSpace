import {
  listAgentForkInvitationsSync,
  listAgentAccessRequestsSync,
  listAgentGoogleWorkspaceDelegationsSync,
  listChannelAccessRequestsSync,
  listChannelInvitationsSync,
  listDaemonApiTokensSync,
  listDaemonSnapshotsSync,
  listDocumentAgentAccessSync,
  listDocumentPermissionRequestsSync,
  listEmployeeRuntimeBindingsSync,
  listGoogleOAuthCredentialsSync,
  listRuntimeGrantsSync,
  listWorkspaceInvitationsSync,
  listWorkspaceChannelParticipantsSync,
  listWorkspaceMemberUsersSync,
  listWorkspaceRuntimeDisplayNamesSync,
  listStoredWorkspaceSkillsSync,
  readGoogleOAuthCredentialSync,
  readWorkspaceSync,
  type WorkspaceRole,
} from "@agent-space/db";
import type {
  ActiveEmployee,
  ChannelDocument,
  ChannelRecord,
  ExternalSheetOperationRun,
  MessageAttachment,
  WorkspaceMessage,
  WorkspaceSkill,
} from "@agent-space/domain/workspace";
import { resolveChannelHumanMemberNames } from "../channels/channels.ts";
import { listEmployeeSkillIdsMapSync, buildLegacyAgentIdForEmployeeName } from "../employees/employees.ts";
import {
  listKnowledgeAssignmentPoliciesSync,
  listKnowledgeAssignmentsSync,
} from "../knowledge/assignments.ts";
import { ensureWorkspaceStateSync } from "../shared/state-io.ts";
import { sameValue } from "../shared/helpers.ts";

export type PermissionSubjectType =
  | "human"
  | "agent"
  | "daemon_token"
  | "oauth_credential"
  | "system";

export type PermissionResourceType =
  | "workspace"
  | "workspace_invitation"
  | "channel"
  | "channel_invitation"
  | "channel_access_request"
  | "agent"
  | "agent_fork_invitation"
  | "agent_access_request"
  | "runtime"
  | "daemon"
  | "file"
  | "document"
  | "external_document"
  | "skill"
  | "knowledge_page"
  | "oauth_credential";

export type PermissionSource =
  | "workspace_role"
  | "direct_grant"
  | "channel_participant"
  | "document_collaborator"
  | "document_agent_access"
  | "document_permission_request"
  | "runtime_grant"
  | "agent_owner"
  | "agent_fork"
  | "agent_access_request"
  | "agent_channel_member_access"
  | "knowledge_assignment"
  | "skill_assignment"
  | "oauth_delegation"
  | "external_drive_permission"
  | "derived";

export type PermissionNodeStatus = "active" | "pending" | "revoked" | "error" | "inherited";
export type PermissionBindingStatus = "active" | "pending" | "revoked" | "inherited" | "external";
export type PermissionDiagnosticSeverity = "info" | "warning" | "critical";
export type PermissionMetadataValue = string | number | boolean | null | string[];

export interface PermissionBinding {
  subjectType: PermissionSubjectType;
  subjectId: string;
  subjectLabel: string;
  permission: string;
  source: PermissionSource;
  status: PermissionBindingStatus;
  editable: boolean;
  revokeAction?: string;
  updateAction?: string;
  inheritedFromNodeId?: string;
  lastChangedAt?: string;
  metadata?: Record<string, PermissionMetadataValue | undefined>;
}

export interface PermissionDiagnostic {
  id: string;
  severity: PermissionDiagnosticSeverity;
  title: string;
  description: string;
  source: PermissionSource | "system";
  resourceNodeId?: string;
  subjectType?: PermissionSubjectType;
  subjectId?: string;
  lastChangedAt?: string;
}

export interface PermissionTreeNode {
  id: string;
  parentId?: string;
  resourceType: PermissionResourceType;
  label: string;
  status?: PermissionNodeStatus;
  source?: PermissionSource;
  bindings: PermissionBinding[];
  children?: PermissionTreeNode[];
  diagnostics?: PermissionDiagnostic[];
  metadata?: Record<string, PermissionMetadataValue | undefined>;
}

export interface PermissionActorSummary {
  subjectType: PermissionSubjectType;
  subjectId: string;
  subjectLabel: string;
  status: "active" | "pending" | "revoked" | "external";
  permissions: Array<{
    nodeId: string;
    resourceType: PermissionResourceType;
    resourceLabel: string;
    permission: string;
    source: PermissionSource;
    status: PermissionBindingStatus;
    editable: boolean;
    inheritedFromNodeId?: string;
    lastChangedAt?: string;
  }>;
  diagnostics: PermissionDiagnostic[];
}

export interface PermissionCatalogMember {
  userId: string;
  displayName: string;
  primaryEmail?: string;
  role: WorkspaceRole;
}

export interface PermissionCatalogAgent {
  employeeName: string;
  label: string;
}

export interface PermissionCatalogSkill {
  id: string;
  name: string;
}

export interface PermissionCatalogKnowledgePage {
  id: string;
  title: string;
  assignmentMode: "all_agents" | "selected_agents";
}

export interface PermissionCenterData {
  tree: PermissionTreeNode[];
  actors: PermissionActorSummary[];
  diagnostics: PermissionDiagnostic[];
  catalog: {
    members: PermissionCatalogMember[];
    agents: PermissionCatalogAgent[];
    skills: PermissionCatalogSkill[];
    knowledgePages: PermissionCatalogKnowledgePage[];
  };
}

export interface PermissionCenterActorInput {
  userId: string;
  displayName: string;
  role: WorkspaceRole;
}

interface PermissionBuildContext {
  workspaceId: string;
  actor: PermissionCenterActorInput;
  isManager: boolean;
  workspaceNodeId: string;
  state: ReturnType<typeof ensureWorkspaceStateSync>;
  visibleChannels: ChannelRecord[];
  visibleEmployees: ActiveEmployee[];
  visibleRuntimeIds: Set<string>;
  channelParticipantsByName: Map<string, ReturnType<typeof listWorkspaceChannelParticipantsSync>>;
  channelAccessRequestsByName: Map<string, ReturnType<typeof listChannelAccessRequestsSync>>;
  channelInvitationsByName: Map<string, ReturnType<typeof listChannelInvitationsSync>>;
  documentAgentAccessByDocumentId: Map<string, ReturnType<typeof listDocumentAgentAccessSync>>;
  documentAgentAccessBySubjectId: Map<string, ReturnType<typeof listDocumentAgentAccessSync>>;
  documentPermissionRequests: ReturnType<typeof listDocumentPermissionRequestsSync>;
  documentPermissionRequestsByDocumentId: Map<string, ReturnType<typeof listDocumentPermissionRequestsSync>>;
  documentPermissionRequestsByAgentName: Map<string, ReturnType<typeof listDocumentPermissionRequestsSync>>;
  agentForkInvitationsBySourceName: Map<string, ReturnType<typeof listAgentForkInvitationsSync>>;
  agentAccessRequestsBySourceName: Map<string, ReturnType<typeof listAgentAccessRequestsSync>>;
  agentAccessRequests: ReturnType<typeof listAgentAccessRequestsSync>;
  memberByUserId: Map<string, PermissionCatalogMember>;
  memberByDisplayName: Map<string, PermissionCatalogMember>;
  runtimeLabelById: Map<string, string>;
  skillById: Map<string, WorkspaceSkill>;
}

export function getWorkspacePermissionCenterSync(input: {
  workspaceId: string;
  actor: PermissionCenterActorInput;
}): PermissionCenterData {
  const context = buildPermissionContext(input);
  const diagnostics = buildPermissionDiagnostics(input, context);
  const tree = buildWorkspacePermissionTree(input, context, diagnostics);
  const actors = getWorkspaceActorPermissionSummarySync({
    ...input,
    tree,
    diagnostics,
  });

  return {
    tree,
    actors,
    diagnostics,
    catalog: {
      members: context.isManager
        ? Array.from(context.memberByUserId.values())
        : Array.from(context.memberByUserId.values()).filter((member) => member.userId === input.actor.userId),
      agents: context.visibleEmployees.map((employee) => ({
        employeeName: employee.name,
        label: employee.remarkName ?? employee.name,
      })),
      skills: Array.from(context.skillById.values()).map((skill) => ({
        id: skill.id,
        name: skill.name,
      })),
      knowledgePages: listKnowledgeAssignmentPoliciesSync(input.workspaceId).map((policy) => {
        const page = context.state.knowledgePages.find((item) => item.id === policy.knowledgePageId);
        return {
          id: policy.knowledgePageId,
          title: page?.title ?? policy.knowledgePageId,
          assignmentMode: policy.assignmentMode,
        };
      }),
    },
  };
}

export function getWorkspacePermissionTreeSync(input: {
  workspaceId: string;
  actor: PermissionCenterActorInput;
}): PermissionTreeNode[] {
  const context = buildPermissionContext(input);
  const diagnostics = buildPermissionDiagnostics(input, context);
  return buildWorkspacePermissionTree(input, context, diagnostics);
}

function buildWorkspacePermissionTree(
  input: {
    workspaceId: string;
    actor: PermissionCenterActorInput;
  },
  context: PermissionBuildContext,
  diagnostics: PermissionDiagnostic[],
): PermissionTreeNode[] {
  const workspace = readWorkspaceSync(input.workspaceId);
  const root: PermissionTreeNode = {
    id: context.workspaceNodeId,
    resourceType: "workspace",
    label: workspace?.name ?? input.workspaceId,
    status: "active",
    source: "workspace_role",
    bindings: buildWorkspaceBindings(context),
    metadata: {
      workspaceId: input.workspaceId,
      joinCodeVisible: context.actor.role === "owner",
      joinCodeUpdatedAt: workspace?.joinCodeUpdatedAt ?? null,
    },
    children: [],
  };

  const diagnosticsByNode = groupDiagnosticsByNode(diagnostics);
  const sections = [
    buildWorkspaceInvitationNodes(context),
    buildChannelNodes(context),
    buildAgentNodes(context),
    buildAgentAccessRequestNodes(context),
    buildRuntimeAndDaemonNodes(context),
    buildDocumentAndFileNodes(context),
    buildDocumentPermissionRequestNodes(context),
    buildExternalAuthorizationNodes(context),
  ];

  for (const nodes of sections) {
    root.children?.push(...nodes);
  }
  attachDiagnostics(root, diagnosticsByNode);
  return [root];
}

export function getWorkspaceActorPermissionSummarySync(input: {
  workspaceId: string;
  actor: PermissionCenterActorInput;
  tree?: PermissionTreeNode[];
  diagnostics?: PermissionDiagnostic[];
}): PermissionActorSummary[] {
  const tree = input.tree ?? getWorkspacePermissionTreeSync(input);
  const diagnostics = input.diagnostics ?? getPermissionDiagnosticsSync(input);
  const actors = new Map<string, PermissionActorSummary>();

  function visit(node: PermissionTreeNode): void {
    for (const binding of node.bindings) {
      const key = actorKey(binding.subjectType, binding.subjectId);
      const summary = actors.get(key) ?? {
        subjectType: binding.subjectType,
        subjectId: binding.subjectId,
        subjectLabel: binding.subjectLabel,
        status: binding.status === "revoked" ? "revoked" : binding.status === "pending" ? "pending" : binding.status === "external" ? "external" : "active",
        permissions: [],
        diagnostics: [],
      } satisfies PermissionActorSummary;
      summary.permissions.push({
        nodeId: node.id,
        resourceType: node.resourceType,
        resourceLabel: node.label,
        permission: binding.permission,
        source: binding.source,
        status: binding.status,
        editable: binding.editable,
        inheritedFromNodeId: binding.inheritedFromNodeId,
        lastChangedAt: binding.lastChangedAt,
      });
      actors.set(key, summary);
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  }

  for (const node of tree) {
    visit(node);
  }

  for (const diagnostic of diagnostics) {
    if (!diagnostic.subjectType || !diagnostic.subjectId) {
      continue;
    }
    const key = actorKey(diagnostic.subjectType, diagnostic.subjectId);
    const summary = actors.get(key);
    if (summary) {
      summary.diagnostics.push(diagnostic);
    }
  }

  return Array.from(actors.values())
    .map((summary) => ({
      ...summary,
      permissions: dedupeActorPermissions(summary.permissions)
        .sort((left, right) => left.resourceLabel.localeCompare(right.resourceLabel, "zh-CN", { sensitivity: "base" })),
    }))
    .sort((left, right) => {
      const typeRank = subjectTypeRank(left.subjectType) - subjectTypeRank(right.subjectType);
      return typeRank || left.subjectLabel.localeCompare(right.subjectLabel, "zh-CN", { sensitivity: "base" });
    });
}

export function getPermissionDiagnosticsSync(input: {
  workspaceId: string;
  actor: PermissionCenterActorInput;
}): PermissionDiagnostic[] {
  return buildPermissionDiagnostics(input, buildPermissionContext(input));
}

function buildPermissionDiagnostics(
  input: {
    workspaceId: string;
    actor: PermissionCenterActorInput;
  },
  context: PermissionBuildContext,
): PermissionDiagnostic[] {
  const state = context.state;
  const diagnostics: PermissionDiagnostic[] = [];
  const membersByDisplayName = context.memberByDisplayName;
  const runtimeGrantKeys = new Set(
    listRuntimeGrantsSync(input.workspaceId)
      .filter((grant) => grant.status === "active")
      .map((grant) => `${grant.runtimeId}:${grant.userId}`),
  );
  const bindingsByEmployee = new Map(
    listEmployeeRuntimeBindingsSync(input.workspaceId).map((binding) => [binding.employeeName, binding]),
  );
  const credentialsById = new Map(
    listGoogleOAuthCredentialsSync(input.workspaceId).map((credential) => [credential.id, credential]),
  );

  for (const access of state.channelDocumentAccesses) {
    if (access.actorType !== "human") {
      continue;
    }
    const member = membersByDisplayName.get(normalizeKey(access.actorId));
    if (!member) {
      diagnostics.push({
        id: `diagnostic:document-collaborator-missing-member:${access.id}`,
        severity: "warning",
        title: "Document collaborator is not an active workspace member",
        description: `${access.actorId} still has ${access.role} access on a channel document, but no active workspace membership was found.`,
        source: "document_collaborator",
        resourceNodeId: `document:${access.documentId}`,
        subjectType: "human",
        subjectId: `human:${access.actorId}`,
        lastChangedAt: access.updatedAt,
      });
    }
  }

  for (const employee of state.activeEmployees) {
    const binding = bindingsByEmployee.get(employee.name);
    if (!binding || !employee.ownerUserId) {
      continue;
    }
    const owner = context.memberByUserId.get(employee.ownerUserId);
    const ownerIsManager = owner?.role === "owner" || owner?.role === "admin";
    if (!ownerIsManager && !runtimeGrantKeys.has(`${binding.runtimeId}:${employee.ownerUserId}`)) {
      diagnostics.push({
        id: `diagnostic:agent-owner-runtime-grant:${employee.name}:${binding.runtimeId}`,
        severity: "warning",
        title: "Agent owner lacks a direct runtime grant",
        description: `${employee.remarkName ?? employee.name} is bound to ${context.runtimeLabelById.get(binding.runtimeId) ?? binding.runtimeName}, but its owner does not have a direct use grant for that runtime.`,
        source: "runtime_grant",
        resourceNodeId: `agent:${employee.name}`,
        subjectType: "agent",
        subjectId: employee.name,
        lastChangedAt: binding.updatedAt,
      });
    }
  }

  for (const delegation of listAgentGoogleWorkspaceDelegationsSync(input.workspaceId)) {
    if (delegation.status !== "active") {
      continue;
    }
    const credential = credentialsById.get(delegation.googleOAuthCredentialId);
    if (!credential || credential.status !== "active") {
      diagnostics.push({
        id: `diagnostic:agent-google-delegation-credential:${delegation.id}`,
        severity: "critical",
        title: "Agent Google delegation points to an unavailable credential",
        description: `${delegation.employeeName} has an active Google Workspace delegation, but the referenced OAuth credential is missing or revoked.`,
        source: "oauth_delegation",
        resourceNodeId: `agent:${delegation.employeeName}`,
        subjectType: "agent",
        subjectId: delegation.employeeName,
        lastChangedAt: delegation.updatedAt,
      });
    }
  }

  for (const document of state.channelDocuments) {
    if (document.externalSyncStatus === "permission_error") {
      diagnostics.push({
        id: `diagnostic:external-document-permission-error:${document.id}`,
        severity: "critical",
        title: "External document permission sync failed",
        description: `${document.title} is marked as permission_error. Re-sync Google Drive permissions after checking the delegated credential.`,
        source: "external_drive_permission",
        resourceNodeId: externalDocumentNodeId(document),
        lastChangedAt: document.externalUpdatedAt ?? document.updatedAt,
      });
    }
    if (document.externalSyncStatus === "missing") {
      const latestRun = findLatestExternalRun(state.externalSheetOperationRuns, document.id);
      diagnostics.push({
        id: `diagnostic:external-document-oauth-visibility:${document.id}`,
        severity: "critical",
        title: "External document is not visible to OAuth",
        description: latestRun?.errorMessage
          ?? `${document.title} is marked as missing. The current OAuth client or scope may not be able to see this file even if the Google account can open it in a browser.`,
        source: "external_drive_permission",
        resourceNodeId: externalDocumentNodeId(document),
        lastChangedAt: latestRun?.finishedAt ?? latestRun?.startedAt ?? document.externalUpdatedAt ?? document.updatedAt,
      });
    }
  }

  const now = Date.now();
  for (const token of listDaemonApiTokensSync(input.workspaceId)) {
    if (token.status !== "active") {
      continue;
    }
    const lastTouched = new Date(token.lastUsedAt ?? token.createdAt).getTime();
    if (Number.isNaN(lastTouched) || now - lastTouched <= 90 * 24 * 60 * 60 * 1000) {
      continue;
    }
    diagnostics.push({
      id: `diagnostic:stale-daemon-token:${token.id}`,
      severity: "warning",
      title: "Daemon token has not been used recently",
      description: `${token.label} is active but has no use in the last 90 days.`,
      source: "direct_grant",
      resourceNodeId: `daemon-token:${token.id}`,
      subjectType: "daemon_token",
      subjectId: token.id,
      lastChangedAt: token.lastUsedAt ?? token.createdAt,
    });
  }

  for (const channel of state.channels) {
    const participants = getChannelParticipants(context, channel.name);
    if (participants.length === 0) {
      continue;
    }
    const activeDisplayNames = participants
      .filter((participant) => participant.status === "active")
      .map((participant) => context.memberByUserId.get(participant.userId)?.displayName)
      .filter((displayName): displayName is string => Boolean(displayName));
    const legacyNames = resolveChannelHumanMemberNames(state, channel);
    const mismatch = legacyNames.some(
      (legacyName) => !activeDisplayNames.some((displayName) => sameValue(displayName, legacyName)),
    );
    if (mismatch) {
      diagnostics.push({
        id: `diagnostic:channel-legacy-participant-mismatch:${channel.name}`,
        severity: "warning",
        title: "Channel legacy member snapshot differs from participant rows",
        description: `${channel.name} still has legacy human member names that do not match active channel participants.`,
        source: "channel_participant",
        resourceNodeId: `channel:${channel.name}`,
      });
    }
  }

  if (state.channelDocumentAccesses.length > 0) {
    diagnostics.push({
      id: "diagnostic:document-access-state-json",
      severity: "info",
      title: "Document collaborators still live in workspace state",
      description: "Channel document collaborators are read from state_json in this version, so heavy concurrent edits should keep using the document service layer.",
      source: "system",
      resourceNodeId: context.workspaceNodeId,
    });
  }

  return context.isManager
    ? diagnostics
    : diagnostics.filter((diagnostic) => isDiagnosticVisibleToActor(diagnostic, context));
}

function buildPermissionContext(input: {
  workspaceId: string;
  actor: PermissionCenterActorInput;
}): PermissionBuildContext {
  const state = ensureWorkspaceStateSync(input.workspaceId);
  const members = listWorkspaceMemberUsersSync(input.workspaceId).map((member) => ({
    userId: member.userId,
    displayName: member.displayName,
    primaryEmail: member.primaryEmail,
    role: member.role,
  }));
  const memberByUserId = new Map(members.map((member) => [member.userId, member]));
  const memberByDisplayName = new Map(members.map((member) => [normalizeKey(member.displayName), member]));
  const isManager = input.actor.role === "owner" || input.actor.role === "admin";
  const channelParticipantsByName = groupByNormalizedKey(
    listWorkspaceChannelParticipantsSync(input.workspaceId, {
      statuses: ["active", "removed"],
    }),
    (participant) => participant.channelName,
  );
  const visibleChannels = state.channels.filter((channel) =>
    isManager || canReadChannelForPermissionActor(channel, input.actor, state, channelParticipantsByName),
  );
  const visibleChannelNames = new Set(visibleChannels.map((channel) => normalizeKey(channel.name)));
  const visibleEmployees = state.activeEmployees.filter((employee) => {
    if (isManager || employee.ownerUserId === input.actor.userId) {
      return true;
    }
    if ((employee.channelMemberAccess ?? "enabled") !== "enabled") {
      return false;
    }
    return employee.channels.some((channelName) => visibleChannelNames.has(normalizeKey(channelName)));
  });
  const visibleEmployeeNames = new Set(visibleEmployees.map((employee) => employee.name));
  const runtimeBindings = listEmployeeRuntimeBindingsSync(input.workspaceId);
  const runtimeGrants = listRuntimeGrantsSync(input.workspaceId);
  const visibleRuntimeIds = new Set<string>();
  for (const grant of runtimeGrants) {
    if (isManager || grant.userId === input.actor.userId) {
      visibleRuntimeIds.add(grant.runtimeId);
    }
  }
  for (const binding of runtimeBindings) {
    if (visibleEmployeeNames.has(binding.employeeName)) {
      visibleRuntimeIds.add(binding.runtimeId);
    }
  }
  const runtimeDisplayNameById = new Map(
    listWorkspaceRuntimeDisplayNamesSync(input.workspaceId).map((record) => [record.runtimeId, record.displayName]),
  );
  const runtimeLabelById = new Map<string, string>();
  for (const snapshot of listDaemonSnapshotsSync(input.workspaceId)) {
    for (const runtime of snapshot.runtimes) {
      runtimeLabelById.set(runtime.id, runtimeDisplayNameById.get(runtime.id) || runtime.name || runtime.id);
    }
  }
  for (const binding of runtimeBindings) {
    if (!runtimeLabelById.has(binding.runtimeId)) {
      runtimeLabelById.set(binding.runtimeId, binding.runtimeName || binding.runtimeId);
    }
  }
  const channelAccessRequestsByName = groupByNormalizedKey(
    listChannelAccessRequestsSync(input.workspaceId, {
      statuses: ["pending", "approved", "rejected", "cancelled"],
    }),
    (request) => request.channelName,
  );
  const channelInvitationsByName = groupByNormalizedKey(
    listChannelInvitationsSync(input.workspaceId, {
      statuses: ["pending", "accepted", "rejected", "revoked", "expired"],
    }),
    (invitation) => invitation.channelName,
  );
  const documentAgentAccesses = listDocumentAgentAccessSync({
    workspaceId: input.workspaceId,
  });
  const documentPermissionRequests = listDocumentPermissionRequestsSync({
    workspaceId: input.workspaceId,
  });
  const agentForkInvitationsBySourceName = groupByNormalizedKey(
    listAgentForkInvitationsSync(input.workspaceId, {
      statuses: ["pending"],
    }),
    (invitation) => invitation.sourceAgentName,
  );
  const agentAccessRequests = listAgentAccessRequestsSync(input.workspaceId, {
    statuses: ["pending", "approved", "rejected", "cancelled"],
  });

  return {
    workspaceId: input.workspaceId,
    actor: input.actor,
    isManager,
    workspaceNodeId: `workspace:${input.workspaceId}`,
    state,
    visibleChannels,
    visibleEmployees,
    visibleRuntimeIds,
    channelParticipantsByName,
    channelAccessRequestsByName,
    channelInvitationsByName,
    documentAgentAccessByDocumentId: groupByKey(documentAgentAccesses, (access) => access.documentId),
    documentAgentAccessBySubjectId: groupByNormalizedKey(documentAgentAccesses, (access) => access.subjectId),
    documentPermissionRequests,
    documentPermissionRequestsByDocumentId: groupByKey(
      documentPermissionRequests.filter((request) => Boolean(request.documentId)),
      (request) => request.documentId ?? "",
    ),
    documentPermissionRequestsByAgentName: groupByNormalizedKey(
      documentPermissionRequests,
      (request) => request.requestedByAgentName,
    ),
    agentForkInvitationsBySourceName,
    agentAccessRequestsBySourceName: groupByNormalizedKey(agentAccessRequests, (request) => request.sourceAgentName),
    agentAccessRequests,
    memberByUserId,
    memberByDisplayName,
    runtimeLabelById,
    skillById: new Map(listStoredWorkspaceSkillsSync(input.workspaceId).map((skill) => [skill.id, skill])),
  };
}

function buildWorkspaceBindings(context: PermissionBuildContext): PermissionBinding[] {
  const members = Array.from(context.memberByUserId.values());
  const visibleMembers = context.isManager
    ? members
    : members.filter((member) => member.userId === context.actor.userId);

  return visibleMembers.map((member) => ({
    subjectType: "human",
    subjectId: member.userId,
    subjectLabel: memberLabel(member),
    permission: member.role,
    source: "workspace_role",
    status: "active",
    editable: context.isManager && member.userId !== context.actor.userId,
    updateAction: context.isManager ? "workspace_member_role" : undefined,
    revokeAction: context.isManager && member.userId !== context.actor.userId ? "workspace_member_remove" : undefined,
    metadata: {
      userId: member.userId,
      role: member.role,
      primaryEmail: member.primaryEmail,
    },
  }));
}

function buildWorkspaceInvitationNodes(context: PermissionBuildContext): PermissionTreeNode[] {
  if (!context.isManager) {
    return [];
  }
  return listWorkspaceInvitationsSync(context.workspaceId, {
    statuses: ["active", "accepted", "revoked", "expired"],
  }).map((invitation) => ({
    id: `workspace-invitation:${invitation.id}`,
    parentId: context.workspaceNodeId,
    resourceType: "workspace_invitation",
    label: invitation.email,
    status: invitation.status === "active" ? "pending" : invitation.status === "revoked" ? "revoked" : "active",
    source: "direct_grant",
    metadata: {
      invitationId: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt ?? null,
    },
    bindings: [
      {
        subjectType: "human",
        subjectId: `email:${invitation.email}`,
        subjectLabel: invitation.email,
        permission: invitation.role,
        source: "direct_grant",
        status: invitation.status === "active" ? "pending" : invitation.status === "revoked" ? "revoked" : "active",
        editable: invitation.status === "active",
        revokeAction: invitation.status === "active" ? "workspace_invitation_revoke" : undefined,
        updateAction: invitation.status !== "accepted" ? "workspace_invitation_reissue" : undefined,
        lastChangedAt: invitation.acceptedAt ?? invitation.createdAt,
        metadata: {
          invitationId: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
        },
      },
    ],
  }));
}

function buildChannelNodes(context: PermissionBuildContext): PermissionTreeNode[] {
  const state = context.state;
  return context.visibleChannels.map((channel) => {
    const isDirectChannel = channel.kind === "direct";
    const managerPermission = isDirectChannel
      ? "manage membership; content private to direct participants"
      : "read/manage";
    const managerBindings = context.isManager
      ? buildWorkspaceManagerInheritedBindings(context, managerPermission)
      : [];
    const directReadBinding = context.isManager && isDirectChannel && canReadDirectChannelForPermissionActor(context, channel)
      ? [{
          subjectType: "human" as const,
          subjectId: context.actor.userId,
          subjectLabel: memberLabel(context.actor),
          permission: "direct content reader",
          source: "channel_participant" as const,
          status: "active" as const,
          editable: false,
          metadata: {
            channelName: channel.name,
            privacy: "direct_participant",
          },
        }]
      : [];
    const participants = getChannelParticipants(context, channel.name)
      .filter((participant) => context.isManager || participant.status === "active");
    const participantBindings = participants
      .flatMap((participant): PermissionBinding[] => {
        const member = context.memberByUserId.get(participant.userId);
        if (!member) {
          return [];
        }
        if (!context.isManager && member.userId !== context.actor.userId) {
          return [];
        }
        return [{
          subjectType: "human",
          subjectId: member.userId,
          subjectLabel: memberLabel(member),
          permission: "channel member",
          source: "channel_participant",
          status: participant.status === "active" ? "active" : "revoked",
          editable: context.isManager && participant.status === "active",
          revokeAction: context.isManager && participant.status === "active" ? "channel_participant_remove" : undefined,
          lastChangedAt: participant.updatedAt,
          metadata: {
            channelName: channel.name,
            userId: member.userId,
            participantId: participant.id,
            status: participant.status,
          },
        }];
      });
    const hasStructuredParticipants = getChannelParticipants(context, channel.name).length > 0;
    const legacyBindings: PermissionBinding[] = hasStructuredParticipants
      ? []
      : resolveChannelHumanMemberNames(state, channel)
          .map((displayName) => context.memberByDisplayName.get(normalizeKey(displayName)) ?? {
            userId: `human:${displayName}`,
            displayName,
            role: "member" as WorkspaceRole,
          })
          .filter((member) => context.isManager || member.userId === context.actor.userId)
          .map((member) => ({
            subjectType: "human" as const,
            subjectId: member.userId,
            subjectLabel: memberLabel(member),
            permission: "legacy channel member",
            source: "derived" as const,
            status: "active" as const,
            editable: false,
            metadata: {
              channelName: channel.name,
            },
          }));
    const children = [
      ...buildChannelAccessRequestNodes(context, channel),
      ...buildChannelInvitationNodes(context, channel),
    ];

    return {
      id: `channel:${channel.name}`,
      parentId: context.workspaceNodeId,
      resourceType: "channel",
      label: channel.name,
      status: "active",
      source: "channel_participant",
      metadata: {
        channelName: channel.name,
        kind: channel.kind ?? "group",
        humanMembers: channel.humanMembers,
        agentCount: channel.employeeNames.length,
      },
      bindings: [
        ...managerBindings,
        ...directReadBinding,
        ...participantBindings,
        ...legacyBindings,
        ...buildChannelAgentBindings(context, channel),
      ],
      children,
    } satisfies PermissionTreeNode;
  });
}

function buildChannelAccessRequestNodes(
  context: PermissionBuildContext,
  channel: ChannelRecord,
): PermissionTreeNode[] {
  const requests = getChannelAccessRequests(context, channel.name)
    .filter((request) => context.isManager || request.userId === context.actor.userId);

  return requests.map((request) => {
    const member = context.memberByUserId.get(request.userId);
    return {
      id: `channel-access-request:${request.id}`,
      parentId: `channel:${channel.name}`,
      resourceType: "channel_access_request",
      label: `${member?.displayName ?? request.userId} -> ${channel.name}`,
      status: request.status === "pending" ? "pending" : request.status === "approved" ? "active" : "revoked",
      source: "direct_grant",
      metadata: {
        requestId: request.id,
        channelName: channel.name,
        userId: request.userId,
        status: request.status,
        requestedAt: request.requestedAt,
      },
      bindings: [
        {
          subjectType: "human",
          subjectId: request.userId,
          subjectLabel: member ? memberLabel(member) : request.userId,
          permission: "requested channel access",
          source: "direct_grant",
          status: request.status === "pending" ? "pending" : request.status === "approved" ? "active" : "revoked",
          editable: context.isManager && request.status === "pending",
          updateAction: context.isManager && request.status === "pending" ? "channel_access_request_approve" : undefined,
          revokeAction: context.isManager && request.status === "pending" ? "channel_access_request_reject" : undefined,
          lastChangedAt: request.resolvedAt ?? request.requestedAt,
          metadata: {
            requestId: request.id,
            channelName: channel.name,
            userId: request.userId,
            status: request.status,
          },
        },
      ],
    } satisfies PermissionTreeNode;
  });
}

function buildChannelInvitationNodes(
  context: PermissionBuildContext,
  channel: ChannelRecord,
): PermissionTreeNode[] {
  const currentEmail = context.memberByUserId.get(context.actor.userId)?.primaryEmail?.toLocaleLowerCase("en-US");
  const invitations = getChannelInvitations(context, channel.name)
    .filter((invitation) =>
      context.isManager ||
      invitation.inviteeUserId === context.actor.userId ||
      (currentEmail && invitation.inviteeEmail?.toLocaleLowerCase("en-US") === currentEmail),
    );

  return invitations.map((invitation) => {
    const member = invitation.inviteeUserId ? context.memberByUserId.get(invitation.inviteeUserId) : undefined;
    const subjectId = invitation.inviteeUserId ?? `email:${invitation.inviteeEmail ?? invitation.id}`;
    const subjectLabel = member ? memberLabel(member) : invitation.inviteeEmail ?? subjectId;
    return {
      id: `channel-invitation:${invitation.id}`,
      parentId: `channel:${channel.name}`,
      resourceType: "channel_invitation",
      label: `${subjectLabel} -> ${channel.name}`,
      status: invitation.status === "pending" ? "pending" : invitation.status === "revoked" ? "revoked" : "active",
      source: "direct_grant",
      metadata: {
        invitationId: invitation.id,
        channelName: channel.name,
        inviteeUserId: invitation.inviteeUserId ?? null,
        inviteeEmail: invitation.inviteeEmail ?? null,
        status: invitation.status,
        expiresAt: invitation.expiresAt ?? null,
      },
      bindings: [
        {
          subjectType: "human",
          subjectId,
          subjectLabel,
          permission: "invited channel member",
          source: "direct_grant",
          status: invitation.status === "pending" ? "pending" : invitation.status === "revoked" ? "revoked" : "active",
          editable: context.isManager && invitation.status === "pending",
          revokeAction: context.isManager && invitation.status === "pending" ? "channel_invitation_revoke" : undefined,
          lastChangedAt: invitation.respondedAt ?? invitation.createdAt,
          metadata: {
            invitationId: invitation.id,
            channelName: channel.name,
            inviteeUserId: invitation.inviteeUserId ?? null,
            inviteeEmail: invitation.inviteeEmail ?? null,
            status: invitation.status,
          },
        },
      ],
    } satisfies PermissionTreeNode;
  });
}

function buildChannelAgentBindings(
  context: PermissionBuildContext,
  channel: ChannelRecord,
): PermissionBinding[] {
  return channel.employeeNames
    .filter((employeeName) => context.visibleEmployees.some((employee) => sameValue(employee.name, employeeName)))
    .map((employeeName) => {
      const employee = context.visibleEmployees.find((item) => sameValue(item.name, employeeName));
      return {
        subjectType: "agent",
        subjectId: employeeName,
        subjectLabel: employee?.remarkName ?? employeeName,
        permission: "channel agent",
        source: "direct_grant",
        status: "active",
        editable: context.isManager,
        metadata: {
          channelName: channel.name,
          employeeName,
        },
      } satisfies PermissionBinding;
    });
}

function buildAgentNodes(context: PermissionBuildContext): PermissionTreeNode[] {
  const skillIdsByEmployee = listEmployeeSkillIdsMapSync(context.workspaceId);
  const knowledgePolicies = listKnowledgeAssignmentPoliciesSync(context.workspaceId);
  const selectedKnowledgeAssignments = listKnowledgeAssignmentsSync(context.workspaceId);
  const runtimeBindings = new Map(
    listEmployeeRuntimeBindingsSync(context.workspaceId).map((binding) => [binding.employeeName, binding]),
  );
  const delegations = listAgentGoogleWorkspaceDelegationsSync(context.workspaceId);

  return context.visibleEmployees.map((employee) => {
    const owner = employee.ownerUserId ? context.memberByUserId.get(employee.ownerUserId) : undefined;
    const skillIds = skillIdsByEmployee.get(employee.name) ?? employee.skillIds;
    const runtimeBinding = runtimeBindings.get(employee.name);
    const activeDelegation = delegations.find((delegation) => delegation.employeeName === employee.name && delegation.status === "active");
    const forkedFrom = parseAgentForkOrigin(employee.origin);
    const selectedKnowledgePageIds = selectedKnowledgeAssignments
      .filter((assignment) => assignment.employeeName === employee.name)
      .map((assignment) => assignment.knowledgePageId);
    const allAgentKnowledgePageIds = knowledgePolicies
      .filter((policy) => policy.assignmentMode === "all_agents")
      .map((policy) => policy.knowledgePageId);
    const bindings: PermissionBinding[] = [];

    if (owner) {
      bindings.push({
        subjectType: "human",
        subjectId: owner.userId,
        subjectLabel: memberLabel(owner),
        permission: "agent owner",
        source: "agent_owner",
        status: "active",
        editable: false,
        metadata: {
          employeeName: employee.name,
          userId: owner.userId,
        },
      });
    } else if (context.isManager) {
      bindings.push(...buildWorkspaceManagerInheritedBindings(context, "manage/use"));
    }

    bindings.push({
      subjectType: "agent",
      subjectId: employee.name,
      subjectLabel: employee.remarkName ?? employee.name,
      permission: (employee.channelMemberAccess ?? "enabled") === "enabled" ? "channel members may use" : "owner/managers only",
      source: "agent_channel_member_access",
      status: "active",
      editable: context.isManager || employee.ownerUserId === context.actor.userId,
      updateAction: "agent_channel_member_access",
      metadata: {
        employeeName: employee.name,
        channelMemberAccess: employee.channelMemberAccess ?? "enabled",
      },
    });

    if (runtimeBinding) {
      bindings.push({
        subjectType: "agent",
        subjectId: employee.name,
        subjectLabel: employee.remarkName ?? employee.name,
        permission: `bound runtime: ${context.runtimeLabelById.get(runtimeBinding.runtimeId) ?? runtimeBinding.runtimeName}`,
        source: "direct_grant",
        status: "active",
        editable: context.isManager || employee.ownerUserId === context.actor.userId,
        updateAction: "agent_runtime_binding",
        revokeAction: "agent_runtime_unbind",
        lastChangedAt: runtimeBinding.updatedAt,
        metadata: {
          employeeName: employee.name,
          runtimeId: runtimeBinding.runtimeId,
        },
      });
    }

    if (forkedFrom) {
      const sourceAgent = context.visibleEmployees.find((item) => item.name === forkedFrom.sourceAgentName);
      bindings.push({
        subjectType: "agent",
        subjectId: forkedFrom.sourceAgentName,
        subjectLabel: sourceAgent?.remarkName ?? forkedFrom.sourceAgentName,
        permission: "fork source",
        source: "agent_fork",
        status: "inherited",
        editable: false,
        metadata: {
          employeeName: employee.name,
          sourceAgentName: forkedFrom.sourceAgentName,
          invitationId: forkedFrom.invitationId,
        },
      });
    }

    if (activeDelegation) {
      bindings.push({
        subjectType: "oauth_credential",
        subjectId: activeDelegation.googleOAuthCredentialId,
        subjectLabel: activeDelegation.googleEmail ?? activeDelegation.googleOAuthCredentialId,
        permission: "delegated Google Workspace credential",
        source: "oauth_delegation",
        status: "external",
        editable: context.isManager || activeDelegation.userId === context.actor.userId || employee.ownerUserId === context.actor.userId,
        revokeAction: "agent_google_delegation_revoke",
        lastChangedAt: activeDelegation.updatedAt,
        metadata: {
          employeeName: employee.name,
          userId: activeDelegation.userId,
          googleOAuthCredentialId: activeDelegation.googleOAuthCredentialId,
          googleEmail: activeDelegation.googleEmail ?? null,
          scopes: activeDelegation.scopes,
        },
      });
    }

    for (const access of getDocumentAgentAccessForSubject(context, employee.name)) {
      const document = context.state.channelDocuments.find((item) => item.id === access.documentId);
      bindings.push({
        subjectType: "agent",
        subjectId: employee.name,
        subjectLabel: employee.remarkName ?? employee.name,
        permission: `${access.role}: ${document?.title ?? access.documentId}`,
        source: "document_agent_access",
        status: access.revokedAt ? "revoked" : "active",
        editable: context.isManager && !access.revokedAt,
        revokeAction: context.isManager && !access.revokedAt ? "document_agent_access_revoke" : undefined,
        lastChangedAt: access.updatedAt,
        metadata: {
          grantId: access.id,
          employeeName: employee.name,
          documentId: access.documentId,
          documentTitle: document?.title ?? null,
          role: access.role,
        },
      });
    }

    for (const request of getDocumentPermissionRequestsForAgent(context, employee.name)) {
      const document = request.documentId
        ? context.state.channelDocuments.find((item) => item.id === request.documentId)
        : undefined;
      bindings.push({
        subjectType: "agent",
        subjectId: employee.name,
        subjectLabel: employee.remarkName ?? employee.name,
        permission: `requested ${request.requestedRole}: ${document?.title ?? request.externalUrl ?? request.externalFileId ?? request.id}`,
        source: "document_permission_request",
        status: request.status === "pending" ? "pending" : request.status === "approved" ? "active" : "revoked",
        editable: context.isManager && request.status === "pending",
        updateAction: context.isManager && request.status === "pending" ? "document_permission_request_approve" : undefined,
        revokeAction: context.isManager && request.status === "pending" ? "document_permission_request_reject" : undefined,
        lastChangedAt: request.decidedAt ?? request.createdAt,
        metadata: {
          requestId: request.id,
          employeeName: employee.name,
          documentId: request.documentId ?? null,
          externalFileId: request.externalFileId ?? null,
          externalUrl: request.externalUrl ?? null,
          role: request.requestedRole,
          status: request.status,
          reason: request.reason,
        },
      });
    }

    for (const request of getAgentAccessRequestsForSource(context, employee.name)) {
      if (!canActorSeeAgentAccessRequest(context, request, employee)) {
        continue;
      }
      const requester = context.memberByUserId.get(request.requesterUserId);
      const canDecide = canActorDecideAgentAccessRequest(context, request, employee);
      bindings.push({
        subjectType: "human",
        subjectId: request.requesterUserId,
        subjectLabel: requester ? memberLabel(requester) : request.requesterUserId,
        permission: describeAgentAccessRequestPermission(request),
        source: "agent_access_request",
        status: request.status === "pending" ? "pending" : request.status === "approved" ? "active" : "revoked",
        editable: canDecide && request.status === "pending",
        updateAction: canDecide && request.status === "pending" ? "agent_access_request_approve" : undefined,
        revokeAction: canDecide && request.status === "pending" ? "agent_access_request_reject" : undefined,
        lastChangedAt: request.resolvedAt ?? request.updatedAt,
        metadata: {
          requestId: request.id,
          employeeName: employee.name,
          sourceAgentName: request.sourceAgentName,
          requesterUserId: request.requesterUserId,
          requestType: request.requestType,
          targetChannelName: request.targetChannelName ?? null,
          status: request.status,
          reason: request.reason,
          forkInvitationId: request.forkInvitationId ?? null,
        },
      });
    }

    return {
      id: `agent:${employee.name}`,
      parentId: context.workspaceNodeId,
      resourceType: "agent",
      label: employee.remarkName ?? employee.name,
      status: "active",
      source: "agent_owner",
      bindings,
      metadata: {
        employeeName: employee.name,
        ownerUserId: employee.ownerUserId ?? null,
        channelMemberAccess: employee.channelMemberAccess ?? "enabled",
        forkSourceAgentName: forkedFrom?.sourceAgentName ?? null,
        forkInvitationId: forkedFrom?.invitationId ?? null,
        channelNames: employee.channels,
        assignedSkillIds: skillIds,
        selectedKnowledgePageIds,
        allAgentKnowledgePageIds,
      },
      children: [
        ...buildAgentAccessRequestChildNodes(context, employee),
        ...buildAgentForkInvitationNodes(context, employee),
        ...skillIds
          .map((skillId) => context.skillById.get(skillId))
          .filter((skill): skill is WorkspaceSkill => Boolean(skill))
          .map((skill) => buildSkillNode(context, employee, skill)),
        ...knowledgePolicies
          .filter((policy) => policy.assignmentMode === "all_agents" || selectedKnowledgePageIds.includes(policy.knowledgePageId))
          .map((policy) => buildKnowledgeNode(context, employee, policy.knowledgePageId, policy.assignmentMode)),
      ],
    } satisfies PermissionTreeNode;
  });
}

function buildAgentForkInvitationNodes(
  context: PermissionBuildContext,
  employee: ActiveEmployee,
): PermissionTreeNode[] {
  const sourceLabel = employee.remarkName ?? employee.name;
  return getAgentForkInvitationsForSource(context, employee.name)
    .filter((invitation) =>
      context.isManager ||
      employee.ownerUserId === context.actor.userId ||
      invitation.createdByUserId === context.actor.userId ||
      invitation.targetUserId === context.actor.userId,
    )
    .map((invitation) => {
      const target = context.memberByUserId.get(invitation.targetUserId);
      const creator = context.memberByUserId.get(invitation.createdByUserId);
      return {
        id: `agent-fork-invitation:${invitation.id}`,
        parentId: `agent:${employee.name}`,
        resourceType: "agent_fork_invitation",
        label: `${sourceLabel} -> ${target ? memberLabel(target) : invitation.targetUserId}`,
        status: "pending",
        source: "agent_fork",
        metadata: {
          invitationId: invitation.id,
          employeeName: employee.name,
          sourceAgentName: employee.name,
          targetUserId: invitation.targetUserId,
          createdByUserId: invitation.createdByUserId,
          status: invitation.status,
          createdAt: invitation.createdAt,
        },
        bindings: [
          {
            subjectType: "human",
            subjectId: invitation.targetUserId,
            subjectLabel: target ? memberLabel(target) : invitation.targetUserId,
            permission: `pending agent copy from ${sourceLabel}`,
            source: "agent_fork",
            status: "pending",
            editable: false,
            lastChangedAt: invitation.createdAt,
            metadata: {
              invitationId: invitation.id,
              employeeName: employee.name,
              sourceAgentName: employee.name,
              targetUserId: invitation.targetUserId,
              createdByUserId: invitation.createdByUserId,
              createdByLabel: creator ? memberLabel(creator) : invitation.createdByUserId,
            },
          },
        ],
      } satisfies PermissionTreeNode;
    });
}

function buildAgentAccessRequestChildNodes(
  context: PermissionBuildContext,
  employee: ActiveEmployee,
): PermissionTreeNode[] {
  const sourceLabel = employee.remarkName ?? employee.name;
  return getAgentAccessRequestsForSource(context, employee.name)
    .filter((request) => canActorSeeAgentAccessRequest(context, request, employee))
    .map((request) => {
      const requester = context.memberByUserId.get(request.requesterUserId);
      const resolver = request.resolverUserId ? context.memberByUserId.get(request.resolverUserId) : undefined;
      const canDecide = canActorDecideAgentAccessRequest(context, request, employee);
      return {
        id: `agent-access-request:${request.id}`,
        parentId: `agent:${employee.name}`,
        resourceType: "agent_access_request",
        label: `${requester ? memberLabel(requester) : request.requesterUserId} -> ${sourceLabel}`,
        status: request.status === "pending" ? "pending" : request.status === "approved" ? "active" : "revoked",
        source: "agent_access_request",
        metadata: {
          requestId: request.id,
          employeeName: employee.name,
          sourceAgentName: request.sourceAgentName,
          requesterUserId: request.requesterUserId,
          requestType: request.requestType,
          targetChannelName: request.targetChannelName ?? null,
          status: request.status,
          resolverUserId: request.resolverUserId ?? null,
          resolverLabel: resolver ? memberLabel(resolver) : null,
          forkInvitationId: request.forkInvitationId ?? null,
          reason: request.reason,
          createdAt: request.createdAt,
          resolvedAt: request.resolvedAt ?? null,
        },
        bindings: [
          {
            subjectType: "human",
            subjectId: request.requesterUserId,
            subjectLabel: requester ? memberLabel(requester) : request.requesterUserId,
            permission: describeAgentAccessRequestPermission(request, sourceLabel),
            source: "agent_access_request",
            status: request.status === "pending" ? "pending" : request.status === "approved" ? "active" : "revoked",
            editable: canDecide && request.status === "pending",
            updateAction: canDecide && request.status === "pending" ? "agent_access_request_approve" : undefined,
            revokeAction: canDecide && request.status === "pending" ? "agent_access_request_reject" : undefined,
            lastChangedAt: request.resolvedAt ?? request.updatedAt,
            metadata: {
              requestId: request.id,
              employeeName: employee.name,
              sourceAgentName: request.sourceAgentName,
              requesterUserId: request.requesterUserId,
              requestType: request.requestType,
              targetChannelName: request.targetChannelName ?? null,
              status: request.status,
              reason: request.reason,
              forkInvitationId: request.forkInvitationId ?? null,
            },
          },
        ],
      } satisfies PermissionTreeNode;
    });
}

function buildAgentAccessRequestNodes(context: PermissionBuildContext): PermissionTreeNode[] {
  const visibleEmployeeNames = new Set(context.visibleEmployees.map((employee) => normalizeKey(employee.name)));
  return context.agentAccessRequests
    .filter((request) => !visibleEmployeeNames.has(normalizeKey(request.sourceAgentName)))
    .filter((request) => canActorSeeAgentAccessRequest(context, request))
    .map((request) => {
      const requester = context.memberByUserId.get(request.requesterUserId);
      const canDecide = canActorDecideAgentAccessRequest(context, request);
      return {
        id: `agent-access-request:${request.id}`,
        parentId: context.workspaceNodeId,
        resourceType: "agent_access_request",
        label: `${requester ? memberLabel(requester) : request.requesterUserId} -> ${request.sourceAgentName}`,
        status: request.status === "pending" ? "pending" : request.status === "approved" ? "active" : "revoked",
        source: "agent_access_request",
        metadata: {
          requestId: request.id,
          sourceAgentName: request.sourceAgentName,
          requesterUserId: request.requesterUserId,
          requestType: request.requestType,
          targetChannelName: request.targetChannelName ?? null,
          status: request.status,
          reason: request.reason,
          forkInvitationId: request.forkInvitationId ?? null,
        },
        bindings: [{
          subjectType: "human",
          subjectId: request.requesterUserId,
          subjectLabel: requester ? memberLabel(requester) : request.requesterUserId,
          permission: describeAgentAccessRequestPermission(request, request.sourceAgentName),
          source: "agent_access_request",
          status: request.status === "pending" ? "pending" : request.status === "approved" ? "active" : "revoked",
          editable: canDecide && request.status === "pending",
          updateAction: canDecide && request.status === "pending" ? "agent_access_request_approve" : undefined,
          revokeAction: canDecide && request.status === "pending" ? "agent_access_request_reject" : undefined,
          lastChangedAt: request.resolvedAt ?? request.updatedAt,
          metadata: {
            requestId: request.id,
            sourceAgentName: request.sourceAgentName,
            requesterUserId: request.requesterUserId,
            requestType: request.requestType,
            targetChannelName: request.targetChannelName ?? null,
            status: request.status,
            reason: request.reason,
            forkInvitationId: request.forkInvitationId ?? null,
          },
        }],
      } satisfies PermissionTreeNode;
    });
}

function buildSkillNode(
  context: PermissionBuildContext,
  employee: ActiveEmployee,
  skill: WorkspaceSkill,
): PermissionTreeNode {
  return {
    id: `agent:${employee.name}:skill:${skill.id}`,
    parentId: `agent:${employee.name}`,
    resourceType: "skill",
    label: skill.name,
    status: "active",
    source: "skill_assignment",
    metadata: {
      skillId: skill.id,
      employeeName: employee.name,
    },
    bindings: [
      {
        subjectType: "agent",
        subjectId: employee.name,
        subjectLabel: employee.remarkName ?? employee.name,
        permission: "can use skill",
        source: "skill_assignment",
        status: "active",
        editable: context.isManager || employee.ownerUserId === context.actor.userId,
        updateAction: "agent_skill_assignment",
        lastChangedAt: skill.updatedAt,
        metadata: {
          employeeName: employee.name,
          skillId: skill.id,
        },
      },
    ],
  };
}

function buildKnowledgeNode(
  context: PermissionBuildContext,
  employee: ActiveEmployee,
  knowledgePageId: string,
  assignmentMode: "all_agents" | "selected_agents",
): PermissionTreeNode {
  const page = context.state.knowledgePages.find((item) => item.id === knowledgePageId);
  return {
    id: `agent:${employee.name}:knowledge:${knowledgePageId}`,
    parentId: `agent:${employee.name}`,
    resourceType: "knowledge_page",
    label: page?.title ?? knowledgePageId,
    status: assignmentMode === "all_agents" ? "inherited" : "active",
    source: "knowledge_assignment",
    metadata: {
      employeeName: employee.name,
      knowledgePageId,
      assignmentMode,
    },
    bindings: [
      {
        subjectType: "agent",
        subjectId: employee.name,
        subjectLabel: employee.remarkName ?? employee.name,
        permission: assignmentMode === "all_agents" ? "inherits all-agent knowledge" : "can use knowledge page",
        source: "knowledge_assignment",
        status: assignmentMode === "all_agents" ? "inherited" : "active",
        editable: assignmentMode === "selected_agents" && (context.isManager || employee.ownerUserId === context.actor.userId),
        updateAction: assignmentMode === "selected_agents" ? "agent_knowledge_assignment" : undefined,
        lastChangedAt: page?.assignmentUpdatedAt ?? page?.updatedAt,
        metadata: {
          employeeName: employee.name,
          knowledgePageId,
          assignmentMode,
        },
      },
    ],
  };
}

function buildRuntimeAndDaemonNodes(context: PermissionBuildContext): PermissionTreeNode[] {
  const runtimeGrants = listRuntimeGrantsSync(context.workspaceId);
  const runtimeBindings = listEmployeeRuntimeBindingsSync(context.workspaceId);
  const managerBindings = context.isManager ? buildWorkspaceManagerInheritedBindings(context, "manage/use") : [];
  const nodes: PermissionTreeNode[] = [];

  if (context.isManager) {
    for (const token of listDaemonApiTokensSync(context.workspaceId)) {
      nodes.push({
        id: `daemon-token:${token.id}`,
        parentId: context.workspaceNodeId,
        resourceType: "daemon",
        label: token.label,
        status: token.status === "active" ? "active" : "revoked",
        source: "direct_grant",
        metadata: {
          tokenId: token.id,
          label: token.label,
          status: token.status,
          createdBy: token.createdBy,
          createdAt: token.createdAt,
          lastUsedAt: token.lastUsedAt ?? null,
          revokedAt: token.revokedAt ?? null,
        },
        bindings: [
          {
            subjectType: "daemon_token",
            subjectId: token.id,
            subjectLabel: token.label,
            permission: "daemon registration",
            source: "direct_grant",
            status: token.status === "active" ? "active" : "revoked",
            editable: token.status === "active",
            revokeAction: token.status === "active" ? "daemon_token_revoke" : undefined,
            lastChangedAt: token.revokedAt ?? token.lastUsedAt ?? token.createdAt,
            metadata: {
              tokenId: token.id,
              label: token.label,
              status: token.status,
            },
          },
        ],
      });
    }
  }

  if (!context.isManager) {
    for (const snapshot of listDaemonSnapshotsSync(context.workspaceId)) {
      for (const runtime of snapshot.runtimes) {
        if (!context.visibleRuntimeIds.has(runtime.id)) {
          continue;
        }
        nodes.push({
          id: `runtime:${runtime.id}`,
          parentId: context.workspaceNodeId,
          resourceType: "runtime",
          label: context.runtimeLabelById.get(runtime.id) ?? runtime.name,
          status: runtime.status === "online" ? "active" : "error",
          source: "runtime_grant",
          metadata: {
            runtimeId: runtime.id,
            provider: runtime.provider,
            name: runtime.name,
            status: runtime.status,
            lastHeartbeatAt: runtime.lastHeartbeatAt ?? null,
            lastError: runtime.lastError ?? null,
          },
          bindings: [
            ...runtimeGrants
              .filter((grant) => grant.runtimeId === runtime.id && grant.userId === context.actor.userId)
              .map((grant) => {
                const member = context.memberByUserId.get(grant.userId);
                return {
                  subjectType: "human",
                  subjectId: grant.userId,
                  subjectLabel: member ? memberLabel(member) : grant.userId,
                  permission: grant.permission,
                  source: "runtime_grant",
                  status: grant.status === "active" ? "active" : "revoked",
                  editable: false,
                  lastChangedAt: grant.updatedAt,
                  metadata: {
                    runtimeId: runtime.id,
                    userId: grant.userId,
                    permission: grant.permission,
                    status: grant.status,
                  },
                } satisfies PermissionBinding;
              }),
            ...runtimeBindings
              .filter((binding) => binding.runtimeId === runtime.id)
              .filter((binding) => context.visibleEmployees.some((employee) => employee.name === binding.employeeName))
              .map((binding) => {
                const employee = context.visibleEmployees.find((item) => item.name === binding.employeeName);
                return {
                  subjectType: "agent",
                  subjectId: binding.employeeName,
                  subjectLabel: employee?.remarkName ?? binding.employeeName,
                  permission: "bound runtime",
                  source: "direct_grant",
                  status: "active",
                  editable: employee?.ownerUserId === context.actor.userId,
                  revokeAction: employee?.ownerUserId === context.actor.userId ? "agent_runtime_unbind" : undefined,
                  lastChangedAt: binding.updatedAt,
                  metadata: {
                    runtimeId: runtime.id,
                    employeeName: binding.employeeName,
                  },
                } satisfies PermissionBinding;
              }),
          ],
        });
      }
    }
    return nodes;
  }

  for (const snapshot of listDaemonSnapshotsSync(context.workspaceId)) {
    if (!context.isManager && !snapshot.runtimes.some((runtime) => context.visibleRuntimeIds.has(runtime.id))) {
      continue;
    }
    const daemonNode: PermissionTreeNode = {
      id: `daemon:${snapshot.daemon.id}`,
      parentId: context.workspaceNodeId,
      resourceType: "daemon",
      label: snapshot.daemon.deviceName,
      status: snapshot.daemon.status === "online" ? "active" : "error",
      source: "derived",
      metadata: {
        daemonId: snapshot.daemon.id,
        daemonKey: context.isManager ? snapshot.daemon.daemonKey : null,
        status: snapshot.daemon.status,
        lastHeartbeatAt: snapshot.daemon.lastHeartbeatAt ?? null,
      },
      bindings: managerBindings,
      children: [],
    };
    for (const runtime of snapshot.runtimes) {
      if (!context.isManager && !context.visibleRuntimeIds.has(runtime.id)) {
        continue;
      }
      daemonNode.children?.push({
        id: `runtime:${runtime.id}`,
        parentId: daemonNode.id,
        resourceType: "runtime",
        label: context.runtimeLabelById.get(runtime.id) ?? runtime.name,
        status: runtime.status === "online" ? "active" : "error",
        source: "runtime_grant",
        metadata: {
          runtimeId: runtime.id,
          provider: runtime.provider,
          name: runtime.name,
          status: runtime.status,
          lastHeartbeatAt: runtime.lastHeartbeatAt ?? null,
          lastError: runtime.lastError ?? null,
        },
        bindings: [
          ...managerBindings,
          ...runtimeGrants
            .filter((grant) => grant.runtimeId === runtime.id)
            .filter((grant) => context.isManager || grant.userId === context.actor.userId)
            .map((grant) => {
              const member = context.memberByUserId.get(grant.userId);
              return {
                subjectType: "human",
                subjectId: grant.userId,
                subjectLabel: member ? memberLabel(member) : grant.userId,
                permission: grant.permission,
                source: "runtime_grant",
                status: grant.status === "active" ? "active" : "revoked",
                editable: context.isManager && grant.status === "active",
                revokeAction: context.isManager && grant.status === "active" ? "runtime_grant_revoke" : undefined,
                lastChangedAt: grant.updatedAt,
                metadata: {
                  runtimeId: runtime.id,
                  userId: grant.userId,
                  permission: grant.permission,
                  status: grant.status,
                },
              } satisfies PermissionBinding;
            }),
          ...runtimeBindings
            .filter((binding) => binding.runtimeId === runtime.id)
            .filter((binding) => context.visibleEmployees.some((employee) => employee.name === binding.employeeName))
            .map((binding) => {
              const employee = context.visibleEmployees.find((item) => item.name === binding.employeeName);
              return {
                subjectType: "agent",
                subjectId: binding.employeeName,
                subjectLabel: employee?.remarkName ?? binding.employeeName,
                permission: "bound runtime",
                source: "direct_grant",
                status: "active",
                editable: context.isManager || employee?.ownerUserId === context.actor.userId,
                revokeAction: "agent_runtime_unbind",
                lastChangedAt: binding.updatedAt,
                metadata: {
                  runtimeId: runtime.id,
                  employeeName: binding.employeeName,
                },
              } satisfies PermissionBinding;
            }),
        ],
      });
    }
    nodes.push(daemonNode);
  }

  return nodes;
}

function buildDocumentAndFileNodes(context: PermissionBuildContext): PermissionTreeNode[] {
  const state = context.state;
  const readableChannels = context.visibleChannels.filter((channel) =>
    channel.kind !== "direct" ||
    canReadDirectChannelForPermissionActor(context, channel),
  );
  const visibleChannelNames = new Set(readableChannels.map((channel) => normalizeKey(channel.name)));
  const visibleEmployeeNames = new Set(context.visibleEmployees.map((employee) => normalizeKey(employee.name)));
  const documentNodes = state.channelDocuments
    .filter((document) => visibleChannelNames.has(normalizeKey(document.channelName)))
    .filter((document) => context.isManager || documentVisibleToActor(document, context))
    .map((document) => buildDocumentNode(context, document));
  const fileNodes = state.messages
    .filter((message) => message.channel && visibleChannelNames.has(normalizeKey(message.channel)))
    .flatMap((message) => buildFileNodesForMessage(context, message, visibleEmployeeNames));

  return [...documentNodes, ...fileNodes];
}

function buildDocumentNode(
  context: PermissionBuildContext,
  document: ChannelDocument,
): PermissionTreeNode {
  const state = context.state;
  const accesses = state.channelDocumentAccesses
    .filter((access) => access.documentId === document.id)
    .filter((access) => context.isManager || documentAccessVisibleToActor(access, context));
  const agentAccesses = getDocumentAgentAccessForDocument(context, document.id)
    .filter((access) =>
      context.isManager ||
      context.visibleEmployees.some((employee) => sameValue(employee.name, access.subjectId)),
    );
  const latestRun = findLatestExternalRun(state.externalSheetOperationRuns, document.id);
  const collaboratorBindings: PermissionBinding[] = accesses.map((access) => {
    const member = access.actorType === "human"
      ? context.memberByDisplayName.get(normalizeKey(access.actorId))
      : undefined;
    const employee = access.actorType === "agent"
      ? context.visibleEmployees.find((item) => sameValue(item.name, access.actorId))
      : undefined;
    return {
      subjectType: access.actorType,
      subjectId: member?.userId ?? (access.actorType === "human" ? `human:${access.actorId}` : access.actorId),
      subjectLabel: member ? memberLabel(member) : employee?.remarkName ?? access.actorId,
      permission: access.role,
      source: "document_collaborator",
      status: "active",
      editable: context.isManager || access.actorId === context.actor.displayName,
      updateAction: "document_collaborator_role",
      revokeAction: "document_collaborator_remove",
      lastChangedAt: access.updatedAt,
      metadata: {
        documentId: document.id,
        actorId: access.actorId,
        actorType: access.actorType,
        role: access.role,
      },
    } satisfies PermissionBinding;
  });
  const agentAccessBindings: PermissionBinding[] = agentAccesses.map((access) => {
    const employee = context.visibleEmployees.find((item) => sameValue(item.name, access.subjectId));
    return {
      subjectType: "agent",
      subjectId: access.subjectId,
      subjectLabel: employee?.remarkName ?? access.subjectId,
      permission: access.role,
      source: "document_agent_access",
      status: access.revokedAt ? "revoked" : "active",
      editable: context.isManager && !access.revokedAt,
      updateAction: context.isManager && !access.revokedAt ? "document_agent_access_role" : undefined,
      revokeAction: context.isManager && !access.revokedAt ? "document_agent_access_revoke" : undefined,
      lastChangedAt: access.updatedAt,
      metadata: {
        grantId: access.id,
        documentId: access.documentId,
        actorId: access.subjectId,
        actorType: "agent",
        role: access.role,
        grantedByUserId: access.grantedByUserId,
      },
    } satisfies PermissionBinding;
  });
  const externalChild = document.storageMode === "external" && document.externalProvider
    ? [buildExternalDocumentNode(context, document, latestRun)]
    : [];

  return {
    id: `document:${document.id}`,
    parentId: `channel:${document.channelName}`,
    resourceType: "document",
    label: document.title,
    status: document.status === "archived" ? "revoked" : document.externalSyncStatus === "permission_error" ? "error" : "active",
    source: "document_collaborator",
    metadata: {
      documentId: document.id,
      channelName: document.channelName,
      kind: document.kind,
      storageMode: document.storageMode,
      externalProvider: document.externalProvider ?? null,
      externalSyncStatus: document.externalSyncStatus ?? null,
      latestExternalRunStatus: latestRun?.status ?? null,
      latestExternalRunAt: latestRun?.finishedAt ?? latestRun?.startedAt ?? null,
    },
    bindings: [
      ...collaboratorBindings,
      ...agentAccessBindings,
      ...buildDocumentPermissionRequestBindings(context, document),
    ],
    children: externalChild,
  };
}

function buildDocumentPermissionRequestBindings(
  context: PermissionBuildContext,
  document: ChannelDocument,
): PermissionBinding[] {
  return getDocumentPermissionRequestsForDocument(context, document.id).filter((request) =>
    context.isManager ||
    context.visibleEmployees.some((employee) => sameValue(employee.name, request.requestedByAgentName)),
  ).map((request) => {
    const employee = context.visibleEmployees.find((item) => sameValue(item.name, request.requestedByAgentName));
    const canDecide = canActorDecideDocumentPermissionRequest(context, request, document);
    return {
      subjectType: "agent",
      subjectId: request.requestedByAgentName,
      subjectLabel: employee?.remarkName ?? request.requestedByAgentName,
      permission: `requested ${request.requestedRole}`,
      source: "document_permission_request",
      status: request.status === "pending" ? "pending" : request.status === "approved" ? "active" : "revoked",
      editable: canDecide && request.status === "pending",
      updateAction: canDecide && request.status === "pending" ? "document_permission_request_approve" : undefined,
      revokeAction: canDecide && request.status === "pending" ? "document_permission_request_reject" : undefined,
      lastChangedAt: request.decidedAt ?? request.createdAt,
      metadata: {
        requestId: request.id,
        documentId: document.id,
        actorId: request.requestedByAgentName,
        actorType: "agent",
        role: request.requestedRole,
        targetChannel: request.requestedForChannelName ?? null,
        status: request.status,
        reason: request.reason,
      },
    } satisfies PermissionBinding;
  });
}

function buildDocumentPermissionRequestNodes(context: PermissionBuildContext): PermissionTreeNode[] {
  const state = context.state;
  const documentById = new Map(state.channelDocuments.map((document) => [document.id, document]));
  return context.documentPermissionRequests.filter((request) =>
    (!request.documentId || !documentById.has(request.documentId)) &&
    (context.isManager || canActorDecideDocumentPermissionRequest(context, request))
  ).map((request) => {
    const employee = context.visibleEmployees.find((item) => sameValue(item.name, request.requestedByAgentName));
    const canDecide = canActorDecideDocumentPermissionRequest(context, request);
    return {
      id: `document-permission-request:${request.id}`,
      parentId: context.workspaceNodeId,
      resourceType: "document",
      label: request.externalUrl ?? request.externalFileId ?? request.id,
      status: request.status === "pending" ? "pending" : request.status === "approved" ? "active" : "revoked",
      source: "document_permission_request",
      metadata: {
        requestId: request.id,
        documentId: request.documentId ?? null,
        externalProvider: request.externalProvider ?? null,
        externalFileId: request.externalFileId ?? null,
        externalUrl: request.externalUrl ?? null,
        targetChannel: request.requestedForChannelName ?? null,
      },
      bindings: [{
        subjectType: "agent",
        subjectId: request.requestedByAgentName,
        subjectLabel: employee?.remarkName ?? request.requestedByAgentName,
        permission: `requested ${request.requestedRole}`,
        source: "document_permission_request",
        status: request.status === "pending" ? "pending" : request.status === "approved" ? "active" : "revoked",
        editable: canDecide && request.status === "pending",
        updateAction: canDecide && request.status === "pending" ? "document_permission_request_approve" : undefined,
        revokeAction: canDecide && request.status === "pending" ? "document_permission_request_reject" : undefined,
        lastChangedAt: request.decidedAt ?? request.createdAt,
        metadata: {
          requestId: request.id,
          actorId: request.requestedByAgentName,
          actorType: "agent",
          role: request.requestedRole,
          status: request.status,
          reason: request.reason,
          targetChannel: request.requestedForChannelName ?? null,
        },
      }],
    } satisfies PermissionTreeNode;
  });
}

function canActorDecideDocumentPermissionRequest(
  context: PermissionBuildContext,
  request: ReturnType<typeof listDocumentPermissionRequestsSync>[number],
  document?: ChannelDocument,
): boolean {
  if (context.isManager) {
    return true;
  }
  const resolvedDocument = document ?? (request.documentId
    ? context.state.channelDocuments.find((item) => item.id === request.documentId)
    : undefined);
  if (resolvedDocument) {
    const ownerAccess = context.state.channelDocumentAccesses.find((access) =>
      access.documentId === resolvedDocument.id &&
      access.actorType === "human" &&
      sameValue(access.actorId, context.actor.displayName) &&
      access.role === "owner",
    );
    if (ownerAccess) {
      return true;
    }
  }
  if (request.externalProvider === "google_workspace" && (request.externalFileId || request.externalUrl)) {
    const credential = readGoogleOAuthCredentialSync({
      workspaceId: context.workspaceId,
      userId: context.actor.userId,
    });
    if (credential?.status === "active" && credential.refreshTokenEncrypted) {
      return true;
    }
  }
  return false;
}

function canActorSeeAgentAccessRequest(
  context: PermissionBuildContext,
  request: ReturnType<typeof listAgentAccessRequestsSync>[number],
  sourceAgent?: ActiveEmployee,
): boolean {
  return context.isManager ||
    request.requesterUserId === context.actor.userId ||
    canActorDecideAgentAccessRequest(context, request, sourceAgent);
}

function canActorDecideAgentAccessRequest(
  context: PermissionBuildContext,
  request: ReturnType<typeof listAgentAccessRequestsSync>[number],
  sourceAgent?: ActiveEmployee,
): boolean {
  if (context.isManager) {
    return true;
  }
  const resolvedSource = sourceAgent ?? context.state.activeEmployees.find((employee) => sameValue(employee.name, request.sourceAgentName));
  return Boolean(resolvedSource?.ownerUserId && resolvedSource.ownerUserId === context.actor.userId);
}

function buildExternalDocumentNode(
  context: PermissionBuildContext,
  document: ChannelDocument,
  latestRun: ExternalSheetOperationRun | undefined,
): PermissionTreeNode {
  return {
    id: externalDocumentNodeId(document),
    parentId: `document:${document.id}`,
    resourceType: "external_document",
    label: document.externalProvider === "google_workspace" ? `Google Drive: ${document.title}` : `External: ${document.title}`,
    status: document.externalSyncStatus === "permission_error" ? "error" : document.externalSyncStatus === "missing" ? "error" : "active",
    source: "external_drive_permission",
    metadata: {
      documentId: document.id,
      channelName: document.channelName,
      externalProvider: document.externalProvider ?? null,
      externalFileId: document.externalFileId ?? null,
      externalSyncStatus: document.externalSyncStatus ?? "unknown",
      latestExternalRunStatus: latestRun?.status ?? null,
      latestExternalRunAt: latestRun?.finishedAt ?? latestRun?.startedAt ?? null,
      latestExternalRunError: latestRun?.errorMessage ?? null,
    },
    bindings: [
      {
        subjectType: "system",
        subjectId: "external_drive_permission_sync",
        subjectLabel: "Google Drive permission sync",
        permission: document.externalSyncStatus ?? "unknown",
        source: "external_drive_permission",
        status: "external",
        editable: context.isManager,
        updateAction: context.isManager ? "external_drive_permission_sync" : undefined,
        lastChangedAt: latestRun?.finishedAt ?? latestRun?.startedAt ?? document.externalUpdatedAt ?? document.updatedAt,
        metadata: {
          documentId: document.id,
          latestExternalRunStatus: latestRun?.status ?? null,
          latestExternalRunError: latestRun?.errorMessage ?? null,
        },
      },
    ],
  };
}

function buildFileNodesForMessage(
  context: PermissionBuildContext,
  message: WorkspaceMessage,
  visibleEmployeeNames: Set<string>,
): PermissionTreeNode[] {
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) {
    return [];
  }
  if (!context.isManager && message.role === "agent" && !visibleEmployeeNames.has(normalizeKey(message.speaker))) {
    return [];
  }
  if (!context.isManager && message.role === "human" && message.speakerUserId !== context.actor.userId) {
    return [];
  }

  return attachments.map((attachment) => buildFileNode(context, message, attachment));
}

function buildFileNode(
  context: PermissionBuildContext,
  message: WorkspaceMessage,
  attachment: MessageAttachment,
): PermissionTreeNode {
  const uploaderMember = message.speakerUserId ? context.memberByUserId.get(message.speakerUserId) : undefined;
  const bindings: PermissionBinding[] = [];
  if (uploaderMember) {
    bindings.push({
      subjectType: "human",
      subjectId: uploaderMember.userId,
      subjectLabel: memberLabel(uploaderMember),
      permission: message.role === "human" ? "uploader delete" : "agent output viewer",
      source: "derived",
      status: attachment.deletedAt ? "revoked" : "active",
      editable: context.isManager || uploaderMember.userId === context.actor.userId,
      revokeAction: message.role === "human" && !attachment.deletedAt ? "file_delete" : undefined,
      lastChangedAt: attachment.deletedAt ?? message.time,
      metadata: {
        attachmentId: attachment.id,
        channelName: message.channel ?? null,
      },
    });
  }
  if (context.isManager) {
    bindings.push(...buildWorkspaceManagerInheritedBindings(context, "delete file"));
  }

  return {
    id: `file:${attachment.id}`,
    parentId: message.channel ? `channel:${message.channel}` : context.workspaceNodeId,
    resourceType: "file",
    label: attachment.fileName,
    status: attachment.deletedAt ? "revoked" : "active",
    source: "derived",
    metadata: {
      attachmentId: attachment.id,
      channelName: message.channel ?? null,
      messageId: message.id,
      sizeBytes: attachment.sizeBytes,
      mediaType: attachment.mediaType,
      deletedAt: attachment.deletedAt ?? null,
    },
    bindings,
  };
}

function buildExternalAuthorizationNodes(context: PermissionBuildContext): PermissionTreeNode[] {
  const credentials = listGoogleOAuthCredentialsSync(context.workspaceId)
    .filter((credential) => context.isManager || credential.userId === context.actor.userId);
  const delegations = listAgentGoogleWorkspaceDelegationsSync(context.workspaceId)
    .filter((delegation) =>
      context.isManager ||
      delegation.userId === context.actor.userId ||
      context.visibleEmployees.some((employee) => employee.name === delegation.employeeName),
    );

  return credentials.map((credential) => {
    const member = context.memberByUserId.get(credential.userId);
    const credentialDelegations = delegations.filter((delegation) => delegation.googleOAuthCredentialId === credential.id);
    return {
      id: `oauth-credential:${credential.id}`,
      parentId: context.workspaceNodeId,
      resourceType: "oauth_credential",
      label: credential.googleEmail ?? member?.primaryEmail ?? credential.id,
      status: credential.status === "active" ? "active" : "revoked",
      source: "oauth_delegation",
      metadata: {
        googleOAuthCredentialId: credential.id,
        userId: credential.userId,
        googleEmail: credential.googleEmail ?? null,
        scopes: credential.scopes,
        expiresAt: credential.expiresAt ?? null,
        status: credential.status,
        updatedAt: credential.updatedAt,
      },
      bindings: [
        {
          subjectType: "human",
          subjectId: credential.userId,
          subjectLabel: member ? memberLabel(member) : credential.userId,
          permission: "Google OAuth credential owner",
          source: "direct_grant",
          status: credential.status === "active" ? "active" : "revoked",
          editable: credential.userId === context.actor.userId,
          revokeAction: credential.userId === context.actor.userId && credential.status === "active" ? "oauth_credential_revoke" : undefined,
          lastChangedAt: credential.updatedAt,
          metadata: {
            googleOAuthCredentialId: credential.id,
            userId: credential.userId,
            scopes: credential.scopes,
          },
        },
        ...credentialDelegations.map((delegation) => {
          const employee = context.visibleEmployees.find((item) => item.name === delegation.employeeName);
          return {
            subjectType: "agent",
            subjectId: delegation.employeeName,
            subjectLabel: employee?.remarkName ?? delegation.employeeName,
            permission: "delegated Google Workspace credential",
            source: "oauth_delegation",
            status: delegation.status === "active" ? "external" : "revoked",
            editable: delegation.status === "active" && (context.isManager || delegation.userId === context.actor.userId || employee?.ownerUserId === context.actor.userId),
            revokeAction: delegation.status === "active" ? "agent_google_delegation_revoke" : undefined,
            lastChangedAt: delegation.updatedAt,
            metadata: {
              employeeName: delegation.employeeName,
              userId: delegation.userId,
              googleOAuthCredentialId: delegation.googleOAuthCredentialId,
              scopes: delegation.scopes,
            },
          } satisfies PermissionBinding;
        }),
      ],
    } satisfies PermissionTreeNode;
  });
}

function buildWorkspaceManagerInheritedBindings(
  context: PermissionBuildContext,
  permission: string,
): PermissionBinding[] {
  return Array.from(context.memberByUserId.values())
    .filter((member) => member.role === "owner" || member.role === "admin")
    .map((member) => ({
      subjectType: "human",
      subjectId: member.userId,
      subjectLabel: memberLabel(member),
      permission,
      source: "workspace_role",
      status: "inherited",
      editable: false,
      inheritedFromNodeId: context.workspaceNodeId,
      metadata: {
        userId: member.userId,
        role: member.role,
      },
    }));
}

function documentVisibleToActor(document: ChannelDocument, context: PermissionBuildContext): boolean {
  return context.state.channelDocumentAccesses.some(
    (access) =>
      access.documentId === document.id &&
      (
        (access.actorType === "human" && sameValue(access.actorId, context.actor.displayName)) ||
        (access.actorType === "agent" && context.visibleEmployees.some((employee) => sameValue(employee.name, access.actorId)))
      ),
  );
}

function documentAccessVisibleToActor(
  access: { actorId: string; actorType: "human" | "agent" },
  context: PermissionBuildContext,
): boolean {
  if (access.actorType === "human") {
    const member = context.memberByDisplayName.get(normalizeKey(access.actorId));
    return member?.userId === context.actor.userId || sameValue(access.actorId, context.actor.displayName);
  }
  return context.visibleEmployees.some((employee) => sameValue(employee.name, access.actorId));
}

function canReadChannelForPermissionActor(
  channel: ChannelRecord,
  actor: PermissionCenterActorInput,
  state: PermissionBuildContext["state"],
  channelParticipantsByName: PermissionBuildContext["channelParticipantsByName"],
): boolean {
  if (channel.kind === "direct") {
    return canReadDirectChannelForPermissionActor(
      {
        actor,
        state,
        channelParticipantsByName,
      },
      channel,
    );
  }
  if (actor.role === "owner" || actor.role === "admin") {
    return true;
  }
  if (!actor.userId.trim()) {
    return false;
  }
  const participant = (channelParticipantsByName.get(normalizeKey(channel.name)) ?? [])
    .find((item) => item.userId === actor.userId && item.status === "active");
  if (participant) {
    return true;
  }
  return canReadChannelByLegacyMembership(channel, actor, state, channelParticipantsByName);
}

function canReadDirectChannelForPermissionActor(
  context: Pick<PermissionBuildContext, "actor" | "state" | "channelParticipantsByName">,
  channel: ChannelRecord,
): boolean {
  const actorUserId = context.actor.userId.trim();
  if (!actorUserId) {
    return false;
  }
  const participant = getChannelParticipants(context, channel.name)
    .find((item) => item.userId === actorUserId && item.status === "active");
  if (participant) {
    return true;
  }

  if (
    resolveChannelHumanMemberNames(context.state, channel)
      .some((name) => sameValue(name, context.actor.displayName))
  ) {
    return true;
  }

  return channel.employeeNames.some((employeeName) => {
    const employee = context.state.activeEmployees.find((item) => sameValue(item.name, employeeName));
    return employee?.ownerUserId === actorUserId;
  });
}

function canReadChannelByLegacyMembership(
  channel: ChannelRecord,
  actor: PermissionCenterActorInput,
  state: PermissionBuildContext["state"],
  channelParticipantsByName: PermissionBuildContext["channelParticipantsByName"],
): boolean {
  if ((channelParticipantsByName.get(normalizeKey(channel.name)) ?? []).length > 0) {
    return false;
  }
  const visibleHumanNames = resolveChannelHumanMemberNames(state, channel);
  if (visibleHumanNames.length === 0) {
    // Memberless channels must default to private (deny); see
    // canReadChannelByLegacyMembership in channel-access.ts.
    return false;
  }
  return visibleHumanNames.some((candidate) => sameValue(candidate, actor.displayName));
}

function getChannelParticipants(
  context: Pick<PermissionBuildContext, "channelParticipantsByName">,
  channelName: string,
): ReturnType<typeof listWorkspaceChannelParticipantsSync> {
  return context.channelParticipantsByName.get(normalizeKey(channelName)) ?? [];
}

function getChannelAccessRequests(
  context: PermissionBuildContext,
  channelName: string,
): ReturnType<typeof listChannelAccessRequestsSync> {
  return context.channelAccessRequestsByName.get(normalizeKey(channelName)) ?? [];
}

function getChannelInvitations(
  context: PermissionBuildContext,
  channelName: string,
): ReturnType<typeof listChannelInvitationsSync> {
  return context.channelInvitationsByName.get(normalizeKey(channelName)) ?? [];
}

function getDocumentAgentAccessForDocument(
  context: PermissionBuildContext,
  documentId: string,
): ReturnType<typeof listDocumentAgentAccessSync> {
  return context.documentAgentAccessByDocumentId.get(documentId) ?? [];
}

function getDocumentAgentAccessForSubject(
  context: PermissionBuildContext,
  subjectId: string,
): ReturnType<typeof listDocumentAgentAccessSync> {
  return context.documentAgentAccessBySubjectId.get(normalizeKey(subjectId)) ?? [];
}

function getDocumentPermissionRequestsForDocument(
  context: PermissionBuildContext,
  documentId: string,
): ReturnType<typeof listDocumentPermissionRequestsSync> {
  return context.documentPermissionRequestsByDocumentId.get(documentId) ?? [];
}

function getDocumentPermissionRequestsForAgent(
  context: PermissionBuildContext,
  employeeName: string,
): ReturnType<typeof listDocumentPermissionRequestsSync> {
  return context.documentPermissionRequestsByAgentName.get(normalizeKey(employeeName)) ?? [];
}

function getAgentForkInvitationsForSource(
  context: PermissionBuildContext,
  employeeName: string,
): ReturnType<typeof listAgentForkInvitationsSync> {
  return context.agentForkInvitationsBySourceName.get(normalizeKey(employeeName)) ?? [];
}

function getAgentAccessRequestsForSource(
  context: PermissionBuildContext,
  employeeName: string,
): ReturnType<typeof listAgentAccessRequestsSync> {
  return context.agentAccessRequestsBySourceName.get(normalizeKey(employeeName)) ?? [];
}

function findLatestExternalRun(
  runs: ExternalSheetOperationRun[],
  documentId: string,
): ExternalSheetOperationRun | undefined {
  return runs
    .filter((run) => run.channelDocumentId === documentId)
    .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())[0];
}

function attachDiagnostics(
  node: PermissionTreeNode,
  diagnosticsByNode: Map<string, PermissionDiagnostic[]>,
): void {
  node.diagnostics = diagnosticsByNode.get(node.id) ?? [];
  if (node.diagnostics.length > 0 && node.diagnostics.some((diagnostic) => diagnostic.severity === "critical")) {
    node.status = "error";
  }
  for (const child of node.children ?? []) {
    attachDiagnostics(child, diagnosticsByNode);
  }
}

function groupDiagnosticsByNode(diagnostics: PermissionDiagnostic[]): Map<string, PermissionDiagnostic[]> {
  const map = new Map<string, PermissionDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    if (!diagnostic.resourceNodeId) {
      continue;
    }
    const next = map.get(diagnostic.resourceNodeId) ?? [];
    next.push(diagnostic);
    map.set(diagnostic.resourceNodeId, next);
  }
  return map;
}

function groupByKey<T>(items: T[], keyForItem: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyForItem(item);
    const values = map.get(key) ?? [];
    values.push(item);
    map.set(key, values);
  }
  return map;
}

function groupByNormalizedKey<T>(items: T[], keyForItem: (item: T) => string): Map<string, T[]> {
  return groupByKey(items, (item) => normalizeKey(keyForItem(item)));
}

function isDiagnosticVisibleToActor(
  diagnostic: PermissionDiagnostic,
  context: PermissionBuildContext,
): boolean {
  if (diagnostic.subjectType === "human") {
    return diagnostic.subjectId === context.actor.userId || diagnostic.subjectId === `human:${context.actor.displayName}`;
  }
  if (diagnostic.subjectType === "agent") {
    return context.visibleEmployees.some((employee) => employee.name === diagnostic.subjectId);
  }
  if (diagnostic.resourceNodeId?.startsWith("document:")) {
    const documentId = diagnostic.resourceNodeId.slice("document:".length);
    const document = context.state.channelDocuments.find((item) => item.id === documentId);
    return document ? documentVisibleToActor(document, context) : false;
  }
  return diagnostic.resourceNodeId === context.workspaceNodeId;
}

function dedupeActorPermissions(
  permissions: PermissionActorSummary["permissions"],
): PermissionActorSummary["permissions"] {
  const seen = new Set<string>();
  const result: PermissionActorSummary["permissions"] = [];
  for (const permission of permissions) {
    const key = [
      permission.nodeId,
      permission.permission,
      permission.source,
      permission.status,
    ].join(":");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(permission);
  }
  return result;
}

function subjectTypeRank(type: PermissionSubjectType): number {
  switch (type) {
    case "human":
      return 0;
    case "agent":
      return 1;
    case "daemon_token":
      return 2;
    case "oauth_credential":
      return 3;
    case "system":
      return 4;
  }
}

function externalDocumentNodeId(document: ChannelDocument): string {
  return `external-document:${document.id}`;
}

function actorKey(subjectType: PermissionSubjectType, subjectId: string): string {
  return `${subjectType}:${subjectId}`;
}

function parseAgentForkOrigin(origin: string | undefined): { sourceAgentName: string; invitationId: string } | undefined {
  if (!origin) {
    return undefined;
  }
  const match = /^agent-fork:(.*):([^:]+)$/.exec(origin);
  if (!match) {
    return undefined;
  }
  return {
    sourceAgentName: match[1] ?? "",
    invitationId: match[2] ?? "",
  };
}

function describeAgentAccessRequestPermission(
  request: ReturnType<typeof listAgentAccessRequestsSync>[number],
  sourceLabel?: string,
): string {
  if (request.requestType === "channel_use") {
    const target = request.targetChannelName ? ` in #${request.targetChannelName}` : "";
    return sourceLabel ? `requested channel use of ${sourceLabel}${target}` : `requested channel use${target}`;
  }
  return sourceLabel ? `requested copy of ${sourceLabel}` : "requested agent copy";
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function memberLabel(member: Pick<PermissionCatalogMember, "displayName" | "primaryEmail">): string {
  return member.primaryEmail ? `${member.displayName} <${member.primaryEmail}>` : member.displayName;
}
