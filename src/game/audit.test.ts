import { describe, expect, it } from 'vitest'
import { beginBloom, beginDew, beginPrune, canPlace, createGame, finishRun, hasAnyMove, placePiece, refillPieces, revive, useBloom, useDew, usePrune } from './engine'
import { nextRandom } from './rng'
import { BLOOM_THRESHOLD, BOARD_SIZE, type GameMode, type GameState, type Piece, type Point } from './types'

const dot: Piece = { id: 'audit-dot', color: 'sun', cells: [{ x: 0, y: 0 }] }
const points = Array.from({ length: BOARD_SIZE ** 2 }, (_, index) => ({ x: index % BOARD_SIZE, y: Math.floor(index / BOARD_SIZE) }))

function legalMoves(state: GameState): Array<{ index: number; point: Point }> {
  return state.pieces.flatMap((piece, index) => piece
    ? points.filter(point => canPlace(state.board, piece, point)).map(point => ({ index, point }))
    : [])
}

function assertState(state: GameState): void {
  expect(state.board).toHaveLength(BOARD_SIZE)
  expect(state.pieces).toHaveLength(3)
  expect(state.boardColors).toHaveLength(BOARD_SIZE)
  state.board.forEach((row, y) => {
    expect(row).toHaveLength(BOARD_SIZE)
    expect(state.boardColors![y]).toHaveLength(BOARD_SIZE)
    row.forEach((cell, x) => expect(state.boardColors![y][x] === null).toBe(cell !== 'leaf'))
  })
  expect(Number.isSafeInteger(state.score) && state.score >= 0).toBe(true)
  expect(state.bestCombo).toBeGreaterThanOrEqual(state.combo)
  expect(state.petals).toBeGreaterThanOrEqual(0)
  expect(state.petals).toBeLessThanOrEqual(BLOOM_THRESHOLD)
  expect(state.bloomReady).toBe(state.petals === BLOOM_THRESHOLD)
  expect(state.dew).toBeGreaterThanOrEqual(0)
  expect(state.dew).toBeLessThanOrEqual(2)
  if (state.status === 'playing') {
    const toolAvailable = state.bloomReady || state.pruneReady || state.dew > 0
    expect(hasAnyMove(state.board, state.pieces) || toolAvailable).toBe(true)
  }
}

describe('audit: scoring and ability invariants', () => {
  it('deals three figures when a cramped standard board exhausts the 32 retry racks', () => {
    const state = createGame('standard')
    state.score = 1600
    state.rngState = 20
    state.pieces = [null, null, null]
    state.board = state.board.map(row => row.map(() => 'leaf'))
    state.boardColors = state.board.map(row => row.map(() => 'sun'))
    // One isolated opening per row/column: no already-full line and only dots fit.
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      state.board[y][(y + 2) % BOARD_SIZE] = 'empty'
      state.boardColors[y][(y + 2) % BOARD_SIZE] = null
    }
    const before = structuredClone(state)
    const dealt = refillPieces(state)
    expect(dealt.pieces.every(Boolean)).toBe(true)
    expect(dealt.pieces[2]?.id).toMatch(/^safe-/)
    expect(dealt.pieces[2]?.cells).toEqual([{ x: 0, y: 0 }])
    expect(hasAnyMove(dealt.board, dealt.pieces)).toBe(true)
    expect(refillPieces(state)).toEqual(dealt)
    expect(state).toEqual(before)
    assertState(dealt)
  })

  it('counts an intersecting row and column once per cell and grants only earned bonuses', () => {
    const state = createGame('daily', '2026-09-10')
    for (let i = 0; i < BOARD_SIZE; i += 1) {
      if (i !== 3) {
        state.board[3][i] = 'leaf'
        state.boardColors![3][i] = 'sun'
        state.board[i][3] = 'leaf'
        state.boardColors![i][3] = 'sun'
      }
    }
    state.pieces = [dot, dot, dot]
    state.combo = 1
    state.bestCombo = 1
    const before = structuredClone(state)
    const result = placePiece(state, 0, { x: 3, y: 3 })
    expect(result.clearedLines).toBe(2)
    expect(result.clearedCells).toBe(15)
    expect(result.state.score).toBe(10 + 15 * 12 + 2 * 45 + 25)
    expect(result.state).toMatchObject({ combo: 2, bestCombo: 2, dew: 1, pruneReady: true, petals: 2 })
    expect(state).toEqual(before)
    assertState(result.state)
  })

  it.each(['bloom', 'dew', 'prune'] as const)('%s preserves the clearing streak without awarding another streak charge', tool => {
    const state = createGame('daily', '2026-09-10')
    state.board[4][4] = 'leaf'
    state.boardColors![4][4] = 'mint'
    state.petals = 4
    state.bloomReady = true
    state.dew = 2
    state.pruneReady = true
    state.combo = 3
    state.bestCombo = 3
    const result = tool === 'bloom' ? useBloom(beginBloom(state), { x: 4, y: 4 })
      : tool === 'dew' ? useDew(beginDew(state), { x: 4, y: 4 })
      : usePrune(beginPrune(state), { x: 4, y: 4 })
    expect(result.valid).toBe(true)
    expect(result.state).toMatchObject({ combo: 3, bestCombo: 3, turn: 0, dew: tool === 'dew' ? 1 : 2 })
    expect(result.clearedLines).toBe(0)
    assertState(result.state)
  })

  it('does not end or reward a live run through the finish action', () => {
    const live = createGame('daily', '2026-09-10')
    expect(finishRun(live)).toBe(live)
    const waiting = { ...live, status: 'awaiting-revive' as const }
    const finished = finishRun(waiting)
    expect(finished.status).toBe('finished')
    expect(finishRun(finished)).toBe(finished)
    expect(placePiece(finished, 0, { x: 0, y: 0 }).valid).toBe(false)
  })
})

