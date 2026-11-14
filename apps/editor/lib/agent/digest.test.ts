import { describe, expect, test } from 'bun:test'
import { digestScene, roomsOf } from './digest'

describe('digestScene', () => {
  const nodes = {
    building_1: { id: 'building_1', type: 'building', parentId: null },
    level_0: { id: 'level_0', type: 'level', parentId: 'building_1', name: 'Ground floor' },
    level_1: { id: 'level_1', type: 'level', parentId: 'building_1', level: 1 },
    zone_a: {
      id: 'zone_a',
      type: 'zone',
      parentId: 'level_0',
      name: '客厅',
      polygon: [
        [0, 0],
        [5, 0],
        [5, 4],
        [0, 4],
      ],
    },
    wall_a: { id: 'wall_a', type: 'wall', parentId: 'level_0' },
    wall_b: { id: 'wall_b', type: 'wall', parentId: 'level_0' },
    // An item hosted by a wall still stands on the wall's level.
    item_a: { id: 'item_a', type: 'item', parentId: 'wall_a' },
    orphan: { id: 'orphan', type: 'wall', parentId: 'missing' },
  }

  test('lists levels with what stands on them and rooms with their area', () => {
    const digest = digestScene(nodes)
    expect(digest.levels).toEqual([
      { id: 'level_0', name: 'Ground floor', rooms: 1, walls: 2, items: 1 },
      { id: 'level_1', name: 'Level 1', rooms: 0, walls: 0, items: 0 },
    ])
    expect(digest.rooms).toEqual([
      { id: 'zone_a', name: '客厅', level: 'Ground floor', levelId: 'level_0', areaSqMeters: 20 },
    ])
    expect(digest.counts).toMatchObject({ level: 2, wall: 3, zone: 1, item: 1 })
    expect(roomsOf(digest)).toEqual([{ name: '客厅', level: 'Ground floor', areaSqMeters: 20 }])
  })

  test('reads a room without an outline as having no area', () => {
    const digest = digestScene({
      level_0: { id: 'level_0', type: 'level' },
      zone_a: { id: 'zone_a', type: 'zone', parentId: 'level_0' },
    })
    expect(digest.rooms[0]).toMatchObject({ name: '', areaSqMeters: 0 })
  })
})
