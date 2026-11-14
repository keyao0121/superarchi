// The Iconify icons the app names in its source, as one local subset for acde, which
// cannot reach api.iconify.design. lib/acde/client-config.ts loads the file at runtime.
import { readdir, readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { IconifyJSON } from '@iconify/react'
import ts from '@typescript/typescript6'

/** Served at `ACDE_ICON_SUBSET_URL` (lib/acde/client-config.ts). */
export const ICON_SUBSET_PATH = 'iconify/icons.json'

/** Named in source but deliberately absent from the subset. */
export const EXEMPT_ICONS: Record<string, string> = {
  'fa6-solid:vr-cardboard': 'WebXR panel only; WebXR is off under acde',
  'lucide:barrier': 'not in the Lucide set, so the browser shows nothing either',
  'lucide:scribble': 'not in the Lucide set, so the browser shows nothing either',
  'lucide:steps': 'not in the Lucide set, so the browser shows nothing either',
  'vaadin:grid': 'no @iconify-json/vaadin yet, so the orthographic grid toggle is blank under acde',
}

const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/

/** What a source file names: icon names, and icon positions whose value is not a literal. */
export type IconScan = { names: Set<string>; unresolved: string[] }

/** The literals an icon position can evaluate to, and whether some branch is not a literal. */
function literalBranches(node: ts.Expression): { literals: string[]; resolved: boolean } {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { literals: [node.text], resolved: true }
  }
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return literalBranches(node.expression)
  }
  const both = (a: ts.Expression, b: ts.Expression) => {
    const [left, right] = [literalBranches(a), literalBranches(b)]
    return {
      literals: [...left.literals, ...right.literals],
      resolved: left.resolved && right.resolved,
    }
  }
  if (ts.isConditionalExpression(node)) return both(node.whenTrue, node.whenFalse)
  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind
    if (operator === ts.SyntaxKind.QuestionQuestionToken || operator === ts.SyntaxKind.BarBarToken)
      return both(node.left, node.right)
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) return literalBranches(node.right)
  }
  return { literals: [], resolved: false }
}

function propertyName(name: ts.PropertyName | ts.JsxAttributeName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  return undefined
}

function isIconifyRef(object: ts.ObjectLiteralExpression): boolean {
  return object.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      propertyName(property.name) === 'kind' &&
      literalBranches(property.initializer).literals.includes('iconify'),
  )
}

/** Local names `@iconify/react` components are imported under in this file. */
function iconifyComponents(file: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  for (const statement of file.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === '@iconify/react'
    ) {
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if ((element.propertyName ?? element.name).text === 'Icon') names.add(element.name.text)
        }
      }
    }
  }
  return names
}

function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (/\.m?js$/.test(fileName)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

/**
 * Iconify names in `source`, parsed as TypeScript.
 *
 * - In an icon position — the `icon` attribute or property, `iconifyIcon`, and the `name` of
 *   a `{ kind: 'iconify' }` ref — every literal the value can take counts, whatever its
 *   prefix, so a name from a set without data fails the build instead of shipping blank.
 * - A value there that is not a literal (a variable, a call, a template with substitutions)
 *   cannot be read statically. It is reported in `unresolved` where it is certainly an
 *   Iconify name: on `@iconify/react`'s `Icon`, in `iconifyIcon`, or in a ref's `name`. An
 *   `icon` elsewhere is often a React component and is not reported.
 * - Any other literal counts only when its prefix is in `knownPrefixes` (the installed
 *   sets) or it is exempt, which catches names kept in maps or variables without picking
 *   up ids such as `pascal:core` or `node:fs`.
 */
export function scanIconNames(
  source: string,
  fileName: string,
  knownPrefixes: ReadonlySet<string>,
): IconScan {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  )
  const components = iconifyComponents(file)
  const names = new Set<string>()
  const unresolved: string[] = []
  const iconPosition = (value: ts.Expression, mustResolve: boolean) => {
    const { literals, resolved } = literalBranches(value)
    for (const literal of literals) if (ICON_NAME.test(literal)) names.add(literal)
    if (!resolved && mustResolve) {
      const { line } = file.getLineAndCharacterOfPosition(value.getStart(file))
      unresolved.push(`${fileName}:${line + 1} ${value.getText(file)}`)
    }
  }
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && propertyName(node.name) === 'icon' && node.initializer) {
      const value = ts.isJsxExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer
      const element = node.parent.parent
      const tag = element.tagName.getText(file)
      if (value) iconPosition(value, components.has(tag))
    } else if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name)
      if (name === 'icon' || name === 'iconifyIcon') {
        iconPosition(node.initializer, name === 'iconifyIcon')
      } else if (
        name === 'name' &&
        ts.isObjectLiteralExpression(node.parent) &&
        isIconifyRef(node.parent)
      ) {
        iconPosition(node.initializer, true)
      }
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      ICON_NAME.test(node.text)
    ) {
      const prefix = node.text.slice(0, node.text.indexOf(':'))
      if (knownPrefixes.has(prefix) || node.text in EXEMPT_ICONS) names.add(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return { names, unresolved }
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])
// Build output, dependencies and tests; directories starting with a dot (`.next`, `.acde`)
// are build output too.
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'public',
  'tests',
  'test',
  '__tests__',
])

