/** The reference playfield is an intentionally compact 8×8 flower bed. */
export const BOARD_SIZE = 8
export const BLOOM_THRESHOLD = 4

export type Cell = 'empty' | 'leaf' | 'weed'
export type PieceColor = 'coral' | 'sun' | 'mint' | 'violet' | 'sky'
export type GameMode = 'standard' | 'daily'
export type RunStatus = 'playing' | 'selecting-bloom' | 'selecting-dew' | 'selecting-prune' | 'awaiting-revive' | 'finished'

export interface Point {
  x: number
  y: number
}

export interface Piece {
  id: string
  cells: Point[]
  color: PieceColor
}

export interface GameState {
  version: 2
  mode: GameMode
  challengeId: string | null
  board: Cell[][]
  pieces: Array<Piece | null>
  score: number
  bestCombo: number
  combo: number
  petals: number
  bloomReady: boolean
  /** A precise one-cell cleanup earned by keeping a clearing streak alive. */
  dew: number
  /** A row-and-column cleanup earned for clearing two or more lines at once. */
  pruneReady: boolean
  turn: number
  rngState: number
  reviveAvailable: boolean
  status: RunStatus
}

export interface PlayerProgress {
  version: 1
  nectar: number
  bestScore: number
  dailyScores: Record<string, number>
  completedRuns: number
  lastInterstitialAt: number
  muted: boolean
}

export interface MoveResult {
  state: GameState
  valid: boolean
  clearedLines: number
  clearedCells: number
  gameOver: boolean
}
