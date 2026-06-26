import { describe, expect, it } from "vitest";
import {
  SETTINGS_REVALIDATE_PATHS,
  canAccessSettingsSection,
  getAccessibleSettingsSections,
  getSettingsSectionPath,
  isSettingsDetailSectionId,
} from "./settings-sections";

describe("settings section helpers", () => {
  it("recognizes valid detail sections", () => {
    expect(isSettingsDetailSectionId("security")).toBe(true);
    expect(isSettingsDetailSectionId("overview")).toBe(false);
    expect(isSettingsDetailSectionId("unknown")).toBe(false);
  });

  it("returns role-aware accessible sections", () => {
    expect(getAccessibleSettingsSections("member")).toEqual([
      "account",
      "preferences",
      "security",
      "permissions",
      "integrations",
    ]);
    expect(getAccessibleSettingsSections("admin")).toEqual([
      "account",
      "preferences",
      "security",
      "permissions",
      "integrations",
      "members",
      "access",
    ]);
    expect(getAccessibleSettingsSections("owner")).toEqual([
      "account",
      "preferences",
      "security",
      "permissions",
      "integrations",
      "workspace",
      "members",
      "access",
    ]);
  });

  it("enforces the section permission model", () => {
    expect(canAccessSettingsSection("member", "workspace")).toBe(false);
    expect(canAccessSettingsSection("admin", "workspace")).toBe(false);
    expect(canAccessSettingsSection("owner", "workspace")).toBe(true);
    expect(canAccessSettingsSection("admin", "members")).toBe(true);
    expect(canAccessSettingsSection("member", "integrations")).toBe(true);
    expect(canAccessSettingsSection("admin", "integrations")).toBe(true);
    expect(canAccessSettingsSection("member", "permissions")).toBe(true);
  });

  it("keeps paths and revalidate targets aligned", () => {
    expect(getSettingsSectionPath("account")).toBe("/settings/account");
    expect(getSettingsSectionPath("permissions")).toBe("/settings/permissions");
    expect(getSettingsSectionPath("integrations")).toBe("/settings/integrations");
    expect(getSettingsSectionPath("access")).toBe("/settings/access");
    expect(SETTINGS_REVALIDATE_PATHS).toEqual([
      "/settings",
      "/settings/account",
      "/settings/preferences",
      "/settings/security",
      "/settings/permissions",
      "/settings/integrations",
      "/settings/workspace",
      "/settings/members",
      "/settings/access",
    ]);
  });
});
