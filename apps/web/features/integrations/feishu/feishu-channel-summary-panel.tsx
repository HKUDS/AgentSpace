"use client";

import type { ChannelFeishuSummaryRecord } from "@/features/dashboard/data";

interface FeishuChannelSummaryPanelProps {
  readonly feishu: ChannelFeishuSummaryRecord;
  readonly tx: (zh: string, en: string) => string;
}

export function FeishuChannelSummaryPanel({
  feishu,
  tx,
}: FeishuChannelSummaryPanelProps) {
  return (
    <section
      aria-label={tx("飞书群聊绑定", "Feishu group binding")}
      className="channel-feishu-summary"
    >
      <div className="channel-feishu-summary__main">
        <span className="channel-feishu-summary__label">{tx("飞书群聊", "Feishu group")}</span>
        <strong>{feishu.externalChatName || feishu.externalChatReference || tx("已绑定", "Bound")}</strong>
        <div className="channel-feishu-summary__meta">
          {feishu.externalChatReference ? <span>{feishu.externalChatReference}</span> : null}
          {feishu.provisionSource ? <span>{translateFeishuProvisionSource(feishu.provisionSource, tx)}</span> : null}
          {feishu.reviewStatus ? <span>{translateFeishuReviewStatus(feishu.reviewStatus, tx)}</span> : null}
        </div>
      </div>

      <div className="channel-feishu-summary__section">
        <span className="channel-feishu-summary__label">{tx("Agent Bots", "Agent bots")}</span>
        {feishu.connectedAgentBots.length > 0 ? (
          <div className="channel-feishu-summary__chips">
            {feishu.connectedAgentBots.map((bot) => (
              <span
                className="channel-feishu-summary__bot-chip"
                key={`${bot.integrationId}:${bot.agentId}`}
                title={bot.displayName}
              >
                <strong>{bot.agentId}</strong>
                <span>
                  {translateFeishuUnboundUserMode(bot.unboundUserMode, tx)}
                  {" · "}
                  {translateFeishuGuestPermissionProfile(bot.guestPermissionProfile, tx)}
                </span>
              </span>
            ))}
          </div>
        ) : (
          <span className="channel-feishu-summary__empty">{tx("未连接", "None")}</span>
        )}
      </div>

      <div className="channel-feishu-summary__section">
        <span className="channel-feishu-summary__label">{tx("飞书资源", "Feishu resources")}</span>
        {feishu.resourceBindings.length > 0 ? (
          <div className="channel-feishu-summary__chips">
            {feishu.resourceBindings.map((binding) => (
              <span
                className="channel-feishu-summary__resource-chip"
                key={`${binding.integrationId}:${binding.id}`}
                title={binding.integrationDisplayName}
              >
                <strong>{translateFeishuResourceType(binding.providerResourceType, tx)}</strong>
                <span>{binding.displayName || tx("未命名资源", "Untitled resource")}</span>
                <small>
                  {binding.guestReadable ? tx("Guest readable", "Guest readable") : tx("成员可见", "Members only")}
                  {binding.canWrite ? ` · ${tx("写入需审批", "Writes governed")}` : ""}
                </small>
              </span>
            ))}
          </div>
        ) : (
          <span className="channel-feishu-summary__empty">{tx("未绑定资源", "No resources")}</span>
        )}
      </div>
    </section>
  );
}

function translateFeishuProvisionSource(
  value: string,
  tx: (zh: string, en: string) => string,
): string {
  switch (value) {
    case "bot_added":
      return tx("机器人进群自动创建", "Auto-provisioned by bot added");
    case "first_message":
      return tx("首次消息自动创建", "Auto-provisioned by first message");
    case "agentspace_created":
      return tx("AgentSpace 创建", "Created by AgentSpace");
    case "manual":
      return tx("手动绑定", "Manual binding");
    default:
      return value;
  }
}

function translateFeishuReviewStatus(
  value: string,
  tx: (zh: string, en: string) => string,
): string {
  switch (value) {
    case "approved":
      return tx("已通过", "Approved");
    case "pending_admin_review":
      return tx("等待管理员审核", "Pending admin review");
    case "needs_identity_binding":
      return tx("需要身份绑定", "Needs identity binding");
    default:
      return value;
  }
}

function translateFeishuUnboundUserMode(
  value: string | undefined,
  tx: (zh: string, en: string) => string,
): string {
  switch (value) {
    case "ignore":
      return tx("未绑定用户：忽略", "Unbound users: ignore");
    case "reply_all":
      return tx("未绑定用户：全部回复", "Unbound users: reply all");
    case "require_identity":
      return tx("未绑定用户：要求绑定身份", "Unbound users: require identity");
    case "reply_on_mention":
    default:
      return tx("未绑定用户：@Bot 时回复", "Unbound users: reply when mentioned");
  }
}

function translateFeishuGuestPermissionProfile(
  value: string | undefined,
  tx: (zh: string, en: string) => string,
): string {
  switch (value) {
    case "none":
      return tx("访客权限：无", "Guest permission: none");
    case "channel_readonly":
      return tx("访客权限：当前 Channel 只读", "Guest permission: current channel readonly");
    case "channel_context_only":
    default:
      return tx("访客权限：当前 Channel 上下文", "Guest permission: current channel context");
  }
}

function translateFeishuResourceType(
  value: string,
  tx: (zh: string, en: string) => string,
): string {
  switch (value) {
    case "doc":
      return tx("Doc", "Doc");
    case "sheet":
      return tx("Sheet", "Sheet");
    case "base":
    case "base_table":
      return tx("Base", "Base");
    default:
      return value;
  }
}
