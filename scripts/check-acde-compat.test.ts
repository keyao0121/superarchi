import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  buildBaseline,
  collectFiles,
  compareToBaseline,
  type RuleId,
  readBaseline,
  run,
  scanSource,
  shouldScan,
} from './check-acde-compat'

const rules = (source: string, file = 'packages/a/src/a.ts') =>
  scanSource(file, source).map((finding) => finding.rule)

describe('scanSource rules', () => {
  test.each<[RuleId, string]>([
    ['worker', "const w = new Worker(new URL('./w.ts', import.meta.url))"],
    ['worker', "const w = new SharedWorker('w.js')"],
    ['worker', "const w = new window.Worker('w.js')"],
    ['offscreen-canvas', 'const c = new OffscreenCanvas(1, 1)'],
    ['offscreen-canvas', "const ok = typeof OffscreenCanvas !== 'undefined'"],
    ['create-image-bitmap', 'await createImageBitmap(blob)'],
    ['create-image-bitmap', 'await window.createImageBitmap(blob)'],
    ['crypto-subtle', "await crypto.subtle.digest('SHA-256', data)"],
    ['crypto-subtle', "await globalThis.crypto.subtle.digest('SHA-256', data)"],
    ['webgl-context', "canvas.getContext('webgl')"],
    ['webgl-context', "canvas.getContext('webgl2', { alpha: false })"],
    ['webgl-context', "canvas.getContext('experimental-webgl')"],
    ['request-fullscreen', 'await element.requestFullscreen()'],
    ['request-fullscreen', 'element.webkitRequestFullscreen?.()'],
    ['request-pointer-lock', 'canvas.requestPointerLock()'],
    ['service-worker', "navigator.serviceWorker.register('/sw.js')"],
    ['service-worker', "window.navigator['serviceWorker'].ready"],
    ['remote-esm-import', "import confetti from 'https://esm.sh/canvas-confetti'"],
    ['remote-esm-import', "export * from 'https://cdn.example.com/x.js'"],
    ['remote-esm-import', "const m = await import('https://cdn.example.com/x.js')"],
    ['remote-esm-import', "const m = await import('//cdn.example.com/x.js')"],
  ])('%s hits: %s', (rule, source) => {
    expect(rules(source)).toEqual([rule])
  })

  test.each<[RuleId, string]>([
    ['worker', "const w = new MyWorker('w.js')"],
    ['worker', '// new Worker(url) used to live here'],
    ['worker', "const label = 'new Worker(url)'"],
    ['offscreen-canvas', 'function draw(c: HTMLCanvasElement | OffscreenCanvas) {}'],
    ['offscreen-canvas', 'const name = options.OffscreenCanvas'],
    ['create-image-bitmap', 'const createBitmap = loader.createImageBitmapLater(blob)'],
    ['crypto-subtle', 'crypto.getRandomValues(bytes)'],
    ['crypto-subtle', 'const tone = palette.subtle'],
    ['webgl-context', "canvas.getContext('2d')"],
    ['webgl-context', "canvas.getContext('webgpu')"],
    ['request-fullscreen', 'document.exitFullscreen()'],
    ['request-pointer-lock', 'document.exitPointerLock()'],
    ['service-worker', 'const sw = registry.serviceWorker'],
    ['remote-esm-import', "import { x } from './x'"],
    ['remote-esm-import', "const m = await import('@pascal-app/core')"],
    ['remote-esm-import', "const res = await fetch('https://example.com/data.json')"],
  ])('%s does not hit: %s', (_rule, source) => {
    expect(rules(source)).toEqual([])
  })

  test('reports file, 1-based line and the trimmed line text', () => {
    const findings = scanSource('apps/x/a.tsx', "const a = 1\n  const w = new Worker('w.js')\n")
    expect(findings).toEqual([
      { file: 'apps/x/a.tsx', line: 2, rule: 'worker', text: "const w = new Worker('w.js')" },
    ])
  })

  test('scans <script> bodies inside string literals with file line numbers', () => {
    const source = [
      'const a = 1',
      'const HTML = `<!doctype html><script>',
      'let worker',
      'worker = new Worker(URL.createObjectURL(blob))',
      '</script>`',
      "const SRC = '<p>new Worker(x)</p><script>navigator.serviceWorker.ready</script>'",
    ].join('\n')
    expect(scanSource('a.ts', source).map(({ line, rule }) => [line, rule])).toEqual([
      [4, 'worker'],
      [6, 'service-worker'],
    ])
  })

  test('still scans code inside template substitutions', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: source text with a template substitution
    expect(rules('const s = `${new Worker(url)}`')).toEqual(['worker'])
  })

  test('parses JSX in .tsx and .jsx files', () => {
    const source = 'const A = () => <div onClick={() => el.requestFullscreen()}>a</div>'
    expect(rules(source, 'apps/x/a.tsx')).toEqual(['request-fullscreen'])
    expect(rules(source, 'apps/x/a.jsx')).toEqual(['request-fullscreen'])
  })
})

