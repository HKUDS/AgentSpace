import { basename, join } from "node:path";
import type {
  AgentSpaceState,
  ChannelDocument,
  ChannelDocumentAccessRole,
  ChannelDocumentEditorType,
  ChannelDocumentExternalProvider,
  ChannelDocumentJsonContent,
  ChannelDocumentKind,
  ChannelDocumentStorageMode,
  ChannelDocumentTriggerType,
  ChannelDocumentVersion,
  ExternalSheetOperationRun,
  ExternalSheetOperationRunStatus,
  ExternalSheetOperationType,
  MessageAttachment,
} from "@agent-space/domain/workspace";
import type { ChannelDocumentBlock } from "@agent-space/domain";
import { DEFAULT_WORKSPACE_ID, listWorkspaceMemberUsersSync, readUserSync } from "@agent-space/db";
import { ensureWorkspaceStateSync, writeWorkspaceStateSync } from "../shared/state-io.ts";
import { createOpaqueId, sameValue, resolveAttachmentMediaType, resolveRepositoryRoot, STATE_DIR } from "../shared/helpers.ts";
import {
  pushWorkspaceMessageIfChannel,
  pushWorkspaceMessageToChannel,
  enqueueChannelMentionStepSync,
} from "../shared/messaging.ts";
import { createNotificationsSync, postNotificationChannelMessageSync } from "../notifications/notifications.ts";
import {
  listChannelDocuments,
  listChannelDocumentVersions,
  readChannelDocument,
  createChannelDocument,
  updateChannelDocument,
  renameChannelDocument,
  archiveChannelDocument,
  restoreChannelDocument,
  rollbackChannelDocumentVersion,
} from "./service.ts";
import {
  addChannelDocumentCollaborator,
  assertCanViewChannelDocument,
  assertCanCreateChannelDocument,
  assertCanEditChannelDocument,
  assertCanManageChannelDocument,
  canViewChannelDocument,
  ensureDocumentKeepsAnOwner,
  listChannelDocumentAccesses,
  removeChannelDocumentCollaborator,
  resolveChannelDocumentRole,
  upsertChannelDocumentAccessRole,
} from "./access.ts";
import {
  listChannelDocumentBlocks,
  createChannelDocumentChangeSet,
  createChannelDocumentConflict,
  rebuildChannelDocumentBlocksForVersion,
} from "./collab.ts";
import {
  assertCanAccessWorkspaceAttachment,
  createAttachmentFromChannelDocumentVersion,
  readMarkdownAttachmentContent,
} from "./files.ts";
import { applyChannelDocumentBlockOperations, type ChannelDocumentOperation } from "./operations.ts";
import {
  createChannelDocumentRun,
  findChannelDocumentRunStepByQueuedTaskId,
  listChannelDocumentRunSteps,
  markChannelDocumentRunStepCompleted,
  markChannelDocumentRunStepFailed,
  markChannelDocumentRunStepRunning,
} from "./runs.ts";
import { persistWorkspaceAttachmentFromFileSync } from "../attachments/attachments.ts";

const DOC_COORDINATOR = "系统提示";

export function listChannelDocumentsSync(channelName?: string, workspaceId?: string): ChannelDocument[] {
  return listChannelDocuments(ensureWorkspaceStateSync(workspaceId), channelName);
}

export function listChannelDocumentVersionsSync(documentId: string, workspaceId?: string): ChannelDocumentVersion[] {
  return listChannelDocumentVersions(ensureWorkspaceStateSync(workspaceId), documentId);
}

export function listChannelDocumentBlocksSync(documentId: string, workspaceId?: string): ChannelDocumentBlock[] {
  return listChannelDocumentBlocks(ensureWorkspaceStateSync(workspaceId), documentId);
}

export function readChannelDocumentSync(documentId: string, workspaceId?: string): {
  document: ChannelDocument;
  currentVersion: ChannelDocumentVersion;
  versions: ChannelDocumentVersion[];
} {
  return readChannelDocument(ensureWorkspaceStateSync(workspaceId), documentId);
}

export function canViewChannelDocumentSync(
  documentId: string,
  actorId: string,
  actorType: "human" | "agent",
  workspaceId?: string,
): boolean {
  const state = ensureWorkspaceStateSync(workspaceId);
  const { document } = readChannelDocument(state, documentId);
  return canViewChannelDocument(state, document, actorId, actorType);
}

export function upsertChannelDocumentPresenceSync(input: {
  documentId: string;
  actorId: string;
  actorType: "human" | "agent";
  status: "viewing" | "editing" | "processing";
}, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const { document } = readChannelDocument(state, input.documentId);
  if (input.status === "editing") {
    assertCanEditChannelDocument(state, document, input.actorId, input.actorType);
  } else {
    assertCanViewChannelDocument(state, document, input.actorId, input.actorType);
  }

  const existing = state.channelDocumentPresences.find(
    (presence) =>
      presence.documentId === input.documentId &&
      sameValue(presence.actorId, input.actorId) &&
      presence.actorType === input.actorType,
  );
  const now = new Date().toISOString();
  if (existing) {
    existing.status = input.status;
    existing.updatedAt = now;
  } else {
    state.channelDocumentPresences.unshift({
      id: `channel-doc-presence-${createOpaqueId()}`,
      documentId: input.documentId,
      actorId: input.actorId,
      actorType: input.actorType,
      status: input.status,
      updatedAt: now,
    });
  }

  return writeWorkspaceStateSync(state, workspaceId);
}

export function clearChannelDocumentPresenceSync(input: {
  documentId: string;
  actorId: string;
  actorType: "human" | "agent";
}, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  state.channelDocumentPresences = state.channelDocumentPresences.filter(
    (presence) =>
      !(
        presence.documentId === input.documentId &&
        sameValue(presence.actorId, input.actorId) &&
        presence.actorType === input.actorType
      ),
  );
  return writeWorkspaceStateSync(state, workspaceId);
}

export function recordExternalSheetOperationRunSync(input: {
  channelDocumentId: string;
  externalFileId?: string;
  actorType: ExternalSheetOperationRun["actorType"];
  actorId: string;
  delegatedUserId?: string;
  delegatedUserDisplayName?: string;
  delegatedGoogleEmail?: string;
  credentialDelegationId?: string;
  status?: ExternalSheetOperationRunStatus;
  intent: string;
  operationType: ExternalSheetOperationType;
  rangeA1?: string;
  affectedRows?: number;
  affectedCells?: number;
  requestSummary: string;
  responseSummary?: string;
  resultArtifactPath?: string;
  resultArtifactFileName?: string;
  resultArtifactMediaType?: string;
  resultArtifactSizeBytes?: number;
  resultPreview?: ExternalSheetOperationRun["resultPreview"];
  errorCode?: string;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
}, workspaceId?: string): ExternalSheetOperationRun {
  const state = ensureWorkspaceStateSync(workspaceId);
  const { document } = readChannelDocument(state, input.channelDocumentId);
  if (document.storageMode !== "external" || document.externalProvider !== "google_workspace") {
    throw new Error(`Channel document "${document.title}" is not an external Google Workspace document.`);
  }
  const actorId = input.actorId.trim();
  const intent = input.intent.trim();
  const requestSummary = input.requestSummary.trim();
  if (!actorId) {
    throw new Error("External sheet operation actor id is required.");
  }
  if (!intent) {
    throw new Error("External sheet operation intent is required.");
  }
  if (!requestSummary) {
    throw new Error("External sheet operation request summary is required.");
  }

  const now = new Date().toISOString();
  const run: ExternalSheetOperationRun = {
    id: `external-sheet-run-${createOpaqueId()}`,
    workspaceId: workspaceId ?? DEFAULT_WORKSPACE_ID,
    channelDocumentId: document.id,
    provider: "google_workspace",
    externalFileId: input.externalFileId?.trim() || document.externalFileId || "",
    actorType: input.actorType,
    actorId,
    delegatedUserId: input.delegatedUserId?.trim() || undefined,
    delegatedUserDisplayName: input.delegatedUserDisplayName?.trim() || undefined,
    delegatedGoogleEmail: input.delegatedGoogleEmail?.trim().toLowerCase() || undefined,
    credentialDelegationId: input.credentialDelegationId?.trim() || undefined,
    status: input.status ?? "queued",
    intent,
    operationType: input.operationType,
    rangeA1: input.rangeA1?.trim() || undefined,
    affectedRows: normalizeOptionalCount(input.affectedRows),
    affectedCells: normalizeOptionalCount(input.affectedCells),
    requestSummary,
    responseSummary: input.responseSummary?.trim() || undefined,
    resultArtifactPath: input.resultArtifactPath?.trim() || undefined,
    resultArtifactFileName: input.resultArtifactFileName?.trim() || undefined,
    resultArtifactMediaType: input.resultArtifactMediaType?.trim() || undefined,
    resultArtifactSizeBytes: normalizeOptionalCount(input.resultArtifactSizeBytes),
    resultPreview: input.resultPreview,
    errorCode: input.errorCode?.trim() || undefined,
    errorMessage: input.errorMessage?.trim() || undefined,
    startedAt: input.startedAt ?? now,
    finishedAt: input.finishedAt?.trim() || undefined,
  };
  state.externalSheetOperationRuns ??= [];
  state.externalSheetOperationRuns.unshift(run);
  return writeAndReturnExternalSheetRun(state, run.id, workspaceId);
}

