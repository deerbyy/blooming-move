import type { GardenZoneId } from '../game/garden'

type Patch = readonly [number, number, number, number]
// Coordinates follow the 1536×1024 painting, including its cover-crop on phones.
const foliage: Record<GardenZoneId, readonly Patch[]> = {
  warm: [[0, 0, 19, 19], [66, 0, 18, 39], [0, 80, 20, 20]],
  rose: [[0, 76, 28, 24], [79, 77, 21, 23], [56, 0, 15, 21]],
  lily: [[0, 0, 25, 24], [84, 12, 16, 25], [0, 78, 24, 22]],
  moon: [[36, 0, 14, 23], [0, 75, 20, 25], [85, 74, 15, 26]],
  dome: [[22, 0, 21, 21], [63, 5, 20, 26], [80, 79, 20, 21]]
}

function specks(count: number, kind: string, seed: number): string {
  return Array.from({ length: count }, (_, i) => {
    const x = (i * 37 + seed * 13) % 100
    const y = (i * 61 + seed * 7) % 100
    const duration = kind === 'petal' ? 22 + i % 9 : 17 + i % 19
    return `<i class="ambient-${kind}" style="--x:${x}%;--y:${y}%;--size:${kind === 'petal' ? 7 + i % 5 : 2 + i % 3}px;--duration:${duration}s;--delay:-${(i * 7.13 + seed) % duration}s;--drift:${18 + i % 7 * 7}px;--spin:${i * 43}deg"></i>`
  }).join('')
}

/** Decorative layers reuse the original painting; no game RNG, input or timers. */
export function gardenAtmosphere(zone: GardenZoneId): string {
  const seed = ['warm', 'rose', 'lily', 'moon', 'dome'].indexOf(zone) + 1
  const leaves = foliage[zone].map(([x, y, w, h], i) =>
    `<i class="ambient-foliage" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%;background-image:url('assets/art/garden-${zone}.webp');background-size:${10000 / w}% ${10000 / h}%;background-position:${x / (100 - w) * 100}% ${y / (100 - h) * 100}%;--sway:${8 + i * 2.7}s;--delay:-${i * 3.1}s"></i>`
  ).join('')
  const glints = zone === 'moon'
    ? [[20, 2], [35, 8], [54, 16], [67, 14], [75, 8], [9, 19], [47, 47], [69, 34], [82, 46], [95, 22]]
    : zone === 'lily' ? [[24, 75], [38, 91], [57, 80], [76, 78], [91, 66], [66, 90]] : [[8, 56], [28, 81], [63, 88], [90, 60]]
  const sparkle = glints.map(([x, y], i) => `<i class="ambient-glint" style="left:${x}%;top:${y}%;--duration:${4.5 + i % 4 * 1.3}s;--delay:-${i * 1.37}s"></i>`).join('')
  const water = zone === 'lily' ? `<div class="ambient-water">${[0, 1, 2].map(i => `<i style="left:${30 + i * 24}%;top:${67 + i % 2 * 15}%;--delay:-${i * 2.7}s"></i>`).join('')}</div>` : ''
  const lanterns = zone === 'moon' ? [[15, 54], [73, 54], [91, 60]] : zone === 'dome' ? [[3, 61]] : zone === 'rose' ? [[95, 59]] : []
  return `<div class="garden-atmosphere atmosphere-${zone}" aria-hidden="true"><div class="ambient-stage">
    ${leaves}<div class="ambient-light"><i></i><i></i></div>
    <div class="ambient-motes">${specks(zone === 'moon' ? 24 : 34, 'dust', seed)}</div>
    ${zone === 'rose' || zone === 'dome' ? `<div class="ambient-petals">${specks(7, 'petal', seed)}</div>` : ''}
    ${zone === 'moon' ? `<div class="ambient-snow">${specks(30, 'snowflake', seed)}</div>` : ''}
    ${water}${sparkle}${lanterns.map(([x, y], i) => `<i class="ambient-lantern" style="left:${x}%;top:${y}%;--delay:-${i * 1.6}s"></i>`).join('')}
  </div></div>`
}
