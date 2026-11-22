import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'

const baselinePath = 'tools/comments/baseline.json'

const scriptExtensions = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/u
const cssExtension = /\.css$/u

const outOfScope = [
  /^tools\/oxlint\/anti-slop\//u,
  /^tests\/fixtures\//u,
  /^docs\//u,
  /^biome\.jsonc$/u,
  /^oxlint\.config\.mjs$/u,
]

const exemptions = [
  { kind: 'safety', pattern: /^\s*SAFETY\s*:/u },
  { kind: 'suppression', pattern: /^\s*biome-ignore\b/u },
  { kind: 'directive', pattern: /^\s*(@ts-expect-error|\/\s*<reference\b)/u },
] as const

type Exemption = (typeof exemptions)[number]['kind']

type Comment = {
  file: string
  line: number
  endLine: number
  text: string
  ownLine: boolean
  exempt: Exemption | null
}

type Range = { start: number; end: number }

function scriptRanges(source: string, file: string): Range[] {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, kind)
  const ranges = new Map<number, Range>()
  const visit = (node: ts.Node) => {
    const children = node.getChildren(tree)
    if (children.length > 0) return children.forEach(visit)
    if (node.kind === ts.SyntaxKind.JsxText) return
    const leading = ts.getLeadingCommentRanges(source, node.pos) ?? []
    const trailing = ts.getTrailingCommentRanges(source, node.end) ?? []
    for (const range of [...leading, ...trailing]) {
      ranges.set(range.pos, { start: range.pos, end: range.end })
    }
  }
  visit(tree)
  return [...ranges.values()].sort((a, b) => a.start - b.start)
}

function cssRanges(source: string): Range[] {
  const ranges: Range[] = []
  let quote: string | null = null
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (quote) {
      if (character === '\\') index++
      else if (character === quote) quote = null
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (source.startsWith('/*', index)) {
      const close = source.indexOf('*/', index + 2)
      const end = close === -1 ? source.length : close + 2
      ranges.push({ start: index, end })
      index = end - 1
    }
  }
  return ranges
}

function body(text: string): string {
  return text.startsWith('//') ? text.slice(2) : text.slice(2, -2).replace(/^\s*\*/gmu, '')
}

function commentsIn(file: string): Comment[] {
  const source = readFileSync(file, 'utf8')
  const ranges = cssExtension.test(file) ? cssRanges(source) : scriptRanges(source, file)
  const lineOf = (position: number) => source.slice(0, position).split('\n').length
  const comments: Comment[] = []
  for (const { start, end } of ranges) {
    const text = source.slice(start, end)
    const line = lineOf(start)
    const endLine = lineOf(end - 1)
    const ownLine = source.slice(source.lastIndexOf('\n', start - 1) + 1, start).trim() === ''
    const previous = comments.at(-1)
    if (previous && ownLine && previous.ownLine && text.startsWith('//') && previous.text.startsWith('//')) {
      if (previous.endLine === line - 1) {
        previous.endLine = line
        previous.text += `\n${text}`
        continue
      }
    }
    const exempt = exemptions.find(({ pattern }) => pattern.test(body(text)))?.kind ?? null
    comments.push({ file, line, endLine, text, ownLine, exempt })
  }
  return comments
}

function filesInScope(): string[] {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  return listed
    .split('\n')
    .filter((file) => scriptExtensions.test(file) || cssExtension.test(file))
    .filter((file) => !outOfScope.some((pattern) => pattern.test(file)))
    .filter((file) => {
      try {
        readFileSync(file)
        return true
      } catch {
        return false
      }
    })
    .sort()
}

function countLines(comments: readonly Comment[]): number {
  return comments.reduce((total, comment) => total + comment.endLine - comment.line + 1, 0)
}

function census(): Map<string, Comment[]> {
  const byFile = new Map<string, Comment[]>()
  for (const file of filesInScope()) {
    const banned = commentsIn(file).filter((comment) => comment.exempt === null)
    if (banned.length > 0) byFile.set(file, banned)
  }
  return byFile
}

function counts(byFile: Map<string, Comment[]>): Record<string, number> {
  return Object.fromEntries([...byFile].map(([file, comments]) => [file, countLines(comments)]))
}

function readBaseline(): Record<string, number> | null {
  if (!existsSync(baselinePath)) return null
  const parsed: Record<string, number> = JSON.parse(readFileSync(baselinePath, 'utf8'))
  return parsed
}

function writeBaseline(next: Record<string, number>) {
  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`)
}

function compare(baseline: Record<string, number>, current: Record<string, number>) {
  const files = new Set([...Object.keys(baseline), ...Object.keys(current)])
  const grown: string[] = []
  const shrunk: string[] = []
  for (const file of [...files].sort()) {
    const allowed = baseline[file] ?? 0
    const actual = current[file] ?? 0
    if (actual > allowed) grown.push(`${file}: ${actual} comment lines, baseline allows ${allowed}`)
    if (actual < allowed) shrunk.push(`${file}: ${actual} comment lines, baseline says ${allowed}`)
  }
  return { grown, shrunk }
}

function check(): number {
  const { grown, shrunk } = compare(readBaseline() ?? {}, counts(census()))
  for (const line of grown) console.error(`comment added  ${line}`)
  for (const line of shrunk) console.error(`comment removed  ${line}`)
  if (grown.length > 0) {
    console.error(
      '\nComments are banned. Say it in a name, a type, or a test; put a decision in docs/adr/.\n' +
        'Exempt: `// SAFETY:` before an `as`, `biome-ignore <reason>`, `@ts-expect-error`.',
    )
  }
  if (shrunk.length > 0) console.error('\nLock in the deletions: pnpm comments:lock')
  return grown.length + shrunk.length > 0 ? 1 : 0
}

function lock(): number {
  const current = counts(census())
  const baseline = readBaseline()
  const { grown } = baseline ? compare(baseline, current) : { grown: [] }
  if (grown.length > 0) {
    for (const line of grown) console.error(`refusing to raise  ${line}`)
    return 1
  }
  writeBaseline(current)
  return 0
}

function list(): number {
  const paths = process.argv.slice(3)
  const byFile = new Map(
    [...census()].filter(([file]) => paths.length === 0 || paths.some((path) => file.startsWith(path))),
  )
  for (const [file, comments] of byFile) {
    for (const comment of comments) {
      console.log(`${file}:${comment.line}-${comment.endLine}${comment.ownLine ? '' : ' (trailing)'}`)
      console.log(comment.text.replace(/^/gmu, '  '))
    }
  }
  const all = [...byFile.values()].flat()
  const ownLines = countLines(all.filter((comment) => comment.ownLine))
  console.log(
    `\n${all.length} comments, ${countLines(all)} comment lines in ${byFile.size} files; ` +
      `deleting them all removes ${ownLines} lines`,
  )
  return 0
}

const commands = { check, lock, list }
const command = process.argv[2]
if (command !== 'check' && command !== 'lock' && command !== 'list') {
  console.error('usage: comments check | lock | list [path...]')
  process.exit(2)
}
process.exit(commands[command]())
