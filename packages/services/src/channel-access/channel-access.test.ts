import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { before, beforeEach } from "node:test";
import {
  createUserSync,
  createWorkspaceMembershipSync,
  createWorkspaceSync,
  getDatabase,
  listChannelAccessRequestsSync,
  listWorkspaceNotificationsForRecipientSync,
} from "@agent-space/db";
import {
  canReadChannelForActorSync,
  createChannelParticipantsForMembersSync,
  createChannelSync,
  requestChannelAccessForActorSync,
  readWorkspaceStateSync,
  resetWorkspaceStateSync,
  writeWorkspaceStateSync,
} from "../index.ts";

const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-channel-privacy-"));

before(() => {
  writeFileSync(join(tempRoot, "Target.md"), "# test\n");
  mkdirSync(join(tempRoot, "data"), { recursive: true });
  process.chdir(tempRoot);
});

beforeEach(() => {
  getDatabase().exec(`
    DELETE FROM channel_access_request;
    DELETE FROM channel_invitation;
    DELETE FROM channel_participant;
    DELETE FROM workspace_employee;
    DELETE FROM workspace_channel;
    DELETE FROM workspace_snapshot;
    DELETE FROM workspace_membership;
    DELETE FROM workspace;
    DELETE FROM users;
  `);
});

test("direct channel reads are limited to participants and agent owners, not workspace managers", () => {
  const owner = createUserSync({
    displayName: "Tianyu",
    primaryEmail: "tianyu@example.com",
  });
  const participant = createUserSync({
    displayName: "Wu",
    primaryEmail: "wu@example.com",
  });
  const agentOwner = createUserSync({
    displayName: "Agent Owner",
    primaryEmail: "agent-owner@example.com",
  });
  const workspace = createWorkspaceSync({
    id: "workspace-direct-privacy",
    slug: "workspace-direct-privacy",
    name: "Direct Privacy",
    createdBy: owner.id,
  });
  createWorkspaceMembershipSync({ workspaceId: workspace.id, userId: owner.id, role: "owner" });
  createWorkspaceMembershipSync({ workspaceId: workspace.id, userId: participant.id, role: "member" });
  createWorkspaceMembershipSync({ workspaceId: workspace.id, userId: agentOwner.id, role: "member" });

  const state = resetWorkspaceStateSync(workspace.id);
  writeWorkspaceStateSync({
    ...state,
    humanMembers: [
      { name: owner.displayName, role: "Founder" },
      { name: participant.displayName, role: "Member" },
      { name: agentOwner.displayName, role: "Member" },
    ],
    activeEmployees: [
      {
        name: "finance-analyst",
        role: "Finance",
        remarkName: "Finance Analyst",
        origin: "manual",
        summary: "Finance analyst",
        traits: [],
        fit: "Ready",
        skillIds: [],
        channels: ["direct-finance"],
        status: "active",
        ownerUserId: agentOwner.id,
      },
    ],
    channels: [
      {
        name: "direct-finance",
        kind: "direct",
        humanMemberNames: [participant.displayName],
        humanMembers: 1,
        employeeNames: ["finance-analyst"],
      },
      {
        name: "group-ops",
        kind: "group",
        humanMemberNames: [participant.displayName],
        humanMembers: 1,
        employeeNames: ["finance-analyst"],
      },
    ],
  }, workspace.id);

  assert.equal(canReadChannelForActorSync({
    workspaceId: workspace.id,
    channelName: "direct-finance",
    actor: { userId: owner.id, displayName: owner.displayName, role: "owner" },
  }), false);
  assert.equal(canReadChannelForActorSync({
    workspaceId: workspace.id,
    channelName: "direct-finance",
    actor: { userId: participant.id, displayName: participant.displayName, role: "member" },
  }), true);
  assert.equal(canReadChannelForActorSync({
    workspaceId: workspace.id,
    channelName: "direct-finance",
    actor: { userId: agentOwner.id, displayName: agentOwner.displayName, role: "member" },
  }), true);
  assert.equal(canReadChannelForActorSync({
    workspaceId: workspace.id,
    channelName: "group-ops",
    actor: { userId: owner.id, displayName: owner.displayName, role: "owner" },
  }), true);
});

test("direct channel structured participants can read even when legacy names are absent", () => {
  const owner = createUserSync({
    displayName: "Owner",
    primaryEmail: "owner@example.com",
  });
  const participant = createUserSync({
    displayName: "Participant",
    primaryEmail: "participant@example.com",
  });
  const workspace = createWorkspaceSync({
    id: "workspace-direct-structured",
    slug: "workspace-direct-structured",
    name: "Direct Structured",
    createdBy: owner.id,
  });
  createWorkspaceMembershipSync({ workspaceId: workspace.id, userId: owner.id, role: "owner" });
  createWorkspaceMembershipSync({ workspaceId: workspace.id, userId: participant.id, role: "member" });

  const state = resetWorkspaceStateSync(workspace.id);
  writeWorkspaceStateSync({
    ...state,
    humanMembers: [
      { name: owner.displayName, role: "Founder" },
      { name: participant.displayName, role: "Member" },
    ],
    channels: [
      {
        name: "direct-human",
        kind: "direct",
        humanMemberNames: [],
        humanMembers: 0,
        employeeNames: [],
      },
    ],
  }, workspace.id);
  createChannelParticipantsForMembersSync({
    workspaceId: workspace.id,
    channelName: "direct-human",
    memberDisplayNames: [participant.displayName],
    addedByUserId: owner.id,
  });

  assert.equal(readWorkspaceStateSync(workspace.id).channels[0]?.humanMemberNames?.length, 0);
  assert.equal(canReadChannelForActorSync({
    workspaceId: workspace.id,
    channelName: "direct-human",
    actor: { userId: owner.id, displayName: owner.displayName, role: "owner" },
  }), false);
  assert.equal(canReadChannelForActorSync({
    workspaceId: workspace.id,
    channelName: "direct-human",
    actor: { userId: participant.id, displayName: participant.displayName, role: "member" },
  }), true);
});

