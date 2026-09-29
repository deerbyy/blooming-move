// Isolated Chromium smoke test for cosmetic flower skins.
// The test uses a fake Yandex SDK and never touches the user's browser profile.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.BLOOM_PLAYWRIGHT || 'playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  locale: 'ru-RU',
  hasTouch: true
})
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', error => pageErrors.push(error.message))
page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()) })

const baseUrl = process.env.BLOOM_URL || 'http://127.0.0.1:5173/'
const profileKey = 'blooming-move:profile:v1'
const runKey = 'blooming-move:run:v1'
const fixtureProfile = {
  version: 1,
  nectar: 0,
  bestScore: 0,
  dailyScores: {},
  completedRuns: 0,
  lastInterstitialAt: 0,
  muted: true
}
const fixtureBoard = Array.from({ length: 8 }, () => Array(8).fill('empty'))
const fixtureBoardColors = Array.from({ length: 8 }, () => Array(8).fill(null))
fixtureBoard[2][2] = 'leaf'
fixtureBoardColors[2][2] = 'mint'
const fixtureRun = {
  version: 2,
  mode: 'standard',
  challengeId: null,
  board: fixtureBoard,
  boardColors: fixtureBoardColors,
  pieces: [
    { id: 'dot', color: 'mint', cells: [{ x: 0, y: 0 }] },
    { id: 'square', color: 'coral', cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] },
    { id: 'bar', color: 'sun', cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] }
  ],
  score: 0,
  bestCombo: 0,
  combo: 0,
  petals: 0,
  bloomReady: false,
  dew: 0,
  pruneReady: false,
  turn: 0,
  rngState: 12345,
  reviveAvailable: true,
  status: 'playing'
}

await page.addInitScript(({ profile, run, profileKey, runKey }) => {
  // Keep the fixture only for the first navigation. Reload must exercise
  // persistence instead of silently restoring the initial profile.
  if (!sessionStorage.getItem('skins-smoke-initialized')) {
    localStorage.setItem(profileKey, JSON.stringify(profile))
    localStorage.setItem(runKey, JSON.stringify(run))
    sessionStorage.setItem('skins-smoke-initialized', 'yes')
  }
  window.__calls = []
  window.__ad = null
  window.__events = {}
  window.YaGames = {
    init: async () => {
      window.__sdk = {
        environment: { i18n: { lang: navigator.language } },
        features: {
          LoadingAPI: { ready: () => window.__calls.push('ready') },
          GameplayAPI: {
            start: () => window.__calls.push('start'),
            stop: () => window.__calls.push('stop')
          }
        },
        getPlayer: async () => ({ isAuthorized: () => false }),
        auth: { openAuthDialog: async () => { throw Error('cancelled') } },
        screen: { fullscreen: { request: async () => {} } },
        on: (name, callback) => { window.__events[name] = callback },
        adv: {
          showRewardedVideo: ({ callbacks }) => {
            window.__ad = callbacks
            window.__calls.push('rewarded')
            callbacks.onOpen?.()
          },
          showFullscreenAdv: ({ callbacks }) => {
            window.__fullAd = callbacks
            window.__calls.push('fullscreen')
            callbacks.onOpen?.()
          }
        }
      }
      return window.__sdk
    }
  }
}, { profile: fixtureProfile, run: fixtureRun, profileKey, runKey })

