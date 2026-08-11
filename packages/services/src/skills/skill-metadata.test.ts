import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultSkillFileContent } from "../shared/skill-frontmatter.ts";
import { parseSkillMetadata } from "./skill-metadata.ts";

const escapedDescriptionCases = [
  ["backslashes", String.raw`Path: C:\temp\skill`],
  ["double quotes", 'Say "hello"'],
  ["line feeds", "First line\nSecond line"],
  ["carriage returns", "First line\rSecond line"],
  ["tabs", "Label:\tvalue"],
  ["literal escape text", String.raw`Literal: \n`],
] as const;

for (const [label, description] of escapedDescriptionCases) {
  test(`parseSkillMetadata round-trips writer-emitted ${label}`, () => {
    const md = createDefaultSkillFileContent("round-trip", description);
    assert.equal(parseSkillMetadata(md, "fb").description, description);
  });
}

test("parseSkillMetadata preserves unknown double-quoted escapes", () => {
  const md = String.raw`---
name: x
description: "Keep \q intact"
---
`;
  assert.equal(parseSkillMetadata(md, "fb").description, String.raw`Keep \q intact`);
});

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

test("parseSkillMetadata removes CRLF delimiters from block-scalar descriptions", () => {
  const md = [
    "---",
    "name: my-skill",
    "description: |",
    "  First line",
    "  Second line",
    "---",
    "",
  ].join("\r\n");
  const meta = parseSkillMetadata(md, "fb");
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
