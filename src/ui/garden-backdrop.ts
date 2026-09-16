import type { GardenZoneId } from '../game/garden'
import { gardenAtmosphere } from './garden-atmosphere'

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
  const layer = document.createElement('div')
  layer.className = 'garden-living-layer'
  layer.dataset.zone = zone
  layer.innerHTML = gardenAtmosphere(zone)
  host.append(image)
  host.append(layer)
  document.body.dataset.garden = zone
  if (!previous.length) { image.classList.add('is-visible'); layer.classList.add('is-visible') }
  else requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!image.isConnected) return
    image.classList.add('is-visible')
    layer.classList.add('is-visible')
    window.setTimeout(() => previous.forEach(element => element.remove()), 700)
  }))
}
