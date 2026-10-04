import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before, beforeEach } from "node:test";
import { zipSync } from "fflate";
import { listStoredAgentSkillAssignmentsSync, listStoredSkillImportEventsSync } from "@agent-space/db";
import {
  createEmployeeSync,
  createWorkspaceSkillSync,
  importWorkspaceSkillFromUrl,
  listWorkspaceSkillsSync,
  resetWorkspaceStateSync,
  setEmployeeSkillIdsSync,
} from "../index.ts";

const originalCwd = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-skill-import-"));
const originalFetch = globalThis.fetch;

before(() => {
  writeFileSync(join(tempRoot, "Target.md"), "# test\n");
  mkdirSync(join(tempRoot, "data"), { recursive: true });
  process.chdir(tempRoot);
});

beforeEach(() => {
  resetWorkspaceStateSync();
  globalThis.fetch = createGitHubFetchMock();
});

after(() => {
  globalThis.fetch = originalFetch;
  process.chdir(originalCwd);
});

test("importWorkspaceSkillFromUrl imports a GitHub skill directory with source metadata", async () => {
  const result = await importWorkspaceSkillFromUrl({
    url: "https://github.com/octo-org/skill-repo/tree/main/skills/research-pack",
  });

  const skill = listWorkspaceSkillsSync().find((item) => item.id === result.skillId);
  assert.ok(skill);
  assert.equal(skill?.name, "research-pack");
  assert.equal(skill?.description, "Research helper");
  assert.equal(skill?.sourceType, "github");
  assert.equal(skill?.sourceUrl, "https://github.com/octo-org/skill-repo/tree/main/skills/research-pack");
  assert.equal(skill?.files.some((file) => file.path === "templates/checklist.md"), true);
  assert.equal(result.created, true);
  assert.equal(result.renamed, false);
  assert.equal(listStoredSkillImportEventsSync(undefined, 5)[0]?.skillId, result.skillId);
});

test("importWorkspaceSkillFromUrl imports a skills.sh page by resolving its GitHub source", async () => {
  const result = await importWorkspaceSkillFromUrl({
    url: "https://skills.sh/apollographql/skills/skill-creator",
  });

  const skill = listWorkspaceSkillsSync().find((item) => item.id === result.skillId);
  assert.ok(skill);
  assert.equal(skill?.sourceType, "skills.sh");
  assert.equal(skill?.name, "skill-creator");
});

test("importWorkspaceSkillFromUrl resolves quoted skills.sh skill names", async () => {
  const result = await importWorkspaceSkillFromUrl({
    url: "https://skills.sh/aj-geddes/claude-code-bmad-skills/product-manager",
    conflict: "rename",
  });

  const skill = listWorkspaceSkillsSync().find((item) => item.id === result.skillId);
  assert.ok(skill);
  assert.equal(skill?.sourceType, "skills.sh");
  assert.equal(skill?.name.startsWith("product-manager"), true);
  assert.equal(skill?.files.some((file) => file.path === "templates/prd.template.md"), true);
});

test("builtin skill conflicts can be skipped but cannot be replaced", async () => {
  const url = "https://skills.sh/aj-geddes/claude-code-bmad-skills/product-manager";
  const existing = listWorkspaceSkillsSync().find((skill) => skill.name === "product-manager")!;
  const skipped = await importWorkspaceSkillFromUrl({ url, conflict: "skip" });
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.skillId, existing.id);
  await assert.rejects(importWorkspaceSkillFromUrl({ url, conflict: "replace" }), /Builtin skill.*cannot be replaced/);
  const retained = listWorkspaceSkillsSync().find((skill) => skill.id === existing.id)!;
  assert.equal(retained.name, existing.name);
  assert.equal(retained.description, existing.description);
  assert.deepEqual(retained.files, existing.files);
});

test("importWorkspaceSkillFromUrl can rename on conflict", async () => {
  createWorkspaceSkillSync({
    name: "research-pack",
    description: "Manual version",
  });

  const result = await importWorkspaceSkillFromUrl({
    url: "https://github.com/octo-org/skill-repo/tree/main/skills/research-pack",
    conflict: "rename",
  });

  assert.equal(result.created, true);
  assert.equal(result.renamed, true);
  assert.ok(listWorkspaceSkillsSync().some((skill) => skill.id === result.skillId && skill.name !== "research-pack"));
});

