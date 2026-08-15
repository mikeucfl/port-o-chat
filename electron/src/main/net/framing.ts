import { MAX_FRAME_SIZE } from '@shared/constants'

/**
 * Thrown when a byte stream violates the outer frame format. The only safe
 * response is to close that connection — TCP gives no reliable way to
 * resynchronize on a corrupt length-prefixed stream.
 */
export class FramingError extends Error {}

/**
 * Incremental parser for the wire's outer framing: `[uint16 BE length][payload]`,
 * one message per frame. Byte-compatible with the original Java
 * ConnectionHandler (`readUnsignedShort`/`writeShort`).
 */
export class FrameStreamParser {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)

  /**
   * Feed newly received bytes. Returns zero or more complete frame payloads
   * (the bytes after the length prefix). Throws FramingError on a violation;
   * the caller must close the connection rather than keep parsing.
   */
  push(chunk: Buffer): Buffer[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])

    const frames: Buffer[] = []
    for (;;) {
      if (this.buffer.length < 2) break

      const length = this.buffer.readUInt16BE(0)
      if (length === 0) {
        throw new FramingError('zero-length frame')
      }
      if (length > MAX_FRAME_SIZE) {
        // Can't happen from a uint16 read in practice (max is 65535 ==
        // MAX_FRAME_SIZE), but keep the check explicit and future-proof.
        throw new FramingError(`declared frame length ${length} exceeds MAX_FRAME_SIZE`)
      }

      if (this.buffer.length < 2 + length) break // wait for the rest to arrive

      frames.push(Buffer.from(this.buffer.subarray(2, 2 + length)))
      this.buffer = this.buffer.subarray(2 + length)
    }
    return frames
  }

  /** Bytes currently buffered awaiting a complete frame. */
  get pendingBytes(): number {
    return this.buffer.length
  }
}

/** Wraps a payload with the uint16 BE length prefix ready to write to a socket. */
export function wrapFrame(payload: Buffer): Buffer {
  if (payload.length === 0) {
    throw new FramingError('cannot wrap an empty payload')
  }
  if (payload.length > MAX_FRAME_SIZE) {
    throw new FramingError(`payload length ${payload.length} exceeds MAX_FRAME_SIZE`)
  }
  const header = Buffer.alloc(2)
  header.writeUInt16BE(payload.length, 0)
  return Buffer.concat([header, payload])
}
