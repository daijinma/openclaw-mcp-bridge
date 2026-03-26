# HTTP Serve Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `serve` subcommand that exposes the MCP bridge over HTTP with Bearer token auth, and a `token` subcommand for token lifecycle management.

**Architecture:** Extend the existing MCP bridge with FastMCP's built-in `authenticate` callback + `httpStream` transport. Token store is a simple JSON file at `~/.openclaw-mcp-bridge/tokens.json`. The `serve` command connects to the local Gateway via `WsGatewayClient` (reusing existing code) and serves the same 4 MCP tools over HTTP. The `install` command is updated to generate `type: "remote"` opencode config when `--host` is an HTTP URL.

**Tech Stack:** FastMCP httpStream transport, Node.js `crypto.randomUUID()`, `node:fs/promises` for token persistence. No new dependencies needed.

---

## Key API Discoveries

### FastMCP authenticate callback
```typescript
// FastMCP ServerOptions has: authenticate?: (request: http.IncomingMessage) => Promise<T>
// T becomes available as session.auth in tool execute() context
// If authenticate throws, connection is rejected
// mcp-proxy catches: if (error instanceof Response) → res.writeHead(error.status).end(error.statusText)
// So throw new Response(null, { status: 401, statusText: "Unauthorized" }) for proper 401

const server = new FastMCP<{ tokenName: string }>({
  name: "...",
  version: "0.4.0",
  authenticate: async (request) => {
    const authHeader = request.headers.authorization
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null
    if (!token) throw new Response(null, { status: 401, statusText: "Missing Bearer token" })
    const info = await tokenStore.validate(token)
    if (!info) throw new Response(null, { status: 401, statusText: "Invalid token" })
    return { tokenName: info.name }
  },
})
```

### opencode remote MCP config (strict schema)
```json
{
  "type": "remote",
  "url": "https://server:3000/mcp",
  "headers": { "Authorization": "Bearer oc_xxxx" },
  "oauth": false,
  "enabled": true,
  "timeout": 120000
}
```

### Token file format (`~/.openclaw-mcp-bridge/tokens.json`)
```json
[
  {
    "id": "oc_550e8400-e29b-41d4-a716-446655440000",
    "name": "cow-laptop",
    "createdAt": "2026-03-26T10:00:00.000Z",
    "lastUsedAt": null,
    "active": true
  }
]
```

---

## Task 1: Token Store

**Files:**
- Create: `src/token-store.ts`

**Step 1: Write the token store module**

```typescript
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { resolve, dirname } from "node:path"
import { randomUUID } from "node:crypto"

const TOKEN_PREFIX = "oc_"

export interface TokenRecord {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
  active: boolean
}

function defaultTokensPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ""
  return resolve(home, ".openclaw-mcp-bridge", "tokens.json")
}

export class TokenStore {
  private tokensPath: string

  constructor(tokensPath?: string) {
    this.tokensPath = tokensPath ?? defaultTokensPath()
  }

  async load(): Promise<TokenRecord[]> {
    try {
      const raw = await readFile(this.tokensPath, "utf-8")
      return JSON.parse(raw) as TokenRecord[]
    } catch {
      return []
    }
  }

  private async save(tokens: TokenRecord[]): Promise<void> {
    await mkdir(dirname(this.tokensPath), { recursive: true })
    await writeFile(this.tokensPath, JSON.stringify(tokens, null, 2) + "\n")
  }

  async create(name: string): Promise<TokenRecord> {
    const tokens = await this.load()
    const record: TokenRecord = {
      id: `${TOKEN_PREFIX}${randomUUID()}`,
      name,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      active: true,
    }
    tokens.push(record)
    await this.save(tokens)
    return record
  }

  async list(): Promise<TokenRecord[]> {
    return this.load()
  }

  async revoke(idPrefix: string): Promise<TokenRecord | null> {
    const tokens = await this.load()
    const match = tokens.find((t) => t.id.startsWith(idPrefix) && t.active)
    if (!match) return null
    match.active = false
    await this.save(tokens)
    return match
  }

  async validate(bearerValue: string): Promise<TokenRecord | null> {
    const tokens = await this.load()
    const match = tokens.find((t) => t.id === bearerValue && t.active)
    if (!match) return null
    // Update lastUsedAt (fire-and-forget, don't block on I/O error)
    match.lastUsedAt = new Date().toISOString()
    this.save(tokens).catch(() => {})
    return match
  }
}
```

