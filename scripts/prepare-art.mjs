import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const require = createRequire(import.meta.url)
const sharp = require(process.env.BLOOM_SHARP || 'sharp')
const reference = process.argv[2]
if (!reference) throw new Error('Pass the reference image path.')
const out = path.resolve('public/assets/art')
await mkdir(out, { recursive: true })

// Extract the supplied flower artwork; this is deterministic image processing, not AI generation.
const flowers = {
  sun: [470, 349, 66, 66],
  mint: [543, 349, 66, 66],
  coral: [688, 417, 67, 67],
  violet: [762, 417, 68, 67],
  sky: [760, 484, 69, 69]
}
for (const [name, [left, top, width, height]] of Object.entries(flowers)) {
  const { data, info } = await sharp(reference).extract({ left, top, width, height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = data.subarray(i, i + 3)
    const isFlower = name === 'mint' || name === 'sky' ? g + b - 2 * r > 88 && b > 68 : r > g * 1.12 || b > g * 1.18
    if (!isFlower && r < 126 && g < 150) data[i + 3] = 0
  }
  await sharp(data, { raw: info }).trim().resize(160, 160, { fit: 'contain', background: '#00000000' }).png().toFile(path.join(out, `flower-${name}.png`))
}
await sharp(reference).extract({ left: 615, top: 282, width: 69, height: 66 }).resize(128, 128).webp({ quality: 95 }).toFile(path.join(out, 'cell.webp'))
await sharp('public/assets/greenhouse-background.png').resize(1920).webp({ quality: 90 }).toFile(path.join(out, 'greenhouse.webp'))
await sharp('/Users/maksimzebenev/Downloads/blooming-move-new-textures/assets/board-background.png').resize(800).webp({ quality: 90 }).toFile(path.join(out, 'board.webp'))

// Nine-slice the existing square botanical frame so decorations never cover a playable cell.
const frame = sharp('public/assets/board-frame.png')
const metadata = await frame.metadata()
const cutsX = [0, Math.round(metadata.width * .24), Math.round(metadata.width * .76), metadata.width]
const cutsY = [0, Math.round(metadata.height * .24), Math.round(metadata.height * .76), metadata.height]
const dest = [0, 58, 966, 1024]
const slices = []
for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
  if (row === 1 && col === 1) continue
  const input = await frame.clone().extract({ left: cutsX[col], top: cutsY[row], width: cutsX[col + 1] - cutsX[col], height: cutsY[row + 1] - cutsY[row] })
    .resize(dest[col + 1] - dest[col], dest[row + 1] - dest[row], { fit: 'fill' }).png().toBuffer()
  slices.push({ input, left: dest[col], top: dest[row] })
}
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#00000000' } }).composite(slices).png().toFile(path.join(out, 'frame.png'))
await sharp('public/assets/board-frame.png').extract({ left: 45, top: 36, width: 350, height: 350 }).resize(180, 180).png().toFile(path.join(out, 'botanical.png'))
await sharp(reference).extract({ left: 228, top: 37, width: 30, height: 36 }).resize(96, 96, { fit: 'contain', background: '#00000000' }).png().toFile(path.join(out, 'favicon.png'))
console.log('Prepared reference-derived artwork in', out)
