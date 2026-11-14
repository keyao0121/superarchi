import { describe, expect, test } from 'bun:test'
import { createThumbnailAutosave } from './use-thumbnail-autosave'

function setup(leaveOnly: boolean, leaveTimeoutMs = 1000) {
  let clock = 0
  let visible = true
  let requests = 0
  const autosave = createThumbnailAutosave({
    leaveOnly,
    request: () => {
      requests += 1
    },
    visible: () => visible,
    now: () => clock,
    leaveTimeoutMs,
  })
  return {
    autosave,
    requests: () => requests,
    advance: (ms: number) => {
      clock += ms
    },
    setVisible: (value: boolean) => {
      visible = value
    },
  }
}

describe('thumbnail autosave in a browser', () => {
  test('captures on the periodic check once an edit has settled, then not again until the next edit', () => {
    const { autosave, requests, advance } = setup(false)
    autosave.tick()
    expect(requests()).toBe(0)

    autosave.sceneChanged()
    advance(4000)
    autosave.tick()
    expect(requests()).toBe(0)
    advance(1000)
    autosave.tick()
    expect(requests()).toBe(1)
    autosave.tick()
    expect(requests()).toBe(1)
  })

  test('captures when the page comes back visible, never while hidden', () => {
    const { autosave, requests, advance, setVisible } = setup(false)
    autosave.sceneChanged()
    advance(6000)
    setVisible(false)
    autosave.visibilityChanged()
    autosave.tick()
    expect(requests()).toBe(0)
    setVisible(true)
    autosave.visibilityChanged()
    expect(requests()).toBe(1)
  })

  test('leaving does not capture', async () => {
    const { autosave, requests } = setup(false)
    autosave.sceneChanged()
    await autosave.leave()
    expect(requests()).toBe(0)
  })
})

describe('thumbnail autosave in acde', () => {
  test('the periodic check and a returning page never capture', () => {
    const { autosave, requests, advance } = setup(true)
    autosave.sceneChanged()
    advance(60_000)
    autosave.tick()
    autosave.visibilityChanged()
    expect(requests()).toBe(0)
  })

  test('leaving captures once and waits until the host stored it', async () => {
    const { autosave, requests } = setup(true)
    autosave.sceneChanged()
    autosave.sceneChanged()
    let left = false
    const leaving = autosave.leave().then(() => {
      left = true
    })
    expect(requests()).toBe(1)
    await Promise.resolve()
    expect(left).toBe(false)

    autosave.captured()
    await leaving
    expect(left).toBe(true)

    await autosave.leave()
    expect(requests()).toBe(1)
  })

  test('leaving an unchanged scene captures nothing', async () => {
    const { autosave, requests } = setup(true)
    await autosave.leave()
    expect(requests()).toBe(0)
  })

  test('the window hiding captures an edited scene once', () => {
    const { autosave, requests, setVisible } = setup(true)
    autosave.sceneChanged()
    setVisible(false)
    autosave.visibilityChanged()
    autosave.visibilityChanged()
    expect(requests()).toBe(1)
  })

  test('a capture that never comes back does not hold the user forever', async () => {
    const { autosave, requests } = setup(true, 10)
    autosave.sceneChanged()
    await autosave.leave()
    expect(requests()).toBe(1)
  })
})