test("group channel with no members defaults to private and is not workspace-readable", () => {
  const owner = createUserSync({
    displayName: "Owner",
    primaryEmail: "owner@example.com",
  });
  const outsider = createUserSync({
    displayName: "Outsider",
    primaryEmail: "outsider@example.com",
  });
  const workspace = createWorkspaceSync({
    id: "workspace-memberless-group",
    slug: "workspace-memberless-group",
    name: "Memberless Group",
    createdBy: owner.id,
  });
  createWorkspaceMembershipSync({ workspaceId: workspace.id, userId: owner.id, role: "owner" });
  createWorkspaceMembershipSync({ workspaceId: workspace.id, userId: outsider.id, role: "member" });

  resetWorkspaceStateSync(workspace.id);

  // Mirrors the CLI `channel create --name <name>` path: a group channel with
  // no human members and no structured participant rows.
  createChannelSync({ name: "secret-room" }, workspace.id);

  // Admins/owners still see every channel.
  assert.equal(canReadChannelForActorSync({
    workspaceId: workspace.id,
    channelName: "secret-room",
    actor: { userId: owner.id, displayName: owner.displayName, role: "owner" },
  }), true);

  // A non-member workspace member must NOT read a memberless channel. Before
  // the fix this returned true (empty membership was treated as public).
  assert.equal(canReadChannelForActorSync({
    workspaceId: workspace.id,
    channelName: "secret-room",
    actor: { userId: outsider.id, displayName: outsider.displayName, role: "member" },
  }), false);
});

test("requesting channel access notifies workspace managers and posts a channel notice", () => {
  const owner = createUserSync({
    displayName: "Owner",
    primaryEmail: "owner@example.com",
  });
  const admin = createUserSync({
    displayName: "Admin",
    primaryEmail: "admin@example.com",
  });
  const requester = createUserSync({
    displayName: "Requester",
    primaryEmail: "requester@example.com",
  });
  const workspace = createWorkspaceSync({
    id: "workspace-channel-access-requested",
    slug: "workspace-channel-access-requested",
    name: "Channel Access Requested",
    createdBy: owner.id,
  });
  createWorkspaceMembershipSync({ workspaceId: workspace.id, userId: owner.id, role: "owner" });
  createWorkspaceMembershipSync({ workspaceId: workspace.id, userId: admin.id, role: "admin" });
  createWorkspaceMembershipSync({ workspaceId: workspace.id, userId: requester.id, role: "member" });

  const state = resetWorkspaceStateSync(workspace.id);
  writeWorkspaceStateSync({
    ...state,
    humanMembers: [
      { name: owner.displayName, role: "Founder" },
      { name: admin.displayName, role: "Admin" },
      { name: requester.displayName, role: "Member" },
    ],
    channels: [
      {
        name: "private-planning",
        kind: "group",
        humanMemberNames: [owner.displayName],
        humanMembers: 1,
        employeeNames: [],
      },
    ],
  }, workspace.id);

  const request = requestChannelAccessForActorSync({
    workspaceId: workspace.id,
    channelName: "private-planning",
    actor: {
      userId: requester.id,
      displayName: requester.displayName,
      role: "member",
    },
  });

  const ownerNotifications = listWorkspaceNotificationsForRecipientSync({
    workspaceId: workspace.id,
    recipientType: "human",
    recipientId: owner.id,
  });
  const adminNotifications = listWorkspaceNotificationsForRecipientSync({
    workspaceId: workspace.id,
    recipientType: "human",
    recipientId: admin.id,
  });
  const requesterNotifications = listWorkspaceNotificationsForRecipientSync({
    workspaceId: workspace.id,
    recipientType: "human",
    recipientId: requester.id,
    includeArchived: true,
  });
  const pendingRequests = listChannelAccessRequestsSync(workspace.id, {
    channelName: "private-planning",
    userId: requester.id,
    statuses: ["pending"],
  });
  const messages = readWorkspaceStateSync(workspace.id).messages;

  assert.equal(ownerNotifications.length, 1);
  assert.equal(ownerNotifications[0]?.type, "channel.access_requested");
  assert.equal(ownerNotifications[0]?.resourceId, request.id);
  assert.equal(ownerNotifications[0]?.actionHref, "/approvals");
  assert.equal(adminNotifications.length, 1);
  assert.equal(requesterNotifications.length, 0);
  assert.equal(pendingRequests[0]?.id, request.id);
  assert.equal(messages[0]?.code, "channel.access_requested_notice");
  assert.equal(messages[0]?.channel, "private-planning");
  assert.equal(messages[0]?.data?.request_id, request.id);
});