**Step 2: Run typecheck**

Run: `npx tsc --noEmit` from project root
Expected: PASS — no type errors

**Step 3: Commit**

```bash
git add src/token-store.ts
git commit -m "feat: add token store for serve mode auth"
```

---

## Task 2: Token CLI Subcommand

**Files:**
- Create: `src/token.ts`
- Modify: `src/index.ts` — add `token` subcommand routing

**Step 1: Write the token CLI module**

```typescript
import { TokenStore } from "./token-store.js"

export async function tokenCommand(argv: string[]): Promise<void> {
  const store = new TokenStore()
  const sub = argv[0]

  if (sub === "create") {
    const name = argv[1]
    if (!name) {
      console.error("Usage: openclaw-mcp-bridge token create <name>")
      console.error("")
      console.error("  <name>  Label for this token (e.g. cow-laptop, ci-server)")
      process.exit(1)
    }
    const record = await store.create(name)
    console.log("")
    console.log("✓ Token created:")
    console.log("")
    console.log(`  Token:   ${record.id}`)
    console.log(`  Name:    ${record.name}`)
    console.log(`  Created: ${record.createdAt}`)
    console.log("")
    console.log("Save this token — it won't be shown again in full.")
    console.log("")
    console.log("Usage with install:")
    console.log(`  npx openclaw-mcp-bridge install <name> --host http://<server>:3000 --token ${record.id}`)
    console.log("")
    return
  }

  if (sub === "list") {
    const tokens = await store.list()
    if (tokens.length === 0) {
      console.log("No tokens found. Create one with: openclaw-mcp-bridge token create <name>")
      return
    }
    console.log("")
    console.log("Tokens:")
    console.log("")
    for (const t of tokens) {
      const status = t.active ? "active" : "revoked"
      const lastUsed = t.lastUsedAt ?? "never"
      // Show only prefix of token ID for security
      const shortId = t.id.slice(0, 12) + "..."
      console.log(`  ${shortId}  ${t.name.padEnd(20)} ${status.padEnd(10)} last used: ${lastUsed}`)
    }
    console.log("")
    return
  }

  if (sub === "revoke") {
    const idPrefix = argv[1]
    if (!idPrefix) {
      console.error("Usage: openclaw-mcp-bridge token revoke <token-prefix>")
      console.error("")
      console.error("  <token-prefix>  Start of the token ID (e.g. oc_550e84)")
      process.exit(1)
    }
    const revoked = await store.revoke(idPrefix)
    if (!revoked) {
      console.error(`No active token found matching prefix "${idPrefix}"`)
      process.exit(1)
    }
    console.log(`✓ Token revoked: ${revoked.name} (${revoked.id.slice(0, 12)}...)`)
    return
  }

  console.error("Usage: openclaw-mcp-bridge token <create|list|revoke>")
  console.error("")
  console.error("Commands:")
  console.error("  create <name>          Create a new auth token")
  console.error("  list                   List all tokens")
  console.error("  revoke <token-prefix>  Revoke a token by ID prefix")
  process.exit(1)
}
```

**Step 2: Update `src/index.ts` — add `token` subcommand**

Add a new branch after the `install` check (line 6-8):

```typescript
// After the install block:
} else if (subcommand === "token") {
  const { tokenCommand } = await import("./token.js")
  await tokenCommand(process.argv.slice(3))
}
```

The full `index.ts` should have: `install`, `token`, `serve` (added in Task 3), and `else` (stdio default).

**Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Manual test**

Run (from project root):
```bash
npx tsx src/index.ts token create test-laptop
npx tsx src/index.ts token list
npx tsx src/index.ts token revoke oc_
```

Expected:
- `create` prints a token with `oc_` prefix
- `list` shows the token
- `revoke` deactivates it

**Step 5: Commit**

```bash
git add src/token.ts src/index.ts
git commit -m "feat: add token CLI for create/list/revoke"
```

---

## Task 3: Serve Subcommand

**Files:**
- Create: `src/serve.ts`
- Modify: `src/index.ts` — add `serve` subcommand routing

**Step 1: Write the serve module**

The serve module creates a FastMCP instance with:
- `authenticate` callback that validates Bearer tokens via TokenStore
- `httpStream` transport type
- Same 4 tool registrations as stdio mode
- Connects to Gateway via `WsGatewayClient`

```typescript
import { FastMCP } from "fastmcp"
import { loadConfig } from "./config.js"
import { WsGatewayClient } from "./ws-gateway-client.js"
import { CliGatewayClient } from "./gateway-client.js"
import { TokenStore } from "./token-store.js"
import { registerListAgents } from "./tools/list-agents.js"
import { registerCreateSession } from "./tools/create-session.js"
import { registerAskAgent } from "./tools/ask-agent.js"
import { registerGetHistory } from "./tools/get-history.js"

