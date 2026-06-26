import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { before, beforeEach } from "node:test";
import type { MessageAttachment } from "@agent-space/domain/workspace";
import {
  createExternalIntegrationSync,
  createExternalMessageMappingSync,
  createExternalMessageOutboxSync,
  createStoredChannelSync,
  createWorkspaceSync,
  getDatabase,
  readExternalMessageMappingByAgentSpaceMessageSync,
  readExternalMessageOutboxSync,
  updateExternalIntegrationStatusSync,
  upsertExternalChannelBindingSync,
} from "@agent-space/db";
import { FEISHU_PROVIDER_ID } from "../constants.ts";
import {
  processFeishuOutboxMessage,
  queueFeishuAgentStatusCardOutboxSync,
  queueFeishuChannelReplyOutboxSync,
} from "../outbound.ts";
import type { FeishuApiClient, FeishuApiRequest } from "../client.ts";

const originalCwd = process.cwd();
const repositoryRoot = existsSync(join(originalCwd, "Target.md")) ? originalCwd : join(originalCwd, "..", "..", "..", "..");
const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-feishu-outbound-"));
const databaseTestOptions = process.env.AGENT_SPACE_FEISHU_OUTBOUND_DB_TESTS === "1"
  ? {}
  : { skip: "Set AGENT_SPACE_FEISHU_OUTBOUND_DB_TESTS=1 with a test Postgres URL to run Feishu outbound DB integration tests." };

before(() => {
  writeFileSync(join(tempRoot, "Target.md"), "# test\n");
  mkdirSync(join(tempRoot, "data"), { recursive: true });
  const packagesLink = join(tempRoot, "packages");
  if (!existsSync(packagesLink)) {
    symlinkSync(join(repositoryRoot, "packages"), packagesLink, "dir");
  }
  process.chdir(tempRoot);
});

beforeEach(() => {
  getDatabase().exec(`
    DELETE FROM external_message_mapping;
    DELETE FROM external_message_outbox;
    DELETE FROM external_thread_binding;
    DELETE FROM external_channel_binding;
    DELETE FROM external_integration;
    DELETE FROM workspace;
  `);
});

test("temporary Feishu send failures keep outbox pending for retry", databaseTestOptions, async () => {
  const workspace = createWorkspaceSync({
    slug: "feishu-outbox-retry",
    name: "Feishu Outbox Retry",
    createdBy: "system",
  });
  const integration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: FEISHU_PROVIDER_ID,
    displayName: "Feishu",
    transportMode: "http_webhook",
    agentId: "Atlas",
  });
  const outbox = createExternalMessageOutboxSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    targetExternalChatId: "oc_general",
    payloadJson: {
      receive_id_type: "chat_id",
      receive_id: "oc_general",
      msg_type: "text",
      content: JSON.stringify({ text: "hello" }),
    },
  });
  const client: FeishuApiClient = {
    async request() {
      throw new Error("fetch failed ECONNRESET");
    },
  };

  const result = await processFeishuOutboxMessage({
    context: {
      workspaceId: workspace.id,
      integrationId: integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    client,
    outboxId: outbox.id,
    lockedBy: "test-worker",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "feishu.outbound.network_unreachable");
  assert.equal(result.retryable, true);
  assert.equal(result.terminal, false);
  assert.ok(result.nextAttemptAt);

  const stored = readExternalMessageOutboxSync({
    workspaceId: workspace.id,
    outboxId: outbox.id,
  });
  assert.ok(stored);
  assert.equal(stored.status, "pending");
  assert.equal(stored.attempts, 1);
  assert.equal(stored.lockedBy, undefined);
  assert.match(stored.lastError ?? "", /feishu\.outbound\.network_unreachable/);
  assert.ok(stored.nextAttemptAt);
  assert.equal(Date.parse(stored.nextAttemptAt) > Date.parse(stored.updatedAt), true);
});

