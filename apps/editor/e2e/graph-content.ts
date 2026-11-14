/**
 * Scene graph comparison for the e2e suite. No `acde/test` import, so plain
 * `bun test` can run its unit test.
 */

export interface SceneGraphJson {
  nodes: Record<string, unknown>
  rootNodeIds: string[]
}

/**
 * Every difference between two graphs' roots and node contents, as
 * `path: left !== right` lines; empty when they hold the same scene. Key order
 * does not matter, array order does. `ignore` names node fields (top-level keys
 * of a node) that may legitimately differ.
 */
export function graphContentDiff(
  left: SceneGraphJson,
  right: SceneGraphJson,
  ignore: readonly string[] = [],
): string[] {
  const out: string[] = []
  diff(left.rootNodeIds, right.rootNodeIds, 'rootNodeIds', out)
  const ids = new Set([...Object.keys(left.nodes), ...Object.keys(right.nodes)])
  for (const id of [...ids].sort()) {
    diff(strip(left.nodes[id], ignore), strip(right.nodes[id], ignore), `nodes.${id}`, out)
  }
  return out
}

function strip(node: unknown, ignore: readonly string[]): unknown {
  if (!isRecord(node) || ignore.length === 0) return node
  return Object.fromEntries(Object.entries(node).filter(([key]) => !ignore.includes(key)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function show(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value)
}

function diff(left: unknown, right: unknown, path: string, out: string[]): void {
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      out.push(`${path}: ${show(left)} !== ${show(right)}`)
      return
    }
    for (const [index, item] of left.entries()) diff(item, right[index], `${path}[${index}]`, out)
    return
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of [...keys].sort()) diff(left[key], right[key], `${path}.${key}`, out)
    return
  }
  if (!Object.is(left, right)) out.push(`${path}: ${show(left)} !== ${show(right)}`)
}
