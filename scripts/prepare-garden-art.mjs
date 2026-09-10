// Optimise already generated paintings; no generation API or new dependencies.
// Usage: BLOOM_SHARP=/path/to/sharp node scripts/prepare-garden-art.mjs /source/directory
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { access } from 'node:fs/promises'
const require = createRequire(import.meta.url)
const sharp = require(process.env.BLOOM_SHARP || 'sharp')
const source = process.argv[2]
if (!source) throw new Error('Supply the directory containing the generated PNGs.')
const paintings = {
  warm: 'exec-a0eed4fc-591b-4f11-a049-abd3bfc2db80.png',
  rose: 'exec-02d3cb3a-7f0f-4b3a-8718-80f8715bd71f.png',
  lily: 'exec-f2a1cae9-07ab-4871-9dce-e93856575919.png',
  moon: 'exec-fef192ea-1ed4-4d86-a6f8-bc450f53afad.png',
  dome: 'exec-2caa7687-e9bf-47d3-a7d4-a9c7b68b6f90.png'
}
for (const [zone, file] of Object.entries(paintings)) {
  const target = resolve(`public/assets/art/garden-${zone}.webp`)
  const exists = await access(target).then(() => true, () => false)
  if (exists) { console.log(`Preserved existing ${target}`); continue }
  const info = await sharp(resolve(source, file)).resize({ width: 1536, withoutEnlargement: true }).webp({ quality: 85 }).toFile(target)
  console.log(`${zone}: ${info.width}×${info.height}, ${info.size} bytes`)
}
