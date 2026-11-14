import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { IconifyJSON } from '@iconify/react'
import {
  buildIconSubset,
  EXEMPT_ICONS,
  extractIconSubset,
  iconSetsFrom,
  iconSourceDirectories,
  scanIconNames,
  scanIconNamesIn,
} from './icons'

const known = new Set(['lucide', 'mdi', 'ph'])
const scan = (source: string, fileName = 'a.tsx') => scanIconNames(source, fileName, known)
const sorted = (names: Set<string>) => [...names].sort()

describe('scanIconNames', () => {
  test('finds the ways the app writes icon names', () => {
    const source = `
      const view = <>
        <Icon icon="ph:mouse-left-click-fill" />
        <Icon icon={'mdi:select-drag'} width={16} />
      </>
      const a = { icon: 'lucide:box', iconifyIcon: "lucide:bath" }
      const b = { kind: 'iconify', name: 'lucide:split' }
      const c = { kind: "iconify" as const, name: "lucide:expand" }
      const d = isFreehand ? 'lucide:scribble' : 'lucide:spline'
      const e = SPLIT.map((count) => [count, 'lucide:scissors'])
      // <Icon icon="lucide:in-a-comment" />
    `
    expect(sorted(scan(source).names)).toEqual([
      'lucide:bath',
      'lucide:box',
      'lucide:expand',
      'lucide:scissors',
      'lucide:scribble',
      'lucide:spline',
      'lucide:split',
      'mdi:select-drag',
      'ph:mouse-left-click-fill',
    ])
  })

  test('an icon position counts whatever the prefix, other literals only for a known set', () => {
    const source = `
      import fs from 'node:fs'
      const view = <Icon icon="newset:thing" />
      const plugin = { id: 'pascal:core', kind: 'webxr:panel' }
    `
    expect(sorted(scan(source).names)).toEqual(['newset:thing'])
  })

  // reviewer-T27: each of these slipped past the regular expressions with a set lacking data
  test.each([
    ['spaces around =', `const v = <Icon icon = "newset:thing" />`, ['newset:thing']],
    ['spaces inside braces', `const v = <Icon icon={ "newset:thing" } />`, ['newset:thing']],
    [
      'a conditional',
      `const v = <Icon icon={active ? 'newset:on' : 'newset:off'} />`,
      ['newset:off', 'newset:on'],
    ],
    [
      'a conditional in a property, with a fallback',
      `const v = { icon: (open ? 'newset:on' : undefined) ?? \`newset:off\` }`,
      ['newset:off', 'newset:on'],
    ],
    [
      'a ref name',
      `const v = { kind: 'iconify', name: on ? 'newset:on' : 'newset:off' }`,
      ['newset:off', 'newset:on'],
    ],
  ])('an icon position written with %s is found', async (_, source, names) => {
    expect(sorted(scan(source).names)).toEqual(names)
    // and with no data for the set, the build fails
    await expect(buildIconSubset(scan(source).names, async () => undefined)).rejects.toThrow(
      `no icon data for ${names.join(', ')}.`,
    )
  })

  test('icon positions that are not literals are reported where they surely name an Iconify icon', () => {
    const source = `
      import { Icon as IconifyIcon } from '@iconify/react'
      const a = <IconifyIcon icon={ref.name} />
      const b = <IconifyIcon icon={on ? 'lucide:box' : fallback} />
      const c = { iconifyIcon: meta.icon }
      const d = { kind: 'iconify', name: \`lucide:\${kind}\` }
      // an \`icon\` elsewhere is often a component, so it is not reported
      const e = <Button icon={BoxIcon} />
      const f = { icon: BoxIcon }
    `
    const { names, unresolved } = scan(source, 'src/a.tsx')
    expect(sorted(names)).toEqual(['lucide:box'])
    expect(unresolved).toEqual([
      'src/a.tsx:3 ref.name',
      "src/a.tsx:4 on ? 'lucide:box' : fallback",
      'src/a.tsx:5 meta.icon',
      `src/a.tsx:6 \`lucide:\${kind}\``,
    ])
  })
})

