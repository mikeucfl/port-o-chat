import { createHash } from 'node:crypto'

/**
 * Safety-number-style fingerprint: SHA-256 of the raw X25519 public key,
 * first 16 bytes, formatted as 8 groups of 4 hex chars for easy visual/verbal
 * comparison out of band. Deterministic per identity key.
 */
export function computeFingerprint(publicKeyRaw: Buffer): string {
  const digest = createHash('sha256').update(publicKeyRaw).digest()
  const hex = digest.subarray(0, 16).toString('hex').toUpperCase()
  const groups = hex.match(/.{1,4}/g) ?? [hex]
  return groups.join(' ')
}
