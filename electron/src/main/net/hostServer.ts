import http from 'node:http'
import net from 'node:net'
import { WebSocketServer } from 'ws'
import { MAX_FRAME_SIZE, WS_PATH } from '@shared/constants'
import { ChatCore } from '../server/chatCore'
import { serveStatic } from './httpStatic'
import { handleTcpSocket } from './tcpListener'
import { handleWsConnection } from './wsListener'

export class AddressInUseError extends Error {}

export interface ListenResult {
  port: number
}

export interface HostServerOptions {
  /** Directory the browser build's static assets are served from (out/web). */
  webRoot: string
  /** Optional join password, changeable later via core.setPassword(). Empty/undefined = no password. */
  password?: string
}

/** How long an accepted socket may go without sending its first byte before it's dropped — an undecided connection is registered with neither listener and would otherwise leak. */
const DECISION_TIMEOUT_MS = 10_000

/**
 * Caps a single WebSocket message at a bit more than the wire protocol's
 * own MAX_FRAME_SIZE ceiling (65535) — the `ws` library rejects an
 * oversized message before fully buffering it, rather than this app's own
 * FrameStreamParser only catching it after the fact.
 */
const WS_MAX_PAYLOAD_BYTES = MAX_FRAME_SIZE + 1024

/**
 * Unlike a raw TCP socket (which a browser page can never open at all),
 * WebSocket is not subject to CORS — any page a LAN user happens to have
 * open in another tab could otherwise open `ws://<lan-ip>:3456/ws` in the
 * background and silently join the chat. Accepts a request with no Origin
 * header at all (this app's own Node-based clients — main/net/wsClient.ts
 * over the `ws` package never sends one), or one whose Origin's host
 * exactly matches the request's own Host header (the same-origin case:
 * a browser tab that loaded the page from this exact server connecting
 * back to it). A background tab from an unrelated site sends its own,
 * unrelated Origin, which won't match and is rejected.
 *
 * Known, deliberate limitation: this also rejects a browser client
 * manually pointed (via the Join screen) at a *different* server than the
 * one that served its page — cross-server joining from the browser build
 * isn't supported, only from the page you actually loaded. Documented in
 * PORTING-NOTES.md. Does not defend against DNS rebinding specifically
 * (out of scope for a LAN-only app — see CRYPTO.md's threat model for the
 * project's general stance on being explicit about what isn't covered).
 */
function isOriginAllowed(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/**
 * The host-mode server: one bound port serving three kinds of client from
 * a single net.Server —
 *
 *  - raw TCP (old Java clients, and this app's own server-side test
 *    tooling), the legacy fixed-width framing over protobuf3;
 *  - plain HTTP (the browser build's static assets);
 *  - WebSocket upgrades on WS_PATH (browser clients, and this app's own
 *    client) carrying the identical framed bytes as the TCP path.
 *
 * Every connection is demuxed from its first byte in handleConnection: a
 * real Port-O-Chat frame's first byte is always 0x00 (the high byte of a
 * uint16 length for any real first message, which is tiny), so anything
 * else is routed to the HTTP/WS path. This keeps one port meaning "the
 * Port-O-Chat port" for every kind of client — no second port to open or
 * forward, and the existing DEFAULT_SERVER_PORT stays meaningful for all
 * of them.
 *
 * TCP and WS both feed the same ChatCore, so a client connected either way
 * lands in the same UserRegistry/ChannelRegistry and sees the other
 * normally — see chatCore.ts.
 */
export class HostServer {
  readonly core = new ChatCore()
  private readonly httpServer: http.Server
  private readonly wss: WebSocketServer
  private server: net.Server | null = null
  private listening = false

  constructor(private readonly options: HostServerOptions) {
    this.core.setPassword(options.password ?? null)
    this.httpServer = http.createServer((req, res) => serveStatic(this.options.webRoot, req, res))
    this.wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES })

    this.httpServer.on('upgrade', (req, socket, head) => {
      const pathname = new URL(req.url ?? '/', 'http://host-server.internal').pathname
      if (pathname !== WS_PATH || !isOriginAllowed(req)) {
        socket.destroy()
        return
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        handleWsConnection(this.core, ws, req.socket.remoteAddress ?? 'unknown')
      })
    })
  }

  listen(port: number, host = '0.0.0.0'): Promise<ListenResult> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this.handleConnection(socket))

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (!this.listening) {
          if (err.code === 'EADDRINUSE') {
            reject(new AddressInUseError(`Port ${port} is already in use`))
          } else {
            reject(err)
          }
          return
        }
        // Post-listen server-level errors: log and keep running rather than
        // letting an unhandled 'error' event crash the process.
        // eslint-disable-next-line no-console
        console.error('HostServer: server error', err)
      })

      server.listen(port, host, () => {
        this.server = server
        this.listening = true
        this.core.start()
        const address = server.address()
        resolve({ port: typeof address === 'object' && address ? address.port : port })
      })
    })
  }

  close(): void {
    this.core.stop()
    this.listening = false
    this.server?.close()
    this.server = null
  }

  get isListening(): boolean {
    return this.listening
  }

  private handleConnection(socket: net.Socket): void {
    let decided = false
    const timeout = setTimeout(() => {
      if (!decided) socket.destroy()
    }, DECISION_TIMEOUT_MS)

    socket.once('data', (chunk: Buffer) => {
      decided = true
      clearTimeout(timeout)
      socket.pause()
      socket.unshift(chunk)
      if (chunk.length > 0 && chunk[0] === 0x00) {
        handleTcpSocket(this.core, socket)
      } else {
        this.httpServer.emit('connection', socket)
      }
      socket.resume()
    })

    socket.once('error', () => {
      clearTimeout(timeout)
    })
  }
}
