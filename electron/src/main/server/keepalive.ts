import type { UserRegistry } from './userRegistry'

const PING_INTERVAL_MS = 60_000
const INITIAL_DELAY_MS = 5_000
const CLIENT_TIMEOUT_MS = 3 * 60_000

/**
 * Pings every connected user on an interval and actually disconnects anyone
 * who hasn't been heard from within CLIENT_TIMEOUT_MS.
 *
 * Fixes Java bug #2: the original Server.removeStaleClients() computed
 * staleness correctly but had its socket.close()/removeUser() calls
 * commented out, so timed-out clients were logged and never actually
 * dropped. Here, closing the peer is the *only* thing this class does on
 * timeout — the peer's own 'close' handling (wired in tcpServer.ts) is what
 * triggers router.handleDisconnect, so cleanup/broadcast logic lives in
 * exactly one place.
 */
export class KeepaliveTimer {
  private intervalHandle: ReturnType<typeof setInterval> | null = null
  private initialTimeoutHandle: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly users: UserRegistry) {}

  start(): void {
    this.initialTimeoutHandle = setTimeout(() => {
      this.tick()
      this.intervalHandle = setInterval(() => this.tick(), PING_INTERVAL_MS)
    }, INITIAL_DELAY_MS)
  }

  stop(): void {
    if (this.initialTimeoutHandle) clearTimeout(this.initialTimeoutHandle)
    if (this.intervalHandle) clearInterval(this.intervalHandle)
    this.initialTimeoutHandle = null
    this.intervalHandle = null
  }

  private tick(): void {
    const now = Date.now()
    for (const user of this.users.listAllConnections()) {
      if (now - user.lastSeen > CLIENT_TIMEOUT_MS) {
        user.peer.close()
        continue
      }
      user.peer.send({ ping: { timestamp: now } })
    }
  }
}
