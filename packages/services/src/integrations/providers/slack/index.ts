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
  SLACK_AGENT_VIEW_SCOPES,
  SLACK_BOT_MESSAGE_SCOPES,
  SLACK_DEFAULT_SCOPES,
  SLACK_EVENT_CALLBACK_PATH,
  SLACK_FILE_DOWNLOAD_SCOPES,
  SLACK_FILE_UPLOAD_SCOPES,
  SLACK_INTERACTION_CALLBACK_PATH,
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
  SLACK_INBOUND_ATTACHMENT_MAX_BYTES,
  SLACK_INBOUND_ATTACHMENT_TIMEOUT_MS,
  createSlackInboundAttachmentDownloader,
  downloadSlackInboundMessageAttachment,
  resolveSlackInboundAttachmentDescriptor,
  type SlackInboundAttachmentDescriptor,
  type SlackInboundAttachmentDownloadInput,
  type SlackInboundAttachmentDownloader,
} from "./attachments.ts";
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
  isSlackAgentContextChangedEvent,
  isSlackUrlVerificationPayload,
  resolveSlackAppHomeOpenedMessagesTabEvent,
  resolveSlackCallbackAppId,
  resolveSlackCallbackTeamId,
  resolveSlackEventId,
  resolveSlackEventReceivedAt,
  resolveSlackEventType,
  summarizeSlackAgentContextPayload,
  summarizeSlackInboundEventPayload,
  validateSlackCallbackContext,
  verifySlackRequestSignature,
  type SlackAgentContextEntitySummary,
  type SlackAgentContextSummary,
  type SlackAppHomeOpenedMessagesTabEvent,
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
  readSlackThreadBindingSync,
  recordSlackThreadBindingSync,
  resolveSlackThreadBindingKey,
  type ReadSlackThreadBindingInput,
  type RecordSlackThreadBindingInput,
} from "./thread-bindings.ts";
export {
  buildSlackApprovalBlockAction,
  buildSlackApprovalPayloadHash,
} from "./approval-actions.ts";
export {
  isSlackBlockActionsPayload,
  isSlackInteractionPayload,
  parseSlackApprovalBlockActionPayload,
  processSlackBlockActionCallback,
  type SlackApprovalBlockAction,
  type SlackBlockActionCallbackDependencies,
  type SlackBlockActionCallbackResult,
} from "./interactions.ts";
export {
  buildSlackAgentStatusBlocks,
  buildSlackAgentStatusCardOutboundMessage,
  buildSlackAppHomeOpenedWelcomeOutboundMessage,
  buildSlackAssistantSuggestedPromptsOutboundMessage,
  buildSlackBlockKitOutboundMessage,
  buildSlackFileUploadOutboundMessage,
  buildSlackTextOutboundMessage,
  computeSlackOutboxNextAttemptAt,
  drainSlackOutboxMessages,
  processSlackOutboxMessage,
  queueSlackAppHomeOpenedWelcomeOutboxSync,
  queueSlackAgentStatusCardOutboxSync,
  queueSlackAssistantSuggestedPromptsOutboxSync,
  queueSlackChannelReplyOutboxSync,
  queueSlackOutboundMessageSync,
  resolveSlackReplyTargetExternalMessageId,
  sendSlackChatPostMessage,
  sendSlackFileUploadExternal,
  sendSlackAssistantSuggestedPrompts,
  selectSlackOutboundChannelBindingForReply,
  type SlackAgentStatusCardStatus,
  type SlackApiMethodResult,
  type SlackApiPostMessageResult,
  type SlackAppHomeOpenedWelcomeQueueResult,
  type SlackAssistantSuggestedPrompt,
  type SlackAssistantSuggestedPromptsPayload,
  type SlackApprovalBlockActionPayload,
  type SlackBlockKitOutboundPayload,
  type SlackChatPostMessagePayload,
  type SlackFileUploadItem,
  type SlackFileUploadOutboundPayload,
  type SlackApiFileUploadResult,
  type SlackOutboxDrainResult,
  type SlackOutboxProcessResult,
  type SlackOutboundApiPayload,
  type SlackTextOutboundPayload,
} from "./outbound.ts";
export {
  buildSlackAgentViewAppManifest,
  buildSlackReadinessReport,
  buildSlackHealthSnapshotConfigJson,
  buildSlackSmokeEnvTemplateReport,
  buildSlackSmokePlanReport,
  checkSlackIntegrationHealth,
  type SlackHealthCheckResult,
  type SlackHealthCheckItem,
  type SlackAppManifest,
  type SlackAppManifestSuggestedPrompt,
  type SlackReadinessIntegrationItem,
  type SlackReadinessReport,
  type SlackReadinessRequirement,
  type SlackSmokeEnvTemplateReport,
  type SlackSmokePlanReport,
  type SlackSocketModeHealthResult,
} from "./health.ts";
export {
  buildSlackEvidenceReport,
  type SlackEvidenceIntegrationItem,
  type SlackEvidenceReport,
  type SlackEvidenceRequirement,
} from "./evidence.ts";
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
