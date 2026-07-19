import test from "node:test";
import assert from "node:assert/strict";
import { parseSkillMetadata } from "./skill-metadata.ts";

test("parseSkillMetadata keeps block-scalar descriptions", () => {
  const md = `---
name: my-skill
description: |
  First line
  Second line
---
`;
  const meta = parseSkillMetadata(md, "fb");
  assert.equal(meta.name, "my-skill");
  assert.equal(meta.description, "First line\nSecond line");
});

test("parseSkillMetadata keeps single-line descriptions", () => {
  const md = `---
name: x
description: One line
---
`;
  assert.equal(parseSkillMetadata(md, "fb").description, "One line");
});