export function updateExternalSheetOperationRunSync(input: {
  runId: string;
  status: ExternalSheetOperationRunStatus;
  rangeA1?: string;
  affectedRows?: number;
  affectedCells?: number;
  responseSummary?: string;
  resultArtifactPath?: string;
  resultArtifactFileName?: string;
  resultArtifactMediaType?: string;
  resultArtifactSizeBytes?: number;
  resultPreview?: ExternalSheetOperationRun["resultPreview"];
  errorCode?: string;
  errorMessage?: string;
  finishedAt?: string;
}, workspaceId?: string): ExternalSheetOperationRun {
  const state = ensureWorkspaceStateSync(workspaceId);
  const run = state.externalSheetOperationRuns.find((item) => item.id === input.runId);
  if (!run) {
    throw new Error(`External sheet operation run "${input.runId}" does not exist.`);
  }
  run.status = input.status;
  if (input.rangeA1 !== undefined) {
    run.rangeA1 = input.rangeA1.trim() || undefined;
  }
  if (input.affectedRows !== undefined) {
    run.affectedRows = normalizeOptionalCount(input.affectedRows);
  }
  if (input.affectedCells !== undefined) {
    run.affectedCells = normalizeOptionalCount(input.affectedCells);
  }
  if (input.responseSummary !== undefined) {
    run.responseSummary = input.responseSummary.trim() || undefined;
  }
  if (input.resultArtifactPath !== undefined) {
    run.resultArtifactPath = input.resultArtifactPath.trim() || undefined;
  }
  if (input.resultArtifactFileName !== undefined) {
    run.resultArtifactFileName = input.resultArtifactFileName.trim() || undefined;
  }
  if (input.resultArtifactMediaType !== undefined) {
    run.resultArtifactMediaType = input.resultArtifactMediaType.trim() || undefined;
  }
  if (input.resultArtifactSizeBytes !== undefined) {
    run.resultArtifactSizeBytes = normalizeOptionalCount(input.resultArtifactSizeBytes);
  }
  if (input.resultPreview !== undefined) {
    run.resultPreview = input.resultPreview;
  }
  if (input.errorCode !== undefined) {
    run.errorCode = input.errorCode.trim() || undefined;
  }
  if (input.errorMessage !== undefined) {
    run.errorMessage = input.errorMessage.trim() || undefined;
  }
  if (input.status === "succeeded" || input.status === "failed") {
    run.finishedAt = input.finishedAt?.trim() || new Date().toISOString();
  }
  return writeAndReturnExternalSheetRun(state, run.id, workspaceId);
}

export function createChannelDocumentSync(input: {
  channelName: string;
  title: string;
  kind?: ChannelDocumentKind;
  storageMode?: ChannelDocumentStorageMode;
  contentJson?: ChannelDocumentJsonContent;
  linkedTableId?: string;
  externalProvider?: ChannelDocumentExternalProvider;
  externalFileId?: string;
  externalUrl?: string;
  externalRevisionId?: string;
  contentMarkdown?: string;
  summary?: string;
  externalSyncStatus?: ChannelDocument["externalSyncStatus"];
  externalMimeType?: string;
  externalUpdatedAt?: string;
  createdBy: string;
  createdByType: ChannelDocumentEditorType;
  triggerType?: ChannelDocumentTriggerType;
  sourceMessageId?: string;
  sourceAttachmentId?: string;
  sourceAttachmentStoredPath?: string;
  sourceTaskQueueId?: string;
}, workspaceId?: string): { state: AgentSpaceState; document: ChannelDocument; version: ChannelDocumentVersion } {
  const state = ensureWorkspaceStateSync(workspaceId);
  if (input.createdByType === "human") {
    ensureLegacyHumanMemberForDisplayName(state, input.createdBy, workspaceId);
  }
  assertCanCreateChannelDocument(state, input.channelName, input.createdBy, input.createdByType);
  const { document, version } = createChannelDocument({
    state,
    channelName: input.channelName,
    title: input.title,
    kind: input.kind,
    storageMode: input.storageMode,
    contentMarkdown: input.contentMarkdown,
    summary: input.summary,
    contentJson: input.contentJson,
    linkedTableId: input.linkedTableId,
    externalProvider: input.externalProvider,
    externalFileId: input.externalFileId,
    externalUrl: input.externalUrl,
    externalRevisionId: input.externalRevisionId,
    externalSyncStatus: input.externalSyncStatus,
    externalMimeType: input.externalMimeType,
    externalUpdatedAt: input.externalUpdatedAt,
    createdBy: input.createdBy,
    createdByType: input.createdByType,
    triggerType: input.triggerType,
    sourceMessageId: input.sourceMessageId,
    sourceAttachmentId: input.sourceAttachmentId,
    sourceAttachmentStoredPath: input.sourceAttachmentStoredPath,
    sourceTaskQueueId: input.sourceTaskQueueId,
  });
  if (document.kind === "markdown") {
    rebuildChannelDocumentBlocksForVersion({
      state,
      document,
      version,
      actorName: document.createdBy,
    });
  }
  state.channelDocumentChangeSets.unshift(
    createChannelDocumentChangeSet({
      documentId: document.id,
      actorId: document.createdBy,
      actorType: input.createdByType,
      baseVersionId: version.id,
      documentVersionId: version.id,
      operationsJson: JSON.stringify([{ op: "replace_document", title: document.title }]),
      status: "applied",
      sourceMessageId: input.sourceMessageId,
      sourceTaskQueueId: input.sourceTaskQueueId,
      createdAt: version.createdAt,
    }),
  );
  state.ledger.unshift({
    title: "Channel document created",
    note: `Created document "${document.title}" in channel ${input.channelName}.`,
    code: "channel_document.created",
    data: {
      channel_name: input.channelName,
      document_id: document.id,
      document_title: document.title,
      created_by: document.createdBy,
    },
  });
  pushWorkspaceMessageIfChannel(state, input.channelName, {
    speaker: DOC_COORDINATOR,
    role: "agent",
    summary: `Document "${document.title}" was created.`,
    code: "channel_document.created_notice",
    data: {
      channel_name: input.channelName,
      document_id: document.id,
      document_title: document.title,
      actor_name: document.createdBy,
    },
  }, workspaceId);

  return {
    state: writeWorkspaceStateSync(state, workspaceId),
    document,
    version,
  };
}

