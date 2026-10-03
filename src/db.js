import Database from "better-sqlite3";

/**
 * Open the database and make sure the schema exists.
 *
 * Version history model: `notes` always holds the CURRENT version and its
 * number; `note_versions` holds every PREVIOUS version. Updating a note copies
 * the current content into note_versions, then overwrites the note and bumps
 * its version number — so nothing is ever lost, and restoring an old version is
 * just another update (history only ever grows).
 */
export function openDb(file = ":memory:") {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notes (
      id         INTEGER PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL DEFAULT '',
      version    INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- every notes query filters by owner, newest first
    CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, id DESC);

    CREATE TABLE IF NOT EXISTS note_versions (
      note_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      version    INTEGER NOT NULL,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (note_id, version)
    );
  `);
  return db;
}
