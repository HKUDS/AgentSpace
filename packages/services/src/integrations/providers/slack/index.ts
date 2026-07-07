import {
  registerIntegrationProviderAdapter,
  type IntegrationProviderAdapter,
} from "../../core/index.ts";
import { slackIntegrationProviderAdapter } from "./adapter.ts";

export {
  slackIntegrationProviderAdapter,
} from "./adapter.ts";
export {
  SLACK_AGENT_VIEW_EVENTS,
  SLACK_BOT_MESSAGE_SCOPES,
  SLACK_DEFAULT_SCOPES,
  SLACK_EVENT_CALLBACK_PATH,
  SLACK_OUTBOX_MAX_ATTEMPTS,
  SLACK_PROVIDER_DESCRIPTOR,
  SLACK_PROVIDER_ID,
  SLACK_REQUIRED_CREDENTIAL_FIELDS,
  SLACK_REQUIRED_EVENTS,
  SLACK_SIGNATURE_TOLERANCE_SECONDS,
  SLACK_SIGNATURE_VERSION,
  SLACK_SOCKET_MODE_CREDENTIAL_FIELDS,
  SLACK_SOCKET_MODE_SCOPES,
  SLACK_TEXT_MESSAGE_MAX_CHARS,
} from "./constants.ts";
export {
  buildEncryptedSlackCredentials,
  readSlackIntegrationCredentials,
  summarizeSlackStoredCredentials,
  type SlackPlainCredentials,
} from "./credentials.ts";
export {
  createSlackAgentBotBindingSync,
  disableSlackAgentBotBindingSync,
  isSlackAgentBotBinding,
  listSlackAgentBotBindingsSync,
  readSlackAgentBotBindingByAgentSync,
  resolveSlackAgentBotBindingSync,
  type CreateSlackAgentBotBindingInput,
  type DisableSlackAgentBotBindingInput,
  type SlackAgentBotBinding,
} from "./agent-bot-bindings.ts";
export {
  asRecord,
  asString,
  buildSlackReference,
  buildSlackUrlVerificationResponse,
  isSlackUrlVerificationPayload,
  resolveSlackCallbackAppId,
  resolveSlackCallbackTeamId,
  resolveSlackEventId,
  resolveSlackEventReceivedAt,
  resolveSlackEventType,
  summarizeSlackInboundEventPayload,
  validateSlackCallbackContext,
  verifySlackRequestSignature,
  type SlackCallbackContextValidationResult,
  type SlackEventCallbackPayload,
  type SlackUrlVerificationPayload,
} from "./events.ts";
export {
  cleanSlackMessageText,
  ensureSlackAgentMentionText,
  normalizeSlackInboundMessage,
  type NormalizeSlackInboundMessageInput,
} from "./normalize-message.ts";
export {
  processSlackInboundEvent,
  processSlackInboundEventSync,
  type ProcessSlackInboundEventInput,
  type SlackInboundProcessResult,
} from "./inbound.ts";
export {
  buildSlackTextOutboundMessage,
  computeSlackOutboxNextAttemptAt,
  drainSlackOutboxMessages,
  processSlackOutboxMessage,
  sendSlackChatPostMessage,
  type SlackApiPostMessageResult,
  type SlackOutboxDrainResult,
  type SlackOutboxProcessResult,
  type SlackTextOutboundPayload,
} from "./outbound.ts";
export {
  buildSlackReadinessReport,
  buildSlackHealthSnapshotConfigJson,
  buildSlackSmokeEnvTemplateReport,
  buildSlackSmokePlanReport,
  checkSlackIntegrationHealth,
  type SlackHealthCheckResult,
  type SlackHealthCheckItem,
  type SlackReadinessIntegrationItem,
  type SlackReadinessReport,
  type SlackReadinessRequirement,
  type SlackSmokeEnvTemplateReport,
  type SlackSmokePlanReport,
  type SlackSocketModeHealthResult,
} from "./health.ts";
export {
  openSlackSocketModeConnection,
  processSlackSocketModeEnvelope,
  startSlackSocketModeWorker,
  type SlackSocketModeEnvelope,
  type SlackSocketModeWorkerHandle,
  type SlackSocketModeWorkerMetrics,
  type SlackSocketModeWorkerSummary,
} from "./socket-worker.ts";

export function registerSlackIntegrationProvider(): IntegrationProviderAdapter {
  registerIntegrationProviderAdapter(slackIntegrationProviderAdapter);
  return slackIntegrationProviderAdapter;
}
