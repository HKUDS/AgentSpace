import type { WorkspaceRole } from "@agent-space/db";
import { hasWorkspaceRole } from "@/features/auth/workspace-permissions";

const SETTINGS_DETAIL_SECTION_ORDER_INTERNAL = [
  "account",
  "preferences",
  "security",
  "permissions",
  "integrations",
  "workspace",
  "members",
  "access",
] as const;

export type SettingsDetailSectionId = typeof SETTINGS_DETAIL_SECTION_ORDER_INTERNAL[number];
export type SettingsSectionId = SettingsDetailSectionId;

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "account";
export const SETTINGS_HOME_PATH = "/settings";

export const SETTINGS_SECTION_ORDER = [
  ...SETTINGS_DETAIL_SECTION_ORDER_INTERNAL,
] as const satisfies readonly SettingsSectionId[];

const SETTINGS_SECTION_MINIMUM_ROLE: Record<SettingsSectionId, WorkspaceRole | null> = {
  account: null,
  preferences: null,
  security: null,
  permissions: null,
  integrations: null,
  workspace: "owner",
  members: "admin",
  access: "admin",
};

const SETTINGS_SECTION_PATHS: Record<SettingsSectionId, string> = {
  account: "/settings/account",
  preferences: "/settings/preferences",
  security: "/settings/security",
  permissions: "/settings/permissions",
  integrations: "/settings/integrations",
  workspace: "/settings/workspace",
  members: "/settings/members",
  access: "/settings/access",
};

export const SETTINGS_REVALIDATE_PATHS = [
  SETTINGS_HOME_PATH,
  ...SETTINGS_SECTION_ORDER.map((section) => SETTINGS_SECTION_PATHS[section]),
];

export function isSettingsDetailSectionId(value: string): value is SettingsDetailSectionId {
  return SETTINGS_DETAIL_SECTION_ORDER_INTERNAL.includes(value as SettingsDetailSectionId);
}

export function canAccessSettingsSection(role: WorkspaceRole, section: SettingsSectionId): boolean {
  const minimumRole = SETTINGS_SECTION_MINIMUM_ROLE[section];
  return minimumRole === null ? true : hasWorkspaceRole(role, minimumRole);
}

export function getAccessibleSettingsSections(role: WorkspaceRole): SettingsSectionId[] {
  return SETTINGS_SECTION_ORDER.filter((section) => canAccessSettingsSection(role, section));
}

export function getSettingsSectionPath(section: SettingsSectionId): string {
  return SETTINGS_SECTION_PATHS[section];
}
