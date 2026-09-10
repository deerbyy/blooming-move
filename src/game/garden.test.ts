import { describe, expect, it } from 'vitest'
import { availableGardenZones, canSelectGardenZone, GARDEN_ZONES, nectarForRun, nextGardenGoal, selectGardenZone, selectedGardenZone } from './garden'
import { defaultProgress } from './storage'

describe('cosmetic greenhouse progression', () => {
  it('keeps exactly five zones and the established nectar thresholds', () => {
    expect(GARDEN_ZONES).toEqual([
      { id: 'warm', nectar: 0 }, { id: 'rose', nectar: 300 },
      { id: 'lily', nectar: 800 }, { id: 'moon', nectar: 1500 }, { id: 'dome', nectar: 2500 }
    ])
  })

  it.each([[0, 1], [299, 1], [300, 2], [799, 2], [800, 3], [1499, 3], [1500, 4], [2499, 4], [2500, 5], [9999, 5]])(
    'unlocks exactly the earned zones at %i nectar', (nectar, count) => {
      expect(availableGardenZones(nectar)).toHaveLength(count)
    }
  )

  it('measures the next unlock from the preceding threshold without resetting lifetime nectar', () => {
    expect(nextGardenGoal(0)).toEqual({ zone: GARDEN_ZONES[1], current: 0, required: 300, remaining: 300, progress: 0 })
    expect(nextGardenGoal(550)).toEqual({ zone: GARDEN_ZONES[2], current: 250, required: 500, remaining: 250, progress: .5 })
    expect(nextGardenGoal(1500)).toEqual({ zone: GARDEN_ZONES[4], current: 0, required: 1000, remaining: 1000, progress: 0 })
    expect(nextGardenGoal(2500)).toBeNull()
  })

  it('selects an unlocked cosmetic without spending nectar or changing records', () => {
    const original = { ...defaultProgress(), nectar: 800, bestScore: 1600, completedRuns: 12, dailyScores: { '2026-09-09': 900 } }
    const selected = selectGardenZone(original, 'lily', 100)
    expect(selected).toEqual({ ...original, selectedGarden: 'lily', gardenSelectedAt: 100 })
    expect(selectedGardenZone(selected)).toBe('lily')
    expect(original.selectedGarden).toBe('warm')
    expect(selectGardenZone(selected, 'lily', 200)).toBe(selected)
  })

  it('cannot select a locked or unknown scene', () => {
    const profile = { ...defaultProgress(), nectar: 299 }
    for (const id of ['rose', 'lily', 'moon', 'dome', 'unknown', null]) {
      expect(canSelectGardenZone(profile.nectar, id)).toBe(false)
      expect(selectGardenZone(profile, id, 100)).toBe(profile)
    }
  })

  it('does not automatically switch an explicitly chosen scene after an unlock', () => {
    const profile = selectGardenZone({ ...defaultProgress(), nectar: 300 }, 'rose', 100)
    expect(selectedGardenZone({ ...profile, nectar: 2500 })).toBe('rose')
  })

  it('resolves legacy and invalid locked selections to the freely available warm garden', () => {
    const legacy = { ...defaultProgress(), nectar: 900 }
    delete legacy.selectedGarden
    delete legacy.gardenSelectedAt
    expect(selectedGardenZone(legacy)).toBe('warm')
    expect(selectedGardenZone({ ...legacy, selectedGarden: 'dome' })).toBe('warm')
  })

  it('keeps explicit selections newer even when the device clock moves backwards', () => {
    const original = { ...defaultProgress(), nectar: 300, gardenSelectedAt: 500 }
    expect(selectGardenZone(original, 'rose', 100).gardenSelectedAt).toBe(501)
  })

  it.each([[0, 0, 5], [24, 0, 5], [125, 0, 5], [150, 0, 6], [1000, 2, 48], [4870, 4, 210]])(
    'preserves the existing completed-run reward for score %i and combo %i', (score, combo, expected) => {
      expect(nectarForRun(score, combo)).toBe(expected)
    }
  )

  it('does not propagate corrupt counters into the cosmetic progress UI', () => {
    expect(availableGardenZones(NaN)).toEqual([GARDEN_ZONES[0]])
    expect(nextGardenGoal(-1)?.remaining).toBe(300)
    expect(nectarForRun(Infinity, NaN)).toBe(5)
  })
})
