import type net from 'node:net'
import type { ChatCore } from '../server/chatCore'
import { attachFramedPeer, type FramedTransport } from './framedPeer'

/**
 * Accepts a raw-TCP connection (the legacy Java-compatible wire format —
 * old Java clients, and this app's own server-side test tooling) and feeds
 * it into the shared ChatCore. Moved out of what used to be
 * TcpChatServer.handleSocket, now just the transport-specific wrapping
 * around the shared attachFramedPeer glue.
 */
export function handleTcpSocket(core: ChatCore, socket: net.Socket): void {
  socket.setNoDelay(true)

  const transport: FramedTransport = {
    remoteHost: socket.remoteAddress ?? 'unknown',
    get destroyed() {
      return socket.destroyed
    },
    write: (bytes) => socket.write(bytes),
    destroy: () => socket.destroy()
  }

  const handle = attachFramedPeer(core, transport)

  socket.on('data', (chunk: Buffer) => handle.onBytes(chunk))
  socket.on('close', () => handle.onClose())
  socket.on('error', () => {
    // 'close' always follows 'error' on a socket, so cleanup still happens
    // exactly once via the 'close' handler above.
  })
}
