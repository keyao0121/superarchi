import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// Web APIs the acde page runtime does not support (acde docs, "Web compatibility" →
// "Not yet supported"). Existing uses are recorded in a baseline so that upstream merges
// cannot introduce new ones unnoticed; a use that only runs outside acde is marked
// `acde-compat: guarded` in a comment on its line, or in a line of only comments directly above.

export const ruleIds = [
  'worker',
  'offscreen-canvas',
  'create-image-bitmap',
  'crypto-subtle',
  'webgl-context',
  'request-fullscreen',
  'request-pointer-lock',
  'service-worker',
  'remote-esm-import',
] as const
export type RuleId = (typeof ruleIds)[number]

export type Finding = { file: string; line: number; rule: RuleId; text: string }
export type BaselineEntry = { file: string; rule: RuleId; count: number }
export type Baseline = { entries: BaselineEntry[] }

const guardMarker = 'acde-compat: guarded'
const scannedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])
const skippedDirectories = new Set(['node_modules', '.next', 'dist', 'build', '.acde', 'scripts'])
const testFile = /\.(?:test|e2e)\./
const remoteSpecifier = /^(?:https?:)?\/\//i
const webglContext = /^(?:webgl2?|experimental-webgl)$/
const fullscreenMethod = /^(?:webkit|moz|ms)?[Rr]equestFullscreen$/
const pointerLockMethod = /^(?:webkit|moz)?[Rr]equestPointerLock$/

function scriptKind(path: string) {
  switch (extname(path)) {
    case '.tsx':
      return ts.ScriptKind.TSX
    case '.jsx':
      return ts.ScriptKind.JSX
    case '.js':
    case '.mjs':
      return ts.ScriptKind.JS
    default:
      return ts.ScriptKind.TS
  }
}

function stringValue(node: ts.Node | undefined) {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)))
    return node.text
}

function memberName(node: ts.Node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node)) return stringValue(node.argumentExpression)
}

function endsWithName(node: ts.Expression, name: RegExp) {
  const target = ts.isIdentifier(node) ? node.text : memberName(node)
  return target !== undefined && name.test(target)
}

const globalObject = /^(?:window|globalThis|self)$/

// `OffscreenCanvas`, `window.OffscreenCanvas`, `globalThis['OffscreenCanvas']`…, but not
// `options.OffscreenCanvas` or a property named so in an object literal.
function isGlobalReference(node: ts.Node, name: string) {
  if (ts.isIdentifier(node) && node.text === name) {
    const parent = node.parent
    const isMemberName =
      (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
      (ts.isPropertyAssignment(parent) && parent.name === node)
    return !isMemberName && !isTypePosition(node)
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
    return (
      memberName(node) === name &&
      ts.isIdentifier(node.expression) &&
      globalObject.test(node.expression.text)
    )
  return false
}

function isTypePosition(node: ts.Node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isTypeNode(current) || ts.isHeritageClause(current)) return true
    if (ts.isExpression(current) || ts.isStatement(current)) return false
  }
  return false
}

function ruleFor(node: ts.Node): RuleId | undefined {
  if (ts.isNewExpression(node) && endsWithName(node.expression, /^(?:Shared)?Worker$/))
    return 'worker'

  if (isGlobalReference(node, 'OffscreenCanvas')) return 'offscreen-canvas'

  if (ts.isCallExpression(node) && endsWithName(node.expression, /^createImageBitmap$/))
    return 'create-image-bitmap'

  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const name = memberName(node)
    if (name === 'subtle' && endsWithName(node.expression, /crypto$/i)) return 'crypto-subtle'
    if (name === 'serviceWorker' && endsWithName(node.expression, /^navigator$/))
      return 'service-worker'
    if (name && fullscreenMethod.test(name)) return 'request-fullscreen'
    if (name && pointerLockMethod.test(name)) return 'request-pointer-lock'
  }

  if (ts.isCallExpression(node)) {
    if (
      endsWithName(node.expression, /^getContext$/) &&
      webglContext.test(stringValue(node.arguments[0]) ?? '')
    )
      return 'webgl-context'
    if (
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      remoteSpecifier.test(stringValue(node.arguments[0]) ?? '')
    )
      return 'remote-esm-import'
  }

  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    remoteSpecifier.test(stringValue(node.moduleSpecifier) ?? '')
  )
    return 'remote-esm-import'
}

