import type {
  CryptoProvider,
  SealedBox,
  UnwrapChannelKeyParams,
  WrapChannelKeyParams
} from '@core/cryptoProvider'
import {
  decryptChannelMessage as decryptChannelMessageImpl,
  encryptChannelMessage as encryptChannelMessageImpl,
  generateChannelKey as generateChannelKeyImpl,
  unwrapChannelKey as unwrapChannelKeyImpl,
  wrapChannelKey as wrapChannelKeyImpl
} from './channelKeys'
import { decryptDm as decryptDmImpl, deriveDmKey, encryptDm as encryptDmImpl } from './dm'
import { computeFingerprint } from './fingerprint'
import { getOrCreateIdentity, type Identity } from './identity'

/**
 * CryptoProvider backed by @noble/* — the browser build's E2E
 * implementation. Mirrors main/crypto/nodeCryptoProvider.ts method for
 * method; the two are proven byte-for-byte compatible in interop.test.ts,
 * not just assumed to be from using "standard algorithms."
 */
export class WebCryptoProvider implements CryptoProvider {
  private readonly identity: Identity

  constructor(identity: Identity = getOrCreateIdentity()) {
    this.identity = identity
  }

  get identityPublicKey(): Buffer {
    return this.identity.publicKeyRaw
  }

  /** Deliberately not crypto.randomUUID() — also Secure-Context-only, same restriction as crypto.subtle. */
  randomId(): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }

  fingerprint(publicKeyRaw: Buffer): string {
    return computeFingerprint(publicKeyRaw)
  }

  generateChannelKey(): Buffer {
    return generateChannelKeyImpl()
  }

  encryptDm(peerPublicKeyRaw: Buffer, plaintext: string, myUserId: string, peerUserId: string): SealedBox {
    const key = deriveDmKey(this.identity.privateKey, peerPublicKeyRaw, myUserId, peerUserId)
    return encryptDmImpl(key, plaintext, myUserId, peerUserId)
  }

  decryptDm(peerPublicKeyRaw: Buffer, sealed: SealedBox, senderId: string, destinationId: string): string {
    // The two positional user ids passed to deriveDmKey are always
    // (local id, peer id) regardless of who sent/received this particular
    // message — deriveDmKey sorts them internally either way.
    const key = deriveDmKey(this.identity.privateKey, peerPublicKeyRaw, destinationId, senderId)
    return decryptDmImpl(key, sealed, senderId, destinationId)
  }

  wrapChannelKey(params: WrapChannelKeyParams): SealedBox {
    return wrapChannelKeyImpl({ myPrivateKey: this.identity.privateKey, ...params })
  }

  unwrapChannelKey(params: UnwrapChannelKeyParams): Buffer {
    return unwrapChannelKeyImpl({ myPrivateKey: this.identity.privateKey, ...params })
  }

  encryptChannelMessage(
    channelKey: Buffer,
    plaintext: string,
    channel: string,
    senderId: string,
    epoch: number
  ): SealedBox {
    return encryptChannelMessageImpl(channelKey, plaintext, channel, senderId, epoch)
  }

  decryptChannelMessage(
    channelKey: Buffer,
    sealed: SealedBox,
    channel: string,
    senderId: string,
    epoch: number
  ): string {
    return decryptChannelMessageImpl(channelKey, sealed, channel, senderId, epoch)
  }
}
