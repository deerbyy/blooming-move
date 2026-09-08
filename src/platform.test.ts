import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlatform } from './platform'

type RewardCallbacks = {
  onOpen?: () => void
  onRewarded?: () => void
  onClose?: (shown: boolean) => void
  onError?: () => void
}

function mockSdk() {
  return {
    getPlayer: vi.fn(),
    features: { GameplayAPI: { start: vi.fn(), stop: vi.fn() } },
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

afterEach(() => vi.unstubAllGlobals())

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
})
