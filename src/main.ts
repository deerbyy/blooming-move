import './styles.css'
import { icon } from './ui/icons'
import { gardenScene, gardenNames, gardenDescriptions } from './ui/garden-view'
import { setGardenBackdrop } from './ui/garden-backdrop'
import { GARDEN_ZONES, availableGardenZones, nextGardenGoal, selectedGardenZone, selectGardenZone, nectarForRun, type GardenZoneId } from './game/garden'
import { guideMarkup, contextualHint } from './ui/game-guide'
import { flowerMotion } from './ui/flower-motion'
import { placementPreview, type PlacementPreview } from './ui/placement-preview'
import { beginBloom, beginDew, beginPrune, challengeIdFor, createGame, finishRun, placePiece, revive, useBloom, useDew, usePrune } from './game/engine'
import { pieceBounds } from './game/shapes'
import { clearRun, isProgress, loadProgress, loadRun, mergeProgress, saveProgress, saveRun } from './game/storage'
import { BLOOM_THRESHOLD, BOARD_SIZE, type GameMode, type GameState, type Piece, type PieceColor, type Point } from './game/types'
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
let gardenTime = 0
let lastBoardPaint = 0
let artworkRevision = 0
let boardSurface: HTMLCanvasElement | null = null
let boardSurfaceKey = ''
let previewHintCount = -1
let previewCache: { board: GameState['board']; piece: Piece; x: number; y: number; result: PlacementPreview } | null = null
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
let windowFocused = true
let inputReady = false
let revivePending = false
let signingIn = false
let lastGain = 0
let finalized = false
let runSetNewBest = false
let gardenPreview: GardenZoneId = selectedGardenZone(profile)
let modalOpener: HTMLElement | null = null
let earnedNectar = 0
let unlockedThisRun = 0
let soundContext: AudioContext | null = null
let keyboardCell: Point = { x: 0, y: 0 }
let keyboardActive = false
let dragPointerId: number | null = null
let toastTimer = 0
let fanfareTimer = 0
const texturePromises: Promise<void>[] = []

function isPaused(): boolean {
  return !inputReady || signingIn || !!modal || !windowFocused || document.hidden || !!platform?.paused
}
function cancelDrag(): void {
  draggingPiece = null
  dragPointerId = null
  dragPoint = null
  hoverCell = null
  document.body.classList.remove('is-dragging')
  renderDragGhost()
  drawBoard()
}
function syncActivity(notifyPlatform = true): void {
  if (isPaused()) {
    cancelDrag()
    void soundContext?.suspend()
  } else {
    if (!profile.muted) void soundContext?.resume()
    startParticleLoop()
  }
  if (notifyPlatform) platform.gameplay(inputReady && !signingIn && !modal && windowFocused && !document.hidden && game?.status !== 'finished')
  root.classList.toggle('is-paused', isPaused())
}
function playChime(kind: 'place' | 'line' | 'bloom' | 'dew' | 'prune'): void {
  if (isPaused() || profile.muted) return
  soundContext ??= new AudioContext()
  void soundContext.resume()
  const notes = { place: [392, 587], line: [523, 659, 784], bloom: [523, 659, 784, 1046], dew: [880, 1320], prune: [659, 988, 784] }[kind]
  notes.forEach((frequency, i) => {
    const oscillator = soundContext!.createOscillator()
    const gain = soundContext!.createGain()
    const at = soundContext!.currentTime + i * .065
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, at)
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(kind === 'place' ? .028 : .045, at + .012)
    gain.gain.exponentialRampToValueAtTime(.001, at + .32)
    oscillator.connect(gain).connect(soundContext!.destination)
    oscillator.start(at)
    oscillator.stop(at + .34)
  })
}

/** The supplied artwork stays independent from the game state, so cells can still animate separately. */
const assetRoot = new URL('assets/', document.baseURI).toString()
const boardTextures = {
  background: loadBoardTexture('art/board.webp'),
  cell: loadBoardTexture('art/cell.webp'),
  frame: loadBoardTexture('art/frame.webp'),
  flowers: {
    coral: loadBoardTexture('art/tile-coral.webp'),
    sun: loadBoardTexture('art/tile-sun.webp'),
    mint: loadBoardTexture('art/tile-mint.webp'),
    violet: loadBoardTexture('art/tile-violet.webp'),
    sky: loadBoardTexture('art/tile-sky.webp')
  } as Record<PieceColor, HTMLImageElement>
}

function loadBoardTexture(file: string): HTMLImageElement {
  const image = new Image()
  image.decoding = 'async'
  texturePromises.push(new Promise<void>((resolve) => {
    image.addEventListener('load', () => { artworkRevision++; drawBoard(); resolve() }, { once: true })
    image.addEventListener('error', () => resolve(), { once: true })
  }))
  image.src = `${assetRoot}${file}`
  return image
}

const zoneNames = gardenNames

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
  return availableGardenZones(profile.nectar).length
}

function modeName(mode: GameMode): string {
  return t(mode === 'daily' ? 'daily' : 'standard')
}

function pieceMarkup(piece: Piece, index: number): string {
  const bounds = pieceBounds(piece)
  const cells = piece.cells.map((cell) => `<i class="flower-tile tile-${piece.color}" style="grid-column:${cell.x + 1};grid-row:${cell.y + 1};--flower-phase:-${((index * 7 + cell.x * 3 + cell.y * 5) % 19) * .29}s;--flower-duration:${4.1 + ((index + cell.x + cell.y) % 5) * .35}s"></i>`).join('')
  const selected = selectedPiece === index ? ' is-selected' : ''
  return `<button class="piece-button${selected}" data-piece="${index}" aria-pressed="${selectedPiece === index}" aria-label="${index + 1}: ${piece.cells.length} ${t('cells')}">
    <span class="piece-grid" style="--columns:${bounds.width};--rows:${bounds.height}">${cells}</span>
  </button>`
}

