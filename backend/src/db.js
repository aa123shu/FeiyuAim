import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { DatabaseSync } from 'node:sqlite'

const schema = [
  'CREATE TABLE IF NOT EXISTS users (',
  '  id TEXT PRIMARY KEY,',
  '  username TEXT NOT NULL UNIQUE COLLATE NOCASE,',
  '  password_hash TEXT NOT NULL,',
  '  nickname TEXT NOT NULL,',
  "  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),",
  '  created_at TEXT NOT NULL',
  ');',
  'CREATE TABLE IF NOT EXISTS models (',
  '  id TEXT PRIMARY KEY,',
  '  title TEXT NOT NULL,',
  '  summary TEXT NOT NULL,',
  '  description TEXT NOT NULL,',
  '  category TEXT NOT NULL,',
  '  framework TEXT NOT NULL,',
  '  version TEXT NOT NULL,',
  "  tags_json TEXT NOT NULL DEFAULT '[]',",
  '  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,',
  "  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),",
  '  file_name TEXT NOT NULL,',
  '  stored_name TEXT NOT NULL UNIQUE,',
  '  file_size INTEGER NOT NULL,',
  '  file_type TEXT NOT NULL,',
  '  sha256 TEXT NOT NULL,',
  '  downloads INTEGER NOT NULL DEFAULT 0,',
  '  created_at TEXT NOT NULL,',
  '  reviewed_at TEXT,',
  '  reviewed_by TEXT REFERENCES users(id)',
  ');',
  'CREATE TABLE IF NOT EXISTS comments (',
  '  id TEXT PRIMARY KEY,',
  '  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,',
  '  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,',
  '  content TEXT NOT NULL,',
  '  created_at TEXT NOT NULL',
  ');',
  'CREATE TABLE IF NOT EXISTS favorites (',
  '  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,',
  '  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,',
  '  created_at TEXT NOT NULL,',
  '  PRIMARY KEY(model_id, user_id)',
  ');',
  'CREATE TABLE IF NOT EXISTS reports (',
  '  id TEXT PRIMARY KEY,',
  '  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,',
  '  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,',
  '  reason TEXT NOT NULL,',
  "  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'dismissed')),",
  '  created_at TEXT NOT NULL,',
  '  resolved_at TEXT,',
  '  resolved_by TEXT REFERENCES users(id)',
  ');',
  'CREATE TABLE IF NOT EXISTS downloads (',
  '  id TEXT PRIMARY KEY,',
  '  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,',
  '  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,',
  '  ip TEXT,',
  '  user_agent TEXT,',
  '  created_at TEXT NOT NULL',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_models_status_created ON models(status, created_at DESC);',
  'CREATE INDEX IF NOT EXISTS idx_models_author ON models(author_id, created_at DESC);',
  'CREATE INDEX IF NOT EXISTS idx_comments_model ON comments(model_id, created_at ASC);',
  'CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);',
  'CREATE INDEX IF NOT EXISTS idx_downloads_model ON downloads(model_id, created_at DESC);',
].join('\n')

export function openDatabase(config) {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true })
  fs.mkdirSync(config.uploadDir, { recursive: true })
  const db = new DatabaseSync(config.dbPath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA busy_timeout = 5000;')
  db.exec(schema)

  const admin = db.prepare('SELECT id FROM users WHERE username = ?').get(config.adminUsername)
  if (!admin) {
    db.prepare("INSERT INTO users (id, username, password_hash, nickname, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)")
      .run(randomUUID(), config.adminUsername, bcrypt.hashSync(config.adminPassword, 12), config.adminNickname, new Date().toISOString())
  }
  return db
}
