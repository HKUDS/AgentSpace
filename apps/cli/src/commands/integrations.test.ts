import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildFeishuEvidenceReport,
  buildFeishuReadinessReport,
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
  updateFeishuAgentBotPolicyForCli,
  createFeishuChannelBindingForCli,
  createFeishuResourceBindingForCli,
  createFeishuUserBindingForCli,
  runFeishuHealthCheckCli,
  runFeishuDataOperationForCli,
  runFeishuDataOperationApprovalReviewForCli,
  buildFeishuSmokePlanReport,
  buildFeishuSmokeEnvTemplateReport,
  formatFeishuSmokeEnvCommandText,
  getFeishuSmokeEnvExitCode,
  getFeishuSmokePlanExitCode,
  getFeishuWorkerExitCode,
  runFeishuIntegrationCommand,
} from "./integrations/feishu.ts";
import { runIntegrationsCommand } from "./integrations/index.ts";
import { runIntegrationsOutboxCommand } from "./integrations/outbox.ts";

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
  assert.match(output, /--allow-write/);
  assert.match(output, /--guest-readable/);
  assert.match(output, /--approval-agent <agent-id>/);
  assert.match(output, /--approval-channel <channel>/);
  assert.match(output, /--approval-id <approval-id>/);
  assert.match(output, /--locked-by <id>/);
  assert.match(output, /--require bot\|native\|guest-policy\|data-plane\|worker\|failure\|all/);
  assert.match(output, /--resource CHANGE_ME_FEISHU_DOC_URL_OR_TOKEN/);
  assert.match(output, /--resource CHANGE_ME_FEISHU_SHEET_URL_OR_TOKEN/);
  assert.match(output, /--channel CHANGE_ME_AGENTSPACE_CHANNEL --chat-id CHANGE_ME_FEISHU_CHAT_ID --json/);
  assert.doesNotMatch(output, /--resource <doc-url-or-token>/);
  assert.doesNotMatch(output, /--resource <sheet-url-or-token>/);
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
  assert.match(output, /Validate WebSocket worker config/);
  assert.match(output, /live Feishu manual smoke checklist/);
  assert.match(output, /safe scripts\/feishu\/\.env template/);
  assert.match(output, /manual smoke/);
  assert.match(output, /health-check: require all healthy/);
  assert.match(output, /--app-url <url>/);
  assert.match(output, /--openapi-evidence <path>/);
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
  assert.match(report.nextCommands.smokePlan, /smoke-plan --workspace-id workspace-1 --integration integration-created --app-url https:\/\/agentspace\.example\.com --json/);
  assert.match(report.nextCommands.smokeEnv, /smoke-env --workspace-id workspace-1 --integration integration-created --app-url https:\/\/agentspace\.example\.com > scripts\/feishu\/\.env/);
  assert.match(report.nextCommands.checkEnv, /npm run smoke:feishu -- --env-file scripts\/feishu\/\.env --check-env --json/);
  assert.match(report.nextCommands.strictLiveSmoke, /npm run smoke:feishu -- --env-file scripts\/feishu\/\.env --live --strict-live --evidence runtime-output\/feishu-smoke\/live\.json --json/);
  assert.match(report.nextCommands.verifyOpenApiEvidence, /npm run smoke:feishu -- --verify-evidence runtime-output\/feishu-smoke\/live\.json --json/);
  assert.match(report.nextCommands.finalEvidence, /evidence --workspace-id workspace-1 --integration integration-created --openapi-evidence runtime-output\/feishu-smoke\/live\.json --strict --require all --json/);
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
  assert.doesNotMatch(JSON.stringify(report), /encrypted-app-secret|app-secret|super-secret/);

  assert.throws(() => buildFeishuAgentBotPolicyCliInputFromFlags({
    workspaceId: "workspace-1",
    flags: {
      "bot-added-policy": "maybe",
    },
  }), /feishu\.agent_bot_binding\.invalid_channel_auto_provisioning_policy/);
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
    requiredEvidence: "all",
    integrations: [
      buildIntegrationRecord({
        id: "integration-evidence",
        displayName: "Evidence Feishu",
        transportMode: "websocket_worker",
        lastHealthStatus: "degraded",
      }),
    ],
    eventsByIntegrationId: {
      "integration-evidence": [
        buildIntegrationEvent("integration-evidence", "evt_processed_secret", "im.message.receive_v1", "processed"),
        buildIntegrationEvent("integration-evidence", "evt_card_secret", "card.action.trigger", "processed"),
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
          linkedFromBindingId: "channel-atlas-binding",
        }),
      ],
    },
    threadBindingsByIntegrationId: {
      "integration-evidence": [
        buildThreadBinding("integration-evidence", {
          agentId: "HermesAgent",
          botBindingId: "integration-evidence-hermes",
          threadCollaboration: true,
          collaboratingAgentIds: ["Atlas"],
        }),
      ],
    },
    outboxByIntegrationId: {
      "integration-evidence": [
        buildOutboxItem("integration-evidence", "sent"),
        buildOutboxItem("integration-evidence", "failed"),
      ],
    },
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
        buildExternalGuestWriteDeniedRun("integration-evidence"),
      ],
    },
  });

  assert.equal(report.strictSatisfied, true);
  assert.equal(report.summary.botSatisfiedCount, 1);
  assert.equal(report.summary.nativeExperienceSatisfiedCount, 1);
  assert.equal(report.summary.guestPolicySatisfiedCount, 1);
  assert.equal(report.summary.dataPlaneSatisfiedCount, 1);
  assert.equal(report.summary.workerSatisfiedCount, 1);
  assert.equal(report.summary.failureVisibleCount, 1);
  const [item] = report.integrations;
  assert.equal(item?.bot.satisfied, true);
  assert.equal(item?.bot.inboundMessageMappings, 9);
  assert.equal(item?.bot.outboundMessageMappings, 2);
  assert.equal(item?.bot.correlatedReplyMappings, 2);
  assert.equal(item?.nativeExperience.satisfied, true);
  assert.equal(item?.nativeExperience.agentBotRouteEvidence, 4);
  assert.equal(item?.nativeExperience.nativeBotReplyEvidence, 2);
  assert.equal(item?.nativeExperience.boundUserMentionEvidence, 2);
  assert.equal(item?.nativeExperience.externalGuestMentionEvidence, 2);
  assert.equal(item?.nativeExperience.agentChannelPolicyDeniedEvidence, 1);
  assert.equal(item?.nativeExperience.botSenderLoopGuardEvidence, 1);
  assert.equal(item?.nativeExperience.autoProvisionedChannelBindings, 2);
  assert.equal(item?.nativeExperience.botAddedAutoProvisionedChannelBindings, 1);
  assert.equal(item?.nativeExperience.firstMessageAutoProvisionedChannelBindings, 1);
  assert.equal(item?.nativeExperience.reusedProviderChannelBindings, 1);
  assert.equal(item?.nativeExperience.threadTaskBindings, 1);
  assert.equal(item?.nativeExperience.threadContinuationEvidence, 1);
  assert.equal(item?.nativeExperience.threadCollaborationEvidence, 1);
  assert.equal(item?.guestPolicy.satisfied, true);
  assert.equal(item?.guestPolicy.externalGuestAllowedEvidence, 2);
  assert.equal(item?.guestPolicy.externalGuestReplyAllEvidence, 1);
  assert.equal(item?.guestPolicy.externalGuestRequireIdentityEvidence, 1);
  assert.equal(item?.guestPolicy.externalGuestIgnoreEvidence, 1);
  assert.equal(item?.guestPolicy.externalGuestMentionRequiredEvidence, 1);
  assert.equal(item?.dataPlane.satisfied, true);
  assert.equal(item?.dataPlane.docReadSucceeded, 1);
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
  assert.equal(item?.dataPlane.externalGuestActorEvidence, 1);
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

