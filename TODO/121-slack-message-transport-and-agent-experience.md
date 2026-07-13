# 121. Slack Message Transport + Agent Experience

> 更新时间：2026-07-04
> 状态：规划中，承接 Feishu provider 合并后扩展第二个外部 IM provider
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

## 官方能力调研

截至 2026-07-04，Slack 官方文档显示以下能力与 AgentSpace 相关：

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

- Hosted 平台版最终应提供 "Add to Slack"。
- Self-hosted MVP 可以先支持手动填 `botToken`、`signingSecret`、可选 `appLevelToken`，再补 OAuth。
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

关键事实：

- 新 Slack app 不能继续依赖旧 `files.upload`。
- 需要使用新的 external upload flow 或 SDK `uploadV2`。

对 AgentSpace 的设计影响：

- MVP 不做 Slack file 回写。
- 如果支持附件出站，必须走 `uploadV2` 或底层 `files.getUploadURLExternal` + `files.completeUploadExternal`。
- 入站文件下载要按 Slack file permissions 和 token scope 单独设计，不能当成普通 URL 直读。

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

### Web routes

新增：

```text
apps/web/app/api/integrations/slack/events/route.ts
apps/web/app/api/integrations/slack/interactions/route.ts
apps/web/app/api/integrations/slack/oauth/start/route.ts       # Phase 2
apps/web/app/api/integrations/slack/oauth/callback/route.ts    # Phase 2
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
- Block Kit approval cards。
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

- [ ] 复核 Slack 官方文档和 SDK 版本。
- [ ] 临时安装 `@slack/web-api`，验证 Node 24 / TypeScript / ESM import。
- [ ] 确认 `@slack/socket-mode` 是否足够轻量，是否比手写 WebSocket + `apps.connections.open` 更合适。
- [ ] 输出 Slack app manifest 草案和 self-hosted setup guide。
- [ ] 确认是否要在 MVP 支持 OAuth，还是先手动 token。

验收：

- [ ] Spike 文档说明 SDK 选择。
- [ ] 无 secret 输出。
- [ ] 明确 MVP scopes 和 event subscriptions。

### Phase 1：provider skeleton

- [ ] 新增 `SLACK_PROVIDER_ID = "slack"`。
- [ ] 新增 `SLACK_PROVIDER_DESCRIPTOR`。
- [ ] 新增 `slackIntegrationProviderAdapter`。
- [ ] 新增 `registerSlackIntegrationProvider()` 并从 `packages/services/src/index.ts` export。
- [ ] 加 registry contract test，确保 Feishu 和 Slack 可并存。
- [ ] 加 descriptor test，确保 Slack capabilities 仅包含 `message_transport`。

验收：

- [ ] `readIntegrationProviderAdapter("slack")` 可返回 adapter。
- [ ] 不影响 Feishu provider。

### Phase 2：credentials 加密和 create/list

- [ ] 新增 `credentials.ts`。
- [ ] 支持 `AGENT_SPACE_SLACK_CREDENTIAL_ENCRYPTION_KEY`，fallback 到 `AGENT_SPACE_INTEGRATION_CREDENTIAL_ENCRYPTION_KEY`。
- [ ] 加 `buildEncryptedSlackCredentials(...)`。
- [ ] 加 `readSlackIntegrationCredentials(...)`。
- [ ] 加 `summarizeSlackStoredCredentials(...)`。
- [ ] CLI 支持 `integrations slack create`。
- [ ] Web action 支持 create Slack integration。
- [ ] Settings data 能列出 Slack integration。

验收：

- [ ] credentials 不进入 snapshot / logs / tests snapshot。
- [ ] placeholder token 被拒绝。
- [ ] 缺少 encryption key 给出结构化 next step。

### Phase 3：HTTP Events API

- [ ] 新增 `events.ts`：
  - [ ] `isSlackUrlVerificationPayload(...)`
  - [ ] `buildSlackUrlVerificationResponse(...)`
  - [ ] `verifySlackRequestSignature(...)`
  - [ ] `resolveSlackEventId(...)`
  - [ ] `resolveSlackEventType(...)`
  - [ ] `resolveSlackCallbackAppId(...)`
  - [ ] `resolveSlackCallbackTeamId(...)`
  - [ ] `summarizeSlackInboundEventPayload(...)`
- [ ] 新增 route `apps/web/app/api/integrations/slack/events/route.ts`。
- [ ] route 支持 `url_verification` challenge。
- [ ] route 校验 `api_app_id` / `team_id` 与 integration 匹配。
- [ ] route 记录 rejected event。
- [ ] route 返回安全错误，不泄露签名、token、raw body。

验收：

- [ ] 签名正确时通过。
- [ ] 签名错误返回 401。
- [ ] timestamp 过旧返回 401。
- [ ] `url_verification` 返回 Slack challenge。
- [ ] `api_app_id` / `team_id` mismatch 被拒绝并记录 safe summary。

### Phase 4：消息归一化

- [ ] 新增 `normalize-message.ts`。
- [ ] 支持 `app_mention`。
- [ ] 支持 `message.im`。
- [ ] 忽略 bot 自己发的 message。
- [ ] 忽略 message subtype：
  - [ ] `bot_message`
  - [ ] `message_changed`
  - [ ] `message_deleted`
  - [ ] `channel_join`
  - [ ] 其他非用户文本事件
- [ ] text 清理：
  - [ ] 去掉当前 bot mention token。
  - [ ] 保留普通用户输入，不做命令解析。
  - [ ] Slack `<@U...>`、`<#C...|name>`、links 先做安全摘要，不把 raw id 全量塞进 prompt。
