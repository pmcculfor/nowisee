-- Admin console usage and login history. Host-owned; not an app table.
-- One file: the product is in development; existing rows need not be preserved.

CREATE TABLE login_events (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL
);

CREATE INDEX login_events_at ON login_events (at);
CREATE INDEX login_events_user ON login_events (user_id, at);

CREATE TABLE usage_hourly (
  hour INTEGER NOT NULL,
  app_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  user_id TEXT REFERENCES users (id) ON DELETE CASCADE,
  opens INTEGER NOT NULL DEFAULT 0,
  refreshes INTEGER NOT NULL DEFAULT 0,
  actions INTEGER NOT NULL DEFAULT 0,
  ip TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (hour, app_id, session_id)
);

CREATE INDEX usage_hourly_user ON usage_hourly (user_id, hour);
CREATE INDEX usage_hourly_app ON usage_hourly (app_id, hour);
CREATE INDEX usage_hourly_hour ON usage_hourly (hour);
