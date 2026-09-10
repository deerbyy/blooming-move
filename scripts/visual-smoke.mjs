// Isolated Chromium context: never reads or changes the user's browser profile.
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.BLOOM_PLAYWRIGHT || 'playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1536, height: 1024 }, locale: 'ru-RU', hasTouch: true })
const page = await context.newPage()
const errors = []
const capture = async options => {
  await page.locator('.garden-scene-art, .garden-backdrop').evaluateAll(images => Promise.all(images.map(image => image.decode())))
  return page.screenshot(options)
}
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
await page.addInitScript(() => {
  Element.prototype.requestFullscreen = async () => {}
  // Observe real Web Audio without changing its behavior or touching user settings.
  const NativeAudioContext = window.AudioContext
  if (NativeAudioContext) window.AudioContext = class extends NativeAudioContext {
    constructor(...args) { super(...args); window.__audio = this }
    createOscillator() {
      window.__soundNotes = (window.__soundNotes || 0) + 1
      return super.createOscillator()
    }
  }
  const profileFixture = sessionStorage.getItem('smoke-profile-fixture')
  if (profileFixture) { localStorage.setItem('blooming-move:profile:v1',profileFixture); sessionStorage.removeItem('smoke-profile-fixture') }
  if (window.name) { localStorage.setItem('blooming-move:run:v1',window.name); window.name = '' }
  window.__events = {}
  window.__calls = []
  window.YaGames = { init: async () => (window.__sdk = {
    environment: { i18n: { lang: navigator.language } },
    features: { LoadingAPI: { ready: () => window.__calls.push('ready') }, GameplayAPI: { start: () => window.__calls.push('start'), stop: () => window.__calls.push('stop') } },
    getPlayer: async () => ({ isAuthorized: () => false }),
    auth: { openAuthDialog: async () => { throw Error('cancelled') } },
    screen: { fullscreen: { request: async () => {} } },
    on: (name, fn) => { window.__events[name] = fn },
    adv: { showRewardedVideo: ({callbacks}) => { window.__ad = callbacks; window.__calls.push('ad'); callbacks.onOpen() } }
  }) }
  const board = Array.from({length:8}, () => Array(8).fill('empty'))
  const boardColors = board.map(row => row.map(() => null))
  const dots = [[1,1,'sun'],[2,1,'mint'],[4,2,'coral'],[5,2,'violet'],[5,3,'mint'],[0,6,'sky'],[1,6,'coral']]
  dots.forEach(([x,y,c])=>{ board[y][x] = 'leaf'; boardColors[y][x] = c })
  const pieces = [{id:'dot',color:'mint',cells:[{x:0,y:0}]},{id:'square',color:'coral',cells:[{x:0,y:0},{x:1,y:0},{x:0,y:1},{x:1,y:1}]},{id:'bar',color:'sun',cells:[{x:0,y:0},{x:1,y:0},{x:2,y:0}]}]
  if (!localStorage.getItem('smoke-initialized')) {
    localStorage.setItem('blooming-move:run:v1',JSON.stringify({version:2,mode:'standard',challengeId:null,board,boardColors,pieces,score:70,bestCombo:2,combo:2,petals:4,bloomReady:true,dew:1,pruneReady:true,turn:7,rngState:12345,reviveAvailable:true,status:'playing'}))
    localStorage.setItem('blooming-move:profile:v1',JSON.stringify({version:1,nectar:470,bestScore:4870,dailyScores:{'2026-09-09':2470},completedRuns:3,lastInterstitialAt:0,muted:true}))
    localStorage.setItem('smoke-initialized','yes')
  }
})
await page.goto('http://127.0.0.1:5173/')
await page.waitForSelector('#game-canvas')
await page.waitForTimeout(400)
await mkdir('artifacts/qa',{recursive:true})
const layout = await page.evaluate(() => ({ overflow:document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight, canvas:document.querySelector('canvas').getBoundingClientRect().toJSON(), hand:document.querySelector('.piece-hand').getBoundingClientRect().toJSON() }))
console.log(JSON.stringify({layout, errors}))
assert.equal(layout.overflow, false)
assert.equal(await page.locator('[data-piece]').count(), 3)
assert.deepEqual(await page.evaluate(() => window.__calls.slice(0,2)), ['ready','start'])
const readRun = () => page.evaluate(() => JSON.parse(localStorage.getItem('blooming-move:run:v1')))
const readProfile = () => page.evaluate(() => JSON.parse(localStorage.getItem('blooming-move:profile:v1')))
const waitForGarden = async zone => {
  await page.waitForFunction(zone => {
    const layers = document.querySelectorAll('.garden-environment .garden-backdrop')
    const painting = layers[0]
    return document.body.dataset.garden === zone && layers.length === 1 && painting instanceof HTMLImageElement &&
      painting.complete && painting.naturalWidth > 0 && painting.src.endsWith(`/garden-${zone}.webp`) &&
      Number(getComputedStyle(painting).opacity) > .99
  },zone)
}
await waitForGarden('warm')
await capture({path:'artifacts/qa/desktop.png'})
const point = async (x,y) => {
  const geometry = await page.locator('#game-canvas').evaluate(canvas => ({
    rect: canvas.getBoundingClientRect().toJSON(),
    inset: Number(canvas.dataset.inset)
  }))
  const { rect:r, inset } = geometry
  assert.ok(Number.isFinite(inset) && inset > 0 && inset < .5, 'Canvas exposes its actual playable inset')
  return { x:r.x+r.width*(inset+(x+.5)*(1-inset*2)/8), y:r.y+r.height*(inset+(y+.5)*(1-inset*2)/8) }
}
const clickCell = async (x,y) => { const p = await point(x,y); await page.mouse.click(p.x,p.y) }
const reload = async () => {
  await page.reload()
  await page.waitForSelector('#game-canvas')
  await page.waitForFunction(() => window.__calls.includes('ready'))
}
const loadFixture = async (edit) => {
  const state = await readRun()
  edit(state)
  await page.evaluate(state => { window.name = JSON.stringify(state) },state)
  await reload()
}

