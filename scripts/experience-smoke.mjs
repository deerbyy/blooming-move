// New-experience regressions in an isolated browser context. No user browser/profile access.
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.BLOOM_PLAYWRIGHT || 'playwright')
const browser = await chromium.launch({ channel:'chrome', headless:true })
const context = await browser.newContext({viewport:{width:1536,height:1024},locale:'ru-RU',hasTouch:true})
const page = await context.newPage()
const errors = []
const profileKey = 'blooming-move:profile:v1', runKey = 'blooming-move:run:v1'
const channels = ['master','music','effects','ui']
const pieces = ['mint','sun','coral'].map((color,index) => ({id:`dot-${index}`,color,cells:[{x:0,y:0}]}))
const emptyBoard = () => Array.from({length:8},()=>Array(8).fill('empty'))
const fixtureRun = (overrides={}) => ({
  version:2,mode:'standard',challengeId:null,board:emptyBoard(),
  boardColors:Array.from({length:8},()=>Array(8).fill(null)),pieces,
  score:90,bestCombo:0,combo:0,petals:0,bloomReady:false,dew:0,pruneReady:false,
  turn:3,dailyRack:2,rngState:12345,reviveAvailable:true,status:'playing',...overrides
})
const fixtureProfile = (overrides={}) => ({
  version:1,nectar:470,bestScore:100,dailyScores:{},completedRuns:3,
  lastInterstitialAt:0,muted:true,selectedGarden:'warm',gardenSelectedAt:0,
  audioLevels:{master:.7,music:.32,effects:.8,ui:.5},...overrides
})

page.on('pageerror',error => errors.push(error.message))
page.on('console',message => { if (message.type()==='error') errors.push(message.text()) })
await page.addInitScript(({run,profile,runKey,profileKey}) => {
  Element.prototype.requestFullscreen = async () => {}
  const NativeAudio = window.AudioContext
  window.__oscillators = 0
  if (NativeAudio) window.AudioContext = class extends NativeAudio {
    constructor(...args) { super(...args); window.__audio = this }
    createOscillator() { window.__oscillators++; return super.createOscillator() }
  }
  window.__events = {}
  window.__calls = []
  window.YaGames = {init:async () => ({
    environment:{i18n:{lang:'ru'}},
    features:{LoadingAPI:{ready:()=>window.__calls.push('ready')},GameplayAPI:{start:()=>window.__calls.push('start'),stop:()=>window.__calls.push('stop')}},
    getPlayer:async () => ({isAuthorized:()=>false}),
    auth:{openAuthDialog:async () => { throw Error('cancelled') }},
    screen:{fullscreen:{request:async () => {}}},
    on:(name,fn) => { window.__events[name]=fn }
  })}
  const injection = sessionStorage.getItem('experience-fixture')
  if (injection) {
    const next = JSON.parse(injection)
    if (next.run) localStorage.setItem(runKey,JSON.stringify(next.run))
    if (next.profile) localStorage.setItem(profileKey,JSON.stringify(next.profile))
    sessionStorage.removeItem('experience-fixture')
  } else if (!localStorage.getItem('experience-initialized')) {
    localStorage.setItem(runKey,JSON.stringify(run))
    localStorage.setItem(profileKey,JSON.stringify(profile))
    localStorage.setItem('experience-initialized','true')
  }
},{run:fixtureRun(),profile:fixtureProfile(),runKey,profileKey})

