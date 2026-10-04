import { DEFAULT_WORKSPACE_ID, getDatabase, randomLikeId, withTransaction } from "./database.ts";
import type {
  ChannelAccessRequestStatus,
  ChannelInvitationStatus,
  ChannelParticipantStatus,
  StoredChannelAccessRequestRecord,
  StoredChannelInvitationRecord,
  StoredChannelParticipantRecord,
} from "./types.ts";

const CHANNEL_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CreateChannelParticipantInput {
  workspaceId?: string;
  channelName: string;
  userId: string;
  addedBy?: string;
}

export interface ListChannelParticipantsOptions {
  statuses?: ChannelParticipantStatus[];
  userId?: string;
}

export interface CreateChannelAccessRequestInput {
  workspaceId?: string;
  channelName: string;
  userId: string;
  note?: string;
}

export interface ListChannelAccessRequestsOptions {
  channelName?: string;
  userId?: string;
  statuses?: ChannelAccessRequestStatus[];
}

export interface CreateChannelInvitationInput {
  workspaceId?: string;
  channelName: string;
  inviteeUserId?: string;
  inviteeEmail?: string;
  invitedBy: string;
  expiresAt?: string;
}

export interface ListChannelInvitationsOptions {
  channelName?: string;
  inviteeUserId?: string;
  inviteeEmail?: string;
  statuses?: ChannelInvitationStatus[];
}

export function createChannelParticipantSync(input: CreateChannelParticipantInput): StoredChannelParticipantRecord {
  const db = getDatabase();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const now = new Date().toISOString();
  const id = `channel-participant-${randomLikeId()}`;

  db.prepare(
    `INSERT INTO channel_participant (
      id, workspace_id, channel_name, user_id, status, added_by, joined_at, removed_at, updated_at
    ) VALUES (?, ?, ?, ?, 'active', ?, ?, NULL, ?)
     ON CONFLICT(workspace_id, channel_name, user_id) DO UPDATE SET
       status = 'active',
       added_by = EXCLUDED.added_by,
       joined_at = CASE WHEN channel_participant.status = 'removed' THEN EXCLUDED.joined_at ELSE channel_participant.joined_at END,
       removed_at = NULL,
       updated_at = EXCLUDED.updated_at`,
  ).run(id, workspaceId, input.channelName, input.userId, input.addedBy ?? null, now, now);

  const record = readChannelParticipantSync(workspaceId, input.channelName, input.userId, { includeRemoved: true });
  if (!record) {
    throw new Error("channel.participant.create_failed");
  }
  return record;
}

export function readChannelParticipantSync(
  workspaceId: string,
  channelName: string,
  userId: string,
  options?: { includeRemoved?: boolean },
): StoredChannelParticipantRecord | null {
  const db = getDatabase();
  const row = db.prepare(
    `SELECT
      id,
      workspace_id AS workspaceId,
      channel_name AS channelName,
      user_id AS userId,
      status,
      added_by AS addedBy,
      joined_at AS joinedAt,
      removed_at AS removedAt,
      updated_at AS updatedAt
     FROM channel_participant
     WHERE workspace_id = ? AND channel_name = ? AND user_id = ?
       AND (? = 1 OR status = 'active')`,
  ).get(workspaceId, channelName, userId, options?.includeRemoved ? 1 : 0) as Record<string, unknown> | undefined;

  return row ? mapChannelParticipantRecord(row) : null;
}

