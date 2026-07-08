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
import { buildSlackEvidenceReport, verifySlackLiveSmokeEvidence } from "../evidence.ts";

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
  assert.equal(report.summary.staleEvidenceRowCount, 0);
  assert.equal(report.summary.unhealthyIntegrationCount, 0);
  assert.equal(report.integrations[0]?.healthCheck.healthy, true);
  assert.equal(report.integrations[0]?.healthCheck.fresh, true);
  assert.equal(report.integrations[0]?.message.agentTaskQueueEvidence, 1);
  assert.deepEqual(report.integrations[0]?.blockers, []);
  assert.ok(report.nextCommands.includes(
    "agent-space integrations slack smoke-plan --workspace-id workspace-1 --strict --require all --json",
  ));
  assert.ok(report.nextCommands.includes("npm run smoke:slack:verify -- --env-file scripts/slack/.env --json"));
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
  assert.equal(report.liveSmokeEvidence?.summary?.fileUploadLiveOk, true);
  assert.equal(report.liveSmokeEvidence?.summary?.freshRunCount, 3);
  assert.equal(report.liveSmokeEvidence?.summary?.staleRunCount, 0);
  assert.equal(report.liveSmokeEvidence?.summary?.contextMatched, true);
  assert.equal(report.liveSmokeEvidence?.summary?.unsafeRawValueCount, 0);
  assert.doesNotMatch(JSON.stringify(report), /xoxb|xoxp|C123LIVE|UBOTLIVE|FSMOKEFILE123|1783400001\.000200/);

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

  const missingFileUpload = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "all",
    requireLiveSmokeEvidence: true,
    liveSmokeEvidence: makeLiveSmokeEvidence({ includeFileUpload: false }),
    dependencies: makeCompleteSlackEvidenceDependencies(),
  });

  assert.equal(missingFileUpload.strictSatisfied, false);
  assert.equal(missingFileUpload.liveSmokeEvidence?.valid, false);
  assert.ok(missingFileUpload.liveSmokeEvidence?.issues.includes("slack_live_file_upload_evidence_missing"));

  const wrongContext = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "all",
    requireLiveSmokeEvidence: true,
    liveSmokeEvidence: makeLiveSmokeEvidence({ integrationId: "slack-other" }),
    dependencies: makeCompleteSlackEvidenceDependencies(),
  });

  assert.equal(wrongContext.strictSatisfied, false);
  assert.equal(wrongContext.liveSmokeEvidence?.valid, false);
  assert.equal(wrongContext.liveSmokeEvidence?.summary?.contextMatched, false);
  assert.ok(wrongContext.liveSmokeEvidence?.issues.includes("slack_live_smoke_context_mismatch"));

  const wrongAppTeam = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "all",
    requireLiveSmokeEvidence: true,
    liveSmokeEvidence: makeLiveSmokeEvidence({
      appReference: "ref_fa77895c",
      teamReference: "ref_e18a0086",
    }),
    dependencies: makeCompleteSlackEvidenceDependencies(),
  });

  assert.equal(wrongAppTeam.strictSatisfied, false);
  assert.equal(wrongAppTeam.liveSmokeEvidence?.valid, false);
  assert.equal(wrongAppTeam.liveSmokeEvidence?.summary?.contextMatched, false);
  assert.ok(wrongAppTeam.liveSmokeEvidence?.issues.includes("slack_live_smoke_context_mismatch"));
});

