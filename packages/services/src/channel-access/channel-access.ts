import {
  acceptChannelInvitationSync,
  approveChannelAccessRequestSync,
  createChannelAccessRequestSync,
  createChannelInvitationSync,
  createChannelParticipantSync,
  listChannelAccessRequestsSync,
  listChannelInvitationsSync,
  listChannelParticipantsSync,
  listWorkspaceMembershipsSync,
  readChannelAccessRequestSync,
  readChannelInvitationSync,
  readChannelParticipantSync,
  removeChannelParticipantSync,
  readUserByEmailSync,
  readUserSync,
  readWorkspaceMembershipSync,
  rejectChannelAccessRequestSync,
  rejectChannelInvitationSync,
  revokeChannelInvitationSync,
  type StoredChannelAccessRequestRecord,
  type StoredChannelInvitationRecord,
  type StoredChannelParticipantRecord,
  type WorkspaceRole,
} from "@agent-space/db";
import type { AgentSpaceState, ChannelRecord } from "@agent-space/domain/workspace";
import { resolveChannelHumanMemberNames, updateChannelHumanMemberNamesSync } from "../channels/channels.ts";
import {
  resolveChannelDocumentRole,
  upsertChannelDocumentAccessRole,
} from "../documents/access.ts";
import { ensureWorkspaceStateSync, writeWorkspaceStateSync } from "../shared/state-io.ts";
import { sameValue } from "../shared/helpers.ts";
import { createNotificationSync, postNotificationChannelMessageSync } from "../notifications/notifications.ts";

export interface ChannelAccessActor {
  userId: string;
  displayName?: string;
  role?: WorkspaceRole;
}

export type ChannelAccessState = "accessible" | "pending" | "requestable";

export interface ChannelAccessSummary {
  channelName: string;
  state: ChannelAccessState;
  requestId?: string;
}

export function isWorkspaceAdminOrOwnerRole(role?: WorkspaceRole): boolean {
  return role === "owner" || role === "admin";
}

export function canReadChannelForActorSync(input: {
  workspaceId: string;
  channelName?: string | null;
  actor: ChannelAccessActor;
}): boolean {
  const channelName = input.channelName?.trim();
  if (!channelName) {
    return true;
  }
  const state = ensureWorkspaceStateSync(input.workspaceId);
  const channel = state.channels.find((item) => sameValue(item.name, channelName));
  if (channel?.kind === "direct") {
    return canReadDirectChannelForActorSync({
      workspaceId: input.workspaceId,
      channel,
      actor: input.actor,
      state,
    });
  }
  if (isWorkspaceAdminOrOwnerRole(resolveActorRole(input.workspaceId, input.actor))) {
    return true;
  }
  if (!input.actor.userId.trim()) {
    return false;
  }
  const participant = readChannelParticipantSync(input.workspaceId, channelName, input.actor.userId);
  if (participant?.status === "active") {
    return true;
  }

  return canReadChannelByLegacyMembership(input.workspaceId, channelName, input.actor);
}

export function canReadDirectChannelForActorSync(input: {
  workspaceId: string;
  channel: ChannelRecord;
  actor: ChannelAccessActor;
  state?: AgentSpaceState;
}): boolean {
  const actorUserId = input.actor.userId.trim();
  if (!actorUserId) {
    return false;
  }
  const participant = readChannelParticipantSync(input.workspaceId, input.channel.name, actorUserId);
  if (participant?.status === "active") {
    return true;
  }

  const state = input.state ?? ensureWorkspaceStateSync(input.workspaceId);
  const actorDisplayName = input.actor.displayName?.trim() || readUserSync(actorUserId)?.displayName;
  if (
    actorDisplayName &&
    resolveChannelHumanMemberNames(state, input.channel).some((name) => sameValue(name, actorDisplayName))
  ) {
    return true;
  }

  return input.channel.employeeNames.some((employeeName) => {
    const employee = state.activeEmployees.find((item) => sameValue(item.name, employeeName));
    return employee?.ownerUserId === actorUserId;
  });
}

export function assertCanReadChannelForActorSync(input: {
  workspaceId: string;
  channelName?: string | null;
  actor: ChannelAccessActor;
}): void {
  if (!canReadChannelForActorSync(input)) {
    throw new Error("Forbidden.");
  }
}

export function canWriteChannelForActorSync(input: {
  workspaceId: string;
  channelName?: string | null;
  actor: ChannelAccessActor;
}): boolean {
  return canReadChannelForActorSync(input);
}

