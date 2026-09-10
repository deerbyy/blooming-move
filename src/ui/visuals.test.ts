import { describe, expect, it } from 'vitest'
import { flowerMotion } from './flower-motion'
import { placementPreview } from './placement-preview'
import type { Cell, Piece } from '../game/types'

const dot: Piece = { id: 'dot', color: 'mint', cells: [{ x: 0, y: 0 }] }
const empty = () => Array.from({ length: 8 }, () => Array<Cell>(8).fill('empty'))

describe('gentle visual motion', () => {
  it('is bounded and never significantly shrinks an occupied tile', () => {
    for (let time = 0; time < 12000; time += 97) for (let seed = 0; seed < 64; seed++) {
      const pose = flowerMotion(time, seed)
      expect(Math.abs(pose.angle)).toBeLessThanOrEqual(.028)
      expect(pose.scale).toBeGreaterThanOrEqual(1)
      expect(pose.scale).toBeLessThanOrEqual(1.018)
      expect(Math.abs(pose.lift)).toBeLessThanOrEqual(.009)
    }
  })
  it('moves different flowers out of phase without randomising the game', () => {
    expect(flowerMotion(500, 3)).toEqual(flowerMotion(500, 3))
    expect(flowerMotion(500, 3)).not.toEqual(flowerMotion(500, 4))
    expect(flowerMotion(500, 3)).not.toEqual(flowerMotion(900, 3))
  })
  it('is stationary for reduced motion', () => {
    expect(flowerMotion(12345, 8, false)).toEqual({ angle: 0, scale: 1, lift: 0 })
  })
})

describe('placement forecast', () => {
  it('marks a completed row without touching the board', () => {
    const board = empty()
    board[7].fill('leaf'); board[7][0] = 'empty'
    const before = JSON.stringify(board)
    expect(placementPreview(board, dot, { x: 0, y: 7 })).toEqual({ rows: [7], columns: [], cells: Array.from({ length: 8 }, (_, x) => ({ x, y: 7 })) })
    expect(JSON.stringify(board)).toBe(before)
  })
  it('deduplicates a cross, including weeds', () => {
    const board = empty()
    board[3].fill('weed'); board.forEach(row => { row[2] = 'leaf' }); board[3][2] = 'empty'
    const preview = placementPreview(board, dot, { x: 2, y: 3 })
    expect(preview.rows).toEqual([3]); expect(preview.columns).toEqual([2]); expect(preview.cells).toHaveLength(15)
  })
  it('does not forecast an illegal move or merely almost full line', () => {
    const board = empty()
    board[0].fill('leaf'); board[0][0] = 'empty'; board[0][1] = 'empty'
    for (const origin of [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: -1, y: 0 }, { x: 8, y: 0 }]) {
      expect(placementPreview(board, dot, origin)).toEqual({ cells: [], rows: [], columns: [] })
    }
  })
})