const readRun = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)),runKey)
const readProfile = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)),profileKey)
const reload = async () => {
  await page.reload()
  await page.waitForFunction(() => window.__calls.includes('ready'))
}
const loadFixture = async (run,profile) => {
  await page.evaluate(next => sessionStorage.setItem('experience-fixture',JSON.stringify(next)),{run,profile})
  await reload()
}
const point = (x,y) => page.locator('#game-canvas').evaluate((canvas,{x,y}) => {
  const rect=canvas.getBoundingClientRect(), inset=Number(canvas.dataset.inset)
  return {x:rect.x+rect.width*(inset+(x+.5)*(1-inset*2)/8),y:rect.y+rect.height*(inset+(y+.5)*(1-inset*2)/8)}
},{x,y})
const move = async (slot,x,y) => {
  await page.locator(`[data-piece="${slot}"]`).click()
  const target=await point(x,y)
  await page.mouse.click(target.x,target.y)
}
const counter = (selector='#score-value') => page.locator(`${selector} .rolling-readable`).textContent()
const counterValue = async (selector='#score-value') => Number((await counter(selector)).replace(/[^0-9-]/g,''))
const rollingState = (selector='#score-value') => page.locator(selector).evaluate(element => ({
  moving:element.getAnimations({subtree:true}).filter(animation => animation.playState==='running').length,
  transforms:Array.from(element.querySelectorAll('.rolling-strip'),strip => getComputedStyle(strip).transform),
  labels:element.querySelectorAll('.rolling-readable').length,
  strips:Array.from(element.querySelectorAll('.rolling-strip'),strip => strip.children.length)
}))
const waitForCounter = async (value,selector='#score-value') => {
  await page.waitForFunction(({value,selector}) => {
    const element=document.querySelector(selector)
    const label=element?.querySelector('.rolling-readable')?.textContent ?? ''
    return Number(label.replace(/[^0-9-]/g,''))===value &&
      element.getAnimations({subtree:true}).every(animation => animation.playState!=='running')
  },{value,selector})
}
const capture = async name => {
  await page.locator('.garden-scene-art,.garden-backdrop').evaluateAll(images => Promise.all(images.map(image => image.decode())))
  if (await page.locator('#stat-tip:not([hidden])').count()) await page.waitForTimeout(350)
  if (await bannerVisible()) await page.waitForTimeout(750)
  await page.screenshot({path:`artifacts/qa/experience-${name}.png`})
}
const assertViewport = async label => {
  const geometry=await page.evaluate(() => ({
    viewport:{width:innerWidth,height:innerHeight},
    overflow:document.documentElement.scrollWidth>innerWidth || document.documentElement.scrollHeight>innerHeight,
    modal:Array.from(document.querySelectorAll('.modal,#stat-tip')).filter(element => {
      const style=getComputedStyle(element)
      return style.display!=='none' && style.visibility!=='hidden' && Number(style.opacity)>0
    }).map(element=>({id:element.id,className:element.className,rect:element.getBoundingClientRect().toJSON(),overflow:element.scrollWidth>element.clientWidth+1}))
  }))
  assert.equal(geometry.overflow,false,`${label}: no document overflow`)
  for (const item of geometry.modal) {
    const r=item.rect
    assert.ok(r.x>=-1 && r.y>=-1 && r.right<=geometry.viewport.width+1 && r.bottom<=geometry.viewport.height+1,
      `${label}: ${item.id || item.className} fits ${JSON.stringify(r)}`)
    assert.equal(item.overflow,false,`${label}: ${item.id || item.className} has no horizontal overflow`)
  }
}
const bannerVisible = () => page.locator('#record-celebration').evaluate(element => element.classList.contains('is-visible'))
const explanationOpener = async key => {
  const label=page.locator(`[data-explain="${key}"]`).first()
  return key==='daily' && !await label.isVisible() ? page.locator('#daily-button') : label
}
const setRange = async (channel,percent) => {
  await page.locator(`[data-audio-channel="${channel}"]`).evaluate((input,value) => {
    input.value=String(value)
    input.dispatchEvent(new Event('input',{bubbles:true}))
    input.dispatchEvent(new Event('change',{bubbles:true}))
  },percent)
}
const openSettings = async () => {
  await page.locator('#fullscreen-button').click()
  await page.waitForSelector('.modal-settings')
  assert.equal(await page.locator('.modal-settings input[type="range"]').count(),4)
}
const closeSettings = () => page.locator('.modal-settings [data-close]').click()
const waitForAudio = state => page.waitForFunction(state => window.__audio?.state===state,state)

