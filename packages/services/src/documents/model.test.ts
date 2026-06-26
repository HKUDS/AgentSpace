import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSpaceState } from "@agent-space/domain/workspace";
import { normalizeWorkspaceState } from "../shared/normalizers.ts";
import {
  buildChannelDocumentRecord,
  buildChannelDocumentVersionRecord,
  normalizeChannelDocument,
  normalizeChannelDocumentVersion,
} from "./model.ts";

test("channel document records default to native markdown", () => {
  const document = buildChannelDocumentRecord({
    id: "doc-1",
    channelName: "tour visit",
    title: "Trip notes",
    currentVersionId: "version-1",
    summary: "",
    lastEditorType: "human",
    createdBy: "Tianyu",
    updatedBy: "Tianyu",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    existingDocuments: [],
  });

  assert.equal(document.kind, "markdown");
  assert.equal(document.storageMode, "native");
  assert.equal(document.externalProvider, undefined);
});

test("channel document normalization preserves sheet external metadata", () => {
  const document = normalizeChannelDocument({
    id: "doc-1",
    channelName: "tour visit",
    title: "Budget sheet",
    slug: "budget-sheet",
    kind: "sheet",
    storageMode: "external",
    externalProvider: "google_workspace",
    externalFileId: "sheet-123",
    externalUrl: "https://docs.google.com/spreadsheets/d/sheet-123",
    externalRevisionId: "revision-1",
    currentVersionId: "version-1",
    summary: "Budget tracker",
    lastEditorType: "agent",
    createdBy: "Atlas",
    updatedBy: "Atlas",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  });

  assert.ok(document);
  assert.equal(document.kind, "sheet");
  assert.equal(document.storageMode, "external");
  assert.equal(document.externalProvider, "google_workspace");
  assert.equal(document.externalFileId, "sheet-123");
  assert.equal(document.externalRevisionId, "revision-1");
});

test("channel document normalization preserves Feishu external metadata", () => {
  const document = normalizeChannelDocument({
    id: "feishu-doc-1",
    channelName: "tour visit",
    title: "Launch brief",
    slug: "launch-brief",
    kind: "document",
    storageMode: "external",
    externalProvider: "feishu",
    externalFileId: "doccnTest123",
    externalUrl: "https://example.feishu.cn/docx/doccnTest123",
    currentVersionId: "version-1",
    summary: "Launch brief",
    lastEditorType: "human",
    createdBy: "Tianyu",
    updatedBy: "Tianyu",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
  });

  assert.ok(document);
  assert.equal(document.storageMode, "external");
  assert.equal(document.externalProvider, "feishu");
  assert.equal(document.externalFileId, "doccnTest123");
  assert.equal(document.externalSyncStatus, "unknown");
});

test("legacy channel document normalization falls back to native markdown", () => {
  const document = normalizeChannelDocument({
    id: "legacy-doc",
    channelName: "tour visit",
    title: "Legacy notes",
    currentVersionId: "legacy-version",
    kind: "unknown",
    storageMode: "unknown",
    createdBy: "Tianyu",
  });

  assert.ok(document);
  assert.equal(document.kind, "markdown");
  assert.equal(document.storageMode, "native");
});

test("channel document versions preserve structured JSON content", () => {
  const version = buildChannelDocumentVersionRecord({
    id: "version-1",
    documentId: "doc-1",
    contentMarkdown: "",
    contentJson: {
      columns: [{ id: "item", name: "Item", type: "text" }],
      rows: [{ id: "row-1", cells: { item: "Data source audit" } }],
    },
    summary: "Structured sheet",
    createdBy: "Tianyu",
    createdByType: "human",
    triggerType: "manual",
    createdAt: "2026-05-01T00:00:00.000Z",
  });

  assert.deepEqual(version.contentJson, {
    columns: [{ id: "item", name: "Item", type: "text" }],
    rows: [{ id: "row-1", cells: { item: "Data source audit" } }],
  });

  const normalized = normalizeChannelDocumentVersion(version);
  assert.deepEqual(normalized?.contentJson, version.contentJson);
});

test("workspace normalization preserves legacy markdown documents as native documents", () => {
  const state = normalizeWorkspaceState({
    channelDocuments: [
      {
        id: "doc-1",
        channelName: "research",
        title: "Legacy notes",
        currentVersionId: "ver-1",
      },
    ] as unknown as AgentSpaceState["channelDocuments"],
    channelDocumentVersions: [
      {
        id: "ver-1",
        documentId: "doc-1",
        contentMarkdown: "# Legacy",
        createdBy: "Mina",
      },
    ] as unknown as AgentSpaceState["channelDocumentVersions"],
  });

  assert.equal(state.channelDocuments[0]?.kind, "markdown");
  assert.equal(state.channelDocuments[0]?.storageMode, "native");
  assert.equal(state.channelDocuments[0]?.externalSyncStatus, undefined);
  assert.deepEqual(state.externalSheetOperationRuns, []);
});

test("workspace normalization keeps Google Sheets external metadata and operation runs", () => {
  const state = normalizeWorkspaceState({
    channelDocuments: [
      {
        id: "sheet-1",
        channelName: "research",
        title: "Competitors",
        kind: "sheet",
        storageMode: "external",
        currentVersionId: "ver-1",
        externalProvider: "google_workspace",
        externalFileId: "google-file-1",
        externalUrl: "https://docs.google.com/spreadsheets/d/google-file-1",
        externalRevisionId: "rev-7",
        externalSyncStatus: "ok",
      },
    ] as unknown as AgentSpaceState["channelDocuments"],
    channelDocumentVersions: [
      {
        id: "ver-1",
        documentId: "sheet-1",
        contentMarkdown: "",
        createdBy: "Atlas",
      },
    ] as unknown as AgentSpaceState["channelDocumentVersions"],
    externalSheetOperationRuns: [
      {
        id: "run-1",
        workspaceId: "default",
        channelDocumentId: "sheet-1",
        provider: "google_workspace",
        externalFileId: "google-file-1",
        actorType: "agent",
        actorId: "Atlas",
        status: "succeeded",
        intent: "Append competitor rows",
        operationType: "create",
        rangeA1: "Research!A2:F13",
        affectedRows: 12.4,
        affectedCells: 72,
        requestSummary: "Append 12 competitor rows.",
        responseSummary: "Appended rows.",
        startedAt: "2026-04-01T00:00:00.000Z",
        finishedAt: "2026-04-01T00:00:03.000Z",
      },
      {
        id: "orphan-run",
        workspaceId: "default",
        channelDocumentId: "missing-doc",
        provider: "google_workspace",
        externalFileId: "google-file-2",
        actorType: "agent",
        actorId: "Atlas",
        status: "succeeded",
        intent: "Ignored",
        operationType: "read",
        requestSummary: "Ignored orphan run.",
        startedAt: "2026-04-01T00:00:00.000Z",
      },
    ],
  });

  const document = state.channelDocuments[0];
  assert.equal(document?.kind, "sheet");
  assert.equal(document?.storageMode, "external");
  assert.equal(document?.externalProvider, "google_workspace");
  assert.equal(document?.externalFileId, "google-file-1");
  assert.equal(document?.externalSyncStatus, "ok");
  assert.equal(state.externalSheetOperationRuns.length, 1);
  assert.equal(state.externalSheetOperationRuns[0]?.operationType, "create");
  assert.equal(state.externalSheetOperationRuns[0]?.affectedRows, 12);
});
