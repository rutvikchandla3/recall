CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  approx_tokens INTEGER NOT NULL,
  start_char INTEGER NOT NULL,
  end_char INTEGER NOT NULL,
  text_sha256 TEXT NOT NULL,
  embed_sha256 TEXT NOT NULL,
  info_score REAL NOT NULL DEFAULT 0,
  embedding_status TEXT NOT NULL DEFAULT 'pending',
  embedding_error TEXT,
  embedded_at TEXT,
  UNIQUE(session_id, ord)
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
  text,
  content='chunks',
  content_rowid='id',
  tokenize='porter unicode61 remove_diacritics 2',
  prefix='2 3 4'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunk_fts(rowid, text)
  VALUES (new.id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunk_fts(chunk_fts, rowid, text)
  VALUES('delete', old.id, old.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunk_fts(chunk_fts, rowid, text)
  VALUES('delete', old.id, old.text);
  INSERT INTO chunk_fts(rowid, text)
  VALUES (new.id, new.text);
END;

CREATE TABLE IF NOT EXISTS embedding_cache (
  embed_sha256 TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(embed_sha256, model, dimensions)
);

CREATE TABLE IF NOT EXISTS query_embedding_cache (
  query_sha256 TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(query_sha256, model, dimensions)
);

CREATE INDEX IF NOT EXISTS idx_chunks_session_ord ON chunks(session_id, ord);
CREATE INDEX IF NOT EXISTS idx_chunks_embed_status ON chunks(embedding_status, embed_sha256);
CREATE INDEX IF NOT EXISTS idx_chunks_embed_sha ON chunks(embed_sha256);
