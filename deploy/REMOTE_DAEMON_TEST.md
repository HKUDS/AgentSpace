# AgentSpace Remote Daemon 测试清单

这份文档只保留最短测试路径。

如果你要演示 AgentSpace 作为“创始人团队数字执行系统”的完整差异化路径，请配合阅读 `deploy/FOUNDER_EXECUTION_SHOWCASE.md`。

目标：

- 在前端生成一条安装命令
- 在 `Server B` 执行后让容器自动上线
- 在前端绑定 Agent
- 验证 `mention_chat` / `contact_chat`
- 停止 daemon 后确认前端状态离线

## 1. 你需要什么

### Server A

- AgentSpace Web/Backend 已经可访问
- 你能打开这些页面：
  - `/agents?mode=container`
  - `/agents?mode=agent`
  - `/settings`
  - `/im`
  - `/contacts`

### Server B

- Linux 机器
- 已安装至少一个 provider CLI：
  - `codex`
  - `claude`
  - `agy`（Antigravity）
  - `gemini`
  - `opencode`
  - `openclaw`
  - `nanobot`
  - `hermes`
- provider CLI 已经登录

可先在 `Server B` 检查：

```bash
which codex || true
which claude || true
which agy || true
which gemini || true
which opencode || true
which openclaw || true
which nanobot || true
which hermes || true
```

OpenClaw 额外 smoke：

```bash
agent-router detect
agent-router run --harness openclaw --cwd /tmp "reply with ok"
```

如果要验证 daemon task health/preflight，还要确认 OpenClaw profile 与模型路由已经可用：

- `OPENCLAW_PROFILE` 指向 daemon 用户可访问的 profile
- `OPENCLAW_MODEL` 是当前 profile 可用的 model hint（OpenClaw 2026.3.3 的 `agent` 命令没有显式 `--model`，daemon 会用 env 注入）
- 任务开始后，runtime metadata 的 `providerHealth` 能显示 `healthy` / `degraded` / `broken`

## 2. 最短通过标准

跑完后，你应该确认：

- [ ] `Server B` 成功执行安装命令
- [ ] `/settings` 能看到在线 daemon
- [ ] `Atlas` 已绑定到这个容器
- [ ] `@Atlas` 能回复
- [ ] `Atlas` 私聊能回复
- [ ] 停止 daemon 后 `/settings` 变离线

可选：

- [ ] 附件输出通过
- [ ] 文档更新通过
- [ ] OpenClaw provider health 能在 UI 中解释 profile/model/auth 错误

## 3. 在前端生成安装命令

1. 打开：

```text
https://<server-a-domain>/agents?mode=container
```

2. 点击 `添加容器`
3. 弹窗里会自动生成一条 bash 命令
4. 复制这条命令

同时记下弹窗里的：

- `Daemon token 记录 ID`

这个 ID 用于最后在 `/settings` 吊销 token。

## 4. 在 Server B 执行安装命令

把前端复制出来的命令粘到 `Server B` 执行。

命令大概长这样：

```bash
bash <(curl -fsSL https://<server-a-domain>/api/daemon/install-script) \
  --daemon-token "adt_xxx" \
  --daemon-id "daemon-xxxxx"
```

注意：

- 用计划承载 provider runtime 的用户执行；如果使用 root，需确认 `/root` 下已登录对应 provider，且任务命令会以 root 权限执行
- 当前执行用户必须已经登录了对应的 `codex` / `claude` / `agy` / `gemini` / `opencode` / `openclaw` / `nanobot` / `hermes`

执行完成后，建议立刻看状态：

```bash
~/.agent-space-daemon/runtime/bin/agent-space-daemon status --json --state-dir ~/.agent-space-daemon
~/.agent-space-daemon/runtime/bin/agent-space-daemon logs --lines 50 --state-dir ~/.agent-space-daemon
```

预期：

- daemon 已启动
- 日志里没有 token / auth 报错

## 5. 在前端确认容器上线

### 看 `/settings`

打开：

```text
https://<server-a-domain>/settings
```

预期：

- 出现新的 daemon 卡片
- 状态是 `在线 / Online`
- 模式是 `远程 / Remote`
- 下方至少有一条 runtime

### 看 `/agents?mode=container`

打开：

```text
https://<server-a-domain>/agents?mode=container
```

预期：

- 左侧容器列表里出现新容器
- 状态在线
- 详情中能看到：
  - provider
  - daemonKey
  - deviceName
  - heartbeat

