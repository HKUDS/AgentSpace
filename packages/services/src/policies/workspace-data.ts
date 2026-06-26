export type WorkspaceDataPolicyDecisionValue = "allow" | "deny";
export type WorkspaceDataPolicyClassification =
  | "native_workspace_content"
  | "external_untrusted_user_content";

export interface WorkspaceDataPolicyAllowedUses {
  storeInWorkspace: boolean;
  includeInSearch: boolean;
  includeInAgentContext: boolean;
}

export interface WorkspaceDataPolicyInput {
  workspaceId: string;
  source: {
    type: "external_message";
    provider: string;
    providerLabel?: string;
    externalEventId?: string;
    externalMessageId?: string;
    externalChatId?: string;
    trust?: string;
  };
  content: {
    kind: "message";
    hasAttachments?: boolean;
    contentHash?: string;
  };
}

export interface WorkspaceDataPolicyDecision {
  decision: WorkspaceDataPolicyDecisionValue;
  reasonCode: string;
  reason: string;
  classification: WorkspaceDataPolicyClassification;
  allowedUses: WorkspaceDataPolicyAllowedUses;
  auditData: Record<string, unknown>;
}

export function decideWorkspaceDataPolicyForExternalMessageSync(
  input: WorkspaceDataPolicyInput,
): WorkspaceDataPolicyDecision {
  const validation = validateWorkspaceDataPolicyInput(input);
  if (!validation.ok) {
    return {
      decision: "deny",
      reasonCode: validation.reasonCode,
      reason: validation.reason,
      classification: "external_untrusted_user_content",
      allowedUses: denyAllUses(),
      auditData: buildWorkspaceDataPolicyAuditData(input),
    };
  }

  return {
    decision: "allow",
    reasonCode: "workspace_data.external_untrusted_user_message_allowed",
    reason: "External untrusted user messages may be stored and used as ordinary workspace user content after source labeling.",
    classification: "external_untrusted_user_content",
    allowedUses: {
      storeInWorkspace: true,
      includeInSearch: true,
      includeInAgentContext: true,
    },
    auditData: buildWorkspaceDataPolicyAuditData(input),
  };
}

function validateWorkspaceDataPolicyInput(input: WorkspaceDataPolicyInput): {
  ok: true;
} | {
  ok: false;
  reasonCode: string;
  reason: string;
} {
  if (!input.workspaceId.trim()) {
    return {
      ok: false,
      reasonCode: "workspace_data.workspace_missing",
      reason: "Workspace data policy requires a workspace id.",
    };
  }
  if (!input.source.provider.trim()) {
    return {
      ok: false,
      reasonCode: "workspace_data.provider_missing",
      reason: "Workspace data policy requires an external provider id.",
    };
  }
  if (input.source.trust !== "untrusted_user_message") {
    return {
      ok: false,
      reasonCode: "workspace_data.external_trust_invalid",
      reason: "External message input must be labeled as an untrusted user message.",
    };
  }
  return { ok: true };
}

function denyAllUses(): WorkspaceDataPolicyAllowedUses {
  return {
    storeInWorkspace: false,
    includeInSearch: false,
    includeInAgentContext: false,
  };
}

function buildWorkspaceDataPolicyAuditData(input: WorkspaceDataPolicyInput): Record<string, unknown> {
  return {
    workspaceId: input.workspaceId,
    sourceType: input.source.type,
    provider: input.source.provider,
    providerLabel: input.source.providerLabel,
    externalEventId: input.source.externalEventId,
    externalMessageId: input.source.externalMessageId,
    externalChatId: input.source.externalChatId,
    trust: input.source.trust,
    contentKind: input.content.kind,
    hasAttachments: Boolean(input.content.hasAttachments),
    hasContentHash: Boolean(input.content.contentHash),
  };
}
