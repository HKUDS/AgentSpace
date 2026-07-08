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
            hasFiles: true,
            fileCount: 1,
            files: [{
              fileRef: "ref_safefile",
              displayName: "roadmap.pdf",
              mediaType: "application/pdf",
              sizeBytes: 12345,
              privateUrlRedacted: true,
              permalinkRedacted: true,
            }],
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
            agentId: "Atlas",
            taskAgentId: "Atlas",
            taskQueueId: "task-safe-1",
            slackFileCount: 1,
            slackStoredAttachmentCount: 1,
            slackFileDownloadStatus: "stored_attachment",
            slackFiles: [{
              fileRef: "ref_safefile",
              displayName: "roadmap.pdf",
              downloadStatus: "stored_attachment",
              privateUrlStored: false,
            }],
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
        makeOutbox({
          status: "sent",
          targetExternalChatId: "C_SECRET",
          metadataJson: {
            provider: "slack",
            outboxSource: "slack_file_upload",
            slackUploadFlow: "external_upload",
            files: [{
              fileRef: "ref_safefile",
              uploadStatus: "sent",
            }],
          },
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, true);
  assert.equal(report.summary.messageSatisfiedCount, 1);
  assert.equal(report.summary.nativeSatisfiedCount, 1);
  assert.equal(report.summary.approvalSatisfiedCount, 1);
  assert.equal(report.summary.filesSatisfiedCount, 1);
  assert.equal(report.integrations[0]?.message.agentTaskQueueEvidence, 1);
  assert.deepEqual(report.integrations[0]?.blockers, []);
  assert.doesNotMatch(JSON.stringify(report), /A_SECRET|T_SECRET|C_SECRET|D_SECRET|U_SECRET|F_SECRET|url_private|files\.slack\.com|EvMessage|EvApproval|1783400000/);
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

test("Slack evidence blocks message smoke without task queue proof", () => {
  const report = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "message",
    dependencies: {
      listIntegrations: () => [makeIntegration({ agentId: null })],
      listChannelBindings: () => [makeChannelBinding()],
      listUserBindings: () => [makeUserBinding()],
      listEvents: () => [
        makeEvent({
          eventType: "event_callback.app_mention",
          status: "processed",
        }),
      ],
      listMessageMappings: () => [
        makeMapping({
          direction: "inbound",
          metadataJson: {
            provider: "slack",
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
      ],
      listOutbox: () => [
        makeOutbox({
          status: "sent",
          metadataJson: {
            provider: "slack",
            outboxSource: "agent_reply",
          },
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.integrations[0]?.message.agentTaskQueueEvidence, 0);
  assert.ok(report.integrations[0]?.blockers.includes("agent_task_queue_evidence_missing"));
});

test("Slack evidence rejects task queue proof from a different agent", () => {
  const report = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "message",
    dependencies: {
      listIntegrations: () => [makeIntegration({ agentId: "Atlas" })],
      listChannelBindings: () => [makeChannelBinding()],
      listUserBindings: () => [makeUserBinding()],
      listEvents: () => [
        makeEvent({
          eventType: "event_callback.app_mention",
          status: "processed",
        }),
      ],
      listMessageMappings: () => [
        makeMapping({
          direction: "inbound",
          metadataJson: {
            provider: "slack",
            taskAgentId: "Nova",
            taskQueueId: "task-nova",
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
      ],
      listOutbox: () => [
        makeOutbox({
          status: "sent",
          metadataJson: {
            provider: "slack",
            outboxSource: "agent_reply",
          },
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.integrations[0]?.message.agentTaskQueueEvidence, 0);
  assert.ok(report.integrations[0]?.blockers.includes("agent_task_queue_evidence_missing"));
  assert.doesNotMatch(JSON.stringify(report), /task-nova|1783400000/);
});

test("Slack evidence files gate stays blocked until file storage and upload proof exists", () => {
  const integration = makeIntegration();
  const report = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "files",
    dependencies: {
      listIntegrations: () => [integration],
      listChannelBindings: () => [makeChannelBinding()],
      listUserBindings: () => [makeUserBinding()],
      listEvents: () => [
        makeEvent({
          eventType: "event_callback.message",
          status: "processed",
          payloadJson: {
            hasFiles: true,
            fileCount: 1,
            files: [{
              fileRef: "ref_safefile",
              displayName: "roadmap.pdf",
              privateUrlRedacted: true,
            }],
          },
        }),
      ],
      listMessageMappings: () => [
        makeMapping({
          direction: "inbound",
          metadataJson: {
            provider: "slack",
            agentId: "Atlas",
            taskAgentId: "Atlas",
            taskQueueId: "task-safe-1",
            slackFileCount: 1,
            slackFiles: [{
              fileRef: "ref_safefile",
              downloadStatus: "not_downloaded",
            }],
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
      ],
      listOutbox: () => [
        makeOutbox({
          status: "sent",
          metadataJson: {
            provider: "slack",
            outboxSource: "agent_reply",
          },
        }),
      ],
    },
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.integrations[0]?.files.inboundFileMetadataEvents, 1);
  assert.equal(report.integrations[0]?.files.inboundFileMetadataMappings, 1);
  assert.ok(report.integrations[0]?.blockers.includes("slack_file_attachment_storage_evidence_missing"));
  assert.ok(report.integrations[0]?.blockers.includes("slack_outbound_file_upload_evidence_missing"));
});

test("Slack evidence files gate flags unsafe raw Slack file metadata", () => {
  const report = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "files",
    dependencies: {
      listIntegrations: () => [makeIntegration()],
      listChannelBindings: () => [makeChannelBinding()],
      listUserBindings: () => [makeUserBinding()],
      listEvents: () => [
        makeEvent({
          eventType: "event_callback.message",
          status: "processed",
          payloadJson: {
            hasFiles: true,
            fileCount: 1,
            files: [{
              file_id: "FSECRET123",
              url_private: "redacted",
            }],
          },
        }),
      ],
      listMessageMappings: () => [
        makeMapping({
          direction: "inbound",
          metadataJson: {
            provider: "slack",
            agentId: "Atlas",
            taskAgentId: "Atlas",
            taskQueueId: "task-safe-1",
            slackFileCount: 1,
            slackStoredAttachmentCount: 1,
            slackFileDownloadStatus: "stored_attachment",
            slackFiles: [{
              fileRef: "ref_safefile",
              downloadStatus: "stored_attachment",
            }],
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
      ],
      listOutbox: () => [
        makeOutbox({
          status: "sent",
          metadataJson: {
            provider: "slack",
            outboxSource: "slack_file_upload",
            slackUploadFlow: "external_upload",
          },
        }),
      ],
    },
  });

  assert.equal(report.integrations[0]?.files.unsafeFileMetadataRows, 1);
  assert.ok(report.integrations[0]?.blockers.includes("slack_file_metadata_unsafe"));
  assert.equal(report.strictSatisfied, false);
});

test("Slack evidence can gate strict all on redacted live smoke evidence", () => {
  const report = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "all",
    requireLiveSmokeEvidence: true,
    liveSmokeEvidencePath: "runtime-output/slack-smoke/live.json",
    liveSmokeEvidence: makeLiveSmokeEvidence(),
    dependencies: makeCompleteSlackEvidenceDependencies(),
  });

  assert.equal(report.strictSatisfied, true);
  assert.equal(report.liveSmokeEvidence?.present, true);
  assert.equal(report.liveSmokeEvidence?.valid, true);
  assert.equal(report.liveSmokeEvidence?.evidencePath, "runtime-output/slack-smoke/live.json");
  assert.equal(report.liveSmokeEvidence?.summary?.postMessageLiveOk, true);
  assert.equal(report.liveSmokeEvidence?.summary?.appMentionLiveOk, true);
  assert.equal(report.liveSmokeEvidence?.summary?.unsafeRawValueCount, 0);
  assert.doesNotMatch(JSON.stringify(report), /xoxb|xoxp|C123LIVE|UBOTLIVE|1783400001\.000200/);

  const missingAppMention = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "all",
    requireLiveSmokeEvidence: true,
    liveSmokeEvidence: makeLiveSmokeEvidence({ includeAppMention: false }),
    dependencies: makeCompleteSlackEvidenceDependencies(),
  });

  assert.equal(missingAppMention.strictSatisfied, false);
  assert.equal(missingAppMention.liveSmokeEvidence?.valid, false);
  assert.ok(missingAppMention.liveSmokeEvidence?.issues.includes("slack_live_app_mention_evidence_missing"));
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

function makeCompleteSlackEvidenceDependencies(): Parameters<typeof buildSlackEvidenceReport>[0]["dependencies"] {
  return {
    listIntegrations: () => [makeIntegration()],
    listChannelBindings: () => [makeChannelBinding()],
    listUserBindings: () => [makeUserBinding()],
    listEvents: () => [
      makeEvent({
        eventType: "event_callback.app_mention",
        status: "processed",
        payloadJson: {
          hasAgentContext: true,
          hasFiles: true,
          fileCount: 1,
        },
      }),
      makeEvent({
        eventType: "block_actions",
        status: "processed",
      }),
    ],
    listMessageMappings: () => [
      makeMapping({
        direction: "inbound",
        metadataJson: {
          provider: "slack",
          agentId: "Atlas",
          taskAgentId: "Atlas",
          taskQueueId: "task-safe-1",
          slackFileCount: 1,
          slackStoredAttachmentCount: 1,
          slackFileDownloadStatus: "stored_attachment",
          agentContext: {
            entities: [{ type: "slack#/types/channel_id", valueRef: "ref_safechan" }],
          },
        },
      }),
      makeMapping({
        direction: "outbound",
        metadataJson: {
          provider: "slack",
          externalChatReference: "ref_safechat",
        },
      }),
      makeMapping({
        direction: "outbound",
        metadataJson: {
          provider: "slack",
          mappingSource: "app_home_opened_welcome",
          externalChatReference: "ref_safechat",
        },
      }),
    ],
    listOutbox: () => [
      makeOutbox({
        status: "sent",
        metadataJson: {
          provider: "slack",
          outboxSource: "agent_reply",
        },
      }),
      makeOutbox({
        status: "sent",
        metadataJson: {
          provider: "slack",
          outboxSource: "app_home_opened_welcome",
        },
      }),
      makeOutbox({
        status: "sent",
        metadataJson: {
          provider: "slack",
          outboxSource: "assistant_suggested_prompts",
          assistantMethod: "assistant.threads.setSuggestedPrompts",
        },
      }),
      makeOutbox({
        status: "sent",
        metadataJson: {
          provider: "slack",
          outboxSource: "agent_status_card",
        },
      }),
      makeOutbox({
        status: "sent",
        metadataJson: {
          provider: "slack",
          outboxSource: "slack_file_upload",
          slackUploadFlow: "external_upload",
        },
      }),
    ],
  };
}

function makeLiveSmokeEvidence(input: {
  includeAppMention?: boolean;
} = {}): Record<string, unknown> {
  const includeAppMention = input.includeAppMention !== false;
  return {
    schemaVersion: 1,
    provider: "slack",
    generatedAt: new Date().toISOString(),
    runs: [
      {
        generatedAt: new Date().toISOString(),
        mode: "live",
        live: true,
        ready: true,
        liveResult: {
          attempted: true,
          ok: true,
          mode: "post_message",
          channelReference: "channel C123...LIVE",
          messageReference: "message 1783...0100",
        },
      },
      ...(includeAppMention ? [{
        generatedAt: new Date().toISOString(),
        mode: "live",
        live: true,
        ready: true,
        liveResult: {
          attempted: true,
          ok: true,
          mode: "app_mention",
          channelReference: "channel CAPP...TION",
          botUserReference: "user UB...VE",
          messageReference: "message 1783...0200",
          appMentionText: true,
        },
      }] : []),
    ],
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