test("Feishu evidence report requires degraded health for failure visibility smoke", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    integrations: [
      buildIntegrationRecord({
        id: "integration-evidence",
        displayName: "Evidence Feishu",
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
            payloadHash: "hash-sheet",
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
            payloadHash: "hash-base",
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
  assert.equal(item?.dataPlane.externalGuestActorEvidence, 1);
  assert.equal(item?.dataPlane.externalGuestWriteDeniedEvidence, 0);
  assert.ok(item?.issues.includes("external_guest_write_deny_evidence_missing"));
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
  assert.equal(item?.guestPolicy.externalGuestAllowedEvidence, 2);
  assert.equal(item?.guestPolicy.externalGuestReplyAllEvidence, 1);
  assert.equal(item?.guestPolicy.externalGuestRequireIdentityEvidence, 1);
  assert.equal(item?.guestPolicy.externalGuestIgnoreEvidence, 0);
  assert.equal(item?.guestPolicy.externalGuestMentionRequiredEvidence, 0);
  assert.ok(item?.issues.includes("external_guest_policy_ignore_evidence_missing"));
  assert.ok(item?.issues.includes("external_guest_policy_mention_required_evidence_missing"));
  assert.equal(JSON.stringify(report).includes("om_secret_guest_require_identity"), false);
  assert.equal(JSON.stringify(report).includes("ou_secret"), false);
});

test("Feishu evidence report can gate on redacted OpenAPI live smoke evidence", () => {
  const report = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    openApiEvidencePath: "runtime-output/feishu-smoke/live.json",
    openApiEvidence: buildOpenApiEvidenceFixture(),
  });

  assert.equal(report.strictSatisfied, true);
  assert.equal(report.openApiEvidence?.present, true);
  assert.equal(report.openApiEvidence?.valid, true);
  assert.deepEqual(report.openApiEvidence?.issues, []);
  assert.deepEqual(report.openApiEvidence?.remediationSteps, []);
  assert.equal(report.openApiEvidence?.summary?.liveChecks, 12);
  assert.equal(report.openApiEvidence?.summary?.requiredLiveSteps, 12);
  assert.equal(report.openApiEvidence?.summary?.destructiveLiveChecks, 3);

  const oldEvidence = buildOpenApiEvidenceFixture();
  oldEvidence.steps = oldEvidence.steps.filter((step) => step.name !== "Docs docx append blocks");
  oldEvidence.summary.liveChecks = 11;
  oldEvidence.summary.livePassed = 11;
  oldEvidence.summary.destructiveLiveChecks = 2;
  const oldArtifact = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    openApiEvidence: oldEvidence,
  });

  assert.equal(oldArtifact.strictSatisfied, false);
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
    ...buildCompleteFeishuEvidenceInput(),
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
    ...buildCompleteFeishuEvidenceInput(),
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
    ...buildCompleteFeishuEvidenceInput(),
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
    ...buildCompleteFeishuEvidenceInput(),
    openApiEvidence: callbackUrlLeakEvidence,
  });

  assert.equal(callbackUrlLeak.strictSatisfied, false);
  assert.equal(callbackUrlLeak.openApiEvidence?.valid, false);
  assert.ok(callbackUrlLeak.openApiEvidence?.issues.includes(
    "openapi_callback_url_in_detail:AgentSpace callback URL verification",
  ));
  assert.ok(callbackUrlLeak.openApiEvidence?.issues.includes("openapi_callback_url_in_evidence"));

  const scopedCallbackProof = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
    integrationId: "integration-evidence",
    openApiEvidence: buildOpenApiEvidenceFixture(),
  });

  assert.equal(scopedCallbackProof.strictSatisfied, true);
  assert.equal(scopedCallbackProof.openApiEvidence?.valid, true);
  assert.deepEqual(scopedCallbackProof.openApiEvidence?.issues, []);

  const mismatchedCallbackProofEvidence = buildOpenApiEvidenceFixture();
  const mismatchedCallbackStep = mismatchedCallbackProofEvidence.steps.find((step) =>
    step.name === "AgentSpace callback URL verification"
  );
  if (mismatchedCallbackStep) {
    (mismatchedCallbackStep as { callbackRouteFingerprint?: string }).callbackRouteFingerprint = "sha256:ffffffffffffffff";
  }
  const mismatchedCallbackProof = buildFeishuEvidenceReport({
    ...buildCompleteFeishuEvidenceInput(),
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
    ...buildCompleteFeishuEvidenceInput(),
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
    ...buildCompleteFeishuEvidenceInput(),
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

test("Feishu evidence report reads OpenAPI smoke evidence from disk", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentspace-feishu-openapi-evidence-"));
  try {
    const evidencePath = join(directory, "live.json");
    writeFileSync(evidencePath, `${JSON.stringify(buildOpenApiEvidenceFixture(), null, 2)}\n`, "utf8");

    const report = buildFeishuEvidenceReport({
      ...buildCompleteFeishuEvidenceInput(),
      openApiEvidencePath: evidencePath,
    });

    assert.equal(report.strictSatisfied, true);
    assert.equal(report.openApiEvidence?.present, true);
    assert.equal(report.openApiEvidence?.valid, true);
    assert.equal(report.openApiEvidence?.evidencePath, evidencePath);
    assert.equal(report.openApiEvidence?.summary?.livePassed, 12);

    const missing = buildFeishuEvidenceReport({
      ...buildCompleteFeishuEvidenceInput(),
      openApiEvidencePath: join(directory, "missing.json"),
    });
    assert.equal(missing.strictSatisfied, false);
    assert.equal(missing.openApiEvidence?.present, false);
    assert.equal(missing.openApiEvidence?.valid, false);
    assert.deepEqual(missing.openApiEvidence?.issues, ["openapi_evidence_unreadable"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Feishu evidence report blocks strict gates when local proof is incomplete", () => {
  const report = buildFeishuEvidenceReport({
    workspaceId: "workspace-1",
    requiredEvidence: "data-plane",
    integrations: [
      buildIntegrationRecord({
        id: "integration-evidence-missing",
        displayName: "Missing Evidence Feishu",
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
    "live_external_guest_write_denied",
    "live_failure_visibility",
  ]);
  const botRemediation = item?.remediationSteps.find((step) => step.stepId === "live_bot_message_reply");
  assert.ok(botRemediation?.issues.includes("processed_inbound_event_missing"));
  assert.ok(botRemediation?.issues.includes("correlated_reply_mapping_missing"));
  const nativeRouteRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_agent_bot_direct_mention"
  );
  assert.ok(nativeRouteRemediation?.issues.includes("agent_bot_route_evidence_missing"));
  const guestMentionRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_external_guest_agent_bot_mention"
  );
  assert.ok(guestMentionRemediation?.issues.includes("external_guest_bot_mention_evidence_missing"));
  assert.ok(guestMentionRemediation?.issues.includes("external_guest_policy_allow_evidence_missing"));
  const agentChannelPolicyRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_agent_channel_policy_disabled"
  );
  assert.ok(agentChannelPolicyRemediation?.issues.includes("agent_channel_policy_disabled_evidence_missing"));
  const replyAllRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_external_guest_reply_all"
  );
  assert.ok(replyAllRemediation?.issues.includes("external_guest_policy_reply_all_evidence_missing"));
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
  const ignoreRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_external_guest_reply_disabled"
  );
  assert.ok(ignoreRemediation?.issues.includes("external_guest_policy_ignore_evidence_missing"));
  const mentionRequiredRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_unmentioned_guest_message_ignored"
  );
  assert.ok(mentionRequiredRemediation?.issues.includes("external_guest_policy_mention_required_evidence_missing"));
  const agentDocRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_agent_bound_doc_summary"
  );
  assert.ok(agentDocRemediation?.issues.includes("agent_doc_read_evidence_missing"));
  const docWriteRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_doc_write_with_approval"
  );
  assert.match(docWriteRemediation?.command ?? "", /--operation plan-doc-append/);
  assert.match(docWriteRemediation?.command ?? "", /review-data-operation/);
  const sheetWriteRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_sheet_write_with_approval"
  );
  assert.match(sheetWriteRemediation?.command ?? "", /--operation plan-sheet-write/);
  const baseRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_base_preview_and_update"
  );
  assert.match(baseRemediation?.command ?? "", /--operation plan-base-update/);
  const userActorRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_bound_user_data_operation"
  );
  assert.ok(userActorRemediation?.issues.includes("user_actor_data_operation_evidence_missing"));
  const guestActorRemediation = item?.remediationSteps.find((step) =>
    step.stepId === "live_external_guest_write_denied"
  );
  assert.ok(guestActorRemediation?.issues.includes("external_guest_actor_data_operation_evidence_missing"));
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
        appId: "cli_smoke_env",
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
  assert.equal(readSmokeEnvEntry(report, "FEISHU_SECOND_AGENT_APP_SECRET")?.secret, true);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_SECOND_AGENT_APP_SECRET")?.required, false);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_SMOKE_DOC_PARENT_BLOCK_ID")?.required, true);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_SMOKE_DOC_APPEND_BLOCKS_JSON")?.required, true);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_SMOKE_SHEET_RANGE")?.required, false);
  assert.match(readSmokeEnvEntry(report, "FEISHU_SMOKE_SHEET_RANGE")?.note ?? "", /Optional sheet read range/);
  assert.equal(readSmokeEnvEntry(report, "FEISHU_SMOKE_SHEET_WRITE_RANGE")?.required, true);
  assert.equal(getFeishuSmokeEnvExitCode(report), 0);

  const output = formatFeishuSmokeEnvCommandText(report);
  assert.equal(output.stderr, undefined);
  assert.match(output.stdout ?? "", /FEISHU_SMOKE_CALLBACK_URL=https:\/\/agentspace\.test/);
  assert.match(output.stdout ?? "", /FEISHU_SECOND_AGENT_APP_ID=CHANGE_ME_SECOND_AGENT_APP_ID/);
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