export function listChannelParticipantsSync(
  workspaceId: string,
  channelName: string,
  options?: ListChannelParticipantsOptions,
): StoredChannelParticipantRecord[] {
  const db = getDatabase();
  const conditions = ["workspace_id = ?", "channel_name = ?"];
  const params: unknown[] = [workspaceId, channelName];
  const statuses = options?.statuses?.length ? options.statuses : ["active"];
  conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
  params.push(...statuses);
  if (options?.userId) {
    conditions.push("user_id = ?");
    params.push(options.userId);
  }

  const rows = db.prepare(
    `SELECT
      id,
      workspace_id AS workspaceId,
      channel_name AS channelName,
      user_id AS userId,
      status,
      added_by AS addedBy,
      joined_at AS joinedAt,
      removed_at AS removedAt,
      updated_at AS updatedAt
     FROM channel_participant
     WHERE ${conditions.join(" AND ")}
     ORDER BY joined_at ASC, user_id ASC`,
  ).all(...params) as Array<Record<string, unknown>>;

  return rows.map(mapChannelParticipantRecord).filter((record): record is StoredChannelParticipantRecord => record !== null);
}

export function listChannelParticipantsForUserSync(
  workspaceId: string,
  userId: string,
  options?: Pick<ListChannelParticipantsOptions, "statuses">,
): StoredChannelParticipantRecord[] {
  const db = getDatabase();
  const statuses = options?.statuses?.length ? options.statuses : ["active"];
  const rows = db.prepare(
    `SELECT
      id,
      workspace_id AS workspaceId,
      channel_name AS channelName,
      user_id AS userId,
      status,
      added_by AS addedBy,
      joined_at AS joinedAt,
      removed_at AS removedAt,
      updated_at AS updatedAt
     FROM channel_participant
     WHERE workspace_id = ? AND user_id = ?
       AND status IN (${statuses.map(() => "?").join(", ")})
     ORDER BY joined_at ASC, channel_name ASC`,
  ).all(workspaceId, userId, ...statuses) as Array<Record<string, unknown>>;

  return rows.map(mapChannelParticipantRecord).filter((record): record is StoredChannelParticipantRecord => record !== null);
}

export function listWorkspaceChannelParticipantsSync(
  workspaceId: string,
  options?: ListChannelParticipantsOptions,
): StoredChannelParticipantRecord[] {
  const db = getDatabase();
  const conditions = ["workspace_id = ?"];
  const params: unknown[] = [workspaceId];
  const statuses = options?.statuses?.length ? options.statuses : ["active"];
  conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
  params.push(...statuses);
  if (options?.userId) {
    conditions.push("user_id = ?");
    params.push(options.userId);
  }

  const rows = db.prepare(
    `SELECT
      id,
      workspace_id AS workspaceId,
      channel_name AS channelName,
      user_id AS userId,
      status,
      added_by AS addedBy,
      joined_at AS joinedAt,
      removed_at AS removedAt,
      updated_at AS updatedAt
     FROM channel_participant
     WHERE ${conditions.join(" AND ")}
     ORDER BY channel_name ASC, joined_at ASC, user_id ASC`,
  ).all(...params) as Array<Record<string, unknown>>;

  return rows.map(mapChannelParticipantRecord).filter((record): record is StoredChannelParticipantRecord => record !== null);
}

export function removeChannelParticipantSync(
  workspaceId: string,
  channelName: string,
  userId: string,
): StoredChannelParticipantRecord | null {
  const db = getDatabase();
  const now = new Date().toISOString();
  const result = db.prepare(
    `UPDATE channel_participant
     SET status = 'removed', removed_at = ?, updated_at = ?
     WHERE workspace_id = ? AND channel_name = ? AND user_id = ? AND status = 'active'`,
  ).run(now, now, workspaceId, channelName, userId);
  if (result.changes === 0) {
    return null;
  }
  return readChannelParticipantSync(workspaceId, channelName, userId, { includeRemoved: true });
}

export function createChannelAccessRequestSync(input: CreateChannelAccessRequestInput): StoredChannelAccessRequestRecord {
  const db = getDatabase();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const now = new Date().toISOString();
  const id = `channel-access-request-${randomLikeId()}`;

  db.prepare(
    `INSERT INTO channel_access_request (
      id, workspace_id, channel_name, user_id, status, requested_at, resolved_at, resolved_by, note
    ) VALUES (?, ?, ?, ?, 'pending', ?, NULL, NULL, ?)
     ON CONFLICT (workspace_id, channel_name, user_id) WHERE status = 'pending' DO UPDATE SET
       requested_at = EXCLUDED.requested_at,
       note = EXCLUDED.note`,
  ).run(id, workspaceId, input.channelName, input.userId, now, input.note ?? null);

  const record = readPendingChannelAccessRequestSync(workspaceId, input.channelName, input.userId);
  if (!record) {
    throw new Error("channel.access_request.create_failed");
  }
  return record;
}

