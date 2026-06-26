import { drainFeishuOutboxMessages } from "@agent-space/services";
import { getNumberFlag, getStringFlag, parseArgs } from "../../lib/args.ts";
import { writeData, type OutputFormat } from "../../lib/format.ts";

export async function runIntegrationsOutboxCommand(args: string[], format: OutputFormat): Promise<number> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printIntegrationsOutboxHelp();
    return subcommand ? 0 : 1;
  }

  const parsed = parseArgs(rest);
  if (subcommand === "drain" && hasHelpFlag(parsed.flags)) {
    printIntegrationsOutboxHelp();
    return 0;
  }

  if (subcommand !== "drain") {
    printIntegrationsOutboxHelp();
    return 1;
  }

  const workspaceId = getStringFlag(parsed.flags, "workspace-id") ?? "default";
  const integrationId = getStringFlag(parsed.flags, "integration") ?? getStringFlag(parsed.flags, "integration-id");
  const limit = getNumberFlag(parsed.flags, "limit", 50);
  const lockedBy = getStringFlag(parsed.flags, "locked-by") ?? "agent-space-cli";
  const baseUrl = getStringFlag(parsed.flags, "base-url");

  const result = await drainFeishuOutboxMessages({
    workspaceId,
    integrationId,
    limit,
    lockedBy,
    baseUrl,
  });
  writeData(format, result);
  return result.errors.length > 0 && result.processedCount === 0 ? 1 : 0;
}

function hasHelpFlag(flags: Record<string, string | boolean>): boolean {
  return flags.help === true || flags.h === true;
}

function printIntegrationsOutboxHelp(): void {
  console.log(`Usage:
  agent-space integrations outbox drain [--workspace-id <id>] [--integration <id>] [--limit <n>] [--base-url <url>] [--locked-by <id>] [--json]

Options:
  --workspace-id <id>      AgentSpace workspace id; defaults to default
  --integration <id>       Limit the drain run to one external integration
  --limit <n>              Outbox drain batch size; defaults to 50
  --base-url <url>         Provider API base URL override
  --locked-by <id>         Worker lock owner; defaults to agent-space-cli
  --json                   Print machine-readable output`);
}
