# 121. Slack Message Transport + Agent Experience

> 更新时间：2026-07-08
> 状态：实现中，分支 `codex/slack-integration` 已落地 MVP provider / Events API / CLI 管理入口 / Settings 管理入口 / Socket Mode worker / OAuth hosted install
> 关联：`TODO/84-integration-adapter-contract.md`、`TODO/85-agent-action-permission-policy.md`、`TODO/119-feishu-message-transport-adapter.md`、`TODO/120-feishu-agent-bot-native-experience.md`、`TODO/80-unified-permission-management.md`
> 适用范围：Slack app / bot 接入、Events API、Socket Mode、OAuth v2、message transport adapter、外部身份/频道/线程映射、outbox 回写、Agent 调度、权限治理、审计、健康检查、smoke/evidence

## 一句话结论

Slack 插件应该先做成第二个受治理的 `MessageTransportAdapter`，复用 Feishu 已经落地的 external integration / binding / outbox / event / policy 主链路。

第一版不要追求 Slack Canvas / Lists / files / MCP / enterprise search 等数据面全量能力，也不要一上来做 Slack Marketplace 分发。推荐先落地：

```text
Slack = 外部 IM 壳，负责用户在哪里对话、@ agent、收 agent 回复
AgentSpace = 控制平面，负责 agent 身份、权限、频道映射、用户绑定、审批、审计和 runtime 调度
Daemon/runtime = 执行平面，负责 Codex / Claude Code / OpenClaw / Hermes 等真实任务执行
```

消息面 MVP：

```text
Slack event
-> 验签 / dedup / normalize
-> Slack channel/user/thread 映射到 AgentSpace channel/user/thread
-> 复用 sendChannelHumanMessageSync(...)
-> Agent task 入队并由 daemon/runtime 执行
-> completeAgentChannelReplySync(...) 写内部消息
-> outbox drain 调 Slack chat.postMessage 回写 Slack thread
```

后续体验升级：

```text
每个 AgentSpace agent 可绑定一个 Slack bot / Slack agent app
用户在 Slack channel 或 DM 里 @具体 agent
Slack agent_view / app_context_changed 提供更原生的 agent 入口和上下文
AgentSpace 继续保留权限、审批、审计和运行时治理
```

## 背景

Feishu 功能已经完整合并到 `main`，当前仓库已有：

- `packages/services/src/integrations/core/*` 通用 integration contract。
- `packages/db/src/integrations/*` external integration、channel/user/resource/thread binding、event、outbox、operation run 持久层。
- `packages/services/src/integrations/providers/feishu/*` provider 级事件、归一化、入站、出站、worker、health、credentials、data plane。
- `apps/web/features/integrations/feishu/*` 设置页、agent bot 绑定、健康检查、资源绑定、operation run UI。
- `apps/cli/src/commands/integrations/feishu.ts` CLI 管理和 smoke/evidence。

Slack 接入不应重新造一套并行系统，而应作为第二个 provider 验证 TODO84 的 adapter contract 是否足够通用。

## 当前落地进度

2026-07-07 在 `codex/slack-integration` 上已开始实现：

- Slack provider descriptor / registry 导出。
- Slack credentials 加密读写。
- Slack Events API URL verification、request signature、callback app/team 校验。
- `app_mention` / `message.im` 归一化。
- 绑定 channel/user 后的基础 inbound dispatch。
- `chat.postMessage` outbox payload、发送、rate limit retry 处理。
- Web route：`/api/integrations/slack/events`。
- CLI：`integrations slack create|bind-channel|bind-user|health-check|outbox drain`。
- Settings UI：创建 Slack 集成、健康检查、复制回调 URL、频道映射、用户映射、自助用户绑定、最近入站/出站失败摘要。
- Settings data/actions：管理员视角展示 app/team/callback/health/outbox/event，成员视角仅展示自己的 Slack 身份绑定；所有外部 Slack ID 只暴露 redacted reference。
- Socket Mode worker：`integrations slack worker`、`apps.connections.open`、先 ack 再处理、dry-run、outbox drain、metrics、degraded health、systemd/docker deploy sample，并复用 Block Kit callback processor 处理 Socket Mode `interactive` approval payload。
- Health/readiness/smoke/evidence 辅助：`auth.test`、`apps.connections.open` dry check、scope/header 校验和 manual review、`readiness|smoke-plan|smoke-env|evidence` CLI、`scripts/slack/smoke.ts --check-env` dry-run 和 `--replay-webhook` 本地签名 replay；`smoke-plan` 输出 Slack `features.agent_view` manifest 草案，`evidence` 从本地 event/mapping/outbox/binding 记录汇总 message/native/approval/files 验收信号。
- OAuth hosted install：`/api/integrations/slack/oauth/start` 生成 signed state 并跳转 Slack 授权页，`/callback` 校验同一登录用户和 workspace admin 权限，交换 `oauth.v2.access` 后创建或刷新 Slack 集成；Settings UI 展示 Add to Slack 入口，env example 增加 client/signing secret 配置。
- Agent-scoped Slack bot 管理第一段：service 层支持 `agentId` 绑定/停用/查询，CLI 支持 `bind-agent-bot` / `disable-agent-bot`，Settings 可以显示 Agent Bot 统计和绑定 Agent，入站 dispatch 复用 `integration.agentId` 直接路由到指定 Agent。
- Agent-scoped 多 bot 同频道：gated DB 验收覆盖同一 Slack channel 中两个 agent-scoped Slack bot 按各自 app/bot 路由到不同 AgentSpace agent。
- Slack outbound 主链路第一段：web daemon / CLI daemon 完成或失败任务时会同时 best-effort queue Slack thread reply；Slack outbox 支持 Block Kit `blocks`，并继续使用 `chat.postMessage` fallback `text`。
- Block Kit approval：`/api/integrations/slack/interactions` 支持 Slack form payload + request signing，`block_actions` 会校验 app/team、Slack user binding、AgentSpace admin/owner 身份、approval payload hash；已支持 `runtime_tool` 审批和 Feishu `external_data_operation` provider-specific review/execution，并将审批结果回写原 Slack thread。
- Slack native agent context：`app_context_changed`、`message.im` 的 `app_context` / `context` 会落安全摘要，只保存 entity type 和 redacted reference，不保存原始 Slack ID；成功 dispatch 的 workspace message data、agent task prompt 和 message mapping 会携带相同 context 摘要。
- Slack app home onboarding / suggested prompts：`app_home_opened` 的 Messages tab 首次打开会幂等排队一条 welcome Block Kit 消息，并通过 outbox 调用 `assistant.threads.setSuggestedPrompts`；mapping / outbox metadata 只保存 redacted reference。
- Slack files metadata-only：`files[]` 入站事件只归一化 redacted file reference、文件名、MIME、size 和 redaction flags；不保存 Slack raw file id / private URL，也不把 private URL 暴露给 agent。
- Slack inbound file download：HTTP / Socket Mode async inbound 可用 bot token 调 `files.info`，再带 Bearer header 下载 Slack private file URL，按大小/类型/host/timeout 策略落 AgentSpace attachment storage；mapping/evidence 只记录 redacted storage proof。
- Slack outbound file upload：AgentSpace 附件回复会额外排 `slack_file_upload` outbox，按 Slack external upload flow 调 `files.getUploadURLExternal`、上传文件字节，再用 `files.completeUploadExternal` 分享到 Slack thread；不使用 deprecated `files.upload`。
- 单元测试覆盖签名、challenge、归一化、outbound、Block Kit action parsing、interactions route、OAuth start/callback/exchange、agent-bot CLI、CLI help、settings data/action、settings client 兼容性、socket worker、health/readiness/smoke dry-run 和 evidence report。

尚未完成：

- 真实 Slack 租户上的 disposable live smoke：`post_message`、`app_mention` -> AgentSpace -> outbox reply、`file_upload`，以及最终 `slack evidence --strict --require all`。

## 官方能力调研

截至 2026-07-08，Slack 官方文档显示以下能力与 AgentSpace 相关：

### Events API

官方文档：

- <https://docs.slack.dev/apis/events-api/>
- <https://docs.slack.dev/apis/events-api/using-http-request-urls>
- <https://docs.slack.dev/apis/events-api/using-socket-mode/>

关键事实：

- Events API 支持两种投递方式：
  - HTTP Request URL。
  - Socket Mode。
