export interface SealedBox {
  ciphertext: Buffer
  nonce: Buffer
}

export interface WrapChannelKeyParams {
  peerPublicKeyRaw: Buffer
  channelKey: Buffer
  channel: string
  fromUserId: string
  toUserId: string
  epoch: number
}

export interface UnwrapChannelKeyParams {
  peerPublicKeyRaw: Buffer
  sealed: SealedBox
  channel: string
  fromUserId: string
  toUserId: string
  epoch: number
}

/**
 * The crypto seam ChatController is built on, so the same E2E policy logic
 * (which channel is E2E, DM auto-encrypt, TOFU blocking, etc.) runs
 * identically against Node's crypto module in the Electron main process
 * (main/crypto/nodeCryptoProvider.ts) and against @noble/* in the browser
 * build (web/crypto/webCryptoProvider.ts) — see CRYPTO.md for why native
 * Web Crypto (`subtle`) isn't used there (it's unavailable outside a Secure
 * Context, and this app's whole point is serving plain http://<lan-ip>).
 *
 * The provider owns the identity private key internally; it never appears
 * outside a CryptoProvider implementation, unlike the raw KeyObject that
 * used to get passed around directly.
 */
export interface CryptoProvider {
  /** Null means this platform currently has no E2E identity to announce (e.g. the browser build before its crypto backend lands) — the client behaves like a legacy, non-E2E-capable one: plaintext works, E2E channels correctly refuse it. */
  readonly identityPublicKey: Buffer | null

  /**
   * A random id, e.g. for client message ids. Deliberately not
   * crypto.randomUUID() — that's also Secure-Context-only in browsers, same
   * restriction as crypto.subtle.
   */
  randomId(): string

  fingerprint(publicKeyRaw: Buffer): string

  generateChannelKey(): Buffer

  encryptDm(peerPublicKeyRaw: Buffer, plaintext: string, myUserId: string, peerUserId: string): SealedBox
  decryptDm(peerPublicKeyRaw: Buffer, sealed: SealedBox, senderId: string, destinationId: string): string

  wrapChannelKey(params: WrapChannelKeyParams): SealedBox
  unwrapChannelKey(params: UnwrapChannelKeyParams): Buffer

  encryptChannelMessage(
    channelKey: Buffer,
    plaintext: string,
    channel: string,
    senderId: string,
    epoch: number
  ): SealedBox
  decryptChannelMessage(
    channelKey: Buffer,
    sealed: SealedBox,
    channel: string,
    senderId: string,
    epoch: number
  ): string
}
