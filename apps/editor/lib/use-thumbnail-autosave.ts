'use client'

import { emitter, useScene } from '@pascal-app/core'
import { isAcde } from '@pascal-app/core/platform'
import { useEffect, useMemo } from 'react'

const IDLE_MS = 5000
const CHECK_INTERVAL_MS = 30_000
/** Leaving waits this long for its capture, then goes anyway. */
const LEAVE_CAPTURE_TIMEOUT_MS = 20_000

export type ThumbnailAutosave = {
  sceneChanged(): void
  /** The periodic check; captures nothing when only leaving does. */
  tick(): void
  visibilityChanged(): void
  /** Captures once if the scene changed since the last thumbnail; resolves when it is stored. */
  leave(): Promise<void>
  /** The host stored a thumbnail. */
  captured(): void
}

/**
 * When the project's thumbnail is re-captured. In a browser: on the periodic check or when the
 * page comes back, once an edit has settled. With `leaveOnly` (acde, whose debug runtime stalls
 * the page for seconds while a capture compiles and renders): only when the user leaves the
 * project or the window hides, and only if the scene changed since the last capture.
 */
export function createThumbnailAutosave({
  request,
  leaveOnly,
  visible = () => document.visibilityState === 'visible',
  now = Date.now,
  leaveTimeoutMs = LEAVE_CAPTURE_TIMEOUT_MS,
}: {
  request: () => void
  leaveOnly: boolean
  visible?: () => boolean
  now?: () => number
  leaveTimeoutMs?: number
}): ThumbnailAutosave {
  let dirty = false
  let lastChange = 0
  let waiting: Array<() => void> = []

  const settle = () => {
    const resolvers = waiting
    waiting = []
    for (const resolve of resolvers) resolve()
  }
  const captureOnSettled = () => {
    if (!dirty || !visible() || now() - lastChange < IDLE_MS) return
    dirty = false
    request()
  }
  const leave = (): Promise<void> => {
    if (!dirty) return Promise.resolve()
    dirty = false
    return new Promise((resolve) => {
      const timeout = setTimeout(settle, leaveTimeoutMs)
      waiting.push(() => {
        clearTimeout(timeout)
        resolve()
      })
      request()
    })
  }

  return {
    sceneChanged() {
      dirty = true
      lastChange = now()
    },
    tick() {
      if (!leaveOnly) captureOnSettled()
    },
    visibilityChanged() {
      if (!leaveOnly) captureOnSettled()
      else if (!visible()) void leave()
    },
    leave: () => (leaveOnly ? leave() : Promise.resolve()),
    captured: settle,
  }
}

export function useThumbnailAutosave({
  sceneId,
  enabled,
}: {
  sceneId: string
  enabled: boolean
}): ThumbnailAutosave {
  const autosave = useMemo(
    () =>
      createThumbnailAutosave({
        leaveOnly: isAcde(),
        request: () =>
          emitter.emit('camera-controls:generate-thumbnail', {
            projectId: sceneId,
            snapLevels: true,
          }),
      }),
    [sceneId],
  )

  useEffect(() => {
    if (!enabled) return

    let armed = false
    const unsubscribe = useScene.subscribe((state, previous) => {
      if (state.nodes === previous.nodes) return
      // The first nodes swap hydrates the scene; it is not an edit.
      if (!armed) {
        armed = true
        return
      }
      autosave.sceneChanged()
    })

    const interval = setInterval(autosave.tick, CHECK_INTERVAL_MS)
    const onVisibility = () => autosave.visibilityChanged()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      unsubscribe()
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [autosave, enabled])

  return autosave
}
