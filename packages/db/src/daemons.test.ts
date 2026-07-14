import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { before, beforeEach } from "node:test";
import {
  heartbeatDaemonSync,
  listDaemonSnapshotsSync,
  markDaemonOfflineSync,
  pruneOfflineDaemonsSync,
  readDaemonSnapshotSync,
  registerDaemonRuntimesSync,
} from "./index.ts";
import { getDatabase } from "./database.ts";

const originalCwd = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-db-daemons-"));
const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

before(() => {
  writeFileSync(join(tempRoot, "Target.md"), "# test\n");
  mkdirSync(join(tempRoot, "data"), { recursive: true });
  process.chdir(tempRoot);
});

beforeEach(() => {
  const db = getDatabase();
  db.exec("DELETE FROM agent_runtime");
  db.exec("DELETE FROM daemon_connection");
  ensureWorkspaceRow("default", "Default Workspace");
  ensureWorkspaceRow("workspace-mars", "Mars Workspace");
});

test("prunes old offline daemon connections within the target workspace", () => {
  registerDaemon("old-default", "default");
  registerDaemon("recent-default", "default");
  registerDaemon("online-default", "default");
  registerDaemon("old-mars", "workspace-mars");

  markDaemonOfflineSync("old-default");
  markDaemonOfflineSync("recent-default");
  markDaemonOfflineSync("old-mars");

  const db = getDatabase();
  const oldHeartbeat = new Date(Date.now() - eightDaysMs()).toISOString();
  const recentHeartbeat = new Date(Date.now() - sixDaysMs()).toISOString();
  db.prepare("UPDATE daemon_connection SET last_heartbeat_at = ? WHERE daemon_key IN (?, ?)")
    .run(oldHeartbeat, "old-default", "old-mars");
  db.prepare("UPDATE daemon_connection SET last_heartbeat_at = ? WHERE daemon_key = ?")
    .run(recentHeartbeat, "recent-default");

  const removed = pruneOfflineDaemonsSync(sevenDaysMs, { workspaceId: "default" });

  assert.equal(removed, 1);
  assert.deepEqual(listDaemonSnapshotsSync("default").map((snapshot) => snapshot.daemon.daemonKey).sort(), [
    "online-default",
    "recent-default",
  ]);
  assert.deepEqual(listDaemonSnapshotsSync("workspace-mars").map((snapshot) => snapshot.daemon.daemonKey), [
    "old-mars",
  ]);
});

test("heartbeat can refresh daemon metadata without changing runtimes", () => {
  registerDaemon("build-box-readiness", "default");

  const snapshot = heartbeatDaemonSync("build-box-readiness", {
    metadata: {
      mode: "remote",
      googleWorkspaceReadiness: {
        executor: "gws",
        gws: { available: true, version: "gws 0.22.5" },
      },
    },
  });
  const metadata = JSON.parse(snapshot.daemon.metadataJson) as {
    googleWorkspaceReadiness?: {
      executor?: string;
      gws?: { available?: boolean; version?: string };
    };
  };

  assert.equal(metadata.googleWorkspaceReadiness?.executor, "gws");
  assert.equal(metadata.googleWorkspaceReadiness?.gws?.available, true);
  assert.equal(snapshot.runtimes.length, 1);
});

test("heartbeat can refresh runtime provider health metadata", () => {
  registerDaemon("openclaw-box", "default");
  const runtime = readDaemonSnapshotSync("openclaw-box").runtimes[0]!;

  const snapshot = heartbeatDaemonSync("openclaw-box", {
    runtimes: [{
      id: runtime.id,
      provider: runtime.provider,
      metadata: {
        providerHealth: {
          status: "broken",
          reason: "OpenClaw auth profile is missing.",
          error: {
            code: "provider.profile_missing",
            category: "profile",
            message: "OpenClaw auth profile is missing.",
          },
        },
      },
    }],
  });
  const metadata = JSON.parse(snapshot.runtimes[0]!.metadataJson) as {
    providerHealth?: { status?: string; error?: { code?: string } };
  };

  assert.equal(metadata.providerHealth?.status, "broken");
  assert.equal(metadata.providerHealth?.error?.code, "provider.profile_missing");
});

test("does not move a daemon connection between workspaces", () => {
  registerDaemon("shared-daemon", "default");

  assert.throws(
    () => registerDaemon("shared-daemon", "workspace-mars"),
    /daemon\.workspace_mismatch/,
  );

  const snapshot = readDaemonSnapshotSync("shared-daemon");
  assert.equal(snapshot.daemon.workspaceId, "default");
  assert.equal(snapshot.runtimes.length, 1);
  assert.deepEqual(listDaemonSnapshotsSync("workspace-mars"), []);
});

test.after(() => {
  process.chdir(originalCwd);
});

function registerDaemon(daemonKey: string, workspaceId: string): void {
  registerDaemonRuntimesSync({
    daemonKey,
    deviceName: "Build Box",
    workspaceId,
    runtimes: [
      {
        provider: "codex",
        name: "Remote Agent · Codex",
        version: "1.0.0",
      },
    ],
  });
}

function ensureWorkspaceRow(workspaceId: string, name: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, display_name, created_at, updated_at)
     VALUES ('daemon-test-user', 'Daemon Test User', ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO workspace (
       id,
       slug,
       name,
       created_by,
       created_at,
       updated_at,
       join_code,
       join_code_updated_at,
       join_code_updated_by
     )
     VALUES (?, ?, ?, 'daemon-test-user', ?, ?, ?, ?, 'daemon-test-user')
     ON CONFLICT(id) DO UPDATE SET
       name = EXCLUDED.name,
       updated_at = EXCLUDED.updated_at`,
  ).run(workspaceId, workspaceId, name, now, now, `join-${workspaceId}`, now);
}

function eightDaysMs(): number {
  return 8 * 24 * 60 * 60 * 1000;
}

function sixDaysMs(): number {
  return 6 * 24 * 60 * 60 * 1000;
}
