import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlatform } from './platform'
import { defaultProgress } from './game/storage'

type RewardCallbacks = {
  onOpen?: () => void
  onRewarded?: () => void
  onClose?: (shown: boolean) => void
  onError?: () => void
}

function mockSdk() {
  const events = new Map<string, () => void>()
  const player = {
    isAuthorized: vi.fn(() => false),
    getData: vi.fn(async (): Promise<unknown> => defaultProgress()),
    setData: vi.fn(async (_data: unknown, _flush?: boolean): Promise<void> => undefined)
  }
  return {
    player,
    events,
    on: vi.fn((event: string, callback: () => void) => { events.set(event, callback) }),
    auth: { openAuthDialog: vi.fn(async (): Promise<void> => undefined) },
    getPlayer: vi.fn(async () => player),
    isAvailableMethod: vi.fn(async (_method: string) => true),
    leaderboards: { setScore: vi.fn(async () => undefined), getEntries: vi.fn(async () => ({ entries: [] })) },
    features: { LoadingAPI: { ready: vi.fn() }, GameplayAPI: { start: vi.fn(), stop: vi.fn() } },
    adv: {
      showRewardedVideo: vi.fn<(options: { callbacks: RewardCallbacks }) => void>(),
      showFullscreenAdv: vi.fn()
    }
  }
}

