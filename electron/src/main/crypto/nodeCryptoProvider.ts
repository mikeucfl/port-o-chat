import { randomUUID } from 'node:crypto'
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
 * CryptoProvider backed by this app's existing Node-crypto E2E
 * implementation — no logic changes, just a stable seam ChatController can
 * be written against. Defaults to the process-wide identity singleton (the
 * real app only ever wants one), but accepts an injected Identity so tests
 * can simulate several distinct parties in one process.
 */
export class NodeCryptoProvider implements CryptoProvider {
  private readonly identity: Identity

  constructor(identity: Identity = getOrCreateIdentity()) {
    this.identity = identity
  }

  get identityPublicKey(): Buffer {
    return this.identity.publicKeyRaw
  }

  randomId(): string {
    return randomUUID()
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
