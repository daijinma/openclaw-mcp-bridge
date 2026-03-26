import { type FastMCP, UserError } from "fastmcp"
import { z } from "zod"
import type { GatewayClient } from "../gateway-client.js"

export function registerGetHistory(server: FastMCP, _gateway: GatewayClient) {
  server.addTool({
    name: "get_conversation_history",
    description:
      "Retrieve conversation history is not yet supported via CLI bridge. " +
      "Use ask_agent with the same sessionId to continue conversations.",
    parameters: z.object({
      sessionId: z
        .string()
        .describe("Session ID from a previous ask_agent call."),
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
    execute: async (_args) => {
      throw new UserError(
        "Conversation history retrieval is not yet supported in CLI bridge mode. " +
        "To continue a conversation, use ask_agent with the same sessionId."
      )
    },
  })
}
