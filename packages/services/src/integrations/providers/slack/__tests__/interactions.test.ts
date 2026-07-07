import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSlackApprovalBlockAction,
  buildSlackApprovalPayloadHash,
  isSlackBlockActionsPayload,
  isSlackInteractionPayload,
  parseSlackApprovalBlockActionPayload,
  processSlackBlockActionCallback,
  type SlackBlockActionCallbackDependencies,
} from "../interactions.ts";
import type { ApprovalRequest } from "@agent-space/domain/workspace";

test("parses Slack approval Block Kit action values", () => {
  const payload = {
    type: "block_actions",
    user: {
      id: "U123",
    },
    actions: [{
      action_id: "agentspace_approval_approve",
      value: JSON.stringify({
        provider: "slack",
        kind: "runtime_tool_approval",
        approvalId: "approval-1",
        payloadHash: "payload-hash-1",
      }),
    }],
  };

  assert.equal(isSlackInteractionPayload(payload), true);
  assert.equal(isSlackBlockActionsPayload(payload), true);
  assert.deepEqual(parseSlackApprovalBlockActionPayload(payload), {
    approvalId: "approval-1",
    decision: "approved",
    payloadHash: "payload-hash-1",
    token: "",
  });
});

test("builds stable Slack approval action hashes without storing raw action payloads", () => {
  const approval = {
    id: "approval-1",
    type: "runtime_tool" as const,
    sourceId: "task-1",
    agentId: "Atlas",
    channelName: "general",
    status: "pending" as const,
    contentPreview: "Run shell command",
    metadata: {
      toolName: "shell",
      toolInput: {
        command: "npm test",
      },
    },
    createdAt: "2026-07-08T00:00:00.000Z",
  };

  const action = buildSlackApprovalBlockAction(approval);
  assert.equal(action.approvalId, "approval-1");
  assert.equal(action.payloadHash, buildSlackApprovalPayloadHash(approval));
  assert.equal(action.token, "");
  assert.match(action.payloadHash, /^[a-f0-9]{64}$/);
  assert.notEqual(buildSlackApprovalPayloadHash({
    ...approval,
    contentPreview: "Run another command",
  }), action.payloadHash);
});

test("dispatches Slack Block Kit Feishu data operation approvals to provider execution", async () => {
  const approval: ApprovalRequest = {
    id: "approval-feishu-1",
    type: "external_data_operation",
    sourceId: "operation-run-1",
    agentId: "Atlas",
    channelName: "general",
    status: "pending",
    contentPreview: "Atlas requested sheets.update_range.",
    metadata: {
      provider: "feishu",
      operationRunId: "operation-run-1",
      operationType: "sheets.update_range",
      taskId: "task-approval-1",
      sourceAgentSpaceMessageId: "agent-space-source-1",
    },
    createdAt: "2026-07-08T00:00:00.000Z",
  };
  const action = buildSlackApprovalBlockAction(approval);
  const reviewInputs: Array<{
    workspaceId: string;
    approvalId: string;
    decision: "approved" | "rejected";
    reviewerComment?: string;
    baseUrl?: string;
  }> = [];
  const dependencies = {
    recordEvent: () => ({} as never),
    updateEventStatus: () => ({} as never),
    readUserBinding: () => ({
      id: "binding-1",
      status: "active",
      userId: "reviewer-1",
      externalUserId: "U123",
    } as never),
    readMembership: () => ({
      role: "admin",
    } as never),
    listApprovals: () => [approval],
    reviewRuntimeApproval: () => {
      throw new Error("runtime approval review should not run");
    },
    reviewFeishuDataOperation: async (input) => {
      reviewInputs.push(input);
      return {
        approval: {
          ...approval,
          status: input.decision,
          reviewerComment: input.reviewerComment,
        },
        execution: {
          runId: "operation-run-1",
          result: {
            ok: true,
            data: {
              revision: 19,
            },
          },
        },
      } as never;
    },
    recordAudit: () => undefined,
  } as SlackBlockActionCallbackDependencies;

  const result = await processSlackBlockActionCallback({
    context: {
      workspaceId: "workspace-1",
      integrationId: "slack-integration-1",
      provider: "slack",
    },
    payload: {
      type: "block_actions",
      team: {
        id: "T123",
      },
      user: {
        id: "U123",
      },
      trigger_id: "trigger-feishu-approval-1",
      actions: [{
        action_id: "agentspace_approval_approve",
        value: JSON.stringify({
          ...action,
          decision: "approved",
        }),
      }],
    },
    feishuBaseUrl: "https://feishu.test/open-apis",
    dependencies,
  });

  assert.equal(result.handled, true);
  assert.equal(result.eventStatus, "processed");
  assert.equal(result.approvalId, approval.id);
  assert.equal(result.execution?.runId, "operation-run-1");
  assert.equal(reviewInputs.length, 1);
  assert.equal(reviewInputs[0]?.workspaceId, "workspace-1");
  assert.equal(reviewInputs[0]?.approvalId, approval.id);
  assert.equal(reviewInputs[0]?.decision, "approved");
  assert.equal(reviewInputs[0]?.baseUrl, "https://feishu.test/open-apis");
  assert.match(reviewInputs[0]?.reviewerComment ?? "", /^Reviewed from Slack Block Kit by user ref_[a-f0-9]{8}\.$/);
  assert.doesNotMatch(reviewInputs[0]?.reviewerComment ?? "", /U123/);
});

test("rejects unsupported external data operation providers from Slack approvals", async () => {
  const approval: ApprovalRequest = {
    id: "approval-unknown-1",
    type: "external_data_operation",
    sourceId: "operation-run-unknown-1",
    agentId: "Atlas",
    channelName: "general",
    status: "pending",
    contentPreview: "Atlas requested an external write.",
    metadata: {
      provider: "unknown-provider",
    },
    createdAt: "2026-07-08T00:00:00.000Z",
  };
  const action = buildSlackApprovalBlockAction(approval);
  const dependencies = {
    recordEvent: () => ({} as never),
    updateEventStatus: () => ({} as never),
    readUserBinding: () => ({
      id: "binding-1",
      status: "active",
      userId: "reviewer-1",
      externalUserId: "U123",
    } as never),
    readMembership: () => ({
      role: "owner",
    } as never),
    listApprovals: () => [approval],
    reviewRuntimeApproval: () => {
      throw new Error("runtime approval review should not run");
    },
    reviewFeishuDataOperation: async () => {
      throw new Error("Feishu approval review should not run");
    },
    recordAudit: () => undefined,
  } as SlackBlockActionCallbackDependencies;

  const result = await processSlackBlockActionCallback({
    context: {
      workspaceId: "workspace-1",
      integrationId: "slack-integration-1",
      provider: "slack",
    },
    payload: {
      type: "block_actions",
      user: {
        id: "U123",
      },
      trigger_id: "trigger-unsupported-approval-1",
      actions: [{
        action_id: "agentspace_approval_reject",
        value: JSON.stringify({
          ...action,
          decision: "rejected",
        }),
      }],
    },
    dependencies,
  });

  assert.equal(result.handled, false);
  assert.equal(result.eventStatus, "failed");
  assert.equal(result.reasonCode, "slack_block_action_approval_type_unsupported");
});
