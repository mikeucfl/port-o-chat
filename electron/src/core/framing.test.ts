import { describe, expect, it } from 'vitest'
import { FrameStreamParser, FramingError, wrapFrame } from './framing'
import { MAX_FRAME_SIZE } from '@shared/constants'

describe('wrapFrame / FrameStreamParser round trip', () => {
  it('round-trips a single small frame', () => {
    const payload = Buffer.from('hello world')
    const wire = wrapFrame(payload)
    const parser = new FrameStreamParser()
    const frames = parser.push(wire)
    expect(frames).toHaveLength(1)
    expect(frames[0]).toEqual(payload)
  })

  it('handles a frame split across multiple TCP chunks', () => {
    const payload = Buffer.from('a-somewhat-longer-payload-for-splitting-purposes')
    const wire = wrapFrame(payload)
    const parser = new FrameStreamParser()

    const part1 = wire.subarray(0, 5)
    const part2 = wire.subarray(5)

    expect(parser.push(part1)).toHaveLength(0)
    expect(parser.pendingBytes).toBe(5)
    const frames = parser.push(part2)
    expect(frames).toHaveLength(1)
    expect(frames[0]).toEqual(payload)
  })

  it('handles multiple frames arriving in one chunk', () => {
    const p1 = Buffer.from('one')
    const p2 = Buffer.from('two')
    const wire = Buffer.concat([wrapFrame(p1), wrapFrame(p2)])
    const parser = new FrameStreamParser()
    const frames = parser.push(wire)
    expect(frames).toHaveLength(2)
    expect(frames[0]).toEqual(p1)
    expect(frames[1]).toEqual(p2)
  })

  it('rejects wrapping an oversized payload', () => {
    const oversized = Buffer.alloc(MAX_FRAME_SIZE + 1)
    expect(() => wrapFrame(oversized)).toThrow(FramingError)
  })

  it('rejects wrapping an empty payload', () => {
    expect(() => wrapFrame(Buffer.alloc(0))).toThrow(FramingError)
  })

  it('rejects a declared zero-length frame from the wire', () => {
    const parser = new FrameStreamParser()
    const malicious = Buffer.from([0x00, 0x00])
    expect(() => parser.push(malicious)).toThrow(FramingError)
  })

  it('accepts a frame at exactly MAX_FRAME_SIZE', () => {
    const payload = Buffer.alloc(MAX_FRAME_SIZE, 0x42)
    const wire = wrapFrame(payload)
    const parser = new FrameStreamParser()
    const frames = parser.push(wire)
    expect(frames).toHaveLength(1)
    expect(frames[0]!.length).toBe(MAX_FRAME_SIZE)
  })
})
