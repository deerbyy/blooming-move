import { describe, expect, it } from 'vitest'
import { beginBloom, beginDew, beginPrune, challengeIdFor, createGame, hasAnyMove, placePiece, revive, useBloom, useDew, usePrune } from './engine'
import { BOARD_SIZE, type Piece } from './types'

const dot: Piece = { id: 'dot', color: 'mint', cells: [{ x: 0, y: 0 }] }

describe('game engine', () => {
  it('starts with a legal move in each mode', () => {
    const standard = createGame('standard')
    const daily = createGame('daily', '2026-09-08')
    expect(hasAnyMove(standard.board, standard.pieces)).toBe(true)
    expect(hasAnyMove(daily.board, daily.pieces)).toBe(true)
  })

  it('makes a deterministic daily sequence', () => {
    const first = createGame('daily', '2026-09-08')
    const second = createGame('daily', '2026-09-08')
    expect(first.pieces).toEqual(second.pieces)
    expect(first.rngState).toBe(second.rngState)
  })

  it('clears a completed row and grants petals', () => {
    const state = createGame('standard')
    state.board[0] = Array(BOARD_SIZE).fill('leaf')
    state.board[0][BOARD_SIZE - 1] = 'empty'
    state.pieces = [dot, null, null]
    const result = placePiece(state, 0, { x: BOARD_SIZE - 1, y: 0 })
    expect(result.valid).toBe(true)
    expect(result.clearedLines).toBe(1)
    expect(result.state.board[0].every((cell) => cell === 'empty')).toBe(true)
    expect(result.state.petals).toBe(1)
  })

  it('requires a charged bloom and clears the selected square', () => {
    const state = createGame('standard')
    state.board[4][4] = 'leaf'
    state.board[4][5] = 'weed'
    state.petals = 4
    state.bloomReady = true
    const selecting = beginBloom(state)
    expect(selecting.status).toBe('selecting-bloom')
    const result = useBloom(selecting, { x: 4, y: 4 })
    expect(result.valid).toBe(true)
    expect(result.clearedCells).toBe(2)
    expect(result.state.board[4][4]).toBe('empty')
    expect(result.state.board[4][5]).toBe('empty')
    expect(result.state.petals).toBe(0)
  })

  it('allows one revive from a game-over state', () => {
    const state = createGame('standard')
    state.status = 'awaiting-revive'
    state.board[2][2] = 'leaf'
    const result = revive(state, { x: 2, y: 2 })
    expect(result.valid).toBe(true)
    expect(result.state.status).toBe('playing')
    expect(result.state.reviveAvailable).toBe(false)
  })

  it('uses earned gardener tools only on occupied cells', () => {
    const state = createGame('standard')
    state.board[4][4] = 'leaf'
    state.board[4][5] = 'weed'
    state.dew = 1
    const dew = useDew(beginDew(state), { x: 4, y: 4 })
    expect(dew.valid).toBe(true)
    expect(dew.state.dew).toBe(0)

    dew.state.pruneReady = true
    const pruned = usePrune(beginPrune(dew.state), { x: 5, y: 4 })
    expect(pruned.valid).toBe(true)
    expect(pruned.state.board[4][5]).toBe('empty')
  })

  it('uses an ISO date as the shared daily id', () => {
    expect(challengeIdFor(new Date('2026-09-08T23:00:00.000Z'))).toBe('2026-09-08')
  })
})
