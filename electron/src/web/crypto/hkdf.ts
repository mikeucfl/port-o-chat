import { hkdf as nobleHkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'

/** Matches main/crypto/hkdf.ts's hkdfSync('sha256', ikm, salt, info, length) exactly — salt/info are UTF-8 strings on both sides. */
export function hkdf(ikm: Buffer, salt: string, info: string, length = 32): Buffer {
  return Buffer.from(nobleHkdf(sha256, ikm, utf8ToBytes(salt), utf8ToBytes(info), length))
}
