import { randomBytes } from '@noble/hashes/utils.js'
import { CHANNEL_KEY_LENGTH } from '@shared/constants'
import { type SealedBox, open, seal } from './aead'
import { hkdf } from './hkdf'
import { deriveSharedSecret } from './identity'

const CHANNEL_SALT = 'PortoChatE2Ev1-Channel-Salt'

function keyshareInfo(channel: string, epoch: number): string {
  return `keyshare:${channel}:${epoch}`
}

function keyshareAad(channel: string, fromUserId: string, toUserId: string, epoch: number): Buffer {
  return Buffer.from(`${channel}|${fromUserId}|${toUserId}|${epoch}`, 'utf8')
}

export function generateChannelKey(): Buffer {
  return Buffer.from(randomBytes(CHANNEL_KEY_LENGTH))
}

export interface WrapParams {
  myPrivateKey: Buffer
  peerPublicKeyRaw: Buffer
  channelKey: Buffer
  channel: string
  fromUserId: string
  toUserId: string
  epoch: number
}

/**
 * Wraps a channel's symmetric key to a single recipient via ECDH+HKDF+AEAD.
 * Byte-for-byte identical derivation to main/crypto/channelKeys.ts — see
 * CRYPTO.md for the rotation coordination rule this participates in.
 */
export function wrapChannelKey(params: WrapParams): SealedBox {
  const shared = deriveSharedSecret(params.myPrivateKey, params.peerPublicKeyRaw)
  const wrapKey = hkdf(shared, CHANNEL_SALT, keyshareInfo(params.channel, params.epoch))
  const aad = keyshareAad(params.channel, params.fromUserId, params.toUserId, params.epoch)
  return seal(wrapKey, params.channelKey, aad)
}

export interface UnwrapParams {
  myPrivateKey: Buffer
  peerPublicKeyRaw: Buffer
  sealed: SealedBox
  channel: string
  fromUserId: string
  toUserId: string
  epoch: number
}

/** Throws AeadOpenError if this KeyShare wasn't actually wrapped for us (wrong sender/epoch/tampered). */
export function unwrapChannelKey(params: UnwrapParams): Buffer {
  const shared = deriveSharedSecret(params.myPrivateKey, params.peerPublicKeyRaw)
  const wrapKey = hkdf(shared, CHANNEL_SALT, keyshareInfo(params.channel, params.epoch))
  const aad = keyshareAad(params.channel, params.fromUserId, params.toUserId, params.epoch)
  return open(wrapKey, params.sealed, aad)
}

function channelMessageAad(channel: string, senderId: string, epoch: number): Buffer {
  return Buffer.from(`${channel}|${senderId}|${epoch}`, 'utf8')
}

export function encryptChannelMessage(
  channelKey: Buffer,
  plaintext: string,
  channel: string,
  senderId: string,
  epoch: number
): SealedBox {
  return seal(channelKey, Buffer.from(plaintext, 'utf8'), channelMessageAad(channel, senderId, epoch))
}

export function decryptChannelMessage(
  channelKey: Buffer,
  sealed: SealedBox,
  channel: string,
  senderId: string,
  epoch: number
): string {
  return open(channelKey, sealed, channelMessageAad(channel, senderId, epoch)).toString('utf8')
}
