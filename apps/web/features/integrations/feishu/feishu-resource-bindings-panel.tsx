"use client";

import { type FormEvent, type TransitionStartFunction, useEffect, useState } from "react";
import type {
  ExternalResourceBindingAgentSpaceType,
  ExternalResourceBindingProviderType,
} from "@agent-space/db";
import type { SettingsTx } from "@/features/settings/settings-types";
import { translateSettingsActionError } from "@/features/settings/settings-utils";
import {
  createFeishuResourceBindingAction,
  pauseFeishuResourceBindingAction,
  resumeFeishuResourceBindingAction,
  revokeFeishuResourceBindingAction,
} from "./feishu-actions";
import type {
  FeishuAvailableChannelItem,
  FeishuIntegrationSettingsItem,
} from "./feishu-types";
import { formatFeishuResourceTitle } from "./feishu-resource-labels";

const FEISHU_RESOURCE_TYPE_OPTIONS: Array<{
  labelZh: string;
  labelEn: string;
  value: ExternalResourceBindingProviderType;
}> = [
  { value: "doc", labelZh: "Doc", labelEn: "Doc" },
  { value: "sheet", labelZh: "Sheet", labelEn: "Sheet" },
  { value: "base", labelZh: "Base", labelEn: "Base" },
  { value: "base_table", labelZh: "Base Table", labelEn: "Base Table" },
  { value: "base_view", labelZh: "Base View", labelEn: "Base View" },
];

const AGENT_SPACE_RESOURCE_TYPE_OPTIONS: Array<{
  labelZh: string;
  labelEn: string;
  value: ExternalResourceBindingAgentSpaceType;
}> = [
  { value: "channel_document", labelZh: "频道文档", labelEn: "Channel Document" },
  { value: "data_table", labelZh: "数据表", labelEn: "Data Table" },
  { value: "knowledge_page", labelZh: "知识页", labelEn: "Knowledge Page" },
];

