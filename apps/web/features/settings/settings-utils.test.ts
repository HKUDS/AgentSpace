import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/lib/time-format", () => ({
  formatCompactTimestamp: (value: string) => value,
}));

import { translateSettingsActionError } from "./settings-utils";

const englishTx = (_zh: string, en: string) => en;
const chineseTx = (zh: string) => zh;

describe("translateSettingsActionError", () => {
  it("translates duplicate Feishu app and tenant errors", () => {
    expect(translateSettingsActionError(
      new Error("feishu.integration.duplicate_app_tenant"),
      englishTx,
    )).toBe("This Feishu App ID and Tenant Key are already connected to this workspace.");

    expect(translateSettingsActionError(
      new Error("feishu.integration.duplicate_app_tenant"),
      chineseTx,
    )).toBe("该飞书 App ID 和 Tenant Key 已经连接到当前工作区。");
  });

  it("translates Feishu credential encryption setup errors", () => {
    expect(translateSettingsActionError(
      new Error("feishu.integration.credential_encryption_key_missing"),
      englishTx,
    )).toBe(
      "AgentSpace is missing the Feishu credential encryption key. Set AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY.",
    );

    expect(translateSettingsActionError(
      new Error("feishu.integration.credential_encryption_key_invalid"),
      chineseTx,
    )).toBe("AgentSpace 飞书凭据加密密钥无效。请使用 base64 编码的 32 字节密钥。");
  });

  it("translates Feishu setup placeholder errors", () => {
    expect(translateSettingsActionError(
      new Error("feishu.integration.placeholder_value"),
      englishTx,
    )).toBe("Replace Feishu setup placeholders with real values from the developer console.");

    expect(translateSettingsActionError(
      new Error("feishu.integration.placeholder_value"),
      chineseTx,
    )).toBe("请将飞书配置里的模板占位值替换为开放平台中的真实值。");
  });

  it("translates Feishu binding placeholder errors", () => {
    expect(translateSettingsActionError(
      new Error("feishu.channel_binding.placeholder_value"),
      englishTx,
    )).toBe("Replace Feishu channel binding placeholders with a real chat ID.");

    expect(translateSettingsActionError(
      new Error("feishu.user_binding.placeholder_value"),
      chineseTx,
    )).toBe("请将飞书用户绑定里的模板占位值替换为真实 Open ID。");

    expect(translateSettingsActionError(
      new Error("feishu.resource_binding.placeholder_value"),
      englishTx,
    )).toBe("Replace Feishu resource binding placeholders with a real Doc, Sheet, or Base URL.");
  });

  it("translates Feishu resource binding scope errors", () => {
    expect(translateSettingsActionError(
      new Error("feishu.resource_binding.scope_missing"),
      englishTx,
    )).toBe(
      "This Feishu integration is missing the Docs / Sheets / Base scopes required for this resource. Update scopes in the Feishu developer console and rerun the health check.",
    );
  });

  it("translates incomplete Feishu Base binding errors", () => {
    expect(translateSettingsActionError(
      new Error("feishu.resource_binding.base_app_token_missing"),
      englishTx,
    )).toBe(
      "Feishu Base table/view bindings require a Base URL that includes the app token; a raw table/view id is not enough for AgentSpace data-plane governance.",
    );

    expect(translateSettingsActionError(
      new Error("feishu.resource_binding.base_table_id_missing"),
      chineseTx,
    )).toBe("飞书 Base 视图绑定需要同时包含 table 和 view 上下文，请使用完整 Base 视图链接。");
  });

  it("translates duplicate Feishu binding governance errors", () => {
    expect(translateSettingsActionError(
      new Error("feishu.channel_binding.external_chat_taken"),
      englishTx,
    )).toBe(
      "This Feishu chat is already mapped to another AgentSpace channel. Ask an admin to review the existing mapping first.",
    );

    expect(translateSettingsActionError(
      new Error("feishu.user_binding.external_user_taken"),
      chineseTx,
    )).toBe("这个飞书 Open ID 已绑定到其他 AgentSpace 用户，请联系管理员处理。");

    expect(translateSettingsActionError(
      new Error("feishu.resource_binding.external_resource_taken"),
      englishTx,
    )).toBe(
      "This Feishu resource is already bound to another AgentSpace resource. Ask an admin to review the existing mapping first.",
    );
  });

  it("falls back to the raw message for unknown action errors", () => {
    expect(translateSettingsActionError(new Error("custom.error"), englishTx)).toBe("custom.error");
  });
});
