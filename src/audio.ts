import { DEFAULT_AUDIO_LEVELS, normalizeAudioLevels, type AudioChannel, type AudioLevels } from './audio-settings'

export { DEFAULT_AUDIO_LEVELS, normalizeAudioLevels } from './audio-settings'
export type { AudioChannel, AudioLevels } from './audio-settings'
export type GardenSound = 'place' | 'line' | 'bloom' | 'dew' | 'prune' | 'ui' | 'record'

type Bus = Exclude<AudioChannel, 'master'>
type Voice = { source: AudioScheduledSourceNode; nodes: AudioNode[]; bus: Bus; stopping?: boolean }

/** Original, asset-free soundscape. Audio is never initialized by a render/update. */
export class GardenAudio {
  private context: AudioContext | null = null
  private buses: Record<AudioChannel, GainNode> | null = null
  private levels: AudioLevels = { ...DEFAULT_AUDIO_LEVELS }
  private muted = false
  private paused = false
  private voices = new Set<Voice>()
  private noise: AudioBuffer | null = null
  private musicTimer: ReturnType<typeof setTimeout> | null = null
  private suspendTimer: ReturnType<typeof setTimeout> | null = null
  private resumeRequest: Promise<void> | null = null
  private pendingSound: GardenSound | null = null
  private previewKind: 'place' | 'ui' | null = null
  private previewTimer: ReturnType<typeof setTimeout> | null = null
  private transport = 0
  private nextBeat = 0
  private beat = 0
  private variation = 0
  private lastEffectAt = -Infinity
  private lastUiAt = -Infinity
  private lastRecordAt = -Infinity

  setLevels(levels: AudioLevels): void {
    const previous = this.levels
    const next = normalizeAudioLevels(levels)
    if ((Object.keys(next) as AudioChannel[]).every(channel => next[channel] === previous[channel])) return
    this.levels = next
    if (this.buses && this.context) {
      for (const bus of ['music', 'effects', 'ui'] as const) {
        this.fade(this.buses[bus].gain, this.levels[bus])
        if (this.levels[bus] === 0 && previous[bus] !== 0) this.stopVoices(bus)
      }
    }
    this.sync()
  }

  setMuted(muted: boolean): void {
    if (this.muted === muted) return
    this.muted = muted
    if (muted) this.clearPreview()
    this.sync()
  }

  setPaused(paused: boolean): void {
    const cancelPreview = paused && this.previewKind !== null
    if (cancelPreview) this.clearPreview()
    if (this.paused === paused && !cancelPreview) return
    this.paused = paused
    this.sync()
  }

