import { describe, expect, it } from 'vitest'
import {
  availableFigureSkins,
  canSelectFigureSkin,
  FIGURE_SKINS,
  figureSkinTexture,
  isFigureSkinId,
  nextFigureSkinGoal,
  normalizeRewardedAdsWatched,
  selectFigureSkin,
  selectedFigureSkin
} from './skins'
import { defaultProgress } from './storage'

describe('cosmetic figure skins', () => {
  it('keeps the cumulative unlock order and thresholds stable', () => {
    expect(FIGURE_SKINS.map(({ id, requiredAds }) => ({ id, requiredAds }))).toEqual([
      { id: 'classic', requiredAds: 0 },
      { id: 'rose', requiredAds: 10 },
      { id: 'orchid', requiredAds: 25 },
      { id: 'crystal', requiredAds: 45 },
      { id: 'lotus', requiredAds: 70 }
    ])
  })

  it('keeps each themed skin paired with its matching garden scene', () => {
    expect(Object.fromEntries(FIGURE_SKINS.filter(skin => skin.gardenZone).map(skin => [skin.id, skin.gardenZone]))).toEqual({
      rose: 'rose',
      orchid: 'dome',
      crystal: 'moon',
      lotus: 'lily'
    })
  })

  it.each([[0, 1], [9, 1], [10, 2], [24, 2], [25, 3], [44, 3], [45, 4], [69, 4], [70, 5], [999, 5]])(
    'unlocks only the earned skins at %i rewarded views', (count, expected) => {
      expect(availableFigureSkins(count)).toHaveLength(expected)
    }
  )

  it('uses the existing classic tiles and predictable prefixes for new assets', () => {
    expect(figureSkinTexture('classic', 'coral')).toBe('art/tile-coral.webp')
    expect(figureSkinTexture('rose', 'coral')).toBe('art/skins/rose-coral.webp')
    expect(figureSkinTexture('lotus', 'sky')).toBe('art/skins/lotus-sky.webp')
  })

  it('reports the next cumulative goal without spending the count', () => {
    expect(nextFigureSkinGoal(0)).toMatchObject({ skin: FIGURE_SKINS[1], current: 0, required: 10, remaining: 10, progress: 0 })
    expect(nextFigureSkinGoal(17)).toMatchObject({ skin: FIGURE_SKINS[2], current: 7, required: 15, remaining: 8, progress: 7 / 15 })
    expect(nextFigureSkinGoal(45)).toMatchObject({ skin: FIGURE_SKINS[4], current: 0, required: 25, remaining: 25, progress: 0 })
    expect(nextFigureSkinGoal(70)).toBeNull()
  })

  it('normalizes malformed shared reward counts and rejects unknown IDs', () => {
    for (const value of [undefined, null, -1, 1.5, Infinity, '10', {}]) {
      expect(normalizeRewardedAdsWatched(value)).toBe(0)
    }
    expect(normalizeRewardedAdsWatched(25)).toBe(25)
    expect(isFigureSkinId('classic')).toBe(true)
    expect(isFigureSkinId('neon')).toBe(false)
  })

  it('selects only an unlocked cosmetic and leaves the shared ad count untouched', () => {
    const profile = { ...defaultProgress(), rewardedAdsWatched: 25 }
    const selected = selectFigureSkin(profile, 'orchid', 100)
    expect(selected).toMatchObject({ rewardedAdsWatched: 25, selectedSkin: 'orchid', skinSelectedAt: 100 })
    expect(profile.selectedSkin).toBe('classic')
    expect(selectedFigureSkin(selected)).toBe('orchid')
    expect(selectFigureSkin(selected, 'orchid', 200)).toBe(selected)
    expect(selectFigureSkin(profile, 'crystal', 200)).toBe(profile)
  })

  it('keeps explicit selection ordering monotonic when the clock moves backwards', () => {
    const profile = { ...defaultProgress(), rewardedAdsWatched: 10, selectedSkin: 'rose' as const, skinSelectedAt: 500 }
    expect(selectFigureSkin(profile, 'classic', 100).skinSelectedAt).toBe(501)
  })

  it('falls back to classic for missing, locked or malformed selections', () => {
    expect(selectedFigureSkin(defaultProgress())).toBe('classic')
    expect(selectedFigureSkin({ rewardedAdsWatched: 9, selectedSkin: 'rose' })).toBe('classic')
    expect(selectedFigureSkin({ rewardedAdsWatched: 70, selectedSkin: 'lotus' })).toBe('lotus')
  })

  it('never lets a corrupt count unlock a skin', () => {
    expect(canSelectFigureSkin(-1, 'rose')).toBe(false)
    expect(canSelectFigureSkin(10, 'rose')).toBe(true)
    expect(canSelectFigureSkin(9, 'rose')).toBe(false)
  })
})
