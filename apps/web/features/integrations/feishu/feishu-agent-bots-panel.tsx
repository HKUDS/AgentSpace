"use client";

import { type TransitionStartFunction, useMemo, useState } from "react";
import type { SettingsTx } from "@/features/settings/settings-types";
import { translateSettingsActionError } from "@/features/settings/settings-utils";
import {
  createFeishuAgentBotBindingAction,
  disableFeishuAgentBotBindingAction,
  testFeishuIntegrationConnectionAction,
  updateFeishuAgentBotPolicyAction,
} from "./feishu-actions";
import { FeishuAgentBotCredentialRotation } from "./feishu-agent-bot-credential-rotation";
import type {
  FeishuAvailableAgentItem,
  FeishuIntegrationSettingsItem,
  TestFeishuIntegrationConnectionResult,
} from "./feishu-types";

export function FeishuAgentBotsPanel({
  availableAgents,
  integrations,
  isPending,
  onUpdated,
  setFeedback,
  startTransition,
  tx,
}: {
  availableAgents: FeishuAvailableAgentItem[];
  integrations: FeishuIntegrationSettingsItem[];
  isPending: boolean;
  onUpdated: (integration: FeishuIntegrationSettingsItem) => void;
  setFeedback: (value: string | null) => void;
  startTransition: TransitionStartFunction;
  tx: SettingsTx;
}) {
  const agentBots = integrations.filter((integration) => Boolean(integration.agentId));
  const boundAgentIds = new Set(agentBots.filter((integration) => integration.status !== "disabled").map((integration) => integration.agentId));
  const firstUnboundAgent = availableAgents.find((agent) => !boundAgentIds.has(agent.id)) ?? availableAgents[0];
  const [agentId, setAgentId] = useState(firstUnboundAgent?.id ?? "");
  const [displayName, setDisplayName] = useState("");
  const [transportMode, setTransportMode] = useState<"websocket_worker" | "http_webhook">("websocket_worker");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [encryptKey, setEncryptKey] = useState("");
  const [tenantKey, setTenantKey] = useState("");
  const [connectionSummary, setConnectionSummary] = useState<TestFeishuIntegrationConnectionResult | null>(null);
  const [botAddedPolicy, setBotAddedPolicy] = useState<"auto_create_channel" | "pending_admin_review" | "disabled">("auto_create_channel");
  const [firstMessagePolicy, setFirstMessagePolicy] = useState<"auto_create_if_bot_mentioned" | "pending_admin_review" | "reply_with_setup_card" | "disabled">("auto_create_if_bot_mentioned");
  const [reviewStatusPolicy, setReviewStatusPolicy] = useState<"approved" | "pending_admin_review" | "needs_identity_binding">("approved");
  const [unboundUserMode, setUnboundUserMode] = useState<"ignore" | "reply_on_mention" | "reply_all" | "require_identity">("reply_on_mention");
  const [guestPermissionProfile, setGuestPermissionProfile] = useState<"none" | "channel_context_only" | "channel_readonly">("channel_context_only");
  const requiresVerificationToken = transportMode === "http_webhook";
  const canTestConnection = Boolean(appId.trim() && appSecret.trim());
  const canCreate = Boolean(agentId.trim() && appId.trim() && appSecret.trim() && (!requiresVerificationToken || verificationToken.trim()));
  const agentOptions = useMemo(() => availableAgents.map((agent) => ({
    ...agent,
    label: agent.remarkName ? `${agent.name} · ${agent.remarkName}` : agent.name,
  })), [availableAgents]);

  return (
    <section
      aria-label={tx("Agent 飞书 Bot", "Agent Feishu Bots")}
      className="page-panel"
      id="feishu-agent-bots"
    >
      <div className="panel-header">
        <div>
          <h3>{tx("Agent 飞书 Bot", "Agent Feishu Bots")}</h3>
          <p className="settings-panel-note">
            {tx("每个 Agent 绑定一个飞书 Bot；用户在飞书群里直接 @对应 Bot。", "Bind one Feishu bot per agent so people can mention that bot directly in Feishu chats.")}
          </p>
        </div>
      </div>

      <div className="feishu-integration-form feishu-agent-bot-form">
        {agentOptions.length > 0 ? (
          <label className="form-field">
            <span>{tx("Agent", "Agent")}</span>
            <select
              disabled={isPending}
              onChange={(event) => setAgentId(event.currentTarget.value)}
              value={agentId}
            >
              {agentOptions.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="form-field">
            <span>{tx("Agent", "Agent")}</span>
            <input
              disabled={isPending}
              onChange={(event) => setAgentId(event.currentTarget.value)}
              value={agentId}
            />
          </label>
        )}

        <label className="form-field">
          <span>{tx("App ID", "App ID")}</span>
          <input
            autoComplete="off"
            disabled={isPending}
            onChange={(event) => {
              setAppId(event.currentTarget.value);
              setConnectionSummary(null);
            }}
            value={appId}
          />
        </label>

        <label className="form-field">
          <span>{tx("App Secret", "App Secret")}</span>
          <input
            autoComplete="new-password"
            disabled={isPending}
            onChange={(event) => {
              setAppSecret(event.currentTarget.value);
              setConnectionSummary(null);
            }}
            type="password"
            value={appSecret}
          />
        </label>

        <details className="feishu-advanced-settings">
          <summary>
            <span>{tx("自定义高级功能", "Customize Advanced Options")}</span>
            <small>{tx("事件回调、Tenant Key、自动建群和未绑定用户策略", "Event callback, Tenant Key, auto-provisioning, and unbound user policy")}</small>
          </summary>

          <div className="feishu-advanced-settings__body">
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
                onChange={(event) => setTransportMode(event.currentTarget.value as "websocket_worker" | "http_webhook")}
                value={transportMode}
              >
                <option value="websocket_worker">{tx("长连接", "WebSocket worker")}</option>
                <option value="http_webhook">{tx("事件回调", "Event callback")}</option>
              </select>
            </label>

            <label className="form-field">
              <span>{tx("Tenant Key", "Tenant Key")}</span>
              <input
                autoComplete="off"
                disabled={isPending}
                onChange={(event) => setTenantKey(event.currentTarget.value)}
                value={tenantKey}
              />
            </label>

            <label className="form-field">
              <span>
                {requiresVerificationToken
                  ? tx("Verification Token（事件回调必填）", "Verification Token (required for callbacks)")
                  : tx("Verification Token", "Verification Token")}
              </span>
              <input
                autoComplete="new-password"
                disabled={isPending}
                onChange={(event) => setVerificationToken(event.currentTarget.value)}
                type="password"
                value={verificationToken}
              />
            </label>

            <label className="form-field">
              <span>{tx("Encrypt Key", "Encrypt Key")}</span>
              <input
                autoComplete="new-password"
                disabled={isPending}
                onChange={(event) => setEncryptKey(event.currentTarget.value)}
                type="password"
                value={encryptKey}
              />
            </label>

            <label className="form-field">
              <span>{tx("机器人进群", "Bot Added")}</span>
              <select
                disabled={isPending}
                onChange={(event) => setBotAddedPolicy(event.currentTarget.value as "auto_create_channel" | "pending_admin_review" | "disabled")}
                value={botAddedPolicy}
              >
                <option value="auto_create_channel">{tx("自动创建 Channel", "Auto-create channel")}</option>
                <option value="pending_admin_review">{tx("等待管理员审核", "Pending admin review")}</option>
                <option value="disabled">{tx("关闭", "Disabled")}</option>
              </select>
            </label>

            <label className="form-field">
              <span>{tx("首次消息", "First Message")}</span>
              <select
                disabled={isPending}
                onChange={(event) => setFirstMessagePolicy(event.currentTarget.value as "auto_create_if_bot_mentioned" | "pending_admin_review" | "reply_with_setup_card" | "disabled")}
                value={firstMessagePolicy}
              >
                <option value="auto_create_if_bot_mentioned">{tx("@Bot 时自动创建", "Auto-create when mentioned")}</option>
                <option value="pending_admin_review">{tx("等待管理员审核", "Pending admin review")}</option>
                <option value="reply_with_setup_card">{tx("回复设置卡片", "Reply with setup card")}</option>
                <option value="disabled">{tx("关闭", "Disabled")}</option>
              </select>
            </label>

            <label className="form-field">
              <span>{tx("建群审核状态", "Provision Review")}</span>
              <select
                disabled={isPending}
                onChange={(event) => setReviewStatusPolicy(event.currentTarget.value as "approved" | "pending_admin_review" | "needs_identity_binding")}
                value={reviewStatusPolicy}
              >
                <option value="approved">{tx("通过", "Approved")}</option>
                <option value="pending_admin_review">{tx("等待管理员审核", "Pending admin review")}</option>
                <option value="needs_identity_binding">{tx("需要身份绑定", "Needs identity binding")}</option>
              </select>
            </label>

            <label className="form-field">
              <span>{tx("未绑定用户", "Unbound Users")}</span>
              <select
                disabled={isPending}
                onChange={(event) => setUnboundUserMode(event.currentTarget.value as "ignore" | "reply_on_mention" | "reply_all" | "require_identity")}
                value={unboundUserMode}
              >
                <option value="reply_on_mention">{tx("@Bot 时回复", "Reply when mentioned")}</option>
                <option value="reply_all">{tx("全部回复", "Reply all")}</option>
                <option value="require_identity">{tx("要求绑定身份", "Require identity")}</option>
                <option value="ignore">{tx("忽略", "Ignore")}</option>
              </select>
            </label>

            <label className="form-field">
              <span>{tx("访客权限", "Guest Permission")}</span>
              <select
                disabled={isPending}
                onChange={(event) => setGuestPermissionProfile(event.currentTarget.value as "none" | "channel_context_only" | "channel_readonly")}
                value={guestPermissionProfile}
              >
                <option value="channel_context_only">{tx("当前 Channel 上下文", "Current channel context")}</option>
                <option value="channel_readonly">{tx("当前 Channel 只读", "Current channel readonly")}</option>
                <option value="none">{tx("无", "None")}</option>
              </select>
            </label>
          </div>
        </details>

        {connectionSummary ? (
          <FeishuAgentBotConnectionSummary summary={connectionSummary} tx={tx} />
        ) : null}

        <div className="feishu-integration-form__actions">
          <button
            className="action-button"
            disabled={isPending || !canTestConnection}
            onClick={() => {
              startTransition(async () => {
                try {
                  const summary = await testFeishuIntegrationConnectionAction({
                    appId,
                    appSecret,
                  });
                  setConnectionSummary(summary);
                  setFeedback(summary.status === "healthy"
                    ? tx("飞书 Bot 连接测试通过。", "Feishu bot connection test passed.")
                    : tx("飞书 Bot 连接测试需要检查。", "Feishu bot connection test needs attention."));
                } catch (error) {
                  setFeedback(translateSettingsActionError(error, tx));
                }
              });
            }}
            type="button"
          >
            {tx("测试连接", "Test Connection")}
          </button>
          <button
            className="primary-button"
            disabled={isPending || !canCreate}
            onClick={() => {
              startTransition(async () => {
                try {
                  const created = await createFeishuAgentBotBindingAction({
                    agentId,
                    displayName,
                    transportMode,
                    appId,
                    appSecret,
                    verificationToken,
                    encryptKey,
                    tenantKey,
                    channelAutoProvisioning: {
                      botAdded: botAddedPolicy,
                      firstMessage: firstMessagePolicy,
                      reviewStatus: reviewStatusPolicy,
                    },
                    externalGuestPolicy: {
                      unboundUserMode,
                      guestPermissionProfile,
                      requireIdentityFor: [
                        "writes",
                        "approvals",
                        "private_resources",
                        "runtime_sensitive_tools",
                      ],
                    },
                  });
                  setAppSecret("");
                  setVerificationToken("");
                  setEncryptKey("");
                  setConnectionSummary(null);
                  setFeedback(tx("Agent 飞书 Bot 已绑定。", "Agent Feishu bot bound."));
                  onUpdated(created);
                } catch (error) {
                  setFeedback(translateSettingsActionError(error, tx));
                }
              });
            }}
            type="button"
          >
            {tx("绑定 Bot", "Bind Bot")}
          </button>
        </div>
      </div>

      <div className="feishu-binding-list">
        {agentBots.length === 0 ? (
          <p className="settings-panel-note">{tx("暂无 Agent 飞书 Bot。", "No agent Feishu bots yet.")}</p>
        ) : agentBots.map((integration) => (
            <article className="feishu-binding-card" key={integration.id}>
              <div>
                <strong>{integration.displayName}</strong>
                <div className="feishu-binding-card__meta">
                  <span>{tx("Agent", "Agent")}: {integration.agentId}</span>
                  <span>{tx("连接方式", "Transport")}: {integration.transportMode}</span>
                  <span>{tx("状态", "Status")}: {integration.status}</span>
                  {integration.appId ? <span>App ID: {integration.appId}</span> : null}
                </div>
                {integration.externalGuestPolicy || integration.channelAutoProvisioning ? (
                  <div
                    aria-label={tx("飞书 Bot 治理策略", "Feishu Bot Governance Policy")}
                    className="feishu-binding-card__meta"
                  >
                    {integration.externalGuestPolicy ? (
                      <>
                        <span>
                          {tx("未绑定用户", "Unbound Users")}: {translateUnboundUserMode(
                            integration.externalGuestPolicy.unboundUserMode,
                            tx,
                          )}
                        </span>
                        <span>
                          {tx("访客权限", "Guest Permission")}: {translateGuestPermissionProfile(
                            integration.externalGuestPolicy.guestPermissionProfile,
                            tx,
                          )}
                        </span>
                        <span>
                          {tx("需绑定身份", "Identity Required")}: {
                            integration.externalGuestPolicy.requireIdentityFor.length > 0
                              ? integration.externalGuestPolicy.requireIdentityFor.map((item) =>
                                translateIdentityRequirement(item, tx)
                              ).join(", ")
                              : tx("无", "None")
                          }
                        </span>
                      </>
                    ) : null}
                    {integration.channelAutoProvisioning ? (
                      <>
                        <span>
                          {tx("机器人进群", "Bot Added")}: {translateBotAddedPolicy(
                            integration.channelAutoProvisioning.botAdded,
                            tx,
                          )}
                        </span>
                        <span>
                          {tx("首次消息", "First Message")}: {translateFirstMessagePolicy(
                            integration.channelAutoProvisioning.firstMessage,
                            tx,
                          )}
                        </span>
                        <span>
                          {tx("建群审核", "Provision Review")}: {translateProvisionReviewStatus(
                            integration.channelAutoProvisioning.reviewStatus,
                            tx,
                          )}
                        </span>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <FeishuAgentBotPolicyEditor
                integration={integration}
                isPending={isPending}
                onUpdated={onUpdated}
                setFeedback={setFeedback}
                startTransition={startTransition}
                tx={tx}
              />
              <FeishuAgentBotCredentialRotation
                integration={integration}
                isPending={isPending}
                onUpdated={onUpdated}
                setFeedback={setFeedback}
                startTransition={startTransition}
                tx={tx}
              />
              <div className="feishu-integration-form__actions">
                <button
                  className="danger-button"
                  disabled={isPending || integration.status === "disabled"}
                  onClick={() => {
                    startTransition(async () => {
                      try {
                        const updated = await disableFeishuAgentBotBindingAction(integration.id);
                        setFeedback(tx("Agent 飞书 Bot 已停用。", "Agent Feishu bot disabled."));
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
              </div>
            </article>
        ))}
      </div>
    </section>
  );
}

function FeishuAgentBotConnectionSummary({
  summary,
  tx,
}: {
  summary: TestFeishuIntegrationConnectionResult;
  tx: SettingsTx;
}) {
  return (
    <div aria-label={tx("飞书 Bot 连接测试摘要", "Feishu bot connection test summary")} className="feishu-connection-summary">
      <div>
        <strong>{tx("连接测试", "Connection Test")}</strong>
        <span>{translateHealthStatus(summary.status, tx)}</span>
        <span>{tx("检查时间", "Checked")}: {summary.checkedAt}</span>
      </div>
      <p>
        {summary.botAppName || summary.botOpenId
          ? `${tx("Bot", "Bot")}: ${summary.botAppName ?? tx("未命名", "Unnamed")} ${summary.botOpenId ? `(${summary.botOpenId})` : ""}`
          : tx("未读取到 Bot 信息。", "No bot information returned.")}
      </p>
      {summary.errorMessage ? (
        <p>{tx("错误", "Error")}: {summary.errorMessage}</p>
      ) : null}
      {summary.errorCode ? (
        <p>{tx("错误码", "Error Code")}: <code>{summary.errorCode}</code></p>
      ) : null}
      <div>
        <strong>{tx("权限检查", "Scope Check")}</strong>
        <span>{translateScopeReadiness(summary.scopeReadiness, tx)}</span>
      </div>
      {summary.scopeErrorMessage ? (
        <p>{tx("权限检查错误", "Scope check error")}: {summary.scopeErrorMessage}</p>
      ) : null}
      <ul>
        {(summary.missingScopes && summary.missingScopes.length > 0
          ? summary.missingScopes
          : summary.requiredScopes).map((scope) => (
          <li key={scope}><code>{scope}</code></li>
        ))}
      </ul>
    </div>
  );
}

function translateHealthStatus(
  status: TestFeishuIntegrationConnectionResult["status"],
  tx: SettingsTx,
): string {
  switch (status) {
    case "healthy":
      return tx("正常", "Healthy");
    case "degraded":
      return tx("降级", "Degraded");
    case "error":
      return tx("异常", "Error");
    case "unknown":
      return tx("未知", "Unknown");
  }
}

function translateScopeReadiness(
  readiness: TestFeishuIntegrationConnectionResult["scopeReadiness"],
  tx: SettingsTx,
): string {
  switch (readiness) {
    case "verified":
      return tx("已自动确认所需权限。", "Required scopes verified.");
    case "missing_required_scopes":
      return tx("缺少以下必需权限。", "Missing required scopes.");
    case "unauthorized":
      return tx("飞书拒绝读取应用权限，请检查应用授权和权限配置。", "Feishu rejected the app scope check. Review app authorization and scopes.");
    case "manual_review_required":
      return tx("请在飞书开放平台确认已启用以下权限。", "Confirm these scopes are enabled in the Feishu developer console.");
    case "unavailable":
      return tx("连接失败，暂不能确认权限。", "Connection failed; scopes cannot be confirmed yet.");
  }
}

const FEISHU_AGENT_BOT_IDENTITY_REQUIREMENTS = [
  "writes",
  "approvals",
  "private_resources",
  "runtime_sensitive_tools",
] as const;

export function FeishuAgentBotPolicyEditor({
  integration,
  isPending,
  onUpdated,
  setFeedback,
  startTransition,
  tx,
}: {
  integration: FeishuIntegrationSettingsItem;
  isPending: boolean;
  onUpdated: (integration: FeishuIntegrationSettingsItem) => void;
  setFeedback: (value: string | null) => void;
  startTransition: TransitionStartFunction;
  tx: SettingsTx;
}) {
  const [botAddedPolicy, setBotAddedPolicy] = useState<"auto_create_channel" | "pending_admin_review" | "disabled">(
    integration.channelAutoProvisioning?.botAdded ?? "auto_create_channel",
  );
  const [firstMessagePolicy, setFirstMessagePolicy] = useState<"auto_create_if_bot_mentioned" | "pending_admin_review" | "reply_with_setup_card" | "disabled">(
    integration.channelAutoProvisioning?.firstMessage ?? "auto_create_if_bot_mentioned",
  );
  const [reviewStatusPolicy, setReviewStatusPolicy] = useState<"approved" | "pending_admin_review" | "needs_identity_binding">(
    integration.channelAutoProvisioning?.reviewStatus ?? "approved",
  );
  const [unboundUserMode, setUnboundUserMode] = useState<"ignore" | "reply_on_mention" | "reply_all" | "require_identity">(
    integration.externalGuestPolicy?.unboundUserMode ?? "reply_on_mention",
  );
  const [guestPermissionProfile, setGuestPermissionProfile] = useState<"none" | "channel_context_only" | "channel_readonly">(
    integration.externalGuestPolicy?.guestPermissionProfile ?? "channel_context_only",
  );
  const [requireIdentityFor, setRequireIdentityFor] = useState<string[]>(
    integration.externalGuestPolicy?.requireIdentityFor?.length
      ? integration.externalGuestPolicy.requireIdentityFor
      : [...FEISHU_AGENT_BOT_IDENTITY_REQUIREMENTS],
  );

  const toggleIdentityRequirement = (value: string, checked: boolean) => {
    setRequireIdentityFor((current) => {
      if (checked) {
        return current.includes(value) ? current : [...current, value];
      }
      return current.filter((item) => item !== value);
    });
  };

  const applyPolicyState = (updated: FeishuIntegrationSettingsItem) => {
    setBotAddedPolicy(updated.channelAutoProvisioning?.botAdded ?? "auto_create_channel");
    setFirstMessagePolicy(updated.channelAutoProvisioning?.firstMessage ?? "auto_create_if_bot_mentioned");
    setReviewStatusPolicy(updated.channelAutoProvisioning?.reviewStatus ?? "approved");
    setUnboundUserMode(updated.externalGuestPolicy?.unboundUserMode ?? "reply_on_mention");
    setGuestPermissionProfile(updated.externalGuestPolicy?.guestPermissionProfile ?? "channel_context_only");
    setRequireIdentityFor(updated.externalGuestPolicy?.requireIdentityFor?.length
      ? updated.externalGuestPolicy.requireIdentityFor
      : [...FEISHU_AGENT_BOT_IDENTITY_REQUIREMENTS]);
  };

  return (
    <details className="feishu-agent-bot-policy-editor">
      <summary>
        <span>{tx("调整治理策略", "Adjust Governance Policy")}</span>
        <small>{tx("自动建群、未绑定用户和高权限动作", "Auto-provisioning, unbound users, and privileged actions")}</small>
      </summary>

      <div className="feishu-agent-bot-policy-editor__body">
        <label className="form-field">
          <span>{tx("机器人进群", "Bot Added")}</span>
          <select
            disabled={isPending || integration.status === "disabled"}
            onChange={(event) => setBotAddedPolicy(event.currentTarget.value as "auto_create_channel" | "pending_admin_review" | "disabled")}
            value={botAddedPolicy}
          >
            <option value="auto_create_channel">{tx("自动创建 Channel", "Auto-create channel")}</option>
            <option value="pending_admin_review">{tx("等待管理员审核", "Pending admin review")}</option>
            <option value="disabled">{tx("关闭", "Disabled")}</option>
          </select>
        </label>

        <label className="form-field">
          <span>{tx("首次消息", "First Message")}</span>
          <select
            disabled={isPending || integration.status === "disabled"}
            onChange={(event) => setFirstMessagePolicy(event.currentTarget.value as "auto_create_if_bot_mentioned" | "pending_admin_review" | "reply_with_setup_card" | "disabled")}
            value={firstMessagePolicy}
          >
            <option value="auto_create_if_bot_mentioned">{tx("@Bot 时自动创建", "Auto-create when mentioned")}</option>
            <option value="pending_admin_review">{tx("等待管理员审核", "Pending admin review")}</option>
            <option value="reply_with_setup_card">{tx("回复设置卡片", "Reply with setup card")}</option>
            <option value="disabled">{tx("关闭", "Disabled")}</option>
          </select>
        </label>

        <label className="form-field">
          <span>{tx("建群审核状态", "Provision Review")}</span>
          <select
            disabled={isPending || integration.status === "disabled"}
            onChange={(event) => setReviewStatusPolicy(event.currentTarget.value as "approved" | "pending_admin_review" | "needs_identity_binding")}
            value={reviewStatusPolicy}
          >
            <option value="approved">{tx("通过", "Approved")}</option>
            <option value="pending_admin_review">{tx("等待管理员审核", "Pending admin review")}</option>
            <option value="needs_identity_binding">{tx("需要身份绑定", "Needs identity binding")}</option>
          </select>
        </label>

        <label className="form-field">
          <span>{tx("未绑定用户", "Unbound Users")}</span>
          <select
            disabled={isPending || integration.status === "disabled"}
            onChange={(event) => setUnboundUserMode(event.currentTarget.value as "ignore" | "reply_on_mention" | "reply_all" | "require_identity")}
            value={unboundUserMode}
          >
            <option value="reply_on_mention">{tx("@Bot 时回复", "Reply when mentioned")}</option>
            <option value="reply_all">{tx("全部回复", "Reply all")}</option>
            <option value="require_identity">{tx("要求绑定身份", "Require identity")}</option>
            <option value="ignore">{tx("忽略", "Ignore")}</option>
          </select>
        </label>

        <label className="form-field">
          <span>{tx("访客权限", "Guest Permission")}</span>
          <select
            disabled={isPending || integration.status === "disabled"}
            onChange={(event) => setGuestPermissionProfile(event.currentTarget.value as "none" | "channel_context_only" | "channel_readonly")}
            value={guestPermissionProfile}
          >
            <option value="channel_context_only">{tx("当前 Channel 上下文", "Current channel context")}</option>
            <option value="channel_readonly">{tx("当前 Channel 只读", "Current channel readonly")}</option>
            <option value="none">{tx("无", "None")}</option>
          </select>
        </label>

        <fieldset className="feishu-agent-bot-policy-editor__checks">
          <legend>{tx("需绑定身份", "Identity Required")}</legend>
          {FEISHU_AGENT_BOT_IDENTITY_REQUIREMENTS.map((value) => (
            <label key={value}>
              <input
                checked={requireIdentityFor.includes(value)}
                disabled={isPending || integration.status === "disabled"}
                onChange={(event) => toggleIdentityRequirement(value, event.currentTarget.checked)}
                type="checkbox"
              />
              <span>{translateIdentityRequirement(value, tx)}</span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className="feishu-agent-bot-policy-editor__actions">
        <button
          className="action-button"
          disabled={isPending || integration.status === "disabled"}
          onClick={() => {
            startTransition(async () => {
              try {
                const updated = await updateFeishuAgentBotPolicyAction({
                  integrationId: integration.id,
                  channelAutoProvisioning: {
                    botAdded: botAddedPolicy,
                    firstMessage: firstMessagePolicy,
                    reviewStatus: reviewStatusPolicy,
                  },
                  externalGuestPolicy: {
                    unboundUserMode,
                    guestPermissionProfile,
                    requireIdentityFor,
                  },
                });
                applyPolicyState(updated);
                setFeedback(tx("Agent 飞书 Bot 治理策略已更新。", "Agent Feishu bot governance policy updated."));
                onUpdated(updated);
              } catch (error) {
                setFeedback(translateSettingsActionError(error, tx));
              }
            });
          }}
          type="button"
        >
          {tx("保存策略", "Save Policy")}
        </button>
      </div>
    </details>
  );
}

function translateUnboundUserMode(
  value: NonNullable<FeishuIntegrationSettingsItem["externalGuestPolicy"]>["unboundUserMode"] | undefined,
  tx: SettingsTx,
) {
  switch (value) {
    case "ignore":
      return tx("忽略", "Ignore");
    case "reply_all":
      return tx("全部回复", "Reply all");
    case "require_identity":
      return tx("要求绑定身份", "Require identity");
    case "reply_on_mention":
    default:
      return tx("@Bot 时回复", "Reply when mentioned");
  }
}

function translateGuestPermissionProfile(
  value: NonNullable<FeishuIntegrationSettingsItem["externalGuestPolicy"]>["guestPermissionProfile"] | undefined,
  tx: SettingsTx,
) {
  switch (value) {
    case "none":
      return tx("无", "None");
    case "channel_readonly":
      return tx("当前 Channel 只读", "Current channel readonly");
    case "channel_context_only":
    default:
      return tx("当前 Channel 上下文", "Current channel context");
  }
}

function translateIdentityRequirement(value: string, tx: SettingsTx) {
  switch (value) {
    case "writes":
      return tx("写入", "Writes");
    case "approvals":
      return tx("审批", "Approvals");
    case "private_resources":
      return tx("私有资源", "Private resources");
    case "runtime_sensitive_tools":
      return tx("高风险工具", "Sensitive tools");
    default:
      return value;
  }
}

function translateBotAddedPolicy(
  value: NonNullable<FeishuIntegrationSettingsItem["channelAutoProvisioning"]>["botAdded"] | undefined,
  tx: SettingsTx,
) {
  switch (value) {
    case "pending_admin_review":
      return tx("等待管理员审核", "Pending admin review");
    case "disabled":
      return tx("关闭", "Disabled");
    case "auto_create_channel":
    default:
      return tx("自动创建 Channel", "Auto-create channel");
  }
}

function translateFirstMessagePolicy(
  value: NonNullable<FeishuIntegrationSettingsItem["channelAutoProvisioning"]>["firstMessage"] | undefined,
  tx: SettingsTx,
) {
  switch (value) {
    case "pending_admin_review":
      return tx("等待管理员审核", "Pending admin review");
    case "reply_with_setup_card":
      return tx("回复设置卡片", "Reply with setup card");
    case "disabled":
      return tx("关闭", "Disabled");
    case "auto_create_if_bot_mentioned":
    default:
      return tx("@Bot 时自动创建", "Auto-create when mentioned");
  }
}

function translateProvisionReviewStatus(
  value: NonNullable<FeishuIntegrationSettingsItem["channelAutoProvisioning"]>["reviewStatus"] | undefined,
  tx: SettingsTx,
) {
  switch (value) {
    case "pending_admin_review":
      return tx("等待管理员审核", "Pending admin review");
    case "needs_identity_binding":
      return tx("需要身份绑定", "Needs identity binding");
    case "approved":
    default:
      return tx("通过", "Approved");
  }
}