test("Slack live smoke evidence requires per-run context for accumulated artifacts", () => {
  const accumulatedWithoutRunContext = makeLiveSmokeEvidence();
  const runs = accumulatedWithoutRunContext.runs as Array<Record<string, unknown>>;
  for (const run of runs) {
    delete run.context;
  }

  const report = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "all",
    requireLiveSmokeEvidence: true,
    liveSmokeEvidence: accumulatedWithoutRunContext,
    dependencies: makeCompleteSlackEvidenceDependencies(),
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.liveSmokeEvidence?.valid, false);
  assert.equal(report.liveSmokeEvidence?.summary?.contextMatched, false);
  assert.deepEqual(report.liveSmokeEvidence?.summary?.satisfiedIntegrationIds, []);
  assert.ok(report.liveSmokeEvidence?.issues.includes("slack_live_smoke_context_mismatch"));
  assert.ok(report.liveSmokeEvidence?.issues.includes("slack_live_smoke_integration_evidence_missing"));

  const legacySingleRun = {
    schemaVersion: 1,
    provider: "slack",
    generatedAt: new Date().toISOString(),
    context: {
      workspaceId: "workspace-1",
      integrationId: "slack-1",
      appReference: "ref_47ac6cdf",
      teamReference: "ref_cc475e71",
    },
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
  };
  const legacyVerification = verifySlackLiveSmokeEvidence({
    evidence: legacySingleRun,
    expectedWorkspaceId: "workspace-1",
    expectedIntegrations: [{
      integrationId: "slack-1",
      appReference: "ref_47ac6cdf",
      teamReference: "ref_cc475e71",
    }],
  });

  assert.equal(legacyVerification.summary?.contextMatched, true);
  assert.equal(legacyVerification.summary?.postMessageLiveOk, true);
});

test("Slack live smoke evidence requires safe result references", () => {
  const missingPostMessageReference = makeLiveSmokeEvidence();
  const postMessageLiveResult = (
    (missingPostMessageReference.runs as Array<Record<string, unknown>>)[0]?.liveResult ?? {}
  ) as Record<string, unknown>;
  delete postMessageLiveResult.messageReference;
  const missingPostMessageReport = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "all",
    requireLiveSmokeEvidence: true,
    liveSmokeEvidence: missingPostMessageReference,
    dependencies: makeCompleteSlackEvidenceDependencies(),
  });

  assert.equal(missingPostMessageReport.strictSatisfied, false);
  assert.equal(missingPostMessageReport.liveSmokeEvidence?.summary?.postMessageLiveOk, false);
  assert.ok(missingPostMessageReport.liveSmokeEvidence?.issues.includes("slack_live_post_message_evidence_missing"));
  assert.deepEqual(missingPostMessageReport.liveSmokeEvidence?.summary?.satisfiedIntegrationIds, []);

  const missingAppMentionReference = makeLiveSmokeEvidence();
  const appMentionLiveResult = (
    (missingAppMentionReference.runs as Array<Record<string, unknown>>)[1]?.liveResult ?? {}
  ) as Record<string, unknown>;
  delete appMentionLiveResult.botUserReference;
  const missingAppMentionReport = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "all",
    requireLiveSmokeEvidence: true,
    liveSmokeEvidence: missingAppMentionReference,
    dependencies: makeCompleteSlackEvidenceDependencies(),
  });

  assert.equal(missingAppMentionReport.strictSatisfied, false);
  assert.equal(missingAppMentionReport.liveSmokeEvidence?.summary?.appMentionLiveOk, false);
  assert.ok(missingAppMentionReport.liveSmokeEvidence?.issues.includes("slack_live_app_mention_evidence_missing"));
  assert.deepEqual(missingAppMentionReport.liveSmokeEvidence?.summary?.satisfiedIntegrationIds, []);

  const missingFileReference = makeLiveSmokeEvidence();
  const fileUploadLiveResult = (
    (missingFileReference.runs as Array<Record<string, unknown>>)[2]?.liveResult ?? {}
  ) as Record<string, unknown>;
  delete fileUploadLiveResult.fileReference;
  const missingFileReport = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "all",
    requireLiveSmokeEvidence: true,
    liveSmokeEvidence: missingFileReference,
    dependencies: makeCompleteSlackEvidenceDependencies(),
  });

  assert.equal(missingFileReport.strictSatisfied, false);
  assert.equal(missingFileReport.liveSmokeEvidence?.summary?.fileUploadLiveOk, false);
  assert.ok(missingFileReport.liveSmokeEvidence?.issues.includes("slack_live_file_upload_evidence_missing"));
  assert.deepEqual(missingFileReport.liveSmokeEvidence?.summary?.satisfiedIntegrationIds, []);
});

