import type { ExternalIntegrationProvider } from "@agent-space/db";
import type { IntegrationProviderAdapter } from "./registry.ts";
import type { IntegrationCapability } from "./types.ts";

export interface IntegrationProviderContractIssue {
  code: string;
  detail: string;
}

export interface IntegrationProviderContractReport {
  provider: ExternalIntegrationProvider;
  ok: boolean;
  issues: IntegrationProviderContractIssue[];
  capabilities: IntegrationCapability[];
  reusableCoreModules: string[];
}

export interface MessageTransportProviderOnboardingChecklist {
  provider: ExternalIntegrationProvider;
  providerOwnedFiles: string[];
  sharedTouchPoints: string[];
  reusableCoreModules: string[];
  reusableWebModules: string[];
  reusableCliModules: string[];
  estimatedProviderOwnedFileCount: number;
}

const DATA_PLANE_CAPABILITIES: IntegrationCapability[] = [
  "docs_data_plane",
  "sheets_data_plane",
  "base_data_plane",
];

const MESSAGE_TRANSPORT_REUSABLE_CORE_MODULES = [
  "packages/services/src/integrations/core/inbound-dispatch.ts",
  "packages/services/src/integrations/core/notices.ts",
  "packages/services/src/integrations/core/outbox.ts",
  "packages/services/src/integrations/core/references.ts",
  "packages/services/src/integrations/core/registry.ts",
  "packages/services/src/integrations/core/worker-metrics.ts",
];

export function validateIntegrationProviderAdapterContract(
  adapter: IntegrationProviderAdapter,
): IntegrationProviderContractReport {
  const descriptor = adapter.descriptor;
  const issues: IntegrationProviderContractIssue[] = [];
  const provider = descriptor.provider;
  const capabilities = [...descriptor.capabilities];

  pushIssueIf(issues, !provider.trim(), "provider_missing", "Descriptor provider id is required.");
  pushIssueIf(issues, !descriptor.displayName.trim(), "display_name_missing", "Descriptor display name is required.");
  pushIssueIf(issues, descriptor.supportedTransportModes.length === 0, "transport_modes_missing", "At least one transport mode is required.");
  pushIssueIf(issues, hasDuplicates(descriptor.capabilities), "capabilities_duplicate", "Descriptor capabilities must be unique.");
  pushIssueIf(issues, hasDuplicates(descriptor.supportedTransportModes), "transport_modes_duplicate", "Supported transport modes must be unique.");
  pushIssueIf(issues, hasDuplicates(descriptor.defaultScopes), "default_scopes_duplicate", "Default scopes must be unique.");
  pushIssueIf(issues, hasDuplicates(descriptor.resourceTypes), "resource_types_duplicate", "Resource types must be unique.");

  const declaresMessageTransport = descriptor.capabilities.includes("message_transport");
  if (declaresMessageTransport && !adapter.messageTransport) {
    issues.push({
      code: "message_transport_missing",
      detail: "Descriptor declares message_transport but adapter.messageTransport is missing.",
    });
  }
  if (!declaresMessageTransport && adapter.messageTransport) {
    issues.push({
      code: "message_transport_capability_missing",
      detail: "adapter.messageTransport exists but descriptor does not declare message_transport.",
    });
  }
  if (adapter.messageTransport && adapter.messageTransport.provider !== provider) {
    issues.push({
      code: "message_transport_provider_mismatch",
      detail: "adapter.messageTransport.provider must match descriptor.provider.",
    });
  }

  const declaresDataPlane = descriptor.capabilities.some((capability) =>
    DATA_PLANE_CAPABILITIES.includes(capability)
  );
  if (declaresDataPlane && !adapter.documentProvider) {
    issues.push({
      code: "document_provider_missing",
      detail: "Descriptor declares a data-plane capability but adapter.documentProvider is missing.",
    });
  }
  if (!declaresDataPlane && adapter.documentProvider) {
    issues.push({
      code: "document_provider_capability_missing",
      detail: "adapter.documentProvider exists but descriptor does not declare a data-plane capability.",
    });
  }
  if (adapter.documentProvider && adapter.documentProvider.provider !== provider) {
    issues.push({
      code: "document_provider_provider_mismatch",
      detail: "adapter.documentProvider.provider must match descriptor.provider.",
    });
  }

  return {
    provider,
    ok: issues.length === 0,
    issues,
    capabilities,
    reusableCoreModules: declaresMessageTransport ? [...MESSAGE_TRANSPORT_REUSABLE_CORE_MODULES] : [],
  };
}

