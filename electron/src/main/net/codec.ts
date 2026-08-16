import { LEGACY_HEADER_LENGTH, MAX_PROTOBUF_SIZE } from '@shared/constants'
import { portochat } from '@proto/portochat'
import { wrapFrame } from './framing'

/**
 * Thrown for anything wrong inside a frame's payload (bad header, size
 * mismatch, undecodable protobuf, unsupported flag/type). Like FramingError,
 * the only safe response is to close the connection — never guess at
 * recovery.
 */
export class CodecError extends Error {}

const MSG_TYPE_PROTO_MESSAGE = 0x00

/**
 * Minimum possible payload: 1 (encryption flag) + 13 (legacy DefaultData
 * header: msgType + bodyLen + timestamp) + 4 (protobuf length prefix).
 */
const MIN_PAYLOAD_LENGTH = 1 + LEGACY_HEADER_LENGTH + 4

/**
 * Encodes a PortoChatMessage into the exact byte layout the Java
 * ConnectionHandler/DefaultData/ProtoMessage classes read, wrapped with the
 * outer length prefix and ready to write to a socket.
 *
 * Always writes encryption flag = 0 (plaintext). This app never implements
 * the legacy RSA/AES transport handshake (see PORTING-NOTES.md) — E2E
 * encryption, when used, lives inside the protobuf payload itself.
 */
export function encodeFrame(message: portochat.IPortoChatMessage): Buffer {
  const protobufBytes = portochat.PortoChatMessage.encode(message).finish()
  if (protobufBytes.length > MAX_PROTOBUF_SIZE) {
    throw new CodecError(
      `protobuf payload of ${protobufBytes.length} bytes exceeds MAX_PROTOBUF_SIZE`
    )
  }

  const bodyLen = LEGACY_HEADER_LENGTH + 4 + protobufBytes.length
  const payload = Buffer.alloc(1 + LEGACY_HEADER_LENGTH + 4 + protobufBytes.length)
  let offset = 0
  payload.writeUInt8(0, offset) // encryption flag: always plaintext
  offset += 1
  payload.writeUInt8(MSG_TYPE_PROTO_MESSAGE, offset)
  offset += 1
  payload.writeInt32BE(bodyLen, offset)
  offset += 4
  payload.writeBigInt64BE(BigInt(Date.now()), offset)
  offset += 8
  payload.writeInt32BE(protobufBytes.length, offset)
  offset += 4
  Buffer.from(protobufBytes).copy(payload, offset)

  return wrapFrame(payload)
}

/**
 * Decodes one frame payload (post outer-length-prefix, as produced by
 * FrameStreamParser) into a PortoChatMessage. Validates every length field
 * against the others before trusting any of them — every inbound frame is
 * treated as hostile input.
 */
export function decodeFrame(payload: Buffer): portochat.PortoChatMessage {
  if (payload.length < MIN_PAYLOAD_LENGTH) {
    throw new CodecError(`frame payload of ${payload.length} bytes is too short`)
  }

  let offset = 0
  const flag = payload.readUInt8(offset)
  offset += 1
  if (flag !== 0) {
    // We never send SetUserPublicKey/enable the legacy handshake, so a
    // correctly-behaving peer never has a reason to encrypt traffic to us.
    // Don't attempt to decrypt — treat it as an unsupported/hostile frame.
    throw new CodecError(`unsupported encryption flag ${flag}`)
  }

  const msgType = payload.readUInt8(offset)
  offset += 1
  if (msgType !== MSG_TYPE_PROTO_MESSAGE) {
    throw new CodecError(`unknown message type ${msgType}`)
  }

  const bodyLen = payload.readInt32BE(offset)
  offset += 4
  offset += 8 // timestamp: informational only, not validated

  const protobufLen = payload.readInt32BE(offset)
  offset += 4

  if (protobufLen < 0 || protobufLen > MAX_PROTOBUF_SIZE) {
    throw new CodecError(`protobuf length ${protobufLen} out of bounds`)
  }
  const expectedBodyLen = LEGACY_HEADER_LENGTH + 4 + protobufLen
  if (bodyLen !== expectedBodyLen) {
    throw new CodecError(`bodyLen ${bodyLen} does not match expected ${expectedBodyLen}`)
  }
  if (offset + protobufLen !== payload.length) {
    throw new CodecError(
      `declared protobuf length ${protobufLen} does not match remaining payload size`
    )
  }

  const protobufBytes = payload.subarray(offset, offset + protobufLen)
  try {
    return portochat.PortoChatMessage.decode(protobufBytes)
  } catch (err) {
    throw new CodecError(`failed to decode protobuf payload: ${(err as Error).message}`)
  }
}