export function assertCanWriteChannelForActorSync(input: {
  workspaceId: string;
  channelName?: string | null;
  actor: ChannelAccessActor;
}): void {
  if (!canWriteChannelForActorSync(input)) {
    throw new Error("Forbidden.");
  }
}

export function getChannelAccessSummaryForActorSync(input: {
  workspaceId: string;
  channelName: string;
  actor: ChannelAccessActor;
}): ChannelAccessSummary {
  if (canReadChannelForActorSync(input)) {
    return { channelName: input.channelName, state: "accessible" };
  }
  const pending = listChannelAccessRequestsSync(input.workspaceId, {
    channelName: input.channelName,
    userId: input.actor.userId,
    statuses: ["pending"],
  })[0];
  return {
    channelName: input.channelName,
    state: pending ? "pending" : "requestable",
    requestId: pending?.id,
  };
}

export function requestChannelAccessForActorSync(input: {
  workspaceId: string;
  channelName: string;
  actor: ChannelAccessActor;
  note?: string;
}): StoredChannelAccessRequestRecord {
  assertWorkspaceMember(input.workspaceId, input.actor.userId);
  assertChannelExists(input.workspaceId, input.channelName);
  if (canReadChannelForActorSync(input)) {
    throw new Error("channel.access.already_granted");
  }
  const request = createChannelAccessRequestSync({
    workspaceId: input.workspaceId,
    channelName: input.channelName.trim(),
    userId: input.actor.userId,
    note: input.note?.trim() || undefined,
  });
  notifyChannelAccessRequested({
    workspaceId: input.workspaceId,
    request,
    actor: input.actor,
  });
  return request;
}

export function listChannelAccessRequestsForManagerSync(input: {
  workspaceId: string;
  actor: ChannelAccessActor;
  statuses?: Array<"pending" | "approved" | "rejected" | "cancelled">;
}): StoredChannelAccessRequestRecord[] {
  assertWorkspaceManager(input.workspaceId, input.actor);
  return listChannelAccessRequestsSync(input.workspaceId, { statuses: input.statuses ?? ["pending"] });
}

function notifyChannelAccessRequested(input: {
  workspaceId: string;
  request: StoredChannelAccessRequestRecord;
  actor: ChannelAccessActor;
}): void {
  const requester = readUserSync(input.request.userId);
  const requesterName = requester?.displayName ?? input.actor.displayName ?? requester?.primaryEmail ?? input.request.userId;
  const requesterEmail = requester?.primaryEmail;
  const approvers = listWorkspaceMembershipsSync(input.workspaceId)
    .filter((membership) => isWorkspaceAdminOrOwnerRole(membership.role))
    .filter((membership) => membership.userId !== input.request.userId);

  for (const approver of approvers) {
    createNotificationSync({
      workspaceId: input.workspaceId,
      recipientType: "human",
      recipientId: approver.userId,
      actorType: "human",
      actorId: input.request.userId,
      type: "channel.access_requested",
      resourceType: "approval",
      resourceId: input.request.id,
      channelName: input.request.channelName,
      title: "Channel access requested",
      body: `${requesterName} requested access to #${input.request.channelName}.`,
      actionHref: "/approvals",
      severity: "warning",
      dedupeKey: `channel.access_requested:${input.workspaceId}:${input.request.id}:${approver.userId}`,
      metadata: {
        requestId: input.request.id,
        channelName: input.request.channelName,
        requesterUserId: input.request.userId,
        requesterDisplayName: requesterName,
        requesterEmail,
      },
    });
  }

  postNotificationChannelMessageSync({
    workspaceId: input.workspaceId,
    channelName: input.request.channelName,
    summary: `${requesterName} requested access to #${input.request.channelName}.`,
    code: "channel.access_requested_notice",
    data: {
      request_id: input.request.id,
      channel_name: input.request.channelName,
      requester_user_id: input.request.userId,
      requester_display_name: requesterName,
      requester_email: requesterEmail,
    },
  });
}

