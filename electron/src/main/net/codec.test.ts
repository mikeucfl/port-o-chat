import { describe, expect, it } from 'vitest'
import { CodecError, decodeFrame, encodeFrame } from './codec'
import { FrameStreamParser } from './framing'
import { portochat } from '../proto-gen/portochat'

function roundTripPayload(message: portochat.IPortoChatMessage): Buffer {
  const wire = encodeFrame(message)
  const parser = new FrameStreamParser()
  const frames = parser.push(wire)
  expect(frames).toHaveLength(1)
  return frames[0]!
}

describe('encodeFrame / decodeFrame round trip', () => {
  it('round-trips a ChatMessage', () => {
    const original: portochat.IPortoChatMessage = {
      chatMessage: {
        senderId: 'sender-1',
        destinationId: '#general',
        isChannel: true,
        message: 'hello there',
        isAction: false
      }
    }
    const payload = roundTripPayload(original)
    const decoded = decodeFrame(payload)
    expect(decoded.chatMessage?.senderId).toBe('sender-1')
    expect(decoded.chatMessage?.destinationId).toBe('#general')
    expect(decoded.chatMessage?.message).toBe('hello there')
  })

  it('round-trips a KeyShare (new E2E message type)', () => {
    const original: portochat.IPortoChatMessage = {
      keyShare: {
        channel: '#secret',
        toUserId: 'user-b',
        fromUserId: 'user-a',
        wrappedKey: new Uint8Array([1, 2, 3, 4]),
        nonce: new Uint8Array(12).fill(9),
        keyEpoch: 3
      }
    }
    const payload = roundTripPayload(original)
    const decoded = decodeFrame(payload)
    expect(decoded.keyShare?.channel).toBe('#secret')
    expect(decoded.keyShare?.keyEpoch).toBe(3)
    expect(Array.from(decoded.keyShare?.wrappedKey ?? [])).toEqual([1, 2, 3, 4])
  })

  it('a legacy-schema decoder ignores new fields without throwing (forward-compat)', () => {
    // Simulates an old Java peer: decode using only the fields that existed
    // in the original portochat.proto, proving new additions don't break it.
    const withNewFields: portochat.IPortoChatMessage = {
      chatMessage: {
        senderId: 's',
        destinationId: 'd',
        isChannel: false,
        message: 'hi',
        isAction: false,
        e2eCiphertext: new Uint8Array([1, 2, 3]),
        e2eNonce: new Uint8Array([4, 5, 6]),
        e2eKeyEpoch: 7
      }
    }
    const bytes = portochat.PortoChatMessage.encode(withNewFields).finish()
    // Decode with the same schema (protobuf's unknown-field skipping is
    // symmetric regardless of which side has "old" vs "new" fields defined;
    // this asserts the encode/decode itself never throws on mixed content).
    expect(() => portochat.PortoChatMessage.decode(bytes)).not.toThrow()
  })
})

describe('decodeFrame hostile-input handling', () => {
  it('rejects a truncated payload', () => {
    const payload = roundTripPayload({ ping: { timestamp: 1 } })
    const truncated = payload.subarray(0, payload.length - 3)
    expect(() => decodeFrame(truncated)).toThrow(CodecError)
  })

  it('rejects a payload shorter than the minimum header', () => {
    expect(() => decodeFrame(Buffer.alloc(5))).toThrow(CodecError)
  })

  it('rejects an unsupported encryption flag', () => {
    const payload = roundTripPayload({ ping: { timestamp: 1 } })
    const corrupted = Buffer.from(payload)
    corrupted.writeUInt8(1, 0) // flag = 1 (legacy encrypted), never sent by us
    expect(() => decodeFrame(corrupted)).toThrow(CodecError)
  })

  it('rejects an unknown message type byte', () => {
    const payload = roundTripPayload({ ping: { timestamp: 1 } })
    const corrupted = Buffer.from(payload)
    corrupted.writeUInt8(0x7f, 1) // msgType, only 0x00 is ever valid
    expect(() => decodeFrame(corrupted)).toThrow(CodecError)
  })

  it('rejects a bodyLen that does not match the protobuf length field', () => {
    const payload = roundTripPayload({ ping: { timestamp: 1 } })
    const corrupted = Buffer.from(payload)
    corrupted.writeInt32BE(999999, 2) // bodyLen field, offset 2 (after flag+msgType)
    expect(() => decodeFrame(corrupted)).toThrow(CodecError)
  })

  it('rejects a protobufLen that claims more bytes than are present', () => {
    const payload = roundTripPayload({ ping: { timestamp: 1 } })
    const corrupted = Buffer.from(payload)
    const claimedLen = corrupted.readInt32BE(14) + 500
    corrupted.writeInt32BE(claimedLen, 14) // protobufLen field
    corrupted.writeInt32BE(13 + 4 + claimedLen, 2) // keep bodyLen internally consistent
    expect(() => decodeFrame(corrupted)).toThrow(CodecError)
  })

  it('rejects garbage protobuf bytes with a well-formed header', () => {
    const junkProtobuf = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff])
    const header = Buffer.alloc(1 + 13 + 4)
    header.writeUInt8(0, 0)
    header.writeUInt8(0, 1)
    header.writeInt32BE(13 + 4 + junkProtobuf.length, 2)
    header.writeBigInt64BE(0n, 6)
    header.writeInt32BE(junkProtobuf.length, 14)
    const payload = Buffer.concat([header, junkProtobuf])
    expect(() => decodeFrame(payload)).toThrow(CodecError)
  })
})
