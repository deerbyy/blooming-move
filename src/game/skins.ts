import type { PieceColor, FigureSkinId, PlayerProgress } from './types'
export type { FigureSkinId } from './types'

export type SkinLocale = 'ru' | 'en'

export interface FigureSkinText {
  readonly ru: string
  readonly en: string
}

export interface FigureSkin {
  readonly id: FigureSkinId
  /** Lifetime rewarded-video count needed for this skin. Nothing is spent. */
  readonly requiredAds: number
  readonly name: FigureSkinText
  readonly description: FigureSkinText
  /** Asset directory prefix, without the colour suffix or extension. */
  readonly textureBase: string
}

/**
 * Cosmetic piece treatments. The first skin points at the existing assets;
 * the remaining prefixes reserve a stable, easy-to-package asset convention:
 * public/art/skins/<skin>-<colour>.webp.
 */
export const FIGURE_SKINS: readonly FigureSkin[] = [
  {
    id: 'classic',
    requiredAds: 0,
    name: { ru: 'Классика', en: 'Classic' },
    description: { ru: 'Тёплые садовые цветы', en: 'Warm garden flowers' },
    textureBase: 'art/tile'
  },
  {
    id: 'rose',
    requiredAds: 10,
    name: { ru: 'Розовый сад', en: 'Rose garden' },
    description: { ru: 'Нежные лепестки и мягкое сияние', en: 'Soft petals with a gentle glow' },
    textureBase: 'art/skins/rose'
  },
  {
    id: 'orchid',
    requiredAds: 25,
    name: { ru: 'Орхидея', en: 'Orchid' },
    description: { ru: 'Глубокие оттенки и бархатные лепестки', en: 'Deep colours and velvety petals' },
    textureBase: 'art/skins/orchid'
  },
  {
    id: 'crystal',
    requiredAds: 45,
    name: { ru: 'Хрустальный сад', en: 'Crystal garden' },
    description: { ru: 'Светящиеся цветы с хрустальным блеском', en: 'Glowing flowers with a crystal shimmer' },
    textureBase: 'art/skins/crystal'
  },
  {
    id: 'lotus',
    requiredAds: 70,
    name: { ru: 'Лотос', en: 'Lotus' },
    description: { ru: 'Спокойный цветок утреннего пруда', en: 'A calm flower from the morning pond' },
    textureBase: 'art/skins/lotus'
  }
]

const SKIN_BY_ID: ReadonlyMap<FigureSkinId, FigureSkin> = new Map(
  FIGURE_SKINS.map(skin => [skin.id, skin])
)

function counter(value: number | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

/** A corrupt, negative or fractional ad count cannot grant a cosmetic unlock. */
export function normalizeRewardedAdsWatched(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

/** Alias kept intentionally small for callers that refer to this as a reward count. */
export const normalizeRewardedCount = normalizeRewardedAdsWatched

export function isFigureSkinId(value: unknown): value is FigureSkinId {
  return SKIN_BY_ID.has(value as FigureSkinId)
}

export function figureSkin(id: FigureSkinId): FigureSkin {
  return SKIN_BY_ID.get(id) ?? FIGURE_SKINS[0]
}

export function figureSkinTexture(id: FigureSkinId, color: PieceColor): string {
  return `${figureSkin(id).textureBase}-${color}.webp`
}

export function availableFigureSkins(rewardedAdsWatched: number | undefined): readonly FigureSkin[] {
  const count = counter(rewardedAdsWatched)
  return FIGURE_SKINS.filter(skin => skin.requiredAds <= count)
}

export function canSelectFigureSkin(rewardedAdsWatched: number | undefined, id: unknown): id is FigureSkinId {
  const count = counter(rewardedAdsWatched)
  return isFigureSkinId(id) && figureSkin(id).requiredAds <= count
}

export function selectedFigureSkin(profile: Pick<PlayerProgress, 'rewardedAdsWatched' | 'selectedSkin'>): FigureSkinId {
  return canSelectFigureSkin(profile.rewardedAdsWatched, profile.selectedSkin) ? profile.selectedSkin : 'classic'
}

function selectionTimestamp(value: number | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

/** Select an already unlocked cosmetic without spending the shared ad count. */
export function selectFigureSkin(
  profile: PlayerProgress,
  id: unknown,
  now = Date.now()
): PlayerProgress {
  if (!canSelectFigureSkin(profile.rewardedAdsWatched, id) || profile.selectedSkin === id) return profile
  const previous = selectionTimestamp(profile.skinSelectedAt)
  const requested = typeof now === 'number' && Number.isSafeInteger(now) && now >= 0 ? now : Date.now()
  return {
    ...profile,
    selectedSkin: id,
    skinSelectedAt: Math.max(Math.min(Number.MAX_SAFE_INTEGER, previous + 1), requested)
  }
}

export interface FigureSkinGoal {
  readonly skin: FigureSkin
  /** Count earned since the preceding unlock threshold. */
  readonly current: number
  readonly required: number
  readonly remaining: number
  /** Fraction between 0 and 1; null means every skin is unlocked. */
  readonly progress: number
}

export function nextFigureSkinGoal(rewardedAdsWatched: number | undefined): FigureSkinGoal | null {
  const count = counter(rewardedAdsWatched)
  const index = FIGURE_SKINS.findIndex(skin => skin.requiredAds > count)
  if (index < 0) return null
  const skin = FIGURE_SKINS[index]
  const previous = FIGURE_SKINS[index - 1]?.requiredAds ?? 0
  const required = skin.requiredAds - previous
  const current = count - previous
  return {
    skin,
    current,
    required,
    remaining: skin.requiredAds - count,
    progress: current / required
  }
}
