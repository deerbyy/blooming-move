import { describe, expect, it } from 'vitest'
import { createGame } from '../game/engine'
import type { GameState, Piece } from '../game/types'
import { contextualHint, guideMarkup } from './game-guide'

const dot: Piece = { id: 'guide-dot', cells: [{ x: 0, y: 0 }], color: 'mint' }
const bar: Piece = { id: 'guide-bar', cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }], color: 'coral' }

describe('game guide', () => {
  it.each(['ru', 'en'] as const)('renders three visual steps with complete 8×8 examples in %s', (locale) => {
    const markup = guideMarkup(locale, true)
    expect(markup.match(/class="guide-step"/g)).toHaveLength(3)
    expect(markup.match(/class="guide-cell/g)).toHaveLength(64 * 3)
    expect(markup).toContain('is-target')
    expect(markup).toContain('is-cleared')
    expect(markup).not.toContain('guide-tools')
  })

  it('explains that colors do not match and all three pieces must be used', () => {
    expect(guideMarkup('ru', true)).toContain('Цвета могут быть разными')
    expect(guideMarkup('ru', true)).toContain('все три фигуры')
    expect(guideMarkup('en', true)).toContain('Colors do not need to match')
  })

  it.each(['ru', 'en'] as const)('includes all three earned tools only in full help in %s', (locale) => {
    const markup = guideMarkup(locale)
    expect(markup.match(/class="guide-tool"/g)).toHaveLength(3)
    expect(markup).toContain('3×3')
    expect(markup).toContain('25')
    expect(markup).toContain('guide-notes')
  })
})

describe('contextualHint', () => {
  function run(): GameState {
    const state = createGame('daily', '2026-09-09')
    state.pieces = [dot, bar, dot]
    return state
  }

  it('explains the next set and handles missing selections', () => {
    const state = run()
    expect(contextualHint(state, null, 'ru')).toContain('все три')
    expect(contextualHint(state, null, 'en')).toContain('Use all three')
  })

  it('guides placement without a color-matching rule', () => {
    const state = run()
    expect(contextualHint(state, 0, 'ru')).toContain('Цвета соседей не важны')
    expect(contextualHint(state, 0, 'en')).toContain('colors do not matter')
  })

  it('shows remaining-piece guidance instead of selecting a used slot', () => {
    const state = run()
    state.pieces[0] = null
    expect(contextualHint(state, 0, 'ru')).toContain('оставшиеся')
    expect(contextualHint(state, 999, 'en')).toContain('remaining')
  })

  it('detects when a selected piece is blocked but another fits', () => {
    const state = run()
    state.board.forEach(row => row.fill('leaf'))
    state.board[3][3] = 'empty'
    expect(contextualHint(state, 1, 'ru')).toContain('Выберите другую')
    expect(contextualHint(state, 0, 'en')).toContain('Fit the whole')
  })

  it.each(['bloomReady', 'dew', 'pruneReady'] as const)('prioritizes the earned %s tool on a blocked board', (tool) => {
    const state = run()
    state.board.forEach(row => row.fill('leaf'))
    if (tool === 'dew') state.dew = 1
    else state[tool] = true
    expect(contextualHint(state, 0, 'ru')).toContain('Используйте готовое умение')
    expect(contextualHint(state, 0, 'en')).toContain('Use a ready tool')
  })

  it.each([
    ['selecting-bloom', '3×3'],
    ['selecting-dew', 'одну занятую'],
    ['selecting-prune', 'строку и столбец']
  ] as const)('explains the target for %s', (status, text) => {
    const state = run()
    state.status = status
    expect(contextualHint(state, null, 'ru')).toContain(text)
  })

  it('does not mutate gameplay state', () => {
    const state = run()
    const before = JSON.stringify(state)
    contextualHint(state, 1, 'ru')
    expect(JSON.stringify(state)).toBe(before)
  })
})
