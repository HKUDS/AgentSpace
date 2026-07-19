import { basename } from "node:path";
import type { AgentSpaceState, KnowledgeAssignmentMode, KnowledgePage } from "@agent-space/domain/workspace";
import { ensureWorkspaceStateSync, writeWorkspaceStateSync } from "../shared/state-io.ts";
import { isDescendant } from "./knowledge-tree.ts";
import { createOpaqueId, resolveAttachmentMediaType } from "../shared/helpers.ts";
import { assertCanViewChannelDocument } from "../documents/access.ts";
import { readChannelDocument } from "../documents/service.ts";
import { assertCanAccessWorkspaceAttachment, readMarkdownAttachmentContent } from "../documents/files.ts";
import {
  deleteKnowledgeAssignmentsForPageSync,
  setKnowledgePageAssignedEmployeesSync,
  setKnowledgePageAssignmentModeSync,
} from "./assignments.ts";

export function listKnowledgePagesSync(workspaceId?: string): KnowledgePage[] {
  return ensureWorkspaceStateSync(workspaceId).knowledgePages;
}

export function readKnowledgePageSync(id: string, workspaceId?: string): KnowledgePage | undefined {
  return ensureWorkspaceStateSync(workspaceId).knowledgePages.find((page) => page.id === id);
}

export function createKnowledgePageSync(input: {
  title: string;
  parentId?: string | null;
  contentMarkdown?: string;
  tags?: string[];
  createdBy?: string;
  assignmentMode?: KnowledgeAssignmentMode;
  assignedEmployeeNames?: string[];
  sourceAttachmentId?: string;
  sourceAttachmentStoredPath?: string;
  sourceChannelDocumentId?: string;
  sourceKnowledgeProposalId?: string;
  sourceApprovalId?: string;
  sourceTaskQueueId?: string;
  sourceAgentName?: string;
}, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const page = buildKnowledgePageRecord(state, input);

  state.knowledgePages.push(page);
  state.ledger.unshift({
    title: "Knowledge page created",
    note: `Created knowledge page "${page.title}".`,
  });

  const written = writeWorkspaceStateSync(state, workspaceId);
  if (hasInitialKnowledgeAssignments(input.assignmentMode, input.assignedEmployeeNames)) {
    applyInitialKnowledgeAssignments(page.id, input.assignmentMode, input.assignedEmployeeNames, input.createdBy, workspaceId);
    return ensureWorkspaceStateSync(workspaceId);
  }
  return written;
}

export function updateKnowledgePageSync(
  id: string,
  input: {
    title?: string;
    contentMarkdown?: string;
    tags?: string[];
    sourceKnowledgeProposalId?: string;
    sourceApprovalId?: string;
    sourceTaskQueueId?: string;
    sourceAgentName?: string;
  },
  workspaceId?: string,
): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const page = state.knowledgePages.find((p) => p.id === id);
  if (!page) {
    throw new Error(`Knowledge page "${id}" does not exist.`);
  }

  if (typeof input.title === "string") {
    const trimmed = input.title.trim();
    if (!trimmed) {
      throw new Error("Page title is required.");
    }
    page.title = trimmed;
  }

  if (typeof input.contentMarkdown === "string") {
    page.contentMarkdown = input.contentMarkdown;
  }

  if (Array.isArray(input.tags)) {
    page.tags = input.tags.filter((tag): tag is string => typeof tag === "string");
  }

  if (typeof input.sourceKnowledgeProposalId === "string") {
    page.sourceKnowledgeProposalId = input.sourceKnowledgeProposalId;
  }
  if (typeof input.sourceApprovalId === "string") {
    page.sourceApprovalId = input.sourceApprovalId;
  }
  if (typeof input.sourceTaskQueueId === "string") {
    page.sourceTaskQueueId = input.sourceTaskQueueId;
  }
  if (typeof input.sourceAgentName === "string") {
    page.sourceAgentName = input.sourceAgentName;
  }

  page.updatedAt = new Date().toISOString();

  state.ledger.unshift({
    title: "Knowledge page updated",
    note: `Updated knowledge page "${page.title}".`,
  });

  return writeWorkspaceStateSync(state, workspaceId);
}