export function createExternalGoogleSheetChannelDocumentSync(input: {
  channelName: string;
  title: string;
  externalFileId: string;
  externalUrl: string;
  externalRevisionId?: string;
  externalMimeType?: string;
  externalUpdatedAt?: string;
  summary?: string;
  createdBy: string;
  createdByType: ChannelDocumentEditorType;
  triggerType?: ChannelDocumentTriggerType;
  sourceTaskQueueId?: string;
  recordMetadataRun?: boolean;
}, workspaceId?: string): { state: AgentSpaceState; document: ChannelDocument; version: ChannelDocumentVersion } {
  const externalFileId = input.externalFileId.trim();
  const externalUrl = input.externalUrl.trim();
  if (!externalFileId) {
    throw new Error("Google Sheet file id is required.");
  }
  if (!externalUrl) {
    throw new Error("Google Sheet URL is required.");
  }

  const result = createChannelDocumentSync({
    channelName: input.channelName,
    title: input.title,
    kind: "sheet",
    storageMode: "external",
    contentMarkdown: [
      `Google Sheet: ${input.title.trim() || externalFileId}`,
      "",
      externalUrl,
    ].join("\n"),
    summary: input.summary?.trim() || "Google Sheets external document",
    externalProvider: "google_workspace",
    externalFileId,
    externalUrl,
    externalRevisionId: input.externalRevisionId?.trim() || undefined,
    externalSyncStatus: "ok",
    externalMimeType: input.externalMimeType?.trim() || "application/vnd.google-apps.spreadsheet",
    externalUpdatedAt: input.externalUpdatedAt?.trim() || new Date().toISOString(),
    createdBy: input.createdBy,
    createdByType: input.createdByType,
    triggerType: input.triggerType ?? "manual",
    sourceTaskQueueId: input.sourceTaskQueueId,
  }, workspaceId);

  if (input.recordMetadataRun !== false) {
    recordExternalSheetOperationRunSync({
      channelDocumentId: result.document.id,
      externalFileId,
      actorType: input.createdByType,
      actorId: input.createdBy,
      status: "succeeded",
      intent: "Link Google Sheet to channel document",
      operationType: "metadata_refresh",
      requestSummary: `Linked Google Sheet ${externalFileId}.`,
      responseSummary: "External sheet metadata stored in AgentSpace.",
      startedAt: result.version.createdAt,
      finishedAt: result.version.createdAt,
    }, workspaceId);
  }

  return {
    ...result,
    state: ensureWorkspaceStateSync(workspaceId),
  };
}

export function createExternalGoogleDocChannelDocumentSync(input: {
  channelName: string;
  title: string;
  externalFileId: string;
  externalUrl: string;
  externalRevisionId?: string;
  externalMimeType?: string;
  externalUpdatedAt?: string;
  summary?: string;
  createdBy: string;
  createdByType: ChannelDocumentEditorType;
}, workspaceId?: string): { state: AgentSpaceState; document: ChannelDocument; version: ChannelDocumentVersion } {
  const externalFileId = input.externalFileId.trim();
  const externalUrl = input.externalUrl.trim();
  if (!externalFileId) {
    throw new Error("Google Doc file id is required.");
  }
  if (!externalUrl) {
    throw new Error("Google Doc URL is required.");
  }

  const result = createChannelDocumentSync({
    channelName: input.channelName,
    title: input.title,
    kind: "document",
    storageMode: "external",
    contentMarkdown: [
      `Google Doc: ${input.title.trim() || externalFileId}`,
      "",
      externalUrl,
    ].join("\n"),
    summary: input.summary?.trim() || "Google Docs external document",
    externalProvider: "google_workspace",
    externalFileId,
    externalUrl,
    externalRevisionId: input.externalRevisionId?.trim() || undefined,
    externalSyncStatus: "ok",
    externalMimeType: input.externalMimeType?.trim() || "application/vnd.google-apps.document",
    externalUpdatedAt: input.externalUpdatedAt?.trim() || new Date().toISOString(),
    createdBy: input.createdBy,
    createdByType: input.createdByType,
    triggerType: "manual",
  }, workspaceId);

  recordExternalSheetOperationRunSync({
    channelDocumentId: result.document.id,
    externalFileId,
    actorType: input.createdByType,
    actorId: input.createdBy,
    status: "succeeded",
    intent: "Link Google Doc to channel document",
    operationType: "metadata_refresh",
    requestSummary: `Linked Google Doc ${externalFileId}.`,
    responseSummary: "External Google Doc metadata stored in AgentSpace.",
    startedAt: result.version.createdAt,
    finishedAt: result.version.createdAt,
  }, workspaceId);

  return {
    ...result,
    state: ensureWorkspaceStateSync(workspaceId),
  };
}

export function updateExternalChannelDocumentMetadataSync(input: {
  documentId: string;
  title?: string;
  externalRevisionId?: string;
  externalSyncStatus?: ChannelDocument["externalSyncStatus"];
  externalMimeType?: string;
  externalUpdatedAt?: string;
  updatedBy?: string;
}, workspaceId?: string): ChannelDocument {
  const state = ensureWorkspaceStateSync(workspaceId);
  const { document } = readChannelDocument(state, input.documentId);
  if (document.storageMode !== "external" || !document.externalProvider) {
    throw new Error(`Channel document "${document.title}" is not an external document.`);
  }

  const now = new Date().toISOString();
  if (input.title !== undefined) {
    const nextTitle = input.title.trim();
    if (nextTitle && nextTitle !== document.title) {
      renameChannelDocument({
        state,
        documentId: document.id,
        nextTitle,
      });
    }
  }
  if (input.externalRevisionId !== undefined) {
    document.externalRevisionId = input.externalRevisionId.trim() || undefined;
  }
  if (input.externalSyncStatus !== undefined) {
    document.externalSyncStatus = input.externalSyncStatus;
  }
  if (input.externalMimeType !== undefined) {
    document.externalMimeType = input.externalMimeType.trim() || undefined;
  }
  if (input.externalUpdatedAt !== undefined) {
    document.externalUpdatedAt = input.externalUpdatedAt.trim() || undefined;
  }
  document.updatedAt = now;
  if (input.updatedBy?.trim()) {
    document.updatedBy = input.updatedBy.trim();
  }

  const persisted = writeWorkspaceStateSync(state, workspaceId);
  return persisted.channelDocuments.find((item) => item.id === document.id) ?? document;
}

export function updateChannelDocumentSync(input: {
  documentId: string;
  title?: string;
  contentMarkdown: string;
  contentJson?: ChannelDocumentJsonContent;
  summary?: string;
  updatedBy: string;
  updatedByType: ChannelDocumentEditorType;
  baseVersionId?: string;
  triggerType?: ChannelDocumentTriggerType;
  sourceMessageId?: string;
  sourceAttachmentId?: string;
  sourceAttachmentStoredPath?: string;
  sourceTaskQueueId?: string;
}, workspaceId?: string): { state: AgentSpaceState; document: ChannelDocument; version: ChannelDocumentVersion } {
  const state = ensureWorkspaceStateSync(workspaceId);
  const existing = readChannelDocument(state, input.documentId);
  assertCanEditChannelDocument(state, existing.document, input.updatedBy, input.updatedByType);
  const previousVersionId = existing.document.currentVersionId;
  if (input.baseVersionId && existing.document.currentVersionId !== input.baseVersionId) {
    const nextTitle = input.title?.trim();
    recordChannelDocumentConflictSync({
      documentId: existing.document.id,
      actorId: input.updatedBy,
      actorType: input.updatedByType,
      baseVersionId: input.baseVersionId,
      operationsJson: JSON.stringify([
        {
          op: "replace_document",
          title: nextTitle || existing.document.title,
          contentMarkdown: input.contentMarkdown,
          contentJson: input.contentJson,
          summary: input.summary,
        },
      ]),
      sourceMessageId: input.sourceMessageId,
      sourceTaskQueueId: input.sourceTaskQueueId,
    }, workspaceId);
    throw new Error(`Document "${existing.document.title}" was updated by someone else. Reload the latest version before saving again.`);
  }

  const nextTitle = input.title?.trim();
  if (nextTitle && nextTitle !== existing.document.title) {
    const { document: renamedDocument, previousTitle } = renameChannelDocument({
      state,
      documentId: existing.document.id,
      nextTitle,
    });
    state.ledger.unshift({
      title: "Channel document renamed",
      note: `Renamed document "${previousTitle}" to "${renamedDocument.title}" in channel ${renamedDocument.channelName}.`,
      code: "channel_document.renamed",
      data: {
        channel_name: renamedDocument.channelName,
        document_id: renamedDocument.id,
        previous_title: previousTitle,
        next_title: renamedDocument.title,
      },
    });
  }

  const { document, version } = updateChannelDocument({
    state,
    documentId: input.documentId,
    contentMarkdown: input.contentMarkdown,
    contentJson: input.contentJson,
    summary: input.summary,
    updatedBy: input.updatedBy,
    updatedByType: input.updatedByType,
    triggerType: input.triggerType,
    sourceMessageId: input.sourceMessageId,
    sourceAttachmentId: input.sourceAttachmentId,
    sourceAttachmentStoredPath: input.sourceAttachmentStoredPath,
    sourceTaskQueueId: input.sourceTaskQueueId,
  });
  if (document.kind === "markdown") {
    rebuildChannelDocumentBlocksForVersion({
      state,
      document,
      version,
      actorName: document.updatedBy,
    });
  }
  state.channelDocumentChangeSets.unshift(
    createChannelDocumentChangeSet({
      documentId: document.id,
      actorId: document.updatedBy,
      actorType: input.updatedByType,
      baseVersionId: previousVersionId,
      documentVersionId: version.id,
      operationsJson: JSON.stringify([{ op: "replace_document", title: document.title }]),
      status: "applied",
      sourceMessageId: input.sourceMessageId,
      sourceTaskQueueId: input.sourceTaskQueueId,
      createdAt: version.createdAt,
    }),
  );
  const summary = version.summary;
  state.ledger.unshift({
    title: "Channel document updated",
    note: `Updated document "${document.title}" in channel ${document.channelName}.`,
    code: "channel_document.updated",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      document_title: document.title,
      updated_by: document.updatedBy,
    },
  });
  pushWorkspaceMessageIfChannel(state, document.channelName, {
    speaker: DOC_COORDINATOR,
    role: "agent",
    summary: `Document "${document.title}" was updated.${summary ? ` Summary: ${summary}` : ""}`.trim(),
    code: "channel_document.updated_notice",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      document_title: document.title,
      actor_name: document.updatedBy,
    },
  }, workspaceId);

  return {
    state: writeWorkspaceStateSync(state, workspaceId),
    document,
    version,
  };
}