describe('guard marker', () => {
  test('skips a use with the marker on the same line', () => {
    expect(rules("const w = new Worker('w.js') // acde-compat: guarded")).toEqual([])
  })

  test('skips a use with the marker on the line above', () => {
    expect(
      rules("// acde-compat: guarded — only outside acde\nconst w = new Worker('w.js')"),
    ).toEqual([])
  })

  test('does not skip a use two lines below the marker', () => {
    expect(rules("// acde-compat: guarded\nconst a = 1\nconst w = new Worker('w.js')")).toEqual([
      'worker',
    ])
  })

  test('only skips the marked line when a file has several uses', () => {
    const source = [
      'if (!isAcde()) canvas.requestPointerLock() // acde-compat: guarded',
      'const a = 1',
      'canvas.requestPointerLock()',
    ].join('\n')
    expect(scanSource('a.ts', source).map((finding) => finding.line)).toEqual([3])
  })
})

describe('shouldScan', () => {
  test.each([
    'apps/editor/app/page.tsx',
    'packages/core/src/a.ts',
    'packages/viewer/src/a.js',
    'packages/viewer/src/a.jsx',
    'packages/viewer/src/a.mjs',
  ])('scans %s', (path) => {
    expect(shouldScan(path)).toBe(true)
  })

  test.each([
    'packages/core/node_modules/x/index.js',
    'apps/editor/.next/static/chunk.js',
    'packages/core/dist/index.js',
    'packages/core/build/index.js',
    'apps/editor/.acde/web/index.js',
    'packages/cli/scripts/release.ts',
    'packages/core/src/a.test.ts',
    'apps/editor/e2e/open.e2e.ts',
    'packages/core/src/types.d.ts',
    'packages/core/src/a.css',
  ])('skips %s', (path) => {
    expect(shouldScan(path)).toBe(false)
  })
})

describe('baseline comparison', () => {
  const finding = (file: string, line: number, rule: RuleId = 'worker') => ({
    file,
    line,
    rule,
    text: 'new Worker(url)',
  })

  test('builds sorted per-file, per-rule counts', () => {
    expect(
      buildBaseline([
        finding('b.ts', 1),
        finding('a.ts', 4, 'crypto-subtle'),
        finding('b.ts', 9),
        finding('a.ts', 2),
      ]),
    ).toEqual({
      entries: [
        { file: 'a.ts', rule: 'crypto-subtle', count: 1 },
        { file: 'a.ts', rule: 'worker', count: 1 },
        { file: 'b.ts', rule: 'worker', count: 2 },
      ],
    })
  })

  test('does not report uses covered by the baseline', () => {
    const findings = [finding('a.ts', 1), finding('a.ts', 5)]
    expect(compareToBaseline(findings, buildBaseline(findings))).toEqual({
      violations: [],
      stale: [],
    })
  })

  test('reports a use in a file or rule the baseline does not list', () => {
    const baseline = buildBaseline([finding('a.ts', 1)])
    const { violations } = compareToBaseline(
      [finding('a.ts', 1), finding('a.ts', 3, 'crypto-subtle'), finding('b.ts', 2)],
      baseline,
    )
    expect(violations.map((v) => [v.finding.file, v.finding.rule, v.allowed, v.actual])).toEqual([
      ['a.ts', 'crypto-subtle', 0, 1],
      ['b.ts', 'worker', 0, 1],
    ])
  })

  test('reports every line of a pair whose count grew', () => {
    const baseline = buildBaseline([finding('a.ts', 1)])
    const { violations } = compareToBaseline([finding('a.ts', 1), finding('a.ts', 7)], baseline)
    expect(violations.map((v) => [v.finding.line, v.allowed, v.actual])).toEqual([
      [1, 1, 2],
      [7, 1, 2],
    ])
  })

  test('lists stale entries without failing', () => {
    const baseline = buildBaseline([finding('a.ts', 1), finding('a.ts', 2), finding('gone.ts', 1)])
    const { violations, stale } = compareToBaseline([finding('a.ts', 1)], baseline)
    expect(violations).toEqual([])
    expect(stale).toEqual([
      { entry: { file: 'a.ts', rule: 'worker', count: 2 }, actual: 1 },
      { entry: { file: 'gone.ts', rule: 'worker', count: 1 }, actual: 0 },
    ])
  })
})

