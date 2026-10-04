import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadTaskOutputEnvelope } from "./task-output.ts";

for (const attachmentPath of [
  "runtime-output/artifacts/missing.txt",
  "runtime-output/artifacts/missing-directory/report.txt",
]) {
  test(`missing output attachment preserves task text: ${attachmentPath}`, () => {
    const workDir = mkdtempSync(join(tmpdir(), "agent-space-missing-output-"));
    try {
      mkdirSync(join(workDir, "runtime-output", "artifacts"), { recursive: true });
      writeFileSync(join(workDir, "runtime-output", "artifacts", "empty.txt"), "");
      writeFileSync(join(workDir, "runtime-output", "agent-output.json"), JSON.stringify({
        text: "Task completed.",
        attachments: [
          { path: attachmentPath },
          { path: "runtime-output/artifacts/empty.txt" },
        ],
      }));

      const result = loadTaskOutputEnvelope(workDir, "fallback", "default");

      assert.equal(result.text, "Task completed.");
      assert.deepEqual(result.attachments, []);
      assert.equal(result.warnings.length, 2);
      assert.ok(result.warnings[0]?.includes("附件文件不存在"));
      assert.ok(result.warnings[1]?.includes("附件文件不能为空"));
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
}
