import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const tempFixtureDirectories: string[] = [];
process.on("exit", () => {
  for (const directory of tempFixtureDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("verifies a complete strict live Feishu smoke evidence artifact", () => {
  const evidencePath = writeEvidenceFixture(buildEvidenceFixture());
  const result = runVerifyEvidence(evidencePath);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as {
    valid: boolean;
    issues: string[];
    summary: {
      liveChecks: number;
      livePassed: number;
      requiredLiveSteps: number;
      destructiveLiveChecks: number;
      todo120NativeSmokeReady: boolean;
      todo120NativeSmokeRequiredForCommand: boolean;
      todo120NativeSmokeRequired: number;
      todo120NativeSmokeConfigured: number;
    };
  };
  assert.equal(output.valid, true);
  assert.deepEqual(output.issues, []);
  assert.equal(output.summary.liveChecks, 12);
  assert.equal(output.summary.livePassed, 12);
  assert.equal(output.summary.requiredLiveSteps, 12);
  assert.equal(output.summary.destructiveLiveChecks, 3);
  assert.equal(output.summary.todo120NativeSmokeReady, true);
  assert.equal(output.summary.todo120NativeSmokeRequiredForCommand, true);
  assert.equal(output.summary.todo120NativeSmokeRequired, 2);
  assert.equal(output.summary.todo120NativeSmokeConfigured, 2);
});

test("rejects old Feishu smoke evidence that lacks Doc append coverage", () => {
  const evidence = buildEvidenceFixture();
  evidence.steps = evidence.steps.filter((step) => step.name !== "Docs docx append blocks");
  evidence.summary.liveChecks = 11;
  evidence.summary.livePassed = 11;
  evidence.summary.destructiveLiveChecks = 2;
  const evidencePath = writeEvidenceFixture(evidence);
  const result = runVerifyEvidence(evidencePath);

  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout) as {
    valid: boolean;
    issues: string[];
    summary: {
      requiredLiveSteps: number;
    };
  };
  assert.equal(output.valid, false);
  assert.equal(output.summary.requiredLiveSteps, 12);
  assert.ok(output.issues.includes("required_step_missing:Docs docx append blocks"));
  assert.ok(output.issues.includes("live_check_summary_incomplete"));
  assert.ok(output.issues.includes("live_passed_summary_incomplete"));
  assert.ok(output.issues.includes("doc_append_not_marked_destructive"));
  assert.ok(output.issues.includes("destructive_live_checks_missing"));
});

test("rejects Feishu smoke evidence without TODO120 native multi-agent proof", () => {
  const evidence = buildEvidenceFixture();
  delete (evidence as Partial<ReturnType<typeof buildEvidenceFixture>>).todo120NativeSmoke;
  const evidencePath = writeEvidenceFixture(evidence);
  const result = runVerifyEvidence(evidencePath);

  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout) as {
    valid: boolean;
    issues: string[];
    summary: {
      todo120NativeSmokeReady: boolean;
      todo120NativeSmokeRequiredForCommand: boolean;
      todo120NativeSmokeRequired: number;
      todo120NativeSmokeConfigured: number;
    };
  };
  assert.equal(output.valid, false);
  assert.equal(output.summary.todo120NativeSmokeReady, false);
  assert.equal(output.summary.todo120NativeSmokeRequiredForCommand, false);
  assert.equal(output.summary.todo120NativeSmokeRequired, 0);
  assert.equal(output.summary.todo120NativeSmokeConfigured, 0);
  assert.ok(output.issues.includes("todo120_native_smoke_missing"));
});

test("rejects Feishu smoke evidence when TODO120 native multi-agent env was not required", () => {
  const evidence = buildEvidenceFixture();
  evidence.todo120NativeSmoke.requiredForCommand = false;
  const evidencePath = writeEvidenceFixture(evidence);
  const result = runVerifyEvidence(evidencePath);

  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout) as {
    valid: boolean;
    issues: string[];
    summary: {
      todo120NativeSmokeReady: boolean;
      todo120NativeSmokeRequiredForCommand: boolean;
      todo120NativeSmokeRequired: number;
      todo120NativeSmokeConfigured: number;
    };
  };
  assert.equal(output.valid, false);
  assert.equal(output.summary.todo120NativeSmokeReady, true);
  assert.equal(output.summary.todo120NativeSmokeRequiredForCommand, false);
  assert.equal(output.summary.todo120NativeSmokeRequired, 2);
  assert.equal(output.summary.todo120NativeSmokeConfigured, 2);
  assert.ok(output.issues.includes("todo120_native_smoke_not_required"));
});

test("rejects Feishu smoke evidence with unredacted resource tokens", () => {
  const evidence = buildEvidenceFixture();
  const docStep = evidence.steps.find((step) => step.name === "Docs docx read blocks");
  if (!docStep?.request) {
    throw new Error("Missing Docs docx read blocks request fixture.");
  }
  docStep.request.path = "/open-apis/docx/v1/documents/doccn_secret/blocks";
  const docAppendStep = evidence.steps.find((step) => step.name === "Docs docx append blocks");
  if (!docAppendStep?.request) {
    throw new Error("Missing Docs docx append blocks request fixture.");
  }
  docAppendStep.request.path = "/open-apis/docx/v1/documents/doccn_secret/blocks/blk_secret/children";
  const sheetStep = evidence.steps.find((step) => step.name === "Sheets read values");
  if (!sheetStep?.request) {
    throw new Error("Missing Sheets read values request fixture.");
  }
  sheetStep.request.path = "/open-apis/sheets/v2/spreadsheets/:sheet_token/values/SecretSheet!A1:B2";
  const baseListStep = evidence.steps.find((step) => step.name === "Base list records");
  if (!baseListStep?.request) {
    throw new Error("Missing Base list records request fixture.");
  }
  baseListStep.request.path = "/open-apis/bitable/v1/apps/:app_token/tables/tbl_secret/records";
  const baseUpdateStep = evidence.steps.find((step) => step.name === "Base update record");
  if (!baseUpdateStep?.request) {
    throw new Error("Missing Base update record request fixture.");
  }
  baseUpdateStep.request.path = "/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/rec_secret";
  const evidencePath = writeEvidenceFixture(evidence);
  const result = runVerifyEvidence(evidencePath);

  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout) as {
    valid: boolean;
    issues: string[];
  };
  assert.equal(output.valid, false);
  assert.ok(output.issues.includes("request_path_not_redacted:Docs docx read blocks"));
  assert.ok(output.issues.includes("request_path_not_redacted:Docs docx append blocks"));
  assert.ok(output.issues.includes("request_path_not_redacted:Sheets read values"));
  assert.ok(output.issues.includes("request_path_not_redacted:Base list records"));
  assert.ok(output.issues.includes("request_path_not_redacted:Base update record"));
});

test("rejects Feishu smoke evidence with raw Feishu identifiers in details", () => {
  const evidence = buildEvidenceFixture();
  const sheetWriteStep = evidence.steps.find((step) => step.name === "Sheets write values");
  if (!sheetWriteStep) {
    throw new Error("Missing Sheets write values request fixture.");
  }
  sheetWriteStep.detail = "updated SecretSheet!A1:B2 for doccn_secret and oc_secret";
  const evidencePath = writeEvidenceFixture(evidence);
  const result = runVerifyEvidence(evidencePath);

  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout) as {
    valid: boolean;
    issues: string[];
  };
  assert.equal(output.valid, false);
  assert.ok(output.issues.includes("raw_feishu_identifier_in_detail:Sheets write values"));
  assert.ok(output.issues.includes("raw_feishu_identifier_in_evidence"));
});

test("rejects Feishu smoke evidence without callback route proof", () => {
  const evidence = buildEvidenceFixture();
  const callbackStep = evidence.steps.find((step) => step.name === "AgentSpace callback URL verification");
  if (!callbackStep) {
    throw new Error("Missing AgentSpace callback URL verification fixture.");
  }
  delete (callbackStep as { callbackRoute?: string }).callbackRoute;
  delete (callbackStep as { callbackRouteFingerprint?: string }).callbackRouteFingerprint;
  const evidencePath = writeEvidenceFixture(evidence);
  const result = runVerifyEvidence(evidencePath);

  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout) as {
    valid: boolean;
    issues: string[];
  };
  assert.equal(output.valid, false);
  assert.ok(output.issues.includes("callback_route_proof_missing"));
});

test("rejects Feishu smoke evidence with a raw callback URL", () => {
  const evidence = buildEvidenceFixture();
  const callbackStep = evidence.steps.find((step) => step.name === "AgentSpace callback URL verification");
  if (!callbackStep) {
    throw new Error("Missing AgentSpace callback URL verification fixture.");
  }
  const callbackUrl = "https://agent.test/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=feishu-1";
  (callbackStep as { callbackUrl?: string }).callbackUrl = callbackUrl;
  callbackStep.detail = `verified ${callbackUrl}`;
  const evidencePath = writeEvidenceFixture(evidence);
  const result = runVerifyEvidence(evidencePath);

  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout) as {
    valid: boolean;
    issues: string[];
  };
  assert.equal(output.valid, false);
  assert.ok(output.issues.includes("callback_url_in_detail:AgentSpace callback URL verification"));
  assert.ok(output.issues.includes("callback_url_in_evidence"));
});

