import { localeFrom, type Locale } from './i18n'
import type { PlayerProgress } from './game/types'

declare global {
  interface Window {
    YaGames?: {
      init: () => Promise<YandexSdk>
    }
  }
}

interface YandexPlayer {
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
    showFullscreenAdv: (options: { callbacks: FullscreenCallbacks }) => void
  }
  on?: (event: 'game_api_pause' | 'game_api_resume', callback: () => void) => void
}

interface AdCallbacks {
  onOpen?: () => void
  onRewarded?: () => void
  onClose?: (shown: boolean) => void
  onError?: () => void
}

interface FullscreenCallbacks {
  onOpen?: () => void
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
  markReady(): void
  gameplay(active: boolean): void
  requestFullscreen(): Promise<void>
  signIn(): Promise<boolean>
  loadCloud(): Promise<PlayerProgress | null>
  saveCloud(progress: PlayerProgress): Promise<void>
  submitBestScore(score: number): Promise<void>
  getLeaderboard(): Promise<LeaderboardEntry[]>
  showRewarded(): Promise<boolean>
  showInterstitial(): Promise<void>
}

class LocalPlatformAdapter implements PlatformAdapter {
  readonly isYandex = false
  readonly locale: Locale
  readonly signedIn = false

  constructor(locale?: string) {
    this.locale = localeFrom(locale ?? navigator.language)
  }

  markReady(): void {}
  gameplay(_active: boolean): void {}
  async requestFullscreen(): Promise<void> {
    await document.documentElement.requestFullscreen?.().catch(() => undefined)
  }
  async signIn(): Promise<boolean> { return false }
  async loadCloud(): Promise<PlayerProgress | null> { return null }
  async saveCloud(_progress: PlayerProgress): Promise<void> {}
  async submitBestScore(_score: number): Promise<void> {}
  async getLeaderboard(): Promise<LeaderboardEntry[]> { return [] }
  async showRewarded(): Promise<boolean> { return false }
  async showInterstitial(): Promise<void> {}
}

class YandexPlatformAdapter implements PlatformAdapter {
  readonly isYandex = true
  readonly locale: Locale
  private player: YandexPlayer | null = null
  private authenticated = false
  private wantsGameplay = false
  private platformPaused = false

  constructor(private readonly sdk: YandexSdk) {
    this.locale = localeFrom(sdk.environment?.i18n?.lang)
    sdk.on?.('game_api_pause', () => {
      this.platformPaused = true
      this.sdk.features?.GameplayAPI?.stop()
    })
    sdk.on?.('game_api_resume', () => {
      this.platformPaused = false
      if (this.wantsGameplay) this.sdk.features?.GameplayAPI?.start()
    })
  }

  get signedIn(): boolean {
    return this.authenticated
  }

  markReady(): void {
    this.sdk.features?.LoadingAPI?.ready()
  }

  gameplay(active: boolean): void {
    this.wantsGameplay = active
    if (active && !this.platformPaused) this.sdk.features?.GameplayAPI?.start()
    else this.sdk.features?.GameplayAPI?.stop()
  }

  async requestFullscreen(): Promise<void> {
    await this.sdk.screen?.fullscreen?.request().catch(() => undefined)
  }

  async signIn(): Promise<boolean> {
    try {
      await this.sdk.auth?.openAuthDialog()
      this.player = await this.sdk.getPlayer()
      this.authenticated = true
      return true
    } catch {
      return false
    }
  }

  async loadCloud(): Promise<PlayerProgress | null> {
    if (!this.authenticated || !this.player) return null
    try {
      return await this.player.getData() as PlayerProgress
    } catch {
      return null
    }
  }

  async saveCloud(progress: PlayerProgress): Promise<void> {
    if (!this.authenticated || !this.player) return
    await this.player.setData(progress, true).catch(() => undefined)
  }

  async submitBestScore(score: number): Promise<void> {
    if (!this.authenticated || !this.sdk.leaderboards) return
    const available = await this.sdk.isAvailableMethod?.('leaderboards.setScore') ?? true
    if (available) await this.sdk.leaderboards.setScore('bloom_best', score).catch(() => undefined)
  }

  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    if (!this.sdk.leaderboards) return []
    try {
      const response = await this.sdk.leaderboards.getEntries('bloom_best', {
        includeUser: this.authenticated,
        quantityTop: 10,
        quantityAround: 3
      })
      return response.entries ?? []
    } catch {
      return []
    }
  }

  showRewarded(): Promise<boolean> {
    if (!this.sdk.adv) return Promise.resolve(false)
    return new Promise((resolve) => {
      let rewarded = false
      this.sdk.adv?.showRewardedVideo({
        callbacks: {
          onOpen: () => this.gameplay(false),
          onRewarded: () => { rewarded = true },
          onClose: () => resolve(rewarded),
          onError: () => resolve(false)
        }
      })
    })
  }

  showInterstitial(): Promise<void> {
    if (!this.sdk.adv) return Promise.resolve()
    return new Promise((resolve) => {
      this.sdk.adv?.showFullscreenAdv({
        callbacks: {
          onOpen: () => this.gameplay(false),
          onClose: () => resolve(),
          onError: () => resolve()
        }
      })
    })
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