function layout(): void {
  root.innerHTML = `
    <div class="garden-environment" aria-hidden="true"></div>
    <main class="app-shell">
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
              <div class="score-card score-combo"><span>${icon('flame')}${t('combo')}</span><strong id="combo-value">—</strong><small>${t('consecutiveClears')}</small></div>
              <div class="score-card"><span>${icon('crown')}${t('best')}</span><strong id="best-value">0</strong></div>
              <button class="nectar-card" id="garden-button"><span>${icon('seed')}${t('nectar')}</span><strong><b id="nectar-value">0</b><em id="nectar-next">/ 300</em></strong><div class="mini-growth"><i></i></div><small id="garden-next-label"></small></button>
            </div>
          </section>
          <div class="canvas-wrap" id="canvas-wrap">
            <canvas id="game-canvas" tabindex="0" role="application" aria-label="${t('boardControls')}"></canvas>
            <div class="combo-signal" id="combo-signal" aria-live="polite"><span id="combo-signal-kicker"></span><strong id="combo-signal-value"></strong></div>
          </div>
          <div class="game-meta">
            <div class="petal-meter"><span>${icon('bloom')}</span><div class="meter-track" aria-label="${t('bloom')}"><i id="petal-fill"></i></div><b id="petal-value">0/4</b></div>
          </div>
          <div class="hint-row"><p class="hint" id="hint" role="status"></p><button class="hint-help" id="quick-help-button" aria-label="${t('controls')}" title="${t('controls')}">${icon('help')}</button></div>
          <section class="hand-section" aria-label="${t('choosePiece')}">
            <div class="hand-label"><span>${icon('mark')}${t('chooseFlower')}</span><span class="weed-note" id="weed-note"></span></div>
            <div class="piece-hand" id="piece-hand"></div><button class="pause-button" id="pause-button" title="${t('pause')}" aria-label="${t('pause')}">${icon('pause')}<span>${t('pause')}</span></button>
          </section>
          <div class="cultivation-kit" aria-label="${t('tools')}">
            <button class="tool-button bloom-button" id="bloom-button" title="${t('bloomHint')}">${icon('bloom')}<span><b>${t('useBloom')}</b><small id="bloom-charge">0/4</small></span></button>
            <button class="tool-button dew-button" id="dew-button" title="${t('dewHow')}">${icon('dew')}<span><b>${t('dew')}</b><small id="dew-charge">0</small></span></button>
            <button class="tool-button prune-button" id="prune-button" title="${t('pruneHow')}">${icon('prune')}<span><b>${t('prune')}</b><small id="prune-charge">0</small></span></button>
          </div>
        </section>

        <aside class="side-panel">
          <section class="side-card daily-card">
            <div class="side-card-heading"><span class="leaf-icon">${icon('calendar')}</span><p>${t('daily')}</p></div>
            <small class="daily-goal-label">${t('dailyGoal')}</small><strong id="daily-score">2 000</strong>
            <div class="challenge-blooms" aria-hidden="true">${Array.from({length:7}, () => `<i>${icon('bloom')}</i>`).join('')}</div>
            <div class="daily-results"><span>${t('todayResult')}<b id="daily-personal">0</b></span><span>${t('personalBest')}<b>${icon('crown')}<i id="daily-top">0</i></b></span></div>
            <button class="compact-button" id="daily-button">${icon('play')}<span class="desktop-label">${t('start')}</span><span class="mobile-label">${t('daily')}</span></button>
          </section>
          <section class="side-card greenhouse-card">
            <button class="garden-card-open" id="garden-side-button"><span class="leaf-icon">${icon('glasshouse')}</span><span><strong>${t('garden')}</strong><b id="zone-summary"></b></span>${icon('arrow')}</button>
            <div class="garden-mini-scene" id="garden-mini-scene" aria-hidden="true"></div>
            <div class="greenhouse-sprouts" id="greenhouse-sprouts"></div>
            <small id="zone-copy"></small>
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
  document.querySelector<HTMLButtonElement>('#garden-button')?.addEventListener('click', () => openGarden())
  document.querySelector<HTMLButtonElement>('#garden-side-button')?.addEventListener('click', () => openGarden())
  document.querySelector<HTMLButtonElement>('#quick-help-button')?.addEventListener('click', () => openModal('controls'))
  document.querySelector<HTMLButtonElement>('#brand-button')?.addEventListener('click', () => openModal('controls'))
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
  canvas.addEventListener('contextmenu', (event) => event.preventDefault())
  canvas.addEventListener('keydown', (event) => {
    if (isPaused()) return
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(event.key)) {
      event.preventDefault()
      keyboardActive = true
      keyboardCell.x = Math.max(0, Math.min(BOARD_SIZE - 1, keyboardCell.x + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0)))
      keyboardCell.y = Math.max(0, Math.min(BOARD_SIZE - 1, keyboardCell.y + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0)))
      hoverCell = keyboardCell
      if (event.key === 'Enter' || event.key === ' ') handleBoardClick(keyboardCell)
      drawBoard()
    }
  })
  canvas.addEventListener('pointermove', (event) => {
    if (isPaused()) return
    keyboardActive = false
    hoverCell = cellFromEvent(event, canvas)

    dragPoint = draggingPiece === null ? null : { x: event.clientX, y: event.clientY }
    drawBoard()
  })
  canvas.addEventListener('pointerleave', () => {
    hoverCell = null

    drawBoard()
  })
  canvas.addEventListener('pointerdown', (event) => {
    if (isPaused() || draggingPiece !== null || !event.isPrimary || event.button !== 0) return
    const cell = cellFromEvent(event, canvas)
    if (cell) handleBoardClick(cell)
  })
  window.addEventListener('resize', drawBoard)
}

function cellFromEvent(event: PointerEvent, canvas: HTMLCanvasElement): Point | null {
  return cellFromClientPoint(event.clientX, event.clientY, canvas)
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
  if (isPaused() || !event.isPrimary || event.button !== 0) return
  dragPointerId = event.pointerId
  const state = ensureGame()
  if (state.status !== 'playing' || !state.pieces[index]) return
  event.preventDefault()
  hintKey = 'choosePiece'
  hoverCell = null
  keyboardActive = false
  selectedPiece = index
  draggingPiece = index
  dragPoint = { x: event.clientX, y: event.clientY }
  document.body.classList.add('is-dragging')
  update()
  renderDragGhost()
}

function movePieceDrag(event: PointerEvent): void {
  if (isPaused() || draggingPiece === null || event.pointerId !== dragPointerId) return
  dragPoint = { x: event.clientX, y: event.clientY }
  hoverCell = cellFromClientPoint(event.clientX, event.clientY)

  renderDragGhost()
  drawBoard()
}

function endPieceDrag(event: PointerEvent): void {
  if (draggingPiece === null || event.pointerId !== dragPointerId) return
  if (isPaused()) { cancelDrag(); return }
  dragPointerId = null
  const cell = cellFromClientPoint(event.clientX, event.clientY)
  const wasDragging = draggingPiece
  draggingPiece = null
  dragPoint = null

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
  ghost.innerHTML = `<span class="piece-grid" style="--columns:${bounds.width};--rows:${bounds.height}">${piece.cells.map((cell) => `<i class="flower-tile tile-${piece.color}" style="grid-column:${cell.x + 1};grid-row:${cell.y + 1}"></i>`).join('')}</span>`
  ghost.style.left = `${dragPoint.x}px`
  ghost.style.top = `${dragPoint.y - 26}px`
  ghost.classList.add('is-visible')
}

function originFor(piece: Piece, cell: Point): Point {
  const bounds = pieceBounds(piece)
  return { x: cell.x - Math.floor(bounds.width / 2), y: cell.y - Math.floor(bounds.height / 2) }
}

function handleBoardClick(cell: Point): void {
  if (isPaused()) return
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
    lastGain = game.score - state.score
    saveActiveRun()
    update()
    emitAbilityBurst(cell, 'bloom')
    settleAfterMove(result.gameOver)
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
    lastGain = game.score - state.score
    saveActiveRun()
    update()
    emitAbilityBurst(cell, 'dew')
    settleAfterMove(result.gameOver)
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
    lastGain = game.score - state.score
    saveActiveRun()
    update()
    emitAbilityBurst(cell, 'prune')
    settleAfterMove(result.gameOver)
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
  hintKey = 'choosePiece'
  lastGain = game.score - state.score
  saveActiveRun()
  update()
  emitPlacement(piece, originFor(piece, cell), clearedPoints, result.clearedLines, game.combo)
  settleAfterMove(result.gameOver)
}

function settleAfterMove(gameOver: boolean): void {
  if (!gameOver) return
  if (game?.status === 'awaiting-revive') openModal('revive')
  else finalizeRun()
}

function selectPiece(index: number): void {
  if (isPaused()) return
  const state = ensureGame()
  if (state.status !== 'playing' || !state.pieces[index]) return
  selectedPiece = selectedPiece === index ? null : index
  hintKey = 'choosePiece'
  update()
}

function toggleSelectionOff(status: GameState['status']): boolean {
  if (!game?.status.startsWith('selecting-')) return false
  const cancelled = game.status === status
  game = { ...game, status: 'playing' }
  hintKey = 'choosePiece'
  saveActiveRun()
  update()
  return cancelled
}

function activateBloom(): void {
  if (isPaused()) return
  if (toggleSelectionOff('selecting-bloom')) return
  const state = ensureGame()
  if (!state.bloomReady) {
    showToast(`${t('useBloom')}: ${state.petals}/${BLOOM_THRESHOLD} ${t('linesToBloom')}`)
    return
  }
  game = beginBloom(state)
  selectedPiece = null
  hintKey = 'bloomHint'
  saveActiveRun()
  update()
}

function activateDew(): void {
  if (isPaused()) return
  if (toggleSelectionOff('selecting-dew')) return
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
  if (isPaused()) return
  if (toggleSelectionOff('selecting-prune')) return
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
  if (profile.muted) void soundContext?.suspend()
  else syncActivity()
  update()
}

async function signIn(): Promise<void> {
  if (revivePending || signingIn) return
  signingIn = true
  syncActivity()
  try {
    const signedIn = await platform.signIn()
    if (!signedIn) {
      showToast(t('signInHint'))
      return
    }
    const cloud = await platform.loadCloud()
    if (cloud && isProgress(cloud)) profile = mergeProgress(profile, cloud)
    persistProfile()
    showToast(t('signedIn'))
  } catch {
    // Never overwrite an unread cloud profile with the local one.
    showToast(t('cloudSyncFailed'))
  } finally {
    signingIn = false
    syncActivity()
    update()
  }
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
  previewHintCount = -1
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
  const gardenNext = document.querySelector<HTMLElement>('#garden-next-label')
  const dailyPersonal = document.querySelector<HTMLElement>('#daily-personal')
  const dailyTop = document.querySelector<HTMLElement>('#daily-top')
  const zoneSummary = document.querySelector<HTMLElement>('#zone-summary')
  const zoneCopy = document.querySelector<HTMLElement>('#zone-copy')
  const weedNote = document.querySelector<HTMLElement>('#weed-note')
  const toastElement = document.querySelector<HTMLElement>('#toast')
  const goal = nextGardenGoal(profile.nectar)

  const number = (value: number) => value.toLocaleString(platform.locale === 'ru' ? 'ru-RU' : 'en-US')
  if (score) score.textContent = number(state.score)
  if (best) best.textContent = number(profile.bestScore)
  if (nectar) nectar.textContent = number(profile.nectar)
  if (nectarNext) {
    nectarNext.textContent = goal ? `/ ${number(goal.zone.nectar)}` : ''
  }
  if (lines) lines.textContent = lastGain > 0 ? `+${number(lastGain)}` : `${state.turn} ${t('moves')}`
  if (combo) combo.textContent = state.combo > 0 ? `×${state.combo}` : '—'
  if (petals) petals.textContent = `${state.petals}/${BLOOM_THRESHOLD}`
  if (petalFill) petalFill.style.width = `${(state.petals / BLOOM_THRESHOLD) * 100}%`
  if (mode) mode.innerHTML = `${icon(state.mode === 'daily' ? 'calendar' : 'seed')}<span>${modeName(state.mode)}</span>`
  if (hint) hint.textContent = reviveSelection ? t('selectRevive') : hintKey === 'invalidMove' ? t('invalidMove') : contextualHint(state, selectedPiece, platform.locale)
  if (bloomButton) {
    bloomButton.disabled = state.status !== 'playing' && !state.status.startsWith('selecting-')
    bloomButton.classList.toggle('is-locked', !state.bloomReady)
    bloomButton.setAttribute('aria-pressed', String(state.status === 'selecting-bloom'))
    bloomButton.classList.toggle('is-ready', state.bloomReady)
    bloomButton.querySelector('b')!.textContent = state.bloomReady ? t('bloomReady') : t('useBloom')
  }
  if (bloomCharge) bloomCharge.textContent = state.bloomReady ? '3×3' : `${state.petals}/${BLOOM_THRESHOLD} ${t('linesToBloom')}`
  if (dewButton) {
    dewButton.disabled = state.status !== 'playing' && !state.status.startsWith('selecting-')
    dewButton.classList.toggle('is-locked', state.dew < 1)
    dewButton.setAttribute('aria-pressed', String(state.status === 'selecting-dew'))
    dewButton.classList.toggle('is-ready', state.dew > 0)
    dewButton.querySelector('b')!.textContent = state.dew > 0 ? t('dewReady') : t('dew')
  }
  if (dewCharge) dewCharge.textContent = state.dew ? `${t('oneCell')} · ×${state.dew}` : t('dewEarnShort')
  if (pruneButton) {
    pruneButton.disabled = state.status !== 'playing' && !state.status.startsWith('selecting-')
    pruneButton.classList.toggle('is-locked', !state.pruneReady)
    pruneButton.setAttribute('aria-pressed', String(state.status === 'selecting-prune'))
    pruneButton.classList.toggle('is-ready', state.pruneReady)
    pruneButton.querySelector('b')!.textContent = state.pruneReady ? t('pruneReady') : t('prune')
  }
  if (pruneCharge) pruneCharge.textContent = state.pruneReady ? t('rowAndColumn') : t('pruneEarnShort')
  if (hand) {
    const rackKey = JSON.stringify(state.pieces)
    // Preserve focus, touch targets and animation phases while only selection changes.
    if (hand.dataset.rack !== rackKey) {
      hand.dataset.rack = rackKey
      hand.innerHTML = state.pieces.map((piece, index) => piece ? pieceMarkup(piece, index) : `<div class="piece-empty" aria-hidden="true">${icon('seed')}</div>`).join('')
      hand.querySelectorAll<HTMLButtonElement>('[data-piece]').forEach((button) => {
        button.addEventListener('pointerdown', (event) => beginPieceDrag(Number(button.dataset.piece), event))
        button.addEventListener('click', (event) => {
          if (event.detail === 0) selectPiece(Number(button.dataset.piece))
        })
      })
    }
    hand.querySelectorAll<HTMLButtonElement>('[data-piece]').forEach(button => {
      const selected = Number(button.dataset.piece) === selectedPiece
      button.classList.toggle('is-selected', selected)
      button.setAttribute('aria-pressed', String(selected))
    })
  }
  const dayScore = profile.dailyScores[currentChallenge()] ?? 0
  if (dailyPersonal) dailyPersonal.textContent = number(dayScore)
  if (dailyTop) dailyTop.textContent = number(profile.bestScore)
  const zones = zoneCount()
  if (zoneSummary) zoneSummary.textContent = `${zones} / 5`
  const selected = selectedGardenZone(profile)
  const activeIndex = GARDEN_ZONES.findIndex(zone => zone.id === selected)
  if (zoneCopy) zoneCopy.textContent = `${t('gardenActive')}: ${zoneNames[platform.locale][activeIndex]}`
  renderGardenSidebar(selected, activeIndex)
  if (weedNote) weedNote.textContent = state.mode === 'daily' ? t('daily') : ''
  if (gardenNext) gardenNext.textContent = goal ? `${t('untilUnlock')}: ${number(goal.remaining)}` : t('gardenComplete')
  const progress = document.querySelector<HTMLElement>('.mini-growth i')
  if (progress) progress.style.width = `${goal ? profile.nectar / goal.zone.nectar * 100 : 100}%`
  document.querySelectorAll('.challenge-blooms i').forEach((flower, index) => flower.classList.toggle('is-earned', dayScore >= (index + 1) * 2000 / 7))
  const sound = document.querySelector<HTMLButtonElement>('#sound-button')
  if (sound) { sound.innerHTML = icon(profile.muted ? 'muted' : 'sound'); sound.setAttribute('aria-label', profile.muted ? t('soundOff') : t('soundOn')); sound.title = profile.muted ? t('soundOff') : t('soundOn') }
  if (toastElement) toastElement.textContent = toast

  renderDragGhost()
  drawBoard()
  renderModal()
}

function openGarden(id = selectedGardenZone(profile)): void {
  gardenPreview = id
  openModal('garden')
}

function renderGardenSidebar(selected: GardenZoneId, index: number): void {
  const environment = document.querySelector<HTMLElement>('.garden-environment')
  if (environment) void setGardenBackdrop(environment, selected)
  const mini = document.querySelector<HTMLElement>('#garden-mini-scene')
  if (mini && mini.dataset.garden !== selected) { mini.dataset.garden = selected; mini.innerHTML = gardenScene(index) }
  const slots = document.querySelector<HTMLElement>('#greenhouse-sprouts')
  if (slots) {
    slots.innerHTML = GARDEN_ZONES.map((zone, i) => {
      const unlocked = profile.nectar >= zone.nectar
      return `<button data-garden-zone="${zone.id}" class="${unlocked ? 'is-unlocked' : ''} ${selected === zone.id ? 'is-active' : ''}" title="${zoneNames[platform.locale][i]}" aria-label="${zoneNames[platform.locale][i]} · ${t(unlocked ? 'unlocked' : 'locked')}">${icon(unlocked ? i < 2 ? 'seed' : 'bloom' : 'lock')}</button>`
    }).join('')
    slots.querySelectorAll<HTMLButtonElement>('[data-garden-zone]').forEach(button => button.addEventListener('click', () => openGarden(button.dataset.gardenZone as GardenZoneId)))
  }
}

function gardenModalContent(): string {
  const index = GARDEN_ZONES.findIndex(zone => zone.id === gardenPreview)
  const zone = GARDEN_ZONES[index]
  const unlocked = profile.nectar >= zone.nectar
  const active = selectedGardenZone(profile) === zone.id
  const progress = Math.min(1, profile.nectar / Math.max(1, zone.nectar))
  return `<p class="garden-intro">${t('gardenText')}</p>
    <div class="garden-tabs" role="tablist" aria-label="${t('garden')}">${GARDEN_ZONES.map((item,i) => `<button role="tab" aria-selected="${item.id === gardenPreview}" aria-controls="garden-preview" data-preview-zone="${item.id}" class="${profile.nectar >= item.nectar ? 'is-unlocked' : ''}"><span>${icon(profile.nectar >= item.nectar ? i < 2 ? 'seed' : 'bloom' : 'lock')}</span><small>${t('zone')} ${i+1}</small></button>`).join('')}</div>
    <section class="garden-preview" id="garden-preview" role="tabpanel" aria-label="${zoneNames[platform.locale][index]}">
      <div class="garden-scene">${gardenScene(index)}</div>
      <div class="garden-caption"><h3>${zoneNames[platform.locale][index]}</h3><span>${t(unlocked ? 'unlocked' : 'locked')}</span></div>
      <p>${gardenDescriptions[platform.locale][index]}</p>
    </section>
    <div class="garden-unlock"><span>${icon('seed')} ${t('nectar')}: <b>${profile.nectar.toLocaleString(platform.locale)}</b></span><small>${unlocked ? t('cosmeticOnly') : `${t('untilUnlock')}: ${zone.nectar - profile.nectar}`}</small></div>
    ${!unlocked ? `<div class="garden-unlock-track"><i style="width:${progress*100}%"></i></div>` : ''}
    <button class="primary-button garden-apply" data-apply-garden ${!unlocked || active ? 'disabled' : ''}>${t(active ? 'gardenSelected' : unlocked ? 'applyGarden' : 'gardenLocked')}</button>
    <p class="garden-earn-note">${t('nectarHow')}${game && !finalized && game.turn > 0 ? ` <strong>${t('thisRun')}: +${nectarForRun(game.score, game.bestCombo)}.</strong>` : ''}</p>`
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
    context.save()
    drawRoundRect(context, x + 1, y + 1, cell - 2, cell - 2, cell * .2)
    context.clip()
    context.drawImage(texture, 0, 0, texture.naturalWidth, texture.naturalHeight, x + 1, y + 1, cell - 2, cell - 2)
    context.fillStyle = `rgba(4, 24, 14, ${.12 + (seed % 3) * .035})`
    context.fillRect(x, y, cell, cell)
    context.restore()
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

function drawPlant(context: CanvasRenderingContext2D, x: number, y: number, cell: number, variant: number, scale = 1, alpha = 1, color?: PieceColor, angle = 0, lift = 0): void {
  const flower = color ? boardTextures.flowers[color] : null
  if (flower?.complete && flower.naturalWidth) {
    context.save()
    context.globalAlpha = alpha
    context.translate(x + cell / 2, y + cell / 2 + lift * cell)
    context.rotate(angle)
    context.scale(scale, scale)
    drawRoundRect(context, -cell * .47, -cell * .47, cell * .94, cell * .94, cell * .19)
    context.clip()
    context.drawImage(flower, -cell * .48, -cell * .48, cell * .96, cell * .96)
    context.restore()
    return
  }
  const palette = plantPalette(variant)
  context.save()
  context.translate(x + cell / 2, y + cell / 2 + lift * cell)
  context.rotate(angle)
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
  // A breathing gap inside the artwork; the same geometry drives pointer input.
  return width * .116
}

function pulseScale(x: number, y: number): number {
  const pulse = pulses.find((item) => item.x === x && item.y === y)
  if (reducedMotion.matches || isPaused()) return 1
  if (!pulse) return 1
  const remaining = Math.max(0, (pulse.until - performance.now()) / 360)
  return 1 + Math.sin(remaining * Math.PI) * .18
}

function drawFrame(context: CanvasRenderingContext2D, rect: DOMRect): void {
  const frame = boardTextures.frame
  if (frame.complete && frame.naturalWidth) context.drawImage(frame, 0, 0, rect.width, rect.height)
}

function drawBoardBase(context: CanvasRenderingContext2D, rect: DOMRect, padding: number, cell: number): void {
  const boardBackground = boardTextures.background
  if (boardBackground.complete && boardBackground.naturalWidth) {
    context.save()
    drawRoundRect(context, rect.width * .063, rect.width * .063, rect.width * .874, rect.width * .874, rect.width * .04)
    context.clip()
    context.drawImage(boardBackground, rect.width * .052, rect.height * .052, rect.width * .896, rect.height * .896)
    context.restore()
  } else {
    const outer = context.createLinearGradient(0, 0, rect.width, rect.height)
    outer.addColorStop(0, '#58795c')
    outer.addColorStop(.5, '#2f5a47')
    outer.addColorStop(1, '#234536')
    drawRoundRect(context, padding * .22, padding * .22, rect.width - padding * .44, rect.height - padding * .44, 25)
    context.fillStyle = outer
    context.fill()
  }

  // Decoration is a lower layer: it can never conceal cells or placed flowers.
  drawFrame(context, rect)
  for (let y = 0; y < BOARD_SIZE; y++) for (let x = 0; x < BOARD_SIZE; x++) {
    drawBoardCell(context, padding + x * cell, padding + y * cell, cell, x * 13 + y * 29)
  }
}

function drawBoard(): void {
  const state = game
  const measurements = boardMeasurements()
  if (!measurements || !state) return
  const { canvas, rect, padding, cell } = measurements
  canvas.dataset.inset = String(padding / rect.width)
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const pixelSize = Math.round(rect.width * ratio)
  if (canvas.width !== pixelSize || canvas.height !== pixelSize) {
    canvas.width = pixelSize
    canvas.height = pixelSize
  }
  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, rect.width, rect.height)

  const surfaceKey = `${pixelSize}:${rect.width}:${ratio}:${artworkRevision}`
  if (!boardSurface || boardSurfaceKey !== surfaceKey) {
    boardSurface ??= document.createElement('canvas')
    boardSurface.width = pixelSize
    boardSurface.height = pixelSize
    const buffer = boardSurface.getContext('2d')!
    buffer.setTransform(ratio, 0, 0, ratio, 0, 0)
    drawBoardBase(buffer, rect, padding, cell)
    boardSurfaceKey = surfaceKey
  }
  context.drawImage(boardSurface, 0, 0, rect.width, rect.height)
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const left = padding + x * cell
      const top = padding + y * cell
      const value = state.board[y][x]
      if (value === 'leaf') {
        const pose = flowerMotion(gardenTime, x * 7 + y * 11, !reducedMotion.matches)
        drawPlant(context, left, top, cell, x * 7 + y * 11 + zoneCount(), pulseScale(x, y) * pose.scale, 1, state.boardColors?.[y]?.[x] ?? undefined, pose.angle, pose.lift)
      } else if (value === 'weed') {
        context.fillStyle = 'rgba(120, 138, 67, .2)'
        drawRoundRect(context, left + 3, top + 3, cell - 6, cell - 6, Math.max(5, cell * .19))
        context.fill()
        drawWeed(context, left, top, cell)
      }
    }
  }

  let previewLines = 0
  if (hoverCell && selectedPiece !== null && state.status === 'playing' && !isPaused()) {
    const piece = state.pieces[selectedPiece]
    if (piece) {
      const origin = originFor(piece, hoverCell)
      const valid = piece.cells.every((part) => {
        const x = origin.x + part.x
        const y = origin.y + part.y
        return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE && state.board[y][x] === 'empty'
      })
      const forecast = forecastForMove(state, piece, origin)
      if (valid && hintKey === 'invalidMove') { hintKey = 'choosePiece'; previewHintCount = -1 }
      previewLines = forecast.rows.length + forecast.columns.length
      if (previewLines) {
        context.save()
        context.strokeStyle = '#ffe5a0'
        context.fillStyle = 'rgba(255,222,131,.13)'
        context.lineWidth = Math.max(1.5, cell * .04)
        context.setLineDash([cell * .12, cell * .07])
        for (const row of forecast.rows) {
          drawRoundRect(context, padding + 2, padding + row * cell + 2, cell * BOARD_SIZE - 4, cell - 4, cell * .2)
          context.fill(); context.stroke()
        }
        for (const col of forecast.columns) {
          drawRoundRect(context, padding + col * cell + 2, padding + 2, cell - 4, cell * BOARD_SIZE - 4, cell * .2)
          context.fill(); context.stroke()
        }
        context.restore()
      }
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
        drawPlant(context, padding + x * cell, padding + y * cell, cell, part.x * 5 + part.y * 3 + selectedPiece, .78, valid ? .42 : .34, piece.color)
      }
    }
  }

  canvas.dataset.previewLines = String(previewLines)
  if (previewHintCount !== previewLines) {
    previewHintCount = previewLines
    const hint = document.querySelector<HTMLElement>('#hint')
    if (hint) {
      hint.classList.toggle('is-clear-preview', previewLines > 0)
      hint.textContent = previewLines ? `${t('clearPreview')}: ${previewLines}`
        : reviveSelection ? t('selectRevive') : hintKey === 'invalidMove' ? t('invalidMove') : contextualHint(state, selectedPiece, platform.locale)
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

  if (keyboardActive) {
    drawRoundRect(context, padding + keyboardCell.x * cell + 2, padding + keyboardCell.y * cell + 2, cell - 4, cell - 4, cell * .18)
    context.strokeStyle = '#fff1a4'
    context.lineWidth = 2
    context.setLineDash([4, 3])
    context.stroke()
    context.setLineDash([])
  }
  drawEffects(context)
  drawParticles(context)
}

function forecastForMove(state: GameState, piece: Piece, origin: Point): PlacementPreview {
  if (!previewCache || previewCache.board !== state.board || previewCache.piece !== piece || previewCache.x !== origin.x || previewCache.y !== origin.y) {
    previewCache = { board: state.board, piece, x: origin.x, y: origin.y, result: placementPreview(state.board, piece, origin) }
  }
  return previewCache.result
}

function clearedPointsForMove(state: GameState, piece: Piece, origin: Point): Point[] {
  return forecastForMove(state, piece, origin).cells
}

function addBurst(point: Point, count: number, colors: string[], kind: Particle['kind'] = 'petal'): void {
  if (reducedMotion.matches) return
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
  playChime(clearedLines ? 'line' : 'place')
  for (const part of piece.cells) {
    const point = { x: origin.x + part.x, y: origin.y + part.y }
    pulses.push({ ...point, until: performance.now() + 330, color: colorFor(piece) })
  }
  if (cleared.length) {
    effects.push({ style: 'line', startedAt: performance.now(), duration: reducedMotion.matches ? 300 : 1150, points: cleared, center: cleared[0] })
    const every = cleared.length > 12 ? 2 : 1
    cleared.filter((_, index) => index % every === 0).forEach((point) => addBurst(point, Math.min(14, 7 + combo), ['#ffe19b', colorFor(piece), '#faebbc'], 'petal'))
    showComboFanfare(clearedLines, combo)
  }
  startParticleLoop()
}

function emitAbilityBurst(center: Point, ability: 'bloom' | 'dew' | 'prune'): void {
  playChime(ability)
  const signal = document.querySelector<HTMLElement>('#combo-signal')
  if (signal) {
    signal.querySelector('span')!.textContent = t(ability)
    signal.querySelector('strong')!.textContent = `+${lastGain}`
    signal.classList.remove('is-visible')
    void signal.offsetWidth
    signal.classList.add('is-visible')
    window.clearTimeout(fanfareTimer)
    fanfareTimer = window.setTimeout(() => signal.classList.remove('is-visible'), 1400)
  }
  const colors = ability === 'bloom' ? ['#f6cc7b', '#f09488', '#f9ebbb'] : ability === 'dew' ? ['#9ed5d4', '#e5f1d1'] : ['#a9d08d', '#f1cd7a', '#e7e9bd']
  const points = ability === 'prune'
    ? Array.from({ length: BOARD_SIZE * 2 - 1 }, (_, index) => index < BOARD_SIZE ? { x: index, y: center.y } : { x: center.x, y: index - BOARD_SIZE < center.y ? index - BOARD_SIZE : index - BOARD_SIZE + 1 })
    : ability === 'bloom'
      ? Array.from({ length: 9 }, (_, index) => ({ x: center.x - 1 + index % 3, y: center.y - 1 + Math.floor(index / 3) })).filter((point) => point.x >= 0 && point.y >= 0 && point.x < BOARD_SIZE && point.y < BOARD_SIZE)
      : [center]
  effects.push({ style: ability, startedAt: performance.now(), duration: reducedMotion.matches ? 300 : ability === 'bloom' ? 1400 : ability === 'dew' ? 1050 : 1100, points, center })
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
  kicker.textContent = lines >= 3 ? t('superBloom') : lines >= 2 ? t('doubleBloom') : combo > 1 ? `${t('combo')} ×${combo}` : t('beautiful')
  value.textContent = `+${lastGain}`
  signal.classList.remove('is-visible')
  void signal.offsetWidth
  signal.classList.add('is-visible')
  window.clearTimeout(fanfareTimer)
  fanfareTimer = window.setTimeout(() => signal.classList.remove('is-visible'), 1300)
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
    if (reducedMotion.matches) {
      context.fillStyle = `rgba(255,233,165,${fade * .28})`
      effect.points.forEach(point => {
        const p = boardPoint(point)!
        drawRoundRect(context, p.x - p.cell / 2, p.y - p.cell / 2, p.cell, p.cell, p.cell * .15)
        context.fill()
      })
      context.restore()
      continue
    }
    if (effect.style === 'line') {
      effect.points.forEach((point, index) => {
        const pos = boardPoint(point)
        if (!pos) return
        const wave = Math.max(0, 1 - Math.abs(progress * 1.45 - index / Math.max(1, effect.points.length - 1)) * 5)
        if (!wave) return
        drawRoundRect(context, pos.x - pos.cell * .42, pos.y - pos.cell * .42, pos.cell * .84, pos.cell * .84, pos.cell * .17)
        context.fillStyle = `rgba(255, 224, 139, ${wave * fade * .72})`
        context.shadowColor = '#ffce64'
        context.shadowBlur = pos.cell * .35
        context.fill()
        context.strokeStyle = `rgba(255, 249, 208, ${wave * fade})`
        context.lineWidth = Math.max(1.5, pos.cell * .06)
        context.beginPath()
        context.moveTo(pos.x - pos.cell * .28, pos.y + pos.cell * .16)
        context.quadraticCurveTo(pos.x, pos.y - pos.cell * .23, pos.x + pos.cell * .3, pos.y + pos.cell * .03)
        context.stroke()
        drawFlower(context, pos.x, pos.y, pos.cell * (.4 + wave * .7), '#ffdb8b', wave)
      })
    } else if (effect.style === 'bloom') {
      const radius = center.cell * (.22 + (1 - Math.pow(1 - progress, 3)) * 2)
      const halo = context.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius * 1.2)
      halo.addColorStop(0, `rgba(255,246,184,${fade * .9})`)
      halo.addColorStop(.5, `rgba(255,151,123,${fade * .4})`)
      halo.addColorStop(1, 'rgba(255,160,99,0)')
      context.fillStyle = halo
      context.fillRect(center.x - radius * 1.2, center.y - radius * 1.2, radius * 2.4, radius * 2.4)
      context.shadowColor = '#ffd591'
      context.shadowBlur = center.cell * .22
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
      context.shadowColor = '#a7ffff'
      context.shadowBlur = center.cell * .18
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
      const length = center.cell * BOARD_SIZE * Math.min(1, progress * 2.5)
      const m = boardMeasurements()!
      context.beginPath()
      context.rect(m.padding, m.padding, m.cell * BOARD_SIZE, m.cell * BOARD_SIZE)
      context.clip()
      context.shadowColor = '#e3ffad'
      context.shadowBlur = center.cell * .2
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
    particleFrame = 0
    const rawElapsed = now - particleLast
    const elapsed = Math.min(34, rawElapsed)
    particleLast = now
    if (isPaused()) {
      // Decorative animation stops completely, without running a hidden RAF loop.
      particles = []
      pulses = []
      effects = []
      return
    }
    gardenTime += Math.min(50, rawElapsed)
    particles = particles.filter((particle) => {
      particle.life -= elapsed
      particle.x += particle.vx * elapsed
      particle.y += particle.vy * elapsed
      particle.vy += particle.gravity * elapsed
      return particle.life > 0
    })
    pulses = pulses.filter((pulse) => pulse.until > now)
    effects = effects.filter((effect) => effect.startedAt + effect.duration > now)
    // Static soil/frame are cached; idle flowers paint at 30 fps, bursts at 60.
    if (particles.length || effects.length || pulses.length || now - lastBoardPaint >= 1000 / 30 || reducedMotion.matches) {
      drawBoard()
      lastBoardPaint = now
    }
    if (!reducedMotion.matches || particles.length || pulses.length || effects.length) particleFrame = requestAnimationFrame(frame)
  }
  particleFrame = requestAnimationFrame(frame)
}

function openModal(next: typeof modal): void {
  if (!modal && document.activeElement instanceof HTMLElement) modalOpener = document.activeElement
  modal = next
  syncActivity()
  update()
  document.querySelector<HTMLElement>('.modal button')?.focus()
}

function closeModal(): void {
  // A finished run always returns to its harvest, even through nested help/settings.
  modal = finalized ? 'result' : null
  syncActivity()
  update()
  if (!modal) { modalOpener?.focus(); modalOpener = null }
}

function modalMarkup(title: string, content: string, compact = false, closeable = true): string {
  return `<div class="modal-backdrop"><section class="modal${compact ? ' modal-compact' : ''} modal-${modal}" role="dialog" aria-modal="true" aria-label="${title}">
    ${closeable ? `<button class="modal-close" data-close aria-label="${t('close')}">×</button>` : ''}<h2>${title}</h2>${content}</section></div>`
}

function renderModal(): void {
  const host = document.querySelector<HTMLElement>('#modal-host')
  if (!host) return
  if (!modal) {
    document.querySelector<HTMLElement>('.game-layout')?.removeAttribute('inert')
    document.querySelector<HTMLElement>('.topbar')?.removeAttribute('inert')
    host.innerHTML = ''
    return
  }
  const state = ensureGame()
  if (modal === 'intro') {
    host.innerHTML = modalMarkup(t('introTitle'), `${guideMarkup(platform.locale, true)}<button class="primary-button" data-start>${t('start')}</button>`, true)
  } else if (modal === 'modes') {
    host.innerHTML = modalMarkup(t('modeTitle'), `<p>${t('modeText')}</p><div class="mode-options">
      <button data-mode="standard"><span>${icon('seed')}</span><strong>${t('standard')}</strong><small>${t('standardHint')}</small><em class="mode-choice-action">${t('standardGoal')}${icon('arrow')}</em></button>
      <button data-mode="daily"><span>${icon('calendar')}</span><strong>${t('daily')}</strong><small>${t('dailyShort')}</small><em class="mode-choice-action">${t('dailyGoal')}: 2 000${icon('arrow')}</em></button>
    </div><div class="settings-actions"><button class="secondary-button" data-help>${t('controls')}</button><button class="secondary-button" data-fullscreen>${t('fullscreen')}</button></div>`, true)
  } else if (modal === 'garden') {
    host.innerHTML = modalMarkup(t('gardenTitle'), gardenModalContent())
  } else if (modal === 'leaderboard') {
    host.innerHTML = modalMarkup(t('leaderboardTitle'), `<p>${t('leaderboardHint')}</p><div class="leaderboard-list" id="leaderboard-list"><p>${t('loadingRecords')}</p></div><p class="personal-best">${t('personalBest')}: <strong>${profile.bestScore}</strong></p>`, true)
    void populateLeaderboard()
  } else if (modal === 'pause') {
    host.innerHTML = modalMarkup(t('pause'), `<p>${t('controlsText')}</p><button class="primary-button" data-resume>${t('resume')}</button>`, true)
  } else if (modal === 'revive') {
    host.innerHTML = modalMarkup(t('reviveTitle'), `<p>${t('reviveText')}</p><div class="modal-actions"><button class="secondary-button" data-finish>${t('finish')}</button><button class="primary-button" data-revive>${t('revive')}</button></div>`, true, false)
  } else if (modal === 'result') {
    const todayBest = state.mode === 'daily' ? `<p class="daily-result">${icon('calendar')} ${t('dayBest')}: <strong>${profile.dailyScores[state.challengeId!] ?? state.score}</strong></p>` : ''
    host.innerHTML = modalMarkup(t('gameOver'), `<div class="result-score">${state.score}</div><p>${runSetNewBest ? t('newBest') : t('resultText')}</p>${todayBest}<button class="harvest-reward" data-result-garden>${icon('seed')}<span><strong>${t('nectar')}: +${earnedNectar}</strong><small>${unlockedThisRun ? t('newGardenZone') : t('visitGarden')}</small></span>${icon('arrow')}</button><div class="modal-actions"><button class="secondary-button" data-mode-open>${t('daily')}</button><button class="primary-button" data-restart>${t('restart')}</button></div>`, true, false)
  } else if (modal === 'controls') {
    host.innerHTML = modalMarkup(t('controls'), guideMarkup(platform.locale), true)
  }

  host.querySelectorAll<HTMLButtonElement>('[data-preview-zone]').forEach(button => button.addEventListener('click', () => {
    gardenPreview = button.dataset.previewZone as GardenZoneId
    renderModal()
    host.querySelector<HTMLElement>(`[data-preview-zone="${gardenPreview}"]`)?.focus()
  }))
  host.querySelectorAll<HTMLButtonElement>('[data-preview-zone]').forEach((button, index) => button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? GARDEN_ZONES.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + GARDEN_ZONES.length) % GARDEN_ZONES.length
    gardenPreview = GARDEN_ZONES[next].id
    renderModal()
    host.querySelector<HTMLElement>(`[data-preview-zone="${gardenPreview}"]`)?.focus()
  }))
  host.querySelector<HTMLButtonElement>('[data-apply-garden]')?.addEventListener('click', () => {
    profile = selectGardenZone(profile, gardenPreview)
    persistProfile()
    closeModal()
    showToast(t('gardenApplied'))
  })
  host.querySelector<HTMLElement>('[data-result-garden]')?.addEventListener('click', () => openGarden())
  host.querySelector<HTMLElement>('[data-help]')?.addEventListener('click', () => openModal('controls'))
  host.querySelector<HTMLElement>('[data-fullscreen]')?.addEventListener('click', () => { void platform.requestFullscreen(); closeModal() })
  document.querySelector<HTMLElement>('.game-layout')?.setAttribute('inert', '')
  document.querySelector<HTMLElement>('.topbar')?.setAttribute('inert', '')
  host.querySelector<HTMLElement>('[data-close]')?.addEventListener('click', closeModal)
  host.querySelector<HTMLElement>('[data-start]')?.addEventListener('click', () => {
    closeModal()
    syncActivity()
    void platform.requestFullscreen()
  })
  host.querySelector<HTMLElement>('[data-resume]')?.addEventListener('click', closeModal)
  host.querySelector<HTMLElement>('[data-mode-open]')?.addEventListener('click', () => openModal('modes'))
  host.querySelector<HTMLElement>('[data-restart]')?.addEventListener('click', () => void startNewRun(state.mode))
  host.querySelectorAll<HTMLElement>('[data-mode]').forEach((button) => button.addEventListener('click', () => void switchMode(button.dataset.mode as GameMode)))
  host.querySelector<HTMLElement>('[data-finish]')?.addEventListener('click', finalizeRun)
  host.querySelector<HTMLElement>('[data-revive]')?.addEventListener('click', () => void requestRevive())
  // Rendering replaces the dialog DOM, so restore focus within the new dialog.
  host.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
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
  return entries.map((entry) => `<div class="leaderboard-entry"><span>#${entry.rank}</span><strong>${escapeText(entry.player.publicName || '—')}</strong><b>${entry.score}</b></div>`).join('')
}

