import { describe, expect, it } from 'vitest'
import { planRollingNumber, rollingDigitSequence, type RollingDigitPlan } from './rolling-number'

const options = { locale: 'en' }
const digits = (plan: ReturnType<typeof planRollingNumber>): RollingDigitPlan[] => plan.tokens.filter((token): token is RollingDigitPlan => token.kind === 'digit')

describe('rolling number plans', () => {
  it('renders the initial number without motion', () => {
    const plan = planRollingNumber(null, 4870, options)
    expect(plan.label).toBe('4,870')
    expect(digits(plan).map(token => token.sequence)).toEqual([[4], [8], [7], [0]])
  })

  it('aligns 999 → 1,000 by decimal place, keeping the thousands separator static', () => {
    const plan = planRollingNumber(999, 1000, options)
    expect(plan.label).toBe('1,000')
    expect(digits(plan).map(token => token.place)).toEqual([3, 2, 1, 0])
    expect(digits(plan).map(token => token.sequence)).toEqual([[0, 1], [9, 0], [9, 0], [9, 0]])
    expect(plan.tokens.filter(token => token.kind === 'symbol')).toEqual([{ kind: 'symbol', text: ',' }])
  })

  it('spins an unchanged lower digit for a carry but not for an identical value', () => {
    expect(digits(planRollingNumber(10, 20, options))[1].sequence).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0])
    expect(digits(planRollingNumber(20, 20, options)).every(token => token.sequence.length === 1)).toBe(true)
  })

  it('bounds motion and DOM size for large consecutive updates', () => {
    let previous = 0
    for (const value of [70, 1234567, 9876543210, Number.MAX_SAFE_INTEGER, 12]) {
      const plan = planRollingNumber(previous, value, options)
      for (const token of digits(plan)) {
        expect(token.sequence.length).toBeLessThanOrEqual(20)
        expect(token.sequence.at(-1)).toBe(token.digit)
        expect(token.duration + token.delay).toBeLessThanOrEqual(800)
      }
      expect(digits(plan).map(token => token.digit).join('')).toBe(String(value))
      previous = value
    }
  })

  it('decreases upward and arrives at the requested digit after wraparound', () => {
    expect(rollingDigitSequence(7, 2)).toEqual([7, 8, 9, 0, 1, 2])
    const plan = planRollingNumber(1000, 35, options)
    expect(plan.label).toBe('35')
    expect(digits(plan).map(token => token.sequence.at(-1))).toEqual([3, 5])
  })

  it('uses an em dash for a reset combo without retaining the multiplication prefix', () => {
    const zero = planRollingNumber(3, 0, { ...options, prefix: '× ', emptyZero: true })
    expect(zero.label).toBe('—')
    expect(zero.tokens).toEqual([{ kind: 'symbol', text: '—' }])
    const combo = planRollingNumber(0, 2, { ...options, prefix: '× ', emptyZero: true })
    expect(combo.label).toBe('× 2')
    expect(digits(combo)[0].sequence).toEqual([0, 1, 2])
  })

  it('keeps zero numeric for regular score counters', () => {
    const plan = planRollingNumber(140, 0, options)
    expect(plan.label).toBe('0')
    expect(digits(plan)[0].sequence.at(-1)).toBe(0)
  })

  it('has exact localized readable text and native digit glyphs', () => {
    const ru = planRollingNumber(10, 4870, { locale: 'ru', prefix: '+' })
    expect(ru.label).toBe(`+${new Intl.NumberFormat('ru').format(4870)}`)
    expect(ru.tokens.filter(token => token.kind === 'symbol').map(token => token.text).join('')).toBe('+\u00a0')
    const arabic = planRollingNumber(15, 24, { locale: 'ar' })
    expect(digits(arabic).map(token => arabic.glyphs[token.digit]).join('')).toBe(new Intl.NumberFormat('ar').format(24))
  })

  it('settles immediately for reduced motion, even on a large increment', () => {
    const plan = planRollingNumber(9, 999999, { ...options, reducedMotion: true })
    expect(digits(plan).every(token => token.sequence.length === 1)).toBe(true)
    expect(plan.label).toBe('999,999')
  })

  it('falls back safely for invalid numeric input and locale', () => {
    expect(planRollingNumber(10, NaN, options).label).toBe('0')
    expect(planRollingNumber(null, Infinity, options).label).toBe('0')
    expect(planRollingNumber(null, 13.8, { locale: 'invalid_locale' }).label).toBe('13')
  })

  it('estimates fitting width for digits, grouping symbols and combo prefixes', () => {
    expect(planRollingNumber(null, 999, options).units).toBe(2.02)
    expect(planRollingNumber(null, 1000, options).units).toBe(2.96)
    expect(planRollingNumber(null, 2, { ...options, prefix: '× ' }).units).toBe(1.69)
    expect(planRollingNumber(null, 0, { ...options, emptyZero: true }).units).toBe(1.1)
    expect(planRollingNumber(null, Number.MAX_SAFE_INTEGER, options).units).toBeGreaterThan(11)
  })
})
