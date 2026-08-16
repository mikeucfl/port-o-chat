import type { portochat } from '@proto/portochat'
import type { PeerConnection } from './peer'

/** In-memory fake PeerConnection for unit tests — no real socket involved. */
export class FakePeer implements PeerConnection {
  readonly sent: portochat.IPortoChatMessage[] = []
  closed = false

  constructor(readonly remoteHost: string = '127.0.0.1') {}

  send(message: portochat.IPortoChatMessage): void {
    this.sent.push(message)
  }

  close(): void {
    this.closed = true
  }

  last(): portochat.IPortoChatMessage | undefined {
    return this.sent[this.sent.length - 1]
  }
}
