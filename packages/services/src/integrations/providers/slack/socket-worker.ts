import {
  listExternalIntegrationsSync,
  updateExternalIntegrationHealthSync,
  type ExternalIntegrationHealthStatus,
  type ExternalIntegrationRecord,
} from "@agent-space/db";
import type { IntegrationRuntimeContext } from "../../core/index.ts";
import { createSlackInboundAttachmentDownloader } from "./attachments.ts";
import { SLACK_PROVIDER_ID } from "./constants.ts";
import { readSlackIntegrationCredentials, type SlackPlainCredentials } from "./credentials.ts";
import {
  asRecord,
  isSlackUrlVerificationPayload,
  validateSlackCallbackContext,
} from "./events.ts";
import {
  isSlackBlockActionsPayload,
  isSlackInteractionPayload,
  processSlackBlockActionCallback,
  type SlackBlockActionCallbackResult,
} from "./interactions.ts";
import {
  processSlackInboundEvent,
  type SlackInboundProcessResult,
} from "./inbound.ts";
import { drainSlackOutboxMessages, type SlackOutboxDrainResult } from "./outbound.ts";

export interface SlackSocketModeWorkerSummary {
  workspaceId: string;
  provider: typeof SLACK_PROVIDER_ID;
  mode: "websocket_worker";
  integrationCount: number;
  startedCount: number;
  skippedCount: number;
  dryRun: boolean;
  integrations: SlackSocketModeWorkerIntegrationSummary[];
  errors: SlackSocketModeWorkerError[];
}

export interface SlackSocketModeWorkerIntegrationSummary {
  integrationId: string;
  displayName: string;
  status: "ready" | "started" | "skipped" | "failed";
  reasonCode?: string;
  healthStatus?: ExternalIntegrationHealthStatus;
}

export interface SlackSocketModeWorkerError {
  integrationId: string;
  errorCode: string;
  errorMessage: string;
}

export interface SlackSocketModeWorkerMetrics {
  connectionReadyCount: number;
  connectionErrorCount: number;
  receivedCount: number;
  ackCount: number;
  ackFailedCount: number;
  processedCount: number;
  ignoredCount: number;
  failedCount: number;
  duplicateCount: number;
  outboxProcessedCount: number;
  outboxSentCount: number;
  outboxFailedCount: number;
  errors: SlackSocketModeWorkerError[];
}

export interface SlackSocketModeWorkerHandle {
  summary: SlackSocketModeWorkerSummary;
  metrics: SlackSocketModeWorkerMetrics;
  close(): void;
  getConnectionStatuses(): Array<{
    integrationId: string;
    status?: SlackSocketModeWorkerConnectionStatus;
  }>;
}

export interface SlackSocketModeWorkerConnectionStatus {
  state: "connecting" | "open" | "closing" | "closed" | "unknown";
  url?: string;
}

export interface SlackSocketModeWorkerSession {
  close(): void;
  getConnectionStatus?(): SlackSocketModeWorkerConnectionStatus;
}

export interface SlackSocketModeEnvelope {
  envelope_id?: string;
  type?: string;
  accepts_response_payload?: boolean;
  payload?: unknown;
  retry_attempt?: number;
  retry_reason?: string;
}

export interface SlackSocketModeWorkerSessionFactoryInput {
  appLevelToken: string;
  integrationId: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  onReady(): void;
  onError(error: unknown): void;
  onEnvelope(
    envelope: SlackSocketModeEnvelope,
    ack: (payload?: Record<string, unknown>) => Promise<void>,
  ): Promise<void>;
}

export type SlackSocketModeWorkerSessionFactory = (
  input: SlackSocketModeWorkerSessionFactoryInput
) => Promise<SlackSocketModeWorkerSession>;

export interface SlackSocketModeWorkerDependencies {
  listIntegrations?: typeof listExternalIntegrationsSync;
  readIntegrationCredentials?: (integration: ExternalIntegrationRecord) => SlackPlainCredentials;
  updateIntegrationHealth?: typeof updateExternalIntegrationHealthSync;
}

