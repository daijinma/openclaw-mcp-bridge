import WebSocket from "ws"
import { randomUUID, generateKeyPairSync, createHash, sign, type KeyObject } from "node:crypto"
import { type BridgeConfig } from "./config.js"
import { type IGatewayClient, type AgentInfo, type AgentResponse } from "./gateway-client.js"

const PROTOCOL_VERSION = 3

// ── Ed25519 device identity helpers ────────────────────────────

/** base64url-encode without padding (matches Gateway convention) */
function b64url(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "")
}

/** SPKI DER prefix for Ed25519 (12 bytes) — raw key follows immediately after */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

interface DeviceIdentity {
  deviceId: string
  publicKeyB64Url: string
  privateKey: KeyObject
}

function generateDeviceIdentity(): DeviceIdentity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  // Export SPKI DER, strip prefix to get raw 32-byte public key
  const spki = publicKey.export({ type: "spki", format: "der" })
  const raw = spki.subarray(ED25519_SPKI_PREFIX.length)
  const publicKeyB64Url = b64url(raw)
  const deviceId = createHash("sha256").update(raw).digest("hex")
  return { deviceId, publicKeyB64Url, privateKey }
}

/** Normalize a metadata value for the v3 signing payload (lowercase ASCII, trimmed) */
function normalizeMetadataForAuth(value?: string): string {
  if (!value) return ""
  const trimmed = value.trim()
  if (!trimmed) return ""
  return trimmed.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32))
}

function buildV3Payload(params: {
  deviceId: string
  clientId: string
  clientMode: string
  role: string
  scopes: string[]
  signedAtMs: number
  token: string
  nonce: string
  platform: string
  deviceFamily: string
}): string {
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token,
    params.nonce,
    normalizeMetadataForAuth(params.platform),
    normalizeMetadataForAuth(params.deviceFamily),
  ].join("|")
}

function signPayload(privateKey: DeviceIdentity["privateKey"], payload: string): string {
  const sig = sign(null, Buffer.from(payload, "utf8"), privateKey)
  return b64url(sig)
}

interface RequestFrame {
  type: "req"
  id: string
  method: string
  params?: unknown
}

interface ResponseFrame {
  type: "res"
  id: string
  ok: boolean
  payload?: Record<string, unknown>
  error?: { code: string; message: string; details?: unknown }
}

interface EventFrame {
  type: "event"
  event: string
  payload?: Record<string, unknown>
}

type WireFrame = RequestFrame | ResponseFrame | EventFrame

interface PendingRequest {
  resolve: (payload: Record<string, unknown>) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface ChatEventListener {
  runId: string
  resolve: (response: AgentResponse) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
  lastText: string
  sessionKey: string
}

export class WsGatewayClient implements IGatewayClient {
  private ws: WebSocket | null = null
  private pending = new Map<string, PendingRequest>()
  private chatListeners = new Map<string, ChatEventListener>()
  private connected = false
  private connectPromise: Promise<void> | null = null
  private deviceIdentity: DeviceIdentity

  constructor(private config: BridgeConfig) {
    this.deviceIdentity = generateDeviceIdentity()
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) return
    if (this.connectPromise) return this.connectPromise
    this.connectPromise = this.doConnect()
    try {
      await this.connectPromise
    } finally {
      this.connectPromise = null
    }
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = this.config.gatewayHost!

      if (this.ws) {
        try { this.ws.terminate() } catch {}
        this.ws = null
      }

      this.ws = new WebSocket(url, { maxPayload: 25 * 1024 * 1024 })

      const handshakeTimer = setTimeout(() => {
        if (!this.connected) {
          try { this.ws?.terminate() } catch {}
          reject(new Error("Handshake timeout: no challenge received within 15s"))
        }
      }, 15_000)

      let challengeHandled = false

      this.ws.on("message", (raw) => {
        let msg: WireFrame
        try {
          msg = JSON.parse(raw.toString()) as WireFrame
        } catch {
          return
        }

        if (msg.type === "event") {
          if (msg.event === "connect.challenge" && !challengeHandled) {
            challengeHandled = true
            const nonce = (msg.payload as Record<string, unknown>)?.nonce as string ?? ""
            this.handleChallenge(nonce)
              .then(() => {
                clearTimeout(handshakeTimer)
                this.connected = true
                resolve()
              })
              .catch((err) => {
                clearTimeout(handshakeTimer)
                reject(err)
              })
            return
          }
          this.handleEvent(msg)
          return
        }

        if (msg.type === "res") {
          this.handleResponse(msg)
        }
      })

      this.ws.on("error", (err) => {
        clearTimeout(handshakeTimer)
        if (!this.connected) {
          reject(err)
        } else {
          this.connected = false
          this.rejectAllPending(`WebSocket error: ${err.message}`)
        }
      })

