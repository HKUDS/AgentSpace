import { readWorkspaceSync } from "@agent-space/db";

export function buildAgentSpaceChannelDeepLink(input: {
  workspaceId: string;
  channelName: string;
}): string | undefined {
  const appUrl = readAgentSpaceAppUrl();
  if (!appUrl) {
    return undefined;
  }
  const url = new URL(`/w/${encodeURIComponent(resolveWorkspaceSlug(input.workspaceId))}/im`, appUrl);
  url.searchParams.set("focus", `channel:${input.channelName}`);
  return url.toString();
}

export function buildAgentSpaceSettingsIntegrationsDeepLink(input: {
  workspaceId: string;
  target?: "channel-bindings" | "user-bindings";
}): string | undefined {
  const appUrl = readAgentSpaceAppUrl();
  if (!appUrl) {
    return undefined;
  }
  const url = new URL(`/w/${encodeURIComponent(resolveWorkspaceSlug(input.workspaceId))}/settings/integrations`, appUrl);
  if (input.target === "channel-bindings") {
    url.hash = "feishu-channel-bindings";
  } else if (input.target === "user-bindings") {
    url.hash = "feishu-user-bindings";
  }
  return url.toString();
}

export function readAgentSpaceAppUrl(): string | undefined {
  const value = process.env.AGENT_SPACE_APP_URL?.trim()
    || process.env.NEXT_PUBLIC_AGENT_SPACE_APP_URL?.trim()
    || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value).toString();
  } catch {
    return undefined;
  }
}

function resolveWorkspaceSlug(workspaceId: string): string {
  try {
    const workspace = readWorkspaceSync(workspaceId);
    return workspace?.slug || workspaceId;
  } catch {
    return workspaceId;
  }
}
