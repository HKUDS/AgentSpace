"use client";

import { type Dispatch, type SetStateAction, type TransitionStartFunction, useId } from "react";
import type { WorkspaceRole } from "@agent-space/db";
import {
  addWorkspaceMemberAction,
  removeWorkspaceMemberAction,
  transferWorkspaceOwnershipAction,
  updateWorkspaceMemberRoleAction,
} from "@/features/settings/actions";
import { SettingsSectionShell } from "@/features/settings/components/settings-chrome";
import type { SettingsSectionMeta } from "@/features/settings/settings-meta";
import type {
  SettingsTx,
  SettingsWorkspaceMemberItem,
} from "@/features/settings/settings-types";
import {
  translateSettingsActionError,
  translateWorkspaceRole,
} from "@/features/settings/settings-utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { GeneratedAvatar } from "@/shared/ui/generated-avatar";

export function SettingsMembersSection({
  assignableRoles,
  canManageMembers,
  currentMembershipRole,
  currentUserId,
  isPending,
  memberEmail,
  memberFeedback,
  memberRole,
  members,
  meta,
  ownerCount,
  refreshSettingsData,
  setMemberEmail,
  setMemberFeedback,
  setMemberRole,
  startTransition,
  tx,
}: {
  assignableRoles: readonly WorkspaceRole[];
  canManageMembers: boolean;
  currentMembershipRole: WorkspaceRole;
  currentUserId?: string;
  isPending: boolean;
  memberEmail: string;
  memberFeedback: string | null;
  memberRole: WorkspaceRole;
  members: SettingsWorkspaceMemberItem[];
  meta: SettingsSectionMeta;
  ownerCount: number;
  refreshSettingsData: () => void;
  setMemberEmail: Dispatch<SetStateAction<string>>;
  setMemberFeedback: Dispatch<SetStateAction<string | null>>;
  setMemberRole: Dispatch<SetStateAction<WorkspaceRole>>;
  startTransition: TransitionStartFunction;
  tx: SettingsTx;
}) {
  return (
    <SettingsSectionShell meta={meta}>
      <section className="page-panel">
        <div className="panel-header">
          <div>
            <h3>{tx("成员准入", "Member onboarding")}</h3>
            <p className="settings-panel-note">
              {tx("直接把已注册账号加入工作区，并提前设定角色。", "Grant workspace access to an existing account and set the starting role up front.")}
            </p>
          </div>
        </div>

        {canManageMembers ? (
          <MemberOnboardingForm
            assignableRoles={assignableRoles}
            isPending={isPending}
            memberEmail={memberEmail}
            memberRole={memberRole}
            setMemberEmail={setMemberEmail}
            setMemberFeedback={setMemberFeedback}
            setMemberRole={setMemberRole}
            refreshSettingsData={refreshSettingsData}
            startTransition={startTransition}
            tx={tx}
          />
        ) : (
          <EmptyState title={tx("仅管理员和所有者可管理成员。", "Only admins and owners can manage members.")} />
        )}

        {memberFeedback ? <p aria-live="polite" className="settings-feedback" role="status">{memberFeedback}</p> : null}
      </section>

      <section className="page-panel">
        <div className="panel-header">
          <div>
            <h3>{tx("成员与角色", "Members & Roles")}</h3>
            <p className="settings-panel-note">
              {tx("把日常角色调整和高风险治理动作拆开，减少误操作。", "Separate routine role changes from high-risk governance actions to reduce mistakes.")}
            </p>
          </div>
        </div>

        <div className="settings-member-list">
          {members.length > 0 ? (
            members.map((member) => (
              <MemberCard
                assignableRoles={assignableRoles}
                canManageMembers={canManageMembers}
                currentMembershipRole={currentMembershipRole}
                currentUserId={currentUserId}
                isPending={isPending}
                key={member.userId}
                member={member}
                ownerCount={ownerCount}
                refreshSettingsData={refreshSettingsData}
                setMemberFeedback={setMemberFeedback}
                startTransition={startTransition}
                tx={tx}
              />
            ))
          ) : (
            <EmptyState title={tx("暂无成员。", "No members found.")} />
          )}
        </div>
      </section>
    </SettingsSectionShell>
  );
}

function MemberOnboardingForm({
  assignableRoles,
  isPending,
  memberEmail,
  memberRole,
  setMemberEmail,
  setMemberFeedback,
  setMemberRole,
  refreshSettingsData,
  startTransition,
  tx,
}: {
  assignableRoles: readonly WorkspaceRole[];
  isPending: boolean;
  memberEmail: string;
  memberRole: WorkspaceRole;
  setMemberEmail: Dispatch<SetStateAction<string>>;
  setMemberFeedback: Dispatch<SetStateAction<string | null>>;
  setMemberRole: Dispatch<SetStateAction<WorkspaceRole>>;
  refreshSettingsData: () => void;
  startTransition: TransitionStartFunction;
  tx: SettingsTx;
}) {
  return (
    <div className="settings-member-create">
      <label className="form-field">
        <span>{tx("用户邮箱", "User Email")}</span>
        <input
          onChange={(event) => setMemberEmail(event.currentTarget.value)}
          placeholder={tx("已注册邮箱", "Registered email")}
          type="email"
          value={memberEmail}
        />
      </label>

      <label className="form-field">
        <span>{tx("角色", "Role")}</span>
        <select
          onChange={(event) => setMemberRole(event.currentTarget.value as WorkspaceRole)}
          value={memberRole}
        >
          {assignableRoles.map((role) => (
            <option key={role} value={role}>
              {translateWorkspaceRole(role, tx)}
            </option>
          ))}
        </select>
      </label>

      <button
        className="primary-button"
        disabled={isPending || memberEmail.trim().length === 0}
        onClick={() => {
          startTransition(async () => {
            try {
              await addWorkspaceMemberAction({
                email: memberEmail,
                role: memberRole,
              });
              setMemberEmail("");
              setMemberRole("member");
              setMemberFeedback(tx("成员已加入工作区。", "Member added to workspace."));
              refreshSettingsData();
            } catch (error) {
              setMemberFeedback(translateSettingsActionError(error, tx));
            }
          });
        }}
        type="button"
      >
        {tx("添加成员", "Add Member")}
      </button>
    </div>
  );
}

