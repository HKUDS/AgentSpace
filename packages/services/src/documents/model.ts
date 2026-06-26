import type {
  AgentSpaceState,
  ChannelDocument,
  ChannelDocumentEditorType,
  ChannelDocumentExternalProvider,
  ChannelDocumentJsonContent,
  ChannelDocumentKind,
  ChannelDocumentStorageMode,
  ChannelDocumentTriggerType,
  ChannelDocumentVersion,
  ExternalSheetOperationRun,
} from "@agent-space/domain/workspace";

export function buildChannelDocumentRecord(input: {
  id: string;
  channelName: string;
  title: string;
  kind?: ChannelDocumentKind;
  storageMode?: ChannelDocumentStorageMode;
  linkedTableId?: string;
  externalProvider?: ChannelDocumentExternalProvider;
  externalFileId?: string;
  externalUrl?: string;
  externalRevisionId?: string;
  currentVersionId: string;
  summary: string;
  externalSyncStatus?: ChannelDocument["externalSyncStatus"];
  externalMimeType?: string;
  externalUpdatedAt?: string;
  lastEditorType: ChannelDocumentEditorType;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  existingDocuments: ChannelDocument[];
}): ChannelDocument {
  const externalFileId = normalizeOptionalString(input.externalFileId);
  const externalUrl = normalizeOptionalString(input.externalUrl);
  const externalProvider = normalizeChannelDocumentExternalProvider(input.externalProvider);
  const storageMode = input.storageMode ?? (externalProvider || externalFileId || externalUrl ? "external" : "native");

  return {
    id: input.id,
    channelName: input.channelName,
    title: input.title,
    slug: ensureUniqueChannelDocumentSlug(input.existingDocuments, input.channelName, input.title),
    kind: input.kind ?? "markdown",
    storageMode,
    linkedTableId: normalizeOptionalString(input.linkedTableId),
    externalProvider,
    externalFileId,
    externalUrl,
    externalRevisionId: normalizeOptionalString(input.externalRevisionId),
    status: "active",
    currentVersionId: input.currentVersionId,
    summary: input.summary,
    externalSyncStatus:
      storageMode === "external" ? input.externalSyncStatus ?? "unknown" : input.externalSyncStatus,
    externalMimeType: normalizeOptionalString(input.externalMimeType),
    externalUpdatedAt: normalizeOptionalString(input.externalUpdatedAt),
    lastEditorType: input.lastEditorType,
    createdBy: input.createdBy,
    updatedBy: input.updatedBy,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export function buildChannelDocumentVersionRecord(input: {
  id: string;
  documentId: string;
  contentMarkdown: string;
  contentJson?: ChannelDocumentJsonContent;
  summary: string;
  createdBy: string;
  createdByType: ChannelDocumentEditorType;
  triggerType: ChannelDocumentTriggerType;
  sourceMessageId?: string;
  sourceAttachmentId?: string;
  sourceAttachmentStoredPath?: string;
  sourceTaskQueueId?: string;
  createdAt: string;
}): ChannelDocumentVersion {
  return {
    id: input.id,
    documentId: input.documentId,
    contentMarkdown: input.contentMarkdown,
    contentJson: normalizeChannelDocumentJsonContent(input.contentJson),
    summary: input.summary,
    createdBy: input.createdBy,
    createdByType: input.createdByType,
    triggerType: input.triggerType,
    sourceMessageId: input.sourceMessageId,
    sourceAttachmentId: input.sourceAttachmentId,
    sourceAttachmentStoredPath: input.sourceAttachmentStoredPath,
    sourceTaskQueueId: input.sourceTaskQueueId,
    createdAt: input.createdAt,
  };
}

export function normalizeChannelDocuments(
  documents: AgentSpaceState["channelDocuments"] | undefined,
  fallback: AgentSpaceState["channelDocuments"],
): AgentSpaceState["channelDocuments"] {
  if (!Array.isArray(documents)) {
    return fallback;
  }

  return sortChannelDocuments(
    documents
      .map((document) => normalizeChannelDocument(document))
      .filter((document): document is ChannelDocument => document !== null),
  );
}

export function normalizeChannelDocument(document: unknown): ChannelDocument | null {
  if (!document || typeof document !== "object") {
    return null;
  }

  const candidate = document as Partial<ChannelDocument>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.channelName !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.currentVersionId !== "string"
  ) {
    return null;
  }

  const kind = normalizeChannelDocumentKind(candidate.kind);
  const linkedTableId = normalizeOptionalString(candidate.linkedTableId);
  const externalProvider = normalizeChannelDocumentExternalProvider(candidate.externalProvider);
  const externalFileId = normalizeOptionalString(candidate.externalFileId);
  const externalUrl = normalizeOptionalString(candidate.externalUrl);
  const externalRevisionId = normalizeOptionalString(candidate.externalRevisionId);
  const hasExternalMetadata = externalProvider !== undefined || externalFileId !== undefined || externalUrl !== undefined;
  const storageMode =
    candidate.storageMode === "external" || hasExternalMetadata
      ? "external"
      : normalizeChannelDocumentStorageMode(candidate.storageMode);

  return {
    id: candidate.id,
    channelName: candidate.channelName,
    title: candidate.title,
    slug:
      typeof candidate.slug === "string" && candidate.slug.trim().length > 0
        ? candidate.slug
        : slugify(candidate.title),
    kind,
    storageMode,
    linkedTableId,
    externalProvider,
    externalFileId,
    externalUrl,
    externalRevisionId,
    status: candidate.status === "archived" ? "archived" : "active",
    currentVersionId: candidate.currentVersionId,
    summary: typeof candidate.summary === "string" ? candidate.summary : "",
    externalSyncStatus:
      storageMode === "external"
        ? normalizeExternalDocumentSyncStatus(candidate.externalSyncStatus) ?? "unknown"
        : normalizeExternalDocumentSyncStatus(candidate.externalSyncStatus),
    externalMimeType: normalizeOptionalString(candidate.externalMimeType),
    externalUpdatedAt: normalizeOptionalString(candidate.externalUpdatedAt),
    lastEditorType: candidate.lastEditorType === "agent" ? "agent" : "human",
    createdBy: typeof candidate.createdBy === "string" ? candidate.createdBy : "Unknown",
    updatedBy: typeof candidate.updatedBy === "string" ? candidate.updatedBy : "Unknown",
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date(0).toISOString(),
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date(0).toISOString(),
  };
}

export function normalizeExternalSheetOperationRuns(
  runs: AgentSpaceState["externalSheetOperationRuns"] | undefined,
  fallback: AgentSpaceState["externalSheetOperationRuns"],
  documents: ChannelDocument[],
): AgentSpaceState["externalSheetOperationRuns"] {
  if (!Array.isArray(runs)) {
    return fallback;
  }

  const documentIds = new Set(documents.map((document) => document.id));
  return runs
    .map((run) => normalizeExternalSheetOperationRun(run))
    .filter((run): run is ExternalSheetOperationRun => run !== null && documentIds.has(run.channelDocumentId))
    .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime());
}

