import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { AEAD_NONCE_LENGTH } from '@shared/constants'

const AUTH_TAG_LENGTH = 16

export interface SealedBox {
  /** Ciphertext with the 16-byte GCM auth tag appended. */
  ciphertext: Buffer
  nonce: Buffer
}

/** Thrown when a ciphertext fails authentication (tampered, wrong key, or wrong AAD). */
export class AeadOpenError extends Error {}

/**
 * AES-256-GCM seal. A fresh random 12-byte nonce is generated for every
 * call — never a counter, so no state needs to persist across restarts
 * (consistent with the app's zero-persistence requirement). See
 * CRYPTO.md for the birthday-bound justification.
 */
export function seal(key: Buffer, plaintext: Buffer, aad: Buffer): SealedBox {
  const nonce = randomBytes(AEAD_NONCE_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(aad)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return { ciphertext: Buffer.concat([encrypted, cipher.getAuthTag()]), nonce }
}

export function open(key: Buffer, sealed: SealedBox, aad: Buffer): Buffer {
  if (sealed.ciphertext.length < AUTH_TAG_LENGTH) {
    throw new AeadOpenError('ciphertext shorter than the auth tag')
  }
  const tag = sealed.ciphertext.subarray(sealed.ciphertext.length - AUTH_TAG_LENGTH)
  const encrypted = sealed.ciphertext.subarray(0, sealed.ciphertext.length - AUTH_TAG_LENGTH)
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.nonce)
  decipher.setAAD(aad)
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(encrypted), decipher.final()])
  } catch (err) {
    throw new AeadOpenError(`authentication failed: ${(err as Error).message}`)
  }
}