test("rejects Feishu smoke evidence with incomplete live coverage summary", () => {
  const evidence = buildEvidenceFixture();
  evidence.summary.liveChecks = 1;
  evidence.summary.livePassed = 1;
  const evidencePath = writeEvidenceFixture(evidence);
  const result = runVerifyEvidence(evidencePath);

  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout) as {
    valid: boolean;
    issues: string[];
  };
  assert.equal(output.valid, false);
  assert.ok(output.issues.includes("live_check_summary_incomplete"));
  assert.ok(output.issues.includes("live_passed_summary_incomplete"));
});

test("rejects Feishu smoke evidence when required request summaries are missing", () => {
  const evidence = buildEvidenceFixture();
  const sheetStep = evidence.steps.find((step) => step.name === "Sheets read values");
  if (!sheetStep) {
    throw new Error("Missing Sheets read values fixture.");
  }
  delete (sheetStep as { request?: unknown }).request;
  const evidencePath = writeEvidenceFixture(evidence);
  const result = runVerifyEvidence(evidencePath);

  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout) as {
    valid: boolean;
    issues: string[];
  };
  assert.equal(output.valid, false);
  assert.ok(output.issues.includes("required_request_summary_missing:Sheets read values"));
});

test("dry-run validates Feishu message, bot-added, and card-action EventDispatcher handlers", () => {
  const result = runSmokeJson();

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as {
    live: boolean;
    summary: {
      liveChecks: number;
      livePassed: number;
      liveSkipped: number;
      strictLiveSatisfied: boolean;
      missingEnv: string[];
    };
    steps: Array<{
      name: string;
      status: string;
      detail?: string;
    }>;
  };
  assert.equal(output.live, false);
  assert.equal(output.summary.liveChecks, 12);
  assert.equal(output.summary.livePassed, 0);
  assert.equal(output.summary.liveSkipped, 12);
  assert.equal(output.summary.strictLiveSatisfied, false);
  assert.ok(output.summary.missingEnv.includes("FEISHU_APP_ID"));
  const messageStep = output.steps.find((step) => step.name === "EventDispatcher im.message.receive_v1");
  const botAddedStep = output.steps.find((step) => step.name === "EventDispatcher im.chat.member.bot.added_v1");
  const cardActionStep = output.steps.find((step) => step.name === "EventDispatcher card.action.trigger");
  assert.equal(messageStep?.status, "pass");
  assert.equal(botAddedStep?.status, "pass");
  assert.equal(cardActionStep?.status, "pass");
  assert.match(botAddedStep?.detail ?? "", /bot-added handler/);
  assert.match(cardActionStep?.detail ?? "", /card-action handler/);
});

test("verifies a captured bot-added payload without leaking Feishu identifiers", () => {
  const payloadPath = writePayloadFixture({
    schema: "2.0",
    header: {
      event_id: "evt_real_bot_added",
      event_type: "im.chat.member.bot.added_v1",
      create_time: "1710000000000",
      app_id: "cli_real_app",
      tenant_key: "tenant-real",
    },
    event: {
      chat: {
        openChatId: "oc_real_secret_chat",
        type: "group",
        i18nNames: {
          zhCn: "真实验收群",
        },
      },
      operator_id: {
        open_id: "ou_real_operator",
        union_id: "on_real_operator",
      },
    },
  });
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "scripts/feishu/smoke.ts",
      "--verify-bot-added-payload",
      payloadPath,
      "--json",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as {
    valid: boolean;
    issues: string[];
    summary: {
      botAddedEvent: boolean;
      chatDescriptorPresent: boolean;
      chatIdSource?: string;
      chatReference?: string;
      chatIdRedacted: boolean;
      chatNamePresent: boolean;
      chatNameHash?: string;
      chatNameLength?: number;
      rawPayloadStored: boolean;
    };
  };
  assert.equal(output.valid, true);
  assert.deepEqual(output.issues, []);
  assert.equal(output.summary.botAddedEvent, true);
  assert.equal(output.summary.chatDescriptorPresent, true);
  assert.equal(output.summary.chatIdSource, "event.chat.openChatId");
  assert.match(output.summary.chatReference ?? "", /^chat [a-f0-9]{16}$/);
  assert.equal(output.summary.chatIdRedacted, true);
  assert.equal(output.summary.chatNamePresent, true);
  assert.match(output.summary.chatNameHash ?? "", /^[a-f0-9]{64}$/);
  assert.ok((output.summary.chatNameLength ?? 0) > 0);
  assert.equal(output.summary.rawPayloadStored, false);
  assert.equal(result.stdout.includes("oc_real_secret_chat"), false);
  assert.equal(result.stdout.includes("ou_real_operator"), false);
  assert.equal(result.stdout.includes("on_real_operator"), false);
  assert.equal(result.stdout.includes("真实验收群"), false);
});

test("rejects captured payloads that are not bot-added events", () => {
  const payloadPath = writePayloadFixture({
    schema: "2.0",
    header: {
      event_id: "evt_real_message",
      event_type: "im.message.receive_v1",
      create_time: "1710000000000",
    },
    event: {
      message: {
        message_id: "om_real_message",
        chat_id: "oc_real_chat",
        chat_type: "group",
        message_type: "text",
        content: "{\"text\":\"hello\"}",
      },
    },
  });
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "scripts/feishu/smoke.ts",
      "--verify-bot-added-payload",
      payloadPath,
      "--json",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout) as {
    valid: boolean;
    issues: string[];
  };
  assert.equal(output.valid, false);
  assert.ok(output.issues.includes("bot_added_event_not_recognized"));
  assert.equal(result.stdout.includes("oc_real_chat"), false);
  assert.equal(result.stdout.includes("om_real_message"), false);
});

test("strict-live without live mode cannot be mistaken for completed evidence", () => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/feishu/smoke.ts", "--strict-live", "--json"],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 1, result.stderr);
  const output = JSON.parse(result.stdout) as {
    live: boolean;
    strictLive: boolean;
    summary: {
      liveChecks: number;
      liveSkipped: number;
      strictLiveSatisfied: boolean;
    };
  };
  assert.equal(output.live, false);
  assert.equal(output.strictLive, true);
  assert.equal(output.summary.liveChecks, 12);
  assert.equal(output.summary.liveSkipped, 12);
  assert.equal(output.summary.strictLiveSatisfied, false);
});

