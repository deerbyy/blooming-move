import { BOARD_SIZE, type Cell, type GameState, type PlayerProgress } from './types'

const PROFILE_KEY = 'blooming-move:profile:v1'
const RUN_KEY = 'blooming-move:run:v1'

export function defaultProgress(): PlayerProgress {
  return {
    version: 1,
    nectar: 0,
    bestScore: 0,
    dailyScores: {},
    completedRuns: 0,
    lastInterstitialAt: 0,
    muted: false
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

export function isProgress(value: unknown): value is PlayerProgress {
  const candidate = value as Partial<PlayerProgress> | null
  return Boolean(
    candidate &&
    candidate.version === 1 &&
    typeof candidate.nectar === 'number' &&
    typeof candidate.bestScore === 'number' &&
    typeof candidate.completedRuns === 'number' &&
    typeof candidate.lastInterstitialAt === 'number' &&
    typeof candidate.muted === 'boolean' &&
    candidate.dailyScores &&
    typeof candidate.dailyScores === 'object'
  )
}

export function loadProgress(): PlayerProgress {
  const saved = parse<unknown>(localStorage.getItem(PROFILE_KEY))
  return isProgress(saved) ? { ...defaultProgress(), ...saved } : defaultProgress()
}

export function saveProgress(progress: PlayerProgress): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(progress))
}

export function loadRun(): GameState | null {
  const saved = parse<Partial<GameState>>(localStorage.getItem(RUN_KEY))
  if (!saved || !isBoard(saved.board) || !Array.isArray(saved.pieces)) return null
  // v1 had no earned tools. Keep an in-progress garden playable after the v2 update.
  return {
    ...saved,
    version: 2,
    dew: typeof saved.dew === 'number' ? saved.dew : 0,
    pruneReady: typeof saved.pruneReady === 'boolean' ? saved.pruneReady : false
  } as GameState
}

function isBoard(board: unknown): board is Cell[][] {
  return Array.isArray(board) && board.length === BOARD_SIZE && board.every((row) =>
    Array.isArray(row) && row.length === BOARD_SIZE && row.every((cell) => cell === 'empty' || cell === 'leaf' || cell === 'weed')
  )
}

export function saveRun(run: GameState): void {
  localStorage.setItem(RUN_KEY, JSON.stringify(run))
}

export function clearRun(): void {
  localStorage.removeItem(RUN_KEY)
}

export function mergeProgress(local: PlayerProgress, cloud: PlayerProgress): PlayerProgress {
  const dailyScores = { ...cloud.dailyScores, ...local.dailyScores }
  for (const [day, score] of Object.entries(cloud.dailyScores)) {
    dailyScores[day] = Math.max(score, local.dailyScores[day] ?? 0)
  }
  return {
    ...local,
    nectar: Math.max(local.nectar, cloud.nectar),
    bestScore: Math.max(local.bestScore, cloud.bestScore),
    dailyScores,
    completedRuns: Math.max(local.completedRuns, cloud.completedRuns),
    lastInterstitialAt: Math.max(local.lastInterstitialAt, cloud.lastInterstitialAt)
  }
}
