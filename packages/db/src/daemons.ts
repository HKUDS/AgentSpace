import { isDaemonProvider } from "@agent-space/domain";
import { getDatabase, withTransaction, randomLikeId, DEFAULT_WORKSPACE_ID } from "./database.ts";
import type { DaemonConnectionRecord, AgentRuntimeRecord, RegisteredDaemonSnapshot, RuntimeRegistrationInput } from "./types.ts";

export function registerDaemonRuntimesSync(input: {
  daemonKey: string;
  deviceName: string;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
  runtimes: RuntimeRegistrationInput[];
}): RegisteredDaemonSnapshot {
  const db = getDatabase();
  const now = new Date().toISOString();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const daemonKey = input.daemonKey.trim();
  const deviceName = input.deviceName.trim();

  if (!daemonKey) {
    throw new Error("daemonKey is required.");
  }
  if (!deviceName) {
    throw new Error("deviceName is required.");
  }
  if (input.runtimes.length === 0) {
    throw new Error("At least one runtime is required.");
  }

  withTransaction(db, () => {
    const existingDaemon = db
      .prepare(
        `SELECT
          id,
          workspace_id AS workspaceId,
          daemon_key AS daemonKey,
          device_name AS deviceName,
          status,
          metadata_json AS metadataJson,
          last_heartbeat_at AS lastHeartbeatAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM daemon_connection
        WHERE daemon_key = ?`,
      )
      .get(daemonKey) as Record<string, unknown> | undefined;
    if (typeof existingDaemon?.workspaceId === "string" && existingDaemon.workspaceId !== workspaceId) {
      throw new Error("daemon.workspace_mismatch");
    }
    const candidateDaemonId =
      existingDaemon && typeof existingDaemon.id === "string" ? existingDaemon.id : `daemon-${randomLikeId()}`;
    const daemonMetadataJson = JSON.stringify(input.metadata ?? {});

    db.prepare(
      `INSERT INTO daemon_connection (
        id,
        workspace_id,
        daemon_key,
        device_name,
        status,
        metadata_json,
        last_heartbeat_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 'online', ?, ?, ?, ?)
      ON CONFLICT(daemon_key) DO UPDATE SET
        device_name = excluded.device_name,
        status = 'online',
        metadata_json = excluded.metadata_json,
        last_heartbeat_at = excluded.last_heartbeat_at,
        updated_at = excluded.updated_at`,
    ).run(
      candidateDaemonId,
      workspaceId,
      daemonKey,
      deviceName,
      daemonMetadataJson,
      now,
      existingDaemon && typeof existingDaemon.createdAt === "string" ? existingDaemon.createdAt : now,
      now,
    );

    const persistedDaemon = db
      .prepare(
        `SELECT id, workspace_id AS workspaceId
         FROM daemon_connection
         WHERE daemon_key = ?`,
      )
      .get(daemonKey) as Record<string, unknown> | undefined;
    if (typeof persistedDaemon?.workspaceId === "string" && persistedDaemon.workspaceId !== workspaceId) {
      throw new Error("daemon.workspace_mismatch");
    }
    if (typeof persistedDaemon?.id !== "string") {
      throw new Error("daemon.registration_read_failed");
    }
    const daemonId = persistedDaemon.id;

    const seenProviders = new Set<string>();
    for (const runtime of input.runtimes) {
      const provider = runtime.provider.trim();
      if (!provider) {
        continue;
      }
      seenProviders.add(provider);

      const existingRuntime = db
        .prepare(
          `SELECT
            id,
            created_at AS createdAt
          FROM agent_runtime
          WHERE workspace_id = ? AND daemon_connection_id = ? AND provider = ?`,
        )
        .get(workspaceId, daemonId, provider) as Record<string, unknown> | undefined;
      const runtimeId =
        existingRuntime && typeof existingRuntime.id === "string"
          ? existingRuntime.id
          : `runtime-${provider}-${randomLikeId()}`;
      const version = runtime.version?.trim() ?? "";
      const deviceInfo = runtime.deviceInfo?.trim() ?? deviceName;
      const metadataJson = JSON.stringify(runtime.metadata ?? {});

      db.prepare(
        `INSERT INTO agent_runtime (
          id,
          workspace_id,
          daemon_connection_id,
          provider,
          name,
          version,
          status,
          device_info,
          metadata_json,
          connected_at,
          last_heartbeat_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'online', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, daemon_connection_id, provider) DO UPDATE SET
          name = excluded.name,
          version = excluded.version,
          status = 'online',
          device_info = excluded.device_info,
          metadata_json = excluded.metadata_json,
          connected_at = COALESCE(agent_runtime.connected_at, excluded.connected_at),
          last_heartbeat_at = excluded.last_heartbeat_at,
          last_error = NULL,
          updated_at = excluded.updated_at`,
      ).run(
        runtimeId,
        workspaceId,
        daemonId,
        provider,
        runtime.name.trim(),
        version,
        deviceInfo,
        metadataJson,
        now,
        now,
        existingRuntime && typeof existingRuntime.createdAt === "string" ? existingRuntime.createdAt : now,
        now,
      );
    }

    const runtimeRows = db
      .prepare(
        `SELECT id, provider
         FROM agent_runtime
         WHERE workspace_id = ? AND daemon_connection_id = ?`,
      )
      .all(workspaceId, daemonId) as Array<Record<string, unknown>>;
    for (const row of runtimeRows) {
      if (typeof row.provider !== "string") {
        continue;
      }
      if (seenProviders.has(row.provider)) {
        continue;
      }
      if (typeof row.id !== "string") {
        continue;
      }

      db.prepare(
        `UPDATE agent_runtime
         SET status = 'offline',
             updated_at = ?
         WHERE id = ?`,
      ).run(now, row.id);
    }
  });

  return readDaemonSnapshotSync(daemonKey);
}