const assertModalFits = async (label, viewport) => {
  const dimensions = await page.locator('.modal').evaluate(modal => ({
    rect:modal.getBoundingClientRect().toJSON(),
    horizontalOverflow:modal.scrollWidth > modal.clientWidth + 1,
    documentOverflow:document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight
  }))
  const r = dimensions.rect
  assert.ok(r.x >= -1 && r.y >= -1 && r.x+r.width <= viewport.width+1 && r.y+r.height <= viewport.height+1,
    `${label} dialog fits viewport: ${JSON.stringify({viewport,r})}`)
  assert.equal(dimensions.horizontalOverflow,false,`${label} has no internal horizontal overflow`)
  assert.equal(dimensions.documentOverflow,false,`${label} does not create document scrolling`)
}

const assertGardenFocusTrap = async (zone) => {
  assert.equal(await page.locator('[data-preview-zone]:focus').getAttribute('data-preview-zone'),zone,
    'Changing the preview restores focus to the selected tab after replacing the dialog DOM')
  assert.equal(await page.locator('.topbar').getAttribute('inert'),'','Header controls stay inert behind a dialog')
  assert.equal(await page.locator('.game-layout').getAttribute('inert'),'','Game controls stay inert behind a dialog')
  const enabledButtons = page.locator('.modal button:not(:disabled)')
  await enabledButtons.last().focus()
  await page.keyboard.press('Tab')
  assert.equal(await enabledButtons.first().evaluate(button => document.activeElement === button),true,
    'Tab wraps from the last enabled dialog button to the first')
  await page.keyboard.press('Shift+Tab')
  assert.equal(await enabledButtons.last().evaluate(button => document.activeElement === button),true,
    'Shift+Tab wraps from the first enabled dialog button to the last')
}

// The modes are equivalent choices, not buttons with vertically centered copy.
await page.locator('#fullscreen-button').click()
const modeHeadingY = await page.locator('.mode-options [data-mode] > strong').evaluateAll(headings => headings.map(heading => heading.getBoundingClientRect().y))
assert.equal(modeHeadingY.length,2)
assert.ok(Math.abs(modeHeadingY[0]-modeHeadingY[1]) <= 1,`Mode headings align: ${modeHeadingY}`)
await capture({path:'artifacts/qa/modes.png'})
await assertModalFits('Desktop modes',{width:1536,height:1024})
await page.locator('[data-help]').click()
assert.equal(await page.locator('.guide-grid').count(),3)
for (const grid of await page.locator('.guide-grid').all()) assert.equal(await grid.locator('.guide-cell').count(),64)
assert.equal(await page.locator('.guide-tool').count(),3)
const guideText = await page.locator('.modal').innerText()
for (const text of ['Цвета могут быть разными', 'Расцвести', 'Капля росы', 'Секатор', '4 линии', '3×3', 'до 2', '2 или больше линий', '25 очков']) {
  assert.ok(guideText.includes(text),`Russian guide explains: ${text}`)
}
await capture({path:'artifacts/qa/guide.png'})
await page.locator('[data-close]').click()

