import { type FastMCP, UserError } from "fastmcp"
import { z } from "zod"
import { type IGatewayClient, extractText, extractSessionId } from "../gateway-client.js"

/** Generate a timestamped session key for a new topic: agent:<agentId>:<YYYYMMDD-HHmm> */
function makeTopicSessionKey(agentId: string): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `agent:${agentId}:${stamp}`
}

export function registerAskAgent(server: FastMCP, gateway: IGatewayClient) {
  server.addTool({
    name: "ask_agent",
    description:
      "Send a message to an OpenClaw agent and get the complete response.\n" +
      "Session behavior:\n" +
      "  - Default (no sessionId, no newTopic): continues the default 'main' topic.\n" +
      "  - newTopic=true: starts a NEW topic (like /new in OpenClaw). " +
      "Returns a unique sessionId — save it for follow-ups on that topic.\n" +
      "  - sessionId=<id>: resumes a specific previous topic.\n" +
      "  - newTopic + sessionId together: newTopic is ignored, sessionId takes precedence.\n" +
      "The response always includes the sessionId for continuation.",
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
          "Session ID to resume a specific topic. " +
          "Omit on first message; use the returned sessionId for follow-ups."
        ),
      newTopic: z
        .boolean()
        .optional()
        .describe(
          "Start a new conversation topic (equivalent to /new in OpenClaw). " +
          "Generates a unique session key. Ignored if sessionId is provided."
        ),
    }),
    annotations: {
      openWorldHint: true,
    },
    execute: async (args, { log }) => {
      try {
        const agentId = args.agentId ?? "main"

        // Resolve session: explicit sessionId > newTopic > default
        let resolvedSessionId = args.sessionId
        if (!resolvedSessionId && args.newTopic) {
          resolvedSessionId = makeTopicSessionKey(agentId)
        }

        log.info("Sending message to OpenClaw agent", {
          agentId,
          hasSession: !!resolvedSessionId,
          newTopic: !!args.newTopic,
        })

        const response = await gateway.sendMessage(
          args.message,
          agentId,
          resolvedSessionId,
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