test("AgentSpace replies are sent back to the source Feishu thread", databaseTestOptions, async () => {
  const workspace = createWorkspaceWithTourVisitChannel({
    slug: "feishu-thread-reply",
    name: "Feishu Thread Reply",
    createdBy: "system",
  });
  const integration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: FEISHU_PROVIDER_ID,
    displayName: "Feishu",
    transportMode: "http_webhook",
  });
  const channelBinding = upsertExternalChannelBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    channelName: "tour visit",
    externalChatId: "oc_tour",
    externalChatType: "group",
    externalChatName: "Tour Visit",
    status: "active",
    syncMode: "mirror",
  });
  createExternalMessageMappingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    channelBindingId: channelBinding.id,
    direction: "inbound",
    externalMessageId: "om_source",
    externalThreadId: "om_root",
    externalSenderId: "ou_mina",
    agentSpaceMessageId: "agent-space-source-message-1",
    metadataJson: {},
  });

  const queuedOutbox = queueFeishuChannelReplyOutboxSync({
    workspaceId: workspace.id,
    channelName: "tour visit",
    text: "Atlas reply for Feishu",
    agentSpaceMessageId: "agent-space-agent-reply-1",
    sourceAgentSpaceMessageId: "agent-space-source-message-1",
  });
  assert.equal(queuedOutbox.length, 1);
  assert.equal(queuedOutbox[0]?.targetExternalChatId, "oc_tour");
  assert.equal(queuedOutbox[0]?.targetExternalThreadId, "om_root");
  const queuedMetadata = JSON.parse(queuedOutbox[0]?.metadataJson ?? "{}") as Record<string, unknown>;
  assert.equal(queuedMetadata.provider, "feishu");
  assert.equal(queuedMetadata.outboxSource, "agent_reply");
  assert.equal(queuedMetadata.agentId, undefined);
  assert.equal(queuedMetadata.botBindingId, undefined);
  assert.match(String(queuedMetadata.externalChatReference), /^ref_[a-f0-9]{8}$/);
  assert.match(String(queuedMetadata.externalThreadReference), /^ref_[a-f0-9]{8}$/);
  assert.equal(JSON.stringify(queuedMetadata).includes("oc_tour"), false);
  assert.equal(JSON.stringify(queuedMetadata).includes("om_root"), false);

  const requests: FeishuApiRequest[] = [];
  const client: FeishuApiClient = {
    async request<T>(request: FeishuApiRequest): Promise<T> {
      requests.push(request);
      return {
        code: 0,
        msg: "ok",
        data: {
          message_id: "om_reply",
        },
      } as T;
    },
  };

  const result = await processFeishuOutboxMessage({
    context: {
      workspaceId: workspace.id,
      integrationId: integration.id,
      provider: FEISHU_PROVIDER_ID,
    },
    client,
    outboxId: queuedOutbox[0]!.id,
    lockedBy: "test-worker",
  });

  assert.equal(result.status, "sent");
  assert.equal(result.externalMessageId, "om_reply");
  assert.deepEqual(requests, [{
    method: "POST",
    path: "/open-apis/im/v1/messages/om_root/reply",
    body: {
      msg_type: "text",
      content: JSON.stringify({ text: "Atlas reply for Feishu" }),
    },
  }]);

  const storedOutbox = readExternalMessageOutboxSync({
    workspaceId: workspace.id,
    outboxId: queuedOutbox[0]!.id,
  });
  assert.ok(storedOutbox);
  assert.equal(storedOutbox.status, "sent");
  assert.equal(storedOutbox.sentAt !== undefined, true);

  const outboundMapping = readExternalMessageMappingByAgentSpaceMessageSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    agentSpaceMessageId: "agent-space-agent-reply-1",
    direction: "outbound",
  });
  assert.ok(outboundMapping);
  assert.equal(outboundMapping.externalMessageId, "om_reply");
  assert.equal(outboundMapping.externalThreadId, "om_root");
  assert.equal(outboundMapping.channelBindingId, channelBinding.id);
  const outboundMetadata = JSON.parse(outboundMapping.metadataJson) as {
    externalChatReference?: string;
    externalThreadReference?: string;
    agentActionPolicyInput?: {
      action?: {
        type?: string;
        operationSummary?: string;
        resourceId?: string;
        resourceReference?: string;
        resourceIdRedacted?: boolean;
      };
    };
    agentActionPolicyDecision?: {
      decision?: string;
      reasonCode?: string;
    };
    feishuResponse?: {
      code?: number;
      messageRedacted?: boolean;
      messageReference?: string;
      msg?: unknown;
      message?: unknown;
      data?: unknown;
    };
  };
  assert.match(outboundMetadata.externalChatReference ?? "", /^ref_[a-f0-9]{8}$/);
  assert.match(outboundMetadata.externalThreadReference ?? "", /^ref_[a-f0-9]{8}$/);
  assert.equal(outboundMetadata.agentActionPolicyInput?.action?.type, "external_message.send");
  assert.equal(outboundMetadata.agentActionPolicyInput?.action?.operationSummary, "Send Feishu text reply to a bound chat.");
  assert.equal(outboundMetadata.agentActionPolicyInput?.action?.resourceId, undefined);
  assert.match(outboundMetadata.agentActionPolicyInput?.action?.resourceReference ?? "", /^ref_[a-f0-9]{8}$/);
  assert.equal(outboundMetadata.agentActionPolicyInput?.action?.resourceIdRedacted, true);
  assert.equal(outboundMetadata.agentActionPolicyDecision?.decision, "allow");
  assert.equal(outboundMetadata.agentActionPolicyDecision?.reasonCode, "agent_action.low_risk_external_message_send_allowed");
  assert.equal(outboundMetadata.feishuResponse?.code, 0);
  assert.equal(outboundMetadata.feishuResponse?.messageRedacted, true);
  assert.equal(typeof outboundMetadata.feishuResponse?.messageReference, "string");
  assert.deepEqual(Object.keys(outboundMetadata.feishuResponse ?? {}).sort(), [
    "code",
    "messageRedacted",
    "messageReference",
  ]);
  assert.equal(JSON.stringify(outboundMetadata).includes("oc_tour"), false);
  assert.equal(JSON.stringify(outboundMetadata).includes("om_root"), false);
  assert.equal(JSON.stringify(outboundMetadata).includes("Atlas reply for Feishu"), false);
  assert.equal(JSON.stringify(outboundMetadata).includes("om_reply"), false);
  assert.equal(JSON.stringify(outboundMetadata.feishuResponse).includes("ok"), false);
});

