import { createHash } from "node:crypto";
import type { ApprovalRequest } from "@agent-space/domain/workspace";
import type { SlackApprovalBlockActionPayload } from "./outbound.ts";

export function buildSlackApprovalBlockAction(approval: ApprovalRequest): SlackApprovalBlockActionPayload {
  return {
    approvalId: approval.id,
    payloadHash: buildSlackApprovalPayloadHash(approval),
    token: "",
  };
}

export function buildSlackApprovalPayloadHash(approval: ApprovalRequest): string {
  return createHash("sha256")
    .update(JSON.stringify({
      id: approval.id,
      type: approval.type,
      sourceId: approval.sourceId,
      agentId: approval.agentId,
      channelName: approval.channelName,
      contentPreview: approval.contentPreview,
      metadata: approval.metadata ?? {},
    }), "utf8")
    .digest("hex");
}