export function moveKnowledgePageSync(
  id: string,
  input: {
    parentId: string | null;
    sortOrder?: number;
  },
  workspaceId?: string,
): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const page = state.knowledgePages.find((p) => p.id === id);
  if (!page) {
    throw new Error(`Knowledge page "${id}" does not exist.`);
  }

  if (input.parentId !== null) {
    if (input.parentId === id) {
      throw new Error("Cannot move a page under itself.");
    }
    const parent = state.knowledgePages.find((p) => p.id === input.parentId);
    if (!parent) {
      throw new Error(`Target parent page "${input.parentId}" does not exist.`);
    }
    if (isDescendant(state.knowledgePages, id, input.parentId)) {
      throw new Error("Cannot move a page under its own descendant.");
    }
  }

  page.parentId = input.parentId;

  if (typeof input.sortOrder === "number") {
    page.sortOrder = input.sortOrder;
  } else {
    const siblings = state.knowledgePages.filter(
      (p) => p.parentId === input.parentId && p.id !== id,
    );
    page.sortOrder = siblings.reduce((max, p) => Math.max(max, p.sortOrder), -1) + 1;
  }

  page.updatedAt = new Date().toISOString();

  return writeWorkspaceStateSync(state, workspaceId);
}

export function deleteKnowledgePageSync(id: string, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const page = state.knowledgePages.find((p) => p.id === id);
  if (!page) {
    throw new Error(`Knowledge page "${id}" does not exist.`);
  }

  const idsToRemove = collectDescendantIds(state.knowledgePages, id);
  idsToRemove.add(id);

  state.knowledgePages = state.knowledgePages.filter((p) => !idsToRemove.has(p.id));
  deleteKnowledgeAssignmentsForPageSync(Array.from(idsToRemove), workspaceId);

  state.ledger.unshift({
    title: "Knowledge page deleted",
    note: `Deleted knowledge page "${page.title}" and ${idsToRemove.size - 1} child page(s).`,
  });

  return writeWorkspaceStateSync(state, workspaceId);
}

export function materialToKnowledgePageSync(
  materialId: string,
  parentId?: string | null,
  workspaceId?: string,
): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const material = state.materials.find((m) => m.id === materialId);
  if (!material) {
    throw new Error(`Material "${materialId}" does not exist.`);
  }

  const title = material.source || "Untitled";
  const content = material.preview ?? "";
  const page = buildKnowledgePageRecord(state, {
    title,
    parentId,
    contentMarkdown: content,
    tags: ["imported-from-material"],
    createdBy: "system",
  });

  state.knowledgePages.push(page);
  state.ledger.unshift({
    title: "Knowledge page from material",
    note: `Created knowledge page "${title}" from material "${material.source}".`,
  });

  return writeWorkspaceStateSync(state, workspaceId);
}

export function createKnowledgePageFromSharedDocumentSync(input: {
  sourceType: "attachment" | "channelDocument";
  sourceId: string;
  parentId?: string | null;
  createdBy: string;
  createdByType: "human" | "agent";
  assignmentMode?: KnowledgeAssignmentMode;
  assignedEmployeeNames?: string[];
}, workspaceId?: string): KnowledgePage {
  const state = ensureWorkspaceStateSync(workspaceId);
  const sourceId = input.sourceId.trim();
  if (!sourceId) {
    throw new Error("Document source id is required.");
  }

  const existingPage = state.knowledgePages.find((page) =>
    input.sourceType === "attachment"
      ? page.sourceAttachmentId === sourceId
      : page.sourceChannelDocumentId === sourceId,
  );
  if (existingPage) {
    if (hasInitialKnowledgeAssignments(input.assignmentMode, input.assignedEmployeeNames)) {
      applyInitialKnowledgeAssignments(existingPage.id, input.assignmentMode, input.assignedEmployeeNames, input.createdBy, workspaceId);
      return readKnowledgePageSync(existingPage.id, workspaceId) ?? existingPage;
    }
    return existingPage;
  }

  if (input.sourceType === "attachment") {
    const match = assertCanAccessWorkspaceAttachment(state, sourceId, input.createdBy, input.createdByType);
    const mediaType = resolveAttachmentMediaType(match.attachment.fileName, match.attachment.mediaType);
    if (mediaType !== "text/markdown") {
      throw new Error("Only Markdown attachments can become knowledge pages.");
    }

    const page = buildKnowledgePageRecord(state, {
      title: basename(match.attachment.fileName, ".md") || match.attachment.fileName,
      parentId: input.parentId,
      contentMarkdown: readMarkdownAttachmentContent(match.attachment),
      tags: ["imported-from-shared-document"],
      createdBy: input.createdBy,
      assignmentMode: input.assignmentMode,
      sourceAttachmentId: match.attachment.id,
      sourceAttachmentStoredPath: match.attachment.storedPath,
    });
    state.knowledgePages.push(page);
    state.ledger.unshift({
      title: "Knowledge page created from attachment",
      note: `Created knowledge page "${page.title}" from attachment "${match.attachment.fileName}".`,
    });
    writeWorkspaceStateSync(state, workspaceId);
    applyInitialKnowledgeAssignments(page.id, input.assignmentMode, input.assignedEmployeeNames, input.createdBy, workspaceId);
    return page;
  }

  const { document, currentVersion } = readChannelDocument(state, sourceId);
  assertCanViewChannelDocument(state, document, input.createdBy, input.createdByType);

  const page = buildKnowledgePageRecord(state, {
    title: document.title,
    parentId: input.parentId,
    contentMarkdown: currentVersion.contentMarkdown,
    tags: ["imported-from-shared-document"],
    createdBy: input.createdBy,
    assignmentMode: input.assignmentMode,
    sourceChannelDocumentId: document.id,
  });
  state.knowledgePages.push(page);
  state.ledger.unshift({
    title: "Knowledge page created from shared document",
    note: `Created knowledge page "${page.title}" from shared document "${document.title}".`,
  });
  writeWorkspaceStateSync(state, workspaceId);
  applyInitialKnowledgeAssignments(page.id, input.assignmentMode, input.assignedEmployeeNames, input.createdBy, workspaceId);
  return page;
}

