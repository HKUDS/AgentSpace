import assert from "node:assert/strict";
import test from "node:test";
import {
  createExternalWorkerMetrics,
  recordExternalWorkerOutboxMetrics,
} from "./worker-metrics.ts";

test("creates common external worker metrics with provider-specific counters", () => {
  const metrics = createExternalWorkerMetrics({
    ackCount: 0,
    ackFailedCount: 0,
  });

  assert.equal(metrics.connectionReadyCount, 0);
  assert.equal(metrics.receivedCount, 0);
  assert.equal(metrics.duplicateCount, 0);
  assert.equal(metrics.ackCount, 0);
  assert.equal(metrics.ackFailedCount, 0);
  assert.deepEqual(metrics.errors, []);
});

test("records common outbox metrics with provider error codes", () => {
  const metrics = createExternalWorkerMetrics();

  recordExternalWorkerOutboxMetrics(metrics, {
    processedCount: 3,
    sentCount: 2,
    failedCount: 1,
    errors: [{
      integrationId: "external-integration-1",
      errorMessage: "provider send failed",
    }],
  }, "provider.worker.outbox_drain_failed");

  assert.equal(metrics.outboxProcessedCount, 3);
  assert.equal(metrics.outboxSentCount, 2);
  assert.equal(metrics.outboxFailedCount, 1);
  assert.deepEqual(metrics.errors, [{
    integrationId: "external-integration-1",
    errorCode: "provider.worker.outbox_drain_failed",
    errorMessage: "provider send failed",
  }]);
});
