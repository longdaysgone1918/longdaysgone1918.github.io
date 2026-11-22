-- 留言和点赞的数据库结构：在 Cloudflare D1 的控制台（Console）里运行一次
-- Database schema for comments and likes: run once in the Cloudflare D1 console

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread TEXT NOT NULL,            -- 文章编号，例如 essays/2026-11-20 / entry id, e.g. essays/2026-11-20
  parent_id INTEGER,               -- 回复的是哪条留言（只用于你的回复）/ the comment being replied to (owner replies only)
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'zh', -- 留言时所在的语言版本 / language version the visitor was reading
  status TEXT NOT NULL DEFAULT 'pending', -- pending = 待审核 / approved = 已通过
  is_owner INTEGER NOT NULL DEFAULT 0,    -- 1 = 你自己的回复 / your own reply
  ip_hash TEXT NOT NULL,           -- 加盐后的 IP 摘要，只用于限流，不保存原始 IP / salted IP hash, for rate limits only
  created_at INTEGER NOT NULL      -- 毫秒时间戳 / milliseconds since 1970
);
CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments (thread, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_ip ON comments (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_created ON comments (created_at);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments (status, created_at);

CREATE TABLE IF NOT EXISTS likes (
  thread TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (thread, ip_hash)    -- 同一网络连接对同一篇只计一次 / one like per connection per entry
);
CREATE INDEX IF NOT EXISTS idx_likes_ip ON likes (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_likes_created ON likes (created_at);

CREATE TABLE IF NOT EXISTS admin_failures (
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL      -- 管理密码输错的记录，用于防止暴力破解 / failed admin logins, against brute force
);
CREATE INDEX IF NOT EXISTS idx_admin_failures ON admin_failures (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,              -- 少量设置和状态，例如最近一次通知是否成功 / small settings and state, e.g. last notification result
  v TEXT NOT NULL
);
