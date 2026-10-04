import type {
  AgentSpaceState,
  ChannelDocument,
  ChannelDocumentVersion,
} from "@agent-space/domain/workspace";
import type { ChannelDocumentBlock } from "@agent-space/domain";
import {
  createChannelDocumentChangeSet,
  createChannelDocumentConflict,
  listChannelDocumentBlocks,
  serializeChannelDocumentBlocks,
} from "./collab.ts";
import { updateChannelDocument } from "./service.ts";

export type ChannelDocumentOperation =
  | {
      op: "replace_block";
      blockId: string;
      baseRevision: number;
      contentMarkdown: string;
      heading?: string;
    }
  | {
      op: "insert_after";
      afterBlockId?: string;
      contentMarkdown: string;
      heading?: string;
    }
  | {
      op: "delete_block";
      blockId: string;
      baseRevision: number;
    };

export function applyChannelDocumentBlockOperations(input: {
  state: AgentSpaceState;
  document: ChannelDocument;
  baseVersionId: string;
  actorId: string;
  actorType: "human" | "agent";
  operations: ChannelDocumentOperation[];
  summary?: string;
  sourceMessageId?: string;
  sourceTaskQueueId?: string;
}): {
  state: AgentSpaceState;
  document?: ChannelDocument;
  version?: ChannelDocumentVersion;
  appliedOperationCount: number;
  conflictCount: number;
} {
  const { state, document } = input;
  if (document.kind !== "markdown") {
    throw new Error(`Block operations are only supported for markdown channel documents.`);
  }

  const changeSet = createChannelDocumentChangeSet({
    documentId: document.id,
    actorId: input.actorId,
    actorType: input.actorType,
    baseVersionId: input.baseVersionId,
    operationsJson: JSON.stringify(input.operations),
    status: "pending",
    sourceMessageId: input.sourceMessageId,
    sourceTaskQueueId: input.sourceTaskQueueId,
  });
  state.channelDocumentChangeSets.unshift(changeSet);

  const blocks = listChannelDocumentBlocks(state, document.id).map((block) => ({ ...block }));
  let appliedOperationCount = 0;
  let conflictCount = 0;

  for (const operation of input.operations) {
    if (operation.op === "replace_block") {
      const index = blocks.findIndex((block) => block.id === operation.blockId);
      if (index < 0 || blocks[index]!.revision !== operation.baseRevision) {
        conflictCount += 1;
        createConflict(state, document.id, operation.blockId, changeSet.id);
        continue;
      }

      blocks[index] = {
        ...blocks[index]!,
        heading: operation.heading ?? inferHeading(operation.contentMarkdown),
        contentMarkdown: operation.contentMarkdown,
        revision: blocks[index]!.revision + 1,
        updatedBy: input.actorId,
        updatedAt: new Date().toISOString(),
      };
      appliedOperationCount += 1;
      continue;
    }

    if (operation.op === "delete_block") {
      const index = blocks.findIndex((block) => block.id === operation.blockId);
      if (index < 0 || blocks[index]!.revision !== operation.baseRevision) {
        conflictCount += 1;
        createConflict(state, document.id, operation.blockId, changeSet.id);
        continue;
      }

      blocks.splice(index, 1);
      appliedOperationCount += 1;
      continue;
    }

    if (operation.op === "insert_after") {
      const anchorIndex = operation.afterBlockId
        ? blocks.findIndex((block) => block.id === operation.afterBlockId)
        : -1;
      if (operation.afterBlockId && anchorIndex < 0) {
        conflictCount += 1;
        createConflict(state, document.id, operation.afterBlockId, changeSet.id);
        continue;
      }
      const nextIndex = anchorIndex + 1;
      blocks.splice(nextIndex, 0, {
        id: `channel-doc-block-${createOpaqueId()}`,
        documentId: document.id,
        parentId: undefined,
        type: "section",
        order: nextIndex,
        heading: operation.heading ?? inferHeading(operation.contentMarkdown),
        contentMarkdown: operation.contentMarkdown,
        revision: 1,
        updatedBy: input.actorId,
        updatedAt: new Date().toISOString(),
      });
      appliedOperationCount += 1;
    }
  }

  if (conflictCount > 0 && appliedOperationCount === 0) {
    changeSet.status = "conflicted";
    return { state, appliedOperationCount, conflictCount };
  }

  for (const [index, block] of blocks.entries()) {
    block.order = index;
  }
  state.channelDocumentBlocks = [
    ...state.channelDocumentBlocks.filter((block) => block.documentId !== document.id),
    ...blocks,
  ];

  if (appliedOperationCount === 0) {
    changeSet.status = "rejected";
    return { state, appliedOperationCount, conflictCount };
  }

  const { document: updatedDocument, version } = updateChannelDocument({
    state,
    documentId: document.id,
    contentMarkdown: serializeChannelDocumentBlocks(blocks),
    summary: input.summary,
    updatedBy: input.actorId,
    updatedByType: input.actorType,
    triggerType: "handoff",
    sourceMessageId: input.sourceMessageId,
    sourceTaskQueueId: input.sourceTaskQueueId,
  });
  changeSet.documentVersionId = version.id;
  changeSet.status = conflictCount > 0 ? "conflicted" : "applied";
  return {
    state,
    document: updatedDocument,
    version,
    appliedOperationCount,
    conflictCount,
  };
}

function createConflict(
  state: AgentSpaceState,
  documentId: string,
  blockId: string,
  changeSetId: string,
): void {
  const previousChangeSetId =
    state.channelDocumentChangeSets.find((item) => item.documentId === documentId && item.status === "applied")?.id ??
    `channel-doc-changeset-${createOpaqueId()}`;
  state.channelDocumentConflicts.unshift(
    createChannelDocumentConflict({
      documentId,
      blockId,
      leftChangeSetId: previousChangeSetId,
      rightChangeSetId: changeSetId,
    }),
  );
}

function inferHeading(contentMarkdown: string): string | undefined {
  const firstLine = contentMarkdown.split(/\r?\n/, 1)[0] ?? "";
  return /^#+\s+/.test(firstLine) ? firstLine.replace(/^#+\s+/, "").trim() : undefined;
}

function createOpaqueId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