function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]!))
}

async function requestRevive(): Promise<void> {
  if (revivePending || game?.status !== 'awaiting-revive') return
  const waitingRun = game
  revivePending = true
  document.querySelectorAll<HTMLButtonElement>('[data-revive], [data-finish]').forEach(button => { button.disabled = true })
  const rewarded = await platform.showRewarded()
  revivePending = false
  if (game !== waitingRun || finalized) return
  if (!rewarded) {
    showToast(t('adUnavailable'))
    update()
    return
  }
  modal = null
  reviveSelection = true
  hintKey = 'selectRevive'
  syncActivity()
  update()
}

async function switchMode(mode: GameMode): Promise<void> {
  const state = ensureGame()
  const sameChallenge = mode !== 'daily' || state.challengeId === currentChallenge()
  if (state.mode === mode && sameChallenge && state.status !== 'finished' && state.status !== 'awaiting-revive') {
    closeModal()
    return
  }
  if (state.status !== 'finished' && state.turn > 0 && !window.confirm(t('confirmNewRun'))) return
  await startNewRun(mode)
}

async function startNewRun(mode: GameMode): Promise<void> {
  if (revivePending) return
  game = createGame(mode, mode === 'daily' ? currentChallenge() : null)
  finalized = false
  runSetNewBest = false
  lastGain = 0
  particles = []
  effects = []
  pulses = []
  selectedPiece = null
  reviveSelection = false
  hintKey = 'choosePiece'
  modal = null
  saveActiveRun()
  await platform.requestFullscreen()
  syncActivity()
  update()
}

