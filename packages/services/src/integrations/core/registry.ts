import type { ExternalIntegrationProvider } from "@agent-space/db";
import type { ExternalDocumentProviderAdapter } from "./document-provider.ts";
import type { MessageTransportAdapter } from "./message-transport.ts";
import type { IntegrationHealth, IntegrationProviderDescriptor, IntegrationRuntimeContext } from "./types.ts";

export interface IntegrationProviderAdapter {
  descriptor: IntegrationProviderDescriptor;
  messageTransport?: MessageTransportAdapter;
  documentProvider?: ExternalDocumentProviderAdapter;
  checkHealth?: (context: IntegrationRuntimeContext) => Promise<IntegrationHealth> | IntegrationHealth;
}

const providerRegistry = new Map<ExternalIntegrationProvider, IntegrationProviderAdapter>();

export function registerIntegrationProviderAdapter(adapter: IntegrationProviderAdapter): void {
  providerRegistry.set(adapter.descriptor.provider, adapter);
}

export function readIntegrationProviderAdapter(
  provider: ExternalIntegrationProvider,
): IntegrationProviderAdapter | null {
  return providerRegistry.get(provider) ?? null;
}

export function listIntegrationProviderAdapters(): IntegrationProviderAdapter[] {
  return [...providerRegistry.values()].sort((left, right) =>
    left.descriptor.displayName.localeCompare(right.descriptor.displayName),
  );
}

export function clearIntegrationProviderAdaptersForTests(): void {
  providerRegistry.clear();
}
