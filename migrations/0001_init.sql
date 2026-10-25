-- 0001_init.sql —— 短链管理版初始结构
-- 本地：npx wrangler d1 migrations apply shortlink --local
-- 线上：npx wrangler d1 migrations apply shortlink --remote

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'viewer')),
  created_at INTEGER NOT NULL,
  last_login_at INTEGER,
  disabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  hits INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,
  last_click_at INTEGER,
  created_ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_links_created ON links (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_links_hits ON links (hits DESC);
CREATE INDEX IF NOT EXISTS idx_links_status ON links (status);

CREATE TABLE IF NOT EXISTS clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  ts INTEGER NOT NULL,
  country TEXT,
  city TEXT,
  referer TEXT,
  ua TEXT,
  ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_clicks_ts ON clicks (ts DESC);
CREATE INDEX IF NOT EXISTS idx_clicks_link ON clicks (link_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_clicks_code ON clicks (code, ts DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  ip_hash TEXT,
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs (ts DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  ts INTEGER NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts (ip_hash, ts);

INSERT OR IGNORE INTO settings (key, value) VALUES ('public_create', '0'), ('default_expire_days', '0');
