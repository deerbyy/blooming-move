import './styles.css'
import { beginBloom, beginDew, beginPrune, challengeIdFor, createGame, finishRun, placePiece, revive, useBloom, useDew, usePrune } from './game/engine'
import { pieceBounds } from './game/shapes'
import { clearRun, isProgress, loadProgress, loadRun, mergeProgress, saveProgress, saveRun } from './game/storage'
import { BLOOM_THRESHOLD, BOARD_SIZE, type GameMode, type GameState, type Piece, type Point } from './game/types'
import { translator, type TranslationKey } from './i18n'
import { createPlatform, type LeaderboardEntry, type PlatformAdapter } from './platform'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Application root was not found.')
const root = app

let platform: PlatformAdapter
let t: (key: TranslationKey) => string
let game = loadRun()
let profile = loadProgress()
let selectedPiece: number | null = null
let hoverCell: Point | null = null
let framePointer: Point | null = null
let reviveSelection = false
let draggingPiece: number | null = null
let dragPoint: { x: number; y: number } | null = null
let hintKey: TranslationKey = 'choosePiece'
let toast = ''
let modal: 'intro' | 'modes' | 'garden' | 'leaderboard' | 'pause' | 'revive' | 'result' | 'controls' | null = null

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  gravity: number
  size: number
  life: number
  maxLife: number
  color: string
  kind: 'petal' | 'spark' | 'leaf'
}

interface CellPulse {
  x: number
  y: number
  until: number
  color: string
}

interface BoardEffect {
  style: 'line' | 'bloom' | 'dew' | 'prune'
  startedAt: number
  duration: number
  points: Point[]
  center: Point
}

let particles: Particle[] = []
let pulses: CellPulse[] = []
let effects: BoardEffect[] = []
let particleFrame = 0
let particleLast = 0
type FrameCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
const frameFoliageOpacity: Record<FrameCorner, number> = {
  'top-left': 1,
  'top-right': 1,
  'bottom-left': 1,
  'bottom-right': 1
}
let frameFoliageLast = performance.now()
let frameFoliageFrame = 0
interface FrameLayers {
  structure: HTMLCanvasElement
  foliage: HTMLCanvasElement
}
let frameLayers: FrameLayers | null = null

interface FoliageScratch {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  width: number
  height: number
  ratio: number
}
let foliageScratch: FoliageScratch | null = null

/** The supplied artwork stays independent from the game state, so cells can still animate separately. */
const assetRoot = new URL('assets/', document.baseURI).toString()
const boardTextures = {
  background: loadBoardTexture('board-background.png'),
  cell: loadBoardTexture('board-cell.png'),
  frame: loadBoardTexture('board-frame.png')
}

function loadBoardTexture(file: string): HTMLImageElement {
  const image = new Image()
  image.decoding = 'async'
  image.addEventListener('load', () => {
    if (file === 'board-frame.png') frameLayers = splitFrameLayers(image)
    drawBoard()
  })
  image.src = `${assetRoot}${file}`
  return image
}

function frameFlowerCenters(width: number, height: number): Record<FrameCorner, Point> {
  return {
    'top-left': { x: width * .105, y: height * .095 },
    'top-right': { x: width * .895, y: height * .095 },
    'bottom-left': { x: width * .105, y: height * .885 },
    'bottom-right': { x: width * .895, y: height * .885 }
  }
}

function splitFrameLayers(frame: HTMLImageElement): FrameLayers | null {
  try {
    const source = document.createElement('canvas')
    source.width = frame.naturalWidth
    source.height = frame.naturalHeight
    const sourceContext = source.getContext('2d', { willReadFrequently: true })
    if (!sourceContext) return null
    sourceContext.drawImage(frame, 0, 0)
    const original = sourceContext.getImageData(0, 0, source.width, source.height)
    const structure = new ImageData(new Uint8ClampedArray(original.data), source.width, source.height)
    const foliage = new ImageData(new Uint8ClampedArray(original.data.length), source.width, source.height)
    const centers = Object.values(frameFlowerCenters(source.width, source.height))
    // Foreground leaves fan farther toward the playable area than the flower's
    // centre. This larger corner envelope includes their outer tips as well.
    const flowerRadius = source.width * .23

    for (let pixel = 0; pixel < original.data.length; pixel += 4) {
      const sourceX = (pixel / 4) % source.width
      const sourceY = Math.floor(pixel / 4 / source.width)
      const liesOnCornerFlower = centers.some((center) => Math.hypot(sourceX - center.x, sourceY - center.y) < flowerRadius)
      if (!liesOnCornerFlower) continue
      const red = original.data[pixel]
      const green = original.data[pixel + 1]
      const blue = original.data[pixel + 2]
      const alpha = original.data[pixel + 3]
      // Flowers, their centres and the wooden frame stay anchored. Detect the
      // leaf hue rather than a fixed green-channel threshold: shaded tips are
      // much darker, while sunlit tips can be yellow-green. Keeping every
      // anti-aliased pixel in the foliage layer prevents isolated green chips
      // from being left in the revealed cell.
      const high = Math.max(red, green, blue)
      const low = Math.min(red, green, blue)
      const chroma = high - low
      const hue = chroma === 0
        ? 0
        : high === red
          ? 60 * (((green - blue) / chroma + 6) % 6)
          : high === green
            ? 60 * ((blue - red) / chroma + 2)
            : 60 * ((red - green) / chroma + 4)
      const isForegroundLeaf = alpha > 0
        && chroma > 13
        && hue >= 48
        && hue <= 168
      if (!isForegroundLeaf) continue
      structure.data[pixel + 3] = 0
      foliage.data[pixel] = red
      foliage.data[pixel + 1] = green
      foliage.data[pixel + 2] = blue
      foliage.data[pixel + 3] = alpha
    }

    const structureCanvas = document.createElement('canvas')
    structureCanvas.width = source.width
    structureCanvas.height = source.height
    structureCanvas.getContext('2d')?.putImageData(structure, 0, 0)
    const foliageCanvas = document.createElement('canvas')
    foliageCanvas.width = source.width
    foliageCanvas.height = source.height
    foliageCanvas.getContext('2d')?.putImageData(foliage, 0, 0)
    return { structure: structureCanvas, foliage: foliageCanvas }
  } catch {
    return null
  }
}

function getFoliageScratch(width: number, height: number, ratio: number): FoliageScratch | null {
  const pixelWidth = Math.max(1, Math.round(width * ratio))
  const pixelHeight = Math.max(1, Math.round(height * ratio))
  if (!foliageScratch || foliageScratch.width !== pixelWidth || foliageScratch.height !== pixelHeight || foliageScratch.ratio !== ratio) {
    const canvas = document.createElement('canvas')
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    const context = canvas.getContext('2d')
    if (!context) return null
    foliageScratch = { canvas, context, width: pixelWidth, height: pixelHeight, ratio }
  }
  const { context } = foliageScratch
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.globalCompositeOperation = 'source-over'
  context.globalAlpha = 1
  context.clearRect(0, 0, width, height)
  return foliageScratch
}

type IconName = 'mark' | 'gear' | 'sound' | 'muted' | 'help' | 'pause' | 'seed' | 'calendar' | 'glasshouse' | 'records' | 'bloom' | 'dew' | 'prune' | 'arrow' | 'flame' | 'crown' | 'user' | 'play'