test("Feishu smoke-env template treats generated public URL placeholders as missing", () => {
  const report = buildFeishuSmokeEnvTemplateReport({
    workspaceId: "workspace-1",
    appUrl: "CHANGE_ME_PUBLIC_AGENTSPACE_URL",
    integrations: [
      buildIntegrationRecord({
        id: "integration-smoke-env-placeholder-url",
        displayName: "Smoke Env Placeholder Url",
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
        lastHealthStatus: "healthy",
        transportMode: "websocket_worker",
      }),
      buildIntegrationRecord({
        id: "integration-unchecked",
        displayName: "Unchecked Feishu",
      }),
      buildIntegrationRecord({
        id: "agent-bot-codex",
        displayName: "Codex Bot",
        agentId: "Codex",
        transportMode: "websocket_worker",
      }),
      buildIntegrationRecord({
        id: "agent-bot-hermes",
        displayName: "HermesAgent Bot",
        agentId: "HermesAgent",
        transportMode: "websocket_worker",
      }),
    ],
    channelBindingsByIntegrationId: {
      "integration-ready": [buildChannelBinding("integration-ready")],
      "integration-unchecked": [buildChannelBinding("integration-unchecked")],
      "agent-bot-codex": [],
      "agent-bot-hermes": [],
    },
    userBindingsByIntegrationId: {
      "integration-ready": [buildUserBinding("integration-ready")],
      "integration-unchecked": [buildUserBinding("integration-unchecked")],
      "agent-bot-codex": [],
      "agent-bot-hermes": [],
    },
    resourceBindingsByIntegrationId: {
      "integration-ready": [
        buildResourceBinding("integration-ready", "doc", "doccn_secret"),
        buildResourceBinding("integration-ready", "sheet", "shtcn_secret"),
        buildResourceBinding("integration-ready", "base_table", "tbl_secret"),
      ],
      "integration-unchecked": [],
      "agent-bot-codex": [],
      "agent-bot-hermes": [],
    },
    failedOutboxByIntegrationId: {
      "integration-ready": [],
      "integration-unchecked": [],
      "agent-bot-codex": [],
      "agent-bot-hermes": [],
    },
    pendingOutboxByIntegrationId: {
      "integration-ready": [],
      "integration-unchecked": [],
      "agent-bot-codex": [],
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
    "verification_token",
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
  assert.equal(report.smokeHarness.envExamplePath, "scripts/feishu/env.example");
  assert.equal(report.smokeHarness.envFilePath, "scripts/feishu/.env");
  assert.equal(report.smokeHarness.evidencePath, "runtime-output/feishu-smoke/live.json");
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
  assert.match(report.smokeHarness.checkEnvCommand, /--env-file scripts\/feishu\/\.env/);
  assert.match(report.smokeHarness.strictLiveCommand, /npm run smoke:feishu/);
  assert.match(report.smokeHarness.strictLiveCommand, /--strict-live/);
  assert.match(report.smokeHarness.strictLiveCommand, /--evidence runtime-output\/feishu-smoke\/live\.json/);
  assert.match(report.smokeHarness.verifyEvidenceCommand, /--verify-evidence runtime-output\/feishu-smoke\/live\.json/);
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
      required: "processed_inbound + correlated_reply_mapping",
    },
    {
      key: "native_agent_bot",
      required: "agent_bot_route + bound_user_bot_mention + external_guest_bot_mention + bot_added_auto_provision + first_message_auto_provision + multi_agent_channel_reuse + thread_task_binding + thread_continuation + thread_collaboration + bot_sender_loop_guard + agent_channel_policy_denial",
    },
    {
      key: "guest_policy",
      required: "external_guest_allow + external_guest_reply_all + external_guest_require_identity + external_guest_ignore + external_guest_mention_required",
    },
    {
      key: "worker_restart",
      required: "two_correlated_websocket_replies",
    },
    {
      key: "worker_card_action",
      required: "processed_approval_card_action",
    },
      {
        key: "data_plane",
        required: "doc_read + agent_runtime_doc_read_from_lark_cli_manifest + approved_doc_write + sheet_read + approved_sheet_write_with_agentspace_sync + base_read + approved_base_mutation_with_agentspace_sync + user_actor + external_guest_actor + external_guest_write_denied",
      },
    {
      key: "failure_visibility",
      required: "provider_failure_row + degraded_or_error_health + agent_bot_failure_evidence",
    },
    {
      key: "openapi_artifact",
      required: "strict_live_artifact:runtime-output/feishu-smoke/live.json",
    },
  ]);

  const credentialEncryption = report.steps.find((step) => step.id === "configure_credential_encryption_key");
  const bindAgentBot = report.steps.find((step) => step.id === "bind_feishu_agent_bot");
  const env = report.steps.find((step) => step.id === "prepare_live_smoke_env");
  const checkEnv = report.steps.find((step) => step.id === "check_live_smoke_env");
  const bindChat = report.steps.find((step) => step.id === "bind_feishu_chat");
  const bindUser = report.steps.find((step) => step.id === "bind_feishu_user");
  const liveBot = report.steps.find((step) => step.id === "live_bot_message_reply");
  const liveAutoProvision = report.steps.find((step) => step.id === "live_agent_bot_channel_auto_provision");
  const liveFirstMessageAutoProvision = report.steps.find((step) =>
    step.id === "live_agent_bot_first_message_auto_provision"
  );
  const bindSecondAgentBot = report.steps.find((step) => step.id === "bind_second_feishu_agent_bot");
  const liveMultiAgentReuse = report.steps.find((step) => step.id === "live_multi_agent_bot_channel_reuse");
  const liveThreadCollaboration = report.steps.find((step) => step.id === "live_multi_agent_thread_collaboration");
  const liveGuestMention = report.steps.find((step) => step.id === "live_external_guest_agent_bot_mention");
  const liveGuestReplyAll = report.steps.find((step) => step.id === "live_external_guest_reply_all");
  const liveBoundUserDataOperation = report.steps.find((step) => step.id === "live_bound_user_data_operation");
  const liveGuestWriteDenied = report.steps.find((step) => step.id === "live_external_guest_write_denied");
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
  assert.equal(bindAgentBot?.status, "done");
  assert.match(bindAgentBot?.detail ?? "", /Feishu integration\/bot binding/);
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
  assert.doesNotMatch(liveBot?.detail ?? "", /@AgentSpaceBot/);
  assert.equal(liveAutoProvision?.status, "pending");
  assert.match(liveAutoProvision?.detail ?? "", /provisionSource=bot_added/);
  assert.equal(liveFirstMessageAutoProvision?.status, "pending");
  assert.match(liveFirstMessageAutoProvision?.detail ?? "", /provisionSource=first_message/);
  assert.match(liveFirstMessageAutoProvision?.detail ?? "", /does not require a \/agent command/);
  assert.equal(bindSecondAgentBot?.status, "done");
  assert.match(bindSecondAgentBot?.detail ?? "", /2 agent-scoped Feishu bot binding/);
  assert.equal(liveMultiAgentReuse?.status, "pending");
  assert.match(liveMultiAgentReuse?.detail ?? "", /linkedFromBindingId/);
  assert.equal(liveThreadCollaboration?.status, "pending");
  assert.match(liveThreadCollaboration?.detail ?? "", /same Feishu thread/);
  assert.match(liveThreadCollaboration?.detail ?? "", /threadCollaboration=true/);
  assert.match(liveThreadCollaboration?.detail ?? "", /collaboration card/);
  assert.equal(liveGuestMention?.status, "pending");
  assert.match(liveGuestMention?.detail ?? "", /external_guest/);
  assert.equal(liveGuestReplyAll?.status, "pending");
  assert.match(liveGuestReplyAll?.detail ?? "", /reply_all/);
  assert.equal(liveBoundUserDataOperation?.status, "pending");
  assert.match(liveBoundUserDataOperation?.detail ?? "", /actorType=user/);
  assert.match(liveBoundUserDataOperation?.detail ?? "", /without raw Feishu ids/);
  assert.match(liveBoundUserDataOperation?.command ?? "", /--operation read-doc/);
  assert.equal(liveGuestWriteDenied?.status, "pending");
  assert.match(liveGuestWriteDenied?.detail ?? "", /require_identity/);
  assert.match(liveGuestWriteDenied?.detail ?? "", /does not create a real workspace member/);
  assert.equal(livePolicyDisabled?.status, "pending");
  assert.match(livePolicyDisabled?.detail ?? "", /without writing a channel message/);
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
  assert.match(liveSheet?.command ?? "", /--operation plan-sheet-write/);
  assert.match(liveSheet?.command ?? "", /--range CHANGE_ME_FEISHU_SHEET_WRITE_RANGE/);
  assert.match(liveSheet?.command ?? "", /--approval-agent CHANGE_ME_AGENT_NAME --approval-channel CHANGE_ME_AGENTSPACE_CHANNEL/);
  assert.match(liveSheet?.command ?? "", /review-data-operation --workspace-id workspace-1 --approval-id CHANGE_ME_FEISHU_APPROVAL_ID --decision approved --json/);
  assert.equal(liveBase?.status, "pending");
  assert.match(liveBase?.command ?? "", /--operation query-base --resource CHANGE_ME_FEISHU_BASE_TABLE_URL_WITH_APP_TOKEN/);
  assert.match(liveBase?.command ?? "", /--operation plan-base-update --resource CHANGE_ME_FEISHU_BASE_TABLE_URL_WITH_APP_TOKEN/);
  assert.match(liveBase?.command ?? "", /--record-id CHANGE_ME_FEISHU_BASE_RECORD_ID/);
  assert.match(liveBase?.command ?? "", /--approval-agent CHANGE_ME_AGENT_NAME --approval-channel CHANGE_ME_AGENTSPACE_CHANNEL/);
  assert.match(liveBase?.command ?? "", /review-data-operation --workspace-id workspace-1 --approval-id CHANGE_ME_FEISHU_APPROVAL_ID --decision approved --json/);
  assert.equal(liveHarness?.status, "pending");
  assert.match(liveHarness?.command ?? "", /npm run smoke:feishu/);
  assert.match(liveHarness?.detail ?? "", /after check-env passes/);
  assert.match(liveHarness?.detail ?? "", /12 live checks/);
  assert.match(liveHarness?.detail ?? "", /Docs docx append blocks/);
  assert.match(liveHarness?.detail ?? "", /Sheets write values/);
  assert.match(liveHarness?.detail ?? "", /Base update record/);
  assert.equal(verifyHarness?.status, "pending");
  assert.match(verifyHarness?.command ?? "", /--verify-evidence/);
  assert.match(verifyHarness?.detail ?? "", /12 required/);
  assert.match(verifyHarness?.detail ?? "", /3 destructive write checks/);
  assert.equal(failure?.status, "pending");
  assert.match(failure?.command ?? "", /integrations feishu health-check --workspace-id workspace-1 --integration integration-ready --json/);
  assert.equal(agentSpaceEvidence?.status, "pending");
  assert.match(agentSpaceEvidence?.command ?? "", /--integration integration-ready/);
  assert.match(agentSpaceEvidence?.command ?? "", /--openapi-evidence runtime-output\/feishu-smoke\/live\.json/);
  assert.match(agentSpaceEvidence?.command ?? "", /--strict --require all --json/);
  assert.match(agentSpaceEvidence?.detail ?? "", /Native evidence requires/);
  assert.match(agentSpaceEvidence?.detail ?? "", /thread continuation/);
  assert.match(agentSpaceEvidence?.detail ?? "", /thread collaboration/);
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

test("Feishu smoke plan blocks live smoke steps when local prerequisites are missing", () => {
  const report = buildFeishuSmokePlanReport({
    workspaceId: "workspace-1",
    requiredReadiness: "bot",
    integrations: [
      buildIntegrationRecord({
        id: "integration-unchecked",
        displayName: "Unchecked Feishu",
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
  const bindSecondAgentBot = report.steps.find((step) => step.id === "bind_second_feishu_agent_bot");
  const liveMultiAgentReuse = report.steps.find((step) => step.id === "live_multi_agent_bot_channel_reuse");
  const liveThreadCollaboration = report.steps.find((step) => step.id === "live_multi_agent_thread_collaboration");
  const liveBoundUserDataOperation = report.steps.find((step) => step.id === "live_bound_user_data_operation");
  const liveGuestWriteDenied = report.steps.find((step) => step.id === "live_external_guest_write_denied");
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
    "openapi_artifact",
  ]);
  assert.equal(health?.status, "pending");
  assert.deepEqual(health?.issues, ["health_not_checked"]);
  assert.equal(botGate?.status, "blocked");
  assert.ok(botGate?.issues?.includes("health_not_checked"));
  assert.equal(liveBot?.status, "blocked");
  assert.equal(bindSecondAgentBot?.status, "blocked");
  assert.match(bindSecondAgentBot?.command ?? "", /bind-agent-bot --workspace-id workspace-1/);
  assert.match(bindSecondAgentBot?.command ?? "", /--agent CHANGE_ME_SECOND_AGENT_NAME/);
  assert.match(bindSecondAgentBot?.command ?? "", /--app-id-env FEISHU_SECOND_AGENT_APP_ID/);
  assert.match(bindSecondAgentBot?.command ?? "", /--app-secret-env FEISHU_SECOND_AGENT_APP_SECRET/);
  assert.ok(bindSecondAgentBot?.issues?.includes("credential_encryption_key_missing"));
  assert.equal(liveMultiAgentReuse?.status, "blocked");
  assert.deepEqual(liveMultiAgentReuse?.issues, ["second_agent_bot_missing"]);
  assert.equal(liveThreadCollaboration?.status, "blocked");
  assert.ok(liveThreadCollaboration?.issues?.includes("second_agent_bot_missing"));
  assert.equal(report.steps.find((step) => step.id === "live_external_guest_agent_bot_mention")?.status, "blocked");
  assert.equal(report.steps.find((step) => step.id === "live_external_guest_reply_all")?.status, "blocked");
  assert.equal(liveBoundUserDataOperation?.status, "blocked");
  assert.ok(liveBoundUserDataOperation?.issues?.includes("doc_resource_binding_missing"));
  assert.equal(liveGuestWriteDenied?.status, "blocked");
  assert.ok(liveGuestWriteDenied?.issues?.includes("doc_resource_binding_missing"));
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
    integrations: [
      buildIntegrationRecord({
        id: "integration-evidence",
        displayName: "Evidence Feishu",
        transportMode: "websocket_worker",
        lastHealthStatus: "degraded",
      }),
    ],
    eventsByIntegrationId: {
      "integration-evidence": [
        buildIntegrationEvent("integration-evidence", "evt_processed_secret", "im.message.receive_v1", "processed"),
        buildIntegrationEvent("integration-evidence", "evt_card_secret", "card.action.trigger", "processed"),
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
          linkedFromBindingId: "channel-atlas-binding",
        }),
      ],
    },
    threadBindingsByIntegrationId: {
      "integration-evidence": [
        buildThreadBinding("integration-evidence", {
          agentId: "HermesAgent",
          botBindingId: "integration-evidence-hermes",
          threadCollaboration: true,
          collaboratingAgentIds: ["Atlas"],
        }),
      ],
    },
    outboxByIntegrationId: {
      "integration-evidence": [
        buildOutboxItem("integration-evidence", "sent"),
        buildOutboxItem("integration-evidence", "failed"),
      ],
    },
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
        buildExternalGuestWriteDeniedRun("integration-evidence"),
      ],
    },
  };
}

function buildMessageMapping(
  integrationId: string,
  direction: "inbound" | "outbound",
  externalMessageId: string,
  externalThreadId?: string,
  options: {
    actorType?: "user" | "external_guest";
    externalGuestPolicyDecision?: "allow" | "ignore" | "require_identity";
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
      ? "2026-06-24T00:00:02.000Z"
      : "2026-06-24T00:00:01.000Z",
    ...(direction === "inbound"
      ? {
        metadataJson: JSON.stringify({
          provider: "feishu",
          externalChatReference: "chat-ref-hash",
          mappedChannelName: "general",
          dispatchStatus: "sent",
          actorType,
          ...(actorType === "user"
            ? { userId: "user-1" }
            : {
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
          threadBindingId: `thread-${integrationId}`,
        }),
      }
      : {
        metadataJson: JSON.stringify({
          provider: "feishu",
          externalChatReference: "chat-ref-hash",
          externalThreadReference: "thread-ref-hash",
          agentId: "Atlas",
          botBindingId: integrationId,
          agentActionPolicyInput: {
            action: {
              type: "external_message.send",
              resourceReference: "chat-ref-hash",
              resourceIdRedacted: true,
            },
          },
        }),
      }),
  } as never;
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
      externalChatReference: "chat-ref-hash",
      mappedChannelName: "general",
      dispatchStatus: "sent",
      actorType: "external_guest",
      externalGuestReference: "guest-ref-hash",
      externalGuestPermissionProfile: "channel_context_only",
      externalGuestPolicyDecision: "allow",
      externalGuestPolicyReasonCode: "feishu_external_guest_allowed",
      externalGuestUnboundUserMode: "reply_all",
      agentId: "Atlas",
      botBindingId: integrationId,
      threadBindingId: `thread-${integrationId}`,
    }),
    createdAt: "2026-06-24T00:00:01.000Z",
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
      externalChatReference: "chat-ref-hash",
      mappedChannelName: "general",
      dispatchStatus: "sent",
      actorType: "user",
      userId: "user-1",
      agentId: "Atlas",
      botBindingId: integrationId,
      threadBindingId: `thread-${integrationId}`,
      threadContinuation: true,
    }),
    createdAt: "2026-06-24T00:00:03.000Z",
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
      externalChatReference: "chat-ref-hash",
      mappedChannelName: "general",
      dispatchStatus: "ignored",
      reasonCode: "feishu_agent_channel_member_access_disabled",
      actorType: "external_guest",
      externalGuestReference: "guest-ref-hash",
      externalGuestPermissionProfile: "channel_context_only",
      externalGuestPolicyDecision: "allow",
      externalGuestPolicyReasonCode: "feishu_external_guest_allowed",
      externalGuestUnboundUserMode: "reply_on_mention",
      agentId: "Atlas",
      botBindingId: integrationId,
    }),
    createdAt: "2026-06-24T00:00:01.000Z",
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
      externalChatReference: "chat-ref-hash",
      mappedChannelName: "general",
      dispatchStatus: "ignored",
      reasonCode: "feishu_bot_sender_ignored",
      agentId: "Atlas",
      botBindingId: integrationId,
    }),
    createdAt: "2026-06-24T00:00:01.000Z",
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
      mappedChannelName: "general",
      dispatchStatus: "ignored",
      reasonCode: input.reasonCode,
      actorType: "external_guest",
      externalGuestReference: "guest-ref-hash",
      externalGuestPermissionProfile: input.unboundUserMode === "require_identity" ? "none" : "channel_context_only",
      externalGuestPolicyDecision: input.decision,
      externalGuestPolicyReasonCode: input.reasonCode,
      externalGuestUnboundUserMode: input.unboundUserMode,
      agentId: "Atlas",
      botBindingId: integrationId,
    }),
    createdAt: "2026-06-24T00:00:01.000Z",
  } as never;
}

