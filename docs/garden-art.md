# Пять сцен оранжереи

Сгенерированы встроенным ImageGen 9 сентября 2026, подключены 10 сентября после возобновления работы. CLI/API fallback не использовался. Все изображения самостоятельные, без нарисованного интерфейса; превью и фон игры используют один файл. Оригинальный `greenhouse.webp` сохранён как запасной фон.

## Готовые ассеты

Файлы находятся в `public/assets/art/`, размер каждого — 1536×1024:

- `garden-warm.webp` — солнечная грядка, золотые цветы; 227758 байт.
- `garden-rose.webp` — галерея цветущих розовых арок; 281446 байт.
- `garden-lily.webp` — пруд с кувшинками; 289602 байт.
- `garden-moon.webp` — лунная оранжерея с фонарями; 346222 байт.
- `garden-dome.webp` — цветочный купол в вечернем свете; 348614 байт.

Суммарно около 1,5 МБ. `scripts/prepare-garden-art.mjs` выполняет только оптимизацию готовых PNG в WebP (quality 85), не меняет композицию и не перезаписывает существующие файлы. Имена исходных генераций записаны в скрипте. Рисунки не встроены в JavaScript и включаются Vite в публикационную сборку как обычные локальные ресурсы.

## Текстовые спецификации для повторной генерации

После прерывания сеанса сохранились готовые изображения, но не исходный набор промптов в оперативном хранилище. Ниже восстановленное ТЗ, **не дословный журнал генерации**.

Общие условия для каждой отдельной сцены:

Use case: stylized-concept. Asset type: standalone 1536×1024 background painting for the cozy flower block-puzzle “Blooming Move”. Match the user's greenhouse reference: premium dimensional painterly 2D casual-game art, warm ivory architecture, tangible wood and ceramic textures, organic saturated plants, soft natural light. Keep the middle of the scene calm for an independently rendered game board and interface. Flowers and foliage frame the edges. No interface, grid, lettering, logos, watermark or people. Plants must look richly illustrated, not flat SVG icons. Create one full-width scene, not a contact sheet.

### Тёплая грядка

Sunlit cream greenhouse wall, honey-coloured wooden tabletop along the bottom, golden and ivory flowers in terracotta pots around the edges, dappled leaf shadows and warm afternoon light. Keep a spacious quiet cream centre. Welcoming first garden, consistent with the original game reference.

### Розовая галерея

An intimate greenhouse gallery with two lush green arches draped in pink roses, softly lit cream plaster between the arches, warm wooden floor and scattered rose petals. Botanical detail concentrated around the sides, gentle peach daylight through glass. A romantic extension of the same conservatory, not a different visual style.

### Пруд кувшинок

A serene water garden inside the greenhouse, a real shallow pond with turquoise-green water, floating lily pads and water lilies across the lower part, glass windows and lush plants around the edges. Warm cream stone and soft sun keep continuity with the other scenes. Detailed water reflections, quiet central background for play.

### Лунный зимний сад

A cozy conservatory at night, full moon visible through the glass roof, snowy garden outside, violet flowers and leafy plants at the edges, warm lantern light against the cool night. Rich painterly materials, peaceful and welcoming rather than dark or ominous. Leave readable space behind the game interface.

### Купол цветов

A grand but cozy botanical glass dome filled with richly coloured flowers along both sides, a central garden walkway and golden evening light. Ivory architectural ribs, dimensional foliage, pink, gold and turquoise floral accents. A rewarding final greenhouse scene, in the same painterly visual language as the other four.

## Интеграция

`src/ui/garden-view.ts` — изображения в коллекции. `src/ui/garden-backdrop.ts` — декодирование перед показом и плавная смена фона за 650 мс. При ошибке загрузки предыдущая сцена остаётся видимой. Reduced motion отключает переходы через общие CSS-правила. `src/game/garden.ts` — доступность и выбор зон, отдельно от механики поля.
