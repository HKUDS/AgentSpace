import type { WorkspaceRole } from "@agent-space/db";
import type { SettingsTx, SettingsWorkspaceInvitationItem } from "@/features/settings/settings-types";
import { formatCompactTimestamp } from "@/shared/lib/time-format";

export function describeSession(userAgent: string | undefined, tx: SettingsTx): string {
  if (!userAgent || userAgent.trim().length === 0) {
    return tx("未知设备", "Unknown device");
  }

  return userAgent;
}

export function describeSessionFingerprint(sessionId: string): string {
  if (sessionId.length <= 14) {
    return sessionId;
  }

  return `${sessionId.slice(0, 8)}...${sessionId.slice(-4)}`;
}

export function formatSessionTimestamp(value: string): string {
  return formatCompactTimestamp(value, { emptyFallback: value });
}

export function translateWorkspaceRole(role: WorkspaceRole, tx: SettingsTx): string {
  if (role === "owner") {
    return tx("所有者", "Owner");
  }
  if (role === "admin") {
    return tx("管理员", "Admin");
  }

  return tx("成员", "Member");
}

export function translateInvitationStatus(
  status: SettingsWorkspaceInvitationItem["status"],
  tx: SettingsTx,
): string {
  if (status === "accepted") {
    return tx("已接受", "Accepted");
  }
  if (status === "revoked") {
    return tx("已撤销", "Revoked");
  }
  if (status === "expired") {
    return tx("已过期", "Expired");
  }

  return tx("待接受", "Pending");
}

export function describeInvitationState(
  invitation: SettingsWorkspaceInvitationItem,
  tx: SettingsTx,
): string {
  if (invitation.status === "accepted") {
    return tx("对方已接受邀请。", "This invitation has been accepted.");
  }
  if (invitation.status === "revoked") {
    return tx("这条邀请已被撤销。", "This invitation was revoked.");
  }
  if (invitation.status === "expired") {
    return tx("这条邀请已过期，可重新发送。", "This invitation expired and can be reissued.");
  }

  const expiresAt = new Date(invitation.expiresAt).getTime();
  const hoursLeft = Math.round((expiresAt - Date.now()) / (1000 * 60 * 60));
  if (Number.isFinite(hoursLeft) && hoursLeft >= 0 && hoursLeft <= 48) {
    return tx(`将在 ${hoursLeft} 小时内过期。`, `Expires in ${hoursLeft} hour(s).`);
  }

  return tx("等待对方接受邀请。", "Waiting for the invitee to accept.");
}

