import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PermissionCenterData } from "@agent-space/services";
import { PermissionsCenterSection } from "./permissions-center-section";
import { getSettingsSectionMeta } from "@/features/settings/settings-meta";

const { saveSkills } = vi.hoisted(() => ({ saveSkills: vi.fn(async () => {}) }));
vi.mock("@/features/permissions/actions", () => ({ permissionsSetAgentSkillAssignmentsAction: saveSkills }));

describe("PermissionsCenterSection", () => {
  it("loads the selected agent's own assignments when switching resources", async () => {
    const tx = (_zh: string, en: string) => en;
    const permissions: PermissionCenterData = {
      tree: [
        { id: "agent:Atlas", resourceType: "agent", label: "Atlas", bindings: [], metadata: { employeeName: "Atlas", assignedSkillIds: ["research"] } },
        { id: "agent:Vega", resourceType: "agent", label: "Vega", bindings: [], metadata: { employeeName: "Vega", assignedSkillIds: ["design"] } },
      ],
      actors: [], diagnostics: [],
      catalog: { members: [], agents: [], knowledgePages: [], skills: [{ id: "research", name: "Research" }, { id: "design", name: "Design" }] },
    };
    render(<PermissionsCenterSection currentMembershipRole="owner" currentUserDisplayName="Mina" permissions={permissions} meta={getSettingsSectionMeta("permissions", tx)} tx={tx} />);
    expect(screen.getByRole("checkbox", { name: "Research" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /Vega/ }));
    expect(screen.getByRole("checkbox", { name: "Research" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Design" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save skills" }));
    await waitFor(() => expect(saveSkills).toHaveBeenCalledWith({ employeeName: "Vega", skillIds: ["design"] }));
  });
});
