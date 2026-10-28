/**
 * Emits the PWA icons as real PNGs with zero dependencies.
 *
 * Why a script instead of checked-in binaries: icons are the kind of file that silently rots,
 * and a generated solid mark is easy to replace later. Run `pnpm icons`.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = 'apps/pwa/static'

const BG = [0x0b, 0x0d, 0x10]
const FG = [0x4e, 0xa8, 0xff]

const crcTable = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}

/**
 * A cross-out mark: two thick diagonals through the centre. `inset` keeps maskable icons
 * inside the safe zone.
 */
function render(size, inset) {
  const raw = Buffer.alloc(size * (size * 3 + 1))
  const stroke = size * 0.055
  const lo = size * inset
  const hi = size * (1 - inset)
  const mid = size / 2

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 3 + 1)
    raw[rowStart] = 0 // filter type: none
    for (let x = 0; x < size; x += 1) {
      const inBox = x >= lo && x <= hi && y >= lo && y <= hi
      const d1 = Math.abs(x - y) / Math.SQRT2
      const d2 = Math.abs(x + y - (size - 1)) / Math.SQRT2
      const onStroke = inBox && (d1 < stroke || d2 < stroke)
      const color = onStroke ? FG : BG
      const o = rowStart + 1 + x * 3
      raw[o] = color[0]
      raw[o + 1] = color[1]
      raw[o + 2] = color[2]
    }
  }

  void mid
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT, { recursive: true })

const outputs = [
  ['icon-192.png', 192, 0.12],
  ['icon-512.png', 512, 0.12],
  ['icon-maskable-512.png', 512, 0.22],
]

for (const [name, size, inset] of outputs) {
  const png = render(size, inset)
  writeFileSync(join(OUT, name), png)
  console.log(`[icons] ${name} (${size}x${size}, ${png.length} bytes)`)
}
