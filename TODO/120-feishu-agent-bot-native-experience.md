# 120. Feishu Agent Bot Native Experience

> 更新时间：2026-06-26
> 状态：规划中，承接 TODO119 之后的产品模型调整
> 关联：`TODO/119-feishu-message-transport-adapter.md`、`TODO/84-integration-adapter-contract.md`、`TODO/80-unified-permission-management.md`、`TODO/85-agent-action-permission-policy.md`、`TODO/113-agent-mention-self-addressing.md`
> 适用范围：Feishu/Lark bot identity、Agent external identity、Feishu group/channel auto provisioning、external guest policy、AgentSpace channel governance

## 一句话结论

TODO119 的第一版把飞书作为 workspace 级外部 IM/data-plane integration 接入 AgentSpace；后续产品体验应升级为：

```text
每个 AgentSpace agent 可以绑定一个自己的 Feishu bot
飞书群聊自动映射为 AgentSpace channel
用户在飞书里直接 @具体 agent bot
AgentSpace 继续负责权限、共享、资源绑定、审批、审计和 runtime 调度
```

不要把用户体验设计成：

```text
@AgentSpace /agent codex ...
```

更自然的体验应该是：

```text
@Codex Bot 帮我看一下这个报错
@HermesAgent Bot 总结一下这个飞书文档
@OpenClaw Bot 查一下这张表
```

飞书里的 bot 是 agent 的外部身份；AgentSpace 仍然是控制平面。

## 背景

我们已讨论并确认几个产品方向：

- 一个统一 AgentSpace bot 再路由到 agent，体验会像命令行，不像 IM 对话。
- 更自然的模型是每个 AgentSpace agent 对应一个 Feishu bot。
- 飞书群聊应映射到 AgentSpace channel，而不是直接映射到单个 agent。
- 同一个飞书群里可以有多个 agent bot；用户 @哪个 bot，就路由到哪个 AgentSpace agent。
- 当 bot 被拉进飞书群时，应自动创建/绑定 AgentSpace channel，降低管理员配置成本。
- 对飞书群里尚未绑定 AgentSpace 账号的用户，不应直接拒绝，而应映射为低权限 external guest，并由管理员策略控制是否回复。
- Docs / Sheets / Base 仍然是 AgentSpace 受治理的数据面资源绑定，不能因为飞书 bot 身份而绕过权限和审批。

## 目标体验

### 管理员最小配置

每个 agent 只需要先绑定一个飞书 bot：

```text
AgentSpace Agent: Codex
Feishu Bot: Codex Bot
必填:
  App ID
  App Secret
```

高级配置收进折叠区：

```text
Verification Token
Encrypt Key
Tenant Key
Transport: WebSocket worker / EventCallback
Docs / Sheets / Base scopes
自动建群策略
未绑定用户策略
```

### 普通用户使用方式

普通用户在飞书群里直接 @agent bot：

```text
@Codex Bot 帮我看一下这个 PR 为什么测试失败
```

AgentSpace 后台处理：

```text
Feishu chat_id -> AgentSpace channel
Feishu app_id / bot identity -> AgentSpace agent
Feishu open_id / union_id -> AgentSpace user 或 external_guest
channel + agent membership + resource policy -> allow / require_approval / deny
```

### 自动建群体验

推荐默认：

```text
用户创建飞书群
用户把 Codex Bot 拉进群
AgentSpace 收到机器人进群事件
AgentSpace 自动创建 channel
AgentSpace 自动绑定 feishuChatId -> channel
AgentSpace 自动把 Codex agent 加入该 channel
Codex Bot 在飞书群发确认卡片
```

如果后续 HermesAgent Bot 也被拉进同一个飞书群：

```text
发现 feishuChatId 已有 channel binding
不创建新 channel
只把 HermesAgent 加入同一个 AgentSpace channel
```

## 产品边界

### 保留在 AgentSpace 的能力

- Agent owner / sharing / membership
- Workspace 和 channel 权限
- Agent 是否可在某个 channel 被调用
- 外部用户身份绑定
- External guest 最小权限策略
- Docs / Sheets / Base resource binding
- 写入审批和 payload hash 校验
- Runtime / daemon 绑定与执行审计
- Outbox、failure visibility、health/evidence

### 不外包给飞书

- 不让飞书群成员列表直接成为 AgentSpace 权限事实源。
- 不让飞书 bot 拥有绕过 AgentSpace 审批的写权限。
- 不让未绑定飞书用户默认获得 workspace member 权限。
- 不因为 bot 在群里就自动授权该 agent 访问所有 channel/resource。
- 不把每个 agent 的配置散落在飞书后台作为唯一真相。

### 非目标

- 不要求普通用户先进入 AgentSpace 前端才能在飞书里试用。
- 不要求每条消息都输入 `/agent` 或 agent selector 命令。
- 不在第一版做飞书群成员全量同步为 AgentSpace members。
- 不在第一版做跨租户 ISV 分发和企业级飞书应用市场上架。