export function normalizeExternalSheetOperationRun(run: unknown): ExternalSheetOperationRun | null {
  if (!run || typeof run !== "object") {
    return null;
  }

  const candidate = run as Partial<ExternalSheetOperationRun>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.workspaceId !== "string" ||
    typeof candidate.channelDocumentId !== "string" ||
    candidate.provider !== "google_workspace" ||
    typeof candidate.externalFileId !== "string" ||
    typeof candidate.actorId !== "string" ||
    typeof candidate.intent !== "string" ||
    typeof candidate.requestSummary !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    workspaceId: candidate.workspaceId,
    channelDocumentId: candidate.channelDocumentId,
    provider: "google_workspace",
    externalFileId: candidate.externalFileId,
    actorType:
      candidate.actorType === "human" || candidate.actorType === "system" ? candidate.actorType : "agent",
    actorId: candidate.actorId,
    delegatedUserId: typeof candidate.delegatedUserId === "string" ? candidate.delegatedUserId : undefined,
    delegatedUserDisplayName:
      typeof candidate.delegatedUserDisplayName === "string" ? candidate.delegatedUserDisplayName : undefined,
    delegatedGoogleEmail: typeof candidate.delegatedGoogleEmail === "string" ? candidate.delegatedGoogleEmail : undefined,
    credentialDelegationId: typeof candidate.credentialDelegationId === "string" ? candidate.credentialDelegationId : undefined,
    status:
      candidate.status === "running" || candidate.status === "succeeded" || candidate.status === "failed"
        ? candidate.status
        : "queued",
    intent: candidate.intent,
    operationType: normalizeExternalSheetOperationType(candidate.operationType),
    rangeA1: typeof candidate.rangeA1 === "string" ? candidate.rangeA1 : undefined,
    affectedRows: normalizeNonNegativeInteger(candidate.affectedRows),
    affectedCells: normalizeNonNegativeInteger(candidate.affectedCells),
    requestSummary: candidate.requestSummary,
    responseSummary: typeof candidate.responseSummary === "string" ? candidate.responseSummary : undefined,
    resultArtifactPath: typeof candidate.resultArtifactPath === "string" ? candidate.resultArtifactPath : undefined,
    resultArtifactFileName: typeof candidate.resultArtifactFileName === "string" ? candidate.resultArtifactFileName : undefined,
    resultArtifactMediaType: typeof candidate.resultArtifactMediaType === "string" ? candidate.resultArtifactMediaType : undefined,
    resultArtifactSizeBytes: normalizeNonNegativeInteger(candidate.resultArtifactSizeBytes),
    resultPreview: normalizeExternalSheetResultPreview(candidate.resultPreview),
    errorCode: typeof candidate.errorCode === "string" ? candidate.errorCode : undefined,
    errorMessage: typeof candidate.errorMessage === "string" ? candidate.errorMessage : undefined,
    startedAt: typeof candidate.startedAt === "string" ? candidate.startedAt : new Date(0).toISOString(),
    finishedAt: typeof candidate.finishedAt === "string" ? candidate.finishedAt : undefined,
  };
}

