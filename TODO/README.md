# AgentSpace TODO

## 架构

```
packages/
  domain/      类型定义
  db/          数据库访问层 (@agent-space/db)
  services/    业务逻辑层 (@agent-space/services)
    shared/    跨功能共享 (state-io, helpers, normalizers)
    workspace/ channels/ employees/ skills/ contacts/
    messages/  tasks/ materials/ attachments/ documents/
    knowledge/ context/ search/ costs/ budgets/
    performance/ estimation/
    tables/ automations/ schedules/ templates/
```

加新功能：在 `services/src/` 新建文件夹 → 写逻辑 → `index.ts` 加 re-export。

## 已完成

- [06-daemon-native-runtime.md](Done/06-daemon-native-runtime.md)
- [07-mention-mechanism.md](Done/07-mention-mechanism.md)
- [12-channel-documents.md](Done/12-channel-documents.md)
- [13-workspace-agent-state-consistency.md](Done/13-workspace-agent-state-consistency.md)
- [14-backend-restructure.md](14-backend-restructure.md) ✅ 后端架构重构
- [20-global-search.md](Done/20-global-search.md) ✅ PR #19 — FTS5 全局搜索
- [21-approvals.md](Done/21-approvals.md) ✅ PR #20 — 审批/确认流
- [22-knowledge-base.md](Done/22-knowledge-base.md) ✅ 知识库（页面树 + Markdown 编辑 + 素材导入 + 全局搜索）
- [23-message-enhancements.md](Done/23-message-enhancements.md) ✅ PR #19 — Pin/引用回复/频道搜索
- [26-task-board.md](Done/26-task-board.md) ✅ PR #20 — 任务看板
- [30-org-chart.md](Done/30-org-chart.md) ✅ 组织架构图（人+Agent 树形/频道视图）
- [31-agent-relationship-context.md](Done/31-agent-relationship-context.md) ✅ Agent 关系上下文（内联事实 + Context Tool/API + workspace-context skill）
- [32-task-cost-comparison.md](Done/32-task-cost-comparison.md) ✅ 任务成本对比（token 记录 + Agent 费用比价）
- [33-budget-control.md](Done/33-budget-control.md) ✅ 预算管控（三层预算 + daemon 超支拦截）
- [24-agent-performance.md](Done/24-agent-performance.md) ✅ Agent 绩效看板（完成率/响应时间/错误率/满意度）
- [34-task-estimation.md](Done/34-task-estimation.md) ✅ 任务预估与派单（历史法 + 规则兜底 + 报价单 UI）
- [25-structured-tables.md](Done/25-structured-tables.md) ✅ 结构化数据表（多列类型 + 行 CRUD + Grid 视图）
- [27-automation-workflows.md](Done/27-automation-workflows.md) ✅ 自动化工作流（Trigger→Condition→Action 规则引擎 + UI）
- [28-calendar-scheduled-tasks.md](Done/28-calendar-scheduled-tasks.md) ✅ 日历/定时任务（重复策略 + 时间线视图）
- [29-templates.md](Done/29-templates.md) ✅ 模板系统（频道/任务/技能/工作流 四类模板）
- [08-agent-output-attachments.md](Done/08-agent-output-attachments.md) ✅ Agent 附件输出（协议、落盘、展示、清理与测试已完成）
- [10-frontend-agent-attachments-polish.md](Done/10-frontend-agent-attachments-polish.md) ✅ 前端附件打磨（三处统一组件 + 移动端响应式 + 加载失败降级）
- [32-frontend-mobile-adaptation.md](Done/32-frontend-mobile-adaptation.md) ✅ 工作台移动端适配（主路径 drill-down + 小屏交互收敛 + mobile smoke）
- [39-systemd-service-for-agentspace.md](Done/39-systemd-service-for-agentspace.md) ✅ AgentSpace Web 进程纳入 systemd 托管
- [40-daemon-packaged-js-build.md](Done/40-daemon-packaged-js-build.md) ✅ standalone daemon 改为编译后 JS 分发
- [41-user-space-daemon-bootstrap.md](Done/41-user-space-daemon-bootstrap.md) ✅ 默认改为用户态 daemon 引导，systemd 降级为高级选项
- [47-frontend-copy-cleanup.md](Done/47-frontend-copy-cleanup.md) ✅ 前端说明性文案清理（删除重复教学型说明，保留必要规则/权限/安全提示）
- [38-skills-system-evolution.md](Done/38-skills-system-evolution.md) ✅ Skills 系统演进（独立表 + 外部导入 + provider-native 注入 + CLI / UI 收口）
- [49-direct-channel-unification.md](Done/49-direct-channel-unification.md) ✅ 私聊收敛为 direct channel，会话模型统一到 channel/message/document/daemon 主链路
- [51-knowledge-as-unified-file-center.md](Done/51-knowledge-as-unified-file-center.md) ✅ 知识库拆分为知识页面与文档页面（双入口、共享文档索引、知识沉淀关联、搜索跳转与附件追踪收口）
- [61-auth-landing-page-story-and-conversion.md](Done/61-auth-landing-page-story-and-conversion.md) ✅ 登录页产品叙事与转化优化（首屏产品表达、邀请态上下文、Google 进入链路与邀请邮箱约束统一）
- [42-multi-tenant-workspaces-and-google-auth.md](Done/42-multi-tenant-workspaces-and-google-auth.md) ✅ TODO42 总览与总收口（多租户、多工作区、权限矩阵、Google 登录、设备管理）
- [42-1-auth-and-google-login.md](Done/42-1-auth-and-google-login.md) ✅ 多工作区、成员关系与访问控制
- [42-2-workspace-membership-and-access-control.md](Done/42-2-workspace-membership-and-access-control.md) ✅ `state_json` 拆分与并发治理（核心验收：CAS 乐观锁 + channels/employees/tasks/task_messages/members 事实源迁移）
- [42-5-runtime-daemon-and-storage-isolation.md](Done/42-5-runtime-daemon-and-storage-isolation.md) ✅ 身份系统与 Google 登录
- [48-monorepo-typecheck-and-static-check-hardening.md](Done/48-monorepo-typecheck-and-static-check-hardening.md) ✅ Monorepo typecheck / lint 稳定化（共享包声明边界 + 根级 typecheck/lint 收口）
- [50-static-check-ci-and-editor-followup.md](Done/50-static-check-ci-and-editor-followup.md) ✅ 静态检查 CI 与编辑器收尾（CI 分阶段、daemon/sandbox 声明产物链、跨包源码 import 收口）
- [67-agent-runtime-sharing-with-human-members.md](Done/67-agent-runtime-sharing-with-human-members.md) ✅ 已注册 runtime 可分配给真人成员，成员可基于授权 runtime 创建并管理自己的 Agent
- [70-remote-daemon-session-resume-and-work-execution-continuity.md](Done/70-remote-daemon-session-resume-and-work-execution-continuity.md) ✅ Remote daemon session resume（远程 provider 会话恢复、sessionId 回写与回归测试）
- [73-channel-file-upload-delete-permissions.md](Done/73-channel-file-upload-delete-permissions.md) ✅ 群文件上传与删除权限治理（owner/admin 与上传者可删，引用保留与物理清理）
- [74-channel-message-realtime-sync.md](Done/74-channel-message-realtime-sync.md) ✅ 群消息实时同步（SSE 事件通道、权限校验、客户端 debounce refresh）
- [75-agent-scoped-google-workspace-oauth.md](Done/75-agent-scoped-google-workspace-oauth.md) ✅ Agent 级 Google Workspace OAuth 委托（员工管理授权、运行时委托凭据、操作审计）
- [76-agent-initiated-mentions.md](Done/76-agent-initiated-mentions.md) ✅ Agent 主动 @ 人和 Agent（最终回复 mention 解析、Agent 调度、防循环与前端高亮）
- [79-runtime-output-cli.md](Done/79-runtime-output-cli.md) ✅ runtime-output CLI 化与轻量回收协议（output CLI、manifest 校验/预览、轻量 bundle 与提示更新）
- [80-unified-permission-management.md](Done/80-unified-permission-management.md) ✅ 统一权限管理中心（资源树、Actor 反查、薄操作层、外部授权诊断）
- [81-agent-google-sheets-editing-readiness.md](Done/81-agent-google-sheets-editing-readiness.md) ✅ Agent Google Sheets 编辑链路端到端可用（runtime-output sheets CLI、daemon readiness、gws 执行、结构化失败审计与真实 Google Sheet E2E 写入验收）
- [87-agent-gws-runtime-execution-overview.md](Done/87-agent-gws-runtime-execution-overview.md) ✅ Agent 侧 gws 执行总览（Agent runtime 直接运行 gws，server 只回收结果和审计）
- [88-agent-gws-runtime-auth-injection.md](Done/88-agent-gws-runtime-auth-injection.md) ✅ Agent 侧 gws 执行环境与授权注入（daemon readiness、短期 token env、任务上下文与无授权阻断）
- [89-sheets-result-cli-and-server-ingestion.md](Done/89-sheets-result-cli-and-server-ingestion.md) ✅ Sheets Result CLI 与 Server 回收审计（external-sheets-results、result artifact、operation run 和旧 manifest 弃用提示）
- [90-claude-empty-response-diagnostics.md](Done/90-claude-empty-response-diagnostics.md) ✅ Claude empty response 诊断收口（event summary、stdout/stderr tail、typed code、fallback 与脱敏）
- [94-agentrouter-harness-switching.md](Done/94-agentrouter-harness-switching.md) ✅ AgentRouter Harness MVP（独立 router library/CLI、Claude/Codex/OpenClaw native adapters、统一 launch/result/event/diagnostic contract）
- [95-agentrouter-provider-gws-runtime-fix.md](Done/95-agentrouter-provider-gws-runtime-fix.md) ✅ AgentRouter provider gws/runtime 修复（provider PATH、Claude gws allowlist、Claude stdin 收口、remote daemon 热部署验证）
- [96-runtime-tool-capability-registry.md](Done/96-runtime-tool-capability-registry.md) ✅ Runtime Tool Capability Registry（gws/CLI-Hub runtime app capability 化，AgentRouter 统一 PATH/env、Claude allowlist 与 diagnostics 翻译）
- [98-runtime-output-cli-only-cleanup.md](Done/98-runtime-output-cli-only-cleanup.md) ✅ Runtime Output CLI-only 清理（删除手写 manifest fallback、补齐 Google Docs output CLI、runtime-output 能力收口到 AgentRouter capability）
- [97-document-agent-access-policy.md](Done/97-document-agent-access-policy.md) ✅ 文档 Agent 权限（owner/forwarder/editor/viewer、权限申请、AgentRouter capability、daemon 回收与权限中心）
- [99-direct-channel-privacy-for-workspace-managers.md](Done/99-direct-channel-privacy-for-workspace-managers.md) ✅ Direct Channel 隐私边界（owner/admin 不默认读取未参与 direct channel，通知/search/API/附件/权限中心收口）
- [100-managed-postgres-object-storage-mode-a.md](Done/100-managed-postgres-object-storage-mode-a.md) ✅ Mode A 云端持久化（Neon + Cloudflare R2、self-hosted/cloud 模式、remote daemon 文件回收与生产确认）
- [105-reliable-notification-system.md](Done/105-reliable-notification-system.md) ✅ Reliable Notification System（recipient-scoped notification、Inbox read/archive、channel system message、Agent 通知上下文）
- [106-agent-generated-knowledge-approval-flow.md](Done/106-agent-generated-knowledge-approval-flow.md) ✅ Agent 自主知识沉淀审批流（knowledge proposal CLI、daemon 回收、审批 UI、批准/拒绝落库与测试收口）
- [109-agent-fork-sharing.md](Done/109-agent-fork-sharing.md) ✅ Agent Fork 分享给同事（fork invitation、目标成员 runtime 选择、target-owned agent、权限/审计/通知与 UI 收口）
- [111-agent-created-google-sheets-channel-documents.md](Done/111-agent-created-google-sheets-channel-documents.md) ✅ Agent 新建 Google Sheet 并自动挂到频道云文档（gws 创建、output 登记、daemon 回收、权限同步与审计）
- [112-workspace-module-navigation-client-workbench.md](Done/112-workspace-module-navigation-client-workbench.md) ✅ Workspace 主模块切换客户端工作台化（持久 Workbench、模块缓存、shell counters 独立刷新、深链恢复与导航 smoke 收口）
- [115-digital-employee-showcase-productization-and-discovery.md](Done/115-digital-employee-showcase-productization-and-discovery.md) ✅ 数字员工展板产品化与发现体验（发现信息、审批队列、启用状态、频道使用申请与治理边界）

