#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { runChannelCommand } from "./commands/channel.ts";
import { runDaemonCommand } from "./commands/daemon.ts";
import { runDatabaseCommand } from "./commands/db.ts";
import { runDevCommand } from "./commands/dev.ts";
import { runDoctorCommand } from "./commands/doctor.ts";
import { runEmployeeCommand } from "./commands/employee.ts";
import { runImCommand } from "./commands/im.ts";
import { runIntegrationsCommand } from "./commands/integrations/index.ts";
import { runMaterialCommand } from "./commands/material.ts";
import { runMessageCommand } from "./commands/message.ts";
import { runOutputCommand } from "./commands/output.ts";
import { runSkillCommand } from "./commands/skill.ts";
import { runTaskCommand } from "./commands/task.ts";
import { runCostCommand } from "./commands/cost.ts";
import { runWorkspaceCommand } from "./commands/workspace.ts";
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
    return runDoctorCommand(format);
  }

  if (command === "db") {
    return runDatabaseCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "daemon") {
    return runDaemonCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "dev") {
    if (subcommand === "help" || subcommand === "--help") {
      printCommandHelp("dev");
      return 0;
    }
    return runDevCommand([subcommand, ...restArgs].filter(Boolean));
  }

  if (command === "workspace") {
    return runWorkspaceCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "im") {
    return runImCommand(actualSubcommand, format);
  }

  if (command === "integrations") {
    return runIntegrationsCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "channel") {
    return runChannelCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "employee") {
    return runEmployeeCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "material") {
    return runMaterialCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "message") {
    return runMessageCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "task") {
    return runTaskCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "skill") {
    return runSkillCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "output") {
    return runOutputCommand(actualSubcommand, actualArgs, format);
  }

  if (command === "cost") {
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
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    });
}
