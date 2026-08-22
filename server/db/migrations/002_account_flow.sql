-- In-progress Account sign-in state, keyed by anonymous (or signed-in) session.
-- Email cannot live in a node label, node id, or warm payload.
CREATE TABLE account_flow (
  session_id TEXT PRIMARY KEY,
  email TEXT,
  updated_at INTEGER NOT NULL
);