export function renameChannelDocumentSync(documentId: string, nextTitle: string, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const { document, previousTitle } = renameChannelDocument({
    state,
    documentId,
    nextTitle,
  });
  state.ledger.unshift({
    title: "Channel document renamed",
    note: `Renamed document "${previousTitle}" to "${document.title}" in channel ${document.channelName}.`,
    code: "channel_document.renamed",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      previous_title: previousTitle,
      next_title: document.title,
    },
  });

  return writeWorkspaceStateSync(state, workspaceId);
}

export function archiveChannelDocumentSync(input: {
  documentId: string;
  archivedBy: string;
  archivedByType: "human" | "agent";
}, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const existing = readChannelDocument(state, input.documentId);
  assertCanManageChannelDocument(state, existing.document, input.archivedBy, input.archivedByType);
  const { document } = archiveChannelDocument({
    state,
    documentId: input.documentId,
  });
  state.ledger.unshift({
    title: "Channel document archived",
    note: `Archived document "${document.title}" in channel ${document.channelName}.`,
    code: "channel_document.archived",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      document_title: document.title,
    },
  });
  pushWorkspaceMessageIfChannel(state, document.channelName, {
    speaker: DOC_COORDINATOR,
    role: "agent",
    summary: `Document "${document.title}" was archived.`,
    code: "channel_document.archived_notice",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      document_title: document.title,
    },
  }, workspaceId);

  return writeWorkspaceStateSync(state, workspaceId);
}

export function restoreChannelDocumentSync(input: {
  documentId: string;
  restoredBy: string;
  restoredByType: "human" | "agent";
}, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const existing = readChannelDocument(state, input.documentId);
  assertCanManageChannelDocument(state, existing.document, input.restoredBy, input.restoredByType);
  const { document } = restoreChannelDocument({
    state,
    documentId: input.documentId,
  });
  state.ledger.unshift({
    title: "Channel document restored",
    note: `Restored document "${document.title}" in channel ${document.channelName}.`,
    code: "channel_document.restored",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      document_title: document.title,
    },
  });
  pushWorkspaceMessageIfChannel(state, document.channelName, {
    speaker: DOC_COORDINATOR,
    role: "agent",
    summary: `Document "${document.title}" was restored.`,
    code: "channel_document.restored_notice",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      document_title: document.title,
    },
  }, workspaceId);

  return writeWorkspaceStateSync(state, workspaceId);
}

export function rollbackChannelDocumentVersionSync(input: {
  documentId: string;
  versionId: string;
  updatedBy: string;
  updatedByType: ChannelDocumentEditorType;
}, workspaceId?: string): { state: AgentSpaceState; document: ChannelDocument; version: ChannelDocumentVersion } {
  const state = ensureWorkspaceStateSync(workspaceId);
  const { document } = readChannelDocument(state, input.documentId);
  assertCanEditChannelDocument(state, document, input.updatedBy, input.updatedByType);
  const { document: updatedDocument, version } = rollbackChannelDocumentVersion({
    state,
    documentId: document.id,
    versionId: input.versionId,
    updatedBy: input.updatedBy,
    updatedByType: input.updatedByType,
  });
  if (updatedDocument.kind === "markdown") {
    rebuildChannelDocumentBlocksForVersion({
      state,
      document: updatedDocument,
      version,
      actorName: updatedDocument.updatedBy,
    });
  }
  state.ledger.unshift({
    title: "Channel document rolled back",
    note: `Rolled back document "${document.title}" in channel ${document.channelName}.`,
    code: "channel_document.rolled_back",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      document_title: document.title,
    },
  });
  pushWorkspaceMessageIfChannel(state, document.channelName, {
    speaker: DOC_COORDINATOR,
    role: "agent",
    summary: `Document "${document.title}" was rolled back.`,
    code: "channel_document.rolled_back_notice",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      document_title: document.title,
      actor_name: input.updatedBy,
    },
  }, workspaceId);

  return { state: writeWorkspaceStateSync(state, workspaceId), document: updatedDocument, version };
}

export function exportChannelDocumentAsAttachmentSync(input: {
  documentId: string;
  exportedBy: string;
}, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const { document, currentVersion } = readChannelDocument(state, input.documentId);
  assertCanEditChannelDocument(state, document, input.exportedBy, "human");
  const attachment = createAttachmentFromChannelDocumentVersion({
    document,
    version: currentVersion,
    persistAttachment: (attachmentInput) => persistWorkspaceAttachmentFromFileSync({
      ...attachmentInput,
      workspaceId,
    }),
    tempDirPath: join(resolveRepositoryRoot(), STATE_DIR, "temp-exports", workspaceId ?? "default"),
  });
  pushWorkspaceMessageIfChannel(state, document.channelName, {
    speaker: DOC_COORDINATOR,
    role: "agent",
    summary: `Document "${document.title}" was exported as an attachment.`,
    code: "channel_document.exported_notice",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      document_title: document.title,
      actor_name: input.exportedBy,
    },
    attachments: [attachment],
  }, workspaceId);
  state.ledger.unshift({
    title: "Channel document exported",
    note: `Exported document "${document.title}" as an attachment in channel ${document.channelName}.`,
    code: "channel_document.exported",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      document_title: document.title,
      actor_name: input.exportedBy,
    },
  });
  return writeWorkspaceStateSync(state, workspaceId);
}

export function createChannelDocumentFromAttachmentSync(input: {
  channelName: string;
  attachmentId: string;
  title?: string;
  createdBy: string;
  createdByType: ChannelDocumentEditorType;
}, workspaceId?: string): { state: AgentSpaceState; document: ChannelDocument; version: ChannelDocumentVersion } {
  const state = ensureWorkspaceStateSync(workspaceId);
  if (input.createdByType === "human") {
    ensureLegacyHumanMemberForDisplayName(state, input.createdBy, workspaceId);
  }
  assertCanCreateChannelDocument(state, input.channelName, input.createdBy, input.createdByType);
  const match = assertCanAccessWorkspaceAttachment(state, input.attachmentId, input.createdBy, input.createdByType);
  if (!isMarkdownAttachment(match.attachment)) {
    throw new Error("Only Markdown attachments can be imported as channel documents.");
  }

  const contentMarkdown = readMarkdownAttachmentContent(match.attachment);
  return createChannelDocumentSync({
    channelName: input.channelName,
    title: input.title?.trim() || basename(match.attachment.fileName, ".md"),
    contentMarkdown,
    summary: "",
    createdBy: input.createdBy,
    createdByType: input.createdByType,
    triggerType: "manual",
    sourceMessageId: match.message?.id,
    sourceAttachmentId: match.attachment.id,
    sourceAttachmentStoredPath: match.attachment.storedPath,
  }, workspaceId);
}