function buildKnowledgePageRecord(
  state: AgentSpaceState,
  input: {
    title: string;
    parentId?: string | null;
    contentMarkdown?: string;
    tags?: string[];
    createdBy?: string;
    assignmentMode?: KnowledgeAssignmentMode;
    sourceAttachmentId?: string;
    sourceAttachmentStoredPath?: string;
    sourceChannelDocumentId?: string;
    sourceKnowledgeProposalId?: string;
    sourceApprovalId?: string;
    sourceTaskQueueId?: string;
    sourceAgentName?: string;
  },
): KnowledgePage {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Page title is required.");
  }

  if (input.parentId) {
    const parent = state.knowledgePages.find((page) => page.id === input.parentId);
    if (!parent) {
      throw new Error(`Parent page "${input.parentId}" does not exist.`);
    }
  }

  if (input.sourceAttachmentId && input.sourceChannelDocumentId) {
    throw new Error("A knowledge page cannot track both an attachment and a shared document source.");
  }

  const siblings = state.knowledgePages.filter(
    (page) => page.parentId === (input.parentId ?? null),
  );
  const maxSortOrder = siblings.reduce((max, page) => Math.max(max, page.sortOrder), -1);

  const now = new Date().toISOString();
  return {
    id: createOpaqueId(),
    parentId: input.parentId ?? null,
    title,
    contentMarkdown: input.contentMarkdown?.trim() ?? "",
    sortOrder: maxSortOrder + 1,
    tags: input.tags ?? [],
    createdBy: input.createdBy ?? "",
    createdAt: now,
    updatedAt: now,
    assignmentMode: input.assignmentMode ?? "all_agents",
    assignmentUpdatedAt: now,
    assignmentUpdatedBy: input.createdBy ?? "",
    sourceAttachmentId: input.sourceAttachmentId,
    sourceAttachmentStoredPath: input.sourceAttachmentStoredPath,
    sourceChannelDocumentId: input.sourceChannelDocumentId,
    sourceKnowledgeProposalId: input.sourceKnowledgeProposalId,
    sourceApprovalId: input.sourceApprovalId,
    sourceTaskQueueId: input.sourceTaskQueueId,
    sourceAgentName: input.sourceAgentName,
  };
}

function applyInitialKnowledgeAssignments(
  pageId: string,
  assignmentMode: KnowledgeAssignmentMode | undefined,
  assignedEmployeeNames: string[] | undefined,
  actor: string | undefined,
  workspaceId: string | undefined,
): void {
  const mode = assignmentMode ?? "all_agents";
  setKnowledgePageAssignmentModeSync(pageId, mode, actor ?? "system", workspaceId);
  if (mode === "selected_agents") {
    setKnowledgePageAssignedEmployeesSync(pageId, assignedEmployeeNames ?? [], actor ?? "system", workspaceId);
  }
}

function hasInitialKnowledgeAssignments(
  assignmentMode: KnowledgeAssignmentMode | undefined,
  assignedEmployeeNames: string[] | undefined,
): boolean {
  return Boolean(assignmentMode || (assignedEmployeeNames && assignedEmployeeNames.length > 0));
}

function collectDescendantIds(pages: KnowledgePage[], parentId: string): Set<string> {
  const result = new Set<string>();
  const queue = [parentId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const page of pages) {
      if (page.parentId === currentId && !result.has(page.id)) {
        result.add(page.id);
        queue.push(page.id);
      }
    }
  }

  return result;
}
