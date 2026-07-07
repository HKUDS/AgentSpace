import assert from "node:assert/strict";
import test from "node:test";
import type { ExternalIntegrationRecord } from "@agent-space/db";
import { SLACK_PROVIDER_ID } from "../constants.ts";
import {
  openSlackSocketModeConnection,
  processSlackSocketModeEnvelope,
  startSlackSocketModeWorker,
  type SlackSocketModeWorkerMetrics,
} from "../socket-worker.ts";

test("opens Slack Socket Mode connections with an app-level token header", async () => {
  const calls: Array<{
    url: string;
    init?: RequestInit;
  }> = [];
  const result = await openSlackSocketModeConnection({
    appLevelToken: "xapp-test",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        ok: true,
        url: "wss://wss-primary.slack.com/link/?ticket=1",
      }), { status: 200 });
    },
  });

  assert.deepEqual(result, {
    url: "wss://wss-primary.slack.com/link/?ticket=1",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://slack.com/api/apps.connections.open");
  assert.equal((calls[0]?.init?.headers as Record<string, string>).Authorization, "Bearer xapp-test");
});

test("dry-run reports ready, skipped, and failed Slack Socket Mode integrations", async () => {
  const healthUpdates: Array<Record<string, unknown>> = [];
  const worker = await startSlackSocketModeWorker({
    workspaceId: "workspace-1",
    lockedBy: "worker-1",
    dryRun: true,
    workerDependencies: {
      listIntegrations(input) {
        assert.deepEqual(input, {
          workspaceId: "workspace-1",
          provider: SLACK_PROVIDER_ID,
        });
        return [
          makeIntegration({
            id: "slack-ws-ready",
            transportMode: "websocket_worker",
          }),
          makeIntegration({
            id: "slack-http-skipped",
            transportMode: "http_webhook",
          }),
          makeIntegration({
            id: "slack-ws-missing-token",
            transportMode: "websocket_worker",
          }),
        ];
      },
      readIntegrationCredentials(integration) {
        return {
          botToken: "xoxb-test",
          signingSecret: "signing-secret",
          appLevelToken: integration.id === "slack-ws-missing-token" ? "" : "xapp-test",
        };
      },
      updateIntegrationHealth(input) {
        healthUpdates.push(input as unknown as Record<string, unknown>);
        return makeIntegration({ id: String(input.integrationId) });
      },
    },
  });

  assert.equal(worker.summary.integrationCount, 3);
  assert.equal(worker.summary.startedCount, 0);
  assert.equal(worker.summary.skippedCount, 1);
  assert.deepEqual(worker.summary.integrations.map((item) => ({
    id: item.integrationId,
    status: item.status,
    reasonCode: item.reasonCode,
  })), [
    {
      id: "slack-ws-ready",
      status: "ready",
      reasonCode: undefined,
    },
    {
      id: "slack-http-skipped",
      status: "skipped",
      reasonCode: "slack.socket_worker.transport_mode_not_socket",
    },
    {
      id: "slack-ws-missing-token",
      status: "failed",
      reasonCode: "slack.socket_worker.app_level_token_missing",
    },
  ]);
  assert.equal(worker.summary.errors.length, 1);
  assert.equal(worker.metrics.errors.length, 1);
  assert.deepEqual(healthUpdates.map((item) => item.lastHealthStatus), ["degraded"]);
});

test("processSlackSocketModeEnvelope acks before inbound dispatch and drains outbox", async () => {
  const metrics = createMetrics();
  const order: string[] = [];
  let inboundPayload: Record<string, unknown> | undefined;
  let drainInput: Record<string, unknown> | undefined;

  await processSlackSocketModeEnvelope({
    context: {
      workspaceId: "workspace-1",
      integrationId: "slack-1",
      provider: SLACK_PROVIDER_ID,
    },
    integration: makeIntegration({
      id: "slack-1",
      appId: "A111",
      tenantKey: "T111",
    }),
    envelope: {
      envelope_id: "env-1",
      type: "events_api",
      payload: {
        type: "event_callback",
        event_id: "Ev111",
        api_app_id: "A111",
        team_id: "T111",
        event: {
          type: "app_mention",
          channel: "C111",
          user: "U111",
          ts: "1783400000.000100",
          text: "<@Ubot> hello",
        },
      },
    },
    async ack() {
      order.push("ack");
    },
    metrics,
    lockedBy: "worker-1",
    baseUrl: "https://slack.test/api",
    drainOutboxLimit: 7,
    dependencies: {
      async processInboundEvent(input) {
        order.push("inbound");
        inboundPayload = input.payload;
        assert.equal(input.context.workspaceId, "workspace-1");
        assert.equal(input.context.integrationId, "slack-1");
        assert.equal(input.integration?.id, "slack-1");
        return {
          event: {
            externalEventId: "Ev111",
            status: "processed",
          },
          message: null,
          dispatchStatus: "sent",
        } as never;
      },
      async drainOutboxMessages(input) {
        order.push("outbox");
        drainInput = input as Record<string, unknown>;
        return {
          processedCount: 2,
          sentCount: 2,
          failedCount: 0,
          errors: [],
        };
      },
    },
  });

  assert.deepEqual(order, ["ack", "inbound", "outbox"]);
  assert.equal(inboundPayload?.event_id, "Ev111");
  assert.deepEqual(drainInput, {
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    lockedBy: "worker-1",
    limit: 7,
    baseUrl: "https://slack.test/api",
  });
  assert.equal(metrics.receivedCount, 1);
  assert.equal(metrics.ackCount, 1);
  assert.equal(metrics.processedCount, 1);
  assert.equal(metrics.outboxProcessedCount, 2);
  assert.equal(metrics.outboxSentCount, 2);
});

