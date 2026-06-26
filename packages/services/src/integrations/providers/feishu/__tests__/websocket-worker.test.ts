import assert from "node:assert/strict";
import test from "node:test";
import type { ExternalIntegrationRecord } from "@agent-space/db";
import {
  buildFeishuWebSocketEventPayload,
  FEISHU_WEBSOCKET_WORKER_EVENT_TYPES,
  processFeishuWebSocketEvent,
  startFeishuWebSocketWorker,
  type FeishuWebSocketWorkerMetrics,
} from "../websocket-worker.ts";
import { FEISHU_PROVIDER_ID } from "../constants.ts";

test("wraps Feishu SDK message events into the inbound webhook payload shape", () => {
  const payload = buildFeishuWebSocketEventPayload({
    eventType: "im.message.receive_v1",
    event: {
      message: {
        message_id: "om_123",
        chat_id: "oc_123",
        create_time: "1782280000000",
        content: JSON.stringify({ text: "@Atlas summarize the doc" }),
      },
      sender: {
        sender_id: {
          open_id: "ou_123",
        },
      },
      tenant_key: "tenant-1",
    },
  });

  assert.deepEqual(payload, {
    schema: "2.0",
    header: {
      event_id: "om_123",
      event_type: "im.message.receive_v1",
      create_time: "1782280000000",
      token: undefined,
      app_id: undefined,
      tenant_key: "tenant-1",
    },
    event: {
      message: {
        message_id: "om_123",
        chat_id: "oc_123",
        create_time: "1782280000000",
        content: JSON.stringify({ text: "@Atlas summarize the doc" }),
      },
      sender: {
        sender_id: {
          open_id: "ou_123",
        },
      },
      tenant_key: "tenant-1",
    },
  });
});

test("websocket worker subscribes to Feishu bot-added auto-provisioning events", () => {
  assert.ok(FEISHU_WEBSOCKET_WORKER_EVENT_TYPES.includes("im.chat.member.bot.added_v1"));
});

test("keeps already-normalized Feishu webhook payloads unchanged", () => {
  const payload = {
    schema: "2.0",
    header: {
      event_id: "evt_123",
      event_type: "im.message.receive_v1",
    },
    event: {
      message: {
        message_id: "om_123",
        chat_id: "oc_123",
      },
    },
  };

  assert.equal(buildFeishuWebSocketEventPayload({
    eventType: "im.message.receive_v1",
    event: payload,
  }), payload);
});

