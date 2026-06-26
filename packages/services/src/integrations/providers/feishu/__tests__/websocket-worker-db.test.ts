import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { before, beforeEach } from "node:test";
import {
  createExternalIntegrationSync,
  createWorkspaceSync,
  getDatabase,
  readExternalIntegrationSync,
} from "@agent-space/db";
import { buildEncryptedFeishuCredentials } from "../credentials.ts";
import { startFeishuWebSocketWorker, type FeishuWebSocketWorkerSessionFactoryInput } from "../websocket-worker.ts";
import { FEISHU_PROVIDER_ID } from "../constants.ts";

const originalCwd = process.cwd();
const repositoryRoot = existsSync(join(originalCwd, "Target.md")) ? originalCwd : join(originalCwd, "..", "..", "..", "..");
const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-feishu-worker-"));
const databaseTestOptions = process.env.AGENT_SPACE_FEISHU_WORKER_DB_TESTS === "1"
  ? {}
  : { skip: "Set AGENT_SPACE_FEISHU_WORKER_DB_TESTS=1 with a test Postgres URL to run Feishu worker DB integration tests." };

before(() => {
  writeFileSync(join(tempRoot, "Target.md"), "# test\n");
  mkdirSync(join(tempRoot, "data"), { recursive: true });
  const packagesLink = join(tempRoot, "packages");
  if (!existsSync(packagesLink)) {
    symlinkSync(join(repositoryRoot, "packages"), packagesLink, "dir");
  }
  process.chdir(tempRoot);
  process.env.AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY = Buffer
    .from("0123456789abcdef0123456789abcdef", "utf8")
    .toString("base64");
});

beforeEach(() => {
  getDatabase().exec(`
    DELETE FROM external_integration_event;
    DELETE FROM external_message_outbox;
    DELETE FROM external_message_mapping;
    DELETE FROM external_thread_binding;
    DELETE FROM external_channel_binding;
    DELETE FROM external_user_binding;
    DELETE FROM external_integration;
    DELETE FROM workspace;
  `);
});

test("Feishu websocket worker dry-run only marks websocket integrations as ready by default", databaseTestOptions, async () => {
  const workspace = createWorkspaceSync({
    slug: "feishu-worker-dry-run",
    name: "Feishu Worker Dry Run",
    createdBy: "system",
  });
  const websocketIntegration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: FEISHU_PROVIDER_ID,
    displayName: "Feishu WebSocket",
    transportMode: "websocket_worker",
    appId: "cli_ws",
  });
  const webhookIntegration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: FEISHU_PROVIDER_ID,
    displayName: "Feishu Webhook",
    transportMode: "http_webhook",
    appId: "cli_hook",
  });

  const worker = await startFeishuWebSocketWorker({
    workspaceId: workspace.id,
    lockedBy: "test",
    dryRun: true,
  });

  assert.equal(worker.summary.integrationCount, 2);
  assert.equal(worker.summary.startedCount, 0);
  assert.equal(worker.summary.skippedCount, 1);
  assert.deepEqual(worker.summary.integrations.map((item) => ({
    integrationId: item.integrationId,
    status: item.status,
    reasonCode: item.reasonCode,
  })), [
    {
      integrationId: websocketIntegration.id,
      status: "ready",
      reasonCode: undefined,
    },
    {
      integrationId: webhookIntegration.id,
      status: "skipped",
      reasonCode: "feishu.websocket_worker.transport_mode_not_websocket",
    },
  ]);
});

test("Feishu websocket worker writes healthy and degraded integration health", databaseTestOptions, async () => {
  const workspace = createWorkspaceSync({
    slug: "feishu-worker-health",
    name: "Feishu Worker Health",
    createdBy: "system",
  });
  const integration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: FEISHU_PROVIDER_ID,
    displayName: "Feishu WebSocket",
    transportMode: "websocket_worker",
    appId: "cli_ws",
    encryptedCredentialsJson: buildEncryptedFeishuCredentials({
      appSecret: "app-secret",
      verificationToken: "verification-token",
      encryptKey: "encrypt-key",
    }),
  });
  let capturedInput: FeishuWebSocketWorkerSessionFactoryInput | undefined;
  let closed = false;

  const worker = await startFeishuWebSocketWorker({
    workspaceId: workspace.id,
    lockedBy: "test",
    sessionFactory(input) {
      capturedInput = input;
      input.onReady();
      return Promise.resolve({
        close() {
          closed = true;
        },
        getConnectionStatus() {
          return {
            state: "connected",
            reconnectAttempts: 0,
          };
        },
      });
    },
  });

  assert.equal(worker.summary.startedCount, 1);
  assert.equal(worker.metrics.connectionReadyCount, 1);
  assert.equal(worker.metrics.connectionErrorCount, 0);
  assert.equal(capturedInput?.appId, "cli_ws");
  assert.equal(capturedInput?.appSecret, "app-secret");
  assert.equal(capturedInput?.verificationToken, "verification-token");
  assert.equal(capturedInput?.encryptKey, "encrypt-key");
  assert.equal(readExternalIntegrationSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
  })?.lastHealthStatus, "healthy");

  capturedInput?.onError(new Error("socket closed app_secret=app-secret Bearer tenant-token"));
  const degraded = readExternalIntegrationSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
  });
  assert.equal(degraded?.lastHealthStatus, "degraded");
  assert.equal(degraded?.lastError?.includes("app-secret"), false);
  assert.equal(degraded?.lastError?.includes("tenant-token"), false);
  assert.equal(worker.metrics.connectionReadyCount, 1);
  assert.equal(worker.metrics.connectionErrorCount, 1);
  assert.equal(worker.metrics.errors[0]?.errorCode, "feishu.websocket_worker.credentials_invalid");
  assert.equal(worker.metrics.errors[0]?.errorMessage.includes("app-secret"), false);
  assert.equal(worker.metrics.errors[0]?.errorMessage.includes("tenant-token"), false);

  assert.deepEqual(worker.getConnectionStatuses(), [{
    integrationId: integration.id,
    status: {
      state: "connected",
      reconnectAttempts: 0,
    },
  }]);
  worker.close();
  assert.equal(closed, true);
});
