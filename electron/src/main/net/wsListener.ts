import type { RawData, WebSocket } from 'ws'
import type { ChatCore } from '../server/chatCore'
import { attachFramedPeer, type FramedTransport } from './framedPeer'

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(data)
}

/**
 * Accepts a WebSocket connection (browser clients, and this app's own
 * client once it switches transports) and feeds it into the same shared
 * ChatCore as the raw-TCP listener — a WS peer and a TCP peer land in the
 * same UserRegistry/ChannelRegistry with zero special-casing. The outer
 * uint16 length prefix is kept inside each binary WS message even though
 * WS is already message-framed, so framing.ts/codec.ts stay byte-for-byte
 * identical on both transports (see PROTOCOL.md).
 */
export function handleWsConnection(core: ChatCore, ws: WebSocket, remoteHost: string): void {
  const transport: FramedTransport = {
    remoteHost,
    get destroyed() {
      return ws.readyState === ws.CLOSING || ws.readyState === ws.CLOSED
    },
    write: (bytes) => ws.send(bytes),
    destroy: () => ws.terminate()
  }

  const handle = attachFramedPeer(core, transport)

  ws.on('message', (data: RawData) => handle.onBytes(toBuffer(data)))
  ws.on('close', () => handle.onClose())
  ws.on('error', () => {
    // 'close' always follows 'error' for a ws connection too.
  })
}
