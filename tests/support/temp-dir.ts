import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'

const created: string[] = []

/**
 * A real directory on disk for the duration of one test. Tests exercise the
 * production SQLite path rather than an in-memory database, so WAL files,
 * permissions, and durability behave the way they do in a container.
 */
export async function makeTempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'simple-rss-'))
  created.push(dir)
  return dir
}

afterEach(async () => {
  const dirs = created.splice(0, created.length)
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})