function icon(name: IconName, label = ''): string {
  const paths: Record<IconName, string> = {
    mark: '<path d="M12 3.1c2.1 1.4 3.2 3.1 3.1 5.2 1.3-1.7 3.1-2.4 5.3-2.1.1 2.4-.9 4.2-3 5.3 2 .3 3.5 1.5 4.5 3.5-2.1 1.3-4.1 1.4-6.1.3.7 2 .2 3.9-1.5 5.6-1.8-1.5-2.5-3.3-2-5.4-1.8 1.3-3.9 1.3-6.1-.1.8-2.1 2.3-3.3 4.4-3.7-2-1-3-2.7-3-5.1 2.2-.4 4 .3 5.2 2-.2-2.2.9-3.9 3.2-5.4Z"/><circle cx="12.6" cy="12.3" r="1.55"/>',
    gear: '<path d="M12 3.8v2M12 18.2v2M20.2 12h-2M5.8 12h-2M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4M17.8 17.8l-1.4-1.4M7.6 7.6 6.2 6.2"/><circle cx="12" cy="12" r="4.1"/>',
    sound: '<path d="M4.1 13.9H7l4.1 3.3V6.8L7 10.1H4.1Z"/><path d="M14.2 9.2c1.2.8 1.8 1.7 1.8 2.8s-.6 2-1.8 2.8M17.2 6.6c2.2 1.5 3.3 3.3 3.3 5.4s-1.1 3.9-3.3 5.4"/>',
    muted: '<path d="M4.1 13.9H7l4.1 3.3V6.8L7 10.1H4.1Z"/><path d="m15.5 9.5 4.5 5M20 9.5l-4.5 5"/>',
    help: '<path d="M8.1 9.2c.2-2.1 1.7-3.3 3.9-3.3 2.1 0 3.7 1.2 3.7 3.1 0 1.5-.9 2.3-2.1 3.1-1.1.7-1.6 1.3-1.6 2.5"/><circle cx="12" cy="18" r=".75"/>',
    pause: '<path d="M8.2 5.8v12.4M15.8 5.8v12.4"/>',
    seed: '<path d="M12.1 3.8c3.5 2.3 5.1 5 4.7 8.1-.4 3.2-2.2 5.9-5.5 8.2-3.1-2.4-4.6-5.1-4.3-8.2.3-3.1 2-5.8 5.1-8.1Z"/><path d="M9.2 12.4c1.3-.4 2.5-.4 3.7.2 1.1.5 1.9 1.4 2.5 2.6M11.7 8.7c-.2 2.2-.9 4.2-2.1 5.8"/>',
    calendar: '<rect x="4.2" y="5.4" width="15.6" height="14.3" rx="2.4"/><path d="M7.8 3.8v3.4M16.2 3.8v3.4M4.2 10h15.6M8.1 14.2h.1M12 14.2h.1M15.9 14.2h.1"/>',
    glasshouse: '<path d="M4.1 20V10.7L12 4l7.9 6.7V20Z"/><path d="M8.2 20v-5.7h7.6V20M12 4v10.3M4.1 10.7h15.8"/><path d="M10.1 11.2c.5-1.5 1.4-2.2 2.7-2.2s2.2.7 2.7 2.2c-1.1.7-2.3.7-3.4 0-1.1.7-2.1.7-3.1 0Z"/>',
    records: '<path d="M5.3 19.2V9.8M11.9 19.2V4.8M18.5 19.2v-6.5"/><path d="M3.8 19.2h16.4"/><circle cx="5.3" cy="8" r="1.4"/><circle cx="11.9" cy="3.3" r="1.4"/><circle cx="18.5" cy="11.2" r="1.4"/>',
    bloom: '<path d="M12 11.9c-3.2-2.4-4.7-4.9-4.3-7.5 2.7.1 4.2 1.6 4.5 4.5.2-2.9 1.8-4.4 4.7-4.5.3 2.8-1.2 5.3-4.5 7.5 3.4-1.7 6-1.5 7.7.6-1.7 2.2-4.2 2.4-7.5.8 2.5 2.4 2.8 5 .9 7.7-2.6-1.1-3.5-3.4-2.6-7-1.7 3.4-4.2 4.5-7.3 3.1.2-2.9 2.1-4.5 5.8-4.8-3.6-.5-5.4-2.2-5.4-5.1 2.9-.8 5.5.3 7.8 3.2Z"/><circle cx="12.1" cy="12.5" r="1.7"/>',
    dew: '<path d="M12 3.2c3.9 4.5 5.8 7.7 5.8 9.8A5.8 5.8 0 1 1 6.2 13c0-2.1 1.9-5.3 5.8-9.8Z"/><path d="M9.3 14.3c.3 1.2 1 1.9 2.1 2.2"/>',
    prune: '<path d="M7.7 5.1a3.1 3.1 0 1 0 2.6 5l6.4 6.4M16.4 5.1a3.1 3.1 0 1 1-2.6 5L7.4 16.5"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="18" r="2.2"/>',
    arrow: '<path d="m8.2 5.5 7.2 6.5-7.2 6.5"/>',
    flame: '<path d="M13.8 3.3c.9 3.2-.7 4.7-2.4 6.1.1-2.1-.7-3.6-2.3-4.7-.6 2.1-2.9 4.2-2.9 7.1a5.8 5.8 0 0 0 11.6 0c0-2.7-1.4-5.1-4-8.5Z"/><path d="M12 20c-1.5-.8-2.2-2-2.2-3.4 0-1.1.6-2.2 1.8-3.3.3 1.4 1 2.3 2.1 2.8.7.3 1.1.9 1.1 1.7 0 1.3-1 2.2-2.8 2.2Z"/>',
    crown: '<path d="m4.1 8.2 4 3.2 3.9-6 3.9 6 4-3.2-1.8 9.3H5.9Z"/><path d="M5.9 20h12.2"/>',
    user: '<circle cx="12" cy="8" r="3.4"/><path d="M5.6 20c.6-3.6 2.8-5.5 6.4-5.5s5.8 1.9 6.4 5.5"/>',
    play: '<path d="m9 6.8 8 5.2-8 5.2Z" fill="currentColor" stroke="none"/>'
  }
  return `<svg class="ui-icon ui-icon-${name}" viewBox="0 0 24 24" aria-hidden="${label ? 'false' : 'true'}"${label ? ` aria-label="${label}" role="img"` : ''} fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`
}

const zoneThresholds = [0, 300, 800, 1500, 2500]
const zoneNames = {
  ru: ['Тёплая грядка', 'Розовая галерея', 'Пруд кувшинок', 'Лунный зимний сад', 'Купол цветов'],
  en: ['Warm bed', 'Rose gallery', 'Lily pond', 'Moon conservatory', 'Flower dome']
}

function currentChallenge(): string {
  return challengeIdFor()
}

function ensureGame(): GameState {
  if (!game) game = createGame('standard')
  return game
}

function colorFor(piece: Piece): string {
  return {
    coral: '#f38174',
    sun: '#f5ba4c',
    mint: '#65bda1',
    violet: '#9b7bc8',
    sky: '#70b5d6'
  }[piece.color]
}

function zoneCount(): number {
  return zoneThresholds.filter((threshold) => profile.nectar >= threshold).length
}

function modeName(mode: GameMode): string {
  return t(mode === 'daily' ? 'daily' : 'standard')
}

function pieceMarkup(piece: Piece, index: number): string {
  const bounds = pieceBounds(piece)
  const cells = piece.cells.map((cell, cellIndex) => `<i style="grid-column:${cell.x + 1};grid-row:${cell.y + 1};--piece:${colorFor(piece)};--petal:${(cellIndex + index) % 3}"></i>`).join('')
  const selected = selectedPiece === index ? ' is-selected' : ''
  return `<button class="piece-button${selected}" data-piece="${index}" aria-label="${t('choosePiece')}">
    <span class="piece-grid" style="--columns:${bounds.width};--rows:${bounds.height}">${cells}</span>
  </button>`
}

function layout(): void {
  root.innerHTML = `
    <main class="app-shell" aria-live="polite">
      <header class="topbar">
        <button class="brand" id="brand-button" aria-label="${t('title')}">
          <span class="brand-mark" aria-hidden="true">${icon('mark')}</span>
          <span><strong>${t('title')}</strong><small>${t('subtitle')}</small></span>
        </button>
        <div class="top-actions">
          <button class="icon-button" id="fullscreen-button" title="${t('settings')}" aria-label="${t('settings')}">${icon('gear')}</button>
          <button class="icon-button" id="sound-button" title="${profile.muted ? t('soundOff') : t('soundOn')}" aria-label="${profile.muted ? t('soundOff') : t('soundOn')}">${icon(profile.muted ? 'muted' : 'sound')}</button>
          <button class="icon-button profile-button" id="login-button" title="${platform.signedIn ? t('signedIn') : t('signIn')}" aria-label="${platform.signedIn ? t('signedIn') : t('signIn')}">${icon('user')}</button>
        </div>
      </header>

      <section class="game-layout">
        <section class="play-card" aria-label="${t('title')}">
          <section class="stats-shell" aria-label="${t('score')}">
            <div class="mode-row">
              <button class="mode-chip" id="mode-button"></button>
              <button class="text-button" id="controls-button">${icon('help')}<span>${t('controls')}</span></button>
            </div>
            <div class="score-row">
              <div class="score-card score-primary"><span>${icon('mark')}${t('score')}</span><strong id="score-value">0</strong><small id="lines-value">0</small></div>
              <div class="score-card score-combo"><span>${icon('flame')}${t('combo')}</span><strong id="combo-value">—</strong><small>${t('bloom')}</small></div>
              <div class="score-card"><span>${icon('crown')}${t('best')}</span><strong id="best-value">0</strong></div>
              <button class="nectar-card" id="garden-button"><span>${icon('seed')}${t('garden')}</span><strong><b id="nectar-value">0</b><em id="nectar-next">/ 300</em></strong><div class="mini-growth"><i></i></div></button>
            </div>
          </section>
          <div class="canvas-wrap" id="canvas-wrap">
            <canvas id="game-canvas" aria-label="${t('title')}"></canvas>
            <div class="combo-signal" id="combo-signal" aria-live="polite"><span id="combo-signal-kicker"></span><strong id="combo-signal-value"></strong></div>
          </div>
          <div class="game-meta">
            <div class="petal-meter"><span>${icon('bloom')}</span><div class="meter-track" aria-label="${t('bloom')}"><i id="petal-fill"></i></div><b id="petal-value">0/4</b></div>
          </div>
          <p class="hint" id="hint"></p>
          <section class="hand-section" aria-label="${t('choosePiece')}">
            <div class="hand-label"><span>${t('choosePiece')}</span><span class="weed-note" id="weed-note"></span></div>
            <div class="piece-hand" id="piece-hand"></div><button class="pause-button" id="pause-button" title="${t('pause')}" aria-label="${t('pause')}">${icon('pause')}<span>${t('pause')}</span></button>
          </section>
          <div class="cultivation-kit" aria-label="${t('tools')}">
            <button class="tool-button bloom-button" id="bloom-button">${icon('bloom')}<span><b>${t('useBloom')}</b><small id="bloom-charge">0/4</small></span></button>
            <button class="tool-button dew-button" id="dew-button">${icon('dew')}<span><b>${t('dew')}</b><small id="dew-charge">0</small></span></button>
            <button class="tool-button prune-button" id="prune-button">${icon('prune')}<span><b>${t('prune')}</b><small id="prune-charge">0</small></span></button>
          </div>
        </section>

        <aside class="side-panel">
          <section class="side-card daily-card">
            <div class="side-card-heading"><span class="leaf-icon">${icon('calendar')}</span><p>${t('daily')}</p></div>
            <strong id="daily-score">0</strong>
            <div class="challenge-blooms" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
            <div class="daily-results"><span>${t('personalBest')}<b id="daily-personal">0</b></span><span>${t('best')}<b>${icon('crown')}<i id="daily-top">0</i></b></span></div>
            <button class="compact-button" id="daily-button">${icon('play')}${t('start')}</button>
          </section>
          <section class="side-card greenhouse-card">
            <div class="side-card-heading"><span class="leaf-icon">${icon('glasshouse')}</span><p>${t('garden')}</p><strong id="zone-summary"></strong></div>
            <div class="greenhouse-sprouts" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
            <small id="zone-copy"></small>
            <button class="compact-button side-arrow" id="garden-side-button" aria-label="${t('garden')}">${icon('arrow')}</button>
          </section>
          <button class="leaderboard-card" id="leaderboard-button"><span>${icon('records')}</span><strong>${t('records')}</strong><i>${icon('arrow')}</i><small>${t('leaderboardHint')}</small></button>
        </aside>
      </section>
      <div id="toast" class="toast" role="status"></div>
      <div id="drag-ghost" class="drag-ghost" aria-hidden="true"></div>
      <div id="modal-host"></div>
    </main>`

  wireStaticControls()
}

