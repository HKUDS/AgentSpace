import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildFeishuEvidenceReport,
  buildFeishuReadinessReport,
  buildFeishuAgentChannelAccessCliInputFromFlags,
  buildFeishuAgentBotCliInputFromFlags,
  buildFeishuAgentBotPolicyCliInputFromFlags,
  buildFeishuCreateCliInputFromFlags,
  buildFeishuChannelBindingsCliReport,
  buildFeishuCliDataOperationParameters,
  buildFeishuCliBindingErrorReport,
  buildFeishuCliAgentBotErrorReport,
  createFeishuAgentBotBindingForCli,
  createFeishuIntegrationForCli,
  disableFeishuAgentBotForCli,
  readFeishuCreateCliEnv,
  rotateFeishuAgentBotCredentialsForCli,
  setFeishuAgentChannelAccessForCli,
  updateFeishuAgentBotPolicyForCli,
  createFeishuChannelBindingForCli,
  createFeishuResourceBindingForCli,
  createFeishuUserBindingForCli,
  runFeishuHealthCheckCli,
  runFeishuDataOperationForCli,
  runFeishuDataOperationApprovalReviewForCli,
  buildFeishuSmokePlanReport,
  buildFeishuSmokeEnvTemplateReport,
  formatFeishuEvidenceCommandText,
  formatFeishuSmokePlanCommandText,
  formatFeishuSmokeEnvCommandText,
  getFeishuSmokeEnvExitCode,
  getFeishuSmokePlanExitCode,
  getFeishuWorkerExitCode,
  runFeishuIntegrationCommand,
} from "./integrations/feishu.ts";
import { runIntegrationsCommand } from "./integrations/index.ts";
import { runIntegrationsOutboxCommand } from "./integrations/outbox.ts";
import {
  createSlackAgentBotBindingForCli,
  createSlackChannelBindingForCli,
  createSlackIntegrationForCli,
  createSlackUserBindingForCli,
  disableSlackAgentBotForCli,
  runSlackIntegrationCommand,
  runSlackWorkerForCli,
} from "./integrations/slack.ts";
import { printCommandHelp } from "../lib/help.ts";

const FEISHU_TEST_SCOPES = [
  "im:message",
  "im:message:send_as_bot",
  "contact:user.base:readonly",
  "docx:document",
  "drive:drive",
  "sheets:spreadsheet",
  "bitable:app",
];

const FEISHU_TEST_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const FEISHU_TEST_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH = "runtime-output/feishu-data-operation-result.json";
const FEISHU_TEST_CHAT_REFERENCE = "chat 1234567890abcdef";
const FEISHU_OTHER_TEST_CHAT_REFERENCE = "chat fedcba0987654321";
const STALE_FEISHU_EVIDENCE_TIMESTAMP = "2000-01-01T00:00:00.000Z";

function freshFeishuEvidenceTimestamp(ageMs = 0): string {
  return new Date(Date.now() - ageMs).toISOString();
}

test("integrations help documents Feishu worker deployment controls", async () => {
  const logs = await captureConsoleLog(async () => {
    const exitCode = await runIntegrationsCommand("help", [], "text");
    assert.equal(exitCode, 0);
  });
  const output = logs.join("\n");

  assert.match(output, /integrations feishu worker/);
  assert.match(output, /integrations feishu create/);
  assert.match(output, /integrations feishu bind-agent-bot/);
  assert.match(output, /integrations feishu rotate-agent-bot-secret/);
  assert.match(output, /integrations feishu disable-agent-bot/);
  assert.match(output, /integrations feishu auto-provision-policy/);
  assert.match(output, /integrations feishu agent-channel-access/);
  assert.match(output, /integrations feishu agent-bot-readiness/);
  assert.match(output, /integrations feishu readiness/);
  assert.match(output, /integrations feishu smoke-plan/);
  assert.match(output, /integrations feishu smoke-env/);
  assert.match(output, /integrations feishu health-check/);
  assert.match(output, /integrations feishu evidence/);
  assert.match(output, /integrations feishu data-operation/);
  assert.match(output, /integrations feishu review-data-operation/);
  assert.match(output, /integrations feishu channel-bindings/);
  assert.match(output, /plan-doc-create\|plan-doc-update\|plan-doc-append/);
  assert.match(output, /--parent-block-id <block-id>/);
  assert.match(output, /integrations feishu bind-channel/);
  assert.match(output, /integrations feishu bind-user/);
  assert.match(output, /integrations feishu bind-resource/);
  assert.match(output, /--app-id-env FEISHU_APP_ID/);
  assert.match(output, /--app-secret-env FEISHU_APP_SECRET/);
  assert.match(output, /--verification-token-env FEISHU_VERIFICATION_TOKEN/);
  assert.match(output, /--encrypt-key-env FEISHU_ENCRYPT_KEY/);
  assert.match(output, /--dry-run/);
  assert.match(output, /--include-webhook/);
  assert.match(output, /--drain-outbox\|--once/);
  assert.match(output, /--base-url <url>/);
  assert.match(output, /--app-url <url>/);
  assert.match(output, /--openapi-evidence <path>/);
  assert.match(output, /--bot-added-payload-evidence <path>/);
  assert.match(output, /required for --require all/);
  assert.match(output, /--allow-write/);
  assert.match(output, /--guest-readable/);
  assert.match(output, /--approval-agent <agent-id>/);
  assert.match(output, /--approval-channel <channel>/);
  assert.match(output, /--approval-id <approval-id>/);
  assert.match(output, /--locked-by <id>/);
  assert.match(output, /--access enabled\|disabled/);
  assert.match(output, /--require bot\|native\|guest-policy\|data-plane\|worker\|failure\|all/);
  assert.match(output, /--resource CHANGE_ME_FEISHU_DOC_URL_OR_TOKEN/);
  assert.match(output, /--resource CHANGE_ME_FEISHU_SHEET_URL_OR_TOKEN/);
  assert.match(output, /--channel CHANGE_ME_AGENTSPACE_CHANNEL --chat-id CHANGE_ME_FEISHU_CHAT_ID --json/);
  assert.match(output, /agent-space integrations feishu smoke-plan --workspace-id default --app-url https:\/\/agentspace\.example\.com\n/);
  assert.match(output, /agent-space integrations feishu evidence --workspace-id default --openapi-evidence runtime-output\/feishu-smoke\/live\.json --bot-added-payload-evidence runtime-output\/feishu-smoke\/bot-added-payload-evidence\.json --strict --require all\n/);
  assert.doesNotMatch(output, /smoke-plan --workspace-id default --app-url https:\/\/agentspace\.example\.com --json/);
  assert.doesNotMatch(output, /evidence --workspace-id default --openapi-evidence runtime-output\/feishu-smoke\/live\.json --bot-added-payload-evidence runtime-output\/feishu-smoke\/bot-added-payload-evidence\.json --strict --require all --json/);
  assert.doesNotMatch(output, /--resource <doc-url-or-token>/);
  assert.doesNotMatch(output, /--resource <sheet-url-or-token>/);
});

test("global integrations help documents both Feishu final evidence artifacts", async () => {
  const logs = await captureConsoleLog(async () => {
    printCommandHelp("integrations");
  });
  const output = logs.join("\n");

  assert.match(
    output,
    /agent-space integrations feishu evidence \[--workspace-id <id>\] \[--integration <id>\] \[--openapi-evidence <path>\] \[--bot-added-payload-evidence <path>\]/,
  );
  assert.match(
    output,
    /agent-space integrations feishu evidence --workspace-id default --openapi-evidence runtime-output\/feishu-smoke\/live\.json --bot-added-payload-evidence runtime-output\/feishu-smoke\/bot-added-payload-evidence\.json --strict --require all\n/,
  );
  assert.doesNotMatch(
    output,
    /evidence --workspace-id default --openapi-evidence runtime-output\/feishu-smoke\/live\.json --bot-added-payload-evidence runtime-output\/feishu-smoke\/bot-added-payload-evidence\.json --strict --require all --json/,
  );
});

test("integrations help documents Slack message transport commands", async () => {
  const logs = await captureConsoleLog(async () => {
    const exitCode = await runIntegrationsCommand("help", [], "text");
    assert.equal(exitCode, 0);
  });
  const output = logs.join("\n");

  assert.match(output, /integrations slack create/);
  assert.match(output, /integrations slack bind-agent-bot/);
  assert.match(output, /integrations slack disable-agent-bot/);
  assert.match(output, /integrations slack bind-channel/);
  assert.match(output, /integrations slack bind-user/);
  assert.match(output, /integrations slack worker/);
  assert.match(output, /integrations slack health-check/);
  assert.match(output, /integrations slack readiness/);
  assert.match(output, /integrations slack evidence/);
  assert.match(output, /integrations slack smoke-plan/);
  assert.match(output, /integrations slack smoke-env/);
  assert.match(output, /integrations slack outbox drain/);
  assert.match(output, /--bot-token-env SLACK_BOT_TOKEN/);
  assert.match(output, /--signing-secret-env SLACK_SIGNING_SECRET/);
  assert.match(output, /--require message\|worker\|all/);
  assert.match(output, /--require message\|native\|approval\|files\|all/);
  assert.match(output, /--live-smoke-evidence/);
});

test("slack --help prints usage without touching external services", async () => {
  const logs = await captureConsoleLog(async () => {
    const exitCode = await runSlackIntegrationCommand(["--help"], "text");
    assert.equal(exitCode, 0);
  });
  const output = logs.join("\n");

  assert.match(output, /agent-space integrations slack create/);
  assert.match(output, /agent-space integrations slack bind-agent-bot/);
  assert.match(output, /agent-space integrations slack disable-agent-bot/);
  assert.match(output, /agent-space integrations slack bind-channel/);
  assert.match(output, /agent-space integrations slack bind-user/);
  assert.match(output, /agent-space integrations slack worker/);
  assert.match(output, /agent-space integrations slack health-check/);
  assert.match(output, /agent-space integrations slack readiness/);
  assert.match(output, /agent-space integrations slack evidence/);
  assert.match(output, /agent-space integrations slack smoke-plan/);
  assert.match(output, /agent-space integrations slack smoke-env/);
  assert.match(output, /agent-space integrations slack outbox drain/);
  assert.match(output, /--dry-run/);
  assert.match(output, /--strict/);
  assert.match(output, /--live-smoke-evidence/);
});

test("Slack command dispatcher routes subcommands without external services", async () => {
  const calls: Array<{
    action: string;
    flags?: Record<string, string | boolean>;
    format?: string;
  }> = [];
  const deps = {
    createIntegration: (flags: Record<string, string | boolean>) => {
      calls.push({ action: "create", flags });
      return { ok: true, action: "create" };
    },
    createChannelBinding: (flags: Record<string, string | boolean>) => {
      calls.push({ action: "bind-channel", flags });
      return { ok: true, action: "bind-channel" };
    },
    createUserBinding: (flags: Record<string, string | boolean>) => {
      calls.push({ action: "bind-user", flags });
      return { ok: true, action: "bind-user" };
    },
    createAgentBotBinding: (flags: Record<string, string | boolean>) => {
      calls.push({ action: "bind-agent-bot", flags });
      return { ok: true, action: "bind-agent-bot" };
    },
    disableAgentBot: (flags: Record<string, string | boolean>) => {
      calls.push({ action: "disable-agent-bot", flags });
      return { ok: true, action: "disable-agent-bot" };
    },
    runHealthCheck: async (flags: Record<string, string | boolean>) => {
      calls.push({ action: "health-check", flags });
      return {
        ok: true,
        action: "health-check",
        health: { status: "healthy" },
      } as never;
    },
    buildReadinessReport: (input: Record<string, unknown>) => {
      calls.push({ action: "readiness", flags: input as Record<string, string | boolean> });
      return {
        ok: true,
        action: "readiness",
        strict: input.strict === true,
        strictSatisfied: true,
      } as never;
    },
    buildEvidenceReport: (input: Record<string, unknown>) => {
      calls.push({ action: "evidence", flags: input as Record<string, string | boolean> });
      return {
        ok: true,
        action: "evidence",
        strict: input.strict === true,
        strictSatisfied: true,
      } as never;
    },
    buildSmokePlanReport: (input: Record<string, unknown>) => {
      calls.push({ action: "smoke-plan", flags: input as Record<string, string | boolean> });
      return {
        ok: true,
        action: "smoke-plan",
        strict: input.strict === true,
        readiness: { strictSatisfied: true },
      } as never;
    },
    buildSmokeEnvTemplateReport: (input: Record<string, unknown>) => {
      calls.push({ action: "smoke-env", flags: input as Record<string, string | boolean> });
      return {
        ok: true,
        action: "smoke-env",
        ready: true,
        template: "SLACK_SMOKE=1",
      } as never;
    },
    runWorker: async (flags: Record<string, string | boolean>, format: "text" | "json") => {
      calls.push({ action: "worker", flags, format });
      console.log(JSON.stringify({ ok: true, action: "worker" }, null, 2));
      return 0;
    },
    drainOutbox: async (flags: Record<string, string | boolean>) => {
      calls.push({ action: "outbox-drain", flags });
      return {
        ok: true,
        action: "outbox-drain",
        processedCount: 0,
        errors: [],
      } as never;
    },
  };
  const cases = [
    { args: ["create", "--workspace-id", "workspace-1"], action: "create" },
    { args: ["bind-channel", "--workspace-id", "workspace-1", "--integration", "slack-1"], action: "bind-channel" },
    { args: ["bind-user", "--workspace-id", "workspace-1", "--integration", "slack-1"], action: "bind-user" },
    { args: ["bind-agent-bot", "--workspace-id", "workspace-1", "--agent", "Atlas"], action: "bind-agent-bot" },
    { args: ["disable-agent-bot", "--workspace-id", "workspace-1", "--agent", "Atlas"], action: "disable-agent-bot" },
    { args: ["health-check", "--workspace-id", "workspace-1", "--integration", "slack-1"], action: "health-check" },
    { args: ["readiness", "--workspace-id", "workspace-1", "--integration", "slack-1", "--strict"], action: "readiness" },
    { args: ["evidence", "--workspace-id", "workspace-1", "--integration", "slack-1", "--strict"], action: "evidence" },
    { args: ["evidence", "--workspace-id", "workspace-1", "--integration", "slack-1", "--strict", "--require", "all"], action: "evidence" },
    { args: ["smoke-plan", "--workspace-id", "workspace-1", "--integration", "slack-1", "--app-url", "https://agent.test"], action: "smoke-plan" },
    { args: ["smoke-env", "--workspace-id", "workspace-1", "--integration", "slack-1", "--app-url", "https://agent.test"], action: "smoke-env" },
    { args: ["worker", "--workspace-id", "workspace-1", "--integration", "slack-1", "--dry-run"], action: "worker" },
    { args: ["outbox", "drain", "--workspace-id", "workspace-1", "--integration", "slack-1"], action: "outbox-drain" },
  ];

  for (const item of cases) {
    const logs = await captureConsoleLog(async () => {
      const exitCode = await runSlackIntegrationCommand(item.args, "json", deps);
      assert.equal(exitCode, 0);
    });
    const output = JSON.parse(logs.join("\n")) as Record<string, unknown>;
    assert.equal(output.action, item.action);
  }

  assert.deepEqual(calls.map((call) => call.action), cases.map((item) => item.action));
  assert.equal(calls.find((call) => call.action === "worker")?.format, "json");
  const strictAllEvidence = calls.find((call) =>
    call.action === "evidence" && call.flags?.required === "all"
  );
  assert.equal(strictAllEvidence?.flags?.liveSmokeEvidencePath, "runtime-output/slack-smoke/live.json");
  assert.equal(strictAllEvidence?.flags?.requireLiveSmokeEvidence, true);
  assert.equal(calls.some((call) => JSON.stringify(call).includes("xoxb-")), false);
});

test("Slack outbox drain CLI exposes terminal failures without secrets", async () => {
  const logs = await captureConsoleLog(async () => {
    const exitCode = await runSlackIntegrationCommand(
      ["outbox", "drain", "--workspace-id", "workspace-1", "--integration", "slack-1", "--limit", "1"],
      "json",
      {
        drainOutbox: async (flags: Record<string, string | boolean>) => {
          assert.equal(flags["workspace-id"], "workspace-1");
          assert.equal(flags.integration, "slack-1");
          assert.equal(flags.limit, "1");
          return {
            workspaceId: "workspace-1",
            provider: "slack",
            integrationCount: 1,
            processedCount: 1,
            sentCount: 0,
            failedCount: 1,
            results: [{
              integrationId: "slack-1",
              outboxId: "outbox-1",
              status: "failed",
              errorCode: "slack.outbound.invalid_auth",
              errorMessage: "Slack chat.postMessage failed: slack.outbound.invalid_auth",
              retryable: false,
              terminal: true,
            }],
            errors: [],
          } as never;
        },
      },
    );
    assert.equal(exitCode, 0);
  });

  const output = JSON.parse(logs.join("\n")) as {
    failedCount?: number;
    results?: Array<{
      status?: string;
      errorCode?: string;
      errorMessage?: string;
      terminal?: boolean;
    }>;
  };
  const serialized = JSON.stringify(output);
  assert.equal(output.failedCount, 1);
  assert.equal(output.results?.[0]?.status, "failed");
  assert.equal(output.results?.[0]?.errorCode, "slack.outbound.invalid_auth");
  assert.equal(output.results?.[0]?.terminal, true);
  assert.match(output.results?.[0]?.errorMessage ?? "", /slack\.outbound\.invalid_auth/);
  assert.doesNotMatch(serialized, /xoxb-|xapp-|signing-secret|CSECRET|USECRET/);
});

test("Slack create CLI stores encrypted credentials and returns redacted setup output", () => {
  const envDir = mkdtempSync(join(tmpdir(), "agent-space-slack-create-cli-"));
  const envFile = join(envDir, ".env");
  writeFileSync(envFile, [
    "SLACK_BOT_TOKEN=xoxb-workspace-secret",
    "SLACK_SIGNING_SECRET=workspace-signing-secret",
    "SLACK_APP_TOKEN=xapp-workspace-secret",
    "SLACK_CLIENT_ID=client-id-secret",
    "SLACK_CLIENT_SECRET=client-secret-value",
  ].join("\n"));
  const encryptInputs: unknown[] = [];
  const createInputs: unknown[] = [];

  try {
    const report = createSlackIntegrationForCli({
      "workspace-id": "workspace-1",
      name: "Launch Slack",
      "app-id": "A-workspace",
      "team-id": "T-workspace",
      transport: "websocket_worker",
      "env-file": envFile,
      "client-id-env": "SLACK_CLIENT_ID",
      "client-secret-env": "SLACK_CLIENT_SECRET",
      "app-level-token-env": "SLACK_APP_TOKEN",
      "created-by-user-id": "admin-1",
    }, {
      encryptCredentials: (input) => {
        encryptInputs.push(input);
        return {
          botToken: "encrypted-bot-token",
          signingSecret: "encrypted-signing-secret",
          appLevelToken: "encrypted-app-token",
          clientId: "encrypted-client-id",
          clientSecret: "encrypted-client-secret",
        };
      },
      createIntegration: (input) => {
        createInputs.push(input);
        return buildIntegrationRecord({
          id: "slack-created",
          provider: "slack",
          displayName: input.displayName,
          transportMode: input.transportMode,
          appId: input.appId,
          tenantKey: input.tenantKey,
          encryptedCredentialsJson: JSON.stringify(input.encryptedCredentialsJson),
          configJson: JSON.stringify(input.configJson),
          capabilitiesJson: JSON.stringify(input.capabilitiesJson),
          scopesJson: JSON.stringify(input.scopesJson),
          createdByUserId: input.createdByUserId,
        }) as never;
      },
    });

    assert.deepEqual(encryptInputs, [{
      botToken: "xoxb-workspace-secret",
      signingSecret: "workspace-signing-secret",
      appLevelToken: "xapp-workspace-secret",
      clientId: "client-id-secret",
      clientSecret: "client-secret-value",
    }]);
    assert.equal(createInputs.length, 1);
    assert.equal(report.ok, true);
    assert.equal(report.integrationId, "slack-created");
    assert.equal(report.provider, "slack");
    assert.equal(report.transportMode, "websocket_worker");
    assert.equal(report.eventCallbackPath, "/api/integrations/slack/events");
    assert.equal(report.interactionCallbackPath, "/api/integrations/slack/interactions");
    assert.equal(report.secretRedacted, true);
    assert.deepEqual(report.credentialSummary, {
      hasBotToken: true,
      hasSigningSecret: true,
      hasAppLevelToken: true,
      hasClientId: true,
      hasClientSecret: true,
    });
    const serialized = JSON.stringify({ report, createInputs });
    assert.doesNotMatch(serialized, /xoxb-workspace-secret|workspace-signing-secret|xapp-workspace-secret|client-secret-value/);
    assert.match(serialized, /encrypted-bot-token/);
    assert.match(serialized, /messageTransport/);

    assert.throws(() => createSlackIntegrationForCli({
      "workspace-id": "workspace-1",
      "app-id": "CHANGE_ME_SLACK_APP_ID",
      "team-id": "T-workspace",
      "env-file": envFile,
    }, {
      encryptCredentials: () => {
        throw new Error("encryptCredentials should not run for placeholder values");
      },
      createIntegration: () => {
        throw new Error("createIntegration should not run for placeholder values");
      },
    }), /slack\.placeholder_value:app-id/);
  } finally {
    rmSync(envDir, { recursive: true, force: true });
  }
});

test("Slack channel and user binding CLI returns redacted external references", () => {
  const integration = buildIntegrationRecord({
    id: "slack-1",
    provider: "slack",
    displayName: "Slack",
    transportMode: "http_webhook",
  }) as never;
  const readIntegration = () => integration;
  const channelInputs: unknown[] = [];
  const userInputs: unknown[] = [];

  const channelReport = createSlackChannelBindingForCli({
    "workspace-id": "workspace-1",
    integration: "slack-1",
    channel: "general",
    "slack-channel": "C_SECRET_CHANNEL_123456",
    type: "channel",
    name: "launch-room",
    "created-by-user-id": "admin-1",
  }, {
    readIntegration,
    upsertChannelBinding: (input) => {
      channelInputs.push(input);
      return buildChannelBinding("slack-1", {
        id: "slack-channel-binding",
        workspaceId: input.workspaceId,
        integrationId: input.integrationId,
        channelName: input.channelName,
        externalChatId: input.externalChatId,
        externalChatType: input.externalChatType,
        externalChatName: input.externalChatName,
        createdByUserId: input.createdByUserId,
      }) as never;
    },
  });

  const userReport = createSlackUserBindingForCli({
    "workspace-id": "workspace-1",
    integration: "slack-1",
    "user-id": "user-1",
    "slack-user": "U_SECRET_USER_123456",
    "display-name": "Mina Slack",
  }, {
    readIntegration,
    upsertUserBinding: (input) => {
      userInputs.push(input);
      return buildUserBinding("slack-1", {
        id: "slack-user-binding",
        workspaceId: input.workspaceId,
        integrationId: input.integrationId,
        userId: input.userId,
        externalUserId: input.externalUserId,
        displayName: input.displayName,
      }) as never;
    },
  });

  assert.deepEqual(channelInputs, [{
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    channelName: "general",
    externalChatId: "C_SECRET_CHANNEL_123456",
    externalChatType: "channel",
    externalChatName: "launch-room",
    metadataJson: {
      provider: "slack",
      provisionSource: "manual",
    },
    createdByUserId: "admin-1",
  }]);
  assert.deepEqual(userInputs, [{
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    userId: "user-1",
    externalUserId: "U_SECRET_USER_123456",
    displayName: "Mina Slack",
    metadataJson: {
      provider: "slack",
    },
  }]);
  assert.equal(channelReport.ok, true);
  assert.equal(channelReport.externalChatReference, "channel C_SE...3456");
  assert.equal(userReport.ok, true);
  assert.equal(userReport.externalUserReference, "user U_SE...3456");
  assert.doesNotMatch(JSON.stringify({ channelReport, userReport }), /C_SECRET_CHANNEL_123456|U_SECRET_USER_123456/);
});

test("Slack worker CLI dry-run prints worker summary without opening live sessions", async () => {
  const startInputs: unknown[] = [];
  let closeCount = 0;

  const logs = await captureConsoleLog(async () => {
    const exitCode = await runSlackWorkerForCli({
      "workspace-id": "workspace-1",
      integration: "slack-1",
      limit: "7",
      "base-url": "https://slack.test/api",
      "feishu-base-url": "https://feishu.test/open-apis",
      "locked-by": "slack-cli-test",
      "dry-run": true,
      "include-webhook": true,
    }, "json", {
      startWorker: async (input) => {
        startInputs.push(input);
        return {
          summary: {
            workspaceId: "workspace-1",
            provider: "slack",
            mode: "websocket_worker",
            integrationCount: 1,
            startedCount: 0,
            skippedCount: 0,
            dryRun: true,
            integrations: [{
              integrationId: "slack-1",
              displayName: "Slack Agent",
              status: "ready",
              healthStatus: "healthy",
            }],
            errors: [],
          },
          metrics: {
            connectionReadyCount: 0,
            connectionErrorCount: 0,
            receivedCount: 0,
            ackCount: 0,
            ackFailedCount: 0,
            processedCount: 0,
            ignoredCount: 0,
            failedCount: 0,
            duplicateCount: 0,
            outboxProcessedCount: 0,
            outboxSentCount: 0,
            outboxFailedCount: 0,
            errors: [],
          },
          close() {
            closeCount += 1;
          },
          getConnectionStatuses() {
            return [];
          },
        } as never;
      },
    });
    assert.equal(exitCode, 0);
  });

  assert.deepEqual(startInputs, [{
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    lockedBy: "slack-cli-test",
    baseUrl: "https://slack.test/api",
    feishuBaseUrl: "https://feishu.test/open-apis",
    dryRun: true,
    drainOutboxLimit: 7,
    includeWebhookIntegrations: true,
  }]);
  assert.equal(closeCount, 0);
  const output = JSON.parse(logs.join("\n")) as Record<string, unknown>;
  assert.equal(output.workspaceId, "workspace-1");
  assert.equal(output.provider, "slack");
  assert.equal(output.dryRun, true);
  assert.equal(output.integrationCount, 1);
  assert.deepEqual(output.errors, []);
  assert.doesNotMatch(JSON.stringify(output), /xoxb-|xapp-|signing-secret/);
});

test("Slack agent bot CLI defaults to Socket Mode and redacts credentials", () => {
  const envDir = mkdtempSync(join(tmpdir(), "agent-space-slack-agent-bot-cli-"));
  const envFile = join(envDir, ".env");
  writeFileSync(envFile, [
    "SLACK_BOT_TOKEN=xoxb-agent-bot-secret",
    "SLACK_SIGNING_SECRET=signing-agent-bot-secret",
    "SLACK_APP_TOKEN=xapp-agent-bot-secret",
  ].join("\n"));
  const createInputs: unknown[] = [];

  const report = createSlackAgentBotBindingForCli({
    "workspace-id": "workspace-1",
    agent: "Codex",
    "app-id": "A-agent",
    "team-id": "T-agent",
    "env-file": envFile,
  }, {
    createBinding: (input) => {
      createInputs.push(input);
      return buildIntegrationRecord({
        id: "slack-agent-bot-codex",
        provider: "slack",
        displayName: "Codex Slack Bot",
        transportMode: input.transportMode,
        agentId: input.agentId,
        appId: input.appId,
        tenantKey: input.teamId,
        encryptedCredentialsJson: JSON.stringify({
          botToken: "encrypted-bot-token",
          signingSecret: "encrypted-signing-secret",
          appLevelToken: "encrypted-app-token",
        }),
        scopesJson: JSON.stringify(["app_mentions:read", "chat:write", "connections:write"]),
      }) as never;
    },
  });

  assert.deepEqual(createInputs, [{
    workspaceId: "workspace-1",
    agentId: "Codex",
    displayName: undefined,
    transportMode: "websocket_worker",
    appId: "A-agent",
    teamId: "T-agent",
    botToken: "xoxb-agent-bot-secret",
    signingSecret: "signing-agent-bot-secret",
    appLevelToken: "xapp-agent-bot-secret",
    clientId: undefined,
    clientSecret: undefined,
    createdByUserId: undefined,
  }]);
  assert.equal(report.ok, true);
  assert.equal(report.action, "created");
  assert.equal(report.agentBotBinding, true);
  assert.equal(report.agentId, "Codex");
  assert.equal(report.transportMode, "websocket_worker");
  assert.equal(report.interactionCallbackPath, "/api/integrations/slack/interactions");
  assert.equal(report.secretRedacted, true);
  assert.match(String((report.nextCommands as Record<string, string>).workerDryRun), /worker --workspace-id workspace-1 --integration slack-agent-bot-codex --dry-run --json/);
  assert.doesNotMatch(JSON.stringify(report), /xoxb-agent-bot-secret|signing-agent-bot-secret|xapp-agent-bot-secret/);

  rmSync(envDir, { recursive: true, force: true });
});

test("Slack agent bot CLI can disable by agent without exposing external ids", () => {
  const disableInputs: unknown[] = [];
  const report = disableSlackAgentBotForCli({
    "workspace-id": "workspace-1",
    agent: "Codex",
    "updated-by-user-id": "admin-1",
  }, {
    disableBinding: (input) => {
      disableInputs.push(input);
      return buildIntegrationRecord({
        id: "slack-agent-bot-codex",
        provider: "slack",
        displayName: "Codex Slack Bot",
        status: "disabled",
        transportMode: "websocket_worker",
        agentId: "Codex",
        appId: "A-agent",
        tenantKey: "T-agent",
        encryptedCredentialsJson: JSON.stringify({
          botToken: "encrypted-bot-token",
          signingSecret: "encrypted-signing-secret",
          appLevelToken: "encrypted-app-token",
        }),
      }) as never;
    },
  });

  assert.deepEqual(disableInputs, [{
    workspaceId: "workspace-1",
    integrationId: undefined,
    agentId: "Codex",
    updatedByUserId: "admin-1",
  }]);
  assert.equal(report.action, "disabled");
  assert.equal(report.agentId, "Codex");
  assert.equal(report.agentBotBinding, true);
  assert.equal(report.secretRedacted, true);
  assert.doesNotMatch(JSON.stringify(report), /xoxb-agent-bot-secret|xapp-agent-bot-secret|signing-agent-bot-secret/);
});

test("feishu worker --help prints usage without starting the worker", async () => {
  const logs = await captureConsoleLog(async () => {
    const exitCode = await runFeishuIntegrationCommand(["worker", "--help"], "text");
    assert.equal(exitCode, 0);
  });
  const output = logs.join("\n");

  assert.match(output, /Usage:/);
  assert.match(output, /agent-space integrations feishu worker/);
  assert.match(output, /agent-space integrations feishu create/);
  assert.match(output, /agent-space integrations feishu bind-agent-bot/);
  assert.match(output, /agent-space integrations feishu rotate-agent-bot-secret/);
  assert.match(output, /agent-space integrations feishu disable-agent-bot/);
  assert.match(output, /agent-space integrations feishu auto-provision-policy/);
  assert.match(output, /agent-space integrations feishu agent-channel-access/);
  assert.match(output, /agent-space integrations feishu agent-bot-readiness/);
  assert.match(output, /agent-space integrations feishu readiness/);
  assert.match(output, /agent-space integrations feishu smoke-plan/);
  assert.match(output, /agent-space integrations feishu smoke-env/);
  assert.match(output, /agent-space integrations feishu health-check/);
  assert.match(output, /health-check \[--workspace-id <id>\] \[--integration <id>\|--agent <agent-id-or-name>\]/);
  assert.match(output, /agent-space integrations feishu evidence/);
  assert.match(output, /agent-space integrations feishu data-operation/);
  assert.match(output, /agent-space integrations feishu channel-bindings/);
  assert.match(output, /plan-doc-create\|plan-doc-update\|plan-doc-append/);
  assert.match(output, /--parent-block-id <block-id>/);
  assert.match(output, /agent-space integrations feishu bind-channel/);
  assert.match(output, /agent-space integrations feishu bind-user/);
  assert.match(output, /agent-space integrations feishu bind-resource/);
  assert.match(output, /Refresh saved Feishu health/);
  assert.match(output, /AgentSpace-side Feishu live smoke evidence/);
  assert.match(output, /health-check: require all healthy/);
  assert.match(output, /Create a workspace-level AgentSpace Feishu integration with encrypted credentials/);
  assert.match(output, /Bind one AgentSpace agent to one Feishu bot/);
  assert.match(output, /Temporarily disable\/restore AgentSpace agent channel-member access/);
  assert.match(output, /Validate WebSocket worker config/);
  assert.match(output, /live Feishu manual smoke checklist/);
  assert.match(output, /safe scripts\/feishu\/\.env template/);
  assert.match(output, /manual smoke/);
  assert.match(output, /health-check: require all healthy/);
  assert.match(output, /--require bot\|native\|guest-policy\|data-plane\|worker\|failure\|all/);
  assert.match(output, /evidence gate: bot, native, guest-policy, data-plane, worker, failure, all/);
  assert.match(output, /--app-url <url>/);
  assert.match(output, /--openapi-evidence <path>/);
  assert.match(output, /--bot-added-payload-evidence <path>/);
  assert.match(output, /required for --require all/);
  assert.match(output, /--allow-write/);
  assert.match(output, /--guest-readable/);
  assert.match(output, /Drain due Feishu outbox messages once/);
});

test("integrations outbox drain --help documents operational overrides", async () => {
  const logs = await captureConsoleLog(async () => {
    const exitCode = await runIntegrationsOutboxCommand(["drain", "--help"], "text");
    assert.equal(exitCode, 0);
  });
  const output = logs.join("\n");

  assert.match(output, /agent-space integrations outbox drain/);
  assert.match(output, /--base-url <url>/);
  assert.match(output, /--locked-by <id>/);
});

test("Feishu worker exit code treats connection-only failures as smoke failures", () => {
  assert.equal(getFeishuWorkerExitCode({
    connectionErrorCount: 0,
    failedCount: 0,
    processedCount: 0,
  }), 0);
  assert.equal(getFeishuWorkerExitCode({
    connectionErrorCount: 1,
    failedCount: 0,
    processedCount: 0,
  }), 1);
  assert.equal(getFeishuWorkerExitCode({
    connectionErrorCount: 0,
    failedCount: 1,
    processedCount: 0,
  }), 1);
  assert.equal(getFeishuWorkerExitCode({
    connectionErrorCount: 2,
    failedCount: 1,
    processedCount: 1,
  }), 0);
});

test("Feishu create CLI stores encrypted credentials and returns redacted setup commands", () => {
  const createInputs: unknown[] = [];
  const auditInputs: unknown[] = [];
  const report = createFeishuIntegrationForCli({
    workspaceId: "workspace-1",
    displayName: "Launch Feishu",
    transportMode: "websocket-worker",
    appId: "cli_create",
    appSecret: "secret_create",
    verificationToken: "verify_create",
    encryptKey: "encrypt_create",
    tenantKey: "tenant_create",
    createdByUserId: "admin-1",
    appUrl: "https://agentspace.example.com",
  }, {
    encryptCredentials: (input) => {
      assert.deepEqual(input, {
        appSecret: "secret_create",
        verificationToken: "verify_create",
        encryptKey: "encrypt_create",
      });
      return {
        appSecret: "encrypted-app-secret",
        verificationToken: "encrypted-verification-token",
        encryptKey: "encrypted-encrypt-key",
      };
    },
    createIntegration: (input) => {
      createInputs.push(input);
      return buildIntegrationRecord({
        id: "integration-created",
        displayName: input.displayName,
        transportMode: input.transportMode,
        appId: input.appId,
        tenantKey: input.tenantKey,
        encryptedCredentialsJson: JSON.stringify(input.encryptedCredentialsJson),
        scopesJson: JSON.stringify(input.scopesJson),
      }) as never;
    },
    auditRecorder: (input) => {
      auditInputs.push(input);
      return true;
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.integrationId, "integration-created");
  assert.equal(report.transportMode, "websocket_worker");
  assert.equal(report.appId, "cli_create");
  assert.equal(report.tenantKeyConfigured, true);
  assert.deepEqual(report.credentialsStored, {
    appSecret: true,
    verificationToken: true,
    encryptKey: true,
  });
  assert.equal(report.secretRedacted, true);
  assert.equal(report.requiredScopeCount, FEISHU_TEST_SCOPES.length);
  assert.equal(report.openPlatformSetup.callbackUrlStatus, "ready");
  assert.equal(
    report.openPlatformSetup.callbackUrl,
    "https://agentspace.example.com/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=integration-created",
  );
  assert.deepEqual(report.openPlatformSetup.requiredCredentialFields, [
    "app_id",
    "app_secret",
    "verification_token",
  ]);
  assert.deepEqual(report.openPlatformSetup.requiredEvents, ["im.message.receive_v1", "im.chat.member.bot.added_v1", "card.action.trigger"]);
  assert.deepEqual(report.openPlatformSetup.botScopes, [
    "im:message",
    "im:message:send_as_bot",
    "contact:user.base:readonly",
  ]);
  assert.deepEqual(report.openPlatformSetup.dataPlaneScopes, [
    "docx:document",
    "drive:drive",
    "sheets:spreadsheet",
    "bitable:app",
  ]);
  assert.equal(report.openPlatformSetup.developerConsoleUrl, "https://open.feishu.cn/app");
  assert.deepEqual(report.openPlatformSetup.setupSteps.map((step) => step.id), [
    "create_custom_app",
    "enable_bot",
    "configure_event_subscription",
    "grant_bot_scopes",
    "grant_data_plane_scopes",
    "release_or_install_app",
  ]);
  assert.deepEqual(report.openPlatformSetup.setupSteps[0], {
    id: "create_custom_app",
    consoleUrl: "https://open.feishu.cn/app",
    required: ["app_id", "app_secret"],
  });
  assert.match(report.nextCommands.healthCheck, /health-check --workspace-id workspace-1 --integration integration-created --strict --json/);
  assert.match(report.nextCommands.smokePlan, /smoke-plan --workspace-id workspace-1 --integration integration-created --app-url https:\/\/agentspace\.example\.com$/);
  assert.doesNotMatch(report.nextCommands.smokePlan, /--json/);
  assert.match(report.nextCommands.smokeEnv, /smoke-env --workspace-id workspace-1 --integration integration-created --app-url https:\/\/agentspace\.example\.com > scripts\/feishu\/\.env/);
  assert.match(report.nextCommands.checkEnv, /npm run smoke:feishu -- --env-file scripts\/feishu\/\.env --check-env --json/);
  assert.match(report.nextCommands.checkEnv, /--require-todo120-native/);
  assert.match(report.nextCommands.strictLiveSmoke, /npm run smoke:feishu -- --env-file scripts\/feishu\/\.env --live --strict-live --evidence runtime-output\/feishu-smoke\/live\.json --json/);
  assert.match(report.nextCommands.strictLiveSmoke, /--require-todo120-native/);
  assert.match(report.nextCommands.verifyOpenApiEvidence, /npm run smoke:feishu -- --verify-evidence runtime-output\/feishu-smoke\/live\.json --json/);
  assert.match(report.nextCommands.verifyBotAddedPayload, /npm run smoke:feishu -- --verify-bot-added-payload runtime-output\/feishu-smoke\/bot-added-callback\.json --bot-added-payload-evidence runtime-output\/feishu-smoke\/bot-added-payload-evidence\.json --json/);
  assert.match(report.nextCommands.finalEvidence, /evidence --workspace-id workspace-1 --integration integration-created --openapi-evidence runtime-output\/feishu-smoke\/live\.json --bot-added-payload-evidence runtime-output\/feishu-smoke\/bot-added-payload-evidence\.json --strict --require all$/);
  assert.doesNotMatch(report.nextCommands.finalEvidence, /--json/);
  assert.match(report.nextCommands.bindSecondAgentBot, /bind-agent-bot --workspace-id workspace-1 --agent CHANGE_ME_SECOND_AGENT_NAME/);
  assert.match(report.nextCommands.bindSecondAgentBot, /--app-id-env FEISHU_SECOND_AGENT_APP_ID/);
  assert.match(report.nextCommands.bindSecondAgentBot, /--app-secret-env FEISHU_SECOND_AGENT_APP_SECRET/);
  assert.match(report.nextCommands.bindChannel, /--channel CHANGE_ME_AGENTSPACE_CHANNEL --chat-id CHANGE_ME_FEISHU_CHAT_ID --json/);
  assert.match(report.nextCommands.bindUser, /--user-id CHANGE_ME_AGENTSPACE_USER_ID --open-id CHANGE_ME_FEISHU_OPEN_ID --json/);
  assert.match(report.nextCommands.bindResourceDoc, /--type doc --resource CHANGE_ME_FEISHU_DOC_URL_OR_TOKEN --agent-space-type channel_document --channel CHANGE_ME_AGENTSPACE_CHANNEL --allow-write --json/);
  assert.match(report.nextCommands.bindResourceSheet, /--type sheet --resource CHANGE_ME_FEISHU_SHEET_URL_OR_TOKEN/);
  assert.match(report.nextCommands.bindResourceBase, /--type base_table --resource CHANGE_ME_FEISHU_BASE_TABLE_URL_WITH_APP_TOKEN/);
  assert.equal(createInputs.length, 1);
  assert.equal(auditInputs.length, 1);
  const serialized = JSON.stringify({ report, createInputs, auditInputs });
  assert.equal(serialized.includes("secret_create"), false);
  assert.equal(serialized.includes("verify_create"), false);
  assert.equal(serialized.includes("encrypt_create"), false);
  assert.match(serialized, /encrypted-app-secret/);
  assert.match(serialized, /messageTransport/);
  assert.match(serialized, /docsDataPlane/);
  assert.match(serialized, /eventCallbackPath/);
  assert.match(serialized, /im:message/);
  assert.match(serialized, /bitable:app/);
});

test("Feishu agent bot CLI defaults to websocket worker and redacts credentials", () => {
  const input = buildFeishuAgentBotCliInputFromFlags({
    workspaceId: "workspace-1",
    flags: {
      "agent": "Codex",
      "app-id": "cli_codex_bot",
      "app-secret": "secret_codex_bot",
    },
    actorUserId: "admin-1",
    env: {},
  });
  const createInputs: unknown[] = [];

  const report = createFeishuAgentBotBindingForCli(input, {
    createBinding: (createInput) => {
      createInputs.push(createInput);
      return buildIntegrationRecord({
        id: "agent-bot-codex",
        displayName: createInput.displayName ?? "Codex Feishu Bot",
        transportMode: createInput.transportMode,
        agentId: createInput.agentId,
        appId: createInput.appId,
        tenantKey: createInput.tenantKey,
        encryptedCredentialsJson: JSON.stringify({ appSecret: "encrypted-app-secret" }),
      });
    },
  });

  assert.equal(input.transportMode, "websocket_worker");
  assert.equal(report.kind, "agent_bot");
  assert.equal(report.operation, "created");
  assert.equal(report.integrationId, "agent-bot-codex");
  assert.equal(report.agentId, "Codex");
  assert.equal(report.transportMode, "websocket_worker");
  assert.deepEqual(report.credentials, {
    hasAppSecret: true,
    hasVerificationToken: false,
    hasEncryptKey: false,
  });
  assert.equal(report.secretRedacted, true);
  assert.doesNotMatch(JSON.stringify(report), /secret_codex_bot/);
  assert.deepEqual(createInputs, [{
    workspaceId: "workspace-1",
    agentId: "Codex",
    displayName: undefined,
    transportMode: "websocket_worker",
    appId: "cli_codex_bot",
    appSecret: "secret_codex_bot",
    tenantKey: undefined,
    verificationToken: undefined,
    encryptKey: undefined,
    createdByUserId: "admin-1",
  }]);
});

test("Feishu agent bot CLI accepts auto-provision and guest policy flags", () => {
  const input = buildFeishuAgentBotCliInputFromFlags({
    workspaceId: "workspace-1",
    flags: {
      "agent": "Codex",
      "app-id": "cli_codex_bot",
      "app-secret": "secret_codex_bot",
      "bot-added-policy": "pending_admin_review",
      "first-message-policy": "reply_with_setup_card",
      "review-status": "pending_admin_review",
      "unbound-user-mode": "require_identity",
      "guest-permission-profile": "none",
      "require-identity-for": "writes, approvals, private_resources",
    },
    actorUserId: "admin-1",
    env: {},
  });
  const createInputs: unknown[] = [];

  createFeishuAgentBotBindingForCli(input, {
    createBinding: (createInput) => {
      createInputs.push(createInput);
      return buildIntegrationRecord({
        id: "agent-bot-codex",
        displayName: "Codex Feishu Bot",
        transportMode: createInput.transportMode,
        agentId: createInput.agentId,
        appId: createInput.appId,
        encryptedCredentialsJson: JSON.stringify({ appSecret: "encrypted-app-secret" }),
      });
    },
  });

  assert.deepEqual(createInputs[0], {
    workspaceId: "workspace-1",
    agentId: "Codex",
    displayName: undefined,
    transportMode: "websocket_worker",
    appId: "cli_codex_bot",
    appSecret: "secret_codex_bot",
    tenantKey: undefined,
    verificationToken: undefined,
    encryptKey: undefined,
    createdByUserId: "admin-1",
    channelAutoProvisioning: {
      botAdded: "pending_admin_review",
      firstMessage: "reply_with_setup_card",
      reviewStatus: "pending_admin_review",
    },
    externalGuestPolicy: {
      unboundUserMode: "require_identity",
      guestPermissionProfile: "none",
      requireIdentityFor: ["writes", "approvals", "private_resources"],
    },
  });

  assert.throws(() => buildFeishuAgentBotCliInputFromFlags({
    workspaceId: "workspace-1",
    flags: {
      "agent": "Codex",
      "app-id": "cli_codex_bot",
      "app-secret": "secret_codex_bot",
      "unbound-user-mode": "maybe",
    },
    env: {},
  }), /feishu\.agent_bot_binding\.invalid_external_guest_policy/);
});

test("Feishu agent bot policy CLI updates governance without requiring secrets", () => {
  const input = buildFeishuAgentBotPolicyCliInputFromFlags({
    workspaceId: "workspace-1",
    integrationId: "agent-bot-codex",
    flags: {
      "first-message-policy": "disabled",
      "unbound-user-mode": "ignore",
      "guest-permission-profile": "none",
      "require-identity-for": "writes, approvals, private_resources",
    },
    actorUserId: "admin-1",
  });
  const updateInputs: unknown[] = [];

  const report = updateFeishuAgentBotPolicyForCli(input, {
    updatePolicy: (updateInput) => {
      updateInputs.push(updateInput);
      return buildIntegrationRecord({
        id: "agent-bot-codex",
        displayName: "Codex Feishu Bot",
        transportMode: "websocket_worker",
        agentId: "Codex",
        appId: "cli_codex_bot",
        encryptedCredentialsJson: JSON.stringify({ appSecret: "encrypted-app-secret" }),
        configJson: JSON.stringify({
          channelAutoProvisioning: {
            botAdded: "auto_create_channel",
            firstMessage: "disabled",
            reviewStatus: "approved",
          },
          externalGuestPolicy: {
            unboundUserMode: "ignore",
            guestPermissionProfile: "none",
            requireIdentityFor: ["writes", "approvals", "private_resources"],
          },
        }),
      }) as never;
    },
  });

  assert.deepEqual(updateInputs, [{
    workspaceId: "workspace-1",
    integrationId: "agent-bot-codex",
    agentId: undefined,
    channelAutoProvisioning: {
      firstMessage: "disabled",
    },
    externalGuestPolicy: {
      unboundUserMode: "ignore",
      guestPermissionProfile: "none",
      requireIdentityFor: ["writes", "approvals", "private_resources"],
    },
    updatedByUserId: "admin-1",
  }]);
  assert.equal(report.operation, "policy_updated");
  assert.deepEqual(report.channelAutoProvisioning, {
    botAdded: "auto_create_channel",
    firstMessage: "disabled",
    reviewStatus: "approved",
  });
  assert.deepEqual(report.externalGuestPolicy, {
    unboundUserMode: "ignore",
    guestPermissionProfile: "none",
    requireIdentityFor: ["writes", "approvals", "private_resources"],
  });
  assert.equal(report.secretRedacted, true);
  assert.match(report.nextCommands.bindSecondAgentBot, /--app-secret-env FEISHU_SECOND_AGENT_APP_SECRET/);
  assert.doesNotMatch(JSON.stringify(report), /encrypted-app-secret|super-secret/);

  assert.throws(() => buildFeishuAgentBotPolicyCliInputFromFlags({
    workspaceId: "workspace-1",
    flags: {
      "bot-added-policy": "maybe",
    },
  }), /feishu\.agent_bot_binding\.invalid_channel_auto_provisioning_policy/);
});

test("Feishu agent channel access CLI updates AgentSpace governance for no-reply smoke", () => {
  const input = buildFeishuAgentChannelAccessCliInputFromFlags({
    workspaceId: "workspace-1",
    integrationId: "agent-bot-codex",
    flags: {
      access: "disabled",
    },
    actorUserId: "admin-1",
  });
  const setInputs: unknown[] = [];

  const report = setFeishuAgentChannelAccessForCli(input, {
    readIntegration: (readInput) => {
      assert.deepEqual(readInput, {
        workspaceId: "workspace-1",
        integrationId: "agent-bot-codex",
      });
      return buildIntegrationRecord({
        id: "agent-bot-codex",
        displayName: "Codex Feishu Bot",
        transportMode: "websocket_worker",
        agentId: "Codex",
      });
    },
    setAccess: (agentId, channelMemberAccess, workspaceId) => {
      setInputs.push({ agentId, channelMemberAccess, workspaceId });
      return {
        activeEmployees: [
          {
            name: "Codex",
            channelMemberAccess,
          },
        ],
      } as never;
    },
  });

  assert.deepEqual(input, {
    workspaceId: "workspace-1",
    integrationId: "agent-bot-codex",
    agentId: undefined,
    channelMemberAccess: "disabled",
    actorUserId: "admin-1",
  });
  assert.deepEqual(setInputs, [{
    agentId: "Codex",
    channelMemberAccess: "disabled",
    workspaceId: "workspace-1",
  }]);
  assert.equal(report.kind, "agent_channel_access");
  assert.equal(report.agentId, "Codex");
  assert.equal(report.integrationId, "agent-bot-codex");
  assert.equal(report.channelMemberAccess, "disabled");
  assert.match(report.nextCommands.disableForSmoke, /agent-channel-access --workspace-id workspace-1 --agent Codex --access disabled --json/);
  assert.match(report.nextCommands.restoreAfterSmoke, /agent-channel-access --workspace-id workspace-1 --agent Codex --access enabled --json/);
  assert.match(report.nextCommands.smokePlan, /smoke-plan --workspace-id workspace-1 --integration agent-bot-codex$/);
  assert.doesNotMatch(report.nextCommands.smokePlan, /--json/);

  assert.throws(() => buildFeishuAgentChannelAccessCliInputFromFlags({
    workspaceId: "workspace-1",
    flags: {
      access: "maybe",
    },
  }), /feishu\.agent_channel_access\.invalid_access/);
  assert.throws(() => setFeishuAgentChannelAccessForCli({
    workspaceId: "workspace-1",
    integrationId: "workspace-feishu",
    channelMemberAccess: "disabled",
  }, {
    readIntegration: () => buildIntegrationRecord({
      id: "workspace-feishu",
      agentId: undefined,
    }),
    setAccess: () => {
      throw new Error("setAccess should not be called for workspace integrations");
    },
  }), /feishu\.agent_channel_access\.integration_not_agent_bot/);
});

test("Feishu agent bot CLI rotates and disables existing bindings", () => {
  const rotated = rotateFeishuAgentBotCredentialsForCli({
    workspaceId: "workspace-1",
    integrationId: "agent-bot-codex",
    agentId: "Codex",
    appSecret: "second-secret",
  }, {
    rotateCredentials: (input) => {
      assert.deepEqual(input, {
        workspaceId: "workspace-1",
        integrationId: "agent-bot-codex",
        agentId: "Codex",
        appId: undefined,
        appSecret: "second-secret",
        tenantKey: undefined,
        verificationToken: undefined,
        encryptKey: undefined,
        updatedByUserId: undefined,
      });
      return buildIntegrationRecord({
        id: "agent-bot-codex",
        displayName: "Codex Feishu Bot",
        transportMode: "websocket_worker",
        agentId: "Codex",
        appId: "cli_codex_bot",
        encryptedCredentialsJson: JSON.stringify({ appSecret: "encrypted-second-secret" }),
      });
    },
  });
  const disabled = disableFeishuAgentBotForCli({
    workspaceId: "workspace-1",
    agentId: "Codex",
  }, {
    disableBinding: (input) => {
      assert.deepEqual(input, {
        workspaceId: "workspace-1",
        integrationId: undefined,
        agentId: "Codex",
        updatedByUserId: undefined,
      });
      return buildIntegrationRecord({
        id: "agent-bot-codex",
        displayName: "Codex Feishu Bot",
        status: "disabled",
        transportMode: "websocket_worker",
        agentId: "Codex",
        appId: "cli_codex_bot",
        encryptedCredentialsJson: JSON.stringify({ appSecret: "encrypted-second-secret" }),
      });
    },
  });

  assert.equal(rotated.operation, "rotated");
  assert.equal(rotated.secretRedacted, true);
  assert.equal(disabled.operation, "disabled");
  assert.equal(disabled.status, "disabled");
});

test("Feishu agent bot CLI reports placeholders and duplicate ownership", () => {
  assert.throws(() => buildFeishuAgentBotCliInputFromFlags({
    workspaceId: "workspace-1",
    flags: {
      "agent": "Codex",
      "app-id": "CHANGE_ME_APP_ID",
      "app-secret": "secret",
    },
    env: {},
  }), /feishu\.agent_bot_binding\.placeholder_value:app_id/);
  assert.deepEqual(buildFeishuCliAgentBotErrorReport(new Error("feishu.agent_bot_binding.duplicate_agent")), {
    ok: false,
    errorCode: "feishu.agent_bot_binding.duplicate_agent",
    errorMessage: "This AgentSpace agent already has an active Feishu bot binding.",
    nextStep: "Disable or rotate the existing agent bot binding instead of creating a second active binding.",
  });
  assert.deepEqual(buildFeishuCliAgentBotErrorReport(new Error("feishu.agent_bot_binding.placeholder_value:app_id")), {
    ok: false,
    errorCode: "feishu.agent_bot_binding.placeholder_value",
    errorMessage: "Feishu agent bot input contains a placeholder value for app_id.",
    nextStep: "Replace app_id with the real value from Feishu Open Platform before binding the bot.",
  });
});

test("Feishu create CLI normalizes setup errors before writing integration state", () => {
  const createInputs: unknown[] = [];
  assert.throws(() => createFeishuIntegrationForCli({
    workspaceId: "workspace-1",
    appId: "cli_create",
    appSecret: "secret_create",
    verificationToken: "verify_create",
  }, {
    encryptCredentials: () => {
      throw new Error("AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY is required to store Feishu credentials.");
    },
    createIntegration: (input) => {
      createInputs.push(input);
      return buildIntegrationRecord({ id: "integration-created" }) as never;
    },
  }), /feishu\.create\.credential_encryption_key_missing/);
  assert.equal(createInputs.length, 0);

  assert.throws(() => createFeishuIntegrationForCli({
    workspaceId: "workspace-1",
    appId: "cli_create",
    appSecret: "secret_create",
    verificationToken: "verify_create",
  }, {
    encryptCredentials: () => ({
      appSecret: "encrypted-app-secret",
      verificationToken: "encrypted-verification-token",
    }),
    createIntegration: () => {
      throw new Error("External integration app and tenant are already connected.");
    },
  }), /feishu\.create\.duplicate_app_tenant/);
});

test("Feishu create command returns structured JSON for missing env values", async () => {
  const logs = await captureConsoleLog(async () => {
    const exitCode = await runFeishuIntegrationCommand([
      "create",
      "--workspace-id",
      "workspace-1",
      "--app-id-env",
      "AGENT_SPACE_TEST_MISSING_FEISHU_APP_ID",
    ], "json");
    assert.equal(exitCode, 1);
  });
  const output = JSON.parse(logs.join("\n")) as {
    ok: boolean;
    errorCode: string;
    errorMessage: string;
    nextStep?: string;
  };

  assert.equal(output.ok, false);
  assert.equal(output.errorCode, "feishu.create.missing_env_value");
  assert.match(output.errorMessage, /AGENT_SPACE_TEST_MISSING_FEISHU_APP_ID/);
  assert.match(output.nextStep ?? "", /AGENT_SPACE_TEST_MISSING_FEISHU_APP_ID/);
});

test("Feishu create command rejects placeholder setup values before writing", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "agentspace-feishu-create-placeholder-env-"));
  try {
    const envPath = join(tempDir, ".env");
    writeFileSync(envPath, [
      "AGENT_SPACE_TEST_FEISHU_APP_ID=CHANGE_ME_FEISHU_APP_ID",
      "AGENT_SPACE_TEST_FEISHU_APP_SECRET=CHANGE_ME_FEISHU_APP_SECRET",
      "AGENT_SPACE_TEST_FEISHU_VERIFICATION_TOKEN=CHANGE_ME_FEISHU_VERIFICATION_TOKEN",
      "",
    ].join("\n"));
    const logs = await captureConsoleLog(async () => {
      const exitCode = await runFeishuIntegrationCommand([
        "create",
        "--workspace-id",
        "workspace-1",
        "--env-file",
        envPath,
        "--app-id-env",
        "AGENT_SPACE_TEST_FEISHU_APP_ID",
        "--app-secret-env",
        "AGENT_SPACE_TEST_FEISHU_APP_SECRET",
        "--verification-token-env",
        "AGENT_SPACE_TEST_FEISHU_VERIFICATION_TOKEN",
      ], "json");
      assert.equal(exitCode, 1);
    });
    const output = JSON.parse(logs.join("\n")) as {
      ok: boolean;
      errorCode: string;
      errorMessage: string;
      nextStep?: string;
    };

    assert.equal(output.ok, false);
    assert.equal(output.errorCode, "feishu.create.placeholder_value");
    assert.match(output.errorMessage, /app_id/);
    assert.match(output.nextStep ?? "", /app_id/);
    const serialized = JSON.stringify(output);
    assert.equal(serialized.includes("CHANGE_ME_FEISHU_APP_ID"), false);
    assert.equal(serialized.includes("CHANGE_ME_FEISHU_APP_SECRET"), false);
    assert.equal(serialized.includes("CHANGE_ME_FEISHU_VERIFICATION_TOKEN"), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Feishu bind-resource command returns structured JSON for setup errors", async () => {
  const logs = await captureConsoleLog(async () => {
    const exitCode = await runFeishuIntegrationCommand([
      "bind-resource",
      "--workspace-id",
      "workspace-1",
      "--type",
      "sheet",
      "--resource",
      "shtcn_secret_cli_binding",
      "--agent-space-type",
      "data_table",
      "--channel",
      "general",
      "--json",
    ], "json");
    assert.equal(exitCode, 1);
  });
  const output = JSON.parse(logs.join("\n")) as {
    ok: boolean;
    errorCode: string;
    errorMessage: string;
    nextStep?: string;
  };

  assert.equal(output.ok, false);
  assert.equal(output.errorCode, "feishu.integration.missing_integration_id");
  assert.match(output.errorMessage, /integration id/i);
  assert.match(output.nextStep ?? "", /--integration <id>/);
  assert.equal(JSON.stringify(output).includes("shtcn_secret_cli_binding"), false);
});

test("Feishu binding conflict errors return stable structured setup reports", () => {
  assert.deepEqual(buildFeishuCliBindingErrorReport(new Error("feishu.integration.placeholder_value")), {
    ok: false,
    errorCode: "feishu.integration.placeholder_value",
    errorMessage: "Feishu integration id still contains a placeholder value.",
    nextStep: "Replace the generated CHANGE_ME_* placeholder with an existing Feishu integration id before rerunning the binding command.",
  });
  assert.deepEqual(buildFeishuCliBindingErrorReport(new Error("feishu.bind_channel.placeholder_value")), {
    ok: false,
    errorCode: "feishu.bind_channel.placeholder_value",
    errorMessage: "Feishu channel binding input contains a placeholder value.",
    nextStep: "Replace the generated CHANGE_ME_* placeholders with a real AgentSpace channel and Feishu chat id.",
  });
  assert.deepEqual(buildFeishuCliBindingErrorReport(new Error("feishu.bind_user.placeholder_value")), {
    ok: false,
    errorCode: "feishu.bind_user.placeholder_value",
    errorMessage: "Feishu user binding input contains a placeholder value.",
    nextStep: "Replace the generated CHANGE_ME_* placeholders with a real AgentSpace user id and Feishu Open ID.",
  });
  assert.deepEqual(buildFeishuCliBindingErrorReport(new Error("feishu.bind_resource.placeholder_value")), {
    ok: false,
    errorCode: "feishu.bind_resource.placeholder_value",
    errorMessage: "Feishu resource binding input contains a placeholder value.",
    nextStep: "Replace the generated CHANGE_ME_* placeholders with a real Feishu resource URL/token and AgentSpace target.",
  });
  assert.deepEqual(buildFeishuCliBindingErrorReport(new Error("feishu.bind_channel.external_chat_taken")), {
    ok: false,
    errorCode: "feishu.bind_channel.external_chat_taken",
    errorMessage: "This Feishu chat is already mapped to another AgentSpace channel.",
    nextStep: "Have a workspace admin review or revoke the existing Feishu channel binding before retrying.",
  });
  assert.deepEqual(buildFeishuCliBindingErrorReport(new Error("feishu.bind_user.external_user_taken")), {
    ok: false,
    errorCode: "feishu.bind_user.external_user_taken",
    errorMessage: "This Feishu Open ID is already bound to another AgentSpace user.",
    nextStep: "Have a workspace admin review or revoke the existing Feishu user binding before retrying.",
  });
  assert.deepEqual(buildFeishuCliBindingErrorReport(new Error("feishu.bind_resource.external_resource_taken")), {
    ok: false,
    errorCode: "feishu.bind_resource.external_resource_taken",
    errorMessage: "This Feishu resource is already bound to another AgentSpace resource.",
    nextStep: "Have a workspace admin review or archive the existing Feishu resource binding before retrying.",
  });
});

test("Feishu create CLI input prefers env variables for secret fields", () => {
  const input = buildFeishuCreateCliInputFromFlags({
    workspaceId: "workspace-1",
    flags: {
      "name": "Env Feishu",
      "transport": "http_webhook",
      "app-id-env": "FEISHU_APP_ID",
      "app-secret-env": "FEISHU_APP_SECRET",
      "verification-token-env": "FEISHU_VERIFICATION_TOKEN",
      "encrypt-key-env": "FEISHU_ENCRYPT_KEY",
      "tenant-key-env": "FEISHU_TENANT_KEY",
    },
    createdByUserId: "admin-1",
    appUrl: "https://agentspace.example.com",
    env: {
      FEISHU_APP_ID: "cli_env",
      FEISHU_APP_SECRET: "secret_env",
      FEISHU_VERIFICATION_TOKEN: "verify_env",
      FEISHU_ENCRYPT_KEY: "encrypt_env",
      FEISHU_TENANT_KEY: "tenant_env",
    },
  });

  assert.deepEqual(input, {
    workspaceId: "workspace-1",
    displayName: "Env Feishu",
    transportMode: "http_webhook",
    appId: "cli_env",
    appSecret: "secret_env",
    verificationToken: "verify_env",
    encryptKey: "encrypt_env",
    tenantKey: "tenant_env",
    createdByUserId: "admin-1",
    appUrl: "https://agentspace.example.com",
  });
});

test("Feishu create CLI env-file loads credentials without overriding process env", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "agentspace-feishu-create-env-"));
  try {
    const envPath = join(tempDir, ".env");
    writeFileSync(envPath, [
      "FEISHU_APP_ID=cli_file",
      "export FEISHU_APP_SECRET='secret file value'",
      "FEISHU_VERIFICATION_TOKEN=\"verify file value\"",
      "FEISHU_ENCRYPT_KEY=encrypt_file # trailing comment",
      "FEISHU_TENANT_KEY=tenant_file",
      "",
    ].join("\n"));

    const env = readFeishuCreateCliEnv({
      envFilePath: envPath,
      env: {
        FEISHU_APP_SECRET: "secret_process_override",
      },
    });
    const input = buildFeishuCreateCliInputFromFlags({
      workspaceId: "workspace-1",
      flags: {
        "app-id-env": "FEISHU_APP_ID",
        "app-secret-env": "FEISHU_APP_SECRET",
        "verification-token-env": "FEISHU_VERIFICATION_TOKEN",
        "encrypt-key-env": "FEISHU_ENCRYPT_KEY",
        "tenant-key-env": "FEISHU_TENANT_KEY",
      },
      env,
    });

    assert.equal(input.appId, "cli_file");
    assert.equal(input.appSecret, "secret_process_override");
    assert.equal(input.verificationToken, "verify file value");
    assert.equal(input.encryptKey, "encrypt_file");
    assert.equal(input.tenantKey, "tenant_file");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Feishu health-check CLI persists sanitized scope failures", async () => {
  const updates: Array<{
    integrationId: string;
    lastHealthStatus: string;
    lastError?: string;
    configJson?: unknown;
  }> = [];
  const report = await runFeishuHealthCheckCli({
    workspaceId: "workspace-1",
    integrations: [
      buildIntegrationRecord({
        id: "integration-health",
        displayName: "Health Feishu",
        appId: "cli_health",
        lastHealthStatus: "healthy",
      }),
    ],
    readCredentials: () => ({
      appSecret: "secret_health",
      verificationToken: "verify-health",
    }),
    healthChecker: async () => ({
      status: "degraded",
      checkedAt: "2026-06-24T01:00:00.000Z",
      tenantAccessToken: "tenant-secret-token",
      botAppName: "AgentSpace Bot",
      scopeReadiness: "unauthorized",
      scopeErrorMessage: "permission denied for app_secret=secret_health Bearer tenant-secret-token",
      errorMessage: "Feishu app scope check was rejected by Feishu: permission denied for cli_health app_secret=secret_health Bearer tenant-secret-token",
    }),
    updateHealth: (input) => {
      updates.push(input);
      return buildIntegrationRecord({
        id: input.integrationId,
        lastHealthStatus: input.lastHealthStatus,
        lastError: input.lastError,
      }) as never;
    },
  });

  assert.equal(report.integrationCount, 1);
  assert.equal(report.checkedCount, 1);
  assert.equal(report.healthyCount, 0);
  assert.equal(report.degradedCount, 1);
  assert.equal(report.errorCount, 0);
  assert.equal(report.strictSatisfied, false);
  assert.equal(report.persisted, true);
  assert.equal(report.results[0]?.status, "degraded");
  assert.equal(report.results[0]?.previousHealthStatus, "healthy");
  assert.equal(report.results[0]?.scopeReadiness, "unauthorized");
  assert.equal(report.results[0]?.errorCode, "feishu.integration.scope_unauthorized");
  assert.equal(report.results[0]?.persisted, true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.lastHealthStatus, "degraded");
  assert.deepEqual(updates[0]?.configJson, {
    bot: {
      appName: "AgentSpace Bot",
      lastHealthCheckedAt: "2026-06-24T01:00:00.000Z",
    },
  });
  const serialized = JSON.stringify({ report, updates });
  assert.equal(serialized.includes("tenant-secret-token"), false);
  assert.equal(serialized.includes("secret_health"), false);
  assert.equal(serialized.includes("cli_health"), false);
});

test("Feishu health-check CLI dry-run avoids persistence", async () => {
  let updateCount = 0;
  const report = await runFeishuHealthCheckCli({
    workspaceId: "workspace-1",
    persist: false,
    integrations: [
      buildIntegrationRecord({
        id: "integration-health-dry-run",
        displayName: "Dry Run Feishu",
      }),
    ],
    readCredentials: () => ({
      appSecret: "secret_health",
      verificationToken: "verify-health",
    }),
    healthChecker: async () => ({
      status: "healthy",
      checkedAt: "2026-06-24T01:00:00.000Z",
      botAppName: "AgentSpace Bot",
      scopeReadiness: "verified",
      enabledScopes: FEISHU_TEST_SCOPES,
      missingScopes: [],
    }),
    updateHealth: (input) => {
      updateCount += 1;
      return buildIntegrationRecord({
        id: input.integrationId,
        lastHealthStatus: input.lastHealthStatus,
      }) as never;
    },
  });

  assert.equal(report.persisted, false);
  assert.equal(report.healthyCount, 1);
  assert.equal(report.degradedCount, 0);
  assert.equal(report.errorCount, 0);
  assert.equal(report.strictSatisfied, true);
  assert.equal(report.results[0]?.status, "healthy");
  assert.equal(report.results[0]?.enabledScopeCount, FEISHU_TEST_SCOPES.length);
  assert.equal(report.results[0]?.persisted, false);
  assert.equal(updateCount, 0);
});

test("Feishu health-check CLI can target an agent bot binding", async () => {
  const checkedAppIds: string[] = [];
  const readCredentialIntegrationIds: string[] = [];
  const updates: string[] = [];
  const report = await runFeishuHealthCheckCli({
    workspaceId: "workspace-1",
    agentId: "Codex",
    agentOnly: true,
    integrations: [
      buildIntegrationRecord({
        id: "workspace-feishu",
        displayName: "Workspace Feishu",
        appId: "cli_workspace",
      }),
      buildIntegrationRecord({
        id: "agent-bot-codex",
        displayName: "Codex Feishu Bot",
        agentId: "Codex",
        appId: "cli_codex_bot",
        transportMode: "websocket_worker",
      }),
      buildIntegrationRecord({
        id: "agent-bot-hermes",
        displayName: "Hermes Feishu Bot",
        agentId: "HermesAgent",
        appId: "cli_hermes_bot",
        transportMode: "websocket_worker",
      }),
    ],
    readCredentials: (integration) => {
      readCredentialIntegrationIds.push(integration.id);
      return {
        appSecret: `secret-${integration.id}`,
        verificationToken: "verify-health",
      };
    },
    healthChecker: async ({ appId }) => {
      checkedAppIds.push(appId);
      return {
        status: "healthy",
        checkedAt: "2026-06-24T01:00:00.000Z",
        botAppName: "Codex Bot",
        scopeReadiness: "verified",
        enabledScopes: FEISHU_TEST_SCOPES,
        missingScopes: [],
      };
    },
    updateHealth: (input) => {
      updates.push(input.integrationId);
      return buildIntegrationRecord({
        id: input.integrationId,
        lastHealthStatus: input.lastHealthStatus,
      }) as never;
    },
  });

  assert.equal(report.agentId, "Codex");
  assert.equal(report.agentOnly, true);
  assert.equal(report.integrationCount, 1);
  assert.equal(report.checkedCount, 1);
  assert.equal(report.healthyCount, 1);
  assert.equal(report.strictSatisfied, true);
  assert.deepEqual(readCredentialIntegrationIds, ["agent-bot-codex"]);
  assert.deepEqual(checkedAppIds, ["cli_codex_bot"]);
  assert.deepEqual(updates, ["agent-bot-codex"]);
  assert.equal(report.results[0]?.id, "agent-bot-codex");
  assert.equal(report.results[0]?.agentId, "Codex");
});

test("Feishu health-check CLI degrades when scope verification needs manual review", async () => {
  const updates: Array<{
    integrationId: string;
    lastHealthStatus: string;
    lastError?: string;
    configJson?: unknown;
  }> = [];
  const report = await runFeishuHealthCheckCli({
    workspaceId: "workspace-1",
    integrations: [
      buildIntegrationRecord({
        id: "integration-health-manual-review",
        displayName: "Manual Review Feishu",
        appId: "cli_manual_review",
        lastHealthStatus: "healthy",
      }),
    ],
    readCredentials: () => ({
      appSecret: "secret_manual_review",
      verificationToken: "verify-health",
    }),
    healthChecker: async () => ({
      status: "degraded",
      checkedAt: "2026-06-24T01:00:00.000Z",
      tenantAccessToken: "tenant-manual-review-token",
      botAppName: "AgentSpace Bot",
      scopeReadiness: "manual_review_required",
      scopeErrorMessage: "scope API unavailable for app_secret=secret_manual_review Bearer tenant-manual-review-token",
      errorMessage: "Feishu app scopes could not be verified automatically: scope API unavailable for app_secret=secret_manual_review Bearer tenant-manual-review-token",
    }),
    updateHealth: (input) => {
      updates.push(input);
      return buildIntegrationRecord({
        id: input.integrationId,
        lastHealthStatus: input.lastHealthStatus,
        lastError: input.lastError,
      }) as never;
    },
  });

  assert.equal(report.healthyCount, 0);
  assert.equal(report.degradedCount, 1);
  assert.equal(report.strictSatisfied, false);
  assert.equal(report.results[0]?.status, "degraded");
  assert.equal(report.results[0]?.scopeReadiness, "manual_review_required");
  assert.equal(report.results[0]?.errorCode, "feishu.integration.scope_manual_review_required");
  assert.equal(updates[0]?.lastHealthStatus, "degraded");
  assert.deepEqual(updates[0]?.configJson, {
    bot: {
      appName: "AgentSpace Bot",
      lastHealthCheckedAt: "2026-06-24T01:00:00.000Z",
    },
  });
  const serialized = JSON.stringify({ report, updates });
  assert.equal(serialized.includes("tenant-manual-review-token"), false);
  assert.equal(serialized.includes("secret_manual_review"), false);
  assert.equal(serialized.includes("cli_manual_review"), false);
});

test("Feishu evidence report summarizes AgentSpace-side live smoke proof without external ids", () => {
  const report = buildFeishuEvidenceReport({
    workspaceId: "workspace-1",
    requiredEvidence: "all" as const,
    integrations: [
      buildIntegrationRecord({
        id: "integration-evidence",
        displayName: "Evidence Feishu",
        agentId: "Atlas",
        transportMode: "websocket_worker",
        lastHealthStatus: "degraded",
      }),
      buildIntegrationRecord({
        id: "agent-bot-hermes",
        displayName: "HermesAgent Bot",
        agentId: "HermesAgent",
        appId: "cli_hermes_bot",
        transportMode: "websocket_worker",
        lastHealthStatus: "healthy",
      }),
    ],
    eventsByIntegrationId: {
      "integration-evidence": [
        buildIntegrationEvent("integration-evidence", "evt_processed_secret", "im.message.receive_v1", "processed"),
        buildApprovalCardActionEvent("integration-evidence", "evt_card_secret"),
        buildIntegrationEvent("integration-evidence", "evt_failed_secret", "im.message.receive_v1", "failed"),
      ],
      "agent-bot-hermes": [],
    },
    messageMappingsByIntegrationId: {
      "integration-evidence": [
        buildMessageMapping("integration-evidence", "inbound", "om_secret_inbound"),
        buildMessageMapping("integration-evidence", "outbound", "om_secret_reply", "om_secret_inbound"),
        buildMessageMapping("integration-evidence", "inbound", "om_secret_restart_inbound", undefined, {
          actorType: "external_guest",
          externalGuestPolicyDecision: "allow",
        }),
        buildExternalGuestReplyAllMapping("integration-evidence"),
        buildMessageMapping("integration-evidence", "outbound", "om_secret_restart_reply", "om_secret_restart_inbound"),
        buildAgentChannelPolicyDeniedMapping("integration-evidence"),
        buildBotSenderLoopGuardMapping("integration-evidence"),
        buildThreadContinuationMapping("integration-evidence"),
        ...buildGuestPolicyEvidenceMappings("integration-evidence"),
      ],
      "agent-bot-hermes": [],
    },
    channelBindingsByIntegrationId: {
      "integration-evidence": [
        buildAutoProvisionedChannelBinding("integration-evidence", "first_message"),
        buildAutoProvisionedChannelBinding("integration-evidence", "bot_added", {
          agentId: "HermesAgent",
          linkedFromBindingId: "channel-atlas-binding",
          linkedFromAgentId: "Atlas",
          linkedFromBotBindingId: "integration-evidence-atlas",
        }),
      ],
      "agent-bot-hermes": [
        buildAutoProvisionedChannelBinding("agent-bot-hermes", "bot_added", {
          agentId: "HermesAgent",
          botBindingId: "agent-bot-hermes",
          linkedFromBindingId: "channel-integration-evidence",
          linkedFromAgentId: "Atlas",
          linkedFromBotBindingId: "integration-evidence",
        }),
      ],
    },
    threadBindingsByIntegrationId: {
      "integration-evidence": [
        buildThreadBinding("integration-evidence", {
          taskQueueId: "task-thread-continuation",
          agentSpaceMessageId: "message-thread-continuation-source",
        }),
        buildThreadBinding("integration-evidence", {
          id: "thread-integration-evidence-hermes",
          agentId: "HermesAgent",
          botBindingId: "integration-evidence",
          threadCollaboration: true,
          collaboratingAgentIds: ["Atlas"],
        }),
      ],
      "agent-bot-hermes": [
        buildThreadBinding("agent-bot-hermes", {
          id: "thread-agent-bot-hermes-collaboration",
          agentId: "HermesAgent",
          botBindingId: "agent-bot-hermes",
          threadCollaboration: true,
          collaboratingAgentIds: ["Atlas"],
          collaboratingBotBindingIds: ["integration-evidence"],
        }),
      ],
    },
    outboxByIntegrationId: {
      "integration-evidence": [
        buildOutboxItem("integration-evidence", "sent"),
        buildIdentityBindingNoticeOutboxItem("integration-evidence"),
        buildThreadCollaborationCardOutboxItem("integration-evidence", {
          agentId: "HermesAgent",
          botBindingId: "integration-evidence",
          collaboratingAgentIds: ["Atlas"],
          collaboratingBotBindingIds: ["integration-evidence-atlas"],
        }),
        buildOutboxItem("integration-evidence", "failed"),
      ],
      "agent-bot-hermes": [
        buildThreadCollaborationCardOutboxItem("agent-bot-hermes", {
          agentId: "HermesAgent",
          botBindingId: "agent-bot-hermes",
          collaboratingAgentIds: ["Atlas"],
          collaboratingBotBindingIds: ["integration-evidence"],
        }),
      ],
    },
    dataOperationsByIntegrationId: {
      "integration-evidence": [
        buildDataOperationRun("integration-evidence", "docs.read_document", "doc", "succeeded", {
          actorType: "user",
          actorId: "user-1",
        }),
        buildExternalGuestDocReadRun("integration-evidence"),
        buildAgentRuntimeDocReadRun("integration-evidence"),
        buildDataOperationRun("integration-evidence", "docs.update_document", "doc", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.read_range", "sheet", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.update_range", "sheet", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.query_records", "base_table", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "succeeded"),
        buildExternalGuestWriteDeniedRun("integration-evidence"),
      ],
      "agent-bot-hermes": [],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.openApiEvidence?.present, false);
  assert.equal(report.openApiEvidence?.valid, false);
  assert.deepEqual(report.openApiEvidence?.issues, ["openapi_evidence_missing"]);
  assert.equal(report.botAddedPayloadEvidence?.present, false);
  assert.equal(report.botAddedPayloadEvidence?.valid, false);
  assert.deepEqual(report.botAddedPayloadEvidence?.issues, ["bot_added_payload_evidence_missing"]);
  assert.equal(report.summary.botSatisfiedCount, 1);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 1);
  assert.equal(report.summary.guestPolicySatisfiedCount, 1);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 1);
  assert.equal(report.summary.workerSatisfiedCount, 1);
  assert.equal(report.summary.failureVisibleCount, 1);
  assert.equal(report.summary.workspaceBotSatisfied, true);
  assert.equal(report.summary.workspaceNativeExperienceSatisfied, true);
  assert.equal(report.summary.workspaceGuestPolicySatisfied, true);
  assert.equal(report.summary.workspaceDataPlaneSatisfied, true);
  assert.equal(report.summary.workspaceWorkerSatisfied, true);
  assert.equal(report.summary.workspaceFailureVisible, true);
  assert.equal(report.summary.workspaceAllSatisfied, true);
  assert.equal(report.summary.scopedAllSatisfied, true);
  assert.ok(report.summary.localEvidenceFreshRows > 0);
  assert.equal(report.summary.localEvidenceStaleRows, 0);
  assert.ok(report.summary.workspaceLocalEvidenceFreshRows >= report.summary.localEvidenceFreshRows);
  assert.equal(report.summary.workspaceLocalEvidenceStaleRows, 0);
  assert.equal(report.summary.localEvidenceMaxAgeHours, 24);
  const [item] = report.integrations;
  assert.equal(item?.bot.satisfied, true);
  assert.equal(item?.bot.inboundMessageMappings, 9);
  assert.equal(item?.bot.outboundMessageMappings, 2);
  assert.equal(item?.bot.correlatedReplyMappings, 2);
  assert.equal(item?.nativeExperience.satisfied, true);
  assert.equal(item?.nativeExperience.agentBotRouteEvidence, 2);
  assert.equal(item?.nativeExperience.nativeBotReplyEvidence, 2);
  assert.equal(item?.nativeExperience.boundUserMentionEvidence, 1);
  assert.equal(item?.nativeExperience.externalGuestMentionEvidence, 1);
  assert.equal(item?.nativeExperience.agentChannelPolicyDeniedEvidence, 1);
  assert.equal(item?.nativeExperience.botSenderLoopGuardEvidence, 1);
  assert.equal(item?.nativeExperience.autoProvisionedChannelBindings, 2);
  assert.equal(item?.nativeExperience.botAddedAutoProvisionedChannelBindings, 1);
  assert.equal(item?.nativeExperience.firstMessageAutoProvisionedChannelBindings, 1);
  assert.equal(item?.nativeExperience.reusedProviderChannelBindings, 1);
  assert.equal(item?.nativeExperience.threadTaskBindings, 2);
  assert.equal(item?.nativeExperience.threadContinuationEvidence, 1);
  assert.equal(item?.nativeExperience.threadCollaborationEvidence, 1);
  assert.equal(item?.nativeExperience.threadCollaborationCardEvidence, 1);
  assert.equal(item?.guestPolicy.satisfied, true);
  assert.equal(item?.guestPolicy.externalGuestAllowedEvidence, 1);
  assert.equal(item?.guestPolicy.externalGuestReplyAllEvidence, 1);
  assert.equal(item?.guestPolicy.externalGuestRequireIdentityEvidence, 1);
  assert.equal(item?.guestPolicy.externalGuestIdentityBindingNoticeEvidence, 1);
  assert.equal(item?.guestPolicy.externalGuestIgnoreEvidence, 1);
  assert.equal(item?.guestPolicy.externalGuestMentionRequiredEvidence, 1);
  assert.equal(item?.dataPlane.satisfied, true);
  assert.equal(item?.dataPlane.docReadSucceeded, 2);
  assert.equal(item?.dataPlane.agentDocReadSucceeded, 1);
  assert.equal(item?.dataPlane.docWriteSucceeded, 1);
  assert.equal(item?.dataPlane.docApprovedWritesSucceeded, 1);
  assert.equal(item?.dataPlane.sheetReadSucceeded, 1);
  assert.equal(item?.dataPlane.sheetWriteSucceeded, 1);
  assert.equal(item?.dataPlane.sheetApprovedWritesSucceeded, 1);
  assert.equal(item?.dataPlane.sheetApprovedWriteSyncSucceeded, 1);
  assert.equal(item?.dataPlane.baseMutateSucceeded, 1);
  assert.equal(item?.dataPlane.baseApprovedMutationsSucceeded, 1);
  assert.equal(item?.dataPlane.baseApprovedMutationSyncSucceeded, 1);
  assert.equal(item?.dataPlane.userActorEvidence, 1);
  assert.equal(item?.dataPlane.externalGuestActorEvidence, 2);
  assert.equal(item?.dataPlane.externalGuestReadSucceeded, 1);
  assert.equal(item?.dataPlane.externalGuestWriteDeniedEvidence, 1);
  assert.equal(item?.worker.correlatedReplyMappings, 2);
  assert.equal(item?.worker.requiredCorrelatedReplies, 2);
  assert.equal(item?.worker.restartRecoverySatisfied, true);
  assert.equal(item?.worker.processedApprovalCardActions, 1);
  assert.equal(item?.worker.approvalCardActionSatisfied, true);
  assert.equal(item?.worker.satisfied, true);
  assert.equal(item?.failureVisibility.healthStatus, "degraded");
  assert.equal(item?.failureVisibility.healthFailureVisible, true);
  assert.equal(item?.failureVisibility.providerFailureVisible, true);
  assert.equal(item?.failureVisibility.agentBotFailureEvidence, 2);
  assert.equal(item?.failureVisibility.satisfied, true);
  assert.deepEqual(item?.issues, []);
  assert.deepEqual(item?.remediationSteps, []);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("evt_processed_secret"), false);
  assert.equal(serialized.includes("oc_secret"), false);
  assert.equal(serialized.includes("doccn_secret"), false);
  assert.equal(serialized.includes("ou_secret"), false);
});

test("Feishu evidence report requires two active distinct agent bot bindings for native final evidence", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    openApiEvidence: buildOpenApiEvidenceFixture(),
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.openApiEvidence?.valid, false);
  assert.ok(report.openApiEvidence?.issues.includes("openapi_app_identity_active_integration_missing"));
  assert.equal(report.botAddedPayloadEvidence?.valid, false);
  assert.ok(report.botAddedPayloadEvidence?.issues.includes("bot_added_payload_active_integration_missing"));
  assert.equal(report.summary.workspaceBotSatisfied, true);
  assert.equal(report.summary.workspaceNativeExperienceSatisfied, false);
  assert.equal(report.summary.workspaceAllSatisfied, false);
  assert.equal(report.summary.scopedAllSatisfied, false);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.satisfied, true);
  assert.equal(item?.nativeExperience.reusedProviderChannelBindings, 1);
  assert.equal(item?.nativeExperience.threadCollaborationEvidence, 1);
  assert.equal(JSON.stringify(report).includes("cli_hermes_bot"), false);
  assert.equal(JSON.stringify(report).includes("oc_secret"), false);
});

test("Feishu evidence report rejects complete historical proof from a disabled agent bot binding", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    integrationId: "integration-evidence",
    openApiEvidence: buildOpenApiEvidenceFixture(),
    integrations: [
      buildIntegrationRecord({
        id: "integration-evidence",
        displayName: "Disabled Evidence Feishu",
        transportMode: "websocket_worker",
        lastHealthStatus: "degraded",
        status: "disabled",
      }),
    ],
  });

  assert.equal(report.strictSatisfied, false);
  assert.deepEqual(report.issues, ["selected_integration_not_active"]);
  assert.equal(report.remediationSteps[0]?.stepId, "select_active_agent_bot_binding");
  assert.equal(report.summary.botSatisfiedCount, 0);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  assert.equal(report.summary.guestPolicySatisfiedCount, 0);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  assert.equal(report.summary.workerSatisfiedCount, 0);
  assert.equal(report.summary.failureVisibleCount, 0);
  assert.equal(report.summary.workspaceBotSatisfied, false);
  assert.equal(report.summary.workspaceNativeExperienceSatisfied, false);
  assert.equal(report.summary.workspaceGuestPolicySatisfied, false);
  assert.equal(report.summary.workspaceDataPlaneSatisfied, false);
  assert.equal(report.summary.workspaceWorkerSatisfied, false);
  assert.equal(report.summary.workspaceFailureVisible, false);
  assert.equal(report.summary.workspaceAllSatisfied, false);
  assert.equal(report.summary.scopedAllSatisfied, false);
  assert.equal(report.openApiEvidence?.valid, false);
  assert.equal(report.openApiEvidence?.summary?.appIdentityMatched, false);
  assert.ok(report.openApiEvidence?.issues.includes("openapi_app_identity_active_integration_missing"));
  assert.equal(report.botAddedPayloadEvidence?.valid, false);
  assert.equal(report.botAddedPayloadEvidence?.summary?.appIdentityMatched, false);
  assert.ok(report.botAddedPayloadEvidence?.issues.includes("bot_added_payload_active_integration_missing"));

  const [item] = report.integrations;
  const output = formatFeishuEvidenceCommandText(report);
  assert.equal(item?.status, "disabled");
  assert.equal(item?.bot.processedInboundEvents, 1);
  assert.equal(item?.bot.sentOutboxItems, 1);
  assert.equal(item?.bot.satisfied, false);
  assert.equal(item?.nativeExperience.agentBotRouteEvidence, 2);
  assert.equal(item?.nativeExperience.satisfied, false);
  assert.equal(item?.guestPolicy.externalGuestAllowedEvidence, 1);
  assert.equal(item?.guestPolicy.satisfied, false);
  assert.equal(item?.dataPlane.docReadSucceeded, 2);
  assert.equal(item?.dataPlane.satisfied, false);
  assert.equal(item?.worker.processedApprovalCardActions, 1);
  assert.equal(item?.worker.satisfied, false);
  assert.equal(item?.failureVisibility.agentBotFailureEvidence, 2);
  assert.equal(item?.failureVisibility.satisfied, false);
  assert.ok(item?.issues.includes("integration_not_active"));
  assert.equal(item?.remediationSteps.some((step) => step.stepId === "enable_agent_bot_binding"), true);
  assert.match(output, /selected_integration_not_active/);
  assert.match(output, /select an active Feishu agent bot binding/);
  assert.match(output, /status: disabled/);
  assert.equal(JSON.stringify(report).includes("oc_secret"), false);
});

test("Feishu evidence report flags workspaces with only inactive agent bot bindings", () => {
  const report = buildFeishuEvidenceReport({
    workspaceId: "workspace-1",
    requiredEvidence: "bot" as const,
    integrations: [
      buildIntegrationRecord({
        id: "disabled-bot",
        displayName: "Disabled Bot",
        agentId: "Codex",
        status: "disabled",
      }),
      buildIntegrationRecord({
        id: "archived-bot",
        displayName: "Archived Bot",
        agentId: "HermesAgent",
        status: "archived",
      }),
    ],
    eventsByIntegrationId: {
      "disabled-bot": [],
      "archived-bot": [],
    },
    messageMappingsByIntegrationId: {
      "disabled-bot": [],
      "archived-bot": [],
    },
    channelBindingsByIntegrationId: {
      "disabled-bot": [],
      "archived-bot": [],
    },
    threadBindingsByIntegrationId: {
      "disabled-bot": [],
      "archived-bot": [],
    },
    outboxByIntegrationId: {
      "disabled-bot": [],
      "archived-bot": [],
    },
    dataOperationsByIntegrationId: {
      "disabled-bot": [],
      "archived-bot": [],
    },
  });
  const output = formatFeishuEvidenceCommandText(report);

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.integrationCount, 2);
  assert.deepEqual(report.issues, ["active_integration_missing"]);
  assert.equal(report.remediationSteps[0]?.stepId, "bind_feishu_agent_bot");
  assert.match(output, /active_integration_missing/);
  assert.match(output, /create or select an active Feishu agent bot binding/);
  assert.match(output, /status: disabled/);
  assert.match(output, /status: archived/);
});

test("Feishu evidence report rejects scoped workspace-level integrations as agent bot evidence", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    integrationId: "integration-evidence",
    integrations: [
      buildIntegrationRecord({
        id: "integration-evidence",
        displayName: "Workspace Feishu",
        transportMode: "websocket_worker",
        lastHealthStatus: "degraded",
      }),
    ],
  });
  const output = formatFeishuEvidenceCommandText(report);

  assert.equal(report.strictSatisfied, false);
  assert.deepEqual(report.issues, ["selected_integration_not_agent_bot"]);
  assert.equal(report.remediationSteps[0]?.stepId, "bind_feishu_agent_bot");
  assert.equal(report.summary.botSatisfiedCount, 0);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  assert.equal(report.summary.guestPolicySatisfiedCount, 0);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  assert.equal(report.summary.workerSatisfiedCount, 0);
  assert.equal(report.summary.failureVisibleCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.agentId, undefined);
  assert.equal(item?.bot.processedInboundEvents, 1);
  assert.equal(item?.bot.sentOutboxItems, 1);
  assert.equal(item?.bot.satisfied, false);
  assert.ok(item?.issues.includes("integration_not_agent_bot"));
  assert.equal(item?.remediationSteps.some((step) => step.stepId === "bind_feishu_agent_bot"), true);
  assert.match(output, /selected_integration_not_agent_bot/);
  assert.match(output, /bind a Feishu bot to a concrete AgentSpace agent/);
});

test("Feishu evidence report flags active workspaces with no agent bot bindings", () => {
  const report = buildFeishuEvidenceReport({
    workspaceId: "workspace-1",
    requiredEvidence: "bot" as const,
    integrations: [
      buildIntegrationRecord({
        id: "workspace-feishu",
        displayName: "Workspace Feishu",
        status: "active",
      }),
    ],
    eventsByIntegrationId: {
      "workspace-feishu": [],
    },
    messageMappingsByIntegrationId: {
      "workspace-feishu": [],
    },
    channelBindingsByIntegrationId: {
      "workspace-feishu": [],
    },
    threadBindingsByIntegrationId: {
      "workspace-feishu": [],
    },
    outboxByIntegrationId: {
      "workspace-feishu": [],
    },
    dataOperationsByIntegrationId: {
      "workspace-feishu": [],
    },
  });
  const output = formatFeishuEvidenceCommandText(report);

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.integrationCount, 1);
  assert.deepEqual(report.issues, ["active_agent_bot_integration_missing"]);
  assert.equal(report.remediationSteps[0]?.stepId, "bind_feishu_agent_bot");
  assert.ok(report.integrations[0]?.issues.includes("integration_not_agent_bot"));
  assert.match(output, /active_agent_bot_integration_missing/);
  assert.match(output, /create an active Feishu agent bot binding/);
});

test("Feishu evidence report satisfies final gate from workspace-wide agent bot evidence when scoped", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    integrationId: "integration-evidence",
    requiredEvidence: "all" as const,
    openApiEvidence: buildOpenApiEvidenceFixture(),
    integrations: [
      ...complete.integrations,
      buildIntegrationRecord({
        id: "agent-bot-hermes",
        displayName: "HermesAgent Bot",
        agentId: "HermesAgent",
        appId: "cli_hermes_bot",
        transportMode: "websocket_worker",
        lastHealthStatus: "healthy",
      }),
    ],
    eventsByIntegrationId: {
      ...complete.eventsByIntegrationId,
      "agent-bot-hermes": [],
    },
    messageMappingsByIntegrationId: {
      ...complete.messageMappingsByIntegrationId,
      "agent-bot-hermes": [],
    },
    channelBindingsByIntegrationId: {
      "integration-evidence": [
        buildAutoProvisionedChannelBinding("integration-evidence", "first_message"),
      ],
      "agent-bot-hermes": [
        buildAutoProvisionedChannelBinding("agent-bot-hermes", "bot_added", {
          agentId: "HermesAgent",
          botBindingId: "agent-bot-hermes",
          linkedFromBindingId: "channel-integration-evidence",
          linkedFromAgentId: "Atlas",
          linkedFromBotBindingId: "integration-evidence",
        }),
      ],
    },
    threadBindingsByIntegrationId: {
      "integration-evidence": [
        buildThreadBinding("integration-evidence", {
          taskQueueId: "task-thread-continuation",
          agentSpaceMessageId: "message-thread-continuation-source",
        }),
      ],
      "agent-bot-hermes": [
        buildThreadBinding("agent-bot-hermes", {
          agentId: "HermesAgent",
          botBindingId: "agent-bot-hermes",
          threadCollaboration: true,
          collaboratingAgentIds: ["Atlas"],
          collaboratingBotBindingIds: ["integration-evidence"],
        }),
      ],
    },
    outboxByIntegrationId: {
      ...complete.outboxByIntegrationId,
      "agent-bot-hermes": [
        buildThreadCollaborationCardOutboxItem("agent-bot-hermes", {
          agentId: "HermesAgent",
          botBindingId: "agent-bot-hermes",
          collaboratingAgentIds: ["Atlas"],
          collaboratingBotBindingIds: ["integration-evidence"],
        }),
      ],
    },
    dataOperationsByIntegrationId: {
      ...complete.dataOperationsByIntegrationId,
      "agent-bot-hermes": [],
    },
  });

  assert.equal(report.strictSatisfied, true);
  assert.equal(report.openApiEvidence?.valid, true);
  assert.equal(report.botAddedPayloadEvidence?.valid, true);
  assert.equal(report.integrationCount, 1);
  assert.deepEqual(report.integrations.map((item) => item.id), ["integration-evidence"]);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  assert.equal(report.summary.workspaceNativeExperienceSatisfied, true);
  assert.equal(report.summary.workspaceAllSatisfied, true);
  assert.equal(report.summary.scopedAllSatisfied, true);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.satisfied, false);
  assert.equal(item?.nativeExperience.botAddedAutoProvisionedChannelBindings, 0);
  assert.equal(item?.nativeExperience.reusedProviderChannelBindings, 0);
  assert.equal(item?.nativeExperience.threadCollaborationEvidence, 0);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("cli_hermes_bot"), false);
  assert.equal(serialized.includes("oc_secret"), false);
  assert.equal(serialized.includes("ou_secret"), false);
});

test("Feishu evidence report ignores disabled second bot evidence in workspace native aggregation", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    integrationId: "integration-evidence",
    requiredEvidence: "all" as const,
    openApiEvidence: buildOpenApiEvidenceFixture(),
    integrations: [
      ...complete.integrations,
      buildIntegrationRecord({
        id: "agent-bot-hermes",
        displayName: "Disabled HermesAgent Bot",
        agentId: "HermesAgent",
        appId: "cli_hermes_bot",
        transportMode: "websocket_worker",
        lastHealthStatus: "healthy",
        status: "disabled",
      }),
    ],
    eventsByIntegrationId: {
      ...complete.eventsByIntegrationId,
      "agent-bot-hermes": [],
    },
    messageMappingsByIntegrationId: {
      ...complete.messageMappingsByIntegrationId,
      "agent-bot-hermes": [],
    },
    channelBindingsByIntegrationId: {
      "integration-evidence": [
        buildAutoProvisionedChannelBinding("integration-evidence", "first_message"),
      ],
      "agent-bot-hermes": [
        buildAutoProvisionedChannelBinding("agent-bot-hermes", "bot_added", {
          agentId: "HermesAgent",
          botBindingId: "agent-bot-hermes",
          linkedFromBindingId: "channel-integration-evidence",
          linkedFromAgentId: "Atlas",
          linkedFromBotBindingId: "integration-evidence",
        }),
      ],
    },
    threadBindingsByIntegrationId: {
      "integration-evidence": [
        buildThreadBinding("integration-evidence", {
          taskQueueId: "task-thread-continuation",
          agentSpaceMessageId: "message-thread-continuation-source",
        }),
      ],
      "agent-bot-hermes": [
        buildThreadBinding("agent-bot-hermes", {
          agentId: "HermesAgent",
          botBindingId: "agent-bot-hermes",
          threadCollaboration: true,
          collaboratingAgentIds: ["Atlas"],
          collaboratingBotBindingIds: ["integration-evidence"],
        }),
      ],
    },
    outboxByIntegrationId: {
      ...complete.outboxByIntegrationId,
      "agent-bot-hermes": [
        buildThreadCollaborationCardOutboxItem("agent-bot-hermes", {
          agentId: "HermesAgent",
          botBindingId: "agent-bot-hermes",
          collaboratingAgentIds: ["Atlas"],
          collaboratingBotBindingIds: ["integration-evidence"],
        }),
      ],
    },
    dataOperationsByIntegrationId: {
      ...complete.dataOperationsByIntegrationId,
      "agent-bot-hermes": [],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.openApiEvidence?.valid, false);
  assert.ok(report.openApiEvidence?.issues.includes(
    "openapi_todo120_native_smoke_second_app_local_evidence_missing",
  ));
  assert.equal(report.botAddedPayloadEvidence?.valid, false);
  assert.ok(report.botAddedPayloadEvidence?.issues.includes(
    "bot_added_payload_chat_reference_local_evidence_missing",
  ));
  assert.equal(report.integrationCount, 1);
  assert.deepEqual(report.integrations.map((item) => item.id), ["integration-evidence"]);
  assert.equal(report.summary.workspaceBotSatisfied, true);
  assert.equal(report.summary.workspaceNativeExperienceSatisfied, false);
  assert.equal(report.summary.workspaceGuestPolicySatisfied, true);
  assert.equal(report.summary.workspaceDataPlaneSatisfied, true);
  assert.equal(report.summary.workspaceAllSatisfied, false);
  assert.equal(report.summary.scopedAllSatisfied, false);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.satisfied, false);
  assert.equal(item?.nativeExperience.botAddedAutoProvisionedChannelBindings, 0);
  assert.equal(item?.nativeExperience.reusedProviderChannelBindings, 0);
  assert.equal(item?.nativeExperience.threadCollaborationEvidence, 0);
  assert.equal(JSON.stringify(report).includes("cli_hermes_bot"), false);
});

test("Feishu evidence report does not satisfy native gate by mixing different chat references", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    integrationId: "integration-evidence",
    requiredEvidence: "all",
    integrations: [
      ...complete.integrations,
      buildIntegrationRecord({
        id: "agent-bot-hermes",
        displayName: "HermesAgent Bot",
        agentId: "HermesAgent",
        appId: "cli_hermes_bot",
        transportMode: "websocket_worker",
        lastHealthStatus: "healthy",
      }),
    ],
    eventsByIntegrationId: {
      ...complete.eventsByIntegrationId,
      "agent-bot-hermes": [],
    },
    messageMappingsByIntegrationId: {
      ...complete.messageMappingsByIntegrationId,
      "agent-bot-hermes": [],
    },
    channelBindingsByIntegrationId: {
      "integration-evidence": [
        buildAutoProvisionedChannelBinding("integration-evidence", "first_message"),
      ],
      "agent-bot-hermes": [
        withMetadataFields(buildAutoProvisionedChannelBinding("agent-bot-hermes", "bot_added", {
          agentId: "HermesAgent",
          botBindingId: "agent-bot-hermes",
          linkedFromBindingId: "channel-integration-evidence",
          linkedFromAgentId: "Atlas",
          linkedFromBotBindingId: "integration-evidence",
        }), {
          externalChatReference: FEISHU_OTHER_TEST_CHAT_REFERENCE,
        }),
      ],
    },
    threadBindingsByIntegrationId: {
      "integration-evidence": [
        buildThreadBinding("integration-evidence", {
          taskQueueId: "task-thread-continuation",
          agentSpaceMessageId: "message-thread-continuation-source",
        }),
      ],
      "agent-bot-hermes": [
        withMetadataFields(buildThreadBinding("agent-bot-hermes", {
          agentId: "HermesAgent",
          botBindingId: "agent-bot-hermes",
          threadCollaboration: true,
          collaboratingAgentIds: ["Atlas"],
          collaboratingBotBindingIds: ["integration-evidence"],
        }), {
          externalChatReference: FEISHU_OTHER_TEST_CHAT_REFERENCE,
        }),
      ],
    },
    outboxByIntegrationId: {
      ...complete.outboxByIntegrationId,
      "agent-bot-hermes": [
        buildThreadCollaborationCardOutboxItem("agent-bot-hermes", {
          agentId: "HermesAgent",
          botBindingId: "agent-bot-hermes",
          collaboratingAgentIds: ["Atlas"],
          collaboratingBotBindingIds: ["integration-evidence"],
          externalChatReference: FEISHU_OTHER_TEST_CHAT_REFERENCE,
        }),
      ],
    },
    dataOperationsByIntegrationId: {
      ...complete.dataOperationsByIntegrationId,
      "agent-bot-hermes": [],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.integrationCount, 1);
  assert.deepEqual(report.integrations.map((item) => item.id), ["integration-evidence"]);
  assert.equal(report.summary.workspaceBotSatisfied, true);
  assert.equal(report.summary.workspaceNativeExperienceSatisfied, false);
  assert.equal(report.summary.workspaceAllSatisfied, false);
  assert.equal(report.summary.scopedAllSatisfied, false);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.satisfied, false);
  assert.equal(item?.nativeExperience.reusedProviderChannelBindings, 0);
  assert.equal(item?.nativeExperience.threadCollaborationEvidence, 0);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(FEISHU_OTHER_TEST_CHAT_REFERENCE), false);
  assert.equal(serialized.includes("cli_hermes_bot"), false);
  assert.equal(serialized.includes("oc_secret"), false);
  assert.equal(serialized.includes("ou_secret"), false);
});

test("Feishu evidence report requires scoped integration to participate in native workspace evidence", () => {
  const nativeIntegrationId = "agent-bot-hermes";
  const input = {
    workspaceId: "workspace-1",
    requiredEvidence: "native" as const,
    integrations: [
      buildIntegrationRecord({
        id: "integration-evidence",
        displayName: "Selected Feishu",
      }),
      buildIntegrationRecord({
        id: "agent-bot-atlas",
        displayName: "Atlas Bot",
        agentId: "Atlas",
        appId: "cli_atlas_bot",
        transportMode: "websocket_worker",
        lastHealthStatus: "healthy",
      }),
      buildIntegrationRecord({
        id: nativeIntegrationId,
        displayName: "HermesAgent Bot",
        agentId: "HermesAgent",
        appId: "cli_hermes_bot",
        transportMode: "websocket_worker",
        lastHealthStatus: "healthy",
      }),
    ],
    eventsByIntegrationId: {
      "integration-evidence": [],
      "agent-bot-atlas": [],
      [nativeIntegrationId]: [],
    },
    messageMappingsByIntegrationId: {
      "integration-evidence": [],
      "agent-bot-atlas": [],
      [nativeIntegrationId]: [
        buildMessageMapping(nativeIntegrationId, "inbound", "om_secret_inbound"),
        buildMessageMapping(nativeIntegrationId, "outbound", "om_secret_reply", "om_secret_inbound"),
        buildMessageMapping(nativeIntegrationId, "inbound", "om_secret_external_guest", undefined, {
          actorType: "external_guest",
          externalGuestPolicyDecision: "allow",
        }),
        buildExternalGuestReplyAllMapping(nativeIntegrationId),
        buildAgentChannelPolicyDeniedMapping(nativeIntegrationId),
        buildBotSenderLoopGuardMapping(nativeIntegrationId),
        buildThreadContinuationMapping(nativeIntegrationId),
      ],
    },
    channelBindingsByIntegrationId: {
      "integration-evidence": [],
      "agent-bot-atlas": [
        buildAutoProvisionedChannelBinding("agent-bot-atlas", "first_message", {
          agentId: "Atlas",
          botBindingId: "agent-bot-atlas",
        }),
      ],
      [nativeIntegrationId]: [
        buildAutoProvisionedChannelBinding(nativeIntegrationId, "first_message"),
        buildAutoProvisionedChannelBinding(nativeIntegrationId, "bot_added", {
          agentId: "HermesAgent",
          botBindingId: nativeIntegrationId,
          linkedFromBindingId: "channel-atlas-binding",
          linkedFromAgentId: "Atlas",
          linkedFromBotBindingId: "agent-bot-atlas",
        }),
      ],
    },
    threadBindingsByIntegrationId: {
      "integration-evidence": [],
      "agent-bot-atlas": [],
      [nativeIntegrationId]: [
        buildThreadBinding(nativeIntegrationId, {
          taskQueueId: "task-thread-continuation",
          agentSpaceMessageId: "message-thread-continuation-source",
        }),
        buildThreadBinding(nativeIntegrationId, {
          id: "thread-agent-bot-hermes-collaboration",
          agentId: "HermesAgent",
          botBindingId: nativeIntegrationId,
          threadCollaboration: true,
          collaboratingAgentIds: ["Atlas"],
          collaboratingBotBindingIds: ["agent-bot-atlas"],
        }),
      ],
    },
    outboxByIntegrationId: {
      "integration-evidence": [],
      "agent-bot-atlas": [],
      [nativeIntegrationId]: [
        buildThreadCollaborationCardOutboxItem(nativeIntegrationId, {
          agentId: "HermesAgent",
          botBindingId: nativeIntegrationId,
          collaboratingAgentIds: ["Atlas"],
          collaboratingBotBindingIds: ["agent-bot-atlas"],
        }),
      ],
    },
    dataOperationsByIntegrationId: {
      "integration-evidence": [],
      "agent-bot-atlas": [],
      [nativeIntegrationId]: [],
    },
  };

  const scopedReport = buildFeishuEvidenceReport({
    ...input,
    integrationId: "integration-evidence",
  });
  const workspaceReport = buildFeishuEvidenceReport(input);

  assert.equal(scopedReport.strictSatisfied, false);
  assert.equal(scopedReport.integrationCount, 1);
  assert.deepEqual(scopedReport.integrations.map((item) => item.id), ["integration-evidence"]);
  assert.equal(scopedReport.summary.workspaceNativeExperienceSatisfied, false);
  assert.equal(scopedReport.summary.scopedAllSatisfied, false);
  assert.equal(workspaceReport.strictSatisfied, true);
  assert.equal(workspaceReport.integrationCount, 3);
  assert.equal(workspaceReport.summary.workspaceNativeExperienceSatisfied, true);
  assert.equal(workspaceReport.summary.scopedAllSatisfied, false);

  const serialized = JSON.stringify(scopedReport);
  assert.equal(serialized.includes("cli_hermes_bot"), false);
  assert.equal(serialized.includes("oc_secret"), false);
  assert.equal(serialized.includes("ou_secret"), false);
});

test("Feishu evidence report requires one anchor integration to satisfy non-native all gates", () => {
  const complete = withSecondActiveFeishuAgentBotEvidence(buildCompleteFeishuEvidenceInput());
  const input = {
    ...complete,
    requiredEvidence: "all" as const,
    integrations: [
      ...complete.integrations,
      buildIntegrationRecord({
        id: "integration-data-plane",
        displayName: "Data Plane Feishu",
        lastHealthStatus: "healthy",
      }),
    ],
    eventsByIntegrationId: {
      ...complete.eventsByIntegrationId,
      "integration-data-plane": [],
    },
    messageMappingsByIntegrationId: {
      ...complete.messageMappingsByIntegrationId,
      "integration-data-plane": [],
    },
    channelBindingsByIntegrationId: {
      ...complete.channelBindingsByIntegrationId,
      "integration-data-plane": [],
    },
    threadBindingsByIntegrationId: {
      ...complete.threadBindingsByIntegrationId,
      "integration-data-plane": [],
    },
    outboxByIntegrationId: {
      ...complete.outboxByIntegrationId,
      "integration-data-plane": [],
    },
    dataOperationsByIntegrationId: {
      "integration-evidence": [],
      "integration-data-plane": complete.dataOperationsByIntegrationId["integration-evidence"],
    },
  };
  const report = buildFeishuEvidenceReport({
    ...input,
    integrationId: "integration-evidence",
  });
  const workspaceReport = buildFeishuEvidenceReport(input);

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.integrationCount, 1);
  assert.deepEqual(report.integrations.map((item) => item.id), ["integration-evidence"]);
  assert.equal(report.summary.workspaceNativeExperienceSatisfied, true);
  assert.equal(report.summary.workspaceDataPlaneSatisfied, true);
  assert.equal(report.summary.workspaceAllSatisfied, false);
  assert.equal(report.summary.scopedAllSatisfied, false);
  assert.equal(workspaceReport.strictSatisfied, false);
  assert.equal(workspaceReport.integrationCount, 3);
  assert.equal(workspaceReport.summary.workspaceNativeExperienceSatisfied, true);
  assert.equal(workspaceReport.summary.workspaceDataPlaneSatisfied, true);
  assert.equal(workspaceReport.summary.workspaceAllSatisfied, false);
  assert.equal(workspaceReport.summary.scopedAllSatisfied, false);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.satisfied, true);
  assert.equal(item?.dataPlane.satisfied, false);
  assert.ok(item?.issues.includes("doc_read_evidence_missing"));

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("doccn_secret"), false);
  assert.equal(serialized.includes("shtcn_secret"), false);
  assert.equal(serialized.includes("tbl_secret"), false);
});

test("Feishu evidence text output summarizes final gate failures and remediation", () => {
  const report = buildFeishuEvidenceReport({
    workspaceId: "workspace-1",
    requiredEvidence: "all" as const,
    integrations: [],
  });
  const output = formatFeishuEvidenceCommandText(report);

  assert.deepEqual(report.issues, ["integration_missing"]);
  assert.equal(report.remediationSteps[0]?.stepId, "bind_feishu_agent_bot");
  assert.match(report.remediationSteps[0]?.command ?? "", /bind-agent-bot --workspace-id workspace-1/);
  assert.match(output, /AgentSpace Feishu evidence/);
  assert.match(output, /Workspace: workspace-1/);
  assert.match(output, /Required evidence: all/);
  assert.match(output, /Strict evidence satisfied: no/);
  assert.match(output, /Workspace gates:/);
  assert.match(output, /bot reply: no \(0\)/);
  assert.match(output, /Artifact evidence:/);
  assert.match(output, /OpenAPI strict live: present=no, valid=no/);
  assert.match(output, /openapi_evidence_missing/);
  assert.match(output, /Bot-added payload: present=no, valid=no/);
  assert.match(output, /bot_added_payload_evidence_missing/);
  assert.match(output, /Report issues:/);
  assert.match(output, /integration_missing/);
  assert.match(output, /Integration evidence:/);
  assert.match(output, /no Feishu agent bot integrations found/);
  assert.match(output, /Remediation:/);
  assert.match(output, /create an active Feishu agent bot binding/);
  assert.match(output, /smoke-plan --workspace-id workspace-1/);
  assert.match(output, /bind-agent-bot --workspace-id workspace-1/);
  assert.match(output, /run isolated Feishu callback and OpenAPI harness/);
  assert.match(output, /--strict-live --evidence runtime-output\/feishu-smoke\/live\.json --json --require-todo120-native/);
  assert.match(output, /verify captured Feishu bot-added callback payload/);
  assert.match(output, /--verify-bot-added-payload runtime-output\/feishu-smoke\/bot-added-callback\.json/);
  assert.match(output, /Use --json for full counters/);
  assert.doesNotMatch(output, /\[object Object\]/);
  assert.doesNotMatch(output, /FEISHU_APP_SECRET=/);
});

test("Feishu evidence report explains selected integration ids when no bindings exist", () => {
  const report = buildFeishuEvidenceReport({
    workspaceId: "workspace-1",
    integrationId: "missing-integration",
    requiredEvidence: "bot" as const,
    integrations: [],
  });
  const output = formatFeishuEvidenceCommandText(report);

  assert.equal(report.integrationId, "missing-integration");
  assert.deepEqual(report.issues, ["integration_missing"]);
  assert.match(output, /Selected integration: missing-integration/);
  assert.match(output, /no Feishu agent bot integrations found in this workspace/);
  assert.match(output, /--integration missing-integration cannot be evaluated/);
  assert.match(output, /bind-agent-bot --workspace-id workspace-1/);
});

test("Feishu evidence report explains missing scoped integration ids", () => {
  const report = buildFeishuEvidenceReport({
    workspaceId: "workspace-1",
    integrationId: "missing-integration",
    requiredEvidence: "bot" as const,
    integrations: [
      buildIntegrationRecord({
        id: "agent-bot-codex",
        displayName: "Codex Bot",
        agentId: "Codex",
      }),
    ],
    eventsByIntegrationId: {
      "agent-bot-codex": [],
    },
    messageMappingsByIntegrationId: {
      "agent-bot-codex": [],
    },
    channelBindingsByIntegrationId: {
      "agent-bot-codex": [],
    },
    threadBindingsByIntegrationId: {
      "agent-bot-codex": [],
    },
    outboxByIntegrationId: {
      "agent-bot-codex": [],
    },
    dataOperationsByIntegrationId: {
      "agent-bot-codex": [],
    },
  });
  const output = formatFeishuEvidenceCommandText(report);

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.integrationId, "missing-integration");
  assert.equal(report.integrationCount, 0);
  assert.deepEqual(report.issues, ["selected_integration_missing"]);
  assert.equal(report.remediationSteps[0]?.stepId, "select_active_agent_bot_binding");
  assert.match(output, /Selected integration: missing-integration/);
  assert.match(output, /selected_integration_missing/);
  assert.match(output, /none matched --integration missing-integration/);
  assert.match(output, /select an existing Feishu agent bot binding/);
  assert.match(output, /smoke-plan --workspace-id workspace-1/);
  assert.doesNotMatch(output, /cli_codex_bot/);
});

test("Feishu evidence report requires degraded health for failure visibility smoke", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    integrations: [
      buildIntegrationRecord({
        id: "integration-evidence",
        displayName: "Evidence Feishu",
        agentId: "Atlas",
        transportMode: "websocket_worker",
        lastHealthStatus: "healthy",
      }),
    ],
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.botSatisfiedCount, 1);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 1);
  assert.equal(report.summary.workerSatisfiedCount, 1);
  assert.equal(report.summary.failureVisibleCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.failureVisibility.healthStatus, "healthy");
  assert.equal(item?.failureVisibility.healthFailureVisible, false);
  assert.equal(item?.failureVisibility.providerFailureVisible, true);
  assert.equal(item?.failureVisibility.agentBotFailureEvidence, 2);
  assert.equal(item?.failureVisibility.satisfied, false);
  assert.ok(item?.issues.includes("health_failure_evidence_missing"));
  assert.ok(item?.issues.includes("failure_visibility_evidence_missing"));
});

test("Feishu evidence report requires agent bot provenance for failure visibility smoke", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "failure",
    outboxByIntegrationId: {
      "integration-evidence": [
        buildOutboxItem("integration-evidence", "sent"),
        buildOutboxItem("integration-evidence", "failed", {
          metadataJson: "{}",
        }),
      ],
    },
    dataOperationsByIntegrationId: {
      "integration-evidence": [],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.failureVisibleCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.failureVisibility.healthFailureVisible, true);
  assert.equal(item?.failureVisibility.providerFailureVisible, true);
  assert.equal(item?.failureVisibility.agentBotFailureEvidence, 0);
  assert.equal(item?.failureVisibility.satisfied, false);
  assert.ok(item?.issues.includes("agent_bot_failure_evidence_missing"));
  assert.ok(item?.issues.includes("failure_visibility_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("oc_secret"), false);
});

test("Feishu evidence report requires safe context for failed agent bot outbox proof", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "failure",
    outboxByIntegrationId: {
      "integration-evidence": [
        buildOutboxItem("integration-evidence", "failed", {
          metadataJson: JSON.stringify({
            provider: "feishu",
            agentId: "Atlas",
            botBindingId: "integration-evidence",
          }),
        }),
      ],
    },
    dataOperationsByIntegrationId: {
      "integration-evidence": [],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.failureVisibleCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.failureVisibility.healthFailureVisible, true);
  assert.equal(item?.failureVisibility.providerFailureVisible, true);
  assert.equal(item?.failureVisibility.agentBotFailureEvidence, 0);
  assert.equal(item?.failureVisibility.satisfied, false);
  assert.ok(item?.issues.includes("agent_bot_failure_evidence_missing"));
  assert.ok(item?.issues.includes("failure_visibility_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("oc_secret"), false);
});

test("Feishu evidence report requires failed outbox proof to match the agent bot and use redacted targets", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "failure",
    outboxByIntegrationId: {
      "integration-evidence": [
        buildOutboxItem("integration-evidence", "failed", {
          metadataJson: JSON.stringify({
            provider: "feishu",
            outboxSource: "agent_reply",
            agentId: "Atlas",
            botBindingId: "other-bot-binding",
            externalChatReference: "chat-ref-hash",
          }),
        }),
        buildOutboxItem("integration-evidence", "failed", {
          metadataJson: JSON.stringify({
            provider: "feishu",
            outboxSource: "agent_reply",
            agentId: "Atlas",
            botBindingId: "integration-evidence",
            externalChatReference: "chat-ref-hash",
            external_chat_id: "oc_secret_failed",
            target_external_thread_id: "om_secret_failed",
          }),
        }),
        {
          ...(buildOutboxItem("integration-evidence", "failed") as Record<string, unknown>),
          lastError: "provider failed for oc_secret_failed",
        } as never,
      ],
    },
    dataOperationsByIntegrationId: {
      "integration-evidence": [],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.failureVisibleCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.failureVisibility.agentBotFailureEvidence, 0);
  assert.ok(item?.issues.includes("agent_bot_failure_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("oc_secret_failed"), false);
  assert.equal(JSON.stringify(report).includes("om_secret_failed"), false);
});

test("Feishu evidence report requires failed outbox proof to avoid embedded raw ids", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "failure",
    outboxByIntegrationId: {
      "integration-evidence": [
        withMetadataFields(buildOutboxItem("integration-evidence", "failed"), {
          debugPayload: "failed target chat oc_secret_failed_debug",
          debugResource: "doccn_secret_failed_resource",
        }),
      ],
    },
    dataOperationsByIntegrationId: {
      "integration-evidence": [],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.failureVisibleCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.failureVisibility.healthFailureVisible, true);
  assert.equal(item?.failureVisibility.providerFailureVisible, true);
  assert.equal(item?.failureVisibility.agentBotFailureEvidence, 0);
  assert.equal(item?.failureVisibility.satisfied, false);
  assert.ok(item?.issues.includes("agent_bot_failure_evidence_missing"));
  assert.ok(item?.issues.includes("failure_visibility_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("oc_secret_failed_debug"), false);
  assert.equal(JSON.stringify(report).includes("doccn_secret_failed_resource"), false);
});

test("Feishu evidence report requires failed data operation proof to match the agent bot and use safe resource context", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "failure",
    outboxByIntegrationId: {
      "integration-evidence": [],
    },
    dataOperationsByIntegrationId: {
      "integration-evidence": [
        buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "failed", undefined, {
          governanceBotBindingId: "other-bot-binding",
        }),
        withGovernanceContextFields(
          buildDataOperationRun("integration-evidence", "sheets.update_range", "sheet", "failed"),
          {
            providerResourceToken: "shtcn_secret_failed",
            external_chat_id: "oc_secret_failed",
          },
        ),
        buildDataOperationRun("integration-evidence", "docs.update_document", "doc", "failed", undefined, {
          governanceResourceReference: null,
        }),
        buildDataOperationRun("integration-evidence", "docs.create_document", "doc", "failed", undefined, {
          governanceResourceIdRedacted: false,
        }),
        withResultJsonFields(
          buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "failed", undefined, {
            errorMessage: "provider failed with redacted resource reference",
          }),
          {
            doc_token: "doccn_secret_failed_result",
            table_id: "tbl_secret_failed_result",
          },
        ),
        buildDataOperationRun("integration-evidence", "docs.update_document", "doc", "failed", undefined, {
          errorMessage: "provider failed for doccnSecretFailure123",
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.failureVisibleCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.failureVisibility.providerFailureVisible, true);
  assert.equal(item?.failureVisibility.agentBotFailureEvidence, 0);
  assert.ok(item?.issues.includes("agent_bot_failure_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("shtcn_secret_failed"), false);
  assert.equal(JSON.stringify(report).includes("oc_secret_failed"), false);
  assert.equal(JSON.stringify(report).includes("doccn_secret_failed_result"), false);
  assert.equal(JSON.stringify(report).includes("tbl_secret_failed_result"), false);
  assert.equal(JSON.stringify(report).includes("doccnSecretFailure123"), false);
});

test("Feishu worker evidence requires a second correlated reply for restart recovery", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    messageMappingsByIntegrationId: {
      "integration-evidence": [
        buildMessageMapping("integration-evidence", "inbound", "om_secret_inbound"),
        buildMessageMapping("integration-evidence", "outbound", "om_secret_reply", "om_secret_inbound"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.botSatisfiedCount, 1);
  assert.equal(report.summary.workerSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.bot.satisfied, true);
  assert.equal(item?.worker.correlatedReplyMappings, 1);
  assert.equal(item?.worker.requiredCorrelatedReplies, 2);
  assert.equal(item?.worker.restartRecoverySatisfied, false);
  assert.equal(item?.worker.satisfied, false);
  assert.ok(item?.issues.includes("websocket_worker_restart_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("om_secret"), false);
});

test("Feishu worker evidence requires a processed approval card action", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    eventsByIntegrationId: {
      "integration-evidence": [
        buildIntegrationEvent("integration-evidence", "evt_processed_secret", "im.message.receive_v1", "processed"),
        buildIntegrationEvent("integration-evidence", "evt_failed_secret", "im.message.receive_v1", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.botSatisfiedCount, 1);
  assert.equal(report.summary.workerSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.bot.satisfied, true);
  assert.equal(item?.worker.restartRecoverySatisfied, true);
  assert.equal(item?.worker.processedApprovalCardActions, 0);
  assert.equal(item?.worker.approvalCardActionSatisfied, false);
  assert.equal(item?.worker.satisfied, false);
  assert.ok(item?.issues.includes("websocket_worker_card_action_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("evt_card_secret"), false);
});

test("Feishu worker evidence rejects non-governed processed card actions", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    eventsByIntegrationId: {
      "integration-evidence": [
        buildIntegrationEvent("integration-evidence", "evt_processed_secret", "im.message.receive_v1", "processed"),
        buildIntegrationEvent("integration-evidence", "evt_card_secret", "card.action.trigger", "processed", {
          provider: "feishu",
          eventType: "card.action.trigger",
          rawPayloadStored: false,
          approvalCardAction: {
            provider: "feishu",
            kind: "status_card_refresh",
            resourceId: "status-card-1",
            tokenStored: false,
            rawActionPayloadStored: false,
          },
        }),
        buildIntegrationEvent("integration-evidence", "evt_failed_secret", "im.message.receive_v1", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.workerSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.worker.restartRecoverySatisfied, true);
  assert.equal(item?.worker.processedApprovalCardActions, 0);
  assert.equal(item?.worker.approvalCardActionSatisfied, false);
  assert.equal(item?.worker.satisfied, false);
  assert.ok(item?.issues.includes("websocket_worker_card_action_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("status-card-1"), false);
});

test("Feishu worker evidence requires approval card action payload hashes to be digests", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    eventsByIntegrationId: {
      "integration-evidence": [
        buildIntegrationEvent("integration-evidence", "evt_processed_secret", "im.message.receive_v1", "processed"),
        buildApprovalCardActionEvent("integration-evidence", "evt_card_secret", "processed", {
          payloadHash: "secret approval payload",
        }),
        buildIntegrationEvent("integration-evidence", "evt_failed_secret", "im.message.receive_v1", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.workerSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.worker.restartRecoverySatisfied, true);
  assert.equal(item?.worker.processedApprovalCardActions, 0);
  assert.equal(item?.worker.approvalCardActionSatisfied, false);
  assert.equal(item?.worker.satisfied, false);
  assert.ok(item?.issues.includes("websocket_worker_card_action_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("secret approval payload"), false);
});

test("Feishu worker evidence rejects approval card actions with raw token or action payload", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    eventsByIntegrationId: {
      "integration-evidence": [
        buildIntegrationEvent("integration-evidence", "evt_processed_secret", "im.message.receive_v1", "processed"),
        buildApprovalCardActionEvent("integration-evidence", "evt_card_secret", "processed", {
          token: "token_secret",
          raw_action_payload: { value: "action_secret" },
          open_id: "ou_secret_card_actor",
        }),
        buildIntegrationEvent("integration-evidence", "evt_failed_secret", "im.message.receive_v1", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.workerSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.worker.processedApprovalCardActions, 0);
  assert.equal(item?.worker.approvalCardActionSatisfied, false);
  assert.ok(item?.issues.includes("websocket_worker_card_action_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("token_secret"), false);
  assert.equal(JSON.stringify(report).includes("action_secret"), false);
  assert.equal(JSON.stringify(report).includes("ou_secret_card_actor"), false);
});

test("Feishu worker evidence rejects approval card actions with raw resource ids", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    eventsByIntegrationId: {
      "integration-evidence": [
        buildIntegrationEvent("integration-evidence", "evt_processed_secret", "im.message.receive_v1", "processed"),
        buildApprovalCardActionEvent("integration-evidence", "evt_card_secret", "processed", {
          doc_token: "doccn_secret_card_resource",
          appToken: "bascn_secret_card_resource",
          table_id: "tbl_secret_card_resource",
        }),
        buildIntegrationEvent("integration-evidence", "evt_failed_secret", "im.message.receive_v1", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.workerSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.worker.processedApprovalCardActions, 0);
  assert.equal(item?.worker.approvalCardActionSatisfied, false);
  assert.ok(item?.issues.includes("websocket_worker_card_action_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("doccn_secret_card_resource"), false);
  assert.equal(JSON.stringify(report).includes("bascn_secret_card_resource"), false);
  assert.equal(JSON.stringify(report).includes("tbl_secret_card_resource"), false);
});

test("Feishu worker evidence rejects approval card payloads with embedded raw ids", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    eventsByIntegrationId: {
      "integration-evidence": [
        buildIntegrationEvent("integration-evidence", "evt_processed_secret", "im.message.receive_v1", "processed"),
        buildApprovalCardActionEvent("integration-evidence", "evt_card_secret", "processed", {}, {
          debugPayload: "card action actor ou_secret_card_debug",
          debugResource: "doccn_secret_card_payload_resource",
        }),
        buildIntegrationEvent("integration-evidence", "evt_failed_secret", "im.message.receive_v1", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.workerSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.worker.processedApprovalCardActions, 0);
  assert.equal(item?.worker.approvalCardActionSatisfied, false);
  assert.ok(item?.issues.includes("websocket_worker_card_action_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("ou_secret_card_debug"), false);
  assert.equal(JSON.stringify(report).includes("doccn_secret_card_payload_resource"), false);
});

test("Feishu evidence report requires reply mappings correlated to inbound messages", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    messageMappingsByIntegrationId: {
      "integration-evidence": [
        buildMessageMapping("integration-evidence", "inbound", "om_secret_inbound"),
        buildMessageMapping("integration-evidence", "outbound", "om_secret_unrelated_reply", "om_secret_other"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.botSatisfiedCount, 0);
  assert.equal(report.summary.workerSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.bot.processedInboundEvents, 1);
  assert.equal(item?.bot.sentOutboxItems, 1);
  assert.equal(item?.bot.inboundMessageMappings, 1);
  assert.equal(item?.bot.outboundMessageMappings, 1);
  assert.equal(item?.bot.correlatedReplyMappings, 0);
  assert.ok(item?.issues.includes("correlated_reply_mapping_missing"));
  assert.equal(JSON.stringify(report).includes("om_secret"), false);
});

test("Feishu evidence report requires sent agent bot reply outbox safe context", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "bot",
    outboxByIntegrationId: {
      "integration-evidence": [
        buildIdentityBindingNoticeOutboxItem("integration-evidence"),
        buildOutboxItem("integration-evidence", "sent", {
          metadataJson: JSON.stringify({
            provider: "feishu",
            outboxSource: "agent_reply",
            externalChatReference: "chat-ref-hash",
            externalThreadId: "om_secret_inbound",
            agentId: "Codex",
            botBindingId: "integration-evidence",
          }),
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.botSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.bot.processedInboundEvents, 1);
  assert.equal(item?.bot.sentOutboxItems, 0);
  assert.equal(item?.bot.inboundMessageMappings, 9);
  assert.equal(item?.bot.outboundMessageMappings, 2);
  assert.equal(item?.bot.correlatedReplyMappings, 2);
  assert.equal(item?.bot.satisfied, false);
  assert.ok(item?.issues.includes("sent_outbox_missing"));
  assert.equal(JSON.stringify(report).includes("om_secret"), false);
});

test("Feishu evidence report requires sent agent bot reply outbox to avoid raw Feishu ids", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "bot",
    outboxByIntegrationId: {
      "integration-evidence": [
        buildIdentityBindingNoticeOutboxItem("integration-evidence"),
        withMetadataFields(buildOutboxItem("integration-evidence", "sent"), {
          external_thread_id: "om_secret_sent_reply_raw",
          providerOpenId: "ou_secret_sent_reply_raw",
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.botSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.bot.sentOutboxItems, 0);
  assert.equal(item?.bot.satisfied, false);
  assert.ok(item?.issues.includes("sent_outbox_missing"));
  assert.equal(JSON.stringify(report).includes("om_secret_sent_reply_raw"), false);
  assert.equal(JSON.stringify(report).includes("ou_secret_sent_reply_raw"), false);
});

test("Feishu evidence report requires sent agent bot reply outbox to avoid raw resource ids", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "bot",
    outboxByIntegrationId: {
      "integration-evidence": [
        buildIdentityBindingNoticeOutboxItem("integration-evidence"),
        withMetadataFields(buildOutboxItem("integration-evidence", "sent"), {
          doc_token: "doccn_secret_sent_reply_resource",
          table_id: "tbl_secret_sent_reply_resource",
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.botSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.bot.sentOutboxItems, 0);
  assert.equal(item?.bot.satisfied, false);
  assert.ok(item?.issues.includes("sent_outbox_missing"));
  assert.equal(JSON.stringify(report).includes("doccn_secret_sent_reply_resource"), false);
  assert.equal(JSON.stringify(report).includes("tbl_secret_sent_reply_resource"), false);
});

test("Feishu evidence report requires correlated replies from the same agent bot", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "bot",
    messageMappingsByIntegrationId: {
      "integration-evidence": [
        buildMessageMapping("integration-evidence", "inbound", "om_secret_inbound"),
        withBotBindingId(
          buildMessageMapping("integration-evidence", "outbound", "om_secret_reply", "om_secret_inbound"),
          "integration-evidence-other-bot",
        ),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.botSatisfiedCount, 0);
  assert.equal(report.summary.workerSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.bot.correlatedReplyMappings, 0);
  assert.equal(item?.nativeExperience.nativeBotReplyEvidence, 0);
  assert.ok(item?.issues.includes("correlated_reply_mapping_missing"));
  assert.ok(item?.issues.includes("native_agent_bot_reply_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("integration-evidence-other-bot"), false);
});

test("Feishu evidence report requires correlated bot replies to avoid raw Feishu ids", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "bot",
    messageMappingsByIntegrationId: {
      "integration-evidence": [
        withMetadataFields(buildMessageMapping("integration-evidence", "inbound", "om_secret_inbound"), {
          chat_id: "oc_secret_reply_inbound_raw",
          open_id: "ou_secret_reply_inbound_raw",
        }),
        withMetadataFields(
          buildMessageMapping("integration-evidence", "outbound", "om_secret_reply", "om_secret_inbound"),
          {
            target_external_thread_id: "om_secret_reply_outbound_raw",
            provider_open_id: "ou_secret_reply_outbound_raw",
          },
        ),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.botSatisfiedCount, 0);
  assert.equal(report.summary.workerSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.bot.correlatedReplyMappings, 0);
  assert.equal(item?.nativeExperience.nativeBotReplyEvidence, 0);
  assert.ok(item?.issues.includes("correlated_reply_mapping_missing"));
  assert.ok(item?.issues.includes("native_agent_bot_reply_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("oc_secret_reply_inbound_raw"), false);
  assert.equal(JSON.stringify(report).includes("ou_secret_reply_inbound_raw"), false);
  assert.equal(JSON.stringify(report).includes("om_secret_reply_outbound_raw"), false);
  assert.equal(JSON.stringify(report).includes("ou_secret_reply_outbound_raw"), false);
});

test("Feishu evidence report requires native bot reply actions to avoid raw resource ids", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "native",
    messageMappingsByIntegrationId: {
      "integration-evidence": [
        buildMessageMapping("integration-evidence", "inbound", "om_secret_inbound"),
        withMetadataFields(
          buildMessageMapping("integration-evidence", "outbound", "om_secret_reply", "om_secret_inbound"),
          {
            agentActionPolicyInput: {
              action: {
                type: "external_message.send",
                resourceReference: "chat-ref-hash",
                resourceIdRedacted: true,
                doc_token: "doccn_secret_reply_resource",
                table_id: "tbl_secret_reply_resource",
              },
            },
          },
        ),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.nativeBotReplyEvidence, 0);
  assert.ok(item?.issues.includes("native_agent_bot_reply_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("doccn_secret_reply_resource"), false);
  assert.equal(JSON.stringify(report).includes("tbl_secret_reply_resource"), false);
});

test("Feishu evidence report requires processed inbound events to use safe summaries", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "bot",
    eventsByIntegrationId: {
      "integration-evidence": [
        buildIntegrationEvent("integration-evidence", "evt_processed_secret", "im.message.receive_v1", "processed", {
          provider: "feishu",
          rawPayloadStored: true,
          payloadHash: "payload-hash",
          message: {
            messageId: "om_secret_raw",
            chatId: "oc_secret_raw",
          },
          sender: {
            openId: "ou_secret_raw",
            unionId: "on_secret_raw",
          },
        }),
        buildApprovalCardActionEvent("integration-evidence", "evt_card_secret"),
        buildIntegrationEvent("integration-evidence", "evt_failed_secret", "im.message.receive_v1", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.botSatisfiedCount, 0);
  assert.equal(report.summary.workerSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.bot.processedInboundEvents, 0);
  assert.equal(item?.bot.correlatedReplyMappings, 2);
  assert.equal(item?.bot.satisfied, false);
  assert.ok(item?.issues.includes("processed_inbound_event_missing"));
  assert.ok(item?.issues.includes("websocket_worker_receive_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("om_secret_raw"), false);
  assert.equal(JSON.stringify(report).includes("oc_secret_raw"), false);
  assert.equal(JSON.stringify(report).includes("ou_secret_raw"), false);
});

test("Feishu evidence report rejects processed inbound summaries with snake_case raw ids", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "bot",
    eventsByIntegrationId: {
      "integration-evidence": [
        buildIntegrationEvent("integration-evidence", "evt_processed_secret", "im.message.receive_v1", "processed", {
          ...buildSafeInboundEventPayload(),
          message: {
            messageReference: "message-ref-safe",
            messageIdRedacted: true,
            message_id: "om_secret_snake",
            chatReference: "chat-ref-safe",
            chatIdRedacted: true,
            chat_id: "oc_secret_snake",
            thread_id: "om_secret_thread_snake",
          },
          sender: {
            openIdReference: "user-ref-safe",
            openIdRedacted: true,
            open_id: "ou_secret_snake",
            union_id: "on_secret_snake",
            user_id: "user_secret_snake",
          },
        }),
        buildApprovalCardActionEvent("integration-evidence", "evt_card_secret"),
        buildIntegrationEvent("integration-evidence", "evt_failed_secret", "im.message.receive_v1", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.botSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.bot.processedInboundEvents, 0);
  assert.ok(item?.issues.includes("processed_inbound_event_missing"));
  assert.equal(JSON.stringify(report).includes("om_secret_snake"), false);
  assert.equal(JSON.stringify(report).includes("oc_secret_snake"), false);
  assert.equal(JSON.stringify(report).includes("ou_secret_snake"), false);
});

test("Feishu evidence report rejects processed inbound summaries with embedded raw ids", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "bot",
    eventsByIntegrationId: {
      "integration-evidence": [
        buildIntegrationEvent("integration-evidence", "evt_processed_secret", "im.message.receive_v1", "processed", {
          ...buildSafeInboundEventPayload(),
          debugPayload: "source chat oc_secret_inbound_debug",
          debugResource: "doccn_secret_inbound_resource",
        }),
        buildApprovalCardActionEvent("integration-evidence", "evt_card_secret"),
        buildIntegrationEvent("integration-evidence", "evt_failed_secret", "im.message.receive_v1", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.botSatisfiedCount, 0);
  assert.equal(report.summary.workerSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.bot.processedInboundEvents, 0);
  assert.equal(item?.bot.satisfied, false);
  assert.ok(item?.issues.includes("processed_inbound_event_missing"));
  assert.ok(item?.issues.includes("websocket_worker_receive_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("oc_secret_inbound_debug"), false);
  assert.equal(JSON.stringify(report).includes("doccn_secret_inbound_resource"), false);
});

test("Feishu evidence report requires processed inbound summaries to carry safe thread references", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "bot",
    eventsByIntegrationId: {
      "integration-evidence": [
        buildIntegrationEvent("integration-evidence", "evt_processed_secret", "im.message.receive_v1", "processed", {
          ...buildSafeInboundEventPayload(),
          message: {
            messageReference: "message-ref-safe",
            messageIdRedacted: true,
            chatReference: "chat-ref-safe",
            chatIdRedacted: true,
          },
        }),
        buildApprovalCardActionEvent("integration-evidence", "evt_card_secret"),
        buildIntegrationEvent("integration-evidence", "evt_failed_secret", "im.message.receive_v1", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.botSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.bot.processedInboundEvents, 0);
  assert.ok(item?.issues.includes("processed_inbound_event_missing"));
});

test("Feishu evidence report requires approved write metadata for data-plane smoke", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    dataOperationsByIntegrationId: {
      "integration-evidence": [
        buildDataOperationRun("integration-evidence", "docs.read_document", "doc", "succeeded"),
        buildAgentRuntimeDocReadRun("integration-evidence"),
        {
          ...(buildDataOperationRun("integration-evidence", "docs.update_document", "doc", "succeeded") as Record<string, unknown>),
          resultJson: JSON.stringify({ updatedBlockCount: 1 }),
        } as never,
        buildDataOperationRun("integration-evidence", "sheets.read_range", "sheet", "succeeded"),
        {
          ...(buildDataOperationRun("integration-evidence", "sheets.update_range", "sheet", "succeeded") as Record<string, unknown>),
          resultJson: JSON.stringify({ updatedRange: "A1:B1" }),
        } as never,
        buildDataOperationRun("integration-evidence", "base.query_records", "base_table", "succeeded"),
        {
          ...(buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "succeeded") as Record<string, unknown>),
          resultJson: JSON.stringify({ updatedRecordCount: 1 }),
        } as never,
        buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.botSatisfiedCount, 1);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.dataPlane.docWriteSucceeded, 1);
  assert.equal(item?.dataPlane.docApprovedWritesSucceeded, 0);
  assert.equal(item?.dataPlane.sheetReadSucceeded, 1);
  assert.equal(item?.dataPlane.sheetWriteSucceeded, 1);
  assert.equal(item?.dataPlane.sheetApprovedWritesSucceeded, 0);
  assert.equal(item?.dataPlane.sheetApprovedWriteSyncSucceeded, 0);
  assert.equal(item?.dataPlane.baseMutateSucceeded, 1);
  assert.equal(item?.dataPlane.baseApprovedMutationsSucceeded, 0);
  assert.equal(item?.dataPlane.baseApprovedMutationSyncSucceeded, 0);
  assert.ok(item?.issues.includes("doc_write_approval_evidence_missing"));
  assert.ok(item?.issues.includes("sheet_write_approval_evidence_missing"));
  assert.ok(item?.issues.includes("base_mutate_approval_evidence_missing"));
});

test("Feishu evidence report requires approved write payload hashes to be digests", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    dataOperationsByIntegrationId: {
      "integration-evidence": [
        buildDataOperationRun("integration-evidence", "docs.read_document", "doc", "succeeded"),
        buildAgentRuntimeDocReadRun("integration-evidence"),
        withApprovedPayloadHash(
          buildDataOperationRun("integration-evidence", "docs.update_document", "doc", "succeeded"),
          "secret doc write value",
        ),
        buildDataOperationRun("integration-evidence", "sheets.read_range", "sheet", "succeeded"),
        withApprovedPayloadHash(
          buildDataOperationRun("integration-evidence", "sheets.update_range", "sheet", "succeeded"),
          "secret sheet write value",
        ),
        buildDataOperationRun("integration-evidence", "base.query_records", "base_table", "succeeded"),
        withApprovedPayloadHash(
          buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "succeeded"),
          "secret base write value",
        ),
        buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.dataPlane.docApprovedWritesSucceeded, 0);
  assert.equal(item?.dataPlane.sheetApprovedWritesSucceeded, 0);
  assert.equal(item?.dataPlane.sheetApprovedWriteSyncSucceeded, 0);
  assert.equal(item?.dataPlane.baseApprovedMutationsSucceeded, 0);
  assert.equal(item?.dataPlane.baseApprovedMutationSyncSucceeded, 0);
  assert.ok(item?.issues.includes("doc_write_approval_evidence_missing"));
  assert.ok(item?.issues.includes("sheet_write_approval_evidence_missing"));
  assert.ok(item?.issues.includes("base_mutate_approval_evidence_missing"));
});

test("Feishu evidence report requires Agent-triggered Doc read evidence", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    dataOperationsByIntegrationId: {
      "integration-evidence": [
        buildDataOperationRun("integration-evidence", "docs.read_document", "doc", "succeeded", {
          actorType: "user",
          actorId: "user-1",
        }),
        buildDataOperationRun("integration-evidence", "docs.read_document", "doc", "succeeded", {
          actorType: "agent",
          actorId: "agent-plain-server-read",
        }),
        buildDataOperationRun("integration-evidence", "docs.update_document", "doc", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.read_range", "sheet", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.update_range", "sheet", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.query_records", "base_table", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.dataPlane.docReadSucceeded, 2);
  assert.equal(item?.dataPlane.agentDocReadSucceeded, 0);
  assert.ok(item?.issues.includes("agent_doc_read_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("doc_secret"), false);
});

test("Feishu evidence report requires generic and runtime Doc read as separate data-plane proof", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    dataOperationsByIntegrationId: {
      "integration-evidence": [
        buildAgentRuntimeDocReadRun("integration-evidence"),
        buildDataOperationRun("integration-evidence", "docs.update_document", "doc", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.read_range", "sheet", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.update_range", "sheet", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.query_records", "base_table", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.dataPlane.docReadSucceeded, 0);
  assert.equal(item?.dataPlane.agentDocReadSucceeded, 1);
  assert.ok(item?.issues.includes("doc_read_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("doc_secret"), false);
});

test("Feishu evidence report requires read evidence on bound governed resources", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    dataOperationsByIntegrationId: {
      "integration-evidence": [
        withoutResourceBindingId(buildDataOperationRun("integration-evidence", "docs.read_document", "doc", "succeeded", {
          actorType: "user",
          actorId: "user-1",
        })),
        buildAgentRuntimeDocReadRun("integration-evidence"),
        buildDataOperationRun("integration-evidence", "docs.update_document", "doc", "succeeded"),
        withoutResourceBindingId(buildDataOperationRun("integration-evidence", "sheets.read_range", "sheet", "succeeded")),
        buildDataOperationRun("integration-evidence", "sheets.update_range", "sheet", "succeeded"),
        withoutResourceBindingId(buildDataOperationRun("integration-evidence", "base.query_records", "base_table", "succeeded")),
        buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "succeeded"),
        buildExternalGuestWriteDeniedRun("integration-evidence"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.dataPlane.docReadSucceeded, 0);
  assert.equal(item?.dataPlane.agentDocReadSucceeded, 1);
  assert.equal(item?.dataPlane.sheetReadSucceeded, 0);
  assert.equal(item?.dataPlane.baseReadSucceeded, 0);
  assert.ok(item?.issues.includes("doc_read_evidence_missing"));
  assert.ok(item?.issues.includes("sheet_read_evidence_missing"));
  assert.ok(item?.issues.includes("base_read_evidence_missing"));
});

test("Feishu evidence report requires approved writes on bound governed resources", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    dataOperationsByIntegrationId: {
      "integration-evidence": [
        buildDataOperationRun("integration-evidence", "docs.read_document", "doc", "succeeded", {
          actorType: "user",
          actorId: "user-1",
        }),
        buildAgentRuntimeDocReadRun("integration-evidence"),
        withoutResourceBindingId(buildDataOperationRun("integration-evidence", "docs.update_document", "doc", "succeeded")),
        buildDataOperationRun("integration-evidence", "sheets.read_range", "sheet", "succeeded"),
        withoutResourceBindingId(buildDataOperationRun("integration-evidence", "sheets.update_range", "sheet", "succeeded")),
        buildDataOperationRun("integration-evidence", "base.query_records", "base_table", "succeeded"),
        withoutResourceBindingId(buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "succeeded")),
        buildExternalGuestWriteDeniedRun("integration-evidence"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.dataPlane.docApprovedWritesSucceeded, 0);
  assert.equal(item?.dataPlane.sheetApprovedWritesSucceeded, 0);
  assert.equal(item?.dataPlane.sheetApprovedWriteSyncSucceeded, 0);
  assert.equal(item?.dataPlane.baseApprovedMutationsSucceeded, 0);
  assert.equal(item?.dataPlane.baseApprovedMutationSyncSucceeded, 0);
  assert.ok(item?.issues.includes("doc_write_approval_evidence_missing"));
  assert.ok(item?.issues.includes("sheet_write_approval_evidence_missing"));
  assert.ok(item?.issues.includes("base_mutate_approval_evidence_missing"));
});

test("Feishu evidence report requires AgentSpace sync proof for approved Sheet and Base writes", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    dataOperationsByIntegrationId: {
      "integration-evidence": [
        buildDataOperationRun("integration-evidence", "docs.read_document", "doc", "succeeded"),
        buildAgentRuntimeDocReadRun("integration-evidence"),
        buildDataOperationRun("integration-evidence", "docs.update_document", "doc", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.read_range", "sheet", "succeeded"),
        {
          ...(buildDataOperationRun("integration-evidence", "sheets.update_range", "sheet", "succeeded") as Record<string, unknown>),
          resultJson: JSON.stringify({
            policyDecision: "approved",
            approvalId: "approval-sheet",
            payloadHash: "1111111111111111111111111111111111111111111111111111111111111111",
            agentSpaceSync: {
              dataTableLastApprovedWriteSynced: false,
              dataTableReasonCode: "feishu.data_table_write_sync_failed",
            },
          }),
        } as never,
        buildDataOperationRun("integration-evidence", "base.query_records", "base_table", "succeeded"),
        {
          ...(buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "succeeded") as Record<string, unknown>),
          resultJson: JSON.stringify({
            policyDecision: "approved",
            approvalId: "approval-base",
            payloadHash: "2222222222222222222222222222222222222222222222222222222222222222",
          }),
        } as never,
        buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.botSatisfiedCount, 1);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.dataPlane.docApprovedWritesSucceeded, 1);
  assert.equal(item?.dataPlane.sheetApprovedWritesSucceeded, 1);
  assert.equal(item?.dataPlane.sheetApprovedWriteSyncSucceeded, 0);
  assert.equal(item?.dataPlane.baseApprovedMutationsSucceeded, 1);
  assert.equal(item?.dataPlane.baseApprovedMutationSyncSucceeded, 0);
  assert.ok(item?.issues.includes("sheet_write_agentspace_sync_evidence_missing"));
  assert.ok(item?.issues.includes("base_mutate_agentspace_sync_evidence_missing"));
});

test("Feishu evidence report requires agent bot governance on approved writes", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    dataOperationsByIntegrationId: {
      "integration-evidence": [
        buildDataOperationRun("integration-evidence", "docs.read_document", "doc", "succeeded", {
          actorType: "user",
          actorId: "user-1",
        }),
        buildExternalGuestDocReadRun("integration-evidence"),
        buildAgentRuntimeDocReadRun("integration-evidence"),
        buildDataOperationRun("integration-evidence", "docs.update_document", "doc", "succeeded", undefined, {
          governanceBotBindingId: null,
        }),
        buildDataOperationRun("integration-evidence", "sheets.read_range", "sheet", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.update_range", "sheet", "succeeded", undefined, {
          governanceBotBindingId: null,
        }),
        buildDataOperationRun("integration-evidence", "base.query_records", "base_table", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "succeeded", undefined, {
          governanceBotBindingId: null,
        }),
        buildExternalGuestWriteDeniedRun("integration-evidence"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.dataPlane.docWriteSucceeded, 1);
  assert.equal(item?.dataPlane.docApprovedWritesSucceeded, 0);
  assert.equal(item?.dataPlane.sheetWriteSucceeded, 1);
  assert.equal(item?.dataPlane.sheetApprovedWritesSucceeded, 0);
  assert.equal(item?.dataPlane.sheetApprovedWriteSyncSucceeded, 0);
  assert.equal(item?.dataPlane.baseMutateSucceeded, 1);
  assert.equal(item?.dataPlane.baseApprovedMutationsSucceeded, 0);
  assert.equal(item?.dataPlane.baseApprovedMutationSyncSucceeded, 0);
  assert.ok(item?.issues.includes("doc_write_approval_evidence_missing"));
  assert.ok(item?.issues.includes("sheet_write_approval_evidence_missing"));
  assert.ok(item?.issues.includes("base_mutate_approval_evidence_missing"));
});

test("Feishu evidence report requires data-plane proof to match the agent bot and use safe resource context", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "data-plane",
    dataOperationsByIntegrationId: {
      "integration-evidence": [
        buildDataOperationRun("integration-evidence", "docs.read_document", "doc", "succeeded", {
          actorType: "user",
          actorId: "user-1",
        }, {
          governanceBotBindingId: "other-bot-binding",
        }),
        withGovernanceContextFields(buildDataOperationRun("integration-evidence", "docs.read_document", "doc", "succeeded", {
          actorType: "user",
          actorId: "user-1",
        }), {
          open_id: "ou_secret_raw",
        }),
        withGovernanceContextFields(buildExternalGuestDocReadRun("integration-evidence"), {
          resourceReference: "",
        }),
        withGovernanceContextFields(buildAgentRuntimeDocReadRun("integration-evidence"), {
          resourceIdRedacted: false,
        }),
        withGovernanceContextFields(
          buildDataOperationRun("integration-evidence", "docs.update_document", "doc", "succeeded"),
          {
            providerResourceToken: "doccn_secret_raw",
          },
        ),
        withGovernanceContextFields(
          buildDataOperationRun("integration-evidence", "sheets.read_range", "sheet", "succeeded"),
          {
            external_chat_id: "oc_secret_raw",
          },
        ),
        buildDataOperationRun("integration-evidence", "sheets.update_range", "sheet", "succeeded", undefined, {
          governanceBotBindingId: "other-bot-binding",
        }),
        buildDataOperationRun("integration-evidence", "base.query_records", "base_table", "succeeded", undefined, {
          governanceResourceReference: null,
        }),
        buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "succeeded", undefined, {
          governanceResourceIdRedacted: false,
        }),
        withGovernanceContextFields(buildExternalGuestWriteDeniedRun("integration-evidence"), {
          resource_token: "tbl_secret_raw",
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.dataPlane.docReadSucceeded, 0);
  assert.equal(item?.dataPlane.agentDocReadSucceeded, 0);
  assert.equal(item?.dataPlane.docApprovedWritesSucceeded, 0);
  assert.equal(item?.dataPlane.sheetReadSucceeded, 0);
  assert.equal(item?.dataPlane.sheetApprovedWriteSyncSucceeded, 0);
  assert.equal(item?.dataPlane.baseReadSucceeded, 0);
  assert.equal(item?.dataPlane.baseApprovedMutationSyncSucceeded, 0);
  assert.equal(item?.dataPlane.userActorEvidence, 0);
  assert.equal(item?.dataPlane.externalGuestActorEvidence, 0);
  assert.equal(item?.dataPlane.externalGuestReadSucceeded, 0);
  assert.equal(item?.dataPlane.externalGuestWriteDeniedEvidence, 0);
  assert.ok(item?.issues.includes("doc_read_evidence_missing"));
  assert.ok(item?.issues.includes("doc_write_approval_evidence_missing"));
  assert.ok(item?.issues.includes("sheet_read_evidence_missing"));
  assert.ok(item?.issues.includes("sheet_write_approval_evidence_missing"));
  assert.ok(item?.issues.includes("base_read_evidence_missing"));
  assert.ok(item?.issues.includes("base_mutate_approval_evidence_missing"));
  assert.ok(item?.issues.includes("user_actor_data_operation_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_actor_data_operation_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("ou_secret_raw"), false);
  assert.equal(JSON.stringify(report).includes("doccn_secret_raw"), false);
  assert.equal(JSON.stringify(report).includes("oc_secret_raw"), false);
  assert.equal(JSON.stringify(report).includes("tbl_secret_raw"), false);
});

test("Feishu evidence report requires data-plane governance context to avoid embedded raw ids", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "data-plane",
    dataOperationsByIntegrationId: {
      "integration-evidence": complete.dataOperationsByIntegrationId["integration-evidence"].map((operation) =>
        withGovernanceContextFields(operation, {
          debugPayload: "data-plane chat oc_secret_data_plane_debug",
          debugResource: "doccn_secret_data_plane_resource",
        })
      ),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.dataPlane.docReadSucceeded, 0);
  assert.equal(item?.dataPlane.agentDocReadSucceeded, 0);
  assert.equal(item?.dataPlane.docApprovedWritesSucceeded, 0);
  assert.equal(item?.dataPlane.sheetReadSucceeded, 0);
  assert.equal(item?.dataPlane.sheetApprovedWriteSyncSucceeded, 0);
  assert.equal(item?.dataPlane.baseReadSucceeded, 0);
  assert.equal(item?.dataPlane.baseApprovedMutationSyncSucceeded, 0);
  assert.equal(item?.dataPlane.userActorEvidence, 0);
  assert.equal(item?.dataPlane.externalGuestActorEvidence, 0);
  assert.equal(item?.dataPlane.externalGuestReadSucceeded, 0);
  assert.equal(item?.dataPlane.externalGuestWriteDeniedEvidence, 0);
  assert.ok(item?.issues.includes("doc_read_evidence_missing"));
  assert.ok(item?.issues.includes("doc_write_approval_evidence_missing"));
  assert.ok(item?.issues.includes("sheet_read_evidence_missing"));
  assert.ok(item?.issues.includes("sheet_write_approval_evidence_missing"));
  assert.ok(item?.issues.includes("base_read_evidence_missing"));
  assert.ok(item?.issues.includes("base_mutate_approval_evidence_missing"));
  assert.ok(item?.issues.includes("user_actor_data_operation_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_actor_data_operation_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("oc_secret_data_plane_debug"), false);
  assert.equal(JSON.stringify(report).includes("doccn_secret_data_plane_resource"), false);
});

test("Feishu evidence report requires data-plane result summaries to avoid raw Feishu resource ids", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "data-plane",
    dataOperationsByIntegrationId: {
      "integration-evidence": complete.dataOperationsByIntegrationId["integration-evidence"].map((operation) => {
        const operationSource = operation as { operationType?: string; status?: string };
        if (operationSource.operationType === "docs.read_document" && operationSource.status === "succeeded") {
          return withResultJsonFields(operation, {
            docToken: "doccn_secret_result_raw",
          });
        }
        if (operationSource.operationType === "docs.update_document" && operationSource.status === "succeeded") {
          return withResultJsonFields(operation, {
            doc_token: "doccn_secret_write_result_raw",
          });
        }
        if (operationSource.operationType === "sheets.read_range" && operationSource.status === "succeeded") {
          return withResultJsonFields(operation, {
            spreadsheetToken: "shtcn_secret_result_raw",
          });
        }
        if (operationSource.operationType === "sheets.update_range" && operationSource.status === "succeeded") {
          return withResultJsonFields(operation, {
            table_id: "tbl_secret_sheet_write_result_raw",
          });
        }
        if (operationSource.operationType === "base.query_records" && operationSource.status === "succeeded") {
          return withResultJsonFields(operation, {
            appToken: "bascn_secret_result_raw",
          });
        }
        if (operationSource.operationType === "base.mutate_records") {
          return withResultJsonFields(operation, {
            app_token: operationSource.status === "failed"
              ? "bascn_secret_guest_write_result_raw"
              : "bascn_secret_write_result_raw",
          });
        }
        return operation;
      }),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.dataPlane.docReadSucceeded, 0);
  assert.equal(item?.dataPlane.agentDocReadSucceeded, 0);
  assert.equal(item?.dataPlane.docApprovedWritesSucceeded, 0);
  assert.equal(item?.dataPlane.sheetReadSucceeded, 0);
  assert.equal(item?.dataPlane.sheetApprovedWriteSyncSucceeded, 0);
  assert.equal(item?.dataPlane.baseReadSucceeded, 0);
  assert.equal(item?.dataPlane.baseApprovedMutationSyncSucceeded, 0);
  assert.equal(item?.dataPlane.externalGuestReadSucceeded, 0);
  assert.equal(item?.dataPlane.externalGuestWriteDeniedEvidence, 0);
  assert.ok(item?.issues.includes("doc_read_evidence_missing"));
  assert.ok(item?.issues.includes("doc_write_approval_evidence_missing"));
  assert.ok(item?.issues.includes("sheet_read_evidence_missing"));
  assert.ok(item?.issues.includes("sheet_write_approval_evidence_missing"));
  assert.ok(item?.issues.includes("base_read_evidence_missing"));
  assert.ok(item?.issues.includes("base_mutate_approval_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_read_evidence_missing"));
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("doccn_secret_result_raw"), false);
  assert.equal(serialized.includes("doccn_secret_write_result_raw"), false);
  assert.equal(serialized.includes("shtcn_secret_result_raw"), false);
  assert.equal(serialized.includes("tbl_secret_sheet_write_result_raw"), false);
  assert.equal(serialized.includes("bascn_secret_result_raw"), false);
  assert.equal(serialized.includes("bascn_secret_write_result_raw"), false);
  assert.equal(serialized.includes("bascn_secret_guest_write_result_raw"), false);
});

test("Feishu evidence report requires user and external guest actor provenance", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    dataOperationsByIntegrationId: {
      "integration-evidence": [
        buildDataOperationRun("integration-evidence", "docs.read_document", "doc", "succeeded"),
        buildAgentRuntimeDocReadRun("integration-evidence"),
        buildDataOperationRun("integration-evidence", "docs.update_document", "doc", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.read_range", "sheet", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.update_range", "sheet", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.query_records", "base_table", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.dataPlane.docApprovedWritesSucceeded, 1);
  assert.equal(item?.dataPlane.sheetApprovedWriteSyncSucceeded, 1);
  assert.equal(item?.dataPlane.baseApprovedMutationSyncSucceeded, 1);
  assert.equal(item?.dataPlane.userActorEvidence, 0);
  assert.equal(item?.dataPlane.externalGuestActorEvidence, 0);
  assert.equal(item?.dataPlane.externalGuestWriteDeniedEvidence, 0);
  assert.ok(item?.issues.includes("user_actor_data_operation_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_actor_data_operation_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("ou_secret"), false);
});

test("Feishu evidence report requires external guest write-deny proof", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    dataOperationsByIntegrationId: {
      "integration-evidence": [
        buildDataOperationRun("integration-evidence", "docs.read_document", "doc", "succeeded", {
          actorType: "user",
          actorId: "user-1",
        }),
        buildExternalGuestDocReadRun("integration-evidence"),
        buildAgentRuntimeDocReadRun("integration-evidence"),
        buildDataOperationRun("integration-evidence", "docs.update_document", "doc", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.read_range", "sheet", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.update_range", "sheet", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.query_records", "base_table", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.update_range", "sheet", "failed", undefined, {
          governanceActorType: "external_guest",
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.dataPlane.userActorEvidence, 1);
  assert.equal(item?.dataPlane.externalGuestActorEvidence, 2);
  assert.equal(item?.dataPlane.externalGuestWriteDeniedEvidence, 0);
  assert.ok(item?.issues.includes("external_guest_write_deny_evidence_missing"));
});

test("Feishu evidence report requires external guest write-deny proof on a bound write resource", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    dataOperationsByIntegrationId: {
      "integration-evidence": [
        buildDataOperationRun("integration-evidence", "docs.read_document", "doc", "succeeded", {
          actorType: "user",
          actorId: "user-1",
        }),
        buildExternalGuestDocReadRun("integration-evidence"),
        buildAgentRuntimeDocReadRun("integration-evidence"),
        buildDataOperationRun("integration-evidence", "docs.update_document", "doc", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.read_range", "sheet", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.update_range", "sheet", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.query_records", "base_table", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "succeeded"),
        withoutResourceBindingId(buildExternalGuestWriteDeniedRun("integration-evidence")),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.dataPlane.externalGuestActorEvidence, 2);
  assert.equal(item?.dataPlane.externalGuestWriteDeniedEvidence, 0);
  assert.ok(item?.issues.includes("external_guest_write_deny_evidence_missing"));
});

test("Feishu evidence report requires data-plane guest permission profiles to match TODO120 policy", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "data-plane",
    dataOperationsByIntegrationId: {
      "integration-evidence": complete.dataOperationsByIntegrationId["integration-evidence"].map((operation) => {
        const operationSource = operation as { operationType?: string; status?: string };
        if (
          operationSource.operationType === "docs.read_document" &&
          operationSource.status === "succeeded" &&
          readTestGovernanceActorType(operation) === "external_guest"
        ) {
          return withGovernanceContextFields(operation, { externalGuestPermissionProfile: "channel_readonly" });
        }
        if (
          operationSource.operationType === "base.mutate_records" &&
          operationSource.status === "failed" &&
          readTestGovernanceActorType(operation) === "external_guest"
        ) {
          return withGovernanceContextFields(operation, { externalGuestPermissionProfile: "channel_readonly" });
        }
        return operation;
      }),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.dataPlane.externalGuestActorEvidence, 0);
  assert.equal(item?.dataPlane.externalGuestReadSucceeded, 0);
  assert.equal(item?.dataPlane.externalGuestWriteDeniedEvidence, 0);
  assert.ok(item?.issues.includes("external_guest_actor_data_operation_evidence_missing"));
});

test("Feishu evidence report requires data-plane external guest proof to show no workspace member was created", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "data-plane",
    dataOperationsByIntegrationId: {
      "integration-evidence": complete.dataOperationsByIntegrationId["integration-evidence"].map((operation) =>
        readTestGovernanceActorType(operation) === "external_guest"
          ? withGovernanceContextFields(operation, { workspaceMemberCreated: true })
          : operation
      ),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.dataPlane.externalGuestActorEvidence, 0);
  assert.equal(item?.dataPlane.externalGuestReadSucceeded, 0);
  assert.equal(item?.dataPlane.externalGuestWriteDeniedEvidence, 0);
  assert.ok(item?.issues.includes("external_guest_actor_data_operation_evidence_missing"));
});

test("Feishu evidence report accepts require_identity write denial with no guest permissions", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "data-plane",
    dataOperationsByIntegrationId: {
      "integration-evidence": complete.dataOperationsByIntegrationId["integration-evidence"].map((operation) => {
        const operationSource = operation as { operationType?: string; status?: string };
        if (
          operationSource.operationType === "base.mutate_records" &&
          operationSource.status === "failed" &&
          readTestGovernanceActorType(operation) === "external_guest"
        ) {
          return withGovernanceContextFields(operation, { externalGuestPermissionProfile: "none" });
        }
        return operation;
      }),
    },
  });

  assert.equal(report.strictSatisfied, true);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 1);
  const [item] = report.integrations;
  assert.equal(item?.dataPlane.externalGuestActorEvidence, 2);
  assert.equal(item?.dataPlane.externalGuestReadSucceeded, 1);
  assert.equal(item?.dataPlane.externalGuestWriteDeniedEvidence, 1);
});

test("Feishu evidence report rejects incomplete data-plane actor governance context", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    dataOperationsByIntegrationId: {
      "integration-evidence": [
        buildDataOperationRun("integration-evidence", "docs.read_document", "doc", "succeeded", {
          actorType: "user",
          actorId: "user-1",
        }, {
          governanceBotBindingId: null,
        }),
        buildAgentRuntimeDocReadRun("integration-evidence"),
        buildDataOperationRun("integration-evidence", "docs.update_document", "doc", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.read_range", "sheet", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.update_range", "sheet", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.query_records", "base_table", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "succeeded"),
        buildExternalGuestWriteDeniedRun("integration-evidence", {
          governanceExternalGuestPermissionProfile: null,
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.dataPlane.userActorEvidence, 0);
  assert.equal(item?.dataPlane.externalGuestActorEvidence, 0);
  assert.equal(item?.dataPlane.externalGuestWriteDeniedEvidence, 0);
  assert.ok(item?.issues.includes("user_actor_data_operation_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_actor_data_operation_evidence_missing"));
});

test("Feishu evidence report rejects external guest data-plane proof with user identity", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    dataOperationsByIntegrationId: {
      "integration-evidence": [
        buildDataOperationRun("integration-evidence", "docs.read_document", "doc", "succeeded", {
          actorType: "user",
          actorId: "user-1",
        }),
        buildAgentRuntimeDocReadRun("integration-evidence"),
        buildDataOperationRun("integration-evidence", "docs.update_document", "doc", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.read_range", "sheet", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.update_range", "sheet", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.query_records", "base_table", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "succeeded"),
        withGovernanceUserIdentity(buildExternalGuestWriteDeniedRun("integration-evidence")),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.dataPlane.userActorEvidence, 1);
  assert.equal(item?.dataPlane.externalGuestActorEvidence, 0);
  assert.equal(item?.dataPlane.externalGuestWriteDeniedEvidence, 0);
  assert.ok(item?.issues.includes("external_guest_actor_data_operation_evidence_missing"));
});

test("Feishu evidence report gates native agent bot experience proof", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "native",
    messageMappingsByIntegrationId: {
      "integration-evidence": [
        buildMessageMapping("integration-evidence", "inbound", "om_secret_inbound"),
        buildMessageMapping("integration-evidence", "outbound", "om_secret_reply", "om_secret_inbound"),
      ],
    },
    channelBindingsByIntegrationId: {
      "integration-evidence": [],
    },
    threadBindingsByIntegrationId: {
      "integration-evidence": [],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.botSatisfiedCount, 1);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 1);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.agentBotRouteEvidence, 1);
  assert.equal(item?.nativeExperience.nativeBotReplyEvidence, 1);
  assert.equal(item?.nativeExperience.boundUserMentionEvidence, 1);
  assert.equal(item?.nativeExperience.externalGuestMentionEvidence, 0);
  assert.equal(item?.nativeExperience.agentChannelPolicyDeniedEvidence, 0);
  assert.equal(item?.nativeExperience.botSenderLoopGuardEvidence, 0);
  assert.equal(item?.nativeExperience.autoProvisionedChannelBindings, 0);
  assert.equal(item?.nativeExperience.botAddedAutoProvisionedChannelBindings, 0);
  assert.equal(item?.nativeExperience.firstMessageAutoProvisionedChannelBindings, 0);
  assert.equal(item?.nativeExperience.reusedProviderChannelBindings, 0);
  assert.equal(item?.nativeExperience.threadTaskBindings, 0);
  assert.equal(item?.nativeExperience.threadContinuationEvidence, 0);
  assert.equal(item?.nativeExperience.threadCollaborationEvidence, 0);
  assert.ok(item?.issues.includes("external_guest_bot_mention_evidence_missing"));
  assert.ok(item?.issues.includes("agent_channel_policy_disabled_evidence_missing"));
  assert.ok(item?.issues.includes("bot_sender_loop_guard_evidence_missing"));
  assert.ok(item?.issues.includes("channel_auto_provision_evidence_missing"));
  assert.ok(item?.issues.includes("bot_added_auto_provision_evidence_missing"));
  assert.ok(item?.issues.includes("first_message_auto_provision_evidence_missing"));
  assert.ok(item?.issues.includes("multi_agent_channel_reuse_evidence_missing"));
  assert.ok(item?.issues.includes("thread_task_binding_evidence_missing"));
  assert.ok(item?.issues.includes("thread_continuation_evidence_missing"));
  assert.ok(item?.issues.includes("thread_collaboration_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("oc_secret"), false);
  assert.equal(JSON.stringify(report).includes("ou_secret"), false);
});

test("Feishu evidence report requires agent policy denial evidence without a bot reply", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "native",
    messageMappingsByIntegrationId: {
      "integration-evidence": [
        ...complete.messageMappingsByIntegrationId["integration-evidence"],
        buildMessageMapping(
          "integration-evidence",
          "outbound",
          "om_secret_policy_violation_reply",
          "om_secret_agent_policy_disabled",
        ),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.nativeBotReplyEvidence, 3);
  assert.equal(item?.nativeExperience.agentChannelPolicyDeniedEvidence, 0);
  assert.ok(item?.issues.includes("agent_channel_policy_disabled_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("om_secret_policy_violation_reply"), false);
});

test("Feishu evidence report requires bot sender loop guard without a bot reply", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "native",
    messageMappingsByIntegrationId: {
      "integration-evidence": [
        ...complete.messageMappingsByIntegrationId["integration-evidence"],
        buildMessageMapping(
          "integration-evidence",
          "outbound",
          "om_secret_bot_sender_loop_reply",
          "om_secret_bot_sender_loop",
        ),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.nativeBotReplyEvidence, 3);
  assert.equal(item?.nativeExperience.botSenderLoopGuardEvidence, 0);
  assert.ok(item?.issues.includes("bot_sender_loop_guard_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("om_secret_bot_sender_loop_reply"), false);
});

test("Feishu evidence report requires no-reply native evidence to avoid raw Feishu ids", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "native",
    messageMappingsByIntegrationId: {
      "integration-evidence": complete.messageMappingsByIntegrationId["integration-evidence"].map((mapping) => {
        const metadataSource = mapping as { metadataJson?: string };
        const metadata = JSON.parse(metadataSource.metadataJson ?? "{}") as Record<string, unknown>;
        if (metadata.reasonCode === "feishu_agent_channel_member_access_disabled") {
          return withMetadataFields(mapping, {
            external_chat_id: "oc_secret_policy_denied",
            open_id: "ou_secret_policy_denied",
          });
        }
        if (metadata.reasonCode === "feishu_bot_sender_ignored") {
          return withMetadataFields(mapping, {
            externalThreadId: "om_secret_bot_sender",
            providerOpenId: "ou_secret_bot_sender",
          });
        }
        return mapping;
      }),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.agentChannelPolicyDeniedEvidence, 0);
  assert.equal(item?.nativeExperience.botSenderLoopGuardEvidence, 0);
  assert.ok(item?.issues.includes("agent_channel_policy_disabled_evidence_missing"));
  assert.ok(item?.issues.includes("bot_sender_loop_guard_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("oc_secret_policy_denied"), false);
  assert.equal(JSON.stringify(report).includes("ou_secret_policy_denied"), false);
  assert.equal(JSON.stringify(report).includes("om_secret_bot_sender"), false);
  assert.equal(JSON.stringify(report).includes("ou_secret_bot_sender"), false);
});

test("Feishu evidence report requires native route evidence from direct bot mentions", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "native",
    messageMappingsByIntegrationId: {
      "integration-evidence": complete.messageMappingsByIntegrationId["integration-evidence"].map((mapping) =>
        withAgentBotMentioned(mapping, false)
      ),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.agentBotRouteEvidence, 0);
  assert.equal(item?.nativeExperience.boundUserMentionEvidence, 0);
  assert.equal(item?.nativeExperience.externalGuestMentionEvidence, 0);
  assert.equal(item?.nativeExperience.agentChannelPolicyDeniedEvidence, 0);
  assert.ok(item?.issues.includes("agent_bot_route_evidence_missing"));
  assert.ok(item?.issues.includes("bound_user_bot_mention_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_bot_mention_evidence_missing"));
  assert.ok(item?.issues.includes("agent_channel_policy_disabled_evidence_missing"));
});

test("Feishu evidence report rejects slash-agent command routing as native mention evidence", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "native",
    messageMappingsByIntegrationId: {
      "integration-evidence": complete.messageMappingsByIntegrationId["integration-evidence"].map((mapping) => {
        const metadataSource = mapping as { direction?: string; metadataJson?: string };
        const metadata = JSON.parse(metadataSource.metadataJson ?? "{}") as Record<string, unknown>;
        return metadataSource.direction === "inbound" &&
            metadata.dispatchStatus === "sent" &&
            metadata.agentBotMentioned === true
          ? withMetadataFields(mapping, {
            agentSpaceCommandUsed: true,
            textSummary: "/agent Atlas summarize this",
          })
          : mapping;
      }),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.agentBotRouteEvidence, 0);
  assert.equal(item?.nativeExperience.boundUserMentionEvidence, 0);
  assert.equal(item?.nativeExperience.externalGuestMentionEvidence, 0);
  assert.ok(item?.issues.includes("agent_bot_route_evidence_missing"));
  assert.ok(item?.issues.includes("bound_user_bot_mention_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_bot_mention_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("/agent Atlas"), false);
});

test("Feishu evidence report requires native route safe chat and thread context", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "native",
    messageMappingsByIntegrationId: {
      "integration-evidence": complete.messageMappingsByIntegrationId["integration-evidence"].map((mapping) => {
        const metadataSource = mapping as { direction?: string; metadataJson?: string };
        const metadata = JSON.parse(metadataSource.metadataJson ?? "{}") as Record<string, unknown>;
        return metadataSource.direction === "inbound" && metadata.agentBotMentioned === true
          ? withoutMetadataField(mapping, "externalThreadReference")
          : mapping;
      }),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.agentBotRouteEvidence, 0);
  assert.equal(item?.nativeExperience.boundUserMentionEvidence, 0);
  assert.equal(item?.nativeExperience.externalGuestMentionEvidence, 0);
  assert.equal(item?.nativeExperience.agentChannelPolicyDeniedEvidence, 0);
  assert.ok(item?.issues.includes("agent_bot_route_evidence_missing"));
  assert.ok(item?.issues.includes("bound_user_bot_mention_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_bot_mention_evidence_missing"));
  assert.ok(item?.issues.includes("agent_channel_policy_disabled_evidence_missing"));
});

test("Feishu evidence report requires native inbound evidence to avoid raw Feishu ids", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "native",
    messageMappingsByIntegrationId: {
      "integration-evidence": complete.messageMappingsByIntegrationId["integration-evidence"].map((mapping) => {
        const metadataSource = mapping as { direction?: string; metadataJson?: string };
        const metadata = JSON.parse(metadataSource.metadataJson ?? "{}") as Record<string, unknown>;
        return metadataSource.direction === "inbound" &&
            metadata.dispatchStatus === "sent" &&
            metadata.agentBotMentioned === true
          ? withMetadataFields(mapping, {
            chat_id: "oc_secret_native_route_raw",
            open_id: "ou_secret_native_route_raw",
          })
          : mapping;
      }),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.agentBotRouteEvidence, 0);
  assert.equal(item?.nativeExperience.boundUserMentionEvidence, 0);
  assert.equal(item?.nativeExperience.externalGuestMentionEvidence, 0);
  assert.ok(item?.issues.includes("agent_bot_route_evidence_missing"));
  assert.ok(item?.issues.includes("bound_user_bot_mention_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_bot_mention_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("oc_secret_native_route_raw"), false);
  assert.equal(JSON.stringify(report).includes("ou_secret_native_route_raw"), false);
});

test("Feishu evidence report requires native inbound metadata to avoid embedded raw ids", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "native",
    messageMappingsByIntegrationId: {
      "integration-evidence": complete.messageMappingsByIntegrationId["integration-evidence"].map((mapping) => {
        const metadataSource = mapping as { direction?: string; metadataJson?: string };
        const metadata = JSON.parse(metadataSource.metadataJson ?? "{}") as Record<string, unknown>;
        return metadataSource.direction === "inbound" &&
            metadata.dispatchStatus === "sent" &&
            metadata.agentBotMentioned === true
          ? withMetadataFields(mapping, {
            debugPayload: "source chat oc_secret_native_route_debug",
            debugResource: "doccn_secret_native_route_resource",
          })
          : mapping;
      }),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.agentBotRouteEvidence, 0);
  assert.equal(item?.nativeExperience.boundUserMentionEvidence, 0);
  assert.equal(item?.nativeExperience.externalGuestMentionEvidence, 0);
  assert.ok(item?.issues.includes("agent_bot_route_evidence_missing"));
  assert.ok(item?.issues.includes("bound_user_bot_mention_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_bot_mention_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("oc_secret_native_route_debug"), false);
  assert.equal(JSON.stringify(report).includes("doccn_secret_native_route_resource"), false);
});

test("Feishu evidence report requires native inbound bot binding to match the mapping integration", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "native",
    messageMappingsByIntegrationId: {
      "integration-evidence": complete.messageMappingsByIntegrationId["integration-evidence"].map((mapping) => {
        const metadataSource = mapping as { direction?: string; metadataJson?: string };
        const metadata = JSON.parse(metadataSource.metadataJson ?? "{}") as Record<string, unknown>;
        return metadataSource.direction === "inbound" &&
            metadata.dispatchStatus === "sent" &&
            metadata.agentBotMentioned === true
          ? withBotBindingId(mapping, "integration-evidence-other-bot")
          : mapping;
      }),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.agentBotRouteEvidence, 0);
  assert.equal(item?.nativeExperience.boundUserMentionEvidence, 0);
  assert.equal(item?.nativeExperience.externalGuestMentionEvidence, 0);
  assert.ok(item?.issues.includes("agent_bot_route_evidence_missing"));
  assert.ok(item?.issues.includes("bound_user_bot_mention_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_bot_mention_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("integration-evidence-other-bot"), false);
});

test("Feishu evidence report requires bound user bot mentions to carry actorUserId without raw Feishu identity", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "native",
    messageMappingsByIntegrationId: {
      "integration-evidence": complete.messageMappingsByIntegrationId["integration-evidence"].map((mapping) => {
        const metadataSource = mapping as { direction?: string; metadataJson?: string };
        const metadata = JSON.parse(metadataSource.metadataJson ?? "{}") as Record<string, unknown>;
        return metadataSource.direction === "inbound" && metadata.actorType === "user"
          ? withMetadataFields(withoutMetadataField(mapping, "actorUserId"), {
            open_id: "ou_secret_bound_user",
          })
          : mapping;
      }),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.ok((item?.nativeExperience.agentBotRouteEvidence ?? 0) > 0);
  assert.equal(item?.nativeExperience.boundUserMentionEvidence, 0);
  assert.ok(item?.issues.includes("bound_user_bot_mention_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("ou_secret_bound_user"), false);
});

test("Feishu evidence report requires thread continuation without re-mentioning the bot", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "native",
    messageMappingsByIntegrationId: {
      "integration-evidence": complete.messageMappingsByIntegrationId["integration-evidence"].map((mapping) => {
        const metadataSource = mapping as { metadataJson?: string };
        const metadata = JSON.parse(metadataSource.metadataJson ?? "{}") as Record<string, unknown>;
        return metadata.threadContinuation === true
          ? withAgentBotMentioned(mapping, true)
          : mapping;
      }),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.threadContinuationEvidence, 0);
  assert.ok(item?.issues.includes("thread_continuation_evidence_missing"));
});

test("Feishu evidence report requires thread continuation to reference the active thread binding", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "native",
    threadBindingsByIntegrationId: {
      "integration-evidence": [
        buildThreadBinding("integration-evidence", {
          id: "thread-integration-evidence-other",
          taskQueueId: "task-thread-continuation",
          agentSpaceMessageId: "message-thread-continuation-source",
        }),
        buildThreadBinding("integration-evidence", {
          id: "thread-integration-evidence-hermes",
          agentId: "HermesAgent",
          botBindingId: "integration-evidence",
          threadCollaboration: true,
          collaboratingAgentIds: ["Atlas"],
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.threadTaskBindings, 2);
  assert.equal(item?.nativeExperience.threadContinuationEvidence, 0);
  assert.equal(item?.nativeExperience.threadCollaborationEvidence, 1);
  assert.ok(item?.issues.includes("thread_continuation_evidence_missing"));
});

test("Feishu evidence report requires thread collaboration with a different agent", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "native",
    threadBindingsByIntegrationId: {
      "integration-evidence": [
        buildThreadBinding("integration-evidence", {
          taskQueueId: "task-thread-continuation",
          agentSpaceMessageId: "message-thread-continuation-source",
        }),
        buildThreadBinding("integration-evidence", {
          id: "thread-integration-evidence-hermes",
          agentId: "HermesAgent",
          botBindingId: "integration-evidence",
          threadCollaboration: true,
          collaboratingAgentIds: ["HermesAgent", " "],
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.threadTaskBindings, 2);
  assert.equal(item?.nativeExperience.threadCollaborationEvidence, 0);
  assert.ok(item?.issues.includes("thread_collaboration_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("om_secret"), false);
});

test("Feishu evidence report requires thread collaboration with a different bot binding", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "native",
    threadBindingsByIntegrationId: {
      "integration-evidence": [
        buildThreadBinding("integration-evidence", {
          taskQueueId: "task-thread-continuation",
          agentSpaceMessageId: "message-thread-continuation-source",
        }),
        buildThreadBinding("integration-evidence", {
          id: "thread-integration-evidence-hermes",
          agentId: "HermesAgent",
          botBindingId: "integration-evidence",
          threadCollaboration: true,
          collaboratingAgentIds: ["Atlas"],
          collaboratingBotBindingIds: ["integration-evidence", " "],
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.threadTaskBindings, 2);
  assert.equal(item?.nativeExperience.threadCollaborationEvidence, 0);
  assert.ok(item?.issues.includes("thread_collaboration_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("om_secret"), false);
});

test("Feishu evidence report requires a sent thread collaboration card", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "native",
    outboxByIntegrationId: {
      "integration-evidence": [
        buildOutboxItem("integration-evidence", "sent"),
        buildIdentityBindingNoticeOutboxItem("integration-evidence"),
        buildThreadCollaborationCardOutboxItem("integration-evidence", {
          agentId: "HermesAgent",
          botBindingId: "integration-evidence",
          collaboratingAgentIds: ["Atlas"],
          collaboratingBotBindingIds: ["integration-evidence-atlas"],
          status: "pending",
        }),
        buildOutboxItem("integration-evidence", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.threadCollaborationEvidence, 1);
  assert.equal(item?.nativeExperience.threadCollaborationCardEvidence, 0);
  assert.ok(item?.issues.includes("thread_collaboration_card_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("om_secret"), false);
});

test("Feishu evidence report requires a thread collaboration card to match the active binding", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "native",
    outboxByIntegrationId: {
      "integration-evidence": [
        buildOutboxItem("integration-evidence", "sent"),
        buildIdentityBindingNoticeOutboxItem("integration-evidence"),
        buildThreadCollaborationCardOutboxItem("integration-evidence", {
          agentId: "HermesAgent",
          botBindingId: "integration-evidence",
          collaboratingAgentIds: ["Atlas"],
          collaboratingBotBindingIds: ["integration-evidence-atlas"],
          externalThreadReference: "other-thread-ref-hash",
        }),
        buildOutboxItem("integration-evidence", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.threadCollaborationEvidence, 1);
  assert.equal(item?.nativeExperience.threadCollaborationCardEvidence, 0);
  assert.ok(item?.issues.includes("thread_collaboration_card_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("om_secret"), false);
});

test("Feishu evidence report requires thread evidence to avoid raw Feishu ids", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "native",
    messageMappingsByIntegrationId: {
      "integration-evidence": complete.messageMappingsByIntegrationId["integration-evidence"].map((mapping) => {
        const metadataSource = mapping as { metadataJson?: string };
        const metadata = JSON.parse(metadataSource.metadataJson ?? "{}") as Record<string, unknown>;
        return metadata.threadContinuation === true
          ? withMetadataFields(mapping, {
            thread_id: "om_secret_thread_continuation_raw",
            open_id: "ou_secret_thread_continuation_raw",
          })
          : mapping;
      }),
    },
    threadBindingsByIntegrationId: {
      "integration-evidence": complete.threadBindingsByIntegrationId["integration-evidence"].map((binding) =>
        withMetadataFields(binding, {
          externalChatId: "oc_secret_thread_binding_raw",
          providerOpenId: "ou_secret_thread_binding_raw",
        })
      ),
    },
    outboxByIntegrationId: {
      "integration-evidence": complete.outboxByIntegrationId["integration-evidence"].map((item) => {
        const metadataSource = item as { metadataJson?: string };
        const metadata = JSON.parse(metadataSource.metadataJson ?? "{}") as Record<string, unknown>;
        return metadata.noticeType === "thread_collaboration"
          ? withMetadataFields(item, {
            target_external_thread_id: "om_secret_thread_card_raw",
            provider_open_id: "ou_secret_thread_card_raw",
          })
          : item;
      }),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.threadTaskBindings, 0);
  assert.equal(item?.nativeExperience.threadContinuationEvidence, 0);
  assert.equal(item?.nativeExperience.threadCollaborationEvidence, 0);
  assert.equal(item?.nativeExperience.threadCollaborationCardEvidence, 0);
  assert.ok(item?.issues.includes("thread_task_binding_evidence_missing"));
  assert.ok(item?.issues.includes("thread_continuation_evidence_missing"));
  assert.ok(item?.issues.includes("thread_collaboration_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("om_secret_thread_continuation_raw"), false);
  assert.equal(JSON.stringify(report).includes("ou_secret_thread_continuation_raw"), false);
  assert.equal(JSON.stringify(report).includes("oc_secret_thread_binding_raw"), false);
  assert.equal(JSON.stringify(report).includes("ou_secret_thread_binding_raw"), false);
  assert.equal(JSON.stringify(report).includes("om_secret_thread_card_raw"), false);
  assert.equal(JSON.stringify(report).includes("ou_secret_thread_card_raw"), false);
});

test("Feishu evidence report requires thread collaboration cards to avoid raw Feishu ids", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "native",
    outboxByIntegrationId: {
      "integration-evidence": complete.outboxByIntegrationId["integration-evidence"].map((item) => {
        const metadataSource = item as { metadataJson?: string };
        const metadata = JSON.parse(metadataSource.metadataJson ?? "{}") as Record<string, unknown>;
        return metadata.noticeType === "thread_collaboration"
          ? withMetadataFields(item, {
            target_external_thread_id: "om_secret_thread_card_raw",
            provider_open_id: "ou_secret_thread_card_raw",
          })
          : item;
      }),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.threadCollaborationEvidence, 1);
  assert.equal(item?.nativeExperience.threadCollaborationCardEvidence, 0);
  assert.ok(item?.issues.includes("thread_collaboration_card_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("om_secret_thread_card_raw"), false);
  assert.equal(JSON.stringify(report).includes("ou_secret_thread_card_raw"), false);
});

test("Feishu evidence report requires thread metadata to avoid embedded raw ids", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "native",
    threadBindingsByIntegrationId: {
      "integration-evidence": complete.threadBindingsByIntegrationId["integration-evidence"].map((binding) =>
        withMetadataFields(binding, {
          debugPayload: "thread chat oc_secret_thread_debug",
          debugResource: "doccn_secret_thread_resource",
        })
      ),
    },
    outboxByIntegrationId: {
      "integration-evidence": complete.outboxByIntegrationId["integration-evidence"].map((item) => {
        const metadataSource = item as { metadataJson?: string };
        const metadata = JSON.parse(metadataSource.metadataJson ?? "{}") as Record<string, unknown>;
        return metadata.noticeType === "thread_collaboration"
          ? withMetadataFields(item, {
            debugPayload: "thread card om_secret_thread_card_debug",
            debugResource: "tbl_secret_thread_card_resource",
          })
          : item;
      }),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.threadTaskBindings, 0);
  assert.equal(item?.nativeExperience.threadContinuationEvidence, 0);
  assert.equal(item?.nativeExperience.threadCollaborationEvidence, 0);
  assert.equal(item?.nativeExperience.threadCollaborationCardEvidence, 0);
  assert.ok(item?.issues.includes("thread_task_binding_evidence_missing"));
  assert.ok(item?.issues.includes("thread_continuation_evidence_missing"));
  assert.ok(item?.issues.includes("thread_collaboration_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("oc_secret_thread_debug"), false);
  assert.equal(JSON.stringify(report).includes("doccn_secret_thread_resource"), false);
  assert.equal(JSON.stringify(report).includes("om_secret_thread_card_debug"), false);
  assert.equal(JSON.stringify(report).includes("tbl_secret_thread_card_resource"), false);
});

test("Feishu evidence report requires channel reuse from a different agent bot", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "native",
    channelBindingsByIntegrationId: {
      "integration-evidence": [
        buildAutoProvisionedChannelBinding("integration-evidence", "first_message"),
        buildAutoProvisionedChannelBinding("integration-evidence", "bot_added", {
          agentId: "HermesAgent",
          botBindingId: "integration-evidence",
          linkedFromBindingId: "channel-hermes-binding",
          linkedFromAgentId: "HermesAgent",
          linkedFromBotBindingId: "integration-evidence",
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.autoProvisionedChannelBindings, 2);
  assert.equal(item?.nativeExperience.botAddedAutoProvisionedChannelBindings, 1);
  assert.equal(item?.nativeExperience.reusedProviderChannelBindings, 0);
  assert.ok(item?.issues.includes("multi_agent_channel_reuse_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("oc_secret"), false);
});

test("Feishu evidence report requires auto-provision bot binding to match the channel binding", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "native",
    channelBindingsByIntegrationId: {
      "integration-evidence": [
        buildAutoProvisionedChannelBinding("integration-evidence", "first_message", {
          botBindingId: "integration-evidence-other",
        }),
        buildAutoProvisionedChannelBinding("integration-evidence", "bot_added", {
          agentId: "HermesAgent",
          botBindingId: "integration-evidence-hermes",
          linkedFromBindingId: "channel-atlas-binding",
          linkedFromAgentId: "Atlas",
          linkedFromBotBindingId: "integration-evidence-atlas",
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.autoProvisionedChannelBindings, 0);
  assert.equal(item?.nativeExperience.botAddedAutoProvisionedChannelBindings, 0);
  assert.equal(item?.nativeExperience.firstMessageAutoProvisionedChannelBindings, 0);
  assert.equal(item?.nativeExperience.reusedProviderChannelBindings, 0);
  assert.ok(item?.issues.includes("channel_auto_provision_evidence_missing"));
  assert.ok(item?.issues.includes("bot_added_auto_provision_evidence_missing"));
  assert.ok(item?.issues.includes("first_message_auto_provision_evidence_missing"));
  assert.ok(item?.issues.includes("multi_agent_channel_reuse_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("oc_secret"), false);
});

test("Feishu evidence report requires auto-provisioned channel identity and review state", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "native",
    channelBindingsByIntegrationId: {
      "integration-evidence": [
        buildAutoProvisionedChannelBinding("integration-evidence", "first_message", {
          reviewStatus: "",
        }),
        buildAutoProvisionedChannelBinding("integration-evidence", "bot_added", {
          agentId: "HermesAgent",
          botBindingId: "integration-evidence-hermes",
          linkedFromBindingId: "channel-atlas-binding",
          linkedFromAgentId: "Atlas",
          linkedFromBotBindingId: "integration-evidence-atlas",
          channelName: "",
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.autoProvisionedChannelBindings, 0);
  assert.equal(item?.nativeExperience.botAddedAutoProvisionedChannelBindings, 0);
  assert.equal(item?.nativeExperience.firstMessageAutoProvisionedChannelBindings, 0);
  assert.equal(item?.nativeExperience.reusedProviderChannelBindings, 0);
  assert.ok(item?.issues.includes("channel_auto_provision_evidence_missing"));
  assert.ok(item?.issues.includes("bot_added_auto_provision_evidence_missing"));
  assert.ok(item?.issues.includes("first_message_auto_provision_evidence_missing"));
  assert.ok(item?.issues.includes("multi_agent_channel_reuse_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("oc_secret"), false);
});

test("Feishu evidence report requires auto-provision metadata to avoid raw Feishu ids", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "native",
    channelBindingsByIntegrationId: {
      "integration-evidence": [
        withMetadataFields(buildAutoProvisionedChannelBinding("integration-evidence", "first_message"), {
          chat_id: "oc_secret_first_message_raw",
          open_id: "ou_secret_first_message_raw",
        }),
        withMetadataFields(buildAutoProvisionedChannelBinding("integration-evidence", "bot_added", {
          agentId: "HermesAgent",
          botBindingId: "integration-evidence-hermes",
          linkedFromBindingId: "channel-atlas-binding",
          linkedFromAgentId: "Atlas",
          linkedFromBotBindingId: "integration-evidence-atlas",
        }), {
          externalChatId: "oc_secret_bot_added_raw",
          providerOpenId: "ou_secret_bot_added_raw",
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.autoProvisionedChannelBindings, 0);
  assert.equal(item?.nativeExperience.botAddedAutoProvisionedChannelBindings, 0);
  assert.equal(item?.nativeExperience.firstMessageAutoProvisionedChannelBindings, 0);
  assert.equal(item?.nativeExperience.reusedProviderChannelBindings, 0);
  assert.ok(item?.issues.includes("channel_auto_provision_evidence_missing"));
  assert.ok(item?.issues.includes("bot_added_auto_provision_evidence_missing"));
  assert.ok(item?.issues.includes("first_message_auto_provision_evidence_missing"));
  assert.ok(item?.issues.includes("multi_agent_channel_reuse_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("oc_secret_first_message_raw"), false);
  assert.equal(JSON.stringify(report).includes("ou_secret_first_message_raw"), false);
  assert.equal(JSON.stringify(report).includes("oc_secret_bot_added_raw"), false);
  assert.equal(JSON.stringify(report).includes("ou_secret_bot_added_raw"), false);
});

test("Feishu evidence report requires auto-provision metadata to avoid embedded raw ids", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "native",
    channelBindingsByIntegrationId: {
      "integration-evidence": [
        withMetadataFields(buildAutoProvisionedChannelBinding("integration-evidence", "first_message"), {
          debugPayload: "first message chat oc_secret_first_message_debug",
          debugResource: "doccn_secret_first_message_resource",
        }),
        withMetadataFields(buildAutoProvisionedChannelBinding("integration-evidence", "bot_added", {
          agentId: "HermesAgent",
          botBindingId: "integration-evidence-hermes",
          linkedFromBindingId: "channel-atlas-binding",
          linkedFromAgentId: "Atlas",
          linkedFromBotBindingId: "integration-evidence-atlas",
        }), {
          debugPayload: "bot added chat oc_secret_bot_added_debug",
          debugResource: "tbl_secret_bot_added_resource",
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.autoProvisionedChannelBindings, 0);
  assert.equal(item?.nativeExperience.botAddedAutoProvisionedChannelBindings, 0);
  assert.equal(item?.nativeExperience.firstMessageAutoProvisionedChannelBindings, 0);
  assert.equal(item?.nativeExperience.reusedProviderChannelBindings, 0);
  assert.ok(item?.issues.includes("channel_auto_provision_evidence_missing"));
  assert.ok(item?.issues.includes("bot_added_auto_provision_evidence_missing"));
  assert.ok(item?.issues.includes("first_message_auto_provision_evidence_missing"));
  assert.ok(item?.issues.includes("multi_agent_channel_reuse_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("oc_secret_first_message_debug"), false);
  assert.equal(JSON.stringify(report).includes("doccn_secret_first_message_resource"), false);
  assert.equal(JSON.stringify(report).includes("oc_secret_bot_added_debug"), false);
  assert.equal(JSON.stringify(report).includes("tbl_secret_bot_added_resource"), false);
});

test("Feishu evidence report requires channel reuse to link a different binding record", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "native",
    channelBindingsByIntegrationId: {
      "integration-evidence": [
        buildAutoProvisionedChannelBinding("integration-evidence", "first_message"),
        buildAutoProvisionedChannelBinding("integration-evidence", "bot_added", {
          agentId: "HermesAgent",
          botBindingId: "integration-evidence",
          linkedFromBindingId: "channel-integration-evidence",
          linkedFromAgentId: "Atlas",
          linkedFromBotBindingId: "integration-evidence-atlas",
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.autoProvisionedChannelBindings, 2);
  assert.equal(item?.nativeExperience.botAddedAutoProvisionedChannelBindings, 1);
  assert.equal(item?.nativeExperience.firstMessageAutoProvisionedChannelBindings, 1);
  assert.equal(item?.nativeExperience.reusedProviderChannelBindings, 0);
  assert.ok(item?.issues.includes("multi_agent_channel_reuse_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("oc_secret"), false);
});

test("Feishu evidence report rejects external guest message proof with user identity", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "native",
    messageMappingsByIntegrationId: {
      "integration-evidence": complete.messageMappingsByIntegrationId["integration-evidence"].map((mapping) =>
        withExternalGuestUserIdentity(mapping)
      ),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.nativeExperience.externalGuestMentionEvidence, 0);
  assert.ok(item?.issues.includes("external_guest_bot_mention_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("ou_secret"), false);
});

test("Feishu evidence report requires external guest proof to show no workspace member was created", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const promotedMappings = complete.messageMappingsByIntegrationId["integration-evidence"].map((mapping) => {
    const metadataSource = mapping as { metadataJson?: string };
    const metadata = JSON.parse(metadataSource.metadataJson ?? "{}") as Record<string, unknown>;
    return metadata.actorType === "external_guest"
      ? withMetadataFields(mapping, { workspaceMemberCreated: true })
      : mapping;
  });

  const nativeReport = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "native",
    messageMappingsByIntegrationId: {
      "integration-evidence": promotedMappings,
    },
  });

  assert.equal(nativeReport.strictSatisfied, false);
  const [nativeItem] = nativeReport.integrations;
  assert.equal(nativeItem?.nativeExperience.externalGuestMentionEvidence, 0);
  assert.ok(nativeItem?.issues.includes("external_guest_bot_mention_evidence_missing"));

  const guestPolicyReport = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "guest-policy",
    messageMappingsByIntegrationId: {
      "integration-evidence": promotedMappings,
    },
  });

  assert.equal(guestPolicyReport.strictSatisfied, false);
  const [guestPolicyItem] = guestPolicyReport.integrations;
  assert.equal(guestPolicyItem?.guestPolicy.externalGuestAllowedEvidence, 0);
  assert.equal(guestPolicyItem?.guestPolicy.externalGuestReplyAllEvidence, 0);
  assert.equal(guestPolicyItem?.guestPolicy.externalGuestRequireIdentityEvidence, 0);
  assert.ok(guestPolicyItem?.issues.includes("external_guest_policy_allow_evidence_missing"));
  assert.ok(guestPolicyItem?.issues.includes("external_guest_policy_reply_all_evidence_missing"));
  assert.ok(guestPolicyItem?.issues.includes("external_guest_policy_require_identity_evidence_missing"));
});

test("Feishu evidence report gates external guest policy proof", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "guest-policy",
    messageMappingsByIntegrationId: {
      "integration-evidence": [
        buildMessageMapping("integration-evidence", "inbound", "om_secret_inbound"),
        buildMessageMapping("integration-evidence", "outbound", "om_secret_reply", "om_secret_inbound"),
        buildMessageMapping("integration-evidence", "inbound", "om_secret_restart_inbound", undefined, {
          actorType: "external_guest",
          externalGuestPolicyDecision: "allow",
        }),
        buildExternalGuestReplyAllMapping("integration-evidence"),
        buildMessageMapping("integration-evidence", "outbound", "om_secret_restart_reply", "om_secret_restart_inbound"),
        buildAgentChannelPolicyDeniedMapping("integration-evidence"),
        buildBotSenderLoopGuardMapping("integration-evidence"),
        buildThreadContinuationMapping("integration-evidence"),
        buildPolicyBlockedMessageMapping("integration-evidence", {
          externalMessageId: "om_secret_guest_require_identity",
          decision: "require_identity",
          reasonCode: "feishu_external_guest_identity_required",
          unboundUserMode: "require_identity",
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.botSatisfiedCount, 1);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 1);
  assert.equal(report.summary.guestPolicySatisfiedCount, 0);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 1);
  const [item] = report.integrations;
  assert.equal(item?.guestPolicy.externalGuestAllowedEvidence, 1);
  assert.equal(item?.guestPolicy.externalGuestReplyAllEvidence, 1);
  assert.equal(item?.guestPolicy.externalGuestRequireIdentityEvidence, 1);
  assert.equal(item?.guestPolicy.externalGuestIgnoreEvidence, 0);
  assert.equal(item?.guestPolicy.externalGuestMentionRequiredEvidence, 0);
  assert.ok(item?.issues.includes("external_guest_policy_ignore_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_policy_mention_required_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("om_secret_guest_require_identity"), false);
  assert.equal(JSON.stringify(report).includes("ou_secret"), false);
});

test("Feishu evidence report requires external guest allow proof from reply_on_mention direct bot mention", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "guest-policy",
    messageMappingsByIntegrationId: {
      "integration-evidence": complete.messageMappingsByIntegrationId["integration-evidence"].map((mapping) => {
        const metadataSource = mapping as { externalMessageId?: string };
        if (metadataSource.externalMessageId !== "om_secret_restart_inbound") {
          return mapping;
        }
        return withAgentBotMentioned(mapping, false);
      }),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.guestPolicySatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.guestPolicy.externalGuestAllowedEvidence, 0);
  assert.equal(item?.guestPolicy.externalGuestReplyAllEvidence, 1);
  assert.ok(item?.issues.includes("external_guest_policy_allow_evidence_missing"));
});

test("Feishu evidence report requires external guest dispatch permission profile to be channel_context_only", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const weakenedMappings = complete.messageMappingsByIntegrationId["integration-evidence"].map((mapping) => {
    const metadataSource = mapping as { externalMessageId?: string };
    if (
      metadataSource.externalMessageId !== "om_secret_restart_inbound" &&
      metadataSource.externalMessageId !== "om_secret_guest_reply_all"
    ) {
      return mapping;
    }
    return withMetadataFields(mapping, { externalGuestPermissionProfile: "channel_readonly" });
  });

  const nativeReport = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "native",
    messageMappingsByIntegrationId: {
      "integration-evidence": weakenedMappings,
    },
  });

  assert.equal(nativeReport.strictSatisfied, false);
  const [nativeItem] = nativeReport.integrations;
  assert.equal(nativeItem?.nativeExperience.externalGuestMentionEvidence, 0);
  assert.ok(nativeItem?.issues.includes("external_guest_bot_mention_evidence_missing"));

  const guestPolicyReport = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "guest-policy",
    messageMappingsByIntegrationId: {
      "integration-evidence": weakenedMappings,
    },
  });

  assert.equal(guestPolicyReport.strictSatisfied, false);
  const [guestPolicyItem] = guestPolicyReport.integrations;
  assert.equal(guestPolicyItem?.guestPolicy.externalGuestAllowedEvidence, 0);
  assert.equal(guestPolicyItem?.guestPolicy.externalGuestReplyAllEvidence, 0);
  assert.ok(guestPolicyItem?.issues.includes("external_guest_policy_allow_evidence_missing"));
  assert.ok(guestPolicyItem?.issues.includes("external_guest_policy_reply_all_evidence_missing"));
});

test("Feishu evidence report requires external guest policy inbound evidence to avoid raw Feishu ids", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "guest-policy",
    messageMappingsByIntegrationId: {
      "integration-evidence": complete.messageMappingsByIntegrationId["integration-evidence"].map((mapping) => {
        const metadataSource = mapping as { metadataJson?: string };
        const metadata = JSON.parse(metadataSource.metadataJson ?? "{}") as Record<string, unknown>;
        return metadata.actorType === "external_guest" && typeof metadata.externalGuestPolicyDecision === "string"
          ? withMetadataFields(mapping, {
            external_chat_id: "oc_secret_guest_policy_raw",
            provider_open_id: "ou_secret_guest_policy_raw",
          })
          : mapping;
      }),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.guestPolicySatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.guestPolicy.externalGuestAllowedEvidence, 0);
  assert.equal(item?.guestPolicy.externalGuestReplyAllEvidence, 0);
  assert.equal(item?.guestPolicy.externalGuestRequireIdentityEvidence, 0);
  assert.equal(item?.guestPolicy.externalGuestIdentityBindingNoticeEvidence, 0);
  assert.equal(item?.guestPolicy.externalGuestIgnoreEvidence, 0);
  assert.equal(item?.guestPolicy.externalGuestMentionRequiredEvidence, 0);
  assert.ok(item?.issues.includes("external_guest_policy_allow_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_policy_reply_all_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_policy_require_identity_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_identity_binding_notice_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_policy_ignore_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_policy_mention_required_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("oc_secret_guest_policy_raw"), false);
  assert.equal(JSON.stringify(report).includes("ou_secret_guest_policy_raw"), false);
});

test("Feishu evidence report requires external guest policy bot binding to match the mapping integration", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "guest-policy",
    messageMappingsByIntegrationId: {
      "integration-evidence": complete.messageMappingsByIntegrationId["integration-evidence"].map((mapping) => {
        const metadataSource = mapping as { metadataJson?: string };
        const metadata = JSON.parse(metadataSource.metadataJson ?? "{}") as Record<string, unknown>;
        return metadata.actorType === "external_guest" && typeof metadata.externalGuestPolicyDecision === "string"
          ? withBotBindingId(mapping, "integration-evidence-other-bot")
          : mapping;
      }),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.guestPolicySatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.guestPolicy.externalGuestAllowedEvidence, 0);
  assert.equal(item?.guestPolicy.externalGuestReplyAllEvidence, 0);
  assert.equal(item?.guestPolicy.externalGuestRequireIdentityEvidence, 0);
  assert.equal(item?.guestPolicy.externalGuestIdentityBindingNoticeEvidence, 0);
  assert.equal(item?.guestPolicy.externalGuestIgnoreEvidence, 0);
  assert.equal(item?.guestPolicy.externalGuestMentionRequiredEvidence, 0);
  assert.ok(item?.issues.includes("external_guest_policy_allow_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_policy_reply_all_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_policy_require_identity_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_identity_binding_notice_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_policy_ignore_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_policy_mention_required_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("integration-evidence-other-bot"), false);
});

test("Feishu evidence report requires blocked guest policies without dispatch or replies", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "guest-policy",
    messageMappingsByIntegrationId: {
      "integration-evidence": [
        buildMessageMapping("integration-evidence", "inbound", "om_secret_inbound"),
        buildMessageMapping("integration-evidence", "outbound", "om_secret_reply", "om_secret_inbound"),
        buildMessageMapping("integration-evidence", "inbound", "om_secret_restart_inbound", undefined, {
          actorType: "external_guest",
          externalGuestPolicyDecision: "allow",
        }),
        buildExternalGuestReplyAllMapping("integration-evidence"),
        buildMessageMapping("integration-evidence", "outbound", "om_secret_restart_reply", "om_secret_restart_inbound"),
        withDispatchEvidence(buildPolicyBlockedMessageMapping("integration-evidence", {
          externalMessageId: "om_secret_guest_require_identity",
          decision: "require_identity",
          reasonCode: "feishu_external_guest_identity_required",
          unboundUserMode: "require_identity",
        })),
        buildPolicyBlockedMessageMapping("integration-evidence", {
          externalMessageId: "om_secret_guest_ignored",
          decision: "ignore",
          reasonCode: "feishu_external_guest_ignored",
          unboundUserMode: "ignore",
        }),
        buildMessageMapping("integration-evidence", "outbound", "om_secret_guest_ignored_reply", "om_secret_guest_ignored"),
        buildPolicyBlockedMessageMapping("integration-evidence", {
          externalMessageId: "om_secret_guest_unmentioned",
          decision: "ignore",
          reasonCode: "feishu_external_guest_bot_mention_required",
          unboundUserMode: "reply_on_mention",
        }),
        buildMessageMapping(
          "integration-evidence",
          "outbound",
          "om_secret_guest_unmentioned_reply",
          "om_secret_guest_unmentioned",
        ),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.guestPolicySatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.guestPolicy.externalGuestAllowedEvidence, 1);
  assert.equal(item?.guestPolicy.externalGuestReplyAllEvidence, 1);
  assert.equal(item?.guestPolicy.externalGuestRequireIdentityEvidence, 0);
  assert.equal(item?.guestPolicy.externalGuestIdentityBindingNoticeEvidence, 0);
  assert.equal(item?.guestPolicy.externalGuestIgnoreEvidence, 0);
  assert.equal(item?.guestPolicy.externalGuestMentionRequiredEvidence, 0);
  assert.ok(item?.issues.includes("external_guest_policy_require_identity_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_identity_binding_notice_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_policy_ignore_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_policy_mention_required_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("om_secret_guest_ignored"), false);
});

test("Feishu evidence report requires ignore policy proof to use no guest permissions", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "guest-policy",
    messageMappingsByIntegrationId: {
      "integration-evidence": complete.messageMappingsByIntegrationId["integration-evidence"].map((mapping) => {
        const metadataSource = mapping as { externalMessageId?: string };
        if (metadataSource.externalMessageId !== "om_secret_guest_ignored") {
          return mapping;
        }
        return withMetadataFields(mapping, { externalGuestPermissionProfile: "channel_context_only" });
      }),
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.guestPolicySatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.guestPolicy.externalGuestIgnoreEvidence, 0);
  assert.equal(item?.guestPolicy.externalGuestMentionRequiredEvidence, 1);
  assert.ok(item?.issues.includes("external_guest_policy_ignore_evidence_missing"));
});

test("Feishu evidence report requires a sent identity binding notice for require_identity", () => {
  const complete = buildCompleteFeishuEvidenceInput();
  const report = buildFeishuEvidenceReport({
    ...complete,
    requiredEvidence: "guest-policy",
    outboxByIntegrationId: {
      "integration-evidence": [
        buildOutboxItem("integration-evidence", "sent"),
        buildIdentityBindingNoticeOutboxItem("integration-evidence", "pending"),
        buildOutboxItem("integration-evidence", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.guestPolicySatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.guestPolicy.externalGuestRequireIdentityEvidence, 1);
  assert.equal(item?.guestPolicy.externalGuestIdentityBindingNoticeEvidence, 0);
  assert.ok(item?.issues.includes("external_guest_identity_binding_notice_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("om_secret_guest_require_identity"), false);
});

test("Feishu evidence report requires identity binding notices to be sent to the source thread", () => {
  const wrongThreadNotice = {
    ...(buildIdentityBindingNoticeOutboxItem("integration-evidence") as Record<string, unknown>),
    id: "sent-integration-evidence-identity-binding-notice-wrong-thread",
    targetExternalThreadId: "om_secret_wrong_thread",
  } as never;
  const missingSentAtNotice = {
    ...(buildIdentityBindingNoticeOutboxItem("integration-evidence") as Record<string, unknown>),
    id: "sent-integration-evidence-identity-binding-notice-without-sent-at",
    sentAt: undefined,
  } as never;
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "guest-policy",
    outboxByIntegrationId: {
      "integration-evidence": [
        buildOutboxItem("integration-evidence", "sent"),
        wrongThreadNotice,
        missingSentAtNotice,
        buildOutboxItem("integration-evidence", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.guestPolicySatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.guestPolicy.externalGuestRequireIdentityEvidence, 1);
  assert.equal(item?.guestPolicy.externalGuestIdentityBindingNoticeEvidence, 0);
  assert.ok(item?.issues.includes("external_guest_identity_binding_notice_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("om_secret_wrong_thread"), false);
});

test("Feishu evidence report requires identity binding notices to carry safe guest context", () => {
  const missingGuestReferenceNotice = withoutMetadataField({
    ...(buildIdentityBindingNoticeOutboxItem("integration-evidence") as Record<string, unknown>),
    id: "sent-integration-evidence-identity-binding-notice-missing-guest-reference",
  } as never, "externalGuestReference");
  const wrongPermissionProfileNotice = withMetadataFields({
    ...(buildIdentityBindingNoticeOutboxItem("integration-evidence") as Record<string, unknown>),
    id: "sent-integration-evidence-identity-binding-notice-wrong-profile",
  } as never, { externalGuestPermissionProfile: "channel_context_only" });
  const rawUserIdentityNotice = withMetadataFields({
    ...(buildIdentityBindingNoticeOutboxItem("integration-evidence") as Record<string, unknown>),
    id: "sent-integration-evidence-identity-binding-notice-raw-user",
  } as never, { openId: "ou_secret_notice" });
  const rawTargetLocationNotice = withMetadataFields({
    ...(buildIdentityBindingNoticeOutboxItem("integration-evidence") as Record<string, unknown>),
    id: "sent-integration-evidence-identity-binding-notice-raw-target",
  } as never, {
    external_chat_id: "oc_secret_notice",
    target_external_thread_id: "om_secret_notice",
  });
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    requiredEvidence: "guest-policy",
    outboxByIntegrationId: {
      "integration-evidence": [
        buildOutboxItem("integration-evidence", "sent"),
        missingGuestReferenceNotice,
        wrongPermissionProfileNotice,
        rawUserIdentityNotice,
        rawTargetLocationNotice,
        buildOutboxItem("integration-evidence", "failed"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.guestPolicySatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.guestPolicy.externalGuestRequireIdentityEvidence, 1);
  assert.equal(item?.guestPolicy.externalGuestIdentityBindingNoticeEvidence, 0);
  assert.ok(item?.issues.includes("external_guest_identity_binding_notice_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("ou_secret_notice"), false);
  assert.equal(JSON.stringify(report).includes("oc_secret_notice"), false);
  assert.equal(JSON.stringify(report).includes("om_secret_notice"), false);
});

test("Feishu evidence report can gate on redacted OpenAPI live smoke evidence", () => {
  const complete = withSecondActiveFeishuAgentBotEvidence(buildCompleteFeishuEvidenceInput());
  const report = buildFeishuEvidenceReport({
    ...complete,
    openApiEvidencePath: "runtime-output/feishu-smoke/live.json",
    openApiEvidence: buildOpenApiEvidenceFixture(),
  });

  assert.equal(report.strictSatisfied, true);
  assert.equal(report.summary.workspaceAllSatisfied, true);
  assert.equal(report.summary.scopedAllSatisfied, true);
  assert.equal(report.openApiEvidence?.present, true);
  assert.equal(report.openApiEvidence?.valid, true);
  assert.deepEqual(report.openApiEvidence?.issues, []);
  assert.deepEqual(report.openApiEvidence?.remediationSteps, []);
  assert.equal(report.openApiEvidence?.summary?.liveChecks, 12);
  assert.equal(report.openApiEvidence?.summary?.requiredLiveSteps, 12);
  assert.equal(report.openApiEvidence?.summary?.destructiveLiveChecks, 3);
  assert.equal(report.openApiEvidence?.summary?.appIdentityPresent, true);
  assert.equal(report.openApiEvidence?.summary?.appIdHashPresent, true);
  assert.equal(report.openApiEvidence?.summary?.appIdentityMatched, true);
  assert.equal(report.openApiEvidence?.summary?.tenantKeyMatched, true);
  assert.equal(report.openApiEvidence?.summary?.todo120NativeSmokeReady, true);
  assert.equal(report.openApiEvidence?.summary?.todo120NativeSmokeRequiredForCommand, true);
  assert.equal(report.openApiEvidence?.summary?.todo120NativeSmokeRequired, 2);
  assert.equal(report.openApiEvidence?.summary?.todo120NativeSmokeConfigured, 2);
  assert.equal(report.openApiEvidence?.summary?.todo120NativeSmokeSecondAgentAppIdHashPresent, true);
  assert.equal(report.botAddedPayloadEvidence?.present, true);
  assert.equal(report.botAddedPayloadEvidence?.valid, true);
  assert.deepEqual(report.botAddedPayloadEvidence?.issues, []);
  assert.deepEqual(report.botAddedPayloadEvidence?.remediationSteps, []);
  assert.equal(report.botAddedPayloadEvidence?.summary?.botAddedEvent, true);
  assert.equal(report.botAddedPayloadEvidence?.summary?.appIdPresent, true);
  assert.equal(report.botAddedPayloadEvidence?.summary?.appIdHashPresent, true);
  assert.equal(report.botAddedPayloadEvidence?.summary?.appIdentityMatched, true);
  assert.equal(report.botAddedPayloadEvidence?.summary?.tenantKeyMatched, true);
  assert.equal(report.botAddedPayloadEvidence?.summary?.chatReference, FEISHU_TEST_CHAT_REFERENCE);
  assert.equal(report.botAddedPayloadEvidence?.summary?.payloadHashPresent, true);

  const oldEvidence = buildOpenApiEvidenceFixture();
  oldEvidence.steps = oldEvidence.steps.filter((step) => step.name !== "Docs docx append blocks");
  oldEvidence.summary.liveChecks = 11;
  oldEvidence.summary.livePassed = 11;
  oldEvidence.summary.destructiveLiveChecks = 2;
  const oldArtifact = buildFeishuEvidenceReport({
    ...complete,
    openApiEvidence: oldEvidence,
  });

  assert.equal(oldArtifact.strictSatisfied, false);
  assert.equal(oldArtifact.summary.workspaceAllSatisfied, true);
  assert.equal(oldArtifact.summary.scopedAllSatisfied, true);
  assert.equal(oldArtifact.openApiEvidence?.valid, false);
  assert.ok(oldArtifact.openApiEvidence?.issues.includes(
    "openapi_required_step_missing:Docs docx append blocks",
  ));
  assert.ok(oldArtifact.openApiEvidence?.issues.includes("openapi_live_check_summary_incomplete"));
  assert.ok(oldArtifact.openApiEvidence?.issues.includes("openapi_live_passed_summary_incomplete"));
  assert.ok(oldArtifact.openApiEvidence?.issues.includes("openapi_doc_append_not_marked_destructive"));
  assert.ok(oldArtifact.openApiEvidence?.issues.includes("openapi_destructive_live_checks_missing"));
  const [oldArtifactRemediation] = oldArtifact.openApiEvidence?.remediationSteps ?? [];
  assert.equal(oldArtifactRemediation?.stepId, "run_openapi_live_smoke_harness");
  assert.ok(oldArtifactRemediation?.issues.includes(
    "openapi_required_step_missing:Docs docx append blocks",
  ));
  assert.match(oldArtifactRemediation?.command ?? "", /--live --strict-live/);
  assert.match(oldArtifactRemediation?.command ?? "", /--verify-evidence runtime-output\/feishu-smoke\/live\.json/);

  const missingTodo120Evidence = buildOpenApiEvidenceFixture();
  delete (missingTodo120Evidence as Partial<ReturnType<typeof buildOpenApiEvidenceFixture>>).todo120NativeSmoke;
  const missingTodo120 = buildFeishuEvidenceReport({
    ...complete,
    openApiEvidence: missingTodo120Evidence,
  });

  assert.equal(missingTodo120.strictSatisfied, false);
  assert.equal(missingTodo120.openApiEvidence?.valid, false);
  assert.equal(missingTodo120.openApiEvidence?.summary?.todo120NativeSmokeReady, false);
  assert.equal(missingTodo120.openApiEvidence?.summary?.todo120NativeSmokeRequiredForCommand, false);
  assert.equal(missingTodo120.openApiEvidence?.summary?.todo120NativeSmokeRequired, 0);
  assert.equal(missingTodo120.openApiEvidence?.summary?.todo120NativeSmokeConfigured, 0);
  assert.ok(missingTodo120.openApiEvidence?.issues.includes("openapi_todo120_native_smoke_missing"));

  const notRequiredTodo120Evidence = buildOpenApiEvidenceFixture();
  notRequiredTodo120Evidence.todo120NativeSmoke.requiredForCommand = false;
  const notRequiredTodo120 = buildFeishuEvidenceReport({
    ...complete,
    openApiEvidence: notRequiredTodo120Evidence,
  });

  assert.equal(notRequiredTodo120.strictSatisfied, false);
  assert.equal(notRequiredTodo120.openApiEvidence?.valid, false);
  assert.equal(notRequiredTodo120.openApiEvidence?.summary?.todo120NativeSmokeReady, true);
  assert.equal(notRequiredTodo120.openApiEvidence?.summary?.todo120NativeSmokeRequiredForCommand, false);
  assert.equal(notRequiredTodo120.openApiEvidence?.summary?.todo120NativeSmokeRequired, 2);
  assert.equal(notRequiredTodo120.openApiEvidence?.summary?.todo120NativeSmokeConfigured, 2);
  assert.ok(notRequiredTodo120.openApiEvidence?.issues.includes("openapi_todo120_native_smoke_not_required"));

  const missingSecondAppHashEvidence = buildOpenApiEvidenceFixture();
  delete (missingSecondAppHashEvidence.todo120NativeSmoke as { secondAgentAppIdHash?: string }).secondAgentAppIdHash;
  const missingSecondAppHash = buildFeishuEvidenceReport({
    ...complete,
    openApiEvidence: missingSecondAppHashEvidence,
  });

  assert.equal(missingSecondAppHash.strictSatisfied, false);
  assert.equal(missingSecondAppHash.openApiEvidence?.valid, false);
  assert.equal(missingSecondAppHash.openApiEvidence?.summary?.todo120NativeSmokeSecondAgentAppIdHashPresent, false);
  assert.ok(missingSecondAppHash.openApiEvidence?.issues.includes(
    "openapi_todo120_native_smoke_second_app_id_hash_missing",
  ));

  const mismatchedSecondAppHashEvidence = buildOpenApiEvidenceFixture();
  mismatchedSecondAppHashEvidence.todo120NativeSmoke.secondAgentAppIdHash = createHash("sha256")
    .update("cli_unbound_second_bot", "utf8")
    .digest("hex");
  const mismatchedSecondAppHash = buildFeishuEvidenceReport({
    ...complete,
    openApiEvidence: mismatchedSecondAppHashEvidence,
  });

  assert.equal(mismatchedSecondAppHash.strictSatisfied, false);
  assert.equal(mismatchedSecondAppHash.openApiEvidence?.valid, false);
  assert.equal(mismatchedSecondAppHash.openApiEvidence?.summary?.todo120NativeSmokeSecondAgentAppIdHashPresent, true);
  assert.ok(mismatchedSecondAppHash.openApiEvidence?.issues.includes(
    "openapi_todo120_native_smoke_second_app_mismatch",
  ));

  const missingAppIdentityEvidence = buildOpenApiEvidenceFixture();
  delete (missingAppIdentityEvidence as Partial<ReturnType<typeof buildOpenApiEvidenceFixture>>).appIdentity;
  const missingAppIdentity = buildFeishuEvidenceReport({
    ...complete,
    openApiEvidence: missingAppIdentityEvidence,
  });

  assert.equal(missingAppIdentity.strictSatisfied, false);
  assert.equal(missingAppIdentity.openApiEvidence?.valid, false);
  assert.equal(missingAppIdentity.openApiEvidence?.summary?.appIdentityPresent, false);
  assert.equal(missingAppIdentity.openApiEvidence?.summary?.appIdHashPresent, false);
  assert.ok(missingAppIdentity.openApiEvidence?.issues.includes("openapi_app_identity_missing"));

  const brokenEvidence = buildOpenApiEvidenceFixture();
  const sheetStep = brokenEvidence.steps.find((step) => step.name === "Sheets read values");
  if (sheetStep && "request" in sheetStep && sheetStep.request) {
    sheetStep.request.path = "/open-apis/sheets/v2/spreadsheets/:sheet_token/values/Sheet1!A1:B2";
  }
  const docAppendStep = brokenEvidence.steps.find((step) => step.name === "Docs docx append blocks");
  if (docAppendStep && "request" in docAppendStep && docAppendStep.request) {
    docAppendStep.request.path = "/open-apis/docx/v1/documents/doccn_secret/blocks/blk_secret/children";
  }
  const baseListStep = brokenEvidence.steps.find((step) => step.name === "Base list records");
  if (baseListStep && "request" in baseListStep && baseListStep.request) {
    baseListStep.request.path = "/open-apis/bitable/v1/apps/:app_token/tables/tbl_secret/records";
  }
  const baseUpdateStep = brokenEvidence.steps.find((step) => step.name === "Base update record");
  if (baseUpdateStep && "request" in baseUpdateStep && baseUpdateStep.request) {
    baseUpdateStep.request.path = "/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/rec_secret";
  }
  const blocked = buildFeishuEvidenceReport({
    ...complete,
    openApiEvidence: brokenEvidence,
  });

  assert.equal(blocked.strictSatisfied, false);
  assert.equal(blocked.openApiEvidence?.valid, false);
  assert.ok(blocked.openApiEvidence?.issues.includes("openapi_request_path_not_redacted:Docs docx append blocks"));
  assert.ok(blocked.openApiEvidence?.issues.includes("openapi_request_path_not_redacted:Sheets read values"));
  assert.ok(blocked.openApiEvidence?.issues.includes("openapi_request_path_not_redacted:Base list records"));
  assert.ok(blocked.openApiEvidence?.issues.includes("openapi_request_path_not_redacted:Base update record"));

  const detailLeakEvidence = buildOpenApiEvidenceFixture();
  const sheetWriteStep = detailLeakEvidence.steps.find((step) => step.name === "Sheets write values");
  if (sheetWriteStep) {
    sheetWriteStep.detail = "updated SecretSheet!A1:B2 for doccn_secret and oc_secret";
  }
  const detailLeak = buildFeishuEvidenceReport({
    ...complete,
    openApiEvidence: detailLeakEvidence,
  });

  assert.equal(detailLeak.strictSatisfied, false);
  assert.equal(detailLeak.openApiEvidence?.valid, false);
  assert.ok(detailLeak.openApiEvidence?.issues.includes("openapi_raw_feishu_identifier_in_detail:Sheets write values"));
  assert.ok(detailLeak.openApiEvidence?.issues.includes("openapi_raw_feishu_identifier_in_evidence"));

  const missingCallbackProofEvidence = buildOpenApiEvidenceFixture();
  const callbackStep = missingCallbackProofEvidence.steps.find((step) =>
    step.name === "AgentSpace callback URL verification"
  );
  if (callbackStep) {
    delete (callbackStep as { callbackRoute?: string }).callbackRoute;
    delete (callbackStep as { callbackRouteFingerprint?: string }).callbackRouteFingerprint;
  }
  const missingCallbackProof = buildFeishuEvidenceReport({
    ...complete,
    openApiEvidence: missingCallbackProofEvidence,
  });

  assert.equal(missingCallbackProof.strictSatisfied, false);
  assert.equal(missingCallbackProof.openApiEvidence?.valid, false);
  assert.ok(missingCallbackProof.openApiEvidence?.issues.includes("openapi_callback_route_proof_missing"));

  const callbackUrlLeakEvidence = buildOpenApiEvidenceFixture();
  const callbackUrlLeakStep = callbackUrlLeakEvidence.steps.find((step) =>
    step.name === "AgentSpace callback URL verification"
  );
  if (callbackUrlLeakStep) {
    const callbackUrl = "https://agent.test/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=integration-evidence";
    (callbackUrlLeakStep as { callbackUrl?: string }).callbackUrl = callbackUrl;
    callbackUrlLeakStep.detail = `verified ${callbackUrl}`;
  }
  const callbackUrlLeak = buildFeishuEvidenceReport({
    ...complete,
    openApiEvidence: callbackUrlLeakEvidence,
  });

  assert.equal(callbackUrlLeak.strictSatisfied, false);
  assert.equal(callbackUrlLeak.openApiEvidence?.valid, false);
  assert.ok(callbackUrlLeak.openApiEvidence?.issues.includes(
    "openapi_callback_url_in_detail:AgentSpace callback URL verification",
  ));
  assert.ok(callbackUrlLeak.openApiEvidence?.issues.includes("openapi_callback_url_in_evidence"));

  const scopedCallbackProof = buildFeishuEvidenceReport({
    ...complete,
    integrationId: "integration-evidence",
    openApiEvidence: buildOpenApiEvidenceFixture(),
  });

  assert.equal(scopedCallbackProof.strictSatisfied, true);
  assert.equal(scopedCallbackProof.openApiEvidence?.valid, true);
  assert.deepEqual(scopedCallbackProof.openApiEvidence?.issues, []);

  const unscopedMismatchedCallbackProofEvidence = buildOpenApiEvidenceFixture();
  const unscopedMismatchedCallbackStepIndex = unscopedMismatchedCallbackProofEvidence.steps.findIndex((step) =>
    step.name === "AgentSpace callback URL verification"
  );
  if (unscopedMismatchedCallbackStepIndex >= 0) {
    unscopedMismatchedCallbackProofEvidence.steps[unscopedMismatchedCallbackStepIndex] = openApiCallbackLiveStep({
      workspaceId: "workspace-1",
      integrationId: "agent-bot-hermes",
    });
  }
  const unscopedMismatchedCallbackProof = buildFeishuEvidenceReport({
    ...complete,
    openApiEvidence: unscopedMismatchedCallbackProofEvidence,
  });

  assert.equal(unscopedMismatchedCallbackProof.strictSatisfied, false);
  assert.equal(unscopedMismatchedCallbackProof.openApiEvidence?.valid, false);
  assert.equal(unscopedMismatchedCallbackProof.openApiEvidence?.summary?.appIdentityMatched, true);
  assert.ok(unscopedMismatchedCallbackProof.openApiEvidence?.issues.includes(
    "openapi_callback_route_proof_mismatch",
  ));

  const mismatchedCallbackProofEvidence = buildOpenApiEvidenceFixture();
  const mismatchedCallbackStep = mismatchedCallbackProofEvidence.steps.find((step) =>
    step.name === "AgentSpace callback URL verification"
  );
  if (mismatchedCallbackStep) {
    (mismatchedCallbackStep as { callbackRouteFingerprint?: string }).callbackRouteFingerprint = "sha256:ffffffffffffffff";
  }
  const mismatchedCallbackProof = buildFeishuEvidenceReport({
    ...complete,
    integrationId: "integration-evidence",
    openApiEvidence: mismatchedCallbackProofEvidence,
  });

  assert.equal(mismatchedCallbackProof.strictSatisfied, false);
  assert.equal(mismatchedCallbackProof.openApiEvidence?.valid, false);
  assert.ok(mismatchedCallbackProof.openApiEvidence?.issues.includes("openapi_callback_route_proof_mismatch"));

  const incompleteSummaryEvidence = buildOpenApiEvidenceFixture();
  incompleteSummaryEvidence.summary.liveChecks = 1;
  incompleteSummaryEvidence.summary.livePassed = 1;
  const incompleteSummary = buildFeishuEvidenceReport({
    ...complete,
    openApiEvidence: incompleteSummaryEvidence,
  });

  assert.equal(incompleteSummary.strictSatisfied, false);
  assert.equal(incompleteSummary.openApiEvidence?.valid, false);
  assert.ok(incompleteSummary.openApiEvidence?.issues.includes("openapi_live_check_summary_incomplete"));
  assert.ok(incompleteSummary.openApiEvidence?.issues.includes("openapi_live_passed_summary_incomplete"));

  const missingRequestEvidence = buildOpenApiEvidenceFixture();
  const openApiSheetReadStep = missingRequestEvidence.steps.find((step) => step.name === "Sheets read values");
  if (openApiSheetReadStep) {
    delete (openApiSheetReadStep as { request?: unknown }).request;
  }
  const missingRequest = buildFeishuEvidenceReport({
    ...complete,
    openApiEvidence: missingRequestEvidence,
  });

  assert.equal(missingRequest.strictSatisfied, false);
  assert.equal(missingRequest.openApiEvidence?.valid, false);
  assert.ok(missingRequest.openApiEvidence?.issues.includes(
    "openapi_required_request_summary_missing:Sheets read values",
  ));

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("tenant-secret-token"), false);
  assert.equal(serialized.includes("oc_secret"), false);
  assert.equal(serialized.includes("doccn_secret"), false);
});

test("Feishu evidence report requires OpenAPI smoke evidence to match the scoped Feishu app", () => {
  const wrongActiveBotEvidence = buildOpenApiEvidenceFixture();
  wrongActiveBotEvidence.appIdentity.appIdHash = createHash("sha256")
    .update("cli_hermes_bot", "utf8")
    .digest("hex");
  const wrongActiveBot = buildFeishuEvidenceReport({
    ...withSecondActiveFeishuAgentBotEvidence(buildCompleteFeishuEvidenceInput()),
    openApiEvidence: wrongActiveBotEvidence,
  });

  assert.equal(wrongActiveBot.strictSatisfied, false);
  assert.equal(wrongActiveBot.openApiEvidence?.valid, false);
  assert.equal(wrongActiveBot.openApiEvidence?.summary?.appIdentityMatched, false);
  assert.ok(wrongActiveBot.openApiEvidence?.issues.includes("openapi_app_identity_app_id_mismatch"));
  assert.equal(JSON.stringify(wrongActiveBot).includes("cli_hermes_bot"), false);

  const mismatchedAppEvidence = buildOpenApiEvidenceFixture();
  mismatchedAppEvidence.appIdentity.appIdHash = createHash("sha256")
    .update("cli_unrelated_app", "utf8")
    .digest("hex");
  const mismatchedApp = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    integrationId: "integration-evidence",
    openApiEvidence: mismatchedAppEvidence,
  });

  assert.equal(mismatchedApp.strictSatisfied, false);
  assert.equal(mismatchedApp.openApiEvidence?.valid, false);
  assert.equal(mismatchedApp.openApiEvidence?.summary?.appIdentityMatched, false);
  assert.ok(mismatchedApp.openApiEvidence?.issues.includes("openapi_app_identity_app_id_mismatch"));

  const tenantScoped = buildCompleteFeishuEvidenceInput();
  const mismatchedTenantEvidence = buildOpenApiEvidenceFixture();
  mismatchedTenantEvidence.appIdentity.tenantKeyPresent = true;
  mismatchedTenantEvidence.appIdentity.tenantKeyHash = createHash("sha256")
    .update("tenant-unrelated", "utf8")
    .digest("hex");
  const mismatchedTenant = buildFeishuEvidenceReport({
    ...tenantScoped,
    integrationId: "integration-evidence",
    openApiEvidence: mismatchedTenantEvidence,
    integrations: [
      buildIntegrationRecord({
        id: "integration-evidence",
        displayName: "Evidence Feishu",
        transportMode: "websocket_worker",
        lastHealthStatus: "degraded",
        tenantKey: "tenant-expected",
      }),
    ],
  });

  assert.equal(mismatchedTenant.strictSatisfied, false);
  assert.equal(mismatchedTenant.openApiEvidence?.valid, false);
  assert.equal(mismatchedTenant.openApiEvidence?.summary?.appIdentityMatched, true);
  assert.equal(mismatchedTenant.openApiEvidence?.summary?.tenantKeyMatched, false);
  assert.ok(mismatchedTenant.openApiEvidence?.issues.includes("openapi_app_identity_tenant_key_mismatch"));

  const unexpectedTenantEvidence = buildOpenApiEvidenceFixture();
  unexpectedTenantEvidence.appIdentity.tenantKeyPresent = true;
  unexpectedTenantEvidence.appIdentity.tenantKeyHash = createHash("sha256")
    .update("tenant-unbound-to-agentspace", "utf8")
    .digest("hex");
  const unexpectedTenant = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    integrationId: "integration-evidence",
    openApiEvidence: unexpectedTenantEvidence,
  });

  assert.equal(unexpectedTenant.strictSatisfied, false);
  assert.equal(unexpectedTenant.openApiEvidence?.valid, false);
  assert.equal(unexpectedTenant.openApiEvidence?.summary?.appIdentityMatched, true);
  assert.equal(unexpectedTenant.openApiEvidence?.summary?.tenantKeyHashPresent, true);
  assert.equal(unexpectedTenant.openApiEvidence?.summary?.tenantKeyMatched, false);
  assert.ok(unexpectedTenant.openApiEvidence?.issues.includes("openapi_app_identity_tenant_key_unexpected"));
});

test("Feishu evidence report matches artifacts to the correct tenant when Feishu app hash is shared", () => {
  const tenantA = withSecondActiveFeishuAgentBotEvidence(
    cloneFeishuEvidenceInputForIntegration(buildCompleteFeishuEvidenceInput(), {
      integrationId: "integration-tenant-a",
      displayName: "Tenant A Feishu",
      appId: "cli_shared_cross_tenant",
      tenantKey: "tenant-a",
      chatReference: FEISHU_TEST_CHAT_REFERENCE,
    }),
    {
      integrationId: "agent-bot-tenant-a-hermes",
      displayName: "Tenant A HermesAgent Bot",
      appId: "cli_tenant_a_hermes",
      tenantKey: "tenant-a",
      chatReference: FEISHU_TEST_CHAT_REFERENCE,
    },
  );
  const tenantB = withSecondActiveFeishuAgentBotEvidence(
    cloneFeishuEvidenceInputForIntegration(buildCompleteFeishuEvidenceInput(), {
      integrationId: "integration-tenant-b",
      displayName: "Tenant B Feishu",
      appId: "cli_shared_cross_tenant",
      tenantKey: "tenant-b",
      chatReference: FEISHU_OTHER_TEST_CHAT_REFERENCE,
    }),
    {
      integrationId: "agent-bot-tenant-b-hermes",
      displayName: "Tenant B HermesAgent Bot",
      appId: "cli_tenant_b_hermes",
      tenantKey: "tenant-b",
      chatReference: FEISHU_OTHER_TEST_CHAT_REFERENCE,
    },
  );
  const openApiEvidence = buildOpenApiEvidenceFixture();
  openApiEvidence.appIdentity.appIdHash = createHash("sha256")
    .update("cli_shared_cross_tenant", "utf8")
    .digest("hex");
  openApiEvidence.appIdentity.tenantKeyPresent = true;
  openApiEvidence.appIdentity.tenantKeyHash = createHash("sha256")
    .update("tenant-b", "utf8")
    .digest("hex");
  openApiEvidence.todo120NativeSmoke.secondAgentAppIdHash = createHash("sha256")
    .update("cli_tenant_b_hermes", "utf8")
    .digest("hex");
  const callbackStepIndex = openApiEvidence.steps.findIndex((step) =>
    step.name === "AgentSpace callback URL verification"
  );
  if (callbackStepIndex >= 0) {
    openApiEvidence.steps[callbackStepIndex] = openApiCallbackLiveStep({
      workspaceId: "workspace-1",
      integrationId: "integration-tenant-b",
    });
  }
  const botAddedPayloadEvidence = buildBotAddedPayloadEvidenceFixture();
  botAddedPayloadEvidence.summary.appIdHash = createHash("sha256")
    .update("cli_shared_cross_tenant", "utf8")
    .digest("hex");
  botAddedPayloadEvidence.summary.tenantKeyPresent = true;
  botAddedPayloadEvidence.summary.tenantKeyHash = createHash("sha256")
    .update("tenant-b", "utf8")
    .digest("hex");
  botAddedPayloadEvidence.summary.chatReference = FEISHU_OTHER_TEST_CHAT_REFERENCE;

  const report = buildFeishuEvidenceReport({
    ...mergeFeishuEvidenceInputs(tenantA, tenantB),
    openApiEvidence,
    botAddedPayloadEvidence,
  });

  assert.equal(report.strictSatisfied, true);
  assert.equal(report.openApiEvidence?.valid, true);
  assert.equal(report.openApiEvidence?.summary?.appIdentityMatched, true);
  assert.equal(report.openApiEvidence?.summary?.tenantKeyMatched, true);
  assert.equal(report.openApiEvidence?.summary?.matchedIntegrationId, "integration-tenant-b");
  assert.equal(report.botAddedPayloadEvidence?.valid, true);
  assert.equal(report.botAddedPayloadEvidence?.summary?.appIdentityMatched, true);
  assert.equal(report.botAddedPayloadEvidence?.summary?.tenantKeyMatched, true);
  assert.equal(report.botAddedPayloadEvidence?.summary?.matchedIntegrationId, "integration-tenant-b");
});

test("Feishu evidence report rejects unsafe bot-added payload evidence artifacts", () => {
  const unsafeBotAddedEvidence = buildBotAddedPayloadEvidenceFixture();
  unsafeBotAddedEvidence.summary.chatReference = "oc_secret_chat";
  unsafeBotAddedEvidence.summary.externalEventReference = "evt_secret_event";
  unsafeBotAddedEvidence.summary.payloadHash = "plain payload";
  unsafeBotAddedEvidence.summary.rawPayloadStored = true;
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    openApiEvidence: buildOpenApiEvidenceFixture(),
    botAddedPayloadEvidence: unsafeBotAddedEvidence,
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.botAddedPayloadEvidence?.present, true);
  assert.equal(report.botAddedPayloadEvidence?.valid, false);
  assert.ok(report.botAddedPayloadEvidence?.issues.includes("bot_added_payload_chat_reference_missing"));
  assert.ok(report.botAddedPayloadEvidence?.issues.includes("bot_added_payload_event_reference_missing"));
  assert.ok(report.botAddedPayloadEvidence?.issues.includes("bot_added_payload_hash_missing"));
  assert.ok(report.botAddedPayloadEvidence?.issues.includes("bot_added_payload_raw_payload_stored"));
  assert.ok(report.botAddedPayloadEvidence?.issues.includes("bot_added_payload_raw_feishu_identifier"));
  const [remediation] = report.botAddedPayloadEvidence?.remediationSteps ?? [];
  assert.equal(remediation?.stepId, "verify_real_bot_added_payload_sample");
  assert.match(remediation?.command ?? "", /--verify-bot-added-payload runtime-output\/feishu-smoke\/bot-added-callback\.json/);
  assert.match(remediation?.command ?? "", /--bot-added-payload-evidence runtime-output\/feishu-smoke\/bot-added-payload-evidence\.json/);
});

test("Feishu evidence report requires bot-added payload evidence to match the scoped Feishu app", () => {
  const mismatchedChatEvidence = buildBotAddedPayloadEvidenceFixture();
  mismatchedChatEvidence.summary.chatReference = FEISHU_OTHER_TEST_CHAT_REFERENCE;
  const mismatchedChat = buildFeishuEvidenceReport({
    ...withSecondActiveFeishuAgentBotEvidence(buildCompleteFeishuEvidenceInput()),
    openApiEvidence: buildOpenApiEvidenceFixture(),
    botAddedPayloadEvidence: mismatchedChatEvidence,
  });

  assert.equal(mismatchedChat.strictSatisfied, false);
  assert.equal(mismatchedChat.botAddedPayloadEvidence?.valid, false);
  assert.equal(mismatchedChat.botAddedPayloadEvidence?.summary?.appIdentityMatched, true);
  assert.ok(mismatchedChat.botAddedPayloadEvidence?.issues.includes("bot_added_payload_chat_reference_mismatch"));
  assert.equal(mismatchedChat.botAddedPayloadEvidence?.summary?.chatReference, FEISHU_OTHER_TEST_CHAT_REFERENCE);

  const otherAnchor = withSecondActiveFeishuAgentBotEvidence(
    cloneFeishuEvidenceInputForIntegration(buildCompleteFeishuEvidenceInput(), {
      integrationId: "integration-other",
      displayName: "Other Feishu",
      appId: "cli_other_bot",
      chatReference: FEISHU_OTHER_TEST_CHAT_REFERENCE,
    }),
    {
      integrationId: "agent-bot-other-hermes",
      displayName: "Other HermesAgent Bot",
      appId: "cli_other_hermes_bot",
      chatReference: FEISHU_OTHER_TEST_CHAT_REFERENCE,
    },
  );
  const crossAnchorChatEvidence = buildBotAddedPayloadEvidenceFixture();
  crossAnchorChatEvidence.summary.chatReference = FEISHU_OTHER_TEST_CHAT_REFERENCE;
  const crossAnchorChat = buildFeishuEvidenceReport({
    ...mergeFeishuEvidenceInputs(
      withSecondActiveFeishuAgentBotEvidence(buildCompleteFeishuEvidenceInput()),
      otherAnchor,
    ),
    openApiEvidence: buildOpenApiEvidenceFixture(),
    botAddedPayloadEvidence: crossAnchorChatEvidence,
  });

  assert.equal(crossAnchorChat.strictSatisfied, false);
  assert.equal(crossAnchorChat.summary.workspaceAllSatisfied, true);
  assert.equal(crossAnchorChat.openApiEvidence?.valid, true);
  assert.equal(crossAnchorChat.botAddedPayloadEvidence?.valid, false);
  assert.equal(crossAnchorChat.botAddedPayloadEvidence?.summary?.appIdentityMatched, true);
  assert.ok(crossAnchorChat.botAddedPayloadEvidence?.issues.includes("bot_added_payload_chat_reference_mismatch"));

  const crossArtifactAnchorEvidence = buildBotAddedPayloadEvidenceFixture();
  crossArtifactAnchorEvidence.summary.appIdHash = createHash("sha256").update("cli_other_bot", "utf8").digest("hex");
  crossArtifactAnchorEvidence.summary.chatReference = FEISHU_OTHER_TEST_CHAT_REFERENCE;
  const crossArtifactAnchor = buildFeishuEvidenceReport({
    ...mergeFeishuEvidenceInputs(
      withSecondActiveFeishuAgentBotEvidence(buildCompleteFeishuEvidenceInput()),
      otherAnchor,
    ),
    openApiEvidence: buildOpenApiEvidenceFixture(),
    botAddedPayloadEvidence: crossArtifactAnchorEvidence,
  });

  assert.equal(crossArtifactAnchor.strictSatisfied, false);
  assert.equal(crossArtifactAnchor.summary.workspaceAllSatisfied, true);
  assert.equal(crossArtifactAnchor.openApiEvidence?.summary?.matchedIntegrationId, "integration-evidence");
  assert.equal(crossArtifactAnchor.botAddedPayloadEvidence?.summary?.matchedIntegrationId, "integration-other");
  assert.equal(crossArtifactAnchor.openApiEvidence?.valid, false);
  assert.equal(crossArtifactAnchor.botAddedPayloadEvidence?.valid, false);
  assert.ok(crossArtifactAnchor.openApiEvidence?.issues.includes(
    "openapi_bot_added_payload_anchor_mismatch",
  ));
  assert.ok(crossArtifactAnchor.botAddedPayloadEvidence?.issues.includes(
    "bot_added_payload_openapi_anchor_mismatch",
  ));

  const wrongActiveBotEvidence = buildBotAddedPayloadEvidenceFixture();
  wrongActiveBotEvidence.summary.appIdHash = createHash("sha256").update("cli_hermes_bot", "utf8").digest("hex");
  const wrongActiveBot = buildFeishuEvidenceReport({
    ...withSecondActiveFeishuAgentBotEvidence(buildCompleteFeishuEvidenceInput()),
    openApiEvidence: buildOpenApiEvidenceFixture(),
    botAddedPayloadEvidence: wrongActiveBotEvidence,
  });

  assert.equal(wrongActiveBot.strictSatisfied, false);
  assert.equal(wrongActiveBot.botAddedPayloadEvidence?.valid, false);
  assert.equal(wrongActiveBot.botAddedPayloadEvidence?.summary?.appIdentityMatched, false);
  assert.ok(wrongActiveBot.botAddedPayloadEvidence?.issues.includes("bot_added_payload_app_id_mismatch"));
  assert.equal(JSON.stringify(wrongActiveBot).includes("cli_hermes_bot"), false);

  const mismatchedAppEvidence = buildBotAddedPayloadEvidenceFixture();
  mismatchedAppEvidence.summary.appIdHash = createHash("sha256").update("cli_unrelated_app", "utf8").digest("hex");
  const mismatchedApp = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    integrationId: "integration-evidence",
    openApiEvidence: buildOpenApiEvidenceFixture(),
    botAddedPayloadEvidence: mismatchedAppEvidence,
  });

  assert.equal(mismatchedApp.strictSatisfied, false);
  assert.equal(mismatchedApp.botAddedPayloadEvidence?.valid, false);
  assert.equal(mismatchedApp.botAddedPayloadEvidence?.summary?.appIdentityMatched, false);
  assert.ok(mismatchedApp.botAddedPayloadEvidence?.issues.includes("bot_added_payload_app_id_mismatch"));

  const tenantScoped = buildCompleteFeishuEvidenceInput();
  const mismatchedTenantEvidence = buildBotAddedPayloadEvidenceFixture();
  mismatchedTenantEvidence.summary.tenantKeyPresent = true;
  mismatchedTenantEvidence.summary.tenantKeyHash = createHash("sha256")
    .update("tenant-unrelated", "utf8")
    .digest("hex");
  const mismatchedTenant = buildFeishuEvidenceReport({
    ...tenantScoped,
    integrationId: "integration-evidence",
    openApiEvidence: buildOpenApiEvidenceFixture(),
    botAddedPayloadEvidence: mismatchedTenantEvidence,
    integrations: [
      buildIntegrationRecord({
        id: "integration-evidence",
        displayName: "Evidence Feishu",
        transportMode: "websocket_worker",
        lastHealthStatus: "degraded",
        tenantKey: "tenant-expected",
      }),
    ],
  });

  assert.equal(mismatchedTenant.strictSatisfied, false);
  assert.equal(mismatchedTenant.botAddedPayloadEvidence?.valid, false);
  assert.equal(mismatchedTenant.botAddedPayloadEvidence?.summary?.appIdentityMatched, true);
  assert.equal(mismatchedTenant.botAddedPayloadEvidence?.summary?.tenantKeyMatched, false);
  assert.ok(mismatchedTenant.botAddedPayloadEvidence?.issues.includes("bot_added_payload_tenant_key_mismatch"));

  const unexpectedTenantEvidence = buildBotAddedPayloadEvidenceFixture();
  unexpectedTenantEvidence.summary.tenantKeyPresent = true;
  unexpectedTenantEvidence.summary.tenantKeyHash = createHash("sha256")
    .update("tenant-unbound-to-agentspace", "utf8")
    .digest("hex");
  const unexpectedTenant = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    integrationId: "integration-evidence",
    openApiEvidence: buildOpenApiEvidenceFixture(),
    botAddedPayloadEvidence: unexpectedTenantEvidence,
  });

  assert.equal(unexpectedTenant.strictSatisfied, false);
  assert.equal(unexpectedTenant.botAddedPayloadEvidence?.valid, false);
  assert.equal(unexpectedTenant.botAddedPayloadEvidence?.summary?.appIdentityMatched, true);
  assert.equal(unexpectedTenant.botAddedPayloadEvidence?.summary?.tenantKeyHashPresent, true);
  assert.equal(unexpectedTenant.botAddedPayloadEvidence?.summary?.tenantKeyMatched, false);
  assert.ok(unexpectedTenant.botAddedPayloadEvidence?.issues.includes("bot_added_payload_tenant_key_unexpected"));
});

test("Feishu evidence report reads smoke evidence artifacts from disk", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-openapi-evidence-"));
  try {
    const evidencePath = join(directory, "live.json");
    const botAddedPayloadEvidencePath = join(directory, "bot-added-payload-evidence.json");
    writeFileSync(evidencePath, `${JSON.stringify(buildOpenApiEvidenceFixture(), null, 2)}\n`, "utf8");
    writeFileSync(
      botAddedPayloadEvidencePath,
      `${JSON.stringify(buildBotAddedPayloadEvidenceFixture(), null, 2)}\n`,
      "utf8",
    );

    const report = buildFeishuEvidenceReport({
      ...withSecondActiveFeishuAgentBotEvidence(buildCompleteFeishuEvidenceInput()),
      openApiEvidencePath: evidencePath,
      botAddedPayloadEvidence: undefined,
      botAddedPayloadEvidencePath,
    });

    assert.equal(report.strictSatisfied, true);
    assert.equal(report.openApiEvidence?.present, true);
    assert.equal(report.openApiEvidence?.valid, true);
    assert.equal(report.openApiEvidence?.evidencePath, evidencePath);
    assert.equal(report.openApiEvidence?.summary?.livePassed, 12);
    assert.equal(report.botAddedPayloadEvidence?.present, true);
    assert.equal(report.botAddedPayloadEvidence?.valid, true);
    assert.equal(report.botAddedPayloadEvidence?.evidencePath, botAddedPayloadEvidencePath);
    assert.equal(report.botAddedPayloadEvidence?.summary?.chatReference, FEISHU_TEST_CHAT_REFERENCE);

    const missing = buildFeishuEvidenceReport({
      ...buildCompleteFeishuEvidenceInput(),
      openApiEvidencePath: join(directory, "missing.json"),
      botAddedPayloadEvidence: undefined,
      botAddedPayloadEvidencePath: join(directory, "missing-bot-added.json"),
    });
    assert.equal(missing.strictSatisfied, false);
    assert.equal(missing.openApiEvidence?.present, false);
    assert.equal(missing.openApiEvidence?.valid, false);
    assert.deepEqual(missing.openApiEvidence?.issues, ["openapi_evidence_unreadable"]);
    assert.equal(missing.botAddedPayloadEvidence?.present, false);
    assert.equal(missing.botAddedPayloadEvidence?.valid, false);
    assert.deepEqual(missing.botAddedPayloadEvidence?.issues, ["bot_added_payload_evidence_unreadable"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Feishu evidence report rejects stale OpenAPI smoke evidence artifacts", () => {
  const staleOpenApiEvidence = buildOpenApiEvidenceFixture();
  staleOpenApiEvidence.generatedAt = "2000-01-01T00:00:00.000Z";

  const report = buildFeishuEvidenceReport({
    ...withSecondActiveFeishuAgentBotEvidence(buildCompleteFeishuEvidenceInput()),
    openApiEvidence: staleOpenApiEvidence,
    botAddedPayloadEvidence: buildBotAddedPayloadEvidenceFixture(),
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.openApiEvidence?.present, true);
  assert.equal(report.openApiEvidence?.valid, false);
  assert.equal(report.openApiEvidence?.summary?.generatedAtPresent, true);
  assert.equal(report.openApiEvidence?.summary?.generatedAtFresh, false);
  assert.ok(report.openApiEvidence?.issues.includes("openapi_evidence_stale"));
});

test("Feishu evidence report rejects stale bot-added payload evidence artifacts", () => {
  const staleBotAddedEvidence = buildBotAddedPayloadEvidenceFixture();
  staleBotAddedEvidence.generatedAt = "2000-01-01T00:00:00.000Z";

  const report = buildFeishuEvidenceReport({
    ...withSecondActiveFeishuAgentBotEvidence(buildCompleteFeishuEvidenceInput()),
    openApiEvidence: buildOpenApiEvidenceFixture(),
    botAddedPayloadEvidence: staleBotAddedEvidence,
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.botAddedPayloadEvidence?.present, true);
  assert.equal(report.botAddedPayloadEvidence?.valid, false);
  assert.equal(report.botAddedPayloadEvidence?.summary?.generatedAtPresent, true);
  assert.equal(report.botAddedPayloadEvidence?.summary?.generatedAtFresh, false);
  assert.ok(report.botAddedPayloadEvidence?.issues.includes("bot_added_payload_evidence_stale"));
});

test("Feishu evidence report rejects bot-added artifacts from stale Feishu events", () => {
  const staleEventEvidence = buildBotAddedPayloadEvidenceFixture();
  staleEventEvidence.summary.eventCreateTimeFresh = false;

  const report = buildFeishuEvidenceReport({
    ...withSecondActiveFeishuAgentBotEvidence(buildCompleteFeishuEvidenceInput()),
    openApiEvidence: buildOpenApiEvidenceFixture(),
    botAddedPayloadEvidence: staleEventEvidence,
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.botAddedPayloadEvidence?.present, true);
  assert.equal(report.botAddedPayloadEvidence?.valid, false);
  assert.equal(report.botAddedPayloadEvidence?.summary?.eventCreateTimePresent, true);
  assert.equal(report.botAddedPayloadEvidence?.summary?.eventCreateTimeFresh, false);
  assert.ok(report.botAddedPayloadEvidence?.issues.includes("bot_added_payload_event_create_time_stale"));
});

test("Feishu evidence report rejects bot-added artifacts without Feishu event time proof", () => {
  const missingEventTimeEvidence = buildBotAddedPayloadEvidenceFixture();
  delete (missingEventTimeEvidence.summary as { eventCreateTimePresent?: boolean }).eventCreateTimePresent;
  delete (missingEventTimeEvidence.summary as { eventCreateTimeFresh?: boolean }).eventCreateTimeFresh;

  const report = buildFeishuEvidenceReport({
    ...withSecondActiveFeishuAgentBotEvidence(buildCompleteFeishuEvidenceInput()),
    openApiEvidence: buildOpenApiEvidenceFixture(),
    botAddedPayloadEvidence: missingEventTimeEvidence,
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.botAddedPayloadEvidence?.present, true);
  assert.equal(report.botAddedPayloadEvidence?.valid, false);
  assert.equal(report.botAddedPayloadEvidence?.summary?.eventCreateTimePresent, false);
  assert.equal(report.botAddedPayloadEvidence?.summary?.eventCreateTimeFresh, false);
  assert.ok(report.botAddedPayloadEvidence?.issues.includes("bot_added_payload_event_create_time_missing"));
});

test("Feishu evidence report ignores stale local AgentSpace proof rows", () => {
  const staleInput = withStaleFeishuLocalEvidenceTimestamps(
    withSecondActiveFeishuAgentBotEvidence(buildCompleteFeishuEvidenceInput()),
  );
  const report = buildFeishuEvidenceReport({
    ...staleInput,
    openApiEvidence: buildOpenApiEvidenceFixture(),
    botAddedPayloadEvidence: buildBotAddedPayloadEvidenceFixture(),
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.workspaceBotSatisfied, false);
  assert.equal(report.summary.workspaceNativeExperienceSatisfied, false);
  assert.equal(report.summary.workspaceGuestPolicySatisfied, false);
  assert.equal(report.summary.workspaceDataPlaneSatisfied, false);
  assert.equal(report.summary.workspaceWorkerSatisfied, false);
  assert.equal(report.summary.workspaceFailureVisible, false);
  assert.equal(report.summary.localEvidenceFreshRows, 0);
  assert.ok(report.summary.localEvidenceStaleRows > 0);
  assert.equal(report.summary.workspaceLocalEvidenceFreshRows, 0);
  assert.ok(report.summary.workspaceLocalEvidenceStaleRows >= report.summary.localEvidenceStaleRows);
  assert.equal(report.summary.localEvidenceMaxAgeHours, 24);
  const [item] = report.integrations;
  assert.equal(item?.bot.processedInboundEvents, 0);
  assert.equal(item?.bot.sentOutboxItems, 0);
  assert.equal(item?.nativeExperience.autoProvisionedChannelBindings, 0);
  assert.equal(item?.nativeExperience.threadTaskBindings, 0);
  assert.equal(item?.dataPlane.docReadSucceeded, 0);
  assert.equal(item?.localEvidenceFreshness.freshRows, 0);
  assert.ok((item?.localEvidenceFreshness.staleRows ?? 0) > 0);
  assert.ok(item?.issues.includes("stale_local_evidence_rows_ignored"));
  assert.ok(item?.issues.includes("processed_inbound_event_missing"));
  assert.ok(item?.issues.includes("sent_outbox_missing"));
  assert.ok(item?.issues.includes("channel_auto_provision_evidence_missing"));
  const output = formatFeishuEvidenceCommandText(report);
  assert.match(output, /local evidence freshness: scoped fresh=0, staleIgnored=\d+; workspace fresh=0, staleIgnored=\d+; maxAgeHours=24/);
  assert.match(output, /local evidence freshness: fresh=0, staleIgnored=\d+, maxAgeHours=24/);
  assert.match(output, /rerun stale AgentSpace evidence steps/);
});

test("Feishu evidence report passes fresh local proof while summarizing ignored stale rows", () => {
  const report = buildFeishuEvidenceReport({
    ...withAdditionalStaleFeishuLocalEvidenceRows(
      withSecondActiveFeishuAgentBotEvidence(buildCompleteFeishuEvidenceInput()),
    ),
    openApiEvidence: buildOpenApiEvidenceFixture(),
    botAddedPayloadEvidence: buildBotAddedPayloadEvidenceFixture(),
  });

  assert.equal(report.strictSatisfied, true);
  assert.equal(report.summary.workspaceAllSatisfied, true);
  assert.equal(report.summary.scopedAllSatisfied, true);
  assert.ok(report.summary.localEvidenceFreshRows > 0);
  assert.ok(report.summary.localEvidenceStaleRows > 0);
  assert.ok(report.summary.workspaceLocalEvidenceFreshRows >= report.summary.localEvidenceFreshRows);
  assert.ok(report.summary.workspaceLocalEvidenceStaleRows >= report.summary.localEvidenceStaleRows);
  const [item] = report.integrations;
  assert.equal(item?.bot.satisfied, true);
  assert.ok((item?.localEvidenceFreshness.freshRows ?? 0) > 0);
  assert.ok((item?.localEvidenceFreshness.staleRows ?? 0) > 0);
  const output = formatFeishuEvidenceCommandText(report);
  assert.match(output, /local evidence freshness: scoped fresh=\d+, staleIgnored=[1-9]\d*; workspace fresh=\d+, staleIgnored=[1-9]\d*; maxAgeHours=24/);
});

test("Feishu evidence report blocks strict gates when local proof is incomplete", () => {
  const report = buildFeishuEvidenceReport({
    workspaceId: "workspace-1",
    requiredEvidence: "data-plane",
    integrations: [
      buildIntegrationRecord({
        id: "integration-evidence-missing",
        displayName: "Missing Evidence Feishu",
        agentId: "Atlas",
      }),
    ],
    eventsByIntegrationId: {
      "integration-evidence-missing": [],
    },
    messageMappingsByIntegrationId: {
      "integration-evidence-missing": [],
    },
    outboxByIntegrationId: {
      "integration-evidence-missing": [],
    },
    channelBindingsByIntegrationId: {
      "integration-evidence-missing": [],
    },
    threadBindingsByIntegrationId: {
      "integration-evidence-missing": [],
    },
    dataOperationsByIntegrationId: {
      "integration-evidence-missing": [
        buildDataOperationRun("integration-evidence-missing", "docs.read_document", "doc", "succeeded"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.botSatisfiedCount, 0);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 0);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 0);
  const [item] = report.integrations;
  assert.equal(item?.bot.satisfied, false);
  assert.equal(item?.nativeExperience.satisfied, false);
  assert.equal(item?.dataPlane.satisfied, false);
  assert.ok(item?.issues.includes("processed_inbound_event_missing"));
  assert.ok(item?.issues.includes("inbound_message_mapping_missing"));
  assert.ok(item?.issues.includes("sent_outbox_missing"));
  assert.ok(item?.issues.includes("outbound_message_mapping_missing"));
  assert.ok(item?.issues.includes("correlated_reply_mapping_missing"));
  assert.ok(item?.issues.includes("native_agent_bot_reply_evidence_missing"));
  assert.ok(item?.issues.includes("doc_write_evidence_missing"));
  assert.ok(item?.issues.includes("sheet_read_evidence_missing"));
  assert.ok(item?.issues.includes("sheet_write_evidence_missing"));
  assert.ok(item?.issues.includes("base_read_evidence_missing"));
  assert.ok(item?.issues.includes("base_mutate_evidence_missing"));
  assert.ok(item?.issues.includes("agent_bot_route_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_bot_mention_evidence_missing"));
  assert.ok(item?.issues.includes("agent_channel_policy_disabled_evidence_missing"));
  assert.ok(item?.issues.includes("bot_sender_loop_guard_evidence_missing"));
  assert.ok(item?.issues.includes("channel_auto_provision_evidence_missing"));
  assert.ok(item?.issues.includes("bot_added_auto_provision_evidence_missing"));
  assert.ok(item?.issues.includes("first_message_auto_provision_evidence_missing"));
  assert.ok(item?.issues.includes("multi_agent_channel_reuse_evidence_missing"));
  assert.ok(item?.issues.includes("thread_task_binding_evidence_missing"));
  assert.ok(item?.issues.includes("thread_continuation_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_policy_allow_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_policy_reply_all_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_policy_require_identity_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_identity_binding_notice_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_policy_ignore_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_policy_mention_required_evidence_missing"));
  assert.ok(item?.issues.includes("failure_visibility_evidence_missing"));
  const remediationStepIds = item?.remediationSteps.map((step) => step.stepId) ?? [];
  assert.deepEqual(remediationStepIds, [
    "live_bot_message_reply",
    "live_agent_bot_direct_mention",
    "live_external_guest_agent_bot_mention",
    "live_agent_channel_policy_disabled",
    "live_multi_agent_thread_collaboration",
    "live_agent_bot_channel_auto_provision",
    "live_agent_bot_first_message_auto_provision",
    "live_multi_agent_bot_channel_reuse",
    "live_feishu_thread_task_binding",
    "live_feishu_thread_continuation",
    "live_external_guest_reply_all",
    "live_external_guest_identity_required",
    "live_external_guest_reply_disabled",
    "live_unmentioned_guest_message_ignored",
    "live_agent_bound_doc_summary",
    "live_doc_write_with_approval",
    "live_sheet_read",
    "live_sheet_write_with_approval",
    "live_base_preview_and_update",
    "live_bound_user_data_operation",
    "live_external_guest_read_guest_readable",
    "live_failure_visibility",
  ]);
  const botRemediation = item?.remediationSteps.find((step) => step.stepId === "live_bot_message_reply");
  assert.ok(botRemediation?.issues.includes("processed_inbound_event_missing"));
  assert.ok(botRemediation?.issues.includes("sent_outbox_missing"));
  assert.ok(botRemediation?.issues.includes("correlated_reply_mapping_missing"));
  assert.match(botRemediation?.detail ?? "", /sent Feishu agent_reply outbox/);
  assert.match(botRemediation?.detail ?? "", /safe chat\/thread references/);
  const nativeRouteRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_agent_bot_direct_mention"
  );
  assert.ok(nativeRouteRemediation?.issues.includes("agent_bot_route_evidence_missing"));
  assert.match(nativeRouteRemediation?.detail ?? "", /actorType=user/);
  assert.match(nativeRouteRemediation?.detail ?? "", /actorUserId/);
  assert.match(nativeRouteRemediation?.detail ?? "", /safe audit references/);
  const guestMentionRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_external_guest_agent_bot_mention"
  );
  assert.ok(guestMentionRemediation?.issues.includes("external_guest_bot_mention_evidence_missing"));
  assert.ok(guestMentionRemediation?.issues.includes("external_guest_policy_allow_evidence_missing"));
  assert.match(guestMentionRemediation?.detail ?? "", /permissionProfile=channel_context_only/);
  assert.match(guestMentionRemediation?.detail ?? "", /no userId\/actorUserId/);
  assert.match(guestMentionRemediation?.detail ?? "", /task\/message dispatch/);
  assert.match(guestMentionRemediation?.detail ?? "", /safe audit references/);
  const agentChannelPolicyRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_agent_channel_policy_disabled"
  );
  assert.ok(agentChannelPolicyRemediation?.issues.includes("agent_channel_policy_disabled_evidence_missing"));
  assert.match(agentChannelPolicyRemediation?.command ?? "", /agent-channel-access/);
  assert.match(agentChannelPolicyRemediation?.detail ?? "", /Restore after this smoke step/);
  const replyAllRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_external_guest_reply_all"
  );
  assert.ok(replyAllRemediation?.issues.includes("external_guest_policy_reply_all_evidence_missing"));
  assert.match(replyAllRemediation?.command ?? "", /--unbound-user-mode reply_all/);
  assert.match(replyAllRemediation?.detail ?? "", /Restore after this smoke step/);
  const autoProvisionRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_agent_bot_channel_auto_provision"
  );
  assert.ok(autoProvisionRemediation?.issues.includes("channel_auto_provision_evidence_missing"));
  assert.ok(autoProvisionRemediation?.issues.includes("bot_added_auto_provision_evidence_missing"));
  const firstMessageAutoProvisionRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_agent_bot_first_message_auto_provision"
  );
  assert.ok(firstMessageAutoProvisionRemediation?.issues.includes("first_message_auto_provision_evidence_missing"));
  const multiAgentReuseRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_multi_agent_bot_channel_reuse"
  );
  assert.ok(multiAgentReuseRemediation?.issues.includes("multi_agent_channel_reuse_evidence_missing"));
  const threadTaskRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_feishu_thread_task_binding"
  );
  assert.ok(threadTaskRemediation?.issues.includes("thread_task_binding_evidence_missing"));
  const threadContinuationRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_feishu_thread_continuation"
  );
  assert.ok(threadContinuationRemediation?.issues.includes("thread_continuation_evidence_missing"));
  const threadCollaborationRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_multi_agent_thread_collaboration"
  );
  assert.ok(threadCollaborationRemediation?.issues.includes("thread_collaboration_evidence_missing"));
  assert.ok(threadCollaborationRemediation?.issues.includes("bot_sender_loop_guard_evidence_missing"));
  const requireIdentityRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_external_guest_identity_required"
  );
  assert.ok(requireIdentityRemediation?.issues.includes("external_guest_policy_require_identity_evidence_missing"));
  assert.ok(requireIdentityRemediation?.issues.includes("external_guest_identity_binding_notice_evidence_missing"));
  assert.match(requireIdentityRemediation?.command ?? "", /--unbound-user-mode require_identity/);
  assert.match(requireIdentityRemediation?.detail ?? "", /externalGuestReference/);
  assert.match(requireIdentityRemediation?.detail ?? "", /permissionProfile=none/);
  assert.match(requireIdentityRemediation?.detail ?? "", /raw Feishu open_id\/union_id/);
  assert.match(requireIdentityRemediation?.detail ?? "", /Restore after this smoke step/);
  const ignoreRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_external_guest_reply_disabled"
  );
  assert.ok(ignoreRemediation?.issues.includes("external_guest_policy_ignore_evidence_missing"));
  assert.match(ignoreRemediation?.command ?? "", /--unbound-user-mode ignore/);
  assert.match(ignoreRemediation?.detail ?? "", /permissionProfile=none/);
  assert.match(ignoreRemediation?.detail ?? "", /Restore after this smoke step/);
  const mentionRequiredRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_unmentioned_guest_message_ignored"
  );
  assert.ok(mentionRequiredRemediation?.issues.includes("external_guest_policy_mention_required_evidence_missing"));
  assert.match(mentionRequiredRemediation?.command ?? "", /--unbound-user-mode reply_on_mention/);
  const agentDocRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_agent_bound_doc_summary"
  );
  assert.ok(agentDocRemediation?.issues.includes("agent_doc_read_evidence_missing"));
  const docWriteRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_doc_write_with_approval"
  );
  assert.match(docWriteRemediation?.detail ?? "", /approvalId/);
  assert.match(docWriteRemediation?.detail ?? "", /SHA-256 payloadHash/);
  assert.match(docWriteRemediation?.detail ?? "", /active resource binding/);
  assert.match(docWriteRemediation?.command ?? "", /--operation plan-doc-append/);
  assert.match(docWriteRemediation?.command ?? "", /review-data-operation/);
  const sheetReadRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_sheet_read"
  );
  assert.match(sheetReadRemediation?.detail ?? "", /active resource binding/);
  assert.match(sheetReadRemediation?.detail ?? "", /Feishu governance context/);
  assert.match(sheetReadRemediation?.detail ?? "", /agentId/);
  assert.match(sheetReadRemediation?.detail ?? "", /botBindingId/);
  assert.match(sheetReadRemediation?.detail ?? "", /actor provenance/);
  assert.match(sheetReadRemediation?.detail ?? "", /no raw resource tokens/);
  const sheetWriteRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_sheet_write_with_approval"
  );
  assert.match(sheetWriteRemediation?.detail ?? "", /approvalId/);
  assert.match(sheetWriteRemediation?.detail ?? "", /SHA-256 payloadHash/);
  assert.match(sheetWriteRemediation?.detail ?? "", /active resource binding/);
  assert.match(sheetWriteRemediation?.command ?? "", /--operation plan-sheet-write/);
  const baseRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_base_preview_and_update"
  );
  assert.match(baseRemediation?.detail ?? "", /approvalId/);
  assert.match(baseRemediation?.detail ?? "", /SHA-256 payloadHash/);
  assert.match(baseRemediation?.detail ?? "", /active resource binding/);
  assert.match(baseRemediation?.detail ?? "", /Feishu governance context/);
  assert.match(baseRemediation?.detail ?? "", /botBindingId/);
  assert.match(baseRemediation?.detail ?? "", /actor provenance/);
  assert.match(baseRemediation?.detail ?? "", /no raw resource tokens/);
  assert.match(baseRemediation?.detail ?? "", /Feishu Base write evidence/);
  assert.match(baseRemediation?.command ?? "", /--operation plan-base-update/);
  const userActorRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_bound_user_data_operation"
  );
  assert.ok(userActorRemediation?.issues.includes("user_actor_data_operation_evidence_missing"));
  const guestActorRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_external_guest_read_guest_readable"
  );
  assert.ok(guestActorRemediation?.issues.includes("external_guest_actor_data_operation_evidence_missing"));
  assert.match(guestActorRemediation?.detail ?? "", /permissionProfile=channel_context_only/);
  assert.match(guestActorRemediation?.command ?? "", /--unbound-user-mode reply_on_mention/);
  assert.match(guestActorRemediation?.command ?? "", /--operation read-doc/);
  const failureRemediation = item?.remediationSteps.find((step) => step.stepId === "live_failure_visibility");
  assert.match(
    failureRemediation?.command ?? "",
    /health-check --workspace-id workspace-1 --integration integration-evidence-missing --json/,
  );
});

test("Feishu smoke-env template prepares callback smoke without leaking saved secrets", () => {
  const report = buildFeishuSmokeEnvTemplateReport({
    workspaceId: "workspace-1",
    appUrl: "https://agentspace.test/root?ignored=1#frag",
    integrations: [
      buildIntegrationRecord({
        id: "integration-smoke-env",
        displayName: "Smoke Env Feishu",
        agentId: "Codex",
        appId: "cli_smoke_env",
        tenantKey: "tenant_smoke_env",
        encryptedCredentialsJson: JSON.stringify({
          appSecret: "encrypted-app-secret-marker",
          verificationToken: "encrypted-verification-token-marker",
        }),
      }),
    ],
  });

  assert.equal(report.integrationCount, 1);
  assert.equal(report.selectedIntegrationId, "integration-smoke-env");
  assert.equal(report.appUrl, "https://agentspace.test/root");
  assert.deepEqual(report.issues, []);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_APP_ID")?.value, "cli_smoke_env");
  assert.equal(readSmokeEnvEntry(report, "FEISHU_TENANT_KEY")?.value, "tenant_smoke_env");
  assert.equal(readSmokeEnvEntry(report, "FEISHU_TENANT_KEY")?.required, false);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_TENANT_KEY")?.secret, false);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_TENANT_KEY")?.source, "integration");
  assert.match(readSmokeEnvEntry(report, "FEISHU_TENANT_KEY")?.note ?? "", /strict-live evidence stores only its hash/);
  assert.equal(
    readSmokeEnvEntry(report, "FEISHU_SMOKE_CALLBACK_URL")?.value,
    "https://agentspace.test/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=integration-smoke-env",
  );
  assert.equal(readSmokeEnvEntry(report, "FEISHU_APP_SECRET")?.secret, true);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_APP_SECRET")?.value, "CHANGE_ME_FEISHU_APP_SECRET");
  assert.equal(readSmokeEnvEntry(report, "FEISHU_VERIFICATION_TOKEN")?.value, "CHANGE_ME_FEISHU_VERIFICATION_TOKEN");
  assert.equal(readSmokeEnvEntry(report, "FEISHU_ENCRYPT_KEY")?.secret, true);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_ENCRYPT_KEY")?.required, false);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_SECOND_AGENT_APP_ID")?.value, "CHANGE_ME_SECOND_AGENT_APP_ID");
  assert.equal(readSmokeEnvEntry(report, "FEISHU_SECOND_AGENT_APP_ID")?.required, false);
  assert.match(readSmokeEnvEntry(report, "FEISHU_SECOND_AGENT_APP_ID")?.note ?? "", /required for TODO120 Phase 6/);
  assert.match(readSmokeEnvEntry(report, "FEISHU_SECOND_AGENT_APP_ID")?.note ?? "", /bind-agent-bot --workspace-id <id> --agent <second-agent>/);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_SECOND_AGENT_APP_SECRET")?.secret, true);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_SECOND_AGENT_APP_SECRET")?.required, false);
  assert.match(readSmokeEnvEntry(report, "FEISHU_SECOND_AGENT_APP_SECRET")?.note ?? "", /required for TODO120 Phase 6/);
  assert.match(readSmokeEnvEntry(report, "FEISHU_SECOND_AGENT_APP_SECRET")?.note ?? "", /same-group reuse and thread-collaboration smoke can pass/);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_SMOKE_DOC_PARENT_BLOCK_ID")?.required, true);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_SMOKE_DOC_APPEND_BLOCKS_JSON")?.required, true);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_SMOKE_SHEET_RANGE")?.required, false);
  assert.match(readSmokeEnvEntry(report, "FEISHU_SMOKE_SHEET_RANGE")?.note ?? "", /Optional sheet read range/);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_SMOKE_SHEET_WRITE_RANGE")?.required, true);
  assert.equal(getFeishuSmokeEnvExitCode(report), 0);

  const output = formatFeishuSmokeEnvCommandText(report);
  assert.equal(output.stderr, undefined);
  assert.match(output.stdout ?? "", /FEISHU_TENANT_KEY=tenant_smoke_env/);
  assert.match(output.stdout ?? "", /FEISHU_SMOKE_CALLBACK_URL=https:\/\/agentspace\.test/);
  assert.match(output.stdout ?? "", /FEISHU_SECOND_AGENT_APP_ID=CHANGE_ME_SECOND_AGENT_APP_ID/);
  assert.match(output.stdout ?? "", /bind-agent-bot --workspace-id <id> --agent <second-agent>/);
  assert.match(output.stdout ?? "", /# secret: FEISHU_SECOND_AGENT_APP_SECRET/);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("encrypted-app-secret-marker"), false);
  assert.equal(serialized.includes("encrypted-verification-token-marker"), false);
});

test("Feishu smoke-env template reports missing public app URL without exposing external ids", () => {
  const report = buildFeishuSmokeEnvTemplateReport({
    workspaceId: "workspace-1",
    integrations: [
      buildIntegrationRecord({
        id: "integration-smoke-env-missing-url",
        displayName: "Smoke Env Missing Url",
        agentId: "Codex",
        appId: undefined,
      }),
    ],
  });

  assert.deepEqual(report.issues, ["app_id_missing", "app_url_missing"]);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_APP_ID")?.value, "CHANGE_ME_FEISHU_APP_ID");
  assert.equal(
    readSmokeEnvEntry(report, "FEISHU_SMOKE_CALLBACK_URL")?.value,
    "CHANGE_ME_AGENTSPACE_CALLBACK_URL",
  );

  const output = formatFeishuSmokeEnvCommandText(report);
  assert.equal(output.stdout, undefined);
  assert.match(output.stderr ?? "", /app_id_missing, app_url_missing/);
  assert.equal(getFeishuSmokeEnvExitCode(report), 1);
});

test("Feishu smoke-env template ignores disabled integrations as env sources", () => {
  const report = buildFeishuSmokeEnvTemplateReport({
    workspaceId: "workspace-1",
    appUrl: "https://agentspace.test",
    integrations: [
      buildIntegrationRecord({
        id: "integration-smoke-env-disabled",
        displayName: "Disabled Smoke Env Feishu",
        appId: "cli_disabled_smoke_env",
        tenantKey: "tenant_disabled_smoke_env",
        status: "disabled",
      }),
    ],
  });

  assert.equal(report.integrationCount, 1);
  assert.equal(report.selectedIntegrationId, undefined);
  assert.deepEqual(report.issues, ["selected_integration_not_active"]);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_APP_ID")?.value, "CHANGE_ME_FEISHU_APP_ID");
  assert.equal(readSmokeEnvEntry(report, "FEISHU_APP_ID")?.source, "placeholder");
  assert.equal(readSmokeEnvEntry(report, "FEISHU_TENANT_KEY"), undefined);
  assert.equal(
    readSmokeEnvEntry(report, "FEISHU_SMOKE_CALLBACK_URL")?.value,
    "CHANGE_ME_AGENTSPACE_CALLBACK_URL",
  );
  assert.equal(readSmokeEnvEntry(report, "FEISHU_SMOKE_CALLBACK_URL")?.source, "placeholder");
  assert.equal(getFeishuSmokeEnvExitCode(report), 1);

  const output = formatFeishuSmokeEnvCommandText(report);
  assert.equal(output.stdout, undefined);
  assert.match(output.stderr ?? "", /selected_integration_not_active/);
  const serialized = JSON.stringify(report) + (output.stderr ?? "");
  assert.equal(serialized.includes("cli_disabled_smoke_env"), false);
  assert.equal(serialized.includes("tenant_disabled_smoke_env"), false);
  assert.equal(serialized.includes("integration-smoke-env-disabled"), false);
});

test("Feishu smoke-env template rejects workspace-level integrations as env sources", () => {
  const report = buildFeishuSmokeEnvTemplateReport({
    workspaceId: "workspace-1",
    appUrl: "https://agentspace.test",
    integrations: [
      buildIntegrationRecord({
        id: "integration-smoke-env-workspace",
        displayName: "Workspace Smoke Env Feishu",
        appId: "cli_workspace_smoke_env",
        tenantKey: "tenant_workspace_smoke_env",
        status: "active",
      }),
    ],
  });

  assert.equal(report.integrationCount, 1);
  assert.equal(report.selectedIntegrationId, undefined);
  assert.deepEqual(report.issues, ["active_agent_bot_integration_missing"]);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_APP_ID")?.value, "CHANGE_ME_FEISHU_APP_ID");
  assert.equal(readSmokeEnvEntry(report, "FEISHU_APP_ID")?.source, "placeholder");
  assert.equal(readSmokeEnvEntry(report, "FEISHU_TENANT_KEY"), undefined);
  assert.equal(
    readSmokeEnvEntry(report, "FEISHU_SMOKE_CALLBACK_URL")?.value,
    "CHANGE_ME_AGENTSPACE_CALLBACK_URL",
  );
  assert.equal(readSmokeEnvEntry(report, "FEISHU_SMOKE_CALLBACK_URL")?.source, "placeholder");
  assert.equal(getFeishuSmokeEnvExitCode(report), 1);

  const output = formatFeishuSmokeEnvCommandText(report);
  assert.equal(output.stdout, undefined);
  assert.match(output.stderr ?? "", /active_agent_bot_integration_missing/);
  const serialized = JSON.stringify(report) + (output.stderr ?? "");
  assert.equal(serialized.includes("cli_workspace_smoke_env"), false);
  assert.equal(serialized.includes("tenant_workspace_smoke_env"), false);
  assert.equal(serialized.includes("integration-smoke-env-workspace"), false);
});

test("Feishu smoke-env template rejects selected workspace-level integrations as env sources", () => {
  const report = buildFeishuSmokeEnvTemplateReport({
    workspaceId: "workspace-1",
    integrationId: "integration-smoke-env-workspace",
    appUrl: "https://agentspace.test",
    integrations: [
      buildIntegrationRecord({
        id: "integration-smoke-env-workspace",
        displayName: "Workspace Smoke Env Feishu",
        appId: "cli_workspace_smoke_env",
        tenantKey: "tenant_workspace_smoke_env",
        status: "active",
      }),
    ],
  });

  assert.equal(report.integrationCount, 1);
  assert.equal(report.selectedIntegrationId, undefined);
  assert.deepEqual(report.issues, ["selected_integration_not_agent_bot"]);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_APP_ID")?.value, "CHANGE_ME_FEISHU_APP_ID");
  assert.equal(readSmokeEnvEntry(report, "FEISHU_TENANT_KEY"), undefined);
  assert.equal(getFeishuSmokeEnvExitCode(report), 1);

  const output = formatFeishuSmokeEnvCommandText(report);
  assert.equal(output.stdout, undefined);
  assert.match(output.stderr ?? "", /selected_integration_not_agent_bot/);
  const serialized = JSON.stringify(report) + (output.stderr ?? "");
  assert.equal(serialized.includes("cli_workspace_smoke_env"), false);
  assert.equal(serialized.includes("tenant_workspace_smoke_env"), false);
  assert.equal(serialized.includes("integration-smoke-env-workspace"), false);
});

test("Feishu smoke-env template treats generated public URL placeholders as missing", () => {
  const report = buildFeishuSmokeEnvTemplateReport({
    workspaceId: "workspace-1",
    appUrl: "CHANGE_ME_PUBLIC_AGENTSPACE_URL",
    integrations: [
      buildIntegrationRecord({
        id: "integration-smoke-env-placeholder-url",
        displayName: "Smoke Env Placeholder Url",
        agentId: "Codex",
        appId: "cli_smoke_env",
      }),
    ],
  });

  assert.deepEqual(report.issues, ["app_url_missing"]);
  assert.equal(report.appUrl, undefined);
  assert.equal(
    readSmokeEnvEntry(report, "FEISHU_SMOKE_CALLBACK_URL")?.value,
    "CHANGE_ME_AGENTSPACE_CALLBACK_URL",
  );
  const output = formatFeishuSmokeEnvCommandText(report);
  assert.equal(output.stdout, undefined);
  assert.match(output.stderr ?? "", /app_url_missing/);
  assert.doesNotMatch(output.stderr ?? "", /CHANGE_ME_PUBLIC_AGENTSPACE_URL/);
  assert.equal(getFeishuSmokeEnvExitCode(report), 1);
});

test("Feishu smoke-env text output does not print env template when integration is missing", () => {
  const report = buildFeishuSmokeEnvTemplateReport({
    workspaceId: "workspace-empty",
    integrationId: "integration-missing",
    appUrl: "https://agentspace.example.com",
    integrations: [],
  });
  const output = formatFeishuSmokeEnvCommandText(report);

  assert.equal(output.stdout, undefined);
  assert.match(output.stderr ?? "", /integration_missing/);
  assert.doesNotMatch(output.stderr ?? "", /FEISHU_APP_SECRET/);
  assert.equal(getFeishuSmokeEnvExitCode(report), 1);
});

test("Feishu CLI binding helpers create sanitized binding reports", () => {
  const integration = buildIntegrationRecord({
    id: "integration-bind",
    displayName: "Binding Feishu",
  });
  const audits: unknown[] = [];
  const readIntegration = () => integration;
  const readChannel = () => ({ name: "general" }) as never;
  const readMembership = () => ({ userId: "user-1" }) as never;
  const resourceUpserts: unknown[] = [];
  const auditRecorder = (input: unknown) => {
    audits.push(input);
    return true;
  };

  const channel = createFeishuChannelBindingForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-bind",
    channelName: "general",
    externalChatId: "oc_secret_binding",
    externalChatName: "Secret Launch Chat",
  }, {
    readIntegration,
    readChannel,
    readBindingByExternalChat: () => null,
    upsertBinding: (input) => ({
      id: "channel-binding-1",
      integrationId: input.integrationId,
      channelName: input.channelName,
      status: input.status,
    }) as never,
    auditRecorder,
  });

  const user = createFeishuUserBindingForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-bind",
    userId: "user-1",
    externalUserId: "ou_secret_binding",
    externalUnionId: "on_secret_binding",
  }, {
    readIntegration,
    readMembership,
    readBindingByExternalUser: () => null,
    upsertBinding: (input) => ({
      id: "user-binding-1",
      integrationId: input.integrationId,
      userId: input.userId,
      status: input.status,
    }) as never,
    auditRecorder,
  });

  const resource = createFeishuResourceBindingForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-bind",
    providerResourceType: "sheet",
    resourceUrlOrToken: "https://example.feishu.cn/sheets/shtcn_secret_binding",
    agentSpaceResourceType: "data_table",
    channelName: "general",
    displayName: "Launch Sheet",
    allowWrite: true,
    guestReadable: true,
  }, {
    readIntegration,
    readChannel,
    resolveResourceDescriptor: () => ({
      providerResourceType: "sheet",
      providerResourceToken: "shtcn_secret_binding",
      providerResourceUrl: "https://example.feishu.cn/sheets/shtcn_secret_binding",
      metadata: {},
    }),
    syncDataTable: () => ({
      table: {
        id: "data-table-1",
        channelName: "general",
      },
      created: true,
    }) as never,
    readBindingByResourceKey: () => null,
    upsertBinding: (input) => {
      resourceUpserts.push(input);
      return {
        id: "resource-binding-1",
        integrationId: input.integrationId,
        providerResourceType: input.providerResourceType,
        agentSpaceResourceType: input.agentSpaceResourceType,
        agentSpaceResourceId: input.agentSpaceResourceId,
        channelName: input.channelName,
        status: input.status,
      } as never;
    },
    auditRecorder,
  });

  assert.deepEqual(channel, {
    ok: true,
    kind: "channel",
    workspaceId: "workspace-1",
    integrationId: "integration-bind",
    bindingId: "channel-binding-1",
    status: "active",
    externalIdRedacted: true,
    auditRecorded: true,
    channelName: "general",
  });
  assert.deepEqual(user, {
    ok: true,
    kind: "user",
    workspaceId: "workspace-1",
    integrationId: "integration-bind",
    bindingId: "user-binding-1",
    status: "active",
    externalIdRedacted: true,
    auditRecorded: true,
    userId: "user-1",
  });
  assert.deepEqual(resource, {
    ok: true,
    kind: "resource",
    workspaceId: "workspace-1",
    integrationId: "integration-bind",
    bindingId: "resource-binding-1",
    status: "active",
    externalIdRedacted: true,
    auditRecorded: true,
    channelName: "general",
    providerResourceType: "sheet",
    agentSpaceResourceType: "data_table",
    agentSpaceResourceId: "data-table-1",
  });

  const serialized = JSON.stringify({ channel, user, resource });
  assert.equal(serialized.includes("oc_secret_binding"), false);
  assert.equal(serialized.includes("ou_secret_binding"), false);
  assert.equal(serialized.includes("on_secret_binding"), false);
  assert.equal(serialized.includes("shtcn_secret_binding"), false);
  assert.equal(serialized.includes("Secret Launch Chat"), false);
  assert.deepEqual(resourceUpserts.map((input) => (input as { permissionsJson?: unknown }).permissionsJson), [
    { canRead: true, canWrite: true, externalGuestReadable: true },
  ]);

  const auditJson = JSON.stringify(audits);
  assert.equal(audits.length, 3);
  assert.match(auditJson, /workspace\.external_channel_binding_upserted/);
  assert.match(auditJson, /workspace\.external_user_binding_upserted/);
  assert.match(auditJson, /workspace\.external_resource_binding_upserted/);
  assert.match(auditJson, /"writeAllowed":true/);
  assert.match(auditJson, /"guestReadable":true/);
  assert.match(auditJson, /"externalIdRedacted":true/);
  assert.equal(auditJson.includes("oc_secret_binding"), false);
  assert.equal(auditJson.includes("ou_secret_binding"), false);
  assert.equal(auditJson.includes("on_secret_binding"), false);
  assert.equal(auditJson.includes("shtcn_secret_binding"), false);
  assert.equal(auditJson.includes("Secret Launch Chat"), false);
});

test("Feishu CLI resource binding accepts legacy Docs URLs", () => {
  const integration = buildIntegrationRecord({
    id: "integration-bind-docs",
    displayName: "Binding Feishu Docs",
  });
  const syncedResources: unknown[] = [];
  const upserts: unknown[] = [];

  const resource = createFeishuResourceBindingForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-bind-docs",
    providerResourceType: "doc",
    resourceUrlOrToken: "https://example.feishu.cn/docs/doc_legacy-456?from=copy",
    agentSpaceResourceType: "channel_document",
    channelName: "general",
    allowWrite: true,
  }, {
    readIntegration: () => integration,
    readChannel: () => ({ name: "general" }) as never,
    syncChannelDocument: (input) => {
      syncedResources.push(input);
      return {
        document: {
          id: "doc-resource-1",
          channelName: input.channelName,
        },
        created: true,
      } as never;
    },
    readBindingByResourceKey: () => null,
    upsertBinding: (input) => {
      upserts.push(input);
      return {
        id: "resource-binding-doc-legacy",
        integrationId: input.integrationId,
        providerResourceType: input.providerResourceType,
        providerResourceToken: input.providerResourceToken,
        agentSpaceResourceType: input.agentSpaceResourceType,
        agentSpaceResourceId: input.agentSpaceResourceId,
        channelName: input.channelName,
        status: input.status,
      } as never;
    },
    auditRecorder: () => true,
  });

  assert.equal(resource.providerResourceType, "doc");
  assert.equal(resource.agentSpaceResourceType, "channel_document");
  assert.equal(resource.agentSpaceResourceId, "doc-resource-1");
  assert.equal(resource.externalIdRedacted, true);
  assert.equal((syncedResources[0] as { providerResourceToken?: string }).providerResourceToken, "doc_legacy-456");
  assert.equal((upserts[0] as { providerResourceToken?: string }).providerResourceToken, "doc_legacy-456");
  assert.equal(((upserts[0] as { metadataJson?: Record<string, unknown> }).metadataJson)?.docType, "doc");
  assert.equal(JSON.stringify(resource).includes("doc_legacy-456"), false);
});

test("Feishu CLI binding helpers reject generated placeholder values before writes", () => {
  const integration = buildIntegrationRecord({
    id: "integration-bind",
    displayName: "Binding Feishu",
  });
  let upsertCalled = false;
  let auditCalled = false;
  let resolveCalled = false;

  assert.throws(() => createFeishuChannelBindingForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-bind",
    channelName: "CHANGE_ME_AGENTSPACE_CHANNEL",
    externalChatId: "CHANGE_ME_FEISHU_CHAT_ID",
  }, {
    readIntegration: () => integration,
    readChannel: () => ({ name: "general" }) as never,
    readBindingByExternalChat: () => null,
    upsertBinding: () => {
      upsertCalled = true;
      throw new Error("channel binding should not be written");
    },
    auditRecorder: () => {
      auditCalled = true;
      return true;
    },
  }), /feishu\.bind_channel\.placeholder_value/);

  assert.throws(() => createFeishuUserBindingForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-bind",
    userId: "CHANGE_ME_AGENTSPACE_USER_ID",
    externalUserId: "CHANGE_ME_FEISHU_OPEN_ID",
  }, {
    readIntegration: () => integration,
    readMembership: () => ({ userId: "user-1" }) as never,
    readBindingByExternalUser: () => null,
    upsertBinding: () => {
      upsertCalled = true;
      throw new Error("user binding should not be written");
    },
    auditRecorder: () => {
      auditCalled = true;
      return true;
    },
  }), /feishu\.bind_user\.placeholder_value/);

  assert.throws(() => createFeishuResourceBindingForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-bind",
    providerResourceType: "sheet",
    resourceUrlOrToken: "CHANGE_ME_FEISHU_SHEET_URL_OR_TOKEN",
    agentSpaceResourceType: "data_table",
    channelName: "CHANGE_ME_AGENTSPACE_CHANNEL",
    allowWrite: true,
  }, {
    readIntegration: () => integration,
    readChannel: () => ({ name: "general" }) as never,
    resolveResourceDescriptor: () => {
      resolveCalled = true;
      throw new Error("placeholder resource should not be resolved");
    },
    upsertBinding: () => {
      upsertCalled = true;
      throw new Error("resource binding should not be written");
    },
    auditRecorder: () => {
      auditCalled = true;
      return true;
    },
  }), /feishu\.bind_resource\.placeholder_value/);

  assert.equal(resolveCalled, false);
  assert.equal(upsertCalled, false);
  assert.equal(auditCalled, false);
});

test("Feishu agent bot CLI returns redacted JSON for successful bindings", () => {
  let createInput: Record<string, unknown> | undefined;
  const result = createFeishuAgentBotBindingForCli({
    workspaceId: "workspace-1",
    agentId: "Codex",
    displayName: "Codex Feishu Bot",
    transportMode: "websocket_worker",
    appId: "cli_codex_bot",
    appSecret: "secret_agent_bot",
    channelAutoProvisioning: {
      botAdded: "auto_create_channel",
      firstMessage: "auto_create_if_bot_mentioned",
      reviewStatus: "approved",
    },
    externalGuestPolicy: {
      unboundUserMode: "reply_on_mention",
      guestPermissionProfile: "channel_context_only",
      requireIdentityFor: ["writes", "approvals"],
    },
  }, {
    createBinding: (input) => {
      createInput = input as unknown as Record<string, unknown>;
      return buildIntegrationRecord({
        id: "agent-bot-codex",
        displayName: input.displayName,
        transportMode: input.transportMode,
        agentId: input.agentId,
        appId: input.appId,
        encryptedCredentialsJson: JSON.stringify({ appSecret: "encrypted" }),
      }) as never;
    },
  });

  assert.deepEqual(createInput?.channelAutoProvisioning, {
    botAdded: "auto_create_channel",
    firstMessage: "auto_create_if_bot_mentioned",
    reviewStatus: "approved",
  });
  assert.deepEqual(createInput?.externalGuestPolicy, {
    unboundUserMode: "reply_on_mention",
    guestPermissionProfile: "channel_context_only",
    requireIdentityFor: ["writes", "approvals"],
  });
  assert.deepEqual(result, {
    ok: true,
    kind: "agent_bot",
    operation: "created",
    workspaceId: "workspace-1",
    integrationId: "agent-bot-codex",
    agentId: "Codex",
    displayName: "Codex Feishu Bot",
    status: "active",
    transportMode: "websocket_worker",
    appId: "cli_codex_bot",
    tenantKeyConfigured: false,
    credentials: {
      hasAppSecret: true,
      hasVerificationToken: false,
      hasEncryptKey: false,
    },
    channelAutoProvisioning: {
      botAdded: "auto_create_channel",
      firstMessage: "auto_create_if_bot_mentioned",
      reviewStatus: "approved",
    },
    externalGuestPolicy: {
      unboundUserMode: "reply_on_mention",
      guestPermissionProfile: "channel_context_only",
      requireIdentityFor: [
        "writes",
        "approvals",
        "private_resources",
        "runtime_sensitive_tools",
      ],
    },
    secretRedacted: true,
    nextCommands: {
      healthCheck: "agent-space integrations feishu health-check --workspace-id workspace-1 --agent Codex --strict --json",
      botReadiness: "agent-space integrations feishu agent-bot-readiness --workspace-id workspace-1 --agent Codex --strict --require bot --json",
      dataPlaneReadiness: "agent-space integrations feishu agent-bot-readiness --workspace-id workspace-1 --agent Codex --strict --require data-plane --json",
      workerReadiness: "agent-space integrations feishu agent-bot-readiness --workspace-id workspace-1 --agent Codex --strict --require worker --json",
      autoProvisionPolicy: "agent-space integrations feishu auto-provision-policy --workspace-id workspace-1 --agent Codex --bot-added-policy auto_create_channel --first-message-policy auto_create_if_bot_mentioned --unbound-user-mode reply_on_mention --guest-permission-profile channel_context_only --json",
      agentChannelAccessDisable: "agent-space integrations feishu agent-channel-access --workspace-id workspace-1 --agent Codex --access disabled --json",
      agentChannelAccessRestore: "agent-space integrations feishu agent-channel-access --workspace-id workspace-1 --agent Codex --access enabled --json",
      channelBindings: "agent-space integrations feishu channel-bindings --workspace-id workspace-1 --integration agent-bot-codex --json",
      smokeEnv: "agent-space integrations feishu smoke-env --workspace-id workspace-1 --integration agent-bot-codex --app-url CHANGE_ME_PUBLIC_AGENTSPACE_URL > scripts/feishu/.env",
      checkEnv: "npm run smoke:feishu -- --env-file scripts/feishu/.env --check-env --json --require-todo120-native",
      strictLiveSmoke: "npm run smoke:feishu -- --env-file scripts/feishu/.env --live --strict-live --evidence runtime-output/feishu-smoke/live.json --json --require-todo120-native",
      verifyOpenApiEvidence: "npm run smoke:feishu -- --verify-evidence runtime-output/feishu-smoke/live.json --json",
      verifyBotAddedPayload: "npm run smoke:feishu -- --verify-bot-added-payload runtime-output/feishu-smoke/bot-added-callback.json --bot-added-payload-evidence runtime-output/feishu-smoke/bot-added-payload-evidence.json --json",
      smokePlan: "agent-space integrations feishu smoke-plan --workspace-id workspace-1 --integration agent-bot-codex --app-url CHANGE_ME_PUBLIC_AGENTSPACE_URL",
      finalEvidence: "agent-space integrations feishu evidence --workspace-id workspace-1 --integration agent-bot-codex --openapi-evidence runtime-output/feishu-smoke/live.json --bot-added-payload-evidence runtime-output/feishu-smoke/bot-added-payload-evidence.json --strict --require all",
      bindSecondAgentBot: "agent-space integrations feishu bind-agent-bot --workspace-id workspace-1 --agent CHANGE_ME_SECOND_AGENT_NAME --env-file scripts/feishu/.env --app-id-env FEISHU_SECOND_AGENT_APP_ID --app-secret-env FEISHU_SECOND_AGENT_APP_SECRET --json",
    },
  });
  assert.equal(JSON.stringify(result).includes("secret_agent_bot"), false);
});

test("Feishu agent bot command returns structured JSON for generated placeholders", async () => {
  const logs = await captureConsoleLog(async () => {
    const exitCode = await runFeishuIntegrationCommand([
      "bind-agent-bot",
      "--workspace-id",
      "workspace-1",
      "--agent",
      "Codex",
      "--app-id",
      "CHANGE_ME_FEISHU_APP_ID",
      "--app-secret",
      "secret_agent_bot",
      "--json",
    ], "json");
    assert.equal(exitCode, 1);
  });
  const output = JSON.parse(logs.join("\n")) as {
    ok: boolean;
    errorCode: string;
    errorMessage: string;
    nextStep: string;
  };

  assert.equal(output.ok, false);
  assert.equal(output.errorCode, "feishu.agent_bot_binding.placeholder_value");
  assert.match(output.errorMessage, /app_id/);
  assert.match(output.nextStep, /Replace app_id with the real value/);
  assert.equal(JSON.stringify(output).includes("CHANGE_ME_FEISHU_APP_ID"), false);
  assert.equal(JSON.stringify(output).includes("secret_agent_bot"), false);
});

test("Feishu CLI channel binding rejects chats already mapped to another AgentSpace channel", () => {
  const integration = buildIntegrationRecord({
    id: "integration-bind",
    displayName: "Binding Feishu",
  });
  const audits: unknown[] = [];
  const upserts: unknown[] = [];

  assert.throws(() => createFeishuChannelBindingForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-bind",
    channelName: "general",
    externalChatId: "oc_taken",
  }, {
    readIntegration: () => integration,
    readChannel: () => ({ name: "general" }) as never,
    readBindingByExternalChat: () => ({
      id: "channel-binding-2",
      integrationId: "integration-bind",
      channelName: "launch",
      externalChatId: "oc_taken",
      status: "active",
    }) as never,
    upsertBinding: (input) => {
      upserts.push(input);
      return input as never;
    },
    auditRecorder: (input) => {
      audits.push(input);
      return true;
    },
  }), /feishu\.bind_channel\.external_chat_taken/);

  assert.equal(upserts.length, 0);
  assert.equal(audits.length, 0);
});

test("Feishu channel-bindings report lists redacted chat mappings", () => {
  const report = buildFeishuChannelBindingsCliReport({
    workspaceId: "workspace-1",
    integrations: [
      buildIntegrationRecord({
        id: "agent-bot-codex",
        displayName: "Codex Feishu Bot",
        agentId: "Codex",
        transportMode: "websocket_worker",
      }),
      buildIntegrationRecord({
        id: "agent-bot-hermes",
        displayName: "Hermes Feishu Bot",
        agentId: "HermesAgent",
        transportMode: "websocket_worker",
      }),
    ],
    channelBindingsByIntegrationId: {
      "agent-bot-codex": [
        buildChannelBinding("agent-bot-codex", {
          id: "binding-codex-general",
          externalChatId: "oc_secret_general",
          externalChatType: "group",
          externalChatName: "Launch Room",
          metadataJson: JSON.stringify({
            provider: "feishu",
            provisionSource: "bot_added",
            reviewStatus: "approved",
            agentId: "Codex",
            botBindingId: "agent-bot-codex",
            externalChatReference: "chat-ref-safe",
          }),
        }),
      ],
      "agent-bot-hermes": [
        buildChannelBinding("agent-bot-hermes", {
          id: "binding-hermes-general",
          externalChatId: "oc_secret_general",
          metadataJson: JSON.stringify({
            provider: "feishu",
            provisionSource: "bot_added",
            reviewStatus: "approved",
            agentId: "HermesAgent",
            botBindingId: "agent-bot-hermes",
            linkedFromBindingId: "binding-codex-general",
            linkedFromAgentId: "Codex",
            linkedFromBotBindingId: "agent-bot-codex",
            externalChatReference: "chat-ref-safe",
          }),
        }),
      ],
    },
  });

  assert.equal(report.integrationCount, 2);
  assert.equal(report.bindingCount, 2);
  assert.equal(report.activeBindingCount, 2);
  assert.equal(report.externalIdsRedacted, true);
  assert.deepEqual(report.integrations.map((item) => item.agentId), ["Codex", "HermesAgent"]);
  assert.equal(report.bindings[0]?.externalChatReference, report.bindings[1]?.externalChatReference);
  assert.match(report.bindings[0]?.externalChatReference ?? "", /^chat:[a-f0-9]{16}$/);
  assert.equal(report.bindings[0]?.externalChatIdRedacted, true);
  assert.equal(report.bindings[0]?.provisionSource, "bot_added");
  assert.equal(report.bindings[1]?.linkedFromBindingId, "binding-codex-general");
  assert.equal(report.bindings[1]?.linkedFromAgentId, "Codex");
  assert.equal(report.bindings[1]?.linkedFromBotBindingId, "agent-bot-codex");
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("oc_secret_general"), false);
  assert.equal(serialized.includes("oc_"), false);
});

test("Feishu CLI user binding rejects Open IDs already bound to another AgentSpace user", () => {
  const integration = buildIntegrationRecord({
    id: "integration-bind",
    displayName: "Binding Feishu",
  });
  const audits: unknown[] = [];
  const upserts: unknown[] = [];

  assert.throws(() => createFeishuUserBindingForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-bind",
    userId: "user-1",
    externalUserId: "ou_taken",
  }, {
    readIntegration: () => integration,
    readMembership: () => ({ userId: "user-1" }) as never,
    readBindingByExternalUser: () => ({
      id: "user-binding-2",
      integrationId: "integration-bind",
      userId: "user-2",
      externalUserId: "ou_taken",
      status: "active",
    }) as never,
    upsertBinding: (input) => {
      upserts.push(input);
      return input as never;
    },
    auditRecorder: (input) => {
      audits.push(input);
      return true;
    },
  }), /feishu\.bind_user\.external_user_taken/);

  assert.equal(upserts.length, 0);
  assert.equal(audits.length, 0);
});

test("Feishu CLI resource binding rejects resources already bound to another AgentSpace target", () => {
  const integration = buildIntegrationRecord({
    id: "integration-bind",
    displayName: "Binding Feishu",
  });
  const audits: unknown[] = [];
  const upserts: unknown[] = [];
  let syncCalled = false;

  assert.throws(() => createFeishuResourceBindingForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-bind",
    providerResourceType: "sheet",
    resourceUrlOrToken: "https://example.feishu.cn/sheets/shtcn_taken",
    agentSpaceResourceType: "data_table",
    channelName: "general",
    allowWrite: true,
  }, {
    readIntegration: () => integration,
    readChannel: () => ({ name: "general" }) as never,
    resolveResourceDescriptor: () => ({
      providerResourceType: "sheet",
      providerResourceToken: "shtcn_taken",
      providerResourceUrl: "https://example.feishu.cn/sheets/shtcn_taken",
      metadata: {},
    }),
    readBindingByResourceKey: () => ({
      id: "resource-binding-2",
      integrationId: "integration-bind",
      providerResourceType: "sheet",
      providerResourceToken: "shtcn_taken",
      agentSpaceResourceType: "data_table",
      agentSpaceResourceId: "data-table-launch",
      channelName: "launch",
      status: "active",
    }) as never,
    syncDataTable: () => {
      syncCalled = true;
      throw new Error("data table should not be synced");
    },
    upsertBinding: (input) => {
      upserts.push(input);
      return input as never;
    },
    auditRecorder: (input) => {
      audits.push(input);
      return true;
    },
  }), /feishu\.bind_resource\.external_resource_taken/);

  assert.equal(syncCalled, false);
  assert.equal(upserts.length, 0);
  assert.equal(audits.length, 0);
});

test("Feishu CLI resource binding refuses resources when integration scopes are incomplete", () => {
  const integration = buildIntegrationRecord({
    id: "integration-bind-missing-scope",
    scopesJson: JSON.stringify(["im:message"]),
  });
  let syncCalled = false;
  let upsertCalled = false;
  let auditCalled = false;

  assert.throws(() => createFeishuResourceBindingForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-bind-missing-scope",
    providerResourceType: "sheet",
    resourceUrlOrToken: "https://example.feishu.cn/sheets/shtcn_secret_binding",
    agentSpaceResourceType: "data_table",
    channelName: "general",
    allowWrite: true,
  }, {
    readIntegration: () => integration,
    readChannel: () => ({ name: "general" }) as never,
    resolveResourceDescriptor: () => ({
      providerResourceType: "sheet",
      providerResourceToken: "shtcn_secret_binding",
      providerResourceUrl: "https://example.feishu.cn/sheets/shtcn_secret_binding",
      metadata: {},
    }),
    syncDataTable: () => {
      syncCalled = true;
      return {
        table: {
          id: "data-table-1",
          channelName: "general",
        },
        created: true,
      } as never;
    },
    upsertBinding: () => {
      upsertCalled = true;
      throw new Error("binding should not be written");
    },
    auditRecorder: () => {
      auditCalled = true;
      return true;
    },
  }), /feishu\.bind_resource\.scope_missing/);

  assert.equal(syncCalled, false);
  assert.equal(upsertCalled, false);
  assert.equal(auditCalled, false);
});

test("Feishu CLI resource binding refuses Base table ids without app token context", () => {
  const integration = buildIntegrationRecord({
    id: "integration-bind-base-incomplete",
  });
  let syncCalled = false;
  let upsertCalled = false;
  let auditCalled = false;

  assert.throws(() => createFeishuResourceBindingForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-bind-base-incomplete",
    providerResourceType: "base_table",
    resourceUrlOrToken: "tbl_secret_binding",
    agentSpaceResourceType: "data_table",
    channelName: "general",
    allowWrite: true,
  }, {
    readIntegration: () => integration,
    readChannel: () => ({ name: "general" }) as never,
    resolveResourceDescriptor: () => ({
      providerResourceType: "base_table",
      providerResourceToken: "tbl_secret_binding",
      metadata: {
        tableId: "tbl_secret_binding",
      },
    }),
    syncDataTable: () => {
      syncCalled = true;
      throw new Error("data table should not be synced");
    },
    upsertBinding: () => {
      upsertCalled = true;
      throw new Error("binding should not be written");
    },
    auditRecorder: () => {
      auditCalled = true;
      return true;
    },
  }), /feishu\.bind_resource\.base_app_token_missing/);

  assert.equal(syncCalled, false);
  assert.equal(upsertCalled, false);
  assert.equal(auditCalled, false);
});

test("Feishu data-operation CLI reports safe read summaries and governed write plans", async () => {
  const integration = buildIntegrationRecord({
    id: "integration-data",
    displayName: "Data Feishu",
    appId: "cli_data_app",
  });
  const readIntegration = () => integration;
  const resolveResourceDescriptor = (type: string, value: string) => ({
    providerResourceType: type === "doc" ? "doc" : "sheet",
    providerResourceToken: value.includes("shtcn_secret_data") ? "shtcn_secret_data" : value,
    providerResourceUrl: value.startsWith("http") ? value : undefined,
    metadata: {},
  });
  let readClientCreated = false;
  let writePlanClientCreated = false;
  const writeRequests: Array<{
    operationType: string;
    providerResourceType: string;
    providerResourceToken: string;
    parameters: Record<string, unknown>;
  }> = [];

  const read = await runFeishuDataOperationForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-data",
    operation: "read-sheet",
    resourceUrlOrToken: "https://example.feishu.cn/sheets/shtcn_secret_data",
    parameters: {
      range: "Sheet1!A1:B2",
    },
  }, {
    readIntegration,
    resolveResourceDescriptor,
    readCredentials: () => ({
      appSecret: "secret_data_app",
      verificationToken: "verify-data",
    }),
    fetchTenantAccessToken: async () => ({
      tenantAccessToken: "tenant_secret_data",
    }),
    createClient: () => {
      readClientCreated = true;
      return {
        request: async () => ({
          code: 0,
        }),
      } as never;
    },
    executeReadOperation: async ({ client, request }) => {
      await client.request({
        method: "GET",
        path: "/open-apis/sheets/v3/spreadsheets/shtcn_secret_data",
      });
      return {
        runId: "read-run-1",
        resourceBinding: { id: "resource-binding-read" } as never,
        result: {
          ok: true,
          data: {
            responseSummary: {
              code: "tenant_access_token=cli-secret",
              msg: "ok doccn_cli_secret rec_cli_secret",
              hasData: true,
              itemCount: 1,
              documentId: "doccn_cli_secret",
              updatedRange: "Sheet1!A1:B2",
              recordId: "rec_cli_secret",
              recordIds: ["rec_cli_secret", "rec_cli_secret_2"],
            },
            resultPreview: {
              kind: "sheet_values",
              range: request.parameters.range,
              rowCount: 1,
              columnCount: 2,
              rows: [["secret customer", "secret amount"]],
            },
          },
        },
      };
    },
  });

  const write = await runFeishuDataOperationForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-data",
    operation: "plan-sheet-write",
    resourceUrlOrToken: "shtcn_secret_data",
    parameters: {
      range: "Sheet1!A1:B1",
      values: [["secret write value"]],
    },
  }, {
    readIntegration,
    resolveResourceDescriptor,
    planWriteOperation: async ({ client, request }) => {
      writePlanClientCreated = Boolean(client);
      writeRequests.push({
        operationType: request.operationType,
        providerResourceType: request.providerResourceType,
        providerResourceToken: request.providerResourceToken,
        parameters: request.parameters,
      });
      return {
        runId: "write-run-1",
        resourceBinding: { id: "resource-binding-write" } as never,
        result: {
          ok: false,
          errorCode: "feishu.data_operation_requires_approval",
          errorMessage: "Feishu write operations require AgentSpace approval before execution.",
          data: {
            policyDecision: "require_approval",
            payloadHash: "hash-write-1",
            runStatus: "pending",
          },
        },
      };
    },
  });
  const docWrite = await runFeishuDataOperationForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-data",
    operation: "plan-doc-append",
    resourceUrlOrToken: "doccn_secret_data",
    parameters: {
      parentBlockId: "block_secret_parent",
      documentRevisionId: 12,
      clientToken: "doc-client-token-secret",
      blocks: [
        {
          block_type: 2,
          text: {
            elements: [
              {
                text_run: {
                  content: "secret doc write value",
                },
              },
            ],
          },
        },
      ],
    },
  }, {
    readIntegration,
    resolveResourceDescriptor,
    planWriteOperation: async ({ client, request }) => {
      writePlanClientCreated = Boolean(client);
      writeRequests.push({
        operationType: request.operationType,
        providerResourceType: request.providerResourceType,
        providerResourceToken: request.providerResourceToken,
        parameters: request.parameters,
      });
      return {
        runId: "doc-write-run-1",
        resourceBinding: { id: "resource-binding-doc-write" } as never,
        result: {
          ok: false,
          errorCode: "feishu.data_operation_requires_approval",
          errorMessage: "Feishu write operations require AgentSpace approval before execution.",
          data: {
            policyDecision: "require_approval",
            payloadHash: "hash-doc-write-1",
            runStatus: "pending",
          },
        },
      };
    },
  });

  assert.equal(readClientCreated, true);
  assert.equal(writePlanClientCreated, true);
  assert.deepEqual(writeRequests.map((request) => request.operationType), [
    "sheets.update_range",
    "docs.update_document",
  ]);
  assert.deepEqual(writeRequests[1], {
    operationType: "docs.update_document",
    providerResourceType: "doc",
    providerResourceToken: "doccn_secret_data",
    parameters: {
      mutation: "append_blocks",
      parentBlockId: "block_secret_parent",
      documentRevisionId: 12,
      clientToken: "doc-client-token-secret",
      blocks: [
        {
          block_type: 2,
          text: {
            elements: [
              {
                text_run: {
                  content: "secret doc write value",
                },
              },
            ],
          },
        },
      ],
    },
  });
  const readResponseSummary = read.responseSummary as Record<string, unknown>;
  assert.equal(typeof readResponseSummary.documentReference, "string");
  assert.equal(typeof readResponseSummary.recordReference, "string");
  assert.ok(Array.isArray(readResponseSummary.recordReferences));
  assert.deepEqual(read, {
    ok: true,
    workspaceId: "workspace-1",
    integrationId: "integration-data",
    operationType: "sheets.read_range",
    providerResourceType: "sheet",
    externalIdRedacted: true,
    liveApiCalled: true,
    approvalRequired: false,
    runId: "read-run-1",
    runStatus: "succeeded",
    resourceBindingId: "resource-binding-read",
    resultOk: true,
    errorCode: undefined,
    errorMessage: undefined,
    payloadHash: undefined,
    responseSummary: {
      code: "[string-code]",
      messageRedacted: true,
      hasData: true,
      itemCount: 1,
      documentReference: readResponseSummary.documentReference,
      updatedRangeRedacted: true,
      recordReference: readResponseSummary.recordReference,
      recordReferences: readResponseSummary.recordReferences,
    },
    previewSummary: {
      kind: "sheet_values",
      rangeRedacted: true,
      rowCount: 1,
      columnCount: 2,
      previewRowCount: 1,
    },
  });
  assert.deepEqual(write, {
    ok: true,
    workspaceId: "workspace-1",
    integrationId: "integration-data",
    operationType: "sheets.update_range",
    providerResourceType: "sheet",
    externalIdRedacted: true,
    liveApiCalled: false,
    approvalRequired: true,
    runId: "write-run-1",
    runStatus: "pending",
    resourceBindingId: "resource-binding-write",
    resultOk: false,
    errorCode: "feishu.data_operation_requires_approval",
    errorMessage: "Feishu write operations require AgentSpace approval before execution.",
    payloadHash: "hash-write-1",
    responseSummary: undefined,
    previewSummary: undefined,
  });
  assert.deepEqual(docWrite, {
    ok: true,
    workspaceId: "workspace-1",
    integrationId: "integration-data",
    operationType: "docs.update_document",
    providerResourceType: "doc",
    externalIdRedacted: true,
    liveApiCalled: false,
    approvalRequired: true,
    runId: "doc-write-run-1",
    runStatus: "pending",
    resourceBindingId: "resource-binding-doc-write",
    resultOk: false,
    errorCode: "feishu.data_operation_requires_approval",
    errorMessage: "Feishu write operations require AgentSpace approval before execution.",
    payloadHash: "hash-doc-write-1",
    responseSummary: undefined,
    previewSummary: undefined,
  });
  const serialized = JSON.stringify({ read, write, docWrite });
  assert.equal(serialized.includes("shtcn_secret_data"), false);
  assert.equal(serialized.includes("secret_data_app"), false);
  assert.equal(serialized.includes("tenant_secret_data"), false);
  assert.equal(serialized.includes("tenant_access_token=cli-secret"), false);
  assert.equal(serialized.includes("doccn_cli_secret"), false);
  assert.equal(serialized.includes("rec_cli_secret"), false);
  assert.equal(serialized.includes("secret customer"), false);
  assert.equal(serialized.includes("secret write value"), false);
  assert.equal(serialized.includes("secret doc write value"), false);
  assert.equal(serialized.includes("Sheet1!A1:B2"), false);
});

test("Feishu data-operation CLI can create approval requests for governed write plans", async () => {
  const integration = buildIntegrationRecord({
    id: "integration-approval",
    displayName: "Approval Feishu",
    appId: "cli_approval_app",
  });
  const approvals: Array<{
    agentId: string;
    channelName: string;
    contentPreview?: string;
  }> = [];

  const report = await runFeishuDataOperationForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-approval",
    operation: "plan-sheet-write",
    resourceUrlOrToken: "shtcn_secret_approval",
    approvalAgentId: "Atlas",
    approvalChannelName: "general",
    approvalContentPreview: "Write smoke row",
    parameters: {
      range: "Sheet1!A1:B1",
      values: [["secret approval write value"]],
    },
  }, {
    readIntegration: () => integration,
    resolveResourceDescriptor: (type: string, value: string) => ({
      providerResourceType: type,
      providerResourceToken: value,
      metadata: {},
    }),
    planWriteOperationWithApproval: async ({ client, request, approval }) => {
      assert.ok(client);
      assert.equal(request.operationType, "sheets.update_range");
      approvals.push({
        agentId: approval.agentId,
        channelName: approval.channelName,
        contentPreview: approval.contentPreview,
      });
      return {
        runId: "write-run-approval",
        resourceBinding: { id: "resource-binding-approval" } as never,
        approval: { id: "approval-feishu-write" } as never,
        result: {
          ok: false,
          errorCode: "feishu.data_operation_requires_approval",
          errorMessage: "Feishu write operations require AgentSpace approval before execution.",
          data: {
            policyDecision: "require_approval",
            payloadHash: "hash-approval-write",
            runStatus: "pending",
            approvalId: "approval-feishu-write",
          },
        },
      };
    },
  });

  assert.deepEqual(approvals, [{
    agentId: "Atlas",
    channelName: "general",
    contentPreview: "Write smoke row",
  }]);
  assert.deepEqual(report, {
    ok: true,
    workspaceId: "workspace-1",
    integrationId: "integration-approval",
    operationType: "sheets.update_range",
    providerResourceType: "sheet",
    externalIdRedacted: true,
    liveApiCalled: false,
    approvalRequired: true,
    approvalId: "approval-feishu-write",
    approvalStatus: "pending",
    runId: "write-run-approval",
    runStatus: "pending",
    resourceBindingId: "resource-binding-approval",
    resultOk: false,
    errorCode: "feishu.data_operation_requires_approval",
    errorMessage: "Feishu write operations require AgentSpace approval before execution.",
    payloadHash: "hash-approval-write",
    responseSummary: undefined,
    previewSummary: undefined,
  });
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("shtcn_secret_approval"), false);
  assert.equal(serialized.includes("secret approval write value"), false);
});

test("Feishu data-operation CLI rejects incomplete approval request context", async () => {
  const integration = buildIntegrationRecord({
    id: "integration-approval-missing",
    displayName: "Approval Missing Feishu",
  });
  let planCalled = false;

  const report = await runFeishuDataOperationForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-approval-missing",
    operation: "plan-sheet-write",
    resourceUrlOrToken: "shtcn_secret_approval_missing",
    approvalAgentId: "Atlas",
    parameters: {
      range: "Sheet1!A1:B1",
      values: [["secret incomplete approval value"]],
    },
  }, {
    readIntegration: () => integration,
    resolveResourceDescriptor: (type: string, value: string) => ({
      providerResourceType: type,
      providerResourceToken: value,
      metadata: {},
    }),
    planWriteOperationWithApproval: async () => {
      planCalled = true;
      throw new Error("approval plan should not run");
    },
  });

  assert.equal(planCalled, false);
  assert.equal(report.ok, false);
  assert.equal(report.errorCode, "feishu.data_operation_approval_channel_missing");
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("shtcn_secret_approval_missing"), false);
  assert.equal(serialized.includes("secret incomplete approval value"), false);
});

test("Feishu data-operation approval review CLI summarizes approved write execution safely", async () => {
  const report = await runFeishuDataOperationApprovalReviewForCli({
    workspaceId: "workspace-1",
    approvalId: "approval-feishu-write",
    decision: "approve",
    reviewerComment: "Looks good",
  }, {
    reviewApproval: async (input) => {
      assert.equal(input.workspaceId, "workspace-1");
      assert.equal(input.approvalId, "approval-feishu-write");
      assert.equal(input.decision, "approved");
      assert.equal(input.reviewerComment, "Looks good");
      return {
        approval: {
          id: "approval-feishu-write",
          status: "approved",
        } as never,
        execution: {
          runId: "write-run-approved",
          result: {
            ok: true,
            data: {
              policyDecision: "approved",
              approvalId: "approval-feishu-write",
              payloadHash: "hash-approved-write",
              responseSummary: {
                code: 0,
                msg: "ok doccn_secret shtcn_secret rec_secret",
                updatedRange: "Sheet1!A1:B1",
                recordId: "rec_secret",
              },
              resultPreview: {
                kind: "sheet_values",
                range: "Sheet1!A1:B1",
                rowCount: 1,
                columnCount: 2,
                rows: [["secret approved write value"]],
              },
            },
          },
        },
      };
    },
  });

  const responseSummary = report.execution?.responseSummary as Record<string, unknown>;
  assert.equal(typeof responseSummary.recordReference, "string");
  assert.deepEqual(report, {
    ok: true,
    workspaceId: "workspace-1",
    approvalId: "approval-feishu-write",
    decision: "approved",
    approvalStatus: "approved",
    externalIdRedacted: true,
    execution: {
      runId: "write-run-approved",
      resultOk: true,
      runStatus: "succeeded",
      errorCode: undefined,
      errorMessage: undefined,
      payloadHash: "hash-approved-write",
      responseSummary: {
        code: 0,
        messageRedacted: true,
        updatedRangeRedacted: true,
        recordReference: responseSummary.recordReference,
      },
      previewSummary: {
        kind: "sheet_values",
        rangeRedacted: true,
        rowCount: 1,
        columnCount: 2,
        previewRowCount: 1,
      },
    },
  });
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("doccn_secret"), false);
  assert.equal(serialized.includes("shtcn_secret"), false);
  assert.equal(serialized.includes("rec_secret"), false);
  assert.equal(serialized.includes("Sheet1!A1:B1"), false);
  assert.equal(serialized.includes("secret approved write value"), false);
});

test("Feishu data-operation approval review CLI supports rejection without execution", async () => {
  const report = await runFeishuDataOperationApprovalReviewForCli({
    workspaceId: "workspace-1",
    approvalId: "approval-feishu-reject",
    decision: "rejected",
  }, {
    reviewApproval: async (input) => {
      assert.equal(input.decision, "rejected");
      return {
        approval: {
          id: "approval-feishu-reject",
          status: "rejected",
        } as never,
      };
    },
  });

  assert.deepEqual(report, {
    ok: true,
    workspaceId: "workspace-1",
    approvalId: "approval-feishu-reject",
    decision: "rejected",
    approvalStatus: "rejected",
    externalIdRedacted: true,
    execution: undefined,
  });
});

test("Feishu data-operation approval review CLI rejects placeholders and invalid decisions before review", async () => {
  let reviewCalled = false;
  const placeholder = await runFeishuDataOperationApprovalReviewForCli({
    workspaceId: "workspace-1",
    approvalId: "CHANGE_ME_FEISHU_APPROVAL_ID",
    decision: "approved",
  }, {
    reviewApproval: async () => {
      reviewCalled = true;
      throw new Error("review should not run");
    },
  });
  const invalidDecision = await runFeishuDataOperationApprovalReviewForCli({
    workspaceId: "workspace-1",
    approvalId: "approval-feishu-write",
    decision: "maybe",
  }, {
    reviewApproval: async () => {
      reviewCalled = true;
      throw new Error("review should not run");
    },
  });

  assert.equal(reviewCalled, false);
  assert.deepEqual(placeholder, {
    ok: false,
    workspaceId: "workspace-1",
    approvalId: "unknown",
    externalIdRedacted: true,
    errorCode: "feishu.data_operation_review.placeholder_value",
    errorMessage: "Feishu data-operation review approval-id contains a placeholder value; replace CHANGE_ME_* placeholders before rerunning.",
  });
  assert.deepEqual(invalidDecision, {
    ok: false,
    workspaceId: "workspace-1",
    approvalId: "approval-feishu-write",
    externalIdRedacted: true,
    errorCode: "feishu.data_operation_review.invalid_decision",
    errorMessage: "Feishu data-operation review decision must be approved or rejected.",
  });
});

test("Feishu data-operation CLI preserves Doc URL type metadata", async () => {
  const integration = buildIntegrationRecord({
    id: "integration-data-wiki",
    displayName: "Data Feishu Wiki",
  });
  const capturedRequests: Array<{
    operationType: string;
    providerResourceType: string;
    providerResourceToken: string;
    parameters: Record<string, unknown>;
  }> = [];

  const result = await runFeishuDataOperationForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-data-wiki",
    operation: "docs.refresh_metadata",
    providerResourceType: "doc",
    resourceUrlOrToken: "https://example.feishu.cn/wiki/wiki_node-456",
  }, {
    readIntegration: () => integration,
    executeReadOperation: async ({ request }) => {
      capturedRequests.push({
        operationType: request.operationType,
        providerResourceType: request.providerResourceType,
        providerResourceToken: request.providerResourceToken,
        parameters: request.parameters,
      });
      return {
        runId: "wiki-refresh-run-1",
        resourceBinding: { id: "resource-binding-wiki" } as never,
        result: {
          ok: true,
          data: {
            responseSummary: {
              code: 0,
            },
          },
        },
      };
    },
  });

  assert.deepEqual(capturedRequests, [{
    operationType: "docs.refresh_metadata",
    providerResourceType: "doc",
    providerResourceToken: "wiki_node-456",
    parameters: {
      docType: "wiki",
    },
  }]);
  assert.equal(result.ok, true);
  assert.equal(result.externalIdRedacted, true);
  assert.equal(JSON.stringify(result).includes("wiki_node-456"), false);
});

test("Feishu data-operation CLI parses Doc write flags into governed operation parameters", () => {
  const parameters = buildFeishuCliDataOperationParameters({
    title: "secret launch plan",
    "folder-token": "fld_secret",
    "parent-block-id": "blk_parent_secret",
    "block-id": "blk_target_secret",
    "document-revision-id": "42",
    "client-token": "client_token_secret",
    "user-id-type": "open_id",
    index: "1",
    "blocks-json": "[{\"block_type\":2}]",
    "block-json": "{\"block_type\":2}",
    "body-json": "{\"replace_text\":\"secret\"}",
    "update-json": "{\"patch\":\"secret\"}",
  });

  assert.deepEqual(parameters, {
    title: "secret launch plan",
    folderToken: "fld_secret",
    parentBlockId: "blk_parent_secret",
    blockId: "blk_target_secret",
    documentRevisionId: 42,
    clientToken: "client_token_secret",
    userIdType: "open_id",
    index: 1,
    blocks: [{ block_type: 2 }],
    block: { block_type: 2 },
    body: { replace_text: "secret" },
    update: { patch: "secret" },
  });
});

test("Feishu data-operation CLI does not touch Feishu network when local binding validation denies a read", async () => {
  const integration = buildIntegrationRecord({
    id: "integration-data",
    displayName: "Data Feishu",
    appId: "cli_data_app",
  });
  let credentialReadCount = 0;
  let tenantTokenRequestCount = 0;
  let clientCreateCount = 0;

  const result = await runFeishuDataOperationForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-data",
    operation: "read-sheet",
    resourceUrlOrToken: "shtcn_unbound_secret_data",
    parameters: {
      range: "Sheet1!A1:B2",
    },
  }, {
    readIntegration: () => integration,
    resolveResourceDescriptor: (_type, value) => ({
      providerResourceType: "sheet",
      providerResourceToken: value,
      metadata: {},
    }),
    readCredentials: () => {
      credentialReadCount += 1;
      return {
        appSecret: "secret_data_app",
        verificationToken: "verify-data",
      };
    },
    fetchTenantAccessToken: async () => {
      tenantTokenRequestCount += 1;
      return {
        tenantAccessToken: "tenant_secret_data",
      };
    },
    createClient: () => {
      clientCreateCount += 1;
      return {
        request: async () => {
          throw new Error("network should not be touched");
        },
      } as never;
    },
    executeReadOperation: async () => ({
      runId: "denied-run-1",
      result: {
        ok: false,
        errorCode: "feishu.data_operation_resource_unbound",
        errorMessage: "Feishu data operation requires an active AgentSpace resource binding.",
        data: {
          bindingSuggestion: {
            providerResourceType: "sheet",
          },
        },
      },
    }),
  });

  assert.equal(credentialReadCount, 0);
  assert.equal(tenantTokenRequestCount, 0);
  assert.equal(clientCreateCount, 0);
  assert.equal(result.ok, false);
  assert.equal(result.liveApiCalled, false);
  assert.equal(result.errorCode, "feishu.data_operation_resource_unbound");
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("shtcn_unbound_secret_data"), false);
  assert.equal(serialized.includes("secret_data_app"), false);
  assert.equal(serialized.includes("tenant_secret_data"), false);
});

test("Feishu data-operation CLI rejects generated placeholders before local state or network access", async () => {
  let readIntegrationCalled = false;
  let resolveCalled = false;
  let readOperationCalled = false;
  let writePlanCalled = false;
  const deps = {
    readIntegration: () => {
      readIntegrationCalled = true;
      return buildIntegrationRecord({ id: "integration-data" }) as never;
    },
    resolveResourceDescriptor: () => {
      resolveCalled = true;
      throw new Error("placeholder resource should not be resolved");
    },
    executeReadOperation: async () => {
      readOperationCalled = true;
      throw new Error("read operation should not be called");
    },
    planWriteOperation: async () => {
      writePlanCalled = true;
      throw new Error("write plan should not be created");
    },
  };

  const resourceResult = await runFeishuDataOperationForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-data",
    operation: "read-doc",
    resourceUrlOrToken: "CHANGE_ME_FEISHU_DOC_URL_OR_TOKEN",
  }, deps);
  const parameterResult = await runFeishuDataOperationForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-data",
    operation: "query-base",
    providerResourceType: "base_table",
    resourceUrlOrToken: "https://example.feishu.cn/base/bascn_safe?table=tbl_safe",
    parameters: {
      appToken: "CHANGE_ME_FEISHU_BASE_APP_TOKEN",
    },
  }, deps);
  const integrationResult = await runFeishuDataOperationForCli({
    workspaceId: "workspace-1",
    integrationId: "CHANGE_ME_FEISHU_INTEGRATION_ID",
    operation: "read-sheet",
    resourceUrlOrToken: "shtcn_safe",
  }, deps);

  assert.equal(readIntegrationCalled, false);
  assert.equal(resolveCalled, false);
  assert.equal(readOperationCalled, false);
  assert.equal(writePlanCalled, false);
  assert.equal(resourceResult.ok, false);
  assert.equal(resourceResult.liveApiCalled, false);
  assert.equal(resourceResult.errorCode, "feishu.data_operation.placeholder_value");
  assert.match(resourceResult.errorMessage ?? "", /resource/);
  assert.equal(parameterResult.errorCode, "feishu.data_operation.placeholder_value");
  assert.match(parameterResult.errorMessage ?? "", /parameters\.appToken/);
  assert.equal(integrationResult.integrationId, "unknown");
  const serialized = JSON.stringify({ resourceResult, parameterResult, integrationResult });
  assert.equal(serialized.includes("CHANGE_ME_FEISHU_DOC_URL_OR_TOKEN"), false);
  assert.equal(serialized.includes("CHANGE_ME_FEISHU_BASE_APP_TOKEN"), false);
  assert.equal(serialized.includes("CHANGE_ME_FEISHU_INTEGRATION_ID"), false);
});

test("Feishu data-operation command returns structured JSON for generated placeholders", async () => {
  const logs = await captureConsoleLog(async () => {
    const exitCode = await runFeishuIntegrationCommand([
      "data-operation",
      "--workspace-id",
      "workspace-1",
      "--integration",
      "integration-data",
      "--operation",
      "read-doc",
      "--resource",
      "CHANGE_ME_FEISHU_DOC_URL_OR_TOKEN",
      "--json",
    ], "json");
    assert.equal(exitCode, 1);
  });
  const output = JSON.parse(logs.join("\n")) as {
    ok: boolean;
    errorCode: string;
    errorMessage: string;
    liveApiCalled: boolean;
  };

  assert.equal(output.ok, false);
  assert.equal(output.liveApiCalled, false);
  assert.equal(output.errorCode, "feishu.data_operation.placeholder_value");
  assert.match(output.errorMessage, /resource/);
  assert.equal(JSON.stringify(output).includes("CHANGE_ME_FEISHU_DOC_URL_OR_TOKEN"), false);
});

test("Feishu data-operation CLI rejects raw Base table ids without app token before network access", async () => {
  const integration = buildIntegrationRecord({
    id: "integration-data",
    displayName: "Data Feishu",
    appId: "cli_data_app",
  });
  let readOperationCalled = false;

  const result = await runFeishuDataOperationForCli({
    workspaceId: "workspace-1",
    integrationId: "integration-data",
    operation: "query-base",
    resourceUrlOrToken: "tbl_secret_data",
  }, {
    readIntegration: () => integration,
    executeReadOperation: async () => {
      readOperationCalled = true;
      throw new Error("read operation should not be called");
    },
  });

  assert.equal(readOperationCalled, false);
  assert.equal(result.ok, false);
  assert.equal(result.liveApiCalled, false);
  assert.equal(result.errorCode, "feishu.data_operation_base_app_token_missing");
  assert.equal(JSON.stringify(result).includes("tbl_secret_data"), false);
});

test("Feishu readiness report summarizes manual smoke prerequisites without external ids", () => {
  const report = buildFeishuReadinessReport({
    workspaceId: "workspace-1",
    integrations: [
      buildIntegrationRecord({
        id: "integration-ready",
        displayName: "Ready Feishu",
        lastHealthStatus: "healthy",
        transportMode: "websocket_worker",
      }),
      buildIntegrationRecord({
        id: "integration-missing",
        displayName: "Missing Feishu",
        appId: undefined,
        encryptedCredentialsJson: "{}",
      }),
    ],
    channelBindingsByIntegrationId: {
      "integration-ready": [buildChannelBinding("integration-ready")],
      "integration-missing": [],
    },
    userBindingsByIntegrationId: {
      "integration-ready": [buildUserBinding("integration-ready")],
      "integration-missing": [],
    },
    resourceBindingsByIntegrationId: {
      "integration-ready": [
        buildResourceBinding("integration-ready", "doc", "doccn_secret"),
        buildResourceBinding("integration-ready", "sheet", "shtcn_secret"),
        buildResourceBinding("integration-ready", "base_table", "tbl_secret"),
      ],
      "integration-missing": [],
    },
    failedOutboxByIntegrationId: {
      "integration-ready": [],
      "integration-missing": [buildOutboxItem("integration-missing", "failed")],
    },
    pendingOutboxByIntegrationId: {
      "integration-ready": [],
      "integration-missing": [buildOutboxItem("integration-missing", "pending")],
    },
  });

  assert.equal(report.integrationCount, 2);
  assert.equal(report.requiredReadiness, "bot");
  assert.equal(report.strictSatisfied, true);
  assert.equal(report.readyForBotSmokeCount, 1);
  assert.equal(report.readyForDataPlaneSmokeCount, 1);
  assert.equal(report.readyForWorkerSmokeCount, 1);
  const ready = report.integrations.find((item) => item.id === "integration-ready");
  assert.equal(ready?.readyForBotSmoke, true);
  assert.equal(ready?.readyForDataPlaneSmoke, true);
  assert.equal(ready?.readyForWorkerSmoke, true);
  assert.deepEqual(ready?.resourceBindings, {
    active: 3,
    total: 3,
    doc: 1,
    docWritable: 1,
    sheet: 1,
    sheetWritable: 1,
    base: 1,
    baseReady: 1,
    baseWritable: 1,
  });
  assert.deepEqual(ready?.scopes, {
    configuredCount: FEISHU_TEST_SCOPES.length,
    missingForBotSmoke: [],
    missingForDataPlaneSmoke: [],
  });
  const readyCredentialCheck = ready?.setupChecks.find((check) => check.key === "credentials");
  assert.equal(readyCredentialCheck?.status, "ready");
  assert.equal(readyCredentialCheck?.current, "complete");
  assert.equal(readyCredentialCheck?.required, "app_id/app_secret");
  assert.deepEqual(readyCredentialCheck?.issues, []);
  assert.equal(ready?.setupChecks.find((check) => check.key === "chat_binding")?.status, "ready");
  assert.equal(ready?.setupChecks.find((check) => check.key === "doc_binding")?.status, "ready");
  assert.equal(ready?.setupChecks.find((check) => check.key === "sheet_binding")?.status, "ready");
  assert.equal(ready?.setupChecks.find((check) => check.key === "base_binding")?.status, "ready");
  assert.equal(ready?.setupChecks.find((check) => check.key === "outbox")?.status, "ready");

  const missing = report.integrations.find((item) => item.id === "integration-missing");
  assert.equal(missing?.readyForBotSmoke, false);
  assert.equal(missing?.readyForDataPlaneSmoke, false);
  const missingCredentialCheck = missing?.setupChecks.find((check) => check.key === "credentials");
  assert.equal(missingCredentialCheck?.status, "missing");
  assert.deepEqual(missingCredentialCheck?.issues, [
    "app_id_missing",
    "app_secret_missing",
    "verification_token_missing",
  ]);
  assert.equal(missing?.setupChecks.find((check) => check.key === "chat_binding")?.status, "missing");
  assert.equal(missing?.setupChecks.find((check) => check.key === "user_binding")?.status, "missing");
  assert.equal(missing?.setupChecks.find((check) => check.key === "outbox")?.status, "attention");
  assert.deepEqual(missing?.issues, [
    "app_id_missing",
    "credentials_incomplete",
    "health_not_checked",
    "channel_binding_missing",
    "user_binding_missing",
    "doc_resource_binding_missing",
    "sheet_resource_binding_missing",
    "base_resource_binding_missing",
    "outbox_failed_items",
    "outbox_retry_errors",
  ]);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("oc_secret"), false);
  assert.equal(serialized.includes("ou_secret"), false);
  assert.equal(serialized.includes("doccn_secret"), false);
  assert.equal(serialized.includes("shtcn_secret"), false);
  assert.equal(serialized.includes("tbl_secret"), false);
  assert.equal(serialized.includes("payload-secret"), false);
});

test("Feishu readiness treats WebSocket agent bots with app credentials as complete", () => {
  const report = buildFeishuReadinessReport({
    workspaceId: "workspace-1",
    integrations: [
      buildIntegrationRecord({
        id: "agent-bot-codex",
        displayName: "Codex Feishu Bot",
        agentId: "Codex",
        lastHealthStatus: "healthy",
        transportMode: "websocket_worker",
        encryptedCredentialsJson: JSON.stringify({
          appSecret: "encrypted-app-secret",
        }),
      }),
    ],
    channelBindingsByIntegrationId: {
      "agent-bot-codex": [buildChannelBinding("agent-bot-codex", {
        agentId: "Codex",
        botBindingId: "agent-bot-codex",
      })],
    },
    userBindingsByIntegrationId: {
      "agent-bot-codex": [buildUserBinding("agent-bot-codex")],
    },
    resourceBindingsByIntegrationId: {
      "agent-bot-codex": [],
    },
    failedOutboxByIntegrationId: {
      "agent-bot-codex": [],
    },
    pendingOutboxByIntegrationId: {
      "agent-bot-codex": [],
    },
  });

  assert.equal(report.readyForBotSmokeCount, 1);
  assert.equal(report.readyForWorkerSmokeCount, 1);
  const agentBot = report.integrations.find((item) => item.id === "agent-bot-codex");
  assert.equal(agentBot?.credentialsConfigured, true);
  assert.equal(agentBot?.readyForBotSmoke, true);
  assert.equal(agentBot?.readyForWorkerSmoke, true);
  assert.deepEqual(agentBot?.setupChecks.find((check) => check.key === "credentials"), {
    key: "credentials",
    status: "ready",
    current: "complete",
    required: "app_id/app_secret",
    issues: [],
  });
});

test("Feishu readiness report requires writable Doc, Sheet, and Base bindings for data-plane smoke", () => {
  const report = buildFeishuReadinessReport({
    workspaceId: "workspace-1",
    requiredReadiness: "data-plane",
    integrations: [
      buildIntegrationRecord({
        id: "integration-read-only-resources",
        displayName: "Read-only Feishu",
        lastHealthStatus: "healthy",
      }),
    ],
    channelBindingsByIntegrationId: {
      "integration-read-only-resources": [buildChannelBinding("integration-read-only-resources")],
    },
    userBindingsByIntegrationId: {
      "integration-read-only-resources": [buildUserBinding("integration-read-only-resources")],
    },
    resourceBindingsByIntegrationId: {
      "integration-read-only-resources": [
        buildReadOnlyResourceBinding("integration-read-only-resources", "doc", "doccn_secret"),
        buildReadOnlyResourceBinding("integration-read-only-resources", "sheet", "shtcn_secret"),
        buildReadOnlyResourceBinding("integration-read-only-resources", "base_table", "tbl_secret"),
      ],
    },
    failedOutboxByIntegrationId: {
      "integration-read-only-resources": [],
    },
    pendingOutboxByIntegrationId: {
      "integration-read-only-resources": [],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.readyForBotSmokeCount, 1);
  assert.equal(report.readyForDataPlaneSmokeCount, 0);
  const [item] = report.integrations;
  assert.deepEqual(item?.resourceBindings, {
    active: 3,
    total: 3,
    doc: 1,
    docWritable: 0,
    sheet: 1,
    sheetWritable: 0,
    base: 1,
    baseReady: 1,
    baseWritable: 0,
  });
  assert.equal(item?.setupChecks.find((check) => check.key === "doc_binding")?.status, "attention");
  assert.equal(item?.setupChecks.find((check) => check.key === "sheet_binding")?.status, "attention");
  assert.equal(item?.setupChecks.find((check) => check.key === "base_binding")?.status, "attention");
  assert.ok(item?.issues.includes("doc_resource_write_grant_missing"));
  assert.ok(item?.issues.includes("sheet_resource_write_grant_missing"));
  assert.ok(item?.issues.includes("base_resource_write_grant_missing"));
});

test("Feishu readiness report can enforce bot, data-plane, or worker gates", () => {
  const integrations = [buildIntegrationRecord({
    id: "integration-bot-only",
    displayName: "Bot Only Feishu",
    lastHealthStatus: "degraded",
  })];
  const shared = {
    workspaceId: "workspace-1",
    integrations,
    channelBindingsByIntegrationId: {
      "integration-bot-only": [buildChannelBinding("integration-bot-only")],
    },
    userBindingsByIntegrationId: {
      "integration-bot-only": [buildUserBinding("integration-bot-only")],
    },
    resourceBindingsByIntegrationId: {
      "integration-bot-only": [],
    },
    failedOutboxByIntegrationId: {
      "integration-bot-only": [],
    },
    pendingOutboxByIntegrationId: {
      "integration-bot-only": [],
    },
  };

  const botReport = buildFeishuReadinessReport({
    ...shared,
    requiredReadiness: "bot",
  });
  assert.equal(botReport.readyForBotSmokeCount, 1);
  assert.equal(botReport.readyForDataPlaneSmokeCount, 0);
  assert.equal(botReport.readyForWorkerSmokeCount, 0);
  assert.equal(botReport.strictSatisfied, true);

  const dataPlaneReport = buildFeishuReadinessReport({
    ...shared,
    requiredReadiness: "data-plane",
  });
  assert.equal(dataPlaneReport.requiredReadiness, "data-plane");
  assert.equal(dataPlaneReport.readyForBotSmokeCount, 1);
  assert.equal(dataPlaneReport.readyForDataPlaneSmokeCount, 0);
  assert.equal(dataPlaneReport.strictSatisfied, false);

  const workerBlockedReport = buildFeishuReadinessReport({
    ...shared,
    requiredReadiness: "worker",
  });
  assert.equal(workerBlockedReport.requiredReadiness, "worker");
  assert.equal(workerBlockedReport.readyForWorkerSmokeCount, 0);
  assert.equal(workerBlockedReport.strictSatisfied, false);

  const workerReadyReport = buildFeishuReadinessReport({
    ...shared,
    requiredReadiness: "worker",
    integrations: [buildIntegrationRecord({
      id: "integration-worker",
      displayName: "Worker Feishu",
      lastHealthStatus: "degraded",
      transportMode: "websocket_worker",
    })],
    channelBindingsByIntegrationId: {
      "integration-worker": [buildChannelBinding("integration-worker")],
    },
    userBindingsByIntegrationId: {
      "integration-worker": [buildUserBinding("integration-worker")],
    },
    resourceBindingsByIntegrationId: {
      "integration-worker": [],
    },
    failedOutboxByIntegrationId: {
      "integration-worker": [],
    },
    pendingOutboxByIntegrationId: {
      "integration-worker": [],
    },
  });
  assert.equal(workerReadyReport.readyForWorkerSmokeCount, 1);
  assert.equal(workerReadyReport.integrations[0]?.readyForWorkerSmoke, true);
  assert.equal(workerReadyReport.strictSatisfied, true);
});

test("Feishu readiness report blocks strict smoke until health is checked", () => {
  const report = buildFeishuReadinessReport({
    workspaceId: "workspace-1",
    requiredReadiness: "bot",
    integrations: [
      buildIntegrationRecord({
        id: "integration-unchecked",
        displayName: "Unchecked Feishu",
        agentId: "Codex",
      }),
    ],
    channelBindingsByIntegrationId: {
      "integration-unchecked": [buildChannelBinding("integration-unchecked")],
    },
    userBindingsByIntegrationId: {
      "integration-unchecked": [buildUserBinding("integration-unchecked")],
    },
    resourceBindingsByIntegrationId: {
      "integration-unchecked": [
        buildResourceBinding("integration-unchecked", "doc", "doccn_secret"),
        buildResourceBinding("integration-unchecked", "sheet", "shtcn_secret"),
        buildResourceBinding("integration-unchecked", "base", "app_secret"),
      ],
    },
    failedOutboxByIntegrationId: {
      "integration-unchecked": [],
    },
    pendingOutboxByIntegrationId: {
      "integration-unchecked": [],
    },
  });

  const [item] = report.integrations;
  assert.equal(report.readyForBotSmokeCount, 0);
  assert.equal(report.strictSatisfied, false);
  assert.equal(item?.healthStatus, "unknown");
  assert.equal(item?.readyForBotSmoke, false);
  assert.equal(item?.readyForDataPlaneSmoke, false);
  assert.deepEqual(item?.issues, ["health_not_checked"]);
});

test("Feishu readiness report blocks live smoke when outbox has unresolved failures", () => {
  const report = buildFeishuReadinessReport({
    workspaceId: "workspace-1",
    requiredReadiness: "worker",
    integrations: [
      buildIntegrationRecord({
        id: "integration-outbox-failed",
        displayName: "Outbox Failed Feishu",
        lastHealthStatus: "healthy",
        transportMode: "websocket_worker",
      }),
    ],
    channelBindingsByIntegrationId: {
      "integration-outbox-failed": [buildChannelBinding("integration-outbox-failed")],
    },
    userBindingsByIntegrationId: {
      "integration-outbox-failed": [buildUserBinding("integration-outbox-failed")],
    },
    resourceBindingsByIntegrationId: {
      "integration-outbox-failed": [
        buildResourceBinding("integration-outbox-failed", "doc", "doccn_secret"),
        buildResourceBinding("integration-outbox-failed", "sheet", "shtcn_secret"),
        buildResourceBinding("integration-outbox-failed", "base", "app_secret"),
      ],
    },
    failedOutboxByIntegrationId: {
      "integration-outbox-failed": [buildOutboxItem("integration-outbox-failed", "failed")],
    },
    pendingOutboxByIntegrationId: {
      "integration-outbox-failed": [buildOutboxItem("integration-outbox-failed", "pending")],
    },
  });

  const [item] = report.integrations;
  assert.equal(report.strictSatisfied, false);
  assert.equal(report.readyForBotSmokeCount, 0);
  assert.equal(report.readyForDataPlaneSmokeCount, 0);
  assert.equal(report.readyForWorkerSmokeCount, 0);
  assert.equal(item?.readyForBotSmoke, false);
  assert.equal(item?.readyForDataPlaneSmoke, false);
  assert.equal(item?.readyForWorkerSmoke, false);
  assert.ok(item?.issues.includes("outbox_failed_items"));
  assert.ok(item?.issues.includes("outbox_retry_errors"));
});

test("Feishu readiness report blocks Base table bindings that lack app token metadata", () => {
  const report = buildFeishuReadinessReport({
    workspaceId: "workspace-1",
    requiredReadiness: "data-plane",
    integrations: [
      buildIntegrationRecord({
        id: "integration-base-incomplete",
        displayName: "Incomplete Base Feishu",
        lastHealthStatus: "healthy",
      }),
    ],
    channelBindingsByIntegrationId: {
      "integration-base-incomplete": [buildChannelBinding("integration-base-incomplete")],
    },
    userBindingsByIntegrationId: {
      "integration-base-incomplete": [buildUserBinding("integration-base-incomplete")],
    },
    resourceBindingsByIntegrationId: {
      "integration-base-incomplete": [
        buildResourceBinding("integration-base-incomplete", "doc", "doccn_secret"),
        buildResourceBinding("integration-base-incomplete", "sheet", "shtcn_secret"),
        buildResourceBindingWithMetadata("integration-base-incomplete", "base_table", "tbl_secret", "{}"),
      ],
    },
    failedOutboxByIntegrationId: {
      "integration-base-incomplete": [],
    },
    pendingOutboxByIntegrationId: {
      "integration-base-incomplete": [],
    },
  });

  const [item] = report.integrations;
  assert.equal(report.readyForDataPlaneSmokeCount, 0);
  assert.equal(report.strictSatisfied, false);
  assert.equal(item?.readyForDataPlaneSmoke, false);
  assert.equal(item?.resourceBindings.base, 1);
  assert.equal(item?.resourceBindings.baseReady, 0);
  assert.ok(item?.issues.includes("base_resource_app_token_missing"));
  const baseCheck = item?.setupChecks.find((check) => check.key === "base_binding");
  assert.equal(baseCheck?.status, "attention");
  assert.deepEqual(baseCheck?.issues, ["base_resource_app_token_missing"]);
});

test("Feishu agent bot readiness filters to agent-scoped bindings", () => {
  const report = buildFeishuReadinessReport({
    workspaceId: "workspace-1",
    agentId: "Codex",
    agentOnly: true,
    integrations: [
      buildIntegrationRecord({
        id: "workspace-integration",
        displayName: "Workspace Feishu",
      }),
      buildIntegrationRecord({
        id: "agent-bot-codex",
        displayName: "Codex Feishu Bot",
        agentId: "Codex",
        transportMode: "websocket_worker",
      }),
      buildIntegrationRecord({
        id: "agent-bot-hermes",
        displayName: "Hermes Feishu Bot",
        agentId: "HermesAgent",
        transportMode: "websocket_worker",
      }),
    ],
    channelBindingsByIntegrationId: {
      "agent-bot-codex": [],
    },
    userBindingsByIntegrationId: {
      "agent-bot-codex": [],
    },
    resourceBindingsByIntegrationId: {
      "agent-bot-codex": [],
    },
    failedOutboxByIntegrationId: {
      "agent-bot-codex": [],
    },
    pendingOutboxByIntegrationId: {
      "agent-bot-codex": [],
    },
  });

  assert.equal(report.integrationCount, 1);
  assert.deepEqual(report.integrations.map((item) => item.id), ["agent-bot-codex"]);
  assert.equal(report.integrations[0]?.transportMode, "websocket_worker");
});

test("Feishu smoke plan converts readiness into live smoke checklist without external ids", () => {
  const report = buildFeishuSmokePlanReport({
    workspaceId: "workspace-1",
    requiredReadiness: "data-plane",
    appUrl: "https://agentspace.test/root?ignored=1#frag",
    runtimeEnv: {
      AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY: FEISHU_TEST_CREDENTIAL_ENCRYPTION_KEY,
    },
    integrations: [
      buildIntegrationRecord({
        id: "integration-ready",
        displayName: "Ready Feishu",
        agentId: "Codex",
        appId: "cli_codex_bot",
        lastHealthStatus: "healthy",
        transportMode: "websocket_worker",
      }),
      buildIntegrationRecord({
        id: "integration-unchecked",
        displayName: "Unchecked Feishu",
        agentId: "Codex",
      }),
      buildIntegrationRecord({
        id: "agent-bot-hermes",
        displayName: "HermesAgent Bot",
        agentId: "HermesAgent",
        appId: "cli_hermes_bot",
        lastHealthStatus: "healthy",
        transportMode: "websocket_worker",
      }),
    ],
    channelBindingsByIntegrationId: {
      "integration-ready": [buildChannelBinding("integration-ready")],
      "integration-unchecked": [buildChannelBinding("integration-unchecked")],
      "agent-bot-hermes": [],
    },
    userBindingsByIntegrationId: {
      "integration-ready": [buildUserBinding("integration-ready")],
      "integration-unchecked": [buildUserBinding("integration-unchecked")],
      "agent-bot-hermes": [],
    },
    resourceBindingsByIntegrationId: {
      "integration-ready": [
        buildResourceBinding("integration-ready", "doc", "doccn_secret"),
        buildResourceBinding("integration-ready", "sheet", "shtcn_secret"),
        buildResourceBinding("integration-ready", "base_table", "tbl_secret"),
      ],
      "integration-unchecked": [],
      "agent-bot-hermes": [],
    },
    failedOutboxByIntegrationId: {
      "integration-ready": [],
      "integration-unchecked": [],
      "agent-bot-hermes": [],
    },
    pendingOutboxByIntegrationId: {
      "integration-ready": [],
      "integration-unchecked": [],
      "agent-bot-hermes": [],
    },
  });

  assert.equal(report.strictSatisfied, true);
  assert.equal(report.selectedBotIntegrationId, "integration-ready");
  assert.equal(report.selectedDataPlaneIntegrationId, "integration-ready");
  assert.equal(report.selectedWorkerIntegrationId, "integration-ready");
  assert.equal(report.appSetup.callbackUrlStatus, "ready");
  assert.equal(report.runtimeSetup.credentialEncryption.status, "ready");
  assert.equal(
    report.runtimeSetup.credentialEncryption.configuredEnvName,
    "AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY",
  );
  assert.equal(
    report.appSetup.callbackUrl,
    "https://agentspace.test/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=integration-ready",
  );
  assert.deepEqual(report.appSetup.requiredCredentialFields, [
    "app_id",
    "app_secret",
  ]);
  assert.deepEqual(report.appSetup.requiredEvents, ["im.message.receive_v1", "im.chat.member.bot.added_v1", "card.action.trigger"]);
  assert.deepEqual(report.appSetup.botScopes, [
    "im:message",
    "im:message:send_as_bot",
    "contact:user.base:readonly",
  ]);
  assert.deepEqual(report.appSetup.dataPlaneScopes, [
    "docx:document",
    "drive:drive",
    "sheets:spreadsheet",
    "bitable:app",
  ]);
  assert.equal(report.appSetup.developerConsoleUrl, "https://open.feishu.cn/app");
  assert.deepEqual(report.appSetup.setupSteps.map((step) => step.id), [
    "create_custom_app",
    "enable_bot",
    "configure_event_subscription",
    "grant_bot_scopes",
    "grant_data_plane_scopes",
    "release_or_install_app",
  ]);
  assert.equal(report.readinessSummary.readyForBotSmokeCount, 1);
  assert.equal(report.readinessSummary.readyForDataPlaneSmokeCount, 1);
  assert.equal(report.readinessSummary.readyForWorkerSmokeCount, 1);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.smokeHarness.envExamplePath, "scripts/feishu/env.example");
  assert.equal(report.smokeHarness.envFilePath, "scripts/feishu/.env");
  assert.equal(report.smokeHarness.evidencePath, "runtime-output/feishu-smoke/live.json");
  assert.equal(report.smokeHarness.botAddedPayloadPath, "runtime-output/feishu-smoke/bot-added-callback.json");
  assert.equal(report.smokeHarness.appUrl, "https://agentspace.test/root");
  assert.equal(report.smokeHarness.requiredLiveSteps, 12);
  assert.equal(report.smokeHarness.destructiveLiveChecks, 3);
  assert.deepEqual(report.smokeHarness.destructiveLiveStepNames, [
    "Docs docx append blocks",
    "Sheets write values",
    "Base update record",
  ]);
  assert.equal(
    report.smokeHarness.callbackUrl,
    "https://agentspace.test/api/integrations/feishu/events?workspaceId=workspace-1&integrationId=integration-ready",
  );
  assert.match(report.smokeHarness.prepareEnvCommand, /--app-url https:\/\/agentspace\.test\/root/);
  assert.match(report.smokeHarness.checkEnvCommand, /npm run smoke:feishu/);
  assert.match(report.smokeHarness.checkEnvCommand, /--check-env/);
  assert.match(report.smokeHarness.checkEnvCommand, /--require-todo120-native/);
  assert.match(report.smokeHarness.checkEnvCommand, /--env-file scripts\/feishu\/\.env/);
  assert.match(report.smokeHarness.strictLiveCommand, /npm run smoke:feishu/);
  assert.match(report.smokeHarness.strictLiveCommand, /--strict-live/);
  assert.match(report.smokeHarness.strictLiveCommand, /--evidence runtime-output\/feishu-smoke\/live\.json/);
  assert.match(report.smokeHarness.strictLiveCommand, /--require-todo120-native/);
  assert.match(report.smokeHarness.verifyEvidenceCommand, /--verify-evidence runtime-output\/feishu-smoke\/live\.json/);
  assert.match(
    report.smokeHarness.verifyBotAddedPayloadCommand,
    /--verify-bot-added-payload runtime-output\/feishu-smoke\/bot-added-callback\.json --bot-added-payload-evidence runtime-output\/feishu-smoke\/bot-added-payload-evidence\.json --json/,
  );
  assert.equal(report.workerHarness.integrationId, "integration-ready");
  assert.equal(report.workerHarness.systemdUnitPath, "deploy/systemd/agentspace-feishu-worker.service");
  assert.equal(report.workerHarness.dockerComposePath, "deploy/feishu-worker/docker-compose.yml");
  assert.match(
    report.workerHarness.dryRunCommand,
    /integrations feishu worker --workspace-id workspace-1 --integration integration-ready --dry-run --json/,
  );
  assert.match(
    report.workerHarness.startCommand,
    /integrations feishu worker --workspace-id workspace-1 --integration integration-ready --json/,
  );
  assert.match(report.workerHarness.systemdRestartCommand, /systemctl restart agentspace-feishu-worker/);
  assert.match(report.workerHarness.dockerRestartCommand, /docker compose -f deploy\/feishu-worker\/docker-compose\.yml restart feishu-worker/);
  assert.deepEqual(report.evidenceGates, [
    {
      key: "bot_reply",
      required: "processed_inbound_with_safe_summary + sent_agent_bot_reply_outbox_with_safe_context + same_agent_bot_correlated_reply_mapping",
    },
    {
      key: "native_agent_bot",
      required: "direct_agent_bot_route_with_safe_context + bound_user_bot_mention_with_safe_context + external_guest_bot_mention_with_safe_context + bot_added_auto_provision_with_channel_identity_review_state + first_message_auto_provision_with_channel_identity_review_state + multi_agent_channel_reuse_distinct_binding + thread_task_binding + thread_continuation_without_remention_active_binding + thread_collaboration_distinct_bot_binding + sent_thread_collaboration_card + bot_sender_loop_guard_without_reply + agent_channel_policy_denial_without_reply",
    },
    {
      key: "guest_policy",
      required: "external_guest_reply_on_mention_allow_with_dispatch + external_guest_reply_all_without_mention + external_guest_require_identity_without_dispatch + sent_identity_binding_notice + external_guest_ignore_without_dispatch_or_reply + external_guest_mention_required_without_dispatch_or_reply",
    },
    {
      key: "worker_restart",
      required: "two_correlated_websocket_replies",
    },
    {
      key: "worker_card_action",
      required: "processed_approval_card_action_with_governance_context",
    },
      {
        key: "data_plane",
        required: "bound_governed_doc_read + agent_runtime_doc_read_from_lark_cli_manifest + bound_approved_doc_write + bound_governed_sheet_read + bound_approved_sheet_write_with_agentspace_sync + bound_governed_base_read + bound_approved_base_mutation_with_agentspace_sync + user_actor + external_guest_actor + external_guest_read_guest_readable_current_channel + external_guest_bound_write_denied",
      },
    {
      key: "failure_visibility",
      required: "provider_failure_row + degraded_or_error_health + agent_bot_failure_with_safe_context",
    },
    {
      key: "agentspace_local_evidence",
      required: "fresh_24h_agentspace_local_evidence_rows",
    },
    {
      key: "openapi_artifact",
      required: "fresh_24h_strict_live_artifact:runtime-output/feishu-smoke/live.json",
    },
    {
      key: "bot_added_payload_artifact",
      required: "fresh_24h_bot_added_payload_artifact:runtime-output/feishu-smoke/bot-added-payload-evidence.json",
    },
  ]);

  const credentialEncryption = report.steps.find((step) => step.id === "configure_credential_encryption_key");
  const createDisposableApps = report.steps.find((step) => step.id === "create_disposable_feishu_apps");
  const bindAgentBot = report.steps.find((step) => step.id === "bind_feishu_agent_bot");
  const env = report.steps.find((step) => step.id === "prepare_live_smoke_env");
  const checkEnv = report.steps.find((step) => step.id === "check_live_smoke_env");
  const bindChat = report.steps.find((step) => step.id === "bind_feishu_chat");
  const bindUser = report.steps.find((step) => step.id === "bind_feishu_user");
  const liveBot = report.steps.find((step) => step.id === "live_bot_message_reply");
  const liveDirectMention = report.steps.find((step) => step.id === "live_agent_bot_direct_mention");
  const liveAutoProvision = report.steps.find((step) => step.id === "live_agent_bot_channel_auto_provision");
  const verifyBotAddedPayload = report.steps.find((step) => step.id === "verify_real_bot_added_payload_sample");
  const liveFirstMessageAutoProvision = report.steps.find((step) =>
    step.id === "live_agent_bot_first_message_auto_provision"
  );
  const bindSecondAgentBot = report.steps.find((step) => step.id === "bind_second_feishu_agent_bot");
  const liveMultiAgentReuse = report.steps.find((step) => step.id === "live_multi_agent_bot_channel_reuse");
  const liveThreadCollaboration = report.steps.find((step) => step.id === "live_multi_agent_thread_collaboration");
  const liveThreadTaskBinding = report.steps.find((step) => step.id === "live_feishu_thread_task_binding");
  const liveThreadContinuation = report.steps.find((step) => step.id === "live_feishu_thread_continuation");
  const liveGuestMention = report.steps.find((step) => step.id === "live_external_guest_agent_bot_mention");
  const liveGuestReplyAll = report.steps.find((step) => step.id === "live_external_guest_reply_all");
  const liveGuestIdentityRequired = report.steps.find((step) => step.id === "live_external_guest_identity_required");
  const liveGuestReplyDisabled = report.steps.find((step) => step.id === "live_external_guest_reply_disabled");
  const liveUnmentionedGuestIgnored = report.steps.find((step) => step.id === "live_unmentioned_guest_message_ignored");
  const liveBoundUserDataOperation = report.steps.find((step) => step.id === "live_bound_user_data_operation");
  const liveGuestWriteDenied = report.steps.find((step) => step.id === "live_external_guest_write_denied");
  const liveGuestReadableRead = report.steps.find((step) => step.id === "live_external_guest_read_guest_readable");
  const livePolicyDisabled = report.steps.find((step) => step.id === "live_agent_channel_policy_disabled");
  const liveAgentDocSummary = report.steps.find((step) => step.id === "live_agent_bound_doc_summary");
  const workerDryRun = report.steps.find((step) => step.id === "run_websocket_worker_dry_run");
  const workerReceive = report.steps.find((step) => step.id === "live_websocket_receive_message");
  const workerRestart = report.steps.find((step) => step.id === "live_websocket_worker_restart");
  const bindResources = report.steps.find((step) => step.id === "bind_feishu_doc_sheet_base");
  const liveDocRead = report.steps.find((step) => step.id === "live_doc_read");
  const liveDocWrite = report.steps.find((step) => step.id === "live_doc_write_with_approval");
  const liveSheetRead = report.steps.find((step) => step.id === "live_sheet_read");
  const liveSheet = report.steps.find((step) => step.id === "live_sheet_write_with_approval");
  const liveBase = report.steps.find((step) => step.id === "live_base_preview_and_update");
  const liveHarness = report.steps.find((step) => step.id === "run_openapi_live_smoke_harness");
  const verifyHarness = report.steps.find((step) => step.id === "verify_live_smoke_evidence");
  const failure = report.steps.find((step) => step.id === "live_failure_visibility");
  const agentSpaceEvidence = report.steps.find((step) => step.id === "verify_agentspace_live_evidence");
  assert.equal(credentialEncryption?.status, "done");
  assert.deepEqual(credentialEncryption?.issues, []);
  assert.equal(createDisposableApps?.status, "done");
  assert.deepEqual(createDisposableApps?.issues, []);
  assert.match(createDisposableApps?.detail ?? "", /two Phase 6-ready active AgentSpace agent bot bindings/);
  assert.equal(bindAgentBot?.status, "done");
  assert.match(bindAgentBot?.detail ?? "", /Feishu agent bot binding/);
  assert.equal(env?.status, "pending");
  assert.match(env?.command ?? "", /integrations feishu smoke-env --workspace-id workspace-1 --integration integration-ready/);
  assert.match(env?.command ?? "", /--app-url https:\/\/agentspace\.test\/root/);
  assert.match(env?.command ?? "", /> scripts\/feishu\/\.env/);
  assert.equal(checkEnv?.status, "pending");
  assert.match(checkEnv?.command ?? "", /npm run smoke:feishu/);
  assert.match(checkEnv?.command ?? "", /--check-env/);
  assert.match(bindChat?.command ?? "", /integrations feishu bind-channel --workspace-id workspace-1 --integration integration-ready/);
  assert.match(bindChat?.command ?? "", /--channel CHANGE_ME_AGENTSPACE_CHANNEL --chat-id CHANGE_ME_FEISHU_CHAT_ID/);
  assert.match(bindChat?.title ?? "", /Manual fallback/);
  assert.match(bindChat?.detail ?? "", /automatic/);
  assert.match(bindUser?.command ?? "", /integrations feishu bind-user --workspace-id workspace-1 --integration integration-ready/);
  assert.match(bindUser?.command ?? "", /--user-id CHANGE_ME_AGENTSPACE_USER_ID --open-id CHANGE_ME_FEISHU_OPEN_ID/);
  assert.equal(liveBot?.status, "pending");
  assert.match(liveBot?.detail ?? "", /@Codex Bot/);
  assert.match(liveBot?.detail ?? "", /sent Feishu agent_reply outbox/);
  assert.match(liveBot?.detail ?? "", /safe chat\/thread context/);
  assert.doesNotMatch(liveBot?.detail ?? "", /@AgentSpaceBot/);
  assert.equal(liveDirectMention?.status, "pending");
  assert.match(liveDirectMention?.detail ?? "", /actorType=user/);
  assert.match(liveDirectMention?.detail ?? "", /actorUserId/);
  assert.match(liveDirectMention?.detail ?? "", /safe audit references/);
  assert.match(liveDirectMention?.detail ?? "", /concrete agentId/);
  assert.match(liveDirectMention?.detail ?? "", /without using \/agent/);
  assert.equal(liveAutoProvision?.status, "pending");
  assert.match(liveAutoProvision?.detail ?? "", /provisionSource=bot_added/);
  assert.equal(verifyBotAddedPayload?.status, "pending");
  assert.match(verifyBotAddedPayload?.command ?? "", /--verify-bot-added-payload runtime-output\/feishu-smoke\/bot-added-callback\.json --bot-added-payload-evidence runtime-output\/feishu-smoke\/bot-added-payload-evidence\.json --json/);
  assert.match(verifyBotAddedPayload?.detail ?? "", /disposable Feishu tenant\/app/);
  assert.match(verifyBotAddedPayload?.detail ?? "", /bot-added/);
  assert.match(verifyBotAddedPayload?.detail ?? "", /chat descriptor/);
  assert.match(verifyBotAddedPayload?.detail ?? "", /without raw Feishu ids or group names/);
  assert.equal(liveFirstMessageAutoProvision?.status, "pending");
  assert.match(liveFirstMessageAutoProvision?.detail ?? "", /provisionSource=first_message/);
  assert.match(liveFirstMessageAutoProvision?.detail ?? "", /does not require a \/agent command/);
  assert.equal(bindSecondAgentBot?.status, "done");
  assert.match(bindSecondAgentBot?.detail ?? "", /2 Phase 6-ready agent-scoped Feishu bot bindings/);
  assert.equal(liveMultiAgentReuse?.status, "pending");
  assert.match(liveMultiAgentReuse?.detail ?? "", /linkedFromBindingId/);
  assert.match(liveMultiAgentReuse?.detail ?? "", /linkedFromAgentId/);
  assert.match(liveMultiAgentReuse?.detail ?? "", /linkedFromBotBindingId/);
  assert.equal(liveThreadCollaboration?.status, "pending");
  assert.match(liveThreadCollaboration?.detail ?? "", /same Feishu thread/);
  assert.match(liveThreadCollaboration?.detail ?? "", /threadCollaboration=true/);
  assert.match(liveThreadCollaboration?.detail ?? "", /bot binding ids/);
  assert.match(liveThreadCollaboration?.detail ?? "", /collaboration card/);
  assert.equal(liveThreadTaskBinding?.status, "pending");
  assert.match(liveThreadTaskBinding?.detail ?? "", /taskQueueId/);
  assert.equal(liveThreadContinuation?.status, "pending");
  assert.match(liveThreadContinuation?.detail ?? "", /threadContinuation=true/);
  assert.equal(liveGuestMention?.status, "pending");
  assert.match(liveGuestMention?.detail ?? "", /actorType=external_guest/);
  assert.match(liveGuestMention?.detail ?? "", /permissionProfile=channel_context_only/);
  assert.match(liveGuestMention?.detail ?? "", /no userId\/actorUserId/);
  assert.match(liveGuestMention?.detail ?? "", /task\/message dispatch/);
  assert.match(liveGuestMention?.detail ?? "", /safe audit references/);
  assert.match(liveGuestMention?.detail ?? "", /no real workspace member/);
  assert.match(liveGuestMention?.command ?? "", /auto-provision-policy --workspace-id workspace-1 --agent Codex/);
  assert.match(liveGuestMention?.command ?? "", /--unbound-user-mode reply_on_mention/);
  assert.match(liveGuestMention?.command ?? "", /--guest-permission-profile channel_context_only/);
  assert.match(liveGuestMention?.command ?? "", /--require-identity-for writes,approvals,private_resources,runtime_sensitive_tools/);
  assert.equal(liveGuestReplyAll?.status, "pending");
  assert.match(liveGuestReplyAll?.detail ?? "", /reply_all/);
  assert.match(liveGuestReplyAll?.detail ?? "", /Restore after this smoke step/);
  assert.match(liveGuestReplyAll?.command ?? "", /--unbound-user-mode reply_all/);
  assert.match(liveGuestReplyAll?.command ?? "", /--guest-permission-profile channel_context_only/);
  assert.equal(liveGuestIdentityRequired?.status, "pending");
  assert.match(liveGuestIdentityRequired?.detail ?? "", /require_identity/);
  assert.match(liveGuestIdentityRequired?.detail ?? "", /Restore after this smoke step/);
  assert.match(liveGuestIdentityRequired?.command ?? "", /--unbound-user-mode require_identity/);
  assert.match(liveGuestIdentityRequired?.command ?? "", /--guest-permission-profile none/);
  assert.equal(liveGuestReplyDisabled?.status, "pending");
  assert.match(liveGuestReplyDisabled?.detail ?? "", /ignore decision/);
  assert.match(liveGuestReplyDisabled?.detail ?? "", /permissionProfile=none/);
  assert.match(liveGuestReplyDisabled?.detail ?? "", /Restore after this smoke step/);
  assert.match(liveGuestReplyDisabled?.command ?? "", /--unbound-user-mode ignore/);
  assert.match(liveGuestReplyDisabled?.command ?? "", /--guest-permission-profile none/);
  assert.equal(liveUnmentionedGuestIgnored?.status, "pending");
  assert.match(liveUnmentionedGuestIgnored?.detail ?? "", /bot-mention-required/);
  assert.match(liveUnmentionedGuestIgnored?.command ?? "", /--unbound-user-mode reply_on_mention/);
  assert.equal(liveBoundUserDataOperation?.status, "pending");
  assert.match(liveBoundUserDataOperation?.detail ?? "", /actorType=user/);
  assert.match(liveBoundUserDataOperation?.detail ?? "", /without raw Feishu ids/);
  assert.match(liveBoundUserDataOperation?.command ?? "", /--operation read-doc/);
  assert.equal(liveGuestWriteDenied?.status, "pending");
  assert.match(liveGuestWriteDenied?.detail ?? "", /require_identity/);
  assert.match(liveGuestWriteDenied?.detail ?? "", /permissionProfile=none/);
  assert.match(liveGuestWriteDenied?.detail ?? "", /permissionProfile=channel_context_only/);
  assert.match(liveGuestWriteDenied?.detail ?? "", /Restore after this smoke step/);
  assert.match(liveGuestWriteDenied?.detail ?? "", /does not create a real workspace member/);
  assert.match(liveGuestWriteDenied?.command ?? "", /--unbound-user-mode require_identity/);
  assert.equal(liveGuestReadableRead?.status, "pending");
  assert.match(liveGuestReadableRead?.detail ?? "", /guest-readable/);
  assert.match(liveGuestReadableRead?.detail ?? "", /permissionProfile=channel_context_only/);
  assert.match(liveGuestReadableRead?.detail ?? "", /externalGuestResourceAccess=guest_readable_current_channel/);
  assert.match(liveGuestReadableRead?.command ?? "", /--unbound-user-mode reply_on_mention/);
  assert.match(liveGuestReadableRead?.command ?? "", /--operation read-doc/);
  assert.equal(livePolicyDisabled?.status, "pending");
  assert.match(livePolicyDisabled?.detail ?? "", /without writing a channel message/);
  assert.match(livePolicyDisabled?.detail ?? "", /Restore after this smoke step/);
  assert.match(livePolicyDisabled?.command ?? "", /agent-channel-access --workspace-id workspace-1 --agent Codex --access disabled --json/);
  assert.doesNotMatch(livePolicyDisabled?.command ?? "", /--integration integration-ready/);
  assert.equal(liveAgentDocSummary?.status, "pending");
  assert.match(liveAgentDocSummary?.detail ?? "", /already-bound Feishu Doc/);
  assert.match(liveAgentDocSummary?.detail ?? "", /@Codex Bot/);
  assert.match(liveAgentDocSummary?.detail ?? "", /AgentSpace-scoped lark-cli/);
  assert.match(liveAgentDocSummary?.detail ?? "", /Feishu thread/);
  assert.equal(workerDryRun?.status, "pending");
  assert.match(workerDryRun?.command ?? "", /--dry-run/);
  assert.equal(workerReceive?.status, "pending");
  assert.match(workerReceive?.detail ?? "", /concrete agent bot/);
  assert.match(
    workerReceive?.command ?? "",
    /integrations feishu worker --workspace-id workspace-1 --integration integration-ready --json/,
  );
  assert.match(workerReceive?.detail ?? "", /approval card action/);
  assert.equal(workerRestart?.status, "pending");
  assert.match(workerRestart?.detail ?? "", /reconnects/);
  assert.equal(liveSheet?.status, "pending");
  assert.match(bindResources?.command ?? "", /integrations feishu bind-resource --workspace-id workspace-1 --integration integration-ready/);
  assert.match(bindResources?.command ?? "", /--type doc --resource CHANGE_ME_FEISHU_DOC_URL_OR_TOKEN --agent-space-type channel_document --channel CHANGE_ME_AGENTSPACE_CHANNEL --allow-write/);
  assert.match(bindResources?.command ?? "", /--type sheet --resource CHANGE_ME_FEISHU_SHEET_URL_OR_TOKEN --agent-space-type data_table --channel CHANGE_ME_AGENTSPACE_CHANNEL --allow-write/);
  assert.match(bindResources?.command ?? "", /--type base_table --resource CHANGE_ME_FEISHU_BASE_TABLE_URL_WITH_APP_TOKEN --agent-space-type data_table --channel CHANGE_ME_AGENTSPACE_CHANNEL --allow-write/);
  assert.equal(liveDocRead?.status, "pending");
  assert.match(liveDocRead?.command ?? "", /integrations feishu data-operation --workspace-id workspace-1 --integration integration-ready --operation read-doc/);
  assert.match(liveDocRead?.command ?? "", /--resource CHANGE_ME_FEISHU_DOC_URL_OR_TOKEN --json/);
  assert.match(liveDocRead?.detail ?? "", /active resource binding/);
  assert.match(liveDocRead?.detail ?? "", /Feishu governance context/);
  assert.match(liveDocRead?.detail ?? "", /agentId/);
  assert.match(liveDocRead?.detail ?? "", /botBindingId/);
  assert.match(liveDocRead?.detail ?? "", /actor provenance/);
  assert.match(liveDocRead?.detail ?? "", /raw resource tokens/);
  assert.equal(liveDocWrite?.status, "pending");
  assert.match(liveDocWrite?.detail ?? "", /payload hash/);
  assert.match(liveDocWrite?.command ?? "", /--operation plan-doc-append/);
  assert.match(liveDocWrite?.command ?? "", /--parent-block-id CHANGE_ME_FEISHU_DOC_BLOCK_ID/);
  assert.match(liveDocWrite?.command ?? "", /--approval-agent CHANGE_ME_AGENT_NAME --approval-channel CHANGE_ME_AGENTSPACE_CHANNEL/);
  assert.match(liveDocWrite?.command ?? "", /review-data-operation --workspace-id workspace-1 --approval-id CHANGE_ME_FEISHU_APPROVAL_ID --decision approved --json/);
  assert.equal(liveSheetRead?.status, "pending");
  assert.match(liveSheetRead?.command ?? "", /--operation read-sheet/);
  assert.match(liveSheetRead?.command ?? "", /--range CHANGE_ME_FEISHU_SHEET_RANGE/);
  assert.match(liveSheetRead?.detail ?? "", /safe summary/);
  assert.match(liveSheetRead?.detail ?? "", /active resource binding/);
  assert.match(liveSheetRead?.detail ?? "", /Feishu governance context/);
  assert.match(liveSheetRead?.detail ?? "", /botBindingId/);
  assert.match(liveSheetRead?.detail ?? "", /actor provenance/);
  assert.match(liveSheetRead?.detail ?? "", /raw resource tokens/);
  assert.match(liveSheet?.command ?? "", /--operation plan-sheet-write/);
  assert.match(liveSheet?.command ?? "", /--range CHANGE_ME_FEISHU_SHEET_WRITE_RANGE/);
  assert.match(liveSheet?.command ?? "", /--approval-agent CHANGE_ME_AGENT_NAME --approval-channel CHANGE_ME_AGENTSPACE_CHANNEL/);
  assert.match(liveSheet?.command ?? "", /review-data-operation --workspace-id workspace-1 --approval-id CHANGE_ME_FEISHU_APPROVAL_ID --decision approved --json/);
  assert.equal(liveBase?.status, "pending");
  assert.match(liveBase?.command ?? "", /--operation query-base --resource CHANGE_ME_FEISHU_BASE_TABLE_URL_WITH_APP_TOKEN/);
  assert.match(liveBase?.command ?? "", /--operation plan-base-update --resource CHANGE_ME_FEISHU_BASE_TABLE_URL_WITH_APP_TOKEN/);
  assert.match(liveBase?.command ?? "", /--record-id CHANGE_ME_FEISHU_BASE_RECORD_ID/);
  assert.match(liveBase?.detail ?? "", /approvalId/);
  assert.match(liveBase?.detail ?? "", /payload hash/);
  assert.match(liveBase?.detail ?? "", /active resource binding/);
  assert.match(liveBase?.detail ?? "", /Feishu governance context/);
  assert.match(liveBase?.detail ?? "", /botBindingId/);
  assert.match(liveBase?.detail ?? "", /raw resource tokens/);
  assert.match(liveBase?.detail ?? "", /Feishu Base update/);
  assert.match(liveBase?.command ?? "", /--approval-agent CHANGE_ME_AGENT_NAME --approval-channel CHANGE_ME_AGENTSPACE_CHANNEL/);
  assert.match(liveBase?.command ?? "", /review-data-operation --workspace-id workspace-1 --approval-id CHANGE_ME_FEISHU_APPROVAL_ID --decision approved --json/);
  assert.equal(liveHarness?.status, "pending");
  assert.match(liveHarness?.command ?? "", /npm run smoke:feishu/);
  assert.match(liveHarness?.detail ?? "", /after check-env passes/);
  assert.match(liveHarness?.detail ?? "", /final AgentSpace evidence gate/);
  assert.match(liveHarness?.detail ?? "", /24 hours/);
  assert.doesNotMatch(liveHarness?.detail ?? "", /TODO119/);
  assert.match(liveHarness?.detail ?? "", /12 live checks/);
  assert.match(liveHarness?.detail ?? "", /Docs docx append blocks/);
  assert.match(liveHarness?.detail ?? "", /Sheets write values/);
  assert.match(liveHarness?.detail ?? "", /Base update record/);
  assert.equal(verifyHarness?.status, "pending");
  assert.match(verifyHarness?.command ?? "", /--verify-evidence/);
  assert.match(verifyHarness?.detail ?? "", /generated within 24 hours/);
  assert.match(verifyHarness?.detail ?? "", /12 required/);
  assert.match(verifyHarness?.detail ?? "", /3 destructive write checks/);
  assert.equal(failure?.status, "pending");
  assert.match(failure?.command ?? "", /integrations feishu health-check --workspace-id workspace-1 --integration integration-ready --json/);
  assert.equal(agentSpaceEvidence?.status, "pending");
  assert.match(agentSpaceEvidence?.command ?? "", /--integration integration-ready/);
  assert.match(agentSpaceEvidence?.command ?? "", /--openapi-evidence runtime-output\/feishu-smoke\/live\.json/);
  assert.match(agentSpaceEvidence?.command ?? "", /--bot-added-payload-evidence runtime-output\/feishu-smoke\/bot-added-payload-evidence\.json/);
  assert.match(agentSpaceEvidence?.command ?? "", /--strict --require all$/);
  assert.doesNotMatch(agentSpaceEvidence?.command ?? "", /--json/);
  assert.match(agentSpaceEvidence?.detail ?? "", /Native evidence requires/);
  assert.match(agentSpaceEvidence?.detail ?? "", /two Phase 6-ready agent bot bindings/);
  assert.match(agentSpaceEvidence?.detail ?? "", /worker when using websocket_worker/);
  assert.match(agentSpaceEvidence?.detail ?? "", /generated within 24 hours/);
  assert.match(agentSpaceEvidence?.detail ?? "", /thread continuation/);
  assert.match(agentSpaceEvidence?.detail ?? "", /thread collaboration/);
  assert.match(agentSpaceEvidence?.detail ?? "", /sent card proof/);
  assert.match(agentSpaceEvidence?.detail ?? "", /bot sender loop guard/);
  assert.match(agentSpaceEvidence?.detail ?? "", /reply_all/);
  assert.match(liveSheet?.detail ?? "", /payload hash/);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("oc_secret"), false);
  assert.equal(serialized.includes("ou_secret"), false);
  assert.equal(serialized.includes("doccn_secret"), false);
  assert.equal(serialized.includes("shtcn_secret"), false);
  assert.equal(serialized.includes("tbl_secret"), false);
  assert.equal(serialized.includes("root?ignored"), false);
  assert.equal(serialized.includes("#frag"), false);
});

test("Feishu smoke plan blocks final all evidence gate until a second native agent bot is ready", () => {
  const report = buildFeishuSmokePlanReport({
    workspaceId: "workspace-1",
    requiredReadiness: "data-plane",
    appUrl: "https://agentspace.test",
    runtimeEnv: {
      AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY: FEISHU_TEST_CREDENTIAL_ENCRYPTION_KEY,
    },
    integrations: [
      buildIntegrationRecord({
        id: "agent-bot-codex",
        displayName: "Codex Bot",
        agentId: "Codex",
        appId: "cli_codex_bot",
        lastHealthStatus: "healthy",
        transportMode: "websocket_worker",
      }),
    ],
    channelBindingsByIntegrationId: {
      "agent-bot-codex": [buildChannelBinding("agent-bot-codex")],
    },
    userBindingsByIntegrationId: {
      "agent-bot-codex": [buildUserBinding("agent-bot-codex")],
    },
    resourceBindingsByIntegrationId: {
      "agent-bot-codex": [
        buildResourceBinding("agent-bot-codex", "doc", "doccn_secret"),
        buildResourceBinding("agent-bot-codex", "sheet", "shtcn_secret"),
        buildResourceBinding("agent-bot-codex", "base_table", "tbl_secret"),
      ],
    },
    failedOutboxByIntegrationId: {
      "agent-bot-codex": [],
    },
    pendingOutboxByIntegrationId: {
      "agent-bot-codex": [],
    },
  });

  const createDisposableApps = report.steps.find((step) => step.id === "create_disposable_feishu_apps");
  const bindSecondAgentBot = report.steps.find((step) => step.id === "bind_second_feishu_agent_bot");
  const finalEvidence = report.steps.find((step) => step.id === "verify_agentspace_live_evidence");

  assert.equal(report.readinessSummary.readyForBotSmokeCount, 1);
  assert.equal(report.readinessSummary.readyForDataPlaneSmokeCount, 1);
  assert.equal(createDisposableApps?.status, "pending");
  assert.match(createDisposableApps?.detail ?? "", /Codex Bot and HermesAgent Bot/);
  assert.ok(createDisposableApps?.issues?.includes("second_agent_bot_missing"));
  assert.ok(createDisposableApps?.issues?.includes("second_agent_bot_not_ready"));
  assert.equal(bindSecondAgentBot?.status, "pending");
  assert.equal(finalEvidence?.status, "blocked");
  assert.match(finalEvidence?.detail ?? "", /two Phase 6-ready agent bot bindings/);
  assert.ok(finalEvidence?.issues?.includes("second_agent_bot_missing"));
  assert.ok(finalEvidence?.issues?.includes("second_agent_bot_distinct_agent_missing"));
  assert.match(finalEvidence?.command ?? "", /--strict --require all$/);
  assert.doesNotMatch(finalEvidence?.command ?? "", /--json/);
  assert.match(finalEvidence?.command ?? "", /--bot-added-payload-evidence runtime-output\/feishu-smoke\/bot-added-payload-evidence\.json/);
});

test("Feishu smoke plan checks native multi-agent bot readiness across workspace when one integration is selected", () => {
  const report = buildFeishuSmokePlanReport({
    workspaceId: "workspace-1",
    integrationId: "integration-ready",
    requiredReadiness: "data-plane",
    appUrl: "https://agentspace.test",
    runtimeEnv: {
      AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY: FEISHU_TEST_CREDENTIAL_ENCRYPTION_KEY,
    },
    integrations: [
      buildIntegrationRecord({
        id: "integration-ready",
        displayName: "Ready Feishu",
        agentId: "Codex",
        appId: "cli_codex_bot",
        lastHealthStatus: "healthy",
        transportMode: "websocket_worker",
      }),
      buildIntegrationRecord({
        id: "agent-bot-hermes",
        displayName: "HermesAgent Bot",
        agentId: "HermesAgent",
        appId: "cli_hermes_bot",
        lastHealthStatus: "healthy",
        transportMode: "websocket_worker",
      }),
    ],
    channelBindingsByIntegrationId: {
      "integration-ready": [buildChannelBinding("integration-ready")],
      "agent-bot-hermes": [],
    },
    userBindingsByIntegrationId: {
      "integration-ready": [buildUserBinding("integration-ready")],
      "agent-bot-hermes": [],
    },
    resourceBindingsByIntegrationId: {
      "integration-ready": [
        buildResourceBinding("integration-ready", "doc", "doccn_secret"),
        buildResourceBinding("integration-ready", "sheet", "shtcn_secret"),
        buildResourceBinding("integration-ready", "base_table", "tbl_secret"),
      ],
      "agent-bot-hermes": [],
    },
    failedOutboxByIntegrationId: {
      "integration-ready": [],
      "agent-bot-hermes": [],
    },
    pendingOutboxByIntegrationId: {
      "integration-ready": [],
      "agent-bot-hermes": [],
    },
  });

  const bindSecondAgentBot = report.steps.find((step) => step.id === "bind_second_feishu_agent_bot");
  const liveMultiAgentReuse = report.steps.find((step) => step.id === "live_multi_agent_bot_channel_reuse");
  const liveThreadCollaboration = report.steps.find((step) => step.id === "live_multi_agent_thread_collaboration");
  const agentSpaceEvidence = report.steps.find((step) => step.id === "verify_agentspace_live_evidence");

  assert.equal(report.integrationCount, 1);
  assert.equal(report.selectedBotIntegrationId, "integration-ready");
  assert.equal(report.selectedDataPlaneIntegrationId, "integration-ready");
  assert.equal(bindSecondAgentBot?.status, "done");
  assert.deepEqual(bindSecondAgentBot?.issues, []);
  assert.match(bindSecondAgentBot?.detail ?? "", /2 Phase 6-ready agent-scoped Feishu bot bindings/);
  assert.equal(liveMultiAgentReuse?.status, "pending");
  assert.deepEqual(liveMultiAgentReuse?.issues, []);
  assert.equal(liveThreadCollaboration?.status, "pending");
  assert.deepEqual(liveThreadCollaboration?.issues, []);
  assert.match(agentSpaceEvidence?.command ?? "", /--integration integration-ready/);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("cli_codex_bot"), false);
  assert.equal(serialized.includes("cli_hermes_bot"), false);
  assert.equal(serialized.includes("doccn_secret"), false);
  assert.equal(serialized.includes("shtcn_secret"), false);
  assert.equal(serialized.includes("tbl_secret"), false);
});

test("Feishu smoke plan blocks live smoke steps when local prerequisites are missing", () => {
  const report = buildFeishuSmokePlanReport({
    workspaceId: "workspace-1",
    requiredReadiness: "bot",
    integrations: [
      buildIntegrationRecord({
        id: "integration-unchecked",
        displayName: "Unchecked Feishu",
        agentId: "Codex",
      }),
    ],
    channelBindingsByIntegrationId: {
      "integration-unchecked": [buildChannelBinding("integration-unchecked")],
    },
    userBindingsByIntegrationId: {
      "integration-unchecked": [buildUserBinding("integration-unchecked")],
    },
    resourceBindingsByIntegrationId: {
      "integration-unchecked": [],
    },
    failedOutboxByIntegrationId: {
      "integration-unchecked": [],
    },
    pendingOutboxByIntegrationId: {
      "integration-unchecked": [],
    },
  });

  const health = report.steps.find((step) => step.id === "check_connection_health");
  const botGate = report.steps.find((step) => step.id === "run_bot_readiness_gate");
  const liveBot = report.steps.find((step) => step.id === "live_bot_message_reply");
  const liveDirectMention = report.steps.find((step) => step.id === "live_agent_bot_direct_mention");
  const bindSecondAgentBot = report.steps.find((step) => step.id === "bind_second_feishu_agent_bot");
  const liveMultiAgentReuse = report.steps.find((step) => step.id === "live_multi_agent_bot_channel_reuse");
  const liveThreadCollaboration = report.steps.find((step) => step.id === "live_multi_agent_thread_collaboration");
  const liveThreadTaskBinding = report.steps.find((step) => step.id === "live_feishu_thread_task_binding");
  const liveThreadContinuation = report.steps.find((step) => step.id === "live_feishu_thread_continuation");
  const liveGuestIdentityRequired = report.steps.find((step) => step.id === "live_external_guest_identity_required");
  const liveGuestReplyDisabled = report.steps.find((step) => step.id === "live_external_guest_reply_disabled");
  const liveUnmentionedGuestIgnored = report.steps.find((step) => step.id === "live_unmentioned_guest_message_ignored");
  const liveBoundUserDataOperation = report.steps.find((step) => step.id === "live_bound_user_data_operation");
  const liveGuestWriteDenied = report.steps.find((step) => step.id === "live_external_guest_write_denied");
  const liveGuestReadableRead = report.steps.find((step) => step.id === "live_external_guest_read_guest_readable");
  const liveAgentDocSummary = report.steps.find((step) => step.id === "live_agent_bound_doc_summary");
  const workerDryRun = report.steps.find((step) => step.id === "run_websocket_worker_dry_run");
  const workerReceive = report.steps.find((step) => step.id === "live_websocket_receive_message");
  const workerRestart = report.steps.find((step) => step.id === "live_websocket_worker_restart");
  const dataGate = report.steps.find((step) => step.id === "run_data_plane_readiness_gate");
  const liveHarness = report.steps.find((step) => step.id === "run_openapi_live_smoke_harness");
  const verifyHarness = report.steps.find((step) => step.id === "verify_live_smoke_evidence");
  assert.equal(report.strictSatisfied, false);
  assert.equal(report.appSetup.callbackUrlStatus, "app_url_missing");
  assert.equal(report.appSetup.callbackUrl, undefined);
  assert.deepEqual(report.appSetup.requiredEvents, ["im.message.receive_v1", "im.chat.member.bot.added_v1", "card.action.trigger"]);
  assert.equal(report.appSetup.developerConsoleUrl, "https://open.feishu.cn/app");
  assert.ok(report.appSetup.setupSteps.some((step) => step.id === "create_custom_app"));
  assert.equal(report.smokeHarness.appUrl, undefined);
  assert.equal(report.smokeHarness.callbackUrl, undefined);
  assert.match(report.smokeHarness.prepareEnvCommand, /--app-url CHANGE_ME_PUBLIC_AGENTSPACE_URL/);
  assert.deepEqual(report.evidenceGates.map((gate) => gate.key), [
    "bot_reply",
    "native_agent_bot",
    "guest_policy",
    "data_plane",
    "failure_visibility",
    "agentspace_local_evidence",
    "openapi_artifact",
    "bot_added_payload_artifact",
  ]);
  assert.equal(health?.status, "pending");
  assert.deepEqual(health?.issues, ["health_not_checked"]);
  assert.equal(botGate?.status, "blocked");
  assert.ok(botGate?.issues?.includes("health_not_checked"));
  assert.equal(liveBot?.status, "blocked");
  assert.equal(liveDirectMention?.status, "blocked");
  assert.ok(liveDirectMention?.issues?.includes("health_not_checked"));
  assert.equal(bindSecondAgentBot?.status, "blocked");
  assert.match(bindSecondAgentBot?.command ?? "", /bind-agent-bot --workspace-id workspace-1/);
  assert.match(bindSecondAgentBot?.command ?? "", /--agent CHANGE_ME_SECOND_AGENT_NAME/);
  assert.match(bindSecondAgentBot?.command ?? "", /--app-id-env FEISHU_SECOND_AGENT_APP_ID/);
  assert.match(bindSecondAgentBot?.command ?? "", /--app-secret-env FEISHU_SECOND_AGENT_APP_SECRET/);
  assert.ok(bindSecondAgentBot?.issues?.includes("credential_encryption_key_missing"));
  assert.equal(liveMultiAgentReuse?.status, "blocked");
  assert.ok(liveMultiAgentReuse?.issues?.includes("second_agent_bot_missing"));
  assert.ok(liveMultiAgentReuse?.issues?.includes("second_agent_bot_not_ready"));
  assert.equal(liveThreadCollaboration?.status, "blocked");
  assert.ok(liveThreadCollaboration?.issues?.includes("second_agent_bot_missing"));
  assert.equal(liveThreadTaskBinding?.status, "blocked");
  assert.ok(liveThreadTaskBinding?.issues?.includes("health_not_checked"));
  assert.equal(liveThreadContinuation?.status, "blocked");
  assert.ok(liveThreadContinuation?.issues?.includes("health_not_checked"));
  assert.equal(report.steps.find((step) => step.id === "live_external_guest_agent_bot_mention")?.status, "blocked");
  assert.equal(report.steps.find((step) => step.id === "live_external_guest_reply_all")?.status, "blocked");
  assert.equal(liveGuestIdentityRequired?.status, "blocked");
  assert.ok(liveGuestIdentityRequired?.issues?.includes("health_not_checked"));
  assert.equal(liveGuestReplyDisabled?.status, "blocked");
  assert.ok(liveGuestReplyDisabled?.issues?.includes("health_not_checked"));
  assert.equal(liveUnmentionedGuestIgnored?.status, "blocked");
  assert.ok(liveUnmentionedGuestIgnored?.issues?.includes("health_not_checked"));
  assert.equal(liveBoundUserDataOperation?.status, "blocked");
  assert.ok(liveBoundUserDataOperation?.issues?.includes("doc_resource_binding_missing"));
  assert.equal(liveGuestWriteDenied?.status, "blocked");
  assert.ok(liveGuestWriteDenied?.issues?.includes("doc_resource_binding_missing"));
  assert.equal(liveGuestReadableRead?.status, "blocked");
  assert.ok(liveGuestReadableRead?.issues?.includes("doc_resource_binding_missing"));
  assert.equal(report.steps.find((step) => step.id === "live_agent_channel_policy_disabled")?.status, "blocked");
  assert.equal(liveAgentDocSummary?.status, "blocked");
  assert.ok(liveAgentDocSummary?.issues?.includes("doc_resource_binding_missing"));
  assert.equal(workerDryRun?.status, "blocked");
  assert.ok(workerDryRun?.issues?.includes("websocket_worker_integration_missing"));
  assert.equal(workerReceive?.status, "blocked");
  assert.equal(workerRestart?.status, "blocked");
  assert.equal(dataGate?.status, "blocked");
  assert.equal(liveHarness?.status, "blocked");
  assert.equal(verifyHarness?.status, "blocked");
  assert.ok(dataGate?.issues?.includes("doc_resource_binding_missing"));
});

test("Feishu smoke plan treats disabled integrations as unavailable for live smoke setup", () => {
  const report = buildFeishuSmokePlanReport({
    workspaceId: "workspace-1",
    requiredReadiness: "data-plane",
    appUrl: "https://agentspace.test",
    runtimeEnv: {
      AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY: FEISHU_TEST_CREDENTIAL_ENCRYPTION_KEY,
    },
    integrations: [
      buildIntegrationRecord({
        id: "agent-bot-disabled",
        displayName: "Disabled Codex Bot",
        agentId: "Codex",
        appId: "cli_disabled_bot",
        lastHealthStatus: "healthy",
        transportMode: "websocket_worker",
        status: "disabled",
      }),
    ],
    channelBindingsByIntegrationId: {
      "agent-bot-disabled": [buildChannelBinding("agent-bot-disabled")],
    },
    userBindingsByIntegrationId: {
      "agent-bot-disabled": [buildUserBinding("agent-bot-disabled")],
    },
    resourceBindingsByIntegrationId: {
      "agent-bot-disabled": [
        buildResourceBinding("agent-bot-disabled", "doc", "doccn_secret"),
        buildResourceBinding("agent-bot-disabled", "sheet", "shtcn_secret"),
        buildResourceBinding("agent-bot-disabled", "base_table", "tbl_secret"),
      ],
    },
    failedOutboxByIntegrationId: {
      "agent-bot-disabled": [],
    },
    pendingOutboxByIntegrationId: {
      "agent-bot-disabled": [],
    },
  });

  const bindAgentBot = report.steps.find((step) => step.id === "bind_feishu_agent_bot");
  const prepareCreateEnv = report.steps.find((step) => step.id === "prepare_feishu_create_env");
  const configureCredentials = report.steps.find((step) => step.id === "configure_app_credentials");
  const configureScopes = report.steps.find((step) => step.id === "configure_bot_events_and_scopes");
  const health = report.steps.find((step) => step.id === "check_connection_health");
  const prepareEnv = report.steps.find((step) => step.id === "prepare_live_smoke_env");
  const checkEnv = report.steps.find((step) => step.id === "check_live_smoke_env");
  const bindChat = report.steps.find((step) => step.id === "bind_feishu_chat");
  const bindUser = report.steps.find((step) => step.id === "bind_feishu_user");
  const botGate = report.steps.find((step) => step.id === "run_bot_readiness_gate");
  const liveAutoProvision = report.steps.find((step) => step.id === "live_agent_bot_channel_auto_provision");
  const verifyBotAddedPayload = report.steps.find((step) => step.id === "verify_real_bot_added_payload_sample");
  const firstMessageProvision = report.steps.find((step) =>
    step.id === "live_agent_bot_first_message_auto_provision"
  );
  const bindResources = report.steps.find((step) => step.id === "bind_feishu_doc_sheet_base");
  const failureVisibility = report.steps.find((step) => step.id === "live_failure_visibility");
  const finalEvidence = report.steps.find((step) => step.id === "verify_agentspace_live_evidence");

  assert.equal(report.integrationCount, 1);
  assert.equal(report.readinessSummary.readyForBotSmokeCount, 0);
  assert.equal(report.readinessSummary.readyForDataPlaneSmokeCount, 0);
  assert.deepEqual(report.evidenceGates.map((gate) => gate.key), [
    "bot_reply",
    "native_agent_bot",
    "guest_policy",
    "data_plane",
    "failure_visibility",
    "agentspace_local_evidence",
    "openapi_artifact",
    "bot_added_payload_artifact",
  ]);
  assert.equal(prepareCreateEnv?.status, "pending");
  assert.deepEqual(prepareCreateEnv?.issues, ["integration_not_active"]);
  assert.match(prepareCreateEnv?.command ?? "", /cp scripts\/feishu\/env\.example scripts\/feishu\/\.env/);
  assert.match(prepareCreateEnv?.detail ?? "", /not usable as active agent bot bindings/);
  assert.equal(bindAgentBot?.status, "pending");
  assert.match(bindAgentBot?.detail ?? "", /none are active|records exist/i);
  assert.ok(bindAgentBot?.issues?.includes("integration_not_active"));
  assert.equal(configureCredentials?.status, "blocked");
  assert.deepEqual(configureCredentials?.issues, ["integration_not_active"]);
  assert.equal(configureScopes?.status, "blocked");
  assert.deepEqual(configureScopes?.issues, ["integration_not_active"]);
  assert.equal(health?.status, "blocked");
  assert.deepEqual(health?.issues, ["integration_not_active"]);
  assert.equal(prepareEnv?.status, "blocked");
  assert.deepEqual(prepareEnv?.issues, ["integration_not_active"]);
  assert.doesNotMatch(prepareEnv?.command ?? "", /agent-bot-disabled/);
  assert.equal(checkEnv?.status, "blocked");
  assert.deepEqual(checkEnv?.issues, ["integration_not_active"]);
  assert.equal(bindChat?.status, "blocked");
  assert.deepEqual(bindChat?.issues, ["integration_not_active"]);
  assert.match(bindChat?.command ?? "", /--integration CHANGE_ME_FEISHU_INTEGRATION_ID/);
  assert.doesNotMatch(bindChat?.command ?? "", /agent-bot-disabled/);
  assert.equal(bindUser?.status, "blocked");
  assert.deepEqual(bindUser?.issues, ["integration_not_active"]);
  assert.match(bindUser?.command ?? "", /--integration CHANGE_ME_FEISHU_INTEGRATION_ID/);
  assert.doesNotMatch(bindUser?.command ?? "", /agent-bot-disabled/);
  assert.equal(botGate?.status, "blocked");
  assert.ok(botGate?.issues?.includes("integration_not_active"));
  assert.equal(liveAutoProvision?.status, "blocked");
  assert.deepEqual(liveAutoProvision?.issues, ["integration_not_active"]);
  assert.equal(verifyBotAddedPayload?.status, "blocked");
  assert.deepEqual(verifyBotAddedPayload?.issues, ["integration_not_active"]);
  assert.equal(firstMessageProvision?.status, "blocked");
  assert.deepEqual(firstMessageProvision?.issues, ["integration_not_active"]);
  assert.equal(bindResources?.status, "blocked");
  assert.deepEqual(bindResources?.issues, ["integration_not_active"]);
  assert.match(bindResources?.command ?? "", /--integration CHANGE_ME_FEISHU_INTEGRATION_ID/);
  assert.doesNotMatch(bindResources?.command ?? "", /agent-bot-disabled/);
  assert.equal(failureVisibility?.status, "blocked");
  assert.deepEqual(failureVisibility?.issues, ["integration_not_active"]);
  assert.match(failureVisibility?.command ?? "", /--integration CHANGE_ME_FEISHU_INTEGRATION_ID/);
  assert.doesNotMatch(failureVisibility?.command ?? "", /agent-bot-disabled/);
  assert.equal(finalEvidence?.status, "blocked");
  assert.ok(finalEvidence?.issues?.includes("integration_not_active"));
  assert.match(finalEvidence?.command ?? "", /--integration CHANGE_ME_FEISHU_INTEGRATION_ID/);
  assert.doesNotMatch(finalEvidence?.command ?? "", /agent-bot-disabled/);
  assert.equal(JSON.stringify(report).includes("cli_disabled_bot"), false);
});

test("Feishu smoke plan rejects active workspace-level integrations as agent bot anchors", () => {
  const report = buildFeishuSmokePlanReport({
    workspaceId: "workspace-1",
    requiredReadiness: "data-plane",
    appUrl: "https://agentspace.test",
    runtimeEnv: {
      AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY: FEISHU_TEST_CREDENTIAL_ENCRYPTION_KEY,
    },
    integrations: [
      buildIntegrationRecord({
        id: "workspace-feishu",
        displayName: "Workspace Feishu",
        appId: "cli_workspace_bot",
        lastHealthStatus: "healthy",
        transportMode: "websocket_worker",
      }),
    ],
    channelBindingsByIntegrationId: {
      "workspace-feishu": [buildChannelBinding("workspace-feishu")],
    },
    userBindingsByIntegrationId: {
      "workspace-feishu": [buildUserBinding("workspace-feishu")],
    },
    resourceBindingsByIntegrationId: {
      "workspace-feishu": [
        buildResourceBinding("workspace-feishu", "doc", "doccn_secret"),
        buildResourceBinding("workspace-feishu", "sheet", "shtcn_secret"),
        buildResourceBinding("workspace-feishu", "base_table", "tbl_secret"),
      ],
    },
    failedOutboxByIntegrationId: {
      "workspace-feishu": [],
    },
    pendingOutboxByIntegrationId: {
      "workspace-feishu": [],
    },
  });

  const prepareCreateEnv = report.steps.find((step) => step.id === "prepare_feishu_create_env");
  const bindAgentBot = report.steps.find((step) => step.id === "bind_feishu_agent_bot");
  const botGate = report.steps.find((step) => step.id === "run_bot_readiness_gate");
  const prepareEnv = report.steps.find((step) => step.id === "prepare_live_smoke_env");
  const bindChat = report.steps.find((step) => step.id === "bind_feishu_chat");
  const bindResources = report.steps.find((step) => step.id === "bind_feishu_doc_sheet_base");
  const finalEvidence = report.steps.find((step) => step.id === "verify_agentspace_live_evidence");

  assert.equal(report.integrationCount, 0);
  assert.equal(report.strictSatisfied, false);
  assert.equal(report.selectedBotIntegrationId, undefined);
  assert.equal(report.selectedDataPlaneIntegrationId, undefined);
  assert.equal(report.selectedWorkerIntegrationId, undefined);
  assert.deepEqual(report.readinessSummary, {
    readyForBotSmokeCount: 0,
    readyForDataPlaneSmokeCount: 0,
    readyForWorkerSmokeCount: 0,
  });
  assert.equal(report.appSetup.callbackUrlStatus, "integration_missing");
  assert.deepEqual(report.appSetup.requiredCredentialFields, ["app_id", "app_secret"]);
  assert.ok(report.blockers.find((blocker) =>
    blocker.issue === "active_agent_bot_integration_missing" &&
    blocker.nextAction.includes("workspace-level Feishu records cannot be used")
  ));
  assert.equal(prepareCreateEnv?.status, "pending");
  assert.deepEqual(prepareCreateEnv?.issues, ["active_agent_bot_integration_missing"]);
  assert.equal(bindAgentBot?.status, "pending");
  assert.deepEqual(bindAgentBot?.issues, ["active_agent_bot_integration_missing"]);
  assert.match(bindAgentBot?.command ?? "", /bind-agent-bot --workspace-id workspace-1/);
  assert.equal(botGate?.status, "blocked");
  assert.deepEqual(botGate?.issues, ["active_agent_bot_integration_missing"]);
  assert.equal(prepareEnv?.status, "blocked");
  assert.deepEqual(prepareEnv?.issues, ["active_agent_bot_integration_missing"]);
  assert.doesNotMatch(prepareEnv?.command ?? "", /workspace-feishu/);
  assert.equal(bindChat?.status, "blocked");
  assert.match(bindChat?.command ?? "", /--integration CHANGE_ME_FEISHU_INTEGRATION_ID/);
  assert.doesNotMatch(bindChat?.command ?? "", /workspace-feishu/);
  assert.equal(bindResources?.status, "blocked");
  assert.deepEqual(bindResources?.issues, ["active_agent_bot_integration_missing"]);
  assert.equal(finalEvidence?.status, "blocked");
  assert.ok(finalEvidence?.issues?.includes("active_agent_bot_integration_missing"));
  assert.match(finalEvidence?.command ?? "", /--integration CHANGE_ME_FEISHU_INTEGRATION_ID/);
  assert.doesNotMatch(finalEvidence?.command ?? "", /workspace-feishu/);
  assert.equal(JSON.stringify(report).includes("cli_workspace_bot"), false);
});

test("Feishu smoke plan rejects selected workspace-level integrations as agent bot anchors", () => {
  const report = buildFeishuSmokePlanReport({
    workspaceId: "workspace-1",
    integrationId: "workspace-feishu",
    appUrl: "https://agentspace.test",
    runtimeEnv: {
      AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY: FEISHU_TEST_CREDENTIAL_ENCRYPTION_KEY,
    },
    integrations: [
      buildIntegrationRecord({
        id: "workspace-feishu",
        displayName: "Workspace Feishu",
        appId: "cli_workspace_bot",
        lastHealthStatus: "healthy",
        transportMode: "websocket_worker",
      }),
    ],
    channelBindingsByIntegrationId: {
      "workspace-feishu": [buildChannelBinding("workspace-feishu")],
    },
    userBindingsByIntegrationId: {
      "workspace-feishu": [buildUserBinding("workspace-feishu")],
    },
    resourceBindingsByIntegrationId: {
      "workspace-feishu": [],
    },
    failedOutboxByIntegrationId: {
      "workspace-feishu": [],
    },
    pendingOutboxByIntegrationId: {
      "workspace-feishu": [],
    },
  });

  const bindAgentBot = report.steps.find((step) => step.id === "bind_feishu_agent_bot");
  const checkEnv = report.steps.find((step) => step.id === "check_live_smoke_env");
  const finalEvidence = report.steps.find((step) => step.id === "verify_agentspace_live_evidence");

  assert.equal(report.integrationCount, 0);
  assert.equal(report.selectedBotIntegrationId, undefined);
  assert.ok(report.blockers.find((blocker) =>
    blocker.issue === "selected_integration_not_agent_bot" &&
    blocker.nextAction.includes("active agent-scoped Feishu bot binding")
  ));
  assert.equal(bindAgentBot?.status, "pending");
  assert.deepEqual(bindAgentBot?.issues, ["selected_integration_not_agent_bot"]);
  assert.match(bindAgentBot?.command ?? "", /--agent CHANGE_ME_AGENT_NAME/);
  assert.equal(checkEnv?.status, "blocked");
  assert.deepEqual(checkEnv?.issues, ["selected_integration_not_agent_bot"]);
  assert.doesNotMatch(checkEnv?.command ?? "", /workspace-feishu/);
  assert.equal(finalEvidence?.status, "blocked");
  assert.ok(finalEvidence?.issues?.includes("selected_integration_not_agent_bot"));
  assert.match(finalEvidence?.command ?? "", /--integration CHANGE_ME_FEISHU_INTEGRATION_ID/);
  assert.doesNotMatch(finalEvidence?.command ?? "", /workspace-feishu/);
  assert.equal(JSON.stringify(report).includes("cli_workspace_bot"), false);
});

test("Feishu smoke plan includes CLI agent bot bind command when no integration exists", () => {
  const report = buildFeishuSmokePlanReport({
    workspaceId: "workspace-1",
    integrations: [],
    runtimeEnv: {},
  });
  const encryptionStep = report.steps.find((step) => step.id === "configure_credential_encryption_key");
  const createEnvStep = report.steps.find((step) => step.id === "prepare_feishu_create_env");
  const createStep = report.steps.find((step) => step.id === "bind_feishu_agent_bot");
  const liveFirstMessageAutoProvision = report.steps.find((step) =>
    step.id === "live_agent_bot_first_message_auto_provision"
  );

  assert.equal(report.integrationCount, 0);
  assert.deepEqual(report.appSetup.requiredCredentialFields, ["app_id", "app_secret"]);
  assert.equal(report.runtimeSetup.credentialEncryption.status, "missing");
  assert.deepEqual(report.blockers.slice(0, 2).map((blocker) => blocker.issue), [
    "credential_encryption_key_missing",
    "integration_missing",
  ]);
  assert.ok(report.blockers.find((blocker) =>
    blocker.issue === "integration_missing" &&
    blocker.severity === "blocked" &&
    blocker.affectedStepCount > 1 &&
    blocker.nextAction.includes("Create or bind an active Feishu agent bot integration")
  ));
  assert.ok(report.blockers.find((blocker) =>
    blocker.issue === "credential_encryption_key_missing" &&
    blocker.firstStepId === "configure_credential_encryption_key" &&
    blocker.nextAction.includes("base64-encoded 32-byte key")
  ));
  assert.equal(encryptionStep?.status, "pending");
  assert.match(encryptionStep?.command ?? "", /AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY/);
  assert.deepEqual(encryptionStep?.issues, ["credential_encryption_key_missing"]);
  assert.equal(createEnvStep?.status, "pending");
  assert.match(createEnvStep?.command ?? "", /scripts\/feishu\/env\.example scripts\/feishu\/\.env/);
  assert.match(createEnvStep?.detail ?? "", /replace the Feishu app credential placeholders/);
  assert.equal(createStep?.status, "blocked");
  assert.ok(createStep?.issues?.includes("credential_encryption_key_missing"));
  assert.match(createStep?.detail ?? "", /App ID \+ App Secret/);
  assert.match(createStep?.detail ?? "", /WebSocket worker/);
  assert.match(createStep?.command ?? "", /agent-space integrations feishu bind-agent-bot --workspace-id workspace-1/);
  assert.match(createStep?.command ?? "", /--agent CHANGE_ME_AGENT_NAME/);
  assert.match(createStep?.command ?? "", /--env-file scripts\/feishu\/\.env/);
  assert.match(createStep?.command ?? "", /--app-id-env FEISHU_APP_ID/);
  assert.match(createStep?.command ?? "", /--app-secret-env FEISHU_APP_SECRET/);
  assert.doesNotMatch(createStep?.command ?? "", /--verification-token-env/);
  assert.doesNotMatch(createStep?.command ?? "", /--encrypt-key-env/);
  assert.equal(liveFirstMessageAutoProvision?.status, "blocked");
  assert.deepEqual(liveFirstMessageAutoProvision?.issues, ["integration_missing"]);
});

test("Feishu smoke plan text output summarizes blockers and next commands", () => {
  const report = buildFeishuSmokePlanReport({
    workspaceId: "workspace-1",
    integrations: [],
    runtimeEnv: {},
  });
  const output = formatFeishuSmokePlanCommandText(report);

  assert.match(output, /AgentSpace Feishu smoke plan/);
  assert.match(output, /Workspace: workspace-1/);
  assert.match(output, /Blockers:/);
  assert.match(output, /credential_encryption_key_missing/);
  assert.match(output, /Set AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY/);
  assert.match(output, /integration_missing/);
  assert.match(output, /Create or bind an active Feishu agent bot integration/);
  assert.match(output, /second_agent_bot_missing/);
  assert.match(output, /Next steps:/);
  assert.match(output, /\[pending\] Configure AgentSpace credential encryption key/);
  assert.match(output, /command: export AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY/);
  assert.match(output, /Smoke commands:/);
  assert.match(output, /prepare env: agent-space integrations feishu smoke-env --workspace-id workspace-1/);
  assert.match(output, /check env: npm run smoke:feishu -- --env-file scripts\/feishu\/\.env --check-env --json --require-todo120-native/);
  assert.match(output, /final AgentSpace evidence: agent-space integrations feishu evidence --workspace-id workspace-1/);
  assert.match(output, /Use --json for machine-readable blockers/);
  assert.doesNotMatch(output, /\[object Object\]/);
  assert.doesNotMatch(output, /FEISHU_APP_SECRET=/);
});

test("Feishu smoke plan requires second agent bot to use a distinct ready Feishu app", () => {
  const report = buildFeishuSmokePlanReport({
    workspaceId: "workspace-1",
    requiredReadiness: "bot",
    runtimeEnv: {
      AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY: FEISHU_TEST_CREDENTIAL_ENCRYPTION_KEY,
    },
    integrations: [
      buildIntegrationRecord({
        id: "agent-bot-codex",
        displayName: "Codex Bot",
        agentId: "Codex",
        appId: "cli_shared_agent_bot",
        lastHealthStatus: "healthy",
        transportMode: "websocket_worker",
      }),
      buildIntegrationRecord({
        id: "agent-bot-hermes",
        displayName: "HermesAgent Bot",
        agentId: "HermesAgent",
        appId: "cli_shared_agent_bot",
        lastHealthStatus: "healthy",
        transportMode: "websocket_worker",
      }),
    ],
    channelBindingsByIntegrationId: {
      "agent-bot-codex": [],
      "agent-bot-hermes": [],
    },
    userBindingsByIntegrationId: {
      "agent-bot-codex": [],
      "agent-bot-hermes": [],
    },
    resourceBindingsByIntegrationId: {
      "agent-bot-codex": [],
      "agent-bot-hermes": [],
    },
    failedOutboxByIntegrationId: {
      "agent-bot-codex": [],
      "agent-bot-hermes": [],
    },
    pendingOutboxByIntegrationId: {
      "agent-bot-codex": [],
      "agent-bot-hermes": [],
    },
  });

  const bindSecondAgentBot = report.steps.find((step) => step.id === "bind_second_feishu_agent_bot");
  const liveMultiAgentReuse = report.steps.find((step) => step.id === "live_multi_agent_bot_channel_reuse");
  const liveThreadCollaboration = report.steps.find((step) => step.id === "live_multi_agent_thread_collaboration");

  assert.equal(bindSecondAgentBot?.status, "pending");
  assert.ok(bindSecondAgentBot?.issues?.includes("second_agent_bot_distinct_app_missing"));
  assert.match(bindSecondAgentBot?.detail ?? "", /second active Feishu custom app/);
  assert.equal(liveMultiAgentReuse?.status, "blocked");
  assert.deepEqual(liveMultiAgentReuse?.issues, ["second_agent_bot_distinct_app_missing"]);
  assert.equal(liveThreadCollaboration?.status, "blocked");
  assert.ok(liveThreadCollaboration?.issues?.includes("second_agent_bot_distinct_app_missing"));
  assert.equal(JSON.stringify(report).includes("cli_shared_agent_bot"), false);
});

test("Feishu smoke-plan exit code only gates failures in strict mode", () => {
  assert.equal(getFeishuSmokePlanExitCode({ strictSatisfied: false }, { strict: false }), 0);
  assert.equal(getFeishuSmokePlanExitCode({ strictSatisfied: false }, { strict: true }), 1);
  assert.equal(getFeishuSmokePlanExitCode({ strictSatisfied: true }, { strict: true }), 0);
});

test("Feishu smoke plan reports invalid AgentSpace credential encryption key without leaking value", () => {
  const report = buildFeishuSmokePlanReport({
    workspaceId: "workspace-1",
    integrations: [],
    runtimeEnv: {
      AGENT_SPACE_INTEGRATION_CREDENTIAL_ENCRYPTION_KEY: "not-32-bytes",
    },
  });
  const encryptionStep = report.steps.find((step) => step.id === "configure_credential_encryption_key");
  const createStep = report.steps.find((step) => step.id === "bind_feishu_agent_bot");

  assert.equal(report.runtimeSetup.credentialEncryption.status, "invalid");
  assert.ok(report.blockers.find((blocker) =>
    blocker.issue === "credential_encryption_key_invalid" &&
    blocker.firstStepTitle === "Configure AgentSpace credential encryption key" &&
    blocker.nextAction.includes("valid base64-encoded 32-byte key")
  ));
  assert.equal(
    report.runtimeSetup.credentialEncryption.configuredEnvName,
    "AGENT_SPACE_INTEGRATION_CREDENTIAL_ENCRYPTION_KEY",
  );
  assert.deepEqual(report.runtimeSetup.credentialEncryption.checkedEnvNames, [
    "AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY",
    "AGENT_SPACE_INTEGRATION_CREDENTIAL_ENCRYPTION_KEY",
  ]);
  assert.deepEqual(encryptionStep?.issues, ["credential_encryption_key_invalid"]);
  assert.equal(createStep?.status, "blocked");
  assert.ok(createStep?.issues?.includes("credential_encryption_key_invalid"));

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("not-32-bytes"), false);
});

test("Feishu readiness report blocks manual smoke when local scopes are incomplete", () => {
  const report = buildFeishuReadinessReport({
    workspaceId: "workspace-1",
    requiredReadiness: "data-plane",
    integrations: [
      buildIntegrationRecord({
        id: "integration-missing-scopes",
        displayName: "Missing Scope Feishu",
        lastHealthStatus: "healthy",
        scopesJson: JSON.stringify(["im:message", "im:message:send_as_bot"]),
      }),
    ],
    channelBindingsByIntegrationId: {
      "integration-missing-scopes": [buildChannelBinding("integration-missing-scopes")],
    },
    userBindingsByIntegrationId: {
      "integration-missing-scopes": [buildUserBinding("integration-missing-scopes")],
    },
    resourceBindingsByIntegrationId: {
      "integration-missing-scopes": [
        buildResourceBinding("integration-missing-scopes", "doc", "doccn_secret"),
        buildResourceBinding("integration-missing-scopes", "sheet", "shtcn_secret"),
        buildResourceBinding("integration-missing-scopes", "base", "app_secret"),
      ],
    },
    failedOutboxByIntegrationId: {
      "integration-missing-scopes": [],
    },
    pendingOutboxByIntegrationId: {
      "integration-missing-scopes": [],
    },
  });

  const [item] = report.integrations;
  assert.equal(report.strictSatisfied, false);
  assert.equal(item?.readyForBotSmoke, false);
  assert.equal(item?.readyForDataPlaneSmoke, false);
  assert.deepEqual(item?.scopes.missingForBotSmoke, ["contact:user.base:readonly"]);
  assert.deepEqual(item?.scopes.missingForDataPlaneSmoke, [
    "docx:document",
    "drive:drive",
    "sheets:spreadsheet",
    "bitable:app",
  ]);
  assert.ok(item?.issues.includes("bot_scope_missing"));
  assert.ok(item?.issues.includes("data_plane_scope_missing"));
});

async function captureConsoleLog(action: () => Promise<void> | void): Promise<string[]> {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (value?: unknown) => {
    logs.push(typeof value === "string" ? value : String(value));
  };

  try {
    await action();
  } finally {
    console.log = originalLog;
  }

  return logs;
}

function buildCompleteFeishuEvidenceInput() {
  return {
    workspaceId: "workspace-1",
    requiredEvidence: "all" as const,
    botAddedPayloadEvidence: buildBotAddedPayloadEvidenceFixture(),
    integrations: [
      buildIntegrationRecord({
        id: "integration-evidence",
        displayName: "Evidence Feishu",
        agentId: "Atlas",
        transportMode: "websocket_worker",
        lastHealthStatus: "degraded",
      }),
    ],
    eventsByIntegrationId: {
      "integration-evidence": [
        buildIntegrationEvent("integration-evidence", "evt_processed_secret", "im.message.receive_v1", "processed"),
        buildApprovalCardActionEvent("integration-evidence", "evt_card_secret"),
        buildIntegrationEvent("integration-evidence", "evt_failed_secret", "im.message.receive_v1", "failed"),
      ],
    },
    messageMappingsByIntegrationId: {
      "integration-evidence": [
        buildMessageMapping("integration-evidence", "inbound", "om_secret_inbound"),
        buildMessageMapping("integration-evidence", "outbound", "om_secret_reply", "om_secret_inbound"),
        buildMessageMapping("integration-evidence", "inbound", "om_secret_restart_inbound", undefined, {
          actorType: "external_guest",
          externalGuestPolicyDecision: "allow",
        }),
        buildExternalGuestReplyAllMapping("integration-evidence"),
        buildMessageMapping("integration-evidence", "outbound", "om_secret_restart_reply", "om_secret_restart_inbound"),
        buildAgentChannelPolicyDeniedMapping("integration-evidence"),
        buildBotSenderLoopGuardMapping("integration-evidence"),
        buildThreadContinuationMapping("integration-evidence"),
        ...buildGuestPolicyEvidenceMappings("integration-evidence"),
      ],
    },
    channelBindingsByIntegrationId: {
      "integration-evidence": [
        buildAutoProvisionedChannelBinding("integration-evidence", "first_message"),
        buildAutoProvisionedChannelBinding("integration-evidence", "bot_added", {
          agentId: "HermesAgent",
          linkedFromBindingId: "channel-atlas-binding",
          linkedFromAgentId: "Atlas",
          linkedFromBotBindingId: "integration-evidence-atlas",
        }),
      ],
    },
    threadBindingsByIntegrationId: {
      "integration-evidence": [
        buildThreadBinding("integration-evidence", {
          taskQueueId: "task-thread-continuation",
          agentSpaceMessageId: "message-thread-continuation-source",
        }),
        buildThreadBinding("integration-evidence", {
          id: "thread-integration-evidence-hermes",
          agentId: "HermesAgent",
          botBindingId: "integration-evidence",
          threadCollaboration: true,
          collaboratingAgentIds: ["Atlas"],
        }),
      ],
    },
    outboxByIntegrationId: {
      "integration-evidence": [
        buildOutboxItem("integration-evidence", "sent"),
        buildIdentityBindingNoticeOutboxItem("integration-evidence"),
        buildThreadCollaborationCardOutboxItem("integration-evidence", {
          agentId: "HermesAgent",
          botBindingId: "integration-evidence",
          collaboratingAgentIds: ["Atlas"],
          collaboratingBotBindingIds: ["integration-evidence-atlas"],
        }),
        buildOutboxItem("integration-evidence", "failed"),
      ],
    },
    dataOperationsByIntegrationId: {
      "integration-evidence": [
        buildDataOperationRun("integration-evidence", "docs.read_document", "doc", "succeeded", {
          actorType: "user",
          actorId: "user-1",
        }),
        buildExternalGuestDocReadRun("integration-evidence"),
        buildAgentRuntimeDocReadRun("integration-evidence"),
        buildDataOperationRun("integration-evidence", "docs.update_document", "doc", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.read_range", "sheet", "succeeded"),
        buildDataOperationRun("integration-evidence", "sheets.update_range", "sheet", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.query_records", "base_table", "succeeded"),
        buildDataOperationRun("integration-evidence", "base.mutate_records", "base_table", "succeeded"),
        buildExternalGuestWriteDeniedRun("integration-evidence"),
      ],
    },
  };
}

function cloneFeishuEvidenceInputForIntegration(
  input: ReturnType<typeof buildCompleteFeishuEvidenceInput>,
  options: {
    integrationId: string;
    displayName: string;
    appId: string;
    tenantKey?: string;
    chatReference: string;
  },
) {
  const sourceIntegrationId = "integration-evidence";
  const rewriteRecord = <T>(record: T): T => {
    const rewritten = JSON.parse(
      JSON.stringify(record).split(sourceIntegrationId).join(options.integrationId),
    ) as T & { metadataJson?: string };
    if (typeof rewritten.metadataJson === "string") {
      const metadata = JSON.parse(rewritten.metadataJson) as Record<string, unknown>;
      rewritten.metadataJson = JSON.stringify({
        ...metadata,
        externalChatReference: options.chatReference,
      });
    }
    return rewritten;
  };

  return {
    ...input,
    integrations: [
      buildIntegrationRecord({
        id: options.integrationId,
        displayName: options.displayName,
        agentId: "Atlas",
        appId: options.appId,
        ...(options.tenantKey ? { tenantKey: options.tenantKey } : {}),
        transportMode: "websocket_worker",
        lastHealthStatus: "degraded",
      }),
    ],
    eventsByIntegrationId: {
      [options.integrationId]: input.eventsByIntegrationId[sourceIntegrationId].map(rewriteRecord),
    },
    messageMappingsByIntegrationId: {
      [options.integrationId]: input.messageMappingsByIntegrationId[sourceIntegrationId].map(rewriteRecord),
    },
    channelBindingsByIntegrationId: {
      [options.integrationId]: input.channelBindingsByIntegrationId[sourceIntegrationId].map(rewriteRecord),
    },
    threadBindingsByIntegrationId: {
      [options.integrationId]: input.threadBindingsByIntegrationId[sourceIntegrationId].map(rewriteRecord),
    },
    outboxByIntegrationId: {
      [options.integrationId]: input.outboxByIntegrationId[sourceIntegrationId].map(rewriteRecord),
    },
    dataOperationsByIntegrationId: {
      [options.integrationId]: input.dataOperationsByIntegrationId[sourceIntegrationId].map(rewriteRecord),
    },
  } as ReturnType<typeof buildCompleteFeishuEvidenceInput>;
}

function mergeFeishuEvidenceInputs(
  primary: ReturnType<typeof buildCompleteFeishuEvidenceInput>,
  secondary: ReturnType<typeof buildCompleteFeishuEvidenceInput>,
) {
  return {
    ...primary,
    integrations: [
      ...primary.integrations,
      ...secondary.integrations,
    ],
    eventsByIntegrationId: {
      ...primary.eventsByIntegrationId,
      ...secondary.eventsByIntegrationId,
    },
    messageMappingsByIntegrationId: {
      ...primary.messageMappingsByIntegrationId,
      ...secondary.messageMappingsByIntegrationId,
    },
    channelBindingsByIntegrationId: {
      ...primary.channelBindingsByIntegrationId,
      ...secondary.channelBindingsByIntegrationId,
    },
    threadBindingsByIntegrationId: {
      ...primary.threadBindingsByIntegrationId,
      ...secondary.threadBindingsByIntegrationId,
    },
    outboxByIntegrationId: {
      ...primary.outboxByIntegrationId,
      ...secondary.outboxByIntegrationId,
    },
    dataOperationsByIntegrationId: {
      ...primary.dataOperationsByIntegrationId,
      ...secondary.dataOperationsByIntegrationId,
    },
  } as ReturnType<typeof buildCompleteFeishuEvidenceInput>;
}

function withStaleFeishuLocalEvidenceTimestamps(
  input: ReturnType<typeof buildCompleteFeishuEvidenceInput>,
) {
  const clone = JSON.parse(JSON.stringify(input)) as ReturnType<typeof buildCompleteFeishuEvidenceInput>;
  for (const events of Object.values(clone.eventsByIntegrationId)) {
    for (const event of events as Array<Record<string, unknown>>) {
      event.receivedAt = STALE_FEISHU_EVIDENCE_TIMESTAMP;
      if (typeof event.processedAt === "string") {
        event.processedAt = STALE_FEISHU_EVIDENCE_TIMESTAMP;
      }
    }
  }
  for (const mappings of Object.values(clone.messageMappingsByIntegrationId)) {
    for (const mapping of mappings as Array<Record<string, unknown>>) {
      mapping.createdAt = STALE_FEISHU_EVIDENCE_TIMESTAMP;
    }
  }
  for (const outbox of Object.values(clone.outboxByIntegrationId)) {
    for (const item of outbox as Array<Record<string, unknown>>) {
      item.createdAt = STALE_FEISHU_EVIDENCE_TIMESTAMP;
      item.updatedAt = STALE_FEISHU_EVIDENCE_TIMESTAMP;
      if (typeof item.sentAt === "string") {
        item.sentAt = STALE_FEISHU_EVIDENCE_TIMESTAMP;
      }
    }
  }
  for (const channelBindings of Object.values(clone.channelBindingsByIntegrationId)) {
    for (const binding of channelBindings as Array<Record<string, unknown>>) {
      binding.createdAt = STALE_FEISHU_EVIDENCE_TIMESTAMP;
      binding.updatedAt = STALE_FEISHU_EVIDENCE_TIMESTAMP;
    }
  }
  for (const threadBindings of Object.values(clone.threadBindingsByIntegrationId)) {
    for (const binding of threadBindings as Array<Record<string, unknown>>) {
      binding.lastMessageAt = STALE_FEISHU_EVIDENCE_TIMESTAMP;
      binding.createdAt = STALE_FEISHU_EVIDENCE_TIMESTAMP;
      binding.updatedAt = STALE_FEISHU_EVIDENCE_TIMESTAMP;
    }
  }
  for (const operations of Object.values(clone.dataOperationsByIntegrationId)) {
    for (const operation of operations as Array<Record<string, unknown>>) {
      operation.startedAt = STALE_FEISHU_EVIDENCE_TIMESTAMP;
      if (typeof operation.finishedAt === "string") {
        operation.finishedAt = STALE_FEISHU_EVIDENCE_TIMESTAMP;
      }
      operation.createdAt = STALE_FEISHU_EVIDENCE_TIMESTAMP;
      operation.updatedAt = STALE_FEISHU_EVIDENCE_TIMESTAMP;
    }
  }
  return clone;
}

function withAdditionalStaleFeishuLocalEvidenceRows(
  input: ReturnType<typeof buildCompleteFeishuEvidenceInput>,
) {
  const clone = JSON.parse(JSON.stringify(input)) as ReturnType<typeof buildCompleteFeishuEvidenceInput>;
  const stale = withStaleFeishuLocalEvidenceTimestamps(input);
  const appendStaleRows = (
    target: Record<string, never[]>,
    source: Record<string, never[]>,
    integrationId: string,
  ) => {
    target[integrationId] = [
      ...(target[integrationId] ?? []),
      ...(source[integrationId] ?? []),
    ];
  };
  for (const integration of clone.integrations as Array<{ id: string }>) {
    const integrationId = integration.id;
    appendStaleRows(
      clone.eventsByIntegrationId as Record<string, never[]>,
      stale.eventsByIntegrationId as Record<string, never[]>,
      integrationId,
    );
    appendStaleRows(
      clone.messageMappingsByIntegrationId as Record<string, never[]>,
      stale.messageMappingsByIntegrationId as Record<string, never[]>,
      integrationId,
    );
    appendStaleRows(
      clone.outboxByIntegrationId as Record<string, never[]>,
      stale.outboxByIntegrationId as Record<string, never[]>,
      integrationId,
    );
    appendStaleRows(
      clone.channelBindingsByIntegrationId as Record<string, never[]>,
      stale.channelBindingsByIntegrationId as Record<string, never[]>,
      integrationId,
    );
    appendStaleRows(
      clone.threadBindingsByIntegrationId as Record<string, never[]>,
      stale.threadBindingsByIntegrationId as Record<string, never[]>,
      integrationId,
    );
    appendStaleRows(
      clone.dataOperationsByIntegrationId as Record<string, never[]>,
      stale.dataOperationsByIntegrationId as Record<string, never[]>,
      integrationId,
    );
  }
  return clone;
}

function withSecondActiveFeishuAgentBotEvidence(
  input: ReturnType<typeof buildCompleteFeishuEvidenceInput>,
  options: {
    integrationId?: string;
    displayName?: string;
    agentId?: string;
    appId?: string;
    tenantKey?: string;
    chatReference?: string;
  } = {},
) {
  const secondIntegrationId = options.integrationId ?? "agent-bot-hermes";
  const secondAgentId = options.agentId ?? "HermesAgent";
  const primaryIntegrationId = (input.integrations as Array<{ id?: string }>)[0]?.id ?? "integration-evidence";
  const withOptionalChatReference = <T extends { metadataJson?: string }>(record: T): T =>
    options.chatReference
      ? withMetadataFields(record, { externalChatReference: options.chatReference })
      : record;

  return {
    ...input,
    integrations: [
      ...input.integrations,
      buildIntegrationRecord({
        id: secondIntegrationId,
        displayName: options.displayName ?? "HermesAgent Bot",
        agentId: secondAgentId,
        appId: options.appId ?? "cli_hermes_bot",
        ...(options.tenantKey ? { tenantKey: options.tenantKey } : {}),
        transportMode: "websocket_worker",
        lastHealthStatus: "healthy",
      }),
    ],
    eventsByIntegrationId: {
      ...input.eventsByIntegrationId,
      [secondIntegrationId]: [],
    },
    messageMappingsByIntegrationId: {
      ...input.messageMappingsByIntegrationId,
      [secondIntegrationId]: [],
    },
    channelBindingsByIntegrationId: {
      ...input.channelBindingsByIntegrationId,
      [secondIntegrationId]: [
        withOptionalChatReference(buildAutoProvisionedChannelBinding(secondIntegrationId, "bot_added", {
          agentId: secondAgentId,
          botBindingId: secondIntegrationId,
          linkedFromBindingId: `channel-${primaryIntegrationId}`,
          linkedFromAgentId: "Atlas",
          linkedFromBotBindingId: primaryIntegrationId,
        })),
      ],
    },
    threadBindingsByIntegrationId: {
      ...input.threadBindingsByIntegrationId,
      [secondIntegrationId]: [
        withOptionalChatReference(buildThreadBinding(secondIntegrationId, {
          id: `thread-${secondIntegrationId}-collaboration`,
          agentId: secondAgentId,
          botBindingId: secondIntegrationId,
          threadCollaboration: true,
          collaboratingAgentIds: ["Atlas"],
          collaboratingBotBindingIds: [primaryIntegrationId],
        })),
      ],
    },
    outboxByIntegrationId: {
      ...input.outboxByIntegrationId,
      [secondIntegrationId]: [
        withOptionalChatReference(buildThreadCollaborationCardOutboxItem(secondIntegrationId, {
          agentId: secondAgentId,
          botBindingId: secondIntegrationId,
          collaboratingAgentIds: ["Atlas"],
          collaboratingBotBindingIds: [primaryIntegrationId],
        })),
      ],
    },
    dataOperationsByIntegrationId: {
      ...input.dataOperationsByIntegrationId,
      [secondIntegrationId]: [],
    },
  } as ReturnType<typeof buildCompleteFeishuEvidenceInput>;
}

function buildMessageMapping(
  integrationId: string,
  direction: "inbound" | "outbound",
  externalMessageId: string,
  externalThreadId?: string,
  options: {
    actorType?: "user" | "external_guest";
    externalGuestPolicyDecision?: "allow" | "ignore" | "require_identity";
    agentBotMentioned?: boolean;
  } = {},
) {
  const actorType = options.actorType ?? "user";
  return {
    id: `${direction}-${integrationId}-${externalMessageId}`,
    workspaceId: "workspace-1",
    integrationId,
    channelBindingId: `channel-${integrationId}`,
    direction,
    externalMessageId,
    externalThreadId,
    externalSenderId: direction === "inbound" ? "ou_secret" : undefined,
    externalEventId: direction === "inbound" ? "evt_secret" : undefined,
    agentSpaceMessageId: direction === "outbound" ? "message-reply-1" : "message-source-1",
    taskQueueId: direction === "inbound" ? "task-1" : undefined,
    routerSessionId: direction === "inbound" ? "router-1" : undefined,
    createdAt: direction === "outbound"
      ? freshFeishuEvidenceTimestamp(2000)
      : freshFeishuEvidenceTimestamp(1000),
    ...(direction === "inbound"
      ? {
        metadataJson: JSON.stringify({
          provider: "feishu",
          externalChatReference: FEISHU_TEST_CHAT_REFERENCE,
          externalThreadReference: "thread-ref-hash",
          mappedChannelName: "general",
          dispatchStatus: "sent",
          actorType,
          ...(actorType === "user"
            ? { userId: "user-1", actorUserId: "user-1" }
            : {
              workspaceMemberCreated: false,
              externalGuestReference: "guest-ref-hash",
              externalGuestPermissionProfile: "channel_context_only",
              externalGuestPolicyDecision: options.externalGuestPolicyDecision,
              externalGuestPolicyReasonCode: options.externalGuestPolicyDecision === "allow"
                ? "feishu_external_guest_allowed"
                : undefined,
              externalGuestUnboundUserMode: options.externalGuestPolicyDecision === "allow"
                ? "reply_on_mention"
                : undefined,
            }),
          agentId: "Atlas",
          botBindingId: integrationId,
          agentBotMentioned: options.agentBotMentioned ?? true,
          threadBindingId: `thread-${integrationId}`,
        }),
      }
      : {
        metadataJson: JSON.stringify({
          provider: "feishu",
          externalChatReference: FEISHU_TEST_CHAT_REFERENCE,
          externalThreadReference: "thread-ref-hash",
          agentId: "Atlas",
          botBindingId: integrationId,
          agentActionPolicyInput: {
            action: {
              type: "external_message.send",
              resourceReference: FEISHU_TEST_CHAT_REFERENCE,
              resourceIdRedacted: true,
            },
          },
        }),
      }),
  } as never;
}

function withExternalGuestUserIdentity<T extends { metadataJson?: string }>(mapping: T): T {
  const metadata = JSON.parse(mapping.metadataJson ?? "{}") as Record<string, unknown>;
  if (metadata.actorType !== "external_guest") {
    return mapping;
  }
  return {
    ...mapping,
    metadataJson: JSON.stringify({
      ...metadata,
      userId: "user-should-not-exist",
    }),
  };
}

function withAgentBotMentioned<T extends { metadataJson?: string }>(mapping: T, agentBotMentioned: boolean): T {
  const metadata = JSON.parse(mapping.metadataJson ?? "{}") as Record<string, unknown>;
  if (metadata.provider !== "feishu" || !("agentBotMentioned" in metadata)) {
    return mapping;
  }
  return {
    ...mapping,
    metadataJson: JSON.stringify({
      ...metadata,
      agentBotMentioned,
    }),
  };
}

function withBotBindingId<T extends { metadataJson?: string }>(mapping: T, botBindingId: string): T {
  const metadata = JSON.parse(mapping.metadataJson ?? "{}") as Record<string, unknown>;
  if (metadata.provider !== "feishu") {
    return mapping;
  }
  return {
    ...mapping,
    metadataJson: JSON.stringify({
      ...metadata,
      botBindingId,
    }),
  };
}

function withoutMetadataField<T extends { metadataJson?: string }>(mapping: T, field: string): T {
  const metadata = JSON.parse(mapping.metadataJson ?? "{}") as Record<string, unknown>;
  delete metadata[field];
  return {
    ...mapping,
    metadataJson: JSON.stringify(metadata),
  };
}

function withMetadataFields<T extends { metadataJson?: string }>(record: T, fields: Record<string, unknown>): T {
  const metadata = JSON.parse(record.metadataJson ?? "{}") as Record<string, unknown>;
  return {
    ...record,
    metadataJson: JSON.stringify({
      ...metadata,
      ...fields,
    }),
  };
}

function withDispatchEvidence<T extends { agentSpaceMessageId?: string; taskQueueId?: string }>(mapping: T): T {
  return {
    ...mapping,
    agentSpaceMessageId: "message-should-not-dispatch",
    taskQueueId: "task-should-not-dispatch",
  };
}

function buildGuestPolicyEvidenceMappings(integrationId: string) {
  return [
    buildPolicyBlockedMessageMapping(integrationId, {
      externalMessageId: "om_secret_guest_require_identity",
      decision: "require_identity",
      reasonCode: "feishu_external_guest_identity_required",
      unboundUserMode: "require_identity",
    }),
    buildPolicyBlockedMessageMapping(integrationId, {
      externalMessageId: "om_secret_guest_ignored",
      decision: "ignore",
      reasonCode: "feishu_external_guest_ignored",
      unboundUserMode: "ignore",
    }),
    buildPolicyBlockedMessageMapping(integrationId, {
      externalMessageId: "om_secret_guest_unmentioned",
      decision: "ignore",
      reasonCode: "feishu_external_guest_bot_mention_required",
      unboundUserMode: "reply_on_mention",
    }),
  ];
}

function buildExternalGuestReplyAllMapping(integrationId: string) {
  return {
    id: `inbound-${integrationId}-om_secret_guest_reply_all`,
    workspaceId: "workspace-1",
    integrationId,
    channelBindingId: `channel-${integrationId}`,
    direction: "inbound",
    externalMessageId: "om_secret_guest_reply_all",
    externalThreadId: "om_secret_guest_reply_all",
    externalSenderId: "ou_secret",
    externalEventId: "evt_secret",
    agentSpaceMessageId: "message-reply-all-source",
    taskQueueId: "task-reply-all",
    routerSessionId: "router-reply-all",
    metadataJson: JSON.stringify({
      provider: "feishu",
      externalChatReference: FEISHU_TEST_CHAT_REFERENCE,
      externalThreadReference: "thread-ref-hash",
      mappedChannelName: "general",
      dispatchStatus: "sent",
      actorType: "external_guest",
      workspaceMemberCreated: false,
      externalGuestReference: "guest-ref-hash",
      externalGuestPermissionProfile: "channel_context_only",
      externalGuestPolicyDecision: "allow",
      externalGuestPolicyReasonCode: "feishu_external_guest_allowed",
      externalGuestUnboundUserMode: "reply_all",
      agentId: "Atlas",
      botBindingId: integrationId,
      agentBotMentioned: false,
      threadBindingId: `thread-${integrationId}`,
    }),
    createdAt: freshFeishuEvidenceTimestamp(1000),
  } as never;
}

function buildThreadContinuationMapping(integrationId: string) {
  return {
    id: `inbound-${integrationId}-om_secret_thread_continuation`,
    workspaceId: "workspace-1",
    integrationId,
    channelBindingId: `channel-${integrationId}`,
    direction: "inbound",
    externalMessageId: "om_secret_thread_continuation",
    externalThreadId: "om_secret_inbound",
    externalSenderId: "ou_secret",
    externalEventId: "evt_secret",
    agentSpaceMessageId: "message-thread-continuation-source",
    taskQueueId: "task-thread-continuation",
    routerSessionId: "router-thread-continuation",
    metadataJson: JSON.stringify({
      provider: "feishu",
      externalChatReference: FEISHU_TEST_CHAT_REFERENCE,
      externalThreadReference: "thread-ref-hash",
      mappedChannelName: "general",
      dispatchStatus: "sent",
      actorType: "user",
      userId: "user-1",
      agentId: "Atlas",
      botBindingId: integrationId,
      agentBotMentioned: false,
      threadBindingId: `thread-${integrationId}`,
      threadContinuation: true,
    }),
    createdAt: freshFeishuEvidenceTimestamp(3000),
  } as never;
}

function buildAgentChannelPolicyDeniedMapping(integrationId: string) {
  return {
    id: `inbound-${integrationId}-om_secret_agent_policy_disabled`,
    workspaceId: "workspace-1",
    integrationId,
    channelBindingId: `channel-${integrationId}`,
    direction: "inbound",
    externalMessageId: "om_secret_agent_policy_disabled",
    externalThreadId: "om_secret_agent_policy_disabled",
    externalSenderId: "ou_secret",
    externalEventId: "evt_secret",
    metadataJson: JSON.stringify({
      provider: "feishu",
      externalChatReference: FEISHU_TEST_CHAT_REFERENCE,
      externalThreadReference: "thread-ref-hash",
      mappedChannelName: "general",
      dispatchStatus: "ignored",
      reasonCode: "feishu_agent_channel_member_access_disabled",
      actorType: "external_guest",
      workspaceMemberCreated: false,
      externalGuestReference: "guest-ref-hash",
      externalGuestPermissionProfile: "channel_context_only",
      externalGuestPolicyDecision: "allow",
      externalGuestPolicyReasonCode: "feishu_external_guest_allowed",
      externalGuestUnboundUserMode: "reply_on_mention",
      agentId: "Atlas",
      botBindingId: integrationId,
      agentBotMentioned: true,
    }),
    createdAt: freshFeishuEvidenceTimestamp(1000),
  } as never;
}

function buildBotSenderLoopGuardMapping(integrationId: string) {
  return {
    id: `inbound-${integrationId}-om_secret_bot_sender_loop`,
    workspaceId: "workspace-1",
    integrationId,
    channelBindingId: `channel-${integrationId}`,
    direction: "inbound",
    externalMessageId: "om_secret_bot_sender_loop",
    externalThreadId: "om_secret_bot_sender_loop",
    externalSenderId: "ou_secret_bot_sender",
    externalEventId: "evt_secret_bot_sender",
    metadataJson: JSON.stringify({
      provider: "feishu",
      externalChatReference: FEISHU_TEST_CHAT_REFERENCE,
      externalThreadReference: "thread-ref-hash",
      mappedChannelName: "general",
      dispatchStatus: "ignored",
      reasonCode: "feishu_bot_sender_ignored",
      agentId: "Atlas",
      botBindingId: integrationId,
      agentBotMentioned: false,
    }),
    createdAt: freshFeishuEvidenceTimestamp(1000),
  } as never;
}

function buildPolicyBlockedMessageMapping(
  integrationId: string,
  input: {
    externalMessageId: string;
    decision: "ignore" | "require_identity";
    reasonCode: string;
    unboundUserMode: "ignore" | "reply_on_mention" | "require_identity";
  },
) {
  return {
    id: `inbound-${integrationId}-${input.externalMessageId}`,
    workspaceId: "workspace-1",
    integrationId,
    channelBindingId: `channel-${integrationId}`,
    direction: "inbound",
    externalMessageId: input.externalMessageId,
    externalThreadId: input.externalMessageId,
    externalSenderId: "ou_secret",
    externalEventId: "evt_secret",
    metadataJson: JSON.stringify({
      provider: "feishu",
      externalChatReference: FEISHU_TEST_CHAT_REFERENCE,
      externalThreadReference: "thread-ref-hash",
      mappedChannelName: "general",
      dispatchStatus: "ignored",
      reasonCode: input.reasonCode,
      actorType: "external_guest",
      workspaceMemberCreated: false,
      externalGuestReference: "guest-ref-hash",
      externalGuestPermissionProfile: input.unboundUserMode === "reply_on_mention" ? "channel_context_only" : "none",
      externalGuestPolicyDecision: input.decision,
      externalGuestPolicyReasonCode: input.reasonCode,
      externalGuestUnboundUserMode: input.unboundUserMode,
      agentId: "Atlas",
      botBindingId: integrationId,
      agentBotMentioned: input.reasonCode !== "feishu_external_guest_bot_mention_required",
    }),
    createdAt: freshFeishuEvidenceTimestamp(1000),
  } as never;
}

function buildAutoProvisionedChannelBinding(
  integrationId: string,
  provisionSource: "bot_added" | "first_message",
  options: {
    agentId?: string;
    botBindingId?: string;
    linkedFromBindingId?: string;
    linkedFromAgentId?: string;
    linkedFromBotBindingId?: string;
    reviewStatus?: string;
    channelName?: string;
    externalChatId?: string;
  } = {},
) {
  const agentId = options.agentId ?? "Atlas";
  const botBindingId = options.botBindingId ?? integrationId;
  return {
    ...(buildChannelBinding(integrationId, {
      ...(options.channelName !== undefined ? { channelName: options.channelName } : {}),
      ...(options.externalChatId !== undefined ? { externalChatId: options.externalChatId } : {}),
    }) as Record<string, unknown>),
    metadataJson: JSON.stringify({
      provider: "feishu",
      provisionSource,
      reviewStatus: options.reviewStatus ?? "approved",
      agentId,
      botBindingId,
      externalChatReference: FEISHU_TEST_CHAT_REFERENCE,
      linkedFromBindingId: options.linkedFromBindingId,
      linkedFromAgentId: options.linkedFromAgentId,
      linkedFromBotBindingId: options.linkedFromBotBindingId,
    }),
  } as never;
}

function buildThreadBinding(
  integrationId: string,
  options: {
    id?: string;
    agentId?: string;
    botBindingId?: string;
    taskQueueId?: string;
    agentSpaceMessageId?: string;
    threadCollaboration?: boolean;
    collaboratingAgentIds?: string[];
    collaboratingBotBindingIds?: string[];
  } = {},
) {
  const agentId = options.agentId ?? "Atlas";
  const botBindingId = options.botBindingId ?? integrationId;
  return {
    id: options.id ?? `thread-${integrationId}`,
    workspaceId: "workspace-1",
    integrationId,
    channelBindingId: `channel-${integrationId}`,
    provider: "feishu",
    tenantKey: "tenant-1",
    externalChatId: "oc_secret",
    externalThreadId: "om_secret_inbound",
    channelName: "general",
    agentId,
    taskQueueId: options.taskQueueId ?? "task-1",
    agentSpaceMessageId: options.agentSpaceMessageId ?? "message-source-1",
    status: "active",
    metadataJson: JSON.stringify({
      provider: "feishu",
      externalChatReference: FEISHU_TEST_CHAT_REFERENCE,
      externalThreadReference: "thread-ref-hash",
      agentId,
      botBindingId,
      actorType: "user",
      routerSessionId: "router-1",
      ...(options.threadCollaboration
        ? {
            threadCollaboration: true,
            collaboratingAgentIds: options.collaboratingAgentIds ?? ["Atlas"],
            collaboratingBotBindingIds: options.collaboratingBotBindingIds ?? ["integration-evidence-atlas"],
          }
        : {}),
    }),
    lastMessageAt: freshFeishuEvidenceTimestamp(1000),
    createdAt: freshFeishuEvidenceTimestamp(),
    updatedAt: freshFeishuEvidenceTimestamp(),
  } as never;
}

function buildOpenApiEvidenceFixture() {
  const steps = [
    openApiLiveStep("Client im.message.create", {
      method: "POST",
      path: "/open-apis/im/v1/messages",
      queryKeys: ["receive_id_type"],
      bodyKeys: ["content", "msg_type", "receive_id"],
    }),
    openApiCallbackLiveStep({
      workspaceId: "workspace-1",
      integrationId: "integration-evidence",
    }),
    openApiLiveStep("Tenant access token"),
    openApiLiveStep("Docs docx metadata", {
      method: "POST",
      path: "/open-apis/drive/v1/metas/batch_query",
      bodyKeys: ["request_docs", "with_url"],
    }),
    openApiLiveStep("Docs docx read blocks", {
      method: "GET",
      path: "/open-apis/docx/v1/documents/:doc_token/blocks",
      queryKeys: ["page_size"],
    }),
    openApiLiveStep("Docs docx append blocks", {
      method: "POST",
      path: "/open-apis/docx/v1/documents/:doc_token/blocks/:parent_block_id/children",
      bodyKeys: ["children", "index"],
    }, true),
    openApiLiveStep("Sheets metadata", {
      method: "GET",
      path: "/open-apis/sheets/v2/spreadsheets/:sheet_token/metainfo",
    }),
    openApiLiveStep("Sheets read values", {
      method: "GET",
      path: "/open-apis/sheets/v2/spreadsheets/:sheet_token/values/:range",
    }),
    openApiLiveStep("Sheets write values", {
      method: "PUT",
      path: "/open-apis/sheets/v2/spreadsheets/:sheet_token/values",
      bodyKeys: ["valueRange"],
    }, true),
    openApiLiveStep("Base list tables", {
      method: "GET",
      path: "/open-apis/bitable/v1/apps/:app_token/tables",
      queryKeys: ["page_size"],
    }),
    openApiLiveStep("Base list records", {
      method: "GET",
      path: "/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records",
      queryKeys: ["page_size"],
    }),
    openApiLiveStep("Base update record", {
      method: "PUT",
      path: "/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/:record_id",
      bodyKeys: ["fields"],
    }, true),
  ];
  return {
    generatedAt: new Date().toISOString(),
    live: true,
    strictLive: true,
    appIdentity: {
      appIdPresent: true,
      appIdHash: createHash("sha256").update("cli_a", "utf8").digest("hex"),
      tenantKeyPresent: false,
      tenantKeyHash: undefined as string | undefined,
    },
    summary: {
      total: steps.length + 4,
      passed: steps.length + 4,
      skipped: 0,
      failed: 0,
      liveChecks: steps.length,
      livePassed: steps.length,
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
      secondAgentAppIdHash: createHash("sha256").update("cli_hermes_bot", "utf8").digest("hex"),
      missing: [],
      invalid: [],
    },
    steps: [
      ...steps,
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
    ],
  };
}

function buildBotAddedPayloadEvidenceFixture() {
  return {
    generatedAt: new Date().toISOString(),
    payloadPath: "runtime-output/feishu-smoke/bot-added-callback.json",
    valid: true,
    issues: [],
    summary: {
      eventType: "im.chat.member.bot.added_v1",
      botAddedEvent: true,
      appIdPresent: true,
      appIdHash: createHash("sha256").update("cli_a", "utf8").digest("hex"),
      tenantKeyPresent: false,
      tenantKeyHash: undefined as string | undefined,
      chatDescriptorPresent: true,
      chatIdSource: "event.chat.openChatId",
      chatReference: FEISHU_TEST_CHAT_REFERENCE,
      chatIdRedacted: true,
      chatType: "group",
      chatNamePresent: true,
      chatNameHash: createHash("sha256").update("Phase 6 smoke group", "utf8").digest("hex"),
      chatNameLength: 19,
      externalEventReference: "event abcdef1234567890",
      externalEventIdRedacted: true,
      eventCreateTimePresent: true,
      eventCreateTimeFresh: true,
      payloadHash: createHash("sha256").update("bot-added-payload", "utf8").digest("hex"),
      rawPayloadStored: false,
    },
  };
}

function openApiCallbackLiveStep(input: {
  workspaceId: string;
  integrationId: string;
}) {
  const routeKey = `/api/integrations/feishu/events?workspaceId=${input.workspaceId}&integrationId=${input.integrationId}`;
  return {
    name: "AgentSpace callback URL verification",
    status: "pass",
    detail: "ok",
    liveCheck: true,
    callbackRoute: "/api/integrations/feishu/events",
    callbackRouteFingerprint: `sha256:${createHash("sha256").update(routeKey, "utf8").digest("hex").slice(0, 16)}`,
  };
}

function openApiLiveStep(
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
    ...(destructive ? { destructive: true } : {}),
    ...(request ? { request } : {}),
  };
}

function buildIntegrationRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "integration-1",
    workspaceId: "workspace-1",
    provider: "feishu",
    displayName: "Feishu",
    status: "active",
    transportMode: "http_webhook",
    appId: "cli_a",
    encryptedCredentialsJson: JSON.stringify({
      appSecret: "encrypted-app-secret",
      verificationToken: "encrypted-verification-token",
    }),
    configJson: "{}",
    capabilitiesJson: "{}",
    scopesJson: JSON.stringify(FEISHU_TEST_SCOPES),
    createdAt: freshFeishuEvidenceTimestamp(),
    updatedAt: freshFeishuEvidenceTimestamp(),
    ...overrides,
  } as never;
}

function buildChannelBinding(integrationId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `channel-${integrationId}`,
    workspaceId: "workspace-1",
    integrationId,
    channelName: "general",
    externalChatId: "oc_secret",
    status: "active",
    syncMode: "mirror",
    metadataJson: "{}",
    createdAt: freshFeishuEvidenceTimestamp(),
    updatedAt: freshFeishuEvidenceTimestamp(),
    ...overrides,
  } as never;
}

function buildUserBinding(integrationId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `user-${integrationId}`,
    workspaceId: "workspace-1",
    integrationId,
    userId: "user-1",
    externalUserId: "ou_secret",
    status: "active",
    metadataJson: "{}",
    createdAt: freshFeishuEvidenceTimestamp(),
    updatedAt: freshFeishuEvidenceTimestamp(),
    ...overrides,
  } as never;
}

function buildResourceBinding(integrationId: string, providerResourceType: string, providerResourceToken: string) {
  return {
    id: `${providerResourceType}-${integrationId}`,
    workspaceId: "workspace-1",
    integrationId,
    providerResourceType,
    providerResourceToken,
    agentSpaceResourceType: providerResourceType === "doc" ? "channel_document" : "data_table",
    agentSpaceResourceId: `${providerResourceType}-resource-1`,
    status: "active",
    permissionsJson: JSON.stringify({ canRead: true, canWrite: true }),
    metadataJson: defaultFeishuResourceBindingMetadataJson(providerResourceType, providerResourceToken),
    createdAt: freshFeishuEvidenceTimestamp(),
    updatedAt: freshFeishuEvidenceTimestamp(),
  } as never;
}

function buildReadOnlyResourceBinding(integrationId: string, providerResourceType: string, providerResourceToken: string) {
  return {
    ...(buildResourceBinding(integrationId, providerResourceType, providerResourceToken) as Record<string, unknown>),
    permissionsJson: "{}",
  } as never;
}

function buildResourceBindingWithMetadata(
  integrationId: string,
  providerResourceType: string,
  providerResourceToken: string,
  metadataJson: string,
) {
  const binding = buildResourceBinding(integrationId, providerResourceType, providerResourceToken) as Record<string, unknown>;
  return {
    ...binding,
    metadataJson,
  } as never;
}

function defaultFeishuResourceBindingMetadataJson(providerResourceType: string, providerResourceToken: string) {
  if (providerResourceType === "base_table") {
    return JSON.stringify({
      appToken: "app_secret",
      tableId: providerResourceToken,
    });
  }
  if (providerResourceType === "base_view") {
    return JSON.stringify({
      appToken: "app_secret",
      tableId: "tbl_secret",
      viewId: providerResourceToken,
    });
  }
  return "{}";
}

function readSmokeEnvEntry(
  report: ReturnType<typeof buildFeishuSmokeEnvTemplateReport>,
  key: string,
) {
  return report.entries.find((entry) => entry.key === key);
}

function buildOutboxItem(
  integrationId: string,
  status: "failed" | "pending" | "sent",
  options: {
    metadataJson?: string;
  } = {},
) {
  return {
    id: `${status}-${integrationId}`,
    workspaceId: "workspace-1",
    integrationId,
    channelBindingId: `channel-${integrationId}`,
    targetExternalChatId: "oc_secret",
    targetExternalThreadId: "om_secret_inbound",
    agentSpaceMessageId: "agent-space-reply-1",
    payloadJson: JSON.stringify({ text: "payload-secret" }),
    metadataJson: options.metadataJson ?? JSON.stringify({
      provider: "feishu",
      outboxSource: "agent_reply",
      externalChatReference: FEISHU_TEST_CHAT_REFERENCE,
      externalThreadReference: "thread-ref-hash",
      agentId: "Codex",
      botBindingId: integrationId,
    }),
    status,
    attempts: 1,
    lastError: status === "sent" ? undefined : "provider error",
    createdAt: freshFeishuEvidenceTimestamp(),
    updatedAt: freshFeishuEvidenceTimestamp(),
    sentAt: status === "sent" ? freshFeishuEvidenceTimestamp(1000) : undefined,
  } as never;
}

function buildIdentityBindingNoticeOutboxItem(integrationId: string, status: "failed" | "pending" | "sent" = "sent") {
  return {
    ...(buildOutboxItem(integrationId, status, {
      metadataJson: JSON.stringify({
        provider: "feishu",
        noticeType: "identity_binding_required",
        noticeSource: "external_guest_policy",
        reasonCode: "feishu_external_guest_identity_required",
        actorType: "external_guest",
        workspaceMemberCreated: false,
        agentId: "Atlas",
        botBindingId: integrationId,
        externalGuestReference: "guest-ref-hash",
        externalGuestPermissionProfile: "none",
        externalChatReference: FEISHU_TEST_CHAT_REFERENCE,
        externalThreadReference: shortHashForTest("om_secret_guest_require_identity"),
      }),
    }) as Record<string, unknown>),
    id: `${status}-${integrationId}-identity-binding-notice`,
    channelBindingId: `channel-${integrationId}`,
    targetExternalThreadId: "om_secret_guest_require_identity",
  } as never;
}

function buildThreadCollaborationCardOutboxItem(
  integrationId: string,
  options: {
    agentId?: string;
    botBindingId?: string;
    collaboratingAgentIds?: string[];
    collaboratingBotBindingIds?: string[];
    externalChatReference?: string;
    externalThreadReference?: string;
    status?: "failed" | "pending" | "sent";
  } = {},
) {
  const status = options.status ?? "sent";
  return {
    ...(buildOutboxItem(integrationId, status, {
      metadataJson: JSON.stringify({
        provider: "feishu",
        noticeType: "thread_collaboration",
        noticeSource: "native_agent_bot",
        agentId: options.agentId ?? "HermesAgent",
        botBindingId: options.botBindingId ?? integrationId,
        collaboratingAgentIds: options.collaboratingAgentIds ?? ["Atlas"],
        collaboratingBotBindingIds: options.collaboratingBotBindingIds ?? ["integration-evidence-atlas"],
        externalChatReference: options.externalChatReference ?? FEISHU_TEST_CHAT_REFERENCE,
        externalThreadReference: options.externalThreadReference ?? "thread-ref-hash",
      }),
    }) as Record<string, unknown>),
    id: `${status}-${integrationId}-thread-collaboration-card`,
    payloadJson: JSON.stringify({ msg_type: "interactive", content: "AgentSpace agent joined this thread" }),
  } as never;
}

function shortHashForTest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function buildIntegrationEvent(
  integrationId: string,
  externalEventId: string,
  eventType: string,
  status: "received" | "processed" | "ignored" | "failed",
  payload: Record<string, unknown> = buildSafeInboundEventPayload(),
) {
  return {
    id: `${status}-${integrationId}-${eventType}`,
    workspaceId: "workspace-1",
    integrationId,
    provider: "feishu",
    externalEventId,
    eventType,
    status,
    payloadJson: JSON.stringify(payload),
    errorMessage: status === "failed" ? "provider error" : undefined,
    receivedAt: freshFeishuEvidenceTimestamp(),
    processedAt: status === "processed" || status === "failed" || status === "ignored"
      ? freshFeishuEvidenceTimestamp(1000)
      : undefined,
  } as never;
}

function buildSafeInboundEventPayload(payload: Record<string, unknown> = {}) {
  return {
    provider: "feishu",
    externalEventReference: "event-ref-safe",
    externalEventIdRedacted: true,
    eventType: "im.message.receive_v1",
    payloadHash: "payload-hash-safe",
    rawPayloadStored: false,
    contentRedacted: true,
    message: {
      messageReference: "message-ref-safe",
      messageIdRedacted: true,
      chatReference: "chat-ref-safe",
      chatIdRedacted: true,
      threadReference: "thread-ref-safe",
      threadIdRedacted: true,
      messageType: "text",
      contentLength: 24,
      contentHash: "content-hash-safe",
    },
    sender: {
      openIdReference: "user-ref-safe",
      openIdRedacted: true,
      unionIdReference: "union-ref-safe",
      unionIdRedacted: true,
      userIdReference: "user-id-ref-safe",
      userIdRedacted: true,
    },
    ...payload,
  };
}

function buildApprovalCardActionEvent(
  integrationId: string,
  externalEventId: string,
  status: "received" | "processed" | "ignored" | "failed" = "processed",
  approvalCardAction: Record<string, unknown> = {},
  payload: Record<string, unknown> = {},
) {
  return buildIntegrationEvent(integrationId, externalEventId, "card.action.trigger", status, {
    provider: "feishu",
    eventType: "card.action.trigger",
    rawPayloadStored: false,
    approvalCardAction: {
      provider: "feishu",
      kind: "data_operation_approval",
      approvalId: "approval-safe-1",
      payloadHash: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      decision: "approved",
      tokenStored: false,
      rawActionPayloadStored: false,
      ...approvalCardAction,
    },
    ...payload,
  });
}

function buildAgentRuntimeDocReadRun(integrationId: string) {
  const governanceContext = buildFeishuTestGovernanceContext({
    actorType: "agent",
    actorId: "agent-1",
    botBindingId: integrationId,
    resourceReference: "doc / resource safe-ref",
  });
  return {
    ...(buildDataOperationRun(integrationId, "docs.read_document", "doc", "succeeded") as Record<string, unknown>),
    requestJson: JSON.stringify({
      source: "lark-cli-result-manifest",
      resultManifestPath: FEISHU_TEST_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH,
      operationKind: "read",
      governanceContext,
    }),
    resultJson: JSON.stringify({
      source: "lark-cli",
      operationType: "docs.read_document",
      runtimeResultManifest: {
        path: FEISHU_TEST_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH,
      },
    }),
  } as never;
}

function buildExternalGuestDocReadRun(integrationId: string) {
  return buildDataOperationRun(integrationId, "docs.read_document", "doc", "succeeded", undefined, {
    governanceActorType: "external_guest",
    governanceExternalGuestResourceAccess: "guest_readable_current_channel",
  });
}

function buildExternalGuestWriteDeniedRun(
  integrationId: string,
  options: Pick<DataOperationRunOptions,
    "governanceAgentId" |
    "governanceBotBindingId" |
    "governanceExternalActorReference" |
    "governanceExternalGuestPermissionProfile"
  > = {},
) {
  return buildDataOperationRun(integrationId, "base.mutate_records", "base_table", "failed", undefined, {
    governanceActorType: "external_guest",
    ...options,
    errorCode: "feishu.data_operation_external_guest_requires_identity",
    errorMessage: "External Feishu guests must bind an AgentSpace identity before writing governed resources.",
  });
}

function withGovernanceUserIdentity<T extends { requestJson: string }>(operation: T): T {
  return withGovernanceContextFields(operation, { actorUserId: "user-should-not-exist" });
}

function withGovernanceContextFields<T extends { requestJson: string }>(
  operation: T,
  fields: Record<string, unknown>,
): T {
  const request = JSON.parse(operation.requestJson) as Record<string, unknown>;
  const governanceContext = typeof request.governanceContext === "object" && request.governanceContext !== null
    ? request.governanceContext as Record<string, unknown>
    : {};
  return {
    ...operation,
    requestJson: JSON.stringify({
      ...request,
      governanceContext: {
        ...governanceContext,
        ...fields,
      },
    }),
  };
}

function readTestGovernanceActorType(operation: { requestJson: string }): string | undefined {
  const request = JSON.parse(operation.requestJson) as Record<string, unknown>;
  const governanceContext = typeof request.governanceContext === "object" && request.governanceContext !== null
    ? request.governanceContext as Record<string, unknown>
    : {};
  return typeof governanceContext.actorType === "string" ? governanceContext.actorType : undefined;
}

function withoutResourceBindingId<T extends { resourceBindingId?: string }>(operation: T): T {
  return {
    ...operation,
    resourceBindingId: undefined,
  };
}

function withApprovedPayloadHash<T extends { resultJson: string }>(operation: T, payloadHash: string): T {
  const result = JSON.parse(operation.resultJson) as Record<string, unknown>;
  return {
    ...operation,
    resultJson: JSON.stringify({
      ...result,
      payloadHash,
    }),
  };
}

function withResultJsonFields<T extends { resultJson: string }>(operation: T, fields: Record<string, unknown>): T {
  const result = JSON.parse(operation.resultJson) as Record<string, unknown>;
  return {
    ...operation,
    resultJson: JSON.stringify({
      ...result,
      ...fields,
    }),
  };
}

interface DataOperationRunOptions {
  governanceActorType?: "agent" | "user" | "external_guest" | "system";
  governanceAgentId?: string | null;
  governanceBotBindingId?: string | null;
  governanceActorUserId?: string | null;
  governanceExternalActorReference?: string | null;
  governanceExternalGuestPermissionProfile?: string | null;
  governanceExternalGuestResourceAccess?: string | null;
  governanceWorkspaceMemberCreated?: boolean | null;
  governanceResourceReference?: string | null;
  governanceResourceIdRedacted?: boolean | null;
  errorCode?: string;
  errorMessage?: string;
}

function buildDataOperationRun(
  integrationId: string,
  operationType: string,
  providerResourceType: string,
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled",
  actor: {
    actorType: "agent" | "user";
    actorId: string;
  } = {
    actorType: "agent",
    actorId: "agent-1",
  },
  options: DataOperationRunOptions = {},
) {
  const approvedWriteSucceeded = status === "succeeded" &&
    (
      operationType === "docs.create_document" ||
      operationType === "docs.update_document" ||
      operationType === "sheets.update_range" ||
      operationType === "base.mutate_records"
    );
  const dataTableWriteSucceeded = approvedWriteSucceeded &&
    (operationType === "sheets.update_range" || operationType === "base.mutate_records");
  const governanceContext = buildFeishuTestGovernanceContext({
    actorType: options.governanceActorType ?? actor.actorType,
    actorId: actor.actorId,
    agentId: options.governanceAgentId,
    botBindingId: options.governanceBotBindingId === undefined ? integrationId : options.governanceBotBindingId,
    actorUserId: options.governanceActorUserId,
    externalActorReference: options.governanceExternalActorReference,
    externalGuestPermissionProfile: options.governanceExternalGuestPermissionProfile,
    externalGuestResourceAccess: options.governanceExternalGuestResourceAccess,
    workspaceMemberCreated: options.governanceWorkspaceMemberCreated,
    resourceReference: options.governanceResourceReference === undefined
      ? `${providerResourceType} / resource safe-ref`
      : options.governanceResourceReference,
    resourceIdRedacted: options.governanceResourceIdRedacted,
  });
  return {
    id: `${status}-${operationType}-${integrationId}`,
    workspaceId: "workspace-1",
    integrationId,
    resourceBindingId: `${providerResourceType}-${integrationId}`,
    operationType,
    providerResourceType,
    providerResourceToken: `${providerResourceType}_secret`,
    actorType: actor.actorType,
    actorId: actor.actorId,
    status,
    requestJson: JSON.stringify({ range: "A1:B2", resource: "doccn_secret", governanceContext }),
    resultJson: JSON.stringify(approvedWriteSucceeded
      ? {
        policyDecision: "approved",
        approvalId: `approval-${operationType}-${integrationId}`,
        payloadHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        ...(dataTableWriteSucceeded
          ? {
            agentSpaceSync: {
              dataTableLastApprovedWriteSynced: true,
              resourceMetadataSynced: false,
              resourceMetadataReasonCode: "feishu.resource_metadata_unavailable",
            },
          }
          : {}),
      }
      : {}),
    errorCode: status === "failed" ? options.errorCode ?? "provider_error" : undefined,
    errorMessage: status === "failed" ? options.errorMessage ?? "provider error for doccn_secret" : undefined,
    startedAt: freshFeishuEvidenceTimestamp(),
    finishedAt: status === "succeeded" || status === "failed" || status === "cancelled"
      ? freshFeishuEvidenceTimestamp(1000)
      : undefined,
    createdAt: freshFeishuEvidenceTimestamp(),
    updatedAt: freshFeishuEvidenceTimestamp(),
  } as never;
}

function buildFeishuTestGovernanceContext(input: {
  actorType: "agent" | "user" | "external_guest" | "system";
  actorId?: string;
  agentId?: string | null;
  botBindingId?: string | null;
  actorUserId?: string | null;
  externalActorReference?: string | null;
  externalGuestPermissionProfile?: string | null;
  externalGuestResourceAccess?: string | null;
  workspaceMemberCreated?: boolean | null;
  resourceReference?: string | null;
  resourceIdRedacted?: boolean | null;
}) {
  return {
    provider: "feishu",
    ...(input.agentId === null ? {} : { agentId: input.agentId ?? "agent-1" }),
    ...(input.botBindingId === null ? {} : { botBindingId: input.botBindingId ?? "bot-binding-1" }),
    channelName: "Launch Room",
    actorType: input.actorType,
    ...(input.resourceReference === null ? {} : { resourceReference: input.resourceReference ?? "resource safe-ref" }),
    ...(input.resourceIdRedacted === null
      ? {}
      : { resourceIdRedacted: input.resourceIdRedacted === undefined ? true : input.resourceIdRedacted }),
    ...(input.actorType === "user" && input.actorUserId !== null
      ? { actorUserId: input.actorUserId ?? input.actorId ?? "user-1" }
      : {}),
    ...(input.actorType === "external_guest"
      ? {
        ...(input.workspaceMemberCreated === null
          ? {}
          : { workspaceMemberCreated: input.workspaceMemberCreated ?? false }),
        ...(input.externalActorReference === null
          ? {}
          : { externalActorReference: input.externalActorReference ?? "external-guest-ref-hash" }),
        ...(input.externalGuestPermissionProfile === null
          ? {}
          : { externalGuestPermissionProfile: input.externalGuestPermissionProfile ?? "channel_context_only" }),
        ...(input.externalGuestResourceAccess === null || input.externalGuestResourceAccess === undefined
          ? {}
          : { externalGuestResourceAccess: input.externalGuestResourceAccess }),
        externalChatReference: "external-chat-ref-hash",
      }
      : {}),
  };
}
