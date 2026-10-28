import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { env } from './env.ts'

/**
 * Local metadata store. Contains no PII by construction — see the schema comments in
 * migrations/001_init.sql and DESIGN.md §5.2.
 */

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations')

let db: DatabaseSync | undefined

export function getDb(): DatabaseSync {
  if (db) return db

  mkdirSync(env.dataDir, { recursive: true })
  const file = join(env.dataDir, 'rpde.sqlite')
  const opened = new DatabaseSync(file)

  opened.exec('PRAGMA journal_mode = WAL')
  opened.exec('PRAGMA foreign_keys = ON')
  // Belt and braces: a core dump or a stray copy of this file must not be useful.
  opened.exec('PRAGMA secure_delete = ON')

  migrate(opened)
  db = opened
  return db
}

function migrate(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)

  const applied = new Set(
    database
      .prepare('SELECT name FROM schema_migrations')
      .all()
      .map((row) => String((row as { name: string }).name)),
  )

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    database.exec('BEGIN')
    try {
      database.exec(sql)
      database
        .prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)')
        .run(file, new Date().toISOString())
      database.exec('COMMIT')
      console.log(`[db] applied migration ${file}`)
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
}

export function closeDb(): void {
  db?.close()
  db = undefined
}
