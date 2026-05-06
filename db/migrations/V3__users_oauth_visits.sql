-- Phase 4: Replace site/admin password model with Google OAuth + user table.
-- Effective admin = email present in ADMIN_EMAILS env (no DB column needed).

-- Detach the rooms FK before dropping admins.
ALTER TABLE rooms DROP CONSTRAINT fk_rooms_admin;
ALTER TABLE rooms DROP COLUMN created_by_admin_id;

DROP TABLE site_passwords;
DROP TABLE admins;

-- Authenticated users. nickname overrides display of `name` in the UI.
CREATE TABLE users (
  id               NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email            VARCHAR2(320) NOT NULL,
  name             VARCHAR2(200),
  nickname         VARCHAR2(100),
  avatar_url       VARCHAR2(1000),
  primary_provider VARCHAR2(50),
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  last_login_at    TIMESTAMP,
  CONSTRAINT uk_users_email UNIQUE (email)
);

-- One row per OAuth account a user has linked. Lets us add Apple/GitHub
-- later without altering users.
CREATE TABLE user_oauth_accounts (
  id               NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id          NUMBER NOT NULL,
  provider         VARCHAR2(50) NOT NULL,
  provider_subject VARCHAR2(255) NOT NULL,
  provider_email   VARCHAR2(320),
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT fk_oauth_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT uk_oauth_provider_subject
    UNIQUE (provider, provider_subject)
);

CREATE INDEX idx_oauth_user_id ON user_oauth_accounts (user_id);

-- Per-user room visit ledger; powers "rooms I've been in" list.
CREATE TABLE room_visits (
  user_id          NUMBER NOT NULL,
  room_id          VARCHAR2(32) NOT NULL,
  first_visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  last_visited_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  visit_count      NUMBER DEFAULT 1 NOT NULL,
  CONSTRAINT pk_room_visits PRIMARY KEY (user_id, room_id),
  CONSTRAINT fk_visits_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_visits_room
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE INDEX idx_room_visits_user_last
  ON room_visits (user_id, last_visited_at DESC);
CREATE INDEX idx_room_visits_room ON room_visits (room_id);

-- Re-attach rooms to the new user table.
ALTER TABLE rooms ADD created_by_user_id NUMBER;
ALTER TABLE rooms ADD CONSTRAINT fk_rooms_user
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_rooms_created_by ON rooms (created_by_user_id);
