export type AudioChannel = 'master' | 'music' | 'effects' | 'ui'
export type AudioLevels = Record<AudioChannel, number>

export const DEFAULT_AUDIO_LEVELS: Readonly<AudioLevels> = Object.freeze({
  master: .7,
  music: .32,
  effects: .8,
  ui: .5
})

const CHANNELS: AudioChannel[] = ['master', 'music', 'effects', 'ui']

export function normalizeAudioLevels(value: unknown): AudioLevels {
  const input = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
  const result = { ...DEFAULT_AUDIO_LEVELS }
  for (const channel of CHANNELS) {
    const level = input[channel]
    if (typeof level === 'number' && Number.isFinite(level)) result[channel] = Math.min(1, Math.max(0, level))
  }
  return result
}

export function isAudioLevels(value: unknown): value is AudioLevels {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  return CHANNELS.every(channel => typeof input[channel] === 'number' && Number.isFinite(input[channel]) && input[channel] >= 0 && input[channel] <= 1)
}