export function approveChannelAccessRequestForActorSync(input: {
  workspaceId: string;
  requestId: string;
  actor: ChannelAccessActor;
}): StoredChannelAccessRequestRecord {
  assertWorkspaceManager(input.workspaceId, input.actor);
  const request = readChannelAccessRequestSync(input.requestId, input.workspaceId);
  if (!request) {
    throw new Error("channel.access_request.not_found");
  }
  const approved = approveChannelAccessRequestSync(request.id, input.actor.userId, input.workspaceId);
  if (!approved) {
    throw new Error("channel.access_request.not_pending");
  }
  syncLegacyHumanMemberForUser(input.workspaceId, request.channelName, request.userId);
  const target = readUserSync(request.userId);
  createNotificationSync({
    workspaceId: input.workspaceId,
    recipientType: "human",
    recipientId: request.userId,
    actorType: "human",
    actorId: input.actor.userId,
    type: "channel.access_approved",
    resourceType: "channel",
    resourceId: request.channelName,
    channelName: request.channelName,
    title: "Channel access approved",
    body: `${input.actor.displayName ?? "A workspace manager"} approved your request to join #${request.channelName}.`,
    actionHref: `/im?focus=${encodeURIComponent(`channel:${request.channelName}`)}`,
    severity: "success",
    dedupeKey: `channel.access_approved:${input.workspaceId}:${request.id}:${request.userId}`,
    metadata: {
      requestId: request.id,
      channelName: request.channelName,
      targetUserId: request.userId,
      targetDisplayName: target?.displayName,
      resolvedByUserId: input.actor.userId,
    },
  });
  postNotificationChannelMessageSync({
    workspaceId: input.workspaceId,
    channelName: request.channelName,
    summary: `${target?.displayName ?? "A member"} joined #${request.channelName} after access approval.`,
    code: "channel.access_approved_notice",
    data: {
      request_id: request.id,
      channel_name: request.channelName,
      target_user_id: request.userId,
      target_display_name: target?.displayName,
      actor_user_id: input.actor.userId,
    },
  });
  return approved;
}

export function rejectChannelAccessRequestForActorSync(input: {
  workspaceId: string;
  requestId: string;
  actor: ChannelAccessActor;
}): StoredChannelAccessRequestRecord {
  assertWorkspaceManager(input.workspaceId, input.actor);
  const rejected = rejectChannelAccessRequestSync(input.requestId, input.actor.userId, input.workspaceId);
  if (!rejected) {
    throw new Error("channel.access_request.not_pending");
  }
  createNotificationSync({
    workspaceId: input.workspaceId,
    recipientType: "human",
    recipientId: rejected.userId,
    actorType: "human",
    actorId: input.actor.userId,
    type: "channel.access_rejected",
    resourceType: "channel",
    resourceId: rejected.channelName,
    channelName: rejected.channelName,
    title: "Channel access rejected",
    body: `${input.actor.displayName ?? "A workspace manager"} rejected your request to join #${rejected.channelName}.`,
    actionHref: "/inbox",
    severity: "warning",
    dedupeKey: `channel.access_rejected:${input.workspaceId}:${rejected.id}:${rejected.userId}`,
    metadata: {
      requestId: rejected.id,
      channelName: rejected.channelName,
      targetUserId: rejected.userId,
      resolvedByUserId: input.actor.userId,
    },
  });
  return rejected;
}

export function addWorkspaceMemberToChannelForActorSync(input: {
  workspaceId: string;
  channelName: string;
  targetUserId: string;
  actor: ChannelAccessActor;
}): StoredChannelParticipantRecord {
  assertWorkspaceManager(input.workspaceId, input.actor);
  assertWorkspaceMember(input.workspaceId, input.targetUserId);
  assertChannelExists(input.workspaceId, input.channelName);
  const participant = createChannelParticipantSync({
    workspaceId: input.workspaceId,
    channelName: input.channelName.trim(),
    userId: input.targetUserId.trim(),
    addedBy: input.actor.userId,
  });
  syncLegacyHumanMemberForUser(input.workspaceId, input.channelName, input.targetUserId);
  const target = readUserSync(input.targetUserId.trim());
  createNotificationSync({
    workspaceId: input.workspaceId,
    recipientType: "human",
    recipientId: input.targetUserId.trim(),
    actorType: "human",
    actorId: input.actor.userId,
    type: "channel.member_added",
    resourceType: "channel",
    resourceId: input.channelName.trim(),
    channelName: input.channelName.trim(),
    title: "Added to channel",
    body: `${input.actor.displayName ?? "A workspace manager"} added you to #${input.channelName.trim()}.`,
    actionHref: `/im?focus=${encodeURIComponent(`channel:${input.channelName.trim()}`)}`,
    severity: "success",
    dedupeKey: `channel.member_added:${input.workspaceId}:${input.channelName.trim()}:${input.targetUserId.trim()}`,
    metadata: {
      channelName: input.channelName.trim(),
      targetUserId: input.targetUserId.trim(),
      targetDisplayName: target?.displayName,
      actorUserId: input.actor.userId,
    },
  });
  postNotificationChannelMessageSync({
    workspaceId: input.workspaceId,
    channelName: input.channelName.trim(),
    summary: `${target?.displayName ?? "A member"} was added to #${input.channelName.trim()}.`,
    code: "channel.member_added_notice",
    data: {
      channel_name: input.channelName.trim(),
      target_user_id: input.targetUserId.trim(),
      target_display_name: target?.displayName,
      actor_user_id: input.actor.userId,
    },
  });
  return participant;
}