export function buildMessageTransportProviderOnboardingChecklist(input: {
  provider: ExternalIntegrationProvider;
  includeSocketWorker?: boolean;
  includeHostedOAuth?: boolean;
  includeAttachments?: boolean;
  includeWebSettings?: boolean;
  includeCli?: boolean;
}): MessageTransportProviderOnboardingChecklist {
  const providerPath = `packages/services/src/integrations/providers/${input.provider}`;
  const providerOwnedFiles = [
    `${providerPath}/constants.ts`,
    `${providerPath}/adapter.ts`,
    `${providerPath}/credentials.ts`,
    `${providerPath}/events.ts`,
    `${providerPath}/normalize-message.ts`,
    `${providerPath}/inbound.ts`,
    `${providerPath}/outbound.ts`,
    `${providerPath}/health.ts`,
    `${providerPath}/evidence.ts`,
    `${providerPath}/index.ts`,
    `${providerPath}/__tests__/adapter.test.ts`,
    `${providerPath}/__tests__/events.test.ts`,
    `${providerPath}/__tests__/normalize-message.test.ts`,
    `${providerPath}/__tests__/inbound.test.ts`,
    `${providerPath}/__tests__/outbound.test.ts`,
    `${providerPath}/__tests__/health.test.ts`,
    `${providerPath}/__tests__/evidence.test.ts`,
    ...(input.includeSocketWorker ? [
      `${providerPath}/socket-worker.ts`,
      `${providerPath}/__tests__/socket-worker.test.ts`,
    ] : []),
    ...(input.includeHostedOAuth ? [
      `${providerPath}/oauth.ts`,
      `${providerPath}/__tests__/oauth.test.ts`,
    ] : []),
    ...(input.includeAttachments ? [
      `${providerPath}/attachments.ts`,
      `${providerPath}/__tests__/attachments.test.ts`,
    ] : []),
  ];

  const sharedTouchPoints = [
    "packages/services/src/index.ts",
    ...(input.includeWebSettings ? [
      "apps/web/features/integrations/<provider>/<provider>-integration-settings-panel.tsx",
      "apps/web/features/integrations/<provider>/<provider>-settings-data.ts",
    ] : []),
    ...(input.includeCli ? [
      "apps/cli/src/commands/integrations/<provider>.ts",
      "apps/cli/src/commands/integrations/index.ts",
    ] : []),
  ].map((item) => item.replaceAll("<provider>", input.provider));

  return {
    provider: input.provider,
    providerOwnedFiles,
    sharedTouchPoints,
    reusableCoreModules: [...MESSAGE_TRANSPORT_REUSABLE_CORE_MODULES],
    reusableWebModules: input.includeWebSettings
      ? [
        "apps/web/features/integrations/integration-health-outbox-panel.tsx",
        "apps/web/features/integrations/integration-settings-cards.tsx",
      ]
      : [],
    reusableCliModules: input.includeCli
      ? [
        "apps/cli/src/commands/integrations/outbox.ts",
      ]
      : [],
    estimatedProviderOwnedFileCount: providerOwnedFiles.length,
  };
}

function pushIssueIf(
  issues: IntegrationProviderContractIssue[],
  condition: boolean,
  code: string,
  detail: string,
): void {
  if (condition) {
    issues.push({ code, detail });
  }
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}