## 核心映射模型

```text
Feishu Bot App <-> AgentSpace Agent
Feishu Chat    <-> AgentSpace Channel
Feishu User    <-> AgentSpace User 或 External Guest
Feishu Thread  <-> AgentSpace Thread / Task context
Feishu Resource <-> AgentSpace channel document / data table
```

推荐唯一性规则：

```text
(provider, tenantKey, feishuAppId) 唯一定位一个 agent bot binding
(provider, tenantKey, feishuChatId) 唯一定位一个 channel binding
(provider, tenantKey, feishuUserId/openId/unionId) 唯一定位一个 user binding 或 guest reference
(provider, tenantKey, feishuChatId, feishuThreadId) 唯一定位一个 thread binding
```

## 数据模型草案

### Agent Bot Binding

新增或扩展 agent-scoped external integration/binding。

```ts
interface ExternalAgentBotBinding {
  id: string;
  workspaceId: string;
  agentId: string;
  provider: "feishu";
  displayName: string;
  transportMode: "websocket_worker" | "http_webhook";
  appId: string;
  tenantKey?: string;
  botOpenId?: string;
  botUnionId?: string;
  botName?: string;
  encryptedCredentialsJson: {
    appSecret: string;
    verificationToken?: string;
    encryptKey?: string;
  };
  scopesJson: string[];
  status: "active" | "disabled" | "error";
  lastHealthStatus: "unknown" | "healthy" | "degraded" | "error";
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}
```

第一版可复用现有 `external_integrations` 表但需要补 `agentId` / `ownerAgentId` 语义；如果会污染 workspace-scoped integration 语义，优先新增表。

### Channel Binding

现有 channel binding 需要支持 auto-provision metadata：

```ts
interface ExternalChannelBinding {
  workspaceId: string;
  provider: "feishu";
  tenantKey?: string;
  externalChatId: string;
  externalChatName?: string;
  channelId: string;
  channelName: string;
  provisionSource: "manual" | "bot_added" | "first_message" | "agentspace_created";
  reviewStatus: "approved" | "pending_admin_review" | "needs_identity_binding";
  createdByExternalActorRef?: string;
}
```

### Channel Agent Membership

Agent bot 被加入飞书群时，应同步 AgentSpace channel agent membership：

```ts
interface ChannelAgentMembership {
  workspaceId: string;
  channelId: string;
  agentId: string;
  source: "manual" | "feishu_bot_added";
  status: "active" | "disabled";
}
```

如果当前 domain 已有 agent-channel 可见性/启用关系，复用现有模型，不另建并行事实源。

### External Guest Actor

未绑定飞书用户不要创建真实登录 user，使用 message/task actor 层的 guest reference：

```ts
interface ExternalGuestActor {
  actorType: "external_guest";
  provider: "feishu";
  workspaceId: string;
  tenantKey?: string;
  providerUserRefHash: string;
  providerDisplayName?: string;
  sourceChatId: string;
  permissionProfile: "none" | "channel_context_only" | "channel_readonly";
}
```

### External Participant Policy

```ts
interface ExternalParticipantPolicy {
  workspaceId: string;
  provider: "feishu";
  scope: "workspace" | "channel";
  channelId?: string;
  unboundUserMode:
    | "ignore"
    | "reply_on_mention"
    | "reply_all"
    | "require_identity";
  guestPermissionProfile:
    | "none"
    | "channel_context_only"
    | "channel_readonly";
  requireIdentityFor:
    | "writes"
    | "approvals"
    | "private_resources"
    | "runtime_sensitive_tools";
}
```

默认建议：

```text
unboundUserMode = reply_on_mention
guestPermissionProfile = channel_context_only
写入 / 审批 / 私有资源 / 高风险工具全部要求绑定真实身份
```

### Thread Binding

```ts
interface ExternalThreadBinding {
  workspaceId: string;
  provider: "feishu";
  tenantKey?: string;
  externalChatId: string;
  externalThreadId?: string;
  channelId: string;
  agentId: string;
  taskId?: string;
  lastMessageAt: string;
}
```

用途：

- 同一个飞书 thread 后续消息继续关联同一个 AgentSpace task/context。
- 若用户在同一 thread @另一个 agent bot，允许创建协作/切换记录，而不是覆盖原绑定。

## 事件与接入方式

### WebSocket worker 默认

快速开始默认使用 WebSocket worker：

```text
必填: App ID + App Secret
可选: Tenant Key
```

原因：

- 不要求公网 HTTPS callback。
- 入门门槛低。
- 更适合“每个 agent 一个 bot”的多 bot 场景。

### EventCallback 高级模式

EventCallback 仍然保留，但放在高级配置：

```text
必填: App ID + App Secret + Verification Token
建议: Encrypt Key
```

用于：

- 公网 SaaS webhook。
- 严格回调验签/加密事件。
- 企业安全审计和完整 smoke evidence。

### 必须订阅/处理的事件

第一阶段：

