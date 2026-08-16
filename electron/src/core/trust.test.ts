import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { TrustStore } from './trust'

function makeIdentity() {
  const { publicKey } = generateKeyPairSync('x25519')
  const raw = Buffer.from((publicKey.export({ format: 'jwk' }) as { x: string }).x, 'base64url')
  return { raw }
}

// A trivial deterministic stand-in for the real fingerprint function — these
// tests only care about TrustStore's pin/block logic, not fingerprint
// formatting (covered separately wherever CryptoProvider.fingerprint lives).
function fingerprint(publicKeyRaw: Buffer): string {
  return publicKeyRaw.toString('hex')
}

describe('TrustStore', () => {
  it('pins on first sight without raising a change event', () => {
    const store = new TrustStore(fingerprint)
    const alice = makeIdentity()
    expect(store.observe('alice-id', alice.raw)).toBeNull()
    expect(store.isBlocked('alice-id')).toBe(false)
  })

  it('does not flag a repeat of the same key', () => {
    const store = new TrustStore(fingerprint)
    const alice = makeIdentity()
    store.observe('alice-id', alice.raw)
    expect(store.observe('alice-id', alice.raw)).toBeNull()
  })

  it('flags and blocks on a genuine key change, until explicitly re-trusted', () => {
    const store = new TrustStore(fingerprint)
    const alice = makeIdentity()
    const alicesNewKey = makeIdentity()
    store.observe('alice-id', alice.raw)

    const event = store.observe('alice-id', alicesNewKey.raw)
    expect(event).not.toBeNull()
    expect(event?.userId).toBe('alice-id')
    expect(store.isBlocked('alice-id')).toBe(true)

    store.trust('alice-id')
    expect(store.isBlocked('alice-id')).toBe(false)
  })
})
