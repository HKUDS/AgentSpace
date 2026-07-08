import type { IntegrationProviderDescriptor } from "../../core/index.ts";

export const SLACK_PROVIDER_ID = "slack";
export const SLACK_EVENT_CALLBACK_PATH = "/api/integrations/slack/events";
export const SLACK_INTERACTION_CALLBACK_PATH = "/api/integrations/slack/interactions";

export const SLACK_BOT_MESSAGE_SCOPES = [
  "app_mentions:read",
  "chat:write",
  "channels:read",
  "groups:read",
  "im:read",
  "im:history",
  "users:read",
] as const;

export const SLACK_SOCKET_MODE_SCOPES = [
  "connections:write",
] as const;

export const SLACK_FILE_UPLOAD_SCOPES = [
  "files:write",
] as const;

export const SLACK_DEFAULT_SCOPES = [
  ...SLACK_BOT_MESSAGE_SCOPES,
  ...SLACK_FILE_UPLOAD_SCOPES,
] as const;

export const SLACK_REQUIRED_EVENTS = [
  "app_mention",
  "message.im",
  "app_home_opened",
] as const;

export const SLACK_AGENT_VIEW_EVENTS = [
  "app_home_opened",
  "app_context_changed",
  "message.im",
] as const;

export const SLACK_AGENT_VIEW_SCOPES = [
  "assistant:write",
] as const;

export const SLACK_REQUIRED_CREDENTIAL_FIELDS = [
  "bot_token",
  "signing_secret",
] as const;

export const SLACK_SOCKET_MODE_CREDENTIAL_FIELDS = [
  "app_level_token",
] as const;

export const SLACK_PROVIDER_DESCRIPTOR: IntegrationProviderDescriptor = {
  provider: SLACK_PROVIDER_ID,
  displayName: "Slack",
  capabilities: ["message_transport"],
  supportedTransportModes: ["http_webhook", "websocket_worker"],
  defaultScopes: [...SLACK_DEFAULT_SCOPES],
  resourceTypes: [],
};

export const SLACK_TEXT_MESSAGE_MAX_CHARS = 40000;
export const SLACK_OUTBOX_MAX_ATTEMPTS = 10;
export const SLACK_SIGNATURE_VERSION = "v0";
export const SLACK_SIGNATURE_TOLERANCE_SECONDS = 300;
