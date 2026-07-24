export function parseSkillMetadata(
  skillMarkdown: string,
  fallbackName: string,
): { name: string; description: string } {
  const frontmatterMatch = skillMarkdown.match(/^---\s*\n([\s\S]*?)\n---\s*/);
  if (!frontmatterMatch) {
    return { name: fallbackName, description: "" };
  }

  let name = fallbackName;
  let description = "";
  const lines = frontmatterMatch[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (line.startsWith("name:")) {
      name = stripYamlScalar(line.slice("name:".length).trim()) || fallbackName;
      continue;
    }
    if (line.startsWith("description:")) {
      const rest = line.slice("description:".length).trim();
      if (/^[|>][+-]?$/.test(rest)) {
        const collected: string[] = [];
        while (i + 1 < lines.length && /^\s+/.test(lines[i + 1]!)) {
          i += 1;
          collected.push(lines[i]!.replace(/^\s+/, ""));
        }
        description = collected.join("\n");
      } else {
        description = stripYamlScalar(rest);
      }
    }
  }

  return {
    name,
    description,
  };
}

function stripYamlScalar(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