export function listChannelMarkdownAttachmentsSync(channelName: string, workspaceId?: string): Array<{
  id: string;
  fileName: string;
  sourceMessageId?: string;
  sourceSpeaker?: string;
}> {
  const state = ensureWorkspaceStateSync(workspaceId);
  const result: Array<{
    id: string;
    fileName: string;
    sourceMessageId?: string;
    sourceSpeaker?: string;
  }> = [];

  for (const message of state.messages) {
    if (!sameValue(message.channel ?? "", channelName)) {
      continue;
    }
    for (const attachment of message.attachments ?? []) {
      if (!isMarkdownAttachment(attachment)) {
        continue;
      }
      result.push({
        id: attachment.id,
        fileName: attachment.fileName,
        sourceMessageId: message.id,
        sourceSpeaker: message.speaker,
      });
    }
  }

  return result.filter(
    (item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index,
  );
}

function isMarkdownAttachment(attachment: MessageAttachment): boolean {
  return resolveAttachmentMediaType(attachment.fileName, attachment.mediaType) === "text/markdown";
}

function normalizeOptionalCount(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.round(value));
}

function writeAndReturnExternalSheetRun(
  state: AgentSpaceState,
  runId: string,
  workspaceId?: string,
): ExternalSheetOperationRun {
  const persisted = writeWorkspaceStateSync(state, workspaceId);
  const run = persisted.externalSheetOperationRuns.find((item) => item.id === runId);
  if (!run) {
    throw new Error(`External sheet operation run "${runId}" could not be read back.`);
  }
  return run;
}

export function listChannelDocumentAccessesSync(documentId: string, workspaceId?: string): AgentSpaceState["channelDocumentAccesses"] {
  const state = ensureWorkspaceStateSync(workspaceId);
  return listChannelDocumentAccesses(state, documentId);
}

export function updateChannelDocumentAccessRoleSync(input: {
  documentId: string;
  actorId: string;
  actorType: "human" | "agent";
  role: ChannelDocumentAccessRole;
  changedBy: string;
  changedByType: "human" | "agent";
}, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const { document } = readChannelDocument(state, input.documentId);
  assertCanManageChannelDocument(state, document, input.changedBy, input.changedByType);
  const previousRole = resolveChannelDocumentRole(state, input.documentId, input.actorId, input.actorType);
  const previousRoleLabel = previousRole ?? "none";
  ensureDocumentKeepsAnOwner(state, input.documentId, input.actorId, input.actorType, input.role);
  if (previousRole === input.role) {
    return state;
  }
  if (input.actorType === "human") {
    ensureLegacyHumanMemberForDisplayName(state, input.actorId, workspaceId);
  }
  upsertChannelDocumentAccessRole(state, {
    documentId: input.documentId,
    actorId: input.actorId,
    actorType: input.actorType,
    role: input.role,
  });
  state.ledger.unshift({
    title: "Channel document access updated",
    note: `Updated ${input.actorId} to ${input.role} on document "${document.title}" in channel ${document.channelName}.`,
    code: "channel_document.access_updated",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      document_title: document.title,
      collaborator_name: input.actorId,
      previous_role: previousRoleLabel,
      next_role: input.role,
      actor_name: input.changedBy,
    },
  });
  createChannelDocumentCollaboratorNotifications({
    workspaceId: workspaceId ?? DEFAULT_WORKSPACE_ID,
    document,
    recipientId: input.actorId,
    recipientType: input.actorType,
    actorId: input.changedBy,
    actorType: input.changedByType,
    notificationType: "channel_document.access_updated",
    title: "Document collaborator role updated",
    body: `Your role on "${document.title}" changed from ${previousRoleLabel} to ${input.role}.`,
    severity: "info",
    dedupeKey: `channel_document.access_updated:${workspaceId ?? DEFAULT_WORKSPACE_ID}:${document.id}:${input.actorType}:${input.actorId}:${input.role}`,
    metadata: {
      previousRole: previousRoleLabel,
      nextRole: input.role,
    },
  });
  const persisted = writeWorkspaceStateSync(state, workspaceId);
  postNotificationChannelMessageSync({
    workspaceId: workspaceId ?? DEFAULT_WORKSPACE_ID,
    channelName: document.channelName,
    summary: `Document "${document.title}" collaborator ${input.actorId} role changed from ${previousRoleLabel} to ${input.role}.`,
    code: "channel_document.access_updated_notice",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      document_title: document.title,
      collaborator_name: input.actorId,
      previous_role: previousRoleLabel,
      next_role: input.role,
      actor_name: input.changedBy,
    },
  });
  return ensureWorkspaceStateSync(workspaceId) ?? persisted;
}

export function addChannelDocumentCollaboratorSync(input: {
  documentId: string;
  actorId: string;
  actorType: "human" | "agent";
  role: ChannelDocumentAccessRole;
  addedBy: string;
  addedByType: "human" | "agent";
}, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const { document } = readChannelDocument(state, input.documentId);
  assertCanManageChannelDocument(state, document, input.addedBy, input.addedByType);
  if (input.actorType === "human") {
    ensureLegacyHumanMemberForDisplayName(state, input.actorId, workspaceId);
  }
  addChannelDocumentCollaborator(state, {
    documentId: input.documentId,
    actorId: input.actorId,
    actorType: input.actorType,
    role: input.role,
  });
  state.ledger.unshift({
    title: "Channel document collaborator added",
    note: `Added ${input.actorId} as ${input.role} to document "${document.title}" in channel ${document.channelName}.`,
    code: "channel_document.collaborator_added",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      document_title: document.title,
      collaborator_name: input.actorId,
      role: input.role,
      actor_name: input.addedBy,
    },
  });
  createChannelDocumentCollaboratorNotifications({
    workspaceId: workspaceId ?? DEFAULT_WORKSPACE_ID,
    document,
    recipientId: input.actorId,
    recipientType: input.actorType,
    actorId: input.addedBy,
    actorType: input.addedByType,
    notificationType: "channel_document.collaborator_added",
    title: "Document shared with you",
    body: `You were added as ${input.role} on "${document.title}".`,
    severity: "success",
    dedupeKey: `channel_document.collaborator_added:${workspaceId ?? DEFAULT_WORKSPACE_ID}:${document.id}:${input.actorType}:${input.actorId}:${input.role}`,
    metadata: {
      role: input.role,
    },
  });
  const persisted = writeWorkspaceStateSync(state, workspaceId);
  postNotificationChannelMessageSync({
    workspaceId: workspaceId ?? DEFAULT_WORKSPACE_ID,
    channelName: document.channelName,
    summary: `Document "${document.title}" collaborator ${input.actorId} was added as ${input.role}.`,
    code: "channel_document.collaborator_added_notice",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      document_title: document.title,
      collaborator_name: input.actorId,
      role: input.role,
      actor_name: input.addedBy,
    },
  });
  return ensureWorkspaceStateSync(workspaceId) ?? persisted;
}

function ensureLegacyHumanMemberForDisplayName(
  state: AgentSpaceState,
  displayName: string,
  workspaceId?: string,
): void {
  const trimmedDisplayName = displayName.trim();
  if (!trimmedDisplayName || state.humanMembers.some((member) => sameValue(member.name, trimmedDisplayName))) {
    return;
  }

  const workspaceMember = listWorkspaceMemberUsersSync(workspaceId ?? DEFAULT_WORKSPACE_ID)
    .find((member) => sameValue(member.displayName, trimmedDisplayName));
  if (!workspaceMember) {
    return;
  }

  state.humanMembers.push({
    name: workspaceMember.displayName,
    role: formatWorkspaceRole(workspaceMember.role),
  });
}

function formatWorkspaceRole(role: string): string {
  if (role === "owner") {
    return "Owner";
  }
  if (role === "admin") {
    return "Admin";
  }
  return "Member";
}