- `im.message.receive_v1`：消息入站。
- `card.action.trigger`：审批卡片/交互卡片。
- `im.chat.member.bot.added_v1`：机器人进群事件，用于自动创建/绑定 AgentSpace channel。

说明：飞书官方有机器人被添加至群聊时触发的事件，后续实现时需以官方当前事件名和 SDK 类型为准。

参考：

- Feishu Open Platform Bot: <https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/bot-v3/bot-overview>
- Feishu event subscription: <https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/subscription-event-case>
- 机器人进群事件: <https://open.feishu.cn/document/server-docs/group/chat-member/event/added-2?lang=zh-CN>

## 消息路由规则

### 入站定位

收到飞书事件后：

```text
1. 从 payload/header/context 解析 app_id / tenant_key
2. app_id -> ExternalAgentBotBinding -> agentId
3. chat_id -> ExternalChannelBinding
4. 如果 chat_id 未绑定:
   - bot_added event: 自动创建 channel
   - first message: 根据 policy 自动创建或提示管理员
5. open_id / union_id -> AgentSpace user binding
6. 未绑定用户 -> external_guest actor
7. 检查 agent 是否允许在该 channel 响应
8. 写入 AgentSpace channel message
9. 创建/延续 task/thread context
10. 调度 agent runtime
11. 使用同一个 Feishu bot identity 回复
```

### 多 agent 同群

同一个飞书群可以有多个 bot：

```text
@Codex Bot -> Codex agent
@HermesAgent Bot -> HermesAgent
@OpenClaw Bot -> OpenClaw
```

规则：

- @哪个 bot，就路由给哪个 agent。
- 如果消息没有 @任何 bot，默认不触发，除非 channel policy 开启 reply_all。
- 同一 thread 内后续消息可以延续上一次被 @ 的 agent，但必须避免 agent 之间互相触发无限循环。
- Bot 回复应带真实 agent 身份，例如卡片 header `Codex · AgentSpace`。

### 未绑定用户

未绑定飞书用户作为 `external_guest`：

```text
允许:
  当前飞书群/channel 内的普通问答
  当前 channel_context_only 上下文
  接收 agent 回复

禁止:
  访问私有 workspace 资源
  调用高风险工具
  写 Docs / Sheets / Base
  创建审批决定
  管理 channel / agent / resource binding
```

当 external guest 请求高权限动作时：

```text
请先绑定 AgentSpace 身份后继续。
[绑定身份]
```

## 自动创建 channel 策略

### 主路径：bot 进群自动创建

```text
Feishu bot added to chat event
-> resolve agent bot binding by app_id
-> resolve or create channel by feishuChatId
-> create channel-agent membership
-> send confirmation card
```

自动创建 channel 的推荐属性：

```text
kind: group
source: feishu_auto_provisioned
visibility: private 或 external_managed
name: 根据飞书群名生成，冲突时追加短 hash
reviewStatus:
  - 操作者已绑定且有权限: approved
  - 操作者未绑定: needs_identity_binding
  - workspace policy 要求管理员确认: pending_admin_review
```

### 兜底路径：首次消息自动创建

如果没有收到 bot_added 事件，但收到 `im.message.receive_v1`：

```text
chat_id 未绑定
-> 根据 workspace policy 决定:
   auto_create_channel
   pending_admin_review
   reply_with_setup_card
   ignore
```

### 反向路径：AgentSpace 创建飞书群

高级能力，后续再做：

```text
AgentSpace 创建 channel
-> 调飞书 API 创建群
-> 邀请成员和 agent bots
-> 自动完成 channel binding
```

## 前端规划

### Agent 设置页

新增：

```text
Agent Settings -> Integrations -> Feishu Bot
```

最小表单：

```text
App ID
App Secret
```

高级折叠区：

```text
Transport
Tenant Key
Verification Token
Encrypt Key
Required scopes
Event subscriptions
Health check
Smoke commands
```

### Workspace / Integration 设置页

继续保留 workspace-level Feishu 总览，但定位调整为：

- 查看所有 agent bot bindings。
- 查看所有 Feishu chat/channel bindings。
- 配置自动创建 channel 策略。
- 配置 external guest 策略。
- 查看 failure / health / evidence。

不要把 workspace-level integration 作为普通用户的第一入口。

### Channel 设置页

显示：

```text
Feishu group binding
External chat reference
Auto-provision source
Connected agent bots
Unbound user policy override
Resource bindings: Doc / Sheet / Base
```

### 飞书卡片

需要几类卡片：

- Bot 加入群后确认卡片。
- 需要绑定身份卡片。
- 自动创建 channel 待管理员审核卡片。
- 多 agent 协作/切换提示卡片。
- 写入审批卡片沿用 TODO119 的治理链路。

## 后端规划

### 推荐文件路径

飞书新增功能代码继续放在 Feishu integration 路径下，避免散落：

