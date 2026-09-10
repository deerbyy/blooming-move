import type { GardenZoneId, PlayerProgress } from './types'
export type { GardenZoneId } from './types'

export interface GardenZone {
  readonly id: GardenZoneId
  readonly nectar: number
}

/** Nectar is lifetime progress, not a wallet: choosing a scene never spends it. */
export const GARDEN_ZONES: readonly GardenZone[] = [
  { id: 'warm', nectar: 0 },
  { id: 'rose', nectar: 300 },
  { id: 'lily', nectar: 800 },
  { id: 'moon', nectar: 1500 },
  { id: 'dome', nectar: 2500 }
]

function counter(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export function isGardenZoneId(value: unknown): value is GardenZoneId {
  return GARDEN_ZONES.some(zone => zone.id === value)
}

export function availableGardenZones(nectar: number): readonly GardenZone[] {
  return GARDEN_ZONES.filter(zone => zone.nectar <= counter(nectar))
}

export function canSelectGardenZone(nectar: number, id: unknown): id is GardenZoneId {
  return availableGardenZones(nectar).some(zone => zone.id === id)
}

export interface GardenGoal {
  zone: GardenZone
  /** Nectar earned since the previous zone, for an honest per-unlock meter. */
  current: number
  required: number
  remaining: number
  /** Fraction between 0 and 1; all zones open is represented by a null goal. */
  progress: number
}

export function nextGardenGoal(nectar: number): GardenGoal | null {
  const total = counter(nectar)
  const index = GARDEN_ZONES.findIndex(zone => zone.nectar > total)
  if (index < 0) return null
  const zone = GARDEN_ZONES[index]
  const previous = GARDEN_ZONES[index - 1]?.nectar ?? 0
  const current = total - previous
  const required = zone.nectar - previous
  return { zone, current, required, remaining: zone.nectar - total, progress: current / required }
}

export function selectedGardenZone(profile: PlayerProgress): GardenZoneId {
  return canSelectGardenZone(profile.nectar, profile.selectedGarden) ? profile.selectedGarden : 'warm'
}

/** No board, shape, score or unlock changes: this is strictly a visual setting. */
export function selectGardenZone(profile: PlayerProgress, id: unknown, now = Date.now()): PlayerProgress {
  if (!canSelectGardenZone(profile.nectar, id) || profile.selectedGarden === id) return profile
  const previous = counter(profile.gardenSelectedAt ?? 0)
  const nextTime = Number.isSafeInteger(now) && now >= 0 ? now : Date.now()
  return {
    ...profile,
    selectedGarden: id,
    gardenSelectedAt: Math.max(Math.min(Number.MAX_SAFE_INTEGER, previous + 1), nextTime)
  }
}

/** Keep the existing completed-run reward exactly; previews must use this too. */
export function nectarForRun(score: number, bestCombo: number): number {
  return Math.max(5, Math.floor(counter(score) / 25) + counter(bestCombo) * 4)
}
