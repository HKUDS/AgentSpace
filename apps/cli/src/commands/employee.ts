import { writeFileSync } from "node:fs";
import {
  bindEmployeeRuntimeSync,
  createEmployeeSync,
  listActiveEmployeesSync,
  listEmployeeRuntimeBindingsForWorkspaceSync,
  listEmployeeSkillIdsSync,
  unbindEmployeeRuntimeSync,
} from "@agent-space/services";
import { employeeToPersona } from "@agent-space/domain";
import { signPersona } from "../lib/openagent-persona-sign.ts";
import { parseArgs, getStringFlag } from "../lib/args.ts";
import { writeData, type OutputFormat } from "../lib/format.ts";

export function runEmployeeCommand(
  subcommand: string | undefined,
  args: string[],
  format: OutputFormat,
): number {
  if (subcommand === "list") {
    const bindings = new Map(
      listEmployeeRuntimeBindingsForWorkspaceSync().map((binding) => [binding.employeeName, binding.runtimeName]),
    );
    writeData(
      format,
      listActiveEmployeesSync().map((employee) => ({
        name: employee.name,
        role: employee.role,
        origin: employee.origin,
        channels: employee.channels.join(", "),
        traits: employee.traits.join(", "),
        runtime: bindings.get(employee.name) ?? "",
      })),
    );
    return 0;
  }

  if (subcommand === "create") {
    const { flags } = parseArgs(args);
    const name = getStringFlag(flags, "name");
    const role = getStringFlag(flags, "role");
    const summary = getStringFlag(flags, "summary");
    const fit = getStringFlag(flags, "fit");
    const origin = getStringFlag(flags, "origin") ?? "手动创建";
    const traitsValue = getStringFlag(flags, "traits") ?? "";
    const traits = traitsValue
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (!name || !role) {
      console.error(
        'Usage: agent-space employee create --name <name> --role <role> [--traits a,b] [--summary <text>] [--fit <text>] [--origin <label>] [--json]',
      );
      return 1;
    }

    const state = createEmployeeSync({
      name,
      role,
      summary,
      traits,
      fit,
      origin,
      active: true,
    });

    writeData(format, {
      ok: true,
      employee: name,
      role,
      origin,
      totalActiveEmployees: state.activeEmployees.length,
    });
    return 0;
  }

  if (subcommand === "bind-runtime") {
    const { flags } = parseArgs(args);
    const name = getStringFlag(flags, "name");
    const runtimeId = getStringFlag(flags, "runtime-id");

    if (!name || !runtimeId) {
      console.error(
        "Usage: agent-space employee bind-runtime --name <employee> --runtime-id <runtime-id> [--json]",
      );
      return 1;
    }

    const state = bindEmployeeRuntimeSync(name, runtimeId);
    writeData(format, {
      ok: true,
      employee: name,
      runtimeId,
      totalActiveEmployees: state.activeEmployees.length,
    });
    return 0;
  }

  if (subcommand === "unbind-runtime") {
    const { flags } = parseArgs(args);
    const name = getStringFlag(flags, "name");

    if (!name) {
      console.error("Usage: agent-space employee unbind-runtime --name <employee> [--json]");
      return 1;
    }

    const state = unbindEmployeeRuntimeSync(name);
    writeData(format, {
      ok: true,
      employee: name,
      totalActiveEmployees: state.activeEmployees.length,
    });
    return 0;
  }

  if (subcommand === "export-persona") {
    const { flags } = parseArgs(args);
    const name = getStringFlag(flags, "name");

    if (!name) {
      console.error(
        "Usage: agent-space employee export-persona --name <employee> [--sign] [--include-sensitive] [--out <path>] [--json]",
      );
      return 1;
    }

    const employee = listActiveEmployeesSync().find((candidate) => candidate.name === name);
    if (!employee) {
      console.error(`No active employee named "${name}".`);
      return 1;
    }

    const skills = listEmployeeSkillIdsSync(name);
    const sign = flags.sign === true || getStringFlag(flags, "sign") !== undefined;
    // Private operator config (instructions, skills, owner identity) is redacted
    // by default; --include-sensitive opts it back into the exported card.
    const includeSensitive =
      flags["include-sensitive"] === true || getStringFlag(flags, "include-sensitive") !== undefined;

    // Map (pure, runtime-agnostic domain) then sign (node layer) — the two compose.
    const persona = employeeToPersona(employee, skills, { includeSensitive });
    const didKey = sign ? signPersona(persona).didKey : null;
    const serialized = JSON.stringify(persona, null, 2);

    const out = getStringFlag(flags, "out");
    if (out) {
      writeFileSync(out, `${serialized}\n`);
    }

    if (format === "json") {
      writeData(format, {
        ok: true,
        employee: name,
        signed: sign,
        includeSensitive,
        didKey: didKey ?? null,
        out: out ?? null,
        persona,
      });
    } else if (out) {
      writeData(format, { ok: true, employee: name, signed: sign, includeSensitive, didKey: didKey ?? "", out });
    } else {
      console.log(serialized);
    }
    return 0;
  }

  console.error("Usage: agent-space employee list [--json]");
  console.error(
    "   or: agent-space employee create --name <name> --role <role> [--traits a,b] [--summary <text>] [--fit <text>] [--origin <label>] [--json]",
  );
  console.error(
    "   or: agent-space employee bind-runtime --name <employee> --runtime-id <runtime-id> [--json]",
  );
  console.error("   or: agent-space employee unbind-runtime --name <employee> [--json]");
  console.error(
    "   or: agent-space employee export-persona --name <employee> [--sign] [--include-sensitive] [--out <path>] [--json]",
  );
  return 1;
}
