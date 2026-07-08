"use client";

import { type FormEvent, type TransitionStartFunction, useEffect, useMemo, useState } from "react";
import type { WorkspaceRole } from "@agent-space/db";
import type { SettingsTx } from "@/features/settings/settings-types";
import { translateSettingsActionError } from "@/features/settings/settings-utils";
import {
  checkSlackIntegrationHealthAction,
  createSlackChannelBindingAction,
  createSlackIntegrationAction,
  createSlackUserBindingAction,
  deleteSlackIntegrationAction,
  disableSlackIntegrationAction,
  resumeSlackIntegrationAction,
} from "./slack-actions";
import type {
  SlackAvailableChannelItem,
  SlackAvailableUserItem,
  SlackIntegrationCreationGuide,
  SlackIntegrationSettingsItem,
  SlackIntegrationSetupCheck,
} from "./slack-types";

export function SlackIntegrationSettingsPanel({
  availableChannels,
  availableUsers,
  currentMembershipRole,
  currentUserId,
  isPending,
  refreshSettingsData,
  slackIntegrationCreationGuide,
  slackIntegrations,
  startTransition,
  tx,
}: {
  availableChannels: SlackAvailableChannelItem[];
  availableUsers: SlackAvailableUserItem[];
  currentMembershipRole: WorkspaceRole;
  currentUserId?: string;
  isPending: boolean;
  refreshSettingsData: () => void;
  slackIntegrationCreationGuide?: SlackIntegrationCreationGuide;
  slackIntegrations: SlackIntegrationSettingsItem[];
  startTransition: TransitionStartFunction;
  tx: SettingsTx;
}) {
  const [integrations, setIntegrations] = useState(slackIntegrations);
  const [feedback, setFeedback] = useState<string | null>(null);
  const canManageIntegrations = currentMembershipRole === "owner" || currentMembershipRole === "admin";
  const totalChannelBindings = integrations.reduce((sum, integration) => sum + integration.channelBindingCount, 0);
  const totalUserBindings = integrations.reduce((sum, integration) => sum + integration.userBindingCount, 0);
  const totalOutboxFailures = integrations.reduce((sum, integration) => sum + integration.outboxFailureCount, 0);
  const totalAgentBots = integrations.filter((integration) => integration.status !== "disabled" && Boolean(integration.agentId)).length;

  useEffect(() => {
    setIntegrations(slackIntegrations);
  }, [slackIntegrations]);

  function mergeIntegration(nextIntegration: SlackIntegrationSettingsItem): void {
    setIntegrations((current) => [
      nextIntegration,
      ...current.filter((integration) => integration.id !== nextIntegration.id),
    ]);
    refreshSettingsData();
  }

  function removeIntegration(integrationId: string): void {
    setIntegrations((current) => current.filter((integration) => integration.id !== integrationId));
    refreshSettingsData();
  }

  return (
    <section aria-label={tx("Slack 集成", "Slack integrations")}>
      <div className="panel-header">
        <div>
          <h3>Slack</h3>
          <p className="settings-panel-note">
            {tx("Slack 消息入口、用户身份映射和频道映射。", "Slack message entry, user identity mapping, and channel mapping.")}
          </p>
        </div>
      </div>

      <div className="feishu-mini-panel-grid">
        <section className="feishu-mini-panel">
          <strong>{canManageIntegrations ? tx("Slack 用户绑定", "Slack User Bindings") : tx("我的 Slack 绑定", "My Slack Binding")}</strong>
          <span>{totalUserBindings}</span>
        </section>
        {canManageIntegrations ? (
          <>
            <section className="feishu-mini-panel">
              <strong>{tx("Slack 频道映射", "Slack Channel Mappings")}</strong>
              <span>{totalChannelBindings}</span>
            </section>
            <section className="feishu-mini-panel">
              <strong>{tx("Slack 集成", "Slack Integrations")}</strong>
              <span>{integrations.filter((integration) => integration.status !== "disabled").length}</span>
            </section>
            <section className="feishu-mini-panel">
              <strong>{tx("Agent Bots", "Agent Bots")}</strong>
              <span>{totalAgentBots}</span>
            </section>
            <section className="feishu-mini-panel">
              <strong>{tx("出站失败", "Outbound Failures")}</strong>
              <span>{totalOutboxFailures}</span>
            </section>
          </>
        ) : (
          <section className="feishu-mini-panel">
            <strong>{tx("可用集成", "Available Integrations")}</strong>
            <span>{integrations.filter((integration) => integration.status !== "disabled").length}</span>
          </section>
        )}
      </div>

      {feedback ? <p aria-live="polite" className="settings-feedback" role="status">{feedback}</p> : null}

      {canManageIntegrations ? (
        <>
          <SlackCreateIntegrationPanel
            creationGuide={slackIntegrationCreationGuide}
            isPending={isPending}
            onCreated={mergeIntegration}
            setFeedback={setFeedback}
            startTransition={startTransition}
            tx={tx}
          />
          <SlackHealthPanel
            integrations={integrations}
            isPending={isPending}
            onDeleted={removeIntegration}
            onUpdated={mergeIntegration}
            setFeedback={setFeedback}
            startTransition={startTransition}
            tx={tx}
          />
        </>
      ) : null}

      <SlackUserBindingsPanel
        availableUsers={availableUsers}
        currentMembershipRole={currentMembershipRole}
        currentUserId={currentUserId}
        integrations={integrations}
        isPending={isPending}
        onUpdated={mergeIntegration}
        setFeedback={setFeedback}
        startTransition={startTransition}
        tx={tx}
      />

      {canManageIntegrations ? (
        <SlackChannelBindingsPanel
          availableChannels={availableChannels}
          integrations={integrations}
          isPending={isPending}
          onUpdated={mergeIntegration}
          setFeedback={setFeedback}
          startTransition={startTransition}
          tx={tx}
        />
      ) : null}
    </section>
  );
}