function createChannelDocumentCollaboratorNotifications(input: {
  workspaceId: string;
  document: ChannelDocument;
  recipientId: string;
  recipientType: "human" | "agent";
  actorId: string;
  actorType: "human" | "agent";
  notificationType: string;
  title: string;
  body: string;
  severity: "info" | "success" | "warning" | "critical";
  dedupeKey: string;
  metadata?: Record<string, unknown>;
}): void {
  const actorUser = input.actorType === "human" ? findWorkspaceUserByDisplayName(input.workspaceId, input.actorId) : null;
  const notifications = [];
  if (input.recipientType === "human") {
    const recipient = findWorkspaceUserByDisplayName(input.workspaceId, input.recipientId);
    if (recipient) {
      notifications.push({
        workspaceId: input.workspaceId,
        recipientType: "human" as const,
        recipientId: recipient.id,
        actorType: input.actorType,
        actorId: actorUser?.id ?? input.actorId,
        type: input.notificationType,
        resourceType: "document" as const,
        resourceId: input.document.id,
        channelName: input.document.channelName,
        title: input.title,
        body: input.body,
        actionHref: `/im?focus=${encodeURIComponent(`channel:${input.document.channelName}`)}`,
        severity: input.severity,
        dedupeKey: `${input.dedupeKey}:${recipient.id}`,
        metadata: {
          documentTitle: input.document.title,
          collaboratorName: input.recipientId,
          actorName: input.actorId,
          ...input.metadata,
        },
      });
    }
  } else {
    notifications.push({
      workspaceId: input.workspaceId,
      recipientType: "agent" as const,
      recipientId: input.recipientId,
      actorType: input.actorType,
      actorId: actorUser?.id ?? input.actorId,
      type: input.notificationType,
      resourceType: "document" as const,
      resourceId: input.document.id,
      channelName: input.document.channelName,
      title: input.title,
      body: input.body.replace(/^Your role/, `${input.recipientId}'s role`).replace(/^You were/, `${input.recipientId} was`),
      actionHref: `/im?focus=${encodeURIComponent(`channel:${input.document.channelName}`)}`,
      severity: input.severity,
      dedupeKey: input.dedupeKey,
      metadata: {
        documentTitle: input.document.title,
        collaboratorName: input.recipientId,
        actorName: input.actorId,
        ...input.metadata,
      },
    });
    const owner = resolveAgentOwnerUser(input.workspaceId, input.recipientId);
    if (owner) {
      notifications.push({
        workspaceId: input.workspaceId,
        recipientType: "human" as const,
        recipientId: owner.id,
        actorType: input.actorType,
        actorId: actorUser?.id ?? input.actorId,
        type: `${input.notificationType}.owner`,
        resourceType: "document" as const,
        resourceId: input.document.id,
        channelName: input.document.channelName,
        title: input.title,
        body: input.body.replace(/^Your role/, `${input.recipientId}'s role`).replace(/^You were/, `${input.recipientId} was`),
        actionHref: `/im?focus=${encodeURIComponent(`channel:${input.document.channelName}`)}`,
        severity: input.severity,
        dedupeKey: `${input.dedupeKey}:owner:${owner.id}`,
        metadata: {
          documentTitle: input.document.title,
          collaboratorName: input.recipientId,
          actorName: input.actorId,
          ...input.metadata,
        },
      });
    }
  }
  createNotificationsSync(notifications);
}

function findWorkspaceUserByDisplayName(workspaceId: string, displayName: string): { id: string; displayName: string } | null {
  const normalized = displayName.trim();
  if (!normalized) {
    return null;
  }
  for (const member of listWorkspaceMemberUsersSync(workspaceId)) {
    if (sameValue(member.displayName, normalized)) {
      return { id: member.userId, displayName: member.displayName };
    }
  }
  return null;
}

function resolveAgentOwnerUser(workspaceId: string, agentName: string): { id: string; displayName: string } | null {
  const employee = ensureWorkspaceStateSync(workspaceId).activeEmployees.find((item) => sameValue(item.name, agentName));
  if (!employee?.ownerUserId) {
    return null;
  }
  const user = readUserSync(employee.ownerUserId);
  return user ? { id: user.id, displayName: user.displayName } : null;
}

export function removeChannelDocumentCollaboratorSync(input: {
  documentId: string;
  actorId: string;
  actorType: "human" | "agent";
  removedBy: string;
  removedByType: "human" | "agent";
}, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const { document } = readChannelDocument(state, input.documentId);
  assertCanManageChannelDocument(state, document, input.removedBy, input.removedByType);
  const existingRole = resolveChannelDocumentRole(state, input.documentId, input.actorId, input.actorType);
  const existingRoleLabel = existingRole ?? "none";
  ensureDocumentKeepsAnOwner(state, input.documentId, input.actorId, input.actorType, "viewer");
  removeChannelDocumentCollaborator(state, {
    documentId: input.documentId,
    actorId: input.actorId,
    actorType: input.actorType,
  });
  clearDocumentPresence(state, {
    documentId: input.documentId,
    actorId: input.actorId,
    actorType: input.actorType,
  });
  state.ledger.unshift({
    title: "Channel document collaborator removed",
    note: `Removed ${input.actorId} from document "${document.title}" in channel ${document.channelName}.`,
    code: "channel_document.collaborator_removed",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      document_title: document.title,
      collaborator_name: input.actorId,
      previous_role: existingRoleLabel,
      actor_name: input.removedBy,
    },
  });
  pushWorkspaceMessageToChannel(state, document.channelName, {
    speaker: DOC_COORDINATOR,
    role: "agent",
    summary: `Document "${document.title}" collaborator ${input.actorId} was removed.`,
    code: "channel_document.collaborator_removed_notice",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      document_title: document.title,
      collaborator_name: input.actorId,
      previous_role: existingRoleLabel,
      actor_name: input.removedBy,
    },
  }, workspaceId);
  return writeWorkspaceStateSync(state, workspaceId);
}

export function recordChannelDocumentConflictSync(input: {
  documentId: string;
  actorId: string;
  actorType: "human" | "agent";
  baseVersionId: string;
  operationsJson: string;
  sourceMessageId?: string;
  sourceTaskQueueId?: string;
}, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const document = state.channelDocuments.find((item) => item.id === input.documentId);
  if (!document) {
    throw new Error(`Channel document "${input.documentId}" does not exist.`);
  }

  const currentVersionId = document.currentVersionId;
  const existingBlockId = state.channelDocumentBlocks.find((block) => block.documentId === document.id)?.id ?? "document-root";
  const leftChangeSetId =
    state.channelDocumentChangeSets.find(
      (changeSet) => changeSet.documentId === document.id && changeSet.baseVersionId === currentVersionId,
    )?.id ?? `channel-doc-changeset-${createOpaqueId()}`;
  const rightChangeSet = createChannelDocumentChangeSet({
    documentId: document.id,
    actorId: input.actorId,
    actorType: input.actorType,
    baseVersionId: input.baseVersionId,
    operationsJson: input.operationsJson,
    status: "conflicted",
    sourceMessageId: input.sourceMessageId,
    sourceTaskQueueId: input.sourceTaskQueueId,
  });
  state.channelDocumentChangeSets.unshift(rightChangeSet);
  state.channelDocumentConflicts.unshift(
    createChannelDocumentConflict({
      documentId: document.id,
      blockId: existingBlockId,
      leftChangeSetId,
      rightChangeSetId: rightChangeSet.id,
    }),
  );
  state.ledger.unshift({
    title: "Channel document conflict",
    note: `Conflict detected while updating document "${document.title}" in channel ${document.channelName}.`,
    code: "channel_document.conflict",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      document_title: document.title,
      actor_id: input.actorId,
    },
  });
  pushWorkspaceMessageToChannel(state, document.channelName, {
    speaker: DOC_COORDINATOR,
    role: "agent",
    summary: `Document "${document.title}" update conflicted with a newer version.`,
    code: "channel_document.conflict_notice",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      document_title: document.title,
      actor_name: input.actorId,
    },
    status: "error",
  }, workspaceId);

  return writeWorkspaceStateSync(state, workspaceId);
}

