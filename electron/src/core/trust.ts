export interface KeyChangeEvent {
  userId: string
  oldFingerprint: string
  newFingerprint: string
}

/**
 * Trust-on-first-use pin store, in-memory for the session only (no
 * persistence across restarts — re-pins fresh every launch, same as the
 * identity keys themselves). If a peer's key changes mid-session, outgoing
 * E2E sends to them are blocked until the user explicitly re-trusts.
 *
 * Fingerprinting is injected rather than imported directly, since the two
 * platforms this runs on (Node main process, browser) compute it via
 * different crypto backends — see CryptoProvider.
 */
export class TrustStore {
  private pinned = new Map<string, Buffer>()
  private blocked = new Set<string>()

  constructor(private readonly fingerprint: (publicKeyRaw: Buffer) => string) {}

  /** Returns a KeyChangeEvent if this key differs from a previously-pinned one for the same user; null on first sight or no change. */
  observe(userId: string, publicKeyRaw: Buffer): KeyChangeEvent | null {
    const existing = this.pinned.get(userId)
    if (!existing) {
      this.pinned.set(userId, publicKeyRaw)
      return null
    }
    if (existing.equals(publicKeyRaw)) return null

    const event: KeyChangeEvent = {
      userId,
      oldFingerprint: this.fingerprint(existing),
      newFingerprint: this.fingerprint(publicKeyRaw)
    }
    this.pinned.set(userId, publicKeyRaw)
    this.blocked.add(userId)
    return event
  }

  isBlocked(userId: string): boolean {
    return this.blocked.has(userId)
  }

  trust(userId: string): void {
    this.blocked.delete(userId)
  }

  getPinnedKey(userId: string): Buffer | undefined {
    return this.pinned.get(userId)
  }
}