// Preview is non-mutating. Applying an unlocked scene changes only cosmetic selection.
const beforeGardenRun = await readRun()
const beforeGardenProfile = await readProfile()
assert.equal(beforeGardenProfile.nectar,470)
await page.locator('#garden-side-button').click()
await page.locator('[data-preview-zone="moon"]').click()
assert.equal(await page.locator('[data-apply-garden]').isDisabled(),true)
for (const [key,zone] of [['ArrowRight','dome'],['ArrowRight','warm'],['End','dome'],['Home','warm'],['ArrowLeft','dome']]) {
  await page.keyboard.press(key)
  assert.equal(await page.locator('[data-preview-zone]:focus').getAttribute('data-preview-zone'),zone,
    `${key} moves focus to the expected garden tab`)
  assert.equal(await page.locator('[data-preview-zone][aria-selected="true"]').getAttribute('data-preview-zone'),zone)
}
await page.locator('[data-preview-zone="moon"]').click()
await assertGardenFocusTrap('moon')
assert.deepEqual(await readProfile(),beforeGardenProfile,'Locked preview leaves the profile untouched')
assert.deepEqual(await readRun(),beforeGardenRun,'Locked preview leaves the board and score untouched')
assert.equal(await page.locator('body').getAttribute('data-garden'),'warm')
await page.locator('.modal h2').click()
await capture({path:'artifacts/qa/garden-locked.png'})
await page.locator('[data-preview-zone="rose"]').click()
assert.equal(await page.locator('[data-apply-garden]').isEnabled(),true)
await assertGardenFocusTrap('rose')
await page.locator('.modal h2').click()
await capture({path:'artifacts/qa/garden.png'})
await page.locator('[data-apply-garden]').click()
await waitForGarden('rose')
assert.equal(await page.locator('body').getAttribute('data-garden'),'rose')
assert.equal((await readProfile()).selectedGarden,'rose')
await reload()
await waitForGarden('rose')
assert.equal(await page.locator('body').getAttribute('data-garden'),'rose','Selected scene survives reload')
assert.equal((await readProfile()).selectedGarden,'rose')
assert.deepEqual(await readRun(),beforeGardenRun,'Cosmetics never modify the current run')
const {selectedGarden: _oldSelection, gardenSelectedAt: _oldTime, ...profileBeforeSelection} = beforeGardenProfile
const {selectedGarden: _newSelection, gardenSelectedAt: _newTime, ...profileAfterSelection} = await readProfile()
assert.deepEqual(profileAfterSelection,profileBeforeSelection,'Cosmetic selection neither spends nectar nor changes records')
await capture({path:'artifacts/qa/garden-applied.png'})
await page.locator('#garden-side-button').click()
await page.locator('[data-preview-zone="warm"]').click()
await page.locator('[data-apply-garden]').click()
await waitForGarden('warm')
assert.equal(await page.locator('body').getAttribute('data-garden'),'warm')
assert.equal((await readProfile()).nectar,470)

// Inspect later unlocks using this browser's isolated fixture, then restore its exact profile.
const profileBeforeThemeGallery = await readProfile()
await page.evaluate(profile => sessionStorage.setItem('smoke-profile-fixture',JSON.stringify({...profile,nectar:3000})),profileBeforeThemeGallery)
await reload()
await waitForGarden('warm')
for (const zone of ['moon','dome']) {
  await page.locator('#garden-side-button').click()
  await page.locator(`[data-preview-zone="${zone}"]`).click()
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.garden-scene-art')).every(image => image.complete && image.naturalWidth > 0))
  await capture({path:`artifacts/qa/garden-preview-${zone}.png`})
  await page.locator('[data-apply-garden]').click()
  await waitForGarden(zone)
  assert.equal((await readProfile()).nectar,3000,'Selecting an unlocked scene is free')
  assert.deepEqual(await readRun(),beforeGardenRun,'Later scenes are purely cosmetic')
  await capture({path:`artifacts/qa/garden-applied-${zone}.png`})
}
await page.evaluate(profile => sessionStorage.setItem('smoke-profile-fixture',JSON.stringify(profile)),profileBeforeThemeGallery)
await reload()
await waitForGarden('warm')
assert.deepEqual(await readProfile(),profileBeforeThemeGallery,'Theme inspection restores the exact isolated fixture profile')

// Show the complete lower edge with occupied corner cells, not only an empty bed.
await loadFixture(state => {
  state.board = state.board.map(row => row.map(() => 'empty'))
  state.boardColors = state.board.map(row => row.map(() => null))
  const colors = ['mint','coral','sun','violet','sky','coral']
  ;[0,1,3,4,6,7].forEach((x,index) => { state.board[7][x] = 'leaf'; state.boardColors[7][x] = colors[index] })
  state.board[6][0] = 'leaf'; state.boardColors[6][0] = 'sun'
  state.board[6][7] = 'leaf'; state.boardColors[6][7] = 'violet'
})
await page.mouse.move(10,10)
await page.waitForTimeout(250)
await page.locator('#game-canvas').screenshot({path:'artifacts/qa/frame-bottom.png'})
assert.equal((await readRun()).board[7][0],'leaf')
assert.equal((await readRun()).board[7][7],'leaf')
await loadFixture(state => Object.assign(state,beforeGardenRun))
console.log('PASS: aligned mode headings, 3×64-cell Russian guide, locked garden preview, saved cosmetic scene without gameplay changes, occupied lower-edge fixture.')

