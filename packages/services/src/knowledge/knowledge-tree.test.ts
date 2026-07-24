import test from "node:test";
import assert from "node:assert/strict";
import { isDescendant } from "./knowledge-tree.ts";

test("isDescendant returns true for a real parent chain", () => {
  const pages = [
    { id: "root", parentId: null },
    { id: "child", parentId: "root" },
    { id: "grand", parentId: "child" },
  ];
  assert.equal(isDescendant(pages, "root", "grand"), true);
  assert.equal(isDescendant(pages, "child", "grand"), true);
  assert.equal(isDescendant(pages, "grand", "root"), false);
});

test("isDescendant terminates on cyclic parentId chains", () => {
  const pages = [
    { id: "a", parentId: "b" },
    { id: "b", parentId: "a" },
    { id: "root", parentId: null },
  ];
  assert.equal(isDescendant(pages, "root", "a"), false);
  assert.equal(isDescendant(pages, "a", "b"), true);
});

test("isDescendant detects an existing self-parent link without hanging", () => {
  const pages = [{ id: "x", parentId: "x" }];
  assert.equal(isDescendant(pages, "x", "x"), true);
});