export function readChannelAccessRequestSync(
  requestId: string,
  workspaceId?: string,
): StoredChannelAccessRequestRecord | null {
  const db = getDatabase();
  const row = workspaceId
    ? db.prepare(channelAccessRequestSelectSql("id = ? AND workspace_id = ?")).get(requestId, workspaceId)
    : db.prepare(channelAccessRequestSelectSql("id = ?")).get(requestId);
  return row ? mapChannelAccessRequestRecord(row as Record<string, unknown>) : null;
}

export function listChannelAccessRequestsSync(
  workspaceId: string,
  options?: ListChannelAccessRequestsOptions,
): StoredChannelAccessRequestRecord[] {
  const db = getDatabase();
  const conditions = ["workspace_id = ?"];
  const params: unknown[] = [workspaceId];
  if (options?.channelName) {
    conditions.push("channel_name = ?");
    params.push(options.channelName);
  }
  if (options?.userId) {
    conditions.push("user_id = ?");
    params.push(options.userId);
  }
  const statuses = options?.statuses?.length ? options.statuses : ["pending"];
  conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
  params.push(...statuses);

  const rows = db.prepare(
    `${channelAccessRequestSelectSql(conditions.join(" AND "))}
     ORDER BY requested_at DESC, id DESC`,
  ).all(...params) as Array<Record<string, unknown>>;

  return rows.map(mapChannelAccessRequestRecord).filter((record): record is StoredChannelAccessRequestRecord => record !== null);
}

export function approveChannelAccessRequestSync(
  requestId: string,
  resolvedBy: string,
  workspaceId?: string,
): StoredChannelAccessRequestRecord | null {
  const db = getDatabase();
  return withTransaction(db, () => {
    const record = readChannelAccessRequestSync(requestId, workspaceId);
    if (!record || record.status !== "pending") {
      return null;
    }

    createChannelParticipantSync({
      workspaceId: record.workspaceId,
      channelName: record.channelName,
      userId: record.userId,
      addedBy: resolvedBy,
    });

    return resolveChannelAccessRequestSync(record.id, "approved", resolvedBy, record.workspaceId);
  });
}

export function rejectChannelAccessRequestSync(
  requestId: string,
  resolvedBy: string,
  workspaceId?: string,
): StoredChannelAccessRequestRecord | null {
  return resolveChannelAccessRequestSync(requestId, "rejected", resolvedBy, workspaceId);
}

export function cancelChannelAccessRequestSync(
  requestId: string,
  workspaceId?: string,
): StoredChannelAccessRequestRecord | null {
  return resolveChannelAccessRequestSync(requestId, "cancelled", undefined, workspaceId);
}

export function createChannelInvitationSync(input: CreateChannelInvitationInput): StoredChannelInvitationRecord {
  const db = getDatabase();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const inviteeEmail = normalizeEmail(input.inviteeEmail);
  if (!input.inviteeUserId && !inviteeEmail) {
    throw new Error("channel.invitation.missing_invitee");
  }
  const existing = readPendingChannelInvitationSync(
    workspaceId,
    input.channelName,
    input.inviteeUserId,
    inviteeEmail,
  );
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const expiresAt = input.expiresAt ?? new Date(Date.now() + CHANNEL_INVITATION_TTL_MS).toISOString();
  const id = `channel-invitation-${randomLikeId()}`;
  db.prepare(
    `INSERT INTO channel_invitation (
      id, workspace_id, channel_name, invitee_user_id, invitee_email, invited_by,
      status, created_at, expires_at, responded_at, responded_by
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL)`,
  ).run(id, workspaceId, input.channelName, input.inviteeUserId ?? null, inviteeEmail ?? null, input.invitedBy, now, expiresAt);

  const record = readChannelInvitationSync(id, workspaceId);
  if (!record) {
    throw new Error("channel.invitation.create_failed");
  }
  return record;
}