- [ ] 输出 `ExternalMessageEnvelope`。

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

- [ ] app mention 能归一化为 envelope。
- [ ] DM message 能归一化为 envelope。
- [ ] bot/self message 不触发。
- [ ] duplicate message 不重复派发 task。

### Phase 5：入站 dispatch

- [ ] 新增 `inbound.ts`。
- [ ] 复用 Feishu inbound 的处理结构，但抽出 provider neutral helper 的候选点。
- [ ] 读取 channel binding：
  - [ ] Slack channel id -> AgentSpace channel。
  - [ ] 未绑定 channel -> 记录 ignored / queue setup notice。
- [ ] 读取 user binding：
  - [ ] Slack user id -> AgentSpace user。
  - [ ] 未绑定 user -> 记录 ignored / queue identity notice。
- [ ] 校验 channel write / runtime access / agent usage。
- [ ] 调 `sendChannelHumanMessageSync(...)`。
- [ ] 写 `external_message_mapping`。
- [ ] 写 thread binding。
- [ ] 支持 `externalInput.provider = "slack"`。
- [ ] 入站失败写 `external_integration_event.status = failed`。

验收：

- [ ] 绑定用户在绑定 channel @agent 可创建 task。
- [ ] 未绑定用户不会创建 task。
- [ ] 未绑定 channel 不会创建 task。
- [ ] 权限不足不会创建 task。
- [ ] duplicate event 不会重复创建 task。

### Phase 6：出站和 outbox drain

- [ ] 新增 `outbound.ts`。
- [ ] 实现 `buildSlackTextOutboundMessage(...)`。
- [ ] `messageTransport.buildOutboundMessage(...)` 输出：
  - [ ] `channel`
  - [ ] `text`
  - [ ] `thread_ts`
  - [ ] optional `blocks`
- [ ] 使用 `@slack/web-api` `WebClient.chat.postMessage(...)`。
- [ ] 成功后写 external message mapping。
- [ ] 429 时读取 retry-after，写 `nextAttemptAt`。
- [ ] `channel_not_found` / `not_in_channel` / `missing_scope` / `invalid_auth` 等错误归一化。
- [ ] CLI 支持 drain。
- [ ] HTTP route 可 best-effort drain 当前 integration outbox。
- [ ] worker 可 drain outbox。

验收：

- [ ] Agent 回复写回 Slack thread。
- [ ] rate limit 不丢消息，进入 pending retry。
- [ ] terminal failure 可在 settings/CLI 看到。
- [ ] outbox 不泄露 bot token。

### Phase 7：Socket Mode worker