// Idle motion is decorative only, and it fully respects both pause and reduced motion.
const flowerTransform = () => page.locator('[data-piece="0"] .flower-tile').first().evaluate(tile => getComputedStyle(tile).transform)
const boardPixels = () => page.locator('#game-canvas').evaluate(canvas => canvas.toDataURL())
const idleState = await readRun()
const idleProfile = await readProfile()
await page.mouse.move(10,10)
const idleFlowerBefore = await flowerTransform()
const idleBoardBefore = await boardPixels()
await page.locator('#piece-hand').screenshot({path:'artifacts/qa/idle-hand-before.png'})
await page.waitForTimeout(650)
assert.notEqual(await flowerTransform(),idleFlowerBefore,'Flowers in the hand sway while waiting for a move')
assert.ok(await boardPixels() !== idleBoardBefore,'Placed flowers animate while the board is idle')
assert.deepEqual(await readRun(),idleState,'Idle animation never changes the board, score, or random sequence')
assert.deepEqual(await readProfile(),idleProfile,'Idle animation never changes progress')
await page.locator('#piece-hand').screenshot({path:'artifacts/qa/idle-hand-after.png'})
await page.locator('#pause-button').click()
await page.waitForTimeout(100)
const pausedFlower = await flowerTransform(), pausedBoard = await boardPixels()
await page.waitForTimeout(300)
assert.equal(await flowerTransform(),pausedFlower,'Pausing freezes hand motion')
assert.ok(await boardPixels() === pausedBoard,'Pausing freezes canvas motion')
await page.locator('[data-resume]').click()
await page.emulateMedia({reducedMotion:'reduce'})
await page.waitForTimeout(100)
const reducedFlower = await flowerTransform(), reducedBoard = await boardPixels()
await page.waitForTimeout(350)
assert.equal(await flowerTransform(),reducedFlower,'Reduced motion stops decorative hand swaying')
assert.ok(await boardPixels() === reducedBoard,'Reduced motion stops idle canvas motion')
await page.emulateMedia({reducedMotion:'no-preference'})
await page.waitForTimeout(100)
console.log('PASS: visible hand and board idle motion, frozen pause/reduced motion, and no gameplay mutation.')

// Input hygiene: non-primary actions and interrupted gestures never make a move.
const beforeInputChecks = await readRun()
const beforeInputProfile = await readProfile()
await page.locator('[data-piece="0"]').click()
let inputPoint = await point(0,0)
await page.mouse.click(inputPoint.x,inputPoint.y,{button:'right'})
assert.deepEqual(await readRun(),beforeInputChecks,'Right-click must not place a selected piece')
await page.locator('#game-canvas').evaluate((canvas,p) => canvas.dispatchEvent(new PointerEvent('pointerdown', {
  bubbles:true, pointerId:92, pointerType:'touch', isPrimary:false, button:0, clientX:p.x, clientY:p.y
})),inputPoint)
assert.deepEqual(await readRun(),beforeInputChecks,'A second touch must not place a selected piece')
await page.locator('#dew-button').click()
inputPoint = await point(1,1)
await page.mouse.click(inputPoint.x,inputPoint.y,{button:'right'})
assert.deepEqual((await readRun()).board,beforeInputChecks.board,'Right-click must not consume an ability target')
assert.equal((await readRun()).dew,beforeInputChecks.dew)
await page.keyboard.press('Escape')
assert.equal((await readRun()).status,'playing','Escape cancels ability targeting without spending it')
assert.equal(await page.locator('#dew-button').getAttribute('aria-pressed'),'false')
await loadFixture(state => { state.bloomReady=false; state.petals=0; state.dew=1 })
await page.locator('#dew-button').click()
await page.locator('#bloom-button').click()
assert.equal((await readRun()).status,'playing')
assert.equal(await page.locator('#dew-button').getAttribute('aria-pressed'),'false',
  'Switching from targeting to a locked ability refreshes the previous pressed state')
await loadFixture(state => Object.assign(state,beforeInputChecks))

const beginTestDrag = async () => {
  const box = await page.locator('[data-piece="0"]').boundingBox()
  const target = await point(0,0)
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2)
  await page.mouse.down()
  await page.mouse.move(target.x,target.y,{steps:5})
  assert.equal(await page.locator('#drag-ghost').evaluate(ghost => ghost.classList.contains('is-visible')),true)
}
await beginTestDrag()
await page.mouse.move(10,10)
await page.mouse.up()
assert.deepEqual(await readRun(),beforeInputChecks,'Dropping outside the board never places the figure')
await beginTestDrag()
await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,pointerType:'mouse',isPrimary:true})))
await page.mouse.up()
assert.deepEqual(await readRun(),beforeInputChecks,'pointercancel never places the figure')
assert.equal(await page.locator('body').evaluate(body => body.classList.contains('is-dragging')),false)
await beginTestDrag()
await page.evaluate(() => window.dispatchEvent(new FocusEvent('blur')))
assert.equal(await page.locator('#app').evaluate(app => app.classList.contains('is-paused')),true)
await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')))
await page.mouse.up()
assert.deepEqual(await readRun(),beforeInputChecks,'Losing focus cancels the drag instead of completing it on return')
await beginTestDrag()
await page.evaluate(() => window.__events.game_api_pause())
await page.evaluate(() => window.__events.game_api_resume())
await page.mouse.up()
assert.deepEqual(await readRun(),beforeInputChecks,'An SDK pause cancels the in-flight drag')
assert.equal(await page.locator('#drag-ghost').evaluate(ghost => ghost.classList.contains('is-visible')),false)