test("Feishu replies without agent id reuse the source agent bot integration", databaseTestOptions, () => {
  const workspace = createWorkspaceWithTourVisitChannel({
    slug: "feishu-thread-reply-source-bot",
    name: "Feishu Thread Reply Source Bot",
    createdBy: "system",
  });
  const workspaceIntegration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: FEISHU_PROVIDER_ID,
    displayName: "Workspace Feishu",
    transportMode: "http_webhook",
  });
  upsertExternalChannelBindingSync({
    workspaceId: workspace.id,
    integrationId: workspaceIntegration.id,
    channelName: "tour visit",
    externalChatId: "oc_workspace",
    externalChatType: "group",
    externalChatName: "Workspace Chat",
    status: "active",
    syncMode: "mirror",
  });
  const agentBotIntegration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: FEISHU_PROVIDER_ID,
    displayName: "Atlas Feishu Bot",
    transportMode: "websocket_worker",
    agentId: "Atlas",
    appId: "cli_atlas_bot",
  });
  const agentBotChannelBinding = upsertExternalChannelBindingSync({
    workspaceId: workspace.id,
    integrationId: agentBotIntegration.id,
    channelName: "tour visit",
    externalChatId: "oc_agent_bot",
    externalChatType: "group",
    externalChatName: "Agent Bot Chat",
    status: "active",
    syncMode: "mirror",
  });
  createExternalMessageMappingSync({
    workspaceId: workspace.id,
    integrationId: agentBotIntegration.id,
    channelBindingId: agentBotChannelBinding.id,
    direction: "inbound",
    externalMessageId: "om_source",
    externalThreadId: "om_root",
    externalSenderId: "ou_mina",
    agentSpaceMessageId: "agent-space-source-message-1",
    metadataJson: {
      agentId: "Atlas",
      botBindingId: agentBotIntegration.id,
    },
  });

  const queuedOutbox = queueFeishuChannelReplyOutboxSync({
    workspaceId: workspace.id,
    channelName: "tour visit",
    text: "Atlas reply for Feishu",
    agentSpaceMessageId: "agent-space-agent-reply-1",
    sourceAgentSpaceMessageId: "agent-space-source-message-1",
  });

  assert.equal(queuedOutbox.length, 1);
  assert.equal(queuedOutbox[0]?.integrationId, agentBotIntegration.id);
  assert.equal(queuedOutbox[0]?.targetExternalChatId, "oc_agent_bot");
  assert.equal(queuedOutbox[0]?.targetExternalThreadId, "om_root");
  const payload = JSON.parse(queuedOutbox[0]?.payloadJson ?? "{}") as {
    content?: string;
  };
  const content = JSON.parse(String(payload.content)) as { text?: string };
  assert.equal(content.text, "Atlas · AgentSpace\nAtlas reply for Feishu");
});

