import {
  listExternalIntegrationsSync,
  updateExternalIntegrationHealthSync,
  type ExternalIntegrationHealthStatus,
  type ExternalIntegrationRecord,
} from "@agent-space/db";
import type { WSConnectionStatus } from "@larksuiteoapi/node-sdk";
import type { IntegrationRuntimeContext } from "../../core/index.ts";
import { createFeishuInboundAttachmentDownloader } from "./attachments.ts";
import { FEISHU_PROVIDER_ID } from "./constants.ts";
import { readFeishuIntegrationCredentials, type FeishuPlainCredentials } from "./credentials.ts";
import {
  isFeishuApprovalCardActionCallbackPayload,
  isFeishuCardActionCallbackPayload,
  validateFeishuCallbackContext,
} from "./events.ts";
import {
  processFeishuCardActionCallback,
  type FeishuCardActionCallbackResult,
} from "./approval.ts";
import {
  processFeishuInboundEvent,
  recordFeishuCardActionCallbackIgnoredSync,
  recordFeishuCallbackRejectedSync,
  type FeishuInboundProcessResult,
} from "./inbound.ts";
import { drainFeishuOutboxMessages, type FeishuOutboxDrainResult } from "./outbound.ts";

export interface FeishuWebSocketWorkerSummary {
  workspaceId: string;
  provider: typeof FEISHU_PROVIDER_ID;
  mode: "websocket_worker";
  integrationCount: number;
  startedCount: number;
  skippedCount: number;
  dryRun: boolean;
  integrations: FeishuWebSocketWorkerIntegrationSummary[];
  errors: FeishuWebSocketWorkerError[];
}

export interface FeishuWebSocketWorkerIntegrationSummary {
  integrationId: string;
  displayName: string;
  status: "ready" | "started" | "skipped" | "failed";
  reasonCode?: string;
  healthStatus?: ExternalIntegrationHealthStatus;
}

export interface FeishuWebSocketWorkerError {
  integrationId: string;
  errorCode: string;
  errorMessage: string;
}

export interface FeishuWebSocketWorkerMetrics {
  connectionReadyCount: number;
  connectionErrorCount: number;
  receivedCount: number;
  processedCount: number;
  ignoredCount: number;
  failedCount: number;
  duplicateCount: number;
  noticeOutboxCount: number;
  outboxProcessedCount: number;
  outboxSentCount: number;
  outboxFailedCount: number;
  errors: FeishuWebSocketWorkerError[];
}

export interface FeishuWebSocketWorkerHandle {
  summary: FeishuWebSocketWorkerSummary;
  metrics: FeishuWebSocketWorkerMetrics;
  close(): void;
  getConnectionStatuses(): Array<{
    integrationId: string;
    status?: WSConnectionStatus;
  }>;
}

export interface FeishuWebSocketWorkerSession {
  close(): void;
  getConnectionStatus?(): WSConnectionStatus;
}

export interface FeishuWebSocketWorkerSessionFactoryInput {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  domain?: string;
  integrationId: string;
  onReady(): void;
  onError(error: unknown): void;
  onEvent(eventType: string, event: unknown): Promise<void>;
}

export type FeishuWebSocketWorkerSessionFactory = (
  input: FeishuWebSocketWorkerSessionFactoryInput
) => Promise<FeishuWebSocketWorkerSession>;

export const FEISHU_WEBSOCKET_WORKER_EVENT_TYPES = [
  "im.message.receive_v1",
  "card.action.trigger",
  "im.message.message_card.action_v1",
  "message_card.action",
  "im.chat.member.bot.added_v1",
] as const;

export interface FeishuWebSocketWorkerDependencies {
  listIntegrations?: typeof listExternalIntegrationsSync;
  readIntegrationCredentials?: (integration: ExternalIntegrationRecord) => FeishuPlainCredentials;
  updateIntegrationHealth?: typeof updateExternalIntegrationHealthSync;
}

export interface FeishuWebSocketEventProcessorDependencies {
  createInboundAttachmentDownloader?: typeof createFeishuInboundAttachmentDownloader;
  drainOutboxMessages?: typeof drainFeishuOutboxMessages;
  processInboundEvent?: typeof processFeishuInboundEvent;
  processCardActionCallback?: typeof processFeishuCardActionCallback;
  recordCardActionIgnored?: typeof recordFeishuCardActionCallbackIgnoredSync;
  recordRejectedCallback?: typeof recordFeishuCallbackRejectedSync;
}

