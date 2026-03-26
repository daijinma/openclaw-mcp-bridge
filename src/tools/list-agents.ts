import { type FastMCP, UserError } from "fastmcp"
import { z } from "zod"
import type { IGatewayClient } from "../gateway-client.js"

export function registerListAgents(server: FastMCP, gateway: IGatewayClient) {
  server.addTool({
    name: "list_agents",
    description:
      "List all available OpenClaw agents. " +
      "Use this to discover which agents you can talk to.",
    parameters: z.object({}),
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
    execute: async () => {
      try {
        const agents = await gateway.listAgents()
        if (agents.length === 0) {
          return "No agents found in the agents directory."
        }
        const lines = agents.map((a) => `- **${a.id}**`)
        return `Available agents:\n\n${lines.join("\n")}`
      } catch (err) {
        throw new UserError(
          `Failed to list agents: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    },
  })
}
