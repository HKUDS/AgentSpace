"use client";

import { type FormEvent, type TransitionStartFunction, useEffect, useMemo, useState } from "react";
import type { WorkspaceRole } from "@agent-space/db";
import type { SettingsTx } from "@/features/settings/settings-types";
import { translateSettingsActionError } from "@/features/settings/settings-utils";
import {
  createFeishuUserBindingAction,
  resumeFeishuUserBindingAction,
  revokeFeishuUserBindingAction,
} from "./feishu-actions";
import type {
  FeishuAvailableUserItem,
  FeishuIntegrationSettingsItem,
} from "./feishu-types";

export function FeishuUserBindingsPanel({
  availableUsers,
  currentMembershipRole,
  currentUserId,
  integrations,
  isPending,
  onUpdated,
  setFeedback,
  startTransition,
  tx,
}: {
  availableUsers: FeishuAvailableUserItem[];
  currentMembershipRole: WorkspaceRole;
  currentUserId?: string;
  integrations: FeishuIntegrationSettingsItem[];
  isPending: boolean;
  onUpdated: (integration: FeishuIntegrationSettingsItem) => void;
  setFeedback: (value: string | null) => void;
  startTransition: TransitionStartFunction;
  tx: SettingsTx;
}) {
  const canManageAllUsers = currentMembershipRole === "owner" || currentMembershipRole === "admin";
  const visibleUsers = useMemo(
    () => canManageAllUsers
      ? availableUsers
      : availableUsers.filter((user) => user.userId === currentUserId),
    [availableUsers, canManageAllUsers, currentUserId],
  );
  const selectableIntegrations = integrations.filter((integration) => integration.status !== "disabled");
  const [integrationId, setIntegrationId] = useState(selectableIntegrations[0]?.id ?? "");
  const [userId, setUserId] = useState(
    canManageAllUsers ? visibleUsers[0]?.userId ?? "" : currentUserId ?? visibleUsers[0]?.userId ?? "",
  );
  const [externalUserId, setExternalUserId] = useState("");
  const [externalUnionId, setExternalUnionId] = useState("");
  const [externalOpenId, setExternalOpenId] = useState("");
  const [externalEmail, setExternalEmail] = useState("");
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    if (!integrationId || !selectableIntegrations.some((integration) => integration.id === integrationId)) {
      setIntegrationId(selectableIntegrations[0]?.id ?? "");
    }
  }, [integrationId, selectableIntegrations]);

  useEffect(() => {
    if (!userId || !visibleUsers.some((user) => user.userId === userId)) {
      setUserId(canManageAllUsers ? visibleUsers[0]?.userId ?? "" : currentUserId ?? visibleUsers[0]?.userId ?? "");
    }
  }, [canManageAllUsers, currentUserId, userId, visibleUsers]);

  const bindings = integrations.flatMap((integration) =>
    integration.userBindings
      .filter((binding) => canManageAllUsers || binding.userId === currentUserId)
      .map((binding) => ({
        ...binding,
        integrationName: integration.displayName,
        userName: availableUsers.find((user) => user.userId === binding.userId)?.displayName ?? binding.userId,
      })),
  );
  const activeBoundUserIds = new Set(
    bindings
      .filter((binding) => binding.status === "active")
      .map((binding) => binding.userId),
  );
  const unboundUsers = visibleUsers.filter((user) => !activeBoundUserIds.has(user.userId));
  const canSubmit = Boolean(integrationId && userId && externalUserId.trim());

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    startTransition(async () => {
      try {
        const updated = await createFeishuUserBindingAction({
          integrationId,
          userId,
          externalUserId,
          externalUnionId,
          externalOpenId,
          externalEmail,
          displayName,
        });
        setExternalUserId("");
        setExternalUnionId("");
        setExternalOpenId("");
        setExternalEmail("");
        setDisplayName("");
        setFeedback(tx("飞书用户绑定已保存。", "Feishu user binding saved."));
        onUpdated(updated);
      } catch (error) {
        setFeedback(translateSettingsActionError(error, tx));
      }
    });
  }

  function updateBindingStatus(
    action: (input: { bindingId: string }) => Promise<FeishuIntegrationSettingsItem>,
    bindingId: string,
    successMessage: string,
  ): void {
    startTransition(async () => {
      try {
        const updated = await action({ bindingId });
        setFeedback(successMessage);
        onUpdated(updated);
      } catch (error) {
        setFeedback(translateSettingsActionError(error, tx));
      }
    });
  }

  return (
    <section className="page-panel" id="feishu-user-bindings">
      <div className="panel-header">
        <div>
          <h3>{tx("飞书用户绑定", "Feishu User Bindings")}</h3>
          <p className="settings-panel-note">
            {canManageAllUsers
              ? tx("把飞书 Open ID 映射到 AgentSpace 成员，外部消息才可以触发 Agent。", "Map Feishu Open IDs to AgentSpace members before external messages can trigger agents.")
              : tx("绑定你自己的飞书 Open ID，之后你在飞书群里触发 Agent 时会按 AgentSpace 权限治理。", "Bind your own Feishu Open ID so messages you send in Feishu are governed by AgentSpace permissions.")}
          </p>
        </div>
      </div>

      {canManageAllUsers ? (
        <div
          aria-label={tx("飞书用户绑定覆盖率", "Feishu user binding coverage")}
          className="feishu-binding-coverage"
        >
          <div>
            <strong>{tx("绑定覆盖率", "Binding Coverage")}</strong>
            <span>{activeBoundUserIds.size} / {visibleUsers.length}</span>
          </div>
          <p>
            {unboundUsers.length > 0
              ? tx("未绑定：", "Unbound: ") + unboundUsers.map((user) => user.displayName).join(", ")
              : tx("全部成员已绑定。", "All members are bound.")}
          </p>
        </div>
      ) : null}

      <form className="feishu-binding-form" onSubmit={handleSubmit}>
        <label className="form-field">
          <span>{tx("集成", "Integration")}</span>
          <select
            disabled={isPending || selectableIntegrations.length === 0}
            onChange={(event) => setIntegrationId(event.currentTarget.value)}
            value={integrationId}
          >
            {selectableIntegrations.map((integration) => (
              <option key={integration.id} value={integration.id}>{integration.displayName}</option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>{tx("AgentSpace 用户", "AgentSpace User")}</span>
          {canManageAllUsers ? (
            <select
              disabled={isPending || visibleUsers.length === 0}
              onChange={(event) => setUserId(event.currentTarget.value)}
              value={userId}
            >
              {visibleUsers.map((user) => (
                <option key={user.userId} value={user.userId}>
                  {user.primaryEmail ? `${user.displayName} (${user.primaryEmail})` : user.displayName}
                </option>
              ))}
            </select>
          ) : (
            <input
              disabled
              readOnly
              value={formatUserLabel(visibleUsers[0], currentUserId, tx)}
            />
          )}
        </label>

        <label className="form-field">
          <span>{tx("飞书 Open ID", "Feishu Open ID")}</span>
          <input
            autoComplete="off"
            disabled={isPending}
            onChange={(event) => setExternalUserId(event.currentTarget.value)}
            placeholder="ou_xxx"
            value={externalUserId}
          />
        </label>

        <label className="form-field">
          <span>{tx("飞书 Union ID", "Feishu Union ID")}</span>
          <input
            autoComplete="off"
            disabled={isPending}
            onChange={(event) => setExternalUnionId(event.currentTarget.value)}
            placeholder="on_xxx"
            value={externalUnionId}
          />
        </label>

        <label className="form-field">
          <span>{tx("飞书 User ID", "Feishu User ID")}</span>
          <input
            autoComplete="off"
            disabled={isPending}
            onChange={(event) => setExternalOpenId(event.currentTarget.value)}
            value={externalOpenId}
          />
        </label>

        <label className="form-field">
          <span>{tx("飞书邮箱", "Feishu Email")}</span>
          <input
            autoComplete="off"
            disabled={isPending}
            onChange={(event) => setExternalEmail(event.currentTarget.value)}
            value={externalEmail}
          />
        </label>

        <label className="form-field">
          <span>{tx("飞书显示名称", "Feishu Display Name")}</span>
          <input
            autoComplete="off"
            disabled={isPending}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
            value={displayName}
          />
        </label>

        <button
          className="primary-button"
          disabled={isPending || !canSubmit}
          type="submit"
        >
          {tx("保存用户绑定", "Save User Binding")}
        </button>
      </form>

      <div className="feishu-binding-list">
        {bindings.length > 0 ? bindings.map((binding) => (
          <article className="feishu-binding-card" key={binding.id}>
            <div>
              <strong>{binding.userName}</strong>
              <p>{binding.integrationName}</p>
            </div>
            <div className="feishu-binding-card__meta">
              <span>{tx("Open ID", "Open ID")}: {binding.externalUserReference}</span>
              <span>{tx("状态", "Status")}: {binding.status}</span>
              {binding.externalUnionReference ? <span>{tx("Union ID", "Union ID")}: {binding.externalUnionReference}</span> : null}
              {binding.externalEmailReference ? <span>{tx("邮箱", "Email")}: {binding.externalEmailReference}</span> : null}
            </div>
            <div className="feishu-binding-card__actions">
              {binding.status === "disabled" ? (
                <button
                  className="action-button"
                  disabled={isPending}
                  onClick={() => updateBindingStatus(
                    resumeFeishuUserBindingAction,
                    binding.id,
                    tx("飞书用户绑定已启用。", "Feishu user binding resumed."),
                  )}
                  type="button"
                >
                  {tx("启用", "Enable")}
                </button>
              ) : null}
              {binding.status !== "archived" ? (
                <button
                  className="action-button action-button--danger"
                  disabled={isPending}
                  onClick={() => updateBindingStatus(
                    revokeFeishuUserBindingAction,
                    binding.id,
                    tx("飞书用户绑定已撤销。", "Feishu user binding revoked."),
                  )}
                  type="button"
                >
                  {tx("撤销", "Revoke")}
                </button>
              ) : null}
            </div>
          </article>
        )) : (
          <p className="settings-empty">{tx("暂无飞书用户绑定。", "No Feishu user bindings yet.")}</p>
        )}
      </div>
    </section>
  );
}

function formatUserLabel(
  user: FeishuAvailableUserItem | undefined,
  fallbackUserId: string | undefined,
  tx: SettingsTx,
): string {
  if (!user) {
    return fallbackUserId ?? tx("当前用户", "Current user");
  }
  return user.primaryEmail ? `${user.displayName} (${user.primaryEmail})` : user.displayName;
}
