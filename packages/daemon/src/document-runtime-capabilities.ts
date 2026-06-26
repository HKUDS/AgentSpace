import type { RuntimeToolCapability } from "@agent-space/domain";
import {
  buildFeishuLarkCliRuntimeToolCapability,
  type AgentDocumentContext,
  type FeishuLarkCliResourceGrant,
} from "@agent-space/services";

export function buildDocumentRuntimeToolCapabilities(
  agentDocumentContexts: AgentDocumentContext[],
  options?: {
    canCreateGoogleSheet?: boolean;
    feishuLarkCliResourceGrants?: FeishuLarkCliResourceGrant[];
  },
): RuntimeToolCapability[] {
  const hasReadableGoogleWorkspaceDocument = agentDocumentContexts.some(({ document, allowedActions }) =>
    allowedActions.includes("view") &&
    document.storageMode === "external" &&
    document.externalProvider === "google_workspace",
  );
  const hasWritableGoogleSheet = agentDocumentContexts.some(({ document, allowedActions }) =>
    allowedActions.includes("edit") &&
    document.kind === "sheet" &&
    document.storageMode === "external" &&
    document.externalProvider === "google_workspace",
  );
  const hasForwardableGoogleSheet = agentDocumentContexts.some(({ document, allowedActions }) =>
    allowedActions.includes("forward") &&
    document.kind === "sheet" &&
    document.storageMode === "external" &&
    document.externalProvider === "google_workspace",
  );
  const hasWritableGoogleDoc = agentDocumentContexts.some(({ document, allowedActions }) =>
    allowedActions.includes("edit") &&
    document.kind === "document" &&
    document.storageMode === "external" &&
    document.externalProvider === "google_workspace",
  );
  const hasEditableDocument = agentDocumentContexts.some(({ allowedActions }) => allowedActions.includes("edit"));
  const hasWritableFeishuResource = options?.feishuLarkCliResourceGrants?.some((grant) =>
    grant.allowedOperations?.includes("write")
  ) ?? false;

  const capabilities: RuntimeToolCapability[] = [
    {
      id: "document-permission:agent-space-output",
      command: "agent-space",
      displayName: "AgentSpace document output permission",
      allowedShellPatterns: [
        "agent-space output text *",
        "agent-space output attach *",
        "agent-space output validate *",
        "agent-space output preview *",
        "agent-space output permission request-document *",
        ...(hasEditableDocument
          ? [
              "agent-space output document upsert *",
              "agent-space output document replace-block *",
              "agent-space output document insert-after *",
              "agent-space output document delete-block *",
            ]
          : []),
        ...(hasReadableGoogleWorkspaceDocument ? ["agent-space output sheets-result add *"] : []),
        ...(hasForwardableGoogleSheet ? ["agent-space output external-document link-google-sheet *"] : []),
        ...(options?.canCreateGoogleSheet ? ["agent-space output external-document create-google-sheet *"] : []),
        ...(hasWritableGoogleDoc ? ["agent-space output google-docs *"] : []),
        ...(hasWritableFeishuResource ? ["agent-space output feishu data-operation-approval *"] : []),
      ],
      source: "workspace",
    },
  ];

  if (hasReadableGoogleWorkspaceDocument || options?.canCreateGoogleSheet) {
    capabilities.push({
      id: "document-permission:google-workspace",
      command: "gws",
      displayName: "Google Workspace document permission",
      allowedShellPatterns: [
        ...(hasReadableGoogleWorkspaceDocument
          ? [
              "gws sheets spreadsheets values get *",
              "gws drive files get *",
            ]
          : []),
        "gws --version",
        ...(options?.canCreateGoogleSheet ? ["gws drive files create *"] : []),
        ...(hasWritableGoogleSheet
          ? [
              "gws sheets spreadsheets values append *",
              "gws sheets spreadsheets values update *",
              "gws sheets spreadsheets batchUpdate *",
              "gws sheets spreadsheets batch-update *",
            ]
          : []),
      ],
      source: "workspace",
    });
  }

  const feishuLarkCliCapability = buildFeishuLarkCliRuntimeToolCapability({
    id: "document-permission:feishu-lark-cli",
    source: "workspace",
    includeDiagnostics: Boolean(options?.feishuLarkCliResourceGrants?.length),
    resourceGrants: options?.feishuLarkCliResourceGrants ?? [],
  });
  if (feishuLarkCliCapability) {
    capabilities.push(feishuLarkCliCapability);
  }

  return capabilities;
}
