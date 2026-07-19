function slugifyName(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "material";
}

function escapeDoubleQuotedYaml(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/** Encode a SKILL.md description line; multiline stays one physical YAML line. */
export function formatFrontmatterDescription(description: string): string {
  if (!/[\n\r:#]/.test(description) && !description.includes('"')) {
    return `description: ${description}`;
  }
  return `description: "${escapeDoubleQuotedYaml(description)}"`;
}

export function createDefaultSkillFileContent(name: string, description: string): string {
  const skillName = slugifyName(name);
  const summary = description || `Use when Codex should apply the ${name} workflow.`;
  return `---
name: ${skillName}
${formatFrontmatterDescription(summary)}
---

# ${name}

Describe the workflow, constraints, and reusable resources for this skill here.
`;
}