      this.ws.on("close", () => {
        this.connected = false
        this.rejectAllPending("WebSocket closed")
      })
    })
  }

  private async handleChallenge(nonce: string): Promise<void> {
    const clientId = "gateway-client"
    const clientMode = "cli"
    const role = "operator"
    const scopes = [
      "operator.admin",
      "operator.read",
      "operator.write",
      "operator.approvals",
      "operator.pairing",
    ]
    const token = this.config.gatewayToken ?? ""
    const signedAtMs = Date.now()
    const platform = process.platform
    const deviceFamily = "server"

    const canonicalPayload = buildV3Payload({
      deviceId: this.deviceIdentity.deviceId,
      clientId,
      clientMode,
      role,
      scopes,
      signedAtMs,
      token,
      nonce,
      platform,
      deviceFamily,
    })
    const signature = signPayload(this.deviceIdentity.privateKey, canonicalPayload)

    const payload = await this.request("connect", {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: clientId,
        version: "0.3.0",
        platform,
        mode: clientMode,
        deviceFamily,
      },
      caps: [],
      role,
      scopes,
      auth: { token },
      device: {
        id: this.deviceIdentity.deviceId,
        publicKey: this.deviceIdentity.publicKeyB64Url,
        signature,
        signedAt: signedAtMs,
        nonce,
      },
    })

    if ((payload as Record<string, unknown>).type !== "hello-ok") {
      throw new Error(`Unexpected connect response: ${JSON.stringify(payload)}`)
    }
  }

  private request(method: string, params?: unknown): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not open"))
        return
      }

      const id = randomUUID()
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC timeout: ${method}`))
      }, 30_000)

      this.pending.set(id, { resolve, reject, timer })

      const frame: RequestFrame = { type: "req", id, method, params }
      this.ws.send(JSON.stringify(frame))
    })
  }

  private handleResponse(msg: ResponseFrame): void {
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    clearTimeout(p.timer)

    if (msg.ok) {
      p.resolve(msg.payload ?? {})
    } else {
      p.reject(new Error(msg.error?.message ?? `RPC error: ${msg.error?.code}`))
    }
  }

  private handleEvent(msg: EventFrame): void {
    if (msg.event !== "chat" || !msg.payload) return

    const payload = msg.payload as Record<string, unknown>
    const runId = payload.runId as string | undefined
    if (!runId) return

    const listener = this.chatListeners.get(runId)
    if (!listener) return

    const state = payload.state as string

    if (state === "delta") {
      const message = payload.message as Record<string, unknown> | undefined
      const content = message?.content as Array<Record<string, unknown>> | undefined
      if (content?.[0]?.text) {
        listener.lastText = content[0].text as string
      }
      return
    }

    if (state === "final") {
      this.chatListeners.delete(runId)
      clearTimeout(listener.timer)

      const message = payload.message as Record<string, unknown> | undefined
      const content = message?.content as Array<Record<string, unknown>> | undefined
      const finalText = (content?.[0]?.text as string) || listener.lastText

      listener.resolve({
        runId,
        status: "completed",
        summary: finalText,
        sessionId: (payload.sessionKey as string) || listener.sessionKey,
        result: {
          payloads: [{ text: finalText, mediaUrl: null }],
          meta: {
            durationMs: 0,
            agentMeta: {
              sessionId: (payload.sessionKey as string) || listener.sessionKey,
              provider: "",
              model: (payload.model as string) ?? "unknown",
              usage: {},
            },
            aborted: false,
            stopReason: (payload.stopReason as string) ?? "stop",
          },
        },
      })
      return
    }

    if (state === "error") {
      this.chatListeners.delete(runId)
      clearTimeout(listener.timer)
      listener.reject(new Error((payload.errorMessage as string) ?? "Agent run failed"))
    }
  }

  async listAgents(): Promise<AgentInfo[]> {
    await this.ensureConnected()

    try {
      const payload = await this.request("sessions.list", {
        limit: 50,
        includeGlobal: true,
      })

      const sessions = payload.sessions as Array<Record<string, unknown>> | undefined
      if (!sessions) return []

      const agentIds = new Set<string>()
      for (const session of sessions) {
        const key = session.key as string | undefined
        if (key?.startsWith("agent:")) {
          const parts = key.split(":")
          if (parts[1]) agentIds.add(parts[1])
        }
        const agentId = session.agentId as string | undefined
        if (agentId) agentIds.add(agentId)
      }

      return Array.from(agentIds).map((id) => ({ id }))
    } catch {
      return [{ id: "main" }]
    }
  }

  async sendMessage(
    message: string,
    agentId?: string,
    sessionId?: string,
  ): Promise<AgentResponse> {
    await this.ensureConnected()

    const idempotencyKey = randomUUID()
    const sessionKey = sessionId || `agent:${agentId ?? "main"}:main`

    const responsePromise = new Promise<AgentResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.chatListeners.delete(idempotencyKey)
        reject(new Error("TIMEOUT: Agent did not respond within timeout"))
      }, this.config.timeoutMs)

      this.chatListeners.set(idempotencyKey, {
        runId: idempotencyKey,
        resolve,
        reject,
        timer,
        lastText: "",
        sessionKey,
      })
    })

    try {
      await this.request("chat.send", {
        sessionKey,
        message,
        idempotencyKey,
        timeoutMs: this.config.timeoutMs,
      })
    } catch (err) {
      const listener = this.chatListeners.get(idempotencyKey)
      if (listener) {
        clearTimeout(listener.timer)
        this.chatListeners.delete(idempotencyKey)
      }
      throw err
    }

    return responsePromise
  }

  async disconnect(): Promise<void> {
    this.rejectAllPending("Disconnecting")
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.connected = false
  }

  private rejectAllPending(reason: string): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error(reason))
    }
    this.pending.clear()

    for (const [, l] of this.chatListeners) {
      clearTimeout(l.timer)
      l.reject(new Error(reason))
    }
    this.chatListeners.clear()
  }
}