test("Slack live smoke evidence ignores stale accumulated runs", () => {
  const staleEvidence = makeLiveSmokeEvidence();
  const staleRuns = staleEvidence.runs as Array<Record<string, unknown>>;
  for (const run of staleRuns) {
    run.generatedAt = staleTimestamp();
  }

  const staleReport = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "all",
    requireLiveSmokeEvidence: true,
    liveSmokeEvidence: staleEvidence,
    dependencies: makeCompleteSlackEvidenceDependencies(),
  });

  assert.equal(staleReport.strictSatisfied, false);
  assert.equal(staleReport.liveSmokeEvidence?.summary?.freshRunCount, 0);
  assert.equal(staleReport.liveSmokeEvidence?.summary?.staleRunCount, 3);
  assert.equal(staleReport.liveSmokeEvidence?.summary?.postMessageLiveOk, false);
  assert.equal(staleReport.liveSmokeEvidence?.summary?.appMentionLiveOk, false);
  assert.equal(staleReport.liveSmokeEvidence?.summary?.fileUploadLiveOk, false);
  assert.ok(staleReport.liveSmokeEvidence?.issues.includes("slack_live_post_message_evidence_missing"));
  assert.ok(staleReport.liveSmokeEvidence?.issues.includes("slack_live_app_mention_evidence_missing"));
  assert.ok(staleReport.liveSmokeEvidence?.issues.includes("slack_live_file_upload_evidence_missing"));
  assert.ok(staleReport.liveSmokeEvidence?.issues.includes("slack_live_smoke_integration_evidence_missing"));

  const mixedEvidence = makeLiveSmokeEvidence();
  const mixedRuns = mixedEvidence.runs as Array<Record<string, unknown>>;
  const staleWrongContextRun = JSON.parse(JSON.stringify(mixedRuns[0])) as Record<string, unknown>;
  staleWrongContextRun.generatedAt = staleTimestamp();
  staleWrongContextRun.context = {
    workspaceId: "workspace-1",
    integrationId: "slack-other",
    appReference: "ref_fa77895c",
    teamReference: "ref_e18a0086",
  };
  mixedRuns.push(staleWrongContextRun);

  const mixedReport = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "all",
    requireLiveSmokeEvidence: true,
    liveSmokeEvidence: mixedEvidence,
    dependencies: makeCompleteSlackEvidenceDependencies(),
  });

  assert.equal(mixedReport.strictSatisfied, true);
  assert.equal(mixedReport.liveSmokeEvidence?.summary?.freshRunCount, 3);
  assert.equal(mixedReport.liveSmokeEvidence?.summary?.staleRunCount, 1);
  assert.equal(mixedReport.liveSmokeEvidence?.summary?.contextMatched, true);
  assert.deepEqual(mixedReport.liveSmokeEvidence?.summary?.satisfiedIntegrationIds, ["slack-1"]);
});

test("Slack evidence strict all rejects stale local evidence rows", () => {
  const report = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "all",
    requireLiveSmokeEvidence: true,
    liveSmokeEvidence: makeLiveSmokeEvidence(),
    dependencies: makeCompleteSlackEvidenceDependencies({
      timestamp: staleTimestamp(),
    }),
  });

  assert.equal(report.strictSatisfied, false);
  assert.equal(report.summary.staleEvidenceRowCount, 10);
  assert.equal(report.integrations[0]?.freshness.required, true);
  assert.equal(report.integrations[0]?.freshness.freshEvents, 0);
  assert.equal(report.integrations[0]?.freshness.freshMappings, 0);
  assert.equal(report.integrations[0]?.freshness.freshOutbox, 0);
  assert.ok(report.integrations[0]?.blockers.includes("local_evidence_stale"));
  assert.ok(report.integrations[0]?.warnings.includes("stale_local_evidence_ignored"));
});