function buildAutoProvisionedChannelBinding(
  integrationId: string,
  provisionSource: "bot_added" | "first_message",
  options: {
    linkedFromBindingId?: string;
  } = {},
) {
  return {
    ...(buildChannelBinding(integrationId) as Record<string, unknown>),
    metadataJson: JSON.stringify({
      provider: "feishu",
      provisionSource,
      reviewStatus: "approved",
      agentId: "Atlas",
      botBindingId: integrationId,
      externalChatReference: "chat-ref-hash",
      linkedFromBindingId: options.linkedFromBindingId,
    }),
  } as never;
}

function buildThreadBinding(
  integrationId: string,
  options: {
    agentId?: string;
    botBindingId?: string;
    threadCollaboration?: boolean;
    collaboratingAgentIds?: string[];
  } = {},
) {
  const agentId = options.agentId ?? "Atlas";
  const botBindingId = options.botBindingId ?? integrationId;
  return {
    id: `thread-${integrationId}`,
    workspaceId: "workspace-1",
    integrationId,
    channelBindingId: `channel-${integrationId}`,
    provider: "feishu",
    tenantKey: "tenant-1",
    externalChatId: "oc_secret",
    externalThreadId: "om_secret_inbound",
    channelName: "general",
    agentId,
    taskQueueId: "task-1",
    agentSpaceMessageId: "message-source-1",
    status: "active",
    metadataJson: JSON.stringify({
      provider: "feishu",
      externalChatReference: "chat-ref-hash",
      externalThreadReference: "thread-ref-hash",
      agentId,
      botBindingId,
      actorType: "user",
      routerSessionId: "router-1",
      ...(options.threadCollaboration
        ? {
            threadCollaboration: true,
            collaboratingAgentIds: options.collaboratingAgentIds ?? ["Atlas"],
          }
        : {}),
    }),
    lastMessageAt: "2026-06-24T00:00:01.000Z",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
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
    generatedAt: "2026-06-24T00:00:00.000Z",
    live: true,
    strictLive: true,
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
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
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
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    ...overrides,
  } as never;
}