```text
packages/services/src/integrations/providers/feishu/agent-bot-bindings.ts
packages/services/src/integrations/providers/feishu/channel-auto-provisioning.ts
packages/services/src/integrations/providers/feishu/external-guests.ts
packages/services/src/integrations/providers/feishu/thread-bindings.ts
packages/services/src/integrations/providers/feishu/agent-bot-routing.ts
packages/db/src/integrations/feishu-agent-bots.ts
apps/web/features/integrations/feishu/
apps/web/app/api/integrations/feishu/events/
apps/cli/src/commands/integrations/feishu.ts
```

如果 agent settings 需要入口，`apps/web/features/agents/...` 只做薄 UI 集成，具体 Feishu 逻辑仍从 `features/integrations/feishu/` 引入。

### Service 层

新增/改造：

- `createFeishuAgentBotBindingSync(...)`
- `rotateFeishuAgentBotCredentialsSync(...)`
- `checkFeishuAgentBotHealth(...)`
- `resolveFeishuAgentBotFromEvent(...)`
- `resolveOrProvisionFeishuChannelBinding(...)`
- `resolveFeishuExternalActor(...)`
- `evaluateFeishuExternalGuestPolicy(...)`
- `routeFeishuMessageToAgent(...)`
- `recordFeishuThreadBinding(...)`

### DB 层

需要 migration / schema：

- agent bot binding 表或 external integration agent scope 字段。
- channel binding auto-provision metadata。
- external participant policy。
- external thread binding。
- evidence/outbox 里记录 bot binding id / agent id。

### CLI

新增命令草案：

```bash
agent-space integrations feishu bind-agent-bot \
  --workspace-id <id> \
  --agent <agent-id-or-name> \
  --env-file scripts/feishu/.env \
  --app-id-env FEISHU_APP_ID \
  --app-secret-env FEISHU_APP_SECRET \
  --json

agent-space integrations feishu agent-bot-readiness \
  --workspace-id <id> \
  --agent <agent-id-or-name> \
  --strict \
  --json

agent-space integrations feishu auto-provision-policy \
  --workspace-id <id> \
  --unbound-user-mode reply_on_mention \
  --guest-permission-profile channel_context_only \
  --json

agent-space integrations feishu channel-bindings \
  --workspace-id <id> \
  --json
```

现有 `create` 命令需明确是 workspace-level integration 还是 agent bot binding；不要让两个概念混淆。

## 权限与治理

### Agent 是否能在 channel 响应

每条飞书消息进入 AgentSpace 后都必须检查：

```text
agent bot binding active
channel binding active
agent enabled in channel
actor allowed by channel policy
resource access allowed by channel/agent policy
runtime available
```

### External guest policy

默认策略：

```text
reply_on_mention
channel_context_only
no writes
no approvals
no private resources
no sensitive runtime tools
```

管理员可调整：

```text
ignore
reply_on_mention
reply_all
require_identity
```

策略层应接入 TODO85 的 policy decision：

```text
allow
require_identity
require_approval
deny
```

### 审计

审计里不要记录原始 open_id / chat_id / resource token。

记录安全引用：

```text
provider: feishu
agentId
botBindingId
channelId
externalChatReference
externalActorReference
actorType: user | external_guest
policyDecision
```

## Docs / Sheets / Base

Agent bot 身份不自动授权 data plane。

仍然需要：

```text
Feishu Doc -> AgentSpace channel_document
Feishu Sheet -> AgentSpace data_table
Feishu Base table -> AgentSpace data_table
```

读取规则：

- 绑定资源。
- channel/agent policy 允许。
- external guest 只能访问 explicitly guest-readable 的当前 channel 资源。

写入规则：

- 一律走 AgentSpace approval。
- external guest 不能发起最终写入；可以生成请求草案，要求绑定身份后继续。
- 继续保留 payload hash、operation run、audit 和 evidence。

## 实施阶段

