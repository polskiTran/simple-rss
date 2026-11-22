import { join } from 'node:path'
import { expect, it } from 'vitest'
import { openDatabase } from '../../../src/server/persistence/database.js'
import { applyMigrations } from '../../../src/server/persistence/migrations.js'
import { SEARCHED_COLUMNS } from '../../../src/server/search/search-schema.js'
import { makeTempDataDir } from '../../support/temp-dir.js'

it('names the searched columns in the order the migrated index declares them', async () => {
  const db = openDatabase(join(await makeTempDataDir(), 'simple-rss.db'))
  applyMigrations(db)

  const declared = db.$client.pragma('table_info(feed_item_search)') as Array<{ name: string }>

  expect(declared.map((column) => column.name)).toEqual([...SEARCHED_COLUMNS])
  db.$client.close()
})
