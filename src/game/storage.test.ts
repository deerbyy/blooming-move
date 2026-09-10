import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGame, hasAnyMove, placePiece } from './engine'
import { selectGardenZone } from './garden'
import { clearRun, defaultProgress, isProgress, loadProgress, loadRun, mergeProgress, saveProgress, saveRun } from './storage'
import { BOARD_SIZE } from './types'

const runKey = 'blooming-move:run:v1'
const profileKey = 'blooming-move:profile:v1'
let stored: Map<string, string>

beforeEach(() => {
  stored = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key)
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('save migration and validation', () => {
  it('preserves the run, piece colours and deterministic sequence after reloading', () => {
    const state = createGame('daily', '2026-09-09')
    state.pieces = [{ id: 'mint-dot', cells: [{ x: 0, y: 0 }], color: 'mint' }, null, null]
    const placed = placePiece(state, 0, { x: 2, y: 3 }).state
    saveRun(placed)
    expect(loadRun()).toEqual(placed)
    expect(loadRun()?.boardColors?.[3][2]).toBe('mint')
  })

  it('migrates v1 tools and assigns stable colours to its existing plants', () => {
    const state = createGame('daily', '2026-09-09')
    state.board[1][1] = 'leaf'
    const legacy: Record<string, unknown> = { ...state, version: 1 }
    delete legacy.dew
    delete legacy.pruneReady
    delete legacy.boardColors
    stored.set(runKey, JSON.stringify(legacy))
    const restored = loadRun()!
    expect(restored).toMatchObject({ version: 2, score: state.score, dew: 0, pruneReady: false, rngState: state.rngState })
    expect(restored.board).toEqual(state.board)
    expect(restored.boardColors?.[1][1]).toBeTruthy()
    saveRun(restored)
    expect(loadRun()).toEqual(restored)
  })

  it('repairs a malformed colour layer without losing a valid board or changing valid colours', () => {
    const state = createGame('daily', '2026-09-09')
    state.board[0][0] = 'leaf'
    state.board[0][1] = 'leaf'
    state.board[2][2] = 'leaf'
    state.board[3][3] = 'weed'
    stored.set(runKey, JSON.stringify({ ...state, boardColors: [['sun', 'unknown', 'coral'], null] }))
    const restored = loadRun()!
    expect(restored.board).toEqual(state.board)
    expect(restored.boardColors).toHaveLength(BOARD_SIZE)
    expect(restored.boardColors?.every(row => row.length === BOARD_SIZE)).toBe(true)
    expect(restored.boardColors?.[0][0]).toBe('sun')
    expect(restored.boardColors?.[0][1]).toBeTruthy()
    expect(restored.boardColors?.[2][2]).toBeTruthy()
    expect(restored.boardColors?.[0][2]).toBeNull()
    expect(restored.boardColors?.[3][3]).toBeNull()
  })

  it.each([
    { pieces: [{}] },
    { pieces: [{ id: 'empty', color: 'mint', cells: [] }, null, null] },
    { pieces: [{ id: 'bad', color: 'mint', cells: [null] }, null, null] },
    { pieces: [{ id: 'bad', color: 'mint', cells: [{ x: .5, y: 0 }] }, null, null] },
    { pieces: [{ id: 'bad', color: 'mint', cells: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }, null, null] },
    { score: -10 }, { rngState: 'broken' }, { status: 'unknown' }, { mode: 'unknown' },
    { version: 42 }, { challengeId: null }
  ])('rejects corrupt run data safely: %j', (invalid) => {
    stored.set(runKey, JSON.stringify({ ...createGame('daily', '2026-09-09'), ...invalid }))
    expect(loadRun()).toBeNull()
  })

  it('rejects a board of the wrong size and malformed JSON without throwing', () => {
    stored.set(runKey, '{')
    expect(loadRun()).toBeNull()
    const state = createGame('standard')
    state.board[0].push('empty')
    stored.set(runKey, JSON.stringify(state))
    expect(loadRun()).toBeNull()
  })

  it('recovers an empty rack and a stale tool-selection status on resume', () => {
    const state = createGame('daily', '2026-09-09')
    state.pieces = [null, null, null]
    state.status = 'selecting-dew'
    saveRun(state)
    const restored = loadRun()!
    expect(restored.status).toBe('playing')
    expect(hasAnyMove(restored.board, restored.pieces)).toBe(true)
  })

  it('keeps an earned tool accessible when an older save prematurely offered a revive', () => {
    const state = createGame('daily', '2026-09-09')
    state.board = state.board.map(row => row.map(() => 'leaf'))
    state.status = 'awaiting-revive'
    state.dew = 1
    saveRun(state)
    const restored = loadRun()!
    expect(restored.status).toBe('playing')
    expect(restored.dew).toBe(1)
    expect(restored.reviveAvailable).toBe(true)
  })
})

describe('profile storage', () => {
  it('migrates legacy profiles without losing nectar, daily results or settings', () => {
    const legacy = { ...defaultProgress(), nectar: 900, bestScore: 1800, completedRuns: 7, muted: true, dailyScores: { '2026-09-09': 1400 } }
    delete legacy.selectedGarden
    delete legacy.gardenSelectedAt
    stored.set(profileKey, JSON.stringify(legacy))
    expect(loadProgress()).toEqual({ ...legacy, selectedGarden: 'warm', gardenSelectedAt: 0 })
  })

  it('round-trips an explicit available greenhouse selection', () => {
    const profile = selectGardenZone({ ...defaultProgress(), nectar: 800 }, 'lily', 100)
    saveProgress(profile)
    expect(loadProgress()).toEqual(profile)
  })

  it.each([
    { selectedGarden: 'unknown', gardenSelectedAt: 100 },
    { selectedGarden: 'dome', gardenSelectedAt: 100 },
    { selectedGarden: { id: 'rose' }, gardenSelectedAt: 'bad' }
  ])('repairs invalid optional scene settings, preserving earned progress: %j', selection => {
    const profile = { ...defaultProgress(), nectar: 350, bestScore: 2000, completedRuns: 5, ...selection }
    stored.set(profileKey, JSON.stringify(profile))
    expect(loadProgress()).toMatchObject({ nectar: 350, bestScore: 2000, completedRuns: 5, selectedGarden: 'warm', gardenSelectedAt: 0 })
  })

  it('keeps a newer valid local selection while still merging cloud achievements', () => {
    const local = selectGardenZone({ ...defaultProgress(), nectar: 800 }, 'lily', 200)
    const cloud = selectGardenZone({ ...defaultProgress(), nectar: 1500, bestScore: 4000 }, 'rose', 100)
    const merged = mergeProgress(local, cloud)
    expect(merged).toMatchObject({ nectar: 1500, bestScore: 4000, selectedGarden: 'lily', gardenSelectedAt: 200 })
  })

  it('accepts a newer valid cloud selection', () => {
    const local = selectGardenZone({ ...defaultProgress(), nectar: 300 }, 'rose', 100)
    const cloud = selectGardenZone({ ...defaultProgress(), nectar: 1500 }, 'moon', 200)
    expect(mergeProgress(local, cloud)).toMatchObject({ nectar: 1500, selectedGarden: 'moon', gardenSelectedAt: 200 })
  })

  it('does not let a locked cloud selection with a newer timestamp override a valid local choice', () => {
    const local = selectGardenZone({ ...defaultProgress(), nectar: 800 }, 'lily', 100)
    const cloud = { ...defaultProgress(), selectedGarden: 'dome' as const, gardenSelectedAt: 500 }
    expect(mergeProgress(local, cloud)).toMatchObject({ selectedGarden: 'lily', gardenSelectedAt: 100 })
  })

  it('keeps the local scene on a timestamp tie and when merging a legacy cloud profile', () => {
    const local = selectGardenZone({ ...defaultProgress(), nectar: 800 }, 'lily', 100)
    const cloud = selectGardenZone({ ...defaultProgress(), nectar: 800 }, 'rose', 100)
    expect(mergeProgress(local, cloud).selectedGarden).toBe('lily')
    delete cloud.selectedGarden
    delete cloud.gardenSelectedAt
    expect(mergeProgress(local, cloud).selectedGarden).toBe('lily')
  })

  it('round-trips profile progress and merges the best result for each day', () => {
    const local = { ...defaultProgress(), nectar: 90, dailyScores: { '2026-09-09': 120 }, muted: true }
    const cloud = { ...defaultProgress(), nectar: 80, bestScore: 200, dailyScores: { '2026-09-09': 200, '2026-09-08': 180 } }
    const merged = mergeProgress(local, cloud)
    saveProgress(merged)
    expect(loadProgress()).toEqual(merged)
    expect(merged).toMatchObject({ nectar: 90, bestScore: 200, muted: true, dailyScores: cloud.dailyScores })
  })

  it.each([
    { nectar: NaN }, { bestScore: Infinity }, { completedRuns: -1 },
    { dailyScores: [] }, { dailyScores: { '2026-09-09': 'high' } },
    { dailyScores: { '2026-09-09': -20 } }, { dailyScores: { invalid: 100 } }
  ])('rejects malformed cloud or local progress: %j', invalid => {
    const profile = { ...defaultProgress(), ...invalid }
    expect(isProgress(profile)).toBe(false)
    stored.set(profileKey, JSON.stringify(profile))
    expect(loadProgress()).toEqual(defaultProgress())
  })

  it('keeps play available when storage reads, writes and removal throw', () => {
    const blocked = () => { throw new Error('Storage unavailable') }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    expect(loadRun()).toBeNull()
    expect(loadProgress()).toEqual(defaultProgress())
    expect(() => saveRun(createGame('standard'))).not.toThrow()
    expect(() => saveProgress(defaultProgress())).not.toThrow()
    expect(() => clearRun()).not.toThrow()
  })
})
