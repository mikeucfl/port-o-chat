import type { portochat } from '../proto-gen/portochat'

/**
 * Transport-agnostic connection abstraction. The real implementation
 * (net/tcpServer.ts) wraps a TCP socket + framing/codec; tests use a plain
 * in-memory fake. Keeps server/router.ts unit-testable without real sockets.
 */
export interface PeerConnection {
  send(message: portochat.IPortoChatMessage): void
  close(): void
  readonly remoteHost: string
}
