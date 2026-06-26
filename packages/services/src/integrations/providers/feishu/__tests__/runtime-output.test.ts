import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FEISHU_LARK_CLI_RESULT_MANIFEST_KIND,
  FEISHU_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH,
} from "../lark-cli.ts";
import {
  FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_KIND,
  FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_RELATIVE_PATH,
  appendFeishuRuntimeDataOperationRequest,
  applyFeishuLarkCliResultManifestOperations,
  applyFeishuRuntimeDataOperationRequests,
} from "../runtime-output.ts";

test("applies Feishu lark-cli result manifests as scoped Agent read evidence", () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-feishu-lark-cli-result-"));
  const manifestPath = join(workDir, FEISHU_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH);
  try {
    mkdirSync(join(workDir, "runtime-output"), { recursive: true });
    writeFileSync(
      manifestPath,
      JSON.stringify({
        kind: FEISHU_LARK_CLI_RESULT_MANIFEST_KIND,
        schemaVersion: 1,
        ok: true,
        operationType: "docs.read_document",
        providerResourceType: "doc",
        providerResourceToken: "doccnABC123",
        responseSummary: "Doc blocks fetched.",
        data: {
          documentId: "doccnABC123",
        },
      }),
      "utf8",
    );
    const planned: unknown[] = [];
    const finished: unknown[] = [];

    const result = applyFeishuLarkCliResultManifestOperations({
      workDir,
      workspaceId: "workspace-1",
      actorName: "Atlas",
      resourceGrants: [{
        integrationId: "integration-1",
        resourceBindingId: "binding-1",
        providerResourceType: "doc",
        providerResourceToken: "doccnABC123",
        allowedOperations: ["read"],
      }],
      recordPlan: ((input: unknown) => {
        planned.push(input);
        return {
          id: "external-data-operation-agent-doc-read",
          status: "running",
        };
      }) as never,
      recordFinish: ((input: unknown) => {
        finished.push(input);
        return {
          id: "external-data-operation-agent-doc-read",
          status: "succeeded",
        };
      }) as never,
    });

    assert.deepEqual(result.operationRunIds, ["external-data-operation-agent-doc-read"]);
    assert.equal(result.warnings.length, 0);
    assert.match(result.statusMessages.join("\n"), /recorded as succeeded/);
    assert.equal(planned.length, 1);
    assert.equal(finished.length, 1);
    assert.deepEqual(planned[0], {
      context: {
        workspaceId: "workspace-1",
        integrationId: "integration-1",
        provider: "feishu",
      },
      resourceBindingId: "binding-1",
      request: {
        operationType: "docs.read_document",
        providerResourceType: "doc",
        providerResourceToken: "doccnABC123",
        actorType: "agent",
        actorId: "Atlas",
        parameters: {
          source: "lark-cli-result-manifest",
          resultManifestPath: FEISHU_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH,
          feishuGovernance: {
            provider: "feishu",
            actorType: "agent",
            agentId: "Atlas",
          },
        },
      },
      requestJson: {
        source: "lark-cli-result-manifest",
        resultManifestPath: FEISHU_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH,
        operationKind: "read",
        governanceContext: {
          provider: "feishu",
          actorType: "agent",
          agentId: "Atlas",
        },
      },
      status: "running",
    });
    const finishInput = finished[0] as {
      result: {
        data?: Record<string, unknown>;
      };
    };
    assert.equal(finishInput.result.data?.operationRunId, "external-data-operation-agent-doc-read");
    assert.equal(JSON.stringify(finishInput).includes("Doc blocks fetched"), false);
    assert.equal(JSON.stringify(finishInput).includes("doccnABC123"), false);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("refuses unbound or write Feishu lark-cli result manifests", () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-feishu-lark-cli-unbound-"));
  const manifestPath = join(workDir, FEISHU_LARK_CLI_RESULT_MANIFEST_RELATIVE_PATH);
  try {
    mkdirSync(join(workDir, "runtime-output"), { recursive: true });
    writeFileSync(
      manifestPath,
      JSON.stringify({
        kind: FEISHU_LARK_CLI_RESULT_MANIFEST_KIND,
        schemaVersion: 1,
        ok: true,
        operationType: "docs.read_document",
        providerResourceType: "doc",
        providerResourceToken: "doccnSecretUnbound",
      }),
      "utf8",
    );
    const unbound = applyFeishuLarkCliResultManifestOperations({
      workDir,
      workspaceId: "workspace-1",
      actorName: "Atlas",
      resourceGrants: [],
      recordPlan: (() => {
        throw new Error("should not record");
      }) as never,
    });

    assert.equal(unbound.operationRunIds.length, 0);
    assert.match(unbound.warnings.join("\n"), /did not match an active AgentSpace resource binding/);

    writeFileSync(
      manifestPath,
      JSON.stringify({
        kind: FEISHU_LARK_CLI_RESULT_MANIFEST_KIND,
        schemaVersion: 1,
        ok: true,
        operationType: "docs.update_document",
        providerResourceType: "doc",
        providerResourceToken: "doccnABC123",
      }),
      "utf8",
    );
    const write = applyFeishuLarkCliResultManifestOperations({
      workDir,
      workspaceId: "workspace-1",
      actorName: "Atlas",
      resourceGrants: [{
        integrationId: "integration-1",
        resourceBindingId: "binding-1",
        providerResourceType: "doc",
        providerResourceToken: "doccnABC123",
        allowedOperations: ["read", "write"],
      }],
      recordPlan: (() => {
        throw new Error("should not record writes");
      }) as never,
    });

    assert.equal(write.operationRunIds.length, 0);
    assert.match(write.warnings.join("\n"), /write result manifest was ignored/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("applies Feishu runtime data-operation requests as scoped approval plans", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-feishu-runtime-output-"));
  try {
    appendFeishuRuntimeDataOperationRequest(workDir, {
      operationType: "sheets.update_range",
      providerResourceType: "sheet",
      providerResourceToken: "shtcnABC123",
      parameters: {
        range: "Sheet1!A1:B1",
        values: [["AgentSpace smoke"]],
      },
      contentPreview: "Update shtcnABC123 smoke range.",
    });
    const planned: unknown[] = [];

    const result = await applyFeishuRuntimeDataOperationRequests({
      workDir,
      workspaceId: "workspace-1",
      actorName: "Atlas",
      sourceTaskQueueId: "task-1",
      sourceChannelName: "research",
      sourceAgentSpaceMessageId: "message-1",
      resourceGrants: [{
        integrationId: "integration-1",
        resourceBindingId: "binding-1",
        providerResourceType: "sheet",
        providerResourceToken: "shtcnABC123",
        allowedOperations: ["read", "write"],
      }],
      planWriteOperationWithApproval: (async (input: unknown) => {
        planned.push(input);
        return {
          runId: "external-data-operation-1",
          result: {
            ok: false,
            errorCode: "feishu.data_operation_requires_approval",
          },
          approval: {
            id: "approval-1",
          },
        };
      }) as never,
    });

    assert.deepEqual(result.operationRunIds, ["external-data-operation-1"]);
    assert.deepEqual(result.approvalIds, ["approval-1"]);
    assert.match(result.statusMessages.join("\n"), /approval request created/);
    assert.equal(result.warnings.length, 0);
    assert.equal(planned.length, 1);
    const input = planned[0] as {
      context: Record<string, unknown>;
      request: {
        operationType: string;
        providerResourceType: string;
        providerResourceToken: string;
        actorType: string;
        actorId?: string;
        parameters: Record<string, unknown>;
      };
      approval: {
        channelName: string;
        sourceId?: string;
        sourceAgentSpaceMessageId?: string;
        contentPreview?: string;
      };
    };
    assert.deepEqual(input.context, {
      workspaceId: "workspace-1",
      integrationId: "integration-1",
      provider: "feishu",
    });
    assert.equal(input.request.operationType, "sheets.update_range");
    assert.equal(input.request.providerResourceType, "sheet");
    assert.equal(input.request.providerResourceToken, "shtcnABC123");
    assert.equal(input.request.actorType, "agent");
    assert.equal(input.request.actorId, "Atlas");
    assert.deepEqual(input.request.parameters, {
      range: "Sheet1!A1:B1",
      values: [["AgentSpace smoke"]],
      channelName: "research",
      taskId: "task-1",
      feishuGovernance: {
        provider: "feishu",
        actorType: "agent",
        agentId: "Atlas",
        channelName: "research",
      },
    });
    assert.equal(input.approval.channelName, "research");
    assert.equal(input.approval.sourceId, "task-1");
    assert.equal(input.approval.sourceAgentSpaceMessageId, "message-1");
    assert.equal(input.approval.contentPreview, "Update [redacted] smoke range.");
    assert.deepEqual((input.approval as { metadata?: Record<string, unknown> }).metadata?.governanceContext, {
      provider: "feishu",
      actorType: "agent",
      agentId: "Atlas",
      channelName: "research",
    });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("queues identity binding cards when external guests request Feishu writes", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-feishu-runtime-output-"));
  const previousAppUrl = process.env.AGENT_SPACE_APP_URL;
  process.env.AGENT_SPACE_APP_URL = "https://agentspace.test";
  try {
    appendFeishuRuntimeDataOperationRequest(workDir, {
      operationType: "sheets.update_range",
      providerResourceType: "sheet",
      providerResourceToken: "shtcnGuestWrite",
      parameters: {
        range: "Sheet1!A1:B1",
        values: [["Guest write"]],
      },
      contentPreview: "Update guest range.",
    });
    const planned: unknown[] = [];
    const queuedCards: unknown[] = [];

    const result = await applyFeishuRuntimeDataOperationRequests({
      workDir,
      workspaceId: "workspace-1",
      actorName: "Atlas",
      sourceTaskQueueId: "task-guest-write",
      sourceChannelName: "research",
      sourceAgentSpaceMessageId: "message-guest-write",
      resourceGrants: [{
        integrationId: "integration-1",
        resourceBindingId: "binding-1",
        providerResourceType: "sheet",
        providerResourceToken: "shtcnGuestWrite",
        allowedOperations: ["read", "write"],
      }],
      readSourceMessageMapping: (() => ({
        id: "external-message-mapping-guest-write",
        workspaceId: "workspace-1",
        integrationId: "agent-bot-codex",
        channelBindingId: "channel-binding-research",
        direction: "inbound",
        externalMessageId: "om_guest_write",
        externalThreadId: "om_thread_guest_write",
        externalSenderId: "ou_raw_guest_user",
        agentSpaceMessageId: "message-guest-write",
        taskQueueId: "task-guest-write",
        metadataJson: JSON.stringify({
          actorType: "external_guest",
          agentId: "Codex",
          botBindingId: "agent-bot-codex",
          externalGuestReference: "f".repeat(64),
          externalGuestPermissionProfile: "channel_context_only",
          externalGuestRequireIdentityFor: ["writes", "approvals", "private_resources"],
        }),
        createdAt: "2026-06-26T00:00:00.000Z",
      })) as never,
      planWriteOperationWithApproval: (async (input: unknown) => {
        planned.push(input);
        return {
          runId: "external-data-operation-guest-write",
          result: {
            ok: false,
            errorCode: "feishu.data_operation_external_guest_requires_identity",
            data: {
              requireIdentity: true,
            },
          },
        };
      }) as never,
      queueAgentStatusCard: ((input: unknown) => {
        queuedCards.push(input);
        return [{ id: "outbox-identity-required" }];
      }) as never,
    });

    assert.deepEqual(result.operationRunIds, ["external-data-operation-guest-write"]);
    assert.deepEqual(result.approvalIds, []);
    assert.match(result.warnings.join("\n"), /feishu\.data_operation_external_guest_requires_identity/);
    assert.match(result.statusMessages.join("\n"), /identity binding notice queued/);
    assert.equal(planned.length, 1);
    const planInput = planned[0] as {
      actor?: Record<string, unknown>;
      request: {
        parameters: Record<string, unknown>;
      };
      approval: {
        metadata?: Record<string, unknown>;
      };
    };
    assert.deepEqual(planInput.actor, {
      actorType: "external_guest",
      providerUserRefHash: "f".repeat(64),
      permissionProfile: "channel_context_only",
      requireIdentityFor: ["writes", "approvals", "private_resources"],
      sourceChannelName: "research",
      agentId: "Codex",
      botBindingId: "agent-bot-codex",
    });
    assert.deepEqual(planInput.request.parameters.feishuGovernance, {
      provider: "feishu",
      actorType: "external_guest",
      agentId: "Codex",
      botBindingId: "agent-bot-codex",
      channelName: "research",
      externalActorReference: "f".repeat(64),
      externalGuestPermissionProfile: "channel_context_only",
      externalGuestRequireIdentityFor: ["writes", "approvals", "private_resources"],
    });
    assert.deepEqual(planInput.approval.metadata?.governanceContext, {
      provider: "feishu",
      actorType: "external_guest",
      agentId: "Codex",
      botBindingId: "agent-bot-codex",
      channelName: "research",
      externalActorReference: "f".repeat(64),
      externalGuestPermissionProfile: "channel_context_only",
      externalGuestRequireIdentityFor: ["writes", "approvals", "private_resources"],
    });
    assert.equal(queuedCards.length, 1);
    assert.deepEqual(queuedCards[0], {
      workspaceId: "workspace-1",
      channelName: "research",
      agentId: "Codex",
      status: "failed",
      agentNames: ["Codex"],
      message: "External guests must bind an AgentSpace identity before writing Feishu Docs, Sheets, or Base resources.",
      taskId: "task-guest-write",
      sourceAgentSpaceMessageId: "message-guest-write",
      actionUrl: "https://agentspace.test/w/workspace-1/settings/integrations#feishu-user-bindings",
    });
    assert.equal(JSON.stringify(planned).includes("ou_raw_guest_user"), false);
    assert.equal(JSON.stringify(queuedCards).includes("ou_raw_guest_user"), false);
  } finally {
    if (previousAppUrl === undefined) {
      delete process.env.AGENT_SPACE_APP_URL;
    } else {
      process.env.AGENT_SPACE_APP_URL = previousAppUrl;
    }
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("ignores Feishu runtime requests without writable bound grants", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-feishu-runtime-output-"));
  try {
    mkdirSync(join(workDir, "runtime-output"), { recursive: true });
    writeFileSync(
      join(workDir, FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_RELATIVE_PATH),
      JSON.stringify({
        kind: FEISHU_RUNTIME_DATA_OPERATION_REQUESTS_KIND,
        schemaVersion: 1,
        generatedBy: "agent-space-cli",
        requests: [{
          operationType: "sheets.update_range",
          providerResourceType: "sheet",
          providerResourceToken: "shtcnABC123",
          parameters: {
            range: "Sheet1!A1:B1",
            values: [["AgentSpace smoke"]],
          },
        }],
      }),
      "utf8",
    );

    const result = await applyFeishuRuntimeDataOperationRequests({
      workDir,
      workspaceId: "workspace-1",
      actorName: "Atlas",
      sourceTaskQueueId: "task-1",
      sourceChannelName: "research",
      resourceGrants: [{
        integrationId: "integration-1",
        resourceBindingId: "binding-1",
        providerResourceType: "sheet",
        providerResourceToken: "shtcnABC123",
        allowedOperations: ["read"],
      }],
      planWriteOperationWithApproval: (async () => {
        throw new Error("should not plan");
      }) as never,
    });

    assert.equal(result.operationRunIds.length, 0);
    assert.equal(result.approvalIds.length, 0);
    assert.match(result.warnings.join("\n"), /did not match an active writable AgentSpace resource binding/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
