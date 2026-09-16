/** Announce an actual crossing, never a tied score or reloaded run already above it. */
export function crossedPersonalBest(previous: number, next: number, best: number): boolean {
  return [previous, next, best].every(value => Number.isSafeInteger(value) && value >= 0)
    && best > 0 && previous <= best && next > best
}