export function FeishuResourceBindingsPanel({
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
  const [providerResourceType, setProviderResourceType] = useState<ExternalResourceBindingProviderType>("doc");
  const [resourceUrlOrToken, setResourceUrlOrToken] = useState("");
  const [agentSpaceResourceType, setAgentSpaceResourceType] = useState<ExternalResourceBindingAgentSpaceType>("channel_document");
  const [agentSpaceResourceId, setAgentSpaceResourceId] = useState("");
  const [channelName, setChannelName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [allowWrite, setAllowWrite] = useState(false);
  const resourceRequirement = buildFeishuResourceBindingRequirement(providerResourceType, tx);

  useEffect(() => {
    if (!integrationId || !selectableIntegrations.some((integration) => integration.id === integrationId)) {
      setIntegrationId(selectableIntegrations[0]?.id ?? "");
    }
  }, [integrationId, selectableIntegrations]);

  useEffect(() => {
    if (channelName && !availableChannels.some((channel) => channel.name === channelName)) {
      setChannelName("");
    }
  }, [availableChannels, channelName]);

  const bindings = integrations.flatMap((integration) =>
    integration.resourceBindings.map((binding) => ({
      ...binding,
      integrationName: integration.displayName,
    })),
  ).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt));
  const activeBindingCount = bindings.filter((binding) => binding.status === "active").length;
  const pausedBindingCount = bindings.filter((binding) => binding.status === "disabled").length;
  const archivedBindingCount = bindings.filter((binding) => binding.status === "archived").length;
  const latestUnhealthyBinding = bindings.find((binding) => binding.status !== "active");
  const latestUnhealthyBindingLabel = latestUnhealthyBinding
    ? formatFeishuResourceTitle(latestUnhealthyBinding)
    : "";
  const canSubmit = Boolean(
    integrationId &&
    resourceUrlOrToken.trim() &&
    (
      agentSpaceResourceType === "channel_document"
        ? channelName || agentSpaceResourceId.trim()
        : agentSpaceResourceType === "data_table" || agentSpaceResourceId.trim()
    ),
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    startTransition(async () => {
      try {
        const updated = await createFeishuResourceBindingAction({
          integrationId,
          providerResourceType,
          resourceUrlOrToken,
          agentSpaceResourceType,
          agentSpaceResourceId,
          channelName,
          displayName,
          allowWrite,
        });
        setResourceUrlOrToken("");
        setAgentSpaceResourceId("");
        setDisplayName("");
        setAllowWrite(false);
        setFeedback(tx("飞书资源映射已保存。", "Feishu resource mapping saved."));
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
    <section className="page-panel">
      <div className="panel-header">
        <div>
          <h3>{tx("飞书数据资源", "Feishu Data Resources")}</h3>
          <p className="settings-panel-note">
            {tx("把飞书 Docs、Sheets、Base 接到 AgentSpace 资源。", "Connect Feishu Docs, Sheets, and Base to AgentSpace resources.")}
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
          <span>{tx("飞书类型", "Feishu Type")}</span>
          <select
            disabled={isPending}
            onChange={(event) => {
              const nextProviderResourceType = event.currentTarget.value as ExternalResourceBindingProviderType;
              setProviderResourceType(nextProviderResourceType);
              setAgentSpaceResourceType(
                buildFeishuResourceBindingRequirement(nextProviderResourceType, tx).recommendedAgentSpaceType,
              );
            }}
            value={providerResourceType}
          >
            {FEISHU_RESOURCE_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{tx(option.labelZh, option.labelEn)}</option>
            ))}
          </select>
        </label>

        <div aria-label={tx("飞书资源绑定权限", "Feishu resource binding scopes")} className="feishu-resource-scope-hint">
          <div>
            <strong>{tx("所需权限", "Required Scopes")}</strong>
            <span>{resourceRequirement.scopes.map((scope) => <code key={scope}>{scope}</code>)}</span>
          </div>
          <div>
            <strong>{tx("推荐类型", "Recommended Type")}</strong>
            <span>{resourceRequirement.recommendedAgentSpaceTypeLabel}</span>
          </div>
        </div>

        <label className="form-field">
          <span>{tx("飞书链接或 Token", "Feishu URL or Token")}</span>
          <input
            autoComplete="off"
            disabled={isPending}
            onChange={(event) => setResourceUrlOrToken(event.currentTarget.value)}
            value={resourceUrlOrToken}
          />
        </label>

        <label className="form-field">
          <span>{tx("AgentSpace 类型", "AgentSpace Type")}</span>
          <select
            disabled={isPending}
            onChange={(event) => setAgentSpaceResourceType(event.currentTarget.value)}
            value={agentSpaceResourceType}
          >
            {AGENT_SPACE_RESOURCE_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{tx(option.labelZh, option.labelEn)}</option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>{tx("AgentSpace 资源 ID", "AgentSpace Resource ID")}</span>
          <input
            autoComplete="off"
            disabled={isPending}
            onChange={(event) => setAgentSpaceResourceId(event.currentTarget.value)}
            placeholder={
              agentSpaceResourceType === "channel_document"
                ? tx("留空则创建频道文档", "Blank creates a channel document")
                : agentSpaceResourceType === "data_table"
                  ? tx("留空则创建数据表", "Blank creates a data table")
                  : undefined
            }
            value={agentSpaceResourceId}
          />
        </label>

        <label className="form-field">
          <span>{tx("关联频道", "Linked Channel")}</span>
          <select
            disabled={isPending || availableChannels.length === 0}
            onChange={(event) => setChannelName(event.currentTarget.value)}
            value={channelName}
          >
            <option value="">{tx("不关联频道", "No linked channel")}</option>
            {availableChannels.map((channel) => (
              <option key={channel.name} value={channel.name}>
                {channel.kind ? `${channel.name} (${channel.kind})` : channel.name}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>{tx("显示名称", "Display Name")}</span>
          <input
            autoComplete="off"
            disabled={isPending}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
            value={displayName}
          />
        </label>

        <label className="settings-checkbox-row">
          <input
            checked={allowWrite}
            disabled={isPending}
            onChange={(event) => setAllowWrite(event.currentTarget.checked)}
            type="checkbox"
          />
          <span>{tx("允许审批后的写入", "Allow approved writes")}</span>
        </label>

        <button
          className="primary-button"
          disabled={isPending || !canSubmit}
          type="submit"
        >
          {tx("保存资源映射", "Save Resource")}
        </button>
      </form>

      {bindings.length > 0 ? (
        <div aria-label={tx("飞书资源绑定健康", "Feishu resource binding health")} className="feishu-resource-health">
          <div>
            <strong>{tx("资源绑定健康", "Resource Binding Health")}</strong>
            <span>{tx("启用", "Active")}: {activeBindingCount}</span>
            <span>{tx("暂停", "Paused")}: {pausedBindingCount}</span>
            <span>{tx("归档", "Archived")}: {archivedBindingCount}</span>
          </div>
          <p>
            {latestUnhealthyBinding
              ? `${tx("最近异常", "Latest issue")}: ${latestUnhealthyBindingLabel} · ${translateBindingStatus(latestUnhealthyBinding.status, tx)}`
              : tx("全部资源绑定处于启用状态。", "All resource bindings are active.")}
          </p>
        </div>
      ) : null}

      <div className="feishu-binding-list">
        {bindings.length > 0 ? bindings.map((binding) => (
          <article className="feishu-binding-card" key={binding.id}>
            <div>
              <strong>{formatFeishuResourceTitle(binding)}</strong>
              <p>{binding.integrationName}</p>
            </div>
            <div className="feishu-binding-card__meta">
              <span>{tx("飞书", "Feishu")}: {binding.providerResourceReference}</span>
              <span>{tx("AgentSpace", "AgentSpace")}: {binding.agentSpaceResourceType}</span>
              <span>{tx("资源 ID", "Resource ID")}: {binding.agentSpaceResourceId}</span>
              <span>{tx("写入", "Write")}: {binding.canWrite ? tx("需审批", "Approval required") : tx("未授权", "Not allowed")}</span>
              <span>{tx("状态", "Status")}: {translateBindingStatus(binding.status, tx)}</span>
              {binding.channelName ? <span>{tx("频道", "Channel")}: {binding.channelName}</span> : null}
            </div>
            <div className="feishu-binding-card__actions">
              {binding.status === "active" ? (
                <button
                  className="action-button"
                  disabled={isPending}
                  onClick={() => updateBindingStatus(
                    pauseFeishuResourceBindingAction,
                    binding.id,
                    tx("飞书资源映射已暂停。", "Feishu resource mapping paused."),
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
                    resumeFeishuResourceBindingAction,
                    binding.id,
                    tx("飞书资源映射已启用。", "Feishu resource mapping resumed."),
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
                    revokeFeishuResourceBindingAction,
                    binding.id,
                    tx("飞书资源映射已撤销。", "Feishu resource mapping revoked."),
                  )}
                  type="button"
                >
                  {tx("撤销", "Revoke")}
                </button>
              ) : null}
            </div>
          </article>
        )) : (
          <p className="settings-empty">{tx("暂无飞书资源映射。", "No Feishu resource mappings yet.")}</p>
        )}
      </div>
    </section>
  );
}

function buildFeishuResourceBindingRequirement(
  providerResourceType: ExternalResourceBindingProviderType,
  tx: SettingsTx,
): {
  scopes: string[];
  recommendedAgentSpaceType: ExternalResourceBindingAgentSpaceType;
  recommendedAgentSpaceTypeLabel: string;
} {
  if (providerResourceType === "doc") {
    return {
      scopes: ["docx:document", "drive:drive"],
      recommendedAgentSpaceType: "channel_document",
      recommendedAgentSpaceTypeLabel: tx("频道文档", "Channel Document"),
    };
  }
  if (providerResourceType === "sheet") {
    return {
      scopes: ["sheets:spreadsheet"],
      recommendedAgentSpaceType: "data_table",
      recommendedAgentSpaceTypeLabel: tx("数据表", "Data Table"),
    };
  }
  if (
    providerResourceType === "base" ||
    providerResourceType === "base_table" ||
    providerResourceType === "base_view"
  ) {
    return {
      scopes: ["bitable:app"],
      recommendedAgentSpaceType: "data_table",
      recommendedAgentSpaceTypeLabel: tx("数据表", "Data Table"),
    };
  }
  return {
    scopes: [],
    recommendedAgentSpaceType: "knowledge_page",
    recommendedAgentSpaceTypeLabel: tx("外部资源", "External Resource"),
  };
}

function translateBindingStatus(
  status: FeishuIntegrationSettingsItem["resourceBindings"][number]["status"],
  tx: SettingsTx,
): string {
  switch (status) {
    case "active":
      return tx("启用", "Active");
    case "disabled":
      return tx("暂停", "Paused");
    case "archived":
      return tx("归档", "Archived");
  }
}
