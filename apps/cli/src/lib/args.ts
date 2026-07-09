export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const flag = token.slice(2);
    const equalsIndex = flag.indexOf("=");
    if (equalsIndex > 0) {
      flags[flag.slice(0, equalsIndex)] = flag.slice(equalsIndex + 1);
      continue;
    }

    const key = flag;
    const nextValue = args[index + 1];

    if (!nextValue || nextValue.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    flags[key] = nextValue;
    index += 1;
  }

  return { positionals, flags };
}

export function getStringFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

export function getNumberFlag(
  flags: Record<string, string | boolean>,
  key: string,
  fallback: number,
): number {
  const value = flags[key];
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
