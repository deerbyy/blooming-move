export interface RollingNumberOptions {
  locale: string
  reducedMotion?: boolean
  prefix?: string
  emptyZero?: boolean
}

export interface RollingDigitPlan {
  kind: 'digit'
  /** Decimal place, counted from the right; separators never affect alignment. */
  place: number
  digit: number
  sequence: number[]
  duration: number
  delay: number
}

export interface RollingSymbolPlan {
  kind: 'symbol'
  text: string
}

export interface RollingNumberPlan {
  value: number
  label: string
  glyphs: string[]
  tokens: Array<RollingDigitPlan | RollingSymbolPlan>
  /** Estimated em width, including a small safety margin, for container fitting. */
  units: number
}

function numberUnits(tokens: Array<RollingDigitPlan | RollingSymbolPlan>): number {
  const width = tokens.reduce((sum, token) => sum + (token.kind === 'digit' ? .64
    : Array.from(token.text).reduce((symbols, char) => symbols + (/\s|[,.']/u.test(char) ? .3
      : char === '—' ? 1 : /[\u061c\u200e\u200f]/u.test(char) ? 0 : .65), 0)), 0)
  return Math.round((width + .1) * 100) / 100
}

function integer(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0
}

function formatter(locale: string, useGrouping: boolean): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale, { useGrouping, maximumFractionDigits: 0 })
  } catch {
    return new Intl.NumberFormat('en', { useGrouping, maximumFractionDigits: 0 })
  }
}

/** The strip always travels upwards. At most two revolutions, even for huge gains. */
export function rollingDigitSequence(from: number, to: number, extraRevolution = false): number[] {
  const start = Math.abs(integer(from)) % 10
  const end = Math.abs(integer(to)) % 10
  const distance = (end - start + 10) % 10
  const steps = distance + (extraRevolution ? 10 : 0)
  return Array.from({ length: steps + 1 }, (_, index) => (start + index) % 10)
}

/** Pure planning is shared by the renderer and regression tests. */
export function planRollingNumber(previous: number | null, value: number, options: RollingNumberOptions): RollingNumberPlan {
  const next = integer(value)
  const glyphFormat = formatter(options.locale, false)
  const glyphs = Array.from({ length: 10 }, (_, digit) => glyphFormat.format(digit))
  if (options.emptyZero && next === 0) {
    return { value: next, label: '—', glyphs, tokens: [{ kind: 'symbol', text: '—' }], units: 1.1 }
  }
  const formatted = formatter(options.locale, true).format(next)
  const characters = Array.from(formatted)
  const digitCount = characters.filter(char => glyphs.includes(char)).length
  let digitIndex = 0
  const tokens: Array<RollingDigitPlan | RollingSymbolPlan> = []
  if (options.prefix) tokens.push({ kind: 'symbol', text: options.prefix })
  const old = previous === null ? null : integer(previous)
  for (const char of characters) {
    const digit = glyphs.indexOf(char)
    if (digit < 0) {
      tokens.push({ kind: 'symbol', text: char })
      continue
    }
    const place = digitCount - 1 - digitIndex
    const divisor = 10 ** place
    const from = old === null ? digit : Math.floor(Math.abs(old) / divisor) % 10
    const delta = old === null ? 0 : Math.abs(Math.floor(Math.abs(next) / divisor) - Math.floor(Math.abs(old) / divisor))
    const animate = old !== null && old !== next && !options.reducedMotion
    tokens.push({
      kind: 'digit', place, digit,
      sequence: animate ? rollingDigitSequence(from, digit, delta >= 10) : [digit],
      duration: 580 + Math.min(120, place * 30),
      delay: Math.min(84, place * 14)
    })
    digitIndex += 1
  }
  return { value: next, label: `${options.prefix ?? ''}${formatted}`, glyphs, tokens, units: numberUnits(tokens) }
}

interface DigitSlot {
  plan: RollingDigitPlan
  strip: HTMLElement
  animation: Animation | null
}

interface RollingRecord {
  element: HTMLElement
  value: number
  formatKey: string
  glyphs: string[]
  slots: DigitSlot[]
  settled: boolean
}

const records = new WeakMap<HTMLElement, RollingRecord>()
const active = new Set<RollingRecord>()

function digitSpan(document: Document, glyph: string): HTMLSpanElement {
  const span = document.createElement('span')
  span.textContent = glyph
  return span
}

