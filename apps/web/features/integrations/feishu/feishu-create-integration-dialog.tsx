"use client";

import { type TransitionStartFunction, useState } from "react";
import type { SettingsTx } from "@/features/settings/settings-types";
import { translateSettingsActionError } from "@/features/settings/settings-utils";
import {
  createFeishuIntegrationAction,
  testFeishuIntegrationConnectionAction,
} from "./feishu-actions";
import { translateFeishuOpenPlatformSetupStep } from "./feishu-open-platform-labels";
import type {
  FeishuIntegrationCreationGuide,
  FeishuIntegrationSettingsItem,
  TestFeishuIntegrationConnectionResult,
} from "./feishu-types";

export function FeishuCreateIntegrationDialog({
  creationGuide,
  isPending,
  onCreated,
  setFeedback,
  startTransition,
  tx,
}: {
  creationGuide?: FeishuIntegrationCreationGuide;
  isPending: boolean;
  onCreated: (integration: FeishuIntegrationSettingsItem) => void;
  setFeedback: (value: string | null) => void;
  startTransition: TransitionStartFunction;
  tx: SettingsTx;
}) {
  const [displayName, setDisplayName] = useState("Feishu");
  const [transportMode, setTransportMode] = useState<"http_webhook" | "websocket_worker">("websocket_worker");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [encryptKey, setEncryptKey] = useState("");
  const [tenantKey, setTenantKey] = useState("");
  const [connectionSummary, setConnectionSummary] = useState<TestFeishuIntegrationConnectionResult | null>(null);
  const canTestConnection = Boolean(appId.trim() && appSecret.trim());
  const requiresVerificationToken = transportMode === "http_webhook";
  const canCreateIntegration = Boolean(appId.trim() && appSecret.trim() && (!requiresVerificationToken || verificationToken.trim()));
  const requiredCredentialFields = creationGuide?.requiredCredentialFields ?? [];
  const requiredEvents = creationGuide?.requiredEvents ?? [];
  const requiredScopes = creationGuide?.requiredScopes ?? [];
  const eventCallbackPath = creationGuide?.eventCallbackPath;
  const publicAppUrlStatus = creationGuide?.publicAppUrlStatus;
  const publicAppUrl = creationGuide?.publicAppUrl;
  const callbackUrlTemplate = creationGuide?.callbackUrlTemplate;
  const developerConsoleUrl = creationGuide?.developerConsoleUrl;
  const setupSteps = creationGuide?.openPlatformSetupSteps ?? [];

  return (
    <section className="page-panel">
      <div className="panel-header">
        <div>
          <h3>{tx("创建飞书集成", "Create Feishu Integration")}</h3>
          <p className="settings-panel-note">
            {tx("快速开始只需要飞书自建应用的 App ID 和 App Secret。", "Quick start only needs the self-built app App ID and App Secret.")}
          </p>
        </div>
      </div>

      <div className="feishu-integration-form">
        <label className="form-field">
          <span>{tx("名称", "Name")}</span>
          <input
            disabled={isPending}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
            value={displayName}
          />
        </label>

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
            <small>{tx("公网回调、租户锁定、事件加密和完整 smoke 配置", "Public callbacks, tenant lock, encrypted events, and full smoke setup")}</small>
          </summary>

          <div className="feishu-advanced-settings__body">
            <label className="form-field">
              <span>{tx("连接方式", "Transport")}</span>
              <select
                disabled={isPending}
                onChange={(event) => setTransportMode(event.currentTarget.value as "http_webhook" | "websocket_worker")}
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
                aria-label={tx("Verification Token", "Verification Token")}
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

            <div className="feishu-setup-summary" aria-label={tx("飞书开放平台配置", "Feishu developer console configuration")}>
              {developerConsoleUrl ? (
                <section>
                  <strong>{tx("开放平台", "Developer Console")}</strong>
                  <a href={developerConsoleUrl} rel="noreferrer" target="_blank">{developerConsoleUrl}</a>
                </section>
              ) : null}
              {setupSteps.length > 0 ? (
                <section>
                  <strong>{tx("配置步骤", "Setup Steps")}</strong>
                  <ol>
                    {setupSteps.map((step) => (
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
                <strong>{tx("事件回调", "Event Callback")}</strong>
                {eventCallbackPath ? <code>{eventCallbackPath}</code> : null}
                {publicAppUrlStatus ? (
                  <small>
                    {publicAppUrlStatus === "configured"
                      ? tx("Public URL 已配置", "Public URL configured")
                      : tx("缺少 Public URL", "Public URL missing")}
                  </small>
                ) : null}
                {publicAppUrl ? <code>{publicAppUrl}</code> : null}
                {callbackUrlTemplate ? <code>{callbackUrlTemplate}</code> : null}
              </section>
              <section>
                <strong>{tx("凭据字段", "Credential Fields")}</strong>
                <ul>
                  {requiredCredentialFields.map((field) => (
                    <li key={field}><code>{field}</code></li>
                  ))}
                </ul>
              </section>
              <section>
                <strong>{tx("Messenger 事件", "Messenger Events")}</strong>
                <ul>
                  {requiredEvents.map((eventName) => (
                    <li key={eventName}><code>{eventName}</code></li>
                  ))}
                </ul>
              </section>
              <section>
                <strong>{tx("Docs / Sheets / Base 权限", "Docs / Sheets / Base Scopes")}</strong>
                <ul>
                  {requiredScopes.map((scope) => (
                    <li key={scope}><code>{scope}</code></li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </details>

        {connectionSummary ? (
          <div aria-label={tx("飞书连接测试摘要", "Feishu connection test summary")} className="feishu-connection-summary">
            <div>
              <strong>{tx("连接测试", "Connection Test")}</strong>
              <span>{translateHealthStatus(connectionSummary.status, tx)}</span>
              <span>{tx("检查时间", "Checked")}: {connectionSummary.checkedAt}</span>
            </div>
            <p>
              {connectionSummary.botAppName || connectionSummary.botOpenId
                ? `${tx("Bot", "Bot")}: ${connectionSummary.botAppName ?? tx("未命名", "Unnamed")} ${connectionSummary.botOpenId ? `(${connectionSummary.botOpenId})` : ""}`
                : tx("未读取到 Bot 信息。", "No bot information returned.")}
            </p>
            {connectionSummary.errorMessage ? (
              <p>{tx("错误", "Error")}: {connectionSummary.errorMessage}</p>
            ) : null}
            {connectionSummary.errorCode ? (
              <p>{tx("错误码", "Error Code")}: <code>{connectionSummary.errorCode}</code></p>
            ) : null}
            <div>
              <strong>{tx("权限检查", "Scope Check")}</strong>
              <span>{translateScopeReadiness(connectionSummary.scopeReadiness, tx)}</span>
            </div>
            {connectionSummary.scopeErrorMessage ? (
              <p>{tx("权限检查错误", "Scope check error")}: {connectionSummary.scopeErrorMessage}</p>
            ) : null}
            <ul>
              {(connectionSummary.missingScopes && connectionSummary.missingScopes.length > 0
                ? connectionSummary.missingScopes
                : connectionSummary.requiredScopes).map((scope) => (
                <li key={scope}><code>{scope}</code></li>
              ))}
            </ul>
          </div>
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
                    ? tx("飞书连接测试通过，请确认权限清单后保存。", "Feishu connection test passed. Confirm scopes before saving.")
                    : tx("飞书连接测试失败。", "Feishu connection test failed."));
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
            disabled={isPending || !canCreateIntegration}
            onClick={() => {
              startTransition(async () => {
                try {
                  const created = await createFeishuIntegrationAction({
                    displayName,
                    transportMode,
                    appId,
                    appSecret,
                    verificationToken,
                    encryptKey,
                    tenantKey,
                  });
                  setAppSecret("");
                  setVerificationToken("");
                  setEncryptKey("");
                  setFeedback(tx(
                    "飞书集成已创建。请在下方集成卡片继续执行健康检查、生成联调环境、检查联调环境、严格实测、OpenAPI 证据校验和最终证据命令。",
                    "Feishu integration created. Continue from the integration card below with health check, smoke-env, check-env, strict live smoke, OpenAPI evidence verification, and final evidence commands.",
                  ));
                  onCreated(created);
                } catch (error) {
                  setFeedback(translateSettingsActionError(error, tx));
                }
              });
            }}
            type="button"
          >
            {tx("创建集成", "Create Integration")}
          </button>
        </div>
      </div>
    </section>
  );
}

function translateHealthStatus(status: TestFeishuIntegrationConnectionResult["status"], tx: SettingsTx): string {
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
