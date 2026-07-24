import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultSkillFileContent,
  formatFrontmatterDescription,
} from "../shared/skill-frontmatter.ts";

test("createDefaultSkillFileContent keeps multiline descriptions on one frontmatter line", () => {
  const content = createDefaultSkillFileContent("research-pack", "First line\nSecond line");
  const descriptionLine = content
    .split(/\r?\n/)
    .find((line) => line.startsWith("description:"));
  assert.equal(descriptionLine, 'description: "First line\\nSecond line"');
  assert.doesNotMatch(content, /^description: First line$/m);
});

test("createDefaultSkillFileContent keeps simple single-line descriptions inline", () => {
  const content = createDefaultSkillFileContent("research-pack", "One line");
  assert.match(content, /^description: One line$/m);
});

test("formatFrontmatterDescription quotes YAML-special single-line text", () => {
  assert.equal(
    formatFrontmatterDescription("Use when: ready"),
    'description: "Use when: ready"',
  );
});