export function resolveChannelDocumentConflictSync(input: {
  conflictId: string;
  resolvedBy: string;
  resolvedByType: "human" | "agent";
}, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const conflict = state.channelDocumentConflicts.find((item) => item.id === input.conflictId);
  if (!conflict) {
    throw new Error(`Channel document conflict "${input.conflictId}" does not exist.`);
  }
  if (conflict.status === "resolved") {
    return state;
  }

  conflict.status = "resolved";
  const document = state.channelDocuments.find((item) => item.id === conflict.documentId);
  if (!document) {
    return writeWorkspaceStateSync(state, workspaceId);
  }
  assertCanEditChannelDocument(state, document, input.resolvedBy, input.resolvedByType);

  state.ledger.unshift({
    title: "Channel document conflict resolved",
    note: `Conflict on document "${document.title}" in channel ${document.channelName} was marked as resolved.`,
    code: "channel_document.conflict_resolved",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      document_title: document.title,
      actor_name: input.resolvedBy,
    },
  });
  pushWorkspaceMessageToChannel(state, document.channelName, {
    speaker: DOC_COORDINATOR,
    role: "agent",
    summary: `Document "${document.title}" conflict was marked as resolved.`,
    code: "channel_document.conflict_resolved_notice",
    data: {
      channel_name: document.channelName,
      document_id: document.id,
      document_title: document.title,
      actor_name: input.resolvedBy,
    },
  }, workspaceId);

  return writeWorkspaceStateSync(state, workspaceId);
}

export function retryChannelDocumentConflictSync(input: {
  conflictId: string;
  retriedBy: string;
  retriedByType: "human" | "agent";
}, workspaceId?: string): { state: AgentSpaceState; document: ChannelDocument; version: ChannelDocumentVersion } {
  const state = ensureWorkspaceStateSync(workspaceId);
  const conflict = state.channelDocumentConflicts.find((item) => item.id === input.conflictId);
  if (!conflict) {
    throw new Error(`Channel document conflict "${input.conflictId}" does not exist.`);
  }
  if (conflict.status !== "open") {
    throw new Error("Only open conflicts can be retried.");
  }

  const document = state.channelDocuments.find((item) => item.id === conflict.documentId);
  if (!document) {
    throw new Error(`Channel document "${conflict.documentId}" does not exist.`);
  }
  assertCanEditChannelDocument(state, document, input.retriedBy, input.retriedByType);
  const changeSet = state.channelDocumentChangeSets.find((item) => item.id === conflict.rightChangeSetId);
  if (!changeSet) {
    throw new Error(`Channel document change set "${conflict.rightChangeSetId}" does not exist.`);
  }

  const replacementPayload = parseRetryableDocumentReplacement(changeSet.operationsJson);
  const blockRetryOperations = replacementPayload ? null : buildRetriedBlockOperations(state, document.id, changeSet.operationsJson);
  if (!replacementPayload && !blockRetryOperations) {
    throw new Error("This conflict cannot be retried automatically yet.");
  }

  const retryResult = replacementPayload
    ? updateChannelDocumentSync({
        documentId: document.id,
        title: replacementPayload.title,
        contentMarkdown: replacementPayload.contentMarkdown,
        contentJson: replacementPayload.contentJson,
        summary: replacementPayload.summary,
        updatedBy: input.retriedBy,
        updatedByType: "human",
        baseVersionId: document.currentVersionId,
        triggerType: "manual",
      }, workspaceId)
    : (() => {
        const result = applyChannelDocumentBlockOperations({
          state,
          document,
          baseVersionId: document.currentVersionId,
          actorId: input.retriedBy,
          actorType: "human",
          operations: blockRetryOperations!,
          sourceMessageId: changeSet.sourceMessageId,
        sourceTaskQueueId: changeSet.sourceTaskQueueId,
      });
      if (!result.document || !result.version || result.conflictCount > 0) {
        throw new Error("This conflicted block update still cannot be safely reapplied.");
      }
      return {
        state: result.state,
        document: result.document,
        version: result.version,
      };
      })();

  const updatedDocument = retryResult.document;
  const version = retryResult.version;
  const nextState = replacementPayload ? ensureWorkspaceStateSync(workspaceId) : retryResult.state;
  let resolvedCount = 0;
  for (const item of nextState.channelDocumentConflicts) {
    if (item.rightChangeSetId === changeSet.id && item.status === "open") {
      item.status = "resolved";
      resolvedCount += 1;
    }
  }

  nextState.ledger.unshift({
    title: "Channel document conflict retried",
    note: `Retried conflicted update for document "${updatedDocument.title}" in channel ${updatedDocument.channelName}.`,
    code: "channel_document.conflict_retried",
    data: {
      channel_name: updatedDocument.channelName,
      document_id: updatedDocument.id,
      document_title: updatedDocument.title,
      actor_name: input.retriedBy,
      resolved_conflict_count: String(resolvedCount),
    },
  });
  pushWorkspaceMessageToChannel(nextState, updatedDocument.channelName, {
    speaker: DOC_COORDINATOR,
    role: "agent",
    summary: `Document "${updatedDocument.title}" conflicted change was reapplied on top of the latest version.`,
    code: "channel_document.conflict_retried_notice",
    data: {
      channel_name: updatedDocument.channelName,
      document_id: updatedDocument.id,
      document_title: updatedDocument.title,
      actor_name: input.retriedBy,
    },
  }, workspaceId);

  return {
    state: writeWorkspaceStateSync(nextState, workspaceId),
    document: updatedDocument,
    version,
  };
}

export function markChannelDocumentRunStepRunningSync(queuedTaskId: string, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const step = findChannelDocumentRunStepByQueuedTaskId(state, queuedTaskId);
  if (!step) {
    return state;
  }

  markChannelDocumentRunStepRunning(state, step.id);
  if (step.documentId) {
    upsertDocumentPresence(state, {
      documentId: step.documentId,
      actorId: step.agentLabel,
      actorType: "agent",
      status: "processing",
    });
  }
  return writeWorkspaceStateSync(state, workspaceId);
}

