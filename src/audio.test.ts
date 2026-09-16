import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AUDIO_LEVELS, GardenAudio, normalizeAudioLevels, type GardenSound } from './audio'

class Parameter {
  value = 0
  cancelScheduledValues = vi.fn()
  setValueAtTime = vi.fn((value: number, _at: number) => { this.value = value })
  linearRampToValueAtTime = vi.fn((value: number, _at: number) => { this.value = value })
  exponentialRampToValueAtTime = vi.fn((value: number, _at: number) => { this.value = value })
}

class Node {
  connect = vi.fn((next: Node) => next)
  disconnect = vi.fn()
}

class Gain extends Node { gain = new Parameter() }
class Filter extends Node { type = ''; frequency = new Parameter(); Q = new Parameter() }
class Source extends Node {
  frequency = new Parameter()
  type = ''
  buffer: unknown
  onended: (() => void) | null = null
  timer: ReturnType<typeof setTimeout> | null = null
  start = vi.fn()
  stop = vi.fn((at: number) => {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.onended?.() }, Math.max(0, (at - this.context.currentTime) * 1000))
  })
  constructor(private context: FakeContext) { super() }
}

class FakeContext {
  static instances: FakeContext[] = []
  state: AudioContextState = 'suspended'
  sampleRate = 8000
  destination = new Node()
  gains: Gain[] = []
  oscillators: Source[] = []
  buffers: Source[] = []
  filters: Filter[] = []
  get currentTime(): number { return Date.now() / 1000 }
  resume = vi.fn(async () => { this.state = 'running' })
  suspend = vi.fn(async () => { this.state = 'suspended' })
  close = vi.fn(async () => { this.state = 'closed' })
  createGain = () => { const node = new Gain(); this.gains.push(node); return node }
  createOscillator = () => { const node = new Source(this); this.oscillators.push(node); return node }
  createBufferSource = () => { const node = new Source(this); this.buffers.push(node); return node }
  createBiquadFilter = () => { const node = new Filter(); this.filters.push(node); return node }
  createBuffer = (_channels: number, samples: number) => ({ getChannelData: () => new Float32Array(samples) })
  constructor() { FakeContext.instances.push(this) }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  FakeContext.instances = []
  vi.stubGlobal('AudioContext', FakeContext)
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

async function ready(music = 0) {
  const audio = new GardenAudio()
  audio.setLevels({ ...DEFAULT_AUDIO_LEVELS, music })
  audio.unlock()
  await Promise.resolve()
  await Promise.resolve()
  return { audio, context: FakeContext.instances.at(-1)! }
}

describe('audio preferences', () => {
  it('clamps numeric values and repairs malformed/missing channels', () => {
    expect(normalizeAudioLevels({ master: 4, music: -2, effects: NaN, ui: '0' })).toEqual({ master: 1, music: 0, effects: .8, ui: .5 })
    expect(normalizeAudioLevels(null)).toEqual(DEFAULT_AUDIO_LEVELS)
    expect(normalizeAudioLevels([])).toEqual(DEFAULT_AUDIO_LEVELS)
    expect(normalizeAudioLevels({ music: Infinity })).toEqual(DEFAULT_AUDIO_LEVELS)
    const levels = normalizeAudioLevels(undefined)
    levels.master = 0
    expect(DEFAULT_AUDIO_LEVELS.master).toBe(.7)
  })
})

describe('gesture-gated audio lifecycle', () => {
  it('does not create a context from settings updates or game events', () => {
    const audio = new GardenAudio()
    audio.setLevels({ ...DEFAULT_AUDIO_LEVELS })
    audio.setMuted(true)
    audio.setMuted(false)
    audio.setPaused(true)
    audio.setPaused(false)
    audio.play('place')
    expect(FakeContext.instances).toHaveLength(0)
    audio.unlock()
    audio.unlock()
    expect(FakeContext.instances).toHaveLength(1)
  })

  it('is safe when Web Audio is not available', () => {
    vi.stubGlobal('AudioContext', undefined)
    const audio = new GardenAudio()
    expect(() => { audio.unlock(); audio.play('record'); audio.setPaused(true) }).not.toThrow()
    expect(FakeContext.instances).toHaveLength(0)
  })

  it('retries a rejected resume on a later user gesture without unhandled rejection', async () => {
    const audio = new GardenAudio()
    audio.setPaused(true)
    audio.unlock()
    const context = FakeContext.instances[0]
    context.resume.mockRejectedValueOnce(new Error('gesture denied'))
    audio.setPaused(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(context.oscillators).toHaveLength(0)
    audio.unlock()
    await vi.advanceTimersByTimeAsync(1)
    expect(context.resume).toHaveBeenCalledTimes(2)
    expect(context.oscillators.length).toBeGreaterThan(0)
  })

  it('preserves first-action feedback while an allowed resume resolves', async () => {
    const audio = new GardenAudio()
    audio.setLevels({ ...DEFAULT_AUDIO_LEVELS, music: 0 })
    audio.setPaused(true)
    audio.unlock()
    const context = FakeContext.instances[0]
    let finish!: () => void
    context.resume.mockImplementationOnce(() => new Promise(resolve => { finish = () => { context.state = 'running'; resolve() } }))
    audio.setPaused(false)
    audio.play('place')
    expect(context.oscillators).toHaveLength(0)
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(context.oscillators).toHaveLength(2)
  })

  it('pauses existing voices and the scheduler, with no audio burst on return', async () => {
    const { audio, context } = await ready(.32)
    audio.play('bloom')
    audio.setPaused(true)
    await vi.advanceTimersByTimeAsync(10000)
    const count = context.oscillators.length
    expect(context.state).toBe('suspended')
    expect(vi.getTimerCount()).toBe(0)
    expect(context.oscillators.every(source => source.disconnect.mock.calls.length > 0)).toBe(true)
    audio.setPaused(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(context.oscillators.length - count).toBeLessThanOrEqual(3)
  })

  it('does not restart music or create duplicate timers on repeated updates', async () => {
    const { audio, context } = await ready(.32)
    const initialVoices = context.oscillators.length
    const initialTimers = vi.getTimerCount()
    for (let index = 0; index < 50; index += 1) {
      audio.setLevels({ ...DEFAULT_AUDIO_LEVELS })
      audio.setPaused(false)
      audio.unlock()
    }
    expect(context.oscillators).toHaveLength(initialVoices)
    expect(vi.getTimerCount()).toBe(initialTimers)
  })

  it('keeps repeated muted updates silent without redundant suspend work', async () => {
    const { audio, context } = await ready(.32)
    audio.setMuted(true)
    for (let index = 0; index < 10; index += 1) {
      audio.setLevels({ ...DEFAULT_AUDIO_LEVELS })
      audio.play('record')
      await vi.advanceTimersByTimeAsync(20)
    }
    expect(context.suspend).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(context.oscillators.every(source => source.disconnect.mock.calls.length > 0)).toBe(true)
  })

  it('cannot be resumed by a late promise after a pause', async () => {
    const audio = new GardenAudio()
    audio.setPaused(true)
    audio.unlock()
    const context = FakeContext.instances[0]
    let finish!: () => void
    context.resume.mockImplementationOnce(() => new Promise(resolve => { finish = () => { context.state = 'running'; resolve() } }))
    audio.setPaused(false)
    audio.setPaused(true)
    finish()
    await vi.advanceTimersByTimeAsync(50)
    expect(context.state).toBe('suspended')
    expect(context.oscillators).toHaveLength(0)
  })

  it('uses independent buses and true silence for a zero channel or master', async () => {
    const { audio, context } = await ready()
    expect(context.gains.slice(1, 4).map(gain => gain.connect.mock.calls[0][0])).toEqual([context.gains[0], context.gains[0], context.gains[0]])
    audio.setLevels({ ...DEFAULT_AUDIO_LEVELS, music: 0, effects: 0 })
    audio.play('place')
    expect(context.oscillators).toHaveLength(0)
    audio.play('ui')
    expect(context.oscillators).toHaveLength(1)
    audio.setLevels({ ...DEFAULT_AUDIO_LEVELS, master: 0 })
    await vi.advanceTimersByTimeAsync(50)
    expect(context.gains[0].gain.value).toBe(0)
    expect(context.state).toBe('suspended')
    audio.play('line')
    expect(context.oscillators).toHaveLength(1)
  })

  it('stops music when only its channel is zero while allowing effects', async () => {
    const { audio, context } = await ready(.32)
    audio.setLevels({ ...DEFAULT_AUDIO_LEVELS, music: 0 })
    await vi.advanceTimersByTimeAsync(3000)
    expect(vi.getTimerCount()).toBe(0)
    expect(context.state).toBe('running')
    const count = context.oscillators.length
    audio.play('place')
    expect(context.oscillators).toHaveLength(count + 2)
  })

  it('disconnects completed nodes and limits rapid overlapping effects', async () => {
    const { audio, context } = await ready()
    for (let index = 0; index < 20; index += 1) {
      audio.play('bloom')
      await vi.advanceTimersByTimeAsync(30)
      const live = [...context.oscillators, ...context.buffers].filter(source => source.disconnect.mock.calls.length === 0)
      expect(live.length).toBeLessThanOrEqual(48)
    }
    await vi.advanceTimersByTimeAsync(2000)
    expect([...context.oscillators, ...context.buffers].every(source => source.disconnect.mock.calls.length > 0)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('game sounds and paused-menu preview', () => {
  it('has distinct sound signatures for each ability', async () => {
    const signatures = []
    for (const kind of ['place', 'line', 'bloom', 'dew', 'prune', 'ui', 'record'] as GardenSound[]) {
      const { audio, context } = await ready()
      audio.play(kind)
      signatures.push(JSON.stringify({ notes: context.oscillators.map(source => source.frequency.setValueAtTime.mock.calls[0][0]), noise: context.buffers.length }))
      await vi.advanceTimersByTimeAsync(2000)
    }
    expect(new Set(signatures).size).toBe(7)
  })

  it('varies repeated flower placements', async () => {
    const { audio, context } = await ready()
    audio.play('place')
    await vi.advanceTimersByTimeAsync(250)
    audio.play('place')
    expect(context.oscillators[0].frequency.setValueAtTime.mock.calls[0][0]).not.toBe(context.oscillators[2].frequency.setValueAtTime.mock.calls[0][0])
  })

  it.each(['place', 'line', 'bloom', 'dew', 'prune'] as GardenSound[])('lets a record fanfare follow %s in the same move without duplicate fanfares', async kind => {
    const { audio, context } = await ready()
    audio.play(kind)
    const before = context.oscillators.length
    audio.play('record')
    const withRecord = context.oscillators.length
    expect(withRecord).toBe(before + 11)
    audio.play('record')
    expect(context.oscillators).toHaveLength(withRecord)
  })

  it('previews only the chosen effect, never music, and suspends again', async () => {
    const audio = new GardenAudio()
    audio.setPaused(true)
    audio.preview('ui')
    await vi.advanceTimersByTimeAsync(1)
    const context = FakeContext.instances[0]
    expect(context.oscillators).toHaveLength(1)
    audio.play('bloom')
    expect(context.oscillators).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(context.state).toBe('suspended')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a preview on a repeated lifecycle pause', async () => {
    const audio = new GardenAudio()
    audio.setPaused(true)
    audio.preview('place')
    await vi.advanceTimersByTimeAsync(1)
    audio.setPaused(true)
    await vi.advanceTimersByTimeAsync(50)
    expect(FakeContext.instances[0].state).toBe('suspended')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never overrides mute or zero volume for a preview', () => {
    const audio = new GardenAudio()
    audio.setMuted(true)
    audio.preview('place')
    audio.setMuted(false)
    audio.setLevels({ ...DEFAULT_AUDIO_LEVELS, ui: 0 })
    audio.preview('ui')
    expect(FakeContext.instances).toHaveLength(0)
  })
})