interface ServeOptions {
  port: number
}

function parseServeArgs(argv: string[]): ServeOptions {
  const portIdx = argv.indexOf("--port")
  const portStr = portIdx >= 0 ? argv[portIdx + 1] : process.env.OPENCLAW_SERVE_PORT
  const parsed = parseInt(portStr ?? "3000", 10)
  const port = Number.isNaN(parsed) ? 3000 : parsed
  return { port }
}

export async function serve(argv: string[]): Promise<void> {
  const options = parseServeArgs(argv)
  const config = loadConfig()
  const tokenStore = new TokenStore()

  // Verify we have tokens
  const tokens = await tokenStore.list()
  const activeTokens = tokens.filter((t) => t.active)
  if (activeTokens.length === 0) {
    console.error("No active tokens found. Create one first:")
    console.error("")
    console.error("  npx openclaw-mcp-bridge token create <name>")
    console.error("")
    process.exit(1)
  }

  const gateway = config.gatewayHost
    ? new WsGatewayClient(config)
    : new CliGatewayClient(config)

  const mode = config.gatewayHost ? "remote" : "local"

  const server = new FastMCP<{ tokenName: string }>({
    name: "openclaw-bridge-serve",
    version: "0.4.0",
    instructions:
      `This MCP server connects you to OpenClaw agents (${mode} mode, HTTP serve) for requirement discussions, ` +
      `technical consulting, and collaborative work. ` +
      `\n\nWorkflow:\n` +
      `1. list_agents — see available agents\n` +
      `2. ask_agent — send messages and get responses (multi-turn via sessionId)\n` +
      `3. create_session — (optional) pre-generate a sessionId\n` +
      `4. get_conversation_history — retrieve past messages`,
    authenticate: async (request) => {
      const authHeader = request.headers.authorization
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null
      if (!token) {
        throw new Response(null, { status: 401, statusText: "Missing Bearer token" })
      }
      const record = await tokenStore.validate(token)
      if (!record) {
        throw new Response(null, { status: 401, statusText: "Invalid or revoked token" })
      }
      return { tokenName: record.name }
    },
  })

  registerListAgents(server, gateway)
  registerCreateSession(server, gateway)
  registerAskAgent(server, gateway)
  registerGetHistory(server, gateway)

  await server.start({
    transportType: "httpStream",
    httpStream: {
      endpoint: "/mcp",
      port: options.port,
    },
  })

  console.log("")
  console.log(`✓ OpenClaw MCP bridge serving on http://0.0.0.0:${options.port}/mcp`)
  console.log(`  Mode: ${mode}`)
  console.log(`  Active tokens: ${activeTokens.length}`)
  console.log("")
  console.log("Client config (add to ~/.config/opencode/opencode.json):")
  console.log(JSON.stringify({
    type: "remote",
    url: `http://<this-server>:${options.port}/mcp`,
    headers: { Authorization: "Bearer <token>" },
    oauth: false,
    timeout: 120000,
  }, null, 2))
  console.log("")
}
```

**Step 2: Update `src/index.ts` — add `serve` routing**

The final `index.ts` should route: `install` → `token` → `serve` → default (stdio).

Full `index.ts`:
```typescript
#!/usr/bin/env node
export {}