- Slack event 与 OAuth scopes 绑定，app 只能收到它有权看到的事件。
- HTTP 模式要求快速返回 2xx，官方建议尽快 ack，再异步处理业务逻辑。
- Socket Mode 下不需要公网 Request URL，但需要 app-level token，并且每个 envelope 都要 ack。

对 AgentSpace 的设计影响：

- `http_webhook` 和 `websocket_worker` 两种 `ExternalIntegrationTransportMode` 都可以继续沿用。
- HTTP route 必须轻量，不能在请求生命周期里跑长任务。
- worker 模式适合 self-hosted / systemd / container，不适合作为 serverless 唯一方案。

### Request signing

官方文档：

- <https://docs.slack.dev/authentication/verifying-requests-from-slack/>

关键事实：

- Slack HTTP 请求带 `X-Slack-Signature` 和 `X-Slack-Request-Timestamp`。
- 需要用 signing secret、timestamp、raw body 计算 HMAC SHA256。
- timestamp 应限制在约 5 分钟窗口内以防重放。
- 新实现应使用 signing secret，不依赖旧 verification token。

对 AgentSpace 的设计影响：

- `apps/web/app/api/integrations/slack/events/route.ts` 必须先读取 raw body，再 JSON parse。
- `slack/events.ts` 需要提供 timing-safe signature verification。
- 失败事件要记录 safe summary，不能保存 token 或完整 raw secret。

### OAuth v2

官方文档：

- <https://docs.slack.dev/authentication/installing-with-oauth>

关键事实：

- Slack OAuth v2 通过 `https://slack.com/oauth/v2/authorize` 请求 scopes。
- code exchange 走 `oauth.v2.access`。
- 成功响应会返回 bot access token、`app_id`、`team.id`、`bot_user_id` 等。

对 AgentSpace 的设计影响：

- Hosted 安装已提供 "Add to Slack"，并继续保留 self-hosted 手动填 `botToken`、`signingSecret`、可选 `appLevelToken` 的路径。
- Slack OAuth 不返回 signing secret，因此 AgentSpace web 进程仍需要 `AGENT_SPACE_SLACK_SIGNING_SECRET`。
- `external_integration.appId` 保存 Slack `app_id`。
- `external_integration.tenantKey` 保存 Slack `team_id`，Enterprise Grid 后续可扩展为 `enterprise_id:team_id` 或在 metadata 中保存 enterprise id。

### Web API / messaging

官方文档：

- <https://docs.slack.dev/tools/node-slack-sdk/web-api/>
- <https://docs.slack.dev/reference/methods/chat.postMessage/>
- <https://docs.slack.dev/reference/methods/conversations.history/>
- <https://docs.slack.dev/reference/methods/conversations.replies/>
- <https://docs.slack.dev/apis/web-api/rate-limits/>

关键事实：

- 官方 Node SDK 包为 `@slack/web-api`，核心 client 是 `WebClient`。
- `chat.postMessage` 可以发到 public channel、private channel、DM/IM。
- `chat.postMessage` 的 `channel` 为目标 conversation id；线程回复使用 `thread_ts`。
- `conversations.history` / `conversations.replies` 需要 `channels:history`、`groups:history`、`im:history`、`mpim:history` 等 scopes。
- 2025 起非 Marketplace 商业分发 app 的 history/replies rate limit 更严格，设计上不能依赖大规模主动拉历史。
- rate limit 返回 HTTP 429 和 `Retry-After`。

对 AgentSpace 的设计影响：

- MVP 只依赖事件 payload 和 thread id，不主动拉全量历史。
- Outbox drain 必须识别 429，读取 retry window，写入 `nextAttemptAt`。
- `conversation.history/replies` 只用于必要的 thread context 补足，且必须受 channel/user 权限和 rate limit 控制。

### Slack agent / AI app 体验

官方文档：

- <https://docs.slack.dev/ai/developing-agents/>
- <https://docs.slack.dev/ai/agent-entry-and-interaction/>
- <https://docs.slack.dev/concepts/agent-design/>
- <https://docs.slack.dev/changelog/>

关键事实：

- Slack 支持原生 agent 体验，入口包括 app mentions、DM、top bar / split pane。
- 2026-06-30 Slack 引入 `agent_view`，新 app 更应面向 Agent messaging experience。
- Agent messaging experience 建议订阅 `app_home_opened`、`app_context_changed`、`message.im`。
- Slack 官方强调 agent 必须尊重数据边界：不应读取或使用调用者无权访问的频道、文件、canvas、list、huddle 等上下文。

对 AgentSpace 的设计影响：

- MVP 先支持 `app_mention` + `message.im`。
- Phase 2 再考虑 `agent_view`、`app_context_changed` 和 Slack-native suggested prompts。
- 所有 Slack context 都要进入 AgentSpace workspace data policy，默认作为 `external_untrusted_user_content`。

### Files

官方文档：

- <https://docs.slack.dev/changelog/2024-04-a-better-way-to-upload-files-is-here-to-stay/>
- <https://docs.slack.dev/messaging/working-with-files/>
- <https://docs.slack.dev/reference/methods/files.info>
- <https://docs.slack.dev/reference/objects/file-object>

关键事实：

- 新 Slack app 不能继续依赖旧 `files.upload`。
- 需要使用新的 external upload flow 或 SDK `uploadV2`。

对 AgentSpace 的设计影响：

- MVP 不做 Slack file 回写。
- 如果支持附件出站，必须走 `uploadV2` 或底层 `files.getUploadURLExternal` + `files.completeUploadExternal`。
- 入站文件下载要按 Slack file permissions 和 token scope 单独设计，不能当成普通 URL 直读。
- `url_private` / `url_private_download` 必须使用 Bearer token 拉取，不能把 Slack private URL 当成可公开访问链接保存或暴露给 agent。

## 当前 AgentSpace 代码事实

### 可复用的通用层

- `packages/services/src/integrations/core/types.ts`
  - `IntegrationProviderDescriptor`
  - `IntegrationRuntimeContext`
  - `ExternalMessageEnvelope`
  - `AgentSpaceOutboundMessage`
- `packages/services/src/integrations/core/message-transport.ts`
  - `MessageTransportAdapter`
  - `IncomingMessageRequest`
  - `ExternalOutboundMessagePayload`
- `packages/services/src/integrations/core/registry.ts`
  - provider registry。
- `packages/services/src/integrations/core/outbox.ts`
  - `enqueueExternalOutboundMessageSync(...)`
  - `listDueExternalOutboundMessagesSync(...)`

结论：Slack provider 应实现 `MessageTransportAdapter`，并通过 registry 暴露。

### 可复用的 DB 表

- `external_integration`
- `external_channel_binding`
- `external_user_binding`
- `external_thread_binding`
- `external_message_mapping`
- `external_message_outbox`
- `external_integration_event`

关键事实：

- `ExternalIntegrationProvider` 是 `string`。
- `ExternalResourceBindingProviderType` 是 `string`。
- `ExternalIntegrationTransportMode` 已有 `"http_webhook" | "websocket_worker"`。

结论：Slack MVP 不需要 schema migration。需要新增 provider 常量与 metadata 规范即可。

### 可复用的业务主链路

- 入站消息应继续走 `sendChannelHumanMessageSync(...)`。
- Agent 回复应继续由 `completeAgentChannelReplySync(...)` 落内部消息。
- Slack 回写应从 outbox drain 读取，不应绕过内部消息主链路。
- 外部消息上下文应继续使用 `ExternalMessageInputContext`：
  - `provider: "slack"`
  - `providerLabel: "Slack"`
  - `trust: "untrusted_user_message"`

### Feishu 中可借鉴但不应照搬的部分

可借鉴：

- credentials 加密存储模式。
- HTTP route 先 resolve integration，再验签，再处理 challenge/event。
- worker 启动多个 active integration。
- outbox retry / failure visibility。
- settings data 汇总和 redacted external id reference。
- agent-scoped bot binding 和 external guest policy。

不应照搬：

- Feishu Docs/Sheets/Base data plane。
- Feishu card schema。
- Feishu OpenAPI scope names。
- lark-cli runtime capability。

## 产品目标

### MVP 目标