// Mode switches are explicit: cancel keeps the current board, accept creates a new run.
page.once('dialog',dialog => dialog.dismiss())
await page.locator('#daily-button').click()
assert.deepEqual(await readRun(),beforeInputChecks,'Declining a new run preserves the exact current board')
assert.deepEqual(await readProfile(),beforeInputProfile,'Declining a new run never grants or removes nectar')
page.once('dialog',dialog => dialog.accept())
await page.locator('#daily-button').click()
await page.waitForFunction(() => JSON.parse(localStorage.getItem('blooming-move:run:v1')).mode === 'daily')
const newDaily = await readRun()
assert.equal(newDaily.turn,0)
assert.equal(newDaily.score,0)
assert.deepEqual(await readProfile(),beforeInputProfile,'Abandoning a run does not farm harvest rewards')
await page.locator('#daily-button').click()
assert.deepEqual(await readRun(),newDaily,'Selecting the current mode does not erase its board')
await loadFixture(state => Object.assign(state,beforeInputChecks))
console.log('PASS: right-click/secondary-touch rejection, ability cancellation UI, outside/cancelled/blurred/SDK-paused drags, and accepted/cancelled mode switches.')

// Audio and hidden-tab lifecycle: silence is immediate and never changes the game.
assert.equal((await readProfile()).muted,true)
await page.locator('#sound-button').click()
assert.equal((await readProfile()).muted,false)
await page.locator('[data-piece="0"]').click()
await clickCell(0,0)
await page.waitForFunction(() => window.__audio?.state === 'running')
assert.ok(await page.evaluate(() => window.__soundNotes >= 2),'An audible placement creates the intended short chime')
const beforeAudioPause = await readRun()
await page.locator('#pause-button').click()
await page.waitForFunction(() => window.__audio.state === 'suspended')
await page.keyboard.press('1')
assert.deepEqual(await readRun(),beforeAudioPause,'Keyboard shortcuts are ignored while a dialog pauses the game')
await page.locator('[data-resume]').click()
await page.waitForFunction(() => window.__audio.state === 'running')
await page.evaluate(() => {
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>true})
  document.dispatchEvent(new Event('visibilitychange'))
})
await page.waitForFunction(() => window.__audio.state === 'suspended')
assert.equal(await page.locator('#app').evaluate(app => app.classList.contains('is-paused')),true)
await page.keyboard.press('2')
assert.deepEqual(await readRun(),beforeAudioPause,'Hidden-tab keyboard activity cannot alter the board')
await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')) })
await page.waitForFunction(() => window.__audio.state === 'running')
await page.locator('#sound-button').click()
await page.waitForFunction(() => window.__audio.state === 'suspended')
const notesBeforeMutedMove = await page.evaluate(() => window.__soundNotes)
await page.locator('[data-piece="1"]').click()
await clickCell(2,5)
assert.equal(await page.evaluate(() => window.__soundNotes),notesBeforeMutedMove,'Muted moves do not create oscillator nodes')
await loadFixture(state => Object.assign(state,beforeInputChecks))
assert.equal((await readProfile()).muted,true,'The sound preference survives reload')
assert.deepEqual(await readProfile(),beforeInputProfile)
console.log('PASS: real AudioContext chime, immediate menu/hidden/mute silence, safe resume, muted placement, persisted sound setting.')

await page.locator('[data-piece="0"]').click()
await clickCell(0,0)
assert.equal((await readRun()).turn, 8)
assert.equal((await readRun()).board[0][0], 'leaf')
await reload()
assert.equal((await readRun()).turn, 8)
await page.locator('[data-piece="1"]').click()
await clickCell(0,0)
assert.equal((await readRun()).turn, 8, 'Invalid negative origin must not place or throw')
const from = await page.locator('[data-piece="1"]').boundingBox()
const to = await point(2,5)
await page.mouse.move(from.x+from.width/2,from.y+from.height/2)
await page.mouse.down()
await page.mouse.move(to.x,to.y,{steps:12})
assert.notEqual(await page.locator('#hint').textContent(),'Эта фигура сюда не поместится.',
  'Starting a new legal drag clears the error hint from the previous invalid placement')