function SlackCreateIntegrationPanel({
  creationGuide,
  isPending,
  onCreated,
  setFeedback,
  startTransition,
  tx,
}: {
  creationGuide?: SlackIntegrationCreationGuide;
  isPending: boolean;
  onCreated: (integration: SlackIntegrationSettingsItem) => void;
  setFeedback: (value: string | null) => void;
  startTransition: TransitionStartFunction;
  tx: SettingsTx;
}) {
  const [displayName, setDisplayName] = useState("Slack");
  const [transportMode, setTransportMode] = useState<"http_webhook" | "websocket_worker">("http_webhook");
  const [appId, setAppId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [botToken, setBotToken] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [appLevelToken, setAppLevelToken] = useState("");
  const needsAppLevelToken = transportMode === "websocket_worker";
  const canSubmit = Boolean(appId.trim() && botToken.trim() && signingSecret.trim() && (!needsAppLevelToken || appLevelToken.trim()));

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    startTransition(async () => {
      try {
        const created = await createSlackIntegrationAction({
          displayName,
          transportMode,
          appId,
          teamId,
          botToken,
          signingSecret,
          appLevelToken,
        });
        setAppId("");
        setTeamId("");
        setBotToken("");
        setSigningSecret("");
        setAppLevelToken("");
        setFeedback(tx("Slack 集成已创建。", "Slack integration created."));
        onCreated(created);
      } catch (error) {
        setFeedback(translateSettingsActionError(error, tx));
      }
    });
  }

  return (
    <details className="feishu-advanced-settings">
      <summary>
        <span>{tx("创建 Slack 集成", "Create Slack Integration")}</span>
        <small>{tx("HTTP Events API 或 Socket Mode。", "HTTP Events API or Socket Mode.")}</small>
      </summary>

      <div className="feishu-advanced-settings__body">
        <form className="feishu-integration-form" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>{tx("名称", "Name")}</span>
            <input
              disabled={isPending}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
              value={displayName}
            />
          </label>

          <label className="form-field">
            <span>{tx("连接方式", "Transport")}</span>
            <select
              disabled={isPending}
              onChange={(event) => setTransportMode(event.currentTarget.value as "http_webhook" | "websocket_worker")}
              value={transportMode}
            >
              <option value="http_webhook">{tx("Events API", "Events API")}</option>
              <option value="websocket_worker">Socket Mode</option>
            </select>
          </label>

          <label className="form-field">
            <span>{tx("Slack App ID", "Slack App ID")}</span>
            <input
              autoComplete="off"
              disabled={isPending}
              onChange={(event) => setAppId(event.currentTarget.value)}
              placeholder="A..."
              value={appId}
            />
          </label>

          <label className="form-field">
            <span>{tx("Team ID", "Team ID")}</span>
            <input
              autoComplete="off"
              disabled={isPending}
              onChange={(event) => setTeamId(event.currentTarget.value)}
              placeholder="T..."
              value={teamId}
            />
          </label>

          <label className="form-field">
            <span>{tx("Bot Token", "Bot Token")}</span>
            <input
              autoComplete="new-password"
              disabled={isPending}
              onChange={(event) => setBotToken(event.currentTarget.value)}
              placeholder="xoxb-..."
              type="password"
              value={botToken}
            />
          </label>

          <label className="form-field">
            <span>{tx("Signing Secret", "Signing Secret")}</span>
            <input
              autoComplete="new-password"
              disabled={isPending}
              onChange={(event) => setSigningSecret(event.currentTarget.value)}
              type="password"
              value={signingSecret}
            />
          </label>

          <label className="form-field">
            <span>
              {needsAppLevelToken
                ? tx("App-Level Token（Socket Mode 必填）", "App-Level Token (required for Socket Mode)")
                : tx("App-Level Token", "App-Level Token")}
            </span>
            <input
              autoComplete="new-password"
              disabled={isPending}
              onChange={(event) => setAppLevelToken(event.currentTarget.value)}
              placeholder="xapp-..."
              type="password"
              value={appLevelToken}
            />
          </label>

          <button className="primary-button" disabled={isPending || !canSubmit} type="submit">
            {tx("创建 Slack 集成", "Create Slack Integration")}
          </button>
        </form>

        {creationGuide ? (
          <div className="feishu-setup-summary" aria-label={tx("Slack App 配置", "Slack app configuration")}>
            {creationGuide.oauthStartUrl ? (
              <section>
                <strong>{tx("OAuth 安装", "OAuth Install")}</strong>
                <a className="secondary-button" href={creationGuide.oauthStartUrl}>{tx("Add to Slack", "Add to Slack")}</a>
                <code>{creationGuide.oauthCallbackUrlTemplate}</code>
              </section>
            ) : null}
            <section>
              <strong>{tx("Slack App", "Slack App")}</strong>
              <a href={creationGuide.developerConsoleUrl} rel="noreferrer" target="_blank">{creationGuide.developerConsoleUrl}</a>
            </section>
            <section>
              <strong>{tx("事件回调", "Event Callback")}</strong>
              <code>{creationGuide.eventCallbackPath}</code>
              <small>
                {creationGuide.publicAppUrlStatus === "configured"
                  ? tx("Public URL 已配置", "Public URL configured")
                  : tx("缺少 Public URL", "Public URL missing")}
              </small>
              {creationGuide.publicAppUrl ? <code>{creationGuide.publicAppUrl}</code> : null}
              <code>{creationGuide.callbackUrlTemplate}</code>
            </section>
            <section>
              <strong>{tx("交互回调", "Interactivity Callback")}</strong>
              <code>{creationGuide.interactionCallbackPath}</code>
              <code>{creationGuide.interactionCallbackUrlTemplate}</code>
            </section>
            <section>
              <strong>{tx("事件", "Events")}</strong>
              <ul>
                {creationGuide.requiredEvents.map((eventName) => (
                  <li key={eventName}><code>{eventName}</code></li>
                ))}
              </ul>
            </section>
            <section>
              <strong>{tx("权限", "Scopes")}</strong>
              <ul>
                {creationGuide.requiredScopes.map((scope) => (
                  <li key={scope}><code>{scope}</code></li>
                ))}
              </ul>
            </section>
            <section>
              <strong>{tx("Slack App Manifest", "Slack App Manifest")}</strong>
              <pre className="feishu-manifest-preview"><code>{creationGuide.manifestJson}</code></pre>
              <button
                className="action-button"
                onClick={() => {
                  copyToClipboard(creationGuide.manifestJson);
                  setFeedback(tx("Slack App Manifest 已复制。", "Slack app manifest copied."));
                }}
                type="button"
              >
                {tx("复制 Manifest", "Copy Manifest")}
              </button>
            </section>
            <SlackCommandList commands={creationGuide.commands} setFeedback={setFeedback} tx={tx} />
          </div>
        ) : null}
      </div>
    </details>
  );
}

