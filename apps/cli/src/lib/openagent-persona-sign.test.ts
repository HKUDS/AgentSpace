import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { employeeToPersona } from "@agent-space/domain";
import type { ActiveEmployee } from "@agent-space/domain/workspace";
import {
  didKeyFromPublicKey,
  signPersona,
  verifyPersonaSignature,
} from "./openagent-persona-sign.ts";

const employee: ActiveEmployee = {
  name: "Atlas",
  role: "Research Lead",
  remarkName: "阿特拉斯",
  ownerUserId: "user-42",
  origin: "手动创建",
  summary: "Digs through papers and surfaces the load-bearing claims.",
  traits: ["rigorous", "curious"],
  fit: "Deep-dive research and synthesis.",
  skillIds: [],
  channels: ["research"],
  status: "active",
  instructions: "Cite sources. Flag uncertainty explicitly.",
};

const skills = ["literature-review", "citation-check"];

test("signPersona mints a did:key and a self-verifying provenance block", () => {
  const keyPair = generateKeyPairSync("ed25519");
  const persona = employeeToPersona(employee, skills);
  const { persona: signed, didKey } = signPersona(persona, {
    now: "2026-07-03T00:00:00.000Z",
    keyPair,
  });

  assert.ok(signed.provenance);
  assert.equal(signed.provenance?.signed_at, "2026-07-03T00:00:00.000Z");
  assert.equal(signed.provenance?.created_by.name, "Atlas");
  assert.ok(signed.provenance?.created_by.key.includes("BEGIN PUBLIC KEY"));
  assert.ok(signed.provenance?.signature);

  assert.equal(didKey, didKeyFromPublicKey(keyPair.publicKey));
  assert.match(didKey, /^did:key:z6Mk/);

  // The signature verifies against created_by.key, exactly as @5dive/openagent does.
  assert.equal(verifyPersonaSignature(signed), true);
});

test("signPersona mutates and returns the same persona object", () => {
  const persona = employeeToPersona(employee, skills);
  const { persona: signed } = signPersona(persona);
  assert.equal(signed, persona);
  assert.ok(persona.provenance?.signature);
});

test("tampering with a signed persona breaks verification", () => {
  const persona = employeeToPersona(employee, skills);
  signPersona(persona);
  persona.behavior = `${persona.behavior} (tampered)`;
  assert.equal(verifyPersonaSignature(persona), false);
});

test("verifyPersonaSignature is false for an unsigned persona", () => {
  const persona = employeeToPersona(employee, skills);
  assert.equal(verifyPersonaSignature(persona), false);
});
