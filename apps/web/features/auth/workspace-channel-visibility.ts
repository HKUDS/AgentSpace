import type { SearchResult } from "@agent-space/services";
import {
  canReadChannelForActorSync,
  readWorkspaceStateSync,
  resolveChannelHumanMemberNames,
  sameValue,
} from "@agent-space/services";
import type { ChannelRecord } from "@agent-space/domain/workspace";
import type { WorkspaceRole } from "@agent-space/db";

export interface WorkspaceChannelVisibility {
  readonly visibleChannelNames: string[];
  canAccessChannel: (channelName?: string | null) => boolean;
}

export function getWorkspaceChannelVisibilitySync(
  workspaceId: string,
  humanMemberName: string,
  actor?: { userId: string; displayName?: string; role?: WorkspaceRole },
): WorkspaceChannelVisibility {
  const state = readWorkspaceStateSync(workspaceId);
  const trimmedHumanMemberName = humanMemberName.trim();
  const visibleChannelNames = state.channels
    .filter((channel) => actor?.userId
      ? canReadChannelForActorSync({
          workspaceId,
          channelName: channel.name,
          actor: {
            userId: actor.userId,
            displayName: actor.displayName?.trim() || trimmedHumanMemberName,
            role: actor.role,
          },
        })
      : canHumanMemberAccessChannel(state, channel, trimmedHumanMemberName))
    .map((channel) => channel.name);

  return {
    visibleChannelNames,
    canAccessChannel: (channelName) => {
      if (!channelName || channelName.trim().length === 0) {
        return true;
      }
      return visibleChannelNames.some((candidate) => sameValue(candidate, channelName));
    },
  };
}

export function filterSearchResultsByChannelVisibility(
  results: SearchResult[],
  visibility: WorkspaceChannelVisibility,
): SearchResult[] {
  return results.filter((result) => visibility.canAccessChannel(result.meta?.channel));
}

function canHumanMemberAccessChannel(
  state: ReturnType<typeof readWorkspaceStateSync>,
  channel: Pick<ChannelRecord, "humanMemberNames" | "humanMembers">,
  humanMemberName: string,
): boolean {
  const resolvedHumanMemberNames = resolveChannelHumanMemberNames(state, channel);
  if (resolvedHumanMemberNames.length === 0) {
    // Memberless channels default to private (deny); returning true would make
    // them readable by every workspace member.
    return false;
  }
  if (!humanMemberName) {
    return false;
  }
  return resolvedHumanMemberNames.some((candidate) => sameValue(candidate, humanMemberName));
}