function MemberCard({
  assignableRoles,
  canManageMembers,
  currentMembershipRole,
  currentUserId,
  isPending,
  member,
  ownerCount,
  refreshSettingsData,
  setMemberFeedback,
  startTransition,
  tx,
}: {
  assignableRoles: readonly WorkspaceRole[];
  canManageMembers: boolean;
  currentMembershipRole: WorkspaceRole;
  currentUserId?: string;
  isPending: boolean;
  member: SettingsWorkspaceMemberItem;
  ownerCount: number;
  refreshSettingsData: () => void;
  setMemberFeedback: Dispatch<SetStateAction<string | null>>;
  startTransition: TransitionStartFunction;
  tx: SettingsTx;
}) {
  const isSelf = member.userId === currentUserId;
  const isOwner = member.role === "owner";
  const canManageTarget = canManageMembers && !isSelf && (currentMembershipRole === "owner" || !isOwner);
  const canChangeRole = canManageTarget && !(isOwner && ownerCount <= 1);
  const canRemove = canManageTarget && !(isOwner && ownerCount <= 1);
  const canTransferOwnership = currentMembershipRole === "owner" && !isSelf && !isOwner;
  const roleSelectId = useId();

  return (
    <article className="settings-member-card">
      <div className="settings-member-card__header">
        <div className="settings-member-card__identity">
          <GeneratedAvatar
            className="settings-member-card__avatar"
            id={member.userId}
            name={member.displayName}
            variant="human"
          />
          <div>
            <strong>{member.displayName}</strong>
            <p>{member.primaryEmail ?? tx("无邮箱", "No email")}</p>
          </div>
        </div>
        <span className={`status-chip${member.role === "owner" ? " status-chip--active" : ""}`}>
          {translateWorkspaceRole(member.role, tx)}
          {isSelf ? tx(" · 你", " · You") : ""}
        </span>
      </div>

      {canManageMembers ? (
        <div className="settings-member-card__actions">
          <div className="settings-member-card__role-field">
            <div className="settings-member-card__role-label-row">
              <label htmlFor={roleSelectId}>{tx("角色", "Role")}</label>
              {(canTransferOwnership || canRemove) ? (
                <div className="settings-member-card__role-actions">
                  {canTransferOwnership ? (
                    <button
                      className="action-button"
                      disabled={isPending}
                      onClick={() => {
                        startTransition(async () => {
                          try {
                            await transferWorkspaceOwnershipAction(member.userId);
                            setMemberFeedback(tx("所有权已转移。", "Ownership transferred."));
                            refreshSettingsData();
                          } catch (error) {
                            setMemberFeedback(translateSettingsActionError(error, tx));
                          }
                        });
                      }}
                      type="button"
                    >
                      {tx("转移所有权", "Transfer Ownership")}
                    </button>
                  ) : null}

                  <button
                    className="action-button action-button--danger"
                    disabled={isPending || !canRemove}
                    onClick={() => {
                      startTransition(async () => {
                        try {
                          await removeWorkspaceMemberAction(member.userId);
                          setMemberFeedback(tx("成员已移出工作区。", "Member removed from workspace."));
                          refreshSettingsData();
                        } catch (error) {
                          setMemberFeedback(translateSettingsActionError(error, tx));
                        }
                      });
                    }}
                    type="button"
                  >
                    {tx("移除成员", "Remove Member")}
                  </button>
                </div>
              ) : null}
            </div>
            <select
              defaultValue={member.role}
              disabled={isPending || !canChangeRole}
              id={roleSelectId}
              onChange={(event) => {
                const roleSelect = event.currentTarget;
                const nextRole = roleSelect.value as WorkspaceRole;
                startTransition(async () => {
                  try {
                    await updateWorkspaceMemberRoleAction({
                      userId: member.userId,
                      role: nextRole,
                    });
                    setMemberFeedback(tx("成员角色已更新。", "Member role updated."));
                    refreshSettingsData();
                  } catch (error) {
                    roleSelect.value = member.role;
                    setMemberFeedback(translateSettingsActionError(error, tx));
                  }
                });
              }}
            >
              {assignableRoles.map((role) => (
                <option key={role} value={role}>
                  {translateWorkspaceRole(role, tx)}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}
    </article>
  );
}