function SlackHealthPanel({
  integrations,
  isPending,
  onDeleted,
  onUpdated,
  setFeedback,
  startTransition,
  tx,
}: {
  integrations: SlackIntegrationSettingsItem[];
  isPending: boolean;
  onDeleted: (integrationId: string) => void;
  onUpdated: (integration: SlackIntegrationSettingsItem) => void;
  setFeedback: (value: string | null) => void;
  startTransition: TransitionStartFunction;
  tx: SettingsTx;
}) {
  return (
    <section className="page-panel">
      <div className="panel-header">
        <div>
          <h3>{tx("Slack 应用", "Slack Apps")}</h3>
          <p className="settings-panel-note">
            {tx("每个 Slack App 独立保存凭据、回调地址和绑定状态。", "Each Slack app keeps separate credentials, callback URL, and binding state.")}
          </p>
        </div>
      </div>

      <div className="feishu-integration-list">
        {integrations.length > 0 ? integrations.map((integration) => (
          <article className="feishu-integration-card" key={integration.id}>
            <div className="feishu-integration-card__header">
              <div>
                <strong>{integration.displayName}</strong>
                <p>{integration.appId ?? tx("未记录 App ID", "No App ID recorded")}</p>
              </div>
              <span className={`status-chip${integration.status === "active" ? " status-chip--active" : ""}`}>
                {translateIntegrationStatus(integration.status, tx)}
              </span>
            </div>

            <div className="feishu-integration-card__meta">
              <span>{tx("连接方式", "Transport")}: {translateTransportMode(integration.transportMode, tx)}</span>
              {integration.agentId ? <span>{tx("Agent", "Agent")}: {integration.agentId}</span> : null}
              <span>{tx("频道绑定", "Channels")}: {integration.channelBindingCount}</span>
              <span>{tx("用户绑定", "Users")}: {integration.userBindingCount}</span>
              <span>{tx("Team", "Team")}: {integration.teamId ?? tx("未锁定", "Not locked")}</span>
              <span>{tx("凭据", "Credentials")}: {hasRequiredSlackCredentials(integration) ? tx("已保存", "Stored") : tx("不完整", "Incomplete")}</span>
              <span>{tx("健康状态", "Health")}: {translateHealthStatus(integration.lastHealthStatus, tx)}</span>
              <span>{tx("上次检查", "Last Check")}: {integration.lastHealthCheckedAt ?? tx("未检查", "Not checked")}</span>
            </div>

            {integration.lastError ? <p className="settings-panel-note">{integration.lastError}</p> : null}

            <label className="form-field">
              <span>{tx("事件回调地址", "Event Callback URL")}</span>
              <code className="feishu-callback-url">{integration.callbackUrl}</code>
            </label>

            {integration.recentOutboxFailures.length > 0 ? (
              <div className="feishu-outbox-failure-list">
                <strong>{tx("最近出站失败", "Recent Outbound Failures")}</strong>
                {integration.recentOutboxFailures.map((item) => (
                  <div className="feishu-outbox-failure" key={item.id}>
                    <div>
                      <span className={`status-chip ${item.status === "failed" ? "status-chip--danger" : "status-chip--warning"}`}>
                        {translateOutboxStatus(item.status, tx)}
                      </span>
                      <span>{tx("尝试", "Attempts")}: {item.attempts}</span>
                      <span>{tx("Slack 频道", "Slack Channel")}: {item.targetExternalChannelReference}</span>
                      {item.nextAttemptAt ? <span>{tx("下次重试", "Next Retry")}: {item.nextAttemptAt}</span> : null}
                    </div>
                    <p>{item.lastError ?? tx("无错误详情", "No error detail")}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {integration.recentInboundEvents.length > 0 ? (
              <div className="feishu-inbound-event-list">
                <div>
                  <strong>{tx("最近入站事件", "Recent Inbound Events")}</strong>
                  <span>{tx("未绑定用户", "Unbound Users")}: {countInboundEventsByReason(integration, "slack.user_binding_missing")}</span>
                  <span>{tx("未绑定频道", "Unbound Channels")}: {countInboundEventsByReason(integration, "slack.channel_binding_missing")}</span>
                </div>
                {integration.recentInboundEvents.map((item) => (
                  <div className="feishu-inbound-event" key={item.id}>
                    <div>
                      <span className={`status-chip ${resolveInboundEventStatusClass(item.status)}`}>
                        {translateInboundEventStatus(item.status, tx)}
                      </span>
                      <span>{item.eventType}</span>
                      <span>{item.externalEventReference}</span>
                    </div>
                    <p>
                      {item.errorMessage
                        ? `${tx("原因", "Reason")}: ${item.errorMessage}`
                        : tx("无失败原因", "No failure reason")}
                    </p>
                    {item.bindingSuggestion ? (
                      <small>
                        {item.bindingSuggestion.kind === "channel"
                          ? `${tx("建议绑定频道", "Suggested channel binding")}: ${item.bindingSuggestion.externalChannelReference}`
                          : `${tx("建议绑定用户", "Suggested user binding")}: ${item.bindingSuggestion.externalUserReference}`}
                      </small>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {integration.setupGuide ? <SlackSetupGuide integration={integration} setFeedback={setFeedback} tx={tx} /> : null}

            <div className="feishu-integration-card__actions">
              <button
                className="action-button"
                onClick={() => {
                  copyToClipboard(integration.callbackUrl);
                  setFeedback(tx("Slack 回调地址已复制。", "Slack callback URL copied."));
                }}
                type="button"
              >
                {tx("复制回调地址", "Copy Callback URL")}
              </button>
              <button
                className="action-button"
                disabled={isPending || integration.status === "disabled"}
                onClick={() => {
                  startTransition(async () => {
                    try {
                      const updated = await checkSlackIntegrationHealthAction(integration.id);
                      setFeedback(updated.lastHealthStatus === "healthy"
                        ? tx("Slack 连接检查通过。", "Slack health check passed.")
                        : tx("Slack 连接检查失败。", "Slack health check failed."));
                      onUpdated(updated);
                    } catch (error) {
                      setFeedback(translateSettingsActionError(error, tx));
                    }
                  });
                }}
                type="button"
              >
                {tx("检查连接", "Check Connection")}
              </button>
              {integration.status === "disabled" ? (
                <button
                  className="action-button"
                  disabled={isPending}
                  onClick={() => {
                    startTransition(async () => {
                      try {
                        const updated = await resumeSlackIntegrationAction(integration.id);
                        setFeedback(tx("Slack 集成已启用。", "Slack integration resumed."));
                        onUpdated(updated);
                      } catch (error) {
                        setFeedback(translateSettingsActionError(error, tx));
                      }
                    });
                  }}
                  type="button"
                >
                  {tx("启用", "Enable")}
                </button>
              ) : (
                <button
                  className="action-button action-button--danger"
                  disabled={isPending}
                  onClick={() => {
                    startTransition(async () => {
                      try {
                        const updated = await disableSlackIntegrationAction(integration.id);
                        setFeedback(tx("Slack 集成已停用。", "Slack integration disabled."));
                        onUpdated(updated);
                      } catch (error) {
                        setFeedback(translateSettingsActionError(error, tx));
                      }
                    });
                  }}
                  type="button"
                >
                  {tx("停用", "Disable")}
                </button>
              )}
              <button
                className="action-button action-button--danger"
                disabled={isPending}
                onClick={() => {
                  if (!window.confirm(tx("删除这个 Slack 集成？", "Delete this Slack integration?"))) {
                    return;
                  }
                  startTransition(async () => {
                    try {
                      const deleted = await deleteSlackIntegrationAction(integration.id);
                      setFeedback(tx("Slack 集成已删除。", "Slack integration deleted."));
                      onDeleted(deleted.integrationId);
                    } catch (error) {
                      setFeedback(translateSettingsActionError(error, tx));
                    }
                  });
                }}
                type="button"
              >
                {tx("删除", "Delete")}
              </button>
            </div>
          </article>
        )) : (
          <p className="settings-panel-note">{tx("暂无 Slack 集成。", "No Slack integrations yet.")}</p>
        )}
      </div>
    </section>
  );
}

function SlackChannelBindingsPanel({
  availableChannels,
  integrations,
  isPending,
  onUpdated,
  setFeedback,
  startTransition,
  tx,
}: {
  availableChannels: SlackAvailableChannelItem[];
  integrations: SlackIntegrationSettingsItem[];
  isPending: boolean;
  onUpdated: (integration: SlackIntegrationSettingsItem) => void;
  setFeedback: (value: string | null) => void;
  startTransition: TransitionStartFunction;
  tx: SettingsTx;
}) {
  const selectableIntegrations = integrations.filter((integration) => integration.status !== "disabled");
  const [integrationId, setIntegrationId] = useState(selectableIntegrations[0]?.id ?? "");
  const [channelName, setChannelName] = useState(availableChannels[0]?.name ?? "");
  const [externalChannelId, setExternalChannelId] = useState("");
  const [externalChannelType, setExternalChannelType] = useState("channel");
  const [externalChannelName, setExternalChannelName] = useState("");
  const bindings = integrations.flatMap((integration) =>
    integration.channelBindings.map((binding) => ({
      ...binding,
      integrationName: integration.displayName,
    })),
  );
  const canSubmit = Boolean(integrationId && channelName && externalChannelId.trim());

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

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    startTransition(async () => {
      try {
        const updated = await createSlackChannelBindingAction({
          integrationId,
          channelName,
          externalChannelId,
          externalChannelType,
          externalChannelName,
        });
        setExternalChannelId("");
        setExternalChannelName("");
        setFeedback(tx("Slack 频道映射已保存。", "Slack channel mapping saved."));
        onUpdated(updated);
      } catch (error) {
        setFeedback(translateSettingsActionError(error, tx));
      }
    });
  }

  return (
    <section className="page-panel" id="slack-channel-bindings">
      <div className="panel-header">
        <div>
          <h3>{tx("Slack 频道映射", "Slack Channel Mappings")}</h3>
          <p className="settings-panel-note">
            {tx("把 AgentSpace 频道连接到 Slack channel、private channel 或 DM。", "Connect AgentSpace channels to Slack channels, private channels, or DMs.")}
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
          <span>{tx("Slack Conversation ID", "Slack Conversation ID")}</span>
          <input
            autoComplete="off"
            disabled={isPending}
            onChange={(event) => setExternalChannelId(event.currentTarget.value)}
            placeholder="C... / G... / D..."
            value={externalChannelId}
          />
        </label>

        <label className="form-field">
          <span>{tx("会话类型", "Conversation Type")}</span>
          <select
            disabled={isPending}
            onChange={(event) => setExternalChannelType(event.currentTarget.value)}
            value={externalChannelType}
          >
            <option value="channel">{tx("公开频道", "Channel")}</option>
            <option value="group">{tx("私有频道", "Private Channel")}</option>
            <option value="im">DM</option>
            <option value="mpim">Group DM</option>
          </select>
        </label>

        <label className="form-field">
          <span>{tx("Slack 名称", "Slack Name")}</span>
          <input
            autoComplete="off"
            disabled={isPending}
            onChange={(event) => setExternalChannelName(event.currentTarget.value)}
            value={externalChannelName}
          />
        </label>

        <button className="primary-button" disabled={isPending || !canSubmit} type="submit">
          {tx("保存频道映射", "Save Mapping")}
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
              <span>{tx("Slack 会话", "Slack Conversation")}: {binding.externalChannelName || binding.externalChannelReference}</span>
              <span>{tx("会话引用", "Conversation Reference")}: {binding.externalChannelReference}</span>
              <span>{tx("类型", "Type")}: {binding.externalChannelType ?? "unknown"}</span>
              <span>{tx("状态", "Status")}: {binding.status}</span>
              <span>{tx("同步", "Sync")}: {binding.syncMode}</span>
            </div>
          </article>
        )) : (
          <p className="settings-panel-note">{tx("暂无 Slack 频道映射。", "No Slack channel mappings yet.")}</p>
        )}
      </div>
    </section>
  );
}

function SlackUserBindingsPanel({
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
  availableUsers: SlackAvailableUserItem[];
  currentMembershipRole: WorkspaceRole;
  currentUserId?: string;
  integrations: SlackIntegrationSettingsItem[];
  isPending: boolean;
  onUpdated: (integration: SlackIntegrationSettingsItem) => void;
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
  const [displayName, setDisplayName] = useState("");
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

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    startTransition(async () => {
      try {
        const updated = await createSlackUserBindingAction({
          integrationId,
          userId,
          externalUserId,
          displayName,
        });
        setExternalUserId("");
        setDisplayName("");
        setFeedback(tx("Slack 用户绑定已保存。", "Slack user binding saved."));
        onUpdated(updated);
      } catch (error) {
        setFeedback(translateSettingsActionError(error, tx));
      }
    });
  }

  return (
    <section className="page-panel" id="slack-user-bindings">
      <div className="panel-header">
        <div>
          <h3>{tx("Slack 用户绑定", "Slack User Bindings")}</h3>
          <p className="settings-panel-note">
            {canManageAllUsers
              ? tx("把 Slack User ID 映射到 AgentSpace 成员。", "Map Slack User IDs to AgentSpace members.")
              : tx("绑定你自己的 Slack User ID。", "Bind your own Slack User ID.")}
          </p>
        </div>
      </div>

      {canManageAllUsers ? (
        <div aria-label={tx("Slack 用户绑定覆盖率", "Slack user binding coverage")} className="feishu-binding-coverage">
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
          <span>{tx("Slack User ID", "Slack User ID")}</span>
          <input
            autoComplete="off"
            disabled={isPending}
            onChange={(event) => setExternalUserId(event.currentTarget.value)}
            placeholder="U..."
            value={externalUserId}
          />
        </label>

        <label className="form-field">
          <span>{tx("Slack 显示名", "Slack Display Name")}</span>
          <input
            autoComplete="off"
            disabled={isPending}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
            value={displayName}
          />
        </label>

        <button className="primary-button" disabled={isPending || !canSubmit} type="submit">
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
              <span>{tx("Slack 用户", "Slack User")}: {binding.displayName || binding.externalUserReference}</span>
              <span>{tx("用户引用", "User Reference")}: {binding.externalUserReference}</span>
              <span>{tx("状态", "Status")}: {binding.status}</span>
              {binding.lastSeenAt ? <span>{tx("最近出现", "Last Seen")}: {binding.lastSeenAt}</span> : null}
            </div>
          </article>
        )) : (
          <p className="settings-panel-note">{tx("暂无 Slack 用户绑定。", "No Slack user bindings yet.")}</p>
        )}
      </div>
    </section>
  );
}

function SlackSetupGuide({
  integration,
  setFeedback,
  tx,
}: {
  integration: SlackIntegrationSettingsItem;
  setFeedback: (value: string | null) => void;
  tx: SettingsTx;
}) {
  const setupGuide = integration.setupGuide;
  if (!setupGuide) {
    return null;
  }
  return (
    <details className="feishu-advanced-settings">
      <summary>
        <span>{tx("Slack 验收检查", "Slack Acceptance Checks")}</span>
        <small>{setupGuide.checks.filter((check) => check.status === "ready").length} / {setupGuide.checks.length}</small>
      </summary>
      <div className="feishu-advanced-settings__body">
        <div className="feishu-setup-check-grid">
          {setupGuide.checks.map((check) => (
            <section className="feishu-setup-check" data-status={check.status} key={check.key}>
              <strong>{translateSetupCheckKey(check.key, tx)}</strong>
              <span>{translateSetupCheckStatus(check.status, tx)}</span>
              <small>{tx("当前", "Current")}: {check.current}{check.required ? ` / ${tx("要求", "Required")}: ${check.required}` : ""}</small>
            </section>
          ))}
        </div>
        <SlackCommandList commands={setupGuide.commands} setFeedback={setFeedback} tx={tx} />
      </div>
    </details>
  );
}

function SlackCommandList({
  commands,
  setFeedback,
  tx,
}: {
  commands: Record<string, string>;
  setFeedback: (value: string | null) => void;
  tx: SettingsTx;
}) {
  return (
    <section>
      <strong>{tx("CLI 命令", "CLI Commands")}</strong>
      <div className="feishu-command-list">
        {Object.entries(commands).map(([key, command]) => (
          <div className="feishu-command-item" key={key}>
            <span>{translateCommandKey(key, tx)}</span>
            <code>{command}</code>
            <button
              className="action-button"
              onClick={() => {
                copyToClipboard(command);
                setFeedback(tx("命令已复制。", "Command copied."));
              }}
              type="button"
            >
              {tx("复制", "Copy")}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function hasRequiredSlackCredentials(integration: SlackIntegrationSettingsItem): boolean {
  return integration.hasBotToken &&
    integration.hasSigningSecret &&
    (integration.transportMode !== "websocket_worker" || integration.hasAppLevelToken);
}

function countInboundEventsByReason(integration: SlackIntegrationSettingsItem, reason: string): number {
  return integration.recentInboundEvents.filter((event) => event.errorMessage === reason).length;
}

function translateIntegrationStatus(status: SlackIntegrationSettingsItem["status"], tx: SettingsTx): string {
  if (status === "active") {
    return tx("启用", "Active");
  }
  if (status === "disabled") {
    return tx("停用", "Disabled");
  }
  return tx("异常", "Error");
}

function translateTransportMode(mode: SlackIntegrationSettingsItem["transportMode"], tx: SettingsTx): string {
  return mode === "websocket_worker" ? "Socket Mode" : tx("Events API", "Events API");
}

function translateHealthStatus(status: SlackIntegrationSettingsItem["lastHealthStatus"], tx: SettingsTx): string {
  if (status === "healthy") {
    return tx("健康", "Healthy");
  }
  if (status === "degraded") {
    return tx("降级", "Degraded");
  }
  if (status === "error") {
    return tx("异常", "Error");
  }
  return tx("未知", "Unknown");
}

function translateOutboxStatus(status: string, tx: SettingsTx): string {
  if (status === "failed") {
    return tx("失败", "Failed");
  }
  if (status === "pending") {
    return tx("待发送", "Pending");
  }
  if (status === "locked") {
    return tx("发送中", "Locked");
  }
  if (status === "sent") {
    return tx("已发送", "Sent");
  }
  return tx("已取消", "Cancelled");
}

function translateInboundEventStatus(status: string, tx: SettingsTx): string {
  if (status === "processed") {
    return tx("已处理", "Processed");
  }
  if (status === "ignored") {
    return tx("已忽略", "Ignored");
  }
  if (status === "failed") {
    return tx("失败", "Failed");
  }
  return tx("已接收", "Received");
}

function resolveInboundEventStatusClass(status: string): string {
  if (status === "processed") {
    return "status-chip--active";
  }
  if (status === "failed") {
    return "status-chip--danger";
  }
  if (status === "ignored") {
    return "status-chip--warning";
  }
  return "";
}

function translateSetupCheckKey(key: SlackIntegrationSetupCheck["key"], tx: SettingsTx): string {
  switch (key) {
    case "credentials":
      return tx("凭据", "Credentials");
    case "callback_or_socket":
      return tx("回调 / Socket", "Callback / Socket");
    case "health":
      return tx("健康检查", "Health");
    case "channel_binding":
      return tx("频道映射", "Channel Mapping");
    case "user_binding":
      return tx("用户映射", "User Mapping");
    case "outbox":
      return tx("出站队列", "Outbox");
  }
}

function translateSetupCheckStatus(status: SlackIntegrationSetupCheck["status"], tx: SettingsTx): string {
  if (status === "ready") {
    return tx("就绪", "Ready");
  }
  if (status === "attention") {
    return tx("需关注", "Needs attention");
  }
  return tx("缺失", "Missing");
}

function translateCommandKey(key: string, tx: SettingsTx): string {
  switch (key) {
    case "create":
      return tx("创建", "Create");
    case "bindAgentBot":
      return tx("绑定 Agent Bot", "Bind Agent Bot");
    case "healthCheck":
      return tx("健康检查", "Health Check");
    case "bindChannel":
      return tx("绑定频道", "Bind Channel");
    case "bindUser":
      return tx("绑定用户", "Bind User");
    case "outboxDrain":
      return tx("发送队列", "Outbox Drain");
    default:
      return key;
  }
}

function formatUserLabel(
  user: SlackAvailableUserItem | undefined,
  currentUserId: string | undefined,
  tx: SettingsTx,
): string {
  if (user) {
    return user.primaryEmail ? `${user.displayName} (${user.primaryEmail})` : user.displayName;
  }
  return currentUserId ?? tx("当前用户", "Current user");
}

function copyToClipboard(value: string): void {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return;
  }
  void navigator.clipboard.writeText(value);
}