function settle(record: RollingRecord): void {
  if (record.settled) return
  record.settled = true
  active.delete(record)
  for (const slot of record.slots) {
    if (slot.animation) {
      slot.animation.onfinish = null
      slot.animation.oncancel = null
      slot.animation.cancel()
      slot.animation = null
    }
    slot.strip.replaceChildren(digitSpan(record.element.ownerDocument, record.glyphs[slot.plan.digit]))
    slot.strip.style.transform = ''
  }
}

/** Stop transient motion on pause/visibility changes without displaying stale values. */
export function finishRollingNumbers(): void {
  for (const record of [...active]) settle(record)
}

/**
 * Owns the element's children, but not its role/live-region attributes. The sole
 * accessible text is the exact final value; all intermediate digits are hidden.
 */
export function setRollingNumber(element: HTMLElement, value: number, options: RollingNumberOptions): void {
  const next = integer(value)
  const formatKey = JSON.stringify([options.locale, options.prefix ?? '', !!options.emptyZero])
  const previous = records.get(element)
  if (previous?.value === next && previous.formatKey === formatKey) {
    if (options.reducedMotion) settle(previous)
    return
  }

  // A fast second score gain starts from the digit currently visible, rather
  // than jumping to the previous target or leaving its stale onfinish running.
  const visible = new Map<number, number>()
  if (previous && !previous.settled && previous.formatKey === formatKey) {
    for (const slot of previous.slots) {
      const progress = slot.animation?.effect?.getComputedTiming().progress ?? 0
      const index = Math.max(0, Math.min(slot.plan.sequence.length - 1, Math.round(Number(progress) * (slot.plan.sequence.length - 1))))
      visible.set(slot.plan.place, slot.plan.sequence[index])
    }
  }
  if (previous) settle(previous)
  const canAnimate = typeof element.animate === 'function' && !options.reducedMotion
  const plan = planRollingNumber(previous?.formatKey === formatKey ? previous.value : null, next, { ...options, reducedMotion: !canAnimate })
  const document = element.ownerDocument
  const fragment = document.createDocumentFragment()
  const readable = document.createElement('span')
  readable.className = 'rolling-readable'
  readable.textContent = plan.label
  fragment.append(readable)
  const record: RollingRecord = { element, value: next, formatKey, glyphs: plan.glyphs, slots: [], settled: false }
  records.set(element, record)
  element.classList.add('rolling-number')
  element.dataset.rollingValue = String(next)
  element.style.setProperty('--number-units', String(plan.units))

  for (const token of plan.tokens) {
    const span = document.createElement('span')
    span.setAttribute('aria-hidden', 'true')
    if (token.kind === 'symbol') {
      span.className = 'rolling-symbol'
      span.textContent = token.text
    } else {
      const from = visible.get(token.place)
      if (canAnimate && from !== undefined && from !== token.sequence[0]) {
        token.sequence = rollingDigitSequence(from, token.digit, token.sequence.length > 10)
      }
      span.className = 'rolling-digit'
      const strip = document.createElement('span')
      strip.className = 'rolling-strip'
      strip.append(...token.sequence.map(digit => digitSpan(document, plan.glyphs[digit])))
      span.append(strip)
      record.slots.push({ plan: token, strip, animation: null })
    }
    fragment.append(span)
  }
  element.replaceChildren(fragment)

  let moving = 0
  for (const slot of record.slots) {
    if (!canAnimate || slot.plan.sequence.length < 2) continue
    try {
      slot.animation = slot.strip.animate([
        { transform: 'translateY(0)' },
        { transform: `translateY(-${slot.plan.sequence.length - 1}em)` }
      ], { duration: slot.plan.duration, delay: slot.plan.delay, easing: 'cubic-bezier(.18,.7,.23,1)', fill: 'both' })
      moving += 1
      slot.animation.onfinish = () => {
        if (record.settled || records.get(element) !== record) return
        moving -= 1
        // Preserve the final frame until the slowest column has finished.
        if (moving === 0) settle(record)
      }
      slot.animation.oncancel = () => { if (!record.settled) settle(record) }
    } catch {
      // Partial/disabled Web Animations implementations must still show digits.
      settle(record)
      return
    }
  }
  if (moving > 0) active.add(record)
  else settle(record)
}
