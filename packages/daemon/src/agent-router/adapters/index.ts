import type { AgentRouterHarness, HarnessAdapter } from "../types.ts";
import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";
import { hermesAdapter } from "./hermes.ts";
import { opencodeAdapter } from "./opencode.ts";
import { openClawAdapter } from "./openclaw.ts";

export const HARNESS_ADAPTERS: Record<AgentRouterHarness, HarnessAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
  openclaw: openClawAdapter,
  hermes: hermesAdapter,
};

export function getHarnessAdapter(harness: AgentRouterHarness): HarnessAdapter {
  return HARNESS_ADAPTERS[harness];
}
