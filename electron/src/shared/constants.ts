// Shared, dependency-free constants. Safe to import from the renderer —
// no Node/crypto/protobuf runtime code belongs in this file or this folder.

/** Hard ceiling imposed by the wire format's uint16 outer length prefix. */
export const MAX_FRAME_SIZE = 65535

/**
 * Application-level cap on the serialized protobuf payload, kept well under
 * MAX_FRAME_SIZE to leave header margin and bound abuse from a hostile peer.
 */
export const MAX_PROTOBUF_SIZE = 32 * 1024

export const MAX_MESSAGE_TEXT_LENGTH = 4000
export const MAX_NICKNAME_LENGTH = 32
export const MAX_CHANNEL_NAME_LENGTH = 64
export const MAX_CHANNEL_TOPIC_LENGTH = 200

/**
 * AES-256-GCM ciphertext is ~plaintext length (no padding) + a 16-byte auth
 * tag. Sized generously against MAX_MESSAGE_TEXT_LENGTH worst-case UTF-8
 * expansion (4 bytes/char) plus margin, while staying well under
 * MAX_PROTOBUF_SIZE.
 */
export const MAX_E2E_CIPHERTEXT_LENGTH = MAX_MESSAGE_TEXT_LENGTH * 4 + 64
export const AEAD_NONCE_LENGTH = 12
export const X25519_PUBLIC_KEY_LENGTH = 32
export const CHANNEL_KEY_LENGTH = 32

export const DEFAULT_SERVER_PORT = 3456

/** Java DefaultData header: 1 (msgType) + 4 (bodyLen) + 8 (timestamp). */
export const LEGACY_HEADER_LENGTH = 13
