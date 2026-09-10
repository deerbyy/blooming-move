export interface FlowerMotion { angle: number; scale: number; lift: number }

/** Visual time only: no randomness, game state, rewards or real-world idle timers. */
export function flowerMotion(time: number, seed: number, enabled = true): FlowerMotion {
  if (!enabled) return { angle: 0, scale: 1, lift: 0 }
  const phase = seed * 1.618
  const breath = Math.sin(time / 940 + phase)
  return {
    angle: Math.sin(time / 1250 + phase) * .028,
    scale: 1 + (breath + 1) * .009,
    lift: Math.sin(time / 1150 + phase * .7) * .009
  }
}