export interface SlackSocketModeEventProcessorDependencies {
  drainOutboxMessages?: typeof drainSlackOutboxMessages;
  processInboundEvent?: typeof processSlackInboundEvent;
  processBlockActionCallback?: typeof processSlackBlockActionCallback;
}

export async function startSlackSocketModeWorker(input: {
  workspaceId: string;
  integrationId?: string;
  lockedBy: string;
  dryRun?: boolean;
  baseUrl?: string;
  feishuBaseUrl?: string;
  drainOutboxLimit?: number;
  includeWebhookIntegrations?: boolean;
  eventProcessorDependencies?: SlackSocketModeEventProcessorDependencies;
  workerDependencies?: SlackSocketModeWorkerDependencies;
  sessionFactory?: SlackSocketModeWorkerSessionFactory;
  fetchImpl?: typeof fetch;
}): Promise<SlackSocketModeWorkerHandle> {
  const workerDependencies = input.workerDependencies ?? {};
  const integrations = resolveSlackSocketModeWorkerIntegrations(input, workerDependencies);
  const summaryItems: SlackSocketModeWorkerIntegrationSummary[] = [];
  const errors: SlackSocketModeWorkerError[] = [];
  const sessions: Array<{
    integrationId: string;
    session: SlackSocketModeWorkerSession;
  }> = [];
  const metrics: SlackSocketModeWorkerMetrics = {
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

  for (const integration of integrations) {
    if (!input.includeWebhookIntegrations && integration.transportMode !== "websocket_worker") {
      summaryItems.push({
        integrationId: integration.id,
        displayName: integration.displayName,
        status: "skipped",
        reasonCode: "slack.socket_worker.transport_mode_not_socket",
      });
      continue;
    }

    let credentials: SlackPlainCredentials;
    try {
      const readCredentials = workerDependencies.readIntegrationCredentials ?? readSlackIntegrationCredentials;
      credentials = readCredentials(integration);
      if (!credentials.appLevelToken?.trim()) {
        throw new Error("slack.socket_worker.app_level_token_missing");
      }
    } catch (error) {
      const workerError = normalizeSlackSocketWorkerError(integration.id, error);
      errors.push(workerError);
      metrics.errors.push(workerError);
      summaryItems.push({
        integrationId: integration.id,
        displayName: integration.displayName,
        status: "failed",
        reasonCode: workerError.errorCode,
        healthStatus: "degraded",
      });
      updateSlackSocketWorkerHealth({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        status: "degraded",
        lastError: workerError.errorMessage,
      }, workerDependencies);
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
      const context: IntegrationRuntimeContext = {
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        provider: SLACK_PROVIDER_ID,
      };
      const sessionFactory = input.sessionFactory ?? createSlackSocketModeWebSocketSession;
      const session = await sessionFactory({
        appLevelToken: credentials.appLevelToken,
        integrationId: integration.id,
        baseUrl: input.baseUrl,
        fetchImpl: input.fetchImpl,
        onReady() {
          metrics.connectionReadyCount += 1;
          updateSlackSocketWorkerHealth({
            workspaceId: input.workspaceId,
            integrationId: integration.id,
            status: "healthy",
          }, workerDependencies);
        },
        onError(error) {
          const workerError = normalizeSlackSocketWorkerError(integration.id, error);
          metrics.connectionErrorCount += 1;
          metrics.errors.push(workerError);
          updateSlackSocketWorkerHealth({
            workspaceId: input.workspaceId,
            integrationId: integration.id,
            status: "degraded",
            lastError: workerError.errorMessage,
          }, workerDependencies);
        },
        async onEnvelope(envelope, ack) {
          await processSlackSocketModeEnvelope({
            context,
            integration,
            envelope,
            ack,
            metrics,
            lockedBy: input.lockedBy,
            baseUrl: input.baseUrl,
            feishuBaseUrl: input.feishuBaseUrl,
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
      const workerError = normalizeSlackSocketWorkerError(integration.id, error);
      errors.push(workerError);
      metrics.errors.push(workerError);
      summaryItems.push({
        integrationId: integration.id,
        displayName: integration.displayName,
        status: "failed",
        reasonCode: workerError.errorCode,
        healthStatus: "degraded",
      });
      updateSlackSocketWorkerHealth({
        workspaceId: input.workspaceId,
        integrationId: integration.id,
        status: "degraded",
        lastError: workerError.errorMessage,
      }, workerDependencies);
    }
  }

  const summary: SlackSocketModeWorkerSummary = {
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
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

export async function processSlackSocketModeEnvelope(input: {
  context: IntegrationRuntimeContext;
  integration: ExternalIntegrationRecord;
  envelope: SlackSocketModeEnvelope;
  ack: (payload?: Record<string, unknown>) => Promise<void>;
  metrics: SlackSocketModeWorkerMetrics;
  lockedBy: string;
  baseUrl?: string;
  feishuBaseUrl?: string;
  drainOutboxLimit?: number;
  dependencies?: SlackSocketModeEventProcessorDependencies;
}): Promise<void> {
  input.metrics.receivedCount += 1;

  try {
    await input.ack();
    input.metrics.ackCount += 1;
  } catch (error) {
    input.metrics.ackFailedCount += 1;
    input.metrics.errors.push(normalizeSlackSocketWorkerError(input.integration.id, error));
  }

  try {
    const payload = asRecord(input.envelope.payload);
    if (!payload) {
      input.metrics.ignoredCount += 1;
      return;
    }
    if (isSlackUrlVerificationPayload(payload)) {
      input.metrics.ignoredCount += 1;
      return;
    }

    const contextValidation = validateSlackCallbackContext({
      payload,
      expectedAppId: input.integration.appId,
      expectedTeamId: input.integration.tenantKey,
    });
    if (!contextValidation.ok) {
      input.metrics.failedCount += 1;
      input.metrics.errors.push({
        integrationId: input.integration.id,
        errorCode: contextValidation.reasonCode,
        errorMessage: contextValidation.errorMessage,
      });
      return;
    }

    if (isSlackBlockActionsPayload(payload)) {
      const processBlockActionCallback = input.dependencies?.processBlockActionCallback
        ?? processSlackBlockActionCallback;
      const result = await processBlockActionCallback({
        context: input.context,
        payload,
        feishuBaseUrl: input.feishuBaseUrl,
      });
      recordSlackSocketWorkerInteractionMetrics(input.metrics, result);
      await drainSlackSocketWorkerOutbox(input);
      return;
    }
    if (input.envelope.type === "interactive" || isSlackInteractionPayload(payload)) {
      input.metrics.ignoredCount += 1;
      return;
    }

    const processInboundEvent = input.dependencies?.processInboundEvent ?? processSlackInboundEvent;
    const result = await processInboundEvent({
      context: input.context,
      payload,
      integration: input.integration,
      ...(input.dependencies?.processInboundEvent ? {} : {
        attachmentDownloader: createSlackInboundAttachmentDownloader({
          workspaceId: input.context.workspaceId,
          botToken: readSlackIntegrationCredentials(input.integration).botToken,
          baseUrl: input.baseUrl,
        }),
      }),
    });
    recordSlackSocketWorkerInboundMetrics(input.metrics, result);
    await drainSlackSocketWorkerOutbox(input);
  } catch (error) {
    input.metrics.failedCount += 1;
    input.metrics.errors.push(normalizeSlackSocketWorkerError(input.integration.id, error));
  }
}

export async function openSlackSocketModeConnection(input: {
  appLevelToken: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  url: string;
}> {
  const appLevelToken = input.appLevelToken.trim();
  if (!appLevelToken) {
    throw new Error("slack.socket_worker.app_level_token_missing");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${input.baseUrl ?? "https://slack.com/api"}/apps.connections.open`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appLevelToken}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "",
  });
  const data = await response.json() as Record<string, unknown>;
  if (response.ok && data.ok === true && typeof data.url === "string" && data.url.trim()) {
    return { url: data.url.trim() };
  }
  const errorMessage = typeof data.error === "string"
    ? data.error
    : `Slack apps.connections.open failed with HTTP ${response.status}.`;
  throw new Error(sanitizeSlackSocketWorkerErrorMessage(errorMessage, [appLevelToken]));
}

async function createSlackSocketModeWebSocketSession(
  input: SlackSocketModeWorkerSessionFactoryInput,
): Promise<SlackSocketModeWorkerSession> {
  const connection = await openSlackSocketModeConnection({
    appLevelToken: input.appLevelToken,
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
  });
  const WebSocketConstructor = readGlobalWebSocketConstructor();
  const socket = new WebSocketConstructor(connection.url);
  let locallyClosed = false;

  socket.addEventListener("open", () => {
    input.onReady();
  });
  socket.addEventListener("error", (event) => {
    input.onError(new Error(`slack.socket_worker.websocket_error:${readEventMessage(event)}`));
  });
  socket.addEventListener("close", (event) => {
    if (locallyClosed) {
      return;
    }
    input.onError(new Error(`slack.socket_worker.connection_closed:${readCloseCode(event)}`));
  });
  socket.addEventListener("message", (event) => {
    void handleSlackSocketModeMessage({
      event,
      socket,
      onEnvelope: input.onEnvelope,
      onError: input.onError,
    });
  });

  return {
    close() {
      locallyClosed = true;
      socket.close();
    },
    getConnectionStatus() {
      return {
        state: readSocketReadyState(socket.readyState),
        url: connection.url,
      };
    },
  };
}

async function handleSlackSocketModeMessage(input: {
  event: MessageEvent;
  socket: Pick<WebSocket, "send">;
  onEnvelope: SlackSocketModeWorkerSessionFactoryInput["onEnvelope"];
  onError(error: unknown): void;
}): Promise<void> {
  try {
    const envelope = parseSlackSocketModeEnvelope(await readWebSocketMessageData(input.event.data));
    await input.onEnvelope(envelope, async (payload) => {
      if (!envelope.envelope_id?.trim()) {
        throw new Error("slack.socket_worker.envelope_id_missing");
      }
      input.socket.send(JSON.stringify({
        envelope_id: envelope.envelope_id,
        ...(payload ? { payload } : {}),
      }));
    });
  } catch (error) {
    input.onError(error);
  }
}

function resolveSlackSocketModeWorkerIntegrations(input: {
  workspaceId: string;
  integrationId?: string;
}, dependencies?: SlackSocketModeWorkerDependencies): ExternalIntegrationRecord[] {
  const listIntegrations = dependencies?.listIntegrations ?? listExternalIntegrationsSync;
  return listIntegrations({
    workspaceId: input.workspaceId,
    provider: SLACK_PROVIDER_ID,
  }).filter((integration) =>
    integration.status === "active" &&
    (!input.integrationId || integration.id === input.integrationId));
}

function recordSlackSocketWorkerInboundMetrics(
  metrics: SlackSocketModeWorkerMetrics,
  result: SlackInboundProcessResult,
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
    return;
  }
  metrics.failedCount += 1;
}

function recordSlackSocketWorkerInteractionMetrics(
  metrics: SlackSocketModeWorkerMetrics,
  result: SlackBlockActionCallbackResult,
): void {
  if (result.eventStatus === "processed") {
    metrics.processedCount += 1;
    return;
  }
  if (result.eventStatus === "ignored") {
    metrics.ignoredCount += 1;
    return;
  }
  metrics.failedCount += 1;
}

async function drainSlackSocketWorkerOutbox(input: {
  context: IntegrationRuntimeContext;
  integration: ExternalIntegrationRecord;
  lockedBy: string;
  baseUrl?: string;
  drainOutboxLimit?: number;
  dependencies?: SlackSocketModeEventProcessorDependencies;
  metrics: SlackSocketModeWorkerMetrics;
}): Promise<void> {
  const drainOutboxMessages = input.dependencies?.drainOutboxMessages ?? drainSlackOutboxMessages;
  const outboxDrain = await drainOutboxMessages({
    workspaceId: input.context.workspaceId,
    integrationId: input.integration.id,
    lockedBy: input.lockedBy,
    limit: input.drainOutboxLimit ?? 5,
    baseUrl: input.baseUrl,
  });
  recordSlackSocketWorkerOutboxMetrics(input.metrics, outboxDrain);
}

function recordSlackSocketWorkerOutboxMetrics(
  metrics: SlackSocketModeWorkerMetrics,
  result: SlackOutboxDrainResult,
): void {
  metrics.outboxProcessedCount += result.processedCount;
  metrics.outboxSentCount += result.sentCount;
  metrics.outboxFailedCount += result.failedCount;
  for (const error of result.errors) {
    metrics.errors.push({
      integrationId: error.integrationId,
      errorCode: "slack.socket_worker.outbox_drain_failed",
      errorMessage: error.errorMessage,
    });
  }
}

function updateSlackSocketWorkerHealth(input: {
  workspaceId: string;
  integrationId: string;
  status: ExternalIntegrationHealthStatus;
  lastError?: string;
}, dependencies?: SlackSocketModeWorkerDependencies): void {
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

function normalizeSlackSocketWorkerError(
  integrationId: string,
  error: unknown,
): SlackSocketModeWorkerError {
  const message = error instanceof Error ? error.message : String(error);
  return {
    integrationId,
    errorCode: resolveSlackSocketWorkerErrorCode(message),
    errorMessage: sanitizeSlackSocketWorkerErrorMessage(message, []),
  };
}

function resolveSlackSocketWorkerErrorCode(message: string): string {
  if (message.startsWith("slack.")) {
    return message.split(/\s+/)[0] ?? "slack.socket_worker.failed";
  }
  if (/credential|token|auth|app level/i.test(message)) {
    return "slack.socket_worker.credentials_invalid";
  }
  if (/network|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|websocket|socket/i.test(message)) {
    return "slack.socket_worker.network_unreachable";
  }
  return "slack.socket_worker.failed";
}

function sanitizeSlackSocketWorkerErrorMessage(
  message: string,
  sensitiveValues: Array<string | undefined>,
): string {
  let sanitized = message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(xoxb|xapp)-[A-Za-z0-9-]+/gi, "[redacted]")
    .replace(/\b(botToken|appLevelToken|signingSecret|token)\b\s*[:=]\s*("[^"]+"|'[^']+'|[^,\s]+)/gi, "$1=[redacted]");
  for (const value of sensitiveValues
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item))
    .sort((left, right) => right.length - left.length)) {
    sanitized = sanitized.split(value).join("[redacted]");
  }
  return sanitized.slice(0, 1000);
}

function parseSlackSocketModeEnvelope(value: string): SlackSocketModeEnvelope {
  const parsed = JSON.parse(value) as unknown;
  if (!asRecord(parsed)) {
    throw new Error("slack.socket_worker.invalid_envelope");
  }
  return parsed as SlackSocketModeEnvelope;
}

async function readWebSocketMessageData(value: unknown): Promise<string> {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value).toString("utf8");
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("utf8");
  }
  if (value instanceof Blob) {
    return value.text();
  }
  return String(value);
}

function readGlobalWebSocketConstructor(): typeof WebSocket {
  if (typeof WebSocket !== "undefined") {
    return WebSocket;
  }
  throw new Error("slack.socket_worker.websocket_unavailable");
}

function readSocketReadyState(value: number): SlackSocketModeWorkerConnectionStatus["state"] {
  if (value === 0) {
    return "connecting";
  }
  if (value === 1) {
    return "open";
  }
  if (value === 2) {
    return "closing";
  }
  if (value === 3) {
    return "closed";
  }
  return "unknown";
}

function readEventMessage(event: Event): string {
  return "message" in event && typeof event.message === "string" ? event.message : event.type;
}

function readCloseCode(event: CloseEvent): string {
  return Number.isFinite(event.code) ? String(event.code) : "unknown";
}
