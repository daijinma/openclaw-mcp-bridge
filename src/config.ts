export interface BridgeConfig {
  openclawBin: string
  timeoutMs: number
  agentsDir: string
  gatewayHost?: string
  gatewayToken?: string
}

export function loadConfig(): BridgeConfig {
  const openclawBin = process.env.OPENCLAW_BIN ?? "openclaw"
  const parsed = parseInt(process.env.OPENCLAW_TIMEOUT_MS ?? "300000", 10)
  const timeoutMs = Number.isNaN(parsed) ? 300_000 : parsed
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ""
  const agentsDir = process.env.OPENCLAW_AGENTS_DIR ?? `${home}/.openclaw/agents`
  const gatewayHost = process.env.OPENCLAW_GATEWAY_HOST || undefined
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || undefined

  return { openclawBin, timeoutMs, agentsDir, gatewayHost, gatewayToken }
}
