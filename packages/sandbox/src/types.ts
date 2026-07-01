export type SandboxStatus =
  | "provisioning"
  | "active"
  | "hibernating"
  | "hibernated"
  | "stopped"
  | "failed";

export interface ExecCommand {
  command: string;
  args?: string[];
  cwd?: string;
  input?: string;
  keepStdinOpen?: boolean;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  onReady?: (controller: ExecController) => void;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface ExecController {
  writeStdin(data: string): void;
  closeStdin(): void;
}

import type { SandboxPolicy, SandboxTerminationReason } from "./policy.ts";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal?: NodeJS.Signals;
  durationMs: number;
  timedOut: boolean;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  outputLimitExceeded?: boolean;
  terminationReason?: SandboxTerminationReason;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

export type SandboxProvider = "local" | "cube";

export interface SandboxConnectOptions {
  runtimeId: string;
  workDir: string;
  provider?: SandboxProvider;
  env?: NodeJS.ProcessEnv;
  policy?: SandboxPolicy;
}

export const SANDBOX_TASK_TIMEOUT_ENV = "AGENT_SPACE_TASK_TIMEOUT_MS";
export const DEFAULT_SANDBOX_TASK_TIMEOUT_MS = 12 * 60 * 60 * 1000;

export function resolveSandboxTaskTimeoutMs(value?: number | string): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }

  return DEFAULT_SANDBOX_TASK_TIMEOUT_MS;
}
