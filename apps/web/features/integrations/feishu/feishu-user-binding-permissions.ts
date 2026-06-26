import type { WorkspaceRole } from "@agent-space/db";
import { hasWorkspaceRole } from "@/features/auth/workspace-permissions";

export const FEISHU_USER_BINDING_FORBIDDEN_ERROR = "feishu.user_binding.forbidden";

export function canManageFeishuUserBindingTarget(input: {
  actorRole: WorkspaceRole;
  actorUserId: string;
  targetUserId: string;
}): boolean {
  if (hasWorkspaceRole(input.actorRole, "admin")) {
    return true;
  }

  return input.actorUserId.trim() !== "" && input.actorUserId.trim() === input.targetUserId.trim();
}

export function assertCanManageFeishuUserBindingTarget(input: {
  actorRole: WorkspaceRole;
  actorUserId: string;
  targetUserId: string;
}): void {
  if (!canManageFeishuUserBindingTarget(input)) {
    throw new Error(FEISHU_USER_BINDING_FORBIDDEN_ERROR);
  }
}