function wireStaticControls(): void {
  document.querySelector<HTMLButtonElement>('#fullscreen-button')?.addEventListener('click', () => openModal('modes'))
  document.querySelector<HTMLButtonElement>('#sound-button')?.addEventListener('click', toggleSound)
  document.querySelector<HTMLButtonElement>('#login-button')?.addEventListener('click', () => void signIn())
  document.querySelector<HTMLButtonElement>('#garden-button')?.addEventListener('click', () => openModal('garden'))
  document.querySelector<HTMLButtonElement>('#garden-side-button')?.addEventListener('click', () => openModal('garden'))
  document.querySelector<HTMLButtonElement>('#leaderboard-button')?.addEventListener('click', () => void openLeaderboard())
  document.querySelector<HTMLButtonElement>('#mode-button')?.addEventListener('click', () => openModal('modes'))
  document.querySelector<HTMLButtonElement>('#daily-button')?.addEventListener('click', () => void switchMode('daily'))
  document.querySelector<HTMLButtonElement>('#controls-button')?.addEventListener('click', () => openModal('controls'))
  document.querySelector<HTMLButtonElement>('#pause-button')?.addEventListener('click', () => openModal('pause'))
  document.querySelector<HTMLButtonElement>('#bloom-button')?.addEventListener('click', activateBloom)
  document.querySelector<HTMLButtonElement>('#dew-button')?.addEventListener('click', activateDew)
  document.querySelector<HTMLButtonElement>('#prune-button')?.addEventListener('click', activatePrune)
  setupCanvas()
}

function setupCanvas(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')
  if (!canvas) return
  canvas.addEventListener('pointermove', (event) => {
    hoverCell = cellFromEvent(event, canvas)
    framePointer = framePointFromClient(event.clientX, event.clientY, canvas)
    dragPoint = draggingPiece === null ? null : { x: event.clientX, y: event.clientY }
    drawBoard()
  })
  canvas.addEventListener('pointerleave', () => {
    hoverCell = null
    framePointer = null
    drawBoard()
  })
  canvas.addEventListener('pointerdown', (event) => {
    if (draggingPiece !== null) return
    const cell = cellFromEvent(event, canvas)
    if (cell) handleBoardClick(cell)
  })
  window.addEventListener('resize', drawBoard)
}

function cellFromEvent(event: PointerEvent, canvas: HTMLCanvasElement): Point | null {
  return cellFromClientPoint(event.clientX, event.clientY, canvas)
}

function framePointFromClient(clientX: number, clientY: number, canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')): Point | null {
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const x = clientX - rect.left
  const y = clientY - rect.top
  return x >= 0 && y >= 0 && x <= rect.width && y <= rect.height ? { x, y } : null
}

function cellFromClientPoint(clientX: number, clientY: number, canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')): Point | null {
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const padding = boardPadding(rect.width)
  const cellSize = (rect.width - padding * 2) / BOARD_SIZE
  const x = Math.floor((clientX - rect.left - padding) / cellSize)
  const y = Math.floor((clientY - rect.top - padding) / cellSize)
  if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) return null
  return { x, y }
}

function beginPieceDrag(index: number, event: PointerEvent): void {
  const state = ensureGame()
  if (state.status !== 'playing' || !state.pieces[index]) return
  event.preventDefault()
  selectedPiece = index
  draggingPiece = index
  dragPoint = { x: event.clientX, y: event.clientY }
  document.body.classList.add('is-dragging')
  update()
  renderDragGhost()
}

function movePieceDrag(event: PointerEvent): void {
  if (draggingPiece === null) return
  dragPoint = { x: event.clientX, y: event.clientY }
  hoverCell = cellFromClientPoint(event.clientX, event.clientY)
  framePointer = framePointFromClient(event.clientX, event.clientY)
  renderDragGhost()
  drawBoard()
}

function endPieceDrag(event: PointerEvent): void {
  if (draggingPiece === null) return
  const cell = cellFromClientPoint(event.clientX, event.clientY)
  const wasDragging = draggingPiece
  draggingPiece = null
  dragPoint = null
  framePointer = framePointFromClient(event.clientX, event.clientY)
  document.body.classList.remove('is-dragging')
  renderDragGhost()
  if (cell && selectedPiece === wasDragging) handleBoardClick(cell)
  else drawBoard()
}

function renderDragGhost(): void {
  const ghost = document.querySelector<HTMLElement>('#drag-ghost')
  const state = game
  const piece = draggingPiece === null ? null : state?.pieces[draggingPiece]
  if (!ghost || !piece || !dragPoint) {
    ghost?.classList.remove('is-visible')
    return
  }
  const bounds = pieceBounds(piece)
  ghost.innerHTML = `<span class="piece-grid" style="--columns:${bounds.width};--rows:${bounds.height}">${piece.cells.map((cell, index) => `<i style="grid-column:${cell.x + 1};grid-row:${cell.y + 1};--piece:${colorFor(piece)};--petal:${index % 3}"></i>`).join('')}</span>`
  ghost.style.left = `${dragPoint.x}px`
  ghost.style.top = `${dragPoint.y - 26}px`
  ghost.classList.add('is-visible')
}

function originFor(piece: Piece, cell: Point): Point {
  const bounds = pieceBounds(piece)
  return { x: cell.x - Math.floor(bounds.width / 2), y: cell.y - Math.floor(bounds.height / 2) }
}

function handleBoardClick(cell: Point): void {
  const state = ensureGame()
  if (reviveSelection && state.status === 'awaiting-revive') {
    const result = revive(state, cell)
    if (!result.valid) {
      showToast(t('selectRevive'))
      return
    }
    reviveSelection = false
    game = result.state
    saveActiveRun()
    if (result.gameOver) finalizeRun()
    else {
      hintKey = 'choosePiece'
      update()
    }
    return
  }
  if (state.status === 'selecting-bloom') {
    const result = useBloom(state, cell)
    if (!result.valid) {
      showToast(t('bloomHint'))
      return
    }
    game = result.state
    hintKey = 'choosePiece'
    saveActiveRun()
    update()
    emitAbilityBurst(cell, 'bloom')
    return
  }
  if (state.status === 'selecting-dew') {
    const result = useDew(state, cell)
    if (!result.valid) {
      showToast(t('dewHint'))
      return
    }
    game = result.state
    hintKey = 'choosePiece'
    saveActiveRun()
    update()
    emitAbilityBurst(cell, 'dew')
    return
  }
  if (state.status === 'selecting-prune') {
    const result = usePrune(state, cell)
    if (!result.valid) {
      showToast(t('pruneHint'))
      return
    }
    game = result.state
    hintKey = 'choosePiece'
    saveActiveRun()
    update()
    emitAbilityBurst(cell, 'prune')
    return
  }
  if (state.status !== 'playing') return
  if (selectedPiece === null) {
    showToast(t('choosePiece'))
    return
  }
  const piece = state.pieces[selectedPiece]
  if (!piece) return
  const clearedPoints = clearedPointsForMove(state, piece, originFor(piece, cell))
  const result = placePiece(state, selectedPiece, originFor(piece, cell))
  if (!result.valid) {
    hintKey = 'invalidMove'
    document.querySelector('#canvas-wrap')?.classList.add('is-shaking')
    window.setTimeout(() => document.querySelector('#canvas-wrap')?.classList.remove('is-shaking'), 300)
    update()
    return
  }
  game = result.state
  selectedPiece = null
  hintKey = result.clearedLines > 1 ? 'bloomReady' : 'choosePiece'
  saveActiveRun()
  if (result.gameOver) {
    if (game.status === 'awaiting-revive') openModal('revive')
    else finalizeRun()
    return
  }
  update()
  emitPlacement(piece, originFor(piece, cell), clearedPoints, result.clearedLines, game.combo)
}