await capture({path:'artifacts/qa/drag.png'})
await page.mouse.up()
assert.equal((await readRun()).turn,9)
assert.equal((await readRun()).board[5][2], 'leaf')
await page.evaluate(() => window.__events.game_api_pause())
await page.locator('[data-piece="2"]').click()
await clickCell(5,5)
assert.equal((await readRun()).turn,9,'SDK pause blocks input')
await page.locator('#pause-button').click()
await page.evaluate(() => window.__events.game_api_resume())
assert.equal(await page.locator('.modal').count(),1,'SDK resume does not close menu pause')
await page.locator('[data-resume]').click()
await page.locator('#dew-button').click()
await clickCell(0,0)
assert.equal((await readRun()).board[0][0], 'empty')
assert.equal((await readRun()).dew,0)
await capture({path:'artifacts/qa/dew.png'})
await page.waitForTimeout(1100)
await page.locator('#prune-button').click()
await clickCell(1,1)
assert.ok((await readRun()).board[1].every(value => value === 'empty'))
await capture({path:'artifacts/qa/prune.png'})
await page.waitForTimeout(1200)
await page.locator('#bloom-button').click()
await clickCell(5,3)
assert.equal((await readRun()).board[3][5], 'empty')
assert.equal((await readRun()).bloomReady,false)
await capture({path:'artifacts/qa/bloom.png'})
await page.waitForTimeout(1500)
await loadFixture(state => {
  state.board = state.board.map(row=>row.map(()=> 'empty'))
  state.board[7] = Array(8).fill('leaf'); state.board[7][7] = 'empty'
  state.pieces = [{id:'dot',color:'sun',cells:[{x:0,y:0}]},null,null]
})
await page.locator('[data-piece="0"]').click()
const beforeLinePreview = await readRun()
const linePreviewPoint = await point(7,7)
await page.mouse.move(linePreviewPoint.x,linePreviewPoint.y)
await page.waitForFunction(() => document.querySelector('#game-canvas').dataset.previewLines === '1')
assert.equal(await page.locator('#hint').evaluate(hint => hint.classList.contains('is-clear-preview')),true,
  'An available line clear is explained before committing the move')
assert.deepEqual(await readRun(),beforeLinePreview,'A prospective clear is purely a preview')
await capture({path:'artifacts/qa/line-preview.png'})
await page.mouse.move(10,10)
assert.equal(await page.locator('#game-canvas').getAttribute('data-preview-lines'),'0','Leaving the board removes the clear preview')
await page.emulateMedia({reducedMotion:'reduce'})
const previewHand = await page.locator('[data-piece="0"]').boundingBox()
await page.mouse.move(previewHand.x+previewHand.width/2,previewHand.y+previewHand.height/2)
await page.mouse.down()
await page.mouse.move(linePreviewPoint.x,linePreviewPoint.y,{steps:4})
assert.equal(await page.locator('#game-canvas').getAttribute('data-preview-lines'),'1')
await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,pointerType:'mouse',isPrimary:true})))
await page.mouse.up()
assert.equal(await page.locator('#game-canvas').getAttribute('data-preview-lines'),'0',
  'Cancellation redraws the cleared preview even when reduced motion disables the idle frame loop')
