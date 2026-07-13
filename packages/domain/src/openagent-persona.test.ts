import test from "node:test";
import assert from "node:assert/strict";
import { employeeToPersona, slugifyPersonaId } from "./openagent-persona.ts";
import type { ActiveEmployee } from "./workspace.ts";

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

test("employeeToPersona maps required OpenAgent v0.2 fields", () => {
  const persona = employeeToPersona(employee, skills);

  assert.equal(persona.openagent, "0.2");
  assert.equal(persona.id, "atlas");
  assert.match(persona.id, /^[a-z0-9-]+$/);
  assert.equal(persona.name, "Atlas");
  assert.equal(persona.role, "Research Lead (阿特拉斯)");

  // Required v0.2 fields must all be present and non-empty.
  assert.ok(persona.behavior.length > 0);
  assert.ok(persona.face.ref.length > 0);
  assert.match(persona.face.anchor, /^#[0-9a-f]{6}$/);
  assert.ok((persona.voice.written?.rules.length ?? 0) >= 1);
  assert.ok((persona.voice.written?.sample.length ?? 0) > 0);

  // The pure mapper never attaches provenance — signing is a separate node layer.
  assert.equal(persona.provenance, undefined);
});

test("employeeToPersona redacts sensitive fields by default", () => {
  const persona = employeeToPersona(employee, skills);

  // Owner identity is dropped from org.name.
  assert.equal(persona.org?.name, "AgentSpace");
  // Operator instructions do not leak into behavior…
  assert.equal(persona.behavior, "Digs through papers and surfaces the load-bearing claims.");
  assert.ok(!persona.behavior.includes("Cite sources"));
  // …nor into the voice rules, and skills are not disclosed there either.
  const rules = persona.voice.written?.rules ?? [];
  assert.ok(rules.every((rule) => !rule.includes("Cite sources")));
  assert.ok(rules.every((rule) => !rule.includes("Draws on skills")));
  // posts_about carries only personality traits, never the resolved skills.
  assert.deepEqual(persona.posts_about, ["rigorous", "curious"]);
});

test("employeeToPersona --include-sensitive opts private fields back in", () => {
  const persona = employeeToPersona(employee, skills, { includeSensitive: true });

  // Owner identity is restored to org.name.
  assert.equal(persona.org?.name, "AgentSpace (user-42)");
  // Instructions flow back into behavior and the voice rules.
  assert.equal(
    persona.behavior,
    "Digs through papers and surfaces the load-bearing claims. Cite sources. Flag uncertainty explicitly.",
  );
  const rules = persona.voice.written?.rules ?? [];
  assert.deepEqual(rules, [
    "Embodies: rigorous, curious.",
    "Draws on skills: literature-review, citation-check.",
    "Cite sources. Flag uncertainty explicitly.",
  ]);
  // Traits + resolved skills flow into posts_about (deduped).
  assert.deepEqual(persona.posts_about, [
    "rigorous",
    "curious",
    "literature-review",
    "citation-check",
  ]);
});

test("slugifyPersonaId always yields a schema-valid id", () => {
  assert.equal(slugifyPersonaId("Nova Prime!"), "nova-prime");
  assert.equal(slugifyPersonaId("阿特拉斯"), "agent");
  assert.match(slugifyPersonaId("  --Weird__Name-- "), /^[a-z0-9-]+$/);
});
