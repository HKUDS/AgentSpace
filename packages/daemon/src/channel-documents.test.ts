import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { beforeEach } from "node:test";
import {
  addChannelEmployeesSync,
  createChannelDocumentSync,
  createEmployeeSync,
  initializeOrganizationSync,
  listChannelDocumentBlocksSync,
  readChannelDocumentSync,
  readWorkspaceStateSync,
  resetWorkspaceStateSync,
} from "@agent-space/services";
import { applyChannelDocumentOperations } from "./channel-documents.ts";
import { appendChannelDocumentManifestEntry } from "./runtime-output-manifests.ts";

beforeEach(() => {
  resetWorkspaceStateSync();
  initializeOrganizationSync({
    organizationName: "Northstar Labs",
    ownerName: "Mina",
    ownerRole: "Owner",
    firstChannelName: "general",
  });
  createEmployeeSync({ name: "Planner" });
  addChannelEmployeesSync({ channelName: "general", employeeNames: ["Planner"] });
});

for (const stale of [false, true]) {
  test(`channel document block output persists ${stale ? "conflicts" : "updates"} on reload`, () => {
    const workDir = mkdtempSync(join(tmpdir(), "agent-space-block-output-"));
    try {
      const { document } = createChannelDocumentSync({
        channelName: "general",
        title: "Plan",
        contentMarkdown: "## First\nOriginal",
        createdBy: "Mina",
        createdByType: "human",
      });
      const block = listChannelDocumentBlocksSync(document.id)[0]!;
      writeFileSync(join(workDir, "replacement.md"), "## First\nUpdated", "utf8");
      appendChannelDocumentManifestEntry(workDir, {
        documentId: document.id,
        baseVersionId: document.currentVersionId,
        title: document.title,
        operations: [{
          op: "replace_block",
          blockId: block.id,
          baseRevision: stale ? block.revision - 1 : block.revision,
          contentPath: "replacement.md",
        }],
      });
      const result = applyChannelDocumentOperations(workDir, {
        channelName: "general",
        actorName: "Planner",
        sourceTaskQueueId: "task-block-output",
      });
      const reloaded = readWorkspaceStateSync();
      const changeSet = reloaded.channelDocumentChangeSets.find(
        (item) => item.sourceTaskQueueId === "task-block-output",
      );
      assert.ok(changeSet, "reported block operation must survive a database reload");
      assert.equal(changeSet.status, stale ? "conflicted" : "applied");
      if (stale) {
        assert.equal(result.documentUpdates.length, 0);
        assert.equal(result.warnings.length, 1);
        assert.equal(reloaded.channelDocumentConflicts.length, 1);
        assert.equal(readChannelDocumentSync(document.id).currentVersion.contentMarkdown, "## First\nOriginal");
      } else {
        assert.deepEqual(result.warnings, []);
        assert.equal(result.documentUpdates.length, 1);
        const stored = readChannelDocumentSync(document.id);
        assert.equal(stored.currentVersion.contentMarkdown, "## First\nUpdated");
        assert.equal(stored.document.currentVersionId, result.documentUpdates[0]!.documentVersionId);
        assert.equal(listChannelDocumentBlocksSync(document.id)[0]!.revision, block.revision + 1);
      }
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
}
