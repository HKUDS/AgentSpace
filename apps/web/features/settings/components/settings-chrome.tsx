import Link from "next/link";
import type { MouseEvent } from "react";
import type { WorkspaceRole } from "@agent-space/db";
import { buildWorkspacePath } from "@/features/auth/workspace-paths";
import { getSettingsSectionMeta, type SettingsSectionMeta } from "@/features/settings/settings-meta";
import {
  getAccessibleSettingsSections,
  getSettingsSectionPath,
  type SettingsDetailSectionId,
  type SettingsSectionId,
} from "@/features/settings/settings-sections";
import type { SettingsTx } from "@/features/settings/settings-types";
import { AppIcon, type AppIconName } from "@/shared/ui/app-icon";

export function SettingsSidebar({
  currentMembershipRole,
  currentWorkspaceSlug,
  onNavigate,
  resolvedActiveSection,
  tx,
}: {
  currentMembershipRole: WorkspaceRole;
  currentWorkspaceSlug: string;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>) => void;
  resolvedActiveSection: SettingsSectionId;
  tx: SettingsTx;
}) {
  const visibleSections = getAccessibleSettingsSections(currentMembershipRole);
  const personalSections = visibleSections.filter(isPersonalSettingsSection);
  const workspaceSections = visibleSections.filter((section) => !isPersonalSettingsSection(section));

  function workspaceHref(path: string): string {
    return currentWorkspaceSlug ? buildWorkspacePath(currentWorkspaceSlug, path) : path;
  }

  return (
    <aside className="settings-sidebar">
      <div className="settings-sidebar__panel">
        <nav aria-label={tx("设置导航", "Settings navigation")} className="settings-nav">
          {personalSections.map((section) => (
            <SettingsNavLink
              href={workspaceHref(getSettingsSectionPath(section))}
              isActive={section === resolvedActiveSection}
              key={section}
              meta={getSettingsSectionMeta(section, tx)}
              onNavigate={onNavigate}
              section={section}
            />
          ))}

          {personalSections.length > 0 && workspaceSections.length > 0 ? (
            <div aria-hidden="true" className="settings-nav__divider" />
          ) : null}

          {workspaceSections.map((section) => (
            <SettingsNavLink
              href={workspaceHref(getSettingsSectionPath(section))}
              isActive={section === resolvedActiveSection}
              key={section}
              meta={getSettingsSectionMeta(section, tx)}
              onNavigate={onNavigate}
              section={section}
            />
          ))}
        </nav>
      </div>
    </aside>
  );
}

function SettingsNavLink({
  href,
  isActive,
  meta,
  onNavigate,
  section,
}: {
  href: string;
  isActive: boolean;
  meta: SettingsSectionMeta;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>) => void;
  section: SettingsSectionId;
}) {
  return (
    <Link
      className={`settings-nav__link settings-nav__link--${meta.tone}${isActive ? " settings-nav__link--active" : ""}`}
      href={href}
      onClick={onNavigate}
      prefetch={false}
    >
      <span className="settings-nav__icon">
        <AppIcon name={getSettingsNavIcon(section)} />
      </span>
      <span className="settings-nav__title">{meta.navLabel}</span>
    </Link>
  );
}

function getSettingsNavIcon(section: SettingsSectionId): AppIconName {
  switch (section) {
    case "account":
      return "contacts";
    case "preferences":
      return "settings";
    case "security":
      return "alertCircle";
    case "permissions":
      return "approvals";
    case "integrations":
      return "market";
    case "workspace":
      return "containers";
    case "members":
      return "groups";
    case "access":
      return "open";
  }
}

function isPersonalSettingsSection(section: SettingsSectionId): section is SettingsDetailSectionId {
  return section === "account" || section === "preferences" || section === "security";
}

export function SettingsSectionShell({
  children,
  meta,
}: {
  children: React.ReactNode;
  meta: SettingsSectionMeta;
}) {
  return (
    <section className={`settings-group settings-group--${meta.tone}`}>
      <h2 className="settings-page__title">{meta.pageTitle}</h2>
      <div className="settings-group__header">
        <div className="settings-group__label-row">
          <p className="settings-group__eyebrow">{meta.groupLabel}</p>
          <span className="settings-group__scope-chip">{meta.scopeLabel}</span>
        </div>
        <h3 className="settings-group__title">{meta.title}</h3>
        <p className="settings-group__description">{meta.description}</p>
      </div>

      <div className="settings-group__grid">{children}</div>
    </section>
  );
}
