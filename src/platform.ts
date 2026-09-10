import { localeFrom, type Locale } from './i18n'
import type { PlayerProgress } from './game/types'
import { isProgress } from './game/storage'

declare global {
  interface Window {
    YaGames?: {
      init: () => Promise<YandexSdk>
    }
  }
}

interface YandexPlayer {
  isAuthorized: () => boolean
  getData: () => Promise<unknown>
  setData: (data: unknown, flush?: boolean) => Promise<void>
}

interface YandexSdk {
  environment?: { i18n?: { lang?: string } }
  features?: {
    LoadingAPI?: { ready: () => void }
    GameplayAPI?: { start: () => void; stop: () => void }
  }
  screen?: { fullscreen?: { request: () => Promise<void> } }
  auth?: { openAuthDialog: () => Promise<void> }
  getPlayer: () => Promise<YandexPlayer>
  isAvailableMethod?: (method: string) => Promise<boolean>
  leaderboards?: {
    setScore: (name: string, score: number) => Promise<void>
    getEntries: (name: string, options: { includeUser: boolean; quantityTop: number; quantityAround: number }) => Promise<LeaderboardResponse>
  }
  adv?: {
    showRewardedVideo: (options: { callbacks: AdCallbacks }) => void
  }
  on?: (event: 'game_api_pause' | 'game_api_resume', callback: () => void) => void
}

interface AdCallbacks {
  onOpen?: () => void
  onRewarded?: () => void
  onClose?: (shown: boolean) => void
  onError?: () => void
}

export interface LeaderboardEntry {
  rank: number
  score: number
  player: { publicName?: string }
}

interface LeaderboardResponse {
  entries?: LeaderboardEntry[]
}

export interface PlatformAdapter {
  readonly isYandex: boolean
  readonly locale: Locale
  readonly signedIn: boolean
  readonly paused: boolean
  onPauseChange(listener: (paused: boolean) => void): () => void
  markReady(): void
  gameplay(active: boolean): void
  requestFullscreen(): Promise<void>
  signIn(): Promise<boolean>
  loadCloud(): Promise<PlayerProgress | null>
  saveCloud(progress: PlayerProgress): Promise<void>
  submitBestScore(score: number): Promise<void>
  getLeaderboard(): Promise<LeaderboardEntry[]>
  showRewarded(): Promise<boolean>
}

class LocalPlatformAdapter implements PlatformAdapter {
  readonly isYandex = false
  readonly locale: Locale
  readonly signedIn = false
  readonly paused = false

  constructor(locale?: string) {
    this.locale = localeFrom(locale ?? navigator.language)
  }

  markReady(): void {}
  onPauseChange(listener: (paused: boolean) => void): () => void {
    listener(false)
    return () => undefined
  }
  gameplay(_active: boolean): void {}
  async requestFullscreen(): Promise<void> {
    try { await document.documentElement.requestFullscreen?.() } catch { /* Browser may deny it. */ }
  }
  async signIn(): Promise<boolean> { return false }
  async loadCloud(): Promise<PlayerProgress | null> { return null }
  async saveCloud(_progress: PlayerProgress): Promise<void> {}
  async submitBestScore(_score: number): Promise<void> {}
  async getLeaderboard(): Promise<LeaderboardEntry[]> { return [] }
  async showRewarded(): Promise<boolean> { return false }
}

class YandexPlatformAdapter implements PlatformAdapter {
  readonly isYandex = true
  readonly locale: Locale
  private player: YandexPlayer | null = null
  private authenticated = false
  private wantsGameplay = false
  private platformPaused = false
  private adPaused = false
  private authPaused = false
  private notifiedPause = false
  private reportedGameplay = false
  private ready = false
  private pauseListeners = new Set<(paused: boolean) => void>()
  private signInRequest: Promise<boolean> | null = null
  private rewardedRequest: Promise<boolean> | null = null
  private cloudPending: PlayerProgress | null = null
  private cloudTimer: ReturnType<typeof setTimeout> | null = null
  private cloudWriting = false
  private lastCloudWrite = -Infinity
  private cloudReadable = false
  private cloudSession = 0
  private identitySession = 0
  private scoreRequest: Promise<void> = Promise.resolve()
  private lastScoreWrite = -Infinity
  private bestSubmittedScore = -1
  private leaderboardRequest: Promise<LeaderboardEntry[]> | null = null
  private leaderboardCache: LeaderboardEntry[] = []
  private leaderboardCacheUntil = -Infinity

  constructor(private readonly sdk: YandexSdk) {
    this.locale = localeFrom(sdk.environment?.i18n?.lang)
    sdk.on?.('game_api_pause', () => {
      this.platformPaused = true
      this.updatePause()
    })
    sdk.on?.('game_api_resume', () => {
      this.platformPaused = false
      this.updatePause()
    })
  }