  /** A short explicit settings preview, never a music/background restart. */
  preview(kind: 'place' | 'ui'): void {
    const channel = kind === 'ui' ? 'ui' : 'effects'
    if (this.muted || this.levels.master === 0 || this.levels[channel] === 0) return
    this.clearPreview()
    this.previewKind = kind
    this.unlock()
    this.play(kind)
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null
      this.previewKind = null
      this.sync()
    }, 440)
  }

  /** Call directly from a trusted pointer/keyboard gesture, including unmute. */
  unlock(): void {
    if (!this.context) {
      try {
        const Audio = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Audio) return
        const context = new Audio()
        this.context = context
        const master = context.createGain()
        const music = context.createGain()
        const effects = context.createGain()
        const ui = context.createGain()
        master.gain.value = 0
        for (const [bus, name] of [[music, 'music'], [effects, 'effects'], [ui, 'ui']] as const) {
          bus.gain.value = this.levels[name]
          bus.connect(master)
        }
        master.connect(context.destination)
        this.buses = { master, music, effects, ui }
        this.noise = this.makeNoise(context)
      } catch {
        try { void this.context?.close().catch(() => undefined) } catch { /* Failed browser initialization. */ }
        this.context = null
        this.buses = null
        return
      }
    }
    this.sync()
  }

  play(kind: GardenSound): void {
    const context = this.context
    const bus: Bus = kind === 'ui' ? 'ui' : 'effects'
    if (this.paused && this.previewKind !== kind) return
    if (!context || !this.buses || !this.audible || this.levels[bus] === 0) return
    if (context.state !== 'running') {
      // Preserve the first gesture's feedback while unlock is still resolving.
      if (this.resumeRequest) this.pendingSound = kind
      return
    }
    const at = context.currentTime + .006
    // Fast pointer/keyboard repeats cannot accumulate unlimited voices.
    if (kind === 'record') {
      // The record belongs to the same move as a placement/clear. Give its
      // celebration priority without stacking repeated record notifications.
      if (at - this.lastRecordAt < 1.2) return
      this.lastRecordAt = at
    } else if (bus === 'ui') {
      if (at - this.lastUiAt < .045) return
      this.lastUiAt = at
    } else {
      if (at - this.lastEffectAt < .025) return
      this.lastEffectAt = at
    }
    this.variation += 1
    const pitch = 1 + [0, .027, -.022, .014, -.012][this.variation % 5]
    switch (kind) {
      case 'place':
        // A quiet, rounded drop: shallow pitch movement and a soft attack.
        this.tone(bus, 300 * pitch, at, .28, .085, 'sine', 245 * pitch, .035)
        this.tone(bus, 440 * pitch, at + .025, .22, .014, 'sine', 405 * pitch, .04)
        break
      case 'ui':
        this.tone(bus, 640 * pitch, at, .085, .09, 'sine', 760 * pitch)
        break
      case 'line':
        [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => this.bell(bus, frequency, at + index * .065, .43, .065))
        this.rustle(bus, at + .04, .24, .025, 2900)
        break
      case 'bloom':
        this.tone(bus, 145, at, .62, .15, 'sine', 74)
        ;[392, 523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((frequency, index) => this.bell(bus, frequency, at + index * .062, .68, .068))
        this.rustle(bus, at + .06, .65, .055, 1700)
        break
      case 'dew':
        this.tone(bus, 1150, at, .27, .135, 'sine', 430)
        this.tone(bus, 1750, at + .09, .22, .07, 'sine', 850)
        this.bell(bus, 1318.5, at + .19, .5, .03)
        break
      case 'prune':
        this.rustle(bus, at, .075, .095, 3600)
        this.rustle(bus, at + .09, .1, .075, 2200)
        this.tone(bus, 280, at, .09, .09, 'triangle', 170)
        this.bell(bus, 783.99, at + .12, .3, .065)
        break
      case 'record':
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((frequency, index) => this.bell(bus, frequency, at + index * .115, .82, .085))
        this.tone(bus, 261.63, at + .35, .9, .075, 'sine')
        break
    }
  }

  private get audible(): boolean {
    return !this.muted && (!this.paused || this.previewKind !== null) && this.levels.master > 0 &&
      (this.levels.music > 0 || this.levels.effects > 0 || this.levels.ui > 0)
  }

  private sync(): void {
    const context = this.context
    if (!context || !this.buses || context.state === 'closed') return
    if (!this.audible) {
      this.pendingSound = null
      this.transport += 1
      this.stopMusic()
      this.fade(this.buses.master.gain, 0)
      this.stopVoices()
      if (this.suspendTimer === null && context.state !== 'suspended') {
        this.suspendTimer = setTimeout(() => {
          this.suspendTimer = null
          if (!this.audible && context.state !== 'closed') {
            try { void context.suspend().catch(() => undefined) } catch { /* Unsupported lifecycle. */ }
          }
        }, 40)
      }
      return
    }
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer)
    this.suspendTimer = null
    this.fade(this.buses.master.gain, this.levels.master)
    if (context.state === 'running') {
      this.syncMusic()
      return
    }
    if (this.resumeRequest) return
    const transport = this.transport
    try {
      this.resumeRequest = context.resume().then(() => {
        if (!this.audible || transport !== this.transport) {
          this.sync()
          return
        }
        if (context.state === 'running') {
          this.syncMusic()
          const sound = this.pendingSound
          this.pendingSound = null
          if (sound) this.play(sound)
        }
      }).catch(() => {
        // A denied resume may be retried by the next real gesture.
        this.pendingSound = null
      }).finally(() => { this.resumeRequest = null })
    } catch {
      this.resumeRequest = null
    }
  }

  private syncMusic(): void {
    if (!this.audible || this.paused || this.levels.music === 0 || this.context?.state !== 'running') {
      this.stopMusic()
      return
    }
    if (this.musicTimer !== null) return
    this.nextBeat = this.context.currentTime + .06
    this.tickMusic()
  }

  private tickMusic(): void {
    const context = this.context
    if (!context || !this.audible || this.paused || this.levels.music === 0 || context.state !== 'running') {
      this.stopMusic()
      return
    }
    // Only 180 ms look-ahead: background throttling never schedules a backlog.
    if (this.nextBeat < context.currentTime - .2) this.nextBeat = context.currentTime + .06
    if (this.nextBeat <= context.currentTime + .18) {
      const at = this.nextBeat
      const bar = Math.floor(this.beat / 8) % 4
      const chords = [[261.63, 329.63, 392, 493.88], [220, 261.63, 329.63, 392], [174.61, 220, 261.63, 329.63], [196, 246.94, 293.66, 392]]
      const chord = chords[bar]
      const phrase = [0, 2, 1, 3, 2, 1, 3, 2]
      this.bell('music', chord[phrase[this.beat % 8]] * 2, at, .95, .025)
      if (this.beat % 4 === 0) this.tone('music', chord[0] / 2, at, 1.65, .034, 'sine')
      if (this.beat % 8 === 3) this.tone('music', 1050, at + .08, .19, .014, 'sine', 380)
      if (this.beat % 8 === 6) this.rustle('music', at, 1.1, .012, 900)
      this.beat += 1
      this.nextBeat += .72
    }
    this.musicTimer = setTimeout(() => {
      this.musicTimer = null
      this.tickMusic()
    }, 120)
  }

  private stopMusic(): void {
    if (this.musicTimer !== null) clearTimeout(this.musicTimer)
    this.musicTimer = null
  }

  private clearPreview(): void {
    if (this.previewTimer !== null) clearTimeout(this.previewTimer)
    this.previewTimer = null
    this.previewKind = null
  }

  private fade(parameter: AudioParam, value: number): void {
    if (!this.context) return
    const now = this.context.currentTime
    parameter.cancelScheduledValues(now)
    parameter.setValueAtTime(parameter.value, now)
    parameter.linearRampToValueAtTime(value, now + .03)
  }

  private bell(bus: Bus, frequency: number, at: number, duration: number, gain: number): void {
    this.tone(bus, frequency, at, duration, gain, 'sine')
    this.tone(bus, frequency * 2.01, at, duration * .42, gain * .16, 'sine')
  }

  private tone(bus: Bus, frequency: number, at: number, duration: number, volume: number, type: OscillatorType, endFrequency = frequency, attack = .012): void {
    const context = this.context
    if (!context || !this.buses || this.voices.size >= 48 || this.levels[bus] === 0) return
    const source = context.createOscillator()
    const gain = context.createGain()
    source.type = type
    source.frequency.setValueAtTime(frequency, at)
    if (frequency !== endFrequency) source.frequency.exponentialRampToValueAtTime(endFrequency, at + duration)
    this.envelope(gain.gain, at, duration, volume, attack)
    source.connect(gain).connect(this.buses[bus])
    this.track(source, [source, gain], bus, at, duration)
  }

  private rustle(bus: Bus, at: number, duration: number, volume: number, frequency: number): void {
    const context = this.context
    if (!context || !this.buses || !this.noise || this.voices.size >= 48 || this.levels[bus] === 0) return
    const source = context.createBufferSource()
    source.buffer = this.noise
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = frequency
    filter.Q.value = .7
    const gain = context.createGain()
    this.envelope(gain.gain, at, duration, volume)
    source.connect(filter).connect(gain).connect(this.buses[bus])
    this.track(source, [source, filter, gain], bus, at, duration)
  }

  private envelope(parameter: AudioParam, at: number, duration: number, volume: number, attack = .012): void {
    parameter.setValueAtTime(0, at)
    parameter.linearRampToValueAtTime(volume, at + Math.min(attack, duration * .4))
    parameter.exponentialRampToValueAtTime(.0001, at + duration)
    parameter.setValueAtTime(0, at + duration + .005)
  }

  private track(source: AudioScheduledSourceNode, nodes: AudioNode[], bus: Bus, at: number, duration: number): void {
    const voice: Voice = { source, nodes, bus }
    this.voices.add(voice)
    source.onended = () => {
      for (const node of nodes) node.disconnect()
      this.voices.delete(voice)
    }
    source.start(at)
    source.stop(at + duration + .01)
  }

  private stopVoices(bus?: Bus): void {
    for (const voice of this.voices) {
      if (bus && voice.bus !== bus) continue
      if (voice.stopping) continue
      voice.stopping = true
      try { voice.source.stop(this.context!.currentTime + .035) } catch { /* Already ended. */ }
    }
  }

  private makeNoise(context: AudioContext): AudioBuffer {
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 1.8), context.sampleRate)
    const data = buffer.getChannelData(0)
    let seed = 0x51b100
    let softened = 0
    for (let index = 0; index < data.length; index += 1) {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      softened = softened * .64 + ((seed >>> 0) / 0xffffffff * 2 - 1) * .36
      data[index] = softened
    }
    return buffer
  }
}