test("importWorkspaceSkillFromUrl can replace existing skills without dropping assignments", async () => {
  createEmployeeSync({ name: "Planner" });
  const original = createWorkspaceSkillSync({
    name: "research-pack",
    description: "Manual version",
  });
  setEmployeeSkillIdsSync("Planner", [original.id]);

  const result = await importWorkspaceSkillFromUrl({
    url: "https://github.com/octo-org/skill-repo/tree/main/skills/research-pack",
    conflict: "replace",
  });

  assert.equal(result.created, false);
  assert.equal(result.replaced, true);
  assert.equal(result.skillId, original.id);
  const replaced = listWorkspaceSkillsSync().find((skill) => skill.id === original.id);
  assert.ok(replaced);
  assert.equal(replaced?.description, "Research helper");
  assert.equal(
    listStoredAgentSkillAssignmentsSync().some((assignment) => assignment.employeeName === "Planner" && assignment.skillId === original.id),
    true,
  );
});

test("importWorkspaceSkillFromUrl imports a ClawHub zip package", async () => {
  const result = await importWorkspaceSkillFromUrl({
    url: "https://clawhub.ai/fangkelvin/find-skills-skill",
  });

  const skill = listWorkspaceSkillsSync().find((item) => item.id === result.skillId);
  assert.ok(skill);
  assert.equal(skill?.name, "find-skills");
  assert.equal(skill?.sourceType, "clawhub");
  assert.equal(skill?.files.some((file) => file.path === "_meta.json"), false);
});

test("importWorkspaceSkillFromUrl imports a local skill directory", async () => {
  const localSkillDir = join(tempRoot, "local-skill");
  mkdirSync(join(localSkillDir, "references"), { recursive: true });
  writeFileSync(join(localSkillDir, "SKILL.md"), `---
name: local-research
description: Local skill
---

# Local Research
`);
  writeFileSync(join(localSkillDir, "references", "notes.md"), "- local notes\n");

  const result = await importWorkspaceSkillFromUrl({
    url: localSkillDir,
  });

  const skill = listWorkspaceSkillsSync().find((item) => item.id === result.skillId);
  assert.ok(skill);
  assert.equal(skill?.sourceType, "local");
  assert.equal(skill?.files.some((file) => file.path === "references/notes.md"), true);
});

test("importWorkspaceSkillFromUrl can skip an existing conflict", async () => {
  const existing = createWorkspaceSkillSync({
    name: "research-pack",
    description: "Existing manual version",
  });

  const result = await importWorkspaceSkillFromUrl({
    url: "https://github.com/octo-org/skill-repo/tree/main/skills/research-pack",
    conflict: "skip",
  });

  assert.equal(result.skipped, true);
  assert.equal(result.skillId, existing.id);
});

