export const DAEMON_PROVIDER_IDS = [
  "claude",
  "codex",
  "antigravity",
  "gemini",
  "opencode",
  "openclaw",
  "nanobot",
  "hermes",
] as const;

export type DaemonProvider = typeof DAEMON_PROVIDER_IDS[number];

const DAEMON_PROVIDER_LABELS: Record<DaemonProvider, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  antigravity: "Antigravity CLI",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
  nanobot: "NanoBot",
  hermes: "Hermes Agent",
};

export function isDaemonProvider(value: string): value is DaemonProvider {
  return DAEMON_PROVIDER_IDS.includes(value as DaemonProvider);
}

export function formatDaemonProviderLabel(provider: string): string {
  return isDaemonProvider(provider) ? DAEMON_PROVIDER_LABELS[provider] : provider;
}
