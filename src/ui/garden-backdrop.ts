import type { GardenZoneId } from '../game/garden'

/** Decode before swapping so slow downloads never flash an empty background. */
export async function setGardenBackdrop(host: HTMLElement, zone: GardenZoneId): Promise<void> {
  if (host.dataset.requestedGarden === zone) return
  host.dataset.requestedGarden = zone
  const image = new Image()
  image.alt = ''
  image.className = 'garden-backdrop'
  image.src = `assets/art/garden-${zone}.webp`
  try {
    await image.decode()
  } catch {
    // Leave the last successful painting (or the original CSS fallback) visible.
    return
  }
  if (host.dataset.requestedGarden !== zone || !host.isConnected) return
  const previous = Array.from(host.children)
  host.append(image)
  document.body.dataset.garden = zone
  if (!previous.length) image.classList.add('is-visible')
  else requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!image.isConnected) return
    image.classList.add('is-visible')
    window.setTimeout(() => previous.forEach(element => element.remove()), 700)
  }))
}
