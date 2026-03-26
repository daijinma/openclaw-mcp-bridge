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

  const server = new FastMCP({
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
      return undefined
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
  console.log("Client config (add to opencode.json mcp section):")
  console.log(JSON.stringify({
    type: "remote",
    url: `http://<this-server>:${options.port}/mcp`,
    headers: { Authorization: "Bearer <token>" },
    oauth: false,
    timeout: 120000,
  }, null, 2))
  console.log("")
}
