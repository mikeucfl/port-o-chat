import { decodeFrame, encodeFrame } from '@core/codec'
import { FrameStreamParser } from '@core/framing'
import type { ChatCore } from '../server/chatCore'
import type { PeerConnection } from '../server/peer'

export interface FramedTransport {
  remoteHost: string
  readonly destroyed: boolean
  write(bytes: Buffer): void
  destroy(): void
}

export interface FramedPeerHandle {
  onBytes(chunk: Buffer): void
  onClose(): void
}

/**
 * Shared byte-stream <-> router glue: parser.push -> decodeFrame ->
 * router.handleMessage, and disconnect handling that fires exactly once.
 * Used identically by the raw-TCP listener (net/tcpListener.ts) and the
 * WebSocket listener (net/wsListener.ts) so neither duplicates it — this
 * is exactly what used to be inline in TcpChatServer.handleSocket.
 */
export function attachFramedPeer(core: ChatCore, transport: FramedTransport): FramedPeerHandle {
  const parser = new FrameStreamParser()
  let closed = false

  const peer: PeerConnection = {
    remoteHost: transport.remoteHost,
    send: (message) => {
      if (closed || transport.destroyed) return
      try {
        transport.write(encodeFrame(message))
      } catch (err) {
        // Encoding our own outgoing message should never fail. If it
        // somehow does, drop this peer rather than crash the server.
        // eslint-disable-next-line no-console
        console.error('attachFramedPeer: failed to encode outgoing message', err)
        transport.destroy()
      }
    },
    close: () => transport.destroy()
  }

  core.router.handleConnect(peer, peer.remoteHost)

  return {
    onBytes(chunk: Buffer): void {
      let frames: Buffer[]
      try {
        frames = parser.push(chunk)
      } catch {
        // FramingError: unrecoverable stream corruption. Never attempt to
        // resync a corrupt length-prefixed stream — just close it.
        transport.destroy()
        return
      }

      for (const frame of frames) {
        try {
          const message = decodeFrame(frame)
          core.router.handleMessage(peer, message)
        } catch {
          // CodecError: malformed/hostile payload. Close this connection.
          transport.destroy()
          return
        }
      }
    },
    onClose(): void {
      if (closed) return
      closed = true
      core.router.handleDisconnect(peer)
    }
  }
}
