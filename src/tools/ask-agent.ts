import { type FastMCP, UserError } from "fastmcp"
import { z } from "zod"
import { type IGatewayClient, extractText, extractSessionId } from "../gateway-client.js"

export function registerAskAgent(server: FastMCP, gateway: IGatewayClient) {
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

        const text = extractText(response)
        const sid = extractSessionId(response)
        const duration = response.result?.meta?.durationMs ?? 0
        const model = response.result?.meta?.agentMeta?.model ?? "unknown"

        const lines = [text, "", "---", `sessionId: ${sid}`]
        if (duration > 0) lines.push(`duration: ${(duration / 1000).toFixed(1)}s`)
        lines.push(`model: ${model}`)

        return lines.join("\n")
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
