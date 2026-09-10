import { hasAnyMove } from '../game/engine'
import type { GameState } from '../game/types'
import { icon, type IconName } from './icons'

type GuideLocale = 'ru' | 'en'

const copy = {
  ru: {
    steps: [
      ['Выберите фигуру', 'Три фигуры можно использовать в любом порядке. Фигуры не поворачиваются.'],
      ['Поставьте на свободное место', 'Перетащите фигуру или выберите её и нажмите на поле. Она должна поместиться целиком.'],
      ['Заполните линию', 'Полная строка или столбец исчезают. Цвета могут быть разными! Используйте все три фигуры — появится новый набор.']
    ],
    illustrations: ['Три разные фигуры для выбора', 'Фигура занимает свободные клетки поля 8 на 8', 'Все восемь клеток полной строки очищаются'],
    toolsTitle: 'Умения — награда за удачные ходы',
    tools: [
      ['Расцвести', 'Очистите суммарно 4 линии, чтобы зарядить умение.', 'Нажмите на занятый центр: очистится квадрат 3×3 вокруг него.'],
      ['Капля росы', 'Очищайте линии два хода подряд. Начиная со второго такого хода получайте каплю; можно хранить до 2.', 'Убирает одну выбранную занятую клетку.'],
      ['Секатор', 'Очистите 2 или больше линий одним ходом.', 'Убирает строку и столбец через выбранную занятую клетку — крестом.']
    ],
    comboTitle: 'Что такое комбо?',
    combo: 'Это число ходов с очисткой линии подряд. Ход без очистки обнуляет серию. Каждый шаг серии после первого даёт дополнительные очки, а не умножает весь счёт. Умения не продлевают и не обрывают серию.',
    nectarTitle: 'Зачем нужен нектар?',
    nectar: 'Нектар начисляется после завершения забега: 1 за каждые 25 очков и ещё 4 за каждый шаг лучшей серии. За забег — не меньше 5. Он открывает оформление оранжереи и не усиливает фигуры.',
    endTitle: 'Если фигуры не помещаются',
    end: 'Попробуйте заработанное умение: оно может освободить место. Когда не остаётся ни хода, ни умения, забег заканчивается. Можно один раз добровольно продолжить за видео или сразу забрать результат.',
    hints: {
      bloom: 'Нажмите на занятую клетку: «Расцвести» очистит квадрат 3×3 вокруг неё.',
      dew: 'Нажмите на одну занятую клетку, которую хотите убрать каплей росы.',
      prune: 'Нажмите на занятую клетку: секатор очистит её строку и столбец.',
      blockedTool: 'Фигуры не помещаются. Используйте готовое умение, чтобы освободить место.',
      blocked: 'Свободного хода больше нет. Можно завершить забег или продолжить за видео.',
      finished: 'Забег завершён. Начните новый, чтобы улучшить рекорд и получить ещё нектар.',
      selected: 'Поставьте выбранную фигуру целиком на свободные клетки. Цвета соседей не важны.',
      selectedBlocked: 'Эта фигура сейчас не помещается. Выберите другую или используйте готовое умение.',
      choose: 'Выберите любую из трёх фигур. Новый набор появится, когда разместите все три.',
      remaining: 'Разместите оставшиеся фигуры в любом порядке — затем появится новый набор.'
    }
  },
  en: {
    steps: [
      ['Choose a piece', 'Use the three pieces in any order. Pieces keep their orientation.'],
      ['Find an empty space', 'Drag the piece, or select it and tap the board. Every part must fit into an empty cell.'],
      ['Complete a line', 'A full row or column clears. Colors do not need to match! Use all three pieces to get the next set.']
    ],
    illustrations: ['Three different pieces to choose from', 'A piece fits into empty cells of an eight-by-eight board', 'All eight cells in a completed row clear'],
    toolsTitle: 'Earn tools with clever moves',
    tools: [
      ['Bloom', 'Clear a total of 4 lines to charge it.', 'Choose an occupied center: clears the 3×3 square around it.'],
      ['Dewdrop', 'Clear lines on two consecutive moves. From the second clearing move onward, earn a drop; store up to 2.', 'Removes one chosen occupied cell.'],
      ['Pruning shears', 'Clear 2 or more lines in a single move.', 'Clears the row and column through your chosen occupied cell — a cross.']
    ],
    comboTitle: 'What is a combo?',
    combo: 'It counts consecutive moves that clear a line. A move without a clear resets the streak. Each streak step after the first adds bonus points; it does not multiply your total score. Tools neither extend nor break the streak.',
    nectarTitle: 'What is nectar for?',
    nectar: 'At the end of a run, earn 1 nectar per full 25 points, plus 4 for each step of your best streak. Every completed run earns at least 5. Nectar unlocks greenhouse decoration without making pieces stronger.',
    endTitle: 'When no piece fits',
    end: 'Try an earned tool to make space. The run ends when neither a move nor a tool remains. You may continue once by choosing to watch a video, or collect your result immediately.',
    hints: {
      bloom: 'Choose an occupied cell: Bloom clears the 3×3 square around it.',
      dew: 'Choose the single occupied cell you want to remove with a dewdrop.',
      prune: 'Choose an occupied cell: shears clear its row and column.',
      blockedTool: 'No piece fits. Use a ready tool to make space.',
      blocked: 'No moves remain. End the run, or choose to continue with a video.',
      finished: 'Run complete. Start again to improve your record and earn more nectar.',
      selected: 'Fit the whole selected piece into empty cells. Neighboring colors do not matter.',
      selectedBlocked: 'This piece does not fit yet. Choose another or use a ready tool.',
      choose: 'Choose any of the three pieces. Use all three to receive the next set.',
      remaining: 'Place the remaining pieces in any order to receive the next set.'
    }
  }
} as const

