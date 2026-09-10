import { canPlace } from '../game/engine'
import { BOARD_SIZE, type Cell, type Piece, type Point } from '../game/types'

export interface PlacementPreview { cells: Point[]; rows: number[]; columns: number[] }

/** Read-only forecast of the ordinary row/column rule, not a move suggestion. */
export function placementPreview(board: Cell[][], piece: Piece, origin: Point): PlacementPreview {
  const result: PlacementPreview = { cells: [], rows: [], columns: [] }
  if (!canPlace(board, piece, origin)) return result
  const added = new Set(piece.cells.map(part => `${origin.x + part.x}:${origin.y + part.y}`))
  const occupied = (x: number, y: number) => board[y][x] !== 'empty' || added.has(`${x}:${y}`)
  for (let line = 0; line < BOARD_SIZE; line++) {
    if (board[line].every((_, x) => occupied(x, line))) result.rows.push(line)
    if (board.every((_, y) => occupied(line, y))) result.columns.push(line)
  }
  for (let y = 0; y < BOARD_SIZE; y++) for (let x = 0; x < BOARD_SIZE; x++) {
    if (result.rows.includes(y) || result.columns.includes(x)) result.cells.push({ x, y })
  }
  return result
}
