export type SandboxTrustLevel = "trusted-local" | "isolated";

export type SandboxTerminationReason =
  | "completed"
  | "timeout"
  | "output_limit"
  | "policy_denied"
  | "resource_limit"
  | "cancelled"
  | "unknown";

export interface SandboxFilesystemPolicy {
  workDir: string;
  allowAbsolutePaths: false;
  allowSymlinks: boolean;
  writableRoots: string[];
  readableRoots: string[];
  maxFileBytes: number;
  maxTotalWriteBytes: number;
  maxArtifactBytes: number;
  allowedArtifactPatterns: string[];
}

export interface SandboxProcessPolicy {
  timeoutMs: number;
  killGracePeriodMs: number;
  maxProcesses?: number;
  maxMemoryBytes?: number;
  maxCpuMillis?: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxCombinedOutputBytes: number;
}

export interface SandboxNetworkPolicy {
  mode: "none" | "allowlist" | "unrestricted";
  allowedHosts: string[];
  allowedPorts?: number[];
  denyPrivateNetworks: boolean;
  denyMetadataEndpoints: true;
  logConnections: boolean;
}

export interface SandboxEnvironmentPolicy {
  inheritHostEnv: boolean;
  allowedEnvKeys: string[];
  sandboxHomeRelativePath: string;
  sandboxTmpRelativePath: string;
}

export interface SandboxCredentialPolicy {
  allowImplicitHostCredentials: boolean;
  credentialEnvKeys: string[];
  redactEnvKeyPatterns: string[];
}

export interface SandboxOutputPolicy {
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxCombinedOutputBytes: number;
}

export interface SandboxAuditPolicy {
  emitEvents: boolean;
  redactSecrets: boolean;
}

export interface SandboxPolicy {
  trustLevel: SandboxTrustLevel;
  filesystem: SandboxFilesystemPolicy;
  process: SandboxProcessPolicy;
  network: SandboxNetworkPolicy;
  environment: SandboxEnvironmentPolicy;
  credentials: SandboxCredentialPolicy;
  output: SandboxOutputPolicy;
  audit: SandboxAuditPolicy;
}

export const DEFAULT_LOCAL_SANDBOX_TIMEOUT_MS = 12 * 60 * 60 * 1000;
export const DEFAULT_LOCAL_SANDBOX_KILL_GRACE_MS = 5_000;
export const DEFAULT_LOCAL_SANDBOX_MAX_FILE_BYTES = 16 * 1024 * 1024;
export const DEFAULT_LOCAL_SANDBOX_MAX_TOTAL_WRITE_BYTES = 128 * 1024 * 1024;
export const DEFAULT_LOCAL_SANDBOX_MAX_STDOUT_BYTES = 8 * 1024 * 1024;
export const DEFAULT_LOCAL_SANDBOX_MAX_STDERR_BYTES = 8 * 1024 * 1024;
export const DEFAULT_LOCAL_SANDBOX_MAX_COMBINED_OUTPUT_BYTES = 12 * 1024 * 1024;

export function createTrustedLocalSandboxPolicy(workDir: string): SandboxPolicy {
  return {
    trustLevel: "trusted-local",
    filesystem: {
      workDir,
      allowAbsolutePaths: false,
      allowSymlinks: false,
      writableRoots: ["."],
      readableRoots: ["."],
      maxFileBytes: DEFAULT_LOCAL_SANDBOX_MAX_FILE_BYTES,
      maxTotalWriteBytes: DEFAULT_LOCAL_SANDBOX_MAX_TOTAL_WRITE_BYTES,
      maxArtifactBytes: DEFAULT_LOCAL_SANDBOX_MAX_FILE_BYTES,
      allowedArtifactPatterns: ["runtime-output/**"],
    },
    process: {
      timeoutMs: DEFAULT_LOCAL_SANDBOX_TIMEOUT_MS,
      killGracePeriodMs: DEFAULT_LOCAL_SANDBOX_KILL_GRACE_MS,
      maxStdoutBytes: DEFAULT_LOCAL_SANDBOX_MAX_STDOUT_BYTES,
      maxStderrBytes: DEFAULT_LOCAL_SANDBOX_MAX_STDERR_BYTES,
      maxCombinedOutputBytes: DEFAULT_LOCAL_SANDBOX_MAX_COMBINED_OUTPUT_BYTES,
    },
    network: {
      mode: "unrestricted",
      allowedHosts: [],
      denyPrivateNetworks: false,
      denyMetadataEndpoints: true,
      logConnections: false,
    },
    environment: {
      inheritHostEnv: false,
      allowedEnvKeys: [
        "PATH",
        "HOME",
        "USERPROFILE",
        "TMPDIR",
        "TMP",
        "TEMP",
        "LANG",
        "LC_ALL",
        "TERM",
        "SystemRoot",
        "WINDIR",
        "COMSPEC",
        "PATHEXT",
      ],
      sandboxHomeRelativePath: ".home",
      sandboxTmpRelativePath: ".tmp",
    },
    credentials: {
      allowImplicitHostCredentials: false,
      credentialEnvKeys: [],
      redactEnvKeyPatterns: [
        "SECRET",
        "TOKEN",
        "PASSWORD",
        "PASSWD",
        "API_KEY",
        "ACCESS_KEY",
        "DATABASE_URL",
        "PRIVATE_KEY",
        "CREDENTIAL",
      ],
    },
    output: {
      maxStdoutBytes: DEFAULT_LOCAL_SANDBOX_MAX_STDOUT_BYTES,
      maxStderrBytes: DEFAULT_LOCAL_SANDBOX_MAX_STDERR_BYTES,
      maxCombinedOutputBytes: DEFAULT_LOCAL_SANDBOX_MAX_COMBINED_OUTPUT_BYTES,
    },
    audit: {
      emitEvents: false,
      redactSecrets: true,
    },
  };
}

export function isSensitiveEnvKey(key: string, policy: SandboxCredentialPolicy): boolean {
  const normalized = key.toUpperCase();
  return policy.redactEnvKeyPatterns.some((pattern) => normalized.includes(pattern.toUpperCase()));
}
