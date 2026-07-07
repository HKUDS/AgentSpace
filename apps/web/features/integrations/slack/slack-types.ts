import type {
  ExternalBindingStatus,
  ExternalIntegrationEventStatus,
  ExternalIntegrationHealthStatus,
  ExternalIntegrationStatus,
  ExternalIntegrationTransportMode,
  ExternalMessageOutboxStatus,
} from "@agent-space/db";

export interface SlackAvailableChannelItem {
  name: string;
  kind?: string;
}

export interface SlackAvailableUserItem {
  userId: string;
  displayName: string;
  primaryEmail?: string;
  role: string;
}

export interface SlackUserBindingSettingsItem {
  id: string;
  integrationId: string;
  userId: string;
  externalUserReference: string;
  externalUserIdRedacted: true;
  displayName?: string;
  status: ExternalBindingStatus;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
}

export interface SlackChannelBindingSettingsItem {
  id: string;
  integrationId: string;
  channelName: string;
  externalChannelReference: string;
  externalChannelIdRedacted: true;
  externalChannelType?: string;
  externalChannelName?: string;
  status: ExternalBindingStatus;
  syncMode: "mirror" | "ingest_only" | "send_only";
  createdAt: string;
  updatedAt: string;
}

export interface SlackOutboxSettingsItem {
  id: string;
  integrationId: string;
  channelBindingId?: string;
  targetExternalChannelReference: string;
  targetExternalChannelIdRedacted: true;
  targetExternalThreadReference?: string;
  targetExternalThreadIdRedacted?: true;
  agentSpaceMessageId?: string;
  status: ExternalMessageOutboxStatus;
  attempts: number;
  nextAttemptAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SlackIntegrationEventSettingsItem {
  id: string;
  integrationId?: string;
  externalEventReference: string;
  externalEventIdRedacted: true;
  eventType: string;
  status: ExternalIntegrationEventStatus;
  errorMessage?: string;
  bindingSuggestion?: SlackInboundBindingSuggestion;
  receivedAt: string;
  processedAt?: string;
}

export type SlackInboundBindingSuggestion =
  | {
    kind: "channel";
    externalChannelReference: string;
    externalChannelIdRedacted: true;
  }
  | {
    kind: "user";
    externalUserReference: string;
    externalUserIdRedacted: true;
  };

export interface SlackIntegrationSetupCheck {
  key: "credentials" | "callback_or_socket" | "health" | "channel_binding" | "user_binding" | "outbox";
  status: "ready" | "missing" | "attention";
  current: number | string;
  required?: number | string;
}

export interface SlackIntegrationSetupGuide {
  requiredCredentialFields: string[];
  requiredEvents: string[];
  requiredScopes: string[];
  eventCallbackPath: string;
  developerConsoleUrl: string;
  checks: SlackIntegrationSetupCheck[];
  commands: {
    healthCheck: string;
    bindChannel: string;
    bindUser: string;
    outboxDrain: string;
  };
}

export interface SlackIntegrationSettingsItem {
  id: string;
  displayName: string;
  status: ExternalIntegrationStatus;
  transportMode: ExternalIntegrationTransportMode;
  agentId?: string;
  appId?: string;
  teamId?: string;
  callbackUrl: string;
  createdAt: string;
  updatedAt: string;
  lastHealthStatus?: ExternalIntegrationHealthStatus;
  lastHealthCheckedAt?: string;
  lastError?: string;
  hasBotToken: boolean;
  hasSigningSecret: boolean;
  hasAppLevelToken: boolean;
  channelBindingCount: number;
  userBindingCount: number;
  outboxFailureCount: number;
  userBindings: SlackUserBindingSettingsItem[];
  channelBindings: SlackChannelBindingSettingsItem[];
  recentOutboxFailures: SlackOutboxSettingsItem[];
  recentInboundEvents: SlackIntegrationEventSettingsItem[];
  setupGuide?: SlackIntegrationSetupGuide;
}

export interface SlackIntegrationCreationGuide {
  requiredCredentialFields: string[];
  requiredEvents: string[];
  requiredScopes: string[];
  socketModeCredentialFields: string[];
  socketModeScopes: string[];
  eventCallbackPath: string;
  publicAppUrlStatus: "configured" | "missing";
  publicAppUrl?: string;
  callbackUrlTemplate: string;
  developerConsoleUrl: string;
  commands: {
    create: string;
    healthCheck: string;
    bindChannel: string;
    bindUser: string;
    outboxDrain: string;
  };
}

export interface CreateSlackIntegrationInput {
  displayName: string;
  transportMode: ExternalIntegrationTransportMode;
  appId: string;
  teamId?: string;
  botToken: string;
  signingSecret: string;
  appLevelToken?: string;
}

export interface CreateSlackChannelBindingInput {
  integrationId: string;
  channelName: string;
  externalChannelId: string;
  externalChannelType?: string;
  externalChannelName?: string;
}

export interface CreateSlackUserBindingInput {
  integrationId: string;
  userId: string;
  externalUserId: string;
  displayName?: string;
}

export interface UpdateSlackBindingStatusInput {
  bindingId: string;
}

export interface DeletedSlackIntegrationResult {
  integrationId: string;
}