test("Slack evidence strict all requires fresh healthy integration health", () => {
  const degraded = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "all",
    requireLiveSmokeEvidence: true,
    liveSmokeEvidence: makeLiveSmokeEvidence(),
    dependencies: makeCompleteSlackEvidenceDependencies({
      integration: makeIntegration({
        lastHealthStatus: "degraded",
        lastHealthCheckedAt: freshTimestamp(),
      }),
    }),
  });

  assert.equal(degraded.strictSatisfied, false);
  assert.equal(degraded.summary.unhealthyIntegrationCount, 1);
  assert.ok(degraded.integrations[0]?.blockers.includes("health_check_required_or_unhealthy"));
  assert.ok(degraded.integrations[0]?.warnings.includes("health_check_not_ready"));

  const staleHealth = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "all",
    requireLiveSmokeEvidence: true,
    liveSmokeEvidence: makeLiveSmokeEvidence(),
    dependencies: makeCompleteSlackEvidenceDependencies({
      integration: makeIntegration({
        lastHealthStatus: "healthy",
        lastHealthCheckedAt: staleTimestamp(),
      }),
    }),
  });

  assert.equal(staleHealth.strictSatisfied, false);
  assert.equal(staleHealth.summary.unhealthyIntegrationCount, 1);
  assert.ok(staleHealth.integrations[0]?.blockers.includes("health_check_stale_or_missing"));
});

test("Slack evidence strict all requires live artifact for the same satisfied integration", () => {
  const timestamp = freshTimestamp();
  const satisfiedIntegration = makeIntegration({ id: "slack-1", displayName: "Slack Atlas" });
  const otherIntegration = makeIntegration({ id: "slack-2", displayName: "Slack Nova", agentId: "Nova" });
  const report = buildSlackEvidenceReport({
    workspaceId: "workspace-1",
    strict: true,
    required: "all",
    requireLiveSmokeEvidence: true,
    liveSmokeEvidence: makeLiveSmokeEvidence({ integrationId: "slack-2" }),
    dependencies: {
      listIntegrations: () => [satisfiedIntegration, otherIntegration],
      listChannelBindings: ({ integrationId }) => integrationId === "slack-1"
        ? [makeChannelBinding({ integrationId: "slack-1" })]
        : [],
      listUserBindings: ({ integrationId }) => integrationId === "slack-1"
        ? [makeUserBinding({ integrationId: "slack-1" })]
        : [],
      listEvents: ({ integrationId }) => integrationId === "slack-1"
        ? [
          makeEvent({
            integrationId: "slack-1",
            eventType: "event_callback.app_mention",
            status: "processed",
            receivedAt: timestamp,
            processedAt: timestamp,
            payloadJson: {
              hasAgentContext: true,
              hasFiles: true,
              fileCount: 1,
            },
          }),
          makeEvent({
            id: "event-approval-1",
            integrationId: "slack-1",
            eventType: "block_actions",
            status: "processed",
            receivedAt: timestamp,
            processedAt: timestamp,
          }),
        ]
        : [],
      listMessageMappings: ({ integrationId }) => integrationId === "slack-1"
        ? [
          makeMapping({
            integrationId: "slack-1",
            createdAt: timestamp,
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
            id: "mapping-outbound-1",
            integrationId: "slack-1",
            createdAt: timestamp,
            direction: "outbound",
            metadataJson: {
              provider: "slack",
              externalChatReference: "ref_safechat",
            },
          }),
          makeMapping({
            id: "mapping-home-1",
            integrationId: "slack-1",
            createdAt: timestamp,
            direction: "outbound",
            metadataJson: {
              provider: "slack",
              mappingSource: "app_home_opened_welcome",
              externalChatReference: "ref_safechat",
            },
          }),
        ]
        : [],
      listOutbox: ({ integrationId }) => integrationId === "slack-1"
        ? [
          makeOutbox({
            integrationId: "slack-1",
            createdAt: timestamp,
            updatedAt: timestamp,
            sentAt: timestamp,
            status: "sent",
            metadataJson: {
              provider: "slack",
              outboxSource: "agent_reply",
            },
          }),
          makeOutbox({
            id: "outbox-home-1",
            integrationId: "slack-1",
            createdAt: timestamp,
            updatedAt: timestamp,
            sentAt: timestamp,
            status: "sent",
            metadataJson: {
              provider: "slack",
              outboxSource: "app_home_opened_welcome",
            },
          }),
          makeOutbox({
            id: "outbox-prompts-1",
            integrationId: "slack-1",
            createdAt: timestamp,
            updatedAt: timestamp,
            sentAt: timestamp,
            status: "sent",
            metadataJson: {
              provider: "slack",
              outboxSource: "assistant_suggested_prompts",
              assistantMethod: "assistant.threads.setSuggestedPrompts",
            },
          }),
          makeOutbox({
            id: "outbox-approval-1",
            integrationId: "slack-1",
            createdAt: timestamp,
            updatedAt: timestamp,
            sentAt: timestamp,
            status: "sent",
            metadataJson: {
              provider: "slack",
              outboxSource: "agent_status_card",
            },
          }),
          makeOutbox({
            id: "outbox-file-1",
            integrationId: "slack-1",
            createdAt: timestamp,
            updatedAt: timestamp,
            sentAt: timestamp,
            status: "sent",
            metadataJson: {
              provider: "slack",
              outboxSource: "slack_file_upload",
              slackUploadFlow: "external_upload",
            },
          }),
        ]
        : [],
    },
  });

  assert.equal(report.integrations.find((item) => item.integrationId === "slack-1")?.requiredSatisfied, true);
  assert.equal(report.liveSmokeEvidence?.valid, true);
  assert.deepEqual(report.liveSmokeEvidence?.summary?.satisfiedIntegrationIds, ["slack-2"]);
  assert.equal(report.strictSatisfied, false);
});