async function setup(sdk = mockSdk()) {
  vi.stubGlobal('window', { YaGames: { init: async () => sdk } })
  return { sdk, platform: await createPlatform() }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('rewarded continuation', () => {
  it('shares one in-flight video across repeated requests', async () => {
    const { sdk, platform } = await setup()
    const first = platform.showRewarded()
    const second = platform.showRewarded()
    expect(second).toBe(first)
    await Promise.resolve()
    expect(sdk.adv.showRewardedVideo).toHaveBeenCalledTimes(1)
    const { callbacks } = sdk.adv.showRewardedVideo.mock.calls[0][0]
    callbacks.onRewarded?.()
    callbacks.onClose?.(true)
    await expect(first).resolves.toBe(true)
  })

  it('does not grant a continuation only because a video closed', async () => {
    const { sdk, platform } = await setup()
    const request = platform.showRewarded()
    await Promise.resolve()
    sdk.adv.showRewardedVideo.mock.calls[0][0].callbacks.onClose?.(true)
    await expect(request).resolves.toBe(false)
  })

  it('releases a failed request so the player can voluntarily retry', async () => {
    const { sdk, platform } = await setup()
    const failed = platform.showRewarded()
    await Promise.resolve()
    sdk.adv.showRewardedVideo.mock.calls[0][0].callbacks.onError?.()
    await expect(failed).resolves.toBe(false)
    const retry = platform.showRewarded()
    await Promise.resolve()
    expect(retry).not.toBe(failed)
    expect(sdk.adv.showRewardedVideo).toHaveBeenCalledTimes(2)
    sdk.adv.showRewardedVideo.mock.calls[1][0].callbacks.onError?.()
    await expect(retry).resolves.toBe(false)
  })

  it('pauses only for the video and resumes a game that was already active', async () => {
    const { sdk, platform } = await setup()
    platform.gameplay(true)
    const request = platform.showRewarded()
    await Promise.resolve()
    const { callbacks } = sdk.adv.showRewardedVideo.mock.calls[0][0]
    callbacks.onOpen?.()
    expect(sdk.features.GameplayAPI.stop).toHaveBeenCalledTimes(1)
    callbacks.onClose?.(true)
    await expect(request).resolves.toBe(false)
    expect(sdk.features.GameplayAPI.start).toHaveBeenCalledTimes(2)
  })

  it('treats a synchronous SDK exception as an unavailable video', async () => {
    const sdk = mockSdk()
    sdk.adv.showRewardedVideo.mockImplementation(() => { throw new Error('SDK unavailable') })
    const { platform } = await setup(sdk)
    await expect(platform.showRewarded()).resolves.toBe(false)
    await expect(platform.showRewarded()).resolves.toBe(false)
    expect(sdk.adv.showRewardedVideo).toHaveBeenCalledTimes(2)
  })

  it('keeps input paused until both the SDK and the rewarded overlay have resumed', async () => {
    const { sdk, platform } = await setup()
    const changes = vi.fn()
    platform.onPauseChange(changes)
    platform.gameplay(true)
    const request = platform.showRewarded()
    await Promise.resolve()
    sdk.events.get('game_api_pause')?.()
    sdk.adv.showRewardedVideo.mock.calls[0][0].callbacks.onClose?.(true)
    await request
    expect(platform.paused).toBe(true)
    expect(sdk.features.GameplayAPI.start).toHaveBeenCalledTimes(1)
    sdk.events.get('game_api_resume')?.()
    expect(platform.paused).toBe(false)
    expect(changes.mock.calls).toEqual([[false], [true], [false]])
    expect(sdk.features.GameplayAPI.start).toHaveBeenCalledTimes(2)
  })

  it('does not resume gameplay when the player opens a menu during an SDK pause', async () => {
    const { sdk, platform } = await setup()
    platform.gameplay(true)
    sdk.events.get('game_api_pause')?.()
    platform.gameplay(false)
    sdk.events.get('game_api_resume')?.()
    expect(platform.paused).toBe(false)
    expect(sdk.features.GameplayAPI.start).toHaveBeenCalledTimes(1)
  })

  it('ignores callbacks arriving after a failed video', async () => {
    const { sdk, platform } = await setup()
    const request = platform.showRewarded()
    await Promise.resolve()
    const { callbacks } = sdk.adv.showRewardedVideo.mock.calls[0][0]
    callbacks.onError?.()
    await expect(request).resolves.toBe(false)
    callbacks.onOpen?.()
    callbacks.onRewarded?.()
    callbacks.onClose?.(true)
    expect(platform.paused).toBe(false)
  })

  it('preserves a confirmed reward when closing the video reports an error', async () => {
    const { sdk, platform } = await setup()
    const request = platform.showRewarded()
    await Promise.resolve()
    const { callbacks } = sdk.adv.showRewardedVideo.mock.calls[0][0]
    callbacks.onRewarded?.()
    callbacks.onError?.()
    await expect(request).resolves.toBe(true)
    expect(platform.paused).toBe(false)
  })
})

describe('SDK identity and persistence', () => {
  it('never treats a guest Player as authenticated after closing the auth dialog', async () => {
    const { sdk, platform } = await setup()
    await expect(platform.signIn()).resolves.toBe(false)
    expect(platform.signedIn).toBe(false)
    await platform.saveCloud(defaultProgress())
    await platform.submitBestScore(100)
    expect(sdk.player.setData).not.toHaveBeenCalled()
    expect(sdk.leaderboards.setScore).not.toHaveBeenCalled()
  })

  it('reads an already authorized account without reopening its login dialog', async () => {
    const { sdk, platform } = await setup()
    sdk.player.isAuthorized.mockReturnValue(true)
    await expect(platform.signIn()).resolves.toBe(true)
    expect(sdk.auth.openAuthDialog).not.toHaveBeenCalled()
    await expect(platform.loadCloud()).resolves.toEqual(defaultProgress())
  })

  it('reacquires Player after voluntary authorization and shares repeated requests', async () => {
    const { sdk, platform } = await setup()
    sdk.auth.openAuthDialog.mockImplementation(async () => {
      sdk.player.isAuthorized.mockReturnValue(true)
    })
    const request = platform.signIn()
    expect(platform.signIn()).toBe(request)
    await expect(request).resolves.toBe(true)
    expect(sdk.getPlayer).toHaveBeenCalledTimes(2)
    expect(platform.paused).toBe(false)
  })

  it('releases the auth pause after user rejection', async () => {
    const { sdk, platform } = await setup()
    sdk.auth.openAuthDialog.mockRejectedValue(new Error('cancelled'))
    await expect(platform.signIn()).resolves.toBe(false)
    expect(platform.paused).toBe(false)
  })

  it('absorbs errors from the leaderboard availability check', async () => {
    const { sdk, platform } = await setup()
    sdk.player.isAuthorized.mockReturnValue(true)
    await platform.signIn()
    sdk.isAvailableMethod.mockRejectedValue(new Error('offline'))
    await expect(platform.submitBestScore(200)).resolves.toBeUndefined()
    expect(sdk.leaderboards.setScore).not.toHaveBeenCalled()
  })

  it('coalesces fast moves to the latest cloud profile within SDK write limits', async () => {
    vi.useFakeTimers()
    const { sdk, platform } = await setup()
    sdk.player.isAuthorized.mockReturnValue(true)
    await platform.signIn()
    await platform.loadCloud()
    await platform.saveCloud({ ...defaultProgress(), nectar: 10 })
    await platform.saveCloud({ ...defaultProgress(), nectar: 20 })
    await platform.saveCloud({ ...defaultProgress(), nectar: 30 })
    expect(sdk.player.setData).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3200)
    expect(sdk.player.setData).toHaveBeenCalledTimes(2)
    expect(sdk.player.setData).toHaveBeenLastCalledWith({ ...defaultProgress(), nectar: 30 }, true)
  })

  it('can save again after a rejected cloud write', async () => {
    vi.useFakeTimers()
    const { sdk, platform } = await setup()
    sdk.player.isAuthorized.mockReturnValue(true)
    await platform.signIn()
    await platform.loadCloud()
    sdk.player.setData.mockRejectedValueOnce(new Error('offline'))
    await platform.saveCloud(defaultProgress())
    await platform.saveCloud({ ...defaultProgress(), nectar: 50 })
    await vi.advanceTimersByTimeAsync(3200)
    expect(sdk.player.setData).toHaveBeenLastCalledWith({ ...defaultProgress(), nectar: 50 }, true)
  })

  it('does not write a local profile before the signed-in cloud profile is read', async () => {
    const { sdk, platform } = await setup()
    sdk.player.isAuthorized.mockReturnValue(true)
    await platform.signIn()
    await platform.saveCloud({ ...defaultProgress(), nectar: 10 })
    expect(sdk.player.setData).not.toHaveBeenCalled()
  })

  it('rejects a failed cloud read and does not overwrite the account with local progress', async () => {
    vi.useFakeTimers()
    const { sdk, platform } = await setup()
    sdk.player.isAuthorized.mockReturnValue(true)
    await platform.signIn()
    sdk.player.getData.mockRejectedValueOnce(new Error('offline'))
    await expect(platform.loadCloud()).rejects.toThrow('offline')
    await platform.saveCloud(defaultProgress())
    await vi.advanceTimersByTimeAsync(6400)
    expect(sdk.player.setData).not.toHaveBeenCalled()
  })

  it.each([null, {}])('allows saving after a successful empty cloud read: %j', async empty => {
    const { sdk, platform } = await setup()
    sdk.player.isAuthorized.mockReturnValue(true)
    sdk.player.getData.mockResolvedValueOnce(empty)
    await platform.signIn()
    await expect(platform.loadCloud()).resolves.toBeNull()
    await platform.saveCloud(defaultProgress())
    expect(sdk.player.setData).toHaveBeenCalledWith(defaultProgress(), true)
  })

  it.each([
    { unknownFormat: true },
    { ...defaultProgress(), nectar: 1500, selectedGarden: 'unknown' },
    { ...defaultProgress(), nectar: 1500, bestScore: -1 },
    []
  ])('preserves non-empty incompatible cloud data instead of overwriting it: %j', async cloud => {
    vi.useFakeTimers()
    const { sdk, platform } = await setup()
    sdk.player.isAuthorized.mockReturnValue(true)
    sdk.player.getData.mockResolvedValueOnce(cloud)
    await platform.signIn()
    await expect(platform.loadCloud()).rejects.toThrow('Cloud profile is not compatible')
    await platform.saveCloud(defaultProgress())
    await vi.advanceTimersByTimeAsync(6400)
    expect(sdk.player.setData).not.toHaveBeenCalled()
    await platform.loadCloud()
    await platform.saveCloud(defaultProgress())
    expect(sdk.player.setData).toHaveBeenCalledTimes(1)
  })

  it('accepts legacy cloud progress without optional greenhouse selection fields', async () => {
    const { sdk, platform } = await setup()
    sdk.player.isAuthorized.mockReturnValue(true)
    const legacy = { ...defaultProgress(), nectar: 1500, bestScore: 4200 }
    delete legacy.selectedGarden
    delete legacy.gardenSelectedAt
    sdk.player.getData.mockResolvedValueOnce(legacy)
    await platform.signIn()
    await expect(platform.loadCloud()).resolves.toEqual(legacy)
    await platform.saveCloud(legacy)
    expect(sdk.player.setData).toHaveBeenCalledWith(legacy, true)
  })

  it('serializes an in-flight write across a repeated sign-in to the same account', async () => {
    vi.useFakeTimers()
    const { sdk, platform } = await setup()
    sdk.player.isAuthorized.mockReturnValue(true)
    let finishWrite!: () => void
    sdk.player.setData.mockImplementationOnce(() => new Promise(resolve => { finishWrite = resolve }))
    await platform.signIn()
    await platform.loadCloud()
    await platform.saveCloud({ ...defaultProgress(), nectar: 10 })
    await platform.signIn()
    await platform.loadCloud()
    await platform.saveCloud({ ...defaultProgress(), nectar: 20 })
    await vi.advanceTimersByTimeAsync(6400)
    expect(sdk.player.setData).toHaveBeenCalledTimes(1)
    finishWrite()
    await vi.advanceTimersByTimeAsync(0)
    expect(sdk.player.setData).toHaveBeenCalledTimes(2)
    expect(sdk.player.setData).toHaveBeenLastCalledWith({ ...defaultProgress(), nectar: 20 }, true)
  })

  it('allows saving a merged profile after a failed read is retried successfully', async () => {
    const { sdk, platform } = await setup()
    sdk.player.isAuthorized.mockReturnValue(true)
    await platform.signIn()
    sdk.player.getData.mockRejectedValueOnce(new Error('offline'))
    await expect(platform.loadCloud()).rejects.toThrow('offline')
    await platform.saveCloud(defaultProgress())
    const cloud = { ...defaultProgress(), nectar: 1500, selectedGarden: 'moon' as const, gardenSelectedAt: 100 }
    sdk.player.getData.mockResolvedValueOnce(cloud)
    await expect(platform.loadCloud()).resolves.toEqual(cloud)
    await platform.saveCloud(cloud)
    expect(sdk.player.setData).toHaveBeenCalledTimes(1)
    expect(sdk.player.setData).toHaveBeenCalledWith(cloud, true)
  })

  it('cancels a queued old-account write before switching Player and requires a fresh read', async () => {
    vi.useFakeTimers()
    const { sdk, platform } = await setup()
    sdk.player.isAuthorized.mockReturnValue(true)
    await platform.signIn()
    await platform.loadCloud()
    await platform.saveCloud({ ...defaultProgress(), nectar: 10 })
    await platform.saveCloud({ ...defaultProgress(), nectar: 20 })
    const newPlayer = mockSdk().player
    newPlayer.isAuthorized.mockReturnValue(true)
    sdk.getPlayer.mockResolvedValueOnce(newPlayer)
    await platform.signIn()
    await platform.saveCloud({ ...defaultProgress(), nectar: 30 })
    await vi.advanceTimersByTimeAsync(6400)
    expect(sdk.player.setData).toHaveBeenCalledTimes(1)
    expect(newPlayer.setData).not.toHaveBeenCalled()
    await platform.loadCloud()
    await platform.saveCloud({ ...defaultProgress(), nectar: 40 })
    expect(newPlayer.setData).toHaveBeenCalledWith({ ...defaultProgress(), nectar: 40 }, true)
  })

  it('does not re-enable cloud writes from a read belonging to a previous Player', async () => {
    const { sdk, platform } = await setup()
    sdk.player.isAuthorized.mockReturnValue(true)
    await platform.signIn()
    let finishRead!: (value: unknown) => void
    sdk.player.getData.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve }))
    const staleRead = platform.loadCloud()
    const expectedRejection = expect(staleRead).rejects.toThrow('Cloud account changed')
    const newPlayer = mockSdk().player
    newPlayer.isAuthorized.mockReturnValue(true)
    sdk.getPlayer.mockResolvedValueOnce(newPlayer)
    await platform.signIn()
    finishRead({ ...defaultProgress(), nectar: 2500 })
    await expectedRejection
    await platform.saveCloud(defaultProgress())
    expect(newPlayer.setData).not.toHaveBeenCalled()
  })

  it('cancels pending writes while re-reading, including when the new read fails', async () => {
    vi.useFakeTimers()
    const { sdk, platform } = await setup()
    sdk.player.isAuthorized.mockReturnValue(true)
    await platform.signIn()
    await platform.loadCloud()
    await platform.saveCloud({ ...defaultProgress(), nectar: 10 })
    await platform.saveCloud({ ...defaultProgress(), nectar: 20 })
    sdk.player.getData.mockRejectedValueOnce(new Error('offline'))
    await expect(platform.loadCloud()).rejects.toThrow('offline')
    await vi.advanceTimersByTimeAsync(6400)
    expect(sdk.player.setData).toHaveBeenCalledTimes(1)
  })

  it('marks loading complete once without duplicate gameplay events', async () => {
    const { sdk, platform } = await setup()
    platform.markReady()
    platform.markReady()
    platform.gameplay(true)
    platform.gameplay(true)
    expect(sdk.features.LoadingAPI.ready).toHaveBeenCalledTimes(1)
    expect(sdk.features.GameplayAPI.start).toHaveBeenCalledTimes(1)
  })
})

