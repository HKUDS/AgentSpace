import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after, beforeEach } from "node:test";
import { listStoredAgentSkillAssignmentsSync } from "@agent-space/db";
import {
  createEmployeeSync,
  listWorkspaceSkillsSync,
  resetWorkspaceStateSync,
} from "@agent-space/services";
import { applySkillImportOperations, prepareSkillImportOperationArtifacts } from "./skill-imports.ts";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  resetWorkspaceStateSync();
  globalThis.fetch = createGitHubFetchMock();
});

after(() => {
  globalThis.fetch = originalFetch;
});

test("applySkillImportOperations imports runtime-output skill requests and assigns them to the current agent", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-skill-imports-"));

  try {
    createEmployeeSync({ name: "Planner" });
    mkdirSync(join(workDir, "runtime-output"), { recursive: true });
    writeFileSync(
      join(workDir, "runtime-output", "skill-imports.json"),
      JSON.stringify({
        imports: [
          {
            url: "https://github.com/octo-org/skill-repo/tree/main/skills/research-pack",
            assignToSelf: true,
          },
        ],
      }),
      "utf8",
    );

    const prepared = prepareSkillImportOperationArtifacts(workDir);
    assert.deepEqual(prepared, { warnings: [], packaged: 0 });

    const result = await applySkillImportOperations(workDir, {
      workspaceId: "default",
      agentName: "Planner",
    });

    assert.deepEqual(result.warnings, []);
    assert.equal(result.imports.length, 1);
    assert.equal(result.imports[0]?.skillName, "research-pack");
    assert.equal(result.imports[0]?.assignedToSelf, true);
    assert.match(result.statusMessages[0] ?? "", /已导入工作区，并已绑定给当前 Agent/);
    assert.ok(listWorkspaceSkillsSync().some((skill) => skill.id === result.imports[0]?.skillId));
    assert.equal(
      listStoredAgentSkillAssignmentsSync().some(
        (assignment) => assignment.employeeName === "Planner" && assignment.skillId === result.imports[0]?.skillId,
      ),
      true,
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("applySkillImportOperations imports local skill directories from runtime-output artifacts", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-skill-imports-"));

  try {
    createEmployeeSync({ name: "Planner" });
    const skillDir = join(workDir, "runtime-output", "artifacts", "skills", "bilibili-video-reader");
    mkdirSync(join(skillDir, "references"), { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: bilibili-video-reader\ndescription: Read Bilibili video pages\n---\n# Bilibili Video Reader\n",
      "utf8",
    );
    writeFileSync(join(skillDir, "references", "usage.md"), "Use browser/video metadata.\n", "utf8");
    writeFileSync(
      join(workDir, "runtime-output", "skill-imports.json"),
      JSON.stringify({
        imports: [
          {
            path: "runtime-output/artifacts/skills/bilibili-video-reader",
            conflict: "rename",
            assignToSelf: true,
          },
        ],
      }),
      "utf8",
    );

    const prepared = prepareSkillImportOperationArtifacts(workDir);
    assert.deepEqual(prepared, { warnings: [], packaged: 0 });

    const result = await applySkillImportOperations(workDir, {
      workspaceId: "default",
      agentName: "Planner",
    });

    assert.deepEqual(result.warnings, []);
    assert.equal(result.imports.length, 1);
    assert.equal(result.imports[0]?.skillName, "bilibili-video-reader");
    assert.equal(result.imports[0]?.sourceUrl, "runtime-output/artifacts/skills/bilibili-video-reader");
    const importedSkill = listWorkspaceSkillsSync().find((skill) => skill.id === result.imports[0]?.skillId);
    assert.ok(importedSkill);
    assert.equal(importedSkill?.sourceType, "local");
    assert.equal(importedSkill?.files.some((file) => file.path === "references/usage.md"), true);
    assert.equal(
      listStoredAgentSkillAssignmentsSync().some(
        (assignment) => assignment.employeeName === "Planner" && assignment.skillId === result.imports[0]?.skillId,
      ),
      true,
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("prepareSkillImportOperationArtifacts packages local skill directories into runtime-output artifacts", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-skill-imports-"));
  const localSkillDir = mkdtempSync(join(tmpdir(), "agent-space-local-skill-"));

  try {
    createEmployeeSync({ name: "Planner" });
    mkdirSync(join(localSkillDir, "references"), { recursive: true });
    writeFileSync(
      join(localSkillDir, "SKILL.md"),
      "---\nname: bilibili-video-reader\ndescription: Read Bilibili video pages\n---\n# Bilibili Video Reader\n",
      "utf8",
    );
    writeFileSync(join(localSkillDir, "references", "usage.md"), "Use browser/video metadata.\n", "utf8");
    mkdirSync(join(workDir, "runtime-output"), { recursive: true });
    writeFileSync(
      join(workDir, "runtime-output", "skill-imports.json"),
      JSON.stringify({
        imports: [
          {
            url: localSkillDir,
            conflict: "rename",
            assignToSelf: true,
          },
        ],
      }),
      "utf8",
    );

    const prepared = prepareSkillImportOperationArtifacts(workDir);
    const rewritten = JSON.parse(readFileSync(join(workDir, "runtime-output", "skill-imports.json"), "utf8")) as {
      imports: Array<{ path?: string; url?: string }>;
    };

    assert.deepEqual(prepared.warnings, []);
    assert.equal(prepared.packaged, 1);
    assert.equal(rewritten.imports[0]?.url, undefined);
    assert.match(rewritten.imports[0]?.path ?? "", /^runtime-output\/artifacts\/skills\/agent-space-local-skill-/);

    const result = await applySkillImportOperations(workDir, {
      workspaceId: "default",
      agentName: "Planner",
    });

    assert.deepEqual(result.warnings, []);
    assert.equal(result.imports.length, 1);
    assert.equal(result.imports[0]?.skillName, "bilibili-video-reader");
    assert.equal(result.imports[0]?.assignedToSelf, true);
    const importedSkill = listWorkspaceSkillsSync().find((skill) => skill.id === result.imports[0]?.skillId);
    assert.ok(importedSkill);
    assert.equal(importedSkill?.files.some((file) => file.path === "references/usage.md"), true);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    rmSync(localSkillDir, { recursive: true, force: true });
  }
});

test("prepareSkillImportOperationArtifacts packages file URLs containing spaces", () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-skill-imports-"));
  const localSkillDir = mkdtempSync(join(tmpdir(), "agent-space-local skill-"));
  try {
    const content = "---\nname: file-url-skill\ndescription: File URL import\n---\n# Local skill\n";
    writeFileSync(join(localSkillDir, "SKILL.md"), content);
    mkdirSync(join(workDir, "runtime-output"), { recursive: true });
    const manifestPath = join(workDir, "runtime-output", "skill-imports.json");
    writeFileSync(manifestPath, JSON.stringify({
      imports: [{ url: pathToFileURL(localSkillDir).href }],
    }));

    const prepared = prepareSkillImportOperationArtifacts(workDir);
    const rewritten = JSON.parse(readFileSync(manifestPath, "utf8"));

    assert.deepEqual(prepared.warnings, []);
    assert.equal(prepared.packaged, 1);
    assert.equal(rewritten.imports[0].url, undefined);
    assert.equal(readFileSync(join(workDir, rewritten.imports[0].path, "SKILL.md"), "utf8"), content);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    rmSync(localSkillDir, { recursive: true, force: true });
  }
});

test("applySkillImportOperations rejects local path imports from runtime output", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-skill-imports-"));

  try {
    mkdirSync(join(workDir, "runtime-output"), { recursive: true });
    writeFileSync(
      join(workDir, "runtime-output", "skill-imports.json"),
      JSON.stringify({
        imports: [
          {
            url: "./local-skill",
          },
        ],
      }),
      "utf8",
    );

    const result = await applySkillImportOperations(workDir, {
      workspaceId: "default",
      agentName: "Planner",
    });

    assert.equal(result.imports.length, 0);
    assert.match(result.warnings[0] ?? "", /必须是 HTTPS URL/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("applySkillImportOperations rejects artifact paths outside runtime-output artifacts", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "agent-space-skill-imports-"));

  try {
    mkdirSync(join(workDir, "runtime-output"), { recursive: true });
    writeFileSync(
      join(workDir, "runtime-output", "skill-imports.json"),
      JSON.stringify({
        imports: [
          {
            path: "local-skill",
          },
        ],
      }),
      "utf8",
    );

    const result = await applySkillImportOperations(workDir, {
      workspaceId: "default",
      agentName: "Planner",
    });

    assert.equal(result.imports.length, 0);
    assert.match(result.warnings[0] ?? "", /必须位于 runtime-output\/artifacts\//);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

function createGitHubFetchMock(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://api.github.com/repos/octo-org/skill-repo/contents/skills/research-pack?ref=main") {
      return jsonResponse([
        {
          type: "file",
          name: "SKILL.md",
          path: "skills/research-pack/SKILL.md",
        },
      ]);
    }
    if (url === "https://api.github.com/repos/octo-org/skill-repo/contents/skills/research-pack/SKILL.md?ref=main") {
      return jsonResponse({
        type: "file",
        encoding: "base64",
        content: Buffer.from("---\nname: research-pack\ndescription: Research helper\n---\n# Research\n").toString("base64"),
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