export function removeWorkspaceMemberFromChannelForActorSync(input: {
  workspaceId: string;
  channelName: string;
  targetUserId: string;
  actor: ChannelAccessActor;
}): StoredChannelParticipantRecord {
  assertWorkspaceManager(input.workspaceId, input.actor);
  assertWorkspaceMember(input.workspaceId, input.targetUserId);
  assertChannelExists(input.workspaceId, input.channelName);
  const removed = removeChannelParticipantSync(
    input.workspaceId,
    input.channelName.trim(),
    input.targetUserId.trim(),
  );
  if (!removed) {
    throw new Error("channel.participant.not_active");
  }
  removeLegacyHumanMemberForUser(input.workspaceId, input.channelName, input.targetUserId);
  return removed;
}

export function createChannelParticipantsForMembersSync(input: {
  workspaceId: string;
  channelName: string;
  memberDisplayNames: string[];
  addedByUserId: string;
}): StoredChannelParticipantRecord[] {
  const members = listWorkspaceMembershipsSync(input.workspaceId);
  const records: StoredChannelParticipantRecord[] = [];
  for (const displayName of input.memberDisplayNames) {
    const user = resolveWorkspaceUserByDisplayName(input.workspaceId, displayName);
    if (!user || !members.some((membership) => membership.userId === user.id)) {
      continue;
    }
    records.push(createChannelParticipantSync({
      workspaceId: input.workspaceId,
      channelName: input.channelName,
      userId: user.id,
      addedBy: input.addedByUserId,
    }));
  }
  return records;
}

export function inviteUserToChannelForActorSync(input: {
  workspaceId: string;
  channelName: string;
  actor: ChannelAccessActor;
  inviteeEmail?: string;
  inviteeUserId?: string;
}): StoredChannelInvitationRecord {
  assertWorkspaceManager(input.workspaceId, input.actor);
  assertChannelExists(input.workspaceId, input.channelName);
  const user = input.inviteeUserId
    ? readUserSync(input.inviteeUserId)
    : input.inviteeEmail
      ? readUserByEmailSync(input.inviteeEmail)
      : null;
  const invitation = createChannelInvitationSync({
    workspaceId: input.workspaceId,
    channelName: input.channelName.trim(),
    inviteeUserId: input.inviteeUserId ?? user?.id,
    inviteeEmail: input.inviteeEmail ?? user?.primaryEmail,
    invitedBy: input.actor.userId,
  });
  if (invitation.inviteeUserId) {
    createNotificationSync({
      workspaceId: input.workspaceId,
      recipientType: "human",
      recipientId: invitation.inviteeUserId,
      actorType: "human",
      actorId: input.actor.userId,
      type: "channel.invitation_created",
      resourceType: "channel",
      resourceId: invitation.channelName,
      channelName: invitation.channelName,
      title: "Channel invitation",
      body: `${input.actor.displayName ?? "A workspace manager"} invited you to #${invitation.channelName}.`,
      actionHref: "/im",
      severity: "info",
      dedupeKey: `channel.invitation_created:${input.workspaceId}:${invitation.id}:${invitation.inviteeUserId}`,
      metadata: {
        invitationId: invitation.id,
        channelName: invitation.channelName,
        inviteeEmail: invitation.inviteeEmail,
        invitedByUserId: input.actor.userId,
      },
    });
  }
  return invitation;
}

