import { readFile, writeFile, mkdir } from "node:fs/promises"
import { resolve, dirname } from "node:path"

const OPENCODE_CONFIG_PATH = resolve(
  process.env.HOME ?? process.env.USERPROFILE ?? "",
  ".config/opencode/opencode.json",
)

interface InstallOptions {
  name: string
  bin?: string
  host?: string
  token?: string
}

function parseArgs(argv: string[]): InstallOptions {
  const args = argv.slice(1)
  const name = args.find((a) => !a.startsWith("--"))

  if (!name) {
    console.error("Usage: openclaw-mcp-bridge install <name> [options]")
    console.error("")
    console.error("Arguments:")
    console.error("  <name>            Instance name (e.g. localclaw, kupuclaw)")
    console.error("")
    console.error("Options:")
    console.error("  --bin <path>      Path to openclaw binary (local mode, default: openclaw)")
    console.error("  --host <url>      Gateway URL (ws:// for direct, http:// for bridge serve mode)")
    console.error("  --token <token>   Auth token (Gateway token for ws://, bridge token for http://)")
    console.error("")
    console.error("Examples:")
    console.error("  npx openclaw-mcp-bridge install localclaw")
    console.error("  npx openclaw-mcp-bridge install kupuclaw --host ws://server:18789 --token abc123")
    console.error("  npx openclaw-mcp-bridge install kupuclaw --host http://server:3000 --token oc_xxx")
    process.exit(1)
  }

  const binIdx = args.indexOf("--bin")
  const bin = binIdx >= 0 ? args[binIdx + 1] : undefined

  const hostIdx = args.indexOf("--host")
  const host = hostIdx >= 0 ? args[hostIdx + 1] : undefined

  const tokenIdx = args.indexOf("--token")
  const token = tokenIdx >= 0 ? args[tokenIdx + 1] : undefined

  if (host && bin) {
    console.error("Error: --host (remote mode) and --bin (local mode) are mutually exclusive.")
    process.exit(1)
  }

  return { name, bin, host, token }
}

interface OpencodeConfig {
  [key: string]: unknown
  mcp?: Record<string, unknown>
  agent?: Record<string, unknown>
}

async function readOpencodeConfig(): Promise<OpencodeConfig> {
  try {
    const raw = await readFile(OPENCODE_CONFIG_PATH, "utf-8")
    return JSON.parse(raw) as OpencodeConfig
  } catch {
    return {}
  }
}

async function writeOpencodeConfig(config: OpencodeConfig): Promise<void> {
  await mkdir(dirname(OPENCODE_CONFIG_PATH), { recursive: true })
  await writeFile(OPENCODE_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n")
}

function getProjectRoot(): string {
  const raw = new URL(import.meta.url).pathname
  return resolve(dirname(decodeURIComponent(raw)), "..")
}

function isHttpHost(host: string): boolean {
  return host.startsWith("http://") || host.startsWith("https://")
}

function buildMcpEntry(options: InstallOptions, projectRoot: string) {
  // HTTP host → remote MCP config (for bridge serve mode)
  if (options.host && isHttpHost(options.host)) {
    const url = options.host.endsWith("/mcp") ? options.host : `${options.host}/mcp`
    const entry: Record<string, unknown> = {
      type: "remote",
      url,
      enabled: true,
      timeout: 120000,
      oauth: false,
    }
    if (options.token) {
      entry.headers = { Authorization: `Bearer ${options.token}` }
    }
    return entry
  }

  // WS host or local mode → local MCP config (spawn subprocess)
  const env: Record<string, string> = {
    OPENCLAW_INSTANCE_NAME: options.name,
  }

  if (options.host) {
    env.OPENCLAW_GATEWAY_HOST = options.host
  }
  if (options.token) {
    env.OPENCLAW_GATEWAY_TOKEN = options.token
  }
  if (options.bin) {
    env.OPENCLAW_BIN = options.bin
  }

  return {
    type: "local" as const,
    command: [
      "npx",
      "--prefix",
      projectRoot,
      "tsx",
      resolve(projectRoot, "src/index.ts"),
    ],
    environment: env,
    enabled: true,
    timeout: 120000,
  }
}

function buildAgentEntry(options: InstallOptions) {
  const modeLabel = options.host ? "远程" : "本地"
  return {
    prompt:
      `你是 ${options.name} OpenClaw 桥接代理（${modeLabel}模式）。` +
      `用户发给你的所有消息，你都通过 ask_agent MCP 工具转发给 OpenClaw agent，并将回复原样返回给用户。` +
      `默认 agentId 使用 'main'。如果用户指定了其他 agent（如 geo），则用对应的 agentId。` +
      `多轮对话时复用同一个 sessionId 保持上下文。`,
    mode: "subagent" as const,
    description: `与 ${options.name} OpenClaw agent 对话（${modeLabel}），讨论需求、查进度、协作工作`,
  }
}

export async function install(argv: string[]): Promise<void> {
  const options = parseArgs(argv)
  const projectRoot = getProjectRoot()
  const config = await readOpencodeConfig()

  config.mcp ??= {}
  config.agent ??= {}

  const mcpKey = `openclaw-${options.name}`
  const agentKey = options.name

  const mcpExists = mcpKey in config.mcp
  const agentExists = agentKey in config.agent

  config.mcp[mcpKey] = buildMcpEntry(options, projectRoot)
  config.agent[agentKey] = buildAgentEntry(options)

  await writeOpencodeConfig(config)

  const isHttp = options.host && isHttpHost(options.host)
  const mode = isHttp ? "serve" : options.host ? "remote" : "local"

  console.log("")
  console.log(`✓ OpenClaw MCP bridge "${options.name}" installed! (${mode} mode)`)
  console.log("")

  if (mcpExists) {
    console.log(`  MCP server "openclaw-${options.name}" — updated`)
  } else {
    console.log(`  MCP server "openclaw-${options.name}" — added`)
  }

  if (agentExists) {
    console.log(`  Agent "@${options.name}" — updated`)
  } else {
    console.log(`  Agent "@${options.name}" — added`)
  }

  console.log("")
  console.log(`Config: ${OPENCODE_CONFIG_PATH}`)
  console.log("")
  console.log("Usage in opencode:")
  console.log(`  @${options.name} 你好，最近做了什么？`)
  console.log("")

  if (options.host) {
    console.log(`Gateway: ${options.host}`)
    console.log(`Token: ${options.token ? "***" + options.token.slice(-4) : "(none)"}`)
  } else if (options.bin) {
    console.log(`OpenClaw binary: ${options.bin}`)
  }
}
