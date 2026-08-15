import { randomUUID } from 'node:crypto'
import type { PeerConnection } from './peer'

export interface UserRecord {
  readonly id: string
  name: string | null
  readonly host: string
  lastSeen: number
  e2eIdentityKey: Buffer | null
  readonly peer: PeerConnection
}

/**
 * In-memory registry of connected users. Mirrors the Java UserDatabase:
 * a connection exists (and is reachable/lookup-able) from the moment it's
 * accepted, before any username is set. No persistence — the whole map is
 * gone the moment the process exits.
 */
export class UserRegistry {
  private byPeer = new Map<PeerConnection, UserRecord>()
  private byId = new Map<string, UserRecord>()

  addConnection(peer: PeerConnection, host: string): UserRecord {
    const user: UserRecord = {
      id: randomUUID(),
      name: null,
      host,
      lastSeen: Date.now(),
      e2eIdentityKey: null,
      peer
    }
    this.byPeer.set(peer, user)
    this.byId.set(user.id, user)
    return user
  }

  removeConnection(peer: PeerConnection): UserRecord | undefined {
    const user = this.byPeer.get(peer)
    if (!user) return undefined
    this.byPeer.delete(peer)
    this.byId.delete(user.id)
    return user
  }

  getByPeer(peer: PeerConnection): UserRecord | undefined {
    return this.byPeer.get(peer)
  }

  getById(id: string): UserRecord | undefined {
    return this.byId.get(id)
  }

  /** Exact-string match, same as the Java UserDatabase.userNameInUse. */
  isNameInUse(name: string): boolean {
    for (const user of this.byId.values()) {
      if (user.name === name) return true
    }
    return false
  }

  /** Returns false (and leaves the name unset) if the name is already taken. */
  setName(user: UserRecord, name: string): boolean {
    if (this.isNameInUse(name)) return false
    user.name = name
    return true
  }

  touchLastSeen(user: UserRecord): void {
    user.lastSeen = Date.now()
  }

  /** Only users who have completed SetUserName — matches Java's userMap semantics. */
  listNamed(): UserRecord[] {
    return [...this.byId.values()].filter((u) => u.name !== null)
  }

  listAllConnections(): UserRecord[] {
    return [...this.byId.values()]
  }
}