const subcommand = process.argv[2]

if (subcommand === "install") {
  const { install } = await import("./install.js")
  await install(process.argv.slice(2))
} else if (subcommand === "token") {
  const { tokenCommand } = await import("./token.js")
  await tokenCommand(process.argv.slice(3))
} else if (subcommand === "serve") {
  const { serve } = await import("./serve.js")
  await serve(process.argv.slice(3))
} else {
  const { FastMCP } = await import("fastmcp")
  const { loadConfig } = await import("./config.js")
  const { CliGatewayClient } = await import("./gateway-client.js")
  const { WsGatewayClient } = await import("./ws-gateway-client.js")
  const { registerListAgents } = await import("./tools/list-agents.js")
  const { registerCreateSession } = await import("./tools/create-session.js")
  const { registerAskAgent } = await import("./tools/ask-agent.js")
  const { registerGetHistory } = await import("./tools/get-history.js")

  const config = loadConfig()

  const gateway = config.gatewayHost
    ? new WsGatewayClient(config)
    : new CliGatewayClient(config)

  const mode = config.gatewayHost ? "remote" : "local"
  const instanceName = process.env.OPENCLAW_INSTANCE_NAME ?? "openclaw-bridge"

  const server = new FastMCP({
    name: instanceName,
    version: "0.4.0",
    instructions:
      `This MCP server connects you to OpenClaw agents (${mode} mode) for requirement discussions, ` +
      `technical consulting, and collaborative work. ` +
      `\n\nWorkflow:\n` +
      `1. list_agents — see available agents\n` +
      `2. ask_agent — send messages and get responses (multi-turn via sessionId)\n` +
      `3. create_session — (optional) pre-generate a sessionId\n` +
      `4. get_conversation_history — retrieve past messages (remote mode only)`,
  })

  registerListAgents(server, gateway)
  registerCreateSession(server, gateway)
  registerAskAgent(server, gateway)
  registerGetHistory(server, gateway)

  server.start({ transportType: "stdio" })
}
```

**Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

**Important:** FastMCP's `FastMCP<{ tokenName: string }>` generic may cause type issues with the tool `register*` functions since they accept `FastMCP` (without generic param). If typecheck fails because of this, change `server` type:
- Option A: Cast at registration: `registerListAgents(server as unknown as FastMCP, gateway)`
- Option B: Use `FastMCP<Record<string, unknown>>` instead
- Option C: If the register functions accept any FastMCP, no change needed
Pick whichever compiles cleanly.

**Step 4: Commit**

```bash
git add src/serve.ts src/index.ts
git commit -m "feat: add serve subcommand with httpStream + Bearer auth"
```

---

## Task 4: Update Install for Remote HTTP Mode

**Files:**
- Modify: `src/install.ts`

**Step 1: Update `buildMcpEntry` to detect HTTP vs WS host**

When `--host` starts with `http://` or `https://`, generate a `type: "remote"` config entry. When `--host` starts with `ws://` or `wss://`, keep existing `type: "local"` behavior with env vars.

Add this function and modify `buildMcpEntry`:

```typescript
function isHttpHost(host: string): boolean {
  return host.startsWith("http://") || host.startsWith("https://")
}

function buildMcpEntry(options: InstallOptions, projectRoot: string) {
  // HTTP host → remote MCP config (for serve mode bridge)
  if (options.host && isHttpHost(options.host)) {
    const url = options.host.endsWith("/mcp") ? options.host : `${options.host}/mcp`
    const entry: Record<string, unknown> = {
      type: "remote",
      url,
      enabled: true,
      timeout: 120000,
      oauth: false,
    }
    if (options.token) {
      entry.headers = { Authorization: `Bearer ${options.token}` }
    }
    return entry
  }

  // WS host or local mode → local MCP config (existing behavior)
  const env: Record<string, string> = {
    OPENCLAW_INSTANCE_NAME: options.name,
  }

  if (options.host) {
    env.OPENCLAW_GATEWAY_HOST = options.host
  }
  if (options.token) {
    env.OPENCLAW_GATEWAY_TOKEN = options.token
  }
  if (options.bin) {
    env.OPENCLAW_BIN = options.bin
  }

  return {
    type: "local" as const,
    command: [
      "npx",
      "--prefix",
      projectRoot,
      "tsx",
      resolve(projectRoot, "src/index.ts"),
    ],
    environment: env,
    enabled: true,
    timeout: 120000,
  }
}
```