export async function startFeishuWebSocketWorker(input: {
  workspaceId: string;
  integrationId?: string;
  lockedBy: string;
  dryRun?: boolean;
  domain?: string;
  baseUrl?: string;
  drainOutboxLimit?: number;
  includeWebhookIntegrations?: boolean;
  eventProcessorDependencies?: FeishuWebSocketEventProcessorDependencies;
  workerDependencies?: FeishuWebSocketWorkerDependencies;
  sessionFactory?: FeishuWebSocketWorkerSessionFactory;
}): Promise<FeishuWebSocketWorkerHandle> {
  const workerDependencies = input.workerDependencies ?? {};
  const integrations = resolveFeishuWebSocketWorkerIntegrations(input, workerDependencies);
  const summaryItems: FeishuWebSocketWorkerIntegrationSummary[] = [];
  const errors: FeishuWebSocketWorkerError[] = [];
  const sessions: Array<{
    integrationId: string;
    session: FeishuWebSocketWorkerSession;
  }> = [];
  const metrics: FeishuWebSocketWorkerMetrics = {
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

  for (const integration of integrations) {
    if (!input.includeWebhookIntegrations && integration.transportMode !== "websocket_worker") {
      summaryItems.push({
        integrationId: integration.id,
        displayName: integration.displayName,
        status: "skipped",
        reasonCode: "feishu.websocket_worker.transport_mode_not_websocket",
      });
      continue;
    }

    if (input.dryRun) {
      summaryItems.push({
        integrationId: integration.id,
        displayName: integration.displayName,
        status: "ready",
        healthStatus: integration.lastHealthStatus,
      });
      continue;
    }

    try {
      const readCredentials = workerDependencies.readIntegrationCredentials ?? readFeishuIntegrationCredentials;
      const credentials = readCredentials(integration);
      const appId = integration.appId?.trim();
      if (!appId || !credentials.appSecret.trim()) {
        throw new Error("feishu.websocket_worker.credentials_missing");
      }
      const context: IntegrationRuntimeContext = {
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        provider: FEISHU_PROVIDER_ID,
      };
      const sessionFactory = input.sessionFactory ?? createFeishuSdkWebSocketWorkerSession;
      const session = await sessionFactory({
        appId,
        appSecret: credentials.appSecret,
        verificationToken: credentials.verificationToken,
        encryptKey: credentials.encryptKey,
        domain: input.domain,
        integrationId: integration.id,
        onReady() {
          metrics.connectionReadyCount += 1;
          updateFeishuWorkerHealth({
            workspaceId: input.workspaceId,
            integrationId: integration.id,
            status: "healthy",
          }, workerDependencies);
        },
        onError(error) {
          const workerError = normalizeFeishuWorkerError(integration.id, error);
          metrics.connectionErrorCount += 1;
          metrics.errors.push(workerError);
          updateFeishuWorkerHealth({
            workspaceId: input.workspaceId,
            integrationId: integration.id,
            status: "degraded",
            lastError: workerError.errorMessage,
          }, workerDependencies);
        },
        async onEvent(eventType, event) {
          await processFeishuWebSocketEvent({
            context,
            integrationId: integration.id,
            appId,
            tenantKey: integration.tenantKey,
            appSecret: credentials.appSecret,
            eventType,
            event,
            metrics,
            lockedBy: input.lockedBy,
            baseUrl: input.baseUrl,
            drainOutboxLimit: input.drainOutboxLimit,
            dependencies: input.eventProcessorDependencies,
          });
        },
      });
      sessions.push({ integrationId: integration.id, session });
      summaryItems.push({
        integrationId: integration.id,
        displayName: integration.displayName,
        status: "started",
        healthStatus: "healthy",
      });
    } catch (error) {
      const workerError = normalizeFeishuWorkerError(integration.id, error);
      errors.push(workerError);
      metrics.errors.push(workerError);
      summaryItems.push({
        integrationId: integration.id,
        displayName: integration.displayName,
        status: "failed",
        reasonCode: workerError.errorCode,
        healthStatus: "degraded",
      });
      updateFeishuWorkerHealth({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        status: "degraded",
        lastError: workerError.errorMessage,
      }, workerDependencies);
    }
  }

  const summary: FeishuWebSocketWorkerSummary = {
    workspaceId: input.workspaceId,
    provider: FEISHU_PROVIDER_ID,
    mode: "websocket_worker",
    integrationCount: integrations.length,
    startedCount: summaryItems.filter((item) => item.status === "started").length,
    skippedCount: summaryItems.filter((item) => item.status === "skipped").length,
    dryRun: Boolean(input.dryRun),
    integrations: summaryItems,
    errors,
  };

  return {
    summary,
    metrics,
    close() {
      for (const { session } of sessions) {
        session.close();
      }
    },
    getConnectionStatuses() {
      return sessions.map(({ integrationId, session }) => ({
        integrationId,
        status: session.getConnectionStatus?.(),
      }));
    },
  };
}

export function buildFeishuWebSocketEventPayload(input: {
  eventType: string;
  event: unknown;
}): Record<string, unknown> {
  const record = asRecord(input.event) ?? {};
  if (asRecord(record.header) && asRecord(record.event)) {
    return record;
  }
  const event = asRecord(record.event) ?? record;
  const message = asRecord(event.message);
  const header = asRecord(record.header) ?? {};
  return {
    schema: "2.0",
    header: {
      event_id: readString(header.event_id)
        ?? readString(record.event_id)
        ?? readString(event.event_id)
        ?? readString(message?.message_id)
        ?? `feishu-ws-${Date.now()}`,
      event_type: readString(header.event_type) ?? input.eventType,
      create_time: readString(header.create_time)
        ?? readString(record.create_time)
        ?? readString(event.create_time)
        ?? readString(message?.create_time),
      token: readString(header.token) ?? readString(record.token) ?? readString(event.token),
      app_id: readString(header.app_id) ?? readString(record.app_id) ?? readString(event.app_id),
      tenant_key: readString(header.tenant_key) ?? readString(record.tenant_key) ?? readString(event.tenant_key),
    },
    event,
  };
}

function resolveFeishuWebSocketWorkerIntegrations(input: {
  workspaceId: string;
  integrationId?: string;
}, dependencies?: FeishuWebSocketWorkerDependencies): ExternalIntegrationRecord[] {
  const listIntegrations = dependencies?.listIntegrations ?? listExternalIntegrationsSync;
  return listIntegrations({
    workspaceId: input.workspaceId,
    provider: FEISHU_PROVIDER_ID,
  }).filter((integration) =>
    integration.status === "active" &&
    (!input.integrationId || integration.id === input.integrationId));
}

async function createFeishuSdkWebSocketWorkerSession(
  input: FeishuWebSocketWorkerSessionFactoryInput,
): Promise<FeishuWebSocketWorkerSession> {
  const lark = await import("@larksuiteoapi/node-sdk");
  const eventHandlers = Object.fromEntries(FEISHU_WEBSOCKET_WORKER_EVENT_TYPES.map((eventType) => [
    eventType,
    async (event: unknown) => {
      await input.onEvent(eventType, event);
    },
  ]));
  const dispatcher = new lark.EventDispatcher({
    verificationToken: input.verificationToken,
    encryptKey: input.encryptKey,
    loggerLevel: lark.LoggerLevel.info,
  }).register(eventHandlers);
  const client = new lark.WSClient({
    appId: input.appId,
    appSecret: input.appSecret,
    domain: input.domain,
    autoReconnect: true,
    source: "agent-space-feishu-worker",
    onReady: input.onReady,
    onError(error) {
      input.onError(error);
    },
  });
  await client.start({ eventDispatcher: dispatcher });
  return {
    close() {
      client.close({ force: true });
    },
    getConnectionStatus() {
      return client.getConnectionStatus();
    },
  };
}

export async function processFeishuWebSocketEvent(input: {
  context: IntegrationRuntimeContext;
  integrationId: string;
  appId: string;
  tenantKey?: string;
  appSecret: string;
  eventType: string;
  event: unknown;
  metrics: FeishuWebSocketWorkerMetrics;
  lockedBy: string;
  baseUrl?: string;
  drainOutboxLimit?: number;
  dependencies?: FeishuWebSocketEventProcessorDependencies;
}): Promise<void> {
  input.metrics.receivedCount += 1;
  try {
    const payload = buildFeishuWebSocketEventPayload({
      eventType: input.eventType,
      event: input.event,
    });
    const contextValidation = validateFeishuCallbackContext({
      payload,
      expectedAppId: input.appId,
      expectedTenantKey: input.tenantKey,
    });
    if (!contextValidation.ok) {
      const recordRejectedCallback = input.dependencies?.recordRejectedCallback ?? recordFeishuCallbackRejectedSync;
      const result = recordRejectedCallback({
        context: input.context,
        payload,
        reasonCode: contextValidation.reasonCode,
      });
      recordFeishuWorkerInboundMetrics(input.metrics, result);
      return;
    }

    if (isFeishuCardActionCallbackPayload(payload)) {
      if (!isFeishuApprovalCardActionCallbackPayload(payload)) {
        const recordCardActionIgnored = input.dependencies?.recordCardActionIgnored
          ?? recordFeishuCardActionCallbackIgnoredSync;
        const result = recordCardActionIgnored({
          context: input.context,
          payload,
          reasonCode: "feishu_card_action_non_approval_ignored",
        });
        recordFeishuWorkerInboundMetrics(input.metrics, result);
        return;
      }

      const processCardActionCallback = input.dependencies?.processCardActionCallback
        ?? processFeishuCardActionCallback;
      const result = await processCardActionCallback({
        context: input.context,
        payload,
        baseUrl: input.baseUrl,
      });
      recordFeishuWorkerCardActionMetrics(input.metrics, result);
      return;
    }

    const createInboundAttachmentDownloader = input.dependencies?.createInboundAttachmentDownloader
      ?? createFeishuInboundAttachmentDownloader;
    const processInboundEvent = input.dependencies?.processInboundEvent ?? processFeishuInboundEvent;
    const result = await processInboundEvent({
      context: input.context,
      payload,
      attachmentDownloader: createInboundAttachmentDownloader({
        workspaceId: input.context.workspaceId,
        appId: input.appId,
        appSecret: input.appSecret,
        baseUrl: input.baseUrl,
      }),
    });
    recordFeishuWorkerInboundMetrics(input.metrics, result);
    const drainOutboxMessages = input.dependencies?.drainOutboxMessages ?? drainFeishuOutboxMessages;
    const outboxDrain = await drainOutboxMessages({
      workspaceId: input.context.workspaceId,
      integrationId: input.integrationId,
      lockedBy: input.lockedBy,
      limit: input.drainOutboxLimit ?? 5,
      baseUrl: input.baseUrl,
    });
    recordFeishuWorkerOutboxMetrics(input.metrics, outboxDrain);
  } catch (error) {
    input.metrics.failedCount += 1;
    input.metrics.errors.push(normalizeFeishuWorkerError(input.integrationId, error));
  }
}

function recordFeishuWorkerCardActionMetrics(
  metrics: FeishuWebSocketWorkerMetrics,
  result: FeishuCardActionCallbackResult,
): void {
  if (result.eventStatus === "processed" && result.handled) {
    metrics.processedCount += 1;
    return;
  }
  if (result.eventStatus === "ignored") {
    metrics.ignoredCount += 1;
    return;
  }
  metrics.failedCount += 1;
}

function recordFeishuWorkerInboundMetrics(
  metrics: FeishuWebSocketWorkerMetrics,
  result: FeishuInboundProcessResult,
): void {
  if (result.dispatchStatus === "sent") {
    metrics.processedCount += 1;
    return;
  }
  if (result.dispatchStatus === "duplicate") {
    metrics.duplicateCount += 1;
    return;
  }
  if (result.dispatchStatus === "ignored") {
    metrics.ignoredCount += 1;
    if (result.noticeOutbox) {
      metrics.noticeOutboxCount += 1;
    }
    return;
  }
  metrics.failedCount += 1;
}

function recordFeishuWorkerOutboxMetrics(
  metrics: FeishuWebSocketWorkerMetrics,
  result: FeishuOutboxDrainResult,
): void {
  metrics.outboxProcessedCount += result.processedCount;
  metrics.outboxSentCount += result.sentCount;
  metrics.outboxFailedCount += result.failedCount;
  for (const error of result.errors) {
    metrics.errors.push({
      integrationId: error.integrationId,
      errorCode: "feishu.websocket_worker.outbox_drain_failed",
      errorMessage: error.errorMessage,
    });
  }
}

function updateFeishuWorkerHealth(input: {
  workspaceId: string;
  integrationId: string;
  status: ExternalIntegrationHealthStatus;
  lastError?: string;
}, dependencies?: FeishuWebSocketWorkerDependencies): void {
  try {
    const updateHealth = dependencies?.updateIntegrationHealth ?? updateExternalIntegrationHealthSync;
    updateHealth({
      workspaceId: input.workspaceId,
      integrationId: input.integrationId,
      lastHealthStatus: input.status,
      lastError: input.lastError,
    });
  } catch {
    // Health status is operational telemetry; event processing should continue.
  }
}

function normalizeFeishuWorkerError(
  integrationId: string,
  error: unknown,
): FeishuWebSocketWorkerError {
  const message = error instanceof Error ? error.message : String(error);
  return {
    integrationId,
    errorCode: resolveFeishuWorkerErrorCode(message),
    errorMessage: sanitizeFeishuWorkerErrorMessage(message),
  };
}

function resolveFeishuWorkerErrorCode(message: string): string {
  if (message.startsWith("feishu.")) {
    return message.split(/\s+/)[0] ?? "feishu.websocket_worker.failed";
  }
  if (/credential|secret|app id/i.test(message)) {
    return "feishu.websocket_worker.credentials_invalid";
  }
  if (/network|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|websocket|socket/i.test(message)) {
    return "feishu.websocket_worker.network_unreachable";
  }
  return "feishu.websocket_worker.failed";
}

function sanitizeFeishuWorkerErrorMessage(message: string): string {
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(app_secret|appSecret|tenant_access_token|tenantAccessToken|verification_token|verificationToken|encrypt_key|encryptKey)\b\s*[:=]\s*("[^"]+"|'[^']+'|[^,\s]+)/g, "$1=[redacted]")
    .slice(0, 1000);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