test("evidence output requires live mode and does not write dry-run artifacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-dry-evidence-"));
  const evidencePath = join(directory, "live.json");

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/feishu/smoke.ts",
        "--strict-live",
        "--evidence",
        evidencePath,
        "--json",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      errorCode: string;
      reason: string;
    };
    assert.equal(output.ok, false);
    assert.equal(output.errorCode, "feishu.smoke.evidence_requires_live");
    assert.equal(output.reason, "not_live_run");
    assert.equal(existsSync(evidencePath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("evidence output requires strict live mode and does not write partial live artifacts", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-partial-evidence-"));
  const evidencePath = join(directory, "live.json");

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/feishu/smoke.ts",
        "--live",
        "--evidence",
        evidencePath,
        "--json",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      errorCode: string;
      reason: string;
    };
    assert.equal(output.ok, false);
    assert.equal(output.errorCode, "feishu.smoke.evidence_requires_strict_live");
    assert.equal(output.reason, "not_strict_live_run");
    assert.equal(existsSync(evidencePath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("evidence output does not overwrite artifacts when strict live checks fail", async () => {
  const server = createServer((request, response) => {
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      if (request.url?.startsWith("/api/integrations/feishu/events")) {
        response.end(JSON.stringify({ challenge: "mismatch" }));
        return;
      }
      if (request.url?.startsWith("/open-apis/auth/v3/tenant_access_token/internal")) {
        response.end(JSON.stringify({ code: 0, tenant_access_token: "tenant_failed_secret", expire: 7200 }));
        return;
      }
      response.end(JSON.stringify({ code: 0, msg: "ok", data: { message_id: "om_failed_secret" } }));
    });
    request.resume();
  });
  let directory: string | undefined;
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const callbackUrl = `${baseUrl}/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=feishu-1`;
    directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-failed-evidence-"));
    const envPath = join(directory, ".env");
    const evidencePath = join(directory, "live.json");
    writeFileSync(envPath, [
      "FEISHU_APP_ID=cli_failed_secret",
      "FEISHU_APP_SECRET=app_secret_failed",
      "FEISHU_VERIFICATION_TOKEN=verify_secret_failed",
      `FEISHU_SMOKE_CALLBACK_URL=${callbackUrl}`,
      "FEISHU_SMOKE_CHAT_ID=oc_failed_secret",
      "FEISHU_SMOKE_DOC_TOKEN=doccn_failed_secret",
      "FEISHU_SMOKE_DOC_PARENT_BLOCK_ID=blk_failed_secret",
      "FEISHU_SMOKE_DOC_APPEND_BLOCKS_JSON=[{\"block_type\":2,\"text\":{\"elements\":[{\"text_run\":{\"content\":\"AgentSpace smoke\"}}]}}]",
      "FEISHU_SMOKE_SHEET_TOKEN=shtcn_failed_secret",
      "FEISHU_SMOKE_SHEET_WRITE_RANGE=Sheet1!A1:B1",
      "FEISHU_SMOKE_SHEET_WRITE_VALUES_JSON=[[\"AgentSpace smoke\"]]",
      "FEISHU_SMOKE_BASE_APP_TOKEN=app_failed_secret",
      "FEISHU_SMOKE_BASE_TABLE_ID=tbl_failed_secret",
      "FEISHU_SMOKE_BASE_RECORD_ID=rec_failed_secret",
      "FEISHU_SMOKE_BASE_UPDATE_FIELDS_JSON={\"Smoke\":\"AgentSpace\"}",
      `FEISHU_API_BASE_URL=${baseUrl}`,
      "",
    ].join("\n"), "utf8");

    const result = await runSmokeLiveWithEnvFile(envPath, ["--strict-live", "--evidence", evidencePath]);

    assert.equal(result.status, 1);
    const output = JSON.parse(result.stdout) as {
      ok?: boolean;
      summary?: {
        strictLiveSatisfied: boolean;
        liveFailed: number;
      };
    };
    if (output.summary) {
      assert.equal(output.summary.strictLiveSatisfied, false);
      assert.ok(output.summary.liveFailed > 0);
    } else {
      assert.equal(output.ok, false);
    }
    assert.equal(existsSync(evidencePath), false);
    assert.equal(result.stdout.includes("app_secret_failed"), false);
    assert.equal(result.stdout.includes(callbackUrl), false);
  } finally {
    await close(server);
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("live smoke executes mock OpenAPI data-plane coverage including Doc append", async () => {
  const seenUrls: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      seenUrls.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      if (request.url?.startsWith("/api/integrations/feishu/events")) {
        const payload = JSON.parse(body || "{}") as Record<string, unknown>;
        response.end(JSON.stringify({ challenge: payload.challenge }));
        return;
      }
      if (request.url?.startsWith("/open-apis/auth/v3/tenant_access_token/internal")) {
        response.end(JSON.stringify({ code: 0, tenant_access_token: "tenant_success_secret", expire: 7200 }));
        return;
      }
      response.end(JSON.stringify({ code: 0, msg: "ok", data: { ok: true, revision: 1 } }));
    });
  });
  let directory: string | undefined;
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const callbackUrl = `${baseUrl}/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=feishu-1`;
    directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-openapi-smoke-"));
    const envPath = join(directory, ".env");
    writeFileSync(envPath, [
      "FEISHU_APP_ID=cli_ready_secret",
      "FEISHU_APP_SECRET=app_secret_ready",
      "FEISHU_VERIFICATION_TOKEN=verify_secret_ready",
      `FEISHU_SMOKE_CALLBACK_URL=${callbackUrl}`,
      "FEISHU_SMOKE_DOC_TOKEN=doccn_secret_ready",
      "FEISHU_SMOKE_DOC_PARENT_BLOCK_ID=blk_secret_ready",
      "FEISHU_SMOKE_DOC_APPEND_BLOCKS_JSON=[{\"block_type\":2,\"text\":{\"elements\":[{\"text_run\":{\"content\":\"AgentSpace smoke\"}}]}}]",
      "FEISHU_SMOKE_SHEET_TOKEN=shtcn_secret_ready",
      "FEISHU_SMOKE_SHEET_WRITE_RANGE=Sheet1!A1:B1",
      "FEISHU_SMOKE_SHEET_WRITE_VALUES_JSON=[[\"AgentSpace smoke\"]]",
      "FEISHU_SMOKE_BASE_APP_TOKEN=app_secret_ready",
      "FEISHU_SMOKE_BASE_TABLE_ID=tbl_secret_ready",
      "FEISHU_SMOKE_BASE_RECORD_ID=rec_secret_ready",
      "FEISHU_SMOKE_BASE_UPDATE_FIELDS_JSON={\"Smoke\":\"AgentSpace\"}",
      `FEISHU_API_BASE_URL=${baseUrl}`,
      "",
    ].join("\n"), "utf8");

    const result = await runSmokeLiveWithEnvFile(envPath);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout) as {
      summary: {
        strictLiveSatisfied: boolean;
        liveChecks: number;
        livePassed: number;
        liveSkipped: number;
        liveFailed: number;
        destructiveLiveChecks: number;
      };
      steps: Array<{
        name: string;
        status: string;
        request?: {
          path: string;
        };
      }>;
    };
    assert.equal(output.summary.strictLiveSatisfied, false);
    assert.equal(output.summary.liveChecks, 12);
    assert.equal(output.summary.livePassed, 11);
    assert.equal(output.summary.liveSkipped, 1);
    assert.equal(output.summary.liveFailed, 0);
    assert.equal(output.summary.destructiveLiveChecks, 3);
    assert.equal(output.steps.find((step) => step.name === "Client im.message.create")?.status, "skip");
    assert.equal(
      output.steps.find((step) => step.name === "Docs docx append blocks")?.request?.path,
      "/open-apis/docx/v1/documents/:doc_token/blocks/:parent_block_id/children",
    );
    assert.ok(seenUrls.some((url) =>
      url.startsWith("/open-apis/docx/v1/documents/doccn_secret_ready/blocks/blk_secret_ready/children")
    ));
    assert.equal(result.stdout.includes("doccn_secret_ready"), false);
    assert.equal(result.stdout.includes("blk_secret_ready"), false);
    assert.equal(result.stdout.includes("tenant_success_secret"), false);
  } finally {
    await close(server);
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("live callback probe verifies AgentSpace callback URL without exposing secrets", async () => {
  let receivedPayload: Record<string, unknown> | undefined;
  let receivedUrl: string | undefined;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        receivedUrl = request.url;
        receivedPayload = JSON.parse(body) as Record<string, unknown>;
        if (
          request.method === "POST" &&
          receivedPayload.type === "url_verification" &&
          receivedPayload.token === "verify-secret" &&
          typeof receivedPayload.challenge === "string"
        ) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ challenge: receivedPayload.challenge }));
          return;
        }
      } catch {
        // Fall through to the 400 response below.
      }

      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "bad callback probe" }));
    });
  });

  let directory: string | undefined;
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const callbackPath = "/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=integration-1";
    const callbackUrl = `http://127.0.0.1:${address.port}${callbackPath}`;
    directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-callback-smoke-"));
    const envPath = join(directory, ".env");
    writeFileSync(envPath, [
      `FEISHU_SMOKE_CALLBACK_URL=${callbackUrl}`,
      "FEISHU_VERIFICATION_TOKEN=verify-secret",
      "",
    ].join("\n"), "utf8");

    const result = await runSmokeLiveWithEnvFile(envPath);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout) as {
      live: boolean;
      summary: {
        liveChecks: number;
        livePassed: number;
        liveSkipped: number;
        liveFailed: number;
      };
      steps: Array<{
        name: string;
        status: string;
        detail?: string;
        callbackRoute?: string;
        callbackRouteFingerprint?: string;
      }>;
    };
    const callbackStep = output.steps.find((step) => step.name === "AgentSpace callback URL verification");

    assert.equal(output.live, true);
    assert.equal(callbackStep?.status, "pass");
    assert.match(callbackStep?.detail ?? "", /challenge=matched/);
    assert.equal(callbackStep?.callbackRoute, "/api/integrations/feishu/events");
    assert.match(callbackStep?.callbackRouteFingerprint ?? "", /^sha256:[a-f0-9]{16}$/);
    assert.equal(output.summary.liveChecks, 12);
    assert.equal(output.summary.livePassed, 1);
    assert.equal(output.summary.liveSkipped, 11);
    assert.equal(output.summary.liveFailed, 0);
    assert.equal(JSON.stringify(output).includes("verify-secret"), false);
    assert.equal(JSON.stringify(output).includes(callbackUrl), false);
    assert.equal(receivedUrl, callbackPath);
    assert.equal(receivedPayload?.token, "verify-secret");
    assert.equal(typeof receivedPayload?.challenge, "string");
  } finally {
    await close(server);
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("live response summaries redact Feishu identifiers before JSON output", async () => {
  const callbackUrl = "https://agent.test/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=feishu-1";
  const unsafeMessage = [
    "Bearer tenant-secret-token",
    "doccn_response_secret",
    "oc_response_secret",
    "SecretSheet!A1:B2",
    callbackUrl,
    "app_secret=response_secret",
  ].join(" ");
  const server = createServer((request, response) => {
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      if (request.url?.startsWith("/open-apis/auth/v3/tenant_access_token/internal")) {
        response.end(JSON.stringify({ code: 0, tenant_access_token: "tenant_response_secret", expire: 7200 }));
        return;
      }
      if (request.url?.startsWith("/open-apis/docx/")) {
        response.end(JSON.stringify({
          code: 0,
          msg: unsafeMessage,
          data: {
            tbl_response_secret: true,
            safe_key: true,
          },
        }));
        return;
      }
      response.end(JSON.stringify({
        code: "app_secret=response_secret",
        msg: unsafeMessage,
        data: {
          tbl_response_secret: true,
          safe_key: true,
        },
      }));
    });
    request.resume();
  });
  let directory: string | undefined;
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const envPath = join(
      directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-redacted-response-")),
      ".env",
    );
    writeFileSync(envPath, [
      "FEISHU_APP_ID=cli_response_secret",
      "FEISHU_APP_SECRET=app_secret_response",
      "FEISHU_SMOKE_DOC_TOKEN=doccn_response_secret",
      "FEISHU_SMOKE_SHEET_TOKEN=shtcn_response_secret",
      `FEISHU_API_BASE_URL=http://127.0.0.1:${address.port}`,
      "",
    ].join("\n"), "utf8");

    const result = await runSmokeLiveWithEnvFile(envPath);

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout) as {
      steps: Array<{
        name: string;
        detail?: string;
      }>;
    };
    const docStep = output.steps.find((step) => step.name === "Docs docx metadata");
    const sheetStep = output.steps.find((step) => step.name === "Sheets metadata");
    assert.ok(docStep?.detail?.includes("[redacted-feishu-resource]"));
    assert.ok(docStep?.detail?.includes("Bearer [redacted]"));
    assert.ok(sheetStep?.detail?.includes("app_secret=[redacted]"));
    assert.equal(result.stdout.includes("tenant-secret-token"), false);
    assert.equal(result.stdout.includes("doccn_response_secret"), false);
    assert.equal(result.stdout.includes("shtcn_response_secret"), false);
    assert.equal(result.stdout.includes("oc_response_secret"), false);
    assert.equal(result.stdout.includes("SecretSheet!A1:B2"), false);
    assert.equal(result.stdout.includes(callbackUrl), false);
    assert.equal(result.stdout.includes("response_secret"), false);
    assert.equal(result.stdout.includes("tbl_response_secret"), false);
  } finally {
    await close(server);
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("check-env reports missing and invalid live smoke env without exposing values", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-check-env-missing-"));
  const envPath = join(directory, ".env");
  writeFileSync(envPath, [
    "FEISHU_APP_ID=cli_secret_app",
    "FEISHU_APP_SECRET=app_secret_value",
    "FEISHU_SMOKE_CALLBACK_URL=ftp://callback-secret.example/path",
    "",
  ].join("\n"), "utf8");

  try {
    const result = runSmokeCheckEnv(envPath);

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout) as {
      ready: boolean;
      summary: {
        required: number;
        ready: number;
        missing: number;
        invalid: number;
      };
      todo120NativeSmoke: {
        ready: boolean;
        required: number;
        configured: number;
        missing: string[];
        invalid: Array<{
          key: string;
          reason: string;
        }>;
      };
      missingRequired: string[];
      invalidRequired: Array<{
        key: string;
        reason: string;
      }>;
    };
    assert.equal(output.ready, false);
    assert.equal(output.summary.required, 15);
    assert.equal(output.summary.ready, 2);
    assert.equal(output.summary.invalid, 1);
    assert.equal(output.todo120NativeSmoke.ready, false);
    assert.equal(output.todo120NativeSmoke.required, 2);
    assert.equal(output.todo120NativeSmoke.configured, 0);
    assert.deepEqual(output.todo120NativeSmoke.missing, [
      "FEISHU_SECOND_AGENT_APP_ID",
      "FEISHU_SECOND_AGENT_APP_SECRET",
    ]);
    assert.ok(output.summary.missing > 0);
    assert.ok(output.missingRequired.includes("FEISHU_VERIFICATION_TOKEN"));
    assert.deepEqual(output.invalidRequired, [{
      key: "FEISHU_SMOKE_CALLBACK_URL",
      reason: "must_be_http_or_https_url",
    }]);
    assert.equal(result.stdout.includes("cli_secret_app"), false);
    assert.equal(result.stdout.includes("app_secret_value"), false);
    assert.equal(result.stdout.includes("callback-secret"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("check-env accepts a complete strict live smoke env without printing resource tokens", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-check-env-ready-"));
  const envPath = join(directory, ".env");
  writeFileSync(envPath, [
    "FEISHU_APP_ID=cli_ready_secret",
    "FEISHU_APP_SECRET=app_secret_ready",
    "FEISHU_VERIFICATION_TOKEN=verify_secret_ready",
    "FEISHU_SMOKE_CALLBACK_URL=https://agent.test/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=feishu-1",
    "FEISHU_SMOKE_CHAT_ID=oc_secret_ready",
    "FEISHU_SMOKE_DOC_TOKEN=doccn_secret_ready",
    "FEISHU_SMOKE_DOC_PARENT_BLOCK_ID=blk_secret_ready",
    "FEISHU_SMOKE_DOC_APPEND_BLOCKS_JSON=[{\"block_type\":2,\"text\":{\"elements\":[{\"text_run\":{\"content\":\"AgentSpace smoke\"}}]}}]",
    "FEISHU_SMOKE_SHEET_TOKEN=shtcn_secret_ready",
    "FEISHU_SMOKE_SHEET_WRITE_RANGE=Sheet1!A1:B1",
    "FEISHU_SMOKE_SHEET_WRITE_VALUES_JSON=[[\"AgentSpace smoke\"]]",
    "FEISHU_SMOKE_BASE_APP_TOKEN=app_secret_ready",
    "FEISHU_SMOKE_BASE_TABLE_ID=tbl_secret_ready",
    "FEISHU_SMOKE_BASE_RECORD_ID=rec_secret_ready",
    "FEISHU_SMOKE_BASE_UPDATE_FIELDS_JSON={\"Smoke\":\"AgentSpace\"}",
    "",
  ].join("\n"), "utf8");

  try {
    const result = runSmokeCheckEnv(envPath);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout) as {
      ready: boolean;
      summary: {
        required: number;
        ready: number;
        missing: number;
        invalid: number;
      };
      todo120NativeSmoke: {
        ready: boolean;
        required: number;
        configured: number;
        missing: string[];
        invalid: unknown[];
      };
      missingRequired: string[];
      invalidRequired: unknown[];
    };
    assert.equal(output.ready, true);
    assert.equal(output.summary.required, 15);
    assert.equal(output.summary.ready, 15);
    assert.equal(output.summary.missing, 0);
    assert.equal(output.summary.invalid, 0);
    assert.equal(output.todo120NativeSmoke.ready, false);
    assert.equal(output.todo120NativeSmoke.required, 2);
    assert.equal(output.todo120NativeSmoke.configured, 0);
    assert.deepEqual(output.todo120NativeSmoke.missing, [
      "FEISHU_SECOND_AGENT_APP_ID",
      "FEISHU_SECOND_AGENT_APP_SECRET",
    ]);
    assert.deepEqual(output.missingRequired, []);
    assert.deepEqual(output.invalidRequired, []);
    assert.equal(result.stdout.includes("cli_ready_secret"), false);
    assert.equal(result.stdout.includes("verify_secret_ready"), false);
    assert.equal(result.stdout.includes("oc_secret_ready"), false);
    assert.equal(result.stdout.includes("doccn_secret_ready"), false);
    assert.equal(result.stdout.includes("blk_secret_ready"), false);
    assert.equal(result.stdout.includes("shtcn_secret_ready"), false);
    assert.equal(result.stdout.includes("tbl_secret_ready"), false);
    assert.equal(result.stdout.includes("rec_secret_ready"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("check-env can require TODO120 native multi-agent env", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-check-env-require-todo120-"));
  const envPath = join(directory, ".env");
  writeFileSync(envPath, [
    "FEISHU_APP_ID=cli_ready_secret",
    "FEISHU_APP_SECRET=app_secret_ready",
    "FEISHU_VERIFICATION_TOKEN=verify_secret_ready",
    "FEISHU_SMOKE_CALLBACK_URL=https://agent.test/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=feishu-1",
    "FEISHU_SMOKE_CHAT_ID=oc_secret_ready",
    "FEISHU_SMOKE_DOC_TOKEN=doccn_secret_ready",
    "FEISHU_SMOKE_DOC_PARENT_BLOCK_ID=blk_secret_ready",
    "FEISHU_SMOKE_DOC_APPEND_BLOCKS_JSON=[{\"block_type\":2,\"text\":{\"elements\":[{\"text_run\":{\"content\":\"AgentSpace smoke\"}}]}}]",
    "FEISHU_SMOKE_SHEET_TOKEN=shtcn_secret_ready",
    "FEISHU_SMOKE_SHEET_WRITE_RANGE=Sheet1!A1:B1",
    "FEISHU_SMOKE_SHEET_WRITE_VALUES_JSON=[[\"AgentSpace smoke\"]]",
    "FEISHU_SMOKE_BASE_APP_TOKEN=app_secret_ready",
    "FEISHU_SMOKE_BASE_TABLE_ID=tbl_secret_ready",
    "FEISHU_SMOKE_BASE_RECORD_ID=rec_secret_ready",
    "FEISHU_SMOKE_BASE_UPDATE_FIELDS_JSON={\"Smoke\":\"AgentSpace\"}",
    "",
  ].join("\n"), "utf8");

  try {
    const result = runSmokeCheckEnv(envPath, ["--require-todo120-native"]);

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout) as {
      ready: boolean;
      todo120NativeSmoke: {
        ready: boolean;
        requiredForCommand: boolean;
        missing: string[];
      };
      missingRequired: string[];
    };
    assert.equal(output.ready, false);
    assert.equal(output.todo120NativeSmoke.ready, false);
    assert.equal(output.todo120NativeSmoke.requiredForCommand, true);
    assert.deepEqual(output.todo120NativeSmoke.missing, [
      "FEISHU_SECOND_AGENT_APP_ID",
      "FEISHU_SECOND_AGENT_APP_SECRET",
    ]);
    assert.deepEqual(output.missingRequired, []);
    assert.equal(result.stdout.includes("cli_ready_secret"), false);
    assert.equal(result.stdout.includes("oc_secret_ready"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("check-env reports TODO120 native multi-agent env readiness separately from OpenAPI readiness", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-check-env-todo120-"));
  const envPath = join(directory, ".env");
  writeFileSync(envPath, [
    "FEISHU_APP_ID=cli_ready_secret",
    "FEISHU_APP_SECRET=app_secret_ready",
    "FEISHU_VERIFICATION_TOKEN=verify_secret_ready",
    "FEISHU_SMOKE_CALLBACK_URL=https://agent.test/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=feishu-1",
    "FEISHU_SMOKE_CHAT_ID=oc_secret_ready",
    "FEISHU_SMOKE_DOC_TOKEN=doccn_secret_ready",
    "FEISHU_SMOKE_DOC_PARENT_BLOCK_ID=blk_secret_ready",
    "FEISHU_SMOKE_DOC_APPEND_BLOCKS_JSON=[{\"block_type\":2,\"text\":{\"elements\":[{\"text_run\":{\"content\":\"AgentSpace smoke\"}}]}}]",
    "FEISHU_SMOKE_SHEET_TOKEN=shtcn_secret_ready",
    "FEISHU_SMOKE_SHEET_WRITE_RANGE=Sheet1!A1:B1",
    "FEISHU_SMOKE_SHEET_WRITE_VALUES_JSON=[[\"AgentSpace smoke\"]]",
    "FEISHU_SMOKE_BASE_APP_TOKEN=app_secret_ready",
    "FEISHU_SMOKE_BASE_TABLE_ID=tbl_secret_ready",
    "FEISHU_SMOKE_BASE_RECORD_ID=rec_secret_ready",
    "FEISHU_SMOKE_BASE_UPDATE_FIELDS_JSON={\"Smoke\":\"AgentSpace\"}",
    "FEISHU_SECOND_AGENT_APP_ID=cli_second_ready_secret",
    "FEISHU_SECOND_AGENT_APP_SECRET=second_secret_ready",
    "",
  ].join("\n"), "utf8");

  try {
    const result = runSmokeCheckEnv(envPath);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout) as {
      ready: boolean;
      todo120NativeSmoke: {
        ready: boolean;
        required: number;
        configured: number;
        missing: string[];
        invalid: unknown[];
      };
      items: Array<{
        key: string;
        status: string;
        todo120NativeSmokeRequired?: boolean;
      }>;
    };
    assert.equal(output.ready, true);
    assert.deepEqual(output.todo120NativeSmoke, {
      ready: true,
      requiredForCommand: false,
      required: 2,
      configured: 2,
      missing: [],
      invalid: [],
    });
    assert.equal(
      output.items.find((item) => item.key === "FEISHU_SECOND_AGENT_APP_ID")?.todo120NativeSmokeRequired,
      true,
    );
    assert.equal(result.stdout.includes("cli_second_ready_secret"), false);
    assert.equal(result.stdout.includes("second_secret_ready"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("check-env rejects reusing the primary Feishu app as the second TODO120 agent bot", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-check-env-todo120-same-app-"));
  const envPath = join(directory, ".env");
  writeFileSync(envPath, [
    "FEISHU_APP_ID=cli_same_app_secret",
    "FEISHU_APP_SECRET=app_secret_ready",
    "FEISHU_VERIFICATION_TOKEN=verify_secret_ready",
    "FEISHU_SMOKE_CALLBACK_URL=https://agent.test/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=feishu-1",
    "FEISHU_SMOKE_CHAT_ID=oc_secret_ready",
    "FEISHU_SMOKE_DOC_TOKEN=doccn_secret_ready",
    "FEISHU_SMOKE_DOC_PARENT_BLOCK_ID=blk_secret_ready",
    "FEISHU_SMOKE_DOC_APPEND_BLOCKS_JSON=[{\"block_type\":2,\"text\":{\"elements\":[{\"text_run\":{\"content\":\"AgentSpace smoke\"}}]}}]",
    "FEISHU_SMOKE_SHEET_TOKEN=shtcn_secret_ready",
    "FEISHU_SMOKE_SHEET_WRITE_RANGE=Sheet1!A1:B1",
    "FEISHU_SMOKE_SHEET_WRITE_VALUES_JSON=[[\"AgentSpace smoke\"]]",
    "FEISHU_SMOKE_BASE_APP_TOKEN=app_secret_ready",
    "FEISHU_SMOKE_BASE_TABLE_ID=tbl_secret_ready",
    "FEISHU_SMOKE_BASE_RECORD_ID=rec_secret_ready",
    "FEISHU_SMOKE_BASE_UPDATE_FIELDS_JSON={\"Smoke\":\"AgentSpace\"}",
    "FEISHU_SECOND_AGENT_APP_ID=cli_same_app_secret",
    "FEISHU_SECOND_AGENT_APP_SECRET=second_secret_ready",
    "",
  ].join("\n"), "utf8");

  try {
    const optionalResult = runSmokeCheckEnv(envPath);
    assert.equal(optionalResult.status, 0, optionalResult.stderr);
    const optionalOutput = JSON.parse(optionalResult.stdout) as {
      ready: boolean;
      todo120NativeSmoke: {
        ready: boolean;
        invalid: Array<{ key: string; reason: string }>;
      };
    };
    assert.equal(optionalOutput.ready, true);
    assert.equal(optionalOutput.todo120NativeSmoke.ready, false);
    assert.deepEqual(optionalOutput.todo120NativeSmoke.invalid, [{
      key: "FEISHU_SECOND_AGENT_APP_ID",
      reason: "must_differ_from_feishu_app_id",
    }]);

    const requiredResult = runSmokeCheckEnv(envPath, ["--require-todo120-native"]);
    assert.equal(requiredResult.status, 1, requiredResult.stderr);
    const requiredOutput = JSON.parse(requiredResult.stdout) as {
      ready: boolean;
      todo120NativeSmoke: {
        requiredForCommand: boolean;
        invalid: Array<{ key: string; reason: string }>;
      };
    };
    assert.equal(requiredOutput.ready, false);
    assert.equal(requiredOutput.todo120NativeSmoke.requiredForCommand, true);
    assert.deepEqual(requiredOutput.todo120NativeSmoke.invalid, [{
      key: "FEISHU_SECOND_AGENT_APP_ID",
      reason: "must_differ_from_feishu_app_id",
    }]);
    assert.equal(requiredResult.stdout.includes("cli_same_app_secret"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("check-env rejects reusing the primary Feishu app secret for the second TODO120 agent bot", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-check-env-todo120-same-secret-"));
  const envPath = join(directory, ".env");
  writeFileSync(envPath, [
    "FEISHU_APP_ID=cli_primary_app",
    "FEISHU_APP_SECRET=shared_secret_value",
    "FEISHU_VERIFICATION_TOKEN=verify_secret_ready",
    "FEISHU_SMOKE_CALLBACK_URL=https://agent.test/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=feishu-1",
    "FEISHU_SMOKE_CHAT_ID=oc_secret_ready",
    "FEISHU_SMOKE_DOC_TOKEN=doccn_secret_ready",
    "FEISHU_SMOKE_DOC_PARENT_BLOCK_ID=blk_secret_ready",
    "FEISHU_SMOKE_DOC_APPEND_BLOCKS_JSON=[{\"block_type\":2,\"text\":{\"elements\":[{\"text_run\":{\"content\":\"AgentSpace smoke\"}}]}}]",
    "FEISHU_SMOKE_SHEET_TOKEN=shtcn_secret_ready",
    "FEISHU_SMOKE_SHEET_WRITE_RANGE=Sheet1!A1:B1",
    "FEISHU_SMOKE_SHEET_WRITE_VALUES_JSON=[[\"AgentSpace smoke\"]]",
    "FEISHU_SMOKE_BASE_APP_TOKEN=app_secret_ready",
    "FEISHU_SMOKE_BASE_TABLE_ID=tbl_secret_ready",
    "FEISHU_SMOKE_BASE_RECORD_ID=rec_secret_ready",
    "FEISHU_SMOKE_BASE_UPDATE_FIELDS_JSON={\"Smoke\":\"AgentSpace\"}",
    "FEISHU_SECOND_AGENT_APP_ID=cli_second_app",
    "FEISHU_SECOND_AGENT_APP_SECRET=shared_secret_value",
    "",
  ].join("\n"), "utf8");

  try {
    const optionalResult = runSmokeCheckEnv(envPath);
    assert.equal(optionalResult.status, 0, optionalResult.stderr);
    const optionalOutput = JSON.parse(optionalResult.stdout) as {
      ready: boolean;
      todo120NativeSmoke: {
        ready: boolean;
        invalid: Array<{ key: string; reason: string }>;
      };
    };
    assert.equal(optionalOutput.ready, true);
    assert.equal(optionalOutput.todo120NativeSmoke.ready, false);
    assert.deepEqual(optionalOutput.todo120NativeSmoke.invalid, [{
      key: "FEISHU_SECOND_AGENT_APP_SECRET",
      reason: "must_differ_from_feishu_app_secret",
    }]);

    const requiredResult = runSmokeCheckEnv(envPath, ["--require-todo120-native"]);
    assert.equal(requiredResult.status, 1, requiredResult.stderr);
    const requiredOutput = JSON.parse(requiredResult.stdout) as {
      ready: boolean;
      todo120NativeSmoke: {
        invalid: Array<{ key: string; reason: string }>;
      };
    };
    assert.equal(requiredOutput.ready, false);
    assert.deepEqual(requiredOutput.todo120NativeSmoke.invalid, [{
      key: "FEISHU_SECOND_AGENT_APP_SECRET",
      reason: "must_differ_from_feishu_app_secret",
    }]);
    assert.equal(requiredResult.stdout.includes("shared_secret_value"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("check-env rejects callback URLs outside the AgentSpace Feishu route", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-check-env-callback-"));
  const envPath = join(directory, ".env");
  const wrongPathCallbackUrl = "https://agent.test/api/not-feishu/events?workspaceId=workspace-1&integrationId=feishu-1";
  const missingQueryCallbackUrl = "https://agent.test/api/integrations/feishu/events?workspaceId=workspace-1";
  try {
    writeCompleteSmokeEnv(envPath, wrongPathCallbackUrl);
    const wrongPath = runSmokeCheckEnv(envPath);

    assert.equal(wrongPath.status, 1, wrongPath.stderr);
    const wrongPathOutput = JSON.parse(wrongPath.stdout) as {
      ready: boolean;
      invalidRequired: Array<{ key: string; reason: string }>;
    };
    assert.equal(wrongPathOutput.ready, false);
    assert.deepEqual(wrongPathOutput.invalidRequired, [{
      key: "FEISHU_SMOKE_CALLBACK_URL",
      reason: "must_be_agentspace_feishu_callback_url",
    }]);
    assert.equal(wrongPath.stdout.includes(wrongPathCallbackUrl), false);

    writeCompleteSmokeEnv(envPath, missingQueryCallbackUrl);
    const missingQuery = runSmokeCheckEnv(envPath);

    assert.equal(missingQuery.status, 1, missingQuery.stderr);
    const missingQueryOutput = JSON.parse(missingQuery.stdout) as {
      ready: boolean;
      invalidRequired: Array<{ key: string; reason: string }>;
    };
    assert.equal(missingQueryOutput.ready, false);
    assert.deepEqual(missingQueryOutput.invalidRequired, [{
      key: "FEISHU_SMOKE_CALLBACK_URL",
      reason: "workspace_or_integration_query_missing",
    }]);
    assert.equal(missingQuery.stdout.includes(missingQueryCallbackUrl), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("check-env rejects checked-in placeholder smoke env values", () => {
  const result = runSmokeCheckEnv("scripts/feishu/env.example");

  assert.equal(result.status, 1, result.stderr);
  const output = JSON.parse(result.stdout) as {
    ready: boolean;
    invalidRequired: Array<{
      key: string;
      reason: string;
    }>;
  };
  assert.equal(output.ready, false);
  assert.ok(output.invalidRequired.some((item) =>
    item.key === "FEISHU_APP_ID" && item.reason === "placeholder_value"
  ));
  assert.ok(output.invalidRequired.some((item) =>
    item.key === "FEISHU_SMOKE_CHAT_ID" && item.reason === "placeholder_value"
  ));
  assert.equal(result.stdout.includes("cli_xxx"), false);
  assert.equal(result.stdout.includes("oc_xxx"), false);
  assert.equal(result.stdout.includes("doccn_xxx"), false);
});

test("check-env rejects smoke-env generated CHANGE_ME placeholders while accepting generated callback URL", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-check-env-template-"));
  const envPath = join(directory, ".env");
  const callbackUrl = "https://agent.test/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=feishu-1";
  writeFileSync(envPath, [
    "FEISHU_APP_ID=CHANGE_ME_FEISHU_APP_ID",
    "FEISHU_APP_SECRET=CHANGE_ME_FEISHU_APP_SECRET",
    "FEISHU_VERIFICATION_TOKEN=CHANGE_ME_FEISHU_VERIFICATION_TOKEN",
    `FEISHU_SMOKE_CALLBACK_URL=${callbackUrl}`,
    "FEISHU_SMOKE_CHAT_ID=CHANGE_ME_FEISHU_CHAT_ID",
    "FEISHU_SMOKE_DOC_TOKEN=CHANGE_ME_DOCX_TOKEN",
    "FEISHU_SMOKE_DOC_PARENT_BLOCK_ID=CHANGE_ME_DOCX_PARENT_BLOCK_ID",
    "FEISHU_SMOKE_DOC_APPEND_BLOCKS_JSON=[{\"block_type\":2,\"text\":{\"elements\":[{\"text_run\":{\"content\":\"AgentSpace smoke\"}}]}}]",
    "FEISHU_SMOKE_SHEET_TOKEN=CHANGE_ME_SHEET_TOKEN",
    "FEISHU_SMOKE_SHEET_WRITE_RANGE=Sheet1!A1:B1",
    "FEISHU_SMOKE_SHEET_WRITE_VALUES_JSON=[[\"AgentSpace smoke\"]]",
    "FEISHU_SMOKE_BASE_APP_TOKEN=CHANGE_ME_BASE_APP_TOKEN",
    "FEISHU_SMOKE_BASE_TABLE_ID=CHANGE_ME_BASE_TABLE_ID",
    "FEISHU_SMOKE_BASE_RECORD_ID=CHANGE_ME_BASE_RECORD_ID",
    "FEISHU_SMOKE_BASE_UPDATE_FIELDS_JSON={\"Smoke\":\"AgentSpace\"}",
    "",
  ].join("\n"), "utf8");

  try {
    const result = runSmokeCheckEnv(envPath);

    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout) as {
      ready: boolean;
      summary: {
        ready: number;
        invalid: number;
      };
      invalidRequired: Array<{
        key: string;
        reason: string;
      }>;
      items: Array<{
        key: string;
        status: string;
        reason?: string;
      }>;
    };
    assert.equal(output.ready, false);
    assert.equal(output.summary.ready, 5);
    assert.equal(output.summary.invalid, 10);
    for (const key of [
      "FEISHU_APP_ID",
      "FEISHU_APP_SECRET",
      "FEISHU_VERIFICATION_TOKEN",
      "FEISHU_SMOKE_CHAT_ID",
      "FEISHU_SMOKE_DOC_TOKEN",
      "FEISHU_SMOKE_DOC_PARENT_BLOCK_ID",
      "FEISHU_SMOKE_SHEET_TOKEN",
      "FEISHU_SMOKE_BASE_APP_TOKEN",
      "FEISHU_SMOKE_BASE_TABLE_ID",
      "FEISHU_SMOKE_BASE_RECORD_ID",
    ]) {
      assert.ok(output.invalidRequired.some((item) =>
        item.key === key && item.reason === "placeholder_value"
      ), `${key} should be rejected as a placeholder`);
    }
    assert.equal(output.items.find((item) => item.key === "FEISHU_SMOKE_CALLBACK_URL")?.status, "ready");
    assert.equal(result.stdout.includes("CHANGE_ME_FEISHU_APP_SECRET"), false);
    assert.equal(result.stdout.includes("CHANGE_ME_BASE_RECORD_ID"), false);
    assert.equal(result.stdout.includes(callbackUrl), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("check-env reports malformed env-file lines as structured errors without exposing values", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-check-env-invalid-file-"));
  const envPath = join(directory, ".env");
  writeFileSync(envPath, [
    "FEISHU_APP_ID=cli_invalid_file",
    "FEISHU_APP_SECRET app_secret_invalid_file",
    "",
  ].join("\n"), "utf8");

  try {
    const result = runSmokeCheckEnv(envPath);

    assert.equal(result.status, 1);
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      errorCode: string;
      errorMessage: string;
      reason: string;
    };
    assert.equal(output.ok, false);
    assert.equal(output.errorCode, "feishu.smoke.invalid_env_file");
    assert.equal(output.reason, "expected_key_value");
    assert.match(output.errorMessage, /Invalid --env-file line 2/);
    assert.equal(result.stdout.includes("cli_invalid_file"), false);
    assert.equal(result.stdout.includes("app_secret_invalid_file"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("live smoke reports malformed JSON env as structured errors without exposing values", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-live-invalid-json-"));
  const envPath = join(directory, ".env");
  writeFileSync(envPath, [
    "FEISHU_APP_ID=cli_json_secret",
    "FEISHU_APP_SECRET=app_secret_json",
    "FEISHU_SMOKE_SHEET_TOKEN=shtcn_json_secret",
    "FEISHU_SMOKE_SHEET_WRITE_VALUES_JSON=[[\"secret-cell\"]",
    "",
  ].join("\n"), "utf8");

  try {
    const result = await runSmokeLiveWithEnvFile(envPath);

    assert.equal(result.status, 1);
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      errorCode: string;
      errorMessage: string;
      envName: string;
      reason: string;
    };
    assert.equal(output.ok, false);
    assert.equal(output.errorCode, "feishu.smoke.invalid_json_env");
    assert.equal(output.envName, "FEISHU_SMOKE_SHEET_WRITE_VALUES_JSON");
    assert.equal(output.reason, "must_be_valid_json");
    assert.match(output.errorMessage, /FEISHU_SMOKE_SHEET_WRITE_VALUES_JSON/);
    assert.equal(result.stdout.includes("cli_json_secret"), false);
    assert.equal(result.stdout.includes("app_secret_json"), false);
    assert.equal(result.stdout.includes("shtcn_json_secret"), false);
    assert.equal(result.stdout.includes("secret-cell"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("strict live smoke rejects placeholder env before network calls without exposing values", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-live-placeholder-"));
  const envPath = join(directory, ".env");
  const callbackUrl = "https://agent.test/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=feishu-1";
  writeFileSync(envPath, [
    "FEISHU_APP_ID=CHANGE_ME_FEISHU_APP_ID",
    "FEISHU_APP_SECRET=CHANGE_ME_FEISHU_APP_SECRET",
    "FEISHU_VERIFICATION_TOKEN=CHANGE_ME_FEISHU_VERIFICATION_TOKEN",
    `FEISHU_SMOKE_CALLBACK_URL=${callbackUrl}`,
    "FEISHU_SMOKE_CHAT_ID=CHANGE_ME_FEISHU_CHAT_ID",
    "FEISHU_SMOKE_DOC_TOKEN=CHANGE_ME_DOCX_TOKEN",
    "FEISHU_SMOKE_DOC_PARENT_BLOCK_ID=CHANGE_ME_DOCX_PARENT_BLOCK_ID",
    "FEISHU_SMOKE_DOC_APPEND_BLOCKS_JSON=[{\"block_type\":2,\"text\":{\"elements\":[{\"text_run\":{\"content\":\"AgentSpace smoke\"}}]}}]",
    "FEISHU_SMOKE_SHEET_TOKEN=CHANGE_ME_SHEET_TOKEN",
    "FEISHU_SMOKE_SHEET_WRITE_RANGE=Sheet1!A1:B1",
    "FEISHU_SMOKE_SHEET_WRITE_VALUES_JSON=[[\"AgentSpace smoke\"]]",
    "FEISHU_SMOKE_BASE_APP_TOKEN=CHANGE_ME_BASE_APP_TOKEN",
    "FEISHU_SMOKE_BASE_TABLE_ID=CHANGE_ME_BASE_TABLE_ID",
    "FEISHU_SMOKE_BASE_RECORD_ID=CHANGE_ME_BASE_RECORD_ID",
    "FEISHU_SMOKE_BASE_UPDATE_FIELDS_JSON={\"Smoke\":\"AgentSpace\"}",
    "",
  ].join("\n"), "utf8");

  try {
    const result = await runSmokeLiveWithEnvFile(envPath, ["--strict-live"]);

    assert.equal(result.status, 1);
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      errorCode: string;
      errorMessage: string;
      envNames: string[];
      reason: string;
    };
    assert.equal(output.ok, false);
    assert.equal(output.errorCode, "feishu.smoke.live_env_not_ready");
    assert.equal(output.reason, "invalid_env");
    assert.ok(output.envNames.includes("FEISHU_APP_SECRET"));
    assert.ok(output.envNames.includes("FEISHU_SMOKE_BASE_RECORD_ID"));
    assert.ok(!output.envNames.includes("FEISHU_SMOKE_CALLBACK_URL"));
    assert.match(output.errorMessage, /Run --check-env/);
    assert.equal(result.stdout.includes("CHANGE_ME_FEISHU_APP_SECRET"), false);
    assert.equal(result.stdout.includes("CHANGE_ME_BASE_RECORD_ID"), false);
    assert.equal(result.stdout.includes(callbackUrl), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("strict live smoke rejects missing required env before network calls", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-live-missing-env-"));
  const envPath = join(directory, ".env");
  writeFileSync(envPath, [
    "FEISHU_APP_ID=cli_missing_secret",
    "",
  ].join("\n"), "utf8");

  try {
    const result = await runSmokeLiveWithEnvFile(envPath, ["--strict-live"]);

    assert.equal(result.status, 1);
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      errorCode: string;
      errorMessage: string;
      envNames: string[];
      reason: string;
    };
    assert.equal(output.ok, false);
    assert.equal(output.errorCode, "feishu.smoke.live_env_not_ready");
    assert.equal(output.reason, "missing_env");
    assert.ok(output.envNames.includes("FEISHU_APP_SECRET"));
    assert.ok(output.envNames.includes("FEISHU_SMOKE_CALLBACK_URL"));
    assert.ok(!output.envNames.includes("FEISHU_APP_ID"));
    assert.match(output.errorMessage, /--live --strict-live/);
    assert.equal(result.stdout.includes("cli_missing_secret"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("strict live smoke can require TODO120 native multi-agent env before network calls", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-live-require-todo120-"));
  const envPath = join(directory, ".env");
  writeFileSync(envPath, [
    "FEISHU_APP_ID=cli_ready_secret",
    "FEISHU_APP_SECRET=app_secret_ready",
    "FEISHU_VERIFICATION_TOKEN=verify_secret_ready",
    "FEISHU_SMOKE_CALLBACK_URL=https://agent.test/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=feishu-1",
    "FEISHU_SMOKE_CHAT_ID=oc_secret_ready",
    "FEISHU_SMOKE_DOC_TOKEN=doccn_secret_ready",
    "FEISHU_SMOKE_DOC_PARENT_BLOCK_ID=blk_secret_ready",
    "FEISHU_SMOKE_DOC_APPEND_BLOCKS_JSON=[{\"block_type\":2,\"text\":{\"elements\":[{\"text_run\":{\"content\":\"AgentSpace smoke\"}}]}}]",
    "FEISHU_SMOKE_SHEET_TOKEN=shtcn_secret_ready",
    "FEISHU_SMOKE_SHEET_WRITE_RANGE=Sheet1!A1:B1",
    "FEISHU_SMOKE_SHEET_WRITE_VALUES_JSON=[[\"AgentSpace smoke\"]]",
    "FEISHU_SMOKE_BASE_APP_TOKEN=app_secret_ready",
    "FEISHU_SMOKE_BASE_TABLE_ID=tbl_secret_ready",
    "FEISHU_SMOKE_BASE_RECORD_ID=rec_secret_ready",
    "FEISHU_SMOKE_BASE_UPDATE_FIELDS_JSON={\"Smoke\":\"AgentSpace\"}",
    "",
  ].join("\n"), "utf8");

  try {
    const result = await runSmokeLiveWithEnvFile(envPath, ["--strict-live", "--require-todo120-native"]);

    assert.equal(result.status, 1);
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      errorCode: string;
      errorMessage: string;
      envNames: string[];
      reason: string;
    };
    assert.equal(output.ok, false);
    assert.equal(output.errorCode, "feishu.smoke.live_env_not_ready");
    assert.equal(output.reason, "missing_todo120_native_env");
    assert.deepEqual(output.envNames, [
      "FEISHU_SECOND_AGENT_APP_ID",
      "FEISHU_SECOND_AGENT_APP_SECRET",
    ]);
    assert.match(output.errorMessage, /--require-todo120-native/);
    assert.equal(result.stdout.includes("cli_ready_secret"), false);
    assert.equal(result.stdout.includes("oc_secret_ready"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("strict live TODO120 native smoke rejects duplicate primary and second app ids before network calls", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-live-todo120-same-app-"));
  const envPath = join(directory, ".env");
  writeFileSync(envPath, [
    "FEISHU_APP_ID=cli_same_app_secret",
    "FEISHU_APP_SECRET=app_secret_ready",
    "FEISHU_VERIFICATION_TOKEN=verify_secret_ready",
    "FEISHU_SMOKE_CALLBACK_URL=https://agent.test/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=feishu-1",
    "FEISHU_SMOKE_CHAT_ID=oc_secret_ready",
    "FEISHU_SMOKE_DOC_TOKEN=doccn_secret_ready",
    "FEISHU_SMOKE_DOC_PARENT_BLOCK_ID=blk_secret_ready",
    "FEISHU_SMOKE_DOC_APPEND_BLOCKS_JSON=[{\"block_type\":2,\"text\":{\"elements\":[{\"text_run\":{\"content\":\"AgentSpace smoke\"}}]}}]",
    "FEISHU_SMOKE_SHEET_TOKEN=shtcn_secret_ready",
    "FEISHU_SMOKE_SHEET_WRITE_RANGE=Sheet1!A1:B1",
    "FEISHU_SMOKE_SHEET_WRITE_VALUES_JSON=[[\"AgentSpace smoke\"]]",
    "FEISHU_SMOKE_BASE_APP_TOKEN=app_secret_ready",
    "FEISHU_SMOKE_BASE_TABLE_ID=tbl_secret_ready",
    "FEISHU_SMOKE_BASE_RECORD_ID=rec_secret_ready",
    "FEISHU_SMOKE_BASE_UPDATE_FIELDS_JSON={\"Smoke\":\"AgentSpace\"}",
    "FEISHU_SECOND_AGENT_APP_ID=cli_same_app_secret",
    "FEISHU_SECOND_AGENT_APP_SECRET=second_secret_ready",
    "",
  ].join("\n"), "utf8");

  try {
    const result = await runSmokeLiveWithEnvFile(envPath, ["--strict-live", "--require-todo120-native"]);

    assert.equal(result.status, 1);
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      errorCode: string;
      envNames: string[];
      reason: string;
    };
    assert.equal(output.ok, false);
    assert.equal(output.errorCode, "feishu.smoke.live_env_not_ready");
    assert.equal(output.reason, "invalid_todo120_native_env");
    assert.deepEqual(output.envNames, ["FEISHU_SECOND_AGENT_APP_ID"]);
    assert.equal(result.stdout.includes("cli_same_app_secret"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("strict live TODO120 native smoke rejects duplicate primary and second app secrets before network calls", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-live-todo120-same-secret-"));
  const envPath = join(directory, ".env");
  writeFileSync(envPath, [
    "FEISHU_APP_ID=cli_primary_app",
    "FEISHU_APP_SECRET=shared_secret_value",
    "FEISHU_VERIFICATION_TOKEN=verify_secret_ready",
    "FEISHU_SMOKE_CALLBACK_URL=https://agent.test/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=feishu-1",
    "FEISHU_SMOKE_CHAT_ID=oc_secret_ready",
    "FEISHU_SMOKE_DOC_TOKEN=doccn_secret_ready",
    "FEISHU_SMOKE_DOC_PARENT_BLOCK_ID=blk_secret_ready",
    "FEISHU_SMOKE_DOC_APPEND_BLOCKS_JSON=[{\"block_type\":2,\"text\":{\"elements\":[{\"text_run\":{\"content\":\"AgentSpace smoke\"}}]}}]",
    "FEISHU_SMOKE_SHEET_TOKEN=shtcn_secret_ready",
    "FEISHU_SMOKE_SHEET_WRITE_RANGE=Sheet1!A1:B1",
    "FEISHU_SMOKE_SHEET_WRITE_VALUES_JSON=[[\"AgentSpace smoke\"]]",
    "FEISHU_SMOKE_BASE_APP_TOKEN=app_secret_ready",
    "FEISHU_SMOKE_BASE_TABLE_ID=tbl_secret_ready",
    "FEISHU_SMOKE_BASE_RECORD_ID=rec_secret_ready",
    "FEISHU_SMOKE_BASE_UPDATE_FIELDS_JSON={\"Smoke\":\"AgentSpace\"}",
    "FEISHU_SECOND_AGENT_APP_ID=cli_second_app",
    "FEISHU_SECOND_AGENT_APP_SECRET=shared_secret_value",
    "",
  ].join("\n"), "utf8");

  try {
    const result = await runSmokeLiveWithEnvFile(envPath, ["--strict-live", "--require-todo120-native"]);

    assert.equal(result.status, 1);
    const output = JSON.parse(result.stdout) as {
      ok: boolean;
      errorCode: string;
      envNames: string[];
      reason: string;
    };
    assert.equal(output.ok, false);
    assert.equal(output.errorCode, "feishu.smoke.live_env_not_ready");
    assert.equal(output.reason, "invalid_todo120_native_env");
    assert.deepEqual(output.envNames, ["FEISHU_SECOND_AGENT_APP_SECRET"]);
    assert.equal(result.stdout.includes("shared_secret_value"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runVerifyEvidence(path: string) {
  return spawnSync(process.execPath, [
    "--experimental-strip-types",
    "scripts/feishu/smoke.ts",
    "--verify-evidence",
    path,
    "--json",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function runSmokeJson() {
  return spawnSync(process.execPath, [
    "--experimental-strip-types",
    "scripts/feishu/smoke.ts",
    "--json",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: withoutFeishuEnv(),
  });
}

function runSmokeCheckEnv(path: string, extraArgs: string[] = []) {
  return spawnSync(process.execPath, [
    "--experimental-strip-types",
    "scripts/feishu/smoke.ts",
    "--env-file",
    path,
    "--check-env",
    "--json",
    ...extraArgs,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: withoutFeishuEnv(),
  });
}

function runSmokeLiveWithEnvFile(path: string): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}>;
function runSmokeLiveWithEnvFile(path: string, extraArgs: string[]): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}>;
function runSmokeLiveWithEnvFile(path: string, extraArgs: string[] = []): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--experimental-strip-types",
      "scripts/feishu/smoke.ts",
      "--env-file",
      path,
      "--live",
      ...extraArgs,
      "--json",
    ], {
      cwd: process.cwd(),
      env: {
        ...withoutFeishuEnv(),
        AGENT_SPACE_FEISHU_ALLOW_UNSAFE_TEST_API_BASE_URL: "1",
        NODE_ENV: "test",
      },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        reject(new Error("Timed out waiting for Feishu smoke live callback probe."));
      }
    }, 10_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    child.on("close", (status) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve({ status, stdout, stderr });
      }
    });
  });
}

function writeCompleteSmokeEnv(path: string, callbackUrl: string): void {
  writeFileSync(path, [
    "FEISHU_APP_ID=cli_ready_secret",
    "FEISHU_APP_SECRET=app_secret_ready",
    "FEISHU_VERIFICATION_TOKEN=verify_secret_ready",
    `FEISHU_SMOKE_CALLBACK_URL=${callbackUrl}`,
    "FEISHU_SMOKE_CHAT_ID=oc_secret_ready",
    "FEISHU_SMOKE_DOC_TOKEN=doccn_secret_ready",
    "FEISHU_SMOKE_DOC_PARENT_BLOCK_ID=blk_secret_ready",
    "FEISHU_SMOKE_DOC_APPEND_BLOCKS_JSON=[{\"block_type\":2,\"text\":{\"elements\":[{\"text_run\":{\"content\":\"AgentSpace smoke\"}}]}}]",
    "FEISHU_SMOKE_SHEET_TOKEN=shtcn_secret_ready",
    "FEISHU_SMOKE_SHEET_WRITE_RANGE=Sheet1!A1:B1",
    "FEISHU_SMOKE_SHEET_WRITE_VALUES_JSON=[[\"AgentSpace smoke\"]]",
    "FEISHU_SMOKE_BASE_APP_TOKEN=app_secret_ready",
    "FEISHU_SMOKE_BASE_TABLE_ID=tbl_secret_ready",
    "FEISHU_SMOKE_BASE_RECORD_ID=rec_secret_ready",
    "FEISHU_SMOKE_BASE_UPDATE_FIELDS_JSON={\"Smoke\":\"AgentSpace\"}",
    "",
  ].join("\n"), "utf8");
}

function withoutFeishuEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("FEISHU_") || key.startsWith("AGENT_SPACE_FEISHU_")) {
      delete env[key];
    }
  }
  return env;
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function writeEvidenceFixture(evidence: ReturnType<typeof buildEvidenceFixture>): string {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-smoke-"));
  const evidencePath = join(directory, "live.json");
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  tempFixtureDirectories.push(directory);
  return evidencePath;
}

function writePayloadFixture(payload: Record<string, unknown>): string {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-payload-"));
  const payloadPath = join(directory, "callback.json");
  writeFileSync(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  tempFixtureDirectories.push(directory);
  return payloadPath;
}

function buildEvidenceFixture() {
  const steps = [
    liveStep("Client im.message.create", {
      method: "POST",
      path: "/open-apis/im/v1/messages",
      queryKeys: ["receive_id_type"],
      bodyKeys: ["content", "msg_type", "receive_id"],
    }),
    callbackLiveStep(),
    liveStep("Tenant access token"),
    liveStep("Docs docx metadata", {
      method: "POST",
      path: "/open-apis/drive/v1/metas/batch_query",
      bodyKeys: ["request_docs", "with_url"],
    }),
    liveStep("Docs docx read blocks", {
      method: "GET",
      path: "/open-apis/docx/v1/documents/:doc_token/blocks",
      queryKeys: ["page_size"],
    }),
    liveStep("Docs docx append blocks", {
      method: "POST",
      path: "/open-apis/docx/v1/documents/:doc_token/blocks/:parent_block_id/children",
      bodyKeys: ["children", "index"],
    }, true),
    liveStep("Sheets metadata", {
      method: "GET",
      path: "/open-apis/sheets/v2/spreadsheets/:sheet_token/metainfo",
    }),
    liveStep("Sheets read values", {
      method: "GET",
      path: "/open-apis/sheets/v2/spreadsheets/:sheet_token/values/:range",
    }),
    liveStep("Sheets write values", {
      method: "PUT",
      path: "/open-apis/sheets/v2/spreadsheets/:sheet_token/values",
      bodyKeys: ["valueRange"],
    }, true),
    liveStep("Base list tables", {
      method: "GET",
      path: "/open-apis/bitable/v1/apps/:app_token/tables",
      queryKeys: ["page_size"],
    }),
    liveStep("Base list records", {
      method: "GET",
      path: "/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records",
      queryKeys: ["page_size"],
    }),
    liveStep("Base update record", {
      method: "PUT",
      path: "/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/:record_id",
      bodyKeys: ["fields"],
    }, true),
    {
      name: "EventDispatcher im.message.receive_v1",
      status: "pass",
      detail: "local dispatcher invoked the receive-message handler.",
    },
    {
      name: "EventDispatcher im.chat.member.bot.added_v1",
      status: "pass",
      detail: "local dispatcher invoked the bot-added handler.",
    },
    {
      name: "EventDispatcher card.action.trigger",
      status: "pass",
      detail: "local dispatcher invoked the card-action handler.",
    },
    {
      name: "HTTP challenge auto response",
      status: "pass",
      detail: "{\"challenge\":\"challenge-smoke\"}",
    },
  ];
  return {
    generatedAt: "2026-06-24T00:00:00.000Z",
    live: true,
    strictLive: true,
    summary: {
      total: steps.length,
      passed: steps.length,
      skipped: 0,
      failed: 0,
      liveChecks: 12,
      livePassed: 12,
      liveSkipped: 0,
      liveFailed: 0,
      destructiveLiveChecks: 3,
      missingEnv: [],
      strictLiveSatisfied: true,
    },
    todo120NativeSmoke: {
      ready: true,
      requiredForCommand: true,
      required: 2,
      configured: 2,
      missing: [],
      invalid: [],
    },
    steps,
  };
}

function callbackLiveStep() {
  return {
    name: "AgentSpace callback URL verification",
    status: "pass",
    detail: "ok",
    liveCheck: true,
    requiredEnv: ["FEISHU_SMOKE_CALLBACK_URL", "FEISHU_VERIFICATION_TOKEN"],
    callbackRoute: "/api/integrations/feishu/events",
    callbackRouteFingerprint: "sha256:0123456789abcdef",
  };
}

function liveStep(
  name: string,
  request?: {
    method: string;
    path: string;
    queryKeys?: string[];
    bodyKeys?: string[];
  },
  destructive = false,
) {
  return {
    name,
    status: "pass",
    detail: "ok",
    liveCheck: true,
    requiredEnv: ["FEISHU_APP_ID"],
    ...(destructive ? { destructive: true } : {}),
    ...(request ? { request } : {}),
  };
}