describe('scanning directories', () => {
  async function withTree(run: (root: string) => Promise<void>) {
    const root = await mkdtemp(path.join(tmpdir(), 'acde-icons-'))
    try {
      await run(root)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }

  test('skips tests and build output', () =>
    withTree(async (root) => {
      for (const directory of ['node_modules', '.next', '.acde/web']) {
        await mkdir(path.join(root, 'src', directory), { recursive: true })
      }
      await writeFile(path.join(root, 'src/a.tsx'), `const v = <Icon icon="lucide:box" />`)
      await writeFile(
        path.join(root, 'src/a.test.tsx'),
        `const v = <Icon icon="lucide:test-only" />`,
      )
      await writeFile(path.join(root, 'src/node_modules/x.ts'), `const v = { icon: 'lucide:dep' }`)
      await writeFile(path.join(root, 'src/.next/x.js'), `const v = { icon: 'lucide:built' }`)
      await writeFile(path.join(root, 'src/.acde/web/x.js'), `const v = { icon: 'lucide:built' }`)
      await writeFile(path.join(root, 'src/notes.md'), `icon="lucide:doc"`)
      const { names } = await scanIconNamesIn([path.join(root, 'src')], known, root)
      expect(sorted(names)).toEqual(['lucide:box'])
    }))

  test('a source directory that is missing fails instead of scanning as empty', () =>
    withTree(async (root) => {
      await expect(scanIconNamesIn([path.join(root, 'gone')], known)).rejects.toThrow(
        path.join(root, 'gone'),
      )
    }))

  test('the app, packages with a src, and every git plugin are scanned; a missing plugin fails', () =>
    withTree(async (root) => {
      await mkdir(path.join(root, 'apps/editor'), { recursive: true })
      await writeFile(
        path.join(root, 'apps/editor/package.json'),
        JSON.stringify({
          dependencies: { '@scope/plugin': 'github:someone/plugin#abc', react: '^19' },
        }),
      )
      await mkdir(path.join(root, 'packages/core/src'), { recursive: true })
      await mkdir(path.join(root, 'packages/config-only'), { recursive: true })
      const directories = await iconSourceDirectories(root)
      expect(directories).toEqual([
        path.join(root, 'apps/editor'),
        path.join(root, 'packages/core/src'),
        path.join(root, 'node_modules/@scope/plugin/src'),
      ])
      await expect(scanIconNamesIn(directories, known)).rejects.toThrow(
        path.join(root, 'node_modules/@scope/plugin/src'),
      )
    }))
})

const SET: IconifyJSON = {
  prefix: 'demo',
  width: 24,
  height: 24,
  icons: {
    box: { body: '<path d="box"/>' },
    circle: { body: '<circle/>' },
    unused: { body: '<path d="unused"/>' },
  },
  aliases: {
    ring: { parent: 'circle' },
    hoop: { parent: 'ring', rotate: 1 },
    dangling: { parent: 'gone' },
  },
}

describe('extractIconSubset', () => {
  test('keeps only the named icons and the set defaults', () => {
    expect(extractIconSubset(SET, ['box'])).toEqual({
      subset: { prefix: 'demo', width: 24, height: 24, icons: { box: SET.icons.box! } },
      missing: [],
    })
  })

  test('an alias brings its chain of parents', () => {
    const { subset, missing } = extractIconSubset(SET, ['hoop'])
    expect(missing).toEqual([])
    expect(Object.keys(subset.icons)).toEqual(['circle'])
    expect(subset.aliases).toEqual({
      ring: { parent: 'circle' },
      hoop: { parent: 'ring', rotate: 1 },
    })
  })

  test('reports names the set does not draw', () => {
    expect(extractIconSubset(SET, ['box', 'nope', 'dangling']).missing).toEqual([
      'dangling',
      'nope',
    ])
  })
})

describe('buildIconSubset', () => {
  const loadSet = async (prefix: string) => (prefix === 'demo' ? SET : undefined)

  test('one subset per set, exempt names left out', async () => {
    const exempt = Object.keys(EXEMPT_ICONS)
    const subsets = await buildIconSubset(['demo:box', 'demo:ring', ...exempt], loadSet)
    expect(subsets.map((set) => set.prefix)).toEqual(['demo'])
    expect(Object.keys(subsets[0]!.icons)).toEqual(['box', 'circle'])
  })

  test('fails listing every name without data, from a missing set or a missing icon', async () => {
    await expect(
      buildIconSubset(['demo:box', 'demo:nope', 'other:thing'], loadSet),
    ).rejects.toThrow('no icon data for demo:nope, other:thing.')
  })

  test('reads the installed @iconify-json sets', async () => {
    const appDirectory = path.resolve(import.meta.dirname, '../..')
    const lucide = await iconSetsFrom(appDirectory)('lucide')
    expect(lucide?.prefix).toBe('lucide')
    expect(await iconSetsFrom(appDirectory)('no-such-set')).toBeUndefined()
  })
})
