CREATE TABLE app_catalog (
  app_id          TEXT PRIMARY KEY,
  locator         TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  grant_lockbox   INTEGER NOT NULL DEFAULT 0,
  grant_oauth     INTEGER NOT NULL DEFAULT 0,
  grant_directory INTEGER NOT NULL DEFAULT 0,
  label           TEXT NOT NULL,
  oauth_provider  TEXT,
  home_role       TEXT,
  parkable        INTEGER,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

INSERT INTO app_catalog (
  app_id, locator, enabled, grant_lockbox, grant_oauth, grant_directory,
  label, oauth_provider, home_role, parkable, sort_order
) VALUES
  (
    'home',
    'http://127.0.0.1:3110',
    1, 0, 0, 1,
    'Home',
    NULL,
    'internal',
    NULL,
    0
  ),
  (
    'recents',
    'http://127.0.0.1:3111',
    1, 0, 0, 1,
    'Recent apps',
    NULL,
    'internal',
    0,
    1
  ),
  (
    'tutorial',
    'http://127.0.0.1:3112',
    1, 0, 0, 0,
    'Tutorial app. To begin, press the right arrow key, tap the right of the screen, or on the iPhone app, swipe right. Navigate up or down to access other apps.',
    NULL,
    'default',
    NULL,
    2
  ),
  (
    'bible',
    'http://127.0.0.1:3113',
    1, 0, 0, 0,
    'Bible',
    NULL,
    'default',
    NULL,
    3
  ),
  (
    'notes',
    'http://127.0.0.1:3114',
    1, 0, 0, 0,
    'Notes',
    NULL,
    'default',
    NULL,
    4
  ),
  (
    'lists',
    'http://127.0.0.1:3115',
    1, 0, 0, 0,
    'Lists',
    NULL,
    'default',
    NULL,
    5
  ),
  (
    'weather',
    'http://127.0.0.1:3116',
    1, 0, 0, 0,
    'Weather',
    NULL,
    'default',
    NULL,
    6
  ),
  (
    'gmail',
    'http://127.0.0.1:3117',
    1, 1, 1, 0,
    'Gmail',
    '{"appId":"gmail","authorizationEndpoint":"https://accounts.google.com/o/oauth2/v2/auth","tokenEndpoint":"https://oauth2.googleapis.com/token","revokeEndpoint":"https://oauth2.googleapis.com/revoke","scopes":["https://www.googleapis.com/auth/gmail.modify"],"extraAuthorizeParams":{"access_type":"offline","prompt":"consent"}}',
    NULL,
    NULL,
    7
  ),
  (
    'account',
    'http://127.0.0.1:3118',
    1, 0, 0, 0,
    'Account',
    NULL,
    'required',
    NULL,
    8
  );
