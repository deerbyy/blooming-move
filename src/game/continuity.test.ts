import { describe, expect, it } from 'vitest'
import { beginBloom, beginDew, beginPrune, canPlace, createGame, difficultyFor, hasAnyMove, placePiece, refillPieces, revive, useBloom, useDew, usePrune } from './engine'
import { BOARD_SIZE, type GameState, type Piece } from './types'

const dot: Piece = { id: 'dot', color: 'sun', cells: [{ x: 0, y: 0 }] }
const square: Piece = { id: 'square', color: 'mint', cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] }

function plantedBoard(): GameState {
  const state = createGame('daily', '2026-09-09')
  state.board = state.board.map(row => row.map(() => 'leaf'))
  state.boardColors = state.board.map(row => row.map(() => 'violet'))
  state.pieces = [square, null, null]
  return state
}

describe('earned tools and end states', () => {
  it.each(['bloom', 'dew', 'prune'] as const)('keeps a blocked rack playable while %s is available', ability => {
    const state = createGame('daily', '2026-09-09')
    state.board = state.board.map((row, y) => row.map((_, x) => (x + y) % 2 ? 'leaf' : 'empty'))
    state.pieces = [dot, square, null]
    if (ability === 'bloom') { state.bloomReady = true; state.petals = 4 }
    if (ability === 'dew') state.dew = 1
    if (ability === 'prune') state.pruneReady = true
    const result = placePiece(state, 0, { x: 0, y: 0 })
    expect(result.valid).toBe(true)
    expect(hasAnyMove(result.state.board, result.state.pieces)).toBe(false)
    expect(result.gameOver).toBe(false)
    expect(result.state.status).toBe('playing')
  })

  it('checks the last spent tool for a blocked rack, but preserves a remaining charge', () => {
    const state = plantedBoard()
    state.dew = 2
    const first = useDew(beginDew(state), { x: 0, y: 0 })
    expect(first.gameOver).toBe(false)
    expect(first.state.status).toBe('playing')
    const last = useDew(beginDew(first.state), { x: 7, y: 7 })
    expect(last.gameOver).toBe(true)
    expect(last.state.status).toBe('awaiting-revive')
    expect(last.state.dew).toBe(0)
  })

  it.each(['dew', 'prune'] as const)('refills an empty rack after using %s', ability => {
    const state = plantedBoard()
    state.pieces = [null, null, null]
    state.dew = 1
    state.pruneReady = true
    const result = ability === 'dew'
      ? useDew(beginDew(state), { x: 3, y: 3 })
      : usePrune(beginPrune(state), { x: 3, y: 3 })
    expect(result.valid).toBe(true)
    expect(result.state.status).toBe('playing')
    expect(hasAnyMove(result.state.board, result.state.pieces)).toBe(true)
  })

  it('guarantees a legal replacement rack after reviving into a narrow opening', () => {
    const state = plantedBoard()
    state.pieces = [{ id: 'bar', color: 'sun', cells: Array.from({ length: 4 }, (_, x) => ({ x, y: 0 })) }, null, null]
    state.status = 'awaiting-revive'
    const result = revive(state, { x: 0, y: 0 })
    expect(result.valid).toBe(true)
    expect(result.state.reviveAvailable).toBe(false)
    expect(result.state.status).toBe('playing')
    expect(hasAnyMove(result.state.board, result.state.pieces)).toBe(true)
  })
})

describe('plant colour continuity', () => {
  it('keeps the selected colour on the board without mutating the previous state', () => {
    const state = createGame('daily', '2026-09-09')
    state.pieces = [dot, square, null]
    const snapshot = structuredClone(state)
    const result = placePiece(state, 0, { x: 2, y: 2 })
    expect(result.state.boardColors?.[2][2]).toBe('sun')
    expect(state).toEqual(snapshot)
  })

  it('removes colour data on a cleared line while preserving other plants', () => {
    const state = createGame('daily', '2026-09-09')
    state.board[0] = Array(BOARD_SIZE).fill('leaf')
    state.boardColors![0] = Array(BOARD_SIZE).fill('violet')
    state.board[0][7] = 'empty'
    state.boardColors![0][7] = null
    state.board[4][4] = 'leaf'
    state.boardColors![4][4] = 'mint'
    state.pieces = [dot, square, null]
    const result = placePiece(state, 0, { x: 7, y: 0 })
    expect(result.clearedLines).toBe(1)
    expect(result.state.boardColors?.[0]).toEqual(Array(BOARD_SIZE).fill(null))
    expect(result.state.boardColors?.[4][4]).toBe('mint')
  })

  it.each(['bloom', 'dew', 'prune', 'revive'] as const)('removes only the colour data cleared by %s', ability => {
    const state = plantedBoard()
    state.bloomReady = true
    state.petals = 4
    state.dew = 1
    state.pruneReady = true
    const snapshot = structuredClone(state)
    const result = ability === 'bloom' ? useBloom(beginBloom(state), { x: 3, y: 3 })
      : ability === 'dew' ? useDew(beginDew(state), { x: 3, y: 3 })
      : ability === 'prune' ? usePrune(beginPrune(state), { x: 3, y: 3 })
      : revive({ ...state, status: 'awaiting-revive' }, { x: 3, y: 3 })
    expect(result.valid).toBe(true)
    result.state.board.forEach((row, y) => row.forEach((cell, x) => {
      expect(result.state.boardColors?.[y][x]).toBe(cell === 'empty' ? null : 'violet')
    }))
    expect(state).toEqual(snapshot)
  })
})