- [ ] 新增 `socket-worker.ts`。
- [ ] 支持 `integrations slack worker`。
- [ ] 读取 `appLevelToken`。
- [ ] 通过 `apps.connections.open` 或 `@slack/socket-mode` 建立连接。
- [ ] 收到 envelope 后先 ack。
- [ ] 转给同一套 event processor。
- [ ] 支持 dry-run。
- [ ] 支持 include webhook integrations 诊断模式。
- [ ] 支持 close / metrics / health update。
- [ ] 新增 systemd/docker deploy sample。

验收：

- [ ] dry-run 能列出 ready/skipped/failed。
- [ ] worker 可处理 app_mention。
- [ ] worker 可 drain outbox。
- [ ] worker 断线更新 degraded health。

### Phase 8：health/readiness/smoke

- [ ] 新增 `health.ts`。
- [ ] 使用 Slack `auth.test` 校验 token。
- [ ] 使用 `apps.connections.open` dry check app-level token。
- [ ] 可选读取 bot profile / team info。
- [ ] 校验 scopes：
  - [ ] 读取 Web API response `x-oauth-scopes` 或调用可验证的 API。
  - [ ] 不能自动验证时输出 manual review。
- [ ] CLI 支持 `health-check` / `readiness` / `smoke-plan` / `smoke-env`。
- [ ] `scripts/slack/smoke.ts` 支持 dry-run。
- [ ] live smoke 支持发送 disposable Slack channel message。

验收：

- [ ] 健康检查不会打印 token。
- [ ] 缺 scope 给出 missing scopes。
- [ ] socket mode token 缺失时给出 next step。
- [ ] smoke plan 可指导用户配置 Slack app。

### Phase 9：Web settings UI

- [ ] 新增 Slack settings section。
- [ ] 或先把现有 Integrations 页改成 Feishu / Slack tabs。
- [ ] Create Slack integration dialog。
- [ ] Manifest/callback URL copy section。
- [ ] Health panel。
- [ ] Channel bindings panel。
- [ ] User bindings panel。
- [ ] Recent events / outbox failures panel。
- [ ] i18n 中文/英文文案。
- [ ] 权限：owner/admin 可管理，member 只能看自己的 user binding。

验收：

- [ ] owner/admin 可创建 Slack integration。
- [ ] owner/admin 可绑定 channel。
- [ ] owner/admin 可查看 outbox failure。
- [ ] member 不可查看其他用户 external id。
- [ ] 所有 external ids 默认 redacted / ref 化展示。

### Phase 10：Agent-scoped Slack bot / native agent experience

承接 Phase 1-9 后做，不阻塞 MVP。

- [ ] 支持一个 AgentSpace agent 绑定一个 Slack app/bot。
- [ ] agent binding 写入 `external_integration.agentId`。
- [ ] Slack `api_app_id` 路由到 agent binding。
- [ ] 同一 Slack channel 可有多个 AgentSpace agent bot。
- [ ] `app_mention` 中 @哪个 bot 就路由到哪个 agent。
- [ ] 支持 Slack `agent_view` manifest。
- [ ] 支持 `app_context_changed` 和 `message.im` context。
- [ ] 支持 `app_home_opened` welcome/onboarding。
- [ ] 支持 suggested prompts。

验收：

- [ ] 两个 agent bot 在同一 Slack channel 中可独立路由。
- [ ] bot self-loop guard 生效。
- [ ] `agent_view` DM 可触发 AgentSpace task。
- [ ] Slack app context 只作为受治理的 external context，不绕过 AgentSpace 权限。

### Phase 11：Slack files / attachments

后续增强，不阻塞 MVP。

- [ ] 入站 files metadata 归一化。
- [ ] 使用 Slack Web API 按权限下载文件。
- [ ] 存入 AgentSpace attachment storage。
- [ ] 文件内容进入 workspace data policy。
- [ ] 出站文件使用 SDK `uploadV2` 或 external upload flow。
- [ ] 文件大小、类型、病毒扫描/安全扫描策略。

验收：

- [ ] 入站文件不直接把 Slack private URL 暴露给 agent。
- [ ] 出站文件不用 deprecated `files.upload`。
- [ ] 大文件失败可重试或给出 clear failure。

