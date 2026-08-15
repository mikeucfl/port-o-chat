import net from 'node:net'
import { ChannelRegistry } from '../server/channelRegistry'
import { KeepaliveTimer } from '../server/keepalive'
import type { PeerConnection } from '../server/peer'
import { ChatRouter } from '../server/router'
import { UserRegistry } from '../server/userRegistry'
import { decodeFrame, encodeFrame } from './codec'
import { FrameStreamParser } from './framing'

export class AddressInUseError extends Error {}

export interface ListenResult {
  port: number
}

/**
 * The host-mode TCP server. Owns the user/channel registries and the
 * router; every accepted socket is wrapped in a PeerConnection adapter that
 * handles framing/codec, so server/router.ts never touches `net` directly
 * (and stays unit-testable without real sockets).
 */
export class TcpChatServer {
  readonly users = new UserRegistry()
  readonly channels = new ChannelRegistry()
  readonly router = new ChatRouter(this.users, this.channels)
  private readonly keepalive = new KeepaliveTimer(this.users)
  private server: net.Server | null = null
  private listening = false

  listen(port: number, host = '0.0.0.0'): Promise<ListenResult> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this.handleSocket(socket))

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
        console.error('TcpChatServer: server error', err)
      })

      server.listen(port, host, () => {
        this.server = server
        this.listening = true
        this.keepalive.start()
        const address = server.address()
        resolve({ port: typeof address === 'object' && address ? address.port : port })
      })
    })
  }

  close(): void {
    this.keepalive.stop()
    this.listening = false
    this.server?.close()
    this.server = null
  }

  get isListening(): boolean {
    return this.listening
  }

  private handleSocket(socket: net.Socket): void {
    socket.setNoDelay(true)
    const parser = new FrameStreamParser()
    let closed = false

    const peer: PeerConnection = {
      remoteHost: socket.remoteAddress ?? 'unknown',
      send: (message) => {
        if (closed || socket.destroyed) return
        try {
          socket.write(encodeFrame(message))
        } catch (err) {
          // Encoding our own outgoing message should never fail. If it
          // somehow does, drop this peer rather than crash the server.
          // eslint-disable-next-line no-console
          console.error('TcpChatServer: failed to encode outgoing message', err)
          socket.destroy()
        }
      },
      close: () => socket.destroy()
    }

    const finish = (): void => {
      if (closed) return
      closed = true
      this.router.handleDisconnect(peer)
    }

    this.router.handleConnect(peer, peer.remoteHost)

    socket.on('data', (chunk: Buffer) => {
      let frames: Buffer[]
      try {
        frames = parser.push(chunk)
      } catch {
        // FramingError: unrecoverable stream corruption. Never attempt to
        // resync a corrupt length-prefixed stream — just close it.
        socket.destroy()
        return
      }

      for (const frame of frames) {
        try {
          const message = decodeFrame(frame)
          this.router.handleMessage(peer, message)
        } catch {
          // CodecError: malformed/hostile payload. Close this connection.
          socket.destroy()
          return
        }
      }
    })

    socket.on('close', finish)
    socket.on('error', () => {
      // 'close' always follows 'error' on a socket, so cleanup still
      // happens exactly once via the 'close' handler above.
    })
  }
}
