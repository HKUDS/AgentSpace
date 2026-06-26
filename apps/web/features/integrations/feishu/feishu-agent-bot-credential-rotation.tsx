"use client";

import { type TransitionStartFunction, useState } from "react";
import type { SettingsTx } from "@/features/settings/settings-types";
import { translateSettingsActionError } from "@/features/settings/settings-utils";
import { rotateFeishuAgentBotCredentialsAction } from "./feishu-actions";
import type { FeishuIntegrationSettingsItem } from "./feishu-types";

interface FeishuAgentBotCredentialRotationProps {
  readonly integration: FeishuIntegrationSettingsItem;
  readonly isPending: boolean;
  readonly onUpdated: (integration: FeishuIntegrationSettingsItem) => void;
  readonly setFeedback: (value: string | null) => void;
  readonly startTransition: TransitionStartFunction;
  readonly tx: SettingsTx;
}

export function FeishuAgentBotCredentialRotation({
  integration,
  isPending,
  onUpdated,
  setFeedback,
  startTransition,
  tx,
}: FeishuAgentBotCredentialRotationProps) {
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [tenantKey, setTenantKey] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [encryptKey, setEncryptKey] = useState("");
  const disabled = isPending || integration.status === "disabled";
  const canRotate = !disabled && Boolean(appSecret.trim());

  const clearFields = () => {
    setAppId("");
    setAppSecret("");
    setTenantKey("");
    setVerificationToken("");
    setEncryptKey("");
  };

  return (
    <details className="feishu-advanced-settings">
      <summary>
        <span>{tx("轮换凭据", "Rotate Credentials")}</span>
        <small>
          {tx(
            "App Secret 必填；App ID、Tenant Key、Verification Token 和 Encrypt Key 留空则保持不变。",
            "App Secret is required; leave App ID, Tenant Key, Verification Token, and Encrypt Key blank to keep them unchanged.",
          )}
        </small>
      </summary>

      <div className="feishu-advanced-settings__body">
        <label className="form-field">
          <span>App ID</span>
          <input
            autoComplete="off"
            disabled={disabled}
            onChange={(event) => setAppId(event.currentTarget.value)}
            placeholder={integration.appId ?? tx("保持不变", "Keep unchanged")}
            value={appId}
          />
        </label>
        <label className="form-field">
          <span>{tx("新 App Secret", "New App Secret")}</span>
          <input
            aria-label={tx("新 App Secret", "New App Secret")}
            autoComplete="new-password"
            disabled={disabled}
            onChange={(event) => setAppSecret(event.currentTarget.value)}
            type="password"
            value={appSecret}
          />
        </label>
        <label className="form-field">
          <span>Tenant Key</span>
          <input
            autoComplete="off"
            disabled={disabled}
            onChange={(event) => setTenantKey(event.currentTarget.value)}
            placeholder={integration.tenantKey ?? tx("保持不变", "Keep unchanged")}
            value={tenantKey}
          />
        </label>
        <label className="form-field">
          <span>
            {integration.transportMode === "http_webhook"
              ? tx("Verification Token", "Verification Token")
              : tx("Verification Token（可选）", "Verification Token (optional)")}
          </span>
          <input
            autoComplete="new-password"
            disabled={disabled}
            onChange={(event) => setVerificationToken(event.currentTarget.value)}
            type="password"
            value={verificationToken}
          />
        </label>
        <label className="form-field">
          <span>Encrypt Key</span>
          <input
            autoComplete="new-password"
            disabled={disabled}
            onChange={(event) => setEncryptKey(event.currentTarget.value)}
            type="password"
            value={encryptKey}
          />
        </label>
        <div className="feishu-integration-form__actions">
          <button
            className="action-button"
            disabled={!canRotate}
            onClick={() => {
              startTransition(async () => {
                try {
                  const updated = await rotateFeishuAgentBotCredentialsAction({
                    integrationId: integration.id,
                    appId: optionalText(appId),
                    appSecret,
                    tenantKey: optionalText(tenantKey),
                    verificationToken: optionalText(verificationToken),
                    encryptKey: optionalText(encryptKey),
                  });
                  clearFields();
                  setFeedback(tx("Agent 飞书 Bot 凭据已轮换。", "Agent Feishu bot credentials rotated."));
                  onUpdated(updated);
                } catch (error) {
                  setFeedback(translateSettingsActionError(error, tx));
                }
              });
            }}
            type="button"
          >
            {tx("轮换凭据", "Rotate Credentials")}
          </button>
        </div>
      </div>
    </details>
  );
}

function optionalText(value: string): string | undefined {
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}
