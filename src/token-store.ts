import { readFile, writeFile, mkdir } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { resolve, dirname } from "node:path"
import { homedir } from "node:os"

export interface TokenRecord {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
  active: boolean
}

export class TokenStore {
  private tokensPath: string

  constructor(tokensPath?: string) {
    this.tokensPath =
      tokensPath ??
      resolve(homedir(), ".openclaw-mcp-bridge", "tokens.json")
  }

  async create(name: string): Promise<TokenRecord> {
    const records = await this.load()
    const now = new Date().toISOString()
    const record: TokenRecord = {
      id: `oc_${randomUUID()}`,
      name,
      createdAt: now,
      lastUsedAt: null,
      active: true,
    }
    records.push(record)
    await this.save(records)
    return record
  }

  async list(): Promise<TokenRecord[]> {
    return this.load()
  }

  async revoke(idPrefix: string): Promise<TokenRecord | null> {
    const records = await this.load()
    const record = records.find(
      (t) => t.id.startsWith(idPrefix) && t.active
    )
    if (!record) return null
    record.active = false
    await this.save(records)
    return record
  }

  async validate(bearerValue: string): Promise<TokenRecord | null> {
    const records = await this.load()
    const record = records.find((t) => t.id === bearerValue && t.active)
    if (!record) return null

    // Fire-and-forget update of lastUsedAt
    const now = new Date().toISOString()
    record.lastUsedAt = now
    this.save(records).catch(() => {
      // Silently ignore save errors
    })

    return record
  }

  private async load(): Promise<TokenRecord[]> {
    try {
      const data = await readFile(this.tokensPath, "utf-8")
      return JSON.parse(data) as TokenRecord[]
    } catch {
      // File not found or parse error — return empty list
      return []
    }
  }

  private async save(records: TokenRecord[]): Promise<void> {
    await mkdir(dirname(this.tokensPath), { recursive: true })
    await writeFile(
      this.tokensPath,
      JSON.stringify(records, null, 2),
      "utf-8"
    )
  }
}