test("Feishu replies do not fall back to workspace bot when the source agent bot is disabled", databaseTestOptions, () => {
  const workspace = createWorkspaceWithTourVisitChannel({
    slug: "feishu-thread-reply-disabled-source-bot",
    name: "Feishu Thread Reply Disabled Source Bot",
    createdBy: "system",
  });
  const workspaceIntegration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: FEISHU_PROVIDER_ID,
    displayName: "Workspace Feishu",
    transportMode: "http_webhook",
  });
  upsertExternalChannelBindingSync({
    workspaceId: workspace.id,
    integrationId: workspaceIntegration.id,
    channelName: "tour visit",
    externalChatId: "oc_workspace",
    externalChatType: "group",
    externalChatName: "Workspace Chat",
    status: "active",
    syncMode: "mirror",
  });
  const agentBotIntegration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: FEISHU_PROVIDER_ID,
    displayName: "Atlas Feishu Bot",
    transportMode: "websocket_worker",
    agentId: "Atlas",
    appId: "cli_atlas_bot_disabled",
  });
  const agentBotChannelBinding = upsertExternalChannelBindingSync({
    workspaceId: workspace.id,
    integrationId: agentBotIntegration.id,
    channelName: "tour visit",
    externalChatId: "oc_agent_bot",
    externalChatType: "group",
    externalChatName: "Agent Bot Chat",
    status: "active",
    syncMode: "mirror",
  });
  createExternalMessageMappingSync({
    workspaceId: workspace.id,
    integrationId: agentBotIntegration.id,
    channelBindingId: agentBotChannelBinding.id,
    direction: "inbound",
    externalMessageId: "om_source",
    externalThreadId: "om_root",
    externalSenderId: "ou_mina",
    agentSpaceMessageId: "agent-space-source-message-1",
    metadataJson: {
      agentId: "Atlas",
      botBindingId: agentBotIntegration.id,
    },
  });
  updateExternalIntegrationStatusSync({
    workspaceId: workspace.id,
    integrationId: agentBotIntegration.id,
    status: "disabled",
  });

  const queuedOutbox = queueFeishuChannelReplyOutboxSync({
    workspaceId: workspace.id,
    channelName: "tour visit",
    text: "Atlas reply for Feishu",
    agentSpaceMessageId: "agent-space-agent-reply-1",
    sourceAgentSpaceMessageId: "agent-space-source-message-1",
  });

  assert.deepEqual(queuedOutbox, []);
});

test("Agent status cards are queued back to the source Feishu thread", databaseTestOptions, () => {
  const workspace = createWorkspaceWithTourVisitChannel({
    slug: "feishu-thread-status-card",
    name: "Feishu Thread Status Card",
    createdBy: "system",
  });
  const integration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: FEISHU_PROVIDER_ID,
    displayName: "Feishu",
    transportMode: "http_webhook",
  });
  const channelBinding = upsertExternalChannelBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    channelName: "tour visit",
    externalChatId: "oc_tour",
    externalChatType: "group",
    externalChatName: "Tour Visit",
    status: "active",
    syncMode: "mirror",
  });
  createExternalMessageMappingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    channelBindingId: channelBinding.id,
    direction: "inbound",
    externalMessageId: "om_source",
    externalThreadId: "om_root",
    externalSenderId: "ou_mina",
    agentSpaceMessageId: "agent-space-source-message-1",
    metadataJson: {},
  });
  const previousAppUrl = process.env.AGENT_SPACE_APP_URL;
  process.env.AGENT_SPACE_APP_URL = "https://agentspace.test";

  try {
    const queuedOutbox = queueFeishuAgentStatusCardOutboxSync({
      workspaceId: workspace.id,
      channelName: "tour visit",
      status: "thinking",
      agentNames: ["Atlas"],
      message: "AgentSpace has queued the requested agent work.",
      sourceAgentSpaceMessageId: "agent-space-source-message-1",
    });

    assert.equal(queuedOutbox.length, 1);
    assert.equal(queuedOutbox[0]?.targetExternalChatId, "oc_tour");
    assert.equal(queuedOutbox[0]?.targetExternalThreadId, "om_root");

    const payload = JSON.parse(queuedOutbox[0]?.payloadJson ?? "{}") as {
      msg_type?: string;
      reply_to_message_id?: string;
      content?: string;
    };
    assert.equal(payload.msg_type, "interactive");
    assert.equal(payload.reply_to_message_id, "om_root");

    const card = JSON.parse(String(payload.content)) as {
      header: { template: string; title: { content: string } };
      elements: Array<{
        content?: string;
        actions?: Array<{ url?: string; text?: { content?: string } }>;
      }>;
    };
    assert.equal(card.header.template, "blue");
    assert.equal(card.header.title.content, "Atlas · AgentSpace");
    assert.match(card.elements[0]?.content ?? "", /\*\*Atlas\*\* · Thinking/);
    assert.equal(card.elements[1]?.actions?.[0]?.text?.content, "Open AgentSpace");
    assert.equal(card.elements[1]?.actions?.[0]?.url, "https://agentspace.test/w/feishu-thread-status-card/im?focus=channel%3Atour+visit");
  } finally {
    if (previousAppUrl === undefined) {
      delete process.env.AGENT_SPACE_APP_URL;
    } else {
      process.env.AGENT_SPACE_APP_URL = previousAppUrl;
    }
  }
});