function createGitHubFetchMock(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://api.github.com/repos/apollographql/skills") {
      return jsonResponse({
        default_branch: "main",
      });
    }
    if (url === "https://api.github.com/repos/apollographql/skills/git/trees/main?recursive=1") {
      return jsonResponse({
        tree: [
          {
            path: "packages/skill-creator/SKILL.md",
            type: "blob",
          },
          {
            path: "packages/skill-creator/references/checklist.md",
            type: "blob",
          },
        ],
      });
    }
    if (url === "https://skills.sh/apollographql/skills/skill-creator") {
      return new Response(
        '<html><body><code>npx skills add https://github.com/apollographql/skills --skill skill-creator</code></body></html>',
        { status: 200 },
      );
    }
    if (url === "https://skills.sh/aj-geddes/claude-code-bmad-skills/product-manager") {
      return new Response(
        "<html><body><code>npx skills add https://github.com/aj-geddes/claude-code-bmad-skills --skill &#x27;Product Manager&#x27;</code></body></html>",
        { status: 200 },
      );
    }
    if (url === "https://api.github.com/repos/aj-geddes/claude-code-bmad-skills") {
      return jsonResponse({
        default_branch: "main",
      });
    }
    if (url === "https://api.github.com/repos/aj-geddes/claude-code-bmad-skills/git/trees/main?recursive=1") {
      return jsonResponse({
        tree: [
          {
            path: "bmad-skills/product-manager/SKILL.md",
            type: "blob",
          },
          {
            path: "bmad-skills/product-manager/templates/prd.template.md",
            type: "blob",
          },
        ],
      });
    }
    if (url.includes("/contents/bmad-skills/product-manager?ref=main")) {
      return jsonResponse([
        {
          type: "file",
          name: "SKILL.md",
          path: "bmad-skills/product-manager/SKILL.md",
        },
        {
          type: "dir",
          name: "templates",
          path: "bmad-skills/product-manager/templates",
        },
      ]);
    }
    if (url.includes("/contents/bmad-skills/product-manager/templates?ref=main")) {
      return jsonResponse([
        {
          type: "file",
          name: "prd.template.md",
          path: "bmad-skills/product-manager/templates/prd.template.md",
        },
      ]);
    }
    if (url.includes("/contents/bmad-skills/product-manager/SKILL.md?ref=main")) {
      return jsonResponse({
        type: "file",
        encoding: "base64",
        content: Buffer.from(`---
name: product-manager
description: Product requirements and planning specialist
---

# Product Manager
`).toString("base64"),
      });
    }
    if (url.includes("/contents/bmad-skills/product-manager/templates/prd.template.md?ref=main")) {
      return jsonResponse({
        type: "file",
        encoding: "base64",
        content: Buffer.from("# PRD template\n").toString("base64"),
      });
    }
    if (url.includes("/contents/skills/research-pack?ref=main")) {
      return jsonResponse([
        {
          type: "file",
          name: "SKILL.md",
          path: "skills/research-pack/SKILL.md",
        },
        {
          type: "dir",
          name: "templates",
          path: "skills/research-pack/templates",
        },
      ]);
    }
    if (url.includes("/contents/skills/research-pack/templates?ref=main")) {
      return jsonResponse([
        {
          type: "file",
          name: "checklist.md",
          path: "skills/research-pack/templates/checklist.md",
        },
      ]);
    }
    if (url.includes("/contents/skills/research-pack/SKILL.md?ref=main")) {
      return jsonResponse({
        type: "file",
        encoding: "base64",
        content: Buffer.from(`---
name: research-pack
description: Research helper
---

# Research Pack

Use for structured research.
`).toString("base64"),
      });
    }
    if (url.includes("/contents/skills/research-pack/templates/checklist.md?ref=main")) {
      return jsonResponse({
        type: "file",
        encoding: "base64",
        content: Buffer.from("- confirm sources\n").toString("base64"),
      });
    }
    if (url.includes("/contents/packages/skill-creator?ref=main")) {
      return jsonResponse([
        {
          type: "file",
          name: "SKILL.md",
          path: "packages/skill-creator/SKILL.md",
        },
        {
          type: "dir",
          name: "references",
          path: "packages/skill-creator/references",
        },
      ]);
    }
    if (url.includes("/contents/packages/skill-creator/references?ref=main")) {
      return jsonResponse([
        {
          type: "file",
          name: "checklist.md",
          path: "packages/skill-creator/references/checklist.md",
        },
      ]);
    }
    if (url.includes("/contents/packages/skill-creator/SKILL.md?ref=main")) {
      return jsonResponse({
        type: "file",
        encoding: "base64",
        content: Buffer.from(`---
name: skill-creator
description: Create high-quality skills
---

# Skill Creator
`).toString("base64"),
      });
    }
    if (url.includes("/contents/packages/skill-creator/references/checklist.md?ref=main")) {
      return jsonResponse({
        type: "file",
        encoding: "base64",
        content: Buffer.from("- write good frontmatter\n").toString("base64"),
      });
    }
    if (url === "https://clawhub.ai/fangkelvin/find-skills-skill") {
      return new Response(
        '<html><body><a href="https://wry-manatee-359.convex.site/api/v1/download?slug=find-skills-skill">Download</a></body></html>',
        { status: 200 },
      );
    }
    if (url === "https://wry-manatee-359.convex.site/api/v1/download?slug=find-skills-skill") {
      const zip = zipSync({
        "SKILL.md": Buffer.from(`---
name: find-skills
description: Search and discover skills
---

# Find Skills
`),
        "_meta.json": Buffer.from(JSON.stringify({ slug: "find-skills-skill", version: "1.0.0" })),
      });
      return new Response(zip, {
        status: 200,
        headers: {
          "content-type": "application/zip",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  }) as typeof fetch;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}