1. 管理员可在 AgentSpace 中创建 Slack integration。
2. 管理员可绑定 Slack channel 到 AgentSpace channel。
3. 管理员或用户可绑定 Slack user 到 AgentSpace user。
4. Slack `app_mention` 可进入绑定 channel，触发对应 AgentSpace agent。
5. Slack `message.im` 可作为 direct/agent DM 触发。
6. Agent 回复可回写到 Slack thread。
7. 未绑定用户、未绑定 channel、权限不足、runtime 不可用都有可见但安全的提示。
8. Outbox 失败可重试并在 settings/CLI 中可见。
9. Slack signing secret、bot token、app-level token 加密存储，不进入 snapshot 和 prompt。
10. 覆盖单元测试、route 测试、outbox 测试、smoke harness。

### Phase 2 目标

1. 支持 agent-scoped Slack bot / Slack app binding。
2. 支持 Slack `agent_view` / `app_context_changed` 的原生 agent 体验。
3. 支持 Slack channel 自动 provision 到 AgentSpace channel。
4. 支持 external guest policy 对未绑定 Slack 用户的低权限交互。
5. 支持 Block Kit 审批卡片和 button callback。

### Phase 3 目标

1. 支持 Slack 文件入站附件下载和安全存储。
2. 支持 Slack 文件出站上传，使用 `uploadV2` 或 external upload flow。
3. 按权限有限支持 `conversations.replies` 补足 thread context。
4. 评估 Slack Canvas / Lists / MCP / Real-time Search 是否作为独立 data plane provider 接入。

## 非目标

1. MVP 不做 Slack Marketplace 分发。
2. MVP 不做 Slack Canvas / Lists / Workflow Builder / MCP / Real-time Search。
3. MVP 不读取 Slack 全量历史消息。
4. MVP 不把 Slack workspace member 自动变成 AgentSpace workspace member。
5. MVP 不让 Slack channel membership 等价为 AgentSpace channel membership。
6. MVP 不让 Slack app/bot 自己决定 AgentSpace 权限。
7. MVP 不在 prompt 中暴露 Slack raw user id、channel id、team id、token、file url。
8. MVP 不做 attachment 出站上传。
9. MVP 不支持 Enterprise Grid 的完整 org-level install，只保存必要 metadata 并为后续预留。
10. MVP 不做多 Slack workspace 到同一 AgentSpace workspace 的复杂租户合并体验。

## 硬性约束

1. AgentSpace 是唯一权限事实源。
2. Slack inbound event 必须幂等，不能因 retry 重复创建任务。
3. Slack HTTP inbound 必须验签和校验 timestamp。
4. Slack Socket Mode 必须 ack envelope。
5. Slack token / signing secret / app-level token 必须加密存储。
6. Slack provider 错误必须脱敏。
7. Outbox 发送失败不能回滚内部消息，只能标记失败并可重试。
8. `chat.postMessage` 429 必须尊重 `Retry-After`。
9. 未绑定 Slack channel 默认不能创建内部 channel，除非 Phase 2 显式开启 auto-provision policy。
10. 未绑定 Slack user 默认不能以 workspace member 身份触发 agent；Phase 2 external guest 也必须受低权限 policy 管控。
11. Slack event payload 中的用户文本永远是不可信输入。
12. Slack app context 不得绕过 AgentSpace document/channel/runtime 权限。

## 推荐 Slack app scopes

MVP bot scopes：

```text
app_mentions:read
chat:write
channels:read
groups:read
im:read
im:history
users:read
users:read.email (optional, 仅用于身份绑定建议)
```

按能力增加：

```text
channels:history   # 若要读取 public channel thread/history
groups:history     # 若要读取 private channel thread/history
mpim:history       # 若要读取 group DM
files:read         # 入站文件下载
files:write        # 出站文件上传
assistant:write    # Slack agent_view / assistant APIs
```

Socket Mode：

```text
connections:write  # app-level token scope，不是 bot token scope
```

MVP event subscriptions：

```text
app_mention
message.im
app_home_opened
```

Phase 2 event subscriptions：

```text
app_context_changed
member_joined_channel
message.channels (谨慎开启，仅限明确需要)
message.groups   (谨慎开启，仅限明确需要)
```

## Slack app manifest 草案

HTTP webhook 模式：

```yaml
display_information:
  name: AgentSpace
features:
  bot_user:
    display_name: AgentSpace
    always_online: false
oauth_config:
  redirect_urls:
    - https://CHANGE_ME_AGENTSPACE_URL/api/integrations/slack/oauth/callback
  scopes:
    bot:
      - app_mentions:read
      - chat:write
      - channels:read
      - groups:read
      - im:read
      - im:history
      - users:read
settings:
  event_subscriptions:
    request_url: https://CHANGE_ME_AGENTSPACE_URL/api/integrations/slack/events?workspaceId=CHANGE_ME_WORKSPACE_ID&integrationId=CHANGE_ME_INTEGRATION_ID
    bot_events:
      - app_mention
      - message.im
      - app_home_opened
  interactivity:
    is_enabled: true
    request_url: https://CHANGE_ME_AGENTSPACE_URL/api/integrations/slack/interactions?workspaceId=CHANGE_ME_WORKSPACE_ID&integrationId=CHANGE_ME_INTEGRATION_ID
  socket_mode_enabled: false
  token_rotation_enabled: false
```

Socket Mode 模式：

```yaml
display_information:
  name: AgentSpace
features:
  bot_user:
    display_name: AgentSpace
    always_online: false
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - chat:write
      - channels:read
      - groups:read
      - im:read
      - im:history
      - users:read
settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.im
      - app_home_opened
  interactivity:
    is_enabled: true
  socket_mode_enabled: true
  token_rotation_enabled: false
```

## 核心映射模型

```text
Slack App/Bot       <-> ExternalIntegration(provider="slack")
Slack Team          <-> tenantKey / metadata.teamId
Slack Enterprise    <-> metadata.enterpriseId
Slack Channel/IM    <-> ExternalChannelBinding.externalChatId
Slack User          <-> ExternalUserBinding.externalUserId
Slack Message ts    <-> ExternalMessageMapping.externalMessageId
Slack thread_ts     <-> ExternalThreadBinding.externalThreadId
Slack File          <-> MessageAttachment / future external file binding
```

唯一性建议：

```text
(workspaceId, provider="slack", appId, tenantKey) 唯一定位 integration
(workspaceId, integrationId, externalChatId) 唯一定位 channel binding
(workspaceId, integrationId, externalUserId) 唯一定位 user binding
(workspaceId, integrationId, externalChatId, externalThreadId) 唯一定位 thread binding
(workspaceId, integrationId, externalMessageId) 唯一定位 message mapping
```

Slack id 字段建议：

```text
appId: Slack api_app_id / app_id
tenantKey: Slack team_id
externalChatId: event.channel / channel.id
externalChatType: channel | group | im | mpim
externalUserId: event.user / user.id
externalMessageId: event.ts
externalThreadId: event.thread_ts ?? event.ts
externalEventId: outer event_id 或 Socket Mode envelope_id fallback
```

## 数据模型草案

MVP 复用 `external_integration`：

```ts
interface SlackIntegrationConfig {
  eventCallbackPath: "/api/integrations/slack/events";
  interactionCallbackPath?: "/api/integrations/slack/interactions";
  team?: {
    id: string;
    name?: string;
    domain?: string;
  };
  enterprise?: {
    id?: string;
    name?: string;
  };
  bot?: {
    botUserId?: string;
    botId?: string;
    name?: string;
    lastHealthCheckedAt?: string;
  };
  capabilities: {
    messageTransport: true;
    agentView?: boolean;
    files?: boolean;
  };
}
```

Encrypted credentials：

```ts
interface SlackPlainCredentials {
  botToken: string;       // xoxb-
  signingSecret?: string;
  appLevelToken?: string; // xapp-, only Socket Mode
  clientId?: string;      // OAuth hosted flow
  clientSecret?: string;  // OAuth hosted flow
}
```

Provider descriptor：

```ts
export const SLACK_PROVIDER_DESCRIPTOR: IntegrationProviderDescriptor = {
  provider: "slack",
  displayName: "Slack",
  capabilities: ["message_transport"],
  supportedTransportModes: ["http_webhook", "websocket_worker"],
  defaultScopes: [
    "app_mentions:read",
    "chat:write",
    "channels:read",
    "groups:read",
    "im:read",
    "im:history",
    "users:read",
  ],
  resourceTypes: [],
};
```