function selectPiece(index: number): void {
  const state = ensureGame()
  if (state.status !== 'playing' || !state.pieces[index]) return
  selectedPiece = selectedPiece === index ? null : index
  hintKey = 'choosePiece'
  update()
}

function activateBloom(): void {
  const state = ensureGame()
  if (!state.bloomReady) {
    showToast(`${state.petals}/${BLOOM_THRESHOLD} ${t('petals')}`)
    return
  }
  game = beginBloom(state)
  selectedPiece = null
  hintKey = 'bloomHint'
  saveActiveRun()
  update()
}

function activateDew(): void {
  const state = ensureGame()
  if (state.dew < 1) {
    showToast(t('dewHow'))
    return
  }
  game = beginDew(state)
  selectedPiece = null
  hintKey = 'dewHint'
  saveActiveRun()
  update()
}

function activatePrune(): void {
  const state = ensureGame()
  if (!state.pruneReady) {
    showToast(t('pruneHow'))
    return
  }
  game = beginPrune(state)
  selectedPiece = null
  hintKey = 'pruneHint'
  saveActiveRun()
  update()
}

function toggleSound(): void {
  profile = { ...profile, muted: !profile.muted }
  persistProfile()
  showToast(profile.muted ? t('soundOff') : t('soundOn'))
  update()
}

async function signIn(): Promise<void> {
  platform.gameplay(false)
  const signedIn = await platform.signIn()
  if (!signedIn) {
    showToast(t('signInHint'))
    if (!modal && game?.status === 'playing') platform.gameplay(true)
    return
  }
  const cloud = await platform.loadCloud()
  if (cloud && isProgress(cloud)) profile = mergeProgress(profile, cloud)
  persistProfile()
  showToast(t('signedIn'))
  if (!modal && game?.status === 'playing') platform.gameplay(true)
  update()
}

function persistProfile(): void {
  saveProgress(profile)
  void platform.saveCloud(profile)
}

function saveActiveRun(): void {
  if (game) saveRun(game)
  persistProfile()
}

function update(): void {
  const state = ensureGame()
  const score = document.querySelector<HTMLElement>('#score-value')
  const best = document.querySelector<HTMLElement>('#best-value')
  const nectar = document.querySelector<HTMLElement>('#nectar-value')
  const nectarNext = document.querySelector<HTMLElement>('#nectar-next')
  const lines = document.querySelector<HTMLElement>('#lines-value')
  const combo = document.querySelector<HTMLElement>('#combo-value')
  const petals = document.querySelector<HTMLElement>('#petal-value')
  const petalFill = document.querySelector<HTMLElement>('#petal-fill')
  const mode = document.querySelector<HTMLElement>('#mode-button')
  const hint = document.querySelector<HTMLElement>('#hint')
  const bloomButton = document.querySelector<HTMLButtonElement>('#bloom-button')
  const dewButton = document.querySelector<HTMLButtonElement>('#dew-button')
  const pruneButton = document.querySelector<HTMLButtonElement>('#prune-button')
  const bloomCharge = document.querySelector<HTMLElement>('#bloom-charge')
  const dewCharge = document.querySelector<HTMLElement>('#dew-charge')
  const pruneCharge = document.querySelector<HTMLElement>('#prune-charge')
  const hand = document.querySelector<HTMLElement>('#piece-hand')
  const dailyScore = document.querySelector<HTMLElement>('#daily-score')
  const dailyPersonal = document.querySelector<HTMLElement>('#daily-personal')
  const dailyTop = document.querySelector<HTMLElement>('#daily-top')
  const zoneSummary = document.querySelector<HTMLElement>('#zone-summary')
  const zoneCopy = document.querySelector<HTMLElement>('#zone-copy')
  const weedNote = document.querySelector<HTMLElement>('#weed-note')
  const toastElement = document.querySelector<HTMLElement>('#toast')
  const gardenScene = document.querySelector<HTMLElement>('#garden-scene')

  if (score) score.textContent = String(state.score)
  if (best) best.textContent = String(Math.max(profile.bestScore, state.score))
  if (nectar) nectar.textContent = String(profile.nectar)
  if (nectarNext) {
    const next = zoneThresholds.find((threshold) => threshold > profile.nectar) ?? zoneThresholds.at(-1)!
    nectarNext.textContent = `/ ${next.toLocaleString(platform.locale === 'ru' ? 'ru-RU' : 'en-US')}`
  }
  if (lines) lines.textContent = state.score > 0 ? `+${state.score}` : '—'
  if (combo) combo.textContent = state.combo > 0 ? `×${state.combo}` : '—'
  if (petals) petals.textContent = `${state.petals}/${BLOOM_THRESHOLD}`
  if (petalFill) petalFill.style.width = `${(state.petals / BLOOM_THRESHOLD) * 100}%`
  if (mode) mode.innerHTML = `${icon(state.mode === 'daily' ? 'calendar' : 'seed')}<span>${modeName(state.mode)}</span>`
  if (hint) hint.textContent = t(reviveSelection ? 'selectRevive' : hintKey)
  if (bloomButton) {
    bloomButton.disabled = !state.bloomReady || state.status !== 'playing'
    bloomButton.classList.toggle('is-ready', state.bloomReady)
    bloomButton.querySelector('b')!.textContent = state.bloomReady ? t('bloomReady') : t('useBloom')
  }
  if (bloomCharge) bloomCharge.textContent = `${state.petals}/${BLOOM_THRESHOLD}`
  if (dewButton) {
    dewButton.disabled = state.dew < 1 || state.status !== 'playing'
    dewButton.classList.toggle('is-ready', state.dew > 0)
    dewButton.querySelector('b')!.textContent = state.dew > 0 ? t('dewReady') : t('dew')
  }
  if (dewCharge) dewCharge.textContent = `×${state.dew}`
  if (pruneButton) {
    pruneButton.disabled = !state.pruneReady || state.status !== 'playing'
    pruneButton.classList.toggle('is-ready', state.pruneReady)
    pruneButton.querySelector('b')!.textContent = state.pruneReady ? t('pruneReady') : t('prune')
  }
  if (pruneCharge) pruneCharge.textContent = state.pruneReady ? '1/1' : '0/1'
  if (hand) {
    hand.innerHTML = state.pieces.map((piece, index) => piece ? pieceMarkup(piece, index) : `<div class="piece-empty" aria-hidden="true">${icon('seed')}</div>`).join('')
    hand.querySelectorAll<HTMLButtonElement>('[data-piece]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => beginPieceDrag(Number(button.dataset.piece), event))
      button.addEventListener('click', (event) => {
        if (event.detail === 0) selectPiece(Number(button.dataset.piece))
      })
    })
  }
  const dayScore = profile.dailyScores[currentChallenge()] ?? 0
  if (dailyScore) dailyScore.textContent = String(dayScore)
  if (dailyPersonal) dailyPersonal.textContent = String(dayScore)
  if (dailyTop) dailyTop.textContent = String(Math.max(profile.bestScore, dayScore))
  const zones = zoneCount()
  if (zoneSummary) zoneSummary.textContent = `${zones}/5`
  if (zoneCopy) zoneCopy.textContent = `${t('unlocked')} · ${zoneNames[platform.locale][Math.max(0, zones - 1)]}`
  document.querySelectorAll<HTMLElement>('.greenhouse-sprouts i').forEach((sprout, index) => {
    sprout.classList.toggle('is-unlocked', index < zones)
  })
  if (weedNote) weedNote.innerHTML = state.score >= 700 ? `${icon('seed')}<span>${t('weed')}</span>` : ''
  if (toastElement) toastElement.textContent = toast
  if (gardenScene) gardenScene.style.setProperty('--growth', String(zones))

  renderDragGhost()
  drawBoard()
  renderModal()
}

function drawRoundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath()
  context.roundRect(x, y, width, height, radius)
}

