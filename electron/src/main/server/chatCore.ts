import { ChannelRegistry } from './channelRegistry'
import { KeepaliveTimer } from './keepalive'
import { ChatRouter } from './router'
import { UserRegistry } from './userRegistry'

/**
 * Owns the shared chat "world": users, channels, the router, and the
 * keepalive timer. Lifted out of what used to be TcpChatServer's own
 * constructor so that multiple listeners (raw TCP, WebSocket) can feed the
 * same registries — a client connected via either transport shows up in
 * the same UserRegistry and sees the other normally, with zero changes to
 * router.ts/userRegistry.ts/channelRegistry.ts, since PeerConnection was
 * already transport-agnostic.
 */
export class ChatCore {
  readonly users = new UserRegistry()
  readonly channels = new ChannelRegistry()
  readonly router = new ChatRouter(this.users, this.channels)
  private readonly keepalive = new KeepaliveTimer(this.users)

  start(): void {
    this.keepalive.start()
  }

  stop(): void {
    this.keepalive.stop()
  }
}