describe('audit: reproducible random-play simulations', () => {
  it.each<GameMode>(['standard', 'daily'])('%s keeps legal actions, colours, scores and save snapshots consistent for 40 seeded games', mode => {
    let totalMoves = 0
    let totalTools = 0
    let totalRevives = 0
    for (let seed = 0; seed < 40; seed += 1) {
      let state = createGame('daily', `2026-09-${String(seed % 28 + 1).padStart(2, '0')}`)
      state = refillPieces({ ...state, mode, challengeId: mode === 'daily' ? state.challengeId : null, pieces: [null, null, null], rngState: seed })
      let choiceSeed = seed + 71
      for (let action = 0; action < 180 && state.status !== 'finished'; action += 1) {
        assertState(state)
        const previous = state
        const before = structuredClone(state)
        const candidates = legalMoves(state)
        const occupied = points.filter(point => state.board[point.y][point.x] !== 'empty')
        let random: number
        ;[choiceSeed, random] = nextRandom(choiceSeed)
        const target = occupied[Math.floor(random * occupied.length)]
        if (state.status === 'awaiting-revive') {
          const result = revive(state, target)
          expect(result.valid).toBe(true)
          expect(result.state.reviveAvailable).toBe(false)
          state = result.state
          totalRevives += 1
        } else if (occupied.length && (!candidates.length || random < .12) && (state.bloomReady || state.dew > 0 || state.pruneReady)) {
          const result = state.pruneReady ? usePrune(beginPrune(state), target)
            : state.bloomReady ? useBloom(beginBloom(state), target)
            : useDew(beginDew(state), target)
          expect(result.valid).toBe(true)
          state = result.state
          totalTools += 1
        } else {
          expect(candidates.length).toBeGreaterThan(0)
          const move = candidates[Math.floor(random * candidates.length)]
          const piece = state.pieces[move.index]!
          const result = placePiece(state, move.index, move.point)
          expect(result.valid).toBe(true)
          expect(result.state.turn).toBe(state.turn + 1)
          expect(result.state.score - state.score).toBe(piece.cells.length * 10 + result.clearedCells * 12
            + result.clearedLines * 45 + Math.max(0, result.state.combo - 1) * 25)
          expect(result.state.board.some(row => row.every(cell => cell !== 'empty'))).toBe(false)
          expect(points.slice(0, BOARD_SIZE).some(({ x }) => result.state.board.every(row => row[x] !== 'empty'))).toBe(false)
          state = result.state
          totalMoves += 1
        }
        // Reducers must not mutate the object that may still be used by effects or persistence.
        expect(previous).toEqual(before)
        expect(JSON.parse(JSON.stringify(state))).toEqual(state)
        expect(state.score).toBeGreaterThanOrEqual(before.score)
        assertState(state)
      }
    }
    expect(totalMoves).toBeGreaterThan(900)
    expect(totalTools).toBeGreaterThan(0)
    expect(totalRevives).toBeGreaterThan(0)
  })
})