export function normalizeChannelDocumentVersions(
  versions: AgentSpaceState["channelDocumentVersions"] | undefined,
  fallback: AgentSpaceState["channelDocumentVersions"],
  documents: ChannelDocument[],
): AgentSpaceState["channelDocumentVersions"] {
  if (!Array.isArray(versions)) {
    return fallback;
  }

  const documentIds = new Set(documents.map((document) => document.id));
  return versions
    .map((version) => normalizeChannelDocumentVersion(version))
    .filter((version): version is ChannelDocumentVersion => version !== null && documentIds.has(version.documentId))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function normalizeChannelDocumentVersion(version: unknown): ChannelDocumentVersion | null {
  if (!version || typeof version !== "object") {
    return null;
  }

  const candidate = version as Partial<ChannelDocumentVersion>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.documentId !== "string" ||
    typeof candidate.contentMarkdown !== "string" ||
    typeof candidate.createdBy !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    documentId: candidate.documentId,
    contentMarkdown: candidate.contentMarkdown,
    contentJson: normalizeChannelDocumentJsonContent(candidate.contentJson),
    summary: typeof candidate.summary === "string" ? candidate.summary : "",
    createdBy: candidate.createdBy,
    createdByType: candidate.createdByType === "agent" ? "agent" : "human",
    triggerType:
      candidate.triggerType === "agent" || candidate.triggerType === "handoff" ? candidate.triggerType : "manual",
    sourceMessageId: typeof candidate.sourceMessageId === "string" ? candidate.sourceMessageId : undefined,
    sourceAttachmentId: typeof candidate.sourceAttachmentId === "string" ? candidate.sourceAttachmentId : undefined,
    sourceAttachmentStoredPath:
      typeof candidate.sourceAttachmentStoredPath === "string" ? candidate.sourceAttachmentStoredPath : undefined,
    sourceTaskQueueId: typeof candidate.sourceTaskQueueId === "string" ? candidate.sourceTaskQueueId : undefined,
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date(0).toISOString(),
  };
}

