# OpenClaw MCP Bridge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an MCP Server that bridges local AI tools (opencode/claude/codex) to remote OpenClaw Gateway agents for requirement discussions.

**Architecture:** FastMCP TypeScript server exposing 4 tools (list_agents, create_session, ask_agent, get_conversation_history). Communicates with OpenClaw Gateway via HTTP REST + SSE. Stdio transport for maximum client compatibility.

**Tech Stack:** TypeScript, FastMCP, zod, eventsource-parser, Node.js 22+

---

### Task 1: Project Scaffolding — package.json, tsconfig, config module

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/config.ts`

**Step 1: Create package.json**

```json
{
  "name": "openclaw-mcp-bridge",
  "version": "0.1.0",
  "description": "MCP Server bridging local AI tools to remote OpenClaw Gateway agents",
  "type": "module",
  "main": "src/index.ts",
  "bin": {
    "openclaw-mcp-bridge": "src/index.ts"
  },
  "scripts": {
    "start": "tsx src/index.ts",
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "fastmcp": "^1.0.0",
    "zod": "^3.23.0",
    "eventsource-parser": "^3.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "tsx": "^4.19.0",
    "@types/node": "^22.0.0"
  },
  "engines": {
    "node": ">=22.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

**Step 3: Create src/config.ts**

Environment variable loading + validation. Fail fast if required vars missing.

```typescript
export interface BridgeConfig {
  gatewayUrl: string
  username: string
  password: string
  directory: string
  timeoutMs: number
}

export function loadConfig(): BridgeConfig {
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL ?? "http://localhost:4096"
  const password = process.env.OPENCLAW_PASSWORD ?? ""
  const username = process.env.OPENCLAW_USERNAME ?? "opencode"
  const directory = process.env.OPENCLAW_DIRECTORY ?? process.cwd()
  const timeoutMs = parseInt(process.env.OPENCLAW_TIMEOUT_MS ?? "120000", 10)

  return { gatewayUrl, username, password, directory, timeoutMs }
}

export function getAuthHeader(config: BridgeConfig): Record<string, string> {
  if (!config.password) return {}
  const credentials = Buffer.from(`${config.username}:${config.password}`).toString("base64")
  return { Authorization: `Basic ${credentials}` }
}
```

**Step 4: Install dependencies**

```bash
cd openclaw-mcp-bridge && npm install
```

**Step 5: Verify typecheck**

```bash
npx tsc --noEmit
```

---

### Task 2: Gateway Client — HTTP + SSE communication layer

**Files:**
- Create: `src/gateway-client.ts`

The core client that handles all communication with OpenClaw Gateway. Key methods:
- `listAgents()` — GET /agent
- `createSession(agentId?)` — POST /session
- `sendMessage(sessionId, message, agentId?)` — POST /session/{id}/message + SSE listen for completion
- `getMessages(sessionId)` — GET /session/{id}/messages

For `sendMessage`, the flow is:
1. Subscribe to SSE `GET /event`
2. POST message to `/session/{id}/message` with `parts: [{type: "text", text}]`
3. Listen for `message.part.updated` events matching the session
4. Wait for `session.status` with `type: "idle"` to know response is complete
5. Return collected text parts

---

### Task 3: Tool — list_agents

**Files:**
- Create: `src/tools/list-agents.ts`

Register a `list_agents` tool on the FastMCP server. No parameters. Calls `gateway.listAgents()` and returns formatted agent list.

---

### Task 4: Tool — create_session

**Files:**
- Create: `src/tools/create-session.ts`

Register a `create_session` tool. Parameters: `agentId` (string, optional). Calls `gateway.createSession()`, returns sessionId.

---

### Task 5: Tool — ask_agent (core tool)

**Files:**
- Create: `src/tools/ask-agent.ts`

Register an `ask_agent` tool. Parameters: `sessionId` (string), `message` (string), `agentId` (string, optional). Calls `gateway.sendMessage()` which internally handles the SSE response collection. Returns the agent's complete text response.

---

### Task 6: Tool — get_conversation_history

**Files:**
- Create: `src/tools/get-history.ts`

Register a `get_conversation_history` tool. Parameters: `sessionId` (string). Calls `gateway.getMessages()`, returns formatted conversation history.

---

### Task 7: Server Entry Point + Integration

**Files:**
- Create: `src/index.ts`

FastMCP server bootstrap. Loads config, validates, creates gateway client, registers all 4 tools, starts stdio transport.

---

### Task 8: README

**Files:**
- Create: `README.md`

Usage instructions, environment variables, client configuration examples for opencode/claude/codex.
