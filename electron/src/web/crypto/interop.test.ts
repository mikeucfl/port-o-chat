import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { x25519 } from '@noble/curves/ed25519.js'
import { open as nodeOpen, seal as nodeSeal } from '../../main/crypto/aead'
import {
  decryptChannelMessage as nodeDecryptChannelMessage,
  unwrapChannelKey as nodeUnwrapChannelKey,
  wrapChannelKey as nodeWrapChannelKey
} from '../../main/crypto/channelKeys'
import { decryptDm as nodeDecryptDm, deriveDmKey as nodeDeriveDmKey, encryptDm as nodeEncryptDm } from '../../main/crypto/dm'
import { computeFingerprint as nodeFingerprint } from '../../main/crypto/fingerprint'
import { hkdf as nodeHkdf } from '../../main/crypto/hkdf'
import { deriveSharedSecret as nodeDeriveSharedSecret, rawPublicKeyToKeyObject } from '../../main/crypto/identity'
import { NodeCryptoProvider } from '../../main/crypto/nodeCryptoProvider'
import { open as webOpen, seal as webSeal } from './aead'
import {
  decryptChannelMessage as webDecryptChannelMessage,
  encryptChannelMessage as webEncryptChannelMessage,
  unwrapChannelKey as webUnwrapChannelKey
} from './channelKeys'
import { decryptDm as webDecryptDm, deriveDmKey as webDeriveDmKey, encryptDm as webEncryptDm } from './dm'
import { computeFingerprint as webFingerprint } from './fingerprint'
import { hkdf as webHkdf } from './hkdf'
import { deriveSharedSecret as webDeriveSharedSecret } from './identity'
import { WebCryptoProvider } from './webCryptoProvider'

/**
 * Proves the Node (main/crypto/*) and noble (web/crypto/*) E2E
 * implementations are byte-for-byte interoperable — a desktop user and a
 * browser user really do derive the same keys and can decrypt each
 * other's messages. Turns the "these are standard algorithms so they'll
 * match" claim in CRYPTO.md into a verified fact rather than an unchecked
 * assumption.
 *
 * Runs entirely under Node (vitest) — noble runs identically there.
 */

interface NodeIdentity {
  privateKey: KeyObject
  publicKeyRaw: Buffer
}

interface WebIdentity {
  privateKey: Buffer
  publicKeyRaw: Buffer
}

function makeNodeIdentity(): NodeIdentity {
  const { privateKey, publicKey } = generateKeyPairSync('x25519')
  const publicKeyRaw = Buffer.from((publicKey.export({ format: 'jwk' }) as { x: string }).x, 'base64url')
  return { privateKey, publicKeyRaw }
}

function makeWebIdentity(): WebIdentity {
  const { secretKey, publicKey } = x25519.keygen()
  return { privateKey: Buffer.from(secretKey), publicKeyRaw: Buffer.from(publicKey) }
}

