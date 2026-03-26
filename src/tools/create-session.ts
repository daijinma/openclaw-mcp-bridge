import { type FastMCP, UserError } from "fastmcp"
import { z } from "zod"
import type { IGatewayClient } from "../gateway-client.js"

export function registerCreateSession(server: FastMCP, _gateway: IGatewayClient) {
  server.addTool({
    name: "create_session",
    description:
      "Create a new conversation session ID for multi-turn conversations. " +
      "Returns a sessionId (in agent:<id>:<name> format) for use with ask_agent. " +
      "The session maintains context across multiple ask_agent calls.",
    parameters: z.object({
      agentId: z
        .string()
        .default("main")
        .describe(
          "Target agent ID (e.g. 'main'). " +
          "Use list_agents to see available agents."
        ),
      sessionName: z
        .string()
        .default("main")
        .describe(
          "Session name for the conversation (e.g. 'main', 'requirements-review'). " +
          "Defaults to 'main'. Use a descriptive name for the conversation topic."
        ),
    }),
    annotations: {
      openWorldHint: true,
    },
    execute: async (args) => {
      try {
        const agentId = args.agentId
        const sessionName = args.sessionName
        const sessionId = `agent:${agentId}:${sessionName}`
        const result: Record<string, string> = {
          sessionId,
          agentId,
          sessionName,
          status: "created",
          note: `Use ask_agent with sessionId="${sessionId}" and agentId="${agentId}" to start the conversation.`,
        }
        return JSON.stringify(result, null, 2)
      } catch (err) {
        throw new UserError(
          `Failed to create session: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    },
  })
}
