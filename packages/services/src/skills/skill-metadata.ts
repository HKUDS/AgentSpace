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
  const lines = frontmatterMatch[1].replace(/\r$/, "").split(/\r?\n/);
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
  if (value.startsWith('"') && value.endsWith('"')) {
    return decodeDoubleQuotedYamlScalar(value.slice(1, -1));
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

function decodeDoubleQuotedYamlScalar(value: string): string {
  let decoded = "";
  for (let i = 0; i < value.length; i += 1) {
    const current = value[i]!;
    if (current !== "\\" || i + 1 >= value.length) {
      decoded += current;
      continue;
    }

    const escaped = value[i + 1]!;
    switch (escaped) {
      case "\\":
        decoded += "\\";
        break;
      case '"':
        decoded += '"';
        break;
      case "n":
        decoded += "\n";
        break;
      case "r":
        decoded += "\r";
        break;
      case "t":
        decoded += "\t";
        break;
      default:
        decoded += `\\${escaped}`;
        break;
    }
    i += 1;
  }
  return decoded;
}
