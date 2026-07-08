import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMessageTransportProviderOnboardingChecklist,
  createFakeIntegrationProviderAdapter,
  validateIntegrationProviderAdapterContract,
  type IntegrationProviderAdapter,
} from "./index.ts";

test("validates reusable provider adapter contracts", () => {
  const report = validateIntegrationProviderAdapterContract(createFakeIntegrationProviderAdapter());

  assert.equal(report.provider, "fake");
  assert.equal(report.ok, true);
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.capabilities, ["message_transport", "docs_data_plane"]);
  assert.ok(report.reusableCoreModules.includes("packages/services/src/integrations/core/inbound-dispatch.ts"));
});

test("reports actionable provider adapter contract issues", () => {
  const brokenAdapter: IntegrationProviderAdapter = {
    descriptor: {
      provider: "broken",
      displayName: "",
      capabilities: ["message_transport", "message_transport"],
      supportedTransportModes: [],
      defaultScopes: ["messages:read", "messages:read"],
      resourceTypes: [],
    },
    messageTransport: {
      provider: "other-provider",
      verifyIncomingRequest() {
        return { ok: true };
      },
      normalizeInboundMessage() {
        return null;
      },
      buildOutboundMessage() {
        return {
          targetExternalChatId: "chat-1",
          payload: {},
        };
      },
    },
  };

  const report = validateIntegrationProviderAdapterContract(brokenAdapter);

  assert.equal(report.ok, false);
  assert.deepEqual(report.issues.map((issue) => issue.code), [
    "display_name_missing",
    "transport_modes_missing",
    "capabilities_duplicate",
    "default_scopes_duplicate",
    "message_transport_provider_mismatch",
  ]);
});

test("builds a small provider-owned onboarding checklist for the next message provider", () => {
  const checklist = buildMessageTransportProviderOnboardingChecklist({
    provider: "teams",
    includeSocketWorker: true,
    includeHostedOAuth: true,
    includeAttachments: true,
    includeWebSettings: true,
    includeCli: true,
  });

  assert.equal(checklist.provider, "teams");
  assert.equal(checklist.estimatedProviderOwnedFileCount, 23);
  assert.ok(checklist.providerOwnedFiles.every((file) =>
    file.startsWith("packages/services/src/integrations/providers/teams/")
  ));
  assert.ok(checklist.sharedTouchPoints.includes("packages/services/src/index.ts"));
  assert.ok(checklist.sharedTouchPoints.includes("apps/cli/src/commands/integrations/teams.ts"));
  assert.ok(checklist.reusableCoreModules.includes("packages/services/src/integrations/core/notices.ts"));
  assert.ok(checklist.reusableWebModules.includes("apps/web/features/integrations/integration-health-outbox-panel.tsx"));
  assert.ok(checklist.reusableCliModules.includes("apps/cli/src/commands/integrations/outbox.ts"));
});
