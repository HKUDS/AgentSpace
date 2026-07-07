import {
  listChannelAccessRequestsSync,
  listChannelInvitationsSync,
  listSessionsForUserSync,
  listWorkspaceInvitationsSync,
  listWorkspaceMemberUsersSync,
  readUserSync,
  type WorkspaceRole,
} from "@agent-space/db";
import { getWorkspacePermissionCenterSync } from "@agent-space/services";
import { readPublicAppUrl } from "@/features/auth/public-app-url";
import {
  buildFeishuIntegrationCreationGuide,
  canManageFeishuIntegrations,
  listFeishuAvailableAgents,
  listFeishuAvailableChannels,
  listFeishuAvailableUsers,
  listFeishuIntegrationSettingsItems,
} from "@/features/integrations/feishu/feishu-settings-data";
import {
  buildSlackIntegrationCreationGuide,
  canManageSlackIntegrations,
  listSlackAvailableChannels,
  listSlackAvailableUsers,
  listSlackIntegrationSettingsItems,
} from "@/features/integrations/slack/slack-settings-data";
import {
  canAccessSettingsSection,
  DEFAULT_SETTINGS_SECTION,
  isSettingsDetailSectionId,
  type SettingsDetailSectionId,
  type SettingsSectionId,
} from "@/features/settings/settings-sections";
import type {
  SettingsChannelAccessRequestItem,
  SettingsChannelInvitationItem,
  SettingsFeishuAvailableAgentItem,
  SettingsFeishuAvailableChannelItem,
  SettingsFeishuAvailableUserItem,
  SettingsFeishuIntegrationCreationGuide,
  SettingsFeishuIntegrationItem,
  SettingsPermissionCenterData,
  SettingsSessionItem,
  SettingsSlackAvailableChannelItem,
  SettingsSlackAvailableUserItem,
  SettingsSlackIntegrationCreationGuide,
  SettingsSlackIntegrationItem,
  SettingsWorkspaceInvitationItem,
  SettingsWorkspaceMemberItem,
} from "@/features/settings/settings-types";

export interface SettingsPageData {
  currentMembershipRole: WorkspaceRole;
  currentSessionId?: string;
  currentUserDisplayName: string;
  currentUserEmail: string;
  currentUserId: string;
  currentWorkspaceName: string;
  currentWorkspaceSlug: string;
  currentWorkspaceJoinCode?: string;
  currentWorkspaceJoinCodeUpdatedAt?: string;
  initialSection: SettingsSectionId;
  invitations: SettingsWorkspaceInvitationItem[];
  channelAccessRequests: SettingsChannelAccessRequestItem[];
  channelInvitations: SettingsChannelInvitationItem[];
  feishuAvailableAgents: SettingsFeishuAvailableAgentItem[];
  feishuAvailableChannels: SettingsFeishuAvailableChannelItem[];
  feishuAvailableUsers: SettingsFeishuAvailableUserItem[];
  feishuIntegrationCreationGuide?: SettingsFeishuIntegrationCreationGuide;
  feishuIntegrations: SettingsFeishuIntegrationItem[];
  slackAvailableChannels?: SettingsSlackAvailableChannelItem[];
  slackAvailableUsers?: SettingsSlackAvailableUserItem[];
  slackIntegrationCreationGuide?: SettingsSlackIntegrationCreationGuide;
  slackIntegrations?: SettingsSlackIntegrationItem[];
  members: SettingsWorkspaceMemberItem[];
  permissions?: SettingsPermissionCenterData;
  sessions: SettingsSessionItem[];
}

export function resolveSettingsLoaderSection(
  settingsPath?: readonly string[],
): SettingsDetailSectionId | undefined {
  if (!settingsPath || settingsPath.length === 0) {
    return undefined;
  }
  if (settingsPath.length > 1) {
    return undefined;
  }

  const [section] = settingsPath;
  return section && isSettingsDetailSectionId(section) ? section : undefined;
}

