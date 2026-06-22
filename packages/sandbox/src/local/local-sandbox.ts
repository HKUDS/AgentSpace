import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { access, cp, lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { platform } from "node:process";
import type { ChildProcess } from "node:child_process";
import type { Sandbox } from "../interface.ts";
import type { ExecCommand, ExecResult, FileEntry, SandboxStatus } from "../types.ts";
import { createTrustedLocalSandboxPolicy, isSensitiveEnvKey, type SandboxPolicy, type SandboxTerminationReason } from "../policy.ts";

const WRITE_TOTAL_UNAVAILABLE = -1;

/**
 * LocalSandbox provides trusted local execution with path and process
 * safeguards. It is not a security boundary against malicious code.
 */
export class LocalSandbox implements Sandbox {
  readonly id: string;

  private readonly workDir: string;
  private readonly policy: SandboxPolicy;
  private readonly activeChildren = new Set<ChildProcess>();
  private statusValue: SandboxStatus = "active";
  private stopped = false;
  private destroyed = false;
  private totalWriteBytes = 0;

  constructor(workDir: string, runtimeId: string, policy?: SandboxPolicy) {
    this.workDir = resolve(workDir);
    this.policy = policy ?? createTrustedLocalSandboxPolicy(this.workDir);
    this.id = runtimeId;
  }

  get status(): SandboxStatus {
    return this.statusValue;
  }

  async readFile(path: string): Promise<string> {
    this.assertUsable();
    return readFile(await this.resolveExistingInsideSandbox(path, "read"), "utf8");
  }

  async writeFile(path: string, contents: string): Promise<void> {
    this.assertUsable();
    this.assertWithinFileWriteLimit(contents);
    const absolutePath = await this.resolveWritableInsideSandbox(path);
    await writeFile(absolutePath, contents, "utf8");
    this.totalWriteBytes += Buffer.byteLength(contents, "utf8");
  }

  async readDir(path: string): Promise<FileEntry[]> {
    this.assertUsable();
    const absolutePath = await this.resolveExistingInsideSandbox(path, "read");
    const entries = await readdir(absolutePath, { withFileTypes: true });

    return Promise.all(entries.map(async (entry) => {
      const entryPath = join(absolutePath, entry.name);
      const stats = await lstat(entryPath);
      return {
        name: entry.name,
        path: relative(this.workDir, entryPath) || ".",
        isDirectory: entry.isDirectory(),
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      } satisfies FileEntry;
    }));
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(await this.resolveExistingInsideSandbox(path, "read"));
      return true;
    } catch {
      return false;
    }
  }

  async exec(command: ExecCommand): Promise<ExecResult> {
    this.assertUsable();
    const startedAt = Date.now();
    const resolved = resolveSpawnCommand(command.command);
    const args = [...resolved.prependArgs, ...(command.args ?? [])];
    const cwd = await this.resolveCommandCwd(command.cwd);
    const env = await this.buildSandboxEnv(command.env);
    let terminationReason: SandboxTerminationReason = "completed";
    let outputLimitExceeded = false;
    const child = spawn(resolved.command, args, {
      cwd,
      detached: platform !== "win32",
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.activeChildren.add(child);
    child.stdin.on("error", () => {
      // The process may exit before it consumes stdin; stdout/stderr still
      // carry the actionable failure details.
    });
    const stdinController = {
      writeStdin: (data: string): void => {
        if (!child.stdin.destroyed && child.stdin.writable) {
          child.stdin.write(data);
        }
      },
      closeStdin: (): void => {
        if (!child.stdin.destroyed && child.stdin.writable) {
          child.stdin.end();
        }
      },
    };
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let killTimer: NodeJS.Timeout | undefined;
    let timeout: NodeJS.Timeout | undefined;

    return await new Promise<ExecResult>((resolvePromise, rejectPromise) => {
      child.stdout.on("data", (chunk) => {
        const value = String(chunk);
        const append = appendBoundedOutput(stdout, value, this.policy.output.maxStdoutBytes);
        stdout = append.value;
        stdoutTruncated ||= append.truncated;
        command.onStdout?.(append.acceptedChunk);
        if (this.outputLimitExceeded(stdout, stderr, stdoutTruncated, stderrTruncated)) {
          outputLimitExceeded = true;
          terminationReason = "output_limit";
          this.terminateChild(child);
        }
      });

      child.stderr.on("data", (chunk) => {
        const value = String(chunk);
        const append = appendBoundedOutput(stderr, value, this.policy.output.maxStderrBytes);
        stderr = append.value;
        stderrTruncated ||= append.truncated;
        command.onStderr?.(append.acceptedChunk);
        if (this.outputLimitExceeded(stdout, stderr, stdoutTruncated, stderrTruncated)) {
          outputLimitExceeded = true;
          terminationReason = "output_limit";
          this.terminateChild(child);
        }
      });

      command.onReady?.(stdinController);
      if (command.keepStdinOpen) {
        if (command.input) {
          stdinController.writeStdin(command.input);
        }
      } else {
        child.stdin.end(command.input ?? "");
      }

      if (command.timeoutMs && command.timeoutMs > 0) {
        timeout = setTimeout(() => {
          timedOut = true;
          terminationReason = "timeout";
          this.terminateChild(child);
          killTimer = setTimeout(() => {
            this.killChild(child);
          }, this.policy.process.killGracePeriodMs);
        }, command.timeoutMs);
      }

      child.on("error", (error) => {
        clearTimeout(timeout);
        clearTimeout(killTimer);
        this.activeChildren.delete(child);
        rejectPromise(error);
      });

      child.on("close", (exitCode, signal) => {
        clearTimeout(timeout);
        clearTimeout(killTimer);
        this.activeChildren.delete(child);
        resolvePromise({
          stdout,
          stderr,
          exitCode,
          signal: signal ?? undefined,
          durationMs: Date.now() - startedAt,
          timedOut,
          stdoutTruncated,
          stderrTruncated,
          outputLimitExceeded,
          terminationReason: exitCode === null && terminationReason === "completed" ? "unknown" : terminationReason,
        });
      });
    });
  }

  async snapshot(): Promise<string> {
    this.assertUsable();
    await this.resolveExistingInsideSandbox(".", "read");
    const snapshotDir = join(dirname(this.workDir), ".snapshots");
    const snapshotPath = join(snapshotDir, `${this.id}-${Date.now().toString(36)}`);
    await mkdir(snapshotDir, { recursive: true });
    await cp(this.workDir, snapshotPath, { force: true, recursive: true });
    return snapshotPath;
  }

  async stop(): Promise<void> {
    if (this.stopped || this.destroyed) {
      return;
    }
    this.stopped = true;
    for (const child of this.activeChildren) {
      this.terminateChild(child);
    }
    this.activeChildren.clear();
    this.statusValue = "stopped";
  }

  async destroy(): Promise<void> {
    await this.stop();
    if (this.destroyed) {
      return;
    }
    await this.assertDestroyTargetSafe();
    await rm(this.workDir, { recursive: true, force: true });
    this.destroyed = true;
  }

  private assertUsable(): void {
    if (this.destroyed) {
      throw new Error("Sandbox has been destroyed.");
    }
  }

  private rejectUnsafePath(path: string): void {
    if (!path || path.trim() === "") {
      throw new Error("Sandbox path must not be empty.");
    }
    if (isAbsolute(path)) {
      throw new Error(`Absolute sandbox paths are not allowed: ${path}`);
    }
  }

  private async resolveExistingInsideSandbox(path: string, accessType: "read" | "write"): Promise<string> {
    this.rejectUnsafePath(path);
    const absolutePath = resolve(this.workDir, path);
    assertPathInside(this.workDir, absolutePath, `Path "${path}" escapes sandbox root.`);
    if (!this.policy.filesystem.allowSymlinks) {
      await assertNoSymlinkSegments(this.workDir, absolutePath);
    }
    const realTarget = await realpath(absolutePath);
    assertPathInside(this.workDir, realTarget, `Path "${path}" resolves outside sandbox root.`);
    this.assertPolicyRootAllowed(realTarget, accessType);
    return realTarget;
  }

  private async resolveWritableInsideSandbox(path: string): Promise<string> {
    this.rejectUnsafePath(path);
    const absolutePath = resolve(this.workDir, path);
    assertPathInside(this.workDir, absolutePath, `Path "${path}" escapes sandbox root.`);
    if (!this.policy.filesystem.allowSymlinks) {
      await assertNoSymlinkSegments(this.workDir, absolutePath);
    }

    try {
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        throw new Error(`Path "${path}" is a symlink and cannot be written.`);
      }
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }

    const existingParent = await findExistingParent(dirname(absolutePath));
    const realParent = await realpath(existingParent);
    assertPathInside(this.workDir, realParent, `Parent for "${path}" resolves outside sandbox root.`);
    this.assertPolicyRootAllowed(realParent, "write");
    await mkdir(dirname(absolutePath), { recursive: true });
    const realCreatedParent = await realpath(dirname(absolutePath));
    assertPathInside(this.workDir, realCreatedParent, `Parent for "${path}" resolves outside sandbox root.`);
    return absolutePath;
  }

  private assertPolicyRootAllowed(target: string, accessType: "read" | "write"): void {
    const roots = accessType === "read"
      ? this.policy.filesystem.readableRoots
      : this.policy.filesystem.writableRoots;
    const allowed = roots.some((root) => {
      const rootPath = resolve(this.workDir, root);
      return isPathInside(rootPath, target);
    });
    if (!allowed) {
      throw new Error(`Sandbox ${accessType} denied by filesystem policy.`);
    }
  }

  private assertWithinFileWriteLimit(contents: string): void {
    const bytes = Buffer.byteLength(contents, "utf8");
    if (bytes > this.policy.filesystem.maxFileBytes) {
      throw new Error(`Sandbox write exceeds maxFileBytes (${this.policy.filesystem.maxFileBytes}).`);
    }
    if (this.totalWriteBytes !== WRITE_TOTAL_UNAVAILABLE && this.totalWriteBytes + bytes > this.policy.filesystem.maxTotalWriteBytes) {
      throw new Error(`Sandbox write exceeds maxTotalWriteBytes (${this.policy.filesystem.maxTotalWriteBytes}).`);
    }
  }

  private async resolveCommandCwd(cwd: string | undefined): Promise<string> {
    if (!cwd || cwd === ".") {
      return this.workDir;
    }

    if (isAbsolute(cwd)) {
      throw new Error(`Absolute sandbox cwd is not allowed: ${cwd}`);
    }
    return this.resolveExistingInsideSandbox(cwd, "read");
  }

  private async buildSandboxEnv(commandEnv: NodeJS.ProcessEnv | undefined): Promise<NodeJS.ProcessEnv> {
    const sandboxHome = join(this.workDir, this.policy.environment.sandboxHomeRelativePath);
    const sandboxTmp = join(this.workDir, this.policy.environment.sandboxTmpRelativePath);
    await mkdir(sandboxHome, { recursive: true });
    await mkdir(sandboxTmp, { recursive: true });

    const env: NodeJS.ProcessEnv = {};
    const source = this.policy.environment.inheritHostEnv ? process.env : {};
    for (const key of this.policy.environment.allowedEnvKeys) {
      const value = source[key] ?? commandEnv?.[key];
      if (typeof value === "string" && !isSensitiveEnvKey(key, this.policy.credentials)) {
        env[key] = value;
      }
    }

    env.HOME = sandboxHome;
    env.USERPROFILE = sandboxHome;
    env.TMPDIR = sandboxTmp;
    env.TMP = sandboxTmp;
    env.TEMP = sandboxTmp;

    for (const [key, value] of Object.entries(commandEnv ?? {})) {
      if (typeof value !== "string") {
        continue;
      }
      if (isSandboxManagedEnvKey(key)) {
        continue;
      }
      if (this.policy.environment.allowedEnvKeys.includes(key) && !isSensitiveEnvKey(key, this.policy.credentials)) {
        env[key] = value;
      }
      if (this.policy.credentials.credentialEnvKeys.includes(key)) {
        env[key] = value;
      }
    }

    return env;
  }

  private outputLimitExceeded(stdout: string, stderr: string, stdoutTruncated: boolean, stderrTruncated: boolean): boolean {
    return stdoutTruncated
      || stderrTruncated
      || Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(stderr, "utf8") >= this.policy.output.maxCombinedOutputBytes;
  }

  private terminateChild(child: ChildProcess): void {
    if (child.pid && platform !== "win32") {
      try {
        process.kill(-child.pid, "SIGTERM");
        return;
      } catch {
        // Fall back to killing the direct child below.
      }
    }
    child.kill("SIGTERM");
  }

  private killChild(child: ChildProcess): void {
    if (child.pid && platform !== "win32") {
      try {
        process.kill(-child.pid, "SIGKILL");
        return;
      } catch {
        // Fall back to killing the direct child below.
      }
    }
    child.kill("SIGKILL");
  }

  private async assertDestroyTargetSafe(): Promise<void> {
    const parsed = parse(this.workDir);
    if (this.workDir === parsed.root || relative(parsed.root, this.workDir).split(sep).filter(Boolean).length < 2) {
      throw new Error(`Refusing to destroy unsafe sandbox root: ${this.workDir}`);
    }
    const realWorkDir = await realpath(this.workDir);
    if (realWorkDir === parsed.root) {
      throw new Error(`Refusing to destroy filesystem root: ${this.workDir}`);
    }
  }
}

function appendBoundedOutput(current: string, chunk: string, maxBytes: number): { value: string; acceptedChunk: string; truncated: boolean } {
  const currentBytes = Buffer.byteLength(current, "utf8");
  const remainingBytes = Math.max(0, maxBytes - currentBytes);
  if (remainingBytes <= 0) {
    return { value: current, acceptedChunk: "", truncated: chunk.length > 0 };
  }

  const chunkBytes = Buffer.from(chunk, "utf8");
  if (chunkBytes.byteLength <= remainingBytes) {
    return { value: current + chunk, acceptedChunk: chunk, truncated: false };
  }

  const acceptedChunk = chunkBytes.subarray(0, remainingBytes).toString("utf8");
  return {
    value: current + acceptedChunk,
    acceptedChunk,
    truncated: true,
  };
}

function assertPathInside(root: string, target: string, message: string): void {
  if (!isPathInside(root, target)) {
    throw new Error(message);
  }
}

function isPathInside(root: string, target: string): boolean {
  const relativePath = relative(root, target);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

async function assertNoSymlinkSegments(root: string, target: string): Promise<void> {
  const rootPath = resolve(root);
  const targetPath = resolve(target);
  const relativePath = relative(rootPath, targetPath);
  if (relativePath === "") {
    return;
  }
  let cursor = rootPath;
  for (const segment of relativePath.split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, segment);
    try {
      const stats = await lstat(cursor);
      if (stats.isSymbolicLink()) {
        throw new Error(`Sandbox path contains a symlink segment: ${cursor}`);
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }
      throw error;
    }
  }
}

async function findExistingParent(path: string): Promise<string> {
  let cursor = resolve(path);
  while (true) {
    try {
      const stats = await lstat(cursor);
      if (!stats.isDirectory()) {
        throw new Error(`Sandbox parent is not a directory: ${cursor}`);
      }
      return cursor;
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      const next = dirname(cursor);
      if (next === cursor) {
        throw error;
      }
      cursor = next;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isSandboxManagedEnvKey(key: string): boolean {
  return ["HOME", "USERPROFILE", "TMPDIR", "TMP", "TEMP"].includes(key);
}

function findExecutableOnPath(command: string): string | null {
  const pathValue = process.env.PATH;
  if (!pathValue) {
    return null;
  }

  const extensions = platform === "win32" ? [".exe", ".cmd", ".ps1", ""] : [""];
  for (const baseDir of pathValue.split(delimiter)) {
    for (const extension of extensions) {
      const candidate = join(baseDir, command + extension);
      if (isExecutableCandidate(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function isExecutableCandidate(candidate: string): boolean {
  return existsSync(candidate);
}

function needsShellSpawn(executablePath: string): boolean {
  if (platform !== "win32") {
    return false;
  }

  const normalized = executablePath.toLowerCase();
  return normalized.endsWith(".cmd") || normalized.endsWith(".ps1");
}

function resolveSpawnCommand(command: string): { command: string; prependArgs: string[] } {
  const executablePath = isAbsolute(command) ? command : (findExecutableOnPath(command) ?? command);

  if (!needsShellSpawn(executablePath)) {
    return { command: executablePath, prependArgs: [] };
  }

  try {
    const content = existsSync(executablePath) ? readFileSync(executablePath, "utf8") : "";
    const match = content.match(/"?%dp0%[\\\/]?(node_modules[\\\/][^"]+\.js)"?/);
    if (match) {
      const jsPath = join(dirname(executablePath), match[1].replace(/%\*/g, "").trim());
      if (existsSync(jsPath)) {
        return { command: process.execPath, prependArgs: [jsPath] };
      }
    }
  } catch {
    // Fall back to spawning the wrapper directly.
  }

  return { command: executablePath, prependArgs: [] };
}