function finalizeRun(): void {
  if (finalized || revivePending) return
  finalized = true
  const state = ensureGame()
  game = finishRun(state)
  const finalScore = game.score
  const previousBest = profile.bestScore
  runSetNewBest = finalScore > previousBest
  const reward = nectarForRun(finalScore, game.bestCombo)
  earnedNectar = reward
  unlockedThisRun = availableGardenZones(profile.nectar + reward).length - zoneCount()
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
  syncActivity()
  update()
}

function showToast(message: string): void {
  toast = message
  const element = document.querySelector<HTMLElement>('#toast')
  if (element) {
    element.textContent = message
    element.classList.add('is-visible')
  }
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast = ''
    document.querySelector<HTMLElement>('#toast')?.classList.remove('is-visible')
  }, 2500)
}

async function bootstrap(): Promise<void> {
  platform = await createPlatform()
  t = translator(platform.locale)
  document.documentElement.lang = platform.locale
  document.title = t('title')
  if (!game || game.status === 'finished') {
    game = createGame('standard')
    modal = 'intro'
  } else if (game.status === 'awaiting-revive') {
    modal = 'revive'
  } else if (game.status.startsWith('selecting-')) {
    hintKey = game.status === 'selecting-bloom' ? 'bloomHint' : game.status === 'selecting-dew' ? 'dewHint' : 'pruneHint'
  }
  // Preload CSS paintings too; Ready is sent after the first complete playable frame.
  loadBoardTexture(`art/garden-${selectedGardenZone(profile)}.webp`)
  loadBoardTexture('art/paper.webp')
  await Promise.all(texturePromises)
  layout()
  update()
  inputReady = true
  saveActiveRun()
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  platform.markReady()
  platform.onPauseChange(() => syncActivity(false))
  syncActivity()
  window.addEventListener('pointermove', movePieceDrag)
  window.addEventListener('pointerup', endPieceDrag)
  window.addEventListener('pointercancel', event => { if (event.pointerId === dragPointerId) cancelDrag() })
  document.addEventListener('visibilitychange', () => syncActivity())
  window.addEventListener('blur', () => { windowFocused = false; syncActivity() })
  window.addEventListener('focus', () => { windowFocused = true; syncActivity() })
  window.addEventListener('pagehide', () => { if (game && !finalized) saveActiveRun() })
  reducedMotion.addEventListener('change', () => { particles = []; effects = []; startParticleLoop() })
  window.addEventListener('keydown', (event) => {
    if (modal && event.key === 'Tab') {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.modal button:not(:disabled)'))
      if (!buttons.length) return
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (!document.activeElement?.closest('.modal')) { event.preventDefault(); (event.shiftKey ? last : first).focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    if (event.key === 'Escape') {
      if (modal && !['revive','result'].includes(modal)) closeModal()
      else if (!modal && game?.status.startsWith('selecting-')) { game = {...game, status:'playing'}; hintKey = 'choosePiece'; saveActiveRun(); update() }
      else if (!modal) openModal('pause')
    }
    if (!isPaused() && /^[123]$/.test(event.key)) {
      selectPiece(Number(event.key) - 1)
      document.querySelector<HTMLElement>('#game-canvas')?.focus()
    }
  })
}

void bootstrap()