## 架构演进（学习 OpenAgents）

- [35-sandbox-agent-separation.md](Backlog/35-sandbox-agent-separation.md) — 学习 OpenAgents 实现 sandbox-agent 分离
- [36-cloud-agent-deployment.md](Backlog/36-cloud-agent-deployment.md) — 学习 OpenAgents 将 agent 部署在云端
- [37-daemon-remote-deployment.md](Backlog/37-daemon-remote-deployment.md) — 学习 Multica 实现 daemon 远程部署与 HTTP 通信
- [46-cubesandbox-integration.md](Backlog/46-cubesandbox-integration.md) — CubeSandbox 作为第一个 sandbox provider 接入

## 待做 — 仅剩长期演进项

说明：已经进入 backlog 的详细文档统一放在 `TODO/Backlog/`。

| # | 功能 | 说明 |
|---|---|---|
| 09 | Skills Service/API 演进 | 等 CLI/多端接入时再做 |
| 11 | Litewrite 协作借鉴 | diff/merge 工作台、协作者管理、实时 presence |
| 14 | LLM 顺序规划 | 关键词规则→LLM planner 升级 |
| 35 | Sandbox-Agent 分离 | 接口抽象 + Local 实现 + 重构 daemon |
| 36 | 云端 Agent 部署 | Fly.io Sandbox + Durable Task |
| 37 | Daemon 远程部署 | HTTP 轮询 + Daemon Token + 任务派发 |
| 46 | CubeSandbox 集成 | 作为第一个 sandbox provider 接入，补 lifecycle、exec data plane 与隔离验证 |
| 38 | Skills 系统演进 | 独立表 + Agent-Skill绑定 + 外部导入 + Provider注入 |
| 52 | 相对主流 Agent 系统的短板分析 | durable control plane、sandbox 远程执行、多 agent 编排与协作层补齐 |
| 53 | Daemon Provider 扩展 | 支持 opencode、openclaw、nanobot 并收口多 provider runtime 适配层 |
| 54 | 前端视觉系统与体验刷新 | 品牌感、导航层级、核心页面信息密度与动效系统升级 |
| 55 | 工作台导航卡顿与客户端过渡优化 | 高频切换客户端化、上下文解析去重、state 读取降成本 |
| 56 | 知识页按数字员工分配 | 知识页分配模型、Agent 侧绑定入口、运行时知识范围收口 |
| 57 | Agent 跨服务器 Runtime 换绑与无损续跑 | runtime handoff、resume、workDir snapshot、memory/knowledge 显式化 |
| 58 | PostgreSQL 主库切换与 SQLite 下线 | PostgreSQL 成为唯一在线主库，删除 SQLite 运行时与兼容路径 |
| 59 | 工作区邀请码与群邀请 | 每 workspace 一个 owner 管理的邀请码，并补齐目录级默认可见、群申请审批与跨工作区群邀请机制 |
| 60 | 真人联系人、好友关系与同工作区私聊 | 明确加入同一 workspace / 未来好友边界，并把同工作区真人成员的一对一 direct conversation 统一进正式会话模型 |
| 62 | 设置界面分层与信息架构重做 | 把当前单页堆叠式设置页改成多层级、多角色、可深链的设置系统 |
| 63 | 存储分层与隔离策略系统化整理 | 明确数据库、workspace 文件目录、daemon 执行目录的职责边界、隔离维度、生命周期与清理 contract |
| 64 | Agent Runtime 健康诊断与 Provider 可用性治理 | 区分 runtime online 与 provider usable，补齐 provider 错误归一化、健康检查、preflight 与统一诊断语义 |
| 65 | OpenClaw Daemon 权限、鉴权继承与 Provider 可用性修复 | 单独解决 OpenClaw 在 daemon 代跑场景下的权限边界、auth profile 继承、preflight 与错误归一化 |
| 66 | 对话级持久 Execution Workspace | 为 direct/group 对话引入每对话持久执行目录与正式状态模型，解决所有需要跨轮保留本地工作目录状态的 agent 连续性问题 |
| 68 | 协作平台核心能力补齐 | 补齐 collaborative object、评论、activity、assignments、presence、版本、agent proposal 与 review inbox，让真人和 agent 围绕文档/表格/TODO/任务共同工作 |
| 69 | Agent 预设模板与一键初始化 | 内置财务分析、产品经理、产品设计等岗位模板，预置 instructions、skills、runtime/knowledge 检查，让用户可以一键创建可工作的数字员工 |
| 71 | 群文档多格式扩展 | 将频道群文档从 Markdown 扩展到表格与演示文稿，比较内建 sheet/deck、Google Workspace、Notion、Microsoft 365 的可行性与易用性 |
| 72 | Google Workspace API 接入 | 说明 Sheets-first 的 Google Cloud/OAuth 配置、token 存储、Drive/Sheets API 调用、权限同步和 agent 操作审计接入方式 |
| 77 | 多 Agent 硬隔离与 Codex 执行安全 | 将当前 workspace/runtime/task 软隔离升级为 sandbox、凭据、网络、资源和 session 级硬隔离，支撑大量 Agent 并发执行 |
| 78 | Google Workspace 改为对接官方 gws CLI 执行 | 明确 AgentSpace↔Agent 通过 skill/task context 保留控制面，Agent↔Sheets/Docs data plane 完全走 Google 官方 gws CLI，并把官方 CLI 的 schema、dry-run、JSON output 等能力反哺控制面 |
| 82 | Agent 执行过程可见化与任务时间线 | 学习 WUPHF 的可见执行现场，把 daemon/task/runtime-output 信号收口为结构化任务执行时间线 |
| 83 | 任务级 Execution Workspace 隔离与产物回收 | 学习 WUPHF per-task worktree 思路，将当前对话级 workDir 升级为任务级隔离执行现场和正式产物回收链路 |
| 84 | 外部集成 Adapter Contract | 为消息、文档、runtime provider 建立统一 adapter contract、health、typed errors 和唯一注册入口 |
| 85 | Agent 动作权限 Policy 与审批联动 | 将权限中心、runtime grant、OAuth delegation 与审批串成执行前 policy decision：allow / require_approval / deny |
| 86 | 工程质量 Ratchet 与静态边界治理 | 建立文件大小、SQLite 运行态文件、跨层 import、explicit any、secret 检查的 forward-only 质量门槛 |
| 91 | Runtime / Provider / gws 状态 Contract | 区分 daemon online、runtime online、provider usable、gws usable，并补 preflight 与前端状态展示 |
| 92 | Provider permissions / sandbox 策略层 | 将 provider 执行权限、审批、沙箱和危险模式从硬编码收口为可配置策略 |
| 93 | CLI-Hub Runtime 应用市场 | 接入 clianything.cc / CLI-Hub，让用户像应用市场一样把 agent-native CLI 安装、更新到指定 runtime |
| 102 | AgentRouter OpenClaw Provider Hardening | 已完成：围绕 AgentRouter 升级 OpenClaw health/preflight、diagnostics、session fallback、profile/model contract 与 legacy path 收口 |
| 110 | 真正的 AgentRouter：平台级 Session 与跨 Runtime 连续性 | 将当前 harness execution adapter 升级为平台级 Agent session/router，持有 transcript、provider session mapping、handoff snapshot 与 runtime fallback 语义 |
| 114 | 数字员工展板与 Agent 权限申请 | 在员工管理和执行引擎管理之间新增 workspace 数字员工目录，支持查看公开简介并向权限管理人申请复制或调用权限 |
| 119 | Feishu Message + Data Plane Adapter | 将飞书作为受治理的外部 IM 壳和 Docs/Sheets/Base 数据面接入 AgentSpace，复用现有 channel/message/task/document/permission 主链路并保留共享、审批、审计控制平面 |
| 120 | Feishu Agent Bot Native Experience | 将飞书体验升级为“每个 AgentSpace agent 对应一个 Feishu bot”，支持 bot 进群自动创建/绑定 channel、未绑定用户 external guest 低权限交互，并保留 AgentSpace 权限/审批/审计治理 |