## 6. 如果 Server B 同时有多个 provider CLI

这是正常情况。

当前行为是：

- daemon 会同时注册多条 runtime
- 你只需要在 Agent 设置里绑定你想用的那一条

推荐做法：

1. 先选 `codex` 跑一轮
2. 如果还想验证 `claude` / `agy` / `gemini` / `opencode` / `openclaw` / `nanobot` / `hermes`，再切过去重跑

## 7. 创建并绑定测试 Agent

推荐统一使用：

- Agent 名：`Atlas`

### 创建 Atlas

1. 打开：

```text
https://<server-a-domain>/agents?mode=agent
```

2. 点击 `新建 Agent`
3. 填：
  - Name: `Atlas`
  - Display name: `Atlas`
  - Description: `Remote daemon test agent`
4. 点击 `创建`

### 绑定容器

1. 仍然在 `/agents`
2. 选中 `Atlas`
3. 切到 `Settings`
4. 在 `Bind container` 下拉框里选择刚才上线的容器
5. 点击 `绑定容器`

预期：

- `Atlas` 显示已绑定 container
- Provider 不为空

## 8. 测试 mention_chat

1. 打开：

```text
https://<server-a-domain>/im
```

2. 选择任意已有频道
3. 发这条消息：

```text
@Atlas 请回复一句：manual mention smoke passed
```

预期：

1. 先出现一条 `Atlas` 的 pending 消息
2. 稍后被真实回复替换
3. 最终回复里包含：

```text
manual mention smoke passed
```

如果你想同时看 `Server B` 执行日志：

```bash
~/.agent-space-daemon/runtime/bin/agent-space-daemon logs --follow --state-dir ~/.agent-space-daemon
```

## 9. 测试 contact_chat

1. 打开：

```text
https://<server-a-domain>/contacts
```

2. 选择联系人 `Atlas`
3. 发这条私聊：

```text
请回复一句：manual contact smoke passed
```

预期：

1. 先出现 `Thinking`
2. 稍后变成最终回复
3. 最终回复里包含：

```text
manual contact smoke passed
```

## 10. 可选：测试附件输出

在 `/contacts` 给 `Atlas` 发：

```text
请生成一个 Markdown 文件作为附件返回。正文只写：manual attachment smoke passed
```

预期：

- 最终回复出现
- 回复下面有文件附件
- 点击可以下载或打开

## 11. 可选：测试文档更新

1. 打开：

```text
https://<server-a-domain>/im
```

2. 如果右侧没有文档，就先点 `+` 新建一份文档
3. 文档标题建议：`Remote Daemon Test`
4. 在频道里发：

```text
@Atlas 请直接更新当前频道文档《Remote Daemon Test》，在文末新增一行：manual document smoke passed。不要只回复文本，必须真正写入频道文档。
```

预期：

- `Atlas` 有正常回复
- 文档内容里真的出现 `manual document smoke passed`

## 12. 测试离线

在 `Server B` 执行：

```bash
~/.agent-space-daemon/runtime/bin/agent-space-daemon stop --state-dir ~/.agent-space-daemon
```

然后刷新：

```text
https://<server-a-domain>/settings
```

预期：

- daemon 状态变成 `offline`

## 13. 失败时先看哪里

优先顺序：

1. `Server B` 日志

```bash
~/.agent-space-daemon/runtime/bin/agent-space-daemon logs --lines 100 --state-dir ~/.agent-space-daemon
```

2. 前端 `/settings`
3. 前端 `/agents?mode=container`
4. 前端 `/inbox`

最常见原因：

- daemon token 不对
- `Server B` 没有 provider CLI
- provider CLI 没登录
- Agent 没绑定容器
- 消息里没有真的 `@Atlas`

## 14. 清理

### 吊销 token

1. 打开：

```text
https://<server-a-domain>/settings
```

2. 在 token 列表里找到刚才那条记录
3. ID 应与“添加容器”弹窗里显示的 `Daemon token 记录 ID` 一致
4. 点击 `吊销`

### 解绑 Agent

1. 打开 `/agents`
2. 选中 `Atlas`
3. 切到 `Settings`
4. 点击 `解除绑定`

### 停止 daemon

如果还没停，在 `Server B` 执行：

```bash
~/.agent-space-daemon/runtime/bin/agent-space-daemon stop --state-dir ~/.agent-space-daemon
```
