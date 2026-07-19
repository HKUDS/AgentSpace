export function formatFrontmatterDescription(description: string): string {
  if (!description.includes("\n")) {
    return `description: ${description}`;
  }
  const indented = description
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  return `description: |\n${indented}`;
}