function buildUserBinding(integrationId: string) {
  return {
    id: `user-${integrationId}`,
    workspaceId: "workspace-1",
    integrationId,
    userId: "user-1",
    externalUserId: "ou_secret",
    status: "active",
    metadataJson: "{}",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
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
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
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
    targetExternalChatId: "oc_secret",
    payloadJson: JSON.stringify({ text: "payload-secret" }),
    metadataJson: options.metadataJson ?? JSON.stringify({
      provider: "feishu",
      agentId: "Codex",
      botBindingId: integrationId,
    }),
    status,
    attempts: 1,
    lastError: status === "sent" ? undefined : "provider error",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
    sentAt: status === "sent" ? "2026-06-24T00:00:01.000Z" : undefined,
  } as never;
}

function buildIntegrationEvent(
  integrationId: string,
  externalEventId: string,
  eventType: string,
  status: "received" | "processed" | "ignored" | "failed",
) {
  return {
    id: `${status}-${integrationId}-${eventType}`,
    workspaceId: "workspace-1",
    integrationId,
    provider: "feishu",
    externalEventId,
    eventType,
    status,
    payloadJson: JSON.stringify({ messageId: "om_secret", chatId: "oc_secret" }),
    errorMessage: status === "failed" ? "provider error" : undefined,
    receivedAt: "2026-06-24T00:00:00.000Z",
    processedAt: status === "processed" || status === "failed" || status === "ignored"
      ? "2026-06-24T00:00:01.000Z"
      : undefined,
  } as never;
}

