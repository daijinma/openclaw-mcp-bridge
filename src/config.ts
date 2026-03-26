export interface BridgeConfig {
  openclawBin: string
  timeoutMs: number
  agentsDir: string
}

export function loadConfig(): BridgeConfig {
  const openclawBin = process.env.OPENCLAW_BIN ?? "openclaw"
  const timeoutMs = parseInt(process.env.OPENCLAW_TIMEOUT_MS ?? "300000", 10)
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ""
  const agentsDir = process.env.OPENCLAW_AGENTS_DIR ?? `${home}/.openclaw/agents`

  return { openclawBin, timeoutMs, agentsDir }
}