> 当前进展（2026-06-27）：Phase 1-5 的勾选表示本地代码路径和自动化测试已覆盖；不代表真实飞书租户验收完成。最终完成仍以 Phase 6 的 disposable tenant/apps live smoke 和 final evidence gate 为准。
>
> 主要证据位置：
>
> - Agent bot binding / policy / credentials：`packages/services/src/integrations/providers/feishu/agent-bot-bindings.ts`、`apps/cli/src/commands/integrations/feishu.ts`、`apps/web/features/integrations/feishu/`。
> - Native routing / auto-provision / thread collaboration / loop guard：`packages/services/src/integrations/providers/feishu/inbound.ts`、`channel-auto-provisioning.ts`、`thread-bindings.ts`、`agent-bot-routing.ts`。
> - External guest / data-plane governance / evidence：`external-guests.ts`、`data-plane.ts`、`apps/cli/src/commands/integrations/feishu.ts`。
> - Regression tests：`packages/services/src/integrations/providers/feishu/__tests__/inbound.test.ts`、`agent-bot-bindings.test.ts`、`data-plane*.test.ts`、`outbound*.test.ts`、`apps/cli/src/commands/integrations.test.ts`、`apps/web/features/agents/agents-page-client.test.tsx`、`apps/web/features/integrations/feishu/feishu-*.test.ts`、`packages/services/src/permissions/permissions.test.ts`。
> - 本地回归验证（2026-06-27）：`npm run typecheck`、Feishu service tests、`scripts/feishu/smoke.test.ts`、targeted web Feishu/agent settings Vitest、CLI integrations test 均已通过；web Vitest 使用显式 `AGENT_SPACE_TEST_DATABASE_URL=postgres://localhost/agent_space_test` 覆盖，避免读取应用库配置。
> - Phase 6 前置检查（2026-06-27）：`.env` / `.env copy` / `scripts/feishu/.env` 均未提供 Feishu live smoke 变量；`npm run smoke:feishu -- --env-file .env --check-env --json` 和 `.env copy` 检查均报告 15 个 OpenAPI strict-live 必填项缺失，且 `todo120NativeSmoke` 单独提示第二个 agent bot 的 `FEISHU_SECOND_AGENT_APP_ID` / `FEISHU_SECOND_AGENT_APP_SECRET` 未配置。`smoke-plan --workspace-id default --app-url https://feishu-e2e.hire-an-agent.online --json` 可生成清单，但当前 workspace 无 Feishu integration，仍停在 `credential_encryption_key_missing` / `integration_missing` / `second_agent_bot_missing` 等真实前置条件。
> - Phase 6 native smoke 门槛已加固：`scripts/feishu/smoke.ts` 支持 `--require-todo120-native`，`smoke-plan` 生成的 check-env / strict-live 命令默认带该开关；缺少第二个 agent bot env、第二个 app id 与主 `FEISHU_APP_ID` 相同、或第二个 app secret 与主 `FEISHU_APP_SECRET` 相同，TODO120 native smoke check-env / strict-live 会在触网前失败，避免单 bot OpenAPI smoke 被误当成 Phase 6 完成。
> - AgentSpace `smoke-plan` 的第二 bot 判定已收紧：必须有两个 Phase 6-ready agent-scoped Feishu bot bindings，且 agentId 不同、Feishu app id 不同、active、有 app credentials、health 已检查且非 error、bot scopes 完整、无 unresolved outbox failure；否则同群复用和 thread collaboration live steps 保持 blocked。
> - AgentSpace `smoke-plan --integration <id>` 已避免误收窄 Phase 6 第二 bot 判定：主 checklist、命令和 final evidence 仍使用指定 integration，但多 agent bot readiness 会扫描同一 workspace 的所有 Feishu agent bot bindings，确保同群复用 / thread collaboration 不会因为选择 data-plane integration 而误报缺少第二个 bot。
> - AgentSpace final evidence gate 已补 workspace-wide 同群聚合：`evidence --require native/all --integration <id>` 保留指定 integration 的明细和 OpenAPI callback route proof；其中 native 严格判定会按同一个 safe chat reference 聚合同一 workspace 内多个 Feishu agent bot bindings 的 redacted evidence counters，且 scoped gate 要求 selected integration 参与该同群证据；`all` 的 bot / guest-policy / data-plane / worker / failure 仍要求同一个 anchor integration 自身满足，JSON 可用 `summary.scopedAllSatisfied` 区分 selected integration 的本地 all gate 与 workspace-wide native/data-plane 汇总，最终 `strictSatisfied` 还会叠加 OpenAPI artifact 缺失、过期、callback fingerprint 不匹配或未充分脱敏等校验。这避免真实“每个 agent 一个 bot”后第二 bot 的 channel reuse / thread collaboration 证据被 `--integration` 过滤掉，同时避免不同飞书群/租户、无关 bot group 或无关 data-plane integration 的证据被拼接误判。
> - CLI create / bind-agent-bot / 前端 Feishu setup guide 已同步 Phase 6 native smoke：Settings / Agent Settings 展示的 `check-env` 和 strict live smoke 命令默认带 `--require-todo120-native`，CLI `nextCommands` 与前端 guide 都直接给出 health/readiness/smoke/final evidence 以及第二个 agent bot 的 `bind-agent-bot --app-id-env FEISHU_SECOND_AGENT_APP_ID --app-secret-env FEISHU_SECOND_AGENT_APP_SECRET` 命令，避免用户只跑单 bot OpenAPI smoke。
> - `smoke-plan` 已补 external guest policy 切换命令：`reply_on_mention`、`reply_all`、`require_identity`、`ignore` live steps 会输出对应 `auto-provision-policy` 命令，并保留 `require-identity-for writes,approvals,private_resources,runtime_sensitive_tools`，方便 Phase 6 验证未绑定用户低权限试用、要求绑定身份、关闭回复和未 @bot 忽略。

### Phase 0：产品语义收口

- [x] 在 TODO119 基础上明确 workspace integration 与 agent bot binding 的边界。
- [x] 决定复用 `external_integrations` 还是新增 `external_agent_bot_bindings`。
- [x] 定义 agent settings 与 workspace integration settings 的入口分工。
- [x] 更新飞书创建文案：快速开始 = agent bot binding，不再暗示 workspace bot 是唯一模式。

