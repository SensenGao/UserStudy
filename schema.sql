PRAGMA journal_mode=WAL;
PRAGMA synchronous=FULL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS participants(
  id TEXT PRIMARY KEY, nonce_hash TEXT UNIQUE NOT NULL, token_hash TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS cases(
  id TEXT PRIMARY KEY, reference_path TEXT NOT NULL, first_path TEXT NOT NULL, second_path TEXT NOT NULL,
  duration REAL NOT NULL, assignments INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS assignments(
  id TEXT PRIMARY KEY, participant_id TEXT NOT NULL REFERENCES participants(id), case_id TEXT NOT NULL REFERENCES cases(id),
  ordinal INTEGER NOT NULL, flip INTEGER NOT NULL CHECK(flip IN(0,1)),
  UNIQUE(participant_id,case_id), UNIQUE(participant_id,ordinal)
);
CREATE TABLE IF NOT EXISTS votes(
  assignment_id TEXT PRIMARY KEY REFERENCES assignments(id), choice TEXT NOT NULL CHECK(choice IN('A','B')),
  elapsed_ms INTEGER NOT NULL DEFAULT 0, media_profile TEXT NOT NULL DEFAULT 'original', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS participant_assignments ON assignments(participant_id,ordinal);
