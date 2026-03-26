# OpenClaw MCP Bridge

MCP Server bridging local AI tools (opencode / Claude / Codex) to OpenClaw agents via CLI subprocess.

```
Local AI (opencode TUI)
    ↓ MCP stdio
openclaw-mcp-bridge (per-instance process)
    ↓ openclaw agent CLI
OpenClaw (local or remote)
    ↓
Agent (main / geo / ...)
```

## Install

```bash
git clone git@github.com:daijinma/openclaw-mcp-bridge.git
cd openclaw-mcp-bridge
npm install
```

Register an instance in opencode:

```bash
npx openclaw-mcp-bridge install localclaw
```

This adds two entries to `~/.config/opencode/opencode.json`:
- MCP server `openclaw-localclaw` — runs the bridge process
- Agent `@localclaw` — subagent you can @ in opencode TUI

### Options

```bash
npx openclaw-mcp-bridge install <name> [--bin <path>]
```

| Option | Description |
|---|---|
| `<name>` | Instance name (e.g. `localclaw`, `kupuclaw`) |
| `--bin` | Path to `openclaw` binary (default: `openclaw` in PATH) |

### Multiple Instances

Each OpenClaw connection gets its own MCP process and `@agent`:

```bash
npx openclaw-mcp-bridge install localclaw
npx openclaw-mcp-bridge install kupuclaw --bin /opt/kupuclaw/bin/openclaw
```

Result: `@localclaw` and `@kupuclaw` both available in opencode TUI.

## Usage

In opencode TUI:

```
@localclaw 最近做了哪些事情？
@localclaw 帮我看看 geo agent 的配置
@kupuclaw 对一下需求文档
```

The subagent forwards your message to the OpenClaw agent and returns the response.

Multi-turn conversations are supported — the bridge tracks session IDs automatically.

## MCP Tools

| Tool | Description |
|---|---|
| `list_agents` | List available OpenClaw agents |
| `create_session` | Pre-generate a session ID |
| `ask_agent` | Send message, get response (multi-turn via sessionId) |
| `get_conversation_history` | Not yet supported in CLI mode |

## How It Works

The bridge calls `openclaw agent --json --message "..." --agent <id>` as a subprocess. OpenClaw CLI loads plugins, runs the agent, and returns JSON on stdout. The bridge parses the JSON (handling mixed plugin logs) and returns the text to the MCP client.

Response times: 7-24 seconds typical (plugin loading + model inference).

## Environment Variables

Set via `environment` in MCP config (auto-configured by install):

| Variable | Default | Description |
|---|---|---|
| `OPENCLAW_INSTANCE_NAME` | `openclaw-bridge` | MCP server name for this instance |
| `OPENCLAW_BIN` | `openclaw` | Path to openclaw binary |
| `OPENCLAW_TIMEOUT_MS` | `300000` | CLI subprocess timeout (ms) |
| `OPENCLAW_AGENTS_DIR` | `~/.openclaw/agents` | Agent definitions directory |

## Prerequisites

- Node.js 22+
- `openclaw` CLI installed and configured
- At least one agent in `~/.openclaw/agents/`

## Config Format

The install command writes to `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "openclaw-localclaw": {
      "type": "local",
      "command": ["npx", "--prefix", "/path/to/openclaw-mcp-bridge", "tsx", "/path/to/openclaw-mcp-bridge/src/index.ts"],
      "environment": {
        "OPENCLAW_INSTANCE_NAME": "localclaw"
      },
      "enabled": true,
      "timeout": 120000
    }
  },
  "agent": {
    "localclaw": {
      "prompt": "你是 localclaw OpenClaw 桥接代理...",
      "mode": "subagent",
      "description": "与 localclaw OpenClaw agent 对话"
    }
  }
}
```

## Known Limitations

- `get_conversation_history` is stubbed — OpenClaw CLI doesn't expose history retrieval
- Remote OpenClaw servers (WebSocket) not yet supported — currently local CLI only
- MCP SDK pinned to 1.27.0 (1.28.0 has breaking change with FastMCP)
