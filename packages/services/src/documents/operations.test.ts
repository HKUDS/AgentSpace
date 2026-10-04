import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultWorkspaceState } from "@agent-space/domain/workspace";
import { createChannelDocument } from "./service.ts";
import { applyChannelDocumentBlockOperations } from "./operations.ts";
import { listChannelDocumentBlocks, rebuildChannelDocumentBlocksForVersion } from "./collab.ts";

function createStateWithChannel() {
  const state = createDefaultWorkspaceState();
  state.channels.push({
    name: "tour visit",
    humanMembers: 1,
    employeeNames: [],
  });
  return state;
}

test("applyChannelDocumentBlockOperations updates a block and creates a new version", () => {
  const state = createStateWithChannel();
  const { document, version } = createChannelDocument({
    state,
    channelName: "tour visit",
    title: "大阪-濑户内海行程",
    contentMarkdown: "## Day 1\n大阪\n\n## Day 2\n宇治",
    createdBy: "Tianyu",
    createdByType: "human",
  });
  rebuildChannelDocumentBlocksForVersion({
    state,
    document,
    version,
    actorName: "Tianyu",
  });

  const blocks = listChannelDocumentBlocks(state, document.id);
  assert.equal(blocks.length, 2);

  const result = applyChannelDocumentBlockOperations({
    state,
    document,
    baseVersionId: version.id,
    actorId: "Atlas",
    actorType: "agent",
    operations: [
      {
        op: "replace_block",
        blockId: blocks[1]!.id,
        baseRevision: blocks[1]!.revision,
        contentMarkdown: "## Day 2\n宇治和任天堂博物馆",
      },
    ],
    summary: "补了 Day 2 行程",
    sourceMessageId: "message-1",
    sourceTaskQueueId: "queue-1",
  });

  assert.equal(result.conflictCount, 0);
  assert.equal(result.appliedOperationCount, 1);
  assert.ok(result.document);
  assert.ok(result.version);
  assert.match(result.version!.contentMarkdown, /任天堂博物馆/);
  assert.equal(state.channelDocumentChangeSets[0]?.documentVersionId, result.version?.id);
  assert.equal(state.channelDocumentChangeSets[0]?.sourceMessageId, "message-1");
  assert.equal(state.channelDocumentChangeSets[0]?.sourceTaskQueueId, "queue-1");
});

test("applyChannelDocumentBlockOperations records conflict for stale block revision", () => {
  const state = createStateWithChannel();
  const { document, version } = createChannelDocument({
    state,
    channelName: "tour visit",
    title: "大阪-濑户内海行程",
    contentMarkdown: "## Day 1\n大阪",
    createdBy: "Tianyu",
    createdByType: "human",
  });
  rebuildChannelDocumentBlocksForVersion({
    state,
    document,
    version,
    actorName: "Tianyu",
  });

  const blocks = listChannelDocumentBlocks(state, document.id);
  const staleRevision = blocks[0]!.revision;
  blocks[0]!.revision += 1;

  const result = applyChannelDocumentBlockOperations({
    state,
    document,
    baseVersionId: version.id,
    actorId: "Nova",
    actorType: "agent",
    operations: [
      {
        op: "replace_block",
        blockId: blocks[0]!.id,
        baseRevision: staleRevision,
        contentMarkdown: "## Day 1\n改坏的版本",
      },
    ],
    summary: "尝试修改 Day 1",
  });

  assert.equal(result.appliedOperationCount, 0);
  assert.equal(result.conflictCount, 1);
  assert.equal(state.channelDocumentConflicts.length, 1);
});

test("applyChannelDocumentBlockOperations rejects non-markdown documents", () => {
  const state = createStateWithChannel();
  const { document, version } = createChannelDocument({
    state,
    channelName: "tour visit",
    title: "Budget tracker",
    kind: "sheet",
    storageMode: "native",
    contentJson: { columns: [], rows: [] },
    createdBy: "Tianyu",
    createdByType: "human",
  });

  assert.throws(
    () => applyChannelDocumentBlockOperations({
      state,
      document,
      baseVersionId: version.id,
      actorId: "Atlas",
      actorType: "agent",
      operations: [
        {
          op: "insert_after",
          contentMarkdown: "## Not a sheet patch",
        },
      ],
    }),
    /only supported for markdown/,
  );
});

test("insert_after retains document content when its anchor block was removed", () => {
  const state = createStateWithChannel();
  const { document, version } = createChannelDocument({
    state,
    channelName: "tour visit",
    title: "Plan",
    contentMarkdown: "## First\nOriginal",
    createdBy: "Mina",
    createdByType: "human",
  });
  rebuildChannelDocumentBlocksForVersion({ state, document, version, actorName: "Mina" });
  const originalBlocks = structuredClone(state.channelDocumentBlocks);
  const result = applyChannelDocumentBlockOperations({
    state,
    document,
    baseVersionId: version.id,
    actorId: "Planner",
    actorType: "agent",
    operations: [{ op: "insert_after", afterBlockId: "removed-block", contentMarkdown: "## New\nAdded" }],
  });
  assert.equal(result.appliedOperationCount, 0);
  assert.equal(result.conflictCount, 1);
  assert.equal(document.currentVersionId, version.id);
  assert.deepEqual(state.channelDocumentBlocks, originalBlocks);
  assert.equal(state.channelDocumentConflicts[0]?.blockId, "removed-block");
});
