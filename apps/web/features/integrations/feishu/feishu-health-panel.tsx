"use client";

import { type FormEvent, type TransitionStartFunction, useState } from "react";
import type { SettingsTx } from "@/features/settings/settings-types";
import { translateSettingsActionError } from "@/features/settings/settings-utils";
import { EmptyState } from "@/shared/ui/empty-state";
import {
  checkFeishuIntegrationHealthAction,
  deleteFeishuIntegrationAction,
  disableFeishuIntegrationAction,
  resumeFeishuIntegrationAction,
  rotateFeishuIntegrationSecretAction,
} from "./feishu-actions";
import { translateFeishuOpenPlatformSetupStep } from "./feishu-open-platform-labels";
import type {
  FeishuIntegrationEvidenceGate,
  FeishuIntegrationSettingsItem,
  FeishuIntegrationSetupCheck,
} from "./feishu-types";

export function FeishuHealthPanel({
  integrations,
  isPending,
  onDeleted,
  onUpdated,
  setFeedback,
  startTransition,
  tx,
}: {
  integrations: FeishuIntegrationSettingsItem[];
  isPending: boolean;
  onDeleted: (integrationId: string) => void;
  onUpdated: (integration: FeishuIntegrationSettingsItem) => void;
  setFeedback: (value: string | null) => void;
  startTransition: TransitionStartFunction;
  tx: SettingsTx;
}) {
  return (
    <section className="page-panel">
      <div className="panel-header">
        <div>
          <h3>{tx("飞书应用", "Feishu Apps")}</h3>
          <p className="settings-panel-note">
            {tx("每个应用独立保存凭据、回调地址和绑定状态。", "Each app keeps separate credentials, callback URL, and binding state.")}
          </p>
        </div>
      </div>

      <div className="feishu-integration-list">
        {integrations.length > 0 ? (
          integrations.map((integration) => {
            const unboundUserEventCount = countInboundEventsByReason(integration, "external_user_unbound");
            const unboundChannelEventCount = countInboundEventsByReason(integration, "external_channel_unbound");
            return (
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
                  <span>{tx("频道绑定", "Channels")}: {integration.channelBindingCount}</span>
                  <span>{tx("资源绑定", "Resources")}: {integration.resourceBindingCount}</span>
                  <span>{tx("用户绑定", "Users")}: {integration.userBindingCount}</span>
                  <span>{tx("凭据", "Credentials")}: {hasRequiredFeishuCredentials(integration) ? tx("已保存", "Stored") : tx("不完整", "Incomplete")}</span>
                  <span>{tx("健康状态", "Health")}: {translateHealthStatus(integration.lastHealthStatus, tx)}</span>
                  <span>{tx("上次检查", "Last Check")}: {integration.lastHealthCheckedAt ?? tx("未检查", "Not checked")}</span>
                </div>

                {integration.lastError ? (
                  <p className="settings-panel-note">{integration.lastError}</p>
                ) : null}

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
                          {item.nextAttemptAt ? (
                            <span>{tx("下次重试", "Next Retry")}: {item.nextAttemptAt}</span>
                          ) : null}
                          {item.agentId ? (
                            <span>{tx("Agent", "Agent")}: {item.agentId}</span>
                          ) : null}
                          {item.botBindingId ? (
                            <span>{tx("Bot 绑定", "Bot binding")}: {item.botBindingId}</span>
                          ) : null}
                          <span>{tx("飞书会话", "Feishu Chat")}: {item.targetExternalChatReference}</span>
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
                      <span>{tx("未绑定用户", "Unbound Users")}: {unboundUserEventCount}</span>
                      <span>{tx("未绑定群", "Unbound Chats")}: {unboundChannelEventCount}</span>
                    </div>
                    {integration.recentInboundEvents.map((item) => (
                      <div className="feishu-inbound-event" key={item.id}>
                        <div>
                          <span className={`status-chip ${resolveInboundEventStatusClass(item.status)}`}>
                            {translateInboundEventStatus(item.status, tx)}
                          </span>
                          <span>{item.eventType}</span>
                          <span>{item.externalEventId}</span>
                        </div>
                        <p>
                          {item.errorMessage
                            ? `${tx("原因", "Reason")}: ${item.errorMessage}`
                            : tx("无失败原因", "No failure reason")}
                        </p>
                        {item.bindingSuggestion ? (
                          <FeishuInboundBindingSuggestion
                            suggestion={item.bindingSuggestion}
                            setFeedback={setFeedback}
                            tx={tx}
                          />
                        ) : null}
                        <small>
                          {tx("接收", "Received")}: {item.receivedAt}
                          {item.processedAt ? ` · ${tx("处理", "Processed")}: ${item.processedAt}` : ""}
                        </small>
                      </div>
                    ))}
                  </div>
                ) : null}

                <label className="form-field">
                  <span>{tx("事件回调地址", "Event Callback URL")}</span>
                  <code className="feishu-callback-url">{integration.callbackUrl}</code>
                </label>

                {integration.setupGuide ? (
                  <FeishuSetupGuide
                    integration={integration}
                    setFeedback={setFeedback}
                    tx={tx}
                  />
                ) : null}

                <div className="feishu-integration-card__actions">
                  <button
                    className="action-button"
                    onClick={() => {
                      copyToClipboard(integration.callbackUrl);
                      setFeedback(tx("回调地址已复制。", "Callback URL copied."));
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
                          const updated = await checkFeishuIntegrationHealthAction(integration.id);
                          setFeedback(updated.lastHealthStatus === "healthy"
                            ? tx("飞书连接检查通过。", "Feishu health check passed.")
                            : tx("飞书连接检查失败。", "Feishu health check failed."));
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
                            const updated = await resumeFeishuIntegrationAction(integration.id);
                            setFeedback(tx("飞书集成已启用。", "Feishu integration resumed."));
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
                            const updated = await disableFeishuIntegrationAction(integration.id);
                            setFeedback(tx("飞书集成已停用。", "Feishu integration disabled."));
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
                      startTransition(async () => {
                        try {
                          const deleted = await deleteFeishuIntegrationAction(integration.id);
                          setFeedback(tx("飞书集成已删除。", "Feishu integration deleted."));
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

                <FeishuCredentialRotationForm
                  integration={integration}
                  isPending={isPending}
                  onUpdated={onUpdated}
                  setFeedback={setFeedback}
                  startTransition={startTransition}
                  tx={tx}
                />
              </article>
            );
          })
        ) : (
          <EmptyState title={tx("暂无飞书集成。", "No Feishu integrations yet.")} />
        )}
      </div>
    </section>
  );
}

function FeishuInboundBindingSuggestion({
  suggestion,
  setFeedback,
  tx,
}: {
  suggestion: NonNullable<FeishuIntegrationSettingsItem["recentInboundEvents"][number]["bindingSuggestion"]>;
  setFeedback: (value: string | null) => void;
  tx: SettingsTx;
}) {
  if (suggestion.kind === "channel") {
    return (
      <div className="feishu-inbound-binding-suggestion">
        <span>{tx("建议绑定群", "Suggested Chat")}</span>
        <code>{suggestion.externalChatReference}</code>
        <span className="status-chip status-chip--warning">{tx("ID 已隐藏", "ID hidden")}</span>
        <button
          className="action-button"
          onClick={() => {
            copyToClipboard(suggestion.externalChatReference);
            setFeedback(tx("飞书会话安全引用已复制。", "Feishu chat reference copied."));
          }}
          type="button"
        >
          {tx("复制引用", "Copy Ref")}
        </button>
      </div>
    );
  }

  return (
    <div className="feishu-inbound-binding-suggestion">
      <span>{tx("建议绑定用户", "Suggested User")}</span>
      <code>{suggestion.externalUserReference}</code>
      {suggestion.externalUnionReference ? <code>{suggestion.externalUnionReference}</code> : null}
      {suggestion.externalOpenReference ? <code>{suggestion.externalOpenReference}</code> : null}
      <span className="status-chip status-chip--warning">{tx("ID 已隐藏", "ID hidden")}</span>
      <button
        className="action-button"
        onClick={() => {
          copyToClipboard(suggestion.externalUserReference);
          setFeedback(tx("飞书用户安全引用已复制。", "Feishu user reference copied."));
        }}
        type="button"
      >
        {tx("复制引用", "Copy Ref")}
      </button>
    </div>
  );
}

function hasRequiredFeishuCredentials(
  integration: Pick<FeishuIntegrationSettingsItem, "transportMode" | "hasAppSecret" | "hasVerificationToken">,
): boolean {
  return integration.hasAppSecret &&
    (integration.transportMode !== "http_webhook" || integration.hasVerificationToken);
}

function FeishuSetupGuide({
  integration,
  setFeedback,
  tx,
}: {
  integration: FeishuIntegrationSettingsItem;
  setFeedback: (value: string | null) => void;
  tx: SettingsTx;
}) {
  const guide = integration.setupGuide;
  if (!guide) {
    return null;
  }
  const commands = [
    {
      key: "health-check",
      label: tx("健康检查", "Health Check"),
      value: guide.commands.healthCheck,
    },
    {
      key: "bot-readiness",
      label: tx("Bot 前置检查", "Bot Readiness"),
      value: guide.commands.botReadiness,
    },
    ...(guide.commands.bindSecondAgentBot
      ? [{
        key: "bind-second-agent-bot",
        label: tx("绑定第二个 Agent Bot", "Bind Second Agent Bot"),
        value: guide.commands.bindSecondAgentBot,
      }]
      : []),
    {
      key: "data-plane-readiness",
      label: tx("数据面前置检查", "Data Plane Readiness"),
      value: guide.commands.dataPlaneReadiness,
    },
    {
      key: "worker-readiness",
      label: tx("长连接前置检查", "Worker Readiness"),
      value: guide.commands.workerReadiness,
    },
    ...(guide.commands.autoProvisionPolicy
      ? [{
        key: "auto-provision-policy",
        label: tx("治理策略命令", "Governance Policy Command"),
        value: guide.commands.autoProvisionPolicy,
      }]
      : []),
    ...(guide.commands.channelBindings
      ? [{
        key: "channel-bindings",
        label: tx("群聊映射命令", "Channel Bindings Command"),
        value: guide.commands.channelBindings,
      }]
      : []),
    {
      key: "smoke-env",
      label: tx("生成联调环境", "Smoke Env"),
      value: guide.commands.smokeEnv,
    },
    {
      key: "check-env",
      label: tx("检查联调环境", "Check Env"),
      value: guide.commands.checkEnv,
    },
    {
      key: "strict-live-smoke",
      label: tx("严格实测", "Strict Live Smoke"),
      value: guide.commands.strictLiveSmoke,
    },
    {
      key: "verify-openapi-evidence",
      label: tx("校验 OpenAPI 证据", "Verify OpenAPI Evidence"),
      value: guide.commands.verifyOpenApiEvidence,
    },
    {
      key: "smoke-plan",
      label: tx("联调计划", "Smoke Plan"),
      value: guide.commands.smokePlan,
    },
    {
      key: "evidence",
      label: tx("证据校验", "Evidence"),
      value: guide.commands.evidence,
    },
  ];

  return (
    <div className="feishu-setup-guide" aria-label={tx("飞书联调清单", "Feishu integration checklist")}>
      <div className="feishu-setup-guide__grid">
        <section>
          <strong>{tx("凭据", "Credentials")}</strong>
          <ul>
            <li>
              <span>{tx("开放平台", "Developer Console")}</span>:{" "}
              <a href={guide.developerConsoleUrl} rel="noreferrer" target="_blank">{guide.developerConsoleUrl}</a>
            </li>
            {guide.requiredCredentialFields.map((field) => (
              <li key={field}><code>{field}</code></li>
            ))}
          </ul>
        </section>
        {guide.openPlatformSetupSteps.length > 0 ? (
          <section>
            <strong>{tx("配置步骤", "Setup Steps")}</strong>
            <ol>
              {guide.openPlatformSetupSteps.map((step) => (
                <li key={step.id}>
                  <span>{translateFeishuOpenPlatformSetupStep(step.id, tx)}</span>
                  <a href={step.consoleUrl} rel="noreferrer" target="_blank">{tx("打开", "Open")}</a>
                  <small>{step.required.join(", ")}</small>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        <section>
          <strong>{tx("事件", "Events")}</strong>
          <ul>
            <li>
              <span>{tx("回调路径", "Callback Path")}</span>: <code>{guide.eventCallbackPath}</code>
            </li>
            {guide.requiredEvents.map((eventName) => (
              <li key={eventName}><code>{eventName}</code></li>
            ))}
          </ul>
        </section>
        <section>
          <strong>{tx("权限", "Scopes")}</strong>
          <ul>
            {guide.requiredScopes.map((scope) => (
              <li key={scope}><code>{scope}</code></li>
            ))}
          </ul>
        </section>
      </div>

      {guide.checks.length > 0 ? (
        <div className="feishu-setup-checks" aria-label={tx("飞书联调状态", "Feishu smoke readiness")}>
          {guide.checks.map((check) => (
            <div className="feishu-setup-check" key={check.key}>
              <span className={`status-chip ${resolveSetupCheckStatusClass(check.status)}`}>
                {translateSetupCheckStatus(check.status, tx)}
              </span>
              <strong>{translateSetupCheckLabel(check.key, tx)}</strong>
              <small>{formatSetupCheckDetail(check, tx)}</small>
            </div>
          ))}
        </div>
      ) : null}

      {guide.evidenceGates.length > 0 ? (
        <div className="feishu-setup-checks" aria-label={tx("飞书证据门禁", "Feishu evidence gates")}>
          {guide.evidenceGates.map((gate) => (
            <div className="feishu-setup-check" key={gate.key}>
              <span className="status-chip status-chip--neutral">{tx("要求", "Required")}</span>
              <strong>{translateEvidenceGateLabel(gate.key, tx)}</strong>
              <small><code>{gate.required}</code></small>
            </div>
          ))}
        </div>
      ) : null}

      <div className="feishu-setup-command-list">
        {commands.map((command) => (
          <div className="feishu-setup-command" key={command.key}>
            <span>{command.label}</span>
            <code>{command.value}</code>
            <button
              className="action-button"
              onClick={() => {
                copyToClipboard(command.value);
                setFeedback(tx("命令已复制。", "Command copied."));
              }}
              type="button"
            >
              {tx("复制", "Copy")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function copyToClipboard(value: string): void {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    void navigator.clipboard.writeText(value);
  }
}

function FeishuCredentialRotationForm({
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
  const [appId, setAppId] = useState(integration.appId ?? "");
  const [tenantKey, setTenantKey] = useState(integration.tenantKey ?? "");
  const [appSecret, setAppSecret] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [encryptKey, setEncryptKey] = useState("");
  const requiresVerificationToken = integration.transportMode === "http_webhook";
  const canSubmit = Boolean(appId.trim() && appSecret.trim() && (!requiresVerificationToken || verificationToken.trim()));

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    startTransition(async () => {
      try {
        const updated = await rotateFeishuIntegrationSecretAction({
          integrationId: integration.id,
          appId,
          appSecret,
          verificationToken,
          encryptKey,
          tenantKey,
        });
        setAppSecret("");
        setVerificationToken("");
        setEncryptKey("");
        setFeedback(tx("飞书凭据已轮换，请重新检查连接。", "Feishu credentials rotated. Check the connection again."));
        onUpdated(updated);
      } catch (error) {
        setFeedback(translateSettingsActionError(error, tx));
      }
    });
  }

  return (
    <form className="feishu-credential-form" onSubmit={handleSubmit}>
      <div className="feishu-credential-form__header">
        <strong>{tx("轮换凭据", "Rotate Credentials")}</strong>
        <span>{tx("保存后不会回显密钥。", "Secrets are not shown after saving.")}</span>
      </div>
      <label className="form-field">
        <span>{tx("App ID", "App ID")}</span>
        <input
          autoComplete="off"
          disabled={isPending}
          onChange={(event) => setAppId(event.currentTarget.value)}
          value={appId}
        />
      </label>
      <label className="form-field">
        <span>{tx("新 App Secret", "New App Secret")}</span>
        <input
          autoComplete="new-password"
          disabled={isPending}
          onChange={(event) => setAppSecret(event.currentTarget.value)}
          type="password"
          value={appSecret}
        />
      </label>
      <details className="feishu-advanced-settings" open={requiresVerificationToken}>
        <summary>
          <span>{tx("自定义高级功能", "Customize Advanced Options")}</span>
          <small>{tx("租户锁定、事件回调 Token 和事件加密", "Tenant lock, callback token, and encrypted events")}</small>
        </summary>
        <div className="feishu-advanced-settings__body">
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
                ? tx("新 Verification Token（事件回调必填）", "New Verification Token (required for callbacks)")
                : tx("新 Verification Token", "New Verification Token")}
            </span>
            <input
              aria-label={tx("新 Verification Token", "New Verification Token")}
              autoComplete="new-password"
              disabled={isPending}
              onChange={(event) => setVerificationToken(event.currentTarget.value)}
              type="password"
              value={verificationToken}
            />
          </label>
          <label className="form-field">
            <span>{tx("新 Encrypt Key", "New Encrypt Key")}</span>
            <input
              autoComplete="new-password"
              disabled={isPending}
              onChange={(event) => setEncryptKey(event.currentTarget.value)}
              type="password"
              value={encryptKey}
            />
          </label>
        </div>
      </details>
      <button
        className="action-button"
        disabled={isPending || !canSubmit}
        type="submit"
      >
        {tx("保存新凭据", "Save New Credentials")}
      </button>
    </form>
  );
}

function translateHealthStatus(status: FeishuIntegrationSettingsItem["lastHealthStatus"], tx: SettingsTx): string {
  switch (status) {
    case "healthy":
      return tx("正常", "OK");
    case "degraded":
      return tx("降级", "Degraded");
    case "error":
      return tx("异常", "Error");
    case "unknown":
    case undefined:
      return tx("未知", "Unknown");
  }
}

function translateIntegrationStatus(status: FeishuIntegrationSettingsItem["status"], tx: SettingsTx): string {
  switch (status) {
    case "active":
      return tx("启用", "Active");
    case "disabled":
      return tx("停用", "Disabled");
    case "error":
      return tx("异常", "Error");
  }
}

function translateTransportMode(mode: FeishuIntegrationSettingsItem["transportMode"], tx: SettingsTx): string {
  return mode === "http_webhook" ? tx("事件回调", "Event callback") : tx("长连接", "WebSocket worker");
}

function translateOutboxStatus(
  status: FeishuIntegrationSettingsItem["recentOutboxFailures"][number]["status"],
  tx: SettingsTx,
): string {
  switch (status) {
    case "failed":
      return tx("失败", "Failed");
    case "pending":
      return tx("待重试", "Retry Pending");
    case "locked":
      return tx("发送中", "Sending");
    case "sent":
      return tx("已发送", "Sent");
    case "cancelled":
      return tx("已取消", "Cancelled");
  }
}

function translateInboundEventStatus(
  status: FeishuIntegrationSettingsItem["recentInboundEvents"][number]["status"],
  tx: SettingsTx,
): string {
  switch (status) {
    case "received":
      return tx("已接收", "Received");
    case "processed":
      return tx("已处理", "Processed");
    case "ignored":
      return tx("已忽略", "Ignored");
    case "failed":
      return tx("失败", "Failed");
  }
}

function resolveInboundEventStatusClass(status: FeishuIntegrationSettingsItem["recentInboundEvents"][number]["status"]): string {
  switch (status) {
    case "processed":
      return "status-chip--active";
    case "ignored":
    case "received":
      return "status-chip--warning";
    case "failed":
      return "status-chip--danger";
  }
}

function countInboundEventsByReason(integration: FeishuIntegrationSettingsItem, reasonCode: string): number {
  return integration.recentInboundEvents.filter((event) => event.errorMessage === reasonCode).length;
}

function translateSetupCheckLabel(
  key: FeishuIntegrationSetupCheck["key"],
  tx: SettingsTx,
): string {
  switch (key) {
    case "credentials":
      return tx("凭据完整", "Credentials");
    case "callback_or_worker":
      return tx("回调/长连接", "Callback/Worker");
    case "health":
      return tx("连接健康", "Health");
    case "chat_binding":
      return tx("群绑定", "Chat Binding");
    case "user_binding":
      return tx("用户绑定", "User Binding");
    case "doc_binding":
      return tx("Doc 绑定", "Doc Binding");
    case "sheet_binding":
      return tx("Sheet 绑定", "Sheet Binding");
    case "base_binding":
      return tx("Base 绑定", "Base Binding");
    case "outbox":
      return tx("出站队列", "Outbox");
  }
}

function translateEvidenceGateLabel(
  key: FeishuIntegrationEvidenceGate["key"],
  tx: SettingsTx,
): string {
  switch (key) {
    case "bot_reply":
      return tx("Bot 回复证据", "Bot Reply Evidence");
    case "native_agent_bot":
      return tx("原生 Agent Bot 证据", "Native Agent Bot Evidence");
    case "guest_policy":
      return tx("外部访客策略证据", "External Guest Policy Evidence");
    case "worker_restart":
      return tx("长连接恢复证据", "Worker Recovery Evidence");
    case "worker_card_action":
      return tx("长连接审批卡片证据", "Worker Approval Card Evidence");
    case "data_plane":
      return tx("数据面证据", "Data Plane Evidence");
    case "failure_visibility":
      return tx("失败可见证据", "Failure Visibility Evidence");
    case "openapi_artifact":
      return tx("OpenAPI 证据", "OpenAPI Evidence");
  }
}

function translateSetupCheckStatus(
  status: FeishuIntegrationSetupCheck["status"],
  tx: SettingsTx,
): string {
  switch (status) {
    case "ready":
      return tx("就绪", "Ready");
    case "missing":
      return tx("缺失", "Missing");
    case "attention":
      return tx("注意", "Attention");
  }
}

function resolveSetupCheckStatusClass(status: FeishuIntegrationSetupCheck["status"]): string {
  switch (status) {
    case "ready":
      return "status-chip--active";
    case "missing":
      return "status-chip--danger";
    case "attention":
      return "status-chip--warning";
  }
}

function formatSetupCheckDetail(
  check: FeishuIntegrationSetupCheck,
  tx: SettingsTx,
): string {
  if (typeof check.current === "number" || typeof check.required === "number") {
    return `${tx("当前", "Current")}: ${check.current} / ${tx("需要", "Required")}: ${check.required ?? 1}`;
  }
  return `${tx("当前", "Current")}: ${check.current}`;
}