const readProfile = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), profileKey)
const readRun = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), runKey)
const waitForProfile = expected => page.waitForFunction(({ key, expected }) => {
  const profile = JSON.parse(localStorage.getItem(key) || '{}')
  return profile.rewardedAdsWatched === expected
}, { key: profileKey, expected })
const waitForGame = async () => {
  await page.waitForSelector('#game-canvas')
  await page.waitForSelector('[data-piece]')
  await page.waitForFunction(() => window.__calls.includes('ready'))
}
const openSkins = async () => {
  if (await page.locator('.modal').count() === 0) await page.locator('#garden-side-button').click()
  await page.locator('[data-garden-section="skins"]').click()
  await page.waitForSelector('[data-preview-skin="classic"]')
}
const closeModal = async () => {
  if (await page.locator('.modal').count()) await page.locator('[data-close]').click()
}
const activeSkin = () => page.evaluate(() => document.body.dataset.skin)
const selectedSkinTab = () => page.locator('[data-preview-skin][aria-selected="true"]')
const modalFits = async (viewport, label) => {
  const dimensions = await page.locator('.modal').evaluate(modal => ({
    rect: modal.getBoundingClientRect().toJSON(),
    horizontalOverflow: modal.scrollWidth > modal.clientWidth + 1,
    documentOverflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight
  }))
  const rect = dimensions.rect
  assert.ok(rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1,
    `${label} skin dialog fits viewport: ${JSON.stringify({ viewport, rect })}`)
  assert.equal(dimensions.horizontalOverflow, false, `${label} skin dialog has no horizontal overflow`)
  assert.equal(dimensions.documentOverflow, false, `${label} skin dialog does not create page overflow`)
}
const progressText = async () => page.locator('.modal').innerText()
const assertThresholdsVisible = async () => {
  const text = await progressText()
  for (const threshold of [10, 25, 45, 70]) {
    assert.ok(text.includes(`/${threshold}`) || text.includes(`${threshold} просмот`), `Skin requirement ${threshold} is visible`)
  }
}
const watchReward = async ({ reward = true } = {}) => {
  const button = page.locator('[data-watch-skin]')
  await button.waitFor({ state: 'visible' })
  await button.waitFor({ state: 'attached' })
  await page.evaluate(() => { window.__ad = null })
  await button.click()
  await page.waitForFunction(() => window.__ad !== null)
  await page.evaluate(rewarded => {
    const callbacks = window.__ad
    if (rewarded) {
      callbacks.onRewarded?.()
      // The SDK must be idempotent if a buggy bridge repeats its reward callback.
      callbacks.onRewarded?.()
    } else {
      callbacks.onError?.()
    }
    callbacks.onClose?.()
  }, reward)
  await page.waitForTimeout(40)
}
const point = async (x, y) => page.locator('#game-canvas').evaluate((canvas, { x, y }) => {
  const rect = canvas.getBoundingClientRect()
  const inset = Number(canvas.dataset.inset || 0.1)
  return {
    x: rect.x + rect.width * (inset + (x + 0.5) * (1 - inset * 2) / 8),
    y: rect.y + rect.height * (inset + (y + 0.5) * (1 - inset * 2) / 8)
  }
}, { x, y })
const handBackgrounds = () => page.locator('[data-piece] .flower-tile').evaluateAll(tiles => tiles.map(tile => getComputedStyle(tile).backgroundImage))
const ghostBackgrounds = () => page.locator('#drag-ghost .flower-tile').evaluateAll(tiles => tiles.map(tile => getComputedStyle(tile).backgroundImage))
const canvasImage = () => page.locator('#game-canvas').evaluate(canvas => canvas.toDataURL())

