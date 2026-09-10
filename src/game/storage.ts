import { resumeRun } from './engine'
import { canSelectGardenZone, isGardenZoneId, selectedGardenZone } from './garden'
import { BLOOM_THRESHOLD, BOARD_SIZE, type Cell, type GameState, type Piece, type PieceColor, type PlayerProgress, type RunStatus } from './types'

const PROFILE_KEY = 'blooming-move:profile:v1'
const RUN_KEY = 'blooming-move:run:v1'
const COLORS: PieceColor[] = ['coral', 'sun', 'mint', 'violet', 'sky']
const RUN_STATUSES: RunStatus[] = ['playing', 'selecting-bloom', 'selecting-dew', 'selecting-prune', 'awaiting-revive', 'finished']

export function defaultProgress(): PlayerProgress {
  return {
    version: 1,
    nectar: 0,
    bestScore: 0,
    dailyScores: {},
    completedRuns: 0,
    lastInterstitialAt: 0,
    muted: false,
    selectedGarden: 'warm',
    gardenSelectedAt: 0
  }
}

function parse<T>(value: string | null): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function readStored(key: string): unknown {
  try {
    return parse<unknown>(localStorage.getItem(key))
  } catch {
    return null
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private browsing or an exhausted quota must not interrupt the active game.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCounter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function isProgress(value: unknown): value is PlayerProgress {
  return isRecord(value)
    && value.version === 1
    && isCounter(value.nectar)
    && isCounter(value.bestScore)
    && isCounter(value.completedRuns)
    && isCounter(value.lastInterstitialAt)
    && typeof value.muted === 'boolean'
    && (value.selectedGarden === undefined || isGardenZoneId(value.selectedGarden))
    && (value.gardenSelectedAt === undefined || isCounter(value.gardenSelectedAt))
    && isRecord(value.dailyScores)
    && Object.entries(value.dailyScores).every(([day, score]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && isCounter(score))
}

export function loadProgress(): PlayerProgress {
  const saved = readStored(PROFILE_KEY)
  if (!isRecord(saved)) return defaultProgress()
  // A damaged optional cosmetic setting must never discard earned progress.
  const candidate = { ...saved }
  if (!isGardenZoneId(candidate.selectedGarden)) delete candidate.selectedGarden
  if (!isCounter(candidate.gardenSelectedAt)) delete candidate.gardenSelectedAt
  if (!isProgress(candidate)) return defaultProgress()
  const profile = { ...defaultProgress(), ...candidate }
  const selectedGarden = selectedGardenZone(profile)
  return {
    ...profile,
    selectedGarden,
    gardenSelectedAt: canSelectGardenZone(candidate.nectar, candidate.selectedGarden) ? profile.gardenSelectedAt : 0
  }
}

export function saveProgress(progress: PlayerProgress): void {
  writeStored(PROFILE_KEY, progress)
}

export function loadRun(): GameState | null {
  const saved = readStored(RUN_KEY)
  if (!isRecord(saved) || (saved.version !== 1 && saved.version !== 2)
    || !isBoard(saved.board) || !Array.isArray(saved.pieces) || saved.pieces.length !== 3
    || !saved.pieces.every(piece => piece === null || isPiece(piece))
    || (saved.mode !== 'standard' && saved.mode !== 'daily')
    || (saved.mode === 'daily' && (typeof saved.challengeId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(saved.challengeId)))
    || !isCounter(saved.score) || !isCounter(saved.bestCombo) || !isCounter(saved.combo)
    || !isCounter(saved.petals) || saved.petals > BLOOM_THRESHOLD
    || !isCounter(saved.turn) || !isCounter(saved.rngState) || saved.rngState > 0xffffffff
    || typeof saved.bloomReady !== 'boolean' || typeof saved.reviveAvailable !== 'boolean'
    || !RUN_STATUSES.includes(saved.status as RunStatus)) return null

  const dew = isCounter(saved.dew) ? Math.min(2, saved.dew) : 0
  const pruneReady = saved.pruneReady === true
  const bloomReady = saved.petals === BLOOM_THRESHOLD
  let status = saved.status as RunStatus
  if ((status === 'selecting-bloom' && !bloomReady)
    || (status === 'selecting-dew' && dew === 0)
    || (status === 'selecting-prune' && !pruneReady)) status = 'playing'
  if (status === 'awaiting-revive' && !saved.reviveAvailable) status = 'playing'

  // v1 had no earned tools. Keep an in-progress garden playable after the v2 update.
  return resumeRun({
    version: 2,
    mode: saved.mode,
    challengeId: saved.mode === 'daily' ? saved.challengeId as string : null,
    board: saved.board,
    boardColors: restoreColors(saved.board, saved.boardColors),
    pieces: saved.pieces,
    score: saved.score,
    bestCombo: Math.max(saved.bestCombo, saved.combo),
    combo: saved.combo,
    petals: saved.petals,
    bloomReady,
    dew,
    pruneReady,
    turn: saved.turn,
    dailyRack: isCounter(saved.dailyRack) ? saved.dailyRack : Math.floor(saved.turn / 3) + 1,
    rngState: saved.rngState,
    reviveAvailable: saved.reviveAvailable,
    status
  })
}

function isPiece(value: unknown): value is Piece {
  if (!isRecord(value) || typeof value.id !== 'string' || !COLORS.includes(value.color as PieceColor)
    || !Array.isArray(value.cells) || value.cells.length < 1 || value.cells.length > 5) return false
  const positions = new Set<string>()
  for (const cell of value.cells) {
    if (!isRecord(cell) || !isCounter(cell.x) || !isCounter(cell.y) || cell.x >= BOARD_SIZE || cell.y >= BOARD_SIZE) return false
    positions.add(`${cell.x}:${cell.y}`)
  }
  return positions.size === value.cells.length
}

function restoreColors(board: Cell[][], colors: unknown): Array<Array<PieceColor | null>> {
  return board.map((row, y) => row.map((cell, x) => {
    if (cell !== 'leaf') return null
    const color = Array.isArray(colors) && Array.isArray(colors[y]) ? colors[y][x] : null
    // Legacy saves have no colour layer. Give each plant a stable colour once,
    // independent of garden unlocks, then preserve it in all subsequent saves.
    return COLORS.includes(color) ? color as PieceColor : COLORS[(x * 7 + y * 11) % COLORS.length]
  }))
}

function isBoard(board: unknown): board is Cell[][] {
  return Array.isArray(board) && board.length === BOARD_SIZE && board.every((row) =>
    Array.isArray(row) && row.length === BOARD_SIZE && row.every((cell) => cell === 'empty' || cell === 'leaf' || cell === 'weed')
  )
}

export function saveRun(run: GameState): void {
  writeStored(RUN_KEY, run)
}

export function clearRun(): void {
  try {
    localStorage.removeItem(RUN_KEY)
  } catch {
    // The in-memory run can still finish when persistent storage is unavailable.
  }
}

export function mergeProgress(local: PlayerProgress, cloud: PlayerProgress): PlayerProgress {
  const dailyScores = { ...cloud.dailyScores, ...local.dailyScores }
  for (const [day, score] of Object.entries(cloud.dailyScores)) {
    dailyScores[day] = Math.max(score, local.dailyScores[day] ?? 0)
  }
  const localSelectionValid = canSelectGardenZone(local.nectar, local.selectedGarden)
  const cloudSelectionValid = canSelectGardenZone(cloud.nectar, cloud.selectedGarden)
  const localSelectionAt = localSelectionValid && isCounter(local.gardenSelectedAt) ? local.gardenSelectedAt : 0
  const cloudSelectionAt = cloudSelectionValid && isCounter(cloud.gardenSelectedAt) ? cloud.gardenSelectedAt : 0
  // Missing or locked cloud choices cannot undo a valid choice on this device.
  // At equal timestamps, keep the local selection so a sync never flickers.
  const selection = cloudSelectionValid && (!localSelectionValid || cloudSelectionAt > localSelectionAt) ? cloud : local
  return {
    ...local,
    nectar: Math.max(local.nectar, cloud.nectar),
    bestScore: Math.max(local.bestScore, cloud.bestScore),
    dailyScores,
    completedRuns: Math.max(local.completedRuns, cloud.completedRuns),
    lastInterstitialAt: Math.max(local.lastInterstitialAt, cloud.lastInterstitialAt),
    selectedGarden: selectedGardenZone(selection),
    gardenSelectedAt: selection === cloud ? cloudSelectionAt : localSelectionAt
  }
}