  get signedIn(): boolean {
    return this.authenticated
  }

  get paused(): boolean {
    return this.platformPaused || this.adPaused || this.authPaused
  }

  onPauseChange(listener: (paused: boolean) => void): () => void {
    this.pauseListeners.add(listener)
    listener(this.paused)
    return () => { this.pauseListeners.delete(listener) }
  }

  markReady(): void {
    if (this.ready) return
    try {
      this.sdk.features?.LoadingAPI?.ready()
      this.ready = true
    } catch {
      // SDK failure must not prevent local gameplay. A later call may retry.
    }
  }

  gameplay(active: boolean): void {
    this.wantsGameplay = active
    this.syncGameplay()
  }

  private syncGameplay(): void {
    const active = this.wantsGameplay && !this.paused
    if (active === this.reportedGameplay) return
    try {
      if (active) this.sdk.features?.GameplayAPI?.start()
      else this.sdk.features?.GameplayAPI?.stop()
      this.reportedGameplay = active
    } catch {
      // Platform signals are best-effort; input and audio use paused directly.
    }
  }

  private updatePause(): void {
    this.syncGameplay()
    if (this.notifiedPause === this.paused) return
    this.notifiedPause = this.paused
    for (const listener of this.pauseListeners) listener(this.paused)
  }

  async requestFullscreen(): Promise<void> {
    try { await this.sdk.screen?.fullscreen?.request() } catch { /* Browser may deny it. */ }
  }

  signIn(): Promise<boolean> {
    if (this.signInRequest) return this.signInRequest
    // A fresh identity must never inherit an old account's queued local snapshot.
    this.resetCloudSession()
    this.identitySession += 1
    this.bestSubmittedScore = -1
    this.leaderboardRequest = null
    this.leaderboardCache = []
    this.leaderboardCacheUntil = -Infinity
    this.authenticated = false
    this.player = null
    this.signInRequest = Promise.resolve().then(async () => {
      this.authPaused = true
      this.updatePause()
      try {
        let player = await this.sdk.getPlayer()
        if (!player.isAuthorized()) {
          if (!this.sdk.auth) return false
          await this.sdk.auth.openAuthDialog()
          player = await this.sdk.getPlayer()
        }
        this.authenticated = player.isAuthorized()
        this.player = this.authenticated ? player : null
        return this.authenticated
      } catch {
        return false
      } finally {
        this.authPaused = false
        this.updatePause()
        this.signInRequest = null
      }
    })
    return this.signInRequest
  }

  async loadCloud(): Promise<PlayerProgress | null> {
    if (!this.authenticated || !this.player) return null
    const player = this.player
    const session = this.resetCloudSession()
    // A failed read is not an empty cloud profile. Keep writes disabled and let
    // the caller retain local play, report the error and offer a read retry.
    const progress = await player.getData()
    if (session !== this.cloudSession || player !== this.player) throw new Error('Cloud account changed while reading')
    const empty = progress == null || (typeof progress === 'object' && !Array.isArray(progress) && Object.keys(progress).length === 0)
    // Unknown non-empty data is not a new account. Preserve it for recovery
    // instead of replacing earned cloud progress with this device's profile.
    if (!empty && !isProgress(progress)) throw new Error('Cloud profile is not compatible')
    this.cloudReadable = true
    return empty ? null : progress as PlayerProgress
  }

  async saveCloud(progress: PlayerProgress): Promise<void> {
    if (!this.authenticated || !this.player || !this.cloudReadable) return
    this.cloudPending = { ...progress, dailyScores: { ...progress.dailyScores } }
    this.scheduleCloudWrite()
  }

  private scheduleCloudWrite(): void {
    if (!this.cloudReadable || this.cloudWriting || this.cloudTimer || !this.cloudPending) return
    // SDK limit: 100 setData calls / 5 minutes. Local saves remain immediate.
    const delay = Math.max(0, 3200 - (Date.now() - this.lastCloudWrite))
    if (delay > 0) {
      this.cloudTimer = setTimeout(() => {
        this.cloudTimer = null
        void this.writeCloud()
      }, delay)
    } else {
      void this.writeCloud()
    }
  }

  private async writeCloud(): Promise<void> {
    if (this.cloudWriting || !this.cloudReadable || !this.cloudPending || !this.player) return
    const player = this.player
    const snapshot = this.cloudPending
    this.cloudPending = null
    this.cloudWriting = true
    this.lastCloudWrite = Date.now()
    try {
      await player.setData(snapshot, true)
    } catch {
      // The authoritative local save is retained; retry on the next change.
    } finally {
      // Keep the physical write serialized even when a new sign-in/read starts
      // meanwhile: an old slow write must never finish after a newer snapshot.
      this.cloudWriting = false
      this.scheduleCloudWrite()
    }
  }