export function listChannelInvitationsForActorSync(input: {
  workspaceId: string;
  actor: ChannelAccessActor;
  statuses?: Array<"pending" | "accepted" | "rejected" | "revoked" | "expired">;
}): StoredChannelInvitationRecord[] {
  if (isWorkspaceAdminOrOwnerRole(resolveActorRole(input.workspaceId, input.actor))) {
    return listChannelInvitationsSync(input.workspaceId, { statuses: input.statuses ?? ["pending"] });
  }
  const user = readUserSync(input.actor.userId);
  const byUser = listChannelInvitationsSync(input.workspaceId, {
    inviteeUserId: input.actor.userId,
    statuses: input.statuses ?? ["pending"],
  });
  const byEmail = user?.primaryEmail
    ? listChannelInvitationsSync(input.workspaceId, {
        inviteeEmail: user.primaryEmail,
        statuses: input.statuses ?? ["pending"],
      })
    : [];
  return dedupeInvitations([...byUser, ...byEmail]);
}

export function acceptChannelInvitationForActorSync(input: {
  invitationId: string;
  actor: ChannelAccessActor;
}): StoredChannelInvitationRecord {
  const invitation = readChannelInvitationSync(input.invitationId);
  if (!invitation) {
    throw new Error("channel.invitation.not_found");
  }
  assertInvitationMatchesActor(invitation, input.actor);
  const accepted = acceptChannelInvitationSync(invitation.id, input.actor.userId, invitation.workspaceId);
  if (!accepted) {
    throw new Error("channel.invitation.not_pending");
  }
  syncLegacyHumanMemberForUser(accepted.workspaceId, accepted.channelName, input.actor.userId);
  return accepted;
}

export function rejectChannelInvitationForActorSync(input: {
  invitationId: string;
  actor: ChannelAccessActor;
}): StoredChannelInvitationRecord {
  const invitation = readChannelInvitationSync(input.invitationId);
  if (!invitation) {
    throw new Error("channel.invitation.not_found");
  }
  assertInvitationMatchesActor(invitation, input.actor);
  const rejected = rejectChannelInvitationSync(invitation.id, input.actor.userId, invitation.workspaceId);
  if (!rejected) {
    throw new Error("channel.invitation.not_pending");
  }
  return rejected;
}

export function revokeChannelInvitationForActorSync(input: {
  workspaceId: string;
  invitationId: string;
  actor: ChannelAccessActor;
}): StoredChannelInvitationRecord {
  assertWorkspaceManager(input.workspaceId, input.actor);
  const revoked = revokeChannelInvitationSync(input.invitationId, input.actor.userId, input.workspaceId);
  if (!revoked) {
    throw new Error("channel.invitation.not_pending");
  }
  if (revoked.inviteeUserId) {
    createNotificationSync({
      workspaceId: input.workspaceId,
      recipientType: "human",
      recipientId: revoked.inviteeUserId,
      actorType: "human",
      actorId: input.actor.userId,
      type: "channel.invitation_revoked",
      resourceType: "channel",
      resourceId: revoked.channelName,
      channelName: revoked.channelName,
      title: "Channel invitation revoked",
      body: `${input.actor.displayName ?? "A workspace manager"} revoked your invitation to #${revoked.channelName}.`,
      actionHref: "/inbox",
      severity: "warning",
      dedupeKey: `channel.invitation_revoked:${input.workspaceId}:${revoked.id}:${revoked.inviteeUserId}`,
      metadata: {
        invitationId: revoked.id,
        channelName: revoked.channelName,
        inviteeEmail: revoked.inviteeEmail,
        revokedByUserId: input.actor.userId,
      },
    });
  }
  return revoked;
}

function resolveActorRole(workspaceId: string, actor: ChannelAccessActor): WorkspaceRole | undefined {
  if (actor.role) {
    return actor.role;
  }
  return readWorkspaceMembershipSync(workspaceId, actor.userId)?.role;
}

function assertWorkspaceManager(workspaceId: string, actor: ChannelAccessActor): void {
  if (!isWorkspaceAdminOrOwnerRole(resolveActorRole(workspaceId, actor))) {
    throw new Error("Forbidden.");
  }
}

function assertWorkspaceMember(workspaceId: string, userId: string): void {
  const membership = readWorkspaceMembershipSync(workspaceId, userId.trim());
  if (!membership) {
    throw new Error("Forbidden.");
  }
}

function assertInvitationMatchesActor(invitation: StoredChannelInvitationRecord, actor: ChannelAccessActor): void {
  const user = readUserSync(actor.userId);
  if (invitation.inviteeUserId && invitation.inviteeUserId !== actor.userId) {
    throw new Error("channel.invitation.user_mismatch");
  }
  if (invitation.inviteeEmail && normalizeEmail(user?.primaryEmail) !== normalizeEmail(invitation.inviteeEmail)) {
    throw new Error("channel.invitation.email_mismatch");
  }
}

