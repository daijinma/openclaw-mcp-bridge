import { execFile } from "node:child_process"
import { readdir } from "node:fs/promises"
import { type BridgeConfig } from "./config.js"

export interface AgentInfo {
  id: string
}

export interface AgentResponse {
  runId: string
  status: string
  summary: string
  sessionId: string
  result: {
    payloads: Array<{ text: string | null; mediaUrl: string | null }>
    meta: {
      durationMs: number
      agentMeta: {
        sessionId: string
        provider: string
        model: string
        usage: Record<string, number>
      }
      aborted: boolean
      stopReason: string
    }
  }
}

export interface IGatewayClient {
  listAgents(): Promise<AgentInfo[]>
  sendMessage(
    message: string,
    agentId?: string,
    sessionId?: string,
  ): Promise<AgentResponse>
}

export function extractText(response: AgentResponse): string {
  if (response.result?.payloads) {
    const texts = response.result.payloads
      .filter((p) => p.text)
      .map((p) => p.text!)
    if (texts.length > 0) return texts.join("\n\n")
  }
  return response.summary || "(Agent returned no text response)"
}

export function extractSessionId(response: AgentResponse): string {
  return (
    response.sessionId ||
    response.result?.meta?.agentMeta?.sessionId ||
    ""
  )
}

export class CliGatewayClient implements IGatewayClient {
  constructor(private config: BridgeConfig) {}

  async listAgents(): Promise<AgentInfo[]> {
    try {
      const entries = await readdir(this.config.agentsDir, { withFileTypes: true })
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => ({ id: e.name }))
    } catch {
      return []
    }
  }

  async sendMessage(
    message: string,
    agentId?: string,
    sessionId?: string,
  ): Promise<AgentResponse> {
    const args = ["agent", "--json", "--message", message]

    if (agentId) {
      args.push("--agent", agentId)
    }
    if (sessionId) {
      args.push("--session-id", sessionId)
    }

    const timeoutSeconds = Math.ceil(this.config.timeoutMs / 1000)
    args.push("--timeout", String(timeoutSeconds))

    const stdout = await this.exec(args)
    return this.parseResponse(stdout)
  }

  private exec(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        this.config.openclawBin,
        args,
        {
          timeout: this.config.timeoutMs + 10_000,
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env },
        },
        (error, stdout, stderr) => {
          if (error) {
            const msg = stderr?.trim() || error.message
            reject(new Error(`openclaw CLI error: ${msg}`))
            return
          }
          resolve(stdout)
        },
      )
    })
  }

  private parseResponse(stdout: string): AgentResponse {
    const jsonStart = stdout.indexOf("\n{")
    const jsonStr = jsonStart >= 0 ? stdout.slice(jsonStart + 1) : stdout.trim()

    try {
      return JSON.parse(jsonStr) as AgentResponse
    } catch {
      const lastBrace = stdout.lastIndexOf("}")
      if (lastBrace < 0) {
        throw new Error(`No JSON found in openclaw output:\n${stdout.slice(0, 500)}`)
      }
      let depth = 0
      let start = lastBrace
      for (let i = lastBrace; i >= 0; i--) {
        if (stdout[i] === "}") depth++
        if (stdout[i] === "{") depth--
        if (depth === 0) {
          start = i
          break
        }
      }
      return JSON.parse(stdout.slice(start, lastBrace + 1)) as AgentResponse
    }
  }
}
