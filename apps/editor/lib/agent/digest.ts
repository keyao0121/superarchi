import type { AgentRoom } from './types'

type SceneNode = {
  id: string
  type: string
  name?: string
  parentId?: string | null
  polygon?: unknown
  level?: number
}

export interface SceneDigest {
  levels: { id: string; name: string; rooms: number; walls: number; items: number }[]
  rooms: (AgentRoom & { id: string; levelId: string })[]
  counts: Record<string, number>
}

function polygonArea(polygon: unknown): number {
  if (!Array.isArray(polygon) || polygon.length < 3) return 0
  let sum = 0
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index] as [number, number]
    const b = polygon[(index + 1) % polygon.length] as [number, number]
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(sum) / 2
}

/** The level a node stands on: its nearest `level` ancestor. */
function levelOf(node: SceneNode, nodes: Record<string, SceneNode>): SceneNode | null {
  let current: SceneNode | undefined = node
  for (let depth = 0; current && depth < 32; depth++) {
    if (current.type === 'level') return current
    current = current.parentId ? nodes[current.parentId] : undefined
  }
  return null
}

/**
 * What the boss plans from and the panel's area table shows: levels, rooms
 * with their floor area, and how much of each kind the scene holds. Small on
 * purpose: employees read the detail they need through their tools.
 */
export function digestScene(nodes: Record<string, SceneNode>): SceneDigest {
  const levels = new Map<string, SceneDigest['levels'][number]>()
  const counts: Record<string, number> = {}
  const rooms: SceneDigest['rooms'] = []

  for (const node of Object.values(nodes)) {
    counts[node.type] = (counts[node.type] ?? 0) + 1
    if (node.type === 'level') {
      levels.set(node.id, {
        id: node.id,
        name: node.name ?? `Level ${node.level ?? 0}`,
        rooms: 0,
        walls: 0,
        items: 0,
      })
    }
  }

  for (const node of Object.values(nodes)) {
    if (node.type !== 'zone' && node.type !== 'wall' && node.type !== 'item') continue
    const level = levelOf(node, nodes)
    const entry = level ? levels.get(level.id) : undefined
    if (!(level && entry)) continue
    if (node.type === 'wall') entry.walls++
    else if (node.type === 'item') entry.items++
    else {
      entry.rooms++
      rooms.push({
        id: node.id,
        name: node.name ?? '',
        level: entry.name,
        levelId: level.id,
        areaSqMeters: Math.round(polygonArea(node.polygon) * 10) / 10,
      })
    }
  }

  return { levels: [...levels.values()], rooms, counts }
}

export function roomsOf(digest: SceneDigest): AgentRoom[] {
  return digest.rooms.map(({ name, level, areaSqMeters }) => ({ name, level, areaSqMeters }))
}
