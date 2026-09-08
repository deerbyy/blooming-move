import { describe, expect, it } from 'vitest'
import { beginBloom, beginDew, beginPrune, canPlace, createGame, revive, useBloom, useDew, usePrune } from './engine'
import { BOARD_SIZE, type GameState, type MoveResult, type Piece, type Point } from './types'

const invalidPoints: Point[] = [
  { x: -1, y: 0 }, { x: BOARD_SIZE, y: 0 },
  { x: 0, y: -1 }, { x: 0, y: BOARD_SIZE },
  { x: .5, y: 0 }, { x: 0, y: .5 },
  { x: NaN, y: 0 }, { x: 0, y: Infinity }
]

const corners: Point[] = [
  { x: 0, y: 0 }, { x: BOARD_SIZE - 1, y: 0 },
  { x: 0, y: BOARD_SIZE - 1 }, { x: BOARD_SIZE - 1, y: BOARD_SIZE - 1 }
]

function chargedGame(): GameState {
  const state = createGame('daily', '2026-09-08')
  state.petals = 4
  state.bloomReady = true
  state.dew = 1
  state.pruneReady = true
  state.board[4][4] = 'leaf'
  return state
}

const abilities: Array<{
  name: string
  prepare: (state: GameState) => GameState
  apply: (state: GameState, target: Point) => MoveResult
}> = [
  { name: 'bloom', prepare: beginBloom, apply: useBloom },
  { name: 'dew', prepare: beginDew, apply: useDew },
  { name: 'prune', prepare: beginPrune, apply: usePrune }
]

describe('board coordinate validation', () => {
  for (const ability of abilities) {
    it.each(invalidPoints)(`${ability.name} rejects invalid coordinates without changing the run`, (target) => {
      const state = ability.prepare(chargedGame())
      const snapshot = structuredClone(state)
      const result = ability.apply(state, target)
      expect(result).toMatchObject({ valid: false, clearedCells: 0, clearedLines: 0, gameOver: false })
      expect(result.state).toBe(state)
      expect(state).toEqual(snapshot)
    })

    it(`${ability.name} rejects an empty target`, () => {
      const state = ability.prepare(chargedGame())
      const snapshot = structuredClone(state)
      const result = ability.apply(state, { x: 3, y: 3 })
      expect(result.valid).toBe(false)
      expect(result.state).toBe(state)
      expect(state).toEqual(snapshot)
    })
  }

  it.each(invalidPoints)('revive rejects an invalid 3×3 area without consuming the continuation', (target) => {
    const state = chargedGame()
    state.status = 'awaiting-revive'
    const snapshot = structuredClone(state)
    const result = revive(state, target)
    expect(result).toMatchObject({ valid: false, clearedCells: 0, clearedLines: 0, gameOver: false })
    expect(result.state).toBe(state)
    expect(state).toEqual(snapshot)
  })

  it('revive accepts an empty centre when its selected 3×3 area contains a plant', () => {
    const state = chargedGame()
    state.status = 'awaiting-revive'
    const result = revive(state, { x: 3, y: 3 })
    expect(result.valid).toBe(true)
    expect(result.clearedCells).toBe(1)
    expect(result.state.reviveAvailable).toBe(false)
  })

  it.each(corners)('abilities clear an occupied corner without resizing the 8×8 board', (target) => {
    const state = chargedGame()
    state.board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill('leaf'))
    const result = usePrune(beginPrune(state), target)
    expect(result.valid).toBe(true)
    expect(result.clearedCells).toBe(BOARD_SIZE * 2 - 1)
    expect(result.state.board).toHaveLength(BOARD_SIZE)
    expect(result.state.board.every((row) => row.length === BOARD_SIZE)).toBe(true)
  })

  const dot: Piece = { id: 'dot', color: 'mint', cells: [{ x: 0, y: 0 }] }
  it.each(invalidPoints)('placement rejects invalid origins without throwing', (origin) => {
    expect(canPlace(createGame('daily', '2026-09-08').board, dot, origin)).toBe(false)
  })
})
