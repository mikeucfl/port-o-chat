import { hkdfSync } from 'node:crypto'

/** HKDF-SHA256, returning a Buffer instead of Node's raw ArrayBuffer. */
export function hkdf(ikm: Buffer, salt: string, info: string, length = 32): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length))
}