export function heartbeatDaemonSync(daemonKey: string, options?: {
  metadata?: Record<string, unknown>;
  runtimes?: Array<{
    id?: string;
    provider?: string;
    metadata?: Record<string, unknown>;
  }>;
}): RegisteredDaemonSnapshot {
  const db = getDatabase();
  const now = new Date().toISOString();

  withTransaction(db, () => {
    const daemon = readDaemonConnectionRow(db, daemonKey);
    if (!daemon) {
      throw new Error(`Daemon "${daemonKey}" does not exist.`);
    }

    if (options?.metadata) {
      db.prepare(
        `UPDATE daemon_connection
         SET status = 'online',
             metadata_json = ?,
             last_heartbeat_at = ?,
             updated_at = ?
         WHERE daemon_key = ?`,
      ).run(JSON.stringify(options.metadata), now, now, daemonKey);
    } else {
      db.prepare(
        `UPDATE daemon_connection
         SET status = 'online',
             last_heartbeat_at = ?,
             updated_at = ?
         WHERE daemon_key = ?`,
      ).run(now, now, daemonKey);
    }

    db.prepare(
      `UPDATE agent_runtime
       SET status = 'online',
           last_heartbeat_at = ?,
           updated_at = ?
       WHERE daemon_connection_id = ?`,
    ).run(now, now, daemon.id);

    for (const runtime of options?.runtimes ?? []) {
      if (!runtime.metadata || !isRecord(runtime.metadata)) {
        continue;
      }
      const selectors: string[] = ["daemon_connection_id = ?"];
      const params: unknown[] = [daemon.id];
      if (runtime.id?.trim()) {
        selectors.push("id = ?");
        params.push(runtime.id.trim());
      } else if (runtime.provider?.trim()) {
        selectors.push("provider = ?");
        params.push(runtime.provider.trim());
      } else {
        continue;
      }

      const row = db.prepare(
        `SELECT metadata_json AS metadataJson
         FROM agent_runtime
         WHERE ${selectors.join(" AND ")}
         LIMIT 1`,
      ).get(...params) as Record<string, unknown> | undefined;
      const existingMetadata = parseMetadataJson(row?.metadataJson);
      db.prepare(
        `UPDATE agent_runtime
         SET metadata_json = ?,
             updated_at = ?
         WHERE ${selectors.join(" AND ")}`,
      ).run(JSON.stringify({ ...existingMetadata, ...runtime.metadata }), now, ...params);
    }
  });

  return readDaemonSnapshotSync(daemonKey);
}

function parseMetadataJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function markDaemonOfflineSync(daemonKey: string, options?: { lastError?: string }): RegisteredDaemonSnapshot {
  const db = getDatabase();
  const now = new Date().toISOString();

  withTransaction(db, () => {
    const daemon = readDaemonConnectionRow(db, daemonKey);
    if (!daemon) {
      throw new Error(`Daemon "${daemonKey}" does not exist.`);
    }

    db.prepare(
      `UPDATE daemon_connection
       SET status = 'offline',
           updated_at = ?
       WHERE daemon_key = ?`,
    ).run(now, daemonKey);

    db.prepare(
      `UPDATE agent_runtime
       SET status = 'offline',
           last_error = COALESCE(?, last_error),
           updated_at = ?
       WHERE daemon_connection_id = ?`,
    ).run(options?.lastError ?? null, now, daemon.id);
  });

  return readDaemonSnapshotSync(daemonKey);
}

export function readDaemonSnapshotSync(daemonKey: string): RegisteredDaemonSnapshot {
  const db = getDatabase();
  const daemon = readDaemonConnectionRow(db, daemonKey);
  if (!daemon) {
    throw new Error(`Daemon "${daemonKey}" does not exist.`);
  }

  return {
    daemon,
    runtimes: listDaemonRuntimesSync(daemon.id),
  };
}

export function readDaemonConnectionSync(daemonKey: string): DaemonConnectionRecord | null {
  return readDaemonConnectionRow(getDatabase(), daemonKey);
}

export function readAgentRuntimeSync(runtimeId: string): AgentRuntimeRecord | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT
        id,
        workspace_id AS workspaceId,
        daemon_connection_id AS daemonConnectionId,
        provider,
        name,
        version,
        status,
        device_info AS deviceInfo,
        metadata_json AS metadataJson,
        connected_at AS connectedAt,
        last_heartbeat_at AS lastHeartbeatAt,
        last_error AS lastError,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM agent_runtime
      WHERE id = ?`,
    )
    .get(runtimeId) as Record<string, unknown> | undefined;

  return row ? mapAgentRuntimeRecord(row) : null;
}

export function deleteAgentRuntimeSync(input: {
  runtimeId: string;
  workspaceId?: string;
}): AgentRuntimeRecord | null {
  const db = getDatabase();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const runtimeId = input.runtimeId.trim();
  if (!runtimeId) {
    throw new Error("runtimeId is required.");
  }

  const runtime = readAgentRuntimeSync(runtimeId);
  if (!runtime || runtime.workspaceId !== workspaceId) {
    return null;
  }

  const result = db
    .prepare(
      `DELETE FROM agent_runtime
       WHERE id = ? AND workspace_id = ?`,
    )
    .run(runtimeId, workspaceId);

  return result.changes > 0 ? runtime : null;
}

export function listDaemonSnapshotsSync(workspaceId?: string): RegisteredDaemonSnapshot[] {
  const db = getDatabase();
  const hasWorkspaceId = typeof workspaceId === "string";
  const daemons = db
    .prepare(
      `SELECT
        id,
        workspace_id AS workspaceId,
        daemon_key AS daemonKey,
        device_name AS deviceName,
        status,
        metadata_json AS metadataJson,
        last_heartbeat_at AS lastHeartbeatAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM daemon_connection
      ${hasWorkspaceId ? "WHERE workspace_id = ?" : ""}
      ORDER BY created_at ASC`,
    )
    .all(...(hasWorkspaceId ? [workspaceId] : [])) as Array<Record<string, unknown>>;
  const runtimes = db
    .prepare(
      `SELECT
        id,
        workspace_id AS workspaceId,
        daemon_connection_id AS daemonConnectionId,
        provider,
        name,
        version,
        status,
        device_info AS deviceInfo,
        metadata_json AS metadataJson,
        connected_at AS connectedAt,
        last_heartbeat_at AS lastHeartbeatAt,
        last_error AS lastError,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM agent_runtime
      ${hasWorkspaceId ? "WHERE workspace_id = ?" : ""}
      ORDER BY daemon_connection_id ASC, provider ASC`,
    )
    .all(...(hasWorkspaceId ? [workspaceId] : [])) as Array<Record<string, unknown>>;
  const runtimesByDaemonId = new Map<string, AgentRuntimeRecord[]>();
  for (const runtime of runtimes
    .map((row) => mapAgentRuntimeRecord(row))
    .filter((row): row is AgentRuntimeRecord => row !== null)) {
    const daemonConnectionId = runtime.daemonConnectionId;
    if (!daemonConnectionId) {
      continue;
    }
    const next = runtimesByDaemonId.get(daemonConnectionId) ?? [];
    next.push(runtime);
    runtimesByDaemonId.set(daemonConnectionId, next);
  }

  return daemons
    .map((row) => mapDaemonConnectionRecord(row))
    .filter((row): row is DaemonConnectionRecord => row !== null)
    .map((daemon) => ({
      daemon,
      runtimes: runtimesByDaemonId.get(daemon.id) ?? [],
    }));
}

export function pruneOfflineDaemonsSync(maxOfflineAgeMs: number, options?: { workspaceId?: string }): number {
  const db = getDatabase();
  const cutoff = Date.now() - maxOfflineAgeMs;
  const daemons = listDaemonSnapshotsSync(options?.workspaceId);
  let removed = 0;

  withTransaction(db, () => {
    for (const snapshot of daemons) {
      if (snapshot.daemon.status !== "offline") {
        continue;
      }
      const lastTouched = snapshot.daemon.lastHeartbeatAt ?? snapshot.daemon.updatedAt;
      if (new Date(lastTouched).getTime() >= cutoff) {
        continue;
      }

      db.prepare("DELETE FROM agent_runtime WHERE daemon_connection_id = ?").run(snapshot.daemon.id);
      db.prepare("DELETE FROM daemon_connection WHERE id = ?").run(snapshot.daemon.id);
      removed += 1;
    }
  });

  return removed;
}

function readDaemonConnectionRow(db: ReturnType<typeof getDatabase>, daemonKey: string): DaemonConnectionRecord | null {
  const row = db
    .prepare(
      `SELECT
        id,
        workspace_id AS workspaceId,
        daemon_key AS daemonKey,
        device_name AS deviceName,
        status,
        metadata_json AS metadataJson,
        last_heartbeat_at AS lastHeartbeatAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM daemon_connection
      WHERE daemon_key = ?`,
    )
    .get(daemonKey) as Record<string, unknown> | undefined;

  return row ? mapDaemonConnectionRecord(row) : null;
}

function listDaemonRuntimesSync(daemonConnectionId: string): AgentRuntimeRecord[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT
        id,
        workspace_id AS workspaceId,
        daemon_connection_id AS daemonConnectionId,
        provider,
        name,
        version,
        status,
        device_info AS deviceInfo,
        metadata_json AS metadataJson,
        connected_at AS connectedAt,
        last_heartbeat_at AS lastHeartbeatAt,
        last_error AS lastError,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM agent_runtime
      WHERE daemon_connection_id = ?
      ORDER BY provider ASC`,
    )
    .all(daemonConnectionId) as Array<Record<string, unknown>>;

  return rows
    .map((row) => mapAgentRuntimeRecord(row))
    .filter((row): row is AgentRuntimeRecord => row !== null);
}

