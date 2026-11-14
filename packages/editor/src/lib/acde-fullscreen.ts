import { isAcde, loadAcdeModule } from '@pascal-app/core/platform'

// acde rejects the Fullscreen API (NotSupportedError): full screen is a state of the app's
// window, asked for with `acde:window`'s requestState('fullscreen') and followed through its
// `state` event. The system may refuse, so the UI follows the event, not the request.

type AcdeWindowState = 'normal' | 'minimized' | 'filled' | 'fullscreen'

export type AcdeWindow = {
  readonly state: AcdeWindowState
  requestState(state: AcdeWindowState): void
  on(
    name: 'state',
    handler: (event: {
      readonly state: AcdeWindowState
      readonly previous: AcdeWindowState
    }) => void,
  ): () => boolean
}

export type FullscreenHost = {
  isAcde: () => boolean
  loadWindow: () => Promise<AcdeWindow | null>
}

const defaultHost: FullscreenHost = {
  isAcde,
  loadWindow: async () => (await loadAcdeModule<{ window?: AcdeWindow }>('window'))?.window ?? null,
}

/** Enters or leaves full screen. Outside acde it calls the Fullscreen API synchronously, inside the gesture. */
export function toggleFullscreen(host: FullscreenHost = defaultHost): void {
  if (host.isAcde()) {
    void host.loadWindow().then((window) => {
      window?.requestState(window.state === 'fullscreen' ? 'normal' : 'fullscreen')
    })
    return
  }
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen() // acde-compat: guarded
}

/** Calls `onChange` whenever full screen is entered or left; returns the unsubscribe. */
export function subscribeFullscreen(
  onChange: (fullscreen: boolean) => void,
  host: FullscreenHost = defaultHost,
): () => void {
  if (host.isAcde()) {
    let stopped = false
    let off: (() => boolean) | undefined
    void host.loadWindow().then((window) => {
      if (!window || stopped) return
      onChange(window.state === 'fullscreen')
      off = window.on('state', ({ state }) => onChange(state === 'fullscreen'))
    })
    return () => {
      stopped = true
      off?.()
    }
  }
  const handler = () => onChange(!!document.fullscreenElement)
  document.addEventListener('fullscreenchange', handler)
  return () => document.removeEventListener('fullscreenchange', handler)
}