try {
  await page.goto(baseUrl)
  await waitForGame()
  assert.equal(await activeSkin(), 'classic', 'Legacy profile without skin fields falls back to classic')

  await openSkins()
  assert.equal(await page.locator('[data-preview-skin]').count(), 5, 'The gallery exposes five flower skins')
  assert.equal(await selectedSkinTab().getAttribute('data-preview-skin'), 'classic')
  await assertThresholdsVisible()

  // Previewing a locked skin is deliberately non-mutating.
  const beforeLockedProfile = await readProfile()
  const beforeLockedRun = await readRun()
  await page.locator('[data-preview-skin="rose"]').click()
  assert.equal(await activeSkin(), 'classic', 'Locked preview never changes the active skin')
  assert.equal(await page.locator('[data-apply-skin]').isDisabled(), true, 'Locked skin cannot be applied')
  assert.deepEqual(await readProfile(), beforeLockedProfile, 'Locked preview does not mutate profile')
  assert.deepEqual(await readRun(), beforeLockedRun, 'Locked preview does not mutate the current run')

  // Failed/no-fill rewarded ads do not grant progress.
  await watchReward({ reward: false })
  assert.equal((await readProfile()).rewardedAdsWatched || 0, 0, 'Rewarded error does not advance skin progress')

  // A real reward advances exactly once even if the bridge repeats onRewarded.
  await watchReward()
  await waitForProfile(1)
  assert.equal((await readProfile()).rewardedAdsWatched, 1, 'One successful ad grants exactly one watch')
  for (let watched = 2; watched <= 10; watched += 1) {
    await watchReward()
    await waitForProfile(watched)
  }
  const unlockedProfile = await readProfile()
  assert.equal(unlockedProfile.rewardedAdsWatched, 10)
  assert.equal(await page.locator('[data-apply-skin]').isDisabled(), false, 'Rose skin unlocks at ten confirmed views')
  assert.ok((await progressText()).includes('/10') || (await progressText()).includes('10 просмот'), 'Rose card shows its completed requirement')

  await page.locator('[data-apply-skin]').click()
  await page.waitForFunction(() => document.querySelector('.modal') === null)
  assert.equal(await activeSkin(), 'rose', 'Applying a skin updates body.dataset.skin')
  const afterApply = await readProfile()
  assert.equal(afterApply.selectedSkin, 'rose')
  assert.ok(Number.isSafeInteger(afterApply.skinSelectedAt) && afterApply.skinSelectedAt > 0, 'Skin selection is timestamped')

  // Compare actual board and hand rendering with classic, then restore rose.
  const roseCanvas = await canvasImage()
  const roseHand = await handBackgrounds()
  assert.ok(roseHand.every(background => background && background !== 'none'), 'Rose hand flowers have rendered assets')
  await openSkins()
  await page.locator('[data-preview-skin="classic"]').click()
  await page.locator('[data-apply-skin]').click()
  await page.waitForFunction(() => document.querySelector('.modal') === null)
  const classicCanvas = await canvasImage()
  const classicHand = await handBackgrounds()
  assert.notEqual(roseCanvas, classicCanvas, 'Canvas rendering changes with the active skin')
  assert.notDeepEqual(roseHand, classicHand, 'Hand rendering changes with the active skin')
  await openSkins()
  await page.locator('[data-preview-skin="rose"]').click()
  await page.locator('[data-apply-skin]').click()
  await page.waitForFunction(() => document.body.dataset.skin === 'rose')

  // A drag ghost is rendered with the same active skin and remains non-mutating.
  const beforeGhostRun = await readRun()
  const piece = await page.locator('[data-piece="0"]').boundingBox()
  const target = await point(0, 0)
  await page.mouse.move(piece.x + piece.width / 2, piece.y + piece.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 5 })
  await page.waitForSelector('#drag-ghost.is-visible')
  const roseGhost = await ghostBackgrounds()
  assert.ok(roseGhost.length > 0 && roseGhost.every(background => background && background !== 'none'), 'Rose drag ghost has rendered assets')
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', isPrimary: true })))
  await page.mouse.up()
  assert.deepEqual(await readRun(), beforeGhostRun, 'Inspecting the drag ghost does not place a piece')

  // Selection and watch progress survive a real reload.
  await page.reload()
  await waitForGame()
  assert.equal(await activeSkin(), 'rose', 'Selected skin survives reload')
  const persisted = await readProfile()
  assert.equal(persisted.rewardedAdsWatched, 10)
  assert.equal(persisted.selectedSkin, 'rose')

  // The gallery stays usable on phone portrait/landscape and desktop layouts.
  for (const viewport of [
    { width: 390, height: 844, label: 'mobile portrait' },
    { width: 844, height: 390, label: 'mobile landscape' },
    { width: 1366, height: 768, label: 'desktop' }
  ]) {
    await page.setViewportSize(viewport)
    await openSkins()
    await modalFits(viewport, viewport.label)
    await closeModal()
  }

  assert.equal(pageErrors.length, 0, `Skin smoke has no page errors: ${pageErrors.join('; ')}`)
  console.log('PASS: skin fallback, locked preview, rewarded progress/idempotency, ten-view unlock, rendering, persistence, responsive gallery, and no page errors.')
} finally {
  await browser.close()
}