## 代码落点

### Services provider

新增：

```text
packages/services/src/integrations/providers/slack/constants.ts
packages/services/src/integrations/providers/slack/credentials.ts
packages/services/src/integrations/providers/slack/client.ts
packages/services/src/integrations/providers/slack/events.ts
packages/services/src/integrations/providers/slack/normalize-message.ts
packages/services/src/integrations/providers/slack/inbound.ts
packages/services/src/integrations/providers/slack/outbound.ts
packages/services/src/integrations/providers/slack/socket-worker.ts
packages/services/src/integrations/providers/slack/health.ts
packages/services/src/integrations/providers/slack/agent-bot-bindings.ts
packages/services/src/integrations/providers/slack/index.ts
```

依赖建议：

```text
packages/services/package.json
  @slack/web-api
  @slack/socket-mode (仅当不用 Bolt 且需要 SDK 管理 Socket Mode)
  @slack/types (可选，类型辅助)
```

第一版不建议引入 `@slack/bolt` 作为主依赖，因为 AgentSpace 已有自己的 event/outbox/policy/service contract。可以在 smoke harness 或 spike 中比较。

### 2026-07-08 SDK spike 结论

核验来源：

- Slack Socket Mode 官方文档：<https://docs.slack.dev/apis/events-api/using-socket-mode/>
- Slack Node SDK 官方文档：<https://docs.slack.dev/tools/node-slack-sdk/>
- Slack Web API 官方文档：<https://docs.slack.dev/tools/node-slack-sdk/web-api/>
- Slack agent 官方文档：<https://docs.slack.dev/ai/developing-agents/>
- npm registry：`npm view @slack/web-api version dist-tags --json`、`npm view @slack/socket-mode version dist-tags dependencies --json`、`npm view @slack/bolt version dist-tags dependencies --json`

当前版本事实：

- `@slack/web-api` latest = `7.19.0`；仓库已使用 `^7.19.0`，与 Slack 官方 reference 当前 `@slack/web-api v7.19.0` 一致。
- `@slack/socket-mode` latest = `2.0.7`，依赖 `ws`、`@types/ws`、`eventemitter3`、`@slack/logger`、`@slack/web-api@^7.15.0`。
- `@slack/bolt` latest = `4.7.3`，会引入 Express/OAuth/Socket Mode 等框架层依赖；它适合从零构建 Slack app，但会和 AgentSpace 已有 HTTP route、OAuth state、integration registry、outbox、permission policy、event audit 边界重叠。

决策：

- 保留 `@slack/web-api` 作为唯一 Slack SDK 运行时依赖，负责 `auth.test`、`chat.postMessage`、file external upload、assistant suggested prompts 等 Web API 调用。
- 第一版不引入 `@slack/bolt`。AgentSpace 已经有自己的 route/action/service 分层，Bolt 的 receiver、middleware、OAuth、listener 抽象会让 Slack provider 绕过或重复现有治理边界。
- 第一版也不引入 `@slack/socket-mode`。Slack 官方文档明确 Socket Mode 可以自行实现：调用 `apps.connections.open` 获取临时 WebSocket URL、连接、收到 envelope 后用 `envelope_id` ack。当前 `packages/services/src/integrations/providers/slack/socket-worker.ts` 已按这个协议实现，并且在 Node 24 上可用全局 `WebSocket`，不需要额外 `ws` 依赖。
- 保留后续切换点：`startSlackSocketModeWorker(...)` 已接受 `sessionFactory` 注入；如果未来需要 SDK 自带重连策略、多连接管理或兼容更老 Node 运行时，可以局部替换 session factory 为 `@slack/socket-mode`，不改变 inbound/outbox/policy 主链路。

验收证据：

- `packages/services/package.json` 仅新增 `@slack/web-api`，没有引入 `@slack/bolt` / `@slack/socket-mode`。
- `packages/services/src/integrations/providers/slack/socket-worker.ts` 覆盖 `apps.connections.open`、WebSocket session、envelope ack、interactive routing、inbound dispatch、outbox drain 和 health degraded 更新。
- `packages/services/src/integrations/providers/slack/__tests__/socket-worker.test.ts` 覆盖 app-level token header、dry-run、ack-before-dispatch、Block Kit interaction routing、app/team mismatch、disconnect degraded health。

### Web routes

新增：

```text
apps/web/app/api/integrations/slack/events/route.ts
apps/web/app/api/integrations/slack/interactions/route.ts
apps/web/app/api/integrations/slack/oauth/start/route.ts
apps/web/app/api/integrations/slack/oauth/callback/route.ts
```

HTTP event route 流程：

```text
read raw body
parse JSON
resolve workspaceId/integrationId
read integration + decrypt credentials
verify X-Slack-Signature + timestamp
if url_verification: return challenge
validate app_id/team_id matches integration
record external_integration_event
normalize event
dedup by event_id/message ts
dispatch inbound event
drain outbox best effort
return 200 quickly
```

### CLI

新增：

```text
apps/cli/src/commands/integrations/slack.ts
scripts/slack/README.md
scripts/slack/env.example
scripts/slack/smoke.ts
```

命令草案：

```text
agent-space integrations slack create --workspace-id <id> --env-file scripts/slack/.env --bot-token-env SLACK_BOT_TOKEN --signing-secret-env SLACK_SIGNING_SECRET [--app-level-token-env SLACK_APP_TOKEN] [--json]
agent-space integrations slack bind-channel --workspace-id <id> --integration <id> --channel <agent-space-channel> --slack-channel <C...|G...|D...> [--json]
agent-space integrations slack bind-user --workspace-id <id> --integration <id> --user-id <agent-space-user-id> --slack-user <U...> [--json]
agent-space integrations slack worker --workspace-id <id> [--integration <id>] [--once] [--dry-run] [--drain-outbox] [--json]
agent-space integrations slack health-check --workspace-id <id> --integration <id> [--strict] [--json]
agent-space integrations slack readiness --workspace-id <id> [--integration <id>] [--strict] [--json]
agent-space integrations slack evidence --workspace-id <id> [--integration <id>] [--strict] [--require message|native|approval|files|all] [--json]
agent-space integrations slack smoke-plan --workspace-id <id> --integration <id> --app-url <url> [--json]
agent-space integrations slack smoke-env --workspace-id <id> --integration <id> --app-url <url> [--json]
agent-space integrations slack outbox drain --workspace-id <id> [--integration <id>] [--json]
```

### Web settings

短期：

```text
apps/web/features/integrations/slack/*
```

中期重构：

```text
apps/web/features/integrations/common/*
apps/web/features/integrations/feishu/*
apps/web/features/integrations/slack/*
```

设置页第一版显示：

- Slack integration list。
- Create Slack integration dialog。
- Credentials summary：hasBotToken / hasSigningSecret / hasAppLevelToken。
- Callback URL / manifest snippet。
- Health status。
- Channel bindings。
- User bindings。
- Recent inbound events。
- Recent outbox failures。

后续再做：

- Agent-scoped Slack bot panel。
- Slack agent_view setup reference。
- Block Kit external data operation approval cards / receipts。
- External guest policy。

### Deploy

新增：

```text
deploy/systemd/agentspace-slack-worker.service
deploy/systemd/agentspace-slack-worker.env.example
deploy/slack-worker/docker-compose.yml
deploy/slack-worker/slack-worker.env.example
```

## 实施计划

### Phase 0：准备和 spike

- [x] 复核 Slack 官方文档和 SDK 版本。
- [x] 安装 `@slack/web-api@7.19.0`，验证 Node 24 / TypeScript / ESM import。
- [x] 确认 `@slack/socket-mode` 是否足够轻量，是否比手写 WebSocket + `apps.connections.open` 更合适。
- [x] 输出 Slack app manifest 草案和 self-hosted setup guide。
- [x] 确认 MVP 同时支持手动 token 和 OAuth hosted install。

验收：

- [x] Spike 文档说明 SDK 选择。
- [x] 无 secret 输出。
- [x] 明确 MVP scopes 和 event subscriptions。

### Phase 1：provider skeleton

- [x] 新增 `SLACK_PROVIDER_ID = "slack"`。
- [x] 新增 `SLACK_PROVIDER_DESCRIPTOR`。
- [x] 新增 `slackIntegrationProviderAdapter`。
- [x] 新增 `registerSlackIntegrationProvider()` 并从 `packages/services/src/index.ts` export。
- [x] 加 registry contract test，确保 Feishu 和 Slack 可并存。
- [x] 加 descriptor test，确保 Slack capabilities 仅包含 `message_transport`。

