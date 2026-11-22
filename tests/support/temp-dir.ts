import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'

const created: string[] = []

export async function makeTempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'simple-rss-'))
  created.push(dir)
  return dir
}

afterEach(async () => {
  const dirs = created.splice(0, created.length)
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})