assert.deepEqual(await readRun(),beforeLinePreview)
await page.emulateMedia({reducedMotion:'no-preference'})
await clickCell(7,7)
assert.ok((await readRun()).board[7].every(value=>value==='empty'))
assert.equal(await page.locator('#game-canvas').getAttribute('data-preview-lines'),'0','Placing the piece clears its preview state')
await page.waitForTimeout(220)
await capture({path:'artifacts/qa/line.png'})
await page.waitForTimeout(1300)
for (const viewport of [{width:390,height:844},{width:320,height:568},{width:844,height:390},{width:1366,height:768}]) {
  await page.setViewportSize(viewport)
  await page.waitForTimeout(100)
  await capture({path:`artifacts/qa/layout-${viewport.width}x${viewport.height}.png`})
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight),false)
  for (const selector of ['canvas','#piece-hand','#bloom-button','#dew-button','#prune-button']) {
    const r = await page.locator(selector).boundingBox()
    assert.ok(r && r.x >= 0 && r.y >= 0 && r.x+r.width <= viewport.width+1 && r.y+r.height <= viewport.height+1, `${selector} fits ${JSON.stringify({viewport,r})}`)
  }
  await capture({path:`artifacts/qa/layout-${viewport.width}x${viewport.height}.png`})
  if (viewport.width <= 390) {
    await page.locator('#garden-side-button').click()
    await assertModalFits(`Garden ${viewport.width}px`,viewport)
    await capture({path:`artifacts/qa/garden-${viewport.width}.png`})
    await page.locator('[data-preview-zone="moon"]').click()
    await assertModalFits(`Locked garden ${viewport.width}px`,viewport)
    assert.equal(await page.locator('[data-apply-garden]').isDisabled(),true)
    await page.locator('[data-close]').click()
    await page.locator('#fullscreen-button').click()
    await assertModalFits(`Modes ${viewport.width}px`,viewport)
    await capture({path:`artifacts/qa/modes-${viewport.width}.png`})
    await page.locator('[data-help]').click()
    await assertModalFits(`Guide ${viewport.width}px`,viewport)
    await capture({path:`artifacts/qa/guide-${viewport.width}.png`})
    assert.equal(await page.locator('.guide-grid .guide-cell').count(),192)
    await page.locator('.modal').evaluate(modal => { modal.scrollTop = modal.scrollHeight })
    await assertModalFits(`Scrolled guide ${viewport.width}px`,viewport)
    await page.locator('[data-close]').click()
  }
}
await page.setViewportSize({width:1536,height:1024})
await loadFixture(state => {
  state.board = state.board.map(row => row.map(()=> 'leaf'))
  state.pieces = [null,null,null]; state.dew = 0; state.bloomReady = false; state.petals = 0; state.pruneReady = false
  state.status = 'awaiting-revive'; state.reviveAvailable = true
})
await page.locator('[data-revive]').click()
assert.equal(await page.locator('[data-revive]').isDisabled(),true)
await page.evaluate(() => window.__ad.onError())
await page.waitForTimeout(100)
assert.equal((await readRun()).status,'awaiting-revive')
await page.locator('[data-revive]').click()
await page.evaluate(() => { window.__ad.onRewarded(); window.__ad.onClose() })
await page.waitForTimeout(100)
await clickCell(0,0)
assert.equal((await readRun()).reviveAvailable,false)
assert.equal((await readRun()).status,'playing')
await page.locator('#login-button').click()
await page.waitForTimeout(100)
assert.equal(await page.locator('#toast').textContent(),'Вход необязателен. Он сохраняет сад и позволяет отправить рекорд.')
const profileBeforeCloudError = await readProfile()
const runBeforeCloudError = await readRun()
await page.evaluate(() => {
  window.__sdk.auth.openAuthDialog = async () => {}
  window.__sdk.getPlayer = async () => ({
    isAuthorized: () => true,
    getData: async () => { window.__calls.push('readCloud'); throw Error('Simulated cloud read failure') },
    setData: async () => window.__calls.push('writeCloud')
  })
})
await page.locator('#login-button').click()
await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Не удалось прочитать облачное сохранение'))
assert.deepEqual(await readProfile(),profileBeforeCloudError,'A cloud read failure preserves local progress')
assert.deepEqual(await readRun(),runBeforeCloudError,'A cloud read failure preserves the current board')
assert.equal(await page.evaluate(() => window.__calls.includes('writeCloud')),false,'Failed cloud reads never overwrite the remote profile')
await page.locator('#login-button').click()
await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Не удалось прочитать облачное сохранение'))
await page.waitForFunction(() => window.__calls.filter(call => call === 'readCloud').length === 2)
await page.locator('#pause-button').click()
assert.equal(await page.locator('.modal-pause').count(),1,'Cloud failure clears the pending sign-in state and permits play/menu input')
await page.locator('[data-resume]').click()
assert.deepEqual(errors,[])
console.log('PASS: click, drag, invalid origin, reload, SDK/menu pause, 3 abilities, line clear, 4 viewports, rewarded error/success, cancelled login and cloud read failure without data loss.')
await page.setViewportSize({width:390,height:844})
await loadFixture(state => {
  state.board = state.board.map(row=>row.map(()=> 'empty'))
  state.pieces = [{id:'dot',color:'mint',cells:[{x:0,y:0}]},{id:'bar',color:'sun',cells:[{x:0,y:0},{x:1,y:0}]},null]
})
let touchButton = await page.locator('[data-piece="0"]').boundingBox()
await page.touchscreen.tap(touchButton.x+touchButton.width/2,touchButton.y+touchButton.height/2)
let touchPoint = await point(0,0)
await page.touchscreen.tap(touchPoint.x,touchPoint.y)
assert.equal((await readRun()).board[0][0],'leaf')
const touchSession = await context.newCDPSession(page)
touchButton = await page.locator('[data-piece="1"]').boundingBox()
await touchSession.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchButton.x+touchButton.width/2,y:touchButton.y+touchButton.height/2}]})
touchPoint = await point(4,4)
await touchSession.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touchPoint]})
await touchSession.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
assert.equal((await readRun()).board[4][4],'leaf')
await loadFixture(state => { state.pieces = [{id:'dot',color:'coral',cells:[{x:0,y:0}]},null,null] })
await page.locator('[data-piece="0"]').tap()
touchPoint = await point(7,7)
await page.touchscreen.tap(touchPoint.x,touchPoint.y)
assert.equal((await readRun()).board[7][7],'leaf','The decorative lower-right frame does not intercept a touch placement')
await page.emulateMedia({reducedMotion:'reduce'})
await page.waitForTimeout(100)
await loadFixture(state => { state.pieces = [{id:'dot',color:'sun',cells:[{x:0,y:0}]},null,null] })
await page.keyboard.press('1')
await page.keyboard.press('ArrowRight')
await page.keyboard.press('ArrowDown')
await page.keyboard.press('Enter')
assert.equal((await readRun()).board[1][1],'leaf')
assert.deepEqual(errors,[])
console.log('PASS: touchscreen tap and drag, keyboard placement, reduced-motion mode; no page errors.')
await page.waitForTimeout(300)
await capture({path:'artifacts/qa/mobile.png'})

