import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { solidCircleDot } from './badgeIcon'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

describe('solidCircleDot', () => {
  it('produces a well-formed PNG with the correct signature and IHDR', () => {
    const size = 16
    const png = solidCircleDot(size, 218, 55, 60)

    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE)

    // IHDR is always the first chunk, immediately after the signature:
    // [4 length][4 "IHDR"][13 data][4 crc]
    const ihdrType = png.subarray(12, 16).toString('ascii')
    expect(ihdrType).toBe('IHDR')
    const width = png.readUInt32BE(16)
    const height = png.readUInt32BE(20)
    expect(width).toBe(size)
    expect(height).toBe(size)
    const bitDepth = png[24]
    const colorType = png[25]
    expect(bitDepth).toBe(8)
    expect(colorType).toBe(6) // RGBA
  })

  it('the compressed pixel data decompresses to exactly width*height*(1+4*width) bytes', () => {
    const size = 20
    const png = solidCircleDot(size, 100, 150, 200)

    // Locate the IDAT chunk generically rather than hardcoding an offset,
    // since IHDR's chunk length is fixed (13) but being explicit here
    // keeps this test honest about the real PNG structure.
    const ihdrLength = png.readUInt32BE(8)
    expect(ihdrLength).toBe(13)
    const idatStart = 8 + 12 + ihdrLength // signature offset + IHDR chunk header/crc + data
    const idatDataLength = png.readUInt32BE(idatStart)
    const idatType = png.subarray(idatStart + 4, idatStart + 8).toString('ascii')
    expect(idatType).toBe('IDAT')
    const idatData = png.subarray(idatStart + 8, idatStart + 8 + idatDataLength)

    const raw = inflateSync(idatData)
    expect(raw.length).toBe(size * (1 + size * 4))
  })

  it('produces some fully transparent pixels (outside the circle) and some fully opaque ones (inside)', () => {
    const size = 16
    const png = solidCircleDot(size, 218, 55, 60)
    const ihdrLength = png.readUInt32BE(8)
    const idatStart = 8 + 12 + ihdrLength
    const idatDataLength = png.readUInt32BE(idatStart)
    const idatData = png.subarray(idatStart + 8, idatStart + 8 + idatDataLength)
    const raw = inflateSync(idatData)

    const rowLength = 1 + size * 4
    const alphas: number[] = []
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        alphas.push(raw[y * rowLength + 1 + x * 4 + 3]!)
      }
    }
    expect(alphas).toContain(0)
    expect(alphas).toContain(255)
  })
})