describe('Node <-> noble crypto interop', () => {
  it('X25519 ECDH agrees across implementations in both directions', () => {
    const alice = makeNodeIdentity()
    const bob = makeWebIdentity()

    const fromNode = nodeDeriveSharedSecret(alice.privateKey, rawPublicKeyToKeyObject(bob.publicKeyRaw))
    const fromWeb = webDeriveSharedSecret(bob.privateKey, alice.publicKeyRaw)
    expect(fromNode.equals(fromWeb)).toBe(true)
  })

  it('HKDF-SHA256 produces identical output for identical inputs', () => {
    const ikm = Buffer.from('shared secret material')
    const a = nodeHkdf(ikm, 'salt-value', 'info-value')
    const b = webHkdf(ikm, 'salt-value', 'info-value')
    expect(a.equals(b)).toBe(true)
  })

  it('fingerprint() produces the identical string for the same raw public key', () => {
    const alice = makeWebIdentity()
    expect(nodeFingerprint(alice.publicKeyRaw)).toBe(webFingerprint(alice.publicKeyRaw))
  })

  it('AES-256-GCM: a noble-sealed box opens correctly under Node, and vice versa', () => {
    const key = Buffer.alloc(32, 7)
    const aad = Buffer.from('context')
    const plaintext = Buffer.from('hello world')

    const sealedByWeb = webSeal(key, plaintext, aad)
    expect(nodeOpen(key, sealedByWeb, aad).toString('utf8')).toBe('hello world')

    const sealedByNode = nodeSeal(key, plaintext, aad)
    expect(webOpen(key, sealedByNode, aad).toString('utf8')).toBe('hello world')
  })

  it('DM: a Node sender and a noble recipient derive the same key and decrypt correctly, both directions', () => {
    const alice = makeNodeIdentity()
    const bob = makeWebIdentity()

    const keyFromAlice = nodeDeriveDmKey(alice.privateKey, bob.publicKeyRaw, 'alice-id', 'bob-id')
    const keyFromBob = webDeriveDmKey(bob.privateKey, alice.publicKeyRaw, 'bob-id', 'alice-id')
    expect(keyFromAlice.equals(keyFromBob)).toBe(true)

    const sealed = nodeEncryptDm(keyFromAlice, 'hey bob', 'alice-id', 'bob-id')
    expect(webDecryptDm(keyFromBob, sealed, 'alice-id', 'bob-id')).toBe('hey bob')

    const reply = webEncryptDm(keyFromBob, 'hey alice', 'bob-id', 'alice-id')
    expect(nodeDecryptDm(keyFromAlice, reply, 'bob-id', 'alice-id')).toBe('hey alice')
  })

  it('channel key wrap/unwrap and channel messages interoperate at several epochs', () => {
    const creator = makeNodeIdentity()
    const joiner = makeWebIdentity()
    const channelKey = Buffer.alloc(32, 9)

    for (const epoch of [0, 1, 42]) {
      const wrapped = nodeWrapChannelKey({
        myPrivateKey: creator.privateKey,
        peerPublicKeyRaw: joiner.publicKeyRaw,
        channelKey,
        channel: '#secret',
        fromUserId: 'creator-id',
        toUserId: 'joiner-id',
        epoch
      })
      const unwrapped = webUnwrapChannelKey({
        myPrivateKey: joiner.privateKey,
        peerPublicKeyRaw: creator.publicKeyRaw,
        sealed: wrapped,
        channel: '#secret',
        fromUserId: 'creator-id',
        toUserId: 'joiner-id',
        epoch
      })
      expect(unwrapped.equals(channelKey)).toBe(true)

      const sealedMsg = webEncryptChannelMessage(
        channelKey,
        `hello at epoch ${epoch}`,
        '#secret',
        'joiner-id',
        epoch
      )
      expect(nodeDecryptChannelMessage(channelKey, sealedMsg, '#secret', 'joiner-id', epoch)).toBe(
        `hello at epoch ${epoch}`
      )
    }
  })

  it('full CryptoProvider round trip: NodeCryptoProvider <-> WebCryptoProvider for DMs and channel keys', () => {
    const alice = makeNodeIdentity()
    const bob = makeWebIdentity()

    const aliceProvider = new NodeCryptoProvider({
      privateKey: alice.privateKey,
      publicKey: rawPublicKeyToKeyObject(alice.publicKeyRaw),
      publicKeyRaw: alice.publicKeyRaw
    })
    const bobProvider = new WebCryptoProvider({
      privateKey: bob.privateKey,
      publicKey: bob.publicKeyRaw,
      publicKeyRaw: bob.publicKeyRaw
    })

    const sealed = aliceProvider.encryptDm(bobProvider.identityPublicKey, 'hi from desktop', 'alice-id', 'bob-id')
    expect(bobProvider.decryptDm(aliceProvider.identityPublicKey, sealed, 'alice-id', 'bob-id')).toBe(
      'hi from desktop'
    )

    const reply = bobProvider.encryptDm(aliceProvider.identityPublicKey, 'hi from browser', 'bob-id', 'alice-id')
    expect(aliceProvider.decryptDm(bobProvider.identityPublicKey, reply, 'bob-id', 'alice-id')).toBe(
      'hi from browser'
    )

    const channelKey = aliceProvider.generateChannelKey()
    const wrapped = aliceProvider.wrapChannelKey({
      peerPublicKeyRaw: bobProvider.identityPublicKey,
      channelKey,
      channel: '#mixed',
      fromUserId: 'alice-id',
      toUserId: 'bob-id',
      epoch: 0
    })
    const unwrapped = bobProvider.unwrapChannelKey({
      peerPublicKeyRaw: aliceProvider.identityPublicKey,
      sealed: wrapped,
      channel: '#mixed',
      fromUserId: 'alice-id',
      toUserId: 'bob-id',
      epoch: 0
    })
    expect(unwrapped.equals(channelKey)).toBe(true)
    expect(aliceProvider.fingerprint(aliceProvider.identityPublicKey)).toBe(
      bobProvider.fingerprint(aliceProvider.identityPublicKey)
    )
  })
})
