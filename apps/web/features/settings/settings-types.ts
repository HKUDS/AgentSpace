import type { WorkspaceRole } from "@agent-space/db";
import type {
  FeishuAvailableChannelItem,
  FeishuAvailableUserItem,
  FeishuIntegrationCreationGuide,
  FeishuIntegrationSettingsItem,
} from "@/features/integrations/feishu/feishu-types";
import type { PermissionCenterData } from "@agent-space/services";

export type SettingsTx = (zh: string, en: string) => string;
export type SettingsPermissionCenterData = PermissionCenterData;

export interface SettingsSessionItem {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  ipAddress?: string;
  userAgent?: string;
  revokedAt?: string;
}

export interface SettingsWorkspaceMemberItem {
  userId: string;
  displayName: string;
  primaryEmail?: string;
  role: WorkspaceRole;
}

export interface SettingsWorkspaceInvitationItem {
  id: string;
  email: string;
  role: WorkspaceRole;
  status: "active" | "accepted" | "revoked" | "expired";
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
}

export interface SettingsChannelAccessRequestItem {
  id: string;
  channelName: string;
  requesterUserId: string;
  requesterName: string;
  requesterEmail?: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requestedAt: string;
}

export interface SettingsChannelInvitationItem {
  id: string;
  channelName: string;
  inviteeUserId?: string;
  inviteeEmail?: string;
  invitedByName: string;
  status: "pending" | "accepted" | "rejected" | "revoked" | "expired";
  createdAt: string;
  expiresAt?: string;
}

export type SettingsFeishuIntegrationItem = FeishuIntegrationSettingsItem;
export type SettingsFeishuIntegrationCreationGuide = FeishuIntegrationCreationGuide;
export type SettingsFeishuAvailableChannelItem = FeishuAvailableChannelItem;
export type SettingsFeishuAvailableUserItem = FeishuAvailableUserItem;
