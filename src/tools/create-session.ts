import { type FastMCP, UserError } from "fastmcp"
import { z } from "zod"
import { randomUUID } from "node:crypto"
import type { GatewayClient } from "../gateway-client.js"

export function registerCreateSession(server: FastMCP, _gateway: GatewayClient) {
  server.addTool({
    name: "create_session",
    description:
      "Create a new conversation session ID for multi-turn conversations. " +
      "Returns a sessionId for use with ask_agent. " +
      "The session maintains context across multiple ask_agent calls.",
    parameters: z.object({
      agentId: z
        .string()
        .optional()
        .describe(
          "Target agent ID (e.g. 'main'). " +
          "Use list_agents to see available agents."
        ),
    }),
    annotations: {
      openWorldHint: true,
    },
    execute: async (args) => {
      try {
        const sessionId = randomUUID()
        const result: Record<string, string> = {
          sessionId,
          status: "created",
        }
        if (args.agentId) {
          result.agentId = args.agentId
          result.note = `Use ask_agent with sessionId="${sessionId}" and agentId="${args.agentId}" to start the conversation.`
        } else {
          result.note = `Use ask_agent with sessionId="${sessionId}" to start the conversation.`
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
