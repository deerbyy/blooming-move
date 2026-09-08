/** A small deterministic PRNG. It makes a daily puzzle repeatable without a server. */
export function nextRandom(seed: number): [number, number] {
  const next = (seed * 1664525 + 1013904223) >>> 0
  return [next, next / 0x100000000]
}

export function seedFromText(text: string): number {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function randomSeed(): number {
  const cryptoSeed = globalThis.crypto?.getRandomValues?.(new Uint32Array(1))[0]
  return cryptoSeed ?? Math.floor(Math.random() * 0xffffffff)
}