function makeIntegration(overrides: Partial<ExternalIntegrationRecord> = {}): ExternalIntegrationRecord {
  const timestamp = freshTimestamp();
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
    lastHealthCheckedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function makeCompleteSlackEvidenceDependencies(input: {
  timestamp?: string;
  integration?: ExternalIntegrationRecord;
} = {}): Parameters<typeof buildSlackEvidenceReport>[0]["dependencies"] {
  const timestamp = input.timestamp ?? freshTimestamp();
  return {
    listIntegrations: () => [input.integration ?? makeIntegration()],
    listChannelBindings: () => [makeChannelBinding()],
    listUserBindings: () => [makeUserBinding()],
    listEvents: () => [
      makeEvent({
        eventType: "event_callback.app_mention",
        status: "processed",
        receivedAt: timestamp,
        processedAt: timestamp,
        payloadJson: {
          hasAgentContext: true,
          hasFiles: true,
          fileCount: 1,
        },
      }),
      makeEvent({
        eventType: "block_actions",
        status: "processed",
        receivedAt: timestamp,
        processedAt: timestamp,
      }),
    ],
    listMessageMappings: () => [
      makeMapping({
        createdAt: timestamp,
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
        createdAt: timestamp,
        direction: "outbound",
        metadataJson: {
          provider: "slack",
          externalChatReference: "ref_safechat",
        },
      }),
      makeMapping({
        createdAt: timestamp,
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
        createdAt: timestamp,
        updatedAt: timestamp,
        sentAt: timestamp,
        status: "sent",
        metadataJson: {
          provider: "slack",
          outboxSource: "agent_reply",
        },
      }),
      makeOutbox({
        createdAt: timestamp,
        updatedAt: timestamp,
        sentAt: timestamp,
        status: "sent",
        metadataJson: {
          provider: "slack",
          outboxSource: "app_home_opened_welcome",
        },
      }),
      makeOutbox({
        createdAt: timestamp,
        updatedAt: timestamp,
        sentAt: timestamp,
        status: "sent",
        metadataJson: {
          provider: "slack",
          outboxSource: "assistant_suggested_prompts",
          assistantMethod: "assistant.threads.setSuggestedPrompts",
        },
      }),
      makeOutbox({
        createdAt: timestamp,
        updatedAt: timestamp,
        sentAt: timestamp,
        status: "sent",
        metadataJson: {
          provider: "slack",
          outboxSource: "agent_status_card",
        },
      }),
      makeOutbox({
        createdAt: timestamp,
        updatedAt: timestamp,
        sentAt: timestamp,
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
  includeFileUpload?: boolean;
  workspaceId?: string;
  integrationId?: string;
  appReference?: string;
  teamReference?: string;
} = {}): Record<string, unknown> {
  const includeAppMention = input.includeAppMention !== false;
  const includeFileUpload = input.includeFileUpload !== false;
  const context = {
    workspaceId: input.workspaceId ?? "workspace-1",
    integrationId: input.integrationId ?? "slack-1",
    appReference: input.appReference ?? "ref_47ac6cdf",
    teamReference: input.teamReference ?? "ref_cc475e71",
  };
  return {
    schemaVersion: 1,
    provider: "slack",
    generatedAt: new Date().toISOString(),
    context,
    runs: [
      {
        generatedAt: new Date().toISOString(),
        mode: "live",
        live: true,
        ready: true,
        context,
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
        context,
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
      ...(includeFileUpload ? [{
        generatedAt: new Date().toISOString(),
        mode: "live",
        live: true,
        ready: true,
        context,
        liveResult: {
          attempted: true,
          ok: true,
          mode: "file_upload",
          channelReference: "channel CFILE...LIVE",
          fileReference: "file FSMO...E123",
          fileUpload: true,
          uploadCompleted: true,
        },
      }] : []),
    ],
  };
}

function makeChannelBinding(overrides: Partial<ExternalChannelBindingRecord> = {}): ExternalChannelBindingRecord {
  const timestamp = freshTimestamp();
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
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function makeUserBinding(overrides: Partial<ExternalUserBindingRecord> = {}): ExternalUserBindingRecord {
  const timestamp = freshTimestamp();
  return {
    id: "user-binding-1",
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    userId: "user-1",
    externalUserId: "U_SECRET",
    status: "active",
    metadataJson: "{}",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<ExternalIntegrationEventRecord> = {}): ExternalIntegrationEventRecord {
  const timestamp = freshTimestamp();
  return {
    id: "event-1",
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    provider: SLACK_PROVIDER_ID,
    externalEventId: "EvSecret",
    eventType: "event_callback.message",
    status: "processed",
    payloadJson: "{}",
    receivedAt: timestamp,
    processedAt: timestamp,
    ...overrides,
    payloadJson: JSON.stringify(overrides.payloadJson ?? {}),
  } as ExternalIntegrationEventRecord;
}

function makeMapping(overrides: Partial<ExternalMessageMappingRecord> = {}): ExternalMessageMappingRecord {
  const timestamp = freshTimestamp();
  return {
    id: "mapping-1",
    workspaceId: "workspace-1",
    integrationId: "slack-1",
    channelBindingId: "channel-binding-1",
    direction: "inbound",
    externalMessageId: "1783400000.000100",
    metadataJson: "{}",
    createdAt: timestamp,
    ...overrides,
    metadataJson: JSON.stringify(overrides.metadataJson ?? {}),
  } as ExternalMessageMappingRecord;
}

function makeOutbox(overrides: Partial<ExternalMessageOutboxRecord> = {}): ExternalMessageOutboxRecord {
  const timestamp = freshTimestamp();
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
    createdAt: timestamp,
    updatedAt: timestamp,
    sentAt: timestamp,
    ...overrides,
    metadataJson: JSON.stringify(overrides.metadataJson ?? {}),
  } as ExternalMessageOutboxRecord;
}

function freshTimestamp(): string {
  return new Date().toISOString();
}

function staleTimestamp(): string {
  return new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
}