export function translateSettingsActionError(error: unknown, tx: SettingsTx): string {
  const message = error instanceof Error ? error.message : String(error);
  switch (message) {
    case "auth.profile.missing_display_name":
      return tx("请填写用户名。", "Username is required.");
    case "workspace.profile.missing_name":
      return tx("请填写工作区名称。", "Workspace name is required.");
    case "workspace.invitation.missing_email":
      return tx("请填写邀请邮箱。", "Invitation email is required.");
    case "workspace.invitation.not_found":
      return tx("未找到该邀请。", "Invitation not found.");
    case "workspace.invitation.already_accepted":
      return tx("该邀请已被接受，不能重新发送。", "This invitation was already accepted and cannot be reissued.");
    case "workspace.members.missing_email":
      return tx("请填写邮箱。", "Email is required.");
    case "workspace.members.account_not_found":
      return tx("该邮箱尚未注册账户。", "No account exists for that email.");
    case "workspace.members.already_member":
      return tx("该用户已经在当前工作区中。", "That user is already in this workspace.");
    case "workspace.members.owner_only":
      return tx("只有所有者可以管理 owner 角色。", "Only owners can manage the owner role.");
    case "workspace.members.already_owner":
      return tx("该成员已经是所有者。", "That member is already an owner.");
    case "workspace.members.cannot_manage_self":
      return tx("暂不支持修改或移除你自己的成员身份。", "You cannot change or remove your own membership here.");
    case "workspace.members.last_owner":
      return tx("至少需要保留一位所有者。", "At least one owner must remain.");
    case "workspace.members.not_found":
      return tx("未找到该成员。", "Member not found.");
    case "workspace.members.missing_user":
      return tx("缺少成员标识。", "Member identifier is required.");
    case "channel.invitation.not_found":
      return tx("未找到该群邀请。", "Channel invitation not found.");
    case "channel.invitation.not_pending":
      return tx("该群邀请已经处理过。", "This channel invitation has already been handled.");
    case "channel.invitation.email_mismatch":
      return tx("当前账号邮箱与群邀请邮箱不一致。", "This account email does not match the channel invitation email.");
    case "slack.integration.missing_app_id":
      return tx("请填写 Slack App ID。", "Slack App ID is required.");
    case "slack.integration.missing_bot_token":
      return tx("请填写 Slack Bot Token。", "Slack Bot Token is required.");
    case "slack.integration.missing_signing_secret":
      return tx("请填写 Slack Signing Secret。", "Slack Signing Secret is required.");
    case "slack.integration.missing_app_level_token":
      return tx("Socket Mode 需要填写 Slack App-Level Token。", "Socket Mode requires a Slack App-Level Token.");
    case "slack.integration.invalid_transport_mode":
      return tx("请选择有效的 Slack 连接方式。", "Select a valid Slack transport.");
    case "slack.integration.not_found":
      return tx("未找到该 Slack 集成。", "Slack integration not found.");
    case "slack.integration.disabled":
      return tx("该 Slack 集成已停用。", "This Slack integration is disabled.");
    case "slack.integration.duplicate_app_team":
      return tx(
        "该 Slack App ID 和 Team ID 已经连接到当前工作区。",
        "This Slack App ID and Team ID are already connected to this workspace.",
      );
    case "slack.integration.credential_encryption_key_missing":
      return tx(
        "AgentSpace 未配置 Slack 凭据加密密钥。请设置 AGENT_SPACE_SLACK_CREDENTIAL_ENCRYPTION_KEY。",
        "AgentSpace is missing the Slack credential encryption key. Set AGENT_SPACE_SLACK_CREDENTIAL_ENCRYPTION_KEY.",
      );
    case "slack.integration.credential_encryption_key_invalid":
      return tx(
        "AgentSpace Slack 凭据加密密钥无效。请使用 base64 编码的 32 字节密钥。",
        "AgentSpace Slack credential encryption key is invalid. Use a base64-encoded 32-byte key.",
      );
    case "slack.integration.placeholder_value":
      return tx(
        "请将 Slack 配置里的模板占位值替换为 Slack App 中的真实值。",
        "Replace Slack setup placeholders with real values from the Slack app.",
      );
    case "slack.channel_binding.missing_channel":
      return tx("请选择 AgentSpace 频道。", "Select an AgentSpace channel.");
    case "slack.channel_binding.missing_external_channel_id":
      return tx("请填写 Slack Conversation ID。", "Slack Conversation ID is required.");
    case "slack.channel_binding.placeholder_value":
      return tx(
        "请将 Slack 频道绑定里的模板占位值替换为真实 Conversation ID。",
        "Replace Slack channel binding placeholders with a real Conversation ID.",
      );
    case "slack.channel_binding.channel_not_found":
      return tx("未找到该 AgentSpace 频道。", "AgentSpace channel not found.");
    case "slack.channel_binding.external_channel_taken":
      return tx(
        "这个 Slack 会话已映射到其他 AgentSpace 频道，请先让管理员检查现有映射。",
        "This Slack conversation is already mapped to another AgentSpace channel. Ask an admin to review the existing mapping first.",
      );
    case "slack.user_binding.missing_user":
      return tx("请选择 AgentSpace 用户。", "Select an AgentSpace user.");
    case "slack.user_binding.missing_external_user_id":
      return tx("请填写 Slack User ID。", "Slack User ID is required.");
    case "slack.user_binding.placeholder_value":
      return tx(
        "请将 Slack 用户绑定里的模板占位值替换为真实 Slack User ID。",
        "Replace Slack user binding placeholders with a real Slack User ID.",
      );
    case "slack.user_binding.user_not_found":
      return tx("未找到该工作区成员。", "Workspace member not found.");
    case "slack.user_binding.external_user_taken":
      return tx(
        "这个 Slack User ID 已绑定到其他 AgentSpace 用户，请联系管理员处理。",
        "This Slack User ID is already bound to another AgentSpace user. Ask an admin to review it.",
      );
    case "slack.user_binding.forbidden":
      return tx("成员只能绑定自己的 Slack 用户。", "Members can only bind their own Slack user.");
    case "feishu.integration.missing_app_id":
      return tx("请填写飞书 App ID。", "Feishu App ID is required.");
    case "feishu.integration.missing_app_secret":
      return tx("请填写飞书 App Secret。", "Feishu App Secret is required.");
    case "feishu.integration.missing_verification_token":
      return tx("请填写飞书 Verification Token。", "Feishu Verification Token is required.");
    case "feishu.integration.invalid_transport_mode":
      return tx("请选择有效的飞书连接方式。", "Select a valid Feishu transport.");
    case "feishu.integration.not_found":
      return tx("未找到该飞书集成。", "Feishu integration not found.");
    case "feishu.integration.disabled":
      return tx("该飞书集成已停用。", "This Feishu integration is disabled.");
    case "feishu.integration.duplicate_app_tenant":
      return tx(
        "该飞书 App ID 和 Tenant Key 已经连接到当前工作区。",
        "This Feishu App ID and Tenant Key are already connected to this workspace.",
      );
    case "feishu.integration.credential_encryption_key_missing":
      return tx(
        "AgentSpace 未配置飞书凭据加密密钥。请设置 AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY。",
        "AgentSpace is missing the Feishu credential encryption key. Set AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY.",
      );
    case "feishu.integration.credential_encryption_key_invalid":
      return tx(
        "AgentSpace 飞书凭据加密密钥无效。请使用 base64 编码的 32 字节密钥。",
        "AgentSpace Feishu credential encryption key is invalid. Use a base64-encoded 32-byte key.",
      );
    case "feishu.integration.placeholder_value":
      return tx(
        "请将飞书配置里的模板占位值替换为开放平台中的真实值。",
        "Replace Feishu setup placeholders with real values from the developer console.",
      );
    case "feishu.agent_bot_binding.missing_agent_id":
      return tx("请选择要绑定的 Agent。", "Select an agent to bind.");
    case "feishu.agent_bot_binding.missing_app_id":
      return tx("请填写飞书 Bot 的 App ID。", "Feishu bot App ID is required.");
    case "feishu.agent_bot_binding.missing_app_secret":
      return tx("请填写飞书 Bot 的 App Secret。", "Feishu bot App Secret is required.");
    case "feishu.agent_bot_binding.missing_verification_token":
      return tx("事件回调模式需要填写 Verification Token。", "Event callback mode requires a Verification Token.");
    case "feishu.agent_bot_binding.invalid_transport_mode":
      return tx("请选择有效的飞书 Bot 连接方式。", "Select a valid Feishu bot transport.");
    case "feishu.agent_bot_binding.invalid_channel_auto_provisioning_policy":
      return tx("请选择有效的飞书 Bot 自动建群策略。", "Select a valid Feishu bot auto-provisioning policy.");
    case "feishu.agent_bot_binding.invalid_external_guest_policy":
      return tx("请选择有效的飞书 Bot 外部访客策略。", "Select a valid Feishu bot external guest policy.");
    case "feishu.agent_bot_binding.duplicate_agent":
      return tx(
        "这个 Agent 已经有一个启用中的飞书 Bot。",
        "This agent already has an active Feishu bot.",
      );
    case "feishu.agent_bot_binding.duplicate_app_tenant":
      return tx(
        "这个飞书 App ID 和 Tenant Key 已经绑定到其他 Agent。",
        "This Feishu App ID and Tenant Key are already bound to another agent.",
      );
    case "feishu.agent_bot_binding.not_found":
      return tx("未找到该 Agent 的飞书 Bot 绑定。", "Feishu bot binding for this agent was not found.");
    case "feishu.agent_bot_binding.placeholder_value":
      return tx(
        "请将飞书 Bot 配置里的模板占位值替换为开放平台中的真实值。",
        "Replace Feishu bot setup placeholders with real values from the developer console.",
      );
    case "feishu.agent_bot_binding.credential_encryption_key_missing":
      return tx(
        "AgentSpace 未配置飞书凭据加密密钥。请设置 AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY。",
        "AgentSpace is missing the Feishu credential encryption key. Set AGENT_SPACE_FEISHU_CREDENTIAL_ENCRYPTION_KEY.",
      );
    case "feishu.agent_bot_binding.credential_encryption_key_invalid":
      return tx(
        "AgentSpace 飞书凭据加密密钥无效。请使用 base64 编码的 32 字节密钥。",
        "AgentSpace Feishu credential encryption key is invalid. Use a base64-encoded 32-byte key.",
      );
    case "feishu.credentials_missing":
      return tx("飞书 App ID 或 App Secret 不完整。", "Feishu App ID or App Secret is incomplete.");
    case "feishu.channel_binding.missing_channel":
      return tx("请选择 AgentSpace 频道。", "Select an AgentSpace channel.");
    case "feishu.channel_binding.missing_external_chat_id":
      return tx("请填写飞书群聊 ID。", "Feishu chat ID is required.");
    case "feishu.channel_binding.placeholder_value":
      return tx(
        "请将飞书群绑定里的模板占位值替换为真实群聊 ID。",
        "Replace Feishu channel binding placeholders with a real chat ID.",
      );
    case "feishu.channel_binding.channel_not_found":
      return tx("未找到该 AgentSpace 频道。", "AgentSpace channel not found.");
    case "feishu.channel_binding.external_chat_taken":
      return tx(
        "这个飞书会话已映射到其他 AgentSpace 频道，请先让管理员检查现有映射。",
        "This Feishu chat is already mapped to another AgentSpace channel. Ask an admin to review the existing mapping first.",
      );
    case "feishu.user_binding.missing_user":
      return tx("请选择 AgentSpace 用户。", "Select an AgentSpace user.");
    case "feishu.user_binding.missing_external_user_id":
      return tx("请填写飞书 Open ID。", "Feishu Open ID is required.");
    case "feishu.user_binding.placeholder_value":
      return tx(
        "请将飞书用户绑定里的模板占位值替换为真实 Open ID。",
        "Replace Feishu user binding placeholders with a real Open ID.",
      );
    case "feishu.user_binding.user_not_found":
      return tx("未找到该工作区成员。", "Workspace member not found.");
    case "feishu.user_binding.external_user_taken":
      return tx(
        "这个飞书 Open ID 已绑定到其他 AgentSpace 用户，请联系管理员处理。",
        "This Feishu Open ID is already bound to another AgentSpace user. Ask an admin to review it.",
      );
    case "feishu.user_binding.not_found":
      return tx("未找到该飞书用户绑定。", "Feishu user binding not found.");
    case "feishu.user_binding.forbidden":
      return tx("成员只能绑定或解绑自己的飞书用户。", "Members can only bind or unbind their own Feishu user.");
    case "feishu.resource_binding.invalid_resource":
      return tx("无法识别飞书资源链接或 token。", "Could not recognize the Feishu resource URL or token.");
    case "feishu.resource_binding.placeholder_value":
      return tx(
        "请将飞书资源绑定里的模板占位值替换为真实文档、表格或多维表链接。",
        "Replace Feishu resource binding placeholders with a real Doc, Sheet, or Base URL.",
      );
    case "feishu.resource_binding.scope_missing":
      return tx(
        "该飞书集成缺少绑定此资源所需的 Docs / Sheets / Base 权限，请先在飞书开放平台补充权限并重新健康检查。",
        "This Feishu integration is missing the Docs / Sheets / Base scopes required for this resource. Update scopes in the Feishu developer console and rerun the health check.",
      );
    case "feishu.resource_binding.base_app_token_missing":
      return tx(
        "飞书 Base 表/视图绑定需要包含 Base app token 的链接；仅填写 table/view id 不足以支撑 AgentSpace 数据面治理。",
        "Feishu Base table/view bindings require a Base URL that includes the app token; a raw table/view id is not enough for AgentSpace data-plane governance.",
      );
    case "feishu.resource_binding.base_table_id_missing":
      return tx(
        "飞书 Base 视图绑定需要同时包含 table 和 view 上下文，请使用完整 Base 视图链接。",
        "Feishu Base view bindings require both table and view context. Use the full Base view URL.",
      );
    case "feishu.resource_binding.missing_agent_space_resource_type":
      return tx("请选择 AgentSpace 资源类型。", "Select an AgentSpace resource type.");
    case "feishu.resource_binding.missing_agent_space_resource_id":
      return tx("请填写 AgentSpace 资源 ID。", "AgentSpace resource ID is required.");
    case "feishu.resource_binding.channel_not_found":
      return tx("未找到要关联的 AgentSpace 频道。", "Linked AgentSpace channel not found.");
    case "feishu.resource_binding.external_resource_taken":
      return tx(
        "这个飞书资源已绑定到其他 AgentSpace 资源，请先让管理员检查现有映射。",
        "This Feishu resource is already bound to another AgentSpace resource. Ask an admin to review the existing mapping first.",
      );
    case "feishu.resource_binding.missing_channel_document_channel":
      return tx("创建频道文档映射时请选择关联频道。", "Choose a linked channel when creating a channel document mapping.");
    case "feishu.resource_binding.channel_document_mismatch":
      return tx("目标频道文档不是同一个飞书外部文档。", "The target channel document is not the same Feishu external document.");
    case "feishu.resource_binding.unsupported_data_table_resource":
      return tx("只有飞书 Sheet 或 Base 可以映射为数据表。", "Only Feishu Sheet or Base resources can map to data tables.");
    case "feishu.resource_binding.data_table_mismatch":
      return tx("目标数据表不是同一个飞书外部表。", "The target data table is not the same Feishu external table.");
    default:
      return message || tx("操作失败。", "Action failed.");
  }
}
