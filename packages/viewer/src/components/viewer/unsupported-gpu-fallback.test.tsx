// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { UnsupportedGpuViewerFallback } from './unsupported-gpu-fallback'

const BROWSER_DETAIL =
  'This browser or environment could not initialize WebGPU or WebGL, so Pascal cannot render the 3D scene here. Try opening the editor in a browser with hardware acceleration enabled.'

describe('UnsupportedGpuViewerFallback', () => {
  test('keeps the browser notice by default', () => {
    const html = renderToStaticMarkup(<UnsupportedGpuViewerFallback />)
    expect(html).toContain('3D viewer unavailable')
    expect(html).toContain(BROWSER_DETAIL)
    expect(html).toContain('data-viewer-unsupported="browser"')
  })

  test('points to Linux or Dopame OS on a platform without a 3D backend', () => {
    const html = renderToStaticMarkup(<UnsupportedGpuViewerFallback reason="platform" />)
    expect(html).toContain('3D viewer unavailable')
    expect(html).toContain(
      '3D view isn’t available on this platform yet. Open this project on Linux or Dopame OS to see it in 3D.',
    )
    expect(html).not.toContain('hardware acceleration')
    expect(html).toContain('data-viewer-unsupported="platform"')
  })
})
