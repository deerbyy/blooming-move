import { nextRandom, randomSeed, seedFromText } from './rng'
import { generatePiece, singleCellPiece } from './shapes'
import { BLOOM_THRESHOLD, BOARD_SIZE, type Cell, type GameMode, type GameState, type MoveResult, type Piece, type Point } from './types'

function emptyBoard(): Cell[][] {
  return Array.from({ length: BOARD_SIZE }, () => Array<Cell>(BOARD_SIZE).fill('empty'))
}

function cloneBoard(board: Cell[][]): Cell[][] {
  return board.map((row) => [...row])
}

function cloneState(state: GameState): GameState {
  return { ...state, board: cloneBoard(state.board), pieces: [...state.pieces] }
}

export function challengeIdFor(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

export function difficultyFor(score: number): number {
  if (score >= 1600) return 2
  if (score >= 700) return 1
  return 0
}

export function createGame(mode: GameMode, challengeId: string | null = null): GameState {
  const id = mode === 'daily' ? challengeId ?? challengeIdFor() : null
  const initialSeed = mode === 'daily' ? seedFromText(`bloom:${id}`) : randomSeed()
  const state: GameState = {
    version: 2,
    mode,
    challengeId: id,
    board: emptyBoard(),
    pieces: [null, null, null],
    score: 0,
    bestCombo: 0,
    combo: 0,
    petals: 0,
    bloomReady: false,
    dew: 0,
    pruneReady: false,
    turn: 0,
    rngState: initialSeed,
    reviveAvailable: true,
    status: 'playing'
  }
  return refillPieces(state)
}

function isBoardPoint(point: Point): boolean {
  return Number.isInteger(point.x) && Number.isInteger(point.y)
    && point.x >= 0 && point.x < BOARD_SIZE
    && point.y >= 0 && point.y < BOARD_SIZE
}

function isOccupiedPoint(board: Cell[][], point: Point): boolean {
  return isBoardPoint(point) && board[point.y][point.x] !== 'empty'
}

export function canPlace(board: Cell[][], piece: Piece, origin: Point): boolean {
  return piece.cells.every((cell) => {
    const x = origin.x + cell.x
    const y = origin.y + cell.y
    return isBoardPoint({ x, y }) && board[y][x] === 'empty'
  })
}

export function hasAnyMove(board: Cell[][], pieces: Array<Piece | null>): boolean {
  return pieces.some((piece) => {
    if (!piece) return false
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        if (canPlace(board, piece, { x, y })) return true
      }
    }
    return false
  })
}

function hasEmptyCell(board: Cell[][]): boolean {
  return board.some((row) => row.some((cell) => cell === 'empty'))
}

export function refillPieces(current: GameState): GameState {
  if (current.pieces.some(Boolean)) return current
  const state = cloneState(current)
  const difficulty = difficultyFor(state.score)
  let pieces: Piece[] = []
  let seed = state.rngState

  for (let attempt = 0; attempt < 32; attempt += 1) {
    pieces = []
    let attemptSeed = seed
    for (let index = 0; index < 3; index += 1) {
      let piece: Piece
      ;[attemptSeed, piece] = generatePiece(attemptSeed, difficulty, state.turn * 3 + index + attempt * 10)
      pieces.push(piece)
    }
    if (hasAnyMove(state.board, pieces)) {
      state.pieces = pieces
      state.rngState = attemptSeed
      return state
    }
    ;[seed] = nextRandom(seed)
  }

  if (hasEmptyCell(state.board)) {
    state.pieces = [singleCellPiece(seed, state.turn), null, null]
    state.rngState = seed
    return state
  }

  state.pieces = [null, null, null]
  return state
}

function linesToClear(board: Cell[][]): { rows: number[]; columns: number[] } {
  const rows = board.flatMap((row, index) => row.every((cell) => cell !== 'empty') ? [index] : [])
  const columns = Array.from({ length: BOARD_SIZE }, (_, index) => index).filter((column) =>
    board.every((row) => row[column] !== 'empty')
  )
  return { rows, columns }
}

function addWeed(state: GameState): void {
  const difficulty = difficultyFor(state.score)
  if (difficulty === 0) return
  const interval = difficulty === 1 ? 5 : 4
  if (state.turn === 0 || state.turn % interval !== 0) return

  const candidates: Point[] = []
  for (let index = 0; index < BOARD_SIZE; index += 1) {
    for (const point of [{ x: index, y: 0 }, { x: index, y: BOARD_SIZE - 1 }, { x: 0, y: index }, { x: BOARD_SIZE - 1, y: index }]) {
      if (state.board[point.y][point.x] === 'empty') candidates.push(point)
    }
  }
  if (candidates.length === 0) return
  let random: number
  ;[state.rngState, random] = nextRandom(state.rngState)
  const weed = candidates[Math.floor(random * candidates.length)]
  state.board[weed.y][weed.x] = 'weed'
}

function updateEndState(state: GameState): boolean {
  if (state.status !== 'playing') return false
  if (hasAnyMove(state.board, state.pieces)) return false
  state.status = state.reviveAvailable ? 'awaiting-revive' : 'finished'
  return true
}

