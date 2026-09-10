// Asset assembly only: generated paintings are resized; the atlas is sliced into tiles.
// Usage: BLOOM_SHARP=/path/to/sharp node scripts/install-generated-art.mjs /path/to/generated-images
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
const require = createRequire(import.meta.url)
const sharp = require(process.env.BLOOM_SHARP || 'sharp')
const source = process.argv[2]
if (!source) throw new Error('Pass the directory containing the generated source paintings.')
const output = path.resolve('public/assets/art')
await mkdir(output, { recursive: true })
const images = [
  ['exec-eca93f4f-0b5f-4b2e-9ea6-a950359520fc.png', 'greenhouse.webp', 1536, 88],
  ['exec-15c5294a-c919-45c7-a994-e307dcfaf60a.png', 'frame.webp', 1254, 95],
  ['exec-58e9d5b1-10f6-425d-bdc6-6edfe4c2e3d4.png', 'board.webp', 800, 88],
  ['exec-3730774e-a31f-4075-aaea-804f589fb745.png', 'cell.webp', 160, 95],
  ['exec-12d77297-16ed-4259-b83e-c6a1531d3a60.png', 'paper.webp', 512, 82]
]
for (const [file, name, width, quality] of images) {
  await sharp(path.join(source, file)).resize(width).webp({ quality, alphaQuality: 100 }).toFile(path.join(output, name))
}
const atlas = path.join(source, 'exec-6dd7e935-d696-48f0-89bf-69b04af890f4.png')
const flowers = [
  ['mint', 92, 78, 352], ['coral', 582, 78, 372], ['sun', 1070, 78, 372],
  ['violet', 92, 558, 352], ['sky', 582, 558, 372]
]
for (const [color, left, top, width] of flowers) {
  await sharp(atlas).extract({ left, top, width, height: 366 }).resize(192, 192).webp({ quality: 94, alphaQuality: 100 }).toFile(path.join(output, `tile-${color}.webp`))
}
console.log('Installed 10 optimized generated textures in public/assets/art.')
