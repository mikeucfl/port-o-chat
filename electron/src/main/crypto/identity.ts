import { createPublicKey, diffieHellman, generateKeyPairSync, type KeyObject } from 'node:crypto'

/**
 * X25519 identity keypairs, in-memory only. Node's crypto module has no
 * "raw" X25519 export, so raw 32-byte public keys (what actually goes on
 * the wire, in UserData.e2eIdentityKey) are obtained via JWK export/import,
 * which is the one Node-native format that exposes the raw key material
 * directly instead of wrapping it in a DER/PEM envelope.
 */

export interface Identity {
  readonly privateKey: KeyObject
  readonly publicKey: KeyObject
  readonly publicKeyRaw: Buffer
}

let currentIdentity: Identity | null = null

function keyObjectToRawPublic(key: KeyObject): Buffer {
  const jwk = key.export({ format: 'jwk' }) as { x: string }
  return Buffer.from(jwk.x, 'base64url')
}

export function rawPublicKeyToKeyObject(raw: Buffer): KeyObject {
  return createPublicKey({
    key: { kty: 'OKP', crv: 'X25519', x: raw.toString('base64url') },
    format: 'jwk'
  })
}

/** Generates the identity keypair on first call; the same identity is reused for the rest of the process lifetime. */
export function getOrCreateIdentity(): Identity {
  if (currentIdentity) return currentIdentity
  const { privateKey, publicKey } = generateKeyPairSync('x25519')
  currentIdentity = { privateKey, publicKey, publicKeyRaw: keyObjectToRawPublic(publicKey) }
  return currentIdentity
}

/**
 * Drops all references to the identity keys so nothing in the process can
 * reach them and they become eligible for GC. Node/V8 give no guaranteed
 * secure-wipe primitive for KeyObjects, so this is best-effort, matching
 * the "in-memory only, destroyed on quit" requirement as closely as the
 * platform allows.
 */
export function destroyIdentity(): void {
  currentIdentity = null
}

export function deriveSharedSecret(privateKey: KeyObject, peerPublicKey: KeyObject): Buffer {
  return diffieHellman({ privateKey, publicKey: peerPublicKey })
}
