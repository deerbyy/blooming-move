// Isolated browser: visual atmosphere must never change the saved game.
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.BLOOM_PLAYWRIGHT || 'playwright')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(() => {
  localStorage.setItem('blooming-move:profile:v1', JSON.stringify({ version: 1, nectar: 3000, bestScore: 1000, dailyScores: {}, completedRuns: 5, lastInterstitialAt: 0, muted: true }))
})
await mkdir('artifacts/qa', { recursive: true })
try {
  await page.goto('http://127.0.0.1:5173/')
  await page.locator('[data-close]').click()
  const saved = await page.evaluate(() => localStorage.getItem('blooming-move:run:v1'))
  for (const zone of ['warm', 'rose', 'lily', 'moon', 'dome']) {
    if (zone !== 'warm') {
      await page.locator('#garden-side-button').click()
      await page.locator(`[data-preview-zone="${zone}"]`).click()
      const preview = page.locator('.garden-scene .ambient-foliage').first()
      const previewStart = await preview.evaluate(el => getComputedStyle(el).transform)
      await page.waitForTimeout(350)
      assert.notEqual(await preview.evaluate(el => getComputedStyle(el).transform), previewStart, 'Garden preview stays alive while gameplay is paused')
      await page.locator('[data-apply-garden]').click()
    }
    await page.waitForTimeout(900)
    assert.equal(await page.locator('.garden-environment .garden-living-layer').count(), 1)
    assert.equal(await page.locator(`.garden-environment .atmosphere-${zone}`).count(), 1)
    const sample = () => page.locator('.garden-environment .ambient-foliage').first().evaluate(el => getComputedStyle(el).transform)
    const first = await sample()
    await page.waitForTimeout(450)
    assert.notEqual(await sample(), first, `${zone} foliage moves`)
    // Compare actual exposed background pixels, not only sub-pixel CSS transforms.
    const clip = { x: 0, y: 100, width: 30, height: 750 }
    const before = await page.screenshot({ clip })
    await page.waitForTimeout(1200)
    assert.notDeepEqual(await page.screenshot({ clip }), before, `${zone} visible background changes`)
    await page.screenshot({ path: `artifacts/qa/atmosphere-${zone}.png` })
    // Keep a separate, unobstructed illustration for inspecting placement of layers.
    await page.locator('.app-shell').evaluate(el => { el.style.visibility = 'hidden' })
    await page.screenshot({ path: `artifacts/qa/atmosphere-${zone}-painting.png` })
    await page.locator('.app-shell').evaluate(el => { el.style.visibility = '' })
    console.log(`PASS: ${zone} decoded, animated, with one current atmosphere layer`)
  }
  await page.locator('#pause-button').click()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const frozen = await page.locator('.garden-environment .ambient-stage').evaluate(el => Array.from(el.querySelectorAll('*'), n => [getComputedStyle(n).transform, getComputedStyle(n).opacity]))
  await page.waitForTimeout(400)
  assert.deepEqual(await page.locator('.garden-environment .ambient-stage').evaluate(el => Array.from(el.querySelectorAll('*'), n => [getComputedStyle(n).transform, getComputedStyle(n).opacity])), frozen)
  await page.locator('[data-close]').click()
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size)
    const geometry = await page.locator('.garden-environment .ambient-stage').evaluate(el => {
      const r = el.getBoundingClientRect()
      return { width: r.width, height: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    })
    assert.ok(Math.abs(geometry.width / geometry.height - 1.5) < .001)
    assert.ok(geometry.left <= 1 && geometry.top <= 1 && geometry.right >= size.width - 1 && geometry.bottom >= size.height - 1)
    await page.screenshot({ path: `artifacts/qa/atmosphere-${size.width}.png` })
    assert.ok(await page.locator('#garden-side-button').isVisible(), 'Greenhouse remains reachable in both orientations')
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await page.locator('.garden-environment .garden-atmosphere').evaluate(el => getComputedStyle(el).display), 'none')
  assert.equal(await page.evaluate(() => localStorage.getItem('blooming-move:run:v1')), saved)
  assert.deepEqual(errors, [])
  console.log('PASS: frozen pause, reduced motion, cover crop on portrait/landscape, unchanged save and no page errors')
} finally { await browser.close() }
