"use client";

import { type FormEvent, type TransitionStartFunction, useEffect, useState } from "react";
import type { SettingsTx } from "@/features/settings/settings-types";
import { translateSettingsActionError } from "@/features/settings/settings-utils";
import {
  createFeishuChannelBindingAction,
  pauseFeishuChannelBindingAction,
  resumeFeishuChannelBindingAction,
  revokeFeishuChannelBindingAction,
} from "./feishu-actions";
import type {
  FeishuAvailableChannelItem,
  FeishuIntegrationSettingsItem,
} from "./feishu-types";

export function FeishuChannelBindingsPanel({
  availableChannels,
  integrations,
  isPending,
  onUpdated,
  setFeedback,
  startTransition,
  tx,
}: {
  availableChannels: FeishuAvailableChannelItem[];
  integrations: FeishuIntegrationSettingsItem[];
  isPending: boolean;
  onUpdated: (integration: FeishuIntegrationSettingsItem) => void;
  setFeedback: (value: string | null) => void;
  startTransition: TransitionStartFunction;
  tx: SettingsTx;
}) {
  const selectableIntegrations = integrations.filter((integration) => integration.status !== "disabled");
  const [integrationId, setIntegrationId] = useState(selectableIntegrations[0]?.id ?? "");
  const [channelName, setChannelName] = useState(availableChannels[0]?.name ?? "");
  const [externalChatId, setExternalChatId] = useState("");
  const [externalChatType, setExternalChatType] = useState("group");
  const [externalChatName, setExternalChatName] = useState("");

  useEffect(() => {
    if (!integrationId || !selectableIntegrations.some((integration) => integration.id === integrationId)) {
      setIntegrationId(selectableIntegrations[0]?.id ?? "");
    }
  }, [integrationId, selectableIntegrations]);

  useEffect(() => {
    if (!channelName || !availableChannels.some((channel) => channel.name === channelName)) {
      setChannelName(availableChannels[0]?.name ?? "");
    }
  }, [availableChannels, channelName]);

  const bindings = integrations.flatMap((integration) =>
    integration.channelBindings.map((binding) => ({
      ...binding,
      integrationName: integration.displayName,
    })),
  );
  const canSubmit = Boolean(integrationId && channelName && externalChatId.trim());

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    startTransition(async () => {
      try {
        const updated = await createFeishuChannelBindingAction({
          integrationId,
          channelName,
          externalChatId,
          externalChatType,
          externalChatName,
        });
        setExternalChatId("");
        setExternalChatName("");
        setFeedback(tx("飞书会话映射已保存。", "Feishu chat mapping saved."));
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
    <section className="page-panel" id="feishu-channel-bindings">
      <div className="panel-header">
        <div>
          <h3>{tx("飞书会话映射", "Feishu Chat Mappings")}</h3>
          <p className="settings-panel-note">
            {tx("把 AgentSpace 频道或私聊连接到飞书会话。", "Connect AgentSpace channels or direct chats to Feishu chats.")}
          </p>
        </div>
      </div>

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
          <span>{tx("AgentSpace 频道", "AgentSpace Channel")}</span>
          <select
            disabled={isPending || availableChannels.length === 0}
            onChange={(event) => setChannelName(event.currentTarget.value)}
            value={channelName}
          >
            {availableChannels.map((channel) => (
              <option key={channel.name} value={channel.name}>
                {channel.kind ? `${channel.name} (${channel.kind})` : channel.name}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>{tx("飞书会话 ID", "Feishu Chat ID")}</span>
          <input
            autoComplete="off"
            disabled={isPending}
            onChange={(event) => setExternalChatId(event.currentTarget.value)}
            placeholder="oc_xxx"
            value={externalChatId}
          />
        </label>

        <label className="form-field">
          <span>{tx("会话类型", "Chat Type")}</span>
          <select
            disabled={isPending}
            onChange={(event) => setExternalChatType(event.currentTarget.value)}
            value={externalChatType}
          >
            <option value="group">{tx("群聊", "Group")}</option>
            <option value="p2p">{tx("单聊", "Direct")}</option>
          </select>
        </label>

        <label className="form-field">
          <span>{tx("飞书会话名称", "Feishu Chat Name")}</span>
          <input
            autoComplete="off"
            disabled={isPending}
            onChange={(event) => setExternalChatName(event.currentTarget.value)}
            value={externalChatName}
          />
        </label>

        <button
          className="primary-button"
          disabled={isPending || !canSubmit}
          type="submit"
        >
          {tx("保存会话映射", "Save Mapping")}
        </button>
      </form>

      <div className="feishu-binding-list">
        {bindings.length > 0 ? bindings.map((binding) => (
          <article className="feishu-binding-card" key={binding.id}>
            <div>
              <strong>{binding.channelName}</strong>
              <p>{binding.integrationName}</p>
            </div>
            <div className="feishu-binding-card__meta">
              <span>{tx("飞书会话", "Feishu Chat")}: {binding.externalChatName || binding.externalChatReference}</span>
              <span>{tx("会话引用", "Chat Reference")}: {binding.externalChatReference}</span>
              {binding.provisionSource ? (
                <span>{tx("来源", "Source")}: {translateProvisionSource(binding.provisionSource, tx)}</span>
              ) : null}
              {binding.reviewStatus ? (
                <span>{tx("审核", "Review")}: {translateReviewStatus(binding.reviewStatus, tx)}</span>
              ) : null}
              {binding.agentId ? <span>{tx("Agent", "Agent")}: {binding.agentId}</span> : null}
              <span>{tx("状态", "Status")}: {binding.status}</span>
              <span>{tx("同步", "Sync")}: {binding.syncMode}</span>
            </div>
            <div className="feishu-binding-card__actions">
              {binding.status === "active" ? (
                <button
                  className="action-button"
                  disabled={isPending}
                  onClick={() => updateBindingStatus(
                    pauseFeishuChannelBindingAction,
                    binding.id,
                    tx("飞书会话映射已暂停。", "Feishu chat mapping paused."),
                  )}
                  type="button"
                >
                  {tx("暂停", "Pause")}
                </button>
              ) : binding.status === "disabled" ? (
                <button
                  className="action-button"
                  disabled={isPending}
                  onClick={() => updateBindingStatus(
                    resumeFeishuChannelBindingAction,
                    binding.id,
                    tx("飞书会话映射已启用。", "Feishu chat mapping resumed."),
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
                    revokeFeishuChannelBindingAction,
                    binding.id,
                    tx("飞书会话映射已撤销。", "Feishu chat mapping revoked."),
                  )}
                  type="button"
                >
                  {tx("撤销", "Revoke")}
                </button>
              ) : null}
            </div>
          </article>
        )) : (
          <p className="settings-empty">{tx("暂无会话映射。", "No chat mappings yet.")}</p>
        )}
      </div>
    </section>
  );
}

function translateProvisionSource(
  value: NonNullable<FeishuIntegrationSettingsItem["channelBindings"][number]["provisionSource"]>,
  tx: SettingsTx,
): string {
  switch (value) {
    case "bot_added":
      return tx("机器人进群", "Bot added");
    case "first_message":
      return tx("首次消息", "First message");
    case "agentspace_created":
      return tx("AgentSpace 创建", "AgentSpace created");
    case "manual":
      return tx("手动绑定", "Manual");
    default:
      return value;
  }
}

function translateReviewStatus(
  value: NonNullable<FeishuIntegrationSettingsItem["channelBindings"][number]["reviewStatus"]>,
  tx: SettingsTx,
): string {
  switch (value) {
    case "approved":
      return tx("通过", "Approved");
    case "pending_admin_review":
      return tx("等待管理员审核", "Pending admin review");
    case "needs_identity_binding":
      return tx("需要身份绑定", "Needs identity binding");
    default:
      return value;
  }
}
