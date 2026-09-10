# Художественное направление и ассеты

Дата: 9 сентября 2026. Основной референс — изображение пользователя `codex-clipboard-92b6662a-40b3-4ef6-9332-a739b072603b.png`.

Использован встроенный ImageGen, без CLI/API fallback. Шесть самостоятельных генераций: фон, рамка, атлас цветочных плиток, основа поля, отдельная клетка, бумага. Готовые игровые ассеты находятся в `public/assets/art/`: `greenhouse.webp`, `frame.webp`, `board.webp`, `cell.webp`, `paper.webp`, `tile-{mint,coral,sun,violet,sky}.webp`. Исходные рисунки из папки генерации собираются скриптом `scripts/install-generated-art.mjs` (ресайз и нарезка атласа). Альфа рамки сохранена; клетка и плитки дополнительно ограничиваются скруглённым контуром при отрисовке. SVG-иконки нарисованы отдельно в `src/ui/icons.ts`, без готовой библиотеки.

Цель — близкое совпадение материалов, света и композиции, не обещание пиксельного совпадения. Поле остаётся 8×8 и квадратным; три фигуры соответствуют игровой механике, даже если в референсе показано пять. Статистика реальная, не скопированные числа с макета. Цветок на пустой угловой клетке удалён: готовность умения показана только на его кнопке. Рамка не перекрывает игровую область, поэтому цветовое вырезание листвы и его артефакты больше не требуются.

## Эффекты

- Линия: последовательная волна распускания, золотой свет и лепестки; более длинная серия усиливает частицы.
- Цветение: радиальный цветок и расширяющийся тёплый ореол.
- Роса: прохладная капля и расходящиеся овальные кольца.
- Секатор: два световых среза, строго ограниченные игровым полем, и листья.
- Reduced motion: без частиц, покачивания и масштабных вспышек; короткая мягкая подсветка и текст результата.

# Финальные промпты

## greenhouse

Use case: stylized-concept. Asset type: background plate for the exact game shown in the reference. Recreate ONLY its warm greenhouse room background, without all interface, logo, text, game board or panels. Match reference composition precisely: large pale sunlit cream plaster wall fills central 80%, tall window at far left, warm golden wooden TABLETOP crosses bottom quarter at a shallow angle, books and flower-painted ceramic cup far bottom-left, flowering plants along extreme edges, pink-white flowers, blurred foliage at bottom corners, lace cloth at bottom right. Close viewpoint and airy bright afternoon sunlight, dappled plant shadows across wall. Premium polished softly painterly 2D casual puzzle game illustration, subtle dimensional realism, no ink outlines. Keep center exceptionally quiet with ample blank wall for UI. Horizontal 1536x1024 composition. No typography anywhere (including books), no furniture at center, no UI. Reference image is composition/style reference, not edit target.

## frame

Use case: stylized-concept. Asset type: ONE square board-frame overlay PNG with genuine transparent center and transparent outside. Match the reference board surround: narrow warm ivory / honey ceramic-wood square frame with small white daisies, a few pink flowers and delicate green vine leaves around the outer corners. Exact flat frontal orthographic square, NOT oval, NOT circular, no perspective. Outer square x=3% to97%, y=3% to97%; hollow square opening x=8% to92%, y=8% to92%. Rounded corners radius3%. Keep ALL decoration within outermost 8% border, so the large central square stays fully transparent and playable cells will never be hidden. Flowers small and refined, not oversized bouquets. Soft hand painted texture, subtle bevel highlights upper left, warm cream stone striations and very thin forest-green inner lip. No grid, no filled center, no plants inside opening, no text, no symbols, no checkerboard printed in image. Square 1024x1024. This is one usable independent game texture, not a screenshot. Reference image supplies material/color style.

## flowers

Use case: stylized-concept. Asset type: transparent game flower sprite ATLAS, exactly six evenly aligned icons in a 3 column x 2 row grid. Each of six equal square regions contains exactly ONE dimensional flower puzzle tile, generous transparent separation, no other elements. Top row left to right: turquoise flower, coral-red flower, golden amber flower. Bottom row left to right: purple-magenta flower, sky-cyan flower, ivory white flower with gold center. Match the small occupied blocks shown in reference with incredible fidelity: plump rounded glossy petals nearly filling a softly rounded square jewel-like tile, dark rich round central seed with a tiny glossy highlight, tiny green leaves just peeking from corners; colorful solid rounded-square base behind petals clearly defines occupied cell. Thick fleshy four-to-five petal flowers, juicy ceramic candy gloss but delicately painterly not plastic. Every icon same front view size, 82% of its region, upper-left soft gleam, shaded underside. Saturated colors differentiated by petal shape. No faces, eyes, stems, pots, text, numbers or board. Genuine alpha background, no fake checkerboard. 1536x1024. Reference image is visual style reference only.

## board

Use case: stylized-concept. Single game board BASE TEXTURE, flat frontal deep dark forest-green square filling entire image. Subtle felt/leaf-grain mottled texture with slight soft green illumination at center, dark rim thin rounded-square inset border, radius5%. Based on deep green board bed under cells in the reference image. No cells, no grid, no visible leaves, no flowers, no decoration, no text, no UI. Clean low-contrast square substrate to put separate grid cells on. 1024x1024.

## cell

Use case: stylized-concept. Single empty board CELL for the game in reference, flat front view square 1024x1024. Dark forest green enameled leaf tile, softly rounded square silhouette occupying full image with 2% margin only, small subdued two-leaf seedling engraving at center (not large veins), moss green subtly mottled painterly surface, faint warm tiny flecks at edges, very subtle bevel along top and left, rich darker edge bottom-right. Match reference empty green tiles exactly. This cell is empty game space, must stay dark low contrast so colorful flowers pop. Not neon, not glass reflections, not a big white shine. Single tile only, no grid, no numbers, no flowers. Real alpha only at outside rounded corners. Reference supplies material and style.

## paper

Use case: stylized-concept. Asset type: one reusable CREAM PAPER PANEL MATERIAL texture for the reference game UI. Square image filled edge to edge with pale warm ivory cream paper, tiny subtle paper fibers and very light peach marbling at outer corners, luminous soft illumination upper left. Center almost perfectly clean and pale. Extremely low contrast background texture for dark green readable UI text. NO borders, NO frame, NO icons, NO text, NO shadows, NO objects, NO gradient into dark colors. Closely match the warm ivory card surface behind the score display in reference. 1024x1024.