验收：

- [x] `readIntegrationProviderAdapter("slack")` 可返回 adapter。
- [x] 不影响 Feishu provider。

### Phase 2：credentials 加密和 create/list

- [x] 新增 `credentials.ts`。
- [x] 支持 `AGENT_SPACE_SLACK_CREDENTIAL_ENCRYPTION_KEY`，fallback 到 `AGENT_SPACE_INTEGRATION_CREDENTIAL_ENCRYPTION_KEY`。
- [x] 加 `buildEncryptedSlackCredentials(...)`。
- [x] 加 `readSlackIntegrationCredentials(...)`。
- [x] 加 `summarizeSlackStoredCredentials(...)`。
- [x] CLI 支持 `integrations slack create`。
- [x] Web action 支持 create Slack integration。
- [x] Settings data 能列出 Slack integration。

验收：

- [x] credentials 不进入 settings summary / create payload / tests snapshot。
- [x] placeholder token 被拒绝。
- [x] 缺少或无效 encryption key 给出结构化错误 / setup 指引。

### Phase 3：HTTP Events API

- [x] 新增 `events.ts`：
  - [x] `isSlackUrlVerificationPayload(...)`
  - [x] `buildSlackUrlVerificationResponse(...)`
  - [x] `verifySlackRequestSignature(...)`
  - [x] `resolveSlackEventId(...)`
  - [x] `resolveSlackEventType(...)`
  - [x] `resolveSlackCallbackAppId(...)`
  - [x] `resolveSlackCallbackTeamId(...)`
  - [x] `summarizeSlackInboundEventPayload(...)`
- [x] 新增 route `apps/web/app/api/integrations/slack/events/route.ts`。
- [x] route 支持 `url_verification` challenge。
- [x] route 校验 `api_app_id` / `team_id` 与 integration 匹配。
- [x] route 记录 rejected event。
- [x] route 返回安全错误，不泄露签名、token、raw body。

验收：

- [x] 签名正确时通过。
- [x] 签名错误返回 401。
- [x] timestamp 过旧返回 401。
- [x] `url_verification` 返回 Slack challenge。
- [x] `api_app_id` / `team_id` mismatch 被拒绝并记录 safe summary。

### Phase 4：消息归一化

- [x] 新增 `normalize-message.ts`。
- [x] 支持 `app_mention`。
- [x] 支持 `message.im`。
- [x] 忽略 bot 自己发的 message。
- [x] 忽略 message subtype：
  - [x] `bot_message`
  - [x] `message_changed`
  - [x] `message_deleted`
  - [x] `channel_join`
  - [x] 其他非用户文本事件
- [x] text 清理：
  - [x] 去掉当前 bot mention token。
  - [x] 保留普通用户输入，不做命令解析。
  - [x] Slack `<@U...>`、`<#C...|name>`、links 先做安全摘要，不把 raw id 全量塞进 prompt。
- [x] 输出 `ExternalMessageEnvelope`。

字段映射：

```text
provider = "slack"
eventType = outer type + inner event.type
externalEventId = event_id
externalChatId = event.channel
externalMessageId = event.ts
externalThreadId = event.thread_ts ?? event.ts
externalSenderId = event.user
text = cleaned text
attachments = []
rawPayload = summarized payload or original safe subset
```

验收：

- [x] app mention 能归一化为 envelope。
- [x] DM message 能归一化为 envelope。
- [x] bot/self message 不触发。
- [x] duplicate message 不重复派发 task。

### Phase 5：入站 dispatch

- [x] 新增 `inbound.ts`。
- [x] 复用 Feishu inbound 的处理结构，但抽出 provider neutral helper 的候选点。
- [x] 读取 channel binding：
  - [x] Slack channel id -> AgentSpace channel。
  - [x] 未绑定 channel -> 记录 ignored。
  - [x] 未绑定 channel -> queue setup notice。
- [x] 读取 user binding：
  - [x] Slack user id -> AgentSpace user。
  - [x] 未绑定 user -> 记录 ignored。
  - [x] 未绑定 user -> queue identity notice。
- [x] 校验 channel write / runtime access / agent usage。
- [x] 调 `sendChannelHumanMessageSync(...)`。
- [x] 写 `external_message_mapping`。
- [x] 写 thread binding。
- [x] 支持 `externalInput.provider = "slack"`。
- [x] 入站失败写 `external_integration_event.status = failed`。

验收：

- [x] 绑定用户在绑定 channel @agent 可创建 task。
- [x] 未绑定用户不会创建 task。
- [x] 未绑定 channel 不会创建 task。
- [x] 权限不足不会创建 task。
- [x] duplicate event 不会重复创建 task。

证据：

- `packages/services/src/integrations/providers/slack/__tests__/inbound.test.ts` 覆盖普通 Slack app mention 中的 `@Atlas` 会回查 task、记录 thread binding，并在 inbound mapping metadata 中写入 `taskAgentId` / `taskQueueId` / `routerSessionId` / `threadBindingId`；agent-scoped Slack bot mention 同样会注入 `@Atlas` 并写入独立 task evidence，且不落 raw Slack channel/user id。
- `packages/services/src/integrations/providers/slack/__tests__/inbound-db.test.ts` 增加 gated DB 验收 `bound Slack channel app mentions create AgentSpace agent tasks`，在真实 DB-backed workspace 中验证已绑定 Slack channel/user 的普通 app mention `@Atlas` 会创建 task、写 thread binding，并把 task evidence 写入 mapping metadata。
- 2026-07-08 使用临时隔离 Postgres `agent_space_test` 跑通 `AGENT_SPACE_SLACK_INBOUND_DB_TESTS=1 node --experimental-strip-types --test packages/services/src/integrations/providers/slack/__tests__/inbound-db.test.ts`：3 pass / 0 fail，覆盖 agent-scoped 多 bot、普通 bound channel `@agent` task dispatch 和 channel permission denial。
- `packages/services/src/integrations/providers/slack/evidence.ts` 的 message gate 现在要求 inbound mapping 具备 task queue 证据；缺 `taskQueueId` 或 task agent 不匹配会产生 `agent_task_queue_evidence_missing` blocker，避免最终 `--strict --require all` 在未证明 task 创建时误通过。
- `packages/services/src/integrations/providers/slack/__tests__/evidence.test.ts` 覆盖上述正反行为。真实 DB-backed task 创建仍由 `AGENT_SPACE_SLACK_INBOUND_DB_TESTS=1` gated 测试和 live smoke 验收证明。
- `packages/services/src/integrations/core/inbound-dispatch.ts` 抽出 provider-neutral `resolveExternalDispatchedTaskSync(...)` / `resolveExternalDispatchedTaskFromRecords(...)`，Slack 和 Feishu inbound 成功 dispatch 后都复用同一套 task queue evidence 回查逻辑。
- `packages/services/src/integrations/core/inbound-dispatch.ts` 进一步提供 `recordExternalInboundEventSync(...)` 和 `resolveExternalInboundDuplicateMessageSync(...)`，Slack / Feishu 入站都复用同一套 event record + duplicate external message guard。
- `packages/services/src/integrations/core/inbound-dispatch.ts` 提供 `prepareExternalInboundMessageDispatchSync(...)`，统一处理 normalized inbound message 的 non-message ignored、duplicate guard 和 ready-to-dispatch 分支；Slack / Feishu inbound 都在 provider-specific routing / binding / notice 之前复用该 pre-dispatch helper。

### Phase 6：出站和 outbox drain

- [x] 新增 `outbound.ts`。
- [x] 实现 `buildSlackTextOutboundMessage(...)`。
- [x] `messageTransport.buildOutboundMessage(...)` 输出：
  - [x] `channel`
  - [x] `text`
  - [x] `thread_ts`
  - [x] optional `blocks`
- [x] 使用 `@slack/web-api` `WebClient.chat.postMessage(...)`。
- [x] 成功后写 external message mapping。
- [x] 429 时读取 retry-after，写 `nextAttemptAt`。
- [x] `channel_not_found` / `not_in_channel` / `missing_scope` / `invalid_auth` 等错误归一化。
- [x] CLI 支持 drain。
- [x] HTTP route 可 best-effort drain 当前 integration outbox。
- [x] web daemon / CLI daemon 完成或失败任务时 queue Slack thread reply。
- [x] worker 可 drain outbox。

