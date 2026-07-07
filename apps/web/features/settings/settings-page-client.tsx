"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type MouseEvent, useCallback, useEffect, useState, useTransition } from "react";
import type { WorkspaceRole } from "@agent-space/db";
import { buildWorkspacePath } from "@/features/auth/workspace-paths";
import { refreshWorkspaceModule } from "@/features/dashboard/workspace-module-refresh";
import { useWorkspaceModuleNavigation } from "@/features/dashboard/workspace-module-navigation";
import { SettingsSidebar } from "@/features/settings/components/settings-chrome";
import {
  SettingsAccessSection,
  SettingsAccountSection,
  SettingsMembersSection,
  SettingsPreferencesSection,
  SettingsSecuritySection,
  SettingsWorkspaceSection,
  SettingsIntegrationsSection,
} from "@/features/settings/components/settings-section-content";
import { getSettingsSectionMeta } from "@/features/settings/settings-meta";
import {
  canAccessSettingsSection,
  DEFAULT_SETTINGS_SECTION,
  getSettingsSectionPath,
  type SettingsSectionId,
} from "@/features/settings/settings-sections";
import {
  useSidebarVisibility,
} from "@/features/dashboard/sidebar-visibility-provider";
import { useLanguage } from "@/features/i18n/language-provider";
import { PermissionsCenterSection } from "@/features/permissions/permissions-center-section";
import type {
  SettingsPermissionCenterData,
  SettingsSessionItem,
  SettingsChannelAccessRequestItem,
  SettingsChannelInvitationItem,
  SettingsFeishuAvailableAgentItem,
  SettingsFeishuAvailableChannelItem,
  SettingsFeishuAvailableUserItem,
  SettingsFeishuIntegrationCreationGuide,
  SettingsFeishuIntegrationItem,
  SettingsSlackAvailableChannelItem,
  SettingsSlackAvailableUserItem,
  SettingsSlackIntegrationCreationGuide,
  SettingsSlackIntegrationItem,
  SettingsWorkspaceInvitationItem,
  SettingsWorkspaceMemberItem,
} from "@/features/settings/settings-types";

export type {
  SettingsPermissionCenterData,
  SettingsSessionItem,
  SettingsChannelAccessRequestItem,
  SettingsChannelInvitationItem,
  SettingsFeishuAvailableChannelItem,
  SettingsFeishuAvailableUserItem,
  SettingsFeishuIntegrationCreationGuide,
  SettingsFeishuIntegrationItem,
  SettingsSlackAvailableChannelItem,
  SettingsSlackAvailableUserItem,
  SettingsSlackIntegrationCreationGuide,
  SettingsSlackIntegrationItem,
  SettingsWorkspaceInvitationItem,
  SettingsWorkspaceMemberItem,
} from "@/features/settings/settings-types";

