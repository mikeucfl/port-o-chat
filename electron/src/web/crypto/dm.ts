import { type SealedBox, open, seal } from './aead'
import { hkdf } from './hkdf'
import { deriveSharedSecret } from './identity'

const DM_SALT = 'PortoChatE2Ev1-DM-Salt'

/** Sorting the two ids makes both directions derive the identical key with no extra handshake. */
function dmInfo(userIdA: string, userIdB: string): string {
  return `dm:${[userIdA, userIdB].sort().join(':')}`
}

/** Static-static ECDH -> HKDF. No forward secrecy — see CRYPTO.md (this is a deliberate, documented non-goal). Byte-for-byte identical derivation to main/crypto/dm.ts. */
export function deriveDmKey(
  myPrivateKey: Buffer,
  peerPublicKeyRaw: Buffer,
  myUserId: string,
  peerUserId: string
): Buffer {
  const shared = deriveSharedSecret(myPrivateKey, peerPublicKeyRaw)
  return hkdf(shared, DM_SALT, dmInfo(myUserId, peerUserId))
}

function dmAad(senderId: string, destinationId: string): Buffer {
  return Buffer.from(`${senderId}|${destinationId}|dm`, 'utf8')
}

export function encryptDm(
  key: Buffer,
  plaintext: string,
  senderId: string,
  destinationId: string
): SealedBox {
  return seal(key, Buffer.from(plaintext, 'utf8'), dmAad(senderId, destinationId))
}

export function decryptDm(
  key: Buffer,
  sealed: SealedBox,
  senderId: string,
  destinationId: string
): string {
  return open(key, sealed, dmAad(senderId, destinationId)).toString('utf8')
}
