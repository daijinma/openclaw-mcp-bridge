#!/usr/bin/env node
export {}

const subcommand = process.argv[2]

if (subcommand === "install") {
  const { install } = await import("./install.js")
  await install(process.argv.slice(2))
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
    version: "0.3.0",
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