export function SettingsPageClient({
  activeSection,
  initialSection,
  currentMembershipRole = "member",
  currentSessionId,
  currentUserDisplayName = "",
  currentUserEmail = "",
  currentUserId,
  currentWorkspaceName = "",
  currentWorkspaceSlug = "",
  currentWorkspaceJoinCode,
  currentWorkspaceJoinCodeUpdatedAt,
  invitations = [],
  channelAccessRequests = [],
  channelInvitations = [],
  feishuAvailableAgents = [],
  feishuAvailableChannels = [],
  feishuAvailableUsers = [],
  feishuIntegrationCreationGuide,
  feishuIntegrations = [],
  slackAvailableChannels = [],
  slackAvailableUsers = [],
  slackIntegrationCreationGuide,
  slackIntegrations = [],
  members = [],
  permissions,
  sessions = [],
  onDataChanged,
}: {
  activeSection?: SettingsSectionId;
  initialSection?: SettingsSectionId;
  currentMembershipRole?: WorkspaceRole;
  currentSessionId?: string;
  currentUserDisplayName?: string;
  currentUserEmail?: string;
  currentUserId?: string;
  currentWorkspaceName?: string;
  currentWorkspaceSlug?: string;
  currentWorkspaceJoinCode?: string;
  currentWorkspaceJoinCodeUpdatedAt?: string;
  invitations?: SettingsWorkspaceInvitationItem[];
  channelAccessRequests?: SettingsChannelAccessRequestItem[];
  channelInvitations?: SettingsChannelInvitationItem[];
  feishuAvailableAgents?: SettingsFeishuAvailableAgentItem[];
  feishuAvailableChannels?: SettingsFeishuAvailableChannelItem[];
  feishuAvailableUsers?: SettingsFeishuAvailableUserItem[];
  feishuIntegrationCreationGuide?: SettingsFeishuIntegrationCreationGuide;
  feishuIntegrations?: SettingsFeishuIntegrationItem[];
  slackAvailableChannels?: SettingsSlackAvailableChannelItem[];
  slackAvailableUsers?: SettingsSlackAvailableUserItem[];
  slackIntegrationCreationGuide?: SettingsSlackIntegrationCreationGuide;
  slackIntegrations?: SettingsSlackIntegrationItem[];
  members?: SettingsWorkspaceMemberItem[];
  permissions?: SettingsPermissionCenterData;
  sessions?: SettingsSessionItem[];
  onDataChanged?: () => void;
}) {
  const { language, setLanguage, tx } = useLanguage();
  const router = useRouter();
  const { navigateWorkspaceModule } = useWorkspaceModuleNavigation();
  const { visibility, setSectionVisibility } = useSidebarVisibility();
  const [isHydrated, setIsHydrated] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [displayName, setDisplayName] = useState(currentUserDisplayName);
  const [savedDisplayName, setSavedDisplayName] = useState(currentUserDisplayName);
  const [workspaceName, setWorkspaceName] = useState(currentWorkspaceName);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("member");
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null);
  const [createdInvitePath, setCreatedInvitePath] = useState<string | null>(null);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<WorkspaceRole>("member");
  const [memberFeedback, setMemberFeedback] = useState<string | null>(null);
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);
  const [workspaceFeedback, setWorkspaceFeedback] = useState<string | null>(null);
  const [securityFeedback, setSecurityFeedback] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState<"active" | "revoked" | "all">("active");

  const requestedSection = activeSection ?? initialSection ?? DEFAULT_SETTINGS_SECTION;
  const resolvedActiveSection = canAccessSettingsSection(currentMembershipRole, requestedSection)
    ? requestedSection
    : DEFAULT_SETTINGS_SECTION;
  const currentSectionMeta = getSettingsSectionMeta(resolvedActiveSection, tx);
  const canManageMembers = currentMembershipRole === "owner" || currentMembershipRole === "admin";
  const canManageWorkspaceProfile = currentMembershipRole === "owner";
  const assignableRoles = currentMembershipRole === "owner"
    ? (["member", "admin", "owner"] as const)
    : (["member", "admin"] as const);
  const ownerCount = members.filter((member) => member.role === "owner").length;
  const activeInvitations = invitations.filter((invitation) => invitation.status === "active");
  const invitationHistory = invitations.filter((invitation) => invitation.status !== "active");
  const currentAccountEmail = currentUserEmail || (members.find((member) => member.userId === currentUserId)?.primaryEmail ?? "");

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  function workspaceHref(path: string): string {
    return currentWorkspaceSlug ? buildWorkspacePath(currentWorkspaceSlug, path) : path;
  }

  const handleSettingsNavigate = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    const href = event.currentTarget.href;
    if (!navigateWorkspaceModule(href)) {
      return;
    }

    event.preventDefault();
  }, [navigateWorkspaceModule]);
  const refreshSettingsData = useCallback(() => {
    refreshWorkspaceModule(onDataChanged, router);
  }, [onDataChanged, router]);

  return (
    <section className="page-shell settings-page" data-hydrated={isHydrated ? "true" : undefined}>
      <div className="settings-layout">
        <SettingsSidebar
          currentMembershipRole={currentMembershipRole}
          currentWorkspaceSlug={currentWorkspaceSlug}
          onNavigate={handleSettingsNavigate}
          resolvedActiveSection={resolvedActiveSection}
          tx={tx}
        />

        <div className="settings-content">
          {resolvedActiveSection !== DEFAULT_SETTINGS_SECTION ? (
            <Link
              className="settings-mobile-back"
              href={workspaceHref(getSettingsSectionPath(DEFAULT_SETTINGS_SECTION))}
              onClick={handleSettingsNavigate}
              prefetch={false}
            >
              {tx("返回账号资料", "Back to account")}
            </Link>
          ) : null}

          {resolvedActiveSection === "account" ? (
            <SettingsAccountSection
              currentAccountEmail={currentAccountEmail}
              displayName={displayName}
              isPending={isPending}
              meta={currentSectionMeta}
              profileFeedback={profileFeedback}
              refreshSettingsData={refreshSettingsData}
              savedDisplayName={savedDisplayName}
              setDisplayName={setDisplayName}
              setProfileFeedback={setProfileFeedback}
              setSavedDisplayName={setSavedDisplayName}
              startTransition={startTransition}
              tx={tx}
            />
          ) : null}

          {resolvedActiveSection === "preferences" ? (
            <SettingsPreferencesSection
              language={language}
              meta={currentSectionMeta}
              setLanguage={setLanguage}
              setSectionVisibility={setSectionVisibility}
              tx={tx}
              visibility={visibility}
            />
          ) : null}

          {resolvedActiveSection === "security" ? (
            <SettingsSecuritySection
              currentSessionId={currentSessionId}
              isPending={isPending}
              meta={currentSectionMeta}
              refreshSettingsData={refreshSettingsData}
              securityFeedback={securityFeedback}
              sessionFilter={sessionFilter}
              sessions={sessions}
              setSecurityFeedback={setSecurityFeedback}
              setSessionFilter={setSessionFilter}
              startTransition={startTransition}
              tx={tx}
            />
          ) : null}

          {resolvedActiveSection === "permissions" ? (
            <PermissionsCenterSection
              currentMembershipRole={currentMembershipRole}
              currentUserDisplayName={currentUserDisplayName}
              meta={currentSectionMeta}
              permissions={permissions}
              tx={tx}
            />
          ) : null}

          {resolvedActiveSection === "integrations" ? (
            <SettingsIntegrationsSection
              availableAgents={feishuAvailableAgents}
              availableChannels={feishuAvailableChannels}
              availableUsers={feishuAvailableUsers}
              currentMembershipRole={currentMembershipRole}
              currentUserId={currentUserId}
              feishuIntegrationCreationGuide={feishuIntegrationCreationGuide}
              feishuIntegrations={feishuIntegrations}
              isPending={isPending}
              meta={currentSectionMeta}
              refreshSettingsData={refreshSettingsData}
              slackAvailableChannels={slackAvailableChannels}
              slackAvailableUsers={slackAvailableUsers}
              slackIntegrationCreationGuide={slackIntegrationCreationGuide}
              slackIntegrations={slackIntegrations}
              startTransition={startTransition}
              tx={tx}
            />
          ) : null}

          {resolvedActiveSection === "workspace" ? (
            <SettingsWorkspaceSection
              canManageWorkspaceProfile={canManageWorkspaceProfile}
              currentWorkspaceName={currentWorkspaceName}
              currentWorkspaceSlug={currentWorkspaceSlug}
              currentWorkspaceJoinCode={currentWorkspaceJoinCode}
              currentWorkspaceJoinCodeUpdatedAt={currentWorkspaceJoinCodeUpdatedAt}
              isPending={isPending}
              meta={currentSectionMeta}
              setWorkspaceFeedback={setWorkspaceFeedback}
              setWorkspaceName={setWorkspaceName}
              startTransition={startTransition}
              tx={tx}
              workspaceFeedback={workspaceFeedback}
              workspaceName={workspaceName}
              refreshSettingsData={refreshSettingsData}
            />
          ) : null}

          {resolvedActiveSection === "members" ? (
            <SettingsMembersSection
              assignableRoles={assignableRoles}
              canManageMembers={canManageMembers}
              currentMembershipRole={currentMembershipRole}
              currentUserId={currentUserId}
              isPending={isPending}
              memberEmail={memberEmail}
              memberFeedback={memberFeedback}
              memberRole={memberRole}
              members={members}
              meta={currentSectionMeta}
              ownerCount={ownerCount}
              setMemberEmail={setMemberEmail}
              setMemberFeedback={setMemberFeedback}
              setMemberRole={setMemberRole}
              startTransition={startTransition}
              tx={tx}
              refreshSettingsData={refreshSettingsData}
            />
          ) : null}

          {resolvedActiveSection === "access" ? (
            <SettingsAccessSection
              activeInvitations={activeInvitations}
              assignableRoles={assignableRoles}
              canManageMembers={canManageMembers}
              channelAccessRequests={channelAccessRequests}
              channelInvitations={channelInvitations}
              createdInvitePath={createdInvitePath}
              invitationHistory={invitationHistory}
              inviteEmail={inviteEmail}
              inviteFeedback={inviteFeedback}
              inviteRole={inviteRole}
              isPending={isPending}
              meta={currentSectionMeta}
              setCreatedInvitePath={setCreatedInvitePath}
              setInviteEmail={setInviteEmail}
              setInviteFeedback={setInviteFeedback}
              setInviteRole={setInviteRole}
              startTransition={startTransition}
              tx={tx}
              refreshSettingsData={refreshSettingsData}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