export function readChannelInvitationSync(
  invitationId: string,
  workspaceId?: string,
): StoredChannelInvitationRecord | null {
  const db = getDatabase();
  const row = workspaceId
    ? db.prepare(channelInvitationSelectSql("id = ? AND workspace_id = ?")).get(invitationId, workspaceId)
    : db.prepare(channelInvitationSelectSql("id = ?")).get(invitationId);
  const record = row ? mapChannelInvitationRecord(row as Record<string, unknown>) : null;
  return expireInvitationIfNeeded(record);
}

export function listChannelInvitationsSync(
  workspaceId: string,
  options?: ListChannelInvitationsOptions,
): StoredChannelInvitationRecord[] {
  const db = getDatabase();
  const conditions = ["workspace_id = ?"];
  const params: unknown[] = [workspaceId];
  if (options?.channelName) {
    conditions.push("channel_name = ?");
    params.push(options.channelName);
  }
  if (options?.inviteeUserId) {
    conditions.push("invitee_user_id = ?");
    params.push(options.inviteeUserId);
  }
  const inviteeEmail = normalizeEmail(options?.inviteeEmail);
  if (inviteeEmail) {
    conditions.push("invitee_email = ?");
    params.push(inviteeEmail);
  }
  const statuses = options?.statuses?.length ? options.statuses : ["pending"];
  conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
  params.push(...statuses);

  const rows = db.prepare(
    `${channelInvitationSelectSql(conditions.join(" AND "))}
     ORDER BY created_at DESC, id DESC`,
  ).all(...params) as Array<Record<string, unknown>>;

  return rows
    .map(mapChannelInvitationRecord)
    .filter((record): record is StoredChannelInvitationRecord => record !== null)
    .map(expireInvitationIfNeeded)
    .filter((record): record is StoredChannelInvitationRecord => record !== null);
}

export function acceptChannelInvitationSync(
  invitationId: string,
  acceptedByUserId: string,
  workspaceId?: string,
): StoredChannelInvitationRecord | null {
  const db = getDatabase();
  return withTransaction(db, () => {
    const record = readChannelInvitationSync(invitationId, workspaceId);
    if (!record || record.status !== "pending") {
      return null;
    }
    if (record.inviteeUserId && record.inviteeUserId !== acceptedByUserId) {
      throw new Error("channel.invitation.user_mismatch");
    }

    createChannelParticipantSync({
      workspaceId: record.workspaceId,
      channelName: record.channelName,
      userId: acceptedByUserId,
      addedBy: record.invitedBy,
    });

    return resolveChannelInvitationSync(record.id, "accepted", acceptedByUserId, record.workspaceId);
  });
}

export function rejectChannelInvitationSync(
  invitationId: string,
  rejectedByUserId: string,
  workspaceId?: string,
): StoredChannelInvitationRecord | null {
  return resolveChannelInvitationSync(invitationId, "rejected", rejectedByUserId, workspaceId);
}

export function revokeChannelInvitationSync(
  invitationId: string,
  revokedByUserId: string,
  workspaceId?: string,
): StoredChannelInvitationRecord | null {
  return resolveChannelInvitationSync(invitationId, "revoked", revokedByUserId, workspaceId);
}

export function cancelChannelInvitationSync(
  invitationId: string,
  cancelledByUserId: string,
  workspaceId?: string,
): StoredChannelInvitationRecord | null {
  return revokeChannelInvitationSync(invitationId, cancelledByUserId, workspaceId);
}

export function expireChannelInvitationSync(
  invitationId: string,
  workspaceId?: string,
): StoredChannelInvitationRecord | null {
  return resolveChannelInvitationSync(invitationId, "expired", undefined, workspaceId);
}

