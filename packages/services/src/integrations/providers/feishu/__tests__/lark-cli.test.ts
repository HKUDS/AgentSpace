import assert from "node:assert/strict";
import test from "node:test";
import type { ExternalResourceBindingRecord } from "@agent-space/db";
import {
  FEISHU_LARK_CLI_MANIFEST_SCHEMA_VERSION,
  FEISHU_LARK_CLI_OPERATION_MANIFEST_KIND,
  FEISHU_LARK_CLI_RESULT_MANIFEST_KIND,
  buildFeishuLarkCliAllowedShellPatterns,
  buildFeishuLarkCliOperationManifest,
  buildFeishuLarkCliResourceGrantFromBinding,
  buildFeishuLarkCliRuntimeToolCapability,
  diagnoseFeishuLarkCliRuntime,
  resolveFeishuLarkCliCommand,
  summarizeFeishuLarkCliResultManifest,
} from "../lark-cli.ts";

test("builds token-scoped read-only lark-cli capability for Feishu Sheets", () => {
  const capability = buildFeishuLarkCliRuntimeToolCapability({
    command: "lark-cli",
    includeDiagnostics: true,
    resourceGrants: [{
      providerResourceType: "sheet",
      providerResourceToken: "shtcnABC123",
      allowedOperations: ["read"],
    }],
  });

  assert.ok(capability);
  assert.ok(capability.allowedShellPatterns.includes("lark-cli --version"));
  assert.ok(capability.allowedShellPatterns.includes("lark-cli auth status"));
  assert.ok(capability.allowedShellPatterns.includes("lark-cli sheets +workbook-info *shtcnABC123*"));
  assert.ok(capability.allowedShellPatterns.includes("lark-cli sheets +csv-get *shtcnABC123*"));
  assert.equal(capability.allowedShellPatterns.some((pattern) => pattern.includes("+csv-put")), false);
});

test("keeps runtime lark-cli grants read-only until an approved operation manifest is issued", () => {
  const patterns = buildFeishuLarkCliAllowedShellPatterns({
    command: "lark-cli",
    resourceGrants: [{
      providerResourceType: "doc",
      providerResourceToken: "doccnABC123",
      allowedOperations: ["read", "write"],
    }],
  });

  assert.ok(patterns.includes("lark-cli docs +fetch *doccnABC123*"));
  assert.equal(patterns.some((pattern) => pattern.includes("+update")), false);
});

test("adds lark-cli write patterns only for approved operation manifests", () => {
  const patterns = buildFeishuLarkCliAllowedShellPatterns({
    command: "lark-cli",
    includeWritePatterns: true,
    resourceGrants: [{
      providerResourceType: "doc",
      providerResourceToken: "doccnABC123",
      allowedOperations: ["read", "write"],
    }],
  });

  assert.ok(patterns.includes("lark-cli docs +fetch *doccnABC123*"));
  assert.ok(patterns.includes("lark-cli docs +update *doccnABC123*"));
});

test("skips unsafe resource tokens in lark-cli shell patterns", () => {
  const patterns = buildFeishuLarkCliAllowedShellPatterns({
    command: "lark-cli",
    includeDiagnostics: true,
    resourceGrants: [{
      providerResourceType: "doc",
      providerResourceToken: "doc*bad",
      allowedOperations: ["read", "write"],
    }],
  });

  assert.ok(patterns.includes("lark-cli --version"));
  assert.equal(patterns.some((pattern) => pattern.includes("doc*bad")), false);
});

test("derives Base table scoped lark-cli grant from resource binding URL", () => {
  const grant = buildFeishuLarkCliResourceGrantFromBinding(createBinding({
    providerResourceType: "base_table",
    providerResourceToken: "tblABC123",
    providerResourceUrl: "https://example.feishu.cn/base/bascnABC123?table=tblABC123&view=vewABC123",
    permissionsJson: JSON.stringify({ canWrite: true }),
  }));

  assert.ok(grant);
  assert.equal(grant.baseToken, "bascnABC123");
  assert.equal(grant.tableId, "tblABC123");
  assert.equal(grant.viewId, "vewABC123");
  assert.deepEqual(grant.allowedOperations, ["read", "write"]);

  const patterns = buildFeishuLarkCliAllowedShellPatterns({
    command: "lark-cli",
    resourceGrants: [grant],
  });
  assert.ok(patterns.includes("lark-cli base +record-list *bascnABC123*tblABC123*"));
  assert.equal(patterns.some((pattern) => pattern.includes("+record-update")), false);
});

test("resolves lark-cli executor from AgentSpace Feishu environment", () => {
  assert.equal(resolveFeishuLarkCliCommand({}), "lark-cli");
  assert.equal(
    resolveFeishuLarkCliCommand({ AGENT_SPACE_FEISHU_LARK_CLI_EXECUTOR: "/opt/lark/bin/lark-cli" }),
    "/opt/lark/bin/lark-cli",
  );
  assert.equal(
    resolveFeishuLarkCliCommand({ AGENT_SPACE_FEISHU_LARK_CLI_EXECUTOR: "npx lark-cli" }),
    "lark-cli",
  );
});