function drawFlower(context: CanvasRenderingContext2D, x: number, y: number, size: number, color = '#f5b98b', scale = 1): void {
  context.save()
  context.translate(x, y)
  context.scale(scale, scale)
  context.fillStyle = '#39674b'
  context.lineWidth = Math.max(1.2, size * 0.045)
  context.strokeStyle = '#39674b'
  context.beginPath()
  context.moveTo(0, size * .34)
  context.quadraticCurveTo(-size * .03, size * .08, 0, -size * .14)
  context.stroke()
  for (let index = 0; index < 6; index += 1) {
    context.rotate((Math.PI * 2) / 6)
    context.fillStyle = color
    context.beginPath()
    context.ellipse(0, -size * .19, size * .14, size * .28, .25, 0, Math.PI * 2)
    context.fill()
  }
  context.fillStyle = '#6c3d30'
  context.beginPath()
  context.arc(0, 0, size * .12, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = '#f2d27c'
  context.beginPath()
  context.arc(0, 0, size * .05, 0, Math.PI * 2)
  context.fill()
  context.restore()
}

function drawWeed(context: CanvasRenderingContext2D, x: number, y: number, cell: number): void {
  context.save()
  context.translate(x + cell / 2, y + cell * 0.76)
  context.strokeStyle = '#345b3c'
  context.lineWidth = Math.max(2, cell * 0.075)
  context.lineCap = 'round'
  for (const bend of [-0.28, 0, 0.28]) {
    context.beginPath()
    context.moveTo(0, 0)
    context.quadraticCurveTo(cell * bend, -cell * 0.18, cell * bend * 1.4, -cell * 0.52)
    context.stroke()
  }
  context.restore()
}

function drawSoilCell(context: CanvasRenderingContext2D, x: number, y: number, cell: number, seed: number): void {
  const radius = Math.max(5, cell * .17)
  drawRoundRect(context, x + 1.4, y + 1.4, cell - 2.8, cell - 2.8, radius)
  const soil = context.createLinearGradient(x, y, x + cell, y + cell)
  soil.addColorStop(0, 'rgba(72, 94, 61, .76)')
  soil.addColorStop(1, 'rgba(39, 70, 51, .9)')
  context.fillStyle = soil
  context.fill()
  context.strokeStyle = 'rgba(244, 218, 160, .08)'
  context.lineWidth = 1
  context.stroke()
  context.fillStyle = 'rgba(222, 192, 121, .13)'
  for (let index = 0; index < 3; index += 1) {
    const dotX = x + cell * (.18 + ((seed * 13 + index * 19) % 57) / 100)
    const dotY = y + cell * (.2 + ((seed * 23 + index * 11) % 54) / 100)
    context.beginPath()
    context.arc(dotX, dotY, Math.max(.55, cell * .017), 0, Math.PI * 2)
    context.fill()
  }
}

function drawBoardCell(context: CanvasRenderingContext2D, x: number, y: number, cell: number, seed: number): void {
  const texture = boardTextures.cell
  if (texture.complete && texture.naturalWidth) {
    // The source export contains a transparent generous bleed. Cropping that bleed makes the
    // cell read as truly occupied while preserving a crisp, soft gap between neighbouring cells.
    context.drawImage(texture, 170, 170, 914, 914, x + 1, y + 1, cell - 2, cell - 2)
    return
  }
  drawSoilCell(context, x, y, cell, seed)
}

function plantPalette(variant: number): { petal: string; light: string; dark: string; leaf: string; center: string } {
  return [
    { petal: '#d95d55', light: '#f3a36f', dark: '#a63f42', leaf: '#386b4c', center: '#6f382e' },
    { petal: '#dfa841', light: '#f7d276', dark: '#ad762d', leaf: '#397152', center: '#76472b' },
    { petal: '#af6b9b', light: '#dca0bd', dark: '#7c426f', leaf: '#397057', center: '#653f58' },
    { petal: '#4caa91', light: '#93d6ba', dark: '#277766', leaf: '#245f50', center: '#315c50' },
    { petal: '#559abb', light: '#9bcee0', dark: '#34728f', leaf: '#306569', center: '#34565f' }
  ][variant % 5]
}

function drawPlant(context: CanvasRenderingContext2D, x: number, y: number, cell: number, variant: number, scale = 1, alpha = 1): void {
  const palette = plantPalette(variant)
  context.save()
  context.translate(x + cell / 2, y + cell / 2)
  context.scale(scale, scale)
  context.globalAlpha = alpha
  const size = cell * .9
  const radius = Math.max(5, cell * .18)
  const gradient = context.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2)
  gradient.addColorStop(0, palette.light)
  gradient.addColorStop(.45, palette.petal)
  gradient.addColorStop(1, palette.dark)
  drawRoundRect(context, -size / 2, -size / 2, size, size, radius)
  context.fillStyle = gradient
  context.fill()
  context.lineWidth = Math.max(1, cell * .032)
  context.strokeStyle = 'rgba(39, 68, 50, .38)'
  context.stroke()

  // The flower occupies the whole tile: the silhouette remains as immediate as a classic block.
  context.globalAlpha = alpha * .34
  for (let index = 0; index < 6; index += 1) {
    context.rotate((Math.PI * 2) / 6)
    context.fillStyle = palette.light
    context.beginPath()
    context.ellipse(0, -cell * .2, cell * .18, cell * .34, .14, 0, Math.PI * 2)
    context.fill()
  }
  context.globalAlpha = alpha
  for (const side of [-1, 1]) {
    context.fillStyle = palette.leaf
    context.beginPath()
    context.ellipse(side * cell * .23, cell * .2, cell * .16, cell * .07, side * .48, 0, Math.PI * 2)
    context.fill()
  }
  context.fillStyle = palette.petal
  for (let index = 0; index < 5; index += 1) {
    context.rotate((Math.PI * 2) / 5)
    context.beginPath()
    context.ellipse(0, -cell * .13, cell * .13, cell * .24, .16, 0, Math.PI * 2)
    context.fill()
  }
  context.fillStyle = palette.center
  context.beginPath()
  context.arc(0, 0, cell * .115, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = 'rgba(255,245,199,.8)'
  context.beginPath()
  context.arc(-cell * .03, -cell * .035, cell * .036, 0, Math.PI * 2)
  context.fill()
  context.strokeStyle = 'rgba(255, 248, 209, .4)'
  context.lineWidth = Math.max(.7, cell * .02)
  context.beginPath()
  context.moveTo(-cell * .3, -cell * .32)
  context.quadraticCurveTo(0, -cell * .43, cell * .3, -cell * .3)
  context.stroke()
  context.restore()
}

function boardMeasurements(): { canvas: HTMLCanvasElement; rect: DOMRect; padding: number; cell: number } | null {
  const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  if (!rect.width) return null
  const padding = boardPadding(rect.width)
  return { canvas, rect, padding, cell: (rect.width - padding * 2) / BOARD_SIZE }
}

function boardPadding(width: number): number {
  // The supplied floral frame leaves a 13% transparent inner opening on every edge.
  // Reusing this exact inset for hit testing and drawing prevents a cell from peeking under a leaf.
  return Math.max(36, width * .13)
}

function pulseScale(x: number, y: number): number {
  const pulse = pulses.find((item) => item.x === x && item.y === y)
  if (!pulse) return 1
  const remaining = Math.max(0, (pulse.until - performance.now()) / 360)
  return 1 + Math.sin(remaining * Math.PI) * .18
}

function cornerForCell(point: Point): FrameCorner | null {
  if (point.x === 0 && point.y === 0) return 'top-left'
  if (point.x === BOARD_SIZE - 1 && point.y === 0) return 'top-right'
  if (point.x === 0 && point.y === BOARD_SIZE - 1) return 'bottom-left'
  if (point.x === BOARD_SIZE - 1 && point.y === BOARD_SIZE - 1) return 'bottom-right'
  return null
}

function hoveredFrameCorners(state: GameState): Set<FrameCorner> {
  const corners = new Set<FrameCorner>()
  if (hoverCell) {
    const directCorner = cornerForCell(hoverCell)
    if (directCorner) corners.add(directCorner)
  }

  // The flower extends slightly beyond the grid, so hovering its overhang should reveal the cell
  // too. This makes mouse and touch-drag behaviour match what the player sees.
  const measurements = boardMeasurements()
  if (framePointer && measurements) {
    const cornerExtent = measurements.padding + measurements.cell
    const { x, y } = framePointer
    if (x <= cornerExtent && y <= cornerExtent) corners.add('top-left')
    if (x >= measurements.rect.width - cornerExtent && y <= cornerExtent) corners.add('top-right')
    if (x <= cornerExtent && y >= measurements.rect.height - cornerExtent) corners.add('bottom-left')
    if (x >= measurements.rect.width - cornerExtent && y >= measurements.rect.height - cornerExtent) corners.add('bottom-right')
  }

  // A dragged multi-cell flower may reach a corner even when its anchor is adjacent to it.
  if (hoverCell && selectedPiece !== null && state.status === 'playing') {
    const piece = state.pieces[selectedPiece]
    if (piece) {
      const origin = originFor(piece, hoverCell)
      for (const part of piece.cells) {
        const corner = cornerForCell({ x: origin.x + part.x, y: origin.y + part.y })
        if (corner) corners.add(corner)
      }
    }
  }
  return corners
}

function updateFrameFoliageOpacity(state: GameState): Record<FrameCorner, number> {
  const hoveredCorners = hoveredFrameCorners(state)
  const now = performance.now()
  const elapsed = Math.min(64, Math.max(0, now - frameFoliageLast))
  frameFoliageLast = now
  // A longer response keeps the flower's movement organic instead of making it
  // look like a binary UI hover state. The same curve is used on the way back.
  const blend = 1 - Math.exp(-elapsed / 360)
  let needsAnotherFrame = false

  for (const corner of Object.keys(frameFoliageOpacity) as FrameCorner[]) {
    // Foreground leaves recede while the flower and the frame remain anchored.
    const target = hoveredCorners.has(corner) ? .43 : 1
    const next = frameFoliageOpacity[corner] + (target - frameFoliageOpacity[corner]) * blend
    frameFoliageOpacity[corner] = Math.abs(target - next) < .008 ? target : next
    needsAnotherFrame ||= Math.abs(target - frameFoliageOpacity[corner]) >= .008
  }

  if (needsAnotherFrame && !frameFoliageFrame) {
    frameFoliageFrame = requestAnimationFrame(() => {
      frameFoliageFrame = 0
      drawBoard()
    })
  }
  return frameFoliageOpacity
}

function cornerCell(corner: FrameCorner, padding: number, cell: number): Point {
  const index = BOARD_SIZE - 1
  return {
    'top-left': { x: padding, y: padding },
    'top-right': { x: padding + index * cell, y: padding },
    'bottom-left': { x: padding, y: padding + index * cell },
    'bottom-right': { x: padding + index * cell, y: padding + index * cell }
  }[corner]
}

function eraseFoliageDissolve(context: CanvasRenderingContext2D, corner: FrameCorner, padding: number, cell: number, progress: number): void {
  const tile = cornerCell(corner, padding, cell)
  // The broad feather clears overhanging tips gradually. A second, smaller
  // clear pass guarantees that no single anti-aliased leaf pixel can remain
  // above the playable part of the corner cell.
  const bleed = Math.max(5, cell * .27)
  const blur = Math.max(4, cell * .23)
  context.save()
  context.globalCompositeOperation = 'destination-out'
  context.globalAlpha = progress
  context.filter = `blur(${blur}px)`
  drawRoundRect(context, tile.x - bleed, tile.y - bleed, cell + bleed * 2, cell + bleed * 2, cell * .24)
  context.fill()
  context.filter = 'none'
  drawRoundRect(context, tile.x + 1, tile.y + 1, cell - 2, cell - 2, cell * .18)
  context.fill()
  context.restore()
}

function drawFrame(context: CanvasRenderingContext2D, rect: DOMRect, opacity: Record<FrameCorner, number>, ratio: number): void {
  const frame = boardTextures.frame
  if (!frame.complete || !frame.naturalWidth) return
  const layers = frameLayers
  if (!layers) {
    context.drawImage(frame, 0, 0, rect.width, rect.height)
    return
  }
  context.drawImage(layers.structure, 0, 0, rect.width, rect.height)
  const padding = boardPadding(rect.width)
  const cell = (rect.width - padding * 2) / BOARD_SIZE
  const scratch = getFoliageScratch(rect.width, rect.height, ratio)
  if (!scratch) {
    context.drawImage(layers.foliage, 0, 0, rect.width, rect.height)
    return
  }
  scratch.context.drawImage(layers.foliage, 0, 0, rect.width, rect.height)
  for (const corner of Object.keys(opacity) as FrameCorner[]) {
    // .43 is the settled state of the motion value. Convert it to 0…1 so the
    // centre of the reveal becomes fully transparent instead of merely dim.
    const progress = Math.max(0, Math.min(1, (1 - opacity[corner]) / .57))
    if (progress > .002) eraseFoliageDissolve(scratch.context, corner, padding, cell, progress)
  }
  context.drawImage(scratch.canvas, 0, 0, scratch.width, scratch.height, 0, 0, rect.width, rect.height)
}

function drawBoard(): void {
  const state = game
  const measurements = boardMeasurements()
  if (!measurements || !state) return
  const { canvas, rect, padding, cell } = measurements
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(rect.width * ratio)
  canvas.height = Math.round(rect.height * ratio)
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, rect.width, rect.height)

  const boardBackground = boardTextures.background
  if (boardBackground.complete && boardBackground.naturalWidth) {
    context.drawImage(boardBackground, 0, 0, rect.width, rect.height)
  } else {
    const outer = context.createLinearGradient(0, 0, rect.width, rect.height)
    outer.addColorStop(0, '#58795c')
    outer.addColorStop(.5, '#2f5a47')
    outer.addColorStop(1, '#234536')
    drawRoundRect(context, padding * .22, padding * .22, rect.width - padding * .44, rect.height - padding * .44, 25)
    context.fillStyle = outer
    context.fill()
  }

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const left = padding + x * cell
      const top = padding + y * cell
      drawBoardCell(context, left, top, cell, x * 13 + y * 29)
      const value = state.board[y][x]
      if (value === 'leaf') {
        drawPlant(context, left, top, cell, x * 7 + y * 11 + zoneCount(), pulseScale(x, y))
      } else if (value === 'weed') {
        context.fillStyle = 'rgba(120, 138, 67, .2)'
        drawRoundRect(context, left + 3, top + 3, cell - 6, cell - 6, Math.max(5, cell * .19))
        context.fill()
        drawWeed(context, left, top, cell)
      }
    }
  }

  const frameOpacity = updateFrameFoliageOpacity(state)
  drawFrame(context, rect, frameOpacity, ratio)

  if (hoverCell && selectedPiece !== null && state.status === 'playing') {
    const piece = state.pieces[selectedPiece]
    if (piece) {
      const origin = originFor(piece, hoverCell)
      const valid = piece.cells.every((part) => {
        const x = origin.x + part.x
        const y = origin.y + part.y
        return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE && state.board[y][x] === 'empty'
      })
      for (const part of piece.cells) {
        const x = origin.x + part.x
        const y = origin.y + part.y
        if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) continue
        drawRoundRect(context, padding + x * cell + 3, padding + y * cell + 3, cell - 6, cell - 6, Math.max(4, cell * .15))
        // A placement preview must read as a ghost, not as a second opaque
        // block layer peeking through the decorative frame.
        context.fillStyle = valid ? 'rgba(244, 214, 131, .12)' : 'rgba(224, 102, 75, .2)'
        context.fill()
        context.save()
        context.setLineDash([Math.max(2, cell * .1), Math.max(2, cell * .075)])
        context.strokeStyle = valid ? 'rgba(255, 238, 181, .68)' : 'rgba(243, 143, 112, .62)'
        context.lineWidth = Math.max(1, cell * .028)
        context.stroke()
        context.restore()
        drawPlant(context, padding + x * cell, padding + y * cell, cell, part.x * 5 + part.y * 3 + selectedPiece, .78, valid ? .42 : .34)
      }
    }
  }

  if (hoverCell && (state.status === 'selecting-bloom' || reviveSelection || state.status === 'selecting-prune' || state.status === 'selecting-dew')) {
    const isBloom = state.status === 'selecting-bloom'
    const isPrune = state.status === 'selecting-prune'
    const isDew = state.status === 'selecting-dew'
    const shade = isBloom ? 'rgba(244, 190, 104, .27)' : isPrune ? 'rgba(141, 201, 158, .25)' : isDew ? 'rgba(128, 198, 211, .29)' : 'rgba(116, 206, 172, .25)'
    const points: Point[] = isPrune
      ? Array.from({ length: BOARD_SIZE * 2 - 1 }, (_, index) => index < BOARD_SIZE ? { x: index, y: hoverCell!.y } : { x: hoverCell!.x, y: index - BOARD_SIZE < hoverCell!.y ? index - BOARD_SIZE : index - BOARD_SIZE + 1 })
      : isDew ? [hoverCell]
        : Array.from({ length: 9 }, (_, index) => ({ x: hoverCell!.x - 1 + (index % 3), y: hoverCell!.y - 1 + Math.floor(index / 3) }))
    for (const point of points) {
      const { x, y } = point
        if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) continue
        drawRoundRect(context, padding + x * cell + 3, padding + y * cell + 3, cell - 6, cell - 6, Math.max(4, cell * 0.15))
        context.fillStyle = shade
        context.fill()
    }
    if (isBloom) drawFlower(context, padding + (hoverCell.x + .5) * cell, padding + (hoverCell.y + .5) * cell, cell, '#f2bd79')
  }

  if (state.bloomReady && state.status === 'playing') {
    drawFlower(context, rect.width - padding * 1.45, padding * 1.45, padding * .95, '#f2c170')
  }
  drawEffects(context)
  drawParticles(context)
}

