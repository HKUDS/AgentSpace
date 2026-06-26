import type { IntegrationProviderDescriptor } from "../../core/index.ts";

export const FEISHU_PROVIDER_ID = "feishu";
export const FEISHU_EVENT_CALLBACK_PATH = "/api/integrations/feishu/events";

export const FEISHU_BOT_SMOKE_SCOPES = [
  "im:message",
  "im:message:send_as_bot",
  "contact:user.base:readonly",
] as const;

export const FEISHU_DATA_PLANE_SMOKE_SCOPES = [
  "docx:document",
  "drive:drive",
  "sheets:spreadsheet",
  "bitable:app",
] as const;

export const FEISHU_DEFAULT_SCOPES = [
  ...FEISHU_BOT_SMOKE_SCOPES,
  ...FEISHU_DATA_PLANE_SMOKE_SCOPES,
] as const;

export const FEISHU_REQUIRED_EVENTS = [
  "im.message.receive_v1",
  "im.chat.member.bot.added_v1",
  "card.action.trigger",
] as const;

export const FEISHU_AGENT_BOT_REQUIRED_CREDENTIAL_FIELDS = [
  "app_id",
  "app_secret",
] as const;

export const FEISHU_EVENT_CALLBACK_REQUIRED_CREDENTIAL_FIELDS = [
  "app_id",
  "app_secret",
  "verification_token",
] as const;

export const FEISHU_RECOMMENDED_CREDENTIAL_FIELDS = [
  "encrypt_key",
] as const;

export const FEISHU_REQUIRED_CREDENTIAL_FIELDS = FEISHU_EVENT_CALLBACK_REQUIRED_CREDENTIAL_FIELDS;

export const FEISHU_OPEN_PLATFORM_CONSOLE_URLS = {
  appList: "https://open.feishu.cn/app",
} as const;

export const FEISHU_OPEN_PLATFORM_SETUP_STEPS = [
  {
    id: "create_custom_app",
    consoleUrl: FEISHU_OPEN_PLATFORM_CONSOLE_URLS.appList,
    required: ["app_id", "app_secret"],
  },
  {
    id: "enable_bot",
    consoleUrl: FEISHU_OPEN_PLATFORM_CONSOLE_URLS.appList,
    required: ["bot_enabled"],
  },
  {
    id: "configure_event_subscription",
    consoleUrl: FEISHU_OPEN_PLATFORM_CONSOLE_URLS.appList,
    required: ["event_callback_url", ...FEISHU_REQUIRED_EVENTS],
  },
  {
    id: "grant_bot_scopes",
    consoleUrl: FEISHU_OPEN_PLATFORM_CONSOLE_URLS.appList,
    required: [...FEISHU_BOT_SMOKE_SCOPES],
  },
  {
    id: "grant_data_plane_scopes",
    consoleUrl: FEISHU_OPEN_PLATFORM_CONSOLE_URLS.appList,
    required: [...FEISHU_DATA_PLANE_SMOKE_SCOPES],
  },
  {
    id: "release_or_install_app",
    consoleUrl: FEISHU_OPEN_PLATFORM_CONSOLE_URLS.appList,
    required: ["tenant_install_or_publish"],
  },
] as const;

export const FEISHU_FINAL_EVIDENCE_GATE_REQUIREMENTS = {
  botReply: "processed_inbound_with_safe_summary + sent_agent_bot_reply_outbox_with_safe_context + same_agent_bot_correlated_reply_mapping",
  nativeAgentBot: "direct_agent_bot_route_with_safe_context + bound_user_bot_mention_with_safe_context + external_guest_bot_mention_with_safe_context + bot_added_auto_provision_with_channel_identity_review_state + first_message_auto_provision_with_channel_identity_review_state + multi_agent_channel_reuse_distinct_binding + thread_task_binding + thread_continuation_without_remention_active_binding + thread_collaboration + bot_sender_loop_guard_without_reply + agent_channel_policy_denial_without_reply",
  guestPolicy: "external_guest_reply_on_mention_allow_with_dispatch + external_guest_reply_all_without_mention + external_guest_require_identity_without_dispatch + sent_identity_binding_notice + external_guest_ignore_without_dispatch_or_reply + external_guest_mention_required_without_dispatch_or_reply",
  workerRestart: "two_correlated_websocket_replies",
  workerCardAction: "processed_approval_card_action_with_governance_context",
  dataPlane: "bound_governed_doc_read + agent_runtime_doc_read_from_lark_cli_manifest + bound_approved_doc_write + bound_governed_sheet_read + bound_approved_sheet_write_with_agentspace_sync + bound_governed_base_read + bound_approved_base_mutation_with_agentspace_sync + user_actor + external_guest_actor + external_guest_read_guest_readable_current_channel + external_guest_bound_write_denied",
  failureVisibility: "provider_failure_row + degraded_or_error_health + agent_bot_failure_with_safe_context",
} as const;

export const FEISHU_OPENAPI_REQUIRED_LIVE_SMOKE_STEPS = [
  "Client im.message.create",
  "AgentSpace callback URL verification",
  "Tenant access token",
  "Docs docx metadata",
  "Docs docx read blocks",
  "Docs docx append blocks",
  "Sheets metadata",
  "Sheets read values",
  "Sheets write values",
  "Base list tables",
  "Base list records",
  "Base update record",
] as const;

export const FEISHU_OPENAPI_REQUIRED_REQUEST_STEPS = [
  "Client im.message.create",
  "Docs docx metadata",
  "Docs docx read blocks",
  "Docs docx append blocks",
  "Sheets metadata",
  "Sheets read values",
  "Sheets write values",
  "Base list tables",
  "Base list records",
  "Base update record",
] as const;

export const FEISHU_OPENAPI_REQUIRED_DESTRUCTIVE_LIVE_SMOKE_STEPS = [
  "Docs docx append blocks",
  "Sheets write values",
  "Base update record",
] as const;

export const FEISHU_PROVIDER_DESCRIPTOR: IntegrationProviderDescriptor = {
  provider: FEISHU_PROVIDER_ID,
  displayName: "Feishu",
  capabilities: [
    "message_transport",
    "docs_data_plane",
    "sheets_data_plane",
    "base_data_plane",
  ],
  supportedTransportModes: ["http_webhook", "websocket_worker"],
  defaultScopes: [...FEISHU_DEFAULT_SCOPES],
  resourceTypes: ["doc", "sheet", "base", "base_table", "base_view"],
};
