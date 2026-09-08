import type { Piece, PieceColor, Point } from './types'
import { nextRandom } from './rng'

const SHAPES: Point[][] = [
  [{ x: 0, y: 0 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  [{ x: 0, y: 0 }, { x: 0, y: 1 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
  [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
  [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }],
  [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 1 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 1 }],
  [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }]
]

const COLORS: PieceColor[] = ['coral', 'sun', 'mint', 'violet', 'sky']

export function pieceBounds(piece: Piece): { width: number; height: number } {
  return {
    width: Math.max(...piece.cells.map((cell) => cell.x)) + 1,
    height: Math.max(...piece.cells.map((cell) => cell.y)) + 1
  }
}

export function generatePiece(seed: number, difficulty: number, serial: number): [number, Piece] {
  const maxShapeIndex = difficulty === 0 ? 10 : difficulty === 1 ? 14 : SHAPES.length - 1
  let currentSeed = seed
  let random: number
  ;[currentSeed, random] = nextRandom(currentSeed)
  const shape = SHAPES[Math.floor(random * (maxShapeIndex + 1))]
  ;[currentSeed, random] = nextRandom(currentSeed)
  const color = COLORS[Math.floor(random * COLORS.length)]

  return [
    currentSeed,
    {
      id: `p-${serial}-${currentSeed}`,
      cells: shape.map((cell) => ({ ...cell })),
      color
    }
  ]
}

export function singleCellPiece(seed: number, serial: number): Piece {
  return { id: `safe-${serial}-${seed}`, cells: [{ x: 0, y: 0 }], color: 'mint' }
}
