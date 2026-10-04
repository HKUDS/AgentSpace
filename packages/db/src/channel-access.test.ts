import test, { before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createChannelAccessRequestSync,
  createChannelInvitationSync,
  createChannelParticipantSync,
  createStoredChannelSync,
  createUserSync,
  createWorkspaceSync,
  getDatabase,
  listChannelParticipantsForUserSync,
  listChannelParticipantsSync,
  readChannelInvitationSync,
  readChannelParticipantSync,
} from "./index.ts";

const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-channel-access-"));
const originalCwd = process.cwd();

before(() => {
  process.env.AGENT_SPACE_REPOSITORY_ROOT = originalCwd;
  writeFileSync(join(tempRoot, "Target.md"), "# test\n");
  mkdirSync(join(tempRoot, "data"), { recursive: true });
  process.chdir(tempRoot);
});

beforeEach(() => {
  getDatabase().exec(`
    DELETE FROM channel_invitation;
    DELETE FROM channel_access_request;
    DELETE FROM channel_participant;
    DELETE FROM workspace_channel;
    DELETE FROM workspace_membership;
    DELETE FROM workspace;
    DELETE FROM users;
  `);
});

test("channel participants can be created and read back with camel-case aliases", () => {
  const { workspaceId, userId } = seedChannelAccessRecords();

  const participant = createChannelParticipantSync({
    workspaceId,
    channelName: "Launch Room",
    userId,
    addedBy: "owner-user",
  });

  assert.equal(participant.workspaceId, workspaceId);
  assert.equal(participant.channelName, "Launch Room");
  assert.equal(participant.userId, userId);
  assert.equal(participant.addedBy, "owner-user");
  assert.equal(participant.status, "active");
  assert.match(participant.joinedAt, /T/);
  assert.match(participant.updatedAt, /T/);
  assert.equal(readChannelParticipantSync(workspaceId, "Launch Room", userId)?.id, participant.id);
  assert.equal(listChannelParticipantsSync(workspaceId, "Launch Room")[0]?.id, participant.id);
  assert.equal(listChannelParticipantsForUserSync(workspaceId, userId)[0]?.id, participant.id);
});

test("channel access request and invitation records map response timestamps", () => {
  const { workspaceId, userId } = seedChannelAccessRecords();

  const request = createChannelAccessRequestSync({
    workspaceId,
    channelName: "Launch Room",
    userId,
    note: "please add me",
  });
  const invitation = createChannelInvitationSync({
    workspaceId,
    channelName: "Launch Room",
    inviteeUserId: userId,
    invitedBy: "owner-user",
  });

  assert.equal(request.workspaceId, workspaceId);
  assert.equal(request.channelName, "Launch Room");
  assert.equal(request.userId, userId);
  assert.match(request.requestedAt, /T/);
  assert.equal(invitation.workspaceId, workspaceId);
  assert.equal(invitation.channelName, "Launch Room");
  assert.equal(invitation.inviteeUserId, userId);
  assert.match(invitation.createdAt, /T/);
  assert.match(invitation.expiresAt ?? "", /T/);
});

test("an expired pending invitation does not prevent reinviting the recipient", () => {
  const { workspaceId, userId } = seedChannelAccessRecords();
  const input = {
    workspaceId,
    channelName: "Launch Room",
    inviteeUserId: userId,
    invitedBy: "owner-user",
  };
  const original = createChannelInvitationSync(input);
  getDatabase().prepare("UPDATE channel_invitation SET expires_at = ? WHERE id = ?")
    .run("2000-01-01T00:00:00.000Z", original.id);

  const replacement = createChannelInvitationSync(input);

  assert.notEqual(replacement.id, original.id);
  assert.equal(replacement.status, "pending");
  assert.ok(new Date(replacement.expiresAt!).getTime() > Date.now());
  assert.equal(readChannelInvitationSync(original.id, workspaceId)?.status, "expired");
});

function seedChannelAccessRecords(): { workspaceId: string; userId: string } {
  const workspace = createWorkspaceSync({
    slug: "channel-access",
    name: "Channel Access",
    createdBy: "system",
  });
  const user = createUserSync({
    displayName: "Mina",
    primaryEmail: "mina@example.com",
  });
  createStoredChannelSync({
    name: "Launch Room",
    kind: "group",
    humanMemberNames: [],
    humanMembers: 0,
    employeeNames: [],
  }, workspace.id);

  return {
    workspaceId: workspace.id,
    userId: user.id,
  };
}
