import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

test('viewer English formats in production without a provider or catalog registration', () => {
  // A fresh process excludes catalogs registered by other suites and Lingui's dev compiler.
  const registry = fileURLToPath(new URL('./index.ts', import.meta.url))
  const result = Bun.spawnSync(
    [
      'bun',
      '--eval',
      `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { createI18n, defaultI18n, usePascalI18n } from ${JSON.stringify(registry)}
        if (import.meta.env?.DEV) throw new Error('Development mode is enabled')
        const format = (i18n) => [
          i18n._({
            id: 'viewer.callout.state',
            message: '{state, select, open {Open} closed {Closed} on {On} other {Off}}',
            values: { state: 'closed' },
          }),
          i18n._({
            id: 'viewer.walkthrough.label',
            message: 'Walkthrough: {state}',
            values: { state: 'On' },
          }),
          i18n._({
            id: 'core.level.floorNumber',
            message: 'Floor {number}',
            values: { number: 2 },
          }),
          i18n._({
            id: 'node.shared.runHangerInspector.supportLabel',
            message: 'Hanger {number} support',
            values: { number: 3 },
          }),
          i18n._({ id: 'viewer.camera.topView', message: 'Top view' }),
        ]
        function ViewerMessages() {
          return createElement('button', null, format(usePascalI18n()).join(' / '))
        }
        console.log(renderToStaticMarkup(createElement(ViewerMessages)))
        console.log(JSON.stringify(format(createI18n({ locale: 'fr' }))))
        console.log(Object.hasOwn(defaultI18n.i18n.messages, 'viewer.camera.topView'))
      `,
    ],
    { env: { ...process.env, NODE_ENV: 'production' }, stdout: 'pipe', stderr: 'pipe' },
  )

  expect(result.exitCode).toBe(0)
  expect(result.stdout.toString().trim().split('\n')).toEqual([
    '<button>Closed / Walkthrough: On / Floor 2 / Hanger 3 support / Top view</button>',
    '["Closed","Walkthrough: On","Floor 2","Hanger 3 support","Top view"]',
    'false',
  ])
  expect(result.stderr.toString()).not.toContain('Uncompiled message')
})

test('production: messages no catalog has render from their source without Lingui warnings', () => {
  const registry = fileURLToPath(new URL('./index.ts', import.meta.url))
  const result = Bun.spawnSync(
    [
      'bun',
      '--eval',
      `
        import { createI18n } from ${JSON.stringify(registry)}
        const english = createI18n()
        const french = createI18n({ locale: 'fr' })
        const out = []
        for (const i18n of [english, french]) {
          out.push(
            // A plugin kind's label, wrapped by the editor (nodeLabel) under an id no catalog has.
            i18n._({ id: 'editor.node.road-network.label.0abc', message: 'Road' }),
            i18n._({ id: 'plugin.tool.hint', message: "Click to place, Esc when you're done" }),
            i18n._('plugin.string.id'),
            // Not plain: still compiled through Lingui's catalog path.
            i18n._({ id: 'plugin.counted', message: '{count} roads', values: { count: 2 } }),
          )
        }
        console.log(JSON.stringify(out))
      `,
    ],
    { env: { ...process.env, NODE_ENV: 'production' }, stdout: 'pipe', stderr: 'pipe' },
  )

  expect(result.exitCode).toBe(0)
  const [road, hint, id, counted] = JSON.parse(result.stdout.toString()) as string[]
  expect([road, hint, id]).toEqual([
    'Road',
    "Click to place, Esc when you're done",
    'plugin.string.id',
  ])
  expect(JSON.parse(result.stdout.toString()).slice(4, 7)).toEqual([road, hint, id])
  const stderr = result.stderr.toString()
  // Only the ICU message, which production cannot compile without a catalog entry, warns.
  expect(stderr.split('Uncompiled message').length - 1).toBe(2)
  expect(stderr).toContain('{count} roads')
  expect(stderr).not.toContain('> Road')
  expect(counted).toBe('{count} roads')
})