function clearedPointsForMove(state: GameState, piece: Piece, origin: Point): Point[] {
  const occupied = state.board.map((row) => [...row])
  for (const part of piece.cells) occupied[origin.y + part.y][origin.x + part.x] = 'leaf'
  const result = new Map<string, Point>()
  occupied.forEach((row, y) => {
    if (row.every((value) => value !== 'empty')) row.forEach((_, x) => result.set(`${x}:${y}`, { x, y }))
  })
  for (let x = 0; x < BOARD_SIZE; x += 1) {
    if (occupied.every((row) => row[x] !== 'empty')) {
      for (let y = 0; y < BOARD_SIZE; y += 1) result.set(`${x}:${y}`, { x, y })
    }
  }
  return [...result.values()]
}

function addBurst(point: Point, count: number, colors: string[], kind: Particle['kind'] = 'petal'): void {
  const measurements = boardMeasurements()
  if (!measurements) return
  const { padding, cell } = measurements
  const x = padding + (point.x + .5) * cell
  const y = padding + (point.y + .5) * cell
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count + Math.random() * .45
    const speed = cell * (.012 + Math.random() * .035)
    const life = 540 + Math.random() * 420
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - cell * .008,
      gravity: cell * .00006,
      size: cell * (.035 + Math.random() * .065),
      life,
      maxLife: life,
      color: colors[index % colors.length],
      kind
    })
  }
}

