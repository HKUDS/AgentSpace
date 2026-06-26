import type { SettingsTx } from "@/features/settings/settings-types";

export function translateFeishuOpenPlatformSetupStep(id: string, tx: SettingsTx): string {
  switch (id) {
    case "create_custom_app":
      return tx("创建自建应用", "Create Custom App");
    case "enable_bot":
      return tx("启用 Bot", "Enable Bot");
    case "configure_event_subscription":
      return tx("配置事件订阅", "Configure Events");
    case "grant_bot_scopes":
      return tx("授权 Bot 权限", "Grant Bot Scopes");
    case "grant_data_plane_scopes":
      return tx("授权 Docs / Sheets / Base", "Grant Docs / Sheets / Base");
    case "release_or_install_app":
      return tx("发布或安装应用", "Release or Install App");
    default:
      return id;
  }
}