describe('fair piece generation', () => {
  it('keeps the expected difficulty thresholds', () => {
    expect([0, 699, 700, 1599, 1600].map(difficultyFor)).toEqual([0, 0, 1, 1, 2])
  })

  it('finds a legal piece for one remaining cell at every difficulty across seeds', () => {
    for (const score of [0, 700, 1600]) {
      for (let seed = 0; seed < 16; seed += 1) {
        const state = plantedBoard()
        state.mode = 'standard'
        state.board[seed % BOARD_SIZE][(seed * 3) % BOARD_SIZE] = 'empty'
        state.pieces = [null, null, null]
        state.score = score
        state.rngState = seed
        const result = refillPieces(state)
        expect(hasAnyMove(result.board, result.pieces)).toBe(true)
        expect(refillPieces(structuredClone(state))).toEqual(result)
      }
    }
  })
})

describe('shared daily base sequence', () => {
  it('does not shift base racks when a revive discarded an unfinished rack', () => {
    const first = createGame('daily', '2026-09-09')
    first.dailyRack = 4
    first.turn = 12
    first.pieces = [null, null, null]
    const second = { ...first, turn: 10 }
    expect(refillPieces(first).pieces).toEqual(refillPieces(second).pieces)
  })
  it('deals the same next rack after players place the first three figures differently', () => {
    function playRack(fromBottom: boolean): GameState {
      let state = createGame('daily', '2026-09-09')
      const positions = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => ({
        x: index % BOARD_SIZE, y: Math.floor(index / BOARD_SIZE)
      }))
      if (fromBottom) positions.reverse()
      for (let index = 0; index < 3; index += 1) {
        const piece = state.pieces[index]!
        const point = positions.find(origin => canPlace(state.board, piece, origin))!
        const placed = placePiece(state, index, point)
        expect(placed.valid).toBe(true)
        state = placed.state
      }
      return state
    }
    const top = playRack(false)
    const bottom = playRack(true)
    expect(top.board).not.toEqual(bottom.board)
    expect(top.pieces).toEqual(bottom.pieces)
    expect(top.rngState).toBe(bottom.rngState)
  })

  it.each([0, 12, 30])('keeps the base rack independent of score and occupancy at turn %i', turn => {
    const first = createGame('daily', '2026-09-09')
    first.pieces = [null, null, null]
    first.turn = turn
    first.dailyRack = Math.floor(turn / 3)
    first.score = 0
    first.board = first.board.map(row => row.map((_, x) => x < 4 ? 'leaf' : 'empty'))
    const second = structuredClone(first)
    second.score = 9000
    second.board = second.board.map(row => row.map((_, x) => x >= 4 ? 'leaf' : 'empty'))
    const lowScore = refillPieces(first)
    const highScore = refillPieces(second)
    expect(lowScore.pieces).toEqual(highScore.pieces)
    expect(lowScore.rngState).toBe(highScore.rngState)
  })

  it('substitutes only the reserve slot when needed without changing future base racks', () => {
    let rescues = 0
    for (let seed = 0; seed < 24; seed += 1) {
      const open = createGame('daily', '2026-09-09')
      open.pieces = [null, null, null]
      open.turn = 30
      open.dailyRack = 10
      open.rngState = seed
      const cramped = structuredClone(open)
      cramped.board = cramped.board.map(row => row.map(() => 'leaf'))
      cramped.board[3][5] = 'empty'
      const baseRack = refillPieces(open)
      const rescuedRack = refillPieces(cramped)
      expect(rescuedRack.pieces.slice(0, 2)).toEqual(baseRack.pieces.slice(0, 2))
      expect(rescuedRack.rngState).toBe(baseRack.rngState)
      expect(hasAnyMove(rescuedRack.board, rescuedRack.pieces)).toBe(true)
      if (!hasAnyMove(cramped.board, baseRack.pieces)) {
        rescues += 1
        expect(rescuedRack.pieces[2]?.cells).toEqual([{ x: 0, y: 0 }])
        expect(rescuedRack.pieces[2]?.id).toMatch(/^safe-/)
      } else {
        expect(rescuedRack.pieces).toEqual(baseRack.pieces)
      }
      const nextBase = refillPieces({ ...baseRack, pieces: [null, null, null], turn: 33 })
      const nextAfterRescue = refillPieces({ ...rescuedRack, board: open.board, pieces: [null, null, null], turn: 33 })
      expect(nextAfterRescue.pieces).toEqual(nextBase.pieces)
      expect(nextAfterRescue.rngState).toBe(nextBase.rngState)
    }
    expect(rescues).toBeGreaterThan(0)
  })
})