const isJSDocNode = (node: ts.Node) =>
  node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode

// Lines (0-based, in `source`) where a comment holds the marker, and lines any code token
// touches. A marker covers its own line; it covers the line below only when its line holds
// nothing but comments, so `/* marker */ code` or `code // marker` never reach the next line.
function guardLines(source: ts.SourceFile) {
  const text = source.text
  const lineOf = (position: number) => source.getLineAndCharacterOfPosition(position).line
  const comments = new Map<number, number>()
  const code = new Set<number>()
  const visit = (node: ts.Node): void => {
    if (isJSDocNode(node)) return
    const children = node.getChildren(source)
    if (children.length) {
      for (const child of children) visit(child)
      return
    }
    for (const range of [
      ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
      ...(ts.getTrailingCommentRanges(text, node.end) ?? []),
    ])
      comments.set(range.pos, range.end)
    const blankJsxText = ts.isJsxText(node) && node.containsOnlyTriviaWhiteSpaces
    if (node.kind === ts.SyntaxKind.EndOfFileToken || blankJsxText) return
    const last = lineOf(Math.max(node.getStart(source), node.end - 1))
    for (let line = lineOf(node.getStart(source)); line <= last; line++) code.add(line)
  }
  visit(source)
  const marked = new Set<number>()
  for (const [pos, end] of comments) {
    const comment = text.slice(pos, end)
    for (let at = comment.indexOf(guardMarker); at >= 0; at = comment.indexOf(guardMarker, at + 1))
      marked.add(lineOf(pos + at))
  }
  return (line: number) => marked.has(line) || (marked.has(line - 1) && !code.has(line - 1))
}

const inlineScript = /<script\b[^>]*>([\s\S]*?)<\/script>/gi

function isStringish(node: ts.Node) {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  )
}

// `text` is a slice of the file starting at `firstLine` (0-based), so positions map back
// to file lines. String literals holding an HTML `<script>` (e.g. a sandboxed iframe's
// srcdoc) run as page code too, so their script bodies are scanned as JavaScript.
function scanText(
  file: string,
  text: string,
  kind: ts.ScriptKind,
  firstLine: number,
  lines: string[],
  findings: Finding[],
) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const lineOf = (position: number) =>
    firstLine + source.getLineAndCharacterOfPosition(position).line
  let isGuarded: ((line: number) => boolean) | undefined
  const visit = (node: ts.Node): void => {
    const rule = ruleFor(node)
    if (rule) {
      const line = lineOf(node.getStart(source))
      isGuarded ??= guardLines(source)
      if (!isGuarded(line - firstLine))
        findings.push({ file, line: line + 1, rule, text: lines[line]?.trim() ?? '' })
    }
    if (isStringish(node)) {
      const start = node.getStart(source)
      for (const match of node.getText(source).matchAll(inlineScript)) {
        const body = match[1] ?? ''
        const bodyStart = start + (match.index ?? 0) + match[0].indexOf('>') + 1
        scanText(file, body, ts.ScriptKind.JS, lineOf(bodyStart), lines, findings)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

export function scanSource(file: string, contents: string): Finding[] {
  const findings: Finding[] = []
  scanText(file, contents, scriptKind(file), 0, contents.split(/\r?\n/), findings)
  return findings
}

export function shouldScan(relativePath: string) {
  const parts = relativePath.split(/[\\/]/)
  const name = parts.at(-1) ?? ''
  if (parts.slice(0, -1).some((part) => skippedDirectories.has(part))) return false
  return scannedExtensions.has(extname(name)) && !name.endsWith('.d.ts') && !testFile.test(name)
}

// Builds and tests running on the same tree delete files mid-scan; a path that is gone
// has nothing left to report.
function unlessGone<T>(read: () => T): T | undefined {
  try {
    return read()
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return undefined
    throw error
  }
}

export function collectFiles(root: string, scanRoots = ['apps', 'packages']) {
  const files: string[] = []
  const walk = (directory: string) => {
    const entries = unlessGone(() => readdirSync(directory, { withFileTypes: true })) ?? []
    for (const entry of entries) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name)) walk(path)
      } else if (entry.isFile()) {
        const relativePath = relative(root, path).replaceAll('\\', '/')
        if (shouldScan(relativePath)) files.push(relativePath)
      }
    }
  }
  for (const scanRoot of scanRoots) walk(resolve(root, scanRoot))
  return files.sort()
}

