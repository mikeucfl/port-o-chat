export interface ChannelRecord {
  readonly name: string
  readonly e2e: boolean
  readonly creatorId: string
  keyEpoch: number
  topic: string
  /** User ids currently in the channel. */
  readonly members: Set<string>
}

export interface EnsureChannelResult {
  record: ChannelRecord
  created: boolean
}

export type DepartureResult = 'channel-removed' | 'user-left' | 'not-a-member'

/**
 * In-memory registry of channels. Mirrors the Java ChannelDatabase: created
 * implicitly by the first join, torn down when the last member leaves,
 * channel names are opaque strings (the "#" prefix is a client-only
 * convention, same as the original app). Adds an `e2e`/`keyEpoch` pair the
 * Java version never had — the server tracks *that* a channel is end-to-end
 * encrypted for routing/refusal purposes, but never the key material itself.
 * Also tracks `creatorId` (the only user ever authorized to set `topic`) and
 * `topic` itself, neither of which existed in the Java version.
 */
export class ChannelRegistry {
  private channels = new Map<string, ChannelRecord>()

  channelExists(name: string): boolean {
    return this.channels.has(name)
  }

  get(name: string): ChannelRecord | undefined {
    return this.channels.get(name)
  }

  /**
   * Creates the channel if it doesn't exist yet (using `requestedE2E` for its
   * immutable E2E flag, and `creatorId` for its immutable creator). If it
   * already exists, `requestedE2E`/`creatorId` are ignored — a channel's
   * creator, like its E2E flag, can never change after creation. If the
   * channel is later torn down (last member leaves) and recreated under the
   * same name, it gets a fresh creator/flag/topic, same as today's e2e flag.
   */
  ensureChannel(name: string, requestedE2E: boolean, creatorId: string): EnsureChannelResult {
    const existing = this.channels.get(name)
    if (existing) return { record: existing, created: false }

    const record: ChannelRecord = {
      name,
      e2e: requestedE2E,
      creatorId,
      keyEpoch: 0,
      topic: '',
      members: new Set()
    }
    this.channels.set(name, record)
    return { record, created: true }
  }

  isUserInChannel(name: string, userId: string): boolean {
    return this.channels.get(name)?.members.has(userId) ?? false
  }

  addUserToChannel(name: string, userId: string): void {
    this.channels.get(name)?.members.add(userId)
  }

  removeUserFromChannel(name: string, userId: string): DepartureResult {
    const record = this.channels.get(name)
    if (!record || !record.members.has(userId)) return 'not-a-member'

    record.members.delete(userId)
    if (record.members.size === 0) {
      this.channels.delete(name)
      return 'channel-removed'
    }
    return 'user-left'
  }

  /**
   * Removes the user from every channel they're in. Returns the channels
   * split by outcome, since callers (disconnect/part handling) need to
   * broadcast differently for a torn-down channel vs. one that still has
   * members needing an E2E key rotation.
   */
  removeUserFromAllChannels(userId: string): { removed: string[]; remaining: string[] } {
    const removed: string[] = []
    const remaining: string[] = []
    for (const name of this.userChannels(userId)) {
      const result = this.removeUserFromChannel(name, userId)
      if (result === 'channel-removed') removed.push(name)
      else if (result === 'user-left') remaining.push(name)
    }
    return { removed, remaining }
  }

  userChannels(userId: string): string[] {
    const result: string[] = []
    for (const record of this.channels.values()) {
      if (record.members.has(userId)) result.push(record.name)
    }
    return result
  }

  getUsersInChannel(name: string): string[] | undefined {
    const record = this.channels.get(name)
    return record ? [...record.members] : undefined
  }

  listChannels(): ChannelRecord[] {
    return [...this.channels.values()]
  }

  bumpKeyEpoch(name: string): number | undefined {
    const record = this.channels.get(name)
    if (!record) return undefined
    record.keyEpoch += 1
    return record.keyEpoch
  }

  /** Returns false if the channel doesn't exist. Caller (router.ts) is responsible for the creator-only authorization check. */
  setTopic(name: string, topic: string): boolean {
    const record = this.channels.get(name)
    if (!record) return false
    record.topic = topic
    return true
  }
}