describe('leaderboard request lifecycle', () => {
  it('does not submit an old account score after a new sign-in starts', async () => {
    const { sdk, platform } = await setup()
    sdk.player.isAuthorized.mockReturnValue(true)
    await platform.signIn()
    let finishCheck!: (value: boolean) => void
    sdk.isAvailableMethod.mockImplementationOnce(() => new Promise(resolve => { finishCheck = resolve }))
    const score = platform.submitBestScore(300)
    await Promise.resolve()
    await platform.signIn()
    finishCheck(true)
    await score
    expect(sdk.leaderboards.setScore).not.toHaveBeenCalled()
  })

  it('serializes record submissions, respects the SDK interval and ignores a lower result', async () => {
    vi.useFakeTimers()
    const { sdk, platform } = await setup()
    sdk.player.isAuthorized.mockReturnValue(true)
    await platform.signIn()
    await platform.submitBestScore(300)
    const higher = platform.submitBestScore(500)
    const lower = platform.submitBestScore(400)
    await vi.advanceTimersByTimeAsync(1000)
    expect(sdk.leaderboards.setScore).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    await Promise.all([higher, lower])
    expect(sdk.leaderboards.setScore.mock.calls).toEqual([['bloom_best', 300], ['bloom_best', 500]])
  })

  it('can retry a failed record without treating it as successfully saved', async () => {
    vi.useFakeTimers()
    const { sdk, platform } = await setup()
    sdk.player.isAuthorized.mockReturnValue(true)
    await platform.signIn()
    sdk.leaderboards.setScore.mockRejectedValueOnce(new Error('offline'))
    await platform.submitBestScore(300)
    const retry = platform.submitBestScore(300)
    await vi.advanceTimersByTimeAsync(1100)
    await retry
    expect(sdk.leaderboards.setScore).toHaveBeenCalledTimes(2)
  })

  it('shares and caches repeated leaderboard opens within the SDK read limit', async () => {
    vi.useFakeTimers()
    const { sdk, platform } = await setup()
    const first = platform.getLeaderboard()
    const second = platform.getLeaderboard()
    await Promise.all([first, second])
    for (let open = 0; open < 25; open += 1) await platform.getLeaderboard()
    expect(sdk.leaderboards.getEntries).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(16000)
    await platform.getLeaderboard()
    expect(sdk.leaderboards.getEntries).toHaveBeenCalledTimes(2)
  })

  it('briefly caches failed reads instead of flooding an unavailable SDK', async () => {
    vi.useFakeTimers()
    const { sdk, platform } = await setup()
    sdk.leaderboards.getEntries.mockRejectedValueOnce(new Error('offline'))
    await expect(platform.getLeaderboard()).resolves.toEqual([])
    await expect(platform.getLeaderboard()).resolves.toEqual([])
    expect(sdk.leaderboards.getEntries).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(16000)
    await platform.getLeaderboard()
    expect(sdk.leaderboards.getEntries).toHaveBeenCalledTimes(2)
  })

  it('discards a leaderboard response belonging to a previous identity', async () => {
    const { sdk, platform } = await setup()
    let finishRead!: (value: { entries: [] }) => void
    sdk.leaderboards.getEntries.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve }))
    const oldRead = platform.getLeaderboard()
    await Promise.resolve()
    sdk.player.isAuthorized.mockReturnValue(true)
    await platform.signIn()
    finishRead({ entries: [{ rank: 1, score: 100, player: { publicName: 'Previous account' } }] } as never)
    await expect(oldRead).resolves.toEqual([])
    await platform.getLeaderboard()
    expect(sdk.leaderboards.getEntries).toHaveBeenCalledTimes(2)
    expect(sdk.leaderboards.getEntries).toHaveBeenLastCalledWith('bloom_best', { includeUser: true, quantityTop: 10, quantityAround: 3 })
  })

  it('does not expose a malformed leaderboard collection to the view', async () => {
    const { sdk, platform } = await setup()
    sdk.leaderboards.getEntries.mockResolvedValueOnce({ entries: 'invalid' } as never)
    await expect(platform.getLeaderboard()).resolves.toEqual([])
  })

  it('keeps valid rows while discarding malformed leaderboard entries', async () => {
    const { sdk, platform } = await setup()
    const valid = { rank: 1, score: 500, player: { publicName: 'Gardener' } }
    sdk.leaderboards.getEntries.mockResolvedValueOnce({ entries: [
      valid,
      null,
      { rank: 2, score: -3, player: {} },
      { rank: 3, score: 40, player: null },
      { rank: 4, score: 30, player: { publicName: {} } }
    ] } as never)
    await expect(platform.getLeaderboard()).resolves.toEqual([valid])
  })

  it('does not send a throttled record after signing in again', async () => {
    vi.useFakeTimers()
    const { sdk, platform } = await setup()
    sdk.player.isAuthorized.mockReturnValue(true)
    await platform.signIn()
    await platform.submitBestScore(300)
    const pending = platform.submitBestScore(500)
    await vi.advanceTimersByTimeAsync(500)
    await platform.signIn()
    await vi.advanceTimersByTimeAsync(600)
    await pending
    expect(sdk.leaderboards.setScore).toHaveBeenCalledTimes(1)
    await platform.submitBestScore(100)
    expect(sdk.leaderboards.setScore).toHaveBeenLastCalledWith('bloom_best', 100)
  })
})
