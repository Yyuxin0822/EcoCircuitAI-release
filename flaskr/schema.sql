DROP TABLE IF EXISTS user;

DROP TABLE IF EXISTS project;

DROP TABLE IF EXISTS prompt;

CREATE TABLE IF NOT EXISTS "legacy_users" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE, 
  password TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_user_email ON "legacy_users"(email);

CREATE TABLE user (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  auth0_id TEXT UNIQUE NOT NULL,   -- stores the Auth0 "sub" field
  email TEXT,                      -- email from Auth0 (optional)
  name TEXT,                       -- display name from Auth0
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_api_key (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,                    -- UUID reference to user table
    api_key TEXT NOT NULL,                    -- OpenAI API key stored here is an encrypted key
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE user_consent (
  consent_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT, -- UUID reference, NULL if anonymous user
  consent_given BOOLEAN NOT NULL,
  consent_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  ip_address TEXT,
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE SET NULL
);

------------ below is for ecocircuit ------------
CREATE TABLE project (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  author_id TEXT, --- NULLABLE, supports both legacy integer IDs (as text) and new UUIDs
  created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  title TEXT DEFAULT 'Untitled',
  type TEXT NOT NULL CHECK (type IN ('description', 'image', 'label')),
  info TEXT,  --- NULLABLE
  img_url TEXT,  --- NULLABLE, stores the last presigned image URL
  img_url_expires_at INTEGER,  --- NULLABLE, UNIX timestamp for when the image URL expires
  thumbnails TEXT,  --- NULLABLE, JSON: {"matrix_io": "url", "matrix_metabolism": "url"}
  thumbnails_expires_at INTEGER,  --- NULLABLE, UNIX timestamp for when the thumbnail URLs expire
  system TEXT,  --- NULLABLE
  access TEXT DEFAULT 'temporary' CHECK (access IN ('temporary', 'public', 'private'))
);

CREATE TABLE iodata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  iodata TEXT,
  FOREIGN KEY (project_id) REFERENCES project (id)
);

CREATE TABLE metabolism (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  metabolism TEXT,
  FOREIGN KEY (project_id) REFERENCES project (id)
);



------------ below is the temp table for ecocircuit ------------
CREATE TABLE prompt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt TEXT,
  flow TEXT,
  feedbackflow TEXT DEFAULT ' ',
  node TEXT,
  userinfo TEXT DEFAULT ' ',
  project_id INTEGER,
  promptcanvas TEXT,
  FOREIGN KEY (project_id) REFERENCES project (id)
);
