import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExternalIdHash,
  buildExternalIdReference,
  buildLabeledExternalIdReference,
  buildOptionalExternalIdReference,
} from "./references.ts";

test("builds stable redacted external id references", () => {
  assert.equal(buildExternalIdReference("C123"), "ref_abefcf25");
  assert.equal(buildExternalIdReference("C123", {
    prefix: "chat",
    separator: ":",
    hashLength: 12,
  }), "chat:abefcf257b5d");
  assert.equal(buildExternalIdHash("om-secret-message", 16), "f4de2c37460b6b0a");
});

test("builds optional and labeled external id references without raw ids", () => {
  assert.equal(buildOptionalExternalIdReference("  U456  "), "ref_2830d8c3");
  assert.equal(buildOptionalExternalIdReference("   "), undefined);
  assert.equal(buildLabeledExternalIdReference("event", "EvSecret"), "event 8258745929a18e34");
  assert.equal(buildLabeledExternalIdReference("event", undefined), undefined);
});
