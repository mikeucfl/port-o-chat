import { deflateSync } from 'node:zlib'

// A tiny, dependency-free PNG encoder used only to draw a small solid-color
// circle for the Windows taskbar overlay icon (nativeImage reliably
// supports PNG; it does not reliably support SVG across Electron versions,
// and adding an image-processing dependency for one small dot felt like
// overkill).

const CRC_TABLE = buildCrcTable()

function buildCrcTable(): number[] {
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buf) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crc])
}

/** Renders a solid-color filled circle (RGBA) as a raw PNG buffer. */
export function solidCircleDot(size: number, r: number, g: number, b: number): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(size, 0)
  ihdrData.writeUInt32BE(size, 4)
  ihdrData[8] = 8 // bit depth
  ihdrData[9] = 6 // color type: RGBA
  const ihdr = pngChunk('IHDR', ihdrData)

  const rowLength = 1 + size * 4
  const raw = Buffer.alloc(rowLength * size)
  const center = (size - 1) / 2
  const radius = size / 2
  for (let y = 0; y < size; y++) {
    const rowStart = y * rowLength
    raw[rowStart] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const dx = x - center
      const dy = y - center
      const inside = dx * dx + dy * dy <= radius * radius
      const px = rowStart + 1 + x * 4
      raw[px] = r
      raw[px + 1] = g
      raw[px + 2] = b
      raw[px + 3] = inside ? 255 : 0
    }
  }

  const idat = pngChunk('IDAT', deflateSync(raw))
  const iend = pngChunk('IEND', Buffer.alloc(0))
  return Buffer.concat([signature, ihdr, idat, iend])
}
