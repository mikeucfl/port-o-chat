import { gcm } from '@noble/ciphers/aes.js'
import { randomBytes } from '@noble/ciphers/utils.js'
import { AEAD_NONCE_LENGTH } from '@shared/constants'

export interface SealedBox {
  /** Ciphertext with the 16-byte GCM auth tag appended — same layout noble's gcm().encrypt() already produces, matching main/crypto/aead.ts's manual Buffer.concat. */
  ciphertext: Buffer
  nonce: Buffer
}

/** Thrown when a ciphertext fails authentication (tampered, wrong key, or wrong AAD). */
export class AeadOpenError extends Error {}

/**
 * AES-256-GCM seal via @noble/ciphers — see CRYPTO.md for why this build
 * uses noble instead of the browser's native crypto.subtle (unavailable
 * outside a Secure Context, i.e. exactly the plain http://<lan-ip>
 * deployment this app exists for). A fresh random 12-byte nonce is
 * generated for every call — never a counter — matching main/crypto/aead.ts.
 */
export function seal(key: Buffer, plaintext: Buffer, aad: Buffer): SealedBox {
  const nonce = Buffer.from(randomBytes(AEAD_NONCE_LENGTH))
  const ciphertext = Buffer.from(gcm(key, nonce, aad).encrypt(plaintext))
  return { ciphertext, nonce }
}

export function open(key: Buffer, sealed: SealedBox, aad: Buffer): Buffer {
  try {
    return Buffer.from(gcm(key, sealed.nonce, aad).decrypt(sealed.ciphertext))
  } catch (err) {
    throw new AeadOpenError(`authentication failed: ${(err as Error).message}`)
  }
}