function miniGrid(step: number, label: string): string {
  const pieces = new Set([17, 25, 26, 21, 22, 43, 44, 51, 52])
  const placed = new Set([11, 18, 24, 32, 33, 34, 37, 38, 39, 46, 55])
  const target = new Set([27, 35, 36])
  const cells = Array.from({ length: 64 }, (_, index) => {
    let state = ''
    let symbol = ''
    if ((step === 0 && pieces.has(index)) || (step > 0 && placed.has(index) && !(step === 2 && index >= 32 && index < 40))) {
      state = ' is-filled'
      symbol = '●'
    }
    if (step === 1 && target.has(index)) {
      state = ' is-target'
      symbol = '+'
    }
    if (step === 2 && index >= 32 && index < 40) {
      state = ' is-cleared'
      symbol = '✦'
    }
    if (step === 2 && index === 27) {
      state = ' is-filled'
      symbol = '●'
    }
    return `<span class="guide-cell${state}" aria-hidden="true">${symbol}</span>`
  }).join('')
  return `<div class="guide-grid" role="img" aria-label="${label}">${cells}</div>`
}

/** The compact variant is a first-play introduction; full help adds tool and reward rules. */
export function guideMarkup(locale: GuideLocale, compact = false): string {
  const text = copy[locale]
  const steps = `<ol class="guide-steps">${text.steps.map(([title, description], index) => `<li class="guide-step">
    ${miniGrid(index, text.illustrations[index])}
    <div class="guide-step-copy"><span class="guide-step-number" aria-hidden="true">${index + 1}</span><h3>${title}</h3><p>${description}</p></div>
  </li>`).join('')}</ol>`
  if (compact) return steps
  const tools: IconName[] = ['bloom', 'dew', 'prune']
  return `${steps}<section class="guide-tools"><h3>${text.toolsTitle}</h3>${text.tools.map(([title, earned, effect], index) => `<article class="guide-tool">${icon(tools[index])}<div><h4>${title}</h4><p>${effect}</p><small>${earned}</small></div></article>`).join('')}</section>
    <div class="guide-notes"><section><h3>${text.comboTitle}</h3><p>${text.combo}</p></section><section><h3>${text.nectarTitle}</h3><p>${text.nectar}</p></section><section><h3>${text.endTitle}</h3><p>${text.end}</p></section></div>`
}

/** Explain the current next action; never changes the run or its difficulty. */
export function contextualHint(state: GameState, selectedPiece: number | null, locale: GuideLocale): string {
  const hints = copy[locale].hints
  if (state.status === 'selecting-bloom') return hints.bloom
  if (state.status === 'selecting-dew') return hints.dew
  if (state.status === 'selecting-prune') return hints.prune
  if (state.status === 'finished') return hints.finished
  if (state.status === 'awaiting-revive') return hints.blocked
  if (!hasAnyMove(state.board, state.pieces)) {
    return state.bloomReady || state.dew > 0 || state.pruneReady ? hints.blockedTool : hints.blocked
  }
  const piece = selectedPiece === null ? null : state.pieces[selectedPiece]
  if (piece) return hasAnyMove(state.board, [piece]) ? hints.selected : hints.selectedBlocked
  return state.pieces.filter(Boolean).length < 3 ? hints.remaining : hints.choose
}