const key = (file: string, rule: string) => `${file}\0${rule}`

export function buildBaseline(findings: Finding[]): Baseline {
  const counts = new Map<string, BaselineEntry>()
  for (const { file, rule } of findings) {
    const entry = counts.get(key(file, rule)) ?? { file, rule, count: 0 }
    entry.count++
    counts.set(key(file, rule), entry)
  }
  return {
    entries: [...counts.values()].sort(
      (a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule),
    ),
  }
}

export type Comparison = {
  // Every finding of a (file, rule) pair that is new or whose count grew, so the reviewer
  // sees all candidate lines rather than a guess at which one is new.
  violations: { finding: Finding; allowed: number; actual: number }[]
  stale: { entry: BaselineEntry; actual: number }[]
}

export function compareToBaseline(findings: Finding[], baseline: Baseline): Comparison {
  const current = buildBaseline(findings).entries
  const allowed = new Map(baseline.entries.map((entry) => [key(entry.file, entry.rule), entry]))
  const actual = new Map(current.map((entry) => [key(entry.file, entry.rule), entry.count]))
  const violations: Comparison['violations'] = []
  for (const finding of findings) {
    const pairKey = key(finding.file, finding.rule)
    const allowedCount = allowed.get(pairKey)?.count ?? 0
    const actualCount = actual.get(pairKey) ?? 0
    if (actualCount > allowedCount)
      violations.push({ finding, allowed: allowedCount, actual: actualCount })
  }
  const stale = baseline.entries
    .map((entry) => ({ entry, actual: actual.get(key(entry.file, entry.rule)) ?? 0 }))
    .filter(({ entry, actual }) => actual < entry.count)
  return { violations, stale }
}

export function scanRepository(root: string, files = collectFiles(root)) {
  return files.flatMap((file) => {
    const contents = unlessGone(() => readFileSync(resolve(root, file), 'utf8'))
    return contents === undefined ? [] : scanSource(file, contents)
  })
}

export function readBaseline(path: string): Baseline {
  if (!existsSync(path)) return { entries: [] }
  return JSON.parse(readFileSync(path, 'utf8')) as Baseline
}

export function writeBaseline(path: string, baseline: Baseline) {
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`)
}

export function run(options: {
  root: string
  baselinePath: string
  update: boolean
  log?: (line: string) => void
  error?: (line: string) => void
}) {
  const log = options.log ?? console.log
  const error = options.error ?? console.error
  const findings = scanRepository(options.root)

  if (options.update) {
    const baseline = buildBaseline(findings)
    writeBaseline(options.baselinePath, baseline)
    log(
      `acde-compat: wrote ${baseline.entries.length} baseline entries (${findings.length} uses) to ${relative(options.root, options.baselinePath)}`,
    )
    return 0
  }

  const { violations, stale } = compareToBaseline(findings, readBaseline(options.baselinePath))
  for (const { entry, actual } of stale)
    log(
      `acde-compat: baseline entry can be lowered or removed: ${entry.file} ${entry.rule} (baseline ${entry.count}, now ${actual})`,
    )
  if (violations.length) {
    error('acde-compat: Web APIs unsupported in acde found outside the baseline:')
    for (const { finding, allowed, actual } of violations)
      error(
        `${finding.file}:${finding.line}:${finding.rule}: ${finding.text} (baseline ${allowed}, now ${actual})`,
      )
    error(
      `Make the use run only outside acde and mark it with \`// ${guardMarker}\`, or, if it is accepted as-is, run \`bun scripts/check-acde-compat.ts --update\`.`,
    )
    return 1
  }
  log(`acde-compat: ok (${findings.length} baseline uses)`)
  return 0
}

if (import.meta.main) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  process.exitCode = run({
    root,
    baselinePath: resolve(root, 'scripts/acde-compat-baseline.json'),
    update: process.argv.includes('--update'),
  })
}
