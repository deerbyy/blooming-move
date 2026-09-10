import type { Locale } from '../i18n'
import { GARDEN_ZONES } from '../game/garden'

export const gardenNames: Record<Locale, string[]> = {
  ru: ['Тёплая грядка', 'Розовая галерея', 'Пруд кувшинок', 'Лунный зимний сад', 'Купол цветов'],
  en: ['Warm bed', 'Rose gallery', 'Lily pond', 'Moon conservatory', 'Flower dome']
}
export const gardenDescriptions: Record<Locale, string[]> = {
  ru: [
    'Солнечный свет, терракотовые горшки и первые золотые цветы.',
    'Цветущие арки, розовые лепестки и мягкий персиковый свет.',
    'Прохладная зелень, гладь пруда и бирюзовые кувшинки.',
    'Лунный свет, тёплые фонари и сиреневые цветы под стеклом.',
    'Цветочный купол: все краски сада в золотом вечернем свете.'
  ],
  en: [
    'Sunshine, terracotta pots and your first golden flowers.',
    'Flowering arches, rose petals and soft peach light.',
    'Cool greenery, a still pond and turquoise water lilies.',
    'Moonlight, warm lanterns and violet flowers beneath the glass.',
    'A floral dome: every garden colour in golden evening light.'
  ]
}

/** The preview and the selected game background use the very same painting. */
export function gardenScene(index: number): string {
  const zone = GARDEN_ZONES[index]?.id ?? 'warm'
  return `<img class="garden-scene-art garden-scene-${zone}" src="assets/art/garden-${zone}.webp" alt="" decoding="async" width="1536" height="1024">`
}
