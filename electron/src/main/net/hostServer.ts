import http from 'node:http'
import net from 'node:net'
import { WebSocketServer } from 'ws'
import { WS_PATH } from '@shared/constants'
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
}

/** How long an accepted socket may go without sending its first byte before it's dropped — an undecided connection is registered with neither listener and would otherwise leak. */
const DECISION_TIMEOUT_MS = 10_000

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
    this.httpServer = http.createServer((req, res) => serveStatic(this.options.webRoot, req, res))
    this.wss = new WebSocketServer({ noServer: true })

    this.httpServer.on('upgrade', (req, socket, head) => {
      const pathname = new URL(req.url ?? '/', 'http://host-server.internal').pathname
      if (pathname !== WS_PATH) {
        socket.destroy()
        return
      }
      // Origin allowlist / DNS-rebinding protection is a hardening-pass
      // follow-up, not yet enforced here.
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