try {
  await page.goto('http://127.0.0.1:5173/')
  await page.waitForFunction(() => window.__calls.includes('ready'))
  await mkdir('artifacts/qa',{recursive:true})
  assert.equal(await counterValue(),90)
  assert.equal((await rollingState()).moving,0,'Saved values start settled instead of replaying old animations')
  assert.equal(await bannerVisible(),false)

  // Exact accessible target and independent visual reels, including a decimal carry.
  await move(0,0,0)
  assert.equal((await readRun()).score,100)
  assert.equal(await counterValue(),100,'Assistive text exposes the exact score during the animation')
  const duringCarry=await rollingState()
  assert.ok(duringCarry.moving>0,'A score change starts visual number reels')
  assert.equal(duringCarry.labels,1,'Intermediate reel digits are not duplicated in accessible text')
  await page.waitForTimeout(90)
  assert.notDeepEqual((await rollingState()).transforms,duringCarry.transforms,'Reels progress through intermediate visual positions')
  assert.equal(await bannerVisible(),false,'Tying an existing best does not celebrate a broken record')
  await waitForCounter(100)
  assert.ok((await rollingState()).strips.every(length=>length===1),'Settled reels contain only the final digits')

  // A running record is a celebration, not a saved leaderboard result or repeat reward.
  await move(1,1,0)
  assert.equal((await readRun()).score,110)
  assert.equal(await bannerVisible(),true,'Crossing an existing completed best celebrates immediately')
  assert.equal((await readProfile()).bestScore,100,'A live celebration does not submit/save an unfinished best')
  await capture('record')
  await page.waitForFunction(() => !document.querySelector('#record-celebration').classList.contains('is-visible'),{},{timeout:10000})
  await move(2,2,0)
  assert.equal(await bannerVisible(),false,'Subsequent scores in the same run do not replay the celebration')
  await waitForCounter(120)
  await reload()
  assert.equal(await counterValue(),120)
  assert.equal(await bannerVisible(),false,'Reloading an already-broken record never replays its celebration')
  await loadFixture(fixtureRun({score:120}),fixtureProfile())
  await move(0,0,0)
  assert.equal(await bannerVisible(),false,'Continuing above the old best after a reload is not another crossing')
  await loadFixture(fixtureRun({score:0}),fixtureProfile({bestScore:0}))
  await move(0,0,0)
  assert.equal(await bannerVisible(),false,'A first score is not misrepresented as breaking an existing record')

  // Three updates before the first animation can settle; no stale finish callback wins.
  await loadFixture(fixtureRun({score:200}),fixtureProfile({bestScore:5000}))
  await move(0,0,0)
  await move(1,1,0)
  await move(2,2,0)
  const rapidScore=(await readRun()).score
  assert.equal(rapidScore,230)
  assert.equal(await counterValue(),rapidScore)
  await waitForCounter(rapidScore)
  await page.waitForTimeout(900)
  assert.equal(await counterValue(),rapidScore,'Earlier reel callbacks cannot overwrite the newest score')
  await loadFixture(fixtureRun({score:300}),fixtureProfile({bestScore:5000}))
  await move(0,0,0)
  await page.emulateMedia({reducedMotion:'reduce'})
  await waitForCounter(310)
  await move(1,1,0)
  assert.equal(await counterValue(),320)
  assert.equal((await rollingState()).moving,0,'Reduced motion updates values without spinning reels')
  await page.emulateMedia({reducedMotion:'no-preference'})
  await move(2,2,0)
  await page.locator('#pause-button').click()
  assert.equal((await rollingState()).moving,0,'Pausing settles number reels at their correct final value')
  assert.equal(await counterValue(),330)
  await page.locator('[data-resume]').click()
  console.log('PASS: rolling carry/intermediate/final/rapid/reduced/reload/pause; once-per-run live record, no ties or unfinished save.')

  // Every explanation opens through actual mouse, keyboard, and touch controls.
  const beforeTips=await readRun(), profileBeforeTips=await readProfile()
  for (const key of ['score','combo','best','nectar','daily']) {
    const opener=await explanationOpener(key)
    await opener.click()
    await page.waitForSelector('#stat-tip [data-tip-close]',{state:'visible'})
    assert.ok((await page.locator('#stat-tip').innerText()).trim().length>25,`${key} has a useful explanation`)
    await assertViewport(`Desktop ${key} tip`)
    for (const shortcut of ['1','2','3']) {
      await page.keyboard.press(shortcut)
      assert.equal(await page.locator('#stat-tip').evaluate(tip=>tip.contains(document.activeElement)),true,
        'Reading a tip cannot redirect numeric shortcuts to the board')
    }
    assert.deepEqual(await readRun(),beforeTips)
    await page.locator('#stat-tip [data-tip-close]').click()
    assert.equal(await opener.evaluate(button=>document.activeElement===button),true,'Closing a tip restores its trigger focus')
    await opener.focus()
    await page.keyboard.press('Enter')
    await page.waitForSelector('#stat-tip [data-tip-close]',{state:'visible'})
    await page.keyboard.press('Escape')
    assert.equal(await opener.evaluate(button=>document.activeElement===button),true,'Escape restores trigger focus')
    await opener.focus()
    await page.keyboard.press('Space')
    await page.waitForSelector('#stat-tip [data-tip-close]',{state:'visible'})
    await page.mouse.click(10,10)
    assert.equal(await page.locator('#stat-tip').isVisible(),false,'An outside click dismisses an explanation')
  }
  assert.deepEqual(await readRun(),beforeTips,'Reading explanations does not perform moves')
  assert.deepEqual(await readProfile(),profileBeforeTips,'Reading explanations does not spend or grant rewards')
  console.log('PASS: five meaningful explanations, mouse/Enter/Space, close/Escape/outside, focus return, unchanged run and profile.')

  // Independent audio settings preserve exact zeros and have a real silent master switch.
  await openSettings()
  assert.equal(await page.locator('#audio-muted-note').isVisible(),true,'Settings explain the existing global mute')
  const chosen={master:78,music:22,effects:61,ui:37}
  for (const channel of channels) await setRange(channel,chosen[channel])
  assert.deepEqual((await readProfile()).audioLevels,Object.fromEntries(channels.map(channel=>[channel,chosen[channel]/100])))
  await page.locator('[data-audio-channel="ui"]').focus()
  await page.keyboard.press('Home')
  assert.equal((await readProfile()).audioLevels.ui,0,'Range keyboard controls can set exact silence')
  await page.keyboard.press('ArrowRight')
  assert.ok((await readProfile()).audioLevels.ui>0,'Range keyboard controls change the persisted channel')
  await setRange('ui',37)
  await page.locator('[data-audio-enable]').click()
  assert.equal((await readProfile()).muted,false)
  assert.equal(await page.locator('.modal-settings').count(),1,'Unmuting from settings keeps the settings open')
  const beforePreview=await page.evaluate(()=>window.__oscillators)
  await page.locator('[data-audio-preview]').click()
  await page.waitForFunction(count=>window.__oscillators>count,beforePreview)
  await waitForAudio('suspended')
  assert.equal(await page.locator('.modal-settings').count(),1,'The sound preview returns to a paused settings screen')
  await capture('audio-settings')
  await closeSettings()
  await reload()
  await openSettings()
  for (const channel of channels) assert.equal(Number(await page.locator(`[data-audio-channel="${channel}"]`).inputValue()),chosen[channel])
  for (const channel of channels) await setRange(channel,0)
  await closeSettings()
  await reload()
  await openSettings()
  assert.deepEqual((await readProfile()).audioLevels,{master:0,music:0,effects:0,ui:0},'Zero levels survive normalization and reload')
  for (const channel of channels) assert.equal(await page.locator(`[data-audio-channel="${channel}"]`).inputValue(),'0')
  await closeSettings()
  await loadFixture(fixtureRun({score:400}),undefined)
  const beforeSilentMove=await page.evaluate(()=>window.__oscillators)
  await move(0,0,0)
  await page.waitForTimeout(120)
  assert.equal(await page.evaluate(()=>window.__oscillators),beforeSilentMove,'All-zero channels create no sound voices')

  await openSettings()
  await setRange('master',70); await setRange('effects',60)
  await closeSettings()
  await move(1,1,0)
  await waitForAudio('running')
  assert.ok(await page.evaluate(()=>window.__oscillators>0),'Effects still work while music and UI are independently silent')
  await page.locator('#pause-button').click()
  await waitForAudio('suspended')
  await page.locator('[data-resume]').click()
  await waitForAudio('running')
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true})
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await waitForAudio('suspended')
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))})
  await waitForAudio('running')
  await page.locator('#sound-button').click()
  await waitForAudio('suspended')
  const levelsBeforeMute=(await readProfile()).audioLevels
  await page.locator('#sound-button').click()
  await waitForAudio('running')
  assert.deepEqual((await readProfile()).audioLevels,levelsBeforeMute,'Global mute never destroys individual channel levels')

  await openSettings()
  await setRange('effects',0); await setRange('ui',0); await setRange('music',35)
  await closeSettings()
  await waitForAudio('running')
  const beforeMusic=await page.evaluate(()=>window.__oscillators)
  await page.waitForTimeout(1000)
  assert.ok(await page.evaluate(()=>window.__oscillators)>beforeMusic,'Music-only mode produces a quiet evolving soundscape')
  await openSettings()
  await waitForAudio('suspended')
  const pausedMusic=await page.evaluate(()=>window.__oscillators)
  await page.waitForTimeout(950)
  assert.equal(await page.evaluate(()=>window.__oscillators),pausedMusic,'Paused music does not continue scheduling hidden voices')
  await setRange('music',0); await setRange('ui',50)
  await closeSettings()
  await page.waitForTimeout(100)
  const beforeUi=await page.evaluate(()=>window.__oscillators)
  await page.locator('[data-piece="2"]').click()
  await page.waitForFunction(count=>window.__oscillators>count,beforeUi)
  await page.waitForTimeout(90)
  const afterUi=await page.evaluate(()=>window.__oscillators)
  const effectsMutedPoint=await point(2,0)
  await page.mouse.click(effectsMutedPoint.x,effectsMutedPoint.y)
  assert.equal(await page.evaluate(()=>window.__oscillators),afterUi,'UI-only mode does not leak a placement effect')
  await openSettings()
  await setRange('master',0)
  await closeSettings()
  await waitForAudio('suspended')
  console.log('PASS: four independent audio ranges, keyboard, persisted zeros, preview, effects/music/UI isolation, mute/menu/hidden pause and resume.')

  // Compact screens: touch explanations and the settings dialog must remain usable.
  for (const viewport of [{width:390,height:844},{width:320,height:568},{width:1536,height:1024}]) {
    await page.setViewportSize(viewport)
    await page.waitForTimeout(120)
    await assertViewport(`Game ${viewport.width}px`)
    for (const key of ['score','combo','best','nectar','daily']) {
      const opener=await explanationOpener(key)
      if (viewport.width<400) await opener.tap()
      else await opener.click()
      await page.waitForSelector('#stat-tip [data-tip-close]',{state:'visible'})
      await assertViewport(`${key} ${viewport.width}px`)
      if (key==='nectar') await capture(`tip-${viewport.width}`)
      await page.locator('[data-tip-close]').click()
    }
    await openSettings()
    await assertViewport(`Settings ${viewport.width}px`)
    await capture(`settings-${viewport.width}`)
    await page.locator('.modal-settings').evaluate(modal=>{modal.scrollTop=modal.scrollHeight})
    await assertViewport(`Scrolled settings ${viewport.width}px`)
    await page.locator('.modal-settings [data-mode-open]').click()
    assert.equal(await page.locator('.modal-modes').count(),1,'Mode selection remains reachable from settings')
    await page.locator('.modal-modes [data-close]').click()
  }
  // Harvest counters are not animated unseen behind a result dialog.
  const finishFixture=fixtureRun({
    score:6000,bestCombo:3,combo:0,turn:12,board:Array.from({length:8},()=>Array(8).fill('leaf')),
    pieces:[null,null,null],status:'awaiting-revive'
  })
  await loadFixture(finishFixture,fixtureProfile({bestScore:5000}))
  assert.equal(await counterValue('#nectar-value'),470)
  await page.locator('[data-finish]').click()
  const harvested=await readProfile()
  assert.equal(harvested.bestScore,6000)
  assert.ok(harvested.nectar>470)
  assert.equal(await counterValue('#nectar-value'),470,'The hidden garden counter retains its old frame during the result dialog')
  assert.equal((await rollingState('#nectar-value')).moving,0)
  assert.equal((await rollingState('#best-value')).moving,0)
  await page.locator('[data-restart]').click()
  assert.equal(await counterValue('#nectar-value'),harvested.nectar)
  assert.equal(await counterValue('#best-value'),6000)
  assert.ok((await rollingState('#nectar-value')).moving>0,'The harvest rolls into view when the playable screen returns')
  await waitForCounter(harvested.nectar,'#nectar-value')
  await waitForCounter(6000,'#best-value')
  assert.deepEqual(await readProfile(),harvested,'Showing the harvest animation never grants it twice')
  console.log('PASS: hidden counters stay still at results; harvested nectar and best visibly roll on the next run exactly once.')
  // A long-lived endless game must not make adjacent stat values overlap.
  await loadFixture(fixtureRun({score:1234567}),fixtureProfile({bestScore:2345678,nectar:1234567,muted:true}))
  for (const width of [390,320,1536]) {
    await page.setViewportSize({width,height:width===320?568:width===390?844:1024})
    await page.waitForTimeout(150)
    for (const selector of ['#score-value','#best-value','#nectar-value']) {
      const geometry=await page.locator(selector).evaluate(element=>{
        const container=element.closest('.score-card,.nectar-card').getBoundingClientRect()
        const digits=Array.from(element.querySelectorAll('.rolling-digit,.rolling-symbol'),digit=>digit.getBoundingClientRect().toJSON())
        return {container:container.toJSON(),digits}
      })
      assert.ok(geometry.digits.every(digit=>digit.x>=geometry.container.x-1 && digit.right<=geometry.container.right+1),
        `${selector} fits its own stat column at ${width}px: ${JSON.stringify(geometry)}`)
    }
    await assertViewport(`Seven-digit stats ${width}px`)
    await capture(`large-stats-${width}`)
  }
  assert.deepEqual(errors,[])
  console.log('PASS: desktop/390/320 layouts, touch tips, scrolling audio settings and mode navigation; no page/console errors.')
} finally {
  await browser.close()
}