function emitPlacement(piece: Piece, origin: Point, cleared: Point[], clearedLines: number, combo: number): void {
  for (const part of piece.cells) {
    const point = { x: origin.x + part.x, y: origin.y + part.y }
    pulses.push({ ...point, until: performance.now() + 330, color: colorFor(piece) })
  }
  if (cleared.length) {
    effects.push({ style: 'line', startedAt: performance.now(), duration: 880, points: cleared, center: cleared[0] })
    const every = cleared.length > 12 ? 2 : 1
    cleared.filter((_, index) => index % every === 0).forEach((point) => addBurst(point, 6, ['#ffe19b', '#f5856e', '#faebbc'], 'petal'))
    showComboFanfare(clearedLines, combo)
  }
  startParticleLoop()
}

function emitAbilityBurst(center: Point, ability: 'bloom' | 'dew' | 'prune'): void {
  const colors = ability === 'bloom' ? ['#f6cc7b', '#f09488', '#f9ebbb'] : ability === 'dew' ? ['#9ed5d4', '#e5f1d1'] : ['#a9d08d', '#f1cd7a', '#e7e9bd']
  const points = ability === 'prune'
    ? Array.from({ length: BOARD_SIZE * 2 - 1 }, (_, index) => index < BOARD_SIZE ? { x: index, y: center.y } : { x: center.x, y: index - BOARD_SIZE < center.y ? index - BOARD_SIZE : index - BOARD_SIZE + 1 })
    : ability === 'bloom'
      ? Array.from({ length: 9 }, (_, index) => ({ x: center.x - 1 + index % 3, y: center.y - 1 + Math.floor(index / 3) })).filter((point) => point.x >= 0 && point.y >= 0 && point.x < BOARD_SIZE && point.y < BOARD_SIZE)
      : [center]
  effects.push({ style: ability, startedAt: performance.now(), duration: ability === 'bloom' ? 1100 : ability === 'dew' ? 760 : 950, points, center })
  if (ability === 'bloom') addBurst(center, 34, colors, 'petal')
  else if (ability === 'dew') addBurst(center, 16, colors, 'spark')
  else points.forEach((point, index) => { if (index % 2 === 0) addBurst(point, 3, colors, 'leaf') })
  startParticleLoop()
}

function showComboFanfare(lines: number, combo: number): void {
  const signal = document.querySelector<HTMLElement>('#combo-signal')
  const kicker = document.querySelector<HTMLElement>('#combo-signal-kicker')
  const value = document.querySelector<HTMLElement>('#combo-signal-value')
  if (!signal || !kicker || !value) return
  kicker.textContent = lines >= 2 ? t('doubleBloom') : t('streak')
  value.textContent = `×${Math.max(1, combo)}`
  signal.classList.remove('is-visible')
  void signal.offsetWidth
  signal.classList.add('is-visible')
  window.setTimeout(() => signal.classList.remove('is-visible'), 860)
}

function boardPoint(point: Point): { x: number; y: number; cell: number } | null {
  const measurements = boardMeasurements()
  if (!measurements) return null
  return {
    x: measurements.padding + (point.x + .5) * measurements.cell,
    y: measurements.padding + (point.y + .5) * measurements.cell,
    cell: measurements.cell
  }
}

function drawEffects(context: CanvasRenderingContext2D): void {
  const now = performance.now()
  for (const effect of effects) {
    const progress = Math.min(1, (now - effect.startedAt) / effect.duration)
    const fade = 1 - progress
    const center = boardPoint(effect.center)
    if (!center) continue
    context.save()
    if (effect.style === 'line') {
      effect.points.forEach((point, index) => {
        const pos = boardPoint(point)
        if (!pos) return
        const wave = Math.max(0, 1 - Math.abs(progress * 1.45 - index / Math.max(1, effect.points.length - 1)) * 5)
        if (!wave) return
        drawRoundRect(context, pos.x - pos.cell * .42, pos.y - pos.cell * .42, pos.cell * .84, pos.cell * .84, pos.cell * .17)
        context.fillStyle = `rgba(255, 224, 139, ${wave * fade * .72})`
        context.fill()
        context.strokeStyle = `rgba(255, 249, 208, ${wave * fade})`
        context.lineWidth = Math.max(1.5, pos.cell * .06)
        context.beginPath()
        context.moveTo(pos.x - pos.cell * .28, pos.y + pos.cell * .16)
        context.quadraticCurveTo(pos.x, pos.y - pos.cell * .23, pos.x + pos.cell * .3, pos.y + pos.cell * .03)
        context.stroke()
      })
    } else if (effect.style === 'bloom') {
      const radius = center.cell * (.22 + progress * 1.9)
      context.globalAlpha = fade
      for (let petal = 0; petal < 12; petal += 1) {
        context.save()
        context.translate(center.x, center.y)
        context.rotate(petal * Math.PI / 6 + progress * .7)
        context.fillStyle = petal % 2 ? '#f4a681' : '#f6d47b'
        context.beginPath()
        context.ellipse(0, -radius * .62, radius * .25, radius * .55, .12, 0, Math.PI * 2)
        context.fill()
        context.restore()
      }
      context.strokeStyle = '#fff1ae'
      context.lineWidth = Math.max(1.5, center.cell * .05)
      context.beginPath()
      context.arc(center.x, center.y, radius, 0, Math.PI * 2)
      context.stroke()
      drawFlower(context, center.x, center.y, center.cell * (1.3 + progress * .7), '#ffe5a0', 1)
    } else if (effect.style === 'dew') {
      context.globalAlpha = fade
      for (let ring = 0; ring < 3; ring += 1) {
        const radius = center.cell * (.16 + progress * (.35 + ring * .16))
        context.strokeStyle = ring === 0 ? '#d9fbef' : '#74cbd0'
        context.lineWidth = Math.max(1, center.cell * .038)
        context.beginPath()
        context.ellipse(center.x, center.y + center.cell * .09, radius, radius * .42, 0, 0, Math.PI * 2)
        context.stroke()
      }
      context.fillStyle = '#b8edf0'
      context.beginPath()
      context.ellipse(center.x, center.y - center.cell * .2 + progress * center.cell * .22, center.cell * .12, center.cell * .2, 0, 0, Math.PI * 2)
      context.fill()
    } else {
      context.globalAlpha = fade
      const rowY = center.y
      const colX = center.x
      const length = center.cell * 4.16 * Math.min(1, progress * 2.5)
      context.strokeStyle = '#d6efaf'
      context.lineWidth = Math.max(2.4, center.cell * .105)
      context.lineCap = 'round'
      context.beginPath()
      context.moveTo(colX - length, rowY)
      context.lineTo(colX + length, rowY)
      context.moveTo(colX, rowY - length)
      context.lineTo(colX, rowY + length)
      context.stroke()
      context.strokeStyle = '#4b946c'
      context.lineWidth = Math.max(1, center.cell * .035)
      context.beginPath()
      context.moveTo(colX - length, rowY + center.cell * .12)
      context.lineTo(colX + length, rowY + center.cell * .12)
      context.moveTo(colX + center.cell * .12, rowY - length)
      context.lineTo(colX + center.cell * .12, rowY + length)
      context.stroke()
    }
    context.restore()
  }
}

function drawParticles(context: CanvasRenderingContext2D): void {
  for (const particle of particles) {
    const alpha = Math.max(0, particle.life / particle.maxLife)
    context.save()
    context.globalAlpha = alpha * .92
    context.translate(particle.x, particle.y)
    context.fillStyle = particle.color
    if (particle.kind === 'petal') {
      context.rotate((particle.vx + particle.vy) * .08)
      context.beginPath()
      context.ellipse(0, 0, particle.size * 1.4, particle.size * .72, 0, 0, Math.PI * 2)
      context.fill()
    } else if (particle.kind === 'leaf') {
      context.rotate((particle.vx + particle.vy) * .08)
      context.beginPath()
      context.ellipse(0, 0, particle.size * 1.55, particle.size * .62, .5, 0, Math.PI * 2)
      context.fill()
      context.strokeStyle = 'rgba(37, 76, 50, .45)'
      context.lineWidth = Math.max(.6, particle.size * .2)
      context.beginPath()
      context.moveTo(-particle.size, particle.size * .2)
      context.lineTo(particle.size, -particle.size * .2)
      context.stroke()
    } else {
      context.beginPath()
      context.moveTo(0, -particle.size * 1.6)
      context.lineTo(particle.size * .55, -particle.size * .55)
      context.lineTo(particle.size * 1.6, 0)
      context.lineTo(particle.size * .55, particle.size * .55)
      context.lineTo(0, particle.size * 1.6)
      context.lineTo(-particle.size * .55, particle.size * .55)
      context.lineTo(-particle.size * 1.6, 0)
      context.lineTo(-particle.size * .55, -particle.size * .55)
      context.closePath()
      context.fill()
    }
    context.restore()
  }
}

function startParticleLoop(): void {
  if (particleFrame) return
  particleLast = performance.now()
  const frame = (now: number) => {
    const elapsed = Math.min(34, now - particleLast)
    particleLast = now
    particles = particles.filter((particle) => {
      particle.life -= elapsed
      particle.x += particle.vx * elapsed
      particle.y += particle.vy * elapsed
      particle.vy += particle.gravity * elapsed
      return particle.life > 0
    })
    pulses = pulses.filter((pulse) => pulse.until > now)
    effects = effects.filter((effect) => effect.startedAt + effect.duration > now)
    drawBoard()
    if (particles.length || pulses.length || effects.length) particleFrame = window.requestAnimationFrame(frame)
    else particleFrame = 0
  }
  particleFrame = window.requestAnimationFrame(frame)
}