// Finishing the run is a one-time reward. Nested dialogs must not expose the finished board.
await page.setViewportSize({width:1536,height:1024})
const existingBestScore = (await readProfile()).bestScore
await loadFixture(state => {
  state.board = state.board.map(row => row.map(() => 'leaf'))
  state.pieces = [null,null,null]
  state.dew = 0; state.bloomReady = false; state.petals = 0; state.pruneReady = false
  state.status = 'awaiting-revive'; state.reviveAvailable = true
  state.score = existingBestScore
})
const profileBeforeFinish = await readProfile()
await page.locator('[data-finish]').click()
assert.equal(await page.locator('.modal-result').count(),1)
assert.equal((await page.locator('.modal-result').innerText()).includes('Новый рекорд!'),false,
  'Matching an existing best is not announced as a new record')
const completedProfile = await readProfile()
assert.equal(completedProfile.completedRuns,profileBeforeFinish.completedRuns+1)
assert.ok(completedProfile.nectar > profileBeforeFinish.nectar,'Finishing a run earns visible garden nectar')
assert.equal(await readRun(),null,'A finished run is not saved as playable')
await page.locator('[data-mode-open]').click()
assert.equal(await page.locator('.modal-modes').count(),1)
await page.locator('[data-close]').click()
assert.equal(await page.locator('.modal-result').count(),1,'Closing mode selection returns to the result screen')
await page.locator('[data-result-garden]').click()
assert.equal(await page.locator('.modal-garden').count(),1)
await page.locator('[data-preview-zone="rose"]').click()
await assertGardenFocusTrap('rose')
await page.locator('[data-close]').click()
assert.equal(await page.locator('.modal-result').count(),1,'Closing the greenhouse returns to the result screen')
await page.keyboard.press('Escape')
assert.equal(await page.locator('.modal-result').count(),1,'Escape cannot reopen a finished board')
assert.deepEqual(await readProfile(),completedProfile,'Returning to results never grants a second harvest')
await capture({path:'artifacts/qa/result.png'})
assert.deepEqual(errors,[])
console.log('PASS: garden tab focus restoration and bidirectional focus trap; result → modes/garden → result, one-time harvest, no finished-board escape.')

// A daily run may cross midnight; its result still belongs to the saved challenge ID.
const todayChallenge = new Date().toISOString().slice(0,10)
const previousChallenge = new Date(Date.now()-86400000).toISOString().slice(0,10)
const dailyResultFixture = {...beforeInputChecks,
  mode:'daily', challengeId:previousChallenge,
  board:Array.from({length:8},()=>Array(8).fill('leaf')),
  pieces:[null,null,null], dew:0, bloomReady:false, petals:0, pruneReady:false,
  status:'awaiting-revive', reviveAvailable:true, score:100
}
await page.evaluate(({profile,state}) => {
  sessionStorage.setItem('smoke-profile-fixture',JSON.stringify(profile))
  window.name = JSON.stringify(state)
},{profile:{...completedProfile,dailyScores:{[previousChallenge]:2000,[todayChallenge]:9000}},state:dailyResultFixture})
await reload()
await page.locator('[data-finish]').click()
assert.equal(await page.locator('.daily-result strong').textContent(),'2000',
  'A previous-day run displays that challenge’s personal best, not today’s best')
assert.equal((await readProfile()).dailyScores[previousChallenge],2000)
assert.equal((await readProfile()).dailyScores[todayChallenge],9000)
console.log('PASS: tying a record is not a new best; a resumed daily run keeps its original result date.')
const english = await browser.newContext({viewport:{width:1366,height:768},locale:'de-DE'})
const enPage = await english.newPage()
await enPage.goto('http://127.0.0.1:5173/')
await enPage.waitForSelector('[data-close]')
await enPage.locator('[data-close]').click()
assert.equal(await enPage.locator('html').getAttribute('lang'),'en')
assert.equal(await enPage.title(),'Blooming Move')
await enPage.screenshot({path:'artifacts/qa/english-fallback.png'})
console.log('PASS: unsupported locale falls back to fully English UI, local adapter starts without SDK.')
await browser.close()