describe('run', () => {
  let root: string
  let baselinePath: string
  let out: string[]
  let err: string[]

  const write = (path: string, contents: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), contents)
  }
  const check = (update = false) =>
    run({
      root,
      baselinePath,
      update,
      log: (line) => out.push(line),
      error: (line) => err.push(line),
    })

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'acde-compat-'))
    baselinePath = join(root, 'scripts/acde-compat-baseline.json')
    mkdirSync(join(root, 'scripts'))
    out = []
    err = []
    write('packages/a/src/worker.ts', "export const w = new Worker('w.js')\n")
    write('apps/b/lib/hash.ts', "export const h = crypto.subtle.digest('SHA-256', d)\n")
    write('packages/a/src/worker.test.ts', "new Worker('ignored.js')\n")
    write('packages/a/node_modules/dep/index.js', "new Worker('ignored.js')\n")
    write('other/outside.ts', "new Worker('ignored.js')\n")
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('collects only scanned files under apps/ and packages/', () => {
    expect(collectFiles(root)).toEqual(['apps/b/lib/hash.ts', 'packages/a/src/worker.ts'])
  })

  test('--update rewrites the baseline from the current tree', () => {
    writeFileSync(baselinePath, '{"entries":[{"file":"old.ts","rule":"worker","count":9}]}')
    expect(check(true)).toBe(0)
    expect(readBaseline(baselinePath)).toEqual({
      entries: [
        { file: 'apps/b/lib/hash.ts', rule: 'crypto-subtle', count: 1 },
        { file: 'packages/a/src/worker.ts', rule: 'worker', count: 1 },
      ],
    })
    expect(readFileSync(baselinePath, 'utf8').endsWith('}\n')).toBe(true)
  })

  test('passes against its own baseline', () => {
    check(true)
    expect(check()).toBe(0)
    expect(err).toEqual([])
  })

  test('fails on a new use with file:line:rule: text', () => {
    check(true)
    write('packages/a/src/new.ts', "const a = 1\nconst w = new Worker('x')\n")
    expect(check()).toBe(1)
    expect(err.join('\n')).toContain(
      "packages/a/src/new.ts:2:worker: const w = new Worker('x') (baseline 0, now 1)",
    )
  })

  test('fails when a baselined count grows', () => {
    check(true)
    write('packages/a/src/worker.ts', "export const w = new Worker('w.js')\nnew Worker('x')\n")
    expect(check()).toBe(1)
    expect(err.join('\n')).toContain("packages/a/src/worker.ts:2:worker: new Worker('x')")
  })

  test('passes when the new use is marked guarded', () => {
    check(true)
    write('packages/a/src/new.ts', "// acde-compat: guarded\nconst w = new Worker('x')\n")
    expect(check()).toBe(0)
  })

  test('only notes stale entries', () => {
    check(true)
    rmSync(join(root, 'apps/b/lib/hash.ts'))
    expect(check()).toBe(0)
    expect(err).toEqual([])
    expect(out.join('\n')).toContain('apps/b/lib/hash.ts crypto-subtle (baseline 1, now 0)')
  })

  test('treats a missing baseline as empty', () => {
    expect(check()).toBe(1)
    expect(err.length).toBeGreaterThan(0)
  })
})
