import { readFileSync, readdirSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SERVER = fileURLToPath(new URL('../../src/server/', import.meta.url))

const SPECIFIER = /(?:\bfrom|^import)\s+['"]([^'"]+)['"]/gm

function folderOf(path: string): string | undefined {
  const segments = relative(SERVER, path).split(sep)
  const [folder] = segments
  if (!folder || folder === '..' || segments.length < 2) return undefined
  return folder
}

function folderGraph(): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>()

  for (const entry of readdirSync(SERVER, { recursive: true, encoding: 'utf8' })) {
    if (!entry.endsWith('.ts')) continue
    const file = resolve(SERVER, entry)
    const from = folderOf(file)
    if (!from) continue

    const imports = graph.get(from) ?? new Set<string>()
    graph.set(from, imports)

    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
      if (!specifier?.startsWith('.')) continue
      const to = folderOf(resolve(dirname(file), specifier))
      if (to && to !== from) imports.add(to)
    }
  }

  return graph
}

function cycleIn(graph: Map<string, Set<string>>): string[] | undefined {
  const settled = new Set<string>()
  const path: string[] = []

  function walk(folder: string): string[] | undefined {
    const opened = path.indexOf(folder)
    if (opened >= 0) return [...path.slice(opened), folder]
    if (settled.has(folder)) return undefined

    path.push(folder)
    for (const next of [...(graph.get(folder) ?? [])].sort()) {
      const cycle = walk(next)
      if (cycle) return cycle
    }
    path.pop()
    settled.add(folder)
    return undefined
  }

  for (const folder of [...graph.keys()].sort()) {
    const cycle = walk(folder)
    if (cycle) return cycle
  }
  return undefined
}

const graph = folderGraph()

describe('the src/server/ folder graph', () => {
  it('is read off the real tree', () => {
    expect([...(graph.get('subscriptions') ?? [])].sort()).toEqual(['digest', 'ingestion', 'persistence', 'upstream'])
  })

  it('is acyclic, so every folder can be read in one direction', () => {
    expect(cycleIn(graph)?.join(' → ')).toBeUndefined()
  })

  it('keeps upstream/ a leaf, so the outbound boundary answers to no domain folder (ADR 0005)', () => {
    expect([...(graph.get('upstream') ?? [])]).toEqual([])
  })
})