test("processFeishuWebSocketEvent routes SDK events through inbound processing without HTTP callbacks", async () => {
  const metrics = createMetrics();
  const attachmentDownloader = (() => undefined) as never;
  let inboundPayload: Record<string, unknown> | undefined;
  let drainInput: Record<string, unknown> | undefined;

  await processFeishuWebSocketEvent({
    context: {
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      provider: FEISHU_PROVIDER_ID,
    },
    integrationId: "integration-1",
    appId: "cli_test",
    appSecret: "app-secret",
    eventType: "im.message.receive_v1",
    event: {
      message: {
        message_id: "om_ws_1",
        chat_id: "oc_ws_1",
        content: JSON.stringify({ text: "@Atlas hello from websocket" }),
      },
      sender: {
        sender_id: {
          open_id: "ou_mina",
        },
      },
    },
    metrics,
    lockedBy: "worker-1",
    baseUrl: "https://feishu.test",
    drainOutboxLimit: 7,
    dependencies: {
      createInboundAttachmentDownloader(input) {
        assert.deepEqual(input, {
          workspaceId: "workspace-1",
          appId: "cli_test",
          appSecret: "app-secret",
          baseUrl: "https://feishu.test",
        });
        return attachmentDownloader;
      },
      async processInboundEvent(input) {
        inboundPayload = input.payload;
        assert.equal(input.context.workspaceId, "workspace-1");
        assert.equal(input.context.integrationId, "integration-1");
        assert.equal(input.attachmentDownloader, attachmentDownloader);
        return {
          event: {
            externalEventId: "om_ws_1",
            status: "processed",
          },
          message: null,
          dispatchStatus: "sent",
        } as never;
      },
      async drainOutboxMessages(input) {
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

  assert.deepEqual((inboundPayload?.header as Record<string, unknown> | undefined), {
    event_id: "om_ws_1",
    event_type: "im.message.receive_v1",
    create_time: undefined,
    token: undefined,
    app_id: undefined,
    tenant_key: undefined,
  });
  assert.deepEqual(drainInput, {
    workspaceId: "workspace-1",
    integrationId: "integration-1",
    lockedBy: "worker-1",
    limit: 7,
    baseUrl: "https://feishu.test",
  });
  assert.equal(metrics.receivedCount, 1);
  assert.equal(metrics.processedCount, 1);
  assert.equal(metrics.outboxProcessedCount, 2);
  assert.equal(metrics.outboxSentCount, 2);
  assert.equal(metrics.failedCount, 0);
});

test("processFeishuWebSocketEvent routes bot-added events through inbound auto-provisioning", async () => {
  const metrics = createMetrics();
  let inboundPayload: Record<string, unknown> | undefined;
  let drainInput: Record<string, unknown> | undefined;

  await processFeishuWebSocketEvent({
    context: {
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      provider: FEISHU_PROVIDER_ID,
    },
    integrationId: "integration-1",
    appId: "cli_test",
    appSecret: "app-secret",
    eventType: "im.chat.member.bot.added_v1",
    event: {
      chat_id: "oc_auto",
      chat_type: "group",
      chat_name: "Auto Provision Room",
    },
    metrics,
    lockedBy: "worker-1",
    dependencies: {
      createInboundAttachmentDownloader() {
        return (() => undefined) as never;
      },
      async processInboundEvent(input) {
        inboundPayload = input.payload;
        assert.equal(input.context.integrationId, "integration-1");
        return {
          event: {
            externalEventId: "feishu-ws-bot-added",
            status: "processed",
          },
          message: null,
          mappedChannelName: "feishu-auto-provision-room",
          dispatchStatus: "sent",
          reasonCode: "feishu_bot_added_channel_provisioned",
        } as never;
      },
      async drainOutboxMessages(input) {
        drainInput = input as Record<string, unknown>;
        return {
          processedCount: 1,
          sentCount: 1,
          failedCount: 0,
          errors: [],
        };
      },
    },
  });

  const header = inboundPayload?.header as Record<string, unknown> | undefined;
  assert.match(String(header?.event_id), /^feishu-ws-\d+$/);
  assert.deepEqual({
    event_type: header?.event_type,
    create_time: header?.create_time,
    token: header?.token,
    app_id: header?.app_id,
    tenant_key: header?.tenant_key,
  }, {
    event_type: "im.chat.member.bot.added_v1",
    create_time: undefined,
    token: undefined,
    app_id: undefined,
    tenant_key: undefined,
  });
  assert.equal((inboundPayload?.event as Record<string, unknown> | undefined)?.chat_id, "oc_auto");
  assert.equal(drainInput?.integrationId, "integration-1");
  assert.equal(metrics.processedCount, 1);
  assert.equal(metrics.outboxSentCount, 1);
});

test("processFeishuWebSocketEvent routes approval card actions through approval callbacks", async () => {
  const metrics = createMetrics();
  let cardActionInput: Record<string, unknown> | undefined;
  let attachmentDownloaderCreated = false;
  let inboundProcessed = false;
  let outboxDrained = false;

  await processFeishuWebSocketEvent({
    context: {
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      provider: FEISHU_PROVIDER_ID,
    },
    integrationId: "integration-1",
    appId: "cli_test",
    appSecret: "app-secret",
    eventType: "card.action.trigger",
    event: {
      header: {
        event_id: "evt-card-ws-1",
        event_type: "card.action.trigger",
        app_id: "cli_test",
      },
      event: {
        action: {
          value: {
            approvalId: "approval-1",
            decision: "approved",
            payloadHash: "payload-hash",
            token: "card-token",
          },
        },
        operator: {
          operator_id: {
            open_id: "ou_mina",
          },
        },
      },
    },
    metrics,
    lockedBy: "worker-1",
    baseUrl: "https://feishu.test",
    dependencies: {
      createInboundAttachmentDownloader() {
        attachmentDownloaderCreated = true;
        return (() => undefined) as never;
      },
      async processInboundEvent() {
        inboundProcessed = true;
        throw new Error("inbound should not run for card actions");
      },
      async drainOutboxMessages() {
        outboxDrained = true;
        throw new Error("outbox should not drain for card actions");
      },
      async processCardActionCallback(input) {
        cardActionInput = input as unknown as Record<string, unknown>;
        return {
          eventId: "evt-card-ws-1",
          eventStatus: "processed",
          handled: true,
          approvalId: "approval-1",
          decision: "approved",
          reviewerUserId: "user-1",
        };
      },
    },
  });

  assert.equal(attachmentDownloaderCreated, false);
  assert.equal(inboundProcessed, false);
  assert.equal(outboxDrained, false);
  assert.equal(metrics.receivedCount, 1);
  assert.equal(metrics.processedCount, 1);
  assert.equal(metrics.ignoredCount, 0);
  assert.equal(metrics.failedCount, 0);
  assert.deepEqual((cardActionInput?.payload as Record<string, unknown> | undefined)?.header, {
    event_id: "evt-card-ws-1",
    event_type: "card.action.trigger",
    app_id: "cli_test",
  });
  assert.equal(cardActionInput?.baseUrl, "https://feishu.test");
});

test("processFeishuWebSocketEvent records sanitized failures without draining outbox", async () => {
  const metrics = createMetrics();
  let drained = false;

  await processFeishuWebSocketEvent({
    context: {
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      provider: FEISHU_PROVIDER_ID,
    },
    integrationId: "integration-1",
    appId: "cli_test",
    appSecret: "app-secret",
    eventType: "im.message.receive_v1",
    event: {
      message: {
        message_id: "om_ws_error",
      },
    },
    metrics,
    lockedBy: "worker-1",
    dependencies: {
      createInboundAttachmentDownloader() {
        return (() => undefined) as never;
      },
      async processInboundEvent() {
        throw new Error("failed with app_secret=app-secret Bearer tenant-token-secret");
      },
      async drainOutboxMessages() {
        drained = true;
        throw new Error("outbox should not drain after inbound failure");
      },
    },
  });

  assert.equal(drained, false);
  assert.equal(metrics.receivedCount, 1);
  assert.equal(metrics.failedCount, 1);
  assert.equal(metrics.errors.length, 1);
  assert.equal(metrics.errors[0]?.errorCode, "feishu.websocket_worker.credentials_invalid");
  assert.match(metrics.errors[0]?.errorMessage ?? "", /app_secret=\[redacted\]/);
  assert.doesNotMatch(metrics.errors[0]?.errorMessage ?? "", /app-secret|tenant-token-secret/);
});

test("processFeishuWebSocketEvent rejects app or tenant mismatches before inbound processing", async () => {
  const metrics = createMetrics();
  let attachmentDownloaderCreated = false;
  let inboundProcessed = false;
  let outboxDrained = false;
  let rejectedInput: Record<string, unknown> | undefined;

  await processFeishuWebSocketEvent({
    context: {
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      provider: FEISHU_PROVIDER_ID,
    },
    integrationId: "integration-1",
    appId: "cli_test",
    tenantKey: "tenant-allowed",
    appSecret: "app-secret",
    eventType: "im.message.receive_v1",
    event: {
      header: {
        event_id: "evt-tenant-mismatch",
        event_type: "im.message.receive_v1",
        app_id: "cli_test",
        tenant_key: "tenant-other",
      },
      event: {
        message: {
          message_id: "om_ws_tenant_mismatch",
          chat_id: "oc_ws_1",
          content: JSON.stringify({ text: "@Atlas wrong tenant" }),
        },
      },
    },
    metrics,
    lockedBy: "worker-1",
    dependencies: {
      createInboundAttachmentDownloader() {
        attachmentDownloaderCreated = true;
        return (() => undefined) as never;
      },
      async processInboundEvent() {
        inboundProcessed = true;
        throw new Error("inbound should not run after tenant mismatch");
      },
      async drainOutboxMessages() {
        outboxDrained = true;
        throw new Error("outbox should not drain after tenant mismatch");
      },
      recordRejectedCallback(input) {
        rejectedInput = input as unknown as Record<string, unknown>;
        return {
          event: {
            externalEventId: "evt-tenant-mismatch",
            status: "failed",
          },
          message: null,
          dispatchStatus: "failed",
          reasonCode: "feishu.callback_tenant_key_mismatch",
        } as never;
      },
    },
  });

  assert.equal(attachmentDownloaderCreated, false);
  assert.equal(inboundProcessed, false);
  assert.equal(outboxDrained, false);
  assert.equal(metrics.receivedCount, 1);
  assert.equal(metrics.failedCount, 1);
  assert.equal(metrics.errors.length, 0);
  assert.equal(rejectedInput?.reasonCode, "feishu.callback_tenant_key_mismatch");
  assert.deepEqual((rejectedInput?.payload as Record<string, unknown> | undefined)?.header, {
    event_id: "evt-tenant-mismatch",
    event_type: "im.message.receive_v1",
    app_id: "cli_test",
    tenant_key: "tenant-other",
  });
});

test("startFeishuWebSocketWorker can close and restart sessions with injected dependencies", async () => {
  const integration = makeIntegration({
    id: "integration-ws-1",
    transportMode: "websocket_worker",
  });
  const started: string[] = [];
  const closed: string[] = [];
  const healthUpdates: Array<Record<string, unknown>> = [];

  const startWorker = () => startFeishuWebSocketWorker({
    workspaceId: "workspace-1",
    lockedBy: "worker-1",
    workerDependencies: {
      listIntegrations(input) {
        assert.deepEqual(input, {
          workspaceId: "workspace-1",
          provider: FEISHU_PROVIDER_ID,
        });
        return [integration];
      },
      readIntegrationCredentials(input) {
        assert.equal(input.id, "integration-ws-1");
        return {
          appSecret: "app-secret",
          verificationToken: "verify-token",
          encryptKey: "encrypt-key",
        };
      },
      updateIntegrationHealth(input) {
        healthUpdates.push(input as unknown as Record<string, unknown>);
        return integration;
      },
    },
    async sessionFactory(input) {
      started.push(input.integrationId);
      input.onReady();
      return {
        close() {
          closed.push(input.integrationId);
        },
        getConnectionStatus() {
          return {
            state: "connected",
            reconnectAttempts: started.length - 1,
          } as never;
        },
      };
    },
  });

  const first = await startWorker();
  assert.equal(first.summary.startedCount, 1);
  assert.equal(first.metrics.connectionReadyCount, 1);
  assert.equal(first.metrics.connectionErrorCount, 0);
  assert.deepEqual(first.getConnectionStatuses(), [{
    integrationId: "integration-ws-1",
    status: {
      state: "connected",
      reconnectAttempts: 0,
    },
  }]);
  first.close();

  const second = await startWorker();
  assert.equal(second.summary.startedCount, 1);
  assert.equal(second.metrics.connectionReadyCount, 1);
  assert.equal(second.metrics.connectionErrorCount, 0);
  assert.deepEqual(second.getConnectionStatuses(), [{
    integrationId: "integration-ws-1",
    status: {
      state: "connected",
      reconnectAttempts: 1,
    },
  }]);
  second.close();

  assert.deepEqual(started, ["integration-ws-1", "integration-ws-1"]);
  assert.deepEqual(closed, ["integration-ws-1", "integration-ws-1"]);
  assert.deepEqual(healthUpdates.map((update) => ({
    workspaceId: update.workspaceId,
    integrationId: update.integrationId,
    lastHealthStatus: update.lastHealthStatus,
  })), [{
    workspaceId: "workspace-1",
    integrationId: "integration-ws-1",
    lastHealthStatus: "healthy",
  }, {
    workspaceId: "workspace-1",
    integrationId: "integration-ws-1",
    lastHealthStatus: "healthy",
  }]);
});

function createMetrics(): FeishuWebSocketWorkerMetrics {
  return {
    connectionReadyCount: 0,
    connectionErrorCount: 0,
    receivedCount: 0,
    processedCount: 0,
    ignoredCount: 0,
    failedCount: 0,
    duplicateCount: 0,
    noticeOutboxCount: 0,
    outboxProcessedCount: 0,
    outboxSentCount: 0,
    outboxFailedCount: 0,
    errors: [],
  };
}

function makeIntegration(input: {
  id: string;
  transportMode: ExternalIntegrationRecord["transportMode"];
}): ExternalIntegrationRecord {
  return {
    id: input.id,
    workspaceId: "workspace-1",
    provider: FEISHU_PROVIDER_ID,
    displayName: "Feishu WebSocket",
    status: "active",
    transportMode: input.transportMode,
    appId: "cli_test",
    encryptedCredentialsJson: "{}",
    configJson: "{}",
    capabilitiesJson: "{}",
    scopesJson: "[]",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
  };
}
