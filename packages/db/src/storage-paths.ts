import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_WORKSPACE_ID, getWorkspaceDataDirPath, resolveRepositoryRoot } from "./database.ts";

export const SYSTEM_WORKSPACE_ID = "__system__";

const LOCAL_DAEMON_STATE_DIR = join("data", "daemon");

// Persistent, user-visible workspace assets stay under data/workspaces/{workspaceId}/...
export function getSystemWorkspaceDataDirPath(): string {
  return getWorkspaceDataDirPath(SYSTEM_WORKSPACE_ID);
}

export function getWorkspaceAttachmentsDirPath(workspaceId = DEFAULT_WORKSPACE_ID): string {
  return ensureDirectory(join(getWorkspaceDataDirPath(workspaceId), "attachments"));
}

export function getWorkspaceChannelHistoryDirPath(workspaceId = DEFAULT_WORKSPACE_ID): string {
  return ensureDirectory(join(getWorkspaceDataDirPath(workspaceId), "channel-history"));
}

export function getWorkspaceDaemonRemoteStagingDirPath(
  taskId: string,
  workspaceId = DEFAULT_WORKSPACE_ID,
): string {
  return join(
    getWorkspaceDataDirPath(workspaceId),
    "daemon-remote-staging",
    sanitizeStoragePathSegment(taskId, "task"),
  );
}

export function getLocalDaemonStateDirPath(): string {
  return ensureDirectory(join(resolveRepositoryRoot(), LOCAL_DAEMON_STATE_DIR));
}

// Execution-state workdirs stay under a daemon-owned state root, not workspace assets.
export function getDaemonWorkspaceExecutionRootDir(
  stateDir: string,
  workspaceId = DEFAULT_WORKSPACE_ID,
): string {
  return join(resolve(stateDir), "workspaces", sanitizeStoragePathSegment(workspaceId, DEFAULT_WORKSPACE_ID));
}

export function getDaemonTaskWorkDirPath(
  stateDir: string,
  input: {
    taskId: string;
    workspaceId?: string;
  },
): string {
  return join(
    getDaemonWorkspaceExecutionRootDir(stateDir, input.workspaceId ?? DEFAULT_WORKSPACE_ID),
    "workdirs",
    sanitizeStoragePathSegment(input.taskId, "task"),
  );
}

export function getDaemonChannelWorkDirPath(
  stateDir: string,
  input: {
    threadId: string;
    agentId: string;
    workspaceId?: string;
    runtimeIdSuffix?: string;
  },
): string {
  const segments = [
    getDaemonWorkspaceExecutionRootDir(stateDir, input.workspaceId ?? DEFAULT_WORKSPACE_ID),
    "workdirs",
    "channels",
    sanitizeStoragePathSegment(input.threadId, "channel"),
    sanitizeStoragePathSegment(input.agentId, "agent"),
  ];
  if (input.runtimeIdSuffix) {
    segments.push(sanitizeStoragePathSegment(input.runtimeIdSuffix, "runtime"));
  }
  return join(...segments);
}

export function getDaemonRemoteTaskWorkDirPath(
  stateDir: string,
  input: {
    taskId: string;
    workspaceId?: string;
  },
): string {
  return join(
    getDaemonWorkspaceExecutionRootDir(stateDir, input.workspaceId ?? DEFAULT_WORKSPACE_ID),
    "remote-workdirs",
    sanitizeStoragePathSegment(input.taskId, "task"),
  );
}

export function sanitizeStoragePathSegment(value: string, fallback = "item"): string {
  const normalized = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function ensureDirectory(dirPath: string): string {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}
