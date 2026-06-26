import { describe, expect, it } from "vitest";
import {
  FEISHU_USER_BINDING_FORBIDDEN_ERROR,
  assertCanManageFeishuUserBindingTarget,
  canManageFeishuUserBindingTarget,
} from "./feishu-user-binding-permissions";

describe("Feishu user binding permissions", () => {
  it("allows owners and admins to manage any Feishu user binding", () => {
    expect(canManageFeishuUserBindingTarget({
      actorRole: "owner",
      actorUserId: "owner-1",
      targetUserId: "member-1",
    })).toBe(true);
    expect(canManageFeishuUserBindingTarget({
      actorRole: "admin",
      actorUserId: "admin-1",
      targetUserId: "member-1",
    })).toBe(true);
  });

  it("allows members to manage their own Feishu user binding", () => {
    expect(canManageFeishuUserBindingTarget({
      actorRole: "member",
      actorUserId: "member-1",
      targetUserId: "member-1",
    })).toBe(true);
  });

  it("rejects members managing another user's Feishu binding", () => {
    expect(canManageFeishuUserBindingTarget({
      actorRole: "member",
      actorUserId: "member-1",
      targetUserId: "member-2",
    })).toBe(false);
    expect(() => assertCanManageFeishuUserBindingTarget({
      actorRole: "member",
      actorUserId: "member-1",
      targetUserId: "member-2",
    })).toThrow(FEISHU_USER_BINDING_FORBIDDEN_ERROR);
  });
});
