import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  createWorkspaceSync,
  DEFAULT_WORKSPACE_ID,
  ensureWorkspaceStateRecordSync,
  getDaemonWorkspaceExecutionRootDir,
  getDataDirPath,
  getDatabaseConnectionLabel,
  getDatabase,
  withTransaction,
  getLocalDaemonStateDirPath,
  getWorkspaceAttachmentsDirPath as getWorkspaceAttachmentsDirPathFromDb,
  getWorkspaceDataDirPath,
  listStoredWorkspaceSkillsSync,
  resetStoredKnowledgeAssignmentsSync,
  resetStoredWorkspaceSkillsSync,
  replaceStoredAgentSkillAssignmentsSync,
  replaceStoredAttachmentsSync,
  replaceStoredChannelsSync,
  replaceStoredEmployeesSync,
  replaceStoredWorkspaceSkillsSync,
  replaceStoredTasksSync,
  resetWorkspaceExecutionStateSync,
  WORKSPACE_STATE_VERSION,
  readWorkspaceSync,
  readWorkspaceStateVersion,
  writeWorkspaceStateRecordSync,
} from "@agent-space/db";
import {
  createDefaultWorkspaceState,
  type AgentSpaceState,
} from "@agent-space/domain/workspace";
import { ensureChannelDocumentAccessSeeds } from "../documents/access.ts";
import { normalizeWorkspaceState } from "./normalizers.ts";

export function getWorkspaceStateFilePath(): string {
  return getDatabaseConnectionLabel();
}

export function getWorkspaceDatabaseFilePath(): string {
  return getDatabaseConnectionLabel();
}

export function getWorkspaceAttachmentsDirPath(workspaceId = DEFAULT_WORKSPACE_ID): string {
  return getWorkspaceAttachmentsDirPathFromDb(workspaceId);
}

export function ensureWorkspaceStateSync(workspaceId = DEFAULT_WORKSPACE_ID): AgentSpaceState {
  return readWorkspaceStateSnapshotSync(workspaceId);
}

export function readWorkspaceStateSnapshotSync(workspaceId = DEFAULT_WORKSPACE_ID): AgentSpaceState {
  ensureWorkspaceRecordForStateSync(workspaceId);
  const stored = ensureWorkspaceStateRecordSync(createDefaultWorkspaceState(), workspaceId);
  const storedVersion = readWorkspaceStateVersion(stored);
  const snapshot = normalizeWorkspaceState(stored);
  ensureChannelDocumentAccessSeeds(snapshot);

  if (storedVersion !== undefined) {
    Object.defineProperty(snapshot, WORKSPACE_STATE_VERSION, {
      value: storedVersion,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  return snapshot;
}

export function readWorkspaceStateSync(workspaceId = DEFAULT_WORKSPACE_ID): AgentSpaceState {
  return readWorkspaceStateSnapshotSync(workspaceId);
}

export function writeWorkspaceStateSync(
  state: AgentSpaceState,
  workspaceId = DEFAULT_WORKSPACE_ID,
  options?: { skipVersionCheck?: boolean },
): AgentSpaceState {
  ensureWorkspaceRecordForStateSync(workspaceId);
  const normalized = normalizeWorkspaceState(state);
  ensureChannelDocumentAccessSeeds(normalized);
  return withTransaction(getDatabase(), () => {
    const written = writeWorkspaceStateRecordSync(normalized, workspaceId, {
      expectedVersion: readWorkspaceStateVersion(state),
      skipVersionCheck: options?.skipVersionCheck,
    });
    persistCoreWorkspaceStorage(normalized, workspaceId);
    initializeWorkspaceSkillStorageIfEmpty(written, workspaceId);
    return written;
  });
}

function persistCoreWorkspaceStorage(
  state: AgentSpaceState,
  workspaceId = DEFAULT_WORKSPACE_ID,
): void {
  replaceStoredChannelsSync(state.channels, workspaceId);
  replaceStoredEmployeesSync(state.activeEmployees, workspaceId);
  replaceStoredTasksSync(state.tasks, workspaceId);
  replaceStoredAttachmentsSync(state, workspaceId);
}

export function resetWorkspaceStateSync(workspaceId = DEFAULT_WORKSPACE_ID): AgentSpaceState {
  ensureWorkspaceRecordForStateSync(workspaceId);
  resetWorkspaceExecutionStateSync(workspaceId);
  resetStoredWorkspaceSkillsSync(workspaceId);
  resetStoredKnowledgeAssignmentsSync(workspaceId);
  clearWorkspaceStorageArtifactsSync(workspaceId);
  return writeWorkspaceStateSync(createDefaultWorkspaceState(), workspaceId, {
    skipVersionCheck: true,
  });
}

function clearWorkspaceStorageArtifactsSync(workspaceId: string): void {
  rmSync(getWorkspaceDataDirPath(workspaceId), { recursive: true, force: true });
  rmSync(getDaemonWorkspaceExecutionRootDir(getLocalDaemonStateDirPath(), workspaceId), {
    recursive: true,
    force: true,
  });

  if (workspaceId !== DEFAULT_WORKSPACE_ID) {
    return;
  }

  const dataDir = getDataDirPath();
  rmSync(join(dataDir, "attachments"), { recursive: true, force: true });
  rmSync(join(dataDir, "channel-history"), { recursive: true, force: true });
  rmSync(join(dataDir, "daemon-remote-staging"), { recursive: true, force: true });
  rmSync(join(getLocalDaemonStateDirPath(), "workdirs"), { recursive: true, force: true });
}

function ensureWorkspaceRecordForStateSync(workspaceId: string): void {
  if (readWorkspaceSync(workspaceId)) {
    return;
  }
  createWorkspaceSync({
    id: workspaceId,
    slug: workspaceId,
    name: workspaceId === DEFAULT_WORKSPACE_ID ? "Agent Space" : workspaceId,
    createdBy: "system",
  });
}

function initializeWorkspaceSkillStorageIfEmpty(
  state: AgentSpaceState,
  workspaceId = DEFAULT_WORKSPACE_ID,
): void {
  if (listStoredWorkspaceSkillsSync(workspaceId).length > 0) {
    return;
  }
  replaceStoredWorkspaceSkillsSync(state.skills, workspaceId);
  replaceStoredAgentSkillAssignmentsSync(
    state.activeEmployees.map((employee) => ({
      employeeName: employee.name,
      skillIds: employee.skillIds,
    })),
    workspaceId,
  );
}
