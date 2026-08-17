import type { CryptoProvider } from './cryptoProvider'

export interface ChannelKeyState {
  key: Buffer
  epoch: number
}

export interface ChannelKeyManagerDeps {
  myUserId: string
  crypto: CryptoProvider
  sendKeyShare: (channel: string, toUserId: string, wrappedKey: Buffer, nonce: Buffer, epoch: number) => void
  getPeerPublicKey: (userId: string) => Buffer | undefined
  /** Current members of the channel, excluding the local user. */
  getOtherMembers: (channel: string) => string[]
  onKeyReady?: (channel: string, epoch: number) => void
}

/**
 * Client-side orchestration for per-channel E2E keys. Pure logic, no
 * transport — the server never appears in this file at all, matching the
 * invariant that it must never possess a channel key. Runs identically on
 * both platforms via the injected CryptoProvider.
 *
 * Join flow: every existing member independently wraps the current key for
 * a joiner (wrapForNewMember); the joiner keeps the first KeyShare that
 * actually decrypts (receiveKeyShare) and ignores the rest as harmless
 * duplicates. No leader election needed, and it tolerates any member being
 * offline.
 *
 * Rotation flow (triggered by the server's KeyRotationNotice, which carries
 * no key material, only the new epoch number): among the members remaining
 * after a departure, the one with the lexicographically lowest user id
 * generates the new key and re-wraps it individually for everyone else;
 * everyone else just waits for their KeyShare. This is a deterministic,
 * coordination-free rule every client can compute independently from the
 * same roster — see CRYPTO.md.
 */
export class ChannelKeyManager {
  private channels = new Map<string, ChannelKeyState>()

  constructor(private readonly deps: ChannelKeyManagerDeps) {}

  getState(channel: string): ChannelKeyState | undefined {
    return this.channels.get(channel)
  }

  /** Called when the local user creates a brand-new E2E channel. */
  createChannel(channel: string): ChannelKeyState {
    const state: ChannelKeyState = { key: this.deps.crypto.generateChannelKey(), epoch: 0 }
    this.channels.set(channel, state)
    this.deps.onKeyReady?.(channel, state.epoch)
    return state
  }

  /** Called (by every existing member) when someone else joins a channel we already hold a key for. */
  wrapForNewMember(channel: string, joinerUserId: string): void {
    const current = this.channels.get(channel)
    const peerKey = this.deps.getPeerPublicKey(joinerUserId)
    if (!current || !peerKey) return

    const sealed = this.deps.crypto.wrapChannelKey({
      peerPublicKeyRaw: peerKey,
      channelKey: current.key,
      channel,
      fromUserId: this.deps.myUserId,
      toUserId: joinerUserId,
      epoch: current.epoch
    })
    this.deps.sendKeyShare(channel, joinerUserId, sealed.ciphertext, sealed.nonce, current.epoch)
  }

  /** Returns true if this KeyShare was successfully applied (first valid one for its epoch wins; later duplicates are discarded). */
  receiveKeyShare(
    channel: string,
    fromUserId: string,
    wrappedKey: Buffer,
    nonce: Buffer,
    epoch: number
  ): boolean {
    const existing = this.channels.get(channel)
    if (existing && existing.epoch >= epoch) return false

    const peerKey = this.deps.getPeerPublicKey(fromUserId)
    if (!peerKey) return false

    try {
      const key = this.deps.crypto.unwrapChannelKey({
        peerPublicKeyRaw: peerKey,
        sealed: { ciphertext: wrappedKey, nonce },
        channel,
        fromUserId,
        toUserId: this.deps.myUserId,
        epoch
      })
      this.channels.set(channel, { key, epoch })
      this.deps.onKeyReady?.(channel, epoch)
      return true
    } catch {
      // Not actually wrapped for us (wrong sender guess, tampered, or a
      // stale/foreign epoch) — discard silently, another KeyShare for the
      // right epoch is expected to follow.
      return false
    }
  }

  /** Called on the server's KeyRotationNotice for a channel we're in. */
  onKeyRotationNotice(channel: string, newEpoch: number): void {
    const others = this.deps.getOtherMembers(channel)
    const allIds = [this.deps.myUserId, ...others].sort()
    const isResponsible = allIds[0] === this.deps.myUserId
    if (!isResponsible) return // someone else generates and sends us the new key

    const newKey = this.deps.crypto.generateChannelKey()
    for (const memberId of others) {
      const peerKey = this.deps.getPeerPublicKey(memberId)
      if (!peerKey) continue
      const sealed = this.deps.crypto.wrapChannelKey({
        peerPublicKeyRaw: peerKey,
        channelKey: newKey,
        channel,
        fromUserId: this.deps.myUserId,
        toUserId: memberId,
        epoch: newEpoch
      })
      this.deps.sendKeyShare(channel, memberId, sealed.ciphertext, sealed.nonce, newEpoch)
    }
    this.channels.set(channel, { key: newKey, epoch: newEpoch })
    this.deps.onKeyReady?.(channel, newEpoch)
  }

  /**
   * Manual recovery when a joiner's key never arrives — e.g. the reconnect
   * race in PORTING-NOTES.md, where the only other "member" the server
   * still reports is actually the same person's stale, already-dead old
   * connection, which can never send a KeyShare. wrapForNewMember only
   * runs on *existing* members' clients on a join notification, so a
   * joiner with no live existing member has no other path forward — this
   * is user-triggered, not automatic, to avoid two people racing to reset
   * at once.
   *
   * Generates a fresh key and re-shares it to every other current member,
   * same as a rotation, so the group converges on one key instead of the
   * resetter silently diverging onto their own. Uses the current time as
   * the epoch rather than incrementing from a known value (we may not
   * have ever had one) — this is a rare, manual fallback, not part of the
   * normal rotation sequence, so it only needs to be virtually guaranteed
   * higher than any epoch already in use, not precisely coordinated.
   */
  resetChannel(channel: string): void {
    const newKey = this.deps.crypto.generateChannelKey()
    const epoch = Date.now()
    for (const memberId of this.deps.getOtherMembers(channel)) {
      const peerKey = this.deps.getPeerPublicKey(memberId)
      if (!peerKey) continue
      const sealed = this.deps.crypto.wrapChannelKey({
        peerPublicKeyRaw: peerKey,
        channelKey: newKey,
        channel,
        fromUserId: this.deps.myUserId,
        toUserId: memberId,
        epoch
      })
      this.deps.sendKeyShare(channel, memberId, sealed.ciphertext, sealed.nonce, epoch)
    }
    this.channels.set(channel, { key: newKey, epoch })
    this.deps.onKeyReady?.(channel, epoch)
  }

  forget(channel: string): void {
    this.channels.delete(channel)
  }
}