test("AgentSpace replies with attachments queue text and attachment outbox items", databaseTestOptions, () => {
  const workspace = createWorkspaceWithTourVisitChannel({
    slug: "feishu-thread-reply-attachments",
    name: "Feishu Thread Reply Attachments",
    createdBy: "system",
  });
  const integration = createExternalIntegrationSync({
    workspaceId: workspace.id,
    provider: FEISHU_PROVIDER_ID,
    displayName: "Feishu",
    transportMode: "http_webhook",
  });
  const channelBinding = upsertExternalChannelBindingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    channelName: "tour visit",
    externalChatId: "oc_tour",
    externalChatType: "group",
    externalChatName: "Tour Visit",
    status: "active",
    syncMode: "mirror",
  });
  createExternalMessageMappingSync({
    workspaceId: workspace.id,
    integrationId: integration.id,
    channelBindingId: channelBinding.id,
    direction: "inbound",
    externalMessageId: "om_source",
    externalThreadId: "om_root",
    agentSpaceMessageId: "agent-space-source-message-1",
    metadataJson: {},
  });

  const queuedOutbox = queueFeishuChannelReplyOutboxSync({
    workspaceId: workspace.id,
    channelName: "tour visit",
    text: "Atlas reply with chart",
    attachments: [createAttachment({
      id: "att-chart",
      fileName: "chart.png",
      mediaType: "image/png",
      kind: "image",
      storedPath: "/tmp/chart.png",
      storageUrl: "https://storage.example/signed-chart.png?X-Amz-Signature=secret",
    })],
    agentSpaceMessageId: "agent-space-agent-reply-1",
    sourceAgentSpaceMessageId: "agent-space-source-message-1",
  });

  assert.equal(queuedOutbox.length, 2);
  const textPayload = JSON.parse(queuedOutbox[0]?.payloadJson ?? "{}") as Record<string, unknown>;
  assert.equal(textPayload.msg_type, "text");
  assert.equal(textPayload.reply_to_message_id, "om_root");
  const attachmentPayload = JSON.parse(queuedOutbox[1]?.payloadJson ?? "{}") as {
    agent_space_payload_kind?: string;
    reply_to_message_id?: string;
    attachment?: {
      id?: string;
      fileName?: string;
      mediaType?: string;
      storedPath?: string;
    };
  };
  assert.equal(attachmentPayload.agent_space_payload_kind, "agent_space_feishu_attachment_v1");
  assert.equal(attachmentPayload.reply_to_message_id, "om_root");
  assert.deepEqual(attachmentPayload.attachment, {
    id: "att-chart",
    fileName: "chart.png",
    mediaType: "image/png",
    sizeBytes: 5,
    kind: "image",
    storedPath: "/tmp/chart.png",
    storageProvider: "local",
  });
  assert.equal(queuedOutbox[1]?.payloadJson.includes("signed-chart.png"), false);
  assert.equal(queuedOutbox[1]?.payloadJson.includes("X-Amz-Signature"), false);
});

function createAttachment(input: {
  id: string;
  fileName: string;
  mediaType: string;
  kind: MessageAttachment["kind"];
  storedPath: string;
  storageUrl?: string;
}): MessageAttachment {
  return {
    id: input.id,
    fileName: input.fileName,
    mediaType: input.mediaType,
    sizeBytes: 5,
    kind: input.kind,
    storedPath: input.storedPath,
    storageProvider: "local",
    storageUrl: input.storageUrl,
  };
}

function createWorkspaceWithTourVisitChannel(input: {
  slug: string;
  name: string;
  createdBy: string;
}) {
  const workspace = createWorkspaceSync(input);
  createStoredChannelSync({
    name: "tour visit",
    kind: "group",
    humanMembers: 0,
    humanMemberNames: [],
    employeeNames: ["Atlas"],
  }, workspace.id);
  return workspace;
}
