import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discardTaskOutputAttachments, loadTaskOutputEnvelope } from "agent-space-daemon";
import {
  FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_KIND,
  FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_RELATIVE_PATH,
} from "@agent-space/services";
import { runOutputCommand } from "./output.ts";

test("output attach creates and appends agent-output attachments", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-output-command-"));
  try {
    mkdirSync(join(workDir, "runtime-output", "artifacts"), { recursive: true });
    writeFileSync(join(workDir, "runtime-output", "artifacts", "chart.png"), "image", "utf8");
    writeFileSync(join(workDir, "runtime-output", "artifacts", "report.md"), "# Report\n", "utf8");

    assert.equal(
      await runOutputCommand(
        "attach",
        [
          "runtime-output/artifacts/chart.png",
          "--name",
          "chart.png",
          "--media-type",
          "image/png",
          "--text",
          "图表已生成。",
          "--work-dir",
          workDir,
        ],
        "text",
      ),
      0,
    );
    assert.equal(
      await runOutputCommand(
        "attach",
        ["runtime-output/artifacts/report.md", "--name", "report.md", "--work-dir", workDir],
        "text",
      ),
      0,
    );

    const manifest = JSON.parse(readFileSync(join(workDir, "runtime-output", "agent-output.json"), "utf8")) as {
      text?: string;
      attachments?: Array<{ path: string; name?: string; mediaType?: string }>;
    };
    assert.equal(manifest.text, "图表已生成。");
    assert.equal(manifest.attachments?.length, 2);
    assert.equal(manifest.attachments?.[0]?.mediaType, "image/png");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("daemon consumes CLI-generated agent-output manifests", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-output-command-"));
  try {
    mkdirSync(join(workDir, "runtime-output", "artifacts"), { recursive: true });
    writeFileSync(join(workDir, "runtime-output", "artifacts", "chart.png"), "image", "utf8");
    assert.equal(
      await runOutputCommand(
        "attach",
        [
          "runtime-output/artifacts/chart.png",
          "--name",
          "chart.png",
          "--media-type",
          "image/png",
          "--text",
          "图表已生成。",
          "--work-dir",
          workDir,
        ],
        "text",
      ),
      0,
    );

    const output = loadTaskOutputEnvelope(workDir, "fallback", "default");
    assert.equal(output.text, "图表已生成。");
    assert.equal(output.warnings.length, 0);
    assert.equal(output.attachments[0]?.fileName, "chart.png");
    discardTaskOutputAttachments(output.attachments);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("output attach rejects absolute files unless --copy is set", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-output-command-"));
  const externalDir = mkdtempSync(join(tmpdir(), "agent-space-output-external-"));
  try {
    const externalFile = join(externalDir, "chart.png");
    writeFileSync(externalFile, "image", "utf8");

    assert.equal(
      await runOutputCommand("attach", [externalFile, "--work-dir", workDir], "text"),
      1,
    );
    assert.equal(
      await runOutputCommand("attach", [externalFile, "--copy", "--work-dir", workDir], "text"),
      0,
    );
    assert.equal(existsSync(join(workDir, "runtime-output", "artifacts", "chart.png")), true);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    rmSync(externalDir, { recursive: true, force: true });
  }
});

test("output document and sheets commands write compatible manifests", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-output-command-"));
  try {
    mkdirSync(join(workDir, "runtime-output", "artifacts"), { recursive: true });
    writeFileSync(join(workDir, "runtime-output", "artifacts", "notes.md"), "# Notes\n", "utf8");

    assert.equal(
      await runOutputCommand(
        "document",
        [
          "upsert",
          "--title",
          "Research Notes",
          "--content",
          "runtime-output/artifacts/notes.md",
          "--summary",
          "Notes",
          "--work-dir",
          workDir,
        ],
        "text",
      ),
      0,
    );
    assert.equal(
      await runOutputCommand(
        "sheets",
        [
          "append-rows",
          "--document-id",
          "channel-doc-123",
          "--range",
          "Research!A2:B",
          "--intent",
          "Append rows",
          "--values-json",
          "[[\"Acme\",\"SaaS\"]]",
          "--work-dir",
          workDir,
        ],
        "text",
      ),
      0,
    );
    assert.equal(await runOutputCommand("validate", ["--work-dir", workDir], "text"), 0);

    const documents = JSON.parse(readFileSync(join(workDir, "runtime-output", "channel-documents.json"), "utf8")) as {
      documents?: Array<{ title: string; contentPath: string }>;
    };
    const sheets = JSON.parse(readFileSync(join(workDir, "runtime-output", "external-sheets.json"), "utf8")) as {
      operations?: Array<{ operationType: string; values?: unknown[][] }>;
    };
    assert.equal(documents.documents?.[0]?.contentPath, "runtime-output/artifacts/notes.md");
    assert.equal(sheets.operations?.[0]?.operationType, "append_rows");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("output knowledge commands write controlled proposal manifests", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-output-command-"));
  try {
    mkdirSync(join(workDir, "runtime-output", "artifacts", "knowledge"), { recursive: true });
    writeFileSync(join(workDir, "runtime-output", "artifacts", "knowledge", "approval.md"), "# Approval\n", "utf8");

    assert.equal(
      await runOutputCommand(
        "knowledge",
        [
          "propose-create",
          "--title",
          "Approval checklist",
          "--content-file",
          "runtime-output/artifacts/knowledge/approval.md",
          "--assignment-mode",
          "selected_agents",
          "--reason",
          "Reusable workflow",
          "--work-dir",
          workDir,
        ],
        "text",
      ),
      0,
    );

    const manifest = JSON.parse(readFileSync(join(workDir, "runtime-output", "knowledge-proposals.json"), "utf8")) as {
      generatedBy?: string;
      proposals?: Array<{ operation: string; title: string; contentPath: string; reason?: string; assignToSelf?: boolean }>;
    };
    assert.equal(manifest.generatedBy, "agent-space-cli");
    assert.equal(manifest.proposals?.[0]?.operation, "create");
    assert.equal(manifest.proposals?.[0]?.title, "Approval checklist");
    assert.equal(manifest.proposals?.[0]?.contentPath, "runtime-output/artifacts/knowledge/approval.md");
    assert.equal(manifest.proposals?.[0]?.assignToSelf, true);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("output sheets commands cover read, update, and batch manifests", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-output-command-"));
  try {
    assert.equal(
      await runOutputCommand(
        "sheets",
        [
          "read",
          "--document-id",
          "channel-doc-123",
          "--range",
          "Research!A1:B2",
          "--intent",
          "Read rows",
          "--work-dir",
          workDir,
        ],
        "text",
      ),
      0,
    );
    assert.equal(
      await runOutputCommand(
        "sheets",
        [
          "update-values",
          "--document-id",
          "channel-doc-123",
          "--range",
          "Research!C2:C2",
          "--intent",
          "Update score",
          "--values-json",
          "[[5]]",
          "--work-dir",
          workDir,
        ],
        "text",
      ),
      0,
    );
    assert.equal(
      await runOutputCommand(
        "sheets",
        [
          "batch-update",
          "--document-id",
          "channel-doc-123",
          "--intent",
          "Freeze header",
          "--requests-json",
          "[{\"updateSheetProperties\":{\"properties\":{\"sheetId\":0,\"gridProperties\":{\"frozenRowCount\":1}},\"fields\":\"gridProperties.frozenRowCount\"}}]",
          "--work-dir",
          workDir,
        ],
        "text",
      ),
      0,
    );
    assert.equal(await runOutputCommand("sheets", ["read", "--help"], "text"), 0);

    const sheets = JSON.parse(readFileSync(join(workDir, "runtime-output", "external-sheets.json"), "utf8")) as {
      operations?: Array<{ operationType: string; rangeA1?: string; values?: unknown[][]; requests?: unknown[] }>;
    };
    assert.deepEqual(sheets.operations?.map((operation) => operation.operationType), [
      "read",
      "update_values",
      "batch_update",
    ]);
    assert.equal(sheets.operations?.[0]?.rangeA1, "Research!A1:B2");
    assert.deepEqual(sheets.operations?.[1]?.values, [[5]]);
    assert.equal(sheets.operations?.[2]?.requests?.length, 1);
    assert.equal(await runOutputCommand("validate", ["--work-dir", workDir], "text"), 0);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("output sheets-result add registers executed gws JSON results", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-output-command-"));
  try {
    const sheetsDir = join(workDir, "runtime-output", "artifacts", "sheets");
    mkdirSync(sheetsDir, { recursive: true });
    writeFileSync(
      join(sheetsDir, "read-1.json"),
      JSON.stringify({
        range: "Sheet1!A1:C3",
        values: [
          ["Name", "Status", "Owner"],
          ["Acme", "Open", "Vega"],
          ["Globex", "Done", "Nova"],
        ],
      }),
      "utf8",
    );

    assert.equal(
      await runOutputCommand(
        "sheets-result",
        [
          "add",
          "--document-id",
          "channel-doc-123",
          "--operation",
          "read",
          "--range",
          "Sheet1!A1:C3",
          "--result-json",
          "runtime-output/artifacts/sheets/read-1.json",
          "--summary",
          "Read competitor status.",
          "--work-dir",
          workDir,
        ],
        "text",
      ),
      0,
    );
    assert.equal(await runOutputCommand("validate", ["--work-dir", workDir], "text"), 0);

    const manifest = JSON.parse(readFileSync(join(workDir, "runtime-output", "external-sheets-results.json"), "utf8")) as {
      results?: Array<{ operation?: string; resultPath?: string; rowCount?: number; cellCount?: number; headers?: string[] }>;
    };
    assert.equal(manifest.results?.[0]?.operation, "read");
    assert.equal(manifest.results?.[0]?.resultPath, "runtime-output/artifacts/sheets/read-1.json");
    assert.equal(manifest.results?.[0]?.rowCount, 3);
    assert.equal(manifest.results?.[0]?.cellCount, 9);
    assert.deepEqual(manifest.results?.[0]?.headers, ["Name", "Status", "Owner"]);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("output google-docs commands create validated manifests from artifact files", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-output-command-"));
  try {
    const docsDir = join(workDir, "runtime-output", "artifacts", "docs");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, "summary.md"), "\n## Summary\n- Launch approved.\n", "utf8");
    writeFileSync(
      join(docsDir, "requests.json"),
      JSON.stringify([
        {
          insertText: {
            text: "hello",
            endOfSegmentLocation: { segmentId: "" },
          },
        },
      ]),
      "utf8",
    );

    assert.equal(
      await runOutputCommand(
        "google-docs",
        [
          "append-text",
          "--document-id",
          "channel-doc-google-doc-1",
          "--intent",
          "Append meeting summary",
          "--text-file",
          "runtime-output/artifacts/docs/summary.md",
          "--work-dir",
          workDir,
        ],
        "text",
      ),
      0,
    );
    assert.equal(
      await runOutputCommand(
        "google-docs",
        [
          "batch-update",
          "--document-id",
          "channel-doc-google-doc-1",
          "--intent",
          "Apply structured Docs changes",
          "--requests-json",
          "runtime-output/artifacts/docs/requests.json",
          "--request-summary",
          "Insert greeting",
          "--work-dir",
          workDir,
        ],
        "text",
      ),
      0,
    );
    assert.equal(await runOutputCommand("validate", ["--work-dir", workDir], "text"), 0);

    const manifest = JSON.parse(readFileSync(join(workDir, "runtime-output", "external-google-docs.json"), "utf8")) as {
      operations?: Array<{
        operationType?: string;
        text?: string;
        textPath?: string;
        requests?: unknown[];
        requestsPath?: string;
        requestSummary?: string;
      }>;
    };
    assert.equal(manifest.operations?.[0]?.operationType, "append_text");
    assert.equal(manifest.operations?.[0]?.textPath, "runtime-output/artifacts/docs/summary.md");
    assert.match(manifest.operations?.[0]?.text ?? "", /Launch approved/);
    assert.equal(manifest.operations?.[1]?.operationType, "batch_update");
    assert.equal(manifest.operations?.[1]?.requestsPath, "runtime-output/artifacts/docs/requests.json");
    assert.equal(manifest.operations?.[1]?.requests?.length, 1);
    assert.equal(manifest.operations?.[1]?.requestSummary, "Insert greeting");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("output google-docs rejects token material in artifacts", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-output-command-"));
  try {
    const docsDir = join(workDir, "runtime-output", "artifacts", "docs");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, "summary.md"), "Bearer ya29.secret-token-material", "utf8");

    assert.equal(
      await runOutputCommand(
        "google-docs",
        [
          "append-text",
          "--document-id",
          "channel-doc-google-doc-1",
          "--intent",
          "Append token",
          "--text-file",
          "runtime-output/artifacts/docs/summary.md",
          "--work-dir",
          workDir,
        ],
        "text",
      ),
      1,
    );
    assert.equal(existsSync(join(workDir, "runtime-output", "external-google-docs.json")), false);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("output external-document and permission commands write controlled manifests", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-output-command-"));
  try {
    assert.equal(
      await runOutputCommand(
        "external-document",
        [
          "link-google-sheet",
          "--source-document-id",
          "channel-doc-123",
          "--target-channel",
          "general",
          "--title",
          "Shared Sheet",
          "--work-dir",
          workDir,
        ],
        "text",
      ),
      0,
    );
    assert.equal(
      await runOutputCommand(
        "permission",
        [
          "request-document",
          "--role",
          "forwarder",
          "--reason",
          "Need to share it with general.",
          "--document-id",
          "channel-doc-123",
          "--target-channel",
          "general",
          "--work-dir",
          workDir,
        ],
        "text",
      ),
      0,
    );
    assert.equal(await runOutputCommand("validate", ["--work-dir", workDir], "text"), 0);

    const externalDocuments = JSON.parse(readFileSync(join(workDir, "runtime-output", "external-documents.json"), "utf8")) as {
      generatedBy?: string;
      operations?: Array<{ operationType?: string; sourceDocumentId?: string }>;
    };
    const permissionRequests = JSON.parse(readFileSync(join(workDir, "runtime-output", "permission-requests.json"), "utf8")) as {
      generatedBy?: string;
      requests?: Array<{ requestedRole?: string; documentId?: string }>;
    };
    assert.equal(externalDocuments.generatedBy, "agent-space-cli");
    assert.equal(externalDocuments.operations?.[0]?.operationType, "link_google_sheet");
    assert.equal(externalDocuments.operations?.[0]?.sourceDocumentId, "channel-doc-123");
    assert.equal(permissionRequests.generatedBy, "agent-space-cli");
    assert.equal(permissionRequests.requests?.[0]?.requestedRole, "forwarder");
    assert.equal(permissionRequests.requests?.[0]?.documentId, "channel-doc-123");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("output external-document create-google-sheet writes controlled manifest", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-output-command-"));
  try {
    const artifactDir = join(workDir, "runtime-output", "artifacts", "sheets");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(
      join(artifactDir, "create-sheet.json"),
      JSON.stringify({
        id: "spreadsheet-created-123",
        name: "Created Sheet",
        webViewLink: "https://docs.google.com/spreadsheets/d/spreadsheet-created-123/edit",
        mimeType: "application/vnd.google-apps.spreadsheet",
        modifiedTime: "2026-05-20T00:00:00.000Z",
      }),
      "utf8",
    );

    assert.equal(
      await runOutputCommand(
        "external-document",
        [
          "create-google-sheet",
          "--external-file-id",
          "spreadsheet-created-123",
          "--external-url",
          "https://docs.google.com/spreadsheets/d/spreadsheet-created-123/edit",
          "--target-channel",
          "general",
          "--title",
          "Created Sheet",
          "--summary",
          "Agent-created sheet.",
          "--gws-result-json",
          "runtime-output/artifacts/sheets/create-sheet.json",
          "--work-dir",
          workDir,
        ],
        "text",
      ),
      0,
    );
    assert.equal(await runOutputCommand("validate", ["--work-dir", workDir], "text"), 0);

    const externalDocuments = JSON.parse(readFileSync(join(workDir, "runtime-output", "external-documents.json"), "utf8")) as {
      generatedBy?: string;
      operations?: Array<{ operationType?: string; externalFileId?: string; resultPath?: string }>;
    };
    assert.equal(externalDocuments.generatedBy, "agent-space-cli");
    assert.equal(externalDocuments.operations?.[0]?.operationType, "create_google_sheet");
    assert.equal(externalDocuments.operations?.[0]?.externalFileId, "spreadsheet-created-123");
    assert.equal(externalDocuments.operations?.[0]?.resultPath, "runtime-output/artifacts/sheets/create-sheet.json");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("output external-document create-google-sheet rejects mismatched gws result", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-output-command-"));
  try {
    const artifactDir = join(workDir, "runtime-output", "artifacts", "sheets");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(
      join(artifactDir, "create-sheet.json"),
      JSON.stringify({
        id: "other-spreadsheet",
        webViewLink: "https://docs.google.com/spreadsheets/d/other-spreadsheet/edit",
        mimeType: "application/vnd.google-apps.spreadsheet",
      }),
      "utf8",
    );

    assert.equal(
      await runOutputCommand(
        "external-document",
        [
          "create-google-sheet",
          "--external-file-id",
          "spreadsheet-created-123",
          "--external-url",
          "https://docs.google.com/spreadsheets/d/spreadsheet-created-123/edit",
          "--target-channel",
          "general",
          "--title",
          "Created Sheet",
          "--gws-result-json",
          "runtime-output/artifacts/sheets/create-sheet.json",
          "--work-dir",
          workDir,
        ],
        "text",
      ),
      1,
    );
    assert.equal(existsSync(join(workDir, "runtime-output", "external-documents.json")), false);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("output feishu data-operation-approval writes controlled approval request manifest", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-output-command-"));
  try {
    assert.equal(
      await runOutputCommand(
        "feishu",
        [
          "data-operation-approval",
          "--operation",
          "sheets.update_range",
          "--type",
          "sheet",
          "--resource",
          "shtcnABC123",
          "--range",
          "Sheet1!A1:B1",
          "--values-json",
          "[[\"AgentSpace smoke\"]]",
          "--preview",
          "Update smoke range",
          "--work-dir",
          workDir,
        ],
        "text",
      ),
      0,
    );
    assert.equal(await runOutputCommand("validate", ["--work-dir", workDir], "text"), 0);

    const manifest = JSON.parse(
      readFileSync(join(workDir, FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_RELATIVE_PATH), "utf8"),
    ) as {
      kind?: string;
      generatedBy?: string;
      requests?: Array<{
        operationType?: string;
        providerResourceType?: string;
        providerResourceToken?: string;
        parameters?: Record<string, unknown>;
        contentPreview?: string;
      }>;
    };
    assert.equal(manifest.kind, FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_KIND);
    assert.equal(manifest.generatedBy, "agent-space-cli");
    assert.equal(manifest.requests?.[0]?.operationType, "sheets.update_range");
    assert.equal(manifest.requests?.[0]?.providerResourceType, "sheet");
    assert.equal(manifest.requests?.[0]?.providerResourceToken, "shtcnABC123");
    assert.deepEqual(manifest.requests?.[0]?.parameters, {
      range: "Sheet1!A1:B1",
      values: [["AgentSpace smoke"]],
    });
    assert.equal(manifest.requests?.[0]?.contentPreview, "Update smoke range");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});


test("output skill import packages local skills into runtime-output artifacts", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-output-command-"));
  const skillDir = mkdtempSync(join(tmpdir(), "agent-space-local-skill-"));
  try {
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: local-skill\n---\n# Local\n", "utf8");
    assert.equal(
      await runOutputCommand(
        "skill",
        ["import", "--local-path", skillDir, "--conflict", "rename", "--work-dir", workDir],
        "text",
      ),
      0,
    );

    const manifest = JSON.parse(readFileSync(join(workDir, "runtime-output", "skill-imports.json"), "utf8")) as {
      imports?: Array<{ path?: string; conflict?: string }>;
    };
    assert.match(manifest.imports?.[0]?.path ?? "", /^runtime-output\/artifacts\/skills\/agent-space-local-skill-/);
    assert.equal(manifest.imports?.[0]?.conflict, "rename");
    assert.equal(await runOutputCommand("validate", ["--work-dir", workDir], "text"), 0);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    rmSync(skillDir, { recursive: true, force: true });
  }
});
