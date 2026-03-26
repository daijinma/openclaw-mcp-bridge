import { readFile, writeFile, mkdir } from "node:fs/promises"
import { resolve, dirname } from "node:path"

const OPENCODE_CONFIG_PATH = resolve(
  process.env.HOME ?? process.env.USERPROFILE ?? "",
  ".config/opencode/opencode.json",
)

interface InstallOptions {
  name: string
  bin?: string
}

function parseArgs(argv: string[]): InstallOptions {
  const args = argv.slice(1)
  const name = args.find((a) => !a.startsWith("--"))

  if (!name) {
    console.error("Usage: openclaw-mcp-bridge install <name> [--bin <path>]")
    console.error("")
    console.error("Arguments:")
    console.error("  <name>         Instance name (e.g. localclaw, kupuclaw)")
    console.error("")
    console.error("Options:")
    console.error("  --bin <path>   Path to openclaw binary (default: openclaw)")
    console.error("")
    console.error("Examples:")
    console.error("  npx openclaw-mcp-bridge install localclaw")
    console.error("  npx openclaw-mcp-bridge install kupuclaw --bin /usr/local/bin/openclaw")
    process.exit(1)
  }

  const binIdx = args.indexOf("--bin")
  const bin = binIdx >= 0 ? args[binIdx + 1] : undefined

  return { name, bin }
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

function buildMcpEntry(options: InstallOptions, projectRoot: string) {
  const env: Record<string, string> = {
    OPENCLAW_INSTANCE_NAME: options.name,
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
  return {
    prompt:
      `你是 ${options.name} OpenClaw 桥接代理。` +
      `用户发给你的所有消息，你都通过 ask_agent MCP 工具转发给 OpenClaw agent，并将回复原样返回给用户。` +
      `默认 agentId 使用 'main'。如果用户指定了其他 agent（如 geo），则用对应的 agentId。` +
      `多轮对话时复用同一个 sessionId 保持上下文。`,
    mode: "subagent" as const,
    description: `与 ${options.name} OpenClaw agent 对话，讨论需求、查进度、协作工作`,
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

  console.log("")
  console.log(`✓ OpenClaw MCP bridge "${options.name}" installed!`)
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

  if (options.bin) {
    console.log(`OpenClaw binary: ${options.bin}`)
  }
}