**Step 2: Update help text**

In `parseArgs`, update the help text to show HTTP mode:
- Change `--host <url>` description to: `Gateway URL (ws:// for direct, http:// for bridge serve mode)`
- Add HTTP example: `npx openclaw-mcp-bridge install kupuclaw --host http://server:3000 --token oc_xxx`

**Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Manual test**

```bash
# Test HTTP mode install (dry check — inspect output, don't actually run against real config)
npx tsx src/index.ts install test-http --host http://server:3000 --token oc_test123
```

Expected: Config file should contain `type: "remote"` with `url: "http://server:3000/mcp"` and `headers.Authorization`.

**Step 5: Commit**

```bash
git add src/install.ts
git commit -m "feat: install generates remote MCP config for HTTP bridge hosts"
```

---

## Task 5: Version Bump + README Update

**Files:**
- Modify: `package.json` — version → `0.4.0`
- Modify: `README.md` — add serve mode docs

**Step 1: Bump version in `package.json`**

Change `"version": "0.3.0"` → `"version": "0.4.0"`

**Step 2: Update README**

Add a new section after the existing Remote Mode section. The section should cover:

1. **Serve Mode** — what it is (HTTP proxy with auth for remote opencode clients)
2. **Quick Start** — 3 steps: create token, start server, install on client
3. **Token Management** — `token create/list/revoke` commands with examples
4. **Client Configuration** — opencode.json `type: "remote"` format
5. **Architecture diagram** — text diagram showing: `opencode → HTTP → bridge (serve) → WS → Gateway`

Write in bilingual style matching the existing README (Chinese with English technical terms).

**Step 3: Commit**

```bash
git add package.json README.md
git commit -m "docs: add serve mode documentation, bump to 0.4.0"
```

---

## Task 6: End-to-End Test

**No files to create — manual verification only.**

**Step 1: Create a test token**

```bash
npx tsx src/index.ts token create e2e-test
```

Save the printed token ID.

**Step 2: Start serve mode**

In one terminal (needs Gateway running on ws://127.0.0.1:18789):

```bash
OPENCLAW_GATEWAY_HOST=ws://127.0.0.1:18789 OPENCLAW_GATEWAY_TOKEN=<gateway-token> npx tsx src/index.ts serve --port 3000
```

Expected: `✓ OpenClaw MCP bridge serving on http://0.0.0.0:3000/mcp`

**Step 3: Test auth rejection**

```bash
curl -X POST http://localhost:3000/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":"1"}'
```

Expected: 401 response (no Bearer token)

**Step 4: Test auth acceptance**

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token-from-step-1>" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":"1"}'
```

Expected: 200 response with MCP initialize result (serverInfo, capabilities)

**Step 5: Test install generates remote config**

```bash
npx tsx src/index.ts install e2e-remote --host http://localhost:3000 --token <token>
```

Then verify `~/.config/opencode/opencode.json` has a `type: "remote"` entry for `openclaw-e2e-remote`.

**Step 6: Cleanup**

```bash
npx tsx src/index.ts token revoke <token-prefix>
```

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 1 | `src/token-store.ts` (create) | Token CRUD + validation |
| 2 | `src/token.ts` (create), `src/index.ts` (modify) | CLI token management |
| 3 | `src/serve.ts` (create), `src/index.ts` (modify) | HTTP serve with FastMCP authenticate |
| 4 | `src/install.ts` (modify) | Remote config for HTTP hosts |
| 5 | `package.json`, `README.md` (modify) | Version bump + docs |
| 6 | (none) | End-to-end verification |
