import type { Sandbox } from "./interface.ts";
import type { SandboxConnectOptions } from "./types.ts";
import { resolveSandboxProvider } from "./cube/cube-config.ts";
import { CubeSandbox } from "./cube/cube-sandbox.ts";
import { LocalSandbox } from "./local/local-sandbox.ts";

export async function connectSandbox(options: SandboxConnectOptions): Promise<Sandbox> {
  const provider = resolveSandboxProvider(options);

  if (provider === "cube") {
    return CubeSandbox.connect(options);
  }

  return new LocalSandbox(options.workDir, options.runtimeId, options.policy);
}