function buildAgentRuntimeDocReadRun(integrationId: string) {
  const governanceContext = buildFeishuTestGovernanceContext({
    actorType: "agent",
    actorId: "agent-1",
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

interface DataOperationRunOptions {
  governanceActorType?: "agent" | "user" | "external_guest" | "system";
  governanceAgentId?: string | null;
  governanceBotBindingId?: string | null;
  governanceActorUserId?: string | null;
  governanceExternalActorReference?: string | null;
  governanceExternalGuestPermissionProfile?: string | null;
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
    botBindingId: options.governanceBotBindingId,
    actorUserId: options.governanceActorUserId,
    externalActorReference: options.governanceExternalActorReference,
    externalGuestPermissionProfile: options.governanceExternalGuestPermissionProfile,
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
        payloadHash: "approved-payload-hash",
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
    startedAt: "2026-06-24T00:00:00.000Z",
    finishedAt: status === "succeeded" || status === "failed" || status === "cancelled"
      ? "2026-06-24T00:00:01.000Z"
      : undefined,
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
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
}) {
  return {
    provider: "feishu",
    ...(input.agentId === null ? {} : { agentId: input.agentId ?? "agent-1" }),
    ...(input.botBindingId === null ? {} : { botBindingId: input.botBindingId ?? "bot-binding-1" }),
    channelName: "Launch Room",
    actorType: input.actorType,
    ...(input.actorType === "user" && input.actorUserId !== null
      ? { actorUserId: input.actorUserId ?? input.actorId ?? "user-1" }
      : {}),
    ...(input.actorType === "external_guest"
      ? {
        ...(input.externalActorReference === null
          ? {}
          : { externalActorReference: input.externalActorReference ?? "external-guest-ref-hash" }),
        ...(input.externalGuestPermissionProfile === null
          ? {}
          : { externalGuestPermissionProfile: input.externalGuestPermissionProfile ?? "channel_context_only" }),
        externalChatReference: "external-chat-ref-hash",
      }
      : {}),
  };
}