验收：

- [x] Agent 回复写回 Slack thread 的 queue 主链路已接入 daemon。
- [x] rate limit 不丢消息，进入 pending retry。
- [x] terminal failure 可在 settings/CLI 看到。
- [x] outbox 不泄露 bot token。

### Phase 7：Socket Mode worker

- [x] 新增 `socket-worker.ts`。
- [x] 支持 `integrations slack worker`。
- [x] 读取 `appLevelToken`。
- [x] 通过 `apps.connections.open` 或 `@slack/socket-mode` 建立连接。
- [x] 收到 envelope 后先 ack。
- [x] 转给同一套 event processor。
- [x] 支持 dry-run。
- [x] 支持 include webhook integrations 诊断模式。
- [x] 支持 close / metrics / health update。
- [x] 新增 systemd/docker deploy sample。

验收：

- [x] dry-run 能列出 ready/skipped/failed。
- [x] worker 可处理 app_mention。
- [x] worker 可 drain outbox。
- [x] worker 断线更新 degraded health。

### Phase 8：health/readiness/smoke

- [x] 新增 `health.ts`。
- [x] 使用 Slack `auth.test` 校验 token。
- [x] 使用 `apps.connections.open` dry check app-level token。
- [x] 可选读取 bot profile / team info。
- [x] 校验 scopes：
  - [x] 读取 Web API response `x-oauth-scopes` 或调用可验证的 API。
  - [x] 不能自动验证时输出 manual review。
- [x] CLI 支持 `health-check` / `readiness` / `smoke-plan` / `smoke-env`。
- [x] CLI 支持 `evidence` 从本地 event/mapping/outbox/binding 记录汇总 message/native/approval/files 验收信号。
- [x] `scripts/slack/smoke.ts` 支持 dry-run。
- [x] `scripts/slack/smoke.ts --replay-webhook` 支持本地 signed `url_verification` / `app_mention` replay。
- [x] live smoke 支持发送 disposable Slack channel message。

验收：

- [x] 健康检查不会打印 token。
- [x] 缺 scope 给出 missing scopes。
- [x] socket mode token 缺失时给出 next step。
- [x] smoke plan 可指导用户配置 Slack app。
- [x] evidence report 不输出原始 Slack app/team/channel/user/message/event id，并能按 `message|native|approval|files|all` 严格门禁退出。
- [x] message evidence 必须包含 task queue 证据；缺失或 task agent 不匹配时 strict evidence 以 `agent_task_queue_evidence_missing` 阻断。

### Phase 9：Web settings UI

- [x] 新增 Slack settings section。
- [x] 现有 Integrations 页同时装载并渲染 Feishu / Slack sections。
- [x] Create Slack integration form。
- [x] Manifest/callback URL copy section。
- [x] Health panel。
- [x] Channel bindings panel。
- [x] User bindings panel。
- [x] Recent events / outbox failures panel。
- [x] i18n 中文/英文文案。
- [x] 权限：owner/admin 可管理，member 只能看自己的 user binding。

验收：

- [x] owner/admin 可创建 Slack integration。
- [x] owner/admin 可绑定 channel。
- [x] owner/admin 可查看 outbox failure。
- [x] member 不可查看其他用户 external id。
- [x] 所有 external ids 默认 redacted / ref 化展示。

### Phase 10：Agent-scoped Slack bot / native agent experience

承接 Phase 1-9 后做，不阻塞 MVP。

- [x] 支持一个 AgentSpace agent 绑定一个 Slack app/bot。
- [x] agent binding 写入 `external_integration.agentId`。
- [x] Slack `api_app_id` 路由到 agent binding。
- [x] 同一 Slack channel 可有多个 AgentSpace agent bot。
- [x] 单个 agent-scoped integration 的 `app_mention` / `message.im` 可通过 `integration.agentId` 路由到该 agent。
- [x] 支持 Slack `agent_view` manifest。
- [x] 支持 `app_context_changed` 和 `message.im` context。
- [x] 支持 `app_home_opened` welcome/onboarding。
- [x] 支持 suggested prompts。

验收：

- [x] 两个 agent bot 在同一 Slack channel 中可独立路由。
- [x] bot self-loop guard 生效。
- [x] `agent_view` DM 可触发 AgentSpace task。
- [x] Slack app context 只作为受治理的 external context，不绕过 AgentSpace 权限。

证据：

- `packages/services/src/integrations/providers/slack/__tests__/inbound.test.ts` 默认单测覆盖两个 agent-scoped Slack bot 在同一个 Slack channel id 下分别注入自己的 `@agent`、写入独立 `botBindingId` / task / thread metadata，且 metadata 不保存 raw Slack channel id。
- 同一测试文件覆盖 agent-scoped bot 自己发出的 message 在 duplicate lookup / channel binding / AgentSpace dispatch 之前被忽略，避免 self-loop。
- 同一测试文件覆盖 Slack `agent_view` / `message.im` DM 带 `app_context` 时仍先经过 channel write guard 和 agent route guard；传给 AgentSpace 的 `externalContext` 与 mapping metadata 只保留 redacted reference，不保存 raw Slack channel/team/enterprise id。

### Phase 10.5：Slack Block Kit approvals

- [x] 新增 `SLACK_INTERACTION_CALLBACK_PATH` 并写入 CLI / Settings / OAuth / agent bot config。
- [x] 新增 `/api/integrations/slack/interactions` route。
- [x] 支持 Slack `application/x-www-form-urlencoded` interaction payload。
- [x] interaction route 使用 Slack signing secret 验签 raw body。
- [x] `block_actions` 只记录脱敏 summary，不保存 raw action payload/token。
- [x] callback 校验 Slack user binding 和 AgentSpace admin/owner 身份。
- [x] runtime_tool approval 支持 Approve / Reject button callback。
- [x] external_data_operation approval 支持 provider-specific approved execution。
- [x] approval review receipt 回写 Slack thread。
- [x] Socket Mode interactive payload 复用同一 callback processor。

验收：

- [x] Slack Block Kit runtime_tool approval callback 可安全处理。
- [x] 非 admin/owner 或未绑定 Slack user 不能处理 approval。
- [x] payload hash mismatch 不会处理 approval。
- [x] approved external data operation 不会只标记 approved，必须同步执行 provider write 或明确失败。

### Phase 11：Slack files / attachments

后续增强，不阻塞 MVP。当前入站已支持 bot-token 授权下载并落 AgentSpace attachment storage；出站已支持 AgentSpace 正式附件走 Slack external upload flow。

- [x] 入站 files metadata 归一化，并只保存 redacted file reference / 文件名 / MIME / size 等安全摘要。
- [x] 使用 Slack Web API 按权限下载文件。
- [x] 存入 AgentSpace attachment storage。
- [x] 文件内容进入 workspace data policy。
- [x] 出站文件使用 SDK `uploadV2` 或 external upload flow。
- [x] 文件大小、类型、host allowlist、timeout 和 clear failure 策略。
- [x] 可选：接入真正病毒扫描/恶意内容扫描引擎。

证据：

- `packages/services/src/integrations/providers/slack/attachments.ts` 支持 `SlackInboundAttachmentSecurityScanner` 注入，并提供 `AGENT_SPACE_SLACK_ATTACHMENT_SCAN_COMMAND` / `ARGS` / `ENGINE` / `TIMEOUT_MS` / `BLOCK_EXIT_CODES` 配置的 stdin command scanner；下载字节在写入 AgentSpace attachment storage 前必须先通过 scanner。
- clean scan 会在附件和 Slack inbound mapping metadata 中记录 `securityScanStatus=clean`、脱敏 engine/ref；blocked scan 使用结构化 `slack.attachment_security_scan_blocked` 错误阻断落库，不输出 token、文件字节或 Slack private URL。
- `deploy/systemd/agentspace-slack-worker.env.example`、`deploy/slack-worker/slack-worker.env.example`、`scripts/slack/env.example` 均给出 ClamAV `clamscan --no-summary -` 配置示例。
- `packages/services/src/integrations/providers/slack/__tests__/attachments.test.ts` 覆盖 clean scanner evidence、blocked scanner failure、command scanner exit-code 行为。