function isSourceFile(name: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(name)) && !/\.(test|spec)\.[^.]+$/.test(name)
}

/** Every source file under `directory`. A directory that cannot be read is an error. */
async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.'))
        files.push(...(await listSourceFiles(full)))
    } else if (isSourceFile(entry.name)) {
      files.push(full)
    }
  }
  return files
}

/**
 * Where icon names are written: the app, each workspace package that has a `src` (the
 * config-only packages have none), and the plugins the app installs from git, whose
 * source ships in node_modules. The app and the plugins are required: a missing one fails
 * the scan rather than looking like a source without icons.
 */
export async function iconSourceDirectories(repositoryRoot: string): Promise<string[]> {
  const appDirectory = path.join(repositoryRoot, 'apps/editor')
  const manifest = JSON.parse(await readFile(path.join(appDirectory, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const plugins = Object.entries(manifest.dependencies ?? {})
    .filter(([, spec]) => spec.startsWith('github:'))
    .map(([name]) => path.join(repositoryRoot, 'node_modules', name, 'src'))
  const packages: string[] = []
  for (const name of (await readdir(path.join(repositoryRoot, 'packages'))).sort()) {
    const source = path.join(repositoryRoot, 'packages', name, 'src')
    const found = await stat(source).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (found) packages.push(source)
  }
  return [appDirectory, ...packages, ...plugins]
}

export async function scanIconNamesIn(
  directories: string[],
  knownPrefixes: ReadonlySet<string>,
  relativeTo = process.cwd(),
): Promise<IconScan> {
  const names = new Set<string>()
  const unresolved: string[] = []
  for (const directory of directories) {
    for (const file of await listSourceFiles(directory)) {
      const scan = scanIconNames(
        await readFile(file, 'utf8'),
        path.relative(relativeTo, file),
        knownPrefixes,
      )
      for (const name of scan.names) names.add(name)
      unresolved.push(...scan.unresolved)
    }
  }
  return { names, unresolved }
}

const ICON_SET_DEFAULTS = ['width', 'height', 'left', 'top'] as const

/**
 * The part of `set` that draws `names`, keeping each alias's chain of parents. Returns the
 * names the set does not have in `missing`.
 */
export function extractIconSubset(
  set: IconifyJSON,
  names: Iterable<string>,
): { subset: IconifyJSON; missing: string[] } {
  const subset: IconifyJSON = { prefix: set.prefix, icons: {} }
  for (const key of ICON_SET_DEFAULTS) {
    if (set[key] !== undefined) Object.assign(subset, { [key]: set[key] })
  }
  const missing: string[] = []
  const add = (name: string): boolean => {
    const icon = set.icons[name]
    if (icon) {
      subset.icons[name] = icon
      return true
    }
    const alias = set.aliases?.[name]
    if (!alias || !add(alias.parent)) return false
    subset.aliases = { ...subset.aliases, [name]: alias }
    return true
  }
  for (const name of [...names].sort()) if (!add(name)) missing.push(name)
  return { subset, missing }
}

export type IconSetLoader = (prefix: string) => Promise<IconifyJSON | undefined>

/** Reads `@iconify-json/<prefix>`, resolved from apps/editor, which owns those devDependencies. */
export function iconSetsFrom(appDirectory: string): IconSetLoader {
  const fromApp = createRequire(path.join(appDirectory, 'package.json'))
  return async (prefix) => {
    let file: string
    try {
      file = fromApp.resolve(`@iconify-json/${prefix}/icons.json`)
    } catch {
      return undefined
    }
    return JSON.parse(await readFile(file, 'utf8')) as IconifyJSON
  }
}

/** The installed `@iconify-json/*` sets, i.e. the prefixes the app has data for. */
export async function installedIconPrefixes(repositoryRoot: string): Promise<Set<string>> {
  return new Set(await readdir(path.join(repositoryRoot, 'node_modules/@iconify-json')))
}

/**
 * One subset per icon set for every name in `names` except the exempt ones. Throws listing
 * every name without data, so a new icon cannot ship blank under acde unnoticed.
 */
export async function buildIconSubset(
  names: Iterable<string>,
  loadSet: IconSetLoader,
): Promise<IconifyJSON[]> {
  const byPrefix = new Map<string, string[]>()
  for (const name of names) {
    if (name in EXEMPT_ICONS) continue
    const separator = name.indexOf(':')
    const prefix = name.slice(0, separator)
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), name.slice(separator + 1)])
  }
  const subsets: IconifyJSON[] = []
  const missing: string[] = []
  for (const prefix of [...byPrefix.keys()].sort()) {
    const iconNames = byPrefix.get(prefix) as string[]
    const set = await loadSet(prefix)
    if (!set) {
      missing.push(...iconNames.map((name) => `${prefix}:${name}`))
      continue
    }
    const { subset, missing: absent } = extractIconSubset(set, iconNames)
    missing.push(...absent.map((name) => `${prefix}:${name}`))
    subsets.push(subset)
  }
  if (missing.length) {
    throw new Error(
      `no icon data for ${missing.sort().join(', ')}. Add the @iconify-json set to apps/editor devDependencies, or exempt the name in scripts/acde/icons.ts`,
    )
  }
  return subsets
}