function readPendingChannelAccessRequestSync(
  workspaceId: string,
  channelName: string,
  userId: string,
): StoredChannelAccessRequestRecord | null {
  const db = getDatabase();
  const row = db.prepare(
    channelAccessRequestSelectSql("workspace_id = ? AND channel_name = ? AND user_id = ? AND status = 'pending'"),
  ).get(workspaceId, channelName, userId) as Record<string, unknown> | undefined;
  return row ? mapChannelAccessRequestRecord(row) : null;
}

function readPendingChannelInvitationSync(
  workspaceId: string,
  channelName: string,
  inviteeUserId?: string,
  inviteeEmail?: string,
): StoredChannelInvitationRecord | null {
  const conditions = ["workspace_id = ?", "channel_name = ?", "status = 'pending'"];
  const params: unknown[] = [workspaceId, channelName];
  const inviteeConditions: string[] = [];
  if (inviteeUserId) {
    inviteeConditions.push("invitee_user_id = ?");
    params.push(inviteeUserId);
  }
  const normalizedEmail = normalizeEmail(inviteeEmail);
  if (normalizedEmail) {
    inviteeConditions.push("invitee_email = ?");
    params.push(normalizedEmail);
  }
  if (inviteeConditions.length === 0) {
    return null;
  }
  conditions.push(`(${inviteeConditions.join(" OR ")})`);

  const row = getDatabase().prepare(
    `${channelInvitationSelectSql(conditions.join(" AND "))}
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
  ).get(...params) as Record<string, unknown> | undefined;
  const record = expireInvitationIfNeeded(row ? mapChannelInvitationRecord(row) : null);
  return record?.status === "pending" ? record : null;
}

function resolveChannelAccessRequestSync(
  requestId: string,
  status: Exclude<ChannelAccessRequestStatus, "pending">,
  resolvedBy?: string,
  workspaceId?: string,
): StoredChannelAccessRequestRecord | null {
  const db = getDatabase();
  const now = new Date().toISOString();
  const result = workspaceId
    ? db.prepare(
      `UPDATE channel_access_request
       SET status = ?, resolved_at = ?, resolved_by = ?
       WHERE id = ? AND workspace_id = ? AND status = 'pending'`,
    ).run(status, now, resolvedBy ?? null, requestId, workspaceId)
    : db.prepare(
      `UPDATE channel_access_request
       SET status = ?, resolved_at = ?, resolved_by = ?
       WHERE id = ? AND status = 'pending'`,
    ).run(status, now, resolvedBy ?? null, requestId);
  if (result.changes === 0) {
    return null;
  }
  return readChannelAccessRequestSync(requestId, workspaceId);
}

function resolveChannelInvitationSync(
  invitationId: string,
  status: Exclude<ChannelInvitationStatus, "pending">,
  respondedBy?: string,
  workspaceId?: string,
): StoredChannelInvitationRecord | null {
  const db = getDatabase();
  const now = new Date().toISOString();
  const result = workspaceId
    ? db.prepare(
      `UPDATE channel_invitation
       SET status = ?, responded_at = ?, responded_by = ?
       WHERE id = ? AND workspace_id = ? AND status = 'pending'`,
    ).run(status, now, respondedBy ?? null, invitationId, workspaceId)
    : db.prepare(
      `UPDATE channel_invitation
       SET status = ?, responded_at = ?, responded_by = ?
       WHERE id = ? AND status = 'pending'`,
    ).run(status, now, respondedBy ?? null, invitationId);
  if (result.changes === 0) {
    return null;
  }
  return readChannelInvitationSync(invitationId, workspaceId);
}

function expireInvitationIfNeeded(record: StoredChannelInvitationRecord | null): StoredChannelInvitationRecord | null {
  if (!record || record.status !== "pending" || !record.expiresAt) {
    return record;
  }
  if (new Date(record.expiresAt).getTime() > Date.now()) {
    return record;
  }
  return expireChannelInvitationSync(record.id, record.workspaceId) ?? { ...record, status: "expired" };
}

function channelAccessRequestSelectSql(whereClause: string): string {
  return `SELECT
    id,
    workspace_id AS workspaceId,
    channel_name AS channelName,
    user_id AS userId,
    status,
    requested_at AS requestedAt,
    resolved_at AS resolvedAt,
    resolved_by AS resolvedBy,
    note
   FROM channel_access_request
   WHERE ${whereClause}`;
}

function channelInvitationSelectSql(whereClause: string): string {
  return `SELECT
    id,
    workspace_id AS workspaceId,
    channel_name AS channelName,
    invitee_user_id AS inviteeUserId,
    invitee_email AS inviteeEmail,
    invited_by AS invitedBy,
    status,
    created_at AS createdAt,
    expires_at AS expiresAt,
    responded_at AS respondedAt,
    responded_by AS respondedBy
   FROM channel_invitation
   WHERE ${whereClause}`;
}

function mapChannelParticipantRecord(row: Record<string, unknown>): StoredChannelParticipantRecord | null {
  if (
    typeof row.id !== "string" ||
    typeof row.workspaceId !== "string" ||
    typeof row.channelName !== "string" ||
    typeof row.userId !== "string" ||
    (row.status !== "active" && row.status !== "removed") ||
    typeof row.joinedAt !== "string" ||
    typeof row.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    channelName: row.channelName,
    userId: row.userId,
    status: row.status,
    addedBy: typeof row.addedBy === "string" ? row.addedBy : undefined,
    joinedAt: row.joinedAt,
    removedAt: typeof row.removedAt === "string" ? row.removedAt : undefined,
    updatedAt: row.updatedAt,
  };
}

function mapChannelAccessRequestRecord(row: Record<string, unknown>): StoredChannelAccessRequestRecord | null {
  if (
    typeof row.id !== "string" ||
    typeof row.workspaceId !== "string" ||
    typeof row.channelName !== "string" ||
    typeof row.userId !== "string" ||
    !isChannelAccessRequestStatus(row.status) ||
    typeof row.requestedAt !== "string"
  ) {
    return null;
  }

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    channelName: row.channelName,
    userId: row.userId,
    status: row.status,
    requestedAt: row.requestedAt,
    resolvedAt: typeof row.resolvedAt === "string" ? row.resolvedAt : undefined,
    resolvedBy: typeof row.resolvedBy === "string" ? row.resolvedBy : undefined,
    note: typeof row.note === "string" ? row.note : undefined,
  };
}

function mapChannelInvitationRecord(row: Record<string, unknown>): StoredChannelInvitationRecord | null {
  if (
    typeof row.id !== "string" ||
    typeof row.workspaceId !== "string" ||
    typeof row.channelName !== "string" ||
    typeof row.invitedBy !== "string" ||
    !isChannelInvitationStatus(row.status) ||
    typeof row.createdAt !== "string"
  ) {
    return null;
  }

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    channelName: row.channelName,
    inviteeUserId: typeof row.inviteeUserId === "string" ? row.inviteeUserId : undefined,
    inviteeEmail: typeof row.inviteeEmail === "string" ? row.inviteeEmail : undefined,
    invitedBy: row.invitedBy,
    status: row.status,
    createdAt: row.createdAt,
    expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : undefined,
    respondedAt: typeof row.respondedAt === "string" ? row.respondedAt : undefined,
    respondedBy: typeof row.respondedBy === "string" ? row.respondedBy : undefined,
  };
}

function isChannelAccessRequestStatus(value: unknown): value is ChannelAccessRequestStatus {
  return value === "pending" || value === "approved" || value === "rejected" || value === "cancelled";
}

function isChannelInvitationStatus(value: unknown): value is ChannelInvitationStatus {
  return value === "pending" || value === "accepted" || value === "rejected" || value === "revoked" || value === "expired";
}

function normalizeEmail(email: string | undefined): string | undefined {
  const normalized = email?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}
