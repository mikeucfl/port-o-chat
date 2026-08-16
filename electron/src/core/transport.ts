import type { portochat } from '@proto/portochat'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected'

export interface ChatTransportEvents {
  message: [message: portochat.PortoChatMessage]
  stateChange: [state: ConnectionState, error?: Error]
}

/**
 * Transport-agnostic seam ChatSession is built on, so the same session
 * logic runs in the Electron main process (over WebSocket via the `ws`
 * package, main/net/wsClient.ts) and the browser build (over the native
 * WebSocket, web/wsClient.ts). main/net/tcpClient.ts also implements this,
 * kept only as the raw-TCP reference client for legacy-interop tooling and
 * the server's own integration tests — not used by either shipped client
 * anymore.
 */
export interface ChatTransport {
  connect(host: string, port: number): Promise<void>
  send(message: portochat.IPortoChatMessage): void
  disconnect(): void
  getState(): ConnectionState
  on<K extends keyof ChatTransportEvents>(
    event: K,
    listener: (...args: ChatTransportEvents[K]) => void
  ): void
}
