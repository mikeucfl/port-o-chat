import type { KeyObject } from 'node:crypto'
import { generateChannelKey, unwrapChannelKey, wrapChannelKey } from './channelKeys'

export interface ChannelKeyState {
  key: Buffer
  epoch: number
}

export interface ChannelKeyManagerDeps {
  myUserId: string
  myPrivateKey: KeyObject
  sendKeyShare: (channel: string, toUserId: string, wrappedKey: Buffer, nonce: Buffer, epoch: number) => void
  getPeerPublicKey: (userId: string) => Buffer | undefined
  /** Current members of the channel, excluding the local user. */
  getOtherMembers: (channel: string) => string[]
  onKeyReady?: (channel: string, epoch: number) => void
}

/**
 * Client-side orchestration for per-channel E2E keys. Pure logic, no
 * transport — the server never appears in this file at all, matching the
 * invariant that it must never possess a channel key.
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
    const state: ChannelKeyState = { key: generateChannelKey(), epoch: 0 }
    this.channels.set(channel, state)
    this.deps.onKeyReady?.(channel, state.epoch)
    return state
  }

  /** Called (by every existing member) when someone else joins a channel we already hold a key for. */
  wrapForNewMember(channel: string, joinerUserId: string): void {
    const current = this.channels.get(channel)
    const peerKey = this.deps.getPeerPublicKey(joinerUserId)
    if (!current || !peerKey) return

    const sealed = wrapChannelKey({
      myPrivateKey: this.deps.myPrivateKey,
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
      const key = unwrapChannelKey({
        myPrivateKey: this.deps.myPrivateKey,
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

    const newKey = generateChannelKey()
    for (const memberId of others) {
      const peerKey = this.deps.getPeerPublicKey(memberId)
      if (!peerKey) continue
      const sealed = wrapChannelKey({
        myPrivateKey: this.deps.myPrivateKey,
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

  forget(channel: string): void {
    this.channels.delete(channel)
  }
}