export function placePiece(current: GameState, index: number, origin: Point): MoveResult {
  const piece = current.pieces[index]
  if (current.status !== 'playing' || !piece || !canPlace(current.board, piece, origin)) {
    return { state: current, valid: false, clearedLines: 0, clearedCells: 0, gameOver: false }
  }

  const state = cloneState(current)
  for (const cell of piece.cells) state.board[origin.y + cell.y][origin.x + cell.x] = 'leaf'
  state.pieces[index] = null
  state.turn += 1

  const clear = linesToClear(state.board)
  const cells = new Set<string>()
  clear.rows.forEach((row) => Array.from({ length: BOARD_SIZE }, (_, x) => cells.add(`${x}:${row}`)))
  clear.columns.forEach((column) => Array.from({ length: BOARD_SIZE }, (_, y) => cells.add(`${column}:${y}`)))
  for (const point of cells) {
    const [x, y] = point.split(':').map(Number)
    state.board[y][x] = 'empty'
  }

  const clearedLines = clear.rows.length + clear.columns.length
  const clearedCells = cells.size
  if (clearedLines > 0) {
    state.combo += 1
    state.bestCombo = Math.max(state.bestCombo, state.combo)
    state.petals = Math.min(BLOOM_THRESHOLD, state.petals + clearedLines)
    state.bloomReady = state.petals >= BLOOM_THRESHOLD
    if (state.combo >= 2) state.dew = Math.min(2, state.dew + 1)
    if (clearedLines >= 2) state.pruneReady = true
  } else {
    state.combo = 0
  }
  state.score += piece.cells.length * 10 + clearedCells * 12 + clearedLines * 45 + Math.max(0, state.combo - 1) * 25

  addWeed(state)
  const refilled = refillPieces(state)
  const gameOver = updateEndState(refilled)
  return { state: refilled, valid: true, clearedLines, clearedCells, gameOver }
}

export function beginBloom(current: GameState): GameState {
  if (current.status !== 'playing' || !current.bloomReady) return current
  return { ...current, status: 'selecting-bloom' }
}

function clearSquare(current: GameState, center: Point, radius: number): { state: GameState; cleared: number } {
  const state = cloneState(current)
  let cleared = 0
  for (let y = center.y - radius; y <= center.y + radius; y += 1) {
    for (let x = center.x - radius; x <= center.x + radius; x += 1) {
      if (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE && state.board[y][x] !== 'empty') {
        state.board[y][x] = 'empty'
        cleared += 1
      }
    }
  }
  return { state, cleared }
}

export function useBloom(current: GameState, center: Point): MoveResult {
  if (current.status !== 'selecting-bloom' || !isOccupiedPoint(current.board, center)) {
    return { state: current, valid: false, clearedLines: 0, clearedCells: 0, gameOver: false }
  }
  const result = clearSquare(current, center, 1)
  result.state.petals = 0
  result.state.bloomReady = false
  result.state.status = 'playing'
  result.state.score += result.cleared * 20 + 80
  return { state: result.state, valid: true, clearedLines: 0, clearedCells: result.cleared, gameOver: false }
}

export function beginDew(current: GameState): GameState {
  if (current.status !== 'playing' || current.dew < 1) return current
  return { ...current, status: 'selecting-dew' }
}

export function useDew(current: GameState, point: Point): MoveResult {
  if (current.status !== 'selecting-dew' || !isOccupiedPoint(current.board, point)) {
    return { state: current, valid: false, clearedLines: 0, clearedCells: 0, gameOver: false }
  }
  const state = cloneState(current)
  state.board[point.y][point.x] = 'empty'
  state.dew -= 1
  state.status = 'playing'
  state.score += 24
  return { state, valid: true, clearedLines: 0, clearedCells: 1, gameOver: false }
}

export function beginPrune(current: GameState): GameState {
  if (current.status !== 'playing' || !current.pruneReady) return current
  return { ...current, status: 'selecting-prune' }
}

export function usePrune(current: GameState, center: Point): MoveResult {
  if (current.status !== 'selecting-prune' || !isOccupiedPoint(current.board, center)) {
    return { state: current, valid: false, clearedLines: 0, clearedCells: 0, gameOver: false }
  }
  const state = cloneState(current)
  let cleared = 0
  for (let index = 0; index < BOARD_SIZE; index += 1) {
    if (state.board[center.y][index] !== 'empty') {
      state.board[center.y][index] = 'empty'
      cleared += 1
    }
    if (index !== center.y && state.board[index][center.x] !== 'empty') {
      state.board[index][center.x] = 'empty'
      cleared += 1
    }
  }
  state.pruneReady = false
  state.status = 'playing'
  state.score += cleared * 14 + 90
  return { state, valid: true, clearedLines: 0, clearedCells: cleared, gameOver: false }
}

export function revive(current: GameState, center: Point): MoveResult {
  if (current.status !== 'awaiting-revive' || !current.reviveAvailable || !isBoardPoint(center)) {
    return { state: current, valid: false, clearedLines: 0, clearedCells: 0, gameOver: false }
  }
  const result = clearSquare(current, center, 1)
  result.state.reviveAvailable = false
  result.state.status = 'playing'
  const refilled = refillPieces(result.state)
  const gameOver = updateEndState(refilled)
  return { state: refilled, valid: result.cleared > 0, clearedLines: 0, clearedCells: result.cleared, gameOver }
}

export function finishRun(current: GameState): GameState {
  if (current.status !== 'awaiting-revive') return current
  return { ...current, status: 'finished' }
}