function openModal(next: typeof modal): void {
  modal = next
  platform.gameplay(false)
  update()
}

function closeModal(): void {
  modal = null
  if (game?.status === 'playing') platform.gameplay(true)
  update()
}

function modalMarkup(title: string, content: string, compact = false, closeable = true): string {
  return `<div class="modal-backdrop"><section class="modal${compact ? ' modal-compact' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
    ${closeable ? `<button class="modal-close" data-close aria-label="${t('close')}">×</button>` : ''}<h2>${title}</h2>${content}</section></div>`
}

function renderModal(): void {
  const host = document.querySelector<HTMLElement>('#modal-host')
  if (!host) return
  if (!modal) {
    host.innerHTML = ''
    return
  }
  const state = ensureGame()
  if (modal === 'intro') {
    host.innerHTML = modalMarkup(t('introTitle'), `<p>${t('introText')}</p><div class="modal-illustration">${icon('bloom')}</div><button class="primary-button" data-start>${t('start')}</button>`, true)
  } else if (modal === 'modes') {
    host.innerHTML = modalMarkup(t('modeTitle'), `<p>${t('modeText')}</p><div class="mode-options">
      <button data-mode="standard"><span>${icon('seed')}</span><strong>${t('standard')}</strong><small>${t('subtitle')}</small></button>
      <button data-mode="daily"><span>${icon('calendar')}</span><strong>${t('daily')}</strong><small>${t('dailyHint')}</small></button>
    </div>`, true)
  } else if (modal === 'garden') {
    const zones = zoneThresholds.map((threshold, index) => {
      const unlocked = profile.nectar >= threshold
      const next = zoneThresholds[index + 1]
      return `<li class="zone ${unlocked ? 'is-unlocked' : ''}"><span>${icon(unlocked ? 'bloom' : 'seed')}</span><div><strong>${t('zone')} ${index + 1}: ${zoneNames[platform.locale][index]}</strong><small>${unlocked ? t('unlocked') : `${Math.max(0, threshold - profile.nectar)} ${t('nextZone').toLowerCase()}`}</small></div>${next ? `<em>${threshold}</em>` : `<em>${icon('mark')}</em>`}</li>`
    }).join('')
    host.innerHTML = modalMarkup(t('gardenTitle'), `<p>${t('gardenText')}</p><div class="nectar-total">${icon('seed')} ${profile.nectar}</div><ol class="zone-list">${zones}</ol>`, true)
  } else if (modal === 'leaderboard') {
    host.innerHTML = modalMarkup(t('leaderboardTitle'), `<p>${t('leaderboardHint')}</p><div class="leaderboard-list" id="leaderboard-list"><p>${t('loadingRecords')}</p></div><p class="personal-best">${t('personalBest')}: <strong>${profile.bestScore}</strong></p>`, true)
    void populateLeaderboard()
  } else if (modal === 'pause') {
    host.innerHTML = modalMarkup(t('pause'), `<p>${t('controlsText')}</p><button class="primary-button" data-resume>${t('resume')}</button>`, true)
  } else if (modal === 'revive') {
    host.innerHTML = modalMarkup(t('reviveTitle'), `<p>${t('reviveText')}</p><div class="modal-actions"><button class="secondary-button" data-finish>${t('finish')}</button><button class="primary-button" data-revive>${t('revive')}</button></div>`, true, false)
  } else if (modal === 'result') {
    const todayBest = state.mode === 'daily' ? `<p class="daily-result">${icon('calendar')} ${t('dayBest')}: <strong>${profile.dailyScores[currentChallenge()] ?? state.score}</strong></p>` : ''
    host.innerHTML = modalMarkup(t('gameOver'), `<div class="result-score">${state.score}</div><p>${profile.bestScore === state.score ? t('newBest') : t('resultText')}</p>${todayBest}<div class="modal-actions"><button class="secondary-button" data-mode-open>${t('daily')}</button><button class="primary-button" data-restart>${t('restart')}</button></div>`, true, false)
  } else if (modal === 'controls') {
    host.innerHTML = modalMarkup(t('controls'), `<p>${t('controlsText')}</p><p class="controls-extra">${t('bloomHint')} ${t('weedHint')}</p>`, true)
  }

  host.querySelector<HTMLElement>('[data-close]')?.addEventListener('click', closeModal)
  host.querySelector<HTMLElement>('[data-start]')?.addEventListener('click', () => {
    closeModal()
    platform.gameplay(true)
    void platform.requestFullscreen()
  })
  host.querySelector<HTMLElement>('[data-resume]')?.addEventListener('click', closeModal)
  host.querySelector<HTMLElement>('[data-mode-open]')?.addEventListener('click', () => openModal('modes'))
  host.querySelector<HTMLElement>('[data-restart]')?.addEventListener('click', () => void startNewRun(state.mode))
  host.querySelectorAll<HTMLElement>('[data-mode]').forEach((button) => button.addEventListener('click', () => void switchMode(button.dataset.mode as GameMode)))
  host.querySelector<HTMLElement>('[data-finish]')?.addEventListener('click', finalizeRun)
  host.querySelector<HTMLElement>('[data-revive]')?.addEventListener('click', () => void requestRevive())
}

async function populateLeaderboard(): Promise<void> {
  const entries = await platform.getLeaderboard()
  const target = document.querySelector<HTMLElement>('#leaderboard-list')
  if (!target || modal !== 'leaderboard') return
  target.innerHTML = leaderboardMarkup(entries)
}

async function openLeaderboard(): Promise<void> {
  openModal('leaderboard')
}

function leaderboardMarkup(entries: LeaderboardEntry[]): string {
  if (!entries.length) return `<p>${t('noRecords')}</p>`
  return entries.map((entry) => `<div class="leaderboard-entry"><span>#${entry.rank + 1}</span><strong>${entry.player.publicName || '—'}</strong><b>${entry.score}</b></div>`).join('')
}

async function requestRevive(): Promise<void> {
  const rewarded = await platform.showRewarded()
  if (!rewarded) {
    showToast(t('adUnavailable'))
    return
  }
  modal = null
  reviveSelection = true
  hintKey = 'selectRevive'
  update()
}

async function switchMode(mode: GameMode): Promise<void> {
  const state = ensureGame()
  if (state.mode === mode && state.status === 'playing') {
    closeModal()
    return
  }
  if (state.status === 'playing' && state.turn > 0 && !window.confirm(t('confirmNewRun'))) return
  await startNewRun(mode)
}

async function startNewRun(mode: GameMode): Promise<void> {
  game = createGame(mode, mode === 'daily' ? currentChallenge() : null)
  selectedPiece = null
  reviveSelection = false
  hintKey = 'choosePiece'
  modal = null
  saveActiveRun()
  await platform.requestFullscreen()
  platform.gameplay(true)
  update()
}

function finalizeRun(): void {
  const state = ensureGame()
  game = finishRun(state)
  const finalScore = game.score
  const previousBest = profile.bestScore
  const reward = Math.max(5, Math.floor(finalScore / 25) + game.bestCombo * 4)
  profile = {
    ...profile,
    nectar: profile.nectar + reward,
    bestScore: Math.max(profile.bestScore, finalScore),
    dailyScores: game.mode === 'daily' && game.challengeId
      ? { ...profile.dailyScores, [game.challengeId]: Math.max(profile.dailyScores[game.challengeId] ?? 0, finalScore) }
      : profile.dailyScores,
    completedRuns: profile.completedRuns + 1
  }
  clearRun()
  persistProfile()
  platform.gameplay(false)
  if (finalScore > previousBest) void platform.submitBestScore(finalScore)
  modal = 'result'
  update()
  void maybeInterstitial()
}

async function maybeInterstitial(): Promise<void> {
  const now = Date.now()
  if (profile.completedRuns % 2 !== 0 || now - profile.lastInterstitialAt < 120000) return
  profile = { ...profile, lastInterstitialAt: now }
  persistProfile()
  await platform.showInterstitial()
}

function showToast(message: string): void {
  toast = message
  const element = document.querySelector<HTMLElement>('#toast')
  if (element) {
    element.textContent = message
    element.classList.add('is-visible')
  }
  window.setTimeout(() => {
    toast = ''
    document.querySelector<HTMLElement>('#toast')?.classList.remove('is-visible')
  }, 2500)
}

async function bootstrap(): Promise<void> {
  platform = await createPlatform()
  t = translator(platform.locale)
  document.documentElement.lang = platform.locale
  if (!game || game.status === 'finished') {
    game = createGame('standard')
    modal = 'intro'
  } else if (game.status === 'awaiting-revive') {
    modal = 'revive'
  }
  layout()
  window.addEventListener('pointermove', movePieceDrag)
  window.addEventListener('pointerup', endPieceDrag)
  window.addEventListener('pointercancel', endPieceDrag)
  platform.markReady()
  update()
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) platform.gameplay(false)
    else if (!modal && game?.status === 'playing') platform.gameplay(true)
  })
}

void bootstrap()