test("diagnoses Feishu lark-cli runtime readiness", () => {
  assert.deepEqual(diagnoseFeishuLarkCliRuntime({ environment: {} }), {
    status: "disabled",
    reasonCode: "feishu.lark_cli.disabled",
    message: "Feishu lark-cli runtime capability is not enabled.",
  });

  assert.deepEqual(diagnoseFeishuLarkCliRuntime({
    environment: { AGENT_SPACE_FEISHU_LARK_CLI_EXECUTOR: "npx lark-cli" },
  }), {
    status: "blocked",
    reasonCode: "feishu.lark_cli.invalid_executor",
    message: "AGENT_SPACE_FEISHU_LARK_CLI_EXECUTOR must be a single executable name or path without shell arguments.",
    command: "npx lark-cli",
  });

  assert.deepEqual(diagnoseFeishuLarkCliRuntime({
    environment: { AGENT_SPACE_FEISHU_LARK_CLI_ENABLED: "true" },
    includeDiagnostics: true,
    commandExists: () => false,
  }), {
    status: "unavailable",
    reasonCode: "feishu.lark_cli.command_missing",
    message: 'Feishu lark-cli command "lark-cli" is not available on the runtime PATH.',
    command: "lark-cli",
  });

  const available = diagnoseFeishuLarkCliRuntime({
    environment: { AGENT_SPACE_FEISHU_LARK_CLI_ENABLED: "true" },
    includeDiagnostics: true,
    commandExists: () => true,
  });
  assert.equal(available.status, "available");
  assert.equal(available.command, "lark-cli");
  assert.ok(available.capability?.allowedShellPatterns.includes("lark-cli auth status"));
});

test("builds scoped lark-cli operation manifests for approved Feishu writes", () => {
  const manifest = buildFeishuLarkCliOperationManifest({
    operationRunId: "external-data-operation-123",
    payloadHash: "sha256:abcdef",
    expiresAt: "2026-06-24T10:15:00.000Z",
    command: "lark-cli",
    request: {
      operationType: "docs.update_document",
      providerResourceType: "doc",
      providerResourceToken: "doccnABC123",
      actorType: "agent",
      actorId: "Atlas",
      parameters: {
        content: "raw document text must not be copied into the manifest",
      },
    },
    resourceGrant: {
      providerResourceType: "doc",
      providerResourceToken: "doccnABC123",
      allowedOperations: ["read", "write"],
    },
    requestSummary: {
      mutation: "append_children",
      requestCount: 1,
      text: "raw text should be dropped",
      appToken: "tenant-token-should-be-dropped",
      appSecret: "app-secret-should-be-dropped",
      tenantAccessToken: "tenant-access-token-should-be-dropped",
      verificationToken: "verification-token-should-be-dropped",
      encryptKey: "encrypt-key-should-be-dropped",
      credentials: {
        appSecret: "nested-app-secret-should-be-dropped",
      },
      diagnostics: {
        status: "ready",
        accessToken: "nested-access-token-should-be-dropped",
      },
    },
  });

  assert.ok(manifest);
  assert.equal(manifest.kind, FEISHU_LARK_CLI_OPERATION_MANIFEST_KIND);
  assert.equal(manifest.schemaVersion, FEISHU_LARK_CLI_MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.operationKind, "write");
  assert.equal(manifest.payloadHash, "sha256:abcdef");
  assert.equal(manifest.resultManifestPath, "runtime-output/feishu-data-operation-result.json");
  assert.deepEqual(manifest.allowedResourceTokens, ["doccnABC123"]);
  assert.ok(manifest.allowedShellPatterns.includes("lark-cli docs +update *doccnABC123*"));
  assert.deepEqual(manifest.requestSummary, {
    diagnostics: {
      status: "ready",
    },
    mutation: "append_children",
    requestCount: 1,
  });
  assert.equal(JSON.stringify(manifest).includes("raw document text"), false);
  assert.equal(JSON.stringify(manifest).includes("tenant-token-should-be-dropped"), false);
  assert.equal(JSON.stringify(manifest).includes("app-secret-should-be-dropped"), false);
  assert.equal(JSON.stringify(manifest).includes("tenant-access-token-should-be-dropped"), false);
  assert.equal(JSON.stringify(manifest).includes("verification-token-should-be-dropped"), false);
  assert.equal(JSON.stringify(manifest).includes("encrypt-key-should-be-dropped"), false);
  assert.equal(JSON.stringify(manifest).includes("nested-app-secret-should-be-dropped"), false);
  assert.equal(JSON.stringify(manifest).includes("nested-access-token-should-be-dropped"), false);
});

test("refuses lark-cli write manifests without approval hash or write grant", () => {
  const request = {
    operationType: "sheets.update_range",
    providerResourceType: "sheet",
    providerResourceToken: "shtcnABC123",
    actorType: "agent",
    actorId: "Atlas",
    parameters: {},
  } as const;

  assert.equal(buildFeishuLarkCliOperationManifest({
    operationRunId: "external-data-operation-123",
    request,
    resourceGrant: {
      providerResourceType: "sheet",
      providerResourceToken: "shtcnABC123",
      allowedOperations: ["read", "write"],
    },
  }), undefined);

  assert.equal(buildFeishuLarkCliOperationManifest({
    operationRunId: "external-data-operation-123",
    payloadHash: "sha256:abcdef",
    request,
    resourceGrant: {
      providerResourceType: "sheet",
      providerResourceToken: "shtcnABC123",
      allowedOperations: ["read"],
    },
  }), undefined);
});

