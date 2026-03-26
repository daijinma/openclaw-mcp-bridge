import { TokenStore } from "./token-store.js"

export async function tokenCommand(argv: string[]): Promise<void> {
  const subcommand = argv[0]

  if (subcommand === "create") {
    const name = argv[1]
    if (!name) {
      console.error("Error: token create requires a name argument")
      console.error("Usage: openclaw-mcp-bridge token create <name>")
      process.exit(1)
    }

    const store = new TokenStore()
    const token = await store.create(name)

    console.log(`\n✓ Token created:`)
    console.log(`  ID:      ${token.id}`)
    console.log(`  Name:    ${token.name}`)
    console.log(`  Created: ${token.createdAt}\n`)
    console.log(`To use this token with OpenClaw MCP bridge:`)
    console.log(
      `  npx openclaw-mcp-bridge install ${token.name} --host http://<server>:3000 --token ${token.id}\n`
    )
  } else if (subcommand === "list") {
    const store = new TokenStore()
    const tokens = await store.list()

    if (tokens.length === 0) {
      console.log("No tokens found.")
      return
    }

    console.log("\nTokens:")
    console.log(
      "-".repeat(70)
    )

    for (const token of tokens) {
      const shortId = token.id.substring(0, 12) + "..."
      const status = token.active ? "active" : "revoked"
      const lastUsed = token.lastUsedAt || "never"

      console.log(
        `${shortId.padEnd(17)} ${token.name.padEnd(20)} ${status.padEnd(10)} ${lastUsed}`
      )
    }
    console.log(
      "-".repeat(70)
    )
  } else if (subcommand === "revoke") {
    const idPrefix = argv[1]
    if (!idPrefix) {
      console.error(
        "Error: token revoke requires a token ID or prefix argument"
      )
      console.error("Usage: openclaw-mcp-bridge token revoke <id-prefix>")
      process.exit(1)
    }

    const store = new TokenStore()
    const token = await store.revoke(idPrefix)

    if (!token) {
      console.error(`Error: no active token found matching "${idPrefix}"`)
      process.exit(1)
    }

    console.log(`\n✓ Token revoked:`)
    console.log(`  ID:   ${token.id}`)
    console.log(`  Name: ${token.name}\n`)
  } else {
    console.error("Usage: openclaw-mcp-bridge token <command> [args]")
    console.error("\nCommands:")
    console.error("  create <name>      Create a new token")
    console.error("  list               List all tokens")
    console.error("  revoke <id>        Revoke a token by ID or prefix")
    process.exit(1)
  }
}
