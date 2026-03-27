# OpenClaw MCP Bridge

[English](#english) | [中文](#中文)

---

<a id="english"></a>

MCP Server bridging local AI tools (opencode / Claude / Codex) to OpenClaw agents.

```
Local AI (opencode / Claude / Codex)
    ↓ MCP stdio (local) or HTTP (serve mode)
openclaw-mcp-bridge (per-instance process)
    ↓ openclaw agent CLI (local) or WebSocket (remote)
OpenClaw
    ↓
Agent (main / geo / ...)
```

## Quick Start

### 1. Install the bridge

```bash
git clone git@github.com:daijinma/openclaw-mcp-bridge.git
cd openclaw-mcp-bridge
npm install
```

### 2. Register in opencode

```bash
npx openclaw-mcp-bridge install localclaw
```

This adds two entries to `~/.config/opencode/opencode.json`:
- MCP server `openclaw-localclaw` — runs the bridge process
- Agent `@localclaw` — subagent you can `@` in opencode TUI

### 3. Use it

```
@localclaw 最近做了哪些事情？
@localclaw 帮我看看 geo agent 的配置
```

## Connection Modes

### Local Mode (available now)

Connects via `openclaw agent` CLI subprocess. Requires `openclaw` installed locally.

```bash
npx openclaw-mcp-bridge install localclaw
npx openclaw-mcp-bridge install localclaw --bin /usr/local/bin/openclaw
```

### Remote Mode (available now)

Connects via WebSocket to a remote OpenClaw Gateway server. No local `openclaw` CLI needed.

```bash
npx openclaw-mcp-bridge install kupuclaw --host wss://your-server:18789 --token your-token
```

#### Remote OpenClaw Server Setup

To use remote mode, you need an OpenClaw server with the Gateway accessible over the network:

**1. Install OpenClaw on the server**

```bash
npm install -g openclaw
openclaw setup
```

**2. Configure Gateway for remote access**

Edit `~/.openclaw/openclaw.json` on the server:

```json
{
  "gateway": {
    "port": 18789,
    "bind": "lan",
    "auth": {
      "mode": "token",
      "token": "your-secret-token"
    }
  }
}
```

| Field | Value | Description |
|---|---|---|
| `bind` | `"lan"` or `"custom"` | `"loopback"` = localhost only, `"lan"` = LAN accessible |
| `auth.mode` | `"token"` | Recommended. Options: `"none"`, `"token"`, `"password"`, `"trusted-proxy"` |
| `auth.token` | string | Shared secret. Can also set via `OPENCLAW_GATEWAY_TOKEN` env var |

**3. Start the Gateway**

```bash
openclaw
```

The Gateway listens on `ws://your-server:18789`. For production, put it behind a reverse proxy with TLS → `wss://your-server/openclaw`.

**4. Connect from your local machine**

```bash
npx openclaw-mcp-bridge install kupuclaw --host wss://your-server:18789 --token your-secret-token
```

Then in opencode:

```
@kupuclaw 对一下需求文档
```

### Serve Mode (v0.4.0)

Runs the bridge as an HTTP server with Bearer token auth. Remote opencode clients connect to it over the network without needing direct Gateway access.

```
opencode (remote machine)
    ↓ HTTP (Bearer token)
openclaw-mcp-bridge serve (server)
    ↓ WebSocket
OpenClaw Gateway (loopback only)
```

**1. Create an auth token on the server**

```bash
npx openclaw-mcp-bridge token create my-laptop
# → oc_550e8400-e29b-41d4-a716-446655440000
```

**2. Start the serve mode**

```bash
OPENCLAW_GATEWAY_HOST=ws://127.0.0.1:18789 OPENCLAW_GATEWAY_TOKEN=your-gw-token \
  npx openclaw-mcp-bridge serve --port 3000
```

**3. Install on the client machine**

```bash
npx openclaw-mcp-bridge install kupuclaw --host http://server:3000 --token oc_550e8400...
```

This generates a `type: "remote"` MCP config in opencode:

```json
{
  "type": "remote",
  "url": "http://server:3000/mcp",
  "headers": { "Authorization": "Bearer oc_550e8400..." },
  "oauth": false,
  "timeout": 120000
}
```

#### Token Management

```bash
npx openclaw-mcp-bridge token create <name>   # Create a new token
npx openclaw-mcp-bridge token list             # List all tokens
npx openclaw-mcp-bridge token revoke <prefix>  # Revoke by ID prefix
```

## Install Options

```bash
npx openclaw-mcp-bridge install <name> [options]
```

| Option | Description |
|---|---|
| `<name>` | Instance name (e.g. `localclaw`, `kupuclaw`) |
| `--bin <path>` | Path to `openclaw` binary (local mode, default: `openclaw`) |
| `--host <url>` | Gateway URL (`ws://` for direct WS, `http://` for bridge serve mode) |
| `--token <token>` | Auth token (Gateway token for `ws://`, bridge token for `http://`) |

### Multiple Instances

Each OpenClaw connection gets its own MCP process and `@agent`:

```bash
npx openclaw-mcp-bridge install localclaw
npx openclaw-mcp-bridge install kupuclaw --host wss://kupu-server:18789 --token xxx
npx openclaw-mcp-bridge install kupuclaw --host http://bridge-server:3000 --token oc_xxx
```

Result: `@localclaw` and `@kupuclaw` both available in opencode TUI, connecting to different OpenClaw instances.

## MCP Tools

| Tool | Description |
|---|---|
| `list_agents` | List available OpenClaw agents |
| `create_session` | Pre-generate a session ID |
| `ask_agent` | Send message, get response (multi-turn via sessionId) |
| `get_conversation_history` | Retrieve past messages (remote mode only) |

## How It Works

**Local mode**: The bridge calls `openclaw agent --json --message "..." --agent <id>` as a subprocess. OpenClaw CLI loads plugins, runs the agent, and returns JSON on stdout.

**Remote mode**: The bridge connects to the OpenClaw Gateway via WebSocket (`ws://host:18789`), authenticates with a token, and sends/receives messages using the Gateway's RPC protocol. Responses are streamed via `chat` events.

Response times: 7-24 seconds typical (plugin loading + model inference).

## Environment Variables

Set via `environment` in MCP config (auto-configured by install):

| Variable | Default | Description |
|---|---|---|
| `OPENCLAW_INSTANCE_NAME` | `openclaw-bridge` | MCP server name for this instance |
| `OPENCLAW_BIN` | `openclaw` | Path to openclaw binary (local mode) |
| `OPENCLAW_TIMEOUT_MS` | `300000` | Subprocess / WebSocket timeout (ms) |
| `OPENCLAW_AGENTS_DIR` | `~/.openclaw/agents` | Agent definitions directory |
| `OPENCLAW_GATEWAY_HOST` | — | Gateway WebSocket URL (remote mode) |
| `OPENCLAW_GATEWAY_TOKEN` | — | Gateway auth token (remote mode) |
| `OPENCLAW_SERVE_PORT` | `3000` | HTTP port for serve mode |

## Prerequisites

- Node.js 22+
- **Local mode**: `openclaw` CLI installed, at least one agent in `~/.openclaw/agents/`
- **Remote mode**: OpenClaw Gateway accessible over network with auth token

## Known Limitations

- `get_conversation_history` is stubbed in CLI mode — use remote mode for full history support
- MCP SDK pinned to 1.20.2 (later versions have breaking change with FastMCP)

## For AI Assistants

> This section is written for LLMs (Claude, GPT, Codex, etc.) who are asked to install openclaw-mcp-bridge for a user. Follow these steps exactly.

### Scenario 1: Local Mode (openclaw CLI installed on this machine)

```bash
# 1. Clone and install
git clone git@github.com:daijinma/openclaw-mcp-bridge.git ~/openclaw-mcp-bridge
cd ~/openclaw-mcp-bridge && npm install

# 2. Register in opencode (creates MCP server + @agent entry)
npx openclaw-mcp-bridge install localclaw
```

Done. User can now type `@localclaw 你好` in opencode.

### Scenario 2: Remote Mode (connect to a remote OpenClaw Gateway via WebSocket)

User must provide: Gateway host (ws:// or wss://), Gateway auth token.

```bash
# 1. Clone and install
git clone git@github.com:daijinma/openclaw-mcp-bridge.git ~/openclaw-mcp-bridge
cd ~/openclaw-mcp-bridge && npm install

# 2. Register with remote Gateway
npx openclaw-mcp-bridge install kupuclaw --host wss://<gateway-host>:18789 --token <gateway-token>
```

### Scenario 3: Serve Mode (connect to a remote bridge HTTP server)

User must provide: bridge server URL (http:// or https://), bridge auth token (oc_xxx format).

```bash
# 1. Clone and install
git clone git@github.com:daijinma/openclaw-mcp-bridge.git ~/openclaw-mcp-bridge
cd ~/openclaw-mcp-bridge && npm install

# 2. Register with remote bridge server
npx openclaw-mcp-bridge install kupuclaw --host http://<bridge-server>:3000 --token <bridge-token>
```

### Scenario 4: Setting up a bridge server (serve mode — server side)

This is for the machine that runs OpenClaw Gateway and wants to expose it to remote clients.

```bash
# 1. Clone and install
git clone git@github.com:daijinma/openclaw-mcp-bridge.git ~/openclaw-mcp-bridge
cd ~/openclaw-mcp-bridge && npm install

# 2. Create auth tokens for each client
cd ~/openclaw-mcp-bridge
npx openclaw-mcp-bridge token create alice-laptop
npx openclaw-mcp-bridge token create bob-desktop
# Save the printed oc_xxx token IDs — give them to each client

# 3. Start the HTTP server (Gateway must be running on localhost)
OPENCLAW_GATEWAY_HOST=ws://127.0.0.1:18789 OPENCLAW_GATEWAY_TOKEN=<gateway-token> \
  npx openclaw-mcp-bridge serve --port 3000
```

### What `install` does

It writes to `~/.config/opencode/opencode.json`:

1. **MCP server entry** (`mcp.openclaw-<name>`) — either `type: "local"` (spawns process) or `type: "remote"` (HTTP connection)
2. **Agent entry** (`agent.<name>`) — a subagent accessible via `@<name>` in opencode that auto-forwards messages to OpenClaw

### Key rules

- The `<name>` argument to `install` is user-chosen (e.g. `localclaw`, `kupuclaw`, `work-claw`)
- Multiple instances can coexist — each gets its own MCP process and `@agent`
- `--host http://...` → generates `type: "remote"` config (serve mode)
- `--host ws://...` or `--host wss://...` → generates `type: "local"` config with WS env vars
- No `--host` → generates `type: "local"` config using CLI subprocess
- Requires Node.js 22+

---

<a id="中文"></a>

# OpenClaw MCP 桥接器

将本地 AI 工具（opencode / Claude / Codex）连接到 OpenClaw Agent 的 MCP Server。

```
本地 AI (opencode / Claude / Codex)
    ↓ MCP stdio（本地）或 HTTP（服务模式）
openclaw-mcp-bridge（每个实例一个进程）
    ↓ openclaw CLI（本地）或 WebSocket（远程）
OpenClaw
    ↓
Agent (main / geo / ...)
```

## 快速开始

### 1. 安装桥接器

```bash
git clone git@github.com:daijinma/openclaw-mcp-bridge.git
cd openclaw-mcp-bridge
npm install
```

### 2. 注册到 opencode

```bash
npx openclaw-mcp-bridge install localclaw
```

自动在 `~/.config/opencode/opencode.json` 中添加：
- MCP 服务 `openclaw-localclaw` — 运行桥接进程
- 子代理 `@localclaw` — 在 opencode 中可直接 @ 使用

### 3. 使用

```
@localclaw 最近做了哪些事情？
@localclaw 帮我看看 geo agent 的配置
```

## 连接模式

### 本地模式（已实现）

通过 `openclaw agent` CLI 子进程连接，需要本地安装 `openclaw`。

```bash
npx openclaw-mcp-bridge install localclaw
npx openclaw-mcp-bridge install localclaw --bin /usr/local/bin/openclaw
```

### 远程模式（已实现）

通过 WebSocket 连接远程 OpenClaw Gateway 服务器，无需本地安装 `openclaw` CLI。

```bash
npx openclaw-mcp-bridge install kupuclaw --host wss://your-server:18789 --token your-token
```

#### 远程 OpenClaw 服务端配置

使用远程模式前，需要在服务器上配置 OpenClaw Gateway 允许网络访问：

**1. 在服务器上安装 OpenClaw**

```bash
npm install -g openclaw
openclaw setup
```

**2. 配置 Gateway 远程访问**

编辑服务器上的 `~/.openclaw/openclaw.json`：

```json
{
  "gateway": {
    "port": 18789,
    "bind": "lan",
    "auth": {
      "mode": "token",
      "token": "你的密钥"
    }
  }
}
```

| 字段 | 值 | 说明 |
|---|---|---|
| `bind` | `"lan"` 或 `"custom"` | `"loopback"` = 仅本机, `"lan"` = 局域网可访问 |
| `auth.mode` | `"token"` | 推荐。可选: `"none"`, `"token"`, `"password"`, `"trusted-proxy"` |
| `auth.token` | 字符串 | 共享密钥，也可通过环境变量 `OPENCLAW_GATEWAY_TOKEN` 设置 |

**3. 启动 Gateway**

```bash
openclaw
```

Gateway 监听 `ws://服务器地址:18789`。生产环境建议配合反向代理 + TLS → `wss://域名/openclaw`。

**4. 从本地连接**

```bash
npx openclaw-mcp-bridge install kupuclaw --host wss://服务器地址:18789 --token 你的密钥
```

然后在 opencode 中：

```
@kupuclaw 对一下需求文档
```

### 服务模式 (v0.4.0)

将桥接器作为 HTTP 服务运行，使用 Bearer token 认证。远程 opencode 客户端通过网络连接，无需直接访问 Gateway。

```
opencode（远程机器）
    ↓ HTTP（Bearer token）
openclaw-mcp-bridge serve（服务器）
    ↓ WebSocket
OpenClaw Gateway（仅本机监听）
```

**1. 在服务器上创建认证 token**

```bash
npx openclaw-mcp-bridge token create my-laptop
# → oc_550e8400-e29b-41d4-a716-446655440000
```

**2. 启动服务模式**

```bash
OPENCLAW_GATEWAY_HOST=ws://127.0.0.1:18789 OPENCLAW_GATEWAY_TOKEN=你的网关密钥 \
  npx openclaw-mcp-bridge serve --port 3000
```

**3. 在客户端机器上安装**

```bash
npx openclaw-mcp-bridge install kupuclaw --host http://服务器:3000 --token oc_550e8400...
```

自动生成 `type: "remote"` 的 MCP 配置：

```json
{
  "type": "remote",
  "url": "http://服务器:3000/mcp",
  "headers": { "Authorization": "Bearer oc_550e8400..." },
  "oauth": false,
  "timeout": 120000
}
```

#### Token 管理

```bash
npx openclaw-mcp-bridge token create <名称>     # 创建新 token
npx openclaw-mcp-bridge token list               # 列出所有 token
npx openclaw-mcp-bridge token revoke <前缀>      # 按 ID 前缀撤销
```

## 安装选项

```bash
npx openclaw-mcp-bridge install <名称> [选项]
```

| 选项 | 说明 |
|---|---|
| `<名称>` | 实例名（如 `localclaw`, `kupuclaw`） |
| `--bin <路径>` | openclaw 二进制文件路径（本地模式，默认: `openclaw`） |
| `--host <地址>` | Gateway 地址（`ws://` 直连, `http://` 桥接服务模式） |
| `--token <密钥>` | 认证密钥（`ws://` 用 Gateway 密钥, `http://` 用桥接 token） |

### 多实例

每个 OpenClaw 连接对应独立的 MCP 进程和 `@agent`：

```bash
npx openclaw-mcp-bridge install localclaw
npx openclaw-mcp-bridge install kupuclaw --host wss://kupu-server:18789 --token xxx
npx openclaw-mcp-bridge install kupuclaw --host http://桥接服务器:3000 --token oc_xxx
```

结果：opencode 中同时可用 `@localclaw` 和 `@kupuclaw`，分别连接不同的 OpenClaw 实例。

## MCP 工具

| 工具 | 说明 |
|---|---|
| `list_agents` | 列出可用的 OpenClaw Agent |
| `create_session` | 预生成会话 ID |
| `ask_agent` | 发送消息并获取回复（通过 sessionId 支持多轮对话） |
| `get_conversation_history` | 获取历史消息（仅远程模式） |

## 工作原理

**本地模式**：桥接器调用 `openclaw agent --json --message "..." --agent <id>` 子进程。OpenClaw CLI 加载插件、运行 Agent，通过 stdout 返回 JSON。

**远程模式**：桥接器通过 WebSocket 连接 OpenClaw Gateway（`ws://host:18789`），使用 token 认证，通过 Gateway RPC 协议收发消息，响应通过 `chat` 事件流式推送。

响应时间：通常 7-24 秒（插件加载 + 模型推理）。

## 环境变量

通过 MCP 配置中的 `environment` 设置（install 命令自动配置）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OPENCLAW_INSTANCE_NAME` | `openclaw-bridge` | 该实例的 MCP 服务名 |
| `OPENCLAW_BIN` | `openclaw` | openclaw 二进制路径（本地模式） |
| `OPENCLAW_TIMEOUT_MS` | `300000` | 子进程 / WebSocket 超时（毫秒） |
| `OPENCLAW_AGENTS_DIR` | `~/.openclaw/agents` | Agent 定义目录 |
| `OPENCLAW_GATEWAY_HOST` | — | Gateway WebSocket 地址（远程模式） |
| `OPENCLAW_GATEWAY_TOKEN` | — | Gateway 认证密钥（远程模式） |
| `OPENCLAW_SERVE_PORT` | `3000` | 服务模式 HTTP 端口 |

## 前置要求

- Node.js 22+
- **本地模式**: 已安装 `openclaw` CLI，`~/.openclaw/agents/` 下至少有一个 Agent
- **远程模式**: OpenClaw Gateway 可通过网络访问，且已配置认证 token

## 已知限制

- `get_conversation_history` 在 CLI 模式下暂未实现 — 远程模式支持完整历史
- MCP SDK 固定为 1.20.2（更高版本与 FastMCP 不兼容）

## 给 AI 助手的安装指南

> 本节写给 LLM（Claude、GPT、Codex 等），当用户要求安装 openclaw-mcp-bridge 时，按以下步骤执行。

### 场景 1：本地模式（本机已安装 openclaw CLI）

```bash
# 1. 克隆并安装
git clone git@github.com:daijinma/openclaw-mcp-bridge.git ~/openclaw-mcp-bridge
cd ~/openclaw-mcp-bridge && npm install

# 2. 注册到 opencode（创建 MCP 服务 + @agent）
npx openclaw-mcp-bridge install localclaw
```

完成。用户在 opencode 中输入 `@localclaw 你好` 即可使用。

### 场景 2：远程模式（通过 WebSocket 连接远程 OpenClaw Gateway）

用户需提供：Gateway 地址（ws:// 或 wss://）、Gateway 认证 token。

```bash
# 1. 克隆并安装
git clone git@github.com:daijinma/openclaw-mcp-bridge.git ~/openclaw-mcp-bridge
cd ~/openclaw-mcp-bridge && npm install

# 2. 注册远程 Gateway
npx openclaw-mcp-bridge install kupuclaw --host wss://<gateway地址>:18789 --token <gateway密钥>
```

### 场景 3：服务模式（连接远程桥接 HTTP 服务器）

用户需提供：桥接服务器地址（http:// 或 https://）、桥接认证 token（oc_xxx 格式）。

```bash
# 1. 克隆并安装
git clone git@github.com:daijinma/openclaw-mcp-bridge.git ~/openclaw-mcp-bridge
cd ~/openclaw-mcp-bridge && npm install

# 2. 注册远程桥接服务器
npx openclaw-mcp-bridge install kupuclaw --host http://<桥接服务器>:3000 --token <桥接token>
```

### 场景 4：搭建桥接服务器（服务模式 — 服务端）

适用于运行 OpenClaw Gateway 的机器，将其安全地暴露给远程客户端。

```bash
# 1. 克隆并安装
git clone git@github.com:daijinma/openclaw-mcp-bridge.git ~/openclaw-mcp-bridge
cd ~/openclaw-mcp-bridge && npm install

# 2. 为每个客户端创建认证 token
cd ~/openclaw-mcp-bridge
npx openclaw-mcp-bridge token create alice-laptop
npx openclaw-mcp-bridge token create bob-desktop
# 保存打印出的 oc_xxx token，分发给对应客户端

# 3. 启动 HTTP 服务（Gateway 需在本机运行）
OPENCLAW_GATEWAY_HOST=ws://127.0.0.1:18789 OPENCLAW_GATEWAY_TOKEN=<gateway密钥> \
  npx openclaw-mcp-bridge serve --port 3000
```

### install 命令做了什么

写入 `~/.config/opencode/opencode.json`：

1. **MCP 服务条目** (`mcp.openclaw-<名称>`) — `type: "local"`（启动子进程）或 `type: "remote"`（HTTP 连接）
2. **Agent 条目** (`agent.<名称>`) — 在 opencode 中通过 `@<名称>` 调用的子代理，自动转发消息到 OpenClaw

### 关键规则

- `<名称>` 参数由用户自定义（如 `localclaw`、`kupuclaw`、`work-claw`）
- 支持多实例共存 — 每个实例有独立的 MCP 进程和 `@agent`
- `--host http://...` → 生成 `type: "remote"` 配置（服务模式）
- `--host ws://...` 或 `--host wss://...` → 生成 `type: "local"` 配置，带 WS 环境变量
- 不传 `--host` → 生成 `type: "local"` 配置，使用 CLI 子进程
- 需要 Node.js 22+
