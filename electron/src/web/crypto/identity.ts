import { x25519 } from '@noble/curves/ed25519.js'

export interface Identity {
  readonly privateKey: Buffer
  readonly publicKey: Buffer
  readonly publicKeyRaw: Buffer
}

let currentIdentity: Identity | null = null

/**
 * X25519 identity keypair, in-memory only. Unlike main/crypto/identity.ts
 * (Node), noble works natively with raw 32-byte keys — no JWK export/
 * import gymnastics needed, since noble has no Node-KeyObject-style
 * wrapping to begin with.
 *
 * Deliberately NOT persisted across page reloads (not even to
 * sessionStorage) — some browsers write sessionStorage to disk for
 * session-restore, outside this app's control, the same reasoning that
 * keeps this app from using OS toast notifications (see CRYPTO.md).
 * Every reload regenerates a fresh identity, same as the desktop build
 * regenerating its identity every launch.
 */
export function getOrCreateIdentity(): Identity {
  if (currentIdentity) return currentIdentity
  const { secretKey, publicKey } = x25519.keygen()
  currentIdentity = {
    privateKey: Buffer.from(secretKey),
    publicKey: Buffer.from(publicKey),
    publicKeyRaw: Buffer.from(publicKey)
  }
  return currentIdentity
}

export function deriveSharedSecret(privateKey: Buffer, peerPublicKeyRaw: Buffer): Buffer {
  return Buffer.from(x25519.getSharedSecret(privateKey, peerPublicKeyRaw))
}