验收：

- [x] 入站文件不直接把 Slack private URL 暴露给 agent。
- [x] 出站文件不用 deprecated `files.upload`。
- [x] 大文件失败可重试或给出 clear failure。

### Phase 12：provider-neutral 抽象回收

做完 Slack MVP 后再清理，避免预先抽象过度。

- [x] 抽出 common external inbound dispatcher。
- [x] 抽出 common setup notice / identity notice。
- [x] 抽出 common integration settings cards。
- [x] 抽出 common health/outbox panel。
- [x] 抽出 common redacted external id reference。
- [x] 抽出 common worker metrics shape。

证据：

- `packages/services/src/integrations/core/references.ts` 提供 provider-neutral `buildExternalIdHash(...)`、`buildExternalIdReference(...)`、`buildOptionalExternalIdReference(...)`、`buildLabeledExternalIdReference(...)`。
- Slack `buildSlackReference(...)` 现在委托 common helper，保持既有 `ref_<8 hex>` 格式。
- Feishu inbound/event/thread safe references 现在委托 common helper，保持既有 `event <16 hex>` / `<16 hex>` 格式。
- `packages/services/src/integrations/core/references.test.ts` 覆盖稳定 hash、可选引用和 labeled reference。
- `packages/services/src/integrations/core/worker-metrics.ts` 提供 provider-neutral worker metrics 基础字段、初始化 helper 和 outbox metrics 记录 helper。
- Slack Socket Mode worker 复用 common metrics shape，并只扩展 Slack-specific `ackCount` / `ackFailedCount`。
- Feishu WebSocket worker 复用 common metrics shape，并只扩展 Feishu-specific `noticeOutboxCount`。
- `packages/services/src/integrations/core/worker-metrics.test.ts`、Slack socket-worker test、Feishu websocket-worker test 覆盖 common metrics 初始化和 outbox failure 记录。
- `packages/services/src/integrations/core/notices.ts` 提供 provider-neutral `buildExternalNoticeMetadata(...)`，统一写入 provider、outboxSource / noticeSource、noticeType、reasonCode 和安全化 external chat/thread reference。
- Slack inbound setup / identity / permission notices 复用 common notice metadata helper，并保留 `ref_<8 hex>` 引用格式。
- Feishu inbound setup card、plain setup / identity / permission notices、external guest identity card 复用 common notice metadata helper，并保留 `<16 hex>` 引用格式。
- `packages/services/src/integrations/core/notices.test.ts`、Slack inbound tests、Feishu inbound tests 覆盖 notice metadata 类型、reasonCode 和 raw external id 不落 metadata。
- `packages/services/src/integrations/core/inbound-dispatch.test.ts` 覆盖 common inbound event record、non-message ignored pre-dispatch、duplicate external message guard、ready-to-dispatch 分支和 task queue evidence 匹配；Slack inbound 和 Feishu inbound 复用该 helper 后仍保留各自 provider-specific guard / notice / native bot 逻辑。
- `node --experimental-strip-types --test packages/services/src/integrations/providers/feishu/__tests__/*.test.ts` 本地回归通过：141 pass / 53 skipped（skipped 均为需要测试 PostgreSQL 的 DB-gated tests）/ 0 fail。
- `apps/web/features/integrations/integration-health-outbox-panel.tsx` 提供 provider-neutral `IntegrationOutboxFailureList` / `IntegrationInboundEventList`，Slack 和 Feishu settings health panel 共用最近出站失败、最近入站事件、状态 chip 和重试/错误展示逻辑。
- `apps/web/features/integrations/integration-settings-cards.tsx` 提供 provider-neutral `IntegrationMetricGrid`，Slack 和 Feishu settings 顶部 summary cards 共用同一套 metric card 结构并保留现有 CSS class。

验收：

- [x] Feishu 功能不回退。
- [x] Slack 和 Feishu 共用明确 helper，而不是复制大块逻辑。
- [x] 新 provider 接入需要改的文件数明显减少。

证据：

- `packages/services/src/integrations/core/provider-onboarding.ts` 提供 provider-neutral contract checker 和 message-transport provider onboarding checklist；第三个 IM provider 可用同一个 checker 验证 descriptor / message transport / data-plane capability 是否一致，不再复制 Slack/飞书 adapter contract 断言。
- checklist 把必需 provider-owned 文件、少量 shared touch points、可复用 core/web/CLI 模块分开列出；带 Socket Mode / OAuth / attachments / Web settings / CLI 的完整消息 provider 估算 provider-owned 文件数为 23，且不需要修改 `packages/services/src/integrations/core/*` 这些公共文件。
- `packages/services/src/integrations/core/provider-onboarding.test.ts` 覆盖合法 fake adapter、坏 adapter actionable issues、第三个 `teams` provider onboarding checklist；Slack adapter test 也接入 `validateIntegrationProviderAdapterContract(...)`，确保 Slack 当前实现符合通用 contract。

## 测试计划

### Unit tests

- [x] `packages/services/src/integrations/providers/slack/__tests__/events.test.ts`
- [x] `normalize-message.test.ts`
- [x] `inbound-db.test.ts`
- [x] `outbound.test.ts`
- [x] `interactions.test.ts`
- [x] `credentials.test.ts`
- [x] `health.test.ts`
- [x] `socket-worker.test.ts`

覆盖：

- [x] signature valid / invalid / stale。
- [x] url verification challenge。
- [x] app mention normalization。
- [x] DM normalization。
- [x] self/bot event ignored。
- [x] duplicate event ignored。
- [x] missing binding ignored。
- [x] permission denied ignored with notice。
- [x] outbox success。
- [x] outbox rate limit retry。
- [x] outbox terminal provider error。
- [x] Block Kit approval action parsing / payload hash。

### DB tests

- [x] Slack integration create/read/update/status。
- [x] channel binding uniqueness。
- [x] user binding uniqueness。
- [x] message mapping uniqueness。
- [x] outbox retry lifecycle。

### Web route tests

- [x] `apps/web/app/api/integrations/slack/events/route.test.ts`
- [x] `apps/web/app/api/integrations/slack/interactions/route.test.ts`
- [x] challenge route。
- [x] signed event route。
- [x] unsigned event rejected。
- [x] wrong integration rejected。
- [x] event processing failure safe response。

### Web UI tests

- [x] create integration dialog。
- [x] channel binding panel。
- [x] user binding panel。
- [x] health panel。
- [x] member view hides admin-only data。

### CLI tests

- [x] `apps/cli/src/commands/integrations.test.ts` 加 Slack subcommands。
- [x] env-file placeholder rejection。
- [x] JSON output redaction。
- [x] dry-run worker summary。

### Smoke tests

- [x] `npm run smoke:slack -- --check-env --json`
- [x] HTTP challenge dry-run。
- [x] signed event local replay。
- [ ] live `chat.postMessage` disposable channel。
- [ ] live app mention -> AgentSpace message -> outbox reply。
- [ ] `agent-space integrations slack evidence --strict --require all --json`
- [x] `npm run smoke:slack:verify -- --json` 可离线校验 live artifact 覆盖三种 Slack live run、context freshness 和脱敏红线。

证据：