### Phase 12：provider-neutral 抽象回收

做完 Slack MVP 后再清理，避免预先抽象过度。

- [ ] 抽出 common external inbound dispatcher。
- [ ] 抽出 common setup notice / identity notice。
- [ ] 抽出 common integration settings cards。
- [ ] 抽出 common health/outbox panel。
- [ ] 抽出 common redacted external id reference。
- [ ] 抽出 common worker metrics shape。

验收：

- [ ] Feishu 功能不回退。
- [ ] Slack 和 Feishu 共用明确 helper，而不是复制大块逻辑。
- [ ] 新 provider 接入需要改的文件数明显减少。

## 测试计划

### Unit tests

- [ ] `packages/services/src/integrations/providers/slack/__tests__/events.test.ts`
- [ ] `normalize-message.test.ts`
- [ ] `inbound.test.ts`
- [ ] `outbound.test.ts`
- [ ] `credentials.test.ts`
- [ ] `health.test.ts`
- [ ] `socket-worker.test.ts`

覆盖：

- [ ] signature valid / invalid / stale。
- [ ] url verification challenge。
- [ ] app mention normalization。
- [ ] DM normalization。
- [ ] self/bot event ignored。
- [ ] duplicate event ignored。
- [ ] missing binding ignored。
- [ ] permission denied ignored with notice。
- [ ] outbox success。
- [ ] outbox rate limit retry。
- [ ] outbox terminal provider error。

### DB tests

- [ ] Slack integration create/read/update/status。
- [ ] channel binding uniqueness。
- [ ] user binding uniqueness。
- [ ] message mapping uniqueness。
- [ ] outbox retry lifecycle。

### Web route tests

- [ ] `apps/web/app/api/integrations/slack/events/route.test.ts`
- [ ] challenge route。
- [ ] signed event route。
- [ ] unsigned event rejected。
- [ ] wrong integration rejected。
- [ ] event processing failure safe response。

### Web UI tests

- [ ] create integration dialog。
- [ ] channel binding panel。
- [ ] user binding panel。
- [ ] health panel。
- [ ] member view hides admin-only data。

### CLI tests

- [ ] `apps/cli/src/commands/integrations.test.ts` 加 Slack subcommands。
- [ ] env-file placeholder rejection。
- [ ] JSON output redaction。
- [ ] dry-run worker summary。

### Smoke tests

- [ ] `npm run smoke:slack -- --check-env --json`
- [ ] HTTP challenge dry-run。
- [ ] signed event local replay。
- [ ] live `chat.postMessage` disposable channel。
- [ ] live app mention -> AgentSpace message -> outbox reply。

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

- 增加 OAuth "Add to Slack"。
- 增加 hosted callback URL 自动生成。
- 增加 token rotation 评估。

### Native agent beta

- 增加 agent-scoped Slack bot。
- 增加 agent_view。
- 增加 external guest policy。

## 开放问题

1. Hosted 版是否必须第一版支持 OAuth，还是先只支持 self-hosted token 配置？
2. Slack workspace 和 AgentSpace workspace 是否允许多对一？MVP 建议一对一。
3. `message.im` 应映射到 AgentSpace direct channel，还是 agent-specific task channel？MVP 需要产品确认。
4. 未绑定 Slack user 是否允许 external guest？MVP 建议不允许，Phase 2 再做。
5. Slack channel auto-provision 是否默认开启？MVP 建议关闭。
6. 是否要在 Slack 中暴露 AgentSpace approval card？MVP 建议先只发链接，Phase 2 再做 Block Kit button。
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
9. agent-scoped Slack bot / agent_view
10. files / data plane exploration
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
9. `feat(slack): add agent-scoped bot bindings`
10. `feat(slack): support Slack agent messaging experience`

## 未来可能拆出的 TODO

- Slack Agent View Native Experience
- Slack Files Attachment Data Plane
- Slack Canvas / Lists Provider Adapter
- Slack OAuth Hosted Distribution
- Provider-neutral Integrations Settings UI
- External Guest Policy Common Layer
