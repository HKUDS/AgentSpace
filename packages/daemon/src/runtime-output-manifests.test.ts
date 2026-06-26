import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  appendAgentOutputAttachment,
  appendChannelDocumentManifestEntry,
  appendExternalDocumentCreateGoogleSheetOperation,
  appendExternalGoogleDocOperation,
  appendDocumentPermissionRequest,
  appendExternalDocumentLinkOperation,
  appendExternalSheetOperation,
  appendExternalSheetResult,
  appendKnowledgeProposalManifestEntry,
  collectRuntimeOutputBundleFiles,
  createRuntimeOutputPreview,
  prepareRuntimeOutputArtifactReference,
  setAgentOutputText,
  validateRuntimeOutputManifests,
} from "./runtime-output-manifests.ts";

test("runtime output helpers create and validate agent-output manifests", () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-output-manifest-"));
  try {
    mkdirSync(join(workDir, "source"), { recursive: true });
    writeFileSync(join(workDir, "source", "chart.png"), "image", "utf8");

    const prepared = prepareRuntimeOutputArtifactReference({
      workDir,
      sourcePath: "source/chart.png",
    });
    assert.equal(prepared.relativePath, "runtime-output/artifacts/chart.png");
    assert.equal(prepared.copied, true);

    appendAgentOutputAttachment(workDir, {
      path: prepared.relativePath,
      name: "chart.png",
      mediaType: "image/png",
    });
    setAgentOutputText(workDir, "done");

    const manifest = JSON.parse(readFileSync(join(workDir, "runtime-output", "agent-output.json"), "utf8")) as {
      text?: string;
      attachments?: Array<{ path: string }>;
    };
    assert.equal(manifest.text, "done");
    assert.equal(manifest.attachments?.[0]?.path, "runtime-output/artifacts/chart.png");
    assert.deepEqual(validateRuntimeOutputManifests(workDir).errors, []);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runtime output validation rejects path traversal and empty attachments", () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-output-manifest-"));
  try {
    mkdirSync(join(workDir, "runtime-output", "artifacts"), { recursive: true });
    writeFileSync(join(workDir, "runtime-output", "artifacts", "empty.txt"), "", "utf8");
    writeFileSync(
      join(workDir, "runtime-output", "agent-output.json"),
      JSON.stringify({
        attachments: [
          { path: "../escape.txt" },
          { path: "runtime-output/artifacts/empty.txt" },
        ],
      }),
      "utf8",
    );

    const result = validateRuntimeOutputManifests(workDir);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("relative path")));
    assert.ok(result.errors.some((error) => error.includes("is empty")));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runtime output helpers append document and sheets operations for preview", () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-output-manifest-"));
  try {
    mkdirSync(join(workDir, "runtime-output", "artifacts"), { recursive: true });
    writeFileSync(join(workDir, "runtime-output", "artifacts", "notes.md"), "# Notes\n", "utf8");
    mkdirSync(join(workDir, "runtime-output", "artifacts", "docs"), { recursive: true });
    writeFileSync(join(workDir, "runtime-output", "artifacts", "docs", "summary.md"), "Summary\n", "utf8");
    writeFileSync(join(workDir, "runtime-output", "artifacts", "docs", "requests.json"), "[{\"insertText\":{\"text\":\"hello\"}}]", "utf8");

    appendChannelDocumentManifestEntry(workDir, {
      title: "Research Notes",
      contentPath: "runtime-output/artifacts/notes.md",
      mode: "create_or_update",
    });
    appendExternalSheetOperation(workDir, {
      documentId: "channel-doc-123",
      operationType: "append_rows",
      intent: "Append rows",
      rangeA1: "Research!A2:B",
      values: [["Acme", "SaaS"]],
    });
    writeFileSync(join(workDir, "runtime-output", "artifacts", "sheet-result.json"), "{\"values\":[[\"Name\"]]}", "utf8");
    appendExternalSheetResult(workDir, {
      documentId: "channel-doc-123",
      operation: "read",
      range: "Research!A1:A1",
      resultPath: "runtime-output/artifacts/sheet-result.json",
      summary: "Read 1 row.",
      rowCount: 1,
      cellCount: 1,
      truncated: false,
    });
    appendExternalGoogleDocOperation(workDir, {
      documentId: "channel-doc-google-doc-1",
      operationType: "append_text",
      intent: "Append summary",
      text: "Summary\n",
      textPath: "runtime-output/artifacts/docs/summary.md",
    });
    appendExternalGoogleDocOperation(workDir, {
      documentId: "channel-doc-google-doc-1",
      operationType: "batch_update",
      intent: "Insert greeting",
      requests: [{ insertText: { text: "hello" } }],
      requestsPath: "runtime-output/artifacts/docs/requests.json",
    });
    appendKnowledgeProposalManifestEntry(workDir, {
      operation: "create",
      title: "Approval checklist",
      contentPath: "runtime-output/artifacts/notes.md",
      assignmentMode: "selected_agents",
      reason: "Reusable workflow",
    });
    writeFileSync(
      join(workDir, "runtime-output", "feishu-data-operation-requests.json"),
      JSON.stringify({
        kind: "agent-space.feishu.data-operation.requests",
        schemaVersion: 1,
        generatedBy: "agent-space-cli",
        requests: [{
          operationType: "sheets.update_range",
          providerResourceType: "sheet",
          providerResourceToken: "shtcnABC123",
          parameters: { range: "Sheet1!A1:B1" },
        }],
      }),
      "utf8",
    );

    const preview = createRuntimeOutputPreview(workDir);
    assert.deepEqual(preview.errors, []);
    assert.equal(preview.manifests.channelDocuments.documentOperations, 1);
    assert.equal(preview.manifests.knowledgeProposals.proposals, 1);
    assert.equal(preview.manifests.externalSheets.operations, 1);
    assert.equal(preview.manifests.externalSheetResults.results, 1);
    assert.equal(preview.manifests.externalGoogleDocs.operations, 2);
    assert.equal(preview.manifests.feishuDataOperationRequests.requests, 1);
    assert.deepEqual(preview.manifests.externalGoogleDocs.operationSummaries.map((operation) => operation.operationType), [
      "append_text",
      "batch_update",
    ]);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("knowledge proposal manifests must be CLI generated and reference markdown artifacts", () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-output-manifest-"));
  try {
    mkdirSync(join(workDir, "runtime-output", "artifacts"), { recursive: true });
    writeFileSync(join(workDir, "runtime-output", "artifacts", "notes.txt"), "hello", "utf8");
    writeFileSync(
      join(workDir, "runtime-output", "knowledge-proposals.json"),
      JSON.stringify({
        version: 1,
        proposals: [{
          operation: "create",
          title: "Bad proposal",
          contentPath: "runtime-output/artifacts/notes.txt",
        }],
      }),
      "utf8",
    );

    const result = validateRuntimeOutputManifests(workDir);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("generatedBy")));
    assert.ok(result.errors.some((error) => error.includes(".md")));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runtime output validation covers Google Docs artifacts and token material", () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-output-manifest-"));
  try {
    mkdirSync(join(workDir, "runtime-output", "artifacts", "docs"), { recursive: true });
    writeFileSync(join(workDir, "runtime-output", "artifacts", "docs", "requests.json"), "{\"not\":\"array\"}", "utf8");
    writeFileSync(
      join(workDir, "runtime-output", "external-google-docs.json"),
      JSON.stringify({
        operations: [
          {
            documentId: "channel-doc-google-doc-1",
            operationType: "batch_update",
            intent: "Bad request artifact",
            requests: [{ insertText: { text: "hello" } }],
            requestsPath: "runtime-output/artifacts/docs/requests.json",
          },
          {
            documentId: "channel-doc-google-doc-1",
            operationType: "append_text",
            intent: "Bad token text",
            text: "Bearer ya29.secret-token-material",
          },
        ],
      }),
      "utf8",
    );

    const result = validateRuntimeOutputManifests(workDir);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("requestsPath") && error.includes("JSON array")));
    assert.ok(result.errors.some((error) => error.includes("token material")));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("document access manifests must be generated through the output CLI helpers", () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-output-manifest-"));
  try {
    mkdirSync(join(workDir, "runtime-output"), { recursive: true });
    writeFileSync(
      join(workDir, "runtime-output", "external-documents.json"),
      JSON.stringify({
        version: 1,
        operations: [{
          operationType: "link_google_sheet",
          sourceDocumentId: "doc-1",
          targetChannel: "general",
          title: "Sheet",
        }],
      }),
      "utf8",
    );
    writeFileSync(
      join(workDir, "runtime-output", "permission-requests.json"),
      JSON.stringify({
        version: 1,
        requests: [{
          requestedRole: "forwarder",
          reason: "Need to share it.",
          documentId: "doc-1",
        }],
      }),
      "utf8",
    );

    const handWritten = validateRuntimeOutputManifests(workDir);
    assert.equal(handWritten.valid, false);
    assert.ok(handWritten.errors.some((error) => error.includes("external-documents.json.generatedBy")));
    assert.ok(handWritten.errors.some((error) => error.includes("permission-requests.json.generatedBy")));

    appendExternalDocumentLinkOperation(workDir, {
      operationType: "link_google_sheet",
      sourceDocumentId: "doc-1",
      targetChannel: "general",
      title: "Sheet",
    });
    mkdirSync(join(workDir, "runtime-output", "artifacts", "sheets"), { recursive: true });
    writeFileSync(
      join(workDir, "runtime-output", "artifacts", "sheets", "create-sheet.json"),
      JSON.stringify({
        id: "spreadsheet-created-123",
        webViewLink: "https://docs.google.com/spreadsheets/d/spreadsheet-created-123/edit",
        mimeType: "application/vnd.google-apps.spreadsheet",
      }),
      "utf8",
    );
    appendExternalDocumentCreateGoogleSheetOperation(workDir, {
      operationType: "create_google_sheet",
      externalFileId: "spreadsheet-created-123",
      externalUrl: "https://docs.google.com/spreadsheets/d/spreadsheet-created-123/edit",
      targetChannel: "general",
      title: "Created Sheet",
      resultPath: "runtime-output/artifacts/sheets/create-sheet.json",
    });
    appendDocumentPermissionRequest(workDir, {
      requestedRole: "forwarder",
      reason: "Need to share it.",
      documentId: "doc-1",
    });
    writeFileSync(
      join(workDir, "runtime-output", "feishu-data-operation-requests.json"),
      JSON.stringify({
        kind: "agent-space.feishu.data-operation.requests",
        schemaVersion: 1,
        generatedBy: "agent-space-cli",
        requests: [{
          operationType: "sheets.update_range",
          providerResourceType: "sheet",
          providerResourceToken: "shtcnABC123",
        }],
      }),
      "utf8",
    );

    assert.deepEqual(validateRuntimeOutputManifests(workDir).errors, []);
    assert.equal(
      collectRuntimeOutputBundleFiles(workDir).some((file) => file.path === "runtime-output/artifacts/sheets/create-sheet.json"),
      true,
    );
    assert.equal(
      collectRuntimeOutputBundleFiles(workDir).some((file) => file.path === "runtime-output/feishu-data-operation-requests.json"),
      true,
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("runtime output validation rejects create-google-sheet artifacts outside runtime artifacts", () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-runtime-output-"));
  try {
    mkdirSync(join(workDir, "runtime-output"), { recursive: true });
    mkdirSync(join(workDir, "other"), { recursive: true });
    writeFileSync(
      join(workDir, "other", "create-sheet.json"),
      JSON.stringify({
        id: "spreadsheet-created-123",
        webViewLink: "https://docs.google.com/spreadsheets/d/spreadsheet-created-123/edit",
        mimeType: "application/vnd.google-apps.spreadsheet",
      }),
      "utf8",
    );
    writeFileSync(
      join(workDir, "runtime-output", "external-documents.json"),
      JSON.stringify({
        version: 1,
        generatedBy: "agent-space-cli",
        operations: [{
          operationType: "create_google_sheet",
          externalFileId: "spreadsheet-created-123",
          externalUrl: "https://docs.google.com/spreadsheets/d/spreadsheet-created-123/edit",
          targetChannel: "general",
          title: "Created Sheet",
          resultPath: "other/create-sheet.json",
        }],
      }),
      "utf8",
    );

    const result = validateRuntimeOutputManifests(workDir);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("resultPath must be under runtime-output/artifacts/")));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
