export type AgentActionPolicyDecisionValue = "allow" | "require_approval" | "deny";
export type AgentActionRiskLevel = "low" | "medium" | "high";
export type AgentActionReviewerRole = "owner" | "admin" | "agent_owner" | "channel_manager";

export type AgentActionPolicyActor =
  | {
    type: "agent";
    agentId: string;
    ownerUserId?: string;
  }
  | {
    type: "user";
    userId: string;
  }
  | {
    type: "system";
    systemId?: string;
  };

export type AgentActionType =
  | "runtime.use"
  | "message.post"
  | "external_message.send"
  | "task.create"
  | "task.handoff"
  | "document.read"
  | "document.write"
  | "external_document.read"
  | "external_document.write"
  | "file.write"
  | "file.delete"
  | "skill.invoke";

export interface AgentActionPolicyInput {
  workspaceId: string;
  actor: AgentActionPolicyActor;
  channelName?: string;
  taskId?: string;
  runtimeId?: string;
  action: {
    type: AgentActionType;
    resourceType?: string;
    resourceId?: string;
    operationSummary: string;
    payloadHash?: string;
    riskLevel?: AgentActionRiskLevel;
    provider?: string;
  };
}

export interface AgentActionPolicyDecision {
  decision: AgentActionPolicyDecisionValue;
  reasonCode: string;
  reason: string;
  approvalType?: string;
  requiredReviewerRole?: AgentActionReviewerRole;
  auditData?: Record<string, unknown>;
}

export function decideAgentActionPolicySync(input: AgentActionPolicyInput): AgentActionPolicyDecision {
  const validation = validateAgentActionPolicyInput(input);
  if (!validation.ok) {
    return {
      decision: "deny",
      reasonCode: validation.reasonCode,
      reason: validation.reason,
      auditData: buildAgentActionPolicyAuditData(input),
    };
  }

  if (input.action.type === "external_document.write") {
    return {
      decision: "require_approval",
      reasonCode: "agent_action.external_document_write_requires_approval",
      reason: "External document write actions require AgentSpace approval before execution.",
      approvalType: "external_data_operation",
      requiredReviewerRole: "channel_manager",
      auditData: buildAgentActionPolicyAuditData(input),
    };
  }

  if (input.action.type === "external_message.send") {
    if (input.action.riskLevel === "low") {
      return {
        decision: "allow",
        reasonCode: "agent_action.low_risk_external_message_send_allowed",
        reason: "Low-risk external transport messages are allowed after provider binding checks pass.",
        auditData: buildAgentActionPolicyAuditData(input),
      };
    }
    return {
      decision: "require_approval",
      reasonCode: "agent_action.external_message_send_requires_approval",
      reason: "Sending messages to an external system requires AgentSpace policy approval.",
      approvalType: "external_message_send",
      requiredReviewerRole: "channel_manager",
      auditData: buildAgentActionPolicyAuditData(input),
    };
  }

  if (input.action.type === "external_document.read") {
    return {
      decision: "allow",
      reasonCode: "agent_action.external_document_read_allowed",
      reason: "External document reads are allowed after provider scope, binding, and AgentSpace resource checks pass.",
      auditData: buildAgentActionPolicyAuditData(input),
    };
  }

  if (input.action.riskLevel === "high") {
    return {
      decision: "require_approval",
      reasonCode: "agent_action.high_risk_action_requires_approval",
      reason: "High-risk Agent actions require AgentSpace approval before execution.",
      approvalType: "agent_action",
      requiredReviewerRole: "admin",
      auditData: buildAgentActionPolicyAuditData(input),
    };
  }

  return {
    decision: "allow",
    reasonCode: "agent_action.allowed_by_default_policy",
    reason: "Agent action is allowed by the default AgentSpace action policy.",
    auditData: buildAgentActionPolicyAuditData(input),
  };
}

function validateAgentActionPolicyInput(input: AgentActionPolicyInput): {
  ok: true;
} | {
  ok: false;
  reasonCode: string;
  reason: string;
} {
  if (!input.workspaceId.trim()) {
    return {
      ok: false,
      reasonCode: "agent_action.workspace_missing",
      reason: "Agent action policy requires a workspace id.",
    };
  }
  if (!input.action.operationSummary.trim()) {
    return {
      ok: false,
      reasonCode: "agent_action.operation_summary_missing",
      reason: "Agent action policy requires an operation summary.",
    };
  }
  if (input.actor.type === "agent" && !input.actor.agentId.trim()) {
    return {
      ok: false,
      reasonCode: "agent_action.actor_missing",
      reason: "Agent action policy requires an agent id for agent actors.",
    };
  }
  if (input.actor.type === "user" && !input.actor.userId.trim()) {
    return {
      ok: false,
      reasonCode: "agent_action.actor_missing",
      reason: "Agent action policy requires a user id for user actors.",
    };
  }
  return { ok: true };
}

function buildAgentActionPolicyAuditData(input: AgentActionPolicyInput): Record<string, unknown> {
  return {
    workspaceId: input.workspaceId,
    actorType: input.actor.type,
    actorId: readAgentActionPolicyActorId(input.actor),
    channelName: input.channelName,
    taskId: input.taskId,
    runtimeId: input.runtimeId,
    actionType: input.action.type,
    provider: input.action.provider,
    resourceType: input.action.resourceType,
    resourceId: input.action.resourceId,
    riskLevel: input.action.riskLevel,
    hasPayloadHash: Boolean(input.action.payloadHash),
  };
}

function readAgentActionPolicyActorId(actor: AgentActionPolicyActor): string | undefined {
  if (actor.type === "agent") {
    return actor.agentId;
  }
  if (actor.type === "user") {
    return actor.userId;
  }
  return actor.systemId;
}