export function sortChannelDocuments(documents: ChannelDocument[]): ChannelDocument[] {
  return [...documents].sort((left, right) => {
    const leftTime = new Date(left.updatedAt).getTime();
    const rightTime = new Date(right.updatedAt).getTime();
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    return left.title.localeCompare(right.title, "zh-CN", { sensitivity: "base" });
  });
}

export function summarizeChannelDocument(contentMarkdown: string, explicitSummary?: string): string {
  const trimmedSummary = explicitSummary?.trim() ?? "";
  if (trimmedSummary.length > 0) {
    return trimmedSummary;
  }

  const lines = contentMarkdown
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return "";
  }

  const normalized = lines.join(" ").replace(/\s+/g, " ").trim();
  return normalized.length <= 120 ? normalized : `${normalized.slice(0, 117)}...`;
}

export function ensureUniqueChannelDocumentSlug(
  documents: ChannelDocument[],
  channelName: string,
  title: string,
  currentDocumentId?: string,
): string {
  const baseSlug = slugify(title);
  let candidate = baseSlug;
  let counter = 2;

  while (
    documents.some(
      (document) =>
        document.id !== currentDocumentId &&
        sameValue(document.channelName, channelName) &&
        sameValue(document.slug, candidate),
    )
  ) {
    candidate = `${baseSlug}-${counter}`;
    counter += 1;
  }

  return candidate;
}

function sameValue(left: string, right: string): boolean {
  return left.localeCompare(right, "zh-CN", { sensitivity: "base" }) === 0;
}

function normalizeChannelDocumentKind(value: unknown): ChannelDocumentKind {
  return value === "sheet" || value === "deck" || value === "document" ? value : "markdown";
}

function normalizeChannelDocumentStorageMode(value: unknown): ChannelDocumentStorageMode {
  return value === "external" ? "external" : "native";
}

function normalizeChannelDocumentExternalProvider(value: unknown): ChannelDocumentExternalProvider | undefined {
  return value === "google_workspace" || value === "feishu" || value === "notion" || value === "microsoft_365"
    ? value
    : undefined;
}

function normalizeChannelDocumentJsonContent(value: unknown): ChannelDocumentJsonContent | undefined {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function normalizeExternalDocumentSyncStatus(value: unknown): ChannelDocument["externalSyncStatus"] {
  if (value === "ok" || value === "permission_error" || value === "missing") {
    return value;
  }
  return value === "unknown" ? "unknown" : undefined;
}

function normalizeExternalSheetOperationType(value: unknown): ExternalSheetOperationRun["operationType"] {
  if (
    value === "create" ||
    value === "append_text" ||
    value === "append_rows" ||
    value === "update_values" ||
    value === "batch_update" ||
    value === "share" ||
    value === "metadata_refresh"
  ) {
    return value;
  }
  return "read";
}

function normalizeExternalSheetResultPreview(value: unknown): ExternalSheetOperationRun["resultPreview"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as ExternalSheetOperationRun["resultPreview"];
  return {
    rowCount: normalizeNonNegativeInteger(candidate?.rowCount),
    cellCount: normalizeNonNegativeInteger(candidate?.cellCount),
    headers: Array.isArray(candidate?.headers)
      ? candidate.headers.filter((item): item is string => typeof item === "string")
      : undefined,
    rowsPreview: Array.isArray(candidate?.rowsPreview)
      ? candidate.rowsPreview.filter((row): row is unknown[] => Array.isArray(row))
      : undefined,
    truncated: typeof candidate?.truncated === "boolean" ? candidate.truncated : undefined,
  };
}

function normalizeNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.round(value));
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "channel-document";
}