export function completeChannelDocumentRunStepSync(input: {
  queuedTaskId: string;
  documentUpdates?: Array<{ documentId: string; documentVersionId: string }>;
  warningText?: string;
}, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const step = findChannelDocumentRunStepByQueuedTaskId(state, input.queuedTaskId);
  if (!step) {
    return state;
  }

  const derivedWarningText =
    input.warningText?.trim() ||
    (step.handoffKind === "document" && (input.documentUpdates?.length ?? 0) === 0
      ? `No new document version was written by ${step.agentLabel}.`
      : undefined);
  const { readySteps } = markChannelDocumentRunStepCompleted(state, {
    stepId: step.id,
    documentUpdates: input.documentUpdates,
    warningText: derivedWarningText,
  });

  const run = state.channelDocumentRuns.find((item) => item.id === step.runId);
  if (run) {
    const sourceMessage = state.messages.find((message) => message.id === run.sourceMessageId);
    const attachments = sourceMessage?.attachments;
    const runSteps = listChannelDocumentRunSteps(state, run.id);
    pushWorkspaceMessageToChannel(state, run.channelName, {
      speaker: DOC_COORDINATOR,
      role: "agent",
      summary:
        step.status === "completed_with_warning"
          ? `Workflow step finished by ${step.agentLabel} with warning: ${step.lastWarning ?? "warning"}.`
          : `Workflow step completed by ${step.agentLabel}.`,
      code:
        step.status === "completed_with_warning"
          ? "channel_document.step_completed_without_update_notice"
          : "channel_document.step_completed_notice",
      data: {
        channel_name: run.channelName,
        run_id: run.id,
        agent_label: step.agentLabel,
      },
      status: step.status === "completed_with_warning" ? "error" : "completed",
    }, workspaceId);
    for (const readyStep of readySteps) {
      const handoffDocumentId = runSteps
        .filter((item) => readyStep.dependsOnStepIds.includes(item.id) && item.documentId)
        .map((item) => item.documentId!)
        .filter((value, index, all) => all.indexOf(value) === index);
      const handoffDocumentVersionId = runSteps
        .filter((item) => readyStep.dependsOnStepIds.includes(item.id) && item.documentVersionId)
        .map((item) => item.documentVersionId!)
        .filter((value, index, all) => all.indexOf(value) === index);
      if (readyStep.handoffKind === "document" && handoffDocumentId.length === 1) {
        readyStep.documentId = handoffDocumentId[0];
      }
      if (readyStep.handoffKind === "document" && handoffDocumentVersionId.length === 1) {
        readyStep.documentVersionId = handoffDocumentVersionId[0];
      }
      enqueueChannelMentionStepSync(state, {
        channelName: run.channelName,
        sourceMessage,
        fullMessage: run.sourceSummary,
        attachments,
        step: readyStep,
        mentionedAgentIds: runSteps.map((item) => item.agentId),
        mentionedAgentLabels: runSteps.map((item) => item.agentLabel),
        handoffDocumentIds: handoffDocumentId,
        handoffDocumentVersionIds: handoffDocumentVersionId,
        workspaceId,
      });
      pushWorkspaceMessageToChannel(state, run.channelName, {
        speaker: DOC_COORDINATOR,
        role: "agent",
        summary: `Workflow moved to ${readyStep.agentLabel}: ${readyStep.instruction}`,
        code: "channel_document.step_queued_notice",
        data: {
          channel_name: run.channelName,
          run_id: run.id,
          agent_label: readyStep.agentLabel,
        },
      }, workspaceId);
    }

    const latestRun = state.channelDocumentRuns.find((item) => item.id === run.id);
    if (latestRun?.status === "completed" || latestRun?.status === "completed_with_warning") {
      const hasDocumentStepWithoutNewVersion = runSteps.some(
        (item) =>
          item.handoffKind === "document" &&
          (item.status === "completed" || item.status === "completed_with_warning") &&
          !item.documentVersionId,
      );
      pushWorkspaceMessageToChannel(state, run.channelName, {
        speaker: DOC_COORDINATOR,
        role: "agent",
        summary: latestRun.status === "completed_with_warning" || hasDocumentStepWithoutNewVersion
          ? "Document workflow finished, but some document steps did not write a new version."
          : "Document workflow completed.",
        code: latestRun.status === "completed_with_warning" || hasDocumentStepWithoutNewVersion
          ? "channel_document.run_completed_with_warning_notice"
          : "channel_document.run_completed_notice",
        data: {
          channel_name: run.channelName,
          run_id: run.id,
        },
        status: latestRun.status === "completed_with_warning" || hasDocumentStepWithoutNewVersion ? "error" : "completed",
      }, workspaceId);
    }
  }

  if (step.documentId) {
    clearDocumentPresence(state, {
      documentId: step.documentId,
      actorId: step.agentLabel,
      actorType: "agent",
    });
  }

  return writeWorkspaceStateSync(state, workspaceId);
}

export function failChannelDocumentRunStepSync(input: {
  queuedTaskId: string;
  errorText: string;
}, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const step = findChannelDocumentRunStepByQueuedTaskId(state, input.queuedTaskId);
  if (!step) {
    return state;
  }

  const { run } = markChannelDocumentRunStepFailed(state, step.id, input.errorText);
  if (step.documentId) {
    clearDocumentPresence(state, {
      documentId: step.documentId,
      actorId: step.agentLabel,
      actorType: "agent",
    });
  }
  pushWorkspaceMessageToChannel(state, run.channelName, {
    speaker: DOC_COORDINATOR,
    role: "agent",
    summary: `Document workflow failed at ${step.agentLabel}: ${input.errorText}`,
    code: "channel_document.run_failed_notice",
    data: {
      channel_name: run.channelName,
      run_id: run.id,
      agent_label: step.agentLabel,
    },
    status: "error",
  }, workspaceId);
  return writeWorkspaceStateSync(state, workspaceId);
}

function upsertDocumentPresence(
  state: AgentSpaceState,
  input: {
    documentId: string;
    actorId: string;
    actorType: "human" | "agent";
    status: "viewing" | "editing" | "processing";
  },
): void {
  const existing = state.channelDocumentPresences.find(
    (presence) =>
      presence.documentId === input.documentId &&
      sameValue(presence.actorId, input.actorId) &&
      presence.actorType === input.actorType,
  );
  const now = new Date().toISOString();
  if (existing) {
    existing.status = input.status;
    existing.updatedAt = now;
    return;
  }
  state.channelDocumentPresences.unshift({
    id: `channel-doc-presence-${createOpaqueId()}`,
    documentId: input.documentId,
    actorId: input.actorId,
    actorType: input.actorType,
    status: input.status,
    updatedAt: now,
  });
}

function clearDocumentPresence(
  state: AgentSpaceState,
  input: {
    documentId: string;
    actorId: string;
    actorType: "human" | "agent";
  },
): void {
  state.channelDocumentPresences = state.channelDocumentPresences.filter(
    (presence) =>
      !(
        presence.documentId === input.documentId &&
        sameValue(presence.actorId, input.actorId) &&
        presence.actorType === input.actorType
      ),
  );
}

function parseRetryableDocumentReplacement(
  operationsJson: string,
): { title?: string; contentMarkdown: string; contentJson?: ChannelDocumentJsonContent; summary?: string } | null {
  try {
    const parsed = JSON.parse(operationsJson) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 1) {
      return null;
    }

    const operation = parsed[0];
    if (!operation || typeof operation !== "object") {
      return null;
    }

    const candidate = operation as {
      op?: unknown;
      title?: unknown;
      contentMarkdown?: unknown;
      contentJson?: unknown;
      summary?: unknown;
    };
    if (candidate.op !== "replace_document" || typeof candidate.contentMarkdown !== "string") {
      return null;
    }

    return {
      title: typeof candidate.title === "string" && candidate.title.trim().length > 0 ? candidate.title.trim() : undefined,
      contentMarkdown: candidate.contentMarkdown,
      contentJson: normalizeRetryJsonContent(candidate.contentJson),
      summary: typeof candidate.summary === "string" && candidate.summary.trim().length > 0 ? candidate.summary.trim() : undefined,
    };
  } catch {
    return null;
  }
}

function normalizeRetryJsonContent(value: unknown): ChannelDocumentJsonContent | undefined {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function buildRetriedBlockOperations(
  state: AgentSpaceState,
  documentId: string,
  operationsJson: string,
): ChannelDocumentOperation[] | null {
  try {
    const parsed = JSON.parse(operationsJson) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }

    const currentBlocks = listChannelDocumentBlocks(state, documentId);
    const nextOperations: ChannelDocumentOperation[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        return null;
      }
      const candidate = item as {
        op?: unknown;
        blockId?: unknown;
        afterBlockId?: unknown;
        contentMarkdown?: unknown;
        heading?: unknown;
      };

      if (candidate.op === "replace_block") {
        if (typeof candidate.blockId !== "string" || typeof candidate.contentMarkdown !== "string") {
          return null;
        }
        const block = currentBlocks.find((entry) => entry.id === candidate.blockId);
        if (!block) {
          return null;
        }
        nextOperations.push({
          op: "replace_block",
          blockId: block.id,
          baseRevision: block.revision,
          contentMarkdown: candidate.contentMarkdown,
          heading: typeof candidate.heading === "string" ? candidate.heading : undefined,
        });
        continue;
      }

      if (candidate.op === "delete_block") {
        if (typeof candidate.blockId !== "string") {
          return null;
        }
        const block = currentBlocks.find((entry) => entry.id === candidate.blockId);
        if (!block) {
          return null;
        }
        nextOperations.push({
          op: "delete_block",
          blockId: block.id,
          baseRevision: block.revision,
        });
        continue;
      }

      if (candidate.op === "insert_after") {
        if (typeof candidate.contentMarkdown !== "string") {
          return null;
        }
        if (
          typeof candidate.afterBlockId === "string" &&
          candidate.afterBlockId.trim().length > 0 &&
          !currentBlocks.some((entry) => entry.id === candidate.afterBlockId)
        ) {
          return null;
        }
        nextOperations.push({
          op: "insert_after",
          afterBlockId: typeof candidate.afterBlockId === "string" ? candidate.afterBlockId : undefined,
          contentMarkdown: candidate.contentMarkdown,
          heading: typeof candidate.heading === "string" ? candidate.heading : undefined,
        });
        continue;
      }

      return null;
    }

    return nextOperations.length > 0 ? nextOperations : null;
  } catch {
    return null;
  }
}
