import { type FastMCP, UserError } from "fastmcp"
import { z } from "zod"
import { GatewayClient } from "../gateway-client.js"

export function registerAskAgent(server: FastMCP, gateway: GatewayClient) {
  server.addTool({
    name: "ask_agent",
    description:
      "Send a message to an OpenClaw agent and get the complete response. " +
      "Supports multi-turn conversations — pass the same sessionId for follow-ups. " +
      "First call can omit sessionId; the response includes one for continuation.",
    parameters: z.object({
      message: z
        .string()
        .describe("The message to send to the agent."),
      agentId: z
        .string()
        .optional()
        .describe(
          "Target agent ID (e.g. 'main'). Defaults to 'main' if omitted."
        ),
      sessionId: z
        .string()
        .optional()
        .describe(
          "Session ID for multi-turn conversation. " +
          "Omit on first message; use the returned sessionId for follow-ups."
        ),
    }),
    annotations: {
      openWorldHint: true,
    },
    execute: async (args, { log }) => {
      try {
        log.info("Sending message to OpenClaw agent", {
          agentId: args.agentId ?? "main",
          hasSession: !!args.sessionId,
        })

        const response = await gateway.sendMessage(
          args.message,
          args.agentId ?? "main",
          args.sessionId,
        )

        const text = GatewayClient.extractText(response)
        const sessionId = GatewayClient.extractSessionId(response)
        const duration = response.result.meta.durationMs

        return [
          text,
          "",
          "---",
          `sessionId: ${sessionId}`,
          `duration: ${(duration / 1000).toFixed(1)}s`,
          `model: ${response.result.meta.agentMeta.model}`,
        ].join("\n")
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (message.includes("timeout") || message.includes("TIMEOUT")) {
          throw new UserError(
            `Agent did not respond in time. The agent may still be processing. ` +
            `Try again with a longer timeout.`
          )
        }
        throw new UserError(`Agent communication failed: ${message}`)
      }
    },
  })
}