- `scripts/slack/smoke.ts` 的 `--live` 现在支持 `SLACK_SMOKE_LIVE_MODE=post_message|app_mention|file_upload`。默认 `post_message` 继续用 `SLACK_BOT_TOKEN` 发 disposable `chat.postMessage`；`app_mention` 模式使用 `SLACK_SMOKE_POST_TOKEN` 发送 `<@SLACK_SMOKE_BOT_USER_ID> ...`，用于真实触发 Slack Events API；`file_upload` 模式使用 Slack external upload flow 跑 disposable 文件上传，不走 deprecated `files.upload`。
- `scripts/slack/smoke.test.ts` 覆盖 live `app_mention` 模式会使用 post token、发送 bot mention 文本，并且 JSON 输出不泄露 post token、bot token、channel/user/bot 原始 ID。
- `scripts/slack/smoke.ts --live --evidence runtime-output/slack-smoke/live.json` 会累积脱敏 live runs；`agent-space integrations slack evidence --strict --require all --json` 默认读取该路径并校验 fresh artifact、`post_message` live proof、`app_mention` live proof、`file_upload` live proof 和无 raw Slack ID/token/private file URL。
- live smoke evidence artifact 会记录 AgentSpace workspace / integration context，以及 hashed app/team reference；strict final evidence 只接受与当前 workspace/integration 及其 Slack app/team 匹配的 live proof，且 workspace-wide 检查时 live proof 和本地 evidence 必须指向同一个 integration，避免复用其他 Slack 集成的 artifact 误通过。
- live smoke 的 `post_message` / `app_mention` / `file_upload` 三种模式现在都会在发请求前要求 `SLACK_SMOKE_APP_ID` 和 `SLACK_SMOKE_TEAM_ID`，避免生成缺少 app/team context、后续 strict evidence 无法接受的 artifact。
- `--evidence` 只写入 ready 的 live/replay runs；JSON 输出 `evidenceArtifact.written`，dry-run 误带 `--evidence`、env 不完整、Slack API 失败或 webhook replay 失败时都会退出非 0 且不会污染最终 artifact。
- smoke 脚本复用同一 evidence path 时会按当前 workspace/integration/app/team context 过滤历史 runs，避免切换 Slack app 或 integration 后把其他验收上下文混进最终 artifact。
- `--verify-evidence` / `npm run smoke:slack:verify -- --json` 会在最终 AgentSpace evidence 前离线验证 artifact：必须 24 小时内覆盖 `post_message`、`app_mention`、`file_upload` 三种 live run，每条 run 都带 workspace/integration/app/team context，且不能包含 token-like 值、raw Slack id、raw message ts 或 private file URL。
- `smoke-plan`、`smoke-env` 和 final evidence remediation 的 next commands 都包含 `npm run smoke:slack:verify -- --json`，避免操作者跳过 live artifact 离线校验。
- final evidence gate 也要求 live run 具备对应的安全引用：`post_message` 需要 channel/message reference，`app_mention` 需要 channel/bot user reference，`file_upload` 需要 channel/file reference，避免仅凭 `ok=true` 的不完整 artifact 通过。
- strict final evidence 要求累积 artifact 的每条 live run 都自带 workspace/integration/app/team context，且逐条满足 24 小时 freshness；只有旧版单 run artifact 才允许回退使用顶层 context，避免历史 contextless 或 stale runs 在追加新 run 后被误复用。
- strict Slack evidence 会忽略超过 24 小时的本地 event / mapping / outbox 证据；如果旧记录本可满足门禁但 fresh 证据不足，最终报告会以 `local_evidence_stale` 阻断，避免用历史 smoke 误通过验收。
- strict Slack evidence 还要求最近 24 小时内的 healthy health-check；如果 credential/scope/socket 状态已退化或 health-check 过期，最终报告会以 `health_check_required_or_unhealthy` / `health_check_stale_or_missing` 阻断。
- `packages/services/src/integrations/providers/slack/__tests__/evidence.test.ts` 覆盖 strict all 需要 redacted live smoke evidence；`scripts/slack/smoke.test.ts` 覆盖同一 artifact 累积 `post_message` + `app_mention` + `file_upload` 三次 live runs。

## 验收标准

MVP 完成标准：

1. 管理员可创建 Slack integration。
2. Slack app manifest / setup guide 可以直接指导配置。
3. Slack HTTP event route 可通过 Slack URL verification。
4. Slack signed event 验签可靠。
5. 绑定 Slack channel/user 后，`app_mention` 可触发 AgentSpace agent。
6. Agent 回复回写 Slack thread。
7. Slack DM `message.im` 可走受治理 direct/agent 路径。
8. 未绑定、权限不足、runtime 不可用都不会静默失败。
9. Outbox failure 可见、可重试、可脱敏诊断。
10. `npm run typecheck` 通过。
11. `npm run lint:web` 通过。
12. Slack provider targeted tests 通过。
13. Feishu targeted tests 不回退。
14. 本地 `slack evidence --strict --require all` 可证明 message/native/approval/files 信号，且不泄露原始 Slack ID / private file URL。

Phase 2 完成标准：

1. Agent-scoped Slack bot 可绑定。
2. 同 channel 多 agent bot 可路由。
3. Slack `agent_view` 可作为原生 agent DM 入口。
4. Slack app context 进入 AgentSpace policy，不绕过权限。
5. Block Kit approval callback 可安全处理。

## 风险和缓解

### 风险：Slack scopes 过宽

缓解：

- MVP scopes 最小化。
- history/file scopes 作为可选能力，不默认开启。
- Settings 明确显示 missing/extra scopes。

### 风险：Slack event retry 导致重复任务

缓解：

- 以 `event_id` 和 `event.ts` 双重 dedup。
- `external_message_mapping` 唯一约束作为最后防线。

### 风险：self-loop

缓解：

- health check 保存 `bot_user_id` / `bot_id`。
- normalize 阶段过滤 bot/self message。
- outbox mapping 记录 AgentSpace 发出的 Slack message ts。

### 风险：rate limit

缓解：

- 出站遇 429 尊重 `Retry-After`。
- 不主动拉全量 history。
- thread context 只按需读取，并限制数量。

### 风险：Enterprise Grid / Slack Connect

缓解：

- metadata 保存 `enterprise_id`、`team_id`、`is_ext_shared_channel`。
- MVP 将跨 workspace 共享频道标记为需要管理员确认。
- 不用 channel name 做唯一标识。

### 风险：Slack agent_view 变化较新

缓解：

- MVP 不依赖 agent_view。
- Phase 2 独立开关。
- 保留普通 `app_mention` / `message.im` 作为 fallback。

### 风险：UI 继续 Feishu-only 膨胀

缓解：

- Slack 第一版可以复制少量 settings data 模式。
- MVP 后立刻做 Phase 12 provider-neutral UI common extraction。

## 发布策略

### 内部 alpha

- 仅 CLI 创建。
- 仅 HTTP webhook。
- 仅 app mention。
- 仅手动 channel/user binding。

### Self-hosted beta

- 增加 settings UI。
- 增加 Socket Mode worker。
- 增加 smoke plan。
- 增加 outbox failure visibility。

### Hosted beta

- 完善 hosted/Marketplace distribution 配置说明。
- 增加 token rotation 评估。

### Native agent beta

- 增加 agent-scoped Slack bot。
- 增加 agent_view。
- 增加 external guest policy。

## 开放问题

1. Hosted 版第一版已支持 OAuth hosted install，同时保留 self-hosted token 配置。
2. Slack workspace 和 AgentSpace workspace 是否允许多对一？MVP 建议一对一。
3. `message.im` 应映射到 AgentSpace direct channel，还是 agent-specific task channel？MVP 需要产品确认。
4. 未绑定 Slack user 是否允许 external guest？MVP 建议不允许，Phase 2 再做。
5. Slack channel auto-provision 是否默认开启？MVP 建议关闭。
6. Slack 中已支持 `runtime_tool` approval 和 Feishu `external_data_operation` approval 的 Block Kit button；其他 provider 的 external data operation approval 需要先接入 provider-specific execution 后再开放。
7. 是否要接 Slack MCP Server / Real-time Search？建议作为独立 TODO，不并入本 TODO MVP。

## 推荐最小落地顺序

```text
1. provider skeleton + credentials
2. HTTP events route + signature verification
3. app_mention / message.im normalization
4. inbound dispatch through AgentSpace channel/message/task service
5. chat.postMessage outbox drain
6. CLI create/bind/health/smoke
7. settings UI
8. Socket Mode worker
9. OAuth hosted install
10. agent-scoped Slack bot / agent_view
11. files / data plane exploration
```

## PR 拆分建议

1. `feat(slack): add provider descriptor and encrypted credentials`
2. `feat(slack): verify and normalize Slack Events API callbacks`
3. `feat(slack): dispatch bound app mentions into AgentSpace channels`
4. `feat(slack): drain outbound messages with chat.postMessage`
5. `feat(cli): add Slack integration commands`
6. `feat(web): add Slack integration settings`
7. `feat(slack): add Socket Mode worker`
8. `test(slack): add smoke harness and evidence checks`
9. `feat(slack): add OAuth hosted install`
10. `feat(slack): add agent-scoped bot bindings`
11. `feat(slack): support Slack agent messaging experience`

## 未来可能拆出的 TODO

- Slack Agent View Native Experience
- Slack Files Attachment Data Plane
- Slack Canvas / Lists Provider Adapter
- Provider-neutral Integrations Settings UI
- External Guest Policy Common Layer
