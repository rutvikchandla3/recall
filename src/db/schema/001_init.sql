CREATE TABLE IF NOT EXISTS index_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  path TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  native_id TEXT NOT NULL,
  surface TEXT NOT NULL,
  cwd TEXT NOT NULL,
  repo TEXT,
  branch TEXT,
  title TEXT NOT NULL,
  title_source TEXT NOT NULL,
  first_prompt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  message_count INTEGER NOT NULL,
  models_json TEXT NOT NULL,
  is_subagent INTEGER NOT NULL DEFAULT 0,
  transcript_paths_json TEXT NOT NULL,
  resume_cmd TEXT NOT NULL,
  fork_cmd TEXT,
  bytes INTEGER NOT NULL,
  raw_body_sha256 TEXT NOT NULL,
  normalize_version TEXT NOT NULL,
  chunk_version TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_docs (
  session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  first_prompt TEXT NOT NULL,
  body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_sources (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  path TEXT NOT NULL REFERENCES sources(path) ON DELETE CASCADE,
  PRIMARY KEY (session_id, path)
);

CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(
  title,
  first_prompt,
  body,
  content='session_docs',
  content_rowid='session_id',
  tokenize='porter unicode61 remove_diacritics 2',
  prefix='2 3 4'
);

CREATE TABLE IF NOT EXISTS parse_errors (
  path TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  error TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS session_docs_ai AFTER INSERT ON session_docs BEGIN
  INSERT INTO session_fts(rowid, title, first_prompt, body)
  VALUES (new.session_id, new.title, new.first_prompt, new.body);
END;

CREATE TRIGGER IF NOT EXISTS session_docs_ad AFTER DELETE ON session_docs BEGIN
  INSERT INTO session_fts(session_fts, rowid, title, first_prompt, body)
  VALUES('delete', old.session_id, old.title, old.first_prompt, old.body);
END;

CREATE TRIGGER IF NOT EXISTS session_docs_au AFTER UPDATE ON session_docs BEGIN
  INSERT INTO session_fts(session_fts, rowid, title, first_prompt, body)
  VALUES('delete', old.session_id, old.title, old.first_prompt, old.body);
  INSERT INTO session_fts(rowid, title, first_prompt, body)
  VALUES (new.session_id, new.title, new.first_prompt, new.body);
END;

CREATE INDEX IF NOT EXISTS idx_sessions_provider_updated ON sessions(provider, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_repo_updated ON sessions(repo, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_branch_updated ON sessions(branch, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_subagent_updated ON sessions(is_subagent, updated_at DESC);
