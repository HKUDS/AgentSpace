import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import {
  clearIntegrationProviderAdaptersForTests,
  listIntegrationProviderAdapters,
  readIntegrationProviderAdapter,
} from "../../../core/index.ts";
import {
  FEISHU_PROVIDER_ID,
  registerFeishuIntegrationProvider,
  registerSlackIntegrationProvider,
  SLACK_PROVIDER_DESCRIPTOR,
  SLACK_PROVIDER_ID,
  slackIntegrationProviderAdapter,
} from "../../../../index.ts";

beforeEach(() => {
  clearIntegrationProviderAdaptersForTests();
});

afterEach(() => {
  clearIntegrationProviderAdaptersForTests();
});

test("Slack provider descriptor exposes only message transport capability", () => {
  assert.equal(SLACK_PROVIDER_ID, "slack");
  assert.equal(SLACK_PROVIDER_DESCRIPTOR.provider, SLACK_PROVIDER_ID);
  assert.equal(SLACK_PROVIDER_DESCRIPTOR.displayName, "Slack");
  assert.deepEqual(SLACK_PROVIDER_DESCRIPTOR.capabilities, ["message_transport"]);
  assert.deepEqual(SLACK_PROVIDER_DESCRIPTOR.supportedTransportModes, ["http_webhook", "websocket_worker"]);
  assert.deepEqual(SLACK_PROVIDER_DESCRIPTOR.resourceTypes, []);
  assert.equal(slackIntegrationProviderAdapter.descriptor, SLACK_PROVIDER_DESCRIPTOR);
  assert.equal(slackIntegrationProviderAdapter.messageTransport?.provider, SLACK_PROVIDER_ID);
  assert.equal(slackIntegrationProviderAdapter.documentProvider, undefined);
});

test("Slack provider registration coexists with Feishu in the integration registry", () => {
  const feishuAdapter = registerFeishuIntegrationProvider();
  const slackAdapter = registerSlackIntegrationProvider();

  assert.equal(readIntegrationProviderAdapter(SLACK_PROVIDER_ID), slackAdapter);
  assert.equal(readIntegrationProviderAdapter(FEISHU_PROVIDER_ID), feishuAdapter);
  assert.deepEqual(
    listIntegrationProviderAdapters().map((adapter) => adapter.descriptor.provider).sort(),
    [FEISHU_PROVIDER_ID, SLACK_PROVIDER_ID].sort(),
  );
});