  private resetCloudSession(): number {
    this.cloudSession += 1
    this.cloudReadable = false
    this.cloudPending = null
    if (this.cloudTimer) clearTimeout(this.cloudTimer)
    this.cloudTimer = null
    return this.cloudSession
  }

  submitBestScore(score: number): Promise<void> {
    const leaderboards = this.sdk.leaderboards
    if (!this.authenticated || !leaderboards || !Number.isSafeInteger(score) || score < 0) return Promise.resolve()
    const session = this.identitySession
    // Serialize records: a slow availability check must not let an older,
    // smaller score overwrite a newer one or cross an account change.
    this.scoreRequest = this.scoreRequest.then(async () => {
      if (session !== this.identitySession || !this.authenticated || score <= this.bestSubmittedScore) return
      try {
        const available = await this.sdk.isAvailableMethod?.('leaderboards.setScore') ?? true
        if (!available || session !== this.identitySession || !this.authenticated) return
        // SDK limit: at most one setScore request per second.
        const delay = Math.max(0, 1100 - (Date.now() - this.lastScoreWrite))
        if (delay) await new Promise(resolve => setTimeout(resolve, delay))
        if (session !== this.identitySession || !this.authenticated) return
        this.lastScoreWrite = Date.now()
        await leaderboards.setScore('bloom_best', score)
        if (session === this.identitySession) this.bestSubmittedScore = score
      } catch {
        // An unsuccessful write remains retryable; local records are intact.
      }
    })
    return this.scoreRequest
  }

  getLeaderboard(): Promise<LeaderboardEntry[]> {
    const leaderboards = this.sdk.leaderboards
    if (!leaderboards) return Promise.resolve([])
    if (this.leaderboardRequest) return this.leaderboardRequest
    if (Date.now() < this.leaderboardCacheUntil) return Promise.resolve(this.leaderboardCache)
    const session = this.identitySession
    const request = Promise.resolve().then(async () => {
      if (session !== this.identitySession) return []
      try {
        const response = await leaderboards.getEntries('bloom_best', {
          includeUser: this.authenticated,
          quantityTop: 10,
          quantityAround: 3
        })
        if (session !== this.identitySession) return []
        this.leaderboardCache = Array.isArray(response?.entries) ? response.entries.filter(entry =>
          entry && Number.isSafeInteger(entry.rank) && entry.rank > 0 &&
          Number.isSafeInteger(entry.score) && entry.score >= 0 && entry.player &&
          (entry.player.publicName === undefined || typeof entry.player.publicName === 'string')
        ) : []
      } catch {
        // Keep a previous snapshot while offline instead of clearing the view.
      }
      if (session !== this.identitySession) return []
      // SDK limit: 20 getEntries calls / 5 minutes. Reopening the panel is free.
      this.leaderboardCacheUntil = Date.now() + 16000
      return this.leaderboardCache
    })
    this.leaderboardRequest = request.finally(() => {
      if (session === this.identitySession) this.leaderboardRequest = null
    })
    return this.leaderboardRequest
  }

  showRewarded(): Promise<boolean> {
    if (this.rewardedRequest) return this.rewardedRequest
    const adv = this.sdk.adv
    if (!adv?.showRewardedVideo) return Promise.resolve(false)

    // Reserve the request before the SDK runs: it may invoke its callbacks
    // synchronously, and repeated taps must still map to one voluntary video.
    const request = Promise.resolve().then(() => new Promise<boolean>((resolve) => {
      let rewarded = false
      let settled = false
      this.adPaused = true
      this.updatePause()
      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        this.adPaused = false
        this.updatePause()
        resolve(value)
      }
      try {
        adv.showRewardedVideo({
          callbacks: {
            onOpen: () => { if (!settled) { this.adPaused = true; this.updatePause() } },
            onRewarded: () => { if (!settled) rewarded = true },
            onClose: () => finish(rewarded),
            // onRewarded is the SDK's confirmation that the view counted.
            // A later close error must not take an earned continuation away.
            onError: () => finish(rewarded)
          }
        })
      } catch {
        finish(rewarded)
      }
    }))
    this.rewardedRequest = request.finally(() => {
      this.rewardedRequest = null
    })
    return this.rewardedRequest
  }

}

export async function createPlatform(): Promise<PlatformAdapter> {
  if (!window.YaGames?.init) return new LocalPlatformAdapter()
  try {
    const sdk = await window.YaGames.init()
    return new YandexPlatformAdapter(sdk)
  } catch {
    return new LocalPlatformAdapter()
  }
}
