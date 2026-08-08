import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * Typed mirror of the tables the server queries. Migrations remain the source
 * of truth for what runs against an Owner's volume; a table earns a definition
 * here once something reads or writes it through Drizzle.
 *
 * Drift between the two is caught by the persistence tests, which build the
 * database from migrations and then round-trip through these definitions.
 */
export const installationSettings = sqliteTable(
  'installation_settings',
  {
    id: integer('id').primaryKey(),
    timezone: text('timezone').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [check('installation_settings_singleton', sql`${table.id} = 1`)],
)

/** The Owner's Argon2id verifier. Its existence is what "claimed" means. */
export const ownerAuth = sqliteTable(
  'owner_auth',
  {
    id: integer('id').primaryKey(),
    passwordHash: text('password_hash').notNull(),
    claimedAt: text('claimed_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [check('owner_auth_singleton', sql`${table.id} = 1`)],
)

/** One signed-in device, keyed by the hash of the token it presents. */
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  createdAt: text('created_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  expiresAt: text('expires_at').notNull(),
})