test("processSlackSocketModeEnvelope records app/team mismatch without inbound dispatch", async () => {
  const metrics = createMetrics();
  let inboundProcessed = false;

  await processSlackSocketModeEnvelope({
    context: {
      workspaceId: "workspace-1",
      integrationId: "slack-1",
      provider: SLACK_PROVIDER_ID,
    },
    integration: makeIntegration({
      id: "slack-1",
      appId: "A111",
      tenantKey: "T111",
    }),
    envelope: {
      envelope_id: "env-1",
      payload: {
        type: "event_callback",
        event_id: "Ev111",
        api_app_id: "A111",
        team_id: "T222",
        event: {
          type: "app_mention",
        },
      },
    },
    async ack() {},
    metrics,
    lockedBy: "worker-1",
    dependencies: {
      async processInboundEvent() {
        inboundProcessed = true;
        throw new Error("inbound should not run after team mismatch");
      },
    },
  });

  assert.equal(inboundProcessed, false);
  assert.equal(metrics.ackCount, 1);
  assert.equal(metrics.failedCount, 1);
  assert.equal(metrics.errors[0]?.errorCode, "slack.callback_team_id_mismatch");
});

test("startSlackSocketModeWorker starts sessions and marks disconnects degraded", async () => {
  const integration = makeIntegration({
    id: "slack-ws-1",
    transportMode: "websocket_worker",
  });
  const healthUpdates: Array<Record<string, unknown>> = [];
  const closed: string[] = [];
  let triggerError: ((error: unknown) => void) | undefined;

  const worker = await startSlackSocketModeWorker({
    workspaceId: "workspace-1",
    lockedBy: "worker-1",
    workerDependencies: {
      listIntegrations() {
        return [integration];
      },
      readIntegrationCredentials() {
        return {
          botToken: "xoxb-test",
          signingSecret: "signing-secret",
          appLevelToken: "xapp-test",
        };
      },
      updateIntegrationHealth(input) {
        healthUpdates.push(input as unknown as Record<string, unknown>);
        return integration;
      },
    },
    async sessionFactory(input) {
      assert.equal(input.appLevelToken, "xapp-test");
      triggerError = input.onError;
      input.onReady();
      return {
        close() {
          closed.push(input.integrationId);
        },
        getConnectionStatus() {
          return { state: "open" };
        },
      };
    },
  });

  assert.equal(worker.summary.startedCount, 1);
  assert.equal(worker.metrics.connectionReadyCount, 1);
  assert.deepEqual(worker.getConnectionStatuses(), [{
    integrationId: "slack-ws-1",
    status: {
      state: "open",
    },
  }]);

  triggerError?.(new Error("websocket closed with appLevelToken=xapp-secret Bearer xapp-secret"));
  assert.equal(worker.metrics.connectionErrorCount, 1);
  assert.equal(worker.metrics.errors[0]?.errorCode, "slack.socket_worker.credentials_invalid");
  assert.doesNotMatch(worker.metrics.errors[0]?.errorMessage ?? "", /xapp-secret/);
  assert.deepEqual(healthUpdates.map((item) => item.lastHealthStatus), ["healthy", "degraded"]);

  worker.close();
  assert.deepEqual(closed, ["slack-ws-1"]);
});

function createMetrics(): SlackSocketModeWorkerMetrics {
  return {
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
  };
}

function makeIntegration(overrides: Partial<ExternalIntegrationRecord> = {}): ExternalIntegrationRecord {
  return {
    id: "slack-1",
    workspaceId: "workspace-1",
    provider: SLACK_PROVIDER_ID,
    displayName: "Slack",
    status: "active",
    transportMode: "websocket_worker",
    appId: "A111",
    tenantKey: "T111",
    encryptedCredentialsJson: "{}",
    configJson: "{}",
    capabilitiesJson: "{}",
    scopesJson: "[]",
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
    ...overrides,
  };
}
