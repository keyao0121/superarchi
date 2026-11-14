import { describe, expect, test } from 'bun:test'
import { graphContentDiff, type SceneGraphJson } from './graph-content'

function scene(wall: Record<string, unknown> = {}): SceneGraphJson {
  return {
    rootNodeIds: ['level_a'],
    nodes: {
      level_a: { object: 'node', id: 'level_a', type: 'level', children: ['wall_a'] },
      wall_a: {
        object: 'node',
        id: 'wall_a',
        type: 'wall',
        parentId: 'level_a',
        visible: true,
        metadata: {},
        children: [],
        start: [0, 0],
        end: [4, 0],
        height: 3,
        ...wall,
      },
    },
  }
}

describe('graphContentDiff', () => {
  test('same scene, keys in another order', () => {
    const reordered = scene()
    reordered.nodes.wall_a = Object.fromEntries(
      Object.entries(reordered.nodes.wall_a as object).reverse(),
    )
    expect(graphContentDiff(scene(), reordered)).toEqual([])
  })

  test('a changed wall height', () => {
    expect(graphContentDiff(scene(), scene({ height: 99 }))).toEqual([
      'nodes.wall_a.height: 3 !== 99',
    ])
  })

  test('a moved wall end', () => {
    expect(graphContentDiff(scene(), scene({ end: [400, 0] }))).toEqual([
      'nodes.wall_a.end[0]: 4 !== 400',
    ])
  })

  test('a changed parent, a dropped field and a missing node', () => {
    const changed = scene({ parentId: 'level_b' })
    delete (changed.nodes.wall_a as Record<string, unknown>).height
    delete changed.nodes.level_a
    expect(graphContentDiff(scene(), changed)).toEqual([
      'nodes.level_a: {"object":"node","id":"level_a","type":"level","children":["wall_a"]} !== undefined',
      'nodes.wall_a.height: 3 !== undefined',
      'nodes.wall_a.parentId: "level_a" !== "level_b"',
    ])
  })

  test('changed roots and child order', () => {
    const changed = scene()
    changed.rootNodeIds = ['wall_a']
    ;(changed.nodes.level_a as { children: string[] }).children = ['wall_a', 'wall_b']
    expect(graphContentDiff(scene(), changed)).toEqual([
      'rootNodeIds[0]: "level_a" !== "wall_a"',
      'nodes.level_a.children: ["wall_a"] !== ["wall_a","wall_b"]',
    ])
  })

  test('ignored fields only', () => {
    expect(graphContentDiff(scene(), scene({ metadata: { at: 1 } }), ['metadata'])).toEqual([])
    expect(
      graphContentDiff(scene(), scene({ metadata: { at: 1 }, height: 99 }), ['metadata']),
    ).toEqual(['nodes.wall_a.height: 3 !== 99'])
  })
})
