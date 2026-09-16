import { describe, expect, it } from 'vitest'
import { crossedPersonalBest } from './record-milestone'

describe('personal-best celebration', () => {
  it('celebrates a crossing, including from a tied score', () => {
    expect(crossedPersonalBest(90, 110, 100)).toBe(true)
    expect(crossedPersonalBest(100, 110, 100)).toBe(true)
  })
  it('does not celebrate ties, a new profile, or an already exceeded record on reload', () => {
    expect(crossedPersonalBest(90, 100, 100)).toBe(false)
    expect(crossedPersonalBest(0, 10, 0)).toBe(false)
    expect(crossedPersonalBest(110, 120, 100)).toBe(false)
    expect(crossedPersonalBest(90, 90, 100)).toBe(false)
  })
  it('ignores invalid scores', () => {
    for (const value of [NaN, Infinity, -1, .5]) {
      expect(crossedPersonalBest(value, 110, 100)).toBe(false)
      expect(crossedPersonalBest(90, value, 100)).toBe(false)
      expect(crossedPersonalBest(90, 110, value)).toBe(false)
    }
  })
})
