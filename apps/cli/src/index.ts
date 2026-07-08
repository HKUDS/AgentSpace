#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { parseFormat } from "./lib/format.ts";
import { printCommandHelp, printRootHelp } from "./lib/help.ts";

export async function main(): Promise<number> {
  const args = stripPnpmSeparator(process.argv.slice(2));

  if (args.length === 0 || args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    printRootHelp();
    return 0;
  }

  if (args[0] === "--version" || args[0] === "version") {
    console.log("0.1.0");
    return 0;
  }

  const [command, subcommand, ...restArgs] = args;
  const { format, rest } = parseFormat([subcommand ?? "", ...restArgs].filter(Boolean));
  const actualSubcommand = rest[0];
  const actualArgs = rest.slice(1);

  if (command === "doctor") {
    const { runDoctorCommand } = await import("./commands/doctor.ts");
    return runDoctorCommand(format);
  }

  if (command === "db") {
    const { runDatabaseCommand } = await import("./commands/db.ts");
    return runDatabaseCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "daemon") {
    const { runDaemonCommand } = await import("./commands/daemon.ts");
    return runDaemonCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "dev") {
    if (subcommand === "help" || subcommand === "--help") {
      printCommandHelp("dev");
      return 0;
    }
    const { runDevCommand } = await import("./commands/dev.ts");
    return runDevCommand([subcommand, ...restArgs].filter(Boolean));
  }

  if (command === "workspace") {
    const { runWorkspaceCommand } = await import("./commands/workspace.ts");
    return runWorkspaceCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "im") {
    const { runImCommand } = await import("./commands/im.ts");
    return runImCommand(actualSubcommand, format);
  }

  if (command === "integrations") {
    const { runIntegrationsCommand } = await import("./commands/integrations/index.ts");
    return runIntegrationsCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "channel") {
    const { runChannelCommand } = await import("./commands/channel.ts");
    return runChannelCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "employee") {
    const { runEmployeeCommand } = await import("./commands/employee.ts");
    return runEmployeeCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "material") {
    const { runMaterialCommand } = await import("./commands/material.ts");
    return runMaterialCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "message") {
    const { runMessageCommand } = await import("./commands/message.ts");
    return runMessageCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "task") {
    const { runTaskCommand } = await import("./commands/task.ts");
    return runTaskCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "skill") {
    const { runSkillCommand } = await import("./commands/skill.ts");
    return runSkillCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "output") {
    const { runOutputCommand } = await import("./commands/output.ts");
    return runOutputCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "cost") {
    const { runCostCommand } = await import("./commands/cost.ts");
    return runCostCommand(actualSubcommand, actualArgs, format);
  }

  printRootHelp();
  return 1;
}

function stripPnpmSeparator(args: string[]): string[] {
  if (args[0] === "--") {
    return args.slice(1);
  }

  return args;
}

const isMain = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;

if (isMain) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      const args = stripPnpmSeparator(process.argv.slice(2));
      const { format } = parseFormat(args);
      const report = buildCliUnhandledErrorReport(error, args[0]);
      if (format === "json") {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.error(report.errorMessage);
      }
      process.exit(1);
    });
}

function buildCliUnhandledErrorReport(error: unknown, command: string | undefined): {
  ok: false;
  command?: string;
  errorCode: "agent_space_cli.database_url_missing" | "agent_space_cli.unhandled_error";
  errorMessage: string;
  nextSteps: string[];
} {
  const errorMessage = sanitizeCliErrorMessage(error instanceof Error ? error.message : String(error));
  const databaseUrlMissing = errorMessage.includes("PostgreSQL database URL is required");
  return {
    ok: false,
    ...(command ? { command } : {}),
    errorCode: databaseUrlMissing
      ? "agent_space_cli.database_url_missing"
      : "agent_space_cli.unhandled_error",
    errorMessage,
    nextSteps: databaseUrlMissing
      ? [
        "Set AGENT_SPACE_DEPLOYMENT_MODE with SELF_HOSTED_DATABASE_URL or NEON_DATABASE_URL, or define AGENT_SPACE_PG_URL / DATABASE_URL.",
      ]
      : [
        "Rerun the command with --help to verify usage, then check the command-specific setup prerequisites.",
      ],
  };
}

function sanitizeCliErrorMessage(message: string): string {
  return message
    .replace(/\b(xox[abprs]?|xapp)-[A-Za-z0-9-]+\b/gi, "[redacted]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+\b/gi, "$1[redacted]")
    .replace(/\b(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s]+@/gi, "$1***@")
    .slice(0, 1000);
}