function mapDaemonConnectionRecord(value: Record<string, unknown>): DaemonConnectionRecord | null {
  if (
    typeof value.id !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.daemonKey !== "string" ||
    typeof value.deviceName !== "string" ||
    (value.status !== "online" && value.status !== "offline") ||
    typeof value.metadataJson !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    workspaceId: value.workspaceId,
    daemonKey: value.daemonKey,
    deviceName: value.deviceName,
    status: value.status,
    metadataJson: value.metadataJson,
    lastHeartbeatAt: typeof value.lastHeartbeatAt === "string" ? value.lastHeartbeatAt : undefined,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function mapAgentRuntimeRecord(value: Record<string, unknown>): AgentRuntimeRecord | null {
  if (
    typeof value.id !== "string" ||
    typeof value.workspaceId !== "string" ||
    !isDaemonProvider(value.provider as string) ||
    typeof value.name !== "string" ||
    typeof value.version !== "string" ||
    (value.status !== "online" && value.status !== "offline") ||
    typeof value.deviceInfo !== "string" ||
    typeof value.metadataJson !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    workspaceId: value.workspaceId,
    daemonConnectionId: typeof value.daemonConnectionId === "string" ? value.daemonConnectionId : undefined,
    provider: value.provider as AgentRuntimeRecord["provider"],
    name: value.name,
    version: value.version,
    status: value.status,
    deviceInfo: value.deviceInfo,
    metadataJson: value.metadataJson,
    connectedAt: typeof value.connectedAt === "string" ? value.connectedAt : undefined,
    lastHeartbeatAt: typeof value.lastHeartbeatAt === "string" ? value.lastHeartbeatAt : undefined,
    lastError: typeof value.lastError === "string" ? value.lastError : undefined,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