export function loadSettingsPageData(input: {
  currentSessionId?: string;
  currentUser: {
    displayName: string;
    email?: string;
    id: string;
  };
  currentWorkspace: {
    id: string;
    joinCode?: string;
    joinCodeUpdatedAt?: string;
    name: string;
    slug: string;
  };
  role: WorkspaceRole;
  section?: SettingsSectionId;
}): SettingsPageData {
  const requestedSection = input.section ?? DEFAULT_SETTINGS_SECTION;
  if (!canAccessSettingsSection(input.role, requestedSection)) {
    throw new SettingsSectionForbiddenError(requestedSection);
  }

  const workspaceId = input.currentWorkspace.id;
  const shouldLoadMembers = requestedSection === "members";
  const shouldLoadInvitations = requestedSection === "access";
  const shouldLoadIntegrations = requestedSection === "integrations";
  const shouldLoadPermissions = requestedSection === "permissions";
  const shouldLoadSessions = requestedSection === "security";
  const canManageFeishu = canManageFeishuIntegrations(input.role);
  const canManageSlack = canManageSlackIntegrations(input.role);
  const feishuAvailableUsers = shouldLoadIntegrations
    ? listFeishuAvailableUsers({ workspaceId })
      .filter((user) => canManageFeishu || user.userId === input.currentUser.id)
    : [];
  const slackAvailableUsers = shouldLoadIntegrations
    ? listSlackAvailableUsers({ workspaceId })
      .filter((user) => canManageSlack || user.userId === input.currentUser.id)
    : [];

  return {
    currentMembershipRole: input.role,
    currentSessionId: input.currentSessionId,
    currentUserDisplayName: input.currentUser.displayName,
    currentUserEmail: input.currentUser.email ?? "",
    currentUserId: input.currentUser.id,
    currentWorkspaceName: input.currentWorkspace.name,
    currentWorkspaceSlug: input.currentWorkspace.slug,
    currentWorkspaceJoinCode: input.role === "owner" ? input.currentWorkspace.joinCode : undefined,
    currentWorkspaceJoinCodeUpdatedAt: input.role === "owner" ? input.currentWorkspace.joinCodeUpdatedAt : undefined,
    initialSection: requestedSection,
    invitations: shouldLoadInvitations
      ? listWorkspaceInvitationsSync(workspaceId, {
        statuses: ["active", "accepted", "revoked", "expired"],
      })
      : [],
    channelAccessRequests: shouldLoadInvitations
      ? listChannelAccessRequestsSync(workspaceId, { statuses: ["pending"] }).map((request) => {
        const requester = readUserSync(request.userId);
        return {
          id: request.id,
          channelName: request.channelName,
          requesterUserId: request.userId,
          requesterName: requester?.displayName ?? request.userId,
          requesterEmail: requester?.primaryEmail,
          status: request.status,
          requestedAt: request.requestedAt,
        };
      })
      : [],
    channelInvitations: shouldLoadInvitations
      ? listChannelInvitationsSync(workspaceId, { statuses: ["pending"] }).map((invitation) => {
        const inviter = readUserSync(invitation.invitedBy);
        return {
          id: invitation.id,
          channelName: invitation.channelName,
          inviteeUserId: invitation.inviteeUserId,
          inviteeEmail: invitation.inviteeEmail,
          invitedByName: inviter?.displayName ?? invitation.invitedBy,
          status: invitation.status,
          createdAt: invitation.createdAt,
          expiresAt: invitation.expiresAt,
        };
      })
      : [],
    feishuAvailableChannels: shouldLoadIntegrations
      ? canManageFeishu
        ? listFeishuAvailableChannels({ workspaceId })
        : []
      : [],
    feishuAvailableAgents: shouldLoadIntegrations
      ? canManageFeishu
        ? listFeishuAvailableAgents({ workspaceId })
        : []
      : [],
    feishuAvailableUsers,
    feishuIntegrationCreationGuide: shouldLoadIntegrations && canManageFeishu
      ? buildFeishuIntegrationCreationGuide({
        workspaceId,
        appUrl: readPublicAppUrl(),
      })
      : undefined,
    feishuIntegrations: shouldLoadIntegrations
      ? listFeishuIntegrationSettingsItems({
        workspaceId,
        appUrl: readPublicAppUrl(),
        viewer: {
          role: input.role,
          userId: input.currentUser.id,
        },
      })
      : [],
    slackAvailableChannels: shouldLoadIntegrations
      ? canManageSlack
        ? listSlackAvailableChannels({ workspaceId })
        : []
      : [],
    slackAvailableUsers,
    slackIntegrationCreationGuide: shouldLoadIntegrations && canManageSlack
      ? buildSlackIntegrationCreationGuide({
        workspaceId,
        appUrl: readPublicAppUrl(),
      })
      : undefined,
    slackIntegrations: shouldLoadIntegrations
      ? listSlackIntegrationSettingsItems({
        workspaceId,
        appUrl: readPublicAppUrl(),
        viewer: {
          role: input.role,
          userId: input.currentUser.id,
        },
      })
      : [],
    members: shouldLoadMembers ? listWorkspaceMemberUsersSync(workspaceId) : [],
    permissions: shouldLoadPermissions
      ? getWorkspacePermissionCenterSync({
        workspaceId,
        actor: {
          userId: input.currentUser.id,
          displayName: input.currentUser.displayName,
          role: input.role,
        },
      })
      : undefined,
    sessions: shouldLoadSessions ? listSessionsForUserSync(input.currentUser.id) : [],
  };
}

export class SettingsSectionForbiddenError extends Error {
  constructor(readonly section: SettingsSectionId) {
    super(`Settings section is not accessible: ${section}`);
  }
}