## 已放弃

- [106-wechat-login-support.md](Abandon/106-wechat-login-support.md) — 微信登录支持
- [107-phone-verification-code-login.md](Abandon/107-phone-verification-code-login.md) — 手机号验证码登录支持
- [108-email-verification-code-login.md](Abandon/108-email-verification-code-login.md) — 邮箱验证码登录支持

## 42 拆分文档

说明：以下 `42-*` 文件目前按**标题和说明**对应新的实施顺序，文件名沿用首次拆分时的命名。

- [42-multi-tenant-workspaces-and-google-auth.md](Done/42-multi-tenant-workspaces-and-google-auth.md) — 总览与总 TODO（已完成）
- [42-1-auth-and-google-login.md](Done/42-1-auth-and-google-login.md) — 多工作区、成员关系与访问控制（已完成）
- [42-2-workspace-membership-and-access-control.md](Done/42-2-workspace-membership-and-access-control.md) — `state_json` 拆分与并发模型治理（已完成）
- [42-3-postgresql-migration-and-data-cutover.md](Done/42-3-postgresql-migration-and-data-cutover.md) — 执行引擎、Daemon、附件与存储隔离（已完成）
- [42-4-state-json-decomposition-and-concurrency.md](Done/42-4-state-json-decomposition-and-concurrency.md) — PostgreSQL 迁移与数据切换（已完成）
- [42-5-runtime-daemon-and-storage-isolation.md](Done/42-5-runtime-daemon-and-storage-isolation.md) — 身份系统与 Google 登录（已完成）

## 实施顺序回顾

```
Phase 1: 20(全局搜索) + 23(消息增强)            ✅ 已完成
Phase 2: 21(审批) + 26(看板)                     ✅ 已完成
Phase 2.5: 30(组织架构) + 32(成本) + 33(预算)    ✅ 已完成
Phase 3: 22(知识库) + 31(Agent关系上下文)         ✅ 已完成
Phase 4: 24(绩效) + 25(数据表) + 34(预估)        ✅ 已完成
Phase 5: 27(自动化)                              ✅ 已完成
Phase 6: 28(日历) + 29(模板)                     ✅ 已完成
Phase 7: 08+10(附件前端展示)                     ✅ 已完成
```