### Phase 1：Agent Bot Binding MVP

- [x] 支持每个 AgentSpace agent 绑定 Feishu bot。
- [x] WebSocket worker 模式只要求 `App ID + App Secret`。
- [x] EventCallback 模式保留 `Verification Token` / `Encrypt Key` 高级配置。
- [x] Health check 能按 agent bot binding 检查 bot 信息和 scopes。
- [x] Outbound reply 使用对应 agent bot 的 credentials。
- [x] CLI + UI 都能创建、禁用、轮换 agent bot binding。
- [x] 单元测试覆盖 secret 不泄露、placeholder 拒绝、重复 app/tenant/agent 绑定。

### Phase 2：Channel Auto Provisioning

- [x] 处理机器人进群事件。
- [x] `feishuChatId` 未绑定时自动创建 AgentSpace channel。
- [x] 同一 `feishuChatId` 重复进群事件不重复创建 channel。
- [x] 第二个 agent bot 进同一飞书群时，只新增 channel-agent membership。
- [x] 支持首次消息兜底创建/提示。
- [x] 自动创建 channel 后发送确认卡片。
- [x] 管理员可配置 auto-create / pending-review / disabled。

### Phase 3：Direct Agent Conversation Routing

- [x] 入站事件根据 `appId` 定位 agent。
- [x] `chatId` 定位 channel。
- [x] @哪个 bot 就路由给哪个 agent。
- [x] 同一飞书 thread 绑定 AgentSpace task/thread context。
- [x] 不 @bot 的消息默认不触发，除非 policy 允许。
- [x] 防止 bot 回复触发其他 agent bot 无限循环。
- [x] 回复卡片/文本显示真实 agent 身份。

### Phase 4：External Guest Mode

- [x] 未绑定飞书用户映射为 `external_guest` actor。
- [x] 默认 `reply_on_mention + channel_context_only`。
- [x] 管理员可选择 ignore / reply_all / require_identity。
- [x] Guest 请求高权限动作时返回身份绑定卡片。
- [x] Guest audit 不泄露原始 open_id / union_id。
- [x] 权限中心能显示 external guest policy 和最近 guest interaction。

### Phase 5：Resource Governance

- [x] Resource binding UI 支持按 channel 展示 Feishu Doc / Sheet / Base。
- [x] Agent bot 读取已绑定资源时记录 agentId + botBindingId + actorType。
- [x] External guest 只能读取 guest-readable 的当前 channel 资源。
- [x] 写入继续走 approval。
- [x] Evidence gate 区分 user actor 与 external_guest actor。

### Phase 6：Smoke / E2E

- [ ] 建一个 disposable Feishu tenant/app set：Codex Bot + HermesAgent Bot。
- [ ] 把 Codex Bot 拉进新飞书群，确认自动创建 channel。
- [ ] 再把 HermesAgent Bot 拉进同群，确认复用 channel 并新增 agent membership。
- [ ] 未绑定飞书用户 @Codex，确认以 guest 身份获得低权限回复。
- [ ] 未绑定飞书用户请求写 Sheet，确认要求绑定身份。
- [ ] 已绑定用户 @Codex，确认真实 user actor 和审计。
- [ ] 绑定 Doc/Sheet/Base 后确认读写治理。
- [ ] 关闭 agent/channel policy 后确认 bot 不回复。
- [ ] 运行最终 evidence gate，确认 bot reply、auto-provision、guest policy、approval、failure visibility 都有证据。

## 验收标准

> 验收标准在真实飞书租户/apps 完成 Phase 6 之前保持未勾选；本地实现状态以上方 Phase 1-5 为准。

### 用户体验

- [ ] 管理员给 agent 接飞书 bot 时，默认只看到 `App ID` / `App Secret`。
- [ ] 普通用户可以在飞书群里直接 @具体 agent bot。
- [ ] 不需要输入 `/agent` 命令。
- [ ] bot 被拉进群后 AgentSpace 自动创建或绑定 channel。
- [ ] 多个 agent bot 可在同一个飞书群内共存。
- [ ] 未绑定用户可低权限试用，且高风险动作会提示绑定身份。

### 安全治理

- [ ] 未绑定用户不会成为真实 workspace member。
- [ ] 未绑定用户不能写 Docs / Sheets / Base。
- [ ] Agent bot 不能绕过 AgentSpace resource policy。
- [ ] 写入动作必须保留 approval + payload hash。
- [ ] 审计不泄露 Feishu 原始 chat/user/resource token。
- [ ] 管理员能关闭未绑定用户回复。

### 工程质量

> 工程质量项以本地自动化和代码路径审计为准；Phase 6 真实飞书租户 smoke 仍单独保留未勾选。

