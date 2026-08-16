import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AeadOpenError, open, seal } from './aead'
import {
  decryptChannelMessage,
  encryptChannelMessage,
  generateChannelKey,
  unwrapChannelKey,
  wrapChannelKey
} from './channelKeys'
import { decryptDm, deriveDmKey, encryptDm } from './dm'
import { computeFingerprint } from './fingerprint'
import { hkdf } from './hkdf'
import { deriveSharedSecret, rawPublicKeyToKeyObject } from './identity'

function makeIdentity() {
  const { privateKey, publicKey } = generateKeyPairSync('x25519')
  const raw = Buffer.from((publicKey.export({ format: 'jwk' }) as { x: string }).x, 'base64url')
  return { privateKey, publicKey, raw }
}

describe('identity / ECDH', () => {
  it('produces a symmetric shared secret regardless of direction', () => {
    const alice = makeIdentity()
    const bob = makeIdentity()

    const fromAlice = deriveSharedSecret(alice.privateKey, rawPublicKeyToKeyObject(bob.raw))
    const fromBob = deriveSharedSecret(bob.privateKey, rawPublicKeyToKeyObject(alice.raw))

    expect(fromAlice.equals(fromBob)).toBe(true)
  })

  it('raw public key round-trips through rawPublicKeyToKeyObject', () => {
    const alice = makeIdentity()
    const reconstructed = rawPublicKeyToKeyObject(alice.raw)
    const rawAgain = Buffer.from(
      (reconstructed.export({ format: 'jwk' }) as { x: string }).x,
      'base64url'
    )
    expect(rawAgain.equals(alice.raw)).toBe(true)
  })
})

describe('hkdf', () => {
  it('is deterministic for identical inputs', () => {
    const ikm = Buffer.from('shared secret material')
    const a = hkdf(ikm, 'salt', 'info')
    const b = hkdf(ikm, 'salt', 'info')
    expect(a.equals(b)).toBe(true)
  })

  it('differs when info differs', () => {
    const ikm = Buffer.from('shared secret material')
    const a = hkdf(ikm, 'salt', 'info-a')
    const b = hkdf(ikm, 'salt', 'info-b')
    expect(a.equals(b)).toBe(false)
  })
})

describe('aead seal/open', () => {
  it('round-trips plaintext', () => {
    const key = Buffer.alloc(32, 7)
    const aad = Buffer.from('context')
    const sealed = seal(key, Buffer.from('hello world'), aad)
    const opened = open(key, sealed, aad)
    expect(opened.toString('utf8')).toBe('hello world')
  })

  it('never reuses a nonce across two seals', () => {
    const key = Buffer.alloc(32, 7)
    const a = seal(key, Buffer.from('one'), Buffer.from('aad'))
    const b = seal(key, Buffer.from('two'), Buffer.from('aad'))
    expect(a.nonce.equals(b.nonce)).toBe(false)
  })

  it('rejects a tampered ciphertext', () => {
    const key = Buffer.alloc(32, 7)
    const aad = Buffer.from('context')
    const sealed = seal(key, Buffer.from('hello world'), aad)
    sealed.ciphertext[0] = (sealed.ciphertext[0] ?? 0) ^ 0xff
    expect(() => open(key, sealed, aad)).toThrow(AeadOpenError)
  })

  it('rejects mismatched AAD', () => {
    const key = Buffer.alloc(32, 7)
    const sealed = seal(key, Buffer.from('hello world'), Buffer.from('aad-a'))
    expect(() => open(key, sealed, Buffer.from('aad-b'))).toThrow(AeadOpenError)
  })
})

describe('DM E2E', () => {
  it('both participants derive the identical key regardless of who is "A"', () => {
    const alice = makeIdentity()
    const bob = makeIdentity()
    const keyFromAlice = deriveDmKey(alice.privateKey, bob.raw, 'user-alice', 'user-bob')
    const keyFromBob = deriveDmKey(bob.privateKey, alice.raw, 'user-bob', 'user-alice')
    expect(keyFromAlice.equals(keyFromBob)).toBe(true)
  })

  it('encrypts and decrypts a message round trip', () => {
    const alice = makeIdentity()
    const bob = makeIdentity()
    const key = deriveDmKey(alice.privateKey, bob.raw, 'user-alice', 'user-bob')
    const sealed = encryptDm(key, 'hey bob', 'user-alice', 'user-bob')
    const plaintext = decryptDm(key, sealed, 'user-alice', 'user-bob')
    expect(plaintext).toBe('hey bob')
  })
})

describe('Channel E2E', () => {
  it('wraps and unwraps a channel key between two peers', () => {
    const creator = makeIdentity()
    const joiner = makeIdentity()
    const channelKey = generateChannelKey()

    const wrapped = wrapChannelKey({
      myPrivateKey: creator.privateKey,
      peerPublicKeyRaw: joiner.raw,
      channelKey,
      channel: '#secret',
      fromUserId: 'creator-id',
      toUserId: 'joiner-id',
      epoch: 0
    })

    const unwrapped = unwrapChannelKey({
      myPrivateKey: joiner.privateKey,
      peerPublicKeyRaw: creator.raw,
      sealed: wrapped,
      channel: '#secret',
      fromUserId: 'creator-id',
      toUserId: 'joiner-id',
      epoch: 0
    })

    expect(unwrapped.equals(channelKey)).toBe(true)
  })

  it('fails to unwrap with the wrong epoch (rejects a stale/future keyshare)', () => {
    const creator = makeIdentity()
    const joiner = makeIdentity()
    const channelKey = generateChannelKey()
    const wrapped = wrapChannelKey({
      myPrivateKey: creator.privateKey,
      peerPublicKeyRaw: joiner.raw,
      channelKey,
      channel: '#secret',
      fromUserId: 'creator-id',
      toUserId: 'joiner-id',
      epoch: 0
    })

    expect(() =>
      unwrapChannelKey({
        myPrivateKey: joiner.privateKey,
        peerPublicKeyRaw: creator.raw,
        sealed: wrapped,
        channel: '#secret',
        fromUserId: 'creator-id',
        toUserId: 'joiner-id',
        epoch: 1 // wrong epoch
      })
    ).toThrow()
  })

  it('rotation produces a distinct key from the previous epoch', () => {
    const epoch0 = generateChannelKey()
    const epoch1 = generateChannelKey()
    expect(epoch0.equals(epoch1)).toBe(false)
  })

  it('encrypts and decrypts a channel message, and rejects decryption under the wrong epoch', () => {
    const channelKey = generateChannelKey()
    const sealed = encryptChannelMessage(channelKey, 'hello #secret', '#secret', 'alice-id', 2)
    const plaintext = decryptChannelMessage(channelKey, sealed, '#secret', 'alice-id', 2)
    expect(plaintext).toBe('hello #secret')

    expect(() => decryptChannelMessage(channelKey, sealed, '#secret', 'alice-id', 3)).toThrow()
  })
})

describe('fingerprint', () => {
  it('is deterministic', () => {
    const alice = makeIdentity()
    expect(computeFingerprint(alice.raw)).toBe(computeFingerprint(alice.raw))
  })

  it('differs between distinct keys', () => {
    const alice = makeIdentity()
    const bob = makeIdentity()
    expect(computeFingerprint(alice.raw)).not.toBe(computeFingerprint(bob.raw))
  })

  it('is formatted as 8 groups of 4 uppercase hex chars', () => {
    const alice = makeIdentity()
    expect(computeFingerprint(alice.raw)).toMatch(/^([0-9A-F]{4} ){7}[0-9A-F]{4}$/)
  })
})
