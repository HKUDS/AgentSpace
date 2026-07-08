import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExternalChannelBindingRecord,
  ExternalIntegrationEventRecord,
  ExternalIntegrationRecord,
  ExternalMessageMappingRecord,
  ExternalMessageOutboxRecord,
  ExternalUserBindingRecord,
} from "@agent-space/db";
import { SLACK_PROVIDER_ID } from "../constants.ts";
import { buildSlackEvidenceReport } from "../evidence.ts";

test("builds strict Slack evidence reports without raw external ids", () => {
  const integration = makeIntegration();
  const report = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "all",
    dependencies: {
      listIntegrations: () => [integration],
      listChannelBindings: () => [makeChannelBinding()],
      listUserBindings: () => [makeUserBinding()],
      listEvents: () => [
        makeEvent({
          externalEventId: "EvMessage",
          eventType: "event_callback.message",
          status: "processed",
          payloadJson: {
            hasAgentContext: true,
            agentContext: {
              entities: [{ type: "slack#/types/channel_id", valueRef: "ref_safechan" }],
            },
          },
        }),
        makeEvent({
          externalEventId: "EvApproval",
          eventType: "block_actions",
          status: "processed",
          payloadJson: {
            approvalBlockAction: {
              provider: "slack",
              approvalId: "approval-1",
              decision: "approved",
              rawActionPayloadStored: false,
            },
          },
        }),
      ],
      listMessageMappings: () => [
        makeMapping({
          direction: "inbound",
          externalMessageId: "1783400000.000100",
          metadataJson: {
            provider: "slack",
            agentContext: {
              entities: [{ type: "slack#/types/channel_id", valueRef: "ref_safechan" }],
            },
          },
        }),
        makeMapping({
          direction: "outbound",
          externalMessageId: "1783400002.000100",
          externalThreadId: "1783400000.000100",
          metadataJson: {
            provider: "slack",
            externalChatReference: "ref_safechat",
          },
        }),
        makeMapping({
          direction: "outbound",
          externalMessageId: "slack-app-home-welcome-refsafe",
          metadataJson: {
            provider: "slack",
            mappingSource: "app_home_opened_welcome",
            externalChatReference: "ref_safechat",
            externalUserReference: "ref_safeuser",
          },
        }),
      ],
      listOutbox: () => [
        makeOutbox({
          status: "sent",
          targetExternalChatId: "C_SECRET",
          metadataJson: {
            provider: "slack",
            outboxSource: "agent_reply",
            externalChatReference: "ref_safechat",
          },
        }),
        makeOutbox({
          status: "sent",
          targetExternalChatId: "D_SECRET",
          metadataJson: {
            provider: "slack",
            outboxSource: "app_home_opened_welcome",
            externalChatReference: "ref_safeim",
            externalUserReference: "ref_safeuser",
          },
        }),
        makeOutbox({
          status: "sent",
          targetExternalChatId: "D_SECRET",
          metadataJson: {
            provider: "slack",
            outboxSource: "assistant_suggested_prompts",
            assistantMethod: "assistant.threads.setSuggestedPrompts",
            externalUserReference: "ref_safeuser",
          },
        }),
        makeOutbox({
          status: "sent",
          targetExternalChatId: "C_SECRET",
          metadataJson: {
            provider: "slack",
            outboxSource: "agent_status_card",
            externalChatReference: "ref_safechat",
          },
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, true);
  assert.equal(report.summary.messageSatisfiedCount, 1);
  assert.equal(report.summary.nativeSatisfiedCount, 1);
  assert.equal(report.summary.approvalSatisfiedCount, 1);
  assert.deepEqual(report.integrations[0]?.blockers, []);
  assert.doesNotMatch(JSON.stringify(report), /A_SECRET|T_SECRET|C_SECRET|D_SECRET|U_SECRET|EvMessage|EvApproval|1783400000/);
});

test("Slack evidence reports actionable blockers when message smoke evidence is missing", () => {
  const report = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "message",
    dependencies: {
      listIntegrations: () => [makeIntegration()],
      listChannelBindings: () => [],
      listUserBindings: () => [],
      listEvents: () => [],
      listMessageMappings: () => [],
      listOutbox: () => [],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.integrations[0]?.requiredSatisfied, false);
  assert.ok(report.integrations[0]?.blockers.includes("channel_binding_missing"));
  assert.ok(report.integrations[0]?.blockers.includes("processed_inbound_event_evidence_missing"));
});

function makeIntegration(overrides: Partial<ExternalIntegrationRecord> = {}): ExternalIntegrationRecord {
  return {
    id: "slack-1",
    workspaceId: "workspace-1",
    provider: SLACK_PROVIDER_ID,
    displayName: "Slack Atlas",
    status: "active",
    transportMode: "websocket_worker",
    agentId: "Atlas",
    appId: "A_SECRET",
    tenantKey: "T_SECRET",
    encryptedCredentialsJson: "{}",
    configJson: "{}",
    capabilitiesJson: "{}",
    scopesJson: "[]",
    lastHealthStatus: "healthy",
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
  };
}

function makeChannelBinding(overrides: Partial<ExternalChannelBindingRecord> = {}): ExternalChannelBindingRecord {
  return {
    id: "channel-binding-1",
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    channelName: "general",
    externalChatId: "C_SECRET",
    externalChatType: "channel",
    status: "active",
    syncMode: "mirror",
    metadataJson: "{}",
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
  };
}

function makeUserBinding(overrides: Partial<ExternalUserBindingRecord> = {}): ExternalUserBindingRecord {
  return {
    id: "user-binding-1",
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    userId: "user-1",
    externalUserId: "U_SECRET",
    status: "active",
    metadataJson: "{}",
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<ExternalIntegrationEventRecord> = {}): ExternalIntegrationEventRecord {
  return {
    id: "event-1",
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    provider: SLACK_PROVIDER_ID,
    externalEventId: "EvSecret",
    eventType: "event_callback.message",
    status: "processed",
    payloadJson: "{}",
    receivedAt: "2026-07-08T00:00:00.000Z",
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
    payloadJson: JSON.stringify(overrides.payloadJson ?? {}),
  } as ExternalIntegrationEventRecord;
}

function makeMapping(overrides: Partial<ExternalMessageMappingRecord> = {}): ExternalMessageMappingRecord {
  return {
    id: "mapping-1",
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    channelBindingId: "channel-binding-1",
    direction: "inbound",
    externalMessageId: "1783400000.000100",
    metadataJson: "{}",
    createdAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
    metadataJson: JSON.stringify(overrides.metadataJson ?? {}),
  } as ExternalMessageMappingRecord;
}

function makeOutbox(overrides: Partial<ExternalMessageOutboxRecord> = {}): ExternalMessageOutboxRecord {
  return {
    id: "outbox-1",
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    channelBindingId: "channel-binding-1",
    targetExternalChatId: "C_SECRET",
    payloadJson: "{}",
    metadataJson: "{}",
    status: "sent",
    attempts: 1,
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
    metadataJson: JSON.stringify(overrides.metadataJson ?? {}),
  } as ExternalMessageOutboxRecord;
}