- [x] Feishu 新增代码放在 integration/Feishu 相关路径下。
- [x] WebSocket worker / EventCallback 都有单元测试。
- [x] Auto-provision idempotency 有测试。
- [x] Guest policy 有 service-level 测试。
- [x] UI 有创建最小表单、高级配置折叠、policy 控件测试。
- [x] CLI 有 JSON 输出和 placeholder 拒绝测试。
- [x] `npm run typecheck`、相关 Vitest、smoke harness 通过。

## 风险与开放问题

- [ ] 飞书机器人进群事件在不同 tenant / app 类型下的 payload 字段需真实租户验证。
- [x] 第一版限制一个 AgentSpace agent 只能有一个 active Feishu bot binding；重复绑定返回 `feishu.agent_bot_binding.duplicate_agent`，禁用或轮换后再更换。
- [x] 第一版禁止同一个 Feishu app/tenant 绑定多个 AgentSpace agent；`external_integration` 使用 `(workspace_id, provider, app_id, tenant_key)` 唯一约束，agent bot 绑定返回 `feishu.agent_bot_binding.duplicate_app_tenant`。
- [x] 自动创建 channel 的命名冲突和归档恢复策略已定义：名称使用 `feishu-<slug>`，冲突时追加 chat 短 hash / 序号； archived binding 会原地恢复并记录 `restoredFromStatus` / `restoredBindingId`。
- [x] External guest 第一版不存储真实 Feishu displayName；AgentSpace UI 使用统一 `Feishu Guest` 展示名，审计和任务上下文只保存 provider user hash / safe reference。
- [x] External guest evidence gate 已收紧：message mapping / data-plane governance 中 `actorType=external_guest` 的证据必须没有 `userId` / `actorUserId`，避免未绑定飞书用户被误证明为真实 workspace member。
- [x] 多 bot 同群的 evidence gate 已收紧：同一 Feishu chat 复用需记录 `linkedFromAgentId` / `linkedFromBotBindingId` 且与当前 agent/bot 不同；同一 thread 可记录 `threadContinuation=true`、`threadCollaboration=true` 和 collaborator agent ids，不覆盖原 agent task。
- [x] Data-plane approved write evidence 已收紧：Doc / Sheet / Base 写入不仅需要 `approvalId` + `payloadHash`，还必须带 active resource binding id，并在同一 operation 的 Feishu governance context 中记录 `agentId` + `botBindingId` 和真实 `agent` / `user` actor；最终证据 gate 使用 `bound_approved_doc_write` / `bound_approved_sheet_write_with_agentspace_sync` / `bound_approved_base_mutation_with_agentspace_sync`，避免 agent bot 绕过 AgentSpace resource policy 的证据空洞。
- [x] Data-plane read evidence 已收紧：普通 Doc / Sheet / Base read 必须带 active resource binding id 和 Feishu governance context（provider、agentId、botBindingId、真实 user/agent actor 或 guest-readable external guest），最终证据 gate 使用 `bound_governed_doc_read` / `bound_governed_sheet_read` / `bound_governed_base_read`，避免用无绑定资源读成功误证明 data plane 治理。
- [x] External guest read evidence 已收紧：成功读 Doc / Sheet / Base 必须是当前 channel 绑定资源，并在 Feishu governance context 中记录 `externalGuestResourceAccess=guest_readable_current_channel`，避免仅凭 `external_guest` actor 证明绕过 guest-readable resource policy。
- [x] External guest write-deny evidence 已收紧：未绑定用户写拒绝必须发生在绑定的 Doc / Sheet / Base 写操作上，最终证据 gate 使用 `external_guest_bound_write_denied`，避免用无资源绑定或非写操作失败误证明“不能写”。
- [x] Agent/channel policy disabled evidence 已收紧：`feishu_agent_channel_member_access_disabled` 等 policy-denied 入站必须没有关联 outbound reply，最终证据 gate 使用 `agent_channel_policy_denial_without_reply` 表达“bot 不回复”的验收语义。
- [x] Bot reply evidence 已收紧：基础回复 gate 不再接受任意 sent outbox 或任意 outbound correlation，sent outbox 必须是 Feishu `agent_reply`、带 `agentId` / `botBindingId`、AgentSpace message/channel binding 和 safe chat/thread references；correlated reply 必须是 Feishu provider 且 outbound `agentId` / `botBindingId` 与 inbound 一致、带 safe chat/thread references。最终证据 gate 使用 `sent_agent_bot_reply_outbox_with_safe_context` + `same_agent_bot_correlated_reply_mapping` 表达“同一个 Feishu bot identity 回复”。
- [x] Bot reply smoke remediation 已对齐最终 gate：`smoke-plan` / evidence remediation 会明确要求 processed safe inbound summary、sent Feishu `agent_reply` outbox、安全 chat/thread context 和 same-bot correlated reply mapping，避免现场排障时把任意回信误当成 Phase 6 通过。
- [x] Processed inbound event evidence 已收紧：`processed_inbound` 不再只看 eventType/status，必须是 Feishu provider、`rawPayloadStored=false`，并带安全 event/message/chat/sender reference 且不含原始 Feishu message id / chat id / open_id / union_id；最终 bot gate 使用 `processed_inbound_with_safe_summary`。
- [x] Native route evidence 已收紧：Feishu inbound mapping 持久化 `agentBotMentioned`，并且 direct route / bound user / external guest mention 证据都必须带安全 chat/thread reference；最终证据 gate 使用 `direct_agent_bot_route_with_safe_context` / `bound_user_bot_mention_with_safe_context` / `external_guest_bot_mention_with_safe_context`，避免 `/agent`、reply_all/thread continuation 或缺少安全上下文的 mapping 误充当原生体验证明。
- [x] Inbound event payload summary 已收紧：event 表只保存 message/chat/thread/sender 的安全 reference、content hash 与 redaction 标记，不再在 `payloadJson` 中保存原始 Feishu message id / chat id / open_id / union_id，前端未绑定用户/群建议优先使用安全 reference 并兼容旧事件。
- [x] Thread continuation evidence 已收紧：同 thread follow-up 必须记录 `threadContinuation=true` 且 `agentBotMentioned=false`，并且 `threadBindingId` 必须能匹配 active Feishu thread binding 的 task / message / agent / bot / channel；最终证据 gate 使用 `thread_continuation_without_remention_active_binding` 表达“不重新 @bot 也能延续同一 AgentSpace context”的验收语义。
- [x] External guest policy evidence 已收紧：默认低权限试用必须是 `reply_on_mention` 下未绑定用户直接 @agent bot、成功 dispatch 到 task/message 的 `external_guest` allow 证据；`reply_all` 必须是不 @bot 仍可 dispatch 的独立证据；`require_identity` 必须无 task/message dispatch，且有同 agent/bot/chat/thread 关联、带 `sentAt`、真实 target 到源 Feishu thread、metadata 不含 raw chat/thread id 的 sent identity-binding notice outbox；`ignore` / 未 @bot 忽略必须无 task/message dispatch 且无关联 outbound reply。最终证据 gate 使用 `external_guest_reply_on_mention_allow_with_dispatch` / `external_guest_reply_all_without_mention` / `external_guest_require_identity_without_dispatch` / `sent_identity_binding_notice` / `external_guest_ignore_without_dispatch_or_reply` / `external_guest_mention_required_without_dispatch_or_reply`，避免用全量监听或仅一条 ignored 记录误证明 guest policy 体验。
- [x] Bot sender loop guard evidence 已收紧：`feishu_bot_sender_ignored` 必须记录 `agentBotMentioned=false` 且没有关联 outbound reply，最终证据 gate 使用 `bot_sender_loop_guard_without_reply` 表达“其他 bot/自身 bot 消息不会触发任务或回复”的验收语义。
- [x] Channel auto-provision evidence 已收紧：`bot_added` / `first_message` 自动建群必须落到 active channel binding，且具备 AgentSpace channel identity、原始 chat id 本地记录、安全 chat reference 与 `reviewStatus`；多 bot 同群复用还必须记录不同的 `linkedFromBindingId` / `linkedFromAgentId` / `linkedFromBotBindingId`，最终证据 gate 使用 `bot_added_auto_provision_with_channel_identity_review_state` / `first_message_auto_provision_with_channel_identity_review_state` / `multi_agent_channel_reuse_distinct_binding`，避免仅凭 metadata 误证明“已自动创建或绑定 channel”。
- [x] WebSocket worker card-action evidence 已收紧：processed card action 必须带安全 `approvalCardAction` 摘要（Feishu provider、data-operation approval、approvalId、payloadHash、decision，并显式不存储 token/raw action payload），最终证据 gate 使用 `processed_approval_card_action_with_governance_context`，避免用普通交互卡片或状态刷新按钮误证明“审批卡片治理链路走通”。
- [x] Failure visibility evidence 已收紧：provider failure row 必须与 degraded/error health 同时出现，且 agent bot failure 证据必须带 Feishu provider、agentId、botBindingId 和安全 chat/resource context；failed outbox 需要 `outboxSource` + `externalChatReference`，failed data operation 需要 Feishu governance context + resource binding id。最终证据 gate 使用 `agent_bot_failure_with_safe_context`，避免用无上下文失败误证明“失败对管理员可见且可归因到具体 agent bot”。
- [x] 部署默认已明确：self-hosted / 快速开始默认 WebSocket worker；EventCallback 作为 SaaS webhook / 严格验签 / 加密事件的高级模式保留。

## 推荐第一版产品默认值

```text
Agent bot binding:
  transportMode = websocket_worker
  required fields = App ID + App Secret

Channel auto provisioning:
  bot_added = auto_create_channel
  first_message = auto_create_if_bot_mentioned
  created channel visibility = private / external_managed

External guest:
  unboundUserMode = reply_on_mention
  permissionProfile = channel_context_only
  writes = require_identity
  approvals = require_identity
  private resources = deny

Docs / Sheets / Base:
  read = requires resource binding + policy allow
  write = requires real user + approval
```