function assertChannelExists(workspaceId: string, channelName: string): void {
  const state = ensureWorkspaceStateSync(workspaceId);
  if (!state.channels.some((channel) => sameValue(channel.name, channelName))) {
    throw new Error("channel.not_found");
  }
}

function canReadChannelByLegacyMembership(
  workspaceId: string,
  channelName: string,
  actor: ChannelAccessActor,
): boolean {
  const state = ensureWorkspaceStateSync(workspaceId);
  const channel = state.channels.find((item) => sameValue(item.name, channelName));
  if (!channel) {
    return false;
  }
  const hasStructuredAccessRows = listChannelParticipantsSync(workspaceId, channel.name, {
    statuses: ["active", "removed"],
  }).length > 0;
  if (hasStructuredAccessRows) {
    return false;
  }

  const displayName = actor.displayName?.trim() || readUserSync(actor.userId)?.displayName;
  if (!displayName) {
    return false;
  }
  const visibleHumanNames = resolveChannelHumanMemberNames(state, channel);
  if (visibleHumanNames.length === 0) {
    // A channel that resolves to no human members must default to private
    // (deny). Returning true here would make memberless channels — e.g. ones
    // created via `createChannelSync({ name })` with no participants, such as
    // the CLI `channel create` path — readable by every workspace member.
    return false;
  }
  return visibleHumanNames.some((candidate) => sameValue(candidate, displayName));
}

function syncLegacyHumanMemberForUser(workspaceId: string, channelName: string, userId: string): void {
  const user = readUserSync(userId);
  if (!user) {
    return;
  }
  const state = ensureWorkspaceStateSync(workspaceId);
  const channel = state.channels.find((item) => sameValue(item.name, channelName));
  if (!channel) {
    return;
  }
  const names = resolveChannelHumanMemberNames(state, channel);
  const nextNames = names.some((name) => sameValue(name, user.displayName))
    ? names
    : [...names, user.displayName];
  const updatedState = updateChannelHumanMemberNamesSync({
    channelName: channel.name,
    humanMemberNames: nextNames,
  }, workspaceId);
  grantExistingChannelDocumentsToHumanMember(updatedState, channel.name, user.displayName, workspaceId);
}

function removeLegacyHumanMemberForUser(workspaceId: string, channelName: string, userId: string): void {
  const user = readUserSync(userId);
  if (!user) {
    return;
  }
  const state = ensureWorkspaceStateSync(workspaceId);
  const channel = state.channels.find((item) => sameValue(item.name, channelName));
  if (!channel) {
    return;
  }
  const nextNames = resolveChannelHumanMemberNames(state, channel)
    .filter((name) => !sameValue(name, user.displayName));
  updateChannelHumanMemberNamesSync({
    channelName: channel.name,
    humanMemberNames: nextNames,
  }, workspaceId);
}

function grantExistingChannelDocumentsToHumanMember(
  state: AgentSpaceState,
  channelName: string,
  displayName: string,
  workspaceId: string,
): void {
  let changed = false;
  for (const document of state.channelDocuments) {
    if (!sameValue(document.channelName, channelName)) {
      continue;
    }
    if (resolveChannelDocumentRole(state, document.id, displayName, "human")) {
      continue;
    }
    upsertChannelDocumentAccessRole(state, {
      documentId: document.id,
      actorId: displayName,
      actorType: "human",
      role: "editor",
    });
    changed = true;
  }

  if (changed) {
    writeWorkspaceStateSync(state, workspaceId);
  }
}

function resolveWorkspaceUserByDisplayName(workspaceId: string, displayName: string): { id: string; displayName: string } | null {
  const trimmed = displayName.trim();
  if (!trimmed) {
    return null;
  }
  const memberships = listWorkspaceMembershipsSync(workspaceId);
  for (const membership of memberships) {
    const user = readUserSync(membership.userId);
    if (user && sameValue(user.displayName, trimmed)) {
      return { id: user.id, displayName: user.displayName };
    }
  }
  return null;
}

function dedupeInvitations(invitations: StoredChannelInvitationRecord[]): StoredChannelInvitationRecord[] {
  const seen = new Set<string>();
  const result: StoredChannelInvitationRecord[] = [];
  for (const invitation of invitations) {
    if (seen.has(invitation.id)) {
      continue;
    }
    seen.add(invitation.id);
    result.push(invitation);
  }
  return result;
}

function normalizeEmail(email: string | undefined): string | undefined {
  const normalized = email?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}
