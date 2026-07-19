import assert from "node:assert/strict";
import test from "node:test";
import { formatFrontmatterDescription } from "../shared/skill-frontmatter.ts";

test("formatFrontmatterDescription uses a block scalar for multiline text", () => {
  assert.equal(
    formatFrontmatterDescription("First line\nSecond line"),
    "description: |\n  First line\n  Second line",
  );
});

test("formatFrontmatterDescription keeps single-line text inline", () => {
  assert.equal(formatFrontmatterDescription("One line"), "description: One line");
});