test("summarizes lark-cli result manifests without storing raw Feishu content", () => {
  const result = summarizeFeishuLarkCliResultManifest({
    kind: FEISHU_LARK_CLI_RESULT_MANIFEST_KIND,
    schemaVersion: FEISHU_LARK_CLI_MANIFEST_SCHEMA_VERSION,
    ok: true,
    operationRunId: "external-data-operation-123",
    payloadHash: "sha256:abcdef",
    operationType: "sheets.update_range",
    providerResourceType: "sheet",
    providerResourceToken: "shtcnABC123",
    responseSummary: "Updated one range.",
    externalRevisionId: "rev-1",
    data: {
      values: [["secret cell"]],
      rows: [{ secret: "do not store" }],
      spreadsheetToken: "shtcnABC123",
      tableId: "tblSecret123",
      updatedRange: "Plan!A1:B2",
      recordIds: ["recSecret123"],
      rowCount: 1,
      cellCount: 2,
      artifactPath: "runtime-output/artifacts/feishu/result.json",
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    source: "lark-cli",
    resultManifestKind: FEISHU_LARK_CLI_RESULT_MANIFEST_KIND,
    provider: "feishu",
    operationRunId: "external-data-operation-123",
    payloadHash: "sha256:abcdef",
    operationType: "sheets.update_range",
    providerResourceType: "sheet",
    externalRevisionReference: result.data?.externalRevisionReference,
    responseSummaryRedacted: true,
    resource: {
      spreadsheetReference: (result.data?.resource as Record<string, unknown>).spreadsheetReference,
      tableReference: (result.data?.resource as Record<string, unknown>).tableReference,
      rangeRedacted: true,
      recordReferences: (result.data?.resource as Record<string, unknown>).recordReferences,
      artifactPath: "runtime-output/artifacts/feishu/result.json",
    },
    metrics: {
      rowCount: 1,
      cellCount: 2,
    },
  });
  const resource = result.data?.resource as Record<string, unknown>;
  assert.equal(typeof resource.spreadsheetReference, "string");
  assert.equal(String(resource.spreadsheetReference).startsWith("ref_"), true);
  assert.equal(typeof resource.tableReference, "string");
  assert.equal(String(resource.tableReference).startsWith("ref_"), true);
  assert.ok(Array.isArray(resource.recordReferences));
  assert.equal(typeof result.data?.externalRevisionReference, "string");
  assert.equal(JSON.stringify(result.data).includes("shtcnABC123"), false);
  assert.equal(JSON.stringify(result.data).includes("tblSecret123"), false);
  assert.equal(JSON.stringify(result.data).includes("Plan!A1:B2"), false);
  assert.equal(JSON.stringify(result.data).includes("recSecret123"), false);
  assert.equal(JSON.stringify(result.data).includes("rev-1"), false);
  assert.equal(JSON.stringify(result.data).includes("Updated one range."), false);
  assert.equal(JSON.stringify(result.data).includes("secret cell"), false);
  assert.equal(JSON.stringify(result.data).includes("do not store"), false);
});

test("normalizes failed and invalid lark-cli result manifests", () => {
  const failed = summarizeFeishuLarkCliResultManifest({
    kind: FEISHU_LARK_CLI_RESULT_MANIFEST_KIND,
    schemaVersion: FEISHU_LARK_CLI_MANIFEST_SCHEMA_VERSION,
    status: "failed",
    operationRunId: "external-data-operation-123",
    errorCode: "feishu.permission_denied",
    errorMessage: "Permission denied.",
  });

  assert.equal(failed.ok, false);
  assert.equal(failed.errorCode, "feishu.permission_denied");
  assert.equal(failed.errorMessage, "Permission denied.");
  assert.equal(failed.data?.operationRunId, "external-data-operation-123");

  const invalid = summarizeFeishuLarkCliResultManifest({ ok: true });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errorCode, "feishu.lark_cli.invalid_result_manifest");
});

function createBinding(overrides: Partial<ExternalResourceBindingRecord>): ExternalResourceBindingRecord {
  const now = "2026-06-24T00:00:00.000Z";
  return {
    id: "binding-1",
    workspaceId: "workspace-1",
    integrationId: "integration-1",
    providerResourceType: "doc",
    providerResourceToken: "doccnABC123",
    providerResourceUrl: undefined,
    agentSpaceResourceType: "channel_document",
    agentSpaceResourceId: "document-1",
    channelName: "research",
    displayName: "Research Doc",
    status: "active",
    permissionsJson: "{}",
    metadataJson: "{}",
    createdByUserId: "user-1",
    createdAt: now,
    updatedAt: now,
    archivedAt: undefined,
    ...overrides,
  };
}
