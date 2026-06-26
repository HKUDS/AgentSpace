import assert from "node:assert/strict";
import test from "node:test";
import type { AgentDocumentContext } from "@agent-space/services";
import { buildDocumentRuntimeToolCapabilities } from "./document-runtime-capabilities.ts";

test("document runtime capabilities keep viewer-only Google Sheets read-only", () => {
  const capabilities = buildDocumentRuntimeToolCapabilities([
    createGoogleSheetContext({
      role: "viewer",
      allowedActions: ["view"],
    }),
  ]);
  const patterns = capabilities.flatMap((capability) => capability.allowedShellPatterns);

  assert.ok(patterns.includes("gws sheets spreadsheets values get *"));
  assert.ok(patterns.includes("gws drive files get *"));
  assert.equal(patterns.some((pattern) => pattern.includes("values append")), false);
  assert.equal(patterns.some((pattern) => pattern.includes("values update")), false);
  assert.equal(patterns.some((pattern) => pattern.includes("batchUpdate")), false);
  assert.equal(patterns.some((pattern) => pattern.includes("external-document link-google-sheet")), false);
});

test("document runtime capabilities grant controlled forwarding only for forwarder Google Sheets", () => {
  const capabilities = buildDocumentRuntimeToolCapabilities([
    createGoogleSheetContext({
      role: "forwarder",
      allowedActions: ["view", "edit", "forward"],
    }),
  ]);
  const patterns = capabilities.flatMap((capability) => capability.allowedShellPatterns);

  assert.ok(patterns.includes("gws sheets spreadsheets values append *"));
  assert.ok(patterns.includes("gws sheets spreadsheets values update *"));
  assert.ok(patterns.includes("gws sheets spreadsheets batchUpdate *"));
  assert.ok(patterns.includes("agent-space output external-document link-google-sheet *"));
});

test("document runtime capabilities expose Google Sheet creation only when enabled", () => {
  const withoutCreate = buildDocumentRuntimeToolCapabilities([]);
  const withoutPatterns = withoutCreate.flatMap((capability) => capability.allowedShellPatterns);
  assert.equal(withoutPatterns.includes("gws drive files create *"), false);
  assert.equal(withoutPatterns.includes("agent-space output external-document create-google-sheet *"), false);

  const withCreate = buildDocumentRuntimeToolCapabilities([], { canCreateGoogleSheet: true });
  const withPatterns = withCreate.flatMap((capability) => capability.allowedShellPatterns);
  assert.ok(withPatterns.includes("gws drive files create *"));
  assert.ok(withPatterns.includes("agent-space output external-document create-google-sheet *"));
  assert.equal(withPatterns.includes("gws sheets spreadsheets values update *"), false);
});

test("document runtime capabilities expose scoped Feishu lark-cli grants", () => {
  const capabilities = buildDocumentRuntimeToolCapabilities([], {
    feishuLarkCliResourceGrants: [{
      providerResourceType: "sheet",
      providerResourceToken: "shtcnABC123",
      allowedOperations: ["read"],
    }],
  });
  const feishuCapability = capabilities.find((capability) => capability.id === "document-permission:feishu-lark-cli");
  const patterns = capabilities.flatMap((capability) => capability.allowedShellPatterns);

  assert.ok(feishuCapability);
  assert.equal(feishuCapability.command, "lark-cli");
  assert.ok(feishuCapability.allowedShellPatterns.includes("lark-cli --version"));
  assert.ok(feishuCapability.allowedShellPatterns.includes("lark-cli sheets +csv-get *shtcnABC123*"));
  assert.equal(feishuCapability.allowedShellPatterns.some((pattern) => pattern.includes("+csv-put")), false);
  assert.equal(patterns.includes("agent-space output feishu data-operation-approval *"), false);
});

test("document runtime capabilities expose Feishu approval output only for writable grants", () => {
  const capabilities = buildDocumentRuntimeToolCapabilities([], {
    feishuLarkCliResourceGrants: [{
      providerResourceType: "sheet",
      providerResourceToken: "shtcnABC123",
      allowedOperations: ["read", "write"],
    }],
  });
  const patterns = capabilities.flatMap((capability) => capability.allowedShellPatterns);

  assert.ok(patterns.includes("agent-space output feishu data-operation-approval *"));
  assert.equal(patterns.some((pattern) => pattern.includes("+csv-put")), false);
});

function createGoogleSheetContext(input: {
  role: AgentDocumentContext["role"];
  allowedActions: AgentDocumentContext["allowedActions"];
}): AgentDocumentContext {
  return {
    document: {
      id: `doc-${input.role}`,
      channelName: "research",
      title: `${input.role} Sheet`,
      slug: `${input.role}-sheet`,
      kind: "sheet",
      storageMode: "external",
      externalProvider: "google_workspace",
      externalFileId: `sheet-${input.role}`,
      externalUrl: `https://docs.google.com/spreadsheets/d/sheet-${input.role}/edit`,
      summary: "",
      status: "active",
      currentVersionId: `version-${input.role}`,
      lastEditorType: "human",
      createdBy: "Mina",
      updatedBy: "Mina",
      createdAt: "2026-05-09T00:00:00.000Z",
      updatedAt: "2026-05-09T00:00:00.000Z",
    },
    role: input.role,
    source: input.role === "forwarder" ? "forward_grant" : "channel_context",
    allowedActions: input.allowedActions,
  };
}
