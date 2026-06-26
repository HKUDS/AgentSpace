import type { ExternalIntegrationProvider } from "@agent-space/db";

export class IntegrationProviderError extends Error {
  readonly provider: ExternalIntegrationProvider;
  readonly code: string;

  constructor(input: {
    provider: ExternalIntegrationProvider;
    code: string;
    message: string;
    cause?: unknown;
  }) {
    super(input.message);
    this.name = "IntegrationProviderError";
    this.provider = input.provider;
    this.code = input.code;
    if (input.cause !== undefined) {
      this.cause = input.cause;
    }
  }
}

export function createIntegrationProviderError(input: {
  provider: ExternalIntegrationProvider;
  code: string;
  message: string;
  cause?: unknown;
}): IntegrationProviderError {
  return new IntegrationProviderError(input);
}
